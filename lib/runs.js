// Headless skill runs (ARMS Skills L3): each button press spawns `claude -p "/skill brief"`.
// Runs are persisted to output/runs.json so the history survives a restart, logged one
// line each to runs.log, and their output files land in output/<app>/.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const MAX_RUNS = 200;
const MAX_OUTPUT = 20000;

export function makeRunner(root, cfg) {
  const storePath = path.join(root, 'output', 'runs.json');
  const logPath = path.join(root, 'runs.log');
  const log = line => fs.appendFileSync(logPath, `${new Date().toISOString()} ${line}\n`);

  let runs = [];
  try {
    if (fs.existsSync(storePath)) runs = JSON.parse(fs.readFileSync(storePath, 'utf8'));
  } catch (e) { log(`STORE-READ-FAILED ${e.message}`); }
  // a run left "running" by a server restart can never finish — mark it as interrupted
  for (const r of runs) if (r.status === 'running') r.status = 'interrupted';

  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        fs.mkdirSync(path.dirname(storePath), { recursive: true });
        fs.writeFileSync(storePath, JSON.stringify(runs.slice(0, MAX_RUNS), null, 1));
      } catch (e) { log(`STORE-WRITE-FAILED ${e.message}`); }
    }, 250);
  }

  const rel = f => path.relative(root, path.resolve(root, f));

  function start({ app, action, brief, model, from }) {
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const outDir = path.join(root, app.output);
    fs.mkdirSync(outDir, { recursive: true });
    const base = (from ?? []).map(f => path.resolve(root, f)).filter(f => fs.existsSync(f));
    const prompt = `${app.skill} ${action.id}\n\n${brief}\n\n${base.length ? `Reprends le ou les fichiers existants ci-dessous et applique la demande dessus, en écrasant la même version (ne repars pas de zéro) :\n${base.map(f => '- ' + f).join('\n')}\n\n` : ''}Écris les fichiers produits dans ${outDir}/ et termine par une ligne "OUTPUT: <chemin>" par fichier créé.`;
    const args = ['-p', prompt, '--model', model || app.model || cfg.defaultModel, '--permission-mode', cfg.permissionMode, '--allowedTools', cfg.allowedTools, '--add-dir', cfg.secondBrain];
    const run = {
      id, app: app.id, action: action.id, actionLabel: action.label, brief,
      from: base.map(rel), model: args[3], status: 'running',
      startedAt: new Date().toISOString(), endedAt: null, output: '', files: [],
    };
    runs.unshift(run); if (runs.length > MAX_RUNS) runs.length = MAX_RUNS;
    save();
    log(`START ${id} ${app.id}/${action.id} model=${run.model} brief="${brief.slice(0, 80).replace(/\n/g, ' ')}"`);

    const child = spawn(cfg.bin, args, { cwd: root, env: { ...process.env, CLAUDECODE: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
    const append = d => { run.output = (run.output + d).slice(-MAX_OUTPUT); };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    child.on('close', code => {
      run.status = code === 0 ? 'done' : 'failed';
      run.endedAt = new Date().toISOString();
      const declared = [...run.output.matchAll(/^OUTPUT:\s*(.+)$/gm)].map(m => m[1].trim());
      run.files = (declared.length ? declared : recentFiles(outDir, run.startedAt))
        .map(rel).filter(f => !f.startsWith('..') && fs.existsSync(path.join(root, f)));
      save();
      log(`${run.status.toUpperCase()} ${id} code=${code} files=${run.files.join(',') || '-'}`);
    });
    child.on('error', e => { run.status = 'failed'; run.endedAt = new Date().toISOString(); run.output += String(e); save(); log(`ERROR ${id} ${e.message}`); });
    return run;
  }

  function recentFiles(dir, since) {
    const t = new Date(since).getTime();
    return fs.readdirSync(dir).map(f => path.join(dir, f))
      .filter(p => fs.statSync(p).isFile() && path.basename(p) !== 'runs.json' && fs.statSync(p).mtimeMs >= t);
  }

  function fileInfo(p) {
    const abs = path.join(root, p);
    if (!fs.existsSync(abs)) return null;
    const st = fs.statSync(abs);
    if (!st.isFile()) return null;
    return { path: p, name: path.basename(p), ext: path.extname(p).slice(1).toLowerCase(), mtime: st.mtimeMs, size: st.size };
  }

  // every file in every app's output folder, newest first, with the run that made it
  function artifacts(appId) {
    const out = [];
    for (const app of cfg.apps) {
      if (appId && app.id !== appId) continue;
      const dir = path.join(root, app.output);
      if (!fs.existsSync(dir)) continue;
      for (const f of fs.readdirSync(dir)) {
        if (f.startsWith('.') || f === 'runs.json') continue;
        const info = fileInfo(path.join(app.output, f));
        if (!info) continue;
        const run = runs.find(r => (r.files ?? []).includes(info.path));
        out.push({ ...info, app: app.id, runId: run?.id ?? null });
      }
    }
    return out.sort((a, b) => b.mtime - a.mtime);
  }

  const shape = r => ({ ...r, output: r.output.slice(-4000), files: (r.files ?? []).map(fileInfo).filter(Boolean) });

  return {
    start,
    list: appId => runs.filter(r => !appId || r.app === appId).map(shape),
    get: id => { const r = runs.find(x => x.id === id); return r ? shape(r) : null; },
    artifacts,
    // files an app produced that no stored run claims (made before history, or by hand)
    orphans: appId => artifacts(appId).filter(f => !f.runId),
  };
}
