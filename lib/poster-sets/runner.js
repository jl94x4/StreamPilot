import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

export const POSTER_SETS_APP_DIR = process.env.POSTER_SETS_APP_DIR
    ? path.resolve(process.env.POSTER_SETS_APP_DIR)
    : path.join(REPO_ROOT, 'poster-sets');

const resolvePythonBinary = () => {
    if (process.env.POSTER_SETS_PYTHON) return process.env.POSTER_SETS_PYTHON;
    const venvUnix = '/opt/poster-sets-venv/bin/python';
    const venvWin = path.join(REPO_ROOT, 'poster-sets', '.venv', 'Scripts', 'python.exe');
    if (fs.existsSync(venvUnix)) return venvUnix;
    if (fs.existsSync(venvWin)) return venvWin;
    return process.platform === 'win32' ? 'python' : 'python3';
};

export const posterSetsWorkerReady = () => {
    const cli = path.join(POSTER_SETS_APP_DIR, 'cli.py');
    const core = path.join(POSTER_SETS_APP_DIR, 'core.py');
    return fs.existsSync(cli) && fs.existsSync(core);
};

/** @type {import('child_process').ChildProcessWithoutNullStreams | null} */
let activePosterSetsChild = null;
/** @type {Set<import('child_process').ChildProcessWithoutNullStreams>} */
const activePosterSetsChildren = new Set();

/** Kill in-flight Python worker(s) (queue stop / stale recovery / Warm cancel). */
export const killActivePosterSetsWorker = () => {
    let killed = false;
    for (const child of [...activePosterSetsChildren]) {
        try {
            child.kill('SIGKILL');
            killed = true;
        } catch {
            /* ignore */
        }
    }
    activePosterSetsChildren.clear();
    activePosterSetsChild = null;
    return killed;
};

const resolvePlexIdentityEnv = () => {
    const clientId = String(
        process.env.CLIENT_ID
        || process.env.PLEX_CLIENT_IDENTIFIER
        || process.env.PLEXAPI_HEADER_IDENTIFIER
        || '',
    ).trim();
    const dataDir = String(
        process.env.POSTER_SETS_DATA_DIR
        || process.env.COLLEXIONS_DATA_DIR
        || process.env.CONFIG_DIR
        || '',
    ).trim();
    return {
        PLEXAPI_HEADER_PRODUCT: 'StreamPilot',
        PLEXAPI_HEADER_DEVICE: 'Server',
        PLEXAPI_HEADER_DEVICE_NAME: 'StreamPilot',
        PLEXAPI_HEADER_PLATFORM: 'StreamPilot',
        ...(dataDir ? { POSTER_SETS_DATA_DIR: dataDir } : {}),
        ...(clientId ? {
            CLIENT_ID: clientId,
            PLEX_CLIENT_IDENTIFIER: clientId,
            PLEXAPI_HEADER_IDENTIFIER: clientId,
        } : {}),
    };
};

/**
 * Run poster-sets CLI command. Emits progress via onProgress and batch events via onBatch.
 * @returns {Promise<{ ok: boolean, result?: object, error?: string, logs: string[] }>}
 */
export const runPosterSetsCli = (command, payload = {}, { timeoutMs = 30 * 60_000, stallTimeoutMs = 0, onProgress, onBatch } = {}) => new Promise((resolve) => {
    if (!posterSetsWorkerReady()) {
        resolve({
            ok: false,
            error: 'Poster Sets worker is not installed (poster-sets/cli.py missing).',
            logs: [],
        });
        return;
    }

    const python = resolvePythonBinary();
    const cli = path.join(POSTER_SETS_APP_DIR, 'cli.py');
    const child = spawn(python, [cli, command], {
        cwd: POSTER_SETS_APP_DIR,
        env: {
            ...process.env,
            PYTHONUNBUFFERED: '1',
            ...resolvePlexIdentityEnv(),
        },
        stdio: ['pipe', 'pipe', 'pipe'],
    });
    activePosterSetsChildren.add(child);
    activePosterSetsChild = child;

    let settled = false;
    const logs = [];
    let stdout = '';
    let stderr = '';
    let result = null;
    let errorMessage = null;
    let stallTimer = null;

    const finish = (ok, extra = {}) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (stallTimer) clearTimeout(stallTimer);
        resolve({ ok, result, error: errorMessage, logs, stderr: stderr.trim(), ...extra });
    };

    const bumpStall = () => {
        const stallMs = Number(stallTimeoutMs) || 0;
        if (stallMs <= 0) return;
        if (stallTimer) clearTimeout(stallTimer);
        stallTimer = setTimeout(() => {
            try { child.kill('SIGKILL'); } catch { /* ignore */ }
            errorMessage = 'Poster Sets worker stalled (no progress)';
            finish(false);
        }, stallMs);
    };

    const timer = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch { /* ignore */ }
        errorMessage = 'Poster Sets worker timed out';
        finish(false);
    }, timeoutMs);
    bumpStall();

    child.stdout.on('data', (chunk) => {
        stdout += String(chunk);
        const lines = stdout.split(/\r?\n/);
        stdout = lines.pop() || '';
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
                const event = JSON.parse(trimmed);
                if (event.type === 'progress') {
                    bumpStall();
                    logs.push(String(event.message || ''));
                    onProgress?.(String(event.message || ''), event);
                } else if (event.type === 'batch') {
                    bumpStall();
                    onBatch?.(event);
                } else if (event.type === 'result') {
                    result = event;
                    if (event.ok === false) {
                        errorMessage = String(event.error || event.message || errorMessage || 'Worker returned failure');
                    }
                } else if (event.type === 'error') {
                    errorMessage = String(event.message || 'Worker error');
                    logs.push(errorMessage);
                }
            } catch {
                bumpStall();
                logs.push(trimmed);
                onProgress?.(trimmed);
            }
        }
    });

    child.stderr.on('data', (chunk) => {
        stderr += String(chunk);
    });

    child.on('error', (error) => {
        errorMessage = error?.code === 'ENOENT'
            ? `Python not found (${python}). Install poster-sets venv or set POSTER_SETS_PYTHON.`
            : (error.message || String(error));
        finish(false);
    });

    child.on('close', (code) => {
        activePosterSetsChildren.delete(child);
        if (activePosterSetsChild === child) activePosterSetsChild = null;
        if (stdout.trim()) {
            try {
                const event = JSON.parse(stdout.trim());
                if (event.type === 'result') {
                    result = event;
                    if (event.ok === false) {
                        errorMessage = String(event.error || event.message || errorMessage || 'Worker returned failure');
                    }
                }
                if (event.type === 'batch') onBatch?.(event);
                if (event.type === 'error') errorMessage = String(event.message || errorMessage || 'Worker error');
            } catch {
                logs.push(stdout.trim());
            }
        }
        if (code !== 0 && !errorMessage) {
            errorMessage = stderr.trim() || `Worker exited with code ${code}`;
        }
        const resultFailed = result && result.ok === false;
        finish(code === 0 && !errorMessage && !resultFailed, { code });
    });

    try {
        child.stdin.write(JSON.stringify(payload));
        child.stdin.end();
    } catch (error) {
        errorMessage = error.message || String(error);
        finish(false);
    }
});
