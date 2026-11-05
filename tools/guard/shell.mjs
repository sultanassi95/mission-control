// The shell tokenizer and git helpers the push guard reads a Bash command with.
// Extracted from the retired mod guard and stripped of types, so it runs on any Node 18+.
export const SHELL_KEYWORDS = new Set(['if', 'then', 'else', 'elif', 'fi', 'do', 'done', 'while', 'until', 'for', 'case', 'esac', 'in', 'function', 'time', '!', '{', '}', '[[', ']]'])
export const WRAPPERS = new Set(['env', 'command', 'builtin', 'nohup', 'nice', 'sudo', 'caffeinate', 'timeout', 'stdbuf'])
/** Commands that run code they read from an argument, stdin or a heredoc. */
export const INTERPRETER = /^(sh|bash|zsh|dash|ksh|fish|csh|tcsh|python[0-9.]*|perl|ruby|node|deno|bun|php|lua|osascript|xargs|eval|source|\.|exec|awk|gawk)$/
/** Commands that only print or search text: an argument naming git there is data, not a command. */
export const TEXT_ONLY = new Set(['echo', 'printf', 'grep', 'rg', 'cat', 'head', 'tail', 'less', 'more', 'wc', 'ls', 'jq', 'diff'])
/**
 * The `$(cat <<'EOF' ... EOF)` (quoted delimiter only) that starts at `at`: where it ends, just past
 * its `)`, and its body. Undefined for any other `$(`. The body ends at the first line that is
 * exactly the delimiter (after tabs, for `<<-`), where zsh and bash end it, and only `)` may follow.
 */
export function heredocSubstitution(text        , at        )                                            {
  // Nothing may follow the delimiter on its line: text there runs as a command (MC-116).
  const open = /\$\([ \t]*cat[ \t]+<<(-?)[ \t]*(['"])(\w+)\2[ \t]*\n/y
  open.lastIndex = at
  const m = open.exec(text)
  if (!m) return undefined
  const start = at + m[0].length
  const term = new RegExp(`^${m[1] ? '\\t*' : ''}${m[3]}$`, 'gm')
  term.lastIndex = start
  const t = term.exec(text)
  if (!t) return undefined
  const close = /\s*\)/y
  close.lastIndex = t.index + t[0].length
  return close.exec(text) ? { end: close.lastIndex, body: text.slice(start, t.index) } : undefined
}

/**
 * A bash-subset tokenizer: quotes and escapes resolved, `$var`/`${}` and globs
 * marked, `$(...)`, backticks and process substitution marked opaque, heredoc
 * bodies skipped. A `$(cat <<'EOF' ... EOF)` is read where it stands, so one
 * inside single quotes or a comment is text, never a substitution; it becomes a
 * dynamic `heredoc` word carrying its body (a commit message is the use).
 */
export function tokenize(text        )         {
  const commands           = []
  let opaque = false
  let words         = []
  let redirects         = []
  let cur                  
  let redirecting = false
  const heredocs                                                      = []
  const bodies           = []
  const end = () => {
    if (cur) (redirecting ? redirects : words).push(cur)
    if (cur) redirecting = false
    cur = undefined
  }
  // Expansions the guard cannot read: a word holding one is a variable, and a line that runs git or gh refuses it.
  const unread           = []
  const note = (at        , quoted         ) => {
    const x = unreadExpansion(text, at, quoted)
    if (x !== undefined) unread.push(x)
    return x !== undefined
  }
  // An fd number written against a redirect operator (2>&1, 1>f) is part of the redirect, not a word.
  // Only an UNQUOTED bare digit is an fd: '2'>f, "2">f and \2>f are the word 2 plus a redirect.
  const dropFd = () => { if (cur && !redirecting && !cur.quoted && /^[0-9]+$/.test(cur.text)) cur = undefined }
  const flush = (sep = ';') => {
    end()
    if (words.length || redirects.length) commands.push({ words, redirects, sep })
    words = []
    redirects = []
    redirecting = false
  }
  const ch = (i        ) => text[i] ?? ''
  // Once the line is opaque it is refused whatever else it holds, so no later `$(` is searched for a heredoc.
  const substitution = (at        ) => (opaque ? undefined : heredocSubstitution(text, at))
  const holdHeredoc = (w      , body        , splits         ) => {
    w.text += 'HEREDOC'
    w.dynamic = true
    w.heredoc = true
    w.body = (w.body ?? '') + body
    // Unquoted, the substitution word-splits at run time; inside double quotes it stays one argument.
    if (splits) w.splits = true
  }
  for (let i = 0; i < text.length; i++) {
    const c = ch(i)
    if (c === '\n') {
      flush('\n')
      while (heredocs.length) {
        const h = heredocs.shift() ?? { delim: '', quoted: true, dash: false }
        // The body ends at the first line that is exactly the delimiter (after tabs, for <<-), where zsh and bash end it.
        const term = new RegExp(`^${h.dash ? '\\t*' : ''}${h.delim}$`, 'gm')
        term.lastIndex = i + 1
        const m = term.exec(text)
        const body = text.slice(i + 1, m ? m.index : text.length)
        bodies.push(body)
        // An unquoted heredoc expands $(...), backticks and variables inside its body.
        if (!h.quoted && /\$|`/.test(body)) opaque = true
        if (!m) {
          i = text.length
          break
        }
        const lineEnd = text.indexOf('\n', m.index)
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
    // `&>` and `&>>` redirect both streams: one redirect operator, not a separator.
    // No dropFd here: bash keeps a digit written against `&>` as a word while zsh drops it,
    // so keep it a word and let the guard read the command as the stricter shell would.
    if (c === '&' && ch(i + 1) === '>') {
      end()
      i++
      if (ch(i + 1) === '>') i++
      redirecting = true
      continue
    }
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
      dropFd()
      end()
      let j = i + 2
      if (ch(j) === '<') {
        // `<<<` is a here-string: its target is a redirect, not a word.
        i = j
        redirecting = true
        continue
      }
      const dash = ch(j) === '-'
      if (dash) j++
      while (ch(j) === ' ' || ch(j) === '\t') j++
      const word = /(['"]?)(\w+)\1/y
      word.lastIndex = j
      const m = word.exec(text)
      // Only a plain or wholly quoted delimiter is read: the shell ends <<\EOF and <<E"O"F at EOF, which this would not.
      if (!m || /[\w'"\\$`]/.test(ch(j + m[0].length))) opaque = true
      else heredocs.push({ delim: m[2] ?? '', quoted: (m[1] ?? '') !== '', dash })
      i = m ? j + m[0].length - 1 : j - 1
      continue
    }
    if (c === '>' || c === '<') {
      // An input redirect's target is a redirect too, so both directions set `redirecting`.
      dropFd()
      end()
      if (ch(i + 1) === '>' || ch(i + 1) === '&' || ch(i + 1) === '|') i++
      redirecting = true
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
      cur.quoted = true
      cur.text += ch(++i)
      continue
    }
    if (c === "'") {
      cur.quoted = true
      const close = text.indexOf("'", i + 1)
      cur.text += text.slice(i + 1, close < 0 ? text.length : close)
      i = close < 0 ? text.length : close
      continue
    }
    if (c === '"') {
      cur.quoted = true
      let j = i + 1
      for (; j < text.length && ch(j) !== '"'; j++) {
        const d = ch(j)
        if (d === '\\' && ch(j + 1) === '\n') j++
        else if (d === '\\') cur.text += ch(++j)
        else if (d === '`' || (d === '$' && ch(j + 1) === '(')) {
          const sub = d === '$' ? substitution(j) : undefined
          if (sub) {
            holdHeredoc(cur, sub.body, false)
            j = sub.end - 1
          } else {
            opaque = true
            cur.dynamic = true
          }
        } else if (d === '$' && /[A-Za-z_{@*#?$!0-9]/.test(ch(j + 1))) {
          cur.dynamic = true
          cur.text += d
          note(j, true)
        } else {
          if (d === '$' && note(j, true)) cur.dynamic = true
          cur.text += d
        }
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
        const sub = substitution(i)
        if (sub) {
          holdHeredoc(cur, sub.body, true)
          i = sub.end - 1
          continue
        }
        opaque = true
        cur.dynamic = true
        i++
        continue
      }
      if (note(i, false) || /[A-Za-z_{@*#?$!0-9]/.test(ch(i + 1))) cur.dynamic = true
    }
    // zsh reads a word opening with an unquoted = as =cmd, the path of that command.
    if (c === '=' && cur.text === '' && note(i, false)) cur.dynamic = true
    if (c === '*' || c === '?' || c === '[' || c === '{' || c === '~') cur.glob = true
    cur.text += c
  }
  flush()
  return { commands, opaque, bodies, unread }
}

/**
 * The expansion at `text[at]` the guard cannot read, if any: after a `$`, anything but a plain `$NAME`,
 * `${NAME}` or `$?` (zsh's `$=X`, `$^X`, `$~X`, `${=X}` and `${(s:,:)X}`, the special parameters, `$'...'`);
 * and zsh's `=cmd` for a word that opens with `=`. Undefined for those and for a `$` or `=` that expands
 * nothing. `quoted` is true inside double quotes, where `$'` and `$"` are literal.
 */
export function unreadExpansion(text        , at        , quoted         )                     {
  const next = text[at + 1] ?? ''
  // zsh takes the rest of the word, quotes removed, as the command name (='git' too); == and =~ name no real command.
  if (text[at] === '=') return next === '' || /[\s;|&<>()=~]/.test(next) ? undefined : `=${/^(?:'[^']*'|"(?:\\.|[^"\\])*"|\\.|[^\s;|&<>()'"\\])*/.exec(text.slice(at + 1))?.[0] ?? ''}`
  if (text[at] !== '$' || next === '' || next === '(' || next === '[' || next === '?' || /[\s;|&<>)A-Za-z_]/.test(next)) return undefined
  if (quoted && (next === '"' || next === "'")) return undefined
  if (next === '{') {
    // A well-formed ${NAME} never spans a newline; stop there so an unbalanced ${ is not a full-text scan.
    let depth = 0
    let k = at + 1
    for (; k < text.length && text[k] !== '\n'; k++) {
      if (text[k] === '{') depth++
      else if (text[k] === '}' && --depth === 0) break
    }
    const braced = text.slice(at, k + 1)
    return /^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(braced) ? undefined : braced
  }
  if (next === "'" || next === '"') {
    const close = text.indexOf(next, at + 2)
    return text.slice(at, close < 0 ? text.length : close + 1)
  }
  // zsh leaves $ literal unless a special parameter ($$ $! $# $- $* $@ $0-$9) or a flag ($= $^ $~ $+) follows.
  if (!/[=^~+$!#\-*@0-9]/.test(next)) return undefined
  return `$${next}${/^[=^~+#]*[A-Za-z0-9_]*/.exec(text.slice(at + 2))?.[0] ?? ''}`
}

/** The command a simple command runs: keywords, assignments and wrappers skipped. */
export function headOf(s        )                                {
  const w = s.words
  let i = 0
  while (i < w.length) {
    const t = w[i]?.text ?? ''
    if (SHELL_KEYWORDS.has(t) || /^[A-Za-z_][A-Za-z0-9_]*\+?=/.test(t)) i++
    else if (WRAPPERS.has(t)) {
      i++
      while (i < w.length && /^(-|[A-Za-z_][A-Za-z0-9_]*\+?=|\d+[smhd]?$)/.test(w[i]?.text ?? '')) i++
    } else break
  }
  return { head: w[i], rest: w.slice(i + 1) }
}

// Lowercased: the disk is case-insensitive, so GIT and Gh run git and gh (MC-116).
export const baseName = (t        ) => t.slice(t.lastIndexOf('/') + 1).toLowerCase()

/** A push destination as compared: refs/heads/ or heads/ stripped, lower case. */
export function pushDestination(spec        )         {
  const dst = spec.includes(':') ? spec.slice(spec.indexOf(':') + 1) : spec
  return dst.replace(/^refs\/heads\//i, '').replace(/^heads\//i, '').toLowerCase()
}

const GIT_GLOBAL_FLAGS = new Set(['-p', '--paginate', '-P', '--no-pager', '--no-replace-objects', '--no-lazy-fetch', '--no-optional-locks', '--no-advice', '--literal-pathspecs', '--no-literal-pathspecs', '--glob-pathspecs', '--noglob-pathspecs', '--icase-pathspecs'])
const GIT_GLOBAL_VALUED = new Set(['-C', '--git-dir', '--work-tree', '--namespace'])
const GIT_GLOBALS = '-C <dir>, --git-dir, --work-tree and --namespace with their value (the last three also as --option=value), -p, --paginate, -P, --no-pager, --no-replace-objects, --no-lazy-fetch, --no-optional-locks, --no-advice, --literal-pathspecs, --no-literal-pathspecs, --glob-pathspecs, --noglob-pathspecs, --icase-pathspecs'
// git ends its options at these and runs them as its version and help commands (`git --version log` runs `version log`).
const GIT_COMMAND_OPTIONS = new Map([['--version', 'version'], ['-v', 'version'], ['--help', 'help'], ['-h', 'help']])

/** Where a git call's subcommand sits past its global options, or why a global option before it is refused. */
export function gitGlobals(rest        )                                   {
  let i = 0
  for (; i < rest.length; i++) {
    const t = rest[i]?.text ?? ''
    if (!t.startsWith('-') || GIT_COMMAND_OPTIONS.has(t)) break
    if (t === '-c' || t.startsWith('--config-env') || t.startsWith('--exec-path')) return { at: i, refusal: 'git -c, --config-env and --exec-path are not allowed: they can alias or redirect a command.' }
    if (GIT_GLOBAL_FLAGS.has(t)) continue
    const eq = t.indexOf('=')
    const joined = eq > 2 && t.startsWith('--') && GIT_GLOBAL_VALUED.has(t.slice(0, eq))
    if (!joined && !GIT_GLOBAL_VALUED.has(t)) {
      return { at: i, refusal: `${t} is not an allowed git global option (before the subcommand: ${GIT_GLOBALS}): git may take the next word as its value and run another subcommand than the one read here.` }
    }
    const value = joined ? rest[i] : rest[++i]
    if (value && (value.dynamic || value.glob)) {
      return { at: i, refusal: `The value of git ${joined ? t.slice(0, eq) : t} must be literal (no variables, globs or braces): the shell can make it several words, and git would run another subcommand than the one read here.` }
    }
  }
  return { at: i }
}

export function foldPath(p        )         {
  const out           = []
  for (const part of p.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return `/${out.join('/')}`
}

/**
 * Programs that run as a child of the shell and so cannot move its directory. Before a git or gh call
 * on its line, only these keep the shell where it started: any other head (a builtin, a function, an
 * alias, eval, a zsh modifier such as noglob or repeat) might move it, so the start pins nothing after it.
 */
const STAYS = new Set(['git', 'gh', 'echo', 'printf', 'true', 'false', 'test', '[', 'ls', 'cat', 'grep', 'rg', 'head', 'tail', 'wc', 'sort', 'uniq', 'cut', 'tr', 'jq', 'diff', 'stat', 'file', 'find', 'mkdir', 'touch', 'cp', 'mv', 'rm', 'sleep', 'date', 'npm', 'pnpm', 'yarn', 'npx', 'bun', 'tsc'])

/** The `cd <dir> &&` run directly before a command: only that pins it (anything else may not have run, or ran in a subshell). */
function cdChain(commands          , index        )         {
  const chain         = []
  for (let k = index - 1; k >= 0; k--) {
    const prev = commands[k]          
    const { head: h, rest: r } = headOf(prev)
    if (prev.sep !== '&&' || !h || h.text !== 'cd' || r.length !== 1) break
    chain.unshift(r[0]        )
  }
  return chain
}

/** True when a cd in a git call's pin chain names a relative path CDPATH can resolve elsewhere (one not led by `.` or `..`). */
function pinFollowsCdpath(commands          , index        )          {
  const { rest } = headOf(commands[index]          )
  if (rest.some(w => w.text === '-C')) return false
  return cdChain(commands, index).some(w => !w.text.startsWith('/') && !/^\.\.?(\/|$)/.test(w.text))
}

/**
 * The repo directory a git or gh call is pinned to: `git -C <dir>`, else the
 * last literal `cd` before it on the line; undefined when nothing pins it.
 * A fleet agent's shell starts wherever Flight's does, so an unpinned git call
 * can land in the wrong repo.
 */
export function pinnedDir(commands          , index        , start         )                     {
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
  const chain = cdChain(commands, index)
  // No cd before it: it runs where the shell starts, when the engine says where that is (an absolute
  // path) and nothing earlier on the line can have moved the shell.
  if (chain.length === 0) {
    const moves = commands.slice(0, index).some(s => {
      const h = headOf(s).head
      return h !== undefined && (h.dynamic || h.glob || h.text.includes('/') || !STAYS.has(baseName(h.text)))
    })
    return start && start.startsWith('/') && !moves ? foldPath(start) : undefined
  }
  let dir                    
  for (const to of chain) {
    if (to.dynamic || to.glob || to.text.startsWith('-')) return undefined
    if (to.text.startsWith('/')) dir = foldPath(to.text)
    else if (dir) dir = foldPath(`${dir}/${to.text}`)
    else return undefined
  }
  return dir
}

/** The words that pin a git call: its `-C` value, else the `cd` chain run directly before it. */
