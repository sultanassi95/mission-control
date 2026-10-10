#!/usr/bin/env bash
# UserPromptSubmit hook. When a prompt invokes /mission-flow or /epic-flow and
# names --front <f> (and optionally --project <p>), print that front's hub and
# the repo's spoke to stdout so they enter context BEFORE Phase 0 - the step
# zero of _command/learning/26, made mechanical. Never blocks: exit 0 always.
set -uo pipefail
payload="$(cat)"
case "$payload" in */mission-flow*|*/epic-flow*) ;; *) exit 0 ;; esac
command -v jq >/dev/null 2>&1 || exit 0
prompt="$(printf '%s' "$payload" | jq -r '.prompt // empty' 2>/dev/null)"
printf '%s' "$prompt" | grep -Eq '^[[:space:]]*/(mission-flow|epic-flow)([[:space:]]|$)' || exit 0
front="$(printf '%s' "$prompt" | grep -Eo -- '--front[= ]+[A-Za-z0-9_.-]+' | head -1 | sed -E 's/--front[= ]+//')"
[ -n "$front" ] || exit 0
project="$(printf '%s' "$prompt" | grep -Eo -- '--project[= ]+[A-Za-z0-9_.-]+' | head -1 | sed -E 's/--project[= ]+//')"
root="${CLAUDE_PROJECT_DIR:-$(pwd)}"; base="$root/_command/portfolio/$front"
hub="$base/_front.md"
if [ -n "$project" ]; then spoke="$base/$project/$project.md"; else spoke="$base/$front.md"; fi
cap=120000; total=0
emit() { local label="$1" f="$2"
  if [ -f "$f" ]; then
    local n; n=$(wc -c < "$f"); total=$((total + n))
    if [ "$total" -gt "$cap" ]; then echo "[front-context] $label at $f is $n bytes and would exceed the ${cap}-byte cap; read it with the Read tool before Phase 0."; return; fi
    echo "[front-context] $label ($f):"; cat "$f"; echo
  else
    echo "[front-context] $label not found at $f - the spoke or hub is missing; a front with blank context is not dispatch-ready."
  fi; }
echo "[front-context] step zero: the hub and spoke for --front $front${project:+ --project $project}, read before any design decision (_command/learning/26)."
emit "hub" "$hub"; emit "spoke" "$spoke"
exit 0
