// Google OAuth, for the calendar only: mail moved to Infomaniak (lib/mail.js).
import fs from 'node:fs';
import path from 'node:path';
import { OAuth2Client } from 'google-auth-library';

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
];

export function makeGoogle(credDir, port) {
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
    hasCalendarWrite: storedScopes().includes('https://www.googleapis.com/auth/calendar.events'),
  });

  return {
    status,
    authUrl() { return getClient()?.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: SCOPES }); },
    async exchange(code) { const { tokens } = await getClient().getToken(code); getClient().setCredentials(tokens); fs.writeFileSync(tokenPath, JSON.stringify(tokens, null, 2)); },
    async accessToken() { const { token } = await getClient().getAccessToken(); return token; },
  };
}
