import React, { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { apiFetch } from '../shared/api';
import { enrichDiscoveryItems } from './discoverItemUtils';
import { enrichDiscoverItemsWithAvailability } from './discoverAvailabilityEnrich';
import { useDiscoveryPreferences } from './useDiscoveryPreferences';
import { WatchlistPanel } from './WatchlistPanel';
import { useDiscoverI18n } from './i18n';

type Props = {
    formatItem: (item: any) => any;
    onSelect: (item: any) => void;
    navigate: (path: string) => void;
    pushToast?: (msg: string, type: 'success' | 'error') => void;
    providerLabel?: string;
};

export const WatchlistPage: React.FC<Props> = ({ formatItem, onSelect, navigate, pushToast, providerLabel = 'Plex' }) => {
    const { t } = useDiscoverI18n();
    const { loaded } = useDiscoveryPreferences();
    const [items, setItems] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const loadWatchlist = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await apiFetch('/api/discovery/watchlist');
            if (res?.error) throw new Error(res.error);
            const enriched = await enrichDiscoveryItems(res?.results || []);
            const withAvailability = await enrichDiscoverItemsWithAvailability(enriched);
            setItems(withAvailability);
        } catch (e: any) {
            setError(e?.message || t('watchlist.loadFailed'));
            setItems([]);
        } finally {
            setLoading(false);
        }
    }, [t]);

    useEffect(() => {
        if (!loaded) return undefined;
        loadWatchlist();
        return undefined;
    }, [loaded, loadWatchlist]);

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <Loader2 className="w-8 h-8 text-plex animate-spin" />
            </div>
        );
    }

    if (error) {
        return (
            <div className="mx-2 rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-4 text-sm text-amber-200">
                {error}
            </div>
        );
    }

    if (!items.length) {
        return (
            <div className="mx-2 rounded-xl border border-white/10 bg-white/[0.03] px-6 py-12 text-center">
                <p className="text-white/70 font-semibold">{t('watchlist.emptyTitle', { provider: providerLabel })}</p>
                <p className="text-sm text-white/45 mt-2">
                    {t('watchlist.emptyBody', { provider: providerLabel })}
                </p>
                <button
                    type="button"
                    onClick={() => navigate('/discovery')}
                    className="mt-4 inline-flex px-4 py-2.5 rounded-xl bg-plex text-black font-bold hover:bg-plex-hover transition-colors"
                >
                    {t('common.browseDiscover')}
                </button>
            </div>
        );
    }

    return (
        <WatchlistPanel
            items={items}
            formatItem={formatItem}
            onSelect={onSelect}
            navigate={navigate}
            pushToast={pushToast}
            onRefresh={loadWatchlist}
            variant="page"
            showHeader
            providerLabel={providerLabel}
        />
    );
};
