#!/usr/bin/env bash
# PreToolUse hook (matcher: Bash). Blocks a command that reads `$?` after a
# pipe into a presentation tool, because `$?` then reports the pager, which
# never fails: `cmd | tail; echo $?` printed a failure and exit=0 in the same
# breath on three real runs, one a security gate (_command/learning/13).
# Exit 2 blocks and the stderr reaches the model; exit 0 allows.
# Allowed: `cmd > log 2>&1; rc=$?; tail log`, `set -o pipefail`, PIPESTATUS.
set -uo pipefail
payload="$(cat)"
case "$payload" in *'"Bash"'*) ;; *) exit 0 ;; esac
case "$payload" in *'$?'*|*'${?}'*) ;; *) exit 0 ;; esac
if ! command -v jq >/dev/null 2>&1; then
  echo "status-after-pipe-guard: jq is required for the shell hook" >&2; exit 0
fi
tool="$(printf '%s' "$payload" | jq -r '.tool_name // empty' 2>/dev/null)"
[ "$tool" = "Bash" ] || exit 0
cmd="$(printf '%s' "$payload" | jq -r '.tool_input.command // empty' 2>/dev/null)"
[ -n "$cmd" ] || exit 0
pager='(tail|head|grep|egrep|fgrep|sed|awk|jq|tee|less|more|cut|sort|uniq|wc|tr|column)'
if printf '%s' "$cmd" | grep -Eq '\|[[:space:]]*'"$pager"'([[:space:]]|$)' \
   && printf '%s' "$cmd" | grep -Eq '\$(\?|\{\?\})' \
   && ! printf '%s' "$cmd" | grep -Eq 'pipefail|PIPESTATUS'; then
  tool_hit="$(printf '%s' "$cmd" | grep -Eo '\|[[:space:]]*'"$pager" | head -1 | tr -d '| ')"
  {
    echo "status-after-pipe-guard: BLOCKED - \$? is read after a pipe into '$tool_hit', so it reports '$tool_hit', not the command."
    echo "Capture the status on the command's own line: cmd > log 2>&1; rc=\$?; tail log"
    echo "or use set -o pipefail / \${PIPESTATUS[0]} if the pipeline itself is the thing measured."
  } >&2
  exit 2
fi
exit 0
