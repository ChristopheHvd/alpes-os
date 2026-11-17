import fs from 'node:fs';
import path from 'node:path';

// Meetings recorded with the phone and archived by Alpes Vocal in kDrive
// (ALPES IA/Réunions/<folder>/Compte rendu.md) that the curator has not taken yet.
// The curator collects them itself (REUNIONS section of its skill); this only tells
// the automatic pass that there is something to integrate. Wispr Flow meetings are
// skipped: they come through the meetings run above.
export function pendingReunions(dir, queueDir) {
  let folders;
  try { folders = fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory() && !d.name.startsWith('.')); }
  catch { return []; }
  const taken = name => ['', 'processing', 'archive'].some(sub => fs.existsSync(path.join(queueDir, sub, name)));
  return folders.map(d => d.name).filter(name => {
    if (taken(`reunion-${name}.md`)) return false;
    let report;
    try { report = fs.readFileSync(path.join(dir, name, 'Compte rendu.md'), 'utf8'); } catch { return false; }
    return report.trim() !== '' && !report.includes('- Source : Wispr Flow');
  });
}
