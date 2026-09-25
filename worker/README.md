# Mesiraadio "praegu mängib" Worker

CORS-proksi + serva-vahemäluga Cloudflare Worker, mis laseb lehel küsida
loo nime peaaegu igalt raadiojaamalt, mitte ainult neilt 8-lt, mille
API juhtumisi lubas otse brauserist küsida.

## Kuidas see töötab

1. Leht (`index.html`) küsib iga 20 sekundi järel: `GET /track?station=<nimi>&url=<striimi-URL>`
2. Worker teeb vastuse päringu **enda poolt** (server-server, kus CORS ei kehti)
3. Tuntud jaamadele (radio.co / AzuraCast / Radiojar / kindel Icecast-mount)
   kasutatakse nende endi API-t — sama nimekiri, mis varem oli otse lehel
4. Kõigi teiste jaoks proovitakse jaama enda serverilt üldist
   `status-json.xsl` otspunkti (töötab paljudel, mitte kõigil, tavalistel
   Icecast2-serveritel)
5. Vastus jääb Cloudflare'i servasse **18 sekundiks** — kui mitu kuulajat
   kuulavad samal ajal sama jaama, jagavad nad üht vastust, mitte ei
   käivita Workerit iga kuulaja kohta eraldi

## Deploy — käsurealt (wrangler)

Vajad Node.js-i ja `npm`-i.

```bash
cd worker
npm install -g wrangler        # kui pole veel paigaldatud
wrangler login                 # avab brauseris Cloudflare'i sisselogimise
wrangler deploy
```

Käivituse lõpus näitab wrangler sinu Workeri URL-i, midagi sellist:
```
https://mesiraadio-nowplaying.<sinu-subdomeen>.workers.dev
```

## Deploy — Cloudflare'i veebis (ilma terminalita)

1. [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages**
2. **Create** → **Workers** → **Create Worker**
3. Anna nimeks `mesiraadio-nowplaying` → **Deploy** (paigaldab tühja näidise)
4. **Edit code** → kustuta kogu sisu → kleebi `nowplaying-worker.js` sisu → **Deploy**

## Pärast deployi: ühenda leht Workeriga

Kopeeri oma Workeri URL (lõpus `/track`) ja pane see `index.html`-i:

```js
const NOWPLAYING_WORKER = 'https://mesiraadio-nowplaying.YOUR-SUBDOMAIN.workers.dev/track';
```

See rida asub faili keskel, kommentaari all `/* "Praegu mängib" — läbi Cloudflare Workeri */`.

## Kontroll

Ava brauseris otse:
```
https://mesiraadio-nowplaying.<sinu-subdomeen>.workers.dev/track?station=vikerraadio&url=https://icecast.err.ee/vikerraadio.mp3
```
(pane `url=` väärtuseks Vikerraadio päris striimi-URL index.html-ist)

Peaksid nägema midagi sellist:
```json
{"station":"vikerraadio","track":"Eesti Raadio - Uudised"}
```
või `{"station":"vikerraadio","track":null}`, kui see konkreetne jaam
üldist Icecast-otspunkti ei toeta — see on normaalne, mitte viga.

## CORS-domeen

Fail eeldab, et leht on aadressil `https://raadio.imresobnin.com`. Kui
domeen muutub, uuenda `nowplaying-worker.js` alguses rida:
```js
const ALLOWED_ORIGIN = 'https://raadio.imresobnin.com';
```

## Uute jaamade lisamine kuraaditud nimekirja

Kui leiad jaama, mis kasutab radio.co/AzuraCast/Radiojar/Icecast API-t,
aga üldine `status-json.xsl` proov ei tööta (nt jaam kasutab teistsugust
mounti või serverit kui striimi-URL ise), lisa see `NOWPLAYING`
objekti `nowplaying-worker.js` alguses — sama struktuur, mis lehel
varem oli.
