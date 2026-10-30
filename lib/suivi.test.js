import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeSuivi } from './suivi.js';

// A small fictitious follow-up, as received from a partner: every record also in the exchanged state.
const N = 'noeud-partenaire-test';
function graine(dir, cx) {
  const f = (objet, id, champs, liens = {}) => ({ objet, ref: `${N}/${id}`, champs, liens, modifie_le: '2026-10-28T09:00:00.000Z' });
  const fiches = [
    f('pipeline', 'p', { etapes: [
      { id: 'decouverte', libelle: 'Découverte', ordre: 1, clos: false, gagne: false },
      { id: 'proposition', libelle: 'Proposition', ordre: 2, clos: false, gagne: false },
      { id: 'gagne', libelle: 'Gagnée', ordre: 3, clos: true, gagne: true },
      { id: 'perdu', libelle: 'Perdue', ordre: 4, clos: true, gagne: false },
    ] }),
    f('entreprise', 'e1', { nom: 'Entreprise fictive', ville: 'Ville fictive' }),
    f('contact', 'c1', { nom: 'Contact Fictif', fonction: 'Gérant' }, { entreprises: [`${N}/e1`] }),
    f('affaire', 'a1', { titre: 'Affaire fictive', etape: 'decouverte', montant: 5000 }, { entreprises: [`${N}/e1`], contacts: [`${N}/c1`] }),
    f('affaire', 'a2', { titre: 'Affaire perdue (fictive)', etape: 'perdu', clos: 'perdu' }, { entreprises: [`${N}/e1`] }),
    f('rendez_vous', 'r1', { titre: 'Découverte', debut: '2026-11-03T10:00:00.000Z' }, { affaires: [`${N}/a1`], entreprises: [`${N}/e1`] }),
    f('tache', 't1', { titre: 'Rappeler', type: 'appel' }, { affaire: `${N}/a1` }),
    f('activite', 'n1', { type: 'note', at: '2026-10-27T08:00:00.000Z', resume: 'Premier contact.' }, { affaire: `${N}/a1` }),
  ];
  const data = { fiches: Object.fromEntries(fiches.map(x => [x.ref, x])), echange: Object.fromEntries(fiches.map(x => [x.ref, { champs: { ...x.champs }, liens: { ...x.liens }, dates: {} }])) };
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${cx}.json`), JSON.stringify(data));
}

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'suivi-'));
  graine(dir, 'cx-1');
  const faits = [];
  const suivi = makeSuivi({ dir, noeud: () => 'noeud-alpes-test', marquant: f => faits.push(f) });
  return { dir, suivi, faits, a1: `${N}/a1` };
}

test('the page reads deals by stage, closed ones apart, and a deal with what hangs on it', () => {
  const { suivi, a1 } = setup();
  const v = suivi.vue('cx-1');
  assert.deepEqual(v.etapes.map(e => e.id), ['decouverte', 'proposition', 'gagne', 'perdu']);
  assert.deepEqual(v.affaires.map(a => [a.titre, a.entreprise, a.issue]).sort(), [['Affaire fictive', 'Entreprise fictive', null], ['Affaire perdue (fictive)', 'Entreprise fictive', 'perdu']]);
  const a = suivi.affaire('cx-1', a1);
  assert.deepEqual([a.contacts.map(c => c.nom), a.rendez_vous.map(r => r.titre), a.taches.map(t => t.titre), a.activites.map(x => x.resume)],
    [['Contact Fictif'], ['Découverte'], ['Rappeler'], ['Premier contact.']]);
  assert.throws(() => suivi.affaire('cx-1', `${N}/inconnue`), /fiche inconnue/);
  assert.deepEqual(suivi.vue('cx-vide').affaires, []);
  assert.throws(() => suivi.vue('../x'), /connexion invalide/);
});

test('only the allowed deal fields change, validated; won or lost is a notable fact', () => {
  const { dir, suivi, faits, a1 } = setup();
  assert.throws(() => suivi.modifierAffaire('cx-1', a1, { etape: 'inconnue' }), /étape inconnue/);
  assert.throws(() => suivi.modifierAffaire('cx-1', a1, { montant: 'beaucoup' }), /montant invalide/);
  assert.throws(() => suivi.modifierAffaire('cx-1', a1, { echeance: '15/12' }), /AAAA-MM-JJ/);
  const a = suivi.modifierAffaire('cx-1', a1, { etape: 'proposition', montant: '12 000', echeance: '2026-12-15', prochaine_etape: ' Envoyer  la proposition ', titre: 'Ignoré' });
  assert.deepEqual([a.etape, a.montant, a.echeance, a.prochaine_etape, a.titre], ['proposition', 12000, '2026-12-15', 'Envoyer la proposition', 'Affaire fictive']);
  assert.equal(faits.length, 0);
  suivi.modifierAffaire('cx-1', a1, { etape: 'gagne' });
  assert.deepEqual(faits.map(f => [f.fait, f.de, f.entreprise]), [['affaire_gagnee', 'christophe', 'Entreprise fictive']]);
  // written atomically, read back by a new instance
  const relu = makeSuivi({ dir, noeud: () => 'n' }).affaire('cx-1', a1);
  assert.equal(relu.montant, 12000);
  assert.ok(relu.modifie_le > '2026-10-28');
  assert.deepEqual(fs.readdirSync(dir), ['cx-1.json']);
});

test('a note, a task and a contact are new records of this node; a meeting report changes the meeting', () => {
  const { suivi, faits, a1 } = setup();
  suivi.ajouterNote('cx-1', a1, 'Signature **la semaine prochaine**.');
  suivi.ajouterTache('cx-1', a1, { titre: 'Préparer le bon de commande', echeance: '2026-11-06' });
  const a = suivi.ajouterContact('cx-1', a1, { nom: 'Nouvelle Personne', email: 'nouvelle@exemple.fr' });
  assert.match(a.activites[0].ref, /^noeud-alpes-test\//);
  assert.equal(a.activites[0].type, 'note');
  assert.equal(a.activites[0].local, true);
  const t = a.taches.find(x => x.titre === 'Préparer le bon de commande');
  assert.match(t.echeance, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(t.avec_heure, false);
  assert.deepEqual(a.contacts.map(c => c.nom), ['Contact Fictif', 'Nouvelle Personne']);
  const c = suivi.copie('cx-1').data;
  const nouveau = a.contacts[1].ref;
  assert.deepEqual(c.fiches[nouveau].liens, { entreprises: [`${N}/e1`] });
  assert.deepEqual(c.fiches[a1].liens.contacts, [`${N}/c1`, nouveau]);
  assert.throws(() => suivi.ajouterContact('cx-1', a1, { nom: 'X', email: 'pas-un-mail' }), /e-mail invalide/);
  assert.throws(() => suivi.ajouterTache('cx-1', a1, { titre: 'X', type: 'sieste' }), /type inconnu/);
  assert.throws(() => suivi.ajouterNote('cx-1', a1, ' '), /note vide/);

  suivi.compteRendu('cx-1', a1, `${N}/r1`, 'Besoin confirmé.');
  assert.equal(c.fiches[`${N}/r1`].champs.compte_rendu, 'Besoin confirmé.');
  assert.deepEqual(faits.map(f => f.fait), ['compte_rendu']);
  assert.throws(() => suivi.compteRendu('cx-1', `${N}/a2`, `${N}/r1`, 'x'), /pas lié/);
});

test('without a node of its own (relay not set up) nothing can be created', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'suivi-'));
  graine(dir, 'cx-1');
  const suivi = makeSuivi({ dir, noeud: () => null });
  assert.throws(() => suivi.ajouterNote('cx-1', `${N}/a1`, 'x'), /relais non configuré/);
});
