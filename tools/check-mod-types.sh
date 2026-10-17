#!/usr/bin/env bash
# Type-check a Claude Code mod against the plugin types its engine writes.
#
#   bash tools/check-mod-types.sh [MOD] [--types DIR]
#
# MOD defaults to tools/mods/mission-fleet. The engine writes its types to
# MOD/.claude-plugin/types (gitignored) wherever it loads the mod, so a fresh
# clone or a worktree has none: pass --types with the types folder of a copy
# the engine has loaded, such as the operating workspace's. The check runs a
# pinned TypeScript through npx (the first run fetches it, so it needs the
# network once) over MOD's hooks, types and tests, with the compiler options
# of that folder's tsconfig.json, as the engine wrote them.
#
# Exit 0: no type errors. 1: type errors in MOD's files (tsc's lines, then a
# count). 2: cannot run: no mod, no types folder, TypeScript did not start,
# or tsc stopped on its configuration or found no files to check. A check
# that cannot run is reported, never counted as a pass.
set -uo pipefail
TS_VERSION=5.6.3

mod_arg="tools/mods/mission-fleet"; types=""
while [ $# -gt 0 ]; do
  case "$1" in
    --types)
      [ $# -ge 2 ] && [ -n "$2" ] || { echo "CHECK-MOD-TYPES cannot run: --types needs a folder"; exit 2; }
      types="$2"; shift 2 ;;
    --types=*) types="${1#--types=}"; shift ;;
    -h|--help) sed -n '2,17p' "$0"; exit 0 ;;
    *) mod_arg="$1"; shift ;;
  esac
done

mod="$(cd "$mod_arg" 2>/dev/null && pwd)" || { echo "CHECK-MOD-TYPES cannot run: no mod folder at $mod_arg"; exit 2; }
[ -n "$types" ] || types="$mod/.claude-plugin/types"
if [ ! -f "$types/tsconfig.json" ]; then
  echo "CHECK-MOD-TYPES cannot run: no engine types at $types"
  echo "  The engine writes them where it loads the mod; pass --types <a loaded copy's .claude-plugin/types>."
  exit 2
fi
types="$(cd "$types" && pwd)"
engine="$(sed -n 's|^// Written by \(.*\)\.$|\1|p' "$types"/*/index.d.ts 2>/dev/null | head -1)"
[ -n "$engine" ] || engine="engine version not stated"

# A path as a JSON string: backslashes, then double quotes, escaped.
json() { printf '"%s"' "$(printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')"; }

tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
# The base config's typeRoots resolve from its own folder; include is replaced
# so that the mod checked is MOD, not the copy that sits beside the types.
printf '{ "extends": %s, "include": [%s, %s, %s] }\n' "$(json "$types/tsconfig.json")" \
  "$(json "$mod/hooks")" "$(json "$mod/types")" "$(json "$mod/tests")" > "$tmp/tsconfig.json"

# tsc names each file relative to where it runs: from / that is the whole path
# without its leading slash, which goes back on here.
out="$(cd / && npx --yes -p "typescript@$TS_VERSION" tsc -p "$tmp/tsconfig.json" --pretty false 2>&1)"
rc=$?
out="$(printf '%s\n' "$out" | sed -E 's#^([^ /].*\([0-9]+,[0-9]+\): error TS[0-9]+)#/\1#')"
printf '%s\n' "$out" | grep -v '^$'
errors="$(printf '%s\n' "$out" | grep -c 'error TS[0-9]')"
# An error counts as the mod's when tsc places it in one of MOD's own files.
in_mod="$(printf '%s\n' "$out" | M="$mod/" P="$mod/.claude-plugin/" awk '
  index($0, ENVIRON["M"]) == 1 && index($0, ENVIRON["P"]) != 1 && /\([0-9]+,[0-9]+\): error TS[0-9]/ { n++ }
  END { print n + 0 }')"

if [ "$rc" -eq 0 ]; then
  echo "CHECK-MOD-TYPES CLEAN: $mod against $types ($engine, TypeScript $TS_VERSION)"
  exit 0
fi
if [ "$errors" -gt "$in_mod" ]; then
  echo "CHECK-MOD-TYPES cannot run: tsc reported $((errors - in_mod)) error(s) outside $mod's files (its configuration, or no files to check)"
  exit 2
fi
if [ "$in_mod" -gt 0 ]; then
  echo "CHECK-MOD-TYPES FAILED: $in_mod error(s) in $mod against $types ($engine, TypeScript $TS_VERSION)"
  exit 1
fi
echo "CHECK-MOD-TYPES cannot run: TypeScript $TS_VERSION did not start through npx (exit $rc)"
exit 2
