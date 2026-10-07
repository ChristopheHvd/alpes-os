// Meetings recorded and transcribed in Wispr Flow, brought into the second brain.
//
// Wispr Flow is only reachable through its claude.ai connector, so a headless
// Claude run does the reading: it lists the meetings since the last check, skips
// those already brought in, and drops one SecondBrainEvent per finished meeting in
// the curator's queue. It reports what it did in a small JSON file; the server
// keeps that list so a meeting is never queued twice, and holds on to the actions
// that fall to Christophe until a stand-up has put them to him.
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
3. Pour chaque réunion restante, lis-la avec get_meeting en demandant la transcription
   (view_transcript, char_limit 40000) et lis-la EN ENTIER : tant que la réponse annonce une suite,
   rappelle get_meeting avec le start_char indiqué. Le résumé Wispr Flow n'est qu'un repère : il
   oublie des faits et transcrit mal les noms. Écris ton propre résumé à partir de la transcription.
   Les noms se corrigent d'après le second brain : l'entreprise de Christophe est Alpes IA (pas
   « Helpia », « Alpia »…), vérifie les clients, contacts et outils cités avant de les écrire.
   Puis dépose un événement dans ${queueDir}/ :
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
5. Écris enfin ${resultFile}, strictement ce JSON :
   [{ "id": "<id Wispr Flow>", "modified_at": "<modified_at>", "titre": "<titre>", "date": "<début, ISO UTC>",
      "fichier": "<nom de l'événement>", "actions": ["<action de Christophe, à l'infinitif, avec son contexte>"] }]
   Une entrée par événement déposé, \`[]\` s'il n'y en a aucun. \`actions\` ne contient que ce qui revient
   à Christophe, formulé comme une tâche de todo (« Écrire le brief du livre blanc pour Marc Tabouret »).`;
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
  const pending = () => Object.entries(read().pending ?? {}).map(([id, m]) => ({ id, ...m }));
  // a stand-up with answers has put them to him: they leave the list
  function proposed(ids) {
    if (!ids.length) return;
    const st = read();
    for (const id of ids) delete st.pending?.[id];
    write(st);
  }

  return { window, brief, adopt, pending, proposed, state: read };
}
