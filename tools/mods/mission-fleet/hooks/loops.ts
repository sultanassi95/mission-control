import type { PendingAdvisory, PollItem, Slots } from '../types'

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
  const out: StatusCheck = {}
  for (const line of answer.split('\n')) {
    for (const [key, re] of FIELDS) {
      const m = re.exec(line.replace(/^[-*]\s+/, ''))
      if (m) out[key] = (m[1] ?? '').trim()
    }
  }
  return out
}

/** True for a status value that says there is nothing ("", none, nothing, n/a, -). */
export function isNothing(value: string | undefined): boolean {
  return value === undefined || /^(|none|nothing|n\/a|-|no blockers?)( (yet|for now|so far|to report|from (me|the founder)))?[.!]?$/i.test(value.trim())
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

/**
 * A go or no-go that never reached its Controller: it stays on the Poll until a retry delivers it or
 * the founder dismisses it. The same test as the app's `undelivered` in tools/app/public/app.js.
 */
export function isUndelivered(item: Pick<PollItem, 'state' | 'undelivered'>): boolean {
  return Boolean(item.undelivered) && (item.state === 'go' || item.state === 'no-go')
}

/** A go or no-go decided after the Controller that raised it stood down, kept for the next Controller under its call sign. */
export function isHeld(item: Pick<PollItem, 'state' | 'held'>): boolean {
  return Boolean(item.held) && (item.state === 'go' || item.state === 'no-go')
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
    lines.push('', `${v.state === 'no-go' ? 'NO-GO' : 'GO'} on ${v.id}${v.note ? `: ${v.note}` : '.'}`, `It answers a report an earlier ${callSign} Controller sent at ${v.at.slice(0, 16)}, decided after that Controller stood down:`, v.detail)
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
  if (seat === 'live') return `/console retry ${item.id} sends the same ${item.state === 'no-go' ? 'NO-GO' : 'GO'} to ${item.from}.`
  if (seat === 'replaced') return `The ${item.from} Controller that raised it has been replaced: tell the new one with /console call ${item.from}.`
  return `${item.from} is no longer staffed: staff the console again from Flight, then tell it the decision with /console call ${item.from}.`
}

/** A poll item as the app draws it: an undelivered decision carries its plain reason and where its Controller stands. */
export function cardFacts(item: PollItem, seats: readonly Seat[]): PollItem & { why?: string; seat?: SeatState } {
  return isUndelivered(item) ? { ...item, why: plainReason(item.undelivered ?? ''), seat: seatState(item, seats) } : item
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
