import { expect, test } from 'claude-code/testing'

import { commonDir, CONTROLLER_PROMPT, isInsideRelative, spokePath, staffingOrder } from './controller'

test('the controller prompt carries the status format and the hard limits', () => {
  for (const line of ['state:', 'shipped:', 'blocked on you:', 'next:']) expect(CONTROLLER_PROMPT).toContain(line)
  expect(CONTROLLER_PROMPT).toContain('Never merge')
  expect(CONTROLLER_PROMPT).toContain('never push a base or deploy branch')
  expect(CONTROLLER_PROMPT).toContain('Never open another front\'s env file')
  expect(CONTROLLER_PROMPT).toContain('never edit _command/trackers/fronts.md or _command/daily/today.md')
  expect(CONTROLLER_PROMPT).toContain('answer in one line')
})

test('the staffing order names the scope, the files, the directory and the budget', () => {
  const order = staffingOrder({
    front: 'fieldkit', project: 'api', callSign: 'FIELDKIT-API', root: '/p',
    hub: '/p/_command/portfolio/fieldkit/_front.md', spokes: ['/p/_command/portfolio/fieldkit/api/api.md'],
    cwd: '/p/fronts/fieldkit/api', budget: 2,
  })
  expect(order).toContain('FIELDKIT-API console, owning the project "api" of front "fieldkit"')
  expect(order).toContain('Hub: /p/_command/portfolio/fieldkit/_front.md')
  expect(order).toContain('Your working directory: /p/fronts/fieldkit/api')
  expect(order).toContain('up to 2 sub-agents')
})

test('a spoke path is the first token of its frontmatter path line', () => {
  expect(spokePath('---\nrepo: api\npath: fronts/fieldkit/api   (fresh clone)\n---\n# api')).toBe('fronts/fieldkit/api')
  expect(spokePath('---\nrepo: api\n---\npath: not-frontmatter')).toBeUndefined()
  expect(spokePath('# no frontmatter')).toBeUndefined()
})

test('the shared directory of several repos is their deepest common parent', () => {
  expect(commonDir(['fronts/fieldkit/api', 'fronts/fieldkit/web'])).toBe('fronts/fieldkit')
  expect(commonDir(['fronts/shelf'])).toBe('fronts/shelf')
  expect(commonDir(['fronts/a/x', 'other/b'])).toBe('')
  expect(commonDir([])).toBe('')
})

test('only relative spoke paths with no parent segment are trusted', () => {
  expect(isInsideRelative('fronts/fieldkit/api')).toBe(true)
  expect(isInsideRelative('/abs/repo')).toBe(false)
  expect(isInsideRelative('../../other/repo')).toBe(false)
  expect(isInsideRelative('fronts/../../x')).toBe(false)
})
