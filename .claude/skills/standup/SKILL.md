---
name: standup
description: >-
  Generate a to-the-point end-of-day (or mid-session) progress summary
  formatted for a specific chat surface: Slack, Jira, or WhatsApp. Pulls
  from the current session context: tickets filed / moved / merged, PRs
  opened / merged, branches pushed, items triaged out. Never an article.
  Bullets with ticket URLs, grouped by state. Use whenever the founder
  types /standup, optionally with
  --format slack|jira|whatsapp (default: slack).
---

# Today's Progress Summary

Consolidates the session's work into a short, medium-tailored bullet list
the founder can paste into Slack / Jira / WhatsApp without editing. Same
content across formats; only punctuation, section headers, and bullet
styles change.

## Inputs

- `--format <slack|jira|whatsapp>` (optional; default `slack`). Case
  insensitive. `--format=slack` and `--format slack` both work.
- `--front <name>` (optional): only that front's items.
- Optional freeform scope in the invocation (e.g. `since 09:00`, `just
  this morning`, `only the TICK-200 bash`). Default: everything the
  current session has visibly touched.

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

- `Merged`: PR merged into the base branch today.
- `Open PR`: PR is open and awaiting review / merge.
- `New (Open)`: filed today, not started, no PR yet.
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
- One-line title at the top: `*<Scope title> - YYYY-MM-DD*`.

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

## Handling the current session

Read what is visibly in the conversation to build the list. Do NOT invent
tickets or PRs that don't appear in-session. If uncertain about a state
("did that PR merge?"), check via `git log --oneline origin/<base>` in the
relevant repo, or `gh pr view <n> --json state`. Never assume `merged`
without evidence.

Prefer the founder's own words for the outcome line when they've already
stated it in-session. The summary reads AS the founder, not as an
assistant summarising them - no process leakage, no AI tells.

## Example (`--format slack`) output

```
*orbit-app QA bash - 2026-07-02*

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
