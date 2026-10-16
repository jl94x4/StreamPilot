---
layout: home

hero:
  name: StreamPilot
  text: Self-hosted Plex and Jellyfin management.
  tagline: Manage access, analytics, onboarding, status, and media-server operations from one polished portal.
  image:
    src: /logo.png
    alt: StreamPilot logo
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: Docker Deployment
      link: /guide/docker

features:
  - title: Plex and Jellyfin ready
    details: First-time setup supports Plex OAuth/server selection or Jellyfin URL/API-key configuration with Jellyfin login and Quick Connect.
  - title: User access automation
    details: Invite links, temporary access, expiry checks, inactivity cleanup, grace-period emails, and audit logs keep access predictable.
  - title: Personal analytics
    details: User dashboards include watch history, rankings, media profile cards, peak hours, top titles, and shareable wrap-up exports.
  - title: Admin operations
    details: Live sessions, user management, server status, background jobs, layout controls, and maintenance tools are available from the browser.
  - title: Discover & Request
    details: Browse TMDB and submit requests with the built-in engine. Seerr is optional. Admins approve into Sonarr and Radarr.
  - title: ColleXions
    details: Admin Plex collection automation with a bundled worker — trending presets, import lists, and scheduled syncs inside the portal.
  - title: Spotify Sync
    details: Admin Plex tool (BETA) that matches Spotify playlists and albums to your library and writes Plex playlists with artwork.
---

## What Is StreamPilot?

StreamPilot is a Node.js, Express, React, and Tailwind CSS application for managing a Plex or Jellyfin media server community. It stores runtime data in local JSON files, so it does not require a database.

Use these docs when you need to install the app, configure integrations, run it in Docker, operate background tasks, or understand the project structure.

## Integration Highlights

StreamPilot supports Plex, Jellyfin, Emby, Tautulli, Jellystat, Sonarr, Radarr, Lidarr, Bazarr, qBittorrent, Transmission, BitTorrent, Deluge, SABnzbd, NZBGet, Gotify, TMDB, and SMTP. Discover &amp; Request is built in by default; Seerr/Jellyseerr is optional as an engine or history import.

See the full [integration list](/guide/integrations) for setup notes and feature coverage.

## Quick Commands

```bash
npm install
npm start
```

For production Docker deployments, start with the [Docker guide](/guide/docker).
 
