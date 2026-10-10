import { expect, test } from 'claude-code/testing'

import { face, moodOf, toBots } from './crew'

test('moods follow the Paperclip status', () => {
  expect(moodOf('running')).toBe('working')
  expect(moodOf('error')).toBe('error')
  expect(moodOf('paused')).toBe('paused')
  expect(moodOf('idle')).toBe('idle')
  expect(moodOf(undefined)).toBe('idle')
})

test('working bots come first, junk rows are dropped', () => {
  const bots = toBots([
    { name: 'QA', status: 'idle' },
    { name: 'Manager', status: 'running', title: 'Engineering Manager' },
    { status: 'idle' },
    { name: 'Watchdog', status: 'error' },
  ])
  expect(bots.map(b => b.name)).toEqual(['Manager', 'Watchdog', 'QA'])
  expect(toBots({ error: 'nope' })).toEqual([])
})

test('a working bot blinks, others stay put', () => {
  expect(face('working', 0)).not.toBe(face('working', 1))
  expect(face('idle', 0)).toBe(face('idle', 7))
})
