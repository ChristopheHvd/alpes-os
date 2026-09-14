// Money tracking, read from brain/finance/ in the second brain. Each note may carry
// a structured schedule in its frontmatter — one line per payment — which is what
// the dashboard sums and plots; the prose below stays the human record.
//
//   client: signature-com
//   echeances:
//     - { libelle: "Acompte 30 %", montant: 2100, date: 2026-06-30, statut: encaisse, ref: FAC-2026-007 }
//
// statut: encaisse (cash in) · a_encaisser (signed, expected) · devis (not signed yet)
import path from 'node:path';
import { noteInLog } from './braindoc.js';
import { bundle } from './sbqueue.js';

export const STATUTS = ['encaisse', 'a_encaisser', 'devis'];
const FM = /^---\n([\s\S]*?)\n---/;
const field = (fm, key) => fm.match(new RegExp(`^${key}:[ \\t]*(.+)$`, 'm'))?.[1].trim().replace(/^["']|["']$/g, '') ?? '';
export const links = (txt, kind) => [...txt.matchAll(new RegExp(`\\]\\((?:\\.\\./)?${kind}/([\\w.-]+)\\.md\\)`, 'g'))].map(m => m[1]).filter(s => s !== 'index');
const BLOCK = /^echeances:[ \t]*(?:\[\s*\][ \t]*)?\n((?:[ \t]+-[ \t]*\{.*\}[ \t]*\n?)*)/m;

function parseItem(src) {
  const out = {};
  for (const m of src.matchAll(/(\w+):\s*("(?:[^"\\]|\\.)*"|[^,}]*)/g)) {
    const raw = m[2].trim();
    out[m[1]] = raw.startsWith('"') ? JSON.parse(raw) : raw;
  }
  return {
    libelle: String(out.libelle ?? ''), montant: Number(out.montant) || 0,
    date: /^\d{4}-\d{2}-\d{2}$/.test(out.date ?? '') ? out.date : '',
    statut: STATUTS.includes(out.statut) ? out.statut : 'a_encaisser', ref: String(out.ref ?? ''),
  };
}

const lineOf = e => `  - { libelle: ${JSON.stringify(e.libelle)}, montant: ${e.montant}, date: ${e.date || '""'}, statut: ${e.statut}${e.ref ? `, ref: ${e.ref}` : ''} }`;

function read(abs, root) {
  const txt = bundle.read(abs);
  const fm = txt.match(FM)?.[1] ?? '';
  const block = fm.match(BLOCK)?.[1] ?? '';
  return {
    id: path.relative(root, abs), slug: path.basename(abs, '.md'),
    title: field(fm, 'title') || path.basename(abs, '.md'), type: field(fm, 'type'), description: field(fm, 'description'),
    client: field(fm, 'client'), projet: field(fm, 'projet'),
    projects: links(txt, 'projects'), clients: links(txt, 'clients'),
    echeances: [...block.matchAll(/\{(.*)\}/g)].map(m => parseItem(m[1])),
  };
}

export function listFinance(root) {
  const dir = path.join(root, 'brain', 'finance');
  return bundle.list(dir).filter(f => f.endsWith('.md') && f !== 'index.md').map(f => read(path.join(dir, f), root));
}

function rewrite(root, slug, change, why = () => '') {
  const abs = path.join(root, 'brain', 'finance', `${slug}.md`);
  if (!/^[\w.-]+$/.test(slug) || !bundle.exists(abs)) throw new Error('note finance introuvable');
  const note = read(abs, root);
  const list = change(note.echeances.map(e => ({ ...e })));
  let txt = bundle.read(abs);
  const fm = txt.match(FM);
  if (!fm) throw new Error('note finance sans frontmatter');
  const block = `echeances:\n${list.map(lineOf).join('\n')}\n`;
  const body = BLOCK.test(fm[1] + '\n') ? (fm[1] + '\n').replace(BLOCK, block) : `${fm[1]}\n${block}`;
  txt = txt.replace(FM, `---\n${body.replace(/\n$/, '')}\n---`);
  bundle.replace(abs, txt, { why: why(), subject: `Échéances ${slug}` });
  return read(abs, root);
}

const clean = (e, base = {}) => {
  const out = { ...base };
  if (e.libelle !== undefined) out.libelle = String(e.libelle).replace(/\s+/g, ' ').trim();
  if (e.montant !== undefined) { const n = Number(String(e.montant).replace(',', '.').replace(/\s/g, '')); if (!(n > 0)) throw new Error('montant invalide'); out.montant = Math.round(n * 100) / 100; }
  if (e.date !== undefined) { if (e.date && !/^\d{4}-\d{2}-\d{2}$/.test(e.date)) throw new Error('date invalide (AAAA-MM-JJ)'); out.date = e.date; }
  if (e.statut !== undefined) { if (!STATUTS.includes(e.statut)) throw new Error('statut invalide'); out.statut = e.statut; }
  if (e.ref !== undefined) out.ref = String(e.ref).replace(/[^\w.-]/g, '');
  return out;
};

export function addEcheance(root, slug, e) {
  const item = clean(e, { libelle: '', montant: 0, date: '', statut: 'a_encaisser', ref: '' });
  if (!item.libelle || !item.montant) throw new Error('libellé et montant requis');
  const note = rewrite(root, slug, list => [...list, item], () => `échéance ajoutée : ${item.libelle}, ${item.montant} €, ${item.date || 'sans date'}, ${item.statut}`);
  try { noteInLog(root, `* **Update**: \`brain/finance/${slug}.md\` — échéance ajoutée : ${item.libelle}, ${item.montant} € (${item.statut}).`); } catch { /* log optional */ }
  return note;
}

export function updateEcheance(root, slug, idx, patch) {
  let label = '';
  const note = rewrite(root, slug, list => {
    if (!list[idx]) throw new Error('échéance introuvable');
    list[idx] = clean(patch, list[idx]);
    label = `${list[idx].libelle}, ${list[idx].montant} € → ${list[idx].statut}`;
    return list;
  }, () => `échéance modifiée : ${label}`);
  try { noteInLog(root, `* **Update**: \`brain/finance/${slug}.md\` — ${label}.`); } catch { /* log optional */ }
  return note;
}
