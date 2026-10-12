import React, { useCallback, useEffect, useState } from 'react';
import { FileText, Loader2, RefreshCw, Search, Wand2 } from 'lucide-react';
import { apiFetch } from '../shared/api';
import { DashboardHero, DashboardPageShell } from '../shared/dashboard/DashboardChrome';

type FillLogRow = {
    at?: string;
    ok?: boolean;
    skipped?: boolean;
    reason?: string;
    showTitle?: string;
    title?: string;
    seasonNumber?: number;
    episodeNumber?: number;
    sources?: string[];
    source?: string;
    ratingKey?: string;
};

type ShowHit = {
    ratingKey: string;
    title: string;
    year?: number | null;
    tmdbId?: string | null;
    tvdbId?: string | null;
};

type Status = {
    enabled: boolean;
    autoImport: boolean;
    tmdbConfigured: boolean;
    tvdbConfigured: boolean;
    tvmazeConfigured: boolean;
    log: FillLogRow[];
};

export const MetadataFillPage: React.FC = () => {
    const [status, setStatus] = useState<Status | null>(null);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);
    const [query, setQuery] = useState('');
    const [hits, setHits] = useState<ShowHit[]>([]);
    const [searching, setSearching] = useState(false);
    const [fillingKey, setFillingKey] = useState('');
    const [busyToggle, setBusyToggle] = useState('');

    const load = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const data = await apiFetch('/api/metadata-fill/status');
            setStatus({
                enabled: !!data?.enabled,
                autoImport: data?.autoImport !== false,
                tmdbConfigured: !!data?.tmdbConfigured,
                tvdbConfigured: !!data?.tvdbConfigured,
                tvmazeConfigured: data?.tvmazeConfigured !== false,
                log: Array.isArray(data?.log) ? data.log : [],
            });
        } catch (e: any) {
            setError(e?.message || 'Failed to load Metadata Fill');
            setStatus(null);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    const saveSettings = async (patch: { enabled?: boolean; autoImport?: boolean }) => {
        setBusyToggle(patch.enabled !== undefined ? 'enabled' : 'auto');
        setError('');
        try {
            const data = await apiFetch('/api/metadata-fill/settings', {
                method: 'POST',
                body: JSON.stringify(patch),
            });
            setStatus((prev) => prev ? {
                ...prev,
                enabled: !!data?.enabled,
                autoImport: data?.autoImport !== false,
            } : prev);
            await load();
        } catch (e: any) {
            setError(e?.message || 'Failed to save settings');
        } finally {
            setBusyToggle('');
        }
    };

    const runSearch = async () => {
        const q = query.trim();
        if (!q) return;
        setSearching(true);
        setError('');
        try {
            const data = await apiFetch(`/api/metadata-fill/search?q=${encodeURIComponent(q)}`);
            setHits(Array.isArray(data?.items) ? data.items : []);
        } catch (e: any) {
            setError(e?.message || 'Search failed');
            setHits([]);
        } finally {
            setSearching(false);
        }
    };

    const fillShow = async (ratingKey: string) => {
        setFillingKey(ratingKey);
        setError('');
        try {
            const result = await apiFetch('/api/metadata-fill/fill-show', {
                method: 'POST',
                body: JSON.stringify({ ratingKey }),
            });
            setError('');
            await load();
            if (result?.failed > 0) {
                setError(`Filled ${result.filled || 0}, skipped ${result.skipped || 0}, failed ${result.failed}.`);
            }
        } catch (e: any) {
            setError(e?.message || 'Fill failed');
        } finally {
            setFillingKey('');
        }
    };

    return (
        <DashboardPageShell>
            <DashboardHero
                accent="plex"
                eyebrow="Metadata Fill"
                title="Fill TBA episode metadata from TMDB, TVDB, and TVmaze"
                description="When Plex is slow to scrape, write locked title, summary, and air date from TMDB, TheTVDB, and TVmaze — automatically on Sonarr import, or manually per show."
                icon={<Wand2 className="h-5 w-5" />}
                secondaryBlob
                actions={(
                    <button
                        type="button"
                        onClick={() => { void load(); }}
                        className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-text hover:bg-white/10"
                    >
                        <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                        Refresh
                    </button>
                )}
            />

            {error && (
                <p className="mt-4 text-sm text-red-300/90">{error}</p>
            )}

            <div className="mt-6 grid gap-4 md:grid-cols-2">
                <section className="rounded-2xl border border-white/10 bg-background/40 p-4 space-y-3">
                    <h2 className="text-sm font-bold uppercase tracking-wider text-muted">Settings</h2>
                    <label className="flex items-center justify-between gap-3 text-sm text-text">
                        <span>Enable Metadata Fill</span>
                        <input
                            type="checkbox"
                            checked={!!status?.enabled}
                            disabled={!!busyToggle || loading}
                            onChange={(e) => { void saveSettings({ enabled: e.target.checked }); }}
                        />
                    </label>
                    <label className="flex items-center justify-between gap-3 text-sm text-text">
                        <span>Auto-fill on Sonarr import</span>
                        <input
                            type="checkbox"
                            checked={status?.autoImport !== false}
                            disabled={!status?.enabled || !!busyToggle || loading}
                            onChange={(e) => { void saveSettings({ autoImport: e.target.checked }); }}
                        />
                    </label>
                    <p className="text-xs text-muted">
                        Sources: TMDB {status?.tmdbConfigured ? 'ready' : 'missing key'}
                        {' · '}TVDB {status?.tvdbConfigured ? 'ready' : 'missing key'}
                        {' · '}TVmaze {status?.tvmazeConfigured !== false ? 'ready (no key)' : 'off'}
                        {' '}— TMDB under Media Stack; TVDB under Request → Metadata providers (Portal engine).
                    </p>
                    <p className="text-xs text-muted">
                        Auto-import uses the Scanner Sonarr webhook. Enable Scanner and point Sonarr at the same Download trigger.
                    </p>
                </section>

                <section className="rounded-2xl border border-white/10 bg-background/40 p-4 space-y-3">
                    <h2 className="text-sm font-bold uppercase tracking-wider text-muted">Fill this show</h2>
                    <div className="flex gap-2">
                        <input
                            type="search"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') void runSearch();
                            }}
                            placeholder="Search Plex shows…"
                            disabled={!status?.enabled}
                            className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-text"
                        />
                        <button
                            type="button"
                            disabled={!status?.enabled || searching || !query.trim()}
                            onClick={() => { void runSearch(); }}
                            className="inline-flex items-center gap-2 rounded-xl bg-plex px-3 py-2 text-sm font-bold text-background disabled:opacity-40"
                        >
                            {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                            Search
                        </button>
                    </div>
                    <ul className="space-y-2 max-h-64 overflow-auto">
                        {hits.map((hit) => (
                            <li
                                key={hit.ratingKey}
                                className="flex items-center justify-between gap-2 rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2"
                            >
                                <div className="min-w-0">
                                    <p className="truncate text-sm font-semibold text-text">
                                        {hit.title}{hit.year ? ` (${hit.year})` : ''}
                                    </p>
                                    <p className="text-[11px] text-muted truncate">
                                        TMDB {hit.tmdbId || '—'} · TVDB {hit.tvdbId || '—'}
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    disabled={fillingKey === hit.ratingKey}
                                    onClick={() => { void fillShow(hit.ratingKey); }}
                                    className="shrink-0 rounded-lg border border-plex/40 bg-plex/15 px-2.5 py-1.5 text-xs font-bold text-plex"
                                >
                                    {fillingKey === hit.ratingKey ? (
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    ) : 'Fill'}
                                </button>
                            </li>
                        ))}
                        {!hits.length && !searching && (
                            <li className="text-xs text-muted">Search a show to fill episodes that still have TBA / empty metadata.</li>
                        )}
                    </ul>
                </section>
            </div>

            <section className="mt-6 rounded-2xl border border-white/10 bg-background/40 p-4">
                <h2 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-muted">
                    <FileText className="h-4 w-4" />
                    Recent activity
                </h2>
                <ul className="space-y-2 max-h-96 overflow-auto">
                    {(status?.log || []).slice(0, 40).map((row, index) => (
                        <li
                            key={`${row.at || index}-${row.ratingKey || index}`}
                            className="rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2 text-xs"
                        >
                            <div className="flex flex-wrap items-center gap-2 text-text">
                                <span className={row.ok === false ? 'text-red-300' : row.skipped ? 'text-muted' : 'text-green-300'}>
                                    {row.ok === false ? 'Failed' : row.skipped ? 'Skipped' : 'Filled'}
                                </span>
                                <span className="font-semibold">
                                    {row.showTitle || 'Show'}
                                    {row.seasonNumber != null && row.episodeNumber != null
                                        ? ` S${String(row.seasonNumber).padStart(2, '0')}E${String(row.episodeNumber).padStart(2, '0')}`
                                        : ''}
                                    {row.title ? ` — ${row.title}` : ''}
                                </span>
                            </div>
                            <p className="mt-0.5 text-muted">
                                {row.at ? new Date(row.at).toLocaleString() : ''}
                                {row.source ? ` · ${row.source}` : ''}
                                {row.sources?.length ? ` · ${row.sources.join('+')}` : ''}
                                {row.reason ? ` · ${row.reason}` : ''}
                            </p>
                        </li>
                    ))}
                    {!status?.log?.length && (
                        <li className="text-xs text-muted">No fills yet.</li>
                    )}
                </ul>
            </section>
        </DashboardPageShell>
    );
};

export default MetadataFillPage;
