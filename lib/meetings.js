// Meetings recorded and transcribed in Wispr Flow, brought into the second brain.
//
// Wispr Flow is only reachable through its claude.ai connector, so a headless
// Claude run does the reading: it lists the meetings since the last check, skips
// those already brought in, and drops one SecondBrainEvent per finished meeting in
// the curator's queue. It reports what it did in a small JSON file; the server
// keeps that list so a meeting is never queued twice, and holds on to the actions
// that fall to Christophe until a stand-up has put them to him.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fill } from './reglages.js';

export const WISPR_DB = path.join(os.homedir(), 'Library', 'Application Support', 'Wispr Flow', 'flow.sqlite');

// The meetings of the last days with their summary, straight from Wispr Flow's local
// database, for the review to see what was decided and done. null when unreadable.
export function localSummaries(since, dbPath = WISPR_DB, maxChars = 1800) {
  if (!fs.existsSync(dbPath)) return null;
  const sql = `select title, createdAt, participantNames, coalesce(deliveredSummary, summary, summaryPreview, '') as summary from Meetings where isDeleted = 0 and isTourDemo = 0 and finalized = 1 and createdAt >= '${since.slice(0, 19).replace('T', ' ')}' order by createdAt desc limit 15`;
  try {
    const out = execFileSync('sqlite3', ['-json', `file:${dbPath}?mode=ro`, sql], { encoding: 'utf8', timeout: 10e3, maxBuffer: 20e6 }).trim();
    const text = v => { try { const j = JSON.parse(v); return typeof j === 'string' ? j : JSON.stringify(j); } catch { return String(v ?? ''); } };
    return (out ? JSON.parse(out) : []).map(m => ({ titre: m.title, date: m.createdAt, participants: m.participantNames ?? '', resume: text(m.summary).replace(/\s+/g, ' ').trim().slice(0, maxChars) }));
  } catch { return null; }
}

// Reads the Wispr Flow desktop app's local database: finalized meetings started in the window.
// null when the database can't be read (another machine, schema change): the caller runs anyway.
export function localMeetings(since, dbPath = WISPR_DB) {
  if (!fs.existsSync(dbPath)) return null;
  const sql = `select id, modifiedAt from Meetings where isDeleted = 0 and isTourDemo = 0 and finalized = 1 and createdAt >= '${since.slice(0, 19).replace('T', ' ')}'`;
  try {
    const out = execFileSync('sqlite3', ['-json', `file:${dbPath}?mode=ro`, sql], { encoding: 'utf8', timeout: 10e3 }).trim();
    return out ? JSON.parse(out) : [];
  } catch { return null; }
}

const sameTime = (a, b) => Math.abs(Date.parse(String(a).replace(' ', 'T').replace(' +00:00', 'Z')) - Date.parse(b)) < 1000;

const FIRST_LOOKBACK_DAYS = 7;
const OVERLAP_MS = 24 * 3600e3;   // a meeting finalized late still shows up in the next window
const KEEP_DAYS = 60;

export const MEETINGS_TOOLS = ['Read', 'Write', 'Glob', 'ToolSearch', 'Bash(mv:*)', 'Bash(date:*)', 'Bash(uuidgen:*)',
  'mcp__claude_ai_Wispr_Flow__search_meetings', 'mcp__claude_ai_Wispr_Flow__get_meeting'].join(',');

export const BRIEF = `Rapatrie dans le second brain les réunions enregistrées dans Wispr Flow.

1. Avec search_meetings, liste les réunions qui ont commencé depuis {{since}} (UTC).
2. Ignore une réunion si :
   - elle n'est pas finalisée (\`finalized\` faux) ou n'a pas de transcription : elle sera reprise au prochain passage ;
   - son identifiant figure ci-dessous avec la même date de modification (\`modified_at\`).
{{done}}
3. Pour chaque réunion restante, lis-la avec get_meeting en demandant la transcription
   (view_transcript, char_limit 40000) et lis-la EN ENTIER : tant que la réponse annonce une suite,
   rappelle get_meeting avec le start_char indiqué. Le résumé Wispr Flow n'est qu'un repère : il
   oublie des faits et transcrit mal les noms. Écris ton propre résumé à partir de la transcription.
   Les noms se corrigent d'après le second brain : l'entreprise de Christophe est Alpes IA (pas
   « Helpia », « Alpia »…), vérifie les clients, contacts et outils cités avant de les écrire.
   Puis dépose un événement dans {{queueDir}}/ :
   - nom \`<AAAA-MM-JJTHHMMSSZ>-<UUID>-wispr-<slug-du-titre>.md\` (horodatage de maintenant, UTC) ;
   - écris d'abord un fichier caché (\`.<nom>.tmp\`) dans ce dossier, puis renomme-le ;
   - frontmatter : \`type: SecondBrainEvent\`, \`event_id\` (l'UUID), \`created_at\`, \`producer: wispr-flow\`,
     \`subject: "Réunion : <titre> (<date>)"\` ;
   - corps : date (JJ/MM/AAAA, sans le jour de la semaine) et heure de Paris, durée, participants, lien de partage Wispr Flow,
     identifiant Wispr Flow, ton résumé (l'essentiel, puis par thème), les décisions, les
     chiffres et engagements cités, les prochains rendez-vous, et les actions à suivre (qui, quoi,
     quand). Si le titre est vide ou générique, déduis-en un court du contenu et dis-le.
   - termine par « Changement demandé » : rattacher cette réunion au client et au projet concernés
     s'ils existent dans le second brain (nomme-les si tu les reconnais), sinon la consigner dans le
     journal ; reporter les actions à suivre qui reviennent à Christophe.
4. N'écris rien d'autre dans le second brain que ces événements, et ne modifie aucun fichier existant.
5. Écris enfin {{resultFile}}, strictement ce JSON :
   [{ "id": "<id Wispr Flow>", "modified_at": "<modified_at>", "titre": "<titre>", "date": "<début, ISO UTC>",
      "fichier": "<nom de l'événement>", "actions": ["<action de Christophe, à l'infinitif, avec son contexte>"] }]
   Une entrée par événement déposé, \`[]\` s'il n'y en a aucun. \`actions\` ne contient que ce qui revient
   à Christophe, formulé comme une tâche de todo (« Écrire le brief du livre blanc pour Marc Tabouret »).`;

export function makeMeetings(stateFile) {
  const read = () => { try { return JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { return { lastCheck: null, done: {} }; } };
  const write = st => { fs.mkdirSync(path.dirname(stateFile), { recursive: true }); fs.writeFileSync(stateFile, JSON.stringify(st, null, 1)); };

  // the window to look at and what is already in, for the brief
  function window(now = new Date()) {
    const st = read();
    const since = st.lastCheck ? new Date(Date.parse(st.lastCheck) - OVERLAP_MS) : new Date(now - FIRST_LOOKBACK_DAYS * 864e5);
    return { since: since.toISOString(), done: st.done };
  }

  // BRIEF is a template: the Réglages screen may replace it, the values are filled in here
  function brief({ queueDir, resultFile, now = new Date(), text = BRIEF }) {
    const w = window(now);
    const done = Object.entries(w.done);
    return fill(text, {
      since: w.since, queueDir, resultFile,
      done: done.length ? done.map(([id, m]) => `     - ${id} · ${m}`).join('\n') : '     (aucune pour le moment)',
    });
  }

  // the run went through: remember what it queued and move the window forward
  function adopt(resultFile, { checkedAt, now = new Date() }) {
    let list;
    try { list = JSON.parse(fs.readFileSync(resultFile, 'utf8')); } catch { return null; }
    if (!Array.isArray(list)) return null;
    const st = read();
    st.pending ??= {};
    for (const m of list) {
      if (!m?.id) continue;
      st.done[m.id] = m.modified_at ?? checkedAt;
      const actions = (Array.isArray(m.actions) ? m.actions : []).map(a => String(a).trim()).filter(Boolean);
      if (actions.length) st.pending[m.id] = { titre: m.titre ?? '', date: m.date ?? null, actions };
    }
    // forget meetings far behind the window: they can't come back
    const floor = now - KEEP_DAYS * 864e5;
    for (const [id, at] of Object.entries(st.done)) if (Date.parse(at) < floor) delete st.done[id];
    st.lastCheck = checkedAt;
    write(st);
    return list;
  }

  // actions waiting to be put to Christophe by a stand-up
  // false only when the local database proves there is nothing new: no Claude run needed
  function worthRunning({ now = new Date(), dbPath } = {}) {
    const w = window(now);
    const list = localMeetings(w.since, dbPath);
    if (list === null) return true;
    return list.some(m => !w.done[m.id] || !sameTime(m.modifiedAt, w.done[m.id]));
  }

  const pending = () => Object.entries(read().pending ?? {}).map(([id, m]) => ({ id, ...m }));
  // a stand-up with answers has put them to him: they leave the list
  function proposed(ids) {
    if (!ids.length) return;
    const st = read();
    for (const id of ids) delete st.pending?.[id];
    write(st);
  }

  return { window, brief, adopt, worthRunning, pending, proposed, state: read };
}
