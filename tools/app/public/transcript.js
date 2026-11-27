// The founder's own words, read back from a session's transcript: what he typed and the files a message carried.
;(window => {
  const str = v => (v === undefined || v === null ? '' : String(v))
  const stripReminders = t => str(t).replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim()

  // The engine records a slash command the app runs as tags (<command-name>, <command-args>, a
  // <command-message> note); the founder typed "/name args". Only a message that opens with a tag is one.
  const tag = (t, name) => new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(t)?.[1].trim()
  const command = t => {
    if (!/^<command-(?:message|name|args)>/.test(t)) return null
    const name = tag(t, 'command-name')
    if (!name) return null
    const args = tag(t, 'command-args') ?? ''
    return `/${name.replace(/^\//, '')}${args ? ` ${args}` : ''}`
  }
  // What the founder typed, read back from the transcript: a slash command the engine recorded as tags reads as "/name args".
  const typed = v => {
    const t = stripReminders(v)
    return command(t) ?? t
  }

  // Each file travels as one line at the end of the message, naming its stored path; Flight opens it with
  // Read. A photo line names a photo and a document line a document, so a line that pairs them otherwise
  // is text, never a file the page fetches and opens.
  const PHOTO_EXTS = ['jpg', 'png', 'webp']
  const DOC_EXTS = ['pdf', 'txt', 'md', 'csv', 'json']
  const ATTACHMENT = new RegExp(String.raw`\n*\[(Photo|Document) from the app: ([^\n\]]*?\/uploads\/([a-f0-9]{24}\.(${[...PHOTO_EXTS, ...DOC_EXTS].join('|')})))(?: \(([^()\n]*)\))? - open it with Read\]\s*$`)
  const attachments = text => {
    let body = str(text)
    const files = []
    for (let m = ATTACHMENT.exec(body); m; m = ATTACHMENT.exec(body)) {
      const kind = m[1] === 'Photo' ? 'photo' : 'document'
      if ((kind === 'photo') !== PHOTO_EXTS.includes(m[4])) break
      files.unshift({ kind, path: m[2], id: m[3], ext: m[4], name: m[5] ?? '' })
      body = body.slice(0, m.index)
    }
    return { body: files.length ? body.trimEnd() : body, files }
  }
  // A document's name rides in its line, so it is kept to one plain line the parser reads back.
  const safeName = name => str(name).replace(/[()[\]]/g, '').replace(/[\u0000-\u001f\u007f\s]+/g, ' ').trim().slice(0, 80)
  const line = f => (f.kind === 'photo' ? `[Photo from the app: ${f.path} - open it with Read]` : `[Document from the app: ${f.path} (${safeName(f.name)}) - open it with Read]`)

  window.mcTranscript = { stripReminders, typed, PHOTO_EXTS, DOC_EXTS, attachments, safeName, line }
})(window)
