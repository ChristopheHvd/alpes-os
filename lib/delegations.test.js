import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeDelegations, parseEnd, stripEnd, listSkills, userMcp, listMcp } from './delegations.js';

// Stands in for `claude -p`: records its arguments, writes a report in its working
// folder, and asks a question on the first pass only.
const FAKE = `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify(args) + '\\n');
const prompt = args[args.indexOf('-p') + 1];
if (prompt.includes('DORS')) { setTimeout(() => {}, 60e3); return; }
const out = m => process.stdout.write(JSON.stringify(m) + '\\n');
if (prompt.includes('FUITE')) {
  const servers = JSON.parse(args[args.indexOf('--mcp-config') + 1]).mcpServers;
  out({ type: 'assistant', message: { content: [{ type: 'text', text: 'jetons : ' + Object.values(servers).map(s => Object.values(s.env ?? {}).join(' ')).join(' ') }] } });
}
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

test('a delegation launched with its context reads CONTEXTE.md first', async () => {
  const { root, dg, args } = setup();
  const d = dg.create({ tache: 'Préparer la démo', projet: 'projet-y', dossier: '# Contexte de la tâche\n\nTout ce qu\'on sait.\n' });
  assert.equal(d.projet, 'projet-y');
  assert.equal(fs.readFileSync(path.join(root, d.contexte), 'utf8'), '# Contexte de la tâche\n\nTout ce qu\'on sait.\n');
  await until(() => dg.get(d.id).statut !== 'en_cours');
  const first = args()[0];
  assert.match(first[first.indexOf('-p') + 1], /Lis d'abord CONTEXTE\.md/);

  const plain = dg.create({ tache: 'Sans contexte' });
  assert.equal(plain.contexte, undefined);
  await until(() => dg.get(plain.id).statut !== 'en_cours');
  const second = args()[1];
  assert.match(second[second.indexOf('-p') + 1], /Commence par chercher dans le second brain/);
});

test("the user's Claude Code and claude.ai skills join the second brain's, one per name", async () => {
  const { root } = setup();
  const sb = path.join(root, 'sb'), user = path.join(root, 'user-skills');
  const skill = (dir, name) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${dir}\n---\n`); };
  skill(path.join(sb, 'skills', 'alpes-os', 'devis'), 'devis');
  skill(path.join(user, 'cold-email'), 'cold-email');
  skill(path.join(root, 'agents', 'devis'), 'devis');
  fs.symlinkSync(path.join(root, 'agents', 'devis'), path.join(user, 'devis'), 'dir');
  skill(path.join(user, 'synced', 'abc', 'alpes-ia-pdf'), 'alpes-ia-pdf');
  skill(path.join(user, 'synced', 'abc', 'cold-email'), 'cold-email');
  skill(path.join(user, '.trash', 'vieux'), 'vieux');
  fs.mkdirSync(path.join(user, 'vide'));
  assert.deepEqual(listSkills(sb, user).map(s => [s.name, s.origin]),
    [['alpes-ia-pdf', 'claude-ai'], ['cold-email', 'claude-code'], ['devis', 'second-brain']]);

  const off = new Set(['cold-email']);
  const dg = makeDelegations(root, { bin: path.join(root, 'fake-claude.cjs'), port: 1, secondBrain: sb, userSkills: user, skillOn: n => !off.has(n) });
  assert.deepEqual(dg.skills().map(s => s.name), ['alpes-ia-pdf', 'devis']);
  const d = dg.create({ tache: 'Faire le devis' });
  await until(() => dg.get(d.id).statut !== 'en_cours');
  const links = path.join(root, 'output', 'delegations', d.id, '.claude', 'skills');
  assert.equal(fs.realpathSync(path.join(links, 'devis')), fs.realpathSync(path.join(sb, 'skills', 'alpes-os', 'devis')));
  assert.equal(fs.realpathSync(path.join(links, 'alpes-ia-pdf')), fs.realpathSync(path.join(user, 'synced', 'abc', 'alpes-ia-pdf')));
  assert.ok(!fs.existsSync(path.join(links, 'cold-email')));
});

test("the user's MCP servers reach the agent: reading and drafts only, and no key written down", async () => {
  const { root, args } = setup();
  const claudeJson = path.join(root, 'claude.json');
  const KEY = 'secret-kdrive-0123456789', KEY2 = 'secret-autre-9876543210';
  fs.writeFileSync(claudeJson, JSON.stringify({ mcpServers: {
    kd: { command: 'npx', args: ['-y', '@infomaniak/mcp-server-kdrive'], env: { KDRIVE_ID: '42', KDRIVE_TOKEN: KEY } },
    mail: { command: 'npx', args: ['-y', '@infomaniak/mcp-server-mail'], env: { MAIL_TOKEN: KEY } },
    n8n: { command: 'npx', args: ['n8n-mcp'], env: { N8N_API_URL: 'https://n8n.example', N8N_API_KEY: KEY } },
    partage: { command: 'node', args: ['/x/espace-partage/partage-mcp.mjs'], env: { KDRIVE_TOKEN: KEY, PARTAGE_AUTHOR: 'christophe' } },
    autre: { command: 'node', args: ['/x/autre.js'], env: { API_KEY: KEY2 } },
    dashboard: { command: 'node', args: ['/x/faux.js'] },
  } }));
  const mcp = userMcp(claudeJson);
  assert.deepEqual(mcp.readable, ['kd', 'mail', 'n8n', 'partage']);
  assert.deepEqual(mcp.secrets, [KEY, KEY, KEY, KEY, KEY2]);   // not the author's name, nor the n8n URL
  for (const t of ['kd__kdrive_list', 'kd__kdrive_download_file', 'mail__mail_read_email', 'mail__mail_create_draft', 'mail__mail_update_draft',
    'n8n__n8n_list_workflows', 'n8n__n8n_get_workflow', 'n8n__n8n_create_workflow', 'n8n__n8n_update_partial_workflow', 'n8n__n8n_test_workflow',
    'n8n__n8n_executions', 'n8n__n8n_workflow_versions', 'partage__lister_partage', 'partage__lire_partage']) assert.ok(mcp.allowed.includes(`mcp__${t}`), t);
  for (const t of ['kd__kdrive_upload_file', 'kd__kdrive_delete', 'kd__kdrive_share_link', 'kd__kdrive_move', 'mail__mail_send_email', 'mail__mail_send_draft',
    'mail__mail_delete_email', 'mail__mail_move_email', 'n8n__n8n_delete_workflow', 'partage__deposer_message', 'partage__publier_document',
    'partage__archiver_echange']) assert.ok(!mcp.allowed.includes(`mcp__${t}`), t);
  assert.ok(!mcp.allowed.some(t => t.startsWith('mcp__autre__')));

  const dg = makeDelegations(root, { bin: path.join(root, 'fake-claude.cjs'), port: 1, secondBrain: '/sb', claudeJson });
  const d = dg.create({ tache: 'FUITE de jetons' });
  await until(() => dg.get(d.id).statut !== 'en_cours');
  const a = args()[0];
  const servers = JSON.parse(a[a.indexOf('--mcp-config') + 1]).mcpServers;
  assert.deepEqual(Object.keys(servers), ['kd', 'mail', 'n8n', 'partage', 'autre', 'dashboard']);
  assert.equal(servers.kd.env.KDRIVE_TOKEN, KEY);
  assert.match(servers.dashboard.args[0], /mcp-dashboard\.js$/);
  assert.ok(a.includes('--strict-mcp-config'));
  assert.equal(a[a.indexOf('--setting-sources') + 1], 'project');
  assert.deepEqual(a[a.indexOf('--allowedTools') + 1].split(',').filter(t => t.startsWith('mcp__')), ['mcp__dashboard', ...mcp.allowed]);
  assert.ok(a[a.indexOf('--disallowedTools') + 1].includes(`Read(/${claudeJson})`));
  assert.match(a[a.indexOf('--append-system-prompt') + 1], /outils connectés \(kd, mail, n8n, partage\)/);

  dg.stopAll();
  assert.ok(dg.get(d.id).trace.some(t => t.text.startsWith('jetons : ') && t.text.includes('•••')));
  const files = fs.readdirSync(path.join(root, 'output'), { recursive: true }).map(f => path.join(root, 'output', f)).filter(f => fs.statSync(f).isFile());
  assert.ok(files.length >= 2);
  for (const f of files) for (const k of [KEY, KEY2]) assert.ok(!fs.readFileSync(f, 'utf8').includes(k), `${f} keeps a key`);
});

test('a server switched off in Réglages leaves the next launches and resumes; a new one arrives offered', async () => {
  const { root, args } = setup();
  const claudeJson = path.join(root, 'claude.json');
  const servers = {
    'n8n-atomic': { command: 'npx', args: ['n8n-mcp'], env: { N8N_API_KEY: 'secret-atomic-0123456789' } },
    kd: { command: 'npx', args: ['-y', '@infomaniak/mcp-server-kdrive'] },
  };
  fs.writeFileSync(claudeJson, JSON.stringify({ mcpServers: servers }));
  assert.deepEqual(listMcp(claudeJson), [{ name: 'n8n-atomic', does: 'lecture, création et modification de workflows' }, { name: 'kd', does: 'lecture' }]);

  const off = new Set(['n8n-atomic']);
  const dg = makeDelegations(root, { bin: path.join(root, 'fake-claude.cjs'), port: 1, secondBrain: '/sb', claudeJson, mcpOn: n => !off.has(n) });
  const d = dg.create({ tache: 'Revoir les workflows' });
  await until(() => dg.get(d.id).statut !== 'en_cours');
  const launched = a => ({ servers: Object.keys(JSON.parse(a[a.indexOf('--mcp-config') + 1]).mcpServers), allowed: a[a.indexOf('--allowedTools') + 1] });
  let l = launched(args()[0]);
  assert.deepEqual(l.servers, ['kd', 'dashboard']);
  assert.ok(!l.allowed.includes('mcp__n8n-atomic__'));
  assert.ok(l.allowed.includes('mcp__kd__kdrive_list'));

  fs.writeFileSync(claudeJson, JSON.stringify({ mcpServers: { ...servers, nouveau: { command: 'npx', args: ['n8n-mcp'] } } }));
  dg.reply(d.id, 'suite');
  await until(() => dg.get(d.id).statut !== 'en_cours');
  l = launched(args().at(-1));
  assert.deepEqual(l.servers, ['kd', 'nouveau', 'dashboard']);
  assert.ok(l.allowed.includes('mcp__nouveau__n8n_create_workflow'));
  assert.ok(!l.allowed.includes('mcp__n8n-atomic__'));
});
