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
  // The founder's own words read back from Flight's transcript, and the files a message carried (transcript.js).
  const { typed, waiting, attachments, line, stripReminders, PHOTO_EXTS, DOC_EXTS } = window.mcTranscript
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
  const ICONS = {
    flight: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z"/></svg>',
    consoles: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>',
    loops: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 0 1 14-5.3L20 9"/><path d="M20 4v5h-5"/><path d="M20 12a8 8 0 0 1-14 5.3L4 15"/><path d="M4 20v-5h5"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  }
  // Built-in commands that open a terminal menu: listed, but marked as needing the Mac.
  const AT_MAC = new Set(['config', 'mcp', 'plugin', 'plugins', 'permissions', 'login', 'logout', 'model', 'agents', 'hooks', 'ide', 'terminal-setup', 'theme', 'vim', 'keybindings', 'resume', 'rewind', 'export', 'doctor', 'status', 'statusline', 'memory', 'add-dir', 'install-github-app', 'bug', 'feedback', 'release-notes', 'upgrade', 'privacy-settings', 'output-style'])
  const models = () => fleet().models ?? ['haiku', 'sonnet', 'opus', 'fable']
  const efforts = () => fleet().efforts ?? ['low', 'medium', 'high', 'xhigh', 'max']
  let seenOp = 0
  // Op ids a toast already summed up; the fleet's echo of each (lastOp, same id) is not toasted over it.
  const summed = new Set()
  const TABS =[['flight', 'Flight'], ['consoles', 'Consoles'], ['loops', 'Loops']]

  // The remembered profile (localStorage mcapp-profile) is a wish, not the state: nothing is named or
  // connected until the first listing of live profiles decides which one opens (loadFlights).
  // files: the attachment tray, in the order picked; upload: which of them is going up while a message sends.
  const S = { tab: 'flight', state: null, live: false, sheet: null, sel: null, filter: 'ALL', query: '', open: new Set(), queued: [], files: [], upload: null, tune: null, details: new Set(), sending: false, opener: null, flights: [], profile: '', resolved: false, listFailed: false, streamFailed: false }
  // Every request goes to the chosen profile's Flight through the front door.
  const base = () => (S.profile ? `/p/${encodeURIComponent(S.profile)}` : '')
  const authHeaders = () => (token ? { 'x-mcapp-token': token } : {})
  const label = p => str(p).charAt(0).toUpperCase() + str(p).slice(1)
  // Claude Code records its own notices (a background task finishing, a system reminder) as user
  // messages; they show as a quiet line, never as the founder's words. null: not a notice.
  const harnessNotice = text => {
    const t = str(text).trim()
    if (/^<task-notification>/.test(t) || /^\[SYSTEM NOTIFICATION/.test(t)) {
      const summary = /<summary>([\s\S]*?)<\/summary>/.exec(t)?.[1]?.trim()
      return summary || "Background task update"
    }
    if (/^<system-reminder>/.test(t) && !stripReminders(t)) return ''
    return null
  }
  // Each file a message carried travels as a line naming its stored path, which Flight opens with Read. The
  // page fetches it once with the token in a header and shows it from a blob: URL, so the token never sits
  // in the page. A document's blob takes a fixed type whatever the server answered: a PDF opens as a PDF,
  // every text file as plain text, never as a page.
  const OPENS_AS = { pdf: 'application/pdf', txt: 'text/plain;charset=utf-8', md: 'text/plain;charset=utf-8', csv: 'text/plain;charset=utf-8', json: 'text/plain;charset=utf-8' }
  const TYPE_OF = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', ...OPENS_AS }
  const kept = new Map()
  const keptFile = (id, ext) => {
    const key = `${S.profile}/${id}`
    if (!kept.has(key)) {
      kept.set(key, { state: 'loading', url: '' })
      fetch(`${base()}/upload/${id}`, { headers: authHeaders() })
        .then(async r => {
          // Only the server's own answer for a pruned file means gone; a 404 from the front door (a profile
          // restarting, so not listed for a moment) is asked again like any other failure.
          if (r.status === 404 && (await r.text().catch(() => '')) === 'that file is gone') kept.set(key, { state: 'gone', url: '' })
          else if (!r.ok) throw new Error(`upload ${r.status}`)
          else {
            const b = await r.blob()
            kept.set(key, { state: 'ready', url: URL.createObjectURL(OPENS_AS[ext] ? new Blob([b], { type: OPENS_AS[ext] }) : b) })
          }
          render()
        })
        // Not fetched this time (the link down, the Mac asleep): a later repaint asks again.
        .catch(() => setTimeout(() => kept.delete(key), 10_000))
    }
    return kept.get(key)
  }
  const photoView = (f, i, n) => {
    const got = keptFile(f.id, f.ext)
    if (got.state === 'ready') return `<img${n > 1 ? '' : ' class="photo"'} src="${esc(got.url)}" alt="${n > 1 ? `Photo ${i + 1} of ${n} you sent` : 'Photo you sent'}">`
    return `<span class="ph">${got.state === 'gone' ? 'Photo no longer on the Mac' : 'Photo loading…'}</span>`
  }
  const docView = f => {
    const got = keptFile(f.id, f.ext)
    const name = esc(f.name || f.id)
    const type = `<span class="ftype" aria-hidden="true">${esc(f.ext)}</span>`
    if (got.state === 'ready') return `<a class="doc" href="${esc(got.url)}" target="_blank" rel="noopener" data-a="doc" data-v="${esc(f.id)}">${type}<span class="doc-name">${name}<span class="visually-hidden">, opens in a new tab</span></span></a>`
    return `<span class="doc${got.state === 'gone' ? ' gone' : ''}">${type}<span class="doc-name">${name}</span><span class="doc-state">· ${got.state === 'gone' ? 'no longer on the Mac' : 'loading'}</span></span>`
  }
  // The founder's message: its photos (a grid when several), its documents as chips, then its words.
  const userBubble = (text, who = 'You') => {
    const { body, files } = attachments(text)
    const photos = files.filter(f => f.kind === 'photo')
    const docs = files.filter(f => f.kind === 'document')
    const pics = photos.length > 1 ? `<div class="photos">${photos.map((f, i) => photoView(f, i, photos.length)).join('')}</div>` : photos.map(f => photoView(f, 0, 1)).join('')
    const chips = docs.length ? `<div class="docs">${docs.map(docView).join('')}</div>` : ''
    return `<div class="msg user"><div class="who">${esc(who)}</div>${pics}${chips}${body ? esc(body) : ''}</div>`
  }
  let queueSeq = 0
  // The founder's messages in Flight's transcript, as he typed them.
  const said = () => (fleet().flight?.messages ?? []).filter(x => x.role === 'user').map(x => typed(x.text))
  // A tab that is gone (the Poll, before MC-163) opens Flight.
  try { S.tab = sessionStorage.getItem('mcapp-tab') || 'flight' } catch {}
  if (!TABS.some(t => t[0] === S.tab)) S.tab = 'flight'

  const fleet = () => S.state?.fleet ?? {}
  const consoles = () => fleet().consoles ?? []
  // What waits on the founder, as the fleet sends it: each Controller's open question (Flight asks it) and to-do.
  const questions = () => fleet().questions ?? []
  const todos = () => fleet().todos ?? []
  const onYou = () => [...questions(), ...todos()]
  // Each call sign's colour slot, 0 to 7, as the fleet keeps it (placeSlots in the mod's hooks/loops.ts).
  const slots = () => fleet().slots ?? {}
  // A call sign as the app draws it everywhere: a chip in its Controller's colour, the idle fill when it
  // has none (badge.js, which also gives the colour's class).
  const slotClass = sign => (window.mcBadge ? window.mcBadge.slotClass(slots(), sign) : '')
  const call = sign => (window.mcBadge ? window.mcBadge.chip(sign, slots()) : `<span class="call">${esc(sign)}</span>`)
  // The call signs a Flight message's marker may name: every console's, and every one with a kept colour.
  const knownSigns = () => new Set([...consoles().map(c => c.callSign), ...Object.keys(slots())])
  // A to-do's text with its links live; escaped first, so only an http(s) link becomes markup.
  const linked = t => esc(t).replace(/https?:\/\/[^\s<]+/g, u => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`)
  // A to-do card's meta line: the call sign, then id and time.
  const meta = (p, at) => `<div class="kind">${call(p.from)}<span>· ${esc(p.id)}${at ? ` · ${esc(time(at))}` : ''}</span></div>`
  const report = (p, key = p.id) => (p.detail ? `<details data-id="${esc(key)}"${S.details.has(key) ? ' open' : ''}><summary>The report it came from</summary><pre>${esc(p.detail)}</pre></details>` : '')

  function statusOf(c) {
    if (c.status === 'stood-down') return ['idle', 'Stood down']
    if (onYou().some(p => p.from === c.callSign)) return ['waiting', 'Waiting on you']
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
    // A reply whose first line is the call-sign marker (badge.js) is badged with those Controllers, and the marker leaves the text.
    const known = knownSigns()
    for (const m of f.messages ?? []) {
      const notice = m.role === 'user' ? harnessNotice(m.text) : null
      if (notice !== null) {
        if (notice) parts.push(`<p class="sys">${esc(notice)}</p>`)
        continue
      }
      if (m.role === 'user') {
        parts.push(userBubble(typed(m.text)))
        continue
      }
      const { signs, text } = window.mcBadge ? window.mcBadge.parse(str(m.text), known) : { signs: [], text: str(m.text) }
      // A screen reader hears "FLIGHT, about MISSION-CONTROL, FIELDKIT"; on screen the chips stand alone.
      const who = window.mcBadge ? window.mcBadge.label(signs, slots()) : 'FLIGHT'
      parts.push(`<div class="msg assistant md"><div class="who">${who}</div>${window.mcMarkdown ? window.mcMarkdown(text) : esc(text)}</div>`)
    }
    for (const q of S.queued) parts.push(userBubble(q.text, `You · ${q.sent ? 'waiting for Flight' : 'sending'}`))
    // Each Controller's to-do, oldest first, checked off here.
    for (const p of todos()) parts.push(todoCard(p))
    // A Controller's question is asked as one of Flight's own (the card below); one Flight has not asked yet says so.
    const onCard = new Set((f.ask?.questions ?? []).map(q => str(q.header).toLowerCase()))
    const queued = questions().filter(p => !onCard.has(str(p.id).toLowerCase()))
    if (queued.length) parts.push(`<div class="notice" role="status">${queued.map(p => `<p>${call(p.from)} asks${p.urgent ? ' (urgent)' : ''}: ${esc(p.title)}</p>`).join('')}<p>Flight asks ${queued.length === 1 ? 'it' : 'them'} here when its turn ends.</p></div>`)
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
        <span class="head">${call(c.callSign)}${pill(st)}</span>
        <span class="task">${esc(r.state ?? 'No status check yet.')}</span>
        <span class="meta"><span class="tag">${esc(c.applied ?? c.model)}</span><span>${esc(c.project ? `${c.front}/${c.project}` : c.front)}</span><span>budget ${esc(c.budget ?? '-')}</span></span>
      </button>`
    }
    return h
  }

  // An action only the founder can take, with its link; Done checks it off and tells the Controller.
  function todoCard(p) {
    return `<article class="gate todo">${meta(p, p.at)}<h2>${linked(p.title)}</h2><div class="btnrow one"><button class="go secondary" type="button" data-a="tododone" data-v="${esc(p.id)}">Done<span class="visually-hidden"> (${esc(p.id)})</span></button></div>${report(p)}</article>`
  }

  function viewLoops() {
    const rows = fleet().loops ?? []
    const named = [...new Set(consoles().map(c => c.callSign))]
    const signs = ['ALL', 'FLIGHT', 'FOUNDER', ...named]
    // A Controller wears its colour here too: its filter outlined, filled while pressed. FLIGHT and FOUNDER stay neutral.
    const known = knownSigns()
    const who = s => (known.has(s) ? call(s) : esc(s))
    const list = rows.filter(l => S.filter === 'ALL' || l.from === S.filter || l.to === S.filter).slice().reverse()
    let h = `<div class="filters" role="group" aria-label="Filter by call sign">${signs.map(s => `<button type="button"${known.has(s) ? ` class="signed${slotClass(s)}"` : ''} data-a="filter" data-v="${esc(s)}" aria-pressed="${S.filter === s}">${esc(s)}</button>`).join('')}</div>`
    if (!list.length) h += '<p class="empty">No loop traffic yet.</p>'
    list.forEach(l => {
      const key = `${l.at}|${l.from}|${l.to}|${l.kind}`
      const full = S.open.has(key)
      const text = full ? str(l.text) : str(l.text).split('\n')[0]
      h += `<button type="button" class="loop ${l.kind === 'advisory' ? 'adv' : ''}" data-a="expand" data-v="${esc(key)}" aria-expanded="${full}"><span class="route">${who(l.from)} → ${who(l.to)}<span class="kindtag">${esc(l.kind)}</span></span><time>${esc(time(l.at))}</time><span class="body">${esc(text)}</span></button>`
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
      head = `${call(c.callSign)} ${pill(statusOf(c))}`
      body = `<dl class="report"><dt>State</dt><dd>${esc(r.state ?? '—')}</dd><dt>Shipped</dt><dd>${esc(r.shipped ?? '—')}</dd><dt>Blocked</dt><dd>${esc(r.blocked ?? '—')}</dd><dt>Next</dt><dd>${esc(r.next ?? '—')}</dd></dl>
        <p class="hint">${esc(c.front)}${c.project ? `/${esc(c.project)}` : ''} · ${esc(c.applied ?? c.model)} · budget ${esc(c.budget)} · ${esc(c.cwd)}</p>
        ${c.status === 'stood-down' ? '<p class="hint">This console is stood down. Staff it again from Flight.</p>' : `<div class="btnrow"><button class="ghost" type="button" data-a="callc">Call</button><button class="ghost" type="button" data-a="retune">Retune</button><button class="danger" type="button" data-a="standdown">Stand down</button></div>`}`
    } else if (S.sheet === 'retune') {
      const c = consoles().find(x => x.callSign === S.sel)
      if (!c) return ''
      const t = (S.tune ??= { model: 'sonnet', effort: 'medium' })
      head = `Retune ${call(c.callSign)}`
      body = `<p class="section-label">Model</p><div class="seg" role="group" aria-label="Model">${models().map(m => `<button type="button" data-a="tm" data-v="${m}" aria-pressed="${t.model === m}">${m}</button>`).join('')}</div>
        <p class="section-label">Effort</p><div class="seg" role="group" aria-label="Effort">${efforts().map(e => `<button type="button" data-a="te" data-v="${e}" aria-pressed="${t.effort === e}">${e}</button>`).join('')}</div>
        <p class="hint">Applies from the console's next model request. Its work keeps its context.</p>
        <button class="primary" type="button" data-a="applytune">Retune to ${esc(t.model)} · ${esc(t.effort)}</button>`
    } else if (S.sheet === 'standdown') {
      head = `Stand down ${call(S.sel)}?`
      body = `<p>The console writes a dated handoff to its front's progress.md, then ends. <b>Dismiss</b> ends it with nothing written.</p>
        <div class="btnrow"><button class="ghost" type="button" data-a="back">Keep</button><button class="ghost" type="button" data-a="dismiss">Dismiss</button><button class="danger" type="button" data-a="sdyes">Stand down</button></div>`
    } else if (S.sheet === 'profiles') {
      head = 'Profiles'
      body = S.listFailed
        ? `<p class="sys">Can't reach the Mac to list profiles; trying again.</p>`
        : S.flights.length
        ? `<div class="profiles">${S.flights.map(f => `<button class="prof" type="button" data-a="profile" data-v="${esc(f.profile)}" aria-pressed="${f.profile === S.profile}"><span class="prof-name">${esc(label(f.profile))}</span>${f.unreachable ? pill(['failed', 'Not answering']) : f.gates ? pill(['waiting', `${f.gates} waiting`]) : f.busy ? pill(['running', 'Working']) : pill(['idle', 'Idle'])}</button>`).join('')}</div>
          <p class="hint">A profile appears here while its session runs /console app.</p>`
        : '<p class="empty">No Flight is running. Type /console app in a Claude session.</p>'
    } else if (S.sheet === 'menu') {
      const live = consoles().filter(c => c.status !== 'stood-down')
      head = 'Fleet'
      body = `<dl class="report"><dt>Link</dt><dd>${S.live ? 'Live' : 'Reconnecting'} · ${esc(location.host)}</dd><dt>Consoles</dt><dd>${live.length} staffed</dd><dt>Updated</dt><dd>${esc(time(S.state?.at))}</dd></dl>
        <p class="section-label">Theme</p><div class="seg" role="group" aria-label="Theme">${['system', 'light', 'dark'].map(t => `<button type="button" data-a="theme" data-v="${t}" aria-pressed="${themeChoice() === t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div>
        <button class="danger" type="button" data-a="stopask"${live.length ? '' : ' disabled'}>Dismiss every console</button>
        <button class="ghost" type="button" data-a="appstopask">Stop the app server</button>
        <p class="hint">Flight keeps running in the terminal either way.</p>`
    } else if (S.sheet === 'stop') {
      head = 'Dismiss every console?'
      body = `<p>A dismissal for each staffed console goes to Flight and runs once Flight is free, ending the console with nothing written. Uncommitted work stays in each repo.</p><div class="btnrow two"><button class="ghost" type="button" data-a="close">Keep them</button><button class="danger" type="button" data-a="stopyes">Dismiss all</button></div>`
    } else if (S.sheet === 'appstop') {
      head = 'Stop the app server?'
      body = `<p>This page stops working until <code>/console app</code> runs again at the terminal, with a new link.</p><div class="btnrow two"><button class="ghost" type="button" data-a="close">Keep it</button><button class="danger" type="button" data-a="appstopyes">Stop it</button></div>`
    }
    return `<div class="scrim" data-a="close"></div><div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(String(head).replace(/<[^>]+>/g, ''))}"><div class="sheet-head"><h2>${head}</h2><button class="iconbtn" type="button" data-a="close" aria-label="Close">${ICONS.close}</button></div><div class="sheet-body">${body}</div></div>`
  }

  // ---------- render ----------
  // Each region is replaced only when its HTML changed, so a state push every two seconds
  // does not steal focus, collapse a report, wipe a note or replay a sheet's animation.
  const last = { main: '', tabs: '', sheet: '', quick: '', tray: '' }
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
      // A Controller's question carries its id as the header: shown with that Controller's call sign, as a to-do card is.
      const from = questions().find(p => str(p.id).toLowerCase() === str(q.header).toLowerCase())
      const head = from ? `${call(from.from)}<span>· ${esc(from.id)}${from.urgent ? ' · urgent' : ''}</span>` : esc(q.header)
      return `<div class="ask-q">${q.header ? `<p class="kind">${head}${q.multiSelect ? ' · pick any' : ''}</p>` : ''}<h2>${esc(q.question)}</h2>${input}</div>`
    }).join('')
    // A question may be left unanswered; one answer is enough to send.
    const ready = qs.some((q, qi) => askAnswer(q, draft.q[qi]))
    return `<section class="gate ask" aria-label="Flight is asking">${body}<button class="go" type="button" data-a="asksend" ${ready ? '' : 'disabled'}>Send answer</button></section>`
  }

  // Flight stays pinned to the newest message unless the founder scrolled up to read; opening the
  // app, returning to it, coming back to the Flight tab or switching profile pins it again.
  let stick = true
  const tabScroll = {}
  let restoreScroll = true
  function render() {
    try {
      const views = { flight: viewFlight, consoles: viewConsoles, loops: viewLoops }
      const main = $('main')
      $('title').textContent = TABS.find(t => t[0] === S.tab)?.[1] ?? 'Flight'
      main.className = `main view-${S.tab}`
      paint(main, 'main', views[S.tab]())
      const busy = fleet().flight?.busy
      // No listing means the Mac is out of reach; a listing with no stream means only this profile's Flight is not answering.
      const down = S.listFailed ? 'Not connected: sign in to Tailscale, or open the link /console app printed' : S.streamFailed ? 'Flight not answering; retrying' : 'Connecting to Flight…'
      $('link-text').textContent = S.live ? (busy ? `Live · ${fleet().flight?.activity || 'Flight is working'}` : 'Live · connected to Flight') : S.state ? 'Reconnecting…' : down
      document.querySelector('.dot').className = `dot ${S.live ? (busy ? 'busy' : 'live') : ''}`
      const others = S.flights.filter(f => f.profile !== S.profile && (f.gates || f.busy))
      // The switcher names only a listed profile and shows only while there is another to switch to: it waits for the
      // first listing and hides while fewer than two profiles are listed or the Mac cannot be reached.
      const hideSwitcher = !S.resolved || S.listFailed || !S.profile || S.flights.length < 2
      // A switcher that hides while it has focus hands focus to the menu beside it, so a keyboard user is not dropped.
      if (hideSwitcher && document.activeElement === $('profile')) $('menu').focus()
      $('profile').hidden = hideSwitcher
      $('profile-name').textContent = S.profile ? label(S.profile) : 'Profile'
      $('profile').setAttribute('aria-label', `Profile: ${S.profile ? label(S.profile) : 'none'}${others.length ? `, ${others.length} other ${others.length === 1 ? 'profile needs' : 'profiles need'} a look` : ''}. Switch profile`)
      $('profile-dot').className = `dot ${others.some(f => f.gates) ? 'busy' : 'live'}`
      $('profile-dot').hidden = !others.length
      $('composer').hidden = S.tab !== 'flight'
      $('tray').hidden = !S.files.length
      paint($('tray-items'), 'tray', trayItems())
      const hint = trayHint()
      if ($('tray-hint').textContent !== hint) $('tray-hint').textContent = hint
      paint($('quick'), 'quick', ['/console list', '/briefing', '/standup', '/debrief'].map(q => `<button type="button" data-a="quick" data-v="${esc(q)}">${esc(q)}</button>`).join(''))
      const n = onYou().length
      paint($('tabs'), 'tabs', TABS.map(([k, l]) => `<button class="tab" type="button" role="tab" data-a="tab" data-v="${k}" aria-selected="${S.tab === k}">${ICONS[k]}${l}${k === 'flight' && n ? `<span class="badge" aria-label="${n} waiting">${n}</span>` : ''}</button>`).join(''))
      const wasOpen = last.sheet !== ''
      const repainted = paint($('sheet-root'), 'sheet', sheet())
      if (repainted && last.sheet !== '' && !wasOpen) {
        // Focus moves into a sheet when it opens, and back to its opener when it closes.
        const first = document.querySelector('.sheet input, .sheet .sheet-body button, .sheet [data-a="close"]')
        first?.focus()
      } else if (repainted && last.sheet === '' && wasOpen) {
        // The switcher hides when one profile is left, even with its sheet open; focus then goes to the menu beside it.
        const back = S.opener?.hidden ? $('menu') : S.opener
        back?.focus?.()
        S.opener = null
      }
      if (S.tab === 'flight' && stick) main.scrollTop = main.scrollHeight
      // The tabs share one scroll area: a tab other than Flight opens where it was left (the top at first),
      // never at the position the previous tab had scrolled to.
      else if (S.tab !== 'flight' && restoreScroll) main.scrollTop = tabScroll[S.tab] ?? 0
      restoreScroll = false
    } catch (err) {
      toast('Something on this page failed to draw. Reload it; the fleet keeps running.', 'error')
      console.error(err)
    }
  }

  let toastTimer
  function toast(msg, kind = 'info') {
    const t = $('toast')
    t.textContent = msg
    // Above the composer when it shows, however tall the tray makes it, so a toast never covers the draft or
    // the tray it is about; on the other tabs, where the lift token puts it.
    const c = $('composer')
    const top = c.hidden ? 0 : c.getBoundingClientRect().top
    t.style.setProperty('--toast-above', top > 0 ? `${Math.ceil(innerHeight - top)}px` : '')
    t.className = `toast${kind === 'error' ? ' error' : ''}${top > 0 ? ' over' : ''}`
    t.hidden = false
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => { t.hidden = true }, kind === 'error' ? 8000 : 2600)
  }

  // What one Dismiss all tap did: how many dismissals reached Flight, then each console not sent and why.
  function dismissalsSent(n, failed, why) {
    if (!n && !failed.length) return 'No console is staffed, so nothing was sent.'
    const sent =n === 1 ? '1 dismissal sent to Flight; it runs once Flight is free.' : `${n} dismissals sent to Flight; they run once Flight is free.`
    const not = `Not sent: ${failed.join(', ')}. ${why}`
    return !failed.length ? sent : n ? `${sent} ${not}` : not
  }

  const STILL_CONNECTING = 'Still connecting to Flight. Try again in a moment.'
  // One op, toasting nothing: { id } once the server has it (the fleet's result returns as lastOp with that id), or { error }.
  async function post(op, text) {
    // Before the first listing the request would reach the front door's own profile, which may not be the one about to open.
    if (!S.resolved) return { error: STILL_CONNECTING }
    try {
      const headers = { 'Content-Type': 'application/json', ...authHeaders() }
      const r = await fetch(`${base()}/op`, { method: 'POST', headers, body: JSON.stringify({ op, text }) })
      if (!r.ok) return { error: r.status === 401 ? "Couldn't send: this link has expired. Open the new link from your Mac." : "Couldn't send that. Try again in a moment." }
      return { id: (await r.json().catch(() => null))?.id ?? 0 }
    } catch {
      return { error: "Couldn't reach Flight. Check that the Mac is awake and connected." }
    }
  }
  async function send(op, text) {
    const { error } = await post(op, text)
    if (error) toast(error, error === STILL_CONNECTING ? 'info' : 'error')
    return !error
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
      case 'theme': setTheme(v); break
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
      case 'tab': if (v === 'flight') stick = true; if (v !== S.tab) restoreScroll = true; S.tab = v; S.sheet = null; try { sessionStorage.setItem('mcapp-tab', v) } catch {} break
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
      case 'tododone': await send('console', `done ${v}`); break
      case 'filter': S.filter = v; break
      case 'expand': S.open.has(v) ? S.open.delete(v) : S.open.add(v); break
      case 'stopask': S.sheet = 'stop'; break
      case 'stopyes': {
        // A dismissal is relayed and runs once Flight's turn ends, so the toast says what was sent, never what is done.
        let sent = 0
        let why = ''
        const failed = []
        for (const c of consoles().filter(x => x.status !== 'stood-down')) {
          const r = await post('console', `dismiss ${c.callSign}`)
          if (r.error) {
            failed.push(c.callSign)
            why = r.error
          } else {
            sent++
            if (r.id) summed.add(r.id)
          }
        }
        toast(dismissalsSent(sent, failed, why), failed.length ? 'error' : 'info')
        S.sheet = null
        break
      }
      case 'appstopask': S.sheet = 'appstop'; break
      case 'appstopyes': await send('console', 'app stop'); S.sheet = null; break
      case 'unattach': {
        const i = S.files.findIndex(f => String(f.key) === v)
        if (i < 0 || S.sending) return
        const [gone] = S.files.splice(i, 1)
        if (!gone.shared) URL.revokeObjectURL(gone.url)
        render()
        // Focus stays in the tray: the item now in that place, else the last one, else the paperclip.
        const rest = document.querySelectorAll('[data-a="unattach"]')
        ;(rest[Math.min(i, rest.length - 1)] ?? $('attach')).focus()
        return
      }
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
    if (e.target.id === 'q' && !e.isComposing) {
      S.query = e.target.value
      render()
    }
  })
  document.addEventListener('toggle', e => {
    if (e.target.tagName === 'DETAILS' && e.target.dataset.id) e.target.open ? S.details.add(e.target.dataset.id) : S.details.delete(e.target.dataset.id)
  }, true)
  $('profile').addEventListener('click', () => { S.opener = $('profile'); S.sheet = 'profiles'; render(); void loadFlights(false) })
  $('menu').addEventListener('click', () => { S.opener = $('menu'); S.sheet = 'menu'; render() })
  $('slash').addEventListener('click', () => { S.opener = $('slash'); S.sheet = 'slash'; S.query = ''; render() })
  $('send').addEventListener('submit', async e => {
    e.preventDefault()
    if (S.sending) return
    const box = $('draft')
    const typedText = box.value.trim()
    let text = typedText
    const picked = S.files.slice()
    if (!text && !picked.length) return
    if (!S.resolved) return toast(STILL_CONNECTING)
    if (picked.length && text.startsWith('/')) return toast('Remove the attachments to run a command.', 'error')
    // A draft already over the limit is refused before any file goes up.
    if (text.length > TEXT_MAX) return tooLong(text.length, false)
    if (picked.length) {
      // Locked while the files go up, one at a time, so the files and the draft sent are the ones on screen.
      const where = S.profile
      const unlock = () => {
        S.sending = false
        S.upload = null
        lock(false)
      }
      S.sending = true
      lock(true)
      const lines = []
      for (const [i, f] of picked.entries()) {
        S.upload = { at: i + 1, of: picked.length }
        render()
        if (!f.stored) {
          const r = await upload(f)
          if (S.profile !== where) {
            unlock()
            toast('The profile changed while the files were going up, so nothing was sent. Send it again.', 'error')
            return render()
          }
          if (r.error) {
            // The tray stays as it is for a retry, which does not send a stored file twice.
            unlock()
            toast(r.error, 'error')
            return render()
          }
          f.stored = r.stored
          // The server keeps a file by its own bytes (a PDF picked as notes.txt is stored as a PDF, a photo
          // picked under a text name as the photo it is), so its line and its blob follow the stored type.
          const ext = f.stored.id.split('.').pop()
          if (ext !== f.ext) {
            if (!f.shared) URL.revokeObjectURL(f.url)
            f.kind = PHOTO_EXTS.includes(ext) ? 'photo' : 'document'
            f.ext = ext
            f.url = URL.createObjectURL(new Blob([f.blob], { type: TYPE_OF[ext] }))
          }
          // The page holds the file already: its bubble shows it at once, queued and once Flight has it.
          kept.set(`${S.profile}/${f.stored.id}`, { state: 'ready', url: f.url })
          f.shared = true
        }
        lines.push(line({ kind: f.kind, path: f.stored.path, name: f.name }))
      }
      unlock()
      text = `${text || forYou(picked)}\n\n${lines.join('\n')}`
    }
    const op = !picked.length && text.startsWith('/console ') ? ['console', text.slice(9)] : !picked.length && text.startsWith('/') ? ['command', text.slice(1)] : ['prompt', text]
    // What is posted, each file's line included, holds at most TEXT_MAX characters; on a refusal the files stay
    // stored and in the tray, so a shorter retry sends none of them twice.
    if (op[1].length > TEXT_MAX) return tooLong(op[1].length, picked.length > 0)
    // What the transcript held when it was sent, and the fleet's last answer then: neither is this message's arrival.
    const item = { id: ++queueSeq, text, sent: false, op: 0, before: said(), lastAt: fleet().lastOp?.at }
    S.queued.push(item)
    S.sending = true
    box.value = ''
    render()
    const r = await post(op[0], op[1])
    S.sending = false
    if (!r.error) {
      // The files leave the composer only once Flight has the message; a failed send keeps them for a retry.
      S.files = S.files.filter(f => !picked.includes(f))
      item.sent = true
      // The fleet answers this op by its id (lastOp), which clears the queued copy of a command it ran itself.
      item.op = r.id
      if (fleet().flight?.busy) toast('Queued: Flight runs it when the current turn ends.')
    } else {
      toast(r.error, r.error === STILL_CONNECTING ? 'info' : 'error')
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
  // ---------- theme ----------
  // System follows the device; Light or Dark is kept per device and applied by theme.js before paint.
  const themeChoice = () => { try { return localStorage.getItem('mcapp-theme') || 'system' } catch { return 'system' } }
  function setTheme(t) {
    try { t === 'system' ? localStorage.removeItem('mcapp-theme') : localStorage.setItem('mcapp-theme', t) } catch {}
    if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t
    else delete document.documentElement.dataset.theme
    themeBar()
  }
  // The status bar follows the chosen theme, not only the device's: read from the tokens once they apply.
  function themeBar() {
    const meta = document.getElementById('theme-color')
    const t = themeChoice()
    if (meta) meta.content = t === 'system' ? '' : getComputedStyle(document.documentElement).getPropertyValue(t === 'dark' ? '--bg' : '--accent').trim()
  }
  themeBar()

  // ---------- attachments ----------
  // What one message may carry (DESIGN.md, Attachments). The server holds the per-file limit and reads each
  // file's own bytes (uploads.mjs), so that check only spares the founder an upload bound to be refused; the
  // count and the total are the page's own, since each file goes up on its own.
  const LIMIT = { files: 10, file: 8 * 1024 * 1024, total: 32 * 1024 * 1024 }
  // The longest message the page sends, each file's line included. The /op route takes 8000 (server.mjs), but
  // the transcript the page reads back keeps only a message's first 6000 characters, the engine's frame around
  // a prompt included (snapshot, in the mod's hooks/register.ts): a longer one comes back cut, its file lines
  // lost, and its queued copy never matches it.
  const TEXT_MAX = 5800
  const tooLong = (n, withFiles) => {
    toast(`That message is ${n} characters${withFiles ? ' with its file lines' : ''}, and Flight takes ${TEXT_MAX}. Shorten it${withFiles ? ' or send fewer files' : ''}, then send again.`, 'error')
    render()
  }
  const DOCS = new Set(DOC_EXTS)
  const PHOTO_NAME = /\.(jpe?g|png|webp|gif|heic|heif|avif)$/i
  const total = () => S.files.reduce((n, f) => n + f.size, 0)
  // Rounded up to a tenth, so a few small photos read 0.1 MB and the count never shows less than the limit sees.
  const mb = n => (Math.ceil(n / 104857.6) / 10).toFixed(1)
  const MB = n => `${n / 1048576} MB`
  let fileSeq = 0
  // Two files of one name (a phone names every photo alike) are told apart by place in their remove buttons.
  function trayItems() {
    return S.files.map((f, i) => {
      const twin = S.files.some(g => g !== f && g.name === f.name)
      const shown = f.kind === 'photo' ? `<img src="${esc(f.url)}" alt="">` : `<span class="ftype" aria-hidden="true">${esc(f.ext)}</span>`
      return `<li class="att">${shown}<span class="att-name">${esc(f.name)}</span><button class="att-x" type="button" data-a="unattach" data-v="${f.key}" aria-label="Remove ${esc(f.name)}${twin ? `, ${i + 1} of ${S.files.length}` : ''}"${S.sending ? ' disabled' : ''}>${ICONS.close}</button></li>`
    }).join('')
  }
  const trayHint = () => (S.upload ? `Sending ${S.upload.at} of ${S.upload.of}…` : S.files.length ? `${S.files.length} of ${LIMIT.files} files · ${mb(total())} of ${MB(LIMIT.total)}` : '')
  const forYou = list => (list.length === 1 ? (list[0].kind === 'photo' ? 'A photo for you.' : 'A file for you.') : list.every(f => f.kind === 'photo') ? `${list.length} photos for you.` : `${list.length} files for you.`)

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
      // JPEG has no transparency: a transparent PNG would otherwise turn black.
      ctx.fillStyle = 'white'
      ctx.fillRect(0, 0, c.width, c.height)
      ctx.drawImage(img, 0, 0, c.width, c.height)
      return await new Promise(resolve => c.toBlob(resolve, 'image/jpeg', 0.85))
    } finally {
      URL.revokeObjectURL(url)
    }
  }
  // One file to the Mac, its picked type named for the server's check: { stored: { id, path } }, or
  // { error } naming the file and the server's own reason.
  async function upload(f) {
    try {
      const r = await fetch(`${base()}/upload`, { method: 'POST', headers: { 'Content-Type': f.blob.type || 'application/octet-stream', 'x-mcapp-ext': f.ext, ...authHeaders() }, body: f.blob })
      if (r.ok) return { stored: await r.json() }
      const why = r.status === 401 ? 'this link has expired; open the new link from your Mac' : (await r.text().catch(() => '')).trim().slice(0, 200)
      return { error: `Couldn't send ${f.name}${why ? `: ${why}` : '. Try again in a moment'}.` }
    } catch {
      return { error: "Couldn't reach Flight. Check that the Mac is awake and connected." }
    }
  }
  function lock(on) {
    for (const id of ['attach', 'draft']) $(id).disabled = on
  }
  $('attach').addEventListener('click', () => $('files').click())
  // Each pick joins the tray in order until a limit is reached; the ones not added are named in one toast, with why.
  $('files').addEventListener('change', async e => {
    const picks = [...(e.target.files ?? [])]
    e.target.value = ''
    if (!picks.length) return
    const refused = []
    for (const file of picks) {
      const ext = (/\.([a-z0-9]+)$/i.exec(file.name)?.[1] ?? '').toLowerCase()
      const photo = file.type.startsWith('image/') || PHOTO_NAME.test(file.name)
      let why = ''
      let item = null
      if (S.files.length >= LIMIT.files) why = `a message carries ${LIMIT.files} files at most`
      else if (!photo && !DOCS.has(ext)) why = 'only photos, PDF, or .txt, .md, .csv and .json files'
      else if (!file.size) why = 'the file is empty'
      else if (!photo && file.size > LIMIT.file) why = `over ${MB(LIMIT.file)}`
      else if (photo) {
        const blob = await shrink(file).catch(() => null)
        if (blob) item = { kind: 'photo', ext: 'jpg', blob, url: URL.createObjectURL(blob) }
        else why = "it can't be read as a photo"
      } else item = { kind: 'document', ext, blob: file, url: URL.createObjectURL(new Blob([file], { type: OPENS_AS[ext] })) }
      if (item) {
        // Shrinking a photo takes a moment, and a second pick can land meanwhile: the count is asked again here.
        if (S.files.length >= LIMIT.files) why = `a message carries ${LIMIT.files} files at most`
        else if (item.blob.size > LIMIT.file) why = `over ${MB(LIMIT.file)}`
        else if (total() + item.blob.size > LIMIT.total) why = `the message would pass ${MB(LIMIT.total)}`
        if (why) URL.revokeObjectURL(item.url)
        else S.files.push({ ...item, key: ++fileSeq, name: file.name, size: item.blob.size })
      }
      if (why) refused.push(`${file.name} (${why})`)
      render()
    }
    if (refused.length) toast(`Not added: ${refused.join('; ')}.`, 'error')
    $('draft').focus()
  })

  let es = null
  function connect() {
    if (es) es.close()
    // Over the tailnet the signed-in Tailscale identity is enough; a token is needed only on the Mac's own address.
    es = new EventSource(token ? `${base()}/events?t=${encodeURIComponent(token)}` : `${base()}/events`)
    es.onopen = () => { S.live = true; S.streamFailed = false; render() }
    // A non-200 (the profile's server restarting) closes an EventSource for good; open a new one.
    es.onerror = () => { S.live = false; if (!S.state) S.streamFailed = true; render(); if (es.readyState === EventSource.CLOSED) setTimeout(() => es.readyState === EventSource.CLOSED && connect(), 3000) }
    es.onmessage = m => {
      const first = S.state === null
      try { S.state = JSON.parse(m.data) } catch { return }
      const op = fleet().lastOp
      // The first state only records where results stand; a result from before this page opened is not news.
      if (first && op) seenOp = Number(op.id) || 0
      else if (op && op.id && op.id > seenOp) {
        seenOp = op.id
        const echo = summed.has(op.id)
        for (const id of summed) if (id <= op.id) summed.delete(id)
        if (op.text && !echo && !/^Sent to Flight\.$/.test(op.text)) toast(str(op.text).split('\n').slice(0, 3).join(' · ').slice(0, 220))
      }
      // A queued message leaves once its own copy reaches Flight's transcript or the fleet answered its op (transcript.js, waiting).
      S.queued = waiting(S.queued, said(), fleet().lastOp)
      render()
    }
  }
  // The live profiles, refreshed every few seconds. The first listing that names a profile decides which one opens:
  // the remembered one when it is listed, else the front door's own, else the first listed; until then the front door's own
  // Flight is shown unnamed. A profile missing from two timed listings in a row is left the same way; a listing a tap
  // asks for refreshes the list but never counts as a miss, so a restarting profile keeps its grace. Every move is
  // remembered, so a profile that stopped never pulls the app back when it runs again.
  let misses = 0
  async function loadFlights(counted = true) {
    let list
    try {
      const r = await fetch('/flights.json', { headers: authHeaders() })
      if (!r.ok) throw new Error(`flights ${r.status}`)
      list = await r.json()
    } catch {
      S.listFailed = true
      return render()
    }
    S.listFailed = false
    S.flights = Array.isArray(list) ? list : []
    const listed = p => S.flights.some(f => f.profile === p)
    const fallback = S.flights.find(f => f.self)?.profile ?? S.flights[0]?.profile ?? ''
    if (!S.resolved || !S.profile) {
      const opening = !S.resolved
      S.resolved = true
      let chosen = ''
      try { chosen = localStorage.getItem('mcapp-profile') ?? '' } catch {}
      const pick = chosen && listed(chosen) ? chosen : fallback
      // An empty listing (the front door's own entry missing) names no profile and says nothing about the remembered
      // one: the front door's own Flight opens unnamed, and the next listing that names a profile decides.
      if (!pick) return opening ? switchProfile('', false) : render()
      if (chosen && pick !== chosen) toast(`${label(chosen)} is not running; showing ${label(pick)}.`)
      return switchProfile(pick)
    }
    // A profile missing from one listing is often only restarting; it is left after two timed misses in a row.
    if (listed(S.profile)) misses = 0
    else if (counted) misses++
    if (misses >= 2 && fallback && fallback !== S.profile) {
      toast(`${label(S.profile)} is not running; showing ${label(fallback)}.`)
      return switchProfile(fallback)
    }
    render()
  }
  function switchProfile(p, remember = true) {
    if (remember) try { localStorage.setItem('mcapp-profile', p) } catch {}
    misses = 0
    if (p === S.profile && es) return render()
    S.profile = p
    stick = true
    S.state = null
    S.live = false
    S.streamFailed = false
    S.queued = []
    // The tray keeps its files; they go up to the new profile when the message is sent.
    for (const f of S.files) f.stored = null
    S.sel = null
    S.tune = null
    // Poll ids repeat across profiles, so a pick made in one is never sent in another.
    S.details = new Set()
    // A move the app makes keeps the profiles sheet open, so a tap on the switcher is never closed underneath;
    // a profile picked in the sheet closes it in the click handler.
    if (S.sheet !== 'profiles') S.sheet = null
    seenOp = 0
    summed.clear()
    connect()
    render()
  }
  $('main').addEventListener('scroll', () => {
    const m = $('main')
    if (S.tab !== 'flight' && !restoreScroll) tabScroll[S.tab] = m.scrollTop
    if (S.tab === 'flight') stick = m.scrollHeight - m.scrollTop - m.clientHeight < 40
  }, { passive: true })
  const repin = () => { if (document.visibilityState === 'visible') { stick = true; render() } }
  document.addEventListener('visibilitychange', repin)
  window.addEventListener('pageshow', repin)
  render()
  // The stream opens once the first listing has chosen a profile (switchProfile connects).
  void loadFlights()
  setInterval(() => loadFlights(), 5000)
})()
