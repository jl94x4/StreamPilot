import { loadOverlaysLog, saveOverlaysLog } from './config.js';

/**
 * Normalize an upstream overlaid_log.json blob into StreamPilot log entries.
 * @param {unknown} raw
 * @returns {{ log: Record<string, object>, imported: number, skipped: number }}
 */
export const normalizeImportedLog = (raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error('Import must be a JSON object keyed by Plex ratingKey.');
    }
    const log = {};
    let imported = 0;
    let skipped = 0;
    for (const [key, value] of Object.entries(raw)) {
        const ratingKey = String(key || '').trim();
        if (!/^\d+$/.test(ratingKey)) {
            skipped += 1;
            continue;
        }
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            skipped += 1;
            continue;
        }
        log[ratingKey] = {
            ...value,
            title: String(value.title || ratingKey),
            timestamp: value.timestamp || new Date().toISOString(),
            preview_only: Boolean(value.preview_only ?? value.previewOnly),
        };
        imported += 1;
    }
    return { log, imported, skipped };
};

/**
 * @param {object} options
 * @param {'merge'|'replace'} [options.mode]
 */
export const importOverlaysLog = async (raw, { mode = 'merge' } = {}) => {
    const { log: incoming, imported, skipped } = normalizeImportedLog(raw);
    if (mode === 'replace') {
        await saveOverlaysLog(incoming);
        return {
            ok: true,
            mode: 'replace',
            imported,
            skipped,
            total: Object.keys(incoming).length,
        };
    }

    const existing = await loadOverlaysLog();
    const next = { ...existing };
    let updated = 0;
    let added = 0;
    for (const [key, entry] of Object.entries(incoming)) {
        if (next[key]) {
            // Imported live entries win; keep previews unless incoming is live.
            const incomingLive = entry.preview_only !== true;
            const existingLive = next[key].preview_only !== true;
            if (incomingLive || !existingLive) {
                next[key] = { ...next[key], ...entry };
                updated += 1;
            }
        } else {
            next[key] = entry;
            added += 1;
        }
    }
    await saveOverlaysLog(next);
    return {
        ok: true,
        mode: 'merge',
        imported,
        skipped,
        added,
        updated,
        total: Object.keys(next).length,
    };
};
