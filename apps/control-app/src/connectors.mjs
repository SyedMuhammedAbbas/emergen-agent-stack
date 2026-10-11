// Connectors in the control app: the catalogue (connectors/*.json) with live status, and the setup walkthrough.
// Status comes from things we can verify: `claude mcp list` (registered / connected / needs sign-in), whether a program is
// installed and signed in, whether a local service answers, whether a secret FILE exists (its contents are never read), and
// whether the policy has been written. Steps run only from a fixed set (register an MCP server, write the policy); the values
// come from the connector's `connect` block after they passed validation, and are passed as arguments, never spliced into a shell line.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadConnectors } from '../../../packages/tools/src/connector.mjs';
import { real, httpProbe } from './probes.mjs';
import { toWslPath } from './doctor.mjs';
import { redact } from './redact.mjs';

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_');
const PATHFIX = 'export PATH="$HOME/.local/bin:$PATH"';

// one WSL call gathers everything that lives in WSL: the MCP list, program presence, GitHub sign-in, secret files
export const STATUS_SCRIPT = `${PATHFIX}
echo '#mcp'; claude mcp list 2>&1
echo '#bin'; IFS=, read -ra B <<<"$1"; for b in "\${B[@]}"; do [ -n "$b" ] && { command -v "$b" >/dev/null 2>&1 && echo "$b=1" || echo "$b=0"; }; done
echo '#gh'; if command -v gh >/dev/null 2>&1; then gh auth status >/dev/null 2>&1 && echo 1 || echo 0; else echo 0; fi
echo '#omni'; jq -r '.surfaces.anthropic.fast.url // ""' "$HOME/.config/jev-router/config.json" 2>/dev/null | grep -q ':20128' && echo 1 || echo 0
echo '#secrets'; IFS=, read -ra S <<<"$2"; for s in "\${S[@]}"; do [ -n "$s" ] && { [ -f "$HOME/.agent-stack/secrets/$s" ] && echo "$s=1" || echo "$s=0"; }; done`;

export function parseMcpList(stdout) {
  const out = [];
  for (const line of String(stdout).split(/\r?\n/)) {
    const m = /^(.*): (\S*)(?: \((HTTP|SSE|stdio)\))? - (.+)$/.exec(line.trim());
    if (!m) continue;
    const s = m[4], status = /Connected/.test(s) ? 'connected' : /Needs authentication/i.test(s) ? 'needs-auth' : /Not configured/i.test(s) ? 'not-configured' : /Fail|error/i.test(s) ? 'failed' : 'unknown';
    out.push({ name: m[1], url: m[2] || null, transport: m[3] ?? null, status });
  }
  return out;
}

const parseSections = (stdout) => { const sec = {}; let cur = null; for (const l of String(stdout).split(/\r?\n/)) { const h = /^#(\w+)$/.exec(l); if (h) { cur = h[1]; sec[cur] = []; } else if (cur) sec[cur].push(l); } return sec; };
const flags = (lines) => Object.fromEntries(lines.filter((l) => l.includes('=')).map((l) => l.split('=')).map(([k, v]) => [k, v.trim() === '1']));

const STATUS_TEXT = { 'not-set-up': 'Not set up', 'needs-sign-in': 'Needs sign-in', connected: 'Connected', active: 'In use', failed: 'Not working' };

/** Pure: connector files + what we observed -> what the screen shows. */
export function buildView(connectors, obs) {
  const list = obs.mcp ?? [], bins = obs.bins ?? {}, secrets = obs.secrets ?? {}, progress = obs.progress ?? {}, policyServers = new Set(obs.policyServers ?? []);
  const act = new Map((obs.activity ?? []).map((a) => [a.server, a]));
  return connectors.map((c) => {
    const k = c.connect, server = k.server ? norm(k.server) : null, entry = k.server ? list.find((x) => x.name === k.server) : null;
    let status;
    if (k.type.startsWith('mcp-')) status = !entry || entry.status === 'not-configured' ? 'not-set-up' : entry.status === 'connected' ? 'connected' : entry.status === 'needs-auth' ? 'needs-sign-in' : 'failed';
    else if (k.type === 'cli') status = !bins[k.binary] ? 'not-set-up' : k.authCheck && !obs.ghAuth ? 'needs-sign-in' : 'connected';
    else status = obs.health?.[c.id] ? 'connected' : 'failed';
    const a = server ? act.get(server) : null;
    if (status === 'connected' && a?.calls24h) status = 'active';
    const steps = c.steps.map((s) => {
      let state = 'todo';
      if (s.kind === 'info') state = 'info';
      else if (s.kind === 'action') state = s.do === 'register-mcp' ? (entry && entry.status !== 'not-configured' ? 'done' : 'todo') : s.do === 'wire-omniroute' ? (obs.omniWired ? 'done' : 'todo') : (policyServers.has(server) ? 'done' : 'todo');
      else if (s.kind === 'check') state = ({ 'mcp-status': status === 'connected' || status === 'active', binary: bins[k.binary], 'gh-auth': obs.ghAuth, health: obs.health?.[c.id], 'secret-file': secrets[s.secret], 'policy-synced': policyServers.has(server), 'omniroute-wired': obs.omniWired })[s.check] ? 'done' : 'todo';
      else if (s.kind === 'manual') state = progress[s.id] || (s.id === 'sign-in' && (status === 'connected' || status === 'active')) ? 'done' : 'todo';
      return { id: s.id, kind: s.kind, title: s.title, text: s.text ?? '', link: s.link ?? null, do: s.do ?? null, check: s.check ?? null, confirmThirdParty: s.do === 'register-mcp' && k.type === 'mcp-stdio', state };
    });
    const current = steps.find((s) => s.state === 'todo')?.id ?? null;
    return { id: c.id, name: c.name, category: c.category, summary: c.summary, website: c.website ?? null, roles: c.roles ?? [], type: k.type, status, statusText: STATUS_TEXT[status],
      thirdPartyCode: k.type === 'mcp-stdio' ? k.package : null, policy: c.policy ?? null, steps, currentStep: current, activity: a ? { calls24h: a.calls24h, blocked24h: a.blocked24h, errors24h: a.errors24h ?? 0, lastAt: a.lastAt } : { calls24h: 0, blocked24h: 0, errors24h: 0, lastAt: null } };
  });
}

export function createConnectors({ repo, settings, audit, appDir, exec = real.exec, fetch = real.fetch, getTools = () => null }) {
  const pfile = join(appDir, 'connector-progress.json');
  const loadProgress = () => { try { return JSON.parse(readFileSync(pfile, 'utf8')); } catch { return {}; } };
  const wsl = (script, ...args) => exec('wsl.exe', ['-d', settings.distro, '--exec', 'bash', '-c', script, '_', ...args], { timeout: 60000, maxBuffer: 4 * 1024 * 1024 });

  async function read() {
    const { connectors, problems } = loadConnectors(repo), progress = loadProgress();
    const bins = [...new Set(connectors.filter((c) => c.connect.type === 'cli').map((c) => c.connect.binary))];
    const secretNames = [...new Set(connectors.flatMap((c) => c.steps.filter((s) => s.check === 'secret-file').map((s) => s.secret)))];
    const out = await wsl(STATUS_SCRIPT, bins.join(','), secretNames.join(',')).then((r) => r.stdout, () => null);
    const sec = out ? parseSections(out) : {}, mcp = parseMcpList((sec.mcp ?? []).join('\n'));
    const health = {};
    await Promise.all(connectors.filter((c) => c.connect.type === 'local-service').map(async (c) => { health[c.id] = (await httpProbe(c.connect.health, { fetch })).ok; }));
    const tools = getTools();
    const obs = { mcp, bins: flags(sec.bin ?? []), ghAuth: (sec.gh ?? [])[0]?.trim() === '1', omniWired: (sec.omni ?? [])[0]?.trim() === '1', secrets: flags(sec.secrets ?? []), health, progress,
      policyServers: (tools?.integrations ?? []).map((i) => i.server), activity: (tools?.integrations ?? []).map((i) => ({ server: i.server, calls24h: i.calls24h, blocked24h: i.blocked24h, errors24h: i.errors24h, lastAt: i.lastAt })) };
    const known = new Set(connectors.filter((c) => c.connect.server).map((c) => c.connect.server));
    const found = mcp.filter((m) => !known.has(m.name) && m.status !== 'not-configured').map((m) => ({ name: m.name, url: m.url, status: m.status, activity: (tools?.unlisted ?? []).find((u) => u.server === norm(m.name))?.calls24h ?? 0 }));
    return { reachable: Boolean(out), connectors: buildView(connectors, obs), found, problems, checkedAt: new Date().toISOString() };
  }

  /** op: 'run' (an action step), 'confirm' (a manual step the person says they did), 'undo-confirm'. */
  async function run({ id, step, op, confirmThirdParty }) {
    const { connectors } = loadConnectors(repo), c = connectors.find((x) => x.id === id);
    if (!c) return { status: 404, error: 'Unknown tool.' };
    const s = c.steps.find((x) => x.id === step);
    if (!s) return { status: 404, error: 'Unknown step.' };
    if (op === 'confirm' || op === 'undo-confirm') {
      if (s.kind !== 'manual') return { status: 400, error: 'Only steps you do yourself can be ticked off; the others are checked automatically.' };
      const p = loadProgress(); p[s.id] = op === 'confirm' ? new Date().toISOString() : undefined; if (op !== 'confirm') delete p[s.id];
      mkdirSync(appDir, { recursive: true }); writeFileSync(pfile, JSON.stringify(p, null, 1));
      audit?.add({ service: 'connector', action: `${op}:${c.id}:${s.id}`, ok: true }); return { status: 200, ok: true };
    }
    if (op !== 'run' || s.kind !== 'action') return { status: 400, error: 'That step does not run anything.' };
    const k = c.connect, t0 = Date.now(); let output = null;
    try {
      if (s.do === 'register-mcp') {
        if (k.type === 'mcp-http') await wsl(`${PATHFIX}; exec claude mcp add --transport http --scope user "$@"`, k.server, k.url);
        else if (k.type === 'mcp-stdio') {
          if (confirmThirdParty !== true) return { status: 409, error: `This downloads and runs ${k.package} from npm on your computer. Confirm to continue.`, needsConfirm: true };
          const script = `${PATHFIX}
name=$1; pkg=$2; shift 2; envs=()
while [ $# -gt 0 ] && [ "$1" != "--" ]; do envs+=(-e "$1=$(cat "$HOME/.agent-stack/secrets/$1")"); shift; done
shift; exec claude mcp add --scope user "$name" "\${envs[@]}" -- npx -y "$pkg" "$@"`;
          await wsl(script, k.server, k.package, ...(k.env ?? []), '--', ...(k.args ?? []));
        } else return { status: 400, error: 'This tool is not an MCP server.' };
      } else if (s.do === 'wire-omniroute') {
        const r = await exec('wsl.exe', ['-d', settings.distro, '--exec', 'bash', '-c', 'bash "$1/wsl/46-omniroute-wire.sh" 2>&1', '_', toWslPath(repo)], { timeout: 120000, maxBuffer: 1024 * 1024 });
        output = redact(String(r.stdout)).slice(-700);
      } else if (s.do === 'sync-policy') {
        await wsl('source ~/.nvm/nvm.sh >/dev/null 2>&1; cd "$1" && node apps/cli/stack.mjs integrations sync', toWslPath(repo));
      }
      audit?.add({ service: 'connector', action: `${s.do}:${c.id}`, ok: true, ms: Date.now() - t0 });
      return { status: 200, ok: true, ...(output ? { output } : {}) };
    } catch (e) {
      const msg = redact(String(e.stdout || e.stderr || e.message)).replace(/\s+/g, ' ').slice(0, 300);
      audit?.add({ service: 'connector', action: `${s.do}:${c.id}`, ok: false, error: msg, ms: Date.now() - t0 });
      return { status: 502, error: msg || 'The step failed.' };
    }
  }
  return { read, run };
}
