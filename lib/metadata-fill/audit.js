/**
 * Find episodes that still look like TBA / empty after fill attempts.
 */

import { needsMetadataFill } from './detect.js';
import { createPlexMetadataClient } from './plexWrite.js';
import { getMetadataFillOptions } from './settings.js';

/**
 * Audit a show (or selected libraries) for episodes that still need fill.
 */
export const auditStillTba = async ({
    config,
    baseUrl,
    token,
    rewrite = [],
    showRatingKey = null,
    libraryKeys = null,
    fetchImpl = fetch,
    limit = 200,
} = {}) => {
    const plex = createPlexMetadataClient({ baseUrl, token, fetchImpl, rewrite });
    const options = getMetadataFillOptions(config);
    const keys = Array.isArray(libraryKeys) && libraryKeys.length
        ? libraryKeys.map((k) => String(k).replace(/\D/g, '')).filter(Boolean)
        : options.libraryKeys;
    const max = Math.min(500, Math.max(1, Number(limit) || 200));
    const items = [];

    const pushEpisode = (episode, showTitle, libraryTitle = null) => {
        const gate = needsMetadataFill(episode);
        if (!gate.needs) return;
        // Respect field toggles — only report if a enabled field still needs fill.
        const remaining = {
            title: options.fields.title && gate.fields.title,
            summary: options.fields.summary && gate.fields.summary,
            originallyAvailableAt: options.fields.originallyAvailableAt && gate.fields.originallyAvailableAt,
        };
        if (!remaining.title && !remaining.summary && !remaining.originallyAvailableAt) return;
        items.push({
            ratingKey: String(episode.ratingKey),
            showRatingKey: String(episode.grandparentRatingKey || showRatingKey || ''),
            showTitle: String(showTitle || episode.grandparentTitle || ''),
            libraryTitle,
            seasonNumber: Number(episode.parentIndex),
            episodeNumber: Number(episode.index),
            title: episode.title || '',
            fields: remaining,
        });
    };

    if (showRatingKey) {
        const showKey = String(showRatingKey).replace(/\D/g, '');
        const show = await plex.getMetadata(showKey).catch(() => null);
        const episodes = await plex.listShowEpisodes(showKey, { needingFillOnly: true });
        for (const episode of episodes) {
            pushEpisode(episode, show?.title || episode.grandparentTitle);
            if (items.length >= max) break;
        }
        return {
            ok: true,
            scope: 'show',
            showRatingKey: showKey,
            total: items.length,
            truncated: items.length >= max,
            items,
        };
    }

    let libraries = await plex.listTvLibraries();
    if (keys.length) {
        const want = new Set(keys);
        libraries = libraries.filter((lib) => want.has(String(lib.key).replace(/\D/g, '')));
    }

    for (const library of libraries) {
        let start = 0;
        const pageSize = 40;
        while (items.length < max) {
            const page = await plex.listLibraryShows(library.key, { start, size: pageSize });
            if (!page.items.length) break;
            for (const show of page.items) {
                const episodes = await plex.listShowEpisodes(show.ratingKey, { needingFillOnly: true });
                for (const episode of episodes) {
                    pushEpisode(episode, show.title, library.title);
                    if (items.length >= max) break;
                }
                if (items.length >= max) break;
            }
            start += page.items.length;
            if (start >= (page.totalSize || start) || page.items.length < pageSize) break;
        }
        if (items.length >= max) break;
    }

    return {
        ok: true,
        scope: 'libraries',
        libraryKeys: libraries.map((l) => l.key),
        total: items.length,
        truncated: items.length >= max,
        items,
    };
};
