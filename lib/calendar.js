// Upcoming events from Google Calendar, through the same OAuth client as Gmail.
// Read-only. The extra scope means the account has to be authorised once more;
// hasScope() tells the dashboard whether that is still pending.
//
// Which calendars are read is explicit in config (default: the primary one only).
// Invitations from family or friends land on the primary calendar, so a second
// filter drops events by organiser — that is what removes personal noise, not
// the calendar list.
export function makeCalendar(getToken, hasScope, opts = {}) {
  const API = 'https://www.googleapis.com/calendar/v3';
  const wanted = opts.calendars?.length ? opts.calendars : ['primary'];
  const excluded = (opts.excludeOrganizers ?? []).map(s => s.toLowerCase());

  async function api(p, params = {}) {
    const token = await getToken();
    const r = await fetch(`${API}${p}?${new URLSearchParams(params)}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error(`Calendar ${p}: ${r.status} ${(await r.text()).slice(0, 200)}`);
    return r.json();
  }

  // resolve the configured names or ids against the account's calendar list
  async function resolve() {
    const { items = [] } = await api('/users/me/calendarList');
    const out = [];
    for (const w of wanted) {
      if (w === 'primary') { const p = items.find(c => c.primary); out.push({ id: 'primary', name: p?.summary ?? 'principal' }); continue; }
      const hit = items.find(c => c.id === w || c.summary?.toLowerCase() === w.toLowerCase());
      if (hit) out.push({ id: hit.id, name: hit.summary });
    }
    return out.length ? out : [{ id: 'primary', name: 'principal' }];
  }

  const isExcluded = e => {
    const who = `${e.organizer?.email ?? ''} ${e.organizer?.displayName ?? ''}`.toLowerCase();
    return excluded.some(x => who.includes(x));
  };

  return {
    async calendars() { return resolve(); },

    async upcoming({ days = 7, max = 12 } = {}) {
      if (!hasScope()) return { needsScope: true, events: [] };
      const cals = await resolve();
      const now = new Date();
      const end = new Date(now.getTime() + days * 864e5);
      const batches = await Promise.all(cals.map(async c => {
        const { items = [] } = await api(`/calendars/${encodeURIComponent(c.id)}/events`, {
          timeMin: now.toISOString(), timeMax: end.toISOString(),
          singleEvents: 'true', orderBy: 'startTime', maxResults: String(max * 2),
        });
        return items.map(e => ({ ...e, _cal: c.name }));
      }));
      const seen = new Set();
      const events = batches.flat()
        .filter(e => e.status !== 'cancelled' && !isExcluded(e))
        // the same meeting can sit on two calendars, or be imported twice
        .filter(e => { const k = `${e.summary}@${e.start?.dateTime ?? e.start?.date}`; return seen.has(k) ? false : (seen.add(k), true); })
        .map(e => ({
          id: e.id,
          calendar: e._cal,
          title: e.summary ?? '(sans titre)',
          start: e.start?.dateTime ?? e.start?.date,
          end: e.end?.dateTime ?? e.end?.date,
          allDay: !e.start?.dateTime,
          location: e.location ?? '',
          organizer: e.organizer?.email ?? '',
          attendees: (e.attendees ?? []).filter(a => !a.self).map(a => a.displayName || a.email).slice(0, 6),
          url: e.htmlLink,
        }))
        .sort((a, b) => String(a.start).localeCompare(String(b.start)))
        .slice(0, max);
      return { events, calendars: cals.map(c => c.name) };
    },
  };
}
