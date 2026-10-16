/**
 * Watch ColleXions status.json for failure states and notify once per signature.
 */

import fs from 'fs/promises';
import path from 'path';
import { getCollexionsDataDir } from './collexions-embedded.js';
import { isCollexionsFailureStatus } from './notifications/opsNotify.js';

let timer = null;
let lastFailureSignature = '';
let onFailure = null;

export const setCollexionsFailureNotify = (fn) => {
    onFailure = typeof fn === 'function' ? fn : null;
};

const readStatus = async (configDir) => {
    const statusPath = path.join(getCollexionsDataDir(configDir), 'status.json');
    try {
        const raw = await fs.readFile(statusPath, 'utf8');
        const data = JSON.parse(raw);
        return data && typeof data === 'object' ? data : null;
    } catch {
        return null;
    }
};

export const pollCollexionsStatusOnce = async ({ configDir, enabled = true } = {}) => {
    if (!enabled || !configDir) return null;
    const status = await readStatus(configDir);
    const message = String(status?.status || '').trim();
    if (!isCollexionsFailureStatus(message)) {
        lastFailureSignature = '';
        return null;
    }
    const signature = `${message}|${status?.last_update || status?.last_run_at || ''}`;
    if (signature === lastFailureSignature) return null;
    lastFailureSignature = signature;
    const payload = { message, signature, status };
    if (typeof onFailure === 'function') {
        try {
            const result = onFailure(payload);
            if (result && typeof result.then === 'function') result.catch(() => {});
        } catch {
            // ignore
        }
    }
    return payload;
};

export const startCollexionsStatusWatcher = ({ configDir, getEnabled, intervalMs = 30_000 } = {}) => {
    if (timer) return;
    const tick = async () => {
        try {
            const enabled = typeof getEnabled === 'function' ? !!(await getEnabled()) : true;
            await pollCollexionsStatusOnce({ configDir, enabled });
        } catch {
            // ignore
        }
    };
    timer = setInterval(tick, Math.max(10_000, Number(intervalMs) || 30_000));
    if (typeof timer.unref === 'function') timer.unref();
    void tick();
};

export const stopCollexionsStatusWatcher = () => {
    if (timer) clearInterval(timer);
    timer = null;
};

export const resetCollexionsStatusWatchForTests = () => {
    lastFailureSignature = '';
};
