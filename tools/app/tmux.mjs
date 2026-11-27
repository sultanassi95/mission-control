// The one way into a running session: the tmux pane it runs in. Imported by server.mjs and tools/console.
// Every call is an argv array handed to tmux directly, never a shell string, so text a person typed
// cannot become a command. A target is {pane, socket}: the pane id and the path of the tmux server's
// socket, both recorded by the session hook from $TMUX_PANE and $TMUX.
import { execFile } from 'node:child_process'

import { statSync } from 'node:fs'
import { isAbsolute } from 'node:path'

const BIN = process.env.MCAPP_TMUX || 'tmux'
export const PANE = /^%[0-9]+$/
export const MAX_TEXT = 8000
let seq = 0

/** A socket path tmux may be asked to use: absolute, an existing socket, owned by this user. '' means the default server. */
export function socketOk(path) {
  if (!path) return true
  try {
    const st = statSync(path)
    return isAbsolute(path) && st.isSocket() && st.uid === process.getuid()
  } catch {
    return false
  }
}

export function tmux(args, { timeout = 5000, socket = '' } = {}) {
  if (!socketOk(socket)) return Promise.reject(new Error('not a tmux socket'))
  return new Promise((resolve, reject) => {
    execFile(BIN, [...(socket ? ['-S', socket] : []), ...args], { timeout, encoding: 'utf8', maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => (err ? reject(Object.assign(err, { stderr })) : resolve(stdout)))
  })
}

const ppidOf = pid =>
  new Promise(resolve => execFile('ps', ['-o', 'ppid=', '-p', String(pid)], { encoding: 'utf8', timeout: 2000 }, (err, out) => resolve(err ? 0 : Number(out.trim()) || 0)))

/**
 * Whether the pane exists AND the session's process runs in it: the registry's pid is the pane's own
 * process or one of its descendants. A pane id outlives its session (a tmux restart reuses %0), and
 * must never aim the phone at whatever shell holds that id now.
 */
export async function paneAlive({ pane, socket, pid }) {
  if (!PANE.test(pane)) return false
  try {
    const out = await tmux(['list-panes', '-a', '-F', '#{pane_id} #{pane_pid}'], { socket })
    const row = out.split('\n').map(l => l.split(' ')).find(r => r[0] === pane)
    if (!row) return false
    const root = Number(row[1])
    let at = Number(pid)
    for (let i = 0; i < 12 && at > 1; i++) {
      if (at === root) return true
      at = await ppidOf(at)
    }
    return false
  } catch {
    return false
  }
}

/**
 * Types text into the session's input and presses Enter. The text goes in as one bracketed paste, so
 * quotes, $(...), semicolons and newlines arrive as typed characters and a newline does not submit early.
 */
export async function sendText({ pane, socket }, text) {
  if (!PANE.test(pane)) throw new Error('not a tmux pane')
  if (typeof text !== 'string' || text.length === 0 || text.length > MAX_TEXT) throw new Error('text must be 1 to 8000 characters')
  // A buffer of its own per call: two sends at once must not paste each other's text.
  const buf = `mcapp-${process.pid}-${++seq}-${Math.random().toString(36).slice(2, 8)}`
  // Controls other than newline and tab never go in: an escape sequence could end the bracketed paste early and run as keystrokes.
  text = text.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
  if (text.trim() === '') throw new Error('text must hold something to type')
  await tmux(['set-buffer', '-b', buf, '--', text], { socket })
  await tmux(['paste-buffer', '-p', '-d', '-b', buf, '-t', pane], { socket })
  // Claude Code needs a beat to take a paste before Enter submits it rather than joins it.
  await new Promise(r => setTimeout(r, 150))
  await tmux(['send-keys', '-t', pane, 'Enter'], { socket })
}

const KEYS = new Set(['1', '2', '3', '4', '5', '6', '7', '8', '9', 'Escape', 'Enter', 'Up', 'Down'])
/** Presses one key from a short allow-list: a menu's number, or Escape, Enter, Up, Down. */
export async function sendKey({ pane, socket }, key) {
  if (!PANE.test(pane)) throw new Error('not a tmux pane')
  if (!KEYS.has(key)) throw new Error('key not allowed')
  await tmux(['send-keys', '-t', pane, key], { socket })
}

/** The visible screen of the pane as text. */
export const capture = ({ pane, socket }) => (PANE.test(pane) ? tmux(['capture-pane', '-p', '-J', '-t', pane], { socket }) : Promise.reject(new Error('not a tmux pane')))

/**
 * The menu a session is showing, read from its screen: the question above a numbered list, with the
 * option the cursor is on. null when no numbered menu is on screen.
 */
export function menuOf(screen) {
  const lines = String(screen).split('\n').map(l => l.replace(/\s+$/, ''))
  const opt = /^\s*(❯|>)?\s*([1-9])\.\s+(\S.*)$/
  let end = -1
  for (let i = lines.length - 1; i >= 0; i--) {
    if (opt.test(lines[i])) {
      end = i
      break
    }
  }
  if (end < 0) return null
  let start = end
  while (start > 0 && (opt.test(lines[start - 1]) || (lines[start - 1].trim() === '' && opt.test(lines[start - 2] ?? '')) || /^\s{3,}\S/.test(lines[start - 1]) && opt.test(lines[start - 2] ?? ''))) start--
  const options = []
  let selected = ''
  for (let i = start; i <= end; i++) {
    const m = opt.exec(lines[i])
    if (!m) continue
    options.push({ key: m[2], label: m[3].trim() })
    if (m[1]) selected = m[2]
  }
  // A numbered list is a menu only with the cursor on one option: a plain list in a reply has none.
  if (options.length < 2 || !selected) return null
  let q = start - 1
  while (q >= 0 && lines[q].trim() === '') q--
  const question = q >= 0 ? lines[q].replace(/^[\s│╭╰─]+|[\s│╮╯─]+$/g, '') : ''
  return { question, options, selected }
}
