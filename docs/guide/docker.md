# Docker Deployment

Docker is the recommended production path because it keeps runtime data in explicit mounted directories.

## Prebuilt Image

Images are published to GitHub Container Registry:

| Tag | When updated | Image |
| --- | --- | --- |
| `latest` | Every push to `main` and every release tag `v*` | `ghcr.io/jl94x4/streampilot:latest` |
| `beta` | Every push to `beta` | `ghcr.io/jl94x4/streampilot:beta` |
| `testing` | Every push to `testing` | `ghcr.io/jl94x4/streampilot:testing` |
| `1.4.0` / `v1.4.0` | Matching GitHub release | `ghcr.io/jl94x4/streampilot:1.4.0` |

Pin a version in Unraid or Docker Compose by replacing `:latest` with `:1.4.0` (or `:v1.4.0`).

Run the latest image:

```bash
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

## Docker Compose

Copy the environment template:

```bash
cp .env.example .env
```

Set `JWT_SECRET` in `.env`, then build and start:

```bash
docker compose up -d --build
```

The portal listens on host port `2121` by default.

## Persistent Paths

| Host Path | Container Path | Purpose |
| --- | --- | --- |
| `./config` | `/app/config` | JSON settings, users, caches, and logs |
| `./backup` | `/app/backup` | Rolling backup snapshots |

Media Automation state and work metadata default to `/app/config/media-automation` and `/app/config/media-automation/work`, so the existing writable config mount covers them. `MEDIA_AUTOMATION_CONFIG_DIR` and `MEDIA_AUTOMATION_WORK_DIR` may override those container paths. No media library or GPU is exposed by default; the portal therefore continues to start on hosts without either.

Add only the media roots you intend to process:

```yaml
services:
  portal:
    volumes:
      - /srv/media:/media
```

Use a read-only mount for inspection and dry-runs. Copy, atomic replace, and quarantine require write access to their destination paths. Temporary encoded output is created beside its final destination; ensure `PUID`/`PGID` can access the mounted files and that the destination filesystem can hold a complete output.

## Media Automation hardware

The image includes FFmpeg/FFprobe plus Debian Bookworm Intel and AMD VAAPI userspace packages. Host kernel/GPU drivers are still required. CPU mode needs no device.

Intel QSV/VAAPI and AMD VAAPI:

```yaml
services:
  portal:
    devices:
      - /dev/dri:/dev/dri
    group_add:
      - "${VIDEO_GID:-44}"
      - "${RENDER_GID:-109}"
```

Find the actual host IDs with `getent group video` and `getent group render`; defaults differ by distribution.

NVIDIA NVENC, after installing NVIDIA Container Toolkit:

```yaml
services:
  portal:
    runtime: nvidia
    environment:
      NVIDIA_VISIBLE_DEVICES: all
      NVIDIA_DRIVER_CAPABILITIES: video,compute,utility
```

Keep `privileged: false`. Worker Test runs a short synthetic encode for each non-CPU adapter when the matching encoders are present, then use a controlled copy job before enabling replace mode. An explicitly selected unavailable adapter fails rather than silently falling back to CPU unless CPU fallback is enabled. See [Native Media Automation](/features/media-automation).

### Cross-Unraid delivery (Sonarr drop)

Encode stays on the Portal host. To hand finished files to Sonarr on another Unraid, map that remote share into the Portal container (for example host `/mnt/remotes/tower2_sonarr/import` → container `/exports/sonarr-drop`), then add a Delivery target in Settings → Media Automation with that container path. Assign the target on the library. Naming can stay `as-is` (Sonarr renames on import) or use `sonarr-pattern`.

## Common Commands

```bash
docker compose logs -f portal
docker compose up -d --build
docker compose down
```

To publish a different host port, set `PORT=8080` in `.env`. The Compose file maps the host value to container port `2121`.

## LAN Integrations

For Sonarr, Radarr, Lidarr, Bazarr, Tautulli, Jellystat, request apps, or download clients running on a private network, set:

```ini
ALLOW_PRIVATE_INTEGRATION_URLS=true
```

Use URLs reachable from inside the container. On Docker Desktop, `http://host.docker.internal:8989` is often useful. On Linux, use the host IP or a Docker network shared by the services.

## ColleXions (bundled)

ColleXions is built into the portal image. No second container is required.

1. Deploy a portal image that includes the Python worker (current GHCR tags do).
2. In **Settings → Collexions**, turn **Enable** on and click **Save Settings**.
3. Open **ColleXions** in the nav — import an old `config.json` if migrating, or complete onboarding.

Worker data persists under `./config/collexions/` (config + logs). Advanced: set `COLLEXIONS_EMBEDDED_PORT` if you need a different localhost port (default `15755`).

Full product notes: [ColleXions](/features/collexions).

## Unraid

StreamPilot includes an Unraid template at `unraid/streampilot.xml` (legacy filename `unraid/server-manager-portal.xml` is kept in sync).

The template uses `ghcr.io/jl94x4/streampilot:latest` and stores app data under `/mnt/user/appdata/streampilot/` by default. It includes a writable Media Automation work path; the optional media path is empty until configured. Existing installs can keep `/mnt/user/appdata/server-manager-portal/`.

For Intel/AMD, add `/dev/dri` as a device (the entrypoint attaches those device GIDs for `PUID`). For NVIDIA, use the NVIDIA Container Toolkit/runtime. Do not enable privileged mode.

On Unraid, the template includes optional Media Root / TV / Movies / Music path fields plus Intel `/dev/dri` and NVIDIA variables. For NVENC: install the Nvidia Driver plugin, set `NVIDIA_VISIBLE_DEVICES`, and add `--runtime=nvidia` to Extra Parameters. Verify path mappings and permissions before enabling any replacement action. Use `:nightly` while testing Media Automation.

Unraid template `Registry` must point at the package page (`https://github.com/jl94x4/StreamPilot/pkgs/container/streampilot`), not bare `https://ghcr.io`, or Docker update status can show **not available**. Existing containers still on `ghcr.io/jl94x4/server-manager-portal` keep receiving the same tags until that repository is changed.
