import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { makeSendLog, bounceOf } from './mailsend.js';
import { makeMail, threadRoot, ownText } from './mail.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mailsend-'));

test('the daily cap holds across instances and resets the next day', () => {
  const file = path.join(tmp(), 'sent.json');
  let now = new Date('2026-11-11T09:00:00+01:00');
  const log = makeSendLog(file, { cap: 2, now: () => now });
  const a = log.start({ to: 'a@x.fr', subject: 's' });
  log.finish(a, 'a@x.fr', { status: 'envoye' });
  log.start({ to: 'b@x.fr', subject: 's' });
  assert.equal(log.remaining(), 0);
  assert.throws(() => makeSendLog(file, { cap: 2, now: () => now }).start({ to: 'c@x.fr' }), /plafond du jour/);
  now = new Date('2026-11-12T00:30:00+01:00');
  assert.equal(log.remaining(), 2);
});

test('an API refusal frees its slot, an uncertain failure does not', () => {
  const log = makeSendLog(path.join(tmp(), 'sent.json'), { cap: 1 });
  const at = log.start({ to: 'a@x.fr' });
  log.finish(at, 'a@x.fr', { status: 'echec' });
  assert.equal(log.remaining(), 1);
  const at2 = log.start({ to: 'a@x.fr' });
  log.finish(at2, 'a@x.fr', { status: 'incertain' });
  assert.equal(log.remaining(), 0);
});

test('one valid address per send, and never one that bounced', () => {
  const log = makeSendLog(path.join(tmp(), 'sent.json'));
  assert.throws(() => log.start({ to: 'a@x.fr, b@x.fr' }), /une seule adresse/);
  assert.throws(() => log.start({ to: 'pas une adresse' }), /une seule adresse/);
  assert.equal(log.recordBounce('Bad@X.fr', { reason: '5.1.1 user unknown' }), true);
  assert.ok(log.isBounced('bad@x.fr'));
  assert.throws(() => log.start({ to: 'bad@x.fr' }), /déjà rebondi/);
  assert.equal(log.recordBounce('nope'), false);
});

test('bounceOf reads the failed recipient of a DSN and ignores ordinary mail', () => {
  const dsn = {
    from: 'MAILER-DAEMON@smtp.infomaniak.ch', subject: 'Undelivered Mail Returned to Sender',
    headers: { 'content-type': 'multipart/report; report-type=delivery-status; boundary="x"' },
    body: 'This is the mail system.\n\n<jean@acme.fr>: host mx.acme.fr said: 550 5.1.1 unknown\n\nFinal-Recipient: rfc822; jean@acme.fr\nStatus: 5.1.1\nDiagnostic-Code: smtp; 550 5.1.1 <jean@acme.fr>: Recipient address rejected',
  };
  const b = bounceOf(dsn, { self: 'christophe@alpes-ia.fr' });
  assert.deepEqual(b.recipients, ['jean@acme.fr']);
  assert.match(b.reason, /550 5\.1\.1/);
  assert.equal(bounceOf({ from: 'jean@acme.fr', subject: 'Re: votre offre', body: 'Bonjour, oui volontiers' }), null);
  // a delay notice is not a failure
  assert.equal(bounceOf({ from: 'postmaster@acme.fr', subject: 'Delivery Status Notification (Delay)', body: 'Final-Recipient: rfc822; jean@acme.fr\nStatus: 4.4.7' }), null);
  assert.deepEqual(bounceOf({ from: 'mailer-daemon@x.fr', subject: 'x', headers: { 'x-failed-recipients': 'paul@b.fr' }, body: '' }).recipients, ['paul@b.fr']);
});

test('thread uids decode to their root message', () => {
  const id = zlib.deflateSync(Buffer.from('thread;591@eJzz9HPyjwAABGYBgQ--@INBOX')).toString('base64').replace(/=/g, '-').replace(/\//g, '_');
  assert.equal(threadRoot(id), '591@eJzz9HPyjwAABGYBgQ--');
  assert.equal(threadRoot('garbage'), null);
});

test('ownText drops the quoted history', () => {
  assert.equal(ownText('Merci !\r\n\r\nLe 10 nov. 2026, Jean a écrit :\r\n> avant'), 'Merci !');
});

// a fake Mail API: the mailbox, one folder, a thread, and drafts
function fakeApi() {
  const calls = [];
  const box = { uuid: 'MB', email: 'christophe@alpes-ia.fr' };
  const thread = { uid: 'T1', messages_count: 1, unseen_messages: 1, date: new Date().toISOString(), subject: 'Devis',
    messages: [{ uid: '7@F1', date: new Date().toISOString(), subject: 'Devis', preview: 'Bonjour', from: [{ email: 'jean@acme.fr', name: 'Jean' }] }] };
  globalThis.fetch = async (url, o = {}) => {
    const u = new URL(url), p = u.pathname.replace('/api', ''), method = o.method ?? 'GET';
    const body = o.body ? JSON.parse(o.body) : null;
    calls.push({ method, p, body });
    const ok = data => ({ ok: true, status: 200, text: async () => JSON.stringify({ result: 'success', data }) });
    if (p === '/mailbox') return ok([{ uuid: 'OTHER', email: 'perso@ikmail.com' }, box]);
    if (p === '/mail/MB/folder') return ok([{ id: 'F1', name: 'INBOX', role: 'INBOX' }]);
    if (p === '/mail/MB/folder/F1/message') return ok({ threads: [thread] });
    if (p === '/mail/MB/folder/F1/message/7') return ok({ uid: '7@F1', date: thread.date, from: thread.messages[0].from, headers: { from: 'Jean <jean@acme.fr>', subject: 'Devis' }, body: { type: 'text/plain', value: 'Bonjour\n> cité' } });
    if (p === '/mail/MB/draft' && method === 'POST') return ok({ uuid: 'D1', uid: '1@DR' });
    if (p === '/mail/MB/draft/D1' && method === 'PUT') return ok({ uuid: 'D1', uid: '2@DR' });
    if (p === '/mail/MB/draft/GONE') return { ok: false, status: 404, text: async () => JSON.stringify({ result: 'error', error: { code: 'draft__not_found', description: 'Draft not found' } }) };
    return { ok: false, status: 500, text: async () => `unexpected ${method} ${p}` };
  };
  return calls;
}
const creds = () => { const d = tmp(); fs.writeFileSync(path.join(d, 'infomaniak.json'), JSON.stringify({ token: 't' })); return d; };

test('the mail module reads the configured mailbox and keeps the Gmail shape', async () => {
  const realFetch = globalThis.fetch;
  try {
    fakeApi();
    const mail = makeMail(creds(), { mailbox: 'christophe@alpes-ia.fr' });
    const g = await mail.flagged({ maxThreads: 5 });
    assert.equal(g.total, 1);
    assert.deepEqual(Object.keys(g.threads[0]).sort(), ['addr', 'bucket', 'count', 'date', 'from', 'id', 'known', 'snippet', 'subject', 'unread', 'url', 'why'].sort());
    assert.equal(g.threads[0].from, 'Jean');
    assert.equal(g.unread, 1);
    const t = await mail.threadText('T1');
    assert.deepEqual(t.map(m => m.texte), ['Bonjour']);
    assert.deepEqual(await mail.createDraft({ to: 'Jean <jean@acme.fr>', subject: 's', body: 'b' }), { id: 'D1', messageId: '1@DR' });
    await assert.rejects(mail.updateDraft('GONE', { to: 'a@b.fr', subject: 's', body: 'b' }), /n'existe plus/);
  } finally { globalThis.fetch = realFetch; }
});

test('send needs an explicit confirmation, sends plain text and logs it', async () => {
  const realFetch = globalThis.fetch;
  try {
    const calls = fakeApi();
    const sendLog = makeSendLog(path.join(tmp(), 'sent.json'), { cap: 1 });
    const mail = makeMail(creds(), { mailbox: 'christophe@alpes-ia.fr', fromName: 'Christophe Havard', sendLog });
    await assert.rejects(mail.send({ to: 'jean@acme.fr', subject: 's', body: 'b' }), /non confirmé/);
    await assert.rejects(mail.send({ to: 'jean@acme.fr', subject: 's', body: 'b' }, { confirmed: 'yes' }), /non confirmé/);
    assert.equal(calls.filter(c => c.p.includes('draft')).length, 0);
    const r = await mail.send({ to: 'jean@acme.fr', subject: 's', body: 'b' }, { confirmed: true });
    assert.equal(r.envoye, true);
    assert.equal(r.restant, 0);
    const sent = calls.find(c => c.method === 'PUT' && c.body?.action === 'send');
    assert.equal(sent.body.mime_type, 'text/plain');
    assert.equal(sent.body.from.email, 'christophe@alpes-ia.fr');
    assert.equal(sendLog.get().sent[0].status, 'envoye');
    await assert.rejects(mail.send({ to: 'paul@acme.fr', subject: 's', body: 'b' }, { confirmed: true }), /plafond/);
  } finally { globalThis.fetch = realFetch; }
});
