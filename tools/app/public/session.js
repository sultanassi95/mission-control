// One named terminal session: /s/<name>/ shows its transcript (the app server's /s/<name>/events stream),
// types into it through tmux when it runs there, and answers the menu its terminal is showing.
// The token arrives once as ?t= and lives in localStorage, scoped to this origin.
;(() => {
  const params = new URLSearchParams(location.search)
  if (params.get('t')) {
    try { localStorage.setItem('mcapp-token', params.get('t')) } catch {}
    history.replaceState(null, '', location.pathname)
  }
  let token = ''
  try { token = localStorage.getItem('mcapp-token') ?? '' } catch {}
  const { attachments, typed, line, DOC_EXTS } = window.mcTranscript
  const name = decodeURIComponent(location.pathname.split('/')[2] ?? '')
  const prefix = `/s/${encodeURIComponent(name)}`
  const $ = id => document.getElementById(id)
  const main = $('main')
  const headers = (extra = {}) => ({ ...(token ? { 'x-mcapp-token': token } : {}), ...extra })
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
  const say = (text, state) => {
    $('link-text').textContent = text
    $('link').dataset.state = state ?? ''
  }
  const note = text => {
    const p = document.createElement('p')
    p.className = 'hint'
    p.textContent = text
    main.replaceChildren(p)
  }
  const toast = text => {
    const t = $('toast')
    t.textContent = text
    t.hidden = false
    clearTimeout(toast.timer)
    toast.timer = setTimeout(() => (t.hidden = true), 5000)
  }
  $('title').textContent = name || 'Session'
  document.title = `${name || 'Session'} - Mission Control`

  // ---------- files a message carries ----------
  // Each file travels as one line at the end of the message, naming its stored path; the session opens it with Read.
  // A document's blob takes a fixed type whatever the server answered: a PDF opens as a PDF, every text file as plain text.
  const OPENS_AS = { pdf: 'application/pdf', txt: 'text/plain;charset=utf-8', md: 'text/plain;charset=utf-8', csv: 'text/plain;charset=utf-8', json: 'text/plain;charset=utf-8' }
  const LIMIT = { files: 10, file: 8 * 1024 * 1024 }
  // A message is at most this long, its file lines included (the server takes 8000 for a send).
  const TEXT_MAX = 5800
  const PHOTO_NAME = /\.(jpe?g|png|webp|gif|heic|heif|avif)$/i
  const kept = new Map()
  const keptFile = (id, ext) => {
    if (!kept.has(id)) {
      kept.set(id, { state: 'loading', url: '' })
      fetch(`/upload/${id}`, { headers: headers() })
        .then(async r => {
          if (r.status === 404 && (await r.text().catch(() => '')) === 'that file is gone') kept.set(id, { state: 'gone', url: '' })
          else if (!r.ok) throw new Error(`upload ${r.status}`)
          else {
            const b = await r.blob()
            kept.set(id, { state: 'ready', url: URL.createObjectURL(OPENS_AS[ext] ? new Blob([b], { type: OPENS_AS[ext] }) : b) })
          }
          if (last) paint(last)
        })
        .catch(() => setTimeout(() => kept.delete(id), 10_000))
    }
    return kept.get(id)
  }
  const photoView = (f, i, n) => {
    const got = keptFile(f.id, f.ext)
    if (got.state === 'ready') return `<img${n > 1 ? '' : ' class="photo"'} src="${esc(got.url)}" alt="${n > 1 ? `Photo ${i + 1} of ${n} you sent` : 'Photo you sent'}">`
    return `<span class="ph">${got.state === 'gone' ? 'Photo no longer on the Mac' : 'Photo loading…'}</span>`
  }
  const docView = f => {
    const got = keptFile(f.id, f.ext)
    const label = esc(f.name || f.id)
    const type = `<span class="ftype" aria-hidden="true">${esc(f.ext)}</span>`
    if (got.state === 'ready') return `<a class="doc" href="${esc(got.url)}" target="_blank" rel="noopener">${type}<span class="doc-name">${label}<span class="visually-hidden">, opens in a new tab</span></span></a>`
    return `<span class="doc${got.state === 'gone' ? ' gone' : ''}">${type}<span class="doc-name">${label}</span><span class="doc-state">· ${got.state === 'gone' ? 'no longer on the Mac' : 'loading'}</span></span>`
  }
  const userBubble = text => {
    const { body, files } = attachments(typed(text))
    const photos = files.filter(f => f.kind === 'photo')
    const docs = files.filter(f => f.kind === 'document')
    const pics = photos.length > 1 ? `<div class="photos">${photos.map((f, i) => photoView(f, i, photos.length)).join('')}</div>` : photos.map(f => photoView(f, 0, 1)).join('')
    const chips = docs.length ? `<div class="docs">${docs.map(docView).join('')}</div>` : ''
    return `<div class="msg user"><div class="who">You</div>${pics}${chips}${body ? esc(body) : ''}</div>`
  }

  // ---------- the transcript ----------
  let last = null
  let tmux = false
  let alive = false
  function paint(st) {
    last = st
    if (st.gone) return say('This session is no longer registered', 'off')
    const s = st.session
    tmux = s.tmux
    alive = s.alive
    say(`${s.alive ? 'Running' : 'Ended'} · ${s.cwd}`, s.alive ? 'live' : 'off')
    lockComposer()
    if (!st.messages.length) return note('Nothing said in this session yet.')
    const atEnd = main.scrollHeight - main.scrollTop - main.clientHeight < 80
    main.innerHTML = st.messages
      .map(m => (m.role === 'user' ? userBubble(m.text) : `<div class="msg assistant md"><div class="who">${esc(name)}</div>${window.mcMarkdown(m.text)}</div>`))
      .join('')
    if (atEnd) main.scrollTop = main.scrollHeight
  }

  // ---------- typing into the session ----------
  const hint = (id, text) => {
    $(id).textContent = text
    $(id).hidden = !text
  }
  function lockComposer() {
    const can = tmux && alive
    $('draft').disabled = !can
    $('attach').disabled = !can
    document.querySelector('#send .send').disabled = !can
    hint('readonly', !alive ? 'This session has ended; its messages stay here.' : !tmux ? `Read-only: this session is not running in tmux. Reopen it with node tools/console app --code ${name}` : '')
  }
  async function post(path, body) {
    try {
      const r = await fetch(`${prefix}/${path}`, { method: 'POST', headers: headers({ 'Content-Type': 'application/json' }), body: JSON.stringify(body) })
      return r.ok ? '' : r.status === 409 ? 'This session is not in tmux, so it cannot be typed into.' : r.status === 410 ? 'This session has ended.' : r.status === 401 ? 'Open the link the console printed first.' : 'The Mac did not take that.'
    } catch {
      return "Couldn't reach the Mac. Check that it is awake and connected."
    }
  }
  const pending = []
  const paintAttached = () => hint('attached', pending.length ? `${pending.length} of ${LIMIT.files} files attached: ${pending.map(f => f.name).join(', ')}` : '')
  $('send').addEventListener('submit', async e => {
    e.preventDefault()
    const text = [$('draft').value.trim(), ...pending.map(line)].filter(Boolean).join('\n')
    if (!text) return
    if (text.length > TEXT_MAX) return toast(`That message is ${text.length} characters, and a send takes ${TEXT_MAX}. Shorten it or send fewer files.`)
    const problem = await post('send', { text })
    if (problem) return toast(problem)
    $('draft').value = ''
    pending.length = 0
    paintAttached()
  })
  $('draft').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && matchMedia('(min-width: 1024px)').matches) {
      e.preventDefault()
      $('send').requestSubmit()
    }
  })

  // Photos are scaled on the device to 1600 px on the long side as JPEG, so a 10 MB camera file goes up as a few hundred KB.
  async function shrink(file) {
    const url = URL.createObjectURL(file)
    try {
      const img = await new Promise((resolve, reject) => {
        const i = new Image()
        i.onload = () => resolve(i)
        i.onerror = reject
        i.src = url
      })
      const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight))
      const c = document.createElement('canvas')
      c.width = Math.round(img.naturalWidth * k)
      c.height = Math.round(img.naturalHeight * k)
      const ctx = c.getContext('2d')
      ctx.fillStyle = 'white'
      ctx.fillRect(0, 0, c.width, c.height)
      ctx.drawImage(img, 0, 0, c.width, c.height)
      return await new Promise(resolve => c.toBlob(resolve, 'image/jpeg', 0.85))
    } finally {
      URL.revokeObjectURL(url)
    }
  }
  async function upload(blob, ext, label) {
    try {
      const r = await fetch('/upload', { method: 'POST', headers: headers({ 'Content-Type': blob.type || 'application/octet-stream', 'x-mcapp-ext': ext }), body: blob })
      if (r.ok) return { stored: await r.json() }
      const why = r.status === 401 ? 'this link has expired; open the new link from your Mac' : (await r.text().catch(() => '')).trim().slice(0, 200)
      return { error: `Couldn't send ${label}${why ? `: ${why}` : '. Try again in a moment'}.` }
    } catch {
      return { error: "Couldn't reach the Mac. Check that it is awake and connected." }
    }
  }
  $('attach').addEventListener('click', () => $('files').click())
  $('files').addEventListener('change', async e => {
    const picks = [...(e.target.files ?? [])]
    e.target.value = ''
    const refused = []
    for (const file of picks) {
      const ext = (/\.([a-z0-9]+)$/i.exec(file.name)?.[1] ?? '').toLowerCase()
      const photo = file.type.startsWith('image/') || PHOTO_NAME.test(file.name)
      let why = ''
      if (pending.length >= LIMIT.files) why = `a message carries ${LIMIT.files} files at most`
      else if (!photo && !DOC_EXTS.includes(ext)) why = 'only photos, PDF, or .txt, .md, .csv and .json files'
      else if (!file.size) why = 'the file is empty'
      else if (!photo && file.size > LIMIT.file) why = `over ${LIMIT.file / 1048576} MB`
      if (!why) {
        const blob = photo ? await shrink(file).catch(() => null) : file
        if (!blob) why = "it can't be read as a photo"
        else if (blob.size > LIMIT.file) why = `over ${LIMIT.file / 1048576} MB`
        else {
          const got = await upload(blob, photo ? 'jpg' : ext, file.name)
          if (got.error) why = got.error
          else pending.push({ kind: photo ? 'photo' : 'document', path: got.stored.path, name: file.name })
        }
      }
      if (why) refused.push(`${file.name} (${why})`)
      paintAttached()
    }
    if (refused.length) toast(`Not added: ${refused.join('; ')}.`)
    $('draft').focus()
  })

  // ---------- the terminal's own question ----------
  // A permission prompt or a choice, read from the session's screen while the page is open and answered by
  // pressing the option's key.
  const promptBox = $('prompt')
  let asking = ''
  async function readScreen() {
    if (!tmux || !alive || document.visibilityState !== 'visible') return
    const r = await fetch(`${prefix}/screen`, { headers: headers() }).catch(() => null)
    const m = r && r.ok ? (await r.json().catch(() => null))?.menu : null
    const sig = m ? JSON.stringify(m) : ''
    if (sig === asking) return
    asking = sig
    if (!m) {
      promptBox.hidden = true
      return
    }
    const h = document.createElement('h2')
    h.textContent = m.question || 'The session is asking'
    const k = document.createElement('p')
    k.className = 'kind'
    k.textContent = 'Waiting on you'
    const row = document.createElement('div')
    row.className = `btnrow ${m.options.length === 2 ? 'two' : 'one'}`
    for (const o of m.options) {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = o.key === m.selected ? 'primary' : 'note'
      b.textContent = o.label
      b.addEventListener('click', async () => {
        row.querySelectorAll('button').forEach(x => (x.disabled = true))
        const problem = await post('key', { key: o.key })
        if (problem) toast(problem)
        asking = ''
      })
      row.append(b)
    }
    promptBox.replaceChildren(k, h, row)
    promptBox.hidden = false
  }
  setInterval(readScreen, 2000)

  // ---------- the switcher: the other sessions, one tap away ----------
  async function loadSessions() {
    const r = await fetch('/sessions.json', { headers: headers() }).catch(() => null)
    const list = r && r.ok ? ((await r.json().catch(() => null))?.sessions ?? []) : []
    const nav = $('switcher')
    nav.hidden = list.length < 2
    nav.replaceChildren(
      ...list.map(s => {
        const a = document.createElement('a')
        a.className = 'chip'
        a.href = `/s/${encodeURIComponent(s.name)}/`
        a.textContent = s.name
        if (s.name === name) a.setAttribute('aria-current', 'page')
        if (!s.alive) a.dataset.ended = ''
        return a
      }),
    )
  }
  loadSessions()
  setInterval(loadSessions, 10_000)

  // EventSource cannot set headers, so the token rides as ?t=.
  const open = () => {
    const es = new EventSource(`${prefix}/events${token ? `?t=${encodeURIComponent(token)}` : ''}`)
    es.onmessage = e => {
      try { paint(JSON.parse(e.data)) } catch {}
    }
    es.onerror = async () => {
      es.close()
      const r = await fetch(`${prefix}/state.json`, { headers: headers() }).catch(() => null)
      if (r && r.status === 404) return note(`No session named "${name}". Start it with claude -n ${name}, or run /console app --code ${name} inside it.`), say('Not found', 'off')
      if (r && r.status === 401) return note('This page needs the app open on this device first: open the link the console printed.'), say('Needs the link', 'off')
      say('Reconnecting…', 'off')
      setTimeout(open, 3000)
    }
  }
  open()
})()
