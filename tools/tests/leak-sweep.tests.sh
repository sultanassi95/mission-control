#!/usr/bin/env bash
# Tests for tools/leak-sweep.sh's deny-list. Each case reads the output, not
# only the exit status: a harness that died before reporting also exits
# non-zero. The terms here are invented; a real one would ship with the test.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; PASS=0; FAIL=0
SWEEP="$HERE/../leak-sweep.sh"
# A list named in the caller's environment would stand in for the ones these
# cases name or leave missing; the two cases that need the override set it.
unset LEAK_SWEEP_PRIVATE_LIST

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
# The portfolios below are plain folders. A git repository above the temp
# folder would hand the sweep its file list instead, so git stops looking here.
export GIT_CEILING_DIRECTORIES="$W"

# A portfolio as the sweep sees one: the script in tools/, the instance in
# _command/ beside it, and a few files that ship.
portfolio() { local p="$1"; mkdir -p "$p/tools" "$p/_command" "$p/framework" "$p/.claude/skills/demo"
  cp "$SWEEP" "$p/tools/leak-sweep.sh"
  printf '%s\n' '# Framework' 'Plain text.' > "$p/framework/a.md"
  printf '%s\n' '# Demo skill' 'Plain text.' > "$p/.claude/skills/demo/SKILL.md"
  for f in README.md LIFTOFF.md CLAUDE.md CHANGELOG.md; do printf '%s\n' "# $f" > "$p/$f"; done
  printf '%s\n' '# Hub' 'Plain text.' > "$p/_command/hub.md"; }

portfolio "$W/a"
printf '%s\n' '# what never ships' 'zebracorp' 'quill-api' > "$W/a/_command/leak-sweep.private.txt"
printf '%s\n' '# Demo skill' 'Example: the zebracorp report.' > "$W/a/.claude/skills/demo/SKILL.md"
printf '%s\n' '# Framework' 'Built at ZEBRACORP.' > "$W/a/framework/a.md"
t "a deny-list term in a shipped file fails the sweep, naming file, line and term" 1 ".claude/skills/demo/SKILL.md:2: [private-term] zebracorp" -- bash "$W/a/tools/leak-sweep.sh" promote "$W/a"
t "the term matches whatever its case" 1 "framework/a.md:2: [private-term] zebracorp" -- bash "$W/a/tools/leak-sweep.sh" promote "$W/a"

portfolio "$W/b"
printf '%s\n' 'zebracorp' > "$W/b/_command/leak-sweep.private.txt"
t "the clean line counts the terms and names the list it read" 0 "PrivateTerms=1 from $W/b/_command/leak-sweep.private.txt" -- bash "$W/b/tools/leak-sweep.sh" promote "$W/b"

portfolio "$W/c"
t "NEGATIVE CONTROL: no deny-list in the instance, so promote cannot pass (exit 2) and names the path" 2 "no private deny-list at '$W/c/_command/leak-sweep.private.txt'" -- bash "$W/c/tools/leak-sweep.sh" promote "$W/c"

portfolio "$W/d"
printf '%s\n' 'zebracorp' > "$W/d/tools/leak-sweep.private.txt"
t "a list left at the old tools/ path is not read, and the error says to move it" 2 "sits at the old path" -- bash "$W/d/tools/leak-sweep.sh" promote "$W/d"

portfolio "$W/e"
printf '%s\n' '# Demo skill' 'Example: quill-api.' > "$W/e/.claude/skills/demo/SKILL.md"
printf '%s\n' 'quill-api' > "$W/elsewhere.txt"
t "LEAK_SWEEP_PRIVATE_LIST names a list outside the instance" 1 "[private-term] quill-api" -- env LEAK_SWEEP_PRIVATE_LIST="$W/elsewhere.txt" bash "$W/e/tools/leak-sweep.sh" promote "$W/e"

portfolio "$W/f"
t "an empty list is a choice: it loads no terms and the sweep can pass" 0 "PrivateTerms=0 from /dev/null" -- env LEAK_SWEEP_PRIVATE_LIST=/dev/null bash "$W/f/tools/leak-sweep.sh" promote "$W/f"

portfolio "$W/g"
printf '%s\n' 'zebracorp' > "$W/g/_command/leak-sweep.private.txt"
printf '%s\n' '# Hub' 'The zebracorp front.' > "$W/g/_command/hub.md"
t "instance mode does not read the deny-list: an instance names its own fronts" 0 "does not read it" -- bash "$W/g/tools/leak-sweep.sh" instance "$W/g"

# promote reads every file that ships, not a list of folders. A list once left
# tools/ unread, so real names in its tests and comments passed.
portfolio "$W/h"
printf '%s\n' 'zebracorp' > "$W/h/_command/leak-sweep.private.txt"
mkdir -p "$W/h/tools/mods/demo"
printf '%s\n' "test('x', () => {" "  expect(seat('console-zebracorp')).toBe(1)" '})' > "$W/h/tools/mods/demo/demo.test.ts"
t "a term in tools/, outside every folder the old list named, fails by file, line and term" 1 "tools/mods/demo/demo.test.ts:2: [private-term] zebracorp" -- bash "$W/h/tools/leak-sweep.sh" promote "$W/h"

portfolio "$W/i"
printf '%s\n' 'zebracorp' > "$W/i/_command/leak-sweep.private.txt"
printf '%s\n' '# Hub' 'The zebracorp front.' > "$W/i/_command/hub.md"
t "promote does not read the instance, which names its own fronts" 0 "every file under the root" -- bash "$W/i/tools/leak-sweep.sh" promote "$W/i"

portfolio "$W/j"
printf '%s\n' 'zebracorp' > "$W/j/_command/leak-sweep.private.txt"
printf 'PNG\000zebracorp\n' > "$W/j/framework/shot.png"
t "a binary file is not read, and the clean line counts it" 0 "not read: 1 binary or empty, 0 skipped by name" -- bash "$W/j/tools/leak-sweep.sh" promote "$W/j"

portfolio "$W/k"
printf '%s\n' 'zebracorp' > "$W/k/_command/leak-sweep.private.txt"
mkdir -p "$W/k/tools/tests/fixtures/dirty"
printf '%s\n' 'Planted: zebracorp.' > "$W/k/tools/tests/fixtures/dirty/planted.md"
t "the fixtures that plant a leak on purpose are skipped, and counted" 0 "0 binary or empty, 1 skipped by name" -- bash "$W/k/tools/leak-sweep.sh" promote "$W/k"

# The locale is forced here because the failure lives in one: under UTF-8, the
# BSD grep macOS ships matches nothing on a line holding a Windows-1252 byte.
portfolio "$W/l"
printf '%s\n' 'zebracorp' > "$W/l/_command/leak-sweep.private.txt"
printf 'Plain text.\nIt\222s the zebracorp report.\n' > "$W/l/framework/cp1252.md"
t "a term on a line that is not UTF-8 still fails the sweep" 1 "framework/cp1252.md:2: [private-term] zebracorp" -- env LC_ALL=en_US.UTF-8 LANG=en_US.UTF-8 bash "$W/l/tools/leak-sweep.sh" promote "$W/l"

# The sweep reads bytes, where a letter outside ASCII is neither a word
# character nor folded to its other case. Octal keeps this file ASCII.
portfolio "$W/m"
printf 'zo\303\253\n' > "$W/m/_command/leak-sweep.private.txt"
printf '# Framework\nBuilt at ZO\303\213\n' > "$W/m/framework/a.md"
t "a term outside ASCII matches whatever its case, at the end of a line" 1 "$(printf 'framework/a.md:2: [private-term] zo\303\253')" -- bash "$W/m/tools/leak-sweep.sh" promote "$W/m"

portfolio "$W/n"
printf '  zebracorp \r\n' > "$W/n/_command/leak-sweep.private.txt"
printf '%s\n' '# Framework' 'The zebracorp report.' > "$W/n/framework/a.md"
t "a padded term in a list saved with Windows line endings still matches" 1 "framework/a.md:2: [private-term] zebracorp" -- bash "$W/n/tools/leak-sweep.sh" promote "$W/n"

portfolio "$W/o"
printf '%s\n' 'zebracorp' > "$W/o/_command/leak-sweep.private.txt"
printf '%s\n' '# Framework' 'seat: zebracorp  <!-- MC-LEAK-EXEMPT: test data -->' > "$W/o/framework/a.md"
t "the exempt marker never hides a deny-list term" 1 "framework/a.md:2: [private-term] zebracorp" -- bash "$W/o/tools/leak-sweep.sh" promote "$W/o"

portfolio "$W/p"
printf '%s\n' 'zebracorp' > "$W/p/_command/leak-sweep.private.txt"
printf '%s\n' 'zebracorp' > "$W/p/framework/leak-sweep.private.txt"
t "a deny-list among the files that ship fails the sweep" 1 "framework/leak-sweep.private.txt: [private-list]" -- bash "$W/p/tools/leak-sweep.sh" promote "$W/p"

portfolio "$W/q"
printf '%s\n' 'zebracorp' > "$W/q/_command/leak-sweep.private.txt"
printf '%s\n' '# Remotes' 'git@github.com:acme/widgets.git' 'ssh://deploy@git.example.org/acme.git' 'ops@example.com, a@b.test' > "$W/q/framework/a.md"
t "a git remote's user and the domains reserved for examples are not addresses" 0 "LEAK-SWEEP CLEAN" -- bash "$W/q/tools/leak-sweep.sh" promote "$W/q"

portfolio "$W/r"
printf '%s\n' 'zebracorp' > "$W/r/_command/leak-sweep.private.txt"
printf '%s\n' '# Contact' 'Write to ops@example-mail.com.' > "$W/r/framework/a.md" # MC-LEAK-EXEMPT: a planted address
t "an address on a domain that only resembles a reserved one is flagged" 1 "framework/a.md:2: [email] ops@example-mail.com" -- bash "$W/r/tools/leak-sweep.sh" promote "$W/r" # MC-LEAK-EXEMPT: a planted address

echo "---"; echo "leak-sweep tests: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
