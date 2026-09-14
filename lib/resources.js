// Everything a client space links to: the course variant made for them, the kits
// and reference files in the second brain, and the deliverables Alpes OS produced.
// Nothing is declared by hand in the bundle — files are matched on the client's
// keys (tags, slug parts, company) — and config/client-resources.json can add a
// link the matching can't guess or hide one it got wrong.
import fs from 'node:fs';
import path from 'node:path';

const alnum = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const GENERIC = new Set(['client', 'prospect', 'project', 'projet', 'devis', 'formation', 'finance']);

// short keys ("com", "marc") would match unrelated files, so keep five letters and up
export function clientKeys(client) {
  const company = client.title.match(/\(([^)]+)\)/)?.[1];
  const raw = [client.slug, ...client.slug.split('-'), ...client.tags.filter(t => !GENERIC.has(t)), company];
  return [...new Set(raw.map(alnum).filter(k => k.length >= 5))];
}

function files(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(d => d.isFile() && !d.name.startsWith('.'))
    .map(d => { const st = fs.statSync(path.join(dir, d.name)); return { name: d.name, size: st.size, mtime: st.mtimeMs }; });
}

const extOf = name => path.extname(name).slice(1).toLowerCase();
const refLinks = txt => [...String(txt).matchAll(/\]\((?:\.\.\/)*references\/([^)\s#]+)\)/g)].map(m => decodeURIComponent(m[1]));

export function readManual(alpesRoot) {
  try { return JSON.parse(fs.readFileSync(path.join(alpesRoot, 'config', 'client-resources.json'), 'utf8')); }
  catch { return {}; }
}

export function clientResources({ root, alpesRoot, client, notes = [], manual = {} }) {
  const keys = clientKeys(client);
  const hit = name => { const n = alnum(name); return keys.some(k => n.includes(k)); };
  const out = [];

  try {
    const decks = JSON.parse(fs.readFileSync(path.join(root, 'cours', 'decks.json'), 'utf8'));
    for (const d of decks) for (const c of d.clients ?? []) {
      if (c.id && keys.includes(alnum(c.id))) out.push({ id: `cours/${d.id}/${c.id}`, type: 'cours', label: d.titre, detail: `Version ${c.nom}`, url: `/cours/?${new URLSearchParams({ deck: d.id, client: c.id })}` });
    }
  } catch { /* no course catalogue */ }

  for (const f of files(path.join(root, 'kits')).filter(f => hit(f.name))) {
    out.push({ id: `kits/${f.name}`, type: 'kit', label: f.name, ext: extOf(f.name), size: f.size, mtime: f.mtime, url: `/content/kits/${encodeURIComponent(f.name)}` });
  }

  const linked = new Set(notes.flatMap(refLinks));
  for (const f of files(path.join(root, 'brain', 'references')).filter(f => linked.has(f.name) || hit(f.name))) {
    out.push({ id: `references/${f.name}`, type: 'reference', label: f.name, ext: extOf(f.name), size: f.size, mtime: f.mtime, url: `/content/references/${encodeURIComponent(f.name)}` });
  }

  // a PDF and its HTML source are one deliverable with two formats
  for (const kind of ['devis', 'factures', 'formations']) {
    const groups = {};
    for (const f of files(path.join(alpesRoot, 'output', kind)).filter(f => hit(f.name))) {
      const base = f.name.slice(0, f.name.length - path.extname(f.name).length);
      const g = groups[base] ??= { id: `output/${kind}/${base}`, type: 'livrable', label: base.replace(/_/g, ' '), detail: kind, formats: [], size: 0, mtime: 0 };
      g.formats.push({ ext: extOf(f.name), url: `/output/${kind}/${encodeURIComponent(f.name)}` });
      g.size = Math.max(g.size, f.size); g.mtime = Math.max(g.mtime, f.mtime);
    }
    for (const g of Object.values(groups)) {
      g.formats.sort((a, b) => (a.ext === 'pdf' ? -1 : b.ext === 'pdf' ? 1 : 0));
      g.url = g.formats[0].url;
      out.push(g);
    }
  }

  const own = manual[client.slug] ?? {};
  const hidden = new Set(own.hide ?? []);
  for (const a of own.add ?? []) {
    if (a?.url && a?.label) out.push({ id: `lien/${a.url}`, type: a.type || 'lien', label: String(a.label), detail: a.detail ? String(a.detail) : '', url: String(a.url) });
  }
  return out.filter(r => !hidden.has(r.id));
}
