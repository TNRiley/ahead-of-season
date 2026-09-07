"""Harvest daily observation histograms from GBIF, and daily temperature from Open-Meteo.

The whole design rests on one GBIF capability that is easy to miss: occurrence/search
accepts `facet=day` alongside `year=` and `month=`, so ONE call returns a full daily
histogram for that month. Counting day by day would be ~150,000 calls; this is ~5,250.

Everything is cached to data/cache/ so the harvest is resumable and a re-run is free.
"""
import json, os, sys, time, threading, queue
sys.path.insert(0, os.path.dirname(__file__))
from common import (get_json, qs, PLACES, SPECIES, YEARS, MONTHS, AVES_CLASS_KEY)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, ".cache")
os.makedirs(CACHE, exist_ok=True)

def cached(key, fn):
    p = os.path.join(CACHE, key + ".json")
    if os.path.exists(p):
        with open(p) as f:
            return json.load(f)
    v = fn()
    tmp = p + ".tmp"
    with open(tmp, "w") as f:
        json.dump(v, f)
    os.replace(tmp, p)
    return v

# ------------------------------------------------------------------ taxon keys

def taxon_key(sci):
    def fn():
        d = get_json("https://api.gbif.org/v1/species/match?" + qs(name=sci, rank="SPECIES"))
        if d.get("matchType") == "NONE" or not d.get("usageKey"):
            raise RuntimeError(f"no GBIF match for {sci}: {d}")
        return {"usageKey": d["usageKey"], "scientificName": d.get("scientificName"),
                "matchType": d.get("matchType"), "confidence": d.get("confidence"),
                "family": d.get("family"), "order": d.get("order")}
    return cached("taxon_" + sci.replace(" ", "_"), fn)

# ------------------------------------------------- daily histogram for a month

def day_hist(place, year, month, taxon=None):
    """{day_of_month: count} for one box/year/month, for one species or for all birds."""
    who = f"t{taxon}" if taxon else "aves"
    key = f"hist_{place['id']}_{who}_{year}_{month:02d}"
    def fn():
        p = {"decimalLatitude": f"{place['lat'][0]},{place['lat'][1]}",
             "decimalLongitude": f"{place['lon'][0]},{place['lon'][1]}",
             "year": year, "month": month, "limit": 0,
             "facet": "day", "facetLimit": 31,
             # Wild things only. GBIF gotcha: occurrence records include zoo animals,
             # cultivated plants and fossils unless you say otherwise.
             "basisOfRecord": "HUMAN_OBSERVATION"}
        if taxon: p["taxonKey"] = taxon
        else:     p["classKey"] = AVES_CLASS_KEY
        d = get_json("https://api.gbif.org/v1/occurrence/search?" + qs(**p))
        out = {}
        for f in d.get("facets", []):
            if f.get("field") == "DAY":
                for c in f.get("counts", []):
                    out[str(int(c["name"]))] = c["count"]
        return {"total": d.get("count", 0), "days": out}
    return cached(key, fn)

# ---------------------------------------------------------------- open-meteo

def weather(place):
    def fn():
        p = {"latitude": place["clat"], "longitude": place["clon"],
             "start_date": f"{YEARS[0]}-01-01", "end_date": f"{YEARS[-1]}-12-31",
             "daily": "temperature_2m_max,temperature_2m_min",
             "timezone": "America/New_York"}
        return get_json("https://archive-api.open-meteo.com/v1/archive?" + qs(**p))
    return cached("weather_" + place["id"], fn)

# ------------------------------------------------------------------ the run

def main():
    t0 = time.time()
    keys = {}
    for sci, common_name, group in SPECIES:
        keys[sci] = taxon_key(sci)
        print(f"  {common_name:28s} -> {keys[sci]['usageKey']} ({keys[sci]['matchType']})")

    jobs = []
    for pl in PLACES:
        for y in YEARS:
            for m in MONTHS:
                jobs.append((pl, y, m, None))               # effort denominator
                for sci, _, _ in SPECIES:
                    jobs.append((pl, y, m, keys[sci]["usageKey"]))

    todo = [j for j in jobs
            if not os.path.exists(os.path.join(
                CACHE, f"hist_{j[0]['id']}_{'t'+str(j[3]) if j[3] else 'aves'}_{j[1]}_{j[2]:02d}.json"))]
    print(f"\n{len(jobs)} histograms, {len(todo)} still to fetch")

    q = queue.Queue()
    for j in todo: q.put(j)
    done = [0]; lock = threading.Lock(); errs = []

    def worker():
        while True:
            try: pl, y, m, tk = q.get_nowait()
            except queue.Empty: return
            try:
                day_hist(pl, y, m, tk)
            except Exception as e:
                with lock: errs.append(str(e)[:200])
            with lock:
                done[0] += 1
                if done[0] % 100 == 0:
                    el = time.time() - t0
                    rate = done[0] / el * 60
                    print(f"    {done[0]}/{len(todo)}  {el:.0f}s  {rate:.0f}/min  "
                          f"eta {(len(todo)-done[0])/max(rate,1):.1f}min", flush=True)
            q.task_done()

    ts = [threading.Thread(target=worker, daemon=True) for _ in range(4)]
    for t in ts: t.start()
    for t in ts: t.join()

    for pl in PLACES:
        weather(pl)
        print(f"  weather {pl['id']} ok")

    print(f"\ndone in {time.time()-t0:.0f}s, {len(errs)} errors")
    for e in errs[:5]: print("  !", e)

if __name__ == "__main__":
    main()
