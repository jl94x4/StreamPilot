# ColleXions

**ColleXions** is admin-only Plex collection automation built into the portal. The React UI lives under `/collexions`. The Docker image also bundles the Python worker — no second container is required.

## Enable

1. Open **Settings → Collexions**.
2. Turn **Enable** on and save.
3. Open **ColleXions** in the nav.

The portal starts the worker on localhost automatically and generates the service key and internal URL. Worker data persists under `config/collexions/` on the portal volume (config + logs).

Advanced: set `COLLEXIONS_EMBEDDED_PORT` if you need a different localhost port (default `15755`).

See also [Docker → ColleXions](/guide/docker#collexions-bundled).

## Onboarding and config

- Onboarding (and **Config → Import from portal**) can auto-fill Plex URL/token and TMDB from portal Settings when available.
- Trakt and MDBList keys are still entered in ColleXions if you use those sources.
- Migrating from standalone ColleXions: **Config → Import config.json**, review, then **Save Config**.

## Areas

| Area | Purpose |
| --- | --- |
| Dashboard | Status overview for collections and sync health |
| Gallery | Browse generated / managed collections |
| Hubs | Hub layout management |
| Creator | Build collections from Trending presets, Discover filters, Import Lists (MDBList, etc.), and custom recipes |
| Jobs | Scheduled and manual sync jobs, including Run Now |
| Stats | Collection and sync statistics |
| Config | Worker settings, imports, and credentials |
| Logs | Worker log output |

## Creator highlights

- **Trending presets** — one-click catalogs such as weekly Top 10 movie/TV lists and other TMDB-backed recipes
- **Discover filters** — richer TMDB Discover filters and saved presets for auto-sync
- **Import lists** — bring in external lists (for example MDBList) and keep them on the Import List tab after create
- **Auto-sync** — recipes persist so scheduled jobs can refresh collections without rebuilding them by hand

## Requirements

- Plex media server mode (ColleXions targets Plex collections)
- Portal admin access
- Feature enabled in Settings (nav item appears when the flag is on)

## External sidecar (advanced)

The bundled worker is the default. If you run ColleXions as a **separate Python process** instead, configure the portal with your sidecar URL and service key in Settings → ColleXions.

Long-running sync jobs (collections, hubs, search, config import) can take several minutes. Set the sidecar Gunicorn (or reverse-proxy) timeout to **at least 600 seconds** so Run Now / bulk operations do not fail with gateway timeouts. The portal BFF allows up to 10 minutes for these proxy routes when embedded mode is used.

## Related

- [Docker Deployment](/guide/docker#collexions-bundled)
- [Cleaner](/features/cleaner) — library cleanup rules (separate from collection generation)
- [Configuration](/guide/configuration)
