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
// Returns the real outcome, not a collapsed boolean — "expiré" (no answer in
// time) must never read as "refusé" (an actual click on Annuler) to the agent,
// or it draws the wrong conclusion and stops offering to retry.
async function confirm(name, summary, details) {
  const v = await post('/api/chat/propose', { id: CHAT, action: { name, summary, details } });
  return v.decided; // 'validé' | 'refusé' | 'expiré'
}
function declined(decided) {
  if (decided === 'validé') return null;
  return decided === 'expiré'
    ? { fait: false, raison: "délai dépassé sans réponse — la carte a disparu avant que l'utilisateur ait pu cliquer, ce n'est pas un refus. Propose de relancer la même action si c'est toujours pertinent." }
    : { fait: false, raison: "refusé par l'utilisateur" };
}

// The confirmation card shows this sentence and nothing else — no JSON — so it
// has to carry everything needed to decide.
const parts = (...xs) => xs.filter(Boolean).join(' · ');
function frDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const jour = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  const h = d.getMinutes() ? `${d.getHours()}h${String(d.getMinutes()).padStart(2, '0')}` : `${d.getHours()}h`;
  return `${jour} à ${h}`;
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
  {
    name: 'lister_clients',
    description: "Les fiches clients et prospects du second brain : titre, description, tags. À consulter avant de créer un projet, pour savoir si le client existe déjà.",
    inputSchema: { type: 'object', properties: {} },
    run: async () => get('/api/clients'),
  },

  // ---- writes: proposed, then confirmed by the user ----
  {
    name: 'creer_client',
    description: "Crée une fiche client ou prospect dans le second brain. Demande validation. À proposer quand un projet concerne un client absent de brain/clients/, ou sur demande explicite.",
    inputSchema: {
      type: 'object',
      properties: {
        nom: str,
        entreprise: { ...str, description: "société du contact, si différente du nom" },
        description: str,
        contexte: { ...str, description: "d'où vient ce client, ce qui a été dit — devient la section Profil" },
        contacts: { type: 'array', items: str, description: "personnes chez le client, une par entrée" },
        tags: { type: 'array', items: str },
      },
      required: ['nom'],
    },
    run: async a => {
      const label = a.entreprise && a.entreprise.toLowerCase() !== String(a.nom).toLowerCase() ? `${a.nom} (${a.entreprise})` : a.nom;
      const decided = await confirm('creer_client', parts(
        `Créer la fiche client « ${label} »`,
        a.description && String(a.description).replace(/\s+/g, ' ').slice(0, 90),
      ), a);
      const bail = declined(decided);
      if (bail) return bail;
      const c = await post('/api/clients', { nom: a.nom, entreprise: a.entreprise, description: a.description, contexte: a.contexte, contacts: a.contacts, tags: a.tags });
      return { fait: true, client: c, note: `slug de la fiche : ${c.slug} — à passer au paramètre client de creer_projet` };
    },
  },
  {
    name: 'creer_projet',
    description: "Crée une fiche projet dans le second brain. Demande validation. Utiliser après un appel ou une réunion qui lance un nouveau chantier. Un projet a presque toujours un client : vérifie avec lister_clients, propose creer_client s'il manque, puis passe son slug à `client`.",
    inputSchema: {
      type: 'object',
      properties: {
        titre: str, description: str,
        stade: { ...str, description: 'actif, incubation, pause ou terminé' },
        prochaine_etape: str,
        tags: { type: 'array', items: str },
        corps: { ...str, description: "contexte du projet, ce qui a été décidé" },
        client: { ...str, description: 'slug de la fiche client — le projet et le client se relient alors dans les deux sens' },
      },
      required: ['titre'],
    },
    run: async a => {
      const decided = await confirm('creer_projet', parts(
        `Créer la fiche projet « ${a.titre} »`,
        a.stade && `stade ${a.stade}`,
        a.client && `client : ${a.client}`,
        a.prochaine_etape && `prochaine étape : ${a.prochaine_etape}`,
      ), a);
      const bail = declined(decided);
      if (bail) return bail;
      const p = await post('/api/projects', { title: a.titre, description: a.description, stage: a.stade, next: a.prochaine_etape, tags: a.tags, body: a.corps, client: a.client });
      return { fait: true, projet: p };
    },
  },
  {
    name: 'maj_projet',
    description: "Met à jour le stade ou la prochaine étape d'un projet existant. Demande validation.",
    inputSchema: { type: 'object', properties: { slug: str, stade: str, prochaine_etape: str }, required: ['slug'] },
    run: async a => {
      const decided = await confirm('maj_projet', parts(
        `Projet ${a.slug}`,
        a.stade && `passer en ${a.stade}`,
        a.prochaine_etape && `prochaine étape : ${a.prochaine_etape}`,
      ), a);
      const bail = declined(decided);
      if (bail) return bail;
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
      const decided = await confirm('ajouter_tache', parts(
        `Ajouter « ${a.texte} » à la todo d'aujourd'hui`,
        a.contexte && `côté ${a.contexte}`,
        a.priorite === 'h' ? 'urgent' : a.priorite === 'm' ? 'important' : '',
      ), a);
      const bail = declined(decided);
      if (bail) return bail;
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
      const decided = await confirm('creer_evenement', parts(
        `Mettre « ${a.titre} » à l'agenda, ${frDate(a.debut)}`,
        a.duree_minutes ? `${a.duree_minutes} min` : a.fin ? `jusqu'à ${frDate(a.fin)}` : '',
        a.lieu && `à ${a.lieu}`,
        a.participants?.length ? `avec ${a.participants.join(', ')}` : '',
      ), a);
      const bail = declined(decided);
      if (bail) return bail;
      const e = await post('/api/calendar/event', { title: a.titre, start: a.debut, end: a.fin, durationMinutes: a.duree_minutes, description: a.description, location: a.lieu, attendees: a.participants });
      return { fait: true, evenement: e };
    },
  },
  {
    name: 'lancer_micro_app',
    description: "Lance une micro-app en tâche de fond : devis (devis ou facture PDF), formation (programme ou audit), standup (le point du jour). Demande validation car chaque lancement consomme un run.",
    inputSchema: { type: 'object', properties: { app: str, action: str, brief: str }, required: ['app', 'action', 'brief'] },
    run: async a => {
      const decided = await confirm('lancer_micro_app', parts(
        `Lancer la micro-app ${a.app} (${a.action})`,
        a.brief && `sur : ${String(a.brief).replace(/\s+/g, ' ').slice(0, 120)}`,
      ), a);
      const bail = declined(decided);
      if (bail) return bail;
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
