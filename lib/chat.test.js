import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeChat } from './chat.js';

// A stand-in for `claude -p --input-format stream-json`: answers each user
// message after a short delay, echoing what it was told.
const FAKE = `#!/usr/bin/env node
require('node:readline').createInterface({ input: process.stdin }).on('line', l => {
  const text = JSON.parse(l).message.content[0].text;
  setTimeout(() => {
    process.stdout.write(JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'vu: ' + text } } }) + '\\n');
    process.stdout.write(JSON.stringify({ type: 'result', result: 'ok' }) + '\\n');
  }, 150);
});
`;

test('an injected message waits for the running turn, then reaches the agent on its own', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-'));
  const bin = path.join(root, 'fake-claude.cjs');
  fs.writeFileSync(bin, FAKE, { mode: 0o755 });
  const turns = [];
  const chat = makeChat(root, { port: 1, bin, model: 'x', log: { append: (id, t) => turns.push(t) } });
  const seen = [];
  const off = chat.subscribe('conv', m => seen.push(m));

  chat.send('conv', 'bonjour');
  assert.deepEqual(chat.inject('conv', '[Chantier « A » prêt]'), { ok: true, queued: true });
  for (let i = 0; i < 60 && turns.length < 2; i++) await new Promise(r => setTimeout(r, 50));

  assert.deepEqual(turns.map(t => [t.user, t.assistant]), [['bonjour', 'vu: bonjour'], ['[Chantier « A » prêt]', 'vu: [Chantier « A » prêt]']]);
  assert.deepEqual(seen.filter(m => m.type === 'injected').map(m => m.text), ['[Chantier « A » prêt]']);
  assert.equal(seen.filter(m => m.type === 'done').length, 2);
  off();
  chat.close('conv');
});
