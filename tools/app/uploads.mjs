// What the app may upload, how a file's type is decided, and how long the folder keeps it.
// Imported by server.mjs; it does nothing on import, so tests drive it on a scratch folder.
import { readdirSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

export const FILE_MAX = 8 * 1024 * 1024
export const TOO_LARGE = 'that file is over 8 MB'
// A file is kept only as long as a conversation needs it, and the folder stays bounded.
export const KEEP = { days: 7, files: 200, bytes: 256 * 1024 * 1024 }
export const FILE_ROUTE = /^\/upload\/([a-f0-9]{24})\.(jpg|png|webp|pdf|txt|md|csv|json)$/
// Every text type is served as plain text, so no stored file is ever read as a page.
export const SERVED = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf', txt: 'text/plain; charset=utf-8', md: 'text/plain; charset=utf-8', csv: 'text/plain; charset=utf-8', json: 'text/plain; charset=utf-8' }
export const REFUSED = 'only photos (JPEG, PNG or WebP), PDF, or .txt, .md, .csv and .json files'
const TEXT = new Set(['txt', 'md', 'csv', 'json'])

// A photo or a PDF is stored by its own first bytes, whatever name it came with. A text file's kind
// cannot be read from its bytes, so its extension comes from the name it was picked with, once the
// bytes are UTF-8 text with no control characters (and a .json parses). Returns { ext } or { reason }.
export function classify(body, named = '') {
  if (!body.length) return { reason: 'that file is empty' }
  if (body.length > 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) return { ext: 'jpg' }
  if (body.length > 8 && body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: 'png' }
  if (body.length > 12 && body.toString('latin1', 0, 4) === 'RIFF' && body.toString('latin1', 8, 12) === 'WEBP') return { ext: 'webp' }
  if (body.toString('latin1', 0, 5) === '%PDF-') return { ext: 'pdf' }
  const ext = String(named ?? '').toLowerCase()
  if (ext === 'pdf') return { reason: 'that file is not a PDF' }
  if (!TEXT.has(ext)) return { reason: REFUSED }
  let text
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(body)
  } catch {
    return { reason: `that .${ext} file is not UTF-8 text` }
  }
  if (/[\u0000-\u0008\u000b\u000e-\u001f\u007f]/.test(text)) return { reason: `that .${ext} file holds binary data, not text` }
  if (ext === 'json') {
    try {
      JSON.parse(text)
    } catch {
      return { reason: 'that .json file does not parse' }
    }
  }
  return { ext }
}

// Old files go, then the newest are kept up to the count and size caps, whatever their type.
// Returns the names it removed.
export function prune(dir, keep = KEEP, now = Date.now()) {
  const gone = []
  const files = []
  for (const f of readdirSync(dir)) {
    try {
      const st = statSync(join(dir, f))
      if (now - st.mtimeMs > keep.days * 86_400_000) {
        unlinkSync(join(dir, f))
        gone.push(f)
      } else files.push({ f, at: st.mtimeMs, size: st.size })
    } catch {
      /* removed by another server meanwhile */
    }
  }
  files.sort((a, b) => b.at - a.at)
  let total = 0
  files.forEach((x, i) => {
    total += x.size
    if (i >= keep.files || total > keep.bytes) {
      try {
        unlinkSync(join(dir, x.f))
        gone.push(x.f)
      } catch {
        /* already gone */
      }
    }
  })
  return gone
}
