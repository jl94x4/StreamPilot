# Discover & Request

**Discover & Request** is the built-in request experience. Members browse TMDB, check library availability, and submit requests. Admins approve into Sonarr and Radarr.

Seerr / Overseerr / Jellyseerr is **optional**. You do not need it for requests to work.

## Default: portal request engine

With the portal engine (default):

1. Configure **TMDB**, **Sonarr**, and **Radarr** in Settings.
2. Open **Discover & Request** in the nav.
3. Browse movies and series, open a title, and submit a request.
4. Admins review pending items under **Requests** (or the Home pending-requests widget).

Optional extras under Discover & Request:

- **My Requests** — member request history and status
- **My Issues** — report problems with library titles
- **Watchlist** — Plex watchlist-backed lists when configured
- **People** — actor/crew pages show full TMDB filmography (acting and crew), not only “known for”

## Admin Requests queue

The **Requests** nav item (admin) is the approval inbox:

| Capability | Details |
| --- | --- |
| Status tabs | Pending, Failed, Approved, and Declined with live counts |
| Request cards | Poster, requester, quality, folder, tags, seasons, overview |
| Review & Approve | Season picker, quality profile, root folder, tags, request-as override |
| Quick actions | Approve, edit, decline, retry failed, delete |
| Issues / Blocklist | Admin tools for reported issues and blocked titles |

The Home dashboard can show a **Pending Requests** widget. Reorder or hide it under **Settings → Layout → Home Layout**.

## Settings

**Settings → Request** controls:

- Request engine: **portal** (default) or Seerr/Jellyseerr
- Quotas and auto-approve rules
- Default quality profiles / root folders where applicable
- Optional Seerr URL/API key when using Seerr as the engine

## Using Seerr (optional)

You can still point the portal at Seerr / Overseerr / Jellyseerr if you prefer that stack:

- **Engine mode** — Discover & Request proxies through Seerr for browse/fulfill
- **History import** — one-shot import of past Seerr requests into the portal engine

Setup and first-run wizard can import Seerr history when you are migrating. Day to day, most installs stay on the portal engine with TMDB + ARR only.

## Related

- [Integrations](/guide/integrations) — TMDB and Seerr rows
- [Calendar](/features/calendar) — watch ARR queues after approval
- [Dashboard](/features/dashboard) — community watch activity (not the request browser)
