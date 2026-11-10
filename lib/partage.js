// The shared space AlpesIA × Simatis (kDrive): its echanges/ folder holds one file per message
// between Christophe and Marc, never changed once dropped. AlpesOS reaches it through the user's
// own `partage` MCP server (~/.claude.json), the one the agents use, so it holds no key of its own.
// The files are kept as a copy in output/echanges.json: a message read once is never read again.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { claudeJson } from './delegations.js';

const TICK = 2 * 60e3;
const LIGNE = /^- (echanges\/[^\s·]+\.md) · /gm;

// the `partage` server's launch line, null when the user has none
export function serveurPartage(file = claudeJson()) {
  let servers = {};
  try { servers = JSON.parse(fs.readFileSync(file, 'utf8')).mcpServers ?? {}; } catch { /* no config */ }
  const s = Object.values(servers).find(x => /partage-mcp/.test([x.command, ...(x.args ?? [])].join(' ')));
  return s?.command ? { command: s.command, args: s.args ?? [], env: s.env ?? {} } : null;
}

// one tool call over stdio: the server is started for the call and stopped after it
export function appelerPartage(serveur, outil, args = {}, { timeout = 60e3 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(serveur.command, serveur.args, { env: { ...process.env, ...serveur.env }, stdio: ['pipe', 'pipe', 'ignore'] });
    let buf = '', fini = false;
    const fin = (err, v) => { if (fini) return; fini = true; clearTimeout(t); child.kill(); err ? reject(err) : resolve(v); };
    const t = setTimeout(() => fin(new Error('espace partagé : pas de réponse')), timeout);
    child.on('error', e => fin(e));
    child.on('exit', () => fin(new Error('espace partagé : le serveur s\'est arrêté')));
    child.stdout.on('data', d => {
      buf += d;
      for (let i; (i = buf.indexOf('\n')) >= 0;) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (m.id !== 2) continue;
        const text = (m.result?.content ?? []).map(c => c.text).join('\n');
        fin(m.result?.isError || m.error ? new Error(text || m.error?.message || 'espace partagé : échec') : null, text);
      }
    });
    const send = o => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...o }) + '\n');
    send({ id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'alpes-os', version: '1' } } });
    send({ method: 'notifications/initialized' });
    send({ id: 2, method: 'tools/call', params: { name: outil, arguments: args } });
  });
}

const valeur = v => {
  if (/^".*"$/.test(v)) { try { return JSON.parse(v); } catch { /* as typed */ } }
  return v.replace(/^'(.*)'$/, '$1');
};
// what lire_partage returns: a "[path · modifié le…]" line, then the file with its flat header
export function lireFichier(text) {
  const brut = String(text).replace(/^\[[^\n]*\]\n\n/, '');
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/.exec(brut);
  const meta = {};
  for (const l of m ? m[1].split(/\r?\n/) : []) {
    const kv = /^([a-z_]+):[ \t]*(.*)$/.exec(l);
    if (kv) meta[kv[1]] = valeur(kv[2].trim());
  }
  return { meta, texte: (m ? brut.slice(m[0].length) : brut).trim() };
}

// a reply's en_reponse_a may name the file only: the path is the message's id
export const chemin = n => (!n ? null : String(n).includes('/') ? String(n) : `echanges/${n}`);
const iso = (d, repli) => { const t = Date.parse(d); return Number.isNaN(t) ? repli : new Date(t).toISOString(); };

/**
 * @param {object} o
 * @param {string} o.dir output/
 * @param {() => object | null} [o.serveur] the `partage` server's launch line
 * @param {typeof appelerPartage} [o.appeler]
 * @param {(nouveaux: object[]) => void} [o.nouveaux] files that appeared since the last pass, not at the first one
 */
export function makeEchanges({ dir, serveur = serveurPartage, appeler = appelerPartage, nouveaux = () => {} }) {
  const file = path.join(dir, 'echanges.json');
  let data;
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { data = { fichiers: {}, liste: null, releveLe: null, erreur: null }; }
  const save = () => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file + '.tmp', JSON.stringify(data, null, 1));
    fs.renameSync(file + '.tmp', file);
  };
  const actif = () => !!serveur();
  const auteur = () => String(serveur()?.env?.PARTAGE_AUTHOR || 'christophe').toLowerCase();
  const outil = (nom, args) => { const s = serveur(); if (!s) throw new Error('espace partagé non configuré (serveur MCP partage)'); return appeler(s, nom, args); };

  const garder = (c, { meta, texte }, repli) => ({
    id: c, de: String(meta.de ?? '').toLowerCase(), type: meta.type ?? 'info', sujet: String(meta.sujet ?? '') || c.split('/').pop(),
    enReponseA: chemin(meta.en_reponse_a), texte, quand: iso(meta.date, repli),
  });

  // what was archived by the curator leaves echanges/, and the list with it
  let enCours = null;
  function releve() {
    enCours ??= (async () => {
      try {
        const liste = [...String(await outil('lister_partage', { dossier: 'echanges' })).matchAll(LIGNE)].map(m => m[1]);
        const premier = data.liste === null;
        const neufs = [];
        for (const c of liste.filter(x => !data.fichiers[x])) {
          data.fichiers[c] = garder(c, lireFichier(await outil('lire_partage', { chemin: c })), new Date().toISOString());
          neufs.push(data.fichiers[c]);
        }
        for (const c of Object.keys(data.fichiers)) if (!liste.includes(c)) delete data.fichiers[c];
        Object.assign(data, { liste, releveLe: new Date().toISOString(), erreur: null });
        save();
        if (!premier && neufs.length) nouveaux(neufs);
        return { lus: neufs.length };
      } catch (e) {
        data.erreur = e.message;
        save();
        return { erreur: e.message };
      }
    })().finally(() => { enCours = null; });
    return enCours;
  }

  const messages = () => (data.liste ?? []).map(c => data.fichiers[c]).filter(Boolean);

  // Writing in the shared space: only from an explicit send of Christophe's
  async function deposer({ type, sujet, texte, enReponseA }) {
    const r = await outil('deposer_message', { type, sujet, corps: texte, ...(enReponseA ? { en_reponse_a: enReponseA } : {}) });
    let out; try { out = JSON.parse(r); } catch { out = null; }
    if (!out?.chemin) throw new Error(`espace partagé : réponse inattendue (${String(r).slice(0, 120)})`);
    data.fichiers[out.chemin] = { id: out.chemin, de: auteur(), type, sujet, enReponseA: chemin(enReponseA), texte: String(texte).trim(), quand: new Date().toISOString() };
    data.liste = [...(data.liste ?? []), out.chemin];
    save();
    return out.chemin;
  }

  let timer = null;
  function demarrer() {
    if (timer || !actif()) return;
    releve();
    timer = setInterval(releve, TICK);
    timer.unref?.();
  }

  return {
    actif, releve, messages, deposer, demarrer,
    etat: () => ({ actif: actif(), releveLe: data.releveLe, erreur: data.erreur }),
    auteur,
    stop: () => { clearInterval(timer); timer = null; },
  };
}
