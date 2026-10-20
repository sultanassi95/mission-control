/*
 * Whether a Controller may run a Workflow script, read by a JavaScript parser (acorn, vendored in
 * ./vendor). The script runs only agent(), parallel(), pipeline(), phase() and log() as written:
 * every agent() is a direct call whose options are a plain object with a literal model and effort,
 * nothing reaches the global object or builds a function, and the number of agents it can start is
 * counted from the code, so a run never starts more than the Controller's back room has room for.
 */

import { parse } from './vendor/acorn.mjs'

// Any node of the parsed tree, read structurally.
type Node = { type: string; [key: string]: unknown }

/** Names a script may not mention: they reach the global object, run text as code, or start a workflow the guard has not read. */
const NAMES = new Set(['globalThis', 'self', 'window', 'global', 'eval', 'Function', 'require', 'process', 'Reflect', 'Proxy', 'Bun', 'Deno', 'arguments', 'workflow', 'import'])
/** Property names a script may not touch: each reaches a constructor, a prototype or a call with a changed receiver. */
const PROPS = new Set(['constructor', 'prototype', '__proto__', 'bind', 'call', 'apply', 'caller', 'callee', '__defineGetter__', '__defineSetter__', '__lookupGetter__', '__lookupSetter__',
  // Reflection that hands back a constructor or a prototype by name, without a member access the guard reads.
  'getPrototypeOf', 'setPrototypeOf', 'getOwnPropertyDescriptor', 'getOwnPropertyDescriptors', 'getOwnPropertyNames', 'getOwnPropertySymbols', 'defineProperty', 'defineProperties', 'prepareStackTrace'])
const LOOPS = new Set(['ForStatement', 'ForInStatement', 'ForOfStatement', 'WhileStatement', 'DoWhileStatement'])
const FUNCTIONS = new Set(['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration'])
/** The Workflow tool inputs a Controller may pass: an inline script and its arguments. */
const KEYS = new Set(['script', 'args', 'description', 'title'])

const isNode = (v: unknown): v is Node => typeof v === 'object' && v !== null && typeof (v as Node).type === 'string'
const isId = (n: unknown, name?: string): n is Node & { name: string } => isNode(n) && n.type === 'Identifier' && (name === undefined || n.name === name)

/** A string the code spells literally: a string literal, or a template with nothing interpolated. */
function literalText(n: unknown): string | undefined {
  if (!isNode(n)) return undefined
  if (n.type === 'Literal' && typeof n.value === 'string') return n.value
  if (n.type === 'TemplateLiteral' && Array.isArray(n.expressions) && n.expressions.length === 0) {
    const q = (n.quasis as Node[])[0]
    const cooked = (q?.value as { cooked?: string } | undefined)?.cooked
    return typeof cooked === 'string' ? cooked : undefined
  }
  return undefined
}

/** A property key as written: an identifier or a literal; undefined for a computed one. */
function keyName(p: Node): string | undefined {
  if (p.computed) return undefined
  if (isId(p.key)) return p.key.name
  const k = p.key as Node
  return k?.type === 'Literal' ? String(k.value) : undefined
}

/** Why an agent() call's options are not a plain object with one literal model and one literal effort. */
function optionsRefusal(call: Node): string | undefined {
  const args = call.arguments as Node[]
  const opts = args[1]
  if (args.length > 2 || !opts || opts.type !== 'ObjectExpression') return 'its options must be a plain object written in the call'
  const seen = new Set<string>()
  for (const p of opts.properties as Node[]) {
    if (p.type !== 'Property' || p.kind !== 'init' || p.method || p.shorthand) return 'its options may hold only plain key: value pairs'
    const name = keyName(p)
    if (name === undefined) return 'its options may not use a computed key'
    if (seen.has(name)) return `its options name ${name} twice`
    seen.add(name)
    if ((name === 'model' || name === 'effort') && literalText(p.value) === undefined) return `its ${name} must be a literal string`
    if (name === 'isolation' && literalText(p.value) !== 'worktree') return 'its isolation may only be worktree'
  }
  if (!seen.has('model') || !seen.has('effort')) return 'it must state model and effort'
  return undefined
}

/** A call `<callee>(...)` with the callee a plain identifier of this name. */
const isCallOf = (n: Node | undefined, name: string) => n?.type === 'CallExpression' && isId(n.callee, name)
/** An array the code writes out, with no spread: its length is known. */
const fixedLength = (n: unknown): number | undefined => (isNode(n) && n.type === 'ArrayExpression' && (n.elements as (Node | null)[]).every(e => e !== null && e.type !== 'SpreadElement') ? (n.elements as Node[]).length : undefined)

/**
 * How many times a function runs, from where it sits: as the callback of `[a, b].map(...)`, the
 * array's length; as a thunk of `parallel([..])`, or one returned by a map callback whose map feeds
 * `parallel(...)`, once; as a stage of `pipeline([..], ...)`, the array's length. Anything else
 * (a declared function, another callback) is unbounded.
 */
function runs(fn: Node, parent: Node | undefined, grand: Node | undefined, chain: Node[]): number {
  if (parent?.type === 'CallExpression' && (parent.arguments as Node[])[0] === fn) {
    const callee = parent.callee as Node
    if (callee.type === 'MemberExpression' && !callee.computed && isId(callee.property, 'map')) {
      const n = fixedLength(callee.object)
      if (n !== undefined) return n
    }
  }
  if (parent?.type === 'CallExpression' && isCallOf(parent, 'pipeline') && (parent.arguments as Node[]).indexOf(fn) > 0) {
    const n = fixedLength((parent.arguments as Node[])[0])
    if (n !== undefined) return n
  }
  if (parent?.type === 'ArrayExpression' && grand && isCallOf(grand, 'parallel') && (grand.arguments as Node[])[0] === parent) return 1
  // A thunk returned by a map callback (its whole body), when that map is what parallel(...) gets.
  if (parent && FUNCTIONS.has(parent.type) && parent.body === fn) {
    const at = chain.indexOf(parent)
    const mapCall = chain[at - 1]
    const outer = chain[at - 2]
    if (mapCall?.type === 'CallExpression' && isCallOf(outer, 'parallel') && (outer?.arguments as Node[])[0] === mapCall) return 1
  }
  return Infinity
}

export type WorkflowCheck = { refusal?: string; agents: number }

/**
 * A Controller's Workflow call read for what it may run. `room` is how many more agents its back room
 * may start. Refused unless the script parses, uses only what this file allows, sizes every agent(),
 * and can start at most `room` agents.
 */
export function workflowCheck(input: unknown, room: number): WorkflowCheck {
  const i = (input ?? {}) as Record<string, unknown>
  const extra = Object.keys(i).filter(k => !KEYS.has(k))
  if (extra.length) return { agents: 0, refusal: `A Controller runs a workflow only from an inline script: ${extra.join(', ')} ${extra.length > 1 ? 'are' : 'is'} not allowed (a saved workflow, a script file or a resumed run is text the guard cannot read).` }
  if (typeof i.script !== 'string' || i.script.trim() === '') return { agents: 0, refusal: 'A Controller runs a workflow only from an inline script.' }
  let tree: Node
  try {
    tree = parse(i.script, { ecmaVersion: 'latest', sourceType: 'module', allowAwaitOutsideFunction: true, allowReturnOutsideFunction: true }) as unknown as Node
  } catch (err) {
    return { agents: 0, refusal: `The workflow script does not parse: ${String((err as Error).message ?? err).slice(0, 120)}.` }
  }
  let refusal: string | undefined
  let agents = 0
  const refuse = (why: string) => { refusal ??= why }
  const walk = (n: Node, chain: Node[]) => {
    if (refusal) return
    const parent = chain[chain.length - 1]
    switch (n.type) {
      case 'ThisExpression': return refuse('The workflow script may not use this: it can reach the global object.')
      case 'MetaProperty': case 'ImportExpression': case 'ImportDeclaration': case 'WithStatement': case 'ClassDeclaration': case 'ClassExpression':
        return refuse(`The workflow script may not use ${n.type === 'WithStatement' ? 'with' : n.type === 'MetaProperty' ? 'import.meta or new.target' : n.type.startsWith('Class') ? 'a class' : 'import'}.`)
      case 'ExportNamedDeclaration': case 'ExportDefaultDeclaration': case 'ExportAllDeclaration': {
        const d = n.declaration as Node | undefined
        const only = n.type === 'ExportNamedDeclaration' && d?.type === 'VariableDeclaration' && (d.declarations as Node[]).length === 1 && isId((d.declarations as Node[])[0]?.id, 'meta')
        if (!only) return refuse('The workflow script exports nothing but its meta.')
        break
      }
      case 'TaggedTemplateExpression': return refuse('The workflow script may not use a tagged template: it calls a function the guard cannot read.')
      case 'NewExpression': if (isId(n.callee) && ['Function', 'Proxy'].includes(n.callee.name)) return refuse(`The workflow script may not use new ${n.callee.name}.`); break
      case 'MemberExpression': {
        if (n.computed) {
          const key = n.property as Node
          const text = key.type === 'Literal' ? (typeof key.value === 'number' ? '' : typeof key.value === 'string' ? key.value : undefined) : literalText(key)
          if (text === undefined) return refuse('The workflow script indexes only by a literal number or string (use for...of or .at(i) for a variable index): a computed key can reach a constructor.')
          if (PROPS.has(text)) return refuse(`The workflow script may not reach ${text}.`)
        } else if (isId(n.property) && PROPS.has(n.property.name)) return refuse(`The workflow script may not reach .${n.property.name}.`)
        break
      }
      case 'Literal': if (typeof n.value === 'string' && PROPS.has(n.value)) return refuse(`The workflow script may not name ${n.value}, even as a string.`); break
      case 'Property': {
        const name = keyName(n)
        if (name !== undefined && PROPS.has(name)) return refuse(`The workflow script may not define ${name}.`)
        break
      }
      case 'Identifier': {
        const name = n.name as string
        // A property name after a dot, or a plain object key, names no variable.
        const asProp = parent?.type === 'MemberExpression' && parent.property === n && !parent.computed
        const asKey = parent?.type === 'Property' && parent.key === n && !parent.computed && !parent.shorthand
        if (asProp || asKey) break
        if (NAMES.has(name) || PROPS.has(name)) return refuse(`The workflow script may not use ${name}.`)
        if (name === 'agent') {
          // agent only as the callee of a direct call: no alias, no shadowing, no optional call.
          if (!(parent?.type === 'CallExpression' && parent.callee === n && !parent.optional)) return refuse('The workflow script uses agent other than as a direct call agent(prompt, { model, effort }).')
          const why = optionsRefusal(parent)
          if (why) return refuse(`An agent() call in the workflow script is refused: ${why}, as in agent(prompt, { model: 'sonnet', effort: 'medium' }).`)
          let times = 1
          for (let k = chain.length - 1; k >= 0; k--) {
            const a = chain[k] as Node
            if (LOOPS.has(a.type)) { times = Infinity; break }
            if (FUNCTIONS.has(a.type)) times *= runs(a, chain[k - 1], chain[k - 2], chain)
          }
          agents += times
        }
        break
      }
    }
    for (const [key, value] of Object.entries(n)) {
      if (key === 'loc' || key === 'start' || key === 'end') continue
      const kids = Array.isArray(value) ? value : [value]
      for (const kid of kids) if (isNode(kid)) walk(kid, [...chain, n])
    }
  }
  walk(tree, [])
  if (refusal) return { agents, refusal }
  if (agents === 0) return { agents, refusal: 'The workflow script calls no agent(): run that work directly.' }
  if (agents > room) {
    const many = Number.isFinite(agents) ? `can start ${agents} agents` : 'can start an unbounded number of agents (an agent() call in a loop, or in a callback the guard cannot count)'
    return { agents, refusal: `This workflow ${many}, and the back room has room for ${room}. Write each agent() at the top level, in [..].map(...), in parallel([..]) or in pipeline([..], ...), within the budget.` }
  }
  return { agents }
}
