#!/usr/bin/env bash
# Tests for tools/front-context.sh: prints the hub + spoke for a flow prompt,
# nothing for other prompts, and a notice (exit 0) for a missing front.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; H="$HERE/../front-context.sh"; PASS=0; FAIL=0
W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT
mkdir -p "$W/_command/portfolio/acme/widget"
echo "HUB-SENTINEL acme" > "$W/_command/portfolio/acme/_front.md"
echo "SPOKE-SENTINEL widget" > "$W/_command/portfolio/acme/widget/widget.md"
echo "SPOKE-SENTINEL acme-only" > "$W/_command/portfolio/acme/acme.md"
call() { printf '{"prompt":%s}' "$(printf '%s' "$1" | jq -Rs .)" | CLAUDE_PROJECT_DIR="$W" bash "$H"; }
chk() { local name="$1" want_sub="$2" out="$3"; if [ -z "$want_sub" ]; then [ -z "$out" ] && { echo "ok   - $name"; PASS=$((PASS+1)); } || { echo "FAIL - $name (expected no output)"; FAIL=$((FAIL+1)); }; else printf '%s' "$out" | grep -q -- "$want_sub" && { echo "ok   - $name"; PASS=$((PASS+1)); } || { echo "FAIL - $name (missing: $want_sub)"; FAIL=$((FAIL+1)); }; fi; }
o="$(call '/mission-flow --front acme --project widget fix the thing')"
chk "prints the hub for a flow prompt" "HUB-SENTINEL acme" "$o"; chk "prints the project spoke" "SPOKE-SENTINEL widget" "$o"
o="$(call '/epic-flow --auto --front acme plan it')"; chk "falls back to the front spoke without --project" "SPOKE-SENTINEL acme-only" "$o"
o="$(call 'tell me about acme --front acme')"; chk "NEGATIVE CONTROL: a non-flow prompt prints nothing" "" "$o"
o="$(call '/mission-flow --front nowhere do x')"; chk "a missing front yields a notice, not silence" "not found" "$o"
printf '{"prompt":"/mission-flow --front nowhere"}' | CLAUDE_PROJECT_DIR="$W" bash "$H" >/dev/null 2>&1; rc=$?
[ "$rc" -eq 0 ] && { echo "ok   - never blocks (exit 0)"; PASS=$((PASS+1)); } || { echo "FAIL - exit $rc"; FAIL=$((FAIL+1)); }
echo "---"; echo "front-context tests: $PASS passed, $FAIL failed"; [ "$FAIL" -eq 0 ]
