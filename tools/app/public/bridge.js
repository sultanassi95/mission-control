// Minimal bridge page (MC-098): proves the live stream and the op channel. The full app is MC-100.
// The token arrives once as ?t= and is kept in localStorage, which is scoped to this exact origin (port included).
const params = new URLSearchParams(location.search)
if (params.has('t')) {
  try { localStorage.setItem('mcapp-token', params.get('t')) } catch {}
  history.replaceState(null, '', location.pathname)
}
let token = ''
try { token = localStorage.getItem('mcapp-token') ?? '' } catch {}
const link = document.getElementById('link')
const out = document.getElementById('state')
const sent = document.getElementById('sent')
if (!token) link.textContent = 'No token: open the URL /console app printed.'
const events = new EventSource(`/events?t=${encodeURIComponent(token)}`)
events.onopen = () => { link.textContent = 'Live: connected to Flight.' }
events.onerror = () => { link.textContent = token ? 'Reconnecting…' : 'No token: open the URL /console app printed.' }
events.onmessage = m => { out.textContent = JSON.stringify(JSON.parse(m.data), null, 2) }
document.getElementById('send').addEventListener('submit', async e => {
  e.preventDefault()
  const text = document.getElementById('text').value.trim()
  if (!text) return
  const op = text.startsWith('/console ') ? { op: 'console', text: text.slice(9) } : text.startsWith('/') ? { op: 'command', text: text.slice(1) } : { op: 'prompt', text }
  const r = await fetch('/op', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-mcapp-token': token }, body: JSON.stringify(op) })
  sent.textContent = r.ok ? 'Sent to Flight.' : `Not sent: ${r.status} ${await r.text()}`
  if (r.ok) document.getElementById('text').value = ''
})
