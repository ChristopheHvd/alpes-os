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

const REGLES_TEXTE = `Règles d'écriture : vouvoiement, phrases courtes, ton direct d'un dirigeant local qui écrit à un autre, aucune formule creuse.
Interdits : « pas X, mais Y », question suivie de sa réponse, deux-points de révélation, listes de « sans », tiret cadratin, emojis,
et les mots concrètement, véritable, solution, booster, optimiser, révolutionner, innovant, au cœur de, écosystème, clé en main.
Un e-mail tient en 60 à 110 mots, un message LinkedIn en 40 à 70 mots, une note d'invitation est vide (l'invitation part sans note).
Pas de chiffre ni de client de référence inventé. Une seule question ou une seule demande par message.
Variables disponibles, à écrire telles quelles : {bonjour} (formule d'appel qui s'adapte à l'adresse : à mettre en tête de chaque e-mail),
{prénom}, {nom}, {entreprise}, {ville}, {moment} (le moment d'achat repéré, peut être vide), {lien} (la ressource à envoyer).
Les e-mails se terminent par « Christophe Havard, Alpes IA, Annecy ». La ligne de désinscription est ajoutée automatiquement : ne l'écris pas.
Pour une étape appel, le texte est ce que Christophe dit en premier au téléphone (3 phrases au plus), sans objet.`;

export const MESSAGES_SYSTEM = `Tu écris les messages d'une campagne de prospection d'Alpes IA (Christophe Havard, Annecy : formations IA et automatisations pour TPE et PME).
On te donne la cible (pourquoi eux, moments où ils achètent, offre, lien de la ressource) et les étapes de la séquence (canal, délai en jours).
Écris l'objet (e-mails seulement) et le texte de chaque étape. Les messages se répondent : le second canal peut rappeler le premier
(« je vous ai écrit par e-mail la semaine dernière »). La ressource ({lien}) arrive dans un message de relance, pas dans le premier.
Si une consigne est donnée, suis-la.
${REGLES_TEXTE}`;
export const MESSAGES_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['etapes'],
  properties: { etapes: arr({ type: 'object', additionalProperties: false, required: ['id', 'objet', 'texte'], properties: { id: S, objet: S, texte: S } }) },
};

export const REECRIRE_SYSTEM = `Tu réécris un message d'une campagne de prospection d'Alpes IA selon la consigne de Christophe. Garde ce qui marche, change ce qu'il demande.
${REGLES_TEXTE}`;
export const REECRIRE_SCHEMA = { type: 'object', additionalProperties: false, required: ['objet', 'texte'], properties: { objet: S, texte: S } };

export const PERSO_SYSTEM = `Tu écris, pour chaque entreprise donnée, une version personnelle du premier e-mail d'une campagne de prospection d'Alpes IA.
Chaque entreprise a un moment d'achat repéré (recrutement, nouveau dirigeant, nouveaux locaux…) : le message part de ce fait, précis et daté,
puis fait le lien avec l'offre en une phrase, et finit sur une seule question. Ne prétends jamais connaître l'entreprise mieux que ce fait.
Ne cite pas la source administrative (BODACC, BOAMP, registre) : parle du fait lui-même (« j'ai vu que vous avez repris… »).
${REGLES_TEXTE}`;
export const PERSO_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['messages'],
  properties: { messages: arr({ type: 'object', additionalProperties: false, required: ['siren', 'objet', 'texte'], properties: { siren: S, objet: S, texte: S } }) },
};

export const REPONSE_SYSTEM = `Tu lis la réponse d'un prospect à la prospection d'Alpes IA (Christophe Havard, Annecy) et tu prépares la décision de Christophe.
On te donne la cible, l'entreprise, le dirigeant, le canal (e-mail ou LinkedIn), les messages déjà envoyés et la réponse.
- classe : interesse (veut en parler, un rendez-vous, un appel, une info), pas_maintenant (plus tard, avec ou sans date), renvoi (vers une autre personne),
  pas_interesse (non poli), stop (ne veut plus être contacté, désinscription), absence (réponse automatique, congés), autre.
- titre : le cas en 2 à 5 mots (« Veut être appelé », « Pas avant février », « Renvoie vers sa comptable »).
- fait : une ligne utile pour décider, avec ce que le prospect a dit d'important (pas un résumé de tout).
- action : repondre (envoyer une réponse), appeler, relancer (à une date), renvoyer (contacter la personne indiquée), exclure, rien.
- question : la question posée à Christophe, qui se répond par Oui (« Lui proposer jeudi 10 h ? », « Le relancer le 2 février ? »).
- reponse : le texte à envoyer si l'action est repondre ou renvoyer (vide sinon) ; pour un e-mail, commence par la formule d'appel et finis par « Christophe Havard, Alpes IA ».
- relance : date AAAA-MM-JJ si l'action est relancer (la date qu'il a donnée, sinon dans 3 mois), vide sinon.
- personne : la personne vers qui il renvoie (nom, fonction, e-mail ou téléphone s'il les donne), vide sinon.
- qui : le nom de la personne qui a écrit, tel qu'il apparaît.
Pour une proposition de créneau, propose deux créneaux en semaine les jours ouvrés suivants (aujourd'hui est donné). Vouvoiement, phrases courtes, sans tiret cadratin.`;
export const REPONSE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['classe', 'titre', 'fait', 'action', 'question', 'reponse', 'relance', 'personne', 'qui'],
  properties: {
    classe: { type: 'string', enum: ['interesse', 'pas_maintenant', 'renvoi', 'pas_interesse', 'stop', 'absence', 'autre'] },
    titre: S, fait: S, action: { type: 'string', enum: ['repondre', 'appeler', 'relancer', 'renvoyer', 'exclure', 'rien'] },
    question: S, reponse: S, relance: S,
    personne: { type: 'object', additionalProperties: false, required: ['nom', 'fonction', 'contact'], properties: { nom: S, fonction: S, contact: S } },
    qui: S,
  },
};
