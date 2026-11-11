// The calls to Claude that prospection makes: turn a sentence into search criteria,
// research one company on the web, write a sequence, read a reply. Each one is a
// one-shot `claude -p` with a JSON schema, like the hourly review (lib/review.js):
// no session kept, and web tools only where the task needs the web.
import { spawn } from 'node:child_process';

export function ask({ bin = 'claude', model, effort, system, schema, input, tools = '', timeoutMs = 180e3, cwd }) {
  return new Promise((resolve, reject) => {
    const args = ['-p', '--model', model, ...(effort ? ['--effort', effort] : []), '--tools', tools, '--strict-mcp-config', '--no-session-persistence',
      '--output-format', 'json', '--json-schema', JSON.stringify(schema), '--system-prompt', system,
      ...(tools ? ['--allowedTools', tools] : [])];
    const child = spawn(bin, args, { cwd, env: { ...process.env, CLAUDECODE: '' }, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err = (err + d).slice(-1000); });
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.on('close', code => {
      clearTimeout(timer);
      try {
        const r = JSON.parse(out);
        const data = r.structured_output ?? JSON.parse(r.result);
        if (r.is_error || !data) throw new Error(String(r.result ?? 'réponse vide').slice(0, 300));
        resolve(data);
      } catch (e) { reject(new Error(`Claude a échoué (code ${code}) : ${(err || out || e.message).slice(-300)}`)); }
    });
    child.stdin.end(typeof input === 'string' ? input : JSON.stringify(input, null, 1));
  });
}

const S = { type: 'string' };
const arr = items => ({ type: 'array', items });

export const CIBLE_SYSTEM = `Tu aides Christophe Havard (Alpes IA, Annecy : formations IA et automatisations pour TPE et PME) à définir une cible de prospection.
On te donne une phrase. Traduis-la en critères pour l'annuaire des entreprises de l'État :
- naf : codes d'activité NAF rév. 2 complets au format 43.32A (tous ceux qui correspondent à la phrase, sans en inventer) ;
- departements : numéros de département (74 par défaut si rien n'est dit) ;
- codes_postaux : seulement si la phrase vise des communes précises (stations, vallée), sinon liste vide ;
- tranches : codes de tranche d'effectif parmi 01 (1-2), 02 (3-5), 03 (6-9), 11 (10-19), 12 (20-49), 21 (50-99) ; par défaut 11 et 12.
Propose aussi, en français simple, sans jargon : un titre court (2 à 4 mots), pourquoi eux (une phrase sur ce qui leur coûte du temps ou de l'argent),
les moments où ils achètent (3 à 5 événements repérables : recrutement administratif, nouveau dirigeant, agrandissement…) et l'offre d'Alpes IA la plus adaptée.
Pas de tiret cadratin.`;
export const CIBLE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['titre', 'naf', 'departements', 'codes_postaux', 'tranches', 'pourquoi', 'moments', 'offre'],
  properties: { titre: S, naf: arr(S), departements: arr(S), codes_postaux: arr(S), tranches: arr(S), pourquoi: S, moments: arr(S), offre: S },
};

export const RECHERCHE_SYSTEM = `Tu prépares la prospection d'Alpes IA (Christophe Havard, Annecy). On te donne une entreprise française (nom, ville, SIREN, dirigeants)
et les moments d'achat qui intéressent cette cible. Cherche sur le web, en 8 appels d'outils au plus :
1. Son site (pas un annuaire) : lis l'accueil, la page contact, les mentions légales, la page recrutement s'il y en a une.
2. Les adresses e-mail publiées : sur le site, dans les annuaires publics (Pages Jaunes, sites de certification). Pour chacune : nominative (prénom ou nom d'une personne) ou générique (contact@, info@, accueil@…), et où tu l'as vue.
3. Le téléphone du standard.
4. Le profil LinkedIn du dirigeant, uniquement depuis les résultats de recherche (ne te connecte jamais à LinkedIn) : confiance haute si le nom et l'entreprise concordent, moyenne si seul le nom et la région concordent, sinon ne donne rien.
5. Les moments d'achat datés des 18 derniers mois : offres d'emploi (surtout administratif, assistant, devis, commercial), nouveaux locaux, rachat, nouvelle agence, nouveau dirigeant, croissance, investissement. Avec la date et l'URL.
Ne contacte personne, ne remplis aucun formulaire, ne crée aucun compte. N'invente rien : un champ que tu n'as pas trouvé reste vide.
Si tu ne trouves aucune adresse nominative mais que tu connais le domaine de l'entreprise et le prénom et nom du dirigeant, propose une adresse déduite prénom.nom@domaine (type deduit, sans accents, en minuscules).
Écris en français, phrases courtes, sans tiret cadratin.`;
export const RECHERCHE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['site', 'emails', 'telephone', 'linkedin', 'signaux', 'notes'],
  properties: {
    site: S,
    emails: arr({ type: 'object', additionalProperties: false, required: ['adresse', 'type', 'source'], properties: { adresse: S, type: { type: 'string', enum: ['nominatif', 'generique', 'deduit'] }, source: S } }),
    telephone: S,
    linkedin: { type: 'object', additionalProperties: false, required: ['url', 'confiance'], properties: { url: S, confiance: { type: 'string', enum: ['haute', 'moyenne', ''] } } },
    signaux: arr({ type: 'object', additionalProperties: false, required: ['quoi', 'date', 'url'], properties: { quoi: S, date: S, url: S } }),
    notes: S,
  },
};
