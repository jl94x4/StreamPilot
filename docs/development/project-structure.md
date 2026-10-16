# Project Structure

```text
StreamPilot/
├── index.js
├── index.tsx
├── client/
│   ├── App.tsx
│   ├── screens.tsx
│   ├── discovery/      # Discover & Request (TMDB browse)
│   ├── requests/       # Admin request queue / issues / blocklist
│   ├── collexions/     # ColleXions React UI
│   ├── upgrader/       # Library Upgrader
│   ├── home/
│   ├── settings/
│   ├── shared/
│   ├── setup/
│   └── maintenance/    # Cleaner
├── collexions/         # Bundled Python ColleXions worker
├── input.css
├── static/
├── lib/
│   ├── portal-request/ # Native request / issues / blocklist engine
│   └── collexions-embedded.js
├── config/
├── Dockerfile
├── docker-compose.yml
├── unraid/
├── docs/
├── .env.example
├── build-version.js
└── package.json
```

## Backend

`index.js` contains the Express API, authentication, Plex and Jellyfin integrations, email handling, security headers, rate limiting, background jobs, and static asset serving.

`lib/portal-request/` holds the portal-native Discover/request engine. JSON requests/issues/blocklist, ARR approve + status sync, portal quotas/auto-approve. Portal is the default; Seerr remains an optional dual-run engine and history import. See [seerr-uncouple-inventory.md](./seerr-uncouple-inventory.md).

`lib/collexions-embedded.js` starts and proxies the bundled ColleXions worker when enabled in Settings.

## Frontend

`index.tsx` mounts the React application. The app source lives in `client/`:

| Path | Purpose |
| --- | --- |
| `client/App.tsx` | Application shell and routes |
| `client/screens.tsx` | Home, Dashboard, Calendar, Analytics, Cleaner, Status, and shared screens |
| `client/discovery/` | Discover & Request member UI |
| `client/requests/` | Admin Requests / Issues / Blocklist |
| `client/collexions/` | ColleXions admin UI |
| `client/upgrader/` | Library Upgrader |
| `client/home/` | User dashboard layout and widgets |
| `client/settings/` | Settings panels |
| `client/shared/` | API helpers, types, themes, formatters, nav labels |
| `client/setup/` | First-time setup wizard |
| `client/maintenance/` | Cleaner UI helpers |

## Styling and Builds

Tailwind source lives in `input.css`, and generated CSS is written to `static/tailwind.css`.

The React bundle is produced by esbuild and written to `static/bundle.js`.

## Runtime Data

`lib/data-paths.js` centralizes runtime file paths and migrates legacy root-level JSON files into `config/`.

`config/` and `backup/` are runtime directories and should not be committed. ColleXions worker state lives under `config/collexions/` when enabled.

## Docs

The VitePress documentation source lives in `docs/`.

```bash
npm run docs:dev
npm run docs:build
npm run docs:preview
```
