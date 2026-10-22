// The file viewer: view.html#<path> shows one file a session wrote on this Mac, read through the
// app server's /file route. Markdown renders with md.js, text and images show here. A PDF, an SVG
// or an HTML report opens as the file itself, through a single-use ticket the server issues for that
// one file, so no URL ever carries the app's token; the server sends it sandboxed.
;(() => {
  let token = ''
  try {
    token = localStorage.getItem('mcapp-token') ?? ''
  } catch {}
  const headers = token ? { 'x-mcapp-token': token } : {}
  const body = document.getElementById('body')
  const say = text => {
    const p = document.createElement('p')
    p.className = 'hint'
    p.setAttribute?.('role', 'status')
    p.textContent = text
    body.replaceChildren(p)
  }

  async function open() {
    let path = ''
    try {
      path = decodeURIComponent(location.hash.slice(1))
    } catch {
      return say('That link to a file is not readable.')
    }
    const name = path.slice(path.lastIndexOf('/') + 1)
    document.getElementById('name').textContent = name || 'File'
    document.getElementById('where').textContent = path.slice(0, path.lastIndexOf('/') + 1)
    document.title = `${name || 'File'} - Mission Control`
    if (!path.startsWith('/')) return say('No file was named.')
    const url = `/file?path=${encodeURIComponent(path)}`
    let r
    try {
      r = await fetch(url, { method: 'HEAD', headers })
    } catch {
      return say("Couldn't reach the Mac. Check that it is awake and connected.")
    }
    if (r.status === 401) return say('This page needs the app open on this device first: open the link /console app printed, then this file again.')
    if (r.status === 415) return say('The app does not show this kind of file.')
    if (r.status === 413) return say('This file is too large to show here.')
    if (!r.ok) return say('That file is not there, or it is outside the folders the app shows.')
    const type = r.headers.get('content-type') ?? ''
    const shownHere = type.startsWith('text/markdown') || type.startsWith('text/plain') || (type.startsWith('image/') && type !== 'image/svg+xml')
    if (!shownHere) {
      const t = await fetch('/file-ticket', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ path }) }).catch(() => null)
      const ticket = t?.ok ? (await t.json().catch(() => null))?.ticket : undefined
      if (!ticket) return say("Couldn't open that file. Try again from the app.")
      return location.replace(`/file?ticket=${encodeURIComponent(ticket)}`)
    }
    const got = await fetch(url, { headers }).catch(() => null)
    if (!got?.ok) return say("Couldn't read that file. Try again from the app.")
    if (type.startsWith('text/markdown')) {
      const article = document.createElement('article')
      article.className = 'msg md viewer-doc'
      // md.js escapes every piece of source text before it adds markup.
      article.innerHTML = window.mcMarkdown(await got.text())
      body.replaceChildren(article)
    } else if (type.startsWith('text/plain')) {
      const pre = document.createElement('pre')
      pre.className = 'viewer-text'
      pre.textContent = await got.text()
      body.replaceChildren(pre)
    } else {
      const img = document.createElement('img')
      img.className = 'viewer-image'
      img.alt = name
      img.src = URL.createObjectURL(await got.blob())
      body.replaceChildren(img)
    }
    body.focus()
  }

  window.addEventListener('hashchange', open)
  void open()
})()
