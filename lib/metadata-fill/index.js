/**
 * Metadata Fill API — TMDB + TVDB + TVmaze → locked Plex episode fields.
 */

import {
    fillEpisodeByRatingKey,
    fillShowEpisodes,
    isMetadataFillAutoImportEnabled,
    isMetadataFillEnabled,
    readMetadataFillLog,
    revertEpisodeFill,
    unlockEpisode,
} from './job.js';
import { createPlexMetadataClient } from './plexWrite.js';
import { scheduleMetadataFillArrHook } from './arr-hook.js';
import { needsMetadataFill } from './detect.js';
import { mergeEpisodeMetadata } from './sources.js';
import {
    applyLibraryScanPreview,
    cancelLibraryScan,
    getLibraryScanStatus,
    startLibraryScan,
} from './libraryScan.js';
import {
    clearRetryQueue,
    listRetryQueue,
    processRetryQueue,
    removeRetryItem,
} from './retryQueue.js';
import {
    applyMetadataFillSettingsPatch,
    getMetadataFillOptions,
} from './settings.js';
import { auditStillTba } from './audit.js';
import { bulkRevertShow, bulkUnlockShow } from './bulk.js';

export {
    needsMetadataFill,
    mergeEpisodeMetadata,
    isMetadataFillEnabled,
    isMetadataFillAutoImportEnabled,
    scheduleMetadataFillArrHook,
    fillShowEpisodes,
    readMetadataFillLog,
    createPlexMetadataClient,
    getMetadataFillOptions,
};

const resolvePlexOr400 = async (resolvePlex, config, res) => {
    const plex = await resolvePlex(config);
    if (!plex?.baseUrl || !plex?.token) {
        res.status(400).json({ error: 'Configure Plex server URL and token first.' });
        return null;
    }
    return plex;
};

export const createMetadataFillRouter = ({
    Router,
    requireAdmin,
    requireMetadataFill,
    loadConfig,
    saveConfig,
    resolvePlex,
} = {}) => {
    const router = Router();

    router.get('/status', requireAdmin, async (_req, res) => {
        try {
            const config = await loadConfig();
            const enabled = isMetadataFillEnabled(config);
            const options = getMetadataFillOptions(config);
            const [log, retry, scan] = await Promise.all([
                enabled ? readMetadataFillLog() : Promise.resolve([]),
                enabled ? listRetryQueue() : Promise.resolve({ items: [] }),
                enabled ? getLibraryScanStatus() : Promise.resolve(null),
            ]);
            let libraries = [];
            let librariesError = null;
            if (enabled) {
                try {
                    const plex = await resolvePlex(config);
                    if (plex?.baseUrl && plex?.token) {
                        const client = createPlexMetadataClient({
                            baseUrl: plex.baseUrl,
                            token: plex.token,
                            rewrite: plex.rewrite || [],
                        });
                        libraries = await client.listTvLibraries();
                    } else {
                        librariesError = 'Plex server URL/token not configured.';
                    }
                } catch (error) {
                    libraries = [];
                    librariesError = error?.message || 'Failed to list TV libraries from Plex.';
                }
                // Keep last-known scan libraries visible if live Plex listing fails.
                if (!libraries.length && Array.isArray(scan?.libraries) && scan.libraries.length) {
                    libraries = scan.libraries.map((lib) => ({
                        key: String(lib?.key || ''),
                        title: String(lib?.title || lib?.key || ''),
                    })).filter((lib) => lib.key);
                }
            }
            res.json({
                ok: true,
                enabled,
                autoImport: isMetadataFillAutoImportEnabled(config),
                fields: options.fields,
                sourcePreference: options.sourcePreference,
                requireTitleAgreement: options.requireTitleAgreement,
                libraryKeys: options.libraryKeys,
                libraries,
                librariesError,
                tmdbConfigured: !!String(config.tmdbApiKey || '').trim(),
                tvdbConfigured: !!String(config.tvdbApiKey || '').trim(),
                tvmazeConfigured: true,
                log,
                retryQueue: retry.items || [],
                scan,
            });
        } catch (error) {
            res.status(500).json({ error: error?.message || 'Failed to load Metadata Fill status.' });
        }
    });

    router.get('/libraries', requireAdmin, requireMetadataFill, async (_req, res) => {
        try {
            const config = await loadConfig();
            const plex = await resolvePlexOr400(resolvePlex, config, res);
            if (!plex) return;
            const client = createPlexMetadataClient({
                baseUrl: plex.baseUrl,
                token: plex.token,
                rewrite: plex.rewrite || [],
            });
            res.json({ ok: true, items: await client.listTvLibraries() });
        } catch (error) {
            res.status(500).json({ error: error?.message || 'Failed to list libraries.' });
        }
    });

    router.get('/log', requireAdmin, requireMetadataFill, async (req, res) => {
        try {
            let log = await readMetadataFillLog();
            const status = String(req.query.status || '').trim().toLowerCase();
            const q = String(req.query.q || '').trim().toLowerCase();
            if (status === 'failed') log = log.filter((r) => r?.ok === false);
            else if (status === 'filled') log = log.filter((r) => r?.ok && !r?.skipped && !r?.dryRun && !r?.reverted && !r?.unlocked);
            else if (status === 'preview') log = log.filter((r) => r?.dryRun);
            else if (status === 'skipped') log = log.filter((r) => r?.skipped);
            else if (status === 'reverted') log = log.filter((r) => r?.reverted || r?.unlocked);
            if (q) {
                log = log.filter((r) => {
                    const hay = [
                        r?.showTitle, r?.title, r?.reason, r?.source, r?.ratingKey,
                    ].map((x) => String(x || '').toLowerCase()).join(' ');
                    return hay.includes(q);
                });
            }
            res.json({ ok: true, log });
        } catch (error) {
            res.status(500).json({ error: error?.message || 'Failed to load log.' });
        }
    });

    router.get('/search', requireAdmin, requireMetadataFill, async (req, res) => {
        try {
            const config = await loadConfig();
            const plex = await resolvePlexOr400(resolvePlex, config, res);
            if (!plex) return;
            const client = createPlexMetadataClient({
                baseUrl: plex.baseUrl,
                token: plex.token,
                rewrite: plex.rewrite || [],
            });
            const items = await client.searchShows(String(req.query.q || ''), {
                limit: Math.min(30, Math.max(1, Number(req.query.limit) || 20)),
            });
            res.json({ ok: true, items });
        } catch (error) {
            res.status(500).json({ error: error?.message || 'Show search failed.' });
        }
    });

    router.post('/fill-show', requireAdmin, requireMetadataFill, async (req, res) => {
        try {
            const showRatingKey = String(req.body?.ratingKey || req.body?.showRatingKey || '').replace(/\D/g, '');
            if (!showRatingKey) return res.status(400).json({ error: 'ratingKey is required.' });
            const config = await loadConfig();
            const plex = await resolvePlexOr400(resolvePlex, config, res);
            if (!plex) return;
            const dryRun = !!req.body?.dryRun;
            const result = await fillShowEpisodes({
                config,
                baseUrl: plex.baseUrl,
                token: plex.token,
                rewrite: plex.rewrite || [],
                showRatingKey,
                concurrency: 2,
                source: dryRun ? 'manual-show-preview' : 'manual-show',
                dryRun,
            });
            res.json(result);
        } catch (error) {
            res.status(500).json({ error: error?.message || 'Fill show failed.' });
        }
    });

    router.post('/fill-episode', requireAdmin, requireMetadataFill, async (req, res) => {
        try {
            const ratingKey = String(req.body?.ratingKey || '').replace(/\D/g, '');
            if (!ratingKey) return res.status(400).json({ error: 'ratingKey is required.' });
            const config = await loadConfig();
            const plex = await resolvePlexOr400(resolvePlex, config, res);
            if (!plex) return;
            const result = await fillEpisodeByRatingKey({
                config,
                baseUrl: plex.baseUrl,
                token: plex.token,
                rewrite: plex.rewrite || [],
                ratingKey,
                dryRun: !!req.body?.dryRun,
                source: req.body?.dryRun ? 'manual-episode-preview' : 'manual-episode',
            });
            res.json(result);
        } catch (error) {
            res.status(500).json({ error: error?.message || 'Fill episode failed.' });
        }
    });

    router.post('/unlock', requireAdmin, requireMetadataFill, async (req, res) => {
        try {
            const ratingKey = String(req.body?.ratingKey || '').replace(/\D/g, '');
            if (!ratingKey) return res.status(400).json({ error: 'ratingKey is required.' });
            const config = await loadConfig();
            const plex = await resolvePlexOr400(resolvePlex, config, res);
            if (!plex) return;
            const fields = req.body?.fields && typeof req.body.fields === 'object'
                ? req.body.fields
                : getMetadataFillOptions(config).fields;
            const result = await unlockEpisode({
                baseUrl: plex.baseUrl,
                token: plex.token,
                rewrite: plex.rewrite || [],
                ratingKey,
                fields,
            });
            res.json(result);
        } catch (error) {
            res.status(500).json({ error: error?.message || 'Unlock failed.' });
        }
    });

    router.post('/revert', requireAdmin, requireMetadataFill, async (req, res) => {
        try {
            const ratingKey = String(req.body?.ratingKey || '').replace(/\D/g, '');
            const logId = String(req.body?.logId || '').trim();
            if (!ratingKey && !logId) {
                return res.status(400).json({ error: 'ratingKey or logId is required.' });
            }
            const config = await loadConfig();
            const plex = await resolvePlexOr400(resolvePlex, config, res);
            if (!plex) return;
            const result = await revertEpisodeFill({
                baseUrl: plex.baseUrl,
                token: plex.token,
                rewrite: plex.rewrite || [],
                ratingKey: ratingKey || undefined,
                logId: logId || undefined,
                unlock: req.body?.unlock !== false,
            });
            res.json(result);
        } catch (error) {
            res.status(500).json({ error: error?.message || 'Revert failed.' });
        }
    });

    router.post('/bulk-unlock', requireAdmin, requireMetadataFill, async (req, res) => {
        try {
            const showRatingKey = String(req.body?.showRatingKey || req.body?.ratingKey || '').replace(/\D/g, '');
            if (!showRatingKey) return res.status(400).json({ error: 'showRatingKey is required.' });
            const config = await loadConfig();
            const plex = await resolvePlexOr400(resolvePlex, config, res);
            if (!plex) return;
            res.json(await bulkUnlockShow({
                config,
                baseUrl: plex.baseUrl,
                token: plex.token,
                rewrite: plex.rewrite || [],
                showRatingKey,
            }));
        } catch (error) {
            res.status(500).json({ error: error?.message || 'Bulk unlock failed.' });
        }
    });

    router.post('/bulk-revert', requireAdmin, requireMetadataFill, async (req, res) => {
        try {
            const showRatingKey = String(req.body?.showRatingKey || req.body?.ratingKey || '').replace(/\D/g, '');
            if (!showRatingKey) return res.status(400).json({ error: 'showRatingKey is required.' });
            const config = await loadConfig();
            const plex = await resolvePlexOr400(resolvePlex, config, res);
            if (!plex) return;
            res.json(await bulkRevertShow({
                baseUrl: plex.baseUrl,
                token: plex.token,
                rewrite: plex.rewrite || [],
                showRatingKey,
                unlock: req.body?.unlock !== false,
            }));
        } catch (error) {
            res.status(500).json({ error: error?.message || 'Bulk revert failed.' });
        }
    });

    router.post('/audit', requireAdmin, requireMetadataFill, async (req, res) => {
        try {
            const config = await loadConfig();
            const plex = await resolvePlexOr400(resolvePlex, config, res);
            if (!plex) return;
            const showRatingKey = String(req.body?.showRatingKey || req.body?.ratingKey || '').replace(/\D/g, '') || null;
            const libraryKeys = Array.isArray(req.body?.libraryKeys) ? req.body.libraryKeys : null;
            res.json(await auditStillTba({
                config,
                baseUrl: plex.baseUrl,
                token: plex.token,
                rewrite: plex.rewrite || [],
                showRatingKey,
                libraryKeys,
                limit: Math.min(500, Math.max(1, Number(req.body?.limit) || 200)),
            }));
        } catch (error) {
            res.status(500).json({ error: error?.message || 'Audit failed.' });
        }
    });

    router.get('/scan', requireAdmin, requireMetadataFill, async (_req, res) => {
        try {
            res.json({ ok: true, scan: await getLibraryScanStatus() });
        } catch (error) {
            res.status(500).json({ error: error?.message || 'Failed to load scan status.' });
        }
    });

    router.post('/scan/start', requireAdmin, requireMetadataFill, async (req, res) => {
        try {
            const config = await loadConfig();
            const plex = await resolvePlexOr400(resolvePlex, config, res);
            if (!plex) return;
            const result = await startLibraryScan({
                config,
                baseUrl: plex.baseUrl,
                token: plex.token,
                rewrite: plex.rewrite || [],
                dryRun: req.body?.dryRun !== false,
                resume: !!req.body?.resume,
                libraryKeys: Array.isArray(req.body?.libraryKeys) ? req.body.libraryKeys : null,
            });
            if (!result.ok) return res.status(409).json(result);
            res.json(result);
        } catch (error) {
            res.status(500).json({ error: error?.message || 'Failed to start library scan.' });
        }
    });

    router.post('/scan/cancel', requireAdmin, requireMetadataFill, async (_req, res) => {
        try {
            res.json(await cancelLibraryScan());
        } catch (error) {
            res.status(500).json({ error: error?.message || 'Failed to cancel scan.' });
        }
    });

    router.post('/scan/apply', requireAdmin, requireMetadataFill, async (req, res) => {
        try {
            const config = await loadConfig();
            const plex = await resolvePlexOr400(resolvePlex, config, res);
            if (!plex) return;
            const result = await applyLibraryScanPreview({
                config,
                baseUrl: plex.baseUrl,
                token: plex.token,
                rewrite: plex.rewrite || [],
                ratingKeys: Array.isArray(req.body?.ratingKeys) ? req.body.ratingKeys : null,
            });
            res.json(result);
        } catch (error) {
            res.status(500).json({ error: error?.message || 'Failed to apply preview.' });
        }
    });

    router.get('/retry', requireAdmin, requireMetadataFill, async (_req, res) => {
        try {
            const queue = await listRetryQueue();
            res.json({ ok: true, items: queue.items || [] });
        } catch (error) {
            res.status(500).json({ error: error?.message || 'Failed to load retry queue.' });
        }
    });

    router.post('/retry/process', requireAdmin, requireMetadataFill, async (req, res) => {
        try {
            const config = await loadConfig();
            const plex = await resolvePlexOr400(resolvePlex, config, res);
            if (!plex) return;
            const result = await processRetryQueue({
                config,
                baseUrl: plex.baseUrl,
                token: plex.token,
                rewrite: plex.rewrite || [],
                limit: Math.min(50, Math.max(1, Number(req.body?.limit) || 10)),
            });
            res.json(result);
        } catch (error) {
            res.status(500).json({ error: error?.message || 'Retry process failed.' });
        }
    });

    router.delete('/retry/:id', requireAdmin, requireMetadataFill, async (req, res) => {
        try {
            res.json(await removeRetryItem(req.params.id));
        } catch (error) {
            res.status(500).json({ error: error?.message || 'Failed to remove retry item.' });
        }
    });

    router.post('/retry/clear', requireAdmin, requireMetadataFill, async (_req, res) => {
        try {
            res.json(await clearRetryQueue());
        } catch (error) {
            res.status(500).json({ error: error?.message || 'Failed to clear retry queue.' });
        }
    });

    router.post('/settings', requireAdmin, async (req, res) => {
        try {
            const config = await loadConfig();
            applyMetadataFillSettingsPatch(config, req.body || {});
            await saveConfig(config);
            const options = getMetadataFillOptions(config);
            res.json({
                ok: true,
                enabled: isMetadataFillEnabled(config),
                autoImport: isMetadataFillAutoImportEnabled(config),
                fields: options.fields,
                sourcePreference: options.sourcePreference,
                requireTitleAgreement: options.requireTitleAgreement,
                libraryKeys: options.libraryKeys,
            });
        } catch (error) {
            res.status(500).json({ error: error?.message || 'Failed to save settings.' });
        }
    });

    return router;
};
