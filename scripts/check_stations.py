#!/usr/bin/env python3
"""
Mesiraadio jaamade tervisekontroll.
Loeb STATIONS massiivid index.html-ist ja world.html-ist, testib iga
striimi (GET + väike Range, mitte HEAD — paljud Icecast/Shoutcast
serverid ei vasta HEAD-ile korrektselt) ja kirjutab tulemuse status.json-i.

Osa striimiservereid tõrjub pilve-IP-sid (andmekeskuse blokeering,
anti-hotlinking) sõltumata sellest, kas jaam tegelikult töötab — seetõttu
ei märgita jaama "maas"-olevaks ühe ebaõnnestunud kontrolli pealt, vaid
alles pärast mitut järjestikust päeva (FAIL_THRESHOLD). See vähendab
vale-alarme, aga tähendab ka, et päris tõrge jõuab lehele nähtavale
mõne päevaga, mitte kohe.

Käivitamine: python3 scripts/check_stations.py
Eeldab, et see jookseb repo juurkataloogist (kus index.html/world.html asuvad).
"""
import re
import json
import sys
import datetime
import urllib.request
import urllib.error
import concurrent.futures as cf

FILES = [("index.html", 2), ("world.html", 5)]
TIMEOUT = 10
WORKERS = 15
FAIL_THRESHOLD = 3   # mitu järjestikust ebaõnnestumist enne "maas" märkimist
UA = "Mozilla/5.0 (compatible; Mesiraadio-HealthCheck/1.0; +https://raadio.imresobnin.com)"


def parse_stations(path, cols):
    try:
        text = open(path, encoding="utf-8").read()
    except FileNotFoundError:
        print(f"HOIATUS: {path} ei leitud, jätan vahele", file=sys.stderr)
        return []
    m = re.search(r"const STATIONS = \[\n(.*?)\n\];", text, re.S)
    if not m:
        print(f"HOIATUS: STATIONS massiivi ei leitud failist {path}", file=sys.stderr)
        return []
    pat = r'\["(.*?)","(.*?)"\]' if cols == 2 else r'\["(.*?)","(.*?)","(.*?)","(.*?)","(.*?)"\]'
    rows = re.findall(pat, m.group(1))
    return [(r[0], r[1]) for r in rows]


def check(name_url):
    name, url = name_url
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": UA,
            "Range": "bytes=0-2000",
            "Icy-MetaData": "1",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            code = resp.status
            ct = (resp.headers.get("Content-Type") or "").lower()
            final_url = resp.geturl()
            ok = (
                code in (200, 206)
                and final_url.startswith("https://")
                and any(a in ct for a in ("audio", "mpeg", "aac", "octet"))
            )
            return name, ok
    except Exception:
        return name, False


def load_previous():
    try:
        with open("status.json", encoding="utf-8") as f:
            data = json.load(f)
        return data.get("stations", {})
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def main():
    stations = []
    seen = set()
    for path, cols in FILES:
        for name, url in parse_stations(path, cols):
            if name in seen:
                continue
            seen.add(name)
            stations.append((name, url))

    if not stations:
        print("Ühtegi jaama ei leitud — status.json ei kirjutata.", file=sys.stderr)
        sys.exit(1)

    previous = load_previous()

    raw = {}
    with cf.ThreadPoolExecutor(max_workers=WORKERS) as ex:
        for name, ok in ex.map(check, stations):
            raw[name] = ok

    results = {}
    newly_flagged, recovered = [], []
    for name, ok in raw.items():
        prev = previous.get(name, {})
        prev_streak = prev.get("fail_streak", 0)
        prev_flagged = not prev.get("ok", True)

        streak = 0 if ok else prev_streak + 1
        flagged = streak >= FAIL_THRESHOLD

        if flagged and not prev_flagged:
            newly_flagged.append(name)
        if prev_flagged and not flagged:
            recovered.append(name)

        results[name] = {"ok": not flagged, "fail_streak": streak}

    out = {
        "checked_at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "stations": results,
    }
    with open("status.json", "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))

    live_fails = [n for n, ok in raw.items() if not ok]
    print(f"Kontrollitud {len(stations)} jaama. Selle korra tõrkeid: {len(live_fails)}.")
    if newly_flagged:
        print(f"UUED 'maas' märgid ({FAIL_THRESHOLD}+ päeva järjest ebaõnnestunud):")
        for n in newly_flagged:
            print(" -", n)
    if recovered:
        print("Taastusid:")
        for n in recovered:
            print(" -", n)


if __name__ == "__main__":
    main()
