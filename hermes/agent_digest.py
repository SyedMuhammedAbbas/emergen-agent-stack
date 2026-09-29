"""Cron entry: daily approval digest of agent work. See agent_ops.py."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import agent_ops  # noqa: E402

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
agent_ops.main(["digest"])
