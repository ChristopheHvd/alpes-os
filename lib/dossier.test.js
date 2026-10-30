import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assemble, namesOf, mentions, journalEntries, MAX_CHARS } from './dossier.js';

const head = '# Contexte de la tâche\n\n## Tâche\n\n**Préparer la démo**';

test('the context file stays under its cap: short parts whole, long ones cut with their path', () => {
  const sections = [
    { titre: 'Projet : Projet Y', texte: 'p '.repeat(30000), chemin: '/sb/brain/projects/projet-y.md' },
    { titre: 'Client : Atelier Dupuis', texte: 'Contact : Jeanne Martin.', chemin: '/sb/brain/clients/atelier-dupuis.md' },
    { titre: 'Mail : démo', texte: 'm '.repeat(20000), chemin: 'fil Gmail abc' },
    { titre: 'Vide', texte: '  ', chemin: 'x' },
  ];
  const out = assemble(head, sections, 20000);
  assert.ok(out.length <= 20000, `${out.length} caractères`);
  assert.ok(out.startsWith(head));
  assert.ok(out.includes('## Client : Atelier Dupuis\n\nContact : Jeanne Martin.'));
  assert.ok(out.includes('Texte complet : /sb/brain/projects/projet-y.md]'));
  assert.ok(out.includes('Texte complet : fil Gmail abc]'));
  assert.ok(!out.includes('## Vide'));
  assert.ok(out.indexOf('## Projet') < out.indexOf('## Client') && out.indexOf('## Client') < out.indexOf('## Mail'));

  assert.ok(!assemble(head, sections.slice(1, 2)).includes('tronqué'));
  assert.equal(MAX_CHARS, 60000);
  assert.ok(assemble(head, [{ titre: 'X', texte: 'x '.repeat(100000), chemin: 'c' }]).length <= MAX_CHARS);
});

test('journal entries are the ones that talk about the project or its client', () => {
  const names = namesOf(['Projet Y', 'Jeanne Martin (Atelier Dupuis)', null]);
  assert.deepEqual(names, ['projet y', 'jeanne martin', 'atelier dupuis']);
  assert.ok(mentions("Point avec l'Atelier Dupuis demain", names));
  assert.ok(!mentions('Projet Yoga', names));
  const text = '# Journal\n\n## 2026-10-20 — Atelier Dupuis, devis\n\nDevis envoyé.\n\n## 2026-10-21 — Autre chose\n\nRien.\n\n## 2026-10-22 — Démo\n\nJeanne Martin valide.\n';
  const e = journalEntries(text, names, '/sb/brain/journal/2026-10.md');
  assert.deepEqual(e.map(x => x.date), ['2026-10-20', '2026-10-22']);
  assert.equal(e[0].titre, 'Journal · 2026-10-20 — Atelier Dupuis, devis');
  assert.ok(e[1].texte.includes('Jeanne Martin valide.'));
  assert.equal(e[1].chemin, '/sb/brain/journal/2026-10.md');
});
