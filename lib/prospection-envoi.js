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
    for (const { siren } of c.entreprises) {
      // read again before each prospect: a pause, a reply or a choice may have come meanwhile
      const fresh = prospection.get(c.slug), e = fresh.entreprises.find(x => x.siren === siren);
      if (fresh.campagne?.etat !== 'en_cours') break;
      if (e?.prospect?.statut !== 'en_sequence') continue;
      if (e.etat !== 'retenue' || prospection.estExclue(e)) { prospection.statut(c.slug, e.siren, 'exclu'); continue; }
      if (cp.fini(fresh, e, today)) { prospection.statut(c.slug, e.siren, 'termine'); fait.termines++; continue; }
      const step = cp.aFaire(fresh, e, today).find(s => s.canal === 'email');
      if (!step || mail.sendsLeft() <= 0) continue;
      if (mail.isBounced?.(e.contact.email)) { prospection.noter(c.slug, e.siren, { etape: step.id, canal: 'email', status: 'rebond', to: e.contact.email }); continue; }
      const m = cp.emailDe(step, e, fresh);
      try {
        const r = await mail.send(m, { confirmed: true });
        prospection.noter(c.slug, e.siren, { etape: step.id, canal: 'email', status: 'envoye', to: m.to, sujet: m.subject, id: r.id });
        fait.envoyes++;
      } catch (err) {
        // the cap or a refusal: nothing went out, try again on the next pass or day
        if (/plafond/.test(err.message)) return fait;
        if (/rebondi/.test(err.message)) prospection.noter(c.slug, e.siren, { etape: step.id, canal: 'email', status: 'rebond', to: m.to });
        // the API said no: nothing went out, try tomorrow. No answer at all: it may have
        // gone out, so the step counts as done rather than risk sending it twice.
        else if (err.status) { log(`prospection : envoi à ${m.to} refusé : ${err.message}`); prospection.reporter(c.slug, e.siren, step.id, cp.plus(today, 1)); }
        else { log(`prospection : envoi à ${m.to} incertain : ${err.message}`); prospection.noter(c.slug, e.siren, { etape: step.id, canal: 'email', status: 'incertain', to: m.to }); }
        fait.erreurs++;
      }
    }
  }
  return fait;
}
