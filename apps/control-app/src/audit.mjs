// Append-only record of every state-changing action: %LOCALAPPDATA%\AgentStack\audit.jsonl. Never holds secret values.
import { appendFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { redact } from './redact.mjs';

export const appDirOf = (settings) => settings.appDir ?? process.env.AGENT_STACK_APP_DIR ?? join(process.env.LOCALAPPDATA ?? '.', 'AgentStack');

export function createAudit(dir) {
  const file = join(dir, 'audit.jsonl');
  return {
    file,
    add(rec) {
      mkdirSync(dir, { recursive: true });
      const line = { at: new Date().toISOString(), actor: 'local-user', ...rec, ...(rec.error ? { error: redact(rec.error).slice(0, 300) } : {}) };
      appendFileSync(file, JSON.stringify(line) + '\n');
      return line;
    },
    recent(n = 10) {
      if (!existsSync(file)) return [];
      return readFileSync(file, 'utf8').split('\n').filter(Boolean).slice(-n).reverse().map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    },
  };
}
