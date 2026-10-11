// Runs the real watcher against a temp folder: files dropped in must end up in the right subfolder.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dlwatch-'))
const dl = path.join(root, 'Downloads'), qualifi = path.join(root, 'Qualifi-inbox')
fs.mkdirSync(dl)
fs.writeFileSync(path.join(dl, 'leftover-estatement.pdf'), 'x') // present before start: swept at startup
const child = spawn(process.execPath, [path.join(import.meta.dirname, 'watcher.mjs')], { env: { ...process.env, DOWNLOADS_DIR: dl, QUALIFI_DIR: qualifi }, stdio: 'ignore' })
const sleep = ms => new Promise(r => setTimeout(r, ms))
const has = p => fs.existsSync(p)
try {
  await sleep(1500)
  fs.writeFileSync(path.join(dl, 'photo.png'), 'x')
  fs.writeFileSync(path.join(dl, 'plusVibe_lead_followup_v35.json'), '{}')
  fs.writeFileSync(path.join(dl, 'setup.exe.crdownload'), 'half') // browser temp file
  fs.writeFileSync(path.join(dl, 'desktop.ini'), '')
  await sleep(500)
  fs.renameSync(path.join(dl, 'setup.exe.crdownload'), path.join(dl, 'setup.exe')) // browser finishes
  fs.mkdirSync(path.join(dl, 'my-new-folder')) // user folders are left alone
  await sleep(8000)
  assert.ok(has(path.join(dl, 'Finance', 'leftover-estatement.pdf')), 'startup sweep')
  assert.ok(has(path.join(dl, 'Images and Logos', 'photo.png')), 'image')
  assert.ok(has(path.join(qualifi, 'plusVibe_lead_followup_v35.json')), 'Qualifi goes outside Downloads')
  assert.ok(has(path.join(dl, 'Installers', 'setup.exe')), 'temp name ignored, final name organized')
  assert.ok(!has(path.join(dl, 'Installers', 'setup.exe.crdownload')), 'temp file never moved')
  assert.ok(has(path.join(dl, 'desktop.ini')), 'desktop.ini untouched')
  assert.ok(has(path.join(dl, 'my-new-folder')), 'folders untouched')
  fs.writeFileSync(path.join(dl, 'photo.png'), 'second') // same name again -> unique name
  await sleep(6000)
  assert.ok(has(path.join(dl, 'Images and Logos', 'photo (1).png')), 'collision gets a unique name')
  console.log('ok: sweep, images, Qualifi outside Downloads, browser temp name, ignored files, collision')
} finally { child.kill(); fs.rmSync(root, { recursive: true, force: true }) }
