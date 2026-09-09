// Sorts inbox threads into three buckets, because Gmail's own "important" flag
// tracks its classifier, not what actually needs an answer.
//
//   personne  — a human wrote it, or a known contact did
//   auto      — a machine sent it: invoices, reminders, alerts, receipts
//   bulk      — a mailing list: newsletters, campaigns, promotions
//
// The bulk test is header-based and near-certain (List-Unsubscribe, Precedence,
// List-Id). The auto test reads the sender's local part. Known contacts pulled
// from the second brain always win, whatever the headers say.
import fs from 'node:fs';
import path from 'node:path';

const ROLE = /^(no-?reply|do-?not-?reply|noreply|notification|notifications|alert|alerts|alerte|alertes|reminder|reminders|mailer|mail|bounce|postmaster|news|newsletter|hello|team|team-|support|billing|facture|factures|invoice|automated|auto|robot|bot|digest|updates?|jobalerts[^@]*)$/i;
const SUBJECT_NOISE = /(newsletter|se d[ée]sabonner|d[ée]sabonnement|webinar|webinaire|offre sp[ée]ciale|promo(tion)?\b|soldes|black friday|\-\s?\d{1,2}\s?%|derni[èe]re chance|profitez|d[ée]couvrez nos|votre s[ée]lection)/i;
const HUMAN_SUBJECT = /^(re|r[ée]p|tr|fwd?|fw)\s*:/i;

// Emails and domains named anywhere in the second brain: clients, prospects, projects.
export function knownContacts(secondBrain) {
  const emails = new Set(), domains = new Set(), names = new Set();
  const walk = dir => {
    if (!fs.existsSync(dir)) return;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.name.startsWith('.')) continue;
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) { walk(p); continue; }
      if (!ent.name.endsWith('.md')) continue;
      const txt = fs.readFileSync(p, 'utf8');
      for (const m of txt.matchAll(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g)) {
        const e = m[0].toLowerCase();
        emails.add(e);
        const d = e.split('@')[1];
        if (!/gmail|outlook|hotmail|yahoo|icloud|free\.fr|orange\.fr|wanadoo/.test(d)) domains.add(d);
      }
      // titles of client and project concepts double as company names
      if (/\/(clients|projects)\//.test(p)) {
        const t = txt.match(/^title:\s*(.+)$/m)?.[1]?.trim();
        if (t) for (const part of t.replace(/[()]/g, ' ').split(/\s+/)) if (part.length > 3) names.add(part.toLowerCase());
      }
    }
  };
  walk(path.join(secondBrain, 'brain'));
  return { emails, domains, names };
}

export function classify(msg, { known, extra = {} }) {
  const h = n => msg.headers?.[n.toLowerCase()] ?? '';
  const from = h('from');
  const addr = (from.match(/<([^>]+)>/)?.[1] ?? from).trim().toLowerCase();
  const [local = '', domain = ''] = addr.split('@');
  const display = from.replace(/<.*>/, '').replace(/"/g, '').trim();
  const subject = h('subject');
  const reasons = [];

  const isKnown = known.emails.has(addr)
    || known.domains.has(domain)
    || [...known.names].some(n => display.toLowerCase().includes(n) || domain.includes(n));
  const allow = (extra.allow ?? []).some(p => addr.includes(p.toLowerCase()) || display.toLowerCase().includes(p.toLowerCase()));
  const deny = (extra.deny ?? []).some(p => addr.includes(p.toLowerCase()) || display.toLowerCase().includes(p.toLowerCase()));

  if (deny) { reasons.push('exclu par ta liste'); return { bucket: 'bulk', reasons, isKnown }; }
  if (allow) { reasons.push('dans ta liste prioritaire'); return { bucket: 'personne', reasons, isKnown: true }; }
  if (isKnown) reasons.push('contact connu du second brain');

  const bulkHeader = !!h('list-unsubscribe') || /bulk|list|junk/i.test(h('precedence')) || !!h('list-id') || !!h('x-campaign-id');
  const roleSender = ROLE.test(local) || /^(news|email|mail|e|mailing|marketing|campaign)[.-]/.test(domain) || /\bnoreply\b/.test(local);
  const autoHeader = /auto-(generated|replied|notified)/i.test(h('auto-submitted'));
  const noisySubject = SUBJECT_NOISE.test(subject);
  const conversation = (msg.threadCount ?? 1) > 1 || HUMAN_SUBJECT.test(subject);

  // a known contact stays a person even when their tooling adds bulk headers
  if (isKnown && !bulkHeader) return { bucket: 'personne', reasons, isKnown };
  if (bulkHeader || noisySubject) {
    reasons.push(bulkHeader ? 'en-têtes de liste de diffusion' : 'objet promotionnel');
    return { bucket: 'bulk', reasons, isKnown };
  }
  if (roleSender || autoHeader) {
    reasons.push(roleSender ? 'adresse automatique' : 'message auto-généré');
    return { bucket: 'auto', reasons, isKnown };
  }
  if (conversation) reasons.push('conversation en cours');
  return { bucket: 'personne', reasons, isKnown };
}

export const BUCKETS = ['personne', 'auto', 'bulk'];
