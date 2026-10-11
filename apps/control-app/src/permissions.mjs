// Changing what agents may do with a tool, from the Tools screen. Runs `stack integrations set|unset|grant|revoke` in WSL with
// validated names as separate arguments (never spliced into a shell line). The hook (wsl/hooks/mcp-policy.mjs) enforces the result.
import { real } from './probes.mjs';
import { toWslPath } from './doctor.mjs';

const SERVER = /^[a-z0-9_]{1,40}$/, TOOL = /^(\*|[A-Za-z0-9_.-]{1,60})$/;
const SCRIPT = 'source ~/.nvm/nvm.sh >/dev/null 2>&1; cd "$1" || exit 1; shift; exec node apps/cli/stack.mjs "$@"';

/** @returns {{ok:true,args:string[]}|{ok:false,error:string}} */
export function argsFor({ server, tool, action, minutes }) {
  if (!SERVER.test(String(server))) return { ok: false, error: 'Unknown tool.' };
  if (!TOOL.test(String(tool))) return { ok: false, error: 'That is not a tool name.' };
  if (['allow', 'ask', 'off'].includes(action)) return { ok: true, args: ['integrations', 'set', server, tool, action] };
  if (action === 'default') return { ok: true, args: ['integrations', 'unset', server, tool] };
  if (action === 'revoke') return tool === '*' ? { ok: false, error: 'Pick a tool.' } : { ok: true, args: ['integrations', 'revoke', server, tool] };
  if (action === 'allow-for') {
    const m = Number(minutes);
    if (tool === '*') return { ok: false, error: 'A temporary approval is for one named tool.' };
    if (!Number.isInteger(m) || m < 1 || m > 1440) return { ok: false, error: 'Choose between 1 minute and 24 hours.' };
    return { ok: true, args: ['integrations', 'grant', server, tool, '--minutes', String(m)] };
  }
  return { ok: false, error: 'Unknown choice.' };
}

export function createPermissions({ repo, settings, audit, exec = real.exec }) {
  return {
    async run(req) {
      const a = argsFor(req); if (!a.ok) return { status: 400, error: a.error };
      try {
        await exec('wsl.exe', ['-d', settings.distro, '--exec', 'bash', '-c', SCRIPT, '_', toWslPath(repo), ...a.args], { timeout: 30000 });
        audit?.add({ service: 'tools', action: `${a.args[1]}:${req.server}:${req.tool}${req.action === 'allow-for' ? `:${req.minutes}m` : req.action && ['allow', 'ask', 'off'].includes(req.action) ? `:${req.action}` : ''}`, ok: true });
        return { status: 200, ok: true };
      } catch (e) {
        audit?.add({ service: 'tools', action: `${a.args[1]}:${req.server}:${req.tool}`, ok: false, error: String(e.stderr || e.message).slice(0, 200) });
        return { status: 502, error: 'That change could not be saved.' };
      }
    },
  };
}
