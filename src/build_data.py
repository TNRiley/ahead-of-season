"""Turn the cache into one JSON payload for the page.

Deliberately does NOT pre-compute arrival dates. It ships the raw daily counts --
this species, and every bird record in the same box on the same day -- so the page
normalises and picks the percentile live. The slider then genuinely recomputes the
answer instead of choosing between four baked ones.
"""
import json, os, sys, datetime
sys.path.insert(0, os.path.dirname(__file__))
from common import PLACES, SPECIES, YEARS, MONTHS

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, ".cache")

DOY0, DOY1 = 32, 181          # Feb 1 .. Jun 30 in a non-leap year
NDAY = DOY1 - DOY0 + 1

def load(key):
    p = os.path.join(CACHE, key + ".json")
    if not os.path.exists(p): return None
    with open(p) as f: return json.load(f)

def doy(y, m, d):
    return datetime.date(y, m, d).timetuple().tm_yday

def series(place_id, who, year):
    """Daily counts over the Feb-Jun window, indexed 0..NDAY-1.

    Leap years are collapsed onto the common-year calendar by dropping Feb 29,
    so that day i means the same date in every year. Losing one February day
    costs nothing here -- no migrant arrives on Feb 29.
    """
    out = [0] * NDAY
    for m in MONTHS:
        h = load(f"hist_{place_id}_{who}_{year}_{m:02d}")
        if not h: return None
        for dstr, c in h["days"].items():
            d = int(dstr)
            if m == 2 and d == 29: continue
            try: k = doy(2001, m, d) - DOY0      # 2001: a non-leap reference year
            except ValueError: continue
            if 0 <= k < NDAY: out[k] += c
    return out

def weather_block(place):
    w = load("weather_" + place["id"])
    daily = w["daily"]
    by_year = {}
    for t, mx, mn in zip(daily["time"], daily["temperature_2m_max"], daily["temperature_2m_min"]):
        if mx is None or mn is None: continue
        y, m, d = (int(x) for x in t.split("-"))
        by_year.setdefault(y, []).append((m, d, (mx + mn) / 2.0))
    out = {}
    for y, rows in by_year.items():
        if y not in YEARS: continue
        gdd = sum(max(0.0, mean - 10.0) for m, d, mean in rows if m <= 4)
        mar_apr = [mean for m, d, mean in rows if m in (3, 4)]
        # day of year the accumulated warmth since Jan 1 first reaches 100 GDD
        acc, thermal = 0.0, None
        for m, d, mean in sorted(rows):
            acc += max(0.0, mean - 10.0)
            if thermal is None and acc >= 100.0:
                thermal = doy(y, m, d)
        out[y] = {"gdd": round(gdd, 1),
                  "tMarApr": round(sum(mar_apr) / len(mar_apr), 2) if mar_apr else None,
                  "thermalDoy": thermal}
    return out

def main():
    payload = {
        "meta": {
            "built": datetime.date.today().isoformat(),
            "doy0": DOY0, "nday": NDAY, "years": YEARS,
            "window": "Feb 1 - Jun 30",
            "sources": {
                "gbif": "https://api.gbif.org/v1/occurrence/search",
                "openMeteo": "https://archive-api.open-meteo.com/v1/archive",
            },
        },
        "places": [], "species": [], "effort": {}, "counts": {}, "weather": {},
    }

    for pl in PLACES:
        payload["places"].append({k: pl[k] for k in
            ("id", "name", "note", "lat", "lon", "clat", "clon")})
        payload["weather"][pl["id"]] = weather_block(pl)
        payload["effort"][pl["id"]] = {}
        for y in YEARS:
            s = series(pl["id"], "aves", y)
            if s: payload["effort"][pl["id"]][str(y)] = s

    missing = []
    for sci, common_name, group in SPECIES:
        tk = load("taxon_" + sci.replace(" ", "_"))
        if not tk: missing.append(sci); continue
        sid = str(tk["usageKey"])
        payload["species"].append({
            "id": sid, "sci": sci, "name": common_name, "group": group,
            "family": tk.get("family"), "order": tk.get("order"),
            "gbif": f"https://www.gbif.org/species/{sid}",
        })
        payload["counts"][sid] = {}
        for pl in PLACES:
            payload["counts"][sid][pl["id"]] = {}
            for y in YEARS:
                s = series(pl["id"], "t" + sid, y)
                if s is None: missing.append(f"{common_name}/{pl['id']}/{y}")
                else: payload["counts"][sid][pl["id"]][str(y)] = s

    out = os.path.join(ROOT, "data", "phenology.json")
    with open(out, "w") as f:
        json.dump(payload, f, separators=(",", ":"))
    print(f"wrote {out}  {os.path.getsize(out)/1024:.0f} KB")
    print(f"places {len(payload['places'])} species {len(payload['species'])} years {len(YEARS)}")
    if missing:
        print(f"MISSING {len(missing)}: {missing[:6]}")

if __name__ == "__main__":
    main()
