# Leak guard - the mechanical tier for outward artifacts

> A `PreToolUse` hook that blocks process vocabulary before it reaches a commit,
> a PR, or a tracker comment. Opt-in per repo. Fast, offline, never calls a
> model.

```mermaid
flowchart LR
  T[tool call] --> M{matcher:<br/>Bash or a comment tool?}
  M -- no --> A([allow])
  M -- yes --> C{command publishes<br/>something?<br/>git commit · gh pr · gh issue}
  C -- no --> A
  C -- yes --> S[scan tool_input<br/>against leak-guard.terms.txt]
  S -- no hit --> A
  S -- hit --> B([exit 2: BLOCKED<br/>stderr names the term])
```

## Why this exists

Most rules in the governance floor need judgement, so a session enforces them.
One does not. "An outward artifact records the change, not how the work was
run" is a string-matching problem, and a rule that can be checked mechanically
should not depend on anyone remembering it. This is the only rule in the floor
that sits at the mechanical tier.

## What it blocks

Everything in `tools/leak-guard.terms.txt`: one case-insensitive regex per
line, comments with `#`. Four families.

| Family | Example |
|---|---|
| A decision attributed to a person, not to the change | `founder decided`, `per the founder`, `as requested by` |
| Internal orchestration vocabulary | `orchestrator`, `sub-agent`, `pause point` |
| Deliberation labels that belong in working notes | `[ASSUMPTION]`, `[UNVERIFIED]`, `[STUB]` |
| Authorship tells | `Co-Authored-By: Claude`, `generated with`, `as an AI` |

**The tuning rule: prefer a multiword phrase over a bare word.** A bare common
word is a false-positive engine. `gate` alone is inside delegate, mitigate,
aggregate, navigate and investigate, and `gateway` is ordinary code, so the
list carries `the gate passed` and `gate-locked` instead. Every entry is either
multiword or a word nobody writes by accident.

## What it does not scan

Only commands that publish something are scanned: `git commit`, `git tag -a`,
`gh pr create|edit|comment|review`, `gh issue create|comment`,
`gh release create`, plus tracker and wiki comment tools. A `git status`, a
`grep` for one of the terms, or a `Read` of a file named after one is never
scanned. The repo's own files are never read.

## Enable it

Per repo, in `.claude/settings.json`. Nothing is enabled by default.

```json
{
  "PreToolUse": [
    {
      "matcher": "Bash|mcp__.*[Cc]omment.*",
      "hooks": [
        { "type": "command", "command": "pwsh -NoProfile -File \"${CLAUDE_PROJECT_DIR}/tools/leak-guard.ps1\"", "timeout": 10 }
      ]
    }
  ]
}
```

On macOS and Linux use the shell twin, which needs `jq`:

```json
{ "type": "command", "command": "bash \"${CLAUDE_PROJECT_DIR}/tools/leak-guard.sh\"", "timeout": 10 }
```

Hooks load at session start, so restart the session after adding it. Verify
with `/hooks`.

## Decide per repo, because subject matter differs

A repo whose SUBJECT is process will legitimately use these words. This repo is
one: `orchestrator` and `sub-agent` are what its commits are about, not leakage
in them. A product repo is the opposite case, and there the same words in a
commit are exactly the leak.

The evidence for taking that seriously is in the term list itself.
`\bmission[- ]flow phase\b` ships commented out because scanning this repo's own
history on 2026-08-13 produced two hits and both were false: the commits were
about the flow. In a repo where the flow is tooling rather than subject matter,
uncomment it.

The same scan found one true hit, an `Co-Authored-By: Claude` trailer on
`673370b`, which is the violation this guard exists to stop.

## Extend or audit it

Edit `tools/leak-guard.terms.txt`; it is the single source and it is read at
every invocation, so there is nothing to rebuild. After changing it, run the
suite and scan real history rather than trusting the change:

```
pwsh -NoProfile -File tools/tests/leak-guard.tests.ps1
```

The suite carries two negative controls. One proves a custom term blocks; the
other proves the same text passes under the shipped list, so a green run cannot
mean the hook simply allowed everything. That pairing exists because an earlier
version of the harness passed the payload as a command-line argument, the JSON
arrived mangled, the hook allowed every case, and every positive test still
reported PASS.
