// The spend ledger: model calls summed per session and per agent. Pure data, no engine calls,
// so it is tested on its own and the hooks only feed it.

export type Usage = { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }
export type Step = { agent: string; model: string; effort?: string; usage: Usage }
export type Line = { label: string; type: string; model: string; effort: string; calls: number; input: number; output: number; cacheRead: number; cacheWrite: number }
export type Session = { id: string; started: string; updated: string; lines: Record<string, Line> }
export type Ledger = { sessions: Session[] }

/** How many past sessions the store keeps; the newest are kept. */
export const KEEP = 30
export const MAIN = 'main'

const blank = (label: string, type: string): Line => ({ label, type, model: '', effort: '', calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })

/** Adds one model call to the session's line for its agent (Flight's own calls are 'main'). */
export function addStep(ledger: Ledger, sessionId: string, at: string, step: Step, labelOf?: (agent: string) => { label: string; type: string } | undefined): Ledger {
  const sessions = [...ledger.sessions]
  let i = sessions.findIndex(s => s.id === sessionId)
  if (i < 0) {
    sessions.push({ id: sessionId, started: at, updated: at, lines: {} })
    i = sessions.length - 1
  }
  const s = sessions[i] as Session
  const known = labelOf?.(step.agent)
  const prev = s.lines[step.agent] ?? blank(step.agent === MAIN ? 'Flight (main session)' : known?.label ?? step.agent, step.agent === MAIN ? 'main' : known?.type ?? 'agent')
  const u = step.usage
  const line: Line = {
    ...prev,
    model: step.model || prev.model,
    effort: step.effort ?? prev.effort,
    calls: prev.calls + 1,
    input: prev.input + (u.input_tokens || 0),
    output: prev.output + (u.output_tokens || 0),
    cacheRead: prev.cacheRead + (u.cache_read_input_tokens || 0),
    cacheWrite: prev.cacheWrite + (u.cache_creation_input_tokens || 0),
  }
  sessions[i] = { ...s, updated: at, lines: { ...s.lines, [step.agent]: line } }
  return { sessions: sessions.slice(-KEEP) }
}

/** Names an agent that started after its first call was recorded. */
export function label(ledger: Ledger, sessionId: string, agent: string, name: string, type: string): Ledger {
  return {
    sessions: ledger.sessions.map(s => (s.id === sessionId && s.lines[agent] ? { ...s, lines: { ...s.lines, [agent]: { ...(s.lines[agent] as Line), label: name, type } } } : s)),
  }
}

const n = (v: number) => v.toLocaleString('en-US')

/** The session's table, biggest spender first, then totals. Tokens only: prices live in the instance's routing doctrine. */
export function report(session: Session | undefined): string {
  if (!session || !Object.keys(session.lines).length) return 'No model calls recorded in this session yet.'
  const lines = Object.values(session.lines).sort((a, b) => b.input + b.cacheRead + b.cacheWrite + b.output - (a.input + a.cacheRead + a.cacheWrite + a.output))
  const rows = lines.map(l => `| ${l.label.replace(/\|/g, '/')} | ${l.type} | ${l.model} | ${l.effort || '-'} | ${l.calls} | ${n(l.input)} | ${n(l.cacheRead)} | ${n(l.cacheWrite)} | ${n(l.output)} |`)
  const t = lines.reduce((a, l) => ({ calls: a.calls + l.calls, input: a.input + l.input, cacheRead: a.cacheRead + l.cacheRead, cacheWrite: a.cacheWrite + l.cacheWrite, output: a.output + l.output }), { calls: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0 })
  return [
    `Measured spend, session ${session.id.slice(0, 8)} (${session.started.slice(0, 16)} to ${session.updated.slice(0, 16)} UTC)`,
    '',
    '| who | type | model | effort | calls | input | cache read | cache write | output |',
    '|---|---|---|---|---|---|---|---|---|',
    ...rows,
    `| **total** | | | | ${t.calls} | ${n(t.input)} | ${n(t.cacheRead)} | ${n(t.cacheWrite)} | ${n(t.output)} |`,
  ].join('\n')
}

/** One line per kept session: when, calls and tokens. */
export function history(ledger: Ledger): string {
  if (!ledger.sessions.length) return 'No sessions recorded yet.'
  return ledger.sessions
    .slice()
    .reverse()
    .map(s => {
      const ls = Object.values(s.lines)
      const tokens = ls.reduce((a, l) => a + l.input + l.cacheRead + l.cacheWrite + l.output, 0)
      return `${s.updated.slice(0, 16)}  ${s.id.slice(0, 8)}  ${ls.reduce((a, l) => a + l.calls, 0)} calls  ${n(tokens)} tokens  ${ls.length} agents`
    })
    .join('\n')
}
