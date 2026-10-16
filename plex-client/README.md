# StreamPilot (Play Store)

Android / Android TV app that anyone can install and point at **their own** [StreamPilot](https://github.com/) install. The APK is not locked to one host.

## Product model

| Concern | Behavior |
|--------|----------|
| Portal | User enters their StreamPilot URL on first launch (saved locally) |
| Auth | Plex PIN via that portal → Bearer session token |
| Playback | Portal `/api/media-player/*` + native ExoPlayer when available |
| Switch server | “Use a different portal” clears URL + session |

Do **not** bake `PLEX_CLIENT_PORTAL_URL` into Play Store binaries. That env var is only for private sideload / CI smoke tests.

## Package identity

- Application ID: `com.servermanagerportal.mediaplayer` (change before first Play upload if you prefer your publisher domain)
- Store listing name: **StreamPilot** (or your brand)
- One APK: phone + Android TV (`LEANBACK_LAUNCHER`)

## Build web assets

From repo root:

```bash
npm run build:css
npm run build:plex-client
```

## Android project

```bash
cd plex-client
npm install
npx cap add android
npx cap sync android
npx cap open android
```

Then apply leanback + ExoPlayer notes in `native/README.md`.

## Play Store checklist (portal-backed)

- Privacy policy: app stores portal URL + session JWT on device; media streams via user portal
- Data safety form: account login (Plex via portal), no selling data
- TV: leanback screenshots, D-pad navigation, no required touchscreen
- Cleartext optional only for LAN http portals (`allowMixedContent` / network security config)
- Minimum portal version: needs CORS + `oauthState` on `/api/auth/plex/login` (this repo)

## Status

- [x] Multi-tenant portal URL (Play Store)
- [x] CORS + Bearer + oauthState on portal
- [x] Auth UI + PIN poll (phone + TV)
- [x] SPA build (`npm run build:plex-client`)
- [ ] Capacitor Android + LEANBACK
- [ ] ExoPlayer plugin
- [ ] TV focus polish
