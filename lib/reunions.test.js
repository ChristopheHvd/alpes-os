import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pendingReunions } from './reunions.js';

test('only phone meetings with a report and not yet taken by the curator are pending', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reunions-'));
  const dir = path.join(root, 'Réunions');
  const queue = path.join(root, 'inbox');
  const meeting = (name, report) => {
    fs.mkdirSync(path.join(dir, name), { recursive: true });
    if (report !== undefined) fs.writeFileSync(path.join(dir, name, 'Compte rendu.md'), report);
  };
  meeting('2026-11-17 10h00 Point Marc', '# Point Marc\n\n- Source : Alpes Vocal, sur le téléphone\n');
  meeting('2026-11-17 11h00 Wispr', '# Wispr\n\n- Source : Wispr Flow, sur le Mac\n');
  meeting('2026-11-17 12h00 En cours de synchro');
  meeting('2026-11-17 13h00 Vide', '  \n');
  meeting('2026-11-16 09h00 Déjà archivée', '# Déjà\n\n- Source : Alpes Vocal, sur le téléphone\n');
  fs.mkdirSync(path.join(queue, 'archive'), { recursive: true });
  fs.writeFileSync(path.join(queue, 'archive', 'reunion-2026-11-16 09h00 Déjà archivée.md'), 'x');

  assert.deepEqual(pendingReunions(dir, queue), ['2026-11-17 10h00 Point Marc']);
  fs.writeFileSync(path.join(queue, 'reunion-2026-11-17 10h00 Point Marc.md'), 'x');
  assert.deepEqual(pendingReunions(dir, queue), []);
  assert.deepEqual(pendingReunions(path.join(root, 'absent'), queue), []);
});
