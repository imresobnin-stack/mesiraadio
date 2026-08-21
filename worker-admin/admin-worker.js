/**
 * Mesiraadio admin — jaamade käsitsi ülekirjutuste Worker.
 *
 * Kaks "ust" samale KV-andmehulgale:
 *
 *   GET  /overrides.json        — AVALIK, ei nõua sisselogimist.
 *                                  check_stations.py loeb siit iga käivituse
 *                                  alguses, et rakendada sinu käsitsi otsused
 *                                  enne status.json kirjutamist.
 *
 *   GET  /admin/api/overrides   — KAITSTUD (Cloudflare Access peab olema
 *   POST /admin/api/overrides     seatud teele raadio.imresobnin.com/admin*).
 *                                  admin.html kasutab neid kahte.
 *
 * Andmed hoitakse KV-s ühe JSON-plokina võtme "overrides" all:
 *   { "vikerraadio": {"override":"ok","updated_at":"2026-08-20T..."}, ... }
 *
 * "override" väärtus on kas "ok" (sunni alati töötavaks), "down" (sunni
 * alati "Võimalikud ühendusprobleemid" märkega) või jaam puudub objektist
 * üldse, kui käsitsi märget pole (automaatkontroll otsustab tavapäraselt).
 */

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

async function loadOverrides(env) {
  const raw = await env.OVERRIDES.get('overrides');
  return raw ? JSON.parse(raw) : {};
}

async function saveOverrides(env, data) {
  await env.OVERRIDES.put('overrides', JSON.stringify(data));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    // ---------- avalik, ainult lugemiseks (check_stations.py jaoks) ----------
    if (path === '/overrides.json') {
      if (request.method !== 'GET') return json({ error: 'Meetod pole lubatud' }, 405);
      return json(await loadOverrides(env));
    }

    // ---------- kaitstud admin API (Cloudflare Access teel /admin* peal) ----------
    if (path === '/admin/api/overrides') {
      if (request.method === 'GET') {
        return json(await loadOverrides(env));
      }

      if (request.method === 'POST') {
        let body;
        try {
          body = await request.json();
        } catch (e) {
          return json({ error: 'Vigane JSON päringu kehas' }, 400);
        }
        const { station, override } = body || {};
        if (!station || typeof station !== 'string') {
          return json({ error: 'Väli "station" puudub' }, 400);
        }
        if (override !== 'ok' && override !== 'down' && override !== null && override !== undefined) {
          return json({ error: 'Väli "override" peab olema "ok", "down" või puuduma (tühistamiseks)' }, 400);
        }

        const data = await loadOverrides(env);
        if (!override) {
          delete data[station];
        } else {
          data[station] = { override, updated_at: new Date().toISOString() };
        }
        await saveOverrides(env, data);
        return json({ ok: true, station, override: override || null });
      }

      return json({ error: 'Meetod pole lubatud' }, 405);
    }

    return new Response('Mesiraadio admin worker', { status: 200 });
  },
};
