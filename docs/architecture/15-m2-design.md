# 15. M2 design direction (Control App)

Status: **design pass for approval.** The clickable mockup is `apps/control-app/design/mockup/index.html` (open it through any static server, or `node` one-liner on a port; it needs no build). All numbers in it are **sample data**; the real app reads Paperclip, systemd and Windows. It uses the real crab sprites ported from `mods/paperclip-crew/hooks/crab.ts`.

## 1. Brief

- **Subject:** the owner's cockpit for a small company of AI agents running on one PC.
- **Audience:** one person, who looks at it for a few seconds at a time and acts when something is wrong.
- **The page's one job:** answer "is it running, what is it costing, what needs me?" before the person reads anything else.

## 2. Direction

1. **The hero is a sentence, not a wall of tiles.** "Everything is running. 2 things need you." or "OmniRoute has stopped. 3 things need you." The count links to the list. When WSL is down it says so in plain words and offers one button.
2. **Three zones on Home**, in this order: services (a strip of small tiles), needs-you beside spend, then the crew and recent activity. Nothing else.
3. **The crew is the signature.** The same pixel crabs as the Claude mod, with their hats, props and department colour. Walking means working, dim means idle, red means it needs attention, a pause mark means paused. One identity across the terminal and the app, and an agent is recognisable at a glance anywhere it appears (Home, Team, Activity, the detail panel).
4. **Status is shape plus word, never colour alone.** Running = filled circle, slow/attention = triangle, stopped/problem = square, on demand = hollow circle, not set up = dash. Colour only reinforces.
5. **Plain language.** Sentence case; buttons say what happens ("Restart", "Use the template", "Start WSL"); problems say what is affected and what is safe ("Nothing is lost").
6. **Confirm before anything that changes state**, in a dialog that states the effect ("2 agents are working; their tasks stay queued").

## 3. Tokens

| Role | Light | Dark |
|---|---|---|
| Background / surface | `#EDF0F3` / `#FFFFFF` | `#0E141A` / `#151D25` |
| Ink / secondary / muted | `#17212B` / `#47556A` / `#6B7888` | `#E7ECF1` / `#AEBBC8` / `#8190A0` |
| Line | `#D8DEE5` | `#27333F` |
| Brand accent (crab clay) | `#D97757` | same |
| Running / attention / problem / off | `#0B8A7B` / `#A8670A` / `#CC3B33` / `#8793A1` | `#2BC4AE` / `#E3AE45` / `#F27068` / `#7E8B99` |
| Department colours (from the mod) | Engineering `#4C8DF6`, Operations `#3B9C5F`, Branding `#E0609A`, Freelance `#F5A524` | same |

- **Buttons are ink**, not a brand colour; the only accent colour on the page is the clay of the crabs, plus a clay underline on the hero's count.
- **Department colours never mean status.** Two of them are close to the status colours (Operations green, Freelance amber), so department appears only as a small square, a left bar and the crab's hat/prop, and status always has its shape and word.
- Light is the default; dark follows the system and has a toggle. All text pairs were chosen for AA contrast on their backgrounds (⚠️ to be machine-checked in the audit before M2.1 ships).

## 4. Type

- **IBM Plex Sans** for text, **IBM Plex Mono** for every number, port, id and log line (tabular figures, so columns line up). Both are open-licence; **the app bundles the font files** so it works offline (the mockup loads them from Google Fonts for review only; it falls back to Segoe UI and Cascadia).
- Scale: 12 / 13 / 15 (body) / 20 / 24–34 (hero, fluid) / 30–42 (spend figure, mono). Section labels are small caps-style uppercase at 13 px.

## 5. Layout and responsiveness

| Width | Layout |
|---|---|
| ≥ 1100 px | 216 px left rail with labels; content up to 1180 px; Home has two columns for needs-you and spend |
| 700–1100 px | 68 px icon rail with a badge on Home; single column |
| < 700 px | No rail; bottom tab bar (Home, Services, Team, Cost, More); rows stack; side panel becomes full width |

Rules carried over from the wizard: grid tracks use `minmax(0,1fr)`; long names wrap anywhere; breakpoints are written last so they win. **Checked:** a script visits every screen in all three states at 375, 768 and 1280 px and reports any horizontal overflow or element past the edge: none found. (Overlap checking still needs the screenshot-based audit from `tools/setup-wizard/dev/ui-audit.js`.)

## 6. Screens in the mockup

Home, Services (rows with Start/Restart/Stop/Logs, a doctor, backups), Team (grouped by department; a side panel shows the field-level difference and "Use the template" for an agent whose live edit was kept), Cost (month total, API versus subscription, daily bars, by agent), Activity, Models. A "Design preview" control at the bottom switches between three states: all running, a service stopped, WSL down. It is a review aid and is not part of the product.

## 7. Accessibility and motion

Visible focus ring; every control reachable by keyboard; the hero is an `aria-live` region; crabs have text labels; icons are paired with words; the dialog is a native `<dialog>`; `prefers-reduced-motion` stops the crab walk and all transitions.

## 8. Critique, and what was rejected

| Idea | Verdict |
|---|---|
| A grid of equal cards with big traffic lights | Rejected: it is the generic admin template and buries the answer in the hero's single sentence |
| Cream paper with a serif and terracotta; near-black with one acid accent; newspaper hairlines | Avoided on purpose; the look is cool fog and ink, with the clay colour carried by the crab alone |
| Brand-coloured buttons | Rejected: ink buttons keep the crab as the only colourful object |
| A separate illustration set for agents | Rejected: reuse the mod's crabs |
| Live charts and animation on Home | Rejected for M2: one small meter and the crew is enough; more would compete with the sentence |

## 9. Not in the mockup (decided later)

Real data and errors; empty/first-run states; the Models editor; onboarding (M3); keyboard shortcuts; localisation. Behaviour of "Start WSL" and service control is specified in doc 14, not here.

## 10. What I need from you

1. Does the direction feel right: the sentence-first Home, the crew as the signature, ink buttons?
2. Anything on Home you expected and don't see, or that you'd drop?
3. Dark by system setting with a toggle (as now), or light always?
4. OK to bundle IBM Plex Sans and Mono?
