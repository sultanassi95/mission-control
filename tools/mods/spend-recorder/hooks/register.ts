import type { EngineInterface, Register } from 'claude-code'

import { addStep, history, label, MAIN, report } from './ledger'
import type { Ledger } from './ledger'

// Every model call the session makes, Flight's and each subagent's, summed into $.store under one
// key, so /spend reads measured tokens instead of estimating them.
const KEY = 'ledger'
const TOOL = 'mcp__spend-recorder__spend'

// Names of agents this module saw start, for calls recorded before or after the label lands.
const names = new Map<string, { label: string; type: string }>()
// One write at a time: two steps finishing together must not both read the old ledger.
let chain: Promise<unknown> = Promise.resolve()

async function load($: EngineInterface): Promise<Ledger> {
  const v = (await $.store.get(KEY).catch(() => undefined)) as Ledger | undefined
  return v && Array.isArray(v.sessions) ? v : { sessions: [] }
}

function write($: EngineInterface, change: (l: Ledger, sessionId: string) => Ledger): Promise<void> {
  const run = chain.then(async () => {
    const sessionId = await $.session.id()
    await $.store.set(KEY, change(await load($), sessionId))
  })
  chain = run.catch(() => undefined)
  return run
}

async function answer($: EngineInterface, args: string): Promise<string> {
  const ledger = await load($)
  if (/--sessions\b/.test(args)) return history(ledger)
  const id = await $.session.id()
  return report(ledger.sessions.find(s => s.id === id))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'spend-log', description: 'Measured tokens for this session, per agent (--sessions for the history)' })
    await $.tool.register({
      name: 'spend',
      description: 'Measured model usage for this session: model, effort, calls and tokens per agent, read from the spend recorder. Pass args "--sessions" for one line per recent session.',
      inputSchema: { type: 'object', properties: { args: { type: 'string', description: 'empty, or "--sessions"' } } },
      isDeferred: false,
    })
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const r = yield* next(e)
    const u = r.usage
    if (u) {
      const agent = e.agentId ?? MAIN
      const effort = e.effort === undefined ? undefined : String(e.effort)
      void write($, (l, id) => addStep(l, id, new Date().toISOString(), { agent, model: u.model || e.model, effort, usage: u }, a => names.get(a))).catch(() => undefined)
    }
    return r
  })

  // No fallback on this hook: its only throwing path is the spawn itself, and a recorder must not
  // turn a failed spawn into a made-up result.
  on('agent.spawn', async ($, e, next) => {
    const res = await next(e)
    const id = res.agentId
    if (id) {
      const name = { label: e.description || e.subagentType, type: e.subagentType }
      names.set(id, name)
      void write($, (l, sid) => label(l, sid, id, name.label, name.type)).catch(() => undefined)
    }
    return res
  })

  on('command.run', { command: 'spend-log' }, async ($, e) => ({ text: await answer($, e.args) }))
    .catch(() => ({ text: 'The spend recorder could not read its ledger.' }))

  on('tool.call', { tool: new RegExp(`^${TOOL}$`) }, async ($, e) => {
    const args = typeof (e as { args?: unknown }).args === 'string' ? (e as { args: string }).args : ''
    return { result: await answer($, args) }
  }).catch(() => ({ result: 'The spend recorder could not read its ledger.', isError: true }))
}
