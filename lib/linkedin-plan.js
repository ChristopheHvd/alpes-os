// LinkedIn editorial plans, read from brain/references/plan-linkedin-AAAA-MM.md in the
// second brain. The frontmatter carries one line per post — what the dashboard tracks —
// and each "### Jxx · …" section is the brief, plus the final text once prepared:
//
//   posts:
//     - { id: J01, date: 2026-10-01, statut: a_produire }
//     - { id: J02, date: 2026-10-02, statut: publie, publie_le: 2026-10-02, url: "https://…" }
//
// statut: a_produire · prepare (text and visual generated, to review) · publie ·
// abandonne · a_verifier (LinkedIn's answer was ambiguous, check before retrying)
import fs from 'node:fs';
import path from 'node:path';
import { bundle } from './sbqueue.js';

export const STATUTS = ['a_produire', 'prepare', 'publie', 'abandonne', 'a_verifier'];
const DONE = ['publie', 'abandonne', 'a_verifier'];
const FM = /^---\n([\s\S]*?)\n---/;
const BLOCK = /^posts:[ \t]*\n((?:[ \t]+-[ \t]*\{.*\}[ \t]*\n?)*)/m;
const PLAN_FILE = /^plan-linkedin-(\d{4}-\d{2})\.md$/;
const VISUAL_EXT = ['png', 'jpg', 'jpeg', 'pdf', 'mp4', 'mov'];
const SECTIONS = { texte: '#### Texte final', commentaire: '#### Premier commentaire' };

const plansDir = root => path.join(root, 'brain', 'references');
export const planFile = (root, plan) => path.join(plansDir(root), `plan-linkedin-${plan}.md`);

export const addDays = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 864e5);
export const localToday = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// what the brief's "Visuel" column asks for: Claude renders the first kind on its own,
// the others need Christophe (a photo, a capture, a video, an image from ChatGPT)
export function visualKind(label) {
  const l = String(label).toLowerCase();
  if (/carrousel|schéma|infographie|carte chiffre/.test(l)) return 'auto';
  if (/image ia/.test(l)) return 'image-ia';
  if (/capture/.test(l)) return 'capture';
  if (/photo/.test(l)) return 'photo';
  if (/vidéo/.test(l)) return 'video';
  return 'autre';
}

function parseItem(src) {
  const out = {};
  for (const m of src.matchAll(/(\w+):\s*("(?:[^"\\]|\\.)*"|[^,}]*)/g)) {
    const raw = m[2].trim();
    out[m[1]] = raw.startsWith('"') ? JSON.parse(raw) : raw;
  }
  return {
    id: String(out.id ?? ''),
    date: /^\d{4}-\d{2}-\d{2}$/.test(out.date ?? '') ? out.date : '',
    statut: STATUTS.includes(out.statut) ? out.statut : 'a_produire',
    prepare_le: String(out.prepare_le ?? ''), publie_le: String(out.publie_le ?? ''), url: String(out.url ?? ''),
  };
}

const lineOf = p => `  - { id: ${p.id}, date: ${p.date}, statut: ${p.statut}${['prepare_le', 'publie_le', 'url'].map(k => p[k] ? `, ${k}: ${JSON.stringify(p[k])}` : '').join('')} }`;

// "### J07 · mercredi 7 octobre · MOFU · Projet" up to the next "### " or "## "
function sectionRange(lines, id) {
  const start = lines.findIndex(l => l.startsWith(`### ${id} `));
  if (start === -1) return null;
  let end = lines.findIndex((l, i) => i > start && /^#{2,3}\s/.test(l));
  if (end === -1) end = lines.length;
  return [start, end];
}

// "- **Label** : value" with its indented continuation lines; blockquotes lose their "> "
function parseFields(lines) {
  const fields = [];
  let cur = null;
  for (const l of lines) {
    const m = l.match(/^- \*\*(.+?)\*\*\s*:\s*(.*)$/);
    if (m) { cur = { label: m[1], text: m[2] }; fields.push(cur); continue; }
    if (cur && /^\s+\S/.test(l)) cur.text += '\n' + l.replace(/^\s{2}/, '').replace(/^\s*> ?/, '');
    else if (l.trim()) cur = null;
  }
  return fields.map(f => ({ label: f.label, text: f.text.trim() }));
}

function subsection(lines, heading) {
  const i = lines.findIndex(l => l.trim() === heading);
  if (i === -1) return '';
  let j = lines.findIndex((l, k) => k > i && /^####\s/.test(l));
  if (j === -1) j = lines.length;
  return lines.slice(i + 1, j).join('\n').trim();
}

export function parsePlan(txt, plan) {
  const fm = txt.match(FM)?.[1] ?? '';
  const block = (fm + '\n').match(BLOCK)?.[1] ?? '';
  const lines = txt.split('\n');
  const table = {};
  for (const m of txt.matchAll(/^\| (J\d+) \| [^|]* \| ([^|]*) \| ([^|]*) \| ([^|]*) \| ([^|]*) \|\s*$/gm)) {
    table[m[1]] = { etape: m[2].trim(), pilier: m[3].trim(), sujet: m[4].trim(), visuel: m[5].trim() };
  }
  return [...block.matchAll(/\{(.*)\}/g)].map(m => parseItem(m[1])).filter(p => p.id).map(p => {
    const range = sectionRange(lines, p.id);
    const sec = range ? lines.slice(range[0] + 1, range[1]) : [];
    const cut = sec.findIndex(l => /^####\s/.test(l));
    const t = table[p.id] ?? {};
    return {
      ...p, plan,
      header: range ? lines[range[0]].replace(/^###\s*/, '') : p.id,
      etape: t.etape ?? '', pilier: t.pilier ?? '', sujet: t.sujet ?? '', visuel: t.visuel ?? '',
      visualKind: visualKind(t.visuel ?? ''),
      fields: parseFields(cut === -1 ? sec : sec.slice(0, cut)),
      texte: subsection(sec, SECTIONS.texte),
      commentaire: subsection(sec, SECTIONS.commentaire),
    };
  });
}

// Missed posts slide: every post not yet out keeps its order and takes the next free
// day from today on — never earlier than planned, and not today if one went out today.
export function schedule(posts, today) {
  const sorted = [...posts].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  let cursor = sorted.some(p => p.statut === 'publie' && p.publie_le === today) ? addDays(today, 1) : today;
  return sorted.map(p => {
    if (DONE.includes(p.statut)) return { ...p, effective: p.publie_le || p.date, shift: 0 };
    const effective = p.date > cursor ? p.date : cursor;
    cursor = addDays(effective, 1);
    return { ...p, effective, shift: daysBetween(p.date, effective) };
  });
}

export function visualFor(drive, visualsDir, plan, id) {
  if (!drive) return null;
  const dir = path.join(drive, visualsDir, plan);
  if (!fs.existsSync(dir)) return null;
  const f = fs.readdirSync(dir).find(n => VISUAL_EXT.includes(path.extname(n).slice(1).toLowerCase()) && path.basename(n, path.extname(n)) === id);
  if (!f) return null;
  const abs = path.join(dir, f);
  return { abs, rel: path.relative(path.dirname(drive), abs), name: f, ext: path.extname(f).slice(1).toLowerCase(), mtime: fs.statSync(abs).mtimeMs };
}

export function listPlans(root) {
  return bundle.list(plansDir(root)).map(f => f.match(PLAN_FILE)?.[1]).filter(Boolean).sort();
}

export function loadLinkedin(root, { drive = '', visualsDir = '03.COMMUNICATION/LinkedIn', today = localToday() } = {}) {
  const posts = listPlans(root).flatMap(plan => parsePlan(bundle.read(planFile(root, plan)), plan));
  const all = schedule(posts, today).map(p => {
    const v = visualFor(drive, visualsDir, p.plan, p.id);
    return { ...p, visual: v && { rel: v.rel, name: v.name, ext: v.ext, mtime: v.mtime } };
  });
  const active = all.filter(p => !DONE.includes(p.statut));
  return {
    today,
    posts: all,
    todayPost: active.find(p => p.effective === today) ?? null,
    next: active.find(p => p.effective > today) ?? null,
    // visuals Claude can't make, due within two days and still missing
    toProvide: active.filter(p => p.effective <= addDays(today, 2) && p.visualKind !== 'auto' && !p.visual)
      .map(p => ({ plan: p.plan, id: p.id, effective: p.effective, sujet: p.sujet, visuel: p.visuel })),
  };
}

// one post's frontmatter line and its two final-text subsections, in a single event
export function updatePost(root, plan, id, patch, why = '') {
  const abs = planFile(root, plan);
  if (!/^\d{4}-\d{2}$/.test(plan) || !/^J\d+$/.test(id) || !bundle.exists(abs)) throw new Error('post introuvable');
  let txt = bundle.read(abs);
  const fm = txt.match(FM);
  if (!fm) throw new Error('plan sans frontmatter');
  const block = (fm[1] + '\n').match(BLOCK)?.[1] ?? '';
  const list = [...block.matchAll(/\{(.*)\}/g)].map(m => parseItem(m[1]));
  const p = list.find(x => x.id === id);
  if (!p) throw new Error('post introuvable');
  if (patch.statut !== undefined) { if (!STATUTS.includes(patch.statut)) throw new Error('statut invalide'); p.statut = patch.statut; }
  for (const k of ['prepare_le', 'publie_le', 'url']) if (patch[k] !== undefined) p[k] = String(patch[k]);
  const newBlock = `posts:\n${list.map(lineOf).join('\n')}\n`;
  txt = txt.replace(FM, `---\n${(fm[1] + '\n').replace(BLOCK, newBlock).replace(/\n$/, '')}\n---`);

  if (patch.texte !== undefined || patch.commentaire !== undefined) {
    const lines = txt.split('\n');
    const range = sectionRange(lines, id);
    if (!range) throw new Error(`fiche ${id} introuvable dans le plan`);
    const sec = lines.slice(range[0], range[1]);
    const cut = sec.findIndex((l, i) => i > 0 && /^####\s/.test(l));
    const brief = (cut === -1 ? sec : sec.slice(0, cut)).join('\n').replace(/\s*$/, '');
    const value = k => (patch[k] !== undefined ? String(patch[k]) : subsection(sec, SECTIONS[k])).trim();
    const parts = ['texte', 'commentaire'].map(k => value(k) && `${SECTIONS[k]}\n\n${value(k)}`).filter(Boolean);
    const rebuilt = [brief, ...parts].join('\n\n') + '\n';
    txt = [...lines.slice(0, range[0]), rebuilt, ...lines.slice(range[1])].join('\n');
  }
  bundle.replace(abs, txt, { why: why || `post ${id} du plan LinkedIn ${plan} mis à jour`, subject: `Plan LinkedIn ${plan} — ${id}` });
  return p;
}
