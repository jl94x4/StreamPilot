import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, Loader2, Music, X } from 'lucide-react';
import { apiFetch } from '../shared/api';
import { ModalPortal } from '../shared/ModalPortal';
import { NoPosterPlaceholder } from '../shared/NoPosterPlaceholder';
import { CustomSelect } from '../shared/ui';
import { formatNotifyMeHint, formatQuotaHint } from './requestSeasonUtils';
import { useDiscoverI18n } from './i18n';
import { formatRootFolderLabel } from '../../lib/portal-request/rootFolderLabel.js';

type AlbumTarget = {
    mbid: string;
    title: string;
    coverUrl?: string | null;
    year?: string | null;
};

type Props = {
    open: boolean;
    mbid: string;
    title?: string;
    posterUrl?: string | null;
    overview?: string | null;
    /** When set, the request is scoped to this album instead of the whole artist. */
    album?: AlbumTarget | null;
    onClose: () => void;
    onSuccess: (message: string, meta?: { notify?: boolean }) => void;
    onError: (message: string) => void;
    onNotifyChange?: (watching: boolean) => void;
};

type ServiceOptions = {
    server: { id: number; name: string; activeProfileId?: number; activeDirectory?: string };
    profiles: { id: number; name: string }[];
    rootFolders: { id: number; path: string; freeSpace?: number | null }[];
    tags: { id: number; label: string }[];
};

const formatBytes = (bytes?: number | null, freeLabel = 'free') => {
    const n = Number(bytes);
    if (!Number.isFinite(n) || n <= 0) return '';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(sizes.length - 1, Math.max(0, Math.floor(Math.log(n) / Math.log(k))));
    return `${parseFloat((n / Math.pow(k, i)).toFixed(1))} ${sizes[i]} ${freeLabel}`;
};

export const MusicRequestModal: React.FC<Props> = ({
    open,
    mbid,
    title: fallbackTitle,
    posterUrl: fallbackPosterUrl,
    overview: fallbackOverview,
    album = null,
    onClose,
    onSuccess,
    onError,
    onNotifyChange,
}) => {
    const { t } = useDiscoverI18n();
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [options, setOptions] = useState<any>(null);
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [serverId, setServerId] = useState<number | null>(null);
    const [profileId, setProfileId] = useState<number | null>(null);
    const [rootFolder, setRootFolder] = useState('');
    const [serviceOptions, setServiceOptions] = useState<ServiceOptions | null>(null);
    const [serviceLoading, setServiceLoading] = useState(false);
    const loadGenRef = useRef(0);

    const loadOptions = useCallback(async () => {
        const gen = ++loadGenRef.current;
        setLoading(true);
        try {
            const albumParam = album?.mbid ? `&albumMbid=${encodeURIComponent(album.mbid)}` : '';
            const data = await apiFetch(
                `/api/discovery/request-options?mediaType=music&mediaId=${encodeURIComponent(mbid)}${albumParam}`,
            );
            if (gen !== loadGenRef.current) return;
            if (data?.error) throw new Error(data.error);
            setOptions(data);
            const servers = Array.isArray(data?.servers) ? data.servers : [];
            const preferred = servers.find((s: any) => s.isDefault) || servers[0] || null;
            setServerId(preferred?.id ?? null);
            if (gen === loadGenRef.current) setLoading(false);
        } catch (e: any) {
            if (gen !== loadGenRef.current) return;
            onError(e?.message || t('request.loadFailed'));
            setOptions(null);
            setLoading(false);
        }
    }, [mbid, album?.mbid, onError, t]);

    useEffect(() => {
        if (!open) return;
        loadOptions();
    }, [open, loadOptions]);

    useEffect(() => {
        if (!open || !showAdvanced || !options?.canRequestAdvanced || serverId == null) return;
        let cancelled = false;
        setServiceLoading(true);
        void (async () => {
            try {
                const data = await apiFetch(`/api/discovery/request-services/music/${serverId}`);
                if (cancelled) return;
                setServiceOptions(data);
                const profiles = data?.profiles || [];
                const folders = data?.rootFolders || [];
                setProfileId(Number(data?.server?.activeProfileId ?? profiles[0]?.id) || null);
                setRootFolder(String(data?.server?.activeDirectory || folders[0]?.path || ''));
            } catch {
                if (!cancelled) setServiceOptions(null);
            } finally {
                if (!cancelled) setServiceLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [open, showAdvanced, options?.canRequestAdvanced, serverId]);

    const submit = async () => {
        if (!options?.canRequest) return;
        setSubmitting(true);
        try {
            const body: Record<string, unknown> = {
                mediaType: 'music',
                mediaId: mbid,
            };
            if (album?.mbid) {
                body.albumMbid = album.mbid;
                body.albumTitle = album.title;
            }
            if (showAdvanced && options.canRequestAdvanced) {
                if (serverId != null) body.serverId = serverId;
                if (profileId != null) body.profileId = profileId;
                if (rootFolder) body.rootFolder = rootFolder;
            }
            await apiFetch('/api/discovery/request', {
                method: 'POST',
                body: JSON.stringify(body),
            });
            onSuccess(t('request.submittedFor', { title: options?.title || fallbackTitle || t('music.artist').toLowerCase() }));
            onClose();
        } catch (e: any) {
            onError(e?.message || t('request.submitFailed'));
        } finally {
            setSubmitting(false);
        }
    };

    const handleNotifyToggle = async () => {
        if (!options?.canNotify && !options?.isWatching) return;
        setSubmitting(true);
        try {
            const res = await apiFetch('/api/discovery/request/notify', {
                method: 'POST',
                body: JSON.stringify({
                    mediaType: 'music',
                    mediaId: mbid,
                    albumMbid: album?.mbid || null,
                    subscribe: !options.isWatching,
                }),
            });
            if (res?.error) throw new Error(res.error);
            const watching = !!res?.isWatching;
            setOptions((prev: any) => (prev ? { ...prev, isWatching: watching, canNotify: true } : prev));
            onNotifyChange?.(watching);
            onSuccess(watching ? t('request.notifySaved') : t('request.notifyRemoved'), { notify: true });
            if (watching) onClose();
        } catch (e: any) {
            onError(e?.message || t('request.notifyFailed'));
        } finally {
            setSubmitting(false);
        }
    };

    if (!open) return null;

    const title = options?.title
        || (album ? `${fallbackTitle || t('music.artist')} — ${album.title}` : fallbackTitle)
        || t('music.artist');
    const overview = options?.overview || fallbackOverview || '';
    const posterUrl = album?.coverUrl || options?.posterUrl || options?.posterPath || fallbackPosterUrl || null;
    const quotaHint = options?.quota ? formatQuotaHint(options.quota, t('mediaType.music'), t) : '';
    const musicServers = options?.servers || [];
    const showMusicAdvanced = !!options?.canRequestAdvanced && !options?.canNotify && !options?.isWatching;
    const musicHasAdvancedChoices = musicServers.length > 1
        || !serviceOptions
        || (serviceOptions.profiles || []).length !== 1
        || (serviceOptions.rootFolders || []).length !== 1;
    const showMusicAdvancedPanel = showAdvanced && showMusicAdvanced && (
        musicServers.length > 1
        || serviceLoading
        || !serviceOptions
        || (serviceOptions.profiles || []).length !== 1
        || (serviceOptions.rootFolders || []).length !== 1
    );

    return (
        <ModalPortal open={open}>
            <div className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center p-0 sm:p-4">
                <button type="button" className="absolute inset-0 bg-black/70" onClick={onClose} aria-label={t('common.close')} />
                <div data-modal-scroll="" className="relative w-full sm:max-w-lg max-h-[min(92dvh,calc(100dvh-4.5rem))] overflow-y-auto overscroll-contain touch-pan-y rounded-t-2xl sm:rounded-2xl border border-border bg-background shadow-2xl">
                    <div className="sticky top-0 z-10 flex items-center justify-between gap-3 px-4 py-3 border-b border-border bg-background/95 backdrop-blur">
                        <div className="flex items-center gap-2 min-w-0">
                            <Music className="w-4 h-4 text-plex shrink-0" />
                            <h2 className="font-black text-sm truncate">{album ? t('request.requestAlbum') : t('request.requestArtist')}</h2>
                        </div>
                        <button type="button" onClick={onClose} className="p-2 rounded-lg hover:bg-white/10 text-muted">
                            <X className="w-4 h-4" />
                        </button>
                    </div>

                    <div className="p-4 flex flex-col gap-4">
                        <div className="flex gap-3">
                            <div className="w-20 h-20 rounded-xl overflow-hidden bg-white/5 shrink-0">
                                {posterUrl ? (
                                    <img src={posterUrl} alt="" className="w-full h-full object-cover" />
                                ) : (
                                    <NoPosterPlaceholder className="w-full h-full" label={t('music.noArt')} />
                                )}
                            </div>
                            <div className="min-w-0">
                                <h3 className="font-black text-lg leading-tight">{title}</h3>
                                {overview && <p className="text-sm text-muted mt-1 line-clamp-3">{overview}</p>}
                            </div>
                        </div>

                        {loading ? (
                            <div className="py-8 flex justify-center text-muted">
                                <Loader2 className="w-6 h-6 animate-spin" />
                            </div>
                        ) : !options ? (
                            <p className="text-sm text-red-400">{t('request.unableToLoad')}</p>
                        ) : (
                            <>
                                {options.blockReason && (
                                    <p className="text-sm text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                                        {options.blockReason}
                                        {options.canNotify ? (
                                            <span className="block mt-1 text-amber-100/80">
                                                {formatNotifyMeHint(t, options.requestedByName, options.requestedByCount)}
                                            </span>
                                        ) : null}
                                    </p>
                                )}
                                {(options.canNotify || options.isWatching) && !options.blockReason && (
                                    <p className="text-sm text-sky-100 bg-sky-500/10 border border-sky-500/20 rounded-lg px-3 py-2">
                                        {formatNotifyMeHint(t, options.requestedByName, options.requestedByCount)}
                                    </p>
                                )}
                                {quotaHint && (
                                    <p className="text-xs text-muted">{quotaHint}</p>
                                )}
                                {showMusicAdvanced && musicHasAdvancedChoices && (
                                    <button
                                        type="button"
                                        onClick={() => setShowAdvanced((v) => !v)}
                                        className="text-xs font-bold text-plex hover:underline self-start"
                                    >
                                        {showAdvanced ? t('request.hideAdvanced') : t('request.advancedOptions')}
                                    </button>
                                )}
                                {showMusicAdvancedPanel && (
                                    <div className="flex flex-col gap-3 rounded-xl border border-border/60 bg-white/[0.02] p-3">
                                        {serviceLoading ? (
                                            <div className="py-4 flex justify-center text-muted">
                                                <Loader2 className="w-5 h-5 animate-spin" />
                                            </div>
                                        ) : serviceOptions ? (
                                            <>
                                                {musicServers.length > 1 && (
                                                <CustomSelect
                                                    label={t('music.lidarrServer')}
                                                    value={serverId != null ? String(serverId) : ''}
                                                    onChange={(v) => setServerId(Number(v) || null)}
                                                    options={musicServers.map((s: any) => ({
                                                        value: String(s.id),
                                                        label: s.name,
                                                    }))}
                                                />
                                                )}
                                                {(serviceOptions.profiles || []).length !== 1 && (
                                                <CustomSelect
                                                    label={t('request.qualityProfile')}
                                                    value={profileId != null ? String(profileId) : ''}
                                                    onChange={(v) => setProfileId(Number(v) || null)}
                                                    options={(serviceOptions.profiles || []).map((p) => ({
                                                        value: String(p.id),
                                                        label: p.name,
                                                    }))}
                                                />
                                                )}
                                                {(serviceOptions.rootFolders || []).length !== 1 && (
                                                <CustomSelect
                                                    label={t('request.rootFolder')}
                                                    value={rootFolder}
                                                    onChange={setRootFolder}
                                                    options={(serviceOptions.rootFolders || []).map((f) => ({
                                                        value: f.path,
                                                        label: formatRootFolderLabel(f, {
                                                            folders: serviceOptions.rootFolders,
                                                            freeText: formatBytes(f.freeSpace, t('storage.free')),
                                                        }),
                                                    }))}
                                                />
                                                )}
                                            </>
                                        ) : (
                                            <p className="text-xs text-muted">{t('music.lidarrOptionsFailed')}</p>
                                        )}
                                    </div>
                                )}
                                {(options.canNotify || options.isWatching) ? (
                                    <button
                                        type="button"
                                        disabled={submitting}
                                        onClick={handleNotifyToggle}
                                        className="w-full py-3 rounded-xl bg-plex text-black font-black hover:bg-plex-hover disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
                                    >
                                        {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bell className="w-4 h-4" />}
                                        {options.isWatching ? t('request.stopNotify') : t('request.notifyMe')}
                                    </button>
                                ) : (
                                    <button
                                        type="button"
                                        disabled={!options.canRequest || submitting}
                                        onClick={submit}
                                        className="w-full py-3 rounded-xl bg-plex text-black font-black hover:bg-plex-hover disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
                                    >
                                        {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                                        {submitting ? t('request.submitting') : t('request.submit')}
                                    </button>
                                )}
                            </>
                        )}
                    </div>
                </div>
            </div>
        </ModalPortal>
    );
};
