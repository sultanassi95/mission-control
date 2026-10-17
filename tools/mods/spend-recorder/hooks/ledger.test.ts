import { expect, test } from 'claude-code/testing'

import { addStep, history, KEEP, label, MAIN, report } from './ledger'
import type { Ledger } from './ledger'

const u = (i: number, o: number, r = 0, w = 0) => ({ input_tokens: i, output_tokens: o, cache_read_input_tokens: r, cache_creation_input_tokens: w })
const empty: Ledger = { sessions: [] }

test('addStep: sums calls per agent within a session', () => {
  let l = addStep(empty, 's1', '2026-10-15T10:00:00Z', { agent: MAIN, model: 'claude-opus-5-5', effort: 'high', usage: u(10, 5, 100, 20) }) // MC-LEAK-EXEMPT: a real model id as test data
  l = addStep(l, 's1', '2026-10-15T10:01:00Z', { agent: MAIN, model: 'claude-opus-5-5', effort: 'high', usage: u(1, 2, 3, 4) }) // MC-LEAK-EXEMPT: a real model id as test data
  l = addStep(l, 's1', '2026-10-15T10:02:00Z', { agent: 'a1', model: 'claude-haiku-5-5', effort: 'low', usage: u(7, 8) }) // MC-LEAK-EXEMPT: a real model id as test data
  const s = l.sessions[0]!
  expect(s.lines[MAIN]).toMatchObject({ calls: 2, input: 11, output: 7, cacheRead: 103, cacheWrite: 24, label: 'Flight (main session)', type: 'main' })
  expect(s.lines['a1']).toMatchObject({ calls: 1, input: 7, output: 8, model: 'claude-haiku-5-5', effort: 'low' }) // MC-LEAK-EXEMPT: a real model id as test data
  expect(s.updated).toBe('2026-10-15T10:02:00Z')
  expect(s.started).toBe('2026-10-15T10:00:00Z')
})

test('addStep: keeps sessions apart and only the newest KEEP of them', () => {
  let l = empty
  for (let i = 0; i < KEEP + 5; i++) l = addStep(l, `s${i}`, '2026-10-15T10:00:00Z', { agent: MAIN, model: 'm', usage: u(1, 1) })
  expect(l.sessions.length).toBe(KEEP)
  expect(l.sessions[0]!.id).toBe('s5')
  expect(l.sessions[KEEP - 1]!.id).toBe(`s${KEEP + 4}`)
})

test('addStep: names an agent from the spawn record when it is known', () => {
  const l = addStep(empty, 's1', 't', { agent: 'a1', model: 'm', usage: u(1, 1) }, a => (a === 'a1' ? { label: 'review diff', type: 'Explore' } : undefined))
  expect(l.sessions[0]!.lines['a1']).toMatchObject({ label: 'review diff', type: 'Explore' })
})

test('addStep: does not mutate the ledger it was given', () => {
  const before = addStep(empty, 's1', 't', { agent: MAIN, model: 'm', usage: u(1, 1) })
  const snapshot = JSON.stringify(before)
  addStep(before, 's1', 't2', { agent: MAIN, model: 'm', usage: u(5, 5) })
  expect(JSON.stringify(before)).toBe(snapshot)
})

test('label: renames an agent whose calls landed first', () => {
  let l = addStep(empty, 's1', 't', { agent: 'a1', model: 'm', usage: u(1, 1) })
  expect(l.sessions[0]!.lines['a1']!.label).toBe('a1')
  l = label(l, 's1', 'a1', 'implement fix', 'general-purpose')
  expect(l.sessions[0]!.lines['a1']).toMatchObject({ label: 'implement fix', type: 'general-purpose', calls: 1 })
})
test('label: ignores an agent with no calls yet', () => {
  const l = label(addStep(empty, 's1', 't', { agent: MAIN, model: 'm', usage: u(1, 1) }), 's1', 'a9', 'x', 'y')
  expect(l.sessions[0]!.lines['a9']).toBeUndefined()
})

test('report: says so when nothing is recorded', () => {
  expect(report(undefined)).toContain('No model calls')
})
test('report: lists the biggest spender first and totals every column', () => {
  let l = addStep(empty, 'abcdef123456', '2026-10-15T10:00:00Z', { agent: 'a1', model: 'h', usage: u(1, 1) })
  l = addStep(l, 'abcdef123456', '2026-10-15T10:05:00Z', { agent: MAIN, model: 'o', effort: 'high', usage: u(1000, 2000, 30000, 400) })
  const out = report(l.sessions[0])
  expect(out.indexOf('Flight (main session)')).toBeLessThan(out.indexOf('| a1 |'))
  expect(out).toContain('| **total** | | | | 2 | 1,001 | 30,000 | 400 | 2,001 |')
  expect(out).toContain('session abcdef12')
})
test('report: a pipe in an agent label cannot break the table', () => {
  const l = label(addStep(empty, 's', 't', { agent: 'a1', model: 'm', usage: u(1, 1) }), 's', 'a1', 'a|b', 'x')
  expect(report(l.sessions[0])).toContain('| a/b |')
})

test('history: newest session first with calls and tokens', () => {
  let l = addStep(empty, 'old00000', '2026-10-14T09:00:00Z', { agent: MAIN, model: 'm', usage: u(10, 10) })
  l = addStep(l, 'new00000', '2026-10-15T09:00:00Z', { agent: MAIN, model: 'm', usage: u(1, 2, 3, 4) })
  const lines = history(l).split('\n')
  expect(lines[0]).toBe('2026-10-15T09:00  new00000  1 calls  10 tokens  1 agents')
  expect(lines[1]).toContain('old00000')
})
