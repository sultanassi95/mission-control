#!/usr/bin/env node
// Shares one file on this Mac with the Mission Control App, so it opens from the phone over the
// tailnet; nothing is shared by default. Run from the portfolio's root (the /share skill does):
//   node tools/app/share.mjs <absolute path>      share it and print its link
//   node tools/app/share.mjs --list               print every shared file
//   node tools/app/share.mjs --revoke <path>      stop sharing it
// The list is the instance's own state, beside the app's state file, never in the repository;
// MCAPP_SHARE_FILE names another list (tests).
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { canonical, readShares, shareable, writeShares } from './files.mjs'

// The portfolio root: the nearest folder up from here holding the instance folder.
function portfolioRoot(start) {
  for (let dir = resolve(start); ; dir = dirname(dir)) {
    if (existsSync(join(dir, '_command'))) return dir
    if (dirname(dir) === dir) return ''
  }
}

const listFile = process.env.MCAPP_SHARE_FILE || (portfolioRoot(process.cwd()) ? join(portfolioRoot(process.cwd()), '_command', 'fleet', 'shared-files.json') : '')
const fail = msg => {
  process.stderr.write(`${msg}\n`)
  process.exit(1)
}
if (!listFile) fail('No portfolio found from this folder: run /share from the portfolio, or set MCAPP_SHARE_FILE.')

// The tailnet link: this Mac's name, as tailscale serve publishes the app; the local one when Tailscale is absent.
function linkFor(real) {
  const view = `/view.html#${encodeURIComponent(real)}`
  try {
    const app = '/Applications/Tailscale.app/Contents/MacOS/Tailscale'
    const st = JSON.parse(execFileSync(existsSync(app) ? app : 'tailscale', ['status', '--json'], { encoding: 'utf8', timeout: 5000 }))
    const host = String(st.Self?.DNSName ?? '').replace(/\.$/, '')
    if (host) return `https://${host}${view}`
  } catch {}
  return `http://127.0.0.1:4777${view} (Tailscale is not running here, so this is the Mac's own link)`
}

const [first, second] = process.argv.slice(2)
const files = readShares(listFile)
if (!first) fail('Usage: /share <absolute path> | --list | --revoke <path>')

if (first === '--list') {
  if (!files.length) process.stdout.write('Nothing is shared.\n')
  for (const f of files) process.stdout.write(`${f.path}  (shared ${f.at})\n`)
  process.exit(0)
}

if (first === '--revoke') {
  if (!second) fail('Usage: /share --revoke <path>')
  // Matched by the path as the disk spells it, so a file that is gone, or named in another case or
  // through a symlinked folder, is still found.
  const target = canonical(second)
  const kept = files.filter(f => f.path !== target && f.path !== second)
  if (kept.length === files.length) fail(`${second} is not on the share list. Shared now:\n${files.map(f => `  ${f.path}`).join('\n') || '  nothing'}`)
  writeShares(listFile, kept)
  process.stdout.write(`No longer shared: ${second}\n`)
  process.exit(0)
}

const got = shareable(first)
if (!got.real) fail(`Not shared: ${got.reason}.`)
if (!files.some(f => f.path === got.real)) writeShares(listFile, [...files, { path: got.real, at: new Date().toISOString() }])
process.stdout.write(`Shared: ${got.real}\n${linkFor(got.real)}\n`)
