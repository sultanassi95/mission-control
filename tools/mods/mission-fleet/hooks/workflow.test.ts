import { expect, test } from 'claude-code/testing'

import { workflowCheck } from './workflow'

const META = "export const meta = { name: 'scan', description: 'd' }\n"
const SIZED = "{ model: 'sonnet', effort: 'low' }"
const W = (body: string, room = 4) => workflowCheck({ script: META + body }, room)

test('a sized script within the room is admitted, and its agents are counted from the code', () => {
  expect(W(`await agent('read a', ${SIZED})\nreturn await agent('read b', ${SIZED})`)).toEqual({ agents: 2 })
  // A map over an array the code writes out runs its callback once per element.
  expect(W(`const out = await parallel(['a', 'b', 'c'].map(f => () => agent(\`read \${f}\`, ${SIZED})))\nreturn out`)).toEqual({ agents: 3 })
  expect(W(`await Promise.all(['a', 'b'].map(async f => agent(f, ${SIZED})))`)).toEqual({ agents: 2 })
  // parallel over thunks written out, and pipeline stages over a fixed list.
  expect(W(`await parallel([() => agent('a', ${SIZED}), async () => { await agent('b', ${SIZED}) }])`)).toEqual({ agents: 2 })
  expect(W(`await pipeline(['x', 'y'], r => agent(r, ${SIZED}), r => agent(r, ${SIZED}))`)).toEqual({ agents: 4 })
  // Words in strings and comments are not code, and a worktree isolation is allowed.
  expect(W(`log('agent(x) and workflow( and this are words') // agent(\nawait agent('p', { model: 'haiku', effort: 'low', isolation: 'worktree', label: 'x' })`)).toEqual({ agents: 1 })
  // Indexing by a literal number or string, and reading args, is plain data.
  expect(W(`const r = await agent(args.files[0], ${SIZED})\nlog(r['summary'])`)).toEqual({ agents: 1 })
})

test('a script that could start more agents than the back room has room for is refused, an unbounded one included', () => {
  expect(W(`await parallel(['a', 'b', 'c'].map(f => () => agent(f, ${SIZED})))`, 2).refusal).toContain('can start 3 agents, and the back room has room for 2')
  for (const body of [
    `for (const f of args.files) await agent(f, ${SIZED})`,
    `let i = 0\nwhile (i++ < 3) await agent('x', ${SIZED})`,
    `await parallel(args.files.map(f => () => agent(f, ${SIZED})))`,
    `const go = () => agent('x', ${SIZED})\nawait go()\nawait go()`,
    `function go() { return agent('x', ${SIZED}) }\nawait go()`,
    `args.files.forEach(f => agent(f, ${SIZED}))`,
  ]) expect(`${body} -> ${W(body, 100).refusal ?? 'admitted'}`).toContain('an unbounded number of agents')
})

test('every agent() call states a literal model and effort in a plain object of its own', () => {
  const NEEDS = 'An agent() call in the workflow script is refused'
  for (const body of [
    `await agent('p')`,
    `await agent('p', { model: 'sonnet' })`,
    `await agent('p', { model: m, effort: 'low' })`,
    `await agent('p', { model: \`\${m}\`, effort: 'low' })`,
    `await agent('p', OPTS)`,
    `await agent('p', { ...OPTS, model: 'sonnet', effort: 'low' })`,
    `await agent('p', { model: 'sonnet', effort: 'low', model: 'opus' })`,
    `await agent('p', { ['model']: 'sonnet', effort: 'low' })`,
    `await agent('p', { nested: { model: 'sonnet', effort: 'low' } })`,
    `await agent('p', {}, { model: 'sonnet', effort: 'low' })`,
    `await agent('p', { model: 'sonnet', effort: 'low', isolation: 'remote' })`,
  ]) expect(`${body} -> ${W(body).refusal ?? 'admitted'}`).toContain(NEEDS)
})

test('agent is used only as a direct call: no alias, no shadowing, no optional or indirect call', () => {
  const DIRECT = 'uses agent other than as a direct call'
  for (const body of [
    `const a = agent\nawait a('p', ${SIZED})`,
    `await agent?.('p', ${SIZED})`,
    `await (0, agent)('p', ${SIZED})`,
    `await [agent][0]('p', ${SIZED})`,
    `const agent = x => x\nawait agent('p')`,
    `await parallel(['a'].map(agent => agent('p')))`,
    `const o = { agent }`,
  ]) expect(`${body} -> ${W(body).refusal ?? 'admitted'}`).toContain(DIRECT)
  // A unicode escape spells the same name; the parser reads it as agent, so its options are checked.
  expect(W(`await \\u0061gent('p')`).refusal).toContain('An agent() call in the workflow script is refused')
})

test('nothing reaches the global object, builds a function or runs a script the guard has not read', () => {
  for (const [body, why] of [
    ["parallel.constructor('return 1')()", 'may not reach .constructor'],
    ["this['ag' + 'ent']('p')", 'indexes only by a literal number or string'],
    ["this.agent('p')", 'may not use this'],
    ["const g = this\ng['agent']('p')", 'may not use this'],
    ["Reflect.apply(agent, null, ['p'])", 'may not reach .apply'],
    ["Reflect.ownKeys(parallel)", 'may not use Reflect'],
    ["agent.call(null, 'p')", 'may not reach .call'],
    ["globalThis.agent('p')", 'may not use globalThis'],
    ["eval('agent(1)')", 'may not use eval'],
    ["new Function('return this')()", 'may not use new Function'],
    ["const F = Function", 'may not use Function'],
    ["Object.getOwnPropertyDescriptor(Object.getPrototypeOf(parallel), 'constructor').value('return this')()", 'may not reach .getOwnPropertyDescriptor'],
    ["const k = 'constr' + 'uctor'\n;[][k]", 'indexes only by a literal number or string'],
    ["const s = args.list\nlog(s[args.i])", 'indexes only by a literal number or string'],
    ["await workflow('other')", 'may not use workflow'],
    ["await import('./x.js')", 'may not use import'],
    ["log`x`", 'may not use a tagged template'],
    ["class A {}", 'may not use a class'],
    ["with (args) { log(x) }", 'does not parse'],
    ["if (x) /'/.test(s); agent('p')", 'An agent() call in the workflow script is refused'],
  ] as const) expect(`${body} -> ${W(`${body}\nawait agent('q', ${SIZED})`).refusal ?? 'admitted'}`).toContain(why)
})

test('only an inline script is read: a saved workflow, a script file or a resumed run is refused, and so is one that does not parse', () => {
  expect(workflowCheck({ name: 'review-changes' }, 4).refusal).toContain('name is not allowed')
  expect(workflowCheck({ script: `${META}await agent('p', ${SIZED})`, scriptPath: '/tmp/x.js' }, 4).refusal).toContain('scriptPath is not allowed')
  expect(workflowCheck({ script: `${META}await agent('p', ${SIZED})`, resumeFromRunId: 'wf_1' }, 4).refusal).toContain('resumeFromRunId is not allowed')
  expect(workflowCheck({ script: '' }, 4).refusal).toContain('only from an inline script')
  expect(W("log('open").refusal).toContain('does not parse')
  expect(W("log('x')").refusal).toContain('calls no agent()')
  expect(W(`export const other = 1\nawait agent('p', ${SIZED})`).refusal).toContain('exports nothing but its meta')
})
