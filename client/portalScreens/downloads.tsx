import { DownloadCloud,FileText,Film,HardDrive,Music,Pause,Play,RefreshCw,Tv,Upload,X } from 'lucide-react';
import React,{ useCallback,useEffect,useMemo,useRef,useState } from 'react';

import { useDiscoverI18n } from '../discovery/i18n';
import { apiFetch } from '../shared/api';
import { appConfirm } from '../shared/confirm';
import {
DashboardHero,
DashboardPageShell,
DashboardPanel,
DashboardStatCard,
dashboardGlowClass,
preferCollapsedOnNarrow,
usePersistedCollapsed
} from '../shared/dashboard/DashboardChrome';
import { isActiveDownloadItem } from '../shared/downloadStatus';
import { Loader } from '../shared/toast';
import { CustomSelect } from '../shared/ui';
import { usePoll } from '../shared/usePoll';
import { STATUS_ICON_BASE } from './common';


const DOWNLOADS_STATUS_FILTER_KEY = 'portal-downloads-status-filter';
const DOWNLOADS_CLIENT_FILTER_KEY = 'portal-downloads-client-filter';
const DOWNLOADS_UPLOAD_COLLAPSED_KEY = 'portal-downloads-upload-collapsed';
const DOWNLOADS_CLIENTS_COLLAPSED_KEY = 'portal-downloads-clients-collapsed';
export const OPS_SNAPSHOT_COLLAPSED_KEY = 'portal-home-ops-snapshot-collapsed';
export const ACTIVE_STREAMS_COLLAPSED_KEY = 'portal-home-active-streams-collapsed';
export const ANALYTICS_OVERVIEW_SNAPSHOT_COLLAPSED_KEY = 'portal-analytics-overview-snapshot-collapsed';
export const USERS_STATS_COLLAPSED_KEY = 'portal-users-stats-collapsed';

const downloadClientTypeLabel = (type: string, fallback = 'Download Client') => ({
    qbittorrent: 'qBittorrent',
    rdtclient: 'Real-Debrid Client',
    transmission: 'Transmission',
    bittorrent: 'BitTorrent',
    deluge: 'Deluge',
    sabnzbd: 'SABnzbd',
    nzbget: 'NZBGet',
}[String(type || '').toLowerCase()] || fallback);

const torrentUploadFileKey = (file: File) => `${file.name}:${file.size}:${file.lastModified}`;

const isTorrentUploadFile = (file: File) => {
    const name = String(file.name || '').toLowerCase();
    const type = String(file.type || '').toLowerCase();
    return name.endsWith('.torrent') || type === 'application/x-bittorrent';
};

const collectTorrentUploadFiles = (current: File[], incoming: ArrayLike<File>) => {
    const next = [...current];
    const seen = new Set(next.map(torrentUploadFileKey));
    let skipped = 0;
    for (const file of Array.from(incoming)) {
        if (!isTorrentUploadFile(file)) {
            skipped += 1;
            continue;
        }
        const key = torrentUploadFileKey(file);
        if (seen.has(key)) continue;
        seen.add(key);
        next.push(file);
    }
    return { files: next, skipped };
};

const readStoredDownloadFilter = <T extends string>(key: string, allowed: readonly T[], fallback: T): T => {
    try {
        const raw = String(localStorage.getItem(key) || '').trim() as T;
        return allowed.includes(raw) ? raw : fallback;
    } catch {
        return fallback;
    }
};

export const DownloadStatusPage: React.FC<{ isAdmin?: boolean }> = ({ isAdmin = false }) => {
    const { t } = useDiscoverI18n();
    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [filter, setFilter] = useState<'all' | 'sonarr' | 'radarr' | 'lidarr' | 'unknown'>('all');
    const [statusFilter, setStatusFilter] = useState<'all' | 'active'>(() => (
        readStoredDownloadFilter(DOWNLOADS_STATUS_FILTER_KEY, ['all', 'active'] as const, 'active')
    ));
    const [clientFilter, setClientFilter] = useState<string>(() => {
        try {
            return String(localStorage.getItem(DOWNLOADS_CLIENT_FILTER_KEY) || 'all').trim() || 'all';
        } catch {
            return 'all';
        }
    });
    const [busyAction, setBusyAction] = useState('');
    const [uploadClientId, setUploadClientId] = useState('');
    const [uploadCategory, setUploadCategory] = useState('');
    const [torrentUrl, setTorrentUrl] = useState('');
    const [torrentFiles, setTorrentFiles] = useState<File[]>([]);
    const [fileDropActive, setFileDropActive] = useState(false);
    const [uploadBusy, setUploadBusy] = useState(false);
    const [uploadCollapsed, setUploadCollapsed] = usePersistedCollapsed(
        DOWNLOADS_UPLOAD_COLLAPSED_KEY,
        preferCollapsedOnNarrow(),
    );
    const [clientsCollapsed, setClientsCollapsed] = usePersistedCollapsed(
        DOWNLOADS_CLIENTS_COLLAPSED_KEY,
        preferCollapsedOnNarrow(),
    );
    const loadGenRef = useRef(0);
    const torrentDropDepthRef = useRef(0);

    const load = useCallback(async () => {
        const gen = ++loadGenRef.current;
        try {
            const res = await apiFetch('/api/downloads/status');
            if (gen !== loadGenRef.current) return;
            setData(res);
            setError('');
        } catch (e: any) {
            if (gen !== loadGenRef.current) return;
            setError(e.message || t('downloads.errors.loadFailed'));
        } finally {
            if (gen === loadGenRef.current) setLoading(false);
        }
    }, [t]);

    useEffect(() => {
        void load();
    }, [load]);

    usePoll(() => { void load(); }, 15_000);

    useEffect(() => {
        try { localStorage.setItem(DOWNLOADS_STATUS_FILTER_KEY, statusFilter); } catch { /* ignore */ }
    }, [statusFilter]);

    useEffect(() => {
        try { localStorage.setItem(DOWNLOADS_CLIENT_FILTER_KEY, clientFilter); } catch { /* ignore */ }
    }, [clientFilter]);

    const allDownloads = useMemo(
        () => (Array.isArray(data?.downloads) ? data.downloads : []),
        [data],
    );

    const downloads = useMemo(() => {
        let list = allDownloads;
        if (statusFilter === 'active') list = list.filter(isActiveDownloadItem);
        if (filter !== 'all') list = list.filter((item: any) => item.source === filter);
        if (clientFilter !== 'all') list = list.filter((item: any) => String(item.clientId) === clientFilter);
        return list;
    }, [allDownloads, filter, clientFilter, statusFilter]);

    const sourceCounts = useMemo(() => {
        const base = statusFilter === 'active' ? allDownloads.filter(isActiveDownloadItem) : allDownloads;
        return {
            total: base.length,
            sonarr: base.filter((item: any) => item.source === 'sonarr').length,
            radarr: base.filter((item: any) => item.source === 'radarr').length,
            lidarr: base.filter((item: any) => item.source === 'lidarr').length,
            unknown: base.filter((item: any) => item.source === 'unknown').length,
        };
    }, [allDownloads, statusFilter]);

    const torrentClients = useMemo(() => (
        (Array.isArray(data?.clients) ? data.clients : [])
            .filter((entry: any) => !['sabnzbd', 'nzbget'].includes(String(entry?.client?.type || '').toLowerCase()))
            .map((entry: any) => entry.client)
    ), [data]);

    const clientSelectOptions = useMemo(() => {
        const clients = Array.isArray(data?.clients) ? data.clients : [];
        return [
            { label: t('downloads.filters.allClients'), value: 'all' },
            ...clients.map((entry: any) => ({
                label: entry?.client?.name || downloadClientTypeLabel(entry?.client?.type, t('downloads.labels.downloadClient')),
                value: String(entry?.client?.id || ''),
            })).filter((option: { value: string }) => option.value),
        ];
    }, [data, t]);

    useEffect(() => {
        if (clientFilter === 'all') return;
        const known = (Array.isArray(data?.clients) ? data.clients : [])
            .some((entry: any) => String(entry?.client?.id || '') === clientFilter);
        if (data && !known) setClientFilter('all');
    }, [data, clientFilter]);

    useEffect(() => {
        if (!uploadClientId && torrentClients.length > 0) setUploadClientId(String(torrentClients[0].id));
        if (uploadClientId && !torrentClients.some((client: any) => String(client.id) === uploadClientId)) {
            setUploadClientId(torrentClients[0]?.id ? String(torrentClients[0].id) : '');
        }
    }, [torrentClients, uploadClientId]);

    const formatBytes = (bytes: number) => {
        if (!bytes) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        let value = Number(bytes) || 0;
        let unit = 0;
        while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
        return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
    };

    const sourceLabel = (source: string) => ({ sonarr: 'Sonarr', radarr: 'Radarr', lidarr: 'Lidarr', unknown: t('downloads.filters.other') }[source] || t('downloads.filters.other'));
    const uploadCategoryOptions = useMemo(() => {
        const seen = new Set(['']);
        const arrOptions = (Array.isArray(data?.downloadCategoryOptions) ? data.downloadCategoryOptions : [])
            .map((option: any) => ({
                label: String(option?.label || option?.value || '').trim(),
                value: String(option?.value || '').trim(),
            }))
            .filter((option: any) => {
                if (!option.value || seen.has(option.value)) return false;
                seen.add(option.value);
                return true;
            });
        return [{ label: t('downloads.upload.noCategory'), value: '' }, ...arrOptions];
    }, [data, t]);
    useEffect(() => {
        if (uploadCategory && !uploadCategoryOptions.some((option) => String(option.value) === uploadCategory)) {
            setUploadCategory('');
        }
    }, [uploadCategory, uploadCategoryOptions]);
    const downloadClientLabel = (type: string) => downloadClientTypeLabel(type, t('downloads.labels.downloadClient'));
    const downloadClientIcon = (type: string) => {
        const normalized = String(type || '').toLowerCase();
        if (normalized === 'bittorrent') return 'https://cdn.simpleicons.org/bittorrent';
        if (normalized === 'rdtclient') return 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/rdt-client.svg';
        if (['qbittorrent', 'transmission', 'deluge', 'sabnzbd', 'nzbget'].includes(normalized)) return `${STATUS_ICON_BASE}/${normalized}.svg`;
        return `${STATUS_ICON_BASE}/qbittorrent.svg`;
    };
    const isPausedDownload = (item: any) => {
        const state = String(item?.state || '').toLowerCase();
        return state.includes('pause') || state.includes('stop') || state === 'queued';
    };
    const downloadActionLabel = (action: 'pause' | 'resume' | 'remove') => t(`downloads.actions.${action}`);
    const sendDownloadControl = async (item: any, action: 'pause' | 'resume' | 'remove') => {
        const key = `${item.clientId}-${item.id}-${action}`;
        setBusyAction(key);
        try {
            await apiFetch('/api/downloads/control', {
                method: 'POST',
                body: JSON.stringify({
                    clientId: item.clientId,
                    downloadId: item.downloadId || item.hash || item.infoHash || item.id,
                    action,
                }),
            });
            await load();
        } catch (e: any) {
            setError(e.message || t('downloads.errors.actionFailed', { action: downloadActionLabel(action) }));
        } finally {
            setBusyAction('');
        }
    };
    const controlDownload = (item: any, action: 'pause' | 'resume' | 'remove') => {
        if (action === 'remove') {
            appConfirm(
                t('downloads.confirm.remove', { name: item.name, client: item.clientName }),
                () => { sendDownloadControl(item, action); },
            );
            return;
        }
        sendDownloadControl(item, action);
    };
    const addTorrentFiles = (incoming: ArrayLike<File>) => {
        const { files, skipped } = collectTorrentUploadFiles(torrentFiles, incoming);
        if (!files.length && skipped) {
            setError(t('downloads.errors.invalidTorrent'));
            return;
        }
        setTorrentFiles(files);
        if (files.length) setTorrentUrl('');
        if (skipped && files.length) setError('');
    };
    const uploadTorrent = async () => {
        const targetClientId = String(uploadClientId || '').trim();
        if (!targetClientId) {
            setError(t('downloads.errors.chooseClient'));
            return;
        }
        if (!torrentFiles.length && !torrentUrl.trim()) {
            setError(t('downloads.errors.missingSource'));
            return;
        }
        setUploadBusy(true);
        const category = String(uploadCategory || '').trim();
        try {
            if (torrentFiles.length) {
                const failedKeys: string[] = [];
                const failedNames: string[] = [];
                for (const file of torrentFiles) {
                    try {
                        const bytes = await file.arrayBuffer();
                        const params = new URLSearchParams({
                            clientId: targetClientId,
                            filename: file.name || 'upload.torrent',
                        });
                        if (category) params.set('category', category);
                        await apiFetch(`/api/downloads/add-file?${params.toString()}`, {
                            method: 'POST',
                            headers: { 'Content-Type': file.type || 'application/x-bittorrent' },
                            body: bytes,
                        });
                    } catch {
                        failedKeys.push(torrentUploadFileKey(file));
                        failedNames.push(file.name || t('downloads.upload.torrentFile'));
                    }
                }
                const added = torrentFiles.length - failedKeys.length;
                if (failedKeys.length) {
                    setError(t('downloads.errors.addPartial', {
                        added,
                        total: torrentFiles.length,
                        failed: failedNames.join(', '),
                    }));
                    if (!added) return;
                    setTorrentFiles((current) => current.filter((file) => failedKeys.includes(torrentUploadFileKey(file))));
                } else {
                    setTorrentFiles([]);
                    setError('');
                }
                setTorrentUrl('');
            } else {
                await apiFetch('/api/downloads/add-url', {
                    method: 'POST',
                    body: JSON.stringify({ clientId: targetClientId, url: torrentUrl.trim(), category }),
                });
                setTorrentUrl('');
                setTorrentFiles([]);
                setError('');
            }
            await load();
        } catch (e: any) {
            setError(e.message || t('downloads.errors.addFailed'));
        } finally {
            setUploadBusy(false);
        }
    };

    if (loading) {
        return (
            <DashboardPageShell>
                <Loader isLoading={true} />
            </DashboardPageShell>
        );
    }

    const sourceFilterMeta: Record<'all' | 'sonarr' | 'radarr' | 'lidarr' | 'unknown', { label: string; icon: React.ReactNode; glow: string }> = {
        all: { label: t('downloads.filters.all'), icon: <DownloadCloud className="h-4 w-4 text-muted" />, glow: dashboardGlowClass('plex') },
        sonarr: { label: 'Sonarr', icon: <Tv className="h-4 w-4 text-muted" />, glow: dashboardGlowClass('sky') },
        radarr: { label: 'Radarr', icon: <Film className="h-4 w-4 text-muted" />, glow: dashboardGlowClass('violet') },
        lidarr: { label: 'Lidarr', icon: <Music className="h-4 w-4 text-muted" />, glow: dashboardGlowClass('emerald') },
        unknown: { label: t('downloads.filters.other'), icon: <HardDrive className="h-4 w-4 text-muted" />, glow: dashboardGlowClass('muted') },
    };

    return (
        <DashboardPageShell>
            <DashboardHero
                accent="sky"
                eyebrow={t('downloads.page.eyebrow')}
                title={t('downloads.page.title')}
                description={t('downloads.page.description')}
                icon={<DownloadCloud className="h-3.5 w-3.5" />}
                secondaryBlob
                actions={(
                    <button
                        type="button"
                        onClick={() => void load()}
                        className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-4 py-2.5 text-sm font-semibold text-text transition hover:border-plex/40 hover:bg-white/5"
                    >
                        <RefreshCw className="h-4 w-4" />
                        {t('downloads.actions.refresh')}
                    </button>
                )}
            />

            {error && <div className="rounded-xl border border-red-500/30 bg-red-500/10 text-red-200 px-4 py-3 text-sm">{error}</div>}

            {isAdmin && (
                <DashboardPanel
                    title={t('downloads.upload.title')}
                    subtitle={t('downloads.upload.subtitle')}
                    collapsible
                    collapsed={uploadCollapsed}
                    onCollapsedChange={setUploadCollapsed}
                    collapseLabel={t('downloads.actions.collapse')}
                    expandLabel={t('downloads.actions.expand')}
                >
                    <div className="space-y-3">
                        <div className="flex flex-col lg:flex-row lg:items-end gap-3">
                            <div className="lg:w-56">
                                <label className="text-[10px] uppercase tracking-widest font-bold text-muted mb-1.5 block">{t('downloads.upload.client')}</label>
                                <CustomSelect
                                    value={uploadClientId}
                                    onChange={setUploadClientId}
                                    options={torrentClients.map((client: any) => ({
                                        label: client.name || downloadClientLabel(client.type),
                                        value: String(client.id),
                                    }))}
                                />
                            </div>
                            <div className="lg:w-48">
                                <label className="text-[10px] uppercase tracking-widest font-bold text-muted mb-1.5 block">{t('downloads.upload.category')}</label>
                                <CustomSelect
                                    value={uploadCategory}
                                    onChange={setUploadCategory}
                                    options={uploadCategoryOptions}
                                />
                            </div>
                            <div className="flex-1 min-w-0">
                                <label className="text-[10px] uppercase tracking-widest font-bold text-muted mb-1.5 block">{t('downloads.upload.torrentUrl')}</label>
                                <input
                                    value={torrentUrl}
                                    onChange={(e) => {
                                        setTorrentUrl(e.target.value);
                                        if (e.target.value.trim()) setTorrentFiles([]);
                                    }}
                                    placeholder="magnet:?xt=... or https://example/torrent.torrent"
                                    className="w-full px-4 py-3 rounded-lg border border-border bg-background text-text outline-none focus:border-plex focus:ring-1 focus:ring-plex transition-all text-sm"
                                />
                            </div>
                            <button
                                type="button"
                                onClick={uploadTorrent}
                                disabled={uploadBusy || !uploadClientId || (!torrentFiles.length && !torrentUrl.trim())}
                                className="px-5 py-3 rounded-lg bg-plex text-background text-sm font-black hover:bg-plex-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                                {uploadBusy
                                    ? t('downloads.upload.sending')
                                    : torrentFiles.length > 1
                                        ? t('downloads.upload.addCount', { count: torrentFiles.length })
                                        : t('downloads.upload.add')}
                            </button>
                        </div>
                        <div
                            onDragEnter={(event) => {
                                event.preventDefault();
                                torrentDropDepthRef.current += 1;
                                setFileDropActive(true);
                            }}
                            onDragOver={(event) => {
                                event.preventDefault();
                                event.dataTransfer.dropEffect = 'copy';
                            }}
                            onDragLeave={(event) => {
                                event.preventDefault();
                                torrentDropDepthRef.current = Math.max(0, torrentDropDepthRef.current - 1);
                                if (torrentDropDepthRef.current === 0) setFileDropActive(false);
                            }}
                            onDrop={(event) => {
                                event.preventDefault();
                                torrentDropDepthRef.current = 0;
                                setFileDropActive(false);
                                addTorrentFiles(event.dataTransfer.files);
                            }}
                            className={`rounded-xl border border-dashed px-4 py-3 transition-colors ${
                                fileDropActive ? 'border-plex bg-plex/10' : 'border-white/15 bg-white/[0.03]'
                            }`}
                        >
                            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                                <label className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-border bg-white/[0.04] text-sm font-bold text-text hover:bg-white/10 cursor-pointer transition-colors shrink-0">
                                    <Upload className="w-4 h-4 text-plex" />
                                    {t('downloads.upload.torrentFile')}
                                    <input
                                        type="file"
                                        accept=".torrent,application/x-bittorrent"
                                        multiple
                                        className="hidden"
                                        onChange={(e) => {
                                            addTorrentFiles(e.target.files || []);
                                            e.target.value = '';
                                        }}
                                    />
                                </label>
                                <p className="text-sm text-muted">
                                    {fileDropActive
                                        ? t('downloads.upload.dropHint')
                                        : torrentFiles.length
                                            ? t('downloads.upload.selectedCount', { count: torrentFiles.length })
                                            : t('downloads.upload.torrentFileHint')}
                                </p>
                                {torrentFiles.length > 0 && (
                                    <button
                                        type="button"
                                        onClick={() => setTorrentFiles([])}
                                        className="sm:ml-auto text-xs font-bold text-muted hover:text-text"
                                    >
                                        {t('downloads.upload.clearFiles')}
                                    </button>
                                )}
                            </div>
                            {torrentFiles.length > 0 && (
                                <ul className="mt-3 space-y-1.5">
                                    {torrentFiles.map((file) => (
                                        <li
                                            key={torrentUploadFileKey(file)}
                                            className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm"
                                        >
                                            <FileText className="w-3.5 h-3.5 text-plex shrink-0" />
                                            <span className="min-w-0 truncate font-semibold">{file.name}</span>
                                            <span className="text-[11px] text-muted shrink-0">{formatBytes(file.size)}</span>
                                            <button
                                                type="button"
                                                title={t('downloads.upload.removeFile', { name: file.name })}
                                                onClick={() => setTorrentFiles((current) => current.filter((entry) => torrentUploadFileKey(entry) !== torrentUploadFileKey(file)))}
                                                className="ml-auto rounded-md p-1 text-muted hover:text-text hover:bg-white/10"
                                            >
                                                <X className="w-3.5 h-3.5" />
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    </div>
                </DashboardPanel>
            )}

            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                {(['all', 'sonarr', 'radarr', 'lidarr', 'unknown'] as const).map((key) => {
                    const meta = sourceFilterMeta[key];
                    const active = filter === key;
                    return (
                        <button
                            key={key}
                            type="button"
                            onClick={() => setFilter(key)}
                            className={`rounded-2xl text-left transition ${active ? 'ring-2 ring-plex/40 ring-offset-2 ring-offset-background' : 'opacity-90 hover:opacity-100'}`}
                        >
                            <DashboardStatCard
                                label={key === 'all' ? t('downloads.filters.all') : sourceLabel(key)}
                                value={key === 'all' ? sourceCounts.total : sourceCounts[key]}
                                icon={meta.icon}
                                glow={active ? meta.glow : dashboardGlowClass('muted')}
                            />
                        </button>
                    );
                })}
            </div>

            <div className="sticky top-0 z-20 -mx-1 px-1 py-2 bg-background/90 backdrop-blur-md border-b border-white/5 lg:static lg:border-0 lg:bg-transparent lg:backdrop-blur-none lg:py-0">
                <div className="flex flex-col sm:flex-row gap-3 sm:items-end rounded-2xl border border-white/10 bg-background/50 p-3 lg:p-4">
                    <div className="flex-1 min-w-0 sm:max-w-xs">
                        <label className="text-[10px] uppercase tracking-widest font-bold text-muted mb-1.5 block">{t('downloads.filters.client')}</label>
                        <CustomSelect
                            value={clientFilter}
                            onChange={setClientFilter}
                            options={clientSelectOptions}
                        />
                    </div>
                    <div className="sm:w-auto">
                        <p className="text-[10px] uppercase tracking-widest font-bold text-muted mb-1.5">{t('downloads.filters.show')}</p>
                        <div className="inline-flex rounded-xl border border-white/10 bg-black/20 p-1">
                            {([
                                { id: 'active', label: t('downloads.filters.activeOnly') },
                                { id: 'all', label: t('downloads.filters.all') },
                            ] as const).map((option) => {
                                const selected = statusFilter === option.id;
                                return (
                                    <button
                                        key={option.id}
                                        type="button"
                                        onClick={() => setStatusFilter(option.id)}
                                        className={`px-3 py-2 rounded-lg text-xs font-bold transition-colors ${selected ? 'bg-plex text-background' : 'text-muted hover:text-text'}`}
                                    >
                                        {option.label}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                    <p className="text-xs text-muted sm:ml-auto sm:pb-2">
                        {t('downloads.filters.shown', { count: downloads.length })}
                        {statusFilter === 'active' ? ` · ${t('downloads.filters.hidingCompleted')}` : ''}
                    </p>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <DashboardPanel
                    title={t('downloads.labels.clients')}
                    className="order-2 lg:order-2"
                    collapsible
                    collapsed={clientsCollapsed}
                    onCollapsedChange={setClientsCollapsed}
                    collapseLabel={t('downloads.actions.collapse')}
                    expandLabel={t('downloads.actions.expand')}
                >
                    <div className="space-y-3">
                        {(data?.clients || []).length === 0 ? (
                            <p className="text-sm text-muted">{t('downloads.empty.noClients')}</p>
                        ) : data.clients.map((client: any) => {
                            const activeClientFilter = clientFilter === String(client.client.id);
                            const clientItems = allDownloads.filter((item: any) => String(item.clientId) === String(client.client.id));
                            const visibleCount = statusFilter === 'active'
                                ? clientItems.filter(isActiveDownloadItem).length
                                : clientItems.length;
                            return (
                            <button
                                key={client.client.id}
                                type="button"
                                onClick={() => setClientFilter(activeClientFilter ? 'all' : String(client.client.id))}
                                className={`w-full rounded-xl border p-3 text-left transition-colors ${activeClientFilter ? 'border-plex bg-plex/10' : 'border-white/5 bg-background/40 hover:bg-white/[0.06]'}`}
                            >
                                <div className="flex items-center justify-between gap-3">
                                    <div className="flex items-center gap-3 min-w-0">
                                        <span className="inline-flex w-8 h-8 rounded-lg bg-white/5 border border-white/10 items-center justify-center overflow-hidden shrink-0">
                                            <img src={downloadClientIcon(client.client.type)} alt="" className="w-5 h-5 object-contain" />
                                        </span>
                                        <div className="min-w-0">
                                            <p className="font-bold text-text truncate">{client.client.name || downloadClientLabel(client.client.type)}</p>
                                            <p className="text-[11px] text-muted">{downloadClientLabel(client.client.type)} · {t('downloads.labels.downloadCount', { count: visibleCount })}</p>
                                        </div>
                                    </div>
                                    <span className={`w-2.5 h-2.5 rounded-full ${client.online ? 'bg-green-500' : 'bg-red-500'}`} />
                                </div>
                                {client.error && <p className="text-xs text-red-300 mt-2">{client.error}</p>}
                            </button>
                        );})}
                    </div>
                    {clientFilter !== 'all' && (
                        <button type="button" onClick={() => setClientFilter('all')} className="mt-3 text-xs font-bold text-plex hover:underline">
                            {t('downloads.actions.clearClientFilter')}
                        </button>
                    )}
                </DashboardPanel>
                <DashboardPanel
                    title={statusFilter === 'active' ? t('downloads.status.activeDownloads') : t('downloads.status.downloads')}
                    className="lg:col-span-2 order-1 lg:order-1"
                >
                    <div className="space-y-3">
                        {downloads.length === 0 ? (
                            <div className="text-center py-12 text-muted bg-background/30 rounded-xl border border-white/5">{t('downloads.empty.noFilterResults')}</div>
                        ) : downloads.map((item: any) => {
                            const paused = isPausedDownload(item);
                            const actionKey = `${item.clientId}-${item.id}`;
                            return (
                            <div key={`${item.clientId}-${item.id}`} className="rounded-xl border border-white/5 bg-background/40 p-4">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0 flex-1">
                                        <p className="font-bold text-text break-all leading-snug">{item.name}</p>
                                        <p className="text-xs text-muted mt-1 flex items-center gap-1.5 min-w-0">
                                            <img src={downloadClientIcon(item.clientType)} alt="" className="w-3.5 h-3.5 object-contain shrink-0 opacity-80" />
                                            <span className="min-w-0">
                                                {item.clientName} · {sourceLabel(item.source)}
                                                {item.arrInstanceName ? ` · ${item.arrInstanceName}` : ''}
                                                {' · '}
                                                {item.state || t('downloads.status.unknown')}
                                            </span>
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                        <span className="text-sm font-black text-plex">{Math.round(item.progress || 0)}%</span>
                                        {isAdmin && (
                                            <div className="flex items-center gap-1">
                                                <button
                                                    type="button"
                                                    onClick={() => controlDownload(item, paused ? 'resume' : 'pause')}
                                                    disabled={busyAction.startsWith(actionKey)}
                                                    title={paused ? t('downloads.actions.resume') : t('downloads.actions.pause')}
                                                    className="w-8 h-8 inline-flex items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-text hover:border-plex/40 hover:text-plex disabled:opacity-50 transition-colors"
                                                >
                                                    {paused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => controlDownload(item, 'remove')}
                                                    disabled={busyAction.startsWith(actionKey)}
                                                    title={t('downloads.actions.remove')}
                                                    className="w-8 h-8 inline-flex items-center justify-center rounded-lg border border-red-500/20 bg-red-500/10 text-red-200 hover:bg-red-500/20 disabled:opacity-50 transition-colors"
                                                >
                                                    <X className="w-4 h-4" />
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </div>
                                <div className="h-2 bg-white/5 rounded-full overflow-hidden mt-3">
                                    <div className="h-full bg-plex rounded-full" style={{ width: `${Math.max(0, Math.min(100, item.progress || 0))}%` }} />
                                </div>
                                <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted mt-2">
                                    <span>{formatBytes(item.downloaded)} / {formatBytes(item.size)}</span>
                                    <span>{t('downloads.labels.downSpeed', { value: `${formatBytes(item.downloadSpeed)}/s` })}</span>
                                    <span>{t('downloads.labels.upSpeed', { value: `${formatBytes(item.uploadSpeed)}/s` })}</span>
                                    {item.category && <span>{item.category}</span>}
                                    {item.sourceReason === 'arr_queue' && <span>{t('downloads.labels.matchedFromArrQueue')}</span>}
                                </div>
                            </div>
                        );})}
                    </div>
                </DashboardPanel>
            </div>
        </DashboardPageShell>
    );
};
