import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { envWithoutJemalloc } from './child-env.js';
import { resolveSpotifyToPlexScheduleMode } from './spotify-to-plex-schedule-mode.js';
import { getSpotifyToPlexEnvFilePath } from './spotify-to-plex-env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

export const SPOTIFY_TO_PLEX_EMBEDDED_PORT = Number(process.env.SPOTIFY_TO_PLEX_EMBEDDED_PORT || 9030) || 9030;
export const SPOTIFY_TO_PLEX_BUNDLED_URL = `http://127.0.0.1:${SPOTIFY_TO_PLEX_EMBEDDED_PORT}`;
export const SPOTIFY_TO_PLEX_EMBEDDED_SUPERVISOR_FILE = 'supervisord.embedded.conf';

let supervisorChild = null;
let startingPromise = null;
let stoppingIntentionally = false;
let unexpectedExitHandler = null;
let lastStartError = '';
const plannedSupervisorStops = new WeakSet();

export const setSpotifyToPlexUnexpectedExitHandler = (fn) => {
    unexpectedExitHandler = typeof fn === 'function' ? fn : null;
};

/** Planned SIGTERM→SIGKILL during a portal restart is not a crash. */
export const isUnexpectedSpotifyToPlexSupervisorExit = ({
    stoppingIntentionally: stopping = false,
    planned = false,
    code = null,
    signal = null,
} = {}) => {
    if (stopping || planned) return false;
    if (code === 0 && !signal) return false;
    const sig = String(signal || '');
    if (sig === 'SIGTERM' || sig === 'SIGINT') return false;
    return true;
};

const candidates = () => {
    const fromEnv = String(process.env.SPOTIFY_TO_PLEX_APP_DIR || '').trim();
    return [
        fromEnv,
        path.join(REPO_ROOT, 'spotify-to-plex'),
        '/app/spotify-to-plex',
    ].filter(Boolean);
};

export const resolveSpotifyToPlexBundledDir = () => {
    for (const dir of candidates()) {
        if (
            fs.existsSync(path.join(dir, 'web', 'apps', 'web', 'server.js'))
            || fs.existsSync(path.join(dir, 'web', 'server.js'))
        ) {
            return dir;
        }
    }
    return '';
};

export const isSpotifyToPlexBundledAvailable = () => !!resolveSpotifyToPlexBundledDir();

export const getSpotifyToPlexDataDir = (configDir) => path.join(String(configDir || ''), 'spotify-to-plex');

const parseEnvFile = (filePath) => {
    if (!filePath || !fs.existsSync(filePath)) return {};
    const out = {};
    const text = fs.readFileSync(filePath, 'utf8');
    for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const idx = trimmed.indexOf('=');
        if (idx <= 0) continue;
        const key = trimmed.slice(0, idx).trim();
        const value = trimmed.slice(idx + 1).trim();
        if (key) out[key] = value;
    }
    return out;
};

const resolveSupervisordBin = () => {
    const candidatesList = [
        '/usr/local/bin/supervisord',
        '/usr/bin/supervisord',
        'supervisord',
    ];
    for (const bin of candidatesList) {
        if (bin.includes('/') && fs.existsSync(bin)) return bin;
    }
    return 'supervisord';
};

export const isUsingBundledSpotifyToPlexUrl = (config = {}) => {
    const internalUrl = String(config.spotifyToPlexInternalUrl || '').trim().replace(/\/+$/, '');
    if (!internalUrl) return isSpotifyToPlexBundledAvailable();
    return internalUrl === SPOTIFY_TO_PLEX_BUNDLED_URL.replace(/\/+$/, '');
};

/**
 * When the spotify-to-plex image is bundled in the portal container, default to loopback URL.
 */
export const applySpotifyToPlexBundledDefaults = (config, { configDir, log = () => {} } = {}) => {
    const next = { ...(config || {}) };
    if (!next.spotifyToPlexEnabled) return { config: next, changed: false };
    if (!isSpotifyToPlexBundledAvailable()) return { config: next, changed: false };

    let changed = false;
    const currentUrl = String(next.spotifyToPlexInternalUrl || '').trim();
    const looksExternalCompose = /^https?:\/\/spotify-to-plex(?::\d+)?\/?$/i.test(currentUrl);
    if (!currentUrl || looksExternalCompose) {
        next.spotifyToPlexInternalUrl = SPOTIFY_TO_PLEX_BUNDLED_URL;
        changed = true;
        log(`[spotify-sync] Using bundled spotify-to-plex at ${SPOTIFY_TO_PLEX_BUNDLED_URL}`);
    }

    if (configDir) {
        fs.mkdirSync(getSpotifyToPlexDataDir(configDir), { recursive: true });
    }
    return { config: next, changed };
};

export const buildSpotifyToPlexEmbeddedSupervisordConf = ({
    stpRoot,
    configDataDir,
    scheduleMode = 'sidecar',
    envVars = {},
} = {}) => {
    const root = String(stpRoot || '').replace(/\/+$/, '');
    const dataDir = String(configDataDir || '').replace(/\/+$/, '');
    const portalSchedule = resolveSpotifyToPlexScheduleMode({ spotifyToPlexScheduleMode: scheduleMode }) === 'portal';
    const syncSchedulerAutostart = portalSchedule ? 'false' : 'true';
    const envPairs = Object.entries(envVars)
        .filter(([key, value]) => key && value != null && String(value).length)
        .map(([key, value]) => `${key}="${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);
    const sharedEnv = [
        'NODE_ENV="production"',
        `NODE_PATH="${root}/node_modules"`,
        `TZ="${String(envVars.TZ || process.env.TZ || 'UTC')}"`,
        `SYNC_ON_STARTUP="${String(envVars.SYNC_ON_STARTUP || 'false')}"`,
        `SPOTIFY_TO_PLEX_CONFIG_DIR="${dataDir}"`,
        `CONFIG_PATH="${dataDir}"`,
        `PLEX_CONFIG_DIR="${dataDir}"`,
        `STORAGE_DIR="${dataDir}"`,
        `CHROME_BIN="${String(envVars.CHROME_BIN || process.env.CHROME_BIN || '/usr/bin/chromium')}"`,
        `CHROMIUM_PATH="${String(envVars.CHROMIUM_PATH || process.env.CHROMIUM_PATH || '/usr/bin/chromium')}"`,
        'HOSTNAME="0.0.0.0"',
        'HOST="0.0.0.0"',
        ...envPairs.filter((line) => (
            !line.startsWith('TZ=')
            && !line.startsWith('SYNC_ON_STARTUP=')
            && !line.startsWith('HOSTNAME=')
            && !line.startsWith('HOST=')
            && !line.startsWith('PORT=')
        )),
    ].join(',');

    return `# Generated by StreamPilot (bundled spotify-to-plex).
# Schedule mode: ${scheduleMode}. Restart portal container after schedule changes.
[supervisord]
nodaemon=true
logfile=${dataDir}/supervisord.log
pidfile=${dataDir}/supervisord.pid
childlogdir=${dataDir}/logs

[program:spotify-scraper]
command=python3 app.py
directory=${root}/apps/spotify-scraper
autostart=true
autorestart=true
environment=PORT="3020",HOST="127.0.0.1",PYTHONPATH="${root}/apps/spotify-scraper",${sharedEnv}
priority=100
startsecs=10
startretries=3
stderr_logfile=${dataDir}/logs/spotify-scraper-stderr.log
stdout_logfile=${dataDir}/logs/spotify-scraper-stdout.log

[program:stp-web]
command=node apps/web/server.js
directory=${root}/web
autostart=true
autorestart=true
environment=PORT="${SPOTIFY_TO_PLEX_EMBEDDED_PORT}",SPOTIFY_SCRAPER_URL="http://127.0.0.1:3020",${sharedEnv}
priority=200
startsecs=15
startretries=3
stderr_logfile=${dataDir}/logs/stp-web-stderr.log
stdout_logfile=${dataDir}/logs/stp-web-stdout.log

[program:sync-scheduler]
command=npx tsx src/scheduler.ts
directory=${root}/apps/sync-worker
autostart=${syncSchedulerAutostart}
autorestart=${syncSchedulerAutostart}
environment=${sharedEnv}
priority=300
startsecs=5
startretries=3
stderr_logfile=${dataDir}/logs/sync-scheduler-stderr.log
stdout_logfile=${dataDir}/logs/sync-scheduler-stdout.log
`;
};

const writeEmbeddedSupervisorConfig = (config, { configDir, stpRoot, log = () => {} } = {}) => {
    const dataDir = getSpotifyToPlexDataDir(configDir);
    fs.mkdirSync(dataDir, { recursive: true });
    const envFilePath = getSpotifyToPlexEnvFilePath(configDir);
    const envVars = parseEnvFile(envFilePath);
    const scheduleMode = resolveSpotifyToPlexScheduleMode(config);
    const contents = buildSpotifyToPlexEmbeddedSupervisordConf({
        stpRoot,
        configDataDir: dataDir,
        scheduleMode,
        envVars,
    });
    const filePath = path.join(dataDir, SPOTIFY_TO_PLEX_EMBEDDED_SUPERVISOR_FILE);
    fs.writeFileSync(filePath, contents, { mode: 0o644 });
    log(`[spotify-sync] Wrote bundled supervisord config (${scheduleMode}) at ${filePath}`);
    return filePath;
};

const isSupervisorAlive = () => !!(supervisorChild && !supervisorChild.killed && supervisorChild.exitCode == null);

const probeBundledWorker = async () => {
    try {
        const res = await fetch(`${SPOTIFY_TO_PLEX_BUNDLED_URL}/`, { method: 'GET' });
        return Number(res?.status) > 0;
    } catch {
        return false;
    }
};

const clearStaleSupervisorFiles = (dataDir) => {
    for (const name of ['supervisord.pid', 'supervisor.sock', 'supervisord.sock']) {
        try {
            fs.unlinkSync(path.join(dataDir, name));
        } catch {
            // ignore missing
        }
    }
};

const waitForChildExit = (child, timeoutMs) => new Promise((resolve) => {
    if (!child || child.exitCode != null || child.signalCode != null) {
        resolve();
        return;
    }
    let done = false;
    const finish = () => {
        if (done) return;
        done = true;
        resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    child.once('exit', () => {
        clearTimeout(timer);
        finish();
    });
});

const stopSupervisor = async (log = () => {}) => {
    const child = supervisorChild;
    if (!child) return;

    plannedSupervisorStops.add(child);
    stoppingIntentionally = true;
    log('[spotify-sync] Stopping bundled spotify-to-plex supervisor');

    if (!child.killed) {
        try {
            child.kill('SIGTERM');
        } catch {
            // ignore
        }
    }

    await waitForChildExit(child, 8000);
    if (child.exitCode == null && child.signalCode == null) {
        try { child.kill('SIGKILL'); } catch { /* ignore */ }
        await waitForChildExit(child, 4000);
    }

    if (supervisorChild === child) supervisorChild = null;
};

const startSupervisor = async ({ configDir, config, log = () => {} } = {}) => {
    const stpRoot = resolveSpotifyToPlexBundledDir();
    if (!stpRoot) {
        throw new Error('Bundled spotify-to-plex files not found in the portal image.');
    }
    const supervisorConf = writeEmbeddedSupervisorConfig(config, { configDir, stpRoot, log });
    const dataDir = getSpotifyToPlexDataDir(configDir);
    const envFilePath = getSpotifyToPlexEnvFilePath(configDir);
    const envFromFile = parseEnvFile(envFilePath);
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(path.join(dataDir, 'logs'), { recursive: true });
    clearStaleSupervisorFiles(dataDir);

    // Docker sets HOSTNAME to the container id. Next.js treats HOSTNAME as the
    // listen address, so inheriting it makes the worker bind somewhere other than
    // loopback — portal probes to 127.0.0.1:9030 then get ECONNREFUSED.
    const childEnv = envWithoutJemalloc({
        ...envFromFile,
        SPOTIFY_TO_PLEX_CONFIG_DIR: dataDir,
        CONFIG_PATH: dataDir,
        PLEX_CONFIG_DIR: dataDir,
        STORAGE_DIR: dataDir,
        TZ: envFromFile.TZ || process.env.TZ || 'UTC',
        SYNC_ON_STARTUP: envFromFile.SYNC_ON_STARTUP || 'false',
        NODE_ENV: 'production',
        PORT: String(SPOTIFY_TO_PLEX_EMBEDDED_PORT),
        HOSTNAME: '0.0.0.0',
        HOST: '0.0.0.0',
        SPOTIFY_SCRAPER_URL: 'http://127.0.0.1:3020',
    });

    const supervisordBin = resolveSupervisordBin();
    lastStartError = '';
    supervisorChild = spawn(supervisordBin, ['-n', '-c', supervisorConf], {
        cwd: stpRoot,
        env: childEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    const logChunk = (buf) => {
        const text = String(buf || '').trim();
        if (text) log(`[spotify-sync] supervisord: ${text}`);
    };
    supervisorChild.stdout?.on('data', logChunk);
    supervisorChild.stderr?.on('data', logChunk);
    supervisorChild.on('error', (error) => {
        lastStartError = error?.message || String(error);
        log(`[spotify-sync] supervisord spawn failed: ${lastStartError}`);
    });

    const child = supervisorChild;
    child.on('exit', (code, signal) => {
        const unexpected = isUnexpectedSpotifyToPlexSupervisorExit({
            stoppingIntentionally,
            planned: plannedSupervisorStops.has(child),
            code,
            signal,
        });
        if (supervisorChild === child) supervisorChild = null;
        stoppingIntentionally = false;
        if (unexpected) {
            lastStartError = `supervisord exited (code=${code}, signal=${signal || 'none'})`;
            log(`[spotify-sync] ${lastStartError}`);
            if (typeof unexpectedExitHandler === 'function') {
                try {
                    const result = unexpectedExitHandler({ code, signal });
                    if (result && typeof result.then === 'function') result.catch(() => {});
                } catch {
                    // ignore
                }
            }
        }
    });

    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
        if (!isSupervisorAlive()) {
            throw new Error(lastStartError || 'Bundled spotify-to-plex supervisor failed to start. Check portal logs.');
        }
        if (await probeBundledWorker()) {
            lastStartError = '';
            log(`[spotify-sync] Bundled spotify-to-plex ready at ${SPOTIFY_TO_PLEX_BUNDLED_URL}`);
            return;
        }
        await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error('Bundled spotify-to-plex did not become ready in time. Check config/spotify-to-plex/logs/.');
};

export const getSpotifyToPlexEmbeddedStatus = () => ({
    running: isSupervisorAlive(),
    pid: supervisorChild?.pid || null,
    bundledAvailable: isSpotifyToPlexBundledAvailable(),
    bundledUrl: SPOTIFY_TO_PLEX_BUNDLED_URL,
    lastError: lastStartError || '',
});

/**
 * Start or stop bundled spotify-to-plex (supervisord) to match portal config.
 */
export const syncSpotifyToPlexEmbeddedWorker = async (
    config,
    { configDir, log = () => {}, forceRestart = false } = {},
) => {
    if (startingPromise) {
        const shouldJoin = !!config?.spotifyToPlexEnabled && !forceRestart && isUsingBundledSpotifyToPlexUrl(config);
        try {
            const result = await startingPromise;
            if (shouldJoin) return result;
        } catch {
            if (shouldJoin) {
                // fall through and retry
            }
        }
    }

    const run = (async () => {
        if (!config?.spotifyToPlexEnabled) {
            await stopSupervisor(log);
            return { running: false, bundled: isSpotifyToPlexBundledAvailable() };
        }

        if (!isSpotifyToPlexBundledAvailable()) {
            return { running: false, bundled: false };
        }

        if (!isUsingBundledSpotifyToPlexUrl(config)) {
            await stopSupervisor(log);
            return { running: false, bundled: true, external: true };
        }

        if (!forceRestart && isSupervisorAlive() && await probeBundledWorker()) {
            return { running: true, bundled: true };
        }

        if (isSupervisorAlive()) {
            await stopSupervisor(log);
        }

        try {
            await startSupervisor({ configDir, config, log });
            return { running: true, bundled: true };
        } catch (error) {
            lastStartError = error?.message || String(error);
            throw error;
        }
    })();

    startingPromise = run;
    try {
        return await run;
    } finally {
        if (startingPromise === run) startingPromise = null;
    }
};
