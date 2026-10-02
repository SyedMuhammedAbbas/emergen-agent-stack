"""Create (or find) the Agent Ops Discord channels with Hermes's bot and print their ids as KEY=value lines.

Needs the bot to have "Manage Channels" in the server. Idempotent: existing channels with the same name are reused.
Usage: python discord_setup.py <guild_id>
"""
import json
import os
import sys
import urllib.error
import urllib.request

_home = os.environ.get("HERMES_HOME") or (os.path.join(os.environ["LOCALAPPDATA"], "hermes") if os.environ.get("LOCALAPPDATA")
                                          else os.path.join(os.path.expanduser("~"), ".hermes"))  # macOS: ~/.hermes
sys.path.insert(0, os.path.join(_home, "scripts"))
import agent_ops  # noqa: E402

CATEGORY = "Agent Ops"
CHANNELS = [  # (config key, name, topic)
    ("DISCORD_APPROVALS_CHANNEL_ID", "approvals",
     "Daily digest, timesheet and Odoo change proposals. Reply: approve 1,2 / edit 2 hours=1.5 / reject 3 <reason>. Nothing reaches Odoo without an approve here."),
    ("DISCORD_QUESTIONS_CHANNEL_ID", "agent-questions",
     "Questions from the AI agents. Reply: answer EME-12 <your answer>."),
    ("DISCORD_STANDUP_CHANNEL_ID", "standup",
     "Daily standup (DSM) at 11:30, ready to copy: completed, working on, blockers with ticket ids."),
    ("DISCORD_ACTIVITY_CHANNEL_ID", "agent-activity",
     "Odoo tickets picked up by the agents and other status notices. Read-only."),
    ("DISCORD_NEWPROJECT_CHANNEL_ID", "new-projects",
     "Post: new project: <name> followed by the client's requirements (text or files). The Estimator takes it from there."),
]


def api(method, path, body=None):
    req = urllib.request.Request("https://discord.com/api/v10" + path, method=method,
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Authorization": f"Bot {os.environ['DISCORD_BOT_TOKEN']}",
                                          "Content-Type": "application/json", "User-Agent": "agent-stack (setup, 1.0)"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        if e.code == 403:
            sys.exit("Discord refused (403): give the bot the 'Manage Channels' permission in this server, then re-run.")
        raise


def main():
    agent_ops.load_env()
    guild = sys.argv[1]
    existing = api("GET", f"/guilds/{guild}/channels")
    cat = next((c for c in existing if c["type"] == 4 and c["name"].lower() == CATEGORY.lower()), None)
    if not cat:
        cat = api("POST", f"/guilds/{guild}/channels", {"name": CATEGORY, "type": 4})
        print(f"# created category {CATEGORY}", file=sys.stderr)
    for key, name, topic in CHANNELS:
        ch = next((c for c in existing if c["type"] == 0 and c["name"] == name), None)
        if not ch:
            ch = api("POST", f"/guilds/{guild}/channels", {"name": name, "type": 0, "parent_id": cat["id"], "topic": topic})
            print(f"# created #{name}", file=sys.stderr)
        elif ch.get("parent_id") != cat["id"]:
            api("PATCH", f"/channels/{ch['id']}", {"parent_id": cat["id"]})
            print(f"# moved #{name} into {CATEGORY}", file=sys.stderr)
        print(f"{key}={ch['id']}")


if __name__ == "__main__":
    main()
