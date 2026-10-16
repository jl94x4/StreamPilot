import fs from 'fs/promises';
import path from 'path';
import { CONFIG_DIR } from '../data-paths.js';

export const SCANNER_DIR = path.join(CONFIG_DIR, 'scanner');
export const QUEUE_PATH = path.join(SCANNER_DIR, 'queue.json');
export const LOG_PATH = path.join(SCANNER_DIR, 'log.json');

const MAX_LOG = 500;

const ensureDir = async () => {
    await fs.mkdir(SCANNER_DIR, { recursive: true });
};

const readJson = async (filePath, fallback) => {
    try {
        const raw = await fs.readFile(filePath, 'utf8');
        return JSON.parse(raw);
    } catch {
        return fallback;
    }
};

const writeJson = async (filePath, data) => {
    await ensureDir();
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
};

/**
 * @typedef {{
 *   folder: string,
 *   priority: number,
 *   time: string,
 *   source?: string,
 *   eventType?: string,
 *   action?: string,
 *   reason?: string,
 *   title?: string,
 *   quality?: string,
 *   isUpgrade?: boolean,
 * }} ScanItem
 */

const pickMeta = (item = {}) => ({
    source: item.source || 'unknown',
    eventType: item.eventType || undefined,
    action: item.action || undefined,
    reason: item.reason || undefined,
    title: item.title || undefined,
    quality: item.quality || undefined,
    isUpgrade: item.isUpgrade ? true : undefined,
});

const readQueue = async () => {
    const data = await readJson(QUEUE_PATH, { scans: [], held: [] });
    return {
        scans: Array.isArray(data.scans) ? data.scans : [],
        held: Array.isArray(data.held) ? data.held : [],
    };
};

const writeQueue = async (scans, held) => {
    await writeJson(QUEUE_PATH, { scans, held });
};

const withoutHoldMeta = (item = {}) => {
    const { heldAt, holdReason, attempts, ...rest } = item;
    return rest;
};

const sortScans = (scans) => [...scans].sort((a, b) => {
    if ((b.priority || 0) !== (a.priority || 0)) return (b.priority || 0) - (a.priority || 0);
    return (Date.parse(a.time) || 0) - (Date.parse(b.time) || 0);
});

const mergeScans = (scans, items) => {
    const byFolder = new Map(scans.map((scan) => [scan.folder, scan]));
    for (const item of items) {
        const folder = String(item.folder || '').trim();
        if (!folder) continue;
        const next = {
            ...withoutHoldMeta(item),
            folder,
            priority: Number(item.priority) || 0,
            time: item.time || new Date().toISOString(),
            ...pickMeta(item),
        };
        const existing = byFolder.get(folder);
        if (!existing) {
            byFolder.set(folder, next);
            continue;
        }
        if (next.priority > existing.priority) {
            byFolder.set(folder, next);
        } else if (next.priority === existing.priority) {
            const existingMs = Date.parse(existing.time) || 0;
            const nextMs = Date.parse(next.time) || 0;
            const time = nextMs < existingMs ? next.time : existing.time;
            byFolder.set(folder, { ...existing, ...pickMeta(next), time, priority: existing.priority });
        } else {
            byFolder.set(folder, { ...existing, ...pickMeta(next) });
        }
    }
    return sortScans([...byFolder.values()]);
};

const mergeHeld = (held, items, reason, { countAttempt = true } = {}) => {
    const byFolder = new Map(held.map((scan) => [scan.folder, scan]));
    const added = [];
    for (const item of items) {
        const folder = String(item.folder || '').trim();
        if (!folder) continue;
        const base = {
            ...withoutHoldMeta(item),
            folder,
            priority: Number(item.priority) || 0,
            time: item.time || new Date().toISOString(),
            ...pickMeta(item),
        };
        const existing = byFolder.get(folder);
        if (!existing) {
            const next = {
                ...base,
                heldAt: new Date().toISOString(),
                holdReason: String(reason || ''),
                attempts: 1,
            };
            byFolder.set(folder, next);
            added.push(next);
            continue;
        }
        const existingMs = Date.parse(existing.time) || 0;
        const nextMs = Date.parse(base.time) || 0;
        byFolder.set(folder, {
            ...existing,
            ...pickMeta(base),
            priority: Math.max(existing.priority || 0, base.priority || 0),
            time: nextMs && existingMs && nextMs < existingMs ? base.time : existing.time,
            holdReason: String(reason || existing.holdReason || ''),
            attempts: (Number(existing.attempts) || 1) + (countAttempt ? 1 : 0),
        });
    }
    return { held: [...byFolder.values()], added };
};

export const listQueue = async () => (await readQueue()).scans;

export const listHeld = async () => (await readQueue()).held;

export const getQueueStats = async () => {
    const { scans, held } = await readQueue();
    const log = await readJson(LOG_PATH, { entries: [], processed: 0 });
    return {
        remaining: scans.length,
        held: held.length,
        processed: Number(log.processed) || 0,
        scans,
        heldScans: held,
    };
};

/**
 * Upsert scans by folder. Higher priority wins; same priority keeps older time (Autoscan-like).
 * @param {ScanItem[]} items
 */
export const upsertScans = async (items = []) => {
    if (!items.length) return await listQueue();
    const { scans, held } = await readQueue();
    const heldFolders = new Set(held.map((scan) => scan.folder));
    const toHold = [];
    const toScan = [];
    for (const item of items) {
        const folder = String(item.folder || '').trim();
        if (!folder) continue;
        if (heldFolders.has(folder)) toHold.push(item);
        else toScan.push(item);
    }
    const nextHeld = toHold.length
        ? mergeHeld(held, toHold, '', { countAttempt: false }).held
        : held;
    const nextScans = mergeScans(scans, toScan);
    await writeQueue(nextScans, nextHeld);
    return nextScans;
};

/**
 * Park scans until the media server responds again.
 * Newly parked items are returned in `added` so the caller can log them once.
 * @param {ScanItem[]} items
 * @param {string} reason
 */
export const holdScans = async (items = [], reason = '') => {
    const list = Array.isArray(items) ? items : [];
    if (!list.length) return { held: await listHeld(), added: [] };
    const { scans, held } = await readQueue();
    const folders = new Set(list.map((item) => String(item.folder || '').trim()).filter(Boolean));
    const remaining = scans.filter((scan) => !folders.has(scan.folder));
    const merged = mergeHeld(held, list, reason, { countAttempt: true });
    await writeQueue(remaining, merged.held);
    return merged;
};

/** Move every active scan into the holding section. */
export const holdActiveScans = async (reason = '') => {
    const { scans, held } = await readQueue();
    if (!scans.length) return { held, added: [] };
    const merged = mergeHeld(held, scans, reason, { countAttempt: true });
    await writeQueue([], merged.held);
    return merged;
};

/** Put held scans back on the active queue, keeping their original queue time. */
export const releaseHeld = async () => {
    const { scans, held } = await readQueue();
    if (!held.length) return [];
    const released = held.map((item) => withoutHoldMeta(item));
    await writeQueue(mergeScans(scans, released), []);
    return released;
};

/**
 * Claim the next scan that is older than minimumAgeMs.
 * @param {number} minimumAgeMs
 * @param {{ verifyPathExists?: boolean }} opts
 * @returns {Promise<ScanItem|null>}
 */
export const claimDueScan = async (minimumAgeMs, opts = {}) => {
    const { scans, held } = await readQueue();
    if (!scans.length) return null;
    const now = Date.now();
    const minAge = Math.max(0, Number(minimumAgeMs) || 0);

    for (let i = 0; i < scans.length; i++) {
        const scan = scans[i];
        const age = now - (Date.parse(scan.time) || 0);
        if (age < minAge) continue;

        if (opts.verifyPathExists) {
            try {
                await fs.stat(scan.folder);
            } catch {
                // Not ready yet — leave in queue and try next.
                continue;
            }
        }

        const remaining = [...scans.slice(0, i), ...scans.slice(i + 1)];
        await writeQueue(remaining, held);
        return scan;
    }
    return null;
};

export const appendLog = async (entry, { countProcessed = true } = {}) => {
    const data = await readJson(LOG_PATH, { entries: [], processed: 0 });
    const entries = Array.isArray(data.entries) ? data.entries : [];
    entries.unshift({
        ...entry,
        at: entry.at || new Date().toISOString(),
    });
    while (entries.length > MAX_LOG) entries.pop();
    const processed = (Number(data.processed) || 0) + (entry.ok && countProcessed ? 1 : 0);
    await writeJson(LOG_PATH, { entries, processed });
};

export const listLog = async (limit = 50) => {
    const data = await readJson(LOG_PATH, { entries: [], processed: 0 });
    const entries = Array.isArray(data.entries) ? data.entries : [];
    return {
        processed: Number(data.processed) || 0,
        entries: entries.slice(0, Math.max(1, limit)),
    };
};
