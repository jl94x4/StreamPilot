# Integrations

StreamPilot can run with Plex, Jellyfin, or Emby-style media stacks and can connect to the companion apps that normally sit around a home media server.

Most integrations are configured in **Settings → Media Stack**. Branding, alerts, status checks, and home layout options live in their matching Settings sections.

<style>
.integration-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
  gap: 12px;
  margin: 18px 0 28px;
}
.integration-card {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  padding: 14px;
  background: var(--vp-c-bg-soft);
}
.integration-card img,
.integration-icon {
  width: 28px;
  height: 28px;
  object-fit: contain;
  flex: 0 0 auto;
}
.integration-card strong {
  display: block;
  margin-bottom: 2px;
}
.integration-card span {
  color: var(--vp-c-text-2);
  font-size: 13px;
  line-height: 1.45;
}
.integration-table img {
  width: 22px;
  height: 22px;
  object-fit: contain;
  vertical-align: middle;
}
</style>

## At A Glance

<div class="integration-grid">
  <div class="integration-card">
    <img src="https://cdn.jsdelivr.net/gh/selfhst/icons/svg/plex.svg" alt="" />
    <div><strong>Plex</strong><span>OAuth login, sessions, library data, Tautulli analytics, Discover, maintenance, and upgrader flows.</span></div>
  </div>
  <div class="integration-card">
    <img src="https://cdn.jsdelivr.net/gh/selfhst/icons/svg/jellyfin.svg" alt="" />
    <div><strong>Jellyfin</strong><span>Jellyfin auth, Quick Connect, user profiles, Jellystat activity, server artwork, and live session data.</span></div>
  </div>
  <div class="integration-card">
    <img src="https://cdn.jsdelivr.net/gh/selfhst/icons/svg/sonarr.svg" alt="" />
    <div><strong>ARR Stack</strong><span>Sonarr, Radarr, and Lidarr queues, calendars, history, download matching, and quality workflows.</span></div>
  </div>
  <div class="integration-card">
    <img src="https://cdn.jsdelivr.net/gh/selfhst/icons/svg/qbittorrent.svg" alt="" />
    <div><strong>Download Clients</strong><span>qBittorrent, Real-Debrid Client, Transmission, BitTorrent, Deluge, SABnzbd, and NZBGet merged into one Download Status page.</span></div>
  </div>
</div>

## Supported Integrations

<table class="integration-table">
  <thead>
    <tr>
      <th>App</th>
      <th>Category</th>
      <th>What It Enables</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><img src="https://cdn.jsdelivr.net/gh/selfhst/icons/svg/plex.svg" alt="" /> Plex</td>
      <td>Media server</td>
      <td>Plex OAuth login, library stats, live sessions, analytics, Discover, maintenance, and upgrader tools</td>
    </tr>
    <tr>
      <td><img src="https://cdn.jsdelivr.net/gh/selfhst/icons/svg/jellyfin.svg" alt="" /> Jellyfin</td>
      <td>Media server</td>
      <td>Jellyfin login, Quick Connect, Jellyfin profiles, library stats, live sessions, Discover, maintenance, and upgrader tools</td>
    </tr>
    <tr>
      <td><img src="https://cdn.jsdelivr.net/gh/selfhst/icons/svg/emby.svg" alt="" /> Emby</td>
      <td>Media server</td>
      <td>Emby-compatible media-server connection and download/status workflows</td>
    </tr>
    <tr>
      <td><img src="https://cdn.jsdelivr.net/gh/selfhst/icons/svg/tautulli.svg" alt="" /> Tautulli</td>
      <td>Analytics</td>
      <td>Plex activity, personal analytics, leaderboard data, watch history, and status checks</td>
    </tr>
    <tr>
      <td><img src="https://cdn.jsdelivr.net/gh/selfhst/icons@main/png/jellystat.png" alt="" /> Jellystat</td>
      <td>Analytics</td>
      <td>Jellyfin activity, yearly heatmap data, top libraries, top titles, devices, and playback method stats</td>
    </tr>
    <tr>
      <td><img src="https://cdn.jsdelivr.net/gh/selfhst/icons/svg/tmdb.svg" alt="" /> TMDB</td>
      <td>Requests / Discover</td>
      <td>Built-in Discover &amp; Request browse, posters, and search (with Sonarr/Radarr for library + fulfill). See <a href="/features/discover-request">Discover &amp; Request</a>.</td>
    </tr>
    <tr>
      <td><img src="https://cdn.jsdelivr.net/gh/selfhst/icons/svg/jellyseerr.svg" alt="" /> Jellyseerr / Seerr</td>
      <td>Requests (optional)</td>
      <td>Optional request engine, Discover metadata proxy, or one-shot history import into the portal</td>
    </tr>
    <tr>
      <td><img src="https://cdn.jsdelivr.net/gh/selfhst/icons/svg/sonarr.svg" alt="" /> Sonarr</td>
      <td>ARR</td>
      <td>TV calendar, queues, history, download matching, and upgrader search/profile actions</td>
    </tr>
    <tr>
      <td><img src="https://cdn.jsdelivr.net/gh/selfhst/icons/svg/radarr.svg" alt="" /> Radarr</td>
      <td>ARR</td>
      <td>Movie calendar, queues, history, download matching, and upgrader search/profile actions</td>
    </tr>
    <tr>
      <td><img src="https://cdn.jsdelivr.net/gh/selfhst/icons/svg/lidarr.svg" alt="" /> Lidarr</td>
      <td>ARR</td>
      <td>Music download matching, status filters, and integration health checks</td>
    </tr>
    <tr>
      <td><img src="https://cdn.jsdelivr.net/gh/selfhst/icons/svg/bazarr.svg" alt="" /> Bazarr</td>
      <td>Subtitles</td>
      <td>Multi-instance subtitle widgets, connection tests, version display, and subtitle tools</td>
    </tr>
    <tr>
      <td><img src="https://cdn.jsdelivr.net/gh/selfhst/icons/svg/qbittorrent.svg" alt="" /> qBittorrent</td>
      <td>Download client</td>
      <td>Download Status page, status checks, source matching, speed/progress display</td>
    </tr>
    <tr>
      <td><img src="https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/rdt-client.svg" alt="" /> Real-Debrid Client</td>
      <td>Download client</td>
      <td>RDT-Client (qBittorrent API on port 6500) with its own icon on Download Status and Integrations</td>
    </tr>
    <tr>
      <td><img src="https://cdn.jsdelivr.net/gh/selfhst/icons/svg/transmission.svg" alt="" /> Transmission</td>
      <td>Download client</td>
      <td>Download Status page, status checks, source matching, speed/progress display</td>
    </tr>
    <tr>
      <td><img src="https://cdn.simpleicons.org/bittorrent" alt="" /> BitTorrent</td>
      <td>Download client</td>
      <td>Download Status page, status checks, source matching, speed/progress display</td>
    </tr>
    <tr>
      <td><img src="https://cdn.jsdelivr.net/gh/selfhst/icons/svg/deluge.svg" alt="" /> Deluge</td>
      <td>Download client</td>
      <td>Download Status page, status checks, source matching, speed/progress display through Deluge Web</td>
    </tr>
    <tr>
      <td><img src="https://cdn.jsdelivr.net/gh/selfhst/icons/svg/sabnzbd.svg" alt="" /> SABnzbd</td>
      <td>Download client</td>
      <td>Download Status page, status checks, NZB queue progress, speed display, and ARR source matching</td>
    </tr>
    <tr>
      <td><img src="https://cdn.jsdelivr.net/gh/selfhst/icons/svg/nzbget.svg" alt="" /> NZBGet</td>
      <td>Download client</td>
      <td>Download Status page, status checks, NZB queue progress, speed display, and ARR source matching</td>
    </tr>
    <tr>
      <td><img src="https://cdn.jsdelivr.net/gh/selfhst/icons/svg/gotify.svg" alt="" /> Gotify</td>
      <td>Notifications</td>
      <td>Portal alerts for selected alert rules</td>
    </tr>
    <tr>
      <td><img src="https://cdn.jsdelivr.net/gh/selfhst/icons/svg/tmdb.svg" alt="" /> TMDB</td>
      <td>Metadata</td>
      <td>Trending slideshow, poster/backdrop enrichment, and Discover artwork</td>
    </tr>
    <tr>
      <td><span class="integration-icon">SMTP</span></td>
      <td>Email</td>
      <td>Welcome emails, expiry warnings, inactivity notices, newsletters, and access notifications</td>
    </tr>
  </tbody>
</table>

## Multi-Instance Support

The ARR and subtitle integrations support multiple named instances where the feature needs it:

| Integration | Multi-Instance Notes |
| --- | --- |
| Sonarr | Add multiple TV instances and map them to libraries or quality workflows |
| Radarr | Add multiple movie instances and map them to libraries or quality workflows |
| Lidarr | Add multiple music instances for download filtering and status matching |
| Bazarr | Add multiple subtitle instances and show widgets/tools for each configured source |
| Download clients | Add multiple clients of any supported type; the Download Status page merges all active clients |

## Download Status

The Download Status page combines every enabled download client and matches active items back to Sonarr, Radarr, or Lidarr where possible. Filters include:

- All downloads
- Sonarr
- Radarr
- Lidarr
- Other/unknown

Each client card shows online/offline state, download count, and client type. Each download row shows progress, state, speeds, size, category/label, and ARR match details when available.

## Jellyfin Activity Notes

Jellyfin activity cards use Jellystat when configured. The yearly activity heatmap uses Jellystat's `getViewsOverTime` data so the calendar reflects real per-day plays rather than placeholder activity.

If Jellystat has no historical data, run its initial sync/import and leave Jellystat running so it can collect future playback activity.
