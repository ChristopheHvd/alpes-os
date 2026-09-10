// Long-running projects, read straight from brain/projects/ in the second brain.
// The dashboard shows and edits three frontmatter fields — stage, next, updated —
// and never becomes the source of truth: the markdown file stays the record.
import fs from 'node:fs';
import path from 'node:path';
import { slugify, linkInIndex, noteInLog, linkUnderHeading } from './braindoc.js';

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

// Creating a project note follows the OKF shape the second brain already uses:
// frontmatter first, then the sections the /standup skill reads back, plus the
// index link and log line the update flow (braindoc.js) requires. `client` is a
// client slug — when it resolves to a real note, the two link both ways, the way
// Signature App and Signature Com already do.
export function createProject(secondBrain, { title, description = '', stage = 'actif', next = '', tags = [], body = '', client = '' }) {
  const clean = String(title ?? '').trim();
  if (!clean) throw new Error('titre requis');
  const slug = slugify(clean);
  if (!slug) throw new Error('titre inexploitable');

  const dir = path.join(secondBrain, 'brain', 'projects');
  const abs = path.join(dir, `${slug}.md`);
  if (fs.existsSync(abs)) throw new Error(`le projet ${slug} existe déjà`);

  const clientSlug = client ? slugify(client) : '';
  const clientFile = clientSlug ? path.join(secondBrain, 'brain', 'clients', `${clientSlug}.md`) : '';
  const clientOk = !!clientFile && fs.existsSync(clientFile);
  const clientTitle = clientOk
    ? (fs.readFileSync(clientFile, 'utf8').match(/^title:\s*(.+)$/m)?.[1].trim() || clientSlug)
    : '';
  const clientTag = clientOk ? clientSlug.split('-').slice(-1)[0] : '';

  const today = new Date().toISOString().slice(0, 10);
  const allTags = [...new Set(['project', ...(clientTag ? [clientTag] : []), ...tags.map(t => String(t).trim()).filter(Boolean)])];
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
${clientOk ? `\n# Client\n\n[${clientTitle}](../clients/${clientSlug}.md)\n` : ''}
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
  if (clientOk) try { linkUnderHeading(clientFile, 'Projets', `- [${clean}](../projects/${slug}.md)`); } catch { /* back-link optional */ }

  const out = parse(abs, secondBrain);
  if (client && !clientOk) return { ...out, client_lié: false, note: `aucune fiche client « ${client} » — crée-la d'abord avec creer_client` };
  return out;
}

export { STAGES };
