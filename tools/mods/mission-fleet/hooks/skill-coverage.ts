/*
 * Which git and gh commands the shipped skills name, and whether a Controller's guard lets them run.
 * A skill a Controller may run must name no command the guard refuses, except the refusals the fleet
 * keeps on purpose (KEPT). A skill only Flight runs is listed in FLIGHT_ONLY with the reason.
 */

import { shellRefusal } from './guards'
import type { CloneScope } from './guards'

/** Skills only Flight runs, and why: each writes portfolio-wide files or works across every front. */
export const FLIGHT_ONLY: Record<string, string> = {
  briefing: 'writes the daily pointer and the board rows for the whole portfolio',
  debrief: 'writes the daily pointer and the board for the whole portfolio',
  retro: 'closes the week for the whole portfolio and writes the daily pointer and the board',
  fleet: 'staffs and calls the Controllers themselves, and writes the fleet state',
  'new-front': 'writes the board, the daily pointer and the operating file, and creates a front no Controller owns yet',
  'retire-front': 'writes the board, the daily pointer and the operating file, and archives a front',
  preflight: 'audits the whole instance, every front and the operating file included',
  'promote-learnings': 'writes CONSTITUTION.local.md, the learning log and memory, which bind every front',
  'learn-from-session': 'writes the learning log and session memory, which every front reads; a Controller leaves lesson candidates in its ticket instead',
  triage: 'routes items across every front and writes the daily pointer',
  standup: 'reports across fronts by default and appends to the daily ledger',
  'product-flow': 'phases 0 to 5 run /new-front; its build epics run on a front\'s Controller through /epic-flow',
}

/** Refusals the fleet keeps although a skill names the command: a base, a merge, an undo-less or shared-state act. */
export const KEPT: { match: RegExp; why: string }[] = [
  { match: /^git stash\b/, why: 'a stash can hide someone else\'s work; skills name it only as a ban' },
  { match: /^gh auth (switch|login|logout|refresh)\b/, why: 'it changes the account every session on this Mac uses' },
  { match: /^git push$/, why: 'a bare push names no branch; skills name it only in prose' },
  { match: /^git bisect\b/, why: 'named as a property commits keep, not run' },
]

const ACME = '/w/fronts/acme/acme'
const SCOPE: CloneScope = { home: '/w/fronts/acme', fronts: ['acme'] }

/** The git and gh commands a skill's text names: inline code spans and lines of fenced blocks that start with git or gh. */
export function skillCommands(text: string): string[] {
  const out: string[] = []
  let fenced = false
  for (const line of text.split('\n')) {
    if (/^\s*```/.test(line)) {
      fenced = !fenced
      continue
    }
    if (fenced) {
      const cmd = line.replace(/\s+#.*$/, '').trim()
      if (/^(git|gh)\s/.test(cmd)) out.push(cmd)
      continue
    }
    for (const m of line.matchAll(/`((?:git|gh) [^`]+)`/g)) out.push((m[1] ?? '').trim())
  }
  return out
}

/** A command as a Controller would type it: placeholders given a literal value, pinned to its repo. */
export function asTyped(cmd: string): string {
  const literal = cmd.replace(/-C <[^>]*>/g, `-C ${ACME}`).replace(/<[^>]*>/g, 'x').replace(/\s\.\.\.$/, ' status')
  return `cd ${ACME} && ${literal}`
}

export type Gap = { skill: string; command: string; refusal: string }

/** Each command a Controller-runnable skill names that the guard refuses and KEPT does not list. */
export function coverageGaps(skills: { name: string; text: string }[]): Gap[] {
  const gaps: Gap[] = []
  for (const { name, text } of skills) {
    if (name in FLIGHT_ONLY) continue
    for (const command of skillCommands(text)) {
      const refusal = shellRefusal('controller', asTyped(command), [], ACME, SCOPE)
      if (refusal && !KEPT.some(k => k.match.test(command))) gaps.push({ skill: name, command, refusal })
    }
  }
  return gaps
}
