---
name: qa-evidence
description: Capture screenshots and screen recordings that prove an Odoo ticket is fixed, and queue them as an evidence proposal the owner approves in Discord before they are attached to the Odoo task. Use whenever QA verifies a ticket on a real build, device or browser, in any project.
---

# QA evidence

Every ticket you verify for the owner gets proof: screenshots of each reproduction step, and a short screen recording when the fix is about behaviour (navigation, timing, live updates). The proof is not written to Odoo by you. You queue an **evidence proposal**; the bridge posts the files to the approvals channel in Discord; the owner watches them and replies `approve <n>`; only then are they attached to the Odoo task with your note.

## Where files go

One folder per ticket, next to the project's repos (not inside a repo, never committed):

```
{{PROJECTS_ROOT}}/<Category>/<Project>/_qa-evidence/Ticket#<number>/
```

For example `{{PROJECTS_ROOT}}/Emergen/NeuraX/_qa-evidence/Ticket#295/`. Name files in step order with what they show: `01-confirm-dialog.png`, `02-left-stream.png`, `03-flow.mp4`.

## Capturing

Android (phone or emulator; wrap phone commands in the project's device lock if it has one):

```bash
ADB=/mnt/c/Users/$WINUSER/AppData/Local/Android/Sdk/platform-tools/adb.exe   # or adb on PATH
"$ADB" -s <serial> exec-out screencap -p > "$DIR/01-step.png"
"$ADB" -s <serial> shell screenrecord --time-limit 45 --bit-rate 4000000 /sdcard/qa.mp4   # runs in the foreground until done
"$ADB" -s <serial> pull /sdcard/qa.mp4 "$DIR/03-flow.mp4" && "$ADB" -s <serial> shell rm /sdcard/qa.mp4
```

Web dashboard: take browser screenshots of each step (full page where the result is below the fold). If your browser tool can record video, keep it under 60 s.

API-only tickets: save the request and response of each step as a `.txt` or `.json` file (`curl -s -i ... > "$DIR/01-refused.txt"`), with tokens and cookies removed.

Keep each file small: recordings 15-60 s at 4 Mbit/s (Discord shows files up to about 10 MB; larger ones are attached in Odoo only). Never capture secrets, real customer data, card numbers other than Stripe test cards, or OTP codes on screen.

## Queuing the evidence

Write a proposal file and queue it with the bridge (Windows Python called from WSL; quote the Windows path):

```bash
PY={{HERMES_PY}}
AO='{{AGENT_OPS}}'
"$PY" "$AO" propose --file '<windows path to evidence-ticket-295.json>'
```

```json
{"title": "Evidence: Ticket#295 Block Seller verified on staging build 12",
 "actions": [
  {"type": "evidence", "task": 28020,
   "note": "Verified on staging build 12 (app a07cd18): Block Seller asks to confirm, blocks, and takes the buyer out of the live stream. Steps 1-3 of the ticket followed as written.",
   "files": ["{{PROJECTS_ROOT}}/Emergen/NeuraX/_qa-evidence/Ticket#295/01-confirm-dialog.png",
             "{{PROJECTS_ROOT}}/Emergen/NeuraX/_qa-evidence/Ticket#295/03-flow.mp4"]},
  {"type": "stage", "task": 28020, "stage": "Testing"}
 ]}
```

- `task` is the Odoo task **id** (not the Ticket# number); get it with `"$PY" "$AO" odoo tasks <project_id> --open`.
- Add the `stage` action only for a ticket you **verified** under your Testing rule; the owner approves proof and stage move together. A ticket that is still broken gets evidence of the failure (no stage action) so the developer sees it.
- The `note` is one or two plain sentences: build tested, what you did, what you saw. No agent narrative.
- One proposal per ticket. Paste the proposal number the bridge prints into your run summary.

You never run `approve`, and you never write to Odoo yourself.
