/**
 * Metadata Fill API — TMDB + TVDB → locked Plex episode fields.
 */

import {
    fillShowEpisodes,
    isMetadataFillAutoImportEnabled,
    isMetadataFillEnabled,
    readMetadataFillLog,
} from './job.js';
import { createPlexMetadataClient } from './plexWrite.js';
import { scheduleMetadataFillArrHook } from './arr-hook.js';
import { needsMetadataFill } from './detect.js';
import { mergeEpisodeMetadata } from './sources.js';

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
            res.json({
                ok: true,
                enabled,
                autoImport: isMetadataFillAutoImportEnabled(config),
                tmdbConfigured: !!String(config.tmdbApiKey || '').trim(),
                tvdbConfigured: !!String(config.tvdbApiKey || '').trim(),
                log: enabled ? await readMetadataFillLog() : [],
            });
        } catch (error) {
            res.status(500).json({ error: error?.message || 'Failed to load Metadata Fill status.' });
        }
    });

    router.get('/log', requireAdmin, requireMetadataFill, async (_req, res) => {
        try {
            res.json({ ok: true, log: await readMetadataFillLog() });
        } catch (error) {
            res.status(500).json({ error: error?.message || 'Failed to load log.' });
        }
    });

    router.get('/search', requireAdmin, requireMetadataFill, async (req, res) => {
        try {
            const config = await loadConfig();
            const plex = await resolvePlex(config);
            if (!plex?.baseUrl || !plex?.token) {
                return res.status(400).json({ error: 'Configure Plex server URL and token first.' });
            }
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
            const plex = await resolvePlex(config);
            if (!plex?.baseUrl || !plex?.token) {
                return res.status(400).json({ error: 'Configure Plex server URL and token first.' });
            }
            const result = await fillShowEpisodes({
                config,
                baseUrl: plex.baseUrl,
                token: plex.token,
                rewrite: plex.rewrite || [],
                showRatingKey,
                concurrency: 2,
                source: 'manual-show',
            });
            res.json(result);
        } catch (error) {
            res.status(500).json({ error: error?.message || 'Fill show failed.' });
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
