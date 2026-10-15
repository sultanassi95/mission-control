// Mission Control App (MC-100): Flight, Consoles, Poll and Loops on the live fleet state.
// The token arrives once as ?t= and lives in localStorage, scoped to this exact origin (port included).
;(() => {
  const params = new URLSearchParams(location.search)
  if (params.has('t')) {
    try { localStorage.setItem('mcapp-token', params.get('t')) } catch {}
    history.replaceState(null, '', location.pathname)
  }
  let token = ''
  try { token = localStorage.getItem('mcapp-token') ?? '' } catch {}

  const $ = id => document.getElementById(id)
  const str = v => (v === undefined || v === null ? '' : String(v))
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
  const ICONS = {
    flight: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z"/></svg>',
    consoles: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>',
    poll: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9"/></svg>',
    loops: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 0 1 14-5.3L20 9"/><path d="M20 4v5h-5"/><path d="M20 12a8 8 0 0 1-14 5.3L4 15"/><path d="M4 20v-5h5"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  }
  // Built-in commands that open a terminal menu: listed, but marked as needing the Mac.
  const AT_MAC = new Set(['config', 'mcp', 'plugin', 'plugins', 'permissions', 'login', 'logout', 'model', 'agents', 'hooks', 'ide', 'terminal-setup', 'theme', 'vim', 'keybindings', 'resume', 'rewind', 'export', 'doctor', 'status', 'statusline', 'memory', 'add-dir', 'install-github-app', 'bug', 'feedback', 'release-notes', 'upgrade', 'privacy-settings', 'output-style'])
  const MODELS = ['haiku', 'sonnet', 'opus', 'fable']
  const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']
  const TABS = [['flight', 'Flight'], ['consoles', 'Consoles'], ['poll', 'Poll'], ['loops', 'Loops']]

  const S = { tab: 'flight', state: null, live: false, sheet: null, sel: null, filter: 'ALL', query: '', open: new Set(), queued: [], tune: null, notes: {}, details: new Set(), sending: false, opener: null }
  let queueSeq = 0
  try { S.tab = sessionStorage.getItem('mcapp-tab') || 'flight' } catch {}

  const fleet = () => S.state?.fleet ?? {}
  const consoles = () => fleet().consoles ?? []
  const pollItems = () => fleet().poll ?? []
  const openGates = () => pollItems().filter(p => p.state === 'open')

  function statusOf(c) {
    if (c.status === 'stood-down') return ['idle', 'Stood down']
    if (openGates().some(p => p.from === c.callSign)) return ['waiting', 'Waiting on you']
    if (c.status === 'staffing') return ['running', 'Starting']
    if (c.live === 'failed' || c.live === 'killed') return ['failed', 'Stopped']
    if (c.live === 'running' || c.live === 'pending') return ['running', 'Running']
    return ['idle', 'Idle']
  }
  const pill = ([cls, label]) => `<span class="pill st-${cls}">${esc(label)}</span>`
  const time = iso => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '')

  function lastReport(sign) {
    const rows = (fleet().loops ?? []).filter(l => l.from === sign && l.kind === 'status')
    const text = str(rows[rows.length - 1]?.text)
    const pick = re => [...text.split('\n')].reverse().map(l => re.exec(l.replace(/^[-*]\s+/, ''))).find(Boolean)?.[1]?.trim()
    return { state: pick(/^state\s*:\s*(.*)$/i), shipped: pick(/^shipped\s*:\s*(.*)$/i), blocked: pick(/^blocked on you\s*:\s*(.*)$/i), next: pick(/^next\s*:\s*(.*)$/i) }
  }

  // ---------- views ----------
  function viewFlight() {
    const f = fleet().flight ?? { messages: [] }
    const parts = []
    if (!S.state) parts.push('<p class="sys">Waiting for the first state from Flight…</p>')
    else if (!f.messages?.length) parts.push('<p class="empty">No messages yet. Ask Flight anything, or tap / for a command.</p>')
    for (const m of f.messages ?? []) parts.push(`<div class="msg ${m.role === 'user' ? 'user' : 'assistant'}"><div class="who">${m.role === 'user' ? 'You' : 'FLIGHT'}</div>${esc(str(m.text))}</div>`)
    for (const q of S.queued) parts.push(`<div class="msg user"><div class="who">You · ${q.sent ? 'waiting for Flight' : 'sending'}</div>${esc(q.text)}</div>`)
    if (f.asking) parts.push(`<div class="notice" role="status">Flight is waiting for your answer on the Mac: ${esc(f.asking)}</div>`)
    if (f.busy) parts.push('<div class="typing" aria-label="Flight is working"><i></i><i></i><i></i></div>')
    return parts.join('')
  }

  function viewConsoles() {
    if (!S.state) return '<div class="summary loading" aria-label="Checking the fleet"><div><b>–</b><span>running</span></div><div><b>–</b><span>waiting</span></div><div><b>–</b><span>idle</span></div><div><b>–</b><span>stopped</span></div></div><p class="sys">Checking the fleet…</p>'
    const list = consoles()
    const n = k => list.filter(c => statusOf(c)[0] === k).length
    let h = `<div class="summary"><div><b>${n('running')}</b><span>running</span></div><div><b>${n('waiting')}</b><span>waiting</span></div><div><b>${n('idle')}</b><span>idle</span></div><div><b>${n('failed')}</b><span>stopped</span></div></div>`
    if (!list.length) h += '<p class="empty">No consoles staffed. Ask Flight to staff one, or type <code>/console staff &lt;front&gt;</code>.</p>'
    // What needs the founder first: waiting, then stopped, running, idle; stood-down last.
    const rank = c => (c.status === 'stood-down' ? 5 : { waiting: 0, failed: 1, running: 2, idle: 3 }[statusOf(c)[0]] ?? 4)
    const ordered = [...list].reverse().sort((a, b) => rank(a) - rank(b))
    for (const c of ordered) {
      const st = statusOf(c)
      const r = lastReport(c.callSign)
      h += `<button class="card stripe-${st[0]}" type="button" data-a="open" data-v="${esc(c.callSign)}">
        <span class="head"><span class="call">${esc(c.callSign)}</span>${pill(st)}</span>
        <span class="task">${esc(r.state ?? 'No status check yet.')}</span>
        <span class="meta"><span class="tag">${esc(c.applied ?? c.model)}</span><span>${esc(c.project ? `${c.front}/${c.project}` : c.front)}</span><span>budget ${esc(c.budget ?? '-')}</span></span>
      </button>`
    }
    return h
  }

  function viewPoll() {
    if (!S.state) return '<p class="sys">Checking what is waiting on you…</p>'
    const items = pollItems()
    const open = items.filter(p => p.state === 'open')
    let h = ''
    for (const p of items.filter(x => x.undelivered).slice(-3).reverse()) {
      h += `<article class="gate undelivered"><div class="kind"><span class="call">${esc(p.from)}</span><span>· ${esc(p.id)}</span></div><h3>Your ${p.state === 'go' ? 'GO' : 'NO-GO'} did not reach ${esc(p.from)}</h3><p class="hint">${esc(p.undelivered)}. Staff the console again from Flight, then call it with the decision.</p></article>`
    }
    if (!open.length) h += '<p class="empty">Nothing is waiting on you. New go/no-go calls appear here.</p>'
    open.forEach((p, i) => {
      h += `<article class="gate">
        <div class="kind"><span class="call">${esc(p.from)}</span><span>· ${esc(p.kind)} · ${esc(p.id)} · ${esc(time(p.at))}</span></div>
        <h3>${esc(p.title)}</h3>
        ${p.targets?.length ? `<p class="hint">Tells: ${esc(p.targets.join(', '))}</p>` : ''}
        <details data-id="${esc(p.id)}"${S.details.has(p.id) ? ' open' : ''}><summary>The report it came from</summary><pre>${esc(p.detail)}</pre></details>
        <label class="visually-hidden" for="note-${esc(p.id)}">Note for ${esc(p.id)}</label>
        <input class="note" id="note-${esc(p.id)}" data-id="${esc(p.id)}" placeholder="Note (optional), e.g. which option" value="${esc(S.notes[p.id] ?? '')}">
        <div class="gobar"><button class="go${i ? ' secondary' : ''}" type="button" data-a="go" data-v="${esc(p.id)}">GO</button><button class="nogo" type="button" data-a="nogo" data-v="${esc(p.id)}">NO-GO</button></div>
        <button class="ghost" type="button" data-a="ask" data-v="${esc(p.id)}">Ask Flight first</button>
      </article>`
    })
    const decided = items.filter(p => (p.state === 'go' || p.state === 'no-go') && !p.undelivered).slice(-6).reverse()
    const replaced = items.filter(p => p.state === 'superseded').slice(-3).reverse()
    if (decided.length) h += '<p class="section-label">Decided</p>' + decided.map(p => `<p class="resolved">${pill(p.state === 'go' ? ['done', 'Go'] : ['failed', 'No-go'])}<span>${esc(p.id)} · ${esc(p.from)}</span></p>`).join('')
    if (replaced.length) h += '<p class="section-label">Replaced by a newer report</p>' + replaced.map(p => `<p class="resolved">${pill(['idle', 'Replaced'])}<span>${esc(p.id)} · ${esc(str(p.title).slice(0, 90))}</span></p>`).join('')
    return h
  }

  function viewLoops() {
    const rows = fleet().loops ?? []
    const signs = ['ALL', 'FLIGHT', 'FOUNDER', ...new Set(consoles().map(c => c.callSign))]
    const list = rows.filter(l => S.filter === 'ALL' || l.from === S.filter || l.to === S.filter).slice().reverse()
    let h = `<div class="filters" role="group" aria-label="Filter by call sign">${signs.map(s => `<button type="button" data-a="filter" data-v="${esc(s)}" aria-pressed="${S.filter === s}">${esc(s)}</button>`).join('')}</div>`
    if (!list.length) h += '<p class="empty">No loop traffic yet.</p>'
    list.forEach(l => {
      const key = `${l.at}|${l.from}|${l.to}|${l.kind}`
      const full = S.open.has(key)
      const text = full ? str(l.text) : str(l.text).split('\n')[0]
      h += `<button type="button" class="loop ${l.kind === 'advisory' ? 'adv' : ''}" data-a="expand" data-v="${esc(key)}" aria-expanded="${full}"><span class="route">${esc(l.from)} → ${esc(l.to)}<span class="kindtag">${esc(l.kind)}</span></span><time>${esc(time(l.at))}</time><span class="body">${esc(text)}</span></button>`
    })
    return h
  }

  // ---------- sheets ----------
  function sheet() {
    if (!S.sheet) return ''
    let head = ''
    let body = ''
    if (S.sheet === 'slash') {
      head = 'Commands'
      const q = S.query.toLowerCase()
      const cmds = (fleet().commands ?? []).filter(c => !q || c.name.toLowerCase().includes(q) || (c.description ?? '').toLowerCase().includes(q))
      const groups = { plugin: 'Skills and plugins', user: 'Your commands', mcp: 'MCP', builtin: 'Built-in' }
      body = `<label class="visually-hidden" for="q">Search commands</label><input class="search" id="q" placeholder="Search ${(fleet().commands ?? []).length} commands" value="${esc(S.query)}" autocomplete="off">`
      for (const [src, label] of Object.entries(groups)) {
        const hits = cmds.filter(c => c.source === src).slice(0, 60)
        if (!hits.length) continue
        body += `<p class="section-label">${label}</p><div>${hits.map(c => `<button class="cmd" type="button" data-a="pick" data-v="${esc(c.name)}"><code>/${esc(c.name)}</code><span>${esc(c.description)}</span>${src === 'builtin' && AT_MAC.has(c.name) ? '<span class="tag">at the Mac</span>' : ''}</button>`).join('')}</div>`
      }
      if (!cmds.length) body += '<p class="empty">No command matches.</p>'
    } else if (S.sheet === 'console') {
      const c = consoles().find(x => x.callSign === S.sel)
      if (!c) return ''
      const r = lastReport(c.callSign)
      head = `<span class="call">${esc(c.callSign)}</span> ${pill(statusOf(c))}`
      body = `<dl class="report"><dt>State</dt><dd>${esc(r.state ?? '—')}</dd><dt>Shipped</dt><dd>${esc(r.shipped ?? '—')}</dd><dt>Blocked</dt><dd>${esc(r.blocked ?? '—')}</dd><dt>Next</dt><dd>${esc(r.next ?? '—')}</dd></dl>
        <p class="hint">${esc(c.front)}${c.project ? `/${esc(c.project)}` : ''} · ${esc(c.applied ?? c.model)} · budget ${esc(c.budget)} · ${esc(c.cwd)}</p>
        ${c.status === 'stood-down' ? '<p class="hint">This console is stood down. Staff it again from Flight.</p>' : `<div class="btnrow"><button class="ghost" type="button" data-a="callc">Call</button><button class="ghost" type="button" data-a="retune">Retune</button><button class="danger" type="button" data-a="standdown">Stand down</button></div>`}`
    } else if (S.sheet === 'retune') {
      const c = consoles().find(x => x.callSign === S.sel)
      if (!c) return ''
      const t = (S.tune ??= { model: 'sonnet', effort: 'medium' })
      head = `Retune <span class="call">${esc(c.callSign)}</span>`
      body = `<p class="section-label">Model</p><div class="seg" role="group" aria-label="Model">${MODELS.map(m => `<button type="button" data-a="tm" data-v="${m}" aria-pressed="${t.model === m}">${m}</button>`).join('')}</div>
        <p class="section-label">Effort</p><div class="seg" role="group" aria-label="Effort">${EFFORTS.map(e => `<button type="button" data-a="te" data-v="${e}" aria-pressed="${t.effort === e}">${e}</button>`).join('')}</div>
        <p class="hint">Applies from the console's next model request. Its work keeps its context.</p>
        <button class="primary" type="button" data-a="applytune">Retune to ${esc(t.model)} · ${esc(t.effort)}</button>`
    } else if (S.sheet === 'standdown') {
      head = `Stand down <span class="call">${esc(S.sel)}</span>?`
      body = `<p>The console writes a dated handoff to its front's progress.md, then ends. <b>Dismiss</b> ends it with nothing written.</p>
        <div class="btnrow"><button class="ghost" type="button" data-a="back">Keep</button><button class="ghost" type="button" data-a="dismiss">Dismiss</button><button class="danger" type="button" data-a="sdyes">Stand down</button></div>`
    } else if (S.sheet === 'menu') {
      const live = consoles().filter(c => c.status !== 'stood-down')
      head = 'Fleet'
      body = `<dl class="report"><dt>Link</dt><dd>${S.live ? 'Live' : 'Reconnecting'} · ${esc(location.host)}</dd><dt>Consoles</dt><dd>${live.length} staffed</dd><dt>Updated</dt><dd>${esc(time(S.state?.at))}</dd></dl>
        <button class="danger" type="button" data-a="stopask"${live.length ? '' : ' disabled'}>Dismiss every console</button>
        <button class="ghost" type="button" data-a="appstopask">Stop the app server</button>
        <p class="hint">Flight keeps running in the terminal either way.</p>`
    } else if (S.sheet === 'stop') {
      head = 'Dismiss every console?'
      body = `<p>Every staffed console ends now, with nothing written. Uncommitted work stays in each repo.</p><div class="btnrow two"><button class="ghost" type="button" data-a="close">Keep them</button><button class="danger" type="button" data-a="stopyes">Dismiss all</button></div>`
    } else if (S.sheet === 'appstop') {
      head = 'Stop the app server?'
      body = `<p>This page stops working until <code>/console app</code> runs again at the terminal, with a new link.</p><div class="btnrow two"><button class="ghost" type="button" data-a="close">Keep it</button><button class="danger" type="button" data-a="appstopyes">Stop it</button></div>`
    }
    return `<div class="scrim" data-a="close"></div><div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(String(head).replace(/<[^>]+>/g, ''))}"><div class="sheet-head"><h2>${head}</h2><button class="iconbtn" type="button" data-a="close" aria-label="Close">${ICONS.close}</button></div><div class="sheet-body">${body}</div></div>`
  }

  // ---------- render ----------
  // Each region is replaced only when its HTML changed, so a state push every two seconds
  // does not steal focus, collapse a report, wipe a note or replay a sheet's animation.
  const last = { main: '', tabs: '', sheet: '', quick: '' }
  function paint(el, key, html) {
    if (last[key] === html) return false
    const active = document.activeElement
    const mark = active && el.contains(active) ? { a: active.dataset?.a, v: active.dataset?.v, id: active.id, start: active.selectionStart, end: active.selectionEnd } : null
    el.innerHTML = html
    last[key] = html
    if (mark) {
      const again = (mark.id && document.getElementById(mark.id)) || (mark.a && el.querySelector(`[data-a="${CSS.escape(mark.a)}"]${mark.v ? `[data-v="${CSS.escape(mark.v)}"]` : ''}`))
      if (again) {
        again.focus()
        if (typeof mark.start === 'number' && again.setSelectionRange) again.setSelectionRange(mark.start, mark.end)
      }
    }
    return true
  }

  function render() {
    try {
      const views = { flight: viewFlight, consoles: viewConsoles, poll: viewPoll, loops: viewLoops }
      const main = $('main')
      const atBottom = main.scrollHeight - main.scrollTop - main.clientHeight < 40
      $('title').textContent = TABS.find(t => t[0] === S.tab)?.[1] ?? 'Flight'
      const changed = paint(main, 'main', views[S.tab]())
      const busy = fleet().flight?.busy
      $('link-text').textContent = !token ? 'Not connected: reopen the link from your Mac.' : S.live ? (busy ? 'Live · Flight is working' : 'Live · connected to Flight') : 'Reconnecting…'
      document.querySelector('.dot').className = `dot ${S.live ? (busy ? 'busy' : 'live') : ''}`
      $('composer').hidden = S.tab !== 'flight'
      paint($('quick'), 'quick', ['/console list', '/briefing', '/standup', '/debrief'].map(q => `<button type="button" data-a="quick" data-v="${esc(q)}">${esc(q)}</button>`).join(''))
      const n = openGates().length
      paint($('tabs'), 'tabs', TABS.map(([k, l]) => `<button class="tab" type="button" role="tab" data-a="tab" data-v="${k}" aria-selected="${S.tab === k}">${ICONS[k]}${l}${k === 'poll' && n ? `<span class="badge" aria-label="${n} waiting">${n}</span>` : ''}</button>`).join(''))
      const wasOpen = last.sheet !== ''
      const repainted = paint($('sheet-root'), 'sheet', sheet())
      if (repainted && last.sheet !== '' && !wasOpen) {
        // Focus moves into a sheet when it opens, and back to its opener when it closes.
        const first = document.querySelector('.sheet input, .sheet .sheet-body button, .sheet [data-a="close"]')
        first?.focus()
      } else if (repainted && last.sheet === '' && wasOpen) {
        S.opener?.focus?.()
        S.opener = null
      }
      if (S.tab === 'flight' && changed && atBottom) main.scrollTop = main.scrollHeight
    } catch (err) {
      toast('Something on this page failed to draw. Reload it; the fleet keeps running.', 'error')
      console.error(err)
    }
  }

  let toastTimer
  function toast(msg, kind = 'info') {
    const t = $('toast')
    t.textContent = msg
    t.className = `toast${kind === 'error' ? ' error' : ''}`
    t.hidden = false
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => { t.hidden = true }, kind === 'error' ? 8000 : 2600)
  }

  async function send(op, text) {
    if (!token) {
      toast("Couldn't send: this page isn't connected. Reopen the link from your Mac.", 'error')
      return false
    }
    try {
      const r = await fetch('/op', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-mcapp-token': token }, body: JSON.stringify({ op, text }) })
      if (!r.ok) {
        toast(r.status === 401 ? "Couldn't send: this link has expired. Open the new link from your Mac." : "Couldn't send that. Try again in a moment.", 'error')
        return false
      }
      return true
    } catch {
      toast("Couldn't reach Flight. Check that the Mac is awake and connected.", 'error')
      return false
    }
  }

  // ---------- events ----------
  document.addEventListener('click', async e => {
    const b = e.target.closest('[data-a]')
    if (!b) return
    const a = b.dataset.a
    const v = b.dataset.v
    if (['open', 'stopask', 'appstopask'].includes(a) && !S.sheet) S.opener = b
    switch (a) {
      case 'tab': S.tab = v; S.sheet = null; try { sessionStorage.setItem('mcapp-tab', v) } catch {} break
      case 'close': S.sheet = null; S.tune = null; break
      case 'back': S.sheet = 'console'; break
      case 'quick': $('draft').value = `${v} `; $('draft').focus(); return
      case 'pick': S.sheet = null; render(); $('draft').value = `/${v} `; $('draft').focus(); return
      case 'open': S.sel = v; S.sheet = 'console'; break
      case 'callc': S.tab = 'flight'; S.sheet = null; render(); $('draft').value = `/console call ${S.sel} `; $('draft').focus(); return
      case 'retune': S.tune = null; S.sheet = 'retune'; break
      case 'tm': S.tune.model = v; break
      case 'te': S.tune.effort = v; break
      case 'applytune': if (await send('console', `retune ${S.sel} ${S.tune.model} ${S.tune.effort}`)) toast(`Retune sent: ${S.sel} → ${S.tune.model} · ${S.tune.effort}`); S.sheet = 'console'; break
      case 'standdown': S.sheet = 'standdown'; break
      case 'sdyes': if (await send('console', `stand-down ${S.sel}`)) toast(`${S.sel} is writing its handoff.`); S.sheet = null; break
      case 'dismiss': if (await send('console', `dismiss ${S.sel}`)) toast(`${S.sel} dismissed.`); S.sheet = null; break
      case 'go': case 'nogo': {
        const note = (S.notes[v] ?? '').trim()
        if (await send('console', `${a} ${v}${note ? ` ${note}` : ''}`)) {
          delete S.notes[v]
          toast(`${a === 'go' ? 'GO' : 'NO-GO'} sent for ${v}.`)
        }
        break
      }
      case 'ask': S.tab = 'flight'; render(); $('draft').value = `About ${v}: `; $('draft').focus(); return
      case 'filter': S.filter = v; break
      case 'expand': S.open.has(v) ? S.open.delete(v) : S.open.add(v); break
      case 'stopask': S.sheet = 'stop'; break
      case 'stopyes': for (const c of consoles().filter(x => x.status !== 'stood-down')) await send('console', `dismiss ${c.callSign}`); toast('Every console is dismissed.'); S.sheet = null; break
      case 'appstopask': S.sheet = 'appstop'; break
      case 'appstopyes': await send('console', 'app stop'); S.sheet = null; break
      default: return
    }
    render()
  })
  document.addEventListener('input', e => {
    if (e.target.classList?.contains('note')) S.notes[e.target.dataset.id] = e.target.value
    if (e.target.id === 'q' && !e.isComposing) {
      S.query = e.target.value
      render()
    }
  })
  document.addEventListener('toggle', e => {
    if (e.target.tagName === 'DETAILS' && e.target.dataset.id) e.target.open ? S.details.add(e.target.dataset.id) : S.details.delete(e.target.dataset.id)
  }, true)
  $('menu').addEventListener('click', () => { S.opener = $('menu'); S.sheet = 'menu'; render() })
  $('slash').addEventListener('click', () => { S.opener = $('slash'); S.sheet = 'slash'; S.query = ''; render() })
  $('send').addEventListener('submit', async e => {
    e.preventDefault()
    if (S.sending) return
    const box = $('draft')
    const text = box.value.trim()
    if (!text) return
    const op = text.startsWith('/console ') ? ['console', text.slice(9)] : text.startsWith('/') ? ['command', text.slice(1)] : ['prompt', text]
    const item = { id: ++queueSeq, text, sent: false }
    S.queued.push(item)
    S.sending = true
    box.value = ''
    render()
    const ok = await send(op[0], op[1])
    S.sending = false
    if (ok) {
      item.sent = true
      if (fleet().flight?.busy) toast('Queued: Flight runs it when the current turn ends.')
    } else {
      S.queued = S.queued.filter(q => q.id !== item.id)
      if (!box.value) box.value = text
    }
    render()
  })
  $('draft').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && matchMedia('(pointer: fine)').matches) {
      e.preventDefault()
      $('send').requestSubmit()
    }
  })
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && S.sheet) { S.sheet = null; render() }
  })

  // ---------- live state ----------
  function connect() {
    if (!token) return render()
    const es = new EventSource(`/events?t=${encodeURIComponent(token)}`)
    es.onopen = () => { S.live = true; render() }
    es.onerror = () => { S.live = false; render() }
    es.onmessage = m => {
      try { S.state = JSON.parse(m.data) } catch { return }
      const said = new Set((fleet().flight?.messages ?? []).filter(x => x.role === 'user').map(x => str(x.text).trim()))
      S.queued = S.queued.filter(q => !(q.sent && said.has(q.text)))
      render()
    }
  }
  render()
  connect()
})()
