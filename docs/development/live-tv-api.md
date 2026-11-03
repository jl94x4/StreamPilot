# Live TV API notes (Phase 0)

Decisions (2026-10-26):

- Tuner: **Tunarr** (HDHomeRun emulation + XMLTV EPG into Plex Live TV & DVR).
- Sources: **server DVR only**. No Plex free/cloud channels.
- First release: **watch-only** (Guide, On Now, tune, play). Recording later.
- Home: Live TV sidebar when a DVR exists; optional **On Now** row, **off by default**.

We did not capture the official Plex web app against this PMS in this pass. Endpoints below are the community OpenAPI copies (DVRs / Live TV / EPG) plus how Tunarr shows up to Plex (a grabber + XMLTV EPG). Runtime code tries several known shapes and maps whatever PMS returns.

## Tunarr

Plex Settings → Live TV & DVR discovers Tunarr as an HDHomeRun (`http://<tunarr-host>:8000`). Guide data is XMLTV (`/api/xmltv.xml`). After that, StreamPilot only talks to **PMS**, not Tunarr.

## Calls we use

| Action | Method | Path |
|--------|--------|------|
| List DVRs | GET | `/livetv/dvrs` |
| One DVR (channel mappings) | GET | `/livetv/dvrs/{dvrId}` |
| Providers (EPG id + feature keys) | GET | `/media/providers` |
| Lineup channels | GET | `{epgPrefix}/lineups/dvr/channels` and `/livetv/epg/channels` |
| Guide window | GET | `{epgPrefix}/grid?startsAt=&endsAt=` |
| On now | GET | `{epgPrefix}/watchnow/all` (fallback: grid around now) |
| Tune | POST | `/livetv/dvrs/{dvrId}/channels/{channel}/tune` |
| Live HLS | GET | `/video/:/transcode/universal/start.m3u8?path=…` or the Part `key` from tune |
| Sessions | GET | `/livetv/sessions` |
| Stop | POST/GET | `/livetv/sessions/{id}/stop` and transcode `universal/stop` |

`epgPrefix` is typically `/tv.plex.providers.epg.xmltv` or `/tv.plex.providers.epg.xmltv:{deviceId}` from the DVR lineup URI / media providers.

`startsAt` / `endsAt` are Unix seconds.

## Tune → play

Tune is expected to return a `MediaContainer` with `Metadata` / `Media` / `Part`. Playback uses:

1. Absolute or PMS-relative Part `key` if present.
2. Else `/video/:/transcode/universal/start.m3u8` with `path` = metadata key or `/livetv/sessions/{sessionId}`.

Always stop the session when the player closes so Tunarr/Plex tuners are freed.

## Not in this release

- Record this / Record series / Recording Schedule.
- Plex cloud “free Live TV”.
- In-player mini-guide (channel up/down keys still map to next/prev episode today; live zap can follow).
