// The Infomaniak calendar, read through Infomaniak's API with a token that carries
// the workspace:calendar scope (credentials/infomaniak-calendar.json, {"token": "..."}).
// Dates go and come back as wall-clock times in Europe/Paris, like the official client.
import fs from 'node:fs';

const API = 'https://api.infomaniak.com/1/calendar/pim';
const wall = d => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(d);

export function makeInfomaniakCalendar(file, { fetchImpl = fetch } = {}) {
  const token = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')).token || null; } catch { return null; } };
  async function get(p) {
    const t = token();
    if (!t) throw new Error('credentials/infomaniak-calendar.json sans jeton');
    const r = await fetchImpl(API + p, { headers: { Authorization: `Bearer ${t}` } });
    const data = await r.json().catch(() => null);
    if (!r.ok || data?.result !== 'success') throw new Error(`agenda Infomaniak : ${r.status} ${data?.error?.description ?? ''}`.trim());
    return data.data;
  }
  return {
    actif: () => !!token(),
    async events({ pastDays = 7, days = 7 } = {}) {
      const now = Date.now();
      const from = wall(new Date(now - pastDays * 864e5)), to = wall(new Date(now + days * 864e5));
      const cals = (await get('/calendar')).calendars ?? [];
      const out = [];
      for (const c of cals) {
        const evs = await get(`/event?${new URLSearchParams({ calendar_id: c.id, from, to })}`).catch(() => []);
        for (const e of [evs].flat()) {
          if (!e || e.type === 'task') continue;
          out.push({
            calendar: c.name ?? 'Infomaniak', title: e.title ?? '(sans titre)', start: e.start ?? null, end: e.end ?? null,
            allDay: !!(e.fullday ?? e.full_day), location: e.location ?? '',
            attendees: (e.attendees ?? []).map(a => a.name || a.address || a.email).filter(Boolean).slice(0, 8),
          });
        }
      }
      return out.sort((a, b) => String(a.start).localeCompare(String(b.start)));
    },
  };
}
