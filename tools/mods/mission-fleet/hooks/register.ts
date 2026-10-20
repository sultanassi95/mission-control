import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AuditEntry, Console, Lineage, LoopEntry, PendingAdvisory, PollItem, PrWatch, Reservation, Slots } from '../types'

import { commonDir, CONTROLLER_PROMPT, CONTROLLER_TYPE, DEFAULT_BUDGET, EFFORTS, isInsideRelative, MODEL_IDS, spokeField, spokePath, staffingOrder } from './controller'

const APP_PORT = 4777
const MODEL_LIST = Object.keys(MODEL_IDS).join(', ')
import { fleetSelfApproval, isRelayedVerb, protectedFromSpoke, RELAY_TTL, splitRelayCode, spendRelayCode, toolRefusal } from './guards'
import type { RelayCodes } from './guards'
import { advisoryText, answerWord, askPrompt, asSlots, decisionText, dependentsOf, isAsked, isNothing, liveSeat, matchAnswers, migratePoll, nextAsks, optionsOf, parseReport, parseStatus, placeSlots, plainReason, pollId, prSignature, prsIn } from './loops'
import type { StoredPollItem } from './loops'
import type { Role as GuardRole } from './guards'

const consoles = atom({ plugin: 'mission-fleet', key: 'consoles' } as const, [] as Console[])
const audit = atom({ plugin: 'mission-fleet', key: 'audit' } as const, [] as AuditEntry[])
const reserving = atom({ plugin: 'mission-fleet', key: 'reserving' } as const, [] as Reservation[])
const lineage = atom({ plugin: 'mission-fleet', key: 'lineage' } as const, [] as Lineage[])
const loops = atom({ plugin: 'mission-fleet', key: 'loops' } as const, [] as LoopEntry[])
const poll = atom({ plugin: 'mission-fleet', key: 'poll' } as const, [] as PollItem[])
const pending = atom({ plugin: 'mission-fleet', key: 'pending' } as const, [] as PendingAdvisory[])
const pollSeq = atom({ plugin: 'mission-fleet', key: 'pollSeq' } as const, 0)
const watches = atom({ plugin: 'mission-fleet', key: 'watches' } as const, [] as PrWatch[])
const WATCH_EVERY = 10 * 60_000
let watching = false
// The founder's /console app is a standing setting for this profile (kept in $.store across
// sessions): while it is on, every session keeps its app running, starting it at session start and
// after a plugin reload, and restarting it when the server dies. /console app stop turns it off.
const APP_ALWAYS = 'appAlways'
let supervising = false
// Each call sign's colour in the app, also kept in $.store, so a Controller keeps its colour after a
// reload and in the next session. Placings run one at a time, so two staffings cannot take one colour.
const SLOTS_KEY = 'callSignSlots'
let slotChain: Promise<unknown> = Promise.resolve()

// The app bridge: one server per session, started by /console app.
type App = { port?: number; token: string; key: string; stop: () => Promise<unknown>; stateFile: string; httpOk?: boolean; profile?: string; tokenFile?: string; ended?: Promise<void> }
let app: App | undefined
// What the app shows about Flight itself: is a turn running, is it waiting on a question at the terminal.
let flightBusy = false
let busySince = 0
// What Flight is doing right now, in a few plain words, for the app's working line.
let flightActivity = ''

/** A tool call as the app's working line says it: what, not how. */
function activityOf(e: { tool?: string } & Record<string, unknown>): string {
  const s = (v: unknown) => (typeof v === 'string' ? v : '')
  const base = (p: unknown) => s(p).split('/').pop() ?? ''
  const cut = (t: string, n = 60) => (t.length > n ? `${t.slice(0, n - 1)}…` : t)
  switch (e.tool) {
    case 'Bash': return `Running: ${cut(s(e.description) || s(e.command).split('\n')[0] || 'a command')}`
    case 'Read': return `Reading ${cut(base(e.file_path) || 'a file')}`
    case 'Edit': case 'Write': case 'NotebookEdit': return `Editing ${cut(base(e.file_path ?? e.notebook_path) || 'a file')}`
    case 'Grep': case 'Glob': return 'Searching the code'
    case 'Agent': return `Working with an agent: ${cut(s(e.description) || 'a task')}`
    case 'WebSearch': return 'Searching the web'
    case 'WebFetch': return 'Reading a web page'
    case 'Skill': return `Running /${cut(s(e.skill) || 'a skill')}`
    case 'AskUserQuestion': return 'Waiting for your answer'
    default: return (e.tool ?? '').startsWith('mcp__') ? `Using ${cut((e.tool ?? '').split('__')[1] ?? 'a tool')}` : `Using ${e.tool ?? 'a tool'}`
  }
}
let pushChain: Promise<void> = Promise.resolve()
let flightAsking: string | undefined
// A question of Flight's routed to the app while it runs: the app answers it, or /console answer at the Mac.
type AskQuestion = { question?: string; header?: string; options?: { label?: string; description?: string }[]; multiSelect?: boolean; type?: string; min?: number; max?: number; step?: number; unit?: string; placeholder?: string }
let flightAsk: { id: string; questions: AskQuestion[] } | undefined
// The headers (poll ids, lower case) of the question Flight is asking now, in the app or at the terminal.
let onScreen = new Set<string>()
// The result of the last action the app sent, so the page can say what actually happened.
let lastOp: { id: number; text: string; at: string } | undefined
// Flight's visible text per model response, as produced. The saved transcript sometimes keeps a
// response's tool call but not its text (seen 2026-10-15 around hook-refused calls); each entry
// remembers the message it followed so the app can put a lost one back in its place.
let spoken: { text: string; after: string }[] = []

const hex = (bytes: number) => Array.from(crypto.getRandomValues(new Uint8Array(bytes)), b => b.toString(16).padStart(2, '0')).join('')

// Audit-file writes run one at a time, so two hooks logging at once cannot drop a line.
let auditChain: Promise<void> = Promise.resolve()

const TOOL = 'console'
/** Origins a person typed: the prompt box, or their own Remote Control client. Anything else is not the founder. */
const PERSON_ORIGINS = new Set(['composer', 'bridge'])
const FRONT = /^[a-z0-9][a-z0-9_-]{0,63}$/i

const USAGE = [
  'Usage:',
  '  /console staff <front> [--project <p>] [--model haiku|sonnet|opus|fable] [--effort low|medium|high|xhigh|max] [--budget <n>] [--cwd <dir>]',
  '  /console retune <call-sign> <model|-> [<effort>]',
  '  /console list',
  '  /console call <call-sign> <message>',
  '  /console app [stop]                 (start or stop the local Mission Control App on 127.0.0.1)',
  '  /console stand-down <call-sign>      (writes a dated handoff to the front\'s progress.md)',
  '  /console dismiss <call-sign>         (ends it with nothing written: a test, or no work done)',
  '  /console answer <n|text>[ | <n|text>] (answers the question Flight sent to the app, from the Mac)',
  '  /console poll                       (lists the Controllers\' open questions, which Flight asks you, and their to-dos)',
  '  /console done <id>                  (checks off a to-do a Controller left for you, and tells that Controller)',
  '  /console dismiss-gate <id>          (closes a question or to-do that no longer matters; nothing is sent)',
].join('\n')

// How Flight marks a message to the founder that is about Controllers: the app reads the marker
// (tools/app/public/badge.js) and badges the message in each Controller's colour.
const MARKER_RULE = 'When a message to the founder is about one or more Controllers, open it with their call signs in bold, spelled as /console list shows them, on a line of their own and joined by a middle dot: **<CALL-SIGN>**, or **<CALL-SIGN> · <CALL-SIGN>** for several. The app badges the message with each one in its colour. Write no marker when you speak for yourself.'

const callSignOf = (scope: string) => scope.toUpperCase().replace(/[^A-Z0-9]+/g, '-')
const nameOf = (scope: string) => `console-${scope.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
const NOT_SPOKES = new Set(['_front.md', 'progress.md', 'deviations.md', '_map.md', 'scripts.md', 'DESIGN.md'])

export type Parsed = { verb: string; rest: string[]; flags: Record<string, string>; error?: string }

/**
 * A call's message is free text, taken whole: the verb, its call sign, and the rest as written
 * (trimmed, newlines kept), so a word in it that starts with two dashes reaches the Controller
 * instead of being read as a console flag.
 */
function freeText(args: string): { verb: string; target: string; text: string } | undefined {
  const m = /^\s*(call)(?:\s+(\S+))?(?:\s+([\s\S]*))?$/.exec(args)
  return m ? { verb: m[1] ?? '', target: m[2] ?? '', text: (m[3] ?? '').trim() } : undefined
}

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
  const at = new Date().toISOString()
  await update($, audit, list => [...list, { at, op, target, result }].slice(-500))
  const line = `${at}\t${op}\t${target}\t${result.replace(/\s+/g, ' ')}\n`
  auditChain = auditChain.then(() => appendAudit($, line)).catch(() => undefined)
  await auditChain
}

const AUDIT_HEADER = '# mission-fleet audit log: one line per fleet operation (time, op, target, result)\n'

async function appendAudit($: EngineInterface, line: string) {
  const root = await findRoot($)
  if (!root) return
  const file = `${root}/_command/fleet/audit.log`
  let before: string
  try {
    before = await $.fs.read(file)
  } catch (err) {
    // Seed a new file only when it is truly missing; any other read error must not overwrite history.
    if (!/ENOENT|not found|no such file|missing/i.test(String(err))) return
    before = AUDIT_HEADER
  }
  if (before.length > 1_000_000) before = AUDIT_HEADER + before.slice(before.indexOf('\n', before.length - 500_000) + 1)
  await $.fs.write(file, before + line)
}

async function addLoop($: EngineInterface, entry: Omit<LoopEntry, 'at'>) {
  await update($, loops, list => [...list, { at: new Date().toISOString(), ...entry }].slice(-300))
}

const FAILED = 'The console command failed partway. /console list shows what the fleet holds now.'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // Each step stands alone: the engine refuses /console when a user command has that name, and that must not skip the rest.
    const step = async (name: string, run: () => unknown) => {
      try {
        await run()
      } catch (err) {
        await log($, 'session.start', name, `failed: ${String(err).slice(0, 160)}`).catch(() => undefined)
        if (name !== 'command.register') try { $.ui.toast(`mission-fleet: ${name} failed at session start; see _command/fleet/audit.log`) } catch { /* no UI */ }
      }
    }
    await step('command.register', () => $.command.register({
      name: 'console',
      description: 'Staff, list, call or stand down a front Controller (Flight\'s console fleet)',
    }))
    await step('agent.register', () => $.agent.register({
      name: CONTROLLER_TYPE,
      description: 'A front or project Controller. Staff it only through the mission-fleet console tool (/console staff), never with a direct Agent call.',
      prompt: CONTROLLER_PROMPT,
      background: true,
      // No compaction window here: the engine's types declare none per agent type, only per
      // session (CLAUDE_CODE_AUTO_COMPACT_WINDOW or the settings).
    }))
    // One watch loop per module environment; a reload starts a fresh one and drops the old one's timers.
    await step('watch.start', () => {
      if (!watching) {
        watching = true
        void watchLoop($).catch((err: unknown) => {
          watching = false
          return log($, 'watch', 'loop', `stopped: ${String(err).slice(0, 120)}`)
        })
      }
    })
    // Questions stored before Flight asked them itself: an undelivered or held answer is open again.
    await step('poll.migrate', async () => {
      await migrate($)
      // Awaited inside the step, whose failure is audited: a promise left running past session start had nothing to catch it.
      await askQueue($)
    })
    await step('app.supervise', async () => {
      if ((await $.store.get(APP_ALWAYS).catch(() => false)) === true) void superviseApp($)
    })
    await step('tool.register', () => $.tool.register({
      name: TOOL,
      description: `Flight's console fleet. Pass the same arguments as the /console command.\n${USAGE}\n${MARKER_RULE}`,
      inputSchema: { type: 'object', properties: { args: { type: 'string', description: 'e.g. "staff fieldkit --model sonnet"' } }, required: ['args'] },
    }))
    return next(e)
  })

  // Flight reaches for the console tool every turn, so its schema stays in the prompt's list rather
  // than behind ToolSearch. Placement is tool.describe's answer; the register call takes none.
  on('tool.describe', { tool: `mcp__mission-fleet__${TOOL}` }, async ($, e, next) => ({ ...(await next(e)), isDeferred: false }))

  // Guards: what a Controller and its back room may run. A guard that fails denies.
  on('tool.check', async ($, e, next) => {
    // Auto mode cannot judge a call a plugin raised, so the fleet approves its own sends and spawns.
    const seat = e.tool === 'SendMessage' || e.tool === 'Agent' ? fleetSelfApproval(e.tool, e.input, await read($, consoles)) : undefined
    if (seat && (next.origin.plugin !== 'mission-fleet' || e.agentId)) {
      await log($, 'approve-miss', seat, `${e.tool} not the fleet's own: origin=${JSON.stringify(next.origin)} loop=${e.agentId ?? 'main'}`)
    } else if (seat) {
      // Rules and lower hooks still decide; only the ask the mode cannot settle becomes an allow.
      const beneath = await next(e)
      if (beneath.decision !== 'ask') {
        if (beneath.decision === 'deny') await log($, 'approve-miss', seat, `${e.tool} denied beneath the fleet: rule=${beneath.rule ?? '-'} hook=${beneath.hook ?? '-'} reason=${(beneath.reason ?? '').slice(0, 120)}`)
        return beneath
      }
      await log($, 'approve', seat, `fleet ${e.tool === 'Agent' ? 'staffing' : 'message'} approved by the fleet, not the mode`)
      return { decision: 'allow' as const }
    }
    if (!e.agentId) return next(e)
    const role = await roleOf($, e.agentId)
    if (!role) return next(e)
    const c = role.console
    // A console staffed before clones were allowed has no folder on record, so it clones nothing; one
    // staffed while a clone landed only in its own front has no fronts on record, so it keeps that.
    const clone = c.cloneHome ? { home: c.cloneHome, fronts: c.cloneFronts ?? [c.front] } : undefined
    const why = toolRefusal(role.kind, e.tool, e.input, c.protectedBranches, c.cwd, clone)
    if (!why) return next(e)
    await log($, 'guard', role.console.callSign, `${role.kind} ${e.tool} denied: ${why}`)
    return { decision: 'deny' as const, reason: why }
  }).catch(($, e, next) => (e.agentId ? { decision: 'deny' as const, reason: 'The fleet guard could not decide, so it refused.' } : next(e)))

  // The back-room budget, and Controllers staffed only through the console.
  on('agent.spawn', async ($, e, next) => {
    if (e.subagentType === `mission-fleet:${CONTROLLER_TYPE}` && next.origin.plugin !== 'mission-fleet') {
      return { deny: 'Controllers are staffed only through /console staff.' }
    }
    if (!e.parentAgentId) return next(e)
    const role = await roleOf($, e.parentAgentId)
    if (!role) return next(e)
    const c = role.console
    const live = liveBackRoom(await $.agent.list(), c)
    // Reserve inside the state write, so parallel spawns in one turn cannot all pass the check.
    const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const fresh = Date.now() - 120000
    let admitted = false
    await update($, reserving, list => {
      const current = list.filter(r => r.at > fresh)
      const pending = current.filter(r => r.controller === c.callSign).length
      admitted = live + pending < c.budget
      return admitted ? [...current, { controller: c.callSign, token, at: Date.now() }] : current
    })
    if (!admitted) {
      await log($, 'budget', c.callSign, `spawn denied: ${live} in flight of ${c.budget}`)
      return { deny: `${c.callSign} has ${live} of its ${c.budget} back-room agents in flight. Ask Flight for more, or wait for one to finish.` }
    }
    try {
      const started = await next(e)
      const child = started.agentId
      // Persist the parent link: the engine drops finished agents from its list, and a running back room must stay guarded.
      if (child) await update($, lineage, list => [...list.filter(l => l.agentId !== child), { agentId: child, parentId: e.parentAgentId as string }].slice(-2000))
      return started
    } finally {
      await update($, reserving, list => list.filter(r => r.token !== token))
    }
  }).catch(($, e, next) => (next.called || !e.parentAgentId ? next(e) : { deny: 'The fleet guard could not check the back-room budget, so it refused.' }))

  // Retune: rewrite a tuned Controller's model and effort on every request it sends.
  on('turn.step', async function* ($, e, next) {
    const c = e.agentId ? await tunedConsole($, e.agentId) : undefined
    if (!c?.tune) {
      if (e.agentId) return yield* next(e)
      const before = await $.session.messages().catch(() => [])
      const response = yield* next(e)
      const text = response.answer.trim()
      if (text) {
        const prev = [...before].reverse().find(m => m.text.trim() !== '')
        spoken = [...spoken, { text, after: prev?.text.trim() ?? '' }].slice(-60)
      }
      return response
    }
    const step = { ...e, ...(c.tune.model ? { model: c.tune.model } : {}), ...(c.tune.effort ? { effort: c.tune.effort as typeof e.effort } : {}) }
    await markApplied($, c, `${step.model} ${step.effort ?? 'default'}`)
    return yield* next(step)
  })

  // Loops and poll: every Controller turn's report is recorded; a gate or a contract change opens a poll item.
  on('turn.start', async ($, e, next) => {
    const started = await next(e)
    if (!(e as { agentId?: string }).agentId) {
      flightBusy = true
      busySince = Date.now()
      flightActivity = 'Thinking'
      if (app) void pushState($, app).catch(() => undefined)
      // A plugin load that skips session.start (its folder changed mid-session) starts no supervisor,
      // so every turn of Flight's makes sure one is running while the standing setting is on.
      if (!supervising && (await $.store.get(APP_ALWAYS).catch(() => false)) === true) void superviseApp($)
    }
    return started
  })

  // The app's working line: each of Flight's own tool calls says what it is doing, then back to thinking.
  on('tool.call', async ($, e, next) => {
    if (e.agentId) return next(e)
    flightActivity = activityOf(e as never)
    if (app) void pushState($, app).catch(() => undefined)
    try {
      return await next(e)
    } finally {
      if (flightBusy) flightActivity = 'Thinking'
    }
  }).catch(($, e, next) => next(e))

  // Flight's own questions: while the app runs they go to the app (and the phone), answered there or by
  // /console answer at the Mac; the hook waits by long-polling the app server, a $ call, so its own
  // budget does not run while the founder thinks. Without the app, the terminal dialog as before.
  // A Controller's question is one of these: its header is the poll item's id, and the fleet delivers
  // the founder's answer to that Controller itself, telling Flight what became of it (the context).
  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    if (e.agentId) return next(e)
    const questions = ((e as { questions?: AskQuestion[] }).questions ?? []).filter(q => q.question)
    const answered = async (answers: Record<string, string>) => {
      const said = await deliverAnswers($, questions, answers).catch(async (err: unknown) => {
        await log($, 'ask', 'deliver', `failed: ${String(err).slice(0, 160)}`)
        return 'The fleet could not deliver the Controllers\' answers; /console poll lists what is still open.'
      })
      return said
    }
    // The ids on screen, on either path, so a report arriving meanwhile never replaces a question being answered.
    onScreen = new Set(questions.map(q => (q.header ?? '').toLowerCase()).filter(Boolean))
    try {
    if (app?.port && app.httpOk && questions.length) {
      const id = hex(8)
      flightAsk = { id, questions }
      void pushState($, app).catch(() => undefined)
      void alert($, `Flight asks: ${questions[0]!.question}`)
      $.ui.log(askText(questions))
      try {
        while (!next.signal.aborted) {
          const current = app
          if (!current?.port) break
          const r = await $.http.fetch(`http://127.0.0.1:${current.port}/bridge/answer?id=${id}`, { method: 'POST', headers: { 'x-bridge-key': current.key } })
          if (r.status === 200) {
            const got = JSON.parse(r.text) as { answers: Record<string, string>; annotations?: Record<string, unknown> }
            await log($, 'ask', id, `answered: ${JSON.stringify(got.answers).slice(0, 160)}`)
            const said = await answered(got.answers)
            return { result: { questions: (e as { questions: unknown }).questions, answers: got.answers, ...(got.annotations ? { annotations: got.annotations } : {}) }, ...(said ? { context: [said] } : {}) } as never
          }
          if (r.status !== 204) break
        }
      } catch {
        /* the app server went away: ask at the terminal instead */
      } finally {
        flightAsk = undefined
        if (app) void pushState($, app).catch(() => undefined)
      }
      if (next.signal.aborted) return { deny: 'The question was withdrawn.' }
    }
    const qs = questions.map(q => q.question ?? '')
    flightAsking = qs.join(' / ') || 'a question'
    if (app) void pushState($, app).catch(() => undefined)
    try {
      const r = await next(e)
      const got = r as { result?: { answers?: Record<string, string> }; isError?: boolean }
      if (got.isError || !got.result?.answers) return r
      const said = await answered(got.result.answers)
      // Core's own result object is returned with the line added, so core keeps its messages as they are.
      return (said ? { ...r, context: [...((r as { context?: readonly string[] }).context ?? []), said] } : r) as never
    } finally {
      flightAsking = undefined
      if (app) void pushState($, app).catch(() => undefined)
    }
    } finally {
      onScreen = new Set()
      void askQueue($).catch(() => undefined)
    }
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    let done
    try {
      done = await next(e)
    } finally {
      if (!e.agentId) {
        flightBusy = false
        flightActivity = ''
        if (app) void pushState($, app).catch(() => undefined)
        // Questions that arrived while Flight worked are put to it now its turn has ended.
        void askQueue($).catch((err: unknown) => log($, 'ask', 'queue', `not put to Flight: ${String(err).slice(0, 160)}`).catch(() => undefined))
      }
    }
    const agentId = e.agentId
    // Recorded without holding up the turn; a failure is audited, never silent.
    if (agentId) void recordReport($, agentId, e.answer).catch((err: unknown) => log($, 'poll', agentId, `report not recorded: ${String(err).slice(0, 160)}`))
    return done
  })

  on('command.run', { command: 'console' }, async ($, e) => ({ text: await runConsole($, e.args, PERSON_ORIGINS.has(e.origin?.kind ?? '')) }))
    .catch(() => ({ text: FAILED }))

  on('tool.call', { tool: /^mcp__mission-fleet__console$/ }, async ($, e) => {
    if (e.agentId) return { result: 'Only Flight runs the console tool; a Controller reports to Flight instead.', isError: true }
    const raw = typeof (e as { args?: unknown }).args === 'string' ? (e as { args: string }).args : ''
    // An app op relayed through Flight carries a one-time code minted for exactly these args: the founder's own.
    const { args, code } = splitRelayCode(raw)
    const fromApp = spendRelayCode(relayCodes, code, args, Date.now())
    if (code && !fromApp) return { result: 'That app code is unknown, used or expired (a later answer from the app replaces an earlier one); send it again from the app if it still matters.', isError: true }
    return { result: await runConsole($, args, fromApp) }
  }).catch(() => ({ result: FAILED, isError: true }))
}

async function runConsole($: EngineInterface, args: string, fromPerson: boolean): Promise<string> {
  // An answer is free text, so it is taken whole, before flag parsing could read words of it as flags.
  if (/^\s*answer\b/i.test(args)) {
    if (!fromPerson) return "Flight's questions are the founder's to answer: type /console answer yourself, or use the app."
    return answerAsk($, args.replace(/^\s*answer\s*/i, ''))
  }
  const free = freeText(args)
  const parsed: Parsed = free ? { verb: free.verb, rest: free.target ? [free.target] : [], flags: {} } : parseArgs(args)
  const { verb, rest, flags, error } = parsed
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
    const text = free ? free.text : words.join(' ')
    const c = fleet.find(x => x.callSign === callSignOf(sign ?? '') && x.status === 'staffed')
    if (!c) return `No staffed console ${sign ?? ''}. /console list shows the fleet.`
    if (text === '') return USAGE
    const sent = await $.session.send({ to: { agentId: c.agentId }, text })
    await log($, 'call', c.callSign, sent.isDelivered ? 'delivered' : `refused: ${sent.reason}`)
    if (sent.isDelivered) await addLoop($, { from: 'FLIGHT', to: c.callSign, kind: 'call', text })
    return sent.isDelivered ? `Called ${c.callSign}. Its answer arrives as a status check.` : `Call to ${c.callSign} not delivered: ${sent.reason}`
  }

  if (verb === 'retune') {
    const [sign, model, effort] = rest
    const c = fleet.find(x => x.callSign === callSignOf(sign ?? '') && x.status === 'staffed')
    if (!c) return `No staffed console ${sign ?? ''}. /console list shows the fleet.`
    if (!model || (model !== '-' && !(model in MODEL_IDS))) return `retune needs a model (${MODEL_LIST}, or - to keep it) and optionally an effort.\n${USAGE}`
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

  if (verb === 'app') {
    if (!fromPerson) return 'The app is started by the founder: type /console app.'
    if (rest[0] === 'stop') {
      await $.store.set(APP_ALWAYS, false)
      return stopApp($)
    }
    await $.store.set(APP_ALWAYS, true)
    const text = await startApp($)
    void superviseApp($)
    return `${text}\nIt now runs in every session of this profile and restarts itself; /console app stop turns that off.`
  }

  if (verb === 'poll') {
    const all = await read($, poll)
    const open = all.filter(p => p.state === 'open')
    const replaced = all.filter(p => p.state === 'superseded').slice(-3)
    const lines: string[] = []
    for (const p of open) {
      lines.push(`${p.id}  ${p.from}${p.urgent ? ' (urgent)' : ''}  ${p.kind}: ${p.title}${p.targets?.length ? `  (tells: ${p.targets.join(', ')})` : ''}`)
      if (p.kind !== 'todo') optionsOf(p).forEach((o, k) => lines.push(`      ${k + 1}) ${o.label}${o.does ? ` - ${o.does}` : ''}`))
    }
    if (lines.length === 0) lines.push('Nothing is waiting on the founder.')
    else lines.push('', 'Flight asks each question as its own, in the app and here; check off a to-do with /console done <id>.')
    if (replaced.length) lines.push('', 'Recently replaced by a newer report:', ...replaced.map(p => `  ${p.id}  ${p.from}: ${p.title.slice(0, 100)}`))
    return lines.join('\n')
  }

  if (verb === 'loops') {
    const sign = rest[0] ? callSignOf(rest[0]) : undefined
    const list = (await read($, loops)).filter(l => !sign || l.from === sign || l.to === sign).slice(-15)
    return list.length ? list.map(l => `${l.at.slice(11, 16)}  ${l.from} -> ${l.to}  ${l.kind}: ${l.text.split('\n')[0]?.slice(0, 140) ?? ''}`).join('\n') : 'No loop traffic yet.'
  }

  if (verb === 'dismiss-gate') {
    if (!fromPerson) return 'Dismissing a gate is the founder\'s: type /console dismiss-gate <id> yourself, or use the app.'
    return dismissGate($, rest[0] ?? '')
  }

  if (verb === 'done') {
    if (!fromPerson) return 'A to-do is the founder\'s to check off: type /console done <id> yourself, or use the app.'
    return checkOff($, rest[0] ?? '')
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

type Role = { kind: GuardRole; console: Console }

const ACTIVE_STATUS = new Set(['pending', 'running', 'waiting'])

/**
 * Who an agent is in the fleet, read live from the engine's own parent chain:
 * a console's agent (by id, or by its reserved name while staffing) is a
 * Controller; anything beneath one is its back room. Every console counts,
 * staffed or not, so a dismissed Controller's running back room stays guarded.
 */
async function roleOf($: EngineInterface, agentId: string): Promise<Role | undefined> {
  const fleet = await read($, consoles)
  if (fleet.length === 0) return undefined
  const agents = await $.agent.list()
  const byId = new Map(agents.map(a => [a.id, a]))
  const recorded = new Map((await read($, lineage)).map(l => [l.agentId, l.parentId]))
  const consoleOf = (id: string) => {
    const byAgent = fleet.find(c => c.agentId !== '' && c.agentId === id)
    if (byAgent) return byAgent
    // While staffing, before its id is written: only an agent Flight's own loop started, under the reserved name.
    const a = byId.get(id)
    return a && a.parentId === undefined && a.name ? fleet.find(c => c.status === 'staffing' && c.agentId === '' && c.name === a.name) : undefined
  }
  let cursor: string | undefined = agentId
  for (let depth = 0; cursor !== undefined && depth < 32; depth++) {
    const owner = consoleOf(cursor)
    if (owner) return { kind: depth === 0 ? 'controller' : 'back room', console: owner }
    cursor = byId.get(cursor)?.parentId ?? recorded.get(cursor)
  }
  return undefined
}

/** Active agents beneath a console's Controller, at any depth. */
function liveBackRoom(agents: { id: string; parentId?: string; name?: string; status: string }[], c: Console): number {
  const roots = new Set(agents.filter(a => (c.agentId !== '' && a.id === c.agentId) || (c.agentId === '' && a.parentId === undefined && a.name === c.name)).map(a => a.id))
  const below = new Set<string>()
  let grew = true
  while (grew) {
    grew = false
    for (const a of agents) {
      if (a.parentId && (roots.has(a.parentId) || below.has(a.parentId)) && !below.has(a.id) && !roots.has(a.id)) {
        below.add(a.id)
        grew = true
      }
    }
  }
  return agents.filter(a => below.has(a.id) && ACTIVE_STATUS.has(a.status)).length
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

/** Where a front's spokes may be: <front>/<name>.md (single-project) or <front>/<project>/<project>.md (multi-project). */
async function spokeCandidates($: EngineInterface, frontDir: string, project?: string): Promise<string[]> {
  if (project) return [`${frontDir}/${project}/${project}.md`, `${frontDir}/${project}.md`]
  const candidates: string[] = []
  const entries = await $.fs.list(frontDir).catch(() => [])
  for (const e of entries) {
    if (e.kind === 'file' && e.name.endsWith('.md') && !NOT_SPOKES.has(e.name)) candidates.push(`${frontDir}/${e.name}`)
    if (e.kind === 'dir' && !e.name.startsWith('.') && e.name !== 'tasks') candidates.push(`${frontDir}/${e.name}/${e.name}.md`)
  }
  return candidates
}

/** The portfolio's fronts: each folder under _command/portfolio with a front's name and a hub, sorted. */
async function frontsOf($: EngineInterface, root: string): Promise<string[]> {
  const fronts: string[] = []
  for (const e of await $.fs.list(`${root}/_command/portfolio`).catch(() => [])) {
    if (e.kind !== 'dir' || !FRONT.test(e.name)) continue
    const entries = await $.fs.list(`${root}/_command/portfolio/${e.name}`).catch(() => [])
    if (entries.some(x => x.kind === 'file' && x.name === '_front.md')) fronts.push(e.name)
  }
  return fronts.sort()
}

async function spokesOf($: EngineInterface, frontDir: string, project: string | undefined): Promise<{ file: string; path: string; base?: string }[]> {
  const candidates = await spokeCandidates($, frontDir, project)
  const found: { file: string; path: string; base?: string }[] = []
  for (const file of candidates) {
    let text
    try {
      text = await $.fs.read(file)
    } catch {
      continue
    }
    const path = spokePath(text)
    const base = spokeField(text, 'base_branch')
    if (path && isInsideRelative(path)) found.push({ file, path, ...(base ? { base } : {}) })
    if (project && found.length) break
  }
  return found
}

/**
 * Places every live console in a colour slot and keeps the map in the store, writing only when it
 * changed. A map the store cannot read is never written over: the call fails instead.
 */
function keepSlots($: EngineInterface): Promise<Slots> {
  const run = slotChain.then(async () => {
    const map = asSlots(await $.store.get(SLOTS_KEY))
    const next = placeSlots(map, await read($, consoles))
    if (next !== map) await $.store.set(SLOTS_KEY, next)
    return next
  })
  slotChain = run.catch(() => undefined)
  return run
}

async function staff($: EngineInterface, front: string | undefined, flags: Record<string, string>): Promise<string> {
  if (!front) return USAGE
  const project = flags.project
  if (!FRONT.test(front) || (project !== undefined && !FRONT.test(project))) return `"${project ?? front}" is not a front or project name (letters, digits, - and _ only).`
  if (flags.model && !(flags.model in MODEL_IDS)) return `--model must be one of ${MODEL_LIST}.`
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
  // A clone of any repository lands one level under the folder of any front the portfolio has now.
  const cloneHome = `${root}/fronts/${front}`
  const cloneFronts = [...new Set([...(await frontsOf($, root)), front])].sort()

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
      protectedBranches: [...new Set(spokes.flatMap(x => protectedFromSpoke(x.base)))], cloneHome, cloneFronts,
      model: flags.model ?? 'default', ...(flags.effort ? { tune: { effort: flags.effort } } : {}), staffedAt: new Date().toISOString(), status: 'staffing',
    }
    return [...list.filter(c => c.callSign !== callSign), reserved]
  })
  if (holder) return `${callSign} is already ${holder.status} (agent ${holder.agentId || 'starting'}). Use /console call ${callSign} <message>.`
  // Its colour in the app: the one it had before, unless a console staffed earlier holds it.
  await keepSlots($).catch((err: unknown) => log($, 'slots', callSign, `not kept: ${String(err).slice(0, 120)}`))

  const release = () => update($, consoles, list => list.filter(c => !(c.callSign === callSign && c.status === 'staffing')))
  let spawned: Awaited<ReturnType<EngineInterface['agent']['spawn']>>
  try {
    spawned = await $.agent.spawn({
      prompt: staffingOrder({ front, ...(project ? { project } : {}), callSign, root, hub, spokes: spokes.map(x => x.file), cwd, budget, progress: `${frontDir}/progress.md`, clone: { home: cloneHome, fronts: cloneFronts } }),
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
  // What waited while no console held this call sign: its front's held advisories.
  const handed = await deliverHeld($, { callSign, front, agentId })
  const said = handed === undefined ? '' : handed ? ' It was handed the advisories held for its front.' : ' The advisories held for its front did not reach it; they stay held.'
  return `${callSign} staffed as ${name} (agent ${agentId}, ${spawned.model}) in ${cwd}. Its first status check arrives when it finishes reading the hub.${said}`
}

/**
 * Hands a staffed Controller the advisories held for its front, in one message. Delivered clears
 * them; refused leaves them held. Undefined when none wait.
 */
async function deliverHeld($: EngineInterface, seat: Pick<Console, 'callSign' | 'front' | 'agentId'>): Promise<boolean | undefined> {
  const advisories = (await read($, pending)).filter(a => a.front === seat.front)
  const text = advisoryText(seat.callSign, advisories)
  if (!text) return undefined
  const sent = await $.session.send({ to: { agentId: seat.agentId }, text })
  if (!sent.isDelivered) {
    await log($, 'held', seat.callSign, `advisories NOT delivered: ${sent.reason}`)
    return false
  }
  const ids = new Set(advisories.map(a => a.id))
  await update($, pending, list => list.filter(a => !ids.has(a.id)))
  await log($, 'held', seat.callSign, `${advisories.length} advisories delivered`)
  return true
}

async function hold($: EngineInterface, front: string, text: string) {
  await update($, pending, list =>
    list.some(a => a.front === front && a.text === text)
      ? list
      : [...list, { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, front, text, at: new Date().toISOString() }].slice(-200),
  )
}

/** Items a console asks: they are answered with decide, and a newer report from that console may replace them. */
const ASKED = (p: Pick<PollItem, 'kind'>) => p.kind === 'question' || p.kind === 'gate'
/** Two items ask the same thing: the same kind and title, ignoring case and spacing. A re-listed question may reword its options. */
const askKey = (t: string) => t.toLowerCase().replace(/\s+/g, ' ').trim()
const sameAsk = (a: Pick<PollItem, 'kind' | 'title'>, b: Pick<PollItem, 'kind' | 'title'>) => a.kind === b.kind && askKey(a.title) === askKey(b.title)

/**
 * A Controller's report, read for what it asks of the founder. Each decision opens a question with the
 * Controller's options. A report in the old shape (no decisions, to-dos or notes) whose blocked line says
 * something opens one item asked as Go or No-go (a Controller staffed before decisions were asked); in
 * the new shape the blocked line only points at the blocks below. Each to-do opens a to-do, never a
 * question; notes open nothing. A contract change opens an advisory only when another front's map
 * names this scope. A report that lists decisions (or says none) is that console's whole list: an
 * open question or gate it does not list again is replaced, and one it lists again keeps its id (with
 * the options as now written, unless an answer to it is on its way). A new gate replaces only earlier
 * gates. An item whose answer the app has sent to Flight is never replaced: the founder's answer wins.
 */
async function recordReport($: EngineInterface, agentId: string, answer: string) {
  const c = (await read($, consoles)).find(x => x.agentId === agentId)
  if (!c || !answer.trim()) return
  await addLoop($, { from: c.callSign, to: 'FLIGHT', kind: 'status', text: answer.trim() })
  await watchFrom($, c, answer)
  const report = parseReport(answer)
  const items: Omit<PollItem, 'id'>[] = []
  const at = new Date().toISOString()
  const base = { at, from: c.callSign, agentId, detail: answer.trim(), state: 'open' as const }
  if (report.decisions) for (const d of report.decisions) items.push({ ...base, kind: 'question', title: d.question, ...(d.options.length ? { options: d.options } : {}), ...(d.urgent ? { urgent: true as const } : {}) })
  else if (report.todos === undefined && report.notes === undefined && !isNothing(report.blocked)) items.push({ ...base, kind: 'gate', title: report.blocked ?? '' })
  for (const t of report.todos ?? []) items.push({ ...base, kind: 'todo', title: t })
  if (!isNothing(report.contract)) {
    const root = await findRoot($)
    const maps: { front: string; text: string }[] = []
    if (root) {
      for (const e of await $.fs.list(`${root}/_command/portfolio`).catch(() => [])) {
        if (e.kind !== 'dir') continue
        const text = await $.fs.read(`${root}/_command/portfolio/${e.name}/_map.md`).catch(() => '')
        if (text) maps.push({ front: e.name, text })
      }
    }
    const targets = [...new Set(dependentsOf(c.front, maps, c.front))]
    // A change no other front consumes has no one to tell, so nothing is asked.
    if (targets.length) items.push({ ...base, kind: 'advisory', title: `contract change: ${report.contract ?? ''}`, targets })
    else await log($, 'poll', c.callSign, `contract change, no dependent front: ${String(report.contract).slice(0, 120)}`)
  }
  // What this report replaces: a decisions list replaces questions and gates; a gate, earlier gates.
  const replaces = (p: PollItem) => (report.decisions !== undefined ? ASKED(p) : items.some(i => i.kind === 'gate') && p.kind === 'gate')
  const replacing = report.decisions !== undefined || items.some(i => i.kind === 'gate')
  if (items.length === 0 && !replacing) return
  let first = 0
  await update($, pollSeq, n => {
    first = (n ?? 0) + 1
    return (n ?? 0) + items.length
  })
  let fresh: PollItem[] = []
  let replaced: PollItem[] = []
  await update($, poll, list => {
    const mine = (p: PollItem) => p.state === 'open' && p.from === c.callSign
    // A question Flight is asking right now keeps its words: the founder's answer to it wins.
    const kept = list.map(p => {
      if (!mine(p) || !ASKED(p) || onScreen.has(p.id.toLowerCase())) return p
      const again = items.find(i => sameAsk(i, p))
      if (again) {
        const options = again.options && JSON.stringify(again.options) !== JSON.stringify(p.options ?? []) ? { options: again.options } : {}
        const urgent = again.urgent && !p.urgent ? { urgent: true as const } : {}
        return Object.keys(options).length || Object.keys(urgent).length ? { ...p, ...options, ...urgent } : p
      }
      return replacing && replaces(p) ? { ...p, state: 'superseded' as const } : p
    })
    replaced = kept.filter((p, k) => p.state === 'superseded' && list[k]?.state === 'open')
    fresh = items.filter(i => !kept.some(p => mine(p) && sameAsk(p, i))).map((i, k) => ({ ...i, id: pollId(i.from, first + k) }))
    return [...kept, ...fresh].slice(-200)
  })
  for (const p of replaced) await log($, 'replaced', p.id, `${c.callSign}: no longer asked`)
  for (const i of fresh) await log($, i.kind === 'todo' ? 'todo' : 'asked', i.id, `${c.callSign} ${i.kind}: ${i.title.slice(0, 120)}`)
  const asked = fresh.filter(i => i.kind !== 'todo')
  const todos = fresh.filter(i => i.kind === 'todo')
  // The alert names the call sign and a count, never the Controller's words.
  if (asked.length) await alert($, `${c.callSign} asks you ${asked.length === 1 ? 'a question' : `${asked.length} questions`}${asked.some(i => i.urgent) ? ' (urgent)' : ''}: Flight asks ${asked.length === 1 ? 'it' : 'them'} in the app and at the Mac.`)
  if (todos.length) await alert($, `${c.callSign} left you ${todos.length === 1 ? 'a to-do' : `${todos.length} to-dos`}: see the app's Flight tab, or /console poll.`)
  if (asked.length) await askQueue($).catch((err: unknown) => log($, 'ask', c.callSign, `not put to Flight: ${String(err).slice(0, 160)}`))
}

/** Questions put to Flight one batch at a time; a call while one is being put runs again once it is done. */
let putting = false
let again = false

/**
 * Puts the next batch of open questions to Flight while it is idle and asks nothing itself: one prompt,
 * waiting for Flight's turn if one starts first, telling it to ask them with AskUserQuestion. Each is
 * marked askedAt, so it is put again only after ASK_AGAIN if Flight never asked it; a prompt the
 * engine dropped or that threw unmarks them at once. The watch loop calls it too, so a question
 * waiting while Flight stays idle is put again.
 */
async function askQueue($: EngineInterface): Promise<void> {
  if (putting) {
    again = true
    return
  }
  if (flightBusy || flightAsk || flightAsking || onScreen.size) return
  putting = true
  try {
    const now = Date.now()
    const batch = nextAsks(await read($, poll), now, await read($, consoles))
    if (!batch.length) return
    const ids = new Set(batch.map(p => p.id))
    const at = new Date(now).toISOString()
    await update($, poll, list => list.map(p => (ids.has(p.id) && p.state === 'open' ? { ...p, askedAt: at } : p)))
    const unmark = () => update($, poll, list => list.map(p => (ids.has(p.id) && p.askedAt === at ? omitAsked(p) : p)))
    let sent: Awaited<ReturnType<EngineInterface['prompt']['submit']>>
    try {
      sent = await $.prompt.submit({ text: askPrompt(batch) })
    } catch (err) {
      await unmark()
      await log($, 'ask', [...ids].join(','), `NOT put to Flight: ${String(err).slice(0, 160)}`)
      return
    }
    if (sent.drop !== undefined) {
      await unmark()
      await log($, 'ask', [...ids].join(','), `NOT put to Flight, the prompt was dropped: ${sent.drop.slice(0, 160)}`)
      return
    }
    await log($, 'ask', [...ids].join(','), `put to Flight to ask (${batch.map(p => p.from).join(', ')})`)
  } finally {
    putting = false
    if (again) {
      again = false
      void askQueue($).catch(() => undefined)
    }
  }
}

/** The item without askedAt; state is JSON, so the field is removed, never set to undefined. */
function omitAsked(p: PollItem): PollItem {
  const { askedAt, ...rest } = p
  return rest
}

/** Reads the stored poll as the questions Flight asks read it (migratePoll), inside the write, so a report landing meanwhile is kept. */
async function migrate($: EngineInterface): Promise<void> {
  let before: StoredPollItem[] = []
  let reopened: string[] = []
  let after: PollItem[] = []
  await update($, poll, list => {
    before = list as StoredPollItem[]
    const m = migratePoll(before)
    reopened = m.reopened
    after = m.items
    return m.items.every((p, k) => p === before[k]) ? list : m.items
  })
  if (after.every((p, k) => p === before[k])) return
  const open = (l: readonly PollItem[]) => l.filter(p => p.state === 'open').length
  await log($, 'poll', 'migrate', `open ${open(before)} -> ${open(after)}; reopened ${reopened.length ? reopened.join(', ') : 'none'}; items ${before.length} -> ${after.length}`)
}

/** A header the fleet would have written: two capitals and a number, as pollId makes them. */
const POLL_ID = /^[A-Z]{2}\d+$/

/**
 * The founder's answers to Flight's question, matched to the Controllers' open items and delivered
 * to each Controller that asked one. An answer under a fleet id that matches no open item (replaced
 * or closed while it was on screen) is audited and told to Flight, never dropped. Returns what Flight
 * is told, or '' when nothing was the fleet's.
 */
async function deliverAnswers($: EngineInterface, questions: AskQuestion[], answers: Record<string, string>): Promise<string> {
  const items = await read($, poll)
  const matched = matchAnswers(items, questions, answers)
  const lines: string[] = []
  for (const m of matched) lines.push(await deliver($, m.item, m.choice, m.note))
  for (const q of questions) {
    const header = (q.header ?? '').trim()
    const answer = (answers[q.question ?? ''] ?? '').trim()
    if (!POLL_ID.test(header) || !answer || matched.some(m => m.item.id.toLowerCase() === header.toLowerCase())) continue
    const known = items.filter(p => p.id.toLowerCase() === header.toLowerCase()).at(-1)
    const where = known ? `${header} is ${known.state} (${known.from})` : `no item ${header} is on record`
    await log($, 'ask', header, `answer matched no open item: ${where}; answer: ${answer.slice(0, 120)}`)
    lines.push(`The answer to ${header} ("${answer.slice(0, 120)}") reached no Controller: ${where}.${known ? ` Tell it with /console call ${known.from} <the answer> if it still matters.` : ''}`)
  }
  return lines.length ? `[mission-fleet] ${lines.join(' ')}` : ''
}

/** One line to the founder's phone (via Remote Control) or desktop; the tool itself skips it when the founder is at the terminal. */
async function alert($: EngineInterface, message: string) {
  const line = message.replace(/\s+/g, ' ').slice(0, 190)
  const r = (await $.tool.call({ tool: 'PushNotification', message: line, status: 'proactive' } as Parameters<EngineInterface['tool']['call']>[0]).catch((err: unknown) => ({ isError: true, text: `failed: ${String(err).slice(0, 80)}` }))) as { isError?: boolean; text?: string }
  const outcome = r.isError ? `not sent: ${r.text ?? 'refused'}` : (r.text ?? 'no result text')
  await log($, 'alert', 'founder', `${line.slice(0, 80)} -> ${outcome.slice(0, 100)}`)
}

async function watchFrom($: EngineInterface, c: Console, answer: string) {
  // Only the Controller's own lines name its PRs; a quoted PR elsewhere in a report is not its work.
  const own = parseStatus(answer)
  const prs = prsIn(`${own.state ?? ''}\n${own.shipped ?? ''}`)
  if (!prs.length) return
  await update($, watches, list => {
    const next = [...list]
    for (const pr of prs) if (!next.some(w => w.agentId === c.agentId && w.pr === pr)) next.push({ callSign: c.callSign, agentId: c.agentId, cwd: c.cwd, pr, since: new Date().toISOString() })
    return next
  })
}

/** Every ten minutes: a watched PR whose checks, reviews or comments changed wakes its Controller; a closed one stops being watched. */
async function watchLoop($: EngineInterface) {
  for (;;) {
    await $.clock.sleep(WATCH_EVERY)
    // A question put to Flight that it never asked, while it stayed idle, is put again here.
    await askQueue($).catch((err: unknown) => log($, 'ask', 'queue', `not put to Flight: ${String(err).slice(0, 160)}`))
    const fleet = await read($, consoles).catch(() => [] as Console[])
    for (const w of await read($, watches).catch(() => [] as PrWatch[])) {
      try {
        await checkWatch($, w, fleet)
      } catch (err) {
        await log($, 'watch', w.callSign, `PR #${w.pr} check failed: ${String(err).slice(0, 120)}`).catch(() => undefined)
      }
    }
  }
}

const same = (a: PrWatch, b: PrWatch) => a.agentId === b.agentId && a.pr === b.pr

async function dropWatch($: EngineInterface, w: PrWatch, why: string) {
  await update($, watches, list => list.filter(x => !same(x, w)))
  await log($, 'watch', w.callSign, `PR #${w.pr} no longer watched: ${why}`)
}

async function checkWatch($: EngineInterface, w: PrWatch, fleet: Console[]) {
  const c = fleet.find(x => x.agentId === w.agentId)
  if (!c || c.status !== 'staffed') return dropWatch($, w, 'console not staffed')
  if (Date.now() - Date.parse(w.since) > 14 * 24 * 60 * 60_000) return dropWatch($, w, 'watched for 14 days')
  const r = await $.process.run(['gh', 'pr', 'view', String(w.pr), '--json', 'state,reviewDecision,comments,reviews,statusCheckRollup'], { cwd: w.cwd, timeoutMs: 30_000 }).catch((err: unknown) => ({ exitCode: -1, stdout: '', stderr: String(err) }))
  let view: { state?: string } & Parameters<typeof prSignature>[0]
  try {
    if (r.exitCode !== 0) throw new Error(r.stderr.slice(0, 120) || `gh exited ${r.exitCode}`)
    view = JSON.parse(r.stdout)
  } catch (err) {
    const fails = (w.fails ?? 0) + 1
    await log($, 'watch', w.callSign, `PR #${w.pr} unreadable (${fails}/3): ${String(err).slice(0, 120)}`)
    if (fails >= 3) return dropWatch($, w, 'gh could not read it three times')
    await update($, watches, list => list.map(x => (same(x, w) ? { ...x, fails } : x)))
    return
  }
  const state = String(view.state ?? '')
  if (state === 'MERGED' || state === 'CLOSED') return dropWatch($, w, state.toLowerCase())
  const sig = prSignature(view)
  if (!sig) return
  if (w.sig && sig !== w.sig) {
    const text = `Watch: PR #${w.pr} changed (${w.sig} -> ${sig}). Look at its checks, reviews and comments, act within your scope, and report in your status lines.`
    const sent = await $.session.send({ to: { agentId: w.agentId }, text })
    await addLoop($, { from: 'FLIGHT', to: w.callSign, kind: 'call', text })
    await log($, 'watch', w.callSign, `PR #${w.pr} ${sent.isDelivered ? 'changed, Controller woken' : `changed, not delivered: ${sent.reason}`}`)
  }
  await update($, watches, list => list.map(x => (same(x, w) ? { ...x, sig, fails: 0 } : x)))
}

/** Closes an open question or to-do that no longer matters; nothing is sent to anyone. */
async function dismissGate($: EngineInterface, id: string): Promise<string> {
  const item = (await read($, poll)).filter(p => p.id.toLowerCase() === id.toLowerCase()).at(-1)
  if (!item) return `No poll item ${id}. /console poll lists the open ones.`
  if (item.state !== 'open') return `${item.id} is already closed: ${item.state}.`
  await update($, poll, list => list.map(p => (p.id === item.id && p.at === item.at ? { ...p, state: 'dismissed' as const, decidedAt: new Date().toISOString() } : p)))
  await addLoop($, { from: 'FOUNDER', to: item.from, kind: 'decision', text: `dismissed ${item.id}: no longer needed` })
  await log($, 'dismissed', item.id, 'closed with no answer')
  return `${item.id} dismissed. Nothing was sent to ${item.from}.`
}

/** A send to a Controller that may throw, as one outcome: delivered, or the reason it was not. */
async function sendTo($: EngineInterface, agentId: string, text: string): Promise<{ isDelivered: boolean; reason: string }> {
  try {
    const sent = await $.session.send({ to: { agentId }, text })
    return { isDelivered: sent.isDelivered, reason: sent.isDelivered ? '' : sent.reason }
  } catch (err) {
    return { isDelivered: false, reason: String(err).slice(0, 200) }
  }
}

/**
 * The founder's answer to an open item, from Flight's own question: option `choice` of what it is
 * asked with (optionsOf), or 0 for the founder's own words (`note`). A question is answered with its
 * option. A blocked line or an advisory becomes go (1) or no-go (2); own words on one are passed on
 * as words with no verdict, so "no" typed as text never becomes a GO, and an advisory answered in
 * words tells no front. The answer goes only to the agent that raised the item while its console is
 * staffed; an advisory's go goes to the Controllers of the fronts it names, held for a front with
 * none. The item is recorded as answered whatever the delivery; what became of it is returned for Flight.
 */
async function deliver($: EngineInterface, item: PollItem, choice: number, note: string): Promise<string> {
  const words = choice === 0
  const state: PollItem['state'] = item.kind === 'question' || words ? 'answered' : choice === 2 ? 'no-go' : 'go'
  const decided: PollItem = { ...item, state, choice }
  const word = answerWord(decided)
  await update($, poll, list => list.map(p => (p.id === item.id && p.at === item.at ? { ...p, state, choice, decidedAt: new Date().toISOString(), ...(note ? { note } : {}) } : p)))
  const told: string[] = []
  let failed: string | undefined
  if (item.kind === 'gate' || item.kind === 'question' || (item.kind === 'advisory' && words)) {
    const text = decisionText(item, choice, note)
    const seat = liveSeat(item, await read($, consoles))
    if (!seat) failed = `${item.from} is no longer staffed, so nothing was sent; tell its next Controller with /console call ${item.from} if it still matters.`
    else {
      const sent = await sendTo($, seat.agentId, text)
      if (sent.isDelivered) told.push(item.from)
      else failed = `it did not reach ${item.from}: ${plainReason(sent.reason)} Send it with /console call ${item.from} <the answer>.`
    }
    await addLoop($, { from: 'FOUNDER', to: item.from, kind: 'decision', text: text.split('\n')[0] ?? '' })
  }
  if (item.kind === 'advisory' && state === 'go') {
    const fleet = await read($, consoles)
    const text = `Advisory from Flight: ${item.from} reports a ${item.title}. Check what your front consumes from it before your next change.`
    for (const front of item.targets ?? []) {
      const target = fleet.find(c => c.front === front && c.status === 'staffed')
      const sent = target ? await sendTo($, target.agentId, text) : undefined
      if (target && sent?.isDelivered) {
        told.push(target.callSign)
        await addLoop($, { from: 'FLIGHT', to: target.callSign, kind: 'advisory', text })
      } else await hold($, front, text)
    }
  }
  await log($, state, item.id, failed ? `NOT delivered to ${item.from}: ${failed}` : told.length ? `told ${told.join(', ')}` : 'recorded; held for unstaffed fronts')
  const said = state === 'answered' ? `answered ${word}` : `${word} recorded`
  const quiet = item.kind === 'advisory' && words ? '; no dependent front was told, since the answer gave no Tell them' : ''
  if (failed) return `${item.id} (${item.from}): ${said}, but ${failed}${quiet}`
  return `${item.id} (${item.from}): ${said}${told.length ? `, told ${told.join(', ')}` : ''}${quiet}.`
}

/** Checks off a to-do a Controller left for the founder, and tells that Controller it is done. */
async function checkOff($: EngineInterface, id: string): Promise<string> {
  const item = (await read($, poll)).filter(p => p.id.toLowerCase() === id.toLowerCase()).at(-1)
  if (!item) return `No poll item ${id}. /console poll lists them.`
  if (item.kind !== 'todo') return `${item.id} is not a to-do: Flight asks it as a question.`
  if (item.state !== 'open') return `${item.id} is already closed: ${item.state}.`
  await update($, poll, list => list.map(p => (p.id === item.id && p.at === item.at ? { ...p, state: 'done' as const, decidedAt: new Date().toISOString() } : p)))
  const seat = liveSeat(item, await read($, consoles))
  const text = `The founder checked off your to-do ${item.id}: ${item.title}`
  const sent = seat ? await sendTo($, seat.agentId, text) : undefined
  if (seat && sent?.isDelivered) {
    await addLoop($, { from: 'FOUNDER', to: item.from, kind: 'decision', text })
    await log($, 'done', item.id, `${item.from} told: ${item.title.slice(0, 100)}`)
    return `${item.id} done; ${item.from} was told.`
  }
  const why = seat ? plainReason(sent?.reason ?? '') : `${item.from} is no longer staffed.`
  await log($, 'done', item.id, `${item.from} NOT told: ${seat ? sent?.reason ?? '' : 'not staffed'}`)
  return `${item.id} done, but ${item.from} was not told: ${why}`
}

/** The question as the terminal shows it while the app holds the answer. */
function askText(questions: AskQuestion[]) {
  const lines = ['Flight is asking (answer in the Mission Control App, or here with /console answer):']
  questions.forEach((q, i) => {
    lines.push(`${questions.length > 1 ? `${i + 1}. ` : ''}${q.question}`)
    ;(q.options ?? []).forEach((o, k) => lines.push(`   ${k + 1}) ${o.label}${o.description ? ` - ${o.description}` : ''}`))
  })
  lines.push(questions.length > 1 ? 'Answer each, separated by " | ": /console answer 2 | yes' : 'Answer with an option number or your own words: /console answer 2')
  return lines.join('\n')
}

/** /console answer: an option number or free text per question, " | " between questions. */
async function answerAsk($: EngineInterface, raw: string): Promise<string> {
  const ask = flightAsk
  if (!ask || !app?.port) return 'Flight is not waiting on a question.'
  const parts = ask.questions.length > 1 ? raw.split('|').map(p => p.trim()) : [raw.trim()]
  if (parts.length !== ask.questions.length || parts.some(p => !p)) return `Give ${ask.questions.length} answers separated by " | ".`
  const answers: Record<string, string> = {}
  ask.questions.forEach((q, i) => {
    const part = parts[i]!
    const labels = (q.options ?? []).map(o => o.label ?? '')
    const picks = q.multiSelect ? part.split(',').map(x => x.trim()) : [part]
    answers[q.question!] = picks.map(p => (/^\d+$/.test(p) && labels[Number(p) - 1] ? labels[Number(p) - 1]! : p)).join(', ')
  })
  const r = await $.http.fetch(`http://127.0.0.1:${app.port}/bridge/answer`, { method: 'POST', headers: { 'x-bridge-key': app.key, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: ask.id, answers }) })
  return r.ok ? `Answered: ${Object.values(answers).join(' | ')}` : 'That answer did not reach Flight; try again or answer in the app.'
}

async function startApp($: EngineInterface): Promise<string> {
  if (app?.port) return `The app is already running for this profile (its server on 127.0.0.1:${app.port}, the front door on ${APP_PORT}). The link was printed when it started; the token is kept in ${app.tokenFile ?? 'the app token file'}, and deleting that file then restarting every profile's app issues a new one.`
  const root = await findRoot($)
  if (!root) return 'No portfolio found, so there is nowhere to keep the app state.'
  const real = (await $.process.run(['realpath', $.plugin.root])).stdout.trim() || $.plugin.root
  const server = `${real.replace(/\/mods\/mission-fleet$/, '')}/app/server.mjs`
  const token = hex(24)
  const key = hex(24)
  const stateFile = `${root}/_command/fleet/app-state.json`
  const stream = $.process.spawn({ argv: ['node', server], env: { MCAPP_PORT: String(APP_PORT), MCAPP_STATE_FILE: stateFile }, input: `${JSON.stringify({ token, key })}\n` })
  let markEnded: () => void = () => undefined
  const current: App = { token, key, stateFile, stop: () => stream.return(undefined as never), ended: new Promise<void>(r => (markEnded = r)) }
  app = current
  let ready: (port: number | undefined) => void = () => undefined
  const started = new Promise<number | undefined>(r => (ready = r))
  let refused = ''
  void (async () => {
    let buffer = ''
    for await (const piece of stream) {
      if (piece.stream !== 'stdout') continue
      buffer += piece.text
      let nl = buffer.indexOf('\n')
      while (nl >= 0) {
        const line = buffer.slice(0, nl)
        buffer = buffer.slice(nl + 1)
        nl = buffer.indexOf('\n')
        let msg: { type?: string; port?: number; op?: string; text?: string; token?: string; profile?: string; stateFile?: string; tokenFile?: string; reason?: string }
        try {
          msg = JSON.parse(line)
        } catch {
          continue
        }
        if (msg.type === 'ready') {
          // The server answers with the shared token every profile's server uses, and its own profile and state file.
          if (typeof msg.token === 'string' && msg.token.length >= 32) current.token = msg.token
          if (typeof msg.stateFile === 'string' && msg.stateFile) current.stateFile = msg.stateFile
          current.profile = msg.profile
          current.tokenFile = msg.tokenFile
          current.port = msg.port
          ready(msg.port)
        } else if (msg.type === 'refused') {
          refused = String(msg.reason ?? 'refused')
          ready(undefined)
        } else if (msg.type === 'op' && msg.op && typeof msg.text === 'string') await runAppOp($, msg.op, msg.text, Number((msg as { id?: number }).id ?? 0))
      }
    }
    if (app === current) app = undefined
    ready(undefined)
    markEnded()
    await log($, 'app', 'server', 'stopped')
  })().catch((err: unknown) => {
    markEnded()
    return log($, 'app', 'server', `failed: ${String(err).slice(0, 160)}`)
  })
  const port = await Promise.race([started, $.clock.sleep(8000).then(() => undefined)])
  if (!port) {
    await current.stop()
    if (app === current) app = undefined
    return refused ? `The app did not start: ${refused}.` : 'The app server did not start within 8 seconds. Is node on the PATH?'
  }
  void pushLoop($, current)
  await log($, 'app', 'server', `started on 127.0.0.1:${port} as ${current.profile ?? 'unknown'}`)
  return [
    `Mission Control App (${current.profile ?? 'this'} profile): http://127.0.0.1:${APP_PORT}/?t=${current.token}`,
    `Every profile's app shares the front door on ${APP_PORT} and one token; switch profiles from the app header. Open the link once per browser. The app is now a standing setting for this profile: every session of it keeps the app running until /console app stop.`,
    'From the phone: `tailscale serve --bg ' + APP_PORT + '` serves it to your tailnet only (see the remote-access runbook).',
  ].join('\n')
}

/**
 * Keeps the app running while the founder's standing setting is on: starts it, waits for the server
 * to end, and starts it again with a backoff (1 s doubling to 60 s, back to 1 s after 5 minutes up).
 * One supervisor per plugin load; a reload's new load starts its own.
 */
const currentApp = (): App | undefined => app

async function superviseApp($: EngineInterface) {
  if (supervising) return
  supervising = true
  let backoff = 1000
  let refusedOnce = false
  try {
    while ((await $.store.get(APP_ALWAYS).catch(() => false)) === true) {
      if (!app) {
        const text = await startApp($)
        // startApp sets the module's app; read it fresh, past TypeScript's narrowing of the check above.
        if (!currentApp()?.port) {
          // Another session of this profile holds the app (it takes over when that one ends), or the start failed.
          if (!refusedOnce) await log($, 'app', 'supervisor', `waiting: ${text.slice(0, 160)}`)
          refusedOnce = true
          await $.clock.sleep(backoff)
          backoff = Math.min(backoff * 2, 60_000)
          continue
        }
        refusedOnce = false
      }
      const upSince = Date.now()
      await currentApp()?.ended
      if ((await $.store.get(APP_ALWAYS).catch(() => false)) !== true) break
      backoff = Date.now() - upSince > 300_000 ? 1000 : Math.min(backoff * 2, 60_000)
      await log($, 'app', 'supervisor', `server ended; restarting in ${Math.round(backoff / 1000)} s`)
      await $.clock.sleep(backoff)
    }
  } finally {
    supervising = false
  }
}

async function stopApp($: EngineInterface): Promise<string> {
  if (!app) return 'The app is not running.'
  const stopping = app
  app = undefined
  await stopping.stop()
  await log($, 'app', 'server', 'stopped by the founder')
  return 'The app server is stopped.'
}

/** The transcript with any of Flight's responses it lost put back after the message each followed. */
function withSpoken(messages: { role: string; text: string }[]) {
  const out = [...messages]
  const have = new Set(out.filter(m => m.role === 'assistant').map(m => m.text.trim()))
  for (const s of spoken) {
    if (have.has(s.text)) continue
    let at = -1
    for (let i = out.length - 1; i >= 0; i--) if (out[i]!.text.trim() === s.after) { at = i; break }
    if (at < 0) continue
    out.splice(at + 1, 0, { role: 'assistant', text: s.text })
    have.add(s.text)
  }
  return out
}

/** What the app shows: the fleet, the poll, the loops and the commands the session can run. */
async function snapshot($: EngineInterface) {
  // Placing slots here too gives a colour to a console staffed before slots were kept.
  const [fleet, items, traffic, agents, commands, messages, kept] = await Promise.all([
    read($, consoles), read($, poll), read($, loops), $.agent.list(), $.command.list().catch(() => []), $.session.messages().catch(() => []), keepSlots($).catch(() => undefined),
  ])
  // The app link carries its token: never send it back into the page or the state file.
  const secret = app?.token
  const redact = (t: string) => {
    let out = secret ? t.split(secret).join('<token>') : t
    out = out.replace(/([?&]t=)[0-9a-f]{16,}/gi, '$1<token>').replace(/\b[0-9a-f]{48}\b/gi, '<token>')
    return out
  }
  return {
    flight: {
      // A turn that never reported its end (an abort) stops counting as busy after 15 minutes.
      busy: flightBusy && Date.now() - busySince < 15 * 60_000,
      activity: flightBusy ? flightActivity || 'Thinking' : null,
      asking: flightAsking ?? null,
      ask: flightAsk ?? null,
      messages: withSpoken(messages.filter(m => m.text.trim() !== ''))
        .slice(-40)
        .map(m => {
          const clean = redact(m.text)
          return { role: m.role, text: clean.length > 6000 ? `${clean.slice(0, 6000)}\n…` : clean }
        }),
    },
    // Each console carries its own latest status check, parsed once here, so a quiet console never loses it to the loops window.
    consoles: fleet.map(c => {
      const mine = traffic.filter(l => l.from === c.callSign && l.kind === 'status')
      return { ...c, live: agents.find(a => a.id === c.agentId)?.status ?? null, report: parseStatus(mine[mine.length - 1]?.text ?? '') }
    }),
    // What waits on the founder: each Controller's open question (which Flight asks) and to-do.
    questions: items.filter(isAsked).map(p => ({ id: p.id, at: p.at, from: p.from, kind: p.kind, title: p.title, asks: optionsOf(p), ...(p.urgent ? { urgent: true } : {}), ...(p.askedAt ? { askedAt: p.askedAt } : {}), ...(liveSeat(p, fleet) ? {} : { stoodDown: true }) })),
    todos: items.filter(p => p.state === 'open' && p.kind === 'todo').map(p => ({ id: p.id, at: p.at, from: p.from, title: p.title, detail: p.detail })),
    // Each call sign's colour slot; while the store cannot be read, the live consoles still get distinct ones.
    slots: kept ?? placeSlots({}, fleet),
    loops: traffic.slice(-80),
    lastOp: lastOp ?? null,
    models: Object.keys(MODEL_IDS),
    efforts: [...EFFORTS],
    commands: commands.map(c => ({ name: c.name, description: c.description, source: c.source })),
  }
}

async function pushState($: EngineInterface, current: App) {
  // Pushes run one at a time, so a slow older snapshot never lands after a newer one.
  pushChain = pushChain.then(() => pushStateNow($, current)).catch(() => undefined)
  await pushChain
}

async function pushStateNow($: EngineInterface, current: App) {
  const body = JSON.stringify(await snapshot($))
  if (current.port && current.httpOk !== false) {
    try {
      const r = await $.http.fetch(`http://127.0.0.1:${current.port}/bridge/state`, { method: 'POST', headers: { 'x-bridge-key': current.key, 'Content-Type': 'application/json' }, body })
      if (current.httpOk === undefined) await log($, 'app', 'bridge', `loopback http ${r.ok ? 'works' : `refused ${r.status}`}`)
      current.httpOk = r.ok
      if (r.ok) return
    } catch (err) {
      if (current.httpOk === undefined) await log($, 'app', 'bridge', `loopback http unavailable (${String(err).slice(0, 80)}); using the state file`)
      current.httpOk = false
    }
  }
  await $.fs.write(current.stateFile, body)
}

async function pushLoop($: EngineInterface, current: App) {
  while (app === current) {
    await pushState($, current).catch(() => undefined)
    await $.clock.sleep(2000)
  }
}

/** An action from the app: the founder's, since only the token-holder reaches /op. */
// One-time codes for app ops relayed through Flight, by code. A plugin reload drops them, and the
// relayed call is then refused as unknown, so the founder sends it again from the app.
const relayCodes: RelayCodes = new Map()

/**
 * An app op that messages or starts an agent, handed to Flight as a prompt in the founder's name.
 * Sent from the app's own loop, the engine never asks this plugin's tool.check, so auto mode refuses
 * it; Flight's call of the console tool runs where the fleet can approve it.
 */
async function relayToFlight($: EngineInterface, text: string): Promise<string> {
  const args = text.trim()
  const now = Date.now()
  for (const [k, v] of relayCodes) if (now - v.at > RELAY_TTL) relayCodes.delete(k)
  const code = hex(16)
  relayCodes.set(code, { args, at: now })
  const prompt = `From the Mission Control App, the founder sent: ${args}\nRun it now with the console tool, args exactly: ${args} --code ${code}`
  void $.prompt.submit({ text: prompt, asUser: true }).catch((err: unknown) => log($, 'app-op', 'relay', `not sent to Flight: ${String(err).slice(0, 160)}`))
  await log($, 'app-op', 'relay', `${args.slice(0, 80)} sent to Flight`)
  return 'Sent to Flight; it runs once Flight is free.'
}

async function runAppOp($: EngineInterface, op: string, text: string, id = 0) {
  await log($, 'app-op', op, text.slice(0, 160))
  let result = ''
  if (op === 'prompt') {
    // Only the token-holding app reaches /op, so its prompt is the founder's own words, read without the plugin frame.
    await $.prompt.submit({ text, asUser: true })
    result = 'Sent to Flight.'
  } else if (op === 'console') result = isRelayedVerb(text) ? await relayToFlight($, text) : await runConsole($, text, true)
  else if (op === 'command') {
    const [command = '', ...words] = text.trim().split(/\s+/)
    if (command === 'console') result = isRelayedVerb(words.join(' ')) ? await relayToFlight($, words.join(' ')) : await runConsole($, words.join(' '), true)
    else result = (await $.command.run({ command, args: words.join(' ') })).text ?? `/${command} ran.`
  }
  lastOp = { id, text: result, at: new Date().toISOString() }
  if (app) await pushState($, app).catch(() => undefined)
}

