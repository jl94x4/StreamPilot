import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Bookmark, BookmarkCheck, Calendar, Check, ChevronDown, Clock, Eye, EyeOff, Film, Info, ListPlus, Loader2, Play, Shuffle, SkipForward, Star, Users } from 'lucide-react';
import {
    Carousel,
    DiscoverHomeRowSkeleton,
    DiscoveryFactWidget,
    MediaRatingPills,
    NoPosterPlaceholder,
    homeRailPosterDensity,
    useDiscoverGridSize,
    useDiscoverI18n,
    type CombinedRatings,
} from './host';
import { addMediaPlayerPlaylistItem, createMediaPlayerPlaylist, fetchMediaPlayerItem, fetchMediaPlayerItemMore, fetchMediaPlayerNeighbors, fetchMediaPlayerPlaylists, fetchMediaPlayerWatchlist, setMediaPlayerWatched, setMediaPlayerWatchlisted, setSeasonEpisodesWatched } from './api';
import { MediaPlayerThemeTune } from './MediaPlayerThemeTune';
import {
    OVERVIEW_FACT_WIDTH_CLASS,
    OVERVIEW_SPOTLIGHT_CARD_SHELL_CLASS,
    OverviewFacts,
    OverviewFactsSpotlight,
    OverviewGenres,
    OverviewLinks,
    OverviewSummary,
} from './MediaPlayerOverview';
import { PlayerBackdropImage } from './PlayerBackdropImage';
import { PlayerClearLogo } from './PlayerClearLogo';
import { PlayerFileInfo } from './PlayerFileInfo';
import { PlayerItemMenu, type PlayerItemMenuHandle } from './PlayerItemMenu';
import { PlayerSeasonWatchDialog } from './PlayerSeasonWatchDialog';
import { PlayerRail } from './PlayerRail';
import { MediaPlayerMusicTracks } from './MediaPlayerMusicTracks';
import { PlayerTvStatusPanel } from './PlayerTvStatusPanel';
import { watchedTickPositionClass } from './playerSettings';
import { usePlayerSettings } from './usePlayerSettings';
import {
    formatBitrateMbps,
    formatEpisodeCode,
    fileInfoPills,
    formatMediaAudioLine,
    formatMediaVideoLine,
    formatPlayerDate,
    formatPlayerDuration,
    formatPlayerResolution,
    remainingWatchMs,
    type FileInfoPill,
    isPlayerTrailer,
    isMusicPlayerItem,
    plexImageUrl,
    resizePlexArtUrl,
    plexBackdropPreviewUrl,
    plexBackdropUrl,
    plexLogoUrl,
    applyRememberedProgress,
    PLAYER_PROGRESS_EVENT,
    progressPercent,
    shouldOfferResume,
    watchTargetTouches,
    titleCaseProfile,
    withWatchedProgress,
} from './playerUtils';
import { focusSeasonEpisodeWhenReady, hasRememberedTvFocus, pinTvDetailsTop } from '../plex-client/useTvRemote';
import { readDocumentZoom } from '../shared/ui';
import { PLAYER_SCROLL_ID } from './paths';
import {
    DEFAULT_BACKDROP_SURFACE_RGB,
    formatTvDetailsBackdropPosition,
    formatWebDetailsBackdropPosition,
    resolveImageFocalPoint,
    sampleBackdropSurfaceColor,
    samplePosterSurfaceColor,
} from '../shared/imageFocalPoint';
import { writePlayerScrollTop, readPlayerItemCache, takePlayerItemSeed, writePlayerItemCache, readAvChoice, resolveAvChoiceForTracks, writeAvChoiceFromTracks } from './playerMemory';
import type { PlayerItem, PlayerLibraryHub, PlayerMediaPartInfo, PlayerPlayOptions, PlayerRatings, PlayerVersion } from './types';

const softenSurfaceRgb = (rgb: string) => {
    const parts = rgb.trim().split(/\s+/).map((part) => Number(part));
    if (parts.length < 3 || parts.some((value) => !Number.isFinite(value))) return rgb;
    let [r, g, b] = parts;
    // Keep the poster hue, but drop most of the saturation and cap brightness
    // so a red or yellow still does not flood the whole page.
    const avg = (r + g + b) / 3;
    const sat = 0.48;
    r = avg + (r - avg) * sat;
    g = avg + (g - avg) * sat;
    b = avg + (b - avg) * sat;
    const luma = (0.2126 * r) + (0.7152 * g) + (0.0722 * b);
    const cap = 86;
    if (luma > cap) {
        const scale = cap / luma;
        r *= scale;
        g *= scale;
        b *= scale;
    }
    const channel = (value: number) => Math.round(Math.min(255, Math.max(0, value)));
    return `${channel(r)} ${channel(g)} ${channel(b)}`;
};

const isPhoneDetailsUi = () => {
    try {
        return document.documentElement?.dataset?.phone === '1';
    } catch {
        return false;
    }
};

const TV_FLOOR_RGB = '6 10 16';

const episodeHasMediaInfo = (ep?: PlayerItem | null) => Boolean(
    ep?.mediaInfo?.[0]?.parts?.[0]?.video
    || ep?.mediaInfo?.[0]?.videoCodec,
);

const episodeTechPills = (ep?: PlayerItem | null): Array<FileInfoPill | { key: string; label: string; tone: FileInfoPill['tone'] }> => {
    if (!ep) return [];
    const pills: Array<FileInfoPill | { key: string; label: string; tone: FileInfoPill['tone'] }> = [...fileInfoPills(ep)];
    const sub = (ep.mediaInfo?.[0]?.parts?.[0]?.subtitles || []).find((row) => row.selected)
        || (ep.mediaInfo?.[0]?.parts?.[0]?.subtitles || [])[0];
    const subLabel = String(sub?.codec || '').replace(/_/g, '-').toUpperCase();
    if (subLabel && !pills.some((pill) => pill.label === subLabel)) {
        pills.push({ key: 'sub', label: subLabel, tone: 'other' });
    } else if (!subLabel) {
        pills.push({ key: 'sub', label: 'Off', tone: 'other' });
    }
    return pills.filter((pill) => pill.label);
};

const isNewEpisodeBadge = (row: PlayerItem) => {
    if (row.watched) return false;
    const now = Date.now();
    const windowMs = 6 * 24 * 60 * 60 * 1000;
    const stamps: number[] = [];
    const added = Number(row.addedAt || 0);
    if (added) stamps.push(added > 1e12 ? added : added * 1000);
    if (row.originallyAvailableAt) {
        const aired = new Date(row.originallyAvailableAt).getTime();
        if (Number.isFinite(aired)) stamps.push(aired);
    }
    if (!stamps.length) return false;
    const newest = Math.max(...stamps);
    return newest <= now + 24 * 60 * 60 * 1000 && now - newest < windowMs;
};

const applyTvDetailsSurface = (rgb: string) => {
    const tv = typeof document !== 'undefined' && (
        document.documentElement?.dataset?.tv === '1'
        || window.__PLEX_CLIENT__?.isTv === true
    );
    // TV cinematic pages fade to #060a10; keep the floor the same so nothing hard-cuts.
    const softened = isPhoneDetailsUi() ? rgb : (tv ? TV_FLOOR_RGB : softenSurfaceRgb(rgb));
    const paint = `rgb(${softened})`;
    const root = document.querySelector<HTMLElement>('[data-tv-details="1"]');
    root?.style.setProperty('--tv-details-surface', softened);
    if (root) root.style.backgroundColor = paint;
    root?.querySelector<HTMLElement>('.media-details-hero-backdrop')
        ?.style.setProperty('--tv-details-surface', softened);
    const scroll = document.getElementById(PLAYER_SCROLL_ID);
    scroll?.style.setProperty('--tv-details-surface', softened);
    if (scroll) scroll.style.backgroundColor = paint;
};

const clearTvDetailsSurface = () => {
    const root = document.querySelector<HTMLElement>('[data-tv-details="1"]');
    root?.style.removeProperty('--tv-details-surface');
    if (root) root.style.backgroundColor = '';
    root?.querySelector<HTMLElement>('.media-details-hero-backdrop')
        ?.style.removeProperty('--tv-details-surface');
    const scroll = document.getElementById(PLAYER_SCROLL_ID);
    scroll?.style.removeProperty('--tv-details-surface');
    if (scroll) scroll.style.backgroundColor = '';
};

type Props = {
    ratingKey: string;
    serverId?: string | null;
    onBack: () => void;
    onOpenItem: (item: PlayerItem) => void;
    onOpenPerson: (person: { id: string; name: string; thumb?: string | null }) => void;
    onOpenStudio: (studio: { key: string; name: string; sectionKey?: string; mediaType?: 'movie' | 'show' }) => void;
    onPlay: (item: PlayerItem, opts?: PlayerPlayOptions) => void;
    onPlayNext?: (item: PlayerItem) => void;
    onToast?: (message: string, type?: 'success' | 'error' | 'info') => void;
    isAdmin?: boolean;
    playlistsEnabled?: boolean;
    playing?: boolean;
    playbackActive?: boolean;
};

const SectionHeading: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <div className="flex items-center gap-3 mb-4 pr-16">
        <h3 className="text-xs font-black text-muted uppercase tracking-[0.2em]">{children}</h3>
        <div className="h-px flex-1 bg-gradient-to-r from-border to-transparent" />
    </div>
);

const CastAvatar: React.FC<{ name: string; thumb?: string | null }> = ({ name, thumb }) => {
    const [failed, setFailed] = useState(false);
    useEffect(() => {
        setFailed(false);
    }, [thumb]);
    const src = thumb && !failed ? plexImageUrl(thumb, 240, 240, { quality: 60 }) : '';
    return (
        <div
            data-tv-cast-avatar="1"
            className="relative w-36 h-36 rounded-full bg-white/5 border-2 border-border overflow-hidden transition-transform group-hover:scale-[1.03] group-hover:border-plex"
        >
            {src ? (
                <img
                    src={src}
                    alt=""
                    className="w-full h-full object-cover"
                    onError={() => setFailed(true)}
                />
            ) : (
                <div className="w-full h-full flex items-center justify-center text-muted bg-white/5" aria-hidden>
                    <Users className="w-12 h-12" />
                    <span className="sr-only">{name}</span>
                </div>
            )}
        </div>
    );
};

const PhoneEpisodeList: React.FC<{
    rows: PlayerItem[];
    heading: string;
    locale: string;
    onOpenItem: (item: PlayerItem) => void;
}> = ({ rows, heading, locale, onOpenItem }) => (
    <section className="media-details-episodes media-details-episode-list mt-2">
        <h3 className="mb-3 text-[1.05rem] font-black tracking-tight text-text">{heading}</h3>
        <div className="flex flex-col gap-3.5">
            {rows.map((raw) => {
                const row = applyRememberedProgress(raw);
                const aired = formatPlayerDate(row.originallyAvailableAt, locale);
                const code = row.index != null ? `E${row.index}` : '';
                return (
                    <button
                        key={row.ratingKey}
                        type="button"
                        onClick={() => onOpenItem(row)}
                        className="flex w-full items-start gap-3 text-left"
                    >
                        <div className="relative w-[7.4rem] shrink-0 overflow-hidden rounded-lg bg-black/40">
                            {row.thumb ? (
                                <img
                                    src={plexImageUrl(row.thumb, 320, 180, { quality: 60 })}
                                    alt=""
                                    className="aspect-video w-full object-cover"
                                />
                            ) : (
                                <div className="aspect-video w-full bg-white/5" />
                            )}
                            {code ? (
                                <span className="absolute right-1 top-1 rounded bg-black/70 px-1 py-px text-[10px] font-black text-white">
                                    {code}
                                </span>
                            ) : null}
                            {progressPercent(row) > 0 ? (
                                <div className="absolute inset-x-0 bottom-0 h-0.5 bg-black/50">
                                    <div className="h-full bg-plex" style={{ width: `${progressPercent(row)}%` }} />
                                </div>
                            ) : null}
                        </div>
                        <div className="min-w-0 flex-1 pt-0.5">
                            <p className="truncate text-[0.95rem] font-bold text-text">{row.title}</p>
                            {aired ? <p className="text-[12px] text-white/55">{aired}</p> : null}
                            {row.summary ? (
                                <p className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-white/55">{row.summary}</p>
                            ) : null}
                        </div>
                    </button>
                );
            })}
        </div>
    </section>
);

const hasDetailsHero = (row?: PlayerItem | null) => Boolean(
    String(row?.thumb || '').trim() || String(row?.art || '').trim(),
);

const DetailsHeroSkeleton: React.FC<{ label: string }> = ({ label }) => (
    <div className="animate-fade-in" aria-busy="true" aria-live="polite">
        <span className="sr-only">{label}</span>
        <div className="flex flex-col md:flex-row gap-5 md:gap-6 lg:gap-10" aria-hidden="true">
            <div className="player-poster-frame aspect-[2/3] w-[50%] max-w-[14.4rem] sm:max-w-[16.8rem] md:w-[19.2rem] lg:w-[21.6rem] flex-shrink-0 overflow-hidden rounded-[12px] border border-white/10 bg-white/5 animate-pulse" />
            <div className="flex-1 min-w-0 flex flex-col gap-4 justify-end pb-2">
                <div className="h-3 w-20 rounded bg-white/10 animate-pulse" />
                <div className="h-10 w-2/3 max-w-md rounded-lg bg-white/10 animate-pulse" />
                <div className="h-4 w-24 rounded bg-white/10 animate-pulse" />
                <div className="space-y-2 max-w-xl">
                    <div className="h-4 w-full rounded bg-white/10 animate-pulse" />
                    <div className="h-4 w-5/6 rounded bg-white/10 animate-pulse" />
                    <div className="h-4 w-2/3 rounded bg-white/10 animate-pulse" />
                </div>
                <div className="flex gap-2 mt-1">
                    <div className="h-11 w-28 rounded-xl bg-white/10 animate-pulse" />
                    <div className="h-11 w-11 rounded-xl bg-white/10 animate-pulse" />
                    <div className="h-11 w-11 rounded-xl bg-white/10 animate-pulse" />
                </div>
            </div>
        </div>
    </div>
);

const toCombinedRatings = (ratings?: PlayerRatings | null): CombinedRatings | null => {
    if (!ratings) return null;
    return {
        rt: (ratings.rottenTomatoes || ratings.popcorn) ? {
            criticsScore: ratings.rottenTomatoes?.percent ?? undefined,
            audienceScore: ratings.popcorn?.percent ?? undefined,
            criticsRating: ratings.rottenTomatoes?.fresh === false ? 'Rotten' : 'Fresh',
            audienceRating: ratings.popcorn?.fresh === false ? 'Spilled' : 'Upright',
        } : undefined,
        imdb: ratings.imdb ? {
            criticsScore: ratings.imdb.value > 10 ? ratings.imdb.value / 10 : ratings.imdb.value,
            url: ratings.imdb.url,
        } : undefined,
    };
};

const EPISODE_SWIPE_MIN_DX = 56;
const isCoarseMobileViewport = () => {
    if (typeof window === 'undefined') return false;
    try {
        if (document.documentElement?.dataset?.phone === '1') return true;
    } catch {
        /* ignore */
    }
    return window.matchMedia('(max-width: 767px)').matches;
};

const touchTargetBlocksEpisodeSwipe = (target: EventTarget | null) => {
    if (!(target instanceof Element)) return false;
    return Boolean(target.closest(
        'button, a, input, textarea, select, [role="slider"], [data-no-episode-swipe="1"]',
    ));
};

export const MediaPlayerDetails: React.FC<Props> = ({
    ratingKey,
    serverId = '',
    onBack,
    onOpenItem,
    onOpenPerson,
    onOpenStudio,
    onPlay,
    onPlayNext,
    onToast,
    isAdmin = false,
    playlistsEnabled = true,
    playing = false,
    playbackActive = false,
}) => {
    const { t, locale } = useDiscoverI18n();
    const [settings] = usePlayerSettings();
    const [gridSize] = useDiscoverGridSize();
    const [item, setItem] = useState<PlayerItem | null>(() => {
        const cached = readPlayerItemCache(ratingKey);
        return cached?.item ? withWatchedProgress(cached.item, cached.children || []) : null;
    });
    const [children, setChildren] = useState<PlayerItem[]>(() => (
        (readPlayerItemCache(ratingKey)?.children || []).map((row) => applyRememberedProgress(row))
    ));
    const [extras, setExtras] = useState<PlayerItem[]>(() => readPlayerItemCache(ratingKey)?.extras || []);
    const [related, setRelated] = useState<PlayerLibraryHub[]>(() => readPlayerItemCache(ratingKey)?.related || []);
    const [onDeck, setOnDeck] = useState<PlayerItem | null>(() => readPlayerItemCache(ratingKey)?.onDeck ?? null);
    const [phoneSeasonEpisodes, setPhoneSeasonEpisodes] = useState<PlayerItem[] | null>(null);
    const [neighbors, setNeighbors] = useState<{ previous: PlayerItem | null; next: PlayerItem | null }>({ previous: null, next: null });
    const [showSeasons, setShowSeasons] = useState<PlayerItem[]>([]);
    const [seasonEpisodes, setSeasonEpisodes] = useState<PlayerItem[]>([]);
    const [spotlightKey, setSpotlightKey] = useState('');
    const [spotlightDetail, setSpotlightDetail] = useState<PlayerItem | null>(null);
    const openingSeasonRef = useRef('');
    const episodeDetailCache = useRef(new Map<string, PlayerItem>());
    const [loading, setLoading] = useState(() => !readPlayerItemCache(ratingKey)?.item);
    const [error, setError] = useState<string | null>(null);
    const [reloadToken, setReloadToken] = useState(0);
    const [posterFailed, setPosterFailed] = useState(false);
    const [phonePosterFailed, setPhonePosterFailed] = useState(false);
    const [backdropFailed, setBackdropFailed] = useState(false);
    const [posterReady, setPosterReady] = useState(false);
    const [backdropReady, setBackdropReady] = useState(false);
    const [logoFailed, setLogoFailed] = useState(false);
    const [logoReady, setLogoReady] = useState(false);
    const [mediaIndex, setMediaIndex] = useState(0);
    const [audioStreamId, setAudioStreamId] = useState('');
    const [subtitleStreamId, setSubtitleStreamId] = useState('');
    const [playlists, setPlaylists] = useState<PlayerItem[]>([]);
    const [playlistOpen, setPlaylistOpen] = useState(false);
    const [newPlaylistName, setNewPlaylistName] = useState('');
    const [playlistMessage, setPlaylistMessage] = useState('');
    const [versionPickerOpen, setVersionPickerOpen] = useState(false);
    const [fileInfoOpen, setFileInfoOpen] = useState(false);
    const [seasonWatchOpen, setSeasonWatchOpen] = useState(false);
    const [seasonWatchBusy, setSeasonWatchBusy] = useState(false);
    const episodeSwipeRef = useRef<{ x: number; y: number } | null>(null);
    const seasonEntryFocusKey = useRef('');
    const heldMenuRef = useRef<PlayerItemMenuHandle | null>(null);
    const [heldMenuItem, setHeldMenuItem] = useState<PlayerItem | null>(null);
    const [heldMenuToken, setHeldMenuToken] = useState(0);
    const neighborsRef = useRef(neighbors);
    neighborsRef.current = neighbors;
    const isTvShell = typeof document !== 'undefined' && (
        document.documentElement?.dataset?.tv === '1'
        || window.__PLEX_CLIENT__?.isTv === true
    );
    const phoneUi = !isTvShell && isPhoneDetailsUi();

    const paintWatched = (watched: boolean, season: boolean) => {
        setItem((prev) => {
            if (!prev) return prev;
            const leaves = Number(prev.leafCount || 0);
            return {
                ...prev,
                watched,
                viewOffsetMs: watched ? 0 : prev.viewOffsetMs,
                viewedLeafCount: (season || prev.type === 'show')
                    ? (watched ? (leaves || Number(prev.viewedLeafCount || 0)) : 0)
                    : prev.viewedLeafCount,
            };
        });
        if (!season) return;
        setChildren((rows) => rows.map((row) => (
            row.type === 'episode' ? { ...row, watched, viewOffsetMs: watched ? 0 : row.viewOffsetMs } : row
        )));
    };

    const confirmSeasonWatched = async () => {
        if (!item || seasonWatchBusy) return;
        setSeasonWatchBusy(true);
        try {
            await setSeasonEpisodesWatched(item.ratingKey, true, item.serverId);
            paintWatched(true, true);
            setSeasonWatchOpen(false);
        } catch {
            onToast?.(t('mediaPlayerPage.actionError'), 'error');
        } finally {
            setSeasonWatchBusy(false);
        }
    };

    const onWatchedPress = () => {
        if (!item) return;
        if (item.type === 'season' && !item.watched) {
            setSeasonWatchOpen(true);
            return;
        }
        const next = !item.watched;
        const season = item.type === 'season';
        if (!season) {
            setItem({
                ...item,
                watched: next,
                viewOffsetMs: 0,
                viewedLeafCount: item.type === 'show'
                    ? (next ? Number(item.leafCount || item.viewedLeafCount || 0) : 0)
                    : item.viewedLeafCount,
            });
        }
        void (async () => {
            try {
                if (season) await setSeasonEpisodesWatched(item.ratingKey, next, item.serverId);
                else await setMediaPlayerWatched(item.ratingKey, next, item);
                if (season) paintWatched(next, true);
            } catch {
                if (!season) setItem(item);
                onToast?.(t('mediaPlayerPage.actionError'), 'error');
            }
        })();
    };

    const onWatchedChange = (row: PlayerItem, watched: boolean) => {
        setItem((prev) => {
            if (!prev) return prev;
            const leaves = Number(prev.leafCount || 0);
            return {
                ...prev,
                watched,
                viewOffsetMs: watched ? 0 : prev.viewOffsetMs,
                viewedLeafCount: (prev.type === 'show' || prev.type === 'season')
                    ? (watched ? (leaves || Number(prev.viewedLeafCount || 0)) : 0)
                    : prev.viewedLeafCount,
            };
        });
        if (row.type === 'season') paintWatched(watched, true);
    };

    useLayoutEffect(() => {
        writePlayerScrollTop(0);
        const cached = readPlayerItemCache(ratingKey);
        const seed = takePlayerItemSeed(ratingKey);
        if (cached?.item) {
            setItem(applyRememberedProgress(cached.item));
            setChildren((cached.children || []).map((row) => applyRememberedProgress(row)));
            setExtras(cached.extras || []);
            setRelated(cached.related || []);
            setOnDeck(cached.onDeck ?? null);
            setLoading(false);
        } else if (seed && hasDetailsHero(seed)) {
            const painted = applyRememberedProgress(seed);
            setItem(painted);
            setChildren([]);
            setExtras([]);
            setRelated([]);
            setOnDeck(null);
            setLoading(true);
            writePlayerItemCache(ratingKey, { item: painted, children: [], extras: [], related: [], onDeck: null });
        } else {
            setItem(null);
            setChildren([]);
            setExtras([]);
            setRelated([]);
            setOnDeck(null);
            setLoading(true);
        }
        setNeighbors({ previous: null, next: null });
        setError(null);
        setPosterFailed(false);
        setBackdropFailed(false);
        setPosterReady(false);
        setBackdropReady(false);
        setLogoFailed(false);
        setLogoReady(false);
        setMediaIndex(0);
        setAudioStreamId('');
        setSubtitleStreamId('');
        setPlaylistOpen(false);
        setPlaylistMessage('');
        setFileInfoOpen(false);
    }, [ratingKey]);

    useEffect(() => {
        const onOverlayClose = () => {
            setPlaylistOpen(false);
            setFileInfoOpen(false);
        };
        window.addEventListener('smp-tv-overlay-close', onOverlayClose);
        return () => window.removeEventListener('smp-tv-overlay-close', onOverlayClose);
    }, []);

    useEffect(() => {
        const onProgress = (event: Event) => {
            const detail = (event as CustomEvent<{ ratingKey?: string; viewOffsetMs?: number; durationMs?: number; dropContinue?: boolean; watched?: boolean; continueWith?: PlayerItem | null; advanceContinue?: boolean }>).detail;
            const key = String(detail?.ratingKey || '');
            if (!key) return;
            const patch = (row: PlayerItem): PlayerItem => {
                const keyMatch = String(row.ratingKey) === key;
                const family = detail.dropContinue === true && (
                    String(row.parentRatingKey || '') === key || String(row.grandparentRatingKey || '') === key
                );
                if (!keyMatch && !family) return row;
                if (family && !keyMatch) {
                    return { ...row, viewOffsetMs: 0, watched: detail.watched === true };
                }
                return applyRememberedProgress({
                    ...row,
                    viewOffsetMs: Math.max(0, Math.floor(Number(detail.viewOffsetMs) || 0)),
                    durationMs: row.durationMs || detail.durationMs || null,
                    watched: detail.dropContinue ? detail.watched === true : row.watched,
                });
            };
            setItem((prev) => (prev ? patch(prev) : prev));
            setChildren((prev) => prev.map(patch));
            setOnDeck((prev) => {
                if (detail.advanceContinue && detail.continueWith && prev && watchTargetTouches(prev, key)) {
                    return applyRememberedProgress({
                        ...detail.continueWith,
                        viewOffsetMs: Number(detail.continueWith.viewOffsetMs || 0),
                        watched: false,
                    });
                }
                return prev ? patch(prev) : prev;
            });
            setHeldMenuItem((prev) => (prev ? patch(prev) : prev));
        };
        window.addEventListener(PLAYER_PROGRESS_EVENT, onProgress);
        return () => window.removeEventListener(PLAYER_PROGRESS_EVENT, onProgress);
    }, []);

    useEffect(() => {
        let cancelled = false;
        // Core first (title + seasons/episodes). Extras/related/on-deck land via /more.
        const morePromise = fetchMediaPlayerItemMore(ratingKey, serverId || null).catch(() => null);
        fetchMediaPlayerItem(ratingKey, { core: true, serverId: serverId || null })
            .then((data) => {
                if (cancelled) return false;
                const rows = data.children || [];
                setItem(applyRememberedProgress(withWatchedProgress(data.item, rows)));
                setChildren(rows);
                if (data.extras?.length) setExtras(data.extras);
                if (data.related?.length) setRelated(data.related);
                if (data.onDeck) setOnDeck(data.onDeck);
                setError(null);
                setLoading(false);
                return true;
            })
            .catch((err) => {
                if (cancelled) return false;
                let kept = false;
                setItem((prev) => {
                    if (prev && String(prev.ratingKey) === String(ratingKey)) {
                        kept = true;
                        return prev;
                    }
                    return null;
                });
                if (!kept) setError(String(err?.message || t('mediaPlayerPage.loadError')));
                setLoading(false);
                return false;
            })
            .then(async (ok) => {
                if (!ok || cancelled) return;
                const more = await morePromise;
                if (cancelled || !more) return;
                if (more.extras?.length) setExtras(more.extras);
                setRelated(more.related || []);
                if (more.onDeck !== undefined) setOnDeck(more.onDeck || null);
                const prev = readPlayerItemCache(ratingKey);
                if (prev?.item) {
                    writePlayerItemCache(ratingKey, {
                        ...prev,
                        extras: more.extras?.length ? more.extras : (prev.extras || []),
                        related: more.related || [],
                        onDeck: more.onDeck !== undefined ? more.onDeck : prev.onDeck,
                    });
                }
            });
        return () => { cancelled = true; };
        // Intentionally omit `t` — unstable translate refs must not restart the fetch loop.
    }, [ratingKey, reloadToken, serverId]);

    useEffect(() => {
        if (!item || item.type !== 'episode') {
            setNeighbors({ previous: null, next: null });
            return undefined;
        }
        let cancelled = false;
        fetchMediaPlayerNeighbors(item.ratingKey, item.serverId || serverId)
            .then((data) => {
                if (!cancelled) setNeighbors({ previous: data.previous || null, next: data.next || null });
            })
            .catch(() => {
                if (!cancelled) setNeighbors({ previous: null, next: null });
            });
        return () => { cancelled = true; };
    }, [item?.ratingKey, item?.type, item?.serverId, serverId]);

    useEffect(() => {
        if (!isTvShell || !item || (item.type !== 'episode' && item.type !== 'season')) {
            setShowSeasons([]);
            return undefined;
        }
        const parentShowKey = item.type === 'season' ? item.parentRatingKey : item.grandparentRatingKey;
        if (!parentShowKey) {
            setShowSeasons([]);
            return undefined;
        }
        let cancelled = false;
        fetchMediaPlayerItem(parentShowKey, { core: true, serverId: item.serverId || serverId || null })
            .then((page) => {
                if (cancelled) return;
                setShowSeasons((page.children || []).filter((row) => row.type === 'season' && row.ratingKey));
            })
            .catch(() => {
                if (!cancelled) setShowSeasons([]);
            });
        return () => { cancelled = true; };
    }, [isTvShell, item?.ratingKey, item?.type, item?.parentRatingKey, item?.grandparentRatingKey, item?.serverId, serverId]);

    useEffect(() => {
        if (!isTvShell || item?.type !== 'episode' || !item.parentRatingKey) {
            setSeasonEpisodes([]);
            return undefined;
        }
        let cancelled = false;
        fetchMediaPlayerItem(item.parentRatingKey, { core: true, serverId: item.serverId || serverId || null })
            .then((page) => {
                if (cancelled) return;
                setSeasonEpisodes(
                    (page.children || [])
                        .filter((row) => row.type === 'episode')
                        .map((row) => applyRememberedProgress(row)),
                );
            })
            .catch(() => {
                if (!cancelled) setSeasonEpisodes([]);
            });
        return () => { cancelled = true; };
    }, [isTvShell, item?.ratingKey, item?.type, item?.parentRatingKey, item?.serverId, serverId]);

    useEffect(() => {
        if (!isTvShell || !item) return;
        const activePill = document.querySelector<HTMLElement>('[data-tv-season-pill="1"].is-active');
        activePill?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'auto' });
        const focusKey = spotlightKey || (item.type === 'episode' ? String(item.ratingKey) : '');
        if (!focusKey) return;
        const currentEp = document.querySelector<HTMLElement>(
            `[data-tv-episode-btn="1"][data-tv-key="${focusKey.replace(/"/g, '')}"]`,
        );
        const card = currentEp?.closest('.media-details-episode-card');
        const rail = currentEp?.closest<HTMLElement>('[data-tv-poster-rail="1"]');
        if (!card || !rail) return;
        const cards = rail.querySelectorAll('.media-details-episode-card');
        const first = cards[0];
        const last = cards[cards.length - 1];
        if (card === first) {
            rail.scrollLeft = 0;
            return;
        }
        if (card === last) {
            rail.scrollLeft = Math.max(0, rail.scrollWidth - rail.clientWidth);
            return;
        }
        card.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'auto' });
    }, [isTvShell, item?.ratingKey, item?.type, showSeasons, seasonEpisodes, spotlightKey]);

    useEffect(() => {
        if (!isTvShell || !item || (item.type !== 'episode' && item.type !== 'season')) {
            setSpotlightKey('');
            setSpotlightDetail(null);
            return;
        }
        const rows = item.type === 'episode'
            ? seasonEpisodes
            : children.filter((row) => row.type === 'episode');
        setSpotlightKey((prev) => {
            if (prev && rows.some((row) => String(row.ratingKey) === prev)) return prev;
            if (item.type === 'episode') return String(item.ratingKey);
            const onDeckKey = onDeck?.type === 'episode' ? String(onDeck.ratingKey) : '';
            if (onDeckKey && rows.some((row) => String(row.ratingKey) === onDeckKey)) return onDeckKey;
            return String(rows.find((row) => !row.watched)?.ratingKey || rows[0]?.ratingKey || '');
        });
    }, [isTvShell, item?.ratingKey, item?.type, seasonEpisodes, children, onDeck?.ratingKey]);

    useEffect(() => {
        if (!isTvShell || !spotlightKey) {
            setSpotlightDetail(null);
            return undefined;
        }
        const cached = episodeDetailCache.current.get(spotlightKey);
        if (episodeHasMediaInfo(cached)) {
            setSpotlightDetail(cached);
            return undefined;
        }
        if (item?.type === 'episode' && String(item.ratingKey) === spotlightKey && episodeHasMediaInfo(item)) {
            episodeDetailCache.current.set(spotlightKey, item);
            setSpotlightDetail(item);
            return undefined;
        }
        if (cached) setSpotlightDetail(cached);
        else if (item?.type === 'episode' && String(item.ratingKey) === spotlightKey) {
            setSpotlightDetail(item);
        }
        let cancelled = false;
        fetchMediaPlayerItem(spotlightKey, { core: true, serverId: item?.serverId || serverId || null })
            .then((page) => {
                if (cancelled || !page.item) return;
                const ep = applyRememberedProgress(page.item);
                episodeDetailCache.current.set(spotlightKey, ep);
                setSpotlightDetail(ep);
            })
            .catch(() => {
                if (!cancelled) setSpotlightDetail((prev) => (
                    prev && String(prev.ratingKey) === spotlightKey ? prev : null
                ));
            });
        return () => { cancelled = true; };
    }, [isTvShell, spotlightKey, item?.ratingKey, item?.serverId, serverId]);

    useEffect(() => {
        if (!phoneUi || item?.type !== 'show') {
            setPhoneSeasonEpisodes(null);
            return undefined;
        }
        const seasons = children.filter((row) => row.type === 'season');
        if (seasons.length !== 1 || !seasons[0].ratingKey) {
            setPhoneSeasonEpisodes(null);
            return undefined;
        }
        let cancelled = false;
        fetchMediaPlayerItem(seasons[0].ratingKey, { serverId: serverId || null })
            .then((page) => {
                if (cancelled) return;
                const episodes = (page.children || [])
                    .filter((row) => row.type === 'episode')
                    .map((row) => applyRememberedProgress(row));
                setPhoneSeasonEpisodes(episodes.length ? episodes : null);
            })
            .catch(() => {
                if (!cancelled) setPhoneSeasonEpisodes(null);
            });
        return () => { cancelled = true; };
    }, [phoneUi, item?.type, item?.ratingKey, children, serverId]);

    useEffect(() => {
        if (!settings.showPlaylists) {
            setPlaylists([]);
            return undefined;
        }
        let cancelled = false;
        fetchMediaPlayerPlaylists()
            .then((data) => {
                if (!cancelled) setPlaylists((data.items || []).filter((row) => !row.smart));
            })
            .catch(() => {
                if (!cancelled) setPlaylists([]);
            });
        return () => { cancelled = true; };
    }, [settings.showPlaylists]);

    useEffect(() => {
        if (!item || item.ratingKey !== ratingKey) return undefined;
        const src = plexLogoUrl(item.logo);
        setLogoReady(false);
        setLogoFailed(false);
        if (!src) {
            setLogoFailed(true);
            return undefined;
        }
        let cancelled = false;
        const img = new Image();
        const finish = (ok: boolean) => {
            if (cancelled) return;
            if (ok && img.naturalWidth > 0) setLogoReady(true);
            else setLogoFailed(true);
        };
        img.onload = () => finish(true);
        img.onerror = () => finish(false);
        img.src = src;
        if (img.complete) finish(img.naturalWidth > 0);
        return () => { cancelled = true; };
    }, [ratingKey, item?.ratingKey, item?.logo]);

    const trailer = useMemo(() => extras.find(isPlayerTrailer) || extras[0] || null, [extras]);
    useEffect(() => {
        if (!item?.ratingKey) return undefined;
        let cancelled = false;
        fetchMediaPlayerWatchlist()
            .then((data) => {
                if (cancelled) return;
                const hit = (data.items || []).find((row) => String(row.ratingKey) === String(item.ratingKey));
                if (!hit) return;
                setItem((prev) => prev && String(prev.ratingKey) === String(item.ratingKey)
                    ? { ...prev, watchlisted: true, discoverRatingKey: hit.discoverRatingKey || prev.discoverRatingKey }
                    : prev);
            })
            .catch(() => undefined);
        return () => { cancelled = true; };
    }, [item?.ratingKey]);
    const activeMediaPart = useMemo((): PlayerMediaPartInfo | null => {
        const mediaInfo = item?.mediaInfo || [];
        if (!mediaInfo.length) return null;
        const media = mediaInfo[Math.min(Math.max(0, mediaIndex), mediaInfo.length - 1)] || mediaInfo[0];
        return media?.parts?.[0] || null;
    }, [item?.mediaInfo, mediaIndex]);
    const audioTrackOptions = useMemo(
        () => (activeMediaPart?.audio || []).filter((row) => row.id),
        [activeMediaPart],
    );
    const subtitleTrackOptions = useMemo(
        () => (activeMediaPart?.subtitles || []).filter((row) => row.id),
        [activeMediaPart],
    );
    useEffect(() => {
        const preferredAudio = audioTrackOptions.find((row) => row.selected) || audioTrackOptions[0];
        const preferredSub = subtitleTrackOptions.find((row) => row.selected) || null;
        const savedAv = readAvChoice(item?.grandparentRatingKey || item?.parentRatingKey, item?.ratingKey);
        const resolved = resolveAvChoiceForTracks(savedAv, audioTrackOptions, subtitleTrackOptions);
        setAudioStreamId(
            resolved.audioStreamId
            || (preferredAudio?.id ? String(preferredAudio.id) : ''),
        );
        setSubtitleStreamId(
            resolved.subtitleStreamId !== undefined
                ? String(resolved.subtitleStreamId)
                : (preferredSub?.id ? String(preferredSub.id) : ''),
        );
    }, [item?.ratingKey, mediaIndex, audioTrackOptions, subtitleTrackOptions]);
    const mediaSummary = useMemo(() => {
        const mediaInfo = item?.mediaInfo || [];
        const first = mediaInfo[Math.min(Math.max(0, mediaIndex), Math.max(0, mediaInfo.length - 1))] || mediaInfo[0];
        const part = first?.parts?.[0] || activeMediaPart;
        if (!first && !part) return null;
        const resolution = formatPlayerResolution(part?.video?.height || first?.height, part?.video?.resolution || first?.videoResolution);
        const bitrate = formatBitrateMbps(part?.video?.bitrate || first?.bitrate);
        const codec = String(part?.video?.codec || first?.videoCodec || '').toUpperCase();
        const profile = titleCaseProfile(part?.video?.profile);
        const videoBits = [codec, profile].filter(Boolean).join(' ');
        const versions = [bitrate, resolution].filter(Boolean).join(', ');
        const selectedAudio = audioTrackOptions.find((row) => String(row.id) === String(audioStreamId))
            || part?.audio?.find((row) => row.selected)
            || part?.audio?.[0];
        const selectedSub = subtitleTrackOptions.find((row) => String(row.id) === String(subtitleStreamId))
            || null;
        return {
            versions: versions ? `${versions}${mediaInfo.length > 1 ? `, ${t('mediaPlayerPage.andMore')}` : ''}` : '',
            video: [resolution, videoBits ? `(${videoBits})` : ''].filter(Boolean).join(' '),
            audio: selectedAudio?.displayTitle || first?.audioCodec || '',
            subtitles: selectedSub?.displayTitle || '',
        };
    }, [activeMediaPart, audioStreamId, audioTrackOptions, item, mediaIndex, subtitleStreamId, subtitleTrackOptions, t]);
    const playOpts = useMemo((): PlayerPlayOptions => {
        const opts: PlayerPlayOptions = { mediaIndex };
        if (item?.type === 'movie' || item?.type === 'episode') {
            if (audioStreamId) opts.audioStreamId = audioStreamId;
            // Always send an explicit choice once the picker is shown ('' → Off).
            opts.subtitleStreamId = subtitleStreamId || '0';
        }
        return opts;
    }, [audioStreamId, item?.type, mediaIndex, subtitleStreamId]);
    const onAudioTrackChange = (id: string) => {
        setAudioStreamId(id);
        writeAvChoiceFromTracks(
            item?.grandparentRatingKey || item?.parentRatingKey,
            item?.ratingKey,
            id,
            subtitleStreamId || '0',
            audioTrackOptions,
            subtitleTrackOptions,
        );
    };
    const onSubtitleTrackChange = (id: string) => {
        const next = id === '0' ? '' : id;
        setSubtitleStreamId(next);
        writeAvChoiceFromTracks(
            item?.grandparentRatingKey || item?.parentRatingKey,
            item?.ratingKey,
            audioStreamId,
            next || '0',
            audioTrackOptions,
            subtitleTrackOptions,
        );
    };
    const playTarget = onDeck || item;
    const versionChoices = (onDeck?.versions?.length ? onDeck.versions : item?.versions) || [];
    const versionChoiceLabel = (row: PlayerVersion) => {
        const media = ((onDeck || item)?.mediaInfo || [])[row.mediaIndex];
        const resolution = row.resolution || formatPlayerResolution(row.height || media?.height, media?.videoResolution);
        const bitrate = formatBitrateMbps(row.bitrate || media?.bitrate);
        return [resolution, bitrate].filter(Boolean).join(' · ') || row.label;
    };
    const tvHubPlayTarget = (): PlayerItem => {
        let target = (playTarget || item) as PlayerItem;
        if (isTvShell && (item?.type === 'episode' || item?.type === 'season')) {
            const detailed = (
                spotlightDetail && String(spotlightDetail.ratingKey) === String(spotlightKey)
                    ? spotlightDetail
                    : (spotlightKey ? episodeDetailCache.current.get(spotlightKey) : null)
            );
            const rows = item?.type === 'episode'
                ? seasonEpisodes
                : children.filter((row) => row.type === 'episode');
            const row = rows.find((entry) => String(entry.ratingKey) === String(spotlightKey));
            if (detailed) target = detailed;
            else if (row) target = row;
            else if (item?.type === 'episode') target = item;
        }
        return target;
    };
    const startPlay = (index = mediaIndex) => {
        setVersionPickerOpen(false);
        setMediaIndex(index);
        onPlay(applyRememberedProgress(tvHubPlayTarget()), { ...playOpts, mediaIndex: index });
    };
    const playNextNeighbor = neighbors.next;
    const onPlayPress = () => {
        if (versionChoices.length > 1) {
            setVersionPickerOpen(true);
            return;
        }
        startPlay(mediaIndex);
    };
    const canShuffle = item?.type === 'show' || item?.type === 'season' || item?.type === 'playlist' || item?.type === 'collection' || item?.type === 'album' || item?.type === 'artist';
    const onShufflePress = () => {
        if (!item) return;
        onPlay(item, { shuffle: true, skipResume: true, offsetMs: 0 });
    };
    const onWatchlistPress = async () => {
        if (!item) return;
        const next = !item.watchlisted;
        setItem({ ...item, watchlisted: next });
        try {
            await setMediaPlayerWatchlisted(item, next);
            onToast?.(next ? t('mediaPlayerPage.addedToWatchlist') : t('mediaPlayerPage.removedFromWatchlist'));
        } catch {
            setItem({ ...item, watchlisted: item.watchlisted });
            onToast?.(t('mediaPlayerPage.actionError'), 'error');
        }
    };
    const watchlistChip = item && (item.type === 'movie' || item.type === 'show') ? (
        <button
            type="button"
            data-tv-item="1"
            data-tv-action="1"
            data-tv-key={`watchlist:${item.ratingKey}`}
            onClick={() => { void onWatchlistPress(); }}
            title={item.watchlisted ? t('mediaPlayerPage.removeFromWatchlist') : t('mediaPlayerPage.addToWatchlist')}
            aria-label={item.watchlisted ? t('mediaPlayerPage.removeFromWatchlist') : t('mediaPlayerPage.addToWatchlist')}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/15 bg-white/5 text-white transition-colors hover:border-plex/40 hover:bg-white/10"
        >
            {item.watchlisted ? <BookmarkCheck className="h-4 w-4" /> : <Bookmark className="h-4 w-4" />}
            <span className="media-details-action-label">
                {item.watchlisted ? t('mediaPlayerPage.removeFromWatchlist') : t('mediaPlayerPage.addToWatchlist')}
            </span>
        </button>
    ) : null;
    const tvTrailerButton = isTvShell && trailer && item ? (
        <button
            type="button"
            data-tv-item="1"
            data-tv-action="1"
            data-tv-trailer="1"
            data-tv-key={`trailer-label:${item.ratingKey}`}
            onClick={() => onPlay(trailer, { offsetMs: 0, skipResume: true })}
            disabled={playing || playbackActive}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-white/25 bg-white/10 px-4 text-sm font-bold text-white transition-colors hover:bg-white/16 disabled:opacity-50"
        >
            {t('mediaPlayerPage.trailer')}
        </button>
    ) : null;
    const shuffleChip = canShuffle && item ? (
        <button
            type="button"
            data-tv-item="1"
            data-tv-action="1"
            data-tv-key={`shuffle:${item.ratingKey}`}
            onClick={onShufflePress}
            disabled={playing || playbackActive}
            title={t('mediaPlayerPage.shuffle')}
            aria-label={t('mediaPlayerPage.shuffle')}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/15 bg-white/5 text-white transition-colors hover:border-plex/40 hover:bg-white/10 disabled:opacity-50"
        >
            <Shuffle className="h-4 w-4" />
            <span className="media-details-action-label">{t('mediaPlayerPage.shuffle')}</span>
        </button>
    ) : null;

    useEffect(() => {
        if (!versionPickerOpen) return undefined;
        const close = () => setVersionPickerOpen(false);
        window.addEventListener('smp-tv-overlay-close', close);
        const focusId = window.setTimeout(() => {
            document.querySelector<HTMLElement>('[data-tv-version-primary="1"]')?.focus();
        }, 40);
        return () => {
            window.removeEventListener('smp-tv-overlay-close', close);
            window.clearTimeout(focusId);
        };
    }, [versionPickerOpen]);

    useEffect(() => {
        setPosterReady(false);
        setPosterFailed(false);
        setPhonePosterFailed(false);
        setBackdropReady(false);
        setBackdropFailed(false);
    }, [item?.ratingKey, item?.thumb, item?.art]);

    useLayoutEffect(() => {
        const place = () => {
            if (isTvShell) pinTvDetailsTop();
            const root = document.querySelector<HTMLElement>('[data-tv-details="1"]');
            const anchor = root?.querySelector<HTMLElement>('[data-tv-fade-anchor="1"]');
            const backdrop = root?.querySelector<HTMLElement>('.media-details-hero-backdrop');
            if (!root || !anchor || !backdrop) return;
            const zoom = readDocumentZoom();
            // Solid colour begins at the title so the synopsis sits on the page, not the still.
            const extra = isTvShell ? 0 : -8;
            const edgeTop = anchor.getBoundingClientRect().top;
            const backdropHeight = backdrop.getBoundingClientRect().height / zoom;
            let fadePx = Math.max(0, Math.round(
                (edgeTop - backdrop.getBoundingClientRect().top) / zoom,
            ) + extra);
            if (!isTvShell && backdropHeight > 0) {
                fadePx = Math.min(fadePx, Math.round(backdropHeight * 0.92));
            }
            const fade = `${fadePx}px`;
            root.style.setProperty('--tv-backdrop-fade-end', fade);
            backdrop.style.setProperty('--tv-backdrop-fade-end', fade);
        };
        place();
        const frame = window.requestAnimationFrame(place);
        const timer = window.setTimeout(place, 120);
        const content = document.querySelector('[data-tv-details="1"] .media-details-hero-content');
        const observer = content ? new ResizeObserver(() => place()) : null;
        if (content) observer.observe(content);
        window.addEventListener('resize', place);
        return () => {
            window.cancelAnimationFrame(frame);
            window.clearTimeout(timer);
            observer?.disconnect();
            window.removeEventListener('resize', place);
        };
    }, [isTvShell, item?.ratingKey, item?.summary, item?.title, backdropReady, posterReady]);

    const onHeldWatchedChange = (row: PlayerItem, watched: boolean) => {
        if (item && row.ratingKey === item.ratingKey) {
            onWatchedChange(row, watched);
            return;
        }
        setChildren((prev) => prev.map((entry) => (
            entry.ratingKey === row.ratingKey ? { ...entry, watched, viewOffsetMs: watched ? 0 : entry.viewOffsetMs } : entry
        )));
        setExtras((prev) => prev.map((entry) => (
            entry.ratingKey === row.ratingKey ? { ...entry, watched, viewOffsetMs: watched ? 0 : entry.viewOffsetMs } : entry
        )));
        setHeldMenuItem((prev) => (prev && prev.ratingKey === row.ratingKey ? { ...prev, watched, viewOffsetMs: watched ? 0 : prev.viewOffsetMs } : prev));
    };

    useEffect(() => {
        if (!isTvShell) return undefined;
        const onOpen = (event: Event) => {
            const detail = (event as CustomEvent).detail || {};
            if (detail.handled) return;
            const poster = detail.poster as HTMLElement | undefined;
            const key = String(detail.ratingKey || '');
            const root = document.querySelector('[data-tv-details="1"]');
            if (!poster || !key || !root?.contains(poster)) return;
            const row = [...children, ...extras].find((entry) => String(entry.ratingKey) === key);
            if (!row) return;
            detail.handled = true;
            setHeldMenuItem(applyRememberedProgress(row));
            setHeldMenuToken((n) => n + 1);
        };
        window.addEventListener('smp-tv-poster-menu', onOpen);
        return () => window.removeEventListener('smp-tv-poster-menu', onOpen);
    }, [isTvShell, children, extras]);

    useEffect(() => {
        if (!heldMenuToken || !heldMenuItem) return undefined;
        const id = window.setTimeout(() => heldMenuRef.current?.openAt(), 30);
        return () => window.clearTimeout(id);
    }, [heldMenuToken, heldMenuItem]);

    useEffect(() => {
        if (!isTvShell || !item?.ratingKey) return undefined;
        if (item.type !== 'season' && item.type !== 'episode') return undefined;
        const episodeRows = item.type === 'episode'
            ? seasonEpisodes
            : children.filter((row) => row.type === 'episode');
        if (!episodeRows.length) return undefined;
        if (hasRememberedTvFocus()) return undefined;
        if (seasonEntryFocusKey.current === item.ratingKey) return undefined;
        seasonEntryFocusKey.current = item.ratingKey;
        focusSeasonEpisodeWhenReady();
        return undefined;
    }, [isTvShell, item?.ratingKey, item?.type, children, seasonEpisodes]);

    useEffect(() => {
        if (!isTvShell || !item?.canPlay || item.type === 'season' || item.type === 'episode') return undefined;
        if (hasRememberedTvFocus()) return undefined;
        let tries = 12;
        const tick = () => {
            const play = document.querySelector<HTMLElement>('[data-tv-play="1"]');
            if (play) {
                play.focus({ preventScroll: true });
                pinTvDetailsTop();
                return;
            }
            if (tries-- <= 0) return;
            window.setTimeout(tick, 40);
        };
        const id = window.requestAnimationFrame(tick);
        return () => window.cancelAnimationFrame(id);
    }, [isTvShell, item?.ratingKey, item?.canPlay]);

    useEffect(() => {
        if (!item?.ratingKey) return undefined;
        const posterSampleUrl = plexImageUrl(item.thumb, 160, 240, { quality: 40 });
        const previewUrl = plexBackdropPreviewUrl(item.art || item.thumb);
        const url = plexBackdropUrl(item.art || item.thumb);
        if (!posterSampleUrl && !url && !previewUrl) return undefined;
        let cancelled = false;
        let framed = false;
        applyTvDetailsSurface(isTvShell ? TV_FLOOR_RGB : DEFAULT_BACKDROP_SURFACE_RGB);
        const artUrl = url || previewUrl;
        const frameArt = (position: string) => {
            if (cancelled || framed) return;
            framed = true;
            const node = document.querySelector<HTMLElement>('[data-tv-details="1"]');
            node?.style.setProperty('--tv-backdrop-position', position);
            node?.querySelector('.media-details-hero-backdrop')?.classList.add('is-framed');
            sampleWhenFramed(position);
        };
        const sampleSurface = async (position: string) => {
            const node = document.querySelector<HTMLElement>('[data-tv-details="1"]');
            const backdrop = node?.querySelector<HTMLElement>('.media-details-hero-backdrop');
            const sampleUrl = (isPhoneDetailsUi() ? (artUrl || previewUrl) : (previewUrl || artUrl)) || posterSampleUrl;
            const frame = backdrop && backdrop.clientWidth > 2 && backdrop.clientHeight > 2
                ? { width: backdrop.clientWidth, height: backdrop.clientHeight, position }
                : undefined;
            const fromArt = await sampleBackdropSurfaceColor(sampleUrl, frame);
            if (!cancelled && fromArt) {
                applyTvDetailsSurface(fromArt);
                return;
            }
            if (posterSampleUrl) {
                const fromPoster = await samplePosterSurfaceColor(posterSampleUrl);
                if (!cancelled && fromPoster) applyTvDetailsSurface(fromPoster);
            }
        };
        const sampleWhenFramed = (position: string) => {
            if (isTvShell) return;
            let tries = 16;
            const tick = () => {
                if (cancelled) return;
                const backdrop = document.querySelector<HTMLElement>('.media-details-hero-backdrop');
                if (backdrop && backdrop.clientWidth > 2 && backdrop.clientHeight > 2) {
                    void sampleSurface(position);
                    return;
                }
                if (tries-- <= 0) {
                    void sampleSurface(position);
                    return;
                }
                window.requestAnimationFrame(tick);
            };
            tick();
        };
        const phone = isPhoneDetailsUi();
        const fallback = isTvShell ? '58% 20%' : (phone ? '50% 18%' : '50% 46%');
        const timer = window.setTimeout(() => frameArt(fallback), 280);
        if (artUrl) {
            void resolveImageFocalPoint(artUrl).then((focal) => {
                window.clearTimeout(timer);
                const position = isTvShell
                    ? formatTvDetailsBackdropPosition(focal)
                    : phone
                        ? `${Math.min(60, Math.max(40, focal.x))}% 18%`
                        : formatWebDetailsBackdropPosition(focal);
                frameArt(position);
            });
        } else {
            window.clearTimeout(timer);
            frameArt(fallback);
        }
        return () => {
            cancelled = true;
            window.clearTimeout(timer);
        };
    }, [isTvShell, item?.ratingKey, item?.art, item?.thumb]);

    useEffect(() => () => {
        clearTvDetailsSurface();
    }, []);

    if (loading && !hasDetailsHero(item)) {
        if (isTvShell) {
            return (
                <div
                    className="media-details-page"
                    data-tv-details="1"
                    aria-busy="true"
                    aria-label={t('mediaPlayerPage.loading')}
                />
            );
        }
        return <DetailsHeroSkeleton label={t('mediaPlayerPage.loading')} />;
    }

    if (error || !item) {
        if (isTvShell) {
            return (
                <PlayerTvStatusPanel
                    title={error || t('mediaPlayerPage.loadError')}
                    onRetry={() => {
                        setError(null);
                        setLoading(true);
                        setReloadToken((n) => n + 1);
                    }}
                    onBack={onBack}
                />
            );
        }
        return (
            <div className="flex flex-col gap-4">
                <button type="button" onClick={onBack} className="player-page-back inline-flex items-center gap-2 text-sm font-bold text-muted hover:text-text">
                    <ArrowLeft className="h-4 w-4" />
                    {t('mediaPlayerPage.back')}
                </button>
                <p className="font-bold text-text">{error || t('mediaPlayerPage.loadError')}</p>
            </div>
        );
    }

    const musicItem = isMusicPlayerItem(item);
    const posterWidth = musicItem ? 480 : item.type === 'episode' ? 640 : 480;
    const posterHeight = musicItem ? 480 : item.type === 'episode' ? 360 : 720;
    const posterUrl = resizePlexArtUrl(plexImageUrl(
        item.thumb,
        posterWidth,
        posterHeight,
        { quality: 70 },
    ), posterWidth, posterHeight);
    const backdropUrl = plexBackdropUrl(item.art || item.thumb);
    const backdropPreviewUrl = plexBackdropPreviewUrl(item.art || item.thumb);
    const logoUrl = plexLogoUrl(item.logo);
    const logoPending = Boolean(logoUrl) && !logoReady && !logoFailed;
    const showLogo = Boolean(logoUrl) && !logoFailed && logoReady;
    const preplayUi = phoneUi || isTvShell;
    const isBillboardTitle = !musicItem && (
        item.type === 'movie' || item.type === 'show' || item.type === 'season' || item.type === 'episode'
    );
    const showMissingPoster = !loading && (!posterUrl || posterFailed);
    const showPosterPulse = !showMissingPoster && (!posterReady || posterFailed || !posterUrl);
    const isEpisodeGrid = children.some((row) => row.type === 'episode');
    const musicTracks = children.filter((row) => row.type === 'track');
    const musicAlbums = children.filter((row) => row.type === 'album');
    const musicPosterDensity = homeRailPosterDensity(gridSize);
    const tvEpisodeRows = isTvShell && item.type === 'episode' && seasonEpisodes.length
        ? seasonEpisodes
        : children.filter((row) => row.type === 'episode');
    const spotlightRow = tvEpisodeRows.find((row) => String(row.ratingKey) === String(spotlightKey)) || null;
    const hubItem = (
        isTvShell && (item.type === 'episode' || item.type === 'season')
            ? ((spotlightDetail && String(spotlightDetail.ratingKey) === String(spotlightKey) ? spotlightDetail : null)
                || spotlightRow
                || (item.type === 'episode' ? item : null))
            : item
    ) || item;
    const hubTechPills = isTvShell && (item.type === 'episode' || item.type === 'season')
        ? episodeTechPills(hubItem)
        : [];
    const hubSummary = isTvShell && (item.type === 'episode' || item.type === 'season')
        ? (hubItem.type === 'episode' ? String(hubItem.summary || '') : '')
        : String(hubItem.summary || item.summary || '');
    const hubGuestStars = (isTvShell && (item.type === 'episode' || item.type === 'season')
        ? hubItem.guestStars
        : item.guestStars) || [];
    const hubGuestNames = new Set(hubGuestStars.map((row) => String(row.name || '').toLowerCase()));
    const hubCastPeople = [
        ...hubGuestStars,
        ...((isTvShell && (item.type === 'episode' || item.type === 'season') ? hubItem.cast : item.cast) || [])
            .filter((row) => !hubGuestNames.has(String(row.name || '').toLowerCase())),
    ].filter((row) => row?.name);
    const canPlay = !!item.canPlay
        || item.type === 'show'
        || item.type === 'season'
        || item.type === 'album'
        || item.type === 'artist'
        || item.type === 'track'
        || !!onDeck;
    const playbackItem = applyRememberedProgress(item);
    const watchedLeaves = Number(item.viewedLeafCount || 0);
    const totalLeaves = Number(item.leafCount || 0);
    const showFullyWatched = item.watched || (totalLeaves > 0 && watchedLeaves >= totalLeaves);
    const startLabel = isTvShell && !musicItem ? t('mediaPlayerPage.watch') : t('mediaPlayerPage.play');
    const playLabel = isTvShell && (item.type === 'episode' || item.type === 'season')
        ? (shouldOfferResume(applyRememberedProgress(tvHubPlayTarget()))
            ? t('mediaPlayerPage.resume')
            : startLabel)
        : item.type === 'show' || item.type === 'season'
            ? (!showFullyWatched && watchedLeaves > 0 ? t('mediaPlayerPage.resume') : startLabel)
            : (shouldOfferResume(playbackItem)
                ? t('mediaPlayerPage.resume')
                : startLabel);
    const playButtonClass = isTvShell
        ? 'inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-plex px-4 text-sm font-bold text-zinc-950 transition-colors disabled:cursor-not-allowed disabled:opacity-50'
        : 'inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-plex px-4 text-sm font-bold text-white shadow-lg shadow-plex/20 transition-colors hover:bg-plex-hover disabled:cursor-not-allowed disabled:opacity-50 max-md:w-full';
    const phonePlayTarget = applyRememberedProgress(playTarget || playbackItem);
    const phoneLeft = formatPlayerDuration(remainingWatchMs(phonePlayTarget));
    const phoneOnDeckCode = (item.type === 'show' || item.type === 'season')
        ? formatEpisodeCode(onDeck || phonePlayTarget)
        : '';
    const phonePlayLabel = phoneLeft
        ? (phoneOnDeckCode
            ? `${playLabel} ${phoneOnDeckCode} • ${phoneLeft} ${t('mediaPlayerPage.remaining')}`
            : `${playLabel} • ${phoneLeft} ${t('mediaPlayerPage.remaining')}`)
        : (phoneOnDeckCode ? `${playLabel} ${phoneOnDeckCode}` : playLabel);
    const actionPlayLabel = phoneUi ? phonePlayLabel : playLabel;
    const actionWatchedLabel = item.watched ? t('mediaPlayerPage.watched') : t('mediaPlayerPage.unwatched');
    const actionPlaylistLabel = t('mediaPlayerPage.actionPlaylist');
    const phoneListEpisodes = phoneUi
        ? ((isEpisodeGrid ? children.filter((row) => row.type === 'episode') : null) || phoneSeasonEpisodes || [])
        : [];
    const genres = (item.genres || []).slice(0, 4);
    const episodeCode = formatEpisodeCode(item);
    const metaChips = [
        episodeCode ? { icon: null, label: episodeCode } : null,
        item.contentRating ? { icon: null, label: String(item.contentRating) } : null,
        item.year ? { icon: <Calendar className="h-3 w-3" />, label: String(item.year) } : null,
        item.durationMs ? { icon: <Clock className="h-3 w-3" />, label: formatPlayerDuration(item.durationMs) } : null,
        (item.type === 'show' || item.type === 'season') && totalLeaves > 0
            ? { icon: null, label: t('mediaPlayerPage.episodeProgressValue', { watched: watchedLeaves, total: totalLeaves }) }
            : null,
        item.type === 'album' && musicTracks.length
            ? { icon: null, label: t(musicTracks.length === 1 ? 'mediaPlayerPage.trackCount' : 'mediaPlayerPage.trackCount_plural', { count: musicTracks.length }) }
            : null,
        item.type === 'artist' && musicAlbums.length
            ? { icon: null, label: t(musicAlbums.length === 1 ? 'mediaPlayerPage.albumCount' : 'mediaPlayerPage.albumCount_plural', { count: musicAlbums.length }) }
            : null,
        item.audienceRating ? { icon: <Star className="h-3.5 w-3.5 text-plex" />, label: String(item.audienceRating) } : null,
    ].filter(Boolean) as Array<{ icon: React.ReactNode; label: string }>;
    const streamRows = (() => {
        const media = (item.mediaInfo || [])[Math.min(Math.max(0, mediaIndex), Math.max(0, (item.mediaInfo || []).length - 1))] || item.mediaInfo?.[0];
        const part = media?.parts?.[0] || activeMediaPart;
        if (!media && !part) return [] as Array<{ label: string; value: string }>;
        const rows: Array<{ label: string; value: string }> = [];
        const video = formatMediaVideoLine(part?.video || {
            width: media?.width,
            height: media?.height,
            bitrate: media?.bitrate,
            codec: media?.videoCodec,
        });
        if (video) rows.push({ label: t('mediaPlayerPage.video'), value: video });
        const selectedAudio = (part?.audio || []).find((row) => String(row.id || '') === String(audioStreamId))
            || (part?.audio || []).find((row) => row.selected)
            || (part?.audio || [])[0];
        const audioLine = selectedAudio
            ? (formatMediaAudioLine(selectedAudio) || selectedAudio.displayTitle || '')
            : (mediaSummary?.audio || '');
        if (audioLine) rows.push({ label: t('mediaPlayerPage.audio'), value: audioLine });
        const selectedSub = subtitleTrackOptions.find((row) => String(row.id) === String(subtitleStreamId));
        rows.push({
            label: t('mediaPlayerPage.subtitles'),
            value: selectedSub?.displayTitle || t('mediaPlayerPage.subtitlesOff'),
        });
        return rows;
    })();
    const mediaInfoSection = streamRows.length ? (
        <div className="media-details-media-info flex flex-col gap-3" data-no-episode-swipe="1">
            <h3 className="text-xs font-black uppercase tracking-[0.2em] text-muted">
                {t('mediaPlayerPage.mediaInfo')}
            </h3>
            <div className="grid max-w-3xl grid-cols-[auto_1fr] gap-x-6 gap-y-1.5">
                {streamRows.map((row, index) => (
                    <React.Fragment key={`${row.label}-${index}`}>
                        <span className="pt-0.5 text-xs font-black uppercase tracking-wider text-muted">{row.label}</span>
                        <span className="break-words text-left text-sm font-semibold text-text">{row.value}</span>
                    </React.Fragment>
                ))}
            </div>
        </div>
    ) : null;
    const guestNames = new Set((item.guestStars || []).map((row) => String(row.name || '').toLowerCase()));
    const cast = (item.cast || []).filter((row) => !guestNames.has(String(row.name || '').toLowerCase()));
    const factMediaType = item.type === 'movie'
        ? 'movie'
        : (item.type === 'show' || item.type === 'season' || item.type === 'episode' ? 'tv' : null);
    const factMediaId = Number(
        item.type === 'episode' || item.type === 'season'
            ? (item.showTmdbId || item.externalIds?.tmdb || item.tmdbId)
            : (item.externalIds?.tmdb || item.tmdbId),
    );
    const factTitle = item.type === 'episode' || item.type === 'season'
        ? (item.showTitle || item.title)
        : item.title;
    const didYouKnowWidget = factMediaType ? (
        <DiscoveryFactWidget
            mediaType={factMediaType}
            mediaId={Number.isFinite(factMediaId) && factMediaId > 0 ? factMediaId : 0}
            title={factTitle}
            year={item.year}
            className={`${OVERVIEW_FACT_WIDTH_CLASS} ${OVERVIEW_SPOTLIGHT_CARD_SHELL_CLASS} items-center`}
            compact
        />
    ) : null;
    const showKey = item.type === 'season' || item.type === 'album'
        ? item.parentRatingKey
        : item.grandparentRatingKey;
    const seasonKey = item.type === 'episode' || item.type === 'track'
        ? item.parentRatingKey
        : (item.type === 'season' || item.type === 'album' ? item.ratingKey : null);
    const showName = item.type === 'season' || item.type === 'episode' || item.type === 'album' || item.type === 'track'
        ? item.showTitle
        : null;
    const seasonLabel = item.type === 'episode' || item.type === 'track'
        ? (item.seasonTitle || null)
        : (item.type === 'season' ? item.title : null);
    const openCrumb = (nextKey?: string | null) => {
        if (!nextKey || nextKey === item.ratingKey) return;
        const nextType = nextKey === seasonKey
            ? (item.type === 'track' ? 'album' : 'season')
            : (musicItem ? 'artist' : 'show');
        onOpenItem({
            ratingKey: nextKey,
            title: nextType === 'season' || nextType === 'album'
                ? (item.seasonTitle || item.title || '')
                : (item.showTitle || item.title || ''),
            type: nextType,
            thumb: item.thumb,
            art: item.art,
            showTitle: item.showTitle,
            canPlay: nextType === 'album' || nextType === 'artist',
        } as PlayerItem);
    };
    const seasonPillLabel = (row: PlayerItem) => {
        if (row.index === 0) return row.title || t('common.specials');
        if (row.title) return row.title;
        if (row.index != null) return t('common.seasonN', { number: row.index });
        return t('mediaPlayerPage.seasons');
    };
    const onSeasonPill = (season: PlayerItem) => {
        const key = String(season.ratingKey || '');
        if (!key) return;
        const currentSeasonKey = String(
            item.type === 'season' ? item.ratingKey : (item.parentRatingKey || ''),
        );
        if (key === currentSeasonKey) return;
        if (item.type === 'season') {
            onOpenItem(season);
            return;
        }
        if (openingSeasonRef.current === key) return;
        openingSeasonRef.current = key;
        void fetchMediaPlayerItem(key, { core: true, serverId: item.serverId || serverId || null })
            .then((page) => {
                const eps = (page.children || []).filter((row) => row.type === 'episode');
                const next = eps.find((row) => !row.watched) || eps[0];
                onOpenItem(next ? {
                    ...next,
                    showTitle: next.showTitle || item.showTitle,
                    art: next.art || item.art,
                    logo: next.logo || item.logo,
                } : season);
            })
            .catch(() => onOpenItem(season))
            .finally(() => {
                if (openingSeasonRef.current === key) openingSeasonRef.current = '';
            });
    };
    const tmdbScore = item.ratings?.tmdb?.percent != null ? `${item.ratings.tmdb.percent}%` : null;
    const tvdbValue = item.ratings?.tvdb?.value;
    const tvdbScore = tvdbValue == null
        ? null
        : (tvdbValue <= 10 ? tvdbValue.toFixed(1) : `${item.ratings?.tvdb?.percent ?? Math.round(tvdbValue)}%`);
    const posterTickClass = `${watchedTickPositionClass(
        item.type === 'episode' ? 'top-right' : settings.watchedTickPosition,
        { aboveProgress: progressPercent(item) > 0 },
    )} player-watched-tick z-20 flex h-7 w-7 items-center justify-center rounded-full bg-plex text-zinc-950 shadow-lg ring-2 ring-black/30${
        item.type === 'episode'
            ? ''
            : ' opacity-0 transition-opacity duration-200 group-hover:opacity-100 [@media(hover:none)]:opacity-100'
    }`;
    const seasonTickClass = `${watchedTickPositionClass(settings.watchedTickPosition)} player-watched-tick z-10 flex h-6 w-6 items-center justify-center rounded-full bg-plex text-zinc-950 shadow-md opacity-0 transition-opacity duration-200 group-hover:opacity-100 [@media(hover:none)]:opacity-100`;

    const onEpisodeSwipeStart = (event: React.TouchEvent) => {
        if (item.type !== 'episode' || playing || playbackActive) return;
        if (!isCoarseMobileViewport()) return;
        if (touchTargetBlocksEpisodeSwipe(event.target)) return;
        if (!neighborsRef.current.previous && !neighborsRef.current.next) return;
        const touch = event.touches[0];
        if (!touch) return;
        episodeSwipeRef.current = { x: touch.clientX, y: touch.clientY };
    };

    const onEpisodeSwipeEnd = (event: React.TouchEvent) => {
        const start = episodeSwipeRef.current;
        episodeSwipeRef.current = null;
        if (!start || item.type !== 'episode' || playing || playbackActive) return;
        if (!isCoarseMobileViewport()) return;
        const touch = event.changedTouches[0];
        if (!touch) return;
        const dx = touch.clientX - start.x;
        const dy = touch.clientY - start.y;
        if (Math.abs(dx) < EPISODE_SWIPE_MIN_DX) return;
        if (Math.abs(dx) < Math.abs(dy) * 1.2) return;
        const target = dx < 0 ? neighborsRef.current.next : neighborsRef.current.previous;
        if (target?.ratingKey) onOpenItem(target);
    };

    const onEpisodeSwipeCancel = () => {
        episodeSwipeRef.current = null;
    };

    const typeAndGenres = item.type !== 'episode' && genres.length ? (
        <div className="media-details-kicker flex flex-wrap items-center justify-center gap-x-3 gap-y-2">
            <OverviewGenres genres={genres} />
        </div>
    ) : null;

    const titleMetaBlock = (
        <>
            {item.tagline ? (
                <p className="text-sm sm:text-base text-white/80 italic max-w-3xl drop-shadow-md">{item.tagline}</p>
            ) : null}
            <div className="player-meta-chips flex flex-wrap items-center gap-1.5">
                {metaChips.map((chip) => (
                    <div key={chip.label} className="player-meta-chip flex items-center gap-1 bg-black/45 px-2 py-1 rounded-md backdrop-blur-md border border-white/10 text-[11px] text-white/85 font-semibold">
                        {chip.icon}
                        {chip.label}
                    </div>
                ))}
            </div>
            <MediaRatingPills
                ratings={toCombinedRatings(item.ratings)}
                tmdbScore={tmdbScore}
                tmdbUrl={item.ratings?.tmdb?.url}
                tvdbScore={tvdbScore}
                tvdbUrl={item.ratings?.tvdb?.url}
                interactive={!isTvShell}
            />
        </>
    );

    const titleBlock = (
        <>
            {showName ? (
                showLogo ? (
                    <button
                        type="button"
                        onClick={() => openCrumb(showKey)}
                        disabled={!showKey}
                        className="self-start text-left disabled:cursor-default"
                    >
                        <PlayerClearLogo
                            src={logoUrl}
                            alt={showName}
                            boostTopMark
                            className={item.type === 'season'
                                ? 'h-14 sm:h-20 lg:h-[6.5rem] w-auto max-w-[min(100%,32rem)] self-start object-contain object-left-top drop-shadow-[0_12px_28px_rgba(0,0,0,0.75)]'
                                : 'h-10 sm:h-12 lg:h-16 w-auto max-w-[min(100%,26rem)] self-start object-contain object-left-top drop-shadow-[0_10px_24px_rgba(0,0,0,0.7)]'}
                        />
                    </button>
                ) : (
                    <button
                        type="button"
                        onClick={() => openCrumb(showKey)}
                        disabled={!showKey}
                        className="text-sm sm:text-lg font-black text-white/80 hover:text-plex transition-colors text-left disabled:hover:text-white/80 disabled:cursor-default"
                    >
                        {showName}
                    </button>
                )
            ) : null}
            {seasonLabel ? (
                item.type === 'episode' && seasonKey ? (
                    <button
                        type="button"
                        onClick={() => openCrumb(seasonKey)}
                        className="text-sm sm:text-base font-bold text-white/75 hover:text-plex transition-colors text-left"
                    >
                        {seasonLabel}
                    </button>
                ) : (
                    <p className="text-sm sm:text-base font-bold text-white/85">{seasonLabel}</p>
                )
            ) : null}
            {item.type === 'season' ? (
                <h1 className="sr-only">{item.title}</h1>
            ) : showLogo && !showName ? (
                <>
                    <PlayerClearLogo
                        src={logoUrl}
                        alt={item.title}
                        boostTopMark
                        className="h-14 sm:h-20 lg:h-[6.5rem] w-auto max-w-[min(100%,32rem)] self-start object-contain object-left-top drop-shadow-[0_12px_28px_rgba(0,0,0,0.75)]"
                    />
                    <h1 className="sr-only">{item.title}</h1>
                </>
            ) : (
                <h1 className="text-2xl sm:text-3xl lg:text-5xl font-black text-white leading-[1.08] tracking-tight drop-shadow-lg">
                    {item.title}
                </h1>
            )}
            {titleMetaBlock}
        </>
    );

    const mobileBillboardTitle = item.type === 'season' || item.type === 'episode'
        ? (item.showTitle || item.title)
        : item.title;
    const phoneShowClickable = preplayUi && (item.type === 'episode' || item.type === 'season') && !!showKey;
    const phoneSeasonClickable = preplayUi && item.type === 'episode' && !!seasonKey;
    const phoneBillboardMeta = preplayUi ? [
        item.type === 'episode' && item.index != null ? `E${item.index}` : '',
        item.type === 'episode' ? formatPlayerDate(item.originallyAvailableAt, locale) : String(item.year || ''),
        formatPlayerDuration(item.durationMs),
        item.type !== 'episode' ? genres.slice(0, 3).join(', ') : '',
        item.contentRating ? String(item.contentRating) : '',
    ].filter(Boolean).join('  ·  ') : '';
    const phonePosterPath = item.type === 'episode' && item.grandparentRatingKey
        ? `/library/metadata/${item.grandparentRatingKey}/thumb`
        : item.type === 'season' && item.parentRatingKey
            ? `/library/metadata/${item.parentRatingKey}/thumb`
            : item.thumb;
    const phonePosterUrl = phoneUi && settings.phoneOverviewPoster && phonePosterPath
        ? plexImageUrl(phonePosterPath, 360, 540, { quality: 72 })
        : '';
    const mobileShowTitleNode = phonePosterUrl && !phonePosterFailed ? (
        <img
            src={phonePosterUrl}
            alt={mobileBillboardTitle}
            className="media-details-billboard-poster"
            onError={() => setPhonePosterFailed(true)}
        />
    ) : showLogo ? (
        <PlayerClearLogo
            src={logoUrl}
            alt={mobileBillboardTitle}
            className="media-details-clearlogo h-[4.75rem] w-auto max-w-[min(92%,20rem)] object-contain object-center drop-shadow-[0_10px_28px_rgba(0,0,0,0.8)]"
        />
    ) : logoPending && !settings.phoneOverviewPoster ? (
        <div className="h-[4.75rem] w-[12rem]" aria-hidden />
    ) : (
        <span className="media-details-title-text w-full text-center text-[1.85rem] font-black leading-[1.05] tracking-tight text-white drop-shadow-[0_8px_24px_rgba(0,0,0,0.8)]">
            {mobileBillboardTitle}
        </span>
    );
    const mobileBillboardIdentity = (
        <>
            {phoneShowClickable ? (
                <button
                    type="button"
                    className="pointer-events-auto max-w-full"
                    data-tv-item={isTvShell ? '1' : undefined}
                    data-tv-action={isTvShell ? '1' : undefined}
                    data-tv-key={isTvShell ? `preplay-show:${showKey}` : undefined}
                    onClick={() => openCrumb(showKey)}
                    aria-label={t('mediaPlayerPage.goToShow')}
                >
                    {mobileShowTitleNode}
                </button>
            ) : (
                mobileShowTitleNode
            )}
            <h1 className="sr-only">{item.title}</h1>
            {preplayUi && item.type === 'season' && seasonLabel && !isTvShell ? (
                <p className="mt-1 text-[1.05rem] font-bold text-white/90 drop-shadow-[0_6px_16px_rgba(0,0,0,0.75)]">{seasonLabel}</p>
            ) : null}
            {preplayUi && (item.type === 'episode' || (isTvShell && item.type === 'season')) ? (
                isTvShell ? (
                    <p className="media-details-episode-heading">{hubItem.title}</p>
                ) : phoneSeasonClickable ? (
                    <button
                        type="button"
                        className="pointer-events-auto mt-1 inline-flex max-w-full items-center gap-1 text-[1.05rem] font-bold text-white/90 drop-shadow-[0_6px_16px_rgba(0,0,0,0.75)]"
                        onClick={() => openCrumb(seasonKey)}
                        aria-label={t('mediaPlayerPage.goToSeason')}
                    >
                        <span className="truncate">{item.title}</span>
                        <ChevronDown className="h-5 w-5 shrink-0 opacity-80" />
                    </button>
                ) : (
                    <p className="mt-1 text-[1.05rem] font-bold text-white/90">{item.title}</p>
                )
            ) : null}
            {phoneBillboardMeta || (isTvShell && hubItem.type === 'episode') ? (
                <p className="media-details-billboard-line mt-1.5 max-w-[22rem] text-center text-[12px] font-semibold tracking-wide text-white/75 drop-shadow-[0_4px_12px_rgba(0,0,0,0.7)]">
                    {isTvShell && hubItem.type === 'episode'
                        ? [
                            formatEpisodeCode(hubItem) || (hubItem.index != null ? `E${hubItem.index}` : ''),
                            formatPlayerDate(hubItem.originallyAvailableAt, locale),
                            formatPlayerDuration(hubItem.durationMs),
                        ].filter(Boolean).join('  •  ')
                        : phoneBillboardMeta}
                </p>
            ) : null}
            {preplayUi && !(isTvShell && (item.type === 'episode' || item.type === 'season')) ? (
                <div className="media-details-billboard-ratings pointer-events-auto mt-2.5 flex w-full flex-col items-center gap-2">
                    <div className="player-meta-chips flex flex-wrap items-center justify-center gap-1.5">
                        {metaChips.map((chip) => (
                            <div key={chip.label} className="player-meta-chip flex items-center gap-1 bg-black/45 px-2 py-1 rounded-md backdrop-blur-md border border-white/10 text-[11px] text-white/85 font-semibold">
                                {chip.icon}
                                {chip.label}
                            </div>
                        ))}
                    </div>
                    <MediaRatingPills
                        ratings={toCombinedRatings(hubItem.ratings || item.ratings)}
                        tmdbScore={tmdbScore}
                        tmdbUrl={(hubItem.ratings || item.ratings)?.tmdb?.url}
                        tvdbScore={tvdbScore}
                        tvdbUrl={(hubItem.ratings || item.ratings)?.tvdb?.url}
                        interactive={!isTvShell}
                    />
                </div>
            ) : null}
        </>
    );
    const playNextButton = phoneUi && playNextNeighbor ? (
        <button
            type="button"
            className="media-details-play-next inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/12 text-white"
            aria-label={t('mediaPlayerPage.playNext')}
            onClick={() => onPlay(playNextNeighbor, { offsetMs: 0, skipResume: true })}
            disabled={playing || playbackActive}
        >
            <SkipForward className="h-5 w-5 fill-current" />
        </button>
    ) : null;

    return (
        <div
            key={ratingKey}
            data-tv-details="1"
            data-tv-kind={item.type || ''}
            data-tv-rating={item.ratingKey || ''}
            data-tv-loading={loading ? '1' : '0'}
            className={`media-details-page relative page-bleed-x w-full flex flex-col min-h-screen pb-24 md:pb-16 border-0 shadow-none rounded-none ${
                isTvShell ? 'overflow-x-clip overflow-y-visible' : 'overflow-x-hidden animate-fade-in'
            }`}
            onTouchStart={onEpisodeSwipeStart}
            onTouchEnd={onEpisodeSwipeEnd}
            onTouchCancel={onEpisodeSwipeCancel}
        >
            <div data-tv-page-top="1" className="h-0 w-full" aria-hidden />
            <div className="media-details-hero relative isolate">
                <div className="media-details-hero-backdrop absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
                    {backdropUrl && !backdropFailed ? (
                        <PlayerBackdropImage
                            key={backdropUrl}
                            src={backdropUrl}
                            previewSrc={isTvShell ? backdropPreviewUrl : undefined}
                            className="absolute inset-0 w-full h-full object-cover"
                            fetchPriority="high"
                            onLoad={() => setBackdropReady(true)}
                            onError={() => setBackdropFailed(true)}
                        />
                    ) : (
                        <div className="absolute inset-0 bg-black" />
                    )}
                    <div className="media-details-hero-scrim-mobile absolute inset-0 md:hidden" />
                </div>
                {isBillboardTitle ? (
                    <div className="media-details-billboard-identity pointer-events-none absolute z-[12] hidden">
                        {isTvShell && (item.type === 'episode' || item.type === 'season') && showSeasons.length ? (
                            <div
                                className="media-details-season-pills"
                                data-tv-row="1"
                                data-tv-row-id={`season-tabs:${showKey || item.ratingKey}`}
                            >
                                {showKey ? (
                                    <button
                                        type="button"
                                        data-tv-item="1"
                                        data-tv-season-pill="1"
                                        data-tv-key={`season-tab:show:${showKey}`}
                                        className="media-details-season-pill"
                                        onClick={() => openCrumb(showKey)}
                                    >
                                        Show
                                    </button>
                                ) : null}
                                {showSeasons.map((season) => {
                                    const active = String(season.ratingKey) === String(
                                        item.type === 'season' ? item.ratingKey : (item.parentRatingKey || ''),
                                    );
                                    return (
                                        <button
                                            key={season.ratingKey}
                                            type="button"
                                            data-tv-item="1"
                                            data-tv-season-pill="1"
                                            data-tv-key={`season-tab:${season.ratingKey}`}
                                            className={`media-details-season-pill${active ? ' is-active' : ''}`}
                                            aria-current={active ? 'page' : undefined}
                                            onClick={() => onSeasonPill(season)}
                                        >
                                            {seasonPillLabel(season)}
                                        </button>
                                    );
                                })}
                            </div>
                        ) : null}
                        {mobileBillboardIdentity}
                    </div>
                ) : null}

                <div className={`media-details-hero-content media-details-inset relative z-10 w-full max-w-none mx-0 pr-6 xl:pr-10 pt-2 sm:pt-3 ${
                    isTvShell ? 'md:pt-[150px]' : 'md:pt-[4.5rem] lg:pt-20'
                } ${children.length ? 'pb-5' : 'pb-8'}`}>
                    {!isTvShell ? (
                        <button
                            type="button"
                            onClick={onBack}
                            className="media-details-back player-page-back light-on-media mb-3 md:mb-0 md:absolute md:top-4 lg:top-5 z-20 inline-flex items-center gap-2 text-white/90 hover:text-white transition-colors bg-black/50 px-4 py-2 rounded-full backdrop-blur-md border border-white/10 hover:border-white/20 hover:bg-black/65"
                        >
                            <ArrowLeft className="w-5 h-5" />
                            <span className="font-bold text-sm">{t('mediaPlayerPage.back')}</span>
                        </button>
                    ) : (
                        <div className="media-details-tv-top-spacer mb-3" aria-hidden />
                    )}

                    {item.type === 'episode' || item.type === 'season' ? (
                        <div className="media-details-crumbs player-page-back mb-3 flex flex-wrap items-center gap-2" data-tv-rail="1">
                            {item.type === 'episode' && item.grandparentRatingKey ? (
                                <button
                                    type="button"
                                    data-tv-item="1"
                                    data-tv-action="1"
                                    onClick={() => onOpenItem({ ratingKey: String(item.grandparentRatingKey), type: 'show', title: item.showTitle || '', thumb: item.thumb, art: item.art, canPlay: false } as PlayerItem)}
                                    className="light-on-media inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/50 px-4 py-2 text-sm font-bold text-white/90 backdrop-blur-md transition-colors hover:bg-black/65 focus:border-plex focus:text-white"
                                >
                                    <ArrowLeft className="h-4 w-4" />
                                    <span className="max-w-[24rem] truncate">{item.showTitle || t('mediaPlayerPage.back')}</span>
                                </button>
                            ) : null}
                            {item.type === 'episode' && item.parentRatingKey ? (
                                <button
                                    type="button"
                                    data-tv-item="1"
                                    data-tv-action="1"
                                    onClick={() => onOpenItem({ ratingKey: String(item.parentRatingKey), type: 'season', title: item.seasonTitle || '', thumb: item.thumb, art: item.art, showTitle: item.showTitle, canPlay: false } as PlayerItem)}
                                    className="light-on-media inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/50 px-4 py-2 text-sm font-bold text-white/90 backdrop-blur-md transition-colors hover:bg-black/65 focus:border-plex focus:text-white"
                                >
                                    <span className="max-w-[16rem] truncate">
                                        {item.seasonTitle || (item.parentIndex != null ? `Season ${item.parentIndex}` : t('mediaPlayerPage.seasons'))}
                                    </span>
                                </button>
                            ) : null}
                            {item.type === 'season' && item.parentRatingKey ? (
                                <button
                                    type="button"
                                    data-tv-item="1"
                                    data-tv-action="1"
                                    onClick={() => onOpenItem({ ratingKey: String(item.parentRatingKey), type: 'show', title: item.showTitle || '', thumb: item.thumb, art: item.art, canPlay: false } as PlayerItem)}
                                    className="light-on-media inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/50 px-4 py-2 text-sm font-bold text-white/90 backdrop-blur-md transition-colors hover:bg-black/65 focus:border-plex focus:text-white"
                                >
                                    <ArrowLeft className="h-4 w-4" />
                                    <span className="max-w-[24rem] truncate">{item.showTitle || t('mediaPlayerPage.back')}</span>
                                </button>
                            ) : null}
                        </div>
                    ) : null}

                    <div className={`media-details-hero-row flex flex-col items-start md:flex-row ${
                        isTvShell ? 'gap-5 md:gap-6 lg:gap-10' : 'gap-4 md:gap-5 lg:gap-8'
                    }`}>
                        <div className={`media-details-hero-poster w-full flex-shrink-0 flex flex-col gap-3 ${
                            item.type === 'episode'
                                ? (isTvShell ? 'md:w-[28.8rem] lg:w-[33.6rem]' : 'md:w-[26rem] lg:w-[30rem]')
                                : (isTvShell ? 'md:w-[19.2rem] lg:w-[21.6rem]' : 'md:w-[18rem] lg:w-[21rem]')
                        }`}>
                            <div className={`flex flex-col gap-3 md:gap-4 ${item.type === 'episode' ? 'items-stretch' : 'max-md:items-start md:items-stretch'}`}>
                                <div
                                    className={
                                        item.type === 'episode'
                                            ? `media-details-hero-poster-card player-poster-frame group relative aspect-video w-full max-md:hidden max-md:max-w-none sm:w-full ${isTvShell ? 'sm:max-w-[21.6rem]' : 'sm:max-w-[22rem]'} md:max-w-none flex-shrink-0 overflow-hidden rounded-[12px] border border-white/15 bg-black/50 ring-1 ring-white/10 outline-none`
                                            : musicItem
                                                ? `media-details-hero-poster-card player-poster-frame group relative aspect-square w-[50%] max-w-[14.4rem] max-md:mx-auto max-md:w-[11.25rem] max-md:max-w-[11.25rem] ${isTvShell ? 'sm:max-w-[16.8rem]' : 'sm:max-w-[18rem]'} md:w-full md:max-w-none flex-shrink-0 overflow-hidden rounded-[12px] border border-white/15 bg-black/50 ring-1 ring-white/10 outline-none`
                                                : `media-details-hero-poster-card player-poster-frame group relative aspect-[2/3] w-[50%] max-w-[14.4rem] max-md:hidden max-md:mx-auto max-md:w-[11.25rem] max-md:max-w-[11.25rem] ${isTvShell ? 'sm:max-w-[16.8rem]' : 'sm:max-w-[18rem]'} md:w-full md:max-w-none flex-shrink-0 overflow-hidden rounded-[12px] border border-white/15 bg-black/50 ring-1 ring-white/10 outline-none`
                                    }
                                >
                                    <div data-tv-poster="1" className="pointer-events-none absolute inset-0 z-[5] rounded-[inherit]" aria-hidden />
                                    <div className="absolute -inset-4 bg-plex/10 blur-3xl opacity-40 pointer-events-none" />
                                    {posterUrl && !posterFailed ? (
                                        <img
                                            key={posterUrl}
                                            src={posterUrl}
                                            alt=""
                                            className={`absolute inset-0 z-0 h-full w-full object-cover transition-opacity duration-500 ease-out ${
                                                posterReady ? 'opacity-100' : 'opacity-0'
                                            }`}
                                            ref={(node) => {
                                                if (node?.complete && node.naturalWidth > 0) setPosterReady(true);
                                            }}
                                            onLoad={(event) => {
                                                if (event.currentTarget.getAttribute('src') !== posterUrl) return;
                                                if (event.currentTarget.naturalWidth > 0) setPosterReady(true);
                                            }}
                                            onError={(event) => {
                                                if (event.currentTarget.getAttribute('src') !== posterUrl) return;
                                                setPosterFailed(true);
                                            }}
                                        />
                                    ) : null}
                                    {showPosterPulse ? (
                                        <div className="absolute inset-0 z-[1] animate-pulse bg-white/10" aria-hidden />
                                    ) : null}
                                    {showMissingPoster ? (
                                        <NoPosterPlaceholder />
                                    ) : null}
                                    {item.watched ? (
                                        <span
                                            title={t('mediaPlayerPage.watched')}
                                            className={posterTickClass}
                                        >
                                            <Check className="h-3.5 w-3.5 stroke-[2.5]" />
                                        </span>
                                    ) : null}
                                    {progressPercent(playbackItem) > 0 ? (
                                        <div className="player-watch-bar absolute inset-x-0 bottom-0 z-[6] h-1 bg-black/70">
                                            <div className="h-full bg-plex" style={{ width: `${progressPercent(playbackItem)}%` }} />
                                        </div>
                                    ) : null}
                                    {item.themeKey && settings.playThemeTunes ? (
                                        <div className="relative z-10">
                                            <MediaPlayerThemeTune
                                                themeKey={item.themeKey}
                                                enabled
                                                paused={playing || playbackActive}
                                                playLabel={t('mediaPlayerPage.playTheme')}
                                                muteLabel={t('mediaPlayerPage.mute')}
                                                unmuteLabel={t('mediaPlayerPage.unmute')}
                                            />
                                        </div>
                                    ) : null}
                                </div>
                                {isBillboardTitle ? null : (
                                    <div className="media-details-title-mobile light-on-media w-full min-w-0 flex flex-col items-start justify-start gap-2 md:hidden">
                                        {titleBlock}
                                    </div>
                                )}
                            </div>
                            {typeAndGenres ? (
                                <div className={`media-details-kicker-row light-on-media flex w-full justify-center ${isBillboardTitle ? 'max-md:hidden' : ''}`}>
                                    {typeAndGenres}
                                </div>
                            ) : null}
                        </div>

                        <div className="media-details-hero-info flex-1 min-w-0 flex flex-col gap-4 pb-2">
                            <div className="media-details-title-desktop light-on-media hidden md:flex flex-col items-start gap-2.5">
                                {titleBlock}
                            </div>
                            <div className="pointer-events-none h-0 w-full shrink-0" data-tv-fade-anchor="1" aria-hidden />
                            <div className="media-details-panel flex w-full min-w-0 flex-col gap-5">
                                <div className="media-details-synopsis">
                                {hubSummary ? (
                                    <OverviewSummary text={hubSummary} />
                                ) : loading ? (
                                    <div className="space-y-2 max-w-xl" aria-hidden="true">
                                        <div className="h-4 w-full rounded bg-white/10 animate-pulse" />
                                        <div className="h-4 w-5/6 rounded bg-white/10 animate-pulse" />
                                        <div className="h-4 w-2/3 rounded bg-white/10 animate-pulse" />
                                    </div>
                                ) : musicItem ? null : (
                                    <OverviewSummary text={t('media.noDescription')} />
                                )}
                                </div>
                                {phoneUi && didYouKnowWidget ? (
                                    <div className="media-details-did-you-know">{didYouKnowWidget}</div>
                                ) : null}
                                {item.type !== 'episode' ? (
                                <>
                                {(canPlay
                                    || (item.versions || []).length > 1
                                    || trailer
                                    || item.mediaInfo?.length
                                    || (!loading && (
                                        item.type === 'movie'
                                        || item.type === 'episode'
                                        || item.type === 'show'
                                        || item.type === 'season'
                                    ))
                                ) ? (
                                    <div className="media-details-actions flex flex-col gap-2">
                                        <div className="relative z-20 flex flex-wrap items-center gap-2 overflow-visible" data-tv-rail="1" data-tv-row="1" data-tv-row-id={`actions:${item.ratingKey}`} data-tv-action-row="1">
                                            {canPlay ? (
                                                <button
                                                    type="button"
                                                    data-tv-item="1"
                                                    data-tv-action="1"
                                                    data-tv-play="1"
                                                    data-tv-key={`play:${item.ratingKey}`}
                                                    onClick={onPlayPress}
                                                    disabled={playing || playbackActive}
                                                    className={playButtonClass}
                                                >
                                                    {playing || playbackActive ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4 fill-current" />}
                                                    {actionPlayLabel}
                                                </button>
                                            ) : null}
                                            {tvTrailerButton}
                                            {playNextButton}
                                            <div className="media-details-action-chips">
                                            {shuffleChip}
                                            {!isTvShell && trailer ? (
                                                <button
                                                    type="button"
                                                    data-tv-item="1"
                                                    data-tv-action="1"
                                                    data-tv-key={`trailer:${item.ratingKey}`}
                                                    onClick={() => onPlay(trailer, { offsetMs: 0, skipResume: true })}
                                                    disabled={playing || playbackActive}
                                                    title={t('mediaPlayerPage.trailer')}
                                                    aria-label={t('mediaPlayerPage.trailer')}
                                                    className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/15 bg-white/5 text-white transition-colors hover:border-plex/40 hover:bg-white/10 disabled:opacity-50"
                                                >
                                                    <Film className="h-4 w-4" />
                                                    <span className="media-details-action-label">{t('mediaPlayerPage.trailer')}</span>
                                                </button>
                                            ) : null}
                                            {watchlistChip}
                                            {item.type === 'movie' || item.type === 'episode' || item.type === 'show' || item.type === 'season' ? (
                                                <button
                                                    type="button"
                                                    data-tv-item="1"
                                                    data-tv-action="1"
                                                    data-tv-key={`watched:${item.ratingKey}`}
                                                    onClick={onWatchedPress}
                                                    title={item.watched ? t('mediaPlayerPage.markUnwatched') : t('mediaPlayerPage.markWatched')}
                                                    aria-label={item.watched ? t('mediaPlayerPage.markUnwatched') : t('mediaPlayerPage.markWatched')}
                                                    className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/15 bg-white/5 text-white transition-colors hover:border-plex/40 hover:bg-white/10"
                                                >
                                                    {item.watched ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                                    <span className="media-details-action-label">{phoneUi ? actionWatchedLabel : (item.watched ? t('mediaPlayerPage.markUnwatched') : t('mediaPlayerPage.markWatched'))}</span>
                                                </button>
                                            ) : null}
                                            {settings.showPlaylists
                                                && (item.type === 'movie' || item.type === 'episode' || item.type === 'show' || item.type === 'season') ? (
                                                <div className="relative media-details-action-slot">
                                                    <button
                                                        type="button"
                                                        data-tv-item="1"
                                                        data-tv-action="1"
                                                        data-tv-key={`playlist:${item.ratingKey}`}
                                                        onClick={() => setPlaylistOpen((open) => !open)}
                                                        title={t('mediaPlayerPage.addToPlaylist')}
                                                        aria-label={t('mediaPlayerPage.addToPlaylist')}
                                                        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/15 bg-white/5 text-white transition-colors hover:border-plex/40 hover:bg-white/10"
                                                    >
                                                        <ListPlus className="h-4 w-4" />
                                                        <span className="media-details-action-label">{phoneUi ? actionPlaylistLabel : t('mediaPlayerPage.addToPlaylist')}</span>
                                                    </button>
                                                    {playlistOpen ? (
                                                        <div
                                                            className="player-popup-surface absolute right-0 z-20 mt-2 w-64 max-w-[min(18rem,calc(100vw-1.5rem))] max-h-64 overflow-y-auto rounded-xl border border-white/15 p-2 shadow-2xl"
                                                            data-tv-select-menu="1"
                                                        >
                                                            {playlists.map((playlist) => (
                                                                <button
                                                                    key={playlist.ratingKey}
                                                                    type="button"
                                                                    onClick={async () => {
                                                                        try {
                                                                            await addMediaPlayerPlaylistItem(playlist.ratingKey, item.ratingKey);
                                                                            setPlaylistMessage(t('mediaPlayerPage.addedToPlaylist', { name: playlist.title }));
                                                                            setPlaylistOpen(false);
                                                                        } catch {
                                                                            setPlaylistMessage(t('mediaPlayerPage.playError'));
                                                                        }
                                                                    }}
                                                                    className="block w-full rounded-lg px-3 py-2 text-left text-xs font-bold text-white hover:bg-white/10"
                                                                >
                                                                    {playlist.title}
                                                                </button>
                                                            ))}
                                                            <form
                                                                className="mt-2 flex gap-1"
                                                                onSubmit={async (event) => {
                                                                    event.preventDefault();
                                                                    const title = newPlaylistName.trim();
                                                                    if (!title) return;
                                                                    try {
                                                                        const created = await createMediaPlayerPlaylist(title, item.ratingKey);
                                                                        if (created.item?.ratingKey) {
                                                                            setPlaylists((prev) => [created.item, ...prev]);
                                                                        }
                                                                        setNewPlaylistName('');
                                                                        setPlaylistMessage(t('mediaPlayerPage.addedToPlaylist', { name: title }));
                                                                        setPlaylistOpen(false);
                                                                    } catch {
                                                                        setPlaylistMessage(t('mediaPlayerPage.playError'));
                                                                    }
                                                                }}
                                                            >
                                                                <input
                                                                    value={newPlaylistName}
                                                                    onChange={(event) => setNewPlaylistName(event.target.value)}
                                                                    placeholder={t('mediaPlayerPage.playlistName')}
                                                                    className="min-w-0 flex-1 rounded-lg border border-white/15 bg-white/5 px-2 py-1.5 text-xs text-white"
                                                                />
                                                                <button type="submit" className="rounded-lg bg-plex px-2 py-1.5 text-[10px] font-black text-black">
                                                                    {t('mediaPlayerPage.createPlaylist')}
                                                                </button>
                                                            </form>
                                                        </div>
                                                    ) : null}
                                                </div>
                                            ) : null}
                                            {item.type === 'movie' || item.type === 'episode' ? (
                                                <button
                                                    type="button"
                                                    data-tv-item="1"
                                                    data-tv-action="1"
                                                    data-tv-key={`info:${item.ratingKey}`}
                                                    onClick={() => setFileInfoOpen(true)}
                                                    title={t('mediaPlayerPage.fileInfo')}
                                                    aria-label={t('mediaPlayerPage.fileInfo')}
                                                    className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/15 bg-white/5 text-white transition-colors hover:border-plex/40 hover:bg-white/10"
                                                >
                                                    <Info className="h-4 w-4" />
                                                    <span className="media-details-action-label">{t('mediaPlayerPage.fileInfo')}</span>
                                                </button>
                                            ) : null}
                                            <PlayerItemMenu
                                                variant="toolbar"
                                                item={item}
                                                onOpenItem={onOpenItem}
                                                isAdmin={isAdmin}
                                                playlistsEnabled={playlistsEnabled && settings.showPlaylists}
                                                mediaIndex={mediaIndex}
                                                audioStreamId={audioStreamId}
                                                subtitleStreamId={subtitleStreamId}
                                                audioTracks={audioTrackOptions.map((row) => ({
                                                    id: String(row.id),
                                                    label: String(row.displayTitle || row.language || t('mediaPlayerPage.audio')),
                                                }))}
                                                subtitleTracks={subtitleTrackOptions.map((row) => ({
                                                    id: String(row.id),
                                                    label: String(row.displayTitle || row.language || t('mediaPlayerPage.subtitles')),
                                                }))}
                                                onAudioChange={onAudioTrackChange}
                                                onSubtitleChange={onSubtitleTrackChange}
                                                onPlay={onPlay}
                                                onPlayNext={onPlayNext}
                                                onWatchedChange={onWatchedChange}
                                                onDeleted={() => onBack()}
                                                onToast={onToast}
                                            />
                                            </div>
                                        </div>
                                        {settings.showPlaylists && playlistMessage ? (
                                            <p className="text-[11px] font-bold text-plex">{playlistMessage}</p>
                                        ) : null}
                                    </div>
                                ) : null}
                                {isBillboardTitle ? (
                                    <div className="media-details-billboard-meta light-on-media flex flex-col items-start gap-2 md:hidden">
                                        {seasonLabel ? (
                                            <p className="text-sm font-bold text-white/85">{seasonLabel}</p>
                                        ) : null}
                                        {titleMetaBlock}
                                    </div>
                                ) : null}
                                {phoneUi && (item.type === 'show' || item.type === 'season') ? null : (
                                <OverviewFacts
                                    item={item}
                                    onOpenPerson={onOpenPerson}
                                    onOpenItem={onOpenItem}
                                    onOpenStudio={onOpenStudio}
                                    aside={phoneUi ? null : didYouKnowWidget}
                                />
                                )}
                                {phoneUi && (item.type === 'show' || item.type === 'season') ? null : <OverviewLinks item={item} />}
                                {mediaInfoSection}
                                </>
                                ) : null}
                            </div>
                        </div>
                    </div>

                    {item.type === 'episode' ? (
                    <div className="media-details-episode-play media-details-panel mt-5 flex w-full min-w-0 flex-col gap-5">
                        {(canPlay
                            || (item.versions || []).length > 1
                            || trailer
                            || item.mediaInfo?.length
                            || !loading
                        ) ? (
                            <div className="media-details-actions flex flex-col gap-2">
                                <div className="relative z-20 flex flex-wrap items-center gap-2 overflow-visible" data-tv-rail="1" data-tv-row="1" data-tv-row-id={`actions:${item.ratingKey}`} data-tv-action-row="1">
                                    {canPlay ? (
                                        <button
                                            type="button"
                                            data-tv-item="1"
                                            data-tv-action="1"
                                            data-tv-play="1"
                                            data-tv-key={`play:${item.ratingKey}`}
                                            onClick={onPlayPress}
                                            disabled={playing || playbackActive}
                                            className={playButtonClass}
                                        >
                                            {playing || playbackActive ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4 fill-current" />}
                                            {actionPlayLabel}
                                        </button>
                                    ) : null}
                                    {tvTrailerButton}
                                    {playNextButton}
                                    <div className="media-details-action-chips">
                                    {shuffleChip}
                                    {!isTvShell && trailer ? (
                                        <button
                                            type="button"
                                            data-tv-item="1"
                                            data-tv-action="1"
                                            data-tv-key={`trailer:${item.ratingKey}`}
                                            onClick={() => onPlay(trailer, { offsetMs: 0, skipResume: true })}
                                            disabled={playing || playbackActive}
                                            title={t('mediaPlayerPage.trailer')}
                                            aria-label={t('mediaPlayerPage.trailer')}
                                            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/15 bg-white/5 text-white transition-colors hover:border-plex/40 hover:bg-white/10 disabled:opacity-50"
                                        >
                                            <Film className="h-4 w-4" />
                                            <span className="media-details-action-label">{t('mediaPlayerPage.trailer')}</span>
                                        </button>
                                    ) : null}
                                    {watchlistChip}
                                    <button
                                        type="button"
                                        data-tv-item="1"
                                        data-tv-action="1"
                                        data-tv-key={`watched:${item.ratingKey}`}
                                        onClick={async () => {
                                            const next = !item.watched;
                                            setItem({ ...item, watched: next });
                                            try {
                                                await setMediaPlayerWatched(item.ratingKey, next, item);
                                            } catch {
                                                setItem({ ...item, watched: item.watched });
                                            }
                                        }}
                                        title={item.watched ? t('mediaPlayerPage.markUnwatched') : t('mediaPlayerPage.markWatched')}
                                        aria-label={item.watched ? t('mediaPlayerPage.markUnwatched') : t('mediaPlayerPage.markWatched')}
                                        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/15 bg-white/5 text-white transition-colors hover:border-plex/40 hover:bg-white/10"
                                    >
                                        {item.watched ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                        <span className="media-details-action-label">{phoneUi ? actionWatchedLabel : (item.watched ? t('mediaPlayerPage.markUnwatched') : t('mediaPlayerPage.markWatched'))}</span>
                                    </button>
                                    {settings.showPlaylists ? (
                                        <div className="relative media-details-action-slot">
                                            <button
                                                type="button"
                                                data-tv-item="1"
                                                data-tv-action="1"
                                                data-tv-key={`playlist:${item.ratingKey}`}
                                                onClick={() => setPlaylistOpen((open) => !open)}
                                                title={t('mediaPlayerPage.addToPlaylist')}
                                                aria-label={t('mediaPlayerPage.addToPlaylist')}
                                                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/15 bg-white/5 text-white transition-colors hover:border-plex/40 hover:bg-white/10"
                                            >
                                                <ListPlus className="h-4 w-4" />
                                                <span className="media-details-action-label">{phoneUi ? actionPlaylistLabel : t('mediaPlayerPage.addToPlaylist')}</span>
                                            </button>
                                            {playlistOpen ? (
                                                <div
                                                    className="player-popup-surface absolute right-0 z-20 mt-2 w-64 max-w-[min(18rem,calc(100vw-1.5rem))] max-h-64 overflow-y-auto rounded-xl border border-white/15 p-2 shadow-2xl"
                                                    data-tv-select-menu="1"
                                                >
                                                    {playlists.map((playlist) => (
                                                        <button
                                                            key={playlist.ratingKey}
                                                            type="button"
                                                            onClick={async () => {
                                                                try {
                                                                    await addMediaPlayerPlaylistItem(playlist.ratingKey, item.ratingKey);
                                                                    setPlaylistMessage(t('mediaPlayerPage.addedToPlaylist', { name: playlist.title }));
                                                                    setPlaylistOpen(false);
                                                                } catch {
                                                                    setPlaylistMessage(t('mediaPlayerPage.playError'));
                                                                }
                                                            }}
                                                            className="block w-full rounded-lg px-3 py-2 text-left text-xs font-bold text-white hover:bg-white/10"
                                                        >
                                                            {playlist.title}
                                                        </button>
                                                    ))}
                                                    <form
                                                        className="mt-2 flex gap-1"
                                                        onSubmit={async (event) => {
                                                            event.preventDefault();
                                                            const title = newPlaylistName.trim();
                                                            if (!title) return;
                                                            try {
                                                                const created = await createMediaPlayerPlaylist(title, item.ratingKey);
                                                                if (created.item?.ratingKey) {
                                                                    setPlaylists((prev) => [created.item, ...prev]);
                                                                }
                                                                setNewPlaylistName('');
                                                                setPlaylistMessage(t('mediaPlayerPage.addedToPlaylist', { name: title }));
                                                                setPlaylistOpen(false);
                                                            } catch {
                                                                setPlaylistMessage(t('mediaPlayerPage.playError'));
                                                            }
                                                        }}
                                                    >
                                                        <input
                                                            value={newPlaylistName}
                                                            onChange={(event) => setNewPlaylistName(event.target.value)}
                                                            placeholder={t('mediaPlayerPage.playlistName')}
                                                            className="min-w-0 flex-1 rounded-lg border border-white/15 bg-white/5 px-2 py-1.5 text-xs text-white"
                                                        />
                                                        <button type="submit" className="rounded-lg bg-plex px-2 py-1.5 text-[10px] font-black text-black">
                                                            {t('mediaPlayerPage.createPlaylist')}
                                                        </button>
                                                    </form>
                                                </div>
                                            ) : null}
                                        </div>
                                    ) : null}
                                    <button
                                        type="button"
                                        data-tv-item="1"
                                        data-tv-action="1"
                                        data-tv-key={`info:${item.ratingKey}`}
                                        onClick={() => setFileInfoOpen(true)}
                                        title={t('mediaPlayerPage.fileInfo')}
                                        aria-label={t('mediaPlayerPage.fileInfo')}
                                        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/15 bg-white/5 text-white transition-colors hover:border-plex/40 hover:bg-white/10"
                                    >
                                        <Info className="h-4 w-4" />
                                        <span className="media-details-action-label">{t('mediaPlayerPage.fileInfo')}</span>
                                    </button>
                                    <PlayerItemMenu
                                        variant="toolbar"
                                        item={item}
                                        onOpenItem={onOpenItem}
                                        isAdmin={isAdmin}
                                        playlistsEnabled={playlistsEnabled && settings.showPlaylists}
                                        mediaIndex={mediaIndex}
                                        audioStreamId={audioStreamId}
                                        subtitleStreamId={subtitleStreamId}
                                        audioTracks={audioTrackOptions.map((row) => ({
                                            id: String(row.id),
                                            label: String(row.displayTitle || row.language || t('mediaPlayerPage.audio')),
                                        }))}
                                        subtitleTracks={subtitleTrackOptions.map((row) => ({
                                            id: String(row.id),
                                            label: String(row.displayTitle || row.language || t('mediaPlayerPage.subtitles')),
                                        }))}
                                        onAudioChange={onAudioTrackChange}
                                        onSubtitleChange={onSubtitleTrackChange}
                                        onPlay={onPlay}
                                        onPlayNext={onPlayNext}
                                        onWatchedChange={onWatchedChange}
                                        onDeleted={() => onBack()}
                                        onToast={onToast}
                                    />
                                    </div>
                                </div>
                                {settings.showPlaylists && playlistMessage ? (
                                    <p className="text-[11px] font-bold text-plex">{playlistMessage}</p>
                                ) : null}
                            </div>
                        ) : null}
                        {phoneUi ? mediaInfoSection : (
                        <OverviewFacts
                            item={item}
                            onOpenPerson={onOpenPerson}
                            onOpenItem={onOpenItem}
                            onOpenStudio={onOpenStudio}
                            aside={
                                <OverviewFactsSpotlight
                                    item={item}
                                    onOpenStudio={onOpenStudio}
                                    factMediaType={null}
                                    factMediaId={0}
                                    factTitle={factTitle}
                                    previous={neighbors.previous}
                                    next={neighbors.next}
                                    onOpenItem={onOpenItem}
                                    onPlayNeighbor={(row) => onPlay(row)}
                                />
                            }
                            underDetails={mediaInfoSection}
                        />
                        )}
                        {phoneUi ? null : <OverviewLinks item={item} />}
                        {phoneUi ? null : (
                        <p className="player-episode-swipe-hint md:hidden text-center text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">
                            {t('mediaPlayerPage.swipeEpisodesHint')}
                        </p>
                        )}
                    </div>
                    ) : null}

                    {!isTvShell && loading && !children.length && (item.type === 'show' || item.type === 'season') ? (
                        <div className="media-details-episodes mt-6" aria-busy="true" aria-label={t('mediaPlayerPage.loading')}>
                            <DiscoverHomeRowSkeleton />
                        </div>
                    ) : null}

                    {musicTracks.length ? (
                        <MediaPlayerMusicTracks
                            tracks={musicTracks}
                            activeKey={item.type === 'track' ? item.ratingKey : null}
                            onPlayTrack={(row) => onPlay(row, { playFromHere: true, skipResume: true, offsetMs: 0 })}
                        />
                    ) : null}

                    {musicAlbums.length ? (
                        <div className="mt-6">
                            <PlayerRail
                                title={t('mediaPlayerPage.albums')}
                                rowId={`albums:${item.ratingKey}`}
                                items={musicAlbums}
                                density={musicPosterDensity}
                                aspect="square"
                                onOpenItem={onOpenItem}
                                onPlay={onPlay}
                            />
                        </div>
                    ) : null}

                    {children.length && !isEpisodeGrid && !phoneListEpisodes.length && !musicItem ? (
                    <section className="media-details-seasons mt-6" data-tv-row="1" data-tv-row-id={`seasons:${item.ratingKey}`}>
                        <SectionHeading>
                            {isTvShell
                                ? t(children.length === 1 ? 'common.seasonCount' : 'common.seasonCount_plural', { count: children.length })
                                : t('mediaPlayerPage.seasons')}
                        </SectionHeading>
                        <Carousel posterRow flush>
                            {children.map((row) => {
                                const leaf = Number(row.leafCount || 0);
                                const viewed = Number(row.viewedLeafCount || 0);
                                const seasonWatched = Boolean(row.watched) || (leaf > 0 && viewed >= leaf);
                                return (
                                <div
                                    key={row.ratingKey}
                                    className="group w-[7.25rem] shrink-0 snap-start sm:w-[8.25rem] lg:w-[9rem]"
                                    data-tv-season-poster="1"
                                >
                                    <button
                                        type="button"
                                        data-tv-item="1"
                                        data-tv-season-poster-btn="1"
                                        data-tv-key={row.ratingKey}
                                        onClick={() => onOpenItem({
                                            ...row,
                                            thumb: row.thumb || item.thumb,
                                            art: row.art || item.art,
                                            showTitle: row.showTitle || item.title || item.showTitle,
                                        })}
                                        className="relative z-0 block w-full overflow-visible rounded-[12px] border-0 bg-transparent p-0 text-left outline-none"
                                        aria-label={row.title}
                                    >
                                        <div
                                            data-tv-season-art="1"
                                            className="player-poster-frame relative overflow-hidden rounded-[12px] border border-white/10 bg-black/30"
                                        >
                                            {row.thumb || item.thumb ? (
                                                <img
                                                    src={plexImageUrl(row.thumb || item.thumb, 300, 450, { quality: 60 })}
                                                    alt=""
                                                    className="aspect-[2/3] w-full object-cover transition-transform group-hover:scale-[1.03]"
                                                />
                                            ) : (
                                                <NoPosterPlaceholder />
                                            )}
                                            {seasonWatched ? (
                                                <span
                                                    title={t('mediaPlayerPage.watched')}
                                                    className={seasonTickClass}
                                                >
                                                    <Check className="h-3.5 w-3.5 stroke-[2.5]" />
                                                </span>
                                            ) : null}
                                        </div>
                                    </button>
                                    <div className="player-season-title mt-2.5 truncate text-sm font-bold text-text group-hover:text-plex sm:text-[0.95rem]">{row.title}</div>
                                    {row.leafCount ? (
                                        <div className="player-season-count mt-0.5 text-xs text-muted sm:text-[0.8rem]">{t('common.episodeCount', { count: row.leafCount })}</div>
                                    ) : null}
                                </div>
                                );
                            })}
                        </Carousel>
                    </section>
                    ) : null}

                    {phoneListEpisodes.length ? (
                    <PhoneEpisodeList
                        rows={phoneListEpisodes}
                        heading={t('mediaPlayerPage.episodeCountHeading', { count: phoneListEpisodes.length })}
                        locale={locale}
                        onOpenItem={onOpenItem}
                    />
                    ) : tvEpisodeRows.length ? (
                    <section className="media-details-episodes mt-6" data-tv-row="1" data-tv-row-id={`episodes:${item.ratingKey}`}>
                        {isTvShell ? null : (
                            <SectionHeading>{t('mediaPlayerPage.episodes')}</SectionHeading>
                        )}
                        <div className="media-details-episodes-stage">
                        {isTvShell && hubTechPills.length ? (
                            <div className="media-details-episode-tech">
                                {hubTechPills.map((pill) => (
                                    <span
                                        key={`${pill.key}-${pill.label}`}
                                        className={`player-file-pill player-file-pill--${pill.tone}`}
                                    >
                                        {pill.label}
                                    </span>
                                ))}
                            </div>
                        ) : null}
                        <div className="media-details-episodes-rail">
                        <Carousel posterRow flush>
                            {tvEpisodeRows.map((raw) => {
                                const row = raw.type === 'episode' ? applyRememberedProgress(raw) : raw;
                                const filePills = settings.showEpisodeFilePills ? fileInfoPills(row) : [];
                                const isCurrentEpisode = isTvShell && String(row.ratingKey) === String(spotlightKey || item.ratingKey);
                                return (
                                <div key={row.ratingKey} className={`media-details-episode-card group w-[17rem] shrink-0 snap-start sm:w-[20rem]${isCurrentEpisode ? ' is-current' : ''}`}>
                                    <button
                                        type="button"
                                        data-tv-item="1"
                                        data-tv-episode-btn="1"
                                        data-tv-watched={row.watched ? '1' : '0'}
                                        data-tv-key={row.ratingKey}
                                        onFocus={() => {
                                            if (isTvShell) setSpotlightKey(String(row.ratingKey));
                                        }}
                                        onClick={() => {
                                            if (isTvShell) {
                                                setSpotlightKey(String(row.ratingKey));
                                                return;
                                            }
                                            onOpenItem({
                                                ...row,
                                                thumb: row.thumb || item.thumb,
                                                art: row.art || item.art,
                                                showTitle: row.showTitle || item.title || item.showTitle,
                                            });
                                        }}
                                        className="relative z-0 block w-full overflow-visible rounded-[12px] border-0 bg-transparent p-0 text-left outline-none"
                                        aria-label={row.title}
                                    >
                                        <div
                                            data-tv-episode-art="1"
                                            className="player-poster-frame relative overflow-hidden rounded-[12px] border border-white/10 bg-black/30"
                                        >
                                            {row.thumb ? (
                                                <img
                                                    src={plexImageUrl(row.thumb, 720, 405, { quality: 60 })}
                                                    alt=""
                                                    className="aspect-video w-full object-cover transition-transform group-hover:scale-[1.03]"
                                                />
                                            ) : (
                                                <div className="flex aspect-video items-center justify-center text-[10px] font-bold uppercase tracking-widest text-muted">
                                                    {t('mediaPlayerPage.episodes')}
                                                </div>
                                            )}
                                            {isTvShell && row.index != null ? (
                                                <span className="player-episode-index">E{row.index}</span>
                                            ) : null}
                                            {isTvShell && isNewEpisodeBadge(row) ? (
                                                <span className="player-new-episode">{t('mediaPlayerPage.newEpisode')}</span>
                                            ) : null}
                                            {row.watched ? (
                                                <span
                                                    title={t('mediaPlayerPage.watched')}
                                                    className="player-watched-tick absolute right-1.5 top-1.5 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-plex text-zinc-950 shadow-md"
                                                >
                                                    <Check className="h-3 w-3 stroke-[2.5]" />
                                                </span>
                                            ) : null}
                                            {progressPercent(row) > 0 ? (
                                                <div className="player-watch-bar absolute inset-x-0 bottom-0 z-10 h-0.5 bg-black/50">
                                                    <div className="h-full bg-plex" style={{ width: `${progressPercent(row)}%` }} />
                                                </div>
                                            ) : null}
                                        </div>
                                    </button>
                                    <div className="player-episode-title mt-2 truncate text-sm font-bold text-text group-hover:text-plex group-focus-within:text-plex">{row.title}</div>
                                    {(row.index != null || row.durationMs) ? (
                                        <div className="player-episode-meta mt-0.5 truncate text-sm font-bold text-text">
                                            {row.index != null ? `Episode ${row.index}` : ''}
                                            {row.durationMs ? ` · ${formatPlayerDuration(row.durationMs)}` : ''}
                                        </div>
                                    ) : null}
                                    {filePills.length ? (
                                        <div
                                            className="player-file-pills"
                                            aria-label={filePills.map((pill) => pill.label).join(' ')}
                                        >
                                            {filePills.map((pill) => (
                                                <span
                                                    key={pill.key}
                                                    className={`player-file-pill player-file-pill--${pill.tone}`}
                                                >
                                                    {pill.label}
                                                </span>
                                            ))}
                                        </div>
                                    ) : null}
                                </div>
                                );
                            })}
                        </Carousel>
                        </div>
                        </div>
                    </section>
                    ) : null}
                    {isTvShell && (item.type === 'episode' || item.type === 'season') && hubCastPeople.length ? (
                    <section
                        className="media-details-episode-cast-wrap"
                        data-tv-row="1"
                        data-tv-row-id={`cast:${hubItem.ratingKey || item.ratingKey}`}
                    >
                        <h3 className="media-details-episode-cast-heading">{t('mediaPlayerPage.castAndCrew')}</h3>
                        <div className="media-details-episode-cast">
                            {hubCastPeople.slice(0, 12).map((actor) => (
                                <button
                                    key={`hub-cast-${actor.id || actor.name}`}
                                    type="button"
                                    data-tv-item="1"
                                    data-tv-cast="1"
                                    data-tv-key={`cast:${actor.id || actor.name}`}
                                    className="media-details-episode-cast-person"
                                    onClick={() => onOpenPerson({
                                        id: actor.id || actor.name,
                                        name: actor.name,
                                        thumb: actor.thumb,
                                    })}
                                >
                                    <CastAvatar name={actor.name} thumb={actor.thumb} />
                                    <span className="media-details-episode-cast-name">{actor.name}</span>
                                    {actor.role ? (
                                        <span className="media-details-episode-cast-role">{actor.role}</span>
                                    ) : null}
                                </button>
                            ))}
                        </div>
                    </section>
                    ) : null}
                </div>
            </div>

            <div className="media-details-lower media-details-inset relative z-10 w-full mt-2 md:mt-4 flex flex-col gap-8 md:gap-10 bg-transparent max-w-none mx-0 pr-6 xl:pr-10">

                {item.guestStars?.length && !(isTvShell && (item.type === 'episode' || item.type === 'season')) ? (
                    <section className="border-t border-border pt-8" data-tv-rail="1" data-tv-row="1" data-tv-row-id={`guests:${item.ratingKey}`}>
                        <SectionHeading>{t('mediaPlayerPage.guestStars')}</SectionHeading>
                        <Carousel>
                            {item.guestStars.slice(0, 15).map((actor) => (
                                <button
                                    key={`guest-${actor.id}-${actor.name}`}
                                    type="button"
                                    data-tv-item="1"
                                    data-tv-cast="1"
                                    onClick={() => onOpenPerson({
                                        id: actor.id || actor.name,
                                        name: actor.name,
                                        thumb: actor.thumb,
                                    })}
                                    className="group flex flex-col items-center gap-3 w-40 flex-shrink-0 snap-start text-center outline-none"
                                >
                                    <CastAvatar name={actor.name} thumb={actor.thumb} />
                                    <div className="w-full px-1">
                                        <div className="text-sm font-bold text-text leading-tight line-clamp-2 group-hover:text-plex">{actor.name}</div>
                                        {actor.role ? (
                                            <div className="text-xs text-muted mt-1 leading-snug line-clamp-2">{actor.role}</div>
                                        ) : null}
                                    </div>
                                </button>
                            ))}
                        </Carousel>
                    </section>
                ) : null}

                {cast.length && !(isTvShell && (item.type === 'episode' || item.type === 'season')) ? (
                    <section className="media-details-cast border-t border-border pt-8" data-tv-rail="1" data-tv-row="1" data-tv-row-id={`cast:${item.ratingKey}`}>
                        <SectionHeading>{phoneUi ? t('mediaPlayerPage.castAndCrew') : t('media.topCast')}</SectionHeading>
                        <Carousel>
                            {cast.slice(0, 15).map((actor) => (
                                <button
                                    key={`${actor.id}-${actor.name}`}
                                    type="button"
                                    data-tv-item="1"
                                    data-tv-cast="1"
                                    onClick={() => onOpenPerson({
                                        id: actor.id || actor.name,
                                        name: actor.name,
                                        thumb: actor.thumb,
                                    })}
                                    className="group flex flex-col items-center gap-3 w-40 flex-shrink-0 snap-start text-center outline-none"
                                >
                                    <CastAvatar name={actor.name} thumb={actor.thumb} />
                                    <div className="w-full px-1">
                                        <div className="text-sm font-bold text-text leading-tight line-clamp-2 group-hover:text-plex">{actor.name}</div>
                                        {actor.role ? (
                                            <div className="text-xs text-muted mt-1 leading-snug line-clamp-2">{actor.role}</div>
                                        ) : null}
                                    </div>
                                </button>
                            ))}
                        </Carousel>
                    </section>
                ) : null}

                {extras.length && !(isTvShell && (item.type === 'episode' || item.type === 'season')) ? (
                    <section className="border-t border-border pt-8" data-tv-rail="1" data-tv-row="1" data-tv-row-id={`extras:${item.ratingKey}`}>
                        <SectionHeading>{t('mediaPlayerPage.extras')}</SectionHeading>
                        <Carousel posterRow>
                            {extras.map((extra) => (
                                <div key={extra.ratingKey} className="media-details-extra-card group w-64 sm:w-72 flex-shrink-0 snap-start">
                                    <button
                                        type="button"
                                        data-tv-item="1"
                                        data-tv-extra-btn="1"
                                        data-tv-key={extra.ratingKey}
                                        onClick={() => onPlay(extra, { offsetMs: 0, skipResume: true })}
                                        className="relative z-0 block w-full overflow-visible rounded-[12px] border-0 bg-transparent p-0 text-left outline-none"
                                        aria-label={extra.title}
                                    >
                                        <div
                                            data-tv-extra-art="1"
                                            className="player-poster-frame relative overflow-hidden rounded-[12px] border border-white/10 bg-black/30"
                                        >
                                            {extra.thumb ? (
                                                <img
                                                    src={plexImageUrl(extra.thumb, 426, 240, { quality: 60 })}
                                                    alt=""
                                                    className="aspect-video w-full object-cover transition-transform group-hover:scale-[1.03]"
                                                />
                                            ) : (
                                                <div className="flex aspect-video items-center justify-center bg-white/5">
                                                    <Play className="h-8 w-8 text-white/70" />
                                                </div>
                                            )}
                                            <div className="absolute inset-0 flex items-center justify-center bg-black/35 opacity-0 transition-opacity group-hover:opacity-100">
                                                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-plex text-white shadow-lg">
                                                    <Play className="h-5 w-5 fill-current" />
                                                </span>
                                            </div>
                                        </div>
                                    </button>
                                    <div className="player-extra-title mt-2 truncate text-sm font-bold text-text group-hover:text-plex group-focus-within:text-plex">{extra.title}</div>
                                    <div className="player-extra-meta mt-0.5 text-sm text-muted sm:text-[0.95rem]">
                                        {isPlayerTrailer(extra) ? t('mediaPlayerPage.trailer') : (extra.extraSubtype || extra.type)}
                                        {extra.durationMs ? ` · ${formatPlayerDuration(extra.durationMs)}` : ''}
                                    </div>
                                </div>
                            ))}
                        </Carousel>
                    </section>
                ) : null}

                {related.length && !(isTvShell && (item.type === 'episode' || item.type === 'season')) ? (
                    <section className="media-details-related border-t border-border pt-8 pb-4 flex flex-col gap-8">
                        {related.map((hub) => (
                            <PlayerRail
                                key={hub.identifier || hub.title}
                                title={hub.title}
                                items={hub.items}
                                density={isPhoneDetailsUi() ? 6.75 : gridSize}
                                onOpenItem={onOpenItem}
                                onPlay={onPlay}
                            />
                        ))}
                    </section>
                ) : null}
            </div>
            {fileInfoOpen ? (
                <PlayerFileInfo
                    item={item}
                    mediaIndex={mediaIndex}
                    audioStreamId={audioStreamId}
                    onClose={() => setFileInfoOpen(false)}
                />
            ) : null}
            {versionPickerOpen ? (
                <div
                    className="fixed inset-0 z-[3500] flex items-center justify-center bg-black/70 p-4"
                    role="dialog"
                    aria-modal="true"
                    data-tv-version-dialog="1"
                >
                    <div className="player-version-sheet player-popup-surface w-full max-w-md rounded-2xl border border-white/10 p-5 shadow-2xl">
                        <p className="text-xs font-black uppercase tracking-widest text-muted">{t('mediaPlayerPage.selectVersion')}</p>
                        <h2 className="mt-2 text-lg font-bold text-text">{item.title}</h2>
                        <div className="mt-5 flex flex-col gap-2" data-tv-rail="1">
                            {versionChoices.map((row, index) => (
                                <button
                                    key={row.id || row.mediaIndex}
                                    type="button"
                                    data-tv-item="1"
                                    data-tv-action="1"
                                    data-tv-version-primary={index === 0 ? '1' : undefined}
                                    onClick={() => startPlay(row.mediaIndex)}
                                    className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-left text-sm font-bold text-text outline-none hover:border-plex/40 hover:bg-white/10"
                                >
                                    {versionChoiceLabel(row)}
                                </button>
                            ))}
                            <button
                                type="button"
                                data-tv-item="1"
                                data-tv-action="1"
                                onClick={() => setVersionPickerOpen(false)}
                                className="rounded-xl px-4 py-2.5 text-sm font-bold text-muted hover:text-text outline-none"
                            >
                                {t('common.close')}
                            </button>
                        </div>
                    </div>
                </div>
            ) : null}
            {heldMenuItem ? (
                <PlayerItemMenu
                    ref={heldMenuRef}
                    hideTrigger
                    item={heldMenuItem}
                    onOpenItem={onOpenItem}
                    onPlay={onPlay}
                    onPlayNext={onPlayNext}
                    isAdmin={isAdmin}
                    playlistsEnabled={playlistsEnabled && settings.showPlaylists}
                    onWatchedChange={onHeldWatchedChange}
                    onToast={onToast}
                />
            ) : null}
            {seasonWatchOpen && item?.type === 'season' ? (
                <PlayerSeasonWatchDialog
                    episodeCount={Number(item.leafCount || 0) || children.filter((row) => row.type === 'episode').length}
                    busy={seasonWatchBusy}
                    tvShell={isTvShell}
                    onConfirm={() => { void confirmSeasonWatched(); }}
                    onClose={() => { if (!seasonWatchBusy) setSeasonWatchOpen(false); }}
                />
            ) : null}
        </div>
    );
};
