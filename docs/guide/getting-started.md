# Getting Started

## Requirements

- Node.js 20.6 or newer for native `.env` support.
- A Plex Media Server with an admin Plex token, or a Jellyfin/Emby server with an admin API key.
- An SMTP provider if you want automated email notifications.

## Install Locally

Clone the repository and install dependencies:

```bash
git clone https://github.com/jl94x4/StreamPilot.git
cd StreamPilot
npm install
```

Create a `.env` file with a signing secret:

```bash
printf 'JWT_SECRET=%s\n' "$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")" > .env
```

Start the app:

```bash
npm start
```

`npm start` builds Tailwind CSS, bundles the React frontend with esbuild, stamps the version file, and starts the Express server on port `2121`.

Open `http://localhost:2121` and complete the setup wizard.

## First-Time Setup

The setup wizard asks you to choose a media server mode:

| Mode | Authentication | Analytics Companion | Branding |
| --- | --- | --- | --- |
| Plex | Plex.tv OAuth, Plex token, selected owned server | Tautulli | Plex or custom theme |
| Jellyfin | Jellyfin username/password or Quick Connect | Jellystat | Jellyfin server assets or custom theme |
| Emby | Emby-compatible server connection | Optional external analytics/status tools | Emby or custom theme |

Notifications (SMTP and Gotify), Arr apps, Discover & Request quotas, and member page visibility are optional during setup. Skip any of those steps and configure them later in Settings.

After setup, use the Settings area to configure the media server, SMTP, Gotify, temporary access, branding, status services, integrations, home layout, and scheduled tasks.

## Runtime Data

Runtime data is written to `config/` by default. Docker deployments mount this directory to `/app/config`.

Important files include:

| File | Purpose |
| --- | --- |
| `config/config.json` | Server and portal configuration |
| `config/users.json` | Portal user records |
| `config/audit-log.json` | System action history |
| `config/trending-cache.json` | Cached analytics and trending data |
| `config/analytics-cache.json` | Cached dashboard analytics |

Older root-level JSON files are migrated into `config/` automatically on startup when the destination file does not already exist.
