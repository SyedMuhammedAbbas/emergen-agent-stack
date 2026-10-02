---
name: prd-scope-discipline
description: The PRD is the scope boundary for NuEraX. Anything it does not specify is a change request, however small, and must be surfaced and labelled as one instead of built. Use this whenever implementing, designing, planning, estimating or answering questions about a feature, and especially when a Figma frame, a competitor app, a client message, a "small convenience", or your own good idea suggests something the PRD does not say. Also use it when reporting what is or is not in scope, when a milestone question comes up, and when you notice a gap mid-task.
---

# PRD scope discipline

## The rule

The Web Dashboard PRD v3 and the Mobile Application Feature Document v3 define
what NuEraX is. Local copies:

- `D:\Projects\Emergen\NeuraX\docs\NueraX-Web-Dashboard-PRD-v3.md.docx`
- `D:\Projects\Emergen\NeuraX\docs\NueraX-Mobile-Application-Feature-Document-v3.md.docx`

Anything those two documents do not specify is a **change**, no matter how
small, and it gets named as one. Build the PRD. Surface everything else and
wait for the user to decide.

The user's words: *we don't do anything other than PRD unless I said so.*

## Why this matters more than it looks

This is a fixed-scope, milestone-billed build with a client on the other side.
Every unrequested addition costs three times: the build, the review, and the
conversation when someone asks why a screen does something nobody agreed to.
A "small convenience" that takes twenty minutes still moves the line of what
was delivered, and the client's own designers may then draw around it.

There is a second, subtler cost. Several PRD rules exist to protect an
invariant. Per-seller bid increments look harmless until you remember the
platform-wide tiers exist so bid logs stay comparable when a dispute is
reviewed. If you quietly implement the harmless-looking version, you have
removed a protection without anyone deciding to.

## What counts as a change

Assume yes if you are hesitating. Concretely:

- **A control drawn in Figma that the PRD does not describe.** The design file
  is not a spec. An editable Status field in a mock does not mean sellers may
  set status.
- **A field, endpoint, screen or state that is not in the PRD**, even one that
  seems obviously missing.
- **Extending who can do something.** The engine exists for staff; exposing it
  to sellers or buyers is new scope, not wiring.
- **Reversing or loosening a stated rule**, including making a platform-wide
  setting per-seller, or a per-auction value a stored default.
- **A convenience nobody asked for**: a remembered preference, an extra sort,
  a default that saves a tap.
- **Copy that asserts something the PRD does not**, such as a promise about
  timing, fees, or rights.
- **Anything needing data the API does not carry.** If the field does not
  exist, building the UI for it silently commits someone to adding it.

## What is not a change

Do not label these; just do them.

- Implementing what the PRD says, including the parts nobody has asked about.
- Fixing behaviour that contradicts the PRD, or a plain bug.
- The engineering standards in `docs/architecture`, especially doc 28's
  four-state screens, safe areas and accessibility floor, doc 06's API
  standards, and the invariants in `CLAUDE.md`. These are how the PRD gets
  built correctly, not additions to it. Where a design conflicts with them,
  the standard wins and that is worth one line in the report, not a change
  request.
- Anything the user has already authorised in this conversation.

## How to surface one

Name it in the moment, before building, in about three lines:

> **Change request, not in the PRD:** the seller Account screen wants a
> per-seller minimum bid increment.
> **The PRD says** increments are set platform-wide by the admin in price
> bands (3.14), so bid logs stay comparable across sellers in a dispute.
> **To do it** the PRD needs amending first. Say the word and it is small.

Three things make this useful rather than obstructive:

1. **Quote the PRD**, with the section. "It's not in scope" is an opinion until
   you show the line. If you cannot find the line, say that you could not, and
   do not assert either way.
2. **Say what it would take**, honestly. Most additions are small; saying so
   keeps this from reading as a refusal.
3. **Keep going.** Deliver everything that *is* in scope, and leave the change
   clearly marked. Do not stop the whole task over one flagged item, and do not
   build it while waiting for an answer.

## When you find one mid-task

Document it as a proposal and leave the code alone. `CLAUDE.md` already
requires this of every agent: *discovered problems are documented as proposals,
never fixed in-task.* A drive-by fix inside an unrelated change is the hardest
kind of scope creep to review, because it arrives disguised as something that
was approved.

## When the PRD is silent

Silence is a question, not permission. If the PRD does not cover a case you
genuinely have to decide in order to ship, say what you assumed and why, in one
line, so the user can overturn it cheaply. Reserve that for cases where you
truly cannot proceed; the rest wait for an answer.

Where the PRD is silent and a decision is needed, precedence runs: PRD, then
the engineering docs, then the design file, then competitor apps like Trofee
and Voggt as tiebreakers only.

## Reporting scope to the client

When answering what is or is not in scope, separate three things and never let
them blur:

1. **What the PRD says**, quoted.
2. **What is built**, checked in the code rather than remembered. Verify before
   asserting; a wrong "not built yet" understates the project and a wrong
   "already built" is worse.
3. **Whether the gap is a change or a schedule item.** Something specced but
   not yet delivered belongs to a milestone. Something unspecced is a change
   request. These are different answers and clients act on them differently.
