/**
 * Match Poster Sets audit + watches to a library title.
 */
import { listPosterSetsAudit } from './audit.js';
import { loadPosterSetsHistory } from './history.js';
import { isCollectionSet } from './searchMerge.js';
import { loadTpdbSetCache } from './tpdbCache.js';
import {
    findWatchesForLibraryTitle,
    libraryHintsFromAssets,
    resolvePrimaryTitleWatch,
    summarizeTitleWatch,
} from './title-watch.js';
import { listPosterSetsWatches, mergeLibraryHints } from './watches.js';

const stripDiacritics = (value) =>
    String(value || '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '');

export const normalizeTitleMatchKey = (value) => {
    let text = stripDiacritics(value).toLowerCase().trim();
    text = text.replace(/\(\s*(?:\d{4}|n\/a)\s*\)\s*$/i, '');
    text = text.replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
    return text;
};

const COLLECTION_TITLE_KEY_RE = /\b(collection|boxset|box set|boxsets)\b/;

const titleMatches = (left, right) => {
    const a = normalizeTitleMatchKey(left);
    const b = normalizeTitleMatchKey(right);
    if (!a || !b) return false;
    if (a === b) return true;
    return a.startsWith(b) || b.startsWith(a);
};

const historyUrl = (job) => String(job?.input?.url || job?.input?.setMeta?.url || '').trim();

export const enrichWatchesWithHistoryHints = (watches, history) => {
    const historyByUrl = new Map();
    for (const job of Array.isArray(history) ? history : []) {
        const url = historyUrl(job);
        if (!url) continue;
        const list = historyByUrl.get(url) || [];
        list.push(job);
        historyByUrl.set(url, list);
    }
    return (Array.isArray(watches) ? watches : []).map((watch) => {
        const extras = [];
        for (const job of historyByUrl.get(String(watch.url || '').trim()) || []) {
            extras.push(...libraryHintsFromAssets(job.input?.selectedAssets));
        }
        if (!extras.length) return watch;
        return { ...watch, libraryHints: mergeLibraryHints(watch.libraryHints, extras) };
    });
};

export const watchingIndexFromWatches = (watches = []) => {
    const ratingKeys = new Set();
    const titleKeys = new Set();
    const tmdbIds = new Set();

    const addTitleKey = (value) => {
        const key = normalizeTitleMatchKey(value);
        if (key) titleKeys.add(key);
    };
    const addHint = (hint) => {
        if (!hint) return;
        addTitleKey(hint.title);
        const ratingKey = String(hint.ratingKey || '').trim();
        if (ratingKey) ratingKeys.add(ratingKey);
        const tmdb = String(hint.tmdbId || '').trim();
        if (tmdb && tmdb !== '0') tmdbIds.add(tmdb);
    };

    for (const watch of Array.isArray(watches) ? watches : []) {
        if (watch.enabled === false) continue;
        addTitleKey(watch.title);
        addTitleKey(watch.plexHint?.title);
        const ratingKey = String(watch.plexHint?.ratingKey || '').trim();
        if (ratingKey) ratingKeys.add(ratingKey);
        if (!isCollectionSet(watch)) {
            const tmdb = String(watch.tmdbId || '').trim();
            if (tmdb && tmdb !== '0') tmdbIds.add(tmdb);
        }
        for (const hint of Array.isArray(watch.libraryHints) ? watch.libraryHints : []) addHint(hint);
    }

    return {
        ratingKeys: [...ratingKeys],
        titleKeys: [...titleKeys],
        tmdbIds: [...tmdbIds],
    };
};

export const libraryTitleMatchesWatchingIndex = (index, { ratingKey, title, tmdbId } = {}) => {
    const ratingKeys = index?.ratingKeys instanceof Set ? index.ratingKeys : new Set(index?.ratingKeys || []);
    const titleKeys = index?.titleKeys instanceof Set ? index.titleKeys : new Set(index?.titleKeys || []);
    const tmdbIds = index?.tmdbIds instanceof Set ? index.tmdbIds : new Set(index?.tmdbIds || []);
    const key = String(ratingKey || '').trim();
    if (key && ratingKeys.has(key)) return true;
    const tmdb = String(tmdbId || '').trim();
    if (tmdb && tmdb !== '0' && tmdbIds.has(tmdb)) return true;
    const needle = normalizeTitleMatchKey(title);
    if (!needle) return false;
    if (titleKeys.has(needle)) return true;
    for (const stored of titleKeys) {
        if (!COLLECTION_TITLE_KEY_RE.test(stored)) continue;
        if (stored.startsWith(needle) || needle.startsWith(stored)) return true;
    }
    return false;
};

export const resolvePosterSetsTitleStatus = async ({
    title,
    mediaType = '',
    ratingKey = '',
    tmdbId = '',
    auditLimit = 200,
    watchLimit = 200,
} = {}) => {
    const needle = String(title || '').trim();
    const type = String(mediaType || '').toLowerCase();
    const key = String(ratingKey || '').trim();
    const tmdb = String(tmdbId || '').trim();

    const [auditEntries, watches, history] = await Promise.all([
        listPosterSetsAudit(auditLimit),
        listPosterSetsWatches(),
        loadPosterSetsHistory().catch(() => []),
    ]);
    const matchedWatches = enrichWatchesWithHistoryHints(watches, history);

    const matchingAudit = auditEntries.filter((entry) => {
        if (!needle) return false;
        if (!titleMatches(entry.title, needle)) return false;
        const state = String(entry.state || '').toLowerCase();
        if (state && !['succeeded', 'completed', 'success'].includes(state)) return false;
        return true;
    });

    const lastApply = matchingAudit.find((entry) => (
        ['apply', 'watch_apply'].includes(String(entry.action || '').toLowerCase())
    )) || matchingAudit[0] || null;

    const matchingWatches = findWatchesForLibraryTitle(matchedWatches, {
        ratingKey: key,
        title: needle,
        tmdbId: tmdb,
    });
    const titleMatchedWatches = matchingWatches.length
        ? matchingWatches
        : matchedWatches.filter((watch) => needle && watch.title && titleMatches(watch.title, needle));

    const activeWatches = titleMatchedWatches.filter((watch) => watch.enabled !== false);
    const primaryWatch = resolvePrimaryTitleWatch(matchedWatches, {
        ratingKey: key,
        title: needle,
        tmdbId: tmdb,
        preferredUrl: lastApply?.url || null,
    });

    return {
        title: needle,
        mediaType: type || null,
        ratingKey: key || null,
        titleWatch: summarizeTitleWatch(primaryWatch),
        lastApply: lastApply ? {
            at: lastApply.at || null,
            title: lastApply.title || null,
            url: lastApply.url || null,
            user: lastApply.user || null,
            uploaded: lastApply.uploaded ?? null,
            attempted: lastApply.attempted ?? null,
            source: lastApply.source || null,
            jobId: lastApply.jobId || null,
        } : null,
        watches: titleMatchedWatches.map((watch) => ({
            id: watch.id,
            enabled: watch.enabled !== false,
            title: watch.title || null,
            url: watch.url || null,
            user: watch.user || null,
            provider: watch.provider || null,
            lastAppliedAt: watch.lastAppliedAt || null,
            lastCheckedAt: watch.lastCheckedAt || null,
            lastError: watch.lastError || null,
            plexHint: watch.plexHint || null,
        })),
        watchingCount: activeWatches.length,
    };
};

export const buildPosterSetsWatchingIndex = async () => {
    const [watches, history] = await Promise.all([
        listPosterSetsWatches(),
        loadPosterSetsHistory().catch(() => []),
    ]);
    const enriched = enrichWatchesWithHistoryHints(watches, history);
    let tpdbLookups = 0;
    const withCacheHints = [];
    for (const watch of enriched) {
        if (watch.enabled === false) {
            withCacheHints.push(watch);
            continue;
        }
        const hasHints = Array.isArray(watch.libraryHints) && watch.libraryHints.length;
        if (!hasHints && watch.provider === 'posterdb' && isCollectionSet(watch) && tpdbLookups < 40) {
            tpdbLookups += 1;
            try {
                const cached = await loadTpdbSetCache(watch.setId || watch.url);
                const extra = libraryHintsFromAssets(cached?.assets);
                withCacheHints.push(extra.length
                    ? { ...watch, libraryHints: mergeLibraryHints(watch.libraryHints, extra) }
                    : watch);
                continue;
            } catch {
                /* cache miss is fine */
            }
        }
        withCacheHints.push(watch);
    }
    return watchingIndexFromWatches(withCacheHints);
};
