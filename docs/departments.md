# Departments

The factory's agents are grouped by department, one folder each under `org/`:

```
org/
  company.json            skills every agent gets, router settings
  _partials/              rules shared by every department ({{common}}, {{summary}})
  engineering/            Manager, CTO, Frontend, Backend, DevOps, SecOps, QA, UX, Docs, Estimator
    department.json       the department's agents: key, name, title, model, budget, skills, reporting line
    <key>.md              each agent's instructions (its role standard)
    _partials/            rules for this department only ({{eng-rules}})
    skills/               skills only this department uses (optional)
  operations/             Timekeeper, Watchdog (and the Hermes agent, added by connect-hermes)
  branding/               template, off by default: Brand Lead, Social Media Writer, Video Producer
```

`DEPARTMENTS` in `config.env` picks which departments a laptop installs (`engineering,operations` by default). Empty means every department whose `department.json` does not say `"enabled": false`.

Each agent's role standard is also installed as a `role-<key>` skill in Claude Code, so a person working without Paperclip follows the same standard.

## Turn on a department

1. Add it to `DEPARTMENTS` in your `config.env` (e.g. `engineering,operations,branding`).
2. Connect the tools its agents need (for branding: image or video generation and design connectors in Paperclip's Connectors page).
3. Re-apply: `.\install.ps1 -OnlyOrg` (Windows) or `./mac/install.sh --only-org` (macOS).

## Add a department

1. Copy `org/branding/` to `org/<key>/`.
2. Edit `department.json`: `key`, `name`, `description`, `head` (the agent everyone reports to), and the `agents` list. Agent `key`s must be unique across all departments. `reportsTo` can point to an agent in another department.
3. Write one `<key>.md` per agent. End each with `{{common}}` and `{{summary}}`; add department rules in `_partials/<name>.md` and include them with `{{<name>}}`.
4. Put department-only skills in `org/<key>/skills/<skill>/SKILL.md`; shared skills stay in `skills/`.
5. Open a pull request. After it is merged, teammates who want the department add it to `DEPARTMENTS` and re-apply.

## Change an agent

| Change | Edit |
|---|---|
| Model, budget, skills, reporting line | `org/<dept>/department.json` |
| Instructions | `org/<dept>/<key>.md` (shared parts in the `_partials/` folders) |
| A skill every agent gets | `org/company.json` `commonSkills` |

Then re-apply with `-OnlyOrg` / `--only-org`.
