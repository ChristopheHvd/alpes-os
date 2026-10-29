// The order the user dragged their projects into, and the stage each hidden one
// had before, so "Réafficher" puts it back where it was. Kept in
// output/projects-order.json, mirroring lib/mailstate.js: a display preference,
// not knowledge, so a drag never becomes an event for the second brain's curator.
import fs from 'node:fs';
import path from 'node:path';

const EMPTY = { order: [], hiddenFrom: {} };

export function makeProjectsOrder(file) {
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
    setOrder(slugs) { return mutate(() => { state.order = [...new Set(slugs.map(String).filter(Boolean))]; }); },
    hid(slug, stage) { return mutate(() => { state.hiddenFrom[slug] = stage; }); },
  };
}
