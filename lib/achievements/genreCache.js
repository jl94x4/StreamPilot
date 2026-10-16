/**
 * Persistent ratingKey → genre tags cache for achievements enrichment.
 */

import fs from 'fs/promises';
import { ACHIEVEMENTS_GENRE_CACHE_PATH } from '../data-paths.js';

const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days for real tags
const EMPTY_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours — never lock in failed lookups
const LIBRARY_WARM_TTL_MS = 12 * 60 * 60 * 1000;
let memory = null; // { updatedAt, libraryWarmedAt, entries }
let writeTimer = null;

const empty = () => ({ updatedAt: null, libraryWarmedAt: null, entries: {} });

export const loadGenreCache = async () => {
    if (memory) return memory;
    try {
        const raw = await fs.readFile(ACHIEVEMENTS_GENRE_CACHE_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        memory = {
            updatedAt: parsed?.updatedAt || null,
            libraryWarmedAt: parsed?.libraryWarmedAt || null,
            entries: parsed?.entries && typeof parsed.entries === 'object' ? parsed.entries : {},
        };
    } catch {
        memory = empty();
    }
    return memory;
};

const schedulePersist = () => {
    if (writeTimer) return;
    writeTimer = setTimeout(async () => {
        writeTimer = null;
        try {
            const state = memory || empty();
            state.updatedAt = new Date().toISOString();
            await fs.mkdir(ACHIEVEMENTS_GENRE_CACHE_PATH.replace(/[/\\][^/\\]+$/, ''), { recursive: true });
            await fs.writeFile(ACHIEVEMENTS_GENRE_CACHE_PATH, JSON.stringify(state), 'utf8');
        } catch {
            /* ignore disk errors */
        }
    }, 1500);
    if (typeof writeTimer.unref === 'function') writeTimer.unref();
};

export const getCachedGenreTags = async (ratingKey) => {
    const key = String(ratingKey || '').trim();
    if (!key) return null;
    const state = await loadGenreCache();
    const hit = state.entries[key];
    if (!hit || !Array.isArray(hit.tags)) return null;
    const age = Date.now() - (Number(hit.at) || 0);
    const ttl = hit.tags.length ? CACHE_TTL_MS : EMPTY_TTL_MS;
    if (age > ttl) return null;
    return hit.tags;
};

export const setCachedGenreTags = async (ratingKey, tags) => {
    const key = String(ratingKey || '').trim();
    if (!key) return;
    const state = await loadGenreCache();
    state.entries[key] = {
        tags: Array.isArray(tags) ? tags.map(String).filter(Boolean) : [],
        at: Date.now(),
    };
    schedulePersist();
};

export const ingestGenreTagMap = async (map) => {
    if (!map || typeof map !== 'object') return 0;
    const state = await loadGenreCache();
    const at = Date.now();
    let stored = 0;
    const entries = map instanceof Map ? map.entries() : Object.entries(map);
    for (const [rawKey, tags] of entries) {
        const key = String(rawKey || '').trim();
        const clean = Array.isArray(tags) ? tags.map(String).filter(Boolean) : [];
        if (!key || !clean.length) continue;
        state.entries[key] = { tags: clean, at };
        stored += 1;
    }
    if (stored) {
        state.libraryWarmedAt = at;
        schedulePersist();
    }
    return stored;
};

export const shouldWarmLibraryGenres = async (ttlMs = LIBRARY_WARM_TTL_MS) => {
    const state = await loadGenreCache();
    const at = Number(state.libraryWarmedAt) || 0;
    if (!at) return true;
    return Date.now() - at > Math.max(60_000, Number(ttlMs) || LIBRARY_WARM_TTL_MS);
};
