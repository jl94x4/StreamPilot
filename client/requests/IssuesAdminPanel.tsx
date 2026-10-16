import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Check,
    ExternalLink,
    Film,
    LifeBuoy,
    Loader2,
    MessageSquare,
    Music,
    RefreshCw,
    RotateCcw,
    Trash2,
    Tv,
} from 'lucide-react';
import { apiFetch } from '../shared/api';
import { portalUrl } from '../shared/basePath';
import { formatDateTime } from '../shared/format';
import { Loader, ToastContainer, pushToast, type ToastMessage } from '../shared/toast';
import { dashboardPanelClass } from '../shared/dashboard/DashboardChrome';
import { RequestCardActions, RequestCardShell, requestCardActionBtnClass } from './RequestCardShell';
import { portalRequestTypeLabelKey } from './requestFilterUtils';
import type { PortalIssueItem } from './types';
import {
    formatIssueLocation,
    formatIssueRelativeTime,
    issueStatusBadgeClass,
} from '../discovery/issueUtils';
import { useDiscoverI18n } from '../discovery/i18n';
import { goToProfile } from '../profile/helpers';

type IssueFilter = 'open' | 'resolved';

const IssueTypeBadge: React.FC<{ type: string; t: ReturnType<typeof useDiscoverI18n>['t'] }> = ({ type, t }) => (
    <span className="text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full bg-white/5 border border-border text-muted">
        {t(portalRequestTypeLabelKey(type))}
    </span>
);

export const IssuesAdminPanel: React.FC<{ onCountsChange?: () => void }> = ({ onCountsChange }) => {
    const { t } = useDiscoverI18n();
    const [toasts, setToasts] = useState<ToastMessage[]>([]);
    const [filter, setFilter] = useState<IssueFilter>('open');
    const [issues, setIssues] = useState<PortalIssueItem[]>([]);
    const [counts, setCounts] = useState({
        open: 0,
        closed: 0,
        total: 0,
        configured: false,
        connected: false,
        supported: true,
    });
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [actionId, setActionId] = useState<number | null>(null);
    const [commentTarget, setCommentTarget] = useState<PortalIssueItem | null>(null);
    const [commentText, setCommentText] = useState('');
    const [deleteTarget, setDeleteTarget] = useState<PortalIssueItem | null>(null);

    const addToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
        setToasts((prev) => pushToast(prev, message, type));
    }, []);

    const loadData = useCallback(async (opts?: { silent?: boolean }) => {
        if (!opts?.silent) setLoading(true);
        else setRefreshing(true);
        setError(null);
        try {
            const countData = await apiFetch('/api/issues/count');
            const nextCounts = {
                open: Number(countData?.open) || 0,
                closed: Number(countData?.closed) || 0,
                total: Number(countData?.total) || 0,
                configured: !!countData?.configured,
                connected: !!countData?.connected,
                supported: countData?.supported !== false,
            };
            setCounts(nextCounts);

            if (!nextCounts.configured) {
                setIssues([]);
                return;
            }
            if (!nextCounts.supported || !nextCounts.connected) {
                setIssues([]);
                setError(countData?.error || t('issuesAdmin.errors.cannotConnect'));
                return;
            }

            const listData = await apiFetch(`/api/issues?filter=${encodeURIComponent(filter)}&take=30`);
            if (listData?.connected === false) {
                setIssues([]);
                setError(listData?.error || t('issuesAdmin.errors.cannotConnect'));
                return;
            }
            setIssues(Array.isArray(listData?.results) ? listData.results : []);
        } catch (e: any) {
            setError(e?.message || t('issuesAdmin.errors.loadIssues'));
            setIssues([]);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [filter, t]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const filterTabs = useMemo(() => ([
        { id: 'open' as const, label: t('issuesAdmin.filters.open'), count: counts.open },
        { id: 'resolved' as const, label: t('issuesAdmin.filters.resolved'), count: counts.closed },
    ]), [counts, t]);

    const handleStatus = async (item: PortalIssueItem, status: 'open' | 'resolved') => {
        setActionId(item.id);
        try {
            await apiFetch(`/api/issues/${item.id}/${status}`, {
                method: 'POST',
                body: JSON.stringify({ title: item.title }),
            });
            addToast(status === 'resolved'
                ? t('issuesAdmin.toasts.resolvedTitle', { title: item.title })
                : t('issuesAdmin.toasts.reopenedTitle', { title: item.title }));
            await loadData({ silent: true });
            onCountsChange?.();
        } catch (e: any) {
            addToast(e?.message || t('issuesAdmin.errors.update'), 'error');
        } finally {
            setActionId(null);
        }
    };

    const handleComment = async () => {
        if (!commentTarget) return;
        setActionId(commentTarget.id);
        try {
            await apiFetch(`/api/issues/${commentTarget.id}/comment`, {
                method: 'POST',
                body: JSON.stringify({ message: commentText.trim() }),
            });
            addToast(t('issuesAdmin.toasts.commentAddedTitle', { title: commentTarget.title }));
            setCommentTarget(null);
            setCommentText('');
            await loadData({ silent: true });
        } catch (e: any) {
            addToast(e?.message || t('issuesAdmin.errors.addComment'), 'error');
        } finally {
            setActionId(null);
        }
    };

    const handleDelete = async () => {
        if (!deleteTarget) return;
        setActionId(deleteTarget.id);
        try {
            await apiFetch(`/api/issues/${deleteTarget.id}`, { method: 'DELETE' });
            addToast(t('issuesAdmin.toasts.deletedTitle', { title: deleteTarget.title }));
            setDeleteTarget(null);
            await loadData({ silent: true });
            onCountsChange?.();
        } catch (e: any) {
            addToast(e?.message || t('issuesAdmin.errors.delete'), 'error');
        } finally {
            setActionId(null);
        }
    };

    const seerrLink = issues[0]?.seerrUrl?.replace(/\/issues\/\d+$/, '/issues') || null;

    return (
        <div className="w-full max-w-[100%] animate-fade-in">
            <Loader isLoading={loading && issues.length === 0} />
            <ToastContainer toasts={toasts} setToasts={setToasts} />

            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
                <div>
                    <h2 className="text-2xl md:text-3xl font-bold text-plex">{t('issuesAdmin.page.title')}</h2>
                    <p className="text-sm text-muted mt-1">
                        {counts.configured && counts.connected
                            ? t('issuesAdmin.page.openSummary', { count: counts.open })
                            : counts.configured
                                ? 'Request app is configured — connection failed (see below)'
                                : t('issuesAdmin.page.connectHint')}
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
                            {t('issuesAdmin.actions.openSeerr')} <ExternalLink className="w-4 h-4" />
                        </a>
                    )}
                    <button
                        type="button"
                        onClick={() => loadData({ silent: true })}
                        disabled={refreshing}
                        className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-border text-text text-sm font-semibold hover:bg-opacity-80 transition-colors disabled:opacity-50"
                    >
                        <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
                        {t('issuesAdmin.actions.refresh')}
                    </button>
                </div>
            </div>

            <div className={`${dashboardPanelClass} p-4 md:p-6`}>
                <div className="flex flex-wrap gap-2 mb-5">
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

                {error && (
                    <div className="mb-4 p-4 rounded-xl border border-red-500/40 bg-red-500/10 text-red-200 text-sm space-y-2">
                        <p>{error}</p>
                    </div>
                )}

                {!error && issues.length === 0 && !loading && (
                    <div className="py-12 text-center text-muted">
                        <p className="font-semibold text-text">{t('issuesAdmin.empty.noIssues', { filter: t(`issuesAdmin.filters.${filter}` as any) })}</p>
                        <p className="text-sm mt-2">{t('issuesAdmin.empty.reportHint')}</p>
                    </div>
                )}

                <div className="flex flex-col gap-3">
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
                                <div className="flex flex-col lg:flex-row gap-4 p-4 md:p-5">
                                    <div className="flex gap-4 min-w-0 flex-1">
                                        <div className="w-16 h-24 rounded-lg overflow-hidden flex-shrink-0 bg-black/40 border border-white/10">
                                            {item.posterUrl ? (
                                                <img src={item.posterUrl} alt="" className="w-full h-full object-cover" />
                                            ) : (
                                                <div className="w-full h-full bg-white/5" />
                                            )}
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <div className="flex flex-wrap items-center gap-2 mb-1.5">
                                                <IssueTypeBadge type={item.type} t={t} />
                                                <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border bg-white/5 border-border text-muted">
                                                    {item.issueTypeLabel}
                                                </span>
                                                <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border ${issueStatusBadgeClass(item.statusLabel)}`}>
                                                    {item.statusLabel}
                                                </span>
                                            </div>
                                            <h3 className="text-lg font-bold text-text leading-tight">
                                                {item.title}
                                                {item.year ? <span className="text-muted font-semibold ml-2">{item.year}</span> : null}
                                            </h3>
                                            <p className="text-xs text-muted mt-1">
                                                {t('issuesAdmin.labels.reportedBy')}{' '}
                                                <button
                                                    type="button"
                                                    className="hover:text-plex hover:underline"
                                                    onClick={() => goToProfile(undefined, item.createdBy.displayName)}
                                                >
                                                    {item.createdBy.displayName}
                                                </button>
                                                {' · '}
                                                {formatIssueRelativeTime(item.createdAt || item.updatedAt, t)}
                                                {location ? ` · ${location}` : ''}
                                            </p>
                                            {firstComment && (
                                                <p className="text-sm text-muted mt-2 line-clamp-3">{firstComment}</p>
                                            )}
                                            {item.updatedAt && item.updatedAt !== item.createdAt && (
                                                <p className="text-[11px] text-muted/70 mt-2">
                                                    {t('issuesAdmin.labels.updated')} {formatDateTime(item.updatedAt)}
                                                </p>
                                            )}
                                        </div>
                                    </div>

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
                                            className={`${requestCardActionBtnClass} border border-border text-muted hover:bg-white/5 hover:text-text`}
                                        >
                                            <MessageSquare className="w-3.5 h-3.5" />
                                            {t('issues.comment')}
                                        </button>
                                        {isOpen ? (
                                            <button
                                                type="button"
                                                disabled={busy}
                                                onClick={() => handleStatus(item, 'resolved')}
                                                className={`${requestCardActionBtnClass} border border-green-500/30 text-green-300 hover:bg-green-500/10`}
                                            >
                                                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                                                {t('issues.resolve')}
                                            </button>
                                        ) : (
                                            <button
                                                type="button"
                                                disabled={busy}
                                                onClick={() => handleStatus(item, 'open')}
                                                className={`${requestCardActionBtnClass} border border-plex/30 text-plex hover:bg-plex/10`}
                                            >
                                                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                                                {t('issues.reopen')}
                                            </button>
                                        )}
                                        <button
                                            type="button"
                                            disabled={busy}
                                            onClick={() => setDeleteTarget(item)}
                                            className={`${requestCardActionBtnClass} border border-red-500/30 text-red-300 hover:bg-red-500/10`}
                                        >
                                            <Trash2 className="w-3.5 h-3.5" />
                                            {t('common.delete')}
                                        </button>
                                        {item.tmdbId && (
                                            <a
                                                href={portalUrl(`/discovery/${item.type}/${item.tmdbId}`)}
                                                className={`${requestCardActionBtnClass} border border-border text-muted hover:bg-white/5 hover:text-text no-underline`}
                                            >
                                                {item.type === 'tv' ? <Tv className="w-3.5 h-3.5" /> : item.type === 'music' ? <Music className="w-3.5 h-3.5" /> : <Film className="w-3.5 h-3.5" />}
                                                {t('common.view')}
                                            </a>
                                        )}
                                    </RequestCardActions>
                                </div>
                            </RequestCardShell>
                        );
                    })}
                </div>
            </div>

            {commentTarget && (
                <div className="fixed inset-0 z-[210] flex items-center justify-center p-4">
                    <button
                        type="button"
                        aria-label={t('common.close')}
                        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
                        onClick={() => { if (actionId == null) setCommentTarget(null); }}
                    />
                    <div className="relative w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl">
                        <h3 className="text-lg font-bold text-text mb-2">{t('issuesAdmin.dialogs.replyTitle')}</h3>
                        <p className="text-sm text-muted mb-4">
                            {commentTarget.title} · {commentTarget.createdBy.displayName}
                        </p>
                        <textarea
                            value={commentText}
                            onChange={(e) => setCommentText(e.target.value)}
                            rows={4}
                            className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-text outline-none focus:border-plex focus:ring-1 focus:ring-plex resize-y min-h-[6rem] mb-4"
                            placeholder={t('issuesAdmin.dialogs.replyPlaceholder')}
                        />
                        <div className="flex gap-3">
                            <button
                                type="button"
                                disabled={actionId != null}
                                onClick={() => setCommentTarget(null)}
                                className="flex-1 py-2.5 rounded-xl border border-border text-muted font-semibold hover:bg-white/5 transition-colors disabled:opacity-50"
                            >
                                {t('common.cancel')}
                            </button>
                            <button
                                type="button"
                                disabled={actionId != null || commentText.trim().length < 1}
                                onClick={handleComment}
                                className="flex-1 py-2.5 rounded-xl bg-plex text-black font-bold hover:bg-plex-hover transition-colors disabled:opacity-50"
                            >
                                {actionId != null ? t('issues.sending') : t('issuesAdmin.actions.sendReply')}
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
                        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
                        onClick={() => { if (actionId == null) setDeleteTarget(null); }}
                    />
                    <div className="relative w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl">
                        <h3 className="text-lg font-bold text-text mb-2">{t('issues.deleteTitle')}</h3>
                        <p className="text-sm text-muted mb-5">
                            {t('issuesAdmin.dialogs.deleteBody', { title: deleteTarget.title })}
                        </p>
                        <div className="flex gap-3">
                            <button
                                type="button"
                                disabled={actionId != null}
                                onClick={() => setDeleteTarget(null)}
                                className="flex-1 py-2.5 rounded-xl border border-border text-muted font-semibold hover:bg-white/5 transition-colors disabled:opacity-50"
                            >
                                {t('common.cancel')}
                            </button>
                            <button
                                type="button"
                                disabled={actionId != null}
                                onClick={handleDelete}
                                className="flex-1 py-2.5 rounded-xl bg-red-500 text-white font-bold hover:bg-red-600 transition-colors disabled:opacity-50"
                            >
                                {actionId != null ? t('issuesAdmin.actions.deleting') : t('issuesAdmin.actions.deleteIssue')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
