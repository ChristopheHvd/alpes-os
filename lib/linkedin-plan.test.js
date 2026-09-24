import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parsePlan, schedule, loadLinkedin, updatePost, visualKind, addDays } from './linkedin-plan.js';

const PLAN = `---
type: Reference
title: Plan test
posts:
  - { id: J01, date: 2026-10-01, statut: a_produire }
  - { id: J02, date: 2026-10-02, statut: a_produire }
  - { id: J03, date: 2026-10-03, statut: a_produire }
generated: { by: test, at: "2026-09-24T00:00:00Z" }
---

# Plan

| # | Date | Étape | Pilier | Sujet | Visuel |
|---|---|---|---|---|---|
| J01 | jeu. 1/10 | TOFU | Coulisses | Premier sujet | Capture annotée |
| J02 | ven. 2/10 | MOFU | Méthode | Deuxième sujet | Carrousel |
| J03 | sam. 3/10 | BOFU | Offre | Troisième sujet | Image IA |

## Fiches posts

### J01 · jeudi 1er octobre · TOFU · Coulisses

- **Sujet** : premier.
- **Trame** :
  - point a
  - point b
- **Prompt (Claude)** :
  > ligne 1
  > ligne 2

### J02 · vendredi 2 octobre · MOFU · Méthode

- **Sujet** : deuxième.

### J03 · samedi 3 octobre · BOFU · Offre

- **Sujet** : troisième.
`;

const mk = (id, date, statut = 'a_produire', extra = {}) => ({ id, date, statut, publie_le: '', ...extra });

test('parses frontmatter, table and fiche fields', () => {
  const posts = parsePlan(PLAN, '2026-10');
  assert.equal(posts.length, 3);
  assert.equal(posts[1].visuel, 'Carrousel');
  assert.equal(posts[1].visualKind, 'auto');
  assert.equal(posts[0].visualKind, 'capture');
  const trame = posts[0].fields.find(f => f.label === 'Trame').text;
  assert.match(trame, /point a\n- point b/);
  assert.equal(posts[0].fields.find(f => f.label === 'Prompt (Claude)').text, 'ligne 1\nligne 2');
});

test('the real October plan parses into 30 posts with a visual each', () => {
  const real = process.env.PLAN_FILE;
  if (!real || !fs.existsSync(real)) return;
  const posts = parsePlan(fs.readFileSync(real, 'utf8'), '2026-10');
  assert.equal(posts.length, 30);
  assert.equal(posts.filter(p => p.visualKind === 'auto').length, 14);
  assert.ok(posts.every(p => p.sujet && p.fields.length));
});

test('nothing missed: planned dates stand', () => {
  const s = schedule([mk('J01', '2026-10-01'), mk('J02', '2026-10-02')], '2026-09-24');
  assert.deepEqual(s.map(p => [p.effective, p.shift]), [['2026-10-01', 0], ['2026-10-02', 0]]);
});

test('two missed days slide everything', () => {
  const s = schedule([mk('J01', '2026-10-01'), mk('J02', '2026-10-02'), mk('J03', '2026-10-05')], '2026-10-03');
  assert.deepEqual(s.map(p => [p.effective, p.shift]), [['2026-10-03', 2], ['2026-10-04', 2], ['2026-10-05', 0]]);
});

test('a post published today pushes the next one to tomorrow', () => {
  const s = schedule([mk('J01', '2026-10-01', 'publie', { publie_le: '2026-10-02' }), mk('J02', '2026-10-02')], '2026-10-02');
  assert.equal(s[1].effective, '2026-10-03');
});

test('publishing ahead does not pull later posts earlier', () => {
  const s = schedule([mk('J01', '2026-10-01', 'publie', { publie_le: '2026-09-30' }), mk('J02', '2026-10-02')], '2026-09-30');
  assert.equal(s[1].effective, '2026-10-02');
});

test('abandoned posts leave the schedule', () => {
  const s = schedule([mk('J01', '2026-10-01', 'abandonne'), mk('J02', '2026-10-02')], '2026-10-01');
  assert.equal(s[1].effective, '2026-10-02');
});

test('visualKind covers every label of the plan', () => {
  assert.equal(visualKind('Vidéo (extrait GLOW)'), 'video');
  assert.equal(visualKind('Carte chiffre'), 'auto');
  assert.equal(visualKind('Photo'), 'photo');
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
});

test('updatePost rewrites the line and the final text, keeps the brief', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'li-'));
  fs.mkdirSync(path.join(root, 'brain', 'references'), { recursive: true });
  const f = path.join(root, 'brain', 'references', 'plan-linkedin-2026-10.md');
  fs.writeFileSync(f, PLAN);
  updatePost(root, '2026-10', 'J01', { statut: 'prepare', prepare_le: '2026-10-01T06:02:00Z', texte: 'Bonjour (test)', commentaire: 'Lien : https://x.fr' });
  updatePost(root, '2026-10', 'J01', { texte: 'Bonjour v2' });
  const txt = fs.readFileSync(f, 'utf8');
  assert.match(txt, /\{ id: J01, date: 2026-10-01, statut: prepare, prepare_le: "2026-10-01T06:02:00Z" \}/);
  assert.equal((txt.match(/#### Texte final/g) ?? []).length, 1);
  const data = loadLinkedin(root, { today: '2026-10-01' });
  const j1 = data.posts.find(p => p.id === 'J01');
  assert.equal(j1.texte, 'Bonjour v2');
  assert.equal(j1.commentaire, 'Lien : https://x.fr');
  assert.equal(j1.fields.find(f => f.label === 'Sujet').text, 'premier.');
  assert.equal(data.todayPost.id, 'J01');
  assert.match(txt, /### J02 ·/);
});
