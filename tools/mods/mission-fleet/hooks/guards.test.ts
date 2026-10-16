import { expect, test } from 'claude-code/testing'

import type { PollItem } from '../types'
import { awaitingFlight, fleetSelfApproval, isFlightOnly, isRelayedVerb, RELAY_TTL, relayHold, splitRelayCode, spendRelayCode, isShellLikeTool, pinnedDir, protectedFromSpoke, pushDestination, shellRefusal, tokenize, toolRefusal } from './guards'
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
  const P = (cmd: string) => shellRefusal('controller', cmd, [], '/w/fronts/karnak')
  expect(P('git status')).toContain('Pin the repo')
  expect(P('gh pr list')).toContain('Pin the repo')
  expect(P('cd /w/fronts/karnak && git status')).toBeUndefined()
  expect(P('git -C /w/fronts/karnak status')).toBeUndefined()
  expect(P('cd /w/fronts/karnak && cd sub && git status')).toBeUndefined()
  expect(P('cd /w/fronts/karnak && gh pr checks 3')).toBeUndefined()
  expect(P('cd /w && git status')).toContain('outside your console')
  expect(P('cd /w/fronts/karnak/../tascode && git push -u origin feat/x')).toContain('outside your console')
  expect(P('git -C /w/fronts/karnakX status')).toContain('outside your console')
  expect(P('cd $REPO && git status')).toContain('Pin the repo')
  expect(P('cd fronts/karnak && git status')).toContain('Pin the repo')
  expect(P('npm test')).toBeUndefined()
  expect(P('git -C /w/fronts/karnak -C /w/fronts/tascode status')).toContain('Pin the repo')
  expect(P('cd /w/fronts/karnak && git --git-dir=/w/fronts/tascode/.git status')).toContain('Pin the repo')
  expect(P('cd /w/fronts/karnak && git --work-tree /x status')).toContain('Pin the repo')
  expect(P('cd /w/fronts/karnak && pushd /w/fronts/tascode && git status')).toContain('Pin the repo')
  expect(pinnedDir(tokenize('cd /a && cd ../b && git log').commands, 2)).toBe('/b')
  expect(toolRefusal('controller', 'Bash', { command: 'git status' }, [], '/w/fronts/karnak')).toContain('Pin the repo')
})

test('a fleet agent cannot start another Claude session', () => {
  expect(C('claude -p --model haiku "hi"')).toContain('never starts another Claude session')
  expect(B('cd /tmp && claude -p x')).toContain('never starts another Claude session')
})

test('a pin counts only for a directly preceding cd chain, with no options or subshells', () => {
  const P = (cmd: string) => shellRefusal('controller', cmd, [], '/w/fronts/karnak')
  expect(P('false && cd /w/fronts/karnak; git status')).toContain('Pin the repo')
  expect(P('(cd /w/fronts/karnak); git status')).toContain('Pin the repo')
  expect(P('cd /w/fronts/karnak | cat; git status')).toContain('Pin the repo')
  expect(P('cd -P /w/fronts/karnak && git status')).toContain('Pin the repo')
  expect(P('cd /w/fronts/karnak && npm test && git status')).toContain('Pin the repo')
  expect(P('cd /w/fronts/karnak/ && git status')).toBeUndefined()
  expect(P('cd /w/fronts/karnak && gh -R other/repo pr list')).toContain('gh -R')
})

test('gh repo overrides in any form are refused', () => {
  const P = (cmd: string) => shellRefusal('controller', cmd, [], '/w/fronts/karnak')
  expect(P('cd /w/fronts/karnak && gh pr list -Rother/repo')).toContain('gh -R')
  expect(P('cd /w/fronts/karnak && gh pr list --repo=other/repo')).toContain('gh -R')
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
  expect(C('grep -r token /Users/x/.claude-tascode/projects/abc/')).toContain('transcripts')
  expect(toolRefusal('back room', 'Grep', { pattern: 't=', path: '/Users/x/.claude/projects' }, [])).toContain('transcripts')
})

test('fleet agents cannot read the app token or the profile registry', () => {
  expect(C('cat ~/.mission-control/app-token')).toContain('app')
  expect(C('cat $HOME/.mission-control/app-token')).toContain('app')
  expect(B('ls /Users/x/.mission-control/flights')).toContain('app')
  expect(C('cd ~/.mission-control && cat app-token')).toContain('app')
  expect(toolRefusal('controller', 'Read', { file_path: '/Users/x/.mission-control/app-token' }, [])).toContain('app')
  expect(toolRefusal('back room', 'Grep', { pattern: 'x', path: '~/.mission-control' }, [])).toContain('app')
  expect(toolRefusal('controller', 'Glob', { pattern: '**/*', path: '/Users/x/.mission-control/flights' }, [])).toContain('app')
  // The workspace folder named mission-control (no leading dot) stays readable.
  expect(C('cat /Users/x/Desktop/mission-control/README.md')).toBeUndefined()
  expect(toolRefusal('controller', 'Read', { file_path: '/Users/x/Desktop/mission-control/README.md' }, [])).toBeUndefined()
})

test('the app-home guard sees case, quoting, braces, separators and the token by name', () => {
  const R = 'profile registry'
  expect(C('cat ~/.Mission-Control/app-token')).toContain(R)
  expect(toolRefusal('controller', 'Read', { file_path: '/Users/x/.MISSION-CONTROL/app-token' }, [])).toContain(R)
  expect(C("cat ~/.mission''-control/app-token")).toContain(R)
  expect(C('cat ~/."mission-control"/app-token')).toContain(R)
  expect(C('cat ~/.mission\\-control/app-token')).toContain(R)
  expect(C('cat ~/{.mission-control,x}/app-token')).toContain(R)
  expect(C('cd ~;cat<.mission-control/app-token')).toContain(R)
  expect(toolRefusal('controller', 'Glob', { pattern: '{.mission-control,x}/**', path: '/Users/x' }, [])).toContain(R)
  expect(C('find ~ -name app-token -exec cat {} +')).toContain(R)
  expect(toolRefusal('controller', 'Glob', { pattern: '**/app-token', path: '/Users/x' }, [])).toContain(R)
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
    { callSign: 'KARNAK', agentId: '', name: 'console-karnak', status: 'staffing' },
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
    { callSign: 'KARNAK', agentId: 'k1', name: 'console-karnak', status: 'staffed' },
  ]
  expect(fleetSelfApproval('SendMessage', { to: 'a1', message: 'go' }, seats)).toBeUndefined()
  expect(fleetSelfApproval('SendMessage', { to: 'k1', message: 'go' }, seats)).toBe('KARNAK')
})

test('the fleet approves its own spawn only of a Controller under a reserved console name', () => {
  const seats = [{ callSign: 'KARNAK', agentId: '', name: 'console-karnak', status: 'staffing' }]
  expect(fleetSelfApproval('Agent', { subagent_type: 'mission-fleet:controller', name: 'console-karnak' }, seats)).toBe('KARNAK')
  expect(fleetSelfApproval('Agent', { subagent_type: 'general-purpose', name: 'console-karnak' }, seats)).toBeUndefined()
  expect(fleetSelfApproval('Agent', { subagent_type: 'mission-fleet:controller', name: 'console-other' }, seats)).toBeUndefined()
  expect(fleetSelfApproval('Agent', { subagent_type: 'mission-fleet:controller', name: 'console-karnak' }, [{ ...seats[0]!, status: 'staffed', agentId: 'a2' }])).toBeUndefined()
  expect(fleetSelfApproval('Bash', { command: 'ls' }, seats)).toBeUndefined()
})

test('app console ops that message or start an agent are relayed through Flight', () => {
  for (const a of ['staff karnak', 'call KARNAK hi', 'go MI8', 'nogo MI8 not now', 'no-go MI8', 'retry MI8', 'dismiss KARNAK', 'stand-down KARNAK']) expect(isRelayedVerb(a)).toBe(true)
  for (const a of ['list', 'poll', 'loops KARNAK', 'retune KARNAK haiku', 'dismiss-gate MI8', '']) expect(isRelayedVerb(a)).toBe(false)
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
  codes.set('c4', { args: 'call KARNAK line one\nline two', at: 1000 })
  expect(spendRelayCode(codes, 'c4', 'call KARNAK line one line  two', 2000)).toBe(true)
})

test('a decision sent to Flight holds its gate for the code lifetime, then frees it', () => {
  const at = Date.parse('2026-10-16T01:57:00Z')
  expect(awaitingFlight('2026-10-16T01:57:00.000Z', at + 5_000)).toBe(true)
  expect(awaitingFlight('2026-10-16T01:57:00.000Z', at + RELAY_TTL + 1)).toBe(false)
  expect(awaitingFlight(undefined, at)).toBe(false)
  expect(awaitingFlight('not a date', at)).toBe(false)
})

test('an app op holds only the item it decides while Flight runs it', () => {
  const base: PollItem = { id: 'MI1', at: '2026-10-16T00:30:12.000Z', from: 'MISSION-CONTROL', kind: 'gate', title: 'approve the plan', detail: 'blocked on you: approve the plan', state: 'go', agentId: 'a1' }
  const open: PollItem = { ...base, id: 'MI2', state: 'open' }
  const stuck: PollItem = { ...base, undelivered: 'Auto mode classifier gave no verdict' }
  const items = [open, stuck]
  expect(relayHold('go MI2', items)?.id).toBe('MI2')
  expect(relayHold('nogo mi2 not now', items)?.id).toBe('MI2')
  expect(relayHold('retry MI1', items)?.id).toBe('MI1')
  expect(relayHold('retry MI2', items)).toBeUndefined()
  expect(relayHold('go MI1', items)).toBeUndefined()
  expect(relayHold('call MISSION-CONTROL go', items)).toBeUndefined()
  expect(relayHold('retry MI9', items)).toBeUndefined()
})

// ---- Clones (MC-126) ----

// A Controller on the acme front: the owners its spokes name, and the folder its repositories live in.
const ACME: CloneScope = { owners: ['acme-labs', 'acme-org'], home: '/w/fronts/acme' }
const K = (cmd: string, scope = '/w/fronts/acme', clone: CloneScope | undefined = ACME) => shellRefusal('controller', cmd, [], scope, clone)
const AT_HOME = 'cd /w/fronts/acme && '
const WEB = 'git@github.com:acme-org/web.git'

test('a Controller clones its own front\'s repository into its front\'s folder, with the listed options', () => {
  expect(K(`${AT_HOME}git clone ${WEB}`)).toBeUndefined()
  expect(K(`${AT_HOME}git clone https://github.com/acme-org/web`)).toBeUndefined()
  expect(K(`${AT_HOME}git clone https://github.com/acme-org/web.git web`)).toBeUndefined()
  expect(K(`git -C /w/fronts/acme clone --depth 1 --single-branch --branch main --filter=blob:none --origin upstream -q --no-tags ${WEB}`)).toBeUndefined()
  expect(K(`${AT_HOME}git clone -b feat/x --no-single-branch --quiet ${WEB} /w/fronts/acme/web`)).toBeUndefined()
  // From inside one of the front's repositories, naming the folder beside it.
  expect(K(`cd /w/fronts/acme/api && git clone ${WEB} ../web`)).toBeUndefined()
  // GitHub matches an owner in any case; any owner the spokes name will do.
  expect(K(`${AT_HOME}git clone git@github.com:ACME-Org/web.git`)).toBeUndefined()
  expect(K(`${AT_HOME}git clone git@github.com:acme-labs/tools.git`)).toBeUndefined()
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

test('a clone comes only from a literal github.com URL, never another transport, host or form', () => {
  for (const src of [
    'file:///w/fronts/acme/web', '/w/fronts/acme/web', '../web', "'ext::sh -c x'", 'fd::3', 'ssh://git@github.com/acme-org/web.git',
    'git://github.com/acme-org/web.git', 'http://github.com/acme-org/web', 'git@personal-github:acme-org/web.git', 'git@gitlab.com:acme-org/web.git',
    'https://gitlab.com/acme-org/web', 'https://x@github.com/acme-org/web', 'https://github.com/acme-org/web/', 'git@github.com:acme-org/web',
    'https://github.com/acme-org/web/tree/main', 'github.com:acme-org/web.git', 'https://github.com:443/acme-org/web', 'git@github.com:acme-org/..git',
    'https://github.com/acme-org/..', 'https://github.com/acme-org/.', 'https://github.com/acme-org/.git', 'git@github.com:acme-org/.GIT.git',
    'git@github.com:acme-org/....git', 'git@github.com:acme-org/.git..git', 'https://github.com/acme-org/.git.',
  ]) {
    const text = tokenize(src).commands[0]?.words[0]?.text ?? src
    expect(`${src} -> ${K(`${AT_HOME}git clone ${src}`) ?? 'allowed'}`).toContain(`${text} is not a GitHub repository URL`)
  }
})

test('a clone of a repository another front owns is refused, naming the owners this front has', () => {
  expect(K(`${AT_HOME}git clone git@github.com:shelf-co/shelf.git`)).toContain('shelf-co is not an owner your front\'s spokes name (they name acme-labs, acme-org)')
  expect(K(`${AT_HOME}git clone https://github.com/acme-orgx/web`)).toContain('acme-orgx is not an owner')
  expect(K(`${AT_HOME}git clone ${WEB}`, '/w/fronts/acme', { owners: [], home: '/w/fronts/acme' })).toContain('(they name none)')
})

test('a clone lands only at <front folder>/<repository>, and a refusal names the command to use', () => {
  const USE = 'a clone lands in /w/fronts/acme/web, beside your front\'s repositories: `cd /w/fronts/acme && git clone git@github.com:acme-org/web.git`'
  expect(K(`${AT_HOME}git clone ${WEB} web2`)).toContain(`it would land in /w/fronts/acme/web2; ${USE}`)
  // Never into the front's folder itself, which would make the folder a repository.
  expect(K(`${AT_HOME}git clone ${WEB} .`)).toContain('it would land in /w/fronts/acme;')
  expect(K(`${AT_HOME}git clone ${WEB} /tmp/web`)).toContain('it would land in /tmp/web;')
  expect(K(`${AT_HOME}git clone ${WEB} api/web`)).toContain('it would land in /w/fronts/acme/api/web;')
  expect(K(`cd /w/fronts/acme/api && git clone ${WEB}`)).toContain('it would land in /w/fronts/acme/api/web;')
  expect(K(`${AT_HOME}git clone ${WEB} ../web`)).toContain('it would land in /w/fronts/web;')
  expect(K(`${AT_HOME}git clone ${WEB} ../../../../tmp/web`)).toContain('it would land in /tmp/web;')
  // Compared exactly: a path spelled in another case is refused, whatever the disk would do with it.
  expect(K(`${AT_HOME}git clone ${WEB} /W/Fronts/Acme/web`)).toContain('it would land in /W/Fronts/Acme/web;')
  expect(K(`${AT_HOME}git clone git@github.com:acme-org/Web.git web`)).toContain('a clone lands in /w/fronts/acme/Web,')
  expect(K(`${AT_HOME}git clone ${WEB} web extra`)).toContain('a clone takes the repository and at most one destination')
  expect(K(`${AT_HOME}git clone`)).toContain('name the repository to clone')
  expect(K(`${AT_HOME}git clone --depth 1`)).toContain('name the repository to clone')
})

test('a clone is pinned to the console\'s directory or its front\'s folder, and nothing else runs from that folder', () => {
  expect(K(`git clone ${WEB}`)).toContain('Pin the repo')
  expect(K(`cd /w/fronts && git clone ${WEB} acme/web`)).toContain('/w/fronts is outside your console\'s directory')
  expect(K(`cd /tmp && git clone ${WEB} /w/fronts/acme/web`)).toContain('/tmp is outside your console\'s directory')
  // A project console: its sibling's folder is not its own, and its front's folder takes only a clone.
  expect(K(`cd /w/fronts/acme/web && git clone ${WEB} .`, '/w/fronts/acme/api')).toContain('/w/fronts/acme/web is outside your console\'s directory')
  expect(K(`${AT_HOME}git status`, '/w/fronts/acme/api')).toContain('/w/fronts/acme is outside your console\'s directory')
  expect(K(`${AT_HOME}git -c core.sshCommand=x clone ${WEB}`, '/w/fronts/acme/api')).toContain('outside your console\'s directory')
  expect(K('cd /w/fronts/acme/web && git status', '/w/fronts/acme/api')).toContain('outside your console\'s directory')
  // With no directory to pin to, the clone rule asks for its front's folder itself.
  expect(shellRefusal('controller', `git clone ${WEB}`, [], undefined, ACME)).toContain('pin it to your front\'s folder by its full path: `cd /w/fronts/acme && git clone git@github.com:acme-org/web.git`')
})

test('a console with no clone owners or folder on record is refused a clone until it is stood down and staffed again', () => {
  expect(shellRefusal('controller', `${AT_HOME}git clone ${WEB}`, [], '/w/fronts/acme')).toContain('this console was staffed before clones were allowed: it can clone once it is stood down and staffed again')
  expect(C(`git clone ${WEB}`)).toContain('stood down and staffed again')
})

test('the clone rule reaches toolRefusal with the console\'s owners and folder', () => {
  const bash = (command: string, clone?: CloneScope) => toolRefusal('controller', 'Bash', { command }, [], '/w/fronts/acme', clone)
  expect(bash(`${AT_HOME}git clone --depth 1 ${WEB}`, ACME)).toBeUndefined()
  expect(bash(`${AT_HOME}git clone -u x ${WEB}`, ACME)).toContain('A Controller clones only its own front\'s repositories, into its front\'s folder: -u is not an allowed clone option')
  expect(bash(`${AT_HOME}git clone file:///w/fronts/acme/web`, ACME)).toContain('file:///w/fronts/acme/web is not a GitHub repository URL')
  expect(bash(`${AT_HOME}git clone ${WEB}`)).toContain('stood down and staffed again')
})

test('git takes no global option before a clone but -C', () => {
  expect(K(`git --bare -C /w/fronts/acme clone ${WEB}`)).toContain('git takes no option before clone but -C <dir> (here: --bare -C /w/fronts/acme)')
  expect(K(`${AT_HOME}git --no-pager clone ${WEB}`)).toContain('git takes no option before clone but -C <dir> (here: --no-pager)')
  expect(K(`${AT_HOME}git -p clone ${WEB}`)).toContain('git takes no option before clone')
})

test('a clone pinned by a relative cd is refused, since CDPATH could resolve that cd elsewhere', () => {
  expect(K(`cd /w/fronts && cd acme && git clone ${WEB}`)).toContain('pin it to your front\'s folder by its full path: `cd /w/fronts/acme && git clone git@github.com:acme-org/web.git`')
  expect(K(`export CDPATH=/tmp; cd /w/fronts && cd acme && git clone ${WEB}`)).toContain('nothing sets HOME, PATH, CDPATH')
  // A cd led by . or .. never consults CDPATH.
  expect(K(`cd /w/fronts/acme/api && cd .. && git clone ${WEB}`)).toBeUndefined()
  expect(K(`cd /w/fronts/acme && cd ./api && cd ../ && git clone ${WEB}`)).toBeUndefined()
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
  expect(C(`git -C ${sub('/tmp/r')} status`)).toContain('stands only as a commit, tag, note or merge message')
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
