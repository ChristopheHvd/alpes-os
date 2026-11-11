import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeProspection, criteres, norm } from './prospection.js';
import { readNotices, company } from './annuaire.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'prospection-'));

test('criteria keep only well-formed codes', () => {
  const c = criteres({ naf: '43.32a, 4332A, 43.21A', departements: ['74', 'x'], tranches: ['11', '99'], codes_postaux: '74220 742' });
  assert.deepEqual(c, { naf: ['43.32A', '43.21A'], departements: ['74'], codes_postaux: ['74220'], tranches: ['11'] });
});

test('a target needs an activity and an area, and gets a unique slug', () => {
  const p = makeProspection(tmp());
  assert.throws(() => p.creer({ titre: 'X', departements: ['74'] }), /code d'activité/);
  assert.throws(() => p.creer({ titre: 'X', naf: ['43.32A'] }), /département/);
  const a = p.creer({ titre: 'Bâtiment 74', naf: ['43.32A'], departements: ['74'] });
  const b = p.creer({ titre: 'Bâtiment 74', naf: ['43.32A'], departements: ['74'] });
  assert.equal(a.slug, 'batiment-74');
  assert.equal(b.slug, 'batiment-74-2');
  assert.equal(p.lister().length, 2);
});

test('a manual choice sticks and is reported in the summary', () => {
  const p = makeProspection(tmp());
  const c = p.creer({ titre: 'T', naf: ['43.32A'], departements: ['74'] });
  p.mutate(c.slug, x => { x.entreprises = [{ siren: '1', nom: 'A', dirigeants: [], etat: 'a_trier', contact: {} }, { siren: '2', nom: 'B', dirigeants: [{}], etat: 'retenue', contact: { email: 'b@b.fr' } }]; });
  p.choisir(c.slug, '1', 'retenue');
  const r = p.resume(p.get(c.slug));
  assert.equal(r.retenues, 2);
  assert.equal(r.a_trier, 0);
  assert.equal(r.avec_email, 1);
  assert.equal(p.get(c.slug).entreprises[0].manuel, true);
});

test('exclusions match by siren, email or LinkedIn', () => {
  const p = makeProspection(tmp());
  p.exclure({ email: 'Stop@Ex.fr', nom: 'X', raison: 'ne veut plus être contacté' });
  assert.ok(p.estExclue({ siren: '9', contact: { email: 'stop@ex.fr' } }));
  assert.equal(p.estExclue({ siren: '9', contact: { email: 'other@ex.fr' } }), undefined);
  assert.throws(() => p.exclure({ nom: 'rien' }), /rien à exclure/);
});

test('company names compare without legal forms or accents', () => {
  assert.equal(norm('SARL Électricité Gallay'), norm('electricite gallay'));
});

test('BODACC notices: a recent collective procedure, and moments of the last 18 months', () => {
  const now = new Date('2026-11-11');
  const r = readNotices([
    { dateparution: '2026-04-15', familleavis_lib: 'Modifications diverses', modificationsgenerales: '{"descriptif": "Modification de l\'administration."}' },
    { dateparution: '2025-05-31', familleavis_lib: 'Modifications diverses', modificationsgenerales: '{"descriptif": "Modification du capital. Nouveau siège."}' },
    { dateparution: '2023-01-01', familleavis_lib: 'Modifications diverses', modificationsgenerales: '{"descriptif": "Nouveau siège."}' },
    { dateparution: '2026-10-02', familleavis_lib: 'Procédures collectives' },
  ], now);
  assert.deepEqual(r.moments.map(m => m.quoi), ['Changement de dirigeant', 'Nouveau siège']);
  assert.equal(r.procedure.date, '2026-10-02');
  assert.equal(readNotices([{ dateparution: '2020-01-01', familleavis_lib: 'Procédures collectives' }], now).procedure, null);
});

test('a directory result keeps people, holdings and the latest accounts', () => {
  const c = company({
    siren: '1', nom_complet: 'MENUISERIE X', nom_raison_sociale: 'MENUISERIE X',
    siege: { libelle_commune: 'THONES', code_postal: '74230', departement: '74', activite_principale: '43.32A', tranche_effectif_salarie: '12' },
    finances: { 2023: { ca: 1, resultat_net: 1 }, 2024: { ca: 3100000, resultat_net: 120000 } },
    dirigeants: [{ type_dirigeant: 'personne physique', prenoms: 'JEAN PIERRE', nom: 'MARTIN', qualite: 'Gérant' }, { type_dirigeant: 'personne morale', siren: '2', denomination: 'HOLDING X' }],
  });
  assert.equal(c.nom, 'Menuiserie X');
  assert.equal(c.ville, 'Thones');
  assert.deepEqual(c.dirigeants[0], { prenom: 'Jean', nom: 'Martin', qualite: 'Gérant' });
  assert.equal(c.ca, 3100000);
  assert.equal(c.holdings[0].siren, '2');
});
