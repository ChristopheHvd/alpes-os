// A campaign: one per target, a sequence of steps over three channels.
// - linkedin: Waalaxy sends it. AlpesOS only pushes the profiles into the Waalaxy
//   campaign and keeps the texts to copy into its sequence.
// - email: AlpesOS sends it from the Infomaniak mailbox, under the daily cap.
// - appel: it lands in the calls of the day.
// Each step has a day offset from the day the prospect entered the campaign. A step
// the prospect has no channel for is skipped; any reply ends the sequence.

export const CANAUX = ['linkedin', 'email', 'appel'];
export const OPT_OUT = 'Pour ne plus recevoir mes messages, répondez « stop ».';

export const etapesParDefaut = () => [
  { id: 'e1', canal: 'linkedin', titre: 'Invitation LinkedIn', delai: 0, objet: '', texte: '' },
  { id: 'e2', canal: 'email', titre: 'Premier e-mail', delai: 2, objet: '', texte: '' },
  { id: 'e3', canal: 'linkedin', titre: 'Premier message LinkedIn', delai: 4, objet: '', texte: '' },
  { id: 'e4', canal: 'email', titre: 'E-mail avec la ressource', delai: 9, objet: '', texte: '' },
  { id: 'e5', canal: 'appel', titre: 'Appel', delai: 12, objet: '', texte: '' },
  { id: 'e6', canal: 'email', titre: 'Dernier message', delai: 18, objet: '', texte: '' },
];

const clean = (v, max) => String(v ?? '').replace(/\r/g, '').trim().slice(0, max);
export function etapes(list) {
  const out = (Array.isArray(list) ? list : []).slice(0, 10).map((e, i) => {
    if (!CANAUX.includes(e.canal)) throw new Error(`canal inconnu : ${e.canal}`);
    const delai = Math.max(0, Math.min(90, Math.round(Number(e.delai) || 0)));
    return { id: /^e\d+$/.test(e.id) ? e.id : `e${i + 1}`, canal: e.canal, titre: clean(e.titre, 80) || `Étape ${i + 1}`, delai, objet: clean(e.objet, 160), texte: clean(e.texte, 3000) };
  });
  if (!out.length) throw new Error('au moins une étape');
  const ids = new Set();
  for (const e of out) { while (ids.has(e.id)) e.id = `e${Number(e.id.slice(1)) + 1}`; ids.add(e.id); }
  return out.sort((a, b) => a.delai - b.delai);
}

// An address can be mailed once it was read somewhere; a guessed one only once verified.
export const emailEnvoyable = c => !!c?.email && (c.email_type !== 'deduit' || c.email_verifie === true);
export const canaux = e => ({ email: emailEnvoyable(e.contact), linkedin: !!e.contact?.linkedin, appel: !!e.contact?.telephone });

// The words a template can use. {bonjour} greets the boss by name when the address is
// theirs, and asks to pass the message on when it is the company's shared address.
export function variables(e, cible) {
  const d = e.dirigeants?.[0];
  const prenom = d?.prenom ?? '', nom = d?.nom ?? '';
  const perso = e.contact?.email_type === 'nominatif' || e.contact?.email_type === 'deduit';
  const bonjour = perso && prenom ? `Bonjour ${prenom},` : prenom ? `Bonjour, pourriez-vous transmettre ce message à ${prenom} ${nom} ?` : 'Bonjour,';
  return { prénom: prenom, prenom, nom, entreprise: e.enseigne || e.nom, ville: e.ville ?? '', bonjour, moment: e.signaux?.[0]?.quoi?.toLowerCase() ?? '', lien: cible.lien ?? '' };
}
export const remplir = (t, vars) => String(t ?? '').replace(/\{(prénom|prenom|nom|entreprise|ville|bonjour|moment|lien)\}/g, (m, k) => vars[k] ?? '');

export function emailDe(etape, e, cible) {
  const vars = variables(e, cible);
  const perso = e.prospect?.perso?.[etape.id];
  let body = remplir(perso?.texte ?? etape.texte, vars).replace(/\n{3,}/g, '\n\n').trim();
  if (!/stop/i.test(body)) body += `\n\n${OPT_OUT}`;
  return { to: e.contact.email, subject: remplir(perso?.objet ?? etape.objet, vars).trim() || `${vars.entreprise}`, body };
}

const jour = d => new Date(d).toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });
const plus = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// Who takes part: kept companies reachable on at least one channel the sequence uses,
// minus the excluded.
export function participants(cible, estExclue = () => false) {
  const used = new Set(cible.campagne.etapes.map(e => e.canal));
  return cible.entreprises.filter(e => e.etat === 'retenue' && !estExclue(e) && Object.entries(canaux(e)).some(([k, v]) => v && used.has(k)));
}

// What is due today for one prospect: the steps whose day has come, not done yet,
// on a channel it has. At most one e-mail a day per prospect, the oldest first.
export function aFaire(cible, e, today = jour(new Date())) {
  const p = e.prospect;
  if (!p || p.statut !== 'en_sequence') return [];
  const ch = canaux(e), done = new Set((p.faits ?? []).map(f => f.etape));
  const due = cible.campagne.etapes.filter(s => !done.has(s.id) && ch[s.canal] && plus(p.depart, s.delai) <= today && (!p.reporte?.[s.id] || p.reporte[s.id] <= today));
  const mail = due.find(s => s.canal === 'email');
  return [...(mail ? [mail] : []), ...due.filter(s => s.canal === 'appel')];
}

// The sequence is over for a prospect once every step it can receive is done, or the
// last step's day is two weeks past.
export function fini(cible, e, today = jour(new Date())) {
  const p = e.prospect, ch = canaux(e), done = new Set((p?.faits ?? []).map(f => f.etape));
  const restant = cible.campagne.etapes.filter(s => ch[s.canal] && s.canal !== 'linkedin' && !done.has(s.id));
  const dernier = Math.max(...cible.campagne.etapes.map(s => s.delai));
  return (!restant.length && (ch.email || ch.appel)) || plus(p.depart, dernier + 14) < today;
}

export { jour, plus };
