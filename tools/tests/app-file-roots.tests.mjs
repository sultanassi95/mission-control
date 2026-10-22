// Tests for tools/app/files.mjs fileRoots: the default roots, on a scratch temporary root.
// Run: node --test tools/tests/app-file-roots.tests.mjs
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileRoots } from '../app/files.mjs'

// A user id; the session folders sit under claude-<uid> in the temporary root.
const UID = 501

test('by default only this portfolio\'s session folders, its portfolio folder and its fronts are roots', () => {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'mc-roots-')))
  try {
    const portfolio = join(scratch, 'Users', 'me', 'mc')
    const sessions = join(scratch, 'tmp', `claude-${UID}`)
    const slug = portfolio.replace(/[^A-Za-z0-9]/g, '-')
    for (const d of [join(portfolio, '_command', 'portfolio'), join(portfolio, 'fronts'), join(sessions, slug), join(sessions, `${slug}-fronts-shop`), join(sessions, '-Users-me-other-project')]) mkdirSync(d, { recursive: true })
    const roots = fileRoots({}, portfolio, UID, join(scratch, 'tmp'))
    assert.deepEqual(roots.sort(), [join(sessions, slug), join(sessions, `${slug}-fronts-shop`), join(portfolio, '_command', 'portfolio'), join(portfolio, 'fronts')].sort())
    // Named roots replace the defaults; a relative or missing one serves nothing.
    assert.deepEqual(fileRoots({ MCAPP_FILE_ROOTS: `${join(portfolio, 'fronts')}:relative:/no/such/dir` }, portfolio, UID, join(scratch, 'tmp')), [join(portfolio, 'fronts')])
    // With no portfolio known and nothing named, nothing is served.
    assert.deepEqual(fileRoots({}, '', UID, join(scratch, 'tmp')), [])
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
})
