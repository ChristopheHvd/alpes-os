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
import { request } from 'node:http';

const API = process.env.ALPES_OS_API ?? 'http://localhost:4545';
const CHAT = process.env.ALPES_OS_CHAT ?? '';
// set when a delegated agent runs this server: it gets the read tools and the
// draft tool, none of the writes that wait on a click in the chat
const AGENT = process.env.ALPES_OS_AGENT ?? '';
const AGENT_READS = new Set(['chercher_second_brain', 'lire_note', 'lister_projets', 'lire_todo', 'lister_agenda', 'lister_mails', 'lire_journal_standup', 'lister_clients']);

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
// Plain node:http rather than fetch: fetch gives up on a response that takes
// more than 5 minutes, and this one waits for as long as the card stays up.
function waitPost(p, body) {
  return new Promise((resolve, reject) => {
    const req = request(API + p, { method: 'POST', headers: { 'content-type': 'application/json' } }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', d => { text += d; });
      res.on('end', () => {
        let data; try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 500) }; }
        if (res.statusCode >= 400) reject(new Error(data.error ?? `${res.statusCode} sur ${p}`));
        else resolve(data);
      });
    });
    req.on('error', reject);
    req.end(JSON.stringify(body));
  });
}

// `card` is what the user decides on: a short title, one row per field that
// changes (before → after when there is a before) and the words of the done line.
// The summary is its one-line version, the one the journal keeps.
async function confirm(name, card) {
  const summary = parts(card.title, ...card.rows.map(r => `${r.label.toLowerCase()} : ${r.after}`));
  const v = await waitPost('/api/chat/propose', { id: CHAT, action: { name, summary, details: card } });
  return v.decided; // 'validé' | 'refusé' | 'expiré'
}
function declined(decided) {
  if (decided === 'validé') return null;
  return decided === 'expiré'
    ? { fait: false, raison: "délai dépassé sans réponse — la carte a disparu avant que l'utilisateur ait pu cliquer, ce n'est pas un refus. Propose de relancer la même action si c'est toujours pertinent." }
    : { fait: false, raison: "refusé par l'utilisateur" };
}

const parts = (...xs) => xs.filter(Boolean).join(' · ');
const clip = (s, n = 160) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t; };
const row = (label, after, before) => ({ label, after: clip(after) || '—', ...(before === undefined ? {} : { before: clip(before, 100) || '—' }) });
const eur = n => `${Number(n).toLocaleString('fr-FR')} €`;
const dm = iso => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '');

const STAGES = ['actif', 'incubation', 'pause', 'terminé', 'archivé'];
const STAGE_IS = { actif: 'est actif', incubation: 'est en incubation', pause: 'est en pause', terminé: 'est terminé', archivé: 'est archivé' };
const STATUT = { encaisse: 'encaissé', a_encaisser: 'à encaisser', devis: 'devis non signé' };
const BUCKET = { encaisse: 'Encaissé', a_encaisser: 'À encaisser', devis: 'Devis en cours' };

// "Next step" is one action shown on a project card, not a memo. A long one is
// usually instructions meant for somewhere else (the finances, the todo) that the
// agent parked there for lack of the right tool.
const NEXT_MAX = 120;
function checkNext(next) {
  const n = String(next ?? '').trim().length;
  if (n > NEXT_MAX) throw new Error(`prochaine_etape trop longue (${n} caractères, ${NEXT_MAX} au plus) : raccourcis-la en une seule action concrète. Ce qui touche aux finances passe par maj_echeance, une tâche par ajouter_tache.`);
}
function frDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const jour = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  const h = d.getMinutes() ? `${d.getHours()}h${String(d.getMinutes()).padStart(2, '0')}` : `${d.getHours()}h`;
  return `${jour} à ${h}`;
}

const str = { type: 'string' };
// a partner named the way Christophe says it: its short name, its node name or its id
async function partenaire(nom) {
  const { connexions = [] } = await get('/api/connexions');
  const n = String(nom ?? '').toLowerCase().trim();
  const c = connexions.find(x => x.id === nom) ?? connexions.find(x => x.court.toLowerCase() === n) ?? connexions.find(x => n && `${x.court} ${x.partenaire.nom}`.toLowerCase().includes(n));
  if (!c) throw new Error(`partenaire inconnu : ${nom} (connectés : ${connexions.map(x => x.court).join(', ') || 'aucun'})`);
  return c;
}
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
  {
    name: 'lire_finances',
    description: "Les notes finance du second brain et leurs échéances : libellé, montant, date, statut (encaisse, a_encaisser ou devis) et référence du devis ou de la facture. C'est ce que le tableau de bord additionne dans ses prévisions. À lire avant maj_echeance.",
    inputSchema: { type: 'object', properties: {} },
    run: async () => (await get('/api/finance')).notes.map(n => ({
      note: n.slug, titre: n.title, client: n.client, projet: n.projet,
      echeances: n.echeances.map((e, position) => ({ position, ...e })),
    })),
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
      const decided = await confirm('creer_client', {
        title: `Créer la fiche client « ${label} »`,
        rows: [
          a.description && row('Description', a.description),
          a.contacts?.length && row('Contacts', a.contacts.join(', ')),
        ].filter(Boolean),
        done: `fiche ${label} créée`,
      });
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
      checkNext(a.prochaine_etape);
      const decided = await confirm('creer_projet', {
        title: `Créer le projet « ${a.titre} »`,
        rows: [
          row('Stade', STAGES.includes(a.stade) ? a.stade : 'actif'),
          a.client && row('Client', (await get('/api/clients')).find(c => c.slug === a.client)?.title || a.client),
          a.prochaine_etape && row('Prochaine étape', a.prochaine_etape),
          a.description && row('Description', a.description),
        ].filter(Boolean),
        done: `projet ${a.titre} créé`,
      });
      const bail = declined(decided);
      if (bail) return bail;
      const p = await post('/api/projects', { title: a.titre, description: a.description, stage: a.stade, next: a.prochaine_etape, tags: a.tags, body: a.corps, client: a.client });
      return { fait: true, projet: p };
    },
  },
  {
    name: 'maj_projet',
    description: "Met à jour le stade ou la prochaine étape d'un projet existant. Demande validation. La prochaine étape est une action courte (120 caractères au plus) : les finances passent par maj_echeance, les tâches par ajouter_tache.",
    inputSchema: {
      type: 'object',
      properties: { slug: str, stade: { ...str, description: 'actif, incubation, pause, terminé ou archivé' }, prochaine_etape: { ...str, description: 'une action concrète, 120 caractères au plus' } },
      required: ['slug'],
    },
    run: async a => {
      if (a.prochaine_etape !== undefined) checkNext(a.prochaine_etape);
      if (a.stade && !STAGES.includes(a.stade)) throw new Error(`stade inconnu : ${a.stade} (actif, incubation, pause, terminé ou archivé)`);
      const p = (await get('/api/projects?all=1')).find(x => x.slug === a.slug);
      if (!p) throw new Error(`projet introuvable : ${a.slug} — vérifie le slug avec lister_projets`);
      const stage = a.stade && a.stade !== p.stage ? a.stade : '';
      const next = a.prochaine_etape !== undefined && String(a.prochaine_etape).trim() !== p.next;
      if (!stage && !next) throw new Error(`rien à changer : ${p.title} est déjà en ${p.stage} avec cette prochaine étape`);
      const decided = await confirm('maj_projet', {
        title: stage === 'terminé' ? `Clore le projet ${p.title}` : stage === 'archivé' ? `Archiver le projet ${p.title}` : stage ? `Passer ${p.title} en ${stage}` : `Mettre à jour le projet ${p.title}`,
        rows: [
          stage && row('Stade', stage, p.stage),
          next && row('Prochaine étape', a.prochaine_etape, p.next),
        ].filter(Boolean),
        done: stage ? `${p.title} ${STAGE_IS[stage]}` : 'prochaine étape à jour',
      });
      const bail = declined(decided);
      if (bail) return bail;
      const out = await call('PATCH', `/api/projects/${encodeURIComponent(a.slug)}`, { stage: a.stade, next: a.prochaine_etape });
      return { fait: true, projet: out };
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
      const decided = await confirm('ajouter_tache', {
        title: "Ajouter une tâche à la todo d'aujourd'hui",
        rows: [
          row('Tâche', a.texte),
          a.contexte && row('Contexte', a.contexte),
          (a.priorite === 'h' || a.priorite === 'm') && row('Priorité', a.priorite === 'h' ? 'urgent' : 'important'),
        ].filter(Boolean),
        done: 'tâche ajoutée à la todo',
      });
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
      const decided = await confirm('creer_evenement', {
        title: `Mettre « ${a.titre} » à l'agenda`,
        rows: [
          row('Quand', parts(frDate(a.debut), a.duree_minutes ? `${a.duree_minutes} min` : a.fin ? `jusqu'à ${frDate(a.fin)}` : '')),
          a.lieu && row('Lieu', a.lieu),
          a.participants?.length && row('Participants', a.participants.join(', ')),
        ].filter(Boolean),
        done: "événement ajouté à l'agenda",
      });
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
      const decided = await confirm('lancer_micro_app', {
        title: `Lancer la micro-app ${a.app}`,
        rows: [row('Action', a.action), row('Brief', clip(a.brief, 240))],
        done: 'run lancé en tâche de fond',
      });
      const bail = declined(decided);
      if (bail) return bail;
      const r = await post('/api/runs', { app: a.app, action: a.action, brief: a.brief });
      return { fait: true, run: r.id, statut: r.status, note: 'le run tourne en tâche de fond, son résultat apparaîtra dans Fichiers produits' };
    },
  },
  {
    name: 'maj_echeance',
    description: "Change le statut d'échéances d'une note finance, ou les retire des prévisions (devis caduc ou abandonné). Demande validation. Repère-les d'abord avec lire_finances, puis désigne-les par la référence du devis ou de la facture (toutes ses échéances) ou par leurs positions.",
    inputSchema: {
      type: 'object',
      properties: {
        note: { ...str, description: 'slug de la note finance, par exemple propulse-devis' },
        ref: { ...str, description: 'référence, par exemple DEV-2026-008 : toutes les échéances qui la portent' },
        positions: { type: 'array', items: { type: 'number' }, description: 'positions données par lire_finances, quand ref ne suffit pas' },
        statut: { ...str, description: 'nouveau statut : encaisse, a_encaisser ou devis' },
        retirer: { type: 'boolean', description: 'true pour retirer ces échéances des prévisions' },
      },
      required: ['note'],
    },
    run: async a => {
      if (!a.retirer && !STATUT[a.statut]) throw new Error('indique statut (encaisse, a_encaisser ou devis) ou retirer: true');
      const find = async () => (await get('/api/finance')).notes.find(n => n.slug === a.note);
      const n = await find();
      if (!n) throw new Error(`note finance introuvable : ${a.note} — vérifie avec lire_finances`);
      const positions = (a.positions ?? []).map(Number);
      const sel = n.echeances.map((e, i) => ({ ...e, i })).filter(e => (a.ref ? e.ref === a.ref : positions.includes(e.i)));
      if (!sel.length) throw new Error(`aucune échéance ne correspond dans ${a.note} — vérifie ref ou positions avec lire_finances`);

      const after = n.echeances.flatMap((e, i) => (!sel.some(s => s.i === i) ? [e] : a.retirer ? [] : [{ ...e, statut: a.statut }]));
      const total = (list, st) => list.filter(e => e.statut === st).reduce((s, e) => s + e.montant, 0);
      const buckets = [...new Set([...sel.map(e => e.statut), ...(a.retirer ? [] : [a.statut])])];
      // named after its project ("le devis Propulse") rather than its reference
      const projet = n.projet && (await get('/api/projects?all=1')).find(p => p.slug === n.projet)?.title;
      const what = a.ref
        ? (projet ? `${/^FAC/i.test(a.ref) ? 'la facture' : 'le devis'} ${projet}` : a.ref)
        : sel.length > 1 ? `${sel.length} échéances` : `l'échéance « ${clip(sel[0].libelle, 40)} »`;
      const s = sel.length > 1 ? 's' : '';
      const decided = await confirm('maj_echeance', {
        title: a.retirer ? `Sortir ${what} des prévisions` : `Passer ${what} en « ${STATUT[a.statut]} »`,
        rows: [
          ...sel.map(e => row(eur(e.montant), parts(e.libelle, dm(e.date), !a.ref && e.ref))),
          ...buckets.map(st => row(BUCKET[st], eur(total(after, st)), eur(total(n.echeances, st)))),
        ],
        done: a.retirer ? `${sel.length} échéance${s} retirée${s}` : `${sel.length} échéance${s} en « ${STATUT[a.statut]} »`,
      });
      const bail = declined(decided);
      if (bail) return bail;

      // The card may have waited for hours: find each line again rather than
      // trust a position another edit may have shifted.
      const now = await find();
      const used = new Set();
      const idx = sel.map(e => {
        const i = now?.echeances.findIndex((x, j) => !used.has(j) && ['libelle', 'montant', 'date', 'statut', 'ref'].every(k => x[k] === e[k])) ?? -1;
        used.add(i);
        return i;
      });
      if (idx.includes(-1)) throw new Error('la note a changé depuis la proposition : relis-la avec lire_finances avant de reproposer');
      // highest position first, so a removal doesn't shift the next one
      for (const i of idx.sort((x, y) => y - x)) {
        const p = `/api/finance/${encodeURIComponent(a.note)}/echeances/${i}`;
        if (a.retirer) await call('DELETE', p);
        else await call('PATCH', p, { statut: a.statut });
      }
      return { fait: true, note: a.note, echeances: (await find())?.echeances ?? [] };
    },
  },
  // ---- partner OSes (Simatis…) through the agents relay ----
  {
    name: 'lister_partenaires',
    description: "Les OS partenaires reliés par le relais d'agents (Simatis…) : leurs missions en cours dans les deux sens et leurs derniers messages. À lire avant confier_mission ou envoyer_message.",
    inputSchema: { type: 'object', properties: {} },
    run: async () => {
      const e = await get('/api/connexions');
      if (!e.actif) return { actif: false, note: 'relais non configuré' };
      return Promise.all(e.connexions.map(async c => {
        const a = await get(`/api/connexions/${encodeURIComponent(c.id)}/activite`);
        return {
          partenaire: c.court, connexion: c.id,
          missions_en_cours: a.enCours.map(m => ({ titre: m.titre, sens: m.sens === 'recue' ? `confiée par ${c.court}` : `confiée à ${c.court}`, etat: m.etat, echeance: m.echeance })),
          missions_terminees: a.terminees.slice(0, 5).map(m => ({ titre: m.titre, etat: m.etat, resume: m.resume })),
          messages: a.messages.slice(0, 10).map(m => ({ id: m.id, de: m.sens === 'recu' ? c.court : 'Christophe', type: m.type, sujet: m.sujet, texte: clip(m.texte, 600), quand: m.quand, repondu: m.repondu })),
        };
      }));
    },
  },
  {
    name: 'confier_mission',
    description: "Confie une mission à l'agent d'un partenaire (Simatis…) : un titre court, la consigne complète, une échéance au besoin. Demande validation. Son état revient dans la page Connexions.",
    inputSchema: {
      type: 'object',
      properties: {
        partenaire: { ...str, description: 'nom du partenaire, par exemple Simatis' },
        titre: str, consigne: str,
        echeance: { ...str, description: 'AAAA-MM-JJ, facultatif' },
      },
      required: ['partenaire', 'titre', 'consigne'],
    },
    run: async a => {
      const c = await partenaire(a.partenaire);
      const decided = await confirm('confier_mission', {
        title: `Confier « ${a.titre} » à ${c.court}`,
        rows: [row('Consigne', a.consigne), a.echeance && row('Pour le', frDate(`${a.echeance}T12:00:00`).replace(/ à .*$/, ''))].filter(Boolean),
        done: `mission envoyée à ${c.court}`,
      });
      const bail = declined(decided);
      if (bail) return bail;
      const m = await post(`/api/connexions/${encodeURIComponent(c.id)}/missions`, { titre: a.titre, consigne: a.consigne, echeance: a.echeance });
      return { fait: true, mission: { titre: m.titre, etat: m.etat } };
    },
  },
  {
    name: 'envoyer_message',
    description: "Envoie un message libre en Markdown à un partenaire : une question, une info, ou la réponse à l'un de ses messages (en_reponse_a, l'id donné par lister_partenaires). Demande validation. Un fichier ne voyage pas : mets un lien.",
    inputSchema: {
      type: 'object',
      properties: {
        partenaire: { ...str, description: 'nom du partenaire, par exemple Simatis' },
        type: { ...str, description: 'question ou info ; ignoré pour une réponse' },
        sujet: str, texte: { ...str, description: 'Markdown, liens compris' },
        en_reponse_a: { ...str, description: "id du message auquel tu réponds" },
      },
      required: ['partenaire', 'texte'],
    },
    run: async a => {
      const c = await partenaire(a.partenaire);
      const decided = await confirm('envoyer_message', {
        title: a.en_reponse_a ? `Répondre à ${c.court}` : `Écrire à ${c.court}`,
        rows: [a.sujet && row('Sujet', a.sujet), row('Message', a.texte)].filter(Boolean),
        done: `message envoyé à ${c.court}`,
      });
      const bail = declined(decided);
      if (bail) return bail;
      const m = await post(`/api/connexions/${encodeURIComponent(c.id)}/messages`, { type: a.type === 'question' ? 'question' : 'info', sujet: a.sujet, texte: a.texte, enReponseA: a.en_reponse_a });
      return { fait: true, message: { sujet: m.sujet, type: m.type } };
    },
  },
  {
    name: 'creer_brouillon_mail',
    agentOnly: true,
    description: "Dépose un brouillon en texte brut dans la boîte Gmail de Christophe. Rien n'est envoyé : il le relit et l'envoie lui-même. Plusieurs destinataires : séparés par des virgules.",
    inputSchema: { type: 'object', properties: { a: str, cc: str, objet: str, corps: str }, required: ['a', 'objet', 'corps'] },
    run: async a => ({ fait: true, brouillon: await post('/api/mail/draft', { to: a.a, cc: a.cc, subject: a.objet, body: a.corps, delegation: AGENT }), note: 'brouillon créé, non envoyé' }),
  },
];
TOOLS.push({
  name: 'modifier_brouillon_mail',
  agentOnly: true,
  description: "Réécrit un brouillon Gmail que tu as créé pour cette tâche (id donné par creer_brouillon_mail, ou listé dans la consigne de reprise). Donne le mail complet : destinataire, objet et corps remplacent l'ancien. Rien n'est envoyé.",
  inputSchema: { type: 'object', properties: { id: str, a: str, cc: str, objet: str, corps: str }, required: ['id', 'a', 'objet', 'corps'] },
  run: async a => ({ fait: true, brouillon: await post('/api/mail/draft', { id: a.id, to: a.a, cc: a.cc, subject: a.objet, body: a.corps, delegation: AGENT }), note: 'brouillon modifié, non envoyé' }),
});
const VISIBLE = TOOLS.filter(t => AGENT ? AGENT_READS.has(t.name) || t.agentOnly : !t.agentOnly);

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
    return reply(id, { tools: VISIBLE.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
  }
  if (method === 'tools/call') {
    const tool = VISIBLE.find(t => t.name === params?.name);
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
