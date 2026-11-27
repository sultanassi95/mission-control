// The app's front page: the named terminal sessions on this Mac, each a link to its own view (/s/<name>/).
// The token arrives once as ?t= and lives in localStorage, scoped to this origin.
;(() => {
  const params = new URLSearchParams(location.search)
  if (params.get('t')) {
    try { localStorage.setItem('mcapp-token', params.get('t')) } catch {}
    history.replaceState(null, '', location.pathname)
  }
  let token = ''
  try { token = localStorage.getItem('mcapp-token') ?? '' } catch {}
  const $ = id => document.getElementById(id)
  const main = $('main')
  const say = (text, state) => {
    $('link-text').textContent = text
    $('link').dataset.state = state ?? ''
  }

  // ---------- theme ----------
  const themeChoice = () => { try { return localStorage.getItem('mcapp-theme') || 'system' } catch { return 'system' } }
  function setTheme(t) {
    try { t === 'system' ? localStorage.removeItem('mcapp-theme') : localStorage.setItem('mcapp-theme', t) } catch {}
    if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t
    else delete document.documentElement.dataset.theme
    paintTheme()
  }
  // The status bar follows the chosen theme, not only the device's: read from the tokens once they apply.
  function paintTheme() {
    const t = themeChoice()
    for (const b of document.querySelectorAll('#theme button')) b.setAttribute('aria-pressed', String(b.dataset.t === t))
    const meta = $('theme-color')
    if (meta) meta.content = t === 'system' ? '' : getComputedStyle(document.documentElement).getPropertyValue(t === 'dark' ? '--bg' : '--accent').trim()
  }
  $('theme').addEventListener('click', e => {
    const t = e.target.closest('button')?.dataset.t
    if (t) setTheme(t)
  })
  paintTheme()

  // ---------- the sessions ----------
  const item = s => {
    const li = document.createElement('li')
    const a = document.createElement('a')
    a.className = `session${s.alive ? '' : ' ended'}`
    a.href = `/s/${encodeURIComponent(s.name)}/`
    const name = document.createElement('span')
    name.className = 'name'
    name.textContent = s.name
    const where = document.createElement('span')
    where.className = 'where'
    where.textContent = s.cwd
    const state = document.createElement('span')
    state.className = 'state'
    const dot = document.createElement('span')
    dot.className = `dot${s.alive ? ' live' : ''}`
    dot.setAttribute('aria-hidden', 'true')
    state.append(dot, document.createTextNode(`${s.alive ? 'Running' : 'Ended'} · ${s.tmux ? 'you can type into it' : 'read-only'}`))
    a.append(name, where, state)
    li.append(a)
    return li
  }
  function paint(list) {
    if (!list.length) {
      const box = document.createElement('div')
      box.className = 'empty-sessions'
      const p = document.createElement('p')
      p.textContent = 'No named session yet. Start one in a terminal, then it shows here:'
      const c = document.createElement('code')
      c.textContent = 'node tools/console app --code <name>'
      box.append(p, c)
      return main.replaceChildren(box)
    }
    const ul = document.createElement('ul')
    ul.className = 'sessions'
    ul.append(...list.map(item))
    main.replaceChildren(ul)
  }
  async function load() {
    let r
    try {
      r = await fetch('/sessions.json', { headers: token ? { 'x-mcapp-token': token } : {} })
    } catch {
      return say("Couldn't reach the Mac. Check that it is awake and connected.", 'off')
    }
    if (r.status === 401) {
      main.textContent = 'This page needs the link the console printed. Open it on this device once.'
      return say('Needs the link', 'off')
    }
    const list = (await r.json().catch(() => ({ sessions: [] }))).sessions ?? []
    say(`${list.filter(s => s.alive).length} running`, 'live')
    paint(list)
  }
  load()
  setInterval(load, 3000)
})()
