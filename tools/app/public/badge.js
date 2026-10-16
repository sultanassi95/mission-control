// Reads the call-sign marker Flight leads a message with, so the app can badge the message with the
// Controllers it is about (MC-129), and draws a call sign the way the app shows it everywhere. The
// marker is the first line's opening bold run of call signs joined by a middle dot: `**FIELDKIT**` or
// `**MISSION-CONTROL · FIELDKIT**`; one run per call sign, joined by a dot or a space, reads the same.
// Alone on its line, the line leaves the text; followed on the same line by a space, a colon or a
// hyphen and then text, the text stays. Every name must be a call sign the fleet knows, spelled as the
// fleet spells it, or the line stays text: a bold first word is not a marker.
;(() => {
  const RUN = /^\*\*([^*\n]+)\*\*/
  const DOT = /^\s*\u00B7\s*/
  // Spaces, then another bold run.
  const SIDE = /^\s+(?=\*\*([^*\n]+)\*\*)/
  // The colour tokens --slot-1 to --slot-8.
  const SLOT_COUNT = 8
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

  /** { signs, text }: the call signs the message is about, in the order written, and the text left to render. */
  function parse(text, known) {
    const src = String(text ?? '')
    const names = known instanceof Set ? known : new Set(known ?? [])
    const none = { signs: [], text: src }
    if (!names.size) return none
    const lines = src.replace(/\r\n?/g, '\n').split('\n')
    let i = 0
    while (i < lines.length && !lines[i].trim()) i++
    if (i === lines.length) return none
    const entries = group => group.split('\u00B7').map(part => part.trim())
    const allKnown = group => entries(group).every(sign => names.has(sign))
    let rest = lines[i].trimStart()
    const signs = []
    for (;;) {
      const run = RUN.exec(rest)
      // A dot promises another run of known call signs: anything else means the line is not a marker.
      if (!run || !allKnown(run[1])) return none
      for (const sign of entries(run[1])) if (!signs.includes(sign)) signs.push(sign)
      rest = rest.slice(run[0].length)
      const dot = DOT.exec(rest)
      if (dot) {
        rest = rest.slice(dot[0].length)
        continue
      }
      // A run beside it, after a space, joins the marker when every name in it is known; else it is text.
      const side = SIDE.exec(rest)
      if (side && allKnown(side[1])) {
        rest = rest.slice(side[0].length)
        continue
      }
      break
    }
    // The marker ends at a space, a colon or the line's end: in `**FIELDKIT**'s PR` the bold is part of a word.
    if (rest && !/^[\s:]/.test(rest)) return none
    rest = rest.replace(/^\s*(?::|-(?=\s|$))/, '').trim()
    const body = rest ? [rest, ...lines.slice(i + 1)] : lines.slice(i + 1)
    return { signs, text: body.join('\n') }
  }

  /** The class of a call sign's colour, ' slot-1' to ' slot-8' for a kept slot 0 to 7; '' for none. */
  function slotClass(slots, sign) {
    const n = slots && Object.prototype.hasOwnProperty.call(slots, sign) ? slots[sign] : undefined
    return Number.isInteger(n) && n >= 0 && n < SLOT_COUNT ? ` slot-${n + 1}` : ''
  }

  /** A call sign as the app draws it: a chip in its Controller's colour, the idle fill when it has none. */
  function chip(sign, slots) {
    return `<span class="call${slotClass(slots, sign)}">${esc(sign)}</span>`
  }

  /** A Flight message's label: FLIGHT, then a chip per call sign; a screen reader hears "FLIGHT, about A, B". */
  function label(signs, slots) {
    if (!signs.length) return 'FLIGHT'
    return `FLIGHT<span class="visually-hidden">, about </span>${signs.map(sign => chip(sign, slots)).join('<span class="visually-hidden">, </span>')}`
  }

  window.mcBadge = { parse, slotClass, chip, label }
})()
