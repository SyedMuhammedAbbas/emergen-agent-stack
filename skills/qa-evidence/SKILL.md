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

## What counts as proof (read before you queue anything)

The owner and the client open these files to see that the work is done correctly. A wrong, blocked or repeated image is worse than none: it makes the ticket look unverified. The proof set is small, correct and specific to this ticket.

1. **Plan the shots from the ticket, before capturing.** List the ticket's steps and its Expected Result. Each file must prove one of them; name it after that step (`01-addresses-list-has-back.png`, `02-back-returns-to-profile.png`). Usually 2-5 screenshots, plus at most one short recording when the fix is about motion or timing. Never more than 8 files.
2. **Capture in a working folder, then choose.** Capture into `_qa-evidence/Ticket#<n>/work/`. Copy only the chosen files into `_qa-evidence/Ticket#<n>/final/` and queue only `final/`. Clear `final/` before a new attempt so old files never mix in.
3. **Look at every file before it goes into `final/`.** Open each image (and scrub each video) and check:
   - it shows the screen the step names, on the build you tested;
   - nothing covers the content: no permission or system dialog, keyboard, lock screen, notification shade, loading spinner, black or white frame, error toast from something else;
   - it is about **this** ticket, not another ticket you tested in the same session;
   - it adds something the other files do not show.
   If a file fails any check, delete it. If the screen was blocked, remove the blocker (dismiss the dialog, wait for the load, unlock) and retake that one shot. Never take screenshots in a loop hoping one is good.
4. **No duplicates.** Identical or near-identical files (same screen, same state) are never queued twice. The bridge refuses a proposal whose files repeat.
5. **One evidence proposal per ticket, once.** If an earlier proposal for the ticket is still waiting, do not queue another (the bridge refuses it); mention its number instead. If the earlier proof was wrong, say so in your summary and ask the board to reject it first.
6. **The note explains the files.** One sentence on the build and what was done, then one line per file: `01: <what it proves>`. The owner must be able to understand each file without opening the ticket.
7. **The file must show what its name and note claim.** These were sent back by the owner:
   - a "result" shot taken while a button still says "Working…" or a spinner turns: wait until the action has finished and the result is on screen (the new row, the toast, the changed status), then take it;
   - a file named "confirm dialog on backdrop click" that shows no dialog;
   - "clamped to 400 characters" with no visible count or value: when the claim is a number, the number must be readable in the image (the counter, the field value, the status text);
   - a timing claim ("still showing at 9 s", "cleared after 8 s") proved by copies of the same frame: use one short recording with the timestamps in the note, or the device clock visible in each shot.
   - While capturing, if the screen shows something wrong that is not this ticket (text running outside a dialog, a cut-off button), report it as a new issue; do not crop around it.
   - proof of something the ticket does not ask: copy the ticket's **Expected Result** into your plan word for word and prove each part of it (for example "switches to Reminder set" **and** "still set after refresh"). A side effect you noticed is not the Expected Result.
   - a guessed cause for an odd measurement ("the emulator runs timers slower"): state what you measured and what the code sets, and leave the cause as an open point.
8. **Run the ticket's steps where the ticket says.** If the steps name a place that does not have the feature (Admin panel vs Seller Dashboard), ask the board before verifying it somewhere else.
9. **A failed or blocked check is not proof.** If you could not reach the screen or the result, queue nothing for that ticket: report NOT VERIFIED with the reason.

10. **A screen ticket needs screen proof.** If the ticket is about something a person sees (any Odoo title not starting with Backend:, DevOps: or Docs:), the proof must include at least one screenshot or recording of its steps. Logs, API calls, database reads or a search of the deployed code are never a substitute; if you have no browser or device this run, queue nothing and report NOT VERIFIED (no browser/device). The bridge refuses a move to Testing for a screen ticket without an image or video.

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
   "note": "Verified on staging build 12 (app a07cd18), ticket steps 1-3 as written.\n01: Block Seller asks to confirm before blocking.\n02: recording: after confirming, the buyer leaves the live stream and the seller's show is gone from Home.",
   "files": ["{{PROJECTS_ROOT}}/Emergen/NeuraX/_qa-evidence/Ticket#295/final/01-confirm-dialog.png",
             "{{PROJECTS_ROOT}}/Emergen/NeuraX/_qa-evidence/Ticket#295/final/02-leaves-stream.mp4"]},
  {"type": "stage", "task": 28020, "stage": "Testing"}
 ]}
```

- `task` is the Odoo task **id** (not the Ticket# number); get it with `"$PY" "$AO" odoo tasks <project_id> --open`.
- Add the `stage` action only for a ticket you **verified** under your Testing rule; the owner approves proof and stage move together. A ticket that is still broken gets evidence of the failure (no stage action) so the developer sees it.
- The `note` is one or two plain sentences: build tested, what you did, what you saw. No agent narrative.
- One proposal per ticket. Paste the proposal number the bridge prints into your run summary.

You never run `approve`, and you never write to Odoo yourself.
