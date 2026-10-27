import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Bookmark, BookmarkCheck, Calendar, Captions, Check, ChevronDown, ChevronUp, Clock, Eye, EyeOff, Film, Info, ListPlus, Loader2, Play, RotateCcw, Shuffle, SkipForward, Star, Users, Volume2, X } from 'lucide-react';
import { isWatchTogetherAvailable } from './watchTogetherClient';
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
import { addMediaPlayerPlaylistItem, createMediaPlayerPlaylist, fetchMediaPlayerItem, fetchMediaPlayerItemMore, fetchMediaPlayerNeighbors, fetchMediaPlayerPlaylists, fetchMediaPlayerWatchlist, pausePlayerBackgroundLoads, resumePlayerBackgroundLoads, setMediaPlayerWatched, setMediaPlayerWatchlisted, setSeasonEpisodesWatched } from './api';
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
import { PlayerServiceBrandMark } from './PlayerServiceBrandMark';
import { PlayerRail } from './PlayerRail';
import { MediaPlayerMusicTracks } from './MediaPlayerMusicTracks';
import { PlayerTvStatusPanel } from './PlayerTvStatusPanel';
import { watchedTickPositionClass } from './playerSettings';
import { usePlayerSettings } from './usePlayerSettings';
import {
    detectPlayerHdrLabel,
    formatBitrateMbps,
    formatEpisodeCode,
    fileInfoPills,
    formatMediaAudioLine,
    formatMediaVideoLine,
    formatPlayerDate,
    formatPlayerDuration,
    formatPlayerResolution,
    isFuturePlayerDate,
    playerHdrBadgeTitle,
    remainingWatchMs,
    type FileInfoPill,
    isPlayerTrailer,
    isMusicPlayerItem,
    MUSIC_NOW_PLAYING_EVENT,
    type MusicNowPlayingDetail,
    plexImageUrl,
    PLAYER_POSTER_QUALITY,
    resizePlexArtUrl,
    billboardBackdropFor,
    plexBackdropUrl,
    plexLogoUrl,
    applyRememberedProgress,
    PLAYER_PROGRESS_EVENT,
    progressPercent,
    shouldOfferResume,
    subtitleCodecNeedsBurn,
    watchTargetTouches,
    titleCaseProfile,
    withWatchedProgress,
} from './playerUtils';
import { focusSeasonEpisodeWhenReady, hasRememberedTvFocus, pinTvDetailsTop, revealTvEpisodeCard } from '../plex-client/useTvRemote';
import { readDocumentZoom } from '../shared/ui';
import { PLAYER_SCROLL_ID } from './paths';
import {
    DEFAULT_BACKDROP_SURFACE_RGB,
    formatTvDetailsBackdropPosition,
    formatWebDetailsBackdropPosition,
    peekImageFocalPoint,
    peekSurfaceColor,
    resolveImageFocalPoint,
    sampleBackdropSurfaceColor,
    samplePosterSurfaceColor,
} from '../shared/imageFocalPoint';
import {
    writePlayerScrollTop,
    PLAYER_METADATA_REFRESHED_EVENT,
    readPlayerItemCache,
    takePlayerItemSeed,
    writePlayerItemCache,
    readAvChoice,
    readMediaIndexChoice,
    resolveAvChoiceForTracks,
    writeAvChoiceFromTracks,
    writeMediaIndexChoice,
} from './playerMemory';
import type { PlayerItem, PlayerLibraryHub, PlayerMediaPartInfo, PlayerMediaStreamInfo, PlayerPlayOptions, PlayerRatings, PlayerVersion } from './types';
import { hideEpisodeSpoilers } from './spoilers';
import {
    TrailerPreview,
    TRAILER_COLLAPSE_EVENT,
    TRAILER_EXPAND_EVENT,
    TRAILER_TOGGLE_EVENT,
    type TrailerPreviewHandle,
} from './TrailerPreview';
import { softenSurfaceRgb, TV_FLOOR_RGB, tvTintSurfaceRgb } from './tvSurface';

/** Airdate text, orange when the episode hasn't aired yet. */
const airdateNode = (value: string | number | null | undefined, locale: string) => {
    const text = formatPlayerDate(value, locale);
    if (!text) return null;
    return isFuturePlayerDate(value)
        ? <span key="airdate" className="text-plex">{text}</span>
        : text;
};

/** Join meta bits (strings or nodes) with a separator, dropping empty ones. */
const joinMeta = (parts: React.ReactNode[], separator: string) => parts
    .filter((part) => part !== null && part !== undefined && part !== false && part !== '')
    .map((part, index) => (
        <React.Fragment key={index}>
            {index ? separator : null}
            {part}
        </React.Fragment>
    ));

const isPhoneDetailsUi = () => {
    try {
        return document.documentElement?.dataset?.phone === '1';
    } catch {
        return false;
    }
};


/** Horizontal-only rail pan. scrollIntoView also moves the page under CSS zoom. */
const panTvOverflowX = (scroller: HTMLElement, node: HTMLElement, mode: 'nearest' | 'center' = 'nearest') => {
    if (scroller.scrollWidth <= scroller.clientWidth + 8) return;
    const zoom = Math.max(0.01, readDocumentZoom());
    const s = scroller.getBoundingClientRect();
    const n = node.getBoundingClientRect();
    const left = scroller.scrollLeft + (n.left - s.left) / zoom;
    const width = n.width / zoom;
    const max = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
    if (mode === 'center') {
        scroller.scrollLeft = Math.max(0, Math.min(max, left + width / 2 - scroller.clientWidth / 2));
        return;
    }
    const peek = 72;
    let next = scroller.scrollLeft;
    if (left < scroller.scrollLeft + peek) next = Math.max(0, left - peek);
    else if (left + width + peek > scroller.scrollLeft + scroller.clientWidth) {
        next = Math.min(max, left + width + peek - scroller.clientWidth);
    }
    scroller.scrollLeft = next;
};

const episodeHasMediaInfo = (ep?: PlayerItem | null) => Boolean(
    ep?.mediaInfo?.[0]?.parts?.[0]?.video
    || ep?.mediaInfo?.[0]?.videoCodec,
);

const episodeTechPills = (ep?: PlayerItem | null): FileInfoPill[] => (
    ep ? fileInfoPills(ep).filter((pill) => pill.label) : []
);

const channelLayoutLabel = (channels?: number | null) => {
    const n = Number(channels || 0);
    if (n === 1) return 'Mono';
    if (n === 2) return '2.0';
    if (n === 6) return '5.1';
    if (n === 8) return '7.1';
    return n > 0 ? `${n}ch` : '';
};

const trackLanguage = (stream?: PlayerMediaStreamInfo | null) => (
    String(stream?.language || stream?.languageTag || '').trim()
);

const trackCodec = (stream?: PlayerMediaStreamInfo | null) => (
    String(stream?.codec || '').replace(/_/g, '-').toUpperCase()
);

type TrackChipPrefs = {
    audioLanguage?: string | null;
    subtitleMode?: string | null;
    burnSubtitles?: string | null;
};

/**
 * Plex-style "what will play" chips, e.g. "English (EAC3 5.1)" and "English (ASS)" / "Off".
 * They show what pressing the episode will actually play, picked the way playback picks:
 * the track you chose for this show in the player (saved per show), then the audio
 * language and subtitle mode settings, then Plex's own selection.
 */
const episodeTrackChips = (ep?: PlayerItem | null, prefs: TrackChipPrefs = {}) => {
    const part = ep?.mediaInfo?.[0]?.parts?.[0];
    // Season /children rows carry no streams until the spotlight fetch lands — don't claim "Off".
    if (!part || !(part.audio || []).length) return null;
    const audioRows = part.audio || [];
    const subRows = part.subtitles || [];
    const saved = readAvChoice(ep?.grandparentRatingKey || ep?.parentRatingKey, ep?.ratingKey);
    const resolved = resolveAvChoiceForTracks(
        saved,
        audioRows.filter((row) => row.id) as Array<{ id?: string | null; language?: string | null; languageTag?: string | null }>,
        subRows.filter((row) => row.id) as Array<{ id?: string | null; language?: string | null; languageTag?: string | null }>,
    );
    const byId = <T extends { id?: string | null }>(rows: T[], id?: string) => (
        id ? rows.find((row) => String(row.id || '') === String(id)) || null : null
    );
    const lang = String(prefs.audioLanguage || '').toLowerCase().trim();
    const langBase = lang.split(/[-_]/)[0];
    const audioByLang = lang
        ? audioRows.find((row) => {
            const blob = String(row.languageTag || row.language || '').toLowerCase();
            return blob === lang || (!!langBase && (blob.startsWith(langBase) || blob.includes(langBase)));
        }) || null
        : null;
    const audio = byId(audioRows, resolved.audioStreamId)
        || audioByLang
        || audioRows.find((row) => row.selected)
        || audioRows[0]
        || null;
    let sub: (typeof subRows)[number] | null = null;
    if (resolved.subtitleStreamId === '0') {
        sub = null;
    } else if (resolved.subtitleStreamId) {
        sub = byId(subRows, resolved.subtitleStreamId);
    } else {
        // Same default as starting playback: Plex's selection, then the Subtitles mode.
        const mode = String(prefs.subtitleMode || 'forced');
        const plexPick = subRows.find((row) => row.selected) || null;
        if (mode === 'off' || !subRows.length) sub = null;
        else if (plexPick) sub = plexPick;
        else sub = defaultSubtitleForMode(subRows, mode, prefs.burnSubtitles);
    }
    return trackChipLabels(audio, sub);
};

type ChipTrack = { codec?: string | null; channels?: number | null; language?: string | null; languageTag?: string | null; forced?: boolean | null };

/** "English (EAC3 5.1)" / "English Forced (PGS)" / "Off" for the chosen audio and subtitle. */
const trackChipLabels = (audio?: ChipTrack | null, sub?: ChipTrack | null) => {
    const audioDetail = [trackCodec(audio), channelLayoutLabel(audio?.channels)].filter(Boolean).join(' ');
    const audioLabel = audio
        ? [trackLanguage(audio) || 'Unknown', audioDetail ? `(${audioDetail})` : ''].filter(Boolean).join(' ')
        : '';
    const subName = sub ? [trackLanguage(sub) || 'Unknown', sub.forced ? 'Forced' : ''].filter(Boolean).join(' ') : '';
    const subLabel = sub ? [subName, trackCodec(sub) ? `(${trackCodec(sub)})` : ''].filter(Boolean).join(' ') : 'Off';
    return { audio: audioLabel, subtitles: subLabel };
};

/**
 * The subtitle the Subtitles setting picks when neither this app nor Plex chose one:
 * Always -> the first full track (not a forced-only one), text first; Forced -> a forced track;
 * Off -> none. Same rule as pickSubtitleId in plexDirect, so the page and playback agree.
 */
const defaultSubtitleForMode = <T extends { codec?: string | null; forced?: boolean | null }>(
    rows: T[],
    mode?: string | null,
    burnSubtitles?: string | null,
): T | null => {
    const value = String(mode || 'forced');
    if (value === 'off' || !rows.length) return null;
    const text = rows.filter((row) => !subtitleCodecNeedsBurn(row.codec, burnSubtitles || 'auto'));
    if (value === 'forced') return text.find((row) => row.forced) || rows.find((row) => row.forced) || null;
    return text.find((row) => !row.forced) || rows.find((row) => !row.forced) || text[0] || rows[0] || null;
};

/** tvTint: TV "Match page colour to artwork" is on. Off keeps the black #060a10 floor. */
const applyTvDetailsSurface = (rgb: string, tvTint = false) => {
    const tv = typeof document !== 'undefined' && (
        document.documentElement?.dataset?.tv === '1'
        || window.__PLEX_CLIENT__?.isTv === true
    );
    const tvSurface = tvTint ? tvTintSurfaceRgb(rgb) : TV_FLOOR_RGB;
    const softened = isPhoneDetailsUi() ? rgb : (tv ? tvSurface : softenSurfaceRgb(rgb));
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
    onOpenItem: (item: PlayerItem, opts?: { replace?: boolean }) => void;
    onOpenPerson: (person: { id: string; name: string; thumb?: string | null }) => void;
    onOpenStudio: (studio: { key: string; name: string; sectionKey?: string; mediaType?: 'movie' | 'show' }) => void;
    onPlay: (item: PlayerItem, opts?: PlayerPlayOptions) => void;
    onPlayNext?: (item: PlayerItem) => void;
    onWatchTogether?: (item: PlayerItem) => void;
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

/**
 * <img> that fades in once loaded — unless it is already in the cache, in which case it
 * shows on the first paint (the ref sees `complete` during commit), so nothing flashes.
 */
const FadeImg: React.FC<React.ImgHTMLAttributes<HTMLImageElement>> = ({ className = '', onLoad, src, ...rest }) => {
    const [loadedSrc, setLoadedSrc] = useState('');
    const key = String(src || '');
    const ref = useCallback((node: HTMLImageElement | null) => {
        if (node?.complete && node.naturalWidth > 0) setLoadedSrc(key);
    }, [key]);
    return (
        <img
            {...rest}
            ref={ref}
            src={src}
            decoding="async"
            className={`${className} player-fade-img${loadedSrc === key ? ' is-loaded' : ''}`}
            onLoad={(event) => {
                setLoadedSrc(key);
                onLoad?.(event);
            }}
        />
    );
};

const CastAvatar: React.FC<{ name: string; thumb?: string | null }> = ({ name, thumb }) => {
    const [failed, setFailed] = useState(false);
    useEffect(() => {
        setFailed(false);
    }, [thumb]);
    const src = thumb && !failed ? plexImageUrl(thumb, 240, 240, { quality: 60 }) : '';
    return (
        <div
            data-tv-cast-avatar="1"
            className="relative w-40 h-40 rounded-full bg-white/5 border-2 border-border overflow-hidden transition-transform group-hover:scale-[1.03] group-hover:border-plex"
        >
            {src ? (
                <FadeImg
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
    playLabel: string;
    resumeLabel: string;
    onPlayEpisode: (row: PlayerItem) => void;
    /** Per-show spoiler hiding: blur this episode's still. */
    hideSpoiler?: (row: PlayerItem) => boolean;
}> = ({ rows, heading, locale, playLabel, resumeLabel, onPlayEpisode, hideSpoiler }) => (
    <section className="media-details-episodes media-details-episode-list mt-2">
        <h3 className="mb-3 text-[1.05rem] font-black tracking-tight text-text">{heading}</h3>
        <div className="flex flex-col gap-3.5">
            {rows.map((raw) => {
                const row = applyRememberedProgress(raw);
                const aired = airdateNode(row.originallyAvailableAt, locale);
                const code = row.index != null ? `E${row.index}` : '';
                const action = shouldOfferResume(row) ? resumeLabel : playLabel;
                return (
                    <button
                        key={row.ratingKey}
                        type="button"
                        onClick={() => onPlayEpisode(row)}
                        className="flex w-full items-start gap-3 text-left"
                        aria-label={`${action}: ${row.title}`}
                    >
                        <div className="relative w-[7.4rem] shrink-0 overflow-hidden rounded-lg bg-black/40">
                            {row.thumb ? (
                                <FadeImg
                                    src={plexImageUrl(row.thumb, 320, 180, { quality: PLAYER_POSTER_QUALITY })}
                                    alt=""
                                    className={`aspect-video w-full object-cover${hideSpoiler?.(row) ? ' player-spoiler-img' : ''}`}
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
    onWatchTogether,
    onToast,
    isAdmin = false,
    playlistsEnabled = true,
    playing = false,
    playbackActive = false,
}) => {
    const { t, locale } = useDiscoverI18n();
    useEffect(() => {
        pausePlayerBackgroundLoads();
        return () => resumePlayerBackgroundLoads();
    }, []);
    const [settings] = usePlayerSettings();
    const [gridSize] = useDiscoverGridSize();
    const [item, setItem] = useState<PlayerItem | null>(() => {
        const cached = readPlayerItemCache(ratingKey, serverId);
        return cached?.item ? withWatchedProgress(cached.item, cached.children || []) : null;
    });
    const [children, setChildren] = useState<PlayerItem[]>(() => (
        (readPlayerItemCache(ratingKey, serverId)?.children || []).map((row) => applyRememberedProgress(row))
    ));
    const [extras, setExtras] = useState<PlayerItem[]>(() => readPlayerItemCache(ratingKey, serverId)?.extras || []);
    const [related, setRelated] = useState<PlayerLibraryHub[]>(() => readPlayerItemCache(ratingKey, serverId)?.related || []);
    const [onDeck, setOnDeck] = useState<PlayerItem | null>(() => readPlayerItemCache(ratingKey, serverId)?.onDeck ?? null);
    const [phoneSeasonEpisodes, setPhoneSeasonEpisodes] = useState<PlayerItem[] | null>(null);
    const [neighbors, setNeighbors] = useState<{ previous: PlayerItem | null; next: PlayerItem | null }>({ previous: null, next: null });
    const [nowPlayingTrackKey, setNowPlayingTrackKey] = useState<string | null>(null);
    const [showSeasons, setShowSeasons] = useState<PlayerItem[]>([]);
    const [seasonEpisodes, setSeasonEpisodes] = useState<PlayerItem[]>([]);
    const [spotlightKey, setSpotlightKey] = useState('');
    const [spotlightDetail, setSpotlightDetail] = useState<PlayerItem | null>(null);
    const openingSeasonRef = useRef('');
    const episodeDetailCache = useRef(new Map<string, PlayerItem>());
    const [loading, setLoading] = useState(() => !readPlayerItemCache(ratingKey, serverId)?.item);
    const [error, setError] = useState<string | null>(null);
    const [reloadToken, setReloadToken] = useState(0);
    const [posterFailed, setPosterFailed] = useState(false);
    const [phonePosterFailed, setPhonePosterFailed] = useState(false);
    const [backdropFailed, setBackdropFailed] = useState(false);
    const [posterReady, setPosterReady] = useState(false);
    const [backdropReady, setBackdropReady] = useState(false);
    const [hubArtFront, setHubArtFront] = useState('');
    const [hubArtBack, setHubArtBack] = useState('');
    const [hubArtFrontOn, setHubArtFrontOn] = useState(true);
    const hubArtCurrentRef = useRef('');
    const hubArtPendingRef = useRef('');
    const hubArtFrontOnRef = useRef(true);
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
    const spotlightFocusTimerRef = useRef(0);
    const heldMenuRef = useRef<PlayerItemMenuHandle | null>(null);
    const [heldMenuItem, setHeldMenuItem] = useState<PlayerItem | null>(null);
    const [heldMenuToken, setHeldMenuToken] = useState(0);
    const neighborsRef = useRef(neighbors);
    neighborsRef.current = neighbors;
    const isTvShell = typeof document !== 'undefined' && (
        document.documentElement?.dataset?.tv === '1'
        || window.__PLEX_CLIENT__?.isTv === true
    );
    // Opened from TV Home: the billboard art (and colour) already on screen for this title.
    // Same picture, so keep it instead of fetching Plex's other URL for it.
    const homeHandoff = useMemo(
        () => (isTvShell ? billboardBackdropFor(item?.ratingKey, item?.serverId || serverId) : null),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [isTvShell, item?.ratingKey, item?.serverId, serverId],
    );
    const handoffSurface = isTvShell && settings.detailsArtworkTint ? homeHandoff?.surface || null : null;
    const phoneUi = !isTvShell && isPhoneDetailsUi();

    useEffect(() => {
        const onNowPlaying = (event: Event) => {
            const detail = (event as CustomEvent<MusicNowPlayingDetail>).detail || null;
            const key = detail?.item?.ratingKey ? String(detail.item.ratingKey) : null;
            setNowPlayingTrackKey(key);
        };
        window.addEventListener(MUSIC_NOW_PLAYING_EVENT, onNowPlaying);
        return () => window.removeEventListener(MUSIC_NOW_PLAYING_EVENT, onNowPlaying);
    }, []);

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
        // TV episode / season pages: the button marks only the episode you are on. Marking a
        // whole season or show is in the season / show context menus.
        if (watchedTarget.type === 'episode' && watchedTarget !== item) {
            const episode = watchedTarget;
            const next = !episode.watched;
            const same = (row: PlayerItem) => String(row.ratingKey) === String(episode.ratingKey);
            const paint = (watched: boolean) => {
                const patch = (row: PlayerItem) => (same(row)
                    ? { ...row, watched, viewOffsetMs: watched ? 0 : row.viewOffsetMs }
                    : row);
                setSeasonEpisodes((rows) => rows.map(patch));
                setChildren((rows) => rows.map(patch));
                setSpotlightDetail((prev) => (prev && same(prev) ? patch(prev) : prev));
                setItem((prev) => {
                    if (!prev) return prev;
                    if (same(prev)) return patch(prev);
                    if (prev.type !== 'season') return prev;
                    const viewed = Math.max(0, Number(prev.viewedLeafCount || 0) + (watched ? 1 : -1));
                    return { ...prev, viewedLeafCount: viewed, watched: viewed >= Number(prev.leafCount || 0) };
                });
            };
            paint(next);
            void setMediaPlayerWatched(episode.ratingKey, next, episode).catch(() => {
                paint(!next);
                onToast?.(t('mediaPlayerPage.actionError'), 'error');
            });
            return;
        }
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
        const cached = readPlayerItemCache(ratingKey, serverId);
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
            writePlayerItemCache(ratingKey, { item: painted, children: [], extras: [], related: [], onDeck: null }, serverId);
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
        setHubArtFront('');
        setHubArtBack('');
        setHubArtFrontOn(true);
        hubArtCurrentRef.current = '';
        hubArtPendingRef.current = '';
        hubArtFrontOnRef.current = true;
        setLogoFailed(false);
        setLogoReady(false);
        setMediaIndex(readMediaIndexChoice(ratingKey) ?? 0);
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
        const onMetadataRefreshed = (event: Event) => {
            const detail = (event as CustomEvent<{ ratingKey?: string; item?: PlayerItem }>).detail;
            const key = String(detail?.ratingKey || '').trim();
            const next = detail?.item;
            if (!key || !next) return;
            if (String(ratingKey) !== key
                && String(item?.ratingKey || '') !== key
                && String(item?.grandparentRatingKey || '') !== key
                && String(item?.parentRatingKey || '') !== key) {
                return;
            }
            setItem((prev) => {
                if (!prev) return applyRememberedProgress(next);
                if (prev.type === 'episode' && next.type !== 'episode') {
                    return applyRememberedProgress({
                        ...prev,
                        thumb: next.thumb || prev.thumb,
                        art: next.art || prev.art,
                        logo: next.logo || prev.logo,
                        showTitle: next.title || prev.showTitle,
                        summary: next.summary || prev.summary,
                    });
                }
                return applyRememberedProgress({ ...prev, ...next, ratingKey: prev.ratingKey, type: prev.type });
            });
            void fetchMediaPlayerItem(ratingKey, { core: true, serverId: serverId || null })
                .then((data) => {
                    const rows = data.children || [];
                    setItem(applyRememberedProgress(withWatchedProgress(data.item, rows)));
                    setChildren(rows);
                })
                .catch(() => undefined);
        };
        window.addEventListener(PLAYER_METADATA_REFRESHED_EVENT, onMetadataRefreshed);
        return () => window.removeEventListener(PLAYER_METADATA_REFRESHED_EVENT, onMetadataRefreshed);
    }, [item?.grandparentRatingKey, item?.parentRatingKey, item?.ratingKey, ratingKey, serverId]);

    useEffect(() => {
        let cancelled = false;
        // Core first (title + seasons/episodes). Extras/related/on-deck land via /more,
        // which starts once core is in — firing both at once made /more's Plex calls
        // queue ahead of the episode list on the browser's few connections per server.
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
                const more = await fetchMediaPlayerItemMore(ratingKey, serverId || null).catch(() => null);
                if (cancelled || !more) return;
                if (more.extras?.length) setExtras(more.extras);
                setRelated(more.related || []);
                if (more.onDeck !== undefined) setOnDeck(more.onDeck || null);
                const prev = readPlayerItemCache(ratingKey, serverId);
                if (prev?.item) {
                    writePlayerItemCache(ratingKey, {
                        ...prev,
                        extras: more.extras?.length ? more.extras : (prev.extras || []),
                        related: more.related || [],
                        onDeck: more.onDeck !== undefined ? more.onDeck : prev.onDeck,
                    }, serverId);
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
                setShowSeasons((page.children || []).filter((row) => (
                    row.type === 'season'
                    && row.ratingKey
                    && Number(row.index) !== -1
                    && !/^all\s+episodes$/i.test(String(row.title || '').trim())
                )));
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
        const pillRail = activePill?.closest<HTMLElement>('.media-details-season-pills');
        if (activePill && pillRail) panTvOverflowX(pillRail, activePill, 'center');
        const focusKey = item.type === 'episode' ? String(item.ratingKey) : '';
        if (!focusKey) return;
        const currentEp = document.querySelector<HTMLElement>(
            `[data-tv-episode-btn="1"][data-tv-key="${focusKey.replace(/"/g, '')}"]`,
        );
        if (!currentEp) return;
        // Season list arriving mid-scrub must not yank the rail back to the page episode.
        const active = document.activeElement as HTMLElement | null;
        const focusedEp = active?.closest?.('[data-tv-episode-btn="1"]') as HTMLElement | null;
        if (focusedEp && focusedEp !== currentEp) return;
        revealTvEpisodeCard(currentEp);
    }, [isTvShell, item?.ratingKey, item?.type, showSeasons, seasonEpisodes]);

    // Held L/R remounts hub meta every focus — debounce so scrubbing stays smooth.
    const queueTvSpotlight = (key: string, immediate = false) => {
        if (!isTvShell) {
            setSpotlightKey(key);
            return;
        }
        if (spotlightFocusTimerRef.current) {
            window.clearTimeout(spotlightFocusTimerRef.current);
            spotlightFocusTimerRef.current = 0;
        }
        if (immediate) {
            setSpotlightKey(key);
            return;
        }
        spotlightFocusTimerRef.current = window.setTimeout(() => {
            spotlightFocusTimerRef.current = 0;
            setSpotlightKey(key);
        }, 90);
    };

    useEffect(() => () => {
        if (spotlightFocusTimerRef.current) window.clearTimeout(spotlightFocusTimerRef.current);
    }, []);

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
        if (!phoneUi || !settings.skipSingleSeason || item?.type !== 'show') {
            setPhoneSeasonEpisodes(null);
            return undefined;
        }
        const seasons = children.filter((row) => (
            row.type === 'season'
            && Number(row.index) !== -1
            && !/^all\s+episodes$/i.test(String(row.title || '').trim())
        ));
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
    }, [phoneUi, settings.skipSingleSeason, item?.type, item?.ratingKey, children, serverId]);

    // Non-phone: one-season shows can skip the seasons overview and open the episode hub.
    // Phone keeps the show page and lists episodes inline when this setting is on.
    const skipSingleSeasonRef = useRef<string | null>(null);
    useEffect(() => {
        if (phoneUi || !settings.skipSingleSeason || !item || item.type !== 'show') {
            if (item?.type !== 'show') skipSingleSeasonRef.current = null;
            return;
        }
        const seasons = children.filter((row) => (
            row.type === 'season'
            && row.ratingKey
            && Number(row.index) !== -1
            && !/^all\s+episodes$/i.test(String(row.title || '').trim())
        ));
        if (seasons.length !== 1) return;
        const season = seasons[0];
        const showKey = String(item.ratingKey || '');
        if (!showKey || skipSingleSeasonRef.current === showKey) return;
        skipSingleSeasonRef.current = showKey;
        onOpenItem({
            ...season,
            thumb: season.thumb || item.thumb,
            art: season.art || item.art,
            logo: season.logo || item.logo,
            showTitle: season.showTitle || item.title || item.showTitle,
            serverId: season.serverId || item.serverId || serverId || null,
        }, { replace: true });
    }, [phoneUi, settings.skipSingleSeason, item, children, onOpenItem, serverId]);

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
    // Trailer preview plays a real trailer only, never a featurette standing in for one.
    const previewTrailer = useMemo(() => extras.find(isPlayerTrailer) || null, [extras]);
    const trailerPreviewRef = useRef<TrailerPreviewHandle | null>(null);
    /**
     * With Trailer preview on, Trailer carries on the one already playing behind the page,
     * full screen from where it is. Otherwise (or before it has started) from the top.
     */
    const openTrailer = () => {
        if (!trailer) return;
        const carryOn = settings.trailerPreview
            && previewTrailer
            && String(previewTrailer.ratingKey) === String(trailer.ratingKey)
            ? trailerPreviewRef.current?.positionMs() ?? null
            : null;
        onPlay(trailer, { offsetMs: carryOn ?? 0, skipResume: true });
    };
    const [trailerPreviewPlaying, setTrailerPreviewPlaying] = useState(false);
    /** TV: Up from the Watch row takes the background trailer full screen, in place. */
    const [trailerExpanded, setTrailerExpanded] = useState(false);
    useEffect(() => {
        if (!trailerPreviewPlaying) setTrailerExpanded(false);
    }, [trailerPreviewPlaying]);
    useEffect(() => {
        if (!isTvShell) return undefined;
        const expand = () => { if (trailerPreviewPlaying) setTrailerExpanded(true); };
        const collapse = () => setTrailerExpanded(false);
        const toggle = () => trailerPreviewRef.current?.togglePause();
        window.addEventListener(TRAILER_EXPAND_EVENT, expand);
        window.addEventListener(TRAILER_COLLAPSE_EVENT, collapse);
        window.addEventListener(TRAILER_TOGGLE_EVENT, toggle);
        return () => {
            window.removeEventListener(TRAILER_EXPAND_EVENT, expand);
            window.removeEventListener(TRAILER_COLLAPSE_EVENT, collapse);
            window.removeEventListener(TRAILER_TOGGLE_EVENT, toggle);
        };
    }, [isTvShell, trailerPreviewPlaying]);
    useEffect(() => {
        const root = document.documentElement;
        if (trailerExpanded) root.dataset.trailerExpanded = '1';
        else delete root.dataset.trailerExpanded;
        return () => { delete root.dataset.trailerExpanded; };
    }, [trailerExpanded]);
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
        // Plex's pick for this title first, then the Subtitles setting (Always / Forced / Off):
        // a page that said Off with Subtitles set to Always also started playback without them.
        const preferredSub = subtitleTrackOptions.find((row) => row.selected)
            || defaultSubtitleForMode(subtitleTrackOptions, settings.subtitleMode, settings.burnSubtitles);
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
    }, [item?.ratingKey, mediaIndex, audioTrackOptions, subtitleTrackOptions, settings.subtitleMode, settings.burnSubtitles]);
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
    /** Version picker row: resolution tile, codec / HDR / audio line, bitrate. */
    const versionChoiceParts = (row: PlayerVersion) => {
        const source = onDeck || item;
        const media = (source?.mediaInfo || [])[row.mediaIndex];
        const resolution = row.resolution || formatPlayerResolution(row.height || media?.height, media?.videoResolution) || row.label;
        const hdr = detectPlayerHdrLabel({ mediaInfo: source?.mediaInfo, mediaIndex: row.mediaIndex });
        const codec = (value?: string | null) => String(value || '').trim().toUpperCase();
        const detail = [codec(row.videoCodec || media?.videoCodec), hdr, codec(row.audioCodec || media?.audioCodec), codec(row.container || media?.container)]
            .filter(Boolean)
            .join(' · ');
        return { resolution, detail, bitrate: formatBitrateMbps(row.bitrate || media?.bitrate) };
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
        writeMediaIndexChoice(ratingKey, index);
        onPlay(applyRememberedProgress(tvHubPlayTarget()), { ...playOpts, mediaIndex: index });
    };
    const playEpisodeTile = (row: PlayerItem) => {
        // Same as Watch/Resume for this episode — not a "play from here" season queue.
        const detailed = (
            (spotlightDetail && String(spotlightDetail.ratingKey) === String(row.ratingKey) ? spotlightDetail : null)
            || episodeDetailCache.current.get(String(row.ratingKey))
            || row
        );
        const playable = applyRememberedProgress({
            ...detailed,
            type: 'episode',
            thumb: detailed.thumb || row.thumb || item?.thumb,
            art: detailed.art || row.art || item?.art,
            showTitle: detailed.showTitle || row.showTitle || item?.title || item?.showTitle,
        });
        // Keep page AV picks only when activating the episode this page is already on.
        onPlay(
            playable,
            String(row.ratingKey) === String(item?.ratingKey) ? { ...playOpts } : undefined,
        );
    };
    const playNextNeighbor = neighbors.next;
    const onPlayPress = () => {
        if (versionChoices.length > 1) {
            setVersionPickerOpen(true);
            return;
        }
        if (item?.type === 'show' || item?.type === 'season') {
            onPlay(item);
            return;
        }
        startPlay(mediaIndex);
    };
    const onStartFromBeginning = () => {
        if (!item) return;
        setVersionPickerOpen(false);
        const target = applyRememberedProgress(tvHubPlayTarget());
        onPlay(target, {
            ...playOpts,
            skipResume: true,
            offsetMs: 0,
            playFromHere: target.type === 'episode',
        });
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
    const watchTogetherChip = item
        && onWatchTogether
        && isWatchTogetherAvailable()
        && (item.type === 'movie' || item.type === 'episode')
        && !isMusicPlayerItem(item)
        ? (
            <button
                type="button"
                data-tv-item="1"
                data-tv-action="1"
                data-tv-key={`watch-together:${item.ratingKey}`}
                onClick={() => onWatchTogether(item)}
                disabled={playing || playbackActive}
                title={t('mediaPlayerPage.watchTogether')}
                aria-label={t('mediaPlayerPage.watchTogether')}
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/15 bg-white/5 text-white transition-colors hover:border-plex/40 hover:bg-white/10 disabled:opacity-50"
            >
                <Users className="h-4 w-4" />
                <span className="media-details-action-label">{t('mediaPlayerPage.watchTogether')}</span>
            </button>
        ) : null;
    const tvTrailerButton = isTvShell && trailer && item ? (
        <button
            type="button"
            data-tv-item="1"
            data-tv-action="1"
            data-tv-trailer="1"
            data-tv-key={`trailer-label:${item.ratingKey}`}
            onClick={openTrailer}
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

    // A new title resets the image state. The same title re-rendering with full details
    // (often a slightly different thumb / art URL) must not: hiding the poster and backdrop
    // again is what made the page load, then visibly load a second time.
    const imageStateKeyRef = useRef('');
    const surfaceTitleRef = useRef('');
    useEffect(() => {
        const key = String(item?.ratingKey || '');
        const sameTitle = key && key === imageStateKeyRef.current;
        imageStateKeyRef.current = key;
        if (sameTitle) {
            setPosterFailed(false);
            setPhonePosterFailed(false);
            setBackdropFailed(false);
            return;
        }
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
            // Episode pages build their row from the season (seasonEpisodes), not `children`
            // (an episode has none) — without them a long-press on an episode card did nothing.
            const row = [...children, ...seasonEpisodes, ...extras].find((entry) => String(entry.ratingKey) === key);
            if (!row) return;
            detail.handled = true;
            setHeldMenuItem(applyRememberedProgress(row));
            setHeldMenuToken((n) => n + 1);
        };
        window.addEventListener('smp-tv-poster-menu', onOpen);
        return () => window.removeEventListener('smp-tv-poster-menu', onOpen);
    }, [isTvShell, children, seasonEpisodes, extras]);

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
        // Re-run when the season list arrives — entry focus often started before
        // episode buttons existed (Continue Watching → episode hub).
        if (seasonEntryFocusKey.current === `${item.ratingKey}:${episodeRows.length}`) return undefined;
        seasonEntryFocusKey.current = `${item.ratingKey}:${episodeRows.length}`;
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
        const url = homeHandoff?.url || plexBackdropUrl(item.art || item.thumb);
        if (!posterSampleUrl && !url) return undefined;
        let cancelled = false;
        let framed = false;
        // Movie / show pages tint here. Season and episode pages swap backdrops per
        // episode, so their tint follows episodeHubBackdropUrl in its own effect.
        const tvTint = isTvShell
            && settings.detailsArtworkTint
            && (item.type === 'movie' || item.type === 'show');
        // A colour sampled on an earlier visit paints now; the floor only when there is none.
        // Full details for the title already on screen keep its colour until re-sampled,
        // instead of flashing back to the floor.
        const knownSurface = (tvTint || !isTvShell) ? peekSurfaceColor(url || posterSampleUrl) : null;
        const sameTitle = surfaceTitleRef.current === String(item.ratingKey);
        surfaceTitleRef.current = String(item.ratingKey);
        if (handoffSurface) {
            // Home's fade was already this colour: carry it over rather than re-sample a
            // slightly different one a moment after the page opens.
            applyTvDetailsSurface(handoffSurface, true);
        } else if (knownSurface || !sameTitle) {
            applyTvDetailsSurface(knownSurface || (isTvShell ? TV_FLOOR_RGB : DEFAULT_BACKDROP_SURFACE_RGB), tvTint);
        }
        const artUrl = url;
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
            const sampleUrl = artUrl || posterSampleUrl;
            const frame = backdrop && backdrop.clientWidth > 2 && backdrop.clientHeight > 2
                ? { width: backdrop.clientWidth, height: backdrop.clientHeight, position }
                : undefined;
            const fromArt = await sampleBackdropSurfaceColor(sampleUrl, frame);
            if (!cancelled && fromArt) {
                applyTvDetailsSurface(fromArt, tvTint);
                return;
            }
            if (posterSampleUrl) {
                const fromPoster = await samplePosterSurfaceColor(posterSampleUrl);
                if (!cancelled && fromPoster) applyTvDetailsSurface(fromPoster, tvTint);
            }
        };
        const sampleWhenFramed = (position: string) => {
            // TV with the artwork tint off stays on the black floor: nothing to sample.
            if (isTvShell && (!tvTint || handoffSurface)) return;
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
    }, [isTvShell, item?.ratingKey, item?.type, item?.art, item?.thumb, settings.detailsArtworkTint, homeHandoff, handoffSurface]);

    // Before the first paint: frame the art and paint any known page colour, so neither
    // shifts in after the images load (the async effect above only refines them).
    useLayoutEffect(() => {
        if (!item?.ratingKey) return;
        const artUrl = homeHandoff?.url || plexBackdropUrl(item.art || item.thumb);
        const focal = peekImageFocalPoint(artUrl);
        const node = document.querySelector<HTMLElement>('[data-tv-details="1"]');
        if (focal && node) {
            const phone = isPhoneDetailsUi();
            const position = isTvShell
                ? formatTvDetailsBackdropPosition(focal)
                : phone
                    ? `${Math.min(60, Math.max(40, focal.x))}% 18%`
                    : formatWebDetailsBackdropPosition(focal);
            node.style.setProperty('--tv-backdrop-position', position);
            node.querySelector('.media-details-hero-backdrop')?.classList.add('is-framed');
        }
        const tvTint = isTvShell && settings.detailsArtworkTint && (item.type === 'movie' || item.type === 'show');
        const known = (tvTint || !isTvShell)
            ? peekSurfaceColor(artUrl || plexImageUrl(item.thumb, 160, 240, { quality: 40 }))
            : null;
        if (handoffSurface) applyTvDetailsSurface(handoffSurface, true);
        else if (known) applyTvDetailsSurface(known, tvTint);
    }, [isTvShell, item?.ratingKey, item?.type, item?.art, item?.thumb, settings.detailsArtworkTint, homeHandoff, handoffSurface]);

    useEffect(() => () => {
        clearTvDetailsSurface();
    }, []);

    const episodeHubBackdropUrl = useMemo(() => {
        if (!isTvShell || !item || (item.type !== 'episode' && item.type !== 'season')) return '';
        const rows = item.type === 'episode' && seasonEpisodes.length
            ? seasonEpisodes
            : children.filter((row) => row.type === 'episode');
        const spotlightRow = rows.find((row) => String(row.ratingKey) === String(spotlightKey)) || null;
        const hub = (
            (spotlightDetail && String(spotlightDetail.ratingKey) === String(spotlightKey) ? spotlightDetail : null)
            || spotlightRow
            || (item.type === 'episode' ? item : null)
        ) || item;
        if (homeHandoff && String(hub.ratingKey) === String(item.ratingKey)) return homeHandoff.url;
        return plexBackdropUrl(hub.art || hub.thumb || item.art || item.thumb) || '';
    }, [isTvShell, item, seasonEpisodes, children, spotlightKey, spotlightDetail, homeHandoff]);

    useEffect(() => {
        if (!episodeHubBackdropUrl) return;
        if (episodeHubBackdropUrl === hubArtCurrentRef.current) return;
        if (!hubArtCurrentRef.current) {
            setHubArtFront(episodeHubBackdropUrl);
            setHubArtBack('');
            hubArtFrontOnRef.current = true;
            setHubArtFrontOn(true);
            hubArtCurrentRef.current = episodeHubBackdropUrl;
            hubArtPendingRef.current = '';
            setBackdropReady(true);
            setBackdropFailed(false);
            return;
        }
        hubArtPendingRef.current = episodeHubBackdropUrl;
        const img = new Image();
        img.onload = () => {
            if (hubArtPendingRef.current !== episodeHubBackdropUrl) return;
            if (hubArtFrontOnRef.current) {
                setHubArtBack(episodeHubBackdropUrl);
                hubArtFrontOnRef.current = false;
                setHubArtFrontOn(false);
            } else {
                setHubArtFront(episodeHubBackdropUrl);
                hubArtFrontOnRef.current = true;
                setHubArtFrontOn(true);
            }
            hubArtCurrentRef.current = episodeHubBackdropUrl;
            setBackdropReady(true);
            setBackdropFailed(false);
        };
        img.onerror = () => {
            if (hubArtPendingRef.current !== episodeHubBackdropUrl) return;
            hubArtPendingRef.current = '';
            setBackdropFailed(true);
        };
        img.src = episodeHubBackdropUrl;
    }, [episodeHubBackdropUrl]);

    // Season / episode pages: the backdrop follows the spotlighted episode, so the
    // artwork tint follows it too. Short delay so scrolling episodes does not resample each step.
    useEffect(() => {
        if (!isTvShell || !settings.detailsArtworkTint || !episodeHubBackdropUrl) return undefined;
        if (handoffSurface && episodeHubBackdropUrl === homeHandoff?.url) {
            applyTvDetailsSurface(handoffSurface, true);
            return undefined;
        }
        let cancelled = false;
        const timer = window.setTimeout(() => {
            const node = document.querySelector<HTMLElement>('[data-tv-details="1"]');
            const backdrop = node?.querySelector<HTMLElement>('.media-details-hero-backdrop');
            const position = node?.style.getPropertyValue('--tv-backdrop-position') || undefined;
            const frame = backdrop && backdrop.clientWidth > 2 && backdrop.clientHeight > 2
                ? { width: backdrop.clientWidth, height: backdrop.clientHeight, position }
                : undefined;
            void sampleBackdropSurfaceColor(episodeHubBackdropUrl, frame).then((rgb) => {
                if (!cancelled && rgb) applyTvDetailsSurface(rgb, true);
            });
        }, 350);
        return () => {
            cancelled = true;
            window.clearTimeout(timer);
        };
    }, [isTvShell, settings.detailsArtworkTint, episodeHubBackdropUrl, homeHandoff, handoffSurface]);

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
    const isEpisodeHub = isTvShell && (item.type === 'episode' || item.type === 'season');
    /** What the watched button marks: the focused episode on TV episode / season pages. */
    const watchedTarget = isEpisodeHub && hubItem.type === 'episode' ? hubItem : item;
    const backdropUrl = episodeHubBackdropUrl || homeHandoff?.url || plexBackdropUrl(item.art || item.thumb);
    const hubTechPills = isTvShell && (item.type === 'episode' || item.type === 'season')
        ? episodeTechPills(hubItem)
        : [];
    const hubTrackChips = isTvShell && (item.type === 'episode' || item.type === 'season')
        ? episodeTrackChips(hubItem, {
            audioLanguage: settings.audioLanguage,
            subtitleMode: settings.subtitleMode,
            burnSubtitles: settings.burnSubtitles,
        })
        : null;
    /** TV movie pages: the same file / track pills as episode pages, at the end of the Watch row. */
    const movieTechPills = isTvShell && item.type === 'movie' ? episodeTechPills(item) : [];
    // What this page will play: the audio / subtitle chosen here (Plex's selection by default).
    const movieTrackChips = movieTechPills.length
        ? trackChipLabels(
            audioTrackOptions.find((row) => String(row.id) === String(audioStreamId)) || audioTrackOptions[0] || null,
            subtitleTrackOptions.find((row) => String(row.id) === String(subtitleStreamId)) || null,
        )
        : null;
    const hubSpoilerHidden = hideEpisodeSpoilers(settings, hubItem.type === 'episode' ? hubItem : null);
    const hubSummary = hubSpoilerHidden
        ? t('mediaPlayerPage.spoilerSummaryHidden')
        : (isTvShell && (item.type === 'episode' || item.type === 'season')
            ? (hubItem.type === 'episode' ? String(hubItem.summary || '') : '')
            : String(hubItem.summary || item.summary || ''));
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
    const showStartFromBeginning = playLabel === t('mediaPlayerPage.resume');
    const startOverButtonClass = isTvShell
        ? 'inline-flex h-11 items-center justify-center gap-2 rounded-full border border-white/20 bg-white/5 px-4 text-sm font-bold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50'
        : 'inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 text-sm font-bold text-white transition-colors hover:border-plex/40 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50 max-md:w-full';
    const startOverButton = showStartFromBeginning ? (
        <button
            type="button"
            data-tv-item="1"
            data-tv-action="1"
            data-tv-start-over="1"
            data-tv-key={`start-over:${item.ratingKey}`}
            onClick={onStartFromBeginning}
            disabled={playing || playbackActive}
            className={startOverButtonClass}
        >
            <RotateCcw className="h-4 w-4" />
            {t('mediaPlayerPage.startFromBeginning')}
        </button>
    ) : null;
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
        item.commonSenseMedia?.ageLabel
            ? {
                icon: (
                    <img
                        src="/static/logos/common-sense-media.png"
                        alt=""
                        className="h-3.5 w-3.5 object-contain object-center"
                        aria-hidden
                    />
                ),
                label: item.commonSenseMedia.ageLabel,
                title: item.commonSenseMedia.oneLiner
                    || `Common Sense Media${item.commonSenseMedia.stars != null ? ` · ${item.commonSenseMedia.stars}/5` : ''}`,
            }
            : null,
        (() => {
            const hdrItem = (onDeck?.mediaInfo?.length ? onDeck : item);
            const badge = detectPlayerHdrLabel({
                mediaInfo: hdrItem?.mediaInfo,
                mediaIndex,
            });
            if (!badge) return null;
            return {
                icon: null,
                label: badge,
                title: playerHdrBadgeTitle(badge),
            };
        })(),
    ].filter(Boolean) as Array<{ icon: React.ReactNode; label: string; title?: string }>;
    type MetaChip = { icon: React.ReactNode; label: string; title?: string };
    // TV episode / season pages: the same pills as a show page, for the episode in focus.
    const hubMetaChips: MetaChip[] = isTvShell && (item.type === 'episode' || item.type === 'season')
        ? ([
            hubItem.type === 'episode'
                ? { icon: null, label: formatEpisodeCode(hubItem) || (hubItem.index != null ? `E${hubItem.index}` : '') }
                : null,
            (hubItem.contentRating || item.contentRating)
                ? { icon: null, label: String(hubItem.contentRating || item.contentRating) }
                : null,
            hubItem.type === 'episode'
                ? (formatPlayerDate(hubItem.originallyAvailableAt, locale)
                    ? { icon: <Calendar className="h-3 w-3" />, label: formatPlayerDate(hubItem.originallyAvailableAt, locale) }
                    : null)
                : (hubItem.year ? { icon: <Calendar className="h-3 w-3" />, label: String(hubItem.year) } : null),
            hubItem.durationMs ? { icon: <Clock className="h-3 w-3" />, label: formatPlayerDuration(hubItem.durationMs) } : null,
            hubItem.type === 'season' && totalLeaves > 0
                ? { icon: null, label: t('mediaPlayerPage.episodeProgressValue', { watched: watchedLeaves, total: totalLeaves }) }
                : null,
            hubItem.audienceRating ? { icon: <Star className="h-3.5 w-3.5 text-plex" />, label: String(hubItem.audienceRating) } : null,
        ].filter((chip) => chip && chip.label) as MetaChip[])
        : [];
    const hubTmdbScore = hubItem.ratings?.tmdb?.percent != null ? `${hubItem.ratings.tmdb.percent}%` : null;
    const hubTvdbValue = hubItem.ratings?.tvdb?.value;
    const hubTvdbScore = hubTvdbValue == null
        ? null
        : (hubTvdbValue <= 10 ? hubTvdbValue.toFixed(1) : `${hubItem.ratings?.tvdb?.percent ?? Math.round(hubTvdbValue)}%`);
    const metaChipRow = (chips: MetaChip[], className = '') => (
        <div className={`player-meta-chips flex flex-wrap items-center gap-1.5${className ? ` ${className}` : ''}`}>
            {chips.map((chip) => (
                <div
                    key={chip.label}
                    title={chip.title}
                    className="player-meta-chip inline-flex h-7 items-center gap-1 rounded-md border border-white/10 bg-black/45 px-2 text-[11px] font-semibold leading-none text-white/85 backdrop-blur-md"
                >
                    {chip.icon ? <span className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center [&_img]:h-3.5 [&_img]:w-3.5 [&_svg]:h-3.5 [&_svg]:w-3.5">{chip.icon}</span> : null}
                    <span className="leading-none">{chip.label}</span>
                </div>
            ))}
        </div>
    );
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
    const isAllEpisodesSeason = (row: PlayerItem) => (
        row.type === 'season'
        && (Number(row.index) === -1 || /^all\s+episodes$/i.test(String(row.title || '').trim()))
    );
    const seasonChildren = children.filter((row) => row.type === 'season' && !isAllEpisodesSeason(row));
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
            {metaChipRow(metaChips)}
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
                                ? 'h-14 sm:h-20 lg:h-[6.5rem] w-auto max-w-[min(100%,32rem)] self-start object-contain object-left-top'
                                : 'h-10 sm:h-12 lg:h-16 w-auto max-w-[min(100%,26rem)] self-start object-contain object-left-top'}
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
                        className="h-14 sm:h-20 lg:h-[6.5rem] w-auto max-w-[min(100%,32rem)] self-start object-contain object-left-top"
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
    const phoneBillboardMeta = preplayUi ? joinMeta([
        item.type === 'episode' && item.index != null ? `E${item.index}` : '',
        item.type === 'episode' ? airdateNode(item.originallyAvailableAt, locale) : String(item.year || ''),
        formatPlayerDuration(item.durationMs),
        item.type !== 'episode' ? genres.slice(0, 3).join(', ') : '',
        item.contentRating ? String(item.contentRating) : '',
    ], '  ·  ') : [];
    const phonePosterPath = item.type === 'episode' && item.grandparentRatingKey
        ? `/library/metadata/${item.grandparentRatingKey}/thumb`
        : item.type === 'season' && item.parentRatingKey
            ? `/library/metadata/${item.parentRatingKey}/thumb`
            : item.thumb;
    const phonePosterUrl = phoneUi && settings.phoneOverviewPoster && phonePosterPath
        ? plexImageUrl(phonePosterPath, 360, 540, { quality: 72 })
        : '';
    const serviceBrandMark = isTvShell ? (
        <PlayerServiceBrandMark item={item} className="media-details-service-logo" />
    ) : null;
    const mobileClearTitleNode = phonePosterUrl && !phonePosterFailed ? (
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
            fillSlot={isTvShell}
            className="media-details-clearlogo h-[4.75rem] w-auto max-w-[min(92%,20rem)] object-contain object-center"
        />
    ) : logoPending && !settings.phoneOverviewPoster ? (
        <div className="h-[4.75rem] w-[12rem]" aria-hidden />
    ) : (
        <span className="media-details-title-text w-full text-center text-[1.85rem] font-black leading-[1.05] tracking-tight text-white drop-shadow-[0_8px_24px_rgba(0,0,0,0.8)]">
            {mobileBillboardTitle}
        </span>
    );
    const mobileShowTitleNode = isTvShell ? (
        <div className="media-details-billboard-title-stack flex w-full flex-col items-start gap-2.5">
            {serviceBrandMark}
            {mobileClearTitleNode}
        </div>
    ) : (
        mobileClearTitleNode
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
                    <div
                        key={String(hubItem.ratingKey || spotlightKey || hubItem.title)}
                        className="media-details-hub-meta-swap"
                    >
                        <p className="media-details-episode-heading">{hubItem.title}</p>
                        {hubMetaChips.length || hubItem.ratings ? (
                            <div className="media-details-billboard-ratings media-details-hub-ratings pointer-events-auto mt-2.5 flex w-full flex-col gap-2">
                                {hubMetaChips.length ? metaChipRow(hubMetaChips) : null}
                                <MediaRatingPills
                                    ratings={toCombinedRatings(hubItem.ratings)}
                                    tmdbScore={hubTmdbScore}
                                    tmdbUrl={hubItem.ratings?.tmdb?.url}
                                    tvdbScore={hubTvdbScore}
                                    tvdbUrl={hubItem.ratings?.tvdb?.url}
                                    interactive={false}
                                />
                            </div>
                        ) : null}
                        {hubSummary ? (
                            <p className="media-details-billboard-summary">{hubSummary}</p>
                        ) : null}
                    </div>
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
            {!isTvShell && phoneBillboardMeta.length ? (
                <p className="media-details-billboard-line mt-1.5 max-w-[22rem] text-center text-[12px] font-semibold tracking-wide text-white/75 drop-shadow-[0_4px_12px_rgba(0,0,0,0.7)]">
                    {phoneBillboardMeta}
                </p>
            ) : null}
            {preplayUi && !(isTvShell && (item.type === 'episode' || item.type === 'season')) ? (
                <div className="media-details-billboard-ratings pointer-events-auto mt-2.5 flex w-full flex-col items-center gap-2">
                    {metaChipRow(metaChips, 'justify-center')}
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
                    {isEpisodeHub && (hubArtFront || hubArtBack) && !backdropFailed ? (
                        <>
                            {hubArtBack ? (
                                <img
                                    src={hubArtBack}
                                    alt=""
                                    className={`media-details-hub-art absolute inset-0 w-full h-full object-cover ${hubArtFrontOn ? 'is-behind' : 'is-front'}`}
                                    decoding="async"
                                />
                            ) : null}
                            {hubArtFront ? (
                                <img
                                    src={hubArtFront}
                                    alt=""
                                    className={`media-details-hub-art absolute inset-0 w-full h-full object-cover ${hubArtFrontOn ? 'is-front' : 'is-behind'}`}
                                    decoding="async"
                                    fetchPriority="high"
                                />
                            ) : null}
                        </>
                    ) : backdropUrl && !backdropFailed ? (
                        <PlayerBackdropImage
                            src={backdropUrl}
                            holdPrevious
                            className="absolute inset-0 w-full h-full object-cover"
                            fetchPriority="high"
                            onLoad={() => setBackdropReady(true)}
                            onError={() => setBackdropFailed(true)}
                        />
                    ) : (
                        <div className="absolute inset-0 bg-black" />
                    )}
                    {/* After the art, before the scrims: the text gradients stay on top. */}
                    {item.type === 'movie' || item.type === 'show' ? (
                        <TrailerPreview
                            ref={trailerPreviewRef}
                            trailer={previewTrailer}
                            enabled={settings.trailerPreview}
                            paused={playing || playbackActive}
                            expanded={trailerExpanded}
                            serverId={item.serverId || serverId || null}
                            onPlayingChange={setTrailerPreviewPlaying}
                        />
                    ) : null}
                    {isTvShell && trailerPreviewPlaying && !trailerExpanded ? (
                        // Slow pulse: press Up to watch this trailer full screen.
                        <div className="media-details-trailer-up" aria-hidden>
                            <ChevronUp className="h-7 w-7" strokeWidth={2.5} />
                        </div>
                    ) : null}
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
                                    {(item.themeKey || item.themeUrl) && settings.playThemeTunes ? (
                                        <div className="relative z-10">
                                            <MediaPlayerThemeTune
                                                themeKey={item.themeKey || ''}
                                                themeUrl={item.themeUrl}
                                                enabled
                                                paused={playing || playbackActive || trailerPreviewPlaying}
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
                                            {startOverButton}
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
                                                    onClick={openTrailer}
                                                    disabled={playing || playbackActive}
                                                    title={t('mediaPlayerPage.trailer')}
                                                    aria-label={t('mediaPlayerPage.trailer')}
                                                    className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/15 bg-white/5 text-white transition-colors hover:border-plex/40 hover:bg-white/10 disabled:opacity-50"
                                                >
                                                    <Film className="h-4 w-4" />
                                                    <span className="media-details-action-label">{t('mediaPlayerPage.trailer')}</span>
                                                </button>
                                            ) : null}
                                            {item.type === 'movie' || item.type === 'episode' || item.type === 'show' || item.type === 'season' ? (
                                                <button
                                                    type="button"
                                                    data-tv-item="1"
                                                    data-tv-action="1"
                                                    data-tv-key={`watched:${item.ratingKey}`}
                                                    onClick={onWatchedPress}
                                                    title={watchedTarget.watched ? t('mediaPlayerPage.markUnwatched') : t('mediaPlayerPage.markWatched')}
                                                    aria-label={watchedTarget.watched ? t('mediaPlayerPage.markUnwatched') : t('mediaPlayerPage.markWatched')}
                                                    className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/15 bg-white/5 text-white transition-colors hover:border-plex/40 hover:bg-white/10"
                                                >
                                                    {watchedTarget.watched ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                                    <span className="media-details-action-label">{phoneUi ? actionWatchedLabel : (watchedTarget.watched ? t('mediaPlayerPage.markUnwatched') : t('mediaPlayerPage.markWatched'))}</span>
                                                </button>
                                            ) : null}
                                            {watchlistChip}
                                            {watchTogetherChip}
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
                                            {movieTechPills.length ? (
                                                <div className="media-details-episode-tech media-details-movie-tech">
                                                    {movieTechPills.map((pill) => (
                                                        <span
                                                            key={`${pill.key}-${pill.label}`}
                                                            className={`player-file-pill player-file-pill--${pill.tone}`}
                                                        >
                                                            {pill.label}
                                                        </span>
                                                    ))}
                                                    {movieTrackChips?.audio ? (
                                                        <span className="player-track-chip">
                                                            <Volume2 className="h-[1em] w-[1em] shrink-0" aria-hidden />
                                                            {movieTrackChips.audio}
                                                        </span>
                                                    ) : null}
                                                    {movieTrackChips ? (
                                                        <span className="player-track-chip">
                                                            <Captions className="h-[1em] w-[1em] shrink-0" aria-hidden />
                                                            {movieTrackChips.subtitles}
                                                        </span>
                                                    ) : null}
                                                </div>
                                            ) : null}
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
                                    {startOverButton}
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
                                            onClick={openTrailer}
                                            disabled={playing || playbackActive}
                                            title={t('mediaPlayerPage.trailer')}
                                            aria-label={t('mediaPlayerPage.trailer')}
                                            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/15 bg-white/5 text-white transition-colors hover:border-plex/40 hover:bg-white/10 disabled:opacity-50"
                                        >
                                            <Film className="h-4 w-4" />
                                            <span className="media-details-action-label">{t('mediaPlayerPage.trailer')}</span>
                                        </button>
                                    ) : null}
                                    <button
                                        type="button"
                                        data-tv-item="1"
                                        data-tv-action="1"
                                        data-tv-key={`watched:${item.ratingKey}`}
                                        onClick={onWatchedPress}
                                        title={watchedTarget.watched ? t('mediaPlayerPage.markUnwatched') : t('mediaPlayerPage.markWatched')}
                                        aria-label={watchedTarget.watched ? t('mediaPlayerPage.markUnwatched') : t('mediaPlayerPage.markWatched')}
                                        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/15 bg-white/5 text-white transition-colors hover:border-plex/40 hover:bg-white/10"
                                    >
                                        {watchedTarget.watched ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                        <span className="media-details-action-label">{phoneUi ? actionWatchedLabel : (watchedTarget.watched ? t('mediaPlayerPage.markUnwatched') : t('mediaPlayerPage.markWatched'))}</span>
                                    </button>
                                    {watchlistChip}
                                    {watchTogetherChip}
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
                            activeKey={nowPlayingTrackKey || (item.type === 'track' ? item.ratingKey : null)}
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

                    {seasonChildren.length && !isEpisodeGrid && !phoneListEpisodes.length && !musicItem ? (
                    <section className="media-details-seasons mt-6" data-tv-row="1" data-tv-row-id={`seasons:${item.ratingKey}`}>
                        <SectionHeading>
                            {isTvShell
                                ? t(seasonChildren.length === 1 ? 'common.seasonCount' : 'common.seasonCount_plural', { count: seasonChildren.length })
                                : t('mediaPlayerPage.seasons')}
                        </SectionHeading>
                        <Carousel posterRow flush>
                            {seasonChildren.map((row) => {
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
                                        onClick={() => {
                                            if (row.ratingKey) {
                                                void fetchMediaPlayerItem(row.ratingKey, {
                                                    core: true,
                                                    serverId: row.serverId || item.serverId || serverId || null,
                                                });
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
                                            data-tv-season-art="1"
                                            className="player-poster-frame relative overflow-hidden rounded-[12px] border border-white/10 bg-black/30"
                                        >
                                            {row.thumb || item.thumb ? (
                                                <FadeImg
                                                    src={plexImageUrl(row.thumb || item.thumb, 300, 450, { quality: PLAYER_POSTER_QUALITY })}
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
                        playLabel={startLabel}
                        resumeLabel={t('mediaPlayerPage.resume')}
                        onPlayEpisode={playEpisodeTile}
                        hideSpoiler={(row) => hideEpisodeSpoilers(settings, row)}
                    />
                    ) : tvEpisodeRows.length ? (
                    <section className="media-details-episodes mt-6" data-tv-row="1" data-tv-row-id={`episodes:${item.ratingKey}`}>
                        {isTvShell ? null : (
                            <SectionHeading>{t('mediaPlayerPage.episodes')}</SectionHeading>
                        )}
                        <div className="media-details-episodes-stage">
                        {isTvShell && hubTechPills.length ? (
                            <div
                                key={`tech:${hubItem.ratingKey || spotlightKey}`}
                                className="media-details-episode-tech media-details-hub-meta-swap"
                            >
                                {hubTechPills.map((pill) => (
                                    <span
                                        key={`${pill.key}-${pill.label}`}
                                        className={`player-file-pill player-file-pill--${pill.tone}`}
                                    >
                                        {pill.label}
                                    </span>
                                ))}
                                {hubTrackChips?.audio ? (
                                    <span className="player-track-chip">
                                        <Volume2 className="h-[1em] w-[1em] shrink-0" aria-hidden />
                                        {hubTrackChips.audio}
                                    </span>
                                ) : null}
                                {hubTrackChips ? (
                                    <span className="player-track-chip">
                                        <Captions className="h-[1em] w-[1em] shrink-0" aria-hidden />
                                        {hubTrackChips.subtitles}
                                    </span>
                                ) : null}
                            </div>
                        ) : null}
                        <div className="media-details-episodes-rail">
                        <Carousel posterRow flush>
                            {tvEpisodeRows.map((raw) => {
                                const row = raw.type === 'episode' ? applyRememberedProgress(raw) : raw;
                                const filePills = settings.showEpisodeFilePills ? fileInfoPills(row) : [];
                                const isCurrentEpisode = isTvShell && String(row.ratingKey) === String(spotlightKey || item.ratingKey);
                                const rowPlayLabel = shouldOfferResume(row)
                                    ? t('mediaPlayerPage.resume')
                                    : (isTvShell && !musicItem ? t('mediaPlayerPage.watch') : t('mediaPlayerPage.play'));
                                return (
                                <div key={row.ratingKey} className={`media-details-episode-card group w-[17rem] shrink-0 snap-start sm:w-[20rem]${isCurrentEpisode ? ' is-current' : ''}`}>
                                    <button
                                        type="button"
                                        data-tv-item="1"
                                        data-tv-episode-btn="1"
                                        data-tv-watched={row.watched ? '1' : '0'}
                                        data-tv-key={row.ratingKey}
                                        onFocus={() => {
                                            if (isTvShell) queueTvSpotlight(String(row.ratingKey));
                                        }}
                                        onClick={() => {
                                            if (isTvShell) queueTvSpotlight(String(row.ratingKey), true);
                                            playEpisodeTile(row);
                                        }}
                                        className="relative z-0 block w-full overflow-visible rounded-[12px] border-0 bg-transparent p-0 text-left outline-none"
                                        aria-label={`${rowPlayLabel}: ${row.title}`}
                                    >
                                        <div
                                            data-tv-episode-art="1"
                                            className="player-poster-frame relative overflow-hidden rounded-[12px] border border-white/10 bg-black/30"
                                        >
                                            {row.thumb ? (
                                                <FadeImg
                                                    src={plexImageUrl(row.thumb, 720, 405, { quality: PLAYER_POSTER_QUALITY })}
                                                    alt=""
                                                    className={`aspect-video w-full object-cover transition-transform group-hover:scale-[1.03]${
                                                        hideEpisodeSpoilers(settings, row) ? ' player-spoiler-img' : ''
                                                    }`}
                                                />
                                            ) : (
                                                <div className="flex aspect-video items-center justify-center text-[10px] font-bold uppercase tracking-widest text-muted">
                                                    {t('mediaPlayerPage.episodes')}
                                                </div>
                                            )}
                                            {isTvShell && row.index != null ? (
                                                <span className="player-episode-index">E{row.index}</span>
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
                                    {(row.index != null || row.durationMs || row.originallyAvailableAt) ? (
                                        // Wraps instead of truncating, so a full date in any format is never cut off.
                                        <div className="player-episode-meta mt-0.5 text-sm font-bold leading-snug text-text">
                                            {joinMeta([
                                                row.index != null ? `Episode ${row.index}` : '',
                                                row.durationMs ? formatPlayerDuration(row.durationMs) : '',
                                                airdateNode(row.originallyAvailableAt, locale),
                                            ], ' · ')}
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
                        <div className="media-details-episode-cast" data-tv-rail="1">
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
                                    className="group flex flex-col items-center gap-3 w-44 flex-shrink-0 snap-start text-center outline-none"
                                >
                                    <CastAvatar name={actor.name} thumb={actor.thumb} />
                                    <div className="w-full px-1">
                                        <div className="player-cast-name text-sm font-bold text-text leading-tight line-clamp-2 group-hover:text-plex">{actor.name}</div>
                                        {actor.role ? (
                                            <div className="player-cast-role text-xs text-muted mt-1 leading-snug line-clamp-2">{actor.role}</div>
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
                                    className="group flex flex-col items-center gap-3 w-44 flex-shrink-0 snap-start text-center outline-none"
                                >
                                    <CastAvatar name={actor.name} thumb={actor.thumb} />
                                    <div className="w-full px-1">
                                        <div className="player-cast-name text-sm font-bold text-text leading-tight line-clamp-2 group-hover:text-plex">{actor.name}</div>
                                        {actor.role ? (
                                            <div className="player-cast-role text-xs text-muted mt-1 leading-snug line-clamp-2">{actor.role}</div>
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
                                                <FadeImg
                                                    src={plexImageUrl(extra.thumb, 426, 240, { quality: PLAYER_POSTER_QUALITY })}
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
            {versionPickerOpen && typeof document !== 'undefined' ? createPortal(
                <div
                    className={`smp-resume smp-version-dialog${isTvShell ? ' is-tv' : ''}`}
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="player-version-title"
                    data-tv-version-dialog="1"
                >
                    <div className="smp-resume-scrim" aria-hidden onClick={() => setVersionPickerOpen(false)} />
                    {/* Same small billboard as the Resume prompt: art, logo, then one row per file. */}
                    <div className="smp-resume-card player-resume-dialog-enter">
                        {backdropUrl ? <img className="smp-resume-art" src={backdropUrl} alt="" aria-hidden /> : null}
                        <div className="smp-resume-fade" aria-hidden />
                        <div className="smp-resume-body smp-version-body">
                            <p className="smp-resume-eyebrow">{t('mediaPlayerPage.selectVersion')}</p>
                            {logoUrl && !logoFailed ? (
                                <img className="smp-resume-logo" src={logoUrl} alt={item.title || ''} />
                            ) : null}
                            <h2 id="player-version-title" className={logoUrl && !logoFailed ? 'sr-only' : 'smp-resume-title'}>
                                {item.title}
                            </h2>
                            <div className="smp-version-list" data-tv-rail="1">
                                {versionChoices.map((row, index) => {
                                    const parts = versionChoiceParts(row);
                                    return (
                                        <button
                                            key={row.id || row.mediaIndex}
                                            type="button"
                                            data-tv-item="1"
                                            data-tv-action="1"
                                            data-tv-version-primary={index === 0 ? '1' : undefined}
                                            onClick={() => startPlay(row.mediaIndex)}
                                            className="smp-version-row"
                                            aria-label={versionChoiceLabel(row)}
                                        >
                                            <span className="smp-version-res">{parts.resolution}</span>
                                            <span className="smp-version-detail">{parts.detail || row.label}</span>
                                            {parts.bitrate ? <span className="smp-version-rate">{parts.bitrate}</span> : null}
                                        </button>
                                    );
                                })}
                            </div>
                            <div className="smp-resume-actions">
                                <button
                                    type="button"
                                    data-tv-item="1"
                                    data-tv-action="1"
                                    onClick={() => setVersionPickerOpen(false)}
                                    className="smp-resume-btn"
                                >
                                    <X className="h-[18px] w-[18px] shrink-0" />
                                    {t('common.close')}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>,
                document.body,
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
