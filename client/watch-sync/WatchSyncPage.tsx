import React, { useCallback, useEffect, useState } from 'react';
import { Check, Link2, Loader2, Play, RefreshCw, Square, Clapperboard } from 'lucide-react';
import { pushToast, ToastContainer, type ToastMessage } from '../shared/toast';
import { SettingsToggleRow } from '../shared/ui';
import {
    DashboardHero,
    DashboardPageShell,
    DashboardPanel,
    DashboardStatCard,
} from '../shared/dashboard/DashboardChrome';
import {
    cancelWatchSync,
    clearWatchSyncCache,
    disconnectWatchSync,
    fetchWatchSyncConfig,
    fetchWatchSyncLibraries,
    fetchWatchSyncStatus,
    pollWatchSyncConnect,
    saveWatchSyncConfig,
    startWatchSync,
    startWatchSyncConnect,
    testWatchSync,
    type WatchSyncConfig,
    type WatchSyncLibrary,
    type WatchSyncStatus,
} from './watchSyncApi';

const emptyConfig = (): WatchSyncConfig => ({
    clientId: '',
    clientSecretSet: false,
    connected: false,
    username: '',
    tokenExpiresAt: '',
    plexToTrakt: { watched: true, ratings: true, collection: true, watchlist: true },
    traktToPlex: { watched: true, ratings: true, watchlist: true },
    libraryIds: [],
    scheduleEnabled: false,
    intervalHours: 12,
    liveWatchEnabled: true,
    lastRunAt: '',
    lastRun: null,
});

const summaryRows: Array<[string, string]> = [
    ['watchedToTrakt', 'Watched → Trakt'],
    ['watchedToPlex', 'Watched → Plex'],
    ['ratingsToTrakt', 'Ratings → Trakt'],
    ['ratingsToPlex', 'Ratings → Plex'],
    ['collectionToTrakt', 'Collection → Trakt'],
    ['watchlistToTrakt', 'Watchlist → Trakt'],
    ['watchlistToPlex', 'Watchlist → Plex'],
    ['failed', 'Failed'],
];

export const WatchSyncPage: React.FC = () => {
    const [config, setConfig] = useState<WatchSyncConfig>(emptyConfig());
    const [secret, setSecret] = useState('');
    const [status, setStatus] = useState<WatchSyncStatus | null>(null);
    const [libraries, setLibraries] = useState<WatchSyncLibrary[]>([]);
    const [device, setDevice] = useState<{ userCode: string; verificationUrl: string } | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [toasts, setToasts] = useState<ToastMessage[]>([]);
    const toast = useCallback((message: string, type: ToastMessage['type'] = 'info') => {
        pushToast(setToasts, message, type);
    }, []);

    const refreshStatus = useCallback(async () => {
        const next = await fetchWatchSyncStatus();
        setStatus(next);
        return next;
    }, []);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const [cfg, librariesRes] = await Promise.all([
                    fetchWatchSyncConfig(),
                    fetchWatchSyncLibraries().catch(() => ({ libraries: [] as WatchSyncLibrary[] })),
                ]);
                if (cancelled) return;
                setConfig(cfg.config);
                setDevice(cfg.device);
                setLibraries(librariesRes.libraries || []);
                await refreshStatus();
            } catch (error: any) {
                if (!cancelled) toast(error?.message || 'Failed to load Watch Sync', 'error');
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [refreshStatus, toast]);

    useEffect(() => {
        const timer = window.setInterval(() => { void refreshStatus(); }, status?.running ? 4000 : 8000);
        return () => window.clearInterval(timer);
    }, [status?.running, refreshStatus]);

    const persist = async (patch: Record<string, unknown>) => {
        setSaving(true);
        try {
            const saved = await saveWatchSyncConfig({
                ...config,
                ...patch,
                clientSecret: secret || undefined,
            });
            setConfig(saved.config);
            setSecret('');
            toast('Watch Sync settings saved', 'success');
        } catch (error: any) {
            toast(error?.message || 'Save failed', 'error');
        } finally {
            setSaving(false);
        }
    };

    const connect = async () => {
        try {
            await saveWatchSyncConfig({ ...config, clientSecret: secret || undefined });
            const started = await startWatchSyncConnect();
            setDevice(started.device);
            toast(`Approve ${started.device.userCode} on Trakt`, 'info');
        } catch (error: any) {
            toast(error?.message || 'Could not start Trakt activation', 'error');
        }
    };

    useEffect(() => {
        if (!device || config.connected) return undefined;
        const timer = window.setInterval(async () => {
            try {
                const result = await pollWatchSyncConnect();
                if (!result.pending && result.config) {
                    setConfig(result.config);
                    setDevice(null);
                    toast(`Connected${result.config.username ? ` as ${result.config.username}` : ''}`, 'success');
                }
            } catch {
                // Keep polling until the code expires.
            }
        }, 5000);
        return () => window.clearInterval(timer);
    }, [device, config.connected, toast]);

    const toggleLibrary = (id: string) => {
        setConfig((prev) => {
            const selected = new Set(prev.libraryIds);
            if (selected.has(id)) selected.delete(id);
            else selected.add(id);
            return { ...prev, libraryIds: [...selected] };
        });
    };

    if (loading) {
        return (
            <DashboardPageShell>
                <div className="flex items-center gap-2 text-muted p-6">
                    <Loader2 className="w-5 h-5 animate-spin" /> Loading Watch Sync…
                </div>
            </DashboardPageShell>
        );
    }

    const summary = status?.lastRun?.summary || config.lastRun?.summary || null;

    return (
        <DashboardPageShell>
            <ToastContainer toasts={toasts} setToasts={setToasts} />
            <DashboardHero
                accent="plex"
                eyebrow="Plex and Trakt"
                title="Watch Sync"
                description="Keep watched status, ratings, your Trakt collection, and watchlists in step between this Plex server and your Trakt account. No Plex Pass or Trakt VIP is required."
                icon={<Clapperboard className="w-4 h-4" />}
                actions={(
                    <div className="flex flex-wrap gap-2">
                        <button
                            type="button"
                            disabled={!!status?.running || !config.connected}
                            onClick={async () => {
                                try {
                                    await startWatchSync();
                                    toast('Sync started', 'success');
                                    refreshStatus();
                                } catch (error: any) {
                                    toast(error?.message || 'Could not start sync', 'error');
                                }
                            }}
                            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-plex text-black font-bold text-sm disabled:opacity-50"
                        >
                            <Play className="w-4 h-4" /> Sync now
                        </button>
                        <button
                            type="button"
                            disabled={!status?.running}
                            onClick={async () => {
                                await cancelWatchSync();
                                toast('Cancel requested', 'info');
                            }}
                            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-border bg-background/60 font-bold text-sm disabled:opacity-50"
                        >
                            <Square className="w-4 h-4" /> Cancel
                        </button>
                        <button
                            type="button"
                            onClick={() => { void refreshStatus(); }}
                            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-border bg-background/60 font-bold text-sm"
                        >
                            <RefreshCw className="w-4 h-4" /> Refresh
                        </button>
                    </div>
                )}
            />

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
                <DashboardStatCard label="Trakt" value={config.connected ? (config.username || 'Connected') : 'Not connected'} hint={status?.running ? (status.progress || 'Running') : (status?.error || 'Idle')} icon={<Link2 className="w-4 h-4" />} />
                <DashboardStatCard label="Plex movies" value={String(summary?.plexMovies ?? '—')} hint="Last sync" icon={<Clapperboard className="w-4 h-4" />} />
                <DashboardStatCard label="Plex episodes" value={String(summary?.plexEpisodes ?? '—')} hint="Last sync" icon={<Clapperboard className="w-4 h-4" />} />
                <DashboardStatCard label="Failed" value={String(summary?.failed ?? 0)} hint={config.lastRunAt ? new Date(config.lastRunAt).toLocaleString() : 'No runs yet'} icon={<Check className="w-4 h-4" />} />
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <DashboardPanel title="Trakt account" subtitle="Create an API app at trakt.tv/oauth/applications. The redirect URI can be urn:ietf:wg:oauth:2.0:oob.">
                    <label className="block text-sm mb-3">
                        <span className="text-muted text-xs font-semibold">Client ID</span>
                        <input
                            className="mt-1 w-full rounded-xl border border-border bg-background/60 px-3 py-2"
                            value={config.clientId}
                            onChange={(event) => setConfig((prev) => ({ ...prev, clientId: event.target.value }))}
                            autoComplete="off"
                        />
                    </label>
                    <label className="block text-sm mb-4">
                        <span className="text-muted text-xs font-semibold">Client secret</span>
                        <input
                            className="mt-1 w-full rounded-xl border border-border bg-background/60 px-3 py-2"
                            type="password"
                            value={secret}
                            placeholder={config.clientSecretSet ? 'Saved — enter a new secret to replace it' : 'Required'}
                            onChange={(event) => setSecret(event.target.value)}
                            autoComplete="off"
                        />
                    </label>
                    <div className="flex flex-wrap gap-2">
                        <button type="button" disabled={saving} onClick={() => persist({})} className="px-3 py-2 rounded-xl bg-plex text-black font-bold text-sm disabled:opacity-50">
                            Save credentials
                        </button>
                        <button type="button" onClick={connect} className="px-3 py-2 rounded-xl border border-border font-bold text-sm">
                            Connect Trakt
                        </button>
                        <button
                            type="button"
                            onClick={async () => {
                                try {
                                    const result = await testWatchSync();
                                    toast(`Trakt OK${result.username ? ` (${result.username})` : ''}`, 'success');
                                } catch (error: any) {
                                    toast(error?.message || 'Test failed', 'error');
                                }
                            }}
                            className="px-3 py-2 rounded-xl border border-border font-bold text-sm"
                        >
                            Test
                        </button>
                        {config.connected && (
                            <button
                                type="button"
                                onClick={async () => {
                                    const saved = await disconnectWatchSync();
                                    setConfig(saved.config);
                                    toast('Trakt disconnected', 'info');
                                }}
                                className="px-3 py-2 rounded-xl border border-border font-bold text-sm"
                            >
                                Disconnect
                            </button>
                        )}
                    </div>
                    {device && (
                        <p className="mt-4 text-sm">
                            Open <a className="text-plex font-bold" href={device.verificationUrl} target="_blank" rel="noreferrer">{device.verificationUrl}</a> and enter <span className="font-mono font-bold">{device.userCode}</span>. This page checks automatically.
                        </p>
                    )}
                </DashboardPanel>

                <DashboardPanel title="What to sync" subtitle="Watches are added, not removed. A rating that already exists on both sides is left alone until one side changes.">
                    <div className="space-y-2">
                        <SettingsToggleRow
                            title="Live scrobble while playing"
                            checked={config.liveWatchEnabled}
                            onChange={(checked) => setConfig((prev) => ({ ...prev, liveWatchEnabled: checked }))}
                        />
                        <p className="text-xs text-muted">
                            While the Plex account on the server token is playing, progress is sent to Trakt. Reaching 80% marks it watched. Other server members are not scrobbled.
                        </p>
                        {status?.live?.current && (
                            <p className="text-sm text-muted">
                                {status.live.current.action}: {status.live.current.title} ({Math.round(status.live.current.progress)}%)
                            </p>
                        )}
                        {status?.live?.error && <p className="text-sm text-red-300">{status.live.error}</p>}
                        <SettingsToggleRow title="Plex → Trakt watched" checked={config.plexToTrakt.watched} onChange={(checked) => setConfig((prev) => ({ ...prev, plexToTrakt: { ...prev.plexToTrakt, watched: checked } }))} />
                        <SettingsToggleRow title="Trakt → Plex watched" checked={config.traktToPlex.watched} onChange={(checked) => setConfig((prev) => ({ ...prev, traktToPlex: { ...prev.traktToPlex, watched: checked } }))} />
                        <SettingsToggleRow title="Plex → Trakt ratings" checked={config.plexToTrakt.ratings} onChange={(checked) => setConfig((prev) => ({ ...prev, plexToTrakt: { ...prev.plexToTrakt, ratings: checked } }))} />
                        <SettingsToggleRow title="Trakt → Plex ratings" checked={config.traktToPlex.ratings} onChange={(checked) => setConfig((prev) => ({ ...prev, traktToPlex: { ...prev.traktToPlex, ratings: checked } }))} />
                        <SettingsToggleRow title="Add Plex library to Trakt collection" checked={config.plexToTrakt.collection} onChange={(checked) => setConfig((prev) => ({ ...prev, plexToTrakt: { ...prev.plexToTrakt, collection: checked } }))} />
                        <SettingsToggleRow title="Plex watchlist → Trakt" checked={config.plexToTrakt.watchlist} onChange={(checked) => setConfig((prev) => ({ ...prev, plexToTrakt: { ...prev.plexToTrakt, watchlist: checked } }))} />
                        <SettingsToggleRow title="Trakt watchlist → Plex (titles already in the library)" checked={config.traktToPlex.watchlist} onChange={(checked) => setConfig((prev) => ({ ...prev, traktToPlex: { ...prev.traktToPlex, watchlist: checked } }))} />
                    </div>
                    <div className="mt-4 flex flex-wrap items-center gap-3">
                        <SettingsToggleRow title="Run on a schedule" checked={config.scheduleEnabled} onChange={(checked) => setConfig((prev) => ({ ...prev, scheduleEnabled: checked }))} />
                        <label className="text-sm text-muted">
                            Every
                            <input
                                type="number"
                                min={1}
                                max={168}
                                className="mx-2 w-20 rounded-lg border border-border bg-background/60 px-2 py-1"
                                value={config.intervalHours}
                                onChange={(event) => setConfig((prev) => ({ ...prev, intervalHours: Number(event.target.value) || 12 }))}
                            />
                            hours
                        </label>
                    </div>
                    <button type="button" disabled={saving} onClick={() => persist({})} className="mt-4 px-3 py-2 rounded-xl bg-plex text-black font-bold text-sm disabled:opacity-50">
                        Save sync options
                    </button>
                </DashboardPanel>

                <DashboardPanel title="Libraries" subtitle="Leave every library off to include all movie and show libraries.">
                    {libraries.length === 0 ? (
                        <p className="text-sm text-muted">No movie or show libraries were returned. Check the Plex URL and token under Settings → Media Player.</p>
                    ) : (
                        <div className="space-y-2">
                            {libraries.map((library) => (
                                <label key={library.id} className="flex items-center gap-2 text-sm">
                                    <input
                                        type="checkbox"
                                        checked={config.libraryIds.includes(library.id)}
                                        onChange={() => toggleLibrary(library.id)}
                                    />
                                    <span>{library.title}</span>
                                    <span className="text-muted text-xs">{library.type}</span>
                                </label>
                            ))}
                        </div>
                    )}
                    <button type="button" disabled={saving} onClick={() => persist({ libraryIds: config.libraryIds })} className="mt-4 px-3 py-2 rounded-xl border border-border font-bold text-sm disabled:opacity-50">
                        Save libraries
                    </button>
                </DashboardPanel>

                <DashboardPanel
                    title="Local cache"
                    subtitle="Finished batches are stored on this server. A later sync skips watches, collection adds, and watchlist adds that are already recorded, even if that run was cut off."
                >
                    <p className="text-sm">
                        {status?.cache?.entries
                            ? `${status.cache.entries.toLocaleString()} titles cached${status.cache.updatedAt ? ` · ${new Date(status.cache.updatedAt).toLocaleString()}` : ''}`
                            : 'No cache yet. The next sync writes one as it goes.'}
                    </p>
                    {!!status?.cache?.entries && (
                        <p className="text-xs text-muted mt-2">
                            {status.cache.movies.toLocaleString()} movies · {status.cache.episodes.toLocaleString()} episodes · {status.cache.shows.toLocaleString()} shows
                        </p>
                    )}
                    <button
                        type="button"
                        disabled={!!status?.running || !status?.cache?.entries}
                        onClick={async () => {
                            try {
                                await clearWatchSyncCache();
                                toast('Local cache cleared. The next sync compares Plex and Trakt from scratch.', 'info');
                                refreshStatus();
                            } catch (error: any) {
                                toast(error?.message || 'Could not clear the cache', 'error');
                            }
                        }}
                        className="mt-4 px-3 py-2 rounded-xl border border-border font-bold text-sm disabled:opacity-50"
                    >
                        Clear cache
                    </button>
                </DashboardPanel>

                <DashboardPanel title="Last run" subtitle={status?.progress || 'Activity from this portal process.'}>
                    {summary ? (
                        <ul className="text-sm space-y-1 mb-4">
                            {summaryRows.map(([key, label]) => (
                                <li key={key} className="flex justify-between gap-4">
                                    <span className="text-muted">{label}</span>
                                    <span className="font-semibold">{summary[key] ?? 0}</span>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="text-sm text-muted mb-4">No sync has finished yet.</p>
                    )}
                    <pre className="text-xs whitespace-pre-wrap max-h-64 overflow-auto rounded-xl bg-background/50 border border-border p-3">
                        {(status?.log || []).slice(-30).join('\n') || 'No log lines yet.'}
                    </pre>
                </DashboardPanel>
            </div>
        </DashboardPageShell>
    );
};
