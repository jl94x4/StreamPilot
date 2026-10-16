/**
 * Title-level watch toggle — link a library title to a pinned poster set.
 */
import {
    listPosterSetsWatches,
    patchPosterSetsWatch,
    upsertPosterSetsWatch,
    replaceSameTitleWatches,
} from './watches.js';
import { setKindFromFilters } from './watchTitle.js';
import { normalizeTitleMatchKey } from './title-status.js';

export const buildPlexHint = ({ ratingKey, title, mediaType } = {}) => {
    const key = String(ratingKey || '').trim();
    const label = String(title || '').trim();
    const type = String(mediaType || '').trim().toLowerCase();
    if (!key && !label) return null;
    return {
        ratingKey: key || null,
        title: label || null,
        mediaType: type === 'movie' || type === 'show' ? type : null,
    };
};

const hintRatingKey = (watch) => String(watch?.plexHint?.ratingKey || '').trim();

const hintList = (watch) => (Array.isArray(watch?.libraryHints) ? watch.libraryHints : []);

export const libraryHintsFromAssets = (assets = []) => {
    const out = [];
    const seen = new Set();
    for (const asset of Array.isArray(assets) ? assets : []) {
        const title = String(asset?.title || asset?.label || '').trim() || null;
        const tmdbId = String(asset?.tmdbId || asset?.tmdb_id || '').trim();
        const id = tmdbId && tmdbId !== '0' ? tmdbId : '';
        const ratingKey = String(asset?.ratingKey || asset?.rating_key || '').trim() || null;
        const media = String(asset?.mediaType || asset?.type || '').trim().toLowerCase();
        if (!title && !id && !ratingKey) continue;
        const key = `${ratingKey || ''}|${id}|${normalizeTitleMatchKey(title || '')}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
            ratingKey,
            title,
            tmdbId: id || null,
            mediaType: media === 'movie' || media === 'show' ? media : null,
        });
        if (out.length >= 80) break;
    }
    return out;
};

const titleMatchesWatch = (needle, watch) => {
    const key = normalizeTitleMatchKey(needle);
    if (!key) return false;
    const hintTitle = watch?.plexHint?.title || watch?.title;
    if (hintTitle && normalizeTitleMatchKey(hintTitle) === key) return true;
    if (watch?.title && normalizeTitleMatchKey(watch.title) === key) return true;
    return hintList(watch).some((row) => row?.title && normalizeTitleMatchKey(row.title) === key);
};

export const watchMatchesLibraryTitle = (watch, { ratingKey, title, tmdbId } = {}) => {
    if (!watch) return false;
    const key = String(ratingKey || '').trim();
    if (key) {
        if (hintRatingKey(watch) === key) return true;
        if (hintList(watch).some((row) => String(row?.ratingKey || '').trim() === key)) return true;
    }
    const tmdb = String(tmdbId || '').trim();
    if (tmdb && tmdb !== '0') {
        if (hintList(watch).some((row) => String(row?.tmdbId || '').trim() === tmdb)) return true;
        const watchTmdb = String(watch.tmdbId || '').trim();
        const kind = String(watch.setKind || '').trim().toLowerCase();
        const collection = kind === 'collection' || kind === 'collections' || kind === 'boxset' || kind === 'boxsets';
        if (!collection && watchTmdb && watchTmdb === tmdb) return true;
    }
    if (title && titleMatchesWatch(title, watch)) return true;
    return false;
};

export const findWatchesForLibraryTitle = (watches, { ratingKey, title, tmdbId } = {}) => {
    const list = Array.isArray(watches) ? watches : [];
    return list.filter((watch) => watchMatchesLibraryTitle(watch, { ratingKey, title, tmdbId }));
};

export const resolvePrimaryTitleWatch = (watches, { ratingKey, title, tmdbId, preferredUrl } = {}) => {
    const matches = findWatchesForLibraryTitle(watches, { ratingKey, title, tmdbId });
    if (!matches.length) return null;
    const url = String(preferredUrl || '').trim();
    if (url) {
        const byUrl = matches.find((watch) => String(watch.url || '').trim() === url);
        if (byUrl) return byUrl;
    }
    const enabled = matches.filter((watch) => watch.enabled !== false);
    const pool = enabled.length ? enabled : matches;
    return pool.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))[0];
};

export const summarizeTitleWatch = (watch) => {
    if (!watch) {
        return { enabled: false, watchId: null, url: null, setTitle: null, user: null };
    }
    return {
        enabled: watch.enabled !== false,
        watchId: watch.id,
        url: watch.url || null,
        setTitle: watch.title || null,
        user: watch.user || null,
    };
};

export const togglePosterSetsTitleWatch = async ({
    ratingKey,
    title,
    mediaType,
    setUrl,
    enabled,
    setMeta,
    lastApplyUrl,
} = {}) => {
    const label = String(title || '').trim();
    if (!label) {
        const error = new Error('title is required');
        error.status = 400;
        throw error;
    }

    const watches = await listPosterSetsWatches();
    const plexHint = buildPlexHint({ ratingKey, title: label, mediaType });
    const existing = resolvePrimaryTitleWatch(watches, {
        ratingKey,
        title: label,
        preferredUrl: setUrl || lastApplyUrl,
    });

    const turningOn = enabled === undefined
        ? !(existing?.enabled !== false)
        : Boolean(enabled);

    if (!turningOn) {
        const targets = findWatchesForLibraryTitle(watches, { ratingKey, title: label })
            .filter((watch) => watch.enabled !== false);
        if (!targets.length && existing) targets.push(existing);
        let last = null;
        for (const watch of targets) {
            last = await patchPosterSetsWatch(watch.id, { enabled: false });
        }
        return {
            enabled: false,
            watch: last,
            titleWatch: summarizeTitleWatch(last),
        };
    }

    const url = String(setUrl || lastApplyUrl || existing?.url || '').trim();
    if (!url) {
        const error = new Error('Apply a poster set first, or pick a set to watch.');
        error.status = 400;
        throw error;
    }

    const sameUrl = watches.find((watch) => String(watch.url || '').trim() === url);
    const watchFilters = setMeta?.mediuxFilters || sameUrl?.mediuxFilters;
    const watch = await upsertPosterSetsWatch({
        url,
        id: sameUrl?.id,
        enabled: true,
        title: setMeta?.title || sameUrl?.title || existing?.title || label,
        user: setMeta?.user || sameUrl?.user || existing?.user || null,
        provider: setMeta?.provider || sameUrl?.provider || existing?.provider,
        setId: setMeta?.setId ?? sameUrl?.setId ?? existing?.setId,
        tmdbId: setMeta?.tmdbId ?? sameUrl?.tmdbId ?? existing?.tmdbId,
        tvdbId: setMeta?.tvdbId ?? sameUrl?.tvdbId ?? existing?.tvdbId,
        thumbUrl: setMeta?.thumbUrl || sameUrl?.thumbUrl || existing?.thumbUrl || '',
        setKind: setKindFromFilters(watchFilters) || setMeta?.setKind || sameUrl?.setKind || null,
        mediuxFilters: watchFilters,
        plexHint,
    });
    try { await replaceSameTitleWatches(watch); } catch { /* keep the new pin */ }

    return {
        enabled: true,
        watch,
        titleWatch: summarizeTitleWatch(watch),
    };
};
