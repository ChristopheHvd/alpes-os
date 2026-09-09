// Alpes IA Agentic OS — local command centre.
// One page, one address (http://localhost:4545), a window onto the second brain,
// Gmail, the day's todo and headless micro-apps. It shows, it never stores truth.
import express from 'express';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getGraph, readNote } from './lib/brain.js';
import { readTodo, writeTodo, completeCarried } from './lib/todo.js';
import { makeGmail } from './lib/gmail.js';
import { makeRunner } from './lib/runs.js';
import { listProjects, updateProject } from './lib/projects.js';
import { makeCalendar } from './lib/calendar.js';
import { makeMailState } from './lib/mailstate.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
// Local config stays out of git: it holds real paths, identity and bank details.
// On a fresh clone, seed each file from its .example.json neighbour.
function loadConfig(name) {
  const real = path.join(ROOT, 'config', `${name}.json`);
  const example = path.join(ROOT, 'config', `${name}.example.json`);
  if (!fs.existsSync(real)) {
    if (!fs.existsSync(example)) throw new Error(`config/${name}.json manquant et aucun modèle à côté`);
    fs.copyFileSync(example, real);
    console.log(`config/${name}.json créé depuis le modèle — à compléter avant usage`);
  }
  return JSON.parse(fs.readFileSync(real, 'utf8'));
}
const cfg = loadConfig('config');
const branding = loadConfig('branding');
const todoFile = path.join(cfg.secondBrain, cfg.todoFile);
const gmail = makeGmail(path.join(ROOT, 'credentials'), cfg.port, { secondBrain: cfg.secondBrain });
const mailState = makeMailState(path.join(ROOT, 'output', 'mail-state.json'));
const calendar = makeCalendar(() => gmail.accessToken(), () => gmail.status().hasCalendar, cfg.calendar ?? {});
const runner = makeRunner(ROOT, { ...cfg.claude, apps: cfg.apps, secondBrain: cfg.secondBrain });

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(ROOT, 'public')));
app.use('/output', express.static(path.join(ROOT, 'output'), {
  setHeaders: (res, f) => { if (f.endsWith('.md') || f.endsWith('.txt')) res.type('text/plain; charset=utf-8'); },
}));

app.get('/api/config', (req, res) => res.json({ apps: cfg.apps, gmail: { label: cfg.gmail.label, ...gmail.status() }, brand: { company: branding.company, owner: branding.owner }, secondBrain: cfg.secondBrain }));

// Memory — the visual second brain
app.get('/api/graph', (req, res) => res.json(getGraph(cfg.secondBrain, cfg.brainFolders)));
app.get('/api/note', (req, res) => { const n = readNote(cfg.secondBrain, String(req.query.id ?? '')); n ? res.json(n) : res.status(404).json({ error: 'not found' }); });

// Todo — markdown file in the second brain
app.get('/api/todo', (req, res) => res.json(readTodo(todoFile)));
app.put('/api/todo', (req, res) => res.json(writeTodo(todoFile, Array.isArray(req.body.items) ? req.body.items : [])));
app.post('/api/todo/carried', (req, res) => res.json(completeCarried(todoFile, String(req.body.from), String(req.body.t), req.body.done !== false)));

// Applications — Gmail
app.get('/auth/google', (req, res) => { const u = gmail.authUrl(); u ? res.redirect(u) : res.status(400).send('credentials/client_secret.json manquant'); });
app.get('/auth/callback', async (req, res) => { try { await gmail.exchange(String(req.query.code)); res.redirect('/'); } catch (e) { res.status(500).send(String(e)); } });
let gmailCache = null;
// user decisions ride along with every inbox read
const mailOpts = () => ({ ...cfg.gmail, filter: { ...(cfg.gmail.filter ?? {}), ...mailState.rules(), isHidden: id => mailState.isHidden(id) } });
app.get('/api/gmail', async (req, res) => {
  const st = gmail.status();
  if (!st.hasSecret || !st.hasToken) return res.json({ needsAuth: true, ...st });
  try {
    if (!gmailCache || req.query.refresh || Date.now() - gmailCache.at > 120e3) gmailCache = { at: Date.now(), data: await gmail.flagged(mailOpts()) };
    res.json({ ...gmailCache.data, hidden: mailState.hidden(), notes: mailState.get().notes, senders: mailState.get().senders });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Mail triage — what the user decided about each thread and each sender
const dropCache = () => { gmailCache = null; };
app.get('/api/mail/state', (req, res) => res.json(mailState.get()));
app.post('/api/mail/hide', (req, res) => { mailState.hide(String(req.body.id), { subject: req.body.subject, from: req.body.from }); dropCache(); res.json({ ok: true }); });
app.post('/api/mail/unhide', (req, res) => { req.body.all ? mailState.unhideAll() : mailState.unhide(String(req.body.id)); dropCache(); res.json({ ok: true }); });
app.post('/api/mail/sender', (req, res) => { mailState.sender(req.body.addr, req.body.rule ?? null); dropCache(); res.json({ ok: true }); });
app.post('/api/mail/notes', (req, res) => { mailState.setNotes(req.body.notes); res.json({ ok: true }); });

// Skills — headless runs
app.get('/api/runs', (req, res) => res.json(runner.list(req.query.app ? String(req.query.app) : null)));
app.get('/api/runs/:id', (req, res) => { const r = runner.get(req.params.id); r ? res.json(r) : res.status(404).end(); });
app.post('/api/runs', (req, res) => {
  const a = cfg.apps.find(x => x.id === req.body.app), act = a?.actions.find(x => x.id === req.body.action);
  if (!a || !act || !req.body.brief?.trim()) return res.status(400).json({ error: 'app, action et brief requis' });
  res.json(runner.start({ app: a, action: act, brief: req.body.brief.trim(), model: req.body.model, from: req.body.from }));
});
// Projects — long-running work, read from brain/projects/ in the second brain
app.get('/api/projects', (req, res) => res.json(listProjects(cfg.secondBrain)));
app.patch('/api/projects/:slug', (req, res) => {
  const p = updateProject(cfg.secondBrain, req.params.slug, req.body ?? {});
  p ? res.json(p) : res.status(404).json({ error: 'projet introuvable' });
});

// Calendar — what is coming, used by the widget and by the daily briefing
let calCache = null;
app.get('/api/calendar', async (req, res) => {
  const st = gmail.status();
  if (!st.hasToken) return res.json({ needsAuth: true, events: [] });
  if (!st.hasCalendar) return res.json({ needsScope: true, events: [] });
  try {
    if (!calCache || req.query.refresh || Date.now() - calCache.at > 300e3) calCache = { at: Date.now(), data: await calendar.upcoming({ days: 7 }) };
    res.json(calCache.data);
  } catch (e) { res.status(500).json({ error: e.message, events: [] }); }
});

app.get('/api/calendar/list', async (req, res) => {
  if (!gmail.status().hasCalendar) return res.json({ needsScope: true, calendars: [] });
  try { res.json({ calendars: await calendar.calendars(), configured: cfg.calendar ?? {} }); }
  catch (e) { res.status(500).json({ error: e.message, calendars: [] }); }
});

// Daily briefing — the server assembles what the agent cannot reach on its own
// (live mail and calendar) and hands it over as context for the /briefing skill.
async function briefingContext() {
  const projects = listProjects(cfg.secondBrain).map(p => ({ slug: p.slug, titre: p.title, stade: p.stage, prochaine_etape: p.next, revu_le: p.updated, etapes: p.steps }));
  const todo = readTodo(todoFile);
  let events = [], mails = [];
  try { const c = await calendar.upcoming({ days: 3, max: 12 }); events = c.events.map(e => ({ titre: e.title, debut: e.start, journee_entiere: e.allDay, avec: e.attendees, lieu: e.location })); } catch (e) { /* calendar optional */ }
  try {
    const g = await gmail.flagged({ ...mailOpts(), maxThreads: 8 });
    mails = g.threads.map(t => ({ de: t.from, objet: t.subject, extrait: t.snippet.slice(0, 160), recu: t.date, non_lu: t.unread, contact_connu: t.known }));
  } catch (e) { /* mail optional */ }
  return { date: new Date().toISOString().slice(0, 10), consignes_boite: mailState.get().notes, projets: projects, agenda: events, mails_a_traiter: mails, todo_du_jour: todo.items, taches_reportees: todo.carried };
}
app.get('/api/briefing/context', async (req, res) => res.json(await briefingContext()));
app.post('/api/briefing', async (req, res) => {
  const a = cfg.apps.find(x => x.id === 'briefing');
  if (!a) return res.status(404).json({ error: 'app briefing absente de la config' });
  const ctx = await briefingContext();
  const note = String(req.body?.brief ?? '').trim();
  const brief = `${note || 'Compose ma journée à partir du contexte ci-dessous.'}\n\nCONTEXTE:\n${JSON.stringify(ctx, null, 1)}`;
  res.json(runner.start({ app: a, action: a.actions[0], brief, model: req.body?.model }));
});

app.get('/api/artifacts', (req, res) => res.json(runner.artifacts(req.query.app ? String(req.query.app) : null)));
// everything one app has ever done: its runs, and the files no run claims
app.get('/api/apps/:id', (req, res) => {
  const a = cfg.apps.find(x => x.id === req.params.id);
  if (!a) return res.status(404).json({ error: 'app inconnue' });
  res.json({ app: a, runs: runner.list(a.id), orphans: runner.orphans(a.id) });
});
// read one produced file back so the dashboard can show it without leaving the page
app.get('/api/file', (req, res) => {
  const rel = String(req.query.path ?? '');
  const abs = path.resolve(ROOT, rel);
  if (!abs.startsWith(path.join(ROOT, 'output'))) return res.status(403).json({ error: 'hors du dossier output' });
  if (!fs.existsSync(abs)) return res.status(404).json({ error: 'fichier introuvable' });
  const ext = path.extname(abs).slice(1).toLowerCase();
  const st = fs.statSync(abs);
  const textual = ['md', 'txt', 'html', 'json', 'csv'].includes(ext);
  res.json({ path: rel, name: path.basename(abs), ext, size: st.size, mtime: st.mtimeMs, text: textual && st.size < 2e6 ? fs.readFileSync(abs, 'utf8') : null });
});
// reveal a produced file in Finder
app.post('/api/reveal', (req, res) => {
  const abs = path.resolve(ROOT, String(req.body.path ?? ''));
  if (!abs.startsWith(path.join(ROOT, 'output')) || !fs.existsSync(abs)) return res.status(403).json({ error: 'chemin refusé' });
  spawn('open', ['-R', abs], { detached: true }).unref();
  res.json({ ok: true });
});

app.listen(cfg.port, () => {
  const st = gmail.status();
  console.log(`Alpes IA OS  →  http://localhost:${cfg.port}`);
  console.log(`second brain: ${cfg.secondBrain}`);
  if (!st.hasSecret) console.log('gmail: credentials/client_secret.json manquant (Google Cloud Console → OAuth client "Desktop app")');
  else if (!st.hasToken) console.log(`gmail: ouvrir http://localhost:${cfg.port}/auth/google pour autoriser`);
  else console.log('gmail: autorisé');
});
