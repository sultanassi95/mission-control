#!/usr/bin/env bash
# PreToolUse hook. Reads the hook payload as JSON on stdin, scans the
# outward-artifact text inside tool_input, and exits 2 to block when a
# deny-list term appears. Exit 0 allows. Never calls a model and never reads
# repo files.
set -uo pipefail

TERMS="${LEAK_GUARD_TERMS:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/leak-guard.terms.txt}"

payload="$(cat)"
[ -n "$payload" ] || exit 0

# Cheap pre-filter BEFORE requiring jq. Without this, a machine with no jq
# would fail closed on every Bash call including `ls`, which is a strong
# incentive to switch the guard off entirely.
if ! printf '%s' "$payload" | grep -Eqi 'git|gh |mcp__'; then
  exit 0
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "leak-guard: jq is required for the shell hook; use leak-guard.ps1 on Windows" >&2
  exit 2
fi

tool="$(printf '%s' "$payload" | jq -r '.tool_name // empty' 2>/dev/null)"
if [ -z "$tool" ]; then
  echo "leak-guard: payload did not parse as JSON, allowing" >&2
  exit 0
fi

# Tolerant of global flags between the binary and the subcommand: `git -c k=v
# commit` and `git -C dir commit` are ordinary and an adjacency-only pattern
# misses both.
GIT_PUBLISH='(^|[^A-Za-z])git([^;&|]*)(^|[^A-Za-z])(commit|tag)([^A-Za-z]|$)'
GH_PUBLISH='(^|[^A-Za-z])gh([^;&|]*)(pr|issue|release)([^;&|]*)(create|edit|comment|review)'
FILE_BORNE='(--file=|--body-file|--notes-file|--fill)|(-F|--file)[[:space:]]+[^-][^[:space:]]*'
OUTWARD_TOOL='(add|create|edit|update|post|append).*(comment|issue|page|worklog|description|ticket)'

text=""; file_borne=0
if [ "$tool" = "Bash" ]; then
  cmd="$(printf '%s' "$payload" | jq -r '.tool_input.command // empty')"
  if [ -n "$cmd" ] && printf '%s' "$cmd" | grep -Eqi "$GIT_PUBLISH|$GH_PUBLISH"; then
    text="$cmd"
    printf '%s' "$cmd" | grep -Eqi "$FILE_BORNE" && file_borne=1
  fi
elif printf '%s' "$tool" | grep -Eqi "$OUTWARD_TOOL"; then
  text="$(printf '%s' "$payload" | jq -c '.tool_input // empty')"
fi
[ -n "$text" ] || exit 0

if [ "$file_borne" -eq 1 ]; then
  {
    echo "leak-guard BLOCKED this outward artifact: its text comes from a file."
    echo
    echo "  A file-borne message (-F FILE, --file=, --body-file, --notes-file, --fill)"
    echo "  cannot be checked, so it is refused rather than waved through."
    echo
    echo "  Inline it with -m, or pipe it in with -F - and a heredoc."
  } >&2
  exit 2
fi

if [ ! -f "$TERMS" ]; then
  echo "leak-guard: term list not found at $TERMS" >&2
  exit 2
fi

hits=""
while IFS= read -r line || [ -n "$line" ]; do
  pattern="$(printf '%s' "$line" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"
  [ -n "$pattern" ] || continue
  case "$pattern" in \#*) continue ;; esac
  match="$(printf '%s' "$text" | grep -Eio "$pattern" 2>/dev/null | head -1 || true)"
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
