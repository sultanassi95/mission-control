import { expect, test } from 'claude-code/testing'

import type { PollItem } from '../types'
import { APP_HISTORY, appPoll, cardFacts, dependentsOf, isNothing, isUndelivered, liveSeat, parseStatus, plainReason, pollId, prSignature, prsIn, seatState } from './loops'

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
