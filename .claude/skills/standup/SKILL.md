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
  Writes a local HTML report - a timeline by day, grouped by repo - and
  echoes only its path; the Slack / Jira / WhatsApp blocks ride inside the
  page as copy buttons. Nothing is uploaded. Flags: --from / --to / --front /
  --project / --all / --format slack|jira|whatsapp (default: slack).
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
- `--all` (optional): force the whole portfolio, overriding the inference
  below. This is what the report's own footer tells the reader to run.

### Resolving the scope

Three rules, first match wins:

1. `--front` or `--project` given: that. Explicit always beats inference.
2. **This session has touched one or more fronts**: those fronts. The signal is
   work, not mention - files edited under `fronts/<name>/`, ticket folders
   written under `_command/portfolio/<front>/`, branches cut this session. Two
   fronts touched means both are in scope, not a choice between them.
3. Otherwise - a fresh session, or one that has touched nothing: the whole
   portfolio.

**The conversation may choose the SCOPE. It may never be the SOURCE.** That
distinction is the whole reason rule 2 does not contradict "read the records,
not the conversation" below: the session answers only "which front am I being
asked about", the identical job `--front` does. Every item, timestamp and state
still comes from git, the tracker and the boards across the full window, and a
front in scope is reported in full whether or not this session saw any of it.

**An inferred scope is declared, and its exclusions are counted.** Rule 2 can
silently narrow a report: work that merged on another front inside the window
disappears because this session happened not to touch that front, which is the
"hole in the window" failure this skill warns about elsewhere. So when the scope
was inferred rather than given, the report says so, and it footers the count it
left out with the command that shows them:

    Scope inferred from this session: smileshape, mission-control.
    4 items on 2 other fronts fall in this window and are not shown - /standup --all

Counting the exclusions means reading the other fronts' records too. That is the
point: the cheap version, which skips them, cannot tell the difference between
"nothing happened there" and "I did not look".
- `--format <slack|jira|whatsapp>` (optional; default `slack`). Case
  insensitive. `--format=slack` and `--format slack` both work.

### Resolving the window

Four rules, first match wins. `--to` is the prompt time unless given.

1. `--from` given: use it. Explicit always wins.
2. **A previous report exists for this same scope: its `to` becomes this
   `from`.** This is the default, and the reason it is the default is that it
   makes consecutive reports contiguous by construction - no gap where work can
   fall through, no overlap where the same merge is reported twice.
3. No previous report, but the front's hub carries a window convention (a
   `## Debrief window` section): use that convention, and say which one you
   used and what bounds it produced.
4. Nothing above: 16:00 local on the previous day through the prompt time, said
   out loud as the default it is.

**The interval is half-open: `(from, to]`.** The previous report already
covered its own `to`, so an event landing exactly on that second must NOT
appear again. Treating both ends as inclusive duplicates every boundary event,
and boundary events are not rare - a report is usually generated right after a
merge, which puts that merge on the boundary.

**The ledger is per SCOPE, never global.** A `--front smileshape` report at
10:00 says nothing about what an unscoped report should cover: if the next
unscoped run started from that 10:00 mark, every other front's morning would
vanish silently. So rule 2 matches on the scope key, and a scope with no
previous entry falls through to rule 3 rather than borrowing another scope's
timestamp.

**Where the ledger lives, and why not with the reports.** The reports are
written to the session scratchpad, which is per-session and does not survive -
so the reports themselves cannot be the record of when one last ran. One
durable append-only line per run goes to
`_command/daily/standup-ledger.tsv`, tab separated:

    <to, ISO 8601 with offset>  <scope key>  <item count>  <report filename>

Scope keys are normalised so they compare exactly: `all`,
`front:smileshape`, `front:smileshape+mission-control` (sorted, `+` joined),
`project:smart-data`. Append AFTER the report is successfully written, never
before - a ledger line for a report that failed to render moves the next
window forward over work nobody has seen.

**Say the window out loud, and say where it came from.** "29 Sep 14:12 -> 30 Sep
14:41, continuing the last smileshape report" is checkable; a bare date range is
not. And when rule 2 produces an unusually long window - more than about a week
- say that too, because it usually means a report failed, not that nothing
happened.

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

### Verify state at the source, never from the local board

The front's board and a ticket's frontmatter are CACHES. They record what some
earlier session believed, at the moment it stopped believing it, and they go
stale the instant anyone acts outside a session - a colleague merges the PR, a
deploy fires, someone drags a card. A standup that reads those caches reports
yesterday's picture with today's date on it, which is worse than reporting
nothing because it looks current.

So resolve every state from the system that OWNS it:

| State | The system that owns it |
|---|---|
| ticket status | the tracker API - `getJiraIssue` / `gh issue view`, per ticket |
| PR open, merged, closed, and WHEN | `gh pr view` - `mergedAt` is authoritative, a local note is not |
| CI result | `gh pr checks` / `gh run list`, not a remembered green |
| deploy outcome | the deploy workflow's run, and where it is cheap to check, the deployed resource itself |

Where a claim is checkable against the thing it describes, check it there. A
deploy that "succeeded" and a resource that exists are two different facts, and
only the second one is the deliverable.

### Then correct the trackers - after the report is open, never before

The reconcile is the point, not a side effect: this skill reads every system of
record over a window, which makes it the one moment that can see where the
trackers have drifted. Having seen it, leaving it uncorrected is a choice to let
the board keep lying.

Order matters. Generate the report, write it, open it - THEN reconcile. The
report is a record of what was true when it was read; correcting first would
make it a record of what this skill just did.

For each drift found, correct it and say so:

- **Ticket status behind reality** (a merged PR whose ticket still says In
  Progress): transition it, with the transition id DISCOVERED from the API
  rather than assumed, and comment the evidence that justified the move.
- **Local board or frontmatter behind the tracker**: rewrite the cache from the
  tracker, never the reverse.
- **A `pr:` or `branch:` field empty where a PR exists**: fill it.

Two limits, and neither is optional:

- **Correct only what the evidence settles.** A merged PR that closes a ticket
  is unambiguous. A ticket that "looks done" is not - leave it, and report it as
  a drift the founder should settle.
- **Report every correction made.** A skill that silently edits the employer's
  tracker is indistinguishable from one that gets it wrong silently. List each
  change, its before and after, and the evidence.

Corrections are writes to somebody else's system of record. On a confidential or
partnered front they follow that front's rules exactly as any other write would:
if tracker writes are blocked or gated there, the drift is REPORTED, not
applied.

**Attribute to the founder, not to every commit in the window.** A partnered
or day-job repo carries other people's commits, and a shared branch carries
merges of their work. Report what the founder did; where authorship is
genuinely ambiguous, say so rather than claiming it.

**An event performed by someone else is not an item.** A colleague filing four
tickets, a teammate opening a PR, a bot's dependency bump: these fall inside the
window and are not the founder's work, so they do not get a row. The item begins
at the founder's first action on it.

This is easy to get wrong because the tracker records the filing as a state
change in the window, and a naive read turns "Kody filed WB-758 to WB-761" into
a `new` row under the founder's name. It reads as if he generated the work he
was assigned. Check the actor on every state change, not just its timestamp.

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

1. **Ticket key.**
2. **The ticket's OWN title**, as the tracker holds it - not a paraphrase, not a
   retelling, not a sentence about what was learned. If the title is wrong, fix
   the title; do not write around it in the report.
3. **A precise summary, on hover.** One or two sentences naming what the ticket
   ships or addresses, surfaced as a tooltip on the title rather than inline.
   The reader who wants detail asks for it by pointing at the line; the reader
   scanning nine items is not made to read past it.
4. **Ticket URL**, and **PR URL** where one exists.

**A standup line is a title, not an essay.** Earlier versions filled the line
with the reasoning behind the work - which root cause was found, what the
threshold was derived from, why a sibling's number did not transfer. That
belongs in the ticket, the PR body and the commit message, all of which are one
click away and all of which already carry it. In a standup it is chatter that
buries the nine things the reader came for.

The test: could the line be read aloud in a standup without the listener losing
the thread? "Remediate SQL database CPU monitored" passes. A clause about page
cache and OOM killers does not.

**Structure: a timeline, days outermost.** Within each day, group by repo -
or by FRONT when the scope is the whole portfolio, so the nesting never exceeds
three levels. Repos (or fronts) sort by their first event of that day, so the
day reads chronologically at both levels; items within a group sort by time.

That replaces grouping by state, which earlier versions of this skill required.
The state did real work there, so it has to survive the change in two places or
it is simply lost: as a CHIP on every item, and as a counts strip at the top of
the report that restates at a glance what the buckets used to show.

**Non-ticket events belong on the timeline.** A CI fix, a deploy, an infra
change, a credential rotation: real work in the window with no tracker row.
Earlier versions had nowhere to put these because every bucket was
ticket-shaped, so they went unreported and the window read emptier than it was.
A timeline holds them naturally - same line shape, no key, a state chip naming
what kind of event it was.

### Status: there are two, and a view that shows both

Earlier versions carried six chips - merged, open PR, new, triaged out, ci,
deploy - and that was a mistake of category. "Merged" and "deployed" are not
states a reader cares about at standup altitude; they are HOW something got
done. The reader wants to know whether it is done or not.

| Status | What it means |
|---|---|
| **Done** | Shipped. Code that landed, or a non-code item that has been addressed. |
| **In progress** | Whatever Jira currently calls In Progress. Not done. |
| **All** | Not a status - the default VIEW, showing both. |

**Merged, in PR, deploying and deployed are SUB-statuses of Done**, not statuses
of their own. A ticket whose PR is open and green is done: the work is shipped
and the merge is somebody else's click. Likewise a deploy in flight - the code is
out, the pipeline is machinery. So the sub-status is rendered as a quiet second
marker beside the status, and it never changes which bucket an item is in.

    Done  ·  in PR        Done  ·  merged
    Done  ·  deploying    Done  ·  deployed

A non-ticket event carries a status too, by the same test: a CI fix that landed
is `Done · merged`; a deploy that succeeded is `Done · deployed`. It is not a
separate kind of row.

Anything the founder invalidated, closed as duplicate or rolled into another
item is simply absent. A standup reports what happened, not what was considered.

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

## Example: the timeline, and the Slack block inside it

The page's own structure, days outermost and repo grouped within each day:

```
 smileshape                              29 Sep 16:00 -> 30 Sep 14:00  [inferred]
 7 items   3 merged   2 open PR   1 new   1 ci

 29 SEP
   annotation-studio-3d
     18:21  AI-2151  [merged]   duplicate-aware import: honest counts on
                                the project import screen          ticket  PR #190
     23:43  AI-2172  [out]      superseded, folded into the epic PR ticket
   smart-data
     23:04  AI-2159  [merged]   body limit sized to the maximum the
                                lookup advertises                  ticket  PR #13

 30 SEP
   smart-data
     10:31  WB-761   [open PR]  rds cpu / memory / storage / io alarms
                                (+ WB-758, WB-759, WB-760)          ticket  PR #15
     13:35  -        [ci]       minio withdrawn upstream; swapped to s3mock
     13:53  WB-761   [open PR]  memory threshold corrected after review

 Scope inferred from this session: smileshape.
 4 items on 2 other fronts fall in this window and are not shown - /standup --all
```

Note the `13:35` line: real work, no ticket key, and it would have been invisible
under the old ticket-shaped buckets.

And the Slack block that rides inside that page, unchanged from what
`## Formatting rules` specifies:

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

## Delivery: a local HTML file, and one line in the terminal

Render the report from `report-template.html` in this skill's directory and
write it to the session scratchpad as
`standup-<scope>-<YYYY-MM-DD>.html`. Then echo exactly one line - the path, the
item count and the resolved window - and nothing else:

    wrote standup-smileshape-2026-09-30.html
    (7 items, 29 Sep 16:00 -> 30 Sep 14:00)

No commentary above or below it unless the founder asks. The report is the
deliverable; the terminal is a pointer to it.

**Then append the ledger line** - `_command/daily/standup-ledger.tsv`, one line,
after the file is on disk. That line is what the NEXT run's window starts from,
so writing it before the report exists would advance the window past work that
was never reported.

**The page is self-contained, and that is a hard requirement rather than a
preference.** No CDN, no web font, no remote image, no fetch. One file that
opens with no network and survives being copied to a machine that has none.
Check it: a `grep` for `http` in the emitted file should return nothing but the
tracker and PR links that are the report's own content.

**Nothing is uploaded, and there is no flag that uploads.** This portfolio is
mostly employer-owned and partnered fronts, and this skill already holds
confidential fronts to pointers only. A publish path would be a standing
invitation to breach that in one keystroke, so it does not exist. If a report
needs to reach someone else, the founder sends the file.

**The chat formats survive inside the page**, not instead of it: Slack, Jira and
WhatsApp each get a copy-to-clipboard block rendering exactly what the
`## Formatting rules` above specify. `--format` still chooses which one is shown
first. The paste-into-a-channel flow is the reason this skill exists and the
HTML must not cost it - the founder still sends the message, this skill never
does.

## What the page contains, in order

1. **Header** - scope, the resolved window as an explicit range, whether the
   scope was GIVEN or INFERRED, and which rule produced the window
   ("continuing the last smileshape report, 29 Sep 14:12" / "hub convention" /
   "default 16:00 previous day"). A window whose origin is stated can be
   checked; one that just appears cannot.
2. **Counts strip** - `7 items · 3 merged · 2 open PR · 1 new · 1 ci`. This is
   what replaces grouping by state; without it the reader has to count.
3. **Timeline** - day, then repo (or front when unscoped), then items. Each item:
   time, ticket key where there is one, state chip, the outcome in verb form,
   and its links.
4. **Exclusions footer**, only when the scope was inferred - the count left out
   and the command that shows it.
5. **Copy blocks** - one per chat format.
6. **Sources line** - which records were read, and any that could not be. An
   unread source is a hole in the window, and the page says so where the reader
   will see it rather than in a terminal they have already closed.

## Related doctrine

- `framework/learning-seed/11-delivery-hygiene.md` - descriptive lines,
  never placeholders.
- `framework/learning-seed/06-communicate-plainly.md` - specifics over
  labels, in the summary too.
- `mission-flow` - the workflow whose outcomes this summary reports on.
