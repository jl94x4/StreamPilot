/**
 * JSON persistence under config/metadata-fill/.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

export const METADATA_FILL_DIR = path.join(process.cwd(), 'config', 'metadata-fill');
export const LOG_PATH = path.join(METADATA_FILL_DIR, 'activity.json');
export const RETRY_PATH = path.join(METADATA_FILL_DIR, 'retry-queue.json');
export const SCAN_PATH = path.join(METADATA_FILL_DIR, 'library-scan.json');
export const CLEARLOGO_SCAN_PATH = path.join(METADATA_FILL_DIR, 'clearlogo-scan.json');
export const MAX_LOG = 2000;
export const MAX_RETRY = 200;
export const MAX_SCAN_PREVIEW = 400;
/** Soft cap for already-set / none samples only — available gaps are never dropped. */
export const MAX_CLEARLOGO_PREVIEW = 5000;
export const MAX_CLEARLOGO_HAS_LOGO_SAMPLE = 250;
export const MAX_CLEARLOGO_NONE_SAMPLE = 150;

/**
 * Persist every available/applied/failed gap; ring-buffer hasLogo/none samples.
 * (A flat 500 cap was cutting “Apply all” short of stats.available.)
 */
export const retainClearlogoPreview = (preview = []) => {
    const available = [];
    const other = [];
    const hasLogo = [];
    const none = [];
    for (const row of (Array.isArray(preview) ? preview : [])) {
        const status = String(row?.status || '');
        if (status === 'available' || status === 'applied' || row?.applied) available.push(row);
        else if (status === 'failed') other.push(row);
        else if (status === 'hasLogo') hasLogo.push(row);
        else if (status === 'none') none.push(row);
        else other.push(row);
    }
    const kept = [
        ...available,
        ...other,
        ...hasLogo.slice(-MAX_CLEARLOGO_HAS_LOGO_SAMPLE),
        ...none.slice(-MAX_CLEARLOGO_NONE_SAMPLE),
    ];
    // Safety valve only — never trim below the available set.
    if (kept.length <= MAX_CLEARLOGO_PREVIEW) return kept;
    const mustKeep = available.length + other.length;
    if (mustKeep >= MAX_CLEARLOGO_PREVIEW) return [...available, ...other].slice(0, MAX_CLEARLOGO_PREVIEW);
    return kept.slice(0, MAX_CLEARLOGO_PREVIEW);
};

export const ensureMetadataFillDir = async () => {
    await fs.mkdir(METADATA_FILL_DIR, { recursive: true });
};

const readJson = async (filePath, fallback) => {
    try {
        const raw = await fs.readFile(filePath, 'utf8');
        return JSON.parse(raw);
    } catch {
        return fallback;
    }
};

const writeJson = async (filePath, value) => {
    await ensureMetadataFillDir();
    await fs.writeFile(filePath, JSON.stringify(value, null, 2), 'utf8');
};

export const newMetadataFillId = () => (
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
);

export const readMetadataFillLog = async () => {
    const parsed = await readJson(LOG_PATH, []);
    return Array.isArray(parsed) ? parsed : [];
};

export const appendMetadataFillLog = async (entry) => {
    const list = await readMetadataFillLog();
    list.unshift({
        id: entry?.id || newMetadataFillId(),
        at: new Date().toISOString(),
        ...entry,
    });
    await writeJson(LOG_PATH, list.slice(0, MAX_LOG));
    return list[0];
};

export const findMetadataFillLogEntry = async (id) => {
    const want = String(id || '').trim();
    if (!want) return null;
    const list = await readMetadataFillLog();
    return list.find((row) => String(row?.id || '') === want) || null;
};

export const readRetryQueue = async () => {
    const parsed = await readJson(RETRY_PATH, { items: [] });
    return {
        items: Array.isArray(parsed?.items) ? parsed.items : [],
    };
};

export const writeRetryQueue = async (queue) => {
    const items = Array.isArray(queue?.items) ? queue.items.slice(0, MAX_RETRY) : [];
    await writeJson(RETRY_PATH, { items, updatedAt: new Date().toISOString() });
    return { items };
};

export const readLibraryScanState = async () => {
    const parsed = await readJson(SCAN_PATH, null);
    if (!parsed || typeof parsed !== 'object') {
        return {
            status: 'idle',
            dryRun: true,
            cancelRequested: false,
            cursor: null,
            stats: {
                scanned: 0,
                needingFill: 0,
                previewed: 0,
                filled: 0,
                skipped: 0,
                failed: 0,
            },
            preview: [],
            libraries: [],
            updatedAt: null,
            startedAt: null,
            finishedAt: null,
            error: null,
        };
    }
    return parsed;
};

export const writeLibraryScanState = async (state) => {
    const next = {
        ...state,
        updatedAt: new Date().toISOString(),
        preview: Array.isArray(state?.preview) ? state.preview.slice(0, MAX_SCAN_PREVIEW) : [],
    };
    await writeJson(SCAN_PATH, next);
    return next;
};

const emptyClearlogoStats = () => ({
    scanned: 0,
    hasLogo: 0,
    available: 0,
    none: 0,
    applied: 0,
    skipped: 0,
    failed: 0,
});

export const readClearlogoScanState = async () => {
    const parsed = await readJson(CLEARLOGO_SCAN_PATH, null);
    if (!parsed || typeof parsed !== 'object') {
        return {
            status: 'idle',
            dryRun: true,
            cancelRequested: false,
            cursor: null,
            stats: emptyClearlogoStats(),
            preview: [],
            libraries: [],
            selectedLibraryKeys: [],
            updatedAt: null,
            startedAt: null,
            finishedAt: null,
            error: null,
        };
    }
    return parsed;
};

export const writeClearlogoScanState = async (state) => {
    const next = {
        ...state,
        updatedAt: new Date().toISOString(),
        preview: retainClearlogoPreview(state?.preview),
        stats: state?.stats && typeof state.stats === 'object'
            ? { ...emptyClearlogoStats(), ...state.stats }
            : emptyClearlogoStats(),
    };
    await writeJson(CLEARLOGO_SCAN_PATH, next);
    return next;
};
