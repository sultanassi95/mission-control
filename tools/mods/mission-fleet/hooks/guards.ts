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

import type { PollItem } from '../types'
import { isUndelivered } from './loops'

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
  controller: new Set([...GIT_READS, ...GIT_LOCAL_WRITES, 'switch', 'checkout', 'restore', 'reset', 'merge', 'rebase', 'cherry-pick', 'revert', 'pull', 'remote', 'config', 'push', 'clone']),
  'back room': new Set([...GIT_READS, 'add', 'commit']),
}

/**
 * Where a Controller may clone into: one level under the folder of any front it was staffed with,
 * `<fronts folder>/<front>/<repo>`, where the fronts folder holds its own front's folder (`home`).
 */
export type CloneScope = { home: string; fronts: string[] }

// Clone options by exact spelling. git also takes any unique prefix of a long option (--temp is
// --template), so a spelling off this list is refused, whatever git would expand it to. A value is
// the next word, checked by its pattern; no allowed spelling is a prefix of another clone option.
const CLONE_FLAGS = new Set(['--single-branch', '--no-single-branch', '--filter=blob:none', '-q', '--quiet', '--no-tags'])
const BRANCH_NAME = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/
const CLONE_VALUED: Record<string, RegExp> = {
  '--depth': /^[1-9][0-9]{0,5}$/,
  '--branch': BRANCH_NAME,
  '-b': BRANCH_NAME,
  '--origin': /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/,
}
const CLONE_OPTIONS = '--depth N, --branch NAME or -b NAME, --single-branch, --no-single-branch, --filter=blob:none, --origin NAME, -q or --quiet, --no-tags'
// A source git reads over the network, in a form this guard reads whole: a URL with a scheme, a host
// and a path, or USER@HOST:PATH. Host and user start with a letter or digit (ssh takes a leading dash
// as an option), and every path part is plain, so the folder git names for it is plain too.
const HOST = '[A-Za-z0-9](?:[A-Za-z0-9._-]{0,251}[A-Za-z0-9])?'
const USER = '[A-Za-z0-9_][A-Za-z0-9._-]{0,63}'
const PATH = '[A-Za-z0-9._-]+(?:/[A-Za-z0-9._-]+)*'
const SCHEME_URL = new RegExp(`^(?:https?|ssh|git\\+ssh|ssh\\+git|git)://(?:${USER}@)?(${HOST})(?::[0-9]{1,5})?/(${PATH})/?$`)
const SCP_URL = new RegExp(`^${USER}@(${HOST}):/?(${PATH})/?$`)
const SOURCE_FORMS = 'https://HOST/PATH, http://, ssh://[USER@]HOST[:PORT]/PATH, git+ssh://, git:// or USER@HOST:PATH'
// A name of dots alone is no folder of its own (`.`, `..`), and `.git`, in any case and with or
// without trailing dots (which some disks drop), would turn a front's folder into a repository.
const NO_NAME = /^(\.+|\.git\.*)$/i
// The resolver reads a host written as a number loosely (127.1, 2130706433, 0x7f.0.0.1 and 0177.0.0.1
// are all 127.0.0.1), so a numeric host passes only spelled a.b.c.d, and never in 127/8 or 0/8.
const OCTET = '(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])'
const QUAD = new RegExp(`^${OCTET}(?:\\.${OCTET}){3}$`)

/** The fronts folder: the parent of the console's own front folder. */
function frontsFolder(clone: CloneScope): string {
  return foldPath(`${clone.home}/..`)
}

/** True when dir is the folder of a front the clone scope names, exactly `<fronts folder>/<front>`. */
function isFrontFolder(dir: string, clone: CloneScope | undefined): boolean {
  if (!clone) return false
  const root = frontsFolder(clone)
  return dir.startsWith(`${root}/`) && clone.fronts.includes(dir.slice(root.length + 1))
}

/**
 * True when dir is in a worktree beside the console's repo, `<front folder>/<repo>-<slug>[/...]`, where
 * the delivery flows place one (framework/task-board.md). Only for a console whose directory is a repo
 * one level under its own front's folder: beside a front's folder lies another front.
 */
function isSiblingWorktree(dir: string, scope: string, clone: CloneScope | undefined): boolean {
  if (!clone || foldPath(`${scope}/..`) !== foldPath(clone.home)) return false
  const rest = dir.startsWith(`${scope}-`) ? dir.slice(scope.length + 1) : ''
  return /^[A-Za-z0-9._-]+(\/|$)/.test(rest) && !NO_NAME.test(rest.split('/')[0] ?? '')
}

/**
 * The folder git names for a clone of `source` when no destination is given, as git's
 * guess_dir_name (builtin/clone.c) derives it: skip the scheme and any user, strip trailing
 * slashes and a `/.git`, strip a port when there is no path, take the last part after `/` or
 * `:`, and strip one `.git`.
 */
function cloneFolder(source: string): string {
  const scheme = source.indexOf('://')
  let start = scheme < 0 ? 0 : scheme + 3
  const slash = source.indexOf('/', start)
  const at = source.lastIndexOf('@', slash < 0 ? source.length : slash)
  if (at >= start) start = at + 1
  let s = source.slice(start).replace(/\/+$/, '')
  if (s.length > 5 && s.endsWith('/.git')) s = s.slice(0, -5).replace(/\/+$/, '')
  if (!s.includes('/') && s.includes(':')) s = s.replace(/:[0-9]*$/, '')
  const last = s.slice(Math.max(s.lastIndexOf('/'), s.lastIndexOf(':')) + 1)
  return last.endsWith('.git') ? last.slice(0, -4) : last
}

/** Why git would not fetch `source` as a repository over the network, or undefined when it would. */
function sourceRefusal(source: string): string | undefined {
  if (/^[A-Za-z][A-Za-z0-9+.-]*::/.test(source)) return `${source} names a remote helper (HELPER::), which runs a program rather than fetch a repository`
  if (/^file:\/\//i.test(source)) return `${source} is a file:// source, which reads this Mac's folders, other fronts' repositories included`
  if (/(:\/\/|@)-/.test(source)) return `${source}: a host or user starting with - would reach ssh as an option`
  // git reads a source with no `://` as a local path unless a `:` comes before any `/` (USER@HOST:PATH).
  const colon = source.indexOf(':')
  if (!source.includes('://') && (colon < 0 || source.slice(0, colon).includes('/'))) return `${source} is a local path, which reads this Mac's folders, other fronts' repositories included`
  const [, host, path] = SCHEME_URL.exec(source) ?? SCP_URL.exec(source) ?? []
  if (host === undefined || path === undefined) return `${source} is not a repository URL this guard can read: use ${SOURCE_FORMS}`
  const onMac = hostRefusal(source, host)
  if (onMac) return onMac
  const folder = cloneFolder(source)
  if (path.split('/').some(part => NO_NAME.test(part)) || !/^[A-Za-z0-9._-]+$/.test(folder) || NO_NAME.test(folder)) {
    return `${source} leaves git no folder of its own: a path part is dots alone or .git`
  }
  if (folder.startsWith('.')) return `${source} would make the folder ${folder}, and a folder starting with . is one tools read as settings (a .claude folder's hooks run commands)`
  return undefined
}

/** Why a clone source's host is this Mac, or may spell it, or undefined for a host on the network. */
function hostRefusal(source: string, host: string): string | undefined {
  const h = host.toLowerCase()
  // As URL parsers read a host: when its last label is a number (decimal, or hex led by 0x), it is an address.
  const numeric = /^(?:0x[0-9a-f]*|[0-9]+)$/.test(h.slice(h.lastIndexOf('.') + 1))
  if (numeric && !QUAD.test(h)) return `${source} writes its host as a number other than a.b.c.d, a spelling that can name this Mac (127.1 is 127.0.0.1)`
  if (h === 'localhost' || h.endsWith('.localhost') || (numeric && /^(?:127|0)\./.test(h))) {
    return `${source} names this Mac (localhost, 127.x.x.x or 0.x.x.x): a clone from it reads this Mac's own folders and services`
  }
  return undefined
}

/** True when a path has a `..` after a folder name: the disk resolves that `..` from wherever a link there points. */
function dotsAfterName(path: string): boolean {
  let named = false
  for (const part of path.split('/')) {
    if (part === '..' && named) return true
    if (part !== '' && part !== '.' && part !== '..') named = true
  }
  return false
}

/** The clone rule as a Controller's staffing order states it, in one line. */
export function cloneRule(clone: CloneScope): string {
  return `Clones: any repository URL (https://, http://, ssh://, git+ssh://, ssh+git://, git:// or USER@HOST:PATH) may land one level under a front's folder, ${frontsFolder(clone)}/<front>/<repo>, for ${clone.fronts.join(', ')};`
    + ` run it from exactly a front's folder or your console's directory, named by its full path with no ..: \`cd ${foldPath(clone.home)} && git clone <url>\`.`
    + ' Refused: a remote helper (HELPER::), a file:// or local-path source, this Mac as the host (localhost, 127.x.x.x, 0.x.x.x) or a host written as a number other than a.b.c.d,'
    + ` a host or user starting with -, a folder starting with ., a .. after a folder name in the destination, a landing anywhere else, and any option but ${CLONE_OPTIONS}.`
}

/**
 * Why a Controller may not run this clone, or undefined when it may: every option on the list, the
 * source a repository URL git fetches over the network, and the destination (git's own folder name
 * for the URL when none is given) exactly `<fronts folder>/<front>/<that name>` for a front the
 * console was staffed with. With no pin, `unpinned` says why the folder it ran from does not pin it.
 */
export function cloneRefusal(args: Word[], pin: string | undefined, clone: CloneScope | undefined, unpinned = ''): string | undefined {
  if (!clone) return 'this console was staffed before clones were allowed: it can clone once it is stood down and staffed again'
  if (args.some(a => a.dynamic || a.glob)) return 'clone arguments must be literal (no variables, globs or substitutions)'
  const positional: string[] = []
  for (let i = 0; i < args.length; i++) {
    const t = args[i]?.text ?? ''
    if (t === '--') return '`--` is not allowed in a clone'
    if (!t.startsWith('-')) {
      positional.push(t)
      continue
    }
    if (CLONE_FLAGS.has(t)) continue
    const value = CLONE_VALUED[t]
    if (!value) return `${t} is not an allowed clone option (allowed: ${CLONE_OPTIONS})`
    if (!value.test(args[i + 1]?.text ?? '')) return `${t} takes a plain value as the next word (allowed: ${CLONE_OPTIONS})`
    i++
  }
  const [source, dest, ...extra] = positional
  if (source === undefined) return 'name the repository to clone'
  if (extra.length) return 'a clone takes the repository and at most one destination'
  const bad = sourceRefusal(source)
  if (bad) return bad
  const folder = cloneFolder(source)
  const home = foldPath(clone.home)
  // Unpinned, pinned by a relative cd that CDPATH can send elsewhere, or pinned where a link could lead out: it could land anywhere.
  if (!pin) return `${unpinned}pin it to a front's folder by its full path: \`cd ${home} && git clone ${source}\``
  // Compared exactly, case included: an allowlist that matched loosely would admit a path the disk keeps apart.
  const target = foldPath(dest === undefined ? `${pin}/${folder}` : dest.startsWith('/') ? dest : `${pin}/${dest}`)
  const root = frontsFolder(clone)
  const parts = target.startsWith(`${root}/`) ? target.slice(root.length + 1).split('/') : []
  const front = parts[0] ?? ''
  // Point at the front the target names when it is one, else the console's own.
  const to = clone.fronts.includes(front) ? `${root}/${front}` : home
  const use = `a clone lands one level under a front's folder, here ${to}/${folder}: \`cd ${to} && git clone ${source}\``
  // The target is folded as text; the disk would resolve this `..` from wherever a link before it points.
  if (dest !== undefined && dotsAfterName(dest)) return `${dest} has .. after a folder name, which a link inside the tree could carry elsewhere; ${use}`
  if (parts.length === 2 && parts[1] === folder) {
    return clone.fronts.includes(front) ? undefined : `${front} is not a front this console was staffed with (${clone.fronts.join(', ')})`
  }
  return `it would land in ${target}; ${use}`
}

// gh resolves the repository from the pinned directory's remote (-R is refused), so these verbs act on the
// Controller's own repo; a write verb naming a PR or issue by URL could reach another one, and is refused.
const GH_ALLOWED: Record<string, Set<string> | 'any'> = {
  pr: new Set(['create', 'view', 'list', 'checks', 'diff', 'status', 'comment', 'edit', 'ready']),
  issue: new Set(['list', 'view', 'status', 'create', 'comment', 'edit', 'close', 'reopen', 'pin', 'unpin', 'lock', 'unlock']),
  run: new Set(['list', 'view', 'watch', 'rerun']),
  repo: new Set(['view']),
  auth: new Set(['status']),
  search: 'any',
}
const GH_READ_VERBS = new Set(['view', 'list', 'checks', 'diff', 'status', 'watch'])
// gh pr, issue and run options that take the next word as their value: what follows one is not the item.
const GH_VALUED = new Set(['-b', '--body', '-F', '--body-file', '-t', '--title', '-B', '--base', '-H', '--head', '-a', '--assignee', '-l', '--label', '-m', '--milestone',
  '-p', '--project', '-r', '--reviewer', '--reason', '-c', '--comment', '-T', '--template', '-j', '--job', '--recover',
  '--add-assignee', '--remove-assignee', '--add-label', '--remove-label', '--add-project', '--remove-project', '--add-reviewer', '--remove-reviewer'])
// The item a write verb acts on, in the pinned repo: a number or a branch name. gh reads a URL with any tail
// (/files, #comment, ?x=1) or OWNER/REPO#N as another repo's item, so nothing else passes.
const GH_ITEM = /^([0-9]+|[A-Za-z0-9][A-Za-z0-9._/-]*)$/

// gh api options that take the next word as their value (or attached, -XPOST, --method=POST).
const GH_API_VALUED = new Set(['-X', '--method', '-f', '--raw-field', '-F', '--field', '-H', '--header', '--input', '-q', '--jq', '-t', '--template', '--cache', '-p', '--preview', '--hostname'])
const GH_API_BODY = new Set(['-f', '--raw-field', '-F', '--field', '--input'])
// Writes go only to the pinned repo (gh fills {owner} and {repo} from it), and only to PR, issue, comment
// and CI-rerun endpoints: none of them moves a branch, merges, changes settings or deletes.
const GH_API_WRITABLE = [
  /^issues\/[0-9]+$/, /^issues\/[0-9]+\/(comments|labels|assignees)$/, /^issues\/comments\/[0-9]+$/,
  /^pulls\/[0-9]+$/, /^pulls\/[0-9]+\/(comments|requested_reviewers)$/, /^pulls\/comments\/[0-9]+$/, /^pulls\/[0-9]+\/comments\/[0-9]+\/replies$/,
  /^actions\/runs\/[0-9]+\/(rerun|rerun-failed-jobs)$/, /^actions\/jobs\/[0-9]+\/rerun$/,
]
const GH_API_MERGE = /(^|\/)(pulls\/[^/]+\/merge|merges)\/?$/i
const OWN_REPO = /^\/?repos\/\{owner\}\/\{repo\}\/(.+?)\/?$/

/** Why a Controller may not run this gh api call, or undefined when it may: reads anywhere, writes as GH_API_WRITABLE lists. */
function ghApiRefusal(args: Word[]): string | undefined {
  let method: string | undefined
  let body = false
  const positional: Word[] = []
  // A variable or glob can expand to a method, a field or a whole option; {owner} and {repo} are the one brace form taken.
  for (const w of args) {
    const placeholders = !w.text.startsWith('-') && /^[^*?[\]~]*$/.test(w.text) && !/\{(?!owner\}|repo\})/.test(w.text)
    if (w.dynamic || (w.glob && !placeholders)) return 'gh api words must be literal (no variables, globs or braces but {owner} and {repo}): the shell could turn one into a method, a field or an option.'
  }
  for (let i = 0; i < args.length; i++) {
    const w = args[i] as Word
    const t = w.text
    const eq = t.indexOf('=')
    const long = t.startsWith('--') && eq > 2 ? t.slice(0, eq) : t
    const short = /^-[A-Za-z]./.test(t) && !t.startsWith('--') ? t.slice(0, 2) : t
    const opt = GH_API_VALUED.has(long) ? long : GH_API_VALUED.has(short) ? short : undefined
    if (opt) {
      const value = opt === t ? args[++i] : undefined
      // pflag reads -X=DELETE as -X DELETE: an attached short value drops one leading =.
      const text = value ? value.text : opt === long ? t.slice(eq + 1) : t.slice(2).replace(/^=/, '')
      if (opt === '--hostname') return 'gh api --hostname is not allowed here: it reaches another GitHub host than the pinned repo\'s.'
      if (opt === '-X' || opt === '--method') method = text.toUpperCase()
      if (GH_API_BODY.has(opt)) body = true
      if ((opt === '-H' || opt === '--header') && /method/i.test(text)) return 'gh api takes no header that overrides its method.'
      continue
    }
    // pflag reads -iX POST as -i plus -X POST: a cluster could hide a method, so options come one at a time.
    if (/^-[A-Za-z]{2,}/.test(t)) return `gh api ${t}: write its options one at a time (-i -X POST), so the method and fields are readable.`
    if (!t.startsWith('-')) positional.push(w)
  }
  const endpoint = positional[0]
  if (positional.some(p => p.text === 'graphql')) return 'gh api graphql is not allowed here (it can merge and push).'
  const writes = (method !== undefined && method !== 'GET' && method !== 'HEAD') || (method === undefined && body)
  if (!writes) return undefined
  if (method === 'DELETE') return 'gh api -X DELETE is not allowed here: a delete cannot be undone.'
  if (!endpoint) return 'Name the gh api endpoint.'
  if (GH_API_MERGE.test(endpoint.text)) return 'Merging is the founder\'s, never a Controller\'s.'
  const own = OWN_REPO.exec(endpoint.text)
  // The {owner} and {repo} braces read as a glob; any other glob, a variable or a substitution is unreadable.
  const literal = !endpoint.dynamic && !/[*?[\]~]/.test(endpoint.text) && !/\{(?!owner\}|repo\})/.test(endpoint.text)
  if (!own || !literal || !GH_API_WRITABLE.some(r => r.test(own[1] ?? ''))) {
    return 'gh api writes only to the pinned repo\'s PR, issue, comment and CI-rerun endpoints, written as repos/{owner}/{repo}/<endpoint> (pulls/N, issues/N/comments, actions/runs/N/rerun and the like); reads (GET) go anywhere.'
  }
  return undefined
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
// Variables that move what git reads or runs: its config and ssh (HOME, XDG_CONFIG_HOME, GIT_*, SSH_*),
// the programs it finds (PATH), the files a shell reads at start (ENV, BASH_ENV, ZDOTDIR) and where a
// relative cd lands (CDPATH). Matched as an assignment (NAME=, NAME+=) or a bare name (export NAME).
const GIT_LEVER = /^((GH|GIT|GITHUB|SSH|DYLD|LD)_[A-Za-z0-9_]*|HOME|PATH|CDPATH|XDG_CONFIG_HOME|ENV|BASH_ENV|ZDOTDIR|EDITOR|VISUAL|PAGER)(\+?=|$)/
const SETTERS = new Set(['export', 'declare', 'typeset', 'readonly', 'local', 'set', 'setenv'])
const LEVER_REFUSAL = 'On a line that names git or gh, nothing sets HOME, PATH, CDPATH, XDG_CONFIG_HOME, ENV, BASH_ENV, ZDOTDIR, EDITOR, VISUAL, PAGER or a GIT_*, GH_*, GITHUB_*, SSH_*, DYLD_* or LD_* variable, and nothing exports a value built from a variable: they can redirect git and gh or make it run a program. Run that as a separate command.'

/**
 * A word as the shell will see it. `quoted` marks one with a quoted or escaped part, which is never
 * an fd number. `heredoc` marks one that holds a `$(cat <<'EOF' ... EOF)`: its
 * text shows `HEREDOC` there, `body` holds what the substitution prints, and the word is dynamic,
 * because unquoted the shell splits that output into words of its own. `splits` marks a heredoc that
 * was NOT inside double quotes, so at run time it word-splits into several arguments: it may not stand
 * as a message, since a message option would take only its first word and the rest ride in as options.
 */
export type Word = { text: string; dynamic: boolean; glob: boolean; quoted?: boolean; heredoc?: true; body?: string; splits?: true }
export type Simple = { words: Word[]; redirects: Word[]; sep: string }
export type Parsed = { commands: Simple[]; opaque: boolean; bodies: string[]; unread: string[] }

/**
 * The `$(cat <<'EOF' ... EOF)` (quoted delimiter only) that starts at `at`: where it ends, just past
 * its `)`, and its body. Undefined for any other `$(`. The body ends at the first line that is
 * exactly the delimiter (after tabs, for `<<-`), where zsh and bash end it, and only `)` may follow.
 */
function heredocSubstitution(text: string, at: number): { end: number; body: string } | undefined {
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
export function tokenize(text: string): Parsed {
  const commands: Simple[] = []
  let opaque = false
  let words: Word[] = []
  let redirects: Word[] = []
  let cur: Word | undefined
  let redirecting = false
  const heredocs: { delim: string; quoted: boolean; dash: boolean }[] = []
  const bodies: string[] = []
  const end = () => {
    if (cur) (redirecting ? redirects : words).push(cur)
    if (cur) redirecting = false
    cur = undefined
  }
  // Expansions the guard cannot read: a word holding one is a variable, and a line that runs git or gh refuses it.
  const unread: string[] = []
  const note = (at: number, quoted: boolean) => {
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
  const ch = (i: number) => text[i] ?? ''
  // Once the line is opaque it is refused whatever else it holds, so no later `$(` is searched for a heredoc.
  const substitution = (at: number) => (opaque ? undefined : heredocSubstitution(text, at))
  const holdHeredoc = (w: Word, body: string, splits: boolean) => {
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
export function unreadExpansion(text: string, at: number, quoted: boolean): string | undefined {
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
export function headOf(s: Simple): { head?: Word; rest: Word[] } {
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

// A heredoc word hides from every rule what it expands to, so it stands only as a message: the value
// of one of these options, as the next word or attached (-mHEREDOC, --message=HEREDOC), and only when
// double-quoted. Unquoted it word-splits, and the option would take its first word while the rest ride
// in as further options (`gh api ... -t $(cat <<EOF\nx -X PUT\nEOF)` would run -X PUT).
type MessageOption = { next: RegExp; attached: RegExp }
const GIT_MESSAGE: MessageOption = { next: /^(-[A-Za-z]*m|--message)$/, attached: /^(-[A-Za-z]*m|--message=)$/ }
const GIT_MESSAGE_SUBS = new Set(['commit', 'tag', 'notes', 'merge'])
const GH_MESSAGE: MessageOption = { next: /^(-[bt]|--body|--title)$/, attached: /^(-[bt]|--body=|--title=)$/ }

/** True when words[k] is a heredoc word standing as the value of a message option. */
function isMessage(words: Word[], k: number, option: MessageOption): boolean {
  const w = words[k]
  if (!w?.heredoc || w.splits) return false
  if (w.text !== 'HEREDOC') return w.text.endsWith('HEREDOC') && option.attached.test(w.text.slice(0, -'HEREDOC'.length))
  const prev = words[k - 1]
  return prev !== undefined && !prev.dynamic && option.next.test(prev.text)
}

// git's global options by exact spelling, as git 2.55 reads them: flags, and options whose value is the
// next word (or follows `=`, for the long ones). Any other word before the subcommand is refused, since
// git may take the next word as its value and run another subcommand than the one read here
// (`git --attr-source status push origin main` runs the push), and a later git may expand an abbreviation.
// A value must be literal: the shell can turn a variable, glob or brace into several words
// (`--namespace {x,push,origin,main} status` runs the push).
const GIT_GLOBAL_FLAGS = new Set(['-p', '--paginate', '-P', '--no-pager', '--no-replace-objects', '--no-lazy-fetch', '--no-optional-locks', '--no-advice', '--literal-pathspecs', '--no-literal-pathspecs', '--glob-pathspecs', '--noglob-pathspecs', '--icase-pathspecs'])
const GIT_GLOBAL_VALUED = new Set(['-C', '--git-dir', '--work-tree', '--namespace'])
const GIT_GLOBALS = '-C <dir>, --git-dir, --work-tree and --namespace with their value (the last three also as --option=value), -p, --paginate, -P, --no-pager, --no-replace-objects, --no-lazy-fetch, --no-optional-locks, --no-advice, --literal-pathspecs, --no-literal-pathspecs, --glob-pathspecs, --noglob-pathspecs, --icase-pathspecs'
// git ends its options at these and runs them as its version and help commands (`git --version log` runs `version log`).
const GIT_COMMAND_OPTIONS = new Map([['--version', 'version'], ['-v', 'version'], ['--help', 'help'], ['-h', 'help']])

/** Where a git call's subcommand sits past its global options, or why a global option before it is refused. */
function gitGlobals(rest: Word[]): { at: number; refusal?: string } {
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

function gitRefusal(role: Role, rest: Word[], protectedBranches: string[], pin?: string, clone?: CloneScope, unpinned?: string): string | undefined {
  const { at: i, refusal } = gitGlobals(rest)
  if (refusal) return refusal
  const sub = rest[i]
  if (!sub) return undefined
  if (sub.dynamic || sub.glob) return 'The git subcommand must be literal.'
  const name = GIT_COMMAND_OPTIONS.get(sub.text) ?? sub.text
  if (!GIT_ALLOWED[role].has(name)) {
    if (name === 'stash') return role === 'controller' ? 'A Controller never stashes: the tree may hold someone else\'s work. Commit to your branch instead.' : 'A back-room agent never runs git stash; report to your Controller instead.'
    return role === 'controller' ? `git ${name} is not on a Controller's allowlist.` : `A back-room agent never runs git ${name}; report to your Controller instead.`
  }
  if (rest.some((w, k) => w.heredoc && !(k > i && GIT_MESSAGE_SUBS.has(name) && isMessage(rest, k, GIT_MESSAGE)))) {
    return `In git, a $(cat <<'EOF' ... EOF) value stands only as a commit, tag, note or merge message (-m or --message); here it is part of git ${name}'s arguments.`
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
  if (name === 'clone') {
    // Global options can move where a clone reads its config or writes (--bare, --git-dir): only -C pins it.
    const lead = rest.slice(0, i)
    const extra = clone && lead.length > 0 && !(lead.length === 2 && lead[0]?.text === '-C')
    const why = extra ? `git takes no option before clone but -C <dir> (here: ${lead.map(w => w.text).join(' ')})` : cloneRefusal(args, pin, clone, unpinned)
    return why ? `A Controller clones only into a front's folder, one level down (fronts/<front>/<repo>): ${why}.` : undefined
  }
  if (name === 'config' && !args.some(a => ['--get', '--get-all', '--list', '-l', '--get-regexp'].includes(a.text))) return 'git config is read-only here (--get or --list).'
  if (name === 'remote' && args.some(a => ['add', 'set-url', 'rename', 'remove', 'rm', 'set-head', 'prune'].includes(a.text))) return 'git remote is read-only here.'
  return undefined
}

function ghRefusal(rest: Word[]): string | undefined {
  if (rest.some((w, k) => w.heredoc && !isMessage(rest, k, GH_MESSAGE))) return 'In gh, a $(cat <<\'EOF\' ... EOF) value stands only as a --title or --body.'
  const pos: Word[] = []
  for (let i = 0; i < rest.length; i++) {
    const w = rest[i]
    const t = w?.text ?? ''
    if (t === '-R' || t === '--repo') i++
    else if (w && !t.startsWith('-')) pos.push(w)
  }
  const [group, verb] = pos
  if (!group || group.dynamic || verb?.dynamic) return 'The gh subcommand must be literal.'
  if (group.text === 'api') return ghApiRefusal(rest.slice(rest.indexOf(group) + 1))
  const allowed = GH_ALLOWED[group.text]
  if (!allowed) return `gh ${group.text} is not allowed here.`
  if (allowed !== 'any' && (!verb || !allowed.has(verb.text))) {
    if (verb?.text === 'merge') return 'Merging is the founder\'s, never a Controller\'s.'
    if (group.text === 'issue' && (verb?.text === 'delete' || verb?.text === 'transfer')) return `gh issue ${verb.text} is not allowed here: it cannot be undone from this repo.`
    if (group.text === 'auth') return 'gh auth is read-only here (status): switching or logging in changes the account every session on this Mac uses.'
    return `gh ${group.text} ${verb?.text ?? ''} is not allowed here.`
  }
  if (verb && !GH_READ_VERBS.has(verb.text)) {
    if (rest.some(w => w.text.startsWith('--delete-last'))) return `gh ${group.text} ${verb.text} --delete-last is not allowed here: a deleted comment cannot be restored.`
    const at = rest.indexOf(verb)
    for (let i = at + 1; i < rest.length; i++) {
      const w = rest[i] as Word
      if (w.text.startsWith('-')) {
        if (GH_VALUED.has(w.text)) i++
        continue
      }
      if (w.dynamic || w.glob || !GH_ITEM.test(w.text)) return `gh ${group.text} ${verb.text} names its PR or issue by number or branch here, never by URL: a URL can name another repo.`
    }
  }
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

/** The `cd <dir> &&` run directly before a command: only that pins it (anything else may not have run, or ran in a subshell). */
function cdChain(commands: Simple[], index: number): Word[] {
  const chain: Word[] = []
  for (let k = index - 1; k >= 0; k--) {
    const prev = commands[k] as Simple
    const { head: h, rest: r } = headOf(prev)
    if (prev.sep !== '&&' || !h || h.text !== 'cd' || r.length !== 1) break
    chain.unshift(r[0] as Word)
  }
  return chain
}

/** True when a cd in a git call's pin chain names a relative path CDPATH can resolve elsewhere (one not led by `.` or `..`). */
function pinFollowsCdpath(commands: Simple[], index: number): boolean {
  const { rest } = headOf(commands[index] as Simple)
  if (rest.some(w => w.text === '-C')) return false
  return cdChain(commands, index).some(w => !w.text.startsWith('/') && !/^\.\.?(\/|$)/.test(w.text))
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
  let dir: string | undefined
  for (const to of cdChain(commands, index)) {
    if (to.dynamic || to.glob || to.text.startsWith('-')) return undefined
    if (to.text.startsWith('/')) dir = foldPath(to.text)
    else if (dir) dir = foldPath(`${dir}/${to.text}`)
    else return undefined
  }
  return dir
}

/** The words that pin a git call: its `-C` value, else the `cd` chain run directly before it. */
function pinWords(commands: Simple[], index: number): Word[] {
  const { rest } = headOf(commands[index] as Simple)
  const c = rest.findIndex(w => w.text === '-C')
  return c >= 0 ? rest.slice(c + 1, c + 2) : cdChain(commands, index)
}

/** True when a git call's subcommand, past its global options, is a literal `clone`. */
function isClone(rest: Word[]): boolean {
  const { at, refusal } = gitGlobals(rest)
  const sub = rest[at]
  return refusal === undefined && sub !== undefined && !sub.dynamic && !sub.glob && sub.text === 'clone'
}

/** The refusal for a shell command run by a fleet role, if any. */
export function shellRefusal(role: Role, command: string, protectedBranches: string[], scopeDir?: string, clone?: CloneScope): string | undefined {
  if (APP_HOME.test(command)) return APP_HOME_REFUSAL
  if (/_command\/fleet\b/.test(normalisePath(command)) || /\.claude[^/\s]*\/projects\b/.test(command)) return 'The fleet folder and Claude session transcripts are Flight\'s: fleet agents do not read them.'
  const parsed = tokenize(command)
  if (parsed.commands.some(s => [...s.words, ...s.redirects].some(w => APP_HOME.test(w.text)))) return APP_HOME_REFUSAL
  // The Bash tool's shell is zsh: its $=X, $^X, ${=X} and =cmd expand to words the guard would read as text.
  // A quote-spelled name (g''it) runs git with no literal "git" in the text, so gate on the parsed head too.
  const runsGitGh = parsed.commands.some(s => ['git', 'gh'].includes(baseName(headOf(s).head?.text ?? ''))) || /\b(git|gh)\b/i.test(command)
  if (!parsed.opaque && parsed.unread.length && runsGitGh) {
    const names = [...new Set(parsed.unread)]
    return `${names.join(', ')} ${names.length > 1 ? 'are shell expansions' : 'is a shell expansion'} the guard cannot read: on a line that runs git or gh, write the value literally, in single quotes, or as a plain $NAME or \${NAME}.`
  }
  // A heredoc read by an interpreter is a program: its words are checked like the command line's.
  if (parsed.bodies.length && parsed.commands.some(s => INTERPRETER.test(baseName(headOf(s).head?.text ?? '')))) {
    for (const body of parsed.bodies) {
      if (APP_HOME.test(body) || tokenize(body).commands.some(s => [...s.words, ...s.redirects].some(w => APP_HOME.test(w.text)))) return APP_HOME_REFUSAL
    }
  }
  if (parsed.opaque) return 'Commands run plainly here: no $(...), backticks, <(...), heredocs that expand, or a heredoc delimiter other than one plain word, bare or wholly quoted (a commit message may use $(cat <<\'EOF\' ... EOF)).'
  const rawMentionsGit = /\b(git|gh)\b/i.test(command)
  const scanned: string[] = []
  for (const s of parsed.commands) {
    const { head, rest } = headOf(s)
    const name = baseName(head?.text ?? '')
    const isCommit = name === 'git' && rest.some(w => w.text === 'commit')
    if (!isCommit) scanned.push(...s.words.map(w => w.text), ...s.redirects.map(w => w.text))
    else scanned.push(...s.redirects.map(w => w.text))
    // A heredoc value is checked by what it holds, except in git and gh, where it stands only as a message.
    if (name !== 'git' && name !== 'gh') scanned.push(...[...s.words, ...s.redirects].flatMap(w => w.body ?? []))
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
    if (s.redirects.some(w => w.heredoc)) return 'A $(cat <<\'EOF\' ... EOF) value never names a redirect target here: write the path itself.'
    // Assignments standing alone last for the rest of the line, and before a command they reach what it
    // runs (CDPATH before cd). Before git or gh any prefix is refused below, with its own reason.
    const prefixed = head !== undefined && ['git', 'gh'].includes(baseName(head.text))
    if (rawMentionsGit && !prefixed && (head ? s.words.slice(0, s.words.indexOf(head)) : s.words).some(w => GIT_LEVER.test(w.text))) return LEVER_REFUSAL
    if (!head) continue
    if (head.dynamic || head.glob) return 'Commands run plainly here: never a command name built from a variable, glob or brace.'
    if (/\s/.test(head.text)) return 'A command name with spaces in it (env -S and the like) is not allowed here.'
    const name = baseName(head.text)
    const argsNameGit = rest.some(w => /\b(git|gh)\b/i.test(w.text))
    if (argsNameGit && !['git', 'gh'].includes(name) && !TEXT_ONLY.has(name)) return `git and gh run only at the head of a command, not through ${name}.`
    // The same for a heredoc value, whose words the checks above cannot see (find -exec, xargs or eval of one).
    if (rawMentionsGit && !['git', 'gh'].includes(name) && !TEXT_ONLY.has(name) && rest.some(w => w.heredoc)) {
      return `On a line that names git or gh, a $(cat <<'EOF' ... EOF) value stands only as a git or gh message or as text to print, never as an argument of ${name}.`
    }
    if (rawMentionsGit && (name === 'source' || name === '.')) return `On a line that names git or gh, ${name} does not run: the file it reads can set variables that redirect git. Run it as a separate command.`
    if (rawMentionsGit && (name === 'xargs' || name === 'eval' || name === 'exec') && rest.some(w => INTERPRETER.test(baseName(w.text)) || /\b(git|gh)\b/i.test(w.text))) {
      return `git and gh run only as plain commands, never through ${name}.`
    }
    // Fail closed: on a line that names git or gh, no interpreter runs at all (a pipe, heredoc, -c, /dev/stdin or option can feed it a program).
    if (['export', 'declare', 'typeset', 'set', 'setenv'].includes(name) && rest.some(w => /^(GH_|GIT_|GITHUB_)/.test(w.text))) return 'Setting GH_*, GIT_* or GITHUB_* variables is not allowed here: they can redirect git and gh in later commands.'
    if (rawMentionsGit && SETTERS.has(name) && rest.some(w => GIT_LEVER.test(w.text) || w.dynamic)) return LEVER_REFUSAL
    if (/(127\.0\.0\.1|localhost|0\.0\.0\.0|\[::1\]):47(7[7-9]|8\d|9[0-7])\b/.test(command)) return 'The Mission Control App is the founder\'s: fleet agents never reach it.'
    if ((name === 'ps' && rest.some(w => /^[a-zA-Z]*e[a-zA-Z]*$/.test(w.text) || /^-[A-Za-z]*E/.test(w.text))) || /\/proc\/[^/\s]+\/environ/.test(command)) return 'Reading other processes\' environments is not allowed here.'
    if (name === 'claude') return 'A fleet agent never starts another Claude session: it would run without the fleet guards or budget. Use your back room (the Agent tool) instead.'
    if (rawMentionsGit && READS_STDIN.test(name)) return `git and gh run only as plain commands; ${name} on the same line is not allowed. Run it as a separate command.`
    if ((name === 'git' || name === 'gh') && s.words.slice(0, s.words.indexOf(head)).some(w => /^[A-Za-z_][A-Za-z0-9_]*\+?=/.test(w.text) || w.text === 'env')) {
      return `${name} runs here with no environment prefix (VAR=... or env): variables like GIT_SSH_COMMAND or GIT_CONFIG_PARAMETERS can redirect it.`
    }
    let pin: string | undefined
    let unpinned: string | undefined
    if (scopeDir && (name === 'git' || name === 'gh')) {
      if (name === 'gh' && rest.some(w => /^-R/.test(w.text) || /^--repo(=|$)/.test(w.text) || (/^-[A-Za-z]+$/.test(w.text) && w.text.includes('R')))) return 'gh -R/--repo is not allowed here: pin the repo with `cd <your repo> && gh ...`.'
      const dir = pinnedDir(parsed.commands, k)
      const scope = foldPath(scopeDir)
      if (!dir) return `Pin the repo on every ${name} call: \`cd ${scope} && ${name} ...\`${name === 'git' ? ` or \`git -C ${scope} ...\`` : ''}. Your shell may start in another repo.`
      // A Controller's clone may also run from a front's folder, where it lands one level down; nothing else runs there.
      const cloning = role === 'controller' && clone !== undefined && name === 'git' && isClone(rest)
      const sibling = role === 'controller' && isSiblingWorktree(dir, scope, clone)
      if (dir !== scope && !dir.startsWith(`${scope}/`) && !sibling && !(cloning && isFrontFolder(dir, clone))) return `${dir} is outside your console's directory (${scope}).`
      pin = dir
      // A clone's pin decides where it writes, and the guard reads it as text while the disk follows links (a
      // cloned repository can hold one). So it must not hang on a cd that CDPATH could resolve elsewhere, step
      // back with `..`, or sit inside a folder a clone may run from rather than be that folder exactly.
      if (cloning) {
        if (pinFollowsCdpath(parsed.commands, k)) unpinned = ''
        else if (pinWords(parsed.commands, k).some(w => w.text.split('/').includes('..'))) unpinned = 'its cd or -C path holds .., which a link could carry elsewhere; '
        else if (dir !== scope && !isFrontFolder(dir, clone)) unpinned = `it runs from ${dir}, a folder inside one a clone may run from, where a link could carry it elsewhere; `
        if (unpinned !== undefined) pin = undefined
      }
    }
    if (name === 'git') {
      const why = gitRefusal(role, rest, protectedBranches, pin, clone, unpinned)
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
export function toolRefusal(role: Role, tool: string, input: unknown, protectedBranches: string[], scopeDir?: string, clone?: CloneScope): string | undefined {
  if (tool === 'Workflow') return 'Workflows are Flight\'s to run; a Controller dispatches its back room with the Agent tool.'
  if (isShellLikeTool(tool)) return `${tool} runs shell commands the fleet guard cannot read; use Bash.`
  const args = (input ?? {}) as Record<string, unknown>
  if (typeof args.command === 'string') {
    const why = shellRefusal(role, args.command, protectedBranches, scopeDir, clone)
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
 * cannot judge a call a plugin raised. A send qualifies only to a staffed console, so the fleet
 * never wakes a Controller it stood down. Anything else returns undefined and is decided as usual.
 */
export function fleetSelfApproval(tool: string, input: unknown, seats: FleetSeat[]): string | undefined {
  const i = (input ?? {}) as Record<string, unknown>
  if (tool === 'SendMessage') {
    const to = i.to
    if (typeof to !== 'string' || to === '') return undefined
    return seats.find(s => s.agentId !== '' && s.agentId === to && s.status === 'staffed')?.callSign
  }
  if (tool === 'Agent') {
    if (i.subagent_type !== 'mission-fleet:controller' || typeof i.name !== 'string') return undefined
    return seats.find(s => s.status === 'staffing' && s.agentId === '' && s.name === i.name)?.callSign
  }
  return undefined
}

/** Console verbs that message or start an agent. From the app they run through Flight, never from the app's own loop. */
const RELAYED = new Set(['staff', 'call', 'go', 'nogo', 'no-go', 'decide', 'retry', 'dismiss', 'stand-down'])
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

/** A poll decision the app sent to Flight, still inside its code's lifetime: not open for another tap. */
export function awaitingFlight(sentAt: string | undefined, now: number): boolean {
  const at = sentAt ? Date.parse(sentAt) : NaN
  return Number.isFinite(at) && now - at <= RELAY_TTL
}

/** Console verbs that answer an open poll item: decide <id> <n>, and go or no-go for a blocked line or an advisory. */
const CHOICE = new Set(['decide', 'go', 'nogo', 'no-go'])
export function isChoiceVerb(args: string): boolean {
  return CHOICE.has((args.trim().split(/\s+/)[0] ?? '').toLowerCase())
}

/**
 * The poll item an app op holds while Flight runs it: an open item that is asked (not a to-do) for an
 * answer, an undelivered decision for retry. Undefined for any other op or item. A retry takes no
 * second tap while held; a later answer replaces the earlier one (dropRelayCodes).
 */
export function relayHold(args: string, items: readonly PollItem[]): PollItem | undefined {
  const [verb = '', id = ''] = args.trim().split(/\s+/)
  const item = items.filter(p => p.id.toLowerCase() === id.toLowerCase()).at(-1)
  if (!item) return undefined
  if (verb.toLowerCase() === 'retry') return isUndelivered(item) ? item : undefined
  return isChoiceVerb(verb) && item.state === 'open' && item.kind !== 'todo' ? item : undefined
}

/**
 * Drops the codes minted for earlier answers on one poll item, so only the newest answer the app
 * sent can run. Returns how many were dropped. Codes for any other item or verb are kept.
 */
export function dropRelayCodes(codes: RelayCodes, id: string): number {
  let n = 0
  for (const [code, minted] of codes) {
    const [verb = '', target = ''] = minted.args.trim().split(/\s+/)
    if (isChoiceVerb(verb) && target.toLowerCase() === id.toLowerCase()) {
      codes.delete(code)
      n++
    }
  }
  return n
}
