import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeMeetings } from './meetings.js';

test('the window starts a week back, then follows the last check with a day of overlap', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meet-'));
  const m = makeMeetings(path.join(dir, 'state.json'));
  const now = new Date('2026-10-07T12:00:00Z');
  assert.equal(m.window(now).since, '2026-09-30T12:00:00.000Z');
  assert.match(m.brief({ queueDir: '/q', resultFile: '/r.json', now }), /aucune pour le moment/);

  const result = path.join(dir, 'r.json');
  fs.writeFileSync(result, JSON.stringify([{ id: 'm1', modified_at: '2026-10-07T13:44:00Z', titre: 'Marc', fichier: 'x.md' }]));
  assert.equal(m.adopt(result, { checkedAt: '2026-10-07T14:00:00.000Z', now }).length, 1);
  assert.equal(m.window(now).since, '2026-10-06T14:00:00.000Z');
  const b = m.brief({ queueDir: '/q', resultFile: '/r.json', now });
  assert.match(b, /- m1 · 2026-10-07T13:44:00Z/);
  assert.match(b, /dans \/q\//);

  // a failed run leaves no result: nothing moves
  assert.equal(m.adopt(path.join(dir, 'absent.json'), { checkedAt: '2026-10-07T16:00:00.000Z', now }), null);
  assert.equal(m.state().lastCheck, '2026-10-07T14:00:00.000Z');

  // old entries are forgotten once far behind the window
  fs.writeFileSync(result, '[]');
  m.adopt(result, { checkedAt: '2026-12-20T00:00:00.000Z', now: new Date('2026-12-20T00:00:00Z') });
  assert.deepEqual(m.state().done, {});
});
