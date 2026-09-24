// Publishing on Christophe's own LinkedIn profile through the official API (product
// "Share on LinkedIn", scope w_member_social). Setup: credentials/linkedin_client.json
// ({ client_id, client_secret, redirect_uri? }) from the developer app, then one click on
// "Connecter LinkedIn". The token lasts 60 days and cannot be refreshed programmatically
// outside LinkedIn's partner programme: the dashboard counts the days down.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const AUTH = 'https://www.linkedin.com/oauth/v2/authorization';
const TOKEN = 'https://www.linkedin.com/oauth/v2/accessToken';
const API = 'https://api.linkedin.com';
const SCOPES = 'openid profile w_member_social';
export const MAX_LENGTH = 3000;
const MEDIA = { png: 'images', jpg: 'images', jpeg: 'images', pdf: 'documents', mp4: 'videos', mov: 'videos' };

// The commentary uses LinkedIn's "little" text format: these characters are markup and
// must be backslash-escaped, or the post is cut or garbled (a bare "(" truncates it).
// A "#" starting a word stays a hashtag.
export function littleEscape(text) {
  return String(text).replace(/[\\|{}@[\]()<>*_~]/g, c => '\\' + c).replace(/#(?![\p{L}\p{N}])/gu, '\\#');
}

export function checkPost(text) {
  const t = String(text ?? '').trim();
  if (!t) return 'texte vide';
  if (t.length > MAX_LENGTH) return `texte trop long (${t.length} / ${MAX_LENGTH} caractères)`;
  const holes = t.match(/\[[^\]\n]*\]/g);
  if (holes) return `il reste des passages à compléter : ${[...new Set(holes)].join(' ')}`;
  return null;
}

export function makeLinkedin(credDir, { port, version = '202609' } = {}) {
  const clientPath = path.join(credDir, 'linkedin_client.json');
  const tokenPath = path.join(credDir, 'linkedin_token.json');
  const states = new Map();   // OAuth state → issued at, against CSRF
  const read = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
  const client = () => { const c = read(clientPath); return c?.client_id && c?.client_secret ? c : null; };
  const redirectUri = () => client()?.redirect_uri || `http://localhost:${port}/auth/linkedin/callback`;
  const token = () => { const t = read(tokenPath); return t?.access_token && t.expires_at > Date.now() ? t : null; };

  function status() {
    const t = read(tokenPath);
    const connected = !!token();
    return {
      configured: !!client(), connected, name: t?.name ?? '',
      expiresAt: t?.expires_at ? new Date(t.expires_at).toISOString() : null,
      daysLeft: connected ? Math.floor((t.expires_at - Date.now()) / 864e5) : 0,
    };
  }

  function authUrl() {
    const c = client();
    if (!c) return null;
    const state = crypto.randomBytes(16).toString('hex');
    states.set(state, Date.now());
    const q = new URLSearchParams({ response_type: 'code', client_id: c.client_id, redirect_uri: redirectUri(), state, scope: SCOPES });
    return `${AUTH}?${q}`;
  }

  async function exchange(code, state) {
    const issued = states.get(state);
    states.delete(state);
    if (!issued || Date.now() - issued > 30 * 60e3) throw new Error('état OAuth inconnu ou expiré : relance la connexion depuis Alpes OS');
    const c = client();
    const r = await fetch(TOKEN, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: c.client_id, client_secret: c.client_secret, redirect_uri: redirectUri() }),
    });
    const t = await r.json();
    if (!r.ok || !t.access_token) throw new Error(`LinkedIn a refusé le code : ${t.error_description ?? r.status}`);
    const me = await fetch(`${API}/v2/userinfo`, { headers: { authorization: `Bearer ${t.access_token}` } }).then(x => x.json());
    if (!me.sub) throw new Error('profil LinkedIn illisible (produit « Sign In with LinkedIn using OpenID Connect » ajouté à l\'app ?)');
    fs.writeFileSync(tokenPath, JSON.stringify({ access_token: t.access_token, expires_at: Date.now() + t.expires_in * 1000, scope: t.scope, sub: me.sub, name: me.name ?? '' }, null, 2), { mode: 0o600 });
  }

  async function rest(method, p, body, extra = {}) {
    const t = token();
    if (!t) throw new Error('LinkedIn non connecté ou connexion expirée');
    const r = await fetch(p.startsWith('http') ? p : API + p, {
      method,
      headers: { authorization: `Bearer ${t.access_token}`, 'linkedin-version': version, 'x-restli-protocol-version': '2.0.0', ...(body ? { 'content-type': 'application/json' } : {}), ...extra },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(60e3),
    });
    if (!r.ok) throw Object.assign(new Error(`LinkedIn ${method} ${p.split('?')[0]} : ${r.status} ${(await r.text()).slice(0, 300)}`), { status: r.status });
    return r;
  }
  const owner = () => `urn:li:person:${token().sub}`;
  const put = (url, buf) => fetch(url, { method: 'PUT', headers: { authorization: `Bearer ${token().access_token}` }, body: buf, signal: AbortSignal.timeout(300e3) })
    .then(r => { if (!r.ok) throw new Error(`envoi du fichier refusé : ${r.status}`); return r; });

  async function waitAvailable(kind, urn) {
    for (let i = 0; i < 60; i++) {
      const s = await rest('GET', `/rest/${kind}/${encodeURIComponent(urn)}`).then(r => r.json()).catch(() => null);
      if (s?.status === 'AVAILABLE') return;
      if (s?.status === 'PROCESSING_FAILED') throw new Error(`LinkedIn n'a pas pu traiter le fichier (${kind})`);
      await new Promise(r => setTimeout(r, 3000));
    }
    throw new Error(`le fichier est encore en traitement chez LinkedIn après 3 minutes (${kind})`);
  }

  async function upload(file) {
    const kind = MEDIA[path.extname(file).slice(1).toLowerCase()];
    if (!kind) throw new Error('format de visuel non publiable');
    const buf = fs.readFileSync(file);
    if (kind === 'videos') {
      const init = await rest('POST', '/rest/videos?action=initializeUpload', { initializeUploadRequest: { owner: owner(), fileSizeBytes: buf.length, uploadCaptions: false, uploadThumbnail: false } }).then(r => r.json());
      const { video, uploadToken, uploadInstructions } = init.value;
      const parts = [];
      for (const ins of uploadInstructions) parts.push((await put(ins.uploadUrl, buf.subarray(ins.firstByte, ins.lastByte + 1))).headers.get('etag'));
      await rest('POST', '/rest/videos?action=finalizeUpload', { finalizeUploadRequest: { video, uploadToken: uploadToken ?? '', uploadedPartIds: parts } });
      await waitAvailable('videos', video);
      return video;
    }
    const init = await rest('POST', `/rest/${kind}?action=initializeUpload`, { initializeUploadRequest: { owner: owner() } }).then(r => r.json());
    const urn = init.value.image ?? init.value.document;
    await put(init.value.uploadUrl, buf);
    await waitAvailable(kind, urn);
    return urn;
  }

  // text + optional visual, then the optional first comment. A failure after the post
  // request left without a clear answer is flagged `ambiguous`: never retried blindly.
  async function publish({ text, file = null, title = '', comment = '' }) {
    const bad = checkPost(text);
    if (bad) throw new Error(bad);
    const media = file ? await upload(file) : null;
    const body = {
      author: owner(), commentary: littleEscape(text.trim()), visibility: 'PUBLIC',
      distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
      lifecycleState: 'PUBLISHED', isReshareDisabledByAuthor: false,
      ...(media ? { content: { media: { id: media, ...(media.includes(':document:') ? { title: title || 'Carrousel' } : {}) } } } : {}),
    };
    let urn;
    try {
      const r = await rest('POST', '/rest/posts', body);
      urn = r.headers.get('x-restli-id');
    } catch (e) {
      if (e.status && e.status < 500) throw e;   // refused outright: nothing was published
      throw Object.assign(new Error(`réponse de LinkedIn incertaine : vérifie sur ton profil avant de republier (${e.message})`), { ambiguous: true });
    }
    if (!urn) throw Object.assign(new Error('LinkedIn a accepté la publication sans renvoyer son identifiant : vérifie sur ton profil'), { ambiguous: true });
    const out = { urn, url: `https://www.linkedin.com/feed/update/${urn}/` };
    if (comment.trim()) {
      try { await rest('POST', `/rest/socialActions/${encodeURIComponent(urn)}/comments`, { actor: owner(), object: urn, message: { text: littleEscape(comment.trim()) } }); }
      catch (e) { out.commentError = e.message; }
    }
    return out;
  }

  return {
    status, authUrl, exchange, publish,
    remove: urn => rest('DELETE', `/rest/posts/${encodeURIComponent(urn)}`, null, { 'x-restli-method': 'DELETE' }),
  };
}
