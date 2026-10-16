import type { PosterSetsPreviewAsset } from './types';

export type PreviewAssetKind = 'show_cover' | 'season_cover' | 'background' | 'title_card' | 'poster';

export type PreviewTitleCardSeason = {
    key: string;
    season: number | string;
    label: string;
    assets: PosterSetsPreviewAsset[];
};

export type PreviewAssetSections = {
    covers: PosterSetsPreviewAsset[];
    backgrounds: PosterSetsPreviewAsset[];
    titleCardSeasons: PreviewTitleCardSeason[];
    posters: PosterSetsPreviewAsset[];
    other: PosterSetsPreviewAsset[];
};

const asSeasonNumber = (value: unknown): number | null => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const text = String(value ?? '').trim();
    if (!text || text === 'Cover' || text === 'Backdrop') return null;
    const n = Number(text);
    return Number.isFinite(n) ? n : null;
};

export const classifyPreviewAsset = (asset: PosterSetsPreviewAsset): PreviewAssetKind => {
    // ThePosterDB is posters only — show/season/movie/collection posters, never backdrops or title cards.
    if (isPosterdbPreviewAsset(asset)) {
        if (asset.kind === 'movie' || asset.kind === 'collection') return 'poster';
        const season = asset.season;
        if (season === 'Cover' || season === 'Backdrop' || season == null || season === '') return 'show_cover';
        return 'season_cover';
    }

    const explicit = String(asset.fileType || '').trim().toLowerCase();
    if (explicit === 'backdrop' || explicit === 'background') return 'background';
    if (explicit === 'show_cover' || explicit === 'season_cover' || explicit === 'title_card') {
        return explicit;
    }
    const season = asset.season;
    if (season === 'Backdrop') return 'background';
    if (asset.kind === 'movie' || asset.kind === 'collection') return 'poster';

    const episode = asset.episode;
    if (season === 'Cover') return 'show_cover';
    if (episode === 'Cover' || episode == null || episode === '') return 'season_cover';
    return 'title_card';
};

const isPosterdbPreviewAsset = (asset: PosterSetsPreviewAsset) => {
    const source = String(asset.source || '').toLowerCase();
    if (source === 'posterdb' || source === 'tpdb' || source === 'theposterdb') return true;
    const url = String(asset.thumbUrl || '');
    return /theposterdb\.com/i.test(url);
};

const seasonSortValue = (season: number | string) => {
    if (typeof season === 'number') return season === 0 ? 9990 : season;
    const n = asSeasonNumber(season);
    if (n === 0) return 9990;
    if (n != null) return n;
    return 9999;
};

const seasonSectionLabel = (season: number | string) => {
    if (season === 0 || season === '0') return 'Specials';
    if (typeof season === 'number') return `Season ${season}`;
    const n = asSeasonNumber(season);
    if (n === 0) return 'Specials';
    if (n != null) return `Season ${n}`;
    return String(season || 'Season');
};

const titleCardSort = (a: PosterSetsPreviewAsset, b: PosterSetsPreviewAsset) => {
    const ae = Number(a.episode);
    const be = Number(b.episode);
    if (Number.isFinite(ae) && Number.isFinite(be) && ae !== be) return ae - be;
    return String(a.label || a.title || '').localeCompare(String(b.label || b.title || ''));
};

const coverSort = (a: PosterSetsPreviewAsset, b: PosterSetsPreviewAsset) => {
    const ak = classifyPreviewAsset(a);
    const bk = classifyPreviewAsset(b);
    if (ak === 'show_cover' && bk !== 'show_cover') return -1;
    if (bk === 'show_cover' && ak !== 'show_cover') return 1;
    const as = seasonSortValue(a.season ?? 9999);
    const bs = seasonSortValue(b.season ?? 9999);
    if (as !== bs) return as - bs;
    return String(a.label || '').localeCompare(String(b.label || ''));
};

/** Split preview assets into gallery sections (covers, backgrounds, title cards by season). */
export const groupPreviewAssets = (assets: PosterSetsPreviewAsset[] = []): PreviewAssetSections => {
    const covers: PosterSetsPreviewAsset[] = [];
    const backgrounds: PosterSetsPreviewAsset[] = [];
    const posters: PosterSetsPreviewAsset[] = [];
    const other: PosterSetsPreviewAsset[] = [];
    const titleBySeason = new Map<string, PreviewTitleCardSeason>();

    for (const asset of assets) {
        const kind = classifyPreviewAsset(asset);
        if (kind === 'show_cover' || kind === 'season_cover') {
            covers.push(asset);
            continue;
        }
        if (kind === 'background') {
            backgrounds.push(asset);
            continue;
        }
        if (kind === 'poster') {
            posters.push(asset);
            continue;
        }
        if (kind === 'title_card') {
            const seasonNum = asSeasonNumber(asset.season);
            const seasonKey = seasonNum != null ? String(seasonNum) : String(asset.season ?? 'other');
            const seasonValue: number | string = seasonNum != null ? seasonNum : (asset.season ?? 'other');
            if (!titleBySeason.has(seasonKey)) {
                titleBySeason.set(seasonKey, {
                    key: seasonKey,
                    season: seasonValue,
                    label: seasonSectionLabel(seasonValue),
                    assets: [],
                });
            }
            titleBySeason.get(seasonKey)!.assets.push(asset);
            continue;
        }
        other.push(asset);
    }

    const titleCardSeasons = [...titleBySeason.values()]
        .map((section) => ({
            ...section,
            assets: [...section.assets].sort(titleCardSort),
        }))
        .sort((a, b) => seasonSortValue(a.season) - seasonSortValue(b.season));

    return {
        covers: [...covers].sort(coverSort),
        backgrounds,
        titleCardSeasons,
        posters,
        other,
    };
};

export const previewAssetEpisodeLabel = (asset: PosterSetsPreviewAsset) => {
    const episode = Number(asset.episode);
    if (Number.isFinite(episode)) {
        const season = asSeasonNumber(asset.season);
        if (season != null && season > 0) return `S${season}E${String(episode).padStart(2, '0')}`;
        if (season === 0) return `Specials E${episode}`;
        return `E${episode}`;
    }
    return String(asset.label || asset.title || 'Title card');
};

/** Queue-picker buckets: movie/show posters share “Poster”. */
export type PreviewQueueKind = 'poster' | 'season_cover' | 'background' | 'title_card';

export const PREVIEW_QUEUE_KIND_ORDER: PreviewQueueKind[] = [
    'poster',
    'background',
    'season_cover',
    'title_card',
];

export const canonicalPreviewQueueKind = (kind: PreviewAssetKind): PreviewQueueKind => (
    kind === 'show_cover' ? 'poster' : kind
);

export type InspectorThumbPreview = {
    id: string;
    thumbUrl?: string;
    title: string;
    kind?: PreviewQueueKind;
};

export function inspectorThumbsFromAssets(
    assets: PosterSetsPreviewAsset[],
    imageUrl: (url?: string) => string,
): InspectorThumbPreview[] {
    return assets.map((asset) => ({
        id: asset.id,
        title: asset.title,
        thumbUrl: imageUrl(asset.thumbUrl),
        kind: canonicalPreviewQueueKind(classifyPreviewAsset(asset)),
    }));
}

const INSPECTOR_THUMB_GROUPS: Array<{
    id: string;
    label: string;
    layout: 'poster' | 'landscape';
    kinds: PreviewQueueKind[];
}> = [
    { id: 'posters', label: 'Posters', layout: 'poster', kinds: ['poster', 'season_cover'] },
    { id: 'backdrops', label: 'Backdrops', layout: 'landscape', kinds: ['background'] },
    { id: 'title_cards', label: 'Title cards', layout: 'landscape', kinds: ['title_card'] },
];

export type InspectorThumbGroup = {
    id: string;
    label: string;
    layout: 'poster' | 'landscape';
    thumbs: InspectorThumbPreview[];
};

/** Split inspector preview thumbs so posters and title cards never share a row. */
export function groupInspectorThumbs(
    thumbs: InspectorThumbPreview[],
    fallbackLayout: 'poster' | 'landscape' = 'poster',
): InspectorThumbGroup[] {
    if (!thumbs.length) return [];
    const hasKinds = thumbs.some((thumb) => thumb.kind);
    if (!hasKinds) {
        return [{
            id: 'preview',
            label: 'Preview',
            layout: fallbackLayout,
            thumbs,
        }];
    }
    const known = new Set(INSPECTOR_THUMB_GROUPS.flatMap((group) => group.kinds));
    const groups = INSPECTOR_THUMB_GROUPS
        .map((group) => ({
            id: group.id,
            label: group.label,
            layout: group.layout,
            thumbs: thumbs.filter((thumb) => thumb.kind && group.kinds.includes(thumb.kind)),
        }))
        .filter((group) => group.thumbs.length > 0);
    const leftover = thumbs.filter((thumb) => !thumb.kind || !known.has(thumb.kind));
    if (leftover.length) {
        groups.push({
            id: 'other',
            label: 'Other',
            layout: fallbackLayout,
            thumbs: leftover,
        });
    }
    return groups;
}

export const previewQueueKindLabel = (kind: PreviewQueueKind): string => {
    switch (kind) {
        case 'poster': return 'Poster';
        case 'background': return 'Backdrop';
        case 'season_cover': return 'Season poster';
        case 'title_card': return 'Title cards';
        default: return kind;
    }
};

export type PreviewQueueKindOption = {
    id: PreviewQueueKind;
    label: string;
    count: number;
    matched: number;
};

export const previewQueueKindOptions = (assets: PosterSetsPreviewAsset[] = []): PreviewQueueKindOption[] => {
    const stats = new Map<PreviewQueueKind, { count: number; matched: number }>();
    for (const asset of assets) {
        const kind = canonicalPreviewQueueKind(classifyPreviewAsset(asset));
        const entry = stats.get(kind) || { count: 0, matched: 0 };
        entry.count += 1;
        if (asset.matched === true) entry.matched += 1;
        stats.set(kind, entry);
    }
    return PREVIEW_QUEUE_KIND_ORDER
        .filter((id) => (stats.get(id)?.count || 0) > 0)
        .map((id) => ({
            id,
            label: previewQueueKindLabel(id),
            count: stats.get(id)!.count,
            matched: stats.get(id)!.matched,
        }));
};

export const previewAssetsKey = (assets: PosterSetsPreviewAsset[] = []) => (
    assets.map((asset) => asset.id).join('|')
);

/**
 * IDs to queue for checked art types.
 * If a type has matched Plex items, only those are queued; otherwise all assets of that type.
 */
export const assetIdsForQueueKinds = (
    assets: PosterSetsPreviewAsset[] = [],
    kinds: Iterable<PreviewQueueKind>,
    preferMatched = true,
): string[] => {
    const kindSet = kinds instanceof Set ? kinds : new Set(kinds);
    if (!kindSet.size) return [];
    const ids: string[] = [];
    for (const kind of PREVIEW_QUEUE_KIND_ORDER) {
        if (!kindSet.has(kind)) continue;
        const ofKind = assets.filter((asset) => canonicalPreviewQueueKind(classifyPreviewAsset(asset)) === kind);
        if (!ofKind.length) continue;
        const matched = ofKind.filter((asset) => asset.matched === true);
        if (preferMatched && matched.length) ids.push(...matched.map((asset) => asset.id));
        else ids.push(...ofKind.map((asset) => asset.id));
    }
    return ids;
};
