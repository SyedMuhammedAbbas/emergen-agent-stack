#!/usr/bin/env node
// stack: reconcile the org (org/ + config.env) with Paperclip without overwriting what people changed.
//   stack render                       write the desired state (runs wsl/41-render.sh)
//   stack plan   [--json] [--only k]   what would change; read-only
//   stack adopt  [--take-template]     tag existing Paperclip agents as managed (live values are kept by default)
//   stack apply  --yes [--only k] [--keep-live|--take-template]
//   stack rollback [journal-id|latest] undo one apply from its journal
//   stack doctor                       check the Paperclip server against what the reconciler was built for
// Options: --api <origin> (default $STACK_API or http://127.0.0.1:3100)  --state <dir> (default ~/.agent-stack)
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { Paperclip } from '../../packages/adapter-paperclip/src/client.mjs';
import { desiredAgents } from '../../packages/reconciler/src/desired.mjs';
import { planAll, matchLive } from '../../packages/reconciler/src/plan.mjs';
import { applyPlan, rollback, Journal, takeLock } from '../../packages/reconciler/src/apply.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const state = opt('state', process.env.AGENT_STACK_STATE ?? join(homedir(), '.agent-stack'));
const api = opt('api', process.env.STACK_API ?? 'http://127.0.0.1:3100');
const only = opt('only');
const resolve = flag('take-template') ? 'take-template' : flag('keep-live') ? 'keep-live' : 'ask';
const log = (s) => console.log(s);
const die = (s, code = 1) => { console.error(`stack: ${s}`); process.exit(code); };

async function load() {
  const dd = join(state, 'desired');
  if (!existsSync(join(dd, 'org.json'))) die(`no desired state in ${dd}. Run: stack render`);
  const org = JSON.parse(readFileSync(join(dd, 'org.json'), 'utf8')), settings = JSON.parse(readFileSync(join(dd, 'settings.json'), 'utf8'));
  const instr = Object.fromEntries(readdirSync(join(dd, 'agents')).filter((f) => f.endsWith('.md')).map((f) => [f.slice(0, -3), readFileSync(join(dd, 'agents', f), 'utf8')]));
  const desired = desiredAgents(org, instr, settings);
  const idsFile = join(state, 'ids.json'), ids = existsSync(idsFile) ? JSON.parse(readFileSync(idsFile, 'utf8')) : {};
  const pc = new Paperclip(api);
  try { await pc.health(); } catch (e) { die(`cannot reach Paperclip at ${api} (${e.cause?.code ?? e.message}). Is it running?`); }
  const cid = ids.company ?? (await pc.companies()).find((c) => c.name === settings.companyName)?.id;
  if (!cid) die(`company "${settings.companyName}" not found in Paperclip; run install.ps1 -OnlyOrg once to create it`);
  const ctx = await pc.context(cid, ids, Object.fromEntries(desired.map((d) => [d.name, d.key])));
  const liveList = await pc.readAll(ctx);
  return { pc, cid, desired, ids, idsFile, ctx, liveList, settings };
}

function describe(f) {
  const short = (v) => (v === undefined ? '-' : typeof v === 'string' ? (v.length > 50 ? `${v.split('\n').length} lines` : JSON.stringify(v)) : JSON.stringify(v).slice(0, 60));
  return f.op === 'update' ? `${f.field}` : `${f.field} [${f.op}: live ${short(f.from)} vs template ${short(f.to)}]`;
}

function printPlan(plan, json) {
  if (json) return log(JSON.stringify(plan, null, 2));
  for (const a of plan.agents) {
    const shown = a.fields.filter((f) => f.op !== 'noop' && f.op !== 'record');
    const tag = { create: 'create', noop: 'ok', record: shown.length ? 'keep' : 'adopt', update: 'update', 'needs-decision': 'DECIDE' }[a.action] ?? a.action;
    const kept = shown.filter((f) => f.op === 'keep-live').map((f) => f.field);
    const rest = shown.filter((f) => f.op !== 'keep-live').map(describe);
    log(`  ${tag.padEnd(7)} ${a.key.padEnd(18)} ${[...rest, ...(kept.length ? [`keeping live edits: ${kept.join(', ')}`] : [])].join('; ')}`);
  }
  log(`\n${Object.entries(plan.counts).map(([k, v]) => `${v} ${k}`).join(', ')}`);
}

const filterOnly = (plan) => (only ? { ...plan, agents: plan.agents.filter((a) => a.key === only) } : plan);

async function main() {
  if (!cmd || cmd === 'help' || flag('help')) return log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 12).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));

  if (cmd === 'render') { execFileSync('bash', [join(repo, 'wsl', '41-render.sh')], { stdio: 'inherit' }); return; }

  if (cmd === 'doctor') {
    const pc = new Paperclip(api), lock = JSON.parse(readFileSync(join(repo, 'services.lock.json'), 'utf8'));
    const h = await pc.health().catch((e) => die(`cannot reach Paperclip at ${api}: ${e.message}`));
    let bad = 0; const check = (ok, msg) => { log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) bad++; };
    check(h.version === lock.paperclip, `Paperclip version ${h.version} (reconciler tested with ${lock.paperclip})`);
    const spec = await (await fetch(`${api.replace(/\/$/, '')}/api/openapi.json`)).json();
    const need = { '/api/agents/{id}': ['get', 'patch'], '/api/agents/{id}/instructions-bundle/file': ['get', 'put'], '/api/agents/{id}/skills': ['get'],
      '/api/agents/{id}/skills/sync': ['post'], '/api/companies/{companyId}/agents': ['get', 'post'], '/api/companies/{companyId}/skills': ['get'] };
    for (const [p, ms] of Object.entries(need)) for (const m of ms) check(Boolean(spec.paths?.[p]?.[m]), `${m.toUpperCase()} ${p}`);
    const patch = JSON.stringify(spec.paths?.['/api/agents/{id}']?.patch ?? {});
    for (const f of ['metadata', 'adapterConfig', 'runtimeConfig', 'reportsTo', 'budgetMonthlyCents']) check(patch.includes(`"${f}"`), `PATCH /agents/{id} accepts ${f}`);
    const put = JSON.stringify(spec.paths?.['/api/agents/{id}/instructions-bundle/file']?.put ?? {});
    check(put.includes('baseRevisionId'), 'instruction PUT takes baseRevisionId');
    if (bad) die(`${bad} check(s) failed: the Paperclip API changed; do not apply until the adapter is updated`, 2);
    return log('contract ok');
  }

  if (cmd === 'plan' || cmd === 'adopt' || cmd === 'apply') {
    const { pc, cid, desired, ids, idsFile, ctx, liveList, settings } = await load();
    const adopting = cmd === 'adopt';
    const r = adopting ? (resolve === 'ask' ? 'keep-live' : resolve) : resolve;      // adoption keeps what is live unless told otherwise
    let plan = planAll(desired, liveList, ids, { resolve: r });
    if (adopting) plan = { ...plan, agents: plan.agents.filter((a) => a.action !== 'create' && !liveList.find((l) => l.id === a.id)?.stack) };
    plan = filterOnly(plan);
    if (cmd === 'plan') return printPlan(plan, flag('json'));

    if (adopting) {
      if (!plan.agents.length) return log('nothing to adopt: every matched agent is already managed');
      printPlan(plan, false);
    } else printPlan(plan, false);
    const writes = plan.agents.some((a) => a.action === 'create' || a.fields.some((f) => f.op === 'update'));
    if (!flag('yes')) return log(writes || adopting ? '\nNothing was changed. Re-run with --yes to apply.' : '');
    if (plan.agents.some((a) => a.action === 'needs-decision')) log('\nAgents marked DECIDE are skipped. Choose with --keep-live or --take-template (or --only <key>).');

    const live = matchLive(desired, liveList, ids);
    const dir = join(state, 'journal', new Date().toISOString().replace(/[:.]/g, '-'));
    const release = takeLock(join(state, 'lock'));
    try {
      const journal = new Journal(dir);
      journal.add({ t: 'start', cmd, api, tpl: settings.tpl });
      const res = await applyPlan({ pc, cid, desired, live, plan, ctx, journal, tpl: settings.tpl, log });
      for (const d of desired) { const id = live.get(d.key)?.id ?? res.createdIds[d.key]; if (id) ids[d.key] = id; }   // keep ids.json (used by Hermes) in step
      ids.company = cid; writeFileSync(idsFile, JSON.stringify(ids, null, 2));
      log(`\n${res.created.length} created, ${res.wrote.length} updated, ${res.recorded.length} recorded, ${res.skipped.length} skipped. Journal: ${dir}`);
    } catch (e) {
      console.error(`\nstack: stopped: ${e.message}\nJournal: ${dir}\nUndo what was written so far with: stack rollback ${dir.split(/[\\/]/).pop()}`);
      process.exitCode = 1;
    } finally { release(); }
    return;
  }

  if (cmd === 'rollback') {
    const jdir = join(state, 'journal'), which = argv[1] && !argv[1].startsWith('--') ? argv[1] : 'latest';
    const names = existsSync(jdir) ? readdirSync(jdir).filter((n) => !existsSync(join(jdir, n, 'ROLLED_BACK'))).sort() : [];
    const pick = which === 'latest' ? names.at(-1) : which;
    if (!pick) die('no journal to roll back');
    const { pc, cid, ctx } = await load();
    const release = takeLock(join(state, 'lock'));
    try { const { warnings } = await rollback({ pc, cid, dir: join(jdir, pick), ctx, log }); warnings.forEach((w) => log(`warning: ${w}`)); log(`rolled back ${pick}`); }
    finally { release(); }
    return;
  }
  die(`unknown command "${cmd}". Try: stack help`);
}
main().catch((e) => die(e.stack ?? e.message));
