import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AuditEntry, Console } from '../types'

import { commonDir, CONTROLLER_PROMPT, CONTROLLER_TYPE, DEFAULT_BUDGET, EFFORTS, isInsideRelative, MODEL_IDS, spokePath, staffingOrder } from './controller'

const consoles = atom({ plugin: 'mission-fleet', key: 'consoles' } as const, [] as Console[])
const audit = atom({ plugin: 'mission-fleet', key: 'audit' } as const, [] as AuditEntry[])

const TOOL = 'console'
const FRONT = /^[a-z0-9][a-z0-9_-]{0,63}$/i

const USAGE = [
  'Usage:',
  '  /console staff <front> [--project <p>] [--model haiku|sonnet|opus|fable] [--effort low|medium|high|xhigh|max] [--budget <n>] [--cwd <dir>]',
  '  /console retune <call-sign> <model|-> [<effort>]',
  '  /console list',
  '  /console call <call-sign> <message>',
  '  /console stand-down <call-sign>      (writes a dated handoff to the front\'s progress.md)',
  '  /console dismiss <call-sign>         (ends it with nothing written: a test, or no work done)',
].join('\n')

const callSignOf = (scope: string) => scope.toUpperCase().replace(/[^A-Z0-9]+/g, '-')
const nameOf = (scope: string) => `console-${scope.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
const NOT_SPOKES = new Set(['_front.md', 'progress.md', 'deviations.md', '_map.md', 'scripts.md', 'DESIGN.md'])

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
    await $.agent.register({
      name: CONTROLLER_TYPE,
      description: 'A front or project Controller. Staff it only through the mission-fleet console tool (/console staff), never with a direct Agent call.',
      prompt: CONTROLLER_PROMPT,
      background: true,
      autoCompactWindow: 400000,
    })
    await $.tool.register({
      name: TOOL,
      description: `Flight's console fleet. Pass the same arguments as the /console command.\n${USAGE}`,
      inputSchema: { type: 'object', properties: { args: { type: 'string', description: 'e.g. "staff fieldkit --model sonnet"' } }, required: ['args'] },
      isDeferred: false,
    })
    return next(e)
  })

  // Retune: rewrite a tuned Controller's model and effort on every request it sends.
  on('turn.step', async function* ($, e, next) {
    const c = e.agentId ? await tunedConsole($, e.agentId) : undefined
    if (!c?.tune) return yield* next(e)
    const step = { ...e, ...(c.tune.model ? { model: c.tune.model } : {}), ...(c.tune.effort ? { effort: c.tune.effort as typeof e.effort } : {}) }
    await markApplied($, c, `${step.model} ${step.effort ?? 'default'}`)
    return yield* next(step)
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
        const ran = c.applied ? `ran ${c.applied}` : c.model
        return `${c.callSign.padEnd(14)} ${state}  ${ran}  ${a?.type ?? '-'}  ${c.project ? `${c.front}/${c.project}` : c.front}  agent ${c.agentId}`
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

  if (verb === 'retune') {
    const [sign, model, effort] = rest
    const c = fleet.find(x => x.callSign === callSignOf(sign ?? '') && x.status === 'staffed')
    if (!c) return `No staffed console ${sign ?? ''}. /console list shows the fleet.`
    if (!model || (model !== '-' && !(model in MODEL_IDS))) return `retune needs a model (haiku, sonnet, opus, fable, or - to keep it) and optionally an effort.\n${USAGE}`
    if (effort !== undefined && !(EFFORTS as readonly string[]).includes(effort)) return `effort must be one of ${EFFORTS.join(', ')}.`
    const tune = {
      ...(model === '-' ? (c.tune?.model ? { model: c.tune.model } : {}) : { model: MODEL_IDS[model] }),
      ...(effort ? { effort } : c.tune?.effort ? { effort: c.tune.effort } : {}),
    }
    await update($, consoles, list => list.map(x => (x.callSign === c.callSign ? { ...x, tune } : x)))
    const label = `${tune.model ?? 'its model'} ${tune.effort ?? 'its effort'}`
    await log($, 'retune', c.callSign, label)
    return `${c.callSign} retuned to ${label}, from its next model request. /console list shows what its last request ran on.`
  }

  if (verb === 'stand-down' || verb === 'dismiss') {
    const c = fleet.find(x => x.callSign === callSignOf(rest[0] ?? '') && x.status === 'staffed')
    if (!c) return `No staffed console ${rest[0] ?? ''}.`
    const text = verb === 'dismiss'
      ? 'Dismissed by Flight: stop now. Write nothing to any file, make no git calls, and reply with one line: dismissed.'
      : `Stand down. Append a dated handoff (state, open work, next) to the "${c.front}" front's progress.md, report it in your four lines, and end.`
    const sent = await $.session.send({ to: { agentId: c.agentId }, text })
    if (!sent.isDelivered) {
      await log($, verb, c.callSign, `refused: ${sent.reason}`)
      return `${verb === 'dismiss' ? 'Dismissal' : 'Stand-down'} to ${c.callSign} not delivered: ${sent.reason}. It is still listed as staffed.`
    }
    await update($, consoles, list => list.map(x => (x.callSign === c.callSign ? { ...x, status: 'stood-down' as const } : x)))
    await log($, verb, c.callSign, verb === 'dismiss' ? 'dismissed, nothing written' : 'handoff requested')
    return verb === 'dismiss' ? `${c.callSign} dismissed; nothing is written.` : `${c.callSign}: handoff requested; it stands down once the handoff is written.`
  }

  return USAGE
}

async function tunedConsole($: EngineInterface, agentId: string): Promise<Console | undefined> {
  return (await read($, consoles)).find(c => c.agentId === agentId && c.status === 'staffed')
}

async function markApplied($: EngineInterface, c: Console, applied: string) {
  if (c.applied === applied) return
  await update($, consoles, list => list.map(x => (x.agentId === c.agentId ? { ...x, applied } : x)))
}

async function findRoot($: EngineInterface): Promise<string | undefined> {
  let dir = await $.session.root()
  for (let i = 0; i < 8 && dir; i++) {
    try {
      await $.fs.read(`${dir}/_command/trackers/fronts.md`)
      return dir
    } catch {
      const up = dir.replace(/\/[^/]+$/, '')
      if (up === dir) break
      dir = up
    }
  }
  return undefined
}

async function spokesOf($: EngineInterface, frontDir: string, project: string | undefined): Promise<{ file: string; path: string }[]> {
  // A spoke is <front>/<name>.md (single-project) or <front>/<project>/<project>.md (multi-project).
  const candidates: string[] = []
  if (project) candidates.push(`${frontDir}/${project}/${project}.md`, `${frontDir}/${project}.md`)
  else {
    const entries = await $.fs.list(frontDir).catch(() => [])
    for (const e of entries) {
      if (e.kind === 'file' && e.name.endsWith('.md') && !NOT_SPOKES.has(e.name)) candidates.push(`${frontDir}/${e.name}`)
      if (e.kind === 'dir' && !e.name.startsWith('.') && e.name !== 'tasks') candidates.push(`${frontDir}/${e.name}/${e.name}.md`)
    }
  }
  const found: { file: string; path: string }[] = []
  for (const file of candidates) {
    let path
    try {
      path = spokePath(await $.fs.read(file))
    } catch {
      continue
    }
    if (path && isInsideRelative(path)) found.push({ file, path })
    if (project && found.length) break
  }
  return found
}

async function staff($: EngineInterface, front: string | undefined, flags: Record<string, string>): Promise<string> {
  if (!front) return USAGE
  const project = flags.project
  if (!FRONT.test(front) || (project !== undefined && !FRONT.test(project))) return `"${project ?? front}" is not a front or project name (letters, digits, - and _ only).`
  if (flags.model && !(flags.model in MODEL_IDS)) return `--model must be one of haiku, sonnet, opus, fable.`
  if (flags.effort && !(EFFORTS as readonly string[]).includes(flags.effort)) return `--effort must be one of ${EFFORTS.join(', ')}.`
  const budget = flags.budget === undefined ? DEFAULT_BUDGET : /^\d{1,2}$/.test(flags.budget) ? Number(flags.budget) : NaN
  if (!(budget >= 0 && budget <= 20)) return '--budget must be a whole number from 0 to 20.'

  const root = await findRoot($)
  if (!root) return 'No portfolio found: no _command/trackers/fronts.md above this session\'s directory.'
  const frontDir = `${root}/_command/portfolio/${front}`
  const hub = `${frontDir}/_front.md`
  try {
    await $.fs.read(hub)
  } catch {
    return `No front "${front}": ${hub} does not exist.`
  }
  const spokes = await spokesOf($, frontDir, project)
  if (project && spokes.length === 0) return `No project "${project}" on front "${front}": no spoke with a path found.`
  const repoDir = commonDir(spokes.map(x => x.path))
  const cwd = flags.cwd ?? (repoDir ? `${root}/${repoDir}` : root)

  const scope = project ? `${front}-${project}` : front
  const callSign = callSignOf(scope)
  const name = nameOf(scope)

  // Reserve the call sign inside the state write, so two overlapping staff calls cannot both spawn.
  let holder: Console | undefined
  await update($, consoles, list => {
    holder = list.find(c => c.callSign === callSign && (c.status === 'staffed' || c.status === 'staffing'))
    if (holder) return list
    const reserved: Console = {
      callSign, front, ...(project ? { project } : {}), name, agentId: '', cwd, budget,
      model: flags.model ?? 'default', ...(flags.effort ? { tune: { effort: flags.effort } } : {}), staffedAt: new Date().toISOString(), status: 'staffing',
    }
    return [...list.filter(c => c.callSign !== callSign), reserved]
  })
  if (holder) return `${callSign} is already ${holder.status} (agent ${holder.agentId || 'starting'}). Use /console call ${callSign} <message>.`

  const release = () => update($, consoles, list => list.filter(c => !(c.callSign === callSign && c.status === 'staffing')))
  let spawned: Awaited<ReturnType<EngineInterface['agent']['spawn']>>
  try {
    spawned = await $.agent.spawn({
      prompt: staffingOrder({ front, ...(project ? { project } : {}), callSign, root, hub, spokes: spokes.map(x => x.file), cwd, budget }),
      description: `${callSign} console`,
      subagentType: `mission-fleet:${CONTROLLER_TYPE}`,
      name,
      cwd,
      ...(flags.model ? { model: flags.model } : {}),
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
  await log($, 'staff', callSign, `agent ${agentId} on ${spawned.model} in ${cwd}`)
  return `${callSign} staffed as ${name} (agent ${agentId}, ${spawned.model}) in ${cwd}. Its first status check arrives when it finishes reading the hub.`
}
