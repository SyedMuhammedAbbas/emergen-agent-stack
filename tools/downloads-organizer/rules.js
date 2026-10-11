// First matching rule wins; the order matters (topic rules before the generic file-type ones).
// The first block mirrors how the existing Downloads folder was organized.
export const RULES = [
  ['_Credentials', /^(firebase-service-account|gogi-ai-).*\.json$|^server_access_key|client_secret.*\.json$/i],
  ['Qualifi', /plusvibe|(^|[^a-z])ghl([^a-z]|$)|gohighlevel|n8n/i],
  ['3D Models', /\.(glb|gltf|fbx|obj|blend)$|^blenderkit|^safety-vest/i],
  ['Installers', /\.(exe|dll|msi|dmg|pkg|apk)$/i],
  ['Twill Press', /twill|theme_export__twillpress|GildanBrands|^Client Quoting|^Development Cost|^Milestone_4|^Service[_ ]Offerings|^Offers\.docx/i],
  ['Identity and Legal', /cnic|^Rent_Agreement|^Conveyance|^nazimabad|^Proof of Income|^Resolution|Signatories|Trustees|Foreign Donation|^Undertaking|^ValiAsr|^ELO-NDA|Contract 2025|^user-agreement/i],
  ['Finance', /estatement|^SI-80574305|^screencapture-basescan|invoice|receipt/i],
  ['Study and Applications', /^BS_Computer|^BSCS_|^StudyPrerequisites|^Antragsformular|^Pr.fergebnis|^Options - Abbas|^Gmail - 6344|TH K.ln|Europass|^Profile\.pdf/i],
  ['Work Docs', /^Workforce Management|^PROJECT SCOPE|^Tech_Stack|Sekai|^Feedback\.pdf|^Ali Team|^action_items/i],
  // generic, by file type
  ['Recordings', /\.(mp4|mov|mkv|webm|avi)$/i],
  ['Audio', /\.(mp3|wav|m4a|opus|flac|ogg)$/i],
  ['Images and Logos', /\.(png|jpe?g|webp|svg|ico|gif|heic|avif)$/i],
  ['Archives', /\.(zip|rar|7z|tar|gz|tgz)$/i],
  ['Documents', /\.(pdf|docx?|xlsx?|pptx?|txt|csv|odt|md|rtf)$/i],
  ['Code and Data', /\.(json|js|ts|py|html|xml|ya?ml|sql|log)$/i],
]

/** Folder for a file name, or 'Misc'. */
export function folderFor(name) {
  for (const [folder, re] of RULES) if (re.test(name)) return folder
  return 'Misc'
}

/** Windows-safe version of a name: no characters Chrome would reject. */
export const safe = name => name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
