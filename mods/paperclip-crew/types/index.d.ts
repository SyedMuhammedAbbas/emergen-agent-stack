export type Mood = 'working' | 'idle' | 'paused' | 'error'
export type Bot = { name: string; title: string; mood: Mood }
export type Snapshot = { bots: Bot[]; isUp: boolean }

declare module 'claude-code' {
  interface PluginState {
    'paperclip-crew': { snapshot: Snapshot; frame: number }
  }
}
