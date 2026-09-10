// Long-running projects, read straight from brain/projects/ in the second brain.
// The dashboard shows and edits three frontmatter fields — stage, next, updated —
// and never becomes the source of truth: the markdown file stays the record.
import fs from 'node:fs';
import path from 'node:path';

const STAGES = ['actif', 'incubation', 'pause', 'terminé'];
const FM = /^---\n([\s\S]*?)\n---/;

const field = (fm, key) => fm.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))?.[1].trim().replace(/^["']|["']$/g, '') ?? '';

function parse(abs, root) {
  const txt = fs.readFileSync(abs, 'utf8');
  const fm = txt.match(FM)?.[1] ?? '';
  const id = path.relative(root, abs);
  const tags = fm.match(/^tags:\s*\[(.*)\]/m)?.[1] ?? '';
  // "# Prochaines étapes" as a bullet list, when the note carries one
  const steps = txt.match(/^#+\s*Prochaines? étapes?\s*$([\s\S]*?)(?=^#|\Z)/m)?.[1] ?? '';
  return {
    id,
    slug: path.basename(id, '.md'),
    title: field(fm, 'title') || path.basename(id, '.md'),
    description: field(fm, 'description'),
    status: field(fm, 'status'),
    stage: field(fm, 'stage') || 'actif',
    next: field(fm, 'next'),
    updated: field(fm, 'updated'),
    tags: tags.split(',').map(t => t.trim()).filter(Boolean),
    steps: [...steps.matchAll(/^\s*-\s+(.*)$/gm)].map(m => m[1].trim()).slice(0, 6),
    mtime: fs.statSync(abs).mtimeMs,
  };
}

export function listProjects(secondBrain) {
  const dir = path.join(secondBrain, 'brain', 'projects');
  if (!fs.existsSync(dir)) return [];
  // most recently reviewed first — what moved last is what matters today
  const seen = p => (p.updated ? Date.parse(p.updated + 'T00:00:00') : 0) || p.mtime;
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.md') && f !== 'index.md')
    .map(f => parse(path.join(dir, f), secondBrain))
    .sort((a, b) => seen(b) - seen(a));
}

// Writes stage / next / updated back into the note's frontmatter, creating the
// keys if the note predates the convention. Nothing else in the file is touched.
export function updateProject(secondBrain, slug, patch) {
  const abs = path.join(secondBrain, 'brain', 'projects', `${slug}.md`);
  if (!fs.existsSync(abs) || !path.resolve(abs).startsWith(path.resolve(secondBrain))) return null;
  let txt = fs.readFileSync(abs, 'utf8');
  const m = txt.match(FM);
  if (!m) return null;
  let fm = m[1];
  const set = (key, value) => {
    const v = String(value).replace(/\n/g, ' ').trim();
    if (new RegExp(`^${key}:`, 'm').test(fm)) fm = fm.replace(new RegExp(`^${key}:.*$`, 'm'), `${key}: ${v}`);
    else fm = fm.replace(/^status:.*$/m, l => `${l}\n${key}: ${v}`);
  };
  if (patch.stage && STAGES.includes(patch.stage)) set('stage', patch.stage);
  if (patch.next !== undefined) set('next', patch.next);
  set('updated', new Date().toISOString().slice(0, 10));
  txt = txt.replace(FM, `---\n${fm}\n---`);
  fs.writeFileSync(abs, txt);
  return parse(abs, secondBrain);
}

// AGENTS.md of the second brain spells out the update flow for a new concept:
// write the file, link it from the domain index.md, add a line to log.md. A file
// without the index link is unreachable — it hangs off nothing in the graph.
function linkInIndex(dir, slug, title, desc) {
  const file = path.join(dir, 'index.md');
  if (!fs.existsSync(file)) return;
  let txt = fs.readFileSync(file, 'utf8');
  if (txt.includes(`(${slug}.md)`)) return;               // already there
  const short = String(desc ?? '').split(/[.\n]/)[0].trim().slice(0, 100);
  const bullet = `* [${title}](${slug}.md)${short ? ` - ${short}` : ''}`;
  const lines = txt.replace(/\s+$/, '').split('\n');
  let last = -1;
  for (let i = 0; i < lines.length; i++) if (/^[*-]\s+\[.+\]\(.+\.md\)/.test(lines[i])) last = i;
  if (last >= 0) lines.splice(last + 1, 0, bullet); else lines.push('', bullet);
  fs.writeFileSync(file, lines.join('\n') + '\n');
}

// A dated entry at the top of log.md. Same-day entries get a (2), (3)… suffix,
// newest first, right under the title.
function noteInLog(secondBrain, line) {
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

// Creating a project note follows the OKF shape the second brain already uses:
// frontmatter first, then the sections the /standup skill reads back.
export function createProject(secondBrain, { title, description = '', stage = 'actif', next = '', tags = [], body = '' }) {
  const clean = String(title ?? '').trim();
  if (!clean) throw new Error('titre requis');
  const slug = clean.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  if (!slug) throw new Error('titre inexploitable');

  const dir = path.join(secondBrain, 'brain', 'projects');
  const abs = path.join(dir, `${slug}.md`);
  if (fs.existsSync(abs)) throw new Error(`le projet ${slug} existe déjà`);

  const today = new Date().toISOString().slice(0, 10);
  const allTags = [...new Set(['project', ...tags.map(t => String(t).trim()).filter(Boolean)])];
  const doc = `---
type: Project
title: ${clean}
description: ${description || clean}
tags: [${allTags.join(', ')}]
status: draft
stage: ${STAGES.includes(stage) ? stage : 'actif'}
next: ${next}
updated: ${today}
generated: { by: alpes-os/chat, at: ${new Date().toISOString()} }
---

# Objectif

${body || description || 'À préciser.'}

# Prochaines étapes

${next ? `- ${next}` : '- À définir'}
`;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(abs, doc);
  // The file is written; wiring it in is best-effort — a missing index or log
  // shouldn't sink the whole creation.
  try { linkInIndex(dir, slug, clean, description || body); } catch { /* index optional */ }
  try { noteInLog(secondBrain, `* **Add**: \`brain/projects/${slug}.md\` — ${clean}.${next ? ` Prochaine étape : ${next}` : ''}`); } catch { /* log optional */ }
  return parse(abs, secondBrain);
}

export { STAGES };
