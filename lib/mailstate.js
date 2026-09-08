// What Christophe decided about his mail: threads he has dealt with, and senders
// he always or never wants to see. Kept in output/mail-state.json because these
// are decisions about a live inbox, not knowledge — nothing here belongs in the
// second brain. Sender rules feed the classifier; hidden threads drop out of the
// list until he asks to see them again.
import fs from 'node:fs';
import path from 'node:path';

const EMPTY = { threads: {}, senders: {}, notes: '' };

export function makeMailState(file) {
  let state = { ...EMPTY };
  try { if (fs.existsSync(file)) state = { ...EMPTY, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch (e) { /* start clean */ }

  const save = () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(state, null, 1));
  };

  return {
    get: () => state,
    // patterns handed to the classifier's allow / deny lists
    rules: () => ({
      allow: Object.entries(state.senders).filter(([, v]) => v.rule === 'allow').map(([k]) => k),
      deny: Object.entries(state.senders).filter(([, v]) => v.rule === 'deny').map(([k]) => k),
    }),
    isHidden: id => !!state.threads[id]?.hidden,
    hidden: () => Object.entries(state.threads).filter(([, v]) => v.hidden)
      .map(([id, v]) => ({ id, ...v })).sort((a, b) => (b.at ?? '').localeCompare(a.at ?? '')),

    hide(id, meta = {}) { state.threads[id] = { hidden: true, at: new Date().toISOString(), ...meta }; save(); return state; },
    unhide(id) { delete state.threads[id]; save(); return state; },
    unhideAll() { state.threads = {}; save(); return state; },

    sender(addr, rule) {
      const key = String(addr).toLowerCase().trim();
      if (!key) return state;
      if (rule === null || rule === 'none') delete state.senders[key];
      else state.senders[key] = { rule, at: new Date().toISOString() };
      save(); return state;
    },
    setNotes(notes) { state.notes = String(notes ?? '').slice(0, 4000); save(); return state; },
  };
}
