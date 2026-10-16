#!/bin/sh
set -e

PUID=${PUID:-1000}
PGID=${PGID:-1000}
CONFIG_DIR=${CONFIG_DIR:-/app/config}
MEDIA_AUTOMATION_CONFIG_DIR=${MEDIA_AUTOMATION_CONFIG_DIR:-$CONFIG_DIR/media-automation}
MEDIA_AUTOMATION_WORK_DIR=${MEDIA_AUTOMATION_WORK_DIR:-$MEDIA_AUTOMATION_CONFIG_DIR/work}
POSTER_SETS_CONFIG_DIR=${POSTER_SETS_CONFIG_DIR:-$CONFIG_DIR/poster-sets}
OVERLAYS_CONFIG_DIR=${OVERLAYS_CONFIG_DIR:-$CONFIG_DIR/overlays}
EDITIONS_CONFIG_DIR=${EDITIONS_CONFIG_DIR:-$CONFIG_DIR/editions}
SPOTIFY_TO_PLEX_CONFIG_DIR=${SPOTIFY_TO_PLEX_CONFIG_DIR:-$CONFIG_DIR/spotify-to-plex}

# Unraid appdata mounts are often root-owned; fix permissions before dropping privileges.
mkdir -p \
  "$CONFIG_DIR" \
  /app/backup \
  "$CONFIG_DIR/collexions/config" \
  "$CONFIG_DIR/collexions/logs" \
  "$SPOTIFY_TO_PLEX_CONFIG_DIR" \
  "$SPOTIFY_TO_PLEX_CONFIG_DIR/logs" \
  "$MEDIA_AUTOMATION_CONFIG_DIR" \
  "$MEDIA_AUTOMATION_WORK_DIR" \
  "$POSTER_SETS_CONFIG_DIR" \
  "$OVERLAYS_CONFIG_DIR" \
  "$EDITIONS_CONFIG_DIR" \
  "$EDITIONS_CONFIG_DIR/metadata_backup" \
  "$CONFIG_DIR/branding"
chown -R "$PUID:$PGID" \
  "$CONFIG_DIR" \
  /app/backup \
  "$MEDIA_AUTOMATION_CONFIG_DIR" \
  "$MEDIA_AUTOMATION_WORK_DIR" \
  "$POSTER_SETS_CONFIG_DIR" \
  "$OVERLAYS_CONFIG_DIR" \
  "$EDITIONS_CONFIG_DIR"

# Collect GIDs from /dev/dri so QSV/VAAPI work after dropping to PUID:PGID.
# renderD* is commonly root:render mode 660 — gosu alone does not keep those groups.
collect_dri_gids() {
  if [ ! -d /dev/dri ]; then
    return 0
  fi
  for device in /dev/dri/*; do
    [ -e "$device" ] || continue
    gid=$(stat -c '%g' "$device" 2>/dev/null) || continue
    case " $gids " in
      *" $gid "*) ;;
      *) gids="${gids:+$gids }$gid" ;;
    esac
  done
}

gids="$PGID"
collect_dri_gids

# jemalloc returns freed RAM to the OS; glibc's malloc does not (issue #181).
# Only preload it for the Node portal — Chromium (spotify-to-plex) crashes if it
# inherits this LD_PRELOAD. Child spawns strip it in lib/child-env.js as well.
if [ "$1" = "node" ]; then
  for jemalloc_lib in \
    /usr/lib/x86_64-linux-gnu/libjemalloc.so.2 \
    /usr/lib/aarch64-linux-gnu/libjemalloc.so.2
  do
    if [ -f "$jemalloc_lib" ]; then
      export LD_PRELOAD="$jemalloc_lib"
      export MALLOC_CONF="${MALLOC_CONF:-dirty_decay_ms:1000,muzzy_decay_ms:1000}"
      break
    fi
  done
fi

# Prefer setpriv so we can attach /dev/dri GIDs as supplementary groups.
# Do not combine --clear-groups with --groups (mutually exclusive on util-linux).
if command -v setpriv >/dev/null 2>&1; then
  groups_csv=$(echo "$gids" | tr ' ' ',')
  exec setpriv --reuid="$PUID" --regid="$PGID" --groups="$groups_csv" -- "$@"
fi

if command -v gosu >/dev/null 2>&1; then
  exec gosu "$PUID:$PGID" "$@"
fi
if command -v su-exec >/dev/null 2>&1; then
  exec su-exec "$PUID:$PGID" "$@"
fi

exec "$@"
