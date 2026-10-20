import type { DecisionOption, PendingAdvisory, PollItem, Slots } from '../types'

export type StatusCheck = {
  state?: string
  shipped?: string
  blocked?: string
  next?: string
  contract?: string
}

const FIELDS: [keyof StatusCheck, RegExp][] = [
  ['state', /^\s*state\s*:\s*(.*)$/i],
  ['shipped', /^\s*shipped\s*:\s*(.*)$/i],
  ['blocked', /^\s*blocked on you\s*:\s*(.*)$/i],
  ['next', /^\s*next\s*:\s*(.*)$/i],
  ['contract', /^\s*contract\s*:\s*(.*)$/i],
]

/** The status-check lines of a Controller's report; the last occurrence wins (the check ends a report). */
export function parseStatus(answer: string): StatusCheck {
  const { state, shipped, blocked, next, contract } = parseReport(answer)
  const out: StatusCheck = {}
  for (const [k, v] of [['state', state], ['shipped', shipped], ['blocked', blocked], ['next', next], ['contract', contract]] as const) if (v !== undefined) out[k] = v
  return out
}

/** True for a status value that says there is nothing ("", none, nothing, n/a, -). */
export function isNothing(value: string | undefined): boolean {
  return value === undefined || /^(|none|nothing|n\/a|-|no blockers?)( (new|open))?( (yet|for now|so far|right now|now|pending|at the moment|to report|from (me|the founder)))?[.!]?$/i.test(value.trim())
}

/** PR numbers a report says were opened or are in flight ("PR #12", "pull/12"). */
export function prsIn(text: string): number[] {
  const out = new Set<number>()
  for (const m of text.matchAll(/\b(?:PR|pull request)\s*#(\d{1,6})\b|\/pull\/(\d{1,6})\b/gi)) out.add(Number(m[1] ?? m[2]))
  return [...out]
}

/** A one-line signature of a PR's state, to notice when anything worth waking a Controller for changed. */
export function prSignature(view: { state?: string; reviewDecision?: string; comments?: unknown[]; reviews?: unknown[]; statusCheckRollup?: { conclusion?: string; status?: string }[] }): string | undefined {
  const rollup = view.statusCheckRollup ?? []
  // While any check is still running the PR is mid-flight: no signature, so a CI tick never wakes anyone.
  if (rollup.some(c => !c.conclusion && c.status && c.status !== 'COMPLETED')) return undefined
  const checks = rollup.map(c => c.conclusion || c.status || '?').sort().join(',')
  return [view.state ?? '?', view.reviewDecision ?? '-', `c${(view.comments ?? []).length}`, `r${(view.reviews ?? []).length}`, checks].join('|')
}

/** A short, stable id for a poll item: two letters from the call sign and a counter. */
export function pollId(callSign: string, n: number): string {
  return `${callSign.replace(/[^A-Z]/g, '').slice(0, 2) || 'XX'}${n}`
}

/** Fronts whose dependency map names this scope, from (front, map text) pairs. */
export function dependentsOf(scope: string, maps: { front: string; text: string }[], own: string): string[] {
  const needle = new RegExp(`\\b${scope.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
  return maps.filter(m => m.front !== own && needle.test(m.text)).map(m => m.front)
}

/** A console as the seat checks read it. */
export type Seat = { callSign: string; agentId: string; status: string }

/**
 * The console whose Controller may hear an item's answer now: the agent that raised it, while its
 * console is staffed, and never a later console under the same call sign. An item opened before
 * agent ids were recorded falls back to the console staffed under its call sign.
 */
export function liveSeat<S extends Seat>(item: Pick<PollItem, 'agentId' | 'from'>, seats: readonly S[]): S | undefined {
  return item.agentId
    ? seats.find(s => s.agentId === item.agentId && s.status === 'staffed')
    : seats.find(s => s.callSign === item.from && s.status === 'staffed')
}

/** A decision the founder made that is sent to a Controller: a go, a no-go or an answered question. */
export function isDecided(state: PollItem['state']): boolean {
  return state === 'go' || state === 'no-go' || state === 'answered'
}

/** An open item a Controller asks the founder: a question, a legacy blocked line or a contract change; a to-do is never asked. */
export function isAsked(item: Pick<PollItem, 'kind' | 'state'>): boolean {
  return item.state === 'open' && item.kind !== 'todo'
}

/** What the next Controller under a call sign is told when it is staffed: the advisories held for its front. Empty when none wait. */
export function advisoryText(callSign: string, advisories: readonly PendingAdvisory[]): string {
  if (advisories.length === 0) return ''
  return [`Held for the next ${callSign} Controller, which is you. Say in your next status check what you will do with each.`, '', 'Advisories Flight held for your front:', ...advisories.map(a => `- ${a.at.slice(0, 16)} ${a.text}`)].join('\n')
}

/**
 * One plain sentence in place of an engine refusal, which is often written for the model ("Issue the
 * action again once..."). The raw text stays in the audit log.
 */
export function plainReason(raw: string): string {
  if (/auto mode|classifier/i.test(raw)) return 'Auto mode blocked the message.'
  if (/no agent recorded/i.test(raw)) return 'No Controller was staffed to receive it.'
  if (/not found|no agent named|no such|nobody|unknown (agent|recipient)|no longer|not running|has ended/i.test(raw)) return 'The Controller could not be found; its session may have ended.'
  if (/denied|permission|not allowed/i.test(raw)) return 'A permission rule blocked the message.'
  return 'The message could not be delivered.'
}

/** A poll item as it was stored before MC-163: an answer could be left undelivered, held or on its way from the app. */
export type StoredPollItem = PollItem & { undelivered?: string; held?: string; sentAt?: string }

/**
 * The stored poll as the questions Flight asks read it. An answer that never reached its Controller
 * (undelivered) or waited for the next one (held) is open again, so Flight asks it again; the app's
 * send marks are dropped. Everything else is kept as it was, so nothing open is lost.
 */
export function migratePoll(items: readonly StoredPollItem[]): { items: PollItem[]; reopened: string[] } {
  const reopened: string[] = []
  const out = items.map(p => {
    if (p.undelivered === undefined && p.held === undefined && p.sentAt === undefined) return p
    const { undelivered, held, sentAt, ...rest } = p
    if (isDecided(p.state) && (undelivered || held)) {
      reopened.push(p.id)
      const { choice, decidedAt, ...open } = rest
      return { ...open, state: 'open' as const }
    }
    return rest
  })
  return { items: out, reopened }
}

/** How many questions one AskUserQuestion call takes (the engine's limit), and the most options each. */
export const ASK_BATCH = 4
export const MAX_OPTIONS = 4
/** A question Flight was asked to ask and has not asked is put to it again after this long. */
export const ASK_AGAIN = 10 * 60_000

/** The next questions to put to Flight: open, not put to it within ASK_AGAIN, urgent first, then oldest; at most ASK_BATCH. */
export function nextAsks(items: readonly PollItem[], now: number): PollItem[] {
  const due = items.filter(p => isAsked(p) && (!p.askedAt || now - Date.parse(p.askedAt) > ASK_AGAIN))
  return [...due].sort((a, b) => Number(Boolean(b.urgent)) - Number(Boolean(a.urgent)) || a.at.localeCompare(b.at)).slice(0, ASK_BATCH)
}

/**
 * What Flight is told to ask: one AskUserQuestion call, each question's header its id, its text and
 * options exactly as the Controller wrote them. The fleet delivers each answer itself.
 */
export function askPrompt(batch: readonly PollItem[]): string {
  const n = batch.length
  const lines = [
    `[mission-fleet] ${n === 1 ? 'A Controller asks the founder a question' : `Controllers ask the founder ${n} questions`}. Before anything else, ask ${n === 1 ? 'it' : 'them'} with one AskUserQuestion call, in this order: for each, header exactly its id, question exactly the text given, and its options as given (label, with "what it does" as the description), multiSelect false.`,
    'The fleet delivers each answer to the Controller that asked it. Do not send the answers yourself, and do not ask them again in your own words.',
  ]
  for (const p of batch) {
    lines.push('', `id ${p.id} (${p.from}${p.urgent ? ', urgent' : ''}): ${p.title}`)
    optionsOf(p).forEach((o, k) => lines.push(`  ${k + 1}) ${o.label}${o.does ? `: ${o.does}` : ''}`))
  }
  return lines.join('\n')
}

/** A question as AskUserQuestion carries it. */
export type AskedQuestion = { question?: string; header?: string }

/**
 * The founder's answers matched to the poll items they answer: by header (the item's id), else by the
 * question's text. Each answer is an option's label (choice counts from 1), its number, or the
 * founder's own words (choice 0, the words as the note).
 */
export function matchAnswers(items: readonly PollItem[], questions: readonly AskedQuestion[], answers: Record<string, string>): { item: PollItem; choice: number; note: string }[] {
  const out: { item: PollItem; choice: number; note: string }[] = []
  const key = (t: string) => t.toLowerCase().replace(/\s+/g, ' ').trim()
  for (const q of questions) {
    const answer = (answers[q.question ?? ''] ?? '').trim()
    if (!answer) continue
    const item = items.find(p => isAsked(p) && p.id.toLowerCase() === key(q.header ?? '')) ?? items.find(p => isAsked(p) && key(p.title) === key(q.question ?? ''))
    if (!item || out.some(o => o.item.id === item.id)) continue
    const labels = optionsOf(item).map(o => key(o.label))
    const byLabel = labels.indexOf(key(answer)) + 1
    const byNumber = /^\d{1,2}$/.test(answer) && Number(answer) >= 1 && Number(answer) <= labels.length ? Number(answer) : 0
    const choice = byLabel || byNumber
    out.push({ item, choice, note: choice ? '' : answer })
  }
  return out
}

/** How many colours the app gives call signs: the tokens --slot-1 to --slot-8. */
export const SLOT_COUNT = 8

/** The slot map as the store holds it, keeping only entries whose slot is a whole number in range. */
export function asSlots(value: unknown): Slots {
  const out: Slots = {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out
  for (const [sign, slot] of Object.entries(value as Record<string, unknown>)) {
    if (typeof slot === 'number' && Number.isInteger(slot) && slot >= 0 && slot < SLOT_COUNT) out[sign] = slot
  }
  return out
}

/** A console as slot placing reads it. */
export type Staffed = { callSign: string; status: string; staffedAt?: string }

/**
 * Gives every live console (staffed, or being staffed) a colour slot no other live console holds.
 * In staffing order, each keeps its remembered slot unless a console staffed before it holds that
 * slot. One with no slot, or whose slot is held, takes the lowest free slot no other call sign
 * remembers, else the lowest free slot; with every slot held it has none, and the app draws its chip
 * plain. A stood-down call sign keeps its entry. Returns the same map when nothing changes.
 */
export function placeSlots(map: Slots, seats: readonly Staffed[]): Slots {
  // One seat per call sign, as staffing writes them; a second record under one call sign is ignored.
  const live: Staffed[] = []
  for (const s of seats) if ((s.status === 'staffed' || s.status === 'staffing') && !live.some(l => l.callSign === s.callSign)) live.push(s)
  live.sort((a, b) => (a.staffedAt ?? '').localeCompare(b.staffedAt ?? ''))
  const held = new Set<number>()
  const unplaced: string[] = []
  for (const s of live) {
    const slot = map[s.callSign]
    if (slot !== undefined && !held.has(slot)) held.add(slot)
    else unplaced.push(s.callSign)
  }
  if (unplaced.length === 0) return map
  const out: Slots = { ...map }
  let changed = false
  for (const sign of unplaced) {
    const remembered = new Set(Object.entries(out).filter(([other]) => other !== sign).map(([, slot]) => slot))
    const free = Array.from({ length: SLOT_COUNT }, (_, n) => n).filter(n => !held.has(n))
    const slot = free.find(n => !remembered.has(n)) ?? free[0]
    if (slot === undefined) {
      if (sign in out) {
        delete out[sign]
        changed = true
      }
      continue
    }
    held.add(slot)
    if (out[sign] !== slot) {
      out[sign] = slot
      changed = true
    }
  }
  return changed ? out : map
}

// ---- Decisions asked in Flight's chat (MC-125) ----

/** A decision as a Controller's report asks it: the question, and the options with what each does. */
export type Decision = { question: string; options: DecisionOption[]; urgent?: true }

/** A Controller's report: the status check, its decisions, its note and its to-dos for the founder. */
export type Report = StatusCheck & {
  /** Every decision still open, when the report lists any; [] when it says none; absent when it says nothing. */
  decisions?: Decision[]
  notes?: string
  /** Actions only the founder can take, each with its link. */
  todos?: string[]
}

/** The most decisions one report opens, and the most to-dos; the rest are dropped. */
export const MAX_DECISIONS = 8
export const MAX_TODOS = 12
const QUESTION_MAX = 400
const LABEL_MAX = 120
const DOES_MAX = 300

/** The two options a decision with none of its own is asked with: a report's blocked line, or a question without options. */
export const GO_NOGO: DecisionOption[] = [
  { label: 'Go', does: 'go ahead as the report says' },
  { label: 'No-go', does: 'do not go ahead' },
]

const BULLET = /^[-*]\s+/
const ITEM = /^\s*(?:[-*\u2022]|\d+[.)])\s+(.*)$/
/** An option written on its own indented line under a decision: `  1) <option>: <what it does>`. */
const OPTION_LINE = /^\s+\(?\d+[):]\s+\S/
const BLOCKS: ['decisions' | 'todos', RegExp][] = [
  ['decisions', /^\s*decisions\s*:\s*(.*)$/i],
  ['todos', /^\s*for you to do\s*:\s*(.*)$/i],
]
const NOTES = /^\s*notes?\s*:\s*(.*)$/i
const clip = (text: string, n: number) => (text.length > n ? `${text.slice(0, n - 1)}\u2026` : text)

/**
 * One decision line, `[urgent: ]<question> | 1) <option>: <what it does> | 2) ...`. The numbers are
 * optional; an option's label ends at its first ": ". Fewer than two options is no choice, so it keeps
 * none and is asked as Go or No-go; past MAX_OPTIONS the rest are dropped (AskUserQuestion takes four).
 */
export function parseDecision(text: string): Decision {
  const [head = '', ...rest] = text.split(/\s+\|\s+/)
  const options = rest
    .map(part => {
      const body = part.trim().replace(/^\(?\d+[).:]\s*/, '')
      const at = body.indexOf(': ')
      const label = clip((at > 0 ? body.slice(0, at) : body).trim(), LABEL_MAX)
      const does = at > 0 ? clip(body.slice(at + 2).trim(), DOES_MAX) : ''
      return does ? { label, does } : { label }
    })
    .filter(o => o.label)
    .slice(0, MAX_OPTIONS)
  const urgent = /^urgent\s*:\s*/i.exec(head.trim())
  const question = clip(head.trim().slice(urgent?.[0].length ?? 0), QUESTION_MAX)
  return { question, options: options.length >= 2 ? options : [], ...(urgent ? { urgent: true as const } : {}) }
}

/**
 * A Controller's report read whole. Status lines are read as parseStatus reads them. `decisions:` and
 * `for you to do:` open a block of item lines (`- `, `* ` or `1. `); a blank line, a status line or
 * any other line ends it, so a bulleted status line is never an item. The last block of a kind wins,
 * like the last status line, and a nothing-like item opens nothing.
 *
 * A decisions block is the console's whole list, so it is read only when it says something certain:
 * items that parse, or a header that says none. Text on the header line is an item only when it has
 * options (` | `); a header with other text and no item that parses leaves decisions absent, so a
 * malformed block never withdraws the open questions. An indented numbered line under a decision is
 * one more of its options.
 */
export function parseReport(answer: string): Report {
  const status: StatusCheck = {}
  const blocks: { decisions?: string[]; todos?: string[] } = {}
  let saysNone = false
  let notes: string | undefined
  let open: 'decisions' | 'todos' | undefined
  for (const raw of answer.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.replace(BULLET, '')
    const header = BLOCKS.find(([, re]) => re.test(line))
    if (header) {
      const inline = (header[1].exec(line)?.[1] ?? '').trim()
      const kind = header[0]
      // An empty header is not a none: its items say what it is.
      if (kind === 'decisions') saysNone = inline !== '' && isNothing(inline)
      blocks[kind] = isNothing(inline) || (kind === 'decisions' && !/\s\|\s/.test(inline)) ? [] : [inline]
      open = kind
      continue
    }
    const note = NOTES.exec(line)
    const field = FIELDS.find(([, re]) => re.test(line))
    if (open && !note && !field) {
      const list = blocks[open] ?? []
      if (open === 'decisions' && list.length && OPTION_LINE.test(raw)) {
        list[list.length - 1] += ` | ${raw.trim()}`
        continue
      }
      const item = ITEM.exec(raw)
      if (item) {
        const text = (item[1] ?? '').trim()
        if (!isNothing(text)) list.push(text)
        else if (open === 'decisions') saysNone = true
        continue
      }
    }
    open = undefined
    if (note) notes = (note[1] ?? '').trim()
    else if (field) status[field[0]] = (field[1].exec(line)?.[1] ?? '').trim()
  }
  const out: Report = { ...status }
  if (blocks.decisions && (blocks.decisions.length || saysNone)) out.decisions = blocks.decisions.slice(0, MAX_DECISIONS).map(parseDecision)
  if (blocks.todos) out.todos = blocks.todos.slice(0, MAX_TODOS).map(t => clip(t, QUESTION_MAX))
  if (notes !== undefined && !isNothing(notes)) out.notes = notes
  return out
}

/** The options an open item is asked with: a question's own, Go or No-go for a blocked line, Tell or not for a contract change. */
export function optionsOf(item: Partial<Pick<PollItem, 'kind' | 'options' | 'targets'>>): DecisionOption[] {
  if (item.kind === 'question' && item.options && item.options.length >= 2) return item.options
  if (item.kind === 'advisory') {
    const who = (item.targets ?? []).join(', ') || 'the fronts that depend on it'
    return [
      { label: 'Tell them', does: `send it to the Controllers of ${who}; a front with none staffed gets it when one is` },
      { label: 'Don\'t tell', does: 'close it; nothing is sent' },
    ]
  }
  return GO_NOGO
}

/** A decision in a word or two, as the poll and the app say it: GO, NO-GO, or the chosen option. */
export function answerWord(item: Pick<PollItem, 'state'> & Partial<PollItem>): string {
  if (item.state === 'answered') {
    const n = item.choice ?? 0
    return n === 0 ? 'in their own words' : `${n}) ${optionsOf(item)[n - 1]?.label ?? '?'}`
  }
  return item.state === 'no-go' ? 'NO-GO' : 'GO'
}

/**
 * What a decision tells the Controller that raised the item. A question: the option chosen and what
 * it does, the founder's note, and the question it answers, never the other options or questions. A
 * blocked line or an advisory: GO or NO-GO (option 1 or 2) with the note and the report it answers.
 */
export function decisionText(item: PollItem, choice: number, note: string): string {
  if (choice === 0) {
    return [`The founder answered ${item.id} in their own words: ${note}`, `Your question: ${item.title}`, `It answers your report of ${item.at.slice(0, 16)}.`].join('\n')
  }
  if (item.kind === 'question') {
    const o = optionsOf(item)[choice - 1]
    return [
      `The founder answered ${item.id}: ${choice}) ${o?.label ?? '?'}${o?.does ? ` - ${o.does}` : ''}.${note ? ` Note: ${note}` : ''}`,
      `Your question: ${item.title}`,
      `It answers your report of ${item.at.slice(0, 16)}.`,
    ].join('\n')
  }
  return [
    `${choice === 2 ? 'NO-GO' : 'GO'} from the founder on ${item.id}${note ? `: ${note}` : '.'}`,
    `It answers your report of ${item.at.slice(0, 16)}:`,
    item.detail,
  ].join('\n')
}
