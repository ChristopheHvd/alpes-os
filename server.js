// Alpes IA Agentic OS — local command centre.
// One page, one address (http://localhost:4545), a window onto the second brain,
// Gmail, the day's todo and headless micro-apps. It shows, it never stores truth.
import express from 'express';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getGraph, readNote } from './lib/brain.js';
import { readTodo, writeTodo, completeCarried, addItem, tidyTodo } from './lib/todo.js';
import { makeGmail } from './lib/gmail.js';
import { makeRunner } from './lib/runs.js';
import { listProjects, updateProject, createProject } from './lib/projects.js';
import { listClients, createClient } from './lib/clients.js';
import { portfolio } from './lib/portfolio.js';
import { listFinance, addEcheance, updateEcheance } from './lib/finance.js';
import { makeCalendar } from './lib/calendar.js';
import { makeMailState } from './lib/mailstate.js';
import { makeCalendarState } from './lib/calendarstate.js';
import { searchBrain } from './lib/search.js';
import { makeChat } from './lib/chat.js';
import { makeStandup, slotNow } from './lib/standup.js';
import { makeChatLog } from './lib/chatlog.js';
import { readCredo, shuffleForDay } from './lib/credo.js';
import { bundle } from './lib/sbqueue.js';

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
// The devis skill now files its final PDFs/HTML in the user's Drive (see
// second-brain/skills/alpes-os/devis/SKILL.md) instead of output/devis/: give it the
// Drive folder to write into, and flag it so the runner doesn't also mandate output/.
// driveRoot matches exactly what --add-dir grants the child process (cfg.drive, the
// "ALPES IA" folder) — not its parent, so a run can never be tracked as having a file
// outside what it was actually allowed to write.
const driveRoot = cfg.drive;
const devisApp = cfg.apps.find(a => a.id === 'devis');
if (devisApp) { devisApp.driveOutput = true; devisApp.addDirs = [cfg.drive]; }
// Alpes OS never edits the second brain: its curator does (second-brain/AGENTS.md).
// Every write below becomes an event in the curator's queue, shown at once through
// a local overlay until the curator has archived it. Env overrides let a test
// instance use its own queue.
// the curator skill only knows this queue: an instance on another queue must never launch it
const CURATOR_QUEUE = path.join(cfg.secondBrain, 'brain', 'inbox');
const sbQueue = path.resolve(process.env.ALPES_OS_SB_QUEUE || cfg.secondBrainQueue || CURATOR_QUEUE);
bundle.configure({
  root: cfg.secondBrain,
  queueDir: sbQueue,
  pendingFile: process.env.ALPES_OS_SB_PENDING || path.join(ROOT, 'output', 'sb-pending.json'),
  // ticking boxes comes in bursts: one todo event per minute of activity at most
  delays: { default: 15e3, [cfg.todoFile]: 60e3 },
});
const todoFile = path.join(cfg.secondBrain, cfg.todoFile);
const gmail = makeGmail(path.join(ROOT, 'credentials'), cfg.port, { secondBrain: cfg.secondBrain });
const standup = makeStandup(cfg.secondBrain);
const mailState = makeMailState(path.join(ROOT, 'output', 'mail-state.json'));
const calState = makeCalendarState(path.join(ROOT, 'output', 'calendar-state.json'));
const calendar = makeCalendar(() => gmail.accessToken(), () => gmail.status().hasCalendar, cfg.calendar ?? {});
// ALPES_OS_PORT lets a worktree run its own instance alongside the user's server.
// gmail keeps cfg.port: Google only knows that redirect URI, so first-time OAuth
// has to happen on it.
const PORT = Number(process.env.ALPES_OS_PORT) || cfg.port;
const chatLog = makeChatLog(cfg.secondBrain);
const chat = makeChat(ROOT, { port: PORT, bin: cfg.claude.bin, model: cfg.chat?.model ?? 'claude-opus-5', log: chatLog });
setInterval(() => chat.sweep(), 5 * 60e3).unref();
const runner = makeRunner(ROOT, { ...cfg.claude, apps: cfg.apps, secondBrain: cfg.secondBrain, driveRoot });

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(ROOT, 'public')));
app.use('/output', express.static(path.join(ROOT, 'output'), {
  setHeaders: (res, f) => { if (f.endsWith('.md') || f.endsWith('.txt')) res.type('text/plain; charset=utf-8'); },
}));
// Les supports de formation vivent dans le second brain (dépôt privé) : ils
// portent des formulations, une progression et des profils clients réels, et
// ce dépôt-ci est public. Le dashboard les monte de là et les sert sous
// /content/cours/, comme si de rien n'était pour le moteur de présentation.
const coursDir = path.join(cfg.secondBrain, 'cours');
// Kits and reference files handed to clients, read-only — the client space links to them
app.use('/content/kits', express.static(path.join(cfg.secondBrain, 'kits'), { dotfiles: 'ignore', index: false }));
app.use('/content/references', express.static(path.join(cfg.secondBrain, 'brain', 'references'), { dotfiles: 'ignore', index: false }));
// a module edited in the deck editor is served in its pending version until integrated
app.use('/content/cours', (req, res, next) => {
  let abs;
  try { abs = path.join(coursDir, decodeURIComponent(req.path)); } catch { return next(); }
  if (!abs.startsWith(coursDir + path.sep) || !abs.endsWith('.md') || !bundle.isPending(abs)) return next();
  res.type('text/plain; charset=utf-8').set('Last-Modified', new Date(bundle.mtime(abs)).toUTCString()).send(bundle.read(abs));
});
app.use('/content/cours', express.static(coursDir, {
  setHeaders: (res, f) => { if (f.endsWith('.md')) res.type('text/plain; charset=utf-8'); },
}));

// Le mode édition du support réécrit le module dans <secondBrain>/cours/. Un
// fichier n'est acceptable que s'il est listé dans le manifest de son deck :
// c'est le garde-fou contre la traversée de chemin. `lastModified` est celui
// reçu du serveur au chargement — s'il ne colle plus, quelqu'un d'autre a écrit
// entre temps (une session Claude dans un terminal) et on refuse plutôt qu'on écrase.
app.put('/api/cours/:deck/:file', (req, res) => {
  try {
    const { deck, file } = req.params;
    if (!/^[a-z0-9-]+$/.test(deck) || !/^[a-z0-9-]+\.md$/.test(file)) return res.status(400).json({ error: 'nom invalide' });
    const dir = path.join(coursDir, deck);
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    if (!manifest.modules?.includes(file)) return res.status(404).json({ error: 'module inconnu de ce support' });

    const target = path.join(dir, file);
    const seen = Date.parse(req.body?.lastModified ?? '');
    const now = bundle.mtime(target);
    // Last-Modified est à la seconde près, mtime à la milliseconde
    if (Number.isFinite(seen) && Math.floor(now / 1000) !== Math.floor(seen / 1000)) {
      return res.status(409).json({ error: 'le fichier a changé sur le disque' });
    }
    const src = String(req.body?.src ?? '');
    if (!src.trim()) return res.status(400).json({ error: 'contenu vide' });
    bundle.replace(target, src, { why: `module ${file} du support ${deck} modifié dans l'éditeur de cours`, subject: `Cours ${deck}/${file}` });
    res.json({ ok: true, lastModified: new Date(bundle.mtime(target)).toUTCString() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/config', (req, res) => res.json({ testQueue: sbQueue !== CURATOR_QUEUE, apps: cfg.apps, gmail: { label: cfg.gmail.label, ...gmail.status() }, brand: { company: branding.company, owner: branding.owner }, secondBrain: cfg.secondBrain }));

// Memory — the visual second brain
app.get('/api/graph', (req, res) => res.json(getGraph(cfg.secondBrain, cfg.brainFolders)));
app.get('/api/note', (req, res) => { const n = readNote(cfg.secondBrain, String(req.query.id ?? '')); n ? res.json(n) : res.status(404).json({ error: 'not found' }); });
// non-markdown files a note links to (a cahier des charges PDF, a reference doc):
// served read-only, straight from the second brain, so those links open something
app.get('/api/sb-file', (req, res) => {
  const rel = String(req.query.path ?? '');
  const abs = path.resolve(cfg.secondBrain, rel);
  if (!abs.startsWith(path.resolve(cfg.secondBrain) + path.sep) || rel.endsWith('.md')) return res.status(403).json({ error: 'chemin refusé' });
  if (!fs.existsSync(abs)) return res.status(404).json({ error: 'fichier introuvable' });
  res.sendFile(abs);
});

// Todo — markdown file in the second brain
app.get('/api/todo', (req, res) => res.json(readTodo(todoFile)));
app.put('/api/todo', (req, res) => res.json(writeTodo(todoFile, Array.isArray(req.body.items) ? req.body.items : [], Array.isArray(req.body.later) ? req.body.later : undefined)));
app.post('/api/todo/carried', (req, res) => res.json(completeCarried(todoFile, String(req.body.from), String(req.body.t), ['x', ' ', '>', '-'].includes(req.body.st) ? req.body.st : req.body.done !== false ? 'x' : ' ')));

// Applications — Gmail
app.get('/auth/google', (req, res) => { const u = gmail.authUrl(); u ? res.redirect(u) : res.status(400).send('credentials/client_secret.json manquant'); });
app.get('/auth/callback', async (req, res) => { try { await gmail.exchange(String(req.query.code)); gmailCache = null; calCache = null; res.redirect('/'); } catch (e) { res.status(500).send(String(e)); } });
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

// Clients — same shape as projects: read the list, or create a note the chat
// links to the project it belongs to.
app.get('/api/clients', (req, res) => res.json(listClients(cfg.secondBrain)));
app.post('/api/clients', (req, res) => {
  try { res.json(createClient(cfg.secondBrain, req.body ?? {})); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// Finance — payment schedules kept in the frontmatter of brain/finance notes
app.get('/api/finance', (req, res) => {
  try { res.json({ notes: listFinance(cfg.secondBrain), clients: listClients(cfg.secondBrain).map(c => ({ slug: c.slug, title: c.title })), projects: listProjects(cfg.secondBrain).map(p => ({ slug: p.slug, client: p.client })) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/finance/:slug/echeances', (req, res) => {
  try { res.json(addEcheance(cfg.secondBrain, req.params.slug, req.body ?? {})); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.patch('/api/finance/:slug/echeances/:idx', (req, res) => {
  try { res.json(updateEcheance(cfg.secondBrain, req.params.slug, Number(req.params.idx), req.body ?? {})); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// Portfolio — clients and their projects cross-read with finance, todo and agenda
let pfEvents = null;
app.get('/api/portfolio', async (req, res) => {
  let events = [];
  try {
    if (gmail.status().hasCalendar) {
      if (!pfEvents || Date.now() - pfEvents.at > 300e3) pfEvents = { at: Date.now(), events: (await calendar.upcoming({ ...calOpts(), days: 21, max: 40 })).events };
      events = pfEvents.events;
    }
  } catch (e) { /* calendar optional */ }
  try { res.json(portfolio(cfg.secondBrain, { todo: readTodo(todoFile), events, alpesRoot: ROOT })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Calendar — what is coming, used by the widget and by the daily standup
let calCache = null;
const calOpts = () => ({ days: 7, excludeOrganizers: calState.deniedOrganizers(), isHidden: id => calState.isHidden(id) });
app.get('/api/calendar', async (req, res) => {
  const st = gmail.status();
  if (!st.hasToken) return res.json({ needsAuth: true, events: [] });
  if (!st.hasCalendar) return res.json({ needsScope: true, events: [] });
  try {
    if (!calCache || req.query.refresh || Date.now() - calCache.at > 300e3) calCache = { at: Date.now(), data: await calendar.upcoming(calOpts()) };
    res.json({ ...calCache.data, hidden: calState.hidden() });
  } catch (e) { res.status(500).json({ error: e.message, events: [] }); }
});

// Calendar triage — hide one event, or set an organiser to never show
const dropCalCache = () => { calCache = null; };
app.post('/api/calendar/hide', (req, res) => { calState.hide(String(req.body.id), { title: req.body.title, start: req.body.start }); dropCalCache(); res.json({ ok: true }); });
app.post('/api/calendar/unhide', (req, res) => { req.body.all ? calState.unhideAll() : calState.unhide(String(req.body.id)); dropCalCache(); res.json({ ok: true }); });
app.post('/api/calendar/organizer', (req, res) => { calState.organizer(req.body.addr, req.body.rule ?? null); dropCalCache(); res.json({ ok: true }); });

app.get('/api/calendar/list', async (req, res) => {
  if (!gmail.status().hasCalendar) return res.json({ needsScope: true, calendars: [] });
  try { res.json({ calendars: await calendar.calendars(), configured: cfg.calendar ?? {} }); }
  catch (e) { res.status(500).json({ error: e.message, calendars: [] }); }
});

// Stand-up — a short conversation, twice a day. The server assembles the facts,
// the agent turns them into questions, the answers come back dictated, and a second
// pass composes the day. The exchange is journaled whatever the second pass does.
function daysSince(iso) { return iso ? Math.floor((Date.now() - Date.parse(iso)) / 864e5) : null; }

async function standupContext(slot) {
  const todo = readTodo(todoFile);
  const projects = listProjects(cfg.secondBrain).map(p => ({
    slug: p.slug, titre: p.title, stade: p.stage, prochaine_etape: p.next,
    revu_le: p.updated, jours_sans_mouvement: daysSince(p.updated),
  }));
  let agenda = [], mails = [], agendaErreur = null;
  try {
    const c = await calendar.upcoming({ ...calOpts(), days: 14, max: 20 });
    if (c.needsScope) agendaErreur = 'lecture agenda non autorisée';
    agenda = c.events.map(e => ({ titre: e.title, debut: e.start, journee_entiere: e.allDay, avec: e.attendees, lieu: e.location, organisateur: e.organizer }));
  } catch (e) { agendaErreur = e.message.slice(0, 200); }
  try {
    const g = await gmail.flagged({ ...mailOpts(), maxThreads: 8 });
    mails = g.threads.map(t => ({ de: t.from, objet: t.subject, extrait: t.snippet.slice(0, 160), recu: t.date, jours: daysSince(t.date), non_lu: t.unread, contact_connu: t.known }));
  } catch (e) { /* mail optional */ }
  return {
    date: new Date().toISOString().slice(0, 10),
    moment: slot,
    heure: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
    second_brain: cfg.secondBrain,
    consignes_boite: mailState.get().notes,
    todo_du_jour: todo.items,
    taches_reportees: todo.carried,
    plus_tard: todo.later,
    max_taches_actives: todo.max,
    projets: projects,
    agenda,
    agenda_erreur: agendaErreur,
    agenda_ecriture: gmail.status().hasCalendarWrite,
    mails_a_traiter: mails,
    standups_recents: standup.last(3),
  };
}

// The headless skill has no calendar tool: it lists the events it wants in a JSON
// file and the server posts them. The file is renamed once read so a retry never
// creates the same event twice. What happened is appended to the compose report.
async function createStandupEvents(date, slot, report) {
  const f = path.join(ROOT, 'output', 'standup', `events-${date}-${slot}.json`);
  if (!fs.existsSync(f)) return;
  const lines = [];
  try {
    const list = JSON.parse(fs.readFileSync(f, 'utf8'));
    fs.renameSync(f, f.replace(/\.json$/, `.done-${Date.now()}.json`));
    for (const ev of Array.isArray(list) ? list : list.events ?? []) {
      const when = new Date(ev.start).toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
      if (!gmail.status().hasCalendarWrite) { lines.push(`- Non posé : ${ev.title} (${when}) — écriture agenda non autorisée, clique « Reconnecter Google »`); continue; }
      try { await calendar.createEvent(ev); lines.push(`- Posé : ${ev.title} (${when})`); }
      catch (e) { lines.push(`- Échec : ${ev.title} (${when}) — ${e.message.slice(0, 160)}`); }
    }
  } catch (e) { lines.push(`- Événements illisibles : ${e.message}`); }
  dropCalCache();
  if (lines.length) fs.appendFileSync(report, `\n## Agenda\n\n${lines.join('\n')}\n`);
}

// The compose step writes the todo it proposes to output/standup/todo-<date>-<slot>.md;
// the server adopts it, tidies it (5 open tasks, Plus tard, duplicates) and sends one
// todo event. An older skill that still ships the todo inside its own event leaves no
// such file, and then the todo is left alone so the two cannot contradict each other.
function adoptComposedTodo(date, slot) {
  const f = path.join(ROOT, 'output', 'standup', `todo-${date}-${slot}.md`);
  if (!fs.existsSync(f)) return null;
  bundle.replace(todoFile, fs.readFileSync(f, 'utf8'), { why: `todo composée par le point du ${date} (${slot})`, subject: 'Todo du jour' });
  return tidyTodo(todoFile);
}

// runs the standup skill and waits for it, since both steps are interactive
function runStandup(action, brief, model) {
  const a = cfg.apps.find(x => x.id === 'standup');
  const act = a?.actions.find(x => x.id === action);
  if (!a || !act) throw new Error("l'app standup est absente de la config");
  return waitRun(runner.start({ app: a, action: act, brief, model: model ?? a.model }));
}

function waitRun(run) {
  return new Promise(resolve => {
    const tick = () => {
      const r = runner.get(run.id);
      if (r && r.status !== 'running') return resolve(r);
      setTimeout(tick, 1000);
    };
    tick();
  });
}

app.get('/api/standup/state', (req, res) => res.json(standup.state()));

// Credo shown full screen while the stand-up thinks: a daily shuffle of config/credo.md
app.get('/api/credo', (req, res) => {
  const slot = req.query.slot === 'soir' ? 'soir' : 'matin';
  const items = readCredo(path.join(ROOT, 'config', 'credo.md'));
  res.json({ daily: 5, items: shuffleForDay(items, `${new Date().toISOString().slice(0, 10)}-${slot}`) });
});
app.get('/api/standup/journal', (req, res) => res.json({ sessions: standup.sessions().slice(-10) }));

app.post('/api/standup/questions', async (req, res) => {
  const slot = req.body?.slot || slotNow();
  try {
    const ctx = await standupContext(slot);
    const out = path.join(ROOT, 'output', 'standup', `questions-${ctx.date}-${slot}.json`);
    const r = await runStandup('questions',
      `questions\n\nMoment : ${slot}. Écris le JSON dans ${out}.\n\nCONTEXTE:\n${JSON.stringify(ctx, null, 1)}`);
    if (!fs.existsSync(out)) return res.status(500).json({ error: "les questions n'ont pas été produites", log: r.output.slice(-800) });
    const data = JSON.parse(fs.readFileSync(out, 'utf8'));
    res.json({ ...data, slot, date: ctx.date, runId: r.id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/standup/compose', async (req, res) => {
  const slot = req.body?.slot || slotNow();
  const questions = Array.isArray(req.body?.questions) ? req.body.questions : [];
  const answers = req.body?.answers ?? {};
  try {
    const ctx = await standupContext(slot);
    // journal the exchange first: what was said must survive a failed composition.
    // A retry resends the same answers, so skip it if already journaled.
    if (!standup.hasExchange(ctx.date, slot, questions)) standup.append({ date: ctx.date, slot, questions, answers });
    const out = path.join(ROOT, 'output', 'standup', `compose-${ctx.date}-${slot}.md`);
    const withAnswers = { ...ctx, reponses: questions.map(q => ({ question: q.text, reponse: String(answers[q.id] ?? '').trim() })) };
    const r = await runStandup('compose',
      `compose\n\nMoment : ${slot}. Écris le compte rendu dans ${out}.\n\nCONTEXTE:\n${JSON.stringify(withAnswers, null, 1)}`);
    await createStandupEvents(ctx.date, slot, out);
    const outcome = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
    if (outcome) standup.append({ date: ctx.date, slot, questions: [], answers: {}, outcome });
    res.json({ ok: r.status === 'done', outcome, todo: adoptComposedTodo(ctx.date, slot) ?? readTodo(todoFile), log: r.status === 'done' ? undefined : r.output.slice(-800) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Search — full text across the second brain, for the chat agent and anything else
app.get('/api/search', (req, res) => {
  try { res.json(searchBrain(cfg.secondBrain, String(req.query.q ?? ''), { limit: Number(req.query.limit) || 8 })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/projects', (req, res) => {
  try { res.json(createProject(cfg.secondBrain, req.body ?? {})); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/todo/add', (req, res) => {
  try { res.json(addItem(todoFile, req.body ?? {})); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/calendar/event', async (req, res) => {
  if (!gmail.status().hasCalendarWrite) return res.status(403).json({ error: "l'écriture agenda n'est pas autorisée : reconnecte Google depuis le widget Aujourd'hui" });
  try { const e = await calendar.createEvent(req.body ?? {}); dropCalCache(); res.json(e); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// Chat — the agent behind the bottom bar. One SSE stream per conversation, the
// message goes in over POST, and writes come back as confirmation cards.
app.get('/api/chat/stream', (req, res) => {
  const id = String(req.query.id ?? 'default');
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  res.write(': ok\n\n');
  const off = chat.subscribe(id, msg => res.write(`data: ${JSON.stringify(msg)}\n\n`));
  const beat = setInterval(() => res.write(': ping\n\n'), 20e3);
  req.on('close', () => { clearInterval(beat); off(); });
});
app.post('/api/chat', (req, res) => {
  const text = String(req.body?.text ?? '').trim();
  if (!text) return res.status(400).json({ error: 'message vide' });
  try { res.json(chat.send(String(req.body.id ?? 'default'), text)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
// Past conversations, read back from the second brain: without an id the list,
// with one the transcript.
app.get('/api/chat/log', (req, res) => {
  const id = req.query.id ? String(req.query.id) : '';
  if (id) return res.json(chatLog.one(id) ?? { id, body: '' });
  res.json(chatLog.sessions().map(({ body, ...s }) => s));
});
app.post('/api/chat/decision', (req, res) => res.json(chat.decide(String(req.body?.id ?? 'default'), String(req.body?.key ?? ''), !!req.body?.approved)));
app.delete('/api/chat', (req, res) => { chat.close(String(req.query.id ?? 'default')); res.json({ ok: true }); });
// called by the MCP server, which blocks until the user decides
app.post('/api/chat/propose', async (req, res) => {
  try { res.json(await chat.propose(String(req.body?.id ?? 'default'), req.body?.action ?? {})); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// "Sans questions" — the same composition as the stand-up, minus the interview.
// It used to be its own /briefing skill; standup's `compose` does exactly this
// when `reponses` is empty, so there is one skill instead of two.
app.post('/api/briefing', async (req, res) => {
  try {
    const slot = req.body?.slot || slotNow();
    const ctx = await standupContext(slot);
    const a = cfg.apps.find(x => x.id === 'standup');
    const act = a?.actions.find(x => x.id === 'compose');
    if (!a || !act) return res.status(404).json({ error: "l'app standup est absente de la config" });
    const out = path.join(ROOT, 'output', 'standup', `compose-${ctx.date}-${slot}.md`);
    const brief = `compose\n\nMoment : ${slot}. Aucune réponse à exploiter, compose à partir du seul contexte. Écris le compte rendu dans ${out}.\n\nCONTEXTE:\n${JSON.stringify({ ...ctx, reponses: [] }, null, 1)}`;
    const run = runner.start({ app: a, action: act, brief, model: req.body?.model ?? a.model });
    waitRun(run).then(async () => { adoptComposedTodo(ctx.date, slot); await createStandupEvents(ctx.date, slot, out); });
    res.json(run);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Second brain sync — what is waiting for the curator, and a way to run it
const CURATOR = {
  id: 'curator', name: 'Second cerveau', description: 'Intègre les changements en attente', skill: '/second-brain-curator',
  model: cfg.claude.defaultModel, output: 'output/curator', addDirs: [cfg.drive],
  actions: [{ id: 'integrer', label: 'Intégrer les changements', placeholder: '' }],
};
let curatorRun = null;
function integrate(reason) {
  if (sbQueue !== CURATOR_QUEUE) return { error: `file de test (${sbQueue}) : le curateur ne traite que ${CURATOR_QUEUE}` };
  if (curatorRun && runner.get(curatorRun.id)?.status === 'running') return { error: 'intégration déjà en cours' };
  bundle.flush();
  const st = bundle.status();
  if (st.locked) return { error: 'le curateur tient déjà le verrou (curator.lock)' };
  if (!st.inbox && !st.processing) return { error: 'rien à intégrer' };
  curatorRun = runner.start({
    app: CURATOR, action: CURATOR.actions[0],
    brief: `Traite la file du Second Brain, brain/inbox (${reason}). Suis ton protocole exclusif : verrou atomique, arbre propre sur main, dépôts dans l'ordre (documents rangés dans Drive), lint, commit et push, archivage, libération du verrou. Si un événement est en conflit, laisse-le dans processing et explique le point à trancher.`,
  });
  waitRun(curatorRun).then(() => bundle.settle());
  return { run: curatorRun };
}
// the curator stops on a dirty tree: don't spend a run finding that out every 2 hours
function brainClean() {
  try { return spawnSync('git', ['-C', cfg.secondBrain, 'status', '--porcelain'], { encoding: 'utf8', timeout: 5000 }).stdout.trim() === ''; }
  catch { return false; }
}
const runInfo = r => r && { id: r.id, status: r.status, startedAt: r.startedAt, endedAt: r.endedAt, tail: r.status === 'running' ? '' : r.output.slice(-600) };
app.get('/api/sb/status', (req, res) => res.json({ ...bundle.status(), clean: brainClean(), run: runInfo(curatorRun && runner.get(curatorRun.id)) }));
app.post('/api/sb/integrate', (req, res) => {
  const r = integrate('demandé depuis le dashboard');
  r.error ? res.status(409).json(r) : res.json({ run: runInfo(r.run) });
});
// only new events trigger the automatic pass: one stuck in processing needs a human
setInterval(() => {
  try {
    bundle.flush();
    const st = bundle.status();
    if (st.inbox && !st.locked && brainClean()) integrate('passage automatique');
  } catch (e) { console.error('curator', e.message); }
}, 2 * 60 * 60e3).unref();

app.get('/api/artifacts', (req, res) => res.json(runner.artifacts(req.query.app ? String(req.query.app) : null)));
// everything one app has ever done: its runs, and the files no run claims
app.get('/api/apps/:id', (req, res) => {
  const a = cfg.apps.find(x => x.id === req.params.id);
  if (!a) return res.status(404).json({ error: 'app inconnue' });
  res.json({ app: a, runs: runner.list(a.id), orphans: runner.orphans(a.id) });
});
// A produced-file path is either root-relative (inside output/) or, for Drive-routed
// apps like devis, "drive:<path relative to driveRoot>" — resolve either form to a
// safe absolute path, or null if it escapes its allowed root.
function resolveArtifact(rel) {
  if (rel.startsWith('drive:')) {
    const abs = path.resolve(driveRoot, rel.slice('drive:'.length));
    return abs === driveRoot || abs.startsWith(driveRoot + path.sep) ? abs : null;
  }
  const abs = path.resolve(ROOT, rel);
  const outRoot = path.join(ROOT, 'output');
  return abs === outRoot || abs.startsWith(outRoot + path.sep) ? abs : null;
}
// read one produced file back so the dashboard can show it without leaving the page
app.get('/api/file', (req, res) => {
  const rel = String(req.query.path ?? '');
  const abs = resolveArtifact(rel);
  if (!abs) return res.status(403).json({ error: 'chemin refusé' });
  if (!fs.existsSync(abs)) return res.status(404).json({ error: 'fichier introuvable' });
  const ext = path.extname(abs).slice(1).toLowerCase();
  const st = fs.statSync(abs);
  const textual = ['md', 'txt', 'html', 'json', 'csv'].includes(ext);
  res.json({ path: rel, name: path.basename(abs), ext, size: st.size, mtime: st.mtimeMs, text: textual && st.size < 2e6 ? fs.readFileSync(abs, 'utf8') : null });
});
// reveal a produced file in Finder
app.post('/api/reveal', (req, res) => {
  const abs = resolveArtifact(String(req.body.path ?? ''));
  if (!abs || !fs.existsSync(abs)) return res.status(403).json({ error: 'chemin refusé' });
  spawn('open', ['-R', abs], { detached: true }).unref();
  res.json({ ok: true });
});

app.listen(PORT, () => {
  const st = gmail.status();
  console.log(`Alpes IA OS  →  http://localhost:${PORT}`);
  console.log(`second brain: ${cfg.secondBrain}`);
  if (!st.hasSecret) console.log('gmail: credentials/client_secret.json manquant (Google Cloud Console → OAuth client "Desktop app")');
  else if (!st.hasToken) console.log(`gmail: ouvrir http://localhost:${PORT}/auth/google pour autoriser`);
  else console.log('gmail: autorisé');
});
