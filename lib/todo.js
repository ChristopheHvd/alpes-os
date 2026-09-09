// Source of truth: a markdown file in the second brain, one "## YYYY-MM-DD" section per day.
//   - [ ] Text of the task — optional context   !! = high priority, ! = medium
import fs from 'node:fs';
import path from 'node:path';

const today = () => new Date().toISOString().slice(0, 10);
const ITEM_RE = /^- \[( |x)\] (.*)$/;

function parse(md) {
  const days = {};
  let cur = null;
  for (const line of md.split('\n')) {
    const h = line.match(/^## (\d{4}-\d{2}-\d{2})/);
    if (h) { cur = h[1]; days[cur] = []; continue; }
    const m = line.match(ITEM_RE);
    if (m && cur) {
      let text = m[2].trim(), p = '';
      if (text.endsWith('!!')) { p = 'h'; text = text.slice(0, -2).trim(); } else if (text.endsWith('!')) { p = 'm'; text = text.slice(0, -1).trim(); }
      const [t, ctx = ''] = text.split(' — ');
      days[cur].push({ t: t.trim(), s: ctx.trim(), p, done: m[1] === 'x' });
    }
  }
  return days;
}

function serialize(days) {
  const dates = Object.keys(days).sort().reverse();
  return '# Todo\n\n' + dates.map(d => `## ${d}\n\n` + days[d].map(i => `- [${i.done ? 'x' : ' '}] ${i.t}${i.s ? ' — ' + i.s : ''}${i.p === 'h' ? ' !!' : i.p === 'm' ? ' !' : ''}`).join('\n') + '\n').join('\n');
}

export function readTodo(file) {
  if (!fs.existsSync(file)) return { date: today(), items: [], carried: [] };
  const days = parse(fs.readFileSync(file, 'utf8'));
  const d = today();
  const items = days[d] ?? [];
  // unfinished items from previous days surface as "carried over"
  const carried = Object.keys(days).filter(k => k < d).flatMap(k => days[k].filter(i => !i.done).map(i => ({ ...i, from: k })));
  return { date: d, items, carried };
}

export function writeTodo(file, items) {
  const days = fs.existsSync(file) ? parse(fs.readFileSync(file, 'utf8')) : {};
  const seen = new Set();
  days[today()] = items
    .map(i => ({ t: String(i.t).trim(), s: String(i.s ?? '').trim(), p: i.p ?? '', done: !!i.done }))
    // the same task twice in one day is always a mistake, never an intent
    .filter(i => { const k = i.t.toLowerCase(); return seen.has(k) ? false : (seen.add(k), true); });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, serialize(days));
  return readTodo(file);
}

// Ticking a task carried over from an earlier day closes it in that day's
// section. Copying it into today instead left the original unfinished, so it
// was carried again and could be ticked again — one duplicate per click.
export function completeCarried(file, from, text, done = true) {
  if (!fs.existsSync(file)) return readTodo(file);
  const days = parse(fs.readFileSync(file, 'utf8'));
  const day = days[from];
  if (!day) return readTodo(file);
  const hit = day.find(i => i.t.trim().toLowerCase() === String(text).trim().toLowerCase());
  if (!hit) return readTodo(file);
  hit.done = !!done;
  fs.writeFileSync(file, serialize(days));
  return readTodo(file);
}
