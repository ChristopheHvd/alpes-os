import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { askClaude, fichesPartenaire, makeMemoire, makeSujets, reponseAgent, sansArgent } from './echange.js';

// Fictitious messages only. The model stand-ins record what they were given.
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'echange-'));
const msg = (id, quand, { sens = 'recu', sujet = `Sujet ${id}`, enReponseA = null, texte = 'Texte fictif.' } = {}) =>
  ({ id, sens, type: 'info', sujet, texte, enReponseA, quand: `2026-01-0${quand}T10:00:00.000Z` });

test('a reply joins its subject without the model; the rest is filed by it, one new title shared', async () => {
  const vus = [];
  const sj = makeSujets({
    file: path.join(tmp(), 'sujets.json'),
    ranger: async input => {
      vus.push(input);
      return { affectations: input.messages.map(m => ({ message: m.id, sujet: '', titre: m.id === 'c' ? 'Livre blanc fictif' : 'Re : Relais fictif' })) };
    },
  });
  const a = msg('a', 1), b = msg('b', 2, { sens: 'envoye', enReponseA: 'a' }), c = msg('c', 3), d = msg('d', 4);
  await sj.passe([a, b, c, d]);
  assert.deepEqual(vus[0].messages.map(m => m.id), ['a', 'c', 'd'], 'b follows a once a is filed, it is not sent to the model');
  assert.equal(vus[0].messages[0].auteur, 'partenaire');
  const g = sj.grouper([a, b, c, d]);
  assert.deepEqual(g.map(x => [x.titre, x.messages.map(m => m.id)]), [['Relais fictif', ['a', 'b', 'd']], ['Livre blanc fictif', ['c']]]);
  assert.equal(sj.de('b'), sj.de('a'));
  assert.ok(sj.etat().rangeLe);

  const e = msg('e', 5, { enReponseA: 'c' });
  await sj.passe([a, b, c, d, e]);
  assert.equal(vus.length, 1, 'nothing left for the model');
  assert.equal(sj.de('e'), sj.de('c'));
});

test('an existing subject is reused, and a failed filing keeps the messages under their own line', async () => {
  const file = path.join(tmp(), 'sujets.json');
  let panne = true;
  const sj = makeSujets({
    file,
    ranger: async input => {
      if (panne) throw new Error('modèle indisponible');
      return { affectations: input.messages.map(m => ({ message: m.id, sujet: input.sujets[0].id, titre: '' })) };
    },
  });
  const sid = sj.creer('Relais fictif');
  sj.affecter('a', sid);
  await sj.passe([msg('a', 1), msg('b', 2, { sujet: 'Re : Autre chose' })]);
  assert.equal(sj.etat().erreur, 'modèle indisponible');
  assert.deepEqual(sj.grouper([msg('a', 1), msg('b', 2, { sujet: 'Re : Autre chose' })]).map(g => [g.id.startsWith('brut:'), g.titre]), [[true, 'Autre chose'], [false, 'Relais fictif']]);
  panne = false;
  await makeSujets({ file, ranger: async input => ({ affectations: input.messages.map(m => ({ message: m.id, sujet: input.sujets[0].id, titre: '' })) }) }).passe([msg('a', 1), msg('b', 2)]);
  assert.equal(makeSujets({ file, ranger: null }).de('b'), sid);
});

function brain() {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'brain', 'clients'), { recursive: true });
  fs.mkdirSync(path.join(root, 'brain', 'inbox', 'archive'), { recursive: true });
  return root;
}

test('every message is handed to the curator once, as one event that cites its references', () => {
  const root = brain(), queue = path.join(root, 'brain', 'inbox');
  fs.writeFileSync(path.join(root, 'brain', 'clients', 'partenaire-fictif.md'), 'Décision notée (echanges/2026-01-01-1000-marc-deja.md).');
  const mem = makeMemoire({ root, queue, file: path.join(tmp(), 'memoire.json') });
  const deja = { ...msg('echanges/2026-01-01-1000-marc-deja.md', 1) };
  const neuf = { ...msg('echanges/2026-01-02-1000-marc-neuf.md', 2, { texte: '```\nbloc\n```' }), sujetTitre: 'Relais fictif' };
  const relais = msg('3f2c-relais-seul', 3, { sens: 'envoye' });
  assert.equal(mem.note(deja.id), true);
  assert.equal(mem.confier([deja, neuf, relais], { partenaire: 'Simatis (test)' }), 2);
  const [ev] = fs.readdirSync(queue).filter(f => f.endsWith('.md'));
  const text = fs.readFileSync(path.join(queue, ev), 'utf8');
  assert.match(text, /^---\ntype: SecondBrainEvent\n/);
  assert.match(text, /Échanges avec Simatis \(test\) : 2 messages/);
  assert.match(text, /Référence : echanges\/2026-01-02-1000-marc-neuf\.md/);
  assert.match(text, /Référence : 3f2c-relais-seul/);
  assert.match(text, /De : Christophe/);
  assert.match(text, /Sujet de l'échange : Relais fictif/);
  assert.match(text, /````\n/, 'a fence longer than any in the messages');
  assert.doesNotMatch(text, /marc-deja/);
  assert.equal(mem.note(neuf.id), false, 'waiting in the queue is not noted yet');
  assert.equal(mem.confier([deja, neuf, relais], { partenaire: 'Simatis (test)' }), null, 'never handed over twice');

  // the curator archives the event: its messages count as seen
  fs.renameSync(path.join(queue, ev), path.join(queue, 'archive', ev));
  const relu = makeMemoire({ root, queue, file: path.join(tmp(), 'memoire2.json') });
  assert.equal(relu.note(neuf.id), true);
});

test('the agent answers from the subject\'s last messages; an empty answer sends nothing', async () => {
  let vu;
  const fil = { titre: 'Relais fictif', messages: Array.from({ length: 15 }, (_, i) => msg(`m${i}`, 1, { sens: i % 2 ? 'envoye' : 'recu' })) };
  const t = await reponseAgent(async input => { vu = input; return { texte: '  Réponse fictive.\n\nChristophe ' }; }, fil);
  assert.equal(t, 'Réponse fictive.\n\nChristophe');
  assert.equal(vu.sujet, 'Relais fictif');
  assert.equal(vu.fil.length, 12);
  assert.deepEqual(vu.fil.slice(-2).map(m => m.auteur), ['Christophe', 'Marc']);
  await assert.rejects(reponseAgent(async () => ({ texte: ' ' }), fil), /réponse vide/);
});

test('a message the model keeps skipping is tried three times, then stays under its own line with its replies', async () => {
  let appels = 0;
  const sj = makeSujets({ file: path.join(tmp(), 'sujets.json'), ranger: async () => { appels++; return { affectations: [] }; } });
  const a = msg('a', 1, { sujet: 'Oublié fictif' }), b = msg('b', 2, { sens: 'envoye', sujet: 'Re : Oublié fictif', enReponseA: 'a' });
  for (let i = 0; i < 5; i++) await sj.passe([a, b]);
  assert.equal(appels, 3);
  assert.deepEqual(sj.grouper([a, b]).map(g => [g.titre, g.messages.map(m => m.id)]), [['Oublié fictif', ['a', 'b']]]);
});

test('askClaude runs without the user\'s settings, in an empty folder, and reads the structured answer', async () => {
  const dir = tmp(), bin = path.join(dir, 'faux-claude.mjs'), log = path.join(dir, 'appel.json');
  fs.writeFileSync(bin, `#!/usr/bin/env node
import fs from 'node:fs';
let input = ''; for await (const c of process.stdin) input += c;
fs.writeFileSync(${JSON.stringify(log)}, JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), fichiers: fs.readdirSync('.'), input }));
process.stdout.write(JSON.stringify({ structured_output: { texte: 'ok' } }));
`);
  fs.chmodSync(bin, 0o755);
  assert.deepEqual(await askClaude(bin, { model: 'modele-fictif', system: 'Consigne fictive.', schema: { type: 'object' } }, { fil: [] }), { texte: 'ok' });
  const vu = JSON.parse(fs.readFileSync(log, 'utf8'));
  assert.equal(vu.args[vu.args.indexOf('--setting-sources') + 1], 'project');
  assert.equal(vu.args[vu.args.indexOf('--tools') + 1], '');
  assert.deepEqual(vu.fichiers, []);
  assert.match(vu.cwd, /alpes-os-echange-/);
  assert.equal(fs.existsSync(vu.cwd), false, 'the folder is removed afterwards');
  assert.match(vu.input, /^DONNÉES:\n/);
});

test('sansArgent drops money sections and any line naming an amount, an invoice or a company number', () => {
  const t = `# Profil\nMarc, gérant fictif.\n# Identité officielle\nSIRET fictif 123.\n# État\nAcompte de 540 € versé.\nFormation terminée.\n## Coûts\nOutil à 100 € par mois.\n### Détail\nencore des coûts\n## Décisions\nCommission de 10 % dans les deux sens.\nFacture FAC-2026-001 envoyée.`;
  assert.equal(sansArgent(t), '# Profil\nMarc, gérant fictif.\n# État\nFormation terminée.\n## Décisions\nCommission de 10 % dans les deux sens.');
});

test('the agent gets the partner files that name it, without money, and the shared documents', async () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'brain', 'clients'), { recursive: true });
  fs.mkdirSync(path.join(root, 'brain', 'projects'), { recursive: true });
  fs.writeFileSync(path.join(root, 'brain', 'clients', 'partenaire.md'), '# Partenariat\nLivre blanc avant Waalaxy.\nSolde de 1 260 € facturé.');
  fs.writeFileSync(path.join(root, 'brain', 'projects', 'commun.md'), 'Projet fictif avec Simatis.');
  fs.writeFileSync(path.join(root, 'brain', 'projects', 'autre.md'), 'Projet fictif sans lien.');
  const fiches = fichesPartenaire(root, { fiche: 'brain/clients/partenaire.md' });
  assert.deepEqual(fiches, [{ fiche: 'brain/clients/partenaire.md', texte: '# Partenariat\nLivre blanc avant Waalaxy.' }, { fiche: 'brain/projects/commun.md', texte: 'Projet fictif avec Simatis.' }]);
  let vu;
  await reponseAgent(async input => { vu = input; return { texte: 'ok' }; }, { titre: 'Fictif', messages: [msg('a', 1)] },
    { espacePartage: [{ chemin: 'reference/offre-et-tarifs.md', texte: 'Atelier fictif à partir de 1 €.' }], fiches });
  assert.deepEqual(vu.espace_partage, [{ chemin: 'reference/offre-et-tarifs.md', texte: 'Atelier fictif à partir de 1 €.' }]);
  assert.equal(vu.fiches_de_christophe.length, 2);
});
