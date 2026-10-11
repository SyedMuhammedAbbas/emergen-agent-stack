// "Needs you" and the headline sentence, derived from the readings. Pure, so it is easy to test.
// Things that are optional and simply not set up (state "off") are NOT counted: they are shown on Services, not nagged about.

/** @returns {{ level:'ok'|'warn'|'fail', text:string }[]} each item: what, and why it matters / what is safe */
export function deriveNeeds({ services, paperclip, diskFreeGB }) {
  const needs = [];
  const by = Object.fromEntries(services.map((s) => [s.id, s]));
  if (by.wsl?.state === 'fail') {
    needs.push({ id: 'wsl', level: 'fail', title: 'WSL is not running', why: 'Paperclip, jev-router and OmniRoute cannot be reached until it starts. Agents are paused; nothing is lost.', hint: 'Open Ubuntu from the Start menu, or run: wsl -d Ubuntu-24.04' });
  } else {
    for (const s of services) {
      if (s.state === 'fail' && !['wsl', 'keepalive'].includes(s.id)) needs.push({ id: s.id, level: 'fail', title: `${s.title} is not running`, why: s.about + '.', hint: 'Start it from Services (coming in the next step), or restart WSL.' });
      else if (s.state === 'warn' && s.id !== 'keepalive') needs.push({ id: s.id, level: 'warn', title: `${s.title} is running but not answering`, why: 'It may be starting or stuck.', hint: 'Give it a minute, then check its log.' });
    }
  }
  if (by.keepalive && by.keepalive.state !== 'ok') needs.push({ id: 'keepalive', level: 'warn', title: 'The keepalive task is not running', why: 'WSL may shut down when you are away and stop your agents.', hint: 'Run .\\windows\\wsl-host.ps1 from your own PowerShell.' });
  if (paperclip?.up === false && by.wsl?.state !== 'fail' && by.paperclip?.state === 'ok') needs.push({ id: 'paperclip-api', level: 'warn', title: 'Paperclip is not answering from Windows', why: paperclip.error ?? '', hint: 'Check localhost:3100 in a browser.' });
  if (paperclip?.up) {
    if (paperclip.approvalsPending > 0) needs.push({ id: 'approvals', level: 'warn', title: `${paperclip.approvalsPending} approval${paperclip.approvalsPending > 1 ? 's' : ''} waiting for you`, why: 'Agents are waiting for a decision.', hint: 'Open Paperclip to approve or reject.' });
    for (const a of (paperclip.crew ?? []).filter((c) => c.mood === 'error')) needs.push({ id: 'agent-' + a.id, level: 'fail', title: `${a.name} is in an error state`, why: 'It stopped after a failed run.', hint: 'Open it in Paperclip to see the log.' });
  }
  if (diskFreeGB != null && diskFreeGB < 15) needs.push({ id: 'disk', level: diskFreeGB < 5 ? 'fail' : 'warn', title: `C: has only ${diskFreeGB} GB free`, why: "WSL's disk lives on C: and goes read-only when it fills up.", hint: 'Free some space (see docs/operations.md).' });
  return needs.sort((a, b) => (a.level === 'fail' ? 0 : 1) - (b.level === 'fail' ? 0 : 1));
}

export function headline(services, needs) {
  const down = services.filter((s) => s.state === 'fail' && s.id !== 'keepalive');
  const stuck = services.filter((s) => s.state === 'warn' && s.id !== 'keepalive');   // running, but not answering
  const wsl = services.find((s) => s.id === 'wsl');
  let text, level = needs.some((n) => n.level === 'fail') ? 'fail' : needs.length ? 'warn' : 'ok';
  if (wsl?.state === 'fail') text = 'WSL is not running, so your agents are stopped.';
  else if (down.length === 1) text = `${down[0].title} has stopped.`;
  else if (down.length > 1) text = `${down.length} services have stopped.`;
  else if (stuck.length === 1) text = `${stuck[0].title} is not answering.`;
  else if (stuck.length > 1) text = `${stuck.length} services are not answering.`;
  else if (needs.some((n) => n.id === 'paperclip-api')) text = 'Paperclip is not answering.';
  else text = 'Everything is running.';
  return { text, level, needCount: needs.length };
}
