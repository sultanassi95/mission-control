import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AuditEntry, Console } from '../types'

const consoles = atom({ plugin: 'mission-fleet', key: 'consoles' } as const, [] as Console[])
const audit = atom({ plugin: 'mission-fleet', key: 'audit' } as const, [] as AuditEntry[])

const TOOL = 'console'
const MODELS = new Set(['haiku', 'sonnet', 'opus', 'fable'])
const FRONT = /^[a-z0-9][a-z0-9_-]{0,63}$/i

const USAGE = [
  'Usage:',
  '  /console staff <front> [--cwd <dir>] [--model haiku|sonnet|opus|fable]',
  '  /console list',
  '  /console call <call-sign> <message>',
  '  /console stand-down <call-sign>',
].join('\n')

const callSignOf = (front: string) => front.toUpperCase().replace(/[^A-Z0-9]+/g, '-')
const nameOf = (front: string) => `console-${front.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`

export type Parsed = { verb: string; rest: string[]; flags: Record<string, string>; error?: string }

export function parseArgs(args: string): Parsed {
  const words = args.trim().split(/\s+/).filter(Boolean)
  const flags: Record<string, string> = {}
  const rest: string[] = []
  for (let i = 0; i < words.length; i++) {
    const w = words[i] ?? ''
    if (!w.startsWith('--')) {
      rest.push(w)
      continue
    }
    const value = words[i + 1]
    if (value === undefined || value.startsWith('--')) return { verb: '', rest: [], flags: {}, error: `${w} needs a value.` }
    flags[w.slice(2)] = value
    i++
  }
  return { verb: rest.shift() ?? '', rest, flags }
}

export function controllerBrief(front: string, callSign: string): string {
  return [
    `You are the Controller staffed on the ${callSign} console. You own the "${front}" front of this portfolio until Flight stands you down.`,
    `Start cold from the front's own files: _command/portfolio/${front}/_front.md (hub), its spoke(s), and progress.md. Read them before acting.`,
    'Use any skill, plugin or MCP the session has. You may dispatch your own sub-agents (your back room).',
    'Every report you send back is a status check in exactly four lines:',
    'state: <one line>',
    'shipped: <one line, or nothing>',
    'blocked on you: <one line, or nothing>',
    'next: <one line>',
    'Then go idle and wait for Flight to call you again. Do not merge anything, ever.',
    'First task: read the hub and report your first status check.',
  ].join('\n')
}

async function log($: EngineInterface, op: string, target: string, result: string) {
  await update($, audit, list => [...list, { at: new Date().toISOString(), op, target, result }].slice(-500))
}

const FAILED = 'The console command failed partway. /console list shows what the fleet holds now.'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'console',
      description: 'Staff, list, call or stand down a front Controller (Flight\'s console fleet)',
    })
    await $.tool.register({
      name: TOOL,
      description: `Flight's console fleet. Pass the same arguments as the /console command.\n${USAGE}`,
      inputSchema: { type: 'object', properties: { args: { type: 'string', description: 'e.g. "staff fieldkit --model sonnet"' } }, required: ['args'] },
      isDeferred: false,
    })
    return next(e)
  })

  on('command.run', { command: 'console' }, async ($, e) => ({ text: await runConsole($, e.args) }))
    .catch(() => ({ text: FAILED }))

  on('tool.call', { tool: /^mcp__mission-fleet__console$/ }, async ($, e) => {
    if (e.agentId) return { result: 'Only Flight runs the console tool; a Controller reports to Flight instead.', isError: true }
    const args = typeof (e as { args?: unknown }).args === 'string' ? (e as { args: string }).args : ''
    return { result: await runConsole($, args) }
  }).catch(() => ({ result: FAILED, isError: true }))
}

async function runConsole($: EngineInterface, args: string): Promise<string> {
  const { verb, rest, flags, error } = parseArgs(args)
  if (error) return `${error}\n${USAGE}`

  if (verb === 'staff') return staff($, rest[0], flags)

  const fleet = await read($, consoles)

  if (verb === 'list') {
    if (fleet.length === 0) return 'No consoles staffed. /console staff <front> starts one.'
    const agents = await $.agent.list()
    return fleet
      .map(c => {
        const a = agents.find(x => x.id === c.agentId)
        const state = c.status === 'staffed' ? (a?.status ?? 'unknown') : c.status
        return `${c.callSign.padEnd(14)} ${state}  ${c.model}  ${c.front}  agent ${c.agentId}`
      })
      .join('\n')
  }

  if (verb === 'call') {
    const [sign, ...words] = rest
    const c = fleet.find(x => x.callSign === callSignOf(sign ?? '') && x.status === 'staffed')
    if (!c) return `No staffed console ${sign ?? ''}. /console list shows the fleet.`
    if (words.length === 0) return USAGE
    const sent = await $.session.send({ to: { agentId: c.agentId }, text: words.join(' ') })
    await log($, 'call', c.callSign, sent.isDelivered ? 'delivered' : `refused: ${sent.reason}`)
    return sent.isDelivered ? `Called ${c.callSign}. Its answer arrives as a status check.` : `Call to ${c.callSign} not delivered: ${sent.reason}`
  }

  if (verb === 'stand-down') {
    const c = fleet.find(x => x.callSign === callSignOf(rest[0] ?? '') && x.status === 'staffed')
    if (!c) return `No staffed console ${rest[0] ?? ''}.`
    const sent = await $.session.send({
      to: { agentId: c.agentId },
      text: `Stand down. Append a dated handoff (state, open work, next) to the "${c.front}" front's progress.md, report it in your four lines, and end.`,
    })
    if (!sent.isDelivered) {
      await log($, 'stand-down', c.callSign, `refused: ${sent.reason}`)
      return `Stand-down to ${c.callSign} not delivered: ${sent.reason}. It is still listed as staffed.`
    }
    await update($, consoles, list => list.map(x => (x.callSign === c.callSign ? { ...x, status: 'stood-down' as const } : x)))
    await log($, 'stand-down', c.callSign, 'handoff requested')
    return `${c.callSign}: handoff requested; it stands down once the handoff is written.`
  }

  return USAGE
}

async function staff($: EngineInterface, front: string | undefined, flags: Record<string, string>): Promise<string> {
  if (!front) return USAGE
  if (!FRONT.test(front)) return `"${front}" is not a front name (letters, digits, - and _ only).`
  if (flags.model && !MODELS.has(flags.model)) return `--model must be one of haiku, sonnet, opus, fable.`
  const callSign = callSignOf(front)
  const name = nameOf(front)

  // Reserve the call sign inside the state write, so two overlapping staff calls cannot both spawn.
  let holder: Console | undefined
  await update($, consoles, list => {
    holder = list.find(c => c.callSign === callSign && (c.status === 'staffed' || c.status === 'staffing'))
    if (holder) return list
    const reserved: Console = {
      callSign, front, name, agentId: '', cwd: flags.cwd ?? '.', model: flags.model ?? 'default',
      staffedAt: new Date().toISOString(), status: 'staffing',
    }
    return [...list.filter(c => c.callSign !== callSign), reserved]
  })
  if (holder) return `${callSign} is already ${holder.status} (agent ${holder.agentId || 'starting'}). Use /console call ${callSign} <message>.`

  const release = () => update($, consoles, list => list.filter(c => !(c.callSign === callSign && c.status === 'staffing')))
  let spawned: Awaited<ReturnType<EngineInterface['agent']['spawn']>>
  try {
    spawned = await $.agent.spawn({
      prompt: controllerBrief(front, callSign),
      description: `${callSign} console`,
      subagentType: 'general-purpose',
      name,
      ...(flags.model ? { model: flags.model } : {}),
      ...(flags.cwd ? { cwd: flags.cwd } : {}),
    })
  } catch (err) {
    await release()
    throw err
  }
  if (spawned.deny !== undefined || !spawned.agentId) {
    const why = spawned.deny ?? 'no agent id returned'
    await release()
    await log($, 'staff', callSign, `denied: ${why}`)
    return `Could not staff ${callSign}: ${why}`
  }

  const agentId = spawned.agentId
  await update($, consoles, list =>
    list.map(c => (c.callSign === callSign && c.status === 'staffing' ? { ...c, agentId, model: spawned.model, status: 'staffed' as const } : c)),
  )
  await log($, 'staff', callSign, `agent ${agentId} on ${spawned.model}`)
  return `${callSign} staffed as ${name} (agent ${agentId}, ${spawned.model}). Its first status check arrives when it finishes reading the hub.`
}
