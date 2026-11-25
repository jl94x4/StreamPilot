import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Film, Loader2 } from 'lucide-react';
import { apiFetch } from '../shared/api';
import { DiscoverPosterCard } from '../portalScreens/discoverCard';
import { filterHiddenAvailableItems, useDiscoveryPreferences } from './useDiscoveryPreferences';
import { enrichDiscoverItemsWithAvailability } from './discoverAvailabilityEnrich';
import { upgraderPosterGridClass, upgraderPosterGridStyle } from '../shared/portalLayout';
import { useDiscoverI18n } from './i18n';
import { useDiscoverGridSize } from './useDiscoverGridSize';
import { tmdbBackdropUrl } from './discoverConstants';
import { resolveTmdbImageUrl } from './tmdbImageUrl';

/** A franchise page (Meet the Parents Collection, ...): the collection's own picture and overview, then its films in order. */
export const CollectionDetailsPage: React.FC<{
    collectionId: number;
    onBack: () => void;
    onSelect: (item: any) => void;
    formatItem: (item: any) => any;
}> = ({ collectionId, onBack, onSelect, formatItem }) => {
    const { t, locale } = useDiscoverI18n();
    const { preferences } = useDiscoveryPreferences();
    const [gridSize] = useDiscoverGridSize();
    const [collection, setCollection] = useState<any>(null);
    const [parts, setParts] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            setLoading(true);
            setCollection(null);
            setParts([]);
            try {
                const data = await apiFetch(`/api/discovery/proxy/collection/${collectionId}`);
                if (cancelled) return;
                const rows = (Array.isArray(data?.parts) ? data.parts : [])
                    .map((row: any) => ({ ...row, mediaType: row?.mediaType || row?.media_type || 'movie' }))
                    .sort((a: any, b: any) => {
                        const da = String(a?.releaseDate || a?.release_date || '9999');
                        const db = String(b?.releaseDate || b?.release_date || '9999');
                        return da.localeCompare(db);
                    });
                setCollection(data || null);
                setParts(rows);
                setLoading(false);
                if (rows.length) {
                    const enriched = await enrichDiscoverItemsWithAvailability(rows);
                    if (cancelled) return;
                    // Keep the release order the page was sorted into.
                    const byId = new Map<string, any>(enriched.map((row: any) => [String(row?.id ?? row?.tmdbId), row]));
                    setParts(rows.map((row: any) => byId.get(String(row?.id ?? row?.tmdbId)) || row));
                }
            } catch (err) {
                console.error(err);
                if (!cancelled) setLoading(false);
            }
        };
        void load();
        return () => { cancelled = true; };
    }, [collectionId, locale]);

    const visible = useMemo(
        () => filterHiddenAvailableItems(parts, preferences.hideAvailableMedia),
        [parts, preferences.hideAvailableMedia],
    );
    const status = useMemo(() => {
        if (!parts.length) return '';
        const kinds = parts.map((row) => formatItem(row).availability?.kind);
        if (kinds.every((kind) => kind === 'available')) return 'available';
        if (kinds.some((kind) => kind === 'available' || kind === 'partial')) return 'partial';
        return '';
    }, [parts, formatItem]);

    if (loading) {
        return (
            <div className="w-full flex justify-center py-32">
                <Loader2 className="w-12 h-12 text-plex animate-spin" />
            </div>
        );
    }
    if (!collection) return null;

    const name = String(collection.name || '').trim();
    const overview = String(collection.overview || '').trim();
    const backdrop = tmdbBackdropUrl(collection.backdropPath || collection.backdrop_path || '');
    const poster = resolveTmdbImageUrl(collection.posterPath || collection.poster_path, 'w500');

    return (
        <div className="w-full flex flex-col gap-8 pb-12 animate-fade-in relative z-10 mt-4">
            <button
                type="button"
                onClick={onBack}
                className="flex items-center gap-2 text-muted hover:text-text font-medium transition-colors w-fit"
            >
                <ArrowLeft className="w-5 h-5" /> {t('collectionPage.back')}
            </button>

            <div className="relative overflow-hidden rounded-3xl border border-border bg-surface">
                {backdrop ? (
                    <img src={backdrop} alt="" className="absolute inset-0 h-full w-full object-cover opacity-40" />
                ) : null}
                <div className="absolute inset-0 bg-gradient-to-r from-black/85 via-black/60 to-black/30" />
                <div className="relative flex flex-col gap-5 p-5 sm:flex-row sm:items-end sm:gap-8 sm:p-8">
                    {poster ? (
                        <img
                            src={poster}
                            alt=""
                            className="w-32 shrink-0 rounded-xl border border-white/10 shadow-2xl sm:w-44"
                        />
                    ) : null}
                    <div className="flex min-w-0 flex-col gap-3">
                        {status ? (
                            <span className={`w-fit rounded-full px-3 py-1 text-xs font-bold ${status === 'available' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'}`}>
                                {t(status === 'available' ? 'collectionPage.available' : 'collectionPage.partial')}
                            </span>
                        ) : null}
                        <h1 className="text-2xl font-black tracking-tight text-white sm:text-4xl">{name}</h1>
                        <p className="text-sm font-medium text-white/70">
                            {t('collectionPage.movieCount', { count: parts.length })}
                        </p>
                        {overview ? (
                            <p className="max-w-3xl text-sm leading-relaxed text-white/80 sm:text-base">{overview}</p>
                        ) : null}
                    </div>
                </div>
            </div>

            {visible.length > 0 ? (
                <div className="flex flex-col gap-4">
                    <h2 className="text-2xl font-black text-text flex items-center gap-3">
                        <Film className="w-6 h-6 text-plex" /> {t('collectionPage.movies')}
                    </h2>
                    <div className={upgraderPosterGridClass(gridSize)} style={upgraderPosterGridStyle(gridSize)}>
                        {visible.map((rawItem, idx) => {
                            const formatted = formatItem(rawItem);
                            return (
                                <DiscoverPosterCard
                                    key={`${formatted.id}-${idx}`}
                                    item={formatted}
                                    overlay={formatted.overlay}
                                    showQualityBadges={false}
                                    onPosterClick={() => onSelect(formatted)}
                                    footer={(
                                        <div className="text-[11px] font-medium leading-tight text-text text-center mt-1 px-0.5">
                                            <div className="line-clamp-2">{formatted.title}</div>
                                            {formatted.year ? <div className="text-muted mt-0.5">{formatted.year}</div> : null}
                                        </div>
                                    )}
                                />
                            );
                        })}
                    </div>
                </div>
            ) : null}
        </div>
    );
};
