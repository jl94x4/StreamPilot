import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, ExternalLink, Film, Loader2, Music, Pencil, RefreshCw, RotateCcw, Search, Trash2, Tv, X } from 'lucide-react';
import { apiFetch } from '../shared/api';
import { formatDateTime } from '../shared/format';
import { Loader, ToastContainer, pushToast, type ToastMessage } from '../shared/toast';
import { CustomSelect } from '../shared/ui';
import { RequestApprovalModal } from './RequestApprovalModal';
import { RequestCardActions, RequestCardShell, requestCardActionBtnClass } from './RequestCardShell';
import { RequestMetaChips } from './RequestMetaChips';
import { OpenInArrButton } from '../shared/OpenInArrButton';
import { portalUrl } from '../shared/basePath';
import { dashboardPanelClass } from '../shared/dashboard/DashboardChrome';
import { stashDiscoverDetailSeed } from '../discovery/discoverNavigationUtils';
import {
    type AdminRequestFilter,
    buildRequesterOptions,
    defaultRequestListFilters,
    filterPortalRequests,
    portalRequestTypeLabelKey,
    type RequestListFilters,
} from './requestFilterUtils';
import type { PortalRequestItem, PortalRequestUser } from './types';
import { useDiscoverI18n } from '../discovery/i18n';
import { goToProfile, profileKeyForRequester, requestDiscoveryPath } from '../profile/helpers';

export type { PortalRequestItem } from './types';

type Props = {
    onCountsChange?: () => void;
    embedded?: boolean;
    initialReviewId?: number | null;
    navigate?: (path: string) => void;
};

const formatRelativeTime = (value: string | null | undefined, t: ReturnType<typeof useDiscoverI18n>['t']) => {
    if (!value) return t('common.unknownTime');
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return formatDateTime(value);
    const diffMs = Date.now() - date.getTime();
    const minutes = Math.floor(diffMs / 60000);
    if (minutes < 1) return t('common.justNow');
    if (minutes < 60) return t('common.minutesAgo', { count: minutes });
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return t('common.hoursAgo', { count: hours });
    const days = Math.floor(hours / 24);
    if (days < 7) return t('common.daysAgo', { count: days });
    return formatDateTime(value);
};

const RequestTypeBadge: React.FC<{ type: string; is4k: boolean; t: ReturnType<typeof useDiscoverI18n>['t'] }> = ({ type, is4k, t }) => (
    <span className="inline-flex items-center gap-1.5">
        <span className="text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full bg-white/5 border border-border text-muted">
            {t(portalRequestTypeLabelKey(type))}
        </span>
        {is4k && (
            <span className="text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-200">
                4K
            </span>
        )}
    </span>
);

export const RequestsAdminPanel: React.FC<Props> = ({ onCountsChange, embedded = false, initialReviewId = null, navigate }) => {
    const { t } = useDiscoverI18n();
    const [toasts, setToasts] = useState<ToastMessage[]>([]);
    const [filter, setFilter] = useState<AdminRequestFilter>('pending');
    const [listFilters, setListFilters] = useState(defaultRequestListFilters);
    const [requests, setRequests] = useState<PortalRequestItem[]>([]);
    const [users, setUsers] = useState<PortalRequestUser[]>([]);
    const [counts, setCounts] = useState({
        pending: 0,
        approved: 0,
        declined: 0,
        failed: 0,
        processing: 0,
        available: 0,
        total: 0,
        configured: false,
        connected: false,
        supported: true,
    });
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [actionId, setActionId] = useState<number | null>(null);
    const [declineTarget, setDeclineTarget] = useState<PortalRequestItem | null>(null);
    const [declineReason, setDeclineReason] = useState('');
    const [declineAndBlocklist, setDeclineAndBlocklist] = useState(false);
    const [bulkDeclineOpen, setBulkDeclineOpen] = useState(false);
    const [bulkDeclineReason, setBulkDeclineReason] = useState('');
    const [bulkAction, setBulkAction] = useState<'approve' | 'decline' | null>(null);
    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
    const [reviewTarget, setReviewTarget] = useState<PortalRequestItem | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<PortalRequestItem | null>(null);

    const addToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
        setToasts((prev) => pushToast(prev, message, type));
    }, []);

    const loadData = useCallback(async (opts?: { silent?: boolean }) => {
        if (!opts?.silent) setLoading(true);
        else setRefreshing(true);
        setError(null);
        try {
            const countData = await apiFetch('/api/requests/count');
            const nextCounts = {
                pending: Number(countData?.pending) || 0,
                approved: Number(countData?.approved) || 0,
                declined: Number(countData?.declined) || 0,
                failed: Number(countData?.failed) || 0,
                processing: Number(countData?.processing) || 0,
                available: Number(countData?.available) || 0,
                total: Number(countData?.total) || 0,
                configured: !!countData?.configured,
                connected: !!countData?.connected,
                supported: countData?.supported !== false,
            };
            setCounts(nextCounts);

            if (!nextCounts.configured) {
                setRequests([]);
                return;
            }
            if (!nextCounts.supported || !nextCounts.connected) {
                setRequests([]);
                setError(countData?.error || t('requestsAdmin.errors.cannotConnect'));
                return;
            }

            const [listData, usersData] = await Promise.all([
                apiFetch(`/api/requests?filter=${encodeURIComponent(filter)}&take=50`),
                apiFetch('/api/requests/users').catch(() => ({ users: [] })),
            ]);
            if (listData?.connected === false) {
                setRequests([]);
                setError(listData?.error || t('requestsAdmin.errors.cannotConnect'));
                return;
            }
            setRequests(Array.isArray(listData?.results) ? listData.results : []);
            setUsers(Array.isArray(usersData?.users) ? usersData.users : []);
            setSelectedIds(new Set());
        } catch (e: any) {
            setError(e?.message || t('requestsAdmin.errors.loadRequests'));
            setRequests([]);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [filter, t]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    useEffect(() => {
        if (!initialReviewId || loading) return;
        const match = requests.find((item) => (
            item.id === initialReviewId || Number(item.id) === Number(initialReviewId)
        ));
        if (match) {
            setReviewTarget(match);
            const url = new URL(window.location.href);
            url.searchParams.delete('review');
            window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
        }
    }, [initialReviewId, loading, requests]);

    const filteredRequests = useMemo(
        () => filterPortalRequests(requests, listFilters),
        [requests, listFilters],
    );

    const requesterOptions = useMemo(
        () => [{ value: '', label: t('requestsAdmin.filters.allRequesters') }, ...buildRequesterOptions(users, requests)],
        [users, requests, t],
    );

    const filterTabs = useMemo(() => ([
        { id: 'pending' as const, label: t('requestsAdmin.filters.pending'), count: counts.pending },
        { id: 'processing' as const, label: t('requestsAdmin.filters.processing'), count: counts.processing },
        { id: 'available' as const, label: t('requestsAdmin.filters.available'), count: counts.available },
        { id: 'failed' as const, label: t('requestsAdmin.filters.failed'), count: counts.failed },
        { id: 'approved' as const, label: t('requestsAdmin.filters.approved'), count: counts.approved },
        { id: 'declined' as const, label: t('requestsAdmin.filters.declined'), count: counts.declined },
    ]), [counts, t]);

    const allVisibleSelected = filteredRequests.length > 0
        && filteredRequests.every((item) => selectedIds.has(item.id));

    const toggleSelectAll = () => {
        if (allVisibleSelected) {
            setSelectedIds(new Set());
            return;
        }
        setSelectedIds(new Set(filteredRequests.map((item) => item.id)));
    };

    const toggleSelected = (id: number) => {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const handleBulkApprove = async () => {
        const ids = Array.from(selectedIds);
        if (!ids.length) return;
        setBulkAction('approve');
        let ok = 0;
        for (const id of ids) {
            try {
                const item = requests.find((r) => r.id === id);
                await apiFetch(`/api/requests/${id}/approve`, {
                    method: 'POST',
                    body: JSON.stringify({ title: item?.title || '' }),
                });
                ok += 1;
            } catch {
                // continue with remaining
            }
        }
        addToast(ok === ids.length ? t('requestsAdmin.toasts.approvedCount', { count: ok }) : t('requestsAdmin.toasts.approvedPartial', { approved: ok, total: ids.length }));
        setSelectedIds(new Set());
        await loadData({ silent: true });
        onCountsChange?.();
        setBulkAction(null);
    };

    const handleBulkDecline = async () => {
        const ids = Array.from(selectedIds);
        if (!ids.length) return;
        setBulkAction('decline');
        let ok = 0;
        for (const id of ids) {
            try {
                const item = requests.find((r) => r.id === id);
                await apiFetch(`/api/requests/${id}/decline`, {
                    method: 'POST',
                    body: JSON.stringify({
                        title: item?.title || '',
                        reason: bulkDeclineReason.trim(),
                    }),
                });
                ok += 1;
            } catch {
                // continue with remaining
            }
        }
        addToast(ok === ids.length ? t('requestsAdmin.toasts.declinedCount', { count: ok }) : t('requestsAdmin.toasts.declinedPartial', { declined: ok, total: ids.length }));
        setBulkDeclineOpen(false);
        setBulkDeclineReason('');
        setSelectedIds(new Set());
        await loadData({ silent: true });
        onCountsChange?.();
        setBulkAction(null);
    };

    const handleQuickApprove = async (item: PortalRequestItem) => {
        setActionId(item.id);
        try {
            await apiFetch(`/api/requests/${item.id}/approve`, {
                method: 'POST',
                body: JSON.stringify({ title: item.title }),
            });
            addToast(t('requestsAdmin.toasts.approvedTitle', { title: item.title }));
            onCountsChange?.();
            void loadData({ silent: true });
        } catch (e: any) {
            addToast(e?.message || t('requestsAdmin.errors.approve'), 'error');
        } finally {
            setActionId(null);
        }
    };

    const handleDecline = async () => {
        if (!declineTarget) return;
        setActionId(declineTarget.id);
        try {
            await apiFetch(`/api/requests/${declineTarget.id}/decline`, {
                method: 'POST',
                body: JSON.stringify({
                    title: declineTarget.title,
                    reason: declineReason.trim(),
                    blacklist: declineAndBlocklist,
                    tmdbId: declineTarget.tmdbId,
                    mediaType: declineTarget.type,
                }),
            });
            addToast(
                declineAndBlocklist
                    ? t('requestsAdmin.toasts.declinedAndBlocklisted', { title: declineTarget.title })
                    : t('requestsAdmin.toasts.declinedTitle', { title: declineTarget.title }),
            );
            setDeclineTarget(null);
            setDeclineReason('');
            setDeclineAndBlocklist(false);
            await loadData({ silent: true });
            onCountsChange?.();
        } catch (e: any) {
            addToast(e?.message || t('requestsAdmin.errors.decline'), 'error');
        } finally {
            setActionId(null);
        }
    };

    const handleRetry = async (item: PortalRequestItem) => {
        setActionId(item.id);
        try {
            await apiFetch(`/api/requests/${item.id}/retry`, {
                method: 'POST',
                body: JSON.stringify({ title: item.title }),
            });
            addToast(t('requestsAdmin.toasts.retriedTitle', { title: item.title }));
            await loadData({ silent: true });
            onCountsChange?.();
        } catch (e: any) {
            addToast(e?.message || t('requestsAdmin.errors.retry'), 'error');
        } finally {
            setActionId(null);
        }
    };

    const handleDelete = async () => {
        if (!deleteTarget) return;
        setActionId(deleteTarget.id);
        try {
            await apiFetch(`/api/requests/${deleteTarget.id}`, {
                method: 'DELETE',
                body: JSON.stringify({ title: deleteTarget.title }),
            });
            addToast(t('requestsAdmin.toasts.deletedTitle', { title: deleteTarget.title }));
            setDeleteTarget(null);
            await loadData({ silent: true });
            onCountsChange?.();
        } catch (e: any) {
            addToast(e?.message || t('requestsAdmin.errors.delete'), 'error');
        } finally {
            setActionId(null);
        }
    };

    const seerrLink = requests[0]?.seerrUrl || null;
    const showPendingActions = filter === 'pending';
    const showArrLink = filter !== 'pending' && filter !== 'declined';

    const openRequestOnDiscover = useCallback((item: PortalRequestItem) => {
        const path = requestDiscoveryPath(item);
        if (!path) return;
        if (item.type !== 'music' && item.tmdbId) {
            stashDiscoverDetailSeed({
                type: item.type,
                mediaType: item.type,
                id: item.tmdbId,
                tmdbId: item.tmdbId,
                title: item.title,
                overview: item.overview,
                posterPath: item.posterPath,
            });
        }
        if (navigate) {
            navigate(path);
            return;
        }
        window.history.pushState({}, '', portalUrl(path));
        window.dispatchEvent(new Event('popstate'));
        window.dispatchEvent(new Event('portal-discovery-navigate'));
    }, [navigate]);

    return (
        <div className={`w-full max-w-[100%] ${embedded ? '' : 'animate-fade-in'}`}>
            <Loader isLoading={loading && requests.length === 0} />
            <ToastContainer toasts={toasts} setToasts={setToasts} />

            {!embedded && (
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
                <div>
                    <h1 className="text-2xl md:text-3xl font-bold text-plex">{t('navigation.requests')}</h1>
                    <p className="text-sm text-muted mt-1">
                        {counts.configured && counts.connected
                            ? t('requestsAdmin.page.pendingSummary', { count: counts.pending })
                            : counts.configured
                            ? t('requestsAdmin.page.configuredConnectionFailed')
                                : t('requestsAdmin.page.connectHint')}
                    </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    {seerrLink && (
                        <a
                            href={seerrLink}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border text-sm font-medium text-muted hover:text-text hover:bg-white/5 transition-colors"
                        >
                            {t('requestsAdmin.actions.openSeerr')} <ExternalLink className="w-4 h-4" />
                        </a>
                    )}
                    <button
                        type="button"
                        onClick={() => loadData({ silent: true })}
                        disabled={refreshing}
                        className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-border text-text text-sm font-semibold hover:bg-opacity-80 transition-colors disabled:opacity-50"
                    >
                        <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
                        {t('requestsAdmin.actions.refresh')}
                    </button>
                </div>
            </div>
            )}

            <div className={`${dashboardPanelClass} p-4 md:p-6`}>
                <div className="flex flex-wrap gap-2 mb-4">
                    {filterTabs.map((tab) => (
                        <button
                            key={tab.id}
                            type="button"
                            onClick={() => setFilter(tab.id)}
                            className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-all ${
                                filter === tab.id
                                    ? 'nav-item-active'
                                    : 'text-muted hover:text-text hover:bg-white/5'
                            }`}
                        >
                            {tab.label}
                            <span className="ml-1.5 text-xs opacity-70">({tab.count})</span>
                        </button>
                    ))}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3 mb-4">
                    <div className="relative sm:col-span-2 xl:col-span-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
                        <input
                            type="text"
                            inputMode="search"
                            value={listFilters.search}
                            onChange={(e) => setListFilters((prev) => ({ ...prev, search: e.target.value }))}
                            placeholder={t('requestsAdmin.filters.search')}
                            className="w-full pl-10 pr-3 py-2 rounded-lg border border-border bg-background text-text appearance-none text-[16px] leading-5 outline-none focus:border-plex transition-colors"
                        />
                    </div>
                    <CustomSelect
                        value={listFilters.requesterId}
                        onChange={(val) => setListFilters((prev) => ({ ...prev, requesterId: val }))}
                        options={requesterOptions}
                    />
                    <CustomSelect
                        value={listFilters.mediaType}
                        onChange={(val) => setListFilters((prev) => ({ ...prev, mediaType: val as RequestListFilters['mediaType'] }))}
                        options={[
                            { value: 'all', label: t('requestsAdmin.filters.allTypes') },
                            { value: 'movie', label: t('mediaType.movies') },
                            { value: 'tv', label: t('mediaType.tv') },
                            { value: 'music', label: t('mediaType.music') },
                        ]}
                    />
                    <CustomSelect
                        value={listFilters.quality}
                        onChange={(val) => setListFilters((prev) => ({ ...prev, quality: val as RequestListFilters['quality'] }))}
                        options={[
                            { value: 'all', label: t('requestsAdmin.filters.allQuality') },
                            { value: 'hd', label: t('requestsAdmin.filters.hdOnly') },
                            { value: '4k', label: t('requestsAdmin.filters.4kOnly') },
                        ]}
                    />
                    <CustomSelect
                        value={listFilters.dateRange}
                        onChange={(val) => setListFilters((prev) => ({ ...prev, dateRange: val as RequestListFilters['dateRange'] }))}
                        options={[
                            { value: 'all', label: t('requestsAdmin.filters.allDates') },
                            { value: '7d', label: t('requestsAdmin.filters.last7Days') },
                            { value: '30d', label: t('requestsAdmin.filters.last30Days') },
                        ]}
                    />
                </div>

                {showPendingActions && filteredRequests.length > 0 && (
                    <div className="flex flex-wrap items-center gap-3 mb-4 p-3 rounded-xl border border-white/10 bg-white/[0.03]">
                        <label className="inline-flex items-center gap-2 text-sm text-muted cursor-pointer">
                            <input
                                type="checkbox"
                                checked={allVisibleSelected}
                                onChange={toggleSelectAll}
                                className="h-4 w-4 rounded border-border bg-background text-plex focus:ring-plex"
                            />
                            {t('requestsAdmin.actions.selectAll', { count: filteredRequests.length })}
                        </label>
                        {selectedIds.size > 0 && (
                            <>
                                <span className="text-xs text-muted">{t('requestsAdmin.actions.selected', { count: selectedIds.size })}</span>
                                <button
                                    type="button"
                                    disabled={!!bulkAction}
                                    onClick={handleBulkApprove}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-plex text-black text-xs font-bold hover:bg-plex-hover transition-colors disabled:opacity-50"
                                >
                                    {bulkAction === 'approve' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                                    {t('requestsAdmin.actions.bulkApprove')}
                                </button>
                                <button
                                    type="button"
                                    disabled={!!bulkAction}
                                    onClick={() => setBulkDeclineOpen(true)}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-500/40 text-red-200 text-xs font-bold hover:bg-red-500/10 transition-colors disabled:opacity-50"
                                >
                                    <X className="w-3.5 h-3.5" />
                                    {t('requestsAdmin.actions.bulkDecline')}
                                </button>
                            </>
                        )}
                    </div>
                )}

                {error && (
                    <div className="mb-4 p-4 rounded-xl border border-red-500/40 bg-red-500/10 text-red-200 text-sm space-y-2">
                        <p>{error}</p>
                        {counts.configured && (
                            <p className="text-xs text-red-200/80">
                                If you use a public reverse-proxy URL, the portal container may not reach it. Add an
                                {' '}<strong>{t('requestsAdmin.labels.internalFetchUrl')}</strong> under Settings → Integrations
                                (docker service name or LAN IP, e.g. <code className="text-red-100">http://jellyseerr:5055</code>).
                            </p>
                        )}
                    </div>
                )}

                {!counts.configured && !loading && !error && (
                    <div className="py-12 text-center text-muted">
                        <p className="font-medium text-text mb-2">{t('requestsAdmin.page.notConfigured')}</p>
                        <p className="text-sm max-w-md mx-auto">
                            Set Request App Type, URL, and API key under Settings → Integrations. Ombi is not supported for in-portal approval yet.
                        </p>
                    </div>
                )}

                {counts.configured && !counts.supported && !loading && (
                    <div className="py-12 text-center text-muted">
                        <p className="font-medium text-text mb-2">{t('requestsAdmin.page.notSupported')}</p>
                        <p className="text-sm max-w-md mx-auto">
                            In-portal approval works with Seerr, Overseerr, and Jellyseerr. Ombi requires the external request UI.
                        </p>
                    </div>
                )}

                {counts.configured && counts.supported && !loading && filteredRequests.length === 0 && !error && (
                    <div className="py-12 text-center text-muted">
                        <p className="font-medium text-text mb-1">
                            {requests.length === 0 ? t('requestsAdmin.empty.noStatusRequests', { status: t(`requestsAdmin.filters.${filter}` as any) }) : t('requestsAdmin.empty.noFilteredRequests')}
                        </p>
                        <p className="text-sm">{t('requestsAdmin.empty.allCaughtUp')}</p>
                    </div>
                )}

                <div className="space-y-3">
                    {filteredRequests.map((item) => {
                        const busy = actionId === item.id;
                        const TypeIcon = item.type === 'tv' ? Tv : item.type === 'music' ? Music : Film;
                        const isSelected = selectedIds.has(item.id);
                        const discoveryPath = requestDiscoveryPath(item);
                        const openDiscover = discoveryPath
                            ? () => openRequestOnDiscover(item)
                            : undefined;
                        return (
                            <RequestCardShell
                                key={item.id}
                                backdropUrl={item.backdropUrl}
                                posterUrl={item.posterUrl}
                                className={`hover:border-plex/25 ${isSelected ? 'ring-1 ring-plex/40' : ''}`}
                            >
                            <div className="flex flex-col sm:flex-row sm:items-start gap-4 p-4">
                                <div className="flex items-start gap-4 min-w-0 flex-1">
                                    {showPendingActions && (
                                        <label className="flex items-start pt-1 cursor-pointer shrink-0">
                                            <input
                                                type="checkbox"
                                                checked={isSelected}
                                                onChange={() => toggleSelected(item.id)}
                                                className="h-4 w-4 rounded border-border bg-background text-plex focus:ring-plex"
                                            />
                                        </label>
                                    )}
                                    <div
                                        className={`flex items-start gap-4 min-w-0 flex-1 ${openDiscover ? 'cursor-pointer group' : ''}`}
                                        role={openDiscover ? 'link' : undefined}
                                        tabIndex={openDiscover ? 0 : undefined}
                                        aria-label={openDiscover ? item.title : undefined}
                                        onClick={openDiscover}
                                        onKeyDown={openDiscover ? (event) => {
                                            if (event.key === 'Enter' || event.key === ' ') {
                                                event.preventDefault();
                                                openDiscover();
                                            }
                                        } : undefined}
                                    >
                                    <div className={`w-[9rem] h-[13.5rem] self-start rounded-lg overflow-hidden bg-card border shrink-0 ${
                                        openDiscover ? 'border-border/50 group-hover:border-plex/40 transition-colors' : 'border-border/50'
                                    }`}>
                                        {item.posterUrl ? (
                                            <img
                                                src={item.posterUrl}
                                                alt=""
                                                className="w-full h-full object-cover"
                                                loading="lazy"
                                            />
                                        ) : (
                                            <div className="w-full h-full flex items-center justify-center text-muted">
                                                <TypeIcon className="w-8 h-8 opacity-40" />
                                            </div>
                                        )}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-2 mb-1">
                                            <h3 className={`font-bold text-text truncate ${openDiscover ? 'group-hover:text-plex transition-colors' : ''}`}>
                                                {item.title}
                                                {item.year ? <span className="text-muted font-medium"> ({item.year})</span> : null}
                                            </h3>
                                            <RequestTypeBadge type={item.type} is4k={item.is4k} t={t} />
                                        </div>
                                        <p className="text-sm text-muted mb-1">
                                            {t('requestsAdmin.labels.requestedBy')}{' '}
                                            <button
                                                type="button"
                                                className="text-text font-medium hover:text-plex hover:underline"
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    goToProfile(undefined, profileKeyForRequester(item.requestedBy));
                                                }}
                                            >
                                                {item.requestedBy.displayName}
                                            </button>
                                            {' · '}
                                            {formatRelativeTime(item.createdAt, t)}
                                            {item.updatedAt && item.updatedAt !== item.createdAt
                                                ? ` · ${t('requestsAdmin.labels.updated')} ${formatRelativeTime(item.updatedAt, t)}`
                                                : ''}
                                        </p>
                                        <RequestMetaChips
                                            genres={item.genres}
                                            originalLanguage={item.originalLanguage}
                                            className="mb-2"
                                        />
                                        {item.modifiedBy && (
                                            <p className="text-xs text-muted mb-1">
                                                {t('requestsAdmin.labels.lastActionBy')} {item.modifiedBy.displayName}
                                            </p>
                                        )}
                                        {filter === 'declined' && item.declineReason && (
                                            <p className="text-xs text-red-200/90 mb-2 bg-red-500/10 border border-red-500/20 rounded-lg px-2.5 py-2">
                                                {item.declineReason}
                                            </p>
                                        )}
                                        {item.routingSummary && (
                                            <p className="text-xs text-plex/90 mb-2 font-medium">{item.routingSummary}</p>
                                        )}
                                        {item.type === 'tv' && item.seasons && item.seasons.length > 0 && (
                                            <p className="text-xs text-muted mb-2">
                                                {t('requestsAdmin.labels.seasons')}: {item.seasons.map((s) => s.seasonNumber).join(', ')}
                                            </p>
                                        )}
                                        {item.overview && (
                                            <p className="text-xs text-muted line-clamp-2">{item.overview}</p>
                                        )}
                                    </div>
                                    </div>
                                </div>

                                <RequestCardActions>
                                    {showPendingActions && (
                                        <>
                                            <button
                                                type="button"
                                                disabled={busy}
                                                onClick={() => setReviewTarget(item)}
                                                className={`${requestCardActionBtnClass} border border-plex/50 bg-background/80 text-plex font-bold hover:bg-plex/15`}
                                            >
                                                <Pencil className="w-3.5 h-3.5" />
                                                {t('requestsAdmin.actions.review')}
                                            </button>
                                            <button
                                                type="button"
                                                disabled={busy}
                                                onClick={() => handleQuickApprove(item)}
                                                className={`${requestCardActionBtnClass} bg-plex text-background font-bold hover:bg-plex-hover shadow-sm shadow-black/20`}
                                            >
                                                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                                                {t('requestsAdmin.actions.quickApprove')}
                                            </button>
                                            <button
                                                type="button"
                                                disabled={busy}
                                                onClick={() => {
                                                    setDeclineTarget(item);
                                                    setDeclineReason('');
                                                    setDeclineAndBlocklist(false);
                                                }}
                                                className={`${requestCardActionBtnClass} border border-red-500/50 bg-background/80 text-red-200 hover:bg-red-500/15`}
                                            >
                                                <X className="w-3.5 h-3.5" />
                                                {t('requestsAdmin.actions.decline')}
                                            </button>
                                        </>
                                    )}
                                    {(filter === 'failed' || item.canRetry) && (
                                        <button
                                            type="button"
                                            disabled={busy}
                                            onClick={() => handleRetry(item)}
                                            className={`${requestCardActionBtnClass} border border-amber-500/50 bg-background/80 text-amber-200 hover:bg-amber-500/15`}
                                        >
                                            <RotateCcw className="w-3.5 h-3.5" />
                                            {t('common.retry')}
                                        </button>
                                    )}
                                    {!showPendingActions && (
                                        <button
                                            type="button"
                                            disabled={busy}
                                            onClick={() => setReviewTarget(item)}
                                            className={`${requestCardActionBtnClass} border border-white/15 bg-background/80 text-text hover:bg-white/10`}
                                        >
                                            <Pencil className="w-3.5 h-3.5" />
                                            {t('requestsAdmin.actions.edit')}
                                        </button>
                                    )}
                                    {showArrLink && (
                                        <OpenInArrButton
                                            mediaType={item.type}
                                            tmdbId={item.tmdbId}
                                            mbid={item.mbid}
                                            title={item.title}
                                            year={item.year}
                                            is4k={!!item.is4k}
                                            className={`${requestCardActionBtnClass} border border-sky-500/40 bg-background/80 text-sky-200 hover:bg-sky-500/15`}
                                            onError={(message) => addToast(message, 'error')}
                                        />
                                    )}
                                    <button
                                        type="button"
                                        disabled={busy}
                                        onClick={() => setDeleteTarget(item)}
                                        className={`${requestCardActionBtnClass} border border-border bg-background/80 text-muted hover:text-red-200 hover:border-red-500/40 hover:bg-red-500/10`}
                                    >
                                        <Trash2 className="w-3.5 h-3.5" />
                                        {t('common.delete')}
                                    </button>
                                </RequestCardActions>
                            </div>
                            </RequestCardShell>
                        );
                    })}
                </div>
            </div>

            {reviewTarget && (
                <RequestApprovalModal
                    requestId={reviewTarget.id}
                    initialTitle={reviewTarget.title}
                    mode={showPendingActions ? 'approve' : 'edit'}
                    onClose={() => setReviewTarget(null)}
                    onComplete={(message) => {
                        addToast(message);
                        setReviewTarget(null);
                        loadData({ silent: true });
                        onCountsChange?.();
                    }}
                    onError={(message) => addToast(message, 'error')}
                />
            )}

            {declineTarget && (
                <div className="fixed inset-0 z-[1200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                    <div className="w-full max-w-md glass-card p-5 shadow-2xl border border-border">
                        <h3 className="text-lg font-bold text-text mb-1">{t('requestsAdmin.modal.declineRequest')}</h3>
                        <p className="text-sm text-muted mb-4">
                            {t('requestsAdmin.modal.declineTarget', { title: declineTarget.title })}
                        </p>
                        <label className="block text-sm font-medium text-text mb-2">{t('requestsAdmin.modal.reasonOptional')}</label>
                        <textarea
                            className="w-full min-h-[100px] p-3 rounded-lg border border-border bg-background text-text outline-none focus:border-plex transition-colors mb-4"
                            value={declineReason}
                            onChange={(e) => setDeclineReason(e.target.value)}
                            placeholder={t('requestsAdmin.modal.declinePlaceholder')}
                        />
                        {declineTarget.tmdbId && (
                            <label className="flex items-start gap-3 mb-4 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={declineAndBlocklist}
                                    onChange={(e) => setDeclineAndBlocklist(e.target.checked)}
                                    className="mt-1 h-4 w-4 rounded border-border bg-background text-plex focus:ring-plex"
                                />
                                <span className="text-sm text-muted">
                                    {t('requestsAdmin.modal.blocklistTarget', { title: declineTarget.title })}
                                </span>
                            </label>
                        )}
                        <div className="flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => {
                                    setDeclineTarget(null);
                                    setDeclineReason('');
                                    setDeclineAndBlocklist(false);
                                }}
                                className="px-4 py-2 rounded-lg border border-border text-muted hover:text-text transition-colors"
                            >
                                {t('common.cancel')}
                            </button>
                            <button
                                type="button"
                                onClick={handleDecline}
                                disabled={actionId === declineTarget.id}
                                className="px-4 py-2 rounded-lg bg-red-600 text-white font-bold hover:bg-red-500 transition-colors disabled:opacity-50"
                            >
                                {actionId === declineTarget.id
                                    ? (declineAndBlocklist ? t('requestsAdmin.modal.decliningBlocking') : t('requestsAdmin.modal.declining'))
                                    : (declineAndBlocklist ? t('requestsAdmin.modal.declineBlocklist') : t('requestsAdmin.modal.declineRequest'))}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {bulkDeclineOpen && (
                <div className="fixed inset-0 z-[1200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                    <div className="w-full max-w-md glass-card p-5 shadow-2xl border border-border">
                        <h3 className="text-lg font-bold text-text mb-1">{t('requestsAdmin.modal.declineCount', { count: selectedIds.size })}</h3>
                        <p className="text-sm text-muted mb-4">
                            {t('requestsAdmin.modal.optionalReasonBulk')}
                        </p>
                        <textarea
                            className="w-full min-h-[100px] p-3 rounded-lg border border-border bg-background text-text outline-none focus:border-plex transition-colors mb-4"
                            value={bulkDeclineReason}
                            onChange={(e) => setBulkDeclineReason(e.target.value)}
                            placeholder={t('requestsAdmin.modal.bulkReasonPlaceholder')}
                        />
                        <div className="flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => {
                                    setBulkDeclineOpen(false);
                                    setBulkDeclineReason('');
                                }}
                                className="px-4 py-2 rounded-lg border border-border text-muted hover:text-text transition-colors"
                            >
                                {t('common.cancel')}
                            </button>
                            <button
                                type="button"
                                onClick={handleBulkDecline}
                                disabled={bulkAction === 'decline'}
                                className="px-4 py-2 rounded-lg bg-red-600 text-white font-bold hover:bg-red-500 transition-colors disabled:opacity-50"
                            >
                                {bulkAction === 'decline' ? t('requestsAdmin.modal.declining') : t('requestsAdmin.modal.declineCount', { count: selectedIds.size })}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {deleteTarget && (
                <div className="fixed inset-0 z-[1200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                    <div className="w-full max-w-md glass-card p-5 shadow-2xl border border-border">
                        <h3 className="text-lg font-bold text-text mb-1">{t('requestsAdmin.modal.deleteRequest')}</h3>
                        <p className="text-sm text-muted mb-4">
                            {t('requestsAdmin.modal.permanentlyDelete', { title: deleteTarget.title })}
                        </p>
                        <div className="flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => setDeleteTarget(null)}
                                className="px-4 py-2 rounded-lg border border-border text-muted hover:text-text transition-colors"
                            >
                                {t('common.cancel')}
                            </button>
                            <button
                                type="button"
                                onClick={handleDelete}
                                disabled={actionId === deleteTarget.id}
                                className="px-4 py-2 rounded-lg bg-red-600 text-white font-bold hover:bg-red-500 transition-colors disabled:opacity-50"
                            >
                                {actionId === deleteTarget.id ? t('requestsAdmin.modal.deleting') : t('requestsAdmin.modal.deleteTarget')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
