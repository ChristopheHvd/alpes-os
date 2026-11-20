import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readTodo } from './todo.js';

test('a task ticked on a later day is not carried again from an older day', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'todo-')), 'todo.md');
  fs.writeFileSync(file, `# Todo

## Plus tard


## 2000-01-03

- [x] Envoyer le résumé à Margot — Signature App
- [ ] Livrer la version corrigée — Signature App

## 2000-01-02

- [ ] Envoyer le résumé à Margot — Signature App
- [ ] Tester sous Safari — Signature App
`);
  const t = readTodo(file);
  assert.deepEqual(t.carried.map(i => i.t).sort(), ['Livrer la version corrigée', 'Tester sous Safari']);
});
