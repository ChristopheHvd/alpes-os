// What the user decided about their calendar: events hidden on the spot, and
// organisers set to never show — the spouse inviting to a personal errand, say.
// Kept in output/calendar-state.json, mirroring lib/mailstate.js: this is a
// live-view decision, not knowledge, so it never touches the second brain.
import fs from 'node:fs';
import path from 'node:path';

const EMPTY = { events: {}, organizers: {} };

export function makeCalendarState(file) {
  const read = () => {
    try { if (fs.existsSync(file)) return { ...EMPTY, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch (e) { /* start clean */ }
    return { ...EMPTY };
  };
  let state = read();

  const save = () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state, null, 1));
    fs.renameSync(tmp, file);
  };
  const mutate = fn => { state = read(); fn(); save(); return state; };

  return {
    get: () => (state = read()),
    isHidden: id => !!read().events[id]?.hidden,
    deniedOrganizers: () => Object.entries((state = read()).organizers).filter(([, v]) => v.rule === 'deny').map(([k]) => k),
    hidden: () => Object.entries(state.events).filter(([, v]) => v.hidden)
      .map(([id, v]) => ({ id, ...v })).sort((a, b) => (b.at ?? '').localeCompare(a.at ?? '')),

    hide(id, meta = {}) { return mutate(() => { state.events[id] = { hidden: true, at: new Date().toISOString(), ...meta }; }); },
    unhide(id) { return mutate(() => { delete state.events[id]; }); },
    unhideAll() { return mutate(() => { state.events = {}; }); },
    organizer(addr, rule) {
      const key = String(addr).toLowerCase().trim();
      if (!key) return state;
      return mutate(() => {
        if (rule === null || rule === 'none') delete state.organizers[key];
        else state.organizers[key] = { rule, at: new Date().toISOString() };
      });
    },
  };
}
