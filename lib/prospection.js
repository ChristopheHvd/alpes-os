// Prospection: targets, the companies found for each, and the people never to contact.
// This is AlpesOS's own working data (output/prospection/), not knowledge: a target is
// a file, its companies live inside it, and nothing is ever deleted, only set aside.
import fs from 'node:fs';
import path from 'node:path';
import * as annuaire from './annuaire.js';
import * as cp from './campagne.js';

export const ETATS = ['retenue', 'a_trier', 'ecartee'];
const lienOk = v => { const l = String(v ?? '').trim().slice(0, 300); if (l && !/^https?:\/\//i.test(l)) throw new Error('le lien doit commencer par http:// ou https://'); return l; };
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


// What the web research found for one company, merged into its record. The best address
// wins: a named person's, then the company's generic one, then a guessed one. A guessed
// address is never mailed until a verification says it exists (see campaigns).
const RANG = { nominatif: 0, generique: 1, deduit: 2 };
const ADDR = /^[^\s@<>,;]+@[^\s@<>,;]+\.[a-z]{2,}$/i;
const LINKEDIN = /^https?:\/\/([a-z]{2,3}\.)?linkedin\.com\/in\/[^/?#\s]+/i;
export function appliquerRecherche(e, r, now = new Date()) {
  const contact = { ...(e.contact ?? {}) }, sources = { ...(e.sources ?? {}) };
  const mails = (r.emails ?? []).filter(m => ADDR.test(String(m.adresse).trim()) && m.type in RANG)
    .map(m => ({ ...m, adresse: String(m.adresse).trim().toLowerCase() })).sort((a, b) => RANG[a.type] - RANG[b.type]);
  if (mails[0] && (!contact.email || RANG[mails[0].type] < RANG[contact.email_type ?? 'deduit'] || contact.email_type === 'deduit')) {
    contact.email = mails[0].adresse; contact.email_type = mails[0].type; sources.email = clean(mails[0].source, 120) || 'recherche web';
  }
  contact.autres_emails = mails.slice(1).map(m => m.adresse).slice(0, 3);
  if (r.site && /^https?:\/\//.test(r.site)) contact.site = r.site.trim();
  if (r.telephone && /\d{2}/.test(r.telephone) && !contact.telephone) { contact.telephone = clean(r.telephone, 30); sources.telephone = contact.site ? 'site de l\'entreprise' : 'recherche web'; }
  const li = r.linkedin?.url?.match(LINKEDIN)?.[0];
  if (li && r.linkedin.confiance) { contact.linkedin = li.replace(/^http:/, 'https:'); contact.linkedin_confiance = r.linkedin.confiance; sources.linkedin = 'recherche web'; }
  const web = (r.signaux ?? []).filter(x => x.quoi).map(x => ({ quoi: clean(x.quoi, 120), date: /^\d{4}-\d{2}(-\d{2})?$/.test(x.date) ? x.date : '', source: 'web', url: /^https?:\/\//.test(x.url) ? x.url : '' }));
  const signaux = [...(e.signaux ?? []).filter(x => x.source === 'BODACC'), ...web].slice(0, 8);
  return { ...e, contact: { ...contact, recherche_le: now.toISOString(), notes: clean(r.notes, 300) }, sources, signaux };
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
      offre: clean(offre, 200), lien: lienOk(lien), criteres: cr, statut: 'active', cree_le: now().toISOString(),
      recherche: null, entreprises: [], campagne: null,
    });
  }
  function modifier(slug, patch) {
    return mutate(slug, c => {
      if (patch.titre !== undefined) { const t = clean(patch.titre, 80); if (t) c.titre = t; }
      for (const k of ['pourquoi', 'offre']) if (patch[k] !== undefined) c[k] = clean(patch[k], k === 'pourquoi' ? 400 : 300);
      if (patch.lien !== undefined) c.lien = lienOk(patch.lien);
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
    if (ctx.partenaire.has(norm(ent.nom)) || (ent.enseigne && ctx.partenaire.has(norm(ent.enseigne)))) return ['ecartee', 'connue de Marc (CRM partagé)'];
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
            if (etat !== 'retenue' && merged.prospect?.statut === 'en_sequence') merged.prospect = { ...merged.prospect, statut: 'exclu' };
            return { ...merged, etat, raison, manuel: prev?.manuel ?? false, trouvee_le: prev?.trouvee_le ?? now().toISOString() };
          });
          // a company the new criteria no longer match stays, set aside, with what was known
          for (const [siren, e] of old) if (!c.entreprises.some(x => x.siren === siren)) c.entreprises.push({ ...e, etat: 'ecartee', raison: 'hors des nouveaux critères', ...(e.prospect?.statut === 'en_sequence' ? { prospect: { ...e.prospect, statut: 'exclu' } } : {}) });
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


  // Web research for the kept companies not yet researched, a few at a time, in the
  // background. Progress is written in the target, like the search.
  const enrichissant = new Map();
  function enrichir(slug, chercherUne, { sirens = null, limite = 60, parallele = 2 } = {}) {
    if (enrichissant.has(slug)) return enrichissant.get(slug);
    const c0 = get(slug);
    const todo = c0.entreprises.filter(e => (sirens ? sirens.includes(e.siren) : e.etat === 'retenue' && !e.contact?.recherche_le)).slice(0, limite);
    if (!todo.length) throw new Error('aucune entreprise à chercher');
    mutate(slug, c => { c.enrichissement = { etat: 'en_cours', fait: 0, total: todo.length, debut: now().toISOString() }; });
    const job = (async () => {
      const queue = [...todo];
      let fait = 0, erreurs = 0;
      const worker = async () => {
        for (let e = queue.shift(); e; e = queue.shift()) {
          try {
            const r = await chercherUne(e, c0);
            mutate(slug, c => { const i = c.entreprises.findIndex(x => x.siren === e.siren); if (i >= 0) c.entreprises[i] = appliquerRecherche(c.entreprises[i], r, now()); });
          } catch { erreurs++; }
          fait++;
          try { mutate(slug, c => { c.enrichissement = { ...c.enrichissement, fait, erreurs }; }); } catch { /* next one */ }
        }
      };
      try {
        await Promise.all(Array.from({ length: Math.min(parallele, todo.length) }, worker));
        mutate(slug, c => { c.enrichissement = { ...c.enrichissement, etat: 'fini', fin: now().toISOString() }; });
      } catch (err) {
        try { mutate(slug, c => { c.enrichissement = { ...c.enrichissement, etat: 'erreur', erreur: err.message.slice(0, 200) }; }); } catch { /* target unreadable */ }
      } finally { enrichissant.delete(slug); }
    })();
    enrichissant.set(slug, job);
    return job;
  }

  function choisir(slug, siren, etat, raison = '') {
    if (!ETATS.includes(etat)) throw new Error('état inconnu');
    return mutate(slug, c => {
      const e = c.entreprises.find(x => x.siren === siren);
      if (!e) throw new Error('entreprise introuvable');
      Object.assign(e, { etat, raison: etat === 'retenue' ? '' : clean(raison, 200) || (etat === 'ecartee' ? 'écartée à la main' : e.raison), manuel: true });
      if (etat !== 'retenue' && e.prospect?.statut === 'en_sequence') e.prospect.statut = 'exclu';
      return e;
    });
  }


  // ---- campaign (one per target) ----
  const campagneDe = c => { if (!c.campagne) throw new Error("cette cible n'a pas encore de campagne"); return c.campagne; };
  function preparerCampagne(slug, list = cp.etapesParDefaut()) {
    return mutate(slug, c => {
      if (c.campagne?.etat === 'en_cours') throw new Error('la campagne tourne déjà : mets-la en pause pour la changer');
      c.campagne = { ...(c.campagne ?? {}), etat: c.campagne?.etat === 'en_pause' ? 'en_pause' : 'brouillon', etapes: cp.etapes(list), par_jour: c.campagne?.par_jour ?? 15, waalaxy: c.campagne?.waalaxy ?? null, cree_le: c.campagne?.cree_le ?? now().toISOString() };
      return c.campagne;
    });
  }
  function modifierCampagne(slug, { etapes, par_jour, waalaxy } = {}) {
    return mutate(slug, c => {
      const k = campagneDe(c);
      if (etapes) k.etapes = cp.etapes(etapes);
      if (par_jour !== undefined) k.par_jour = Math.max(1, Math.min(50, Math.round(Number(par_jour) || 15)));
      if (waalaxy !== undefined) k.waalaxy = waalaxy ? { campagne_id: String(waalaxy.campagne_id ?? ''), campagne_nom: clean(waalaxy.campagne_nom, 120), liste_id: String(waalaxy.liste_id ?? ''), liste_nom: clean(waalaxy.liste_nom, 120) } : null;
      return k;
    });
  }
  function personnaliser(slug, messages) {
    return mutate(slug, c => {
      const k = campagneDe(c), first = k.etapes.find(s => s.canal === 'email');
      if (!first) throw new Error('aucune étape e-mail à personnaliser');
      for (const m of messages) {
        const e = c.entreprises.find(x => x.siren === m.siren);
        if (!e || !m.texte) continue;
        e.prospect = { ...(e.prospect ?? {}), perso: { ...(e.prospect?.perso ?? {}), [first.id]: { objet: clean(m.objet, 160), texte: String(m.texte).slice(0, 3000) } } };
      }
      return k;
    });
  }
  // Launch: every participant enters the sequence, so many a day from today (working
  // days only), those with a buying moment first. Prospects already in it keep their date.
  function lancer(slug) {
    return mutate(slug, c => {
      const k = campagneDe(c);
      const vides = k.etapes.filter(x => cp.vide(x));
      if (vides.length) throw new Error(`étape sans texte : ${vides.map(x => x.titre).join(', ')}`);
      const list = cp.participants(c, e => estExclue(e)).filter(e => !e.prospect?.depart)
        .sort((a, b) => (b.signaux?.length ?? 0) - (a.signaux?.length ?? 0));
      if (!list.length && k.etat !== 'en_pause') throw new Error('personne à ajouter : cherche d\'abord les coordonnées des entreprises retenues');
      let d = cp.jour(now()), n = 0;
      const ouvre = iso => { let x = iso; while ([0, 6].includes(new Date(`${x}T12:00:00Z`).getUTCDay())) x = cp.plus(x, 1); return x; };
      d = ouvre(d);
      for (const e of list) {
        if (n && n % k.par_jour === 0) d = ouvre(cp.plus(d, 1));
        e.prospect = { ...(e.prospect ?? {}), statut: 'en_sequence', depart: d, faits: e.prospect?.faits ?? [] };
        n++;
      }
      Object.assign(k, { etat: 'en_cours', lancee_le: k.lancee_le ?? now().toISOString() });
      return { ajoutes: list.length, campagne: k };
    });
  }
  const pause = (slug, on) => mutate(slug, c => { const k = campagneDe(c); if (k.etat === 'brouillon') throw new Error('la campagne n\'est pas lancée'); k.etat = on ? 'en_pause' : 'en_cours'; return k; });
  function noter(slug, siren, fait) {
    return mutate(slug, c => {
      const e = c.entreprises.find(x => x.siren === siren);
      if (!e?.prospect) throw new Error('prospect introuvable');
      e.prospect.faits = [...(e.prospect.faits ?? []), { ...fait, at: now().toISOString() }];
      return e;
    });
  }
  function reporter(slug, siren, etape, date) {
    return mutate(slug, c => {
      const e = c.entreprises.find(x => x.siren === siren);
      if (!e?.prospect) throw new Error('prospect introuvable');
      if (etape === 'relance') { e.prospect.relance = date; return e; }
      e.prospect.reporte = { ...(e.prospect.reporte ?? {}), [etape]: date };
      return e;
    });
  }
  function statut(slug, siren, st, extra = {}) {
    return mutate(slug, c => {
      const e = c.entreprises.find(x => x.siren === siren);
      if (!e) throw new Error('entreprise introuvable');
      e.prospect = { ...(e.prospect ?? { faits: [] }), ...extra, statut: st };
      return e;
    });
  }
  // the calls due today across campaigns
  function appels(today = cp.jour(now())) {
    const fiche = (c, e) => ({ cible: c.slug, cible_titre: c.titre, siren: e.siren, nom: e.enseigne || e.nom, ville: e.ville, dirigeant: e.dirigeants?.[0] ?? null, telephone: e.contact?.telephone, signaux: e.signaux ?? [] });
    return lister().filter(c => c.campagne).flatMap(c => c.entreprises.flatMap(e => [
      ...(c.campagne.etat === 'en_cours' ? cp.aFaire(c, e, today).filter(s => s.canal === 'appel').map(s => ({ ...fiche(c, e), etape: s.id, texte: cp.remplir(s.texte, cp.variables(e, c)) })) : []),
      ...(e.etat === 'retenue' && e.prospect?.relance && e.prospect.relance <= today ? [{ ...fiche(c, e), etape: 'relance', relance: true, texte: e.prospect.relance_note ?? 'Relance prévue' }] : []),
    ]));
  }


  // ---- replies: one record each, kept in the target; any reply ends the sequence ----
  function ajouterReponse(slug, { siren, canal, texte, de = '', nom = '', sujet = '', uid = null, thread = null, messageId = null, date = null }) {
    return mutate(slug, c => {
      c.reponses ??= [];
      if (uid && c.reponses.some(r => r.uid === uid)) return false;
      const e = c.entreprises.find(x => x.siren === siren);
      if (!e) throw new Error('entreprise introuvable');
      const r = { id: `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, siren, canal, texte: String(texte ?? '').slice(0, 4000), de, nom: clean(nom, 120), sujet: clean(sujet, 200), uid, thread, messageId, date: date ?? now().toISOString(), etat: 'a_classer' };
      c.reponses.push(r);
      e.prospect = { ...(e.prospect ?? { faits: [] }), statut: 'repondu', repondu_le: r.date };
      return r;
    });
  }
  function classer(slug, id, cl) {
    return mutate(slug, c => {
      const r = c.reponses?.find(x => x.id === id);
      if (!r) throw new Error('réponse introuvable');
      Object.assign(r, { classe: cl.classe, titre: clean(cl.titre, 80), fait: clean(cl.fait, 300), action: cl.action, question: clean(cl.question, 200), reponse: String(cl.reponse ?? '').slice(0, 3000), relance: /^\d{4}-\d{2}-\d{2}$/.test(cl.relance) ? cl.relance : '', personne: cl.personne?.nom ? cl.personne : null, etat: 'a_traiter' });
      const e = c.entreprises.find(x => x.siren === r.siren);
      // an out-of-office is no reply: the sequence goes on
      if (cl.classe === 'absence') {
        r.etat = 'traitee';
        // the sequence goes on only if nothing real came from this prospect
        const vraie = c.reponses.some(x => x.siren === r.siren && x.id !== r.id && x.classe !== 'absence');
        if (e?.prospect && e.prospect.statut === 'repondu' && !vraie && !e.prospect.interesse && !e.prospect.rdv) { e.prospect.statut = 'en_sequence'; r.auto = 'réponse automatique : la séquence continue'; }
        else r.auto = 'réponse automatique';
      }
      if (cl.classe === 'interesse' && e?.prospect) e.prospect.interesse = true;
      return r;
    });
  }
  function traiter(slug, id, { etat = 'traitee', note = '', reponse } = {}) {
    return mutate(slug, c => {
      const r = c.reponses?.find(x => x.id === id);
      if (!r) throw new Error('réponse introuvable');
      Object.assign(r, { etat, traitee_le: now().toISOString(), ...(note ? { note: clean(note, 300) } : {}), ...(reponse !== undefined ? { reponse_envoyee: String(reponse).slice(0, 3000) } : {}) });
      return r;
    });
  }
  const reponses = () => lister().flatMap(c => (c.reponses ?? []).map(r => {
    const e = c.entreprises.find(x => x.siren === r.siren) ?? {};
    return { ...r, cible: c.slug, cible_titre: c.titre, entreprise: e.enseigne || e.nom, ville: e.ville, dirigeant: e.dirigeants?.[0] ?? null, contact: e.contact ?? {}, tranche: e.tranche, rdv: e.prospect?.rdv ?? null };
  })).sort((a, b) => b.date.localeCompare(a.date));

  // after a restart, a job that was running is not any more
  function reprise() {
    for (const c of lister()) {
      if (c.recherche?.etat !== 'en_cours' && c.enrichissement?.etat !== 'en_cours') continue;
      mutate(c.slug, x => {
        if (x.recherche?.etat === 'en_cours') x.recherche = { ...x.recherche, etat: 'erreur', erreur: 'interrompue par un redémarrage : relance la recherche' };
        if (x.enrichissement?.etat === 'en_cours') x.enrichissement = { ...x.enrichissement, etat: 'erreur', erreur: 'interrompue par un redémarrage' };
      });
    }
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
      connues_marc: c.entreprises.filter(e => e.etat === 'ecartee' && /connue de Marc/.test(e.raison ?? '')).length,
      campagne: c.campagne ? { etat: c.campagne.etat, etapes: c.campagne.etapes.length, prospects: c.entreprises.filter(e => e.prospect?.depart).length, emails: c.entreprises.reduce((n, e) => n + (e.prospect?.faits ?? []).filter(f => f.canal === 'email' && f.status === 'envoye').length, 0), repondu: (c.reponses ?? []).filter(r => r.classe !== 'absence').map(r => r.siren).filter((x, i, a) => a.indexOf(x) === i).length, interesses: c.entreprises.filter(e => e.prospect?.interesse).length, a_traiter: (c.reponses ?? []).filter(r => r.etat === 'a_traiter' || r.etat === 'a_classer').length, rdv: c.entreprises.filter(e => e.prospect?.rdv).length, waalaxy: c.entreprises.filter(e => e.prospect?.waalaxy?.ok).length } : null, modifie_le: c.modifie_le, enrichissement: c.enrichissement ?? null,
      a_chercher: ret.filter(e => !e.contact?.recherche_le).length,
    };
  }

  return { lister, get, creer, modifier, chercher, enCours: slug => running.has(slug), enrichir, choisir, preparerCampagne, modifierCampagne, personnaliser, lancer, pause, noter, reporter, statut, appels, ajouterReponse, classer, traiter, reponses, reprise, resume, mutate, exclusions, exclure, estExclue, file };
}
