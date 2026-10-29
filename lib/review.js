// The hourly review: once an hour on working days, a light model steps back on
// Christophe's day — what he did in Claude Code, his notes, projects, todo, agenda
// and money due — ranks today's tasks with one line of why each, and suggests what
// is missing. The server gathers every fact itself; the model gets no tools.
//
// The ranking stays in output/review.json, todo.md is never rewritten for it. The
// suggestions join the shared propositions block (lib/propositions.js).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { same } from './propositions.js';

const TIMEOUT_MS = 3 * 60e3;
const WHY = 80;

const SYSTEM = `Tu fais la revue horaire de la journée de Christophe, indépendant à Annecy (IA générative
et automatisation pour TPE/PME). Le CONTEXTE donne, en JSON : l'heure, ce qu'il a fait depuis ce
matin dans Claude Code (une entrée par session : dossier, plage horaire, extraits de ce qu'il a
écrit), ses notes récentes, ses projets avec leur prochaine étape, sa todo, son agenda et ses
échéances financières.

Rends trois choses :
- summary : sur quoi il a passé sa journée jusqu'ici (activite_claude_code, notes_recentes) et ce
  qui reste ouvert, en deux phrases courtes, 280 caractères au plus. Parle de son travail, pas de
  l'outil. Uniquement des faits tirés du contexte. Pas de formule d'introduction, pas
  d'encouragement, pas de conseil.
- ranking : chaque tâche de taches_du_jour une seule fois, par son id, dans l'ordre où il devrait
  les prendre à partir de maintenant (l'heure, l'agenda, les échéances, ce sur quoi il travaille).
  why : pourquoi cette place, en une ligne de ${WHY} caractères au plus.
- propositions : de zéro à trois tâches qui manquent à sa todo et qui comptent pour aujourd'hui ou
  demain — une prochaine étape de projet qui n'avance pas, un rendez-vous à préparer, une échéance
  à relancer, la suite évidente de ce qu'il a fait. title : une action concrète à l'infinitif, qu'il lit
  pour lui-même (sans le nommer), 70 caractères au plus. project : le slug du projet concerné, ou "". why : le fait qui la
  justifie, ${WHY} caractères au plus. Ne propose rien qui soit déjà dans taches_du_jour,
  faites_aujourdhui, plus_tard, propositions_en_attente ou propositions_ignorees, même formulé
  autrement. Si rien ne manque vraiment, rends une liste vide.

Écris en français, sans emoji.`;

const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['summary', 'ranking', 'propositions'],
  properties: {
    summary: { type: 'string' },
    ranking: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['id', 'why'], properties: { id: { type: 'integer' }, why: { type: 'string' } } },
    },
    propositions: {
      type: 'array', maxItems: 3,
      items: { type: 'object', additionalProperties: false, required: ['title', 'project', 'why'], properties: { title: { type: 'string' }, project: { type: 'string' }, why: { type: 'string' } } },
    },
  },
};

// schedule: { weekdays: [1..5] (0 or 7 = Sunday), from: 9, to: 19 } — one review per
// hour from "from" o'clock to "to" o'clock included
const isOn = (d, { weekdays, from, to }) => weekdays.some(w => w % 7 === d.getDay()) && d.getHours() >= from && d.getHours() <= to;
const hourOf = d => { const h = new Date(d); h.setMinutes(0, 0, 0); return h; };

// due once per hour slot, failed attempts included: a broken CLI is not retried every minute
export function due(now, schedule, lastAttempt) {
  return isOn(now, schedule) && !(lastAttempt && Date.parse(lastAttempt) >= hourOf(now).getTime());
}

export function nextSlot(now, schedule) {
  const d = hourOf(now);
  for (let i = 0; i < 24 * 8; i++) {
    d.setHours(d.getHours() + 1);
    if (isOn(d, schedule)) return d;
  }
  return null;
}

function ask(bin, model, ctx, cwd) {
  return new Promise((resolve, reject) => {
    const args = ['-p', '--model', model, '--tools', '', '--strict-mcp-config', '--no-session-persistence',
      '--output-format', 'json', '--json-schema', JSON.stringify(SCHEMA), '--system-prompt', SYSTEM];
    const child = spawn(bin, args, { cwd, env: { ...process.env, CLAUDECODE: '' }, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => child.kill(), TIMEOUT_MS);
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err = (err + d).slice(-1000); });
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.on('close', code => {
      clearTimeout(timer);
      try {
        const r = JSON.parse(out);
        const data = r.structured_output ?? JSON.parse(r.result);
        if (r.is_error || !data) throw new Error(String(r.result ?? 'réponse vide').slice(0, 300));
        resolve(data);
      } catch (e) { reject(new Error(`revue échouée (code ${code}) : ${(err || out || e.message).slice(-300)}`)); }
    });
    child.stdin.end(`CONTEXTE:\n${JSON.stringify(ctx, null, 1)}`);
  });
}

const line = (s, max) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export function makeReview(file, { bin, model, schedule, auto }, { context, propositions }) {
  let state = {};
  try { state = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* never ran */ }
  const save = () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file + '.tmp', JSON.stringify(state, null, 1));
    fs.renameSync(file + '.tmp', file);
  };
  let running = null;

  async function pass(reason) {
    const started = new Date();
    state.attemptAt = started.toISOString();
    save();
    const midnight = new Date(started); midnight.setHours(0, 0, 0, 0);
    propositions.expire(midnight.toISOString());
    const ctx = {
      ...(await context()),
      propositions_en_attente: propositions.pending().map(p => p.title),
      propositions_ignorees: propositions.dismissed().slice(-60).map(p => p.title),
    };
    const out = await ask(bin, model, ctx, path.dirname(file));

    const tasks = ctx.taches_du_jour ?? [];
    const ranked = [];
    for (const r of out.ranking ?? []) {
      const t = tasks.find(x => x.id === r.id);
      if (t && !ranked.some(x => x.id === t.id)) ranked.push({ id: t.id, t: t.t, why: line(r.why, WHY) });
    }
    for (const t of tasks) if (!ranked.some(x => x.id === t.id)) ranked.push({ id: t.id, t: t.t, why: '' });

    const taken = new Set([...tasks.map(x => x.t), ...(ctx.faites_aujourdhui ?? []), ...(ctx.plus_tard ?? [])].map(same));
    const added = [];
    for (const p of (out.propositions ?? []).slice(0, 3)) {
      const title = line(p.title, 120);
      if (!title || taken.has(same(title))) continue;
      const project = ctx.projets?.find(x => x.slug === p.project)?.titre ?? line(p.project, 80);
      const made = propositions.add({ source: 'revue', title, project, why: line(p.why, WHY) });
      if (made.status === 'pending' && !added.includes(made.id)) added.push(made.id);
    }

    state = {
      at: new Date().toISOString(), attemptAt: state.attemptAt, reason, model, ms: Date.now() - started,
      summary: line(out.summary, 400), ranking: ranked.map(({ id, ...r }) => r), propositions: added, error: null,
    };
    save();
    return state;
  }

  // one review at a time: a second request gets the running one's outcome
  function run(reason = 'demandée') {
    if (running) return { already: true, done: running };
    running = pass(reason).catch(e => {
      state = { ...state, error: e.message, errorAt: new Date().toISOString() };
      save();
      throw e;
    }).finally(() => { running = null; });
    return { already: false, done: running };
  }

  function tick(now = new Date()) {
    if (!auto || running || !due(now, schedule, state.attemptAt)) return;
    run('planifiée').done.catch(e => console.error('review', e.message));
  }

  return {
    run, tick,
    status: (now = new Date()) => ({ ...state, running: !!running, auto, next: nextSlot(now, schedule)?.toISOString() ?? null }),
  };
}
