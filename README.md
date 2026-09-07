# 🐦 Ahead of Season

**Twenty-five springs of bird sightings against the temperature each spring actually had — with two birds that never migrate carried along as a lie detector.**

→ **[Open it](https://tnriley.github.io/ahead-of-season/)**

Do migrants arrive earlier in warm springs? This lines up 1.9 million GBIF sighting records — 13 species across Washington, Boston and Atlanta, 2000 to 2024 — against Open-Meteo's ERA5 temperature history for the same ground, and lets you re-sort the twenty-five years by warmth instead of by number to see whether the arrival dates fall into line. Because sightings measure birdwatchers as much as birds, every count is divided by all bird records logged in the same box on the same day, and two year-round residents are run through the identical pipeline as controls: a Northern Cardinal cannot arrive in spring, so whatever shift the method reports for it is the method's own drift. In Washington that drift is −0.13 days/°C and the Baltimore Oriole's 0.65 days per degree stands; in Boston the residents drift +0.70 and the page flags the entire city rather than report it. The Ruby-throated Hummingbird shows nothing anywhere — it winters in Central America and departs on daylength, unable to perceive a warm North American spring, which is the mechanism behind phenological mismatch.

## Running it

One self-contained HTML file. No build step, no server, no network access at runtime — open `index.html` in a browser, or serve the directory with any static host.

```bash
python3 -m http.server 8000   # then visit http://localhost:8000
```

## Rebuilding it from scratch

[REBUILD.md](REBUILD.md) is written for an LLM with a shell and nothing else: the data sources and their quirks, the processing decisions, the page's structure and interactions, and a table of expected values to check the result against.

## Source

The full build pipeline is in [`src/`](src/), with a README describing how to regenerate the page from scratch.

## Data

- **[GBIF occurrence records (species and all-bird effort denominator)](https://api.gbif.org/v1/occurrence/search)** — per-record CC0 / CC-BY / CC-BY-NC — honour each record's own licence
- **[Open-Meteo ERA5 reanalysis archive (daily 2 m max/min temperature)](https://archive-api.open-meteo.com/v1/archive)** — CC-BY-4.0

Every figure on the page is computed from the data shipped with it. Check the page's own methods panel for how each number is derived and where it should not be pushed.

## Built with

vanilla JS, hand-built SVG, GBIF facet=day histogram harvest, effort-normalised detection frequency, resident-species control cohort.

## Licence

Code is MIT (see [LICENSE](LICENSE)). Data keeps the licence of its source, listed above.

---

Part of [Quick Projects](https://github.com/TNRiley/quick-projects) — one self-contained thing, built in one session. First published 2026-09-07.
