# --- spotify-to-plex runtime (copied into portal image below) ---
FROM jjdenhertog/spotify-to-plex:latest@sha256:a4a183007ae6e176626e0081d7349caece9cf9faa131ce2f1ae9ce8a584cf342 AS spotify-to-plex-bundle

# --- Build frontend assets and version stamp ---
FROM node:26-bookworm-slim AS builder

WORKDIR /app

# .git is excluded from the build context; CI passes GIT_SHA/GITHUB_REF so version stamps match the commit.
# PACKAGE_VERSION_FLOOR keeps beta/testing images on main's release number when package.json lags.
ARG GIT_SHA
ARG GITHUB_REF
ARG PACKAGE_VERSION_FLOOR
ENV GIT_SHA=${GIT_SHA}
ENV GITHUB_REF=${GITHUB_REF}
ENV PACKAGE_VERSION_FLOOR=${PACKAGE_VERSION_FLOOR}

COPY package.json package-lock.json ./
# Use install (not ci) so Windows-generated lockfiles / optional platform pkgs cannot hard-fail the image build.
RUN npm install --no-audit --no-fund

COPY . .
# Stamp assets + version.txt (gitignored). Re-run build-version explicitly so the
# runner COPY never fails when build:version is skipped or release-notes fails mid-script.
RUN npm run build \
    && node build-version.js \
    && test -s version.txt \
    && (test -f style.css || printf '/* Legacy stylesheet placeholder */\n' > style.css) \
    && npm prune --omit=dev \
    && npm cache clean --force

# --- Production image ---
FROM node:26-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV BIND_HOST=0.0.0.0
ENV PORT=2121
ENV FORCE_SECURE_COOKIES=false
# glibc's malloc keeps a per-thread arena pool and is notoriously slow to hand freed
# memory back to the OS, especially after bursts of many medium/large allocations
# (e.g. parsing full Sonarr/Radarr catalog JSON). That shows up as RSS that only ever
# climbs and drops back to baseline solely on process restart — see issue #181. This
# does not change app behavior, only how many malloc arenas glibc is allowed to use.
ENV MALLOC_ARENA_MAX=2
# Cap V8 old-space so analytics/history JSON spikes fail soft instead of unbounded heap.
# Compose can override NODE_OPTIONS; Unraid templates without it still get this default.
ENV NODE_OPTIONS="--max-old-space-size=2048"
ENV COLLEXIONS_APP_DIR=/app/collexions
ENV COLLEXIONS_EMBEDDED_PORT=15755
ENV POSTER_SETS_APP_DIR=/app/poster-sets
ENV OVERLAYS_APP_DIR=/app/overlays
ENV OVERLAYS_PYTHON=/opt/poster-sets-venv/bin/python
ENV EDITIONS_APP_DIR=/app/editions
ENV EDITIONS_PYTHON=/opt/poster-sets-venv/bin/python
ENV EDITIONS_CONFIG_DIR=/app/config/editions
ENV EDITIONS_CONFIG_INI=/app/config/editions/config.ini
ENV EDITIONS_BACKUP_DIR=/app/config/editions/metadata_backup
ENV SPOTIFY_TO_PLEX_APP_DIR=/app/spotify-to-plex
ENV SPOTIFY_TO_PLEX_EMBEDDED_PORT=9030
ENV CHROME_BIN=/usr/bin/chromium
ENV CHROMIUM_PATH=/usr/bin/chromium

# ffmpeg supplies both ffmpeg and ffprobe. Mesa provides AMD VAAPI; Intel media /
# QSV runtime libs are installed when Bookworm publishes them for the arch.
# util-linux provides setpriv so the entrypoint can attach /dev/dri GIDs after
# dropping to PUID:PGID (required for render node access on Unraid).
# Optional: set LIBVA_DRIVER_NAME=iHD (Intel) or radeonsi (AMD) if auto-detect fails.
# intel-gpu-tools (intel_gpu_top) is installed AFTER jellyfin/autoremove so it
# cannot be swept away by apt-get autoremove in a later layer.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ffmpeg \
        gosu \
        libjemalloc2 \
        libva2 \
        mesa-va-drivers \
        pciutils \
        python3 \
        python3-pip \
        python3-venv \
        util-linux \
        vainfo \
    && if apt-cache show intel-media-va-driver >/dev/null 2>&1; then \
        apt-get install -y --no-install-recommends intel-media-va-driver; \
    fi \
    && if apt-cache show i965-va-driver >/dev/null 2>&1; then \
        apt-get install -y --no-install-recommends i965-va-driver; \
    fi \
    && if apt-cache show libmfx1 >/dev/null 2>&1; then \
        apt-get install -y --no-install-recommends libmfx1; \
    fi \
    && if apt-cache show libvpl2 >/dev/null 2>&1; then \
        apt-get install -y --no-install-recommends libvpl2; \
    fi \
    && if apt-cache show libmfx-gen1.2 >/dev/null 2>&1; then \
        apt-get install -y --no-install-recommends libmfx-gen1.2; \
    fi \
    && ffmpeg -version \
    && ffprobe -version \
    && rm -rf /var/lib/apt/lists/*

# Debian's stock FFmpeg links Intel's legacy Media SDK (libmfx), which cannot
# initialize QSV on 11th-gen+ iGPUs ("Current resolution/pixel format is
# unsupported"). jellyfin-ffmpeg bundles the oneVPL runtime + iHD driver, so
# install it and put wrappers first on PATH; distro ffmpeg stays as fallback.
RUN set -eu; \
    arch="$(dpkg --print-architecture)"; \
    if [ "$arch" = "amd64" ] || [ "$arch" = "arm64" ]; then \
        apt-get update \
        && apt-get install -y --no-install-recommends curl gnupg \
        && mkdir -p /etc/apt/keyrings \
        && curl -fsSL https://repo.jellyfin.org/jellyfin_team.gpg.key | gpg --dearmor -o /etc/apt/keyrings/jellyfin.gpg \
        && printf 'Types: deb\nURIs: https://repo.jellyfin.org/debian\nSuites: bookworm\nComponents: main\nArchitectures: %s\nSigned-By: /etc/apt/keyrings/jellyfin.gpg\n' "$arch" > /etc/apt/sources.list.d/jellyfin.sources \
        && apt-get update \
        && apt-get install -y --no-install-recommends jellyfin-ffmpeg7 \
        && apt-get purge -y curl gnupg \
        && apt-get autoremove -y \
        && rm -rf /var/lib/apt/lists/* /etc/apt/sources.list.d/jellyfin.sources; \
    fi; \
    if [ -x /usr/lib/jellyfin-ffmpeg/ffmpeg ]; then \
        printf '#!/bin/sh\nexport LIBVA_DRIVERS_PATH="${LIBVA_DRIVERS_PATH:-/usr/lib/jellyfin-ffmpeg/lib/dri:/usr/lib/x86_64-linux-gnu/dri}"\nexec /usr/lib/jellyfin-ffmpeg/ffmpeg "$@"\n' > /usr/local/bin/ffmpeg \
        && printf '#!/bin/sh\nexport LIBVA_DRIVERS_PATH="${LIBVA_DRIVERS_PATH:-/usr/lib/jellyfin-ffmpeg/lib/dri:/usr/lib/x86_64-linux-gnu/dri}"\nexec /usr/lib/jellyfin-ffmpeg/ffprobe "$@"\n' > /usr/local/bin/ffprobe \
        && chmod +x /usr/local/bin/ffmpeg /usr/local/bin/ffprobe; \
    fi; \
    ffmpeg -version; \
    ffprobe -version

# Ship intel_gpu_top last (amd64/i386 only in Debian bookworm) and fail the
# build if it is missing on amd64 — that is what System-tab util depends on.
RUN set -eu; \
    arch="$(dpkg --print-architecture)"; \
    apt-get update; \
    if [ "$arch" = "amd64" ] || [ "$arch" = "i386" ]; then \
        apt-get install -y --no-install-recommends intel-gpu-tools; \
        apt-mark manual intel-gpu-tools; \
        command -v intel_gpu_top; \
        test -x "$(command -v intel_gpu_top)"; \
    else \
        echo "Skipping intel-gpu-tools on ${arch} (not published by Debian)"; \
    fi; \
    rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/index.js ./
COPY --from=builder /app/index.html ./
COPY --from=builder /app/style.css ./
COPY --from=builder /app/version.txt ./
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/static ./static

# Bundled Collexions worker (Flask + ColleXions.py) — no second container required.
COPY collexions/requirements.txt /app/collexions/requirements.txt
COPY collexions/server.py /app/collexions/server.py
COPY collexions/ColleXions.py /app/collexions/ColleXions.py
COPY collexions/plex_identity.py /app/collexions/plex_identity.py
COPY collexions/plex_match.py /app/collexions/plex_match.py
RUN python3 -m venv /opt/collexions-venv \
    && /opt/collexions-venv/bin/pip install --no-cache-dir -r /app/collexions/requirements.txt \
    && chown -R node:node /app/collexions /opt/collexions-venv

# Poster Sets headless worker (MediUX / ThePosterDB) — separate from ColleXions.
COPY poster-sets/requirements.txt /app/poster-sets/requirements.txt
COPY poster-sets/core.py /app/poster-sets/core.py
COPY poster-sets/cli.py /app/poster-sets/cli.py
COPY poster-sets/plex_identity.py /app/poster-sets/plex_identity.py
RUN python3 -m venv /opt/poster-sets-venv \
    && /opt/poster-sets-venv/bin/pip install --no-cache-dir -r /app/poster-sets/requirements.txt \
    && chown -R node:node /app/poster-sets /opt/poster-sets-venv

# Overlays headless worker (New Season banners) — shares poster-sets venv for Python deps.
COPY overlays/requirements.txt /app/overlays/requirements.txt
COPY overlays/*.py /app/overlays/
COPY overlays/assets /app/overlays/assets
RUN /opt/poster-sets-venv/bin/pip install --no-cache-dir -r /app/overlays/requirements.txt \
    && chown -R node:node /app/overlays

# Editions headless worker (Plex Edition tags) — shares poster-sets venv (requests).
COPY editions/requirements.txt /app/editions/requirements.txt
COPY editions/cli.py /app/editions/cli.py
COPY editions/edition_manager.py /app/editions/edition_manager.py
COPY editions/modules /app/editions/modules
COPY editions/README.md /app/editions/README.md
COPY editions/THIRD_PARTY_LICENSE.txt /app/editions/THIRD_PARTY_LICENSE.txt
RUN /opt/poster-sets-venv/bin/pip install --no-cache-dir -r /app/editions/requirements.txt \
    && chown -R node:node /app/editions

# Bundled spotify-to-plex (Next.js UI + scraper + sync-worker) — no separate Compose service required.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        chromium \
        chromium-driver \
        supervisor \
    && rm -rf /var/lib/apt/lists/*
COPY --from=spotify-to-plex-bundle /app /app/spotify-to-plex
RUN pip3 install --no-cache-dir --break-system-packages \
        -r /app/spotify-to-plex/apps/spotify-scraper/requirements.txt \
    && chown -R node:node /app/spotify-to-plex

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

RUN mkdir -p config/media-automation/work config/poster-sets config/overlays config/editions/metadata_backup backup \
    && chown -R node:node /app

EXPOSE 2121

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:2121/api/config/public').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "index.js"]
