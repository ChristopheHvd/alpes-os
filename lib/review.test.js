import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { due, nextSlot } from './review.js';
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
  const a = store.add({ source: 'revue', title: 'Relancer Marc pour le devis', project: 'Simatis', why: 'pas de réponse depuis 5 jours' });
  assert.equal(a.from, 'Revue horaire');
  assert.equal(store.add({ source: 'revue', title: 'relancer marc pour le devis.' }).id, a.id);
  assert.throws(() => store.add({ source: 'autre', title: 'x' }));
  assert.equal(store.decide(a.id, 'dismiss').status, 'dismissed');
  assert.throws(() => store.decide(a.id, 'accept'), /déjà traitée/);
  assert.equal(store.add({ source: 'revue', title: 'Relancer Marc pour le devis' }).status, 'dismissed');

  const b = store.add({ source: 'mission', from: 'Marc Tabouret', title: 'Appeler la boulangerie Dupont' });
  assert.equal(store.decide(b.id, 'accept', 'Appeler Dupont avant midi').title, 'Appeler Dupont avant midi');
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
  assert.deepEqual(placeOf('/Users/c/Code/signature-app', '/Users/c'), { dossier: 'Code/signature-app' });
});
