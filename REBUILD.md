# Rebuilding Ahead of Season

Enough to reproduce this from an empty directory, a shell and no other context.

---

## 1. What is being built

A page that answers one question — **do migratory birds arrive earlier in warm springs?** — and,
more importantly, is honest about when it cannot answer it.

For each of 13 bird species in each of 3 metro boxes, for each spring from 2000 to 2024, it finds
the day the species "arrived", and plots that against how warm that particular spring was. The
reader can re-sort the 25 years from calendar order into warmth order and watch whether the
arrival ticks fall into a diagonal.

**The effect it exists to show is not the migration signal — it is the control.** Two of the 13
species are year-round residents. A Northern Cardinal is here in January; it has no arrival to
shift. Run it through the identical pipeline and whatever slope comes back is the *method's own
drift*, not biology. That number is subtracted from every migrant's slope, and where it is large
the page refuses to report the place at all. It fires in Boston. Without the controls, Boston's
migrant numbers look like findings.

---

## 2. Data sources, with the exact calls

### GBIF occurrences — `https://api.gbif.org/v1/occurrence/search`

No key, no auth. **The one call that makes this affordable:**

```
https://api.gbif.org/v1/occurrence/search
  ?taxonKey=5228514
  &decimalLatitude=38.5,39.5&decimalLongitude=-77.6,-76.5
  &year=2024&month=5
  &limit=0&facet=day&facetLimit=31
  &basisOfRecord=HUMAN_OBSERVATION
```

`facet=day` alongside `year=` and `month=` returns a **full daily histogram for that month in one
request**. Looping `eventDate` day by day is ~150,000 requests for this study; faceting is 5,250.

The **effort denominator** is the identical call with `taxonKey` swapped for `classKey=212`
(class Aves) — every bird record in the same box on the same days.

Resolve taxon keys with `https://api.gbif.org/v1/species/match?name=Icterus%20galbula&rank=SPECIES`.
All 13 species here match `EXACT`.

**Quirks that will bite:**

| Quirk | What happens | What to do |
|---|---|---|
| eBird's annual export reaches GBIF ~a year late | 2025 held **422** hummingbird records for the DC box vs **13,261** for 2024 | Stop the window at 2024. Compare each year's volume to the trailing median and drop the incomplete tail. Plotted naively this draws a dramatic, entirely fictional early spring. |
| Concurrency above ~6 is silently throttled | 10 threads failed **198 of 4,362** calls (4.5%) even after 5 retries with exponential backoff | Use **4 threads**. Same ~250 req/min, zero errors. |
| Rapid sequential calls sometimes return HTTP 200 with a JSON **array** error body | `d["count"]` raises `TypeError: list indices must be integers` thousands of calls into a harvest | Treat a non-dict body as a retryable failure. |
| Records include museum specimens and fossils | Collection dates unrelated to migration pollute the histogram | `basisOfRecord=HUMAN_OBSERVATION` |
| Paging caps at 100,000 and stops silently | — | Not hit here; we never page, we only facet. |

### Open-Meteo ERA5 — `https://archive-api.open-meteo.com/v1/archive`

No key. **Do not chunk by year** — one call returns the whole span:

```
https://archive-api.open-meteo.com/v1/archive
  ?latitude=39.02&longitude=-77.08
  &start_date=2000-01-01&end_date=2025-12-31
  &daily=temperature_2m_max,temperature_2m_min
  &timezone=America%2FNew_York
```

26 years of daily max/min in **1.1 s and 214 KB, zero nulls**. Free tier is ~10,000 calls/day, so
three calls total for this project. Note the archive host differs from the forecast host.

**Machine gotcha:** use `/usr/bin/python3` (Apple's 3.9). `python3` resolves to
`/usr/local/bin/python3` (3.14, python.org) whose OpenSSL has no CA bundle, so every `urllib`
HTTPS call dies with `CERTIFICATE_VERIFY_FAILED` while `curl` works. `src/common.py` also loads
`/etc/ssl/cert.pem` as a fallback.

---

## 3. Processing decisions, and why

**Study design** (`src/common.py`): 3 boxes of 1° latitude on one flyway — DC (38.5–39.5 N,
77.6–76.5 W), Boston (42–43 N), Atlanta (33.3–34.3 N). 13 species: 9 long-distance migrants,
2 short-distance, **2 residents as controls**. Window Feb 1 – Jun 30, years 2000–2024.

**Effort normalisation is not optional.** The DC box logged 210 hummingbird records in 2000 and
13,261 in 2024. That is a change in observers. Every daily count is divided by the all-Aves count
for the same box and day; the plotted quantity is a *detection frequency* — of the birding done
that day, what share found this species. Days with fewer than **20** all-bird records are dropped
(the ratio is meaningless); years with fewer than **25** species records are excluded entirely.

**Leap years** are collapsed onto the common-year calendar by dropping Feb 29, so index *i* means
the same date in every year. No migrant arrives on Feb 29.

**Smoothing:** centred 7-day moving average over valid days.

**Arrival is a percentile, not an event.** The day the season's running total of effort-corrected
sightings first crosses a chosen share, linearly interpolated between days. There is no single
right answer, which is why it is a slider (5–50%, default 15%). Low tracks the first scouts and is
jumpy; high tracks the bulk and is steadier.

**Spring warmth** is the mean daily temperature over March–April at the box centre. Also computed:
growing degree days base 10 °C from Jan 1, and the day that total first reaches 100.

**The regression** is ordinary least squares of arrival day-of-year on spring mean temperature.
Slope is reported in **days per °C**; negative means earlier in warm springs.

**The control correction:** `controlBaseline()` averages the two residents' slopes for the current
place and percentile. That is subtracted from the species slope before any verdict is written.
If `|baseline| > 0.4` days/°C the place is flagged rather than reported.

**The payload ships raw daily counts, not computed arrival dates**, so the percentile slider
genuinely recomputes rather than switching between four baked answers.

---

## 4. The page

Wide instrument layout, not a reading column. Full-width control rail (species chips, place chips,
percentile slider, calendar/warmth sort). Below it a two-column grid: the **25-year ladder** as the
hero on the left — one track per year, Feb→Jun, the effort-corrected curve as a filled area tinted
by that spring's temperature, a tick at the arrival date, the year clickable through to its
underlying GBIF search. Right column: the regression scatter with slope, r² and **control drift**
as stat tiles; a verdict paragraph that changes wording when the control fails; and a table of all
13 species' slopes sorted by sensitivity, residents marked.

Identity: cold→warm *is* the encoding, so the palette is the data — slate blue `#3D6E8F` through
neutral `#9AA3A0` to amber `#C4732A`, on blue-green-biased neutrals (`#F0F3F2` / `#0F1614`).
Fraunces for display, IBM Plex Sans for body, IBM Plex Mono for every number. In-page
Auto/Light/Dark switch applied pre-paint from `localStorage`; a Plain English toggle adds a
lay sentence under each methods block without removing the technical one.

---

## 5. Verification table — real expected values

Run `src/build_data.py`, then check these. All at **percentile 15**, slope in **days per °C**.

| Place | Species | Slope | r² | n years | Records |
|---|---|---|---|---|---|
| DC | Baltimore Oriole | **−0.73** | 0.40 | 25 | 63,760 |
| DC | Tree Swallow | −0.98 | 0.19 | 25 | 145,053 |
| DC | Gray Catbird | −0.88 | 0.20 | 25 | 199,773 |
| DC | Ruby-throated Hummingbird | +0.17 | 0.01 | 25 | 41,581 |
| DC | **Northern Cardinal (control)** | **−0.13** | 0.02 | 25 | 596,315 |
| DC | **Tufted Titmouse (control)** | **−0.02** | 0.00 | 25 | 372,629 |
| BOS | **Northern Cardinal (control)** | **+0.70** | 0.09 | 25 | 325,066 |
| BOS | **Tufted Titmouse (control)** | **+0.69** | 0.11 | 25 | 246,339 |
| BOS | Tree Swallow | −1.27 | 0.19 | 25 | 126,322 |
| ATL | **Northern Cardinal (control)** | **+0.19** | 0.01 | 25 | 156,184 |
| ATL | Ovenbird | −1.22 | 0.23 | 19 | 2,127 |

Other checkpoints:

- Ruby-throated Hummingbird `usageKey` = **5228514**; DC box holds **124,605** records all-time.
- DC GDD (base 10 °C, Jan–Apr) ranges **74.7 to 266.8** over 2000–2024, mean 153.0.
- DC spring mean temperature spans **7.3 °C to 12.5 °C**.
- `data/phenology.json` is **408 KB**; the built `index.html` is **447 KB**.
- **If the two DC controls do not come back near zero while Boston's come back near +0.7, the
  pipeline is wrong.** That contrast is the single most diagnostic result here.

---

## 6. What the page must say about itself

Non-negotiable, all present in the "How this was made" section:

1. **Correlation across years, not causation.**
2. **Sightings are opportunistic** — warm mornings put more people in the field. The effort
   correction reduces this but cannot erase it; the residents are how you find out what is left.
3. **Boston's control fails** and must be flagged on the page, not buried in a footnote.
4. **A flat line for a long-distance migrant is a result, not a failure** — hummingbirds winter in
   Central America and depart on daylength, so they cannot perceive a warm North American spring.
   That gap is the mechanism behind phenological mismatch.
5. **2025 is excluded for ingestion lag**, and the page says why.
6. ERA5 is a model, not the thermometer down the road. Records before ~2010 are thin.

---

## 7. Running it

```bash
/usr/bin/python3 src/harvest.py      # ~5,250 GBIF histograms + 3 Open-Meteo pulls; resumable
/usr/bin/python3 src/build_data.py   # .cache/ -> data/phenology.json
/usr/bin/python3 src/build_page.py   # -> index.html, wrapped and catalog-linked
```

Every response is cached under `.cache/` (gitignored, 5,266 files), so a re-run is free and an
interrupted harvest resumes. First full harvest is ~18 minutes at 4 threads.
`data/phenology.json` **is** committed — small, derived, and it lets `build_page.py` run without
re-harvesting.
