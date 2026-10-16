import type { PosterSetsPreview, PosterSetsSearchTitle } from './types';

export const normalizeRelatedTitle = (value?: string | null) => String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export const inferPreviewMediaType = (
    preview: PosterSetsPreview | null | undefined,
): 'movie' | 'show' => {
    const metaType = String(preview?.setMeta?.mediaType || '').trim().toLowerCase();
    if (metaType === 'show' || metaType === 'tv' || metaType === 'series') return 'show';
    if (metaType === 'movie' || metaType === 'movies') return 'movie';
    const assets = preview?.assets || [];
    if (assets.some((asset) => asset.kind === 'show')) return 'show';
    if ((preview?.shows || 0) > 0) return 'show';
    return 'movie';
};

export const relatedSetKey = (set: { provider?: string | null; setId?: string | null; url?: string | null }) => {
    const setId = set.setId != null ? String(set.setId).trim() : '';
    const provider = String(set.provider || '').trim().toLowerCase();
    if (provider && setId) return `${provider}:${setId}`;
    const url = String(set.url || '').trim().toLowerCase().replace(/\/+$/, '');
    return url || '';
};

export const pickBestRelatedTitle = (
    titles: PosterSetsSearchTitle[],
    wantTitle: string,
    wantYear?: number | null,
) => {
    const want = normalizeRelatedTitle(wantTitle);
    if (!want || !titles.length) return null;
    let best: PosterSetsSearchTitle | null = null;
    let bestScore = 0;
    for (const title of titles) {
        const normalized = normalizeRelatedTitle(title.title);
        if (!normalized) continue;
        let score = 0;
        if (normalized === want) score += 100;
        else if (normalized.includes(want) || want.includes(normalized)) score += 45;
        else continue;
        if (wantYear && title.year && Number(title.year) === Number(wantYear)) score += 25;
        if (score > bestScore) {
            bestScore = score;
            best = title;
        }
    }
    return bestScore >= 45 ? best : null;
};

const TPDB_RECENT_CONTEXT = 'ThePosterDB · Recently added';
const TPDB_FEED_CONTEXT = 'ThePosterDB · Following';

/** Catalogs that belong on TPDB New / Recent, not Discover Search. */
export const isTpdbDiscoverCatalogContext = (context?: string | null) => {
    const value = String(context || '').trim();
    return value === TPDB_RECENT_CONTEXT || value === TPDB_FEED_CONTEXT;
};

/** Search tab shares `searchSets` with TPDB New; never paint that leftover catalog there. */
export const shouldShowSearchSetGrid = ({
    searchMode,
    setCount,
    searchContext,
}: {
    searchMode: string;
    setCount: number;
    searchContext?: string | null;
}) => {
    if (setCount <= 0) return false;
    if (searchMode === 'recent' || searchMode === 'feed') return false;
    if (isTpdbDiscoverCatalogContext(searchContext)) return false;
    return true;
};
