// Prospection: targets, the companies found for each, and the people never to contact.
// This is AlpesOS's own working data (output/prospection/), not knowledge: a target is
// a file, its companies live inside it, and nothing is ever deleted, only set aside.
import fs from 'node:fs';
import path from 'node:path';
import * as annuaire from './annuaire.js';

export const ETATS = ['retenue', 'a_trier', 'ecartee'];
export const slugify = s => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'cible';
export const norm = s => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  .replace(/\b(sarl|sas|sasu|eurl|sa|sci|ets|etablissements|entreprise|societe|ste)\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

const clean = (v, max = 400) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const list = (v, re) => [...new Set((Array.isArray(v) ? v : String(v ?? '').split(/[\s,;]+/)).map(x => String(x).trim().toUpperCase()).filter(x => re.test(x)))];
export function criteres(c = {}) {
  return {
    naf: list(c.naf, /^\d{2}\.\d{2}[A-Z]$/),
    departements: list(c.departements, /^(\d{2,3}|2A|2B)$/),
    codes_postaux: list(c.codes_postaux, /^\d{5}$/),
    tranches: list(c.tranches, /^\d{2}$/).filter(t => t in annuaire.TRANCHES),
  };
}

export function makeProspection(dir, { now = () => new Date(), exclusionsOf = () => ({}) } = {}) {
  const file = slug => path.join(dir, 'cibles', `${slug}.json`);
  const exclFile = path.join(dir, 'exclusions.json');
  const readJson = (f, dflt) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return dflt; } };
  const writeJson = (f, data) => {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f + '.tmp', JSON.stringify(data, null, 1));
    fs.renameSync(f + '.tmp', f);
  };
  const get = slug => {
    if (!/^[a-z0-9-]+$/.test(slug)) throw new Error('cible introuvable');
    const c = readJson(file(slug), null);
    if (!c) throw new Error('cible introuvable');
    return c;
  };
  const save = c => { c.modifie_le = now().toISOString(); writeJson(file(c.slug), c); return c; };
  const mutate = (slug, fn) => { const c = get(slug); const out = fn(c); save(c); return out ?? c; };

  // ---- people and companies never to contact (opt-outs, refusals) ----
  const exclusions = () => readJson(exclFile, { entrees: [] }).entrees;
  function exclure({ siren = null, email = null, linkedin = null, nom = '', raison = '' }) {
    const d = readJson(exclFile, { entrees: [] });
    const e = { siren, email: email ? String(email).trim().toLowerCase() : null, linkedin, nom: clean(nom, 120), raison: clean(raison, 200), le: now().toISOString() };
    if (!e.siren && !e.email && !e.linkedin) throw new Error('rien à exclure');
    d.entrees.push(e);
    writeJson(exclFile, d);
    return e;
  }
  const estExclue = (ent, liste = exclusions()) => liste.find(x => (x.siren && x.siren === ent.siren)
    || (x.email && x.email === ent.contact?.email?.toLowerCase()) || (x.linkedin && x.linkedin === ent.contact?.linkedin));

  // ---- targets ----
  function lister() {
    let files = [];
    try { files = fs.readdirSync(path.join(dir, 'cibles')).filter(f => f.endsWith('.json')); } catch { /* none yet */ }
    return files.map(f => readJson(path.join(dir, 'cibles', f), null)).filter(Boolean)
      .sort((a, b) => (b.modifie_le ?? '').localeCompare(a.modifie_le ?? ''));
  }
  function creer({ titre, phrase = '', pourquoi = '', moments = [], offre = '', lien = '', ...c }) {
    const t = clean(titre, 80);
    if (!t) throw new Error('il faut un titre');
    let slug = slugify(t);
    for (let n = 2; fs.existsSync(file(slug)); n++) slug = `${slugify(t)}-${n}`;
    const cr = criteres(c.criteres ?? c);
    if (!cr.naf.length) throw new Error("au moins un code d'activité (ex. 43.32A)");
    if (!cr.departements.length && !cr.codes_postaux.length) throw new Error('au moins un département ou un code postal');
    return save({
      slug, titre: t, phrase: clean(phrase, 500), pourquoi: clean(pourquoi), moments: (moments ?? []).map(m => clean(m, 120)).filter(Boolean).slice(0, 8),
      offre: clean(offre, 200), lien: clean(lien, 300), criteres: cr, statut: 'active', cree_le: now().toISOString(),
      recherche: null, entreprises: [], campagne: null,
    });
  }
  function modifier(slug, patch) {
    return mutate(slug, c => {
      if (patch.titre !== undefined) { const t = clean(patch.titre, 80); if (t) c.titre = t; }
      for (const k of ['pourquoi', 'offre', 'lien']) if (patch[k] !== undefined) c[k] = clean(patch[k], k === 'pourquoi' ? 400 : 300);
      if (patch.moments !== undefined) c.moments = (Array.isArray(patch.moments) ? patch.moments : String(patch.moments).split('\n')).map(m => clean(m, 120)).filter(Boolean).slice(0, 8);
      if (patch.criteres) {
        const cr = criteres({ ...c.criteres, ...patch.criteres });
        if (!cr.naf.length) throw new Error("au moins un code d'activité");
        c.criteres = cr;
      }
      if (patch.statut && ['active', 'archivee'].includes(patch.statut)) c.statut = patch.statut;
    });
  }

  // ---- companies ----
  // Why a company found by the search is not kept as is. Order matters: the first reason wins.
  function trier(ent, ctx) {
    const ex = estExclue(ent, ctx.exclusions);
    if (ex) return ['ecartee', ex.raison || 'a demandé à ne plus être contactée'];
    if (ctx.clients.has(norm(ent.nom))) return ['ecartee', 'déjà client'];
    if (ctx.crm.has(norm(ent.nom))) return ['ecartee', 'déjà dans le CRM'];
    if (ctx.partenaire.has(norm(ent.nom))) return ['ecartee', 'connue de Marc'];
    if (ent.procedure) return ['ecartee', `procédure collective (BODACC, ${ent.procedure.date})`];
    if (ctx.ailleurs.has(ent.siren)) return ['ecartee', `déjà dans la cible ${ctx.ailleurs.get(ent.siren)}`];
    if (!ent.dirigeants.length) return ['a_trier', 'aucun dirigeant nommé'];
    if (!ent.tranche || ent.tranche === 'NN') return ['a_trier', 'effectif inconnu'];
    return ['retenue', ''];
  }
  const contexte = slug => {
    const ex = exclusionsOf() ?? {};
    const ailleurs = new Map();
    for (const c of lister()) if (c.slug !== slug && c.statut !== 'archivee') for (const e of c.entreprises) if (e.etat !== 'ecartee') ailleurs.set(e.siren, c.titre);
    return { exclusions: exclusions(), clients: new Set((ex.clients ?? []).map(norm)), crm: new Set((ex.crm ?? []).map(norm)), partenaire: new Set((ex.partenaire ?? []).map(norm)), ailleurs };
  };

  // The search runs in the background; its progress is written in the target so the
  // screen and the assistant both read it. A new search keeps what was already known
  // about a company (contact found, manual choice) and adds the newcomers.
  const running = new Map();
  function chercher(slug, { onDone = () => {} } = {}) {
    if (running.has(slug)) return running.get(slug);
    const c0 = mutate(slug, c => { c.recherche = { etat: 'en_cours', debut: now().toISOString(), progres: 'annuaire' }; });
    const job = (async () => {
      const step = progres => mutate(slug, c => { c.recherche = { ...c.recherche, progres }; });
      try {
        const res = await annuaire.search(c0.criteres, { onPage: ({ page, pages }) => step(`annuaire ${page}/${pages}`) });
        const ents = res.entreprises;
        for (let i = 0; i < ents.length; i++) {
          const e = ents[i];
          if (!e.dirigeants.length && e.holdings[0]) {
            try { e.dirigeants = await annuaire.holdingPeople(e.holdings[0].siren); e.via_holding = e.holdings[0].nom; } catch { /* keep none */ }
          }
          try { const b = await annuaire.notices(e.siren, now()); e.procedure = b.procedure; e.moments = b.moments; } catch { e.moments = []; }
          if (i % 10 === 9) step(`vérifications ${i + 1}/${ents.length}`);
        }
        const ctx = contexte(slug);
        mutate(slug, c => {
          const old = new Map(c.entreprises.map(e => [e.siren, e]));
          c.entreprises = ents.map(e => {
            const prev = old.get(e.siren);
            const signaux = [...(e.moments ?? []), ...(prev?.signaux ?? []).filter(s => s.source !== 'BODACC')];
            const merged = { ...e, signaux, contact: prev?.contact ?? {}, sources: prev?.sources ?? {}, prospect: prev?.prospect ?? null };
            delete merged.moments;
            const [etat, raison] = prev?.manuel ? [prev.etat, prev.raison] : trier(merged, ctx);
            return { ...merged, etat, raison, manuel: prev?.manuel ?? false, trouvee_le: prev?.trouvee_le ?? now().toISOString() };
          });
          // a company the new criteria no longer match stays, set aside, with what was known
          for (const [siren, e] of old) if (!c.entreprises.some(x => x.siren === siren)) c.entreprises.push({ ...e, etat: 'ecartee', raison: 'hors des nouveaux critères' });
          c.recherche = { etat: 'fini', debut: c.recherche.debut, fin: now().toISOString(), total: res.total, tronque: res.tronque };
        });
        onDone(null, get(slug));
      } catch (e) {
        mutate(slug, c => { c.recherche = { ...c.recherche, etat: 'erreur', erreur: e.message.slice(0, 300) }; });
        onDone(e);
      } finally { running.delete(slug); }
    })();
    running.set(slug, job);
    return job;
  }

  function choisir(slug, siren, etat, raison = '') {
    if (!ETATS.includes(etat)) throw new Error('état inconnu');
    return mutate(slug, c => {
      const e = c.entreprises.find(x => x.siren === siren);
      if (!e) throw new Error('entreprise introuvable');
      Object.assign(e, { etat, raison: etat === 'retenue' ? '' : clean(raison, 200) || (etat === 'ecartee' ? 'écartée à la main' : e.raison), manuel: true });
      return e;
    });
  }

  // what the list and the assistant need, without every company
  function resume(c) {
    const by = etat => c.entreprises.filter(e => e.etat === etat);
    const ret = by('retenue');
    return {
      slug: c.slug, titre: c.titre, statut: c.statut, criteres: c.criteres, offre: c.offre, pourquoi: c.pourquoi,
      recherche: c.recherche, retenues: ret.length, a_trier: by('a_trier').length, ecartees: by('ecartee').length, total: c.entreprises.length,
      avec_email: ret.filter(e => e.contact?.email).length, avec_linkedin: ret.filter(e => e.contact?.linkedin).length, avec_tel: ret.filter(e => e.contact?.telephone).length,
      avec_moment: ret.filter(e => e.signaux?.length).length,
      campagne: c.campagne ? { etat: c.campagne.etat } : null, modifie_le: c.modifie_le,
    };
  }

  return { lister, get, creer, modifier, chercher, enCours: slug => running.has(slug), choisir, resume, mutate, exclusions, exclure, estExclue, file };
}
