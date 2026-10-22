// A path to a file on this Mac, written in any message or card, becomes a link to the file viewer
// (view.html) only when that file is shared (the /share skill); any other path stays plain text. The
// link opens in a new tab, so the console keeps its place. Paths are found in text after the app
// renders; nothing here changes what the app sends. Whether a file is shared is the server's to say.
;(() => {
  let token = ''
  try {
    token = localStorage.getItem('mcapp-token') ?? ''
  } catch {}
  const headers = token ? { 'x-mcapp-token': token } : {}
  // An absolute path, or one relative to the portfolio, standing on its own (not the tail of a URL or
  // a longer path), up to whitespace or a quote.
  const PATH = /(?<![\w.:/~-])(?:\/|_command\/portfolio\/|fronts\/)[^\s<>"'`|]+/g
  const HAS_PATH = new RegExp(PATH.source)
  const TRAIL = /[.,;:!?)\]]+$/
  // A refusal or a failure is asked again after this long: a file shared after it was named links then.
  const RECHECK = 30_000
  let config = null
  const shown = new Map()

  async function loadConfig() {
    if (config) return config
    try {
      const r = await fetch('/files.json', { headers })
      if (r.ok) config = await r.json()
    } catch {}
    return config ?? {}
  }

  // The absolute path a written path names: as written, or under the portfolio when relative to it.
  function absolute(written, cfg) {
    return written.startsWith('/') ? written : cfg.portfolio ? `${cfg.portfolio}/${written}` : ''
  }

  // Whether the file is shared: one HEAD per path, a yes kept, a no asked again later (it may be shared since).
  function canShow(path) {
    const known = shown.get(path)
    if (known && (known.yes || Date.now() - known.at < RECHECK)) return known.answer
    const answer = fetch(`/file?path=${encodeURIComponent(path)}`, { method: 'HEAD', headers }).then(r => r.ok, () => false)
    const entry = { at: Date.now(), yes: false, answer }
    answer.then(ok => (entry.yes = ok))
    shown.set(path, entry)
    return answer
  }

  function linkFor(text, path) {
    const a = document.createElement('a')
    a.className = 'file-link'
    a.href = `view.html#${encodeURIComponent(path)}`
    a.target = '_blank'
    a.rel = 'noopener'
    a.textContent = text
    return a
  }

  async function scan(root) {
    const cfg = await loadConfig()
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: n => (n.parentElement?.closest('a, textarea, input, script, style') ? NodeFilter.FILTER_REJECT : HAS_PATH.test(n.data) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP),
    })
    const nodes = []
    for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n)
    for (const node of nodes) {
      const found = [...node.data.matchAll(PATH)].map(m => {
        const text = m[0].slice(0, 2000).replace(TRAIL, '')
        return { at: m.index, text, path: absolute(text, cfg) }
      }).filter(f => f.path)
      const ok = await Promise.all(found.map(f => canShow(f.path)))
      const keep = found.filter((_, k) => ok[k])
      if (!keep.length || !node.isConnected) continue
      const frag = document.createDocumentFragment()
      let last = 0
      for (const f of keep) {
        frag.append(node.data.slice(last, f.at), linkFor(f.text, f.path))
        last = f.at + f.text.length
      }
      frag.append(node.data.slice(last))
      node.replaceWith(frag)
    }
  }

  let queued = false
  function schedule(root) {
    if (queued) return
    queued = true
    requestAnimationFrame(() => {
      queued = false
      void scan(root)
    })
  }

  const main = document.getElementById('main')
  if (main) {
    new MutationObserver(() => schedule(main)).observe(main, { childList: true, subtree: true, characterData: true })
    schedule(main)
    // A file shared after it was named links then, without waiting for the next render.
    setInterval(() => schedule(main), RECHECK)
  }
})()
