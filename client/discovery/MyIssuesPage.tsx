import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle, Film, LifeBuoy, Loader2, MessageSquare, Music, RotateCcw, Trash2, Tv } from 'lucide-react';
import { apiFetch } from '../shared/api';
import { portalUrl } from '../shared/basePath';
import { NoPosterPlaceholder } from '../shared/NoPosterPlaceholder';
import { RequestCardActions, RequestCardShell, requestCardActionBtnClass } from '../requests/RequestCardShell';
import { portalRequestTypeLabelKey } from '../requests/requestFilterUtils';
import type { PortalIssueItem } from '../requests/types';
import {
    formatIssueLocation,
    formatIssueRelativeTime,
    issueStatusBadgeClass,
} from './issueUtils';
import { discoveryTheme } from './discoveryThemeClasses';
import { translateDiscoverStatus, useDiscoverI18n } from './i18n';

type IssueFilter = 'open' | 'resolved' | 'all';

const PAGE_SIZE = 40;

type Props = {
    navigate: (path: string) => void;
    pushToast?: (msg: string, type: 'success' | 'error') => void;
    onCountsChange?: () => void;
};

const IssueTypeBadge: React.FC<{ type: string; t: (key: string) => string }> = ({ type, t }) => (
    <span className="text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full bg-white/5 border border-border text-muted">
        {t(portalRequestTypeLabelKey(type))}
    </span>
);

export const MyIssuesPage: React.FC<Props> = ({ navigate, pushToast, onCountsChange }) => {
    const { t } = useDiscoverI18n();
    const [filter, setFilter] = useState<IssueFilter>('open');
    const [issues, setIssues] = useState<PortalIssueItem[]>([]);
    const [counts, setCounts] = useState({
        open: 0,
        resolved: 0,
        total: 0,
        userMapped: true,
    });
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [actionId, setActionId] = useState<number | null>(null);
    const [commentTarget, setCommentTarget] = useState<PortalIssueItem | null>(null);
    const [commentText, setCommentText] = useState('');
    const [deleteTarget, setDeleteTarget] = useState<PortalIssueItem | null>(null);
    const [filterTotal, setFilterTotal] = useState(0);
    const [gotFullPage, setGotFullPage] = useState(false);
    const issuesRef = useRef<PortalIssueItem[]>([]);
    const loadingMoreRef = useRef(false);
    const sentinelRef = useRef<HTMLDivElement>(null);
    issuesRef.current = issues;

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
            const skip = append ? issuesRef.current.length : 0;
            const listUrl = `/api/discovery/my-issues?filter=${encodeURIComponent(filter)}&take=${PAGE_SIZE}&skip=${skip}`;
            const [countData, listData] = await Promise.all([
                append ? Promise.resolve(null) : apiFetch('/api/discovery/my-issues/count'),
                apiFetch(listUrl),
            ]);

            if (countData) {
                setCounts({
                    open: Number(countData?.open) || 0,
                    resolved: Number(countData?.resolved) || 0,
                    total: Number(countData?.total) || 0,
                    userMapped: countData?.userMapped !== false,
                });
            }

            if (countData?.userMapped === false || listData?.userMapped === false) {
                setIssues([]);
                setFilterTotal(0);
                setGotFullPage(false);
                setError(countData?.error || listData?.error || t('issues.accountNotLinked'));
                return;
            }

            const incoming = Array.isArray(listData?.results) ? listData.results : [];
            const pageTotal = Number(listData?.pageInfo?.total);
            if (Number.isFinite(pageTotal) && pageTotal >= 0) setFilterTotal(pageTotal);
            setGotFullPage(incoming.length >= PAGE_SIZE);

            if (append) {
                setIssues((prev) => {
                    const seen = new Set(prev.map((row) => row.id));
                    return [...prev, ...incoming.filter((row) => !seen.has(row.id))];
                });
            } else {
                setIssues(incoming);
            }
        } catch (e: any) {
            setError(e?.message || t('issues.loadFailed'));
            if (!append) setIssues([]);
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

    const filterTabs = useMemo(() => ([
        { id: 'open' as const, label: t('status.open'), count: counts.open },
        { id: 'resolved' as const, label: t('status.resolved'), count: counts.resolved },
        { id: 'all' as const, label: t('status.all'), count: counts.total },
    ]), [counts, t]);

    const knownTotal = Math.max(
        filterTotal,
        Number(filter === 'open' ? counts.open : filter === 'resolved' ? counts.resolved : counts.total) || 0,
    );
    const hasMore = knownTotal > 0
        ? issues.length < knownTotal
        : gotFullPage;

    useEffect(() => {
        if (loading || loadingMore || !hasMore || issues.length === 0) return;
        const node = sentinelRef.current;
        if (!node) return;
        const observer = new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting)) {
                void loadData({ append: true, silent: true });
            }
        }, { rootMargin: '240px' });
        observer.observe(node);
        return () => observer.disconnect();
    }, [hasMore, issues.length, loadData, loading, loadingMore]);

    const openMedia = (item: PortalIssueItem) => {
        if (!item.tmdbId) return;
        navigate(`/discovery/${item.type}/${item.tmdbId}`);
    };

    const handleResolve = async (item: PortalIssueItem) => {
        setActionId(item.id);
        try {
            const endpoint = item.statusLabel === 'open'
                ? `/api/discovery/my-issues/${item.id}/resolved`
                : `/api/discovery/my-issues/${item.id}/open`;
            const res = await apiFetch(endpoint, { method: 'POST' });
            if (res?.error) throw new Error(res.error);
            pushToast?.(res?.message || t('issues.updated'), 'success');
            await loadData({ silent: true });
            onCountsChange?.();
        } catch (e: any) {
            pushToast?.(e?.message || t('issues.updateFailed'), 'error');
        } finally {
            setActionId(null);
        }
    };

    const handleComment = async () => {
        if (!commentTarget) return;
        setActionId(commentTarget.id);
        try {
            const res = await apiFetch(`/api/discovery/my-issues/${commentTarget.id}/comment`, {
                method: 'POST',
                body: JSON.stringify({ message: commentText.trim() }),
            });
            if (res?.error) throw new Error(res.error);
            pushToast?.(res?.message || t('issues.commentAdded'), 'success');
            setCommentTarget(null);
            setCommentText('');
            await loadData({ silent: true });
        } catch (e: any) {
            pushToast?.(e?.message || t('issues.commentFailed'), 'error');
        } finally {
            setActionId(null);
        }
    };

    const handleDelete = async () => {
        if (!deleteTarget) return;
        setActionId(deleteTarget.id);
        try {
            const res = await apiFetch(`/api/discovery/my-issues/${deleteTarget.id}`, { method: 'DELETE' });
            if (res?.error) throw new Error(res.error);
            pushToast?.(res?.message || t('issues.deleted'), 'success');
            setDeleteTarget(null);
            await loadData({ silent: true });
            onCountsChange?.();
        } catch (e: any) {
            pushToast?.(e?.message || t('issues.deleteFailed'), 'error');
        } finally {
            setActionId(null);
        }
    };

    return (
        <div className="flex flex-col gap-6 w-full pb-12">
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 px-2">
                <div>
                    <h2 className={discoveryTheme.heading}>{t('issues.title')}</h2>
                    <p className={discoveryTheme.subheading}>
                        {t('issues.subtitle')}
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

            {loading ? (
                <div className="flex items-center justify-center py-20">
                    <Loader2 className="w-8 h-8 text-plex animate-spin" />
                </div>
            ) : error ? (
                <div className="mx-2 rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-4 text-sm text-amber-200">
                    {error}
                </div>
            ) : issues.length === 0 ? (
                <div className={`mx-2 ${discoveryTheme.emptyState}`}>
                    <p className={discoveryTheme.emptyTitle}>
                        {filter === 'all'
                            ? t('issues.emptyTitleAll')
                            : t('issues.emptyTitle', { filter: translateDiscoverStatus(t, filter) })}
                    </p>
                    <p className={discoveryTheme.emptyBody}>
                        {t('issues.emptyBody')}
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
                    {issues.map((item) => {
                        const busy = actionId === item.id;
                        const location = formatIssueLocation(item, t);
                        const firstComment = item.comments?.[0]?.message;
                        const isOpen = item.statusLabel === 'open';

                        return (
                            <RequestCardShell
                                key={item.id}
                                backdropUrl={item.backdropUrl}
                                posterUrl={item.posterUrl}
                            >
                                <div className="flex flex-col sm:flex-row gap-4 p-4 sm:p-5">
                                    <button
                                        type="button"
                                        onClick={() => openMedia(item)}
                                        className="flex gap-4 min-w-0 flex-1 text-left border-0 bg-transparent p-0 cursor-pointer group"
                                    >
                                        <div className="w-16 h-24 rounded-lg overflow-hidden flex-shrink-0 bg-background/40 border border-border group-hover:border-plex/30 transition-colors">
                                            {item.posterUrl ? (
                                                <img src={item.posterUrl} alt="" className="w-full h-full object-cover" />
                                            ) : (
                                                <NoPosterPlaceholder compact />
                                            )}
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <div className="flex flex-wrap items-center gap-2 mb-1.5">
                                                <IssueTypeBadge type={item.type} t={t} />
                                                <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border bg-white/5 border-border text-muted">
                                                    {item.issueTypeLabel}
                                                </span>
                                                <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border ${issueStatusBadgeClass(item.statusLabel)}`}>
                                                    {translateDiscoverStatus(t, item.statusLabel)}
                                                </span>
                                            </div>
                                            <h3 className="text-lg font-black text-text leading-tight group-hover:text-plex transition-colors">
                                                {item.title}
                                                {item.year ? <span className="text-muted font-bold ml-2">{item.year}</span> : null}
                                            </h3>
                                            <p className="text-xs text-muted mt-1">
                                                {t('issues.reportedAt', { date: formatIssueRelativeTime(item.createdAt || item.updatedAt, t) })}
                                                {location ? ` · ${location}` : ''}
                                            </p>
                                            {firstComment && (
                                                <p className="text-sm text-text/65 mt-2 line-clamp-2">{firstComment}</p>
                                            )}
                                        </div>
                                    </button>

                                    <RequestCardActions>
                                        {item.ticketId ? (
                                            <a
                                                href={portalUrl(`/support?ticket=${item.ticketId}`)}
                                                className={`${requestCardActionBtnClass} border border-plex/40 text-plex hover:bg-plex/10 no-underline`}
                                            >
                                                <LifeBuoy className="w-3.5 h-3.5" />
                                                {t('issuesAdmin.actions.openTicket')}
                                            </a>
                                        ) : null}
                                        <button
                                            type="button"
                                            disabled={busy}
                                            onClick={() => {
                                                setCommentTarget(item);
                                                setCommentText('');
                                            }}
                                            className={`${requestCardActionBtnClass} border border-border text-text/70 hover:bg-white/5`}
                                        >
                                            <MessageSquare className="w-3.5 h-3.5" />
                                            {t('issues.comment')}
                                        </button>
                                        <button
                                            type="button"
                                            disabled={busy}
                                            onClick={() => handleResolve(item)}
                                            className={`${requestCardActionBtnClass} border border-plex/30 text-plex hover:bg-plex/10`}
                                        >
                                            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : isOpen ? <CheckCircle className="w-3.5 h-3.5" /> : <RotateCcw className="w-3.5 h-3.5" />}
                                            {isOpen ? t('issues.resolve') : t('issues.reopen')}
                                        </button>
                                        {item.commentCount <= 1 && (
                                            <button
                                                type="button"
                                                disabled={busy}
                                                onClick={() => setDeleteTarget(item)}
                                                className={`${requestCardActionBtnClass} border border-red-500/30 text-red-300 hover:bg-red-500/10`}
                                            >
                                                <Trash2 className="w-3.5 h-3.5" />
                                                {t('common.delete')}
                                            </button>
                                        )}
                                        <button
                                            type="button"
                                            onClick={() => openMedia(item)}
                                            className={`${requestCardActionBtnClass} border border-border text-text/70 hover:bg-white/5`}
                                        >
                                            {item.type === 'tv' ? <Tv className="w-3.5 h-3.5" /> : item.type === 'music' ? <Music className="w-3.5 h-3.5" /> : <Film className="w-3.5 h-3.5" />}
                                            {t('common.view')}
                                        </button>
                                    </RequestCardActions>
                                </div>
                            </RequestCardShell>
                        );
                    })}
                </div>
            )}

            {issues.length > 0 && !loading && (
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

            {commentTarget && (
                <div className="fixed inset-0 z-[210] flex items-center justify-center p-4">
                    <button
                        type="button"
                        aria-label={t('common.close')}
                        className="absolute inset-0 bg-background/80 backdrop-blur-sm"
                        onClick={() => { if (actionId == null) setCommentTarget(null); }}
                    />
                    <div className="relative w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl">
                        <h3 className="text-lg font-black text-text mb-2">{t('issues.addComment')}</h3>
                        <p className="text-sm text-muted mb-4">
                            {t('issues.commentBody', { title: commentTarget.title })}
                        </p>
                        <textarea
                            value={commentText}
                            onChange={(e) => setCommentText(e.target.value)}
                            rows={4}
                            className="w-full rounded-xl border border-border bg-background/30 px-3 py-2.5 text-sm text-text outline-none focus:border-plex focus:ring-1 focus:ring-plex resize-y min-h-[6rem] mb-4"
                            placeholder={t('issues.commentPlaceholder')}
                        />
                        <div className="flex gap-3">
                            <button
                                type="button"
                                disabled={actionId != null}
                                onClick={() => setCommentTarget(null)}
                                className="flex-1 py-2.5 rounded-xl border border-border text-text/70 font-bold hover:bg-white/5 transition-colors disabled:opacity-50"
                            >
                                {t('common.cancel')}
                            </button>
                            <button
                                type="button"
                                disabled={actionId != null || commentText.trim().length < 1}
                                onClick={handleComment}
                                className="flex-1 py-2.5 rounded-xl bg-plex text-black font-black hover:bg-plex-hover transition-colors disabled:opacity-50"
                            >
                                {actionId != null ? t('issues.sending') : t('issues.sendComment')}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {deleteTarget && (
                <div className="fixed inset-0 z-[210] flex items-center justify-center p-4">
                    <button
                        type="button"
                        aria-label={t('common.close')}
                        className="absolute inset-0 bg-background/80 backdrop-blur-sm"
                        onClick={() => { if (actionId == null) setDeleteTarget(null); }}
                    />
                    <div className="relative w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl">
                        <h3 className="text-lg font-black text-text mb-2">{t('issues.deleteTitle')}</h3>
                        <p className="text-sm text-muted mb-5">
                            {t('issues.deleteBody', { title: deleteTarget.title })}
                        </p>
                        <div className="flex gap-3">
                            <button
                                type="button"
                                disabled={actionId != null}
                                onClick={() => setDeleteTarget(null)}
                                className="flex-1 py-2.5 rounded-xl border border-border text-text/70 font-bold hover:bg-white/5 transition-colors disabled:opacity-50"
                            >
                                {t('issues.keepIssue')}
                            </button>
                            <button
                                type="button"
                                disabled={actionId != null}
                                onClick={handleDelete}
                                className="flex-1 py-2.5 rounded-xl bg-red-500 text-white font-black hover:bg-red-600 transition-colors disabled:opacity-50"
                            >
                                {actionId != null ? t('issues.deleting') : t('common.delete')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
