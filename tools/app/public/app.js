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
  // Claude Code records a prompt the app submits between a plugin preamble and a trailing note; the founder typed only what follows it.
  const typed = v => stripReminders(v).replace(/^The [\w-]+ plugin sent a message:\n/, '').replace(/\n+This is how Claude Code surfaces a prompt a plugin submits[\s\S]*$/, '').trim()
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
  const models = () => fleet().models ?? ['haiku', 'sonnet', 'opus', 'fable']
  const efforts = () => fleet().efforts ?? ['low', 'medium', 'high', 'xhigh', 'max']
  let seenOp = 0
  const TABS = [['flight', 'Flight'], ['consoles', 'Consoles'], ['poll', 'Poll'], ['loops', 'Loops']]

  const S = { tab: 'flight', state: null, live: false, sheet: null, sel: null, filter: 'ALL', query: '', open: new Set(), queued: [], tune: null, notes: {}, details: new Set(), sending: false, opener: null, flights: [], profile: '' }
  try { S.profile = localStorage.getItem('mcapp-profile') ?? '' } catch {}
  // Every request goes to the chosen profile's Flight through the front door.
  const base = () => (S.profile ? `/p/${encodeURIComponent(S.profile)}` : '')
  const authHeaders = () => (token ? { 'x-mcapp-token': token } : {})
  const NAMES = { tascode: 'TasCode' }
  const label = p => NAMES[p] ?? str(p).charAt(0).toUpperCase() + str(p).slice(1)
  // Claude Code records its own notices (a background task finishing, a system reminder) as user
  // messages; they show as a quiet line, never as the founder's words. null: not a notice.
  const stripReminders = t => str(t).replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim()
  const harnessNotice = text => {
    const t = str(text).trim()
    if (/^<task-notification>/.test(t) || /^\[SYSTEM NOTIFICATION/.test(t)) {
      const summary = /<summary>([\s\S]*?)<\/summary>/.exec(t)?.[1]?.trim()
      return summary || "Background task update"
    }
    if (/^<system-reminder>/.test(t) && !stripReminders(t)) return ''
    return null
  }
  // A photo travels as a line naming its stored path; Flight opens the path with Read.
  const PHOTO_LINE = /\n*\[Photo from the app: (.+?\/uploads\/([a-f0-9]{24}\.(?:jpg|png|webp))) - open it with Read\]\s*$/
  // Photos are fetched with the token in a header and shown from a blob: URL, so the token never sits in the page.
  const photos = new Map()
  const photoSrc = id => {
    const key = `${S.profile}/${id}`
    if (!photos.has(key)) {
      photos.set(key, '')
      fetch(`${base()}/upload/${id}`, { headers: authHeaders() })
        .then(r => (r.ok ? r.blob() : null))
        .then(b => {
          if (b) {
            photos.set(key, URL.createObjectURL(b))
            render()
          }
        })
        .catch(() => undefined)
    }
    return photos.get(key)
  }
  const userBubble = (text, img, who = 'You') => {
    const m = PHOTO_LINE.exec(text)
    const body = m ? text.slice(0, m.index) : text
    const src = img ?? (m ? photoSrc(m[2]) : '')
    const pic = src ? `<img class="photo" src="${esc(src)}" alt="Photo you sent">` : m ? '<p class="hint">Photo loading…</p>' : ''
    return `<div class="msg user"><div class="who">${esc(who)}</div>${pic}${body ? esc(body) : ''}</div>`
  }
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
    if (c.live === 'running' || c.live === 'pending' || c.live === 'waiting') return ['running', 'Running']
    return ['idle', 'Idle']
  }
  const pill = ([cls, label]) => `<span class="pill st-${cls}">${esc(label)}</span>`
  const time = iso => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '')

  const reportOf = sign => consoles().find(c => c.callSign === sign)?.report ?? {}


  // ---------- views ----------
  function viewFlight() {
    const f = fleet().flight ?? { messages: [] }
    const parts = []
    if (!S.state) parts.push('<p class="sys">Waiting for the first state from Flight…</p>')
    else if (!f.messages?.length) parts.push('<p class="empty">No messages yet. Ask Flight anything, or tap / for a command.</p>')
    // Flight's replies are markdown, rendered by md.js (which escapes first); the founder's own messages stay plain text.
    for (const m of f.messages ?? []) {
      const notice = m.role === 'user' ? harnessNotice(m.text) : null
      if (notice !== null) {
        if (notice) parts.push(`<p class="sys">${esc(notice)}</p>`)
        continue
      }
      parts.push(m.role === 'user'
        ? userBubble(typed(m.text))
        : `<div class="msg assistant md"><div class="who">FLIGHT</div>${window.mcMarkdown ? window.mcMarkdown(str(m.text)) : esc(str(m.text))}</div>`)
    }
    for (const q of S.queued) parts.push(userBubble(q.text, q.preview, `You · ${q.sent ? 'waiting for Flight' : 'sending'}`))
    if (f.ask) parts.push(askCard(f.ask))
    else if (f.asking) parts.push(`<div class="notice" role="status">Flight is waiting for your answer on the Mac: ${esc(f.asking)}</div>`)
    // What Flight is doing right now, so a long turn never looks like nothing is happening.
    if (f.busy) parts.push(`<div class="typing" role="status"><span class="dots" aria-hidden="true"><i></i><i></i><i></i></span><span class="doing">${esc(f.activity || 'Thinking')}…</span></div>`)
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
      const r = reportOf(c.callSign)
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
    const down = new Set(consoles().filter(c => c.status === 'stood-down').map(c => c.callSign))
    open.forEach((p, i) => {
      const orphan = down.has(p.from)
      h += `<article class="gate">
        <div class="kind"><span class="call">${esc(p.from)}</span><span>· ${esc(p.kind)} · ${esc(p.id)} · ${esc(time(p.at))}</span></div>
        <h3>${esc(p.title)}</h3>
        ${orphan ? `<p class="hint">${esc(p.from)} is stood down: your answer is kept for the next Controller on this front.</p>` : ''}
        ${p.targets?.length ? `<p class="hint">Tells: ${esc(p.targets.join(', '))}</p>` : ''}
        <details data-id="${esc(p.id)}"${S.details.has(p.id) ? ' open' : ''}><summary>The report it came from</summary><pre>${esc(p.detail)}</pre></details>
        <label class="visually-hidden" for="note-${esc(p.id)}">Note for ${esc(p.id)}</label>
        <input class="note" autocomplete="off" autocorrect="off" spellcheck="false" autocapitalize="sentences" id="note-${esc(p.id)}" data-id="${esc(p.id)}" placeholder="Note (optional), e.g. which option" value="${esc(S.notes[p.id] ?? '')}">
        <div class="gobar"><button class="go${i ? ' secondary' : ''}" type="button" data-a="go" data-v="${esc(p.id)}">GO</button><button class="nogo" type="button" data-a="nogo" data-v="${esc(p.id)}">NO-GO</button></div>
        <div class="btnrow"><button class="ghost" type="button" data-a="ask" data-v="${esc(p.id)}">Ask Flight first</button>${orphan ? `<button class="ghost" type="button" data-a="gatedismiss" data-v="${esc(p.id)}">Dismiss</button>` : ''}</div>
      </article>`
    })
    const decided = items.filter(p => (p.state === 'go' || p.state === 'no-go' || p.state === 'dismissed') && !p.undelivered).slice(-6).reverse()
    const replaced = items.filter(p => p.state === 'superseded').slice(-3).reverse()
    if (decided.length) h += '<p class="section-label">Decided</p>' + decided.map(p => `<p class="resolved">${pill(p.state === 'go' ? ['done', 'Go'] : p.state === 'dismissed' ? ['idle', 'Dismissed'] : ['failed', 'No-go'])}<span>${esc(p.id)} · ${esc(p.from)}</span></p>`).join('')
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
      body = `<label class="visually-hidden" for="q">Search commands</label><input class="search" id="q" autocorrect="off" spellcheck="false" autocapitalize="off" placeholder="Search ${(fleet().commands ?? []).length} commands" value="${esc(S.query)}" autocomplete="off">`
      for (const [src, label] of Object.entries(groups)) {
        const hits = cmds.filter(c => c.source === src).slice(0, 60)
        if (!hits.length) continue
        body += `<p class="section-label">${label}</p><div>${hits.map(c => `<button class="cmd" type="button" data-a="pick" data-v="${esc(c.name)}"><code>/${esc(c.name)}</code><span>${esc(c.description)}</span>${src === 'builtin' && AT_MAC.has(c.name) ? '<span class="tag">at the Mac</span>' : ''}</button>`).join('')}</div>`
      }
      if (!cmds.length) body += '<p class="empty">No command matches.</p>'
    } else if (S.sheet === 'console') {
      const c = consoles().find(x => x.callSign === S.sel)
      if (!c) return ''
      const r = reportOf(c.callSign)
      head = `<span class="call">${esc(c.callSign)}</span> ${pill(statusOf(c))}`
      body = `<dl class="report"><dt>State</dt><dd>${esc(r.state ?? '—')}</dd><dt>Shipped</dt><dd>${esc(r.shipped ?? '—')}</dd><dt>Blocked</dt><dd>${esc(r.blocked ?? '—')}</dd><dt>Next</dt><dd>${esc(r.next ?? '—')}</dd></dl>
        <p class="hint">${esc(c.front)}${c.project ? `/${esc(c.project)}` : ''} · ${esc(c.applied ?? c.model)} · budget ${esc(c.budget)} · ${esc(c.cwd)}</p>
        ${c.status === 'stood-down' ? '<p class="hint">This console is stood down. Staff it again from Flight.</p>' : `<div class="btnrow"><button class="ghost" type="button" data-a="callc">Call</button><button class="ghost" type="button" data-a="retune">Retune</button><button class="danger" type="button" data-a="standdown">Stand down</button></div>`}`
    } else if (S.sheet === 'retune') {
      const c = consoles().find(x => x.callSign === S.sel)
      if (!c) return ''
      const t = (S.tune ??= { model: 'sonnet', effort: 'medium' })
      head = `Retune <span class="call">${esc(c.callSign)}</span>`
      body = `<p class="section-label">Model</p><div class="seg" role="group" aria-label="Model">${models().map(m => `<button type="button" data-a="tm" data-v="${m}" aria-pressed="${t.model === m}">${m}</button>`).join('')}</div>
        <p class="section-label">Effort</p><div class="seg" role="group" aria-label="Effort">${efforts().map(e => `<button type="button" data-a="te" data-v="${e}" aria-pressed="${t.effort === e}">${e}</button>`).join('')}</div>
        <p class="hint">Applies from the console's next model request. Its work keeps its context.</p>
        <button class="primary" type="button" data-a="applytune">Retune to ${esc(t.model)} · ${esc(t.effort)}</button>`
    } else if (S.sheet === 'standdown') {
      head = `Stand down <span class="call">${esc(S.sel)}</span>?`
      body = `<p>The console writes a dated handoff to its front's progress.md, then ends. <b>Dismiss</b> ends it with nothing written.</p>
        <div class="btnrow"><button class="ghost" type="button" data-a="back">Keep</button><button class="ghost" type="button" data-a="dismiss">Dismiss</button><button class="danger" type="button" data-a="sdyes">Stand down</button></div>`
    } else if (S.sheet === 'profiles') {
      head = 'Profiles'
      body = S.flights.length
        ? `<div class="profiles">${S.flights.map(f => `<button class="prof" type="button" data-a="profile" data-v="${esc(f.profile)}" aria-pressed="${f.profile === S.profile}"><span class="prof-name">${esc(label(f.profile))}</span>${f.unreachable ? pill(['failed', 'Not answering']) : f.gates ? pill(['waiting', `${f.gates} waiting`]) : f.busy ? pill(['running', 'Working']) : pill(['idle', 'Idle'])}</button>`).join('')}</div>
          <p class="hint">A profile appears here while its session runs /console app.</p>`
        : '<p class="empty">No Flight is running. Type /console app in a Claude session.</p>'
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
  // A field being typed in is never rebuilt under the cursor: replacing it closes the phone keyboard
  // and breaks the word it is composing. The region repaints once the field loses focus.
  const typingIn = el => {
    const a = document.activeElement
    return Boolean(a && el.contains(a) && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && !['button', 'checkbox', 'radio', 'file'].includes(a.type))))
  }
  function paint(el, key, html) {
    if (last[key] === html) return false
    if (typingIn(el)) return false
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

  // ---------- Flight's questions ----------
  // One draft per question id: picked option indexes, the Other text, or the typed value.
  const askDraft = id => {
    if (S.ask?.id !== id) S.ask = { id, q: {} }
    return S.ask
  }
  const askAnswer = (q, d) => {
    if (!d) return ''
    if (q.type === 'text' || q.type === 'number') return str(d.value).trim()
    const picks = [...(d.picks ?? [])].sort((a, b) => a - b).map(i => q.options?.[i]?.label ?? '').filter(Boolean)
    return [...picks, str(d.other).trim()].filter(Boolean).join(', ')
  }
  function askCard(ask) {
    const draft = askDraft(ask.id)
    const qs = ask.questions ?? []
    const body = qs.map((q, qi) => {
      const d = draft.q[qi] ?? {}
      let input = ''
      if (q.type === 'text') input = `<textarea class="note ask-in" rows="2" autocomplete="off" autocorrect="off" spellcheck="false" autocapitalize="sentences" data-q="${qi}" placeholder="${esc(q.placeholder ?? 'Your answer')}">${esc(d.value ?? '')}</textarea>`
      else if (q.type === 'number') input = `<input class="note ask-in" type="number" autocomplete="off" inputmode="decimal" data-q="${qi}" min="${esc(q.min ?? '')}" max="${esc(q.max ?? '')}" step="${esc(q.step ?? 'any')}" value="${esc(d.value ?? '')}" placeholder="${esc(q.min ?? '')}–${esc(q.max ?? '')}${q.unit ? ` ${esc(q.unit)}` : ''}">`
      else input = `<div class="ask-options" role="group" aria-label="${esc(q.question)}">${(q.options ?? []).map((o, oi) => `<button type="button" class="ask-opt" data-a="askpick" data-v="${qi}:${oi}" aria-pressed="${Boolean(d.picks?.has(oi))}"><b>${esc(o.label)}</b>${o.description ? `<span>${esc(o.description)}</span>` : ''}</button>`).join('')}</div>
        <input class="note ask-other" autocomplete="off" autocorrect="off" spellcheck="false" autocapitalize="sentences" data-q="${qi}" placeholder="Or type your own answer" value="${esc(d.other ?? '')}">`
      return `<div class="ask-q">${q.header ? `<p class="kind">${esc(q.header)}${q.multiSelect ? ' · pick any' : ''}</p>` : ''}<h3>${esc(q.question)}</h3>${input}</div>`
    }).join('')
    // A question may be left unanswered; one answer is enough to send.
    const ready = qs.some((q, qi) => askAnswer(q, draft.q[qi]))
    return `<section class="gate ask" aria-label="Flight is asking">${body}<button class="go" type="button" data-a="asksend" ${ready ? '' : 'disabled'}>Send answer</button></section>`
  }

  // Flight stays pinned to the newest message unless the founder scrolled up to read; opening the
  // app, returning to it, coming back to the Flight tab or switching profile pins it again.
  let stick = true
  function render() {
    try {
      const views = { flight: viewFlight, consoles: viewConsoles, poll: viewPoll, loops: viewLoops }
      const main = $('main')
      $('title').textContent = TABS.find(t => t[0] === S.tab)?.[1] ?? 'Flight'
      main.className = `main view-${S.tab}`
      paint(main, 'main', views[S.tab]())
      const busy = fleet().flight?.busy
      $('link-text').textContent = S.live ? (busy ? `Live · ${fleet().flight?.activity || 'Flight is working'}` : 'Live · connected to Flight') : S.state ? 'Reconnecting…' : 'Not connected: sign in to Tailscale, or open the link /console app printed'
      document.querySelector('.dot').className = `dot ${S.live ? (busy ? 'busy' : 'live') : ''}`
      const others = S.flights.filter(f => f.profile !== S.profile && (f.gates || f.busy))
      $('profile').hidden = S.flights.length < 2 && !S.profile
      $('profile-name').textContent = S.profile ? label(S.profile) : 'Profile'
      $('profile').setAttribute('aria-label', `Profile: ${S.profile ? label(S.profile) : 'none'}${others.length ? `, ${others.length} other ${others.length === 1 ? 'profile needs' : 'profiles need'} a look` : ''}. Switch profile`)
      $('profile-dot').className = `dot ${others.some(f => f.gates) ? 'busy' : 'live'}`
      $('profile-dot').hidden = !others.length
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
      if (S.tab === 'flight' && stick) main.scrollTop = main.scrollHeight
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
    try {
      const headers = { 'Content-Type': 'application/json', ...authHeaders() }
      const r = await fetch(`${base()}/op`, { method: 'POST', headers, body: JSON.stringify({ op, text }) })
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
      case 'profile': S.sheet = null; switchProfile(v); return
      case 'askpick': {
        const ask = fleet().flight?.ask
        if (!ask) return
        const [qi, oi] = v.split(':').map(Number)
        const q = ask.questions[qi]
        const d = (askDraft(ask.id).q[qi] ??= { picks: new Set(), other: '' })
        if (q.multiSelect) d.picks.has(oi) ? d.picks.delete(oi) : d.picks.add(oi)
        else d.picks = d.picks.has(oi) ? new Set() : new Set([oi])
        break
      }
      case 'asksend': {
        const ask = fleet().flight?.ask
        if (!ask || S.sending) return
        const answers = {}
        ask.questions.forEach((q, qi) => { const a = askAnswer(q, S.ask?.q[qi]); if (a) answers[q.question] = a })
        S.sending = true
        const ok = await send('answer', JSON.stringify({ id: ask.id, answers }))
        S.sending = false
        if (ok) toast('Answer sent to Flight.')
        break
      }
      case 'tab': if (v === 'flight') stick = true; S.tab = v; S.sheet = null; try { sessionStorage.setItem('mcapp-tab', v) } catch {} break
      case 'close': S.sheet = null; S.tune = null; break
      case 'back': S.sheet = 'console'; break
      case 'quick': $('draft').value = `${v} `; $('draft').focus(); return
      case 'pick': S.sheet = null; render(); $('draft').value = `/${v} `; $('draft').focus(); return
      case 'open': S.sel = v; S.sheet = 'console'; break
      case 'callc': S.tab = 'flight'; S.sheet = null; render(); $('draft').value = `/console call ${S.sel} `; $('draft').focus(); return
      case 'retune': S.tune = null; S.sheet = 'retune'; break
      case 'tm': S.tune.model = v; break
      case 'te': S.tune.effort = v; break
      case 'applytune': await send('console', `retune ${S.sel} ${S.tune.model} ${S.tune.effort}`); S.sheet = 'console'; break
      case 'standdown': S.sheet = 'standdown'; break
      case 'sdyes': await send('console', `stand-down ${S.sel}`); S.sheet = null; break
      case 'dismiss': await send('console', `dismiss ${S.sel}`); S.sheet = null; break
      case 'go': case 'nogo': {
        const note = (S.notes[v] ?? '').trim()
        if (await send('console', `${a} ${v}${note ? ` ${note}` : ''}`)) delete S.notes[v]
        break
      }
      case 'gatedismiss': await send('console', `dismiss-gate ${v}`); break
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
    const ask = fleet().flight?.ask
    if (ask && e.target.dataset?.q !== undefined && (e.target.classList.contains('ask-in') || e.target.classList.contains('ask-other'))) {
      const d = (askDraft(ask.id).q[e.target.dataset.q] ??= { picks: new Set(), other: '', value: '' })
      if (e.target.classList.contains('ask-other')) d.other = e.target.value
      else d.value = e.target.value
      const btn = document.querySelector('[data-a="asksend"]')
      if (btn) btn.disabled = !ask.questions.some((q, qi) => askAnswer(q, S.ask?.q[qi]))
      return
    }
    if (e.target.classList?.contains('note')) S.notes[e.target.dataset.id] = e.target.value
    if (e.target.id === 'q' && !e.isComposing) {
      S.query = e.target.value
      render()
    }
  })
  document.addEventListener('toggle', e => {
    if (e.target.tagName === 'DETAILS' && e.target.dataset.id) e.target.open ? S.details.add(e.target.dataset.id) : S.details.delete(e.target.dataset.id)
  }, true)
  $('profile').addEventListener('click', () => { S.opener = $('profile'); S.sheet = 'profiles'; render(); void loadFlights() })
  $('menu').addEventListener('click', () => { S.opener = $('menu'); S.sheet = 'menu'; render() })
  $('slash').addEventListener('click', () => { S.opener = $('slash'); S.sheet = 'slash'; S.query = ''; render() })
  $('send').addEventListener('submit', async e => {
    e.preventDefault()
    if (S.sending) return
    const box = $('draft')
    const typedText = box.value.trim()
    let text = typedText
    const photo = S.photo
    if (!text && !photo) return
    if (photo && text.startsWith('/')) return toast('Remove the photo to run a command.', 'error')
    if (photo) {
      // Locked while it uploads, so the photo and the draft sent are the ones on screen.
      S.sending = true
      lockPhoto(true)
      render()
      const stored = await upload(photo.blob)
      S.sending = false
      lockPhoto(false)
      if (!stored) return render()
      text = `${text || 'A photo for you.'}\n\n[Photo from the app: ${stored.path} - open it with Read]`
    }
    const op = !photo && text.startsWith('/console ') ? ['console', text.slice(9)] : !photo && text.startsWith('/') ? ['command', text.slice(1)] : ['prompt', text]
    const item = { id: ++queueSeq, text, sent: false, preview: photo?.url }
    S.queued.push(item)
    S.sending = true
    box.value = ''
    render()
    const ok = await send(op[0], op[1])
    S.sending = false
    if (ok) {
      // The photo leaves the composer only once Flight has the message; a failed send keeps it for a retry.
      if (photo && S.photo === photo) clearPhoto(false)
      item.sent = true
      if (fleet().flight?.busy) toast('Queued: Flight runs it when the current turn ends.')
    } else {
      S.queued = S.queued.filter(q => q.id !== item.id)
      if (!box.value) box.value = typedText
    }
    render()
  })
  $('draft').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && matchMedia('(pointer: fine)').matches) {
      e.preventDefault()
      $('send').requestSubmit()
    }
  })
  document.addEventListener('focusout', () => setTimeout(render, 0))
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && S.sheet) { S.sheet = null; render() }
  })

  // ---------- live state ----------
  // ---------- photos ----------
  // Scaled on the device to 1600 px on the long side as JPEG, so a 10 MB camera file goes up as a few hundred KB.
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
      // JPEG has no transparency: a transparent PNG would otherwise turn black.
      ctx.fillStyle = 'white'
      ctx.fillRect(0, 0, c.width, c.height)
      ctx.drawImage(img, 0, 0, c.width, c.height)
      return await new Promise(resolve => c.toBlob(resolve, 'image/jpeg', 0.85))
    } finally {
      URL.revokeObjectURL(url)
    }
  }
  async function upload(blob) {
    try {
      const r = await fetch(`${base()}/upload`, { method: 'POST', headers: { 'Content-Type': 'image/jpeg', ...authHeaders() }, body: blob })
      if (!r.ok) {
        toast(r.status === 413 ? 'That photo is too large to send.' : r.status === 415 ? "That file isn't a photo the app can send." : "Couldn't send the photo. Try again.", 'error')
        return null
      }
      return await r.json()
    } catch {
      toast("Couldn't reach Flight. Check that the Mac is awake and connected.", 'error')
      return null
    }
  }
  function lockPhoto(on) {
    for (const id of ['attach', 'preview-remove', 'draft']) $(id).disabled = on
  }
  function clearPhoto(revoke = true) {
    // A sent photo's blob URL stays alive for its queued bubble until the recorded message replaces it.
    if (revoke && S.photo) URL.revokeObjectURL(S.photo.url)
    S.photo = null
    $('preview').hidden = true
    $('preview-img').removeAttribute('src')
  }
  $('attach').addEventListener('click', () => $('photo').click())
  $('photo').addEventListener('change', async e => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const blob = await shrink(file).catch(() => null)
    if (!blob) return toast("Couldn't read that photo.", 'error')
    if (S.photo) URL.revokeObjectURL(S.photo.url)
    S.photo = { blob, url: URL.createObjectURL(blob) }
    $('preview-img').src = S.photo.url
    $('preview').hidden = false
    $('draft').focus()
  })
  $('preview-remove').addEventListener('click', clearPhoto)

  let es = null
  function connect() {
    if (es) es.close()
    // Over the tailnet the signed-in Tailscale identity is enough; a token is needed only on the Mac's own address.
    es = new EventSource(token ? `${base()}/events?t=${encodeURIComponent(token)}` : `${base()}/events`)
    es.onopen = () => { S.live = true; render() }
    // A non-200 (the profile's server restarting) closes an EventSource for good; open a new one.
    es.onerror = () => { S.live = false; render(); if (es.readyState === EventSource.CLOSED) setTimeout(() => es.readyState === EventSource.CLOSED && connect(), 3000) }
    es.onmessage = m => {
      const first = S.state === null
      try { S.state = JSON.parse(m.data) } catch { return }
      const op = fleet().lastOp
      // The first state only records where results stand; a result from before this page opened is not news.
      if (first && op) seenOp = Number(op.id) || 0
      else if (op && op.id && op.id > seenOp) {
        seenOp = op.id
        if (op.text && !/^Sent to Flight\.$/.test(op.text)) toast(str(op.text).split('\n').slice(0, 3).join(' · ').slice(0, 220))
      }
      const said = new Set((fleet().flight?.messages ?? []).filter(x => x.role === 'user').map(x => typed(x.text)))
      for (const q of S.queued) if (q.sent && said.has(q.text) && q.preview) URL.revokeObjectURL(q.preview)
      S.queued = S.queued.filter(q => !(q.sent && said.has(q.text)))
      render()
    }
  }
  // The live profiles, refreshed every few seconds; a remembered profile that is gone falls back to the front door's own.
  let misses = 0
  async function loadFlights() {
    try {
      const r = await fetch('/flights.json', { headers: authHeaders() })
      if (!r.ok) return
      S.flights = await r.json()
    } catch {
      return
    }
    let chosen = ''
    try { chosen = localStorage.getItem('mcapp-profile') ?? '' } catch {}
    if (chosen && chosen !== S.profile && S.flights.some(f => f.profile === chosen)) return switchProfile(chosen, false)
    // A profile missing from one listing is often only restarting; fall back after two misses in a row.
    misses = S.flights.some(f => f.profile === S.profile) ? 0 : misses + 1
    if (misses >= 2 || (!S.profile && S.flights.length)) {
      const fallback = S.flights.find(f => f.self)?.profile ?? S.flights[0]?.profile ?? ''
      if (fallback && fallback !== S.profile) {
        if (S.profile) toast(`${label(S.profile)} is not running; showing ${label(fallback)}.`)
        // The first profile resolved is remembered, so a later message cannot land in a different profile unseen.
        return switchProfile(fallback, !chosen)
      }
    }
    render()
  }
  function switchProfile(p, remember = true) {
    if (remember) try { localStorage.setItem('mcapp-profile', p) } catch {}
    if (p === S.profile) return render()
    S.profile = p
    stick = true
    S.state = null
    S.live = false
    S.queued = []
    S.sel = null
    S.tune = null
    S.notes = {}
    S.details = new Set()
    S.sheet = null
    seenOp = 0
    connect()
    render()
  }
  $('main').addEventListener('scroll', () => {
    const m = $('main')
    if (S.tab === 'flight') stick = m.scrollHeight - m.scrollTop - m.clientHeight < 40
  }, { passive: true })
  const repin = () => { if (document.visibilityState === 'visible') { stick = true; render() } }
  document.addEventListener('visibilitychange', repin)
  window.addEventListener('pageshow', repin)
  render()
  connect()
  void loadFlights()
  setInterval(loadFlights, 5000)
})()
