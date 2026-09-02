#!/usr/bin/env bash
# Tests for tools/epic-coverage.py - including BOTH negative controls
# (an assertion that cannot fail is not a test: _command/learning/13).
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; PASS=0; FAIL=0
mk() { # mk <dir> <declared...> -- writes arch + one fragment per remaining "id|out1;out2"
  local d="$1"; shift
  mkdir -p "$d/30-fragments"
  { echo "## Declared outputs"; for o in $1; do echo "- ${o/|/: }"; done; } > "$d/20-architecture.md"
  shift; local n=1
  for spec in "$@"; do
    local id="${spec%%=*}" outs="${spec#*=}"
    { echo "---"; echo "id: $id"; echo "state: pending"; echo "outputs:";
      IFS=';' read -ra os <<< "$outs"; for o in "${os[@]}"; do [ -n "$o" ] && echo "  - ${o/|/: }"; done
      echo "---"; } > "$d/30-fragments/0$n-$id.md"; n=$((n+1))
  done
}
t() { local name="$1" want="$2"; shift 2; "$@" >/dev/null 2>&1; local got=$?
  if [ "$got" -eq "$want" ]; then echo "ok   - $name"; PASS=$((PASS+1));
  else echo "FAIL - $name (want exit $want, got $got)"; FAIL=$((FAIL+1)); fi; }

W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT

mk "$W/clean" "schema|Toolkit route|/api/kits" "E.1=schema|Toolkit" "E.2=route|/api/kits"
t "clean plan passes (exit 0)" 0 bash "$HERE/../epic-coverage.sh" "$W/clean"

mk "$W/orphan" "schema|Toolkit route|/api/kits" "E.1=schema|Toolkit"
t "NEGATIVE CONTROL: unclaimed output fails (exit 1)" 1 bash "$HERE/../epic-coverage.sh" "$W/orphan"

mk "$W/double" "schema|Toolkit" "E.1=schema|Toolkit" "E.2=schema|Toolkit"
t "NEGATIVE CONTROL: over-claim fails (exit 1)" 1 bash "$HERE/../epic-coverage.sh" "$W/double"

mk "$W/undecl" "schema|Toolkit" "E.1=schema|Toolkit;route|/api/extra"
t "undeclared claim warns but passes (exit 0)" 0 bash "$HERE/../epic-coverage.sh" "$W/undecl"

grep -q "UNCLAIMED" "$W/orphan/40-coverage.md" && { echo "ok   - report names the unclaimed row"; PASS=$((PASS+1)); } || { echo "FAIL - report row"; FAIL=$((FAIL+1)); }

echo "---"; echo "epic-coverage tests: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
