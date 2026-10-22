import { expect, test } from 'claude-code/testing'

import { commonDir, CONTROLLER_PROMPT, isInsideRelative, MODEL_IDS, spokePath, staffingOrder } from './controller'

test('the controller prompt carries the status format and the hard limits', () => {
  for (const line of ['state:', 'shipped:', 'blocked on you:', 'next:']) expect(CONTROLLER_PROMPT).toContain(line)
  expect(CONTROLLER_PROMPT).toContain('Never merge')
  expect(CONTROLLER_PROMPT).toContain('never push a base or deploy branch')
  expect(CONTROLLER_PROMPT).toContain('Never open another front\'s env file')
  expect(CONTROLLER_PROMPT).toContain('never edit _command/trackers/fronts.md or _command/daily/today.md')
  expect(CONTROLLER_PROMPT).toContain('answer in one line')
})

test('the controller prompt asks each decision as its own question with options, and keeps notes and to-dos apart', () => {
  for (const line of ['decisions:', 'notes:', 'for you to do:', 'contract:']) expect(CONTROLLER_PROMPT).toContain(line)
  // The exact shape the parser reads (parseDecision in loops.ts).
  expect(CONTROLLER_PROMPT).toContain('- <question> | 1) <option>: <what it does> | 2) <option>: <what it does>')
  expect(CONTROLLER_PROMPT).toContain('one you leave out is withdrawn')
  // The founder is reached only through these lines, still.
  expect(CONTROLLER_PROMPT).toContain('You cannot ask the founder directly')
})

test('the controller prompt has a Controller do what it can and ask only for what it cannot (MC-170)', () => {
  expect(CONTROLLER_PROMPT).toContain('Do it yourself when you can, screenshots and hand-tests a browser can run included')
  for (const kind of ['a decision that is the founder\'s', 'a step you cannot take', 'cannot undo', 'a merge to a deploying base', 'a production write', 'a message to a third party']) expect(CONTROLLER_PROMPT).toContain(kind)
  expect(CONTROLLER_PROMPT).toContain('Never repeat an open to-do')
  expect(CONTROLLER_PROMPT).toContain('dismissed, nothing is sent')
})

const ORDER = {
  front: 'fieldkit', project: 'api', callSign: 'FIELDKIT-API', root: '/p',
  hub: '/p/_command/portfolio/fieldkit/_front.md', spokes: ['/p/_command/portfolio/fieldkit/api/api.md'],
  cwd: '/p/fronts/fieldkit/api', budget: 2, progress: '/p/_command/portfolio/fieldkit/progress.md',
  clone: { home: '/p/fronts/fieldkit', fronts: ['fieldkit', 'kiln', 'shelf'] },
}

test('the staffing order names the scope, the files, the directory and the budget', () => {
  const order = staffingOrder(ORDER)
  expect(order).toContain('FIELDKIT-API console, owning the project "api" of front "fieldkit"')
  expect(order).toContain('Hub: /p/_command/portfolio/fieldkit/_front.md')
  expect(order).toContain('Your repo directory: /p/fronts/fieldkit/api')
  expect(order).toContain('cd /p/fronts/fieldkit/api && git')
  expect(order).toContain('Progress log: /p/_command/portfolio/fieldkit/progress.md')
  expect(order).toContain('up to 2 sub-agents')
})

test('the staffing order states the clone rule and its refusals in one line', () => {
  const lines = staffingOrder(ORDER).split('\n').filter(l => /clone/i.test(l))
  expect(lines).toEqual([
    'Clones: any repository URL (https://, http://, ssh://, git+ssh://, ssh+git://, git:// or USER@HOST:PATH) may land one level under a front\'s folder, /p/fronts/<front>/<repo>, for fieldkit, kiln, shelf;'
      + ' run it from exactly a front\'s folder or your console\'s directory, named by its full path with no ..: `cd /p/fronts/fieldkit && git clone <url>`.'
      + ' Refused: a remote helper (HELPER::), a file:// or local-path source, this Mac as the host (localhost, 127.x.x.x, 0.x.x.x) or a host written as a number other than a.b.c.d,'
      + ' a host or user starting with -, a folder starting with ., a .. after a folder name in the destination, a landing anywhere else,'
      + ' and any option but --depth N, --branch NAME or -b NAME, --single-branch, --no-single-branch, --filter=blob:none, --origin NAME, -q or --quiet, --no-tags.',
  ])
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

test('every console model alias maps to a request id', () => {
  expect(Object.keys(MODEL_IDS).sort()).toEqual(['fable', 'haiku', 'opus', 'sonnet'])
  for (const id of Object.values(MODEL_IDS)) expect(id).toMatch(/^claude-[a-z]+-\d+-\d+$/)
})
