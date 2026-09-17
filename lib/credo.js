import fs from 'node:fs';

// config/credo.md: "# Section" headings, then one statement per bullet or paragraph.
export function readCredo(file) {
  if (!fs.existsSync(file)) return [];
  const out = [];
  let section = '';
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    const h = line.match(/^#+\s+(.+)$/);
    if (h) { section = h[1]; continue; }
    const text = line.replace(/^[-*]\s+/, '');
    if (text) out.push({ section, text });
  }
  return out;
}

// Same order for a given day and slot, so reopening the panel shows the same picks first.
export function shuffleForDay(items, seed) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const rand = () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)) >>> 0) / 4294967296;
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
