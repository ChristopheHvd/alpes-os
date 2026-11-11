import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appelerPartage, chemin, lireFichier, makeEchanges, serveurPartage } from './partage.js';

// Fictitious messages only. The stand-in answers like the `partage` MCP server's tools.
function fauxPartage(fichiers = {}) {
  const appels = [];
  const appeler = async (serveur, outil, args) => {
    appels.push({ outil, args });
    if (outil === 'lister_partage') {
      return Object.keys(fichiers).map(c => `- ${c} · 1.0 Ko · 2026-01-02 10:00 · Personne Fictive`).join('\n') || 'aucun fichier';
    }
    if (outil === 'lire_partage') return `[${args.chemin} · modifié le 2026-01-02 10:00 par Personne Fictive]\n\n${fichiers[args.chemin]}`;
    if (outil === 'deposer_message') {
      if (appeler.refus) throw new Error(appeler.refus);
      const c = `echanges/2026-01-03-0900-christophe-${args.sujet.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.md`;
      fichiers[c] = `---\nde: christophe\ndate: 2026-01-03T09:00:00+01:00\ntype: ${args.type}\nsujet: ${JSON.stringify(args.sujet)}\n---\n\n${args.corps}\n`;
      return JSON.stringify({ fait: true, chemin: c });
    }
    throw new Error(`outil inconnu : ${outil}`);
  };
  return { fichiers, appels, appeler };
}

const fichier = ({ de = 'marc', date = '2026-01-02T10:00:00+01:00', type = 'question', sujet = 'Sujet fictif', reponse, corps = 'Texte fictif.' } = {}) =>
  `---\nde: ${de}\ndate: ${date}\ntype: ${type}\nsujet: ${JSON.stringify(sujet)}\n${reponse ? `en_reponse_a: ${reponse}\n` : ''}---\n\n${corps}\n`;

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'partage-'));
const serveur = () => ({ command: 'node', args: [], env: { PARTAGE_AUTHOR: 'christophe' } });

test('lireFichier reads the flat header after the lire_partage line', () => {
  const { meta, texte } = lireFichier(`[echanges/x.md · modifié le …]\n\n${fichier({ sujet: 'Devis « test » : ok', reponse: '2026-01-01-0900-christophe-a.md' })}`);
  assert.deepEqual(meta, { de: 'marc', date: '2026-01-02T10:00:00+01:00', type: 'question', sujet: 'Devis « test » : ok', en_reponse_a: '2026-01-01-0900-christophe-a.md' });
  assert.equal(texte, 'Texte fictif.');
  assert.equal(lireFichier("---\nsujet: 'à la main'\n---\ncorps").meta.sujet, 'à la main');
  assert.equal(lireFichier('pas d\'en-tête').texte, 'pas d\'en-tête');
});

test('chemin turns a bare file name into its echanges/ path', () => {
  assert.equal(chemin('a.md'), 'echanges/a.md');
  assert.equal(chemin('echanges/a.md'), 'echanges/a.md');
  assert.equal(chemin(''), null);
});

test('serveurPartage finds the partage-mcp server in the config, and nothing else', () => {
  const dir = tmp(), file = path.join(dir, '.claude.json');
  fs.writeFileSync(file, JSON.stringify({ mcpServers: { kdrive: { command: 'npx', args: ['@infomaniak/mcp-server-kdrive'] }, partage: { command: 'node', args: ['/x/partage-mcp.mjs'], env: { PARTAGE_AUTHOR: 'christophe' } } } }));
  assert.deepEqual(serveurPartage(file), { command: 'node', args: ['/x/partage-mcp.mjs'], env: { PARTAGE_AUTHOR: 'christophe' } });
  assert.equal(serveurPartage(path.join(dir, 'absent.json')), null);
});

test('releve reads each file once, keeps what was archived, and tells only what is new after the first pass', async () => {
  const dir = tmp();
  const f = fauxPartage({ 'echanges/2026-01-02-1000-marc-a.md': fichier({ sujet: 'A' }) });
  const neufs = [];
  const ex = makeEchanges({ dir, serveur, appeler: f.appeler, nouveaux: n => neufs.push(...n) });
  await ex.releve();
  assert.deepEqual(ex.messages().map(m => [m.id, m.de, m.type, m.sujet, m.quand]), [['echanges/2026-01-02-1000-marc-a.md', 'marc', 'question', 'A', '2026-01-02T09:00:00.000Z']]);
  assert.equal(neufs.length, 0, 'the first pass is the history, not news');

  f.fichiers['echanges/2026-01-02-1100-marc-b.md'] = fichier({ type: 'info', sujet: 'B', reponse: '2026-01-02-1000-marc-a.md' });
  await ex.releve();
  assert.deepEqual(neufs.map(m => [m.sujet, m.enReponseA]), [['B', 'echanges/2026-01-02-1000-marc-a.md']]);
  assert.equal(f.appels.filter(a => a.outil === 'lire_partage').length, 2, 'a file is read once');

  delete f.fichiers['echanges/2026-01-02-1000-marc-a.md'];
  await ex.releve();
  assert.deepEqual(ex.messages().map(m => m.sujet), ['A', 'B'], 'archived by the curator, still in its conversation');
  // the copy survives a restart
  assert.deepEqual(makeEchanges({ dir, serveur, appeler: f.appeler }).messages().map(m => m.sujet), ['A', 'B']);
});

test('a pass that fails halfway still tells about the files it read', async () => {
  const dir = tmp();
  const f = fauxPartage({ 'echanges/2026-01-02-1000-marc-a.md': fichier({ sujet: 'A' }) });
  const neufs = [];
  let casse = false;
  const appeler = async (s, outil, args) => {
    if (casse && args.chemin === 'echanges/2026-01-02-1200-marc-c.md') throw new Error('délai dépassé');
    return f.appeler(s, outil, args);
  };
  const ex = makeEchanges({ dir, serveur, appeler, nouveaux: n => neufs.push(...n.map(m => m.sujet)) });
  await ex.releve();
  casse = true;
  f.fichiers['echanges/2026-01-02-1100-marc-b.md'] = fichier({ sujet: 'B' });
  f.fichiers['echanges/2026-01-02-1200-marc-c.md'] = fichier({ sujet: 'C' });
  assert.deepEqual(await ex.releve(), { erreur: 'délai dépassé' });
  assert.deepEqual(neufs, ['B']);
  casse = false;
  await ex.releve();
  assert.deepEqual(neufs, ['B', 'C']);
});

test('releve keeps the last copy and the error when the shared space is unreachable', async () => {
  const dir = tmp();
  const f = fauxPartage({ 'echanges/2026-01-02-1000-marc-a.md': fichier() });
  const ex = makeEchanges({ dir, serveur, appeler: f.appeler });
  await ex.releve();
  const panne = makeEchanges({ dir, serveur, appeler: async () => { throw new Error('kDrive a répondu 503'); } });
  assert.deepEqual(await panne.releve(), { erreur: 'kDrive a répondu 503' });
  assert.equal(panne.messages().length, 1);
  assert.equal(panne.etat().erreur, 'kDrive a répondu 503');
});

test('deposer drops the message through deposer_message and keeps it at once', async () => {
  const dir = tmp();
  const f = fauxPartage();
  const ex = makeEchanges({ dir, serveur, appeler: f.appeler });
  const c = await ex.deposer({ type: 'reponse', sujet: 'Re test', texte: 'Ok fictif.', enReponseA: 'echanges/2026-01-02-1000-marc-a.md' });
  assert.equal(c, 'echanges/2026-01-03-0900-christophe-re-test.md');
  assert.deepEqual(f.appels.at(-1), { outil: 'deposer_message', args: { type: 'reponse', sujet: 'Re test', corps: 'Ok fictif.', en_reponse_a: 'echanges/2026-01-02-1000-marc-a.md' } });
  assert.deepEqual(ex.messages().map(m => [m.id, m.de, m.enReponseA]), [[c, 'christophe', 'echanges/2026-01-02-1000-marc-a.md']]);
});

test('without the partage server, nothing is read nor written', async () => {
  const ex = makeEchanges({ dir: tmp(), serveur: () => null, appeler: () => assert.fail('no call') });
  assert.equal(ex.actif(), false);
  assert.match((await ex.releve()).erreur, /non configuré/);
  await assert.rejects(ex.deposer({ type: 'info', sujet: 's', texte: 't' }), /non configuré/);
});

test('appelerPartage speaks MCP over stdio to the server', async () => {
  const dir = tmp(), script = path.join(dir, 'faux-mcp.mjs');
  fs.writeFileSync(script, `import { createInterface } from 'node:readline';
createInterface({ input: process.stdin }).on('line', l => {
  const m = JSON.parse(l);
  const out = r => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: r }) + '\\n');
  if (m.method === 'initialize') out({ protocolVersion: '2024-11-05', capabilities: { tools: {} } });
  if (m.method === 'tools/call') out(m.params.name === 'casse' ? { content: [{ type: 'text', text: 'échec : refusé' }], isError: true }
    : { content: [{ type: 'text', text: m.params.name + ' ' + JSON.stringify(m.params.arguments) + ' ' + process.env.PARTAGE_AUTHOR }] });
});`);
  const s = { command: process.execPath, args: [script], env: { PARTAGE_AUTHOR: 'christophe' } };
  assert.equal(await appelerPartage(s, 'lister_partage', { dossier: 'echanges' }), 'lister_partage {"dossier":"echanges"} christophe');
  await assert.rejects(appelerPartage(s, 'casse'), /refusé/);
  await assert.rejects(appelerPartage({ command: process.execPath, args: ['-e', ''], env: {} }, 'x'), /arrêté/);
});
