// Réglages: the model, effort and prompt of each function that calls Claude, and the
// second brain skills offered to the agents. Kept next to config.json, out of git, and
// read again at every launch, so a change applies without restarting the server.
import fs from 'node:fs';
import path from 'node:path';

export const MODELS = ['claude-sonnet-5-5', 'claude-opus-5-5'];
export const EFFORTS = ['low', 'medium', 'high'];
// the curator is the only writer of the second brain: an agent gets it only when asked
const OFF_FOR_AGENTS = ['second-brain-curator'];

// the first value set: Réglages, then config.json, then the code's default
export const pick = (...values) => values.find(v => v !== undefined && v !== null && v !== '');

// a prompt kept as a template: {{name}} stands for a value known at launch only
export const fill = (text, vars) => String(text).replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? String(vars[k]) : m));

export function makeReglages(dir) {
  const file = path.join(dir, 'reglages.json');
  const promptFile = id => {
    if (!/^[a-z0-9-]+$/.test(id)) throw new Error('fonction inconnue');
    return path.join(dir, 'prompts', `${id}.md`);
  };
  const read = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; } };
  const write = data => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file + '.tmp', JSON.stringify(data, null, 1));
    fs.renameSync(file + '.tmp', file);
  };
  const override = id => { try { return fs.readFileSync(promptFile(id), 'utf8'); } catch { return null; } };

  return {
    model: (id, ...fallbacks) => pick(read().functions?.[id]?.model, ...fallbacks),
    effort: (id, ...fallbacks) => pick(read().functions?.[id]?.effort, ...fallbacks),
    // null removes the setting: config.json or the code's default take over again
    set(id, patch) {
      if (patch.model != null && !MODELS.includes(patch.model)) throw new Error('modèle inconnu');
      if (patch.effort != null && !EFFORTS.includes(patch.effort)) throw new Error('effort inconnu');
      const data = read();
      const cur = { ...data.functions?.[id] };
      for (const k of ['model', 'effort']) {
        if (!(k in patch)) continue;
        if (patch[k] == null) delete cur[k]; else cur[k] = patch[k];
      }
      data.functions = { ...data.functions, [id]: cur };
      if (!Object.keys(cur).length) delete data.functions[id];
      write(data);
    },

    prompt: (id, original) => override(id) ?? original,
    modified: id => override(id) != null,
    setPrompt(id, text) {
      const f = promptFile(id);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f + '.tmp', String(text));
      fs.renameSync(f + '.tmp', f);
    },
    resetPrompt: id => fs.rmSync(promptFile(id), { force: true }),

    skillOn: name => read().skills?.[name]?.agents ?? !OFF_FOR_AGENTS.includes(name),
    setSkill(name, on) {
      const data = read();
      data.skills = { ...data.skills, [name]: { ...data.skills?.[name], agents: !!on } };
      write(data);
    },
  };
}
