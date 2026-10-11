// stack tools / stack integrations (M4). Kept apart from the reconciler commands: these never touch Paperclip.
import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRunner } from '../../packages/tools/src/runner.mjs';

const MAX_GRANT_MIN = 1440;
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_');
const readJson = (f, d) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return d; } };

export async function run({ argv, state, repo, log, die }) {
  try { return await dispatch({ argv, state, repo, log, die }); } catch (e) { if (e?.name === 'RunnerError' || e?.name === 'SandboxError') return die(e.message); throw e; }
}

async function dispatch({ argv, state, repo, log, die }) {
  const [group, sub, ...rest] = argv;
  const opts = (name) => argv.flatMap((a, i) => (a === `--${name}` ? [argv[i + 1]] : []));
  const positional = rest.filter((a, i) => !a.startsWith('--') && !(rest[i - 1] ?? '').startsWith('--'));

  if (group === 'tools') {
    const runner = createRunner({ dir: join(state, 'tools'), toolsDir: join(repo, 'tools'), onEvent: (e) => { try { mkdirSync(join(state, 'tools'), { recursive: true }); writeFileSync(join(state, 'tools', 'events.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...e }) + '\n', { flag: 'a' }); } catch { /* audit is best effort here; the run journal is the record */ } } });
    if (sub === 'list') {
      for (const d of readdirSync(join(repo, 'tools'))) { if (!existsSync(join(repo, 'tools', d, 'tool.json'))) continue; try { const m = runner.manifestOf(d); log(`${m.id}  ${m.version}  ${m.title}  (${m.effects.writes ? 'changes files: plan, confirm, undo' : 'read only'})`); } catch (e) { log(`${d}: ${e.message}`); } }
      return;
    }
    if (sub === 'plan') {
      const tool = positional[0], roots = opts('root'); if (!tool || !roots.length) die('usage: stack tools plan <tool> --root <folder> [--root <folder>]');
      const p = await runner.plan({ tool, roots });
      if (argv.includes('--json')) return log(JSON.stringify(p, null, 2));
      const moves = p.ops.filter((o) => o.op === 'move');
      log(`plan ${p.id} for ${tool}: ${moves.length} file${moves.length === 1 ? '' : 's'} to move, ${p.ops.length - moves.length} folder${p.ops.length - moves.length === 1 ? '' : 's'} to create. Nothing has been changed.`);
      for (const o of p.ops.slice(0, 40)) log(o.op === 'move' ? `  move  ${o.from}\n    to  ${o.to}` : `  make  ${o.path}`);
      if (p.ops.length > 40) log(`  ... and ${p.ops.length - 40} more (use --json for all)`);
      return log(`\nTo run it:  stack tools apply ${p.id} --confirm ${p.hash}\nTo undo it: stack tools undo ${p.id}`);
    }
    if (sub === 'apply') {
      const id = positional[0], confirm = opts('confirm')[0]; if (!id) die('usage: stack tools apply <plan id> --confirm <code from the plan>');
      const r = await runner.execute({ planId: id, confirm }); log(r.ok ? `done: ${r.done} operations. Undo with: stack tools undo ${id}` : `stopped after ${r.done} of ${r.total}: ${r.error}\n${r.hint}`); if (!r.ok) process.exitCode = 1; return;
    }
    if (sub === 'undo') {
      const id = positional[0]; if (!id) die('usage: stack tools undo <run id>');
      const r = await runner.undo({ id }); log(`restored ${r.restored} file${r.restored === 1 ? '' : 's'}.`); for (const s of r.skipped) log(`  skipped ${s.path}: ${s.reason}`); if (!r.ok) process.exitCode = 1; return;
    }
    return die('usage: stack tools list | plan <tool> --root <folder> | apply <plan> --confirm <code> | undo <run>');
  }

  if (group === 'integrations') {
    const dir = join(repo, 'integrations'), pf = join(state, 'integrations.json'), gf = join(state, 'grants.json');
    if (sub === 'sync') {
      const integrations = {};
      for (const f of existsSync(dir) ? readdirSync(dir).filter((x) => x.endsWith('.json')) : []) {
        const j = readJson(join(dir, f), null); if (!j || j.schemaVersion !== 1 || j.kind !== 'mcp' || !j.server?.name) { log(`skipped ${f}: not a valid integration`); continue; }
        const tp = j.toolPolicy && typeof j.toolPolicy === 'object' ? j.toolPolicy : { '*': 'ask' };
        for (const [k, v] of Object.entries(tp)) if (!['allow', 'ask', 'off'].includes(v)) die(`${f}: "${k}" must be allow, ask or off`);
        integrations[norm(j.server.name)] = { id: j.id, toolPolicy: tp };
      }
      mkdirSync(state, { recursive: true }); writeFileSync(pf, JSON.stringify({ schemaVersion: 1, integrations }, null, 2));
      return log(`integrations policy written for ${Object.keys(integrations).join(', ') || 'no integrations'}: ${pf}`);
    }
    if (sub === 'list') {
      const p = readJson(pf, null); if (!p) return log('no policy yet. Run: stack integrations sync');
      for (const [s, v] of Object.entries(p.integrations)) log(`${s}: ${Object.entries(v.toolPolicy).map(([t, a]) => `${t}=${a}`).join(', ')}`);
      const g = (readJson(gf, { grants: [] }).grants ?? []).filter((x) => Date.parse(x.until) > Date.now());
      return log(g.length ? `active grants: ${g.map((x) => `${x.tool} until ${x.until}`).join('; ')}` : 'no active grants');
    }
    if (sub === 'grant' || sub === 'revoke') {
      const p = readJson(pf, null); if (!p) die('no policy yet. Run: stack integrations sync');
      let grants = (readJson(gf, { grants: [] }).grants ?? []).filter((x) => Date.parse(x.until) > Date.now());
      if (sub === 'revoke' && argv.includes('--all')) grants = [];
      else {
        const [server, tool] = positional; if (!server || !tool) die(`usage: stack integrations ${sub} <server> <tool>${sub === 'grant' ? ' [--minutes 60]' : ''}`);
        const name = `mcp__${norm(server)}__${tool}`;
        if (sub === 'revoke') grants = grants.filter((x) => x.tool !== name);
        else {
          const integ = Object.hasOwn(p.integrations, norm(server)) ? p.integrations[norm(server)] : null, tp = integ?.toolPolicy ?? {};
          if ((Object.hasOwn(tp, tool) ? tp[tool] : tp['*']) === 'off') die(`${name} is switched off in the policy; change the policy file instead of granting.`);
          const mins = Math.min(MAX_GRANT_MIN, Math.max(1, Number(opts('minutes')[0]) || 60));
          grants = [...grants.filter((x) => x.tool !== name), { tool: name, until: new Date(Date.now() + mins * 60000).toISOString(), at: new Date().toISOString() }];
          log(`granted ${name} for ${mins} minutes`);
        }
      }
      mkdirSync(state, { recursive: true }); writeFileSync(gf, JSON.stringify({ grants }, null, 2)); return;
    }
    return die('usage: stack integrations sync | list | grant <server> <tool> [--minutes n] | revoke <server> <tool>|--all');
  }
}
