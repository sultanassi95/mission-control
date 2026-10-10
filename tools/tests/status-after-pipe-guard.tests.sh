#!/usr/bin/env bash
# Tests for tools/status-after-pipe-guard.sh - a blocked form AND a passed
# form, so the suite can fail in both directions (_command/learning/13).
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; G="$HERE/../status-after-pipe-guard.sh"; PASS=0; FAIL=0
run() { local name="$1" want="$2" tool="$3" cmd="$4"
  local got; printf '{"tool_name":"%s","tool_input":{"command":%s}}' "$tool" "$(printf '%s' "$cmd" | jq -Rs .)" | bash "$G" >/dev/null 2>&1; got=$?
  if [ "$got" -eq "$want" ]; then echo "ok   - $name"; PASS=$((PASS+1)); else echo "FAIL - $name (want exit $want, got $got)"; FAIL=$((FAIL+1)); fi; }
run "BLOCKS: status read after a pipe into tail"            2 Bash 'npm test 2>&1 | tail -20; echo "exit=$?"'
run "BLOCKS: status read after a pipe into grep, on one line" 2 Bash 'make check | grep -v warning && echo rc=$?'
run "BLOCKS: braces form \${?}"                              2 Bash 'cargo test | jq . ; echo ${?}'
run "PASSES: direct capture then format"                     0 Bash 'npm test > log 2>&1; rc=$?; tail -20 log; exit $rc'
run "PASSES: pipefail makes the pipe the measured thing"     0 Bash 'set -o pipefail; npm test | tail -20; echo $?'
run "PASSES: PIPESTATUS read"                                0 Bash 'npm test | tail -20; echo ${PIPESTATUS[0]}'
run "PASSES: a pipe with no status read"                     0 Bash 'git log --oneline | head -5'
run "PASSES: a status read with no pipe"                     0 Bash 'npm test; echo $?'
run "IGNORES: a non-Bash tool"                               0 Read 'npm test | tail; echo $?'
echo "---"; echo "status-after-pipe-guard tests: $PASS passed, $FAIL failed"; [ "$FAIL" -eq 0 ]
