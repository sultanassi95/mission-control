// Run: bun test tools/tests/skill-coverage.test.ts   (from the repository root)
// Reads every shipped skill, so it runs under bun with the file system, not under `claude plugin test`.
import { expect, test } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { asTyped, coverageGaps, FLIGHT_ONLY, KEPT, skillCommands } from '../mods/mission-fleet/hooks/skill-coverage'

const SKILLS = join(import.meta.dir, '../../.claude/skills')
const markdown = (dir: string): string[] => readdirSync(dir).sort().flatMap(n => {
  const p = join(dir, n)
  return statSync(p).isDirectory() ? markdown(p) : n.endsWith('.md') ? [p] : []
})

test('every git and gh command a Controller-runnable skill names runs under the Controller guard, or is a kept refusal', () => {
  const names = readdirSync(SKILLS).filter(n => statSync(join(SKILLS, n)).isDirectory()).sort()
  const skills = names.map(name => ({ name, text: markdown(join(SKILLS, name)).map(f => readFileSync(f, 'utf8')).join('\n') }))
  // The instrument reads the shipped skills: all of them, and the commands mission-flow runs.
  for (const name of ['mission-flow', 'epic-flow', 'design-review']) expect(names).toContain(name)
  expect(skillCommands(skills.find(s => s.name === 'mission-flow')?.text ?? '')).toContain('gh pr create')
  for (const name of Object.keys(FLIGHT_ONLY)) expect(`${name} ${names.includes(name)}`).toBe(`${name} true`)
  expect(coverageGaps(skills).map(g => `${g.skill}: ${g.command} -> ${g.refusal}`)).toEqual([])
})

test('the coverage check reports a refused command in a Controller skill, and not in a Flight-only one', () => {
  const merge = 'Then run `gh pr merge 3 --squash`.'
  expect(coverageGaps([{ name: 'acme-flow', text: merge }]).map(g => g.command)).toEqual(['gh pr merge 3 --squash'])
  expect(coverageGaps([{ name: 'briefing', text: merge }])).toEqual([])
  expect(coverageGaps([{ name: 'acme-flow', text: '```\ngit push origin main   # the base\n```' }]).map(g => g.command)).toEqual(['git push origin main'])
  expect(coverageGaps([{ name: 'acme-flow', text: 'Never `git stash -u`; open it with `gh pr create`, watch `gh pr checks <n> --watch`.' }])).toEqual([])
  expect(KEPT.some(k => k.match.test('gh auth switch --user x'))).toBe(true)
  expect(asTyped('git -C <repo> ...')).toBe('cd /w/fronts/acme/acme && git -C /w/fronts/acme/acme status')
})
