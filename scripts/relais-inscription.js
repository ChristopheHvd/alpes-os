#!/usr/bin/env node
// Registers this AlpesOS with the agents relay and keeps its identity in
// credentials/relais.json (never versioned). Run once per machine, then restart the server.
//
//   node scripts/relais-inscription.js <file holding the registration key> [--url https://relais.alpes-ia.fr]
//
// The registration key comes from the relay's owner (os-agents-relay/.secrets/cle-inscription).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { carte, creerClient } from 'os-agents-relay';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const { values, positionals } = parseArgs({ allowPositionals: true, options: { url: { type: 'string', default: 'https://relais.alpes-ia.fr' } } });
const out = path.join(ROOT, 'credentials', 'relais.json');

if (!positionals[0]) {
  console.error('usage : node scripts/relais-inscription.js <fichier de la clé d\'inscription> [--url <relais>]');
  process.exit(1);
}
if (fs.existsSync(out)) {
  console.error(`${path.relative(ROOT, out)} existe déjà : cet AlpesOS est inscrit. Le supprimer d'abord pour réinscrire (les connexions seraient perdues).`);
  process.exit(1);
}

let branding = {};
try { branding = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'branding.json'), 'utf8')); } catch { /* defaults below */ }
const company = branding.company || 'Alpes IA';
const nom = ['Alpes OS', branding.owner, company].filter(Boolean).join(' · ');

const client = creerClient({ url: values.url });
await client.inscrire({
  nom,
  cle_inscription: fs.readFileSync(positionals[0], 'utf8').trim(),
  carte: carte({
    nom, organisation: company, url: values.url,
    description: `Tableau de bord de ${company} : reçoit des missions de ses partenaires et les confie à ses agents.`,
    competences: [{ id: 'livre-blanc', nom: 'Livre blanc', description: 'Sujet, plan et rédaction d\'un livre blanc' }],
  }),
});
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ url: client.url, noeud: client.noeud, secret: client.secret, nom, inscritLe: new Date().toISOString() }, null, 1), { mode: 0o600 });
console.log(`Inscrit au relais ${client.url} sous « ${nom} » (nœud ${client.noeud}).`);
console.log(`Identité rangée dans ${path.relative(ROOT, out)}. Redémarrer AlpesOS pour activer les connexions.`);
