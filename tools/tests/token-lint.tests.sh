#!/usr/bin/env bash
# Tests for tools/token-lint.py - each pass case has a negative control beside
# it, so the suite can fail in both directions (_command/learning/13).
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; L="$HERE/../token-lint.sh"; PASS=0; FAIL=0
W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT
t() { local name="$1" want="$2"; shift 2; "$@" >/dev/null 2>&1; local got=$?
  if [ "$got" -eq "$want" ]; then echo "ok   - $name"; PASS=$((PASS+1));
  else echo "FAIL - $name (want exit $want, got $got)"; FAIL=$((FAIL+1)); fi; }
mk() { # mk <dir> <hex baseline> <spacing baseline>
  rm -rf "$1"; mkdir -p "$1/app" "$1/components"
  printf ':root{ --navy:#0B2D4B; --s4:16px; --t-md:1rem; }\n' > "$1/app/globals.css"
  printf '.card{ padding: var(--s4); color: var(--navy); margin: 0; }\n/* was #FF0000 and padding: 12px */\n' > "$1/app/page.css"
  printf 'export const A = () => <div style={{ gap: "var(--s4)" }} />; // fontSize: 14\n' > "$1/components/A.tsx"
  printf '{"tokens":["app/globals.css"],"scan":["app/**/*.css","components/**/*.tsx"],"baseline":{"hex":%s,"spacing":%s}}\n' "$2" "$3" > "$1/.token-lint.json"; }

mk "$W/clean" 0 0
t "clean tree at baseline 0 passes (token file and comments not counted)" 0 bash "$L" "$W/clean"

mk "$W/hex" 0 0; printf '.x{ color: #ff0000; }\n' >> "$W/hex/app/page.css"
t "NEGATIVE CONTROL: one raw hex over baseline fails" 1 bash "$L" "$W/hex"

mk "$W/css" 0 0; printf '.y{ padding: 12px 16px; }\n' >> "$W/css/app/page.css"
t "NEGATIVE CONTROL: one raw CSS spacing value fails" 1 bash "$L" "$W/css"

mk "$W/tsx" 0 0; printf 'export const B = () => <p style={{ fontSize: 14 }} />;\n' > "$W/tsx/components/B.tsx"
t "NEGATIVE CONTROL: one raw inline style value fails" 1 bash "$L" "$W/tsx"

mk "$W/two" 1 1; printf 'export const C = () => <p style={{ fontSize: 14, lineHeight: 1.4 }} />;\n' > "$W/two/components/C.tsx"
t "NEGATIVE CONTROL: two raw values on one line count as two (baseline 1 fails)" 1 bash "$L" "$W/two"

mk "$W/at" 1 1; printf '.x{ color: #fff; padding: 4px; }\n' >> "$W/at/app/page.css"
t "a count equal to its baseline passes" 0 bash "$L" "$W/at"

mk "$W/down" 5 5; printf '.x{ color: #fff; }\n' >> "$W/down/app/page.css"
t "--update-baseline lowers the recorded counts" 0 bash "$L" "$W/down" --update-baseline
grep -q '"hex": 1' "$W/down/.token-lint.json" && grep -q '"spacing": 0' "$W/down/.token-lint.json" \
  && { echo "ok   - the lowered baseline was written (hex 1, spacing 0)"; PASS=$((PASS+1)); } \
  || { echo "FAIL - baseline not written as lowered"; FAIL=$((FAIL+1)); }

mk "$W/up" 0 0; printf '.x{ margin: 8px; }\n' >> "$W/up/app/page.css"; before="$(cat "$W/up/.token-lint.json")"
t "NEGATIVE CONTROL: --update-baseline refuses to raise a count" 1 bash "$L" "$W/up" --update-baseline
[ "$before" = "$(cat "$W/up/.token-lint.json")" ] && { echo "ok   - a refused update leaves the config untouched"; PASS=$((PASS+1)); } \
  || { echo "FAIL - refused update changed the config"; FAIL=$((FAIL+1)); }

mk "$W/first" 0 0; printf '{"tokens":["app/globals.css"],"scan":["app/**/*.css"]}\n' > "$W/first/.token-lint.json"
t "no baseline yet is not a pass (exit 2)" 2 bash "$L" "$W/first"
t "first wiring records today's counts" 0 bash "$L" "$W/first" --update-baseline

mkdir -p "$W/none"; t "no config is not a pass (exit 2)" 2 bash "$L" "$W/none"
mk "$W/empty" 0 0; printf '{"tokens":[],"scan":["nothing/**/*.css"],"baseline":{"hex":0,"spacing":0}}\n' > "$W/empty/.token-lint.json"
t "patterns matching no file are not a pass (exit 2)" 2 bash "$L" "$W/empty"

echo "---"; echo "token-lint tests: $PASS passed, $FAIL failed"; [ "$FAIL" -eq 0 ]
