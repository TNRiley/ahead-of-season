"""Shared HTTP + config for the Ahead of Season harvest.

Machine gotcha (headwaters): /usr/local/bin/python3 (3.14, python.org) has no CA bundle,
so urllib HTTPS dies with CERTIFICATE_VERIFY_FAILED. Run with /usr/bin/python3, and load
/etc/ssl/cert.pem as a fallback either way.
"""
import json, ssl, time, urllib.parse, urllib.request, os

UA = "ahead-of-season/1.0 (personal research build; tnriley@gmail.com)"

def _ctx():
    try:
        c = ssl.create_default_context()
        if not c.get_ca_certs() and os.path.exists("/etc/ssl/cert.pem"):
            c.load_verify_locations("/etc/ssl/cert.pem")
        return c
    except Exception:
        return ssl.create_default_context(cafile="/etc/ssl/cert.pem")

CTX = _ctx()

def get_json(url, tries=5, pause=0.5):
    """GET and parse JSON, retrying transient failures.

    GBIF gotcha found while probing: under rapid sequential count queries it will
    occasionally answer with a JSON *array* error body instead of the search object,
    with a 200. Callers expect a dict, so treat a non-dict as a retryable failure
    rather than letting it blow up 3,000 calls into a harvest.
    """
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=60, context=CTX) as r:
                d = json.loads(r.read().decode("utf-8"))
            if not isinstance(d, dict):
                raise ValueError(f"non-dict body: {str(d)[:120]}")
            return d
        except Exception as e:
            last = e
            time.sleep(pause * (2 ** i))
    raise RuntimeError(f"failed after {tries}: {url}\n  {last}")

def qs(**kw):
    return urllib.parse.urlencode(kw, safe=",")

# ---------------------------------------------------------------- study design

# Three boxes on one migratory flyway, ~1 degree tall, chosen for latitude contrast.
# Trevor lives inside the first one.
PLACES = [
    {"id": "dc",  "name": "Washington DC metro", "note": "Kensington, MD sits in this box",
     "lat": [38.5, 39.5], "lon": [-77.6, -76.5], "clat": 39.02, "clon": -77.08},
    {"id": "bos", "name": "Boston metro", "note": "~3.5 degrees north of DC",
     "lat": [42.0, 43.0], "lon": [-71.6, -70.6], "clat": 42.36, "clon": -71.06},
    {"id": "atl", "name": "Atlanta metro", "note": "~5 degrees south of DC",
     "lat": [33.3, 34.3], "lon": [-84.9, -83.9], "clat": 33.75, "clon": -84.39},
]

# Long-distance migrants (the signal), short-distance migrants, and year-round
# residents kept deliberately as a CONTROL: a resident has no arrival to detect,
# so if the method reports one moving with spring warmth, the method is measuring
# birdwatchers rather than birds.
SPECIES = [
    ("Archilochus colubris",   "Ruby-throated Hummingbird", "long-distance migrant"),
    ("Icterus galbula",        "Baltimore Oriole",          "long-distance migrant"),
    ("Hylocichla mustelina",   "Wood Thrush",               "long-distance migrant"),
    ("Dumetella carolinensis", "Gray Catbird",              "long-distance migrant"),
    ("Chaetura pelagica",      "Chimney Swift",             "long-distance migrant"),
    ("Myiarchus crinitus",     "Great Crested Flycatcher",  "long-distance migrant"),
    ("Passerina cyanea",       "Indigo Bunting",            "long-distance migrant"),
    ("Seiurus aurocapilla",    "Ovenbird",                  "long-distance migrant"),
    ("Piranga olivacea",       "Scarlet Tanager",           "long-distance migrant"),
    ("Tachycineta bicolor",    "Tree Swallow",              "short-distance migrant"),
    ("Sialia sialis",          "Eastern Bluebird",          "short-distance migrant"),
    ("Cardinalis cardinalis",  "Northern Cardinal",         "resident (control)"),
    ("Baeolophus bicolor",     "Tufted Titmouse",           "resident (control)"),
]

AVES_CLASS_KEY = 212      # effort denominator: every bird record in the same box+days
YEARS = list(range(2000, 2025))   # 2025+ excluded: see the ingestion-lag note in README
MONTHS = [2, 3, 4, 5, 6]          # the spring window, day-resolution
