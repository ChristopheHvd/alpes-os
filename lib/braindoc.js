// The second brain's own update flow (AGENTS.md): a new concept file is not
// enough — it needs a link from its domain index.md and a line in log.md, or it
// hangs off nothing in the graph. Projects and clients both go through here.
import fs from 'node:fs';
import path from 'node:path';

export function slugify(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

// Add "* [Title](slug.md) - short description" after the last bullet of
// <dir>/index.md. No-op if the index is missing or the link is already there.
export function linkInIndex(dir, slug, title, desc) {
  const file = path.join(dir, 'index.md');
  if (!fs.existsSync(file)) return;
  const txt = fs.readFileSync(file, 'utf8');
  if (txt.includes(`(${slug}.md)`)) return;
  const short = String(desc ?? '').split(/[.\n]/)[0].trim().slice(0, 100);
  const bullet = `* [${title}](${slug}.md)${short ? ` - ${short}` : ''}`;
  const lines = txt.replace(/\s+$/, '').split('\n');
  let last = -1;
  for (let i = 0; i < lines.length; i++) if (/^[*-]\s+\[.+\]\(.+\.md\)/.test(lines[i])) last = i;
  if (last >= 0) lines.splice(last + 1, 0, bullet); else lines.push('', bullet);
  fs.writeFileSync(file, lines.join('\n') + '\n');
}

// A dated entry at the top of log.md. Same-day entries get a (2), (3)… suffix,
// newest first, right under the "# …" title.
export function noteInLog(secondBrain, line) {
  const file = path.join(secondBrain, 'log.md');
  if (!fs.existsSync(file)) return;
  const today = new Date().toISOString().slice(0, 10);
  let txt = fs.readFileSync(file, 'utf8');
  const sameDay = [...txt.matchAll(new RegExp(`^## ${today}(?: \\((\\d+)\\))?\\s*$`, 'gm'))];
  const n = sameDay.length ? Math.max(...sameDay.map(m => Number(m[1] || 1))) + 1 : 0;
  const entry = `## ${today}${n ? ` (${n})` : ''}\n${line}\n\n`;
  if (/^# .*\n\n/.test(txt)) txt = txt.replace(/^(# .*\n\n)/, `$1${entry}`);
  else txt = entry + txt;
  fs.writeFileSync(file, txt);
}

// Append a bullet under a "# Heading" of a note, adding the heading at the end
// if the note doesn't have one yet. Used to list a project on its client note.
export function linkUnderHeading(file, heading, bullet) {
  if (!fs.existsSync(file)) return;
  let txt = fs.readFileSync(file, 'utf8').replace(/\s+$/, '');
  if (txt.includes(bullet)) return;
  const re = new RegExp(`^#+\\s*${heading}\\s*$`, 'm');
  if (re.test(txt)) {
    const lines = txt.split('\n');
    const start = lines.findIndex(l => re.test(l));
    let end = start + 1;
    while (end < lines.length && !/^#/.test(lines[end])) end++;
    while (end - 1 > start && !lines[end - 1].trim()) end--;   // trim blank lines in the section
    lines.splice(end, 0, bullet);
    txt = lines.join('\n');
  } else {
    txt += `\n\n# ${heading}\n\n${bullet}`;
  }
  fs.writeFileSync(file, txt + '\n');
}
