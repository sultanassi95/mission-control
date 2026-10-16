import { expect, test } from 'claude-code/testing'

import type { PollItem } from '../types'
import { APP_HISTORY, appPoll, asSlots, cardFacts, dependentsOf, heldText, isHeld, isNothing, isUndelivered, liveSeat, parseStatus, placeSlots, plainReason, pollId, prSignature, prsIn, seatState, SLOT_COUNT } from './loops'

// The refusal MI1's GO met on 2026-10-16, in part: written for the model, not for the founder.
const AUTO_MODE = 'The server-side auto mode classifier gave no verdict for SendMessage: the request that produced this action did not ask for one. Issue the action again once, as-is; if it is denied again, continue with other tasks and tell the user.'

const item = (over: Partial<PollItem>): PollItem => ({ id: 'MI1', at: '2026-10-16T00:30:12.000Z', from: 'MISSION-CONTROL', kind: 'gate', title: 'approve the plan', detail: 'blocked on you: approve the plan', state: 'go', agentId: 'a1', ...over })
// One entry per call sign, as staffing writes them: MISSION-CONTROL was staffed again (a1 replaced a0).
const SEATS = [
  { callSign: 'MISSION-CONTROL', agentId: 'a1', status: 'staffed' },
  { callSign: 'KARNAK', agentId: 'k1', status: 'stood-down' },
]

test('a status check is read wherever its lines sit, bullets allowed', () => {
  expect(parseStatus('quoted earlier: blocked on you: fake\nstate: ok\nblocked on you: real one').blocked).toBe('real one')
  const s = parseStatus('Results above.\n- state: tests green\nshipped: PR #4\nblocked on you: approve the schema change\nnext: wait\ncontract: /v1/media now returns ids')
  expect(s).toEqual({ state: 'tests green', shipped: 'PR #4', blocked: 'approve the schema change', next: 'wait', contract: '/v1/media now returns ids' })
  expect(parseStatus('dismissed')).toEqual({})
})

test('nothing-values do not open a gate', () => {
  for (const v of ['', 'none', 'Nothing.', 'nothing from the founder', 'n/a', '-', undefined]) expect(isNothing(v)).toBe(true)
  expect(isNothing('nothing yet')).toBe(true)
  expect(isNothing('nothing yet. The design decision is whether to import it.')).toBe(false)
  expect(isNothing('none of this is safe to merge until you approve')).toBe(false)
  expect(isNothing('merge PR #19')).toBe(false)
})

test('poll ids are short and stable, dependents come from other fronts\' maps', () => {
  expect(pollId('FIELDKIT-API', 3)).toBe('FI3')
  expect(dependentsOf('api', [{ front: 'fieldkit', text: 'api --> web' }, { front: 'shelf', text: 'uses fieldkit api for media' }, { front: 'ytkit', text: 'nothing' }], 'fieldkit')).toEqual(['shelf'])
})

test('PRs named in a report are found, and a PR signature changes when checks or comments do', () => {
  expect(prsIn('shipped: opened PR #236; see https://github.com/o/r/pull/17 and pull request #9')).toEqual([236, 17, 9])
  expect(prsIn('state: nothing')).toEqual([])
  const a = prSignature({ state: 'OPEN', comments: [], statusCheckRollup: [{ conclusion: 'FAILURE' }] })
  const b = prSignature({ state: 'OPEN', comments: [{}], statusCheckRollup: [{ conclusion: 'SUCCESS' }] })
  expect(a === b).toBe(false)
  expect(prSignature({ state: 'OPEN', comments: [{}] })).toBe(prSignature({ state: 'OPEN', comments: [{}] }))
  expect(prSignature({ state: 'OPEN', statusCheckRollup: [{ status: 'IN_PROGRESS' }] })).toBeUndefined()
})

test('a decision reaches only the staffed console of the agent that raised it', () => {
  expect(liveSeat(item({ agentId: 'a1' }), SEATS)?.agentId).toBe('a1')
  // An older agent under the same call sign is not reached through the console staffed now.
  expect(liveSeat(item({ agentId: 'a0' }), SEATS)).toBeUndefined()
  expect(liveSeat(item({ agentId: 'k1', from: 'KARNAK' }), SEATS)).toBeUndefined()
  // An item opened before agent ids were recorded goes to the console staffed under its call sign.
  expect(liveSeat(item({ agentId: '' }), SEATS)?.agentId).toBe('a1')
  expect(liveSeat(item({ agentId: '', from: 'KARNAK' }), SEATS)).toBeUndefined()
  expect(seatState(item({ agentId: 'a1' }), SEATS)).toBe('live')
  expect(seatState(item({ agentId: 'a0' }), SEATS)).toBe('replaced')
  expect(seatState(item({ agentId: 'k1', from: 'KARNAK' }), SEATS)).toBe('gone')
})

test('only a go or no-go that was not delivered is undelivered', () => {
  expect(isUndelivered(item({ state: 'go', undelivered: 'x' }))).toBe(true)
  expect(isUndelivered(item({ state: 'no-go', undelivered: 'x' }))).toBe(true)
  expect(isUndelivered(item({ state: 'go' }))).toBe(false)
  // The same answer as the app's own test of the field, which reads an empty reason as none.
  expect(isUndelivered(item({ state: 'go', undelivered: '' }))).toBe(false)
  expect(isUndelivered(item({ state: 'dismissed', undelivered: 'x' }))).toBe(false)
  expect(isUndelivered(item({ state: 'open', undelivered: 'x' }))).toBe(false)
})

test('a refusal reads as one plain sentence, never as the engine\'s instructions to the model', () => {
  expect(plainReason(AUTO_MODE)).toBe('Auto mode blocked the message.')
  expect(plainReason('no agent recorded for this item')).toBe('No Controller was staffed to receive it.')
  expect(plainReason('No agent named a9 was found')).toBe('The Controller could not be found; its session may have ended.')
  expect(plainReason('Permission to use SendMessage denied by a rule')).toBe('A permission rule blocked the message.')
  expect(plainReason('socket closed')).toBe('The message could not be delivered.')
})

test('the app gets the plain reason and where the Controller stands for an undelivered decision only', () => {
  const live = cardFacts(item({ undelivered: AUTO_MODE }), SEATS)
  expect(live.why).toBe('Auto mode blocked the message.')
  expect(live.seat).toBe('live')
  expect(live.undelivered).toBe(AUTO_MODE)
  expect(cardFacts(item({ agentId: 'a0', undelivered: AUTO_MODE }), SEATS).seat).toBe('replaced')
  expect(cardFacts(item({ agentId: 'k1', from: 'KARNAK', undelivered: AUTO_MODE }), SEATS).seat).toBe('gone')
  const open = cardFacts(item({ state: 'open' }), SEATS)
  expect(open.why).toBeUndefined()
  expect(open.seat).toBeUndefined()
})

test('the app keeps every undelivered decision and every open item, however much history follows them', () => {
  const stuck = item({ id: 'MI1', undelivered: AUTO_MODE })
  const closed = Array.from({ length: APP_HISTORY + 5 }, (_, k) => item({ id: `MI${k + 10}`, state: k % 2 ? 'dismissed' : 'go' }))
  const open = item({ id: 'MI2', state: 'open' })
  const ids = appPoll([stuck, open, ...closed]).map(p => p.id)
  expect(ids).toEqual([...closed.slice(-APP_HISTORY).map(p => p.id), 'MI1', 'MI2'])
})

// ---- Held decisions (MC-122) ----

const HELD_AT = '2026-10-16T01:00:00.000Z'

test('a held decision is a go or no-go decided after its Controller stood down', () => {
  expect(isHeld(item({ state: 'go', held: HELD_AT }))).toBe(true)
  expect(isHeld(item({ state: 'no-go', held: HELD_AT }))).toBe(true)
  expect(isHeld(item({ state: 'go' }))).toBe(false)
  expect(isHeld(item({ state: 'go', held: '' }))).toBe(false)
  // A dismissed one keeps its time as the record, and is no longer held.
  expect(isHeld(item({ state: 'dismissed', held: HELD_AT }))).toBe(false)
  expect(isHeld(item({ state: 'open', held: HELD_AT }))).toBe(false)
})

test('the app keeps every held decision, however much history follows it', () => {
  const held = item({ id: 'MI3', held: HELD_AT })
  const stuck = item({ id: 'MI1', undelivered: AUTO_MODE })
  const closed = Array.from({ length: APP_HISTORY + 5 }, (_, k) => item({ id: `MI${k + 10}`, state: k % 2 ? 'dismissed' : 'go' }))
  const open = item({ id: 'MI2', state: 'open' })
  const ids = appPoll([held, stuck, open, ...closed]).map(p => p.id)
  expect(ids).toEqual([...closed.slice(-APP_HISTORY).map(p => p.id), 'MI1', 'MI3', 'MI2'])
})

test('the next Controller is told each held decision with the report it answers, and each held advisory, in one message', () => {
  const go = item({ id: 'MI2', state: 'go', note: 'ship it', held: HELD_AT, detail: 'state: built\nblocked on you: merge the fix' })
  const nogo = item({ id: 'MI4', state: 'no-go', held: HELD_AT, title: 'drop the cache', detail: 'blocked on you: drop the cache' })
  const advisory = { id: 'p1', front: 'mission-control', text: 'Advisory from Flight: KARNAK reports a contract change: /v1 ids.', at: '2026-10-16T00:40:00.000Z' }
  const text = heldText('MISSION-CONTROL', [go, nogo], [advisory])
  expect(text).toContain('MISSION-CONTROL')
  expect(text).toContain('GO on MI2: ship it')
  expect(text).toContain('blocked on you: merge the fix')
  expect(text).toContain('NO-GO on MI4.')
  expect(text).toContain('blocked on you: drop the cache')
  expect(text).toContain('KARNAK reports a contract change: /v1 ids.')
  expect(heldText('MISSION-CONTROL', [go], [])).not.toContain('Advisor')
  expect(heldText('MISSION-CONTROL', [], [])).toBe('')
})

// ---- Call-sign colours (MC-129) ----

const T0 = '2026-10-16T08:00:00.000Z'
const T1 = '2026-10-16T09:00:00.000Z'
const T2 = '2026-10-16T09:05:00.000Z'
const seat = (callSign: string, staffedAt: string, status = 'staffed') => ({ callSign, staffedAt, status })

test('two Controllers staffed together never share a colour, the first staffed taking the lowest', () => {
  expect(placeSlots({}, [seat('SHELF', T2), seat('FIELDKIT', T1)])).toEqual({ FIELDKIT: 0, SHELF: 1 })
  // A console still being staffed holds its colour as well.
  expect(placeSlots({ FIELDKIT: 0 }, [seat('FIELDKIT', T1), seat('SHELF', T2, 'staffing')])).toEqual({ FIELDKIT: 0, SHELF: 1 })
})

test('a call sign staffed again keeps its colour, and the same map comes back when nothing moves', () => {
  const map = { FIELDKIT: 3, SHELF: 5 }
  expect(placeSlots(map, [seat('FIELDKIT', T1), seat('SHELF', T2)])).toBe(map)
  // A second record under one call sign is not a second console.
  expect(placeSlots(map, [seat('FIELDKIT', T1), seat('FIELDKIT', T2, 'staffing'), seat('SHELF', T2)])).toBe(map)
})

test('when a console staffed earlier holds the colour a call sign remembers, the later one moves to a colour no other call sign remembers', () => {
  const map = { FIELDKIT: 2, SHELF: 2, 'MISSION-CONTROL': 0 }
  expect(placeSlots(map, [seat('SHELF', T2), seat('FIELDKIT', T1), seat('MISSION-CONTROL', T0, 'stood-down')])).toEqual({ FIELDKIT: 2, SHELF: 1, 'MISSION-CONTROL': 0 })
})

test('a stood-down Controller keeps its colour, and one staffed after it takes another while one is free', () => {
  expect(placeSlots({ 'MISSION-CONTROL': 0 }, [seat('MISSION-CONTROL', T0, 'stood-down'), seat('FIELDKIT', T1)])).toEqual({ 'MISSION-CONTROL': 0, FIELDKIT: 1 })
  // Every free colour remembered by another call sign: the lowest free one is taken.
  const all = Object.fromEntries(Array.from({ length: SLOT_COUNT }, (_, n) => [`OLD-${n}`, n]))
  expect(placeSlots(all, [seat('FIELDKIT', T1)]).FIELDKIT).toBe(0)
})

test('a ninth Controller staffed beside eight has no colour, so the app draws its chip plain', () => {
  const eight = Array.from({ length: SLOT_COUNT }, (_, n) => seat(`FRONT-${n}`, `2026-10-16T09:0${n}:00.000Z`))
  const map = { ...Object.fromEntries(eight.map((s, n) => [s.callSign, n])), NINTH: 3 }
  const placed = placeSlots(map, [...eight, seat('NINTH', '2026-10-16T09:30:00.000Z')])
  expect(placed.NINTH).toBeUndefined()
  expect(eight.map(s => placed[s.callSign])).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
})

test('a stored slot map keeps only whole slot numbers in range', () => {
  expect(asSlots({ FIELDKIT: 1, SHELF: SLOT_COUNT, A: -1, B: 1.5, C: '2', D: null })).toEqual({ FIELDKIT: 1 })
  for (const bad of [undefined, null, 'x', 3, [1, 2]]) expect(asSlots(bad)).toEqual({})
})
