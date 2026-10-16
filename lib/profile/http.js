/**
 * Profile HTTP routes.
 */

import { normalizeMemberPrivacy, shouldHidePeerName } from '../privacy/memberPrivacy.js';
import { loadAchievementsState } from '../achievements/store.js';
import { buildMemberDossier } from '../achievements/memberDossier.js';
import {
    PROFILE_UNAVAILABLE,
    assembleProfilePayload,
    collapseProfileRequests,
    decidePeerProfileAccess,
    findPortalUserForAccountId,
    isSameProfileSubject,
    normalizeHideStreamUsers,
    resolveAchievementsAccountId,
} from './assemble.js';
import { sharedWatchedFromAnalytics } from './sharedWatched.js';
import {
    libraryNamesForUser,
    normalizeProfilePins,
    profileIdentityKeys,
    sanitizeProfileBio,
    setProfilePin,
} from './social.js';
import { trimWrapUpForProfile } from './wrapUp.js';

const slimRequest = (item = {}) => ({
    id: item.id ?? item.requestId ?? null,
    title: item.title || item.mediaTitle || item.name || '',
    posterUrl: item.posterUrl || item.posterPath || item.image || null,
    status: item.statusLabel || item.status || item.mediaStatus || null,
    mediaType: item.mediaType || item.type || null,
    tmdbId: Number(item.tmdbId) || null,
    mbid: item.mbid || null,
    is4k: !!item.is4k,
    statusLabel: item.statusLabel || null,
});

export const registerProfileRoutes = (app, deps) => {
    const {
        requireAuth,
        requireMember,
        loadFile,
        CONFIG_PATH,
        USERS_PATH,
        resolvePortalAccountId,
        resolveLocalUser = async () => null,
        loadRequestSummary = async () => null,
        log = () => {},
        loadAnalyticsCache = async () => ({}),
        listLibrarySections = async () => [],
        saveFile = null,
        blockIfImpersonating = () => false,
        loadSubjectWrapUp = null,
    } = deps;

    const wrapUpWithTimeout = async (task, ms = 10000) => {
        if (typeof task !== 'function') return { payload: null, pending: false };
        let timer = null;
        try {
            const payload = await Promise.race([
                task(),
                new Promise((_, reject) => {
                    timer = setTimeout(() => reject(new Error('wrap-up timeout')), ms);
                }),
            ]);
            return { payload: payload || null, pending: false };
        } catch {
            return { payload: null, pending: true };
        } finally {
            if (timer) clearTimeout(timer);
        }
    };

    const buildForSubject = async ({
        req,
        config,
        users,
        portalUser,
        rawId,
        isOwnEndpoint,
    }) => {
        const viewerIsAdmin = !!req.user?.isAdmin;
        const viewerAccountId = typeof resolvePortalAccountId === 'function'
            ? await resolvePortalAccountId(req, config)
            : (req.user?.jellyfinId || req.user?.id || null);
        const achievementsEnabled = !!config.achievementsEnabled;
        const showOnProfile = config.achievementsShowOnProfile !== false;
        const state = achievementsEnabled ? await loadAchievementsState() : { users: {} };
        const subjectAccountId = resolveAchievementsAccountId(
            portalUser,
            isOwnEndpoint ? (viewerAccountId || rawId) : rawId,
            state,
            {
                mergeViewerIds: !!isOwnEndpoint,
                viewerAccountId: isOwnEndpoint ? viewerAccountId : null,
                username: portalUser?.username || (isOwnEndpoint ? req.user?.username : null),
                adminPlexId: config.adminPlexId,
            },
        );
        const snapshot = subjectAccountId ? (state.users?.[String(subjectAccountId)] || null) : null;
        const subjectUser = portalUser
            || (snapshot?.username ? findPortalUserForAccountId(users, snapshot.username) : null);
        const isSelf = isOwnEndpoint || isSameProfileSubject({
            viewer: req.user,
            viewerAccountId,
            subjectAccountId,
            portalUser: subjectUser,
        });

        if (!subjectUser && !snapshot && !isSelf) {
            return { status: 404, body: { error: PROFILE_UNAVAILABLE } };
        }

        const privacy = normalizeMemberPrivacy(subjectUser || {});
        const access = decidePeerProfileAccess({
            isSelf,
            viewerIsAdmin,
            hideStreamUsers: normalizeHideStreamUsers(config),
            showUsernamesInAnalytics: config.showUsernamesInAnalytics,
            leaderboardOptOut: !!snapshot?.leaderboardOptOut || !privacy.privacyShowAchievements,
            privacyShowName: privacy.privacyShowName,
            privacyShowProfile: privacy.privacyShowProfile,
        });
        if (!access.ok) {
            return { status: access.status || 404, body: { error: access.error || PROFILE_UNAVAILABLE } };
        }

        const dossier = achievementsEnabled && subjectAccountId && !(access.locked && !viewerIsAdmin)
            ? buildMemberDossier(state, {
                accountId: subjectAccountId,
                viewerAccountId,
                obfuscate: access.obfuscate,
                weights: config.achievementsXpWeights,
            })
            : null;

        let viewerSnapshot = null;
        let viewerDossier = null;
        if (!isSelf && !access.locked) {
            const viewerPortalUser = findPortalUserForAccountId(users, viewerAccountId)
                || findPortalUserForAccountId(users, req.user?.id || req.user?.plexId || '');
            const viewerAchievementsId = resolveAchievementsAccountId(
                viewerPortalUser,
                viewerAccountId,
                state,
                {
                    mergeViewerIds: true,
                    viewerAccountId,
                    username: req.user?.username,
                    adminPlexId: config.adminPlexId,
                },
            );
            if (viewerAchievementsId && String(viewerAchievementsId) !== String(subjectAccountId || '')) {
                viewerSnapshot = state.users?.[String(viewerAchievementsId)] || null;
                if (achievementsEnabled && viewerSnapshot) {
                    viewerDossier = buildMemberDossier(state, {
                        accountId: viewerAchievementsId,
                        viewerAccountId,
                        obfuscate: false,
                        weights: config.achievementsXpWeights,
                    });
                }
            }
        }

        let requests = null;
        if (access.includeAccount) {
            try {
                const summary = await loadRequestSummary(req, config, subjectUser || req.user);
                if (summary) {
                    requests = {
                        ...summary,
                        recent: collapseProfileRequests(
                            (Array.isArray(summary.recent) ? summary.recent : []).map(slimRequest),
                            { limit: 6 },
                        ),
                    };
                }
            } catch (error) {
                if (typeof log === 'function') log(`[profile] requests summary failed: ${error?.message || error}`);
            }
        }

        let sharedWatched = [];
        if (!isSelf && !access.locked && !access.obfuscate && viewerSnapshot) {
            try {
                const cache = await loadAnalyticsCache();
                sharedWatched = sharedWatchedFromAnalytics({
                    cache,
                    viewerIds: profileIdentityKeys(findPortalUserForAccountId(users, viewerAccountId), viewerAccountId, viewerSnapshot),
                    subjectIds: profileIdentityKeys(subjectUser, subjectAccountId, snapshot),
                });
            } catch (error) {
                if (typeof log === 'function') log(`[profile] shared watched failed: ${error?.message || error}`);
            }
        }

        const bio = sanitizeProfileBio(subjectUser?.profileBio);
        const showEmail = !access.obfuscate && !!subjectUser?.email && (
            isSelf || viewerIsAdmin || subjectUser?.privacyShowEmail === true
        );
        const showLibraries = !access.obfuscate && (
            isSelf || viewerIsAdmin || subjectUser?.privacyShowLibraries === true
        );
        let libraries = null;
        if (showLibraries) {
            try {
                const catalog = await listLibrarySections(config);
                libraries = libraryNamesForUser(subjectUser || {}, catalog);
            } catch {
                libraries = libraryNamesForUser(subjectUser || {}, []);
            }
        }
        const viewerPortalUser = findPortalUserForAccountId(users, viewerAccountId)
            || findPortalUserForAccountId(users, req.user?.id || req.user?.plexId || '');
        const following = (!access.obfuscate ? normalizeProfilePins(subjectUser?.profilePins) : [])
            .map((id) => {
                const peer = findPortalUserForAccountId(users, id);
                const hide = !peer || shouldHidePeerName(peer, { viewerIsAdmin })
                    || (!viewerIsAdmin && !normalizeMemberPrivacy(peer).privacyShowProfile);
                return {
                    username: hide ? 'Anonymous' : (peer?.username || 'Member'),
                    accountId: hide ? null : (peer?.plexAccountId || peer?.id || id),
                    thumb: hide ? null : (peer?.thumb || null),
                };
            });
        const subjectKeys = new Set(profileIdentityKeys(subjectUser, subjectAccountId, snapshot));
        const viewerPinned = normalizeProfilePins(viewerPortalUser?.profilePins)
            .some((id) => subjectKeys.has(id) || findPortalUserForAccountId(users, id) === subjectUser);
        const social = access.locked && !viewerIsAdmin ? null : {
            bio: (isSelf || viewerIsAdmin || !access.obfuscate) ? (bio || null) : null,
            email: showEmail ? String(subjectUser?.email || '') : null,
            libraries,
            following,
            viewerPinned: !!(!isSelf && viewerPinned),
            canPin: !!(!isSelf && !access.locked && !access.obfuscate && (subjectAccountId || subjectUser)),
        };

        let wrapUp = null;
        let wrapUpPending = false;
        if (!(access.locked && !viewerIsAdmin) && typeof loadSubjectWrapUp === 'function') {
            const loaded = await wrapUpWithTimeout(() => loadSubjectWrapUp({
                config,
                subjectAccountId,
                subjectUser,
                viewer: req.user,
                daysKey: 'all',
            }));
            wrapUpPending = loaded.pending;
            if (loaded.payload) {
                wrapUp = trimWrapUpForProfile(loaded.payload, {
                    isSelf,
                    viewerIsAdmin,
                    obfuscate: access.obfuscate,
                });
            }
        }

        const payload = assembleProfilePayload({
            isSelf,
            viewerIsAdmin,
            obfuscate: access.obfuscate,
            includeAccount: access.includeAccount,
            locked: !!access.locked,
            privateToPeers: !!access.privateToPeers,
            mediaServerType: config.mediaServerType || 'plex',
            portalUser: subjectUser || (isSelf ? findPortalUserForAccountId(users, viewerAccountId) : null),
            subjectAccountId: access.obfuscate && !isSelf ? null : subjectAccountId,
            dossier,
            snapshot,
            viewerSnapshot,
            viewerDossier,
            achievementsEnabled,
            showOnProfile: showOnProfile && (isSelf || viewerIsAdmin || !access.hideAchievements),
            requests,
            sharedWatched,
            social,
            wrapUp,
            wrapUpPending,
        });
        return { status: 200, body: payload };
    };

    app.get('/api/profile/me', requireAuth, requireMember, async (req, res) => {
        try {
            const config = await loadFile(CONFIG_PATH, {});
            const users = await loadFile(USERS_PATH, []);
            const portalUser = await resolveLocalUser(req.user) || findPortalUserForAccountId(
                users,
                req.user?.id || req.user?.plexId || req.user?.jellyfinId || '',
            );
            const result = await buildForSubject({
                req,
                config,
                users,
                portalUser,
                rawId: null,
                isOwnEndpoint: true,
            });
            res.status(result.status).json(result.body);
        } catch (error) {
            if (typeof log === 'function') log(`[profile] /me failed: ${error?.message || error}`);
            res.status(500).json({ error: error?.message || 'Profile error' });
        }
    });

    app.get('/api/profile/:accountId', requireAuth, requireMember, async (req, res) => {
        try {
            const rawId = decodeURIComponent(String(req.params.accountId || '').trim());
            if (!rawId || rawId === 'me') {
                return res.redirect(302, '/api/profile/me');
            }
            const config = await loadFile(CONFIG_PATH, {});
            const users = await loadFile(USERS_PATH, []);
            const portalUser = findPortalUserForAccountId(users, rawId);
            const result = await buildForSubject({
                req,
                config,
                users,
                portalUser,
                rawId,
                isOwnEndpoint: false,
            });
            res.status(result.status).json(result.body);
        } catch (error) {
            if (typeof log === 'function') log(`[profile] /:accountId failed: ${error?.message || error}`);
            res.status(500).json({ error: error?.message || 'Profile error' });
        }
    });

    app.post('/api/profile/pin', requireAuth, requireMember, async (req, res) => {
        if (typeof blockIfImpersonating === 'function' && blockIfImpersonating(req, res)) return;
        if (typeof saveFile !== 'function') {
            return res.status(500).json({ error: 'Unavailable' });
        }
        try {
            const pinned = req.body?.pinned !== false;
            const targetId = String(req.body?.accountId || '').trim();
            if (!targetId) return res.status(400).json({ error: 'accountId required' });
            const users = await loadFile(USERS_PATH, []);
            const viewer = findPortalUserForAccountId(
                users,
                req.user?.id || req.user?.plexId || req.user?.jellyfinId || '',
            );
            const target = findPortalUserForAccountId(users, targetId);
            if (!viewer || !target) {
                return res.status(404).json({ error: PROFILE_UNAVAILABLE });
            }
            if (String(viewer.id) === String(target.id)) {
                return res.status(400).json({ error: 'Cannot follow yourself' });
            }
            const index = users.findIndex((user) => String(user?.id) === String(viewer.id));
            if (index === -1) return res.status(404).json({ error: PROFILE_UNAVAILABLE });
            const pinKey = String(target.plexAccountId || target.id || targetId).trim();
            users[index].profilePins = setProfilePin(users[index].profilePins, pinKey, pinned);
            await saveFile(USERS_PATH, users);
            res.json({ success: true, pinned, profilePins: users[index].profilePins });
        } catch (error) {
            if (typeof log === 'function') log(`[profile] pin failed: ${error?.message || error}`);
            res.status(500).json({ error: error?.message || 'Pin failed' });
        }
    });
};

export default registerProfileRoutes;
export { slimRequest };
