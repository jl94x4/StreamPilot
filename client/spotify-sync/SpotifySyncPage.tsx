import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    CheckCircle2,
    ListMusic,
    Loader2,
    Play,
    RefreshCw,
    ScrollText,
    Settings2,
    SlidersHorizontal,
    Users,
    XCircle,
    Link2,
    Plus,
    Trash2,
    Pencil,
    Plug,
    CheckSquare,
    Square,
    Heart,
    CalendarClock,
    Eye,
    Disc3,
    ChevronLeft,
    ChevronRight,
    Search,
} from 'lucide-react';
import { apiFetch } from '../shared/api';
import { portalUrl } from '../shared/basePath';
import { pushToast as queueToast, ToastContainer, type ToastMessage } from '../shared/toast';
import {
    DashboardHero,
    DashboardPageShell,
    DashboardPanel,
    DashboardStatCard,
    DashboardSubnav,
    dashboardGlowClass,
    dashboardSubnavLinkClass,
} from '../shared/dashboard/DashboardChrome';
import { usePoll } from '../shared/usePoll';
import { CustomSelect } from '../shared/ui';
import { SpotifySyncMark } from './SpotifySyncMark';
import { formatWhen, workerFetch, workerImageUrl } from './spotifySyncApi';
import { MatchingPanel } from './MatchingPanel';
import {
    asItemArray,
    buildSavedItemAddBody,
    fetchSpotifyAccountPlaylistPages,
    isAlreadyAddedError,
    mergeCatalogPlaylists,
    mergeSpotifyAccountLibrary,
    normalizeSpotifyAccountAlbums,
    normalizeSpotifyAccountPlaylists,
    savedItemIdSet,
} from '../../lib/spotify-to-plex-playlist-import.js';

const buttonClass = 'inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-muted hover:border-plex hover:text-plex disabled:opacity-50';
const primaryButtonClass = 'inline-flex items-center gap-2 rounded-lg bg-plex px-3 py-1.5 text-xs font-bold text-background hover:brightness-110 disabled:opacity-50';
const tileButtonClass = `${buttonClass} h-8 py-0 px-2.5 leading-none justify-center`;
const tilePrimaryClass = `${primaryButtonClass} h-8 py-0 px-2.5 leading-none justify-center`;
const toolbarButtonClass = `${buttonClass} h-11 w-full min-w-0 justify-center px-3 text-center lg:w-auto`;
const toolbarPrimaryClass = `${primaryButtonClass} h-11 w-full min-w-0 justify-center px-3 text-center lg:w-auto`;
const toolbarFieldClass = 'flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-white/10 bg-black/30 px-3 text-xs font-semibold text-muted lg:w-auto';
const rowCardClass = (selected: boolean) => (
    `rounded-2xl border p-4 ${selected ? 'border-plex/50 bg-plex/10' : 'border-white/10 bg-black/25'}`
);
const rowActionClass = 'flex w-full shrink-0 items-center justify-end gap-2 lg:w-auto';
const artworkClass = 'h-28 w-28 shrink-0 rounded-xl object-cover ring-1 ring-white/10';
const artworkFallbackClass = 'flex h-28 w-28 shrink-0 items-center justify-center rounded-xl bg-plex/15 text-plex ring-1 ring-white/10';
const rowCheckClass = (selected: boolean) => (
    `inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${selected ? 'text-plex' : 'text-muted hover:text-text'}`
);
const ACCOUNT_PAGE_SIZES = [10, 25, 50] as const;

const toastListeners = new Set<(message: string, type: 'success' | 'error') => void>();
const toast = (message: string, type: 'success' | 'error') => {
    toastListeners.forEach((fn) => fn(message, type));
};

type TabId = 'playlists' | 'users' | 'sync' | 'matching' | 'integrations' | 'logs';

type SyncStatus = {
    ok?: boolean;
    workerReachable?: boolean;
    plexLoggedIn?: boolean;
    plexUri?: string;
    playlistRunCount?: number;
    lastSync?: Record<string, string | null>;
    playlistSync?: {
        id?: string;
        status?: 'running' | 'success' | 'error';
        message?: string;
        done?: number;
        total?: number;
        startedAt?: number;
        finishedAt?: number | null;
        ok?: boolean | null;
    } | null;
    embedded?: {
        running?: boolean;
        bundledAvailable?: boolean;
        lastError?: string;
    };
};

type SavedItem = {
    id: string;
    title?: string;
    type?: string;
    image?: string;
    uri?: string;
    label?: string;
    sync?: boolean;
    sync_interval?: string | number;
};

type SpotifyUser = {
    id: string;
    name?: string;
    label?: string;
    sync?: boolean;
    recentContext?: boolean;
};

type AccountPlaylist = {
    id: string;
    title: string;
    liked: boolean;
    private: boolean;
    owner: string;
    editorial?: boolean;
    userId: string;
    image: string;
    search: string;
    added: boolean;
    kind?: 'playlist' | 'album' | 'liked';
};

const TABS: { id: TabId; label: string; icon: React.FC<{ className?: string }> }[] = [
    { id: 'playlists', label: 'Playlists', icon: ListMusic },
    { id: 'users', label: 'Users', icon: Users },
    { id: 'sync', label: 'Sync', icon: Play },
    { id: 'matching', label: 'Matching', icon: SlidersHorizontal },
    { id: 'integrations', label: 'Integrations', icon: Plug },
    { id: 'logs', label: 'Logs', icon: ScrollText },
];
const TAB_IDS = TABS.map((item) => item.id);
const TAB_HELP: Record<TabId, string> = {
    playlists: 'Start here. Import Spotify playlists, then Sync to Plex to create matching playlists in your music library.',
    users: 'Connect the Spotify account that owns Liked Songs and private playlists.',
    sync: 'Advanced. Re-run saved playlists, or start worker jobs for albums, Lidarr, SLSKD, and MQTT.',
    matching: 'Optional. Tighten or loosen how Spotify titles map onto tracks already in Plex.',
    integrations: 'Optional. Lidarr, SLSKD, and Tidal for tracks that are not in Plex yet.',
    logs: 'History of Plex playlist jobs and worker sync runs.',
};

const parseSpotifySyncTab = (hash = typeof window !== 'undefined' ? window.location.hash : ''): TabId => {
    const raw = String(hash || '').replace(/^#/, '').split(/[/?&]/)[0].trim().toLowerCase();
    return TAB_IDS.includes(raw as TabId) ? (raw as TabId) : 'playlists';
};

const spotifySyncTabHash = (tab: TabId) => (tab === 'playlists' ? '' : `#${tab}`);

const writeSpotifySyncTabHash = (tab: TabId) => {
    if (typeof window === 'undefined') return;
    const desired = spotifySyncTabHash(tab);
    if ((window.location.hash || '') === desired) return;
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${desired}`);
};

const SYNC_TYPES = [
    { id: 'playlists', label: 'Playlists' },
    { id: 'albums', label: 'Albums' },
    { id: 'users', label: 'Users' },
    { id: 'lidarr', label: 'Lidarr' },
    { id: 'slskd', label: 'SLSKD' },
    { id: 'mqtt', label: 'MQTT' },
    { id: 'all', label: 'Everything' },
];

export const SpotifySyncPage: React.FC = () => {
    const [tab, setTab] = useState<TabId>(() => {
        if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('spotify') === 'connected') {
            return 'users';
        }
        return parseSpotifySyncTab();
    });
    const [status, setStatus] = useState<SyncStatus | null>(null);
    const [statusError, setStatusError] = useState('');
    const [busy, setBusy] = useState(false);
    const [toasts, setToasts] = useState<ToastMessage[]>([]);
    const toastedJobRef = useRef('');

    useEffect(() => {
        const fn = (message: string, type: 'success' | 'error') => {
            setToasts((prev) => queueToast(prev, message, type));
        };
        toastListeners.add(fn);
        return () => { toastListeners.delete(fn); };
    }, []);

    const loadStatus = useCallback(async () => {
        try {
            const data = await apiFetch('/api/spotify-to-plex/status');
            setStatus(data || null);
            setStatusError('');
        } catch (e: any) {
            setStatus(null);
            setStatusError(e?.message || 'Worker unreachable');
        }
    }, []);

    usePoll(() => { void loadStatus(); }, status?.playlistSync?.status === 'running' ? 1_500 : 60_000, { immediate: true });

    useEffect(() => {
        const job = status?.playlistSync;
        if (!job?.id || job.status === 'running') return;
        if (toastedJobRef.current === job.id) return;
        if (job.finishedAt && Date.now() - Number(job.finishedAt) > 45_000) {
            toastedJobRef.current = job.id;
            return;
        }
        toastedJobRef.current = job.id;
        toast(job.message || (job.ok === false ? 'Playlist sync failed' : 'Synced playlists to Plex'), job.ok === false || job.status === 'error' ? 'error' : 'success');
    }, [status?.playlistSync]);

    useEffect(() => {
        void (async () => {
            try {
                await apiFetch('/api/spotify-to-plex/apply-portal-defaults', { method: 'POST' });
            } catch {
                // worker may still be starting
            }
            await loadStatus();
        })();
    }, [loadStatus]);

    useEffect(() => {
        writeSpotifySyncTabHash(tab);
    }, [tab]);

    useEffect(() => {
        const onHashChange = () => setTab(parseSpotifySyncTab());
        window.addEventListener('hashchange', onHashChange);
        return () => window.removeEventListener('hashchange', onHashChange);
    }, []);

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        if (params.get('spotify') !== 'connected') return;
        toast('Spotify account connected', 'success');
        setTab('users');
        params.delete('spotify');
        const qs = params.toString();
        window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}#users`);
        void loadStatus();
    }, [loadStatus]);

    const runSync = async (type = 'all') => {
        setBusy(true);
        try {
            const data = await apiFetch('/api/spotify-to-plex/sync', {
                method: 'POST',
                body: JSON.stringify({ type }),
            });
            toast(data?.message || `${type} sync started`, 'success');
            void loadStatus();
        } catch (e: any) {
            toast(e?.message || 'Failed to start sync', 'error');
        } finally {
            setBusy(false);
        }
    };

    const syncPlaylistsToPlex = async (ids?: string[]) => {
        setBusy(true);
        try {
            const data = await apiFetch('/api/spotify-to-plex/sync-playlist', {
                method: 'POST',
                body: JSON.stringify(ids?.length ? { ids, fast: true } : { all: true, fast: true }),
            });
            toast(data?.message || 'Playlist sync started on the server', 'success');
            await loadStatus();
            return data;
        } catch (e: any) {
            toast(e?.message || 'Failed to start playlist sync', 'error');
            await loadStatus();
            throw e;
        } finally {
            setBusy(false);
        }
    };

    const startWorker = async () => {
        setBusy(true);
        try {
            const data = await apiFetch('/api/spotify-to-plex/start-worker', { method: 'POST' });
            toast(data?.message || 'Worker start requested', 'success');
            await loadStatus();
        } catch (e: any) {
            toast(e?.message || 'Could not start worker', 'error');
            await loadStatus();
        } finally {
            setBusy(false);
        }
    };

    const applyPlex = async () => {
        setBusy(true);
        try {
            const data = await apiFetch('/api/spotify-to-plex/apply-portal-defaults', { method: 'POST' });
            toast(data?.message || 'Portal Plex settings applied', 'success');
            await loadStatus();
        } catch (e: any) {
            toast(e?.message || 'Could not apply Plex settings', 'error');
        } finally {
            setBusy(false);
        }
    };

    const workerOk = !!status?.workerReachable;
    const plexOk = !!status?.plexLoggedIn;
    const playlistJob = status?.playlistSync;
    const jobRunning = playlistJob?.status === 'running';
    const syncBusy = busy || jobRunning;
    const syncProgress = jobRunning || (playlistJob?.finishedAt && Date.now() - Number(playlistJob.finishedAt) < 60_000)
        ? playlistJob
        : null;

    return (
        <DashboardPageShell>
            <DashboardHero
                accent="plex"
                eyebrow="Spotify Sync"
                title="Turn Spotify playlists into Plex playlists"
                description="This is not a Spotify player. It finds songs you already have in Plex, then creates or updates a Plex playlist in the same order as Spotify. Tracks that are missing from Plex are skipped."
                icon={<SpotifySyncMark className="h-5 w-5" />}
                secondaryBlob
                actions={(
                    <div className="flex flex-wrap gap-2">
                        <button type="button" className={buttonClass} onClick={() => void loadStatus()} disabled={syncBusy}>
                            <RefreshCw className={`h-4 w-4 ${syncBusy ? 'animate-spin' : ''}`} /> Refresh
                        </button>
                        <button type="button" className={primaryButtonClass} onClick={() => void syncPlaylistsToPlex()} disabled={syncBusy || !workerOk}>
                            {syncBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                            {jobRunning ? 'Syncing…' : 'Sync playlists to Plex'}
                        </button>
                    </div>
                )}
            />

            <div className="grid gap-3 md:grid-cols-3">
                {([
                    { step: '1', title: 'Connect Spotify', body: 'Link the account that owns the playlists.', tab: 'users' as TabId, Icon: Users },
                    { step: '2', title: 'Choose playlists', body: 'Import from your library, or paste a Spotify URL.', tab: 'playlists' as TabId, Icon: ListMusic },
                    { step: '3', title: 'Sync to Plex', body: 'Match those tracks in Plex and write the playlist there.', tab: 'playlists' as TabId, Icon: Play },
                ]).map(({ step, title, body, tab: target, Icon }) => (
                    <button
                        key={step}
                        type="button"
                        onClick={() => setTab(target)}
                        className="rounded-2xl border border-white/10 bg-black/25 p-4 text-left transition-colors hover:border-plex/40 hover:bg-plex/5"
                    >
                        <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-plex">
                            <span className="inline-flex h-6 w-6 items-center justify-center rounded-lg border border-plex/30 bg-plex/10 text-xs">{step}</span>
                            <Icon className="h-3.5 w-3.5" />
                            {title}
                        </p>
                        <p className="mt-2 text-sm leading-relaxed text-muted">{body}</p>
                    </button>
                ))}
            </div>

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
                <DashboardStatCard
                    label="Worker"
                    value={workerOk ? 'Ready' : 'Offline'}
                    hint={workerOk ? 'Bundled Spotify Sync' : 'Not reachable'}
                    icon={workerOk ? <CheckCircle2 className="h-4 w-4 text-emerald-300" /> : <XCircle className="h-4 w-4 text-rose-300" />}
                    glow={dashboardGlowClass(workerOk ? 'emerald' : 'rose')}
                    valueClassName={workerOk ? '' : 'text-rose-200'}
                />
                <DashboardStatCard
                    label="Plex"
                    value={plexOk ? 'Linked' : 'Not linked'}
                    hint={plexOk ? 'Portal token' : 'Settings → Plex'}
                    icon={plexOk ? <CheckCircle2 className="h-4 w-4 text-emerald-300" /> : <Link2 className="h-4 w-4 text-amber-300" />}
                    glow={dashboardGlowClass(plexOk ? 'emerald' : 'amber')}
                    valueClassName={plexOk ? '' : 'text-amber-200'}
                />
                <DashboardStatCard
                    label="Last playlist sync"
                    value={formatWhen(status?.lastSync?.playlists)}
                    hint="Playlists to Plex"
                    icon={<ListMusic className="h-4 w-4 text-sky-300" />}
                    glow={dashboardGlowClass(status?.lastSync?.playlists ? 'sky' : 'muted')}
                    valueClassName="!text-lg md:!text-xl leading-snug [overflow-wrap:anywhere]"
                />
                <DashboardStatCard
                    label="Logged runs"
                    value={String(status?.playlistRunCount ?? 0)}
                    hint="Playlist sync jobs"
                    icon={<ScrollText className="h-4 w-4 text-violet-300" />}
                    glow={dashboardGlowClass((status?.playlistRunCount || 0) > 0 ? 'violet' : 'muted')}
                />
            </div>

            {syncProgress ? (
                <div className="flex items-center gap-3 rounded-xl border border-plex/40 bg-plex/10 px-4 py-3 text-sm text-text">
                    {jobRunning ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-plex" /> : <CheckCircle2 className="h-4 w-4 shrink-0 text-plex" />}
                    <div className="min-w-0">
                        <p className="font-semibold">{jobRunning ? 'Syncing to Plex' : (syncProgress.ok === false ? 'Plex sync finished with errors' : 'Plex sync finished')}</p>
                        <p className="truncate text-xs text-muted">{syncProgress.message}</p>
                    </div>
                    {syncProgress.total ? (
                        <span className="ml-auto shrink-0 text-xs font-semibold text-plex">
                            {syncProgress.done || 0}/{syncProgress.total}
                        </span>
                    ) : null}
                </div>
            ) : null}

            {statusError || !workerOk ? (
                <div className="rounded-xl border border-rose-400/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                    <p className="font-semibold">Spotify Sync worker is not reachable</p>
                    <p className="mt-1 text-xs text-rose-100/80">
                        {statusError
                            || status?.embedded?.lastError
                            || 'Nothing is listening on 127.0.0.1:9030 inside the portal container. Start the bundled worker, or redeploy the latest nightly image if this build did not include spotify-to-plex.'}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                        <button type="button" className={primaryButtonClass} onClick={() => void startWorker()} disabled={busy}>
                            Start worker
                        </button>
                        <button type="button" className={buttonClass} onClick={() => void applyPlex()} disabled={busy}>Apply Plex from portal</button>
                        <button type="button" className={buttonClass} onClick={() => void loadStatus()} disabled={busy}>Retry</button>
                    </div>
                </div>
            ) : null}

            <div className="md:hidden">
                <label className="mb-2 block text-[10px] font-bold uppercase tracking-wider text-muted">Section</label>
                <CustomSelect
                    id="spotify-sync-tab"
                    value={tab}
                    onChange={(val) => setTab(val as TabId)}
                    options={TABS.map((item) => ({ label: item.label, value: item.id }))}
                />
            </div>
            <DashboardSubnav>
                {TABS.map((item) => {
                    const Icon = item.icon;
                    return (
                        <button
                            key={item.id}
                            type="button"
                            onClick={() => setTab(item.id)}
                            title={TAB_HELP[item.id]}
                            className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold whitespace-nowrap transition-colors ${dashboardSubnavLinkClass(tab === item.id)}`}
                        >
                            <Icon className="h-4 w-4 shrink-0" />
                            {item.label}
                        </button>
                    );
                })}
            </DashboardSubnav>
            <p className="text-sm leading-relaxed text-muted">{TAB_HELP[tab]}</p>

            {tab === 'playlists' && <PlaylistsPanel onSyncToPlex={syncPlaylistsToPlex} busy={syncBusy} />}
            {tab === 'users' && <UsersPanel />}
            {tab === 'sync' && <SyncPanel status={status} busy={syncBusy} onSync={runSync} onSyncPlaylistsToPlex={() => void syncPlaylistsToPlex()} onApplyPlex={applyPlex} onOpenPlaylists={() => setTab('playlists')} />}
            {tab === 'matching' && <MatchingPanel onToast={toast} />}
            {tab === 'integrations' && <IntegrationsPanel />}
            {tab === 'logs' && <LogsPanel />}
            <ToastContainer toasts={toasts} setToasts={setToasts} />
        </DashboardPageShell>
    );
};

const addAccountPlaylists = async (playlists: AccountPlaylist[]) => {
    let added = 0;
    let skipped = 0;
    let failed = 0;
    const errors: string[] = [];
    for (const playlist of playlists) {
        try {
            await workerFetch('saved-items', {
                method: 'POST',
                body: JSON.stringify(buildSavedItemAddBody(playlist)),
            });
            added += 1;
        } catch (e: any) {
            if (isAlreadyAddedError(e?.message)) skipped += 1;
            else {
                failed += 1;
                errors.push(`${playlist.title}: ${e?.message || 'failed'}`);
            }
        }
    }
    return { added, skipped, failed, errors };
};

const applyPlaylistSchedule = async (ids: string[], intervalDays: string) => {
    if (!ids.length) return;
    await workerFetch('saved-items', {
        method: 'PUT',
        body: JSON.stringify({
            ids,
            sync: true,
            sync_interval: String(intervalDays || '2'),
        }),
    });
};

const PlaylistsPanel: React.FC<{
    onSyncToPlex: (ids: string[]) => Promise<unknown>;
    busy?: boolean;
}> = ({ onSyncToPlex, busy }) => {
    const [items, setItems] = useState<SavedItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [adding, setAdding] = useState(false);
    const [editing, setEditing] = useState<SavedItem | null>(null);
    const [preview, setPreview] = useState<{ id: string; title: string; tracks: any[] } | null>(null);
    const [previewing, setPreviewing] = useState(false);
    const [users, setUsers] = useState<SpotifyUser[]>([]);
    const [userId, setUserId] = useState('');
    const [accountPlaylists, setAccountPlaylists] = useState<AccountPlaylist[]>([]);
    const [accountLoading, setAccountLoading] = useState(false);
    const [accountError, setAccountError] = useState('');
    const [accountFilter, setAccountFilter] = useState('');
    const [catalogResults, setCatalogResults] = useState<AccountPlaylist[]>([]);
    const [catalogLoading, setCatalogLoading] = useState(false);
    const [catalogError, setCatalogError] = useState('');
    const [accountPageSize, setAccountPageSize] = useState<(typeof ACCOUNT_PAGE_SIZES)[number]>(10);
    const [accountPage, setAccountPage] = useState(1);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [savedSelectedIds, setSavedSelectedIds] = useState<Set<string>>(new Set());
    const [intervalDays, setIntervalDays] = useState('2');
    const [busyAction, setBusyAction] = useState('');
    const locked = !!busyAction || !!busy;

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const data = await workerFetch('saved-items');
            setItems(asItemArray(data));
        } catch (e: any) {
            toast(e?.message || 'Failed to load playlists', 'error');
            setItems([]);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { void load(); }, [load]);

    const loadUsers = useCallback(async () => {
        try {
            const data = asItemArray(await workerFetch('spotify/users')) as SpotifyUser[];
            setUsers(data);
            setUserId((current) => current && data.some((user) => user.id === current) ? current : (data[0]?.id || ''));
        } catch {
            setUsers([]);
            setUserId('');
        }
    }, []);

    const loadAccountPlaylists = useCallback(async (id = '') => {
        if (!id) {
            setAccountPlaylists([]);
            setAccountError('Connect a Spotify account on the Users tab to pull playlists and albums.');
            return;
        }
        setAccountLoading(true);
        setAccountError('');
        try {
            const [userList, saved, raw, albumsRaw] = await Promise.all([
                workerFetch('spotify/users').then((data) => asItemArray(data) as SpotifyUser[]),
                workerFetch('saved-items').then(asItemArray).catch(() => []),
                fetchSpotifyAccountPlaylistPages(({ limit, offset }) => (
                    workerFetch(`spotify/users/${encodeURIComponent(id)}/items?type=playlists&limit=${limit}&offset=${offset}`)
                )),
                workerFetch(`spotify/users/${encodeURIComponent(id)}/items?type=albums`)
                    .then(asItemArray)
                    .catch(() => []),
            ]);
            const user = userList.find((entry) => entry.id === id) || { id };
            const savedIds = savedItemIdSet(saved);
            const next = mergeSpotifyAccountLibrary({
                playlists: normalizeSpotifyAccountPlaylists(raw, { user, savedIds }) as AccountPlaylist[],
                albums: normalizeSpotifyAccountAlbums(albumsRaw, { savedIds }) as AccountPlaylist[],
            }) as AccountPlaylist[];
            setAccountPlaylists(next);
            setSelectedIds(new Set());
        } catch (e: any) {
            setAccountPlaylists([]);
            setAccountError(e?.message || 'Could not load playlists from Spotify.');
        } finally {
            setAccountLoading(false);
        }
    }, []);

    useEffect(() => {
        void (async () => {
            await loadUsers();
        })();
    }, [loadUsers]);

    useEffect(() => {
        if (userId) void loadAccountPlaylists(userId);
    }, [userId, loadAccountPlaylists]);

    const localFiltered = useMemo(() => {
        const q = accountFilter.trim().toLowerCase();
        if (!q) return accountPlaylists;
        return accountPlaylists.filter((item) => (
            item.title.toLowerCase().includes(q)
            || item.owner.toLowerCase().includes(q)
            || String(item.kind || '').toLowerCase().includes(q)
        ));
    }, [accountPlaylists, accountFilter]);

    const savedIdsNow = useMemo(() => savedItemIdSet(items), [items]);

    const filteredAccount = useMemo(() => {
        const catalog = catalogResults.map((item) => (
            savedIdsNow.has(item.id) ? { ...item, added: true } : item
        ));
        return mergeCatalogPlaylists(localFiltered, catalog) as AccountPlaylist[];
    }, [localFiltered, catalogResults, savedIdsNow]);

    const libraryById = useMemo(() => {
        const map = new Map<string, AccountPlaylist>();
        for (const item of accountPlaylists) map.set(item.id, item);
        for (const item of catalogResults) {
            if (!map.has(item.id)) map.set(item.id, item);
        }
        return map;
    }, [accountPlaylists, catalogResults]);

    const accountTotalPages = Math.max(1, Math.ceil(filteredAccount.length / accountPageSize) || 1);
    const safeAccountPage = Math.min(accountPage, accountTotalPages);
    const pagedAccount = useMemo(() => {
        const start = (safeAccountPage - 1) * accountPageSize;
        return filteredAccount.slice(start, start + accountPageSize);
    }, [filteredAccount, safeAccountPage, accountPageSize]);

    useEffect(() => {
        setAccountPage(1);
    }, [accountFilter, accountPageSize, userId]);

    useEffect(() => {
        if (accountPage !== safeAccountPage) setAccountPage(safeAccountPage);
    }, [accountPage, safeAccountPage]);

    useEffect(() => {
        const q = accountFilter.trim();
        if (q.length < 2) {
            setCatalogResults([]);
            setCatalogError('');
            setCatalogLoading(false);
            return;
        }
        let cancelled = false;
        const timer = window.setTimeout(() => {
            setCatalogLoading(true);
            setCatalogError('');
            void (async () => {
                try {
                    const data = await apiFetch(`/api/spotify-to-plex/search-playlists?q=${encodeURIComponent(q)}`);
                    if (cancelled) return;
                    const next = asItemArray(data) as AccountPlaylist[];
                    setCatalogResults(next);
                } catch (e: any) {
                    if (cancelled) return;
                    setCatalogResults([]);
                    setCatalogError(e?.message || 'Could not search Spotify playlists.');
                } finally {
                    if (!cancelled) setCatalogLoading(false);
                }
            })();
        }, 400);
        return () => {
            cancelled = true;
            window.clearTimeout(timer);
        };
    }, [accountFilter]);

    const selectedPlaylists = useMemo(
        () => [...selectedIds].map((id) => libraryById.get(id)).filter(Boolean) as AccountPlaylist[],
        [libraryById, selectedIds],
    );

    const allFilteredSelected = filteredAccount.length > 0 && filteredAccount.every((item) => selectedIds.has(item.id));

    const toggleSelected = (id: string) => {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const toggleSelectAllFiltered = () => {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (allFilteredSelected) {
                for (const item of filteredAccount) next.delete(item.id);
            } else {
                for (const item of filteredAccount) next.add(item.id);
            }
            return next;
        });
    };

    const toggleSavedSelected = (id: string) => {
        setSavedSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const reportImport = (result: { added: number; skipped: number; failed: number; errors: string[] }) => {
        if (result.failed) {
            toast(result.errors[0] || `Failed to add ${result.failed} item${result.failed === 1 ? '' : 's'}`, 'error');
        } else if (result.added || result.skipped) {
            const parts = [];
            if (result.added) parts.push(`added ${result.added}`);
            if (result.skipped) parts.push(`${result.skipped} already saved`);
            toast(parts.join(', '), 'success');
        }
    };

    const runOnPlaylists = async (playlists: AccountPlaylist[], mode: 'add' | 'schedule' | 'sync') => {
        if (!playlists.length) return;
        setBusyAction(mode);
        try {
            const result = await addAccountPlaylists(playlists);
            if (mode === 'add' || result.failed) reportImport(result);
            const saved = asItemArray(await workerFetch('saved-items'));
            setItems(saved);
            const savedIds = savedItemIdSet(saved);
            const ids = playlists.map((item) => item.id).filter((id) => savedIds.has(id));
            if ((mode === 'schedule' || mode === 'sync') && !ids.length) {
                toast('None of those items could be saved', 'error');
                return;
            }
            if (mode === 'schedule') {
                await applyPlaylistSchedule(ids, intervalDays);
                setItems(asItemArray(await workerFetch('saved-items')));
            }
            if (mode === 'sync') {
                try {
                    await onSyncToPlex(ids);
                } catch {
                    return;
                }
            }
            await loadAccountPlaylists(userId);
            setSelectedIds(new Set());
        } catch (e: any) {
            toast(e?.message || 'Could not update library items', 'error');
        } finally {
            setBusyAction('');
        }
    };

    const runOnSaved = async (ids: string[], mode: 'schedule' | 'sync') => {
        if (!ids.length) return;
        setBusyAction(`saved-${mode}`);
        try {
            if (mode === 'schedule') {
                await applyPlaylistSchedule(ids, intervalDays);
                setItems(asItemArray(await workerFetch('saved-items')));
                toast(`Scheduled ${ids.length} item${ids.length === 1 ? '' : 's'}`, 'success');
            } else {
                try {
                    await onSyncToPlex(ids);
                } catch {
                    return;
                }
            }
            setSavedSelectedIds(new Set());
        } catch (e: any) {
            toast(e?.message || 'Could not update saved items', 'error');
        } finally {
            setBusyAction('');
        }
    };

    const groups = useMemo(() => {
        const map = new Map<string, SavedItem[]>();
        for (const item of items) {
            const label = item.label || 'Uncategorized';
            if (!map.has(label)) map.set(label, []);
            map.get(label)!.push(item);
        }
        return [...map.entries()].sort((a, b) => {
            if (a[0] === 'Uncategorized') return -1;
            if (b[0] === 'Uncategorized') return 1;
            return a[0].localeCompare(b[0]);
        });
    }, [items]);

    const labels = useMemo(
        () => [...new Set(items.map((item) => item.label).filter(Boolean))] as string[],
        [items],
    );

    const inspectItem = async (item: SavedItem) => {
        setPreviewing(true);
        try {
            const data = await workerFetch(`spotify/items/${encodeURIComponent(item.id)}`);
            const tracks = Array.isArray(data?.tracks)
                ? data.tracks
                : (Array.isArray(data?.items) ? data.items : (Array.isArray(data) ? data : []));
            setPreview({ id: item.id, title: data?.title || item.title || item.id, tracks });
        } catch (e: any) {
            toast(e?.message || 'Could not load Spotify tracks', 'error');
        } finally {
            setPreviewing(false);
        }
    };

    const addItem = async () => {
        if (!search.trim()) return;
        setAdding(true);
        try {
            const previous = savedItemIdSet(items);
            const data = await apiFetch('/api/spotify-to-plex/import-link', {
                method: 'POST',
                body: JSON.stringify({ search: search.trim() }),
            });
            const next = asItemArray(data?.items) as SavedItem[];
            setItems(next.length ? next : asItemArray(await workerFetch('saved-items')) as SavedItem[]);
            setSearch('');
            const addedIds = Array.isArray(data?.syncIds) && data.syncIds.length
                ? data.syncIds.map((id: unknown) => String(id || '')).filter(Boolean)
                : next.map((item) => String(item.id || '')).filter((id) => id && !previous.has(id));
            toast(data?.message || 'Saved — matching tracks in Plex…', 'success');
            if (addedIds.length) {
                try {
                    await onSyncToPlex(addedIds);
                } catch {
                    return;
                }
            }
        } catch (e: any) {
            toast(e?.message || 'Could not add that Spotify link', 'error');
        } finally {
            setAdding(false);
        }
    };

    const removeItem = async (id: string) => {
        try {
            const data = await workerFetch(`saved-items?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
            setItems(Array.isArray(data) ? data : items.filter((item) => item.id !== id));
            toast('Removed', 'success');
        } catch (e: any) {
            toast(e?.message || 'Delete failed', 'error');
        }
    };

    return (
        <>
            <DashboardPanel
                title="From your Spotify account"
                subtitle="Your library lists playlists you own or follow. Spotify-owned charts and mixes (Hot Hits, Songs of Summer) are hidden by Spotify’s API — type a name here or paste a URL below to add them. Matching can take a few minutes on large lists."
                controls={(
                    <div className="flex flex-wrap items-center gap-2">
                        {users.length > 1 ? (
                            <select
                                className="appearance-none rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-[16px] leading-5 text-text"
                                value={userId}
                                onChange={(e) => setUserId(e.target.value)}
                            >
                                {users.map((user) => (
                                    <option key={user.id} value={user.id}>{user.name || user.id}</option>
                                ))}
                            </select>
                        ) : null}
                        <button
                            type="button"
                            className={buttonClass}
                            onClick={() => void loadAccountPlaylists(userId)}
                            disabled={accountLoading || !userId}
                        >
                            <RefreshCw className={`h-3.5 w-3.5 ${accountLoading ? 'animate-spin' : ''}`} /> Refresh
                        </button>
                    </div>
                )}
            >
                {users.length === 0 ? (
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="text-sm text-muted">Connect a Spotify account on the Users tab, then refresh here to import playlists and albums.</p>
                        <a href={portalUrl('/api/spotify-to-plex/spotify-login')} className={primaryButtonClass}>Connect Spotify</a>
                    </div>
                ) : (
                    <div className="space-y-4">
                        <div className="relative">
                            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                            <input
                                className="appearance-none w-full rounded-xl border border-white/10 bg-black/30 py-3 pl-10 pr-10 text-[16px] leading-5 text-text"
                                placeholder="Filter yours, or search Spotify (Hot Hits, Songs of Summer…)"
                                value={accountFilter}
                                onChange={(e) => setAccountFilter(e.target.value)}
                            />
                            {catalogLoading ? (
                                <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted" />
                            ) : null}
                        </div>
                        <div className="grid grid-cols-2 gap-3 lg:flex lg:flex-wrap">
                            <label className={toolbarFieldClass}>
                                Every
                                <input
                                    type="number"
                                    min={0}
                                    className="appearance-none h-8 w-12 rounded-md border border-white/10 bg-black/40 px-1 text-center text-[16px] leading-5 text-text"
                                    value={intervalDays}
                                    onChange={(e) => setIntervalDays(e.target.value)}
                                />
                                days
                            </label>
                            <button type="button" className={toolbarButtonClass} onClick={toggleSelectAllFiltered} disabled={!filteredAccount.length}>
                                {allFilteredSelected ? <CheckSquare className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
                                {allFilteredSelected ? 'Clear' : 'Select all'}
                            </button>
                            <button type="button" className={toolbarButtonClass} onClick={() => void runOnPlaylists(selectedPlaylists, 'add')} disabled={!selectedPlaylists.length || locked}>
                                {busyAction === 'add' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                                <span className="lg:hidden">Add</span>
                                <span className="hidden lg:inline">Add selected</span>
                            </button>
                            <button type="button" className={toolbarButtonClass} onClick={() => void runOnPlaylists(selectedPlaylists, 'schedule')} disabled={!selectedPlaylists.length || locked}>
                                {busyAction === 'schedule' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CalendarClock className="h-3.5 w-3.5" />}
                                <span className="lg:hidden">Schedule</span>
                                <span className="hidden lg:inline">Schedule selected</span>
                            </button>
                            <button
                                type="button"
                                className={`${toolbarPrimaryClass} col-span-2`}
                                onClick={() => {
                                    if (!selectedPlaylists.length) {
                                        toast('Select one or more playlists or albums first.', 'error');
                                        return;
                                    }
                                    void runOnPlaylists(selectedPlaylists, 'sync');
                                }}
                                disabled={locked}
                            >
                                {busyAction === 'sync' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                                Sync to Plex
                            </button>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[11px] text-muted">
                            <span>
                                {selectedPlaylists.length} selected · {filteredAccount.length
                                    ? `${((safeAccountPage - 1) * accountPageSize) + 1}–${Math.min(filteredAccount.length, safeAccountPage * accountPageSize)} of ${filteredAccount.length}`
                                    : '0 shown'}
                                {catalogResults.length ? ` · ${catalogResults.length} from Spotify search` : ''}
                                {accountError ? ` · ${accountError}` : ''}
                                {catalogError ? ` · ${catalogError}` : ''}
                            </span>
                            <CustomSelect
                                compact
                                className="w-[8.5rem]"
                                value={accountPageSize}
                                onChange={(value) => setAccountPageSize(
                                    ACCOUNT_PAGE_SIZES.includes(Number(value) as (typeof ACCOUNT_PAGE_SIZES)[number])
                                        ? Number(value) as (typeof ACCOUNT_PAGE_SIZES)[number]
                                        : 10,
                                )}
                                options={ACCOUNT_PAGE_SIZES.map((size) => ({ value: size, label: `${size} per page` }))}
                            />
                        </div>
                        {accountLoading ? (
                            <p className="text-sm text-muted">Loading playlists and albums from Spotify…</p>
                        ) : filteredAccount.length === 0 ? (
                            <p className="text-sm text-muted">{accountError || catalogError || 'No playlists or saved albums came back from Spotify. Type a name to search public and Spotify-owned playlists, or paste a URL below.'}</p>
                        ) : (
                            <>
                            <div className="space-y-4">
                                {pagedAccount.map((playlist) => {
                                    const selected = selectedIds.has(playlist.id);
                                    return (
                                        <div key={playlist.id} className={`flex flex-col gap-3 lg:flex-row lg:items-center ${rowCardClass(selected)}`}>
                                            <button
                                                type="button"
                                                className="flex min-w-0 flex-1 items-center gap-3 text-left"
                                                onClick={() => toggleSelected(playlist.id)}
                                                title={selected ? 'Deselect' : 'Select'}
                                            >
                                                <span className="shrink-0 overflow-hidden rounded-xl">
                                                    {playlist.image ? (
                                                        <img src={workerImageUrl(playlist.image)} alt="" className={artworkClass} />
                                                    ) : (
                                                        <span className={artworkFallbackClass}>
                                                            {playlist.liked || playlist.kind === 'liked' ? <Heart className="h-12 w-12" /> : playlist.kind === 'album' ? <Disc3 className="h-12 w-12" /> : <ListMusic className="h-12 w-12" />}
                                                        </span>
                                                    )}
                                                </span>
                                                <span className="min-w-0 flex-1">
                                                    <p className="text-[15px] font-semibold leading-snug text-text [overflow-wrap:anywhere]">{playlist.title}</p>
                                                    <p className="mt-1.5 text-xs leading-relaxed text-muted [overflow-wrap:anywhere]">
                                                        {playlist.kind === 'album' ? 'Album' : playlist.liked ? 'Liked Songs' : 'Playlist'}
                                                        {playlist.owner ? ` · ${playlist.owner}` : playlist.editorial ? ' · Spotify' : ''}
                                                        {playlist.private ? ' · Private' : ''}
                                                        {playlist.added ? ' · Saved' : ''}
                                                    </p>
                                                </span>
                                            </button>
                                            <div className={rowActionClass}>
                                                <button type="button" className={tileButtonClass} onClick={() => void runOnPlaylists([playlist], 'add')} disabled={locked || playlist.added}>
                                                    {playlist.added ? 'Saved' : 'Add'}
                                                </button>
                                                <button type="button" className={tileButtonClass} onClick={() => void runOnPlaylists([playlist], 'schedule')} disabled={locked}>
                                                    Schedule
                                                </button>
                                                <button type="button" className={tilePrimaryClass} onClick={() => void runOnPlaylists([playlist], 'sync')} disabled={locked} title="Sync to Plex">
                                                    {busyAction === 'sync' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                                                    Sync
                                                </button>
                                                <button
                                                    type="button"
                                                    className={rowCheckClass(selected)}
                                                    onClick={() => toggleSelected(playlist.id)}
                                                    title={selected ? 'Deselect' : 'Select'}
                                                >
                                                    {selected ? <CheckSquare className="h-5 w-5" /> : <Square className="h-5 w-5" />}
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                            {accountTotalPages > 1 ? (
                                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                                    <p className="text-xs text-muted">Page {safeAccountPage} of {accountTotalPages}</p>
                                    <div className="flex items-center gap-2">
                                        <button
                                            type="button"
                                            className={buttonClass}
                                            disabled={safeAccountPage <= 1}
                                            onClick={() => setAccountPage((page) => Math.max(1, page - 1))}
                                        >
                                            <ChevronLeft className="h-3.5 w-3.5" />
                                            Previous
                                        </button>
                                        <button
                                            type="button"
                                            className={buttonClass}
                                            disabled={safeAccountPage >= accountTotalPages}
                                            onClick={() => setAccountPage((page) => Math.min(accountTotalPages, page + 1))}
                                        >
                                            Next
                                            <ChevronRight className="h-3.5 w-3.5" />
                                        </button>
                                    </div>
                                </div>
                            ) : null}
                            </>
                        )}
                    </div>
                )}
            </DashboardPanel>

            <DashboardPanel title="Add playlist, album, or artist" subtitle="Paste a Spotify URL or URI for playlists that search still misses (Made For You, private links). Albums and playlists are saved as-is. An artist page adds their albums (up to 30), then matches tracks and creates or updates Plex playlists.">
                <div className="flex flex-col gap-2 sm:flex-row">
                    <input
                        className="appearance-none text-[16px] leading-5 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-[16px] text-text"
                        placeholder="https://open.spotify.com/playlist/… · /album/… · /artist/…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') void addItem(); }}
                    />
                    <button type="button" className={primaryButtonClass} onClick={() => void addItem()} disabled={adding || !search.trim()}>
                        {adding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                        {adding ? 'Adding…' : 'Add and sync'}
                    </button>
                </div>
            </DashboardPanel>

            <DashboardPanel
                title="Saved items"
                subtitle={`${items.length} saved playlist${items.length === 1 ? '' : 's'} and albums. Sync to Plex creates or updates a Plex playlist for each item. Auto-sync uses each item’s interval plus Settings → Spotify Sync.`}
                controls={items.length ? (
                    <div className="flex flex-wrap gap-2">
                        <button
                            type="button"
                            className={buttonClass}
                            onClick={() => {
                                const ids = items.map((item) => item.id);
                                setSavedSelectedIds((prev) => prev.size === ids.length ? new Set() : new Set(ids));
                            }}
                        >
                            {savedSelectedIds.size === items.length ? 'Clear saved' : 'Select all saved'}
                        </button>
                        <button type="button" className={buttonClass} onClick={() => void runOnSaved([...savedSelectedIds], 'schedule')} disabled={!savedSelectedIds.size || locked}>
                            Schedule selected
                        </button>
                        <button
                            type="button"
                            className={primaryButtonClass}
                            onClick={() => {
                                if (!savedSelectedIds.size) {
                                    toast('Select one or more saved playlists or albums first.', 'error');
                                    return;
                                }
                                void runOnSaved([...savedSelectedIds], 'sync');
                            }}
                            disabled={locked}
                        >
                            {busyAction === 'saved-sync' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                            Sync to Plex
                        </button>
                    </div>
                ) : undefined}
            >
                {loading ? (
                    <p className="text-sm text-muted">Loading…</p>
                ) : items.length === 0 ? (
                    <p className="text-sm text-muted">Nothing saved yet. Import from your Spotify account above, or paste a playlist, album, or artist URL.</p>
                ) : (
                    <div className="space-y-6">
                        {groups.map(([label, groupItems]) => (
                            <div key={label}>
                                <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">{label}</h3>
                                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                                    {groupItems.map((item) => (
                                        <div key={item.id} className={`flex flex-col gap-3 ${rowCardClass(savedSelectedIds.has(item.id))}`}>
                                            <button
                                                type="button"
                                                className="flex min-w-0 items-center gap-3 text-left"
                                                onClick={() => toggleSavedSelected(item.id)}
                                            >
                                                <span className="shrink-0 overflow-hidden rounded-xl">
                                                    {item.image ? (
                                                        <img src={workerImageUrl(item.image)} alt="" className={artworkClass} />
                                                    ) : (
                                                        <span className={artworkFallbackClass}>
                                                            {item.type === 'spotify-album' ? <Disc3 className="h-12 w-12" /> : <ListMusic className="h-12 w-12" />}
                                                        </span>
                                                    )}
                                                </span>
                                                <span className="min-w-0 flex-1">
                                                    <p className="text-[15px] font-semibold leading-snug text-text [overflow-wrap:anywhere]">{item.title || item.id}</p>
                                                    <p className="mt-1.5 text-xs leading-relaxed text-muted [overflow-wrap:anywhere]">
                                                        {item.type === 'spotify-album' ? 'Album' : item.type === 'plex-media' ? 'Plex' : 'Playlist'}
                                                        {' · '}
                                                        {item.sync ? `Auto-sync every ${item.sync_interval || 1}d` : 'Manual only'}
                                                    </p>
                                                </span>
                                                <span className={rowCheckClass(savedSelectedIds.has(item.id))}>
                                                    {savedSelectedIds.has(item.id) ? <CheckSquare className="h-5 w-5" /> : <Square className="h-5 w-5" />}
                                                </span>
                                            </button>
                                            <div className="flex items-center gap-1">
                                                <button type="button" className="rounded-lg p-2 text-muted hover:text-plex" onClick={() => void inspectItem(item)} title="Preview Spotify tracks">
                                                    <Eye className="h-4 w-4" />
                                                </button>
                                                <button type="button" className="rounded-lg p-2 text-muted hover:text-plex" onClick={() => setEditing(item)} title="Settings">
                                                    <Pencil className="h-4 w-4" />
                                                </button>
                                                <button type="button" className="rounded-lg p-2 text-muted hover:text-rose-300" onClick={() => void removeItem(item.id)} title="Remove">
                                                    <Trash2 className="h-4 w-4" />
                                                </button>
                                                <button type="button" className={`${tilePrimaryClass} ml-auto`} onClick={() => void runOnSaved([item.id], 'sync')} disabled={locked} title="Match tracks and create or update this playlist on Plex">
                                                    {busyAction === 'saved-sync' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                                                    Sync
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </DashboardPanel>

            {preview ? (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setPreview(null)}>
                    <div className="max-h-[80vh] w-full max-w-lg overflow-hidden rounded-2xl border border-white/10 bg-card shadow-2xl" onClick={(e) => e.stopPropagation()}>
                        <div className="border-b border-white/10 px-5 py-3">
                            <h3 className="font-bold text-text">{preview.title}</h3>
                            <p className="text-xs text-muted">{preview.tracks.length} tracks on Spotify — this list is a preview, not a Plex sync.</p>
                        </div>
                        <div className="max-h-[50vh] overflow-y-auto p-3">
                            {preview.tracks.length === 0 ? (
                                <p className="px-2 py-4 text-sm text-muted">No track list returned for this item.</p>
                            ) : preview.tracks.map((track: any, index: number) => (
                                <div key={track.id || index} className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 text-sm">
                                    <span className="min-w-0 truncate text-text">{track.title || track.name || 'Track'}</span>
                                    <span className="shrink-0 text-xs text-muted">{Array.isArray(track.artists) ? track.artists.join(', ') : (track.artist || track.artists || '')}</span>
                                </div>
                            ))}
                        </div>
                        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-white/10 px-5 py-3">
                            <button type="button" className={buttonClass} onClick={() => setPreview(null)}>Close</button>
                            <button
                                type="button"
                                className={primaryButtonClass}
                                onClick={() => {
                                    const id = preview.id;
                                    setPreview(null);
                                    void runOnSaved([id], 'sync');
                                }}
                                disabled={locked}
                            >
                                <Play className="h-3.5 w-3.5" />
                                Sync to Plex
                            </button>
                        </div>
                    </div>
                </div>
            ) : null}
            {previewing ? (
                <p className="text-xs text-muted">Loading Spotify tracks…</p>
            ) : null}
            {editing ? (
                <SavedItemEditor
                    item={editing}
                    labels={labels}
                    onClose={() => setEditing(null)}
                    onSaved={(next) => { setItems(next); setEditing(null); }}
                />
            ) : null}
        </>
    );
};

const SavedItemEditor: React.FC<{
    item: SavedItem;
    labels: string[];
    onClose: () => void;
    onSaved: (items: SavedItem[]) => void;
}> = ({ item, labels, onClose, onSaved }) => {
    const [label, setLabel] = useState(item.label || '');
    const [sync, setSync] = useState(!!item.sync);
    const [interval, setIntervalDays] = useState(String(item.sync_interval || '2'));
    const [saving, setSaving] = useState(false);

    const save = async () => {
        setSaving(true);
        try {
            const data = await workerFetch('saved-items', {
                method: 'PUT',
                body: JSON.stringify({
                    ids: [item.id],
                    label,
                    sync,
                    sync_interval: interval,
                }),
            });
            toast('Saved', 'success');
            onSaved(Array.isArray(data) ? data : []);
        } catch (e: any) {
            toast(e?.message || 'Save failed', 'error');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
            <div className="w-full max-w-md rounded-2xl border border-white/10 bg-card p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
                <h3 className="text-lg font-bold text-text">Playlist settings</h3>
                <p className="mt-1 truncate text-xs text-muted">{item.title}</p>
                <label className="mt-4 block text-[11px] font-bold uppercase tracking-wider text-muted">Category</label>
                <input className="appearance-none text-[16px] leading-5 mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-[16px]" value={label} onChange={(e) => setLabel(e.target.value)} />
                <div className="mt-2 flex flex-wrap gap-1">
                    {labels.map((entry) => (
                        <button key={entry} type="button" className="rounded-full border border-white/10 px-2 py-0.5 text-[11px] text-muted hover:border-plex hover:text-plex" onClick={() => setLabel(entry)}>
                            {entry}
                        </button>
                    ))}
                </div>
                <label className="mt-4 flex items-center gap-2 text-sm text-text">
                    <input type="checkbox" checked={sync} onChange={(e) => setSync(e.target.checked)} />
                    Automatic sync
                </label>
                {sync ? (
                    <>
                        <input
                            type="number"
                            min={0}
                            className="appearance-none text-[16px] leading-5 mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-[16px]"
                            value={interval}
                            onChange={(e) => setIntervalDays(e.target.value)}
                        />
                        <p className="mt-2 text-[11px] text-muted">0 includes this playlist on every scheduled run.</p>
                    </>
                ) : null}
                <div className="mt-5 flex justify-end gap-2">
                    <button type="button" className={buttonClass} onClick={onClose}>Cancel</button>
                    <button type="button" className={primaryButtonClass} onClick={() => void save()} disabled={saving}>Save</button>
                </div>
            </div>
        </div>
    );
};

const UsersPanel: React.FC = () => {
    const [users, setUsers] = useState<SpotifyUser[]>([]);
    const [loading, setLoading] = useState(true);
    const [emptyMessage, setEmptyMessage] = useState('');

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const data = await workerFetch('spotify/users');
            setUsers(Array.isArray(data) ? data : []);
            setEmptyMessage('');
        } catch (e: any) {
            setUsers([]);
            setEmptyMessage(e?.message || 'No Spotify users connected.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { void load(); }, [load]);

    const updateUser = async (user: SpotifyUser, patch: Partial<SpotifyUser>) => {
        try {
            const data = await workerFetch('spotify/users', {
                method: 'PUT',
                body: JSON.stringify({ id: user.id, ...patch }),
            });
            setUsers(Array.isArray(data) ? data : []);
        } catch (e: any) {
            toast(e?.message || 'Update failed', 'error');
        }
    };

    const removeUser = async (id: string) => {
        try {
            await workerFetch(`spotify/users?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
            await load();
            toast('Spotify user removed', 'success');
        } catch (e: any) {
            toast(e?.message || 'Remove failed', 'error');
        }
    };

    return (
        <DashboardPanel
            title="Spotify accounts"
            subtitle="Connect accounts used for private playlists and Liked Songs. After connecting, open Playlists to import them."
            controls={(
                <a href={portalUrl('/api/spotify-to-plex/spotify-login')} className={primaryButtonClass}>
                    Connect Spotify
                </a>
            )}
        >
            {loading ? (
                <p className="text-sm text-muted">Loading…</p>
            ) : users.length === 0 ? (
                <p className="text-sm text-muted">{emptyMessage || 'No Spotify users connected yet.'}</p>
            ) : (
                <div className="space-y-2">
                    {users.map((user) => (
                        <div key={user.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-black/25 px-4 py-3">
                            <div className="min-w-0 flex-1">
                                <p className="font-semibold text-text">{user.name || user.id}</p>
                                <p className="text-[11px] text-muted">{user.id}</p>
                            </div>
                            <label className="flex items-center gap-2 text-xs text-muted">
                                <input type="checkbox" checked={!!user.sync} onChange={(e) => void updateUser(user, { sync: e.target.checked })} />
                                Sync
                            </label>
                            <label className="flex items-center gap-2 text-xs text-muted">
                                <input type="checkbox" checked={!!user.recentContext} onChange={(e) => void updateUser(user, { recentContext: e.target.checked })} />
                                Recent context
                            </label>
                            <button type="button" className={buttonClass} onClick={() => void removeUser(user.id)}>
                                <Trash2 className="h-3.5 w-3.5" /> Remove
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </DashboardPanel>
    );
};

const SyncPanel: React.FC<{
    status: SyncStatus | null;
    busy: boolean;
    onSync: (type: string) => void;
    onSyncPlaylistsToPlex: () => void;
    onApplyPlex: () => void;
    onOpenPlaylists: () => void;
}> = ({ status, busy, onSync, onSyncPlaylistsToPlex, onApplyPlex, onOpenPlaylists }) => {
    const [availability, setAvailability] = useState<Record<string, boolean>>({});

    useEffect(() => {
        void workerFetch('sync/availability').then((data) => {
            if (data && typeof data === 'object') setAvailability(data);
        }).catch(() => {});
    }, []);

    return (
        <div className="grid gap-4 lg:grid-cols-2">
            <DashboardPanel title="Plex connection" subtitle="Spotify Sync uses the Plex URL and token from Settings → Plex. You do not log into Plex on this page.">
                <p className="text-sm text-text">{status?.plexLoggedIn ? 'Linked' : 'Not linked yet'}</p>
                {status?.plexUri ? <p className="mt-1 truncate text-xs text-muted">{status.plexUri}</p> : null}
                <button type="button" className={`${buttonClass} mt-3`} onClick={onApplyPlex} disabled={busy}>
                    <Settings2 className="h-3.5 w-3.5" /> Apply portal Plex settings
                </button>
            </DashboardPanel>
            <DashboardPanel
                title="Manual sync"
                subtitle="Day-to-day use is Playlists → Sync to Plex. These buttons re-run saved items or start optional worker jobs (albums, Lidarr, SLSKD, MQTT)."
            >
                <button type="button" className={`${buttonClass} mb-3`} onClick={onOpenPlaylists}>
                    <ListMusic className="h-3.5 w-3.5" />
                    Go to Playlists
                </button>
                <div className="flex flex-wrap gap-2">
                    {SYNC_TYPES.map((entry) => (
                        <button
                            key={entry.id}
                            type="button"
                            className={entry.id === 'playlists' || entry.id === 'all' ? primaryButtonClass : buttonClass}
                            disabled={busy || (entry.id !== 'all' && entry.id !== 'playlists' && availability[entry.id] === false)}
                            onClick={() => (entry.id === 'playlists' ? onSyncPlaylistsToPlex() : onSync(entry.id))}
                            title={availability[entry.id] === false ? 'Not configured' : undefined}
                        >
                            {entry.id === 'playlists' ? 'Playlists to Plex' : entry.label}
                        </button>
                    ))}
                </div>
            </DashboardPanel>
        </div>
    );
};

const IntegrationsPanel: React.FC = () => {
    const [lidarr, setLidarr] = useState('{}');
    const [slskd, setSlskd] = useState('{}');
    const [tidalOk, setTidalOk] = useState<boolean | null>(null);
    const [lidarrOk, setLidarrOk] = useState<boolean | null>(null);
    const [slskdOk, setSlskdOk] = useState<boolean | null>(null);

    useEffect(() => {
        void (async () => {
            try { setLidarr(JSON.stringify(await workerFetch('lidarr/settings'), null, 2)); } catch { /* ignore */ }
            try { setSlskd(JSON.stringify(await workerFetch('slskd/settings'), null, 2)); } catch { /* ignore */ }
            try {
                const valid = await workerFetch('lidarr/valid');
                setLidarrOk(!!valid?.ok);
            } catch { setLidarrOk(false); }
            try {
                const valid = await workerFetch('slskd/valid');
                setSlskdOk(!!valid?.ok);
            } catch { setSlskdOk(false); }
            try {
                const valid = await workerFetch('tidal/valid');
                setTidalOk(!!valid?.ok);
            } catch { setTidalOk(false); }
        })();
    }, []);

    const save = async (path: string, raw: string, label: string) => {
        try {
            await workerFetch(path, { method: 'PUT', body: JSON.stringify(JSON.parse(raw)) });
            toast(`${label} saved`, 'success');
        } catch (e: any) {
            toast(e?.message || `Could not save ${label}`, 'error');
        }
    };

    return (
        <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
                {[
                    { label: 'Lidarr', ok: lidarrOk },
                    { label: 'SLSKD', ok: slskdOk },
                    { label: 'Tidal', ok: tidalOk },
                ].map((item) => (
                    <div key={item.label} className="rounded-xl border border-white/10 bg-black/25 px-4 py-3">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-muted">{item.label}</p>
                        <p className={`mt-1 text-sm font-semibold ${item.ok ? 'text-emerald-300' : 'text-amber-200'}`}>
                            {item.ok == null ? '…' : item.ok ? 'Configured' : 'Not configured'}
                        </p>
                    </div>
                ))}
            </div>
            <DashboardPanel title="Lidarr" controls={<button type="button" className={primaryButtonClass} onClick={() => void save('lidarr/settings', lidarr, 'Lidarr')}>Save</button>}>
                <textarea className="appearance-none text-[16px] leading-5 min-h-[140px] w-full rounded-lg border border-white/10 bg-black/40 p-3 font-mono text-[16px]" value={lidarr} onChange={(e) => setLidarr(e.target.value)} />
            </DashboardPanel>
            <DashboardPanel title="SLSKD" controls={<button type="button" className={primaryButtonClass} onClick={() => void save('slskd/settings', slskd, 'SLSKD')}>Save</button>}>
                <textarea className="appearance-none text-[16px] leading-5 min-h-[140px] w-full rounded-lg border border-white/10 bg-black/40 p-3 font-mono text-[16px]" value={slskd} onChange={(e) => setSlskd(e.target.value)} />
            </DashboardPanel>
        </div>
    );
};

const LogsPanel: React.FC = () => {
    const [logs, setLogs] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async (silent = false) => {
        if (!silent) setLoading(true);
        try {
            setLogs(await apiFetch('/api/spotify-to-plex/logs'));
        } catch (e: any) {
            if (!silent) {
                toast(e?.message || 'Could not load logs', 'error');
                setLogs(null);
            }
        } finally {
            setLoading(false);
        }
    }, []);

    usePoll(() => { void load(true); }, 3_000, { immediate: true });

    const clear = async () => {
        try {
            setLogs(await apiFetch('/api/spotify-to-plex/logs', { method: 'DELETE' }));
            toast('Logs cleared', 'success');
        } catch (e: any) {
            toast(e?.message || 'Clear failed', 'error');
        }
    };

    const missing = logs?.missing_files || {};
    const types = ['playlists', 'albums', 'users', 'lidarr', 'mqtt', 'slskd'];
    const syncLog = logs?.sync_log || {};

    return (
        <DashboardPanel
            title="Sync history"
            subtitle="Plex playlist jobs plus worker logs for albums, users, Lidarr, MQTT, and SLSKD."
            controls={(
                <div className="flex gap-2">
                    <button type="button" className={buttonClass} onClick={() => void load()}>Refresh</button>
                    <button type="button" className={buttonClass} onClick={() => void clear()}>Clear</button>
                </div>
            )}
        >
            {loading && !logs ? <p className="text-sm text-muted">Loading…</p> : (
                <div className="space-y-4">
                    {types.map((type) => {
                        const entries = Array.isArray(syncLog[type]) ? syncLog[type] : [];
                        return (
                        <div key={type}>
                            <h3 className="mb-1 text-xs font-bold uppercase tracking-wider text-muted">{type}</h3>
                            {!entries.length ? (
                                <p className="text-xs text-muted">No runs</p>
                            ) : (
                                <ul className="space-y-1 text-xs">
                                    {[...entries].slice(0, 12).map((entry: any, index: number) => (
                                        <li key={entry.id || index} className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-text">
                                            {entry.error || entry.message || entry.status || JSON.stringify(entry)}
                                            {entry.total ? (
                                                <span className="ml-2 text-muted">{entry.done || 0}/{entry.total}</span>
                                            ) : null}
                                            {entry.finishedAt || entry.timestamp || entry.startedAt ? (
                                                <span className="ml-2 text-muted">{formatWhen(entry.finishedAt || entry.timestamp || entry.startedAt)}</span>
                                            ) : null}
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                        );
                    })}
                    {Object.entries(missing).some(([, value]) => String(value || '').trim()) ? (
                        <div>
                            <h3 className="mb-1 text-xs font-bold uppercase tracking-wider text-muted">Missing files</h3>
                            {Object.entries(missing).map(([name, value]) => String(value || '').trim() ? (
                                <pre key={name} className="mb-2 max-h-48 overflow-auto rounded-lg border border-white/10 bg-black/40 p-3 text-[11px] text-muted">
                                    {name}{'\n'}{String(value)}
                                </pre>
                            ) : null)}
                        </div>
                    ) : null}
                </div>
            )}
        </DashboardPanel>
    );
};

export default SpotifySyncPage;
