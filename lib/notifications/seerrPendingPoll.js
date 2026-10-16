/**
 * Poll Seerr for new pending requests submitted outside the portal (Seerr app / UI)
 * and fan out the same admin_pending alerts used for portal submissions.
 */

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { SEERR_PENDING_NOTIFY_PATH } from '../data-paths.js';
import { isPendingSeerrRequest } from '../request-app-service.js';
import { hydrateSeerrNotifyDto, mapSeerrRequestToLifecycleRecord } from '../seerr-user-session.js';
import { notifyAdminPendingRequest } from './requestLifecycle.js';
import { shouldSkipUnchangedSeerrNotifyList } from './seerrNotifyPollGuard.js';

const getStatePath = () => (
    process.env.CONFIG_DIR
        ? path.join(path.resolve(process.env.CONFIG_DIR), 'seerr-pending-notify.json')
        : SEERR_PENDING_NOTIFY_PATH
);

const PAGE_TAKE = 50;
const MAX_PAGES = 4;

const emptyState = () => ({
    version: 1,
    bootstrapped: false,
    updatedAt: null,
    byRequestId: {},
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

export const loadSeerrPendingNotifyState = async () => {
    try {
        const raw = await fs.readFile(getStatePath(), 'utf8');
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return emptyState();
        if (!parsed.byRequestId || typeof parsed.byRequestId !== 'object') parsed.byRequestId = {};
        return parsed;
    } catch {
        return emptyState();
    }
};

const saveState = async (state) => serialize(async () => {
    state.updatedAt = new Date().toISOString();
    await writeJsonAtomic(getStatePath(), state);
    return state;
});

export const normalizeSeerrRequestId = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    return raw.replace(/^seerr:/i, '');
};

/** Mark a Seerr request as already notified (portal API path or prior poll). */
export const stampSeerrPendingNotified = async (seerrRequestId, { source = 'portal' } = {}) => {
    const id = normalizeSeerrRequestId(seerrRequestId);
    if (!id) return false;
    const state = await loadSeerrPendingNotifyState();
    const byId = { ...(state.byRequestId || {}) };
    byId[id] = {
        ...(byId[id] || {}),
        notifiedAt: new Date().toISOString(),
        source,
        title: byId[id]?.title || null,
    };
    await saveState({ ...state, bootstrapped: true, byRequestId: byId });
    return true;
};

const collectPendingDtos = async (listRequests, config) => {
    const seen = new Map();
    for (let page = 0; page < MAX_PAGES; page += 1) {
        const skip = page * PAGE_TAKE;
        const payload = await listRequests(config, {
            filter: 'pending',
            take: PAGE_TAKE,
            skip,
            sort: 'added',
        });
        const results = Array.isArray(payload?.results) ? payload.results : [];
        for (const dto of results) {
            const id = String(dto?.id ?? '');
            if (!id || !isPendingSeerrRequest(dto)) continue;
            seen.set(id, dto);
        }
        if (results.length < PAGE_TAKE) break;
    }
    return [...seen.values()];
};

/**
 * @returns {Promise<{ scanned: number, checked: number, notified: number, seeded: number, skipped: number, errors: number, bootstrapped?: boolean }>}
 */
export const syncSeerrPendingRequestNotifications = async ({
    config,
    listRequests,
    getRequestCounts,
    getRequest,
    loadUsers,
    notifyAdminPending = notifyAdminPendingRequest,
    sendGotifyAlert,
    alertRuleEnabled,
    log = () => {},
} = {}) => {
    const summary = {
        scanned: 0,
        checked: 0,
        notified: 0,
        seeded: 0,
        skipped: 0,
        errors: 0,
    };

    if (typeof listRequests !== 'function') {
        throw new Error('listRequests is required');
    }

    const countGuard = await shouldSkipUnchangedSeerrNotifyList('pending', getRequestCounts, config);
    if (countGuard.skip) {
        return { ...summary, skipped: 1, reason: 'unchanged' };
    }

    const users = typeof loadUsers === 'function' ? await loadUsers() : [];
    const portalUsers = Array.isArray(users) ? users : [];
    const state = await loadSeerrPendingNotifyState();
    const byId = { ...(state.byRequestId || {}) };

    let dtos = [];
    try {
        dtos = await collectPendingDtos(listRequests, config);
    } catch (error) {
        summary.errors += 1;
        if (typeof log === 'function') {
            log(`[SeerrPendingNotify] list failed: ${error?.message || error}`);
        }
        return summary;
    }

    summary.scanned = dtos.length;
    const pendingIds = new Set(dtos.map((dto) => String(dto.id)));

    if (!state.bootstrapped) {
        for (const dto of dtos) {
            const id = String(dto?.id ?? '');
            if (!id) continue;
            byId[id] = {
                notifiedAt: byId[id]?.notifiedAt || new Date().toISOString(),
                source: byId[id]?.source || 'bootstrap',
                seededAt: new Date().toISOString(),
                title: dto.title || byId[id]?.title || null,
            };
            summary.seeded += 1;
        }
        await saveState({ ...state, bootstrapped: true, byRequestId: byId });
        if (typeof countGuard.markListed === 'function') countGuard.markListed();
        return { ...summary, bootstrapped: true };
    }

    for (const dto of dtos) {
        const id = String(dto?.id ?? '');
        if (!id) continue;
        summary.checked += 1;
        const prev = byId[id] || null;
        if (prev?.notifiedAt) {
            summary.skipped += 1;
            byId[id] = {
                ...prev,
                title: dto.title || prev.title || null,
                lastSeenAt: new Date().toISOString(),
            };
            continue;
        }

        const notifyDto = await hydrateSeerrNotifyDto(dto, getRequest, config);
        const record = mapSeerrRequestToLifecycleRecord(notifyDto, portalUsers);
        try {
            const sent = await notifyAdminPending({
                config,
                record,
                loadUsers: async () => portalUsers,
                sendGotifyAlert,
                alertRuleEnabled,
                log,
            });
            if (sent) {
                summary.notified += 1;
                byId[id] = {
                    notifiedAt: new Date().toISOString(),
                    source: 'poll',
                    title: record.title || dto.title || null,
                };
            } else {
                summary.skipped += 1;
            }
        } catch (error) {
            summary.errors += 1;
            if (typeof log === 'function') {
                log(`[SeerrPendingNotify] notify failed for ${id}: ${error?.message || error}`);
            }
        }
    }

    // Drop entries for requests that left the pending queue.
    for (const id of Object.keys(byId)) {
        if (!pendingIds.has(id)) {
            delete byId[id];
        }
    }

    await saveState({ ...state, bootstrapped: true, byRequestId: byId });
    const stillNeedsNotify = dtos.some((dto) => {
        const id = String(dto?.id ?? '');
        return id && !byId[id]?.notifiedAt;
    });
    if (!stillNeedsNotify && typeof countGuard.markListed === 'function') countGuard.markListed();
    return summary;
};
