// What the user decided about their mail: threads already dealt with, and senders
// to always or never show. Kept in output/mail-state.json because these
// are decisions about a live inbox, not knowledge — nothing here belongs in the
// second brain. Sender rules feed the classifier; hidden threads drop out of the
// list until they are restored.
import fs from 'node:fs';
import path from 'node:path';

const EMPTY = { threads: {}, senders: {}, notes: '' };

export function makeMailState(file) {
  const read = () => {
    try { if (fs.existsSync(file)) return { ...EMPTY, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch (e) { /* start clean */ }
    return { ...EMPTY };
  };
  let state = read();

  // Re-read before every mutation, then write straight away. A debounce used to
  // sit here and a restart within its window silently dropped the decision;
  // re-reading also means a second server instance cannot clobber the first.
  const save = () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state, null, 1));
    fs.renameSync(tmp, file);
  };
  const mutate = fn => { state = read(); fn(); save(); return state; };

  return {
    get: () => (state = read()),
    // patterns handed to the classifier's allow / deny lists
    rules: () => ({
      allow: Object.entries((state = read()).senders).filter(([, v]) => v.rule === 'allow').map(([k]) => k),
      deny: Object.entries(state.senders).filter(([, v]) => v.rule === 'deny').map(([k]) => k),
    }),
    isHidden: id => !!read().threads[id]?.hidden,
    hidden: () => Object.entries(state.threads).filter(([, v]) => v.hidden)
      .map(([id, v]) => ({ id, ...v })).sort((a, b) => (b.at ?? '').localeCompare(a.at ?? '')),

    hide(id, meta = {}) { return mutate(() => { state.threads[id] = { hidden: true, at: new Date().toISOString(), ...meta }; }); },
    unhide(id) { return mutate(() => { delete state.threads[id]; }); },
    unhideAll() { return mutate(() => { state.threads = {}; }); },

    sender(addr, rule) {
      const key = String(addr).toLowerCase().trim();
      if (!key) return state;
      return mutate(() => {
        if (rule === null || rule === 'none') delete state.senders[key];
        else state.senders[key] = { rule, at: new Date().toISOString() };
      });
    },
    setNotes(notes) { return mutate(() => { state.notes = String(notes ?? '').slice(0, 4000); }); },
  };
}
