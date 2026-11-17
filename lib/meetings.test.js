import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
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
  assert.deepEqual(m.pending(), []);   // no actions in that result

  fs.writeFileSync(result, JSON.stringify([{ id: 'm2', modified_at: '2026-10-07T15:00:00Z', titre: 'Marc', date: '2026-10-07T12:46:00Z', actions: ['Écrire le brief', ' '] }]));
  m.adopt(result, { checkedAt: '2026-10-07T15:30:00.000Z', now });
  assert.deepEqual(m.pending(), [{ id: 'm2', titre: 'Marc', date: '2026-10-07T12:46:00Z', actions: ['Écrire le brief'] }]);
  m.proposed(['m2']);
  assert.deepEqual(m.pending(), []);

  // a failed run leaves no result: nothing moves
  assert.equal(m.adopt(path.join(dir, 'absent.json'), { checkedAt: '2026-10-07T16:00:00.000Z', now }), null);
  assert.equal(m.state().lastCheck, '2026-10-07T15:30:00.000Z');

  // old entries are forgotten once far behind the window
  fs.writeFileSync(result, '[]');
  m.adopt(result, { checkedAt: '2026-12-20T00:00:00.000Z', now: new Date('2026-12-20T00:00:00Z') });
  assert.deepEqual(m.state().done, {});
});

test('a pass runs only when the local Wispr Flow database shows a new or changed meeting', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meet-'));
  const db = path.join(dir, 'flow.sqlite');
  const sql = (q) => execFileSync('sqlite3', [db, q]);
  sql("create table Meetings (id text, createdAt text, modifiedAt text, isDeleted int, isTourDemo int, finalized int)");
  const m = makeMeetings(path.join(dir, 'state.json'));
  const now = new Date('2026-11-17T12:00:00Z');
  assert.equal(m.worthRunning({ now, dbPath: db }), false);
  assert.equal(m.worthRunning({ now, dbPath: path.join(dir, 'absent.sqlite') }), true);

  sql("insert into Meetings values ('a', '2026-11-16 08:01:08.152 +00:00', '2026-11-16 08:35:47.871 +00:00', 0, 0, 0)");
  assert.equal(m.worthRunning({ now, dbPath: db }), false);   // not finalized yet
  sql("update Meetings set finalized = 1");
  assert.equal(m.worthRunning({ now, dbPath: db }), true);

  const result = path.join(dir, 'r.json');
  fs.writeFileSync(result, JSON.stringify([{ id: 'a', modified_at: '2026-11-16T08:35:47.871944Z' }]));
  m.adopt(result, { checkedAt: '2026-11-16T09:00:00.000Z', now });
  assert.equal(m.worthRunning({ now, dbPath: db }), false);
  sql("update Meetings set modifiedAt = '2026-11-16 10:00:00.000 +00:00'");
  assert.equal(m.worthRunning({ now, dbPath: db }), true);
});
