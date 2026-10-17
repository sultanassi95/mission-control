#!/usr/bin/env bash
# Tests for tools/check-mod-types.sh. Each case reads the output, not only the
# exit status: a harness that died before reporting also exits non-zero.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; PASS=0; FAIL=0
CHECK="$HERE/../check-mod-types.sh"

# t <name> <want exit> <text the output must hold> -- <command...>
t() { local name="$1" want="$2" text="$3"; shift 4; local out got
  out="$("$@" 2>&1)"; got=$?
  if [ "$got" -eq "$want" ] && printf '%s' "$out" | grep -qF -- "$text"; then
    echo "ok   - $name"; PASS=$((PASS+1))
  else
    echo "FAIL - $name (want exit $want and \"$text\", got exit $got)"; printf '%s\n' "$out" | sed 's/^/       /'
    FAIL=$((FAIL+1))
  fi; }

W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT

# A fake engine types folder, shaped as the engine writes one: a tsconfig that
# names its packages by typeRoots "." and includes the mod beside it.
types() { local d="$1"; mkdir -p "$d/fake-engine"
  printf '%s\n' '// Written by Fake Engine 0.0.1.' 'declare function engineCall(name: string): number;' > "$d/fake-engine/index.d.ts"
  printf '%s\n' '{ "compilerOptions": { "strict": true, "noEmit": true, "skipLibCheck": true,' \
    '  "typeRoots": ["."], "types": ["fake-engine"], "target": "es2022", "module": "esnext", "moduleResolution": "bundler" },' \
    '  "include": ["../../hooks", "../../types", "../../tests"] }' > "$d/tsconfig.json"; }

mod() { local d="$1" body="$2"; mkdir -p "$d/hooks" "$d/.claude-plugin"
  printf '%s\n' "$body" > "$d/hooks/a.ts"; }

mod "$W/clean" 'export const n: number = engineCall("x")'
types "$W/clean/.claude-plugin/types"
t "a mod that matches the engine's types is clean (exit 0)" 0 "CHECK-MOD-TYPES CLEAN" -- bash "$CHECK" "$W/clean"

mod "$W/planted" 'export const s: string = engineCall("x")'
types "$W/planted/.claude-plugin/types"
t "NEGATIVE CONTROL: a planted type error fails (exit 1) and names the file" 1 "hooks/a.ts" -- bash "$CHECK" "$W/planted"
t "NEGATIVE CONTROL: the failure line counts the errors" 1 "CHECK-MOD-TYPES FAILED: 1 error" -- bash "$CHECK" "$W/planted"

mod "$W/notypes" 'export const n: number = 1'
t "a mod with no engine types cannot be checked (exit 2), never a pass" 2 "cannot run" -- bash "$CHECK" "$W/notypes"

# A worktree has no engine types of its own: --types borrows another copy's,
# and the mod checked is still the one named, not the copy beside the types.
mod "$W/worktree" 'export const s: string = engineCall("x")'
mod "$W/operating" 'export const n: number = engineCall("x")'
types "$W/operating/.claude-plugin/types"
t "--types checks the named mod against another copy's types" 1 "worktree/hooks/a.ts" -- bash "$CHECK" "$W/worktree" --types "$W/operating/.claude-plugin/types"
t "the clean line names the engine that wrote the types" 0 "Fake Engine 0.0.1" -- bash "$CHECK" "$W/operating"

# A run that cannot check the mod is reported as such, never as a pass or as the mod's errors.
# perl's alarm ends a run that hangs, so a hang reads as exit 142 here rather than stalling the suite.
t "--types with no folder after it cannot run (exit 2), and does not hang" 2 "--types needs a folder" -- perl -e 'alarm 20; exec @ARGV' bash "$CHECK" "$W/clean" --types
mkdir -p "$W/fakebin"
printf '%s\n' '#!/bin/sh' 'echo "npm error could not determine executable to run" >&2' 'exit 1' > "$W/fakebin/npx"; chmod +x "$W/fakebin/npx"
t "TypeScript that does not start is reported, never a pass (exit 2)" 2 "did not start" -- env PATH="$W/fakebin:$PATH" bash "$CHECK" "$W/clean"
mkdir -p "$W/empty/.claude-plugin"; types "$W/empty/.claude-plugin/types"
t "a mod with no TypeScript files cannot be checked (exit 2), not counted as its error" 2 "cannot run: tsc reported 1 error(s) outside" -- bash "$CHECK" "$W/empty"

# A folder name with a space or a double quote still checks the named files, each named by its whole path.
mod "$W/odd dir/q\"m" 'export const s: string = engineCall("x")'
types "$W/odd dir/q\"m/.claude-plugin/types"
t "a mod under a folder with a space and a quote is checked, its file named in full" 1 "$W/odd dir/q\"m/hooks/a.ts(" -- bash "$CHECK" "$W/odd dir/q\"m"

echo "---"; echo "check-mod-types tests: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
