// Companies from the State's public directory (recherche-entreprises.api.gouv.fr) and
// their legal notices (BODACC, opendatasoft). Both are free, keyless and rate-limited:
// calls go one at a time with a short pause, so a search of a few hundred companies
// takes a minute or two rather than tripping the limit.
const DIR = 'https://recherche-entreprises.api.gouv.fr/search';
const BODACC = 'https://bodacc-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/annonces-commerciales/records';
const PAUSE_MS = 160;
const MAX_PAGES = 40;   // 1000 companies: past that, the target is too broad to work by hand

export const TRANCHES = {
  '00': '0', '01': '1 à 2', '02': '3 à 5', '03': '6 à 9', '11': '10 à 19', '12': '20 à 49',
  '21': '50 à 99', '22': '100 à 199', '31': '200 à 249', '32': '250 à 499', '41': '500 à 999', '42': '1000 à 1999',
};
export const trancheLib = t => TRANCHES[t] ?? 'inconnu';

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function getJson(url, tries = 3) {
  for (let i = 0; ; i++) {
    const r = await fetch(url, { headers: { accept: 'application/json' } });
    if (r.ok) return r.json();
    if (i + 1 >= tries || ![429, 500, 502, 503, 504].includes(r.status)) throw new Error(`${new URL(url).host} : ${r.status}`);
    await sleep(1000 * (i + 1));
  }
}

const cap = s => String(s ?? '').toLowerCase().replace(/(^|[\s'-])\p{L}/gu, m => m.toUpperCase());
// the registry writes a married name as "NOM (NOM D'USAGE)" and hides some people as [NON-DIFFUSIBLE]
const person = d => ({ prenom: cap(String(d.prenoms ?? '').split(' ')[0]), nom: cap(String(d.nom ?? '').split(' (')[0]), qualite: d.qualite ?? '' });
const hidden = d => /diffusible/i.test(`${d.nom} ${d.prenoms}`) || /commissaire aux comptes/i.test(d.qualite ?? '');

// one result of the directory, reduced to what prospection uses
export function company(r) {
  const s = r.siege ?? {};
  const fin = Object.entries(r.finances ?? {}).sort(([a], [b]) => b.localeCompare(a))[0];
  const dirs = r.dirigeants ?? [];
  return {
    siren: r.siren,
    nom: cap(r.nom_raison_sociale || r.nom_complet),
    enseigne: s.liste_enseignes?.[0] ? cap(s.liste_enseignes[0]) : null,
    ville: cap(s.libelle_commune), cp: s.code_postal ?? '', departement: s.departement ?? '',
    naf: s.activite_principale ?? r.activite_principale ?? '',
    tranche: s.tranche_effectif_salarie ?? r.tranche_effectif_salarie ?? null,
    creation: r.date_creation ?? s.date_creation ?? null,
    ca: fin?.[1]?.ca ?? null, resultat: fin?.[1]?.resultat_net ?? null, annee: fin?.[0] ?? null,
    dirigeants: dirs.filter(d => d.type_dirigeant === 'personne physique' && !hidden(d)).map(person).filter((d, i, a) => a.findIndex(x => x.nom === d.nom && x.prenom === d.prenom) === i).slice(0, 3),
    holdings: dirs.filter(d => d.type_dirigeant === 'personne morale' && d.siren).map(d => ({ siren: d.siren, nom: cap(d.denomination), qualite: d.qualite ?? '' })).slice(0, 2),
  };
}

// criteria: { naf: ['43.32A'], departements: ['74'], tranches: ['11','12'], codes_postaux: [] }
export function searchUrl(c, page = 1) {
  const q = new URLSearchParams({ etat_administratif: 'A', per_page: '25', page: String(page) });
  if (c.naf?.length) q.set('activite_principale', c.naf.join(','));
  if (c.codes_postaux?.length) q.set('code_postal', c.codes_postaux.join(','));
  else if (c.departements?.length) q.set('departement', c.departements.join(','));
  if (c.tranches?.length) q.set('tranche_effectif_salarie', c.tranches.join(','));
  return `${DIR}?${q}`;
}

// Every company matching the criteria whose head office is in the area: a company
// based in Lyon with a branch in Annecy is not run from here.
export async function search(c, { onPage = () => {} } = {}) {
  if (!c.naf?.length) throw new Error("au moins un code d'activité");
  if (!c.departements?.length && !c.codes_postaux?.length) throw new Error('au moins un département ou un code postal');
  const out = [];
  let total = 0, pages = 1;
  for (let p = 1; p <= Math.min(pages, MAX_PAGES); p++) {
    const d = await getJson(searchUrl(c, p));
    total = d.total_results ?? 0; pages = d.total_pages ?? 1;
    for (const r of d.results ?? []) {
      const s = r.siege ?? {};
      const local = c.codes_postaux?.length ? c.codes_postaux.includes(s.code_postal) : c.departements.includes(s.departement);
      if (local) out.push(company(r));
    }
    onPage({ page: p, pages: Math.min(pages, MAX_PAGES), total });
    await sleep(PAUSE_MS);
  }
  return { total, tronque: pages > MAX_PAGES, entreprises: out };
}

// the people behind a holding that runs the company
export async function holdingPeople(siren) {
  const d = await getJson(`${DIR}?q=${encodeURIComponent(siren)}&per_page=1`);
  await sleep(PAUSE_MS);
  const r = (d.results ?? []).find(x => x.siren === siren);
  return r ? company(r).dirigeants : [];
}

// BODACC: a collective procedure (receivership, liquidation) in the last three years
// rules the company out; recent changes are moments worth writing about.
const MOMENTS = [
  [/modification de l'administration/i, 'Changement de dirigeant'],
  [/nouveau siège|transfert du siège/i, 'Nouveau siège'],
  [/fusion/i, 'Fusion'],
  [/création d'établissement|établissement secondaire/i, 'Nouvel établissement'],
];
export function readNotices(records, now = new Date()) {
  const ago = months => new Date(now.getFullYear(), now.getMonth() - months, now.getDate()).toISOString().slice(0, 10);
  const procedure = records.find(x => /collective/i.test(x.familleavis_lib ?? '') && (x.dateparution ?? '') >= ago(36));
  const moments = [];
  for (const x of records) {
    if ((x.dateparution ?? '') < ago(18)) continue;
    const famille = x.familleavis_lib ?? '';
    let texte = '';
    try { texte = JSON.parse(x.modificationsgenerales ?? '{}').descriptif ?? ''; } catch { texte = String(x.modificationsgenerales ?? ''); }
    const found = /cession/i.test(famille) ? 'Rachat ou cession de fonds' : MOMENTS.find(([re]) => re.test(texte))?.[1];
    if (found && !moments.some(m => m.quoi === found)) moments.push({ quoi: found, date: x.dateparution, source: 'BODACC' });
  }
  return { procedure: procedure ? { date: procedure.dateparution, quoi: procedure.familleavis_lib } : null, moments };
}

export async function notices(siren, now) {
  const q = new URLSearchParams({ where: `registre="${siren}" and familleavis_lib!="Dépôts des comptes"`, order_by: 'dateparution desc', limit: '30' });
  const d = await getJson(`${BODACC}?${q}`);
  await sleep(PAUSE_MS);
  return readNotices(d.results ?? [], now);
}
