import { expect, test } from 'claude-code/testing'

import type { PollItem } from '../types'
import { answerWord, APP_HISTORY, appPoll, asSlots, cardFacts, decisionText, dependentsOf, GO_NOGO, heldText, isHeld, isNothing, isUndelivered, liveSeat, MAX_DECISIONS, MAX_TODOS, optionsOf, parseDecision, parseReport, parseStatus, placeSlots, plainReason, pollId, prSignature, prsIn, seatState, SLOT_COUNT } from './loops'

// The refusal MI1's GO met on 2026-10-16, in part: written for the model, not for the founder.
const AUTO_MODE = 'The server-side auto mode classifier gave no verdict for SendMessage: the request that produced this action did not ask for one. Issue the action again once, as-is; if it is denied again, continue with other tasks and tell the user.'

const item = (over: Partial<PollItem>): PollItem => ({ id: 'MI1', at: '2026-10-16T00:30:12.000Z', from: 'MISSION-CONTROL', kind: 'gate', title: 'approve the plan', detail: 'blocked on you: approve the plan', state: 'go', agentId: 'a1', ...over })
// One entry per call sign, as staffing writes them: MISSION-CONTROL was staffed again (a1 replaced a0).
const SEATS = [
  { callSign: 'MISSION-CONTROL', agentId: 'a1', status: 'staffed' },
  { callSign: 'ACME', agentId: 'k1', status: 'stood-down' },
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
  expect(dependentsOf('api', [{ front: 'fieldkit', text: 'api --> web' }, { front: 'shelf', text: 'uses fieldkit api for media' }, { front: 'initech', text: 'nothing' }], 'fieldkit')).toEqual(['shelf'])
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
  expect(liveSeat(item({ agentId: 'k1', from: 'ACME' }), SEATS)).toBeUndefined()
  // An item opened before agent ids were recorded goes to the console staffed under its call sign.
  expect(liveSeat(item({ agentId: '' }), SEATS)?.agentId).toBe('a1')
  expect(liveSeat(item({ agentId: '', from: 'ACME' }), SEATS)).toBeUndefined()
  expect(seatState(item({ agentId: 'a1' }), SEATS)).toBe('live')
  expect(seatState(item({ agentId: 'a0' }), SEATS)).toBe('replaced')
  expect(seatState(item({ agentId: 'k1', from: 'ACME' }), SEATS)).toBe('gone')
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
  expect(cardFacts(item({ agentId: 'k1', from: 'ACME', undelivered: AUTO_MODE }), SEATS).seat).toBe('gone')
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
  const advisory = { id: 'p1', front: 'mission-control', text: 'Advisory from Flight: ACME reports a contract change: /v1 ids.', at: '2026-10-16T00:40:00.000Z' }
  const text = heldText('MISSION-CONTROL', [go, nogo], [advisory])
  expect(text).toContain('MISSION-CONTROL')
  expect(text).toContain('GO on MI2: ship it')
  expect(text).toContain('blocked on you: merge the fix')
  expect(text).toContain('NO-GO on MI4.')
  expect(text).toContain('blocked on you: drop the cache')
  expect(text).toContain('ACME reports a contract change: /v1 ids.')
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

// ---- Decisions asked in Flight's chat (MC-125) ----

const REPORT = [
  'state: MC-136 planned',
  'shipped: nothing',
  'blocked on you: two decisions below',
  'next: build once answered',
  'decisions:',
  '- Which branch should MC-136 build on? | 1) The epic branch: lands with MC-124\'s PR | 2) Its own branch off main: a separate PR after MC-124',
  '- Keep the old Poll for a week? | 1) Keep it: both views for a week | 2) Drop it: read-only from today',
  'notes: the sweep found 0 hits',
  'for you to do:',
  '- Close PR #31 https://github.com/o/r/pull/31',
].join('\n')

test('a report\'s decisions, notes and to-dos are read as blocks, each decision with its options and what each does', () => {
  const r = parseReport(REPORT)
  expect(r.state).toBe('MC-136 planned')
  expect(r.blocked).toBe('two decisions below')
  expect(r.next).toBe('build once answered')
  expect(r.notes).toBe('the sweep found 0 hits')
  expect(r.todos).toEqual(['Close PR #31 https://github.com/o/r/pull/31'])
  expect(r.decisions).toEqual([
    { question: 'Which branch should MC-136 build on?', options: [{ label: 'The epic branch', does: 'lands with MC-124\'s PR' }, { label: 'Its own branch off main', does: 'a separate PR after MC-124' }] },
    { question: 'Keep the old Poll for a week?', options: [{ label: 'Keep it', does: 'both views for a week' }, { label: 'Drop it', does: 'read-only from today' }] },
  ])
  // The status check the console card reads is the same as before.
  expect(parseStatus(REPORT)).toEqual({ state: 'MC-136 planned', shipped: 'nothing', blocked: 'two decisions below', next: 'build once answered' })
})

test('a decision with fewer than two options keeps none, and is asked as Go or No-go', () => {
  expect(parseDecision('Merge PR #12 now?')).toEqual({ question: 'Merge PR #12 now?', options: [] })
  expect(parseDecision('Merge PR #12 now? | 1) Yes: merge it')).toEqual({ question: 'Merge PR #12 now?', options: [] })
  // An option with no "what it does" keeps its label alone; a label may hold a colon with no space after it.
  expect(parseDecision('Port? | 1) 4777 | 2) 8080:alt')).toEqual({ question: 'Port?', options: [{ label: '4777' }, { label: '8080:alt' }] })
  expect(optionsOf({ kind: 'question', options: [] })).toEqual(GO_NOGO)
  expect(optionsOf({ kind: 'gate' })).toEqual(GO_NOGO)
  expect(GO_NOGO.map(o => o.label)).toEqual(['Go', 'No-go'])
  const tell = optionsOf({ kind: 'advisory', targets: ['shelf'] })
  expect(tell.map(o => o.label)).toEqual(['Tell them', 'Don\'t tell'])
  expect(tell[0]?.does).toContain('shelf')
})

test('nothing-like lines open nothing: an empty decisions block is an empty list, a missing one is no list', () => {
  expect(parseReport('state: ok\nnotes: fyi only\ncontract: none').decisions).toBeUndefined()
  expect(parseReport('state: ok\ndecisions: none').decisions).toEqual([])
  expect(parseReport('decisions:\n- none\nnext: wait').decisions).toEqual([])
  expect(parseReport('for you to do: nothing').todos).toEqual([])
  expect(parseReport('state: ok').todos).toBeUndefined()
  // The lines that opened empty gates on 2026-10-16 (SM31, TA26).
  for (const v of ['none new.', 'nothing new', 'Nothing new from me', 'none open']) expect(isNothing(v)).toBe(true)
  expect(isNothing('nothing new is safe to merge until you approve')).toBe(false)
})

test('a decisions block withdraws the open questions only when it is certain: items that parse, or a header that says none', () => {
  // Said none, in more words than "none".
  for (const v of ['none right now', 'none pending', 'nothing at the moment']) expect(parseReport(`decisions: ${v}`).decisions).toEqual([])
  // Header text that is not a decision, and nothing beneath that parses: no list, so nothing is withdrawn.
  expect(parseReport('decisions: see below\nWhich branch? A or B\nnext: wait').decisions).toBeUndefined()
  expect(parseReport('decisions:\nWhich branch? A or B').decisions).toBeUndefined()
  // Header text with options is a decision.
  expect(parseReport('decisions: Ship it? | 1) Yes: ship | 2) No: wait').decisions?.map(d => d.question)).toEqual(['Ship it?'])
  // Options on their own indented lines belong to the decision above them.
  const folded = parseReport('decisions:\n- Which branch?\n  1) The epic: one review\n  2) Main: a later PR\n- Keep the old Poll? | 1) Yes: a week | 2) No: today').decisions
  expect(folded?.map(d => `${d.question} ${d.options.map(o => o.label).join('/')}`)).toEqual(['Which branch? The epic/Main', 'Keep the old Poll? Yes/No'])
  // CRLF reads as LF.
  expect(parseReport('state: ok\r\ndecisions: none\r\nfor you to do:\r\n- Close PR #31\r\n').todos).toEqual(['Close PR #31'])
  expect(parseReport('state: ok\r\ndecisions: none\r\n').decisions).toEqual([])
})

test('a status line ends a block, and a bulleted status line inside one is never a decision', () => {
  const r = parseReport('decisions:\n- Ship it? | 1) Yes: ship | 2) No: wait\n- next: wait for the founder\n- state: planned')
  expect(r.decisions?.map(d => d.question)).toEqual(['Ship it?'])
  expect(r.next).toBe('wait for the founder')
  expect(r.state).toBe('planned')
  // A blank line ends a block too; the line after it is not an item.
  expect(parseReport('for you to do:\n- close #3\n\n- an aside').todos).toEqual(['close #3'])
  // The last decisions block is the one that counts, like the last status line.
  expect(parseReport('decisions:\n- old? | 1) a: x | 2) b: y\nstate: s\ndecisions:\n- new? | 1) c: x | 2) d: y').decisions?.map(d => d.question)).toEqual(['new?'])
})

test('a report holds at most MAX_DECISIONS decisions and MAX_TODOS to-dos, and long text is cut', () => {
  const many = ['decisions:', ...Array.from({ length: MAX_DECISIONS + 3 }, (_, k) => `- Q${k}? | 1) a: x | 2) b: y`), 'for you to do:', ...Array.from({ length: MAX_TODOS + 3 }, (_, k) => `- T${k}`)].join('\n')
  const r = parseReport(many)
  expect(r.decisions).toHaveLength(MAX_DECISIONS)
  expect(r.todos).toHaveLength(MAX_TODOS)
  expect(parseDecision(`${'q'.repeat(900)} | 1) a: x | 2) b: y`).question.length).toBeLessThanOrEqual(400)
})

const QUESTION = item({ id: 'MI7', kind: 'question', state: 'open', title: 'Which branch should MC-136 build on?', options: [{ label: 'The epic branch', does: 'lands with MC-124\'s PR' }, { label: 'Its own branch off main', does: 'a separate PR after MC-124' }] })

test('an answered question is a decision like a go: it can be undelivered or held', () => {
  const answered: PollItem = { ...QUESTION, state: 'answered', choice: 2 }
  expect(isUndelivered({ ...answered, undelivered: 'x' })).toBe(true)
  expect(isHeld({ ...answered, held: HELD_AT })).toBe(true)
  expect(isUndelivered({ ...QUESTION, state: 'done', undelivered: 'x' })).toBe(false)
  expect(answerWord({ ...QUESTION, state: 'answered', choice: 2 })).toBe('2) Its own branch off main')
  expect(answerWord(item({ state: 'no-go' }))).toBe('NO-GO')
})

test('the Controller is told the option chosen and what it does, and only that question', () => {
  const text = decisionText(QUESTION, 2, 'after the sweep')
  expect(text).toContain('The founder answered MI7: 2) Its own branch off main - a separate PR after MC-124.')
  expect(text).toContain('Note: after the sweep')
  expect(text).toContain('Your question: Which branch should MC-136 build on?')
  expect(text).not.toContain('The epic branch')
  // A legacy gate keeps its GO or NO-GO and the report it answers.
  const gate = decisionText(item({ state: 'open' }), 2, '')
  expect(gate).toContain('NO-GO from the founder on MI1.')
  expect(gate).toContain('blocked on you: approve the plan')
  // A held answer reaches the next Controller in the same words.
  expect(heldText('MISSION-CONTROL', [{ ...QUESTION, state: 'answered', choice: 1, held: HELD_AT }], [])).toContain('The founder answered MI7: 1) The epic branch')
})

test('the app is given each open question\'s options and each decision\'s answer, so the page decides neither', () => {
  expect(cardFacts(QUESTION, SEATS).asks).toEqual(QUESTION.options)
  expect(cardFacts(item({ state: 'open' }), SEATS).asks).toEqual(GO_NOGO)
  expect(cardFacts({ ...QUESTION, kind: 'todo', options: undefined }, SEATS).asks).toBeUndefined()
  expect(cardFacts({ ...QUESTION, state: 'answered', choice: 1 }, SEATS).answer).toBe('1) The epic branch')
  expect(cardFacts({ ...QUESTION, state: 'answered', choice: 1 }, SEATS).asks).toBeUndefined()
  expect(cardFacts(item({ state: 'no-go' }), SEATS).answer).toBe('NO-GO')
})
