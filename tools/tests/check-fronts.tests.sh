#!/usr/bin/env bash
# Tests for tools/check-fronts.sh: each front's folder holds its repositories,
# fronts/<front>/<repo>. A front folder that is itself a repository and a
# worktree at the top of fronts/ are each reported by name with the fix, and
# the corrected layout is clean. git reads a path after git -C <repo> from
# that repository, so the printed git commands name paths relative to it
# (in full for a repository outside the portfolio). The fixtures write what git writes: a
# repository's .git folder (or a bare repository's HEAD, objects/ and refs/),
# and for a linked worktree its .git file plus the commondir and gitdir files
# in the repository's worktrees/<id>.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; C="$HERE/../check-fronts.sh"; PASS=0; FAIL=0
W="$(cd "$(mktemp -d)" && pwd -P)"; trap 'chmod -R u+rwx "$W" 2>/dev/null; rm -rf "$W"' EXIT
gitdir() { mkdir -p "$1/objects" "$1/refs"; echo 'ref: refs/heads/main' > "$1/HEAD"; }
repo() { gitdir "$1/.git"; }
link() { # link <git dir> <worktree> [<gitdir as the .git file states it>]
  local id; id="$(basename "$2")"; mkdir -p "$1/worktrees/$id" "$2"
  echo '../..' > "$1/worktrees/$id/commondir"; echo "$2/.git" > "$1/worktrees/$id/gitdir"
  echo "gitdir: ${3:-$1/worktrees/$id}" > "$2/.git"; }
wt() { link "$1/.git" "$2" "${3:-}"; } # wt <main repo> <worktree> [<gitdir line>]
run() { out="$(bash "$C" "$1" 2>&1)"; rc=$?; }
ok() { echo "ok   - $1"; PASS=$((PASS+1)); }
no() { echo "FAIL - $1"; FAIL=$((FAIL+1)); }
exits() { [ "$rc" -eq "$2" ] && ok "$1" || no "$1 (want exit $2, got $rc)"; }
says() { printf '%s\n' "$out" | grep -qF -- "$2" && ok "$1" || no "$1 (missing: $2)"; }
omits() { printf '%s\n' "$out" | grep -qF -- "$2" && no "$1 (unexpected: $2)" || ok "$1"; }

# The old layout: the front's folder IS the repository, and a worktree sits beside it at the top.
O="$W/old"; repo "$O/fronts/solo"; wt "$O/fronts/solo" "$O/fronts/solo-wt"
repo "$O/fronts/duo/api"; repo "$O/fronts/duo/web"; mkdir -p "$O/fronts/notes"; echo brief > "$O/fronts/notes/brief.md"
run "$O"
exits "NEGATIVE CONTROL: the old layout fails (exit 1)" 1
says "names the front folder that is a repository" "fronts/solo is itself a git repository"
says "names its fix: the repository moves inside the front's folder" "mv fronts/solo fronts/solo.move && mkdir fronts/solo && mv fronts/solo.move fronts/solo/solo"
says "names the repair its linked worktrees need after the move" "It has 1 linked worktree(s): after the move, run git -C fronts/solo/solo worktree repair"
says "names the worktree at the top of fronts/" "fronts/solo-wt is a worktree of fronts/solo"
says "names its fix: git worktree move into the front's folder" "git -C fronts/solo/solo worktree move ../../solo-wt ../solo-wt"
omits "a path after git -C is read from that repository, never from the portfolio root" "worktree move fronts/"
says "counts both problems" "CHECK-FRONTS FAILED: 2 problem(s)"
says "says where to run the fixes from" "Run each fix from $O"
omits "a front folder holding two repositories is not reported" "fronts/duo"
omits "a front folder with no repository is not reported" "fronts/notes"

# A repository with a worktree inside it: that worktree moves with it, so the repair names its new path.
I="$W/inner"; repo "$I/fronts/solo"; wt "$I/fronts/solo" "$I/fronts/solo/.worktrees/fix"; wt "$I/fronts/solo" "$I/fronts/solo-wt"
run "$I"
says "names the new path of a worktree that moves with its repository" "It has 2 linked worktree(s): after the move, run git -C fronts/solo/solo worktree repair .worktrees/fix."
omits "a repair path is read from that repository, never from the portfolio root" "worktree repair fronts/"

# The corrected layout: every repository and worktree inside its front's folder.
N="$W/new"; repo "$N/fronts/solo/solo"; wt "$N/fronts/solo/solo" "$N/fronts/solo/solo-wt"
wt "$N/fronts/solo/solo" "$N/fronts/solo/solo/.worktrees/fix"
repo "$N/fronts/duo/api"; repo "$N/fronts/duo/web"; mkdir -p "$N/fronts/notes"
run "$N"
exits "the corrected layout passes (exit 0)" 0
says "reports clean" "CHECK-FRONTS CLEAN: 3 front folder(s)"
omits "no worktree inside a front's folder is reported" "worktree of"

# A worktree whose .git file states a relative gitdir (git worktree add --relative-paths).
R="$W/rel"; repo "$R/fronts/app/app"; wt "$R/fronts/app/app" "$R/fronts/app-wt" "../app/app/.git/worktrees/app-wt"
run "$R"
exits "a worktree at the top fails on its own (exit 1)" 1
says "resolves a relative gitdir to its repository" "fronts/app-wt is a worktree of fronts/app/app"
says "moves it beside its repository" "git -C fronts/app/app worktree move ../../app-wt ../app-wt"
omits "the repository inside its front's folder is not reported" "fronts/app is itself"

# A worktree at the top of fronts/ whose repository lives outside fronts/.
X="$W/ext"; repo "$W/away/lib"; wt "$W/away/lib" "$X/fronts/lib-wt"
run "$X"
says "names a repository outside the portfolio by its full path" "fronts/lib-wt is a worktree of $W/away/lib"
says "marks the front it serves as a placeholder, not a shell redirection" "worktree move $X/fronts/lib-wt $X/fronts/FRONT/lib-wt"
omits "prints no angle-bracket placeholder in a command" "fronts/<front>"

# A .git file that names no worktree (a separate git directory) is a repository too.
S="$W/sep"; mkdir -p "$S/store/mod.git" "$S/fronts/mod"; echo "gitdir: $S/store/mod.git" > "$S/fronts/mod/.git"
run "$S"
says "a .git file naming a separate git directory is a repository" "fronts/mod is itself a git repository"

# A bare repository at the top of fronts/, with a worktree beside it (the bare-plus-worktrees habit).
B="$W/bare"; gitdir "$B/fronts/app.git"; link "$B/fronts/app.git" "$B/fronts/app-main"
run "$B"
says "a bare repository at the top is a repository" "fronts/app.git is itself a git repository"
says "houses a bare repository in its front's folder" "mkdir -p fronts/app && mv fronts/app.git fronts/app/app.git"
says "moves its worktree beside it" "git -C fronts/app/app.git worktree move ../../app-main ../app-main"
omits "never moves a worktree into a bare repository" "fronts/app.git/app-main"

# Mid-migration: the repository moved by hand and git worktree repair has not run yet.
T="$W/stale"; repo "$T/fronts/solo/solo"; link "$T/fronts/solo/solo/.git" "$T/fronts/solo-wt" "$T/fronts/solo/.git/worktrees/solo-wt"
run "$T"
exits "a worktree whose repository moved fails (exit 1)" 1
says "names a worktree whose repository moved" "fronts/solo-wt is a worktree whose repository has moved"
says "names the repair, then the move" "git -C fronts/solo/solo worktree repair, then git -C fronts/solo/solo worktree move ../../solo-wt ../solo-wt"
omits "never prints a command through the old path" "git -C fronts/solo worktree"
G="$W/gone"; mkdir -p "$G/fronts/orphan"; echo "gitdir: $W/nowhere/.git/worktrees/orphan" > "$G/fronts/orphan/.git"
run "$G"
says "names a worktree whose repository is missing" "fronts/orphan is a worktree whose repository has moved or is missing"
V="$W/barestale"; gitdir "$V/fronts/app/app.git"; link "$V/fronts/app/app.git" "$V/fronts/app-main" "$V/fronts/app.git/worktrees/app-main"
gitdir "$V/fronts/lib/lib"; link "$V/fronts/lib/lib" "$V/fronts/lib-main" "$V/fronts/lib/worktrees/lib-main"
run "$V"
says "names the repair, then the move, for a moved bare repository" "git -C fronts/app/app.git worktree repair, then git -C fronts/app/app.git worktree move ../../app-main ../app-main"
says "and for a bare repository named without .git" "git -C fronts/lib/lib worktree repair, then git -C fronts/lib/lib worktree move ../../lib-main ../lib-main"

# A folder name with a space: the printed commands quote it, so they run as pasted.
Q="$W/quote"; repo "$Q/fronts/my app"; wt "$Q/fronts/my app" "$Q/fronts/my app-wt"
run "$Q"
says "quotes a repository path with a space in its fix" "mv 'fronts/my app' 'fronts/my app.move' && mkdir 'fronts/my app' && mv 'fronts/my app.move' 'fronts/my app/my app'"
says "quotes a worktree path with a space in its fix" "git -C 'fronts/my app/my app' worktree move '../../my app-wt' '../my app-wt'"

# The temporary name is free: an existing fronts/<name>.move would swallow the repository.
K="$W/taken"; repo "$K/fronts/solo"; mkdir -p "$K/fronts/solo.move"
run "$K"
says "picks a temporary name that is not taken" "mv fronts/solo fronts/solo.move-2 && mkdir fronts/solo && mv fronts/solo.move-2 fronts/solo/solo"

# A symlinked fronts/ resolves like the folder it points at.
L="$W/link"; repo "$W/real/app/app"; wt "$W/real/app/app" "$W/real/app-wt"; mkdir -p "$L"; ln -s "$W/real" "$L/fronts"
run "$L"
says "follows a symlinked fronts/" "fronts/app-wt is a worktree of fronts/app/app"

# Errors are exit 2, never a pass and never mistaken for problems: no root, fronts/ a file, an unreadable folder.
mkdir -p "$W/clone"; run "$W/clone"
exits "no fronts/ folder passes (exit 0)" 0
says "says there was nothing to check" "no fronts/ folder"
run "$W/missing"
exits "a missing root is an error, not a pass (exit 2)" 2
mkdir -p "$W/flat"; echo x > "$W/flat/fronts"; run "$W/flat"
exits "a fronts/ that is a file is an error, not a pass (exit 2)" 2
U="$W/locked"; repo "$U/fronts/solo"; mkdir -p "$U/fronts/solo/.git/worktrees"; chmod 000 "$U/fronts/solo/.git/worktrees"
run "$U"
exits "an unreadable folder is an error (exit 2)" 2
says "names what it could not read" "check-fronts: cannot read"
chmod 755 "$U/fronts/solo/.git/worktrees"

echo "---"; echo "check-fronts tests: $PASS passed, $FAIL failed"; [ "$FAIL" -eq 0 ]
