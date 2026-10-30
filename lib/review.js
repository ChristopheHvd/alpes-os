// The hourly review: once an hour on working days, a light model steps back on
// Christophe's day — what he did in Claude Code, his notes, projects, todo, agenda
// and money due — ranks today's tasks with one line of why each, and suggests what
// is missing. The server gathers every fact itself; the model gets no tools.
//
// The ranking stays in output/review.json, todo.md is never rewritten for it. The
// suggestions join the shared propositions block (lib/propositions.js), and so does
// money a client committed to by mail (type 'finance'): its amount must appear in
// the mail or in the second brain excerpts given to the model, or it is dropped.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { same, moneyKey } from './propositions.js';

const TIMEOUT_MS = 3 * 60e3;
const WHY = 80;

export const SYSTEM = `Tu fais la revue horaire de la journée de Christophe, indépendant à Annecy (IA générative
et automatisation pour TPE/PME). Le CONTEXTE donne, en JSON : l'heure, ce qu'il a fait depuis ce
matin dans Claude Code (une entrée par session : dossier, plage horaire, extraits de ce qu'il a
écrit), ses notes récentes, ses projets avec leur prochaine étape, ceux qu'il a mis en pause,
terminés ou archivés (projets_arretes, avec sa décision), sa todo, son agenda, ses échéances
financières et les mails de vraies personnes arrivés depuis la revue précédente.

Rends quatre choses :
- summary : de deux à quatre puces courtes, 70 caractères environ chacune : sur quoi il a passé
  sa journée jusqu'ici (activite_claude_code, notes_recentes), puis ce qui reste ouvert. Un fait
  par puce, tiré du contexte. Parle de son travail, pas de l'outil. Pas de tiret en tête, pas de
  formule d'introduction, pas d'encouragement, pas de conseil.
- ranking : chaque tâche de taches_du_jour une seule fois, par son id, dans l'ordre où il devrait
  les prendre à partir de maintenant (l'heure, l'agenda, les échéances, ce sur quoi il travaille).
  why : pourquoi cette place, en une ligne de ${WHY} caractères au plus.
- propositions : de zéro à trois tâches qui manquent à sa todo et qui comptent pour aujourd'hui ou
  demain — une prochaine étape de projet qui n'avance pas, un rendez-vous à préparer, une échéance
  à relancer, la suite évidente de ce qu'il a fait. title : une action concrète à l'infinitif, qu'il lit
  pour lui-même (sans le nommer), 70 caractères au plus. project : le slug du projet concerné, ou "". why : le fait qui la
  justifie, ${WHY} caractères au plus. Deux propositions sur le même sujet (même projet, même
  personne, même échéance) n'en font qu'une. Ne propose rien qui soit déjà dans taches_du_jour,
  faites_aujourdhui, plus_tard, propositions_en_attente, propositions_ignorees ou
  confiees_a_un_agent, même formulé autrement. Si rien ne manque vraiment, rends une liste vide.
- finances : de zéro à trois rentrées d'argent à inscrire, tirées de mails_recents. Seulement
  quand un mail montre un engagement ferme du client : formation validée, devis signé, bon de
  commande, proposition acceptée. Rien pour une demande de devis, une question ou une
  discussion en cours. client : son slug dans clients. note : le slug de sa note dans
  notes_finance, ou "" s'il n'en a pas. libelle : la prestation, en quelques mots. montant : en
  euros. Ne l'invente jamais : prends-le dans le mail, sinon dans notes_finance ou
  extraits_clients (devis, tarifs) ; si rien ne le donne, ne propose rien. date : AAAA-MM-JJ, quand
  l'argent doit arriver (selon les délais de paiement connus du client), à défaut la date de la
  prestation. statut : a_encaisser si c'est validé ou signé, devis si l'accord reste à formaliser.
  title : court, du genre « Atelier Dupuis : formation du 3/12 validée, 1 400 € à encaisser en janvier ».
  why : le mail qui le montre et d'où vient le montant (« montant : mail du 29/10 » ou
  « montant : devis, brain/finance/x.md »), ${WHY} caractères au plus. Rien si notes_finance a déjà
  une échéance pour ce client, ce montant et ce mois, ni si elle est dans propositions_ignorees.

Ce qu'il a mis en pause, terminé ou archivé est sa décision, elle fait foi : aucune proposition ni
finance sur un projet de projets_arretes ni sur ses clients, même si une échéance, une note ou un
mail semble le demander.
Les montants n'apparaissent que dans finances : jamais dans summary, ranking ni propositions.
Écris en français, sans emoji.`;

const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['summary', 'ranking', 'propositions', 'finances'],
  properties: {
    summary: { type: 'array', maxItems: 4, items: { type: 'string' } },
    ranking: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['id', 'why'], properties: { id: { type: 'integer' }, why: { type: 'string' } } },
    },
    propositions: {
      type: 'array', maxItems: 3,
      items: { type: 'object', additionalProperties: false, required: ['title', 'project', 'why'], properties: { title: { type: 'string' }, project: { type: 'string' }, why: { type: 'string' } } },
    },
    finances: {
      type: 'array', maxItems: 3,
      items: {
        type: 'object', additionalProperties: false, required: ['client', 'note', 'libelle', 'montant', 'date', 'statut', 'title', 'why'],
        properties: {
          client: { type: 'string' }, note: { type: 'string' }, libelle: { type: 'string' }, montant: { type: 'number' },
          date: { type: 'string' }, statut: { type: 'string', enum: ['a_encaisser', 'devis'] }, title: { type: 'string' }, why: { type: 'string' },
        },
      },
    },
  },
};

// every figure written in the material the model was given: "1 400 €", "1.400,00", "700"
export function figures(text) {
  return new Set([...String(text).matchAll(/\d{1,3}(?:[ \u00a0\u202f.]\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?/g)]
    .map(m => Number(m[0].replace(/[ \u00a0\u202f]/g, '').replace(/\.(?=\d{3}(?!\d))/g, '').replace(',', '.'))));
}

// a money proposition the facts support, or null: known client, an amount found in a
// mail or in the second brain, not already in the client's schedule
export function checkMoney(f, ctx) {
  const client = ctx.clients?.find(c => c.slug === f.client);
  const date = String(f.date ?? '');
  if (!client || !(f.montant > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const seen = figures(JSON.stringify([ctx.mails_recents ?? [], ctx.extraits_clients ?? {}, ctx.notes_finance ?? []]));
  if (!seen.has(Math.round(f.montant * 100) / 100)) return null;
  const notes = (ctx.notes_finance ?? []).filter(n => n.client === client.slug);
  const e = { client: client.slug, montant: f.montant, date };
  if (notes.some(n => n.echeances.some(x => moneyKey({ ...x, client: client.slug }) === moneyKey(e)))) return null;
  return {
    title: line(f.title, 120), project: client.titre, why: line(f.why, 160),
    echeance: { ...e, note: notes.find(n => n.note === f.note)?.note ?? notes[0]?.note ?? '', libelle: line(f.libelle, 160), statut: f.statut === 'devis' ? 'devis' : 'a_encaisser' },
  };
}

// schedule: { weekdays: [1..5] (0 or 7 = Sunday), from: 9, to: 19 } — one review per
// hour from "from" o'clock to "to" o'clock included
// A project Christophe paused, finished or archived stays out of the suggestions,
// whatever the model says: its slug or title, or a client he has no live project with.
export function offLimits(ctx) {
  const stopped = ctx.projets_arretes ?? [];
  const slugs = new Set(stopped.map(p => p.slug));
  const clients = new Set(stopped.flatMap(p => p.clients ?? []));
  const names = [...stopped.map(p => p.titre), ...(ctx.clients ?? []).filter(c => clients.has(c.slug)).map(c => c.titre)]
    .map(same).filter(n => n.length >= 4);
  const has = (text, n) => ` ${same(text)} `.includes(` ${n} `);
  return ({ project = '', client = '', title = '' }) =>
    slugs.has(project) || clients.has(client) || names.some(n => n === same(project) || has(title, n));
}

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

function ask(bin, { model, effort, system = SYSTEM }, ctx, cwd) {
  return new Promise((resolve, reject) => {
    const args = ['-p', '--model', model, ...(effort ? ['--effort', effort] : []), '--tools', '', '--strict-mcp-config', '--no-session-persistence',
      '--output-format', 'json', '--json-schema', JSON.stringify(SCHEMA), '--system-prompt', system];
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

// opts.model, opts.effort and opts.system are read at each pass: Réglages may change them
export function makeReview(file, opts, { context, propositions }) {
  const { bin, schedule, auto } = opts;
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
      ...(await context({ since: state.at })),
      propositions_en_attente: propositions.pending().map(p => p.title),
      propositions_ignorees: propositions.dismissed().slice(-60).map(p => p.title),
      confiees_a_un_agent: propositions.launched().slice(-30).map(p => p.title),
    };
    const blocked = offLimits(ctx);
    const { model, effort, system } = opts;
    const out = await ask(bin, { model, effort, system }, ctx, path.dirname(file));

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
      if (!title || taken.has(same(title)) || blocked({ project: p.project, title })) continue;
      const project = ctx.projets?.find(x => x.slug === p.project)?.titre ?? line(p.project, 80);
      const made = propositions.add({ source: 'revue', title, project, why: line(p.why, WHY) });
      if (made.status === 'pending' && !added.includes(made.id)) added.push(made.id);
    }
    for (const f of (out.finances ?? []).slice(0, 3)) {
      const money = checkMoney(f, ctx);
      if (!money?.title || blocked({ client: f.client, title: money.title })) continue;
      const made = propositions.add({ source: 'revue', type: 'finance', ...money });
      if (made.status === 'pending' && !added.includes(made.id)) added.push(made.id);
    }

    state = {
      at: new Date().toISOString(), attemptAt: state.attemptAt, reason, model, ms: Date.now() - started,
      summary: [out.summary ?? []].flat().map(s => line(s, 120).replace(/^[-•·*]\s*/, '')).filter(Boolean).slice(0, 4), ranking: ranked.map(({ id, ...r }) => r), propositions: added, error: null,
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
