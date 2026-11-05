// No shipped skill names a git command that the push-to-base guard asks about, so a skill never stops at a prompt it did not mean to raise.
// Run: node --test tools/tests/skill-coverage.test.mjs
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { asTyped, coverageGaps, KEPT, skillCommands } from '../guard/skill-coverage.mjs'

const SKILLS = fileURLToPath(new URL('../../.claude/skills', import.meta.url))
const markdown = dir => readdirSync(dir).sort().flatMap(n => {
  const p = join(dir, n)
  return statSync(p).isDirectory() ? markdown(p) : n.endsWith('.md') ? [p] : []
})

test('every git and gh command a shipped skill names passes the push-to-base guard, or is a kept mention', () => {
  const names = readdirSync(SKILLS).filter(n => statSync(join(SKILLS, n)).isDirectory()).sort()
  const skills = names.map(name => ({ name, text: markdown(join(SKILLS, name)).map(f => readFileSync(f, 'utf8')).join('\n') }))
  // The instrument reads the shipped skills: all of them, and the commands mission-flow runs.
  for (const name of ['mission-flow', 'epic-flow', 'console']) assert.ok(names.includes(name), name)
  assert.ok(skillCommands(skills.find(s => s.name === 'mission-flow').text).includes('gh pr create'))
  assert.deepEqual(coverageGaps(skills).map(g => `${g.skill}: ${g.command} -> ${g.ask}`), [])
})

test('the coverage check reports a skill that names a push to a base branch, and nothing else', () => {
  const named = coverageGaps([{ name: 'acme-flow', text: 'Then run `git push origin main`.' }])
  assert.deepEqual(named.map(g => g.command), ['git push origin main'])
  assert.equal(named[0].skill, 'acme-flow')
  assert.deepEqual(coverageGaps([{ name: 'acme-flow', text: '```\ngit push origin main   # the base\n```' }]).map(g => g.command), ['git push origin main'])
  assert.deepEqual(coverageGaps([{ name: 'acme-flow', text: 'Open it with `gh pr create`, watch `gh pr checks <n> --watch`, never `git stash -u`, push `git push -u origin feat/x`.' }]), [])
  assert.ok(KEPT.some(k => k.match.test('git push')))
  assert.equal(asTyped('git -C <repo> ...'), 'git -C /w/fronts/acme/acme status')
})
