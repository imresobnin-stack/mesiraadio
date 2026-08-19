/**
 * Mesiraadio — "praegu mängib" proksi Worker.
 *
 * Miks see olemas on: brauser ei saa enamiku raadiojaamade API-sid otse
 * lugeda (CORS — jaama server ei luba võõralt domeenilt vastust lugeda).
 * See Worker teeb päringu jaama poolt serveri poolelt (kus CORS ei kehti)
 * ja tagastab tulemuse koos loaga, mida brauser aktsepteerib.
 *
 * Vahemälu: iga vastus jääb Cloudflare'i servasse ~18 sekundiks (veidi alla
 * lehe 20s pollimisintervalli). Kui mitu kuulajat kuulavad samal ajal sama
 * jaama, jagavad nad sama vahemällu jäänud vastust — Worker käivitub siis
 * ainult üks kord kõigi nende jaoks selle akna sees, mis hoiab päevalimiidi
 * (tasuta pakett: 100 000 päringut/päevas) kordades kauem vastu.
 *
 * Kasutus lehelt:
 *   GET /track?station=<nimi>&url=<striimi-URL>
 *   -> {"station":"<nimi>","track":"Artist - Pealkiri"}  või {"track":null}
 *
 * Tuntud jaamade jaoks (NOWPLAYING) kasutatakse nende endi API-t
 * (radio.co / AzuraCast / Radiojar / konkreetne Icecast-mount).
 * Kõigi teiste jaoks proovitakse üldist Icecast2 status-json.xsl otspunkti,
 * mis töötab paljudel (mitte kõigil) tavalistel Icecast-serveritel.
 */

// Vaheta oma domeeniga (ilma lõpu-kaldkriipsuta) — CORS luba antakse ainult sellele.
const ALLOWED_ORIGIN = 'https://raadio.imresobnin.com';

// Vahemälu eluiga sekundites — hoia see veidi ALLA lehe pollimisintervalli (20s).
const CACHE_TTL = 18;

const NOWPLAYING = {
  'doubleclap':          { type: 'radioco',  id: 'scfd7273b2' },
  'finest fm':            { type: 'radioco',  id: 'sadb37cbdb' },
  'ruut fm':              { type: 'azura',    base: 'https://a1.asurahosting.com',    station: 'ruut_fm' },
  'hps bassline':         { type: 'azura',    base: 'https://azura.hpsbassline.club', station: 'haapsaly_bassline' },
  'hardcore predictor':   { type: 'azura',    base: 'https://azura.hpsbassline.club', station: 'hardcore_predictorfm' },
  'tunitemusic':          { type: 'radiojar', id: '6x51bmzpfy3vv' },
  'ring fm':              { type: 'icecast',  base: 'https://cdn.treraadio.ee',       mount: '/ringfm' },
  'tre raadio':           { type: 'icecast',  base: 'https://cdn.treraadio.ee',       mount: '/pohja-tre' },
};

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

async function fetchJson(url, timeoutMs) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs || 6000);
  try {
    const r = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'Mesiraadio-NowPlaying/1.0' } });
    clearTimeout(t);
    if (!r.ok) return null;
    return await r.json();
  } catch (e) {
    clearTimeout(t);
    return null;
  }
}

async function trackFromCuratedConfig(cfg) {
  if (cfg.type === 'radioco') {
    const d = await fetchJson(`https://public.radio.co/stations/${cfg.id}/status`);
    return (d && d.current_track && d.current_track.title) || null;
  }
  if (cfg.type === 'azura') {
    const d = await fetchJson(`${cfg.base}/api/nowplaying/${cfg.station}`);
    return (d && d.now_playing && d.now_playing.song && d.now_playing.song.text) || null;
  }
  if (cfg.type === 'radiojar') {
    const d = await fetchJson(`https://www.radiojar.com/api/stations/${cfg.id}/now_playing/`);
    if (!d) return null;
    if (d.artist && d.title) return `${d.artist} - ${d.title}`;
    return d.title || null;
  }
  if (cfg.type === 'icecast') {
    const d = await fetchJson(`${cfg.base}/status-json.xsl`);
    let srcs = d && d.icestats && d.icestats.source;
    if (!srcs) return null;
    if (!Array.isArray(srcs)) srcs = [srcs];
    const s = srcs.find(x => (x.listenurl || '').endsWith(cfg.mount));
    return (s && (s.title || s.yp_currently_playing)) || null;
  }
  return null;
}

async function trackFromGenericIcecast(streamUrl) {
  let u;
  try { u = new URL(streamUrl); } catch (e) { return null; }
  const base = `${u.protocol}//${u.host}`;
  const d = await fetchJson(`${base}/status-json.xsl`);
  let srcs = d && d.icestats && d.icestats.source;
  if (!srcs) return null;
  if (!Array.isArray(srcs)) srcs = [srcs];
  const mount = u.pathname;
  const chosen = srcs.find(x => (x.listenurl || '').endsWith(mount)) || (srcs.length === 1 ? srcs[0] : null);
  if (!chosen) return null;
  const title = chosen.title || chosen.yp_currently_playing;
  return title ? String(title).trim() || null : null;
}

async function resolveTrack(name, streamUrl) {
  const cfg = NOWPLAYING[name];
  try {
    if (cfg) {
      const t = await trackFromCuratedConfig(cfg);
      if (t) return t;
    }
    if (streamUrl) {
      return await trackFromGenericIcecast(streamUrl);
    }
  } catch (e) {
    return null;
  }
  return null;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    if (url.pathname !== '/track') {
      return new Response('Mesiraadio now-playing worker', { status: 200, headers: corsHeaders() });
    }

    const name = url.searchParams.get('station') || '';
    const streamUrl = url.searchParams.get('url') || '';
    if (!name) {
      return new Response(JSON.stringify({ error: 'missing station' }), {
        status: 400,
        headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
      });
    }

    // Serva vahemälu: sama URL (sama station+url) jagab vastust kõigi
    // kuulajate vahel, kes küsivad sama jaama sama akna sees.
    const cache = caches.default;
    const cacheKey = new Request(url.toString(), request);
    const cached = await cache.match(cacheKey);
    if (cached) return cached;

    const track = await resolveTrack(name, streamUrl);
    const body = JSON.stringify({ station: name, track: track || null });
    const response = new Response(body, {
      headers: {
        ...corsHeaders(),
        'Content-Type': 'application/json',
        'Cache-Control': `public, max-age=${CACHE_TTL}`,
      },
    });

    ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  },
};
