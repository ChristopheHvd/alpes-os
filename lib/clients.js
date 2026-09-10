// Clients and prospects, read from brain/clients/ in the second brain. Same shape
// as lib/projects.js: the markdown file is the record, the dashboard only reads
// and appends. Creation follows the update flow in braindoc.js — file, index
// link, log line — so a new client is never an orphan in the graph.
import fs from 'node:fs';
import path from 'node:path';
import { slugify, linkInIndex, noteInLog } from './braindoc.js';

const FM = /^---\n([\s\S]*?)\n---/;
const field = (fm, key) => fm.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))?.[1].trim().replace(/^["']|["']$/g, '') ?? '';

function parse(abs, root) {
  const txt = fs.readFileSync(abs, 'utf8');
  const fm = txt.match(FM)?.[1] ?? '';
  const id = path.relative(root, abs);
  const tags = fm.match(/^tags:\s*\[(.*)\]/m)?.[1] ?? '';
  return {
    id,
    slug: path.basename(id, '.md'),
    title: field(fm, 'title') || path.basename(id, '.md'),
    description: field(fm, 'description'),
    status: field(fm, 'status'),
    tags: tags.split(',').map(t => t.trim()).filter(Boolean),
    mtime: fs.statSync(abs).mtimeMs,
  };
}

export function listClients(secondBrain) {
  const dir = path.join(secondBrain, 'brain', 'clients');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.md') && f !== 'index.md')
    .map(f => parse(path.join(dir, f), secondBrain))
    .sort((a, b) => b.mtime - a.mtime);
}

export function createClient(secondBrain, { nom, entreprise = '', description = '', contacts = [], contexte = '', tags = [], body = '' }) {
  const name = String(nom ?? '').trim();
  if (!name) throw new Error('nom requis');
  const company = String(entreprise ?? '').trim();
  const title = company && company.toLowerCase() !== name.toLowerCase() ? `${name} (${company})` : name;
  const slug = slugify(company && company.toLowerCase() !== name.toLowerCase() ? `${name} ${company}` : name);
  if (!slug) throw new Error('nom inexploitable');

  const dir = path.join(secondBrain, 'brain', 'clients');
  const abs = path.join(dir, `${slug}.md`);
  if (fs.existsSync(abs)) throw new Error(`la fiche client ${slug} existe déjà`);

  const shortTag = slug.split('-').slice(-1)[0];
  const allTags = [...new Set(['client', shortTag, ...tags.map(t => String(t).trim()).filter(Boolean)])];
  const list = (Array.isArray(contacts) ? contacts : [contacts]).map(c => String(c).trim()).filter(Boolean);
  const profil = (contexte || body || description || 'À préciser.').trim();
  const doc = `---
type: Client
title: ${title}
description: ${description || title}
tags: [${allTags.join(', ')}]
status: draft
generated: { by: alpes-os/chat, at: ${new Date().toISOString()} }
---

# Profil

${profil}
${list.length ? `\n# Contacts\n\n${list.map(c => `- ${c}`).join('\n')}\n` : ''}`;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(abs, doc);
  try { linkInIndex(dir, slug, title, description || contexte || body); } catch { /* index optional */ }
  try { noteInLog(secondBrain, `* **Add**: \`brain/clients/${slug}.md\` — ${title}.`); } catch { /* log optional */ }
  return parse(abs, secondBrain);
}
