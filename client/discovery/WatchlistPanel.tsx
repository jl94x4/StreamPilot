import React, { useCallback, useMemo, useState } from 'react';
import { Loader2, PlusCircle, Sparkles } from 'lucide-react';
import { apiFetch } from '../shared/api';
import { DiscoverPosterCard } from '../screens';
import { Carousel } from './Carousel';
import { RequestModal } from './RequestModal';
import {
    countRequestableWatchlistItems,
    isWatchlistItemRequestable,
    resolveWatchlistMediaRef,
    watchlistItemStatusLabel,
} from './watchlistUtils';
import { useDiscoveryMe } from './useDiscoveryMe';
import { formatQuotaHint } from './requestSeasonUtils';
import { translateDiscoverStatus, useDiscoverI18n } from './i18n';
import { DEFAULT_POSTER_GRID_SCALE, discoverRowCardWidthClass, posterGridCardWidthStyle, type PosterGridValue } from '../shared/portalLayout';

type Props = {
    items: any[];
    formatItem: (item: any) => any;
    onSelect: (item: any) => void;
    navigate?: (path: string) => void;
    pushToast?: (msg: string, type: 'success' | 'error') => void;
    onRefresh?: () => void;
    variant?: 'row' | 'page';
    showHeader?: boolean;
    providerLabel?: string;
    rowCardClassName?: string;
    density?: PosterGridValue;
};

export const WatchlistPanel: React.FC<Props> = ({
    items,
    formatItem,
    onSelect,
    navigate,
    pushToast,
    onRefresh,
    variant = 'row',
    showHeader = true,
    providerLabel = 'Plex',
    rowCardClassName,
    density,
}) => {
    const { t } = useDiscoverI18n();
    const [requestTarget, setRequestTarget] = useState<{
        mediaType: 'movie' | 'tv';
        mediaId: number;
        title: string;
        posterPath?: string | null;
        overview?: string | null;
    } | null>(null);
    const [bulkLoading, setBulkLoading] = useState(false);
    const { profile: discoveryMe } = useDiscoveryMe(true);

    const requestableCount = useMemo(() => countRequestableWatchlistItems(items), [items]);
    const canBulkRequest = discoveryMe.permissions?.request !== false && discoveryMe.userMapped !== false;

    const movieQuotaHint = formatQuotaHint(discoveryMe.quota?.movie?.standard, t('mediaType.movie').toLowerCase(), t);
    const tvQuotaHint = formatQuotaHint(discoveryMe.quota?.tv?.standard, t('mediaType.tv'), t);
    const quotaSummary = [movieQuotaHint, tvQuotaHint].filter(Boolean).join(' · ');

    const openRequest = useCallback((rawItem: any) => {
        const ref = resolveWatchlistMediaRef(rawItem);
        if (!ref) {
            pushToast?.(t('watchlist.unableToRequest'), 'error');
            return;
        }
        const formatted = formatItem(rawItem);
        setRequestTarget({
            ...ref,
            posterPath: formatted?.posterPath ?? rawItem?.posterPath ?? rawItem?.poster_path ?? null,
            overview: formatted?.overview ?? rawItem?.overview ?? null,
        });
    }, [pushToast, formatItem, t]);

    const handleRequestSuccess = useCallback((message: string) => {
        pushToast?.(message, 'success');
        setRequestTarget(null);
        onRefresh?.();
    }, [pushToast, onRefresh]);

    const handleRequestAll = async () => {
        if (requestableCount === 0) return;
        setBulkLoading(true);
        try {
            const res = await apiFetch('/api/discovery/watchlist/request', {
                method: 'POST',
                body: JSON.stringify({ all: true }),
            });
            if (res?.error) throw new Error(res.error);
            const submitted = Number(res?.submitted) || 0;
            const skipped = Number(res?.skipped) || 0;
            const failed = Number(res?.failed) || 0;
            if (submitted > 0) {
                pushToast?.(
                    [
                        t('watchlist.bulkSubmitted', { count: submitted }),
                        skipped ? t('watchlist.bulkSkipped', { count: skipped }) : '',
                        failed ? t('watchlist.bulkFailed', { count: failed }) : '',
                    ].filter(Boolean).join(' · '),
                    failed > 0 && submitted === 0 ? 'error' : 'success',
                );
            } else {
                pushToast?.(skipped ? t('watchlist.noneRequestable') : t('watchlist.noneSubmitted'), 'error');
            }
            onRefresh?.();
        } catch (e: any) {
            pushToast?.(e?.message || t('watchlist.requestFailed'), 'error');
        } finally {
            setBulkLoading(false);
        }
    };

    const renderCard = (rawItem: any, idx: number) => {
        if (!rawItem) return null;
        const formatted = formatItem(rawItem);
        const ref = resolveWatchlistMediaRef(rawItem);
        const requestable = isWatchlistItemRequestable(rawItem);
        const statusLabel = watchlistItemStatusLabel(rawItem);

        const cardWidth = variant === 'page'
            ? 'w-full'
            : `${rowCardClassName || discoverRowCardWidthClass(density || DEFAULT_POSTER_GRID_SCALE)} flex-shrink-0 snap-start`;
        const cardStyle = variant === 'page' || rowCardClassName
            ? undefined
            : posterGridCardWidthStyle(density || DEFAULT_POSTER_GRID_SCALE);
        const footer = (
            <div className="flex flex-col gap-1.5 mt-1.5 px-0.5">
                <div className={`text-xs font-medium line-clamp-2 leading-tight text-text ${variant === 'page' ? 'text-left' : 'text-center'}`}>
                    {formatted.title}
                </div>
                {statusLabel && !requestable && (
                    <span className={`text-[10px] font-bold uppercase tracking-wide text-center ${variant === 'page' ? 'text-left' : ''} text-muted`}>
                        {translateDiscoverStatus(t, statusLabel)}
                    </span>
                )}
                {requestable && ref && canBulkRequest && (
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            openRequest(rawItem);
                        }}
                        className="w-full py-1.5 px-2 rounded-lg bg-plex/90 hover:bg-plex text-black text-[11px] font-black transition-colors inline-flex items-center justify-center gap-1"
                    >
                        <PlusCircle className="w-3.5 h-3.5" />
                        {t('watchlist.request')}
                    </button>
                )}
            </div>
        );

        return (
            <div key={`watchlist-${ref?.mediaId || formatted.id || idx}`} className={`${cardWidth} relative group`} style={cardStyle}>
                <DiscoverPosterCard
                    item={formatted}
                    overlay={formatted.overlay}
                    showQualityBadges={false}
                    footer={footer}
                    onPosterClick={() => onSelect(formatted)}
                />
            </div>
        );
    };

    if (!items?.length) return null;

    const header = showHeader ? (
        <div className={`flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-2 ${variant === 'row' ? 'pr-16' : ''}`}>
            <div>
                {variant === 'row' && navigate ? (
                    <button
                        type="button"
                        onClick={() => navigate('/discovery/watchlist')}
                        className="text-xl font-bold text-text text-left hover:text-plex transition-colors"
                    >
                        {t('watchlist.title', { provider: providerLabel })}
                    </button>
                ) : (
                    <h2 className="text-xl font-bold text-text">{t('watchlist.title', { provider: providerLabel })}</h2>
                )}
                <p className="text-xs text-muted mt-1">
                    {t('watchlist.syncedBody', { provider: providerLabel })}
                    {quotaSummary ? ` ${quotaSummary}.` : ''}
                </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
                {variant === 'row' && navigate && (
                    <button
                        type="button"
                        onClick={() => navigate('/discovery/watchlist')}
                        className="text-xs font-bold text-plex hover:underline px-2 py-1"
                    >
                        {t('common.viewAll')}
                    </button>
                )}
                {requestableCount > 0 && canBulkRequest && (
                    <button
                        type="button"
                        disabled={bulkLoading}
                        onClick={handleRequestAll}
                        className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-white/[0.06] border border-border text-text text-xs font-bold hover:bg-white/10 hover:border-plex/30 transition-colors disabled:opacity-50"
                    >
                        {bulkLoading ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                            <Sparkles className="w-3.5 h-3.5 text-plex" />
                        )}
                        {t('watchlist.requestAll', { count: requestableCount })}
                    </button>
                )}
                {requestableCount > 0 && !canBulkRequest && (
                    <span className="text-[11px] font-semibold text-muted px-2 py-1">
                        {!discoveryMe.userMapped ? t('watchlist.accountNotLinked') : t('watchlist.noPermission')}
                    </span>
                )}
            </div>
        </div>
    ) : null;

    return (
        <>
            <div className={`flex flex-col gap-2 relative ${variant === 'page' ? 'pb-6' : ''}`}>
                {header}
                {variant === 'row' ? (
                    <Carousel>{items.map(renderCard)}</Carousel>
                ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 px-2">
                        {items.map(renderCard)}
                    </div>
                )}
            </div>

            {requestTarget && (
                <RequestModal
                    open
                    mediaType={requestTarget.mediaType}
                    mediaId={requestTarget.mediaId}
                    title={requestTarget.title}
                    posterPath={requestTarget.posterPath}
                    overview={requestTarget.overview}
                    onClose={() => setRequestTarget(null)}
                    onSuccess={handleRequestSuccess}
                    onError={(msg) => pushToast?.(msg, 'error')}
                />
            )}
        </>
    );
};
