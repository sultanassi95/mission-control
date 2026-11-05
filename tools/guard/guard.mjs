#!/usr/bin/env node
// PreToolUse hook on Bash, shipped in .claude/settings.json and run in every session. A command that
// pushes to a base or deploy branch is put to the founder as a permission prompt (permissionDecision
// "ask"); the founder's yes is the explicit request. Every other command, every other git command
// included, exits 0 untouched. The guard fails toward asking: a command it cannot read that names git
// and push asks, and an internal error on such a command asks instead of passing silently.
import { readFileSync } from 'node:fs'
import { pushConcern } from './push.mjs'
import { currentBranch, extraProtected, pushAliases, upstreamBranch } from './spokes.mjs'

const ask = reason => {
  process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: reason } })}\n`)
  process.exit(0)
}
let payload = {}
try {
  payload = JSON.parse(readFileSync(0, 'utf8'))
} catch {
  process.exit(0)
}
const command = payload?.tool_input?.command
if (payload?.tool_name !== 'Bash' || typeof command !== 'string') process.exit(0)
try {
  const reason = pushConcern(command, { cwd: payload.cwd || process.cwd(), protected: extraProtected, currentBranch, upstreamBranch, pushAliases })
  if (reason) ask(reason)
} catch (err) {
  if (/push/i.test(command)) ask(`The push guard hit an error reading this command (${String(err?.message ?? err).slice(0, 100)}), and it names push.`)
}
process.exit(0)
