// Full-text search over the second brain. getGraph() only carries metadata and
// readNote() opens one note at a time, so answering a real question needed a way
// to look inside every file. The bundle is small (tens of files), so a plain
// scan with a relevance score beats any index to maintain.
import fs from 'node:fs';
import path from 'node:path';

const FM = /^---\n([\s\S]*?)\n---/;
const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name.startsWith('.') || ent.name === 'node_modules') continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else if (ent.name.endsWith('.md')) out.push(p);
  }
  return out;
}

const field = (fm, key) => fm.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))?.[1].trim().replace(/^["']|["']$/g, '') ?? '';

// One excerpt per match, with enough around it to be readable on its own.
function excerpts(body, terms, max = 3) {
  const lines = body.split('\n');
  const hits = [];
  for (let i = 0; i < lines.length && hits.length < max; i++) {
    const l = norm(lines[i]);
    if (!lines[i].trim() || !terms.some(t => l.includes(t))) continue;
    hits.push(lines.slice(Math.max(0, i - 1), i + 2).join(' ').replace(/\s+/g, ' ').trim().slice(0, 320));
    i += 2;
  }
  return hits;
}

export function searchBrain(secondBrain, query, { limit = 8, folders = ['brain', 'skills'] } = {}) {
  const terms = norm(String(query)).split(/\s+/).filter(t => t.length > 2);
  if (!terms.length) return { query, terms, results: [] };

  const files = folders.flatMap(f => walk(path.join(secondBrain, f)));
  const results = [];

  for (const abs of files) {
    const txt = fs.readFileSync(abs, 'utf8');
    const fm = txt.match(FM)?.[1] ?? '';
    const body = txt.replace(FM, '').trim();
    const id = path.relative(secondBrain, abs);
    const title = field(fm, 'title') || path.basename(id, '.md');
    const nTitle = norm(title), nId = norm(id), nBody = norm(body);

    // a term in the title says far more about relevance than one buried in prose
    let score = 0;
    for (const t of terms) {
      if (nTitle.includes(t)) score += 10;
      if (nId.includes(t)) score += 4;
      const n = nBody.split(t).length - 1;
      if (n) score += Math.min(6, n);
    }
    if (!score) continue;
    if (terms.every(t => nTitle.includes(t) || nBody.includes(t))) score += 8;  // all terms present

    results.push({
      id, title, score,
      type: field(fm, 'type'), status: field(fm, 'status'),
      description: field(fm, 'description'),
      excerpts: excerpts(body, terms),
    });
  }

  results.sort((a, b) => b.score - a.score);
  return { query, terms, total: results.length, results: results.slice(0, limit) };
}
