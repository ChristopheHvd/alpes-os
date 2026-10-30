// The copy of a partner's sales follow-up, in the agents relay's CRM profile (crm/1). AlpesOS has
// no CRM of its own: SIMATIS OS's model is the reference, and AlpesOS keeps what one connection
// shares in output/crm/<connection>.json, written atomically.
//
// Christophe may change a deal's stage, amount, due date or next step, and add a note, a meeting
// report, a task or a contact. Those changes leave for the partner with the next pass of
// lib/partenaires.js, which compares each record with the state last exchanged (`echange`).
// Nothing is ever deleted on its own: a record the partner deleted is detached, and waits for
// Christophe's answer.
//
// The merge rules are the kit's (os-agents-relay, crm.js): a field changed on both sides takes the
// most recent value everywhere, the other one is shown as a note; what came from the partner is
// part of the exchanged state, so it never goes back.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as kit from 'os-agents-relay';

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

  // ------------------------------------------------------------ exchange with the partner

  const CHAMP = { titre: 'Titre', nom: 'Nom', etape: 'Étape', montant: 'Montant', echeance: 'Échéance', prochaine_etape: 'Prochaine étape', compte_rendu: 'Compte rendu', resume: 'Texte', debut: 'Date', lieu: 'Lieu', fonction: 'Fonction', email: 'E-mail', telephone: 'Téléphone' };
  const quandLu = v => new Date(v).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
  function valeur(d, nom, v) {
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) return 'vide';
    if (nom === 'etape') return etapesDe(d).find(e => e.id === v)?.libelle ?? v;
    if (nom === 'montant') return `${Number(v).toLocaleString('fr-FR')} €`;
    if (Array.isArray(v)) return v.map(r => nomDe(d, r) ?? r).join(', ');
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return quandLu(v);
    return `« ${one(typeof v === 'object' ? JSON.stringify(v) : v, 60)} »`;
  }
  const titreDe = f => one(f.champs.titre ?? f.champs.nom ?? f.champs.resume ?? 'fiche', 80);
  const premier = (d, f, lien) => nomDe(d, refs(f.liens?.[lien])[0]);

  // A batch received from the partner, applied record by record in its order. A deletion detaches
  // the record and becomes a question. Notable facts are reported, except during the initial snapshot.
  function appliquer(cx, { changements, instantane }, { partenaire }) {
    const c = copie(cx), d = c.data, nouvelles = [];
    for (const ch of changements) {
      let local = d.fiches[ch.ref];
      if (ch.action === 'supprime') {
        delete d.echange[ch.ref];
        if (!local || local.supprimee || local.detachee) continue;
        local.detachee = now();
        const s = { id: crypto.randomUUID(), ref: ch.ref, objet: ch.objet, titre: titreDe(local), quand: now() };
        d.suppressions.push(s);
        nouvelles.push(s);
        continue;
      }
      if (local && (local.supprimee || local.objet !== ch.objet)) { delete d.echange[ch.ref]; local = null; }
      const avant = local ? structuredClone(local) : null, etapes = etapesDe(d);
      const f = kit.fusionner(d.echange[ch.ref], local, ch);
      if (!local) local = d.fiches[ch.ref] = { objet: ch.objet, ref: ch.ref, champs: {}, liens: {}, modifie_le: ch.modifie_le };
      // shared again after a deletion Christophe had not settled
      delete local.detachee;
      if (f.appliquer) { Object.assign(local.champs, f.appliquer.champs); Object.assign(local.liens, f.appliquer.liens); }
      d.echange[ch.ref] = f.etat;
      // nothing of ours left to send: the record is as recent as what came in
      if (!kit.difference(f.etat, local) && Date.parse(ch.modifie_le) > Date.parse(local.modifie_le ?? 0)) local.modifie_le = ch.modifie_le;
      for (const k of f.conflits) {
        const mien = valeur(d, k.nom, k.local), sien = valeur(d, k.nom, k.recu);
        d.notes.push({ id: crypto.randomUUID(), quand: now(), ref: ch.ref, objet: ch.objet, nom: k.nom, gagnant: k.gagnant,
          texte: `${CHAMP[k.nom] ?? k.nom} de « ${titreDe(local)} » changé des deux côtés : on garde ${k.gagnant === 'recu' ? `${sien} (${partenaire}, plus récent), pas ${mien} (toi)` : `${mien} (toi, plus récent), pas ${sien} (${partenaire})`}.` });
      }
      if (instantane) continue;
      const base = { connexion: cx, de: 'partenaire', fiche: local };
      if (ch.objet === 'affaire') {
        const a0 = avant && issue(avant, etapes), a1 = issue(local, etapesDe(d));
        if (a1 && a1 !== a0) marquant({ ...base, fait: a1 === 'gagne' ? 'affaire_gagnee' : 'affaire_perdue', entreprise: premier(d, local, 'entreprises') });
      }
      if (ch.objet === 'rendez_vous') {
        const ctx = { affaire: premier(d, local, 'affaires'), entreprise: premier(d, local, 'entreprises') };
        if (!avant) marquant({ ...base, fait: 'rendez_vous_pris', ...ctx });
        if (f.appliquer?.champs.compte_rendu && f.appliquer.champs.compte_rendu !== avant?.champs.compte_rendu) marquant({ ...base, fait: 'compte_rendu', ...ctx });
      }
    }
    c.save();
    return { suppressions: nouvelles };
  }

  // What changed here since the last exchange, as changes of the profile. A record the partner
  // deleted, or that Christophe deleted after it, never leaves. The first pass is the snapshot.
  function aEnvoyer(cx) {
    const d = copie(cx).data, changements = [], refuses = [];
    for (const f of Object.values(d.fiches)) {
      if (f.detachee || f.supprimee) continue;
      const diff = kit.difference(d.echange[f.ref], f);
      if (!diff) continue;
      try { changements.push(kit.changement({ objet: f.objet, ref: f.ref, modifie_le: f.modifie_le ?? now(), ...diff })); }
      catch (e) { refuses.push({ ref: f.ref, erreur: e.message }); }
    }
    return { changements, refuses, instantane: !d.passe.instantane };
  }
  // posted to the outbox: what the partner now holds, so it is not sent again
  function envoye(cx, changements, { instantane } = {}) {
    const c = copie(cx);
    for (const ch of changements) c.data.echange[ch.ref] = kit.retenir(c.data.echange[ch.ref], ch);
    c.data.passe = { ...c.data.passe, dernier: now(), ...(instantane ? { instantane: now() } : {}) };
    c.save();
  }

  return { copie, vue, affaire, etapes: cx => etapesDe(copie(cx).data), modifierAffaire, ajouterNote, compteRendu, ajouterTache, ajouterContact, vu, repondreSuppression, appliquer, aEnvoyer, envoye };
}
