// Conversations with the dashboard agent, appended to the second brain the same
// way stand-ups are (lib/standup.js). A conversation lives in server memory and
// dies with the process; this file is what survives, and what the history view
// reads back.
import fs from 'node:fs';
import path from 'node:path';

const HEADER = `---
type: Journal
title: Conversations
description: Échanges avec l'assistant d'Alpes OS — questions, réponses et actions validées ou refusées.
tags: [journal, assistant, alpes-os]
status: draft
---

# Conversations

`;

const MARK = { validé: '✅', refusé: '✋', expiré: '⏳' };

const stamp = (d = new Date()) =>
  `${d.toISOString().slice(0, 10)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

export function makeChatLog(secondBrain) {
  const file = path.join(secondBrain, 'brain', 'journal', 'conversations.md');
  const readRaw = () => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : HEADER);

  // One "## <date> <heure> · conversation <id>" section per conversation, turns
  // appended underneath it. A second turn on the same conversation therefore has
  // to find the section again rather than open a new one.
  function sections() {
    const out = [];
    let cur = null;
    for (const line of readRaw().split('\n')) {
      const h = line.match(/^##\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})\s+·\s+conversation\s+(\S+)\s*$/);
      if (h) { cur = { date: h[1], time: h[2], id: h[3], lines: [] }; out.push(cur); continue; }
      if (cur) cur.lines.push(line);
    }
    return out;
  }

  function sessions() {
    return sections().map(s => {
      const body = s.lines.join('\n').trim();
      const first = body.match(/^\*\*Moi\.\*\*\s+(.*)$/m);
      return {
        id: s.id,
        date: s.date,
        time: s.time,
        turns: (body.match(/^\*\*Moi\.\*\*/gm) ?? []).length,
        actions: (body.match(/^- [✅✋⏳]/gm) ?? []).length,
        title: (first?.[1] ?? '(sans message)').slice(0, 90),
        body,
      };
    }).reverse();
  }

  const one = id => sessions().find(s => s.id === id) ?? null;

  function append(id, { user = '', assistant = '', actions = [] }) {
    if (!user.trim() && !assistant.trim() && !actions.length) return null;
    const parts = [];
    if (user.trim()) parts.push(`**Moi.** ${user.trim()}`, '');
    if (assistant.trim()) parts.push(`**Assistant.** ${assistant.trim()}`, '');
    for (const a of actions) parts.push(`- ${MARK[a.decided] ?? '·'} ${a.summary}${a.decided === 'validé' ? '' : ` — ${a.decided}`}`);
    if (actions.length) parts.push('');

    const turn = parts.join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
    let txt = readRaw();
    if (!txt.trim()) txt = HEADER;
    fs.mkdirSync(path.dirname(file), { recursive: true });

    // A conversation keeps one section, so a later turn is inserted at the end of
    // that section — not at the end of the file, where another conversation may
    // have opened its own section in the meantime.
    const lines = txt.split('\n');
    const start = lines.findIndex(l => new RegExp(`^##\\s.*·\\s+conversation\\s+${id}\\s*$`).test(l));
    if (start === -1) {
      fs.writeFileSync(file, txt.replace(/\s*$/, '\n\n') + `## ${stamp()} · conversation ${id}\n\n` + turn);
    } else {
      let end = lines.findIndex((l, i) => i > start && /^##\s/.test(l));
      if (end === -1) end = lines.length;
      const body = lines.slice(start, end).join('\n').replace(/\s*$/, '\n\n');
      fs.writeFileSync(file, [...lines.slice(0, start), body + turn, ...lines.slice(end)].join('\n'));
    }
    return { id, file };
  }

  return { file, sessions, one, append };
}
