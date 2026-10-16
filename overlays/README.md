# Overlays (New Season + New Episode)

Phase 1–3 of StreamPilot Overlays — New Season on **show posters**, New Episode on **season posters + episode thumbs**, presets/uploads, preview gallery, and binge grouping.

## UI layout

Overview shows **three job cards** that match the worker bundles:

1. **Banners (core)** — Live / New Season / New Episode / Top 10 (Preview + Run core)
2. **Recently Added** — separate Preview / Run
3. **Media / Layer** — full Layer overlay families (separate Preview / Run)

Expand each card for that job’s toggles, windows, filters, and schedule. Hero actions are **Refresh**, **Stop** (while running), and **Promote** (when preview rows exist). **Advanced** holds module defaults, libraries, visual sample, import log, and Reset all. Tracked Layer stamps (and per-item / bulk revert) live under the **Shows** tab.

## Layout

- `cli.py` / `core.py` — Python worker (Pillow + plexapi)
- `assets/presets/new-season.png`, `new-season-compact.png`
- `assets/presets/new-episode.png`, `new-episode-compact.png`
- Extra styles: `corner-ribbon.png`, `corner-ribbon-episode.png`, `returning-soon.png`, `season-chip.png` (dynamic `S{n}`)
- Runtime data: `config/overlays/` (`config.json`, logs, `preview/`, `preview/samples/`, `presets/custom/`, `backups/`)
- Advanced **Visual sample** composites banners onto chosen/random Plex art (no live mutations)
- **Promote preview → live** stamps tracked `preview_only` rows to Plex without a full library rescan

## Stamp rules (Phase 3)

- **Show poster:** New Season for season 2+ premieres
- **Season poster:** New Season on the latest season when **Stamp New Season on show and season posters** is on (default). Otherwise New Episode still stamps the latest season when the show has eligible new episodes.
- **Episode thumbs:** New Episode (default 6-day window)
- `skipNewEpisodeOnBinge` (default on): if 3+ episodes of the same season share an air date, skip episode thumbs (the New Season banners still apply when that option is on)

## Badge modes (each has a per-job toggle on Overview cards)

- **New Season / New Episode** — existing air-date windows; optional **Watch Now** split style toggles
- **Live | {weekday}** — latest episode aired within Live window; highest-priority bottom badge
- **Recently Added** — Plex `addedAt` within window; skipped if Live or New Season already claimed the show
- **TOP 10** — top-rated shows (audience/rating); corner badge, can stack with bottom badges
- **Banner layer stack** (`layer_stack.py`) — Live / New Season / Recently / Top 10 share one **clean base** poster per show (`backups/base/{ratingKey}/`) plus weighted layers. Any add/remove **recomposes** from that base (never restores a mode-specific full-poster snapshot that might still contain another badge). Weights: Live 300, New Season 200, Recently 100 (bottom group, mutually exclusive); Top 10 50 (corner, stacks). Legacy mode backups are promoted into the clean base on first touch.
- **TMDB air-date fallback** — when Plex lacks `originallyAvailableAt`, resolve dates via TMDB (portal API key) for recently-added undated episodes; applies to New Episode / New Season / Live
- **Media / Layer engine** (`kometa_engine.py`) — single-pass composite of every enabled family onto the original poster, EXIF `0x04BC=overlay` marker, unified `kometa_overlaid_log.json` + per-item backups (movies included), CLI/API/UI revert
  - **Resolution** — Layer resolution ladder (4K-DV-HDR-Plus → HDR) via Plex resolution/hdr/dovi filters + filepath regexes
  - **Edition** — Extended / Director’s Cut / IMAX / Criterion (movies; Plex edition + TRaSH paths)
  - **Audio codec / video format** — filepath + audio-title regex ladders (TrueHD Atmos → Opus; REMUX → CAM)
  - **Status** — TMDB series status + AIRING window; **Streaming** — TMDB watch providers by region
  - **Network** — Plex network/studio → Layer logo match
  - **Aspect / versions / language count / language flags / runtimes / direct play / episode info / content ratings** — local Plex detections
  - **Ratings** — up to three audience/critic/TMDB badges
  - **Ribbon** — Oscars/Emmys/IMDb Top 250/RT/Metacritic/etc. via cached IMDb awards + MDBList
  - **MediaStinger** — TMDB during/after-credits keywords

Images are **vendored** under `overlays/assets/kometa-images/` (full upstream `defaults/overlays/images` tree + Inter fonts) and copied into the Docker image. Runtime caches list data under `config/overlays/cache/`. Library picker includes movie + TV sections (TV-only modes ignore movies). Placement tab edits New Season/Episode targets **and** Layer corner slots (defaults match Layer offsets on a 1000×1500 poster).

Credit: overlay PNGs from [Kometa-Team/Kometa](https://github.com/Kometa-Team/Kometa); Inter fonts from [Kometa-Team/Default-Images](https://github.com/Kometa-Team/Default-Images); award event data from [Kometa-Team/IMDb-Awards](https://github.com/Kometa-Team/IMDb-Awards). Re-sync images with `python scripts/sync-kometa-overlay-images.py`.

## Placement

- Overlays → **Placement** tab: drag/resize the banner on sample art (show / season / episode targets)
- Layout is stored in `config/overlays/config.json` under `placement` and honoured by Preview, Run, and visual samples
- Changing placement does not auto-restamp live Plex art — run Preview or Run again

## Runs (separate jobs)

Each Overview job card runs one bundle:

- **Banners** — Live, New Season, New Episode, Top 10
- **Recently Added** — Recently Added banners only
- **Media / Layer** — all enabled Layer overlay families (single-pass composite)

Preview writes composites under `config/overlays/preview/` (no Plex upload). Promote preview → live stamps tracked preview rows. Per-item and bulk **Revert Layer** restore originals from `backups/kometa/{ratingKey}/`.

Each bundle has its own schedule hours on the matching card (0 = off). They share one worker lock so two overlay runs never stamp posters at the same time.

## Setup

```bash
pip install -r overlays/requirements.txt
# or reuse Poster Sets venv (auto-detected by the Node runner)
```

1. Settings → Overlays → enable
2. Confirm Media Player Plex URL/token
3. Open **Overlays** → Advanced → Import your existing `overlaid_log.json` if migrating
4. Use each Overview card’s Preview, then Run

## Notes

- Skips items with a Plex `Overlay` label by default (`skipIfKometaOverlayLabel`)
- Banner / New Episode stamps add the same Plex `Overlay` label by default (`bannersAddOverlayLabel`) so Layer can skip them; the label is cleared when no banner layers remain (unless Layer still owns it)
- Custom PNG uploads go to `config/overlays/presets/custom/` (`season-*` / `episode-*`)
- Prefer off-hours if Poster Sets / Layer overlays also rewrite posters on the same libraries
