// Layout audit for the wizard UI. Not served with the app; run it in a browser tab that has the wizard open (preview mode):
//   serve it temporarily: copy to ui/_audit.js, then in the page console: window.__widths = [320, 768]; await eval(await (await fetch('_audit.js')).text())
//   window.__stress = true  fills every field with very long values. Run two widths at a time (the page limits a script to ~45 s).
// It loads the real app in hidden frames of each width, walks every step, and at the top, middle and bottom of each screen reports:
// sideways scrolling, anything past its box or the window, clipped text, overlapping siblings, split words, floated labels over text.
// Delete ui/_audit.js afterwards.
(async () => {
  const url = location.href, wait = ms => new Promise(r => setTimeout(r, ms))
  const widths = (window.__widths ?? [320, 360, 414, 600, 768, 900, 1024, 1180, 1440, 1920])
  const issues = new Map()
  const desc = e => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).join('.') : '') + ' "' + (e.textContent || '').trim().slice(0, 28) + '"'
  const add = (tag, msg) => { const k = msg; if (!issues.has(k)) issues.set(k, new Set()); issues.get(k).add(tag) }
  const visible = (win, e) => { const r = e.getBoundingClientRect(), cs = win.getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' }
  function auditOnce(win, tag) {
    const doc = win.document, root = doc.documentElement, vw = root.clientWidth
    if (root.scrollWidth > vw + 1) add(tag, `page scrolls sideways (content ${root.scrollWidth}px in a ${vw}px window)`)
    const els = [...doc.querySelectorAll('body *')].filter(e => visible(win, e) && !e.closest('svg') || e.tagName === 'svg')
    for (const e of els) {
      const r = e.getBoundingClientRect(), p = e.parentElement
      if (e.closest('pre') || e.tagName === 'INPUT' || e.tagName === 'svg' || e.tagName === 'SCRIPT') continue
      if (r.right > vw + 1 || r.left < -1) add(tag, `${desc(e)} sticks out of the window`)
      if (e.scrollWidth > e.clientWidth + 1 && !['HTML', 'BODY'].includes(e.tagName)) add(tag, `${desc(e)} is wider than its box (${e.scrollWidth} > ${e.clientWidth})`)
      if (p && p !== doc.body) { const pr = p.getBoundingClientRect(); if (r.right > pr.right + 1.5 && win.getComputedStyle(p).overflowX === 'visible' && !p.closest('pre')) add(tag, `${desc(e)} pokes out of ${desc(p)}`) }
    }
    for (const e of els) { const t = e.children.length === 0 && !e.closest('pre') ? e.textContent.trim() : ''; if (t && !/\s/.test(t) && t.length <= 24) { const rg = doc.createRange(); rg.selectNodeContents(e); const lines = new Set([...rg.getClientRects()].map(q => Math.round(q.top / 4))); if (lines.size > 1) add(tag, `the word "${t}" is split across lines`) } }
    // siblings that overlap
    for (const p of [...doc.querySelectorAll('.shell, main, main *, aside, aside *, nav, nav *')].filter(p => !p.closest('svg'))) {
      const kids = [...p.children].filter(k => visible(win, k) && !['absolute', 'fixed'].includes(win.getComputedStyle(k).position) && k.tagName !== 'SCRIPT')
      for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) {
        const a = kids[i].getBoundingClientRect(), b = kids[j].getBoundingClientRect()
        const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left), oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
        if (ox > 2 && oy > 2) add(tag, `${desc(kids[i])} overlaps ${desc(kids[j])}`)
      }
    }
    const h1 = doc.querySelector('h1'), vh = win.innerHeight
    if (h1 && h1.getBoundingClientRect().top > vh * 0.45) add(tag, `the page heading starts ${Math.round(h1.getBoundingClientRect().top)}px down: the first screen is mostly navigation`)
    const mn = doc.querySelector('main').getBoundingClientRect(); if (mn.width < 260) add(tag, `main content is only ${Math.round(mn.width)}px wide`)
    // floated pills against the text next to them
    for (const pill of doc.querySelectorAll('.pill')) {
      const pr = pill.getBoundingClientRect()
      for (const n of pill.parentElement.childNodes) if (n.nodeType === 3 && n.textContent.trim()) {
        const rg = doc.createRange(); rg.selectNodeContents(n)
        for (const q of rg.getClientRects()) { const ox = Math.min(q.right, pr.right) - Math.max(q.left, pr.left), oy = Math.min(q.bottom, pr.bottom) - Math.max(q.top, pr.top); if (ox > 1 && oy > 1) add(tag, `pill "${pill.textContent}" overlaps its title text`) }
      }
    }
  }
  // every check runs at the top, the middle and the bottom of the page: sticky parts move as you scroll
  function audit(win, tag) {
    win.scrollTo(0, 0); auditOnce(win, tag)
    const max = win.document.documentElement.scrollHeight - win.innerHeight
    if (max > 40) for (const [f, n] of [[0.5, 'mid-scroll'], [1, 'bottom']]) { win.scrollTo(0, Math.round(max * f)); auditOnce(win, tag + ' @' + n) }
    win.scrollTo(0, 0)
  }
  const fr = document.createElement('iframe'); fr.style.cssText = 'position:fixed;left:-20000px;top:0;border:0;height:900px'; document.body.appendChild(fr)
  const shots = {}
  for (const w of widths) {
    fr.style.width = w + 'px'; localStorage.clear()
    if (window.__stress) { const L = (n, c = 'W') => c.repeat(n); localStorage.setItem('agent-stack-wizard-v1', JSON.stringify({ step: 'welcome', areas: ['paperclip', 'personal', 'branding', 'freelance', 'routing', 'mods'], company: L(80, 'Emergen') .slice(0, 80), paperclip: { departments: ['engineering', 'operations', 'branding', 'freelance'], profile: 'watchful' }, personal: { organizer: true, categories: Array.from({ length: 10 }, (_, i) => ('Category' + i + L(30, 'x')).slice(0, 30)), projectsRoot: 'C:' + String.fromCharCode(92) + L(150, 'VeryLongFolderName').slice(0, 150) }, branding: { name: L(80, 'B'), offer: L(290, 'o'), audience: L(290, 'a'), tone: L(290, 't'), website: 'https://' + L(280, 'w'), linkedin: 'https://linkedin.com/' + L(260, 'l'), channels: ['Website posts', 'LinkedIn', 'Instagram', 'YouTube', 'Newsletter'] }, freelance: { upworkMcp: true }, routing: { omniroute: true }, mods: { crew: true } })) }
    fr.src = url; await new Promise(r => { fr.onload = r }); await wait(350)
    const win = fr.contentWindow, doc = win.document, q = s => doc.querySelector(s)
    const next = async () => { q('[data-act=next]').click(); await wait(200) }
    const tag = s => `${w}px · ${s}`
    audit(win, tag('welcome')); await next()
    for (const a of ['paperclip', 'personal', 'branding', 'freelance', 'routing', 'mods']) { const c = q(`[data-toggle=areas][data-value=${a}]`); if (!c.checked) { c.click(); await wait(80) } }
    audit(win, tag('areas')); await next()
    for (const s of ['agent company', 'personal workspace', 'branding', 'freelance', 'model routing', 'claude mods']) { audit(win, tag(s)); await next() }
    await wait(500); doc.querySelectorAll('details').forEach(d => { d.open = true }); await wait(100); audit(win, tag('review'))
    q('[data-act=run]').click(); await wait(250); audit(win, tag("run (running)"))
    for (let i = 0; i < 40 && q('h1').textContent !== 'Finished'; i++) await wait(400)
    audit(win, tag('run (finished)'))
  }
  fr.remove()
  return [...issues].map(([m, t]) => `${m}\n    at: ${[...t].join(', ')}`).join('\n') || 'NO ISSUES'
})()
