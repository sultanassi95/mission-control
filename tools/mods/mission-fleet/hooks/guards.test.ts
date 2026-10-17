import { expect, test } from 'claude-code/testing'

import { awaitingFlight, fleetSelfApproval, isFlightOnly, isRelayedVerb, RELAY_TTL, splitRelayCode, spendRelayCode, isShellLikeTool, pinnedDir, protectedFromSpoke, pushDestination, shellRefusal, tokenize, toolRefusal } from './guards'
import type { RelayCodes } from './guards'

const C = (cmd: string, prot: string[] = []) => shellRefusal('controller', cmd, prot)
const B = (cmd: string) => shellRefusal('back room', cmd, [])

test('the tokenizer resolves quotes and marks variables, globs and substitutions', () => {
  const p = tokenize(`git pu''sh origin "ma"in && echo $B > out`)
  expect(p.commands.map(c => c.words.map(w => w.text))).toEqual([['git', 'push', 'origin', 'main'], ['echo', '$B']])
  expect(p.commands[1]?.words[1]?.dynamic).toBe(true)
  expect(p.commands[1]?.redirects.map(w => w.text)).toEqual(['out'])
  expect(tokenize('git push origin $(x)').opaque).toBe(true)
  expect(tokenize("git commit -m \"$(cat <<'EOF'\nfix push handler\nEOF\n)\"").opaque).toBe(false)
  expect(tokenize('cat > f <<EOF\ngit push origin main\nEOF\nls').commands.map(c => c.words[0]?.text)).toEqual(['cat', 'ls'])
})

// ---- shell expansions the guard cannot read (MC-150) ----
// The Bash tool runs zsh, where $=X, $^X, $~X, ${=X} and =cmd expand to text the guard would read as literal.

test('on a line that runs git or gh, an expansion other than a plain $NAME, ${NAME} or $? is refused by name', () => {
  const NOT = 'the guard cannot read'
  // Each expands to main in zsh, so the push below is a push to main.
  for (const [ref, name] of [
    ['$=X', '$=X'], ['$^X', '$^X'], ['"$=X"', '$=X'], ['"$^X"', '$^X'], ['"$~X"', '$~X'], ['${(s:,:)X}', '${(s:,:)X}'], ['${=X}', '${=X}'],
    ['$+X', '$+X'], ['${X:-main}', '${X:-main}'], ['$1', '$1'], ['$@', '$@'], ["$'x'", "$'x'"], ['${#X}', '${#X}'], ['$$', '$$'], ['$-', '$-'],
  ] as const) {
    expect(`${ref} -> ${C(`X=main; git -C /w/fronts/acme/api push origin ${ref}`, ['main']) ?? 'allowed'}`).toContain(`${name} is a shell expansion ${NOT}`)
  }
  expect(C('gh pr view $=X')).toContain(`$=X is a shell expansion ${NOT}`)
  expect(toolRefusal('controller', 'Bash', { command: 'X=main; git -C /w/fronts/acme/api push origin $=X' }, ['main'], '/w/fronts/acme/api')).toContain(`$=X is a shell expansion ${NOT}`)
  // zsh's =cmd is the command's path: =git runs git past every git rule.
  expect(C('=git -C /w/fronts/acme/api push origin main')).toContain(`=git is a shell expansion ${NOT}`)
  expect(C("''=git push origin main")).toContain(`=git is a shell expansion ${NOT}`)
  // zsh removes the quotes from the name first: ='git', ="git" and =\git are the same path.
  expect(C("='git' -C /w/fronts/acme/api push origin main")).toContain(`='git' is a shell expansion ${NOT}`)
  expect(C('="git" -C /w/fronts/acme/api push origin main')).toContain(`="git" is a shell expansion ${NOT}`)
  expect(C('=\\git -C /w/fronts/acme/api push origin main')).toContain(`=\\git is a shell expansion ${NOT}`)
  // A quote- or backslash-spelled name runs git with no literal "git" in the text: the gate reads the parsed head too.
  expect(C("X='n push origin main'; g''it -C /w/fronts/acme/api --namespace $=X log")).toContain(`$=X is a shell expansion ${NOT}`)
  expect(C('X=main; "g"it -C /w/fronts/acme/api push origin $=X')).toContain(`$=X is a shell expansion ${NOT}`)
  expect(C('X=pr; g\\h $=X view 34')).toContain(`$=X is a shell expansion ${NOT}`)
})

test('a plain $NAME, ${NAME} or $?, quoted text and a literal $ pass as before', () => {
  // A plain variable is still a variable: allowed where it was, refused where a rule refuses one.
  expect(C('git -C /w/fronts/acme/api log $X')).toBeUndefined()
  expect(C('git -C /w/fronts/acme/api log "${X}"')).toBeUndefined()
  expect(C('X=main; git push origin $X')).toContain('push arguments must be literal')
  expect(C('git -C /w/fronts/acme/api status; echo "exit $?"')).toBeUndefined()
  // What the shell does not expand is not counted.
  expect(C("git commit -m 'costs $=X and ${=X}'")).toBeUndefined()
  expect(C("git commit -F - <<'EOF'\nmentions $=X, ${=X} and =git\nEOF")).toBeUndefined()
  expect(C('git commit -m "costs 5 $ each, or 6$"')).toBeUndefined()
  expect(C(`echo '=git' "=git"`)).toBeUndefined()
  // Inside [[ ]], == and =~ are operators; outside it they name no real command.
  expect(C('[[ main == main ]] && [[ fix/a =~ ^fix/ ]] && git -C /w/fronts/acme/api status')).toBeUndefined()
  // zsh leaves $ literal before . , / : ] } % and \, so a sed, grep or printf pattern on a git line is not an expansion.
  expect(C('git -C /w/fronts/acme/api log | sed "s/a$//"')).toBeUndefined()
  expect(C('git -C /w/fronts/acme/api log --oneline | grep "foo$."')).toBeUndefined()
  expect(C('git -C /w/fronts/acme/api log | grep "a$\\|b"')).toBeUndefined()
  expect(C('git -C /w/fronts/acme/api diff | sed -e "s/$/;/"')).toBeUndefined()
  // A line that names neither git nor gh is not refused for an expansion in an argument.
  expect(C('echo $=X ${=X} =ls')).toBeUndefined()
})

test('a word holding an expansion the guard cannot read is a variable, so it never names the command', () => {
  // zsh assembles git from two split variables on a line that names neither git nor gh.
  expect(C("X=gi; Y='t -C /w/fronts/acme/api push origin main'; $=X$=Y")).toContain('never a command name built from a variable')
  expect(C('=ls -la')).toContain('never a command name built from a variable')
  expect(tokenize('echo $=X ${=X} =ls $X').commands[0]?.words.slice(1).map(w => w.dynamic)).toEqual([true, true, true, true])
})

test('a spoke base line protects its first branch and any slashed deploy base it names', () => {
  expect(protectedFromSpoke('main')).toEqual(['main'])
  expect(protectedFromSpoke('"dev - promotion is dev -> test -> main"')).toEqual(['dev'])
  expect(protectedFromSpoke('"main - EXCEPT work on vs/3d-plane (its CI deploys); `git switch -c <name> --no-track origin/<base>`"')).toEqual(['main', 'vs/3d-plane'])
  expect(protectedFromSpoke('N/A')).toEqual([])
  expect(protectedFromSpoke(undefined)).toEqual([])
})

test('a Controller pushes only a named, literal, unprotected branch', () => {
  expect(C('git push -u origin feat/ven-1-x')).toBeUndefined()
  expect(C('git add a.ts && git commit -m x && git push -u origin HEAD:feat/y')).toBeUndefined()
  for (const cmd of [
    'git push origin main', 'npm test && git push origin main', 'git -C ../repo push origin dev', 'git push origin feat/x:main',
    'git push origin refs/heads/dev', 'git push origin feat:heads/main', 'git push origin MAIN', 'git push origin release/1.2',
  ]) expect(C(cmd)).toContain('base or deploy branch')
  expect(C('git push origin vs/3d-plane', ['vs/3d-plane'])).toContain('base or deploy branch')
  expect(C('git push')).toContain('never a bare push')
  expect(C('git push origin')).toContain('never a bare push')
  for (const cmd of ['git push --force origin feat/x', 'git push origin +feat/x', 'git push -fu origin feat/x', 'git push --force-with-lease origin feat/x']) expect(C(cmd)).toContain('force')
  expect(C('git push origin :feat/x')).toContain('deleting')
  expect(C('git push -ud origin feat/x')).toContain('deleting')
  expect(C("git push origin 'refs/heads/*:refs/heads/*'")).toContain('wildcard')
  expect(C('git push origin refs/heads/*:refs/heads/*')).toContain('literal')
  expect(C('git push origin refs/tags/v1')).toContain('branch name')
  expect(C('git push origin HEAD')).toContain('explicitly')
})

test('quote splitting, variables and substitutions cannot hide a push or a branch', () => {
  expect(C("git pu''sh origin main")).toContain('base or deploy branch')
  expect(C('git push origin ma""in')).toContain('base or deploy branch')
  expect(C('B=main; git push origin $B')).toContain('literal')
  expect(C('git push origin ${BRANCH}')).toContain('literal')
  expect(C('git push origin $(git rev-parse --abbrev-ref HEAD)')).toContain('run plainly')
  expect(C('git push origin `echo main`')).toContain('run plainly')
  expect(C('g=git; $g push origin main')).toContain('variable')
  // ANSI-C escapes are refused outright by the tokenizer (MC-116), before the literal-push rule.
  expect(C("git push origin $'\\x6dain'")).toContain('plainly')
  expect(C('git push origin ma{i,}n')).toContain('literal')
  expect(C("git $'\\x70ush' origin main")).toBeDefined()
  expect(C('git pu{s,}h origin main')).toBeDefined()
})

test('git and gh run only at the head of a command', () => {
  for (const cmd of ['echo origin main | xargs git push', 'bash -c "git push origin main"', 'sh -c \'git stash\'', 'eval "git push origin main"', 'python3 -c "import os; os.system(\'git push origin main\')"']) {
    expect(C(cmd)).toBeDefined()
  }
  for (const cmd of ['if true; then git stash; fi', '(git stash)', '{ git stash; }', '! git stash', 'command git stash', 'time git stash', 'nohup git stash', '\\git stash']) {
    expect(C(cmd)).toContain('never stashes')
  }
  expect(C('env git stash')).toContain('environment prefix')
  expect(C('git -c alias.p=push p origin main')).toContain('-c')
  expect(C('git -c remote.origin.pushurl=x push origin feat/x')).toContain('-c')
  expect(C('git p origin main')).toContain('allowlist')
  expect(C('git send-pack origin main')).toContain('allowlist')
})

// ---- git's global options (MC-147) ----
// git takes a value after some global options, so the subcommand is found only past options known by
// exact spelling; any other word before it is refused by name.

test('a git global option off the list is refused by name, since its value could pass for the subcommand', () => {
  const OFF = 'is not an allowed git global option'
  // git takes `status` as --attr-source's value and runs the push.
  expect(C('git --attr-source status push origin main')).toContain(`--attr-source ${OFF}`)
  expect(C('git -C /w/fronts/acme/api --attr-source status push origin main')).toContain(`--attr-source ${OFF}`)
  expect(B('git --attr-source log push origin feat/x')).toContain(`--attr-source ${OFF}`)
  expect(toolRefusal('controller', 'Bash', { command: 'git -C /w/fronts/acme/api --attr-source status push origin main' }, [], '/w/fronts/acme/api')).toContain(`--attr-source ${OFF}`)
  // Its = form, abbreviations, attached or clustered short forms, and options git has that the list leaves out.
  for (const opt of [
    '--attr-source=HEAD', '--attr-sour', '--no-pag', '--no-pager=1', '-Cdir', '-pP', '--C', '--git-dir-x=/w', '--bare', '--versions', '-vh',
    '--help=x', '-H', '--html-path', '--list-cmds=main', '--super-prefix=x/', '--shallow-file', '--literal-pathspec', '-', '--',
  ]) expect(`${opt} -> ${C(`git ${opt} status`) ?? 'allowed'}`).toContain(`${opt} ${OFF}`)
  // One built from a variable cannot be read at all.
  expect(C('git -$X status')).toContain(OFF)
})

test('every listed git global option still reaches the subcommand, which is checked as before', () => {
  const FLAGS = ['-p', '--paginate', '-P', '--no-pager', '--no-replace-objects', '--no-lazy-fetch', '--no-optional-locks', '--no-advice', '--literal-pathspecs', '--no-literal-pathspecs', '--glob-pathspecs', '--noglob-pathspecs', '--icase-pathspecs']
  const VALUED = ['-C /w/fronts/acme/api', '--git-dir /w/fronts/acme/api/.git', '--work-tree /w/fronts/acme/api', '--namespace scratch', '--git-dir=/w/fronts/acme/api/.git', '--work-tree=/w/fronts/acme/api', '--namespace=scratch']
  for (const opt of [...FLAGS, ...VALUED]) {
    expect(`${opt} -> ${C(`git ${opt} status`) ?? 'allowed'}`).toBe(`${opt} -> allowed`)
    expect(`${opt} -> ${C(`git ${opt} push origin main`) ?? 'allowed'}`).toContain('base or deploy branch')
    expect(`${opt} -> ${C(`git ${opt} stash`) ?? 'allowed'}`).toContain('never stashes')
  }
  // Several in a row, as git reads them.
  expect(C('git --no-pager -C /w/fronts/acme/api --namespace scratch -P log -1')).toBeUndefined()
  expect(C('git --no-pager -C /w/fronts/acme/api --namespace=scratch -P push origin main')).toContain('base or deploy branch')
  // A valued option takes the next word whatever it holds, as git does: `--namespace -c log` runs log.
  expect(C('git --namespace -c status')).toBeUndefined()
  expect(C('git --namespace -c push origin main')).toContain('base or deploy branch')
  expect(C("git --namespace '' status")).toBeUndefined()
  expect(C('git --namespace a --namespace b push origin main')).toContain('base or deploy branch')
})

test('git --version, -v, --help and -h are the version and help commands, as git runs them', () => {
  for (const opt of ['--version', '-v', '--help', '-h']) {
    expect(`${opt} -> ${C(`git ${opt}`) ?? 'allowed'}`).toBe(`${opt} -> allowed`)
    expect(`${opt} -> ${C(`git -C /w/fronts/acme/api --no-pager ${opt}`) ?? 'allowed'}`).toBe(`${opt} -> allowed`)
    // git ends its options there: `git --version push origin main` runs `version push origin main`, never a push.
    expect(`${opt} -> ${C(`git ${opt} push origin main`) ?? 'allowed'}`).toBe(`${opt} -> allowed`)
  }
  expect(toolRefusal('controller', 'Bash', { command: 'git -C /w/fronts/acme/api --version' }, [], '/w/fronts/acme/api')).toBeUndefined()
})

test('a listed git global option takes only a literal value, since the shell can make it several words', () => {
  const LIT = 'must be literal'
  // The shell makes the brace four words: git takes x as the namespace and runs push origin main.
  expect(C('git --namespace {x,push,origin,main} status')).toContain(`git --namespace ${LIT}`)
  expect(toolRefusal('controller', 'Bash', { command: 'git -C /w/fronts/acme/api --namespace {x,push,origin,main} status' }, [], '/w/fronts/acme/api')).toContain(`git --namespace ${LIT}`)
  for (const [opt, name] of [
    ['-C $D', '-C'], ['-C ~/w', '-C'], ['--git-dir $D', '--git-dir'], ['--git-dir=$D', '--git-dir'], ['--work-tree "$D"', '--work-tree'],
    ['--work-tree=/w/*', '--work-tree'], ['--namespace $X', '--namespace'], ['--namespace=$X', '--namespace'], ['--namespace *', '--namespace'], ['--namespace={a,b}', '--namespace'],
  ] as const) expect(`${opt} -> ${C(`git ${opt} status`) ?? 'allowed'}`).toContain(`git ${name} ${LIT}`)
  // A quoted value is one word, whatever it holds.
  expect(C("git --namespace 'x push origin main' status")).toBeUndefined()
  expect(C('git --namespace "{x,push}" status')).toBeUndefined()
})

test('git -c, --config-env and --exec-path keep their own refusal in every spelling', () => {
  for (const opt of ['-c core.pager=x', '--config-env=core.pager=X', '--config-env core.pager=X', '--exec-path=/tmp/x', '--exec-path']) {
    expect(`${opt} -> ${C(`git ${opt} status`) ?? 'allowed'}`).toContain('git -c, --config-env and --exec-path are not allowed')
  }
})

test('an interpreter fed by a heredoc or a pipe cannot carry a git command', () => {
  expect(C('bash <<EOF\ngit push origin main\nEOF')).toContain('bash on the same line')
  expect(C("sh <<'X'\ngit stash\nX")).toContain('sh on the same line')
  expect(C('echo "git push origin main" | bash')).toContain('bash on the same line')
  expect(C('printf "git stash" | zsh -s')).toContain('zsh on the same line')
  expect(C('python3 - <<EOF\nimport os; os.system("git push origin main")\nEOF')).toContain('python3 on the same line')
  expect(B('echo "git switch -c x" | sh')).toContain('sh on the same line')
  expect(C('node scripts/build.js && npm test')).toBeUndefined()
  expect(C('bash scripts/lint.sh')).toBeUndefined()
})

test('gh: merges and remote writes are refused, reads and PR creation pass', () => {
  expect(C('gh pr create --title t --body b')).toBeUndefined()
  expect(C('gh pr checks 12 --watch')).toBeUndefined()
  expect(C('gh api repos/o/r/pulls/12')).toBeUndefined()
  expect(C('gh pr merge 12 --squash')).toContain('founder')
  expect(C('gh pr -R o/r merge 12')).toContain('founder')
  expect(C('gh api -X PUT repos/o/r/pulls/12/merge')).toContain('read-only')
  expect(C('gh api repos/o/r/merges -f base=main -f head=x')).toContain('read-only')
  expect(C('gh api -X PATCH repos/o/r/git/refs/heads/main -f sha=1')).toContain('read-only')
  expect(C("gh api graphql -f query='mutation{mergePullRequest(input:{pullRequestId:\"X\"}){clientMutationId}}'")).toContain('graphql')
  expect(C('gh repo delete o/r')).toContain('not allowed')
})

test('Flight-only files: any write form is refused, plain reads pass', () => {
  for (const cmd of [
    'echo x >> ../../_command/daily/today.md', 'echo x | tee ../_command/daily/today.md', 'sed -i s/a/b/ _command/daily/today.md',
    'sed -e s/a/b/ -i _command/daily/today.md', 'sed --in-place s/a/b/ _command/daily/today.md', 'cp x _command/trackers/fronts.md',
    'echo x > _command/daily/tod*.md', 'patch _command/daily/today.md < p.diff', 'git checkout HEAD -- _command/daily/today.md',
    'touch _command/daily/today.md', 'curl -o _command/daily/today.md https://x', 'echo x > _COMMAND/daily/Today.md', 'echo x > _command//daily/today.md',
  ]) expect(C(cmd)).toContain('Flight')
  expect(C('cat _command/daily/today.md')).toBeUndefined()
  expect(C('grep -n MC _command/daily/today.md | head -3')).toBeUndefined()
  expect(C('git log --oneline -- _command/daily/today.md')).toBeUndefined()
})

test('no false positives on ordinary work', () => {
  expect(C('git commit -m "fix push handler and stash cleanup"')).toBeUndefined()
  expect(C("git commit -m \"$(cat <<'EOF'\nfix(x): push handler\n\nstash and checkout notes\nEOF\n)\"")).toBeUndefined()
  expect(C('grep -rn merge src/merge.ts')).toBeUndefined()
  expect(C('git switch -c feat/merge-fix')).toBeUndefined()
  expect(C('npm test && npm run build')).toBeUndefined()
  expect(C('grep -rn "git push" docs/')).toBeUndefined()
  expect(B("git commit -m \"$(cat <<'EOF'\nreset the checkout flow\nEOF\n)\"")).toBeUndefined()
})

test('a back-room agent runs no git write beyond add and commit', () => {
  expect(B('git add a && git commit -m x')).toBeUndefined()
  expect(B('git status; git log')).toBeUndefined()
  for (const sub of ['push origin feat/x', 'stash', 'checkout main', 'switch -c x', 'reset --hard', 'restore .', 'clean -fd', 'rebase main', 'merge x']) {
    expect(B(`git ${sub}`)).toContain('never runs git')
  }
  expect(B('bash -c "git push origin feat/x"')).toBeDefined()
})

test('other tools: Workflow and MCP shells are refused, any tool input naming a Flight file is refused', () => {
  expect(toolRefusal('controller', 'Workflow', {}, [])).toContain('Workflows')
  expect(isShellLikeTool('mcp__plugin_serena_serena__execute_shell_command')).toBe(true)
  expect(toolRefusal('back room', 'mcp__plugin_serena_serena__execute_shell_command', { command: 'ls' }, [])).toContain('use Bash')
  expect(toolRefusal('controller', 'Monitor', { command: 'git push origin main' }, [])).toContain('base or deploy branch')
  expect(toolRefusal('controller', 'mcp__plugin_serena_serena__create_text_file', { relative_path: '_command/daily/today.md' }, [])).toContain('Flight')
  expect(toolRefusal('controller', 'Write', { file_path: '/p/_command/daily/../daily/today.md' }, [])).toContain('Flight')
  expect(toolRefusal('controller', 'Read', { file_path: '/p/_command/daily/today.md' }, [])).toBeUndefined()
  expect(toolRefusal('controller', 'Edit', { file_path: '/p/_command/portfolio/x/progress.md' }, [])).toBeUndefined()
})

test('paths and push destinations are normalised before comparison', () => {
  expect(isFlightOnly('/p/_command/trackers/fronts.md')).toBe(true)
  expect(isFlightOnly('/P/_Command//Daily/./Today.md')).toBe(true)
  expect(isFlightOnly('/p/_command/portfolio/x/progress.md')).toBe(false)
  expect(pushDestination('HEAD:refs/heads/Main')).toBe('main')
})

test('a very long command is handled in linear time', () => {
  const long = 'git status && '.repeat(20000) + 'git push origin main'
  const t0 = Date.now()
  expect(C(long)).toContain('base or deploy branch')
  expect(Date.now() - t0).toBeLessThan(2000)
})

test('re-pass findings F1-F8: each former push to main is refused', () => {
  expect(C('cat <<EOF\n$(git push origin main)\nEOF')).toContain('run plainly')
  expect(C("echo \"$(cat <<'EOF'\na\nEOF\ngit push origin main\ncat <<'EOF'\nb\nEOF\n)\"")).toContain('run plainly')
  expect(C('x=gi; ${x}t push origin main')).toContain('variable')
  expect(C('/usr/bin/gi[t] push origin main')).toContain('glob')
  expect(C("$(printf 'g%s' it) push origin main")).toContain('run plainly')
  expect(C('git push origin \\\nmain')).toContain('base or deploy branch')
  expect(C('git push origin feature -\\\n-force')).toContain('force')
  expect(C("echo hi # '\ngit push origin main")).toContain('base or deploy branch')
  expect(C("env -S 'git push origin main'")).toContain('spaces')
  expect(C("git rebase -x 'git push origin HEAD:main' HEAD~1")).toContain('can run a command')
  expect(C("git rebase --exec='git push origin HEAD:main' HEAD~1")).toContain('can run a command')
  expect(C('git push origin --del somebranch')).toContain('--delete')
  expect(C('git push --force-w origin feature')).toContain('force')
})

test('re-pass F9: the back room runs read-only git plus add and commit', () => {
  for (const cmd of ['git branch -D x', 'git tag v1', 'git rm f', 'git mv a b', 'git fetch origin', 'git am p.patch', 'git apply p', 'git worktree add ../w', 'git notes add -m x']) {
    expect(B(cmd)).toContain('never runs git')
  }
  expect(B('git reflog expire --expire=now --all')).toContain('read-only')
  expect(B('git add -A && git commit -m x')).toBeUndefined()
})

test('re-pass F10-F11: ordinary reads and pipelines pass, git diff --output does not', () => {
  expect(C('grep -i todo _command/daily/today.md')).toBeUndefined()
  expect(C('grep -w x _command/trackers/fronts.md')).toBeUndefined()
  expect(C('grep x _command/daily/today.md | sort')).toBeUndefined()
  expect(C('git commit -m "docs: sync _command/trackers/fronts.md"')).toBeUndefined()
  expect(C('git diff --output=_command/daily/today.md')).toBeDefined()
  expect(C('git ls-files | xargs wc -l')).toBeUndefined()
  expect(C("git log --oneline | awk '{print $1}'")).toBeUndefined()
  expect(C('git pull && node build.js')).toContain('separate command')
  expect(C('node build.js')).toBeUndefined()
  expect(C('echo "git push origin main" | bash -o posix')).toBeDefined()
  expect(C('echo "git push origin main" | bash /dev/stdin')).toBeDefined()
  expect(C('git ls-files | xargs sh -c "git stash"')).toBeDefined()
})

test('environment prefixes and pager options cannot redirect git', () => {
  expect(C('GIT_SSH_COMMAND="sh -c x" git push -u origin feat/x')).toContain('environment prefix')
  expect(C('GIT_CONFIG_PARAMETERS="\'alias.push=!x\'" git status')).toContain('environment prefix')
  expect(C('env GIT_DIR=/tmp/x git status')).toContain('environment prefix')
  expect(C('git grep -O"sh -c x" foo')).toContain('can run a command')
  expect(C('git grep --open-files-in-pager=x foo')).toContain('can run a command')
  expect(C('git grep -n foo')).toBeUndefined()
  expect(C('NODE_ENV=test npm test')).toBeUndefined()
})

test('every fleet git and gh call pins its repo inside the console directory', () => {
  const P = (cmd: string) => shellRefusal('controller', cmd, [], '/w/fronts/acme')
  expect(P('git status')).toContain('Pin the repo')
  expect(P('gh pr list')).toContain('Pin the repo')
  expect(P('cd /w/fronts/acme && git status')).toBeUndefined()
  expect(P('git -C /w/fronts/acme status')).toBeUndefined()
  expect(P('cd /w/fronts/acme && cd sub && git status')).toBeUndefined()
  expect(P('cd /w/fronts/acme && gh pr checks 3')).toBeUndefined()
  expect(P('cd /w && git status')).toContain('outside your console')
  expect(P('cd /w/fronts/acme/../globex && git push -u origin feat/x')).toContain('outside your console')
  expect(P('git -C /w/fronts/acmeX status')).toContain('outside your console')
  expect(P('cd $REPO && git status')).toContain('Pin the repo')
  expect(P('cd fronts/acme && git status')).toContain('Pin the repo')
  expect(P('npm test')).toBeUndefined()
  expect(P('git -C /w/fronts/acme -C /w/fronts/globex status')).toContain('Pin the repo')
  expect(P('cd /w/fronts/acme && git --git-dir=/w/fronts/globex/.git status')).toContain('Pin the repo')
  expect(P('cd /w/fronts/acme && git --work-tree /x status')).toContain('Pin the repo')
  expect(P('cd /w/fronts/acme && pushd /w/fronts/globex && git status')).toContain('Pin the repo')
  expect(pinnedDir(tokenize('cd /a && cd ../b && git log').commands, 2)).toBe('/b')
  expect(toolRefusal('controller', 'Bash', { command: 'git status' }, [], '/w/fronts/acme')).toContain('Pin the repo')
})

test('a fleet agent cannot start another Claude session', () => {
  expect(C('claude -p --model haiku "hi"')).toContain('never starts another Claude session')
  expect(B('cd /tmp && claude -p x')).toContain('never starts another Claude session')
})

test('a pin counts only for a directly preceding cd chain, with no options or subshells', () => {
  const P = (cmd: string) => shellRefusal('controller', cmd, [], '/w/fronts/acme')
  expect(P('false && cd /w/fronts/acme; git status')).toContain('Pin the repo')
  expect(P('(cd /w/fronts/acme); git status')).toContain('Pin the repo')
  expect(P('cd /w/fronts/acme | cat; git status')).toContain('Pin the repo')
  expect(P('cd -P /w/fronts/acme && git status')).toContain('Pin the repo')
  expect(P('cd /w/fronts/acme && npm test && git status')).toContain('Pin the repo')
  expect(P('cd /w/fronts/acme/ && git status')).toBeUndefined()
  expect(P('cd /w/fronts/acme && gh -R other/repo pr list')).toContain('gh -R')
})

test('gh repo overrides in any form are refused', () => {
  const P = (cmd: string) => shellRefusal('controller', cmd, [], '/w/fronts/acme')
  expect(P('cd /w/fronts/acme && gh pr list -Rother/repo')).toContain('gh -R')
  expect(P('cd /w/fronts/acme && gh pr list --repo=other/repo')).toContain('gh -R')
  expect(P('export GH_REPO=other/repo')).toContain('GH_')
  expect(P('export GIT_DIR=/x')).toContain('GIT_')
  expect(P('export NODE_ENV=test')).toBeUndefined()
})

test('fleet agents cannot reach the app or read process environments', () => {
  expect(C('curl -X POST -H "Origin: http://127.0.0.1:4777" http://127.0.0.1:4777/op')).toContain('founder')
  expect(C('curl http://localhost:4781/state.json')).toContain('founder')
  expect(C('curl http://localhost:3000/health')).toBeUndefined()
  expect(C('ps eww 1234')).toContain('environments')
  expect(C('ps -E -p 1234')).toContain('environments')
  expect(C('cat /proc/1234/environ')).toContain('environments')
  expect(C('ps -ef')).toBeUndefined()
  expect(C('ps aux')).toBeUndefined()
})

test('the fleet folder (audit log, app state) is Flight-only', () => {
  expect(C('echo {} > /p/_command/fleet/app-state.json')).toContain('Flight')
  expect(toolRefusal('controller', 'Write', { file_path: '/p/_command/fleet/audit.log' }, [])).toContain('Flight')
  expect(isFlightOnly('/p/_command/fleet/app-state.json')).toBe(true)
  expect(C('tail -5 /p/_command/fleet/audit.log')).toContain('Flight')
  expect(toolRefusal('controller', 'Read', { file_path: '/p/_command/fleet/app-url' }, [])).toContain('Flight')
  expect(C('grep -r token /Users/x/.claude-globex/projects/abc/')).toContain('transcripts') // MC-LEAK-EXEMPT: a placeholder home folder
  expect(toolRefusal('back room', 'Grep', { pattern: 't=', path: '/Users/x/.claude/projects' }, [])).toContain('transcripts') // MC-LEAK-EXEMPT: a placeholder home folder
})

test('fleet agents cannot read the app token or the profile registry', () => {
  expect(C('cat ~/.mission-control/app-token')).toContain('app')
  expect(C('cat $HOME/.mission-control/app-token')).toContain('app')
  expect(B('ls /Users/x/.mission-control/flights')).toContain('app') // MC-LEAK-EXEMPT: a placeholder home folder
  expect(C('cd ~/.mission-control && cat app-token')).toContain('app')
  expect(toolRefusal('controller', 'Read', { file_path: '/Users/x/.mission-control/app-token' }, [])).toContain('app') // MC-LEAK-EXEMPT: a placeholder home folder
  expect(toolRefusal('back room', 'Grep', { pattern: 'x', path: '~/.mission-control' }, [])).toContain('app')
  expect(toolRefusal('controller', 'Glob', { pattern: '**/*', path: '/Users/x/.mission-control/flights' }, [])).toContain('app') // MC-LEAK-EXEMPT: a placeholder home folder
  // The workspace folder named mission-control (no leading dot) stays readable.
  expect(C('cat /Users/x/Desktop/mission-control/README.md')).toBeUndefined() // MC-LEAK-EXEMPT: a placeholder home folder
  expect(toolRefusal('controller', 'Read', { file_path: '/Users/x/Desktop/mission-control/README.md' }, [])).toBeUndefined() // MC-LEAK-EXEMPT: a placeholder home folder
})

test('the app-home guard sees case, quoting, braces, separators and the token by name', () => {
  const R = 'profile registry'
  expect(C('cat ~/.Mission-Control/app-token')).toContain(R)
  expect(toolRefusal('controller', 'Read', { file_path: '/Users/x/.MISSION-CONTROL/app-token' }, [])).toContain(R) // MC-LEAK-EXEMPT: a placeholder home folder
  expect(C("cat ~/.mission''-control/app-token")).toContain(R)
  expect(C('cat ~/."mission-control"/app-token')).toContain(R)
  expect(C('cat ~/.mission\\-control/app-token')).toContain(R)
  expect(C('cat ~/{.mission-control,x}/app-token')).toContain(R)
  expect(C('cd ~;cat<.mission-control/app-token')).toContain(R)
  expect(toolRefusal('controller', 'Glob', { pattern: '{.mission-control,x}/**', path: '/Users/x' }, [])).toContain(R) // MC-LEAK-EXEMPT: a placeholder home folder
  expect(C('find ~ -name app-token -exec cat {} +')).toContain(R)
  expect(toolRefusal('controller', 'Glob', { pattern: '**/app-token', path: '/Users/x' }, [])).toContain(R) // MC-LEAK-EXEMPT: a placeholder home folder
  // Still readable: the app's own localStorage key, and a domain that merely contains the name.
  expect(C('grep -n mcapp-token tools/app/public/app.js')).toBeUndefined()
  expect(C('curl -s https://docs.mission-control.dev/')).toBeUndefined()
})

test('the tokenizer cannot be blinded by heredoc tails, arithmetic shifts, ANSI-C escapes or interpreter heredocs', () => {
  const R = 'profile registry'
  // A1: text after a commit-heredoc's opening delimiter runs as a command.
  expect(C("echo \"$(cat <<'EOF' ; cat ~/.mission''-control/app-tok''en\nx\nEOF\n)\"")).toBeDefined()
  expect(C("git commit -m \"$(cat <<'EOF'; git push origin main\nm\nEOF\n)\"", ['main'])).toBeDefined()
  // A2: an arithmetic shift is not a heredoc; the lines after it still run.
  expect(C("((1<<2))\ncat ~/.mission''-control/app-tok''en")).toBeDefined()
  expect(C('echo $[1<<2]\ngit push origin main', ['main'])).toBeDefined()
  // A3: ANSI-C quoting spells the name in escapes.
  expect(C("cat ~/$'\\x2emission-control'/*")).toBeDefined()
  // A4: a heredoc fed to an interpreter is a program, not data.
  expect(C("bash <<'EOF'\ncat ~/.mission''-control/app-tok''en\nEOF")).toContain(R)
  // Still allowed: an ordinary commit message heredoc, and a python script that names nothing private.
  expect(C("git commit -F - <<'EOF'\nfix(x): tidy\nEOF")).toBeUndefined()
  expect(C("python3 - <<'EOF'\nprint(1 + 1)\nEOF")).toBeUndefined()
})

test('command names are matched in any case, as a case-insensitive disk runs them', () => {
  expect(C('GIT push origin main', ['main'])).toBeDefined()
  expect(C('Git push --force origin feat/x')).toBeDefined()
  expect(C('Gh pr merge 12')).toBeDefined()
  expect(B('GIT push origin feat/x')).toBeDefined()
  expect(C("BASH <<'EOF'\ncat ~/.mission''-control/app-tok''en\nEOF")).toBeDefined()
})

test('the fleet approves its own send only to an agent it has on record', () => {
  const seats = [
    { callSign: 'MISSION-CONTROL', agentId: 'a1', name: 'console-mission-control', status: 'staffed' },
    { callSign: 'ACME', agentId: '', name: 'console-acme', status: 'staffing' },
  ]
  expect(fleetSelfApproval('SendMessage', { to: 'a1', message: 'go' }, seats)).toBe('MISSION-CONTROL')
  expect(fleetSelfApproval('SendMessage', { to: 'someone-else', message: 'go' }, seats)).toBeUndefined()
  expect(fleetSelfApproval('SendMessage', { to: '', message: 'go' }, seats)).toBeUndefined()
  expect(fleetSelfApproval('SendMessage', { message: 'go' }, seats)).toBeUndefined()
  expect(fleetSelfApproval('SendMessage', { to: 'a1' }, [])).toBeUndefined()
})

test('the fleet approves its own spawn only of a Controller under a reserved console name', () => {
  const seats = [{ callSign: 'ACME', agentId: '', name: 'console-acme', status: 'staffing' }]
  expect(fleetSelfApproval('Agent', { subagent_type: 'mission-fleet:controller', name: 'console-acme' }, seats)).toBe('ACME')
  expect(fleetSelfApproval('Agent', { subagent_type: 'general-purpose', name: 'console-acme' }, seats)).toBeUndefined()
  expect(fleetSelfApproval('Agent', { subagent_type: 'mission-fleet:controller', name: 'console-other' }, seats)).toBeUndefined()
  expect(fleetSelfApproval('Agent', { subagent_type: 'mission-fleet:controller', name: 'console-acme' }, [{ ...seats[0]!, status: 'staffed', agentId: 'a2' }])).toBeUndefined()
  expect(fleetSelfApproval('Bash', { command: 'ls' }, seats)).toBeUndefined()
})

test('app console ops that message or start an agent are relayed through Flight', () => {
  for (const a of ['staff acme', 'call ACME hi', 'go MI8', 'nogo MI8 not now', 'no-go MI8', 'dismiss ACME', 'stand-down ACME']) expect(isRelayedVerb(a)).toBe(true)
  for (const a of ['list', 'poll', 'loops ACME', 'retune ACME haiku', 'dismiss-gate MI8', '']) expect(isRelayedVerb(a)).toBe(false)
})

test('a relay code is split off the end of the args, and only a well-formed one', () => {
  const code = 'a'.repeat(32)
  expect(splitRelayCode(`go MI8 --code ${code}`)).toEqual({ args: 'go MI8', code })
  expect(splitRelayCode('go MI8')).toEqual({ args: 'go MI8' })
  expect(splitRelayCode('go MI8 --code nothex')).toEqual({ args: 'go MI8 --code nothex' })
})

test('a relay code works once, for exactly the args it was minted for, within its lifetime', () => {
  const codes: RelayCodes = new Map([['c1', { args: 'go MI8', at: 1000 }], ['c2', { args: 'go MI8', at: 1000 }], ['c3', { args: 'go MI8', at: 1000 }]])
  expect(spendRelayCode(codes, 'c1', 'go MI8', 2000)).toBe(true)
  expect(spendRelayCode(codes, 'c1', 'go MI8', 2000)).toBe(false)
  expect(spendRelayCode(codes, 'c2', 'go MI9', 2000)).toBe(false)
  expect(spendRelayCode(codes, 'c2', 'go MI8', 2000)).toBe(false)
  expect(spendRelayCode(codes, 'c3', 'go MI8', 1000 + RELAY_TTL + 1)).toBe(false)
  expect(spendRelayCode(codes, undefined, 'go MI8', 2000)).toBe(false)
  expect(spendRelayCode(codes, 'never-minted', 'go MI8', 2000)).toBe(false)
  codes.set('c4', { args: 'call ACME line one\nline two', at: 1000 })
  expect(spendRelayCode(codes, 'c4', 'call ACME line one line  two', 2000)).toBe(true)
})

test('a decision sent to Flight holds its gate for the code lifetime, then frees it', () => {
  const at = Date.parse('2026-10-16T01:57:00Z')
  expect(awaitingFlight('2026-10-16T01:57:00.000Z', at + 5_000)).toBe(true)
  expect(awaitingFlight('2026-10-16T01:57:00.000Z', at + RELAY_TTL + 1)).toBe(false)
  expect(awaitingFlight(undefined, at)).toBe(false)
  expect(awaitingFlight('not a date', at)).toBe(false)
})

// ---- redirects read as the shell reads them (MC-151) ----
// The Bash tool runs zsh; an fd number, an input target or `&>` must not shift the git call the guard checks.

test('an fd number, an input target and the and-redirect are redirects, never words that shift the command', () => {
  const words = (cmd: string) => tokenize(cmd).commands[0]?.words.map(w => w.text)
  const reds = (cmd: string) => tokenize(cmd).commands[0]?.redirects.map(w => w.text)
  expect(words('git log 2>&1')).toEqual(['git', 'log'])
  expect(words('git log 2>/dev/null')).toEqual(['git', 'log'])
  // a space before the operator keeps the number a word
  expect(words('echo 2 >f')).toEqual(['echo', '2'])
  // input redirect targets are redirects, not words
  expect(words('git log </dev/null')).toEqual(['git', 'log'])
  expect(reds('git log </dev/null')).toContain('/dev/null')
  expect(words('cat <&0')).toEqual(['cat'])
  expect(words('cat <<<here')).toEqual(['cat'])
  expect(reds('cat <<<here')).toContain('here')
  // `&>` and `&>>` stay one command
  expect(tokenize('git log &>/dev/null').commands).toHaveLength(1)
  expect(words('git log &>/dev/null')).toEqual(['git', 'log'])
  expect(tokenize('git log &>>/dev/null').commands).toHaveLength(1)
})

test('a quoted or escaped digit is a word, and a digit against &> is kept, so neither frees a push or stash', () => {
  const S = '/w/fronts/acme/api'
  const words = (cmd: string) => tokenize(cmd).commands[0]?.words.map(w => w.text)
  // The shell makes an fd only from an UNQUOTED digit written against the operator; a quoted or escaped
  // digit is an ordinary word (echo A '2'>&1 prints "A 2" in bash and zsh), so it must not be dropped.
  for (const d of ["'2'", '"2"', '\\2', "2''"]) {
    expect(words(`git --namespace ${d}>/dev/null stash`)).toContain('2')
    expect(C(`git -C ${S} --namespace ${d}>/dev/null stash`)).toContain('stash')
    expect(C(`git -C ${S} --namespace ${d}>/dev/null push --force`)).toContain('force')
    expect(C(`git -C ${S} --namespace ${d}</dev/null push --force`)).toContain('force')
  }
  // an unquoted digit against the operator IS an fd and is dropped, so the real redirect case stays intact
  expect(words('git --namespace 2>/dev/null log')).toEqual(['git', '--namespace', 'log'])
  // bash and zsh disagree on a digit written against `&>`, so keep it a word and refuse (fail closed)
  expect(words(`git -C ${S} --namespace 2&>/dev/null push --force`)).toContain('2')
  expect(C(`git -C ${S} --namespace 2&>/dev/null push --force`)).toContain('force')
  expect(C(`git -C ${S} --namespace 2&>>/dev/null stash`)).toContain('stash')
})

test('a phantom redirect word cannot hide the git subcommand the guard checks', () => {
  const S = '/w/fronts/acme/api'
  // --namespace consumes the fd or target on the old code, so the guard read `status` while git ran push.
  for (const op of ['2>&1', '2>/dev/null', '</dev/null', '<<<x', '<>f']) {
    expect(C(`git -C ${S} --namespace ${op} status push origin main`, ['main'])).toContain('main is a base or deploy branch')
  }
  // `&>` split the command on the old code, hiding the push behind a headless first command.
  expect(C(`git -C ${S} &>/dev/null push origin main`, ['main'])).toContain('main is a base or deploy branch')
  expect(C(`git -C ${S} &>>/dev/null push origin main`, ['main'])).toContain('main is a base or deploy branch')
  expect(toolRefusal('controller', 'Bash', { command: `git -C ${S} --namespace 2>&1 status push origin main` }, ['main'], S)).toContain('main is a base or deploy branch')
  // a back-room agent cannot hide a stash behind `&>>` either
  expect(B('git -C /w/fronts/acme/api &>>/dev/null stash')).toContain('stash')
})

test('redirects do not change ordinary commands, and a Flight-only file is seen as an input target', () => {
  expect(C('git -C /w/fronts/acme/api log > /tmp/out.txt')).toBeUndefined()
  expect(C('git -C /w/fronts/acme/api log 2>&1 | grep fix')).toBeUndefined()
  expect(C('echo hi > out 2> err')).toBeUndefined()
  // an input redirect whose target is a Flight-only file is classified as a redirect and still caught
  expect(tokenize('cat < _command/daily/today.md').commands[0]?.redirects.map(w => w.text)).toContain('_command/daily/today.md')
  expect(C('cat < _command/daily/today.md')).toContain("Flight's to write")
  expect(C('echo x > _command/trackers/fronts.md')).toContain("Flight's to write")
})
