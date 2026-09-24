import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { littleEscape, checkPost, makeLinkedin } from './linkedin.js';

test('little format: markup characters escaped, hashtags kept', () => {
  assert.equal(littleEscape('Pépère (mon ordi) @Claude [test] <b> *gras* _x_ ~y~ a|b {c}'),
    'Pépère \\(mon ordi\\) \\@Claude \\[test\\] \\<b\\> \\*gras\\* \\_x\\_ \\~y\\~ a\\|b \\{c\\}');
  assert.equal(littleEscape('#IA #Formation et un # seul'), '#IA #Formation et un \\# seul');
  assert.equal(littleEscape('C:\\chemin'), 'C:\\\\chemin');
});

test('a post with holes, empty or too long is refused', () => {
  assert.match(checkPost('Bonjour [N] fois'), /\[N\]/);
  assert.equal(checkPost('   '), 'texte vide');
  assert.match(checkPost('x'.repeat(3001)), /trop long/);
  assert.equal(checkPost('Un post propre.'), null);
});

test('status and OAuth state before and after configuration', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lk-'));
  const li = makeLinkedin(dir, { port: 4545 });
  assert.deepEqual([li.status().configured, li.status().connected, li.authUrl()], [false, false, null]);
  fs.writeFileSync(path.join(dir, 'linkedin_client.json'), JSON.stringify({ client_id: 'abc', client_secret: 's' }));
  const u = new URL(li.authUrl());
  assert.equal(u.searchParams.get('redirect_uri'), 'http://localhost:4545/auth/linkedin/callback');
  assert.equal(u.searchParams.get('scope'), 'openid profile w_member_social');
  await assert.rejects(li.exchange('code', 'wrong-state'), /état OAuth/);
  fs.writeFileSync(path.join(dir, 'linkedin_token.json'), JSON.stringify({ access_token: 't', expires_at: Date.now() + 10 * 864e5 + 60e3, sub: 'x', name: 'C' }));
  assert.equal(li.status().daysLeft, 10);
});
