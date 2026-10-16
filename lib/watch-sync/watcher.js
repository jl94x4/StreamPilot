import { loadWatchSyncConfig, mergeWatchSyncConfig, saveWatchSyncConfig } from './config.js';
import { createPlexLibrary } from './plex.js';
import { planScrobbles, traktScrobbleBody } from './scrobble.js';
import { createTraktClient } from './trakt.js';

const POLL_MS = 15_000;

let started = false;
const liveState = {
    enabled: false,
    current: null,
    error: '',
};

export const getLiveWatchStatus = () => ({ ...liveState });

const asOne = (value) => (Array.isArray(value) ? value[0] || {} : (value || {}));

const sameAccount = (sessionUser, account) => {
    if (!account?.id && !account?.username) return false;
    if (account.id && sessionUser.id && String(sessionUser.id) === String(account.id)) return true;
    const left = String(sessionUser.title || '').trim().toLowerCase();
    const right = String(account.username || '').trim().toLowerCase();
    return !!left && left === right;
};

const mapSession = async (item, account, plex, conn, guidCache) => {
    const type = String(item?.type || '').toLowerCase();
    if (type !== 'movie' && type !== 'episode') return null;
    const user = asOne(item.User);
    if (!sameAccount({ id: user.id, title: user.title || user.name }, account)) return null;
    const player = String(asOne(item.Player).state || 'playing').toLowerCase();
    const duration = Number(item.duration) || 0;
    const viewOffset = Number(item.viewOffset) || 0;
    if (duration <= 0) return null;
    const ratingKey = String(item.ratingKey || '');
    const sessionId = String(
        (Array.isArray(item.Session) ? item.Session[0]?.id : item.Session?.id)
        || item.sessionKey
        || ratingKey,
    );
    const showKey = type === 'episode' ? String(item.grandparentRatingKey || '') : ratingKey;
    let ids = guidCache.get(showKey);
    if (!ids && showKey) {
        const metadata = await plex.metadata(conn.base_url, conn.token, showKey);
        ids = metadata?.ids || {};
        if (Object.keys(ids).length) guidCache.set(showKey, ids);
    }
    const session = {
        sessionKey: sessionId,
        type,
        title: type === 'episode'
            ? `${item.grandparentTitle || 'Show'} S${item.parentIndex}E${item.index}`
            : (item.title || 'Movie'),
        showTitle: type === 'episode' ? (item.grandparentTitle || '') : '',
        year: type === 'movie' ? item.year : null,
        progress: Math.min(100, Math.max(0, (viewOffset / duration) * 100)),
        player: player === 'paused' ? 'paused' : 'playing',
        season: type === 'episode' ? Number(item.parentIndex) : null,
        episode: type === 'episode' ? Number(item.index) : null,
        ids: type === 'movie' ? ids : null,
        showIds: type === 'episode' ? ids : null,
    };
    return traktScrobbleBody(session) ? session : null;
};

export const startLiveWatch = (deps = {}) => {
    if (started) return;
    started = true;
    const plex = createPlexLibrary({ fetchImpl: deps.fetchImpl || fetch });
    const trakt = createTraktClient({ fetchImpl: deps.fetchImpl || fetch, log: deps.log });
    let tracked = {};
    let account = null;
    const guidCache = new Map();

    const tick = async () => {
        try {
            const portal = typeof deps.loadPortalConfig === 'function' ? await deps.loadPortalConfig() : {};
            if (!portal?.watchSyncEnabled || String(portal.mediaServerType || 'plex').toLowerCase() !== 'plex') {
                liveState.enabled = false;
                liveState.current = null;
                return;
            }
            const config = await loadWatchSyncConfig();
            if (!config.liveWatchEnabled || !config.accessToken) {
                liveState.enabled = false;
                liveState.current = null;
                tracked = {};
                return;
            }
            liveState.enabled = true;
            const conn = await deps.resolvePlex();
            if (!account) account = await plex.account(conn.token);
            const rawSessions = await plex.sessions(conn.base_url, conn.token);
            const mine = [];
            for (const item of rawSessions) {
                const mapped = await mapSession(item, account, plex, conn, guidCache);
                if (mapped) mine.push(mapped);
            }
            const planned = planScrobbles(tracked, mine);
            if (!planned.actions.length) {
                tracked = planned.next;
                liveState.current = mine[0]
                    ? { title: mine[0].title, progress: mine[0].progress, action: mine[0].player }
                    : null;
                const stillRejected = mine.some((session) => tracked[session.sessionKey]?.rejected);
                if (!stillRejected) liveState.error = '';
                return;
            }
            const saveTokens = async (next) => {
                await saveWatchSyncConfig(mergeWatchSyncConfig(await loadWatchSyncConfig(), next));
            };
            let live = await trakt.refreshIfNeeded(config, saveTokens);
            for (const step of planned.actions) {
                const body = traktScrobbleBody(step.session);
                if (!body) continue;
                const rejectStep = (error) => {
                    const key = String(step.session.sessionKey || '');
                    const prior = planned.next[key] || step.session;
                    if (key) planned.next[key] = { ...prior, rejected: true };
                    liveState.error = `Couldn't scrobble ${step.session.title}. ${error.message}`;
                    if (typeof deps.log === 'function') deps.log(`[watch-sync] ${liveState.error}`);
                };
                try {
                    await trakt.scrobble(live, step.action, body);
                } catch (error) {
                    if (error.status === 422) {
                        rejectStep(error);
                        continue;
                    }
                    if (error.status !== 401) throw error;
                    try {
                        live = await trakt.refreshIfNeeded(config, saveTokens, { force: true });
                        await trakt.scrobble(live, step.action, body);
                    } catch (retryError) {
                        if (retryError.status === 422) {
                            rejectStep(retryError);
                            continue;
                        }
                        if (retryError.message?.includes('login expired') || retryError.status === 400 || retryError.status === 401) {
                            throw new Error(retryError.message?.includes('login expired')
                                ? retryError.message
                                : 'Trakt login expired. Disconnect and connect Trakt again.');
                        }
                        throw retryError;
                    }
                }
                liveState.current = {
                    title: step.session.title,
                    progress: step.session.progress,
                    action: step.action,
                };
                liveState.error = '';
                if (typeof deps.log === 'function') {
                    deps.log(`[watch-sync] Scrobble ${step.action}: ${step.session.title} (${step.session.progress}%)`);
                }
            }
            tracked = planned.next;
        } catch (error) {
            liveState.error = error?.message || String(error);
            if (typeof deps.log === 'function') deps.log(`[watch-sync] Live watch failed: ${liveState.error}`);
        }
    };

    setInterval(() => { void tick(); }, POLL_MS);
    setTimeout(() => { void tick(); }, 20_000);
};
