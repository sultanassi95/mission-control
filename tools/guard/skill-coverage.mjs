// Which git and gh commands the shipped skills name, and whether the push-to-base guard would stop one.
// A skill must name no command that asks before a push to a base branch, except the mentions listed in
// KEPT: a skill that says "never run X" names X as a ban, and the guard asking there is right.
import { pushConcern } from './push.mjs'

/** Mentions the guard may ask about although a skill names them: each says why. */
export const KEPT = [
  { match: /^git push$/, why: 'a bare push names no branch; skills name it only in prose' },
]

const CTX = { cwd: '/w/fronts/acme/acme', protected: () => [], currentBranch: () => 'feat/x', upstreamBranch: () => undefined, pushAliases: () => [] }

/** The git and gh commands a skill's text names: inline code spans and lines of fenced blocks that start with git or gh. */
export function skillCommands(text) {
  const out = []
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

/** A command as a session would type it: placeholders given a literal value. */
export function asTyped(cmd) {
  return cmd.replace(/-C <[^>]*>/g, '-C /w/fronts/acme/acme').replace(/<[^>]*>/g, 'x').replace(/\s\.\.\.$/, ' status')
}

/** Each command a skill names that the guard would ask about and KEPT does not list. */
export function coverageGaps(skills) {
  const gaps = []
  for (const { name, text } of skills) {
    for (const command of skillCommands(text)) {
      const ask = pushConcern(asTyped(command), CTX)
      if (ask && !KEPT.some(k => k.match.test(command))) gaps.push({ skill: name, command, ask })
    }
  }
  return gaps
}
