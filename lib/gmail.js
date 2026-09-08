// Gmail read-only access through the user's own OAuth client.
// Setup: put credentials/client_secret.json (Desktop app type) from Google Cloud Console,
// then open http://localhost:<port>/auth/google once. The refresh token lands in credentials/token.json.
import fs from 'node:fs';
import path from 'node:path';
import { OAuth2Client } from 'google-auth-library';

const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];
const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

export function makeGmail(credDir, port) {
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

  const status = () => ({ hasSecret: fs.existsSync(secretPath), hasToken: fs.existsSync(tokenPath) });

  async function api(p, params = {}) {
    const c = getClient();
    const url = `${API}${p}?${new URLSearchParams(params)}`;
    const { token } = await c.getAccessToken();
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error(`Gmail ${p}: ${r.status} ${await r.text()}`);
    return r.json();
  }

  const header = (msg, name) => msg.payload?.headers?.find(h => h.name.toLowerCase() === name)?.value ?? '';

  return {
    status,
    authUrl() { return getClient()?.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: SCOPES }); },
    async exchange(code) { const { tokens } = await getClient().getToken(code); getClient().setCredentials(tokens); fs.writeFileSync(tokenPath, JSON.stringify(tokens, null, 2)); },

    async flagged({ label, maxThreads, newerThanDays }) {
      const { labels } = await api('/labels');
      const lab = labels.find(l => l.name === label);
      if (!lab) throw new Error(`Label "${label}" introuvable`);
      const detail = await api(`/labels/${lab.id}`);
      const list = await api('/threads', { labelIds: lab.id, maxResults: maxThreads, q: `newer_than:${newerThanDays}d` });
      const threads = await Promise.all((list.threads ?? []).map(async t => {
        const th = await api(`/threads/${t.id}`, { format: 'metadata', metadataHeaders: ['From', 'Subject', 'Date'] });
        const last = th.messages[th.messages.length - 1];
        const from = header(last, 'from');
        return {
          id: th.id,
          from: from.replace(/<.*>/, '').replace(/"/g, '').trim() || from,
          subject: header(last, 'subject') || '(sans objet)',
          snippet: last.snippet ?? '',
          date: new Date(header(last, 'date') || Number(last.internalDate)).toISOString(),
          unread: th.messages.some(m => m.labelIds?.includes('UNREAD')),
          count: th.messages.length,
          url: `https://mail.google.com/mail/u/0/#label/${encodeURIComponent(label)}/${th.id}`,
        };
      }));
      threads.sort((a, b) => b.date.localeCompare(a.date));
      return { label, total: detail.threadsTotal, unread: detail.threadsUnread, threads, syncedAt: new Date().toISOString() };
    },
  };
}
