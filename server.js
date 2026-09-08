// Alpes IA Agentic OS — local command centre.
// One page, one address (http://localhost:4545), a window onto the second brain,
// Gmail, the day's todo and headless micro-apps. It shows, it never stores truth.
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getGraph, readNote } from './lib/brain.js';
import { readTodo, writeTodo } from './lib/todo.js';
import { makeGmail } from './lib/gmail.js';
import { makeRunner } from './lib/runs.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/config.json'), 'utf8'));
const branding = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/branding.json'), 'utf8'));
const todoFile = path.join(cfg.secondBrain, cfg.todoFile);
const gmail = makeGmail(path.join(ROOT, 'credentials'), cfg.port);
const runner = makeRunner(ROOT, { ...cfg.claude, apps: cfg.apps, secondBrain: cfg.secondBrain });

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(ROOT, 'public')));
app.use('/output', express.static(path.join(ROOT, 'output')));

app.get('/api/config', (req, res) => res.json({ apps: cfg.apps, gmail: { label: cfg.gmail.label, ...gmail.status() }, brand: { company: branding.company, owner: branding.owner }, secondBrain: cfg.secondBrain }));

// Memory — the visual second brain
app.get('/api/graph', (req, res) => res.json(getGraph(cfg.secondBrain, cfg.brainFolders)));
app.get('/api/note', (req, res) => { const n = readNote(cfg.secondBrain, String(req.query.id ?? '')); n ? res.json(n) : res.status(404).json({ error: 'not found' }); });

// Todo — markdown file in the second brain
app.get('/api/todo', (req, res) => res.json(readTodo(todoFile)));
app.put('/api/todo', (req, res) => res.json(writeTodo(todoFile, Array.isArray(req.body.items) ? req.body.items : [])));

// Applications — Gmail
app.get('/auth/google', (req, res) => { const u = gmail.authUrl(); u ? res.redirect(u) : res.status(400).send('credentials/client_secret.json manquant'); });
app.get('/auth/callback', async (req, res) => { try { await gmail.exchange(String(req.query.code)); res.redirect('/'); } catch (e) { res.status(500).send(String(e)); } });
let gmailCache = null;
app.get('/api/gmail', async (req, res) => {
  const st = gmail.status();
  if (!st.hasSecret || !st.hasToken) return res.json({ needsAuth: true, ...st });
  try {
    if (!gmailCache || req.query.refresh || Date.now() - gmailCache.at > 120e3) gmailCache = { at: Date.now(), data: await gmail.flagged(cfg.gmail) };
    res.json(gmailCache.data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Skills — headless runs
app.get('/api/runs', (req, res) => res.json(runner.list()));
app.get('/api/runs/:id', (req, res) => { const r = runner.get(req.params.id); r ? res.json(r) : res.status(404).end(); });
app.post('/api/runs', (req, res) => {
  const a = cfg.apps.find(x => x.id === req.body.app), act = a?.actions.find(x => x.id === req.body.action);
  if (!a || !act || !req.body.brief?.trim()) return res.status(400).json({ error: 'app, action et brief requis' });
  res.json(runner.start({ app: a, action: act, brief: req.body.brief.trim(), model: req.body.model }));
});
app.get('/api/artifacts', (req, res) => res.json(runner.artifacts()));

app.listen(cfg.port, () => {
  const st = gmail.status();
  console.log(`Alpes IA OS  →  http://localhost:${cfg.port}`);
  console.log(`second brain: ${cfg.secondBrain}`);
  if (!st.hasSecret) console.log('gmail: credentials/client_secret.json manquant (Google Cloud Console → OAuth client "Desktop app")');
  else if (!st.hasToken) console.log(`gmail: ouvrir http://localhost:${cfg.port}/auth/google pour autoriser`);
  else console.log('gmail: autorisé');
});
