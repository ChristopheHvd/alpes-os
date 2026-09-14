// Alpes OS is a producer of the second brain, not its editor (second-brain/AGENTS.md,
// "Rôles et file d'événements"): only the curator writes the bundle. Every write the
// dashboard makes goes through here instead. It becomes a self-contained event in
// the external queue, and until the curator has archived that event the change is
// kept locally and laid over what is read from disk, so the screen never lags.
//
// Two operations cover every write: replace a file's whole content, or append a
// block (at the end, or at the end of a "## heading" section). Writes to the same
// file close together are merged into one event before it leaves.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const sha = s => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
const stampName = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z').replace(/^(\d{4})(\d{2})(\d{2})T/, '$1-$2-$3T');
const fence = s => { const n = Math.max(3, ...[...String(s).matchAll(/`{3,}/g)].map(m => m[0].length + 1)); return '`'.repeat(n); };

// insert `text` at the end of the section whose heading line is `section`, or open
// that section at the end of the file
export function applyAppend(txt, { section, text }) {
  const body = String(txt ?? '');
  if (!section) return body.replace(/\s*$/, '\n\n') + text.replace(/^\s+/, '');
  const lines = body.split('\n');
  const start = lines.findIndex(l => l.trim() === section.trim());
  if (start === -1) return body.replace(/\s*$/, '\n\n') + `${section}\n\n` + text.replace(/^\s+/, '');
  let end = lines.findIndex((l, i) => i > start && /^##\s/.test(l));
  if (end === -1) end = lines.length;
  const block = lines.slice(start, end).join('\n').replace(/\s*$/, '\n\n');
  return [...lines.slice(0, start), block + text.replace(/^\s+/, ''), ...lines.slice(end)].join('\n');
}

export function createBundle() {
  let conf = null;          // null: plain filesystem (scripts, tests)
  let pending = [];
  let timer = null;

  const rel = abs => path.relative(conf.root, path.resolve(abs)).split(path.sep).join('/');
  const inBundle = abs => conf && !rel(abs).startsWith('..');
  const disk = abs => (fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null);
  const save = () => {
    fs.mkdirSync(path.dirname(conf.pendingFile), { recursive: true });
    const tmp = conf.pendingFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(pending, null, 1));
    fs.renameSync(tmp, conf.pendingFile);
  };
  const entriesFor = r => pending.filter(e => e.rel === r);

  function overlay(abs) {
    let cur = disk(abs);
    for (const e of entriesFor(rel(abs))) {
      if (e.op === 'replace') cur = e.content;
      else for (const t of e.texts) cur = applyAppend(cur ?? e.header ?? '', { section: e.section, text: t });
    }
    return cur;
  }

  function stage(abs, entry) {
    const r = rel(abs), now = Date.now();
    const delay = conf.delays?.[r] ?? conf.delays?.default ?? 15e3;
    // merge into the last event for this file if it hasn't left yet
    const last = entriesFor(r).at(-1);
    if (last && !last.sent && last.op === entry.op && (entry.op === 'replace' || last.section === entry.section)) {
      if (entry.op === 'replace') last.content = entry.content; else last.texts.push(...entry.texts);
      if (entry.why && !last.why.includes(entry.why)) last.why.push(entry.why);
      last.updated_at = new Date(now).toISOString();
      last.due = now + delay;
    } else {
      const before = overlay(abs);
      pending.push({
        ...entry, id: crypto.randomUUID(), rel: r, created_at: new Date(now).toISOString(), updated_at: new Date(now).toISOString(),
        due: now + delay, sent: false, file: null, base: before == null ? null : sha(before),
        why: entry.why ? [entry.why] : [], subject: entry.subject || r,
      });
    }
    save();
  }

  function eventText(e) {
    const created = e.base == null ? 'le fichier n\'existe pas encore : le créer' : `Version de base lue par Alpes OS : sha256 ${e.base} (après application des événements Alpes OS précédents sur ce fichier)`;
    const facts = e.why.length ? e.why.map(w => `    - ${w}`).join('\n') : '    - modification faite depuis Alpes OS';
    const change = e.op === 'replace'
      ? `remplacer le contenu complet de \`${e.rel}\` par le contenu exact ci-dessous. ${created}. Si le fichier sur main ne correspond plus à cette base, ne pas écraser : fusionner les changements décrits dans les faits ou s'arrêter pour arbitrage.`
      : `ajouter ${e.section ? `à la fin de la section \`${e.section}\` de \`${e.rel}\` (la créer en fin de fichier si elle manque)` : `à la fin de \`${e.rel}\``} le bloc exact ci-dessous, sans rien modifier d'autre (append-only).${e.header ? ' Si le fichier n\'existe pas, le créer avec l\'en-tête fourni.' : ''}`;
    const payload = e.op === 'replace' ? e.content : e.texts.join('\n');
    const f = fence(payload);
    return `---
type: SecondBrainEvent
event_id: ${e.id}
created_at: ${e.created_at}
producer: alpes-os
subject: ${JSON.stringify(e.subject)}
---

# Événement Second Brain — ${e.subject}

## État et mutations demandées
- Cible : \`${e.rel}\`
  Faits :
${facts}
  Changement demandé : ${change}
  Source : action de Christophe dans le dashboard Alpes OS, ${e.updated_at}.

## Contenu exact
${f}markdown
${payload.replace(/\n$/, '')}
${f}
${e.op === 'append' && e.header ? `\n## En-tête si le fichier est créé\n${fence(e.header)}markdown\n${e.header.replace(/\n$/, '')}\n${fence(e.header)}\n` : ''}`;
  }

  function send(e) {
    const inbox = path.join(conf.queueDir, 'inbox');
    fs.mkdirSync(inbox, { recursive: true });
    const slug = e.rel.replace(/\.md$/, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(-48).replace(/^-+/, '');
    const name = `${stampName(new Date())}-${e.id}-alpes-os-${slug}.md`;
    const tmp = path.join(inbox, `.${name}.tmp`);
    fs.writeFileSync(tmp, eventText(e));
    fs.renameSync(tmp, path.join(inbox, name));
    e.sent = true; e.file = name; e.sent_at = new Date().toISOString();
  }

  function flush(force = false) {
    if (!conf) return;
    let changed = false;
    for (const e of pending) if (!e.sent && (force || e.due <= Date.now())) { send(e); changed = true; }
    if (changed) save();
  }

  const where = file => ['inbox', 'processing', 'archive'].find(d => fs.existsSync(path.join(conf.queueDir, d, file)));

  // an archived event is in the bundle now; an event gone from every folder was
  // discarded by hand, so its change is dropped rather than shown forever
  function settle() {
    if (!conf) return;
    const before = pending.length;
    pending = pending.filter(e => !e.sent || ['inbox', 'processing'].includes(where(e.file)));
    if (pending.length !== before) save();
  }

  const count = d => { try { return fs.readdirSync(path.join(conf.queueDir, d)).filter(f => f.endsWith('.md') && !f.startsWith('.')).length; } catch { return 0; } };

  return {
    configure(c) {
      conf = { delays: {}, ...c };
      try { pending = JSON.parse(fs.readFileSync(conf.pendingFile, 'utf8')); } catch { pending = []; }
      settle();
      flush(true);          // anything staged before a restart leaves now
      clearInterval(timer);
      timer = setInterval(() => { try { flush(); settle(); } catch (e) { console.error('sbqueue', e.message); } }, 5000);
      timer.unref?.();
    },
    get active() { return !!conf; },
    exists: abs => (inBundle(abs) ? overlay(abs) != null : fs.existsSync(abs)),
    read: abs => {
      const txt = inBundle(abs) ? overlay(abs) : disk(abs);
      if (txt == null) throw Object.assign(new Error(`ENOENT: ${abs}`), { code: 'ENOENT' });
      return txt;
    },
    mtime: abs => {
      if (inBundle(abs)) { const e = entriesFor(rel(abs)).at(-1); if (e) return Date.parse(e.updated_at); }
      return fs.statSync(abs).mtimeMs;
    },
    // directory listing including files that only exist as pending creations
    list: dir => {
      const names = new Set(fs.existsSync(dir) ? fs.readdirSync(dir) : []);
      if (inBundle(dir)) {
        const r = rel(dir);
        for (const e of pending) if (path.posix.dirname(e.rel) === r && overlay(path.join(conf.root, e.rel)) != null) names.add(path.posix.basename(e.rel));
      }
      return [...names];
    },
    replace(abs, content, { why = '', subject = '' } = {}) {
      if (!inBundle(abs)) { fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(abs, content); return; }
      stage(abs, { op: 'replace', content: String(content), why, subject });
    },
    append(abs, text, { why = '', subject = '', section = '', header = '' } = {}) {
      if (!inBundle(abs)) {
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, applyAppend(disk(abs) ?? header, { section, text }));
        return;
      }
      stage(abs, { op: 'append', texts: [String(text)], section, header, why, subject });
    },
    flush: () => { flush(true); },
    settle,
    status() {
      if (!conf) return { active: false };
      settle();
      const mine = pending.filter(e => e.sent).map(e => ({ file: e.file, where: where(e.file), subject: e.subject }));
      return {
        active: true,
        waiting: pending.length,
        unsent: pending.filter(e => !e.sent).length,
        stuck: mine.filter(e => e.where === 'processing').length,
        inbox: count('inbox'), processing: count('processing'),
        locked: fs.existsSync(path.join(conf.queueDir, 'curator.lock')),
        items: pending.map(e => ({ subject: e.subject, rel: e.rel, why: e.why, sent: e.sent, where: e.sent ? where(e.file) : 'local', updated_at: e.updated_at })),
      };
    },
  };
}

export const bundle = createBundle();
