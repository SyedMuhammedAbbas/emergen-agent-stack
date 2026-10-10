import type { Bot, Mood } from '../types'

const WORKING = new Set(['running', 'active', 'working'])

export function moodOf(status: unknown): Mood {
  const s = String(status ?? '').toLowerCase()
  if (WORKING.has(s)) return 'working'
  if (s === 'error') return 'error'
  if (s === 'paused') return 'paused'
  return 'idle'
}

/** Paperclip's agent list as mini-bots: working first, then errors, paused, idle. */
export function toBots(json: unknown): Bot[] {
  if (!Array.isArray(json)) return []
  const rank: Record<Mood, number> = { working: 0, error: 1, paused: 2, idle: 3 }
  return json
    .filter(a => a && typeof a.name === 'string')
    .map(a => ({ name: a.name as string, title: String(a.title ?? ''), mood: moodOf(a.status) }))
    .sort((a, b) => rank[a.mood] - rank[b.mood] || a.name.localeCompare(b.name))
}

export function face(mood: Mood, frame: number): string {
  if (mood === 'working') return frame % 2 ? '[^_^]' : '[o_o]'
  if (mood === 'error') return '[x_x]'
  if (mood === 'paused') return '[=_=]'
  return '[-_-]'
}
