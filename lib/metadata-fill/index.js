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

export {
    needsMetadataFill,
    mergeEpisodeMetadata,
    isMetadataFillEnabled,
    isMetadataFillAutoImportEnabled,
    scheduleMetadataFillArrHook,
    fillShowEpisodes,
    readMetadataFillLog,
    createPlexMetadataClient,
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
            const [log, retry, scan] = await Promise.all([
                enabled ? readMetadataFillLog() : Promise.resolve([]),
                enabled ? listRetryQueue() : Promise.resolve({ items: [] }),
                enabled ? getLibraryScanStatus() : Promise.resolve(null),
            ]);
            res.json({
                ok: true,
                enabled,
                autoImport: isMetadataFillAutoImportEnabled(config),
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
                : { title: true, summary: true, originallyAvailableAt: true };
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
            if (req.body?.enabled !== undefined) {
                config.metadataFillEnabled = !!req.body.enabled;
            }
            if (req.body?.autoImport !== undefined) {
                config.metadataFillAutoImport = !!req.body.autoImport;
            }
            await saveConfig(config);
            res.json({
                ok: true,
                enabled: isMetadataFillEnabled(config),
                autoImport: isMetadataFillAutoImportEnabled(config),
            });
        } catch (error) {
            res.status(500).json({ error: error?.message || 'Failed to save settings.' });
        }
    });

    return router;
};
