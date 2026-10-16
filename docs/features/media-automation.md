# Native Media Automation

Native Media Automation runs `ffprobe` and `ffmpeg` in the portal container to inspect and process media without a separate transcoding service. It is admin-only and opt-in.

## Version 1.3 scope

Media Automation accepts jobs from:

- manual admin selections in the portal (enqueue, pending test, pipeline preview/dry-run);
- scheduled library scans and on-demand **Scan now**;
- filesystem watchers on enabled library roots (debounced create/change events);
- Sonarr, Radarr, and Lidarr webhooks at `/triggers/media-automation/{sonarr|radarr|lidarr|manual}` when Basic Auth is configured.

The dashboard includes Overview metrics (with a global dry-run banner when Safe fallback is Dry run), worker/scan/watch health, queue job detail with planned steps, live command text, and activity logs, pipeline presets, and activity filters. Library path fields include a live folder browser over container mounts (`/media`, `/movies`, `/tv`, `/completed`, `/quarantine`, …).

### Quick start (Unraid)

1. Map paths on the **StreamPilot** container (not Unmanic): e.g. host media → `/media`, completed → `/completed`, quarantine → `/quarantine`.
2. Settings → Media Automation → enable, leave Safe fallback on **Dry run**, Save.
3. Media Automation → Libraries → New library using **container** paths (Browse): root `/media` or `/media/movies`, output `/completed`, quarantine `/quarantine`.
4. Add or pick a pipeline preset → Preview / Queue dry-run → Scan now.
5. Only after dry-runs look right, change pipeline (and later global fallback) to Copy, then Replace.

It does not replace Plex/Jellyfin transcoding and does **not** install third-party Unmanic plugins. Processing uses the built-in native FFmpeg executor and first-party steps:

| Step | Purpose |
| --- | --- |
| Transcode / Remux | Encode or stream-copy via FFmpeg |
| Strip subtitles | Remux with stream copy and drop subtitle streams |
| Extract subtitle | Write subtitle stream(s) as `.srt` beside the source (optional language preference) |
| Keep subtitle languages | Keep video/audio and only selected subtitle language codes (`eng,en`) |
| Keep first audio | Map first video + first audio (+ optional subs) |
| Drop commentary | Drop audio streams with commentary/comment disposition |
| Audio loudnorm | EBU R128 loudnorm on first audio → AAC |
| Audio stereo | Downmix first audio to 2.0 AAC |
| Strip commercial chapters | Cut chapters whose titles match a regex (default commercial/advert/promo); remux unchanged if none match |
| Move / rename | Move within configured library roots (`{dir}/archive/{basename}`, plus `{n}`, `{s00e00}`, `{quality}`, …) |
| Custom command | Allowlisted executable + arg array only (no shell; configure allowlist in Settings) |

Also includes durable **History** (7d/30d savings), live **scan progress**, library **tags** + **worker groups**, per-weekday **quiet hours**, and **delivery targets** (copy/move finished files into a mapped Sonarr drop on another Unraid).

Remote FFmpeg workers / Unmanic Central remain out of scope.

### Library discovery settings

| Setting | Default | Purpose |
| --- | --- | --- |
| Library scan enabled | on | Periodic full discovery of configured library roots |
| Scan interval (minutes) | 360 | How often periodic scans run (15–10080) |
| Filesystem watcher | **off** | Realtime enqueue under library roots. Keep off for large/remote mounts - use Scan now or ARR webhooks instead. Also requires `MEDIA_AUTOMATION_ENABLE_WATCH=1` in the container env before it can start. |
| Watch debounce (ms) | 5000 | Wait for writes to settle before enqueue |

**Important:** when Settings → Media Automation → Safe fallback output mode is **Dry run**, every job is forced to dry-run regardless of per-pipeline output mode.

## Required paths

| Container path | Access | Purpose |
| --- | --- | --- |
| `/app/config/media-automation` | Read/write | Queue state, libraries, pipelines, activity history |
| `/app/config/media-automation/work` | Read/write | Durable work metadata under the config mount |
| `/media` (example) | Read-only for inspect/dry-run; read/write for actions | Media source and destination files |

The media path is intentionally absent from the default Compose deployment. Mount only the library roots the feature needs. ARR paths must either match the container paths or use Scanner trigger rewrite rules: Media Automation webhooks reuse the same rewrite list as **Settings → Scanner** for the matching trigger name (then the first trigger for that ARR type).

Temporary encoded output is created beside its final destination so promotion can use a same-filesystem rename. The destination filesystem must have enough free space for the complete encoded output plus safety margin. `PUID` and `PGID` must be able to read source files and write the config work metadata and destination directories. If copy, replace, or quarantine is enabled, a read-only media mount will correctly make the job fail.

## Capability reporting

Review the capability panel after changing an image, driver, device mapping, or encoder. Worker Test and capability refresh run a short synthetic encode for each non-CPU adapter when FFmpeg reports the matching encoders. Detected encoders alone are not enough: the synthetic test confirms the host driver, device node, runtime, and permissions are usable. Explicitly selected unavailable modes fail rather than silently changing encoder; CPU fallback is configurable.

| Mode | What the test expects |
| --- | --- |
| CPU | Reports available when `libx264` is compiled in. No GPU device is required. |
| NVIDIA NVENC | Reports available when `h264_nvenc` (or peer codec) is compiled in **and** the synthetic encode succeeds. Needs NVIDIA Container Toolkit / runtime. |
| Intel QSV | Reports available when `h264_qsv` succeeds a synthetic encode. Needs a usable Intel render node. |
| Intel VAAPI | Separate adapter (`intel-vaapi`) using `h264_vaapi` plus a synthetic encode through `/dev/dri`. Requires an Intel DRM vendor on the render node. |
| AMD VAAPI | Adapter `vaapi` using the same VAAPI encoders. Requires an AMD DRM vendor on the render node, so Intel-only hosts keep this adapter off. |

The image ships `jellyfin-ffmpeg` (FFmpeg 7 with Intel oneVPL QSV runtime and iHD driver) as the primary FFmpeg/FFprobe, with Debian's FFmpeg, `vainfo`, and Mesa VAAPI userspace as fallback. This matters for QSV: Debian's stock FFmpeg uses Intel's legacy Media SDK, which fails to initialize on 11th-gen and newer iGPUs even when VAAPI works. Kernel and GPU drivers always come from the host.

## Hardware access

CPU mode is the portable default. No device or privileged mode is needed.

For Intel QSV/VAAPI or AMD VAAPI, pass `/dev/dri`. The image entrypoint attaches the render-node GIDs after dropping to `PUID`/`PGID`, so Unraid templates usually only need the device map. Compose users can still add host `video`/`render` groups explicitly:

```yaml
services:
  portal:
    devices:
      - /dev/dri:/dev/dri
    # Optional if the entrypoint cannot resolve device GIDs:
    group_add:
      - "44"  # host video GID; verify locally
      - "109" # host render GID; verify locally
```

For NVIDIA NVENC, install NVIDIA Container Toolkit on the host:

```yaml
services:
  portal:
    runtime: nvidia
    environment:
      NVIDIA_VISIBLE_DEVICES: all
      NVIDIA_DRIVER_CAPABILITIES: video,compute,utility
```

Group IDs and runtime syntax vary by host. Verify them locally. None of these configurations require `privileged: true`; keep privileged mode disabled.

## Output safety

Start with dry-run and a small test library.

- **Dry-run** probes the input and validates the planned command, path mapping, policy, and capacity without replacing media.
- **Copy** writes a separate output and leaves the source untouched. Review the output before any manual promotion.
- **Atomic replace** encodes beside the destination, verifies streams/duration, optionally quarantines the original, then promotes with a filesystem rename. The temporary file must be on the same filesystem as the destination for the rename to be atomic.
- **Quarantine** preserves the original in the configured quarantine location before a replacement is finalized.

Jobs reject paths outside configured roots and reject symbolic-link sources. Durable queue state uses lease/heartbeat recovery so crash-stale running jobs return to the queue. Deduplication keys combine path, source fingerprint, and pipeline so unchanged files are not reprocessed while an active job exists.

## Unraid template

The Community Applications / Unraid template exposes:

| Template field | Purpose |
| --- | --- |
| Media Root / TV / Movies / Music / Downloads | Optional host→container path mounts for Media Automation |
| Media Library Extra 1/2 | Additional roots; change the container path to match your layout |
| GPU Devices (Intel/AMD) | Pass `/dev/dri` for QSV/VAAPI |
| NVIDIA Visible Devices | GPU UUID or `all` (requires Nvidia Driver plugin) |
| Extra Parameters | For NVIDIA, add `--runtime=nvidia` in Advanced View |

Container paths must match Sonarr/Radarr/Lidarr paths (or use rewrite rules). Leave GPU and media Host Paths empty for CPU-only / no Media Automation. Image tags: `:latest`, `:beta`, `:nightly`.

## Docker checklist

1. Rebuild or pull an image containing FFmpeg (`:nightly` while testing this feature).
2. Leave CPU selected for the first test.
3. Mount `/app/config` and the required media roots; state/work metadata remains under the config mount.
4. Align `PUID`/`PGID`; pass `/dev/dri` or NVIDIA runtime only when using a GPU.
5. Configure ARR-to-container path mappings and Media Automation webhook Basic Auth.
6. Run **Test worker** so synthetic hardware probes refresh capability badges.
7. Use pipeline **Preview** / dry-run, then copy mode, before considering atomic replace and quarantine.

See [Docker Deployment](/guide/docker), [Configuration](/guide/configuration), and [Background Tasks](/operations/background-tasks).
