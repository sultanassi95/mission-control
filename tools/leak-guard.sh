#!/usr/bin/env bash
# PreToolUse hook. Reads the hook payload as JSON on stdin, scans only the
# outward-artifact text inside tool_input, and exits 2 to block when a
# deny-list term appears. Exit 0 means allow. Never calls a model and never
# reads the repo.
set -uo pipefail

TERMS="${LEAK_GUARD_TERMS:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/leak-guard.terms.txt}"

payload="$(cat)"
[ -n "$payload" ] || exit 0

if ! command -v jq >/dev/null 2>&1; then
  echo "leak-guard: jq is required for the shell hook; use leak-guard.ps1 on Windows" >&2
  exit 2
fi

tool="$(printf '%s' "$payload" | jq -r '.tool_name // empty' 2>/dev/null)" || exit 0
[ -n "$tool" ] || exit 0

OUTWARD='git[[:space:]]+(commit|tag[[:space:]]+-[am])|gh[[:space:]]+(pr|issue)[[:space:]]+(create|edit|comment|review)|gh[[:space:]]+release[[:space:]]+create'

text=""
if [ "$tool" = "Bash" ]; then
  cmd="$(printf '%s' "$payload" | jq -r '.tool_input.command // empty')"
  if [ -n "$cmd" ] && printf '%s' "$cmd" | grep -Eqi "$OUTWARD"; then
    text="$cmd"
  fi
elif printf '%s' "$tool" | grep -Eq 'omment|reate.*ssue|pdate.*age'; then
  text="$(printf '%s' "$payload" | jq -c '.tool_input // empty')"
fi
[ -n "$text" ] || exit 0

if [ ! -f "$TERMS" ]; then
  echo "leak-guard: term list not found at $TERMS" >&2
  exit 2
fi

hits=""
while IFS= read -r line || [ -n "$line" ]; do
  pattern="$(printf '%s' "$line" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"
  [ -n "$pattern" ] || continue
  case "$pattern" in \#*) continue ;; esac
  match="$(printf '%s' "$text" | grep -Eio "$pattern" | head -1 || true)"
  if [ -n "$match" ]; then
    hits="${hits}  ${pattern}  ->  matched '${match}'"$'\n'
  fi
done < "$TERMS"

if [ -n "$hits" ]; then
  {
    echo "leak-guard BLOCKED this outward artifact: process vocabulary found."
    echo
    printf '%s' "$hits"
    echo
    echo "Rewrite so the text records the CHANGE, not how the work was run."
    echo "Deny-list: $TERMS"
  } >&2
  exit 2
fi
exit 0
