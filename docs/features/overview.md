# Feature Overview

StreamPilot combines user onboarding, access management, analytics, requests, collections, and server operations in one self-hosted app.

## Product map

| Nav label | What it is |
| --- | --- |
| Home | Personal wrap-up cards and configurable widgets |
| Dashboard | Live streams and community watch picks |
| Discover & Request | Built-in TMDB browse and requests (Seerr optional) |
| Requests | Admin approval queue, issues, and blocklist |
| Calendar | ARR release calendar, queues, and history |
| Downloads | Unified download-client status |
| Analytics | Deeper personal / server analytics views |
| ColleXions | Admin Plex collection automation (bundled worker) |
| Scanner | Admin library refresh from ARR webhooks / manual paths |
| Spotify Sync | Admin Plex playlist sync from Spotify (bundled worker, BETA) |
| Watch Sync | Admin two-way Plex and Trakt watched, ratings, collection, and watchlist sync, plus live scrobble while the server account is playing |
| Upgrader | Library quality upgrades via Sonarr / Radarr |
| Media Automation | Native FFmpeg jobs from manual or Sonarr/Radarr/Lidarr webhooks |
| Cleaner | Library maintenance rules and candidates |
| Status | Public / admin service status |
| Users / Settings | Access management and configuration |

## Personal Dashboard

Every user receives a dashboard focused on their own streaming history:

| Card | What It Shows |
| --- | --- |
| Server Rank | Leaderboard position, percentile progress, nearby users, and plays needed to climb |
| Total Streams | Play count, media-type split, daily average, unique titles, and recent watch history |
| Top Binge | Most-watched show with artwork and runner-up shows |
| Top Movie | Most-watched movie with metadata and runner-up movies |
| Media Profile | Viewer personality type and media split |
| Watch Style | Discovery versus rewatch behavior |
| Streaming Habit | Weekday/weekend behavior and average plays per day |
| Top Library | Most-used library and ranked breakdown |
| Top Day | Weekly play distribution |
| Peak Hours | Hourly streaming distribution |
| Time of Day | Streaming persona and contextual description |

Dashboards support time filters, server-side metadata caching, modal detail views, paginated history, and PNG wrap-up export.

## Access Management

Admins can invite users, grant temporary access, set expiry dates, revoke access, exempt users from inactivity cleanup, and review actions in the audit log.

## Communications

The app can send HTML emails for welcome messages, temporary-access warnings, expired access, inactivity warnings, and newsletters.

## Public Pages

Public-facing routes include the landing/login page, invite claim page, and status dashboard.

## Integrations

StreamPilot connects to the surrounding media stack: Plex, Jellyfin, Emby, Tautulli, Jellystat, Sonarr, Radarr, Lidarr, Bazarr, qBittorrent, Transmission, BitTorrent, Deluge, SABnzbd, NZBGet, Gotify, TMDB, and SMTP.

**Discover & Request is built in by default.** Seerr / Jellyseerr is optional as a request engine or history import — see [Discover & Request](/features/discover-request).

See [Integrations](/guide/integrations) for the full matrix.

## Native Media Automation

Admins can inspect and process selected media with the FFmpeg/FFprobe tools bundled in the Docker image. Version 1 supports manual and Sonarr/Radarr sources, with CPU, NVIDIA NVENC, Intel QSV/VAAPI, and AMD VAAPI encoder reporting.

The feature is opt-in and safety-first: begin with dry-run or copy mode, provide an explicit writable media mount for output actions, and configure quarantine before atomic replacement. Version 1 uses only the built-in native executor and does not expose a plugin API.

See [Native Media Automation](/features/media-automation) for deployment, hardware, and replacement safety requirements.

## Themes

Users can choose among built-in dark themes, while admins can set the default theme and branding.

## Feature guides

- [Dashboard](/features/dashboard)
- [Discover & Request](/features/discover-request)
- [Calendar](/features/calendar)
- [ColleXions](/features/collexions)
- [Scanner](/features/scanner)
- [Spotify Sync](/features/spotify-sync)
- [Upgrader](/features/upgrader)
- [Media Automation](/features/media-automation)
- [Cleaner](/features/cleaner)
- [Admin Dashboard](/features/admin)
