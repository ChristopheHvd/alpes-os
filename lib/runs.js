// Headless skill runs (ARMS Skills L3): each button press spawns `claude -p "/skill brief"`.
// Runs are tracked in memory, logged one line each to runs.log, output files land in output/<app>/.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export function makeRunner(root, cfg) {
  const runs = [];
  const logPath = path.join(root, 'runs.log');
  const log = line => fs.appendFileSync(logPath, `${new Date().toISOString()} ${line}\n`);

  function start({ app, action, brief, model }) {
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const outDir = path.join(root, app.output);
    fs.mkdirSync(outDir, { recursive: true });
    const prompt = `${app.skill} ${action.id}\n\n${brief}\n\nÉcris les fichiers produits dans ${outDir}/ et termine par une ligne "OUTPUT: <chemin>" par fichier créé.`;
    const args = ['-p', prompt, '--model', model || app.model || cfg.defaultModel, '--permission-mode', cfg.permissionMode, '--allowedTools', cfg.allowedTools, '--add-dir', cfg.secondBrain];
    const run = { id, app: app.id, action: action.id, brief, model: args[3], status: 'running', startedAt: new Date().toISOString(), output: '', files: [] };
    runs.unshift(run); if (runs.length > 50) runs.pop();
    log(`START ${id} ${app.id}/${action.id} model=${run.model} brief="${brief.slice(0, 80).replace(/\n/g, ' ')}"`);
    const child = spawn(cfg.bin, args, { cwd: root, env: { ...process.env, CLAUDECODE: '' } });
    child.stdout.on('data', d => run.output += d);
    child.stderr.on('data', d => run.output += d);
    child.on('close', code => {
      run.status = code === 0 ? 'done' : 'failed';
      run.endedAt = new Date().toISOString();
      run.files = [...run.output.matchAll(/^OUTPUT:\s*(.+)$/gm)].map(m => m[1].trim());
      if (!run.files.length) run.files = recentFiles(outDir, run.startedAt);
      log(`${run.status.toUpperCase()} ${id} code=${code} files=${run.files.join(',') || '-'}`);
    });
    child.on('error', e => { run.status = 'failed'; run.output += String(e); log(`ERROR ${id} ${e.message}`); });
    return run;
  }

  function recentFiles(dir, since) {
    const t = new Date(since).getTime();
    return fs.readdirSync(dir).map(f => path.join(dir, f)).filter(p => fs.statSync(p).isFile() && fs.statSync(p).mtimeMs >= t);
  }

  function artifacts() {
    const out = [];
    for (const app of cfgApps()) {
      const dir = path.join(root, app.output);
      if (!fs.existsSync(dir)) continue;
      for (const f of fs.readdirSync(dir)) { const p = path.join(dir, f); const st = fs.statSync(p); if (st.isFile() && !f.startsWith('.')) out.push({ app: app.id, name: f, path: path.relative(root, p), mtime: st.mtimeMs, size: st.size }); }
    }
    return out.sort((a, b) => b.mtime - a.mtime).slice(0, 12);
  }
  const cfgApps = () => cfg.apps;

  return { start, list: () => runs.map(r => ({ ...r, output: r.output.slice(-4000) })), get: id => runs.find(r => r.id === id), artifacts };
}
