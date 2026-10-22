// The file viewer: view.html#<path> shows one file a session wrote on this Mac, read through the
// app server's /file route. Markdown renders with md.js and text shows as text, here; an image shows
// here too. A PDF or an HTML report opens as the file itself, which the server sends sandboxed.
;(() => {
  let token = ''
  try {
    token = localStorage.getItem('mcapp-token') ?? ''
  } catch {}
  const headers = token ? { 'x-mcapp-token': token } : {}
  const body = document.getElementById('body')
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
  const say = text => (body.innerHTML = `<p class="hint" role="status">${esc(text)}</p>`)

  async function open() {
    const path = decodeURIComponent(location.hash.slice(1))
    const name = path.slice(path.lastIndexOf('/') + 1)
    document.getElementById('name').textContent = name || 'File'
    document.getElementById('where').textContent = path.slice(0, path.lastIndexOf('/') + 1)
    document.title = `${name || 'File'} - Mission Control`
    if (!path.startsWith('/')) return say('No file was named.')
    const url = `/file?path=${encodeURIComponent(path)}`
    let r
    try {
      r = await fetch(url, { headers })
    } catch {
      return say("Couldn't reach the Mac. Check that it is awake and connected.")
    }
    if (r.status === 401) return say('This page needs the app open on this device first: open the link /console app printed, then this file again.')
    if (r.status === 415) return say('The app does not show this kind of file.')
    if (r.status === 413) return say('This file is too large to show here.')
    if (!r.ok) return say('That file is not there, or it is outside the folders the app shows.')
    const type = r.headers.get('content-type') ?? ''
    if (type.startsWith('text/markdown')) {
      body.innerHTML = `<article class="msg md viewer-doc">${window.mcMarkdown(await r.text())}</article>`
    } else if (type.startsWith('text/plain')) {
      const pre = document.createElement('pre')
      pre.className = 'viewer-text'
      pre.textContent = await r.text()
      body.replaceChildren(pre)
    } else if (type.startsWith('image/') && type !== 'image/svg+xml') {
      const img = document.createElement('img')
      img.className = 'viewer-image'
      img.alt = name
      img.src = URL.createObjectURL(await r.blob())
      body.replaceChildren(img)
    } else {
      // A PDF, an SVG or an HTML report opens as itself, with the server's sandbox; the token rides along only on this Mac.
      const local = location.hostname === '127.0.0.1' || location.hostname === 'localhost'
      location.replace(local && token ? `${url}&t=${encodeURIComponent(token)}` : url)
    }
    body.focus()
  }

  window.addEventListener('hashchange', open)
  void open()
})()
