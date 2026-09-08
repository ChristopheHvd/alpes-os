// Rebuilds output/runs.json from runs.log, for runs made before the history was persisted.
// Existing entries win; this only adds what is missing. Run once: node scripts/backfill-runs.js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/config.json'), 'utf8'));
const logPath = path.join(ROOT, 'runs.log');
const storePath = path.join(ROOT, 'output', 'runs.json');
if (!fs.existsSync(logPath)) { console.log('runs.log absent, rien à reconstruire'); process.exit(0); }

const existing = fs.existsSync(storePath) ? JSON.parse(fs.readFileSync(storePath, 'utf8')) : [];
const known = new Set(existing.map(r => r.id));
const found = new Map();

for (const line of fs.readFileSync(logPath, 'utf8').split('\n')) {
  const start = line.match(/^(\S+) START (\S+) (\S+)\/(\S+) model=(\S+) brief="(.*)"$/);
  if (start) {
    const [, ts, id, app, action, model, brief] = start;
    const a = cfg.apps.find(x => x.id === app);
    found.set(id, {
      id, app, action, actionLabel: a?.actions.find(x => x.id === action)?.label ?? action,
      brief, from: [], model, status: 'interrupted', startedAt: ts, endedAt: null,
      output: '(exécution antérieure à l\'historique — sortie non conservée)', files: [],
    });
    continue;
  }
  const end = line.match(/^(\S+) (DONE|FAILED|ERROR) (\S+) (?:code=(-?\d+) )?files=(.*)$/);
  if (end) {
    const [, ts, kind, id, , files] = end;
    const r = found.get(id);
    if (!r) continue;
    r.status = kind === 'DONE' ? 'done' : 'failed';
    r.endedAt = ts;
    r.files = files === '-' ? [] : files.split(',')
      .map(f => path.relative(ROOT, path.resolve(ROOT, f.trim())))
      .filter(f => f && !f.startsWith('..') && fs.existsSync(path.join(ROOT, f)));
  }
}

const added = [...found.values()].filter(r => !known.has(r.id));
const all = [...existing, ...added].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
fs.mkdirSync(path.dirname(storePath), { recursive: true });
fs.writeFileSync(storePath, JSON.stringify(all, null, 1));
console.log(`${added.length} exécutions récupérées, ${all.length} au total dans output/runs.json`);
for (const r of added) console.log(`  ${r.startedAt.slice(0, 16).replace('T', ' ')}  ${r.app}/${r.action}  ${r.status}  ${r.files.length} fichier(s)`);
