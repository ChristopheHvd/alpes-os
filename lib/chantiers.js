// Chantiers: work the chat agent delegates to a background Claude Code run.
//
// The chat itself has no shell and no file writes. When something has to be
// produced (mockups, code, a document), it hands a self-contained goal to a
// chantier: one git repo per project under chantiers/<projet>/, one worktree and
// branch per chantier, and a headless `claude -p` working there in auto mode —
// nobody is asked anything, but every risky action still goes through Claude
// Code's safety classifier. On top of that, what reaches the outside world
// (push, deploy, MCP servers, the second brain) is blocked outright. Each
// chantier keeps a fixed Claude session, so a new instruction days later resumes
// the same conversation instead of starting blank.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const MAX_KEPT = 200;

const RULES = `Tu travailles sur un chantier délégué par Alpes OS, l'assistant de Christophe
(Alpes IA : automatisation, formation et accompagnement IA pour les TPE et PME).
Personne ne suit ton travail en direct : décide seul, sans poser de question en cours de route.

Règles :
- Tu travailles uniquement dans le dossier courant (un worktree git, sur sa propre branche).
  Commite régulièrement, avec des messages clairs. Ne touche jamais à la branche main.
- Rien ne sort : pas de push, pas de déploiement, pas d'envoi de mail ou de message.
- Le second brain (dossier ajouté en lecture) sert de contexte : lis-le, n'y écris jamais.
- Tiens à jour JOURNAL.md à la racine : ce qui est fait, la prochaine étape, les questions
  ouvertes. Relis-le en premier à chaque reprise : c'est ta mémoire entre deux sessions.
- Si une action t'est refusée, ne cherche pas de contournement : note-le dans JOURNAL.md
  et, si tu ne peux pas avancer sans elle, pose la question en fin de réponse.

Termine TOUJOURS ta réponse finale par ces lignes :
RÉSUMÉ: <ce que tu as fait, en 2-3 phrases>
OUTPUT: <chemin relatif d'un livrable>   (une ligne par livrable)
QUESTION: <ta question>                  (seulement si tu es bloqué et ne peux pas avancer sans réponse)
REPRENDRE: <date ISO> <consigne>         (seulement si une suite doit être relancée plus tard)`;

// Outward-facing actions stay out of reach whatever the goal says.
const BLOCKED = ['Bash(git push:*)', 'Bash(gh:*)', 'Bash(ssh:*)', 'Bash(scp:*)', 'Bash(rsync:*)', 'Bash(npm publish:*)', 'Bash(vercel:*)', 'Bash(netlify:*)'];

export const slugify = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);

// The closing block every run is told to end with (RULES above).
export function parseEnd(text) {
  const out = { resume: null, livrables: [], question: null, reprendre: null };
  let cur = null;
  for (const line of String(text ?? '').split('\n')) {
    const m = line.match(/^\s*\**(RÉSUMÉ|RESUME|OUTPUT|QUESTION|REPRENDRE)\**\s*:\**\s*(.*)$/i);
    if (!m) {
      if (cur && line.trim()) out[cur] += '\n' + line.trim();
      continue;
    }
    const key = m[1].toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const val = m[2].trim();
    cur = null;
    if (key === 'OUTPUT') { if (val) out.livrables.push(val.replace(/^`|`$/g, '')); continue; }
    if (key === 'REPRENDRE') {
      const [at, ...rest] = val.split(/\s+/);
      if (!Number.isNaN(Date.parse(at))) out.reprendre = { at: new Date(at).toISOString(), consigne: rest.join(' ') || 'Reprends la prochaine étape de JOURNAL.md.' };
      continue;
    }
    cur = key === 'RESUME' ? 'resume' : 'question';
    out[cur] = val;
  }
  if (out.question !== null && !out.question.trim()) out.question = null;
  return out;
}

export function makeChantiers(root, cfg = {}, hooks = {}) {
  const dir = path.resolve(root, cfg.dir ?? 'chantiers');
  const storePath = path.join(root, 'output', 'chantiers.json');
  const logDir = path.join(root, 'output', 'chantiers');
  const model = cfg.model ?? 'claude-opus-5-5';
  const maxParallel = cfg.maxParallel ?? 2;
  const maxMs = (cfg.maxMinutes ?? 120) * 60e3;
  const live = new Map();   // id → { child, timer, stopped, timedOut, … }

  let items = [];
  try { if (fs.existsSync(storePath)) items = JSON.parse(fs.readFileSync(storePath, 'utf8')); } catch (e) { /* start empty */ }
  // a run cut by a server restart can't finish on its own — it waits for a resume
  for (const c of items) if (c.statut === 'en_cours') Object.assign(c, { statut: 'interrompu', raison: 'serveur redémarré pendant le run' });

  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 200);
  }
  function saveNow() {
    clearTimeout(saveTimer);
    try {
      fs.mkdirSync(path.dirname(storePath), { recursive: true });
      fs.writeFileSync(storePath, JSON.stringify(items.slice(0, MAX_KEPT), null, 1));
    } catch (e) { /* the next change retries */ }
  }
  const view = c => ({ ...c, enCours: live.has(c.id) });
  const find = id => items.find(c => c.id === id);
  const changed = (c, event) => { save(); try { hooks.onChange?.(view(c), event); } catch (e) { /* a hook never breaks a run */ } };

  const git = (cwd, ...args) => {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`git ${args[0]} : ${(r.stderr || r.stdout).trim()}`);
    return r.stdout.trim();
  };

  function ensureRepo(projet) {
    const repo = path.join(dir, projet);
    if (!fs.existsSync(path.join(repo, '.git'))) {
      fs.mkdirSync(repo, { recursive: true });
      git(repo, 'init', '-q', '-b', 'main');
      git(repo, 'commit', '-q', '--allow-empty', '-m', `Start ${projet}`);
    }
    const exclude = path.join(repo, '.git', 'info', 'exclude');
    const cur = fs.existsSync(exclude) ? fs.readFileSync(exclude, 'utf8') : '';
    if (!cur.split('\n').includes('.worktrees/')) {
      fs.mkdirSync(path.dirname(exclude), { recursive: true });
      fs.appendFileSync(exclude, (cur && !cur.endsWith('\n') ? '\n' : '') + '.worktrees/\n');
    }
    return repo;
  }

  function start({ titre, objectif, projet, chatId }) {
    titre = String(titre ?? '').trim();
    objectif = String(objectif ?? '').trim();
    const proj = slugify(projet || titre);
    if (!titre || !objectif || !proj) throw new Error('titre, objectif et projet requis');
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const slug = `${slugify(titre).slice(0, 40)}-${id.slice(-4)}`;
    const repo = ensureRepo(proj);
    const worktree = path.join(repo, '.worktrees', slug);
    const branche = `chantier/${slug}`;
    git(repo, 'worktree', 'add', '-q', '-b', branche, worktree, 'main');
    const c = {
      id, slug, titre, objectif, projet: proj, chatId: chatId || null,
      sessionId: randomUUID(), sessionStarted: false,
      repo: path.relative(dir, repo), worktree: path.relative(dir, worktree), branche,
      statut: 'en_attente', raison: null, creeLe: new Date().toISOString(),
      etapes: [{ consigne: objectif, debut: null, fin: null, code: null }],
      resume: null, livrables: [], question: null, activite: null, prochaineReprise: null,
    };
    items.unshift(c);
    if (items.length > MAX_KEPT) items.length = MAX_KEPT;
    changed(c, 'cree');
    pump();
    return view(c);
  }

  function resume(id, consigne) {
    const c = find(id);
    if (!c) throw new Error('chantier introuvable');
    if (live.has(id) || c.statut === 'en_attente') throw new Error('ce chantier tourne déjà');
    if (c.statut === 'clos') throw new Error('chantier clos');
    consigne = String(consigne ?? '').trim() || 'Reprends là où tu t\'étais arrêté (voir JOURNAL.md).';
    c.etapes.push({ consigne, debut: null, fin: null, code: null });
    Object.assign(c, { statut: 'en_attente', raison: null, question: null, prochaineReprise: null });
    changed(c, 'relance');
    pump();
    return view(c);
  }

  function stop(id) {
    const c = find(id);
    if (!c) throw new Error('chantier introuvable');
    const l = live.get(id);
    if (l) { l.stopped = true; l.child.kill('SIGTERM'); return view(c); }
    if (c.statut === 'en_attente') { Object.assign(c, { statut: 'interrompu', raison: 'arrêté avant de démarrer' }); changed(c, 'interrompu'); }
    return view(c);
  }

  // Merge the chantier's branch into the project's main and drop its worktree.
  function close(id) {
    const c = find(id);
    if (!c) throw new Error('chantier introuvable');
    if (live.has(id) || c.statut === 'en_attente') throw new Error('arrête le chantier avant de le clôturer');
    if (c.statut === 'clos') return view(c);
    const repo = path.join(dir, c.repo), worktree = path.join(dir, c.worktree);
    if (fs.existsSync(worktree)) {
      if (git(worktree, 'status', '--porcelain')) {
        git(worktree, 'add', '-A');
        git(worktree, 'commit', '-q', '-m', `Wrap up ${c.slug}`);
      }
      git(repo, 'merge', '-q', '--no-ff', '-m', `Merge chantier ${c.slug}`, c.branche);
      git(repo, 'worktree', 'remove', worktree);
      git(repo, 'branch', '-d', c.branche);
    }
    c.livrables = c.livrables.map(f => f.startsWith(c.worktree + '/') ? c.repo + f.slice(c.worktree.length) : f);
    Object.assign(c, { statut: 'clos', prochaineReprise: null });
    changed(c, 'clos');
    return view(c);
  }

  // Start queued chantiers, oldest first, while there is room.
  function pump() {
    for (const c of [...items].reverse()) {
      if (live.size >= maxParallel) return;
      if (c.statut === 'en_attente') launch(c);
    }
  }

  function launch(c) {
    const etape = c.etapes[c.etapes.length - 1];
    const worktree = path.join(dir, c.worktree);
    const first = !c.sessionStarted;
    const prompt = first
      ? `# Chantier : ${c.titre}\nProjet : ${c.projet}\n\n## Objectif\n${etape.consigne}`
      : `## Nouvelle consigne\n${etape.consigne}`;
    const sb = cfg.secondBrain ? path.resolve(cfg.secondBrain) : null;
    const args = [
      '-p', prompt,
      '--model', model,
      ...(first ? ['--session-id', c.sessionId] : ['--resume', c.sessionId]),
      '--output-format', 'stream-json', '--verbose',
      '--permission-mode', 'auto',
      '--strict-mcp-config', '--mcp-config', JSON.stringify({ mcpServers: {} }),
      '--append-system-prompt', RULES,
      ...(sb ? ['--add-dir', sb] : []),
      '--disallowedTools', ...BLOCKED, ...(sb ? [`Edit(/${sb}/**)`, `Write(/${sb}/**)`] : []),
    ];

    fs.mkdirSync(logDir, { recursive: true });
    const logFile = fs.createWriteStream(path.join(logDir, `${c.id}.log`), { flags: 'a' });
    logFile.write(`\n=== ${new Date().toISOString()} ${first ? 'START' : 'RESUME'} ${etape.consigne.slice(0, 200).replace(/\n/g, ' ')}\n`);

    const child = spawn(cfg.bin ?? 'claude', args, { cwd: worktree, env: { ...process.env, CLAUDECODE: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
    const l = { child, stopped: false, timedOut: false, result: null, isError: false, lastText: '', stderr: '' };
    l.timer = setTimeout(() => { l.timedOut = true; child.kill('SIGTERM'); }, maxMs);
    live.set(c.id, l);
    etape.debut = new Date().toISOString();
    Object.assign(c, { statut: 'en_cours', activite: 'démarre' });
    changed(c, 'en_cours');

    let buf = '';
    child.stdout.on('data', d => {
      logFile.write(d);
      buf += d;
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        let ev; try { ev = JSON.parse(line); } catch (e) { continue; }
        if (ev.type === 'system' && ev.subtype === 'init') { if (!c.sessionStarted) { c.sessionStarted = true; save(); } continue; }
        if (ev.type === 'assistant') {
          for (const b of ev.message?.content ?? []) {
            if (b.type === 'tool_use') c.activite = `${b.name} ${String(b.input?.file_path ?? b.input?.command ?? b.input?.pattern ?? '').slice(0, 80)}`.trim();
            if (b.type === 'text' && b.text.trim()) { l.lastText = b.text; c.activite = b.text.trim().split('\n')[0].slice(0, 140); }
          }
          continue;
        }
        if (ev.type === 'result') { l.result = ev.result ?? ''; l.isError = !!ev.is_error; }
      }
    });
    child.stderr.on('data', d => { logFile.write(d); l.stderr = (l.stderr + d).slice(-1000); });
    child.on('error', e => { l.stderr += String(e.message); });
    child.on('close', code => {
      clearTimeout(l.timer);
      live.delete(c.id);
      logFile.end(`\n=== exit ${code}\n`);
      Object.assign(etape, { fin: new Date().toISOString(), code });
      finish(c, l, code);
      pump();
    });
  }

  function finish(c, l, code) {
    c.activite = null;
    if (l.stopped || l.timedOut) {
      Object.assign(c, { statut: 'interrompu', raison: l.stopped ? 'arrêté à la demande' : `délai de ${Math.round(maxMs / 60e3)} min dépassé` });
      return changed(c, 'interrompu');
    }
    if (code !== 0 || l.isError) {
      Object.assign(c, { statut: 'echec', raison: String(l.result || l.stderr || `code ${code}`).slice(-500) });
      return changed(c, 'echec');
    }
    const end = parseEnd(l.result || l.lastText);
    const worktree = path.join(dir, c.worktree);
    const produced = end.livrables
      .map(f => path.resolve(worktree, f))
      .filter(f => (f === worktree || f.startsWith(worktree + path.sep)) && fs.existsSync(f))
      .map(f => path.relative(dir, f));
    Object.assign(c, {
      resume: end.resume ?? String(l.result || l.lastText).trim().slice(-600),
      livrables: [...new Set([...c.livrables, ...produced])],
      question: end.question,
      prochaineReprise: end.reprendre,
      statut: end.question ? 'bloque' : 'pret',
      raison: null,
    });
    changed(c, c.statut);
  }

  // Chantiers whose planned resume date has come.
  const due = (now = Date.now()) => items.filter(c => c.prochaineReprise && ['pret', 'interrompu'].includes(c.statut) && Date.parse(c.prochaineReprise.at) <= now);

  pump();

  return {
    dir,
    list: () => items.map(view),
    get: id => { const c = find(id); return c ? view(c) : null; },
    log: id => { try { return fs.readFileSync(path.join(logDir, `${id}.log`), 'utf8').slice(-8000); } catch (e) { return ''; } },
    start, resume, stop, close, due,
    flush: saveNow,
  };
}
