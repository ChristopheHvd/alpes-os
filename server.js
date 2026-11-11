// AlpesOS — local command centre.
// One page, one address (http://localhost:4545), a window onto the second brain,
// the mailbox, the day's todo and headless micro-apps. It shows, it never stores truth.
import express from 'express';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getGraph, readNote } from './lib/brain.js';
import { readTodo, writeTodo, completeCarried, addItem, tidyTodo } from './lib/todo.js';
import { makeGoogle } from './lib/google.js';
import { makeMail } from './lib/mail.js';
import { makeSendLog } from './lib/mailsend.js';
import { makeProspection } from './lib/prospection.js';
import * as prIa from './lib/prospection-ia.js';
import * as prCp from './lib/campagne.js';
import { tick as prTick, ouvert as prOuvert } from './lib/prospection-envoi.js';
import { makeWaalaxy } from './lib/waalaxy.js';
import { makeRunner } from './lib/runs.js';
import { listProjects, updateProject, createProject } from './lib/projects.js';
import { listClients, createClient } from './lib/clients.js';
import { portfolio } from './lib/portfolio.js';
import { listFinance, addEcheance, updateEcheance, removeEcheance, createFinanceNote } from './lib/finance.js';
import { makeCalendar } from './lib/calendar.js';
import { makeMailState } from './lib/mailstate.js';
import { makeCalendarState } from './lib/calendarstate.js';
import { makeProjectsOrder } from './lib/projectsorder.js';
import { searchBrain } from './lib/search.js';
import { makeChat, SYSTEM as CHAT_SYSTEM } from './lib/chat.js';
import { makeDelegations, listSkills, listMcp, userSkillsDir, RULES as AGENT_RULES } from './lib/delegations.js';
import { makeMeetings, MEETINGS_TOOLS, BRIEF as MEETINGS_BRIEF } from './lib/meetings.js';
import { makeStandup, slotNow } from './lib/standup.js';
import { makeChatLog } from './lib/chatlog.js';
import { readCredo, shuffleForDay } from './lib/credo.js';
import { bundle } from './lib/sbqueue.js';
import { makeLinkedin, checkPost } from './lib/linkedin.js';
import { loadLinkedin, updatePost, visualFor, localToday, dueForPreparation, toProduce, planFrame, parsePrepared, planFile } from './lib/linkedin-plan.js';
import { makePropositions, moneyKey, same } from './lib/propositions.js';
import { assemble, namesOf, mentions, journalEntries } from './lib/dossier.js';
import { makeReview, SYSTEM as REVIEW_SYSTEM } from './lib/review.js';
import { makeReglages, pick, MODELS, EFFORTS } from './lib/reglages.js';
import { makePartenaires, evenementFait, deposerEvenement } from './lib/partenaires.js';
import { makeEchanges } from './lib/partage.js';
import { askClaude, fichesPartenaire, makeMemoire, makeSujets, reponseAgent, REPONSE_SCHEMA, REPONSE_SYSTEM, SUJETS_SCHEMA, SUJETS_SYSTEM } from './lib/echange.js';
import { claudeActivity } from './lib/activity.js';

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
// AlpesOS never edits the second brain: its curator does (second-brain/AGENTS.md).
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
const google = makeGoogle(path.join(ROOT, 'credentials'), cfg.port);
// Mail is the Infomaniak mailbox (cfg.mail; cfg.gmail is the section's former name).
// Google stays for the calendar only.
const mailCfg = { folder: 'INBOX', ...(cfg.mail ?? cfg.gmail ?? {}) };
const mail = makeMail(path.join(ROOT, 'credentials'), {
  secondBrain: cfg.secondBrain, mailbox: mailCfg.mailbox, fromName: mailCfg.fromName, folder: mailCfg.folder,
  sendLog: makeSendLog(path.join(ROOT, 'output', 'mail-sent.json'), { cap: mailCfg.dailyCap ?? 15 }),
});
const standup = makeStandup(cfg.secondBrain);
const mailState = makeMailState(path.join(ROOT, 'output', 'mail-state.json'));
const calState = makeCalendarState(path.join(ROOT, 'output', 'calendar-state.json'));
const projectsOrder = makeProjectsOrder(path.join(ROOT, 'output', 'projects-order.json'));
const calendar = makeCalendar(() => google.accessToken(), () => google.status().hasCalendar, cfg.calendar ?? {});
// ALPES_OS_PORT lets a worktree run its own instance alongside the user's server.
// google keeps cfg.port: Google only knows that redirect URI, so first-time OAuth
// has to happen on it.
const PORT = Number(process.env.ALPES_OS_PORT) || cfg.port;
const chatLog = makeChatLog(cfg.secondBrain);
// Réglages — every function that calls Claude. Its model and effort come from the
// Réglages screen, then config.json, then the code's default ([config, default] below);
// those with a prompt in the code can have it replaced there. All of it is read at
// each launch, so a change needs no restart.
const reglages = makeReglages(path.join(ROOT, 'config'));
const FUNCTIONS = [
  { id: 'assistant', name: 'Assistant', model: [cfg.chat?.model, 'claude-opus-5'], prompt: CHAT_SYSTEM },
  { id: 'agents', name: 'Agents délégués', model: [cfg.delegations?.model, 'claude-opus-5-5'], effort: [cfg.delegations?.effort, 'medium'], prompt: AGENT_RULES },
  { id: 'revue', name: 'Revue horaire', model: [cfg.review?.model, 'claude-haiku-5-5'], prompt: REVIEW_SYSTEM },
  { id: 'reunions', name: 'Réunions Wispr Flow', model: [cfg.claude.defaultModel], prompt: MEETINGS_BRIEF },
  { id: 'linkedin', name: 'Post LinkedIn', model: [cfg.linkedin?.model, 'claude-opus-5'], skill: 'linkedin-post' },
  ...cfg.apps.map(a => ({ id: a.id, name: a.name, model: [a.model, cfg.claude.defaultModel], skill: a.skill?.replace(/^\//, ''), uses: a.skillsUsed ?? [] })),
  { id: 'curateur', name: 'Second cerveau', model: [cfg.claude.defaultModel], skill: 'second-brain-curator' },
  { id: 'sujets', name: 'Échanges : rangement par sujet', model: ['claude-haiku-5-5'], prompt: SUJETS_SYSTEM },
  { id: 'reponse-partenaire', name: 'Échanges : réponse par l\'agent', model: [cfg.claude.defaultModel], prompt: REPONSE_SYSTEM },
  { id: 'prospection-messages', name: 'Prospection : messages des campagnes', model: [cfg.prospection?.model, 'claude-opus-5-5'], effort: ['medium'], prompt: prIa.MESSAGES_SYSTEM },
  { id: 'prospection-reponses', name: 'Prospection : lecture des réponses', model: [cfg.prospection?.model, 'claude-sonnet-5-5'], effort: ['low'], prompt: prIa.REPONSE_SYSTEM },
  { id: 'prospection-recherche', name: 'Prospection : recherche des coordonnées', model: [cfg.prospection?.model, 'claude-sonnet-5-5'], effort: ['low'], prompt: prIa.RECHERCHE_SYSTEM },
  { id: 'prospection-cible', name: 'Prospection : cible à partir d\'une phrase', model: [cfg.prospection?.model, 'claude-sonnet-5-5'], effort: ['low'], prompt: prIa.CIBLE_SYSTEM },
];
function setting(id) {
  const f = FUNCTIONS.find(x => x.id === id) ?? {};
  return { model: reglages.model(id, ...(f.model ?? [])), effort: reglages.effort(id, ...(f.effort ?? [])) };
}
const chat = makeChat(ROOT, {
  port: PORT, bin: cfg.claude.bin, log: chatLog,
  get model() { return setting('assistant').model; },
  get effort() { return setting('assistant').effort; },
  get system() { return reglages.prompt('assistant', CHAT_SYSTEM); },
});
setInterval(() => chat.sweep(), 5 * 60e3).unref();
// Délégations: a todo task handed to a background agent. Each finished pass is
// journaled in the second brain with its report, through the curator's queue.
const DELEG_HEADER = `---
type: Journal
title: Délégations
description: Tâches de la todo confiées à un agent depuis AlpesOS — résultat et rapport de chaque passage.
tags: [journal, delegation, alpes-os]
status: draft
---

# Délégations

`;
const delegations = makeDelegations(ROOT, {
  port: PORT, bin: cfg.claude.bin, secondBrain: cfg.secondBrain, maxMinutes: cfg.delegations?.maxMinutes,
  get model() { return setting('agents').model; },
  get effort() { return setting('agents').effort; },
  get rules() { return reglages.prompt('agents', AGENT_RULES); },
  skillOn: name => reglages.skillOn(name),
  mcpOn: name => reglages.mcpOn(name),
  denyRead: [path.join(ROOT, 'credentials'), path.join(ROOT, 'config')],
}, {
  onChange(d, event) {
    // a partner's mission run by an agent: its end decides what goes back (lib/partenaires.js)
    if (d.source?.type === 'mission') partenaires.surDelegation(d, event).catch(e => console.error('partenaires', e.message));
    if (event !== 'pret' && event !== 'bloque') return;
    const report = delegations.report(d.id).trim().slice(0, 12000);
    const block = [`## ${new Date().toISOString().slice(0, 10)} · ${d.tache}`, '',
      `Statut : ${event === 'pret' ? 'terminé, à relire' : 'en attente de réponse'}${d.question ? ` — question : ${d.question}` : ''}`,
      d.resume ? `\n${d.resume}` : '',
      d.brouillons.length ? `\nBrouillons mail : ${d.brouillons.map(b => `${b.to} « ${b.subject} »`).join(' ; ')}` : '',
      report ? `\n### Rapport\n\n${report.replace(/^#{1,3} /gm, '#### ')}` : '', ''].join('\n');
    bundle.append(path.join(cfg.secondBrain, 'brain', 'journal', 'delegations.md'), block, { header: DELEG_HEADER, subject: `Délégation : ${d.tache}`, why: `passage de l'agent délégué (${event})` });
  },
});
process.on('SIGTERM', () => { delegations.stopAll(); process.exit(0); });
process.on('SIGINT', () => { delegations.stopAll(); process.exit(0); });
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
//
// Contrairement aux autres écritures du dashboard, celle-ci ne passe pas par
// la file du curateur (bundle) : un cours en édition se travaille en direct
// avec un agent qui lit les fichiers du disque, et attendre un passage du
// curateur romprait ça. Écriture directe, donc — fichier temporaire puis
// renommage, pour ne jamais laisser un fichier à moitié écrit.
app.put('/api/cours/:deck/:file', (req, res) => {
  try {
    const { deck, file } = req.params;
    if (!/^[a-z0-9-]+$/.test(deck) || !/^[a-z0-9-]+\.md$/.test(file)) return res.status(400).json({ error: 'nom invalide' });
    const dir = path.join(coursDir, deck);
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    if (!manifest.modules?.includes(file)) return res.status(404).json({ error: 'module inconnu de ce support' });

    const target = path.join(dir, file);
    const seen = Date.parse(req.body?.lastModified ?? '');
    const now = fs.statSync(target).mtimeMs;
    // Last-Modified est à la seconde près, mtime à la milliseconde
    if (Number.isFinite(seen) && Math.floor(now / 1000) !== Math.floor(seen / 1000)) {
      return res.status(409).json({ error: 'le fichier a changé sur le disque' });
    }
    const src = String(req.body?.src ?? '');
    if (!src.trim()) return res.status(400).json({ error: 'contenu vide' });
    const tmp = `${target}.tmp`;
    fs.writeFileSync(tmp, src);
    fs.renameSync(tmp, target);
    res.json({ ok: true, lastModified: new Date(fs.statSync(target).mtimeMs).toUTCString() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Une image ajoutée en mode édition rejoint <deck>/img/. Même garde-fou que
// ci-dessus (le support doit avoir son manifest), un nom nettoyé, et jamais
// d'écrasement : un nom déjà pris reçoit un suffixe -2, -3…
const COURS_IMG = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg' };
app.post('/api/cours/:deck/img', express.raw({ type: 'image/*', limit: '15mb' }), (req, res) => {
  try {
    const { deck } = req.params;
    if (!/^[a-z0-9-]+$/.test(deck)) return res.status(400).json({ error: 'nom invalide' });
    const dir = path.join(coursDir, deck);
    if (!fs.existsSync(path.join(dir, 'manifest.json'))) return res.status(404).json({ error: 'support inconnu' });
    const ext = COURS_IMG[String(req.headers['content-type']).split(';')[0].trim()];
    if (!ext || !Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'image png, jpg, gif, webp ou svg attendue' });

    const base = String(req.query.name ?? '').replace(/\.[^.]*$/, '').normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'image';
    fs.mkdirSync(path.join(dir, 'img'), { recursive: true });
    let name = `${base}.${ext}`;
    for (let n = 2; fs.existsSync(path.join(dir, 'img', name)); n++) name = `${base}-${n}.${ext}`;
    const target = path.join(dir, 'img', name), tmp = `${target}.tmp`;
    fs.writeFileSync(tmp, req.body);
    fs.renameSync(tmp, target);
    res.json({ src: `img/${name}` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/config', (req, res) => res.json({ testQueue: sbQueue !== CURATOR_QUEUE, apps: cfg.apps.map(a => ({ ...a, model: setting(a.id).model })), mail: mail.status(), brand: { company: branding.company, owner: branding.owner }, secondBrain: cfg.secondBrain }));

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
// a devis or facture a finance note points to (brain/finance frontmatter `sources:`,
// resource relative to "My Drive" — cfg.drive is "My Drive/ALPES IA". Distinct from
// driveRoot above (scoped to cfg.drive itself, for the devis app's own writes).
const myDriveRoot = path.dirname(cfg.drive);
app.get('/api/drive-file', (req, res) => {
  const rel = String(req.query.path ?? '');
  const abs = path.resolve(myDriveRoot, rel);
  if (!abs.startsWith(path.resolve(myDriveRoot) + path.sep)) return res.status(403).json({ error: 'chemin refusé' });
  if (!fs.existsSync(abs)) return res.status(404).json({ error: 'fichier introuvable dans Drive' });
  res.sendFile(abs);
});

// Todo — markdown file in the second brain
app.get('/api/todo', (req, res) => res.json(readTodo(todoFile)));
app.put('/api/todo', (req, res) => res.json(writeTodo(todoFile, Array.isArray(req.body.items) ? req.body.items : [], Array.isArray(req.body.later) ? req.body.later : undefined)));
app.post('/api/todo/carried', (req, res) => res.json(completeCarried(todoFile, String(req.body.from), String(req.body.t), ['x', ' ', '>', '-'].includes(req.body.st) ? req.body.st : req.body.done !== false ? 'x' : ' ')));

// Google — the calendar's OAuth
app.get('/auth/google', (req, res) => { const u = google.authUrl(); u ? res.redirect(u) : res.status(400).send('credentials/client_secret.json manquant'); });
app.get('/auth/callback', async (req, res) => { try { await google.exchange(String(req.query.code)); calCache = null; res.redirect('/'); } catch (e) { res.status(500).send(String(e)); } });
// Mail — the Infomaniak mailbox
let mailCache = null;
// user decisions ride along with every inbox read
const mailOpts = () => ({ ...mailCfg, filter: { ...(mailCfg.filter ?? {}), ...mailState.rules(), isHidden: id => mailState.isHidden(id) } });
app.get('/api/mail', async (req, res) => {
  const st = mail.status();
  if (!st.hasToken) return res.json({ needsAuth: true, ...st });
  try {
    if (!mailCache || req.query.refresh || Date.now() - mailCache.at > 120e3) mailCache = { at: Date.now(), data: await mail.flagged(mailOpts()) };
    res.json({ ...mailCache.data, hidden: mailState.hidden(), notes: mailState.get().notes, senders: mailState.get().senders });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Mail triage — what the user decided about each thread and each sender
const dropCache = () => { mailCache = null; };
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
  // the model picked when launching wins over Réglages
  const s = setting(a.id);
  res.json(runner.start({ app: a, action: act, brief: req.body.brief.trim(), model: req.body.model || s.model, effort: s.effort, from: req.body.from }));
});
// Projects — long-running work, read from brain/projects/ in the second brain.
// Archived ones only come back with ?all=1 (the Projets view); their order is local.
app.get('/api/projects', (req, res) => {
  const { order, hiddenFrom } = projectsOrder.get();
  res.json(listProjects(cfg.secondBrain, { all: req.query.all === '1', order })
    .map(p => p.stage === 'archivé' ? { ...p, hiddenFrom: hiddenFrom[p.slug] ?? 'pause' } : p));
});
app.put('/api/projects/order', (req, res) => {
  if (!Array.isArray(req.body?.order)) return res.status(400).json({ error: 'order requis' });
  res.json({ order: projectsOrder.setOrder(req.body.order).order });
});
app.patch('/api/projects/:slug', (req, res) => {
  // remember the stage a project is hidden from, so showing it again puts it back there
  const was = req.body?.stage === 'archivé' && listProjects(cfg.secondBrain).find(p => p.slug === req.params.slug)?.stage;
  const p = updateProject(cfg.secondBrain, req.params.slug, req.body ?? {});
  if (p && was) projectsOrder.hid(p.slug, was);
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
  try { res.json({ notes: listFinance(cfg.secondBrain), clients: listClients(cfg.secondBrain).map(c => ({ slug: c.slug, title: c.title })), projects: listProjects(cfg.secondBrain, { all: true }).map(p => ({ slug: p.slug, client: p.client })) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
// A line for a client that may have no finance note yet: one is created for it.
app.post('/api/finance/echeances', (req, res) => {
  try {
    const { client, libelle } = req.body ?? {};
    const c = listClients(cfg.secondBrain).find(x => x.slug === client);
    if (!c) throw new Error(`client inconnu : ${client}`);
    const slug = createFinanceNote(cfg.secondBrain, { client: c.slug, clientTitle: c.title, libelle });
    res.json(addEcheance(cfg.secondBrain, slug, req.body));
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/finance/:slug/echeances', (req, res) => {
  try { res.json(addEcheance(cfg.secondBrain, req.params.slug, req.body ?? {})); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.patch('/api/finance/:slug/echeances/:idx', (req, res) => {
  try { res.json(updateEcheance(cfg.secondBrain, req.params.slug, Number(req.params.idx), req.body ?? {})); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.delete('/api/finance/:slug/echeances/:idx', (req, res) => {
  try { res.json(removeEcheance(cfg.secondBrain, req.params.slug, Number(req.params.idx))); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// Portfolio — clients and their projects cross-read with finance, todo and agenda
let pfEvents = null;
app.get('/api/portfolio', async (req, res) => {
  let events = [];
  try {
    if (google.status().hasCalendar) {
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
  const st = google.status();
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
  if (!google.status().hasCalendar) return res.json({ needsScope: true, calendars: [] });
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
    const g = await mail.flagged({ ...mailOpts(), maxThreads: 8 });
    mails = g.threads.map(t => ({ de: t.from, objet: t.subject, extrait: t.snippet.slice(0, 160), recu: t.date, jours: daysSince(t.date), non_lu: t.unread, contact_connu: t.known }));
  } catch (e) { /* mail optional */ }
  return {
    date: new Date().toISOString().slice(0, 10),
    moment: slot,
    heure: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
    second_brain: cfg.secondBrain,
    // where the skill drops its event: a test instance keeps it out of the curator's queue
    file_attente: sbQueue,
    consignes_boite: mailState.get().notes,
    todo_du_jour: todo.items,
    taches_reportees: todo.carried,
    plus_tard: todo.later,
    max_taches_actives: todo.max,
    projets: projects,
    agenda,
    agenda_erreur: agendaErreur,
    agenda_ecriture: google.status().hasCalendarWrite,
    mails_a_traiter: mails,
    standups_recents: standup.last(3),
    // meetings brought in from Wispr Flow whose actions haven't been put to Christophe yet
    reunions: meetings.pending().map(m => ({
      titre: m.titre, actions: m.actions,
      quand: m.date ? new Date(m.date).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : null,
    })),
    chantiers: delegations.list().slice(0, 10).map(d => ({
      titre: d.tache, projet: 'délégation', statut: d.statut, question: d.question, resume: d.resume ?? d.raison,
      depuis_jours: daysSince(d.etapes[d.etapes.length - 1].fin ?? d.creeLe), reprise_prevue: null,
    })),
  };
}

// The headless skill has no calendar tool: it lists the events it wants in a JSON
// file and the server posts them. The file is renamed once read so a retry never
// creates the same event twice. What happened is appended to the compose report,
// replacing any Agenda section the skill copied from past reports.
async function createStandupEvents(date, slot, report) {
  const f = path.join(ROOT, 'output', 'standup', `events-${date}-${slot}.json`);
  if (!fs.existsSync(f)) return;
  const lines = [];
  try {
    const list = JSON.parse(fs.readFileSync(f, 'utf8'));
    fs.renameSync(f, f.replace(/\.json$/, `.done-${Date.now()}.json`));
    for (const ev of Array.isArray(list) ? list : list.events ?? []) {
      const when = new Date(ev.start).toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
      if (sbQueue !== CURATOR_QUEUE) { lines.push(`- Non posé (instance de test) : ${ev.title} (${when})`); continue; }
      if (!google.status().hasCalendarWrite) { lines.push(`- Non posé : ${ev.title} (${when}) — écriture agenda non autorisée, clique « Reconnecter Google »`); continue; }
      try { await calendar.createEvent(ev); lines.push(`- Posé : ${ev.title} (${when})`); }
      catch (e) { lines.push(`- Échec : ${ev.title} (${when}) — ${e.message.slice(0, 160)}`); }
    }
  } catch (e) { lines.push(`- Événements illisibles : ${e.message}`); }
  dropCalCache();
  if (!lines.length) return;
  const kept = (fs.existsSync(report) ? fs.readFileSync(report, 'utf8') : '')
    .replace(/\n*^## Agenda\n[\s\S]*?(?=^## |(?![\s\S]))/gm, '\n\n').trimEnd();
  fs.writeFileSync(report, `${kept}\n\n## Agenda\n\n${lines.join('\n')}\n`);
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
  const s = setting(a.id);
  return waitRun(runner.start({ app: a, action: act, brief, model: model ?? s.model, effort: s.effort }));
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
    // an interview took place: its questions put the meeting actions to him, so they leave the list
    if (r.status === 'done' && questions.length) meetings.proposed(meetings.pending().map(m => m.id));
    // the few lines shown on screen; the full report above stays in the journal
    const flashFile = path.join(ROOT, 'output', 'standup', `flash-${ctx.date}-${slot}.md`);
    const flash = fs.existsSync(flashFile) ? fs.readFileSync(flashFile, 'utf8') : '';
    res.json({ ok: r.status === 'done', outcome, flash, todo: adoptComposedTodo(ctx.date, slot) ?? readTodo(todoFile), log: r.status === 'done' ? undefined : r.output.slice(-800) });
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

app.get('/api/delegations', (req, res) => res.json({ items: delegations.list({ all: req.query.all === '1' }), drafts: mail.status().hasDrafts }));
app.get('/api/delegations/skills', (req, res) => res.json(delegations.skills()));
app.get('/api/delegations/:id', (req, res) => {
  const d = delegations.get(req.params.id);
  d ? res.json({ ...d, rapport: delegations.report(d.id) }) : res.status(404).json({ error: 'délégation introuvable' });
});
// a todo task filed under a project gets the same CONTEXTE.md as a launched proposition
app.post('/api/delegations', async (req, res) => {
  try {
    const slug = String(req.body?.tache ?? '').trim() ? projectSlug(req.body?.projet) : '';
    const dossier = slug ? await dossierFor({ tache: String(req.body.tache).trim(), slug }) : '';
    res.json(delegations.create({ tache: req.body?.tache, contexte: req.body?.contexte, source: req.body?.source ?? null, projet: slug || null, dossier }));
  }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/delegations/:id/:act', (req, res) => {
  const { id, act } = req.params;
  try {
    if (act === 'reply') return res.json(delegations.reply(id, req.body?.texte));
    if (act === 'settings') return res.json(delegations.settings(id, { model: req.body?.model, effort: req.body?.effort }));
    if (act === 'stop') return res.json(delegations.stop(id));
    if (act === 'close') return res.json(delegations.close(id));
    res.status(404).json({ error: 'action inconnue' });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
// the only way out for a delegated agent: a draft, never a sent mail
app.post('/api/mail/draft', async (req, res) => {
  const { id, to, cc, subject, body, delegation } = req.body ?? {};
  if (!to || !subject || !body) return res.status(400).json({ error: 'destinataire, objet et corps sont requis' });
  if (!mail.status().hasDrafts) return res.status(403).json({ error: "la boîte mail n'est pas reliée : il manque le jeton Infomaniak (credentials/infomaniak.json). Note le texte du mail dans RAPPORT.md en attendant." });
  if (id && delegation && !delegations.ownsDraft(String(delegation), String(id))) return res.status(403).json({ error: "ce brouillon n'a pas été créé par cette tâche : tu ne peux modifier que les tiens" });
  try {
    const d = id ? await mail.updateDraft(String(id), { to, cc, subject, body }) : await mail.createDraft({ to, cc, subject, body });
    if (delegation) delegations.noteDraft(String(delegation), { to, subject, id: d.id });
    res.json(d);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/calendar/event', async (req, res) => {
  if (!google.status().hasCalendarWrite) return res.status(403).json({ error: "l'écriture agenda n'est pas autorisée : reconnecte Google depuis le widget Aujourd'hui" });
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
app.get('/api/chat/state', (req, res) => res.json(chat.state(String(req.query.id ?? 'default'))));
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
    const s = setting(a.id);
    const run = runner.start({ app: a, action: act, brief, model: req.body?.model ?? s.model, effort: s.effort });
    waitRun(run).then(async () => { adoptComposedTodo(ctx.date, slot); await createStandupEvents(ctx.date, slot, out); });
    res.json(run);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// LinkedIn — the editorial plan in brain/references, visuals in Drive
const liCfg = { version: '202609', visualsDir: '03.COMMUNICATION/LinkedIn', prepareAt: '06:00', ...(cfg.linkedin ?? {}) };
const liOpts = today => ({ drive: cfg.drive, visualsDir: liCfg.visualsDir, today: /^\d{4}-\d{2}-\d{2}$/.test(today ?? '') ? today : localToday() });
const linkedin = makeLinkedin(path.join(ROOT, 'credentials'), { port: PORT, version: liCfg.version });
app.get('/api/linkedin', (req, res) => {
  try { res.json({ ...loadLinkedin(cfg.secondBrain, liOpts(req.query.today)), runs: liRunsView(), auth: linkedin.status() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.patch('/api/linkedin/:plan/:id', (req, res) => {
  const b = req.body ?? {}, patch = {};
  if (typeof b.texte === 'string') patch.texte = b.texte;
  if (typeof b.commentaire === 'string') patch.commentaire = b.commentaire;
  if (b.statut === 'abandonne' || b.statut === 'a_produire' || b.statut === 'prepare') patch.statut = b.statut;
  // published by hand (fallback button), or an uncertain API answer checked on the profile
  if (b.statut === 'publie') { patch.statut = 'publie'; patch.publie_le = localToday(); if (/^https:\/\/www\.linkedin\.com\//.test(b.url ?? '')) patch.url = b.url; }
  try {
    updatePost(cfg.secondBrain, req.params.plan, req.params.id, patch, `post ${req.params.id} modifié dans AlpesOS${patch.statut ? ` (statut ${patch.statut})` : ''}`);
    res.json(loadLinkedin(cfg.secondBrain, liOpts()).posts.find(p => p.plan === req.params.plan && p.id === req.params.id));
  } catch (e) { res.status(400).json({ error: e.message }); }
});
// The morning preparation: an internal app, like the curator, so it never shows among
// the micro apps. It writes the text to output/linkedin/ and the visual straight to
// Drive; the server then hands the text to the curator through the queue.
const LINKEDIN = {
  id: 'linkedin', name: 'Post LinkedIn', description: 'Préparation du post du jour', skill: '/linkedin-post',
  model: liCfg.model ?? 'claude-opus-5', output: 'output/linkedin', addDirs: [cfg.drive], driveOutput: true,
  allowedTools: `${cfg.claude.allowedTools},WebSearch,WebFetch`,
  actions: [{ id: 'prepare', label: 'Préparer le post' }],
};
const liRuns = new Map();       // "<plan>/<id>" → { id, startedAt, error }
const liTries = new Map();      // "<date> <plan>/<id>" → automatic tries today
const liRunning = key => { const r = liRuns.get(key); return !!r && runner.get(r.id)?.status === 'running'; };
function liRunsView() {
  const out = {};
  for (const [key, r] of liRuns) { const run = runner.get(r.id); out[key] = { status: run?.status ?? 'unknown', startedAt: r.startedAt, error: r.error ?? null }; }
  return out;
}
function prepareLinkedin(post, { produire = toProduce(post), consigne = '' } = {}) {
  const key = `${post.plan}/${post.id}`;
  if (liRunning(key)) throw new Error('préparation déjà en cours');
  const textOut = path.join(ROOT, 'output', 'linkedin', `${post.plan}-${post.id}.md`);
  const visualOut = post.visualKind === 'auto'
    ? path.join(cfg.drive, liCfg.visualsDir, post.plan, `${post.id}.${/carrousel/i.test(post.visuel) ? 'pdf' : 'png'}`) : null;
  fs.mkdirSync(path.dirname(textOut), { recursive: true });
  let replaced = null;   // the visual set aside, put back if no new one comes out
  if (produire.includes('visuel') && visualOut) {
    fs.mkdirSync(path.dirname(visualOut), { recursive: true });
    const old = visualFor(cfg.drive, liCfg.visualsDir, post.plan, post.id);
    if (old) {
      fs.mkdirSync(path.join(path.dirname(old.abs), '_remplaces'), { recursive: true });
      replaced = { from: path.join(path.dirname(old.abs), '_remplaces', `${post.id}-${Date.now()}.${old.ext}`), to: old.abs };
      fs.renameSync(replaced.to, replaced.from);
    }
  }
  const txt = bundle.read(planFile(cfg.secondBrain, post.plan));
  const ctx = {
    produire, consigne: consigne || null,
    sortie_texte: produire.includes('texte') ? textOut : null,
    sortie_visuel: produire.includes('visuel') ? visualOut : null,
    fiche: { plan: post.plan, id: post.id, entete: post.header, etape: post.etape, pilier: post.pilier, sujet: post.sujet, visuel: post.visuel, date_publication: post.effective, champs: post.fields, texte_actuel: post.texte || null, commentaire_actuel: post.commentaire || null },
    cadre: planFrame(txt),
    second_brain: cfg.secondBrain,
  };
  const startedAt = Date.now();
  const run = runner.start({ app: LINKEDIN, action: LINKEDIN.actions[0], brief: `prepare\n\nCONTEXTE:\n${JSON.stringify(ctx, null, 1)}`, ...setting('linkedin') });
  liRuns.set(key, { id: run.id, startedAt: new Date(startedAt).toISOString() });
  waitRun(run).then(r => {
    const entry = liRuns.get(key);
    try {
      if (r.status !== 'done') throw new Error(`la préparation a échoué : ${r.output.slice(-300)}`);
      if (produire.includes('texte')) {
        if (!fs.existsSync(textOut) || fs.statSync(textOut).mtimeMs < startedAt) throw new Error("le texte n'a pas été produit");
        const { texte, commentaire } = parsePrepared(fs.readFileSync(textOut, 'utf8'));
        if (!texte) throw new Error('texte produit vide');
        const cur = loadLinkedin(cfg.secondBrain, liOpts()).posts.find(p => p.plan === post.plan && p.id === post.id);
        updatePost(cfg.secondBrain, post.plan, post.id, {
          texte, commentaire, prepare_le: new Date().toISOString(),
          ...(cur?.statut === 'a_produire' ? { statut: 'prepare' } : {}),
        }, `post ${post.id} préparé par Claude${consigne ? ` (consigne : ${consigne})` : ''}`);
      }
      if (produire.includes('visuel') && visualOut && !fs.existsSync(visualOut)) throw new Error("le visuel n'a pas été produit");
    } catch (e) { if (entry) entry.error = e.message; console.error('linkedin', e.message); }
    if (replaced && !visualFor(cfg.drive, liCfg.visualsDir, post.plan, post.id)) fs.renameSync(replaced.from, replaced.to);
  });
  return run;
}
// every 10 minutes from prepareAt on, and once at start-up to catch up after a sleep.
// A test instance only does it when asked (ALPES_OS_LI_AUTO=1): each pass is a real run.
function liMorning() {
  if (sbQueue !== CURATOR_QUEUE && process.env.ALPES_OS_LI_AUTO !== '1') return;
  try {
    const { todayPost, today } = loadLinkedin(cfg.secondBrain, liOpts());
    if (!todayPost) return;
    const key = `${todayPost.plan}/${todayPost.id}`, tries = `${today} ${key}`;
    if (!dueForPreparation({ post: todayPost, prepareAt: liCfg.prepareAt, running: liRunning(key), attempts: liTries.get(tries) ?? 0 })) return;
    liTries.set(tries, (liTries.get(tries) ?? 0) + 1);
    prepareLinkedin(todayPost);
  } catch (e) { console.error('linkedin', e.message); }
}
setInterval(liMorning, 10 * 60e3).unref();
setTimeout(liMorning, 20e3).unref();
app.post('/api/linkedin/:plan/:id/prepare', (req, res) => {
  const post = loadLinkedin(cfg.secondBrain, liOpts()).posts.find(p => p.plan === req.params.plan && p.id === req.params.id);
  if (!post) return res.status(404).json({ error: 'post introuvable' });
  if (post.statut === 'publie') return res.status(409).json({ error: 'post déjà publié' });
  const want = Array.isArray(req.body?.produire) ? req.body.produire.filter(x => ['texte', 'visuel'].includes(x)) : ['texte', 'visuel'];
  const produire = want.filter(x => x === 'texte' || post.visualKind === 'auto');
  if (!produire.length) return res.status(400).json({ error: 'rien que Claude puisse produire pour ce post' });
  try { res.json({ run: prepareLinkedin(post, { produire, consigne: String(req.body?.consigne ?? '').slice(0, 500) }) }); }
  catch (e) { res.status(409).json({ error: e.message }); }
});
// OAuth: one click, then LinkedIn sends the browser back here with a code
app.get('/auth/linkedin', (req, res) => { const u = linkedin.authUrl(); u ? res.redirect(u) : res.status(400).send('credentials/linkedin_client.json manquant ou incomplet'); });
app.get('/auth/linkedin/callback', async (req, res) => {
  if (req.query.error) return res.status(400).send(`LinkedIn : ${String(req.query.error_description ?? req.query.error)}`);
  try { await linkedin.exchange(String(req.query.code ?? ''), String(req.query.state ?? '')); res.redirect('/#linkedin'); }
  catch (e) { res.status(500).send(e.message); }
});
// Publishing only ever follows an explicit click and its confirmation. One at a time,
// never twice the same post, and an unclear answer from LinkedIn is parked as
// a_verifier instead of being retried.
let liPublishing = null;
app.post('/api/linkedin/:plan/:id/publish', async (req, res) => {
  if (req.body?.confirm !== true) return res.status(400).json({ error: 'confirmation requise' });
  if (liPublishing) return res.status(409).json({ error: `publication de ${liPublishing} déjà en cours` });
  const post = loadLinkedin(cfg.secondBrain, liOpts()).posts.find(p => p.plan === req.params.plan && p.id === req.params.id);
  if (!post) return res.status(404).json({ error: 'post introuvable' });
  if (post.url || ['publie', 'a_verifier'].includes(post.statut)) return res.status(409).json({ error: 'ce post est déjà parti (ou à vérifier sur LinkedIn)' });
  const bad = checkPost(post.texte);
  if (bad) return res.status(400).json({ error: bad });
  if (!post.visual && req.body?.sansVisuel !== true) return res.status(400).json({ error: 'pas de visuel : confirme la publication sans visuel' });
  liPublishing = post.id;
  try {
    const v = post.visual && visualFor(cfg.drive, liCfg.visualsDir, post.plan, post.id);
    const out = await linkedin.publish({ text: post.texte, file: v?.abs ?? null, title: `${post.id} — ${post.sujet}` });
    updatePost(cfg.secondBrain, post.plan, post.id, { statut: 'publie', publie_le: localToday(), url: out.url }, `post ${post.id} publié sur LinkedIn (${out.url})`);
    res.json(out);
  } catch (e) {
    if (e.ambiguous) updatePost(cfg.secondBrain, post.plan, post.id, { statut: 'a_verifier' }, `publication de ${post.id} incertaine : ${e.message}`);
    res.status(e.ambiguous ? 502 : 400).json({ error: e.message, ambiguous: !!e.ambiguous });
  } finally { liPublishing = null; }
});
// a visual dropped on the page goes to Drive as <Jxx>.<ext>; the one it replaces is kept aside
app.post('/api/linkedin/:plan/:id/visual', express.raw({ type: () => true, limit: '600mb' }), (req, res) => {
  const { plan, id } = req.params;
  const ext = String(req.get('x-filename') ?? '').split('.').pop().toLowerCase();
  if (!/^\d{4}-\d{2}$/.test(plan) || !/^J\d+$/.test(id)) return res.status(400).json({ error: 'post invalide' });
  if (!['png', 'jpg', 'jpeg', 'pdf', 'mp4', 'mov'].includes(ext)) return res.status(400).json({ error: 'format accepté : png, jpg, pdf, mp4, mov' });
  if (!req.body?.length) return res.status(400).json({ error: 'fichier vide' });
  try {
    const dir = path.join(cfg.drive, liCfg.visualsDir, plan);
    fs.mkdirSync(dir, { recursive: true });
    const old = visualFor(cfg.drive, liCfg.visualsDir, plan, id);
    if (old) {
      fs.mkdirSync(path.join(dir, '_remplaces'), { recursive: true });
      fs.renameSync(old.abs, path.join(dir, '_remplaces', `${id}-${Date.now()}.${old.ext}`));
    }
    fs.writeFileSync(path.join(dir, `${id}.${ext}`), req.body);
    res.json({ ok: true });
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
    app: CURATOR, action: CURATOR.actions[0], ...setting('curateur'),
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
// Meetings transcribed in Wispr Flow: a run reads them through the claude.ai
// connector and queues one event per finished meeting, before the curator's pass.
const MEETINGS = {
  id: 'meetings', name: 'Réunions Wispr Flow', description: 'Rapatrie les réunions transcrites dans le second brain', skill: '',
  model: cfg.claude.defaultModel, output: 'output/meetings', allowedTools: MEETINGS_TOOLS,
  actions: [{ id: 'collecter', label: 'Rapatrier les réunions', placeholder: '' }],
};
const meetings = makeMeetings(path.join(ROOT, 'output', 'meetings-state.json'));
let meetingsRun = null;
function collectMeetings(reason) {
  if (meetingsRun && runner.get(meetingsRun.id)?.status === 'running') return { error: 'rapatriement des réunions déjà en cours' };
  const checkedAt = new Date().toISOString();
  const resultFile = path.join(ROOT, 'output', 'meetings', `result-${Date.now()}.json`);
  const brief = meetings.brief({ queueDir: sbQueue, resultFile, text: reglages.prompt('reunions', MEETINGS_BRIEF) });
  meetingsRun = runner.start({ app: MEETINGS, action: MEETINGS.actions[0], brief: `${brief}\n\n(${reason})`, ...setting('reunions') });
  const done = waitRun(meetingsRun).then(r => {
    const found = r.status === 'done' ? meetings.adopt(resultFile, { checkedAt }) : null;
    if (found?.length) console.log(`réunions : ${found.length} déposée(s) dans la file`);
    return found;
  });
  return { run: meetingsRun, done };
}
app.post('/api/meetings/collect', (req, res) => {
  const r = collectMeetings('demandé depuis le dashboard');
  r.error ? res.status(409).json(r) : res.json({ run: runInfo(r.run), state: meetings.state() });
});
app.get('/api/meetings', (req, res) => res.json({ ...meetings.state(), run: runInfo(meetingsRun && runner.get(meetingsRun.id)) }));

// A test instance only reads Wispr Flow when asked (ALPES_OS_MEET_AUTO=1)
const MEET_AUTO = sbQueue === CURATOR_QUEUE || process.env.ALPES_OS_MEET_AUTO === '1';
// only new events trigger the automatic pass: one stuck in processing needs a human
async function brainPass() {
  if (MEET_AUTO) {
    try { await collectMeetings('passage automatique').done; } catch (e) { console.error('meetings', e.message); }
  }
  try {
    bundle.flush();
    const st = bundle.status();
    if (st.inbox && !st.locked && brainClean()) integrate('passage automatique');
  } catch (e) { console.error('curator', e.message); }
}
setInterval(brainPass, 2 * 60 * 60e3).unref();
// a restart shouldn't delay new meetings by two hours: look once shortly after start
if (MEET_AUTO) setTimeout(() => collectMeetings('au démarrage'), 2 * 60e3).unref();

// Propositions — tasks suggested for today (hourly review, SIMATIS missions) waiting
// on Christophe: accepted they join today's todo, "plus tard" goes to Plus tard
const propositions = makePropositions(path.join(ROOT, 'output', 'propositions.json'));

// Connexions — partner OSes (SIMATIS OS first) linked through the agents relay. Their
// missions become propositions or delegations depending on the level set per connection;
// the sales follow-up they share is kept as a copy in output/crm/ (lib/suivi.js).
// Off until credentials/relais.json exists (scripts/relais-inscription.js).
// the shared space's echanges/ folder, read through the user's `partage` MCP server
const echanges = makeEchanges({ dir: path.join(ROOT, 'output'), nouveaux: m => partenaires.surPartage(m) });
const partenaires = makePartenaires({
  dir: path.join(ROOT, 'output'), credentials: path.join(ROOT, 'credentials', 'relais.json'),
  propositions, delegations, echanges,
  // only the notable facts of the shared sales follow-up reach the curator; the rest lives in output/crm/
  marquant: fait => deposerEvenement(sbQueue, evenementFait(fait)),
});
partenaires.demarrer();
echanges.demarrer();
const relaisErr = (res, e) => res.status(e.status >= 400 && e.status < 600 ? e.status : 502).json({ error: e.message });
app.get('/api/connexions', (req, res) => res.json(partenaires.etat()));
app.post('/api/connexions/invitations', async (req, res) => {
  try { res.json(await partenaires.inviter({ email: req.body?.email })); } catch (e) { relaisErr(res, e); }
});
app.post('/api/connexions/rejoindre', async (req, res) => {
  try { res.json(await partenaires.rejoindre(req.body?.lien)); } catch (e) { relaisErr(res, e); }
});
app.patch('/api/connexions/:id', (req, res) => {
  try { res.json(partenaires.regler(req.params.id, req.body ?? {})); } catch (e) { res.status(e.status ?? 400).json({ error: e.message }); }
});
app.delete('/api/connexions/:id', async (req, res) => {
  try { res.json(await partenaires.couper(req.params.id)); } catch (e) { relaisErr(res, e); }
});
app.get('/api/connexions/:id/activite', (req, res) => {
  try { res.json(partenaires.activite(req.params.id)); } catch (e) { res.status(e.status ?? 400).json({ error: e.message }); }
});
app.post('/api/connexions/:id/missions', async (req, res) => {
  try { res.json(await partenaires.confier(req.params.id, req.body ?? {})); } catch (e) { relaisErr(res, e); }
});
app.post('/api/connexions/:id/messages', async (req, res) => {
  try { res.json(await partenaires.envoyerMessage(req.params.id, req.body ?? {})); } catch (e) { relaisErr(res, e); }
});
// Suivi commercial: the copy of what the partner shares, and the few changes Christophe may make
const suiviOk = (res, f) => { try { res.json(f()); } catch (e) { res.status(e.status ?? 400).json({ error: e.message }); } };
app.get('/api/connexions/:id/suivi', (req, res) => suiviOk(res, () => partenaires.suivi.vue(req.params.id)));
// the CRM tab: every live connection's follow-up, each one saying which partner it comes from
app.get('/api/crm', (req, res) => suiviOk(res, () => ({ connexions: partenaires.etat().connexions.map(c => ({ id: c.id, court: c.court, ...partenaires.suivi.crm(c.id) })) })));
app.get('/api/connexions/:id/suivi/entreprises/:ref', (req, res) => suiviOk(res, () => partenaires.suivi.entreprise(req.params.id, req.params.ref)));
app.get('/api/connexions/:id/suivi/contacts/:ref', (req, res) => suiviOk(res, () => partenaires.suivi.contact(req.params.id, req.params.ref)));
app.get('/api/connexions/:id/suivi/affaires/:ref', (req, res) => suiviOk(res, () => partenaires.suivi.affaire(req.params.id, req.params.ref)));
app.patch('/api/connexions/:id/suivi/affaires/:ref', (req, res) => suiviOk(res, () => partenaires.suivi.modifierAffaire(req.params.id, req.params.ref, req.body ?? {})));
app.post('/api/connexions/:id/suivi/affaires/:ref/notes', (req, res) => suiviOk(res, () => partenaires.suivi.ajouterNote(req.params.id, req.params.ref, req.body?.texte)));
app.post('/api/connexions/:id/suivi/affaires/:ref/taches', (req, res) => suiviOk(res, () => partenaires.suivi.ajouterTache(req.params.id, req.params.ref, req.body ?? {})));
app.post('/api/connexions/:id/suivi/affaires/:ref/contacts', (req, res) => suiviOk(res, () => partenaires.suivi.ajouterContact(req.params.id, req.params.ref, req.body ?? {})));
app.post('/api/connexions/:id/suivi/affaires/:ref/rendez-vous/:rdv', (req, res) => suiviOk(res, () => partenaires.suivi.compteRendu(req.params.id, req.params.ref, req.params.rdv, req.body?.texte)));
app.post('/api/connexions/:id/suivi/notes/:note/vu', (req, res) => suiviOk(res, () => partenaires.suivi.vu(req.params.id, req.params.note)));
app.post('/api/connexions/:id/suivi/suppressions/:sid', (req, res) => suiviOk(res, () => partenaires.suivi.repondreSuppression(req.params.id, req.params.sid, !!req.body?.supprimer)));
// Échanges: the messages with the partner gathered by subject, its missions, and the second brain kept in step
const sujets = makeSujets({
  file: path.join(ROOT, 'output', 'sujets.json'),
  ranger: input => askClaude(cfg.claude.bin, { ...setting('sujets'), system: reglages.prompt('sujets', SUJETS_SYSTEM), schema: SUJETS_SCHEMA }, input),
});
const memoire = makeMemoire({ root: cfg.secondBrain, queue: sbQueue, file: path.join(ROOT, 'output', 'echanges-memoire.json') });
function echange() {
  const c = partenaires.connexionEchange();
  if (!c) return null;
  const act = partenaires.activite(c.id);
  const messages = act.messages.filter(m => m.type !== 'donnee').map(m => ({ ...m, enReponseA: m.enReponseA?.id ?? null }));
  return { c, court: partenaires.etat().connexions.find(x => x.id === c.id)?.court ?? 'Partenaire', act, messages };
}
// a test instance only files and hands over when asked (ALPES_OS_ECHANGES_AUTO=1): each filing is a real run
const ECHANGES_AUTO = sbQueue === CURATOR_QUEUE || process.env.ALPES_OS_ECHANGES_AUTO === '1';
async function echangesPasse() {
  const e = echange();
  if (!e) return;
  await sujets.passe(e.messages);
  try { memoire.confier(e.messages.map(m => ({ ...m, sujetTitre: sujets.titre(sujets.de(m.id)) })), { partenaire: e.court }); } catch (err) { console.error('echanges', err.message); }
}
if (ECHANGES_AUTO) {
  setTimeout(echangesPasse, 30e3).unref();
  setInterval(echangesPasse, 2 * 60e3).unref();
}
const JOURS = 30;
app.get('/api/echanges', (req, res) => {
  const e = echange();
  if (!e) return res.json({ partenaire: null });
  const depuis = new Date(Date.now() - JOURS * 864e5).toISOString();
  const groupes = sujets.grouper(e.messages);
  const visibles = req.query.tout ? groupes : groupes.filter(g => g.messages.at(-1).quand >= depuis);
  res.json({
    partenaire: e.court, connexion: e.c.id, partage: !!partenaires.etat().connexions.find(x => x.id === e.c.id)?.partage,
    missions: { enCours: e.act.enCours, terminees: e.act.terminees },
    sujets: visibles.map(g => ({
      id: g.id, titre: g.titre, messages: g.messages,
      sansReponse: g.messages.some(m => m.type === 'question' && !m.repondu),
      note: g.messages.every(m => memoire.note(m.id)),
    })),
    caches: groupes.length - visibles.length,
    rangement: sujets.etat(),
  });
});
// A conversation is named by one of its messages: its subject id changes when the filing agent
// files it. An answer replies to the partner's latest question still unanswered, else to their
// latest message, or opens with the subject's title.
function filDe(ancre) {
  const e = echange();
  if (!e) throw Object.assign(new Error('aucun partenaire connecté'), { status: 409 });
  const g = sujets.grouper(e.messages).find(x => x.messages.some(m => m.id === ancre));
  if (!g) throw Object.assign(new Error('conversation inconnue'), { status: 404 });
  return { e, g };
}
async function envoyerDansFil(ancre, texte, partage) {
  const { e, g } = filDe(ancre);
  const recus = g.messages.filter(m => m.sens === 'recu');
  const cible = recus.filter(m => m.type === 'question' && !m.repondu).at(-1) ?? recus.at(-1);
  const lu = await partenaires.envoyerMessage(e.c.id, cible ? { texte, enReponseA: cible.id, partage } : { type: 'info', sujet: g.titre, texte, partage });
  const sid = g.id.startsWith('brut:') ? sujets.creer(g.titre) : g.id;
  if (g.id.startsWith('brut:')) for (const m of g.messages) sujets.affecter(m.id, sid);
  sujets.affecter(lu.id, sid);
  return lu;
}
const echangeErr = (res, e) => res.status(e.status >= 400 && e.status < 600 ? e.status : 502).json({ error: e.message });
// one send at a time per conversation: a second click while the first is on its way is refused
const filsOccupes = new Set();
async function unSeul(ancre, res, fn) {
  if (filsOccupes.has(ancre)) return res.status(409).json({ error: 'un envoi est déjà en cours dans cette conversation' });
  filsOccupes.add(ancre);
  try { res.json(await fn()); } catch (e) { echangeErr(res, e); } finally { filsOccupes.delete(ancre); }
}
app.post('/api/echanges/fils/:ancre/messages', (req, res) => unSeul(req.params.ancre, res, () => envoyerDansFil(req.params.ancre, req.body?.texte, !!req.body?.partage)));
// Christophe chose that the agent's answer leaves at once, copied to the shared space when there is one
app.post('/api/echanges/fils/:ancre/agent', (req, res) => unSeul(req.params.ancre, res, async () => {
  const { e, g } = filDe(req.params.ancre);
  // what Christophe knows: the shared space's documents and his files on the partner, money left out
  const espacePartage = await echanges.documents().catch(err => { console.error('echanges', err.message); return []; });
  const texte = await reponseAgent(input => askClaude(cfg.claude.bin, { ...setting('reponse-partenaire'), system: reglages.prompt('reponse-partenaire', REPONSE_SYSTEM), schema: REPONSE_SCHEMA }, input), g,
    { espacePartage, fiches: fichesPartenaire(cfg.secondBrain) });
  const partage = !!partenaires.etat().connexions.find(x => x.id === e.c.id)?.partage;
  // the conversation may have been filed meanwhile: its anchor still finds it
  return envoyerDansFil(req.params.ancre, texte, partage);
}));
app.post('/api/echanges/messages', (req, res) => unSeul('nouveau', res, async () => {
  const e = echange();
  if (!e) throw Object.assign(new Error('aucun partenaire connecté'), { status: 409 });
  const { type, sujet, texte, partage } = req.body ?? {};
  const lu = await partenaires.envoyerMessage(e.c.id, { type, sujet, texte, partage: !!partage });
  sujets.affecter(lu.id, sujets.creer(lu.sujet));
  return lu;
}));
app.post('/api/connexions/missions/:id/terminer', async (req, res) => {
  try { res.json(await partenaires.terminer(req.params.id, req.body?.message)); } catch (e) { res.status(e.status ?? 400).json({ error: e.message }); }
});

app.get('/api/propositions', (req, res) => res.json(propositions.pending()));
app.post('/api/propositions', (req, res) => {
  try { res.json(propositions.add(req.body ?? {})); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
const launching = new Set();   // a double click must not start two agents
app.post('/api/propositions/:id/:act', async (req, res) => {
  const { id, act } = req.params;
  try {
    const p = propositions.get(id);
    const t = String(req.body?.title ?? '').trim() || p?.title;
    const money = p?.type === 'finance';
    // a mission on "Demander avant" starts the partner's work instead of adding a task
    const tache = p?.source !== 'mission' || partenaires.ajouteTache(id);
    let todo = null, finance = null, delegation = null;   // writeTodo drops a task already on the list
    if (p?.status === 'pending' && act === 'accept') { if (money) finance = toFinance(p.echeance); else if (tache && p.source !== 'partenaire') todo = addItem(todoFile, { t, s: p.project }); }
    if (p?.status === 'pending' && act === 'later' && !money && p.source !== 'partenaire') { const cur = readTodo(todoFile); todo = writeTodo(todoFile, cur.items, [...cur.later, { t, s: p.project }]); }
    // Lancer: an agent takes the task straight away with its CONTEXTE.md, it never joins the todo
    if (p?.status === 'pending' && act === 'launch' && !money && p.source !== 'partenaire') {
      if (launching.has(id)) return res.status(409).json({ error: 'agent déjà en cours de lancement' });
      launching.add(id);
      try {
        const slug = p.slug || projectSlug(p.project);
        const dossier = await dossierFor({ tache: t, slug, objectif: p.objectif, etapes: p.etapes, why: p.why, refs: p.refs, revue: p.source === 'revue' });
        delegation = delegations.create({ tache: t, contexte: [p.project && `Projet : ${p.project}`, p.why && `Proposée par la revue horaire : ${p.why}`].filter(Boolean).join('. '), source: p.id, projet: slug || null, dossier });
      } finally { launching.delete(id); }
    }
    const proposition = propositions.decide(id, act, req.body?.title);
    // the partner hears back: accepted, postponed or rejected
    if (proposition.source === 'mission') partenaires.surDecision(proposition).catch(e => console.error('partenaires', e.message));
    res.json({ proposition, todo: todo ?? readTodo(todoFile), finance, delegation });
  } catch (e) { res.status(e.status ?? 400).json({ error: e.message }); }
});

// An accepted money proposition becomes a line in the client's finance note, or in
// a minimal note when he has none; nothing is written twice for the same month.
const clientOf = n => n.client || n.clients[0] || '';
function toFinance(e) {
  const mine = listFinance(cfg.secondBrain).filter(n => clientOf(n) === e.client);
  if (mine.some(n => n.echeances.some(x => moneyKey({ ...x, client: e.client }) === moneyKey(e)))) return null;
  const slug = mine.find(n => n.slug === e.note)?.slug ?? mine[0]?.slug
    ?? createFinanceNote(cfg.secondBrain, { client: e.client, clientTitle: listClients(cfg.secondBrain).find(c => c.slug === e.client)?.title, libelle: e.libelle });
  return addEcheance(cfg.secondBrain, slug, { libelle: e.libelle, montant: e.montant, date: e.date, statut: e.statut });
}

// The client a mail comes from: its address or domain is written in the client's
// note, or the client's name is in the subject.
const WEBMAIL = /gmail|outlook|hotmail|yahoo|icloud|free\.fr|orange\.fr|wanadoo/;
function mailClient(t, clients) {
  const domain = t.addr.split('@')[1] ?? '';
  return clients.find(c => c.text.includes(t.addr) || (domain && !WEBMAIL.test(domain) && c.text.includes('@' + domain))
    || t.subject.toLowerCase().includes(c.title.toLowerCase()));
}
// the lines of a note that carry a price: what a devis or a rate says
const priceLines = txt => txt.split('\n').filter(l => /\d\s?€|€\s?\d|tarif|TJM/i.test(l)).map(l => l.trim().slice(0, 240)).slice(0, 12);

// Hourly review — the server gathers the facts, a light model ranks today's tasks
// and suggests what is missing. A test instance only runs it on demand, unless
// ALPES_OS_REVIEW_AUTO=1.
const revCfg = { model: 'claude-haiku-5-5', weekdays: [1, 2, 3, 4, 5], from: 9, to: 19, ...(cfg.review ?? {}) };
const STOPPED = ['pause', 'terminé', 'archivé'];
async function reviewContext({ since } = {}) {
  const now = new Date();
  const midnight = new Date(now); midnight.setHours(0, 0, 0, 0);
  const todo = readTodo(todoFile);
  const open = [...todo.items.filter(i => !i.done), ...todo.carried];
  let agenda = [], agendaErreur = null;
  try {
    const c = await calendar.upcoming({ ...calOpts(), days: 1, max: 15 });
    if (c.needsScope) agendaErreur = 'lecture agenda non autorisée';
    agenda = c.events.map(e => ({ titre: e.title, debut: e.start, fin: e.end, journee_entiere: e.allDay, avec: e.attendees, lieu: e.location }));
  } catch (e) { agendaErreur = e.message.slice(0, 200); }
  const today = localToday(now), horizon = localToday(new Date(now.getTime() + 30 * 864e5));
  // paused, finished or archived: his decision, in `next`, rules out suggestions about it
  const projects = listProjects(cfg.secondBrain, { all: true }), notes = listFinance(cfg.secondBrain);
  const isStopped = p => STOPPED.includes(p.stage);
  const clientsOf = p => [...new Set([p.client, ...notes.filter(n => n.projet === p.slug).map(clientOf)].filter(Boolean))];
  const live = new Set(projects.filter(p => !isStopped(p)).flatMap(clientsOf));
  const closed = new Set(projects.filter(p => ['terminé', 'archivé'].includes(p.stage)).map(p => p.slug));
  const noteClosed = n => n.projet ? closed.has(n.projet) : n.projects.length > 0 && n.projects.every(s => closed.has(s));
  return {
    maintenant: now.toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }),
    taches_du_jour: open.map((i, n) => ({
      id: n + 1, t: i.t, ...(i.s ? { contexte: i.s } : {}),
      ...(i.p ? { priorite: i.p === 'h' ? 'haute' : 'moyenne' } : {}), ...(i.from ? { reportee_du: i.from } : {}),
    })),
    faites_aujourdhui: todo.items.filter(i => i.done).map(i => i.t),
    plus_tard: todo.later.map(i => i.t),
    activite_claude_code: await claudeActivity({ since: midnight.getTime() }),
    notes_recentes: getGraph(cfg.secondBrain, cfg.brainFolders).nodes
      .filter(n => n.mtime >= now - 48 * 3600e3 && !n.idx && n.id !== cfg.todoFile)
      .sort((a, b) => b.mtime - a.mtime).slice(0, 25)
      .map(n => ({ chemin: n.id, titre: n.t, description: n.desc, modifiee: new Date(n.mtime).toLocaleString('fr-FR', { weekday: 'short', hour: '2-digit', minute: '2-digit' }) })),
    projets: projects.filter(p => !isStopped(p)).map(p => ({
      slug: p.slug, titre: p.title, stade: p.stage, prochaine_etape: p.next || p.steps[0] || '', revu_le: p.updated, jours_sans_mouvement: daysSince(p.updated),
    })),
    projets_arretes: projects.filter(isStopped).map(p => ({
      slug: p.slug, titre: p.title, stade: p.stage, decision: (p.next || '').slice(0, 300), clients: clientsOf(p).filter(c => !live.has(c)),
    })),
    agenda, agenda_erreur: agendaErreur,
    // an unsigned devis is no money owed, so it is never late
    echeances: notes.filter(n => !noteClosed(n))
      .flatMap(n => n.echeances.filter(e => e.statut !== 'encaisse' && e.date && e.date <= horizon)
        .map(e => ({ note: n.title, libelle: e.libelle, montant: e.montant, date: e.date, statut: e.statut, ...(e.date < today && e.statut !== 'devis' ? { en_retard: true } : {}) })))
      .sort((a, b) => a.date.localeCompare(b.date)).slice(0, 10),
    ...await moneyContext(since),
  };
}
// Mails from real people since the last review (a week at most), with what the
// second brain says about their client's money, for the review to spot commitments.
async function moneyContext(since) {
  const notes = listFinance(cfg.secondBrain);
  const clients = listClients(cfg.secondBrain).map(c => ({ ...c, text: bundle.read(path.join(cfg.secondBrain, c.id)).toLowerCase() }));
  const mails = [], extraits = {};
  let mailErreur = null;
  try {
    if (mail.status().hasToken) {
      const from = Math.max(Date.parse(since ?? '') || 0, Date.now() - 7 * 864e5);
      const { threads } = await mail.flagged({ ...mailOpts(), maxThreads: 20 });
      for (const t of threads.filter(t => Date.parse(t.date) > from).slice(0, 8)) {
        const c = mailClient(t, clients);
        let messages;
        try { messages = await mail.threadText(t.id); } catch (e) { messages = [{ de: t.from, date: t.date, texte: t.snippet }]; }
        mails.push({ id: t.id, de: t.from, objet: t.subject, date: t.date, ...(c ? { client: c.slug } : {}), messages });
        if (c && !extraits[c.slug]) extraits[c.slug] = [...priceLines(bundle.read(path.join(cfg.secondBrain, c.id))),
          ...notes.filter(n => clientOf(n) === c.slug).flatMap(n => priceLines(bundle.read(path.join(cfg.secondBrain, n.id))).map(l => `${n.id} : ${l}`))].slice(0, 20);
      }
    }
  } catch (e) { mailErreur = e.message.slice(0, 200); }
  return {
    mails_recents: mails, ...(mailErreur ? { mails_erreur: mailErreur } : {}),
    clients: clients.map(c => ({ slug: c.slug, titre: c.title })),
    notes_finance: notes.map(n => ({ note: n.slug, titre: n.title, client: clientOf(n), description: n.description, echeances: n.echeances.map(({ libelle, montant, date, statut }) => ({ libelle, montant, date, statut })) })),
    extraits_clients: extraits,
  };
}
const review = makeReview(path.join(ROOT, 'output', 'review.json'), {
  bin: cfg.claude.bin, schedule: revCfg,
  get model() { return setting('revue').model; },
  get effort() { return setting('revue').effort; },
  get system() { return reglages.prompt('revue', REVIEW_SYSTEM); },
  auto: sbQueue === CURATOR_QUEUE || process.env.ALPES_OS_REVIEW_AUTO === '1',
}, { context: reviewContext, propositions });
setInterval(() => review.tick(), 60e3).unref();
app.get('/api/review', (req, res) => res.json(review.status()));
// the Relancer button: waits for the review, or for the one already running
app.post('/api/review/run', async (req, res) => {
  try { await review.run('demandée').done; res.json(review.status()); }
  catch (e) { res.status(500).json({ ...review.status(), error: e.message }); }
});

// CONTEXTE.md for a task an agent takes on: the project's note, its clients' and
// finance notes in full, the facts the review cited, the meetings ahead, recent
// journal entries and earlier agents' reports on the same project.
const projectSlug = v => v ? listProjects(cfg.secondBrain, { all: true }).find(p => p.slug === v || same(p.title) === same(v))?.slug ?? '' : '';
async function dossierFor({ tache, slug = '', objectif = '', etapes = [], why = '', refs = [], revue = false }) {
  const sb = cfg.secondBrain, abs = id => path.join(sb, id);
  const project = slug ? listProjects(sb, { all: true }).find(p => p.slug === slug) : null;
  const notes = listFinance(sb);
  const clientSlugs = [...new Set([project?.client, ...notes.filter(n => project && n.projet === slug).map(clientOf),
    ...refs.filter(r => r.type === 'client').map(r => r.id)].filter(Boolean))];
  const clients = listClients(sb).filter(c => clientSlugs.includes(c.slug));
  const names = namesOf([project?.title, ...clients.map(c => c.title)]);
  const sections = [];
  const note = (titre, id) => { if (!sections.some(s => s.chemin === abs(id))) sections.push({ titre, texte: bundle.read(abs(id)), chemin: abs(id) }); };
  if (project) note(`Projet : ${project.title}`, project.id);
  for (const c of clients) note(`Client : ${c.title}`, c.id);
  for (const n of notes.filter(n => (project && n.projet === slug) || clientSlugs.includes(n.client))) note(`Finance : ${n.title}`, n.id);
  for (const r of refs) {
    if (r.type === 'note' && /^brain\/[\w./-]+\.md$/.test(r.id) && !r.id.includes('..') && bundle.exists(abs(r.id))) note(r.label, r.id);
    if (r.type === 'projet') { const p = listProjects(sb, { all: true }).find(p => p.slug === r.id); if (p) note(`Projet : ${p.title}`, p.id); }
  }
  for (const r of refs.filter(r => r.type === 'mail')) {
    try {
      const msgs = await mail.threadText(r.id, { last: 10, maxChars: 8000 });
      sections.push({ titre: r.label, texte: msgs.map(m => `**${m.de}** · ${m.date.slice(0, 16).replace('T', ' ')}\n\n${m.texte}`).join('\n\n---\n\n'), chemin: `fil mail ${r.id} (outil lister_mails)` });
    } catch (e) { /* a mail out of reach leaves the rest of the file */ }
  }
  if (names.length) {
    try {
      const { events } = await calendar.upcoming({ ...calOpts(), days: 30, max: 60 });
      const mine = events.filter(e => mentions([e.title, ...(e.attendees ?? []), e.location].join(' '), names));
      if (mine.length) sections.push({ titre: 'Agenda à venir', chemin: 'agenda Google (outil lister_agenda)', texte: mine.map(e => `- ${new Date(e.start).toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · ${e.title}${e.attendees?.length ? ` · avec ${e.attendees.join(', ')}` : ''}${e.location ? ` · ${e.location}` : ''}`).join('\n') });
    } catch (e) { /* no agenda, no section */ }
  }
  const cited = refs.filter(r => r.type === 'session').map(r => r.id);
  if (cited.length) {
    const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
    const act = (await claudeActivity({ since: midnight.getTime() })).filter(s => cited.includes(s.id));
    if (act.length) sections.push({ titre: "Activité Claude Code d'aujourd'hui", chemin: '~/.claude/projects (transcripts)', texte: act.map(s => `### ${s.worktree ?? s.dossier}${s.branche ? ` (${s.branche})` : ''}, ${s.de}–${s.a}\n\n${s.extraits.map(x => `- ${x}`).join('\n')}`).join('\n\n') });
  }
  if (names.length) {
    const dir = path.join(sb, 'brain', 'journal');
    bundle.list(dir).filter(f => f.endsWith('.md') && !['index.md', 'todo.md', 'delegations.md'].includes(f))
      .flatMap(f => journalEntries(bundle.read(path.join(dir, f)), names, path.join(dir, f)))
      .sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5).forEach(e => sections.push(e));
  }
  for (const d of delegations.list({ all: true }).filter(d => project && (d.projet === slug || mentions(d.tache, names))).slice(0, 3)) {
    const txt = delegations.report(d.id);
    if (txt) sections.push({ titre: `Rapport d'un agent précédent · ${d.tache}`.slice(0, 140), texte: txt, chemin: path.join(ROOT, d.dossier, 'RAPPORT.md') });
  }
  if (!sections.length && !objectif && !etapes.length) return '';
  const r = review.status();
  const bullets = revue && rvToday(r.at) ? [r.summary ?? []].flat() : [];
  const head = [
    '# Contexte de la tâche',
    `Préparé par AlpesOS le ${new Date().toLocaleString('fr-FR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}, au lancement. C'est ce que Christophe sait déjà : pars de là et ne cherche ailleurs que ce qui manque. Une partie trop longue est tronquée et donne le chemin de son texte complet.`,
    '## Tâche', `**${tache}**`,
    [objectif && `- Objectif : ${objectif}`, why && `- Pourquoi : ${why}`, project && `- Projet : ${project.title} (${project.stage}) — prochaine étape notée : ${project.next || '—'}`].filter(Boolean).join('\n'),
    etapes.length && `### Étapes prévues\n\n${etapes.map((e, i) => `${i + 1}. ${e}`).join('\n')}`,
    bullets.length && `### Revue horaire de ${new Date(r.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}\n\n${bullets.map(b => `- ${b}`).join('\n')}`,
  ].filter(Boolean).join('\n\n');
  return assemble(head, sections) + '\n';
}
const rvToday = iso => !!iso && new Date(iso).toDateString() === new Date().toDateString();

// Réglages screen — model, effort and prompt of each function; the skills of the second
// brain, Claude Code and claude.ai, offered or not to the agents. Only a second brain
// SKILL.md is edited here, through the curator's queue.
const fnView = f => ({
  id: f.id, name: f.name, skill: f.skill ?? null, ...setting(f.id),
  fallback: { model: pick(...f.model), effort: pick(...(f.effort ?? [])) ?? null },
  ...(f.prompt ? { prompt: reglages.prompt(f.id, f.prompt), original: f.prompt, modified: reglages.modified(f.id) } : {}),
});
const skillFile = s => path.join(s.dir, 'SKILL.md');
const allSkills = () => listSkills(cfg.secondBrain, userSkillsDir());
function skillView(s) {
  const agents = reglages.skillOn(s.name);
  const usedBy = FUNCTIONS.filter(f => f.skill === s.name || f.uses?.some(u => path.basename(u) === s.name)).map(f => f.name);
  const own = s.origin === 'second-brain';
  return { name: s.name, description: s.description, origin: s.origin, agents, usedBy: agents ? [...usedBy, 'Agents'] : usedBy,
    ...(own ? { text: bundle.read(skillFile(s)), pending: bundle.isPending(skillFile(s)) } : {}) };
}
app.get('/api/reglages', (req, res) => {
  try { res.json({ models: MODELS, efforts: EFFORTS, functions: FUNCTIONS.map(fnView), skills: allSkills().map(skillView), connectors: connectors() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/reglages/functions/:id', (req, res) => {
  const f = FUNCTIONS.find(x => x.id === req.params.id);
  if (!f) return res.status(404).json({ error: 'fonction inconnue' });
  // picking what config.json or the code gives anyway clears the setting
  const b = req.body ?? {}, patch = {};
  for (const k of ['model', 'effort']) if (k in b) patch[k] = !b[k] || b[k] === pick(...(f[k] ?? [])) ? null : b[k];
  try { reglages.set(f.id, patch); res.json(fnView(f)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.put('/api/reglages/prompts/:id', (req, res) => {
  const f = FUNCTIONS.find(x => x.id === req.params.id && x.prompt);
  if (!f) return res.status(404).json({ error: 'fonction sans prompt' });
  const text = String(req.body?.text ?? '');
  if (!text.trim()) return res.status(400).json({ error: 'prompt vide' });
  if (text.trim() === f.prompt.trim()) reglages.resetPrompt(f.id); else reglages.setPrompt(f.id, text);
  res.json(fnView(f));
});
app.delete('/api/reglages/prompts/:id', (req, res) => {
  const f = FUNCTIONS.find(x => x.id === req.params.id && x.prompt);
  if (!f) return res.status(404).json({ error: 'fonction sans prompt' });
  reglages.resetPrompt(f.id);
  res.json(fnView(f));
});
// the MCP servers of ~/.claude.json the agents may get; only switched off here, never removed
// from there. dashboard is AlpesOS itself: always given.
const connectors = () => [
  { name: 'dashboard', does: 'lecture (second brain, todo, agenda, mails) et brouillons mail (boîte Infomaniak)', fixed: true },
  ...listMcp().filter(c => c.name !== 'dashboard').map(c => ({ ...c, agents: reglages.mcpOn(c.name) })),
];
app.put('/api/reglages/connectors/:name', (req, res) => {
  const c = connectors().find(x => x.name === req.params.name && !x.fixed);
  if (!c) return res.status(404).json({ error: 'connecteur introuvable' });
  if (typeof req.body?.agents !== 'boolean') return res.status(400).json({ error: 'agents attendu' });
  reglages.setMcp(c.name, req.body.agents);
  res.json({ ...c, agents: req.body.agents });
});
app.put('/api/reglages/skills/:name', (req, res) => {
  const s = allSkills().find(x => x.name === req.params.name);
  if (!s) return res.status(404).json({ error: 'skill introuvable' });
  const b = req.body ?? {};
  if (typeof b.text === 'string' && s.origin !== 'second-brain') return res.status(400).json({ error: 'seules les skills du second brain se modifient ici' });
  if (typeof b.text === 'string' && !b.text.trim()) return res.status(400).json({ error: 'SKILL.md vide' });
  try {
    if (typeof b.agents === 'boolean') reglages.setSkill(s.name, b.agents);
    if (typeof b.text === 'string' && b.text !== bundle.read(skillFile(s))) {
      bundle.replace(skillFile(s), b.text, { why: `skill ${s.name} modifiée depuis les Réglages d'AlpesOS`, subject: `Skill ${s.name}` });
    }
    res.json(skillView(s));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

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

// Loopback only: the API starts Claude runs and serves local files, with no
// authentication — nothing on the network may reach it.
// Prospection — targets, the companies found for each, campaigns (output/prospection/).
// Companies already known elsewhere are set aside at search time: clients of the second
// brain, companies of the shared CRM.
const prospection = makeProspection(path.join(ROOT, 'output', 'prospection'), {
  exclusionsOf: () => {
    let crm = [];
    try { crm = partenaires.etat().connexions.flatMap(c => partenaires.suivi.crm(c.id).entreprises?.map(e => e.nom) ?? []); } catch { /* no relay */ }
    // the shared CRM is Marc's follow-up of AlpesIA's prospection: a company there is his
    return { clients: listClients(cfg.secondBrain).map(c => c.title), crm: [], partenaire: crm };
  },
});
const prAsync = fn => async (req, res) => { try { res.json(await fn(req)); } catch (e) { res.status(/introuvable/.test(e.message) ? 404 : 400).json({ error: e.message }); } };
const prOk = (res, fn) => { try { res.json(fn()); } catch (e) { res.status(/introuvable/.test(e.message) ? 404 : 400).json({ error: e.message }); } };
const prAsk = (id, opts) => prIa.ask({ bin: cfg.claude.bin, ...setting(id), system: reglages.prompt(id, FUNCTIONS.find(f => f.id === id)?.prompt), cwd: ROOT, ...opts });
async function interpreterCible(phrase) {
  const p = String(phrase ?? '').trim();
  if (p.length < 8) throw new Error('décris la cible en une phrase : qui, où, quelle taille');
  const r = await prAsk('prospection-cible', { schema: prIa.CIBLE_SCHEMA, input: p, timeoutMs: 120e3 });
  return { ...r, phrase: p, criteres: { naf: r.naf, departements: r.departements, codes_postaux: r.codes_postaux, tranches: r.tranches } };
}
app.get('/api/prospection', (req, res) => prOk(res, () => ({ cibles: prospection.lister().map(prospection.resume), exclusions: prospection.exclusions().length })));
app.post('/api/prospection/interpreter', async (req, res) => {
  try { res.json(await interpreterCible(req.body?.phrase)); } catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/prospection/cibles', (req, res) => prOk(res, () => {
  const c = prospection.creer(req.body ?? {});
  if (req.body?.chercher !== false) prospection.chercher(c.slug);
  return prospection.get(c.slug);
}));
app.get('/api/prospection/cibles/:slug', (req, res) => prOk(res, () => prospection.get(req.params.slug)));
app.patch('/api/prospection/cibles/:slug', (req, res) => prOk(res, () => prospection.modifier(req.params.slug, req.body ?? {})));
app.post('/api/prospection/cibles/:slug/recherche', (req, res) => prOk(res, () => { prospection.chercher(req.params.slug); return prospection.get(req.params.slug); }));
// web research of each kept company (site, e-mail, phone, LinkedIn, buying moments)
const chercherEntreprise = (e, c) => prAsk('prospection-recherche', {
  schema: prIa.RECHERCHE_SCHEMA, tools: 'WebSearch,WebFetch', timeoutMs: 6 * 60e3,
  input: { entreprise: e.enseigne ? `${e.nom} (${e.enseigne})` : e.nom, ville: e.ville, code_postal: e.cp, siren: e.siren, activite: e.naf, dirigeants: e.dirigeants, holding: e.via_holding ?? null, moments_recherches: c.moments, aujourd_hui: new Date().toISOString().slice(0, 10) },
});
app.post('/api/prospection/cibles/:slug/enrichir', (req, res) => prOk(res, () => {
  prospection.enrichir(req.params.slug, chercherEntreprise, { sirens: req.body?.sirens ?? null, limite: Math.min(Number(req.body?.limite) || 60, 200) });
  return prospection.get(req.params.slug);
}));
app.patch('/api/prospection/cibles/:slug/entreprises/:siren', (req, res) => prOk(res, () => prospection.choisir(req.params.slug, req.params.siren, req.body?.etat, req.body?.raison)));
// the companies Marc already follows: ask him to introduce Christophe rather than cold-contact them
app.post('/api/prospection/cibles/:slug/presentations', prAsync(async req => {
  const c = prospection.get(req.params.slug);
  const list = c.entreprises.filter(e => e.etat === 'ecartee' && /connue de Marc/.test(e.raison ?? '') && !e.presentation_demandee);
  if (!list.length) throw new Error('aucune présentation à demander');
  const cx = partenaires.etat().connexions[0];
  if (!cx) throw new Error('relais avec Marc non configuré');
  const lignes = list.map(e => `- ${e.enseigne || e.nom} (${e.ville})${e.dirigeants?.[0] ? `, ${e.dirigeants[0].prenom} ${e.dirigeants[0].nom}` : ''}`).join('\n');
  await partenaires.envoyerMessage(cx.id, { type: 'question', sujet: `Présentations : ${c.titre}`,
    texte: `Je prospecte la cible « ${c.titre} » (${c.offre || 'Alpes IA'}). Tu suis déjà ces entreprises :\n${lignes}\n\nPeux-tu me présenter à celles où c'est pertinent, ou me dire lesquelles laisser de côté ?` });
  const at = new Date().toISOString();
  prospection.mutate(req.params.slug, x => { for (const e of x.entreprises) if (list.some(l => l.siren === e.siren)) e.presentation_demandee = at; });
  return { demandees: list.length };
}));
app.get('/api/prospection/exclusions', (req, res) => prOk(res, () => prospection.exclusions()));
app.post('/api/prospection/exclusions', (req, res) => prOk(res, () => prospection.exclure(req.body ?? {})));

// ---- campaigns: the sequence, Waalaxy for LinkedIn, the mailbox for e-mails ----
const waalaxy = makeWaalaxy(path.join(ROOT, 'credentials', 'waalaxy.json'));
const cibleIa = c => ({ titre: c.titre, pourquoi: c.pourquoi, moments: c.moments, offre: c.offre, lien: c.lien || '(pas encore de lien : écris {lien} quand même)' });
async function ecrireSequence(slug, consigne = '') {
  const c = prospection.get(slug);
  const etapes = c.campagne?.etapes ?? prCp.etapesParDefaut();
  const r = await prAsk('prospection-messages', { schema: prIa.MESSAGES_SCHEMA, timeoutMs: 240e3, input: { cible: cibleIa(c), etapes: etapes.map(({ id, canal, titre, delai }) => ({ id, canal, titre, delai })), consigne } });
  const byId = Object.fromEntries(r.etapes.map(x => [x.id, x]));
  prospection.preparerCampagne(slug, etapes.map(s => ({ ...s, objet: s.canal === 'email' ? (byId[s.id]?.objet ?? s.objet) : '', texte: byId[s.id]?.texte ?? s.texte })));
  return prospection.get(slug);
}
async function reecrire(slug, etapeId, consigne) {
  const c = prospection.get(slug), s = c.campagne?.etapes.find(x => x.id === etapeId);
  if (!s) throw new Error('étape introuvable');
  if (!String(consigne ?? '').trim()) throw new Error('dis ce qu\'il faut changer');
  const r = await prAsk('prospection-messages', { system: prIa.REECRIRE_SYSTEM, schema: prIa.REECRIRE_SCHEMA, timeoutMs: 180e3, input: { cible: cibleIa(c), etape: s, consigne } });
  prospection.modifierCampagne(slug, { etapes: c.campagne.etapes.map(x => (x.id === etapeId ? { ...x, objet: x.canal === 'email' ? r.objet : '', texte: r.texte } : x)) });
  return prospection.get(slug);
}
// one personal first e-mail for each prospect with a buying moment
async function personnaliser(slug) {
  const c = prospection.get(slug), first = c.campagne?.etapes.find(s => s.canal === 'email');
  if (!first) throw new Error('aucune étape e-mail');
  const list = c.entreprises.filter(e => e.etat === 'retenue' && e.signaux?.length && prCp.emailEnvoyable(e.contact) && !e.prospect?.perso?.[first.id]);
  for (let i = 0; i < list.length; i += 10) {
    const part = list.slice(i, i + 10);
    const r = await prAsk('prospection-messages', { system: prIa.PERSO_SYSTEM, schema: prIa.PERSO_SCHEMA, timeoutMs: 300e3,
      input: { cible: cibleIa(c), premier_email: { objet: first.objet, texte: first.texte }, entreprises: part.map(e => ({ siren: e.siren, entreprise: e.enseigne || e.nom, ville: e.ville, dirigeant: e.dirigeants?.[0] ?? null, moments: e.signaux })) } });
    prospection.personnaliser(slug, r.messages);
  }
  return { personnalises: list.length, cible: prospection.get(slug) };
}
async function pousserWaalaxy(slug) {
  const c = prospection.get(slug), w = c.campagne?.waalaxy;
  if (!w?.liste_id) return { envoyes: 0, raison: 'aucune liste Waalaxy choisie' };
  const todo = c.entreprises.filter(e => e.prospect?.statut === 'en_sequence' && e.contact?.linkedin && !e.prospect.waalaxy?.ok);
  if (!todo.length) return { envoyes: 0 };
  const res = await waalaxy.ajouter(todo.map(e => e.contact.linkedin), { liste: w.liste_id, campagne: w.campagne_id || null });
  prospection.mutate(slug, x => { for (const r of res) { const e = x.entreprises.find(y => y.contact?.linkedin === r.url); if (e?.prospect) e.prospect.waalaxy = { ok: r.ok, code: r.code, campagne: r.campagne, at: new Date().toISOString() }; } });
  return { envoyes: res.filter(r => r.ok).length, refuses: res.filter(r => !r.ok).length };
}
app.get('/api/prospection/waalaxy', prAsync(async () => (waalaxy.actif() ? { actif: true, listes: await waalaxy.listes(), campagnes: await waalaxy.campagnes() } : { actif: false })));
app.post('/api/prospection/cibles/:slug/campagne', prAsync(req => ecrireSequence(req.params.slug, req.body?.consigne)));
app.patch('/api/prospection/cibles/:slug/campagne', (req, res) => prOk(res, () => { prospection.modifierCampagne(req.params.slug, req.body ?? {}); return prospection.get(req.params.slug); }));
app.post('/api/prospection/cibles/:slug/campagne/reecrire', prAsync(req => reecrire(req.params.slug, req.body?.etape, req.body?.consigne)));
app.post('/api/prospection/cibles/:slug/campagne/personnaliser', prAsync(req => personnaliser(req.params.slug)));
app.post('/api/prospection/cibles/:slug/campagne/lancer', prAsync(async req => {
  const r = prospection.lancer(req.params.slug);
  let w = { envoyes: 0 };
  try { w = await pousserWaalaxy(req.params.slug); } catch (e) { w = { envoyes: 0, erreur: e.message }; }
  return { ajoutes: r.ajoutes, waalaxy: w, cible: prospection.get(req.params.slug) };
}));
app.post('/api/prospection/cibles/:slug/campagne/pause', (req, res) => prOk(res, () => { prospection.pause(req.params.slug, !!req.body?.on); return prospection.get(req.params.slug); }));
app.get('/api/prospection/appels', (req, res) => prOk(res, () => prospection.appels()));
app.post('/api/prospection/appels', (req, res) => prOk(res, () => {
  const { cible, siren, etape, issue, note } = req.body ?? {};
  if (issue === 'reporter') return prospection.reporter(cible, siren, etape, prCp.plus(prCp.jour(new Date()), Number(req.body?.jours) || 2));
  return prospection.noter(cible, siren, { etape, canal: 'appel', status: issue === 'joint' ? 'joint' : 'pas_joint', note: String(note ?? '').slice(0, 500) });
}));

// ---- replies: read in the mailbox (e-mail) or pasted (LinkedIn), read by Claude, decided by a Oui ----
const jourFr = () => new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' });
async function classerReponse(slug, r) {
  const c = prospection.get(slug), e = c.entreprises.find(x => x.siren === r.siren);
  const envoyes = (e?.prospect?.faits ?? []).filter(f => f.status === 'envoye').map(f => { const s = c.campagne?.etapes.find(x => x.id === f.etape); return { canal: f.canal, objet: f.sujet ?? s?.objet, texte: s ? prCp.remplir(e.prospect?.perso?.[s.id]?.texte ?? s.texte, prCp.variables(e, c)) : '' }; });
  const cl = await prAsk('prospection-reponses', { schema: prIa.REPONSE_SCHEMA, timeoutMs: 120e3,
    input: { aujourd_hui: jourFr(), cible: { titre: c.titre, offre: c.offre, lien: c.lien }, entreprise: e?.enseigne || e?.nom, ville: e?.ville, dirigeant: e?.dirigeants?.[0] ?? null, telephone: e?.contact?.telephone ?? null, canal: r.canal, messages_envoyes: envoyes, reponse: { de: r.nom || r.de, sujet: r.sujet, texte: r.texte } } });
  prospection.classer(slug, r.id, cl);
  if (cl.classe === 'stop') await exclureProspect(slug, r.siren, 'a demandé à ne plus être contacté', r.id);
  return cl;
}
// an opt-out is applied at once: excluded here, out of the sequence, on the Waalaxy do-not-contact list
async function exclureProspect(slug, siren, raison, reponseId = null) {
  const c = prospection.get(slug), e = c.entreprises.find(x => x.siren === siren);
  if (!e) throw new Error('entreprise introuvable');
  prospection.exclure({ siren, email: e.contact?.email ?? null, linkedin: e.contact?.linkedin ?? null, nom: e.enseigne || e.nom, raison });
  prospection.statut(slug, siren, 'exclu');
  let wx = null;
  if (e.contact?.linkedin && waalaxy.actif()) {
    try { const npc = (await waalaxy.listes()).find(l => l.ne_pas_contacter); if (npc) wx = (await waalaxy.ajouter([e.contact.linkedin], { liste: npc.id }))[0]; } catch (err) { wx = { ok: false, code: err.message }; }
  }
  // Marc prospects for AlpesIA too: an opt-out holds for both
  let marc = false;
  try {
    const cx = partenaires.etat().connexions[0];
    if (cx) { await partenaires.envoyerMessage(cx.id, { type: 'info', sujet: 'Ne plus contacter', texte: `${e.enseigne || e.nom} (${e.ville}, SIREN ${siren})${e.dirigeants?.[0] ? `, ${e.dirigeants[0].prenom} ${e.dirigeants[0].nom}` : ''} demande à ne plus être contacté par AlpesIA. Je l'ai retiré de mes campagnes : à retirer aussi des tiennes.` }); marc = true; }
  } catch (err) { console.warn('prospection : exclusion non transmise à Marc', err.message); }
  if (reponseId) prospection.traiter(slug, reponseId, { etat: 'traitee', note: ['exclu', wx?.ok && 'ajouté à « Ne pas contacter » dans Waalaxy', marc && 'Marc prévenu'].filter(Boolean).join(', ') });
  return { exclu: true, waalaxy: wx, marc };
}
// the replies to campaign e-mails, read in the Infomaniak mailbox
async function lireReponses() {
  const who = new Map();
  let since = null;
  for (const c of prospection.lister()) {
    if (!c.campagne || c.campagne.etat === 'brouillon') continue;
    for (const e of c.entreprises) {
      const sent = (e.prospect?.faits ?? []).filter(f => f.canal === 'email' && f.status === 'envoye');
      if (!sent.length || e.prospect.statut === 'exclu') continue;
      who.set(e.contact.email.toLowerCase(), { slug: c.slug, siren: e.siren });
      if (!since || sent[0].at < since) since = sent[0].at;
    }
  }
  if (!who.size) return 0;
  let n = 0;
  for (const m of await mail.messagesDe(who.keys(), { since })) {
    const w = who.get(m.de);
    const r = prospection.ajouterReponse(w.slug, { siren: w.siren, canal: 'email', texte: m.texte, de: m.de, nom: m.nom, sujet: m.sujet, uid: m.uid, thread: m.thread, messageId: m.messageId, date: m.date });
    if (!r) continue;
    n++;
    classerReponse(w.slug, r).catch(err => console.warn('prospection : lecture de réponse', err.message));
  }
  return n;
}
app.get('/api/prospection/reponses', (req, res) => prOk(res, () => ({
  reponses: prospection.reponses(),
  prospects: prospection.lister().filter(c => c.campagne).flatMap(c => c.entreprises.filter(e => e.prospect?.depart).map(e => ({ cible: c.slug, cible_titre: c.titre, siren: e.siren, nom: e.enseigne || e.nom, dirigeant: e.dirigeants?.[0] ? `${e.dirigeants[0].prenom} ${e.dirigeants[0].nom}` : '' }))),
})));
app.post('/api/prospection/reponses/lire', prAsync(async () => ({ nouvelles: await lireReponses() })));
// a LinkedIn reply pasted by Christophe: to whom it belongs is given, or found by name
app.post('/api/prospection/reponses', prAsync(async req => {
  const texte = String(req.body?.texte ?? '').trim();
  if (texte.length < 2) throw new Error('colle la réponse reçue');
  let { cible, siren } = req.body ?? {};
  if (req.body?.prospect) [cible, siren] = String(req.body.prospect).split('|');
  if (!cible || !siren) {
    const words = s => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    const t = words(texte);
    const hits = prospection.lister().filter(c => c.campagne).flatMap(c => c.entreprises.filter(e => e.prospect?.depart).map(e => ({ c, e })))
      .filter(({ e }) => { const d = e.dirigeants?.[0]; return (d && t.includes(words(d.nom)) && words(d.nom).length > 2) || t.includes(words(e.enseigne || e.nom)); });
    if (hits.length !== 1) throw new Error(hits.length ? 'plusieurs prospects possibles : choisis-le dans la liste' : 'prospect non reconnu : choisis-le dans la liste');
    cible = hits[0].c.slug; siren = hits[0].e.siren;
  }
  const r = prospection.ajouterReponse(cible, { siren, canal: 'linkedin', texte });
  await classerReponse(cible, r);
  return prospection.reponses().find(x => x.id === r.id);
}));
app.post('/api/prospection/reponses/:cible/:id/ignorer', (req, res) => prOk(res, () => prospection.traiter(req.params.cible, req.params.id, { etat: 'ignoree' })));
app.post('/api/prospection/reponses/:cible/:id/rdv', (req, res) => prOk(res, () => {
  const r = prospection.reponses().find(x => x.id === req.params.id && x.cible === req.params.cible);
  if (!r) throw new Error('réponse introuvable');
  return prospection.statut(req.params.cible, r.siren, 'repondu', { rdv: String(req.body?.date ?? new Date().toISOString().slice(0, 10)), interesse: true });
}));
// "Oui": what the card proposed. Sending a reply is this click's own authorisation.
app.post('/api/prospection/reponses/:cible/:id/oui', prAsync(async req => {
  const slug = req.params.cible, r = prospection.reponses().find(x => x.id === req.params.id && x.cible === slug);
  if (!r) throw new Error('réponse introuvable');
  if (r.etat !== 'a_traiter') throw new Error('réponse déjà traitée');
  const texte = String(req.body?.reponse ?? r.reponse ?? '').trim();
  const qui = r.dirigeant ? `${r.dirigeant.prenom} ${r.dirigeant.nom}` : r.entreprise;
  const out = { fait: r.action };
  if (r.classe === 'interesse') {
    try {
      const cx = partenaires.etat().connexions[0];
      if (cx) {
        const a = partenaires.suivi.creerAffaire(cx.id, { titre: `${prospection.get(slug).offre || 'Alpes IA'} · ${r.entreprise}`.slice(0, 200), entreprise: { nom: r.entreprise, ville: r.ville, domaine: r.contact?.site ? new URL(r.contact.site).hostname.replace(/^www\./, '') : '' }, contact: { nom: qui, fonction: r.dirigeant?.qualite, email: r.contact?.email, telephone: r.contact?.telephone }, prochaine_etape: r.question });
        out.crm = a.ref;
      }
    } catch (e) { out.crm_erreur = e.message; }
  }
  if (r.action === 'repondre' || r.action === 'renvoyer') {
    if (!texte) throw new Error('pas de réponse à envoyer');
    if (r.canal === 'email' && r.action === 'repondre') {
      const sent = await mail.send({ to: r.de, subject: /^re\s*:/i.test(r.sujet) ? r.sujet : `Re: ${r.sujet || r.entreprise}`, body: texte, inReplyTo: r.messageId, references: r.messageId ?? '' }, { confirmed: true });
      out.envoye = sent.to;
    } else {
      out.copier = texte;
      out.ouvrir = r.canal === 'linkedin' ? r.contact?.linkedin ?? null : null;
      if (r.action === 'renvoyer' && r.personne?.nom) addItem(todoFile, { t: `Écrire à ${r.personne.nom}${r.personne.fonction ? ` (${r.personne.fonction})` : ''} chez ${r.entreprise}${r.personne.contact ? ` : ${r.personne.contact}` : ''}`, s: 'Prospection' });
    }
  } else if (r.action === 'appeler') {
    addItem(todoFile, { t: `Appeler ${qui} (${r.entreprise})${r.contact?.telephone ? ` au ${r.contact.telephone}` : ''}`, s: 'Prospection' });
    out.todo = true;
  } else if (r.action === 'relancer') {
    const d = /^\d{4}-\d{2}-\d{2}$/.test(req.body?.date ?? '') ? req.body.date : r.relance || prCp.plus(prCp.jour(new Date()), 90);
    prospection.reporter(slug, r.siren, 'relance', d);
    prospection.mutate(slug, c => { const e = c.entreprises.find(x => x.siren === r.siren); if (e?.prospect) e.prospect.relance_note = r.fait; });
    out.relance = d;
  } else if (r.action === 'exclure') {
    Object.assign(out, await exclureProspect(slug, r.siren, 'pas intéressé'));
  }
  prospection.traiter(slug, r.id, { etat: 'traitee', reponse: texte || undefined });
  return out;
}));

// the clock: only the real instance sends, unless a test asks for it
const prAuto = sbQueue === CURATOR_QUEUE || process.env.ALPES_OS_PROSPECTION_AUTO === '1';
async function prPasse() {
  if (!prOuvert()) return;
  try { await lireReponses(); } catch (e) { console.warn('prospection : réponses', e.message); }
  try { const r = await prTick({ prospection, mail, log: m => console.warn(m) }); if (r.envoyes) console.log(`prospection : ${r.envoyes} e-mail(s) envoyé(s)`); } catch (e) { console.warn('prospection :', e.message); }
}
if (prAuto) setInterval(prPasse, 10 * 60e3).unref();

app.listen(PORT, '127.0.0.1', () => {
  const st = google.status();
  console.log(`Alpes IA OS  →  http://localhost:${PORT}`);
  console.log(`second brain: ${cfg.secondBrain}`);
  if (!st.hasSecret) console.log('agenda: credentials/client_secret.json manquant (Google Cloud Console → OAuth client "Desktop app")');
  else if (!st.hasToken) console.log(`agenda: ouvrir http://localhost:${PORT}/auth/google pour autoriser`);
  else console.log('agenda: autorisé');
  console.log(mail.status().hasToken ? `mail: ${mailCfg.mailbox ?? 'mail.mailbox manquant dans config.json'}` : 'mail: credentials/infomaniak.json manquant (jeton API Infomaniak)');
});
