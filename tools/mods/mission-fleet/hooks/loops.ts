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

/** A short, stable id for a poll item: two letters from the call sign and a counter. */
export function pollId(callSign: string, n: number): string {
  return `${callSign.replace(/[^A-Z]/g, '').slice(0, 2) || 'XX'}${n}`
}

/** Fronts whose dependency map names this scope, from (front, map text) pairs. */
export function dependentsOf(scope: string, maps: { front: string; text: string }[], own: string): string[] {
  const needle = new RegExp(`\\b${scope.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
  return maps.filter(m => m.front !== own && needle.test(m.text)).map(m => m.front)
}
