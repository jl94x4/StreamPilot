export type TpdbCoverageLevel = 'none' | 'title' | 'sets' | 'images';

export const formatTpdbEta = (etaMs?: number | null) => {
    if (etaMs == null || !Number.isFinite(etaMs) || etaMs < 0) return null;
    const totalSec = Math.max(1, Math.round(etaMs / 1000));
    if (totalSec < 60) return `~${totalSec}s`;
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    if (mins < 60) return secs ? `~${mins}m ${secs}s` : `~${mins}m`;
    const hours = Math.floor(mins / 60);
    const remMins = mins % 60;
    return remMins ? `~${hours}h ${remMins}m` : `~${hours}h`;
};

export const coverageKeyForItem = (item: {
    tmdbId?: string | number | null;
    tvdbId?: string | number | null;
    mediaType?: string | null;
}) => coverageKeysForItem(item)[0] || null;

/** All coverage keys for a library row (TMDB and/or TVDB). */
export const coverageKeysForItem = (item: {
    tmdbId?: string | number | null;
    tvdbId?: string | number | null;
    mediaType?: string | null;
}) => {
    const mediaType = (() => {
        const raw = String(item?.mediaType || 'movie').toLowerCase();
        if (raw === 'show' || raw === 'tv' || raw === 'series') return 'show';
        return 'movie';
    })();
    const keys: string[] = [];
    const tmdbId = String(item?.tmdbId || '').trim();
    if (/^\d+$/.test(tmdbId)) keys.push(`${mediaType}:${tmdbId}`);
    const tvdbId = String(item?.tvdbId || '').trim();
    if (/^\d+$/.test(tvdbId)) keys.push(`tvdb:${mediaType}:${tvdbId}`);
    return keys;
};

export const coverageBadgeLabel = (level?: string | null) => {
    if (level === 'images') return 'Images';
    if (level === 'sets') return 'Sets';
    if (level === 'title') return 'Cached';
    return null;
};

export const coverageBadgeClass = (level?: string | null) => {
    if (level === 'images') return 'border-emerald-400/40 bg-emerald-500/25 text-emerald-100';
    if (level === 'sets') return 'border-sky-400/40 bg-sky-500/20 text-sky-100';
    if (level === 'title') return 'border-amber-400/35 bg-amber-500/15 text-amber-100';
    return 'border-white/15 bg-black/55 text-muted';
};
