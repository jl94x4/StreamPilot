import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Ban,
    ExternalLink,
    Film,
    Loader2,
    RefreshCw,
    Search,
    Trash2,
    Tv,
} from 'lucide-react';
import { apiFetch } from '../shared/api';
import { formatDateTime } from '../shared/format';
import { Loader, ToastContainer, pushToast, type ToastMessage } from '../shared/toast';
import { dashboardPanelClass } from '../shared/dashboard/DashboardChrome';
import { RequestCardActions, RequestCardShell, requestCardActionBtnClass } from './RequestCardShell';
import type { PortalBlocklistItem, PortalBlocklistSearchResult } from './types';

type BlocklistFilter = 'manual' | 'all' | 'blocklistedTags';

const posterUrlFromPath = (posterPath?: string | null) => (
    posterPath
        ? (posterPath.startsWith('http')
            ? posterPath
            : `https://image.tmdb.org/t/p/w342${posterPath.startsWith('/') ? posterPath : `/${posterPath}`}`)
        : ''
);

const TypeBadge: React.FC<{ type: string }> = ({ type }) => (
    <span className="text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full bg-white/5 border border-border text-muted">
        {type === 'tv' ? 'TV' : 'Movie'}
    </span>
);

export const BlocklistAdminPanel: React.FC = () => {
    const [toasts, setToasts] = useState<ToastMessage[]>([]);
    const [filter, setFilter] = useState<BlocklistFilter>('manual');
    const [listSearch, setListSearch] = useState('');
    const [items, setItems] = useState<PortalBlocklistItem[]>([]);
    const [counts, setCounts] = useState({
        total: 0,
        configured: false,
        connected: false,
        supported: true,
    });
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [actionKey, setActionKey] = useState<string | null>(null);
    const [removeTarget, setRemoveTarget] = useState<PortalBlocklistItem | null>(null);

    const [addQuery, setAddQuery] = useState('');
    const [addSearching, setAddSearching] = useState(false);
    const [addResults, setAddResults] = useState<PortalBlocklistSearchResult[]>([]);
    const [addError, setAddError] = useState<string | null>(null);

    const addToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
        setToasts((prev) => pushToast(prev, message, type));
    }, []);

    const loadData = useCallback(async (opts?: { silent?: boolean }) => {
        if (!opts?.silent) setLoading(true);
        else setRefreshing(true);
        setError(null);
        try {
            const countData = await apiFetch('/api/blocklist/count');
            const nextCounts = {
                total: Number(countData?.total) || 0,
                configured: !!countData?.configured,
                connected: !!countData?.connected,
                supported: countData?.supported !== false,
            };
            setCounts(nextCounts);

            if (!nextCounts.configured) {
                setItems([]);
                return;
            }
            if (!nextCounts.supported || !nextCounts.connected) {
                setItems([]);
                setError(countData?.error || 'Cannot connect to your request app');
                return;
            }

            const params = new URLSearchParams({
                filter,
                take: '40',
            });
            if (listSearch.trim()) params.set('search', listSearch.trim());

            const listData = await apiFetch(`/api/blocklist?${params.toString()}`);
            if (listData?.connected === false) {
                setItems([]);
                setError(listData?.error || 'Cannot connect to your request app');
                return;
            }
            setItems(Array.isArray(listData?.results) ? listData.results : []);
        } catch (e: any) {
            setError(e?.message || 'Failed to load blocklist');
            setItems([]);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [filter, listSearch]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const filterTabs = useMemo(() => ([
        { id: 'manual' as const, label: 'Manual', count: filter === 'manual' ? items.length : null },
        { id: 'blocklistedTags' as const, label: 'By tags', count: filter === 'blocklistedTags' ? items.length : null },
        { id: 'all' as const, label: 'All', count: counts.total },
    ]), [counts.total, filter, items.length]);

    const handleSearchAdd = async () => {
        const query = addQuery.trim();
        if (!query) return;
        setAddSearching(true);
        setAddError(null);
        try {
            const data = await apiFetch(`/api/blocklist/search?query=${encodeURIComponent(query)}`);
            setAddResults(Array.isArray(data?.results) ? data.results : []);
            if (!data?.results?.length) {
                setAddError('No movies or TV shows matched that search.');
            }
        } catch (e: any) {
            setAddError(e?.message || 'Search failed');
            setAddResults([]);
        } finally {
            setAddSearching(false);
        }
    };

    const handleAdd = async (candidate: PortalBlocklistSearchResult) => {
        if (!candidate.tmdbId) return;
        const key = `add-${candidate.mediaType}-${candidate.tmdbId}`;
        setActionKey(key);
        try {
            await apiFetch('/api/blocklist', {
                method: 'POST',
                body: JSON.stringify({
                    tmdbId: candidate.tmdbId,
                    mediaType: candidate.mediaType,
                    title: candidate.title,
                }),
            });
            addToast(`Blocklisted "${candidate.title}"`);
            setAddResults((prev) => prev.filter((item) => item.tmdbId !== candidate.tmdbId));
            await loadData({ silent: true });
        } catch (e: any) {
            addToast(e?.message || 'Failed to blocklist title', 'error');
        } finally {
            setActionKey(null);
        }
    };

    const handleRemove = async () => {
        if (!removeTarget?.tmdbId) return;
        const key = `remove-${removeTarget.mediaType}-${removeTarget.tmdbId}`;
        setActionKey(key);
        try {
            await apiFetch(
                `/api/blocklist/${removeTarget.tmdbId}?mediaType=${encodeURIComponent(removeTarget.mediaType)}`,
                { method: 'DELETE' },
            );
            addToast(`Removed "${removeTarget.title}" from blocklist`);
            setRemoveTarget(null);
            await loadData({ silent: true });
        } catch (e: any) {
            addToast(e?.message || 'Failed to remove blocklist entry', 'error');
        } finally {
            setActionKey(null);
        }
    };

    const seerrLink = items[0]?.seerrUrl?.replace(/\/(movie|tv)\/\d+$/, '/blacklist')
        || items[0]?.seerrUrl?.replace(/\/(movie|tv)\/\d+$/, '/blocklist')
        || null;

    return (
        <div className="w-full max-w-[100%] animate-fade-in">
            <Loader isLoading={loading && items.length === 0} />
            <ToastContainer toasts={toasts} setToasts={setToasts} />

            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
                <div>
                    <h2 className="text-2xl md:text-3xl font-bold text-plex">Blocklist</h2>
                    <p className="text-sm text-muted mt-1">
                        {counts.configured && counts.connected
                            ? `${counts.total} blocked title${counts.total === 1 ? '' : 's'} — members cannot request these`
                            : counts.configured
                                ? 'Request app is configured — connection failed (see below)'
                                : 'Connect Seerr in Settings → Integrations to manage the blocklist here.'}
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
                            Open Seerr <ExternalLink className="w-4 h-4" />
                        </a>
                    )}
                    <button
                        type="button"
                        onClick={() => loadData({ silent: true })}
                        disabled={refreshing}
                        className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-border text-text text-sm font-semibold hover:bg-opacity-80 transition-colors disabled:opacity-50"
                    >
                        <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
                        Refresh
                    </button>
                </div>
            </div>

            <div className={`${dashboardPanelClass} p-4 md:p-5 mb-6`}>
                <h3 className="text-sm font-bold uppercase tracking-wider text-muted mb-3">Add to blocklist</h3>
                <div className="flex flex-col sm:flex-row gap-2">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
                        <input
                            type="text"
                            inputMode="search"
                            value={addQuery}
                            onChange={(e) => setAddQuery(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSearchAdd();
                            }}
                            placeholder="Search movies or TV shows by title..."
                            className="w-full appearance-none pl-10 pr-4 py-2.5 rounded-lg border border-border bg-background text-[16px] leading-5 text-text outline-none focus:border-plex transition-colors"
                        />
                    </div>
                    <button
                        type="button"
                        onClick={handleSearchAdd}
                        disabled={addSearching || !addQuery.trim()}
                        className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-plex text-black font-bold hover:brightness-110 transition disabled:opacity-50"
                    >
                        {addSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                        Search
                    </button>
                </div>
                {addError && (
                    <p className="text-sm text-amber-300/90 mt-3">{addError}</p>
                )}
                {addResults.length > 0 && (
                    <div className="mt-4 space-y-2">
                        {addResults.map((candidate) => {
                            const poster = posterUrlFromPath(candidate.posterPath);
                            const key = `add-${candidate.mediaType}-${candidate.tmdbId}`;
                            return (
                                <div
                                    key={key}
                                    className="flex items-center gap-3 p-3 rounded-lg border border-border bg-background/60"
                                >
                                    <div className="w-10 h-14 rounded-md overflow-hidden bg-white/5 shrink-0">
                                        {poster ? (
                                            <img src={poster} alt="" className="w-full h-full object-cover" />
                                        ) : (
                                            <div className="w-full h-full flex items-center justify-center text-muted">
                                                {candidate.mediaType === 'tv' ? <Tv className="w-4 h-4" /> : <Film className="w-4 h-4" />}
                                            </div>
                                        )}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <p className="font-semibold text-text truncate">{candidate.title}</p>
                                            <TypeBadge type={candidate.mediaType} />
                                            {candidate.year && (
                                                <span className="text-xs text-muted">{candidate.year}</span>
                                            )}
                                        </div>
                                        {candidate.overview && (
                                            <p className="text-xs text-muted line-clamp-2 mt-1">{candidate.overview}</p>
                                        )}
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => handleAdd(candidate)}
                                        disabled={actionKey === key}
                                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-red-600/90 text-white text-xs font-bold hover:bg-red-500 transition disabled:opacity-50 shrink-0"
                                    >
                                        {actionKey === key ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Ban className="w-3.5 h-3.5" />}
                                        Block
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            <div className="flex flex-wrap gap-2 mb-4">
                {filterTabs.map((tab) => (
                    <button
                        key={tab.id}
                        type="button"
                        onClick={() => setFilter(tab.id)}
                        className={`px-3 py-2 rounded-lg text-sm font-bold border transition-colors ${
                            filter === tab.id
                                ? 'bg-plex/15 border-plex/40 text-text'
                                : 'bg-white/[0.03] border-border text-muted hover:text-text hover:border-white/20'
                        }`}
                    >
                        {tab.label}
                        {tab.count != null && (
                            <span className="ml-1.5 text-xs opacity-80">({tab.count})</span>
                        )}
                    </button>
                ))}
            </div>

            <div className="flex flex-col sm:flex-row gap-2 mb-4">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
                    <input
                        type="text"
                        inputMode="search"
                        value={listSearch}
                        onChange={(e) => setListSearch(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') loadData();
                        }}
                        placeholder="Filter blocklisted titles..."
                        className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-border bg-background text-text outline-none focus:border-plex transition-colors"
                    />
                </div>
                <button
                    type="button"
                    onClick={() => loadData({ silent: true })}
                    className="px-4 py-2.5 rounded-lg border border-border text-sm font-semibold text-muted hover:text-text transition-colors"
                >
                    Apply filter
                </button>
            </div>

            {error && (
                <div className="mb-4 px-4 py-3 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-100 text-sm">
                    {error}
                </div>
            )}

            {!loading && !error && items.length === 0 && (
                <div className={`${dashboardPanelClass} p-8 text-center text-muted`}>
                    <Ban className="w-10 h-10 mx-auto mb-3 opacity-40" />
                    <p className="font-medium text-text">No blocklisted titles in this view</p>
                    <p className="text-sm mt-1">Search above to block movies or TV shows from being requested.</p>
                </div>
            )}

            <div className="space-y-3">
                {items.map((item) => {
                    const key = `${item.mediaType}-${item.tmdbId}`;
                    const removing = actionKey === `remove-${item.mediaType}-${item.tmdbId}`;
                    return (
                        <RequestCardShell key={key} posterUrl={item.posterUrl}>
                            <div className="flex flex-col sm:flex-row gap-4 p-4">
                                <div className="flex gap-3 flex-1 min-w-0">
                                    <div className="w-14 h-20 rounded-lg overflow-hidden bg-white/5 shrink-0 border border-white/10">
                                        {item.posterUrl ? (
                                            <img src={item.posterUrl} alt="" className="w-full h-full object-cover" />
                                        ) : (
                                            <div className="w-full h-full flex items-center justify-center text-muted">
                                                {item.mediaType === 'tv' ? <Tv className="w-5 h-5" /> : <Film className="w-5 h-5" />}
                                            </div>
                                        )}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-2 mb-1">
                                            <h3 className="font-bold text-text truncate">{item.title}</h3>
                                            <TypeBadge type={item.mediaType} />
                                        </div>
                                        <p className="text-xs text-muted">
                                            Blocked by {item.addedBy.displayName}
                                            {item.createdAt ? ` · ${formatDateTime(item.createdAt)}` : ''}
                                        </p>
                                        {item.blocklistedTags && (
                                            <p className="text-xs text-amber-200/80 mt-1">Tags: {item.blocklistedTags}</p>
                                        )}
                                    </div>
                                </div>
                                <RequestCardActions>
                                    {item.seerrUrl && (
                                        <a
                                            href={item.seerrUrl}
                                            target="_blank"
                                            rel="noreferrer"
                                            className={`${requestCardActionBtnClass} border border-border text-muted hover:text-text hover:bg-white/5`}
                                        >
                                            <ExternalLink className="w-3.5 h-3.5" />
                                            View
                                        </a>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => setRemoveTarget(item)}
                                        disabled={removing}
                                        className={`${requestCardActionBtnClass} border border-red-500/30 text-red-300 hover:bg-red-500/10`}
                                    >
                                        {removing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                                        Unblock
                                    </button>
                                </RequestCardActions>
                            </div>
                        </RequestCardShell>
                    );
                })}
            </div>

            {removeTarget && (
                <div className="fixed inset-0 z-[1200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                    <div className="w-full max-w-md glass-card p-5 shadow-2xl border border-border">
                        <h3 className="text-lg font-bold text-text mb-1">Remove from blocklist</h3>
                        <p className="text-sm text-muted mb-4">
                            Allow requests again for <span className="text-text font-medium">{removeTarget.title}</span>?
                        </p>
                        <div className="flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => setRemoveTarget(null)}
                                className="px-4 py-2 rounded-lg border border-border text-muted hover:text-text transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={handleRemove}
                                disabled={!!actionKey}
                                className="px-4 py-2 rounded-lg bg-red-600 text-white font-bold hover:bg-red-500 transition-colors disabled:opacity-50"
                            >
                                {actionKey ? 'Removing...' : 'Unblock title'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
