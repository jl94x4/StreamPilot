/**
 * Find Plex episodes and write locked title/summary/air date.
 */

import { createPlexTarget } from '../scanner/targets/plex.js';
import { expandPathRewriteCandidates } from '../scanner/rewrite.js';
import { extractTvdbIdFromPlexMeta } from '../media-server-library.js';
import { needsMetadataFill } from './detect.js';

const asArray = (value) => {
    if (Array.isArray(value)) return value;
    if (value == null) return [];
    return [value];
};

const plexGuidList = (metadata = {}) => {
    const guids = [];
    for (const entry of asArray(metadata.Guid)) {
        if (entry?.id) guids.push(String(entry.id));
    }
    if (metadata.guid) guids.push(String(metadata.guid));
    if (metadata.grandparentGuid) guids.push(String(metadata.grandparentGuid));
    if (metadata.parentGuid) guids.push(String(metadata.parentGuid));
    return guids;
};

export const extractTmdbIdFromPlexMeta = (metadata = {}) => {
    for (const raw of plexGuidList(metadata)) {
        const match = raw.match(/(?:tmdb|themoviedb):\/\/(\d+)/i);
        if (match) return match[1];
    }
    return null;
};

export const extractImdbIdFromPlexMeta = (metadata = {}) => {
    for (const raw of plexGuidList(metadata)) {
        const match = raw.match(/imdb:\/\/(tt\d+)/i);
        if (match) return match[1];
    }
    return null;
};

export { extractTvdbIdFromPlexMeta };

const plexHeaders = (token) => ({
    Accept: 'application/json',
    'X-Plex-Token': String(token || '').trim(),
    'X-Plex-Product': 'StreamPilot Metadata Fill',
    'X-Plex-Client-Identifier': 'streampilot-metadata-fill',
});

const joinUrl = (base, ...parts) => {
    const root = String(base || '').replace(/\/+$/, '');
    const path = parts.map((p) => String(p || '').replace(/^\/+|\/+$/g, '')).filter(Boolean).join('/');
    return `${root}/${path}`;
};

/**
 * Build PUT query for locked episode fields. Only includes fields requested.
 * @returns {URLSearchParams}
 */
export const buildPlexEpisodeEditParams = ({
    ratingKey,
    title,
    summary,
    originallyAvailableAt,
    fields = {},
    lock = true,
} = {}) => {
    const params = new URLSearchParams();
    params.set('type', '4');
    params.set('id', String(ratingKey || '').replace(/\D/g, ''));
    const locked = lock ? '1' : '0';
    if (fields.title && title != null && String(title).trim()) {
        params.set('title.value', String(title).trim());
        params.set('title.locked', locked);
    }
    if (fields.summary && summary != null && String(summary).trim()) {
        params.set('summary.value', String(summary).trim());
        params.set('summary.locked', locked);
    }
    if (fields.originallyAvailableAt && originallyAvailableAt != null && String(originallyAvailableAt).trim()) {
        // Plex expects YYYY-MM-DD
        const day = String(originallyAvailableAt).trim().slice(0, 10);
        if (/^\d{4}-\d{2}-\d{2}$/.test(day)) {
            params.set('originallyAvailableAt.value', day);
            params.set('originallyAvailableAt.locked', locked);
        }
    }
    return params;
};

/** Unlock fields without changing values (Plex agents may refresh afterward). */
export const buildPlexEpisodeUnlockParams = ({
    ratingKey,
    fields = { title: true, summary: true, originallyAvailableAt: true },
} = {}) => {
    const params = new URLSearchParams();
    params.set('type', '4');
    params.set('id', String(ratingKey || '').replace(/\D/g, ''));
    if (fields.title) params.set('title.locked', '0');
    if (fields.summary) params.set('summary.locked', '0');
    if (fields.originallyAvailableAt) params.set('originallyAvailableAt.locked', '0');
    return params;
};

export const createPlexMetadataClient = ({
    baseUrl,
    token,
    fetchImpl = fetch,
    rewrite = [],
} = {}) => {
    const uri = String(baseUrl || '').replace(/\/+$/, '');
    const plexToken = String(token || '').trim();
    if (!uri || !plexToken) {
        throw new Error('Plex server URL and token are required for Metadata Fill.');
    }

    const target = createPlexTarget({ url: uri, token: plexToken, rewrite });

    const fetchJson = async (url) => {
        const res = await fetchImpl(String(url), { headers: plexHeaders(plexToken) });
        if (!res.ok) {
            const body = await res.text().catch(() => '');
            const err = new Error(`Plex HTTP ${res.status}: ${body.slice(0, 200)}`);
            err.status = res.status;
            throw err;
        }
        return res.json();
    };

    const getMetadata = async (ratingKey) => {
        const url = new URL(joinUrl(uri, 'library', 'metadata', String(ratingKey)));
        url.searchParams.set('includeGuids', '1');
        const data = await fetchJson(url);
        return asArray(data?.MediaContainer?.Metadata)[0] || null;
    };

    const lookupKeysByFile = async (filePath) => {
        const libsUrl = new URL(joinUrl(uri, 'library', 'sections'));
        const libs = await fetchJson(libsUrl);
        const sections = asArray(libs?.MediaContainer?.Directory)
            .filter((row) => String(row?.type || '') === 'show');
        const candidates = expandPathRewriteCandidates(filePath, rewrite)
            .map((row) => String(row || '').replace(/\\/g, '/'))
            .filter(Boolean);
        if (!candidates.length) {
            const normalized = String(filePath || '').replace(/\\/g, '/').trim();
            if (normalized) candidates.push(normalized);
        }
        const basename = (candidates[0] || '').split('/').pop() || '';
        const keys = [];
        for (const file of candidates) {
            for (const lib of sections) {
                for (const endpoint of ['allLeaves', 'all']) {
                    const byFile = new URL(joinUrl(uri, 'library', 'sections', String(lib.key), endpoint));
                    byFile.searchParams.set('file', file);
                    byFile.searchParams.set('includeGuids', '1');
                    const payload = await fetchJson(byFile).catch(() => null);
                    const metas = asArray(payload?.MediaContainer?.Metadata)
                        .filter((m) => String(m?.type || '') === 'episode');
                    if (metas.length) {
                        keys.push(...metas.map((m) => String(m.ratingKey)));
                        break;
                    }
                }
                if (keys.length) break;
            }
            if (keys.length) break;
        }
        if (!keys.length && basename) {
            // Fallback: analyzeFile resolve (folder scan may still be catching up).
            const analyzed = await target.analyzeFile(filePath, {
                retries: 0,
                initialDelayMs: 0,
            }).catch(() => null);
            for (const row of analyzed?.analyzed || []) {
                if (row?.ratingKey) keys.push(String(row.ratingKey));
            }
        }
        return [...new Set(keys)];
    };

    const findEpisodeByFile = async (filePath, {
        retries = 3,
        retryDelayMs = 5000,
        initialDelayMs = 45_000,
    } = {}) => {
        if (initialDelayMs > 0) {
            await new Promise((r) => setTimeout(r, initialDelayMs));
        }
        let keys = [];
        for (let attempt = 0; attempt <= retries; attempt += 1) {
            keys = await lookupKeysByFile(filePath);
            if (keys.length) break;
            if (attempt < retries) {
                await new Promise((r) => setTimeout(r, retryDelayMs));
            }
        }
        if (!keys.length) return null;
        const meta = await getMetadata(keys[0]);
        return meta && String(meta.type || '') === 'episode' ? meta : null;
    };

    const resolveShowRatingKey = async ({ tmdbId, tvdbId, imdbId, showTitle } = {}) => {
        const query = String(showTitle || '').trim();
        if (query) {
            const hits = await searchShows(query, { limit: 12 });
            const wantTmdb = tmdbId != null && String(tmdbId).trim() !== '' ? String(tmdbId) : '';
            const wantTvdb = tvdbId != null && String(tvdbId).trim() !== '' ? String(tvdbId) : '';
            const wantImdb = /^tt\d+$/i.test(String(imdbId || '').trim()) ? String(imdbId).trim() : '';
            const byId = hits.find((hit) => (
                (wantTmdb && String(hit.tmdbId || '') === wantTmdb)
                || (wantTvdb && String(hit.tvdbId || '') === wantTvdb)
            ));
            if (byId?.ratingKey) return String(byId.ratingKey);
            // Prefer exact title match before falling through to first hub hit.
            const exact = hits.find((hit) => String(hit.title || '').toLowerCase() === query.toLowerCase());
            if (exact?.ratingKey) return String(exact.ratingKey);
            if (hits[0]?.ratingKey && !wantTmdb && !wantTvdb && !wantImdb) return String(hits[0].ratingKey);
        }
        return null;
    };

    const findEpisodeByShowEpisode = async ({
        seasonNumber,
        episodeNumber,
        tmdbId,
        tvdbId,
        imdbId,
        showTitle,
        retries = 3,
        retryDelayMs = 5000,
        initialDelayMs = 0,
    } = {}) => {
        const season = Number(seasonNumber);
        const episode = Number(episodeNumber);
        if (!Number.isFinite(season) || !Number.isFinite(episode)) return null;
        if (initialDelayMs > 0) {
            await new Promise((r) => setTimeout(r, initialDelayMs));
        }
        for (let attempt = 0; attempt <= retries; attempt += 1) {
            const showKey = await resolveShowRatingKey({ tmdbId, tvdbId, imdbId, showTitle });
            if (showKey) {
                const url = new URL(joinUrl(uri, 'library', 'metadata', showKey, 'allLeaves'));
                url.searchParams.set('includeGuids', '1');
                url.searchParams.set('X-Plex-Container-Start', '0');
                url.searchParams.set('X-Plex-Container-Size', '2000');
                const data = await fetchJson(url).catch(() => null);
                const match = asArray(data?.MediaContainer?.Metadata).find((row) => (
                    String(row?.type || '') === 'episode'
                    && Number(row?.parentIndex) === season
                    && Number(row?.index) === episode
                ));
                if (match?.ratingKey) {
                    const meta = await getMetadata(match.ratingKey);
                    if (meta && String(meta.type || '') === 'episode') return meta;
                }
            }
            if (attempt < retries) {
                await new Promise((r) => setTimeout(r, retryDelayMs));
            }
        }
        return null;
    };

    const listShowEpisodes = async (showRatingKey, { needingFillOnly = false } = {}) => {
        const showKey = String(showRatingKey || '').replace(/\D/g, '');
        if (!showKey) return [];
        const url = new URL(joinUrl(uri, 'library', 'metadata', showKey, 'allLeaves'));
        url.searchParams.set('includeGuids', '1');
        url.searchParams.set('X-Plex-Container-Start', '0');
        url.searchParams.set('X-Plex-Container-Size', '2000');
        const data = await fetchJson(url);
        let rows = asArray(data?.MediaContainer?.Metadata)
            .filter((row) => String(row?.type || '') === 'episode');
        if (needingFillOnly) {
            rows = rows.filter((row) => needsMetadataFill(row).needs);
        }
        return rows;
    };

    const listShowEpisodesNeedingFill = async (showRatingKey) => (
        listShowEpisodes(showRatingKey, { needingFillOnly: true })
    );

    const listTvLibraries = async () => {
        const libsUrl = new URL(joinUrl(uri, 'library', 'sections'));
        const libs = await fetchJson(libsUrl);
        return asArray(libs?.MediaContainer?.Directory)
            .filter((row) => String(row?.type || '') === 'show')
            .map((row) => ({
                key: String(row.key),
                title: String(row.title || row.key),
            }));
    };

    const listLibraryShows = async (libraryKey, { start = 0, size = 50 } = {}) => {
        const key = String(libraryKey || '').replace(/\D/g, '');
        if (!key) return { items: [], totalSize: 0 };
        const url = new URL(joinUrl(uri, 'library', 'sections', key, 'all'));
        url.searchParams.set('type', '2');
        url.searchParams.set('includeGuids', '1');
        url.searchParams.set('X-Plex-Container-Start', String(Math.max(0, start)));
        url.searchParams.set('X-Plex-Container-Size', String(Math.min(200, Math.max(1, size))));
        const data = await fetchJson(url);
        const container = data?.MediaContainer || {};
        return {
            items: asArray(container.Metadata)
                .filter((row) => String(row?.type || '') === 'show')
                .map((row) => ({
                    ratingKey: String(row.ratingKey),
                    title: String(row.title || ''),
                    year: row.year || null,
                })),
            totalSize: Number(container.totalSize ?? container.size ?? 0) || 0,
        };
    };

    const searchShows = async (query, { limit = 20 } = {}) => {
        const q = String(query || '').trim();
        if (!q) return [];
        const url = new URL(joinUrl(uri, 'hubs', 'search'));
        url.searchParams.set('query', q);
        url.searchParams.set('limit', String(Math.min(50, Math.max(1, limit))));
        url.searchParams.set('includeGuids', '1');
        const data = await fetchJson(url);
        const hubs = asArray(data?.MediaContainer?.Hub);
        const out = [];
        const seen = new Set();
        for (const hub of hubs) {
            for (const meta of asArray(hub?.Metadata)) {
                if (String(meta?.type || '') !== 'show') continue;
                const key = String(meta.ratingKey || '');
                if (!key || seen.has(key)) continue;
                seen.add(key);
                out.push({
                    ratingKey: key,
                    title: String(meta.title || ''),
                    year: meta.year || null,
                    tmdbId: extractTmdbIdFromPlexMeta(meta),
                    tvdbId: extractTvdbIdFromPlexMeta(meta),
                    thumb: meta.thumb || null,
                });
                if (out.length >= limit) return out;
            }
        }
        return out;
    };

    const putEpisodeParams = async (ratingKey, params) => {
        const key = String(ratingKey || '').replace(/\D/g, '');
        if (!key) throw new Error('ratingKey required');
        if (![...params.keys()].length) {
            return { ok: true, skipped: true, reason: 'nothing-to-write' };
        }
        const url = `${joinUrl(uri, 'library', 'metadata', key)}?${params}`;
        const res = await fetchImpl(url, {
            method: 'PUT',
            headers: plexHeaders(plexToken),
        });
        if (!res.ok) {
            const body = await res.text().catch(() => '');
            const err = new Error(`Plex edit HTTP ${res.status}: ${body.slice(0, 200)}`);
            err.status = res.status;
            throw err;
        }
        return { ok: true, ratingKey: key };
    };

    const writeEpisodeFields = async (ratingKey, patch, fields, { lock = true } = {}) => {
        const params = buildPlexEpisodeEditParams({
            ratingKey,
            title: patch.title,
            summary: patch.summary,
            originallyAvailableAt: patch.originallyAvailableAt,
            fields,
            lock,
        });
        if (![...params.keys()].some((k) => k.endsWith('.value'))) {
            return { ok: true, skipped: true, reason: 'nothing-to-write' };
        }
        const result = await putEpisodeParams(ratingKey, params);
        return { ...result, fields };
    };

    const unlockEpisodeFields = async (ratingKey, fields = {
        title: true,
        summary: true,
        originallyAvailableAt: true,
    }) => {
        const params = buildPlexEpisodeUnlockParams({ ratingKey, fields });
        const result = await putEpisodeParams(ratingKey, params);
        return { ...result, fields, unlocked: true };
    };

    return {
        getMetadata,
        findEpisodeByFile,
        findEpisodeByShowEpisode,
        listShowEpisodes,
        listShowEpisodesNeedingFill,
        listTvLibraries,
        listLibraryShows,
        searchShows,
        writeEpisodeFields,
        unlockEpisodeFields,
        extractIdsFromMeta: (meta) => ({
            tmdbId: extractTmdbIdFromPlexMeta(meta),
            tvdbId: extractTvdbIdFromPlexMeta(meta),
            imdbId: extractImdbIdFromPlexMeta(meta),
            seasonNumber: Number(meta?.parentIndex),
            episodeNumber: Number(meta?.index),
            showTitle: String(meta?.grandparentTitle || meta?.title || '').trim(),
        }),
    };
};
