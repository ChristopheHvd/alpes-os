// Upcoming events from Google Calendar, through the same OAuth client as Gmail.
// Read-only. The extra scope means the account has to be authorised once more;
// hasScope() tells the dashboard whether that is still pending.
//
// Which calendars are read is explicit in config (default: the primary one only).
// Invitations from family or friends land on the primary calendar, so what hides
// them is an organiser filter, not the calendar list — config.excludeOrganizers
// sets that permanently, and the dashboard's per-event "masquer" / "jamais"
// (lib/calendarstate.js) add to it live, the same way mail triage works.
export function makeCalendar(getToken, hasScope, opts = {}) {
  const API = 'https://www.googleapis.com/calendar/v3';
  const wanted = opts.calendars?.length ? opts.calendars : ['primary'];
  const staticExcluded = (opts.excludeOrganizers ?? []).map(s => s.toLowerCase());

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

  async function post(p, body) {
    const token = await getToken();
    const r = await fetch(`${API}${p}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`Calendar ${p}: ${r.status} ${(await r.text()).slice(0, 300)}`);
    return r.json();
  }

  return {
    async calendars() { return resolve(); },

    // Times are sent with an explicit timeZone so "mardi 14h" lands at 14h local,
    // whatever the server's own clock is set to.
    async createEvent({ title, start, end, durationMinutes = 60, description = '', location = '', attendees = [], calendarId = 'primary', timeZone = 'Europe/Paris' }) {
      if (!title || !start) throw new Error('titre et date de début requis');
      const startAt = new Date(start);
      if (Number.isNaN(startAt.getTime())) throw new Error(`date de début illisible : ${start}`);
      const endAt = end ? new Date(end) : new Date(startAt.getTime() + durationMinutes * 60000);
      const created = await post(`/calendars/${encodeURIComponent(calendarId)}/events`, {
        summary: title, description, location,
        start: { dateTime: startAt.toISOString(), timeZone },
        end: { dateTime: endAt.toISOString(), timeZone },
        attendees: attendees.filter(Boolean).map(email => ({ email })),
      });
      return { id: created.id, title: created.summary, start: created.start?.dateTime, end: created.end?.dateTime, url: created.htmlLink };
    },

    async upcoming({ days = 7, max = 12, excludeOrganizers = [], isHidden = () => false } = {}) {
      if (!hasScope()) return { needsScope: true, events: [] };
      const excluded = [...staticExcluded, ...excludeOrganizers.map(s => s.toLowerCase())];
      const isExcludedOrganizer = e => {
        const who = `${e.organizer?.email ?? ''} ${e.organizer?.displayName ?? ''}`.toLowerCase();
        return excluded.some(x => who.includes(x));
      };
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
      const all = batches.flat()
        .filter(e => e.status !== 'cancelled')
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
          organizerName: e.organizer?.displayName ?? '',
          attendees: (e.attendees ?? []).filter(a => !a.self).map(a => a.displayName || a.email).slice(0, 6),
          url: e.htmlLink,
        }))
        .sort((a, b) => String(a.start).localeCompare(String(b.start)));
      const events = all.filter(e => !isExcludedOrganizer(e) && !isHidden(e.id)).slice(0, max);
      return { events, calendars: cals.map(c => c.name) };
    },
  };
}
