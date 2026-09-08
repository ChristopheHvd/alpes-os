// Upcoming events from Google Calendar, through the same OAuth client as Gmail.
// Read-only. The extra scope means the account has to be authorised once more;
// hasScope() tells the dashboard whether that is still pending.
export function makeCalendar(getToken, hasScope) {
  const API = 'https://www.googleapis.com/calendar/v3';

  async function api(p, params = {}) {
    const token = await getToken();
    const r = await fetch(`${API}${p}?${new URLSearchParams(params)}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error(`Calendar ${p}: ${r.status} ${(await r.text()).slice(0, 200)}`);
    return r.json();
  }

  return {
    async upcoming({ days = 7, max = 12 } = {}) {
      if (!hasScope()) return { needsScope: true, events: [] };
      const now = new Date();
      const end = new Date(now.getTime() + days * 864e5);
      const { items = [] } = await api('/calendars/primary/events', {
        timeMin: now.toISOString(), timeMax: end.toISOString(),
        singleEvents: 'true', orderBy: 'startTime', maxResults: String(max),
      });
      return {
        events: items
          .filter(e => e.status !== 'cancelled')
          .map(e => ({
            id: e.id,
            title: e.summary ?? '(sans titre)',
            start: e.start?.dateTime ?? e.start?.date,
            end: e.end?.dateTime ?? e.end?.date,
            allDay: !e.start?.dateTime,
            location: e.location ?? '',
            attendees: (e.attendees ?? []).filter(a => !a.self).map(a => a.displayName || a.email).slice(0, 6),
            url: e.htmlLink,
          })),
      };
    },
  };
}
