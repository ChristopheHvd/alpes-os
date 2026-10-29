import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listFinance, updateEcheance } from './finance.js';

const NOTE = `---
title: Devis test
client: acme
echeances:
  - { libelle: "Acompte 30 %", montant: 900, date: 2026-11-30, statut: devis, ref: DEV-2026-001 }
  - { libelle: "Solde", montant: 2100, date: 2026-12-31, statut: devis }
---

Corps.
`;

function brain() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-'));
  fs.mkdirSync(path.join(root, 'brain', 'finance'), { recursive: true });
  fs.writeFileSync(path.join(root, 'brain', 'finance', 'acme-devis.md'), NOTE);
  return root;
}

test('a devis can be counted in the projection, and the flag round-trips', () => {
  const root = brain();
  assert.equal(listFinance(root)[0].echeances[0].compte, false);
  updateEcheance(root, 'acme-devis', 0, { compte: true });
  const txt = fs.readFileSync(path.join(root, 'brain', 'finance', 'acme-devis.md'), 'utf8');
  assert.match(txt, /ref: DEV-2026-001, compte: true \}/);
  const [a, b] = listFinance(root)[0].echeances;
  assert.equal(a.compte, true);
  assert.equal(b.compte, false);
  assert.match(txt, /\n\nCorps\.\n$/);
});

test('signing a counted devis drops the flag', () => {
  const root = brain();
  updateEcheance(root, 'acme-devis', 0, { compte: true });
  updateEcheance(root, 'acme-devis', 0, { statut: 'a_encaisser' });
  const txt = fs.readFileSync(path.join(root, 'brain', 'finance', 'acme-devis.md'), 'utf8');
  assert.doesNotMatch(txt, /compte: true/);
  assert.equal(listFinance(root)[0].echeances[0].statut, 'a_encaisser');
});
