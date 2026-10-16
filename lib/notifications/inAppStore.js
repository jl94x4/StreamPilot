import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { NOTIFICATIONS_PATH } from '../data-paths.js';
import { isAdminOnlyInAppNotificationItem } from './inAppAdminTypes.js';
import { redactInAppNotificationItem, redactSensitiveText } from './sensitiveText.js';

const emptyState = () => ({
    version: 1,
    updatedAt: null,
    items: [],
});

let writeChain = Promise.resolve();
/** Optional fan-out after a notification is persisted (e.g. Web Push). */
let afterCreateHook = null;
const DEDUPE_WINDOW_MS = 10 * 60 * 1000;
const REPEAT_HISTORY_MAX = 50;

const posterSnapshot = (meta = {}) => {
    const posterUrl = normalizeText(meta.posterUrl);
    const posterPath = normalizeText(meta.posterPath);
    if (!posterUrl && !posterPath) return {};
    return {
        ...(posterUrl ? { posterUrl } : {}),
        ...(posterPath ? { posterPath } : {}),
    };
};

const repeatHistoryEntry = (body, createdAt, meta = {}) => {
    const entry = {
        body: String(body || '').trim(),
        createdAt: createdAt || new Date().toISOString(),
        ...posterSnapshot(meta),
    };
    return entry.body ? entry : null;
};

const normalizeRepeatHistory = (entries) => {
    if (!Array.isArray(entries)) return [];
    return entries
        .map((entry) => {
            if (!entry || typeof entry !== 'object') return null;
            return repeatHistoryEntry(entry.body, entry.createdAt, entry);
        })
        .filter(Boolean)
        .slice(0, REPEAT_HISTORY_MAX);
};

const buildRepeatHistoryForMerge = (existing, incoming, nowIso) => {
    const mergedMeta = {
        ...(existing?.meta && typeof existing.meta === 'object' ? existing.meta : {}),
        ...(incoming.meta && typeof incoming.meta === 'object' ? incoming.meta : {}),
    };
    const history = normalizeRepeatHistory(mergedMeta.repeatHistory);
    if (!history.length && existing?.body) {
        const prior = repeatHistoryEntry(existing.body, existing.createdAt, existing.meta);
        if (prior) history.push(prior);
    }
    const latest = repeatHistoryEntry(incoming.body, nowIso, incoming.meta);
    if (latest) history.unshift(latest);
    return history.slice(0, REPEAT_HISTORY_MAX);
};

export const setInAppNotificationCreatedHook = (fn) => {
    afterCreateHook = typeof fn === 'function' ? fn : null;
};

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

const normalizeText = (value) => String(value || '').trim();

export const asNotificationUserIdSet = (userId) => {
    const values = Array.isArray(userId) ? userId : [userId];
    return new Set(values.map((value) => String(value || '').trim()).filter(Boolean));
};

const dedupeMetaKey = (meta = {}) => ([
    normalizeText(meta.requestId),
    normalizeText(meta.mediaType),
    normalizeText(meta.tmdbId),
    normalizeText(meta.mbid),
    normalizeText(meta.albumMbid),
    normalizeText(meta.serviceId),
].join('|'));

const notificationDedupeKey = ({ userId, type, title, href, meta }) => ([
    normalizeText(userId),
    normalizeText(type).toLowerCase(),
    normalizeText(title).toLowerCase(),
    normalizeText(href),
    dedupeMetaKey(meta),
].join('::'));

const parseIsoMs = (value) => {
    const ms = Date.parse(String(value || ''));
    return Number.isFinite(ms) ? ms : 0;
};

export const loadNotificationsState = async () => {
    try {
        const raw = await fs.readFile(NOTIFICATIONS_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return emptyState();
        if (!Array.isArray(parsed.items)) parsed.items = [];
        parsed.items = parsed.items.map(redactInAppNotificationItem);
        return parsed;
    } catch {
        return emptyState();
    }
};

export const createInAppNotification = async ({
    userId,
    type = 'request_available',
    title,
    body = '',
    href = '',
    meta = {},
} = {}) => {
    if (!userId) return null;
    const item = await serialize(async () => {
        const state = await loadNotificationsState();
        const nowIso = new Date().toISOString();
        const payloadMeta = meta && typeof meta === 'object' ? meta : {};
        const dedupeEnabled = payloadMeta?.dedupe !== false && payloadMeta?.forceUnique !== true;
        const incoming = {
            userId: String(userId),
            type: String(type || 'request_available'),
            title: redactSensitiveText(title || 'Notification'),
            body: redactSensitiveText(body || ''),
            href: String(href || ''),
            meta: payloadMeta,
        };
        const incomingKey = notificationDedupeKey(incoming);

        if (dedupeEnabled) {
            const hitIndex = state.items.findIndex((existing) => {
                if (!existing || existing.readAt) return false;
                const existingKey = notificationDedupeKey(existing);
                if (existingKey !== incomingKey) return false;
                const age = parseIsoMs(nowIso) - parseIsoMs(existing.createdAt);
                return age >= 0 && age <= DEDUPE_WINDOW_MS;
            });
            if (hitIndex >= 0) {
                const existing = state.items[hitIndex];
                const repeatHistory = buildRepeatHistoryForMerge(existing, incoming, nowIso);
                const mergedMeta = {
                    ...(existing?.meta && typeof existing.meta === 'object' ? existing.meta : {}),
                    ...payloadMeta,
                    repeatHistory,
                    repeatCount: repeatHistory.length || Math.max(1, Number(existing?.meta?.repeatCount || 1)) + 1,
                    lastRepeatAt: nowIso,
                };
                const merged = {
                    ...existing,
                    title: incoming.title || existing.title,
                    body: incoming.body || existing.body,
                    href: incoming.href || existing.href,
                    meta: mergedMeta,
                    createdAt: nowIso,
                };
                state.items.splice(hitIndex, 1);
                state.items.unshift(merged);
                state.updatedAt = nowIso;
                await writeJsonAtomic(NOTIFICATIONS_PATH, state);
                return merged;
            }
        }

        const created = {
            id: crypto.randomUUID(),
            userId: incoming.userId,
            type: incoming.type,
            title: incoming.title,
            body: incoming.body,
            href: incoming.href,
            meta: incoming.meta,
            readAt: null,
            createdAt: nowIso,
        };
        state.items.unshift(created);
        if (state.items.length > 2000) state.items = state.items.slice(0, 2000);
        state.updatedAt = created.createdAt;
        await writeJsonAtomic(NOTIFICATIONS_PATH, state);
        return created;
    });
    if (item && afterCreateHook) {
        try {
            await afterCreateHook(item);
        } catch {
            // never fail notification create on push fan-out
        }
    }
    return item;
};

const notificationsVisibleToViewer = (items, { includeAdminTypes = false } = {}) => {
    if (includeAdminTypes) return items;
    return items.filter((item) => !isAdminOnlyInAppNotificationItem(item));
};

export const listInAppNotificationsForUser = async (userId, { limit = 30, unreadOnly = false, type = '', includeAdminTypes = false } = {}) => {
    const state = await loadNotificationsState();
    const userIds = asNotificationUserIdSet(userId);
    let items = notificationsVisibleToViewer(
        state.items.filter((item) => userIds.has(String(item.userId || ''))),
        { includeAdminTypes },
    );
    if (unreadOnly) items = items.filter((item) => !item.readAt);
    const typeFilter = String(type || '').trim();
    if (typeFilter) items = items.filter((item) => String(item?.type || '') === typeFilter);
    return items.slice(0, Math.max(1, Math.min(100, Number(limit) || 30)));
};

export const countUnreadInAppNotifications = async (userId, options = {}) => {
    const summary = await summarizeInAppNotificationsForUser(userId, options);
    return summary.unread;
};

/** Per-user totals for the bell and Home ops snapshot. */
export const summarizeInAppNotificationsForUser = async (userId, { includeAdminTypes = false } = {}) => {
    const state = await loadNotificationsState();
    const userIds = asNotificationUserIdSet(userId);
    const mine = notificationsVisibleToViewer(
        state.items.filter((item) => userIds.has(String(item.userId || ''))),
        { includeAdminTypes },
    );
    return {
        total: mine.length,
        unread: mine.filter((item) => !item.readAt).length,
    };
};

/** Admin overview of the shared in-app notification store. */
export const getInAppNotificationsAdminSummary = async ({ limit = 40 } = {}) => {
    const state = await loadNotificationsState();
    const items = Array.isArray(state.items) ? state.items : [];
    const unread = items.filter((item) => !item.readAt).length;
    const byType = {};
    for (const item of items) {
        const key = String(item?.type || 'unknown');
        byType[key] = (byType[key] || 0) + 1;
    }
    const capped = Math.max(1, Math.min(200, Number(limit) || 40));
    return {
        total: items.length,
        unread,
        updatedAt: state.updatedAt || null,
        byType,
        recent: items.slice(0, capped),
    };
};

export const markInAppNotificationsRead = async (userId, ids = null) => {
    return serialize(async () => {
        const state = await loadNotificationsState();
        const userIds = asNotificationUserIdSet(userId);
        const idSet = Array.isArray(ids) && ids.length
            ? new Set(ids.map(String))
            : null;
        const now = new Date().toISOString();
        let changed = 0;
        for (const item of state.items) {
            if (!userIds.has(String(item.userId || '')) || item.readAt) continue;
            if (idSet && !idSet.has(String(item.id))) continue;
            item.readAt = now;
            changed += 1;
        }
        if (changed) {
            state.updatedAt = now;
            await writeJsonAtomic(NOTIFICATIONS_PATH, state);
        }
        return { changed };
    });
};

/** Permanently remove in-app notifications for a user (all, or specific ids). */
export const clearInAppNotificationsForUser = async (userId, ids = null) => {
    return serialize(async () => {
        const state = await loadNotificationsState();
        const userIds = asNotificationUserIdSet(userId);
        const before = state.items.length;
        const idSet = Array.isArray(ids) && ids.length
            ? new Set(ids.map(String))
            : null;
        state.items = state.items.filter((item) => {
            if (!userIds.has(String(item.userId || ''))) return true;
            if (idSet) return !idSet.has(String(item.id));
            return false;
        });
        const removed = before - state.items.length;
        if (removed) {
            state.updatedAt = new Date().toISOString();
            await writeJsonAtomic(NOTIFICATIONS_PATH, state);
        }
        return { removed };
    });
};
