// The professional mailbox, on Infomaniak, through its Mail API (the one kMail and
// Infomaniak's own MCP server use). An API token in credentials/infomaniak.json
// reads the mailbox, saves drafts and, behind lib/mailsend.js, sends.
// Same interface as the Gmail module it replaced: flagged(), threadText(),
// createDraft(), updateDraft(), so its callers barely changed.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { classify, knownContacts } from './mailfilter.js';
import { bounceOf } from './mailsend.js';

const API = 'https://mail.infomaniak.com/api';
const CLASSIFY_HEADERS = ['from', 'subject', 'list-unsubscribe', 'list-id', 'precedence', 'auto-submitted', 'x-campaign-id'];

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = s => String(s ?? '').replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(parseInt(e[1] === 'x' || e[1] === 'X' ? e.slice(2) : e.slice(1), e[1] === 'x' || e[1] === 'X' ? 16 : 10)) : ENT[e.toLowerCase()] ?? m);
const htmlText = h => decode(String(h).replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>|<\/p>|<\/div>/gi, '\n').replace(/<[^>]+>/g, ' '));
// what the sender wrote in this message, without the quoted history or links
export const ownText = t => {
  const lines = String(t).replace(/\r/g, '').split('\n');
  const cut = lines.findIndex(l => /^\s*(Le .{4,120} a écrit\s*:|On .{4,120} wrote:|-{2,}\s*Original Message|De\s*:\s|From\s*:\s)/i.test(l));
  return (cut > 0 ? lines.slice(0, cut) : lines).filter(l => !/^\s*>/.test(l)).join('\n')
    .replace(/<?https?:\/\/\S+>?/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
};
const person = p => p ? (decode(p.name || '').replace(/"/g, '').trim() || p.email) : '';
const recipients = v => String(v ?? '').split(',').map(x => x.trim()).filter(Boolean)
  .map(x => ({ name: x.match(/^(.*)<[^>]+>$/)?.[1].replace(/"/g, '').trim() ?? '', email: (x.match(/<([^>]+)>/)?.[1] ?? x).trim() }));
// a message uid is "<number>@<folder id>"; the API wants the number in the URL
const msgPath = uid => { const [n, folder] = String(uid).split('@'); return `/folder/${folder}/message/${n}`; };
// thread uids are zlib + base64 of "thread;<message uid>@<folder name>"
export const threadRoot = id => {
  try { return zlib.inflateSync(Buffer.from(String(id).replace(/-/g, '=').replace(/_/g, '/'), 'base64')).toString().match(/^thread;(\d+@[^@]+)@/)?.[1] ?? null; }
  catch (e) { return null; }
};

export function makeMail(credDir, opts = {}) {
  let known = { emails: new Set(), domains: new Set(), names: new Set() };
  const tokenPath = path.join(credDir, 'infomaniak.json');
  const token = () => { try { return JSON.parse(fs.readFileSync(tokenPath, 'utf8')).token || null; } catch (e) { return null; } };
  const status = () => ({ hasToken: !!token(), hasDrafts: !!token(), mailbox: opts.mailbox ?? null });

  async function api(p, { method = 'GET', body } = {}) {
    const t = token();
    if (!t) throw new Error('credentials/infomaniak.json manquant (jeton API Infomaniak)');
    const r = await fetch(`${API}${p}`, { method, headers: { Authorization: `Bearer ${t}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const text = await r.text();
    let data; try { data = JSON.parse(text); } catch (e) { data = null; }
    if (!r.ok || data?.result !== 'success') {
      const err = new Error(`Infomaniak ${p.split('?')[0]}: ${r.status} ${data?.error?.description ?? text.slice(0, 300)}`);
      err.status = r.status; err.code = data?.error?.code;
      throw err;
    }
    return data.data;
  }

  // the mailbox is named in config (mail.mailbox): the token also reaches others
  let box = null;
  async function mailbox() {
    if (box) return box;
    if (!opts.mailbox) throw new Error('config.json : mail.mailbox manquant (adresse de la boîte à lire)');
    const all = await api('/mailbox?with=aliases');
    const m = all.find(b => b.email.toLowerCase() === opts.mailbox.toLowerCase());
    if (!m) throw new Error(`boîte ${opts.mailbox} introuvable avec ce jeton (${all.map(b => b.email).join(', ')})`);
    return (box = m);
  }
  let folders = null;
  async function folderId(name) {
    const { uuid } = await mailbox();
    folders ??= await api(`/mail/${uuid}/folder`);
    const flat = xs => xs.flatMap(f => [f, ...flat(f.children ?? [])]);
    const f = flat(folders).find(f => f.role === name.toUpperCase() || f.name === name);
    if (!f) throw new Error(`dossier « ${name} » introuvable dans ${opts.mailbox}`);
    return f.id;
  }
  async function threads(folder, limit = 100) {
    const { uuid } = await mailbox();
    return (await api(`/mail/${uuid}/folder/${await folderId(folder)}/message?offset=0&thread=on&severywhere=0&limit=${limit}`)).threads ?? [];
  }
  // a delivered message never changes: its headers are read once
  const heads = new Map();
  async function message(uid) {
    const { uuid } = await mailbox();
    return api(`/mail/${uuid}${msgPath(uid)}?prefered_format=plain`);
  }
  async function headersOf(uid) {
    if (!heads.has(uid)) {
      const h = (await message(uid)).headers ?? {};
      heads.set(uid, Object.fromEntries(CLASSIFY_HEADERS.filter(k => h[k]).map(k => [k, [h[k]].flat().join(' ')])));
      if (heads.size > 2000) heads.delete(heads.keys().next().value);
    }
    return heads.get(uid);
  }
  const bodyText = m => m.body?.type?.includes('html') ? htmlText(m.body.value) : String(m.body?.value ?? '');
  // the message uids of a thread seen in the last listing, oldest first
  const threadMsgs = new Map();

  async function draftPayload(uuid, { to, cc, subject, body, inReplyTo = null, references = '' }) {
    const m = await mailbox();
    const name = opts.fromName || m.email.split('@')[0];
    return {
      uuid, subject: String(subject), body: String(body), quote: null, mime_type: 'text/plain',
      from: { id: null, name, email: m.email }, reply_to: { name, email: m.email },
      to: recipients(to), cc: cc ? recipients(cc) : null, bcc: null,
      references, in_reply_to: inReplyTo, in_reply_to_uid: null, forwarded_uid: null, attachments: [],
      identity_id: null, ack_request: false, st_uuid: null, uid: null,
      resource: uuid ? `/api/mail/${m.uuid}/draft/${uuid}` : null,
      priority: 'normal', encrypted: false, encryption_password: '', event_poll_uuid: null, action: 'save', delay: 0,
    };
  }
  async function saveDraft(id, mail) {
    const { uuid } = await mailbox();
    try {
      const d = id
        ? await api(`/mail/${uuid}/draft/${encodeURIComponent(id)}`, { method: 'PUT', body: await draftPayload(id, mail) })
        : await api(`/mail/${uuid}/draft`, { method: 'POST', body: await draftPayload(null, mail) });
      return { id: d.uuid ?? id, messageId: d.uid };
    } catch (e) {
      if (e.status === 404 || e.code === 'draft__not_found') throw new Error("ce brouillon n'existe plus dans la boîte mail (envoyé ou supprimé) : crée-en un nouveau si besoin");
      throw e;
    }
  }

  // one send at a time, so two calls cannot both slip under the cap
  let queue = Promise.resolve();
  async function sendNow({ to, subject, body, inReplyTo, references }) {
    const log = opts.sendLog;
    if (!log) throw new Error("pas de registre d'envoi : envoi désactivé");
    const at = log.start({ to, subject });
    const { uuid } = await mailbox();
    try {
      const d = await api(`/mail/${uuid}/draft`, { method: 'POST', body: await draftPayload(null, { to, subject, body, inReplyTo, references }) });
      await api(`/mail/${uuid}/draft/${d.uuid}`, { method: 'PUT', body: { ...(await draftPayload(d.uuid, { to, subject, body, inReplyTo, references })), uid: d.uid, action: 'send' } });
      log.finish(at, to, { status: 'envoye', id: d.uuid });
      return { envoye: true, to: String(to).trim().toLowerCase(), at, id: d.uuid, restant: log.remaining() };
    } catch (e) {
      // the API said no: nothing left. A network failure may have sent it, so it keeps counting
      log.finish(at, to, { status: e.status ? 'echec' : 'incertain', erreur: e.message.slice(0, 300) });
      throw e;
    }
  }

  return {
    status,
    reloadContacts() { if (opts.secondBrain) known = knownContacts(opts.secondBrain); },

    createDraft(mail) { return saveDraft(null, mail); },
    updateDraft(id, mail) { return saveDraft(id, mail); },

    // Sends one plain-text mail to one address, under the daily cap and never to an
    // address that bounced. Only for code that runs after the user's own click:
    // `confirmed` must be passed as true by that caller. No HTTP route reaches it,
    // so neither the chat nor a delegated agent can.
    send(mail, { confirmed } = {}) {
      if (confirmed !== true) return Promise.reject(new Error('envoi non confirmé par Christophe'));
      const run = queue.then(() => sendNow(mail));
      queue = run.catch(() => {});
      return run;
    },
    sendsLeft: () => opts.sendLog?.remaining() ?? 0,
    isBounced: addr => opts.sendLog?.isBounced(addr) ?? false,

    // Reads the delivery failure notices of the last days and records each failed
    // address in the send log; returns what it found.
    async scanBounces({ folder = 'INBOX', days = 14 } = {}) {
      const log = opts.sendLog;
      if (!log) return [];
      const from = Date.now() - days * 864e5, seen = log.scanned(), found = [];
      const self = (await mailbox()).email;
      const BOUNCER = /mailer-daemon|postmaster|mail-daemon/i;
      for (const t of await threads(folder)) {
        for (const m of t.messages ?? []) {
          if (seen.has(m.uid) || Date.parse(m.date) < from) continue;
          if (!BOUNCER.test(m.from?.[0]?.email ?? '') && !/undeliver|delivery|non remis|non distribu|échec|returned mail/i.test(m.subject ?? '')) continue;
          const full = await message(m.uid);
          const b = bounceOf({ from: m.from?.[0]?.email, subject: m.subject, headers: full.headers ?? {}, body: bodyText(full) }, { self });
          for (const r of b?.recipients ?? []) { log.recordBounce(r, { reason: b.reason, at: new Date(m.date).toISOString(), source: m.uid }); found.push({ addr: r, reason: b.reason }); }
          seen.add(m.uid);
        }
      }
      log.markScanned([...seen]);
      return found;
    },


    // Messages received from given addresses since a date: the replies to prospection.
    // Only the messages that match are read in full.
    // A reply may have been archived or caught as spam before the clock passed: those
    // folders are read too when they exist.
    async messagesDe(addresses, { since, folders = ['INBOX', 'ARCHIVE', 'SPAM'], limit = 200 } = {}) {
      const want = new Set([...addresses].map(a => String(a).trim().toLowerCase()));
      if (!want.size) return [];
      const from = since ? Date.parse(since) : 0, out = [], seen = new Set();
      const all = [];
      for (const f of folders) {
        try { all.push(...await threads(f, limit)); } catch (e) { if (f === 'INBOX') throw e; }
      }
      for (const t of all) {
        for (const m of t.messages ?? []) {
          const addr = String(m.from?.[0]?.email ?? '').toLowerCase();
          if (!want.has(addr) || Date.parse(m.date) < from || seen.has(m.uid)) continue;
          seen.add(m.uid);
          const full = await message(m.uid);
          out.push({ uid: m.uid, thread: t.uid, de: addr, nom: person(m.from?.[0]), sujet: decode(m.subject || t.subject) || '', date: new Date(m.date).toISOString(),
            texte: ownText(bodyText(full)).slice(0, 4000), messageId: [full.headers?.['message-id'] ?? full.msg_id ?? ''].flat()[0] || null });
        }
      }
      return out;
    },

    async threadText(id, { last = 3, maxChars = 1500 } = {}) {
      let uids = threadMsgs.get(id);
      if (!uids) {
        // not in the last listing (a restart, an old reference): look for it in the inbox
        const t = (await threads(opts.folder ?? 'INBOX')).find(t => t.uid === id);
        uids = t ? t.messages.map(m => m.uid) : [threadRoot(id)].filter(Boolean);
      }
      if (!uids.length) throw new Error(`fil ${id} introuvable`);
      const msgs = await Promise.all(uids.slice(-last).map(message));
      return msgs.map(m => ({
        de: person(m.from?.[0]),
        date: new Date(m.date).toISOString(),
        texte: ownText(bodyText(m)).slice(0, maxChars),
      }));
    },

    async flagged({ folder = 'INBOX', maxThreads = 10, newerThanDays = 180, filter = {} }) {
      const since = Date.now() - newerThanDays * 864e5;
      const all = (await threads(folder)).filter(t => Date.parse(t.date) >= since);
      for (const t of all) threadMsgs.set(t.uid, (t.messages ?? []).map(m => m.uid));
      const list = all.slice(0, Math.min(50, maxThreads * 5));
      const items = await Promise.all(list.map(async t => {
        const last = t.messages[t.messages.length - 1];
        const headers = await headersOf(last.uid);
        const c = classify({ headers, threadCount: t.messages_count }, { known, extra: filter });
        const sender = last.from?.[0] ?? {};
        return {
          bucket: c.bucket, why: c.reasons, known: c.isKnown, addr: String(sender.email ?? '').toLowerCase(),
          id: t.uid,
          from: person(sender) || '(inconnu)',
          subject: decode(last.subject || t.subject) || '(sans objet)',
          snippet: decode(last.preview).replace(/[​-‏͏⁠﻿]/g, '').replace(/\s+/g, ' ').trim(),
          date: new Date(last.date).toISOString(),
          unread: (t.unseen_messages ?? 0) > 0,
          count: t.messages_count,
          url: 'https://mail.infomaniak.com/',
        };
      }));
      items.sort((a, b) => b.date.localeCompare(a.date));
      const counts = { personne: 0, auto: 0, bulk: 0 };
      for (const t of items) counts[t.bucket]++;
      const isHidden = filter.isHidden ?? (() => false);
      const visible = items.filter(t => !isHidden(t.id));
      const hiddenCount = items.length - visible.length;
      const kept = visible.filter(t => t.bucket === 'personne').slice(0, maxThreads);
      const others = visible.filter(t => t.bucket !== 'personne').slice(0, 20);
      return {
        label: folder, mailbox: opts.mailbox, syncedAt: new Date().toISOString(),
        inbox: all.length, unread: all.filter(t => (t.unseen_messages ?? 0) > 0).length,
        counts, hiddenCount, threads: kept, others,
        total: kept.length, unreadKept: kept.filter(t => t.unread).length,
      };
    },
  };
}
