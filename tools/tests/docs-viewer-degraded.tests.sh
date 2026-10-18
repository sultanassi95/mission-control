#!/usr/bin/env bash
# The docs-viewer's optional mermaid renderer, absent and present (framework/engineering-standard.md,
# "Optional augmentation"). The server under test is the one the skill ships: the Step 3 code block of
# .claude/skills/docs-viewer/SKILL.md, or of the file DOCS_VIEWER_SKILL names.
#
# Absent: a project root with no node_modules/.bin/mmdc. Every document is listed and served, the mermaid
# block as its source, and stderr carries the named line.
# Present: MC_MMDC names an mmdc (an install of @mermaid-js/mermaid-cli), linked into the root's
# node_modules/.bin. The block is served as a reference to an SVG that exists, and no named line appears.
# Without MC_MMDC the present run cannot happen, so the check prints CANNOT VERIFY and exits 2: a check
# that never found the tool must not pass as one that masked it.
#
# Run: MC_MMDC=/path/to/node_modules/.bin/mmdc bash tools/tests/docs-viewer-degraded.tests.sh
# mmdc drives a browser; an install made with PUPPETEER_SKIP_DOWNLOAD=1 also needs PUPPETEER_EXECUTABLE_PATH.
# The server opens a browser on start; here `open` and `xdg-open` are no-ops on its PATH.
set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
skill="${DOCS_VIEWER_SKILL:-$repo/.claude/skills/docs-viewer/SKILL.md}"
LINE='DEGRADED: mmdc unavailable - mermaid blocks served as source'

if [ -z "${MC_MMDC:-}" ] || [ ! -x "$MC_MMDC" ]; then
  echo "CANNOT VERIFY: MC_MMDC does not name an executable mmdc, so the present run cannot happen and an absent run alone proves nothing."
  echo "  Install @mermaid-js/mermaid-cli somewhere and set MC_MMDC to its node_modules/.bin/mmdc."
  exit 2
fi

work="$(mktemp -d "${TMPDIR:-/tmp}/dv-degraded.XXXXXX")"
pid=""
cleanup() { [ -n "$pid" ] && kill "$pid" 2>/dev/null; rm -rf "$work"; }
trap cleanup EXIT

awk '/^## Step 3/{s=1} s && /^```js$/{c=1; next} c && /^```$/{exit} c{print}' "$skill" > "$work/server.cjs"
if ! grep -q 'function generateMermaidImages' "$work/server.cjs"; then
  echo "CANNOT VERIFY: no server template found in the Step 3 code block of $skill"
  exit 2
fi

mkdir -p "$work/bin"
for b in open xdg-open; do printf '#!/bin/sh\nexit 0\n' > "$work/bin/$b"; chmod +x "$work/bin/$b"; done

pass=0; fail=0
ok()  { pass=$((pass + 1)); echo "  ok   $1"; }
bad() { fail=$((fail + 1)); echo "  FAIL $1"; }
check() { if eval "$2"; then ok "$1"; else bad "$1"; fi; }

make_root() {
  mkdir -p "$1/notes"
  printf '# Plan\n\n```mermaid\nflowchart LR\n  A --> B\n```\n' > "$1/plan.md"
  printf '# Notes\n\nNo diagram here.\n' > "$1/notes/plain.md"
  printf '<!doctype html><title>viewer</title>\n' > "$1/docs-viewer.html"
  cp "$work/server.cjs" "$1/docs-viewer-server.cjs"
}

# Starts the server in $1 on a free port at or above $2; sets pid and port.
start() {
  (cd "$1" && PATH="$work/bin:$PATH" exec node docs-viewer-server.cjs --port="$2" > "$1/out.txt" 2> "$1/err.txt") &
  pid=$!
  port=""
  for _ in $(seq 1 100); do
    port="$(sed -n 's#.*Serving docs at http://localhost:\([0-9][0-9]*\).*#\1#p' "$1/out.txt" 2>/dev/null | head -1)"
    [ -n "$port" ] && return 0
    sleep 0.1
  done
  return 1
}
stop() { kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null; pid=""; }
get() { curl -s -o "$2" -w '%{http_code} %{content_type}' "http://127.0.0.1:$port$1"; }
base=$((47000 + RANDOM % 2000))

echo "absent: no mmdc in the project"
absent="$work/absent"; make_root "$absent"
if start "$absent" "$base"; then
  for _ in $(seq 1 50); do grep -qxF "$LINE" "$absent/err.txt" && break; sleep 0.1; done
  check "absent run: stderr carries the named line, exactly" "grep -qxF '$LINE' '$absent/err.txt'"
  get /api/files "$absent/files.json" > /dev/null
  check "absent run: every document is listed" "grep -q '\"plan.md\"' '$absent/files.json' && grep -q '\"notes/plain.md\"' '$absent/files.json'"
  check "absent run: the mermaid document is served, its block as source" "[ \"\$(get /plan.md '$absent/plan.out')\" = '200 text/plain; charset=utf-8' ] && grep -qx '\`\`\`mermaid' '$absent/plan.out' && grep -q 'A --> B' '$absent/plan.out'"
  check "absent run: the plain document is served" "[ \"\$(get /notes/plain.md '$absent/plain.out')\" = '200 text/plain; charset=utf-8' ] && grep -q 'No diagram here.' '$absent/plain.out'"
  stop
else
  bad "absent run: the server started"; stop
fi

echo "present: mmdc from MC_MMDC"
present="$work/present"; make_root "$present"
mkdir -p "$present/node_modules/.bin"; ln -s "$MC_MMDC" "$present/node_modules/.bin/mmdc"
if start "$present" "$((base + 50))"; then
  for _ in $(seq 1 900); do grep -q 'Mermaid: done\.' "$present/out.txt" && break; sleep 0.1; done
  check "present run: the diagram rendered" "grep -q 'Mermaid: done\.' '$present/out.txt' && ! grep -q 'Mermaid: ✗' '$present/err.txt'"
  check "present run: no named line" "! grep -qF 'DEGRADED:' '$present/err.txt'"
  get /plan.md "$present/plan.out" > /dev/null
  check "present run: the block is served as a reference to its SVG" "grep -qxF '![Mermaid diagram 0](/.docs-viewer-cache/plan.md-mermaid-0.svg)' '$present/plan.out' && ! grep -q '\`\`\`mermaid' '$present/plan.out'"
  check "present run: the SVG is served" "[ \"\$(get /.docs-viewer-cache/plan.md-mermaid-0.svg '$present/plan.svg')\" = '200 image/svg+xml' ] && grep -q '<svg' '$present/plan.svg'"
  check "present run: the plain document is served" "[ \"\$(get /notes/plain.md '$present/plain.out')\" = '200 text/plain; charset=utf-8' ]"
  stop
else
  bad "present run: the server started"; stop
fi

echo "---"
echo "docs-viewer-degraded tests: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
