import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { due, nextSlot, figures, checkMoney, offLimits, checkRefs } from './review.js';
import { makePropositions } from './propositions.js';
import { cleanText, placeOf } from './activity.js';

const sched = { weekdays: [1, 2, 3, 4, 5], from: 9, to: 19 };
const at = s => new Date(s);   // local time, like the server

test('one review per hour, 9 h to 19 h, on working days only', () => {
  assert.equal(due(at('2026-10-29T08:59'), sched, null), false);
  assert.equal(due(at('2026-10-29T09:00'), sched, null), true);
  assert.equal(due(at('2026-10-29T09:40'), sched, '2026-10-29T09:00:30'), false);
  assert.equal(due(at('2026-10-29T10:00'), sched, at('2026-10-29T09:00:30').toISOString()), true);
  assert.equal(due(at('2026-10-29T19:59'), sched, at('2026-10-29T18:00').toISOString()), true);
  assert.equal(due(at('2026-10-29T20:00'), sched, null), false);
  assert.equal(due(at('2026-10-31T10:00'), sched, null), false);   // Saturday
  assert.equal(due(at('2026-11-01T10:00'), { ...sched, weekdays: [7] }, null), true);   // 7 = Sunday
});

test('the next review is the next hour in the window', () => {
  assert.equal(nextSlot(at('2026-10-29T15:20'), sched).getTime(), at('2026-10-29T16:00').getTime());
  assert.equal(nextSlot(at('2026-10-29T19:10'), sched).getTime(), at('2026-10-30T09:00').getTime());
  assert.equal(nextSlot(at('2026-10-30T19:10'), sched).getTime(), at('2026-11-02T09:00').getTime());   // Friday → Monday
  assert.equal(nextSlot(at('2026-10-29T07:00'), sched).getTime(), at('2026-10-29T09:00').getTime());
});

test('a proposition is decided once, and a dismissed one never comes back', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'prop-')), 'p.json');
  const store = makePropositions(file);
  const a = store.add({ source: 'revue', title: 'Relancer le client pour le devis', project: 'Projet A', why: 'pas de réponse depuis 5 jours' });
  assert.equal(a.from, 'Revue horaire');
  assert.equal(store.add({ source: 'revue', title: 'relancer le client pour le devis.' }).id, a.id);
  assert.throws(() => store.add({ source: 'autre', title: 'x' }));
  assert.equal(store.decide(a.id, 'dismiss').status, 'dismissed');
  assert.throws(() => store.decide(a.id, 'accept'), /déjà traitée/);
  assert.equal(store.add({ source: 'revue', title: 'Relancer le client pour le devis' }).status, 'dismissed');

  const b = store.add({ source: 'mission', from: 'Un partenaire', title: 'Appeler la boulangerie' });
  assert.equal(store.decide(b.id, 'accept', 'Appeler la boulangerie avant midi').title, 'Appeler la boulangerie avant midi');
  assert.deepEqual(makePropositions(file).pending(), []);   // persisted

  const old = store.add({ source: 'revue', title: 'Préparer le rendez-vous' });
  const mission = store.add({ source: 'mission', title: 'Rappeler un prospect' });
  store.expire(new Date(Date.now() + 1000).toISOString());
  assert.deepEqual(store.pending().map(p => p.id), [mission.id]);
  assert.equal(store.get(old.id), null);
});

test('transcript text keeps what he wrote, not what the app wrapped around it', () => {
  assert.equal(cleanText('<system-reminder>Linked sessions now</system-reminder>\n<pasted_content id="1"> Fais la maquette </pasted_content>'), 'Fais la maquette');
  assert.equal(cleanText('<command-message>build</command-message> <command-name>/build</command-name> <command-args>la revue</command-args>'), '/build la revue');
  assert.deepEqual(placeOf('/Users/c/Code/alpes-os/.claude/worktrees/revue-horaire', '/Users/c'), { dossier: 'Code/alpes-os', worktree: 'revue-horaire' });
  assert.deepEqual(placeOf('/Users/c/Code/client-app', '/Users/c'), { dossier: 'Code/client-app' });
});

test('money is proposed only with an amount found in the material, once per client, amount and month', () => {
  assert.ok(figures('Facture : 1 400 € (2 jours × 700 €), soit 1.400,00 EUR').has(1400));
  assert.ok(figures('1 400 €').has(1400) && figures('700 €').has(700) && !figures('le 3/12').has(1400));
  const ctx = {
    clients: [{ slug: 'client-a', titre: 'Client A' }],
    mails_recents: [{ objet: 'Formation validée', messages: [{ texte: 'Nous validons la formation de décembre.' }] }],
    extraits_clients: { 'client-a': ['Formation de deux jours : 1 400 €'] },
    notes_finance: [{ note: 'client-a-formation', client: 'client-a', echeances: [{ montant: 1400, date: '2026-11-14', statut: 'a_encaisser' }] }],
  };
  const f = { client: 'client-a', note: '', libelle: 'Formation décembre', montant: 1400, date: '2026-12-20', statut: 'a_encaisser', title: 'Client A : formation validée', why: 'mail du 29/10' };
  assert.deepEqual(checkMoney(f, ctx).echeance, { client: 'client-a', montant: 1400, date: '2026-12-20', note: 'client-a-formation', libelle: 'Formation décembre', statut: 'a_encaisser' });
  assert.equal(checkMoney({ ...f, montant: 1500 }, ctx), null);              // invented amount
  assert.equal(checkMoney({ ...f, date: '2026-11-30' }, ctx), null);         // already scheduled that month
  assert.equal(checkMoney({ ...f, client: 'inconnu' }, ctx), null);

  const store = makePropositions(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'prop-')), 'p.json'));
  const a = store.add({ source: 'revue', type: 'finance', title: 'Client A : 1 400 € en décembre', echeance: checkMoney(f, ctx).echeance });
  assert.equal(a.type, 'finance');
  store.decide(a.id, 'dismiss');
  assert.equal(store.add({ source: 'revue', type: 'finance', title: 'Autre formulation', echeance: { ...a.echeance, date: '2026-12-02' } }).id, a.id);
  assert.throws(() => store.add({ source: 'mission', type: 'finance', title: 'x', echeance: { client: 'client-a' } }), /échéance incomplète/);
  const b = store.add({ source: 'mission', type: 'finance', title: 'Client A : acompte', echeance: { client: 'client-a', libelle: 'Acompte', montant: '600', date: '2027-01-10' } });
  assert.throws(() => store.decide(b.id, 'later'), /finances ou s'ignore/);
  assert.throws(() => store.decide(b.id, 'launch'), /finances ou s'ignore/);
  assert.equal(store.add({ source: 'revue', title: 'Une tâche' }).type, 'tache');
});

test('a suggestion only cites facts the context holds', () => {
  const ctx = {
    notes_recentes: [{ chemin: 'brain/projects/projet-y.md', titre: 'Projet Y' }],
    notes_finance: [{ note: 'projet-y-devis', titre: 'Devis Projet Y' }],
    projets: [{ slug: 'projet-y', titre: 'Projet Y' }],
    clients: [{ slug: 'atelier-dupuis', titre: 'Atelier Dupuis' }],
    mails_recents: [{ id: '18f0a', de: 'Jeanne Martin', objet: 'Démo de jeudi' }],
    activite_claude_code: [{ id: 'ab12cd34', dossier: 'Code/projet-y', de: '09:10', a: '11:40' }],
  };
  assert.deepEqual(checkRefs(['note:brain/projects/projet-y.md', 'projet:projet-y', 'client:atelier-dupuis', 'mail:18f0a', 'session:ab12cd34', 'note:brain/finance/projet-y-devis.md'], ctx), [
    { type: 'note', id: 'brain/projects/projet-y.md', label: 'Note : Projet Y' },
    { type: 'projet', id: 'projet-y', label: 'Projet : Projet Y' },
    { type: 'client', id: 'atelier-dupuis', label: 'Client : Atelier Dupuis' },
    { type: 'mail', id: '18f0a', label: 'Mail de Jeanne Martin : Démo de jeudi' },
    { type: 'session', id: 'ab12cd34', label: 'Session Code/projet-y, 09:10–11:40' },
    { type: 'note', id: 'brain/finance/projet-y-devis.md', label: 'Finance : Devis Projet Y' },
  ]);
  // unknown, invented or malformed refs go; a ref given twice counts once
  assert.deepEqual(checkRefs(['note:brain/clients/inconnu.md', 'mail:zzz', 'projet:autre', 'session:00000000', 'web:https://x.fr', 'sans type', 'projet:projet-y', ' projet:projet-y '], ctx).map(r => r.id), ['projet-y']);
  assert.deepEqual(checkRefs(undefined, ctx), []);
  assert.equal(checkRefs(Array(9).fill('projet:projet-y').map((r, i) => i % 2 ? r : `client:atelier-dupuis`), {}).length, 0);
});

test('a task given to an agent is done with, and never proposed again', () => {
  const store = makePropositions(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'prop-')), 'p.json'));
  const a = store.add({ source: 'revue', title: 'Préparer le rendez-vous de jeudi' });
  assert.equal(store.decide(a.id, 'launch', 'Préparer le rendez-vous de jeudi matin').status, 'launched');
  assert.deepEqual(store.pending(), []);
  assert.deepEqual(store.launched().map(p => p.title), ['Préparer le rendez-vous de jeudi matin']);
  assert.equal(store.add({ source: 'revue', title: 'préparer le rendez-vous de jeudi matin' }).id, a.id);

  // what the agent will need is kept with the suggestion; an old one has none of it
  const b = store.add({ source: 'revue', title: 'Préparer la démo', project: 'Projet Y', slug: 'projet-y', objectif: 'Une trame de démo prête',
    etapes: ['Lire la note projet', 'Rédiger la trame', ''], refs: [{ type: 'projet', id: 'projet-y', label: 'Projet : Projet Y' }, { type: 'mail' }] });
  assert.deepEqual([b.slug, b.objectif, b.etapes, b.refs], ['projet-y', 'Une trame de démo prête', ['Lire la note projet', 'Rédiger la trame'], [{ type: 'projet', id: 'projet-y', label: 'Projet : Projet Y' }]]);
  const c = store.add({ source: 'mission', title: 'Rappeler un prospect' });
  assert.deepEqual(['slug', 'objectif', 'etapes', 'refs'].filter(k => k in c), []);
});

test('nothing is proposed about a project he paused, finished or archived, nor its client', () => {
  const blocked = offLimits({
    projets_arretes: [{ slug: 'projet-x', titre: 'Projet X', stade: 'pause', decision: 'pas de relance', clients: ['client-x'] },
      { slug: 'vieux-site', titre: 'Vieux site', stade: 'terminé', decision: '', clients: [] }],
    clients: [{ slug: 'client-x', titre: 'Atelier Martin' }, { slug: 'client-a', titre: 'Client A' }],
  });
  assert.ok(blocked({ project: 'projet-x', title: 'Relancer le devis' }));
  assert.ok(blocked({ project: 'Projet X', title: 'Relancer le devis' }));
  assert.ok(blocked({ project: '', title: 'Relancer Atelier Martin : devis Projet X et acompte' }));
  assert.ok(blocked({ client: 'client-x', title: 'Acompte' }));
  assert.ok(blocked({ project: 'vieux-site', title: 'Mettre à jour les pages' }));
  assert.ok(!blocked({ project: 'projet-y', title: 'Relancer le devis' }));
  assert.ok(!blocked({ client: 'client-a', title: 'Client A : formation validée' }));
  assert.ok(!offLimits({})({ project: 'projet-x', title: 'x' }));

  const store = makePropositions(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'prop-')), 'p.json'));
  store.add({ source: 'revue', title: 'Relancer le devis', project: 'projet-x' });
  const kept = store.add({ source: 'revue', title: 'Préparer la démo', project: 'Projet Y' });
  const mission = store.add({ source: 'mission', title: 'Relancer le devis du Projet X' });
  store.expire('2000-01-01', p => blocked(p));
  assert.deepEqual(store.pending().map(p => p.id), [kept.id, mission.id]);
});
