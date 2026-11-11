import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as cp from './campagne.js';
import { makeProspection } from './prospection.js';
import { tick, ouvert } from './prospection-envoi.js';

const E = (siren, contact, extra = {}) => ({ siren, nom: `Ent ${siren}`, ville: 'Annecy', etat: 'retenue', dirigeants: [{ prenom: 'Jean', nom: 'Martin', qualite: 'Gérant' }], contact, signaux: [], ...extra });

test('steps are checked, sorted by day and keep unique ids', () => {
  const s = cp.etapes([{ canal: 'email', delai: 5, texte: 'b' }, { id: 'e1', canal: 'linkedin', delai: 0 }, { id: 'e1', canal: 'appel', delai: 2 }]);
  assert.deepEqual(s.map(x => x.delai), [0, 2, 5]);
  assert.equal(new Set(s.map(x => x.id)).size, 3);
  assert.throws(() => cp.etapes([{ canal: 'fax' }]), /canal inconnu/);
});

test('greeting adapts to the address, opt-out line is always there', () => {
  const c = { lien: 'https://x.fr/guide' };
  const st = { id: 'e2', canal: 'email', objet: 'Vos devis chez {entreprise}', texte: '{bonjour}\n\nLe guide : {lien}' };
  const perso = cp.emailDe(st, E('1', { email: 'jean@x.fr', email_type: 'nominatif' }), c);
  assert.match(perso.body, /^Bonjour Jean,/);
  assert.match(perso.body, /x\.fr\/guide/);
  assert.match(perso.body, /répondez « stop »/);
  assert.equal(perso.subject, 'Vos devis chez Ent 1');
  const shared = cp.emailDe(st, E('2', { email: 'contact@x.fr', email_type: 'generique' }), c);
  assert.match(shared.body, /^Bonjour, pourriez-vous transmettre ce message à Jean Martin/);
});

test('a guessed address is not mailed until verified', () => {
  assert.equal(cp.emailEnvoyable({ email: 'a@b.fr', email_type: 'deduit' }), false);
  assert.equal(cp.emailEnvoyable({ email: 'a@b.fr', email_type: 'deduit', email_verifie: true }), true);
  assert.equal(cp.emailEnvoyable({ email: 'a@b.fr', email_type: 'generique' }), true);
});

test('what is due: one e-mail at a time, steps without the channel skipped, postponed calls wait', () => {
  const c = { campagne: { etapes: cp.etapesParDefaut().map(x => ({ ...x, texte: 'Texte' })) } };
  const e = E('1', { email: 'a@b.fr', email_type: 'generique', telephone: '04' }, { prospect: { statut: 'en_sequence', depart: '2026-11-02', faits: [] } });
  assert.deepEqual(cp.aFaire(c, e, '2026-11-03').map(s => s.id), []);
  assert.deepEqual(cp.aFaire(c, e, '2026-11-20').map(s => s.id), ['e2', 'e5']);
  e.prospect.faits.push({ etape: 'e2' });
  e.prospect.reporte = { e5: '2026-11-25' };
  assert.deepEqual(cp.aFaire(c, e, '2026-11-20').map(s => s.id), ['e4']);
  const li = E('2', { linkedin: 'https://linkedin.com/in/x' }, { prospect: { statut: 'en_sequence', depart: '2026-11-02', faits: [] } });
  assert.equal(cp.fini(c, li, '2026-11-20'), false);
  assert.equal(cp.fini(c, li, '2026-12-30'), true);
});

test('launch spreads starts over working days, moments first, and the clock sends what is due', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'campagne-'));
  let clock = new Date('2026-11-13T09:00:00+01:00');   // a Friday
  const p = makeProspection(dir, { now: () => clock });
  const c = p.creer({ titre: 'T', naf: ['43.32A'], departements: ['74'] });
  p.mutate(c.slug, x => {
    x.entreprises = [E('1', { email: 'a@a.fr', email_type: 'generique' }), E('2', { email: 'b@b.fr', email_type: 'nominatif' }, { signaux: [{ quoi: 'x' }] }), E('3', { email: 'c@c.fr', email_type: 'deduit' }), E('4', {}, { etat: 'a_trier' })];
  });
  p.preparerCampagne(c.slug, [{ canal: 'email', delai: 0, objet: 'Objet', texte: '{bonjour}\nTexte' }]);
  p.modifierCampagne(c.slug, { par_jour: 1 });
  const r = p.lancer(c.slug);
  assert.equal(r.ajoutes, 2);
  const got = Object.fromEntries(p.get(c.slug).entreprises.filter(e => e.prospect).map(e => [e.siren, e.prospect.depart]));
  assert.deepEqual(got, { 2: '2026-11-13', 1: '2026-11-16' });
  const sent = [];
  const mail = { left: 5, sendsLeft() { return this.left; }, async send(m, o) { assert.equal(o.confirmed, true); sent.push(m.to); this.left--; return { id: 'x' }; } };
  assert.deepEqual(await tick({ prospection: p, mail, now: clock }), { envoyes: 1, termines: 0, erreurs: 0 });
  assert.deepEqual(sent, ['b@b.fr']);
  clock = new Date('2026-11-16T09:00:00+01:00');
  await tick({ prospection: p, mail, now: clock });
  assert.deepEqual(sent, ['b@b.fr', 'a@a.fr']);
  await tick({ prospection: p, mail, now: clock });
  assert.equal(sent.length, 2);
  assert.equal(p.get(c.slug).entreprises.find(e => e.siren === '2').prospect.statut, 'termine');
  assert.equal(ouvert(new Date('2026-11-14T10:00:00+01:00')), false);
});

test('no e-mail when the step has no text, none two days in a row, none to a company set aside', () => {
  const c = { campagne: { etapes: [{ id: 'e1', canal: 'email', delai: 0, texte: '' }, { id: 'e2', canal: 'email', delai: 0, texte: 'B' }, { id: 'e3', canal: 'email', delai: 0, texte: 'C' }] } };
  const e = E('1', { email: 'a@b.fr', email_type: 'generique' }, { prospect: { statut: 'en_sequence', depart: '2026-11-02', faits: [] } });
  assert.deepEqual(cp.aFaire(c, e, '2026-11-10').map(s => s.id), ['e2']);
  e.prospect.faits.push({ etape: 'e2', canal: 'email', status: 'envoye', at: '2026-11-10T09:00:00Z' });
  assert.deepEqual(cp.aFaire(c, e, '2026-11-10'), []);
  assert.deepEqual(cp.aFaire(c, e, '2026-11-11'), []);
  assert.deepEqual(cp.aFaire(c, e, '2026-11-12').map(s => s.id), ['e3']);
  e.etat = 'ecartee';
  assert.deepEqual(cp.aFaire(c, e, '2026-11-12'), []);
});
