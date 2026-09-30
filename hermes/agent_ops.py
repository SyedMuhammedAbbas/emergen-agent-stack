"""Agent ops: Odoo <-> Paperclip bridge for Hermes.

Subcommands
  init                        Check Odoo/Paperclip access and create the Odoo tags if missing
  intake                     Odoo tasks tagged agent-ready -> Paperclip issues (assigned to Manager)
  digest                      Build the daily approval digest from agents' "Run summary" comments
  approve 1,3                 Write timesheets / stage / chatter to Odoo for digest items
  edit 2 hours=1.5 [stage=X]  Adjust an item, then approve it
  reject 4 [reason...]        Send an item back to the Manager in Paperclip
  pending                     Show items still awaiting a decision
  answer EME-12 <text>        Reply to an agent's "Question for board"
  newproject <name> --file f  New client requirements -> Estimator (or pipe text on stdin)

Add --dry-run to approve/edit/reject to print what would happen without writing.
Nothing is written to Odoo except by approve/edit.
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
    "synced_tag": "agent-synced",
    "timesheet_employee": "",
    # Odoo project name -> Paperclip project id (fill in once repos are attached)
    "project_map": {},
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
    odoo, pc = Odoo(), Paperclip(cfg)
    ready, synced = odoo.tag_id(cfg["ready_tag"]), odoo.tag_id(cfg["synced_tag"])
    if not ready or not synced:
        raise SystemExit("Odoo tags agent-ready / agent-synced not found")
    tasks = odoo.call("project.task", "search_read",
                      [["tag_ids", "in", [ready]], ["tag_ids", "not in", [synced]]],
                      fields=["id", "name", "description", "project_id", "stage_id", "date_deadline", "priority"],
                      limit=20)
    existing = {i.get("billingCode") for i in pc.issues()}
    lines = []
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
            if project in cfg["project_map"]:
                body["projectId"] = cfg["project_map"][project]
            issue = pc.create_issue(body)
            ident = issue.get("identifier") or issue.get("id")
        else:
            ident = "already in Paperclip"
        odoo.call("project.task", "write", [t["id"]], {"tag_ids": [(4, synced)]})
        odoo.call("project.task", "message_post", [t["id"]],
                  body=f"Handed to the AI engineering agents (Paperclip {ident}).",
                  message_type="comment", subtype_xmlid="mail.mt_note")
        lines.append(f"• {code} {t['name']} → Paperclip {ident}")
    lines += relay_questions(pc)
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
    write_state("pending", items)
    write_state("last_digest", {"at": now.isoformat()})

    if not items:
        print("**Agent digest**: no agent work to approve today.")
        return
    date = now.astimezone().strftime("%a %d %b")  # local time
    out = [f"**Agent digest, {date}** ({len(items)} item{'s' if len(items) != 1 else ''})"]
    for it in items:
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
    for it in items:
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


def cmd_edit(cfg, args, dry_run):
    items = select(args[0])
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
        if not dry_run:
            pc.comment(it["issue_id"], f"**Board rejected this in the daily digest:** {reason}")
            pc.update_issue(it["issue_id"], {"status": "todo", "assigneeAgentId": cfg["manager_agent_id"]})
        print(f"{'(dry run) ' if dry_run else ''}❌ {it['n']}. {it['identifier']} sent back to Manager: {reason}")
    if not dry_run:
        drop_pending({it["issue_id"] for it in items})


def cmd_init(cfg):
    """Check Odoo + Paperclip access, create the Odoo tags if missing, resolve the timesheet employee."""
    odoo, pc = Odoo(), Paperclip(cfg)
    for tag in (cfg["ready_tag"], cfg["synced_tag"]):
        if not odoo.tag_id(tag):
            odoo.call("project.tags", "create", {"name": tag})
            print(f"created Odoo tag {tag}")
    emp = find_employee(odoo, cfg["timesheet_employee"])
    pc.issues()
    print(f"ok: Odoo uid {odoo.uid}, employee '{cfg['timesheet_employee']}' id {emp}, Paperclip reachable")


def cmd_pending(_cfg):
    items = read_state("pending", [])
    print("\n".join(f"{p['n']}. {p['title']}: {p['hours']}h, stage → {p['stage'] or 'unchanged'}"
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
