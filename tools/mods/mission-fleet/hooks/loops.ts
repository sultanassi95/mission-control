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

/** Where the Controller that raised an item stands: still staffed, replaced by a later console under its call sign, or gone. */
export type SeatState = 'live' | 'replaced' | 'gone'

/**
 * The console whose Controller may hear an item's decision now: the agent that raised it, while its
 * console is staffed, and never a later console under the same call sign. An item opened before
 * agent ids were recorded falls back to the console staffed under its call sign.
 */
export function liveSeat<S extends Seat>(item: Pick<PollItem, 'agentId' | 'from'>, seats: readonly S[]): S | undefined {
  return item.agentId
    ? seats.find(s => s.agentId === item.agentId && s.status === 'staffed')
    : seats.find(s => s.callSign === item.from && s.status === 'staffed')
}

export function seatState(item: Pick<PollItem, 'agentId' | 'from'>, seats: readonly Seat[]): SeatState {
  if (liveSeat(item, seats)) return 'live'
  return seats.some(s => s.callSign === item.from && s.status === 'staffed') ? 'replaced' : 'gone'
}

/** A decision the founder made that is sent to a Controller: a go, a no-go, or an answered question. */
export function isDecided(state: PollItem['state']): boolean {
  return state === 'go' || state === 'no-go' || state === 'answered'
}

/**
 * An answer (an option, GO or NO-GO) that never reached its Controller: it stays on the Poll until a retry delivers it or
 * the founder dismisses it. The same test as the app's `undelivered` in tools/app/public/app.js.
 */
export function isUndelivered(item: Pick<PollItem, 'state' | 'undelivered'>): boolean {
  return Boolean(item.undelivered) && isDecided(item.state)
}

/** An answer decided after the Controller that raised it stood down, kept for the next Controller under its call sign. */
export function isHeld(item: Pick<PollItem, 'state' | 'held'>): boolean {
  return Boolean(item.held) && isDecided(item.state)
}

/**
 * What the next Controller under a call sign is told when it is staffed: each decision the founder
 * made while no Controller held that call sign, with the report it answers, and each advisory held
 * for its front. One message, so nothing arrives in part; empty when nothing waits.
 */
export function heldText(callSign: string, verdicts: readonly PollItem[], advisories: readonly PendingAdvisory[]): string {
  if (verdicts.length === 0 && advisories.length === 0) return ''
  const lines = [`Held for the next ${callSign} Controller, which is you. Say in your next status check what you will do with each.`]
  for (const v of verdicts) {
    const said = v.state === 'answered' ? decisionText(v, v.choice ?? 0, v.note ?? '').split('\n')[0] ?? '' : `${v.state === 'no-go' ? 'NO-GO' : 'GO'} on ${v.id}${v.note ? `: ${v.note}` : '.'}`
    lines.push('', said, `It answers a report an earlier ${callSign} Controller sent at ${v.at.slice(0, 16)}, decided after that Controller stood down:`, v.detail)
  }
  if (advisories.length) lines.push('', 'Advisories Flight held for your front:', ...advisories.map(a => `- ${a.at.slice(0, 16)} ${a.text}`))
  return lines.join('\n')
}

/**
 * One plain sentence for the founder in place of an engine refusal, which is often written for the
 * model ("Issue the action again once..."). The raw text stays on the item and in the audit log.
 */
export function plainReason(raw: string): string {
  if (/auto mode|classifier/i.test(raw)) return 'Auto mode blocked the message.'
  if (/no agent recorded/i.test(raw)) return 'No Controller was staffed to receive it.'
  if (/not found|no agent named|no such|nobody|unknown (agent|recipient)|no longer|not running|has ended/i.test(raw)) return 'The Controller could not be found; its session may have ended.'
  if (/denied|permission|not allowed/i.test(raw)) return 'A permission rule blocked the message.'
  return 'The message could not be delivered.'
}

/** What the founder can do at the terminal about an undelivered decision, by where its Controller stands. */
export function undeliveredAdvice(item: Pick<PollItem, 'id' | 'from' | 'state'>, seat: SeatState): string {
  if (seat === 'live') return `/console retry ${item.id} sends the same ${item.state === 'answered' ? 'answer' : item.state === 'no-go' ? 'NO-GO' : 'GO'} to ${item.from}.`
  if (seat === 'replaced') return `The ${item.from} Controller that raised it has been replaced: tell the new one with /console call ${item.from}.`
  return `${item.from} is no longer staffed: staff the console again from Flight, then tell it the decision with /console call ${item.from}.`
}

/** What the app draws a poll item from, beside the item itself; every word of it is the fleet's. */
export type CardFacts = {
  /** An undelivered decision: its plain reason, and where the Controller that raised it stands. */
  why?: string
  seat?: SeatState
  /** An open item the founder is asked: the options it is asked with (optionsOf). */
  asks?: DecisionOption[]
  /** A decided item: the answer in a word or two (answerWord). */
  answer?: string
}

/**
 * A poll item as the app draws it, so the page holds no rule of its own about options or answers: an
 * open question carries its options, a decided one its answer, an undelivered one its plain reason
 * and where its Controller stands.
 */
export function cardFacts(item: PollItem, seats: readonly Seat[]): PollItem & CardFacts {
  const out: PollItem & CardFacts = { ...item }
  if (item.state === 'open' && item.kind !== 'todo') out.asks = optionsOf(item)
  if (isDecided(item.state)) out.answer = answerWord(item)
  if (isUndelivered(item)) {
    out.why = plainReason(item.undelivered ?? '')
    out.seat = seatState(item, seats)
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

/** How many closed items the app keeps as recent history. */
export const APP_HISTORY = 30

/**
 * The poll items the app draws: the last APP_HISTORY closed items as history, then every undelivered
 * decision however old (each waits on the founder until a retry or a dismiss), then every held
 * decision however old (each waits for a staffing or a dismiss), then every open item.
 */
export function appPoll(items: readonly PollItem[]): PollItem[] {
  const held = (p: PollItem) => isHeld(p) && !isUndelivered(p)
  return [
    ...items.filter(p => p.state !== 'open' && !isUndelivered(p) && !held(p)).slice(-APP_HISTORY),
    ...items.filter(isUndelivered),
    ...items.filter(held),
    ...items.filter(p => p.state === 'open'),
  ]
}

// ---- Decisions asked in Flight's chat (MC-125) ----

/** A decision as a Controller's report asks it: the question, and the options with what each does. */
export type Decision = { question: string; options: DecisionOption[] }

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
 * One decision line, `<question> | 1) <option>: <what it does> | 2) ...`. The numbers are optional;
 * an option's label ends at its first ": ". Fewer than two options is no choice, so it keeps none and
 * is asked as Go or No-go.
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
    .slice(0, 6)
  return { question: clip(head.trim(), QUESTION_MAX), options: options.length >= 2 ? options : [] }
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
    return `${n}) ${optionsOf(item)[n - 1]?.label ?? '?'}`
  }
  return item.state === 'no-go' ? 'NO-GO' : 'GO'
}

/**
 * What a decision tells the Controller that raised the item. A question: the option chosen and what
 * it does, the founder's note, and the question it answers, never the other options or questions. A
 * blocked line or an advisory: GO or NO-GO (option 1 or 2) with the note and the report it answers.
 */
export function decisionText(item: PollItem, choice: number, note: string): string {
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
