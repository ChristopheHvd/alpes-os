// The copy of a partner's sales follow-up, in the agents relay's CRM profile (crm/1). AlpesOS has
// no CRM of its own: SIMATIS OS's model is the reference, and AlpesOS keeps what one connection
// shares in output/crm/<connection>.json, written atomically.
//
// Christophe may change a deal's stage, amount, due date or next step, and add a note, a meeting
// report, a task or a contact. Those changes leave for the partner with the next pass of
// lib/partenaires.js, which compares each record with the state last exchanged (`echange`).
// Nothing is ever deleted on its own: a record the partner deleted is detached, and waits for
// Christophe's answer.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const OBJETS = ['pipeline', 'entreprise', 'contact', 'affaire', 'tache', 'rendez_vous', 'activite'];
export const TYPES_TACHE = ['appel', 'email', 'tache', 'reunion', 'echeance', 'dejeuner'];
const one = (s, max) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const bad = msg => Object.assign(new Error(msg), { status: 400 });
const refs = v => (v == null ? [] : Array.isArray(v) ? v.filter(Boolean) : [v]);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
// a deal is won or lost by its `clos` field, or by sitting in a closing stage of the pipeline
export const issue = (a, etapes) => a.champs.clos ?? (etapes.find(e => e.id === a.champs.etape)?.clos ? (etapes.find(e => e.id === a.champs.etape).gagne ? 'gagne' : 'perdu') : null);

const VIDE = { fiches: {}, echange: {}, notes: [], suppressions: [], passe: {} };

/**
 * @param {object} o
 * @param {string} o.dir output/crm/
 * @param {() => string | null} o.noeud this AlpesOS's node on the relay: the prefix of the records created here
 * @param {(fait: object) => void} [o.marquant] a notable fact (deal won or lost, meeting booked, meeting report)
 */
export function makeSuivi({ dir, noeud, marquant = () => {} }) {
  const cache = new Map();
  const now = () => new Date().toISOString();

  function copie(cx) {
    if (!/^[\w-]+$/.test(cx)) throw bad('connexion invalide');
    if (cache.has(cx)) return cache.get(cx);
    const file = path.join(dir, `${cx}.json`);
    let data;
    try { data = { ...structuredClone(VIDE), ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch { data = structuredClone(VIDE); }
    const c = {
      data,
      save() {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(file + '.tmp', JSON.stringify(data, null, 1));
        fs.renameSync(file + '.tmp', file);
      },
    };
    cache.set(cx, c);
    return c;
  }

  const de = (d, objet) => Object.values(d.fiches).filter(f => f.objet === objet && !f.supprimee);
  const etapesDe = d => de(d, 'pipeline').flatMap(p => (Array.isArray(p.champs.etapes) ? p.champs.etapes : []))
    .filter(e => e && e.id).sort((a, b) => (a.ordre ?? 0) - (b.ordre ?? 0));
  const nomDe = (d, ref) => { const f = d.fiches[ref]; return f && !f.supprimee ? f.champs.nom ?? f.champs.titre ?? null : null; };
  const fiche = (d, ref, objet) => {
    const f = d.fiches[ref];
    if (!f || f.supprimee || (objet && f.objet !== objet)) throw Object.assign(new Error('fiche inconnue'), { status: 404 });
    return f;
  };

  function resume(d, a, etapes) {
    const ent = refs(a.liens?.entreprises)[0];
    return {
      ref: a.ref, titre: a.champs.titre ?? 'Affaire sans titre', etape: a.champs.etape ?? null,
      montant: a.champs.montant ?? null, echeance: a.champs.echeance ?? null, prochaine_etape: a.champs.prochaine_etape ?? null,
      entreprise: ent ? nomDe(d, ent) : null, issue: issue(a, etapes), modifie_le: a.modifie_le ?? null, detachee: a.detachee ?? null,
    };
  }

  // what the page shows: the pipeline and its deals, and what waits on Christophe
  function vue(cx) {
    const d = copie(cx).data, etapes = etapesDe(d);
    return {
      etapes,
      affaires: de(d, 'affaire').map(a => resume(d, a, etapes)).sort((a, b) => String(b.modifie_le).localeCompare(String(a.modifie_le))),
      notes: d.notes.filter(n => !n.vue),
      suppressions: d.suppressions.filter(s => !s.reponse).map(s => ({ ...s, titre: nomDe(d, s.ref) ?? s.titre })),
      fiches: Object.values(d.fiches).filter(f => !f.supprimee).length,
    };
  }

  function affaire(cx, ref) {
    const d = copie(cx).data, a = fiche(d, ref, 'affaire'), etapes = etapesDe(d);
    const vers = (objet, lien) => de(d, objet).filter(f => refs(f.liens?.[lien]).includes(ref));
    const ents = refs(a.liens?.entreprises).map(r => d.fiches[r]).filter(f => f && !f.supprimee);
    const contacts = refs(a.liens?.contacts).map(r => d.fiches[r]).filter(f => f && !f.supprimee);
    const plat = f => ({ ref: f.ref, ...f.champs, modifie_le: f.modifie_le ?? null, detachee: f.detachee ?? null, local: !!f.local });
    return {
      ...resume(d, a, etapes), champs: a.champs, etapes,
      entreprises: ents.map(plat),
      contacts: contacts.map(plat),
      rendez_vous: vers('rendez_vous', 'affaires').map(plat).sort((x, y) => String(y.debut).localeCompare(String(x.debut))),
      taches: vers('tache', 'affaire').map(plat).sort((x, y) => (!!x.fait_at - !!y.fait_at) || String(x.echeance ?? '9').localeCompare(String(y.echeance ?? '9'))),
      activites: vers('activite', 'affaire').map(plat).sort((x, y) => String(y.at).localeCompare(String(x.at))),
    };
  }

  // ------------------------------------------------------------ Christophe's changes

  function toucher(c, f, champs, liens) {
    Object.assign(f.champs, champs);
    if (liens) f.liens = { ...f.liens, ...liens };
    f.modifie_le = now();
    c.save();
  }
  function creer(c, objet, champs, liens) {
    const n = noeud();
    if (!n) throw Object.assign(new Error('relais non configuré'), { status: 409 });
    const f = { objet, ref: `${n}/${crypto.randomUUID()}`, champs, liens, modifie_le: now(), local: true };
    c.data.fiches[f.ref] = f;
    c.save();
    return f;
  }

  function modifierAffaire(cx, ref, { etape, montant, echeance, prochaine_etape } = {}) {
    const c = copie(cx), a = fiche(c.data, ref, 'affaire'), etapes = etapesDe(c.data), champs = {};
    if (etape !== undefined) {
      if (!etapes.some(e => e.id === etape)) throw bad('étape inconnue');
      champs.etape = etape;
    }
    if (montant !== undefined) {
      const m = montant === null || montant === '' ? null : Math.round(Number(String(montant).replace(/\s/g, '').replace(',', '.')));
      if (m !== null && !(Number.isFinite(m) && m >= 0)) throw bad('montant invalide');
      champs.montant = m;
    }
    if (echeance !== undefined) {
      if (echeance && !DATE.test(echeance)) throw bad('échéance attendue au format AAAA-MM-JJ');
      champs.echeance = echeance || null;
    }
    if (prochaine_etape !== undefined) champs.prochaine_etape = one(prochaine_etape, 200) || null;
    const avant = issue(a, etapes);
    const change = Object.fromEntries(Object.entries(champs).filter(([k, v]) => a.champs[k] !== v));
    if (!Object.keys(change).length) return affaire(cx, ref);
    toucher(c, a, change);
    const apres = issue(a, etapes);
    if (apres && apres !== avant) marquant({ connexion: cx, fait: apres === 'gagne' ? 'affaire_gagnee' : 'affaire_perdue', de: 'christophe', fiche: a, entreprise: resume(c.data, a, etapes).entreprise });
    return affaire(cx, ref);
  }

  const principal = (a, lien) => refs(a.liens?.[lien])[0] ?? null;

  function ajouterNote(cx, ref, texte) {
    const c = copie(cx), a = fiche(c.data, ref, 'affaire'), t = String(texte ?? '').trim().slice(0, 10000);
    if (!t) throw bad('note vide');
    creer(c, 'activite', { type: 'note', at: now(), resume: t }, { affaire: ref, entreprise: principal(a, 'entreprises'), contact: principal(a, 'contacts') });
    return affaire(cx, ref);
  }

  function compteRendu(cx, ref, rdvRef, texte) {
    const c = copie(cx), a = fiche(c.data, ref, 'affaire'), r = fiche(c.data, rdvRef, 'rendez_vous'), t = String(texte ?? '').trim().slice(0, 20000);
    if (!refs(r.liens?.affaires).includes(ref)) throw bad("ce rendez-vous n'est pas lié à cette affaire");
    if (!t) throw bad('compte rendu vide');
    toucher(c, r, { compte_rendu: t, compte_rendu_at: now() });
    marquant({ connexion: cx, fait: 'compte_rendu', de: 'christophe', fiche: r, affaire: a.champs.titre, entreprise: resume(c.data, a, etapesDe(c.data)).entreprise });
    return affaire(cx, ref);
  }

  function ajouterTache(cx, ref, { titre, type = 'tache', echeance } = {}) {
    const c = copie(cx), a = fiche(c.data, ref, 'affaire'), t = one(titre, 200);
    if (!t) throw bad('titre requis');
    if (!TYPES_TACHE.includes(type)) throw bad(`type inconnu (${TYPES_TACHE.join(', ')})`);
    if (echeance && !DATE.test(echeance)) throw bad('échéance attendue au format AAAA-MM-JJ');
    // the profile's due date of a task is a timestamp: a date alone is its local midnight, without hour
    creer(c, 'tache', { titre: t, type, ...(echeance ? { echeance: new Date(`${echeance}T00:00:00`).toISOString(), avec_heure: false } : {}) }, { affaire: ref, entreprise: principal(a, 'entreprises'), contact: principal(a, 'contacts') });
    return affaire(cx, ref);
  }

  function ajouterContact(cx, ref, { nom, fonction, email, telephone } = {}) {
    const c = copie(cx), a = fiche(c.data, ref, 'affaire'), n = one(nom, 160);
    if (!n) throw bad('nom requis');
    const e = one(email, 254);
    if (e && !/^[^\s@]+@[^\s@]+$/.test(e)) throw bad('e-mail invalide');
    const champs = { nom: n, ...(one(fonction, 160) ? { fonction: one(fonction, 160) } : {}), ...(e ? { email: e } : {}), ...(one(telephone, 40) ? { telephone: one(telephone, 40) } : {}) };
    const k = creer(c, 'contact', champs, { entreprises: refs(a.liens?.entreprises) });
    toucher(c, a, {}, { contacts: [...refs(a.liens?.contacts), k.ref] });
    return affaire(cx, ref);
  }

  // a conflict note seen, a deletion answered: delete here too, or keep it detached
  function vu(cx, id) {
    const c = copie(cx), n = c.data.notes.find(x => x.id === id);
    if (!n) throw Object.assign(new Error('note inconnue'), { status: 404 });
    n.vue = now();
    c.save();
    return vue(cx);
  }
  function repondreSuppression(cx, id, supprimer) {
    const c = copie(cx), s = c.data.suppressions.find(x => x.id === id);
    if (!s || s.reponse) throw Object.assign(new Error('question inconnue ou déjà tranchée'), { status: 404 });
    s.reponse = supprimer ? 'supprimee' : 'gardee';
    s.reponduLe = now();
    const f = c.data.fiches[s.ref];
    if (f && supprimer) f.supprimee = now();
    c.save();
    return vue(cx);
  }

  return { copie, vue, affaire, etapes: cx => etapesDe(copie(cx).data), modifierAffaire, ajouterNote, compteRendu, ajouterTache, ajouterContact, vu, repondreSuppression };
}
