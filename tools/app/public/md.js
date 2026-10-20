// A small, safe markdown renderer for Flight's replies (MC-105). No dependency, because the app
// loads nothing remote. Safety rule: every piece of source text is HTML-escaped BEFORE any markup
// is added, and the only attribute built from source text is a link href, which must be http(s).
;(() => {
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
  // A table cell longer than this, in source characters, wraps at its spaces; a shorter one keeps to one line.
  const LONG_CELL = 24

  // Inline: code spans first (their content is literal), then links, bold, italic.
  function inline(raw) {
    const parts = String(raw).split(/(`[^`\n]+`)/)
    return parts.map((part, i) => {
      if (i % 2 === 1) return `<code>${esc(part.slice(1, -1))}</code>`
      let s = esc(part)
      s = s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (m, text, url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`)
      // Bare https URLs become links too, outside any link already made.
      s = s.split(/(<a [^>]*>.*?<\/a>)/).map((seg, k) => (k % 2 ? seg : seg.replace(/\bhttps?:\/\/[^\s<*]+[^\s<*.,;:!?)]/g, url => `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`))).join('')
      s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
      s = s.replace(/(^|[\s(])\*([^*\s][^*\n]*?)\*(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>')
      s = s.replace(/(^|[\s(])_([^_\s][^_\n]*?)_(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>')
      return s
    }).join('')
  }

  const isRow = l => /^\s*\|.*\|\s*$/.test(l)
  const isRule = l => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(l)
  const cells = l => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim())

  function render(src) {
    const lines = String(src ?? '').replace(/\r\n?/g, '\n').split('\n')
    const out = []
    let i = 0
    while (i < lines.length) {
      const line = lines[i]
      // fenced code
      const fence = /^\s*```/.exec(line)
      if (fence) {
        const body = []
        i++
        while (i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i++])
        i++
        out.push(`<pre class="md-code"><code>${esc(body.join('\n'))}</code></pre>`)
        continue
      }
      // table: a row, then a rule, then rows
      if (isRow(line) && i + 1 < lines.length && isRule(lines[i + 1])) {
        const head = cells(line)
        i += 2
        const rows = []
        while (i < lines.length && isRow(lines[i])) rows.push(cells(lines[i++]))
        // A short cell keeps to one line, so a narrow screen scrolls the table rather than break its words; a long one wraps at its spaces.
        const td = c => `<td${c.length > LONG_CELL ? ' class="long"' : ''}>${inline(c)}</td>`
        out.push(`<div class="md-table" tabindex="0" role="region" aria-label="Table, scrolls sideways when it is wider than the screen"><table><thead><tr>${head.map(c => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(td).join('')}</tr>`).join('')}</tbody></table></div>`)
        continue
      }
      // heading
      const h = /^(#{1,6})\s+(.*)$/.exec(line)
      if (h) {
        const level = Math.min(h[1].length + 2, 6)
        out.push(`<h${level} class="md-h">${inline(h[2])}</h${level}>`)
        i++
        continue
      }
      // rule
      if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
        out.push('<hr>')
        i++
        continue
      }
      // quote
      if (/^\s*>/.test(line)) {
        const body = []
        while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ''))
        out.push(`<blockquote>${render(body.join('\n'))}</blockquote>`)
        continue
      }
      // lists (one level; continuation lines join the item)
      const li = /^\s*([-*]|\d+[.)])\s+(.*)$/.exec(line)
      if (li) {
        const ordered = /\d/.test(li[1])
        const items = []
        while (i < lines.length) {
          const m = /^\s*([-*]|\d+[.)])\s+(.*)$/.exec(lines[i])
          if (m) items.push(m[2])
          else if (/^\s{2,}\S/.test(lines[i]) && items.length) items[items.length - 1] += ` ${lines[i].trim()}`
          else break
          i++
        }
        const tag = ordered ? 'ol' : 'ul'
        out.push(`<${tag}>${items.map(t => `<li>${inline(t)}</li>`).join('')}</${tag}>`)
        continue
      }
      // blank
      if (!line.trim()) {
        i++
        continue
      }
      // paragraph: consecutive plain lines
      const para = []
      while (i < lines.length && lines[i].trim() && !/^\s*(```|#{1,6}\s|>|[-*]\s|\d+[.)]\s)/.test(lines[i]) && !(isRow(lines[i]) && isRule(lines[i + 1] ?? ''))) para.push(lines[i++])
      out.push(`<p>${para.map(inline).join('<br>')}</p>`)
    }
    return out.join('')
  }

  // Each message is parsed on its own so a tag left open in one bubble can never carry into the next:
  // the HTML parser re-opens unclosed formatting tags (bold, italic) in every block that follows.
  function contained(src) {
    const t = document.createElement('template')
    t.innerHTML = render(src)
    return t.innerHTML
  }

  window.mcMarkdown = typeof document === 'undefined' ? render : contained
})()
