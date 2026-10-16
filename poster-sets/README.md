# Poster Sets (headless worker)

Scrapes MediUX / ThePosterDB set URLs and uploads artwork to Plex.

Used by the portal via `lib/poster-sets` — not related to ColleXions.

MediUX note: images are fetched from `https://api.mediux.pro/assets/{id}` and uploaded
as files. The old `/_next/image` proxy returns 403/blank payloads, which is what caused
empty posters in Plex.

Overlays: after each successful poster upload the worker clears every stamp the
Overlays page can apply (4K/HDR, Atmos, editions, banners, Overlay label, plus
tracking/backups) so a later revert cannot restore old art over the new set
(config `reset_overlay`, default true). The next Overlays run can restamp onto
the new artwork.

```bash
# Local venv (optional)
python -m venv .venv
.venv/Scripts/pip install -r requirements.txt   # Windows
# or: .venv/bin/pip install -r requirements.txt

echo '{"config":{"base_url":"...","token":"...","tv_library":["TV Shows"],"movie_library":["Movies"],"mediux_filters":["show_cover","season_cover","background","title_card"]},"url":"https://mediux.pro/sets/123"}' \
  | python cli.py preview
```

Docker uses `/opt/poster-sets-venv` and `POSTER_SETS_APP_DIR=/app/poster-sets`.
