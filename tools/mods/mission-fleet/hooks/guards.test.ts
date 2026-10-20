import { expect, test } from 'claude-code/testing'

import { fleetSelfApproval, isFlightOnly, isRelayedVerb, RELAY_TTL, splitRelayCode, spendRelayCode, isShellLikeTool, pinnedDir, protectedFromSpoke, pushDestination, registersWorktree, shellRefusal, tokenize, toolRefusal } from './guards'
import type { CloneScope, RelayCodes } from './guards'

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
  expect(C('gh api -X PUT repos/o/r/pulls/12/merge')).toContain('founder')
  expect(C('gh api repos/o/r/merges -f base=main -f head=x')).toContain('founder')
  expect(C('gh api -X PATCH repos/o/r/git/refs/heads/main -f sha=1')).toContain('writes only to the pinned repo')
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
  // With Controller workflows on, the room is given and the script is read; a back room never runs one.
  const sized = { script: "export const meta = { name: 'x', description: 'd' }\nawait agent('p', { model: 'sonnet', effort: 'low' })" }
  expect(toolRefusal('controller', 'Workflow', sized, [], undefined, undefined, undefined, undefined, 4)).toBeUndefined()
  expect(toolRefusal('controller', 'Workflow', sized, [], undefined, undefined, undefined, undefined, 0)).toContain('room for 0')
  expect(toolRefusal('controller', 'Workflow', sized, [])).toContain('until the founder turns Controller workflows on')
  expect(toolRefusal('back room', 'Workflow', sized, [], undefined, undefined, undefined, undefined, 4)).toContain('A back-room agent never runs a workflow')
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

test('the fleet never approves its own send to a console that is stood down', () => {
  const seats = [
    { callSign: 'MISSION-CONTROL', agentId: 'a1', name: 'console-mission-control', status: 'stood-down' },
    { callSign: 'ACME', agentId: 'k1', name: 'console-acme', status: 'staffed' },
  ]
  expect(fleetSelfApproval('SendMessage', { to: 'a1', message: 'go' }, seats)).toBeUndefined()
  expect(fleetSelfApproval('SendMessage', { to: 'k1', message: 'go' }, seats)).toBe('ACME')
})

test('the fleet approves its own spawn only of a Controller under a reserved console name', () => {
  const seats = [{ callSign: 'ACME', agentId: '', name: 'console-acme', status: 'staffing' }]
  expect(fleetSelfApproval('Agent', { subagent_type: 'mission-fleet:controller', name: 'console-acme' }, seats)).toBe('ACME')
  expect(fleetSelfApproval('Agent', { subagent_type: 'general-purpose', name: 'console-acme' }, seats)).toBeUndefined()
  expect(fleetSelfApproval('Agent', { subagent_type: 'mission-fleet:controller', name: 'console-other' }, seats)).toBeUndefined()
  expect(fleetSelfApproval('Agent', { subagent_type: 'mission-fleet:controller', name: 'console-acme' }, [{ ...seats[0]!, status: 'staffed', agentId: 'a2' }])).toBeUndefined()
  expect(fleetSelfApproval('Bash', { command: 'ls' }, seats)).toBeUndefined()
})

test('app console ops that message or start an agent are relayed through Flight; answers are no longer console ops', () => {
  // A Done tells the Controller, so it is a message and runs through Flight too.
  for (const a of ['staff acme', 'call ACME hi', 'dismiss ACME', 'stand-down ACME', 'done MI9']) expect(isRelayedVerb(a)).toBe(true)
  for (const a of ['list', 'poll', 'loops ACME', 'retune ACME haiku', 'dismiss-gate MI8', 'go MI8', 'decide MI7 2', 'retry MI8', '']) expect(isRelayedVerb(a)).toBe(false)
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

// ---- Clones (MC-126, MC-135) ----

// A Controller on the acme front: its own front's folder, and the fronts the portfolio named when it was staffed.
const ACME: CloneScope = { home: '/w/fronts/acme', fronts: ['acme', 'kiln', 'shelf'] }
const K = (cmd: string, scope = '/w/fronts/acme', clone: CloneScope | undefined = ACME) => shellRefusal('controller', cmd, [], scope, clone)
const AT_HOME = 'cd /w/fronts/acme && '
const WEB = 'git@github.com:acme-org/web.git'
// What each refusal of a source says, by kind.
const HELPER = 'names a remote helper (HELPER::), which runs a program rather than fetch a repository'
const LOCAL = 'which reads this Mac\'s folders, other fronts\' repositories included'
const DASH = 'a host or user starting with - would reach ssh as an option'
const UNREAD = 'is not a repository URL this guard can read'
const NO_FOLDER = 'leaves git no folder of its own: a path part is dots alone or .git'

test('a Controller clones any repository URL into a front\'s folder, with the listed options', () => {
  expect(K(`${AT_HOME}git clone ${WEB}`)).toBeUndefined()
  expect(K(`${AT_HOME}git clone https://github.com/acme-org/web`)).toBeUndefined()
  expect(K(`${AT_HOME}git clone https://github.com/acme-org/web.git web`)).toBeUndefined()
  expect(K(`git -C /w/fronts/acme clone --depth 1 --single-branch --branch main --filter=blob:none --origin upstream -q --no-tags ${WEB}`)).toBeUndefined()
  expect(K(`${AT_HOME}git clone -b feat/x --no-single-branch --quiet ${WEB} /w/fronts/acme/web`)).toBeUndefined()
  // A project console, from its own repository, naming the folder beside it.
  expect(K(`cd /w/fronts/acme/api && git clone ${WEB} ../web`, '/w/fronts/acme/api')).toBeUndefined()
  // Any owner, any host and any transport git reads over the network, an ssh host alias included.
  for (const src of [
    'git@github.com:shelf-co/catalog.git', 'https://gitlab.com/group/sub/tool.git', 'https://gitlab.com/group/sub/tool/',
    'http://git.example.org/team/tool', 'ssh://git@code.example.org:2222/team/tool.git', 'git+ssh://code.example.org/team/tool.git',
    'ssh+git://code.example.org/team/tool.git', 'git://git.example.org/tool.git', 'git@personal-github:acme-org/tool.git',
    'deploy_bot@git.example.org:/srv/git/tool.git', 'https://dev.example.com/org/proj/_git/tool', 'git@git.example.org:tool',
  ]) expect(`${src} -> ${K(`${AT_HOME}git clone ${src}`) ?? 'allowed'}`).toBe(`${src} -> allowed`)
  // A project console clones into its front's folder, beside its project.
  expect(K(`${AT_HOME}git clone ${WEB}`, '/w/fronts/acme/api')).toBeUndefined()
  expect(K(`git -C /w/fronts/acme/api clone ${WEB} /w/fronts/acme/web`, '/w/fronts/acme/api')).toBeUndefined()
})

test('a back-room agent still never clones', () => {
  expect(B(`git clone ${WEB}`)).toContain('never runs git clone')
  expect(shellRefusal('back room', `${AT_HOME}git clone ${WEB}`, [], '/w/fronts/acme', ACME)).toContain('never runs git clone')
})

test('every clone option off the list is refused by its own name, an abbreviation git would expand included', () => {
  // The base command passes, so each refusal below is the option's.
  expect(K(`${AT_HOME}git clone ${WEB}`)).toBeUndefined()
  // Caught before the clone rule, as options that run a command (the git-wide list; --rec abbreviates --receive-pack there).
  const RUNS = new Set(['--upload-pack', '--upload-pack=x', '--upl', '--rec'])
  for (const opt of [
    '-c core.sshCommand=x', '--config core.sshCommand=x', '--config=core.sshCommand=x', '--template /tmp/t', '--template=/tmp/t',
    '-u x', '--upload-pack x', '--upload-pack=x', '--separate-git-dir /tmp/g', '--reference /tmp/r', '--reference-if-able /tmp/r',
    '--recurse-submodules', '--recursive', '--recurse-submodules=lib', '--shallow-submodules', '--remote-submodules', '--also-filter-submodules',
    '-j 4', '--jobs 4', '--temp /tmp/t', '--conf core.x=y', '--upl x', '--rec', '--dep 1', '--sing', '--quie', '-o upstream',
    '--bare', '--mirror', '-l', '--local', '-s', '--shared', '--no-hardlinks', '--dissociate', '-n', '--no-checkout', '--sparse',
    '--bundle-uri x', '--server-option x', '--ref-format files', '--revision x', '-bmain', '--depth=1', '--branch=main',
    '--filter=tree:0', '--filter=blob:limit=1k', '-v', '--progress', '-4', '--ipv6', '-qb main',
  ]) {
    const word = opt.split(' ')[0] ?? ''
    const why = K(`${AT_HOME}git clone ${opt} ${WEB}`) ?? 'allowed'
    expect(`${opt} -> ${why}`).toContain(RUNS.has(word) ? `git clone ${word} can run a command` : `${word} is not an allowed clone option`)
  }
  expect(K(`${AT_HOME}git clone -- ${WEB}`)).toContain('`--` is not allowed in a clone')
})

test('a listed clone option takes a plain value as its next word', () => {
  for (const [opt, value] of [['--depth', '0'], ['--depth', 'x'], ['--depth', '1000000'], ['--branch', '-x'], ['-b', '../x'], ['--origin', 'a/b'], ['--branch', "''"]]) {
    expect(`${opt} ${value} -> ${K(`${AT_HOME}git clone ${opt} ${value} ${WEB}`) ?? 'allowed'}`).toContain(`${opt} takes a plain value as the next word`)
  }
  expect(K(`${AT_HOME}git clone ${WEB} --depth`)).toContain('--depth takes a plain value')
})

test('clone words must be literal: variables, globs and substitutions are refused', () => {
  expect(K(`${AT_HOME}git clone $URL`)).toContain('clone arguments must be literal')
  expect(K(`${AT_HOME}git clone --depth $N ${WEB}`)).toContain('clone arguments must be literal')
  expect(K(`${AT_HOME}git clone "git@github.com:acme-org/$R.git"`)).toContain('clone arguments must be literal')
  expect(K(`${AT_HOME}git clone ${WEB} ~/web`)).toContain('clone arguments must be literal')
  expect(K(`${AT_HOME}git clone git@github.com:acme-org/w*.git`)).toContain('clone arguments must be literal')
  expect(K(`${AT_HOME}git clone $(cat url.txt)`)).toContain('run plainly')
})

test('a clone source that runs a program or reads this Mac\'s folders is refused, naming why', () => {
  const refusal = (src: string) => `${src} -> ${K(`${AT_HOME}git clone ${src}`) ?? 'allowed'}`
  for (const src of ["'ext::sh -c x'", 'fd::3', "'transport::https://github.com/acme-org/web'", 'https::github.com/acme-org/web']) {
    const text = tokenize(src).commands[0]?.words[0]?.text ?? src
    expect(refusal(src)).toContain(`${text} ${HELPER}`)
  }
  for (const src of ['file:///w/fronts/shelf/shelf', 'FILE:///w/fronts/shelf/shelf', 'file://localhost/srv/web.git']) {
    expect(refusal(src)).toContain(`${src} is a file:// source, ${LOCAL}`)
  }
  for (const src of ['/w/fronts/shelf/shelf', '../shelf/shelf', './web', 'web', 'shelf/web.git', 'a/b:c.git', '.git']) {
    expect(refusal(src)).toContain(`${src} is a local path, ${LOCAL}`)
  }
  for (const src of ['ssh://-oProxyCommand=x/web.git', 'ssh://git@-oProxyCommand=x/web.git', 'git@-oProxyCommand=x:web.git', 'https://-x.example.org/web']) {
    expect(refusal(src)).toContain(`${src}: ${DASH}`)
  }
})

test('a source the guard cannot read, or one that leaves git no folder of its own, is refused', () => {
  const refusal = (src: string) => `${src} -> ${K(`${AT_HOME}git clone ${src}`) ?? 'allowed'}`
  for (const src of [
    'HTTPS://github.com/acme-org/web', 'ftp://git.example.org/web.git', 'https://github.com:443', 'https://github.com/',
    'https://git.example.org/a%20b/web.git', 'https://user:pw@git.example.org/web.git',
    'github.com:acme-org/web.git', 'git@github.com:', 'file:web', 'ssh://git.example.org:22x/web.git',
  ]) expect(refusal(src)).toContain(`${src} ${UNREAD}`)
  for (const src of [
    'git@github.com:acme-org/..git', 'https://github.com/acme-org/..', 'https://github.com/acme-org/.', 'https://github.com/acme-org/.git',
    'git@github.com:acme-org/.GIT.git', 'git@github.com:acme-org/....git', 'git@github.com:acme-org/.git..git', 'https://github.com/acme-org/.git.',
    'https://github.com/../web.git',
  ]) expect(refusal(src)).toContain(`${src} ${NO_FOLDER}`)
})

test('a clone lands in any front the console was staffed with, and never in a folder that is not one', () => {
  // Another front's folder, pinned there or named from the console's own.
  expect(K(`cd /w/fronts/shelf && git clone ${WEB}`)).toBeUndefined()
  expect(K(`git -C /w/fronts/shelf clone ${WEB}`)).toBeUndefined()
  expect(K(`${AT_HOME}git clone ${WEB} /w/fronts/shelf/web`)).toBeUndefined()
  expect(K(`${AT_HOME}git clone ${WEB} ../shelf/web`)).toBeUndefined()
  // A folder no front on the record names: refused, naming the fronts it has.
  expect(K(`${AT_HOME}git clone ${WEB} /w/fronts/ghost/web`)).toContain('ghost is not a front this console was staffed with (acme, kiln, shelf)')
  expect(K(`cd /w/fronts/ghost && git clone ${WEB}`)).toContain('/w/fronts/ghost is outside your console\'s directory')
  // A record that names its own front alone keeps every clone there.
  const OWN: CloneScope = { home: '/w/fronts/acme', fronts: ['acme'] }
  expect(K(`${AT_HOME}git clone ${WEB}`, '/w/fronts/acme', OWN)).toBeUndefined()
  expect(K(`${AT_HOME}git clone ${WEB} /w/fronts/shelf/web`, '/w/fronts/acme', OWN)).toContain('shelf is not a front this console was staffed with (acme)')
  expect(K(`cd /w/fronts/shelf && git clone ${WEB}`, '/w/fronts/acme', OWN)).toContain('/w/fronts/shelf is outside your console\'s directory')
})

test('a clone lands in the folder git names for the URL, the repository\'s own name', () => {
  // The refusal for a landing outside fronts/ names where a clone goes instead: <front folder>/<git's folder>.
  for (const [src, folder] of [
    ['git@github.com:acme-org/web.git', 'web'], ['https://github.com/acme-org/web', 'web'], ['https://gitlab.com/group/sub/tool.git/', 'tool'],
    ['ssh://git@code.example.org:2222/team/tool.git', 'tool'], ['git://git.example.org/tool', 'tool'], ['git@git.example.org:tool.git', 'tool'],
    ['https://github.com/acme-org/web.git.git', 'web.git'], ['https://git.example.org/1234', '1234'], ['git@git.example.org:2222.git', '2222'],
    ['git@git.example.org:1234', 'git.example.org'],
  ]) expect(`${src} -> ${K(`${AT_HOME}git clone ${src} /tmp/x`) ?? 'allowed'}`).toContain(`here /w/fronts/acme/${folder}: \``)
})

test('a clone lands only one level under a front\'s folder, and a refusal names the command to use', () => {
  const USE = 'a clone lands one level under a front\'s folder, here /w/fronts/acme/web: `cd /w/fronts/acme && git clone git@github.com:acme-org/web.git`'
  expect(K(`${AT_HOME}git clone ${WEB} web2`)).toContain(`it would land in /w/fronts/acme/web2; ${USE}`)
  // Never into a front's folder itself, which would make the folder a repository, nor into the fronts folder.
  expect(K(`${AT_HOME}git clone ${WEB} .`)).toContain(`it would land in /w/fronts/acme; ${USE}`)
  expect(K(`${AT_HOME}git clone ${WEB} ..`)).toContain(`it would land in /w/fronts; ${USE}`)
  expect(K(`${AT_HOME}git clone ${WEB} /w/fronts/shelf`)).toContain('it would land in /w/fronts/shelf; a clone lands one level under a front\'s folder, here /w/fronts/shelf/web: `cd /w/fronts/shelf && git clone git@github.com:acme-org/web.git`')
  expect(K(`${AT_HOME}git clone ${WEB} /tmp/web`)).toContain(`it would land in /tmp/web; ${USE}`)
  // Two levels down, inside a repository, or beside the fronts.
  expect(K(`${AT_HOME}git clone ${WEB} api/web`)).toContain('it would land in /w/fronts/acme/api/web; a clone lands one level under a front\'s folder, here /w/fronts/acme/web:')
  expect(K(`cd /w/fronts/acme/api && git clone ${WEB}`, '/w/fronts/acme/api')).toContain('it would land in /w/fronts/acme/api/web;')
  expect(K(`${AT_HOME}git clone ${WEB} ../web`)).toContain(`it would land in /w/fronts/web; ${USE}`)
  expect(K(`${AT_HOME}git clone ${WEB} ../../../../tmp/web`)).toContain('it would land in /tmp/web;')
  // Compared exactly: a path spelled in another case is refused, whatever the disk would do with it.
  expect(K(`${AT_HOME}git clone ${WEB} /W/Fronts/Acme/web`)).toContain('it would land in /W/Fronts/Acme/web;')
  expect(K(`${AT_HOME}git clone git@github.com:acme-org/Web.git web`)).toContain('it would land in /w/fronts/acme/web; a clone lands one level under a front\'s folder, here /w/fronts/acme/Web:')
  expect(K(`${AT_HOME}git clone ${WEB} web extra`)).toContain('a clone takes the repository and at most one destination')
  expect(K(`${AT_HOME}git clone`)).toContain('name the repository to clone')
  expect(K(`${AT_HOME}git clone --depth 1`)).toContain('name the repository to clone')
})

test('a clone is pinned to the console\'s directory or a front\'s folder, and nothing else runs from a front\'s folder', () => {
  expect(K(`git clone ${WEB}`)).toContain('Pin the repo')
  expect(K(`cd /w/fronts && git clone ${WEB} acme/web`)).toContain('/w/fronts is outside your console\'s directory')
  expect(K(`cd /tmp && git clone ${WEB} /w/fronts/acme/web`)).toContain('/tmp is outside your console\'s directory')
  expect(K(`cd /w/fronts/shelf/shelf && git clone ${WEB} ../web`)).toContain('/w/fronts/shelf/shelf is outside your console\'s directory')
  // A project console: its sibling's folder is not its own, and a front's folder takes only a clone.
  expect(K(`cd /w/fronts/acme/web && git clone ${WEB} .`, '/w/fronts/acme/api')).toContain('/w/fronts/acme/web is outside your console\'s directory')
  expect(K(`${AT_HOME}git status`, '/w/fronts/acme/api')).toContain('/w/fronts/acme is outside your console\'s directory')
  expect(K(`${AT_HOME}git -c core.sshCommand=x clone ${WEB}`, '/w/fronts/acme/api')).toContain('outside your console\'s directory')
  expect(K('cd /w/fronts/acme/web && git status', '/w/fronts/acme/api')).toContain('outside your console\'s directory')
  expect(K('cd /w/fronts/shelf && git status')).toContain('/w/fronts/shelf is outside your console\'s directory')
  expect(K('git -C /w/fronts/shelf fetch')).toContain('/w/fronts/shelf is outside your console\'s directory')
  // A relative cd that CDPATH could send elsewhere does not pin a clone: the rule asks for the full path.
  expect(K(`cd /w && cd fronts/shelf && git clone ${WEB}`)).toContain('pin it to a front\'s folder by its full path')
  // With no directory to pin to, the clone rule asks for a front's folder itself.
  expect(shellRefusal('controller', `git clone ${WEB}`, [], undefined, ACME)).toContain('pin it to a front\'s folder by its full path: `cd /w/fronts/acme && git clone git@github.com:acme-org/web.git`')
})

test('a front whose folder is itself a repository takes clones like any other front', () => {
  // KILN keeps its repository in the front's folder, the layout check-fronts.sh reports; that blocks no clone.
  const KILN: CloneScope = { home: '/w/fronts/kiln', fronts: ['acme', 'kiln', 'shelf'] }
  const GLAZE = 'https://codeberg.org/kiln/glaze.git'
  expect(K(`cd /w/fronts/kiln && git clone ${GLAZE}`, '/w/fronts/kiln', KILN)).toBeUndefined()
  expect(K(`cd /w/fronts/kiln && git clone ${GLAZE} /w/fronts/acme/glaze`, '/w/fronts/kiln', KILN)).toBeUndefined()
  expect(K(`cd /w/fronts/kiln && git clone ${GLAZE}`)).toBeUndefined()
  // Its repository's own subfolders are still two levels down.
  expect(K(`cd /w/fronts/kiln && git clone ${GLAZE} src/glaze`, '/w/fronts/kiln', KILN)).toContain('it would land in /w/fronts/kiln/src/glaze;')
})

test('a console with no clone folder on record is refused a clone until it is stood down and staffed again', () => {
  expect(shellRefusal('controller', `${AT_HOME}git clone ${WEB}`, [], '/w/fronts/acme')).toContain('this console was staffed before clones were allowed: it can clone once it is stood down and staffed again')
  expect(C(`git clone ${WEB}`)).toContain('stood down and staffed again')
})

test('the clone rule reaches toolRefusal with the console\'s folder and fronts', () => {
  const bash = (command: string, clone?: CloneScope) => toolRefusal('controller', 'Bash', { command }, [], '/w/fronts/acme', clone)
  expect(bash(`${AT_HOME}git clone --depth 1 ${WEB}`, ACME)).toBeUndefined()
  expect(bash('cd /w/fronts/shelf && git clone https://gitlab.com/group/tool.git', ACME)).toBeUndefined()
  expect(bash(`${AT_HOME}git clone -u x ${WEB}`, ACME)).toContain('A Controller clones only into a front\'s folder, one level down (fronts/<front>/<repo>): -u is not an allowed clone option')
  expect(bash(`${AT_HOME}git clone file:///w/fronts/acme/web`, ACME)).toContain(`file:///w/fronts/acme/web is a file:// source, ${LOCAL}`)
  expect(bash(`${AT_HOME}git clone ${WEB}`)).toContain('stood down and staffed again')
})

test('git takes no global option before a clone but -C', () => {
  // --bare is off git's list of global options, so that list refuses it before the clone rule reads the call.
  expect(K(`git --bare -C /w/fronts/acme clone ${WEB}`)).toContain('--bare is not an allowed git global option')
  expect(K(`${AT_HOME}git --no-pager clone ${WEB}`)).toContain('git takes no option before clone but -C <dir> (here: --no-pager)')
  expect(K(`${AT_HOME}git -p clone ${WEB}`)).toContain('git takes no option before clone')
})

test('a clone pinned by a relative cd is refused, since CDPATH could resolve that cd elsewhere', () => {
  expect(K(`cd /w/fronts && cd acme && git clone ${WEB}`)).toContain('pin it to a front\'s folder by its full path: `cd /w/fronts/acme && git clone git@github.com:acme-org/web.git`')
  expect(K(`export CDPATH=/tmp; cd /w/fronts && cd acme && git clone ${WEB}`)).toContain('nothing sets HOME, PATH, CDPATH')
  // A cd led by . never consults CDPATH (one led by .. is refused for its .., below).
  expect(K(`cd /w/fronts && cd ./acme && git clone ${WEB}`)).toBeUndefined()
})

// ---- Clones on a disk that follows links (MC-135 security review) ----
// The guard reads paths as text and the disk follows links, and a cloned repository can hold a link:
// so a clone never runs from inside a folder it may use, nor steps back out through one with `..`.

test('a clone runs from exactly a front\'s folder or the console\'s own directory, never a folder inside one', () => {
  const INSIDE = 'a folder inside one a clone may run from, where a link could carry it elsewhere; pin it to a front\'s folder by its full path: `cd /w/fronts/acme && git clone git@github.com:acme-org/web.git`'
  expect(K(`cd /w/fronts/acme/api && git clone ${WEB} ../web`)).toContain(`it runs from /w/fronts/acme/api, ${INSIDE}`)
  expect(K(`cd /w/fronts/acme/tool/link && git clone ${WEB} ../../web`)).toContain(`it runs from /w/fronts/acme/tool/link, ${INSIDE}`)
  expect(K(`git -C /w/fronts/acme/api clone ${WEB} /w/fronts/acme/web`)).toContain(`it runs from /w/fronts/acme/api, ${INSIDE}`)
  expect(K(`cd /w/fronts/acme/api/src && git clone ${WEB} ../../web`, '/w/fronts/acme/api')).toContain(`it runs from /w/fronts/acme/api/src, ${INSIDE}`)
  // Exactly the console's directory, or exactly a front's folder, still runs one.
  expect(K(`cd /w/fronts/acme/api && git clone ${WEB} ../web`, '/w/fronts/acme/api')).toBeUndefined()
  expect(K(`cd /w/fronts/acme/api && git clone ${WEB} ../../shelf/web`, '/w/fronts/acme/api')).toBeUndefined()
  expect(K(`git -C /w/fronts/shelf clone ${WEB}`, '/w/fronts/acme/api')).toBeUndefined()
})

test('a clone\'s cd or -C path holds no .., and its destination holds .. only before its first folder name', () => {
  const DOTS = 'its cd or -C path holds .., which a link could carry elsewhere; pin it to a front\'s folder by its full path: `cd /w/fronts/acme && git clone git@github.com:acme-org/web.git`'
  expect(K(`git -C /w/fronts/acme/tool/link/../.. clone ${WEB}`)).toContain(DOTS)
  expect(K(`cd /w/fronts/acme/tool/link/../.. && git clone ${WEB}`)).toContain(DOTS)
  expect(K(`cd /w/fronts/acme/api && cd .. && git clone ${WEB}`)).toContain(DOTS)
  expect(K(`cd /w/fronts/acme && cd ./api && cd ../ && git clone ${WEB}`)).toContain(DOTS)
  const AFTER = 'has .. after a folder name, which a link inside the tree could carry elsewhere; a clone lands one level under a front\'s folder, here /w/fronts/acme/web: `cd /w/fronts/acme && git clone git@github.com:acme-org/web.git`'
  for (const dest of ['tool/link/../../web', 'tool/../web', './tool/../web', '/w/fronts/acme/tool/../web', '../acme/tool/../web']) {
    expect(`${dest} -> ${K(`${AT_HOME}git clone ${WEB} ${dest}`) ?? 'allowed'}`).toContain(`${dest} ${AFTER}`)
  }
  // A leading .. steps out of the folder the clone runs from, one the console was staffed with.
  expect(K(`${AT_HOME}git clone ${WEB} ../shelf/web`)).toBeUndefined()
  expect(K(`${AT_HOME}git clone ${WEB} ./../acme/web`)).toBeUndefined()
})

test('a clone never makes a folder starting with ., one tools read as their settings', () => {
  const refusal = (src: string) => `${src} -> ${K(`${AT_HOME}git clone ${src}`) ?? 'allowed'}`
  for (const [src, folder] of [
    ['https://github.com/acme-org/.claude', '.claude'], ['git@github.com:acme-org/.vscode.git', '.vscode'],
    ['https://git.example.org/team/.envrc/', '.envrc'], ['ssh://git.example.org/team/.githooks.git', '.githooks'], ['git@git.example.org:.husky', '.husky'],
  ] as const) expect(refusal(src)).toContain(`${src} would make the folder ${folder}, and a folder starting with . is one tools read as settings (a .claude folder's hooks run commands)`)
  // A dot inside the name is the repository's own.
  expect(K(`${AT_HOME}git clone https://github.com/acme-org/web.app.git`)).toBeUndefined()
  expect(K(`${AT_HOME}git clone https://github.com/acme-org/web.app.git web.app`)).toBeUndefined()
})

test('a clone source on this Mac, by name or by any numeric spelling, is refused, and other hosts are not', () => {
  const refusal = (src: string) => `${src} -> ${K(`${AT_HOME}git clone ${src}`) ?? 'allowed'}`
  const MAC = 'names this Mac (localhost, 127.x.x.x or 0.x.x.x): a clone from it reads this Mac\'s own folders and services'
  for (const src of [
    'http://localhost:8080/acme-org/web.git', 'https://LOCALHOST/acme-org/web', 'ssh://git@app.localhost/acme-org/web.git', 'git@Localhost:acme-org/web.git',
    'git@127.0.0.1:/srv/git/web.git', 'http://127.0.0.1:3000/acme-org/web', 'git://127.255.255.254/web.git', 'http://0.0.0.0/acme-org/web', 'https://0.1.2.3/acme-org/web',
  ]) expect(refusal(src)).toContain(`${src} ${MAC}`)
  const NUMBER = 'writes its host as a number other than a.b.c.d, a spelling that can name this Mac (127.1 is 127.0.0.1)'
  for (const src of [
    'http://127.1/acme-org/web', 'http://2130706433/acme-org/web', 'http://0x7f.0.0.1/acme-org/web', 'http://0x7F000001/acme-org/web',
    'http://0177.0.0.1/acme-org/web', 'http://0/acme-org/web', 'https://10.0.0.010/acme-org/web', 'git@1.2.3:acme-org/web.git', 'git@1.2.3.4.5:acme-org/web.git',
  ]) expect(refusal(src)).toContain(`${src} ${NUMBER}`)
  // Hosts on the network pass: a number written plainly as a.b.c.d, or a name DNS resolves.
  for (const src of [
    'https://10.0.0.5/acme-org/web.git', 'https://192.168.1.20/acme-org/web', 'git@203.0.113.7:acme-org/web.git', 'https://127.example.org/acme-org/web',
    'https://localhost.example.org/acme-org/web', 'https://mylocalhost/acme-org/web', 'git@git-127.example.org:acme-org/web.git',
  ]) expect(refusal(src)).toBe(`${src} -> allowed`)
})

// ---- $(cat <<'EOF' ... EOF) values (MC-126 review) ----

const sub = (body: string) => `$(cat <<'EOF'\n${body}\nEOF\n)`

test('a $(cat <<EOF) value hides nothing from the push, command-name and gh rules', () => {
  // Each was allowed when the tokenizer read the value as the word HEREDOC.
  expect(C(`git push origin ${sub('main')}`)).toContain('stands only as a commit, tag, note or merge message')
  expect(C(`git push -u origin "${sub('main')}"`)).toContain('stands only as a commit, tag, note or merge message')
  expect(C(`git push origin ${sub('feat/x --force')}`)).toContain('stands only as a commit, tag, note or merge message')
  expect(C(`${sub('git')} push origin main`)).toContain('never a command name built from a variable')
  expect(C(`gh api ${sub('graphql -f query=x')}`)).toContain('stands only as a --title or --body')
  expect(C(`gh pr create ${sub('--repo other/repo')}`)).toContain('stands only as a --title or --body')
  expect(C(`git fetch ${sub('--upload-pack=x /tmp/r')}`)).toContain('stands only as a commit, tag, note or merge message')
  expect(C(`git remote ${sub('set-url origin x')}`)).toContain('stands only as a commit, tag, note or merge message')
  // A -C value is read with git's global options, which take only a literal value.
  expect(C(`git -C ${sub('/tmp/r')} status`)).toContain('The value of git -C must be literal')
  expect(K(`${AT_HOME}git clone -b ${sub('main --config=core.sshCommand=x --separate-git-dir=/tmp/g')} ${WEB}`)).toContain('stands only as a commit, tag, note or merge message')
  // Off a message option it is refused too: -F names a file, --grep a pattern.
  expect(C(`git commit -F "${sub('x')}"`)).toContain('stands only as a commit, tag, note or merge message')
  expect(C(`git log --grep "${sub('x')}"`)).toContain('stands only as a commit, tag, note or merge message')
})

test('a $(cat <<EOF) value still passes as a message, in each spelling git and gh take', () => {
  for (const cmd of [
    `git commit -m "${sub('fix(x): tidy')}"`, `git commit -am "${sub('fix(x): tidy')}"`, `git commit --message "${sub('x')}"`,
    `git commit --message="${sub('x')}"`, `git commit -m"${sub('x')}"`, `git commit -m "subject" -m "${sub('body')}"`,
    `git tag -a v1 -m "${sub('release')}"`, `git merge --no-ff -m "${sub('merge x')}" feat/x`, `git notes add -m "${sub('n')}"`,
    `gh pr create --title "t" --body "${sub('## Summary\n- push and stash notes')}"`, `gh pr comment 12 -b "${sub('looks good')}"`,
    `gh issue create -t "${sub('t')}" -b "${sub('b')}"`, `echo "${sub('notes on git')}"`,
  ]) expect(`${cmd} -> ${C(cmd) ?? 'allowed'}`).toBe(`${cmd} -> allowed`)
  expect(B(`git commit -m "${sub('fix(x): tidy')}"`)).toBeUndefined()
})

test('an unquoted $(cat <<EOF) value word-splits, so a message option cannot carry it', () => {
  // Unquoted, the body splits: -m takes its first word and the rest ride in as options. Each was
  // allowed while the value was read as a message regardless of quoting.
  expect(C(`git commit -m ${sub('fix -X foo')}`)).toContain('stands only as a commit, tag, note or merge message')
  expect(C(`git commit -m${sub('fix -X foo')}`)).toContain('stands only as a commit, tag, note or merge message')
  expect(C(`git tag -a v1 -m ${sub('rel --sign')} feat/x`)).toContain('stands only as a commit, tag, note or merge message')
  expect(C(`gh api repos/o/r/pulls/1/merge -t ${sub('x -X PUT -f merge_method=squash')}`)).toContain('stands only as a --title or --body')
  expect(C(`gh pr create --title t --body ${sub('b --repo other/repo')}`)).toContain('stands only as a --title or --body')
  // Wholly inside double quotes it is one argument, so it still stands as the message.
  expect(C(`git commit -m "${sub('fix -X foo')}"`)).toBeUndefined()
  expect(C(`git commit -m"${sub('fix -X foo')}"`)).toBeUndefined()
  expect(C(`gh pr create --title t --body "${sub('b --repo other/repo')}"`)).toBeUndefined()
})

test('a $(cat <<EOF) inside single quotes or a comment is text, so the lines it spans still run', () => {
  // zsh and bash run the middle line of each; the old pre-pass swallowed it with the heredoc.
  expect(C(`echo '$(cat <<'EOF'\n' && git push origin main && echo '\nEOF\n)'`)).toContain('base or deploy branch')
  expect(C(`# $(cat <<'EOF'\ngit push origin main\n: <<'X'\nEOF\n)\nX`)).toContain('base or deploy branch')
  // The body ends only at a line that is exactly the delimiter, as zsh and bash end it.
  expect(C(`git commit -m "$(cat <<'EOF'\nmsg\n  EOF\n)"`)).toContain('run plainly')
  expect(C(`git commit -m "$(cat <<'EOF'\nmsg\nEOF \n)"`)).toContain('run plainly')
  expect(C(`git commit -m "$(cat <<-'EOF'\n\tmsg\n\tEOF\n)"`)).toBeUndefined()
})

test('a redirect heredoc ends where the shell ends it, and a delimiter it cannot read exactly makes the line unreadable', () => {
  // zsh -c runs the push in each: the old reader ended the body at " A", or never saw a heredoc begin.
  expect(C(`cat > /dev/null <<'A'\n A\necho '\nA\ngit push origin main\n' x'`)).toContain('base or deploy branch')
  expect(C(`cat > /dev/null <<\\EOF\necho '\nEOF\ngit push origin main\n' x'`)).toContain('run plainly')
  expect(C(`cat > /dev/null <<E"O"F\nE\necho '\nEOF\ngit push origin main\n' x'`)).toContain('run plainly')
  // Still read: a plain heredoc, a <<- one with a tab-indented terminator, and a commit message on stdin.
  expect(C("cat > /tmp/x <<'A'\nbody\nA\ngit push origin main")).toContain('base or deploy branch')
  expect(C('cat > /tmp/x <<-A\n\tbody\n\tA\ngit status')).toBeUndefined()
  expect(C("git commit -F - <<'EOF'\nfix(x): tidy\nEOF")).toBeUndefined()
})

test('on a line that names git, a $(cat <<EOF) value is no other command\'s argument, redirect or hidden path', () => {
  expect(C(`eval "${sub('git push origin main')}"`)).toContain('never as an argument of eval')
  expect(C(`find . -name x -exec ${sub('git')} push origin main ';'`)).toContain('never as an argument of find')
  expect(C(`echo x | xargs ${sub('git')} push origin main`)).toContain('never as an argument of xargs')
  expect(C(`echo x > "${sub('/tmp/out')}"`)).toContain('never names a redirect target')
  // Its body is checked for Flight's files like any other word, except as a git or gh message.
  const today = ['_command', 'daily', 'today.md'].join('/')
  expect(C(`cp report.md "${sub(today)}"`)).toContain('Flight\'s to write')
  expect(C(`cat "${sub(today)}"`)).toBeUndefined()
  expect(C(`git commit -m "${sub(`docs: sync ${today}`)}"`)).toBeUndefined()
  expect(C(`gh pr create --title t --body "${sub(`rewrites ${today}`)}"`)).toBeUndefined()
})

test('on a line that names git or gh, nothing sets a variable that moves what git reads or runs', () => {
  const P = (cmd: string) => shellRefusal('controller', cmd, [], '/w/fronts/acme/web')
  const AT = 'cd /w/fronts/acme/web && '
  for (const cmd of [
    `export HOME=/tmp/h; ${AT}git status`, `export XDG_CONFIG_HOME=/tmp/x && ${AT}git status`, `export PATH=/tmp/bin:/usr/bin; ${AT}git status`,
    `export CDPATH=/tmp; ${AT}git status`, `export SSH_AUTH_SOCK=/tmp/s; ${AT}git status`, `declare -x HOME=/tmp/h; ${AT}git status`,
    `readonly ZDOTDIR=/tmp/z; ${AT}git status`, `HOME=/tmp/h; ${AT}git status`, `PATH+=:/tmp/bin; ${AT}git status`,
    `CDPATH=/tmp cd x && ${AT}git status`, `export HOME; ${AT}git status`, `export X="$Y"; ${AT}git status`, `GIT_DIR=/x; ${AT}git status`,
    `BASH_ENV=/tmp/e; ${AT}gh pr list`,
    // git runs EDITOR, VISUAL and PAGER as programs, and the loader honours DYLD_* and LD_*.
    `export EDITOR=/tmp/e.sh; ${AT}git commit --allow-empty`, `export VISUAL=/tmp/v; ${AT}git commit --allow-empty`,
    `export PAGER=/tmp/p; ${AT}git log`, `export DYLD_INSERT_LIBRARIES=/tmp/x.dylib; ${AT}git status`, `LD_PRELOAD=/tmp/x.so; ${AT}git status`,
  ]) expect(`${cmd} -> ${P(cmd) ?? 'allowed'}`).toContain('nothing sets HOME, PATH, CDPATH')
  // An append assignment is an assignment too: before git it is an environment prefix.
  expect(C('FOO+=x git status')).toContain('environment prefix')
  expect(P(`. ./env.sh && ${AT}git status`)).toContain('. does not run')
  expect(P(`source ./env.sh && ${AT}git status`)).toContain('source does not run')
  // A line without git or gh may set them, since nothing on it reads them; other variables pass beside git.
  expect(P('export PATH=/opt/homebrew/bin:/usr/bin && node -v')).toBeUndefined()
  expect(P('HOME=/tmp/h npm test')).toBeUndefined()
  expect(P(`export NODE_ENV=test; ${AT}git status`)).toBeUndefined()
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

// ---- What the skills run (MC-162) ----
// The acme Controller's repo, one level under its front's folder, as /console staff sets it for a one-repo front.

const REPO = '/w/fronts/acme/acme'
// The worktrees of the acme repo the fleet found registered beside it (MC-167).
const WT = ['/w/fronts/acme/acme-beta-318', '/w/fronts/acme/acme-x']
const R = (cmd: string, role: 'controller' | 'back room' = 'controller', clone: CloneScope | undefined = ACME) => shellRefusal(role, cmd, [], REPO, clone, undefined, WT)
const IN = `cd ${REPO} && `

test('a Controller edits its own PR: body, title, base and labels', () => {
  expect(R(`${IN}gh pr edit 40 --body "${sub('## Summary\n\nx')}"`)).toBeUndefined()
  expect(R(`${IN}gh pr edit 40 --title 'fix(mc-1): x' --add-label bug`)).toBeUndefined()
  expect(R(`${IN}gh pr edit fix/mc-1-x --base fix/mc-0-y`)).toBeUndefined()
})

test('a Controller marks its own PR ready for review, and back to draft', () => {
  expect(R(`${IN}gh pr ready 40`)).toBeUndefined()
  expect(R(`${IN}gh pr ready 40 --undo`)).toBeUndefined()
})

test('a Controller reruns its own CI', () => {
  expect(R(`${IN}gh run rerun 39037584041 --failed`)).toBeUndefined()
  expect(R(`${IN}gh run view 39037584041 --log-failed`)).toBeUndefined()
})

test('a Controller writes through gh api to its own repo\'s PR, issue, comment and CI-rerun endpoints', () => {
  expect(R(`${IN}gh api -X PATCH repos/{owner}/{repo}/pulls/40 -f body=x`)).toBeUndefined()
  expect(R(`${IN}gh api repos/{owner}/{repo}/issues/40/comments -f body=x`)).toBeUndefined()
  expect(R(`${IN}gh api --method POST 'repos/{owner}/{repo}/actions/runs/9/rerun-failed-jobs'`)).toBeUndefined()
  expect(R(`${IN}gh api -XPATCH repos/{owner}/{repo}/issues/comments/7 --input body.json`)).toBeUndefined()
  // Reads go anywhere, as before.
  expect(R(`${IN}gh api repos/other/repo/pulls/3/comments`)).toBeUndefined()
  expect(R(`${IN}gh api -X GET search/issues -f q=repo:o/r`)).toBeUndefined()
})

test('gh api refuses a delete, a merge, another repo and every endpoint off the list', () => {
  expect(R(`${IN}gh api -X DELETE repos/{owner}/{repo}/issues/comments/7`)).toContain('-X DELETE is not allowed')
  expect(R(`${IN}gh api --method=delete repos/{owner}/{repo}/pulls/comments/7`)).toContain('-X DELETE is not allowed')
  expect(R(`${IN}gh api -X PUT repos/{owner}/{repo}/pulls/40/merge`)).toContain('founder')
  expect(R(`${IN}gh api repos/{owner}/{repo}/merges -f base=main -f head=x`)).toContain('founder')
  const OFF = 'writes only to the pinned repo'
  expect(R(`${IN}gh api -X PATCH repos/other/repo/pulls/3 -f body=x`)).toContain(OFF)
  expect(R(`${IN}gh api -X PATCH repos/{owner}/{repo}/git/refs/heads/main -f sha=1`)).toContain(OFF)
  expect(R(`${IN}gh api -X PUT repos/{owner}/{repo}/contents/README.md -f message=x -f content=eA==`)).toContain(OFF)
  expect(R(`${IN}gh api -X PATCH repos/{owner}/{repo} -f default_branch=x`)).toContain(OFF)
  expect(R(`${IN}gh api -X POST repos/{owner}/{repo}/actions/workflows/deploy.yml/dispatches -f ref=main`)).toContain(OFF)
  // Cancelling a run can stop a deploy halfway.
  expect(R(`${IN}gh api -X POST repos/{owner}/{repo}/actions/runs/9/cancel`)).toContain(OFF)
  expect(R(`${IN}gh api -X PATCH repos/{owner}/{repo}/pulls/$N -f body=x`)).toContain('must be literal')
  expect(R(`${IN}gh api -X PATCH repos/{owner}/{repo}/pulls/{1,2} -f body=x`)).toContain('must be literal')
  expect(R(`${IN}gh api --hostname ghe.example.com repos/{owner}/{repo}/pulls/3`)).toContain('--hostname')
  expect(R(`${IN}gh api -H 'X-HTTP-Method-Override: DELETE' repos/{owner}/{repo}/pulls/3 -f x=1`)).toContain('overrides its method')
  expect(R(`${IN}gh api -iX DELETE repos/{owner}/{repo}/pulls/comments/7`)).toContain('one at a time')
  expect(R(`${IN}gh api graphql -f query=x`)).toContain('graphql')
})

test('gh write verbs name their PR or issue in the pinned repo, never by URL', () => {
  expect(R(`${IN}gh pr edit https://github.com/other/repo/pull/3 --body x`)).toContain('never by URL')
  // With no scheme gh reads it as a branch name of the pinned repo, which is no other repo's item.
  expect(R(`${IN}gh pr comment github.com/other/repo/pull/3 --body x`)).toBeUndefined()
  expect(R(`${IN}gh issue close https://github.com/other/repo/issues/9`)).toContain('never by URL')
  expect(R(`${IN}gh pr view https://github.com/other/repo/pull/3`)).toBeUndefined()
})

test('gh refuses what cannot be undone or reaches every session: issue delete and transfer, auth switch, merge', () => {
  expect(R(`${IN}gh issue delete 9 --yes`)).toContain('cannot be undone')
  expect(R(`${IN}gh issue transfer 9 other/repo`)).toContain('cannot be undone')
  expect(R(`${IN}gh issue comment 9 --body x`)).toBeUndefined()
  expect(R(`${IN}gh auth switch --user acme-bot`)).toContain('every session on this Mac')
  expect(R(`${IN}gh pr merge 40 --squash`)).toContain('founder')
})

test('a Controller runs git and gh from a worktree beside its repo, fronts/<front>/<repo>-<slug> (MC-160)', () => {
  expect(R('cd /w/fronts/acme/acme-beta-318 && gh run view 5 --log-failed')).toBeUndefined()
  expect(R('cd /w/fronts/acme/acme-beta-318 && gh pr edit 3 --body x')).toBeUndefined()
  expect(R('cd /w/fronts/acme/acme-beta-318/src && git status')).toBeUndefined()
  expect(R('git -C /w/fronts/acme/acme-beta-318 push -u origin feat/beta-318')).toBeUndefined()
})

test('only a worktree beside the repo counts: not another folder, not beside a front, not for the back room', () => {
  expect(R('cd /w/fronts/acme/other && git status')).toContain('outside your console')
  expect(R('cd /w/fronts/acme/acmeX && git status')).toContain('outside your console')
  expect(R('cd /w/fronts/acme/acme-.. && git status')).toContain('outside your console')
  expect(R('cd /w/fronts/acme/acme-x/../../globex && git status')).toContain('outside your console')
  expect(R('cd /w/fronts/acme/acme-x && git status', 'back room')).toContain('outside your console')
  expect(shellRefusal('controller', 'cd /w/fronts/acme/acme-x && git status', [], REPO)).toContain('outside your console')
  // A console whose directory is its front's folder: beside it lies another front.
  expect(shellRefusal('controller', 'cd /w/fronts/acme-x && git status', [], '/w/fronts/acme', ACME)).toContain('outside your console')
  // A sibling worktree is still no place to clone from.
  expect(R('cd /w/fronts/acme/acme-x && git clone https://github.com/o/r.git')).toContain('clones only into a front')
})

test('gh api reads a method written -X=VALUE as pflag does, so -X=DELETE is a delete', () => {
  expect(R(`${IN}gh api -X=DELETE repos/{owner}/{repo}/issues/comments/7`)).toContain('-X DELETE is not allowed')
  expect(R(`${IN}gh api -X=PATCH repos/{owner}/{repo}/pulls/40 -f body=x`)).toBeUndefined()
})

test('gh api takes no word the shell expands: a variable or glob could become a method, a field or an option', () => {
  const NOT = 'must be literal'
  expect(R(`${IN}gh api -X$M repos/{owner}/{repo}/issues/comments/7`)).toContain(NOT)
  expect(R(`${IN}gh api -X "$M" repos/{owner}/{repo}/issues/comments/7`)).toContain(NOT)
  expect(R(`${IN}gh api -X DEL* repos/{owner}/{repo}/issues/comments/7`)).toContain(NOT)
  expect(R(`${IN}gh api repos/{owner}/{repo}/pulls/40 $OPTS`)).toContain(NOT)
  expect(R(`${IN}gh api repos/{owner}/{repo}/pulls/40 -f body=$B`)).toContain(NOT)
  // The {owner} and {repo} placeholders are the one brace form taken, and only in the endpoint.
  expect(R(`${IN}gh api repos/{owner}/{repo}/pulls/40/comments`)).toBeUndefined()
})

test('gh issue develop is refused: it makes a branch under any name, in any repo', () => {
  expect(R(`${IN}gh issue develop 9 --name release/x`)).toContain('gh issue develop is not allowed')
})

test('a gh write verb refuses an OWNER/REPO#N reference, and a body that only mentions a URL passes', () => {
  expect(R(`${IN}gh issue comment other/repo#1 --body x`)).toContain('never by URL')
  expect(R(`${IN}gh pr comment 40 --body "https://github.com/o/r/pull/3 follow-up"`)).toBeUndefined()
})

test('a gh write verb takes only a number or a branch as its item: gh reads a URL with any tail as that URL', () => {
  const URL = 'never by URL'
  expect(R(`${IN}gh pr edit https://github.com/other/repo/pull/3/files --body x`)).toContain(URL)
  expect(R(`${IN}gh pr edit 'https://github.com/other/repo/pull/3#issuecomment-1' --body x`)).toContain(URL)
  expect(R(`${IN}gh pr ready 'https://github.com/other/repo/pull/3?x=1'`)).toContain(URL)
  expect(R(`${IN}gh pr comment owner/repo#3 --body x`)).toContain(URL)
  expect(R(`${IN}gh issue close http://github.com/other/repo/issues/9`)).toContain(URL)
  expect(R(`${IN}gh pr edit $PR --body x`)).toContain(URL)
  // A branch with a slash, a body or title holding a URL, and a valued option before the item all pass.
  expect(R(`${IN}gh pr ready feat/x`)).toBeUndefined()
  expect(R(`${IN}gh pr edit --title 'see https://github.com/o/r/pull/3/files' 40`)).toBeUndefined()
  expect(R(`${IN}gh issue comment 9 --body 'https://github.com/o/r/issues/9#x'`)).toBeUndefined()
  expect(R(`${IN}gh pr comment 40 --delete-last --yes`)).toContain('cannot be restored')
})

test('each gh write verb reads only its own valued options, so a boolean flag cannot pass a URL off as its value', () => {
  const URL = 'never by URL'
  // gh issue comment and gh pr comment take no -c, -a or -r value: what follows is the item.
  expect(R(`${IN}gh issue comment -c https://github.com/o/r/issues/3 -b x`)).toContain(URL)
  expect(R(`${IN}gh pr comment -a https://github.com/o/r/pull/3 -b x`)).toContain(URL)
  expect(R(`${IN}gh pr ready -r https://github.com/o/r/pull/3`)).toContain(URL)
  expect(R(`${IN}gh pr edit -c https://github.com/o/r/pull/3 -b x`)).toContain(URL)
  // gh issue close -c is its comment: text that may hold a URL.
  expect(R(`${IN}gh issue close 9 -c 'https://github.com/o/r/issues/9 covers it'`)).toBeUndefined()
  expect(R(`${IN}gh issue close 9 -c https://github.com/o/r/issues/9`)).toBeUndefined()
})

test('a URL or OWNER/REPO#N anywhere in a gh write command fails closed unless it is body, title or comment text', () => {
  const URL = 'never by URL'
  expect(R(`${IN}gh pr create --head https://github.com/o/r/pull/3 --title t --body b`)).toContain(URL)
  expect(R(`${IN}gh pr edit 40 --add-label o/r#3`)).toContain(URL)
  expect(R(`${IN}gh pr edit 40 --base=https://github.com/o/r/pull/3`)).toContain(URL)
  expect(R(`${IN}gh pr edit 40 --title 'see https://github.com/o/r/pull/3' --body 'and o/r#3'`)).toBeUndefined()
  expect(R(`${IN}gh pr edit 40 --body=https://github.com/o/r/pull/3`)).toBeUndefined()
})

// ---- The shell's own directory (MC-168, MC-155) ----
// When a command opens with `cd <the directory the shell is already in> &&`, the engine hands the guard
// the command without that cd, so a pinned call reads as unpinned. The fleet records where each agent's
// shell is from the engine's CwdChanged event; the guard pins a call with no cd before it there.

const S = (cmd: string, start?: string, role: 'controller' | 'back room' = 'controller') => shellRefusal(role, cmd, [], REPO, ACME, start, WT)

test('a call the engine stripped of its cd to the shell\'s own directory is pinned there', () => {
  expect(S('gh pr list --limit 1', REPO)).toBeUndefined()
  expect(S('gh pr view 40 --json state', `${REPO}/tools`)).toBeUndefined()
  expect(S('git status', REPO)).toBeUndefined()
  expect(S('git push -u origin feat/x', '/w/fronts/acme/acme-beta-318')).toBeUndefined()
  expect(S('npm test && git status', REPO)).toBeUndefined()
})

test('the shell\'s directory pins only where nothing on the line moved it, and stays inside the console', () => {
  // Outside the console: refused by where it is, as a cd there is.
  expect(S('gh pr list', '/w/fronts/globex')).toContain('/w/fronts/globex is outside your console\'s directory (/w/fronts/acme/acme)')
  // A cd earlier on the line, chained or not, moves the shell, so the start no longer pins.
  expect(S('cd /tmp; git status', REPO)).toContain('Pin the repo')
  expect(S('cd sub || true; gh pr list', REPO)).toContain('Pin the repo')
  expect(S('pushd /tmp && popd && git status', REPO)).toContain('Pin the repo')
  // With no start known, an unpinned call is refused as before.
  expect(S('gh pr list')).toContain('Pin the repo')
  expect(S('git status', '')).toContain('Pin the repo')
  // A relative or unreadable start never pins.
  expect(S('git status', 'fronts/acme/acme')).toContain('Pin the repo')
  // The back room's git rules still hold from its start.
  expect(S('git push -u origin feat/x', REPO, 'back room')).toContain('never runs git push')
})

test('the shell\'s directory reaches the guard through toolRefusal', () => {
  expect(toolRefusal('controller', 'Bash', { command: 'gh pr list' }, [], REPO, ACME, REPO)).toBeUndefined()
  expect(toolRefusal('controller', 'Bash', { command: 'gh pr list' }, [], REPO, ACME)).toContain('Pin the repo')
})

test('anything before the call that is not a known program could move the shell, so the shell\'s directory pins nothing after it', () => {
  // Each spelling moves the shell (or may) without a cd at the head of its command.
  for (const before of [
    'eval cd /w/fronts/globex;', 'eval "cd /w/fronts/globex" &&', 'noglob cd /w/fronts/globex &&', 'nocorrect cd /w/fronts/globex &&',
    'repeat 1 cd /w/fronts/globex;', 'z globex &&', 'exec /bin/zsh -c x;', 'builtin cd /w/fronts/globex &&', 'command cd /w/fronts/globex &&',
    '$GO /w/fronts/globex &&', 'f() { cd /w/fronts/globex; };', 'go_there &&',
  ]) {
    // Refused, by whichever rule reads it first: the start never pins a call after a move.
    expect(`${before} -> ${S(`${before} git status`, REPO) ?? 'allowed'}`).not.toBe(`${before} -> allowed`)
  }
  // Known programs cannot move the shell they run from, so the start still pins after them.
  for (const before of ['npm test &&', 'pnpm -s build &&', 'echo ok;', 'ls -la &&', 'git fetch origin &&', 'true &&']) {
    expect(`${before} -> ${S(`${before} git status`, REPO) ?? 'allowed'}`).toBe(`${before} -> allowed`)
  }
})

// ---- Worktrees beside the repo, registered (MC-167) ----

test('a folder beside the repo counts only when it is one of the repo\'s registered worktrees', () => {
  const W = (cmd: string, worktrees?: string[]) => shellRefusal('controller', cmd, [], REPO, ACME, undefined, worktrees)
  // A separate repository named <repo>-<anything> beside the repo is no worktree of it.
  expect(W('cd /w/fronts/acme/acme-api && git push -u origin feat/x', WT)).toContain('/w/fronts/acme/acme-api is outside your console\'s directory')
  expect(W('cd /w/fronts/acme/acme-api && gh pr edit 3 --body x', WT)).toContain('outside your console')
  // With no worktree list (the fleet could not read the front's folder), nothing beside the repo counts.
  expect(W('cd /w/fronts/acme/acme-beta-318 && git status')).toContain('outside your console')
  expect(W('cd /w/fronts/acme/acme-beta-318 && git status', [])).toContain('outside your console')
  // A registered worktree, and folders inside it, count.
  expect(W('cd /w/fronts/acme/acme-beta-318/src && git status', WT)).toBeUndefined()
  // A list entry that is not beside the repo admits nothing.
  expect(W('cd /w/fronts/globex && git status', ['/w/fronts/globex'])).toContain('outside your console')
})

test('a .git file registers a worktree of the repo only by a gitdir line under the repo\'s own worktrees folder', () => {
  expect(registersWorktree('gitdir: /w/fronts/acme/acme/.git/worktrees/acme-beta-318\n', REPO)).toBe(true)
  expect(registersWorktree('gitdir: /w/fronts/acme/other/.git/worktrees/acme-x', REPO)).toBe(false)
  expect(registersWorktree('gitdir: /w/fronts/acme/acme/.git/modules/x', REPO)).toBe(false)
  expect(registersWorktree('gitdir: /w/fronts/acme/acme/.git/worktrees/a/../../../../globex/.git', REPO)).toBe(false)
  expect(registersWorktree('gitdir: relative/.git/worktrees/x', REPO)).toBe(false)
  // git writes a relative line with worktree.useRelativePaths: read from the folder the .git file is in.
  expect(registersWorktree('gitdir: ../acme/.git/worktrees/acme-x', REPO, '/w/fronts/acme/acme-x')).toBe(true)
  expect(registersWorktree('gitdir: ../other/.git/worktrees/acme-x', REPO, '/w/fronts/acme/acme-x')).toBe(false)
  expect(registersWorktree('gitdir: ../acme/.git/worktrees/x/../../../../globex/.git', REPO, '/w/fronts/acme/acme-x')).toBe(false)
  expect(registersWorktree('', REPO)).toBe(false)
  expect(registersWorktree('[core]\n\tbare = false', REPO)).toBe(false)
})

// ---- A Controller's workflow script, read by the parser (MC-166) ----

const WF = (body: string, room = 100) => toolRefusal('controller', 'Workflow', { script: `export const meta = { name: 'x', description: 'd' }\n${body}\nawait agent('q', { model: 'sonnet', effort: 'low' })` }, [], undefined, undefined, undefined, undefined, room)

test('workflow: a computed key reaches no constructor, in a pattern or an object literal, nor does a template spelling', () => {
  for (const [body, why] of [
    ["const { ['constr' + 'uctor']: F } = { a: 1 }\nF('return this')()", 'computes an object key only from a plain string or number literal'],
    ['const { [`constructor`]: F } = { a: 1 }', 'computes an object key only from a plain string or number literal'],
    ["const { a: { ['proto' + 'type']: P } } = { a: {} }", 'computes an object key only from a plain string or number literal'],
    ["const f = ({ ['constr' + 'uctor']: F }) => F", 'computes an object key only from a plain string or number literal'],
    ["const o = { ['constr' + 'uctor']: 1 }", 'computes an object key only from a plain string or number literal'],
    ["const o = { [args.k]: 1 }", 'computes an object key only from a plain string or number literal'],
    ["const { ['constructor']: F } = { a: 1 }", 'may not name constructor, even as a string'],
    ["const { constructor: F } = { a: 1 }", 'may not define or read constructor'],
    ['const k = `constructor`', 'may not name constructor, even as a string'],
    ['const k = `${1}prototype`', 'may not name prototype, even as a string'],
  ] as const) expect(`${body} -> ${WF(body) ?? 'admitted'}`).toContain(why)
})

test('workflow: the API is only called, never read as a value, destructured or passed on', () => {
  for (const body of ['const { name } = log', 'const [a] = parallel', 'const f = x => x\nf(log)', "const o = { pipeline }", 'const p = phase']) {
    expect(`${body} -> ${WF(body) ?? 'admitted'}`).toContain('other than as a direct call')
  }
  expect(WF("log('x')\nawait phase('p')")).toBeUndefined()
})

test('workflow: every name the script reads is its own or on the allowlist; a function never names itself', () => {
  for (const name of ['fetch', 'setTimeout', 'structuredClone', 'Symbol', 'WebAssembly', 'queueMicrotask', 'Intl']) {
    expect(`${name} -> ${WF(`${name}()`) ?? 'admitted'}`).toContain(`reads ${name}, which it does not declare`)
  }
  // A name declared in an inner scope is not declared outside it.
  expect(WF('{ const fetch = 1 }\nfetch()')).toContain('reads fetch, which it does not declare')
  expect(WF('const g = (fetch) => fetch\nfetch()')).toContain('reads fetch, which it does not declare')
  // A named function expression that calls itself could recurse past the count.
  expect(WF("await parallel(['a'].map(function go(f) { go(f); return agent(f, { model: 'sonnet', effort: 'low' }) }))")).toContain('names itself')
  // Its own declarations, parameters, catch bindings, loop bindings and labels are read freely.
  expect(WF("const files = args.files ?? []\nlet n = 0\nfor (const f of files) n += f.length\ntry { JSON.parse('{}') } catch (err) { log(String(err)) }\nouter: for (const a of [1]) { break outer }\nconst { a, b: [c] } = { a: 1, b: [2] }\nlog(Math.max(n, a, c))")).toBeUndefined()
})
