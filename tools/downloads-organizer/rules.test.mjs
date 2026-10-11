import assert from 'node:assert/strict'
import { folderFor, safe } from './rules.js'

const cases = {
  'plusVibe_lead_followup_v35.json': 'Qualifi',
  'helper_list_ghl_stage_ids.json': 'Qualifi',
  'My n8n workflow.json': 'Qualifi',
  'firebase-service-account.json': '_Credentials',
  'hoodie.glb': '3D Models',
  'CursorUserSetup-x64-3.9.16.exe': 'Installers',
  'twillpress-theme-studio-cart-15sep2026.zip': 'Twill Press',
  'Rent_Agreement.pdf': 'Identity and Legal',
  'eStatement(Monthly_3137301000003489).pdf': 'Finance',
  'Syed_Mohammad_Abbas_Europass_CV.pdf': 'Study and Applications',
  'Workforce Management.docx': 'Work Docs',
  'Recording 2026-06-30 032515.mp4': 'Recordings',
  'logo.PNG': 'Images and Logos',
  'something.zip': 'Archives',
  'notes.txt': 'Documents',
  'data.json': 'Code and Data',
  'mystery.xyz': 'Misc',
  'song.mp3': 'Audio',
}
for (const [name, folder] of Object.entries(cases)) assert.equal(folderFor(name), folder, name)
assert.equal(safe('a:b*c?.pdf'), 'a_b_c_.pdf')
// a topic rule must beat the generic file-type rule
assert.equal(folderFor('plusVibe_x.json'), 'Qualifi')
assert.notEqual(folderFor('plusVibe_x.json'), 'Code and Data')
console.log(`ok: ${Object.keys(cases).length} name cases + safe-name + rule order`)
