// Waalaxy, the LinkedIn sender. Its API only lists prospect lists and campaigns and adds
// prospects (by LinkedIn URL) to a list and optionally a campaign; it reads nothing back.
// The key sits in credentials/waalaxy.json, as raw text or {"apiKey": "..."}.
import fs from 'node:fs';

const API = 'https://developers.waalaxy.com';

export function makeWaalaxy(file, { fetchImpl = fetch } = {}) {
  const key = () => {
    try {
      const raw = fs.readFileSync(file, 'utf8').trim();
      try { const j = JSON.parse(raw); return j.apiKey || j.key || null; } catch { return raw || null; }
    } catch { return null; }
  };
  async function call(method, p, body) {
    const k = key();
    if (!k) throw new Error('clé Waalaxy absente (credentials/waalaxy.json)');
    const r = await fetchImpl(API + p, { method, headers: { Authorization: `Bearer ${k}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const text = await r.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    if (!r.ok) throw new Error(`Waalaxy ${p} : ${r.status} ${data?.detail ?? data?.title ?? String(text).slice(0, 200)}`);
    return data;
  }
  return {
    actif: () => !!key(),
    async listes() { return (await call('GET', '/prospectLists/getProspectLists')).map(l => ({ id: l._id, nom: l.name, total: l.totalProspects ?? 0, ne_pas_contacter: !!l.doNotContact })); },
    async campagnes() { return ((await call('GET', '/campaigns/getAll')).campaigns ?? []).map(c => ({ id: c._id, nom: c.name })); },
    // returns, for each URL, whether it went in
    async ajouter(urls, { liste, campagne = null }) {
      if (!liste) throw new Error('choisis une liste Waalaxy');
      const out = [];
      for (let i = 0; i < urls.length; i += 20) {
        const part = urls.slice(i, i + 20);
        const r = await call('POST', '/prospects/addProspectFromIntegration', {
          prospects: part.map(url => ({ url })), prospectListId: liste, ...(campagne ? { campaignId: campagne } : {}), origin: { name: 'alpes-os' },
        });
        (r.result ?? []).forEach((x, j) => out.push({ url: part[j], ok: ['success', 'duplicated_prospect'].includes(x.importCode), code: x.importCode, campagne: x.addToCampaignCode ?? null }));
      }
      return out;
    },
  };
}
