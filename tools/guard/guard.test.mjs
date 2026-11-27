// The push-to-base guard: every command that pushes to a base branch asks, every other command runs.
// Run: node --test tools/guard/
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { pushConcern } from './push.mjs'
import { protectedFromSpoke } from './spokes.mjs'

// A session on a feature branch with no extra bases; M is the same session checked out on main.
const ctx = (branch = 'feat/x', extra = [], upstream) => ({ cwd: '/w/repo', protected: () => extra, currentBranch: () => branch, upstreamBranch: () => upstream })
const C = (cmd, ...a) => pushConcern(cmd, ctx(...a))
const M = cmd => pushConcern(cmd, ctx('main'))

test('an explicit push to a base branch asks, with the destination named', () => {
  for (const b of ['main', 'master', 'dev', 'develop', 'staging', 'production', 'release', 'release/2.1']) {
    assert.match(C(`git push origin ${b}`), new RegExp(`git push to ${b.replace('/', '\\/')},`), b)
  }
  assert.match(C('git push -u origin HEAD:refs/heads/Main'), /to main,/)
  assert.match(C('git push origin feat/x:main'), /to main,/)
  assert.match(C('git push origin +feat/x:main'), /to main,/)
  assert.match(C('git push origin --delete main'), /to main,/)
  assert.match(C('git push origin :main'), /to main,/)
  assert.match(C('git push origin hotfix', 'feat/x', ['hotfix']), /to hotfix,/, "the spoke's base_branch counts")
})

test('--all, --mirror and wildcard refspecs ask', () => {
  assert.match(C('git push --all origin'), /every branch/)
  assert.match(C('git push origin --mirror'), /every branch/)
  assert.match(C('git push origin --mir'), /every branch/)
  assert.match(C("git push origin 'refs/heads/*:refs/heads/*'"), /wildcard/)
})

test('a bare push asks only when the checked-out branch, or the one it tracks, is a base', () => {
  assert.match(M('git push'), /to main,/)
  assert.match(M('git push origin'), /to main,/)
  assert.match(M('git push -u origin'), /to main,/)
  assert.match(M('git push origin HEAD'), /to main,/)
  assert.equal(C('git push'), undefined)
  assert.equal(C('git push origin HEAD'), undefined)
  assert.match(C('git push', 'feat/x', [], 'main'), /to main,/, 'a feature branch tracking main')
  assert.match(pushConcern('git push', { ...ctx(), currentBranch: () => undefined }), /cannot tell/)
})

test('F1-F8: pushes hidden behind quoting, expansion, wrappers and comments ask', () => {
  const hidden = [
    'cat <<EOF\n$(git push origin main)\nEOF',
    "echo \"$(cat <<'EOF'\na\nEOF\ngit push origin main\ncat <<'EOF'\nb\nEOF\n)\"",
    'x=gi; ${x}t push origin main',
    '/usr/bin/gi[t] push origin main',
    "$(printf 'g%s' it) push origin main",
    'git push origin \\\nmain',
    "echo hi # '\ngit push origin main",
    "env -S 'git push origin main'",
  ]
  for (const cmd of hidden) assert.ok(C(cmd), JSON.stringify(cmd))
  // F7 was a force push to a feature branch: forced, but not to a base, so it is outside the rule.
  assert.equal(C('git push origin feature -\\\n-force'), undefined)
})

test('quoting, variables and substitutions cannot hide a push to a base branch', () => {
  for (const cmd of [
    "git pu''sh origin main", 'git push origin ma""in', 'B=main; git push origin $B', 'git push origin ${BRANCH}',
    'git push origin $(git rev-parse --abbrev-ref HEAD)', 'git push origin `echo main`', 'g=git; $g push origin main',
    "git push origin $'\\x6dain'", 'git push origin ma{i,}n', "git $'\\x70ush' origin main", 'git pu{s,}h origin main',
    "git rebase -x 'git push origin HEAD:main' HEAD~1", "git rebase --exec='git push origin HEAD:main' HEAD~1",
    'git -c alias.p=push p origin main', 'git config alias.p push && git p origin main',
  ]) assert.ok(C(cmd), JSON.stringify(cmd))
})

test('git run through another program asks when it pushes', () => {
  for (const cmd of ['echo origin main | xargs git push', 'bash -c "git push origin main"', 'eval "git push origin main"', "python3 -c \"import os; os.system('git push origin main')\"", "find . -exec git push origin main ';'"]) {
    assert.match(C(cmd), /cannot read word by word/, cmd)
  }
})

test('a push inside a long line is found in linear time', () => {
  const long = 'git status && '.repeat(20000) + 'git push origin main'
  const t0 = Date.now()
  assert.match(C(long), /to main,/)
  assert.ok(Date.now() - t0 < 2000)
})

test('every other command runs untouched, other git commands included', () => {
  for (const cmd of [
    'git stash', 'git stash list', 'git stash pop', 'git checkout main', 'git checkout -- .', 'git reset --hard', 'git reset --hard origin/main', 'git rebase main',
    'git clean -fd', 'git restore .', 'git switch main', 'git merge main', 'git commit -m "fix: git push handler"', 'git commit -am x', 'git add -A',
    'git push origin feat/x', 'git push -u origin HEAD', 'git push -u origin feat/x', 'git push --force origin feat/x', 'git push origin --delete old-branch',
    'git push origin v1.2.0:refs/tags/v1.2.0', 'git log --oneline main', 'git diff origin/main', 'git pull origin main', 'git fetch origin main',
    'gh pr create --title "git push origin main" --body x', 'gh pr merge 12 --squash', 'echo "git push origin main"', 'grep -r "git push" docs',
    'sh -c \'git stash\'', 'ls -la', 'node build.js', 'git log $(git rev-parse HEAD)~3..HEAD',
  ]) assert.equal(C(cmd), undefined, cmd)
})

test('protectedFromSpoke reads the first token and any slash-named branch, never a placeholder', () => {
  assert.deepEqual(protectedFromSpoke('main'), ['main'])
  assert.deepEqual(protectedFromSpoke('"dev (deploys via release/prod)"'), ['dev', 'release/prod'])
  assert.deepEqual(protectedFromSpoke('origin/<base>'), [])
  assert.deepEqual(protectedFromSpoke('N/A'), [])
})

// ---- the hook itself, against real git repositories ----
const GUARD = fileURLToPath(new URL('./guard.mjs', import.meta.url))
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'mc-guard-')))
after(() => rmSync(scratch, { recursive: true, force: true }))
const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const run = (cwd, command, env = {}, tool = 'Bash') => spawnSync(process.execPath, [GUARD], { input: JSON.stringify({ tool_name: tool, cwd, tool_input: { command } }), encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: scratch, ...env } })
const repo = (name, branch) => {
  const bare = join(scratch, `${name}.git`)
  const work = join(scratch, name)
  git(scratch, 'init', '-q', '--bare', bare)
  git(scratch, 'init', '-q', '-b', 'main', work)
  git(work, 'config', 'user.email', 't@t')
  git(work, 'config', 'user.name', 't')
  git(work, 'remote', 'add', 'origin', bare)
  writeFileSync(join(work, 'f'), 'x')
  git(work, 'add', 'f')
  git(work, 'commit', '-q', '-m', 'init')
  if (branch !== 'main') git(work, 'switch', '-q', '-c', branch)
  return work
}

test('the hook answers ask as JSON with a reason, exit 0, for a bare push on main in a real repo', () => {
  const work = repo('on-main', 'main')
  const r = run(work, 'git push')
  assert.equal(r.status, 0)
  const out = JSON.parse(r.stdout).hookSpecificOutput
  assert.equal(out.hookEventName, 'PreToolUse')
  assert.equal(out.permissionDecision, 'ask')
  assert.match(out.permissionDecisionReason, /git push to main/)
})

test('the hook is silent for a push from a feature branch, and for git stash, in a real repo', () => {
  const work = repo('on-feat', 'feat/x')
  for (const cmd of ['git push', 'git push -u origin HEAD', 'git stash list', 'git reset --hard', 'gh pr create']) {
    const r = run(work, cmd)
    assert.equal(r.status, 0, cmd)
    assert.equal(r.stdout, '', cmd)
  }
})

test('cd and git -C pin the repo whose branch decides a bare push', () => {
  const main = repo('pin-main', 'main')
  const feat = repo('pin-feat', 'feat/y')
  assert.match(run(feat, `git -C ${main} push`).stdout, /ask/)
  assert.match(run(feat, `cd ${main} && git push`).stdout, /ask/)
  assert.equal(run(main, `git -C ${feat} push`).stdout, '')
})

test("a spoke's base_branch protects a branch the built-in list does not", () => {
  const work = repo('spoked', 'feat/z')
  mkdirSync(join(scratch, '_command', 'portfolio', 'acme'), { recursive: true })
  writeFileSync(join(scratch, '_command', 'portfolio', 'acme', 'acme.md'), `---\nrepo: spoked\npath: spoked\nbase_branch: trunk\n---\n`)
  assert.match(run(work, 'git push origin trunk').stdout, /git push to trunk/)
  assert.equal(run(work, 'git push origin trunk2').stdout, '')
  assert.match(run(work, 'git push origin t', { MC_GUARD_BASES: 't' }).stdout, /git push to t,/, 'MC_GUARD_BASES adds a base')
})

test('origin\'s default branch counts as a base', () => {
  const work = repo('originhead', 'feat/q')
  git(work, 'push', '-q', 'origin', 'main')
  git(work, 'remote', 'set-head', 'origin', 'main')
  git(work, 'branch', '-m', 'feat/q', 'x')
  git(join(scratch, 'originhead.git'), 'symbolic-ref', 'HEAD', 'refs/heads/main')
  assert.match(run(work, 'git push origin main').stdout, /ask/)
})

test('a payload that is not Bash, or not JSON, exits 0 and prints nothing', () => {
  assert.equal(run(scratch, 'git push origin main', {}, 'Read').stdout, '')
  const r = spawnSync(process.execPath, [GUARD], { input: 'not json', encoding: 'utf8' })
  assert.equal(r.status, 0)
  assert.equal(r.stdout, '')
})

test('review findings: --repo, commands git runs for you, and a harmless -c', () => {
  assert.match(C('git push --repo=origin main'), /to main,/)
  assert.match(C('git push --repo origin HEAD:main'), /to main,/)
  assert.equal(C('git push --repo origin feat/x'), undefined)
  assert.ok(C('git submodule foreach "git push origin main"'))
  assert.ok(C('git bisect run sh -c "git push origin main"'))
  assert.ok(C('git filter-branch --msg-filter "git push origin main" HEAD'))
  assert.equal(C('git submodule update --init'), undefined)
  assert.equal(C('git -c user.name=x push origin feat/x'), undefined)
  assert.match(C('git -c user.name=x push origin main'), /to main,/)
  assert.ok(C('git -c core.pager="git push origin main" log'))
})

test('a git alias that runs a push asks like a push, found in the repo config', () => {
  const work = repo('aliased', 'main')
  git(work, 'config', 'alias.ship', 'push origin HEAD')
  assert.match(run(work, 'git ship').stdout, /ask/)
  git(work, 'switch', '-q', '-c', 'feat/a')
  assert.equal(run(work, 'git ship').stdout, '')
})
