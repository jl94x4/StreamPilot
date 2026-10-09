<div align="center">

<img src="static/logo.png" alt="StreamPilot Logo" width="420" />

# StreamPilot

**A premium, fully-automated management and analytics portal for Plex, Jellyfin, and Emby media servers.**

Built with Node.js · Express · React · Tailwind CSS

[![View Documentation](https://img.shields.io/badge/View_Documentation-e5a00d?style=for-the-badge)](https://jl94x4.github.io/StreamPilot/)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-green.svg)](https://nodejs.org/)
[![Plex](https://img.shields.io/badge/Plex-Media%20Server-orange.svg)](https://www.plex.tv/)
[![Jellyfin](https://img.shields.io/badge/Jellyfin-Media%20Server-00A4DC.svg)](https://jellyfin.org/)
[![Emby](https://img.shields.io/badge/Emby-Media%20Server-52B54B.svg)](https://emby.media/)
[![Docker Image Size](https://ghcr-badge.egpl.dev/jl94x4/streampilot/size?label=docker%20image%20size&color=blue)](https://github.com/jl94x4/StreamPilot/pkgs/container/streampilot)
[![GitHub Stars](https://img.shields.io/github/stars/jl94x4/StreamPilot.svg?style=flat&logo=github&color=gold)](https://github.com/jl94x4/StreamPilot/stargazers)
[![GitHub Forks](https://img.shields.io/github/forks/jl94x4/StreamPilot.svg?style=flat&logo=github)](https://github.com/jl94x4/StreamPilot/network/members)
[![GitHub Issues](https://img.shields.io/github/issues/jl94x4/StreamPilot.svg?style=flat&logo=github&color=red)](https://github.com/jl94x4/StreamPilot/issues)

</div>

---

StreamPilot is a self-hosted web application that turns your Plex, Jellyfin, or Emby server into a fully managed streaming service. It covers user onboarding and access expiry, personal analytics and wrap-ups, a Seerr-style Discover & Request browser, live sessions, ARR calendars and downloads, plus admin tools for collections, poster overlays, Spotify playlist sync, library scans, quality upgrades, and native FFmpeg jobs — all from one polished, mobile-first dashboard.

Once set up, users sign in with Plex OAuth or Jellyfin / Emby authentication (Quick Connect where supported) to see their own portal, activity, requests, and achievements.

---
<img width="2294" height="1218" alt="image" src="https://github.com/user-attachments/assets/16d548fb-c07c-4967-bd39-12ffdfac45c0" />
<img width="1956" height="972" alt="image" src="https://github.com/user-attachments/assets/c15bb979-b759-4fa1-ae88-772f6a04e34b" />


## Feature Overview

### Product map

| Nav | Who | What it is |
|---|---|---|
| **Home** | Everyone | Personal wrap-up cards, configurable widgets, shareable recap |
| **Dashboard** | Everyone | Live streams and community watch picks |
| **Discover & Request** | Everyone | TMDB / MusicBrainz browse, HD/4K requests, watchlist, issues |
| **Requests** | Admin | Approval queue, quotas, blocklist, and issue review |
| **Calendar** | Everyone | Sonarr / Radarr / Lidarr calendar, queues, and history |
| **Downloads** | Configurable | Unified download-client status (can be admin-only) |
| **Analytics** | Everyone | Deeper personal and server analytics |
| **Achievements** | Everyone | XP, badge ladders, streaks, and optional leaderboard |
| **Profile** | Everyone | Shareable dossier, trophy case, taste stats, last watched |
| **Preferences** | Everyone | Language, theme, notifications, and privacy overrides |
| **Support** | Everyone | In-portal tickets with comments and unread badges |
| **Users / Settings** | Admin | Access, invites, branding, layout, and integrations |
| **ColleXions** | Admin | Automated Plex collections from Trakt, MDBList, TMDB, and recipes |
| **Overlays** | Admin | New Season / Live banners and Kometa-style Layer stamps on Plex art |
| **Poster Sets** | Admin | MediUX / ThePosterDB artwork scrape and apply |
| **Editions** | Admin | Plex edition tagging from file names and TRaSH-style paths |
| **Scanner** | Admin | Autoscan-style library refresh from ARR webhooks |
| **Spotify Sync** | Admin (Plex, BETA) | Sync Spotify playlists and albums into Plex playlists |
| **Watch Sync** | Admin (Plex) | Sync watched status, ratings, collections, and watchlists with Trakt, and scrobble while the server account is playing |
| **Upgrader** | Admin | Find and upgrade non-HEVC / low-quality library titles |
| **Media Automation** | Admin | Native FFmpeg jobs (CPU, NVENC, QSV, VAAPI) |
| **Cleaner** | Admin | Missing / empty media maintenance |
| **Status** | Public / admin | Live uptime of the media stack |

Feature pages appear in the sidebar when enabled under **Settings**. Admins can reorder or hide nav items for themselves and for members.

Step-by-step guides live in the [documentation site](https://jl94x4.github.io/StreamPilot/) and under [`docs/features/`](docs/features/overview.md).

---

### Integration List

StreamPilot can connect to the apps that usually surround a Plex, Jellyfin, or Emby-style media stack.

| Category | Integrations | What they power |
|---|---|---|
| **Media servers** | Plex, Jellyfin, Emby | Login, profiles, library stats, live sessions, Dashboard, maintenance, overlays, and upgrader workflows |
| **Analytics** | Tautulli, Jellystat | Personal wrap-ups, leaderboards, watch history, Jellyfin yearly heatmap, and Achievements XP |
| **Requests** | Built-in portal (default) or Seerr | Discover, request queue, approvals — Seerr optional as engine or history import |
| **ARR apps** | Sonarr, Radarr, Lidarr | Calendars, queues, history, Discover availability, music requests, Scanner webhooks, and upgrader actions |
| **Subtitles** | Bazarr | Multi-instance subtitle widgets, tools, version display, and connection tests |
| **Download clients** | qBittorrent, Real-Debrid Client, Transmission, BitTorrent, Deluge, SABnzbd, NZBGet | Unified Downloads page with progress, speed, source filters, client health, and ARR matching |
| **Lists & collections** | Trakt, MDBList, TMDB | ColleXions auto-sync jobs, trending presets, and random / smart collections |
| **Music** | Spotify | Playlist and album import, Plex playlist matching (Spotify Sync, Plex mode, BETA) |
| **Artwork** | TMDB, MediUX, ThePosterDB, Kometa image set | Discover posters, Poster Sets, Overlay Layer stamps |
| **Notifications** | Gotify, SMTP email | Alert rules, access notifications, expiry warnings, inactivity notices, welcome emails, and newsletters |

ARR, Bazarr, and download clients support multiple named instances where needed. The Downloads page merges all enabled clients and filters active downloads by Sonarr, Radarr, Lidarr, or Other.

---

### Personal Analytics & Wrap-Up

Every user gets a rich, personalized dashboard packed with insights about their own streaming habits. A **time-period filter** (7 / 30 / 60 / 90 / 180 / 365 days / All Time) updates every card simultaneously. Metadata is cached server-side and refreshed by a background job every **30 minutes** for near-instant filter switching.

| Card | What it shows |
|---|---|
| **Server Rank** | Your current rank on the server leaderboard, a progress bar showing your percentile, a mini-leaderboard showing the 2 users above/below you, and a "plays to climb" target to beat the person above you |
| **Total Streams** | Total play count with a visual breakdown by Movies / Episodes / Tracks (with %), daily average, unique titles, and a recent watch history list |
| **Top Binge** | Your most-watched TV show with its backdrop art, synopsis, and runner-up shows with posters |
| **Top Movie** | Your most-watched movie with its backdrop art, tagline, synopsis, release year, and runner-up movies |
| **Media Profile** | Your viewer personality type (Movie Buff, TV Show Binger, Music Lover, Mixed Bag) with colour-coded breakdown bars, percentage splits, and top 3 movies + top 3 shows |
| **Watch Style** | Discovery vs Rewatch analysis with a split progress bar and your top 5 most-rewatched titles |
| **Streaming Habit** | Weekday vs Weekend split bar chart, average plays per day, and habit label (Weekend Warrior, Weekday Streamer, Balanced) |
| **Top Library** | Your most-used media library with a full ranked breakdown of all libraries |
| **Top Day** | An animated bar chart showing your plays across all 7 days of the week, highlighting your peak day |
| **Peak Hours** | An animated hourly distribution chart showing what time of day you stream the most |
| **Time of Day** | Your streaming persona (Night Owl, Early Bird, Evening Streamer, Afternoon Watcher) with a contextual description |

All cards open into detailed modals loaded with contextual data, media artwork, and dynamic charts.

**Shareable wrap-up** - Export your personal wrap-up as a PNG image from the home dashboard. The share modal previews the real card grid and supports native share on supported devices, with download as a fallback.

**Paginated watch history** - Recently Watched and Your Most Watched use responsive pagination (18 items per page on desktop, 12 on mobile) so large libraries stay fast and readable.

---

### Profile

Every member has a **Profile** page that doubles as a shareable dossier:

- Account identity, access status, and taste stats (movies, shows, music)
- Trophy case of earned Achievements badges (click through to badge detail)
- Wrap-up recap with the same shareable PNG export as Home
- Last watched / recently requested rails that deep-link into Discover
- Share URL so signed-in members can open each other's dossiers when the owner has **Show my profile** on
- **Dossier Arena** matchup on the Achievements leaderboard for comparing two users

Visibility of names, trophies, email, and libraries follows **Preferences → Privacy** (see [Privacy](#privacy)).

---

### Achievements

Opt-in gamification powered by Tautulli / Jellystat watch history (enable in **Settings → Achievements**):

- **XP and levels** from unique titles, finishes, streaks, binges, Sunday hours, and media requests
- **Badge ladders** grouped by family (movies, shows, music, genres, streaks, and more) with rarity tiers
- Unlock celebrations, a pin-able badge rack, and optional in-app notifications
- Server **leaderboard** (can be hidden independently of Achievements)
- Shareable Achievements recap image, same native-share flow as wrap-up
- Leaderboard and public trophy case honour **Show my achievements**; you always see your own badges

---

### Privacy

Identity on live streams, Dashboard Now Playing, Analytics, the Achievements leaderboard, and member profiles is privacy-first. Admins pick the **default** experience for the community; each member can then tighten (or, when names are allowed, relax) what others see about **them**.

**Admin default (Settings → Stream User Privacy)** — how non-admins see other people, including the public status page:

| Mode | What other members see | Members can still… |
|---|---|---|
| **Show Names** | Real usernames and player/device names | Hide their own name, player, profile, achievements, email, or libraries in Preferences |
| **Show as Anonymous** | Everyone appears as Anonymous | Hide extra profile fields (email, libraries, profile link, achievements). They cannot unmask their name while this mode is on |
| **Hide Completely** | Names and player labels are omitted | Same extra-field controls as Anonymous |

**Settings → Analytics → Show usernames in Analytics** is a separate default: when off, non-admins see Viewer 1 / Device 1 style labels on Analytics even if stream names are shown elsewhere.

Admins (and impersonation-as-admin) always see real identities. Use **Show as Anonymous** or **Hide Completely** when you want a private community by default; members who want to be visible wait until you switch back to **Show Names**, then opt in from Preferences.

**Member overrides (Preferences → Privacy)** — stored on the account and applied whenever the admin allows names:

| Toggle | Default | What it controls |
|---|---|---|
| **Show my name** | On | Username on Dashboard, Analytics, leaderboard, and profile |
| **Show my player name** | On | Player / device on Now Playing |
| **Show my achievements** | On | Appear on the leaderboard and show trophies on your public profile |
| **Show my profile** | On | Other members can open your dossier from the leaderboard and Dashboard (admins can still view it) |
| **Show my email** | Off | Email on your profile |
| **Show my libraries** | Off | Which libraries you can access |

Turning a toggle off only hides **you** from other members. It does not change anyone else's visibility. If the admin later hides names globally, name and player toggles pause until names are allowed again; your saved choices come back when they do.

---

### Admin Dashboard

A comprehensive control panel for the server owner:

- **Live Session Monitor** - Real-time view of all active streams with user avatar, media title, progress bar, stream type badge (Direct Play / Transcode), and a click-through technical modal showing video codec, audio codec, bitrate, channels, resolution, and transcode reason
- **User Management Table** - View all users with their Plex or Jellyfin avatar, username, email, access expiry date, last seen timestamp, and quick-action buttons (+1 Month, +1 Year, Unlimited, Revoke). Admins can also **impersonate** a member to see the portal as they do
- **Server Leaderboard** - Server-wide play count rankings across all time periods, updated automatically in the background
- **Audit Log** - Timestamped record of all system actions (access granted, revoked, extended, expired)
- **Settings UI** - Configure every aspect of the portal from the browser without touching config files
- **Customizable Home Layout** - Reorder home page sections and show or hide whole blocks (Personal Wrap-Up, Main grid, Pending Requests, Recently / Most Watched, Recently Added, Scanner, Spotify Sync) from **Settings → Layout**, with a live preview before saving. The main dashboard grid keeps a fixed balanced two-column layout so card heights stay aligned
- **Customizable Navigation** - Drag-and-drop sidebar order and visibility for admins and members independently from **Settings → Layout → Navigation**
- **Pending Requests Widget** - Surface open portal requests on the home dashboard with quick review actions, fanart-backed cards, and a count badge in the sidebar
- **Library Maintenance (Cleaner)** - Scan libraries for missing or empty media, manage exclusions, and run cleanup tasks
- **Library Upgrader (Plex / Jellyfin)** — Find non-HEVC titles, browse a poster grid with codec/HDR badges, drill into show episodes, open Plex/Jellyfin or Sonarr/Radarr deep links, snooze titles, and optionally switch ARR quality profiles with search triggers (dry-run preview, bulk select, history tab, rate limits). Enable in **Settings → Library Upgrader**.
- **Native Media Automation** — Run opt-in FFmpeg/FFprobe jobs from manual, Sonarr, Radarr, or Lidarr selections. CPU, NVENC, QSV, Intel VAAPI, and AMD VAAPI adapters are included; dry-run, copy, atomic replace, and quarantine workflows protect source media. See the [feature guide](docs/features/media-automation.md).
- **Bundled workers** — ColleXions, Overlays, Poster Sets, Editions, and Spotify Sync run inside the same Docker image. Enable each feature in Settings (no extra containers).

---

### Customizable Home Layout

Admins can tailor the home page for their community without editing code:

| Control | What it does |
|---|---|
| **Section order** | Drag and drop the major home sections into any order, including Pending Requests, the Scanner strip, and Spotify Sync |
| **Section visibility** | Toggle each section Shown or Hidden with one click |
| **Live preview** | See exactly how the layout will look before you save |
| **Locked main grid** | Left and right dashboard columns stay balanced; individual widget order inside the grid is fixed to prevent uneven card heights |

Layout settings are saved server-wide, validated on the backend, and applied to every user on the next page load. Admin-only widgets (Quick Actions, Server Admin badge) cannot be hidden through layout tampering.

---

### Dashboard

The **Dashboard** nav item is the community activity page (not the TMDB request browser). It is powered by server-wide watch history and live media activity:

**Live activity**
- Real-time stream summary cards (total streams, direct play, transcoding, bandwidth)
- Now playing cards with poster art, quality badges, player info, progress bar, and ETA
- Responsive layout: 3 stretched cards by default, up to 4 across on ultra-wide displays when 4 or more streams are active
- Activity refreshes every second while the page is open

**Recently added**
- Movies, TV shows, and music grids with poster quality badges
- 20 items per section on desktop and 12 on mobile by default
- 10-column poster grid on large screens
- Configurable limit dropdown (12, 20, 50, 100, 150, 200, 250 items) with preference saved in the browser

**Trending and community picks**
- **Trending This Week** - What the whole server has been watching in the last 7 days
- **Top Movies / Top Shows** - The most-played movies and shows over the past month
- **Weekend Warriors** - Content that spikes on Fridays, Saturdays, and Sundays
- **Night Owl Club** - Content most watched between midnight and 5am
- **All-Time Greats** - The highest play-count content ever on the server
- **Cult Classics** - Niche content with extremely high plays relative to its tiny viewer count
- **Blast from the Past** - Pre-2000 titles getting recent love

All dashboard items display server artwork, play counts, and quality badges (4K, HDR, AV1/HEVC, Atmos, and more). Trending and analytics caches are reused on startup when still fresh, so the portal loads quickly after restarts.

---

### Discover & Request

Built-in Seerr-style browse and request. Members search TMDB (and MusicBrainz for Lidarr) and submit requests; admins approve into Sonarr, Radarr, and Lidarr. Seerr / Overseerr / Jellyseerr remains an optional request engine, or a one-shot history import source.

**Browse**
- Home rails for trending, popular, upcoming, genre collections, **Because You Watched**, and Lidarr music charts
- Movies, Series, and Music tabs with filters, infinite scroll, and staggered poster skeletons
- Library availability badges (Available / Partial / Requested) from Sonarr, Radarr, and Lidarr, cached for first paint
- Title detail pages with cast, ratings, similar titles, and TVDB poster fallback when TMDB art is missing

**Requesting**
- **HD and 4K together** when you run separate *arr instances — pick one or both in the request sheet
- Advanced options: quality profile, root folder, tags, and TV season picker (Missing only / Deselect all)
- Music requests through Lidarr (artist pages, albums)
- Member quotas, auto-approve rules, watchlist, and **Notify me** when a title is not requestable yet
- **My Requests** and **My Issues** for members; admins review issues from the Requests page

**Requests page (admin)**
- **Status tabs** - Pending, Failed, Approved, and Declined with live counts
- **Request cards** - Poster, requester, quality, folder, tags, seasons, genres, language, and overview with faded fanart
- **Review & Approve** - Full-screen modal with season picker, quality profile, root folder, tags, and request-as user override
- **Quick actions** - Approve, edit, decline, retry failed requests, and delete from the list
- **Issues / Blocklist** - Reported problems and blocked titles

**Home dashboard widget**
- **Pending Requests section** - Movable and hideable from **Settings → Layout**
- **Inline review** - Open the same approval modal directly from the dashboard widget
- **Wide layout support** - Two-column request cards on ultra-wide home layouts

Configure engine, quotas, and defaults in **Settings → Request**. Feature guide: [Discover & Request](docs/features/discover-request.md).

---

### Media Stack

Browse your Sonarr, Radarr, Lidarr, Bazarr, and download-client activity directly inside the portal:

- **Release Calendar** - Upcoming TV episodes and movie releases with poster art, air dates, and grabbed/missing status
- **Active Queue** - Live download queue from Sonarr, Radarr, and Lidarr-aware matching with progress and status
- **Recent History** - Import and grab history across configured ARR services
- **Month Navigation** - Browse releases by month with auto-advance to the next month that has content
- **Smart ID Matching** - Uses IMDb, TMDB, and TVDB IDs to accurately map and display metadata
- **Bazarr Tools** - Multi-instance subtitle widgets and quick subtitle tooling
- **Download Status** - Unified view of qBittorrent, Real-Debrid Client, Transmission, BitTorrent, Deluge, SABnzbd, and NZBGet downloads with Sonarr/Radarr/Lidarr filters

Configure ARR apps, Bazarr, request apps, and download clients in **Settings → Media Stack**.

---

### Library Upgrader

A powerful, built-in tool for server admins to identify and upgrade sub-optimal media in your library, fully integrated with your Sonarr and Radarr instances. Enable it in **Settings → Library Upgrader**.

**Core Capabilities:**
- **Advanced Media Filtering** - Index your entire library to easily filter and browse your media by codec, resolution, and size. Instantly locate H.264 files or check HDR availability per show, so you can easily upgrade to a different codec when you need to.
- **Deep ARR Integration** - Directly connects to your Sonarr and Radarr instances. Automatically matches Plex/Jellyfin items to their exact Radarr/Sonarr equivalents.
- **Multi-Instance Support** - Supports multiple Radarr/Sonarr instances simultaneously (e.g., separate 1080p and 4K instances) mapped to different libraries.
- **Smart Quality Profile Mapping** - Map your preferred Sonarr and Radarr quality profiles to your libraries, allowing you to easily switch profiles and trigger searches with a single click.

**Dashboard & Navigation:**
- **Rich Visual Grid** - Browse flagged movies and TV shows through a premium, responsive poster grid overlaid with real-time codec, resolution, size, and HDR badges.
- **Advanced Filtering & Sorting** - Filter by Codec (H.264, HEVC, AV1, VP9), Resolution (SD, 720p, 1080p, 4K), Quality (WebDL, Remux, Bluray), or special features (Missing HDR, Zero-byte files). Sort by size, watch count, or age.
- **Deep Episode Inspection** - Click into any TV show to open a detailed, season-by-season episode drawer showing exact file sizes, codecs, and current Sonarr custom formats/qualities for every individual episode.
- **Missing Episode Detection** - Instantly surfaces episodes that are in Plex but missing from Sonarr, or vice versa.

**Upgrade Actions:**
- **One-Click Upgrades** - Switch Sonarr/Radarr quality profiles directly from the portal and automatically trigger a search for the new quality.
- **Bulk Operations** - Select multiple movies or shows at once to upgrade their quality profiles and trigger searches in bulk.
- **Granular Search Triggers** - Trigger a search for an entire series, a specific season, or drill down to search for a single episode right from the UI.
- **Background Processing Queue** - Upgrades are sent to a background task queue with configurable rate limits (e.g., max 50 actions per hour) to prevent overwhelming your indexers or ARR instances.
- **Dry-Run Preview** - Preview exactly which items will be upgraded, skipped (if already on the target profile), or fail, before committing to any bulk changes.

**Management & Tracking:**
- **Action History** - A dedicated audit log tracking all your manual and automated upgrade actions, profile changes, and search triggers.
- **Snooze & Ignore** - Snooze specific titles to hide them from the upgrader view for a set duration, or permanently exclude specific libraries, shows, or movies.
- **Reclaimable Space Estimation** - View live statistics on how many gigabytes of storage could be reclaimed by upgrading your media to more efficient formats.

---

### ColleXions

Admin-only Plex collection automation. The portal ships the React UI (`client/collexions/`) and **bundles** the Flask/`ColleXions.py` worker from `collexions/` inside the same Docker image. Enable under **Settings → Collexions** and save — the portal starts the worker on localhost automatically (service key and internal URL are generated for you).

Onboarding (and Config → Import from portal) auto-fills Plex URL/token and TMDB from portal Settings when available; Trakt/MDBList keys are entered in ColleXions if you use those sources. Migrating from standalone ColleXions: use **Config → Import config.json** with your existing file, review, then **Save Config**. Worker state lives under `config/collexions/` on the portal volume.

| Area | Purpose |
|---|---|
| **Dashboard / Gallery** | Collection health and artwork overview |
| **Creator** | Build from Trending presets, TMDB Discover filters, Trakt / MDBList import lists, and custom recipes |
| **Jobs** | Scheduled auto-sync (including Random smart collections) with Run Now |
| **Hubs** | Pin collections and keep **Show on home** / **Show on friends home** through syncs |
| **Stats / Logs / Config** | Sync statistics, worker logs, and credentials |

Auto-sync jobs refresh membership from the source list without rebuilding the collection by hand. Hub visibility is restored after each sync so Plex home pins stay put.

---

### Scanner

Admin-only, Autoscan-inspired library refresh — no second container. Enable in **Settings → Scanner**.

- Receives Sonarr / Radarr / Lidarr webhooks (On Import + On Upgrade) and manual paths
- Optional **Import from Autoscan** `config.yml` for auth, triggers, and path rewrites
- Queues folder scans with a configurable minimum age, then sends partial refreshes to **Plex, Jellyfin, and/or Emby**
- Home widget for queue/activity, live activity log, and reason badges (import, upgrade, delete, rename, manual)

Plex scans use the **direct server URL and token** from Settings → Plex (`http://192.168.x.x:32400` — plex.tv login alone is not enough). Feature guide: [Scanner](docs/features/scanner.md).

---

### Spotify Sync

Admin-only **Plex** tool (BETA) that syncs Spotify playlists, albums, and artists into Plex playlists. The portal ships a native UI (`client/spotify-sync/`) and **bundles** the [spotify-to-plex](https://github.com/jjdenhertog/spotify-to-plex) worker in the same Docker image. Enable under **Settings → Spotify Sync**.

| Area | Purpose |
|---|---|
| **Playlists** | Pull saved Spotify playlists and albums, paste a playlist / album / artist link, then **Sync to Plex** |
| **Users** | Connect Spotify accounts (OAuth via the portal callback) |
| **Sync** | Run playlist-to-Plex jobs plus optional worker jobs (albums, users, Lidarr, SLSKD, MQTT) |
| **Matching / Integrations / Logs** | Match filters, Lidarr / Tidal / SLSKD status, and sync history |

**Sync to Plex** matches tracks already in your Plex library and creates or updates a Plex playlist in Spotify track order. Unmatched tracks are skipped; the Spotify cover is applied as the Plex playlist poster. Plex URL and token from **Settings → Plex** are pushed into the worker automatically.

Pick **one** schedule in Settings: the worker’s built-in cron (daily ~02:00 UTC) or a portal **Background Tasks** interval. Optional Home dashboard widget and `spotify_sync_failed` admin notifications. Worker state lives under `config/spotify-to-plex/` on the portal volume.

You need a Spotify Developer app (Client ID, Client Secret, and an encryption key) and must register the redirect URI shown in Settings. Feature guide: [Spotify Sync](docs/features/spotify-sync.md).

---

### Overlays

Admin-only Plex artwork overlays (Plex mode). The Python worker is bundled in the image. Enable in **Settings → Overlays**.

**Banners (core)** — Live, New Season, New Episode, and Top 10 badges with Preview / Run / Promote. New Season stamps show posters (and optionally season posters); New Episode stamps season posters and episode thumbs. Optional binge grouping skips episode thumbs when a season dumps together.

**Recently Added** — Plex `addedAt` window, skipped when Live or New Season already claimed the show.

**Media / Layer** — Kometa-style Layer families composited in one pass onto movie and TV posters: resolution (including 4K / UHD / HDR / Dolby Vision on shows from episode streams), edition, audio/video format, status, streaming, network, ratings, ribbons, language flags, and more. Preview first, then Promote to live Plex art. Per-item and bulk revert restore originals from backups.

The **Placement** tab lets you drag/resize banner and Layer slots on sample art. Each job has its own schedule. Feature notes: [overlays/README.md](overlays/README.md).

---

### Poster Sets

Admin tool to scrape **MediUX** and **ThePosterDB** set URLs and upload artwork to Plex (show covers, season covers, backgrounds, title cards). Browse your libraries, paste a set URL, inspect a set before apply, and track queue/history. After each successful upload the worker can remove the Kometa `Overlay` label so Layer/Kometa can restamp the new art. Enable in **Settings → Poster Sets**.

---

### Editions

Admin Plex edition tagging driven by a bundled Edition Manager worker (file names and TRaSH-style paths → Extended, Director’s Cut, IMAX, Criterion, and similar). Preview and apply from the **Editions** page. Enable in **Settings → Editions**.

---

### Support

In-portal ticketing for members and admins:

- Open tickets with category, subject, and optional linked Discover issue / title
- Threaded comments, emoji reactions, and unread badges in the sidebar
- Admins filter Open / Resolved / Closed and reply from the same inbox

Enable in **Settings → Support**.

---

### Community Live Chat

**One-page Discord-style layout:**
- Left: channel list (#general, etc.) with unread badges
- Right: live message thread + compose box
- Auto-refresh  while a channel is open
- Enter to send, Shift+Enter for a new line

**Admin channel management**
- New → create channels (name + optional description)
- Delete channel on the active room

**Member features**
- Any logged-in member can read/post in all channels
- Delete your own messages; admins can delete any message
- Avatars link to member profiles
- Unread counts on nav + per-channel badges

**Notifications:**
- Type @ in the message box to get an autocomplete list of portal usernames (will send mention notification)
- Mentions are highlighted in messages (clickable, opens profile)
- Chat @mention notifications global toggle (chatMentionNotifyInApp, on by default). When enabled, mentioned users get an in-app bell notification linking to the channel.

Per-user (Preferences → Notifications)
- Chat @mentions — opt-out toggle (notifyChatMentionInApp, on by default). Shown only when community chat is enabled.

Members can control their own mention alerts under their own profile Preferences.

---

### User Onboarding & Access Management

- **Invite Link System** - Generate shareable invite links with a configurable max-use limit and custom duration. Users claim access via a branded landing page
- **Plex OAuth** - Secure login via official Plex.tv authentication. No Plex passwords stored
- **Jellyfin Auth + Quick Connect** - Jellyfin portals support username/password auth and one-click Quick Connect, with admin detection from Jellyfin policy
- **Automated Temporary Access** - Auto-grant configurable temporary access periods (e.g., 3 days) to all new users
- **Access Expiry** - Set hard expiry dates per user. The system automatically revokes portal access when time is up
- **Inactivity Cleanup** - Automatically remove users who haven't streamed in a configurable number of days, with per-user exemptions available
- **Grace Period Notifications** - Warn users via email before their access expires

---

### Automated Communications

Beautiful, responsive HTML emails sent automatically:

| Email Type | Trigger |
|---|---|
| **Welcome** | Immediately when a user joins |
| **Temporary Access Warning** | When a temporary access user is approaching expiry |
| **Access Expired** | When a user's access is automatically removed |
| **Inactivity Warning** | Before an inactive user is purged |
| **Weekly/Monthly Newsletter** | Scheduled email featuring newly added Movies, TV Shows, and Music |

---

### Public-Facing Pages

- **Landing Page** - A sleek login page showing live library stats (total movies, shows, music) and your configured server branding
- **Status Page** - A public `/status` dashboard showing the live uptime of your media server, analytics companion, and download clients. Stream identities on that page follow **Stream User Privacy**
- **Invite Claim Page** - A dedicated, shareable page for invited users to claim their account

---

### Localization

The UI can be switched per user from the language menu. Catalogs currently include **English, French, German, Spanish, Portuguese (Brazil), Italian, Japanese, Polish, Dutch, and Russian**. Missing keys fall back to English. See [docs/development/translations.md](docs/development/translations.md) if you want to contribute strings.

---

### Custom UI Themes

- **Built-in themes** - Users pick from **Dynamic (Chameleon)**, **Plex Dark**, **Sleek Slate**, **Nordic Frost**, **Jellyfin Purple**, **Emby Green**, **Emerald Green**, **Neon Midnight**, **Crimson Red**, **Deep Amethyst**, **Sunset Orange**, **Ocean Teal**, **Rose Pink**, **Royal Blue**, **Graphite**, **Cyber Lime**, or **Aurora** from the navigation panel.
- **Admin Configuration** - Admins can set the default theme for new users and visitors from **Settings → Portal UI**.
- **Dynamic Accent Colors** - Interface elements, charts, active navigation states, and borders update to match the selected theme's brand palette.

---

### Mobile-First Design

- Full bottom navigation bar on mobile with a **More** overflow for extra pages
- Clean top header on mobile showing only the server logo and essential actions
- All modals, cards, and charts are fully responsive and touch-friendly
- Safe area inset support for modern iOS and Android browsers
- **Installable PWA** — add to home screen on iOS and Android with branded icons
- Preferences page for language, theme, and personal toggles without opening Settings

---

## Technology Stack

| Layer | Technology |
|---|---|
| **Backend** | Node.js, Express.js, bundled workers (ColleXions, Overlays, Poster Sets, Editions, Spotify Sync) |
| **Frontend** | React 18 (bundled via esbuild), TypeScript |
| **Styling** | Tailwind CSS v3 |
| **Auth** | JWT (httpOnly cookies) + Plex.tv OAuth or Jellyfin / Emby authentication |
| **Data** | Local JSON flat-files (no database required) |
| **Email** | Nodemailer (compatible with any SMTP provider) |
| **Icons** | Lucide React |
| **Compression** | GZIP via `compression` middleware |

---

## Security

- **No Plex Passwords** - Plex authentication is handled by Plex.tv OAuth. Jellyfin password login is exchanged directly with your Jellyfin server and is not stored by the portal
- **JWT Session Security** - Cookies use `httpOnly`, `secure`, and `sameSite: lax` flags to reduce XSS and CSRF risk while keeping auth redirects reliable
- **Rate Limiting** - Authentication endpoints have strict rate limiting to prevent brute-force attacks
- **HTTP Security Headers** - HSTS, X-Content-Type-Options, X-Frame-Options, X-XSS-Protection, Referrer-Policy, and Permissions-Policy enforced on every response
- **Admin Protection** - Admin routes require an authenticated admin session. Plex admins are verified from server ownership; Jellyfin admins are verified from Jellyfin user policy
- **Reverse Proxy Ready** - Supports Nginx, Caddy, and Cloudflare via `X-Forwarded-Proto` / `X-Forwarded-For` header trust, including optional subpath hosting (e.g. `https://media.example.com/portal`)
- **Injection Proof** - Uses a flat-file JSON system, making SQL injection structurally impossible

---

## Getting Started

### Prerequisites

- **Node.js** v20.6 or newer (for native `.env` support)
- A **Plex Media Server** with an admin Plex token, or a **Jellyfin Server** with an admin API key
- *(Optional)* An SMTP provider for email notifications

### Installation

**1. Clone the repository**
```bash
git clone https://github.com/jl94x4/StreamPilot.git
cd StreamPilot
```

**2. Install dependencies**
```bash
npm install
```

**3. Generate your JWT secret**
```bash
printf 'JWT_SECRET=%s\n' "$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")" > .env
```

**4. Start the application**
```bash
npm start
```

> `npm start` automatically builds the React frontend and Tailwind CSS, then starts the server on port **2121**.

**5. First-time admin setup**

- Navigate to `http://localhost:2121`
- Choose **Plex**, **Jellyfin**, or **Emby** in the first-time setup wizard
- Plex setup uses Plex OAuth/token and server selection
- Jellyfin setup uses Jellyfin URL + API key, then supports Jellyfin login and Quick Connect
- Go to **Settings** in the sidebar to configure **Media Server**, integrations, SMTP, temporary access settings, branding, and scheduled tasks

### Media server modes

| Mode | Authentication | Analytics companion | Branding |
|---|---|---|---|
| **Plex** | Plex.tv OAuth, Plex token, selected owned server | Tautulli | Plex or custom theme |
| **Jellyfin** | Jellyfin username/password or Quick Connect | Jellystat | Jellyfin server icon and splash screen proxy, or custom theme |
| **Emby** | Emby-compatible server connection | Optional external analytics/status tools | Emby or custom theme |

Plex mode keeps the original Plex OAuth and Tautulli flow. Jellyfin mode uses your Jellyfin URL/API key for user sync, session activity, Quick Connect, and server branding assets. Jellystat provides rich analytics on par with Tautulli where configured.

---

## Docker Deployment

The recommended way to run StreamPilot in production is Docker with a persistent volume for `config/`.

### Pre-built images (GHCR)

Official images are published automatically on every push to `main`, `beta`, `testing`, and `nightly`:

| Tag | When updated | Image |
|---|---|---|
| `latest` | Every push to `main` and every release tag `v*` | `ghcr.io/jl94x4/streampilot:latest` |
| `beta` | Every push to `beta` | `ghcr.io/jl94x4/streampilot:beta` |
| `nightly` | Every push to `nightly` (cutting-edge; may change daily) | `ghcr.io/jl94x4/streampilot:nightly` |
| `testing` | Every push to `testing` | `ghcr.io/jl94x4/streampilot:testing` |
| `1.8.0` / `v1.8.0` | Matching GitHub release | `ghcr.io/jl94x4/streampilot:1.8.0` |

The same tags are also published as `ghcr.io/jl94x4/server-manager-portal` so existing containers keep updating until their repository is changed to `ghcr.io/jl94x4/streampilot`.

Pull and run without building locally:

```bash
docker pull ghcr.io/jl94x4/streampilot:latest
docker run -d \
  --name streampilot \
  -p 2121:2121 \
  -e JWT_SECRET="your-secret-at-least-32-chars" \
  -e FORCE_SECURE_COOKIES=true \
  -e PUBLIC_BASE_URL=https://portal.example.com \
  -v "$(pwd)/config:/app/config" \
  -v "$(pwd)/backup:/app/backup" \
  ghcr.io/jl94x4/streampilot:latest
```

Use the `beta` tag to test upcoming features before they land on `latest`. Use `nightly` for the latest unreleased work. Use `testing` for experimental branch builds.

### Quick start (Docker Compose)

**1. Clone and configure**

```bash
git clone https://github.com/jl94x4/StreamPilot.git
cd StreamPilot
cp .env.example .env
```

Edit `.env` and set `JWT_SECRET` (at least 32 characters). If the portal is served over HTTPS behind a reverse proxy, also set:

```env
FORCE_SECURE_COOKIES=true
PUBLIC_BASE_URL=https://portal.example.com
```

**2. Build and run**

```bash
docker compose up -d --build
```

The portal listens on port **2121** by default. Open `http://localhost:2121` and complete the first-time setup for Plex or Jellyfin.

**3. Persisted data**

| Host path | Container path | Purpose |
|---|---|---|
| `./config` | `/app/config` | All JSON settings, users, caches, logs |
| `./backup` | `/app/backup` | Rolling backup snapshots |

On first startup, any legacy JSON files still in the project root are automatically migrated into `config/`.

### Docker Compose tips

- Change the published port: set `PORT=8080` in `.env` (maps host `8080` → container `2121`).
- Integrations on your LAN (Sonarr, Radarr, Lidarr, Bazarr, Tautulli, Jellystat, request apps, and download clients): set `ALLOW_PRIVATE_INTEGRATION_URLS=true` and use reachable URLs from inside the container (e.g. `http://host.docker.internal:8989` on Docker Desktop, or your host IP on Linux).
- View logs: `docker compose logs -f portal`
- Update: `git pull && docker compose up -d --build`

### Native Media Automation (optional)

The image includes FFmpeg/FFprobe and Debian Bookworm Intel/AMD VAAPI userspace packages. CPU mode requires no GPU. The default Compose service remains unprivileged and does not mount media or GPU devices, so it starts normally on hosts without them.

Mount only the required media roots (read/write for copy, replace, or quarantine). For Intel QSV/VAAPI or AMD VAAPI, pass `/dev/dri` and add the host `video`/`render` group IDs. For NVIDIA NVENC, install NVIDIA Container Toolkit and uncomment the runtime/environment example in `docker-compose.yml`. Keep `privileged: false`.

Worker Test runs a short synthetic encode for each non-CPU adapter when matching encoders are present. Still validate real NVENC/QSV/VAAPI jobs with a controlled copy after changing drivers or mappings. An explicitly selected unavailable mode fails instead of silently falling back unless CPU fallback is enabled. Begin with dry-run, then copy mode. Atomic replace requires the final temporary output to share a filesystem with its destination, and quarantine requires writable space for the original.

Version 1 accepts manual plus Sonarr/Radarr/Lidarr webhook jobs, uses only the built-in native executor, and does not expose a plugin API or promise scheduled filesystem discovery. Full setup and safety notes: [Native Media Automation](docs/features/media-automation.md).

### Bundled workers

**ColleXions, Overlays, Poster Sets, Editions, and Spotify Sync** are built into the portal image. No extra containers are required.

1. Rebuild/redeploy the portal image so it includes the bundled workers.
2. In Settings, turn **Enable** ON for each feature you want and click **Save Settings**.
3. Open the matching nav item — ColleXions can import an old `config.json` if you are migrating. Spotify Sync is Plex-only and needs Spotify API credentials on its Settings tab.

Worker data persists under `./config/collexions/`, `./config/overlays/`, `./config/poster-sets/`, `./config/editions/`, and `./config/spotify-to-plex/`. Advanced: set `COLLEXIONS_EMBEDDED_PORT` if you need a different localhost port for ColleXions (default `15755`).

### Build the image manually

```bash
docker build -t streampilot .
docker run -d \
  --name streampilot \
  -p 2121:2121 \
  -e JWT_SECRET="your-secret-at-least-32-chars" \
  -e FORCE_SECURE_COOKIES=true \
  -e PUBLIC_BASE_URL=https://portal.example.com \
  -v "$(pwd)/config:/app/config" \
  -v "$(pwd)/backup:/app/backup" \
  streampilot
```

### Reverse proxy (Nginx / Caddy / Traefik)

Run the container on an internal port and proxy HTTPS to it.

#### Root hosting (recommended)

Example Caddy:

```caddy
portal.example.com {
    reverse_proxy localhost:2121
}
```

Set `FORCE_SECURE_COOKIES=true` and `PUBLIC_BASE_URL=https://portal.example.com` so session cookies and email links use the public URL.

#### Subpath hosting

You can also host the portal under a path on an existing domain, for example `https://media.example.com/portal` alongside Plex, Jellyfin, or other services.

Example Caddy:

```caddy
media.example.com {
    handle /portal/* {
        reverse_proxy localhost:2121
    }
}
```

Set these environment variables:

```env
BASE_PATH=/portal
PUBLIC_BASE_URL=https://media.example.com/portal
FORCE_SECURE_COOKIES=true
```

`BASE_PATH` can be omitted if `PUBLIC_BASE_URL` already includes the path — the app derives it automatically. Leave both unset for root hosting; existing deployments are unchanged.

The proxy must forward requests **with** the `/portal` prefix intact (do not strip the path before the app). The portal rewrites asset and API URLs internally.

### Unraid

StreamPilot is available in the **Unraid Community Applications (CA) store**!

#### Install via Community Applications (Recommended)

1. Open the **Apps** tab in your Unraid dashboard
2. Search for **"StreamPilot"**
3. Click **Install**
4. Set your **JWT Secret** and adjust appdata paths if needed (default: `/mnt/user/appdata/server-manager-portal/`)
5. Click **Apply** and open the WebUI — you're done! 🎉

#### Manual Template Installation (Alternative)

If you prefer to install the template manually on Unraid 6+:

1. Download the template file: [`unraid/server-manager-portal.xml`](unraid/server-manager-portal.xml)
2. Rename the file with a `my-` prefix, e.g. `my-server-manager-portal.xml`
3. Upload it to your Unraid server at: `/boot/config/plugins/dockerMan/templates-user/`
4. Go to **Docker** → **Add Container** and select **StreamPilot** from the **User Templates** dropdown
5. Set **JWT Secret** and adjust appdata paths (defaults: `/mnt/user/appdata/server-manager-portal/`)
6. Apply and open the WebUI

The template uses `ghcr.io/jl94x4/streampilot:latest` by default. Other tags: `:beta`, `:nightly`, or a pinned version such as `:1.8.0`.

#### Media Automation paths and GPU (Unraid)

The Unraid template includes optional fields for Native Media Automation media mounts and GPU passthrough. **New installs** see these fields in the template. **Existing containers do not pick them up automatically** when you update the image — Unraid keeps your saved Docker config, and image updates only refresh the image.

To enable Media Automation on an existing install:

1. Edit the container in Unraid (**Docker** → container → **Edit**).
2. Add media mounts (or fill the template path fields if present):

   | Template / mapping | Container path | Example host path |
   | --- | --- | --- |
   | Media Root | `/media` | `/mnt/user/media` |
   | TV Shows | `/tv` | `/mnt/user/media/tv` |
   | Movies | `/movies` | `/mnt/user/media/movies` |
   | Music | `/music` | `/mnt/user/media/music` |

   Container paths must match Sonarr / Radarr / Lidarr (or use Scanner / Media Automation path rewrites). Leave unused paths empty. Use **Add another Path, Port, Variable, Label or Device** if your saved template does not show the new fields yet.
3. **Intel / AMD GPU:** add a Device with Host and Container both set to `/dev/dri`.
4. **NVIDIA GPU:**
   - Install the Unraid **Nvidia Driver** plugin and note your GPU UUID.
   - Add variable `NVIDIA_VISIBLE_DEVICES` = your GPU UUID (or `all`).
   - Keep / set `NVIDIA_DRIVER_CAPABILITIES` = `all`.
   - Enable **Advanced View** and append `--runtime=nvidia` to **Extra Parameters**, for example:

     ```text
     --restart=unless-stopped --hostname=streampilot --runtime=nvidia
     ```
5. Apply the container, enable Media Automation in **Settings**, and run **Test worker** before using copy/replace modes.

CPU-only Media Automation needs media path mounts only — no GPU device or NVIDIA runtime. Full safety notes: [Native Media Automation](docs/features/media-automation.md).

### Environment variables

| Variable | Required | Description |
|---|---|---|
| `JWT_SECRET` | Yes | Session signing secret (min 32 characters) |
| `PUID` | No | User ID to run the app as (default `1000`; `99` on Unraid) |
| `PGID` | No | Group ID to run the app as (default `1000`; `100` on Unraid) |
| `PORT` | No | Listen port inside the container (default `2121`) |
| `BIND_HOST` | No | Bind address (default `0.0.0.0`) |
| `CONFIG_DIR` | No | Runtime data directory (default `/app/config` in Docker) |
| `MEDIA_AUTOMATION_CONFIG_DIR` | No | Media Automation state (default `<CONFIG_DIR>/media-automation`) |
| `MEDIA_AUTOMATION_WORK_DIR` | No | Media Automation work metadata (default `<MEDIA_AUTOMATION_CONFIG_DIR>/work`) |
| `PUBLIC_BASE_URL` | Optional | Bootstrap public HTTPS URL for reverse-proxy / subpath hosting. After first login, set **Settings → Portal UI → Public Base URL** — invite emails and shareable links prefer that UI value. Include a subpath when needed, e.g. `https://media.example.com/portal` |
| `BASE_PATH` | No | URL prefix when hosted under a subpath (e.g. `/portal`). Leave empty for root hosting |
| `FORCE_SECURE_COOKIES` | Recommended | Set `true` when behind HTTPS |
| `ALLOW_PRIVATE_INTEGRATION_URLS` | No | Allow LAN/private URLs for Arr stack integrations |
| `SETUP_TOKEN` | No | Token for remote first-time setup |
| `CLIENT_ID` | No | Fixed Plex OAuth client id (auto-generated if unset; Plex mode only) |
| `COLLEXIONS_EMBEDDED_PORT` | No | Localhost port for the bundled ColleXions worker (default `15755`) |

See `.env.example` for a full template.

---

## Configuration

All configuration is managed through the **Settings UI** in the browser. Key options include:

| Setting | Description |
|---|---|
| Media Server | Choose Plex, Jellyfin, or Emby |
| Plex Token / Server | Plex admin token, selected server, and optional direct Plex URL |
| Jellyfin / Emby URL and API Key | Media server URL and API key for users, sessions, Quick Connect where supported, and branding proxy |
| Branding & UI | Portal accent colour, server logo, Jellyfin/Plex preset, and splash background |
| Temporary Access Duration | Number of days new users get for free |
| Inactivity Threshold | Days of inactivity before auto-removal |
| SMTP Settings | Host, port, username, password, from address |
| Newsletter Schedule | Weekly or monthly, with day/time selection |
| Home Layout | Section order and visibility for the user home page, including Pending Requests |
| Navigation | Sidebar order and visibility for admins vs members |
| ARR Instances | Sonarr, Radarr, and Lidarr URLs/API keys for calendars, queues, history, Discover availability, and download matching |
| Bazarr Instances | Subtitle widgets, tools, version display, and connection tests |
| Download Clients | qBittorrent, Real-Debrid Client, Transmission, BitTorrent, Deluge, SABnzbd, and NZBGet for the Downloads page |
| Request App (optional) | Seerr / Jellyseerr URL and API key — use as request engine, Discover metadata source, or history import |
| Tautulli / Jellystat | Tautulli for Plex analytics, Jellystat for Jellyfin analytics |
| Stream User Privacy | Default identity policy for non-admins: show names, show as Anonymous, or hide completely. Members override their own profile in Preferences when names are allowed |
| Show usernames in Analytics | Whether non-admins see real names on Analytics (otherwise Viewer 1 / Device 1) |
| Scanner | Autoscan-style library refresh, ARR webhooks, path rewrites |
| Spotify Sync | Enable bundled Spotify-to-Plex worker, Spotify API credentials, sync schedule (Plex mode, BETA) |
| ColleXions / Overlays / Poster Sets / Editions | Enable bundled Plex workers (collections, Layer stamps, artwork sets, edition tags) |
| Achievements / Support | XP/badges/leaderboard, and in-portal tickets |
| Alerts | Gotify connection and alert rules |
| Status Page Services | Define services and their health check URLs |

---

## Background Tasks

The **Settings → Background Tasks** page shows the active scheduler and lets admins run jobs manually. Task labels follow the selected media player:

| Task | Plex mode | Jellyfin mode |
|---|---|---|
| User sync | Sync Plex Users | Sync Jellyfin Users |
| Expiry checks | Email users nearing expiry | Same |
| Revoke access | Removes expired Plex access | Revokes expired portal access |
| Inactive cleanup | Revokes inactive users | Revokes inactive Jellyfin portal users |
| Analytics cache | Uses Plex/Tautulli data where configured | Uses Jellyfin/Jellystat data where configured |
| Library stats | Plex Stats Builder | Hidden in Jellyfin mode |
| Maintenance index | Builds media/request index for cleanup rules | Same |
| Media quality index | Also powers Library Upgrader when enabled (Plex or Jellyfin codec scan) | Episode stats for shows when Upgrader enabled |
| Auto rolling backup | Creates rolling config backups | Same |
| Spotify Sync | Calls the bundled worker on your Settings interval when schedule mode is Portal Background Tasks | Hidden in Jellyfin / Emby mode |

The **Settings → System** diagnostics page uses the same media-aware task list so Jellyfin portals are not penalized for Plex-only jobs.

---

## Project Structure

```
StreamPilot/
├── index.js            # Backend: Express API, Plex/Jellyfin integrations, auth, email, background jobs
├── index.tsx           # Frontend entry point
├── client/             # React application source
│   ├── App.tsx         # App shell, routing, responsive layout
│   ├── screens.tsx     # Dashboards, login, and shared screens
│   ├── home/           # User dashboard layout and widget renderers
│   ├── discovery/      # Discover & Request (TMDB / Lidarr browse)
│   ├── requests/       # Portal request review UI (admin panel, approval modal, home widget)
│   ├── achievements/   # XP, badges, leaderboard
│   ├── profile/        # Member dossier and wrap-up
│   ├── support/        # In-portal tickets
│   ├── upgrader/       # Library Upgrader poster browse
│   ├── scanner/        # Autoscan-style library refresh UI
│   ├── spotify-sync/   # Spotify Sync admin UI (playlists to Plex)
│   ├── collexions/     # ColleXions admin UI (proxied to bundled worker)
│   ├── overlays/       # Overlay preview / placement UI
│   ├── poster-sets/    # MediUX / ThePosterDB UI
│   ├── editions/       # Edition tagging UI
│   ├── media-automation/
│   ├── settings/       # Settings UI
│   ├── preferences/    # Member language / theme preferences
│   ├── shared/         # API helpers, types, theme, skeletons, wrap-up cards
│   ├── setup/          # First-time setup wizard
│   └── maintenance/    # Library Cleaner panel
├── collexions/         # Bundled ColleXions worker
├── overlays/           # Bundled overlay / Layer worker
├── poster-sets/        # Bundled Poster Sets worker
├── editions/           # Bundled Editions worker
├── docs/               # Feature guides (also published to GitHub Pages)
├── input.css           # Tailwind CSS source
├── static/             # Built frontend assets
├── lib/                # Backend helpers (data paths, workers, request engine)
├── config/             # Runtime JSON data (gitignored, created on first run)
├── Dockerfile
├── docker-compose.yml
├── .github/workflows/
│   └── docker-publish.yml  # Publishes :latest, :beta, :nightly, and :testing to GHCR
├── unraid/
│   └── server-manager-portal.xml
├── .env.example
├── package.json
└── .env                # JWT_SECRET (not committed to git)
```

Runtime-generated files (stored in `config/`, not committed to git):
- `config/config.json` - Server configuration
- `config/users.json` - User records
- `config/audit-log.json` - System action log
- `config/trending-cache.json` - Cached leaderboard and trending data

On first startup after an upgrade, any legacy JSON files still in the project root are automatically moved into `config/`.

---

## Release History

Please see the [CHANGELOG.md](CHANGELOG.md) for a detailed history of changes, new features, and bug fixes.

---

## Contributors

*   [Nerdy-Technician](https://github.com/Nerdy-Technician) - Added Jellyfin Support 🚀

---

## License

This project is open-source and available under the [MIT License](LICENSE).

---

<div align="center">
Made with care for the self-hosting community.
</div>
