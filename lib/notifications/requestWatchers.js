/**
 * Title-level "Notify me" watchers for requests filed by someone else.
 * No extra *arr grab and no quota — followers reuse available/season/episode alerts.
 */

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { REQUEST_WATCHERS_PATH } from '../data-paths.js';

const PORTAL_STATUS_PENDING = 1;
const PORTAL_STATUS_APPROVED = 2;
const PORTAL_STATUS_DECLINED = 3;
const PORTAL_STATUS_FAILED = 4;
const MEDIA_AVAILABLE = 5;
const MEDIA_BLACKLISTED = 6;

const emptyState = () => ({
    version: 1,
    updatedAt: null,
    watchers: {},
});

let writeChain = Promise.resolve();

const serialize = (operation) => {
    const current = writeChain.then(operation, operation);
    writeChain = current.catch(() => {});
    return current;
};

const writeJsonAtomic = async (filePath, value) => {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    try {
        await fs.rename(temporary, filePath);
    } finally {
        await fs.rm(temporary, { force: true }).catch(() => {});
    }
};

export const watcherTitleKey = ({ mediaType, tmdbId, mediaId, mbid, albumMbid } = {}) => {
    const type = String(mediaType || '').toLowerCase() === 'tv'
        ? 'tv'
        : (String(mediaType || '').toLowerCase() === 'music' ? 'music' : 'movie');
    if (type === 'music') {
        const artist = String(mbid || mediaId || '').trim();
        const album = String(albumMbid || '').trim();
        if (!artist) return '';
        return album ? `music:${artist}:album:${album}` : `music:${artist}`;
    }
    const id = Number(tmdbId != null ? tmdbId : mediaId);
    if (!Number.isFinite(id) || id <= 0) return '';
    return `${type}:${id}`;
};

export const normalizeWatcherIds = (value) => {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.map((id) => String(id || '').trim()).filter(Boolean))];
};

export const isActivePortalRequest = (record = {}) => {
    const status = Number(record?.status);
    if (status === PORTAL_STATUS_DECLINED || status === PORTAL_STATUS_FAILED) return false;
    if (Number(record?.meta?.mediaStatus) === MEDIA_AVAILABLE) return false;
    return status === PORTAL_STATUS_PENDING || status === PORTAL_STATUS_APPROVED;
};

const looksLikeEmail = (value) => String(value || '').includes('@');

const pickSafeRequesterName = (...candidates) => {
    for (const candidate of candidates) {
        const name = String(candidate || '').trim();
        if (name && !looksLikeEmail(name)) return name;
    }
    return '';
};

const requesterUserId = (row = {}) => String(
    row?.userId ?? row?.requestedBy?.id ?? '',
).trim();

/**
 * Member-safe summary of who already requested a title.
 * Display names only — never emails.
 */
export const summarizeOtherRequesters = (records = [], viewerId = '', users = []) => {
    const viewer = String(viewerId || '').trim();
    const usersById = new Map();
    for (const user of Array.isArray(users) ? users : []) {
        const id = String(user?.id || '').trim();
        const plexId = String(user?.plexId || '').trim();
        if (id) usersById.set(id, user);
        if (plexId) usersById.set(plexId, user);
    }
    const viewerKeys = new Set();
    if (viewer) {
        viewerKeys.add(viewer);
        const viewerUser = usersById.get(viewer);
        if (viewerUser?.id) viewerKeys.add(String(viewerUser.id).trim());
        if (viewerUser?.plexId) viewerKeys.add(String(viewerUser.plexId).trim());
    }

    const names = [];
    const seen = new Set();
    for (const row of Array.isArray(records) ? records : []) {
        if (!isActivePortalRequest(row)) continue;
        const uid = requesterUserId(row);
        if (viewerKeys.size && uid && viewerKeys.has(uid)) continue;
        const key = (uid || JSON.stringify(row?.requestedBy || row?.meta || {})).toLowerCase();
        if (key && seen.has(key)) continue;
        if (key) seen.add(key);
        const user = uid ? usersById.get(uid) : null;
        const name = pickSafeRequesterName(
            row?.displayName,
            row?.requestedBy?.displayName,
            row?.requestedBy?.username,
            row?.meta?.requestedByName,
            user?.displayName,
            user?.username,
        );
        names.push(name);
    }

    const named = names.find(Boolean) || null;
    return {
        requestedByName: named,
        requestedByCount: names.length,
    };
};

export const notifyEligibility = ({
    viewerId,
    records = [],
    mediaStatus = null,
    isBlacklisted = false,
    isWatching = false,
} = {}) => {
    const watching = !!isWatching;
    if (isBlacklisted || Number(mediaStatus) === MEDIA_BLACKLISTED) {
        return { canNotify: false, isWatching: false };
    }
    if (Number(mediaStatus) === MEDIA_AVAILABLE) {
        return { canNotify: false, isWatching: watching };
    }
    const viewer = String(viewerId || '').trim();
    const active = (Array.isArray(records) ? records : []).filter(isActivePortalRequest);
    const ownActive = viewer ? active.some((row) => String(row?.userId) === viewer) : false;
    const othersActive = active.some((row) => !viewer || String(row?.userId) !== viewer);
    if (ownActive) return { canNotify: false, isWatching: false };
    return { canNotify: othersActive, isWatching: watching && othersActive };
};

const loadState = async (filePath) => {
    try {
        const raw = await fs.readFile(filePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return emptyState();
        if (!parsed.watchers || typeof parsed.watchers !== 'object') parsed.watchers = {};
        return parsed;
    } catch {
        return emptyState();
    }
};

export const createRequestWatcherStore = (filePath = REQUEST_WATCHERS_PATH) => {
    const listWatcherIds = async (titleKey) => {
        const key = String(titleKey || '').trim();
        if (!key) return [];
        const state = await loadState(filePath);
        return normalizeWatcherIds(state.watchers[key]);
    };

    const isWatching = async (titleKey, userId) => {
        const uid = String(userId || '').trim();
        if (!uid) return false;
        const ids = await listWatcherIds(titleKey);
        return ids.includes(uid);
    };

    const setWatching = async (titleKey, userId, subscribe = true) => {
        const key = String(titleKey || '').trim();
        const uid = String(userId || '').trim();
        if (!key || !uid) return { ok: false, isWatching: false, ids: [] };
        return serialize(async () => {
            const state = await loadState(filePath);
            const current = new Set(normalizeWatcherIds(state.watchers[key]));
            if (subscribe) current.add(uid);
            else current.delete(uid);
            const ids = [...current];
            if (ids.length) state.watchers[key] = ids;
            else delete state.watchers[key];
            state.updatedAt = new Date().toISOString();
            await writeJsonAtomic(filePath, state);
            return { ok: true, isWatching: ids.includes(uid), ids };
        });
    };

    return { listWatcherIds, isWatching, setWatching };
};

const defaultStore = createRequestWatcherStore();

export const listWatcherIds = defaultStore.listWatcherIds;
export const isWatchingTitle = defaultStore.isWatching;
export const setWatchingTitle = defaultStore.setWatching;

export const resolveWatcherUsers = async ({ record, users } = {}) => {
    const list = Array.isArray(users) ? users : [];
    const requesterId = String(record?.userId || '').trim();
    const key = watcherTitleKey({
        mediaType: record?.mediaType,
        tmdbId: record?.tmdbId,
        mbid: record?.mbid,
        albumMbid: record?.albumMbid,
    });
    const ids = new Set(await listWatcherIds(key));
    for (const id of normalizeWatcherIds(record?.meta?.notifyUserIds)) ids.add(id);
    if (requesterId) ids.delete(requesterId);
    if (!ids.size) return [];
    return list.filter((user) => ids.has(String(user?.id || '').trim()));
};

export default {
    watcherTitleKey,
    notifyEligibility,
    summarizeOtherRequesters,
    isActivePortalRequest,
    listWatcherIds,
    isWatchingTitle,
    setWatchingTitle,
    resolveWatcherUsers,
};
