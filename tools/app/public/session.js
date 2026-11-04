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
  function paint(st) {
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
