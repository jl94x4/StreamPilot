# StreamPilot for Android TV

A living-room player for your own Plex server, built for Android TV, Google TV and NVIDIA Shield. If you've used the official Plex app it'll feel familiar, with the things a lot of us missed brought back and more control over how it all works.

**You sign in with your normal Plex account. That's it.** Nothing to install on your server, and you do **not** need the StreamPilot portal (see [The portal is optional](#the-portal-is-optional)).

Not affiliated with Plex Inc.

## Get it

| | |
|---|---|
| **Free: GitHub** | Download the APK from [Releases](../../releases) and sideload it. Same app, updated every so often. |
| **Paid: Google Play** | Search **StreamPilot** on Google Play. Updates land there first, and buying it supports the project. |

To sideload on Android TV / Shield: install a file manager or the *Downloader* app, enable *Install unknown apps* for it, then open the APK.

## Features

- **Direct Play the way the file was made**: native ExoPlayer, up to 4K, Dolby Vision, HDR10+, HDR10, HLG, HEVC, AV1, VP9. Match frame rate on by default, optional TrueHD / DTS passthrough.
- **A Home you control**: choose which libraries appear, reorder the sidebar, hide watched items, and sort Continue Watching by latest release, On Deck, recently watched or title.
- **Plex Home profiles and PINs** on launch; everyone keeps their own Continue Watching.
- **Skip intro and credits** (off, prompt or automatic), autoplay next episode, and an optional "Still watching?" check.
- **Player menu**: chapters, seek thumbnails, speed, zoom, A/V delay, sleep timer, night mode, audio boost, and a stats overlay (long-press OK).
- **Subtitles**: size, colour, background, position, delay, auto-sync, and OpenSubtitles search from the player.
- **Theme tunes, cinema trailers, a screensaver** made from your own artwork, and **Watch Together**.
- **Multiple servers**, music, collections, studios, and actor pages showing what you have of theirs.
- **Quality ladder** for when Direct Play can't work, with a separate quality for when you're away from home.

## Feedback and feature requests

Very welcome. Open an issue for bugs, ideas, or "Plex used to do X and I miss it". Please include your device (e.g. Shield 2019, Chromecast with Google TV) and the app version (shown at the bottom of **Settings**).

## The portal is optional

[StreamPilot portal](../README.md) is a separate, self-hosted web app for people who share their server with friends and family: invites, access expiry, requests, status, stats and more. The TV app works fully without it.

- **Without a portal (default):** the app signs in to plex.tv with a PIN and talks to your Plex server directly.
- **With a portal:** you can enter its address in **Settings → Account → Portal URL (optional)**.
- **Watch Together** only needs a small sync relay (`npm run wt:relay` in this repo), set in **Settings → Account → Watch Together relay URL**. Everyone needs the title in their own Plex library; the video never leaves your server.

## Building from source

Everything is built from the repository root. You need Node.js, a JDK 17+ (`JAVA_HOME`) and the Android SDK.

```bash
npm install
npm run build:css
npm run build:apk            # debug APK, copied to your Desktop
```

| Command | What it does |
|---|---|
| `npm run build:plex-client` | Builds the web assets into `plex-client/dist` |
| `npm run build:apk` | Bumps the version, builds, syncs Capacitor and assembles a debug APK |
| `npm run build:apk:release` | Same, signed with `plex-client/android/keystore.properties` |
| `npm run build:aab:release` | Signed Play App Bundle |
| `node scripts/build-plex-client-apk.mjs --release --no-bump` | Rebuild without changing the version |

For a release build, copy `plex-client/android/keystore.properties.example` to `keystore.properties` and point it at your own keystore. Never commit it.

`PLEX_CLIENT_PORTAL_URL` (build-time env) bakes a portal address into a private build. Leave it unset for anything you share or publish.

## Project layout

| Path | What's there |
|---|---|
| `client/plex-client/` | App shell: sign-in, profiles, What's New, config |
| `client/media-player/` | Screens and player UI (shared with the portal's web player) |
| `plex-client/android/` | Capacitor Android project, Leanback launcher, banner |
| `plex-client/native/` | Native ExoPlayer plugin notes ([README](native/README.md)) |

- Application ID: `com.streampilot.mediaplayer` (permanent on Google Play). The Java sources keep the `com.servermanagerportal.mediaplayer` package internally.
- One APK covers phones and Android TV: touchscreen and Leanback are both optional features.
- Minimum Android version: 7.0 (API 24).
