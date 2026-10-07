"""Agent ops: Odoo <-> Paperclip bridge for Hermes.

Subcommands
  init                        Check Odoo/Paperclip access (read-only); queues a proposal if the intake tag is missing
  propose --file p.json       Queue any other Odoo change (tasks, timesheets, stages, notes) for approval in Discord
  proposals / questions       Relay new proposals / agent questions (cron; empty output when nothing new)
  diskguard                   Pause all agents when C: runs low, resume + restart their tasks when space is back (cron)
  standup                     Daily standup text: yesterday's timesheets, active tasks, blockers (read-only)
  odoo projects|project <id>|tasks <project_id> [--mine] [--open]|timesheets <from> [<to>]
                              Read-only Odoo lookups as JSON, for agents preparing proposals
  intake                   Odoo tasks tagged agent-ready -> Paperclip issues (assigned to Manager)
  digest                      Build the daily approval digest from agents' "Run summary" comments
  approve 1,3                 Write timesheets / stage / chatter to Odoo for digest items
  edit 2 hours=1.5 [stage=X]  Adjust an item, then approve it
  reject 4 [reason...]        Send an item back to the Manager in Paperclip
  pending                     Show items still awaiting a decision
  answer EME-12 <text>        Reply to an agent's "Question for board"
  newproject <name> --file f  New client requirements -> Estimator (or pipe text on stdin)

Add --dry-run to approve/edit/reject to print what would happen without writing.
Nothing is written to Odoo except by approve/edit of an item you approved in Discord.
"""
from __future__ import annotations

import base64
import datetime as dt
import hashlib
import html
import json
import mimetypes
import os
import re
import sys
import urllib.request
import xmlrpc.client
from pathlib import Path

# Windows: %LOCALAPPDATA%\hermes. macOS/Linux (no LOCALAPPDATA): ~/.hermes, Hermes's default there.
HERMES_HOME = Path(os.environ.get("HERMES_HOME")
                   or (Path(os.environ["LOCALAPPDATA"]) / "hermes" if os.environ.get("LOCALAPPDATA") else Path.home() / ".hermes"))
IS_WINDOWS = os.name == "nt"
BRIDGE_SETUP = "windows/hermes-bridge.ps1" if IS_WINDOWS else "mac/hermes-bridge.sh"
STATE_DIR = HERMES_HOME / "state" / "agent_ops"
CONFIG_FILE = HERMES_HOME / "scripts" / "agent_ops.config.json"

# Instance values (ids, employee) come from agent_ops.config.json, written by windows/hermes-bridge.ps1 (mac/hermes-bridge.sh on macOS).
DEFAULT_CONFIG = {
    "paperclip_api": "http://localhost:3100/api",
    "company_id": "",
    "manager_agent_id": "",
    "estimator_agent_id": "",
    "ready_tag": "agent-ready",
    "timesheet_employee": "",
    # Odoo project id (or name) -> Paperclip project id; written by connect-project.ps1 (mac/connect-project.sh on macOS)
    "project_map": {},
    "standup_title": "DSM",
    "standup_name": "",
    "standup_active_stages": "To Do,Doing,In Dev,In Progress,Working on,QA Issues",
    "standup_recent_days": 7,
    "workdays": "0,1,2,3,4,5",  # Mon=0 ... Sun=6
}
REQUIRED = ("company_id", "manager_agent_id", "estimator_agent_id", "timesheet_employee")

SUMMARY_FIELDS = {
    "odoo id": "odoo_id",
    "agent": "agent",
    "what changed": "changed",
    "pr": "pr",
    "qa verdict": "qa",
    "hours estimate": "hours",
    "proposed odoo stage": "stage",
}


# ---------- config / env ----------

def load_env() -> None:
    """Load Hermes's .env for keys not already in the environment."""
    env_file = HERMES_HOME / ".env"
    if not env_file.exists():
        return
    for line in env_file.read_text(encoding="utf-8", errors="replace").splitlines():
        m = re.match(r"\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$", line)
        if m and m.group(1) not in os.environ:
            os.environ[m.group(1)] = m.group(2).strip().strip('"').strip("'")


def load_config() -> dict:
    cfg = dict(DEFAULT_CONFIG)
    if CONFIG_FILE.exists():
        cfg.update(json.loads(CONFIG_FILE.read_text(encoding="utf-8-sig")))
    missing = [k for k in REQUIRED if not cfg.get(k)]
    if missing:
        raise SystemExit(f"{CONFIG_FILE} is missing {', '.join(missing)}. Re-run {BRIDGE_SETUP}.")
    return cfg


def read_state(name: str, default):
    f = STATE_DIR / f"{name}.json"
    return json.loads(f.read_text(encoding="utf-8")) if f.exists() else default


def write_state(name: str, data) -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    (STATE_DIR / f"{name}.json").write_text(json.dumps(data, indent=2), encoding="utf-8")


# ---------- clients ----------

class Paperclip:
    def __init__(self, cfg: dict):
        self.base = cfg["paperclip_api"].rstrip("/")
        self.cid = cfg["company_id"]

    def _req(self, method: str, path: str, body=None):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.base + path, data=data, method=method,
                                     headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read()
            return json.loads(raw) if raw else None

    def issues(self):
        # Paperclip returns 500 issues unless asked for more; a capped list made the Odoo
        # intake re-create tasks whose issue had fallen outside the newest 500.
        return self._req("GET", f"/companies/{self.cid}/issues?limit=10000") or []

    def create_issue(self, body):
        return self._req("POST", f"/companies/{self.cid}/issues", body)

    def update_issue(self, issue_id, body):
        return self._req("PATCH", f"/issues/{issue_id}", body)

    def comments(self, issue_id):
        return self._req("GET", f"/issues/{issue_id}/comments") or []

    def comment(self, issue_id, text):
        return self._req("POST", f"/issues/{issue_id}/comments", {"body": text})

    def issue(self, issue_id):
        return self._req("GET", f"/issues/{issue_id}")

    def agents(self):
        return self._req("GET", f"/companies/{self.cid}/agents") or []

    def pause(self, agent_id):
        return self._req("POST", f"/agents/{agent_id}/pause", {})

    def resume(self, agent_id):
        return self._req("POST", f"/agents/{agent_id}/resume", {})


class Odoo:
    def __init__(self):
        self.url = os.environ["ODOO_URL"].rstrip("/")
        self.db = os.environ["ODOO_DB"]
        self.key = os.environ["ODOO_API_KEY"]
        common = xmlrpc.client.ServerProxy(f"{self.url}/xmlrpc/2/common", allow_none=True)
        self.uid = common.authenticate(self.db, os.environ["ODOO_USERNAME"], self.key, {})
        if not self.uid:
            raise SystemExit("Odoo authentication failed (check ODOO_* in Hermes .env)")
        self.models = xmlrpc.client.ServerProxy(f"{self.url}/xmlrpc/2/object", allow_none=True)

    def call(self, model, method, *args, **kw):
        return self.models.execute_kw(self.db, self.uid, self.key, model, method, list(args), kw)

    def tag_id(self, name):
        ids = self.call("project.tags", "search", [["name", "=", name]], limit=1)
        return ids[0] if ids else None

    def task_url(self, task_id):
        return f"{self.url}/odoo/project.task/{task_id}"


def html_to_text(s) -> str:
    if not s:
        return ""
    s = re.sub(r"<(br|/p|/li|/div)[^>]*>", "\n", str(s), flags=re.I)
    return html.unescape(re.sub(r"<[^>]+>", "", s)).strip()


# ---------- intake ----------

def cmd_intake(cfg):
    """Read-only on Odoo: tagged tasks become Paperclip issues. Nothing is written to Odoo here."""
    odoo, pc = Odoo(), Paperclip(cfg)
    ready = odoo.tag_id(cfg["ready_tag"])
    lines = []
    if not ready:
        lines.append(f"Odoo tag `{cfg['ready_tag']}` does not exist yet; approve the setup proposal from `init`.")
        tasks = []
    else:
        tasks = odoo.call("project.task", "search_read", [["tag_ids", "in", [ready]]],
                          fields=["id", "name", "description", "project_id", "stage_id", "date_deadline", "priority", "parent_id",
                                  "x_task_number"],
                          limit=50)
    # Bugs the owner's QA engineer files straight into the QA Issues stage, in projects that have a
    # Paperclip project, are picked up too (they are never tagged).
    qa_stage = cfg.get("qa_issues_stage", "QA Issues")
    mapped = [int(k) for k in cfg.get("project_map", {}) if str(k).isdigit()]
    if qa_stage and mapped:
        seen = {t["id"] for t in tasks}
        tasks += [t for t in odoo.call(
            "project.task", "search_read",
            [["project_id", "in", mapped], ["stage_id.name", "=", qa_stage]],
            fields=["id", "name", "description", "project_id", "stage_id", "date_deadline", "priority", "parent_id",
                    "x_task_number"],
            limit=50) if t["id"] not in seen]
    tasks.sort(key=lambda t: bool(t["parent_id"]))  # main tasks first, so sub-tasks can nest under them
    issues = pc.issues()
    # Dedupe on the Paperclip side: the billing code, plus any Odoo id named in a title or
    # description of an issue created by hand ("[ODOO-28415] ...", "Odoo id 28439", "(Odoo 28416)").
    existing = {i.get("billingCode") for i in issues}
    for i in issues:
        text = f"{i.get('title') or ''} {i.get('description') or ''}"
        existing |= {f"ODOO-{n}" for n in re.findall(r"(?i)\bODOO[- ](?:id )?(\d{4,6})\b", text)}
        existing |= {f"ODOO-{n}" for n in re.findall(r"(?i)\(Odoo (\d{4,6})\)", text)}
    # ...and the owner's ticket number in a title ("Ticket#344", "(#326)"), mapped back to the Odoo id
    # (ticket numbers are only unique inside one Odoo project, so match within the same Paperclip project)
    pmap = cfg.get("project_map", {})
    for t in tasks:
        pc_project = pmap.get(str(t["project_id"][0])) if t["project_id"] else None
        num = str(t.get("x_task_number") or "")
        if pc_project and num and any(i.get("projectId") == pc_project
                                      and num in re.findall(r"#(\d{1,4})\b", i.get("title") or "") for i in issues):
            existing.add(f"ODOO-{t['id']}")
    for t in tasks:
        code = f"ODOO-{t['id']}"
        project = t["project_id"][1] if t["project_id"] else "(no project)"
        if code not in existing:
            desc = (
                f"**Odoo task:** {odoo.task_url(t['id'])}\n"
                f"**Odoo project:** {project}\n"
                f"**Odoo stage:** {t['stage_id'][1] if t['stage_id'] else '-'}\n"
                f"**Deadline:** {t.get('date_deadline') or '-'}\n\n"
                f"{html_to_text(t.get('description')) or '(no description in Odoo)'}\n\n"
                "---\nManager: if acceptance criteria are missing, write them before assigning. "
                "If this Odoo project has no Paperclip project/repo yet, ask the board instead of guessing a repo."
            )
            body = {
                "title": f"[{code}] {t['name']}",
                "description": desc,
                "status": "todo",
                "priority": "high" if t.get("priority") == "1" else "medium",
                "assigneeAgentId": cfg["manager_agent_id"],
                "billingCode": code,
            }
            pmap = cfg["project_map"]
            key = str(t["project_id"][0]) if t["project_id"] else ""
            if key in pmap or project in pmap:  # keyed by Odoo project id (preferred) or name
                body["projectId"] = pmap.get(key) or pmap[project]
            if t.get("parent_id"):  # sub-task: nest under the parent's Paperclip issue if it exists
                parent_code = f"ODOO-{t['parent_id'][0]}"
                parent = next((i for i in issues if i.get("billingCode") == parent_code), None)
                if parent:
                    body["parentId"] = parent["id"]
            issue = pc.create_issue(body)
            issues.append(issue)
            lines.append(f"• {t['name']} → agent task {issue.get('identifier') or issue.get('id')}")
    if lines:  # empty stdout = silent run
        print("📥 **New work picked up from Odoo**\n" + "\n".join(lines))


def format_question(issue: dict, body: str, agent: str) -> str:
    """Only the question block, in plain words: who asks, about what, the question, how to answer."""
    start = body.lower().find("question for board")
    q = body[start:]
    # the block ends at the next heading, rule or run summary
    m = re.search(r"\n(#{1,4} |---|\*\*Run summary|### Run summary)", q)
    q = q[:m.start()] if m else q
    q = re.sub(r"(?i)^\**question for board:?\**:?\s*", "", q.strip())
    q = re.sub(r"\*\*|__|`", "", q)
    q = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", q)          # markdown links -> their text
    q = re.sub(r"\n{3,}", "\n\n", q).strip()
    if len(q) > 700:
        q = q[:700].rsplit(" ", 1)[0] + " …"
    title = re.sub(r"^\[?ODOO-\d+\]?\s*", "", issue.get("title") or "").strip()
    ident = issue.get("identifier")
    return (f"❓ **{agent} needs a decision** on {ident}: {title[:90]}\n"
            f"{q}\n"
            f"↩️ To answer, reply: `answer {ident} <your answer>`")


def relay_questions(pc: "Paperclip") -> list[str]:
    """Surface agent comments starting with 'Question for board' that weren't relayed yet."""
    relayed = set(read_state("relayed_questions", []))
    out = []
    try:
        names = {a["id"]: a.get("name") for a in pc.agents()}
    except Exception:
        names = {}
    for issue in pc.issues():
        if issue.get("status") in ("done", "cancelled"):
            continue
        for c in pc.comments(issue["id"]):
            body = c.get("body") or ""
            if c["id"] in relayed or c.get("authorType") != "agent" or "question for board" not in body.lower():
                continue
            relayed.add(c["id"])
            out.append(format_question(issue, body, names.get(c.get("authorAgentId"), "An agent")))
    write_state("relayed_questions", sorted(relayed))
    return out


def find_issue(pc: "Paperclip", ident: str) -> dict:
    for i in pc.issues():
        if (i.get("identifier") or "").lower() == ident.lower():
            return i
    raise SystemExit(f"No Paperclip issue {ident}")


def cmd_answer(cfg, args, dry_run):
    if len(args) < 2:
        raise SystemExit("Usage: answer EME-12 <your answer>")
    pc = Paperclip(cfg)
    issue = find_issue(pc, args[0])
    text = " ".join(args[1:])
    if not dry_run:
        pc.comment(issue["id"], f"**Board answer:** {text}")
        if issue.get("status") == "blocked":
            pc.update_issue(issue["id"], {"status": "todo"})
    print(f"{'(dry run) ' if dry_run else ''}✅ Sent your answer to {issue.get('identifier')}; the agent continues from it.")


def cmd_newproject(cfg, args, dry_run):
    """newproject <name> [--file path]  (requirements from --file or stdin)"""
    if "--file" in args:
        i = args.index("--file")
        text = Path(args[i + 1]).read_text(encoding="utf-8", errors="replace")
        args = args[:i] + args[i + 2:]
    else:
        text = sys.stdin.read()
    name = " ".join(args).strip()
    if not name or not text.strip():
        raise SystemExit("Usage: newproject <name> --file <requirements.txt>  (or pipe requirements on stdin)")
    body = {
        "title": f"New project: {name}",
        "description": "## Client requirements (verbatim)\n\n" + text.strip()
                       + "\n\n---\nEstimator: follow `project-estimation`. Ask the board which project category first.",
        "status": "todo",
        "priority": "high",
        "assigneeAgentId": cfg["estimator_agent_id"],
    }
    if dry_run:
        print(f"(dry run) would create '{body['title']}' ({len(text)} chars) for the Estimator")
        return
    issue = Paperclip(cfg).create_issue(body)
    print(f"Created {issue.get('identifier')} 'New project: {name}' for the Estimator. "
          "It will ask here which project category this is.")


# ---------- digest ----------

def parse_summary(body: str) -> dict | None:
    if "run summary" not in (body or "").lower():
        return None
    out = {}
    for line in body.splitlines():
        m = re.match(r"\s*[-*]\s*([^:]+):\s*(.+)$", line)
        if m and m.group(1).strip().lower() in SUMMARY_FIELDS:
            out[SUMMARY_FIELDS[m.group(1).strip().lower()]] = m.group(2).strip()
    return out or None


def parse_hours(s) -> float:
    m = re.search(r"\d+(?:\.\d+)?", s or "")
    return float(m.group()) if m else 0.0


def short_title(title: str) -> str:
    """'[ODOO-1] QA: 179: 153: Backend: X (long detail)' -> 'Backend: X'"""
    t = re.sub(r"^\[ODOO-\d+\]\s*(QA:\s*)?(\d+:\s*)*", "", title)
    return re.sub(r"\s*\(.*$", "", t)[:80]


def item_update(it: dict) -> str:
    """One plain line for Odoo: what happened to the ticket, no agent narrative."""
    if it.get("update"):
        return it["update"]
    if it.get("qa") == "PASS":
        return "QA passed on staging"
    if it.get("qa") == "FAIL":
        return "QA failed on staging"
    if it.get("pr"):
        return f"Fix ready for review: {it['pr']}"
    first = re.split(r"(?<=[.;])\s", (it.get("changed") or ["-"])[-1].split(": ", 1)[-1])[0]
    return first[:140]


def cmd_digest(cfg):
    pc = Paperclip(cfg)
    now = dt.datetime.now(dt.timezone.utc)
    since_s = read_state("last_digest", {}).get("at")
    since = dt.datetime.fromisoformat(since_s) if since_s else now - dt.timedelta(days=1)
    pending = {p["issue_id"]: p for p in read_state("pending", [])}

    for issue in pc.issues():
        m = re.match(r"\[ODOO-(\d+)\]", issue.get("title", ""))
        if not m:
            continue
        summaries, latest = [], None
        for c in sorted(pc.comments(issue["id"]), key=lambda c: c["createdAt"]):
            created = dt.datetime.fromisoformat(c["createdAt"].replace("Z", "+00:00"))
            if created > since and (s := parse_summary(c.get("body", ""))):
                summaries.append(s)
                latest = created
        if not summaries:
            continue
        item = pending.get(issue["id"], {
            "issue_id": issue["id"], "identifier": issue.get("identifier"),
            "odoo_task_id": int(m.group(1)), "title": issue["title"],
            "hours": 0.0, "changed": [], "pr": None, "qa": None, "stage": None,
        })
        # timesheet date = local day of the latest summary, not the day you approve
        item["date"] = latest.astimezone().date().isoformat()
        for s in summaries:
            item["hours"] = round(item["hours"] + parse_hours(s.get("hours")), 2)
            if s.get("changed"):
                item["changed"].append(f"{s.get('agent', '?')}: {s['changed']}")
            if s.get("pr", "").lower() not in ("", "none", "n/a"):
                item["pr"] = s["pr"]
            if s.get("qa", "").upper() in ("PASS", "FAIL"):
                item["qa"] = s["qa"].upper()
            if s.get("stage", "").lower() not in ("", "unchanged", "n/a"):
                item["stage"] = s["stage"]
        item["status"] = issue.get("status")
        pending[issue["id"]] = item

    items = list(pending.values())
    # Numbers are permanent: an item keeps the number the owner already saw, and a
    # new item continues from the highest number ever issued, so an old "approve N"
    # can never land on a different item.
    last = max([it.get("n", 0) for it in items] + [read_state("last_n", 0)])
    for it in items:
        if not it.get("n"):
            last += 1
            it["n"] = last
        if it.get("kind") == "proposal":
            it["posted"] = True
    items.sort(key=lambda it: it["n"])
    write_state("pending", items)
    write_state("last_n", last)
    write_state("last_digest", {"at": now.isoformat()})

    if not items:
        print("📋 **Daily digest:** nothing from the agents to approve today.")
        return
    date = now.astimezone().strftime("%a %d %b")  # local time
    out = [f"📋 **Daily digest, {date}**: {len(items)} item{'s' if len(items) != 1 else ''} to approve"]
    digest_labels = ticket_labels([it.get("odoo_task_id") for it in items if it.get("kind") != "proposal"])
    for it in items:
        if it.get("kind") == "proposal":  # renumbered above, so always re-show it
            out.append("\n" + format_proposal(it))
            continue
        label = digest_labels.get(str(it["odoo_task_id"])) or short_title(it["title"])
        stage = (f", move to {it['stage']}" if it.get("stage")
                 and not re.search(r"testing|done", str(it["stage"]), re.I) else "")
        out.append(f"**{it['n']}.** {label}: {item_update(it)} ({it['hours']} h{stage})")
    out.append("\nReply `approve 1,2`, `edit 2 hours=1.5` or `reject 3 <reason>`. "
               "Nothing changes in Odoo until you approve.")
    print("\n".join(out))


# ---------- approvals ----------

def select(nums: str) -> list[dict]:
    wanted = {int(x) for x in re.findall(r"\d+", nums)}
    items = [p for p in read_state("pending", []) if p.get("n") in wanted]
    if not items:
        raise SystemExit(f"No pending digest items numbered {sorted(wanted)}. Run `pending` to list them.")
    return items


def drop_pending(done_ids: set) -> None:
    write_state("pending", [p for p in read_state("pending", []) if p["issue_id"] not in done_ids])


def find_employee(odoo: Odoo, name: str) -> int:
    ids = odoo.call("hr.employee", "search", [["name", "ilike", name]], limit=2)
    if len(ids) != 1:
        raise SystemExit(f"Expected exactly one Odoo employee matching '{name}', found {len(ids)}")
    return ids[0]


def approve(cfg, items, dry_run=False):
    odoo = Odoo()
    emp = find_employee(odoo, cfg["timesheet_employee"])
    today = dt.date.today().isoformat()
    done, lines = set(), []
    for it in [i for i in items if i.get("kind") == "proposal"]:
        lines.append(execute_proposal(odoo, emp, it, dry_run))
        done.add(it["issue_id"])
    for it in [i for i in items if i.get("kind") != "proposal"]:
        task = odoo.call("project.task", "read", [it["odoo_task_id"]], fields=["project_id", "stage_id", "name"])[0]
        project_id = task["project_id"][0] if task["project_id"] else None
        actions = []
        if it["hours"] > 0 and project_id:
            vals = {"employee_id": emp, "project_id": project_id, "task_id": it["odoo_task_id"],
                    "unit_amount": it["hours"], "date": it.get("date") or today,
                    "name": item_update(it)}
            if not dry_run:
                odoo.call("account.analytic.line", "create", vals)
            actions.append(f"{it['hours']}h timesheet")
        if it.get("stage") and re.search(r"testing|done", str(it["stage"]), re.I):
            # A work item carries no proof; only a QA evidence proposal may move a ticket to Testing/Done.
            actions.append("stage left unchanged (Testing/Done needs a QA proof proposal)")
        elif it.get("stage") and project_id:
            sid = odoo.call("project.task.type", "search",
                            [["name", "ilike", it["stage"]], ["project_ids", "in", [project_id]]], limit=1)
            if sid:
                if not dry_run:
                    odoo.call("project.task", "write", [it["odoo_task_id"]], {"stage_id": sid[0]})
                actions.append(f"stage → {it['stage']}")
            else:
                actions.append(f"stage '{it['stage']}' not found, left unchanged")
        note = item_update(it) + (f" ({it['pr']})" if it.get("pr") and it["pr"] not in item_update(it) else "")
        if not dry_run:
            odoo.call("project.task", "message_post", [it["odoo_task_id"]], body=note,
                      message_type="comment", subtype_xmlid="mail.mt_note")
        actions.append("chatter note")
        done.add(it["issue_id"])
        label = ticket_labels([it["odoo_task_id"]]).get(str(it["odoo_task_id"])) or short_title(it["title"])
        lines.append(f"✅ {it['n']}. {label}: {', '.join(actions)}")
    if not dry_run:
        drop_pending(done)
    print(("(dry run) " if dry_run else "") + "\n".join(lines))


# ---------- proposals: any other Odoo change, queued until approved in Discord ----------
#
# Proposal file (JSON):
# {"title": "Timesheets 28-29 Sep", "actions": [
#   {"type": "create_task", "ref": "t1", "project_id": 91, "name": "...", "parent": 27744, "milestone": "M9 - Seller and Admin Backend",
#    "stage": "Code Review", "description": "..."},
#   {"type": "update_task", "task": 28034, "parent": 27744, "milestone": 26, "assign_me": true},
#   {"type": "timesheet", "date": "2026-09-28", "task": 28034 | "t1", "hours": 2.5, "description": "..."},
#   {"type": "stage", "task": 28034, "stage": "Testing"},
#   {"type": "note", "task": 28034, "body": "..."},
#   {"type": "create_tag", "name": "agent-ready"},
#   {"type": "evidence", "task": 28020, "note": "Verified on staging build 12: ...",
#    "files": ["/mnt/d/Projects/.../_qa-evidence/Ticket#295/01-block.png", "D:\\...\\02-exit.mp4"]}]}
# "task"/"parent" may be an Odoo task id or the "ref" of a create_task earlier in the same proposal.
# "project" (name) or "project_id"; "milestone" by id or exact name. New tasks are assigned to the bridge's
# Odoo user (you) unless "assign_me": false.
# "evidence": screenshots / screen recordings proving a fix. When queued, the files are posted to the
# approvals channel so they can be reviewed; only on approve are they attached to the Odoo task
# (ir.attachment) with the note in its chatter.

ACTION_TYPES = {"create_task", "update_task", "timesheet", "stage", "note", "create_tag", "evidence"}
EVIDENCE_MAX_BYTES = 50 * 1024 * 1024      # per file, Odoo attachment
EVIDENCE_MAX_FILES = 8                   # proof is a small, chosen set (qa-evidence skill)
DISCORD_MAX_BYTES = 9_500_000             # per file, Discord bot upload (10 MB limit)


def local_path(p: str) -> Path:
    """Accept WSL (/mnt/d/..., /home/...) or Windows paths; return a path Windows Python can open.
    On macOS the agents and Hermes share one filesystem, so paths are used as they are."""
    if not IS_WINDOWS:
        return Path(p)
    m = re.match(r"^/mnt/([a-zA-Z])/(.*)$", p)
    if m:
        return Path(f"{m.group(1).upper()}:/{m.group(2)}")
    if p.startswith("/"):
        return Path(r"\\wsl.localhost\Ubuntu-24.04" + p.replace("/", "\\"))
    return Path(p)


def approvals_channel() -> str | None:
    """The Discord channel the agent-proposals cron job delivers to."""
    try:
        jobs = json.loads((HERMES_HOME / "cron" / "jobs.json").read_text(encoding="utf-8"))
        for j in (jobs.get("jobs", []) if isinstance(jobs, dict) else jobs):
            if j.get("name") == "agent-proposals" and str(j.get("deliver", "")).startswith("discord:"):
                return j["deliver"].split(":", 1)[1]
    except Exception:
        pass
    return None


def post_evidence_to_discord(item: dict) -> str:
    """Upload the evidence files of a queued proposal to the approvals channel (best effort)."""
    token, channel = os.environ.get("DISCORD_BOT_TOKEN"), approvals_channel()
    if not token or not channel:
        return "evidence not posted to Discord (no bot token or approvals channel)"
    out = []
    for a in [a for a in item["actions"] if a["type"] == "evidence"]:
        small = [f for f in a["files"] if local_path(f).stat().st_size <= DISCORD_MAX_BYTES]
        big = [Path(f).name for f in a["files"] if f not in small]
        for chunk in [small[i:i + 10] for i in range(0, len(small), 10)] or [[]]:
            boundary = f"----agentops{os.urandom(8).hex()}"
            text = (f"🧾 **Evidence for proposal {item['n']}** ({_task_label(a['task'])}): {a.get('note', '')[:1500]}"
                    + (f"\nToo large for Discord, attached in Odoo only on approve: {', '.join(big)}" if big else "")
                    + f"\nReply `approve {item['n']}` or `reject {item['n']}`.")
            body = [f"--{boundary}\r\nContent-Disposition: form-data; name=\"payload_json\"\r\n"
                    f"Content-Type: application/json\r\n\r\n{json.dumps({'content': text})}\r\n".encode()]
            for i, f in enumerate(chunk):
                p = local_path(f)
                body.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"files[{i}]\"; filename=\"{p.name}\"\r\n"
                            f"Content-Type: {mimetypes.guess_type(p.name)[0] or 'application/octet-stream'}\r\n\r\n".encode()
                            + p.read_bytes() + b"\r\n")
            body.append(f"--{boundary}--\r\n".encode())
            req = urllib.request.Request(f"https://discord.com/api/v10/channels/{channel}/messages", data=b"".join(body),
                                         headers={"Authorization": f"Bot {token}", "User-Agent": "agent-ops (local, 1.0)",
                                                  "Content-Type": f"multipart/form-data; boundary={boundary}"}, method="POST")
            try:
                urllib.request.urlopen(req, timeout=120).read()
                out.append(f"{len(chunk)} file(s) posted")
            except Exception as e:
                out.append(f"Discord upload failed: {e}")
    return "; ".join(out)


_LABELS: dict = {}   # Odoo task id -> "Ticket#N: short title", filled per message being formatted


def _task_label(ref) -> str:
    if isinstance(ref, int):
        return _LABELS.get(str(ref)) or _LABELS.get(ref) or f"Odoo task {ref}"
    return f"the new ticket ({ref})"


def ticket_labels(ids) -> dict:
    """Odoo task ids -> 'Ticket#N: short title' for messages people read; {} if Odoo is unreachable."""
    ids = sorted({i for i in ids if isinstance(i, int)})
    if not ids:
        return {}
    try:
        rows = Odoo().call("project.task", "read", ids, fields=["name", "x_task_number"])
    except Exception:
        return {}
    out = {}
    for r in rows:
        title = re.sub(r"^\d+:\s*", "", r.get("name") or "").strip()
        title = title if len(title) <= 60 else title[:57].rsplit(" ", 1)[0] + "..."
        num = r.get("x_task_number")
        out[str(r["id"])] = f"Ticket#{num} ({title})" if num else f"“{title}”"
    return out


def md_to_html(text: str) -> str:
    """Simple Markdown (## heading, - bullet, 1. step, blank-line paragraphs) to Odoo HTML. HTML input passes through."""
    if text.lstrip().startswith("<"):
        return text
    out, lst = [], None
    def close():
        nonlocal lst
        if lst:
            out.append(f"</{lst}>")
            lst = None
    for line in text.splitlines():
        t = line.strip()
        esc = lambda v: re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", html.escape(v, quote=False))
        if not t:
            close()
        elif t.startswith("#"):
            close()
            out.append(f"<h3>{esc(t.lstrip('#').strip())}</h3>")
        elif re.match(r"[-*] ", t):
            if lst != "ul":
                close(); out.append("<ul>"); lst = "ul"
            out.append(f"<li>{esc(t[2:])}</li>")
        elif re.match(r"\d+[.)] ", t):
            if lst != "ol":
                close(); out.append("<ol>"); lst = "ol"
            out.append(f"<li>{esc(t.split(' ', 1)[1])}</li>")
        else:
            close()
            out.append(f"<p>{esc(t)}</p>")
    close()
    return "".join(out)


def _plain(text: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", text or ""))).strip()


def describe_action(a: dict) -> str:
    """One plain sentence per change, as the owner reads it in Discord."""
    t = a["type"]
    if t == "create_task":
        where = a.get("project") or "the project"
        extra = [f"under {_task_label(a['parent'])}" if a.get("parent") else "",
                 f"in stage {a['stage']}" if a.get("stage") else ""]
        return f"Create a ticket in {where}: “{a['name']}”" + (f" ({', '.join(e for e in extra if e)})" if any(extra) else "")
    if t == "update_task":
        parts = [f"rename to “{a['name']}”" if a.get("name") else "",
                 "rewrite the description" if a.get("description") else "",
                 "archive it (duplicate)" if a.get("archive") else "",
                 f"move it under {_task_label(a['parent'])}" if a.get("parent") else "",
                 f"set milestone {a['milestone']}" if a.get("milestone") else "",
                 "assign it to you" if a.get("assign_me") else "",
                 "show it on the project board" if a.get("show_in_project") else ""]
        return f"{_task_label(a['task'])}: " + ", ".join(p for p in parts if p)
    if t == "timesheet":
        day = dt.date.fromisoformat(a["date"]).strftime("%a %d %b") if a.get("date") else ""
        return f"Log {a['hours']} h on {day} to {_task_label(a['task'])}" + (f" — {a['description']}" if a.get("description") else "")
    if t == "stage":
        return f"Move {_task_label(a['task'])} to {a['stage']}"
    if t == "note":
        body = _plain(a["body"])
        return f"Add a note to {_task_label(a['task'])}: “{body[:140]}{'...' if len(body) > 140 else ''}”"
    if t == "evidence":
        vids = sum(Path(f).suffix.lower() in (".mp4", ".webm", ".mov") for f in a["files"])
        other = len(a["files"]) - vids
        what = " and ".join(x for x in (f"{other} screenshot{'s' if other != 1 else ''}" if other else "",
                                        f"{vids} video{'s' if vids != 1 else ''}" if vids else "") if x)
        note = _plain(a.get("note", ""))
        return (f"Attach {what} to {_task_label(a['task'])} as test proof"
                + (f": {note[:160]}{'...' if len(note) > 160 else ''}" if note else ""))
    return f"Create the Odoo tag “{a['name']}”"


def cmd_propose(args, from_chat=False):
    if "--file" not in args:
        raise SystemExit("Usage: propose --file <proposal.json> [--from-chat]")
    spec = json.loads(Path(args[args.index("--file") + 1]).read_text(encoding="utf-8-sig"))
    actions = spec.get("actions") or []
    bad = [a for a in actions if a.get("type") not in ACTION_TYPES]
    if not actions or bad:
        raise SystemExit(f"Proposal needs actions of types {sorted(ACTION_TYPES)}; bad: {bad[:2]}")
    refs = {a["ref"] for a in actions if a["type"] == "create_task" and a.get("ref")}
    for a in actions:
        for k in ("task", "parent"):
            if isinstance(a.get(k), str) and a[k] not in refs:
                raise SystemExit(f"unknown task ref {a[k]!r}")
        if a["type"] == "create_task" and not (a.get("project") or a.get("project_id")):
            raise SystemExit(f"create_task {a.get('name')!r} needs project or project_id")
        if a["type"] == "evidence":
            if not a.get("task") or not a.get("files"):
                raise SystemExit("evidence needs task and files")
            if len(a["files"]) > EVIDENCE_MAX_FILES:
                raise SystemExit(f"evidence has {len(a['files'])} files; at most {EVIDENCE_MAX_FILES}. "
                                 "Keep only the shots that prove the ticket's steps (qa-evidence skill).")
            if len((a.get("note") or "").strip()) < 20:
                raise SystemExit("evidence needs a note saying what each file proves (qa-evidence skill)")
            seen = {}
            for f in a["files"]:
                p = local_path(f)
                if not p.is_file():
                    raise SystemExit(f"evidence file not found: {f}")
                if p.stat().st_size > EVIDENCE_MAX_BYTES:
                    raise SystemExit(f"evidence file over {EVIDENCE_MAX_BYTES // 2**20} MB: {f} (trim the recording)")
                digest = hashlib.sha256(p.read_bytes()).hexdigest()
                if digest in seen:
                    raise SystemExit(f"duplicate evidence: {Path(f).name} is the same file as {Path(seen[digest]).name}. "
                                     "Queue each shot once.")
                seen[digest] = f
    # A ticket moves to Testing (or Done) only together with the proof that it was verified on staging:
    # the evidence for that same ticket must be in this same proposal. Otherwise the QA engineer reopens it.
    proven = {a.get("task") for a in actions if a["type"] == "evidence"}
    unproven = [a.get("task") for a in actions if a["type"] == "stage"
                and re.search(r"testing|done", str(a.get("stage", "")), re.I) and a.get("task") not in proven]
    if unproven:
        raise SystemExit(f"refused: moving task(s) {', '.join(map(str, unproven))} to Testing/Done needs the test proof "
                         "for the same ticket in this proposal (an `evidence` action). Verify the ticket's own steps on "
                         "staging first (qa-evidence skill); notes are not proof.")
    pending = read_state("pending", [])
    # one evidence proposal per ticket: a second one (e.g. from a retried run) would attach the same proof twice
    queued = {a.get("task"): p["n"] for p in pending if p.get("kind") == "proposal"
              for a in p.get("actions", []) if a.get("type") == "evidence"}
    dup = [(a["task"], queued[a["task"]]) for a in actions if a["type"] == "evidence" and a.get("task") in queued]
    if dup:
        raise SystemExit("evidence for task " + ", ".join(f"{t} is already queued as proposal {n}" for t, n in dup)
                         + ". Do not queue it again; mention that proposal number in your summary.")
    # never reuse a number shown in Discord since the last digest: "approve 2" must mean one thing
    n = max([p.get("n", 0) for p in pending] + [read_state("last_n", 0)]) + 1
    write_state("last_n", n)
    item = {"kind": "proposal", "issue_id": f"proposal-{dt.datetime.now().strftime('%Y%m%d%H%M%S%f')}", "n": n,
            "title": spec.get("title") or "Odoo changes", "actions": actions, "posted": from_chat,
            "hours": sum(float(a.get("hours", 0)) for a in actions if a["type"] == "timesheet"), "stage": None}
    if spec.get("only_creator"):
        item["only_creator"] = spec["only_creator"]
    item["labels"] = ticket_labels([a.get(k) for a in actions for k in ("task", "parent")])
    write_state("pending", pending + [item])
    print(format_proposal(item))
    if any(a["type"] == "evidence" for a in actions):
        print(f"({post_evidence_to_discord(item)})")


def format_proposal(it: dict) -> str:
    _LABELS.clear(); _LABELS.update(it.get("labels") or {})
    count = len(it["actions"])
    lines = [f"📝 **Approval {it['n']}: {it['title']}**"
             + (f" ({count} changes" + (f", {it['hours']} h" if it["hours"] else "") + ")" if count > 1 else "")]
    if it.get("only_creator"):
        lines.append(f"Only tickets created by {it['only_creator']}.")
    lines += [f"• {describe_action(a)}" for a in it["actions"][:25]]
    if count > 25:
        lines.append(f"• ...and {count - 25} more")
    lines.append(f"Reply `approve {it['n']}` to apply this in Odoo, or `reject {it['n']}` to drop it.")
    return "\n".join(lines)


def relay_proposals() -> list[str]:
    pending = read_state("pending", [])
    out = [format_proposal(p) for p in pending if p.get("kind") == "proposal" and not p.get("posted")]
    if out:
        for p in pending:
            if p.get("kind") == "proposal":
                p["posted"] = True
        write_state("pending", pending)
    return out


def execute_proposal(odoo: Odoo, emp: int, it: dict, dry_run: bool) -> str:
    # same rule as at propose time, for proposals queued before it existed: no move to Testing/Done without proof
    _LABELS.clear(); _LABELS.update(it.get("labels") or {})
    proven = {a.get("task") for a in it["actions"] if a["type"] == "evidence"}
    unproven = [a.get("task") for a in it["actions"] if a["type"] == "stage"
                and re.search(r"testing|done", str(a.get("stage", "")), re.I) and a.get("task") not in proven]
    if unproven:
        raise SystemExit(f"Approval {it['n']} not applied: it moves {', '.join(_task_label(t) for t in unproven)} "
                         "to Testing/Done without test proof. Reject it; QA will verify those tickets and send proof first.")
    created, done = {}, []
    project_ids = {}

    def project_id(a):
        if a.get("project_id"):
            return int(a["project_id"])
        name = a["project"]
        if name not in project_ids:
            ids = odoo.call("project.project", "search", [["name", "=", name]], limit=2)
            if len(ids) != 1:
                raise SystemExit(f"Odoo project '{name}' not found exactly once")
            project_ids[name] = ids[0]
        return project_ids[name]

    def task_id(ref):
        return created.get(ref, ref) if isinstance(ref, str) else ref

    def milestone_id(value, pid):
        if isinstance(value, int):
            return value
        ids = odoo.call("project.milestone", "search", [["project_id", "=", pid], ["name", "=", value]], limit=2)
        if len(ids) != 1:
            raise SystemExit(f"milestone '{value}' not found exactly once in project {pid}")
        return ids[0]

    def task_project(tid):
        return odoo.call("project.task", "read", [tid], fields=["project_id"])[0]["project_id"][0]

    # "only_creator": every existing ticket the proposal touches must have been created by that user.
    # Checked before any write, so the proposal is applied whole or not at all.
    if it.get("only_creator"):
        ids = sorted({a["task"] for a in it["actions"] if isinstance(a.get("task"), int)})
        for row in odoo.call("project.task", "read", ids, fields=["create_uid"]) if ids else []:
            who = (row["create_uid"] or [0, "?"])[1]
            if who != it["only_creator"]:
                raise SystemExit(f"refused: task {row['id']} was created by {who}, not {it['only_creator']}; nothing was written")

    for a in it["actions"]:
        t = a["type"]
        if t == "create_tag":
            if not dry_run and not odoo.tag_id(a["name"]):
                odoo.call("project.tags", "create", {"name": a["name"]})
        elif t == "create_task":
            pid = project_id(a)
            vals = {"name": a["name"], "project_id": pid}
            if a.get("assign_me", True):
                vals["user_ids"] = [(6, 0, [odoo.uid])]
            if a.get("description"):
                vals["description"] = md_to_html(a["description"])
            if a.get("parent"):
                vals["parent_id"] = task_id(a["parent"])
                vals["display_in_project"] = True   # sub-tasks are hidden from the board otherwise
            if a.get("milestone"):
                vals["milestone_id"] = milestone_id(a["milestone"], pid)
            if a.get("stage"):
                sid = odoo.call("project.task.type", "search", [["name", "=", a["stage"]], ["project_ids", "in", [pid]]], limit=1)
                if sid:
                    vals["stage_id"] = sid[0]
            created[a.get("ref") or a["name"]] = 0 if dry_run else odoo.call("project.task", "create", vals)
        elif t == "update_task":
            tid = task_id(a["task"])
            if not dry_run:
                vals = {}
                if a.get("parent"):
                    vals["parent_id"] = task_id(a["parent"])
                if a.get("milestone"):
                    vals["milestone_id"] = milestone_id(a["milestone"], task_project(tid))
                if a.get("assign_me"):
                    vals["user_ids"] = [(4, odoo.uid)]
                if a.get("parent") or a.get("show_in_project"):
                    vals["display_in_project"] = True
                if a.get("name"):
                    vals["name"] = a["name"].strip()
                if a.get("description"):
                    vals["description"] = md_to_html(a["description"])
                if a.get("archive"):
                    cur = odoo.call("project.task", "read", [tid], fields=["effective_hours", "stage_id"])[0]
                    stage = (cur["stage_id"] or [0, ""])[1]
                    if cur.get("effective_hours") or any(k in stage for k in ("Doing", "Code Review", "Testing")):
                        raise SystemExit(f"refusing to archive task {tid}: it has timesheet hours or is in {stage}")
                    vals["active"] = False
                if vals:
                    odoo.call("project.task", "write", [tid], vals)
        elif t == "timesheet":
            tid = task_id(a["task"])
            if not dry_run:
                task = odoo.call("project.task", "read", [tid], fields=["project_id"])[0]
                odoo.call("account.analytic.line", "create", {
                    "date": a["date"], "employee_id": emp, "project_id": task["project_id"][0], "task_id": tid,
                    "unit_amount": float(a["hours"]), "name": a.get("description") or "/"})
        elif t == "stage":
            tid = task_id(a["task"])
            if not dry_run:
                pid = odoo.call("project.task", "read", [tid], fields=["project_id"])[0]["project_id"][0]
                sid = odoo.call("project.task.type", "search", [["name", "ilike", a["stage"]], ["project_ids", "in", [pid]]], limit=1)
                if not sid:
                    raise SystemExit(f"stage '{a['stage']}' not found for task {tid}")
                odoo.call("project.task", "write", [tid], {"stage_id": sid[0]})
        elif t == "note":
            if not dry_run:
                odoo.call("project.task", "message_post", [task_id(a["task"])], body=a["body"],
                          message_type="comment", subtype_xmlid="mail.mt_note")
        elif t == "evidence":
            tid = task_id(a["task"])
            if not dry_run:
                att = []
                for f in a["files"]:
                    p = local_path(f)
                    att.append(odoo.call("ir.attachment", "create", {
                        "name": p.name, "datas": base64.b64encode(p.read_bytes()).decode(), "res_model": "project.task",
                        "res_id": tid, "mimetype": mimetypes.guess_type(p.name)[0] or "application/octet-stream"}))
                odoo.call("project.task", "message_post", [tid], body=a.get("note") or "Test evidence",
                          attachment_ids=att, message_type="comment", subtype_xmlid="mail.mt_note")
        done.append(t)
    new = ", ".join(f"#{v}" for v in created.values() if v)
    return (f"✅ Approval {it['n']} applied in Odoo: {it['title']}" + (f" (new tickets: {new})" if new else "")
            if not dry_run else f"(dry run) Approval {it['n']}: {it['title']}, {len(done)} changes would be applied")


def cmd_edit(cfg, args, dry_run):
    items = select(args[0])
    if any(i.get("kind") == "proposal" for i in items):
        raise SystemExit("Proposals can't be edited; reject it and ask for a corrected one.")
    for kv in args[1:]:
        k, _, v = kv.partition("=")
        for it in items:
            if k == "hours":
                it["hours"] = float(v)
            elif k == "stage":
                it["stage"] = v.replace("_", " ")
    approve(cfg, items, dry_run)


def cmd_reject(cfg, args, dry_run):
    pc, items = Paperclip(cfg), select(args[0])
    reason = " ".join(args[1:]) or "Rejected in the daily digest."
    for it in items:
        if it.get("kind") == "proposal":
            print(f"{'(dry run) ' if dry_run else ''}❌ Approval {it['n']} dropped: {it['title']}. Nothing was changed in Odoo.")
            continue
        if not dry_run:
            pc.comment(it["issue_id"], f"**Board rejected this in the daily digest:** {reason}")
            pc.update_issue(it["issue_id"], {"status": "todo", "assigneeAgentId": cfg["manager_agent_id"]})
        print(f"{'(dry run) ' if dry_run else ''}❌ {it['n']}. Sent {it['identifier']} back to the Manager: {reason}")
    if not dry_run:
        drop_pending({it["issue_id"] for it in items})


def cmd_init(cfg):
    """Check Odoo + Paperclip access (read-only). A missing tag is queued as a proposal, never created here."""
    odoo, pc = Odoo(), Paperclip(cfg)
    emp = find_employee(odoo, cfg["timesheet_employee"])
    pc.issues()
    print(f"ok: Odoo uid {odoo.uid}, employee '{cfg['timesheet_employee']}' id {emp}, Paperclip reachable")
    if not odoo.tag_id(cfg["ready_tag"]):
        queued = any(p.get("kind") == "proposal" and p["title"] == "Setup: intake tag" for p in read_state("pending", []))
        if not queued:
            f = STATE_DIR / "setup-tag.json"
            STATE_DIR.mkdir(parents=True, exist_ok=True)
            f.write_text(json.dumps({"title": "Setup: intake tag", "actions": [{"type": "create_tag", "name": cfg["ready_tag"]}]}))
            cmd_propose(["--file", str(f)])
        print(f"Odoo tag {cfg['ready_tag']} is missing; approve the proposal in Discord to create it.")


# ---------- read-only Odoo helpers (JSON on stdout) for agents building proposals ----------

def cmd_odoo(args):
    """odoo projects | odoo project <id> | odoo tasks <project_id> [--mine] [--open] [--full] | odoo task <id> | odoo timesheets <from> [<to>] | odoo timeoff <from> [<to>]"""
    if not args:
        raise SystemExit(cmd_odoo.__doc__)
    odoo, sub = Odoo(), args[0]
    m2o = lambda v: v[1] if v else None
    if sub == "projects":
        out = odoo.call("project.project", "search_read", [["active", "=", True]], fields=["id", "name"], order="name")
    elif sub == "project":
        pid = int(args[1])
        proj = odoo.call("project.project", "read", [pid], fields=["name", "type_ids"])[0]
        out = {
            "id": pid, "name": proj["name"],
            "stages": [s["name"] for s in odoo.call("project.task.type", "read", proj["type_ids"], fields=["name", "sequence"])],
            "milestones": odoo.call("project.milestone", "search_read", [["project_id", "=", pid]],
                                    fields=["id", "name", "deadline", "is_reached"], order="deadline"),
            "main_tasks": [{"id": t["id"], "name": t["name"], "milestone": m2o(t["milestone_id"]), "stage": m2o(t["stage_id"]),
                            "subtasks": len(t["child_ids"])}
                           for t in odoo.call("project.task", "search_read", [["project_id", "=", pid], ["parent_id", "=", False]],
                                              fields=["id", "name", "milestone_id", "stage_id", "child_ids"], order="id desc", limit=300)
                           if t["child_ids"]],
        }
    elif sub == "task":
        t = odoo.call("project.task", "read", [int(args[1])],
                      fields=["name", "x_task_number", "stage_id", "milestone_id", "parent_id", "child_ids", "create_uid",
                              "effective_hours", "description", "display_in_project", "project_id", "active"])[0]
        kids = odoo.call("project.task", "read", t["child_ids"], fields=["name", "stage_id"]) if t["child_ids"] else []
        out = {"id": t["id"], "number": t.get("x_task_number"), "name": t["name"], "project": m2o(t["project_id"]),
               "stage": m2o(t["stage_id"]), "milestone": m2o(t["milestone_id"]),
               "parent": t["parent_id"][0] if t["parent_id"] else None, "parent_name": m2o(t["parent_id"]),
               "creator": m2o(t["create_uid"]), "hours": t["effective_hours"], "on_board": t["display_in_project"],
               "description": _plain(t["description"]),
               "children": [{"id": k["id"], "name": k["name"], "stage": m2o(k["stage_id"])} for k in kids]}
    elif sub == "tasks":
        dom = [["project_id", "=", int(args[1])]]
        if "--mine" in args:
            dom.append(["user_ids", "in", [odoo.uid]])
        if "--open" in args:
            dom.append(["stage_id.fold", "=", False])
        full = "--full" in args
        fields = ["id", "name", "stage_id", "milestone_id", "parent_id", "user_ids", "write_date"]
        if full:
            fields += ["x_task_number", "create_uid", "effective_hours", "description", "child_ids"]
        out = []
        for t in odoo.call("project.task", "search_read", dom, fields=fields, order="write_date desc", limit=500):
            row = {"id": t["id"], "name": t["name"], "stage": m2o(t["stage_id"]), "milestone": m2o(t["milestone_id"]),
                   "parent": t["parent_id"][0] if t["parent_id"] else None, "parent_name": m2o(t["parent_id"]),
                   "assignees": [u for u in t["user_ids"]], "updated": t["write_date"]}
            if full:
                d = _plain(t["description"])
                row.update({"number": t.get("x_task_number"), "creator": m2o(t["create_uid"]), "hours": t["effective_hours"],
                            "children": len(t["child_ids"]), "description_chars": len(d), "description_start": d[:160]})
            out.append(row)
    elif sub == "timesheets":
        cfg = load_config()
        emp = find_employee(odoo, cfg["timesheet_employee"])
        d_from, d_to = args[1], args[2] if len(args) > 2 else args[1]
        # time_off: lines Odoo writes for approved leave; they are not project work and do not count toward "already logged"
        out = [{"date": l["date"], "hours": l["unit_amount"], "project": m2o(l["project_id"]),
                "task_id": l["task_id"][0] if l["task_id"] else None, "task": m2o(l["task_id"]), "description": l["name"],
                "time_off": bool(l.get("holiday_id"))}
               for l in odoo.call("account.analytic.line", "search_read",
                                  [["employee_id", "=", emp], ["date", ">=", d_from], ["date", "<=", d_to]],
                                  fields=["date", "unit_amount", "project_id", "task_id", "name", "holiday_id"], order="date")]
    elif sub == "timeoff":
        cfg = load_config()
        emp = find_employee(odoo, cfg["timesheet_employee"])
        d_from, d_to = args[1], args[2] if len(args) > 2 else args[1]
        out = [{"from": l["request_date_from"], "to": l["request_date_to"], "type": m2o(l["holiday_status_id"]),
                "days": l["number_of_days"], "state": l["state"]}
               for l in odoo.call("hr.leave", "search_read",
                                  [["employee_id", "=", emp], ["request_date_from", "<=", d_to], ["request_date_to", ">=", d_from],
                                   ["state", "in", ["confirm", "validate1", "validate"]]],
                                  fields=["request_date_from", "request_date_to", "holiday_status_id", "number_of_days", "state"])]
    else:
        raise SystemExit(cmd_odoo.__doc__)
    print(json.dumps(out, indent=1, default=str))


# ---------- disk guard: WSL's disk file lives on this drive and goes read-only if the drive fills ----------

def cmd_diskguard(cfg):
    import shutil
    # Windows: C: holds WSL's disk file. macOS: the startup volume ("/") holds the agents' worktrees and Paperclip's DB.
    drive = cfg.get("disk_guard_drive") or ("C:\\" if IS_WINDOWS else "/")
    why = "so WSL's disk can't fill up and go read-only" if IS_WINDOWS else "so the disk can't fill up mid-run"
    cleanup = "Disk Cleanup, Docker images, the Android emulator" if IS_WINDOWS else "Docker images, Xcode DerivedData, simulators"
    low, high = float(cfg.get("disk_min_free_gb") or 4), float(cfg.get("disk_resume_free_gb") or 6)
    free = shutil.disk_usage(drive).free / 1024 ** 3
    st = read_state("diskguard", {})
    now = dt.datetime.now()
    pc = Paperclip(cfg)

    if not st.get("paused") and free < low:
        agents = [a for a in pc.agents() if a.get("status") not in ("paused", "terminated")]
        ids = {a["id"] for a in agents}
        active = [{"id": i["id"], "identifier": i.get("identifier"), "assignee": i.get("assigneeAgentId")}
                  for i in pc.issues() if i.get("assigneeAgentId") in ids and i.get("status") in ("todo", "in_progress")]
        # save the list BEFORE pausing: pausing takes ~20 s per agent and the cron job can be cut off midway;
        # a list saved afterwards was lost that way, and the agents were never resumed
        write_state("diskguard", {"paused": [a["id"] for a in agents], "issues": active,
                                  "at": now.isoformat(timespec="minutes"), "alerted": now.isoformat()})
        for a in agents:
            try:
                pc.pause(a["id"])
            except Exception as e:
                print(f"could not pause {a['id']}: {e}", file=sys.stderr)
        print(f"🛑 **Agents paused: low disk space.** {drive} has only {free:.1f} GB free (they need {low:g} GB). "
              f"{len(agents)} agents are paused {why}; {len(active)} tasks are waiting.\n"
              f"To do: free up space on {drive} ({cleanup}). They restart on their own above {high:g} GB "
              f"and pick up their tasks again.")
    elif st.get("paused") and free >= high:
        for aid in st["paused"]:
            try:
                pc.resume(aid)
            except Exception as e:  # an agent deleted meanwhile must not block the rest
                print(f"could not resume {aid}: {e}", file=sys.stderr)
        # confirm with Paperclip: a resume that timed out (WSL busy) must be retried next run, not forgotten
        try:
            still = {a["id"] for a in pc.agents() if a.get("status") == "paused"}
            failed = [aid for aid in st["paused"] if aid in still]
        except Exception as e:
            print(f"could not re-check agents: {e}", file=sys.stderr)
            failed = list(st["paused"])
        if failed:
            st["paused"] = failed
            write_state("diskguard", st)
            print(f"⚠️ {drive} has enough space again ({free:.1f} GB), but {len(failed)} agents did not restart yet. "
                  f"Retrying in a few minutes; nothing to do for now.")
            return
        restarted = 0
        for rec in st.get("issues", []):
            try:
                cur = pc.issue(rec["id"])
            except Exception:
                continue
            if cur and cur.get("status") == "blocked":
                pc.comment(rec["id"], "**Board:** this run was interrupted by the disk guard pausing the agents, not by a "
                                      "problem with the task. Start again from the beginning, following the description.")
                pc.update_issue(rec["id"], {"status": "todo", "assigneeAgentId": rec["assignee"]})
                restarted += 1
        write_state("diskguard", {})
        print(f"✅ **Agents are working again**: {drive} has {free:.1f} GB free. "
              f"{len(st['paused'])} agents resumed" + (f", {restarted} interrupted tasks restarted." if restarted else "."))
    elif st.get("paused"):
        last = dt.datetime.fromisoformat(st.get("alerted", st["at"]))
        if now - last >= dt.timedelta(hours=2):  # gentle reminder, not every 5 minutes
            st["alerted"] = now.isoformat()
            write_state("diskguard", st)
            when = dt.datetime.fromisoformat(st["at"]).strftime("%a %H:%M")
            print(f"🛑 **Agents are still paused** (since {when}): {drive} has {free:.1f} GB free and they need "
                  f"{high:g} GB to restart. Free up space ({cleanup}).")


# ---------- daily standup (read-only) ----------

MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "June", "July", "Aug", "Sept", "Oct", "Nov", "Dec"]


def _ordinal(n: int) -> str:
    return f"{n}{'th' if 11 <= n % 100 <= 13 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')}"


def cmd_standup(cfg):
    odoo = Odoo()
    emp = find_employee(odoo, cfg["timesheet_employee"])
    workdays = {int(d) for d in str(cfg.get("workdays", "0,1,2,3,4,5")).split(",")}  # Mon=0
    today = dt.date.today()
    prev = today - dt.timedelta(days=1)
    while prev.weekday() not in workdays:
        prev -= dt.timedelta(days=1)

    def group(rows):
        by_proj = {}
        for proj, tid, name in rows:
            entries = by_proj.setdefault(proj or "Other", [])
            if (tid, name) not in entries:
                entries.append((tid, name))
        return by_proj

    done_lines = odoo.call("account.analytic.line", "search_read", [["employee_id", "=", emp], ["date", "=", prev.isoformat()]],
                           fields=["project_id", "task_id", "name"], order="id")
    completed = group([(l["project_id"][1] if l["project_id"] else None, l["task_id"][0] if l["task_id"] else None,
                        l["task_id"][1] if l["task_id"] else l["name"]) for l in done_lines])

    active = [s.strip().lower() for s in cfg.get("standup_active_stages", "").split(",") if s.strip()]
    since = (today - dt.timedelta(days=int(cfg.get("standup_recent_days", 7)))).isoformat()
    mine = odoo.call("project.task", "search_read", [["user_ids", "in", [odoo.uid]], ["stage_id.fold", "=", False],
                                                     ["write_date", ">=", since]],
                     fields=["id", "name", "project_id", "stage_id"], order="write_date desc", limit=100)
    done_ids = {tid for rows in completed.values() for tid, _ in rows}
    working = group([(t["project_id"][1] if t["project_id"] else None, t["id"], t["name"]) for t in mine
                     if t["stage_id"] and t["stage_id"][1].strip().lower() in active and t["id"] not in done_ids][:12])
    blocked = group([(t["project_id"][1] if t["project_id"] else None, t["id"], t["name"]) for t in mine
                     if t["stage_id"] and re.search(r"block|on hold", t["stage_id"][1], re.I)])

    # "Ticket#N" uses Odoo's Task Number field when the database has one, else the task id
    all_ids = list({tid for g in (completed, working, blocked) for rows in g.values() for tid, _ in rows if tid})
    has_num = "x_task_number" in odoo.call("project.task", "fields_get", [], attributes=["type"])
    nums = {t["id"]: t["x_task_number"] for t in odoo.call("project.task", "read", all_ids, fields=["x_task_number"])} \
        if has_num and all_ids else {}
    multi = len({p for g in (completed, working, blocked) for p in g}) > 1

    def brief(name):
        """Short DSM wording: no task number, area prefix, quotes or detail; at most 8 words."""
        t = re.sub(r"^(\d+:\s*)+", "", name)
        t = re.sub(r"^(QA:\s*)?(Backend|Dashboard|Seller Dashboard|Mobile|App|Security|Docs|Infra|Web)\s*:\s*", "", t, flags=re.I)
        t = re.sub(r"\s*[(\[].*$", "", t).replace('"', "").strip(" .:-")
        if len(t.split()) <= 8:
            return t
        # prefer a natural break: "Topic: detail" -> "Topic", else the first clause
        head = re.split(r":\s+|\s+-\s+|,\s+", t)[0]
        if 2 <= len(head.split()) <= 8:
            return head
        words = t.split()[:8]
        while words and words[-1].lower() in {"and", "or", "the", "a", "an", "of", "to", "for", "with", "in", "on", "after", "when", "is", "are", "be", "its"}:
            words.pop()
        return " ".join(words)

    def tickets(nums_):
        refs = [f"Ticket#{n}" for n in nums_]
        return refs[0] if len(refs) == 1 else ", ".join(refs[:-1]) + " & " + refs[-1]

    def section(title, by_proj, empty):
        lines = [f"{title}: ", ""]
        if not by_proj:
            return lines + [f"* {empty}"]
        for proj, rows in by_proj.items():
            merged = {}  # same short wording -> one bullet with all its tickets
            for tid, name in rows:
                merged.setdefault(brief(name), []).append(nums.get(tid) or tid)
            for text, refs in merged.items():
                refs = [r for r in refs if r]
                lines.append(f"* {proj + ' ' if multi else ''}{text}{' ' + tickets(refs) if refs else ''}")
        return lines

    body = [f"{cfg.get('standup_title', 'DSM')} {_ordinal(today.day)} {MONTHS[today.month - 1]} {today.year}", "",
            cfg.get("standup_name", ""), ""]
    body += section("Completed", completed, f"No timesheets logged on {prev.strftime('%a %d %b')}") + ["", ""]
    body += section("Working on", working, "Nothing in an active stage") + ["", ""]
    body += section("Blocker", blocked, "None")
    print(f"**Standup ready** (completed = timesheets of {prev.strftime('%a %d %b')}). Copy:\n```\n" + "\n".join(body) + "\n```")


def cmd_pending(_cfg):
    items = read_state("pending", [])
    print("\n".join(format_proposal(p) if p.get("kind") == "proposal"
                    else f"{p['n']}. {p['title']}: {p['hours']}h, stage → {p['stage'] or 'unchanged'}"
                    for p in items) or "No pending items.")


def main(argv):
    load_env()
    cfg = load_config()
    dry = "--dry-run" in argv
    argv = [a for a in argv if a != "--dry-run"]
    if not argv:
        print(__doc__)
        return
    cmd, args = argv[0], argv[1:]
    if cmd == "intake":
        cmd_intake(cfg)
    elif cmd == "digest":
        cmd_digest(cfg)
    elif cmd == "approve":
        approve(cfg, select(" ".join(args)), dry)
    elif cmd == "edit":
        cmd_edit(cfg, args, dry)
    elif cmd == "reject":
        cmd_reject(cfg, args, dry)
    elif cmd == "pending":
        cmd_pending(cfg)
    elif cmd == "init":
        cmd_init(cfg)
    elif cmd == "questions":  # cron: relay new agent questions
        out = relay_questions(Paperclip(cfg))
        if out:
            print("\n\n".join(out))
    elif cmd == "proposals":  # cron: relay new Odoo change proposals
        out = relay_proposals()
        if out:
            print("\n\n".join(out))
    elif cmd == "standup":
        cmd_standup(cfg)
    elif cmd == "diskguard":
        cmd_diskguard(cfg)
    elif cmd == "odoo":
        cmd_odoo(args)
    elif cmd == "propose":
        cmd_propose([a for a in args if a != "--from-chat"], from_chat="--from-chat" in args)
    elif cmd == "answer":
        cmd_answer(cfg, args, dry)
    elif cmd == "newproject":
        cmd_newproject(cfg, args, dry)
    else:
        raise SystemExit(f"Unknown command {cmd}\n{__doc__}")


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    main(sys.argv[1:])
