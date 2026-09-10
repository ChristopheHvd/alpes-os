// The stand-up journal: brain/journal/standup.md in the second brain.
// Append-only, one section per session, machine-readable enough that tomorrow's
// stand-up can ask what became of what was said today. It stays separate from
// brain/journal/<month>.md, which okf-wiki consolidates in its own way.
import fs from 'node:fs';
import path from 'node:path';

const HEADER = `---
type: Journal
title: Stand-ups
description: Points quotidiens du matin et du soir tenus depuis Alpes OS — questions, réponses, décisions.
tags: [journal, standup, alpes-os]
status: draft
---

# Stand-ups

`;

const today = () => new Date().toISOString().slice(0, 10);
export const slotNow = (d = new Date()) => (d.getHours() < 14 ? 'matin' : 'soir');

export function makeStandup(secondBrain) {
  const file = path.join(secondBrain, 'brain', 'journal', 'standup.md');

  function readRaw() {
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : HEADER;
  }

  // "## 2026-09-09 · matin" opens a session; the body is free prose plus
  // "**Q.** …" / "**R.** …" pairs, which stay readable by hand.
  function sessions() {
    const out = [];
    let cur = null;
    for (const line of readRaw().split('\n')) {
      const h = line.match(/^##\s+(\d{4}-\d{2}-\d{2})\s+·\s+(matin|soir)\s*$/);
      if (h) { cur = { date: h[1], slot: h[2], lines: [] }; out.push(cur); continue; }
      if (cur) cur.lines.push(line);
    }
    return out.map(s => ({ ...s, body: s.lines.join('\n').trim() }));
  }

  function has(date, slot) {
    return sessions().some(s => s.date === date && s.slot === slot);
  }

  function last(n = 3) {
    return sessions().slice(-n).map(s => ({ date: s.date, slot: s.slot, body: s.body }));
  }

  // A retry after a failed compose resends the same questions and answers.
  // Detect that by the first question's text so the Q&A block is not journaled twice.
  function hasExchange(date, slot, questions) {
    if (!questions.length) return false;
    const marker = `**Q.** ${questions[0].text}`;
    return sessions().some(s => s.date === date && s.slot === slot && s.body.includes(marker));
  }

  // Written by the server rather than the agent: the exchange must be recorded
  // verbatim, even if the composition step fails afterwards.
  function append({ date = today(), slot = slotNow(), questions = [], answers = {}, outcome = '' }) {
    const parts = [`## ${date} · ${slot}`, ''];
    for (const q of questions) {
      const a = String(answers[q.id] ?? '').trim();
      parts.push(`**Q.** ${q.text}`);
      parts.push(`**R.** ${a || '(pas de réponse)'}`);
      parts.push('');
    }
    if (outcome) { parts.push(outcome.trim()); parts.push(''); }

    let txt = readRaw();
    if (!txt.trim()) txt = HEADER;
    // sessions are appended in chronological order, newest last
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, txt.replace(/\s*$/, '\n\n') + parts.join('\n').replace(/\n{3,}/g, '\n\n') + '\n');
    return { date, slot, file };
  }

  return { file, sessions, has, last, hasExchange, append, state: () => {
    const d = today(), slot = slotNow();
    return {
      date: d, slot,
      matin: has(d, 'matin'),
      soir: has(d, 'soir'),
      due: !has(d, slot),
      hour: new Date().getHours(),
    };
  } };
}
