// The tools the chat agent acts through, exposed as a stdio MCP server.
//
// It touches nothing directly: every tool is a thin call to the dashboard's own
// HTTP API on localhost. So an action taken by the agent runs the exact same code
// path as the equivalent button in the interface — one source of truth, no second
// copy of the caches, and nothing to keep in sync.
//
// Read tools answer immediately. Write tools go through /api/chat/propose, which
// only returns once the user has clicked; the tool then reports what actually
// happened rather than what was intended.
import { createInterface } from 'node:readline';

const API = process.env.ALPES_OS_API ?? 'http://localhost:4545';
const CHAT = process.env.ALPES_OS_CHAT ?? '';

const call = async (method, p, body) => {
  const r = await fetch(API + p, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 500) }; }
  if (!r.ok) throw new Error(data.error ?? `${r.status} sur ${p}`);
  return data;
};
const get = p => call('GET', p);
const post = (p, b) => call('POST', p, b);

// Ask the dashboard to show a confirmation card and wait for the verdict.
async function confirm(name, summary, details) {
  const v = await post('/api/chat/propose', { id: CHAT, action: { name, summary, details } });
  return v.decided === 'validé';
}

const str = { type: 'string' };
const TOOLS = [
  {
    name: 'chercher_second_brain',
    description: "Recherche plein texte dans le second brain (clients, projets, finance, connaissances, journal). À utiliser avant de répondre à toute question portant sur un client, un projet, un montant ou une décision passée.",
    inputSchema: { type: 'object', properties: { requete: { ...str, description: 'mots-clés, par exemple "Simatis devis" ou "modèle économique Dr Code"' } }, required: ['requete'] },
    run: async a => get(`/api/search?q=${encodeURIComponent(a.requete)}`),
  },
  {
    name: 'lire_note',
    description: "Lit une note entière du second brain à partir de son chemin, par exemple brain/projects/signature-app.md. Utiliser après chercher_second_brain quand un extrait ne suffit pas.",
    inputSchema: { type: 'object', properties: { chemin: str }, required: ['chemin'] },
    run: async a => get(`/api/note?id=${encodeURIComponent(a.chemin)}`),
  },
  {
    name: 'lister_projets',
    description: "Les projets au long cours avec leur stade, leur prochaine étape et leur date de dernière revue.",
    inputSchema: { type: 'object', properties: {} },
    run: async () => get('/api/projects'),
  },
  {
    name: 'lire_todo',
    description: "La todo du jour et les tâches reportées des jours précédents.",
    inputSchema: { type: 'object', properties: {} },
    run: async () => get('/api/todo'),
  },
  {
    name: 'lister_agenda',
    description: "Les événements à venir de l'agenda.",
    inputSchema: { type: 'object', properties: { jours: { type: 'number', description: 'horizon en jours, 7 par défaut' } } },
    run: async () => get('/api/calendar'),
  },
  {
    name: 'lister_mails',
    description: "Les fils de la boîte qui attendent une réponse, déjà triés : seules les vraies personnes, sans les automates ni les newsletters.",
    inputSchema: { type: 'object', properties: {} },
    run: async () => {
      const g = await get('/api/gmail');
      return { total: g.total, threads: g.threads, ecartes: g.counts };
    },
  },
  {
    name: 'lire_journal_standup',
    description: "Les derniers points du matin et bilans du soir : questions posées, réponses données, décisions prises.",
    inputSchema: { type: 'object', properties: {} },
    run: async () => get('/api/standup/journal'),
  },

  // ---- writes: proposed, then confirmed by the user ----
  {
    name: 'creer_projet',
    description: "Crée une fiche projet dans le second brain. Demande validation. Utiliser après un appel ou une réunion qui lance un nouveau chantier.",
    inputSchema: {
      type: 'object',
      properties: {
        titre: str, description: str,
        stade: { ...str, description: 'actif, incubation, pause ou terminé' },
        prochaine_etape: str,
        tags: { type: 'array', items: str },
        corps: { ...str, description: "contexte du projet, ce qui a été décidé" },
      },
      required: ['titre'],
    },
    run: async a => {
      const ok = await confirm('creer_projet', `Créer le projet « ${a.titre} »`, a);
      if (!ok) return { fait: false, raison: "refusé par l'utilisateur" };
      const p = await post('/api/projects', { title: a.titre, description: a.description, stage: a.stade, next: a.prochaine_etape, tags: a.tags, body: a.corps });
      return { fait: true, projet: p };
    },
  },
  {
    name: 'maj_projet',
    description: "Met à jour le stade ou la prochaine étape d'un projet existant. Demande validation.",
    inputSchema: { type: 'object', properties: { slug: str, stade: str, prochaine_etape: str }, required: ['slug'] },
    run: async a => {
      const ok = await confirm('maj_projet', `Mettre à jour le projet ${a.slug}`, a);
      if (!ok) return { fait: false, raison: "refusé par l'utilisateur" };
      const p = await call('PATCH', `/api/projects/${encodeURIComponent(a.slug)}`, { stage: a.stade, next: a.prochaine_etape });
      return { fait: true, projet: p };
    },
  },
  {
    name: 'ajouter_tache',
    description: "Ajoute une tâche à la todo du jour. Demande validation.",
    inputSchema: {
      type: 'object',
      properties: { texte: str, contexte: { ...str, description: 'projet ou source, affiché sous la tâche' }, priorite: { ...str, description: 'h pour urgent, m pour important, vide sinon' } },
      required: ['texte'],
    },
    run: async a => {
      const ok = await confirm('ajouter_tache', `Ajouter « ${a.texte} » à aujourd'hui`, a);
      if (!ok) return { fait: false, raison: "refusé par l'utilisateur" };
      const t = await post('/api/todo/add', { t: a.texte, s: a.contexte, p: a.priorite });
      return { fait: true, todo: t.items };
    },
  },
  {
    name: 'creer_evenement',
    description: "Crée un événement dans Google Calendar. Demande validation. La date de début doit être absolue au format ISO, par exemple 2026-09-15T14:00:00+02:00.",
    inputSchema: {
      type: 'object',
      properties: { titre: str, debut: str, fin: str, duree_minutes: { type: 'number' }, description: str, lieu: str, participants: { type: 'array', items: str } },
      required: ['titre', 'debut'],
    },
    run: async a => {
      const ok = await confirm('creer_evenement', `Créer « ${a.titre} » le ${a.debut}`, a);
      if (!ok) return { fait: false, raison: "refusé par l'utilisateur" };
      const e = await post('/api/calendar/event', { title: a.titre, start: a.debut, end: a.fin, durationMinutes: a.duree_minutes, description: a.description, location: a.lieu, attendees: a.participants });
      return { fait: true, evenement: e };
    },
  },
  {
    name: 'lancer_micro_app',
    description: "Lance une micro-app en tâche de fond : devis (devis ou facture PDF), formation (programme ou audit), briefing, standup. Demande validation car chaque lancement consomme un run.",
    inputSchema: { type: 'object', properties: { app: str, action: str, brief: str }, required: ['app', 'action', 'brief'] },
    run: async a => {
      const ok = await confirm('lancer_micro_app', `Lancer ${a.app} · ${a.action}`, a);
      if (!ok) return { fait: false, raison: "refusé par l'utilisateur" };
      const r = await post('/api/runs', { app: a.app, action: a.action, brief: a.brief });
      return { fait: true, run: r.id, statut: r.status, note: 'le run tourne en tâche de fond, son résultat apparaîtra dans Fichiers produits' };
    },
  },
];

// ---- minimal MCP over stdio: initialize, tools/list, tools/call ----
const send = m => process.stdout.write(JSON.stringify(m) + '\n');
const reply = (id, result) => send({ jsonrpc: '2.0', id, result });

createInterface({ input: process.stdin }).on('line', async line => {
  if (!line.trim()) return;
  let msg; try { msg = JSON.parse(line); } catch { return; }
  const { id, method, params } = msg;

  if (method === 'initialize') {
    return reply(id, { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'dashboard', version: '1.0.0' } });
  }
  if (method === 'tools/list') {
    return reply(id, { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
  }
  if (method === 'tools/call') {
    const tool = TOOLS.find(t => t.name === params?.name);
    if (!tool) return reply(id, { content: [{ type: 'text', text: `outil inconnu : ${params?.name}` }], isError: true });
    try {
      const out = await tool.run(params.arguments ?? {});
      return reply(id, { content: [{ type: 'text', text: JSON.stringify(out) }] });
    } catch (e) {
      return reply(id, { content: [{ type: 'text', text: `échec : ${e.message}` }], isError: true });
    }
  }
  if (id !== undefined) reply(id, {});
});
