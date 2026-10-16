/*
 * The fleet guard. Threat model: a Controller or one of its back-room agents
 * that is mistaken, or steered by text it read, must not write to a remote
 * base or deploy branch, merge, stash, or rewrite a Flight-owned file.
 *
 * git and gh are allowed by allowlist only, as plain commands the tokenizer
 * can read in full; anything it cannot read is refused. Flight-file
 * protection is best effort. This is not a sandbox: a script file written and
 * then executed is outside what a text guard can see, which is why base
 * branches also need server-side branch protection.
 *
 * It also keeps fleet agents away from the app's home (~/.mission-control:
 * the app token and the profile registry, names fixed in tools/app/server.mjs)
 * and from the app's ports. A path spelled so the tokenizer cannot see it (a
 * glob, a value assembled by a pipeline or an interpreter, a copy of the home
 * folder read later) is outside it; only an OS-level boundary closes that.
 */

/** Branches no Controller pushes to, whatever its spoke says. */
export const ALWAYS_PROTECTED = ['main', 'master', 'dev', 'develop', 'test', 'staging', 'stage', 'production', 'prod', 'release']

/** Portfolio files only Flight writes (plus everything under _command/fleet/: the audit log and the app's state). */
export const FLIGHT_ONLY_FILES = ['_command/trackers/fronts.md', '_command/daily/today.md']
// The app's home (~/.mission-control): its token drives Flight through the app, and its registry
// names every profile's server. Matched in any case (the disk is case-insensitive), after any
// non-name character (a brace, a ; or <), and by the token's own file name; checked on the raw
// text and again on the shell's resolved words, so quoting inside the name does not hide it. The
// leading dot keeps the workspace folder named mission-control readable. The cost, accepted: a
// Controller on the mission-control front cannot edit the few lines that name this path.
const APP_HOME = /(?<![A-Za-z0-9_-])\.mission-control(\/|\b|$)|(?<![A-Za-z0-9_-])app-token\b/i
const APP_HOME_REFUSAL = 'The app\'s token and profile registry (~/.mission-control) are the founder\'s: fleet agents do not read them.'

export type Role = 'controller' | 'back room'

const GIT_READS = ['status', 'log', 'diff', 'show', 'rev-parse', 'ls-files', 'ls-remote', 'blame', 'describe', 'shortlog', 'grep', 'cat-file', 'show-ref', 'for-each-ref', 'merge-base', 'rev-list', 'name-rev', 'reflog', 'help', 'version']
const GIT_LOCAL_WRITES = ['add', 'commit', 'fetch', 'branch', 'tag', 'notes', 'mv', 'rm', 'apply', 'am', 'format-patch', 'worktree']
const GIT_ALLOWED: Record<Role, Set<string>> = {
  controller: new Set([...GIT_READS, ...GIT_LOCAL_WRITES, 'switch', 'checkout', 'restore', 'reset', 'merge', 'rebase', 'cherry-pick', 'revert', 'pull', 'remote', 'config', 'push']),
  'back room': new Set([...GIT_READS, 'add', 'commit']),
}

const GH_ALLOWED: Record<string, Set<string> | 'any'> = {
  pr: new Set(['create', 'view', 'list', 'checks', 'diff', 'status', 'comment']),
  issue: 'any',
  run: new Set(['list', 'view', 'watch']),
  repo: new Set(['view']),
  auth: new Set(['status']),
  search: 'any',
}

const SHELL_KEYWORDS = new Set(['if', 'then', 'else', 'elif', 'fi', 'do', 'done', 'while', 'until', 'for', 'case', 'esac', 'in', 'function', 'time', '!', '{', '}', '[[', ']]'])
const WRAPPERS = new Set(['env', 'command', 'builtin', 'nohup', 'nice', 'sudo', 'caffeinate', 'timeout', 'stdbuf'])
/** Commands that run code they read from an argument, stdin or a heredoc. */
const INTERPRETER = /^(sh|bash|zsh|dash|ksh|fish|csh|tcsh|python[0-9.]*|perl|ruby|node|deno|bun|php|lua|osascript|xargs|eval|source|\.|exec|awk|gawk)$/

/** Commands that only print or search text: an argument naming git there is data, not a command. */
const TEXT_ONLY = new Set(['echo', 'printf', 'grep', 'rg', 'cat', 'head', 'tail', 'less', 'more', 'wc', 'ls', 'jq', 'diff'])
const READERS = new Set(['cat', 'grep', 'rg', 'head', 'tail', 'less', 'more', 'wc', 'ls', 'diff', 'stat', 'file', 'sed', 'awk', 'git', 'sort', 'uniq', 'cut', 'tr', 'nl', 'jq'])
/** Shells and interpreters that read a program from stdin or a heredoc when given no script file. */
const READS_STDIN = /^(sh|bash|zsh|dash|ksh|fish|csh|tcsh|python[0-9.]*|perl|ruby|node|deno|bun|php|lua|osascript)$/

export type Word = { text: string; dynamic: boolean; glob: boolean }
export type Simple = { words: Word[]; redirects: Word[]; sep: string }
export type Parsed = { commands: Simple[]; opaque: boolean; bodies: string[] }

/**
 * Replaces each `$(cat <<'EOF' ... EOF)` (quoted delimiter only) with a literal
 * word, ending at the FIRST terminator line and only when `)` follows it.
 */
function literalCommitHeredocs(input: string): string {
  // Nothing may follow the delimiter on its line: text there runs as a command (MC-116).
  const open = /\$\(\s*cat\s+<<-?\s*(['"])(\w+)\1[ \t]*\n/g
  let out = ''
  let from = 0
  for (let m = open.exec(input); m; m = open.exec(input)) {
    const bodyStart = m.index + m[0].length
    const term = new RegExp(`^[ \\t]*${m[2]}[ \\t]*$`, 'm').exec(input.slice(bodyStart))
    if (!term) break
    const after = bodyStart + term.index + term[0].length
    const close = /^\s*\)/.exec(input.slice(after))
    if (!close) continue
    out += input.slice(from, m.index) + 'HEREDOC'
    from = after + close[0].length
    open.lastIndex = from
  }
  return out + input.slice(from)
}

/**
 * A bash-subset tokenizer: quotes and escapes resolved, `$var`/`${}` and globs
 * marked, `$(...)`, backticks and process substitution marked opaque, heredoc
 * bodies skipped (a `$(cat <<'EOF' ... EOF)` commit message is literal text).
 */
export function tokenize(input: string): Parsed {
  const text = literalCommitHeredocs(input)
  const commands: Simple[] = []
  let opaque = false
  let words: Word[] = []
  let redirects: Word[] = []
  let cur: Word | undefined
  let redirecting = false
  const heredocs: { delim: string; quoted: boolean }[] = []
  const bodies: string[] = []
  const end = () => {
    if (cur) (redirecting ? redirects : words).push(cur)
    if (cur) redirecting = false
    cur = undefined
  }
  const flush = (sep = ';') => {
    end()
    if (words.length || redirects.length) commands.push({ words, redirects, sep })
    words = []
    redirects = []
    redirecting = false
  }
  const ch = (i: number) => text[i] ?? ''
  for (let i = 0; i < text.length; i++) {
    const c = ch(i)
    if (c === '\n') {
      flush('\n')
      while (heredocs.length) {
        const h = heredocs.shift() ?? { delim: '', quoted: true }
        const rest = text.slice(i + 1)
        const m = new RegExp(`^[ \\t]*${h.delim}[ \\t]*$`, 'm').exec(rest)
        const body = m ? rest.slice(0, m.index) : rest
        bodies.push(body)
        // An unquoted heredoc expands $(...), backticks and variables inside its body.
        if (!h.quoted && /\$|`/.test(body)) opaque = true
        if (!m) {
          i = text.length
          break
        }
        const lineEnd = text.indexOf('\n', i + 1 + m.index)
        i = lineEnd < 0 ? text.length : lineEnd
      }
      continue
    }
    if (c === ' ' || c === '\t') {
      end()
      continue
    }
    // Arithmetic ((...)) and $[...] read << as a shift, not a heredoc: the guard cannot follow it.
    if (c === '(' && ch(i + 1) === '(') opaque = true
    if (c === '$' && ch(i + 1) === '[') opaque = true
    if (c === ';' || c === '|' || c === '&' || c === '(' || c === ')') {
      const two = (c === '|' || c === '&') && ch(i + 1) === c
      flush(two ? c + c : c)
      if (two) i++
      continue
    }
    if ((c === '<' || c === '>') && ch(i + 1) === '(') {
      opaque = true
      i++
      continue
    }
    if (c === '<' && ch(i + 1) === '<') {
      // Inside ${...} a << is pattern text, not a heredoc.
      if (cur && cur.text.lastIndexOf('${') > cur.text.lastIndexOf('}')) opaque = true
      end()
      let j = i + 2
      if (ch(j) === '<') {
        i = j
        continue
      }
      if (ch(j) === '-') j++
      while (ch(j) === ' ') j++
      const m = /^(['"]?)(\w+)\1/.exec(text.slice(j))
      if (m) {
        heredocs.push({ delim: m[2] ?? '', quoted: (m[1] ?? '') !== '' })
        i = j + m[0].length - 1
      } else i = j - 1
      continue
    }
    if (c === '>' || c === '<') {
      end()
      if (ch(i + 1) === '>' || ch(i + 1) === '&' || ch(i + 1) === '|') i++
      redirecting = c === '>'
      continue
    }
    if (c === '\\' && ch(i + 1) === '\n') {
      i++
      continue
    }
    if (c === '#' && !cur) {
      const nl = text.indexOf('\n', i)
      i = (nl < 0 ? text.length : nl) - 1
      continue
    }
    cur ??= { text: '', dynamic: false, glob: false }
    if (c === '\\') {
      cur.text += ch(++i)
      continue
    }
    if (c === "'") {
      const close = text.indexOf("'", i + 1)
      cur.text += text.slice(i + 1, close < 0 ? text.length : close)
      i = close < 0 ? text.length : close
      continue
    }
    if (c === '"') {
      let j = i + 1
      for (; j < text.length && ch(j) !== '"'; j++) {
        const d = ch(j)
        if (d === '\\' && ch(j + 1) === '\n') j++
        else if (d === '\\') cur.text += ch(++j)
        else if (d === '`' || (d === '$' && ch(j + 1) === '(')) {
          opaque = true
          cur.dynamic = true
        } else if (d === '$' && /[A-Za-z_{@*#?$!0-9]/.test(ch(j + 1))) {
          cur.dynamic = true
          cur.text += d
        } else cur.text += d
      }
      i = j
      continue
    }
    if (c === '`') {
      opaque = true
      cur.dynamic = true
      continue
    }
    if (c === '$') {
      if (ch(i + 1) === "'" || ch(i + 1) === '"') cur.dynamic = true
      // $'...' decodes escapes (\x2e is a dot): with any backslash inside, the word is unreadable here.
      if (ch(i + 1) === "'") {
        const close = text.indexOf("'", i + 2)
        if (text.slice(i + 2, close < 0 ? text.length : close).includes('\\')) opaque = true
      }
      if (ch(i + 1) === '(') {
        opaque = true
        cur.dynamic = true
        i++
        continue
      }
      if (/[A-Za-z_{@*#?$!0-9]/.test(ch(i + 1))) cur.dynamic = true
    }
    if (c === '*' || c === '?' || c === '[' || c === '{' || c === '~') cur.glob = true
    cur.text += c
  }
  flush()
  return { commands, opaque, bodies }
}

/** The command a simple command runs: keywords, assignments and wrappers skipped. */
export function headOf(s: Simple): { head?: Word; rest: Word[] } {
  const w = s.words
  let i = 0
  while (i < w.length) {
    const t = w[i]?.text ?? ''
    if (SHELL_KEYWORDS.has(t) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(t)) i++
    else if (WRAPPERS.has(t)) {
      i++
      while (i < w.length && /^(-|[A-Za-z_][A-Za-z0-9_]*=|\d+[smhd]?$)/.test(w[i]?.text ?? '')) i++
    } else break
  }
  return { head: w[i], rest: w.slice(i + 1) }
}

// Lowercased: the disk is case-insensitive, so GIT and Gh run git and gh (MC-116).
const baseName = (t: string) => t.slice(t.lastIndexOf('/') + 1).toLowerCase()

/** A push destination as compared: refs/heads/ or heads/ stripped, lower case. */
export function pushDestination(spec: string): string {
  const dst = spec.includes(':') ? spec.slice(spec.indexOf(':') + 1) : spec
  return dst.replace(/^refs\/heads\//i, '').replace(/^heads\//i, '').toLowerCase()
}

const PUSH_OPTS_WITH_VALUE = new Set(['-o', '--push-option', '--receive-pack', '--exec'])

/** Why a Controller may not run this push, or undefined when it may. */
export function pushRefusal(args: Word[], protectedBranches: string[]): string | undefined {
  if (args.some(a => a.dynamic || a.glob)) return 'push arguments must be literal (no variables, globs or substitutions)'
  const positional: string[] = []
  const DANGER = ['--force', '--force-with-lease', '--force-if-includes', '--delete', '--mirror', '--all', '--prune', '--tags', '--follow-tags', '--repo', '--receive-pack', '--exec']
  for (let i = 0; i < args.length; i++) {
    const a = args[i]?.text ?? ''
    const opt = a.split('=')[0] ?? ''
    if (opt.startsWith('--') && opt.length >= 4) {
      const hit = DANGER.find(d => d.startsWith(opt))
      if (hit) return hit.startsWith('--force') ? 'force pushes are not allowed' : `${hit} is not allowed`
    }
    if (a === '--force' || a.startsWith('--force-with-lease') || a === '--force-if-includes') return 'force pushes are not allowed'
    if (/^-[A-Za-z]+$/.test(a) && a.includes('f')) return 'force pushes are not allowed'
    if (/^-[A-Za-z]+$/.test(a) && a.includes('d')) return 'deleting a remote branch is not allowed'
    if (['--delete', '--mirror', '--all', '--prune', '--tags', '--follow-tags'].includes(a) || a.startsWith('--repo')) return `${a} is not allowed`
    if (PUSH_OPTS_WITH_VALUE.has(a)) {
      i++
      continue
    }
    if (a.startsWith('-')) continue
    positional.push(a)
  }
  const refspecs = positional.slice(1)
  if (refspecs.length === 0) return 'name the branch: `git push -u origin <your-branch>`, never a bare push'
  const guarded = new Set([...ALWAYS_PROTECTED, ...protectedBranches].map(b => b.toLowerCase()))
  for (const spec of refspecs) {
    if (spec.startsWith('+')) return 'force pushes are not allowed'
    if (spec.startsWith(':')) return 'deleting a remote branch is not allowed'
    if (spec.includes('*')) return 'wildcard refspecs are not allowed'
    const dst = pushDestination(spec)
    if (dst === '' || dst === 'head') return 'name the destination branch explicitly'
    if (dst.startsWith('refs/')) return 'push only to a branch name'
    if (guarded.has(dst) || dst.startsWith('release/')) return `${dst} is a base or deploy branch`
  }
  return undefined
}

function gitRefusal(role: Role, rest: Word[], protectedBranches: string[]): string | undefined {
  let i = 0
  for (; i < rest.length; i++) {
    const t = rest[i]?.text ?? ''
    if (t === '-c' || t.startsWith('--config-env') || t.startsWith('--exec-path')) return 'git -c, --config-env and --exec-path are not allowed: they can alias or redirect a command.'
    if (t === '-C' || t === '--git-dir' || t === '--work-tree' || t === '--namespace') i++
    else if (!t.startsWith('-')) break
  }
  const sub = rest[i]
  if (!sub) return undefined
  if (sub.dynamic || sub.glob) return 'The git subcommand must be literal.'
  const name = sub.text
  if (!GIT_ALLOWED[role].has(name)) {
    if (name === 'stash') return role === 'controller' ? 'A Controller never stashes: the tree may hold someone else\'s work. Commit to your branch instead.' : 'A back-room agent never runs git stash; report to your Controller instead.'
    return role === 'controller' ? `git ${name} is not on a Controller's allowlist.` : `A back-room agent never runs git ${name}; report to your Controller instead.`
  }
  const args = rest.slice(i + 1)
  const RUNNERS = ['--exec', '--upload-pack', '--receive-pack', '--ext-diff', '--textconv', '--output', '--open-files-in-pager']
  const runs = args.find(a => {
    const opt = a.text.split('=')[0] ?? ''
    if (name === 'rebase' && (opt === '-x' || /^-[A-Za-z]*x/.test(opt) && !opt.startsWith('--'))) return true
    if (name === 'grep' && /^-[A-Za-z]*O/.test(opt) && !opt.startsWith('--')) return true
    return opt.startsWith('--') && opt.length >= 4 && RUNNERS.some(r => r.startsWith(opt))
  })
  if (runs) return `git ${name} ${runs.text} can run a command or write a file; it is not allowed here.`
  if (name === 'reflog' && args.some(a => ['expire', 'delete'].includes(a.text))) return 'git reflog is read-only here.'
  if (name === 'push') {
    const why = pushRefusal(args, protectedBranches)
    return why ? `A Controller may push only its own feature branch: ${why}.` : undefined
  }
  if (name === 'config' && !args.some(a => ['--get', '--get-all', '--list', '-l', '--get-regexp'].includes(a.text))) return 'git config is read-only here (--get or --list).'
  if (name === 'remote' && args.some(a => ['add', 'set-url', 'rename', 'remove', 'rm', 'set-head', 'prune'].includes(a.text))) return 'git remote is read-only here.'
  return undefined
}

function ghRefusal(rest: Word[]): string | undefined {
  const pos: Word[] = []
  for (let i = 0; i < rest.length; i++) {
    const w = rest[i]
    const t = w?.text ?? ''
    if (t === '-R' || t === '--repo') i++
    else if (w && !t.startsWith('-')) pos.push(w)
  }
  const [group, verb] = pos
  if (!group || group.dynamic || verb?.dynamic) return 'The gh subcommand must be literal.'
  if (group.text === 'api') {
    if (pos.some(p => p.text === 'graphql')) return 'gh api graphql is not allowed here (it can merge and push).'
    const m = rest.findIndex(w => w.text === '-X' || w.text === '--method')
    if (m >= 0 && (rest[m + 1]?.text ?? '').toUpperCase() !== 'GET') return 'gh api is read-only here (GET only).'
    if (rest.some(w => /^(-[fF]|--field|--raw-field|--input)/.test(w.text) || (/^(-X.|--method=)/.test(w.text) && !/^(-XGET|--method=GET)$/i.test(w.text)))) return 'gh api is read-only here (GET only, no fields).'
    return undefined
  }
  const allowed = GH_ALLOWED[group.text]
  if (!allowed) return `gh ${group.text} is not allowed here.`
  if (allowed !== 'any' && (!verb || !allowed.has(verb.text))) return verb?.text === 'merge' ? 'Merging is the founder\'s, never a Controller\'s.' : `gh ${group.text} ${verb?.text ?? ''} is not allowed here.`
  return undefined
}

/** Lower case, `\` to `/`, `//` and `/./` folded, `x/../` collapsed. */
export function normalisePath(p: string): string {
  let s = p.toLowerCase().replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/\.\//g, '/')
  for (let k = 0; k < 16 && /\/[^/]+\/\.\.\//.test(s); k++) s = s.replace(/\/[^/.][^/]*\/\.\.\//, '/')
  return s
}

export function mentionsFlightFile(text: string): boolean {
  const n = normalisePath(text)
  return FLIGHT_ONLY_FILES.some(f => n.includes(f)) || /_command\/(daily|trackers|fleet)\b/.test(n)
}

/** True for a file path only Flight writes. */
export function isFlightOnly(path: string): boolean {
  const n = normalisePath(path)
  return FLIGHT_ONLY_FILES.some(f => n === f || n.endsWith(`/${f}`)) || /(^|\/)_command\/fleet\//.test(n)
}

/** Folds `a/./b`, `a//b` and `a/x/../b`, keeping case (paths on disk; normalisePath lower-cases for matching). */
function foldPath(p: string): string {
  const out: string[] = []
  for (const part of p.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return `/${out.join('/')}`
}

/**
 * The repo directory a git or gh call is pinned to: `git -C <dir>`, else the
 * last literal `cd` before it on the line; undefined when nothing pins it.
 * A fleet agent's shell starts wherever Flight's does, so an unpinned git call
 * can land in the wrong repo.
 */
export function pinnedDir(commands: Simple[], index: number): string | undefined {
  const target = commands[index]
  if (!target) return undefined
  const { head, rest } = headOf(target)
  if (head && baseName(head.text) === 'git') {
    if (rest.filter(w => w.text === '-C').length > 1) return undefined
    if (rest.some(w => /^--(git-dir|work-tree)/.test(w.text))) return undefined
    const c = rest.findIndex(w => w.text === '-C')
    const dir = c >= 0 ? rest[c + 1] : undefined
    if (dir) return dir.dynamic || dir.glob || !dir.text.startsWith('/') ? undefined : foldPath(dir.text)
  }
  // Only a run of `cd <dir> &&` directly before the call pins it: anything else may not have run, or ran in a subshell.
  const chain: Word[] = []
  for (let k = index - 1; k >= 0; k--) {
    const prev = commands[k] as Simple
    const { head: h, rest: r } = headOf(prev)
    if (prev.sep !== '&&' || !h || h.text !== 'cd' || r.length !== 1) break
    chain.unshift(r[0] as Word)
  }
  let dir: string | undefined
  for (const to of chain) {
    if (to.dynamic || to.glob || to.text.startsWith('-')) return undefined
    if (to.text.startsWith('/')) dir = foldPath(to.text)
    else if (dir) dir = foldPath(`${dir}/${to.text}`)
    else return undefined
  }
  return dir
}

/** The refusal for a shell command run by a fleet role, if any. */
export function shellRefusal(role: Role, command: string, protectedBranches: string[], scopeDir?: string): string | undefined {
  if (APP_HOME.test(command)) return APP_HOME_REFUSAL
  if (/_command\/fleet\b/.test(normalisePath(command)) || /\.claude[^/\s]*\/projects\b/.test(command)) return 'The fleet folder and Claude session transcripts are Flight\'s: fleet agents do not read them.'
  const parsed = tokenize(command)
  if (parsed.commands.some(s => [...s.words, ...s.redirects].some(w => APP_HOME.test(w.text)))) return APP_HOME_REFUSAL
  // A heredoc read by an interpreter is a program: its words are checked like the command line's.
  if (parsed.bodies.length && parsed.commands.some(s => INTERPRETER.test(baseName(headOf(s).head?.text ?? '')))) {
    for (const body of parsed.bodies) {
      if (APP_HOME.test(body) || tokenize(body).commands.some(s => [...s.words, ...s.redirects].some(w => APP_HOME.test(w.text)))) return APP_HOME_REFUSAL
    }
  }
  if (parsed.opaque) return 'Commands run plainly here: no $(...), backticks, <(...) or unquoted heredocs that expand (a commit message may use $(cat <<\'EOF\' ... EOF)).'
  const rawMentionsGit = /\b(git|gh)\b/i.test(command)
  const scanned: string[] = []
  for (const s of parsed.commands) {
    const { head, rest } = headOf(s)
    const isCommit = baseName(head?.text ?? '') === 'git' && rest.some(w => w.text === 'commit')
    if (!isCommit) scanned.push(...s.words.map(w => w.text), ...s.redirects.map(w => w.text))
    else scanned.push(...s.redirects.map(w => w.text))
  }
  if (mentionsFlightFile(scanned.join(' '))) {
    const pureRead = parsed.commands.every(s => {
      const { head, rest } = headOf(s)
      const name = head ? baseName(head.text) : ''
      if (s.redirects.length || !READERS.has(name) || head?.dynamic || head?.glob) return false
      if (name === 'git') return rest.some(w => ['log', 'show', 'diff', 'blame', 'status'].includes(w.text)) && !rest.some(w => w.text.startsWith('--output'))
      if (name === 'sed') return !rest.some(w => /^(-[a-z]*i|--in-place)/.test(w.text))
      if (name === 'awk') return !rest.some(w => w.text === 'inplace' || /^-i/.test(w.text))
      return true
    })
    if (!pureRead) return 'fronts.md and today.md are Flight\'s to write.'
  }
  for (let k = 0; k < parsed.commands.length; k++) {
    const s = parsed.commands[k] as Simple
    const { head, rest } = headOf(s)
    if (!head) continue
    if (head.dynamic || head.glob) return 'Commands run plainly here: never a command name built from a variable, glob or brace.'
    if (/\s/.test(head.text)) return 'A command name with spaces in it (env -S and the like) is not allowed here.'
    const name = baseName(head.text)
    const argsNameGit = rest.some(w => /\b(git|gh)\b/i.test(w.text))
    if (argsNameGit && !['git', 'gh'].includes(name) && !TEXT_ONLY.has(name)) return `git and gh run only at the head of a command, not through ${name}.`
    if (rawMentionsGit && (name === 'xargs' || name === 'eval' || name === 'source' || name === '.' || name === 'exec') && rest.some(w => INTERPRETER.test(baseName(w.text)) || /\b(git|gh)\b/i.test(w.text))) {
      return `git and gh run only as plain commands, never through ${name}.`
    }
    // Fail closed: on a line that names git or gh, no interpreter runs at all (a pipe, heredoc, -c, /dev/stdin or option can feed it a program).
    if (['export', 'declare', 'typeset', 'set', 'setenv'].includes(name) && rest.some(w => /^(GH_|GIT_|GITHUB_)/.test(w.text))) return 'Setting GH_*, GIT_* or GITHUB_* variables is not allowed here: they can redirect git and gh in later commands.'
    if (/(127\.0\.0\.1|localhost|0\.0\.0\.0|\[::1\]):47(7[7-9]|8\d|9[0-7])\b/.test(command)) return 'The Mission Control App is the founder\'s: fleet agents never reach it.'
    if ((name === 'ps' && rest.some(w => /^[a-zA-Z]*e[a-zA-Z]*$/.test(w.text) || /^-[A-Za-z]*E/.test(w.text))) || /\/proc\/[^/\s]+\/environ/.test(command)) return 'Reading other processes\' environments is not allowed here.'
    if (name === 'claude') return 'A fleet agent never starts another Claude session: it would run without the fleet guards or budget. Use your back room (the Agent tool) instead.'
    if (rawMentionsGit && READS_STDIN.test(name)) return `git and gh run only as plain commands; ${name} on the same line is not allowed. Run it as a separate command.`
    if ((name === 'git' || name === 'gh') && s.words.slice(0, s.words.indexOf(head)).some(w => /^[A-Za-z_][A-Za-z0-9_]*=/.test(w.text) || w.text === 'env')) {
      return `${name} runs here with no environment prefix (VAR=... or env): variables like GIT_SSH_COMMAND or GIT_CONFIG_PARAMETERS can redirect it.`
    }
    if (scopeDir && (name === 'git' || name === 'gh')) {
      if (name === 'gh' && rest.some(w => /^-R/.test(w.text) || /^--repo(=|$)/.test(w.text) || (/^-[A-Za-z]+$/.test(w.text) && w.text.includes('R')))) return 'gh -R/--repo is not allowed here: pin the repo with `cd <your repo> && gh ...`.'
      const dir = pinnedDir(parsed.commands, k)
      const scope = foldPath(scopeDir)
      if (!dir) return `Pin the repo on every ${name} call: \`cd ${scope} && ${name} ...\`${name === 'git' ? ` or \`git -C ${scope} ...\`` : ''}. Your shell may start in another repo.`
      if (dir !== scope && !dir.startsWith(`${scope}/`)) return `${dir} is outside your console's directory (${scope}).`
    }
    if (name === 'git') {
      const why = gitRefusal(role, rest, protectedBranches)
      if (why) return why
    } else if (name === 'gh') {
      const why = ghRefusal(rest)
      if (why) return why
    }
  }
  return undefined
}

/** MCP tools that run shell commands are refused for fleet roles: the guard reads Bash only. */
export function isShellLikeTool(tool: string): boolean {
  return tool.startsWith('mcp__') && /(shell|exec|terminal|run_?command|run_?code|bash)/i.test(tool)
}

/** The refusal for any tool call by a fleet role, if any. */
export function toolRefusal(role: Role, tool: string, input: unknown, protectedBranches: string[], scopeDir?: string): string | undefined {
  if (tool === 'Workflow') return 'Workflows are Flight\'s to run; a Controller dispatches its back room with the Agent tool.'
  if (isShellLikeTool(tool)) return `${tool} runs shell commands the fleet guard cannot read; use Bash.`
  const args = (input ?? {}) as Record<string, unknown>
  if (typeof args.command === 'string') {
    const why = shellRefusal(role, args.command, protectedBranches, scopeDir)
    if (why) return why
  }
  const flat = JSON.stringify(input ?? {})
  if (APP_HOME.test(flat)) return APP_HOME_REFUSAL
  if (tool !== 'Bash' && (/_command\/fleet\b/.test(normalisePath(flat)) || /\.claude[^/\\"]*\/projects\b/.test(flat))) return 'The fleet folder and Claude session transcripts are Flight\'s: fleet agents do not read them.'
  if (!['Read', 'Grep', 'Glob', 'Bash'].includes(tool) && mentionsFlightFile(flat)) return 'fronts.md and today.md are Flight\'s to write.'
  return undefined
}

/**
 * The branches a spoke's base_branch line protects: its first token, plus any
 * branch-shaped token with a slash it names (a deploy-triggering base), never
 * a placeholder like origin/<base>.
 */
export function protectedFromSpoke(baseBranchLine: string | undefined): string[] {
  if (!baseBranchLine) return []
  const value = baseBranchLine.replace(/^["']|["']$/g, '').trim()
  const out = new Set<string>()
  const first = value.split(/[\s,;]+/)[0]
  if (first && /^[A-Za-z0-9._/-]+$/.test(first) && first !== 'N/A') out.add(first)
  for (const m of value.matchAll(/[A-Za-z0-9._-]+\/[A-Za-z0-9._/-]+/g)) {
    const t = m[0]
    if (t !== 'N/A' && !t.startsWith('origin/') && !t.includes('<')) out.add(t)
  }
  return [...out]
}

/** A console as the self-approval check reads it. */
export type FleetSeat = { callSign: string; agentId: string; name: string; status: string }

/**
 * Whether one of the fleet's own sends or spawns may skip the mode's decider, and for which
 * console. Only the founder's console actions raise these, and the auto mode classifier
 * cannot judge a call a plugin raised. Anything else returns undefined and is decided as usual.
 */
export function fleetSelfApproval(tool: string, input: unknown, seats: FleetSeat[]): string | undefined {
  const i = (input ?? {}) as Record<string, unknown>
  if (tool === 'SendMessage') {
    const to = i.to
    if (typeof to !== 'string' || to === '') return undefined
    return seats.find(s => s.agentId !== '' && s.agentId === to)?.callSign
  }
  if (tool === 'Agent') {
    if (i.subagent_type !== 'mission-fleet:controller' || typeof i.name !== 'string') return undefined
    return seats.find(s => s.status === 'staffing' && s.agentId === '' && s.name === i.name)?.callSign
  }
  return undefined
}

/** Console verbs that message or start an agent. From the app they run through Flight, never from the app's own loop. */
const RELAYED = new Set(['staff', 'call', 'go', 'nogo', 'no-go', 'dismiss', 'stand-down'])
export function isRelayedVerb(args: string): boolean {
  return RELAYED.has((args.trim().split(/\s+/)[0] ?? '').toLowerCase())
}

/** Splits a trailing app relay code off console args. */
export function splitRelayCode(args: string): { args: string; code?: string } {
  const m = /\s--code\s+([0-9a-f]{32})\s*$/.exec(args)
  return m ? { args: args.slice(0, m.index).trim(), code: m[1] } : { args }
}

export type RelayCodes = Map<string, { args: string; at: number }>
export const RELAY_TTL = 10 * 60_000

/**
 * Spends an app relay code: true only for a code minted for exactly these args, within its
 * lifetime. A code is gone after one try, whether it matched or not.
 */
export function spendRelayCode(codes: RelayCodes, code: string | undefined, args: string, now: number): boolean {
  if (!code) return false
  const minted = codes.get(code)
  codes.delete(code)
  const flat = (t: string) => t.trim().replace(/\s+/g, ' ')
  return minted !== undefined && flat(minted.args) === flat(args) && now - minted.at <= RELAY_TTL
}
