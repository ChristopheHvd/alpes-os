// What Christophe did in Claude Code today, read from the CLI's own transcripts
// (~/.claude/projects/<folder>/<session>.jsonl): per session, the folder, the span
// of activity and a few short extracts of what he typed. Alpes OS's own headless
// runs (entrypoint sdk-cli: curator, stand-up, chat…) are not his activity.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

const MAX_SESSIONS = 25;
const EXTRACT = 160;
// what the app or another session wraps around a message, not what he wrote
const NOISE = /<(system-reminder|artifact-view-context|task-notification|local-command-stdout|local-command-caveat|command-message)\b[^>]*>[\s\S]*?<\/\1>/g;

export function cleanText(t) {
  return String(t).replace(NOISE, ' ').replace(/<\/?[a-z][\w-]*(?:\s[^>]*)?>/gi, ' ').replace(/\s+/g, ' ').trim();
}

const textOf = c => (typeof c === 'string' ? c : Array.isArray(c) ? c.filter(b => b?.type === 'text').map(b => b.text).join(' ') : '');

// "~/Code/alpes-os/.claude/worktrees/x" → { dossier: 'Code/alpes-os', worktree: 'x' }
export function placeOf(cwd, home = os.homedir()) {
  if (!cwd) return { dossier: '?' };
  if (/scratch-workspaces/.test(cwd)) return { dossier: 'sans dossier' };
  const rel = cwd.startsWith(home + path.sep) ? cwd.slice(home.length + 1) : cwd;
  const m = rel.match(/^(.*?)\/\.claude\/worktrees\/([^/]+)/);
  return m ? { dossier: m[1], worktree: m[2] } : { dossier: rel };
}

async function readSession(file, since) {
  const s = { cwds: {}, branch: '', first: null, last: null, typed: [], headless: false };
  const input = fs.createReadStream(file, 'utf8');
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    const user = line.includes('"type":"user"');
    if (!user && !line.includes('"type":"assistant"')) continue;
    let j;
    try { j = JSON.parse(line); } catch { continue; }
    if (j.type !== 'user' && j.type !== 'assistant') continue;
    if (j.entrypoint === 'sdk-cli') { s.headless = true; input.destroy(); break; }
    const at = Date.parse(j.timestamp);
    if (!(at >= since)) continue;
    s.first ??= at; s.last = at;
    if (j.cwd) s.cwds[j.cwd] = (s.cwds[j.cwd] ?? 0) + 1;
    if (j.gitBranch && j.gitBranch !== 'HEAD') s.branch = j.gitBranch;
    // typed by him: older transcripts carry no turnOrigin at all
    const human = j.turnOrigin === 'human' || (j.turnOrigin === undefined && !j.isMeta && !j.toolUseResult);
    if (j.type === 'user' && human && !j.isSidechain) {
      const t = cleanText(textOf(j.message?.content));
      if (t && !t.startsWith('[Request interrupted')) s.typed.push({ uuid: j.uuid, text: t.slice(0, EXTRACT) });
    }
  }
  // where most of the session happened, not a subfolder it passed through
  s.cwd = Object.entries(s.cwds).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
  return s;
}

const hhmm = ms => new Date(ms).toTimeString().slice(0, 5);

// a transcript that hasn't changed since the last pass isn't read again
const cache = new Map();

export async function claudeActivity({ since, dir = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects') } = {}) {
  const files = [];
  for (const d of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    const sub = path.join(dir, d);
    let names;
    try { names = fs.readdirSync(sub); } catch { continue; }
    for (const f of names) {
      if (!f.endsWith('.jsonl')) continue;
      const abs = path.join(sub, f);
      try { const st = fs.statSync(abs); if (st.mtimeMs >= since) files.push({ abs, key: `${since}:${st.mtimeMs}:${st.size}` }); } catch { /* removed meanwhile */ }
    }
  }
  for (const abs of cache.keys()) if (!files.some(f => f.abs === abs)) cache.delete(abs);
  const read = [];
  for (const { abs, key } of files) {
    let s = cache.get(abs);
    if (s?.key !== key) { s = { key, id: path.basename(abs, '.jsonl').slice(0, 8), ...(await readSession(abs, since)) }; cache.set(abs, s); }
    if (!s.headless && s.first) read.push(s);
  }
  // a resumed or forked conversation starts a new file that copies the old one's
  // messages: each message counts once, in the latest file, and a pure copy goes
  const seen = new Set(), sessions = [];
  for (const s of read.sort((a, b) => b.last - a.last)) {
    const own = s.typed.filter(m => !seen.has(m.uuid));
    s.typed.forEach(m => seen.add(m.uuid));
    if (s.typed.length && !own.length) continue;
    const uniq = [...new Set(own.map(m => m.text))];
    sessions.push({
      id: s.id, ...placeOf(s.cwd), ...(s.branch ? { branche: s.branch } : {}),
      de: hhmm(s.first), a: hhmm(s.last), messages: own.length,
      extraits: uniq.length > 5 ? [...uniq.slice(0, 2), ...uniq.slice(-3)] : uniq,
      last: s.last,
    });
  }
  return sessions.slice(0, MAX_SESSIONS).sort((a, b) => a.de.localeCompare(b.de)).map(({ last, ...s }) => s);
}
