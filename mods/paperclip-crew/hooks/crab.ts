// Pixel crab in the style of savvy-progress (MIT, github.com/johnnyvizz/claude-kit): a 30x28 grid, the Claude
// clay body, one hat and one prop per role, the department's colour as the accent. CSS runs the walking, so
// a working bot animates with no redraws.
import type { Mood } from '../types'

const CLAY = '#D97757'
const INK = '#1F1E1D'
const GOLD = '#F5C542'
const GREY = '#8E929A'
const DARK = '#3A3A3C'
const PAPER = '#F4F3EE'

type Fill = (x: number, y: number, w: number, h: number, c: string, cls?: string) => void
type Dept = 'engineering' | 'operations' | 'branding' | 'freelance'
export type Profile = { dept: Dept; hat: string; prop: string }

export const ACCENT: Record<Dept, string> = {
  engineering: '#4C8DF6',
  operations: '#3B9C5F',
  branding: '#E0609A',
  freelance: '#F5A524',
}

// Hat and prop by agent name; anything unknown is a plain engineering crab.
const PROFILES: Record<string, Profile> = {
  manager: { dept: 'engineering', hat: 'cap', prop: 'clipboard' },
  cto: { dept: 'engineering', hat: 'crown', prop: 'none' },
  'frontend engineer': { dept: 'engineering', hat: 'headphones', prop: 'palette' },
  'backend engineer': { dept: 'engineering', hat: 'headphones', prop: 'none' },
  'devops engineer': { dept: 'engineering', hat: 'hardhat', prop: 'wrench' },
  'secops engineer': { dept: 'engineering', hat: 'hardhat', prop: 'shield' },
  qa: { dept: 'engineering', hat: 'glasses', prop: 'magnifier' },
  'ux reviewer': { dept: 'engineering', hat: 'beret', prop: 'magnifier' },
  docs: { dept: 'engineering', hat: 'glasses', prop: 'pen' },
  estimator: { dept: 'engineering', hat: 'cap', prop: 'calc' },
  'chief of staff': { dept: 'operations', hat: 'crown', prop: 'clipboard' },
  timekeeper: { dept: 'operations', hat: 'cap', prop: 'clock' },
  watchdog: { dept: 'operations', hat: 'hardhat', prop: 'magnifier' },
  'brand lead': { dept: 'branding', hat: 'crown', prop: 'palette' },
  designer: { dept: 'branding', hat: 'beret', prop: 'palette' },
  'video generator': { dept: 'branding', hat: 'cap', prop: 'camera' },
  'orrisian content': { dept: 'branding', hat: 'glasses', prop: 'pen' },
  'upwork scout': { dept: 'freelance', hat: 'cap', prop: 'briefcase' },
}

export const profileOf = (name: string): Profile =>
  PROFILES[name.toLowerCase()] ?? { dept: 'engineering', hat: 'none', prop: 'none' }

const HATS: Record<string, (f: Fill, a: string) => void> = {
  crown: (f, a) => {
    f(10, 8, 10, 2, GOLD); f(10, 6, 2, 2, GOLD); f(14, 5, 2, 3, GOLD); f(18, 6, 2, 2, GOLD); f(14, 8, 2, 1, a)
  },
  hardhat: f => {
    f(9, 6, 12, 3, GOLD); f(8, 9, 14, 1, '#C99A1E'); f(14, 5, 2, 1, GOLD)
  },
  beret: (f, a) => {
    f(8, 7, 13, 3, a); f(10, 6, 8, 1, a); f(14, 5, 2, 1, a)
  },
  cap: (f, a) => {
    f(9, 7, 12, 3, a); f(20, 9, 5, 2, a)
  },
  headphones: (f, a) => {
    f(8, 7, 14, 1, DARK); f(7, 8, 1, 5, DARK); f(22, 8, 1, 5, DARK); f(6, 11, 3, 4, a); f(21, 11, 3, 4, a)
  },
  glasses: f => {
    f(8, 11, 4, 1, DARK); f(8, 14, 4, 1, DARK); f(8, 12, 1, 2, DARK); f(11, 12, 1, 2, DARK)
    f(18, 11, 4, 1, DARK); f(18, 14, 4, 1, DARK); f(18, 12, 1, 2, DARK); f(21, 12, 1, 2, DARK); f(12, 12, 6, 1, DARK)
  },
  none: () => {},
}

// Props ride the raised claw (class `it`), so they move with it while the bot works.
const PROPS: Record<string, (f: Fill, a: string) => void> = {
  clipboard: f => {
    f(24, 8, 5, 7, '#C9A66B', 'it'); f(25, 7, 3, 1, GREY, 'it'); f(25, 10, 3, 1, PAPER, 'it'); f(25, 12, 3, 1, PAPER, 'it')
  },
  wrench: f => {
    f(24, 9, 1, 1, GREY, 'it'); f(26, 9, 1, 1, GREY, 'it'); f(24, 10, 3, 1, GREY, 'it'); f(25, 11, 1, 5, GREY, 'it')
  },
  magnifier: f => {
    f(24, 8, 3, 1, DARK, 'it'); f(23, 9, 1, 3, DARK, 'it'); f(27, 9, 1, 3, DARK, 'it'); f(24, 12, 3, 1, DARK, 'it')
    f(24, 9, 3, 3, 'rgba(169,214,245,.7)', 'it'); f(27, 13, 1, 3, '#7A4A26', 'it')
  },
  pen: (f, a) => {
    f(26, 7, 2, 9, a, 'it'); f(26, 16, 2, 1, INK, 'it'); f(26, 6, 2, 1, GOLD, 'it')
  },
  shield: (f, a) => {
    f(23, 8, 6, 6, GREY, 'it'); f(24, 9, 4, 4, a, 'it'); f(25, 14, 2, 1, GREY, 'it')
  },
  camera: f => {
    f(23, 9, 7, 5, DARK, 'it'); f(24, 8, 3, 1, DARK, 'it'); f(25, 10, 3, 3, 'rgba(169,214,245,.8)', 'it')
  },
  palette: (f, a) => {
    f(23, 9, 7, 6, '#E8D2A8', 'it'); f(24, 10, 1, 1, '#D0453F', 'it'); f(26, 10, 1, 1, '#3B7DD8', 'it'); f(28, 11, 1, 1, '#3B9C5F', 'it'); f(25, 12, 1, 1, a, 'it')
  },
  briefcase: f => {
    f(23, 11, 7, 5, '#7A4A26', 'it'); f(25, 10, 3, 1, '#7A4A26', 'it'); f(26, 13, 1, 1, GOLD, 'it')
  },
  clock: f => {
    f(24, 9, 5, 5, PAPER, 'it'); f(26, 10, 1, 3, INK, 'it'); f(26, 12, 2, 1, INK, 'it')
  },
  calc: f => {
    f(24, 8, 5, 8, DARK, 'it'); f(25, 9, 3, 2, 'rgba(169,214,245,.8)', 'it'); f(25, 12, 1, 1, PAPER, 'it'); f(27, 12, 1, 1, PAPER, 'it'); f(25, 14, 1, 1, PAPER, 'it'); f(27, 14, 1, 1, PAPER, 'it')
  },
  none: () => {},
}

// Same CSS idea as savvy-progress: periods divide one second, so a redraw never restarts them out of phase.
export const CRAB_CSS = `<style>
.run .la{animation:st .5s steps(1) infinite}.run .lb{animation:st .5s steps(1) infinite -.25s}
.run .bd{animation:bob .5s steps(1) infinite -.125s}.run .it{animation:wob 1s steps(1) infinite}
.run g{transform-box:fill-box}
@keyframes st{50%{transform:translateY(-1px)}}@keyframes bob{50%{transform:translateY(1px)}}@keyframes wob{50%{transform:translateY(-2px)}}
.live{animation:p 1.6s ease-in-out infinite}@keyframes p{50%{opacity:.3}}
.t{fill:#1f1f1f}.s{fill:#6b6b68}
@media (prefers-color-scheme: dark){.t{fill:#ececec}.s{fill:#a8a8a4}}
@media (prefers-reduced-motion: reduce){.run,.run g,.live{animation:none!important}}
</style>`

/** One crab as an SVG group. Groups: bd (body, hat), it (claw prop), la/lb (legs). */
export function crab(x: number, y: number, p: Profile, mood: Mood, scale = 1): string {
  const groups = new Map<string, string[]>([['bd', []]])
  const f: Fill = (cx, cy, w, h, c, cls = 'bd') => {
    if (!groups.has(cls)) groups.set(cls, [])
    groups.get(cls)?.push(`<rect x="${cx}" y="${cy}" width="${w}" height="${h}" fill="${c}"/>`)
  }
  const a = ACCENT[p.dept]
  const isErr = mood === 'error'
  // body, claws, eyes, legs (the savvy-progress crab)
  f(7, 10, 16, 12, CLAY); f(3, 14, 4, 4, CLAY); f(23, p.prop === 'none' ? 14 : 10, 4, 4, CLAY, 'it')
  f(9, 12, 2, 2, isErr ? '#D0453F' : INK); f(19, 12, 2, 2, isErr ? '#D0453F' : INK)
  f(7, 22, 2, 4, CLAY, 'la'); f(17, 22, 2, 4, CLAY, 'la'); f(11, 22, 2, 4, CLAY, 'lb'); f(21, 22, 2, 4, CLAY, 'lb')
  ;(HATS[p.hat] ?? HATS.none)(f, a)
  ;(PROPS[p.prop] ?? PROPS.none)(f, a)
  if (isErr) { f(1, 0, 2, 4, '#D0453F'); f(1, 5, 2, 2, '#D0453F') }
  if (mood === 'paused') { f(1, 0, 4, 1, GOLD); f(3, 1, 1, 1, GOLD); f(2, 2, 1, 1, GOLD); f(1, 3, 4, 1, GOLD) }
  const group = (cls: string) => `<g class="${cls}">${(groups.get(cls) ?? []).join('')}</g>`
  const props = [...groups.keys()].filter(k => !['bd', 'la', 'lb'].includes(k))
  const body = `<g class="bd">${(groups.get('bd') ?? []).join('')}${props.map(group).join('')}</g>`
  const dim = mood === 'idle' || mood === 'paused' ? 0.5 : 1
  return `<g transform="translate(${x},${y}) scale(${scale})" opacity="${dim}" shape-rendering="crispEdges"><g class="${mood === 'working' ? 'run' : ''}">${body}${group('la')}${group('lb')}</g></g>`
}

const esc = (s: string) => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] ?? c)

/** The strip above the prompt: every crab in a row; the ones doing something get a name. */
export function stripSvg(bots: { name: string; mood: Mood }[]): { source: string; width: number; height: number } {
  const SC = 0.8
  const CW = 24
  let x = 2
  const parts: string[] = []
  const busy = bots.filter(b => b.mood !== 'idle').sort((p, q) => (p.mood === 'working' ? 0 : 1) - (q.mood === 'working' ? 0 : 1))
  for (const b of [...busy, ...bots.filter(b => b.mood === 'idle')]) {
    const p = profileOf(b.name)
    parts.push(crab(x, 3, p, b.mood, SC))
    if (b.mood === 'working') parts.push(`<circle class="live" cx="${x + CW - 3}" cy="4" r="2.5" fill="${ACCENT[p.dept]}"/>`)
    x += CW + 2
    if (b.mood !== 'idle' && busy.indexOf(b) < 3) {
      const label = esc(b.name)
      parts.push(`<text class="t" x="${x - 2}" y="19" font-family="system-ui,sans-serif" font-size="11">${label}</text>`)
      x += label.length * 6.2 + 8
    }
  }
  const width = Math.ceil(x + 2)
  return { source: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="28" viewBox="0 0 ${width} 28">${CRAB_CSS}${parts.join('')}</svg>`, width, height: 28 }
}

/** One row of the /crew pane: crab, name, role and state. */
export function rowSvg(b: { name: string; title: string; mood: Mood }, W: number): string {
  const p = profileOf(b.name)
  const word = { working: 'working', idle: 'idle', paused: 'paused', error: 'needs attention' }[b.mood]
  const dot = b.mood === 'working' ? `<circle class="live" cx="34" cy="6" r="3.5" fill="${ACCENT[p.dept]}"/>` : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="40" viewBox="0 0 ${W} 40">${CRAB_CSS}${crab(2, 4, p, b.mood, 1)}` +
    `<text class="t" x="40" y="17" font-family="system-ui,sans-serif" font-size="13" font-weight="600">${esc(b.name)}</text>` +
    `<text class="s" x="40" y="32" font-family="system-ui,sans-serif" font-size="11">${esc(b.title)} · ${word}</text>${dot}</svg>`
}
