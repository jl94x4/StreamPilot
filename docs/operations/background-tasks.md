# Background Tasks

The Background Tasks settings page shows the active scheduler and lets admins run jobs manually.

Task labels adapt to the selected media player:

| Task | Plex Mode | Jellyfin Mode |
| --- | --- | --- |
| User sync | Sync Plex users | Sync Jellyfin users |
| Expiry checks | Email users nearing expiry | Same |
| Revoke access | Remove expired Plex access | Revoke expired portal access |
| Inactive cleanup | Revoke inactive users | Revoke inactive Jellyfin portal users |
| Analytics cache | Plex and Tautulli data where configured | Jellyfin and Jellystat data where configured |
| Library stats | Plex stats builder | Hidden in Jellyfin mode |
| Discovery availability cache | Rebuilds Sonarr/Radarr badge cache for Discover browse | Same |
| Maintenance index | Build media/request index | Same |
| Rolling backup | Create config backups | Same |

Media Automation appears as a status row on **Settings → Background Tasks** (enabled / global dry-run) with links to its settings and dashboard. It is not a classic “Run now” cron job: the worker, library scan/watch, and ARR webhooks run inside the portal process with durable lease/heartbeat recovery. See [Native Media Automation](/features/media-automation).

## Diagnostics

The Settings System diagnostics page uses the same media-aware task list. A Jellyfin portal is not expected to pass Plex-only checks, and Plex-only jobs are hidden where appropriate.

## Backups

Rolling backups are written to the backup directory. In Docker, mount `/app/backup` so snapshots survive container replacement.
