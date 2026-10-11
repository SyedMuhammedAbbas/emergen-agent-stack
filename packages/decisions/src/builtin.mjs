// Built-in decisions: where each lives (definition file, labelled-data loader, rule baseline).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Parses the cleanup move logs ("result","bucket","name") into labelled examples: name -> folder. */
export function movedCsv(text) {
  const rows = text.replace(/^﻿/, '').split(/\r?\n/).slice(1).filter(Boolean);
  const out = [];
  for (const l of rows) { const c = (l.match(/"((?:[^"]|"")*)"/g) ?? []).map((x) => x.slice(1, -1).replace(/""/g, '"')); if (c.length >= 3 && c[0] === 'moved') out.push({ input: { name: c[2] }, label: c[1] }); }
  return out;
}
export const LOADERS = { 'moved-csv': (file) => movedCsv(readFileSync(file, 'utf8')) };

export async function loadBuiltins(repo) {
  const rules = await import(pathToFileURL(join(repo, 'tools', 'downloads-organizer', 'rules.js')).href);
  return {
    definitions: [JSON.parse(readFileSync(join(repo, 'decisions', 'downloads-folder.json'), 'utf8'))],
    baselines: { 'downloads-folder': ({ name }) => rules.folderFor(String(name)) },
    rules,
  };
}
