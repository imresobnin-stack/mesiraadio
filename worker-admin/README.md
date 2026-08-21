# Mesiraadio admin — deploy-juhend

Kaitstud leht (`/admin.html`), kust näed kõiki jaamu, nende automaatset
tervisekontrolli seisu, ja saad iga jaama kohta öelda "usu mind, see
töötab" või "see on tegelikult maas" — see otsus jääb kehtima, kuni sa
selle ise tühistad, isegi kui igapäevane automaatkontroll midagi muud
arvaks.

Kolm osa, mis tuleb järjekorras üles seada: **KV** → **Worker** → **Access**.

## 1. Loo KV namespace (andmete hoidmiseks)

1. [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** → vasakul **KV**
2. **Create a namespace** → nimeks nt `mesiraadio-overrides` → **Add**
3. Kopeeri tekkinud **Namespace ID** (näed seda kohe pärast loomist)

## 2. Deploy Worker

### Käsurealt (wrangler)

```bash
cd worker-admin
npm install -g wrangler   # kui pole veel
wrangler login
```

Ava `wrangler.toml` ja asenda `REPLACE_WITH_YOUR_KV_NAMESPACE_ID` sammu 1
Namespace ID-ga. Seejärel:

```bash
wrangler deploy
```

### Cloudflare'i veebis (ilma terminalita)

1. **Workers & Pages** → **Create** → **Workers** → **Create Worker**
2. Nimeks `mesiraadio-admin` → **Deploy**
3. **Edit code** → kustuta näidissisu → kleebi `admin-worker.js` sisu → **Deploy**
4. Mine Workeri **Settings** → **Bindings** → **Add binding** → **KV Namespace**
   - Variable name: `OVERRIDES`
   - KV namespace: vali samm 1-s loodud `mesiraadio-overrides`
5. **Settings** → **Domains & Routes** → **Add** → **Route**:
   - `raadio.imresobnin.com/admin/api/*`
   - Zone: `imresobnin.com`
6. Korda sama, teine route:
   - `raadio.imresobnin.com/overrides.json`
   - Zone: `imresobnin.com`

## 3. Seadista Cloudflare Access (parool/sisselogimine)

See on see osa, mis tegelikult **kaitseb** admin-lehte — ilma selleta
näeks kõik internetist `/admin.html`-i.

1. **Cloudflare dashboard** → vasakul menüüs **Zero Trust** (kui esimest
   korda avad, palub see tasuta plaani valida — "Free" sobib, kuni 50
   kasutajat)
2. **Access** → **Applications** → **Add an application** → **Self-hosted**
3. Täida:
   - **Application name**: Mesiraadio Admin
   - **Session duration**: nt 24 hours (kui pikaks tahad sisselogituna jääda)
   - **Application domain**: `raadio.imresobnin.com`, tee (path): `/admin`
     (see kaitseb kõike, mis algab `/admin`-iga — nii `admin.html` kui
     `admin/api/*` ühe policy'ga)
4. **Next** → **Policies** → **Add a policy**:
   - **Policy name**: Ainult mina
   - **Action**: Allow
   - **Include** → **Emails** → sisesta oma email(id), kellel peab ligipääs olema
5. **Next** → **Add application**

Valmis. Kui nüüd avad `https://raadio.imresobnin.com/admin.html`, küsib
Cloudflare enne sinu emaili ja saadab sulle ühekordse koodi (või
Google/muu sisselogimise, kui oled selle Access'is lubanud) — alles
pärast seda näed lehte üldse.

## 4. Lae admin.html oma saidile

Pane `admin.html` samasse kohta, kus on `index.html`/`world.html` (repo
juur) — see levib automaatselt koos ülejäänud saidiga.

## 5. Kontroll

- Ava `https://raadio.imresobnin.com/admin.html` — peaks küsima sisselogimist
- Pärast sisselogimist peaksid nägema jaamade nimekirja koos "Käsitsi
  märgi" nuppudega
- Ava eraldi (ilma sisselogimiseta, nt privaatses aknas)
  `https://raadio.imresobnin.com/overrides.json` — see PEAB olema
  nähtav ilma sisselogimiseta (nii saab tervisekontrolli skript seda lugeda)
- Kui ka `/admin/api/*` küsib ilma sisselogimiseta sisse logimist mitte
  kunagi ning `/overrides.json` samuti küsib — kontrolli Access'i
  rakenduse tee (path) uuesti, see peab olema täpselt `/admin`, mitte
  tühi (kogu domeen)

## Kuidas see check_stations.py-ga kokku käib

Iga päevane tervisekontroll (`scripts/check_stations.py`) küsib nüüd
enne `status.json` kirjutamist `https://raadio.imresobnin.com/overrides.json`
(avalik, ei vaja sisselogimist) ja rakendab sinu käsitsi otsused —
seega sinu "Määra OK"/"Määra maas" jääb kehtima ka järgmisel
automaatkontrollil, kuni sa ise "Tühista" vajutad.

Kui Worker pole veel deploy'itud või on ajutiselt kättesaamatu,
jätkab tervisekontroll lihtsalt tavapäraselt (ilma ülekirjutusteta) —
see ei lõhu kunagi automaatkontrolli tervikuna.
