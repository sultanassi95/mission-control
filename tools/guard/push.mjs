// The push-to-base rule: a command that pushes to a base or deploy branch is put to the founder as a
// permission prompt, and nothing else about git is touched. Pure: git state comes in through ctx.
// pushConcern(command, ctx) returns the reason to ask, or undefined to let the command run.
//   ctx.cwd                the session's directory (a `cd` or `git -C` on the line overrides it)
//   ctx.protected(dir)     extra protected branch names for the repo at dir (its spoke's base_branch, origin's default)
//   ctx.currentBranch(dir) the branch checked out at dir, or undefined when unknown
//   ctx.upstreamBranch(dir) the branch name the current branch tracks on its remote, or undefined
//   ctx.pushAliases(dir)   names of git aliases in dir's config that run a push
import { INTERPRETER, TEXT_ONLY, baseName, gitGlobals, headOf, pinnedDir, pushDestination, tokenize } from './shell.mjs'

export const ALWAYS_PROTECTED = ['main', 'master', 'dev', 'develop', 'test', 'staging', 'stage', 'production', 'prod', 'release']
const OPTS_WITH_VALUE = new Set(['-o', '--push-option', '--receive-pack', '--exec', '--repo'])
// git's own subcommands that are not pushes: a word outside this list may be a user alias for push.
const KNOWN = new Set(['add', 'am', 'apply', 'archive', 'bisect', 'blame', 'branch', 'bundle', 'cat-file', 'checkout', 'cherry', 'cherry-pick', 'clean', 'clone', 'commit', 'config', 'describe', 'diff', 'fetch', 'for-each-ref', 'format-patch', 'gc', 'grep', 'help', 'init', 'log', 'ls-files', 'ls-remote', 'ls-tree', 'merge', 'merge-base', 'mv', 'name-rev', 'notes', 'pull', 'range-diff', 'rebase', 'reflog', 'remote', 'reset', 'restore', 'rev-list', 'rev-parse', 'revert', 'rm', 'shortlog', 'show', 'show-ref', 'sparse-checkout', 'stash', 'status', 'submodule', 'switch', 'tag', 'update-ref', 'version', 'worktree'])

// Subcommands that run a command line they are given.
const EXEC_SUBS = new Set(['rebase', 'submodule', 'bisect', 'filter-branch', 'difftool', 'mergetool'])

const why = dst => `git push to ${dst}, a base or deploy branch. It runs only on your explicit yes.`

/** The reason a push's arguments (after the word push) go to a protected branch, or undefined. */
export function pushArgsConcern(args, isProtected, branch, upstream) {
  if (args.some(a => a.dynamic || a.glob)) return 'This push has arguments the guard cannot read (a variable, glob or substitution), so it cannot tell where it goes.'
  const positional = []
  let repoGiven = false
  for (let i = 0; i < args.length; i++) {
    const a = args[i].text
    const opt = a.split('=')[0]
    if (opt.startsWith('--') && opt.length >= 4) {
      for (const flag of ['--all', '--mirror']) if (flag.startsWith(opt)) return `git push ${flag} pushes every branch, base branches included. It runs only on your explicit yes.`
    }
    if (opt === '--repo') repoGiven = true
    if (OPTS_WITH_VALUE.has(opt) && !a.includes('=')) {
      i++
      continue
    }
    if (a.startsWith('-')) continue
    positional.push(a)
  }
  // With --repo the remote is named by the option, so every positional is a refspec.
  const refspecs = repoGiven ? positional : positional.slice(1)
  if (refspecs.length === 0) {
    const b = branch()
    if (b === undefined) return 'This push names no branch and the guard cannot tell which branch is checked out, so it cannot tell where it goes.'
    if (isProtected(b)) return why(b.toLowerCase())
    const up = upstream()
    if (up !== undefined && isProtected(up)) return why(up.toLowerCase())
    return undefined
  }
  for (const raw of refspecs) {
    const spec = raw.replace(/^\+/, '')
    if (spec.includes('*')) return 'A wildcard refspec can push any branch, base branches included. It runs only on your explicit yes.'
    let dst = spec.startsWith(':') ? pushDestination(spec.slice(1)) : pushDestination(spec)
    if (dst === '' || dst === 'head') {
      const b = branch()
      if (b === undefined) return 'This push names HEAD and the guard cannot tell which branch is checked out.'
      dst = b.toLowerCase()
    }
    if (dst.startsWith('refs/')) continue
    if (isProtected(dst)) return why(dst)
  }
  return undefined
}

const SUSPECT = /push|\$'|\\x|\{[^}]*,[^}]*\}/i

/** The reason to ask before running this Bash command, or undefined to let it run. */
export function pushConcern(command, ctx) {
  const parsed = tokenize(command)
  const mentionsGit = /\bgit\b/i.test(command)
  const suspect = SUSPECT.test(command)
  if ((parsed.opaque || parsed.unread.length) && (/\bpush\b/i.test(command) || (mentionsGit && suspect))) return 'This command is built from expansions the guard cannot read and it names git and push, so it cannot tell whether it pushes to a base branch.'
  const protectedFor = new Map()
  const guard = dir => {
    if (!protectedFor.has(dir)) protectedFor.set(dir, new Set([...ALWAYS_PROTECTED, ...(ctx.protected(dir) ?? [])].map(b => b.toLowerCase())))
    const set = protectedFor.get(dir)
    return b => set.has(String(b).toLowerCase()) || String(b).toLowerCase().startsWith('release/')
  }
  for (let k = 0; k < parsed.commands.length; k++) {
    const s = parsed.commands[k]
    const { head, rest: restWords } = headOf(s)
    let rest = restWords
    if (!head) continue
    const text = [...s.words, ...s.redirects].map(w => `${w.text} ${w.body ?? ''}`).join(' ')
    if (head.dynamic || head.glob || /\s/.test(head.text)) {
      if (suspect) return 'A command name built from a variable, glob or spaces, on a line naming push: the guard cannot tell whether it pushes to a base branch.'
      continue
    }
    const name = baseName(head.text)
    if (name !== 'git') {
      // git run through another program (bash -c, xargs, eval, find -exec, python os.system) is not read word by word.
      if (name !== 'gh' && !TEXT_ONLY.has(name) && /\bgit\b/i.test(`${text} ${parsed.bodies.join(' ')}`) && /push/i.test(`${text} ${parsed.bodies.join(' ')}`) && (INTERPRETER.test(name) || rest.some(w => /\bgit\b/i.test(w.text)) || parsed.bodies.length)) {
        return `git push is run through ${name}, which the guard cannot read word by word. It runs only on your explicit yes.`
      }
      continue
    }
    // A harmless `-c key=value` before the subcommand is skipped; an alias, a pager, an editor or a command is not.
    const kept = []
    for (let i = 0; i < rest.length; i++) {
      const w = rest[i]
      const v = rest[i + 1]
      if (w.text === '-c' && v && !v.dynamic && !v.glob && /^[A-Za-z][A-Za-z0-9.-]*=/.test(v.text) && !/^(alias\.|core\.|pager\.|sequence\.|credential\.|url\.|remote\.|branch\.)|!/i.test(v.text)) {
        i++
        continue
      }
      kept.push(w)
    }
    rest = kept
    const { at, refusal } = gitGlobals(rest)
    const sub = rest[at]
    if (refusal) {
      if (suspect || /alias/i.test(command)) return `${refusal.split('.')[0]}: the guard cannot tell whether this line pushes to a base branch.`
      continue
    }
    if (!sub) continue
    // A word that is itself a command line (git rebase -x 'git push origin HEAD:main') runs it.
    if ((EXEC_SUBS.has(sub.text.toLowerCase()) || rest.some(w => /^--exec/.test(w.text))) && rest.some(w => /\bgit\b.*\bpush\b/i.test(w.text))) return 'A git option carries a command line that pushes (git rebase -x and the like). It runs only on your explicit yes.'
    if (sub.dynamic || sub.glob) return 'The git subcommand is built from a variable, glob or brace, so the guard cannot tell whether it pushes.'
    const args = rest.slice(at + 1)
    const isPush = sub.text.toLowerCase() === 'push' || (ctx.pushAliases?.(pinnedDir(parsed.commands, k, ctx.cwd) ?? ctx.cwd) ?? []).includes(sub.text)
    // Resolved only for a push or an unknown subcommand: the pin walk is linear in the line, and git status 20000 times must not pay it.
    if (!isPush && KNOWN.has(sub.text.toLowerCase())) continue
    const dir = pinnedDir(parsed.commands, k, ctx.cwd) ?? ctx.cwd
    const isProtected = guard(dir)
    if (isPush) {
      const reason = pushArgsConcern(args, isProtected, () => ctx.currentBranch(dir), () => ctx.upstreamBranch(dir))
      if (reason) return reason
    } else if (!KNOWN.has(sub.text.toLowerCase()) && args.some(a => isProtected(pushDestination(a.text.replace(/^\+/, ''))))) {
      return `git ${sub.text} is not a git command the guard knows (a push alias?) and it names a base branch. It runs only on your explicit yes.`
    }
  }
  return undefined
}
