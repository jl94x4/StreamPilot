# Native ExoPlayer (Phase 2)

Capacitor plugin `NativeMediaPlayer` opens a full-screen Media3 ExoPlayer activity for phone + Android TV.

## JS bridge

`installNativeMediaPlayerBridge()` (called from `client/plex-client/main.tsx`) registers:

```ts
window.NativeMediaPlayer = {
  isAvailable: () => true,
  open: async ({ url, title, offsetMs, headers }) => ({ ended, positionMs }),
};
```

`MediaPlayerVideo` prefers this path in the Capacitor app and skips WebView `<video>` while native is active.

## Android

- `NativeMediaPlayerPlugin.java` — Capacitor plugin
- `PlayerActivity.java` — Media3 ExoPlayer + HLS, request headers (Bearer / access_token)
- Manifest: `PlayerActivity` (not exported)
- Deps: `media3-exoplayer`, `media3-exoplayer-hls`, `media3-ui`

## Rebuild

```bash
npm run build:plex-client
cd plex-client && npx cap sync android
```

Then Run ▶ in Android Studio. Play any title — ExoPlayer should open full screen.
