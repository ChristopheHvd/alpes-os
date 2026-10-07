// Délégations: a todo task handed to a background Claude Code agent.
//
// Each delegation gets its own working folder under output/delegations/<id>/ and a
// fixed Claude session, so an answer to its question days later resumes the same
// conversation instead of starting blank. The agent runs headless (`claude -p`):
// it may search the web, read anything useful (the second brain first), write in
// its folder and run commands, but the only trace it can leave outside is a Gmail
// draft, through the dashboard's MCP server. Everything else that reaches the
// outside world is either not granted or blocked outright.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const MAX_KEPT = 200;
const MAX_TRACE = 120;

const rules = secondBrain => `Tu es un agent à qui Christophe a délégué une tâche de sa todo depuis Alpes OS,
son tableau de bord (Alpes IA : automatisation, formation et accompagnement IA pour les TPE et
PME, à Annecy). Tu travailles seul, en tâche de fond : va le plus loin possible sans lui. Ne
t'arrête pour poser une question que si tu ne peux vraiment pas avancer sans sa réponse (un
choix qui change le résultat, une information introuvable ailleurs).

Ce que tu peux faire :
- chercher sur le web (WebSearch, WebFetch) ;
- lire tout fichier utile, à commencer par son second brain (${secondBrain}) : clients, projets,
  finance, décisions, journal ;
- lire sa todo, son agenda et sa boîte via les outils du serveur MCP "dashboard" ;
- écrire, calculer et produire des documents dans le dossier courant, ton espace de travail ;
- préparer des mails : l'outil creer_brouillon_mail dépose un brouillon dans sa boîte Gmail,
  qu'il relira et enverra lui-même ; modifier_brouillon_mail réécrit un de tes brouillons.

Ce que tu ne fais jamais :
- Rien ne sort sans lui : pas d'envoi de mail ni de message, pas de formulaire rempli sur un
  site, pas de compte créé, pas de commande ni de paiement, pas de publication. Un brouillon
  Gmail est la seule trace que tu peux laisser à l'extérieur.
- N'écris rien hors du dossier courant. Le second brain se lit, il ne s'écrit pas.
- Si une action t'est refusée, ne cherche pas de contournement : note-le dans RAPPORT.md.

Tiens à jour RAPPORT.md dans le dossier courant : ce que tu as trouvé, ce que tu recommandes,
les brouillons créés (destinataire, objet) et ce qu'il reste à faire de son côté. C'est ce qu'il
lira, et ta mémoire si on te relance : relis-le en premier à chaque reprise. Écris pour quelqu'un
de pressé : l'essentiel en haut, pas de rappel de ce qu'il sait déjà.

Termine TOUJOURS ta réponse finale par ces lignes :
RÉSUMÉ: <une ou deux phrases : où en est la tâche>
OUTPUT: <chemin relatif d'un livrable>   (une ligne par livrable, RAPPORT.md compris)
QUESTION: <ta question>                  (seulement si tu ne peux pas avancer sans sa réponse)`;

// Granted without asking. Writes are not listed: acceptEdits allows them in the
// working folder only, and anything outside it is refused in headless mode.
const ALLOWED = ['Read', 'Glob', 'Grep', 'Bash', 'WebSearch', 'WebFetch', 'TodoWrite', 'Skill', 'mcp__dashboard'];
// Outward-facing actions stay out of reach whatever the task says.
const BLOCKED = ['Task', 'Agent', 'Bash(git push:*)', 'Bash(gh:*)', 'Bash(ssh:*)', 'Bash(scp:*)', 'Bash(rsync:*)',
  'Bash(curl:*)', 'Bash(wget:*)', 'Bash(osascript:*)', 'Bash(open:*)', 'Bash(mail:*)', 'Bash(sendmail:*)',
  'Bash(npm publish:*)', 'Bash(vercel:*)', 'Bash(netlify:*)'];

export const slugify = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

// The closing block every run is told to end with.
export function parseEnd(text) {
  const out = { resume: null, livrables: [], question: null };
  let cur = null;
  for (const line of String(text ?? '').split('\n')) {
    const m = line.match(/^\s*\**(RÉSUMÉ|RESUME|OUTPUT|QUESTION)\**\s*:\**\s*(.*)$/i);
    if (!m) {
      if (cur && line.trim()) out[cur] += '\n' + line.trim();
      continue;
    }
    const key = m[1].toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const val = m[2].trim();
    cur = null;
    if (key === 'OUTPUT') { if (val) out.livrables.push(val.replace(/^`|`$/g, '')); continue; }
    cur = key === 'RESUME' ? 'resume' : 'question';
    out[cur] = val;
  }
  if (out.question !== null && !out.question.trim()) out.question = null;
  return out;
}

function sessionExists(sid) {
  const dir = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects');
  try { return fs.readdirSync(dir).some(d => fs.existsSync(path.join(dir, d, `${sid}.jsonl`))); } catch (e) { return false; }
}

// one line of what the agent is doing, for the widget
function describeTool(name, input = {}) {
  const n = String(name).replace(/^mcp__dashboard__/, '');
  const arg = input.query ?? input.url ?? input.file_path ?? input.pattern ?? input.command ?? input.objet ?? input.q ?? '';
  return `${n}${arg ? ' · ' + String(arg).replace(/\s+/g, ' ').slice(0, 140) : ''}`;
}

export function makeDelegations(root, cfg = {}, hooks = {}) {
  const dir = path.join(root, 'output', 'delegations');
  const storePath = path.join(root, 'output', 'delegations.json');
  const model = cfg.model ?? 'claude-opus-5-5';
  const maxMs = (cfg.maxMinutes ?? 90) * 60e3;
  const live = new Map();   // id → { child, timer, stopped, timedOut }

  let items = [];
  try { if (fs.existsSync(storePath)) items = JSON.parse(fs.readFileSync(storePath, 'utf8')); } catch (e) { /* start empty */ }
  // a run cut by a server restart can't finish on its own — it waits for a resume
  for (const d of items) if (d.statut === 'en_cours') Object.assign(d, { statut: 'interrompu', raison: 'serveur redémarré pendant le travail' });

  let saveTimer = null;
  const saveNow = () => {
    clearTimeout(saveTimer);
    try {
      fs.mkdirSync(path.dirname(storePath), { recursive: true });
      fs.writeFileSync(storePath, JSON.stringify(items.slice(0, MAX_KEPT), null, 1));
    } catch (e) { /* the next change retries */ }
  };
  const save = () => { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 300); };
  const find = id => items.find(d => d.id === id);
  const folder = d => path.join(dir, d.id);
  const rel = (d, f) => path.relative(root, path.join(folder(d), f)).split(path.sep).join('/');
  const view = (d, full) => {
    const { trace, ...rest } = d;
    return { ...rest, enCours: live.has(d.id), dossier: rel(d, '.'), ...(full ? { trace } : {}) };
  };
  const changed = (d, event) => { save(); try { hooks.onChange?.(view(d), event); } catch (e) { /* a hook never breaks a run */ } };
  const trace = (d, kind, text) => {
    d.trace.push({ at: new Date().toISOString(), kind, text: String(text).slice(0, 2000) });
    if (d.trace.length > MAX_TRACE) d.trace.splice(0, d.trace.length - MAX_TRACE);
  };

  function run(d, prompt) {
    fs.mkdirSync(folder(d), { recursive: true });
    const mcp = {
      mcpServers: {
        dashboard: {
          command: process.execPath,
          args: [path.join(root, 'lib', 'mcp-dashboard.js')],
          env: { ALPES_OS_API: `http://localhost:${cfg.port}`, ALPES_OS_AGENT: d.id },
        },
      },
    };
    const deny = [...BLOCKED, ...(cfg.denyRead ?? []).map(p => `Read(/${p}/**)`)];
    const args = [
      '-p', prompt,
      '--model', d.model,
      '--output-format', 'stream-json', '--verbose',
      '--append-system-prompt', rules(cfg.secondBrain),
      '--mcp-config', JSON.stringify(mcp), '--strict-mcp-config',
      '--permission-mode', 'acceptEdits',
      '--allowedTools', ALLOWED.join(','),
      '--disallowedTools', deny.join(','),
      '--disable-slash-commands',
      // user settings carry hooks (RTK rewrites `curl …` into `rtk curl …`) that would
      // slip commands past the deny rules above: the agent runs without them
      '--setting-sources', 'project',
      ...(sessionExists(d.session) ? ['--resume', d.session] : ['--session-id', d.session]),
    ];
    const child = spawn(cfg.bin ?? 'claude', args, { cwd: folder(d), env: { ...process.env, CLAUDECODE: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
    const st = { child, stopped: false, timedOut: false, buf: '', err: '', final: null, isError: false };
    st.timer = setTimeout(() => { st.timedOut = true; child.kill('SIGTERM'); }, maxMs);
    live.set(d.id, st);
    Object.assign(d, { statut: 'en_cours', question: null, raison: null, activite: 'démarrage' });
    changed(d, 'en_cours');

    child.stdout.on('data', chunk => {
      st.buf += chunk;
      const lines = st.buf.split('\n');
      st.buf = lines.pop() ?? '';
      for (const line of lines) {
        let ev; try { ev = JSON.parse(line); } catch { continue; }
        if (ev.type === 'assistant') {
          for (const b of ev.message?.content ?? []) {
            if (b.type === 'text' && b.text.trim()) { trace(d, 'texte', b.text.trim()); d.activite = b.text.trim().split('\n').pop().slice(0, 200); }
            if (b.type === 'tool_use') { const t = describeTool(b.name, b.input); trace(d, 'outil', t); d.activite = t; }
          }
          save();
        } else if (ev.type === 'result') {
          st.final = ev.result ?? '';
          st.isError = !!ev.is_error;
          d.cout = Math.round(((d.cout ?? 0) + (ev.total_cost_usd ?? 0)) * 100) / 100;
        }
      }
    });
    child.stderr.on('data', c => { st.err = (st.err + c).slice(-1500); });
    child.on('error', e => { st.err = e.message; });
    child.on('close', code => {
      clearTimeout(st.timer);
      live.delete(d.id);
      const step = d.etapes[d.etapes.length - 1];
      step.fin = new Date().toISOString();
      d.activite = null;
      if (st.stopped || st.timedOut) {
        Object.assign(d, { statut: 'interrompu', raison: st.stopped ? 'arrêté depuis Alpes OS' : `durée maximale atteinte (${Math.round(maxMs / 60e3)} min)` });
      } else if (code !== 0 || st.isError || st.final === null) {
        Object.assign(d, { statut: 'echec', raison: (st.final || st.err || `code ${code}`).trim().split('\n').slice(-3).join(' ').slice(0, 400) });
      } else {
        const end = parseEnd(st.final);
        const files = end.livrables.map(f => path.normalize(f).replace(/^(\.\/)+/, ''))
          .filter(f => !f.startsWith('..') && !path.isAbsolute(f) && fs.existsSync(path.join(folder(d), f)));
        if (fs.existsSync(path.join(folder(d), 'RAPPORT.md')) && !files.includes('RAPPORT.md')) files.unshift('RAPPORT.md');
        d.livrables = files.map(f => rel(d, f));
        d.resume = end.resume ?? st.final.trim().split('\n').slice(-2).join(' ').slice(0, 400);
        step.resume = d.resume;
        d.question = end.question;
        step.question = end.question;
        d.statut = end.question ? 'bloque' : 'pret';
      }
      trace(d, 'fin', d.statut === 'bloque' ? `Question : ${d.question}` : d.resume ?? d.raison ?? d.statut);
      changed(d, d.statut);
    });
  }

  function create({ tache, contexte = '', source = null }) {
    const t = String(tache ?? '').trim();
    if (!t) throw new Error('tâche vide');
    const day = new Date().toISOString().slice(0, 10);
    let id = `${day}-${slugify(t) || 'tache'}`;
    for (let n = 2; find(id); n++) id = `${day}-${slugify(t)}-${n}`;
    const d = {
      id, tache: t, source, model, session: randomUUID(), statut: 'en_cours', creeLe: new Date().toISOString(),
      etapes: [{ consigne: t, debut: new Date().toISOString() }], livrables: [], brouillons: [], trace: [],
      question: null, resume: null, raison: null, activite: null, cout: 0,
    };
    items.unshift(d);
    run(d, `Tâche déléguée : « ${t} »${contexte ? `\n\nContexte : ${contexte}` : ''}

Commence par chercher dans le second brain ce qui touche à cette tâche (projet, client, décisions,
échéances, contraintes), puis fais-la aussi complètement que possible.`);
    return view(d);
  }

  function reply(id, texte) {
    const d = find(id);
    if (!d) throw new Error('délégation introuvable');
    if (live.has(id)) throw new Error("l'agent travaille encore : attends qu'il ait fini ou arrête-le");
    const t = String(texte ?? '').trim();
    const prompt = d.statut === 'bloque'
      ? `Réponse de Christophe à ta question : ${t || '(pas de réponse : décide toi-même et note ton choix)'}\n\nReprends la tâche là où tu t'étais arrêté (relis RAPPORT.md).`
      : t ? `Nouvelle consigne de Christophe : ${t}\n\nRelis RAPPORT.md, puis applique-la.`
        : 'Reprends la tâche là où tu t\'étais arrêté : relis RAPPORT.md et poursuis.';
    const drafts = d.brouillons.length
      ? `\n\nTes brouillons Gmail pour cette tâche (modifier_brouillon_mail avec leur id pour les corriger) :\n${d.brouillons.map(b => `- ${b.id} · à ${b.to} · « ${b.subject} »`).join('\n')}`
      : '';
    d.etapes.push({ consigne: t || 'reprise', debut: new Date().toISOString() });
    trace(d, 'consigne', t || 'reprise');
    run(d, prompt + drafts);
    return view(d);
  }

  function stop(id) {
    const st = live.get(id);
    if (!st) throw new Error("l'agent ne travaille pas en ce moment");
    st.stopped = true;
    st.child.kill('SIGTERM');
    return { ok: true };
  }

  function close(id) {
    const d = find(id);
    if (!d) throw new Error('délégation introuvable');
    if (live.has(id)) throw new Error("l'agent travaille encore : arrête-le d'abord");
    d.statut = 'clos';
    d.closLe = new Date().toISOString();
    changed(d, 'clos');
    return view(d);
  }

  // one entry per Gmail draft: a rewrite replaces its line instead of adding one
  function noteDraft(id, draft) {
    const d = find(id);
    if (!d) return;
    const i = d.brouillons.findIndex(b => b.id === draft.id);
    const entry = { ...draft, at: new Date().toISOString(), ...(i >= 0 ? { modifie: true } : {}) };
    if (i >= 0) d.brouillons[i] = entry; else d.brouillons.push(entry);
    trace(d, 'brouillon', `${i >= 0 ? 'modifié' : 'créé'} · ${draft.to} · ${draft.subject}`);
    save();
  }
  const ownsDraft = (id, draftId) => !!find(id)?.brouillons.some(b => b.id === draftId);

  return {
    list: ({ all = false } = {}) => items.filter(d => all || d.statut !== 'clos').map(d => view(d)),
    get: id => { const d = find(id); return d ? view(d, true) : null; },
    report: id => { const d = find(id); const f = d && path.join(folder(d), 'RAPPORT.md'); return f && fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : ''; },
    create, reply, stop, close, noteDraft, ownsDraft,
    stopAll: () => { for (const st of live.values()) { st.stopped = true; st.child.kill('SIGTERM'); } saveNow(); },
  };
}
