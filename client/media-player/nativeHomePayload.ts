import type { PlayerItem } from './types';
import { lanImageOrigin } from './lanImage';
import { readPlayerSettings } from './playerSettings';
import { hideEpisodeSpoilers } from './spoilers';
import {
    heroRailCardImageUrl,
    playerItemBackdropUrl,
    PLAYER_POSTER_QUALITY,
    plexImageUrl,
    progressPercent,
    resizePlexArtUrl,
    resolvePlayerCardAspect,
} from './playerUtils';

/** The part of a Home row the native view needs (structurally a TvHomeRow). */
export type NativeHomeSourceRow = {
    id: string;
    title: string;
    items: PlayerItem[];
    aspect: '2/3' | '16/9' | 'square';
    onViewAll?: unknown;
};

const MAX_ITEMS_PER_ROW = 40;

export const nativeAbsoluteUrl = (url: string) => {
    const value = lanImageOrigin(String(url || '').trim());
    if (!value) return '';
    try {
        return new URL(value, window.location.href).href;
    } catch {
        return value;
    }
};

/** Same artwork choice as PlayerPosterCard, so native cards match the web ones. */
export const nativeCardImage = (item: PlayerItem, aspect: '2/3' | '16/9' | 'square') => {
    const resolved = resolvePlayerCardAspect(item, aspect);
    const artWidth = resolved === '16/9' ? 426 : 300;
    const artHeight = resolved === 'square' ? 300 : resolved === '16/9' ? 240 : 450;
    const landscapeEpisode = item.type === 'episode' && resolved === '16/9';
    const episodeKey = landscapeEpisode ? String(item.ratingKey || '').replace(/\D/g, '') : '';
    const rawThumb = String(item.episodeThumb || item.thumb || '').trim();
    const thumbOwner = rawThumb.match(/\/library\/metadata\/(\d+)\//)?.[1] || '';
    const episodeStill = episodeKey
        ? ((thumbOwner === episodeKey || (/^https?:\/\//i.test(rawThumb) && !/\/library\/metadata\//.test(rawThumb)))
            ? rawThumb
            : `/library/metadata/${episodeKey}/thumb`)
        : '';
    const source = item.heroCard
        ? (item.heroArt || item.art || item.thumb)
        : (episodeStill || item.thumb);
    if (!source) return '';
    if (item.heroCard) return nativeAbsoluteUrl(heroRailCardImageUrl(source));
    if (landscapeEpisode && String(episodeStill).startsWith('/library/')) {
        return nativeAbsoluteUrl(plexImageUrl(episodeStill, artWidth, artHeight, { quality: PLAYER_POSTER_QUALITY }));
    }
    return nativeAbsoluteUrl(resizePlexArtUrl(source, artWidth, artHeight, PLAYER_POSTER_QUALITY));
};

/**
 * Rows for the native Home. Only what the native side draws: poster, backdrop, watch bar. The
 * billboard text, logos, sidebar and clock stay web and are driven by the focus events.
 */
export const buildNativeHomePayload = (
    rows: NativeHomeSourceRow[],
    surfaceRgb: string,
    accentRgb: string,
    viewMoreLabel = 'View More',
    tickPosition = 'bottom-left',
    fresh = false,
) => {
    const spoilerSettings = readPlayerSettings();
    return JSON.stringify({
    fresh,
    surface: surfaceRgb,
    accent: accentRgb,
    // "Coloured fade" also covers Home: off, the native fade uses `surface` instead of the picture's colour.
    tint: spoilerSettings.detailsArtworkTint !== false,
    rows: rows
        .filter((row) => row.items.length > 0)
        .map((row) => ({
            id: row.id,
            title: row.title,
            aspect: row.aspect,
            items: [
                ...row.items.slice(0, MAX_ITEMS_PER_ROW).map((item) => ({
                    key: String(item.ratingKey || ''),
                    img: nativeCardImage(item, row.aspect),
                    backdrop: nativeAbsoluteUrl(playerItemBackdropUrl(item) || ''),
                    progress: Math.round(progressPercent(item)) / 100,
                    watched: item.watched === true,
                    tick: item.type === 'episode' ? 'top-right' : tickPosition,
                    // Per-show spoiler hiding: a landscape episode still of an unwatched episode is drawn blurred.
                    spoiler: item.type === 'episode' && !item.heroCard
                        && resolvePlayerCardAspect(item, row.aspect) === '16/9'
                        && hideEpisodeSpoilers(spoilerSettings, item),
                })),
                // The row's end "View more" card (the web rail shows it when the row has a View all).
                ...(row.onViewAll ? [{
                    key: `view-more:${row.id}`,
                    img: '',
                    backdrop: '',
                    progress: 0,
                    watched: false,
                    viewMore: true,
                    label: viewMoreLabel,
                }] : []),
            ],
        })),
});
};
