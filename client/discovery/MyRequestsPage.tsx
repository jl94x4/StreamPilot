import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Film, Loader2, RotateCcw, Trash2, Tv } from 'lucide-react';
import { apiFetch } from '../shared/api';
import { NoPosterPlaceholder } from '../shared/NoPosterPlaceholder';
import { RequestCardActions, RequestCardShell, requestCardActionBtnClass } from '../requests/RequestCardShell';
import type { PortalRequestItem } from '../requests/types';
import { mediaStatusChipClass } from './DiscoverStatusOverlay';
import {
    formatRequestRelativeTime,
    memberRequestDisplayStatus,
    memberRequestStatusClass,
    mergeHd4kMemberRequests,
    requestQualityLabel,
} from './myRequestUtils';
import { discoveryTheme } from './discoveryThemeClasses';
import { useDiscoverI18n, translateDiscoverStatus } from './i18n';

type RequestFilter = 'pending' | 'approved' | 'available' | 'declined' | 'failed';

const PAGE_SIZE = 40;

type Props = {
    navigate: (path: string) => void;
    pushToast?: (msg: string, type: 'success' | 'error') => void;
    onCountsChange?: () => void;
};

const RequestTypeBadge: React.FC<{
    type: string;
    showHd: boolean;
    show4k: boolean;
    t: (key: string) => string;
}> = ({
    type,
    showHd,
    show4k,
    t,
}) => (
    <span className="inline-flex items-center gap-1">
        <span className={`${mediaStatusChipClass} bg-white/5 border-border text-muted`}>
            {type === 'tv' ? t('mediaType.tv') : (type === 'music' ? t('mediaType.music') : t('mediaType.movie'))}
        </span>
        {showHd && (
            <span className={`${mediaStatusChipClass} bg-white/5 border-border text-muted`}>
                HD
            </span>
        )}
        {show4k && (
            <span className={`${mediaStatusChipClass} bg-amber-500/15 border-amber-500/30 text-amber-200`}>
                4K
            </span>
        )}
    </span>
);

const uniqueSeasonNumbers = (variants: PortalRequestItem[]) => {
    const seen = new Set<number>();
    const seasons: number[] = [];
    for (const item of variants) {
        for (const season of item.seasons || []) {
            const n = Number(season.seasonNumber);
            if (!Number.isFinite(n) || seen.has(n)) continue;
            seen.add(n);
            seasons.push(n);
        }
    }
    return seasons.sort((a, b) => a - b);
};

export const MyRequestsPage: React.FC<Props> = ({ navigate, pushToast, onCountsChange }) => {
    const { t } = useDiscoverI18n();
    const [filter, setFilter] = useState<RequestFilter>('pending');
    const [requests, setRequests] = useState<PortalRequestItem[]>([]);
    const [counts, setCounts] = useState({
        pending: 0,
        approved: 0,
        available: 0,
        declined: 0,
        failed: 0,
        total: 0,
        userMapped: true,
    });
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [actionId, setActionId] = useState<number | null>(null);
    const [cancelTarget, setCancelTarget] = useState<PortalRequestItem | null>(null);
    const [filterTotal, setFilterTotal] = useState(0);
    const [gotFullPage, setGotFullPage] = useState(false);
    const requestsRef = useRef<PortalRequestItem[]>([]);
    const loadingMoreRef = useRef(false);
    const sentinelRef = useRef<HTMLDivElement>(null);
    requestsRef.current = requests;

    const loadData = useCallback(async (opts?: { silent?: boolean; append?: boolean }) => {
        const append = !!opts?.append;
        if (append) {
            if (loadingMoreRef.current) return;
            loadingMoreRef.current = true;
            setLoadingMore(true);
        } else if (!opts?.silent) {
            setLoading(true);
        } else {
            setRefreshing(true);
        }
        setError(null);
        try {
            const skip = append ? requestsRef.current.length : 0;
            const listData = await apiFetch(
                `/api/discovery/my-requests?filter=${encodeURIComponent(filter)}&take=${PAGE_SIZE}&skip=${skip}`,
            );

            setCounts({
                pending: Number(listData?.pending ?? listData?.counts?.pending) || 0,
                approved: Number(listData?.approved ?? listData?.counts?.approved) || 0,
                available: Number(listData?.available ?? listData?.counts?.available) || 0,
                declined: Number(listData?.declined ?? listData?.counts?.declined) || 0,
                failed: Number(listData?.failed ?? listData?.counts?.failed) || 0,
                total: Number(listData?.total ?? listData?.counts?.total) || 0,
                userMapped: listData?.userMapped !== false,
            });

            if (listData?.userMapped === false) {
                setRequests([]);
                setFilterTotal(0);
                setGotFullPage(false);
                setError(listData?.error || t('requestsPage.accountNotLinked'));
                return;
            }

            const incoming = Array.isArray(listData?.results) ? listData.results : [];
            const pageTotal = Number(listData?.pageInfo?.total);
            if (Number.isFinite(pageTotal) && pageTotal >= 0) setFilterTotal(pageTotal);
            setGotFullPage(incoming.length >= PAGE_SIZE);

            if (append) {
                setRequests((prev) => {
                    const seen = new Set(prev.map((row) => row.id));
                    return [...prev, ...incoming.filter((row) => !seen.has(row.id))];
                });
            } else {
                setRequests(incoming);
            }
        } catch (e: any) {
            setError(e?.message || t('requestsPage.loadFailed'));
            if (!append) setRequests([]);
        } finally {
            setLoading(false);
            setRefreshing(false);
            setLoadingMore(false);
            loadingMoreRef.current = false;
        }
    }, [filter, t]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    // If Pending is empty but another tab has items, jump there once counts arrive.
    useEffect(() => {
        if (loading || filter !== 'pending' || counts.pending > 0) return;
        if (counts.approved > 0) setFilter('approved');
        else if (counts.available > 0) setFilter('available');
        else if (counts.failed > 0) setFilter('failed');
        else if (counts.declined > 0) setFilter('declined');
    }, [loading, filter, counts.pending, counts.approved, counts.available, counts.failed, counts.declined]);

    const filterTabs = useMemo(() => ([
        { id: 'pending' as const, label: t('status.pending'), count: counts.pending },
        { id: 'approved' as const, label: t('status.approved'), count: counts.approved },
        { id: 'available' as const, label: t('status.available'), count: counts.available },
        { id: 'declined' as const, label: t('status.declined'), count: counts.declined },
        { id: 'failed' as const, label: t('status.failed'), count: counts.failed },
    ]), [counts, t]);

    const mergedRequests = useMemo(() => mergeHd4kMemberRequests(requests), [requests]);
    const knownTotal = Math.max(filterTotal, Number(counts[filter]) || 0);
    const hasMore = knownTotal > 0
        ? requests.length < knownTotal
        : gotFullPage;

    useEffect(() => {
        if (loading || loadingMore || !hasMore || mergedRequests.length === 0) return;
        const node = sentinelRef.current;
        if (!node) return;
        const observer = new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting)) {
                void loadData({ append: true, silent: true });
            }
        }, { rootMargin: '240px' });
        observer.observe(node);
        return () => observer.disconnect();
    }, [hasMore, loadData, loading, loadingMore, mergedRequests.length]);

    const handleCancel = async (item: PortalRequestItem) => {
        setActionId(item.id);
        try {
            const res = await apiFetch(`/api/discovery/my-requests/${item.id}`, { method: 'DELETE' });
            if (res?.error) throw new Error(res.error);
            pushToast?.(res?.message || t('requestsPage.cancelled'), 'success');
            setCancelTarget(null);
            await loadData({ silent: true });
            onCountsChange?.();
        } catch (e: any) {
            pushToast?.(e?.message || t('requestsPage.cancelFailed'), 'error');
        } finally {
            setActionId(null);
        }
    };

    const handleRetry = async (item: PortalRequestItem) => {
        setActionId(item.id);
        try {
            const res = await apiFetch(`/api/discovery/my-requests/${item.id}/retry`, { method: 'POST' });
            if (res?.error) throw new Error(res.error);
            pushToast?.(res?.message || t('requestsPage.retrySubmitted'), 'success');
            await loadData({ silent: true });
            onCountsChange?.();
        } catch (e: any) {
            pushToast?.(e?.message || t('requestsPage.retryFailed'), 'error');
        } finally {
            setActionId(null);
        }
    };

    const openMedia = (item: PortalRequestItem) => {
        if (item.type === 'music') {
            const mbid = String(item.mbid || '').trim();
            if (mbid) navigate(`/discovery/music/artist/${encodeURIComponent(mbid)}`);
            return;
        }
        if (!item.tmdbId) return;
        navigate(`/discovery/${item.type}/${item.tmdbId}`);
    };

    return (
        <div className="flex flex-col gap-6 w-full pb-12">
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 px-2">
                <div>
                    <h2 className={discoveryTheme.heading}>{t('requestsPage.title')}</h2>
                    <p className={discoveryTheme.subheading}>
                        {t('requestsPage.subtitle')}
                    </p>
                </div>
                {refreshing && (
                    <div className="inline-flex items-center gap-2 text-xs text-muted/70">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        {t('common.refreshing')}
                    </div>
                )}
            </div>

            <div className="flex flex-wrap gap-2 px-2">
                {filterTabs.map((tab) => (
                    <button
                        key={tab.id}
                        type="button"
                        onClick={() => setFilter(tab.id)}
                        className={`${discoveryTheme.filterChip} ${
                            filter === tab.id ? discoveryTheme.filterChipActive : ''
                        }`}
                    >
                        {tab.label}
                        <span className={`${discoveryTheme.filterChipCount} ${
                            filter === tab.id ? discoveryTheme.filterChipCountActive : ''
                        }`}
                        >
                            {tab.count}
                        </span>
                    </button>
                ))}
            </div>

            {knownTotal > 0 && requests.length > 0 && (
                <p className="px-2 text-xs text-muted">
                    {t('requestsPage.showing', {
                        shown: requests.length,
                        total: knownTotal,
                    })}
                </p>
            )}

            {loading && requests.length === 0 ? (
                <div className="flex items-center justify-center py-20">
                    <Loader2 className="w-8 h-8 text-plex animate-spin" />
                </div>
            ) : error ? (
                <div className="mx-2 rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-4 text-sm text-amber-200">
                    {error}
                </div>
            ) : mergedRequests.length === 0 ? (
                <div className={`mx-2 ${discoveryTheme.emptyState}`}>
                    <p className={discoveryTheme.emptyTitle}>
                        {t('requestsPage.emptyTitle', { filter: translateDiscoverStatus(t, filter) })}
                    </p>
                    <p className={discoveryTheme.emptyBody}>
                        {t('requestsPage.emptyBody')}
                    </p>
                    <button
                        type="button"
                        onClick={() => navigate('/discovery')}
                        className="mt-4 inline-flex px-4 py-2.5 rounded-xl bg-plex text-black font-bold hover:bg-plex-hover transition-colors"
                    >
                        {t('common.browseDiscover')}
                    </button>
                </div>
            ) : (
                <div className="flex flex-col gap-3 px-2">
                    {mergedRequests.map((group) => {
                        const { primary, variants } = group;
                        const multi = variants.length > 1;
                        const showHd = variants.some((v) => !v.is4k);
                        const show4k = variants.some((v) => !!v.is4k);
                        const seasons = uniqueSeasonNumbers(variants);
                        const sharedStatus = multi
                            ? null
                            : memberRequestDisplayStatus(primary);
                        const declinedReason = variants.find((v) => (
                            memberRequestDisplayStatus(v) === 'Declined' && v.declineReason
                        ))?.declineReason;
                        const cancelable = variants.filter((v) => Number(v.status) === 1);
                        const retryable = variants.filter((v) => v.canRetry || Number(v.status) === 4);
                        const groupBusy = variants.some((v) => actionId === v.id);
                        const requestedAt = variants
                            .map((v) => v.createdAt || v.updatedAt)
                            .filter(Boolean)
                            .sort()[0] || primary.createdAt || primary.updatedAt;

                        return (
                            <RequestCardShell
                                key={group.key}
                                backdropUrl={primary.backdropUrl}
                                posterUrl={primary.posterUrl}
                            >
                                <div className="flex flex-col sm:flex-row gap-4 p-4 sm:p-5">
                                    <button
                                        type="button"
                                        onClick={() => openMedia(primary)}
                                        className="flex gap-4 min-w-0 flex-1 text-left border-0 bg-transparent p-0 cursor-pointer group"
                                    >
                                        <div className="w-16 h-24 rounded-lg overflow-hidden flex-shrink-0 bg-background/40 border border-border group-hover:border-plex/30 transition-colors">
                                            {primary.posterUrl ? (
                                                <img src={primary.posterUrl} alt="" className="w-full h-full object-cover" />
                                            ) : (
                                                <NoPosterPlaceholder compact />
                                            )}
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <div className="flex flex-wrap items-center gap-2 mb-1.5">
                                                <RequestTypeBadge
                                                    type={primary.type}
                                                    showHd={multi && showHd}
                                                    show4k={show4k}
                                                    t={t}
                                                />
                                                {!multi && sharedStatus ? (
                                                    <span className={`${mediaStatusChipClass} ${memberRequestStatusClass(sharedStatus)}`}>
                                                        {translateDiscoverStatus(t, sharedStatus)}
                                                    </span>
                                                ) : null}
                                            </div>
                                            <h3 className="text-lg font-black text-text leading-tight group-hover:text-plex transition-colors">
                                                {primary.title}
                                                {primary.year ? <span className="text-muted font-bold ml-2">{primary.year}</span> : null}
                                            </h3>
                                            <p className="text-xs text-muted mt-1">
                                                {t('requestsPage.requestedAt', { date: formatRequestRelativeTime(requestedAt, t) })}
                                            </p>
                                            {multi ? (
                                                <div className="mt-2 flex flex-col gap-1.5">
                                                    {variants.map((variant) => {
                                                        const statusLabel = memberRequestDisplayStatus(variant);
                                                        return (
                                                            <div
                                                                key={variant.id}
                                                                className="flex flex-wrap items-center gap-2 text-[11px]"
                                                            >
                                                                <span className={`font-bold uppercase tracking-wide ${
                                                                    variant.is4k ? 'text-amber-200' : 'text-muted'
                                                                }`}
                                                                >
                                                                    {requestQualityLabel(variant)}
                                                                </span>
                                                                <span className={`${mediaStatusChipClass} ${memberRequestStatusClass(statusLabel)}`}>
                                                                    {translateDiscoverStatus(t, statusLabel)}
                                                                </span>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            ) : null}
                                            {declinedReason ? (
                                                <p className="text-xs text-red-200/90 mt-2 bg-red-500/10 border border-red-500/20 rounded-lg px-2.5 py-2">
                                                    {declinedReason}
                                                </p>
                                            ) : null}
                                            {primary.type === 'tv' && seasons.length > 0 && (
                                                <p className="text-xs text-muted mt-2">
                                                    {t('requestsPage.seasonsList', { seasons: seasons.join(', ') })}
                                                </p>
                                            )}
                                            {primary.overview && (
                                                <p className="text-sm text-muted mt-2 line-clamp-2">{primary.overview}</p>
                                            )}
                                        </div>
                                    </button>

                                    <RequestCardActions>
                                        {cancelable.map((variant) => {
                                            const busy = actionId === variant.id;
                                            const label = multi
                                                ? `${t('requestsPage.cancel')} ${requestQualityLabel(variant)}`
                                                : t('requestsPage.cancel');
                                            return (
                                                <button
                                                    key={`cancel-${variant.id}`}
                                                    type="button"
                                                    disabled={groupBusy}
                                                    onClick={() => setCancelTarget(variant)}
                                                    className={`${requestCardActionBtnClass} border border-red-500/30 text-red-300 hover:bg-red-500/10`}
                                                >
                                                    {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                                                    {label}
                                                </button>
                                            );
                                        })}
                                        {retryable.map((variant) => {
                                            const busy = actionId === variant.id;
                                            const label = multi
                                                ? `${t('requestsPage.retry')} ${requestQualityLabel(variant)}`
                                                : t('requestsPage.retry');
                                            return (
                                                <button
                                                    key={`retry-${variant.id}`}
                                                    type="button"
                                                    disabled={groupBusy}
                                                    onClick={() => handleRetry(variant)}
                                                    className={`${requestCardActionBtnClass} border border-plex/30 text-plex hover:bg-plex/10`}
                                                >
                                                    {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                                                    {label}
                                                </button>
                                            );
                                        })}
                                        <button
                                            type="button"
                                            onClick={() => openMedia(primary)}
                                            className={`${requestCardActionBtnClass} border border-border text-text/70 hover:bg-white/5`}
                                        >
                                            {primary.type === 'tv' ? <Tv className="w-3.5 h-3.5" /> : <Film className="w-3.5 h-3.5" />}
                                            {t('common.view')}
                                        </button>
                                    </RequestCardActions>
                                </div>
                            </RequestCardShell>
                        );
                    })}
                </div>
            )}

            {mergedRequests.length > 0 && (
                <div className="flex flex-col items-center justify-center min-h-[72px] mt-2 mb-8 gap-3 px-2">
                    <div ref={sentinelRef} className="h-4 w-full" aria-hidden />
                    {loadingMore && (
                        <div className="inline-flex items-center gap-2 text-xs text-muted">
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            {t('common.loadingMore')}
                        </div>
                    )}
                    {hasMore && !loadingMore && (
                        <button
                            type="button"
                            onClick={() => void loadData({ append: true, silent: true })}
                            className="text-xs font-semibold text-plex hover:underline"
                        >
                            {t('requestsPage.loadMore')}
                        </button>
                    )}
                    {!hasMore && !loadingMore && knownTotal > PAGE_SIZE && (
                        <p className="text-xs font-semibold uppercase tracking-wider text-muted/70">
                            {t('common.endOfResults')}
                        </p>
                    )}
                </div>
            )}

            {cancelTarget && (
                <div className="fixed inset-0 z-[210] flex items-center justify-center p-4">
                    <button
                        type="button"
                        aria-label={t('common.close')}
                        className="absolute inset-0 bg-background/80 backdrop-blur-sm"
                        onClick={() => { if (actionId == null) setCancelTarget(null); }}
                    />
                    <div className="relative w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl">
                        <h3 className="text-lg font-black text-text mb-2">{t('requestsPage.cancelTitle')}</h3>
                        <p className="text-sm text-muted mb-5">
                            {t('requestsPage.cancelBody', {
                                quality: requestQualityLabel(cancelTarget),
                                title: cancelTarget.title,
                            })}
                        </p>
                        <div className="flex gap-3">
                            <button
                                type="button"
                                disabled={actionId != null}
                                onClick={() => setCancelTarget(null)}
                                className="flex-1 py-2.5 rounded-xl border border-border text-text/70 font-bold hover:bg-white/5 transition-colors disabled:opacity-50"
                            >
                                {t('requestsPage.keepRequest')}
                            </button>
                            <button
                                type="button"
                                disabled={actionId != null}
                                onClick={() => handleCancel(cancelTarget)}
                                className="flex-1 py-2.5 rounded-xl bg-red-500/90 text-white font-black hover:bg-red-500 transition-colors disabled:opacity-50 inline-flex items-center justify-center gap-2"
                            >
                                {actionId === cancelTarget.id ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                                {t('requestsPage.cancelRequest')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
