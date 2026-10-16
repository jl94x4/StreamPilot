import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
    OVERLAYS_DIR,
    OVERLAYS_LOG_PATH,
    OVERLAYS_EPISODE_LOG_PATH,
    OVERLAYS_PREVIEW_DIR,
    OVERLAYS_BACKUPS_DIR,
    OVERLAYS_CUSTOM_PRESETS_DIR,
    OVERLAYS_RUN_LOCK_PATH,
    loadOverlaysConfig,
    resolveOverlayPresetPath,
} from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

export const OVERLAYS_APP_DIR = process.env.OVERLAYS_APP_DIR
    ? path.resolve(process.env.OVERLAYS_APP_DIR)
    : path.join(REPO_ROOT, 'overlays');

export const OVERLAYS_ASSETS_DIR = path.join(OVERLAYS_APP_DIR, 'assets', 'presets');

const resolvePythonBinary = () => {
    if (process.env.OVERLAYS_PYTHON) return process.env.OVERLAYS_PYTHON;
    if (process.env.POSTER_SETS_PYTHON) return process.env.POSTER_SETS_PYTHON;
    const candidates = [
        '/opt/poster-sets-venv/bin/python',
        path.join(REPO_ROOT, 'poster-sets', '.venv', 'Scripts', 'python.exe'),
        path.join(REPO_ROOT, 'overlays', '.venv', 'Scripts', 'python.exe'),
        path.join(REPO_ROOT, 'overlays', '.venv', 'bin', 'python'),
    ];
    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) return candidate;
    }
    return process.platform === 'win32' ? 'python' : 'python3';
};

export const overlaysWorkerReady = () => {
    const cli = path.join(OVERLAYS_APP_DIR, 'cli.py');
    const core = path.join(OVERLAYS_APP_DIR, 'core.py');
    const tmdb = path.join(OVERLAYS_APP_DIR, 'tmdb_dates.py');
    const extra = path.join(OVERLAYS_APP_DIR, 'modes_extra.py');
    const kometa = path.join(OVERLAYS_APP_DIR, 'modes_kometa.py');
    const kometaImages = path.join(OVERLAYS_APP_DIR, 'kometa_images.py');
    return fs.existsSync(cli)
        && fs.existsSync(core)
        && fs.existsSync(tmdb)
        && fs.existsSync(extra)
        && fs.existsSync(kometa)
        && fs.existsSync(kometaImages)
        && fs.existsSync(path.join(OVERLAYS_APP_DIR, 'kometa_engine.py'))
        && fs.existsSync(path.join(OVERLAYS_APP_DIR, 'kometa_detect.py'));
};

/** Read-only helper CLIs — must not look like a stamp/preview job in the UI. */
export const OVERLAYS_QUIET_COMMANDS = new Set([
    'status',
    'sections',
    'sample-candidates',
]);

export const isOverlaysQuietCommand = (command) => (
    OVERLAYS_QUIET_COMMANDS.has(String(command || '').trim().toLowerCase())
);

/** @type {Set<import('child_process').ChildProcessWithoutNullStreams>} */
const activeChildren = new Set();
/** Job workers that own the run lock (Preview/Run) — Stop targets these, not quiet helpers. */
const jobChildren = new Set();
let killRequested = false;

const isPidAlive = (pid) => {
    const n = Number(pid);
    if (!Number.isFinite(n) || n <= 0) return false;
    try {
        process.kill(n, 0);
        return true;
    } catch {
        return false;
    }
};

export const writeOverlaysRunLock = (lock = {}) => {
    try {
        fs.mkdirSync(OVERLAYS_DIR, { recursive: true });
        fs.writeFileSync(
            OVERLAYS_RUN_LOCK_PATH,
            `${JSON.stringify({
                command: String(lock.command || '').trim() || null,
                startedAt: lock.startedAt || new Date().toISOString(),
                pid: Number(lock.pid) || null,
            }, null, 2)}\n`,
            'utf8',
        );
    } catch {
        /* best-effort */
    }
};

export const clearOverlaysRunLock = () => {
    try {
        if (fs.existsSync(OVERLAYS_RUN_LOCK_PATH)) fs.unlinkSync(OVERLAYS_RUN_LOCK_PATH);
    } catch {
        /* best-effort */
    }
};

export const readOverlaysRunLock = () => {
    try {
        if (!fs.existsSync(OVERLAYS_RUN_LOCK_PATH)) return null;
        const raw = JSON.parse(fs.readFileSync(OVERLAYS_RUN_LOCK_PATH, 'utf8'));
        if (!raw || typeof raw !== 'object') return null;
        const pid = Number(raw.pid);
        const command = String(raw.command || '').trim() || null;
        const startedAt = raw.startedAt ? String(raw.startedAt) : null;
        if (!Number.isFinite(pid) || pid <= 0) return null;
        return { pid, command, startedAt };
    } catch {
        return null;
    }
};

/** True when a locked worker pid is still alive (survives lost in-memory handles). */
export const overlaysRunLockAlive = () => {
    const lock = readOverlaysRunLock();
    if (!lock) return null;
    if (!isPidAlive(lock.pid)) {
        clearOverlaysRunLock();
        return null;
    }
    // Typing in Test title / library pickers spawn short CLIs. Those used to write this
    // lock and freeze the whole Overlays UI as if a Run were in progress.
    if (isOverlaysQuietCommand(lock.command)) {
        return null;
    }
    return lock;
};

export const killActiveOverlaysWorker = () => {
    let killed = false;
    killRequested = true;
    const targets = jobChildren.size ? [...jobChildren] : [...activeChildren];
    for (const child of targets) {
        try {
            child.kill('SIGKILL');
            killed = true;
        } catch {
            /* ignore */
        }
        activeChildren.delete(child);
        jobChildren.delete(child);
    }
    // Also kill a lock-file pid if Node lost the ChildProcess handle (e.g. after hiccup).
    const lock = readOverlaysRunLock();
    if (lock?.pid && isPidAlive(lock.pid)) {
        try {
            process.kill(lock.pid, 'SIGKILL');
            killed = true;
        } catch {
            /* ignore */
        }
    }
    clearOverlaysRunLock();
    if (!killed) killRequested = false;
    return killed;
};

const resolvePlexIdentityEnv = () => {
    const clientId = String(
        process.env.CLIENT_ID
        || process.env.PLEX_CLIENT_IDENTIFIER
        || process.env.PLEXAPI_HEADER_IDENTIFIER
        || '',
    ).trim();
    return {
        PLEXAPI_HEADER_PRODUCT: 'StreamPilot',
        PLEXAPI_HEADER_DEVICE: 'Server',
        PLEXAPI_HEADER_DEVICE_NAME: 'StreamPilot',
        PLEXAPI_HEADER_PLATFORM: 'StreamPilot',
        ...(clientId ? {
            CLIENT_ID: clientId,
            PLEX_CLIENT_IDENTIFIER: clientId,
            PLEXAPI_HEADER_IDENTIFIER: clientId,
        } : {}),
    };
};

export const buildOverlaysCliConfig = async (plexCreds = {}, overlaysConfig = null, portalConfig = null) => {
    const cfg = overlaysConfig || await loadOverlaysConfig();
    const portal = portalConfig && typeof portalConfig === 'object' ? portalConfig : {};
    const tmdbApiKey = String(
        cfg.tmdbApiKey
        || portal.tmdbApiKey
        || process.env.TMDB_API_KEY
        || '',
    ).trim();
    return {
        plexUrl: String(plexCreds.base_url || plexCreds.plexUrl || '').replace(/\/+$/, ''),
        plexToken: String(plexCreds.token || plexCreds.plexToken || '').trim(),
        previewMode: cfg.previewMode === true,
        newSeasonEnabled: cfg.newSeasonEnabled !== false,
        newSeasonDays: cfg.newSeasonDays,
        newSeasonWatchNowStyle: cfg.newSeasonWatchNowStyle === true,
        newSeasonStampSeasonPoster: cfg.newSeasonStampSeasonPoster !== false,
        newEpisodeEnabled: cfg.newEpisodeEnabled !== false,
        newEpisodeDays: cfg.newEpisodeDays,
        newEpisodeWatchNowStyle: cfg.newEpisodeWatchNowStyle === true,
        skipNewEpisodeOnBinge: cfg.skipNewEpisodeOnBinge !== false,
        recentlyAddedEnabled: cfg.recentlyAddedEnabled === true,
        recentlyAddedDays: cfg.recentlyAddedDays,
        liveScheduleEnabled: cfg.liveScheduleEnabled === true,
        liveScheduleDays: cfg.liveScheduleDays,
        top10Enabled: cfg.top10Enabled === true,
        top10Count: cfg.top10Count,
        tmdbAirDateFallback: cfg.tmdbAirDateFallback !== false,
        tmdbApiKey,
        mediaInfoEnabled: cfg.mediaInfoEnabled === true,
        mediaInfoParts: cfg.mediaInfoParts || null,
        mediaInfoIncludeMovies: cfg.mediaInfoIncludeMovies !== false,
        mediaInfoIncludeShows: cfg.mediaInfoIncludeShows !== false,
        mediaInfoLibrarySectionIds: cfg.mediaInfoLibrarySectionIds || [],
        mediaInfoAllowKeys: cfg.mediaInfoAllowKeys || [],
        mediaInfoDenyKeys: cfg.mediaInfoDenyKeys || [],
        editionOverlayEnabled: cfg.editionOverlayEnabled === true,
        audioCodecEnabled: cfg.audioCodecEnabled === true,
        audioCodecStyle: cfg.audioCodecStyle || 'compact',
        videoFormatEnabled: cfg.videoFormatEnabled === true,
        kometaAddOverlayLabel: cfg.kometaAddOverlayLabel === true,
        bannersAddOverlayLabel: cfg.bannersAddOverlayLabel !== false,
        statusOverlayEnabled: cfg.statusOverlayEnabled === true,
        statusAiringDays: cfg.statusAiringDays,
        statusLibrarySectionIds: cfg.statusLibrarySectionIds || [],
        statusAllowKeys: cfg.statusAllowKeys || [],
        statusDenyKeys: cfg.statusDenyKeys || [],
        ratingsOverlayEnabled: cfg.ratingsOverlayEnabled === true,
        ratingsMinimum: cfg.ratingsMinimum,
        ratingsIncludeMovies: cfg.ratingsIncludeMovies !== false,
        ratingsIncludeShows: cfg.ratingsIncludeShows !== false,
        ratingsLibrarySectionIds: cfg.ratingsLibrarySectionIds || [],
        ratingsAllowKeys: cfg.ratingsAllowKeys || [],
        ratingsDenyKeys: cfg.ratingsDenyKeys || [],
        networkOverlayEnabled: cfg.networkOverlayEnabled === true,
        networkLibrarySectionIds: cfg.networkLibrarySectionIds || [],
        networkAllowKeys: cfg.networkAllowKeys || [],
        networkDenyKeys: cfg.networkDenyKeys || [],
        streamingOverlayEnabled: cfg.streamingOverlayEnabled === true,
        streamingRegion: cfg.streamingRegion || 'US',
        streamingIncludeMovies: cfg.streamingIncludeMovies !== false,
        streamingIncludeShows: cfg.streamingIncludeShows !== false,
        streamingLibrarySectionIds: cfg.streamingLibrarySectionIds || [],
        streamingAllowKeys: cfg.streamingAllowKeys || [],
        streamingDenyKeys: cfg.streamingDenyKeys || [],
        aspectOverlayEnabled: cfg.aspectOverlayEnabled === true,
        versionsOverlayEnabled: cfg.versionsOverlayEnabled === true,
        languageCountEnabled: cfg.languageCountEnabled === true,
        languagesOverlayEnabled: cfg.languagesOverlayEnabled === true,
        languagesAllowCodes: cfg.languagesAllowCodes || [],
        kometaFlagStyle: cfg.kometaFlagStyle || 'round',
        runtimesOverlayEnabled: cfg.runtimesOverlayEnabled === true,
        directPlayOverlayEnabled: cfg.directPlayOverlayEnabled === true,
        episodeInfoOverlayEnabled: cfg.episodeInfoOverlayEnabled === true,
        contentRatingEnabled: cfg.contentRatingEnabled === true,
        contentRatingScheme: cfg.contentRatingScheme || 'us',
        ribbonOverlayEnabled: cfg.ribbonOverlayEnabled === true,
        ribbonStyle: cfg.ribbonStyle || 'yellow',
        ribbonIncludeMovies: cfg.ribbonIncludeMovies !== false,
        ribbonIncludeShows: cfg.ribbonIncludeShows !== false,
        ribbonLibrarySectionIds: cfg.ribbonLibrarySectionIds || [],
        ribbonAllowKeys: cfg.ribbonAllowKeys || [],
        ribbonDenyKeys: cfg.ribbonDenyKeys || [],
        mediastingerOverlayEnabled: cfg.mediastingerOverlayEnabled === true,
        ratingsSource: cfg.ratingsSource || 'tmdb',
        customCollectionOverlaysEnabled: cfg.customCollectionOverlaysEnabled === true,
        customCollectionOverlays: Array.isArray(cfg.customCollectionOverlays) ? cfg.customCollectionOverlays : [],
        coreLibrarySectionIds: cfg.coreLibrarySectionIds || [],
        recentlyAddedLibrarySectionIds: cfg.recentlyAddedLibrarySectionIds || [],
        kometaLibrarySectionIds: cfg.kometaLibrarySectionIds || [],
        librarySectionIds: cfg.librarySectionIds,
        overlayPresetId: cfg.overlayPresetId,
        episodeOverlayPresetId: cfg.episodeOverlayPresetId || 'new-episode',
        recentlyAddedPresetId: cfg.recentlyAddedPresetId || 'recently-added',
        placement: cfg.placement || null,
        skipIfKometaOverlayLabel: cfg.skipIfKometaOverlayLabel !== false,
        dataDir: OVERLAYS_DIR,
        logPath: OVERLAYS_LOG_PATH,
        episodeLogPath: OVERLAYS_EPISODE_LOG_PATH,
        assetsDir: OVERLAYS_ASSETS_DIR,
        customPresetsDir: OVERLAYS_CUSTOM_PRESETS_DIR,
        runBundle: cfg.runBundle || undefined,
        kometaScope: cfg.kometaScope || undefined,
        onlyCollectionRatingKeys: Array.isArray(cfg.onlyCollectionRatingKeys)
            ? cfg.onlyCollectionRatingKeys.map((k) => String(k || '').trim()).filter(Boolean)
            : undefined,
        onlyRatingKeys: Array.isArray(cfg.onlyRatingKeys)
            ? cfg.onlyRatingKeys.map((k) => String(k || '').trim()).filter(Boolean)
            : undefined,
        overlayPath: resolveOverlayPresetPath(
            cfg.overlayPresetId || 'new-season',
            'season',
            OVERLAYS_ASSETS_DIR,
            OVERLAYS_CUSTOM_PRESETS_DIR,
        ),
        episodeOverlayPath: resolveOverlayPresetPath(
            cfg.episodeOverlayPresetId || 'new-episode',
            'episode',
            OVERLAYS_ASSETS_DIR,
            OVERLAYS_CUSTOM_PRESETS_DIR,
        ),
        recentlyAddedOverlayPath: resolveOverlayPresetPath(
            cfg.recentlyAddedPresetId || 'recently-added',
            'season',
            OVERLAYS_ASSETS_DIR,
            OVERLAYS_CUSTOM_PRESETS_DIR,
        ),
        previewDir: OVERLAYS_PREVIEW_DIR,
        backupsDir: OVERLAYS_BACKUPS_DIR,
    };
};

/**
 * @returns {Promise<{ ok: boolean, result?: object, error?: string, logs: string[] }>}
 */
export const runOverlaysCli = (command, payload = {}, {
    timeoutMs = 30 * 60_000,
    idleTimeoutMs = null,
    onProgress,
    holdRunLock,
} = {}) => new Promise((resolve) => {
    if (!overlaysWorkerReady()) {
        resolve({
            ok: false,
            error: 'Overlays worker is not installed (overlays/cli.py missing).',
            logs: [],
        });
        return;
    }

    const python = resolvePythonBinary();
    const cli = path.join(OVERLAYS_APP_DIR, 'cli.py');
    const shouldHoldLock = holdRunLock != null
        ? holdRunLock === true
        : !isOverlaysQuietCommand(command);
    // Fresh run — never inherit a stale Stop flag from a previous kill race.
    // Quiet helpers must not reset this: a concurrent Stop on a real job would be lost.
    if (shouldHoldLock) killRequested = false;
    const child = spawn(python, [cli, command], {
        cwd: OVERLAYS_APP_DIR,
        env: {
            ...process.env,
            PYTHONUNBUFFERED: '1',
            ...resolvePlexIdentityEnv(),
        },
        stdio: ['pipe', 'pipe', 'pipe'],
    });
    activeChildren.add(child);
    if (shouldHoldLock) jobChildren.add(child);

    let settled = false;
    let wroteLock = false;
    const logs = [];
    let stdout = '';
    let stderr = '';
    let result = null;
    let errorMessage = null;
    let idleTimer = null;
    const hardCapMs = Math.max(60_000, Number(timeoutMs) || 30 * 60_000);
    const idleMs = idleTimeoutMs == null
        ? null
        : Math.max(60_000, Number(idleTimeoutMs) || 0);

    const finish = (ok, extra = {}) => {
        if (settled) return;
        settled = true;
        clearTimeout(hardTimer);
        if (idleTimer) clearTimeout(idleTimer);
        activeChildren.delete(child);
        jobChildren.delete(child);
        if (wroteLock) {
            const lock = readOverlaysRunLock();
            if (!lock || Number(lock.pid) === Number(child.pid)) {
                clearOverlaysRunLock();
            }
        }
        resolve({ ok, result, error: errorMessage, logs, stderr: stderr.trim(), ...extra });
    };

    if (shouldHoldLock && child.pid) {
        const existing = readOverlaysRunLock();
        if (
            existing
            && isPidAlive(existing.pid)
            && !isOverlaysQuietCommand(existing.command)
            && Number(existing.pid) !== Number(child.pid)
        ) {
            // Another Preview/Run owns the lock — never overwrite or clear it.
            wroteLock = false;
        } else {
            writeOverlaysRunLock({
                command,
                startedAt: new Date().toISOString(),
                pid: child.pid,
            });
            wroteLock = true;
        }
    }

    const killForTimeout = (reason) => {
        try { child.kill('SIGKILL'); } catch { /* ignore */ }
        errorMessage = reason;
        finish(false, { cancelled: false, timedOut: true });
    };

    const armIdle = () => {
        if (!idleMs) return;
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
            killForTimeout('Overlays worker timed out (no progress)');
        }, idleMs);
    };

    const hardTimer = setTimeout(() => {
        killForTimeout('Overlays worker timed out');
    }, hardCapMs);
    armIdle();

    child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
        const lines = stdout.split(/\r?\n/);
        stdout = lines.pop() || '';
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
                const event = JSON.parse(trimmed);
                if (event.type === 'progress') {
                    logs.push(String(event.message || ''));
                    armIdle();
                    if (typeof onProgress === 'function') onProgress(event);
                } else if (event.type === 'result') {
                    const { type: _t, ...rest } = event;
                    result = rest;
                } else if (event.type === 'error') {
                    errorMessage = String(event.message || 'Overlays worker error');
                    logs.push(errorMessage);
                }
            } catch {
                logs.push(trimmed);
            }
        }
    });

    child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
    });

    child.on('error', (error) => {
        errorMessage = error?.code === 'ENOENT'
            ? `Python not found (${python}). Install overlays deps or set OVERLAYS_PYTHON.`
            : (error.message || String(error));
        finish(false);
    });

    child.on('close', (code, signal) => {
        const cancelled = (shouldHoldLock && killRequested)
            || signal === 'SIGKILL'
            || signal === 'SIGTERM';
        if (shouldHoldLock) killRequested = false;

        if (stdout.trim()) {
            try {
                const event = JSON.parse(stdout.trim());
                if (event.type === 'result') {
                    const { type: _t, ...rest } = event;
                    result = rest;
                } else if (event.type === 'error') {
                    errorMessage = String(event.message || errorMessage);
                }
            } catch {
                /* ignore */
            }
        }
        if (cancelled) {
            // Distinguish Stop vs hard timeout (timeout already set errorMessage).
            if (!errorMessage || errorMessage === 'Overlays run cancelled') {
                errorMessage = 'Overlays run cancelled';
            }
            const timedOut = /timed out/i.test(String(errorMessage || ''));
            finish(false, { cancelled: !timedOut, timedOut, code, signal });
            return;
        }
        if (code !== 0 && !errorMessage) {
            const detail = stderr.trim();
            errorMessage = detail
                || (signal ? `Overlays worker killed by ${signal}` : `Overlays worker exited with code ${code}`);
        }
        finish(code === 0 && !errorMessage, { code, signal });
    });

    try {
        child.stdin.write(JSON.stringify(payload || {}));
        child.stdin.end();
    } catch (error) {
        errorMessage = error.message || String(error);
        finish(false);
    }
});
