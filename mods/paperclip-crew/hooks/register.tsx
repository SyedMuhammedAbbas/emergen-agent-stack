import type { Register } from 'claude-code'

import type { Mood, Snapshot } from '../types'
import { rowSvg, stripSvg } from './crab'
import { face, toBots } from './crew'

const API = 'http://localhost:3100/api'
const PANE = 'paperclip-crew'
const snapshot = { plugin: 'paperclip-crew', key: 'snapshot' } as const
const frame = { plugin: 'paperclip-crew', key: 'frame' } as const
const EMPTY: Snapshot = { bots: [], isUp: false }

const COLOR: Record<Mood, 'green' | 'red' | 'yellow' | undefined> = {
  working: 'green',
  error: 'red',
  paused: 'yellow',
  idle: undefined,
}

export const register: Register = on => {
  let companyId = ''
  let ticks = 0

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'crew', description: 'Show every Paperclip agent as a pixel crab' })

    // One timer: refresh from Paperclip every 5 seconds; the terminal faces blink every second.
    $.clock.every(1000, async () => {
      ticks += 1
      if (ticks % 5 === 1) {
        try {
          if (!companyId) {
            const list = await $.http.fetch(`${API}/companies`)
            companyId = JSON.parse(list.text)[0]?.id ?? ''
          }
          const res = await $.http.fetch(`${API}/companies/${companyId}/agents`)
          if (!res.ok) throw new Error(String(res.status))
          await $.state.set(snapshot, { bots: toBots(JSON.parse(res.text)), isUp: true })
        } catch {
          companyId = ''
          await $.state.set(snapshot, EMPTY)
        }
        return
      }
      const { value = EMPTY } = await $.state.get(snapshot)
      if (e.surface === 'terminal' && value.bots.some(b => b.mood === 'working')) {
        const { value: n = 0 } = await $.state.get(frame)
        await $.state.set(frame, n + 1)
      }
    })

    return next(e)
  })

  on('command.run', { command: 'crew' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Paperclip crew' })

    return { text: 'Crew pane opened.' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { value: snap = EMPTY } = await $.state.get(snapshot)
    const ui = $.ui.resolve(e)
    const { Box, Text } = ui

    if (!snap.isUp) {
      return (
        <Box gap={1}>
          <Text dimColor>crew</Text>
          <Text color="red">Paperclip offline</Text>
        </Box>
      )
    }

    // Desktop: the pixel crabs, animated by CSS. Terminal: a text face per busy agent.
    if (e.surface !== 'terminal' && 'Svg' in ui) {
      const { Svg } = ui
      const strip = stripSvg(snap.bots)
      const busy = snap.bots.filter(b => b.mood === 'working').length
      return <Svg key="crew-strip" source={strip.source} alt={`${snap.bots.length} agents, ${busy} working`} width={strip.width} height={strip.height} />
    }

    const { value: tick = 0 } = await $.state.get(frame)
    const busy = snap.bots.filter(b => b.mood !== 'idle')
    const idle = snap.bots.length - busy.length

    return (
      <Box gap={1}>
        <Text dimColor>crew</Text>
        {busy.map(b => <Text color={COLOR[b.mood]}>{face(b.mood, tick)} {b.name}</Text>)}
        {idle > 0 && <Text dimColor>{`${face('idle', 0)} x${idle} idle`}</Text>}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { value: snap = EMPTY } = await $.state.get(snapshot)
    const { value: tick = 0 } = await $.state.get(frame)
    const ui = $.ui.resolve(e)
    const { Box, Text } = ui
    const W = Math.max(260, (e.viewport?.columns ?? 40) * 8)

    return (
      <Box flexDirection="column">
        {!snap.isUp && <Text color="red">Paperclip is not answering on localhost:3100.</Text>}
        {snap.bots.map(b =>
          e.surface !== 'terminal' && 'Svg' in ui ? (
            <ui.Svg key={b.name} source={rowSvg(b, W)} alt={`${b.name}, ${b.mood}`} width={W} height={40} />
          ) : (
            <Text color={COLOR[b.mood]} dimColor={b.mood === 'idle'}>
              {face(b.mood, tick)} {b.name} <Text dimColor>{b.title}</Text>
            </Text>
          ),
        )}
      </Box>
    )
  })
}
