import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseEnd, slugify, makeChantiers } from './chantiers.js';

// A stand-in for the claude CLI: speaks stream-json, and its prompt decides
// what it does — ASK ends on a question, SLEEP never ends, FAIL exits 1,
// anything else writes out.html and declares it.
const FAKE = `#!/usr/bin/env node
const fs = require('node:fs');
const a = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_ARGS, JSON.stringify(a) + '\\n');
const prompt = a[a.indexOf('-p') + 1];
const say = o => process.stdout.write(JSON.stringify(o) + '\\n');
say({ type: 'system', subtype: 'init' });
say({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Write', input: { file_path: 'out.html' } }] } });
if (prompt.includes('SLEEP')) setInterval(() => {}, 1000);
else if (prompt.includes('FAIL')) { process.stderr.write('boom'); process.exit(1); }
else if (prompt.includes('LATER')) say({ type: 'result', result: 'RÉSUMÉ: étape 1\\nREPRENDRE: 2020-01-01T09:00:00Z Fais l\\'étape 2' });
else if (prompt.includes('ASK')) say({ type: 'result', result: 'RÉSUMÉ: à moitié\\nQUESTION: quelle couleur ?' });
else { fs.writeFileSync('out.html', '<p>ok</p>'); say({ type: 'result', result: 'Voilà.\\nRÉSUMÉ: page faite\\nOUTPUT: out.html\\nOUTPUT: absent.html' }); }
`;

function setup(extra = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chantiers-'));
  const bin = path.join(root, 'fake-claude.cjs');
  fs.writeFileSync(bin, FAKE, { mode: 0o755 });
  process.env.FAKE_ARGS = path.join(root, 'args.jsonl');
  for (const k of ['AUTHOR', 'COMMITTER']) { process.env[`GIT_${k}_NAME`] = 'Test'; process.env[`GIT_${k}_EMAIL`] = 'test@localhost'; }
  const events = [];
  const make = () => makeChantiers(root, { bin, ...extra }, { onChange: (c, e) => events.push([c.id, e]) });
  return { root, make, events, args: () => fs.readFileSync(process.env.FAKE_ARGS, 'utf8').trim().split('\n').map(l => JSON.parse(l)) };
}

const settle = async (ch, id, statuts = ['pret', 'bloque', 'echec', 'interrompu']) => {
  for (let i = 0; i < 200; i++) {
    const c = ch.get(id);
    if (statuts.includes(c.statut) && !c.enCours) return c;
    await new Promise(r => setTimeout(r, 25));
  }
  throw new Error('chantier never settled: ' + ch.get(id).statut);
};

test('the closing block is parsed, multi-line summary and planned resume included', () => {
  const e = parseEnd('bla\nRÉSUMÉ: fait la home\net la page contact\nOUTPUT: `maquettes/index.html`\nOUTPUT: maquettes/contact.html\nREPRENDRE: 2026-10-01T09:00:00Z Intègre les retours');
  assert.equal(e.resume, 'fait la home\net la page contact');
  assert.deepEqual(e.livrables, ['maquettes/index.html', 'maquettes/contact.html']);
  assert.equal(e.question, null);
  assert.deepEqual(e.reprendre, { at: '2026-10-01T09:00:00.000Z', consigne: 'Intègre les retours' });
  assert.equal(parseEnd('**QUESTION:** hébergement ?').question, 'hébergement ?');
  assert.equal(slugify('Site alpes-ia.fr — Maquettes'), 'site-alpes-ia-fr-maquettes');
});

test('a chantier gets its repo and worktree, runs, and declares only files that exist', async () => {
  const { root, make, events, args } = setup({ secondBrain: '/tmp/sb' });
  const ch = make();
  const c = ch.start({ titre: 'Maquettes', objectif: 'fais la page', projet: 'Site Alpes', chatId: 'conv-1' });
  assert.equal(c.projet, 'site-alpes');
  const done = await settle(ch, c.id);
  assert.equal(done.statut, 'pret');
  assert.equal(done.resume, 'page faite');
  assert.deepEqual(done.livrables, [`site-alpes/.worktrees/${c.slug}/out.html`]);
  assert.equal(done.sessionStarted, true);
  const repo = path.join(root, 'chantiers', 'site-alpes');
  assert.match(fs.readFileSync(path.join(repo, '.git', 'info', 'exclude'), 'utf8'), /^\.worktrees\/$/m);
  const a = args()[0];
  assert.equal(a[a.indexOf('--permission-mode') + 1], 'auto');
  assert.equal(a[a.indexOf('--session-id') + 1], c.sessionId);
  assert.ok(a.includes('--strict-mcp-config') && a.includes('Bash(git push:*)') && a.includes('Write(//tmp/sb/**)'));
  assert.deepEqual(events.filter(e => e[0] === c.id).map(e => e[1]), ['cree', 'en_cours', 'pret']);
});

test('a question blocks it; a resume reuses the same session, then closing merges into main', async () => {
  const { root, make, args } = setup();
  const ch = make();
  const c = ch.start({ titre: 'Logo', objectif: 'ASK', projet: 'brand' });
  const blocked = await settle(ch, c.id);
  assert.equal(blocked.statut, 'bloque');
  assert.equal(blocked.question, 'quelle couleur ?');
  ch.resume(c.id, 'teal');
  const ready = await settle(ch, c.id);
  assert.equal(ready.statut, 'pret');
  assert.equal(ready.question, null);
  assert.equal(ready.etapes.length, 2);
  const second = args()[1];
  assert.equal(second[second.indexOf('--resume') + 1], c.sessionId);
  assert.ok(!second.includes('--session-id'));
  const closed = ch.close(c.id);
  assert.equal(closed.statut, 'clos');
  assert.deepEqual(closed.livrables, ['brand/out.html']);
  const repo = path.join(root, 'chantiers', 'brand');
  assert.ok(fs.existsSync(path.join(repo, 'out.html')));
  assert.ok(!fs.existsSync(path.join(repo, '.worktrees', c.slug)));
  assert.throws(() => ch.resume(c.id, 'encore'), /clos/);
});

test('failure, timeout and stop each end in their own state', async () => {
  const { make } = setup({ maxMinutes: 0.03 });
  const ch = make();
  const f = ch.start({ titre: 'A', objectif: 'FAIL', projet: 'p' });
  assert.equal((await settle(ch, f.id)).statut, 'echec');
  assert.match(ch.get(f.id).raison, /boom/);
  const t = ch.start({ titre: 'B', objectif: 'SLEEP', projet: 'p' });
  const timedOut = await settle(ch, t.id);
  assert.equal(timedOut.statut, 'interrompu');
  assert.match(timedOut.raison, /délai/);
});

test('at most maxParallel run at once; the rest queue and start in order', async () => {
  const { make } = setup({ maxParallel: 1 });
  const ch = make();
  const a = ch.start({ titre: 'A', objectif: 'SLEEP', projet: 'p' });
  const b = ch.start({ titre: 'B', objectif: 'ok', projet: 'p' });
  assert.equal(ch.get(a.id).statut, 'en_cours');
  assert.equal(ch.get(b.id).statut, 'en_attente');
  ch.stop(a.id);
  assert.equal((await settle(ch, a.id)).raison, 'arrêté à la demande');
  assert.equal((await settle(ch, b.id)).statut, 'pret');
});

test('a run left running by a restart comes back interrupted', async () => {
  const { make } = setup();
  const ch = make();
  const a = ch.start({ titre: 'A', objectif: 'SLEEP', projet: 'p' });
  ch.flush();
  const again = make();
  assert.equal(again.get(a.id).statut, 'interrompu');
  ch.stop(a.id);
  await settle(ch, a.id);
});

test('a planned resume comes due, and resuming clears it', async () => {
  const { make, args } = setup();
  const ch = make();
  const c = ch.start({ titre: 'Suite', objectif: 'LATER', projet: 'p' });
  const done = await settle(ch, c.id);
  assert.deepEqual(done.prochaineReprise, { at: '2020-01-01T09:00:00.000Z', consigne: "Fais l'étape 2" });
  assert.deepEqual(ch.due().map(x => x.id), [c.id]);
  assert.deepEqual(ch.due(Date.parse('2019-12-31')), []);
  ch.resume(c.id, done.prochaineReprise.consigne);
  assert.equal(ch.get(c.id).prochaineReprise, null);
  await settle(ch, c.id);
  assert.match(args().at(-1).join(' '), /Fais l'étape 2/);
});

test('a chantier without an objective is refused', () => {
  const { make } = setup();
  assert.throws(() => make().start({ titre: 'x', objectif: ' ', projet: 'p' }), /requis/);
});
