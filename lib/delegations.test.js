import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeDelegations, parseEnd, stripEnd, listSkills } from './delegations.js';

// Stands in for `claude -p`: records its arguments, writes a report in its working
// folder, and asks a question on the first pass only.
const FAKE = `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify(args) + '\\n');
const prompt = args[args.indexOf('-p') + 1];
if (prompt.includes('DORS')) { setTimeout(() => {}, 60e3); return; }
const out = m => process.stdout.write(JSON.stringify(m) + '\\n');
out({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'WebSearch', input: { query: 'assurance rc pro' } }] } });
fs.writeFileSync('RAPPORT.md', '# Rapport\\n\\nTrois offres.\\n');
const first = !args.includes('--resume');
out({ type: 'result', result: first ? 'RÉSUMÉ: trois offres trouvées\\nOUTPUT: RAPPORT.md\\nQUESTION: plafond souhaité ?' : 'RÉSUMÉ: comparatif fini\\nOUTPUT: RAPPORT.md\\nOUTPUT: ../hors.md', total_cost_usd: 0.5 });
`;

const until = async (f, ms = 3000) => { for (let t = 0; t < ms && !f(); t += 25) await new Promise(r => setTimeout(r, 25)); };

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deleg-'));
  const bin = path.join(root, 'fake-claude.cjs');
  fs.writeFileSync(bin, FAKE, { mode: 0o755 });
  process.env.FAKE_LOG = path.join(root, 'args.log');
  process.env.CLAUDE_CONFIG_DIR = path.join(root, 'cfg');
  const events = [];
  const dg = makeDelegations(root, { bin, port: 1, secondBrain: '/sb', denyRead: ['/x/credentials'] }, { onChange: (d, e) => events.push(e) });
  return { root, dg, events, args: () => fs.readFileSync(process.env.FAKE_LOG, 'utf8').trim().split('\n').map(l => JSON.parse(l)) };
}

test('parseEnd reads the closing block', () => {
  assert.deepEqual(parseEnd('blabla\n**RÉSUMÉ:** fait\nOUTPUT: `a.md`\nOUTPUT: b.pdf\nQUESTION: '), { resume: 'fait', livrables: ['a.md', 'b.pdf'], question: null });
  assert.equal(parseEnd('QUESTION: lequel ?\nle A ou le B').question, 'lequel ?\nle A ou le B');
  assert.equal(stripEnd('Voici le comparatif.\n\n**RÉSUMÉ:** fait\nOUTPUT: a.md'), 'Voici le comparatif.');
});

test('a delegation asks, gets an answer, resumes the same session and finishes', async () => {
  const { root, dg, events, args } = setup();
  const d = dg.create({ tache: 'Chercher une nouvelle RC Pro', source: 'Chercher une nouvelle RC Pro' });
  assert.equal(d.statut, 'en_cours');
  await until(() => dg.get(d.id).statut !== 'en_cours');
  let cur = dg.get(d.id);
  assert.equal(cur.statut, 'bloque');
  assert.equal(cur.question, 'plafond souhaité ?');
  assert.deepEqual(cur.livrables, [`output/delegations/${d.id}/RAPPORT.md`]);
  assert.ok(cur.trace.some(t => t.kind === 'outil' && t.text.startsWith('WebSearch · assurance')));

  const first = args()[0];
  assert.equal(first[first.indexOf('--session-id') + 1], cur.session);
  assert.ok(first[first.indexOf('--disallowedTools') + 1].includes('Read(//x/credentials/**)'));
  assert.ok(first[first.indexOf('--disallowedTools') + 1].includes('Bash(curl:*)'));
  assert.ok(first.includes('--strict-mcp-config'));
  assert.equal(first[first.indexOf('--setting-sources') + 1], 'project');
  assert.equal(first[first.indexOf('--model') + 1], 'claude-opus-5-5');
  assert.equal(first[first.indexOf('--effort') + 1], 'medium');
  assert.ok(!first.includes('--disable-slash-commands'));
  assert.ok(first[first.indexOf('--disallowedTools') + 1].includes('Write(./.claude/**)'));

  // the CLI would have written the session file by now
  fs.mkdirSync(path.join(root, 'cfg', 'projects', 'p'), { recursive: true });
  fs.writeFileSync(path.join(root, 'cfg', 'projects', 'p', `${cur.session}.jsonl`), '');
  dg.noteDraft(d.id, { to: 'a@x.fr', subject: 'Devis', id: 'r1' });
  dg.noteDraft(d.id, { to: 'a@x.fr', subject: 'Devis v2', id: 'r1' });
  assert.deepEqual(dg.get(d.id).brouillons.map(b => [b.id, b.subject, !!b.modifie]), [['r1', 'Devis v2', true]]);
  assert.ok(dg.ownsDraft(d.id, 'r1'));
  assert.ok(!dg.ownsDraft(d.id, 'r2'));
  dg.reply(d.id, '1 M€');
  await until(() => dg.get(d.id).statut !== 'en_cours');
  cur = dg.get(d.id);
  const second = args()[1];
  assert.equal(second[second.indexOf('--resume') + 1], cur.session);
  assert.match(second[second.indexOf('-p') + 1], /Réponse de Christophe à ta question : 1 M€/);
  assert.match(second[second.indexOf('-p') + 1], /- r1 · à a@x\.fr · « Devis v2 »/);
  assert.equal(cur.statut, 'pret');
  assert.equal(cur.question, null);
  assert.deepEqual(cur.livrables, [`output/delegations/${d.id}/RAPPORT.md`]);   // ../hors.md is dropped
  assert.equal(cur.cout, 1);
  assert.deepEqual(events, ['en_cours', 'bloque', 'en_cours', 'pret']);

  dg.close(d.id);
  assert.equal(dg.list().length, 0);
});

test('a stopped agent is interrupted, and a restart interrupts what was running', async () => {
  const { root, dg } = setup();
  const d = dg.create({ tache: 'DORS longtemps' });
  assert.throws(() => dg.reply(d.id, 'x'), /travaille encore/);
  await new Promise(r => setTimeout(r, 200));
  dg.stop(d.id);
  await until(() => dg.get(d.id).statut !== 'en_cours');
  assert.equal(dg.get(d.id).statut, 'interrompu');

  const e = dg.create({ tache: 'DORS encore' });
  dg.stopAll();
  const again = makeDelegations(root, { bin: 'x', port: 1 });
  assert.equal(again.get(e.id).statut, 'interrompu');
  await until(() => !dg.get(e.id).enCours);
});

test('skills of the second brain are listed and linked into the agent folder', async () => {
  const { root, args } = setup();
  const sb = path.join(root, 'sb');
  const skill = (dir, fm) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\n${fm}\n---\n\nCorps.\n`); };
  skill(path.join(sb, 'skills', 'livre-blanc'), 'name: livre-blanc\ndescription: "Rédige un livre blanc."');
  skill(path.join(sb, 'skills', 'alpes-os', 'devis'), 'name: devis\ndescription: >\n  Génère un devis\n  en PDF.');
  fs.mkdirSync(path.join(sb, 'skills', 'vide'), { recursive: true });
  assert.deepEqual(listSkills(sb).map(({ name, description }) => [name, description]),
    [['devis', 'Génère un devis en PDF.'], ['livre-blanc', 'Rédige un livre blanc.']]);

  const dg = makeDelegations(root, { bin: path.join(root, 'fake-claude.cjs'), port: 1, secondBrain: sb, effort: 'low' });
  assert.deepEqual(dg.skills().map(s => s.name), ['devis', 'livre-blanc']);
  const d = dg.create({ tache: 'Écrire le livre blanc 3' });
  await until(() => dg.get(d.id).statut !== 'en_cours');
  const links = path.join(root, 'output', 'delegations', d.id, '.claude', 'skills');
  assert.equal(fs.realpathSync(path.join(links, 'devis')), fs.realpathSync(path.join(sb, 'skills', 'alpes-os', 'devis')));
  assert.ok(fs.existsSync(path.join(links, 'livre-blanc', 'SKILL.md')));

  // the window's model and effort are kept on the delegation and used by the next pass
  assert.equal(dg.get(d.id).effort, 'low');
  dg.settings(d.id, { model: 'claude-sonnet-5-5', effort: 'high' });
  assert.throws(() => dg.settings(d.id, { effort: 'enorme' }), /effort inconnu/);
  dg.reply(d.id, 'plafond 1 M€');
  await until(() => dg.get(d.id).statut !== 'en_cours');
  const last = args().at(-1);
  assert.equal(last[last.indexOf('--model') + 1], 'claude-sonnet-5-5');
  assert.equal(last[last.indexOf('--effort') + 1], 'high');
});

test('a skill switched off in Réglages leaves the "/" menu and the agent folder; replaced rules are used', async () => {
  const { root, args } = setup();
  const sb = path.join(root, 'sb');
  for (const n of ['devis', 'livre-blanc']) {
    fs.mkdirSync(path.join(sb, 'skills', n), { recursive: true });
    fs.writeFileSync(path.join(sb, 'skills', n, 'SKILL.md'), `---\nname: ${n}\n---\n`);
  }
  const off = new Set(), rules = { text: undefined };
  const dg = makeDelegations(root, { bin: path.join(root, 'fake-claude.cjs'), port: 1, secondBrain: sb, skillOn: n => !off.has(n), get rules() { return rules.text; } });
  const d = dg.create({ tache: 'Écrire le livre blanc 4' });
  await until(() => dg.get(d.id).statut !== 'en_cours');
  const links = path.join(root, 'output', 'delegations', d.id, '.claude', 'skills');
  assert.ok(fs.existsSync(path.join(links, 'livre-blanc')));
  assert.match(args()[0][args()[0].indexOf('--append-system-prompt') + 1], new RegExp(`second brain \\(${sb}\\)`));

  off.add('livre-blanc');
  rules.text = 'Mes règles, second brain {{secondBrain}}';
  assert.deepEqual(dg.skills().map(s => s.name), ['devis']);
  dg.reply(d.id, 'suite');
  await until(() => dg.get(d.id).statut !== 'en_cours');
  assert.ok(!fs.existsSync(path.join(links, 'livre-blanc')));
  assert.ok(fs.existsSync(path.join(links, 'devis')));
  const last = args().at(-1);
  assert.equal(last[last.indexOf('--append-system-prompt') + 1], `Mes règles, second brain ${sb}`);
});
