---
name: emergen-no-slop
description: Anti-hallucination and anti-AI-slop rules for all code, comments, commit messages, PR descriptions, docs and client-facing text at Emergen. Use on every task that writes anything a human will read.
---

# Emergen No-Slop Standard

Everything you write must read like it came from a careful senior engineer, not a chatbot. These rules apply to code, comments, docs, commit messages, PR descriptions, issue comments and client deliverables.

## 1. No hallucination

- **Verify before you claim.** Never state that a file, function, API, flag, package version, endpoint or config key exists unless you opened it, ran it, or read it in official docs during this run.
- **No invented APIs.** Before using a library method, check the installed version (`package.json`, lockfile, `node_modules/<pkg>/package.json`, `pubspec.lock`) and its docs or type definitions.
- **No invented results.** Never write "tests pass", "works", "fixed" or "verified" unless you ran the command in this run and saw the output. Quote the command and the relevant result line.
- **Say what you don't know.** If something is unverified, say "unverified" and why. Ask the Manager instead of guessing requirements.
- **Cite sources** in docs and summaries: file paths with line numbers, command output, or doc URLs.

## 2. Banned in all writing

- **Em dashes (—) and en dashes used as punctuation (–).** Use a comma, colon, period, parentheses, or a plain hyphen in ranges ("5-10").
- Filler and hype: "robust", "seamless", "leverage", "cutting-edge", "comprehensive", "delve", "elevate", "empower", "streamline", "in today's fast-paced world", "it's worth noting", "at the end of the day", "game-changer", "unlock", "supercharge".
- Chatbot framing: "Certainly!", "Great question", "I hope this helps", "As an AI", "Let's dive in", closing summaries that repeat what was just said.
- Emoji in code, commits, docs or client text (unless the product UI explicitly calls for them).
- Rule-of-three padding ("fast, reliable, and scalable") when only one claim is true and measured.
- Headings or bullet lists for content that is one or two sentences.

## 3. Code hygiene

- Match the surrounding code: naming, comment density, file layout, error-handling idiom.
- Comments explain **why**, never narrate **what** (`// increment i` is banned).
- No dead code, commented-out blocks, placeholder `TODO`s, `console.log`/`print` debugging, or unused imports in a PR.
- No mock data, fake URLs, lorem ipsum or stub implementations left in delivered code. If something must be stubbed, it is listed as incomplete in the Run summary.
- No speculative abstractions, config flags or helpers "for the future".

## 4. Commits and PRs

- Commit subject: imperative, <= 72 chars, no trailing period. Body says why.
- PR description: what changed, why, how it was tested (actual commands), screenshots for UI, known gaps. No marketing tone.

## 5. Self-check before finishing

Search your diff and any text you wrote:

```bash
git diff | grep -nP '\x{2014}|\x{2013}' && echo "REMOVE DASHES"
git diff | grep -niE 'robust|seamless|leverage|delve|cutting-edge|game-changer|supercharge|lorem ipsum|TODO|console\.log'
```

Fix every hit before posting the Run summary.
