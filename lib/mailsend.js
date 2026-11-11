// What AlpesOS sent itself from the mailbox, and the addresses that bounced.
// Kept in output/mail-sent.json so the daily cap holds across restarts, and so a
// bounced address is never mailed again. Sending is for prospection: a few cold
// mails a day, plain text, one recipient each — never a mass mailing.
import fs from 'node:fs';
import path from 'node:path';

const empty = () => ({ sent: [], bounces: {}, scanned: [] });
const ADDR = /^[^\s@<>,;]+@[^\s@<>,;]+\.[a-z]{2,}$/i;
// the cap counts days as the user lives them, not in UTC
const day = d => new Date(d).toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });

export function makeSendLog(file, { cap = 15, now = () => new Date() } = {}) {
  const read = () => {
    try { if (fs.existsSync(file)) return { ...empty(), ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch (e) { /* start clean */ }
    return empty();
  };
  const write = s => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file + '.tmp', JSON.stringify(s, null, 1));
    fs.renameSync(file + '.tmp', file);
  };
  const mutate = fn => { const s = read(); const out = fn(s); write(s); return out; };

  // a failed call the API answered with an error sent nothing; anything else counts
  const sentToday = s => s.sent.filter(e => e.status !== 'echec' && day(e.at) === day(now())).length;

  return {
    cap,
    get: () => read(),
    remaining: () => Math.max(0, cap - sentToday(read())),
    isBounced: addr => !!read().bounces[String(addr).trim().toLowerCase()],

    // throws with the reason a send must not go out; records it as started otherwise
    start({ to, subject }) {
      const addr = String(to ?? '').trim().toLowerCase();
      if (!ADDR.test(addr)) throw new Error(`une seule adresse valide par envoi : « ${to} »`);
      return mutate(s => {
        if (s.bounces[addr]) throw new Error(`${addr} a déjà rebondi (${s.bounces[addr].reason || 'adresse invalide'}) : envoi refusé`);
        if (sentToday(s) >= cap) throw new Error(`plafond du jour atteint (${cap} envois) : réessaie demain`);
        const entry = { to: addr, subject: String(subject ?? ''), at: now().toISOString(), status: 'envoi' };
        s.sent.push(entry);
        s.sent = s.sent.slice(-2000);
        return entry.at;
      });
    },
    finish(at, to, patch) {
      mutate(s => { const e = s.sent.find(e => e.at === at && e.to === String(to).trim().toLowerCase()); if (e) Object.assign(e, patch); });
    },

    // the hook bounce detection (or the prospection module) calls
    recordBounce(addr, { reason = '', at = now().toISOString(), source = '' } = {}) {
      const key = String(addr ?? '').trim().toLowerCase();
      if (!ADDR.test(key)) return false;
      mutate(s => { s.bounces[key] = { at, reason: String(reason).slice(0, 300), ...(source ? { source } : {}) }; });
      return true;
    },
    // ids of bounce notices already read, so a scan does not read them again
    scanned: () => new Set(read().scanned),
    markScanned(ids) { mutate(s => { s.scanned = [...new Set([...s.scanned, ...ids])].slice(-500); }); },
  };
}

// A delivery failure notice (DSN) and the recipients it reports, or null.
// Works on what the mail API gives: lower-cased headers and the plain text body.
const BOUNCE_FROM = /^(mailer-daemon|postmaster|mail-daemon|mailerdaemon)@/i;
const BOUNCE_SUBJECT = /(undeliver|undelivered|delivery status notification|delivery failure|delivery has failed|mail delivery failed|returned mail|non remis|non distribu|échec de (la )?(remise|distribution)|impossible de remettre)/i;
export function bounceOf({ from = '', subject = '', headers = {}, body = '' }, { self = '' } = {}) {
  const h = n => [headers[n]].flat().filter(Boolean).join(' ');
  const addr = (String(from).match(/<([^>]+)>/)?.[1] ?? String(from)).trim();
  const report = /multipart\/report/i.test(h('content-type')) && /delivery-status/i.test(h('content-type'));
  if (!report && !BOUNCE_FROM.test(addr) && !BOUNCE_SUBJECT.test(subject)) return null;
  const text = String(body);
  const found = new Set();
  for (const a of h('x-failed-recipients').split(/[,\s]+/)) if (a) found.add(a);
  for (const m of text.matchAll(/(?:Final|Original)-Recipient:\s*rfc822;\s*<?([^\s>]+)>?/gi)) found.add(m[1]);
  // Postfix and Exchange quote the failed address on its own line: <a@b>: reason
  if (!found.size) for (const m of text.matchAll(/^\s*<([^>\s]+@[^>\s]+)>\s*:/gm)) found.add(m[1]);
  const me = String(self).toLowerCase();
  const recipients = [...found].map(a => a.toLowerCase()).filter(a => ADDR.test(a) && a !== me);
  if (!recipients.length) return null;
  const reason = (text.match(/Diagnostic-Code:\s*(?:smtp;\s*)?(.+)/i)?.[1] ?? text.match(/Status:\s*([45]\.\d+\.\d+)/i)?.[1] ?? subject).trim();
  // a 4.x.x status is a delay notice, not a failure: the server keeps trying
  if (/^4\.\d+\.\d+$/.test(text.match(/Status:\s*([45]\.\d+\.\d+)/i)?.[1] ?? '') && !/5\.\d+\.\d+/.test(text)) return null;
  return { recipients, reason: reason.slice(0, 300) };
}
