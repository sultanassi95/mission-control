---
name: standup
description: >-
  Report what actually happened between two times, formatted for a specific
  chat surface: Slack, Jira, or WhatsApp. Reads the systems of record - git
  history, the tracker, the boards, ticket evidence logs - over an explicit
  window, never only what the current conversation witnessed. Never an
  article. Bullets with ticket URLs, grouped by state. Use whenever the
  founder types /standup, asks what was done since a given time, or wants a
  handoff for a window spanning a night, a weekend or several sessions.
  Flags: --from / --to / --front / --project /
  --format slack|jira|whatsapp (default: slack).
---

# Standup

Reports what happened over an explicit window as a short, medium-tailored
bullet list the founder can paste into Slack / Jira / WhatsApp without
editing. Same content across formats; only punctuation, section headers, and
bullet styles change.

## Inputs

- `--from <YYYY-MM-DD[ HH:MM]>` / `--to <YYYY-MM-DD[ HH:MM]>` (optional): the
  window bounds, to the hour. A standup window is routinely a night, a
  weekend, or several days, so it is NOT a calendar day and is never rounded
  to one. `--to` defaults to the prompt time.
- `--front <name>` (optional): only that front's items.
- `--project <key>` (optional): only that repo. Independent of `--front` -
  either may be given alone, or both together.
- `--format <slack|jira|whatsapp>` (optional; default `slack`). Case
  insensitive. `--format=slack` and `--format slack` both work.

### Resolving the window

1. `--from` given: use it, with `--to` or the prompt time.
2. `--from` omitted and the front's hub carries a window convention (a
   `## Debrief window` section): use that convention, and say which one you
   used and what bounds it produced.
3. Neither: 16:00 local on the previous day through the prompt time, said out
   loud as the default it is.

**Read every timestamp as an offset, never as a clock abbreviation.** The
local zone here renders as `EEST` or `EDT` meaning UTC+3 (Egypt), NOT US
Eastern. Read as a US zone, a three-letter label shifts the window by seven
hours and silently drops or invents an evening of work. Compute the bounds
with `date` and state them in the output, so a wrong window is visible
instead of silent.

## Sourcing: read the records, not the conversation

The work in a standup window usually happened across several sessions,
evenings, and manual steps this conversation never witnessed. So DISCOVER the
work from the systems of record rather than summarising what happens to be in
context. Per front in scope:

| Source | What it settles |
|---|---|
| `git log --all --since=<from> --until=<to>` per repo | commits, and which branch they landed on |
| `gh pr list --state all --json number,title,state,mergedAt,headRefName` | PR state, and the authoritative merge time |
| the tracker (Jira `updated >= <from>`, or `gh issue list`) | ticket state changes |
| `tasks/_board.md` plus each ticket's frontmatter | trackerless fronts |
| a ticket folder's evidence log | what was proven, for the outcome line |

Two rules the sources themselves impose:

- **An event time beats a note's time.** A local note records when it was
  written; `mergedAt` records when the merge happened. The two disagree
  exactly at window boundaries, and the event time decides whether an item is
  in or out. Never place an item by the timestamp of a note about it.
- **Normalise offsets before comparing.** git returns the committer's offset,
  GitHub returns UTC, a tracker returns the account's zone. Convert all of
  them to one offset before testing against the bounds.

**Say which sources you read**, and name any you could not (no tracker access,
a repo not present locally). An unread source is a hole in the window, not an
absence of work.

**Attribute to the founder, not to every commit in the window.** A partnered
or day-job repo carries other people's commits, and a shared branch carries
merges of their work. Report what the founder did; where authorship is
genuinely ambiguous, say so rather than claiming it.

**An empty window says so.** "Nothing falls in this window" is the correct
output when the records return nothing. Never pad with older work and never
widen the bounds to find something.

**Confidential fronts stay pointer-only.** A ticket key, a state and a URL are
fine; internals from an employer-owned repo are not, beyond what that front's
IP-boundary rules permit.

The summary reads AS the founder, not as an assistant summarising them - no
process leakage, no AI tells. Prefer the founder's own words for an outcome
line where they have already stated it.

## What to include

For each item covered, name:

1. **Ticket key** + one-line description of the outcome (verb form:
   "invitation acceptance now flows through the identity provider", not
   "we fixed").
2. **Ticket URL** (see URL rules below).
3. **PR URL** if a PR is open or merged for the item.
4. **QA-N label** in parens after the ticket key when the ticket is a
   subtask of a bug-bash tracker (e.g. `TICK-217 (QA-2 + QA-3)`) - an
   optional pattern for teams that run organized QA sweeps.

Group by state (see below), not by ticket. Order within each group by
significance: merged first, then open PRs, then filed / open, then
triaged / closed.

State buckets (use exactly one per item):

- `Merged`: PR merged into the base branch inside the window.
- `Open PR`: PR is open and awaiting review / merge.
- `New (Open)`: filed inside the window, not started, no PR yet.
- `Triaged out`: rows the founder invalidated, closed as duplicate, or
  rolled into another item. Compress to a single line.

## Formatting rules

**Every format:**

- No em dashes (U+2014) or en dashes (U+2013). No ellipsis (U+2026) - use
  three ASCII dots. These read as machine-authored.
- No emoji unless the founder explicitly asks.
- Ticket keys uppercase (`TICK-214`).
- Ticket URLs use your tracker's canonical browse base (e.g.
  `https://<your-tenant>.atlassian.net/browse/TICK-214`, or the GitHub
  issue URL). PR URLs use the repo path from the branch's remote.
- The whole summary stays under 20 lines.

**`--format slack` (default):**

- Section headers in bold via single asterisks: `*Merged*`, `*Open PR*`.
- Bulleted items with a plain bullet character.
- Ticket URL + PR URL inline on the same line, separated by ` and `
  or a middle dot; Slack unfurls both.
- Blank line between sections.
- One-line title at the top naming the scope AND the resolved window:
  `*<Scope title> - <from> to <to>*`.

**`--format jira`:**

- Section headers as `### Merged`, `### Open PR`, etc.
- Bulleted items with `-`.
- Ticket keys as bare `TICK-214` (Jira auto-links them).
- PR URLs in Jira wiki link syntax: `[PR #36|https://...]`.
- Optional summary table at the top if the count is over 6 items.

**`--format whatsapp`:**

- Section labels as `*Merged:*`, `*Open PR:*` (single asterisks, colon).
- Numbered items `1. 2. 3.` (renders consistently across clients).
- URLs inline, multiple separated by ` | `.
- Tighter than Slack: two to five words of description, then the URLs.

## Example (`--format slack`) output

```
*orbit-app QA bash - 01 Jul 17:00 to 02 Jul 18:30*

*Merged*
- TICK-212 (QA-11): invitation acceptance flow now works end-to-end. https://acme.atlassian.net/browse/TICK-212 and https://github.com/acme/orbit-app/pull/36
- TICK-214 (QA-1): silent invitation failures now surface with a Resend action. https://acme.atlassian.net/browse/TICK-214 and https://github.com/acme/orbit-app/pull/37

*Open PR*
- TICK-217 (QA-2 + QA-3): selection outline no longer stuck after undo. https://acme.atlassian.net/browse/TICK-217 and https://github.com/acme/orbit-app/pull/38

*New (Open)*
- TICK-222 (QA-12): pen options widget. https://acme.atlassian.net/browse/TICK-222

*Triaged out*
QA-4, 5, 6: invalid or superseded. https://acme.atlassian.net/browse/TICK-200
```

## Delivery

Return the formatted block as a fenced code block so the founder can
copy-paste in one action. Do NOT add commentary above or below unless the
founder explicitly asks.

## Related doctrine

- `framework/learning-seed/11-delivery-hygiene.md` - descriptive lines,
  never placeholders.
- `framework/learning-seed/06-communicate-plainly.md` - specifics over
  labels, in the summary too.
- `mission-flow` - the workflow whose outcomes this summary reports on.
