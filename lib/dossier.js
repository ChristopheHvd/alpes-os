// CONTEXTE.md: what Christophe already knows about a task an agent takes on, gathered
// by the server at launch (notes, mails, agenda, journal, earlier reports) so the
// agent starts from it instead of searching blind. The file stays readable: past
// MAX_CHARS the longest parts are cut first and say where their full text lives.
import { same } from './propositions.js';

export const MAX_CHARS = 60000;

const frame = s => `\n\n## ${s.titre}\n\n`;
const cutNote = (s, n) => `\n\n[… tronqué : ${n} caractères sur ${s.texte.length}. Texte complet : ${s.chemin}]`;

// head is never cut; sections are { titre, texte, chemin }, written in the order given
export function assemble(head, sections, max = MAX_CHARS) {
  const parts = sections.filter(s => String(s.texte ?? '').trim()).map(s => ({ ...s, texte: String(s.texte).trim() }));
  let left = max - head.length - parts.reduce((n, s) => n + frame(s).length, 0);
  // smallest first: a short part goes in whole, the long ones share what is left
  const keep = new Map();
  [...parts].sort((a, b) => a.texte.length - b.texte.length).forEach((s, i, all) => {
    const share = Math.max(0, Math.floor(left / (all.length - i)));
    const n = s.texte.length <= share ? s.texte.length : Math.max(0, share - cutNote(s, share).length);
    keep.set(s, n);
    left -= s.texte.length <= share ? n : share;
  });
  return head + parts.map(s => {
    const n = keep.get(s);
    return frame(s) + (n < s.texte.length ? s.texte.slice(0, n).replace(/\s+\S*$/, '') + cutNote(s, n) : s.texte);
  }).join('');
}

// "Jeanne Martin (Atelier Dupuis)" is looked for as "Jeanne Martin" and as "Atelier Dupuis"
export const namesOf = titles => [...new Set(titles.flatMap(t => String(t ?? '').split(/[()–—,]/))
  .map(same).filter(n => n.length >= 4))];
export const mentions = (text, names) => { const t = ` ${same(text)} `; return names.some(n => t.includes(` ${n} `)); };

// the "## 2026-10-29 — …" entries of a journal file that talk about one of the names
export function journalEntries(text, names, chemin) {
  return String(text).split(/^(?=## )/m).filter(e => e.startsWith('## ') && mentions(e, names)).map(e => {
    const titre = e.split('\n')[0].slice(3).trim();
    return { date: titre.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? '', titre: `Journal · ${titre}`.slice(0, 140), texte: e.split('\n').slice(1).join('\n'), chemin };
  });
}
