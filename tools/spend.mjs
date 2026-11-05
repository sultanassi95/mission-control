#!/usr/bin/env node
// Measured model usage, read from Claude Code's own session transcripts: per agent (the main session
// and each subagent) and model, calls and tokens. The API's counts, summed; no prices (the model
// ladder in the instance's routing doctrine prices them).
//
//   node tools/spend.mjs                 this session (CLAUDE_CODE_SESSION_ID), main plus subagents
//   node tools/spend.mjs --session <id>  another session, by id or by the path of its .jsonl
//   node tools/spend.mjs --sessions      one line per recent session
//
// Env: CLAUDE_CONFIG_DIR names the profile whose projects/ folder is read (else every ~/.claude* profile);
// MCSPEND_PROJECTS (colon list) names projects folders directly, for tests.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const MAIN = 'main'
const num = v => (Number.isFinite(v) ? v : 0)
const n = v => v.toLocaleString('en-US')

/** Model calls in one transcript, once each: a response is written once per content block, all carrying the same id and usage. */
export function calls(file) {
  const byId = new Map()
  let text = ''
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return []
  }
  for (const line of text.split('\n')) {
    if (!line.includes('"usage"')) continue
    let e
    try {
      e = JSON.parse(line)
    } catch {
      continue
    }
    const m = e.message
    if (e.type !== 'assistant' || !m?.usage || !m.model || m.model.startsWith('<')) continue
    // The same response repeats with its usage as it streamed; the last copy is the whole one.
    byId.set(m.id ?? `${e.uuid}`, { model: m.model, at: e.timestamp ?? '', usage: m.usage })
  }
  return [...byId.values()]
}

const blank = (label, type, model) => ({ label, type, model, calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })

/** The session's lines, one per agent and model: { label, type, model, calls, input, output, cacheRead, cacheWrite }. */
export function aggregate(mainFile) {
  const lines = new Map()
  let first = ''
  let last = ''
  const add = (agent, label, type, file) => {
    for (const c of calls(file)) {
      const key = `${agent}\u0000${c.model}`
      const l = lines.get(key) ?? blank(label, type, c.model)
      l.calls += 1
      l.input += num(c.usage.input_tokens)
      l.output += num(c.usage.output_tokens)
      l.cacheRead += num(c.usage.cache_read_input_tokens)
      l.cacheWrite += num(c.usage.cache_creation_input_tokens)
      lines.set(key, l)
      if (c.at && (!first || c.at < first)) first = c.at
      if (c.at && c.at > last) last = c.at
    }
  }
  add(MAIN, 'main session', 'main', mainFile)
  const dir = mainFile.replace(/\.jsonl$/, '')
  const subs = join(dir, 'subagents')
  if (existsSync(subs)) {
    for (const f of readdirSync(subs).filter(f => f.endsWith('.jsonl')).sort()) {
      let meta = {}
      try {
        meta = JSON.parse(readFileSync(join(subs, f.replace(/\.jsonl$/, '.meta.json')), 'utf8'))
      } catch {
        /* no meta: the agent id labels it */
      }
      add(f.replace(/\.jsonl$/, ''), meta.description ?? f.replace(/^agent-|\.jsonl$/g, ''), meta.agentType ?? 'agent', join(subs, f))
    }
  }
  return { id: basename(mainFile, '.jsonl'), first, last, lines: [...lines.values()] }
}

const total = l => l.input + l.cacheRead + l.cacheWrite + l.output
export function report(s) {
  if (!s.lines.length) return 'No model calls found in this session.'
  const lines = [...s.lines].sort((a, b) => total(b) - total(a))
  const row = l => `| ${l.label.replace(/\|/g, '/')} | ${l.type} | ${l.model} | ${l.calls} | ${n(l.input)} | ${n(l.cacheRead)} | ${n(l.cacheWrite)} | ${n(l.output)} |`
  const sum = ls => ls.reduce((a, l) => ({ calls: a.calls + l.calls, input: a.input + l.input, cacheRead: a.cacheRead + l.cacheRead, cacheWrite: a.cacheWrite + l.cacheWrite, output: a.output + l.output }), { calls: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0 })
  const byModel = [...new Set(lines.map(l => l.model))].map(m => ({ m, t: sum(lines.filter(l => l.model === m)) }))
  const all = sum(lines)
  return [
    `Measured spend, session ${s.id.slice(0, 8)} (${s.first.slice(0, 16)} to ${s.last.slice(0, 16)} UTC)`,
    '',
    '| who | type | model | calls | input | cache read | cache write | output |',
    '|---|---|---|---|---|---|---|---|',
    ...lines.map(row),
    '',
    'Per model:',
    '',
    '| model | calls | input | cache read | cache write | output |',
    '|---|---|---|---|---|---|',
    ...byModel.map(({ m, t }) => `| ${m} | ${t.calls} | ${n(t.input)} | ${n(t.cacheRead)} | ${n(t.cacheWrite)} | ${n(t.output)} |`),
    `| **total** | ${all.calls} | ${n(all.input)} | ${n(all.cacheRead)} | ${n(all.cacheWrite)} | ${n(all.output)} |`,
  ].join('\n')
}

function projectDirs() {
  if (process.env.MCSPEND_PROJECTS) return process.env.MCSPEND_PROJECTS.split(':').filter(Boolean)
  const configs = process.env.CLAUDE_CONFIG_DIR ? [process.env.CLAUDE_CONFIG_DIR] : readdirSync(homedir()).filter(f => /^\.claude/.test(f)).map(f => join(homedir(), f))
  return configs.map(c => join(c, 'projects')).filter(existsSync)
}
function transcripts() {
  const out = []
  for (const p of projectDirs()) {
    for (const d of readdirSync(p)) {
      const dir = join(p, d)
      try {
        for (const f of readdirSync(dir)) if (f.endsWith('.jsonl')) out.push({ file: join(dir, f), mtime: statSync(join(dir, f)).mtimeMs })
      } catch {
        /* not a folder */
      }
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime)
}
export function findSession(idOrPath) {
  if (idOrPath.endsWith('.jsonl') && existsSync(idOrPath)) return idOrPath
  return transcripts().find(t => basename(t.file, '.jsonl') === idOrPath || basename(t.file).startsWith(idOrPath))?.file
}

/** One line per recent session: when it last ran, the registry name when it has one, calls and tokens. */
export function history(limit = 15, names = {}) {
  const rows = transcripts().slice(0, limit).map(t => {
    const s = aggregate(t.file)
    const tokens = s.lines.reduce((a, l) => a + total(l), 0)
    const id = basename(t.file, '.jsonl')
    return `${new Date(t.mtime).toISOString().slice(0, 16)}  ${id.slice(0, 8)}  ${s.lines.reduce((a, l) => a + l.calls, 0)} calls  ${n(tokens)} tokens  ${s.lines.length} lines${names[id] ? `  (${names[id]})` : ''}`
  })
  return rows.length ? rows.join('\n') : 'No session transcripts found.'
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  if (args.includes('--sessions')) {
    // Named sessions from the registry label their transcripts.
    const names = {}
    try {
      const dir = join(process.env.MCAPP_HOME || join(homedir(), '.mission-control'), 'sessions')
      for (const f of readdirSync(dir)) {
        const e = JSON.parse(readFileSync(join(dir, f), 'utf8'))
        if (e.session_id) names[e.session_id] = e.name
      }
    } catch {
      /* no registry */
    }
    console.log(history(15, names))
  } else {
    const i = args.indexOf('--session')
    const want = i >= 0 ? args[i + 1] : process.env.CLAUDE_CODE_SESSION_ID
    if (!want) {
      process.stderr.write('No session named: pass --session <id|path>, or run inside a session (CLAUDE_CODE_SESSION_ID).\n')
      process.exit(1)
    }
    const file = findSession(want)
    if (!file) {
      process.stderr.write(`No transcript found for ${want}.\n`)
      process.exit(1)
    }
    console.log(report(aggregate(file)))
  }
}
