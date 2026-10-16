import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { EDITIONS_APP_DIR, EDITIONS_BACKUP_DIR, EDITIONS_CONFIG_INI } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

const resolvePythonBinary = () => {
    if (process.env.EDITIONS_PYTHON) return process.env.EDITIONS_PYTHON;
    if (process.env.OVERLAYS_PYTHON) return process.env.OVERLAYS_PYTHON;
    if (process.env.POSTER_SETS_PYTHON) return process.env.POSTER_SETS_PYTHON;
    const candidates = [
        '/opt/poster-sets-venv/bin/python',
        path.join(REPO_ROOT, 'poster-sets', '.venv', 'Scripts', 'python.exe'),
        path.join(REPO_ROOT, 'overlays', '.venv', 'Scripts', 'python.exe'),
        path.join(REPO_ROOT, 'overlays', '.venv', 'bin', 'python'),
        path.join(REPO_ROOT, 'editions', '.venv', 'Scripts', 'python.exe'),
        path.join(REPO_ROOT, 'editions', '.venv', 'bin', 'python'),
    ];
    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) return candidate;
    }
    return process.platform === 'win32' ? 'python' : 'python3';
};

export const editionsWorkerReady = () => {
    const cli = path.join(EDITIONS_APP_DIR, 'cli.py');
    const engine = path.join(EDITIONS_APP_DIR, 'edition_manager.py');
    const modulesDir = path.join(EDITIONS_APP_DIR, 'modules');
    return fs.existsSync(cli) && fs.existsSync(engine) && fs.existsSync(modulesDir);
};

/** @type {Set<import('child_process').ChildProcessWithoutNullStreams>} */
const activeChildren = new Set();

export const killActiveEditionsWorker = () => {
    let killed = false;
    for (const child of [...activeChildren]) {
        try {
            child.kill('SIGKILL');
            killed = true;
        } catch {
            /* ignore */
        }
    }
    activeChildren.clear();
    return killed;
};

/**
 * Spawn editions CLI and stream JSONL events.
 * @returns {Promise<{ code: number, events: any[], result: any | null, logs: string[] }>}
 */
export const runEditionsCli = (payload, { onEvent } = {}) => new Promise((resolve, reject) => {
    if (!editionsWorkerReady()) {
        reject(new Error('Editions Python worker is missing (editions/cli.py).'));
        return;
    }

    const python = resolvePythonBinary();
    const cli = path.join(EDITIONS_APP_DIR, 'cli.py');
    const child = spawn(python, [cli], {
        cwd: EDITIONS_APP_DIR,
        env: {
            ...process.env,
            PYTHONUNBUFFERED: '1',
            PYTHONIOENCODING: 'utf-8',
            EDITIONS_CONFIG_INI,
            EDITIONS_BACKUP_DIR,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
    });
    activeChildren.add(child);

    const events = [];
    const logs = [];
    let result = null;
    let lastError = null;
    let stderr = '';
    let buffer = '';

    const handleLine = (line) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        try {
            const event = JSON.parse(trimmed);
            events.push(event);
            if (event.type === 'log' && event.message) logs.push(String(event.message));
            if (event.type === 'error' && event.message) lastError = String(event.message);
            if (event.type === 'result') result = event;
            if (typeof onEvent === 'function') onEvent(event);
        } catch {
            logs.push(trimmed);
            if (typeof onEvent === 'function') onEvent({ type: 'log', level: 'info', message: trimmed });
        }
    };

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
        buffer += chunk;
        const parts = buffer.split(/\r?\n/);
        buffer = parts.pop() || '';
        for (const part of parts) handleLine(part);
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
        stderr += chunk;
    });

    child.on('error', (error) => {
        activeChildren.delete(child);
        reject(error);
    });

    child.on('close', (code) => {
        activeChildren.delete(child);
        if (buffer.trim()) handleLine(buffer);
        if (code !== 0 && !result) {
            const message = lastError || stderr.trim() || `Editions CLI exited with code ${code}`;
            reject(new Error(message));
            return;
        }
        resolve({ code: code ?? 0, events, result, logs, stderr: stderr.trim() });
    });

    try {
        child.stdin.write(JSON.stringify(payload || {}));
        child.stdin.end();
    } catch (error) {
        activeChildren.delete(child);
        try { child.kill('SIGKILL'); } catch { /* ignore */ }
        reject(error);
    }
});
