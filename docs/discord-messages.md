# Discord messages: the standard

Everything the factory posts in Discord is read by the owner, often on a phone, without Paperclip or Odoo open. Every message must make sense on its own and say what, if anything, the owner has to do. This applies to every project and every channel, whoever produces the text: the bridge (`hermes/agent_ops.py`), Hermes itself, or an agent whose words are relayed.

## Rules for every message

1. **Lead with what it is and whether action is needed.** One emoji and a bold headline: 📝 approval needed, ❓ question, 📋 digest, 📥 new work, ✅ done, ❌ dropped, 🛑 blocked, ⚠️ warning.
2. **Name things the way people know them.** Tickets as `Ticket#291 (Rerun and Abandon in Failed Payments)`, never Odoo database ids (`#27967`, `ODOO-27967`). Agent tasks as `EME-12` only alongside a plain title. Features by what the user sees ("Remind Me button"), not code names.
3. **No internals.** No file paths, commit hashes, API routes, env vars, error codes, run ids, JSON or stack traces. If a technical detail matters, say what it means ("the app could not reach the server").
4. **Short.** One line per item; a message fits on a phone screen. Long detail stays in Paperclip or Odoo and the message says where.
5. **Plain verbs.** "Log 1.5 h on Tue 06 Oct to Ticket#291", "Move Ticket#298 to Testing", "Attach 2 screenshots and 1 video as test proof".
6. **End with the exact reply** when an answer is expected: `approve 3`, `reject 3`, `answer EME-12 <your answer>`.
7. **Dates and times** in the owner's local time and words: "Mon 05 Oct, 18:30". Hours as `1.5 h`.

## By channel

| Channel | What is posted | Shape |
|---|---|---|
| #approvals | Odoo change proposals, test evidence, daily digest, timesheets | `📝 **Approval N: <what it is>** (k changes, h)` then one plain bullet per change, then `Reply approve N / reject N` |
| #agent-questions | Agent questions, low-disk alerts | `❓ **<Agent> needs a decision** on EME-12: <title>`, the question in at most 6 lines with options and a recommendation, then `answer EME-12 <your answer>` |
| #standup | Daily standup text to copy | The company DSM format, ready to paste, nothing else |
| #agent-activity | New work picked up, merges, notable progress | `📥` / `✅` headline + one line per item |
| #new-projects | New project intake and estimates | What was received, what the Estimator will produce, and when |

## Examples

Not this:
```
📝 2. Proposed Odoo changes: NeuraX tickets 2/3 (20 changes)
   • task #28309: show on project board
```
This:
```
📝 Approval 2: Show 20 hidden tickets on the NeuraX board (20 changes)
• Ticket#316 (Backend: restrict stream cover upload to the seller's own image): show it on the project board
Reply `approve 2` to apply this in Odoo, or `reject 2` to drop it.
```

Not this:
```
❓ EME-39 ... Re-checked nuerax-web PR #1 live via gh pr view: still OPEN, mergedAt null, monitorNextCheckAt ...
```
This:
```
❓ Manager needs a decision on EME-39: Share buttons
Can we publish the share pages on nuerax.io now, without the final image and the Play fingerprint?
- Options: A) publish now and add those later B) wait for them. I recommend A.
To answer, reply: answer EME-39 <your answer>
```

## Where it is enforced

- Bridge message formats: `hermes/agent_ops.py` (`format_proposal`, `describe_action`, `format_question`, digest, disk guard).
- Agents: `org/_partials/common.md` ("Writing for the owner").
- Hermes's own replies: `hermes/agent-ops/SKILL.md` ("How you write in Discord").
