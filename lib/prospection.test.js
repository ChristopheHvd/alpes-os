import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeProspection, criteres, norm, appliquerRecherche } from './prospection.js';
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
    dirigeants: [{ type_dirigeant: 'personne physique', prenoms: 'PAUL', nom: 'AUDIT', qualite: 'Commissaire aux comptes titulaire' }, { type_dirigeant: 'personne physique', prenoms: 'JEAN PIERRE', nom: 'MARTIN (DUPONT)', qualite: 'Gérant' }, { type_dirigeant: 'personne morale', siren: '2', denomination: 'HOLDING X' }],
  });
  assert.equal(c.nom, 'Menuiserie X');
  assert.equal(c.ville, 'Thones');
  assert.deepEqual(c.dirigeants[0], { prenom: 'Jean', nom: 'Martin', qualite: 'Gérant' });
  assert.equal(c.ca, 3100000);
  assert.equal(c.holdings[0].siren, '2');
});

test('web research: the best address wins, LinkedIn needs confidence, BODACC moments stay', () => {
  const e = { siren: '1', contact: {}, signaux: [{ quoi: 'Nouveau siège', date: '2026-01-01', source: 'BODACC' }] };
  const r = appliquerRecherche(e, {
    site: 'https://x.fr', telephone: '04 50 00 00 00', notes: '',
    emails: [{ adresse: 'Contact@X.fr', type: 'generique', source: 'mentions légales' }, { adresse: 'jean.martin@x.fr', type: 'deduit', source: 'déduite' }, { adresse: 'pas une adresse', type: 'nominatif', source: '' }],
    linkedin: { url: 'https://fr.linkedin.com/in/jean-martin-123?trk=x', confiance: 'haute' },
    signaux: [{ quoi: 'Recrute une assistante', date: '2026-10-28', url: 'https://x.fr/emploi' }],
  }, new Date('2026-11-11'));
  assert.equal(r.contact.email, 'contact@x.fr');
  assert.equal(r.contact.email_type, 'generique');
  assert.deepEqual(r.contact.autres_emails, ['jean.martin@x.fr']);
  assert.equal(r.contact.linkedin, 'https://fr.linkedin.com/in/jean-martin-123');
  assert.equal(r.sources.email, 'mentions légales');
  assert.deepEqual(r.signaux.map(s => s.source), ['BODACC', 'web']);
  const low = appliquerRecherche(e, { emails: [], linkedin: { url: 'https://linkedin.com/in/x', confiance: '' }, signaux: [] });
  assert.equal(low.contact.linkedin, undefined);
});

test('enrichment runs over kept companies not yet researched, and records progress', async () => {
  const p = makeProspection(tmp());
  const c = p.creer({ titre: 'T', naf: ['43.32A'], departements: ['74'] });
  p.mutate(c.slug, x => { x.entreprises = [{ siren: '1', etat: 'retenue', contact: {} }, { siren: '2', etat: 'a_trier', contact: {} }, { siren: '3', etat: 'retenue', contact: {} }]; });
  const seen = [];
  await p.enrichir(c.slug, async e => { seen.push(e.siren); if (e.siren === '3') throw new Error('x'); return { emails: [{ adresse: 'a@b.fr', type: 'nominatif', source: 's' }], linkedin: {}, signaux: [] }; });
  const after = p.get(c.slug);
  assert.deepEqual(seen.sort(), ['1', '3']);
  assert.equal(after.entreprises[0].contact.email, 'a@b.fr');
  assert.equal(after.enrichissement.etat, 'fini');
  assert.equal(after.enrichissement.erreurs, 1);
});

test('a reply ends the sequence, an out-of-office does not, and a follow-up date lands in the calls', () => {
  let clock = new Date('2026-11-11T10:00:00+01:00');
  const p = makeProspection(tmp(), { now: () => clock });
  const c = p.creer({ titre: 'T', naf: ['43.32A'], departements: ['74'] });
  p.mutate(c.slug, x => { x.entreprises = [{ siren: '1', nom: 'A', etat: 'retenue', dirigeants: [], contact: { email: 'a@a.fr', email_type: 'generique', telephone: '04' }, prospect: { statut: 'en_sequence', depart: '2026-11-02', faits: [] } }]; x.campagne = { etat: 'en_cours', etapes: [{ id: 'e1', canal: 'email', delai: 0, texte: '' }] }; });
  const r = p.ajouterReponse(c.slug, { siren: '1', canal: 'email', texte: 'Je suis absent', uid: 'u1' });
  assert.equal(p.ajouterReponse(c.slug, { siren: '1', canal: 'email', texte: 'x', uid: 'u1' }), false);
  assert.equal(p.get(c.slug).entreprises[0].prospect.statut, 'repondu');
  p.classer(c.slug, r.id, { classe: 'absence', titre: 'Absent', fait: '', action: 'rien', question: '', reponse: '', relance: '' });
  assert.equal(p.get(c.slug).entreprises[0].prospect.statut, 'en_sequence');
  const r2 = p.ajouterReponse(c.slug, { siren: '1', canal: 'email', texte: 'Revenez en février', uid: 'u2' });
  p.classer(c.slug, r2.id, { classe: 'pas_maintenant', titre: 'Pas avant février', fait: '', action: 'relancer', question: '', reponse: '', relance: '2027-02-02' });
  p.reporter(c.slug, '1', 'relance', '2027-02-02');
  assert.equal(p.appels('2027-02-01').length, 0);
  assert.equal(p.appels('2027-02-02')[0].relance, true);
  assert.equal(p.reponses().filter(x => x.etat === 'a_traiter').length, 1);
});
