import { spawn, execFile } from 'child_process';
import { envWithoutJemalloc } from '../child-env.js';

/** Force-kill a child and (on Windows) its process tree. */
export const killChildProcess = (child, { force = false } = {}) => {
    if (!child?.pid) return;
    const pid = child.pid;
    if (process.platform === 'win32') {
        // TerminateProcess via child.kill often leaves ffmpeg helpers alive on Windows.
        execFile('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }, () => {});
        try {
            child.kill(force ? undefined : 'SIGTERM');
        } catch {
            // already gone
        }
        return;
    }
    try {
        child.kill(force ? 'SIGKILL' : 'SIGTERM');
    } catch {
        // already gone
    }
};

export const spawnCommand = (executable, args = [], {
    cwd,
    env,
    signal,
    timeoutMs = 0,
    stdin = 'ignore',
    onStdout,
    onStderr,
    maxBufferBytes = 10 * 1024 * 1024,
    /** Reject the promise if the process ignores kill this long after abort/timeout. */
    abortGraceMs = 2_000,
} = {}) => new Promise((resolve, reject) => {
    if (!executable || typeof executable !== 'string') return reject(new TypeError('executable is required'));
    if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string')) {
        return reject(new TypeError('args must be an array of strings'));
    }
    const child = spawn(executable, args, {
        cwd,
        env: envWithoutJemalloc(env || {}),
        shell: false,
        windowsHide: true,
        stdio: [stdin, 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    let abortTimer = null;
    let killTimer = null;

    const append = (current, chunk) => {
        const next = current + chunk.toString('utf8');
        if (Buffer.byteLength(next) > maxBufferBytes) {
            killChildProcess(child, { force: true });
            throw Object.assign(new Error('Process output exceeded limit'), { code: 'MAX_BUFFER' });
        }
        return next;
    };

    const finish = (error, result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearTimeout(abortTimer);
        clearTimeout(killTimer);
        signal?.removeEventListener('abort', abort);
        if (error) reject(error);
        else resolve(result);
    };
    const abort = () => {
        killChildProcess(child, { force: false });
        clearTimeout(killTimer);
        killTimer = setTimeout(() => killChildProcess(child, { force: true }), 5_000);
        killTimer.unref?.();
        // If ffmpeg never emits close after kill, still fail the job so cancel/timeout work.
        const grace = Math.max(250, Number(abortGraceMs) || 2_000);
        clearTimeout(abortTimer);
        abortTimer = setTimeout(() => {
            if (settled) return;
            if (timedOut) {
                finish(Object.assign(new Error(`Process timed out after ${timeoutMs}ms`), {
                    code: 'ETIMEDOUT',
                    stdout,
                    stderr,
                }));
                return;
            }
            finish(Object.assign(new Error('Process cancelled'), {
                code: 'ABORT_ERR',
                stdout,
                stderr,
            }));
        }, grace);
        abortTimer.unref?.();
    };
    const timer = timeoutMs > 0 ? setTimeout(() => {
        timedOut = true;
        abort();
    }, timeoutMs) : null;
    timer?.unref?.();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();

    child.stdout.on('data', (chunk) => {
        try {
            stdout = append(stdout, chunk);
            onStdout?.(chunk.toString('utf8'));
        } catch (error) {
            finish(error);
        }
    });
    child.stderr.on('data', (chunk) => {
        try {
            stderr = append(stderr, chunk);
            onStderr?.(chunk.toString('utf8'));
        } catch (error) {
            finish(error);
        }
    });
    child.once('error', (error) => finish(error));
    child.once('close', (code, closeSignal) => {
        if (signal?.aborted) {
            return finish(Object.assign(new Error('Process cancelled'), { code: 'ABORT_ERR', stdout, stderr }));
        }
        if (timedOut) {
            return finish(Object.assign(new Error(`Process timed out after ${timeoutMs}ms`), { code: 'ETIMEDOUT', stdout, stderr }));
        }
        const result = { code, signal: closeSignal, stdout, stderr, pid: child.pid };
        if (code !== 0) {
            return finish(Object.assign(new Error(`Process exited with code ${code}`), result));
        }
        return finish(null, result);
    });
});

export default spawnCommand;
