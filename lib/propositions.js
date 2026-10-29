// Tasks someone else suggests for Christophe's day, waiting on his decision: the
// hourly review's ideas today, missions sent from SIMATIS OS later. Kept in output/,
// not in the second brain: only what he accepts becomes a todo item there.
//
// Missions contract: SIMATIS OS will POST /api/propositions { source: 'mission', from, title,
// project, why } and Christophe then decides with the same Ajouter / Plus tard / Ignorer.
import fs from 'node:fs';
import path from 'node:path';

export const SOURCES = ['revue', 'mission'];
const ACTS = { accept: 'accepted', later: 'later', dismiss: 'dismissed' };
const KEEP_DECIDED = 300;
const str = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
// "Relancer Marc." and "relancer marc" are the same suggestion
export const same = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function makePropositions(file) {
  let items = [];
  try { items = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* first run */ }
  const save = () => {
    const pending = items.filter(p => p.status === 'pending');
    items = [...pending, ...items.filter(p => p.status !== 'pending').slice(-KEEP_DECIDED)];
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file + '.tmp', JSON.stringify(items, null, 1));
    fs.renameSync(file + '.tmp', file);
  };
  const byStatus = status => items.filter(p => p.status === status);

  // a suggestion already waiting or already turned down comes back as the existing one
  function add({ source, from = '', title, project = '', why = '' }) {
    if (!SOURCES.includes(source)) throw new Error(`source inconnue (${SOURCES.join(' ou ')})`);
    const t = str(title, 200);
    if (!t) throw new Error('titre requis');
    const known = items.find(p => ['pending', 'dismissed'].includes(p.status) && same(p.title) === same(t));
    if (known) return known;
    const p = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      source, from: str(from, 80) || (source === 'revue' ? 'Revue horaire' : ''),
      title: t, project: str(project, 120), why: str(why, 300),
      createdAt: new Date().toISOString(), status: 'pending',
    };
    items.push(p);
    save();
    return p;
  }

  function decide(id, act, title) {
    const p = items.find(x => x.id === id);
    if (!p) throw Object.assign(new Error('proposition introuvable'), { status: 404 });
    if (!ACTS[act]) throw new Error('action inconnue (accept, later ou dismiss)');
    if (p.status !== 'pending') throw Object.assign(new Error('proposition déjà traitée'), { status: 409 });
    const t = str(title, 200);
    if (t) p.title = t;
    p.status = ACTS[act];
    p.decidedAt = new Date().toISOString();
    save();
    return p;
  }

  // review suggestions only make sense for the day they were made; missions wait
  function expire(before) {
    const n = items.length;
    items = items.filter(p => !(p.status === 'pending' && p.source === 'revue' && p.createdAt < before));
    if (items.length !== n) save();
  }

  return {
    add, decide, expire,
    pending: () => byStatus('pending'),
    dismissed: () => byStatus('dismissed'),
    get: id => items.find(p => p.id === id) ?? null,
  };
}
