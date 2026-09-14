import fs from 'node:fs';
import path from 'node:path';

const today = () => new Date().toISOString().slice(0, 10);
// x = done, > = moved to a later day or to "Plus tard", - = dropped
const ITEM_RE = /^- \[( |x|>|-)\] (.*)$/;
const LATER = 'Plus tard';
export const MAX_ACTIVE = 5;
const norm = s => String(s).trim().toLowerCase().replace(/\s+/g, ' ');
const rank = { h: 0, m: 1, '': 2 };

function parse(md) {
  const days = {}, later = [];
  let cur = null;
  for (const line of md.split('\n')) {
    if (line.startsWith('## ')) {
      const h = line.match(/^## (\d{4}-\d{2}-\d{2})/);
      cur = h ? (days[h[1]] = []) : line.slice(3).trim() === LATER ? later : null;
      continue;
    }
    const m = line.match(ITEM_RE);
    if (m && cur) {
      let text = m[2].trim(), p = '';
      if (text.endsWith('!!')) { p = 'h'; text = text.slice(0, -2).trim(); } else if (text.endsWith('!')) { p = 'm'; text = text.slice(0, -1).trim(); }
      const [t, ctx = ''] = text.split(' — ');
      cur.push({ t: t.trim(), s: ctx.trim(), p, done: m[1] === 'x', st: '>-'.includes(m[1]) ? m[1] : '' });
    }
  }
  return { days, later };
}

const line = i => `- [${i.st || (i.done ? 'x' : ' ')}] ${i.t}${i.s ? ' — ' + i.s : ''}${i.p === 'h' ? ' !!' : i.p === 'm' ? ' !' : ''}`;

function serialize({ days, later }) {
  const dates = Object.keys(days).sort().reverse();
  const head = later.length ? `## ${LATER}\n\n` + later.map(line).join('\n') + '\n\n' : '';
  return '# Todo\n\n' + head + dates.map(d => `## ${d}\n\n` + days[d].map(line).join('\n') + '\n').join('\n');
}

const load = file => fs.existsSync(file) ? parse(fs.readFileSync(file, 'utf8')) : { days: {}, later: [] };
function save(file, doc) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, serialize(doc));
}

const clean = i => ({ t: String(i.t).trim(), s: String(i.s ?? '').trim(), p: ['h', 'm'].includes(i.p) ? i.p : '', done: !!i.done, st: '' });

// keeps at most MAX_ACTIVE open tasks today, the overflow goes on top of "Plus tard"
function cap(doc) {
  const d = today(), items = doc.days[d] ?? [];
  let open = 0;
  const keep = [], over = [];
  for (const i of items) (i.done || ++open <= MAX_ACTIVE ? keep : over).push(i);
  doc.days[d] = keep;
  const seen = new Set(over.map(i => norm(i.t)));
  doc.later = [...over, ...doc.later.filter(i => !seen.has(norm(i.t)))];
  return over.length;
}

export function readTodo(file) {
  const { days, later } = load(file);
  const d = today();
  const items = days[d] ?? [];
  const seen = new Set([...items, ...later].map(i => norm(i.t)));
  const carried = [];
  for (const k of Object.keys(days).filter(k => k < d).sort().reverse()) {
    for (const i of days[k]) {
      if (i.done || i.st || seen.has(norm(i.t))) continue;
      seen.add(norm(i.t));
      carried.push({ ...i, from: k });
    }
  }
  return { date: d, items, carried, later, max: MAX_ACTIVE };
}

export function writeTodo(file, items, later) {
  const doc = load(file);
  const seen = new Set();
  const uniq = i => { const k = norm(i.t); return !k || seen.has(k) ? false : (seen.add(k), true); };
  doc.days[today()] = items.map(clean).filter(uniq);
  doc.later = (later ?? doc.later).map(i => ({ ...clean(i), done: false })).filter(uniq);
  const bumped = cap(doc);
  save(file, doc);
  return { ...readTodo(file), bumped };
}

export function addItem(file, { t, s = '', p: prio = '' }) {
  const text = String(t ?? '').trim();
  if (!text) throw new Error('texte de tâche requis');
  const cur = readTodo(file);
  if ([...cur.items, ...cur.later].some(i => norm(i.t) === norm(text))) return cur;
  return writeTodo(file, [...cur.items, { t: text, s, p: prio, done: false }]);
}

export function completeCarried(file, from, text, mark = 'x') {
  const doc = load(file);
  const hit = doc.days[from]?.find(i => norm(i.t) === norm(text));
  if (!hit) return readTodo(file);
  hit.done = mark === 'x';
  hit.st = '>-'.includes(mark) ? mark : '';
  save(file, doc);
  return readTodo(file);
}

// Runs after every stand-up: absorbs what is still open in past days (exact
// duplicates collapse into one), fills today up to MAX_ACTIVE by priority and
// parks the rest in "Plus tard". Past days keep their entries, marked as moved.
export function tidyTodo(file) {
  const doc = load(file);
  const d = today();
  const items = doc.days[d] ??= [];
  const seen = new Set([...items, ...doc.later].map(i => norm(i.t)));
  const pool = [];
  for (const k of Object.keys(doc.days).filter(k => k < d).sort().reverse()) {
    for (const i of doc.days[k]) {
      if (i.done || i.st) continue;
      i.st = '>';
      if (seen.has(norm(i.t))) continue;
      seen.add(norm(i.t));
      pool.push(clean(i));
    }
  }
  pool.sort((a, b) => rank[a.p] - rank[b.p]);
  let room = MAX_ACTIVE - items.filter(i => !i.done).length;
  for (const i of pool) (room-- > 0 ? items : doc.later).push(i);
  const bumped = cap(doc);
  save(file, doc);
  return { ...readTodo(file), bumped };
}
