// One named terminal session: /s/<name>/ shows its transcript, read from the app server's
// /s/<name>/events stream. The token arrives once as ?t= and lives in localStorage, like the main page.
;(() => {
  const params = new URLSearchParams(location.search)
  if (params.get('t')) {
    try { localStorage.setItem('mcapp-token', params.get('t')) } catch {}
    history.replaceState(null, '', location.pathname)
  }
  let token = ''
  try { token = localStorage.getItem('mcapp-token') ?? '' } catch {}
  const name = decodeURIComponent(location.pathname.split('/')[2] ?? '')
  const main = document.getElementById('main')
  const say = (text, state) => {
    document.getElementById('link-text').textContent = text
    document.getElementById('link').dataset.state = state ?? ''
  }
  document.getElementById('title').textContent = name || 'Session'
  document.title = `${name || 'Session'} - Mission Control`

  const note = text => {
    const p = document.createElement('p')
    p.className = 'hint'
    p.textContent = text
    main.replaceChildren(p)
  }
  const headers = (extra = {}) => ({ ...(token ? { 'x-mcapp-token': token } : {}), ...extra })
  const prefix = `/s/${encodeURIComponent(name)}`
  const say2 = text => {
    const t = document.getElementById('readonly')
    t.textContent = text
    t.hidden = !text
  }
  let tmux = false
  let alive = false
  function lockComposer() {
    const can = tmux && alive
    document.getElementById('draft').disabled = !can
    document.querySelector('#send .send').disabled = !can
    say2(!alive ? 'This session has ended; its messages stay here.' : !tmux ? `Read-only: this session is not running in tmux. Reopen it with tools/console app --code ${name}` : '')
  }
  async function post(path, body) {
    try {
      const r = await fetch(`${prefix}/${path}`, { method: 'POST', headers: headers({ 'Content-Type': 'application/json' }), body: JSON.stringify(body) })
      return r.ok ? '' : r.status === 409 ? 'This session is not in tmux, so it cannot be typed into.' : r.status === 410 ? 'This session has ended.' : r.status === 401 ? 'Open the link /console app printed first.' : 'The Mac did not take that.'
    } catch {
      return "Couldn't reach the Mac. Check that it is awake and connected."
    }
  }
  document.getElementById('send').addEventListener('submit', async e => {
    e.preventDefault()
    const draft = document.getElementById('draft')
    const text = draft.value.trim()
    if (!text) return
    const problem = await post('send', { text })
    if (problem) return say2(problem)
    draft.value = ''
    say2('')
  })
  document.getElementById('draft').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && matchMedia('(min-width: 1024px)').matches) {
      e.preventDefault()
      document.getElementById('send').requestSubmit()
    }
  })

  // The terminal's own question (a permission prompt, a choice): read from its screen while the page is
  // open, answered by pressing the option's key.
  const promptBox = document.getElementById('prompt')
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
        if (problem) say2(problem)
        asking = ''
      })
      row.append(b)
    }
    promptBox.replaceChildren(k, h, row)
    promptBox.hidden = false
  }
  setInterval(readScreen, 2000)

  function paint(st) {
    if (!st.gone) {
      tmux = st.session.tmux
      alive = st.session.alive
      lockComposer()
    }
    if (st.gone) {
      say('This session is no longer registered', 'off')
      return
    }
    const s = st.session
    say(`${s.alive ? 'Running' : 'Ended'} · ${s.cwd}`, s.alive ? 'live' : 'off')
    if (!st.messages.length) return note('Nothing said in this session yet.')
    const atEnd = main.scrollHeight - main.scrollTop - main.clientHeight < 80
    main.replaceChildren(
      ...st.messages.map(m => {
        const d = document.createElement('div')
        d.className = `msg ${m.role} md`
        d.innerHTML = window.mcMarkdown(m.text)
        return d
      }),
    )
    if (atEnd) main.scrollTop = main.scrollHeight
  }

  // EventSource cannot set headers, so the token rides as ?t=, as the main page does.
  const open = () => {
    const es = new EventSource(`/s/${encodeURIComponent(name)}/events${token ? `?t=${encodeURIComponent(token)}` : ''}`)
    es.onmessage = e => {
      try { paint(JSON.parse(e.data)) } catch {}
    }
    es.onerror = async () => {
      es.close()
      const r = await fetch(`/s/${encodeURIComponent(name)}/state.json`, { headers: token ? { 'x-mcapp-token': token } : {} }).catch(() => null)
      if (r && r.status === 404) return note(`No session named "${name}". Start it with claude -n ${name}, or run /console app --code ${name} inside it.`), say('Not found', 'off')
      if (r && r.status === 401) return note('This page needs the app open on this device first: open the link /console app printed.'), say('Needs the link', 'off')
      say('Reconnecting…', 'off')
      setTimeout(open, 3000)
    }
  }
  open()
})()
