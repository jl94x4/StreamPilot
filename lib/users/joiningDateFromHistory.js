/**
 * Backfill portal `joiningDate` from earliest watch history on the media server.
 * Plex.tv does not expose a real "joined this share" timestamp; first play is the
 * best practical proxy.
 */

const norm = (v) => String(v || '').trim().toLowerCase();

export const earliestViewedAtUnix = (historyItems = []) => {
    let earliest = 0;
    for (const item of historyItems || []) {
        const viewedAt = Number(item?.viewedAt) || 0;
        if (viewedAt <= 0) continue;
        if (!earliest || viewedAt < earliest) earliest = viewedAt;
    }
    return earliest || null;
};

export const isoFromUnixSeconds = (unixSeconds) => {
    const n = Number(unixSeconds) || 0;
    if (n <= 0) return null;
    const ms = n > 1e12 ? n : n * 1000;
    const date = new Date(ms);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString();
};

/** Prefer earlier history stamp over portal create-time bulk stamps. */
export const shouldReplaceJoiningDate = (currentIso, candidateIso) => {
    if (!candidateIso) return false;
    const nextMs = Date.parse(candidateIso);
    if (!Number.isFinite(nextMs)) return false;
    if (!currentIso) return true;
    const prevMs = Date.parse(currentIso);
    if (!Number.isFinite(prevMs)) return true;
    return nextMs < prevMs;
};

export const resolvePlexHistoryAccountId = (user, plexAccounts = []) => {
    if (!user) return null;
    if (user.plexAccountId) return String(user.plexAccountId);

    const accounts = Array.isArray(plexAccounts) ? plexAccounts : [];
    if (accounts.length) {
        const byName = accounts.find((a) => norm(a.name) === norm(user.username));
        if (byName) return String(byName.id);
        if (user.email) {
            const byEmail = accounts.find((a) => (
                norm(a.name) === norm(user.email)
                || norm(a.email) === norm(user.email)
                || norm(a.name) === norm(String(user.email).split('@')[0])
            ));
            if (byEmail) return String(byEmail.id);
        }
        if (user.plexId) {
            const plexId = String(user.plexId);
            if (accounts.some((a) => String(a.id) === plexId)) return plexId;
        }
        if (user.id && /^\d+$/.test(String(user.id)) && accounts.some((a) => String(a.id) === String(user.id))) {
            return String(user.id);
        }
    }

    if (user.plexAccountId) return String(user.plexAccountId);
    if (user.plexId && /^\d+$/.test(String(user.plexId))) return String(user.plexId);
    if (user.id && /^\d+$/.test(String(user.id))) return String(user.id);
    return null;
};

let inFlight = null;
let lastResult = null;

export const getJoiningDateBackfillStatus = () => ({
    inFlight: !!inFlight,
    lastResult,
});

/**
 * Update users[] in place / returns next array + summary.
 */
export const backfillJoiningDatesFromHistory = async (deps = {}, opts = {}) => {
    if (inFlight) return inFlight;

    const {
        loadFile,
        saveUsers,
        CONFIG_PATH,
        USERS_PATH,
        getPlexConnectionUri,
        fetchPlexServerAccounts,
        fetchEarliestPlexPlayUnix,
        fetchEarliestTautulliPlayUnix,
        fetchEarliestJellyfinPlayUnix,
        log = () => {},
    } = deps;

    const run = (async () => {
        const config = await loadFile(CONFIG_PATH, {});
        const users = await loadFile(USERS_PATH, []);
        if (!Array.isArray(users) || !users.length) {
            lastResult = { ok: true, processed: 0, updated: 0, skipped: 0, missing: 0, reason: 'no-users' };
            return lastResult;
        }

        const mediaServerType = String(config.mediaServerType || 'plex').toLowerCase();
        const useTautulli = (
            config.watchHistorySource === 'tautulli'
            && config.tautulliUrl
            && config.tautulliApiKey
            && typeof fetchEarliestTautulliPlayUnix === 'function'
        );

        let plexUri = null;
        let plexAccounts = [];
        let plexNameById = {};
        if (mediaServerType === 'plex') {
            plexUri = typeof getPlexConnectionUri === 'function' ? await getPlexConnectionUri(config) : null;
            if (plexUri && typeof fetchPlexServerAccounts === 'function') {
                const acc = await fetchPlexServerAccounts(plexUri, config);
                plexAccounts = acc?.list || [];
                plexNameById = Object.fromEntries(
                    plexAccounts.filter((a) => a?.id != null && a?.name).map((a) => [String(a.id), String(a.name)]),
                );
            }
        }

        const summary = {
            ok: true,
            processed: 0,
            updated: 0,
            skipped: 0,
            missing: 0,
            errors: 0,
            source: useTautulli ? 'tautulli' : mediaServerType,
            forceOverwriteEarlier: opts.overwriteIfEarlier !== false,
        };

        const nextUsers = users.map((u) => ({ ...u }));
        const concurrency = mediaServerType === 'plex' && !useTautulli ? 4 : 2;
        let cursor = 0;

        const scoreOne = async (user) => {
            summary.processed += 1;
            let earliestUnix = null;

            try {
                if (['jellyfin', 'emby'].includes(mediaServerType)) {
                    const accountId = user.jellyfinId || user.embyId || user.id;
                    if (!accountId || typeof fetchEarliestJellyfinPlayUnix !== 'function') {
                        summary.missing += 1;
                        return;
                    }
                    earliestUnix = await fetchEarliestJellyfinPlayUnix(config, accountId);
                } else if (useTautulli) {
                    const accountId = resolvePlexHistoryAccountId(user, plexAccounts);
                    const plexAccountName = (accountId && plexNameById[String(accountId)])
                        || user.username
                        || null;
                    earliestUnix = await fetchEarliestTautulliPlayUnix(config, {
                        username: user.username,
                        email: user.email,
                        plexAccountName,
                    });
                    if (!earliestUnix && accountId && plexUri && typeof fetchEarliestPlexPlayUnix === 'function') {
                        earliestUnix = await fetchEarliestPlexPlayUnix(plexUri, config, accountId);
                    }
                } else {
                    const accountId = resolvePlexHistoryAccountId(user, plexAccounts);
                    if (!accountId || !plexUri || typeof fetchEarliestPlexPlayUnix !== 'function') {
                        summary.missing += 1;
                        return;
                    }
                    earliestUnix = await fetchEarliestPlexPlayUnix(plexUri, config, accountId);
                }
            } catch (e) {
                summary.errors += 1;
                log(`[joining-date] Failed for ${user.username || user.id}: ${e?.message || e}`);
                return;
            }

            const candidateIso = isoFromUnixSeconds(earliestUnix);
            if (!candidateIso) {
                summary.missing += 1;
                return;
            }

            if (!shouldReplaceJoiningDate(user.joiningDate, candidateIso)) {
                summary.skipped += 1;
                return;
            }

            user.joiningDate = candidateIso;
            user.joiningDateSource = 'history';
            summary.updated += 1;
        };

        const workers = Array.from({ length: concurrency }, async () => {
            while (cursor < nextUsers.length) {
                const idx = cursor;
                cursor += 1;
                await scoreOne(nextUsers[idx]);
            }
        });
        await Promise.all(workers);

        if (summary.updated > 0 && typeof saveUsers === 'function') {
            await saveUsers(nextUsers);
        }

        lastResult = { ...summary, at: new Date().toISOString() };
        log(`[joining-date] Backfill complete: updated ${summary.updated}/${summary.processed} via ${summary.source}.`);
        return lastResult;
    })();

    inFlight = run.finally(() => {
        inFlight = null;
    });
    return inFlight;
};
