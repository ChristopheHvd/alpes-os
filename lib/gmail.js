// Gmail read-only access through the user's own OAuth client.
// Setup: put credentials/client_secret.json (Desktop app type) from Google Cloud Console,
// then open http://localhost:<port>/auth/google once. The refresh token lands in credentials/token.json.
import fs from 'node:fs';
import path from 'node:path';
import { OAuth2Client } from 'google-auth-library';
import { classify, knownContacts } from './mailfilter.js';

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/calendar.readonly',
];
const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

export function makeGmail(credDir, port, opts = {}) {
  let known = { emails: new Set(), domains: new Set(), names: new Set() };
  try { if (opts.secondBrain) known = knownContacts(opts.secondBrain); } catch (e) { /* second brain optional */ }
  const secretPath = path.join(credDir, 'client_secret.json');
  const tokenPath = path.join(credDir, 'token.json');
  let client = null;

  function getClient() {
    if (client) return client;
    if (!fs.existsSync(secretPath)) return null;
    const raw = JSON.parse(fs.readFileSync(secretPath, 'utf8'));
    const c = raw.installed ?? raw.web;
    client = new OAuth2Client(c.client_id, c.client_secret, `http://localhost:${port}/auth/callback`);
    if (fs.existsSync(tokenPath)) client.setCredentials(JSON.parse(fs.readFileSync(tokenPath, 'utf8')));
    client.on('tokens', t => { const cur = fs.existsSync(tokenPath) ? JSON.parse(fs.readFileSync(tokenPath, 'utf8')) : {}; fs.writeFileSync(tokenPath, JSON.stringify({ ...cur, ...t }, null, 2)); });
    return client;
  }

  const storedScopes = () => {
    try { return String(JSON.parse(fs.readFileSync(tokenPath, 'utf8')).scope ?? '').split(' '); } catch (e) { return []; }
  };
  const status = () => ({
    hasSecret: fs.existsSync(secretPath),
    hasToken: fs.existsSync(tokenPath),
    scopes: storedScopes(),
    hasCalendar: storedScopes().includes('https://www.googleapis.com/auth/calendar.readonly'),
  });

  async function api(p, params = {}) {
    const c = getClient();
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) (Array.isArray(v) ? v : [v]).forEach(x => qs.append(k, x));
    const url = `${API}${p}?${qs}`;
    const { token } = await c.getAccessToken();
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error(`Gmail ${p}: ${r.status} ${await r.text()}`);
    return r.json();
  }

  // RFC 2047 encoded words in headers (=?UTF-8?Q?...?= / =?UTF-8?B?...?=) → plain text
  const rfc2047 = v => v.replace(/=\?([^?]+)\?([bqBQ])\?([^?]*)\?=/g, (m, cs, enc, txt) => {
    try {
      const bytes = enc.toLowerCase() === 'b' ? Buffer.from(txt, 'base64') : Buffer.from(txt.replace(/_/g, ' ').replace(/=([0-9A-F]{2})/gi, (x, h) => String.fromCharCode(parseInt(h, 16))), 'latin1');
      return new TextDecoder(cs).decode(bytes);
    } catch { return m; }
  }).replace(/\?=\s+=\?/g, '?==?');
  const header = (msg, name) => rfc2047(msg.payload?.headers?.find(h => h.name.toLowerCase() === name)?.value ?? '');
  const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  const decode = s => String(s ?? '').replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(parseInt(e[1] === 'x' || e[1] === 'X' ? e.slice(2) : e.slice(1), e[1] === 'x' || e[1] === 'X' ? 16 : 10)) : ENT[e.toLowerCase()] ?? m);

  return {
    status,
    authUrl() { return getClient()?.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: SCOPES }); },
    async exchange(code) { const { tokens } = await getClient().getToken(code); getClient().setCredentials(tokens); fs.writeFileSync(tokenPath, JSON.stringify(tokens, null, 2)); },
    async accessToken() { const { token } = await getClient().getAccessToken(); return token; },

    reloadContacts() { if (opts.secondBrain) known = knownContacts(opts.secondBrain); },

    async flagged({ label, maxThreads, newerThanDays, query = '', filter = {} }) {
      const { labels } = await api('/labels');
      const lab = labels.find(l => l.name === label);
      if (!lab) throw new Error(`Label "${label}" introuvable`);
      const q = [query, `newer_than:${newerThanDays}d`].filter(Boolean).join(' ');
      // counts come from the same filtered query, not from the raw label
      const [all, unreadList, list] = await Promise.all([
        api('/threads', { labelIds: lab.id, maxResults: 100, q }),
        api('/threads', { labelIds: lab.id, maxResults: 100, q: `${q} is:unread` }),
        api('/threads', { labelIds: lab.id, maxResults: Math.min(50, maxThreads * 5), q }),
      ]);
      const threads = await Promise.all((list.threads ?? []).map(async t => {
        const th = await api(`/threads/${t.id}`, { format: 'metadata', metadataHeaders: ['From', 'Subject', 'Date', 'List-Unsubscribe', 'List-Id', 'Precedence', 'Auto-Submitted', 'X-Campaign-Id'] });
        const last = th.messages[th.messages.length - 1];
        const from = header(last, 'from');
        const headers = Object.fromEntries((last.payload?.headers ?? []).map(h => [h.name.toLowerCase(), h.value]));
        const c = classify({ headers, threadCount: th.messages.length }, { known, extra: filter });
        return {
          bucket: c.bucket, why: c.reasons, known: c.isKnown,
          id: th.id,
          from: decode(from.replace(/<.*>/, '').replace(/"/g, '').trim() || from),
          subject: decode(header(last, 'subject')) || '(sans objet)',
          snippet: decode(last.snippet).replace(/[\u200b-\u200f\u034f\u2060\ufeff]/g, '').replace(/\s+/g, ' ').trim(),
          date: new Date(header(last, 'date') || Number(last.internalDate)).toISOString(),
          unread: th.messages.some(m => m.labelIds?.includes('UNREAD')),
          count: th.messages.length,
          url: `https://mail.google.com/mail/u/0/#label/${encodeURIComponent(label)}/${th.id}`,
        };
      }));
      threads.sort((a, b) => b.date.localeCompare(a.date));
      const counts = { personne: 0, auto: 0, bulk: 0 };
      for (const t of threads) counts[t.bucket]++;
      const kept = threads.filter(t => t.bucket === 'personne').slice(0, maxThreads);
      const others = threads.filter(t => t.bucket !== 'personne').slice(0, 20);
      return {
        label, query: q, syncedAt: new Date().toISOString(),
        inbox: (all.threads ?? []).length, unread: (unreadList.threads ?? []).length,
        counts, threads: kept, others,
        total: kept.length, unreadKept: kept.filter(t => t.unread).length,
      };
    },
  };
}
