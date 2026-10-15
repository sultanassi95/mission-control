import { expect, test } from 'claude-code/testing'

import { dependentsOf, isNothing, parseStatus, pollId } from './loops'

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
