// Rebuilds the second-brain graph index and prints a summary. The server does this
// on demand; this script exists for a quick check from the terminal.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGraph } from '../lib/brain.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/config.json'), 'utf8'));
const g = buildGraph(cfg.secondBrain, cfg.brainFolders);
const byDom = {};
for (const n of g.nodes) byDom[n.d] = (byDom[n.d] ?? 0) + 1;
console.log(`${g.nodes.length} fichiers, ${g.edges.length} liens`);
for (const [d, c] of Object.entries(byDom).sort((a, b) => b[1] - a[1])) console.log(`  ${d.padEnd(12)} ${c}`);
if (process.argv.includes('--json')) fs.writeFileSync(path.join(ROOT, 'output/graph.json'), JSON.stringify(g));
