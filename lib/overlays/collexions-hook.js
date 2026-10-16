/**
 * ColleXions → Overlays bridge.
 * When ColleXions updates a Plex collection that is referenced by an Overlays
 * custom-collection rule, queue a targeted collections-only restamp.
 */
import { loadOverlaysConfig, saveOverlaysConfig } from './config.js';
import { pushActivity, runState } from './runtime.js';
import { overlaysRunLockAlive } from './runner.js';

const DEBOUNCE_MS = 45_000;
const RETRY_BUSY_MS = 60_000;

/** @type {Map<string, { ratingKey: string, title?: string, library?: string }>} */
const pending = new Map();
let flushTimer = null;
let retryTimer = null;
/** @type {null | ((opts: object) => Promise<unknown>)} */
let startCommandRef = null;
/** @type {null | (() => Promise<object>)} */
let loadPortalConfigRef = null;

const ruleCollectionKeys = (rule) => {
    const keys = [];
    const seen = new Set();
    const list = Array.isArray(rule?.collectionRatingKeys) ? rule.collectionRatingKeys : [];
    for (const item of list) {
        const key = String(item || '').trim();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        keys.push(key);
    }
    const singular = String(rule?.collectionRatingKey || '').trim();
    if (singular && !seen.has(singular)) keys.push(singular);
    return keys;
};

const ruleLibraries = (rule) => {
    const libs = Array.isArray(rule?.libraries) ? rule.libraries : [];
    const out = libs.map((l) => String(l || '').trim()).filter(Boolean);
    const singular = String(rule?.library || '').trim();
    if (singular && !out.includes(singular)) out.unshift(singular);
    return out;
};

const titleMatches = (rule, title, library) => {
    const wantTitle = String(title || '').trim().toLowerCase();
    if (!wantTitle) return false;
    const titles = [];
    if (rule?.collectionTitles && typeof rule.collectionTitles === 'object') {
        for (const v of Object.values(rule.collectionTitles)) {
            const t = String(v || '').trim();
            if (t) titles.push(t.toLowerCase());
        }
    }
    const singular = String(rule?.collectionTitle || '').trim();
    if (singular) titles.push(singular.toLowerCase());
    if (!titles.includes(wantTitle)) return false;
    const libs = ruleLibraries(rule).map((l) => l.toLowerCase());
    const wantLib = String(library || '').trim().toLowerCase();
    if (!wantLib || !libs.length) return true;
    return libs.includes(wantLib);
};

export const findOverlayRulesForCollection = (config, { ratingKey, title, library } = {}) => {
    if (!config || config.customCollectionOverlaysEnabled !== true) return [];
    const rules = Array.isArray(config.customCollectionOverlays) ? config.customCollectionOverlays : [];
    const key = String(ratingKey || '').trim();
    return rules.filter((rule) => {
        if (!rule || typeof rule !== 'object') return false;
        const keys = ruleCollectionKeys(rule);
        if (key && keys.includes(key)) return true;
        return titleMatches(rule, title, library);
    });
};

export const wireCollexionsOverlaysHook = ({ startCommand, loadPortalConfig } = {}) => {
    if (typeof startCommand === 'function') startCommandRef = startCommand;
    if (typeof loadPortalConfig === 'function') loadPortalConfigRef = loadPortalConfig;
};

const scheduleFlush = (delayMs = DEBOUNCE_MS) => {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(() => {
        flushTimer = null;
        void flushCollexionsOverlayQueue();
    }, Math.max(1_000, Number(delayMs) || DEBOUNCE_MS));
};

export const enqueueCollexionsCollectionUpdate = (payload = {}) => {
    // ColleXions may still POST for bookkeeping; ignore no-op membership syncs.
    if (Object.prototype.hasOwnProperty.call(payload, 'changed') && payload.changed === false) {
        return { ok: true, skipped: true, reason: 'membership_unchanged' };
    }
    const added = Number(payload.added);
    const removed = Number(payload.removed);
    if (
        Number.isFinite(added)
        && Number.isFinite(removed)
        && added === 0
        && removed === 0
        && payload.changed !== true
    ) {
        return { ok: true, skipped: true, reason: 'membership_unchanged' };
    }
    const ratingKey = String(payload.ratingKey || payload.collectionRatingKey || '').trim();
    const title = String(payload.title || '').trim();
    const library = String(payload.library || '').trim();
    if (!ratingKey && !title) {
        return { ok: false, skipped: true, reason: 'missing_identity' };
    }
    const mapKey = ratingKey || `${library}::${title}`.toLowerCase();
    pending.set(mapKey, { ratingKey, title, library });
    scheduleFlush(DEBOUNCE_MS);
    return { ok: true, queued: true, pending: pending.size };
};

export const flushCollexionsOverlayQueue = async () => {
    if (!pending.size) return { ok: true, skipped: true, reason: 'empty' };
    if (typeof startCommandRef !== 'function') {
        return { ok: false, skipped: true, reason: 'not_wired' };
    }

    if (runState?.running || overlaysRunLockAlive()) {
        if (!retryTimer) {
            retryTimer = setTimeout(() => {
                retryTimer = null;
                void flushCollexionsOverlayQueue();
            }, RETRY_BUSY_MS);
        }
        pushActivity('ColleXions overlay restamp waiting — Overlays already running', 'warn');
        return { ok: true, deferred: true, reason: 'busy' };
    }

    const batch = [...pending.values()];
    pending.clear();

    let portal = {};
    try {
        portal = typeof loadPortalConfigRef === 'function' ? await loadPortalConfigRef() : {};
    } catch {
        portal = {};
    }
    if (portal?.overlaysEnabled === false) {
        return { ok: true, skipped: true, reason: 'overlays_disabled' };
    }

    const config = await loadOverlaysConfig();
    if (config.enabled === false) {
        return { ok: true, skipped: true, reason: 'module_disabled' };
    }
    if (config.restampOnCollexionsUpdate !== true) {
        return { ok: true, skipped: true, reason: 'toggle_off' };
    }
    if (config.customCollectionOverlaysEnabled !== true) {
        return { ok: true, skipped: true, reason: 'collections_disabled' };
    }

    const matchedKeys = new Set();
    const matchedNames = [];
    let rulesMutated = false;
    const nextRules = Array.isArray(config.customCollectionOverlays)
        ? config.customCollectionOverlays.map((rule) => ({ ...rule }))
        : [];

    for (const item of batch) {
        const rules = findOverlayRulesForCollection(config, item);
        if (!rules.length) continue;
        const liveKey = String(item.ratingKey || '').trim();
        if (liveKey) matchedKeys.add(liveKey);
        for (const rule of rules) {
            const keys = ruleCollectionKeys(rule);
            for (const rk of keys) matchedKeys.add(rk);
            if (liveKey && !keys.includes(liveKey)) {
                const idx = nextRules.findIndex((row) => String(row?.id || '') === String(rule.id || ''));
                if (idx >= 0) {
                    const titles = { ...(nextRules[idx].collectionTitles || {}) };
                    const stale = keys[0];
                    if (stale && titles[stale] && !titles[liveKey]) titles[liveKey] = titles[stale];
                    if (item.title) titles[liveKey] = item.title;
                    delete titles[stale];
                    nextRules[idx] = {
                        ...nextRules[idx],
                        collectionRatingKey: liveKey,
                        collectionRatingKeys: [liveKey],
                        collectionTitle: item.title || nextRules[idx].collectionTitle || '',
                        collectionTitles: titles,
                    };
                    rulesMutated = true;
                    matchedKeys.delete(stale);
                    matchedKeys.add(liveKey);
                    pushActivity(
                        `Updated overlay rule '${rule.name || rule.id}' to live collection key ${liveKey}`,
                        'warn',
                    );
                }
            }
            const label = String(rule.name || item.title || rule.collectionRatingKey || '').trim();
            if (label && !matchedNames.includes(label)) matchedNames.push(label);
        }
    }

    if (rulesMutated) {
        try {
            await saveOverlaysConfig({ customCollectionOverlays: nextRules });
            config.customCollectionOverlays = nextRules;
        } catch (error) {
            pushActivity(`Could not remap overlay collection keys: ${error.message || error}`, 'error');
        }
    }

    if (!matchedKeys.size) {
        return { ok: true, skipped: true, reason: 'no_matching_rules' };
    }

    const keys = [...matchedKeys];
    const label = matchedNames.slice(0, 3).join(', ')
        + (matchedNames.length > 3 ? ` (+${matchedNames.length - 3})` : '');
    pushActivity(
        `ColleXions updated linked collection${matchedNames.length === 1 ? '' : 's'}`
        + (label ? ` (${label})` : '')
        + ' — restamping those overlays…',
        'warn',
    );

    try {
        await startCommandRef('run-collections', {
            previewMode: false,
            runBundle: 'collections',
            kometaScope: 'collections',
            onlyCollectionRatingKeys: keys,
            lastRunKey: 'kometaLastRunAt',
        });
        return { ok: true, started: true, keys, rules: matchedNames };
    } catch (error) {
        const msg = error?.message || String(error);
        if (/already in progress/i.test(msg)) {
            for (const item of batch) {
                const mapKey = String(item.ratingKey || '').trim()
                    || `${item.library || ''}::${item.title || ''}`.toLowerCase();
                pending.set(mapKey, item);
            }
            scheduleFlush(RETRY_BUSY_MS);
            return { ok: true, deferred: true, reason: 'busy' };
        }
        pushActivity(`ColleXions overlay restamp failed: ${msg}`, 'error');
        return { ok: false, error: msg };
    }
};
