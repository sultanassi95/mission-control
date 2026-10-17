// The founder's own words, read back from Flight's transcript: what he typed, whether a message
// he queued has arrived, and the files a message carried.
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
  // A console command tapped or typed in the app reaches Flight as this relay prompt (relayToFlight in
  // the mod's hooks/register.ts), its words twice; it reads as the command, without its one-time code.
  const RELAY = /^From the Mission Control App, the founder sent: ([\s\S]*?)\nRun it now with the console tool, args exactly: \1 --code [0-9a-f]+$/
  // Claude Code records a prompt the app submits between a plugin preamble and a trailing note; the founder typed only what follows it.
  const typed = v => {
    const t = stripReminders(v).replace(/^The [\w-]+ plugin sent a message:\n/, '').replace(/\n+This is how Claude Code surfaces a prompt a plugin submits[\s\S]*$/, '').trim()
    const relayed = RELAY.exec(t)
    return command(t) ?? (relayed ? `/console ${relayed[1].trim()}` : t)
  }
  // The same message, spacing aside: the fleet runs a command with its words joined by single spaces.
  const flat = t => str(t).replace(/\s+/g, ' ').trim()
  const same = (a, b) => flat(a) === flat(b)
  // Where the founder's messages that reached the transcript after a snapshot of it begin (said: his
  // messages there now, as typed; before: the same list when a message was sent). The fleet sends the
  // last 40 messages, so the oldest leave the front as new ones arrive: the snapshot's tail is a prefix
  // of the later list, and whatever follows that prefix arrived after the send.
  const since = (before, said) => {
    for (let d = 0; d < before.length; d++) {
      const n = before.length - d
      if (n <= said.length && before.slice(d).every((t, i) => t === said[i])) return n
    }
    return 0
  }
  // What is still waiting. A sent message leaves once a copy of it reached the transcript after it was
  // sent and no earlier queued message took that copy, so an older identical message (yesterday's
  // /briefing, an earlier "yes") never clears it, and two identical messages leave one for one. It also
  // leaves once the fleet answered its op itself: every op the fleet hands to Flight answers "Sent to
  // Flight..." and reaches the transcript later, while a console command such as list, or a slash command
  // that has run, is answered there and then (runAppOp in the mod's hooks/register.ts). The answer showing
  // when it was sent is never its answer: a restarted app server numbers its ops from 1 again.
  const handedOn = op => /^Sent to Flight\b/.test(str(op?.text))
  const waiting = (queued, said, lastOp) => {
    const taken = new Set()
    return queued.filter(q => {
      if (!q.sent) return true
      const answered = Boolean(q.op) && Number(lastOp?.id) === q.op && !handedOn(lastOp) && !(q.lastAt && lastOp?.at === q.lastAt)
      if (answered) return false
      for (let i = since(q.before ?? [], said); i < said.length; i++) {
        if (taken.has(i) || !same(said[i], q.text)) continue
        taken.add(i)
        return false
      }
      return true
    })
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

  window.mcTranscript = { stripReminders, typed, same, since, waiting, PHOTO_EXTS, DOC_EXTS, attachments, safeName, line }
})(window)
