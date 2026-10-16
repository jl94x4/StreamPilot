/**
 * Phase 1b: poll Seerr for mediaStatus → AVAILABLE and fan out email/in-app.
 * Seerr stores no portal meta, so we keep a tiny local snapshot for edge detection.
 */

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { SEERR_AVAILABLE_NOTIFY_PATH } from '../data-paths.js';
import { isRequestAvailableNotifyEnabled, notifyRequestBecameAvailable } from './requestAvailable.js';
import { resolvePortalUserFromSeerr } from '../portal-request/seerrHistoryImport.js';
import { firstRealMediaTitle, hydrateSeerrNotifyDto } from '../seerr-user-session.js';
import { shouldSkipUnchangedSeerrNotifyList } from './seerrNotifyPollGuard.js';

const SEERR_MEDIA_AVAILABLE = 5;
const REQUEST_APPROVED = 2;
const PAGE_TAKE = 50;
const MAX_PAGES = 8; // up to 400 recent requests

const emptyState = () => ({
    version: 1,
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

export const loadSeerrAvailableNotifyState = async () => {
    try {
        const raw = await fs.readFile(SEERR_AVAILABLE_NOTIFY_PATH, 'utf8');
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
    await writeJsonAtomic(SEERR_AVAILABLE_NOTIFY_PATH, state);
    return state;
});

const collectSeerrDtos = async (listRequests, config) => {
    const seen = new Map();
    // Prefer in-flight / approved + recently available buckets.
    for (const filter of ['processing', 'approved', 'available']) {
        for (let page = 0; page < MAX_PAGES; page += 1) {
            const skip = page * PAGE_TAKE;
            const payload = await listRequests(config, {
                filter,
                take: PAGE_TAKE,
                skip,
                sort: 'modified',
            });
            const results = Array.isArray(payload?.results) ? payload.results : [];
            for (const dto of results) {
                const id = String(dto?.id ?? '');
                if (!id) continue;
                seen.set(id, dto);
            }
            if (results.length < PAGE_TAKE) break;
        }
    }
    return [...seen.values()];
};

const toSyntheticRecord = (dto, portalUser) => {
    const mediaType = dto?.type === 'tv' ? 'tv' : 'movie';
    return {
        id: `seerr:${dto.id}`,
        userId: portalUser?.id || null,
        title: firstRealMediaTitle(dto.title, dto.name) || dto.title || 'Your request',
        year: dto.year || null,
        mediaType,
        tmdbId: dto.tmdbId || null,
        meta: {
            mediaStatus: SEERR_MEDIA_AVAILABLE,
            requestedByEmail: dto?.requestedBy?.email || null,
            requestedByName: dto?.requestedBy?.displayName || null,
            seerrRequestId: dto.id,
        },
    };
};

/**
 * @returns {Promise<{ scanned: number, checked: number, notified: number, stamped: number, skipped: number, errors: number }>}
 */
export const syncSeerrRequestAvailableNotifications = async ({
    config,
    listRequests,
    getRequestCounts,
    getRequest,
    loadUsers,
    sendEmail,
    hasEmailBeenSent,
    logEmailSent,
    resolvePublicBaseUrl,
    log = () => {},
} = {}) => {
    const summary = {
        scanned: 0,
        checked: 0,
        notified: 0,
        stamped: 0,
        skipped: 0,
        errors: 0,
    };

    if (!isRequestAvailableNotifyEnabled(config)) {
        return { ...summary, skipped: 1, reason: 'disabled' };
    }
    if (typeof listRequests !== 'function') {
        throw new Error('listRequests is required');
    }

    const countGuard = await shouldSkipUnchangedSeerrNotifyList('available', getRequestCounts, config);
    if (countGuard.skip) {
        return { ...summary, skipped: 1, reason: 'unchanged' };
    }

    const users = typeof loadUsers === 'function' ? await loadUsers() : [];
    const portalUsers = Array.isArray(users) ? users : [];
    const state = await loadSeerrAvailableNotifyState();
    const byId = { ...(state.byRequestId || {}) };

    let dtos = [];
    try {
        dtos = await collectSeerrDtos(listRequests, config);
    } catch (error) {
        summary.errors += 1;
        if (typeof log === 'function') {
            log(`[SeerrAvailableNotify] list failed: ${error?.message || error}`);
        }
        return summary;
    }

    summary.scanned = dtos.length;

    for (const dto of dtos) {
        const id = String(dto?.id ?? '');
        if (!id) continue;
        // Approved requests only (status 2).
        if (Number(dto.status) !== REQUEST_APPROVED) {
            summary.skipped += 1;
            continue;
        }

        summary.checked += 1;
        const nextStatus = Number(dto.mediaStatus);
        const downloading = !!dto.isDownloading;
        const prev = byId[id] || null;
        const prevStatus = prev && prev.mediaStatus != null ? Number(prev.mediaStatus) : null;
        const fullyAvailable = nextStatus === SEERR_MEDIA_AVAILABLE && !downloading;

        // Always keep a rolling snapshot of media status.
        const nextEntry = {
            mediaStatus: Number.isFinite(nextStatus) ? nextStatus : null,
            isDownloading: downloading,
            title: dto.title || prev?.title || null,
            tmdbId: dto.tmdbId || prev?.tmdbId || null,
            mediaType: dto.type === 'tv' ? 'tv' : 'movie',
            updatedAt: new Date().toISOString(),
            notifiedAvailableAt: prev?.notifiedAvailableAt || null,
        };

        if (!fullyAvailable) {
            byId[id] = nextEntry;
            continue;
        }

        if (prev?.notifiedAvailableAt) {
            byId[id] = nextEntry;
            continue;
        }

        // Known transition from non-available → available.
        const knownTransition = prevStatus != null
            && Number.isFinite(prevStatus)
            && prevStatus !== SEERR_MEDIA_AVAILABLE;

        if (knownTransition) {
            const notifyDto = await hydrateSeerrNotifyDto(dto, getRequest, config);
            const seerrUser = {
                email: notifyDto?.requestedBy?.email || dto?.requestedBy?.email || null,
                username: notifyDto?.requestedBy?.displayName || dto?.requestedBy?.displayName || null,
                displayName: notifyDto?.requestedBy?.displayName || dto?.requestedBy?.displayName || null,
                id: notifyDto?.requestedBy?.id || dto?.requestedBy?.id || null,
            };
            const portalUser = resolvePortalUserFromSeerr(seerrUser, portalUsers);
            try {
                const result = await notifyRequestBecameAvailable({
                    config,
                    record: toSyntheticRecord(notifyDto, portalUser),
                    prevMediaStatus: prevStatus,
                    loadUsers: async () => portalUsers,
                    sendEmail,
                    hasEmailBeenSent,
                    logEmailSent,
                    resolvePublicBaseUrl,
                    log,
                });
                if (result?.notified) summary.notified += 1;
            } catch (error) {
                summary.errors += 1;
                if (typeof log === 'function') {
                    log(`[SeerrAvailableNotify] notify failed for ${id}: ${error?.message || error}`);
                }
            }
            nextEntry.notifiedAvailableAt = new Date().toISOString();
            summary.stamped += 1;
        } else {
            // First sight (already available) or unknown prior — stamp without notifying.
            nextEntry.notifiedAvailableAt = new Date().toISOString();
            summary.stamped += 1;
        }

        byId[id] = nextEntry;
    }

    // Cap store size by oldest updatedAt.
    const entries = Object.entries(byId);
    if (entries.length > 2500) {
        entries.sort((a, b) => String(a[1]?.updatedAt || '').localeCompare(String(b[1]?.updatedAt || '')));
        const keep = entries.slice(-2000);
        state.byRequestId = Object.fromEntries(keep);
    } else {
        state.byRequestId = byId;
    }

    await saveState(state);
    if (typeof countGuard.markListed === 'function') countGuard.markListed();
    return summary;
};

export default syncSeerrRequestAvailableNotifications;
