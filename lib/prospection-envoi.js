// The campaign clock: every few minutes on working days and hours, it sends the e-mails
// that are due and closes the sequences that are over. It only runs for launched
// campaigns: the launch is Christophe's click that authorises these sends.
import * as cp from './campagne.js';

const heureParis = d => Number(new Date(d).toLocaleString('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', hour12: false }));
export const ouvert = (d = new Date()) => { const j = new Date(d).getDay(); const h = heureParis(d); return j >= 1 && j <= 5 && h >= 8 && h < 18; };

export async function tick({ prospection, mail, now = new Date(), log = () => {} }) {
  const today = cp.jour(now), fait = { envoyes: 0, termines: 0, erreurs: 0 };
  for (const c of prospection.lister()) {
    if (c.campagne?.etat !== 'en_cours') continue;
    for (const e of c.entreprises) {
      if (e.prospect?.statut !== 'en_sequence') continue;
      if (prospection.estExclue(e)) { prospection.statut(c.slug, e.siren, 'exclu'); continue; }
      if (cp.fini(c, e, today)) { prospection.statut(c.slug, e.siren, 'termine'); fait.termines++; continue; }
      const step = cp.aFaire(c, e, today).find(s => s.canal === 'email');
      if (!step || mail.sendsLeft() <= 0) continue;
      if (mail.isBounced?.(e.contact.email)) { prospection.noter(c.slug, e.siren, { etape: step.id, canal: 'email', status: 'rebond', to: e.contact.email }); continue; }
      const m = cp.emailDe(step, e, c);
      try {
        const r = await mail.send(m, { confirmed: true });
        prospection.noter(c.slug, e.siren, { etape: step.id, canal: 'email', status: 'envoye', to: m.to, sujet: m.subject, id: r.id });
        fait.envoyes++;
      } catch (err) {
        // the cap or a refusal: nothing went out, try again on the next pass or day
        if (/plafond/.test(err.message)) return fait;
        if (/rebondi/.test(err.message)) prospection.noter(c.slug, e.siren, { etape: step.id, canal: 'email', status: 'rebond', to: m.to });
        else { log(`prospection : envoi à ${m.to} en échec : ${err.message}`); prospection.reporter(c.slug, e.siren, step.id, cp.plus(today, 1)); }
        fait.erreurs++;
      }
    }
  }
  return fait;
}
