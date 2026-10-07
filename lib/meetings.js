// Meetings recorded and transcribed in Wispr Flow, brought into the second brain.
//
// Wispr Flow is only reachable through its claude.ai connector, so a headless
// Claude run does the reading: it lists the meetings since the last check, skips
// those already brought in, and drops one SecondBrainEvent per finished meeting in
// the curator's queue. It reports what it did in a small JSON file; the server
// keeps that list so a meeting is never queued twice.
import fs from 'node:fs';
import path from 'node:path';

const FIRST_LOOKBACK_DAYS = 7;
const OVERLAP_MS = 24 * 3600e3;   // a meeting finalized late still shows up in the next window
const KEEP_DAYS = 60;

export const MEETINGS_TOOLS = ['Read', 'Write', 'Glob', 'ToolSearch', 'Bash(mv:*)', 'Bash(date:*)', 'Bash(uuidgen:*)',
  'mcp__claude_ai_Wispr_Flow__search_meetings', 'mcp__claude_ai_Wispr_Flow__get_meeting'].join(',');

export function makeMeetings(stateFile) {
  const read = () => { try { return JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { return { lastCheck: null, done: {} }; } };
  const write = st => { fs.mkdirSync(path.dirname(stateFile), { recursive: true }); fs.writeFileSync(stateFile, JSON.stringify(st, null, 1)); };

  // the window to look at and what is already in, for the brief
  function window(now = new Date()) {
    const st = read();
    const since = st.lastCheck ? new Date(Date.parse(st.lastCheck) - OVERLAP_MS) : new Date(now - FIRST_LOOKBACK_DAYS * 864e5);
    return { since: since.toISOString(), done: st.done };
  }

  function brief({ queueDir, resultFile, now = new Date() }) {
    const w = window(now);
    const done = Object.entries(w.done);
    return `Rapatrie dans le second brain les réunions enregistrées dans Wispr Flow.

1. Avec search_meetings, liste les réunions qui ont commencé depuis ${w.since} (UTC).
2. Ignore une réunion si :
   - elle n'est pas finalisée (\`finalized\` faux) ou n'a pas de transcription : elle sera reprise au prochain passage ;
   - son identifiant figure ci-dessous avec la même date de modification (\`modified_at\`).
${done.length ? done.map(([id, m]) => `     - ${id} · ${m}`).join('\n') : '     (aucune pour le moment)'}
3. Pour chaque réunion restante, lis-la avec get_meeting (résumé et notes ; pas la transcription
   complète, sauf si le résumé manque), puis dépose un événement dans ${queueDir}/ :
   - nom \`<AAAA-MM-JJTHHMMSSZ>-<UUID>-wispr-<slug-du-titre>.md\` (horodatage de maintenant, UTC) ;
   - écris d'abord un fichier caché (\`.<nom>.tmp\`) dans ce dossier, puis renomme-le ;
   - frontmatter : \`type: SecondBrainEvent\`, \`event_id\` (l'UUID), \`created_at\`, \`producer: wispr-flow\`,
     \`subject: "Réunion : <titre> (<date>)"\` ;
   - corps : date (JJ/MM/AAAA, sans le jour de la semaine) et heure de Paris, durée, participants, lien de partage Wispr Flow,
     identifiant Wispr Flow, le résumé tel quel, les décisions et les actions à suivre (qui, quoi,
     quand). Si le titre est vide, déduis-en un court du contenu et dis-le.
   - termine par « Changement demandé » : rattacher cette réunion au client et au projet concernés
     s'ils existent dans le second brain (nomme-les si tu les reconnais), sinon la consigner dans le
     journal ; reporter les actions à suivre qui reviennent à Christophe.
4. N'écris rien d'autre dans le second brain que ces événements, et ne modifie aucun fichier existant.
5. Écris enfin ${resultFile}, strictement ce JSON :
   [{ "id": "<id Wispr Flow>", "modified_at": "<modified_at>", "titre": "<titre>", "fichier": "<nom de l'événement>" }]
   (une entrée par événement déposé, \`[]\` s'il n'y en a aucun).`;
  }

  // the run went through: remember what it queued and move the window forward
  function adopt(resultFile, { checkedAt, now = new Date() }) {
    let list;
    try { list = JSON.parse(fs.readFileSync(resultFile, 'utf8')); } catch { return null; }
    if (!Array.isArray(list)) return null;
    const st = read();
    for (const m of list) if (m?.id) st.done[m.id] = m.modified_at ?? checkedAt;
    // forget meetings far behind the window: they can't come back
    const floor = now - KEEP_DAYS * 864e5;
    for (const [id, at] of Object.entries(st.done)) if (Date.parse(at) < floor) delete st.done[id];
    st.lastCheck = checkedAt;
    write(st);
    return list;
  }

  return { window, brief, adopt, state: read };
}
