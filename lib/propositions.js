// Tasks someone else suggests for Christophe's day, waiting on his decision: the
// hourly review's ideas today, missions sent from SIMATIS OS later. Kept in output/,
// not in the second brain: only what he accepts becomes a todo item there.
//
// Missions contract: SIMATIS OS will POST /api/propositions { source: 'mission', from, title,
// project, why } and Christophe then decides with the same Ajouter / Plus tard / Ignorer.
// A review task is launched instead: an agent takes it (act 'launch', status 'launched').
//
// type 'finance' (default 'tache') carries the payment to write instead of a task:
// echeance { note, client, libelle, montant, date, statut }, accepted into brain/finance.
import fs from 'node:fs';
import path from 'node:path';

export const SOURCES = ['revue', 'mission'];
export const TYPES = ['tache', 'finance'];
const ACTS = { accept: 'accepted', later: 'later', dismiss: 'dismissed', launch: 'launched' };
const KEEP_DECIDED = 300;
const str = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
// "Relancer Marc." and "relancer marc" are the same suggestion
export const same = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
// one payment per client, amount and month
export const moneyKey = e => `${e.client}|${Number(e.montant)}|${String(e.date).slice(0, 7)}`;

function cleanEcheance(e = {}) {
  const out = {
    note: str(e.note, 80), client: str(e.client, 80), libelle: str(e.libelle, 160),
    montant: Math.round(Number(String(e.montant ?? '').replace(',', '.').replace(/\s/g, '')) * 100) / 100,
    date: str(e.date, 10), statut: e.statut === 'devis' ? 'devis' : 'a_encaisser',
  };
  if (!out.client || !out.libelle || !(out.montant > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(out.date)) throw new Error('échéance incomplète : client, libellé, montant et date (AAAA-MM-JJ) requis');
  return out;
}

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

  // a suggestion already waiting, turned down or given to an agent comes back as the existing one
  function add({ source, from = '', title, project = '', why = '', type = 'tache', echeance }) {
    if (!SOURCES.includes(source)) throw new Error(`source inconnue (${SOURCES.join(' ou ')})`);
    if (!TYPES.includes(type)) throw new Error(`type inconnu (${TYPES.join(' ou ')})`);
    const t = str(title, 200);
    if (!t) throw new Error('titre requis');
    const money = type === 'finance' ? cleanEcheance(echeance) : null;
    const known = items.find(p => ['pending', 'dismissed', 'launched'].includes(p.status)
      && (same(p.title) === same(t) || (money && p.type === 'finance' && moneyKey(p.echeance) === moneyKey(money))));
    if (known) return known;
    const p = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      source, from: str(from, 80) || (source === 'revue' ? 'Revue horaire' : ''),
      title: t, project: str(project, 120), why: str(why, 300), type, ...(money ? { echeance: money } : {}),
      createdAt: new Date().toISOString(), status: 'pending',
    };
    items.push(p);
    save();
    return p;
  }

  function decide(id, act, title) {
    const p = items.find(x => x.id === id);
    if (!p) throw Object.assign(new Error('proposition introuvable'), { status: 404 });
    if (!ACTS[act]) throw new Error('action inconnue (accept, later, dismiss ou launch)');
    if (p.status !== 'pending') throw Object.assign(new Error('proposition déjà traitée'), { status: 409 });
    if (['later', 'launch'].includes(act) && p.type === 'finance') throw new Error("une rentrée d'argent s'ajoute aux finances ou s'ignore");
    const t = str(title, 200);
    if (t) p.title = t;
    p.status = ACTS[act];
    p.decidedAt = new Date().toISOString();
    save();
    return p;
  }

  // review suggestions only make sense for the day they were made, and while what
  // they are about still runs (`stale`); missions wait
  function expire(before, stale = () => false) {
    const n = items.length;
    items = items.filter(p => !(p.status === 'pending' && p.source === 'revue' && (p.createdAt < before || stale(p))));
    if (items.length !== n) save();
  }

  return {
    add, decide, expire,
    pending: () => byStatus('pending'),
    dismissed: () => byStatus('dismissed'),
    launched: () => byStatus('launched'),
    get: id => items.find(p => p.id === id) ?? null,
  };
}
