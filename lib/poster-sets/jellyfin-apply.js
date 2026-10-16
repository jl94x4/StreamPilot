/**
 * Apply Poster Sets artwork to Jellyfin / Emby via the Images API.
 */
import fetch from 'node-fetch';
import { runPosterSetsCli } from './runner.js';
import { loadPosterSetsConfig } from './config.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const resolveBaseUrl = (rawUrl) => String(rawUrl || '').trim().replace(/\/+$/, '');

const apiHeaders = (token, extra = {}) => ({
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'X-Emby-Token': String(token || '').trim(),
    ...extra,
});

const resolveJellyfinLikeConfig = (portalConfig = {}, destination = 'jellyfin') => {
    const dest = String(destination || 'jellyfin').toLowerCase();
    const isEmby = dest === 'emby';
    const url = isEmby
        ? String(portalConfig.embyUrl || portalConfig.jellyfinUrl || '').trim()
        : String(portalConfig.jellyfinUrl || '').trim();
    const apiKey = isEmby
        ? String(portalConfig.embyApiKey || portalConfig.jellyfinApiKey || '').trim()
        : String(portalConfig.jellyfinApiKey || '').trim();
    if (!url || !apiKey) {
        const label = isEmby ? 'Emby' : 'Jellyfin';
        throw new Error(`${label} URL and API key are required under Settings → Media Player.`);
    }
    return { baseUrl: resolveBaseUrl(url), apiKey, type: isEmby ? 'emby' : 'jellyfin' };
};

const downloadImage = async (url) => {
    const target = String(url || '').trim();
    if (!target) return null;
    try {
        if (/theposterdb\.com/i.test(target)) {
            const { loadTpdbCachedImage } = await import('./tpdbCache.js');
            const cached = await loadTpdbCachedImage(target);
            if (cached?.buf?.length) {
                return { buf: cached.buf, contentType: cached.contentType || 'image/jpeg' };
            }
        }
    } catch {
        // cache is best-effort
    }
    const res = await fetch(target, {
        headers: {
            Accept: 'image/jpeg,image/png,image/webp;q=0.9,image/*;q=0.8,*/*;q=0.7',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            Referer: /theposterdb\.com/i.test(target) ? 'https://theposterdb.com/' : 'https://mediux.pro/',
        },
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) return null;
    const contentType = String(res.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
    return { buf, contentType };
};

const searchItems = async ({ baseUrl, apiKey, term, includeTypes, parentId, limit = 12 }) => {
    const params = new URLSearchParams({
        SearchTerm: String(term || '').trim(),
        Recursive: 'true',
        Limit: String(limit),
    });
    if (includeTypes?.length) params.set('IncludeItemTypes', includeTypes.join(','));
    if (parentId) params.set('ParentId', String(parentId));
    const res = await fetch(`${baseUrl}/Items?${params.toString()}`, {
        headers: apiHeaders(apiKey),
    });
    if (!res.ok) throw new Error(`Library search failed (HTTP ${res.status})`);
    const data = await res.json();
    return Array.isArray(data?.Items) ? data.Items : [];
};

const normalizeTitleKey = (value = '') => String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\(\s*(?:\d{4}|n\/a)\s*\)\s*$/i, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const titlesExactlyMatch = (left, right) => {
    const a = normalizeTitleKey(left);
    const b = normalizeTitleKey(right);
    if (!a || !b) return false;
    if (a === b) return true;
    const stripArticle = (tokens) => (
        tokens.length > 1 && ['the', 'a', 'an'].includes(tokens[0]) ? tokens.slice(1) : tokens
    );
    const leftTokens = stripArticle(a.split(' ').filter(Boolean));
    const rightTokens = stripArticle(b.split(' ').filter(Boolean));
    return leftTokens.length > 0 && leftTokens.join(' ') === rightTokens.join(' ');
};

const pickBestItem = (items, { year, type, title }) => {
    const list = Array.isArray(items) ? items : [];
    if (!list.length) return null;
    const exact = list.filter((item) => titlesExactlyMatch(title, item?.Name || item?.OriginalTitle || ''));
    const pool = exact.length ? exact : [];
    // Never fall back to fuzzy substring hits — that applied "Sisters" onto Barbie & Her Sisters.
    if (!pool.length) return null;
    const wantedYear = Number(year);
    if (Number.isFinite(wantedYear)) {
        const byYear = pool.find((item) => Number(item.ProductionYear) === wantedYear);
        if (byYear) return byYear;
    }
    if (type === 'movie') {
        return pool.find((item) => item.Type === 'Movie') || pool[0];
    }
    if (type === 'show') {
        return pool.find((item) => item.Type === 'Series') || pool[0];
    }
    return pool[0];
};

const findSeriesItem = async (ctx, asset) => {
    const items = await searchItems({
        ...ctx,
        term: asset.title,
        includeTypes: ['Series'],
    });
    return pickBestItem(items, { year: asset.year, type: 'show', title: asset.title });
};

const findMovieItem = async (ctx, asset) => {
    const items = await searchItems({
        ...ctx,
        term: asset.title,
        includeTypes: ['Movie'],
    });
    return pickBestItem(items, { year: asset.year, type: 'movie', title: asset.title });
};

const findSeasonItem = async (ctx, seriesId, seasonNumber) => {
    const season = Number(seasonNumber);
    if (!seriesId || !Number.isFinite(season)) return null;
    const items = await searchItems({
        ...ctx,
        term: '',
        includeTypes: ['Season'],
        parentId: seriesId,
        limit: 40,
    });
    return items.find((item) => Number(item.IndexNumber) === season) || null;
};

const findEpisodeItem = async (ctx, seriesId, seasonNumber, episodeNumber) => {
    const season = Number(seasonNumber);
    const episode = Number(episodeNumber);
    if (!seriesId || !Number.isFinite(season) || !Number.isFinite(episode)) return null;
    const seasonItem = await findSeasonItem(ctx, seriesId, season);
    const parentId = seasonItem?.Id || seriesId;
    const items = await searchItems({
        ...ctx,
        term: '',
        includeTypes: ['Episode'],
        parentId,
        limit: 80,
    });
    return items.find((item) => (
        Number(item.ParentIndexNumber) === season && Number(item.IndexNumber) === episode
    )) || null;
};

const uploadImage = async ({ baseUrl, apiKey }, itemId, imageType, image) => {
    const res = await fetch(`${baseUrl}/Items/${encodeURIComponent(itemId)}/Images/${imageType}`, {
        method: 'POST',
        headers: apiHeaders(apiKey, {
            'Content-Type': image.contentType || 'image/jpeg',
        }),
        body: image.buf,
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Image upload failed (HTTP ${res.status})${text ? `: ${text.slice(0, 120)}` : ''}`);
    }
};

const resolveTargetForAsset = async (ctx, asset) => {
    const kind = String(asset.kind || '').toLowerCase();
    const season = asset.season;
    const episode = asset.episode;
    const fileType = String(asset.fileType || asset.file_type || '').trim();

    if (kind === 'movie') {
        const movie = await findMovieItem(ctx, asset);
        if (!movie) return null;
        const isBackdrop = season === 'Backdrop' || fileType === 'background' || fileType === 'backdrop';
        return { itemId: movie.Id, imageType: isBackdrop ? 'Backdrop' : 'Primary' };
    }

    const series = await findSeriesItem(ctx, asset);
    if (!series) return null;

    if (season === 'Backdrop' || fileType === 'background' || fileType === 'backdrop') {
        return { itemId: series.Id, imageType: 'Backdrop' };
    }
    if (season === 'Cover' || fileType === 'show_cover') {
        return { itemId: series.Id, imageType: 'Primary' };
    }
    if (season === 0 || season === '0') {
        const epNum = episode === 'Cover' || episode == null ? null : Number(episode);
        if (epNum == null) {
            const specials = await findSeasonItem(ctx, series.Id, 0);
            return { itemId: specials?.Id || series.Id, imageType: 'Primary' };
        }
        const ep = await findEpisodeItem(ctx, series.Id, 0, epNum);
        return ep ? { itemId: ep.Id, imageType: 'Primary' } : null;
    }
    if (Number.isFinite(Number(season))) {
        const seasonNum = Number(season);
        if (episode === 'Cover' || episode == null || episode === '') {
            const seasonItem = await findSeasonItem(ctx, series.Id, seasonNum);
            return seasonItem
                ? { itemId: seasonItem.Id, imageType: 'Primary' }
                : { itemId: series.Id, imageType: 'Primary' };
        }
        const ep = await findEpisodeItem(ctx, series.Id, seasonNum, Number(episode));
        return ep ? { itemId: ep.Id, imageType: 'Primary' } : null;
    }

    return { itemId: series.Id, imageType: 'Primary' };
};

const previewAssets = async (url, config, mediuxFilters, onProgress) => {
    const previewConfig = { ...config };
    if (Array.isArray(mediuxFilters) && mediuxFilters.length) {
        previewConfig.mediux_filters = mediuxFilters;
    }
    const run = await runPosterSetsCli('preview', {
        config: previewConfig,
        url,
        mediuxFilters,
    }, {
        timeoutMs: 180_000,
        onProgress: (message) => {
            if (typeof onProgress === 'function') onProgress(message);
        },
    });
    if (!run.ok) {
        const error = new Error(run.error || 'Failed to scrape poster set');
        error.logs = run.logs;
        throw error;
    }
    return run.result || {};
};

export const applyPosterSetToJellyfinLike = async ({
    portalConfig,
    config: inputConfig,
    url,
    selectedIds = null,
    mediuxFilters = null,
    destination = 'jellyfin',
    onProgress,
} = {}) => {
    const targetUrl = String(url || '').trim();
    if (!targetUrl) throw new Error('url is required');

    const ctx = resolveJellyfinLikeConfig(portalConfig, destination);
    const config = inputConfig || await loadPosterSetsConfig();
    const preview = await previewAssets(targetUrl, config, mediuxFilters, onProgress);
    const wanted = Array.isArray(selectedIds)
        ? new Set(selectedIds.map((id) => String(id || '').trim()).filter(Boolean))
        : null;
    const assets = (Array.isArray(preview.assets) ? preview.assets : [])
        .filter((asset) => !wanted || wanted.has(String(asset.id || '')));

    if (!assets.length) {
        return {
            ok: false,
            url: targetUrl,
            uploaded: 0,
            attempted: 0,
            selected: wanted ? wanted.size : null,
            destination: ctx.type,
            setMeta: preview.setMeta || null,
            results: [],
            error: wanted?.size
                ? 'None of the selected assets were found when re-scraping the set — nothing was applied.'
                : 'No posters were found to apply from this set.',
        };
    }

    const results = [];
    let uploaded = 0;
    for (const asset of assets) {
        const imageUrl = String(asset.thumbUrl || '').trim();
        const label = asset.label || asset.title || asset.id;
        if (!imageUrl) {
            results.push({ id: asset.id, ok: false, message: `${label}: missing image URL` });
            continue;
        }
        try {
            const target = await resolveTargetForAsset(ctx, asset);
            if (!target?.itemId) {
                results.push({ id: asset.id, ok: false, message: `${label}: no matching library item` });
                continue;
            }
            const image = await downloadImage(imageUrl);
            if (!image) {
                results.push({ id: asset.id, ok: false, message: `${label}: could not download image` });
                continue;
            }
            await uploadImage(ctx, target.itemId, target.imageType, image);
            uploaded += 1;
            results.push({
                id: asset.id,
                ok: true,
                message: `${label}: uploaded to ${ctx.type}`,
                itemId: target.itemId,
                imageType: target.imageType,
            });
            if (typeof onProgress === 'function') onProgress(`${label}: uploaded`);
            if (String(asset.source || '').toLowerCase() === 'posterdb') await sleep(4000);
            else await sleep(800);
        } catch (error) {
            results.push({
                id: asset.id,
                ok: false,
                message: `${label}: ${error?.message || error}`,
            });
        }
    }

    return {
        ok: uploaded > 0,
        url: targetUrl,
        uploaded,
        attempted: results.length,
        selected: wanted ? wanted.size : null,
        destination: ctx.type,
        setMeta: preview.setMeta || null,
        results,
        error: uploaded > 0 ? null : `Applied 0 of ${results.length} poster(s) — nothing changed.`,
    };
};
