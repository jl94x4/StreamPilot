import fs from 'fs/promises';
import path from 'path';
import { CONFIG_DIR } from '../data-paths.js';

export const WATCH_SYNC_CONFIG_PATH = path.join(CONFIG_DIR, 'watch-sync.json');
export const WATCH_SYNC_SNAPSHOT_PATH = path.join(CONFIG_DIR, 'watch-sync-snapshot.json');

export const DEFAULT_WATCH_SYNC_CONFIG = {
    clientId: '',
    clientSecret: '',
    accessToken: '',
    refreshToken: '',
    tokenExpiresAt: '',
    username: '',
    plexToTrakt: {
        watched: true,
        ratings: true,
        collection: true,
        watchlist: true,
    },
    traktToPlex: {
        watched: true,
        ratings: true,
        watchlist: true,
    },
    libraryIds: [],
    scheduleEnabled: false,
    intervalHours: 12,
    liveWatchEnabled: true,
    lastRunAt: '',
    lastRun: null,
};

const bool = (value, fallback) => (value === undefined ? fallback : !!value);

export const normalizeWatchSyncConfig = (raw) => {
    const src = raw && typeof raw === 'object' ? raw : {};
    const plex = src.plexToTrakt && typeof src.plexToTrakt === 'object' ? src.plexToTrakt : {};
    const trakt = src.traktToPlex && typeof src.traktToPlex === 'object' ? src.traktToPlex : {};
    const hours = Number(src.intervalHours);
    return {
        clientId: String(src.clientId || '').trim(),
        clientSecret: String(src.clientSecret || '').trim(),
        accessToken: String(src.accessToken || '').trim(),
        refreshToken: String(src.refreshToken || '').trim(),
        tokenExpiresAt: String(src.tokenExpiresAt || '').trim(),
        username: String(src.username || '').trim(),
        plexToTrakt: {
            watched: bool(plex.watched, true),
            ratings: bool(plex.ratings, true),
            collection: bool(plex.collection, true),
            watchlist: bool(plex.watchlist, true),
        },
        traktToPlex: {
            watched: bool(trakt.watched, true),
            ratings: bool(trakt.ratings, true),
            watchlist: bool(trakt.watchlist, true),
        },
        libraryIds: Array.isArray(src.libraryIds) ? src.libraryIds.map((id) => String(id)) : [],
        scheduleEnabled: !!src.scheduleEnabled,
        intervalHours: Number.isFinite(hours) ? Math.min(168, Math.max(1, Math.round(hours))) : 12,
        liveWatchEnabled: src.liveWatchEnabled === undefined ? true : !!src.liveWatchEnabled,
        lastRunAt: String(src.lastRunAt || '').trim(),
        lastRun: src.lastRun && typeof src.lastRun === 'object' ? src.lastRun : null,
    };
};

export const publicWatchSyncConfig = (config) => {
    const cfg = normalizeWatchSyncConfig(config);
    return {
        clientId: cfg.clientId,
        clientSecretSet: !!cfg.clientSecret,
        connected: !!cfg.accessToken,
        username: cfg.username,
        tokenExpiresAt: cfg.tokenExpiresAt,
        plexToTrakt: cfg.plexToTrakt,
        traktToPlex: cfg.traktToPlex,
        libraryIds: cfg.libraryIds,
        scheduleEnabled: cfg.scheduleEnabled,
        intervalHours: cfg.intervalHours,
        liveWatchEnabled: cfg.liveWatchEnabled,
        lastRunAt: cfg.lastRunAt,
        lastRun: cfg.lastRun,
    };
};

const readJson = async (filePath, fallback) => {
    try {
        const raw = await fs.readFile(filePath, 'utf8');
        return JSON.parse(raw);
    } catch (error) {
        if (error?.code === 'ENOENT') return fallback;
        throw error;
    }
};

const writeJson = async (filePath, value) => {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(value, null, 2));
    await fs.rename(tmp, filePath);
};

export const loadWatchSyncConfig = async () => (
    normalizeWatchSyncConfig(await readJson(WATCH_SYNC_CONFIG_PATH, {}))
);

export const saveWatchSyncConfig = async (config) => {
    const next = normalizeWatchSyncConfig(config);
    await writeJson(WATCH_SYNC_CONFIG_PATH, next);
    return next;
};

export const mergeWatchSyncConfig = (current, patch) => {
    const base = normalizeWatchSyncConfig(current);
    const incoming = patch && typeof patch === 'object' ? patch : {};
    const secret = String(incoming.clientSecret || '').trim();
    const keepSecret = !secret || secret === '********' || secret === '••••••••';
    return normalizeWatchSyncConfig({
        ...base,
        ...incoming,
        clientSecret: keepSecret ? base.clientSecret : secret,
        accessToken: incoming.accessToken === undefined ? base.accessToken : incoming.accessToken,
        refreshToken: incoming.refreshToken === undefined ? base.refreshToken : incoming.refreshToken,
        tokenExpiresAt: incoming.tokenExpiresAt === undefined ? base.tokenExpiresAt : incoming.tokenExpiresAt,
        username: incoming.username === undefined ? base.username : incoming.username,
        plexToTrakt: { ...base.plexToTrakt, ...(incoming.plexToTrakt || {}) },
        traktToPlex: { ...base.traktToPlex, ...(incoming.traktToPlex || {}) },
        libraryIds: incoming.libraryIds === undefined ? base.libraryIds : incoming.libraryIds,
        lastRun: incoming.lastRun === undefined ? base.lastRun : incoming.lastRun,
        lastRunAt: incoming.lastRunAt === undefined ? base.lastRunAt : incoming.lastRunAt,
    });
};

const objectMap = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});

export const loadWatchSyncSnapshot = async () => {
    const raw = await readJson(WATCH_SYNC_SNAPSHOT_PATH, {});
    return {
        updatedAt: String(raw?.updatedAt || ''),
        movies: objectMap(raw?.movies),
        episodes: objectMap(raw?.episodes),
        shows: objectMap(raw?.shows),
        watchlist: objectMap(raw?.watchlist),
    };
};

export const saveWatchSyncSnapshot = async (snapshot) => {
    const next = {
        updatedAt: new Date().toISOString(),
        movies: objectMap(snapshot?.movies),
        episodes: objectMap(snapshot?.episodes),
        shows: objectMap(snapshot?.shows),
        watchlist: objectMap(snapshot?.watchlist),
    };
    await writeJson(WATCH_SYNC_SNAPSHOT_PATH, next);
    return next;
};

export const clearWatchSyncSnapshot = async () => saveWatchSyncSnapshot({
    movies: {},
    episodes: {},
    shows: {},
    watchlist: {},
});

export const summarizeWatchSyncSnapshot = (snapshot) => {
    const movies = Object.keys(objectMap(snapshot?.movies)).length;
    const episodes = Object.keys(objectMap(snapshot?.episodes)).length;
    const shows = Object.keys(objectMap(snapshot?.shows)).length;
    const watchlist = Object.keys(objectMap(snapshot?.watchlist)).length;
    return {
        movies,
        episodes,
        shows,
        watchlist,
        entries: movies + episodes + shows,
        updatedAt: String(snapshot?.updatedAt || ''),
    };
};
