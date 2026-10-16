# Configuration

Most configuration is managed from the browser in Settings. Environment variables cover process-level behavior and secrets needed before the UI can load.

## Environment Variables

| Variable | Required | Description |
| --- | --- | --- |
| `JWT_SECRET` | Yes | Session signing secret. Must be at least 32 characters. |
| `PUID` | No | User ID used by the container entrypoint. Defaults to `1000`; Unraid commonly uses `99`. |
| `PGID` | No | Group ID used by the container entrypoint. Defaults to `1000`; Unraid commonly uses `100`. |
| `PORT` | No | Listen port. Defaults to `2121`. |
| `BIND_HOST` | No | Bind address. Defaults to `0.0.0.0`. |
| `CONFIG_DIR` | No | Runtime data directory. Defaults to `./config` locally and `/app/config` in Docker. |
| `MEDIA_AUTOMATION_CONFIG_DIR` | No | Media Automation state directory. Defaults to `<CONFIG_DIR>/media-automation`. |
| `MEDIA_AUTOMATION_WORK_DIR` | No | Media Automation work metadata directory. Defaults to `<MEDIA_AUTOMATION_CONFIG_DIR>/work`. |
| `PUBLIC_BASE_URL` | Optional | Bootstrap public HTTPS URL (and subpath for reverse-proxy hosting). After setup, prefer **Settings → Portal UI → Public Base URL** — invite emails and shareable links use that UI value first. |
| `BASE_PATH` | No | URL prefix when hosted under a subpath, such as `/portal`. |
| `FORCE_SECURE_COOKIES` | Recommended for HTTPS | Set to `true` when the portal is served over HTTPS. |
| `ALLOW_PRIVATE_INTEGRATION_URLS` | No | Allows private/LAN URLs when saving integration settings. |
| `SETUP_TOKEN` | No | Enables remote first-time setup with an explicit token. |
| `CLIENT_ID` | No | Fixed Plex OAuth client id. Auto-generated if unset. |

See `.env.example` for the full template.

## Settings UI

Important browser-managed settings include:

| Area | What You Configure |
| --- | --- |
| Media Server | Plex, Jellyfin, or Emby mode |
| Plex | Admin token, selected server, optional direct server URL |
| Jellyfin | Server URL, API key, login behavior, Quick Connect |
| Analytics | Tautulli for Plex or Jellystat for Jellyfin |
| Branding and UI | Logo, splash assets, accent colors, default theme |
| Navigation | Sidebar order and which feature links are visible |
| Access | Temporary access length, expiry rules, inactivity cleanup |
| SMTP | Host, port, username, password, sender address |
| Newsletters | Weekly or monthly schedule and content behavior |
| Home Layout | Section ordering and visibility |
| Media Stack | Sonarr, Radarr, Lidarr, Bazarr, and download clients |
| Request | Portal request engine (default), quotas, auto-approve, optional Seerr |
| Scanner | Enable Scanner, webhook auth, trigger/target rewrites, Autoscan YAML import |
| Collexions | Enable bundled Plex collection worker and related options |
| Library Upgrader | Enable upgrader, instance maps, rate limits |
| Media Automation | Enable native jobs, ARR/manual sources, path maps, encoder reporting, output mode, and quarantine |
| Cleaner | Maintenance / cleanup feature settings |
| Alerts | Gotify connection and alert rules |
| Status Page | Public service checks and health URLs |

See the [integration list](/guide/integrations) for the complete supported app matrix.

## Media Automation configuration

Media Automation is disabled until an admin enables and configures it. Version 1 accepts manual jobs plus Sonarr, Radarr, and Lidarr webhooks at `/triggers/media-automation/*`. Configure every ARR host path to a mounted container path; paths outside configured roots and symbolic-link sources are rejected.

Select CPU, NVENC, Intel QSV, Intel VAAPI, or AMD VAAPI and run **Test worker**. Capability refresh includes a short synthetic encode for hardware adapters when encoders are present. Validate real jobs with copy mode before enabling replace. Version 1 uses only the built-in native executor and has no third-party plugin API.

Start in dry-run mode. Copy mode preserves the source, while atomic replace requires a same-filesystem final rename and quarantine requires additional writable capacity for the original.

Deployment details and the safety checklist are in [Native Media Automation](/features/media-automation).

## Security Defaults

The server refuses to start without a strong `JWT_SECRET`.

Session cookies are `httpOnly` and use `sameSite: lax`. Set `FORCE_SECURE_COOKIES=true` only when the app is served over HTTPS, typically behind a reverse proxy.

Admin-only API routes require an authenticated admin session. Plex admins are verified through server ownership, and Jellyfin admins are verified through Jellyfin policy data.
