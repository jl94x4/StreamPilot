import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Ban,
    Check,
    DatabaseBackup,
    GripVertical,
    Loader2,
    Play,
    RefreshCw,
    RotateCcw,
    Search,
    Settings2,
    Undo2,
    Film,
} from 'lucide-react';
import { portalUrl } from '../shared/basePath';
import { pushToast, ToastContainer, type ToastMessage } from '../shared/toast';
import { CustomSelect, SettingsToggleRow } from '../shared/ui';
import {
    DashboardHero,
    DashboardPageShell,
    DashboardPanel,
    DashboardStatCard,
} from '../shared/dashboard/DashboardChrome';
import {
    cancelEditionsJob,
    fetchEditionsConfig,
    fetchEditionsStatus,
    listEditionsBackups,
    saveEditionsConfig,
    searchEditionsMovies,
    startEditionsAction,
    testEditionsConnection,
    type EditionsConfig,
    type EditionsMovieMatch,
    type EditionsStatus,
} from './api';

const MODULE_HINTS: Record<string, string> = {
    AudioChannels: '5.1 / 7.1',
    AudioCodec: 'TrueHD, DTS-HD MA…',
    Bitrate: 'Mbps',
    ContentRating: 'PG-13, R…',
    Country: 'Production country',
    Cut: "Director's Cut…",
    Director: 'Director name',
    Duration: 'Runtime',
    DynamicRange: 'Dolby Vision / HDR',
    FrameRate: '24fps…',
    Genre: 'Primary genre',
    Language: 'Audio language',
    Rating: 'IMDb / RT score',
    Release: 'Criterion…',
    Resolution: 'Highest available (4K over 1080p)',
    ShortFilm: 'Short film tag',
    Size: 'File size',
    Source: 'BluRay / Remux…',
    SpecialFeatures: 'Bonus content',
    Studio: 'Studio',
    VideoCodec: 'H.264 / H.265',
    Writer: 'Writer',
};

const emptyConfig = (): EditionsConfig => ({
    skipLibraries: [],
    modules: { order: ['Cut', 'Release', 'Resolution', 'DynamicRange', 'AudioCodec', 'Source'] },
    language: { excludedLanguages: ['English'], skipMultipleAudioTracks: true },
    rating: { source: 'imdb', rottenTomatoesType: 'critic', tmdbApiKey: '' },
    performance: { maxWorkers: 8, batchSize: 20, metadataBatchSize: 50 },
    template: { format: 'auto', separator: ' • ', maxLength: 0 },
    tmdbLanguage: { hideWhenEnglish: true },
    webhookEnabled: false,
    webhookToken: '',
    scheduleHours: 6,
    lastFullRunAt: null,
});

export const EditionsDashboard: React.FC = () => {
    const [status, setStatus] = useState<EditionsStatus | null>(null);
    const [config, setConfig] = useState<EditionsConfig>(emptyConfig());
    const [catalog, setCatalog] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);
    const [movieLibs, setMovieLibs] = useState<Array<{ id: string; title: string }>>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchBusy, setSearchBusy] = useState(false);
    const [matches, setMatches] = useState<EditionsMovieMatch[]>([]);
    const [backups, setBackups] = useState<Array<{ name: string; path: string; mtime?: number; size?: number }>>([]);
    const [dragIndex, setDragIndex] = useState<number | null>(null);
    const [confirmReset, setConfirmReset] = useState(false);
    const [toasts, setToasts] = useState<ToastMessage[]>([]);

    const toast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'success') => {
        setToasts((prev) => pushToast(prev, message, type === 'error' ? 'error' : 'success'));
    }, []);

    const refreshStatus = useCallback(async () => {
        try {
            const next = await fetchEditionsStatus();
            setStatus(next);
        } catch (error: any) {
            /* keep last */
        }
    }, []);

    const refreshConfig = useCallback(async () => {
        const data = await fetchEditionsConfig();
        setConfig(data.config || emptyConfig());
        setCatalog(data.modulesCatalog || []);
    }, []);

    const refreshBackups = useCallback(async () => {
        try {
            const data = await listEditionsBackups();
            setBackups(Array.isArray(data.backups) ? data.backups : []);
        } catch {
            setBackups([]);
        }
    }, []);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            setLoading(true);
            try {
                await Promise.all([refreshConfig(), refreshStatus(), refreshBackups()]);
            } catch (error: any) {
                if (!cancelled) toast(error?.message || 'Failed to load Editions', 'error');
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [refreshConfig, refreshStatus, refreshBackups, toast]);

    useEffect(() => {
        if (!status?.running) return undefined;
        const id = window.setInterval(() => { refreshStatus(); }, 2000);
        return () => window.clearInterval(id);
    }, [status?.running, refreshStatus]);

    const disabledModules = useMemo(() => {
        const enabled = new Set(config.modules.order || []);
        return (catalog.length ? catalog : Object.keys(MODULE_HINTS)).filter((m) => !enabled.has(m));
    }, [catalog, config.modules.order]);

    const webhookUrl = useMemo(() => {
        if (typeof window === 'undefined') return '/api/editions/webhook';
        const base = `${window.location.origin}${portalUrl('/api/editions/webhook')}`;
        const token = String(config.webhookToken || '').trim();
        return token ? `${base}?token=${encodeURIComponent(token)}` : base;
    }, [config.webhookToken]);

    const handleSave = async () => {
        setSaving(true);
        try {
            const data = await saveEditionsConfig(config);
            setConfig(data.config);
            setCatalog(data.modulesCatalog || catalog);
            toast('Editions settings saved', 'success');
        } catch (error: any) {
            toast(error?.message || 'Save failed', 'error');
        } finally {
            setSaving(false);
        }
    };

    const handleTest = async () => {
        setTesting(true);
        try {
            const result: any = await testEditionsConnection();
            if (result?.ok) {
                setMovieLibs(Array.isArray(result.libraries) ? result.libraries : []);
                toast(`Connected to ${result.serverName || 'Plex'}`, 'success');
            } else {
                toast(result?.error || 'Connection test failed', 'error');
            }
        } catch (error: any) {
            toast(error?.message || 'Connection test failed', 'error');
        } finally {
            setTesting(false);
        }
    };

    const runAction = async (action: string, body: Record<string, unknown> = {}) => {
        try {
            const next = await startEditionsAction(action, body);
            setStatus(next);
            toast(`Started ${action}`, 'info');
            if (action === 'backup' || action === 'restore') {
                window.setTimeout(() => { refreshBackups(); }, 2500);
            }
        } catch (error: any) {
            toast(error?.message || `Failed to start ${action}`, 'error');
        }
    };

    const handleSearch = async () => {
        const q = searchQuery.trim();
        if (!q) return;
        setSearchBusy(true);
        try {
            const data = await searchEditionsMovies(q);
            setMatches(Array.isArray(data.matches) ? data.matches : []);
            if (!(data.matches || []).length) toast('No movies found', 'info');
        } catch (error: any) {
            toast(error?.message || 'Search failed', 'error');
        } finally {
            setSearchBusy(false);
        }
    };

    const moveModule = (from: number, to: number) => {
        if (to < 0 || to >= config.modules.order.length) return;
        const next = [...config.modules.order];
        const [item] = next.splice(from, 1);
        next.splice(to, 0, item);
        setConfig((prev) => ({ ...prev, modules: { ...prev.modules, order: next } }));
    };

    const toggleLibrarySkip = (title: string) => {
        setConfig((prev) => {
            const has = prev.skipLibraries.includes(title);
            return {
                ...prev,
                skipLibraries: has
                    ? prev.skipLibraries.filter((t) => t !== title)
                    : [...prev.skipLibraries, title],
            };
        });
    };

    if (loading) {
        return (
            <DashboardPageShell>
                <div className="flex items-center gap-2 text-muted py-16 justify-center">
                    <Loader2 className="w-5 h-5 animate-spin" /> Loading Editions…
                </div>
            </DashboardPageShell>
        );
    }

    return (
        <DashboardPageShell>
            <DashboardHero
                accent="plex"
                eyebrow="Plex metadata"
                title="Editions"
                description="Build Plex Edition titles from resolution, HDR, audio, cuts, boutique labels, and more — powered by Edition Manager."
                icon={<Film className="w-4 h-4" />}
                actions={(
                    <div className="flex flex-wrap gap-2">
                        <button
                            type="button"
                            disabled={!!status?.running || !status?.workerReady}
                            onClick={() => runAction('process-all')}
                            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-plex text-black font-bold text-sm disabled:opacity-50"
                        >
                            <Play className="w-4 h-4" /> Process all
                        </button>
                        <button
                            type="button"
                            disabled={!status?.running}
                            onClick={async () => {
                                await cancelEditionsJob();
                                toast('Cancel requested', 'info');
                                refreshStatus();
                            }}
                            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-border bg-background/60 font-bold text-sm disabled:opacity-50"
                        >
                            <Ban className="w-4 h-4" /> Cancel
                        </button>
                        <button
                            type="button"
                            onClick={() => { refreshStatus(); refreshBackups(); }}
                            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-border bg-background/60 font-bold text-sm"
                        >
                            <RefreshCw className="w-4 h-4" /> Refresh
                        </button>
                    </div>
                )}
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                <DashboardStatCard label="Worker" value={status?.workerReady ? 'Ready' : 'Missing'} hint="editions/cli.py" icon={<Settings2 className="w-4 h-4" />} />
                <DashboardStatCard label="Job" value={status?.running ? (status.action || 'Running') : 'Idle'} hint={status?.message || '—'} icon={<Play className="w-4 h-4" />} />
                <DashboardStatCard label="Modules" value={String(config.modules.order.length)} hint={`${disabledModules.length} disabled`} icon={<Film className="w-4 h-4" />} />
                <DashboardStatCard label="Webhook" value={config.webhookEnabled ? 'On' : 'Off'} hint="library.new movies" icon={<RefreshCw className="w-4 h-4" />} />
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <DashboardPanel title="Actions" subtitle="Process, reset, backup, and restore Edition titles.">
                    <div className="flex flex-wrap gap-2">
                        <button type="button" disabled={!!status?.running} onClick={() => runAction('backup')} className="px-3 py-2 rounded-lg border border-border text-sm font-bold hover:border-plex/50 disabled:opacity-50">
                            <span className="inline-flex items-center gap-2"><DatabaseBackup className="w-4 h-4" /> Backup</span>
                        </button>
                        <button type="button" disabled={!!status?.running} onClick={() => runAction('undo')} className="px-3 py-2 rounded-lg border border-border text-sm font-bold hover:border-plex/50 disabled:opacity-50">
                            <span className="inline-flex items-center gap-2"><Undo2 className="w-4 h-4" /> Undo last</span>
                        </button>
                        {!confirmReset ? (
                            <button type="button" disabled={!!status?.running} onClick={() => setConfirmReset(true)} className="px-3 py-2 rounded-lg border border-red-500/40 text-red-300 text-sm font-bold disabled:opacity-50">
                                <span className="inline-flex items-center gap-2"><RotateCcw className="w-4 h-4" /> Reset all…</span>
                            </button>
                        ) : (
                            <button
                                type="button"
                                disabled={!!status?.running}
                                onClick={() => { setConfirmReset(false); runAction('reset'); }}
                                className="px-3 py-2 rounded-lg bg-red-600/80 text-white text-sm font-bold disabled:opacity-50"
                            >
                                Confirm reset all editions
                            </button>
                        )}
                    </div>

                    <div className="mt-4 space-y-2">
                        <p className="text-xs font-bold uppercase tracking-wider text-muted">Process one movie</p>
                        <div className="flex gap-2">
                            <input
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
                                placeholder="Search title…"
                                className="flex-1 p-2.5 rounded-lg border border-border bg-background text-sm"
                            />
                            <button type="button" onClick={handleSearch} disabled={searchBusy} className="px-3 py-2 rounded-lg border border-border font-bold text-sm disabled:opacity-50">
                                {searchBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                            </button>
                        </div>
                        {matches.length > 0 && (
                            <div className="max-h-56 overflow-y-auto rounded-lg border border-border divide-y divide-border/60">
                                {matches.map((m) => (
                                    <button
                                        key={String(m.ratingKey)}
                                        type="button"
                                        disabled={!!status?.running}
                                        onClick={() => runAction('process-one', { ratingKey: String(m.ratingKey) })}
                                        className="w-full text-left px-3 py-2 text-sm hover:bg-white/5 disabled:opacity-50"
                                    >
                                        <span className="font-semibold text-text">{m.title}</span>
                                        <span className="text-muted"> ({m.year || '?'}) — {m.library || 'Library'}</span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </DashboardPanel>

                <DashboardPanel title="Live log" subtitle={status?.running ? 'Job in progress…' : 'Recent worker output'}>
                    <div className="h-64 overflow-y-auto rounded-lg border border-border bg-black/30 p-3 font-mono text-[11px] leading-relaxed text-emerald-100/90 whitespace-pre-wrap">
                        {(status?.logs || []).length
                            ? (status?.logs || []).slice(-120).join('\n')
                            : (status?.message || 'No log lines yet.')}
                    </div>
                    {status?.lastError ? (
                        <p className="mt-2 text-xs text-red-300 font-semibold">{status.lastError}</p>
                    ) : null}
                </DashboardPanel>
            </div>

            <DashboardPanel
                title="Modules"
                subtitle="Enabled modules compose the Edition title top→bottom. Drag to reorder."
                controls={(
                    <button type="button" onClick={handleSave} disabled={saving} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-plex text-black text-xs font-bold disabled:opacity-50">
                        {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                        Save settings
                    </button>
                )}
            >
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div className="space-y-1">
                        <p className="text-xs font-bold uppercase tracking-wider text-muted mb-2">Enabled order</p>
                        {config.modules.order.map((mod, index) => (
                            <div
                                key={mod}
                                draggable
                                onDragStart={() => setDragIndex(index)}
                                onDragOver={(e) => e.preventDefault()}
                                onDrop={() => {
                                    if (dragIndex == null || dragIndex === index) return;
                                    moveModule(dragIndex, index);
                                    setDragIndex(null);
                                }}
                                className="flex items-center gap-2 rounded-lg border border-border bg-background/40 px-2 py-2"
                            >
                                <GripVertical className="w-4 h-4 text-muted shrink-0 cursor-grab" />
                                <div className="min-w-0 flex-1">
                                    <p className="text-sm font-bold text-text truncate">{mod}</p>
                                    <p className="text-[11px] text-muted truncate">{MODULE_HINTS[mod] || ''}</p>
                                </div>
                                <button
                                    type="button"
                                    className="text-xs font-bold text-red-300 hover:underline"
                                    onClick={() => setConfig((prev) => ({
                                        ...prev,
                                        modules: { order: prev.modules.order.filter((m) => m !== mod) },
                                    }))}
                                >
                                    Disable
                                </button>
                            </div>
                        ))}
                    </div>
                    <div className="space-y-1">
                        <p className="text-xs font-bold uppercase tracking-wider text-muted mb-2">Available</p>
                        {disabledModules.length === 0 ? (
                            <p className="text-sm text-muted">All modules enabled.</p>
                        ) : disabledModules.map((mod) => (
                            <button
                                key={mod}
                                type="button"
                                onClick={() => setConfig((prev) => ({
                                    ...prev,
                                    modules: { order: [...prev.modules.order, mod] },
                                }))}
                                className="w-full text-left rounded-lg border border-dashed border-border/70 px-3 py-2 hover:border-plex/50"
                            >
                                <p className="text-sm font-bold">{mod}</p>
                                <p className="text-[11px] text-muted">{MODULE_HINTS[mod] || 'Enable module'}</p>
                            </button>
                        ))}
                    </div>
                </div>
            </DashboardPanel>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <DashboardPanel title="Libraries & language" subtitle="Uses Plex credentials from Settings → Media Player.">
                    <div className="flex flex-wrap gap-2 mb-3">
                        <button type="button" onClick={handleTest} disabled={testing} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border text-sm font-bold disabled:opacity-50">
                            {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Settings2 className="w-4 h-4" />}
                            Test connection
                        </button>
                    </div>
                    {movieLibs.length > 0 && (
                        <div className="mb-4 space-y-1">
                            <p className="text-xs font-bold uppercase tracking-wider text-muted">Skip movie libraries</p>
                            {movieLibs.map((lib) => (
                                <label key={lib.id} className="flex items-center gap-2 text-sm py-1">
                                    <input
                                        type="checkbox"
                                        checked={config.skipLibraries.includes(lib.title)}
                                        onChange={() => toggleLibrarySkip(lib.title)}
                                    />
                                    <span>{lib.title}</span>
                                </label>
                            ))}
                        </div>
                    )}
                    {config.skipLibraries.length > 0 && movieLibs.length === 0 && (
                        <p className="text-xs text-muted mb-3">Skipped: {config.skipLibraries.join('; ')}</p>
                    )}
                    <label className="block text-xs font-bold text-muted mb-1">Excluded languages (comma-separated)</label>
                    <input
                        className="appearance-none text-[16px] leading-5 w-full p-2.5 rounded-lg border border-border bg-background text-[16px] mb-3"
                        value={config.language.excludedLanguages.join(', ')}
                        onChange={(e) => setConfig((prev) => ({
                            ...prev,
                            language: {
                                ...prev.language,
                                excludedLanguages: e.target.value.split(/[,;]/).map((s) => s.trim()).filter(Boolean),
                            },
                        }))}
                    />
                    <SettingsToggleRow
                        title="Skip multiple audio tracks"
                        description="Language module skips titles with more than one audio track."
                        checked={config.language.skipMultipleAudioTracks}
                        onChange={(checked) => setConfig((prev) => ({
                            ...prev,
                            language: { ...prev.language, skipMultipleAudioTracks: checked },
                        }))}
                        border={false}
                    />
                </DashboardPanel>

                <DashboardPanel title="Rating & performance">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                        <div>
                            <label className="block text-xs font-bold text-muted mb-1">Rating source</label>
                            <CustomSelect
                                value={config.rating.source}
                                onChange={(val) => setConfig((prev) => ({ ...prev, rating: { ...prev.rating, source: String(val) } }))}
                                options={[
                                    { label: 'IMDb (via TMDb)', value: 'imdb' },
                                    { label: 'Rotten Tomatoes', value: 'rotten_tomatoes' },
                                    { label: 'Letterboxd', value: 'letterboxd' },
                                ]}
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-muted mb-1">RT type</label>
                            <CustomSelect
                                value={config.rating.rottenTomatoesType}
                                onChange={(val) => setConfig((prev) => ({ ...prev, rating: { ...prev.rating, rottenTomatoesType: String(val) } }))}
                                options={[
                                    { label: 'Critics', value: 'critic' },
                                    { label: 'Audience', value: 'audience' },
                                ]}
                            />
                        </div>
                    </div>
                    <label className="block text-xs font-bold text-muted mb-1">TMDb API key (IMDb source)</label>
                    <input
                        className="appearance-none text-[16px] leading-5 w-full p-2.5 rounded-lg border border-border bg-background text-[16px] mb-3"
                        type="password"
                        value={config.rating.tmdbApiKey}
                        onChange={(e) => setConfig((prev) => ({ ...prev, rating: { ...prev.rating, tmdbApiKey: e.target.value } }))}
                        placeholder="Optional — uses portal TMDb key if blank at runtime"
                    />
                    <div className="grid grid-cols-3 gap-2">
                        {([
                            ['maxWorkers', 'Max workers'],
                            ['batchSize', 'Batch size'],
                            ['metadataBatchSize', 'Meta batch'],
                        ] as const).map(([key, label]) => (
                            <div key={key}>
                                <label className="block text-[10px] font-bold text-muted mb-1 uppercase">{label}</label>
                                <input
                                    type="number"
                                    min={1}
                                    className="appearance-none text-[16px] leading-5 w-full p-2 rounded-lg border border-border bg-background text-[16px]"
                                    value={config.performance[key]}
                                    onChange={(e) => setConfig((prev) => ({
                                        ...prev,
                                        performance: { ...prev.performance, [key]: Number(e.target.value) || 1 },
                                    }))}
                                />
                            </div>
                        ))}
                    </div>
                </DashboardPanel>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <DashboardPanel title="Backup & restore" subtitle="Timestamped Edition title backups from the Python worker.">
                    <div className="space-y-2 max-h-64 overflow-y-auto">
                        {backups.length === 0 ? (
                            <p className="text-sm text-muted">No backups yet. Run Backup first.</p>
                        ) : backups.map((b) => (
                            <div key={b.path} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
                                <div className="min-w-0">
                                    <p className="text-sm font-semibold truncate">{b.name}</p>
                                    <p className="text-[11px] text-muted">{b.mtime ? new Date(b.mtime * 1000).toLocaleString() : ''}</p>
                                </div>
                                <button
                                    type="button"
                                    disabled={!!status?.running}
                                    onClick={() => runAction('restore', { backupFile: b.path })}
                                    className="shrink-0 text-xs font-bold text-plex hover:underline disabled:opacity-50"
                                >
                                    Restore
                                </button>
                            </div>
                        ))}
                    </div>
                </DashboardPanel>

                <DashboardPanel
                    title="Keep editions current"
                    subtitle="New movies via webhook; version upgrades (1080p → 4K) on a full library pass."
                >
                    <SettingsToggleRow
                        title="Enable Editions webhook"
                        description="Process a movie when Plex sends library.new (new title or a new version)."
                        checked={config.webhookEnabled}
                        onChange={(checked) => setConfig((prev) => ({ ...prev, webhookEnabled: checked }))}
                    />
                    <div className="mt-3 rounded-lg border border-border bg-background/40 p-3">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-muted mb-1">Plex webhook URL</p>
                        {config.webhookEnabled && !config.webhookToken ? (
                            <p className="text-xs text-muted">Save webhook & schedule to generate a secret URL for Plex.</p>
                        ) : (
                            <>
                                <code className="text-xs break-all text-plex">{webhookUrl}</code>
                                <p className="text-[11px] text-muted mt-2">
                                    Paste this into Plex Settings → Network → Webhooks (Plex Pass). The URL includes a secret token — treat it like a password. Opening it in a browser only returns a health check; POSTs without the token are rejected.
                                </p>
                                {config.webhookToken ? (
                                    <button
                                        type="button"
                                        disabled={saving}
                                        onClick={async () => {
                                            setSaving(true);
                                            try {
                                                const data = await saveEditionsConfig(config, { rotateWebhookToken: true });
                                                setConfig(data.config);
                                                setCatalog(data.modulesCatalog || catalog);
                                                toast('Webhook token rotated — update the URL in Plex', 'success');
                                            } catch (error: any) {
                                                toast(error?.message || 'Failed to rotate token', 'error');
                                            } finally {
                                                setSaving(false);
                                            }
                                        }}
                                        className="mt-3 text-xs font-bold text-plex hover:underline disabled:opacity-50"
                                    >
                                        Rotate webhook token
                                    </button>
                                ) : null}
                            </>
                        )}
                    </div>
                    <div className="mt-4">
                        <p className="text-xs font-bold uppercase tracking-wider text-muted mb-2">Scheduled full run</p>
                        <CustomSelect
                            value={String(config.scheduleHours ?? 6)}
                            onChange={(value) => setConfig((prev) => ({ ...prev, scheduleHours: Number(value) }))}
                            options={[
                                { value: '0', label: 'Off' },
                                { value: '6', label: 'Every 6 hours' },
                                { value: '12', label: 'Every 12 hours' },
                                { value: '24', label: 'Every 24 hours' },
                            ]}
                        />
                        <p className="text-[11px] text-muted mt-2">
                            Re-stamps the whole movie library so Edition titles pick the highest available resolution.
                            {config.lastFullRunAt
                                ? ` Last full run: ${new Date(config.lastFullRunAt).toLocaleString()}.`
                                : ' First automatic run waits one full interval after the portal starts (or click Process all).'}
                        </p>
                    </div>
                    <button type="button" onClick={handleSave} disabled={saving} className="mt-3 px-3 py-2 rounded-lg bg-plex text-black text-sm font-bold disabled:opacity-50">
                        Save webhook & schedule
                    </button>
                </DashboardPanel>
            </div>

            {(status?.activity || []).length > 0 && (
                <DashboardPanel title="Recent activity">
                    <div className="space-y-1">
                        {(status?.activity || []).slice(0, 12).map((row, idx) => (
                            <div key={`${row.at}-${idx}`} className="flex items-start justify-between gap-3 text-sm border-b border-border/40 py-2">
                                <div className="min-w-0">
                                    <p className="font-semibold truncate">{row.action} — {row.message}</p>
                                    <p className="text-[11px] text-muted">{row.at ? new Date(row.at).toLocaleString() : ''}</p>
                                </div>
                                <span className={`text-[10px] font-bold uppercase ${row.ok === false ? 'text-red-300' : 'text-emerald-300'}`}>
                                    {row.ok === false ? 'fail' : 'ok'}
                                </span>
                            </div>
                        ))}
                    </div>
                </DashboardPanel>
            )}

            <ToastContainer toasts={toasts} setToasts={setToasts} />

            <p className="text-xs text-muted">
                Engine adapted from{' '}
                <a className="text-plex hover:underline" href="https://github.com/Entree3k/Edition-Manager" target="_blank" rel="noreferrer">
                    Entree3k/Edition-Manager
                </a>
                {' '}(MIT; foundation by x1ao4). Enable the feature under Settings → Editions.
            </p>
        </DashboardPageShell>
    );
};

export default EditionsDashboard;
