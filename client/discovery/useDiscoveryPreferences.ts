import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../shared/api';

export type DiscoveryPreferences = {
    discoverRegion: string;
    discoverLanguage: string;
    hideAvailableMedia: boolean;
    tmdbLanguage: string;
    showRecentlyAdded: boolean;
    showWatchlist: boolean;
    nowPlayingEnabled?: boolean;
};

const DEFAULT_PREFERENCES: DiscoveryPreferences = {
    discoverRegion: '',
    discoverLanguage: '',
    hideAvailableMedia: false,
    tmdbLanguage: 'en',
    showRecentlyAdded: true,
    showWatchlist: true,
    nowPlayingEnabled: true,
};

export { filterHiddenAvailableItems, filterHiddenRequestedItems, filterDiscoverBrowseItems } from './discoverAvailability';

export function useDiscoveryPreferences() {
    const [preferences, setPreferences] = useState<DiscoveryPreferences>(DEFAULT_PREFERENCES);
    const [loaded, setLoaded] = useState(false);

    const loadPreferences = useCallback(() => {
        apiFetch('/api/discovery/preferences')
            .then((data) => {
                if (!data) return;
                setPreferences({
                    discoverRegion: String(data.discoverRegion || ''),
                    discoverLanguage: String(data.discoverLanguage || ''),
                    hideAvailableMedia: !!data.hideAvailableMedia,
                    tmdbLanguage: String(data.tmdbLanguage || 'en'),
                    showRecentlyAdded: data.showRecentlyAdded !== false,
                    showWatchlist: data.showWatchlist !== false,
                    nowPlayingEnabled: data.nowPlayingEnabled !== false,
                });
            })
            .catch(() => {
                setPreferences(DEFAULT_PREFERENCES);
            })
            .finally(() => {
                setLoaded(true);
            });
    }, []);

    useEffect(() => {
        let cancelled = false;
        loadPreferences();
        const onConfigUpdated = () => {
            if (!cancelled) loadPreferences();
        };
        window.addEventListener('portal-public-config-updated', onConfigUpdated);
        return () => {
            cancelled = true;
            window.removeEventListener('portal-public-config-updated', onConfigUpdated);
        };
    }, [loadPreferences]);

    return { preferences, loaded, reloadPreferences: loadPreferences };
}
