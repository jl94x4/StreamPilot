import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    FileText, Loader2, Play, RefreshCw, RotateCcw, Search, Square, Unlock, Wand2,
} from 'lucide-react';
import { apiFetch } from '../shared/api';
import { DashboardHero, DashboardPageShell } from '../shared/dashboard/DashboardChrome';

type FillLogRow = {
    id?: string;
    at?: string;
    ok?: boolean;
    skipped?: boolean;
    dryRun?: boolean;
    reverted?: boolean;
    unlocked?: boolean;
    reason?: string;
    showTitle?: string;
    title?: string;
    seasonNumber?: number;
    episodeNumber?: number;
    sources?: string[];
    source?: string;
    ratingKey?: string;
    before?: { title?: string; summary?: string; originallyAvailableAt?: string };
    after?: { title?: string; summary?: string; originallyAvailableAt?: string };
    airDate?: string;
    reversible?: boolean;
};

type ShowHit = {
    ratingKey: string;
    title: string;
    year?: number | null;
    tmdbId?: string | null;
    tvdbId?: string | null;
};

type LibraryRow = { key: string; title: string };

type FillFields = {
    title: boolean;
    summary: boolean;
    originallyAvailableAt: boolean;
};

type AuditItem = {
    ratingKey: string;
    showRatingKey?: string;
    showTitle?: string;
    libraryTitle?: string | null;
    seasonNumber?: number;
    episodeNumber?: number;
    title?: string;
};

type RetryItem = {
    id: string;
    showTitle?: string | null;
    seasonNumber?: number | null;
    episodeNumber?: number | null;
    lastError?: string | null;
    attempts?: number;
    enqueuedAt?: string;
};

type ScanState = {
    status?: string;
    dryRun?: boolean;
    inProcess?: boolean;
    cancelRequested?: boolean;
    stats?: {
        scanned?: number;
        needingFill?: number;
        previewed?: number;
        filled?: number;
        skipped?: number;
        failed?: number;
    };
    cursor?: {
        libraryTitle?: string;
        showTitle?: string;
        libraryIndex?: number;
        showStart?: number;
    };
    preview?: Array<{
        ratingKey: string;
        ok?: boolean;
        skipped?: boolean;
        reason?: string;
        showTitle?: string;
        seasonNumber?: number;
        episodeNumber?: number;
        title?: string;
        airDate?: string;
        sources?: string[];
        before?: FillLogRow['before'];
        after?: FillLogRow['after'];
    }>;
    libraries?: Array<{ key: string; title: string }>;
    error?: string | null;
    startedAt?: string | null;
    finishedAt?: string | null;
};

type Status = {
    enabled: boolean;
    autoImport: boolean;
    fields: FillFields;
    sourcePreference: 'auto' | 'tmdb' | 'tvdb';
    requireTitleAgreement: boolean;
    libraryKeys: string[];
    libraries: LibraryRow[];
    tmdbConfigured: boolean;
    tvdbConfigured: boolean;
    tvmazeConfigured: boolean;
    log: FillLogRow[];
    retryQueue: RetryItem[];
    scan: ScanState | null;
};

const defaultFields = (): FillFields => ({
    title: true,
    summary: true,
    originallyAvailableAt: true,
});

type LogFilter = 'all' | 'filled' | 'failed' | 'preview' | 'skipped' | 'reverted';
type PreviewFilter = 'all' | 'ok' | 'failed' | 'skipped';

const reasonLabel = (reason?: string) => {
    switch (String(reason || '')) {
        case 'no-source-data': return 'no metadata from sources';
        case 'no-usable-fields': return 'nothing useful left to write';
        case 'title-source-conflict': return 'title sources disagree';
        case 'already-filled': return 'already filled';
        case 'missing-season-episode': return 'missing season/episode numbers';
        case 'bad-episode-index': return 'bad episode index';
        case 'nothing-to-write': return 'nothing to write';
        default: return reason || '';
    }
};

const statusLabel = (row: FillLogRow) => {
    if (row.unlocked) return 'Unlocked';
    if (row.reverted) return 'Reverted';
    if (row.ok === false) return 'Error';
    if (row.dryRun) return 'Preview';
    if (row.skipped) return 'Left alone';
    return 'Filled';
};

const statusClass = (row: FillLogRow) => {
    if (row.unlocked || row.reverted) return 'text-amber-300';
    if (row.ok === false) return 'text-red-300';
    if (row.dryRun) return 'text-sky-300';
    if (row.skipped) return 'text-muted';
    return 'text-green-300';
};

export const MetadataFillPage: React.FC = () => {
    const [status, setStatus] = useState<Status | null>(null);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [loading, setLoading] = useState(true);
    const [query, setQuery] = useState('');
    const [hits, setHits] = useState<ShowHit[]>([]);
    const [searching, setSearching] = useState(false);
    const [fillingKey, setFillingKey] = useState('');
    const [busyToggle, setBusyToggle] = useState('');
    const [scanDryRun, setScanDryRun] = useState(true);
    const [scanBusy, setScanBusy] = useState(false);
    const [retryBusy, setRetryBusy] = useState(false);
    const [logFilter, setLogFilter] = useState<LogFilter>('all');
    const [logQuery, setLogQuery] = useState('');
    const [previewFilter, setPreviewFilter] = useState<PreviewFilter>('all');
    const [rowBusy, setRowBusy] = useState('');
    const [auditBusy, setAuditBusy] = useState(false);
    const [auditItems, setAuditItems] = useState<AuditItem[]>([]);
    const [bulkBusy, setBulkBusy] = useState('');

    const load = useCallback(async (silent = false) => {
        if (!silent) setLoading(true);
        setError('');
        try {
            const data = await apiFetch('/api/metadata-fill/status');
            const fields = data?.fields && typeof data.fields === 'object'
                ? {
                    title: data.fields.title !== false,
                    summary: data.fields.summary !== false,
                    originallyAvailableAt: data.fields.originallyAvailableAt !== false,
                }
                : defaultFields();
            const pref = String(data?.sourcePreference || 'auto').toLowerCase();
            setStatus({
                enabled: !!data?.enabled,
                autoImport: data?.autoImport !== false,
                fields,
                sourcePreference: pref === 'tmdb' || pref === 'tvdb' ? pref : 'auto',
                requireTitleAgreement: !!data?.requireTitleAgreement,
                libraryKeys: Array.isArray(data?.libraryKeys) ? data.libraryKeys.map(String) : [],
                libraries: Array.isArray(data?.libraries) ? data.libraries : [],
                tmdbConfigured: !!data?.tmdbConfigured,
                tvdbConfigured: !!data?.tvdbConfigured,
                tvmazeConfigured: data?.tvmazeConfigured !== false,
                log: Array.isArray(data?.log) ? data.log : [],
                retryQueue: Array.isArray(data?.retryQueue) ? data.retryQueue : [],
                scan: data?.scan || null,
            });
            if (data?.scan?.dryRun != null) setScanDryRun(!!data.scan.dryRun);
        } catch (e: any) {
            setError(e?.message || 'Failed to load Metadata Fill');
            if (!silent) setStatus(null);
        } finally {
            if (!silent) setLoading(false);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    // inProcess is the live Node flag; disk status alone can be stale after a restart.
    const scanRunning = !!status?.scan?.inProcess;
    const canResume = !scanRunning && !!status?.scan?.cursor && (
        ['interrupted', 'cancelled', 'running'].includes(String(status?.scan?.status || ''))
    );

    useEffect(() => {
        if (!scanRunning) return undefined;
        const id = window.setInterval(() => { void load(true); }, 2500);
        return () => window.clearInterval(id);
    }, [scanRunning, load]);

    const saveSettings = async (patch: Record<string, unknown>, busyKey = 'settings') => {
        setBusyToggle(busyKey);
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
                fields: data?.fields && typeof data.fields === 'object' ? {
                    title: data.fields.title !== false,
                    summary: data.fields.summary !== false,
                    originallyAvailableAt: data.fields.originallyAvailableAt !== false,
                } : prev.fields,
                sourcePreference: (data?.sourcePreference === 'tmdb' || data?.sourcePreference === 'tvdb')
                    ? data.sourcePreference
                    : (data?.sourcePreference ? 'auto' : prev.sourcePreference),
                requireTitleAgreement: !!data?.requireTitleAgreement,
                libraryKeys: Array.isArray(data?.libraryKeys) ? data.libraryKeys.map(String) : prev.libraryKeys,
            } : prev);
            await load(true);
        } catch (e: any) {
            setError(e?.message || 'Failed to save settings');
        } finally {
            setBusyToggle('');
        }
    };

    const toggleLibraryKey = (key: string) => {
        if (!status) return;
        const set = new Set(status.libraryKeys);
        if (set.has(key)) set.delete(key);
        else set.add(key);
        void saveSettings({ libraryKeys: [...set] }, 'libraries');
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

    const fillShow = async (ratingKey: string, dryRun = false) => {
        setFillingKey(`${ratingKey}:${dryRun ? 'preview' : 'fill'}`);
        setError('');
        setNotice('');
        try {
            const result = await apiFetch('/api/metadata-fill/fill-show', {
                method: 'POST',
                body: JSON.stringify({ ratingKey, dryRun }),
            });
            await load(true);
            const still = Array.isArray(result?.stillTba) ? result.stillTba.length : 0;
            if (dryRun) {
                setNotice(`Preview: ${result?.previewed || 0} episode(s) would be filled.`);
            } else if (result?.failed > 0) {
                setError(`Filled ${result.filled || 0}, left alone ${result.skipped || 0}, errors ${result.failed}${still ? `, still TBA ${still}` : ''}.`);
            } else {
                setNotice(`Filled ${result.filled || 0}, left alone ${result.skipped || 0}${still ? `, still TBA ${still}` : ''}.`);
                if (still) setAuditItems(result.stillTba);
            }
        } catch (e: any) {
            setError(e?.message || 'Fill failed');
        } finally {
            setFillingKey('');
        }
    };

    const bulkShow = async (ratingKey: string, mode: 'unlock' | 'revert') => {
        setBulkBusy(`${mode}:${ratingKey}`);
        setError('');
        setNotice('');
        try {
            const result = await apiFetch(`/api/metadata-fill/bulk-${mode}`, {
                method: 'POST',
                body: JSON.stringify({ showRatingKey: ratingKey }),
            });
            await load(true);
            if (mode === 'unlock') {
                setNotice(`Unlocked ${result?.unlocked || 0} episode(s) for this show.`);
            } else {
                setNotice(`Reverted ${result?.reverted || 0} episode(s) for this show.`);
            }
        } catch (e: any) {
            setError(e?.message || `Bulk ${mode} failed`);
        } finally {
            setBulkBusy('');
        }
    };

    const runAudit = async (showRatingKey?: string) => {
        setAuditBusy(true);
        setError('');
        try {
            const result = await apiFetch('/api/metadata-fill/audit', {
                method: 'POST',
                body: JSON.stringify({
                    showRatingKey: showRatingKey || undefined,
                    libraryKeys: status?.libraryKeys?.length ? status.libraryKeys : undefined,
                    limit: 200,
                }),
            });
            const items = Array.isArray(result?.items) ? result.items : [];
            setAuditItems(items);
            setNotice(items.length
                ? `Audit found ${items.length} episode(s) still needing fill${result?.truncated ? ' (truncated)' : ''}.`
                : 'Audit: nothing still TBA in scope.');
        } catch (e: any) {
            setError(e?.message || 'Audit failed');
        } finally {
            setAuditBusy(false);
        }
    };

    const startScan = async (resume = false) => {
        setScanBusy(true);
        setError('');
        setNotice('');
        try {
            await apiFetch('/api/metadata-fill/scan/start', {
                method: 'POST',
                body: JSON.stringify({ dryRun: scanDryRun, resume }),
            });
            setNotice(resume
                ? 'Resumed library scan.'
                : (scanDryRun ? 'Library preview scan started.' : 'Library fill scan started.'));
            await load(true);
        } catch (e: any) {
            setError(e?.message || 'Failed to start scan');
        } finally {
            setScanBusy(false);
        }
    };

    const cancelScan = async () => {
        setScanBusy(true);
        try {
            await apiFetch('/api/metadata-fill/scan/cancel', { method: 'POST', body: '{}' });
            setNotice('Cancel requested. Scan will stop after the current episode.');
            await load(true);
        } catch (e: any) {
            setError(e?.message || 'Failed to cancel scan');
        } finally {
            setScanBusy(false);
        }
    };

    const applyPreview = async () => {
        setScanBusy(true);
        setError('');
        try {
            const result = await apiFetch('/api/metadata-fill/scan/apply', {
                method: 'POST',
                body: JSON.stringify({}),
            });
            setNotice(`Applied ${result?.applied || 0} previewed fill(s).`);
            await load(true);
        } catch (e: any) {
            setError(e?.message || 'Failed to apply preview');
        } finally {
            setScanBusy(false);
        }
    };

    const processRetries = async () => {
        setRetryBusy(true);
        setError('');
        try {
            const result = await apiFetch('/api/metadata-fill/retry/process', {
                method: 'POST',
                body: JSON.stringify({ limit: 15 }),
            });
            setNotice(`Retry: ${result?.removed || 0} resolved, ${result?.remaining ?? '?'} remaining.`);
            await load(true);
        } catch (e: any) {
            setError(e?.message || 'Retry failed');
        } finally {
            setRetryBusy(false);
        }
    };

    const clearRetries = async () => {
        setRetryBusy(true);
        try {
            await apiFetch('/api/metadata-fill/retry/clear', { method: 'POST', body: '{}' });
            await load(true);
        } catch (e: any) {
            setError(e?.message || 'Failed to clear retry queue');
        } finally {
            setRetryBusy(false);
        }
    };

    const revertRow = async (row: FillLogRow) => {
        const key = row.id || row.ratingKey || '';
        setRowBusy(`revert:${key}`);
        setError('');
        try {
            const result = await apiFetch('/api/metadata-fill/revert', {
                method: 'POST',
                body: JSON.stringify({ logId: row.id, ratingKey: row.ratingKey, unlock: true }),
            });
            if (result?.ok === false) setError(result?.reason || 'Revert failed');
            else setNotice('Reverted and unlocked episode fields.');
            await load(true);
        } catch (e: any) {
            setError(e?.message || 'Revert failed');
        } finally {
            setRowBusy('');
        }
    };

    const unlockRow = async (row: FillLogRow) => {
        if (!row.ratingKey) return;
        setRowBusy(`unlock:${row.ratingKey}`);
        setError('');
        try {
            await apiFetch('/api/metadata-fill/unlock', {
                method: 'POST',
                body: JSON.stringify({ ratingKey: row.ratingKey }),
            });
            setNotice('Unlocked episode fields in Plex.');
            await load(true);
        } catch (e: any) {
            setError(e?.message || 'Unlock failed');
        } finally {
            setRowBusy('');
        }
    };

    const retryRow = async (row: FillLogRow) => {
        if (!row.ratingKey) return;
        setRowBusy(`retry:${row.ratingKey}`);
        setError('');
        try {
            await apiFetch('/api/metadata-fill/fill-episode', {
                method: 'POST',
                body: JSON.stringify({ ratingKey: row.ratingKey }),
            });
            await load(true);
        } catch (e: any) {
            setError(e?.message || 'Retry fill failed');
        } finally {
            setRowBusy('');
        }
    };

    const filteredLog = useMemo(() => {
        let rows = status?.log || [];
        if (logFilter === 'failed') rows = rows.filter((r) => r.ok === false);
        else if (logFilter === 'filled') {
            rows = rows.filter((r) => r.ok && !r.skipped && !r.dryRun && !r.reverted && !r.unlocked);
        } else if (logFilter === 'preview') rows = rows.filter((r) => r.dryRun);
        else if (logFilter === 'skipped') rows = rows.filter((r) => r.skipped);
        else if (logFilter === 'reverted') rows = rows.filter((r) => r.reverted || r.unlocked);
        const q = logQuery.trim().toLowerCase();
        if (q) {
            rows = rows.filter((r) => {
                const hay = [r.showTitle, r.title, r.reason, r.source, r.ratingKey]
                    .map((x) => String(x || '').toLowerCase())
                    .join(' ');
                return hay.includes(q);
            });
        }
        return rows.slice(0, 80);
    }, [status?.log, logFilter, logQuery]);

    const scan = status?.scan;
    const filteredPreview = useMemo(() => {
        const rows = scan?.preview || [];
        if (previewFilter === 'failed') return rows.filter((r) => r.ok === false);
        if (previewFilter === 'skipped') return rows.filter((r) => r.skipped);
        if (previewFilter === 'ok') return rows.filter((r) => r.ok !== false && !r.skipped);
        return rows;
    }, [scan?.preview, previewFilter]);
    const stats = scan?.stats;

    return (
        <DashboardPageShell>
            <DashboardHero
                accent="plex"
                eyebrow="Metadata Fill"
                title="Fill TBA episode metadata from TMDB, TVDB, and TVmaze"
                description="When Plex is slow to scrape, write locked title, summary, and air date on Sonarr On Import, per show, or via a resumable library scan. Preview first, then apply; revert or unlock anytime."
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

            {error && <p className="mt-4 text-sm text-red-300/90">{error}</p>}
            {notice && !error && <p className="mt-4 text-sm text-green-300/90">{notice}</p>}

            <div className="mt-6 grid gap-4 md:grid-cols-2">
                <section className="rounded-2xl border border-white/10 bg-background/40 p-4 space-y-3">
                    <h2 className="text-sm font-bold uppercase tracking-wider text-muted">Settings</h2>
                    <label className="flex items-center justify-between gap-3 text-sm text-text">
                        <span>Enable Metadata Fill</span>
                        <input
                            type="checkbox"
                            checked={!!status?.enabled}
                            disabled={!!busyToggle || loading}
                            onChange={(e) => { void saveSettings({ enabled: e.target.checked }, 'enabled'); }}
                        />
                    </label>
                    <label className="flex items-center justify-between gap-3 text-sm text-text">
                        <span>Auto-fill on Sonarr On Import</span>
                        <input
                            type="checkbox"
                            checked={status?.autoImport !== false}
                            disabled={!status?.enabled || !!busyToggle || loading}
                            onChange={(e) => { void saveSettings({ autoImport: e.target.checked }, 'auto'); }}
                        />
                    </label>
                    <div className="pt-1 space-y-2">
                        <p className="text-[11px] font-bold uppercase tracking-wider text-muted">Write fields</p>
                        {([
                            ['title', 'Title'],
                            ['summary', 'Summary'],
                            ['originallyAvailableAt', 'Air date'],
                        ] as const).map(([key, label]) => (
                            <label key={key} className="flex items-center justify-between gap-3 text-sm text-text">
                                <span>{label}</span>
                                <input
                                    type="checkbox"
                                    checked={status?.fields?.[key] !== false}
                                    disabled={!status?.enabled || !!busyToggle}
                                    onChange={(e) => {
                                        void saveSettings({
                                            fields: {
                                                ...(status?.fields || defaultFields()),
                                                [key]: e.target.checked,
                                            },
                                        }, 'fields');
                                    }}
                                />
                            </label>
                        ))}
                    </div>
                    <label className="flex flex-col gap-1 text-sm text-text">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-muted">Source preference</span>
                        <select
                            className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm"
                            value={status?.sourcePreference || 'auto'}
                            disabled={!status?.enabled || !!busyToggle}
                            onChange={(e) => {
                                void saveSettings({ sourcePreference: e.target.value }, 'source');
                            }}
                        >
                            <option value="auto">Auto (TMDB → TVDB → TVmaze)</option>
                            <option value="tmdb">Prefer TMDB</option>
                            <option value="tvdb">Prefer TVDB</option>
                        </select>
                    </label>
                    <label className="flex items-center justify-between gap-3 text-sm text-text">
                        <span>Skip title when TMDB &amp; TVDB disagree</span>
                        <input
                            type="checkbox"
                            checked={!!status?.requireTitleAgreement}
                            disabled={!status?.enabled || !!busyToggle}
                            onChange={(e) => {
                                void saveSettings({ requireTitleAgreement: e.target.checked }, 'agree');
                            }}
                        />
                    </label>
                    <p className="text-xs text-muted">
                        Sources: TMDB {status?.tmdbConfigured ? 'ready' : 'missing key'}
                        {' · '}TVDB {status?.tvdbConfigured ? 'ready' : 'missing key'}
                        {' · '}TVmaze {status?.tvmazeConfigured !== false ? 'ready (no key)' : 'off'}
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
                                        TMDB {hit.tmdbId || '-'} · TVDB {hit.tvdbId || '-'}
                                    </p>
                                </div>
                                <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                                    <button
                                        type="button"
                                        disabled={!!fillingKey || !!bulkBusy}
                                        onClick={() => { void fillShow(hit.ratingKey, true); }}
                                        className="rounded-lg border border-white/15 px-2 py-1.5 text-[11px] font-bold text-muted"
                                    >
                                        {fillingKey === `${hit.ratingKey}:preview` ? (
                                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                        ) : 'Preview'}
                                    </button>
                                    <button
                                        type="button"
                                        disabled={!!fillingKey || !!bulkBusy}
                                        onClick={() => { void fillShow(hit.ratingKey, false); }}
                                        className="rounded-lg border border-plex/40 bg-plex/15 px-2.5 py-1.5 text-xs font-bold text-plex"
                                    >
                                        {fillingKey === `${hit.ratingKey}:fill` ? (
                                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                        ) : 'Fill'}
                                    </button>
                                    <button
                                        type="button"
                                        disabled={!!bulkBusy || !status?.enabled}
                                        onClick={() => { void bulkShow(hit.ratingKey, 'unlock'); }}
                                        className="rounded-lg border border-white/15 px-2 py-1.5 text-[11px] font-bold text-muted"
                                        title="Unlock all filled fields for this show"
                                    >
                                        {bulkBusy === `unlock:${hit.ratingKey}` ? '…' : 'Unlock'}
                                    </button>
                                    <button
                                        type="button"
                                        disabled={!!bulkBusy || !status?.enabled}
                                        onClick={() => { void bulkShow(hit.ratingKey, 'revert'); }}
                                        className="rounded-lg border border-amber-400/30 px-2 py-1.5 text-[11px] font-bold text-amber-300"
                                        title="Revert Metadata Fill writes for this show"
                                    >
                                        {bulkBusy === `revert:${hit.ratingKey}` ? '…' : 'Revert'}
                                    </button>
                                </div>
                            </li>
                        ))}
                        {!hits.length && !searching && (
                            <li className="text-xs text-muted">Search a show to preview or fill TBA / empty episodes.</li>
                        )}
                    </ul>
                </section>
            </div>

            <section className="mt-6 rounded-2xl border border-white/10 bg-background/40 p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <h2 className="text-sm font-bold uppercase tracking-wider text-muted">Library-wide scan</h2>
                    <label className="flex items-center gap-2 text-xs text-text">
                        <input
                            type="checkbox"
                            checked={scanDryRun}
                            disabled={scanRunning || !status?.enabled}
                            onChange={(e) => setScanDryRun(e.target.checked)}
                        />
                        Dry-run / preview only
                    </label>
                </div>
                <p className="text-xs text-muted">
                    Manual start. Walks selected TV libraries (or all if none selected).
                    If interrupted, Resume continues from the last show/episode.
                    Prefer dry-run first, then Apply preview.
                </p>
                {(status?.libraries?.length || 0) > 0 && (
                    <div className="flex flex-wrap gap-2">
                        {status?.libraries?.map((lib) => {
                            const selected = !status.libraryKeys.length || status.libraryKeys.includes(String(lib.key));
                            const explicitlyOn = status.libraryKeys.includes(String(lib.key));
                            return (
                                <button
                                    key={lib.key}
                                    type="button"
                                    disabled={!status?.enabled || !!busyToggle || scanRunning}
                                    onClick={() => { toggleLibraryKey(String(lib.key)); }}
                                    className={`rounded-lg px-2.5 py-1.5 text-[11px] font-bold ${
                                        (status.libraryKeys.length ? explicitlyOn : selected)
                                            ? 'border border-plex/40 bg-plex/15 text-plex'
                                            : 'border border-white/10 text-muted'
                                    }`}
                                    title={status.libraryKeys.length ? 'Toggle library in scan scope' : 'Click to limit scan to selected libraries'}
                                >
                                    {lib.title}
                                </button>
                            );
                        })}
                        {(status?.libraryKeys?.length || 0) > 0 && (
                            <button
                                type="button"
                                disabled={!!busyToggle || scanRunning}
                                onClick={() => { void saveSettings({ libraryKeys: [] }, 'libraries'); }}
                                className="rounded-lg border border-white/10 px-2.5 py-1.5 text-[11px] font-semibold text-muted"
                            >
                                Clear (scan all)
                            </button>
                        )}
                    </div>
                )}
                <div className="flex flex-wrap gap-2">
                    <button
                        type="button"
                        disabled={!status?.enabled || scanBusy || scanRunning}
                        onClick={() => { void startScan(false); }}
                        className="inline-flex items-center gap-2 rounded-xl bg-plex px-3 py-2 text-sm font-bold text-background disabled:opacity-40"
                    >
                        {scanBusy && !scanRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                        {scanDryRun ? 'Start preview scan' : 'Start fill scan'}
                    </button>
                    {canResume && (
                        <button
                            type="button"
                            disabled={!status?.enabled || scanBusy || scanRunning}
                            onClick={() => { void startScan(true); }}
                            className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-3 py-2 text-sm font-semibold text-text disabled:opacity-40"
                        >
                            Resume
                        </button>
                    )}
                    {scanRunning && (
                        <button
                            type="button"
                            disabled={scanBusy}
                            onClick={() => { void cancelScan(); }}
                            className="inline-flex items-center gap-2 rounded-xl border border-red-400/40 px-3 py-2 text-sm font-semibold text-red-300"
                        >
                            <Square className="h-3.5 w-3.5" />
                            Cancel
                        </button>
                    )}
                    {(scan?.preview?.length || 0) > 0 && !scanRunning && (
                        <button
                            type="button"
                            disabled={!status?.enabled || scanBusy}
                            onClick={() => { void applyPreview(); }}
                            className="inline-flex items-center gap-2 rounded-xl border border-plex/40 bg-plex/15 px-3 py-2 text-sm font-bold text-plex disabled:opacity-40"
                        >
                            Apply preview ({scan?.preview?.length})
                        </button>
                    )}
                </div>
                {scan && (
                    <div className="rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2 text-xs text-muted space-y-1">
                        <p>
                            Status: <span className="text-text font-semibold">{scan.status || 'idle'}</span>
                            {scan.dryRun ? ' · dry-run' : ' · write'}
                            {scan.error ? ` · ${scan.error}` : ''}
                        </p>
                        <p>
                            Scanned {stats?.scanned || 0}
                            {' · '}need fill {stats?.needingFill || 0}
                            {' · '}previewed {stats?.previewed || 0}
                            {' · '}filled {stats?.filled || 0}
                            {' · '}left alone {stats?.skipped || 0}
                            {' · '}errors {stats?.failed || 0}
                        </p>
                        {(scan.cursor?.libraryTitle || scan.cursor?.showTitle) && (
                            <p>
                                Cursor: {scan.cursor.libraryTitle || 'Library'}
                                {scan.cursor.showTitle ? ` → ${scan.cursor.showTitle}` : ''}
                            </p>
                        )}
                    </div>
                )}
                {(scan?.preview?.length || 0) > 0 && (
                    <div className="space-y-2">
                        <div className="flex flex-wrap gap-2">
                            {([
                                ['all', 'All'],
                                ['skipped', 'Left alone'],
                                ['failed', 'Errors'],
                                ['ok', 'Would fill'],
                            ] as Array<[PreviewFilter, string]>).map(([key, label]) => (
                                <button
                                    key={key}
                                    type="button"
                                    onClick={() => setPreviewFilter(key)}
                                    className={`rounded-lg px-2 py-1 text-[11px] font-bold ${
                                        previewFilter === key
                                            ? 'bg-plex/20 text-plex'
                                            : 'border border-white/10 text-muted'
                                    }`}
                                >
                                    {label}
                                    {key === 'skipped' && (stats?.skipped || 0) > 0 ? ` (${stats?.skipped})` : ''}
                                    {key === 'failed' && (stats?.failed || 0) > 0 ? ` (${stats?.failed})` : ''}
                                </button>
                            ))}
                        </div>
                        <ul className="max-h-56 space-y-1.5 overflow-auto text-xs">
                            {filteredPreview.slice(-40).reverse().map((row, index) => (
                                <li
                                    key={`${row.ratingKey || 'row'}-${index}`}
                                    className={`rounded-lg border px-2.5 py-1.5 ${
                                        row.ok === false
                                            ? 'border-red-400/25 text-red-200'
                                            : row.skipped
                                                ? 'border-white/5 text-muted'
                                                : 'border-white/5 text-text'
                                    }`}
                                >
                                    <span className="font-semibold">
                                        {row.ok === false ? 'Error · ' : row.skipped ? 'Left alone · ' : ''}
                                        {row.showTitle}
                                        {row.seasonNumber != null && row.episodeNumber != null
                                            ? ` S${String(row.seasonNumber).padStart(2, '0')}E${String(row.episodeNumber).padStart(2, '0')}`
                                            : ''}
                                    </span>
                                    {row.title ? ` → ${row.title}` : ''}
                                    {row.airDate ? ` · ${row.airDate}` : ''}
                                    {row.sources?.length ? ` · ${row.sources.join('+')}` : ''}
                                    {row.reason ? ` · ${reasonLabel(row.reason)}` : ''}
                                </li>
                            ))}
                            {!filteredPreview.length && (
                                <li className="text-muted">No matching preview rows in the recent window.</li>
                            )}
                        </ul>
                    </div>
                )}
            </section>

            <section className="mt-6 rounded-2xl border border-white/10 bg-background/40 p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <h2 className="text-sm font-bold uppercase tracking-wider text-muted">
                        Still TBA audit
                    </h2>
                    <button
                        type="button"
                        disabled={!status?.enabled || auditBusy}
                        onClick={() => { void runAudit(); }}
                        className="inline-flex items-center gap-2 rounded-xl border border-plex/40 bg-plex/15 px-3 py-1.5 text-xs font-bold text-plex disabled:opacity-40"
                    >
                        {auditBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                        Run audit
                    </button>
                </div>
                <p className="text-xs text-muted">
                    Lists episodes that still look like TBA / empty after fill attempts, scoped to selected libraries when set.
                </p>
                <ul className="max-h-48 space-y-1.5 overflow-auto text-xs">
                    {auditItems.slice(0, 80).map((item) => (
                        <li key={item.ratingKey} className="rounded-lg border border-white/5 px-2.5 py-1.5 text-muted">
                            <span className="text-text font-semibold">
                                {item.showTitle || 'Show'}
                                {item.seasonNumber != null && item.episodeNumber != null
                                    ? ` S${String(item.seasonNumber).padStart(2, '0')}E${String(item.episodeNumber).padStart(2, '0')}`
                                    : ''}
                            </span>
                            {item.title ? ` - ${item.title}` : ''}
                            {item.libraryTitle ? ` · ${item.libraryTitle}` : ''}
                        </li>
                    ))}
                    {!auditItems.length && (
                        <li className="text-muted">No audit results yet. Run after a fill or library scan.</li>
                    )}
                </ul>
            </section>

            <section className="mt-6 rounded-2xl border border-white/10 bg-background/40 p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <h2 className="text-sm font-bold uppercase tracking-wider text-muted">
                        Retry queue ({status?.retryQueue?.length || 0})
                    </h2>
                    <div className="flex gap-2">
                        <button
                            type="button"
                            disabled={!status?.enabled || retryBusy || !(status?.retryQueue?.length)}
                            onClick={() => { void processRetries(); }}
                            className="inline-flex items-center gap-2 rounded-xl border border-plex/40 bg-plex/15 px-3 py-1.5 text-xs font-bold text-plex disabled:opacity-40"
                        >
                            {retryBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                            Process queue
                        </button>
                        <button
                            type="button"
                            disabled={retryBusy || !(status?.retryQueue?.length)}
                            onClick={() => { void clearRetries(); }}
                            className="rounded-xl border border-white/10 px-3 py-1.5 text-xs font-semibold text-muted disabled:opacity-40"
                        >
                            Clear
                        </button>
                    </div>
                </div>
                <ul className="max-h-40 space-y-1.5 overflow-auto text-xs">
                    {(status?.retryQueue || []).slice(0, 30).map((item) => (
                        <li key={item.id} className="rounded-lg border border-white/5 px-2.5 py-1.5 text-muted">
                            <span className="text-text font-semibold">
                                {item.showTitle || 'Show'}
                                {item.seasonNumber != null && item.episodeNumber != null
                                    ? ` S${String(item.seasonNumber).padStart(2, '0')}E${String(item.episodeNumber).padStart(2, '0')}`
                                    : ''}
                            </span>
                            {' · '}
                            {item.lastError || 'pending'}
                            {item.attempts ? ` · attempts ${item.attempts}` : ''}
                        </li>
                    ))}
                    {!status?.retryQueue?.length && (
                        <li className="text-muted">Empty. Failed imports / lookups appear here automatically.</li>
                    )}
                </ul>
            </section>

            <section className="mt-6 rounded-2xl border border-white/10 bg-background/40 p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-muted">
                        <FileText className="h-4 w-4" />
                        Activity log
                    </h2>
                    <div className="flex flex-wrap gap-2">
                        <input
                            type="search"
                            value={logQuery}
                            onChange={(e) => setLogQuery(e.target.value)}
                            placeholder="Filter log…"
                            className="w-40 rounded-lg border border-white/10 bg-black/20 px-2 py-1 text-xs text-text"
                        />
                        {([
                            ['all', 'all'],
                            ['filled', 'filled'],
                            ['skipped', 'left alone'],
                            ['failed', 'errors'],
                            ['preview', 'preview'],
                            ['reverted', 'reverted'],
                        ] as Array<[LogFilter, string]>).map(([f, label]) => (
                            <button
                                key={f}
                                type="button"
                                onClick={() => setLogFilter(f)}
                                className={`rounded-lg px-2 py-1 text-[11px] font-bold capitalize ${
                                    logFilter === f
                                        ? 'bg-plex/20 text-plex'
                                        : 'border border-white/10 text-muted'
                                }`}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                </div>
                <ul className="space-y-2 max-h-[28rem] overflow-auto">
                    {filteredLog.map((row, index) => (
                        <li
                            key={`${row.id || row.at || index}-${row.ratingKey || index}`}
                            className="rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2 text-xs"
                        >
                            <div className="flex flex-wrap items-start justify-between gap-2">
                                <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2 text-text">
                                        <span className={statusClass(row)}>{statusLabel(row)}</span>
                                        <span className="font-semibold">
                                            {row.showTitle || 'Show'}
                                            {row.seasonNumber != null && row.episodeNumber != null
                                                ? ` S${String(row.seasonNumber).padStart(2, '0')}E${String(row.episodeNumber).padStart(2, '0')}`
                                                : ''}
                                            {row.title ? ` - ${row.title}` : ''}
                                        </span>
                                    </div>
                                    <p className="mt-0.5 text-muted">
                                        {row.at ? new Date(row.at).toLocaleString() : ''}
                                        {row.source ? ` · ${row.source}` : ''}
                                        {row.sources?.length ? ` · ${row.sources.join('+')}` : ''}
                                        {row.reason ? ` · ${reasonLabel(row.reason)}` : ''}
                                        {row.airDate ? ` · air ${row.airDate}` : ''}
                                    </p>
                                    {(row.before || row.after) && (
                                        <p className="mt-1 text-[11px] text-muted leading-relaxed">
                                            {row.before?.title != null && row.after?.title != null && row.before.title !== row.after.title && (
                                                <>Title: “{row.before.title || '∅'}” → “{row.after.title}”. </>
                                            )}
                                            {row.before?.summary != null && row.after?.summary != null && row.before.summary !== row.after.summary && (
                                                <>Summary updated. </>
                                            )}
                                            {row.before?.originallyAvailableAt != null
                                                && row.after?.originallyAvailableAt != null
                                                && row.before.originallyAvailableAt !== row.after.originallyAvailableAt && (
                                                <>
                                                    Air: {row.before.originallyAvailableAt || '∅'}
                                                    {' → '}
                                                    {row.after.originallyAvailableAt}.
                                                </>
                                            )}
                                        </p>
                                    )}
                                </div>
                                <div className="flex shrink-0 flex-wrap gap-1">
                                    {row.ok === false && row.ratingKey && (
                                        <button
                                            type="button"
                                            disabled={!!rowBusy || !status?.enabled}
                                            onClick={() => { void retryRow(row); }}
                                            className="rounded-md border border-white/15 px-2 py-1 text-[11px] font-bold text-text disabled:opacity-40"
                                        >
                                            {rowBusy === `retry:${row.ratingKey}` ? '…' : 'Retry'}
                                        </button>
                                    )}
                                    {row.ok && !row.skipped && !row.dryRun && !row.reverted && row.before && (
                                        <button
                                            type="button"
                                            disabled={!!rowBusy || !status?.enabled}
                                            onClick={() => { void revertRow(row); }}
                                            className="inline-flex items-center gap-1 rounded-md border border-amber-400/30 px-2 py-1 text-[11px] font-bold text-amber-300 disabled:opacity-40"
                                        >
                                            <RotateCcw className="h-3 w-3" />
                                            {rowBusy === `revert:${row.id || row.ratingKey}` ? '…' : 'Revert'}
                                        </button>
                                    )}
                                    {row.ratingKey && row.ok && !row.unlocked && !row.dryRun && (
                                        <button
                                            type="button"
                                            disabled={!!rowBusy || !status?.enabled}
                                            onClick={() => { void unlockRow(row); }}
                                            className="inline-flex items-center gap-1 rounded-md border border-white/15 px-2 py-1 text-[11px] font-bold text-muted disabled:opacity-40"
                                        >
                                            <Unlock className="h-3 w-3" />
                                            Unlock
                                        </button>
                                    )}
                                </div>
                            </div>
                        </li>
                    ))}
                    {!filteredLog.length && (
                        <li className="text-xs text-muted">No matching activity.</li>
                    )}
                </ul>
            </section>
        </DashboardPageShell>
    );
};

export default MetadataFillPage;
