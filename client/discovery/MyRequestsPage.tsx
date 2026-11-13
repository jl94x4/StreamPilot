import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bell, Film, Loader2, RotateCcw, Search, Trash2, Tv, X } from 'lucide-react';
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
import { usePersistedState } from './usePersistedState';

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

type RequestSort = 'newest' | 'oldest' | 'title';
type RequestTypeFilter = 'all' | 'movie' | 'tv' | 'music' | '4k';

const REQUEST_SORTS: RequestSort[] = ['newest', 'oldest', 'title'];
const REQUEST_TYPES: RequestTypeFilter[] = ['all', 'movie', 'tv', 'music', '4k'];
const TYPE_LABEL_KEY: Record<RequestTypeFilter, string> = {
    all: 'requestsPage.typeAll',
    movie: 'requestsPage.typeMovies',
    tv: 'requestsPage.typeShows',
    music: 'requestsPage.typeMusic',
    '4k': 'requestsPage.type4k',
};

const requestGroupTime = (group: { primary: PortalRequestItem; variants: PortalRequestItem[] }) => {
    const raw = group.variants.map((v) => v.createdAt || v.updatedAt).filter(Boolean).sort()[0]
        || group.primary.createdAt || group.primary.updatedAt;
    const ms = raw ? new Date(raw).getTime() : 0;
    return Number.isFinite(ms) ? ms : 0;
};

type TimelineStep = { key: string; label: string; state: 'done' | 'current' | 'todo' | 'bad'; date?: string | null };

/** Requested → Approved → Downloading → Available, derived from the request's status. */
const buildRequestTimeline = (
    primary: PortalRequestItem,
    t: (key: string, vars?: any) => string,
): TimelineStep[] => {
    const status = memberRequestDisplayStatus(primary);
    const when = (value?: string | null) => (value ? formatRequestRelativeTime(value, t) : null);
    const requested: TimelineStep = { key: 'requested', label: t('requestsPage.timelineRequested'), state: 'done', date: when(primary.createdAt) };
    if (status === 'Declined') {
        return [requested, { key: 'declined', label: t('requestsPage.timelineDeclined'), state: 'bad', date: when(primary.updatedAt) }];
    }
    if (status === 'Pending Approval') {
        return [
            requested,
            { key: 'approved', label: t('requestsPage.timelineApproved'), state: 'current' },
            { key: 'downloading', label: t('requestsPage.timelineDownloading'), state: 'todo' },
            { key: 'available', label: t('requestsPage.timelineAvailable'), state: 'todo' },
        ];
    }
    const approved: TimelineStep = { key: 'approved', label: t('requestsPage.timelineApproved'), state: 'done', date: when(primary.updatedAt) };
    if (status === 'Failed') {
        return [requested, approved, { key: 'failed', label: t('requestsPage.timelineFailed'), state: 'bad', date: when(primary.updatedAt) }];
    }
    if (status === 'Available') {
        return [
            requested,
            approved,
            { key: 'downloading', label: t('requestsPage.timelineDownloading'), state: 'done' },
            { key: 'available', label: t('requestsPage.timelineAvailable'), state: 'done', date: when(primary.updatedAt) },
        ];
    }
    if (status === 'Processing') {
        return [
            requested,
            approved,
            { key: 'downloading', label: t('requestsPage.timelineDownloading'), state: 'current' },
            { key: 'available', label: t('requestsPage.timelineAvailable'), state: 'todo' },
        ];
    }
    return [
        requested,
        { ...approved, state: 'done' },
        { key: 'downloading', label: t('requestsPage.timelineDownloading'), state: 'current' },
        { key: 'available', label: t('requestsPage.timelineAvailable'), state: 'todo' },
    ];
};

const RequestTimeline: React.FC<{ primary: PortalRequestItem; t: (key: string, vars?: any) => string }> = ({ primary, t }) => {
    const steps = buildRequestTimeline(primary, t);
    return (
        <ol className="mt-3 flex flex-wrap items-start gap-x-1 gap-y-2 text-[10px]" aria-label="Request progress">
            {steps.map((step, index) => (
                <li key={step.key} className="flex items-start gap-1">
                    {index > 0 && <span className={`mt-[7px] h-px w-3 sm:w-5 ${step.state === 'todo' ? 'bg-white/15' : step.state === 'bad' ? 'bg-red-400/50' : 'bg-plex/50'}`} aria-hidden />}
                    <span className="flex flex-col items-start gap-0.5">
                        <span className="flex items-center gap-1">
                            <span className={`h-2.5 w-2.5 rounded-full border ${
                                step.state === 'done' ? 'bg-plex border-plex'
                                    : step.state === 'current' ? 'border-plex bg-plex/20 animate-pulse'
                                        : step.state === 'bad' ? 'bg-red-400 border-red-400'
                                            : 'border-white/25 bg-transparent'
                            }`} aria-hidden />
                            <span className={`font-bold uppercase tracking-wide ${step.state === 'todo' ? 'text-muted/60' : step.state === 'bad' ? 'text-red-300' : 'text-text/85'}`}>{step.label}</span>
                        </span>
                        {step.date ? <span className="pl-3.5 text-muted/70">{step.date}</span> : null}
                    </span>
                </li>
            ))}
        </ol>
    );
};

type RequestGroupRowProps = {
    group: ReturnType<typeof mergeHd4kMemberRequests>[number];
    /** Only set when this row owns the in-flight action, so other rows stay memo-stable. */
    actionId: PortalRequestItem['id'] | null;
    t: (key: string, vars?: any) => string;
    onOpen: (item: PortalRequestItem) => void;
    onAskCancel: (item: PortalRequestItem) => void;
    onRetry: (item: PortalRequestItem) => void;
    onNotify: (item: PortalRequestItem) => void;
};

const RequestGroupRow = React.memo(({ group, actionId, t, onOpen: openMedia, onAskCancel, onRetry, onNotify }: RequestGroupRowProps) => {
    const setCancelTarget = onAskCancel;
    const handleRetry = onRetry;
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
                        <RequestTimeline primary={primary} t={t} />
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
                    {primary.type !== 'music' && !!primary.tmdbId && !['Available', 'Declined', 'Failed'].includes(memberRequestDisplayStatus(primary)) && (
                        <button
                            type="button"
                            onClick={() => onNotify(primary)}
                            className={`${requestCardActionBtnClass} border border-border text-text/70 hover:bg-white/5`}
                        >
                            <Bell className="w-3.5 h-3.5" />
                            {t('requestsPage.notifyMe')}
                        </button>
                    )}
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
});

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
    const [search, setSearch] = useState('');
    const [sort, setSort] = usePersistedState<RequestSort>('requests.sort', 'newest', (v) => REQUEST_SORTS.includes(v as RequestSort));
    const [typeFilter, setTypeFilter] = usePersistedState<RequestTypeFilter>('requests.type', 'all', (v) => REQUEST_TYPES.includes(v as RequestTypeFilter));
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
    const filtersActive = search.trim() !== '' || typeFilter !== 'all';
    const visibleGroups = useMemo(() => {
        const needle = search.trim().toLowerCase();
        const rows = mergedRequests.filter((group) => {
            if (typeFilter === '4k') {
                if (!group.variants.some((v) => v.is4k)) return false;
            } else if (typeFilter !== 'all' && group.primary.type !== typeFilter) {
                return false;
            }
            return !needle || String(group.primary.title || '').toLowerCase().includes(needle);
        });
        if (sort === 'title') {
            return [...rows].sort((x, y) => String(x.primary.title || '').localeCompare(String(y.primary.title || ''), undefined, { sensitivity: 'base' }));
        }
        if (sort === 'oldest') return [...rows].sort((x, y) => requestGroupTime(x) - requestGroupTime(y));
        return [...rows].sort((x, y) => requestGroupTime(y) - requestGroupTime(x));
    }, [mergedRequests, search, typeFilter, sort]);
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

    const handleRetryImpl = async (item: PortalRequestItem) => {
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

    const pushToastRef = useRef(pushToast);
    pushToastRef.current = pushToast;
    const tRef = useRef(t);
    tRef.current = t;
    const handleNotify = useCallback(async (item: PortalRequestItem) => {
        const toast = (msg: string, type: 'success' | 'error') => pushToastRef.current?.(msg, type);
        const tt = tRef.current;
        const mediaType = item.type === 'tv' ? 'tv' : 'movie';
        const mediaId = Number(item.tmdbId || 0);
        if (!Number.isFinite(mediaId) || mediaId <= 0) {
            toast(tt('requestsPage.notifyBlocked'), 'error');
            return;
        }
        try {
            const params = new URLSearchParams({ mediaType, mediaId: String(mediaId) });
            const options = await apiFetch(`/api/discovery/request-options?${params.toString()}`);
            const watching = !!options?.isWatching;
            if (!watching && !options?.canNotify) {
                toast(String(options?.blockReason || tt('requestsPage.notifyBlocked')), 'error');
                return;
            }
            await apiFetch('/api/discovery/request/notify', {
                method: 'POST',
                body: JSON.stringify({ mediaType, mediaId, subscribe: !watching }),
            });
            toast(watching ? tt('requestsPage.notifyOff') : tt('requestsPage.notifyOn'), 'success');
        } catch (e: any) {
            toast(String(e?.message || tt('requestsPage.notifyBlocked')), 'error');
        }
    }, []);

    const handleRetryRef = useRef(handleRetryImpl);
    handleRetryRef.current = handleRetryImpl;
    const handleRetry = useCallback((item: PortalRequestItem) => handleRetryRef.current(item), []);

    const navigateRef = useRef(navigate);
    navigateRef.current = navigate;
    const openMedia = useCallback((item: PortalRequestItem) => {
        const navigate = navigateRef.current;
        if (item.type === 'music') {
            const mbid = String(item.mbid || '').trim();
            if (mbid) navigate(`/discovery/music/artist/${encodeURIComponent(mbid)}`);
            return;
        }
        if (!item.tmdbId) return;
        navigate(`/discovery/${item.type}/${item.tmdbId}`);
    }, []);

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

            <div className="flex flex-col sm:flex-row sm:items-center gap-2 px-2">
                <div className="relative flex-1 min-w-0">
                    <Search className="w-4 h-4 text-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                        type="text"
                        inputMode="search"
                        enterKeyHint="search"
                        autoComplete="off"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder={t('requestsPage.searchPlaceholder')}
                        aria-label={t('requestsPage.searchPlaceholder')}
                        className="w-full rounded-xl border border-border bg-card/60 py-2 pl-9 pr-9 text-sm text-text placeholder:text-muted/70 focus:border-plex/50 focus:outline-none"
                    />
                    {search && (
                        <button
                            type="button"
                            onClick={() => setSearch('')}
                            aria-label={t('requestsPage.searchClear')}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-text"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    )}
                </div>
                <label className="flex items-center gap-2 text-[11px] font-semibold text-muted shrink-0">
                    {t('requestsPage.sortLabel')}
                    <select
                        value={sort}
                        onChange={(e) => setSort(e.target.value as RequestSort)}
                        className="rounded-xl border border-border bg-card/60 px-3 py-2 text-sm text-text focus:border-plex/50 focus:outline-none"
                    >
                        <option value="newest">{t('requestsPage.sortNewest')}</option>
                        <option value="oldest">{t('requestsPage.sortOldest')}</option>
                        <option value="title">{t('requestsPage.sortTitle')}</option>
                    </select>
                </label>
            </div>

            <div className="flex flex-wrap gap-2 px-2">
                {REQUEST_TYPES.map((type) => (
                    <button
                        key={type}
                        type="button"
                        onClick={() => setTypeFilter(type)}
                        aria-pressed={typeFilter === type}
                        className={`${discoveryTheme.filterChip} ${typeFilter === type ? discoveryTheme.filterChipActive : ''}`}
                    >
                        {t(TYPE_LABEL_KEY[type])}
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
            ) : visibleGroups.length === 0 && filtersActive && mergedRequests.length > 0 ? (
                <div className={`mx-2 ${discoveryTheme.emptyState}`}>
                    <p className={discoveryTheme.emptyTitle}>{t('requestsPage.noMatches')}</p>
                    <button
                        type="button"
                        onClick={() => { setSearch(''); setTypeFilter('all'); }}
                        className="mt-4 inline-flex px-4 py-2.5 rounded-xl border border-border text-text font-bold hover:bg-white/5 transition-colors"
                    >
                        {t('requestsPage.clearFilters')}
                    </button>
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
                    {visibleGroups.map((group) => (
                        <RequestGroupRow
                            key={group.key}
                            group={group}
                            actionId={group.variants.some((v) => v.id === actionId) ? actionId : null}
                            t={t}
                            onOpen={openMedia}
                            onAskCancel={setCancelTarget}
                            onRetry={handleRetry}
                            onNotify={handleNotify}
                        />
                    ))}
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
