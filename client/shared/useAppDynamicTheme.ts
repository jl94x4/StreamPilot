import { useEffect, useState } from 'react';
import { apiFetch } from './api';
import { resolvePortalAssetUrl } from './basePath';
import { useDynamicTheme } from './useDynamicTheme';

type PublicThemeConfig = {
    customLogoUrl?: string;
    mediaServerType?: string;
    trendingBackgrounds?: string[];
} | null | undefined;

const resolveImageUrl = (raw: string | null | undefined): string | null => {
    if (!raw) return null;
    const trimmed = String(raw).trim();
    if (!trimmed) return null;
    return trimmed.startsWith('http') ? trimmed : resolvePortalAssetUrl(trimmed);
};

const isMovieOrShowHistoryItem = (item: any): boolean => {
    const type = String(item?.type || '').toLowerCase();
    // Episodes use the series poster (grandparentThumb → thumbUrl). Skip music tracks.
    return type === 'movie' || type === 'episode' || type === 'show' || !type;
};

/** Poster only — prefer thumb over backdrop/art for last-watched sampling. */
const pickLastWatchedPoster = (history: any[] | undefined | null): string | null => {
    if (!Array.isArray(history)) return null;
    for (const item of history) {
        if (!isMovieOrShowHistoryItem(item)) continue;
        const poster = resolveImageUrl(item?.thumbUrl || item?.thumb);
        if (poster) return poster;
    }
    return null;
};

const pickFromList = (items: any[] | undefined | null): string | null => {
    if (!Array.isArray(items)) return null;
    for (const item of items) {
        const url = resolveImageUrl(item?.thumbUrl || item?.thumb || item?.posterUrl);
        if (url) return url;
    }
    return null;
};

/**
 * Dynamic (Chameleon) accent from the poster of the user's last-watched movie/show.
 * Same source on every route so the portal colour stays tied to watch history.
 */
export const useAppDynamicTheme = (
    activeTheme: string,
    _currentRoute: string,
    publicConfig: PublicThemeConfig,
) => {
    const [imageUrl, setImageUrl] = useState<string | null>(null);
    const isDynamic = activeTheme === 'dynamic';
    const isJellyfin = String(publicConfig?.mediaServerType || 'plex').toLowerCase() === 'jellyfin';

    useEffect(() => {
        if (!isDynamic) {
            setImageUrl(null);
            return undefined;
        }

        let cancelled = false;
        const logoFallback = resolveImageUrl(publicConfig?.customLogoUrl);
        const trendingFallback = resolveImageUrl(
            Array.isArray(publicConfig?.trendingBackgrounds) ? publicConfig.trendingBackgrounds[0] : null,
        );

        const finish = (url: string | null) => {
            if (!cancelled) setImageUrl(url || logoFallback || trendingFallback);
        };

        const loadLastWatchedPoster = async (): Promise<string | null> => {
            try {
                // Broad window so "last watched" is available even if they haven't watched in 30 days.
                const res = isJellyfin
                    ? await apiFetch('/api/jellystat/analytics?days=365')
                    : await apiFetch('/api/plex/analytics/me?days=365&lite=1');
                return pickLastWatchedPoster(res?.recentHistory);
            } catch {
                return null;
            }
        };

        const loadDashboardPosterFallback = async (): Promise<string | null> => {
            try {
                const dash = await apiFetch(
                    isJellyfin ? '/api/jellyfin/dashboard?limit=5' : '/api/plex/dashboard?limit=5',
                );
                return (
                    pickFromList(dash?.recentMovies)
                    || pickFromList(dash?.recentShows)
                );
            } catch {
                return null;
            }
        };

        const load = async () => {
            const lastWatched = await loadLastWatchedPoster();
            if (cancelled) return;
            if (lastWatched) {
                finish(lastWatched);
                return;
            }
            // Only if they have no watch history: recently added poster, then logo/trending.
            finish(await loadDashboardPosterFallback());
        };

        load();
        return () => { cancelled = true; };
    }, [
        isDynamic,
        publicConfig?.customLogoUrl,
        publicConfig?.trendingBackgrounds,
        isJellyfin,
    ]);

    useDynamicTheme(imageUrl, isDynamic);
};
