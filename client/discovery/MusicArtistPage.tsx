import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Bell, Check, Clock, Disc3, Loader2, Music } from 'lucide-react';
import { apiFetch } from '../shared/api';
import { resolvePortalAssetUrl } from '../shared/basePath';
import { MusicRequestModal } from './MusicRequestModal';
import { discoveryTheme } from './discoveryThemeClasses';
import { translateDiscoverAvailabilityDetail, translateDiscoverStatus, useDiscoverI18n } from './i18n';
import { resolveMediaAvailabilityState } from './discoverAvailability';
import { mediaStatusPanelClass, mediaStatusChipClass } from './DiscoverStatusOverlay';
import { formatRequestedByCopy } from './requestSeasonUtils';
import { OpenInArrButton } from '../shared/OpenInArrButton';

type ArtistAlbum = {
    mbid: string;
    title: string;
    type?: string;
    year?: string | null;
    coverUrl?: string | null;
    inLidarr?: boolean;
    monitored?: boolean;
    available?: boolean;
    partial?: boolean;
};

const AlbumCover: React.FC<{ src?: string | null; alt: string }> = ({ src, alt }) => {
    const [failed, setFailed] = useState(false);
    useEffect(() => { setFailed(false); }, [src]);
    if (!src || failed) {
        return (
            <div className="w-full h-full flex items-center justify-center text-muted bg-white/5">
                <Disc3 className="w-10 h-10 opacity-30" />
            </div>
        );
    }
    return (
        <img
            src={src}
            alt={alt}
            loading="lazy"
            className="w-full h-full object-cover"
            onError={() => setFailed(true)}
        />
    );
};

/** Artist header art — walks a list of candidate URLs, falling back on load errors. */
const ArtistHeaderArt: React.FC<{ sources: (string | null | undefined)[]; alt: string }> = ({ sources, alt }) => {
    const urls = sources
        .map((src) => (src ? resolvePortalAssetUrl(src) : ''))
        .filter(Boolean);
    const [index, setIndex] = useState(0);
    useEffect(() => { setIndex(0); }, [urls.join('|')]);
    const src = urls[index] || null;
    if (!src) {
        return (
            <div className="w-full h-full flex items-center justify-center text-muted">
                <Music className="w-12 h-12 opacity-40" />
            </div>
        );
    }
    return (
        <img
            src={src}
            alt={alt}
            className="w-full h-full object-cover"
            onError={() => setIndex((i) => i + 1)}
        />
    );
};

export const MusicArtistPage: React.FC<{
    mbid: string;
    onBack: () => void;
    pushToast?: (msg: string, type: 'success' | 'error') => void;
    isAdmin?: boolean;
}> = ({ mbid, onBack, pushToast, isAdmin = false }) => {
    const { t } = useDiscoverI18n();
    const [loading, setLoading] = useState(true);
    const [artist, setArtist] = useState<any>(null);
    const [error, setError] = useState<string | null>(null);
    const [requestOpen, setRequestOpen] = useState(false);
    const [albumTarget, setAlbumTarget] = useState<ArtistAlbum | null>(null);
    const [requestedAlbumMbids, setRequestedAlbumMbids] = useState<Set<string>>(new Set());
    const [artistRequested, setArtistRequested] = useState(false);
    const [artistNotify, setArtistNotify] = useState<{
        canNotify?: boolean;
        isWatching?: boolean;
        requestedByName?: string | null;
        requestedByCount?: number;
    } | null>(null);

    const loadArtist = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const [data, myRequests] = await Promise.all([
                apiFetch(`/api/discovery/music/artist/${encodeURIComponent(mbid)}`),
                apiFetch('/api/discovery/my-requests?filter=all&take=50').catch(() => null),
            ]);
            setArtist(data);
            const rows = Array.isArray(myRequests?.results) ? myRequests.results : [];
            const forArtist = rows.filter((row: any) => (
                (row?.type === 'music' || row?.mediaType === 'music')
                && String(row?.mbid || '') === mbid
                && Number(row?.status) !== 3 // declined
            ));
            setRequestedAlbumMbids(new Set(
                forArtist.map((row: any) => String(row?.albumMbid || '')).filter(Boolean),
            ));
            setArtistRequested(forArtist.some((row: any) => !row?.albumMbid));
            const opts = await apiFetch(
                `/api/discovery/request-options?mediaType=music&mediaId=${encodeURIComponent(mbid)}`,
            ).catch(() => null);
            setArtistNotify({
                canNotify: !!opts?.canNotify,
                isWatching: !!opts?.isWatching,
                requestedByName: opts?.requestedByName || null,
                requestedByCount: Number(opts?.requestedByCount) || 0,
            });
        } catch (e: any) {
            setArtist(null);
            setError(e?.message || t('music.loadFailed'));
        } finally {
            setLoading(false);
        }
    }, [mbid, t]);

    useEffect(() => {
        loadArtist();
    }, [loadArtist]);

    const toast = pushToast || (() => {});

    const albums: ArtistAlbum[] = useMemo(
        () => (Array.isArray(artist?.albums) ? artist.albums : []),
        [artist],
    );

    if (loading) {
        return (
            <div className="py-16 flex justify-center text-muted">
                <Loader2 className="w-7 h-7 animate-spin" />
            </div>
        );
    }

    if (error || !artist) {
        return (
            <div className="px-4 py-8 flex flex-col gap-4">
                <button type="button" onClick={onBack} className="inline-flex items-center gap-2 text-sm font-bold text-muted hover:text-text">
                    <ArrowLeft className="w-4 h-4" /> {t('music.back')}
                </button>
                <p className="text-red-400">{error || t('music.notFound')}</p>
            </div>
        );
    }

    const posterUrl = artist.posterUrl || artist.posterPath || null;
    const availability = resolveMediaAvailabilityState(artist);
    const canRequest = availability.kind !== 'available'
        && availability.kind !== 'processing'
        && availability.kind !== 'requested'
        && availability.kind !== 'pending'
        && !artistRequested;
    const canNotifyArtist = !!(artistNotify?.canNotify || artistNotify?.isWatching) && !canRequest && !artistRequested;

    const requestButtonLabel = (() => {
        if (artistNotify?.isWatching) return t('request.watching');
        if (canNotifyArtist) return t('request.notifyMe');
        if (artistRequested) return t('music.requested');
        if (availability.kind === 'available') return t('music.inLibrary');
        if (availability.kind === 'processing') return t('music.processing');
        if (availability.kind === 'requested') return t('music.requested');
        if (availability.kind === 'pending') return t('music.pendingApproval');
        if (availability.kind === 'partial') return t('music.requestMissing');
        return t('music.requestArtist');
    })();

    const albumBadge = (album: ArtistAlbum) => {
        if (album.available) {
            return (
                <span className={`inline-flex items-center gap-1 ${mediaStatusChipClass} bg-emerald-500/90 text-black border-transparent`}>
                    <Check className="w-2.5 h-2.5 sm:w-3 sm:h-3" /> {t('music.albumAvailable')}
                </span>
            );
        }
        if (album.partial) {
            return (
                <span className={`${mediaStatusChipClass} bg-plex/90 text-black border-transparent`}>
                    {t('music.albumPartial')}
                </span>
            );
        }
        if (requestedAlbumMbids.has(album.mbid) || artistRequested) {
            return (
                <span className={`inline-flex items-center gap-1 ${mediaStatusChipClass} bg-sky-500/90 text-black border-transparent`}>
                    <Clock className="w-2.5 h-2.5 sm:w-3 sm:h-3" /> {t('music.albumRequested')}
                </span>
            );
        }
        if (album.monitored) {
            return (
                <span className={`${mediaStatusChipClass} bg-white/20 text-text border-transparent`}>
                    {t('music.albumMonitored')}
                </span>
            );
        }
        return null;
    };

    const canRequestAlbum = (album: ArtistAlbum) => !album.available
        && !album.monitored
        && !requestedAlbumMbids.has(album.mbid)
        && !artistRequested;

    const openAlbumRequest = (album: ArtistAlbum) => {
        setAlbumTarget(album);
        setRequestOpen(true);
    };

    return (
        <div className="px-2 sm:px-4 pb-10 flex flex-col gap-5">
            <button type="button" onClick={onBack} className="inline-flex items-center gap-2 text-sm font-bold text-muted hover:text-text self-start">
                <ArrowLeft className="w-4 h-4" /> {t('music.back')}
            </button>

            <div className="rounded-2xl border border-border/60 bg-white/[0.02] overflow-hidden">
                <div className="flex flex-col sm:flex-row gap-4 p-4 sm:p-6">
                    <div className="w-36 h-36 sm:w-44 sm:h-44 rounded-2xl overflow-hidden bg-white/5 shrink-0 mx-auto sm:mx-0">
                        <ArtistHeaderArt
                            sources={[posterUrl, ...albums.slice(0, 3).map((album) => album.coverUrl)]}
                            alt={artist.name || artist.title || ''}
                        />
                    </div>
                    <div className="min-w-0 flex-1 text-center sm:text-left">
                        <p className={discoveryTheme.personalEyebrow}>{t('music.artist')}</p>
                        <h1 className="text-2xl sm:text-3xl font-black text-text mt-1">{artist.name || artist.title}</h1>
                        {artist.disambiguation && (
                            <p className="text-sm text-muted mt-1">{artist.disambiguation}</p>
                        )}
                        {artist.overview && (
                            <p className="text-sm text-muted mt-3 leading-relaxed">{artist.overview}</p>
                        )}
                        {Array.isArray(artist.tags) && artist.tags.length > 0 && (
                            <div className="flex flex-wrap gap-2 mt-4 justify-center sm:justify-start">
                                {artist.tags.map((tag: string) => (
                                    <span key={tag} className="px-2 py-1 rounded-full bg-white/5 border border-border/60 text-[11px] font-bold text-muted">
                                        {tag}
                                    </span>
                                ))}
                            </div>
                        )}
                        {availability.kind !== 'none' && (
                            <div className="mt-4 flex justify-center sm:justify-start">
                                <span
                                    className={`inline-flex items-center gap-1 ${mediaStatusChipClass} ${mediaStatusPanelClass(availability.kind)}`}
                                    title={availability.detail ? translateDiscoverAvailabilityDetail(t, availability.detail) : translateDiscoverStatus(t, availability.label)}
                                >
                                    {translateDiscoverStatus(t, availability.label) || availability.label}
                                </span>
                            </div>
                        )}
                        <button
                            type="button"
                            onClick={() => { setAlbumTarget(null); setRequestOpen(true); }}
                            disabled={!canRequest && !canNotifyArtist}
                            className="mt-5 px-5 py-2.5 rounded-xl bg-plex text-black font-black hover:bg-plex-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
                        >
                            {canNotifyArtist ? <Bell className="w-4 h-4" /> : null}
                            {requestButtonLabel}
                        </button>
                        {isAdmin
                            && ['available', 'partial', 'processing', 'requested', 'pending'].includes(availability.kind)
                            ? (
                                <OpenInArrButton
                                    mediaType="music"
                                    mbid={mbid}
                                    title={artist.name || artist.title}
                                    className="mt-3 w-full sm:w-auto px-5 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-sm font-bold transition-colors inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
                                    onError={(message) => toast(message, 'error')}
                                />
                            )
                            : null}
                        {canNotifyArtist ? (
                            <p className="mt-2 text-xs text-muted">
                                {formatRequestedByCopy(t, artistNotify?.requestedByName, artistNotify?.requestedByCount)}
                            </p>
                        ) : null}
                        {artistNotify?.isWatching ? (
                            <p className="mt-1 text-[11px] text-muted/80">{t('request.watchingHint')}</p>
                        ) : null}
                    </div>
                </div>
            </div>

            <section className="flex flex-col gap-3">
                <div className="px-1">
                    <h2 className={discoveryTheme.sectionTitle}>{t('music.albums')}</h2>
                    <p className="text-xs text-muted mt-1">{t('music.albumsHint')}</p>
                </div>
                {albums.length === 0 ? (
                    <div className={`${discoveryTheme.emptyState} mx-1`}>
                        <p className={discoveryTheme.emptyBody}>{t('music.noAlbums')}</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 px-1">
                        {albums.map((album) => (
                            <div
                                key={album.mbid}
                                className="rounded-xl border border-border/60 bg-white/[0.02] overflow-hidden flex flex-col group"
                            >
                                <div className="relative aspect-square overflow-hidden">
                                    <AlbumCover src={album.coverUrl} alt={album.title} />
                                    <div className="absolute top-1.5 left-1.5">
                                        {albumBadge(album)}
                                    </div>
                                </div>
                                <div className="p-2.5 flex flex-col gap-1 flex-1">
                                    <p className="text-sm font-bold text-text leading-tight line-clamp-2" title={album.title}>
                                        {album.title}
                                    </p>
                                    <p className="text-[11px] text-muted">
                                        {[album.year, album.type].filter(Boolean).join(' · ')}
                                    </p>
                                    {canRequestAlbum(album) && (
                                        <button
                                            type="button"
                                            onClick={() => openAlbumRequest(album)}
                                            className="mt-auto pt-1.5 w-full py-1.5 rounded-lg bg-plex text-black text-xs font-black hover:bg-plex-hover transition-colors"
                                        >
                                            {t('music.requestAlbum')}
                                        </button>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </section>

            <MusicRequestModal
                open={requestOpen}
                mbid={mbid}
                title={artist.name || artist.title}
                posterUrl={posterUrl}
                overview={artist.overview}
                album={albumTarget ? {
                    mbid: albumTarget.mbid,
                    title: albumTarget.title,
                    coverUrl: albumTarget.coverUrl || null,
                    year: albumTarget.year || null,
                } : null}
                onClose={() => { setRequestOpen(false); setAlbumTarget(null); }}
                onSuccess={(msg, meta) => {
                    toast(msg, 'success');
                    if (meta?.notify) return;
                    if (albumTarget?.mbid) {
                        setRequestedAlbumMbids((prev) => new Set([...prev, albumTarget.mbid]));
                    } else {
                        setArtistRequested(true);
                    }
                    setAlbumTarget(null);
                }}
                onError={(msg) => toast(msg, 'error')}
                onNotifyChange={(watching) => {
                    if (!albumTarget) {
                        setArtistNotify((prev) => ({
                            ...prev,
                            canNotify: true,
                            isWatching: watching,
                        }));
                    }
                }}
            />
        </div>
    );
};
