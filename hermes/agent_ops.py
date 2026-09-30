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

import datetime as dt
import html
import json
import os
import re
import sys
import urllib.request
import xmlrpc.client
from pathlib import Path

HERMES_HOME = Path(os.environ.get("HERMES_HOME") or Path(os.environ["LOCALAPPDATA"]) / "hermes")
STATE_DIR = HERMES_HOME / "state" / "agent_ops"
CONFIG_FILE = HERMES_HOME / "scripts" / "agent_ops.config.json"

# Instance values (ids, employee) come from agent_ops.config.json, written by windows/hermes-bridge.ps1.
DEFAULT_CONFIG = {
    "paperclip_api": "http://localhost:3100/api",
    "company_id": "",
    "manager_agent_id": "",
    "estimator_agent_id": "",
    "ready_tag": "agent-ready",
    "timesheet_employee": "",
    # Odoo project id (or name) -> Paperclip project id; written by connect-project.ps1
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
        raise SystemExit(f"{CONFIG_FILE} is missing {', '.join(missing)}. Re-run windows/hermes-bridge.ps1.")
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
        return self._req("GET", f"/companies/{self.cid}/issues") or []

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
                          fields=["id", "name", "description", "project_id", "stage_id", "date_deadline", "priority", "parent_id"],
                          limit=50)
        tasks.sort(key=lambda t: bool(t["parent_id"]))  # main tasks first, so sub-tasks can nest under them
    issues = pc.issues()
    existing = {i.get("billingCode") for i in issues}  # dedupe on the Paperclip side
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
            lines.append(f"• {code} {t['name']} → Paperclip {issue.get('identifier') or issue.get('id')}")
    if lines:  # empty stdout = silent run
        print("**Agent intake**\n" + "\n".join(lines))


def relay_questions(pc: "Paperclip") -> list[str]:
    """Surface agent comments starting with 'Question for board' that weren't relayed yet."""
    relayed = set(read_state("relayed_questions", []))
    out = []
    for issue in pc.issues():
        if issue.get("status") in ("done", "cancelled"):
            continue
        for c in pc.comments(issue["id"]):
            body = c.get("body") or ""
            if c["id"] in relayed or c.get("authorType") != "agent" or "question for board" not in body.lower():
                continue
            relayed.add(c["id"])
            q = re.sub(r"\*\*|__", "", body).strip()[:900]
            out.append(f"❓ **{issue.get('identifier')}** {issue.get('title')}\n{q}\n"
                       f"Reply here with `answer {issue.get('identifier')} <your answer>`")
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
    print(f"{'(dry run) ' if dry_run else ''}Answered {issue.get('identifier')}: {text}")


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
        summaries = []
        for c in sorted(pc.comments(issue["id"]), key=lambda c: c["createdAt"]):
            created = dt.datetime.fromisoformat(c["createdAt"].replace("Z", "+00:00"))
            if created > since and (s := parse_summary(c.get("body", ""))):
                summaries.append(s)
        if not summaries:
            continue
        item = pending.get(issue["id"], {
            "issue_id": issue["id"], "identifier": issue.get("identifier"),
            "odoo_task_id": int(m.group(1)), "title": issue["title"],
            "hours": 0.0, "changed": [], "pr": None, "qa": None, "stage": None,
        })
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
    for n, it in enumerate(items, 1):
        it["n"] = n
        if it.get("kind") == "proposal":
            it["posted"] = True
    write_state("pending", items)
    write_state("last_digest", {"at": now.isoformat()})

    if not items:
        print("**Agent digest**: no agent work to approve today.")
        return
    date = now.astimezone().strftime("%a %d %b")  # local time
    out = [f"**Agent digest, {date}** ({len(items)} item{'s' if len(items) != 1 else ''})"]
    for it in items:
        if it.get("kind") == "proposal":  # renumbered above, so always re-show it
            out.append("\n" + format_proposal(it))
            continue
        changed = "; ".join(it["changed"][-3:])[:300] or "-"
        out.append(
            f"\n**{it['n']}. {it['title']}** ({it['identifier']}, status {it.get('status')})\n"
            f"   {changed}\n"
            f"   PR: {it['pr'] or '-'} | QA: {it['qa'] or '-'} | Hours: {it['hours']} | Stage → {it['stage'] or 'unchanged'}"
        )
    out.append("\nReply: `approve 1,2` · `edit 2 hours=1.5 stage=Testing` · `reject 3 <reason>`. "
               "Nothing is written to Odoo until you approve.")
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
                    "unit_amount": it["hours"], "date": today,
                    "name": f"AI agents: {'; '.join(it['changed'][-2:])[:200] or it['title']}"}
            if not dry_run:
                odoo.call("account.analytic.line", "create", vals)
            actions.append(f"{it['hours']}h timesheet")
        if it.get("stage") and project_id:
            sid = odoo.call("project.task.type", "search",
                            [["name", "ilike", it["stage"]], ["project_ids", "in", [project_id]]], limit=1)
            if sid:
                if not dry_run:
                    odoo.call("project.task", "write", [it["odoo_task_id"]], {"stage_id": sid[0]})
                actions.append(f"stage → {it['stage']}")
            else:
                actions.append(f"stage '{it['stage']}' not found, left unchanged")
        note = (f"AI agent work approved: {'; '.join(it['changed'][-3:])[:500]}<br/>"
                f"PR: {it['pr'] or '-'} · QA: {it['qa'] or '-'} · Paperclip {it['identifier']}")
        if not dry_run:
            odoo.call("project.task", "message_post", [it["odoo_task_id"]], body=note,
                      message_type="comment", subtype_xmlid="mail.mt_note")
        actions.append("chatter note")
        done.add(it["issue_id"])
        lines.append(f"✅ {it['n']}. ODOO-{it['odoo_task_id']}: {', '.join(actions)}")
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
#   {"type": "create_tag", "name": "agent-ready"}]}
# "task"/"parent" may be an Odoo task id or the "ref" of a create_task earlier in the same proposal.
# "project" (name) or "project_id"; "milestone" by id or exact name. New tasks are assigned to the bridge's
# Odoo user (you) unless "assign_me": false.

ACTION_TYPES = {"create_task", "update_task", "timesheet", "stage", "note", "create_tag"}


def _task_label(ref) -> str:
    return f"#{ref}" if isinstance(ref, int) else f"new task {ref}"


def describe_action(a: dict) -> str:
    t = a["type"]
    if t == "create_task":
        extra = [f"under {_task_label(a['parent'])}" if a.get("parent") else "",
                 f"milestone {a['milestone']}" if a.get("milestone") else "", a.get("stage") or ""]
        where = a.get("project") or f"project {a.get('project_id')}"
        return f"new task {a.get('ref', '')} in {where}: {a['name']} ({', '.join(e for e in extra if e) or 'defaults'})"
    if t == "update_task":
        parts = [f"parent → {_task_label(a['parent'])}" if a.get("parent") else "",
                 f"milestone → {a['milestone']}" if a.get("milestone") else "", "assign me" if a.get("assign_me") else ""]
        return f"task {_task_label(a['task'])}: {', '.join(p for p in parts if p)}"
    if t == "timesheet":
        return f"{a['date']}  {a['hours']}h on {_task_label(a['task'])}: {a.get('description', '')}"
    if t == "stage":
        return f"task {_task_label(a['task'])} stage → {a['stage']}"
    if t == "note":
        return f"note on task {_task_label(a['task'])}: {a['body'][:120]}"
    return f"create Odoo tag {a['name']}"


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
    pending = read_state("pending", [])
    n = max([p.get("n", 0) for p in pending] + [0]) + 1
    item = {"kind": "proposal", "issue_id": f"proposal-{dt.datetime.now().strftime('%Y%m%d%H%M%S%f')}", "n": n,
            "title": spec.get("title") or "Odoo changes", "actions": actions, "posted": from_chat,
            "hours": sum(float(a.get("hours", 0)) for a in actions if a["type"] == "timesheet"), "stage": None}
    write_state("pending", pending + [item])
    print(format_proposal(item))


def format_proposal(it: dict) -> str:
    lines = [f"📝 **{it['n']}. Proposed Odoo changes: {it['title']}** ({len(it['actions'])} change{'s' if len(it['actions']) != 1 else ''}"
             + (f", {it['hours']}h" if it["hours"] else "") + ")"]
    lines += [f"   • {describe_action(a)}" for a in it["actions"][:25]]
    if len(it["actions"]) > 25:
        lines.append(f"   • ... and {len(it['actions']) - 25} more")
    lines.append(f"Reply `approve {it['n']}` to write these to Odoo, or `reject {it['n']}`.")
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
                vals["description"] = a["description"]
            if a.get("parent"):
                vals["parent_id"] = task_id(a["parent"])
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
        done.append(t)
    new = ", ".join(f"#{v}" for v in created.values() if v)
    return (f"✅ {it['n']}. {it['title']}: {len(done)} changes written" + (f" (new tasks {new})" if new else "")
            if not dry_run else f"{it['n']}. {it['title']}: {len(done)} changes would be written")


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
            print(f"{'(dry run) ' if dry_run else ''}❌ {it['n']}. proposal '{it['title']}' discarded, nothing written")
            continue
        if not dry_run:
            pc.comment(it["issue_id"], f"**Board rejected this in the daily digest:** {reason}")
            pc.update_issue(it["issue_id"], {"status": "todo", "assigneeAgentId": cfg["manager_agent_id"]})
        print(f"{'(dry run) ' if dry_run else ''}❌ {it['n']}. {it['identifier']} sent back to Manager: {reason}")
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
    """odoo projects | odoo project <id> | odoo tasks <project_id> [--mine] [--open] | odoo timesheets <from> [<to>]"""
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
    elif sub == "tasks":
        dom = [["project_id", "=", int(args[1])]]
        if "--mine" in args:
            dom.append(["user_ids", "in", [odoo.uid]])
        if "--open" in args:
            dom.append(["stage_id.fold", "=", False])
        out = [{"id": t["id"], "name": t["name"], "stage": m2o(t["stage_id"]), "milestone": m2o(t["milestone_id"]),
                "parent": t["parent_id"][0] if t["parent_id"] else None, "parent_name": m2o(t["parent_id"]),
                "assignees": [u for u in t["user_ids"]], "updated": t["write_date"]}
               for t in odoo.call("project.task", "search_read", dom,
                                  fields=["id", "name", "stage_id", "milestone_id", "parent_id", "user_ids", "write_date"],
                                  order="write_date desc", limit=300)]
    elif sub == "timesheets":
        cfg = load_config()
        emp = find_employee(odoo, cfg["timesheet_employee"])
        d_from, d_to = args[1], args[2] if len(args) > 2 else args[1]
        out = [{"date": l["date"], "hours": l["unit_amount"], "project": m2o(l["project_id"]),
                "task_id": l["task_id"][0] if l["task_id"] else None, "task": m2o(l["task_id"]), "description": l["name"]}
               for l in odoo.call("account.analytic.line", "search_read",
                                  [["employee_id", "=", emp], ["date", ">=", d_from], ["date", "<=", d_to]],
                                  fields=["date", "unit_amount", "project_id", "task_id", "name"], order="date")]
    else:
        raise SystemExit(cmd_odoo.__doc__)
    print(json.dumps(out, indent=1, default=str))


# ---------- disk guard: WSL's disk file lives on this drive and goes read-only if the drive fills ----------

def cmd_diskguard(cfg):
    import shutil
    drive = cfg.get("disk_guard_drive") or "C:\\"
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
        for a in agents:
            pc.pause(a["id"])
        write_state("diskguard", {"paused": [a["id"] for a in agents], "issues": active,
                                  "at": now.isoformat(timespec="minutes"), "alerted": now.isoformat()})
        print(f"🛑 **Disk guard: {drive} has {free:.1f} GB free** (limit {low:g} GB). Paused {len(agents)} agents "
              f"({len(active)} tasks waiting) so WSL's disk can't fill up and go read-only.\n"
              f"Free space on {drive} (Disk Cleanup, Docker images, the Android emulator). Agents resume automatically "
              f"above {high:g} GB, and their interrupted tasks restart.")
    elif st.get("paused") and free >= high:
        for aid in st["paused"]:
            try:
                pc.resume(aid)
            except Exception as e:  # an agent deleted meanwhile must not block the rest
                print(f"could not resume {aid}: {e}", file=sys.stderr)
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
        print(f"✅ **Disk guard: {drive} has {free:.1f} GB free.** Resumed {len(st['paused'])} agents and restarted {restarted} interrupted tasks.")
    elif st.get("paused"):
        last = dt.datetime.fromisoformat(st.get("alerted", st["at"]))
        if now - last >= dt.timedelta(hours=2):  # gentle reminder, not every 5 minutes
            st["alerted"] = now.isoformat()
            write_state("diskguard", st)
            print(f"🛑 Disk guard: agents still paused since {st['at']}; {drive} has {free:.1f} GB free, "
                  f"needs {high:g} GB to resume.")


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

    def section(title, by_proj, empty):
        lines = [f"{title}:"]
        if not by_proj:
            return lines + [empty]
        for proj, rows in by_proj.items():
            lines.append(f"{proj}:")
            lines += [f"- #{tid} {name}" if tid else f"- {name}" for tid, name in rows]
        return lines

    body = [f"{cfg.get('standup_title', 'DSM')} {_ordinal(today.day)} {MONTHS[today.month - 1]} {today.year}", "",
            cfg.get("standup_name", ""), ""]
    body += section("Completed", completed, f"No timesheets logged on {prev.strftime('%a %d %b')}.") + [""]
    body += section("Working on", working, "Nothing in an active stage.") + [""]
    body += section("Blockers", blocked, "None")
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
