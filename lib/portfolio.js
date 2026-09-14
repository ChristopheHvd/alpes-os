// Clients and their projects in one read, for the portfolio view. Nothing is
// stored here: it joins brain/clients, brain/projects and brain/finance with the
// todo and the agenda, the way a person would cross-read the notes.
import fs from 'node:fs';
import path from 'node:path';
import { listProjects } from './projects.js';
import { listClients } from './clients.js';
import { listFinance, links } from './finance.js';

const FM = /^---\n[\s\S]*?\n---/;
const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const body = (root, id) => fs.readFileSync(path.join(root, id), 'utf8').replace(FM, '').trim();

// short, distinctive names only: "App" or "Com" alone would match everything
const matcher = names => {
  const keys = [...new Set(names.map(norm).map(s => s.trim()).filter(s => s.length >= 4))];
  return text => { const t = norm(text); return keys.some(k => t.includes(k)); };
};

export function portfolio(root, { todo = { items: [], carried: [], later: [] }, events = [] } = {}) {
  const clients = listClients(root).map(c => ({ ...c, body: body(root, c.id) }));
  const bySlug = Object.fromEntries(clients.map(c => [c.slug, c]));
  const finance = listFinance(root);
  const tasks = [
    ...todo.items.filter(i => !i.done).map(i => ({ ...i, where: 'today' })),
    ...todo.carried.map(i => ({ ...i, where: 'carried' })),
    ...todo.later.map(i => ({ ...i, where: 'later' })),
  ];
  const related = (names, extra = () => false) => {
    const hit = matcher(names);
    return {
      tasks: tasks.filter(t => hit(`${t.t} ${t.s}`)),
      events: events.filter(e => hit(`${e.title} ${(e.attendees ?? []).join(' ')}`)),
      finance: finance.filter(extra).map(({ projects, clients, echeances, ...f }) => f),
    };
  };

  const projects = listProjects(root).map(p => {
    const txt = body(root, p.id);
    // explicit field first, then a link either way between the two notes
    const client = [p.client, ...links(txt, 'clients')].find(s => bySlug[s])
      ?? clients.find(c => links(c.body, 'projects').includes(p.slug))?.slug ?? '';
    return { ...p, client, body: txt, ...related([p.title], f => f.projet === p.slug || f.projects.includes(p.slug)) };
  });

  return {
    clients: clients.map(c => {
      const own = projects.filter(p => p.client === c.slug);
      const company = c.title.match(/\(([^)]+)\)/)?.[1];
      const names = [c.title.replace(/\s*\(.*\)\s*/, ''), company, ...c.contacts.map(x => x.name), ...own.map(p => p.title)].filter(Boolean);
      return {
        ...c,
        projects: own.map(p => p.slug),
        ...related(names, f => f.client === c.slug || f.clients.includes(c.slug) || [f.projet, ...f.projects].some(s => own.some(p => p.slug === s))),
      };
    }),
    projects,
  };
}
