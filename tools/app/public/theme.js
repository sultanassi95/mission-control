// Applies the founder's theme choice (System, Light, Dark) before the page paints, so it never
// flashes the other theme. Loaded in <head> as a file: the page's CSP allows no inline script.
try {
  const t = localStorage.getItem('mcapp-theme')
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t
} catch {}
