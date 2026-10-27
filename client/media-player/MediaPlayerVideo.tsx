import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
    Loader2,
    Maximize,
    Minimize,
    Minimize2,
    Pause,
    PictureInPicture2,
    Play,
    SkipBack,
    SkipForward,
    Volume2,
    VolumeX,
    X,
} from 'lucide-react';
import type Hls from 'hls.js';
import { loadHls } from './loadHls';
import {
    lockBackgroundScroll,
    PORTAL_CSRF_HEADER,
    PORTAL_CSRF_VALUE,
    portalUrl,
    useDiscoverI18n,
} from './host';
import {
    formatClock,
    formatEpisodeCode,
    formatNativePlayerMeta,
    formatPlayerDate,
    isFuturePlayerDate,
    formatPlayerResolution,
    newPlaySessionId,
    playSessionIdFromSrc,
    buildNativePlaybackSrc,
    buildPlaybackSrc,
    canUseNativeHls,
    isHlsPlaybackSrc,
    isFilePlaybackSrc,
    isPlexPartPlaybackSrc,
    isPlexNativePlayback,
    nativeDirectPlayEligible,
    nativeSafeQualityId,
    offsetMsFromSrc,
    playbackModeFromSrc,
    isMusicPlayerItem,
    MUSIC_NOW_PLAYING_EVENT,
    plexImageUrl,
    PLAYER_POSTER_QUALITY,
    plexLogoUrl,
    resizePlexArtUrl,
    isPlaybackFinished,
    rememberPlaybackProgress,
    PLAYBACK_SPEEDS,
    audioStreamIdFromSrc,
    subtitleStreamIdFromSrc,
} from './playerUtils';
import { downloadMediaPlayerSubtitle, fetchMediaPlayerItem, fetchMediaPlayerItemMore,fetchMediaPlayerNeighbors, fetchMediaPlayerSubtitleSearch, fetchMediaPlayerVoiceActivity, pausePlayerBackgroundLoads, reportMediaPlayerTimeline, resumePlayerBackgroundLoads, saveMediaPlayerSettings, setMediaPlayerWatched, startMediaPlayerPlayback, stopMediaPlayerTranscode } from './api';
import { usePlayerSettings } from './usePlayerSettings';
import { normalizePlayerSettings, readPlayerSettings, writePlayerSettings } from './playerSettings';
import { computeSubtitleSyncOffsetMs, parseSrtCueStartsMs } from './subtitleAutoSync.js';
import { PlayerSeekBar } from './PlayerSeekBar';
import { PlayerSkipBackIcon, PlayerSkipForwardIcon } from './PlayerSkipIcons';
import {
    clampMiniPlayerWidth,
    DEFAULT_MINI_PLAYER_WIDTH,
    MIN_MINI_PLAYER_WIDTH,
    readAvChoice,
    readLocalPlaybackPrefs,
    writeAvChoiceFromTracks,
    writeMediaIndexChoice,
    readMiniPlayerWidth,
    writeLocalPlaybackPrefs,
    writeMiniPlayerWidth,
} from './playerMemory';
import type { PlayerItem, PlayerPlayOptions, PlayerPlaySession } from './types';
import { PlayerClearLogo } from './PlayerClearLogo';
import {
    closeNativePlayer,
    isNativePlayerAvailable,
    openNativePlayer,
    seekNativePlayer,
    setNativePlayerPaused,
    updateNativePlayerSrc,
    updateNativePlayerSession,
    type NativePlayerCloseResult,
    type NativePlayerSessionPayload,
    type NativePlayerTrackOption,
} from '../plex-client/nativePlayer';
import { getSessionToken, isAndroidTvUi, isPlexDirectMode } from '../plex-client/config';
import { restoreTvFocusWhenReady } from '../plex-client/useTvRemote';
import { getWatchTogetherClient } from './watchTogetherClient';

export type PlayerCloseMeta = {
    /** True when another episode/title is about to start. */
    playNext?: boolean;
    ended?: boolean;
    item?: PlayerItem;
};

type Props = {
    session: PlayerPlaySession;
    /** When true, play/pause/seek/report sync through the portal Watch Together relay. */
    watchTogether?: boolean;
    onClose: (meta?: PlayerCloseMeta) => void;
    autoplayNext?: boolean;
    autoSkipIntro?: boolean;
    autoSkipCredits?: boolean;
    playNextQueue?: PlayerItem[];
    onConsumePlayNext?: () => void;
    onPlayItem?: (item: PlayerItem, opts?: PlayerPlayOptions) => void;
    onPlaybackError?: (message: string) => void;
};

type PickerOption = { id: string; label: string };

type FullscreenDocument = Document & {
    webkitFullscreenElement?: Element | null;
    webkitExitFullscreen?: () => Promise<void> | void;
};

type FullscreenElement = HTMLElement & {
    webkitRequestFullscreen?: () => Promise<void> | void;
};

type IosVideo = HTMLVideoElement & {
    webkitEnterFullscreen?: () => void;
    webkitDisplayingFullscreen?: boolean;
};

type PipVideo = HTMLVideoElement & {
    webkitSupportsPresentationMode?: (mode: string) => boolean;
    webkitSetPresentationMode?: (mode: string) => void;
    webkitPresentationMode?: string;
};

const canUsePictureInPicture = (video: HTMLVideoElement | null) => {
    if (typeof document === 'undefined') return false;
    if (document.pictureInPictureEnabled) return true;
    const pip = video as PipVideo | null;
    return !!(pip?.webkitSetPresentationMode || pip?.webkitSupportsPresentationMode?.('picture-in-picture'));
};

const isInPictureInPicture = (video: HTMLVideoElement | null) => {
    if (typeof document !== 'undefined' && document.pictureInPictureElement === video) return true;
    return (video as PipVideo | null)?.webkitPresentationMode === 'picture-in-picture';
};

const nativePlaybackAuth = (src: string) => {
    const absolute = portalUrl(src);
    let parsed: URL | null = null;
    try {
        parsed = new URL(absolute, window.location.href);
    } catch {
        parsed = null;
    }
    const plexServerUrl = !!(
        parsed
        && parsed.origin !== window.location.origin
        && !parsed.pathname.includes('/api/media-player/')
    );
    if (plexServerUrl && parsed) {
        const token = parsed.searchParams.get('X-Plex-Token') || parsed.searchParams.get('access_token') || '';
        let clientIdentifier = 'streampilot-android';
        try {
            clientIdentifier = localStorage.getItem('plexClient.plexClientId') || clientIdentifier;
        } catch {
            /* ignore */
        }
        const headers: Record<string, string> = {
            'X-Plex-Product': 'StreamPilot',
            'X-Plex-Platform': 'Android',
            'X-Plex-Device': 'Android TV',
            'X-Plex-Client-Identifier': clientIdentifier,
        };
        if (token) headers['X-Plex-Token'] = token;
        return { url: parsed.toString(), headers };
    }
    const token = getSessionToken();
    if (!token) return { url: absolute, headers: { [PORTAL_CSRF_HEADER]: PORTAL_CSRF_VALUE } as Record<string, string> };
    let withToken = absolute;
    try {
        const url = parsed || new URL(absolute, window.location.href);
        if (!url.searchParams.get('access_token')) url.searchParams.set('access_token', token);
        withToken = url.toString();
    } catch {
        /* keep absolute */
    }
    return {
        url: withToken,
        headers: {
            [PORTAL_CSRF_HEADER]: PORTAL_CSRF_VALUE,
            Authorization: `Bearer ${token}`,
        },
    };
};

const requestPictureInPicture = async (video: HTMLVideoElement | null) => {
    if (!video) return;
    const pip = video as PipVideo;
    if (pip.webkitSetPresentationMode && pip.webkitPresentationMode !== 'picture-in-picture') {
        pip.webkitSetPresentationMode('picture-in-picture');
        return;
    }
    if (video.requestPictureInPicture) await video.requestPictureInPicture();
};

const exitPictureInPicture = async (video: HTMLVideoElement | null) => {
    const pip = video as PipVideo | null;
    if (pip?.webkitSetPresentationMode && pip.webkitPresentationMode === 'picture-in-picture') {
        pip.webkitSetPresentationMode('inline');
        return;
    }
    if (typeof document !== 'undefined' && document.pictureInPictureElement) {
        await document.exitPictureInPicture();
    }
};

const fullscreenElement = () => {
    const doc = document as FullscreenDocument;
    return doc.fullscreenElement || doc.webkitFullscreenElement || null;
};

const requestPlayerFullscreen = async (shell: HTMLElement | null, video: HTMLVideoElement | null) => {
    if (shell) {
        const el = shell as FullscreenElement;
        const request = el.requestFullscreen || el.webkitRequestFullscreen;
        if (request) {
            await request.call(el);
            return;
        }
    }
    const ios = video as IosVideo | null;
    if (ios?.webkitEnterFullscreen) ios.webkitEnterFullscreen();
};

const exitPlayerFullscreen = async () => {
    if (!fullscreenElement()) return;
    const doc = document as FullscreenDocument;
    const exit = doc.exitFullscreen || doc.webkitExitFullscreen;
    if (exit) await exit.call(doc);
};

const hlsErrorMessage = (data: { response?: { code?: number; text?: string; data?: unknown } }, fallback: string) => {
    const raw = String(data?.response?.text || (typeof data?.response?.data === 'string' ? data.response.data : '') || '').trim();
    if (raw) {
        try {
            const parsed = JSON.parse(raw);
            if (parsed?.error) {
                return parsed.detail ? `${parsed.error} ${String(parsed.detail).slice(0, 160)}` : String(parsed.error);
            }
        } catch {
            if (!raw.includes('#EXTM3U') && raw.length < 180) return raw;
        }
    }
    const code = Number(data?.response?.code);
    if (Number.isFinite(code) && code > 0) return `${fallback} (${code})`;
    return fallback;
};

const stopPlaybackSession = (
    sessionId?: string | null,
    serverId?: string | null,
    ratingKey?: string | null,
    opts?: { timeMs?: number; durationMs?: number; live?: boolean },
) => {
    const id = String(sessionId || '').trim();
    if (!id) return Promise.resolve();
    const key = String(ratingKey || '').trim();
    const stopWork = Promise.all([
        key && !opts?.live
            ? reportMediaPlayerTimeline({
                ratingKey: key,
                sessionId: id,
                state: 'stopped',
                timeMs: Math.max(0, Math.floor(opts?.timeMs || 0)),
                durationMs: Math.max(0, Math.floor(opts?.durationMs || 0)),
                serverId,
            })
            : Promise.resolve(),
        stopMediaPlayerTranscode(id, { serverId, ratingKey: key || null, live: opts?.live === true }),
    ]).then(() => undefined);
    return Promise.race([
        stopWork,
        new Promise<void>((resolve) => window.setTimeout(resolve, 4000)),
    ]);
};

const TrackPicker: React.FC<{
    label: string;
    value: string;
    options: PickerOption[];
    open: boolean;
    onToggle: () => void;
    onChange: (id: string) => void;
}> = ({ label, value, options, open, onToggle, onChange }) => {
    if (!options.length) return null;
    const selected = options.find((row) => row.id === value)?.label || label;
    return (
        <div className="relative" onClick={(event) => event.stopPropagation()}>
            <button
                type="button"
                onClick={(event) => {
                    event.stopPropagation();
                    onToggle();
                }}
                className="inline-flex max-w-[9.5rem] items-center truncate rounded-full bg-white/10 px-3 py-1.5 text-white hover:bg-white/20"
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-label={label}
            >
                <span className="truncate">{selected}</span>
            </button>
            {open ? (
                <div
                    className="absolute bottom-full left-0 z-20 mb-2 max-h-56 min-w-[13rem] overflow-y-auto rounded-xl border border-white/15 bg-black/95 py-1 shadow-2xl"
                    role="listbox"
                    aria-label={label}
                >
                    <p className="px-3 py-1 text-[10px] font-black uppercase tracking-widest text-white/45">{label}</p>
                    {options.map((row) => (
                        <button
                            key={row.id || 'off'}
                            type="button"
                            role="option"
                            aria-selected={row.id === value}
                            onClick={() => onChange(row.id)}
                            className={`block w-full px-3 py-2 text-left text-xs font-bold hover:bg-white/10 ${row.id === value ? 'text-plex' : 'text-white'}`}
                        >
                            {row.label}
                        </button>
                    ))}
                </div>
            ) : null}
        </div>
    );
};

const seekBy = (video: HTMLVideoElement | null, deltaSeconds: number) => {
    if (!video) return;
    const next = Math.max(0, video.currentTime + deltaSeconds);
    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : next;
    video.currentTime = Math.min(duration, next);
};

const skipChapter = (
    video: HTMLVideoElement | null,
    chapters: Array<{ startMs: number; title?: string }> | undefined,
    direction: 1 | -1,
) => {
    if (!video || !chapters?.length) return;
    const posMs = Math.max(0, Math.floor((video.currentTime || 0) * 1000));
    const starts = chapters
        .map((row) => Number(row.startMs) || 0)
        .filter((ms) => ms >= 0)
        .sort((a, b) => a - b);
    if (direction > 0) {
        const next = starts.find((ms) => ms > posMs + 1200);
        if (next != null) video.currentTime = next / 1000;
        return;
    }
    const previous = [...starts].reverse().find((ms) => ms < posMs - 1200);
    video.currentTime = (previous != null ? previous : 0) / 1000;
};

const nativeNextItemPayload = (item?: PlayerItem | null) => {
    if (!item?.ratingKey) return { ratingKey: '', title: '' as string | undefined, thumb: '' };
    const thumb = item.thumb
        ? portalUrl(resizePlexArtUrl(plexImageUrl(item.thumb, 480, 270, { quality: PLAYER_POSTER_QUALITY }), 480, 270))
        : '';
    return { ratingKey: item.ratingKey, title: item.title, thumb };
};

const bufferedRanges = (video: HTMLVideoElement | null) => {
    const ranges: Array<{ startMs: number; endMs: number }> = [];
    if (!video) return ranges;
    try {
        for (let i = 0; i < video.buffered.length; i += 1) {
            ranges.push({ startMs: video.buffered.start(i) * 1000, endMs: video.buffered.end(i) * 1000 });
        }
    } catch {
        /* ignore */
    }
    return ranges;
};

export const MediaPlayerVideo: React.FC<Props> = ({
    session,
    watchTogether = false,
    onClose,
    autoplayNext = false,
    autoSkipIntro = false,
    autoSkipCredits = false,
    playNextQueue = [],
    onConsumePlayNext,
    onPlayItem,
    onPlaybackError,
}) => {
    const { t } = useDiscoverI18n();
    const [playerSettings] = usePlayerSettings();
    useEffect(() => {
        pausePlayerBackgroundLoads();
        return () => resumePlayerBackgroundLoads();
    }, []);
    const videoRef = useRef<HTMLVideoElement>(null);
    const overlayRef = useRef<HTMLDivElement>(null);
    const hlsRef = useRef<Hls | null>(null);
    const localPrefs = useRef(readLocalPlaybackPrefs());
    const [error, setError] = useState<string | null>(null);
    const [paused, setPaused] = useState(true);
    const [ready, setReady] = useState(false);
    const [fullscreen, setFullscreen] = useState(false);
    const [chrome, setChrome] = useState<'theater' | 'mini'>('theater');
    const [pip, setPip] = useState(false);
    const [pipSupported, setPipSupported] = useState(false);
    const [currentMs, setCurrentMs] = useState(0);
    const [durationMs, setDurationMs] = useState(session.item.durationMs || 0);
    const [buffered, setBuffered] = useState<Array<{ startMs: number; endMs: number }>>([]);
    const [playbackSrc, setPlaybackSrc] = useState(session.src);
    const [nativeExclusive, setNativeExclusive] = useState(() => isPlexNativePlayback());
    const [nativeCover, setNativeCover] = useState(() => isPlexNativePlayback());
    const [nativeMinimized, setNativeMinimized] = useState(false);
    const [qualityId, setQualityId] = useState(session.qualityId || '');
    const [audioStreamId, setAudioStreamId] = useState(session.audioStreamId || '');
    const [subtitleStreamId, setSubtitleStreamId] = useState(session.subtitleStreamId || '');
    const [openMenu, setOpenMenu] = useState<'quality' | 'audio' | 'subtitles' | 'speed' | 'version' | 'chapters' | null>(null);
    const [muted, setMuted] = useState(localPrefs.current.muted);
    const [volume, setVolume] = useState(localPrefs.current.volume);
    const [speed, setSpeed] = useState(localPrefs.current.speed);
    const [playbackMode, setPlaybackMode] = useState(session.playbackMode || playbackModeFromSrc(session.src, session.qualityId, session.canCopyOriginal));
    const [nextItem, setNextItem] = useState<PlayerItem | null>(null);
    const [previousItem, setPreviousItem] = useState<PlayerItem | null>(null);
    const [skippedIntro, setSkippedIntro] = useState(false);
    const [skippedCredits, setSkippedCredits] = useState(false);
    const [dismissedUpNext, setDismissedUpNext] = useState(false);
    const [upNextIn, setUpNextIn] = useState(10);
    const [relatedItems, setRelatedItems] = useState<PlayerItem[]>([]);
    const relatedItemsRef = useRef<PlayerItem[]>([]);
    relatedItemsRef.current = relatedItems;
    const [controlsVisible, setControlsVisible] = useState(true);
    const currentMsRef = useRef(0);
    const durationMsRef = useRef(session.item.durationMs || 0);
    const volumeRef = useRef(localPrefs.current.volume);
    const mutedRef = useRef(localPrefs.current.muted);
    const speedRef = useRef(localPrefs.current.speed);
    const applyingRemoteRef = useRef(false);
    const lastSeekIdRef = useRef<string | null>(null);
    /** Suppress WT buffering reports after a remote seek (avoids PMS rebuild storms). */
    const wtRemoteSeekGuardUntilRef = useRef(0);
    const watchTogetherRef = useRef(watchTogether);
    watchTogetherRef.current = watchTogether;
    const sendTimelineRef = useRef<(
        state: 'playing' | 'paused' | 'buffering' | 'stopped',
        timeMs?: number,
        extra?: { ended?: boolean; watchedHandled?: boolean },
    ) => void>(() => {});
    const onPlayItemRef = useRef(onPlayItem);
    const onConsumePlayNextRef = useRef(onConsumePlayNext);
    const queuedNextKeyRef = useRef<string | null>(null);
    const playNextQueueRef = useRef(playNextQueue);
    playNextQueueRef.current = playNextQueue;
    const autoplayNextRef = useRef(autoplayNext);
    autoplayNextRef.current = autoplayNext;
    const nextItemRef = useRef<PlayerItem | null>(null);
    const previousItemRef = useRef<PlayerItem | null>(null);
    const queuedNext = playNextQueue[0] || null;
    const upNextItem = queuedNext || nextItem;
    const fallbackUsedRef = useRef(false);
    /** 0 = none, 1 = DP→HLS done, 2 = HLS→1080p done (matches ExoPlayer ladder). */
    const streamFallbackStageRef = useRef(0);
    const nativeFileHlsFallbackRef = useRef(false);
    const clickTimerRef = useRef<number>(0);
    const lastTapRef = useRef<{ at: number; x: number } | null>(null);
    const hideTimerRef = useRef<number>(0);
    const streamRestartGenRef = useRef(0);
    /** Cancels superseded native stream rebuilds (seek / track / quality) so ghosts don't pile up. */
    const streamChangeGenRef = useRef(0);
    /** Blocks timeline pings while stop→start rebuild runs (avoids resurrecting stopped sessions). */
    const streamRebuildInFlightRef = useRef(false);
    const voiceActivityAvailableRef = useRef(false);
    const pausePositionMsRef = useRef(-1);
    const playbackSrcRef = useRef(session.src);
    const nativeExclusiveRef = useRef(nativeExclusive);
    nativeExclusiveRef.current = nativeExclusive;
    const nativeTimelineStateRef = useRef<'playing' | 'paused' | 'buffering'>('playing');
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;
    const onPlaybackErrorRef = useRef(onPlaybackError);
    onPlaybackErrorRef.current = onPlaybackError;
    const nativeClosedRef = useRef(false);
    const nativeLiveRef = useRef(false);
    const nativeMinimizedRef = useRef(false);
    const sessionRef = useRef(session);
    sessionRef.current = session;
    const publishMusicNowPlaying = (minimized = nativeMinimizedRef.current) => {
        if (typeof window === 'undefined') return;
        const item = sessionRef.current.item;
        if (!minimized || !isMusicPlayerItem(item) || nativeClosedRef.current) {
            window.dispatchEvent(new CustomEvent(MUSIC_NOW_PLAYING_EVENT, { detail: null }));
            return;
        }
        window.dispatchEvent(new CustomEvent(MUSIC_NOW_PLAYING_EVENT, {
            detail: {
                item,
                paused: nativeTimelineStateRef.current === 'paused',
                positionMs: currentMsRef.current,
                durationMs: durationMsRef.current,
                minimized: true,
            },
        }));
    };
    const publishMusicNowPlayingRef = useRef(publishMusicNowPlaying);
    publishMusicNowPlayingRef.current = publishMusicNowPlaying;
    const nativeOpenGenRef = useRef(0);
    const qualityIdRef = useRef(qualityId);
    const audioStreamIdRef = useRef(audioStreamId);
    const subtitleStreamIdRef = useRef(subtitleStreamId);
    qualityIdRef.current = qualityId;
    audioStreamIdRef.current = audioStreamId;
    subtitleStreamIdRef.current = subtitleStreamId;
    const [miniWidth, setMiniWidth] = useState(() => readMiniPlayerWidth());
    const [miniResizing, setMiniResizing] = useState(false);
    const [chromeLogoFailed, setChromeLogoFailed] = useState(false);
    const [chromeLogoReady, setChromeLogoReady] = useState(false);
    const miniDragRef = useRef<{
        pointerId: number;
        startX: number;
        startY: number;
        startWidth: number;
        axis: 'both' | 'x' | 'y';
        previousCursor: string;
        previousUserSelect: string;
    } | null>(null);

    const qualities = session.qualities || [];
    const audioTracks = session.audioTracks || [];
    const subtitles = session.subtitles || [];
    const versions = session.versions || [];
    const markers = session.markers || { intro: null, credits: null };
    const mediaIndex = String(session.mediaIndex || 0);
    const chromeLogoUrl = plexLogoUrl(session.item.logo);
    const showChromeLogo = Boolean(chromeLogoUrl) && !chromeLogoFailed && chromeLogoReady;
    // Top-left details under the title: "S1 · E1 · July 26, 2026" (year for movies).
    const chromeDetails = (isMusicPlayerItem(session.item) ? [] : [
        { text: session.item.type === 'episode' ? formatEpisodeCode(session.item) : '', future: false },
        session.item.type === 'episode'
            ? {
                text: formatPlayerDate(session.item.originallyAvailableAt),
                future: isFuturePlayerDate(session.item.originallyAvailableAt),
            }
            : { text: session.item.type === 'movie' ? String(session.item.year || '').trim() : '', future: false },
    ]).filter((part) => part.text);

    useEffect(() => {
        onPlayItemRef.current = onPlayItem;
    }, [onPlayItem]);
    useEffect(() => {
        onConsumePlayNextRef.current = onConsumePlayNext;
    }, [onConsumePlayNext]);
    useEffect(() => {
        queuedNextKeyRef.current = queuedNext?.ratingKey || null;
    }, [queuedNext?.ratingKey]);
    useEffect(() => {
        nextItemRef.current = upNextItem;
    }, [upNextItem]);
    useEffect(() => {
        if (!nativeLiveRef.current) return;
        const next = upNextItem;
        void updateNativePlayerSession({
            nextItem: nativeNextItemPayload(next),
        });
    }, [upNextItem]);
    useEffect(() => {
        previousItemRef.current = previousItem;
    }, [previousItem]);
    useEffect(() => {
        if (queuedNext) setDismissedUpNext(false);
    }, [queuedNext?.ratingKey]);
    useEffect(() => {
        currentMsRef.current = currentMs;
    }, [currentMs]);
    useEffect(() => {
        if (!watchTogether) return undefined;
        const client = getWatchTogetherClient();
        let reportTimer = 0;
        let seekCooldownTimer = 0;
        let lastRemoteSeekAt = 0;
        let pendingSeekMs: number | null = null;
        const WT_SEEK_COOLDOWN_MS = 2500;
        const WT_MAX_STALE_REWIND_MS = 30000;
        const markRemoteSeek = () => {
            lastRemoteSeekAt = Date.now();
            wtRemoteSeekGuardUntilRef.current = lastRemoteSeekAt + 4000;
        };
        const applyPosition = async (positionMs: number) => {
            if (streamRebuildInFlightRef.current) return;
            const next = Math.max(0, Math.floor(positionMs || 0));
            currentMsRef.current = next;
            setCurrentMs(next);
            markRemoteSeek();
            if (nativeLiveRef.current) {
                await seekNativePlayer(next);
                return;
            }
            const video = videoRef.current;
            if (video) video.currentTime = next / 1000;
        };
        const schedulePosition = (positionMs: number, force: boolean) => {
            const next = Math.max(0, Math.floor(positionMs || 0));
            const elapsed = Date.now() - lastRemoteSeekAt;
            if (!force && elapsed < WT_SEEK_COOLDOWN_MS) {
                pendingSeekMs = next;
                if (!seekCooldownTimer) {
                    seekCooldownTimer = window.setTimeout(() => {
                        seekCooldownTimer = 0;
                        const queued = pendingSeekMs;
                        pendingSeekMs = null;
                        if (queued != null) void applyPosition(queued);
                    }, WT_SEEK_COOLDOWN_MS - elapsed);
                }
                return;
            }
            pendingSeekMs = null;
            void applyPosition(next);
        };
        const applyPaused = async (shouldPause: boolean) => {
            setPaused(shouldPause);
            if (nativeLiveRef.current) {
                await setNativePlayerPaused(shouldPause);
                return;
            }
            const video = videoRef.current;
            if (!video) return;
            if (shouldPause) video.pause();
            else void video.play().catch(() => undefined);
        };
        const off = client.onState((state) => {
            if (!state) return;
            // Own non-corrective updates: still ack seek barrier, but do not
            // re-apply pause/seek (solo buffering used to seek us to 0 → BAD_HTTP).
            if (state.originClientId && state.originClientId === client.localClientId && !state.corrective) {
                if (state.waitingForSeekReady && state.seekId) {
                    client.seekReady(state.seekId);
                }
                return;
            }
            applyingRemoteRef.current = true;
            void (async () => {
                try {
                    if (state.waitingForSeekReady && state.seekId) {
                        if (lastSeekIdRef.current !== state.seekId) {
                            lastSeekIdRef.current = state.seekId;
                            schedulePosition(state.positionMs, true);
                        }
                        client.seekReady(state.seekId);
                        return;
                    }
                    const local = Math.max(0, Math.floor(currentMsRef.current || 0));
                    const remote = Math.max(0, Math.floor(state.positionMs || 0));
                    // Refuse stale rewinds (room stuck at 0) unless this is an
                    // explicit seek barrier — those restarts spam PMS hard.
                    const staleRewind = !state.waitingForSeekReady
                        && local > WT_MAX_STALE_REWIND_MS
                        && remote < local - WT_MAX_STALE_REWIND_MS;
                    if (!staleRewind && (state.corrective || Math.abs(local - remote) >= 1500)) {
                        schedulePosition(remote, !!state.corrective);
                    }
                    await applyPaused(!state.playing);
                } finally {
                    window.setTimeout(() => {
                        applyingRemoteRef.current = false;
                    }, 250);
                }
            })();
        });
        reportTimer = window.setInterval(() => {
            if (!watchTogetherRef.current || applyingRemoteRef.current) return;
            if (nativeLiveRef.current) return; // native onProgress already reports
            const video = videoRef.current;
            const pos = video
                ? Math.max(0, Math.floor((video.currentTime || 0) * 1000))
                : Math.max(0, Math.floor(currentMsRef.current || 0));
            client.report(pos, false);
        }, 2000);
        return () => {
            off();
            window.clearInterval(reportTimer);
            window.clearTimeout(seekCooldownTimer);
        };
    }, [watchTogether]);
    useEffect(() => {
        durationMsRef.current = durationMs;
    }, [durationMs]);
    useEffect(() => {
        volumeRef.current = volume;
    }, [volume]);
    useEffect(() => {
        mutedRef.current = muted;
    }, [muted]);
    useEffect(() => {
        speedRef.current = speed;
    }, [speed]);
    useEffect(() => {
        writeLocalPlaybackPrefs({ volume, muted, speed });
    }, [muted, speed, volume]);

    useEffect(() => {
        streamRestartGenRef.current += 1;
        playbackSrcRef.current = session.src;
        setPlaybackSrc(session.src);
        setQualityId(session.qualityId || '');
        setAudioStreamId(session.audioStreamId || '');
        setSubtitleStreamId(session.subtitleStreamId || '');
        setOpenMenu(null);
        currentMsRef.current = session.offsetMs || 0;
        durationMsRef.current = session.item.durationMs || 0;
        nativeTimelineStateRef.current = 'playing';
        setCurrentMs(session.offsetMs || 0);
        setDurationMs(session.item.durationMs || 0);
        setPlaybackMode(session.playbackMode || playbackModeFromSrc(session.src, session.qualityId, session.canCopyOriginal));
        setSkippedIntro(false);
        setSkippedCredits(false);
        setDismissedUpNext(false);
        setUpNextIn(10);
        setError(null);
        setBuffered([]);
        setControlsVisible(true);
        fallbackUsedRef.current = false;
        nativeFileHlsFallbackRef.current = false;
        streamFallbackStageRef.current = 0;
        setNativeExclusive(isPlexNativePlayback());
        setNativeCover(isPlexNativePlayback() && !nativeMinimizedRef.current);
    }, [session.sessionId]);

    useEffect(() => {
        setChromeLogoFailed(false);
        setChromeLogoReady(false);
        if (!chromeLogoUrl) {
            setChromeLogoFailed(true);
            return undefined;
        }
        let cancelled = false;
        const img = new Image();
        const finish = (ok: boolean) => {
            if (cancelled) return;
            if (ok && img.naturalWidth > 0) setChromeLogoReady(true);
            else setChromeLogoFailed(true);
        };
        img.onload = () => finish(true);
        img.onerror = () => finish(false);
        img.src = chromeLogoUrl;
        if (img.complete) finish(img.naturalWidth > 0);
        return () => { cancelled = true; };
    }, [chromeLogoUrl, session.item.ratingKey]);

    // Capacitor ExoPlayer: prefer native decode when the plugin is present.
    useEffect(() => {
        if (typeof window === 'undefined' || !window.__PLEX_CLIENT__) return undefined;
        let cancelled = false;
        let nativeOpenGen = 0;
        let coverTimer = 0;

        const offlineLocal = !!session.offlineLocal;

        const absoluteWithAuth = (src: string) => {
            if (/^file:|^content:/i.test(String(src || ''))) {
                return { url: String(src), headers: {} as Record<string, string> };
            }
            const absolute = portalUrl(src);
            let parsed: URL | null = null;
            try {
                parsed = new URL(absolute, window.location.href);
            } catch {
                parsed = null;
            }
            const plexServerUrl = !!(
                parsed
                && parsed.origin !== window.location.origin
                && !parsed.pathname.includes('/api/media-player/')
            );
            if (plexServerUrl && parsed) {
                const token = parsed.searchParams.get('X-Plex-Token') || parsed.searchParams.get('access_token') || '';
                let clientIdentifier = 'streampilot-android';
                try {
                    clientIdentifier = localStorage.getItem('plexClient.plexClientId') || clientIdentifier;
                } catch {
                    /* ignore */
                }
                const headers: Record<string, string> = {
                    'X-Plex-Product': 'StreamPilot',
                    'X-Plex-Platform': 'Android',
                    'X-Plex-Device': 'Android TV',
                    'X-Plex-Client-Identifier': clientIdentifier,
                };
                if (token) headers['X-Plex-Token'] = token;
                return { url: parsed.toString(), headers };
            }
            const token = getSessionToken();
            if (!token) return { url: absolute, headers: { [PORTAL_CSRF_HEADER]: PORTAL_CSRF_VALUE } as Record<string, string> };
            let withToken = absolute;
            try {
                const url = parsed || new URL(absolute, window.location.href);
                if (!url.searchParams.get('access_token')) url.searchParams.set('access_token', token);
                withToken = url.toString();
            } catch {
                /* keep absolute */
            }
            return {
                url: withToken,
                headers: {
                    [PORTAL_CSRF_HEADER]: PORTAL_CSRF_VALUE,
                    Authorization: `Bearer ${token}`,
                },
            };
        };

        const logoSrc = plexLogoUrl(session.item.logo);
        const logoAuthUrl = logoSrc ? absoluteWithAuth(logoSrc).url : '';
        const sidecarSubs: NativePlayerTrackOption[] = [];

        const nativeWatchNextPayload = (item: PlayerItem): NativePlayerSessionPayload['watchNext'] => {
            if (item.type !== 'movie' && item.type !== 'episode') return null;
            const episode = item.type === 'episode';
            // Launcher cards are 16:9: the episode still, or the movie backdrop.
            const artPath = episode ? (item.episodeThumb || item.thumb) : (item.art || item.thumb);
            const art = artPath ? absoluteWithAuth(plexImageUrl(artPath, 640, 360, { quality: 75 })) : null;
            return {
                serverId: item.serverId || undefined,
                type: episode ? 'episode' : 'movie',
                title: episode ? (item.showTitle || item.title) : item.title,
                episodeTitle: episode ? item.title : undefined,
                seasonNumber: episode && item.parentIndex ? item.parentIndex : undefined,
                episodeNumber: episode && item.index ? item.index : undefined,
                artUrl: art?.url || undefined,
                artHeaders: art?.headers,
            };
        };

        const timelineFromPlaybackUrl = (src: string, fallbackSessionId: string) => {
            try {
                const parsed = new URL(src, window.location.href);
                if (parsed.pathname.includes('/api/media-player/')) return undefined;
                const token = parsed.searchParams.get('X-Plex-Token')
                    || parsed.searchParams.get('access_token')
                    || '';
                if (!token) return undefined;
                let clientIdentifier = parsed.searchParams.get('X-Plex-Client-Identifier') || '';
                if (!clientIdentifier) {
                    try {
                        clientIdentifier = localStorage.getItem('plexClient.plexClientId') || 'streampilot-android';
                    } catch {
                        clientIdentifier = 'streampilot-android';
                    }
                }
                return {
                    origin: parsed.origin,
                    token,
                    clientId: clientIdentifier,
                    product: parsed.searchParams.get('X-Plex-Product') || 'StreamPilot',
                    version: parsed.searchParams.get('X-Plex-Version') || '1.0.0',
                    platform: parsed.searchParams.get('X-Plex-Platform') || 'Android',
                    device: parsed.searchParams.get('X-Plex-Device') || 'Android TV',
                    deviceName: parsed.searchParams.get('X-Plex-Device-Name') || 'StreamPilot',
                    sessionId: parsed.searchParams.get('X-Plex-Session-Identifier')
                        || parsed.searchParams.get('session')
                        || fallbackSessionId,
                };
            } catch {
                return undefined;
            }
        };

        const buildNativeSession = (item: PlayerItem | null, opts?: {
            qualityId?: string;
            audioStreamId?: string;
            subtitleStreamId?: string;
            mediaIndex?: number;
        }): NativePlayerSessionPayload => ({
            ratingKey: session.item.ratingKey,
            showKey: session.item.grandparentRatingKey || session.item.parentRatingKey || '',
            qualityId: opts?.qualityId ?? qualityIdRef.current ?? session.qualityId ?? '',
            audioStreamId: opts?.audioStreamId ?? audioStreamIdRef.current ?? session.audioStreamId ?? '',
            subtitleStreamId: opts?.subtitleStreamId ?? subtitleStreamIdRef.current ?? session.subtitleStreamId ?? '',
            mediaIndex: opts?.mediaIndex ?? session.mediaIndex ?? 0,
            durationMs: session.item.durationMs || durationMsRef.current || 0,
            qualities: (session.qualities || []).map((row) => ({ id: row.id, label: row.label })),
            audioTracks: (session.audioTracks || []).map((row) => ({
                id: row.id,
                label: row.label,
                language: row.language || row.languageTag || null,
                languageTag: row.languageTag || row.language || null,
                codec: row.codec || null,
                channels: row.channels || null,
            })),
            subtitles: [
                ...(session.subtitles || []).map((row) => ({
                    id: row.id,
                    label: row.label,
                    language: row.language || row.languageTag || null,
                    // Native matches Exo tracks on this ("en"); language is Plex's display name ("English").
                    languageTag: row.languageTag || row.language || null,
                    codec: row.codec || null,
                    embeddedOrdinal: row.embeddedOrdinal ?? null,
                    url: row.url || undefined,
                })),
                ...sidecarSubs,
            ],
            versions: (session.versions || []).map((row) => ({
                id: String(row.mediaIndex),
                label: row.label,
                mediaIndex: row.mediaIndex,
            })),
            markers: session.markers || { intro: null, credits: null },
            nextItem: nativeNextItemPayload(item),
            previousItem: nativeNextItemPayload(previousItemRef.current),
            relatedItems: relatedItemsRef.current.slice(0, 5).map((row) => ({
                ratingKey: row.ratingKey,
                title: row.title,
                thumb: row.thumb || undefined,
            })),
            audioDelayMs: readAvChoice(
                session.item.grandparentRatingKey || session.item.parentRatingKey,
                session.item.ratingKey,
            )?.audioDelayMs,
            playbackMode: session.playbackMode || playbackModeFromSrc(
                playbackSrcRef.current || session.src,
                opts?.qualityId ?? qualityIdRef.current ?? session.qualityId,
                session.canCopyOriginal,
            ),
            source: session.source || null,
            autoplayNext,
            autoSkipIntro: playerSettings.skipIntroMode === 'auto' || autoSkipIntro,
            autoSkipCredits: playerSettings.skipCreditsMode === 'auto' || autoSkipCredits,
            skipIntroMode: playerSettings.skipIntroMode,
            skipCreditsMode: playerSettings.skipCreditsMode,
            rewindOnResumeSec: playerSettings.rewindOnResumeSec,
            audioBoost: playerSettings.audioBoost,
            burnSubtitles: playerSettings.burnSubtitles,
            subtitleDelayMs: playerSettings.subtitleDelayMs,
            subtitleAutoSync: playerSettings.subtitleAutoSync,
            subtitleAutoSyncAvailable: voiceActivityAvailableRef.current,
            audioPassthrough: playerSettings.audioPassthrough,
            autoQuality: playerSettings.autoQuality,
            cinemaTrailerCount: playerSettings.cinemaTrailerCount,
            title: session.item.title,
            subtitle: session.item.showTitle || session.item.seasonTitle || '',
            meta: isMusicPlayerItem(session.item) ? '' : formatNativePlayerMeta(session.item),
            logoUrl: isMusicPlayerItem(session.item) ? '' : logoAuthUrl,
            posterUrl: isMusicPlayerItem(session.item) && session.item.thumb
                ? absoluteWithAuth(resizePlexArtUrl(plexImageUrl(session.item.thumb, 600, 600, { quality: 70 }), 600, 600)).url
                : '',
            watchNext: isMusicPlayerItem(session.item) ? null : nativeWatchNextPayload(session.item),
            music: isMusicPlayerItem(session.item),
            live: session.live === true,
            liveDebug: session.liveDebug || '',
            chapters: (session.item.chapters || []).map((row) => ({ startMs: row.startMs, title: row.title })),
            previewThumbTemplate: session.previewThumbTemplate || null,
            frameRate: session.item.frameRate || null,
            nightMode: playerSettings.nightMode,
            matchFrameRate: playerSettings.matchFrameRate,
            subtitleStyle: {
                size: playerSettings.subtitleSize,
                color: playerSettings.subtitleColor,
                background: playerSettings.subtitleBackground,
                position: playerSettings.subtitlePosition,
            },
            timeline: offlineLocal
                ? undefined
                : timelineFromPlaybackUrl(
                    playbackSrcRef.current || session.src || '',
                    playSessionIdFromSrc(playbackSrcRef.current || session.src) || session.sessionId,
                ),
        });

        (async () => {
            if (!(await isNativePlayerAvailable())) {
                if (!cancelled) {
                    onPlaybackErrorRef.current?.('Native player unavailable on this device.');
                    onCloseRef.current({ ended: false, item: session.item });
                }
                return;
            }
            if (cancelled) return;
            nativeLiveRef.current = true;
            setNativeExclusive(true);
            setNativeCover(!nativeMinimizedRef.current);
            window.clearTimeout(coverTimer);
            coverTimer = window.setTimeout(() => {
                if (!cancelled) setNativeCover(false);
            }, 450);
            const qualityForNative = nativeSafeQualityId(qualityIdRef.current || session.qualityId);
            if (qualityForNative !== (qualityIdRef.current || session.qualityId || '')) {
                qualityIdRef.current = qualityForNative;
                setQualityId(qualityForNative);
            }
            const nativeAudioId = audioStreamIdRef.current || session.audioStreamId || '';
            const nativeSrc = offlineLocal
                ? String(session.src || '')
                : buildNativePlaybackSrc(session.item.ratingKey, session, {
                    qualityId: qualityForNative,
                    audioStreamId: nativeAudioId,
                    subtitleStreamId: subtitleStreamIdRef.current ?? session.subtitleStreamId ?? '',
                    mediaIndex: session.mediaIndex || 0,
                    offsetMs: session.offsetMs || 0,
                });
            playbackSrcRef.current = nativeSrc;
            setPlaybackSrc(nativeSrc);
            currentMsRef.current = session.offsetMs || 0;
            durationMsRef.current = session.item.durationMs || durationMsRef.current || 0;
            nativeTimelineStateRef.current = 'playing';
            if (!offlineLocal) {
                void reportMediaPlayerTimeline({
                    ratingKey: session.item.ratingKey,
                    sessionId: playSessionIdFromSrc(nativeSrc) || session.sessionId,
                    state: 'playing',
                    timeMs: Math.max(0, Math.floor(session.offsetMs || 0)),
                    durationMs: Math.max(0, Math.floor(session.item.durationMs || 0)),
                    audioStreamId: nativeAudioId || audioStreamIdFromSrc(nativeSrc) || null,
                    subtitleStreamId: isFilePlaybackSrc(nativeSrc)
                        ? ''
                        : (subtitleStreamIdFromSrc(nativeSrc) || subtitleStreamIdRef.current || ''),
                    serverId: session.item.serverId,
                });
            }
            const auth = absoluteWithAuth(nativeSrc);
            const gen = ++nativeOpenGen;
            nativeOpenGenRef.current = gen;
            nativeClosedRef.current = false;
            const completeNativeSession = (result: NativePlayerCloseResult | null) => {
                if (nativeClosedRef.current || cancelled || gen !== nativeOpenGenRef.current) return;
                nativeClosedRef.current = true;
                const positionMs = Math.max(
                    0,
                    Math.floor(Number(result?.positionMs) || currentMsRef.current || 0),
                );
                const durationMs = Math.max(0, Math.floor(durationMsRef.current || 0));
                const reportMs = result?.ended && durationMs > 0 ? Math.max(positionMs, durationMs) : positionMs;
                currentMsRef.current = reportMs;
                const sendStopped = sendTimelineRef.current;
                const queued = playNextQueueRef.current[0];
                const neighbor = nextItemRef.current;
                const previous = previousItemRef.current;
                // Chain when native asked. If the native side says playNext but
                // didn't have the ratingKey (session update arrived too late),
                // fall back to the JS-side queue or neighbor.
                const nativeNextKey = result?.nextRatingKey ? String(result.nextRatingKey) : '';
                const jsNextKey = queued?.ratingKey || neighbor?.ratingKey || '';
                const nextKey = (
                    !result?.error && result?.playNext
                ) ? (nativeNextKey || jsNextKey) : '';
                const previousKey = (
                    !result?.error
                    && !nextKey
                    && result?.playPrevious
                    && result.previousRatingKey
                ) ? String(result.previousRatingKey) : '';
                const willPlayNext = Boolean(nextKey);
                const willPlayPrevious = Boolean(previousKey);
                const willChain = willPlayNext || willPlayPrevious;
                if (result?.error) {
                    onPlaybackErrorRef.current?.('Playback failed. Check your connection and try again.');
                }
                nativeLiveRef.current = false;
                nativeMinimizedRef.current = false;
                setNativeMinimized(false);
                publishMusicNowPlayingRef.current(false);
                // Unmount via onClose. Do not flip nativeExclusive off first — that
                // paints the web theater (full-screen black) for a frame before the
                // parent drops the session.
                if (willChain) setNativeCover(true);
                else setNativeCover(false);
                onCloseRef.current({
                    playNext: willChain,
                    ended: !!result?.ended,
                    item: session.item,
                });
                sendStopped('stopped', reportMs, { ended: !!result?.ended, watchedHandled: !!result?.watchedHandled });
                if (!willChain) return;
                const chainKey = willPlayPrevious ? previousKey : nextKey;
                const known = willPlayPrevious
                    ? (previous?.ratingKey === chainKey ? previous : null)
                    : (queued?.ratingKey === chainKey
                        ? queued
                        : (neighbor?.ratingKey === chainKey ? neighbor : null));
                const fromQueue = !willPlayPrevious && queued?.ratingKey === chainKey;
                const playChain = onPlayItemRef.current;
                const consumeChain = onConsumePlayNextRef.current;
                const chainServerId = session.item.serverId;
                void (async () => {
                    let item = known;
                    if (!item && chainKey) {
                        try {
                            const page = await fetchMediaPlayerItem(chainKey, { core: true, serverId: chainServerId });
                            item = page?.item?.ratingKey ? page.item : null;
                        } catch {
                            item = null;
                        }
                    }
                    if (!item) {
                        onPlaybackErrorRef.current?.('Could not start the next episode.');
                        onCloseRef.current?.({ playNext: false, ended: !!result?.ended, item: session.item });
                        return;
                    }
                    const resolved = item;
                    const go = () => {
                        if (fromQueue) consumeChain?.();
                        playChain?.(resolved, {
                            offsetMs: 0,
                            skipResume: true,
                            fromAutoplay: !willPlayPrevious,
                        });
                    };
                    // Let the current player finish closing when the episode is already known.
                    if (known) window.setTimeout(go, 80);
                    else go();
                })();
            };
            try {
                try {
                    const voice = await fetchMediaPlayerVoiceActivity(session.item.ratingKey, {
                        serverId: session.item.serverId,
                    });
                    voiceActivityAvailableRef.current = !!voice?.available;
                } catch {
                    voiceActivityAvailableRef.current = false;
                }
                const result = await openNativePlayer({
                    url: auth.url,
                    title: session.item.title,
                    logoUrl: logoAuthUrl,
                    offsetMs: session.offsetMs || 0,
                    headers: auth.headers,
                    speed: speedRef.current || 1,
                    autoplayNext,
                    autoSkipIntro: playerSettings.skipIntroMode === 'auto' || autoSkipIntro,
                    autoSkipCredits: playerSettings.skipCreditsMode === 'auto' || autoSkipCredits,
                    session: buildNativeSession(nextItemRef.current || upNextItem),
                    onClose: completeNativeSession,
                    onSettings: (patch) => {
                        if (cancelled) return;
                        const next = normalizePlayerSettings({ ...readPlayerSettings(), ...patch });
                        writePlayerSettings(next);
                        void saveMediaPlayerSettings(next).catch(() => undefined);
                    },
                    onSubtitleAutoSync: ({ ratingKey: syncKey, sidecarUrl }) => {
                        if (cancelled || gen !== nativeOpenGenRef.current) return;
                        const key = String(syncKey || session.item.ratingKey || '');
                        void (async () => {
                            let cueStarts: number[] = [];
                            const side = String(sidecarUrl || '').trim();
                            if (side) {
                                try {
                                    const res = await fetch(side, { cache: 'no-store' });
                                    if (res.ok) cueStarts = parseSrtCueStartsMs(await res.text());
                                } catch { /* ignore */ }
                            }
                            const voice = await fetchMediaPlayerVoiceActivity(key, {
                                serverId: session.item.serverId,
                            }).catch(() => ({ available: false, speechMs: [] as number[] }));
                            voiceActivityAvailableRef.current = !!voice?.available;
                            const speech = Array.isArray(voice?.speechMs) ? voice.speechMs : [];
                            const offsetMs = computeSubtitleSyncOffsetMs(cueStarts, speech);
                            const next = normalizePlayerSettings({
                                ...readPlayerSettings(),
                                subtitleAutoSync: true,
                            });
                            writePlayerSettings(next);
                            void saveMediaPlayerSettings(next).catch(() => undefined);
                            await updateNativePlayerSession({
                                ...buildNativeSession(nextItemRef.current || upNextItem),
                                subtitleAutoSync: true,
                                subtitleAutoSyncAvailable: !!voice?.available,
                                subtitleAutoSyncOffsetMs: offsetMs,
                            });
                        })();
                    },
                    onPlayNext: ({ ratingKey }) => {
                        if (cancelled || gen !== nativeOpenGenRef.current) return;
                        const queued = playNextQueueRef.current[0];
                        const neighbor = nextItemRef.current;
                        const matched = (queued && queued.ratingKey === ratingKey)
                            ? queued
                            : (neighbor && neighbor.ratingKey === ratingKey)
                                ? neighbor
                                : null;
                        const start = (next: PlayerItem) => {
                            if (queued && queued.ratingKey === next.ratingKey) {
                                onConsumePlayNextRef.current?.();
                            }
                            onPlayItemRef.current?.(next, { offsetMs: 0, skipResume: true, fromAutoplay: true });
                        };
                        if (matched) {
                            start(matched);
                            return;
                        }
                        const key = String(ratingKey || '').trim();
                        if (!key) return;
                        void fetchMediaPlayerItem(key, { core: true, serverId: session.item.serverId })
                            .then((page) => {
                                if (cancelled || gen !== nativeOpenGenRef.current) return;
                                if (page?.item?.ratingKey) start(page.item);
                            })
                            .catch(() => undefined);
                    },
                    onPlayRelated: ({ ratingKey }) => {
                        if (cancelled || gen !== nativeOpenGenRef.current) return;
                        const related = relatedItemsRef.current.find((row) => row.ratingKey === ratingKey);
                        if (!related) return;
                        onPlayItemRef.current?.(related, { offsetMs: 0, skipResume: true });
                    },
                    onMinimized: (event) => {
                        if (cancelled || gen !== nativeOpenGenRef.current) return;
                        nativeMinimizedRef.current = true;
                        setNativeMinimized(true);
                        setNativeCover(false);
                        currentMsRef.current = event.positionMs;
                        setCurrentMs(event.positionMs);
                        if (event.durationMs > 0) {
                            durationMsRef.current = event.durationMs;
                            setDurationMs(event.durationMs);
                        }
                        if (event.state === 'paused') nativeTimelineStateRef.current = 'paused';
                        publishMusicNowPlayingRef.current(true);
                        // Return D-pad focus to the browse surface that started play.
                        if (isAndroidTvUi()) {
                            window.setTimeout(() => restoreTvFocusWhenReady(), 140);
                        }
                    },
                    onRestored: () => {
                        if (cancelled || gen !== nativeOpenGenRef.current) return;
                        nativeMinimizedRef.current = false;
                        setNativeMinimized(false);
                        publishMusicNowPlayingRef.current(false);
                    },
                    onProgress: (event) => {
                        if (cancelled || gen !== nativeOpenGen) return;
                        if (!nativeMinimizedRef.current) setNativeCover(false);
                        currentMsRef.current = event.positionMs;
                        setCurrentMs(event.positionMs);
                        if (event.durationMs > 0) {
                            const known = Math.max(0, durationMsRef.current || session.item.durationMs || 0);
                            const next = event.durationMs >= known * 0.8 ? event.durationMs : Math.max(known, event.durationMs);
                            durationMsRef.current = next;
                            setDurationMs(next);
                        }
                        if (event.state === 'stopped') return;
                        if (streamRebuildInFlightRef.current) return;
                        const state = event.state === 'paused' || event.state === 'buffering'
                            ? event.state
                            : 'playing';
                        // Native progress arrives every second; send only state changes here.
                        // The 5s timer sends routine position (per-second sends flooded PMS).
                        const changed = nativeTimelineStateRef.current !== state;
                        nativeTimelineStateRef.current = state;
                        if (changed) sendTimelineRef.current(state, event.positionMs);
                        if (watchTogetherRef.current && !applyingRemoteRef.current) {
                            const buffering = event.state === 'buffering'
                                && Date.now() >= wtRemoteSeekGuardUntilRef.current;
                            getWatchTogetherClient().report(
                                Math.max(0, Math.floor(event.positionMs || 0)),
                                buffering,
                            );
                        }
                        if (nativeMinimizedRef.current) publishMusicNowPlayingRef.current(true);
                    },
                    onStreamChange: async (event) => {
                        if (cancelled || gen !== nativeOpenGen) return;
                        const nextQuality = event.qualityId ?? qualityIdRef.current ?? session.qualityId ?? '';
                        const nextAudio = event.audioStreamId ?? audioStreamIdRef.current ?? session.audioStreamId ?? '';
                        const nextSub = event.subtitleStreamId !== undefined
                            ? (event.subtitleStreamId || '')
                            : (subtitleStreamIdRef.current ?? session.subtitleStreamId ?? '');
                        const nextMediaIndex = event.mediaIndex != null ? event.mediaIndex : (session.mediaIndex || 0);
                        if (event.mediaIndex != null) {
                            writeMediaIndexChoice(session.item.ratingKey, nextMediaIndex);
                        }
                        if (event.qualityId != null) {
                            setQualityId(event.qualityId);
                            qualityIdRef.current = event.qualityId;
                        }
                        if (event.audioStreamId != null) {
                            setAudioStreamId(event.audioStreamId);
                            audioStreamIdRef.current = event.audioStreamId;
                        }
                        if (event.subtitleStreamId !== undefined) {
                            setSubtitleStreamId(nextSub);
                            subtitleStreamIdRef.current = nextSub;
                        }
                        if (event.subtitleStreamId !== undefined || event.audioStreamId != null) {
                            writeAvChoiceFromTracks(
                                session.item.grandparentRatingKey || session.item.parentRatingKey,
                                session.item.ratingKey,
                                nextAudio,
                                nextSub,
                                session.audioTracks || [],
                                session.subtitles || [],
                            );
                        }
                        // In-place text-track switch on Direct Play — no stream rebuild / seek break.
                        if (event.reason === 'tracks') return;
                        const changeGen = ++streamChangeGenRef.current;
                        streamRebuildInFlightRef.current = true;
                        // Intentional rebuild — allow DP→HLS→1080 fallbacks again.
                        streamFallbackStageRef.current = 0;
                        nativeFileHlsFallbackRef.current = false;
                        const offset = Math.max(0, Math.floor(event.positionMs ?? currentMsRef.current ?? 0));
                        const previous = playSessionIdFromSrc(playbackSrcRef.current) || session.sessionId;
                        const serverId = session.item.serverId;
                        const ratingKey = session.item.ratingKey;
                        const durationHint = Math.max(0, Math.floor(durationMsRef.current || session.item.durationMs || 0));
                        // Reuse after stop for seek AND quality/audio rebuilds — one Now Playing row.
                        const reuseSessionId = previous || '';
                        const abandonStarted = (startedId: string) => {
                            // Never stop a reused id on cancel — a newer rebuild still owns it.
                            if (startedId && startedId !== reuseSessionId) {
                                void stopPlaybackSession(startedId, serverId, ratingKey, {
                                    timeMs: offset,
                                    durationMs: durationHint,
                                });
                            }
                        };
                        // Seek restarts the same transcode (decision + start at the new
                        // offset). Stopping first kills that session; PMS then 400s the
                        // reused start and Exo buffers forever.
                        if (previous && event.reason !== 'seek') {
                            await stopPlaybackSession(previous, serverId, ratingKey, {
                                timeMs: offset,
                                durationMs: durationHint,
                            });
                        }
                        if (cancelled || gen !== nativeOpenGenRef.current || changeGen !== streamChangeGenRef.current) {
                            if (changeGen === streamChangeGenRef.current) streamRebuildInFlightRef.current = false;
                            return;
                        }
                        const safeQuality = nativeSafeQualityId(nextQuality);
                        let nextSrc = '';
                        let startedId = '';
                        const currentSrc = String(playbackSrcRef.current || '');
                        const currentlyHls = isHlsPlaybackSrc(currentSrc)
                            || /\/hls\//i.test(currentSrc)
                            || /\/video\/:\/transcode\//i.test(currentSrc)
                            || /\/transcode\//i.test(currentSrc);
                        if (isPlexDirectMode()) {
                            // Seek remux always needs HLS. Ladder quality switches stay on HLS.
                            // Returning to Original must NOT force HLS — that blocks Direct Play
                            // (Tautulli keeps showing Transcode after 720→Original).
                            const wantOriginal = safeQuality === 'original';
                            // Seek stays on the open Direct Play. Forcing HLS here starts a
                            // new transcode session for every scrub.
                            const forceHls = currentlyHls && !wantOriginal;
                            // Fresh session when leaving a capped HLS ladder for Original so PMS
                            // does not keep the prior 720/1080 decision on the reused session id.
                            const sessionForStart = (currentlyHls && wantOriginal)
                                ? newPlaySessionId()
                                : (reuseSessionId || undefined);
                            const startOpts = {
                                offsetMs: offset,
                                qualityId: safeQuality,
                                mediaIndex: nextMediaIndex,
                                audioStreamId: nextAudio,
                                subtitleStreamId: nextSub,
                                serverId,
                                delivery: forceHls ? 'hls' as const : undefined,
                                sessionId: sessionForStart,
                            };
                            let fresh = await startMediaPlayerPlayback(ratingKey, startOpts).catch(() => null);
                            // Original←transcode sometimes races stop; retry Direct Play first.
                            if (!fresh?.src && wantOriginal) {
                                for (const waitMs of [250, 600]) {
                                    await new Promise<void>((resolve) => window.setTimeout(resolve, waitMs));
                                    if (cancelled || gen !== nativeOpenGenRef.current || changeGen !== streamChangeGenRef.current) {
                                        if (changeGen === streamChangeGenRef.current) streamRebuildInFlightRef.current = false;
                                        return;
                                    }
                                    fresh = await startMediaPlayerPlayback(ratingKey, {
                                        ...startOpts,
                                        delivery: undefined,
                                        sessionId: newPlaySessionId(),
                                    }).catch(() => null);
                                    if (fresh?.src) break;
                                }
                            }
                            // Last resort for Original: remux HLS if Direct Play still refused.
                            if (!fresh?.src && wantOriginal) {
                                fresh = await startMediaPlayerPlayback(ratingKey, {
                                    ...startOpts,
                                    delivery: 'hls',
                                    sessionId: newPlaySessionId(),
                                }).catch(() => null);
                            }
                            nextSrc = String(fresh?.src || '');
                            startedId = String(fresh?.sessionId || playSessionIdFromSrc(nextSrc) || '');
                        }
                        if (cancelled || gen !== nativeOpenGenRef.current || changeGen !== streamChangeGenRef.current) {
                            abandonStarted(startedId);
                            if (changeGen === streamChangeGenRef.current) streamRebuildInFlightRef.current = false;
                            return;
                        }
                        if (!nextSrc && !(isPlexDirectMode() && event.reason === 'seek' && currentlyHls)) {
                            nextSrc = buildNativePlaybackSrc(ratingKey, {
                                ...session,
                                src: playbackSrcRef.current || session.src,
                                playbackMode: safeQuality === 'original' && session.canDirectPlay
                                    ? 'directPlay'
                                    : 'transcode',
                                qualityId: safeQuality,
                                canDirectPlay: session.canDirectPlay,
                            }, {
                                sessionId: reuseSessionId || newPlaySessionId(),
                                offsetMs: offset,
                                qualityId: safeQuality,
                                audioStreamId: nextAudio,
                                subtitleStreamId: nextSub,
                                mediaIndex: nextMediaIndex,
                            });
                            startedId = playSessionIdFromSrc(nextSrc) || reuseSessionId;
                        }
                        if (!nextSrc && isPlexDirectMode()) {
                            const forced = await startMediaPlayerPlayback(ratingKey, {
                                offsetMs: offset,
                                qualityId: safeQuality,
                                mediaIndex: nextMediaIndex,
                                audioStreamId: nextAudio,
                                subtitleStreamId: nextSub,
                                serverId,
                                delivery: safeQuality === 'original' ? undefined : 'hls',
                                sessionId: newPlaySessionId(),
                            }).catch(() => null);
                            nextSrc = String(forced?.src || '');
                            startedId = String(forced?.sessionId || playSessionIdFromSrc(nextSrc) || '');
                        }
                        if (cancelled || gen !== nativeOpenGenRef.current || changeGen !== streamChangeGenRef.current) {
                            abandonStarted(startedId);
                            if (changeGen === streamChangeGenRef.current) streamRebuildInFlightRef.current = false;
                            return;
                        }
                        if (!nextSrc) {
                            // Stay on the current stream rather than loading an empty URL.
                            // Re-assert current src so native clears the buffering spinner.
                            const stay = String(playbackSrcRef.current || '');
                            if (stay) {
                                const stayAuth = absoluteWithAuth(stay);
                                await updateNativePlayerSrc({
                                    url: stayAuth.url,
                                    headers: stayAuth.headers,
                                    offsetMs: offset,
                                    session: buildNativeSession(nextItemRef.current, {
                                        qualityId: qualityIdRef.current || session.qualityId,
                                        audioStreamId: nextAudio,
                                        subtitleStreamId: nextSub,
                                        mediaIndex: nextMediaIndex,
                                    }),
                                }).catch(() => false);
                            }
                            streamRebuildInFlightRef.current = false;
                            return;
                        }
                        const nextAuth = absoluteWithAuth(nextSrc);
                        // Native first so JS timeline doesn't switch session while Exo still pings the old URL.
                        await updateNativePlayerSrc({
                            url: nextAuth.url,
                            headers: nextAuth.headers,
                            offsetMs: offset,
                            session: buildNativeSession(nextItemRef.current, {
                                qualityId: nextQuality,
                                audioStreamId: nextAudio,
                                subtitleStreamId: nextSub,
                                mediaIndex: nextMediaIndex,
                            }),
                        });
                        if (cancelled || gen !== nativeOpenGenRef.current || changeGen !== streamChangeGenRef.current) {
                            abandonStarted(startedId);
                            if (changeGen === streamChangeGenRef.current) streamRebuildInFlightRef.current = false;
                            return;
                        }
                        playbackSrcRef.current = nextSrc;
                        setPlaybackSrc(nextSrc);
                        setPlaybackMode(playbackModeFromSrc(nextSrc, nextQuality, session.canCopyOriginal));
                        streamRebuildInFlightRef.current = false;
                    },
                    onSubtitleSearch: ({ ratingKey }) => {
                        if (cancelled || gen !== nativeOpenGen) return;
                        const key = String(ratingKey || session.item.ratingKey || '');
                        if (!key) return;
                        void fetchMediaPlayerSubtitleSearch(key, {
                            language: playerSettings.audioLanguage || 'en',
                            serverId: session.item.serverId,
                        }).then(async (data) => {
                            sidecarSubs.splice(0, sidecarSubs.length, ...(data.items || []));
                            await updateNativePlayerSession(buildNativeSession(nextItemRef.current || upNextItem));
                        }).catch(() => {
                            sidecarSubs.splice(0, sidecarSubs.length);
                            void updateNativePlayerSession(buildNativeSession(nextItemRef.current || upNextItem));
                        });
                    },
                    onSubtitleDownload: ({ ratingKey, id, key: downloadKey }) => {
                        if (cancelled || gen !== nativeOpenGen || !id || !downloadKey) return;
                        const key = String(ratingKey || session.item.ratingKey || '');
                        const reply = (sidecarResolved: NativePlayerSessionPayload['sidecarResolved']) => {
                            if (cancelled || gen !== nativeOpenGen) return;
                            void updateNativePlayerSession({
                                ...buildNativeSession(nextItemRef.current || upNextItem),
                                sidecarResolved,
                            });
                        };
                        void downloadMediaPlayerSubtitle(key, downloadKey, { serverId: session.item.serverId })
                            .then((data) => {
                                const row = sidecarSubs.find((sub) => sub.id === id);
                                if (row) {
                                    row.url = data.url;
                                    row.codec = data.codec || row.codec || null;
                                    row.downloadKey = '';
                                }
                                reply({ id, url: data.url });
                            })
                            .catch(() => reply({ id, url: '', failed: true }));
                    },
                    onSpeed: ({ speed: nextSpeed }) => {
                        speedRef.current = nextSpeed;
                        setSpeed(nextSpeed);
                    },
                    onError: () => {
                        if (cancelled || gen !== nativeOpenGen || nativeClosedRef.current) return;
                        if (session.live) return;
                        const current = playbackSrcRef.current;
                        // Match ExoPlayer: DP→HLS, then HLS Original→1080p. Do not open the web player.
                        const absolutePms = /^https?:\/\//i.test(String(current || ''))
                            && !String(current || '').includes('/api/media-player/');
                        const onDirect = isFilePlaybackSrc(current)
                            || isPlexPartPlaybackSrc(current)
                            || (isPlexDirectMode() && absolutePms && !isHlsPlaybackSrc(current));
                        const onHls = isHlsPlaybackSrc(current)
                            || String(current || '').includes('/hls/')
                            || String(current || '').includes('/video/:/transcode/');
                        const stage = streamFallbackStageRef.current;
                        if (onDirect && stage < 1) {
                            streamFallbackStageRef.current = 1;
                            nativeFileHlsFallbackRef.current = true;
                        } else if (onHls && stage < 2) {
                            streamFallbackStageRef.current = 2;
                        } else {
                            return;
                        }
                        const fallbackStage = streamFallbackStageRef.current;
                        void (async () => {
                            const offset = Math.max(0, Math.floor(currentMsRef.current || session.offsetMs || 0));
                            const previous = playSessionIdFromSrc(current) || session.sessionId;
                            if (previous) {
                                await stopPlaybackSession(previous, session.item.serverId, session.item.ratingKey);
                            }
                            if (cancelled || gen !== nativeOpenGenRef.current || nativeClosedRef.current) return;
                            const qualityForStage = fallbackStage >= 2
                                ? '1080-12'
                                : nativeSafeQualityId(qualityIdRef.current || session.qualityId);
                            if (fallbackStage >= 2) {
                                setQualityId(qualityForStage);
                                qualityIdRef.current = qualityForStage;
                            }
                            let hlsSrc = '';
                            if (isPlexPartPlaybackSrc(current) || isPlexDirectMode() || absolutePms || onHls) {
                                const fresh = await startMediaPlayerPlayback(session.item.ratingKey, {
                                    offsetMs: offset,
                                    qualityId: qualityForStage,
                                    audioStreamId: audioStreamIdRef.current || session.audioStreamId,
                                    subtitleStreamId: subtitleStreamIdRef.current ?? session.subtitleStreamId ?? '',
                                    mediaIndex: session.mediaIndex || 0,
                                    serverId: session.item.serverId,
                                    delivery: 'hls',
                                    sessionId: previous || undefined,
                                }).catch(() => null);
                                hlsSrc = String(fresh?.src || '');
                            }
                            if (!hlsSrc) {
                                hlsSrc = buildPlaybackSrc(session.item.ratingKey, {
                                    sessionId: previous || newPlaySessionId(),
                                    offsetMs: offset,
                                    qualityId: qualityForStage,
                                    audioStreamId: audioStreamIdRef.current || session.audioStreamId,
                                    subtitleStreamId: subtitleStreamIdRef.current ?? session.subtitleStreamId ?? '',
                                    directFile: false,
                                    copy: fallbackStage < 2 && session.canCopyOriginal !== false,
                                    mediaIndex: session.mediaIndex || 0,
                                });
                            }
                            if (!hlsSrc || cancelled || gen !== nativeOpenGenRef.current || nativeClosedRef.current) return;
                            playbackSrcRef.current = hlsSrc;
                            setPlaybackSrc(hlsSrc);
                            setPlaybackMode(playbackModeFromSrc(hlsSrc, qualityForStage, session.canCopyOriginal));
                            const nextAuth = absoluteWithAuth(hlsSrc);
                            await updateNativePlayerSrc({
                                url: nextAuth.url,
                                headers: nextAuth.headers,
                                offsetMs: offset,
                                session: buildNativeSession(nextItemRef.current || upNextItem),
                            });
                        })();
                    },
                });
                if (cancelled || gen !== nativeOpenGenRef.current) return;
                if (!nativeClosedRef.current && result) completeNativeSession(result);
                return;
            } catch (err: any) {
                if (!cancelled && !nativeClosedRef.current) {
                    nativeClosedRef.current = true;
                    onPlaybackErrorRef.current?.(String(err?.message || 'Playback failed. Check your connection and try again.'));
                    onCloseRef.current({ ended: false, item: session.item });
                }
                return;
            }
            if (!cancelled) {
                setError('Native player unavailable on this device.');
                setNativeExclusive(false);
            }
        })();
        return () => {
            cancelled = true;
            window.clearTimeout(coverTimer);
            nativeOpenGen += 1;
            nativeOpenGenRef.current = nativeOpenGen;
            nativeLiveRef.current = false;
            nativeMinimizedRef.current = false;
            publishMusicNowPlayingRef.current(false);
            if (!nativeClosedRef.current) void closeNativePlayer();
        };
        // Native player stays open across track swaps; updateSrc handles the rest.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (!nativeLiveRef.current || nativeClosedRef.current) return undefined;
        const live = session;
        const qualityForNative = nativeSafeQualityId(qualityIdRef.current || live.qualityId);
        const nativeAudioId = audioStreamIdRef.current || live.audioStreamId || '';
        const nativeSrc = buildNativePlaybackSrc(live.item.ratingKey, live, {
            qualityId: qualityForNative,
            audioStreamId: nativeAudioId,
            subtitleStreamId: subtitleStreamIdRef.current ?? live.subtitleStreamId ?? '',
            mediaIndex: live.mediaIndex || 0,
            offsetMs: live.offsetMs || 0,
        });
        playbackSrcRef.current = nativeSrc;
        setPlaybackSrc(nativeSrc);
        let cancelled = false;
        (async () => {
            const auth = nativePlaybackAuth(nativeSrc);
            const poster = isMusicPlayerItem(live.item) && live.item.thumb
                ? plexImageUrl(live.item.thumb, 600, 600, { quality: 70 })
                : '';
            await updateNativePlayerSrc({
                url: auth.url,
                headers: auth.headers,
                offsetMs: live.offsetMs || 0,
                session: {
                    ratingKey: live.item.ratingKey,
                    title: live.item.title,
                    subtitle: live.item.showTitle || live.item.seasonTitle || '',
                    // Without this the next item kept the previous one's line (and airdate).
                    meta: isMusicPlayerItem(live.item) ? '' : formatNativePlayerMeta(live.item),
                    music: isMusicPlayerItem(live.item),
                    posterUrl: poster ? nativePlaybackAuth(poster).url : '',
                    durationMs: live.item.durationMs || 0,
                    nextItem: nativeNextItemPayload(playNextQueueRef.current[0] || nextItemRef.current),
                },
            });
            if (!cancelled) publishMusicNowPlayingRef.current();
        })();
        return () => {
            cancelled = true;
        };
    }, [session.sessionId]);

    useEffect(() => {
        if (!nativeExclusive) return undefined;
        let leftForNative = false;
        const dropCover = () => setNativeCover(false);
        const onVisibility = () => {
            if (document.visibilityState === 'hidden') leftForNative = true;
            if (document.visibilityState !== 'visible' || !leftForNative) return;
            dropCover();
        };
        document.addEventListener('visibilitychange', onVisibility);
        window.addEventListener('smp-native-player-returned', dropCover);
        return () => {
            document.removeEventListener('visibilitychange', onVisibility);
            window.removeEventListener('smp-native-player-returned', dropCover);
        };
    }, [nativeExclusive, session.sessionId]);

    useEffect(() => {
        const close = () => {
            // Minimized music: Back should keep browsing / navigating, not kill audio.
            if (nativeMinimizedRef.current && isMusicPlayerItem(sessionRef.current.item)) {
                return false;
            }
            void closeNativePlayer();
            sendTimelineRef.current('stopped');
            onCloseRef.current({ ended: false, item: sessionRef.current.item });
            return true;
        };
        window.__SMP_CLOSE_PLAYBACK__ = close;
        return () => {
            if (window.__SMP_CLOSE_PLAYBACK__ === close) delete window.__SMP_CLOSE_PLAYBACK__;
        };
    }, []);

    useEffect(() => {
        playbackSrcRef.current = playbackSrc;
    }, [playbackSrc]);

    const swapPlaybackSrc = (nextSrc: string, nextMode?: typeof playbackMode) => {
        const previous = playSessionIdFromSrc(playbackSrcRef.current);
        const gen = ++streamRestartGenRef.current;
        if (nextMode) setPlaybackMode(nextMode);
        void stopPlaybackSession(previous, session.item.serverId, session.item.ratingKey).finally(() => {
            if (streamRestartGenRef.current !== gen) return;
            playbackSrcRef.current = nextSrc;
            setPlaybackSrc(nextSrc);
        });
    };

    useEffect(() => {
        if (session.item.type !== 'episode') {
            setNextItem(null);
            setPreviousItem(null);
            return undefined;
        }
        let cancelled = false;
        fetchMediaPlayerNeighbors(session.item.ratingKey, session.item.serverId)
            .then((data) => {
                if (cancelled) return;
                const previous = data.previous || null;
                const next = data.next || null;
                previousItemRef.current = previous;
                nextItemRef.current = next;
                setPreviousItem(previous);
                setNextItem(next);
                if (nativeExclusiveRef.current) {
                    void updateNativePlayerSession({
                        nextItem: nativeNextItemPayload(data.next),
                        previousItem: nativeNextItemPayload(data.previous),
                    });
                }
            })
            .catch(() => {
                if (!cancelled) {
                    previousItemRef.current = null;
                    nextItemRef.current = null;
                    setPreviousItem(null);
                    setNextItem(null);
                }
            });
        return () => { cancelled = true; };
    }, [session.item.ratingKey, session.item.type, session.item.serverId]);

    useEffect(() => {
        if (chrome !== 'theater') return undefined;
        return lockBackgroundScroll();
    }, [chrome]);

    useEffect(() => {
        const video = videoRef.current;
        setPipSupported(canUsePictureInPicture(video));
        if (!video) return undefined;
        const syncPip = () => setPip(isInPictureInPicture(video));
        syncPip();
        video.addEventListener('enterpictureinpicture', syncPip);
        video.addEventListener('leavepictureinpicture', syncPip);
        video.addEventListener('webkitpresentationmodechanged', syncPip);
        return () => {
            video.removeEventListener('enterpictureinpicture', syncPip);
            video.removeEventListener('leavepictureinpicture', syncPip);
            video.removeEventListener('webkitpresentationmodechanged', syncPip);
        };
    }, [playbackSrc]);

    useEffect(() => {
        const sync = () => {
            const ios = videoRef.current as IosVideo | null;
            setFullscreen(!!fullscreenElement() || !!ios?.webkitDisplayingFullscreen);
        };
        document.addEventListener('fullscreenchange', sync);
        document.addEventListener('webkitfullscreenchange', sync);
        videoRef.current?.addEventListener('webkitbeginfullscreen', sync);
        videoRef.current?.addEventListener('webkitendfullscreen', sync);
        sync();
        return () => {
            document.removeEventListener('fullscreenchange', sync);
            document.removeEventListener('webkitfullscreenchange', sync);
            videoRef.current?.removeEventListener('webkitbeginfullscreen', sync);
            videoRef.current?.removeEventListener('webkitendfullscreen', sync);
            void exitPlayerFullscreen();
        };
    }, []);

    useEffect(() => {
        if (!openMenu) return undefined;
        const close = () => setOpenMenu(null);
        const timer = window.setTimeout(() => window.addEventListener('click', close), 0);
        return () => {
            window.clearTimeout(timer);
            window.removeEventListener('click', close);
        };
    }, [openMenu]);

    useEffect(() => {
        if (nativeExclusive || isPlexNativePlayback()) return undefined;
        const video = videoRef.current;
        if (!video) return undefined;
        const src = portalUrl(playbackSrc);
        let cancelled = false;
        setError(null);
        setReady(false);
        setPaused(true);

        const startAt = isHlsPlaybackSrc(playbackSrc) ? 0 : offsetMsFromSrc(playbackSrc) / 1000;
        const applyLocalPlayback = () => {
            video.volume = volumeRef.current * (playerSettings.nightMode ? 0.55 : 1);
            video.muted = mutedRef.current;
            video.playbackRate = speedRef.current;
        };
        const onReady = () => {
            if (cancelled) return;
            if (startAt > 1 && Math.abs(video.currentTime - startAt) > 1) {
                video.currentTime = startAt;
            }
            applyLocalPlayback();
            setReady(true);
            void video.play().then(() => {
                if (!cancelled) setPaused(false);
            }).catch(() => {
                if (!cancelled) setPaused(true);
            });
        };

        const fail = (message?: string) => {
            if (cancelled) return;
            if (session.live) {
                setError(message || t('mediaPlayerPage.playError'));
                return;
            }
            const offset = Math.max(
                0,
                Math.floor(((video.currentTime || 0) * 1000) || currentMsRef.current || session.offsetMs || 0),
            );
            // Browser: force AAC remux (copy=false) — EAC3 Direct Stream HLS is unplayable in hls.js.
            // Native Exo keeps copy when possible (handled on the native onError path).
            if (streamFallbackStageRef.current < 1) {
                streamFallbackStageRef.current = 1;
                fallbackUsedRef.current = true;
                const nextSrc = buildPlaybackSrc(session.item.ratingKey, {
                    sessionId: newPlaySessionId(),
                    offsetMs: offset,
                    qualityId: qualityId || session.qualityId || 'original',
                    audioStreamId,
                    subtitleStreamId,
                    directFile: false,
                    copy: false,
                    mediaIndex: session.mediaIndex || 0,
                });
                if (nextSrc !== playbackSrc) {
                    swapPlaybackSrc(nextSrc, 'transcode');
                    return;
                }
            }
            if (streamFallbackStageRef.current < 2) {
                streamFallbackStageRef.current = 2;
                const nextSrc = buildPlaybackSrc(session.item.ratingKey, {
                    sessionId: newPlaySessionId(),
                    offsetMs: offset,
                    qualityId: '1080-12',
                    audioStreamId,
                    subtitleStreamId,
                    directFile: false,
                    copy: false,
                    mediaIndex: session.mediaIndex || 0,
                });
                if (nextSrc !== playbackSrc) {
                    setQualityId('1080-12');
                    qualityIdRef.current = '1080-12';
                    swapPlaybackSrc(nextSrc, 'transcode');
                    return;
                }
            }
            setError(message || t('mediaPlayerPage.playError'));
        };

        const startPlain = () => {
            video.src = src;
            video.addEventListener('loadedmetadata', onReady, { once: true });
            video.addEventListener('error', () => fail(), { once: true });
        };

        // hls.js loads on first use; a browser without MSE falls back to the plain element.
        const startHlsJs = (unsupported: () => void) => {
            void loadHls().then((HlsJs) => {
                if (cancelled) return;
                if (!HlsJs.isSupported()) { unsupported(); return; }
                attachHlsJs(HlsJs);
            }).catch(() => { if (!cancelled) fail(); });
        };

        const attachHlsJs = (HlsJs: typeof Hls) => {
            const hls = new HlsJs({
                enableWorker: false,
                lowLatencyMode: false,
                manifestLoadingTimeOut: 60_000,
                levelLoadingTimeOut: 60_000,
                fragLoadingTimeOut: 60_000,
                manifestLoadingMaxRetry: 2,
                levelLoadingMaxRetry: 2,
                fragLoadingMaxRetry: 3,
                xhrSetup: (xhr) => {
                    xhr.withCredentials = true;
                    try {
                        xhr.setRequestHeader(PORTAL_CSRF_HEADER, PORTAL_CSRF_VALUE);
                    } catch {
                        /* ignore forbidden header environments */
                    }
                },
            });
            hlsRef.current = hls;
            hls.loadSource(src);
            hls.attachMedia(video);
            hls.on(HlsJs.Events.MANIFEST_PARSED, onReady);
            hls.on(HlsJs.Events.ERROR, (_event, data) => {
                if (!data?.fatal) return;
                try { hls.destroy(); } catch { /* ignore */ }
                hlsRef.current = null;
                fail(hlsErrorMessage(data, t('mediaPlayerPage.playError')));
            });
        };

        const nativeHls = canUseNativeHls();
        if (isHlsPlaybackSrc(playbackSrc) && nativeHls) {
            video.src = src;
            video.addEventListener('loadedmetadata', onReady, { once: true });
            video.addEventListener('error', () => {
                if (cancelled) return;
                video.removeAttribute('src');
                startHlsJs(() => fail());
            }, { once: true });
        } else if (isHlsPlaybackSrc(playbackSrc)) {
            startHlsJs(startPlain);
        } else {
            startPlain();
        }

        return () => {
            cancelled = true;
            video.removeEventListener('loadedmetadata', onReady);
            hlsRef.current?.destroy();
            hlsRef.current = null;
            video.removeAttribute('src');
            video.load();
            if (!nativeExclusiveRef.current) {
                void stopMediaPlayerTranscode(playSessionIdFromSrc(playbackSrc));
            }
        };
    }, [playbackSrc, t, nativeExclusive]);

    useEffect(() => {
        const ratingKey = session.item.ratingKey;
        const sessionId = playSessionIdFromSrc(playbackSrc) || session.sessionId;
        if (!ratingKey || !sessionId) return undefined;
        if (session.offlineLocal) {
            sendTimelineRef.current = () => {};
            return () => { sendTimelineRef.current = () => {}; };
        }
        const send = (
            state: 'playing' | 'paused' | 'buffering' | 'stopped',
            timeOverride?: number,
            extra?: { ended?: boolean; watchedHandled?: boolean },
        ) => {
            // Rebuild owns stop/start — don't revive the old session mid-swap.
            if (state !== 'stopped' && streamRebuildInFlightRef.current) return;
            if (session.live) {
                if (state === 'stopped') {
                    void stopPlaybackSession(sessionId, session.item.serverId, ratingKey, { live: true });
                    return;
                }
                void reportMediaPlayerTimeline({
                    ratingKey,
                    sessionId,
                    state,
                    timeMs: Math.max(0, Math.floor(timeOverride ?? currentMsRef.current ?? 0)),
                    durationMs: 0,
                    serverId: session.item.serverId,
                });
                return;
            }
            const video = nativeExclusive ? null : videoRef.current;
            const timeMs = timeOverride != null
                ? Math.max(0, Math.floor(timeOverride))
                : Math.max(0, Math.floor((video ? video.currentTime * 1000 : currentMsRef.current) || 0));
            const nextDuration = Math.max(
                0,
                Math.floor((video && Number.isFinite(video.duration) && video.duration > 0
                    ? video.duration * 1000
                    : durationMsRef.current) || session.item.durationMs || 0),
            );
            const creditsStartMs = Number(session.markers?.credits?.startMs);
            const finished = state === 'stopped' && isPlaybackFinished(timeMs, nextDuration, {
                ended: extra?.ended === true,
                creditsStartMs: Number.isFinite(creditsStartMs) && creditsStartMs > 0 ? creditsStartMs : null,
            });
            if (state === 'stopped') {
                const queued = playNextQueueRef.current[0];
                const neighbor = nextItemRef.current;
                const next = session.item.type === 'episode'
                    ? (queued?.ratingKey && queued.ratingKey !== session.item.ratingKey ? queued : neighbor)
                    : null;
                rememberPlaybackProgress(session.item, timeMs, nextDuration, next, {
                    ended: extra?.ended === true,
                    creditsStartMs: Number.isFinite(creditsStartMs) && creditsStartMs > 0 ? creditsStartMs : null,
                });
                // Native already marked it watched (or PMS did): a second scrobble adds a play.
                if (finished && !extra?.watchedHandled) {
                    void setMediaPlayerWatched(ratingKey, true, session.item, { skipNote: true });
                }
                void stopPlaybackSession(sessionId, session.item.serverId, ratingKey);
            }
            void reportMediaPlayerTimeline({
                ratingKey,
                sessionId,
                state,
                timeMs: finished ? 0 : timeMs,
                durationMs: nextDuration,
                audioStreamId: audioStreamIdFromSrc(playbackSrc) || audioStreamId,
                subtitleStreamId: isFilePlaybackSrc(playbackSrc) ? '' : subtitleStreamIdFromSrc(playbackSrc),
                serverId: session.item.serverId,
            });
        };
        sendTimelineRef.current = send;
        const seedState = nativeExclusive ? nativeTimelineStateRef.current : 'playing';
        send(seedState, nativeExclusive ? (currentMsRef.current || session.offsetMs || 0) : undefined);
        const timer = window.setInterval(() => {
            if (nativeExclusive) {
                send(nativeTimelineStateRef.current, currentMsRef.current);
                return;
            }
            const video = videoRef.current;
            send(video && !video.paused ? 'playing' : 'paused');
        }, 5000);
        return () => {
            window.clearInterval(timer);
            sendTimelineRef.current = () => {};
            if (!nativeExclusiveRef.current) send('stopped');
        };
    }, [session.item.ratingKey, session.sessionId, session.offlineLocal, playbackSrc, audioStreamId, nativeExclusive]);

    useEffect(() => {
        if (!('mediaSession' in navigator)) return undefined;
        const thumb = session.item.thumb ? plexImageUrl(session.item.thumb, 300, 450, { quality: PLAYER_POSTER_QUALITY }) : '';
        navigator.mediaSession.metadata = new MediaMetadata({
            title: session.item.title,
            artist: session.item.showTitle || 'Media Player',
            album: session.item.seasonTitle || '',
            artwork: thumb ? [{ src: thumb, sizes: '512x512', type: 'image/jpeg' }] : [],
        });
        const playCurrent = (item: PlayerItem | null) => {
            if (!item) return;
            if (queuedNextKeyRef.current && queuedNextKeyRef.current === item.ratingKey) {
                onConsumePlayNextRef.current?.();
            }
            onPlayItemRef.current?.(item, { offsetMs: 0, skipResume: true });
        };
        try {
            navigator.mediaSession.setActionHandler('play', () => { void videoRef.current?.play(); });
            navigator.mediaSession.setActionHandler('pause', () => { videoRef.current?.pause(); });
            navigator.mediaSession.setActionHandler('seekbackward', () => seekBySynced(-10));
            navigator.mediaSession.setActionHandler('seekforward', () => seekBySynced(10));
            navigator.mediaSession.setActionHandler('previoustrack', () => {
                if (previousItemRef.current) playCurrent(previousItemRef.current);
                else seekBySynced(-10);
            });
            navigator.mediaSession.setActionHandler('nexttrack', () => playCurrent(nextItemRef.current));
        } catch {
            /* older browsers reject some handlers */
        }
        return () => {
            navigator.mediaSession.metadata = null;
            for (const action of ['play', 'pause', 'seekbackward', 'seekforward', 'previoustrack', 'nexttrack']) {
                try { navigator.mediaSession.setActionHandler(action as MediaSessionAction, null); } catch { /* ignore */ }
            }
        };
    }, [session.item.ratingKey, session.item.title, session.item.showTitle, session.item.seasonTitle, session.item.thumb]);

    const toggleFullscreen = () => {
        if (fullscreenElement()) return exitPlayerFullscreen();
        return requestPlayerFullscreen(overlayRef.current, videoRef.current);
    };

    const closePlayer = () => {
        void exitPlayerFullscreen();
        void exitPictureInPicture(videoRef.current);
        onClose({ ended: false, item: session.item });
    };

    const enterMini = () => {
        void exitPlayerFullscreen();
        setOpenMenu(null);
        setMiniWidth(readMiniPlayerWidth());
        setChrome('mini');
    };

    const enterTheater = () => {
        void exitPictureInPicture(videoRef.current);
        setChrome('theater');
    };

    const togglePip = async () => {
        const video = videoRef.current;
        if (!video) return;
        try {
            if (isInPictureInPicture(video)) {
                await exitPictureInPicture(video);
                return;
            }
            await requestPictureInPicture(video);
            setChrome('mini');
        } catch {
            /* unsupported or gesture blocked */
        }
    };

    const remaining = Math.max(0, durationMs - currentMs);
    const skipIntroMode = playerSettings.skipIntroMode || (autoSkipIntro ? 'auto' : 'manual');
    const skipCreditsMode = playerSettings.skipCreditsMode || (autoSkipCredits ? 'auto' : 'manual');
    const inIntroRange = !!(markers.intro && !skippedIntro && currentMs >= markers.intro.startMs && currentMs < markers.intro.endMs);
    const inCreditsRange = !!(markers.credits && !skippedCredits && currentMs >= markers.credits.startMs);
    const inIntro = skipIntroMode !== 'off' && inIntroRange;
    const inCredits = skipCreditsMode !== 'off' && inCreditsRange;
    const creditsStartMs = markers.credits && markers.credits.startMs > 0 ? markers.credits.startMs : -1;
    // Same window as the TV player: credits marker, or two minutes before the end.
    const upNextAtMs = durationMs > 30000
        ? Math.min(
            creditsStartMs >= 0 ? creditsStartMs : Number.POSITIVE_INFINITY,
            Math.max(0, durationMs - 120_000),
        )
        : Number.POSITIVE_INFINITY;
    const nearEnd = Number.isFinite(upNextAtMs) && currentMs >= upNextAtMs;
    const showUpNext = !!upNextItem && !dismissedUpNext && durationMs > 30000 && (
        !!queuedNext || session.item.type === 'episode' || session.item.type === 'track'
    ) && (
        inCredits || nearEnd
    );
    const showMoreLikeThis = !showUpNext
        && relatedItems.length > 0
        && durationMs > 30000
        && (inCredits || nearEnd || dismissedUpNext)
        && (session.item.type === 'movie' || session.item.type === 'episode' || !upNextItem);

    const playUpNext = useCallback((item: PlayerItem | null) => {
        if (!item) return;
        if (queuedNext && queuedNext.ratingKey === item.ratingKey) {
            onConsumePlayNextRef.current?.();
        }
        onPlayItem?.(item, { offsetMs: 0, skipResume: true });
    }, [onPlayItem, queuedNext]);

    useEffect(() => {
        if (!showUpNext || !autoplayNext || !upNextItem) {
            setUpNextIn(10);
            return undefined;
        }
        setUpNextIn(10);
        const timer = window.setInterval(() => {
            setUpNextIn((n) => {
                if (n <= 1) {
                    window.clearInterval(timer);
                    const next = nextItemRef.current;
                    if (next) {
                        if (queuedNextKeyRef.current && queuedNextKeyRef.current === next.ratingKey) {
                            onConsumePlayNextRef.current?.();
                        }
                        onPlayItemRef.current?.(next, { offsetMs: 0, skipResume: true, fromAutoplay: true });
                    }
                    return 0;
                }
                return n - 1;
            });
        }, 1000);
        return () => window.clearInterval(timer);
    }, [showUpNext, autoplayNext, upNextItem]);

    // Prefetch related hubs near the end for “More like this” (prefer show key for episodes).
    useEffect(() => {
        const key = String(
            session.item.grandparentRatingKey
            || session.item.ratingKey
            || '',
        ).trim();
        if (!key || relatedItemsRef.current.length) return undefined;
        const nearCredits = markers.credits
            ? currentMs >= Math.max(0, markers.credits.startMs - 120_000)
            : remaining > 0 && remaining <= 180_000;
        if (!nearCredits && !inCredits) return undefined;
        let cancelled = false;
        void fetchMediaPlayerItemMore(key, session.item.serverId).then((more) => {
            if (cancelled) return;
            const rows = (more?.related || [])
                .flatMap((hub) => hub.items || [])
                .filter((row) => row?.ratingKey && row.ratingKey !== session.item.ratingKey)
                .slice(0, 5);
            if (!rows.length) return;
            setRelatedItems(rows);
            if (nativeExclusiveRef.current) {
                void updateNativePlayerSession({
                    relatedItems: rows.map((row) => ({
                        ratingKey: row.ratingKey,
                        title: row.title,
                        thumb: row.thumb || undefined,
                    })),
                });
            }
        }).catch(() => undefined);
        return () => { cancelled = true; };
    }, [
        currentMs,
        inCredits,
        markers.credits,
        remaining,
        session.item.grandparentRatingKey,
        session.item.ratingKey,
        session.item.serverId,
    ]);

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            const tag = String((event.target as HTMLElement | null)?.tagName || '').toLowerCase();
            if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
            if (chrome === 'mini' && !overlayRef.current?.contains(event.target as Node)) return;
            if (event.key === 'Escape' || event.key === 'BrowserBack' || event.key === 'GoBack') {
                if (openMenu) {
                    event.preventDefault();
                    setOpenMenu(null);
                    return;
                }
                if (showUpNext) {
                    event.preventDefault();
                    setDismissedUpNext(true);
                    return;
                }
                if (fullscreenElement()) return;
                if (chrome === 'mini') return;
                closePlayer();
            }
            if (event.key === ' ') {
                event.preventDefault();
                togglePlayback();
            }
            if (event.key === 'ArrowLeft') {
                event.preventDefault();
                seekBySynced(-10);
            }
            if (event.key === 'ArrowRight') {
                event.preventDefault();
                seekBySynced(10);
            }
            if (event.key === 'MediaTrackNext' || event.key === 'PageDown') {
                event.preventDefault();
                skipChapter(videoRef.current, session.item.chapters, 1);
            }
            if (event.key === 'MediaTrackPrevious' || event.key === 'PageUp') {
                event.preventDefault();
                skipChapter(videoRef.current, session.item.chapters, -1);
            }
            if ((event.key === 'm' || event.key === 'M') && !event.metaKey && !event.ctrlKey) {
                event.preventDefault();
                const video = videoRef.current;
                if (!video) return;
                video.muted = !video.muted;
                setMuted(video.muted);
            }
            if ((event.key === 'f' || event.key === 'F') && !event.metaKey && !event.ctrlKey && !event.altKey) {
                event.preventDefault();
                if (chrome === 'mini') enterTheater();
                else void toggleFullscreen();
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [chrome, onClose, openMenu, session.item.chapters, showUpNext]);

    const applyStreamChange = (patch: {
        qualityId?: string;
        audioStreamId?: string;
        subtitleStreamId?: string | null;
    }) => {
        const nextQuality = patch.qualityId ?? qualityId;
        const nextAudio = patch.audioStreamId ?? audioStreamId;
        const nextSub = patch.subtitleStreamId !== undefined ? (patch.subtitleStreamId || '') : subtitleStreamId;
        if (nextQuality === qualityId && nextAudio === audioStreamId && nextSub === subtitleStreamId) {
            setOpenMenu(null);
            return;
        }
        if (patch.qualityId != null) setQualityId(patch.qualityId);
        if (patch.audioStreamId != null) setAudioStreamId(patch.audioStreamId);
        if (patch.subtitleStreamId !== undefined) setSubtitleStreamId(nextSub);
        if (patch.subtitleStreamId !== undefined || patch.audioStreamId != null) {
            writeAvChoiceFromTracks(
                session.item.grandparentRatingKey || session.item.parentRatingKey,
                session.item.ratingKey,
                nextAudio,
                nextSub,
                audioTracks,
                subtitles,
            );
        }
        setOpenMenu(null);
        const offset = Math.max(
            0,
            Math.floor(((videoRef.current?.currentTime || 0) * 1000) || currentMsRef.current || 0),
        );
        const audioUnchanged = !nextAudio || nextAudio === (session.audioStreamId || audioStreamId);
        const directFile = audioUnchanged && nativeDirectPlayEligible({
            canDirectPlay: session.canDirectPlay,
            playbackMode: session.playbackMode,
            qualityId: nextQuality,
            audioStreamId: nextAudio,
            subtitleStreamId: nextSub,
            audioTracks,
            subtitles,
            source: session.source,
        }, { qualityId: nextQuality, audioStreamId: nextAudio, subtitleStreamId: nextSub });
        const nextSrc = buildPlaybackSrc(session.item.ratingKey, {
            sessionId: newPlaySessionId(),
            offsetMs: offset,
            qualityId: nextQuality,
            audioStreamId: nextAudio,
            subtitleStreamId: nextSub,
            directFile,
            copy: nextQuality !== 'original' || session.canCopyOriginal !== false,
            mediaIndex: session.mediaIndex || 0,
        });
        fallbackUsedRef.current = false;
        setError(null);
        swapPlaybackSrc(nextSrc, playbackModeFromSrc(nextSrc, nextQuality, session.canCopyOriginal));
    };

    const togglePlayback = () => {
        const video = videoRef.current;
        const rewindSec = Number(playerSettings.rewindOnResumeSec) || 0;
        if (nativeLiveRef.current) {
            const nextPaused = !paused;
            // Native PlayerActivity applies rewind-on-resume itself.
            void setNativePlayerPaused(nextPaused);
            setPaused(nextPaused);
            if (watchTogetherRef.current && !applyingRemoteRef.current) {
                const pos = Math.max(0, Math.floor(currentMsRef.current || 0));
                if (nextPaused) getWatchTogetherClient().pause(pos);
                else getWatchTogetherClient().play(pos);
            }
            return;
        }
        if (!video) return;
        if (video.paused) {
            if (rewindSec > 0 && pausePositionMsRef.current >= 0) {
                const target = Math.max(0, pausePositionMsRef.current - rewindSec * 1000);
                video.currentTime = target / 1000;
                pausePositionMsRef.current = -1;
            }
            void video.play();
            setPaused(false);
            if (watchTogetherRef.current && !applyingRemoteRef.current) {
                getWatchTogetherClient().play(Math.max(0, Math.floor((video.currentTime || 0) * 1000)));
            }
        } else {
            pausePositionMsRef.current = Math.max(0, Math.floor((video.currentTime || 0) * 1000));
            video.pause();
            setPaused(true);
            if (watchTogetherRef.current && !applyingRemoteRef.current) {
                getWatchTogetherClient().pause(Math.max(0, Math.floor((video.currentTime || 0) * 1000)));
            }
        }
    };

    const skipIntro = () => {
        const video = videoRef.current;
        if (!video || !markers.intro) return;
        video.currentTime = markers.intro.endMs / 1000;
        setSkippedIntro(true);
        sendTimelineRef.current('playing');
    };

    const skipCredits = () => {
        setSkippedCredits(true);
        if (upNextItem) {
            playUpNext(upNextItem);
            return;
        }
        const video = videoRef.current;
        if (!video) return;
        video.currentTime = Math.max(0, (durationMs - 1000) / 1000);
    };

    useEffect(() => {
        if (skipIntroMode !== 'auto' || !inIntroRange || !ready) return;
        skipIntro();
    }, [skipIntroMode, inIntroRange, ready]);

    useEffect(() => {
        if (skipCreditsMode !== 'auto' || !inCreditsRange || !ready) return;
        skipCredits();
    }, [skipCreditsMode, inCreditsRange, upNextItem, ready]);

    const theater = chrome === 'theater';
    const showBars = !theater || controlsVisible || paused || !!error || !!openMenu;
    const bumpControls = useCallback(() => {
        setControlsVisible(true);
        window.clearTimeout(hideTimerRef.current);
        if (chrome !== 'theater' || paused || error || openMenu) return;
        hideTimerRef.current = window.setTimeout(() => setControlsVisible(false), 2800);
    }, [chrome, error, openMenu, paused]);

    useEffect(() => {
        const onWindowResize = () => setMiniWidth((width) => clampMiniPlayerWidth(width));
        window.addEventListener('resize', onWindowResize);
        return () => window.removeEventListener('resize', onWindowResize);
    }, []);

    useEffect(() => {
        const restoreBody = () => {
            const drag = miniDragRef.current;
            document.body.style.cursor = drag?.previousCursor || '';
            document.body.style.userSelect = drag?.previousUserSelect || '';
        };
        const onMove = (event: PointerEvent) => {
            const drag = miniDragRef.current;
            if (!drag || event.pointerId !== drag.pointerId) return;
            event.preventDefault();
            const dx = drag.startX - event.clientX;
            const dy = drag.startY - event.clientY;
            const delta = drag.axis === 'x'
                ? dx
                : drag.axis === 'y'
                    ? dy * (16 / 9)
                    : Math.max(dx, dy * (16 / 9));
            setMiniWidth(clampMiniPlayerWidth(drag.startWidth + delta));
        };
        const onUp = (event: PointerEvent) => {
            const drag = miniDragRef.current;
            if (!drag || event.pointerId !== drag.pointerId) return;
            restoreBody();
            miniDragRef.current = null;
            setMiniResizing(false);
            setMiniWidth((width) => {
                const next = clampMiniPlayerWidth(width);
                writeMiniPlayerWidth(next);
                return next;
            });
        };
        window.addEventListener('pointermove', onMove, { passive: false });
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onUp);
        return () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            window.removeEventListener('pointercancel', onUp);
            restoreBody();
        };
    }, []);

    const beginMiniResize = (event: React.PointerEvent, axis: 'both' | 'x' | 'y' = 'both') => {
        if (theater) return;
        event.preventDefault();
        event.stopPropagation();
        miniDragRef.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            startWidth: miniWidth,
            axis,
            previousCursor: document.body.style.cursor,
            previousUserSelect: document.body.style.userSelect,
        };
        setMiniResizing(true);
        document.body.style.userSelect = 'none';
        document.body.style.cursor = axis === 'x' ? 'ew-resize' : axis === 'y' ? 'ns-resize' : 'nwse-resize';
        try {
            event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
            /* capture is optional */
        }
    };

    const nudgeMiniWidth = (delta: number) => {
        setMiniWidth((width) => {
            const next = clampMiniPlayerWidth(width + delta);
            writeMiniPlayerWidth(next);
            return next;
        });
    };

    const resetMiniWidth = () => {
        const next = clampMiniPlayerWidth(DEFAULT_MINI_PLAYER_WIDTH);
        setMiniWidth(next);
        writeMiniPlayerWidth(next);
    };

    useEffect(() => {
        bumpControls();
        return () => window.clearTimeout(hideTimerRef.current);
    }, [bumpControls]);

    const qualityChip = String(qualityId || session.qualityId || '').trim();
    const qualityShort = qualityChip === 'original' || !qualityChip
        ? ''
        : qualityChip.replace(/-/g, 'p · ').replace(/^(\d+)p/, '$1p');
    const modeLabel = session.live
        ? t('mediaPlayerPage.playbackLive')
        : playbackMode === 'directPlay'
        ? t('mediaPlayerPage.playbackDirectPlay')
        : playbackMode === 'directStream'
            ? t('mediaPlayerPage.playbackDirectStream')
            : [
                t('mediaPlayerPage.playbackTranscode'),
                qualityShort || (streamFallbackStageRef.current >= 2 ? '1080p' : ''),
            ].filter(Boolean).join(' · ');
    const sourceRes = formatPlayerResolution(session.source?.height, session.source?.videoResolution);
    const sourceCodec = String(session.source?.videoCodec || '').toUpperCase();
    const seekTo = (ms: number) => {
        const next = Math.max(0, Math.min(durationMs || Number.MAX_SAFE_INTEGER, ms));
        if (nativeLiveRef.current) {
            void seekNativePlayer(next);
            setCurrentMs(next);
            currentMsRef.current = next;
            if (watchTogetherRef.current && !applyingRemoteRef.current) {
                getWatchTogetherClient().seek(next, !paused);
            }
            bumpControls();
            return;
        }
        const video = videoRef.current;
        if (!video || !durationMs) return;
        video.currentTime = next / 1000;
        setCurrentMs(next);
        sendTimelineRef.current('playing');
        if (watchTogetherRef.current && !applyingRemoteRef.current) {
            getWatchTogetherClient().seek(next, !video.paused);
        }
        bumpControls();
    };
    const seekBySynced = (deltaSeconds: number) => {
        if (nativeLiveRef.current) {
            const next = Math.max(0, Math.min(
                durationMsRef.current || Number.MAX_SAFE_INTEGER,
                (currentMsRef.current || 0) + (deltaSeconds * 1000),
            ));
            seekTo(next);
            return;
        }
        const video = videoRef.current;
        if (!video) return;
        seekBy(video, deltaSeconds);
        if (watchTogetherRef.current && !applyingRemoteRef.current) {
            getWatchTogetherClient().seek(
                Math.max(0, Math.floor((video.currentTime || 0) * 1000)),
                !video.paused,
            );
        }
    };
    const retryPlayback = () => {
        setError(null);
        fallbackUsedRef.current = false;
        const offset = Math.max(0, Math.floor(currentMsRef.current || session.offsetMs || 0));
        fallbackUsedRef.current = false;
        swapPlaybackSrc(buildPlaybackSrc(session.item.ratingKey, {
            sessionId: newPlaySessionId(),
            offsetMs: offset,
            qualityId: qualityId || session.qualityId || 'original',
            audioStreamId,
            subtitleStreamId,
            directFile: nativeDirectPlayEligible({
                canDirectPlay: session.canDirectPlay,
                playbackMode: session.playbackMode,
                qualityId: qualityId || session.qualityId,
                audioStreamId,
                subtitleStreamId,
                audioTracks: session.audioTracks,
                subtitles: session.subtitles,
                source: session.source,
            }, { qualityId: qualityId || session.qualityId, audioStreamId, subtitleStreamId }),
            copy: (qualityId || session.qualityId) !== 'original' || session.canCopyOriginal !== false,
            mediaIndex: session.mediaIndex || 0,
        }));
    };
    const handleVideoClick = (event: React.MouseEvent<HTMLVideoElement>) => {
        bumpControls();
        if ((event.nativeEvent as PointerEvent).pointerType === 'touch') return;
        if (event.detail >= 2) {
            window.clearTimeout(clickTimerRef.current);
            return;
        }
        window.clearTimeout(clickTimerRef.current);
        clickTimerRef.current = window.setTimeout(() => togglePlayback(), 220);
    };
    const handleVideoDoubleClick = (event: React.MouseEvent<HTMLVideoElement>) => {
        event.preventDefault();
        window.clearTimeout(clickTimerRef.current);
        if (chrome === 'mini') enterTheater();
        else void toggleFullscreen();
    };
    const handleVideoPointerUp = (event: React.PointerEvent<HTMLVideoElement>) => {
        if (event.pointerType !== 'touch') return;
        const rect = event.currentTarget.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const now = Date.now();
        const last = lastTapRef.current;
        bumpControls();
        if (last && now - last.at < 280 && Math.abs(x - last.x) < 90) {
            lastTapRef.current = null;
            window.clearTimeout(clickTimerRef.current);
            const third = rect.width / 3;
            if (x < third) seekBySynced(-10);
            else if (x > third * 2) seekBySynced(10);
            else togglePlayback();
            return;
        }
        lastTapRef.current = { at: now, x };
    };
    const playNeighbor = (item: PlayerItem | null) => {
        playUpNext(item);
    };

    if (nativeExclusive) {
        if (nativeMinimized && !error) return null;
        const showCover = !!error || nativeCover;
        return createPortal(
            <div
                className={`fixed inset-0 z-[4000] flex items-center justify-center ${showCover ? 'bg-black' : 'bg-transparent pointer-events-none'}`}
                {...(showCover ? { 'data-tv-playback-overlay': '1' } : {})}
                aria-hidden={!error}
            >
                {error ? (
                    <div className="max-w-md px-6 text-center text-sm text-white/90" data-tv-playback="1">
                        <p>{error}</p>
                        <button
                            type="button"
                            data-tv-item="1"
                            data-tv-action="1"
                            className="player-page-back mt-4 rounded-lg bg-white/15 px-4 py-2 font-semibold text-white"
                            onClick={onClose}
                        >
                            {t('mediaPlayerPage.back')}
                        </button>
                    </div>
                ) : nativeCover ? (
                    <Loader2 className="h-8 w-8 animate-spin text-white/70" />
                ) : null}
            </div>,
            document.body,
        );
    }

    const overlay = (
        <div
            ref={overlayRef}
            className={`${theater
                ? `fixed inset-0 z-[4000] flex h-full w-full flex-col bg-black ${showBars ? '' : 'cursor-none'}`
                : `fixed bottom-4 right-4 z-[3200] flex flex-col overflow-hidden rounded-2xl border border-white/15 bg-black shadow-2xl ${miniResizing ? 'cursor-nwse-resize' : ''}`}`}
            style={theater ? undefined : { width: miniWidth }}
            role={theater ? 'dialog' : 'region'}
            aria-modal={theater}
            aria-label={session.item.title}
            onMouseMove={bumpControls}
            onPointerDown={bumpControls}
        >
            {!theater ? (
                <>
                    <div
                        className="absolute inset-y-0 left-0 z-20 w-2 cursor-ew-resize touch-none"
                        onPointerDown={(event) => beginMiniResize(event, 'x')}
                    />
                    <div
                        className="absolute inset-x-8 top-0 z-20 h-2 cursor-ns-resize touch-none"
                        onPointerDown={(event) => beginMiniResize(event, 'y')}
                    />
                    <div
                        role="slider"
                        tabIndex={0}
                        aria-label={t('mediaPlayerPage.resizeMiniplayer')}
                        aria-orientation="horizontal"
                        aria-valuemin={MIN_MINI_PLAYER_WIDTH}
                        aria-valuemax={960}
                        aria-valuenow={miniWidth}
                        className="absolute left-0 top-0 z-30 h-10 w-10 cursor-nwse-resize touch-none"
                        onPointerDown={(event) => beginMiniResize(event, 'both')}
                        onDoubleClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            resetMiniWidth();
                        }}
                        onKeyDown={(event) => {
                            if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
                                event.preventDefault();
                                nudgeMiniWidth(24);
                            } else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
                                event.preventDefault();
                                nudgeMiniWidth(-24);
                            } else if (event.key === 'Home') {
                                event.preventDefault();
                                const next = clampMiniPlayerWidth(MIN_MINI_PLAYER_WIDTH);
                                setMiniWidth(next);
                                writeMiniPlayerWidth(next);
                            } else if (event.key === 'End') {
                                event.preventDefault();
                                const next = clampMiniPlayerWidth(960);
                                setMiniWidth(next);
                                writeMiniPlayerWidth(next);
                            }
                        }}
                    >
                        <span className="pointer-events-none absolute left-1.5 top-1.5 h-3.5 w-3.5 rounded-tl-md border-l-2 border-t-2 border-white/85 drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)]" />
                    </div>
                </>
            ) : null}
            <div className={`absolute inset-x-0 top-0 z-10 flex items-center justify-between gap-3 transition-opacity ${theater ? 'bg-gradient-to-b from-black/80 to-transparent p-4' : 'bg-black/80 py-2 pr-2 pl-9'} ${showBars ? 'opacity-100' : 'pointer-events-none opacity-0'}`}>
                <div className="min-w-0">
                    {showChromeLogo ? (
                        <>
                            {session.item.showTitle ? (
                                <p className="truncate text-sm font-bold text-white">{session.item.title}</p>
                            ) : (
                                <span className="sr-only">{session.item.title}</span>
                            )}
                            <PlayerClearLogo
                                src={chromeLogoUrl}
                                alt={session.item.showTitle || session.item.title}
                                className={`${theater ? 'h-10 sm:h-12' : 'h-7'} w-auto max-w-[min(100%,18rem)] object-contain object-left drop-shadow-[0_8px_18px_rgba(0,0,0,0.75)]`}
                                onError={() => setChromeLogoFailed(true)}
                            />
                        </>
                    ) : (
                        <>
                            <p className="truncate text-sm font-bold text-white">{session.item.title}</p>
                            {session.item.showTitle ? (
                                <p className="truncate text-xs text-white/70">{session.item.showTitle}</p>
                            ) : null}
                        </>
                    )}
                    {chromeDetails.length ? (
                        <p className="truncate text-xs font-semibold text-white/70">
                            {chromeDetails.map((part, index) => (
                                <React.Fragment key={part.text}>
                                    {index ? ' · ' : null}
                                    <span className={part.future ? 'text-plex' : undefined}>{part.text}</span>
                                </React.Fragment>
                            ))}
                        </p>
                    ) : null}
                    {theater ? (
                        <p className="mt-1 inline-flex max-w-full items-center truncate rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-white/80">
                            {[modeLabel, sourceRes, sourceCodec].filter(Boolean).join(' · ')}
                        </p>
                    ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                    {theater ? (
                        <button
                            type="button"
                            onClick={enterMini}
                            className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-2 text-sm font-bold text-white hover:bg-white/20"
                            aria-label={t('mediaPlayerPage.miniplayer')}
                        >
                            <Minimize2 className="h-4 w-4" />
                            <span className="hidden sm:inline">{t('mediaPlayerPage.miniplayer')}</span>
                        </button>
                    ) : (
                        <button
                            type="button"
                            onClick={enterTheater}
                            className="inline-flex items-center rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
                            aria-label={t('mediaPlayerPage.expandPlayer')}
                        >
                            <Maximize className="h-4 w-4" />
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={closePlayer}
                        className={`inline-flex items-center gap-2 rounded-full bg-white/10 text-sm font-bold text-white hover:bg-white/20 ${theater ? 'px-3 py-2' : 'p-2'}`}
                        aria-label={t('mediaPlayerPage.closePlayer')}
                    >
                        <X className="h-4 w-4" />
                        {theater ? t('common.close') : null}
                    </button>
                </div>
            </div>

            <div className={`relative ${theater ? 'h-full w-full' : 'aspect-video w-full'}`}>
                <style>
                    {`video::cue {
                        color: ${playerSettings.subtitleColor};
                        font-size: ${Math.round(18 * (playerSettings.subtitleSize / 100))}px;
                        background: ${playerSettings.subtitleBackground === 'solid'
                            ? 'rgba(0,0,0,0.85)'
                            : playerSettings.subtitleBackground === 'dim'
                                ? 'rgba(0,0,0,0.45)'
                                : 'transparent'};
                    }`}
                </style>
                <video
                    ref={videoRef}
                    className="h-full w-full bg-black object-contain"
                    controls={false}
                    playsInline
                    autoPlay
                    disablePictureInPicture={false}
                    onClick={handleVideoClick}
                    onDoubleClick={handleVideoDoubleClick}
                    onPointerUp={handleVideoPointerUp}
                    onPlay={() => {
                        setPaused(false);
                        sendTimelineRef.current('playing');
                    }}
                    onPause={() => {
                        setPaused(true);
                        sendTimelineRef.current('paused');
                    }}
                    onTimeUpdate={(event) => {
                        setCurrentMs(event.currentTarget.currentTime * 1000);
                        setBuffered(bufferedRanges(event.currentTarget));
                    }}
                    onProgress={(event) => setBuffered(bufferedRanges(event.currentTarget))}
                    onRateChange={(event) => setSpeed(event.currentTarget.playbackRate || 1)}
                    onVolumeChange={(event) => {
                        setVolume(event.currentTarget.volume);
                        setMuted(event.currentTarget.muted);
                    }}
                    onDurationChange={(event) => {
                        const next = event.currentTarget.duration;
                        if (Number.isFinite(next) && next > 0) setDurationMs(next * 1000);
                    }}
                    onEnded={() => {
                        sendTimelineRef.current('stopped', undefined, { ended: true });
                        if (autoplayNext && upNextItem) {
                            playUpNext(upNextItem);
                            return;
                        }
                        onClose({ ended: true, item: session.item });
                    }}
                />

                {pip ? (
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/80 p-4 text-center">
                        <p className="text-xs font-bold uppercase tracking-widest text-white/80">{t('mediaPlayerPage.playingInPip')}</p>
                    </div>
                ) : null}

                {error ? (
                    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/80 p-6 text-center" data-tv-playback="1">
                        <div>
                            <p className="font-bold text-white">{error}</p>
                            <p className="mt-2 text-sm text-white/70">
                                {t('mediaPlayerPage.retryPlaybackHint', { time: formatClock(currentMsRef.current || session.offsetMs || 0) })}
                            </p>
                            <div className="mt-4 flex flex-wrap justify-center gap-2">
                                <button type="button" data-tv-item="1" data-tv-action="1" onClick={retryPlayback} className="rounded-lg bg-plex px-4 py-2 text-sm font-black text-black">
                                    {t('mediaPlayerPage.retryPlayback')}
                                </button>
                                <button type="button" data-tv-item="1" data-tv-action="1" onClick={closePlayer} className="rounded-lg bg-white/10 px-4 py-2 text-sm font-bold text-white">
                                    {t('common.close')}
                                </button>
                            </div>
                        </div>
                    </div>
                ) : null}

                {!error && !ready ? (
                    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3">
                        <Loader2 className="h-10 w-10 animate-spin text-white/80" />
                        <p className="text-xs font-bold uppercase tracking-widest text-white/70">{t('mediaPlayerPage.buffering')}</p>
                    </div>
                ) : null}

                {inIntro ? (
                    <button
                        type="button"
                        onClick={skipIntro}
                        className={`absolute z-20 rounded-full bg-white font-black text-black shadow-lg ${theater ? 'right-4 bottom-28 px-4 py-2 text-sm' : 'right-2 bottom-2 px-2.5 py-1 text-xs'}`}
                    >
                        {t('mediaPlayerPage.skipIntro')}
                    </button>
                ) : null}

                {inCredits && !showUpNext ? (
                    <button
                        type="button"
                        onClick={skipCredits}
                        className={`absolute z-20 rounded-full bg-white font-black text-black shadow-lg ${theater ? 'right-4 bottom-28 px-4 py-2 text-sm' : 'right-2 bottom-2 px-2.5 py-1 text-xs'}`}
                    >
                        {t('mediaPlayerPage.skipCredits')}
                    </button>
                ) : null}

                {showUpNext && upNextItem && theater ? (
                    <div className="absolute right-4 bottom-28 z-20 w-72 overflow-hidden rounded-2xl border border-white/15 bg-black/90 shadow-2xl">
                        {upNextItem.thumb ? (
                            <img src={plexImageUrl(upNextItem.thumb, 426, 240, { quality: PLAYER_POSTER_QUALITY })} alt="" className="aspect-video w-full object-cover" />
                        ) : null}
                        <div className="p-3">
                            <p className="text-[10px] font-black uppercase tracking-widest text-white/50">{t('mediaPlayerPage.upNext')}</p>
                            <p className="mt-1 truncate text-sm font-bold text-white">{upNextItem.title}</p>
                            {autoplayNext ? (
                                <p className="text-xs text-white/70">{t('mediaPlayerPage.nextEpisodeIn', { seconds: upNextIn })}</p>
                            ) : null}
                            <div className="mt-3 flex gap-2">
                                <button
                                    type="button"
                                    onClick={() => playUpNext(upNextItem)}
                                    className="rounded-lg bg-plex px-3 py-1.5 text-xs font-black text-black"
                                >
                                    {t('mediaPlayerPage.playNow')}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setDismissedUpNext(true)}
                                    className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-bold text-white"
                                >
                                    {t('mediaPlayerPage.watchCredits')}
                                </button>
                            </div>
                        </div>
                    </div>
                ) : null}

                {showMoreLikeThis && theater ? (
                    <div className="absolute right-4 bottom-28 z-20 w-80 overflow-hidden rounded-2xl border border-white/15 bg-black/90 shadow-2xl">
                        <div className="p-3">
                            <p className="text-[10px] font-black uppercase tracking-widest text-white/50">
                                {t('mediaPlayerPage.moreLikeThis')}
                            </p>
                            <div className="mt-2 flex flex-col gap-1.5">
                                {relatedItems.slice(0, 4).map((row) => (
                                    <button
                                        key={row.ratingKey}
                                        type="button"
                                        data-tv-item="1"
                                        onClick={() => onPlayItem?.(row, { offsetMs: 0, skipResume: true })}
                                        className="flex items-center gap-2 rounded-lg bg-white/5 px-2 py-1.5 text-left hover:bg-white/15"
                                    >
                                        {row.thumb ? (
                                            <img
                                                src={plexImageUrl(row.thumb, 80, 120, { quality: 50 })}
                                                alt=""
                                                className="h-12 w-8 shrink-0 rounded object-cover"
                                            />
                                        ) : (
                                            <span className="h-12 w-8 shrink-0 rounded bg-white/10" />
                                        )}
                                        <span className="min-w-0 truncate text-xs font-bold text-white">{row.title}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                ) : null}
            </div>

            <div className={`z-10 transition-opacity ${theater ? 'absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-4 pb-5 pt-10' : 'bg-black px-3 pb-3 pt-1'} ${showBars ? 'opacity-100' : 'pointer-events-none opacity-0'}`}>
                <PlayerSeekBar
                    currentMs={currentMs}
                    durationMs={durationMs}
                    buffered={buffered}
                    markers={markers}
                    previewThumbTemplate={session.previewThumbTemplate}
                    label={session.item.title}
                    onSeek={seekTo}
                />
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs font-bold text-white/80">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                        {theater && previousItem ? (
                            <button
                                type="button"
                                onClick={() => playNeighbor(previousItem)}
                                className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1.5 text-white hover:bg-white/20"
                                aria-label={t('mediaPlayerPage.previousEpisode')}
                            >
                                <SkipBack className="h-4 w-4" />
                                <span className="hidden sm:inline">{t('mediaPlayerPage.previousEpisode')}</span>
                            </button>
                        ) : null}
                        <button
                            type="button"
                            onClick={togglePlayback}
                            className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-white hover:bg-white/20"
                        >
                            {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                            {theater ? (paused ? t('mediaPlayerPage.play') : t('mediaPlayerPage.pause')) : null}
                        </button>
                        {theater && upNextItem ? (
                            <button
                                type="button"
                                onClick={() => playNeighbor(upNextItem)}
                                className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1.5 text-white hover:bg-white/20"
                                aria-label={t('mediaPlayerPage.nextEpisode')}
                            >
                                <SkipForward className="h-4 w-4" />
                                <span className="hidden sm:inline">{t('mediaPlayerPage.nextEpisode')}</span>
                            </button>
                        ) : null}
                        {theater ? (
                            <>
                                <button
                                    type="button"
                                    onClick={() => seekBySynced(-10)}
                                    className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
                                    aria-label={t('mediaPlayerPage.skipBack')}
                                >
                                    <PlayerSkipBackIcon className="h-6 w-6" />
                                </button>
                                <button
                                    type="button"
                                    onClick={() => seekBySynced(10)}
                                    className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
                                    aria-label={t('mediaPlayerPage.skipForward')}
                                >
                                    <PlayerSkipForwardIcon className="h-6 w-6" />
                                </button>
                                {(session.item.chapters || []).length ? (
                                    <>
                                        <button
                                            type="button"
                                            onClick={() => skipChapter(videoRef.current, session.item.chapters, -1)}
                                            className="inline-flex items-center rounded-full bg-white/10 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-white/20"
                                            aria-label={t('mediaPlayerPage.chapterPrevious')}
                                        >
                                            {t('mediaPlayerPage.chapterPrevious')}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => skipChapter(videoRef.current, session.item.chapters, 1)}
                                            className="inline-flex items-center rounded-full bg-white/10 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-white/20"
                                            aria-label={t('mediaPlayerPage.chapterNext')}
                                        >
                                            {t('mediaPlayerPage.chapterNext')}
                                        </button>
                                    </>
                                ) : null}
                                <button
                                    type="button"
                                    onClick={() => {
                                        const video = videoRef.current;
                                        if (!video) return;
                                        video.muted = !video.muted;
                                        setMuted(video.muted);
                                    }}
                                    className="inline-flex items-center rounded-full bg-white/10 px-2.5 py-1.5 text-white hover:bg-white/20"
                                    aria-label={muted ? t('mediaPlayerPage.unmute') : t('mediaPlayerPage.mute')}
                                >
                                    {muted || volume === 0 ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                                </button>
                                <input
                                    type="range"
                                    min={0}
                                    max={1}
                                    step={0.05}
                                    value={muted ? 0 : volume}
                                    onChange={(event) => {
                                        const video = videoRef.current;
                                        const next = Number(event.target.value);
                                        if (video) {
                                            video.volume = next;
                                            video.muted = next === 0;
                                        }
                                        setVolume(next);
                                        setMuted(next === 0);
                                    }}
                                    className="w-20 accent-plex"
                                    aria-label={t('mediaPlayerPage.volume')}
                                />
                                <TrackPicker
                                    label={t('mediaPlayerPage.speed')}
                                    value={String(speed)}
                                    options={PLAYBACK_SPEEDS.map((rate) => ({ id: String(rate), label: `${rate}×` }))}
                                    open={openMenu === 'speed'}
                                    onToggle={() => setOpenMenu((current) => current === 'speed' ? null : 'speed')}
                                    onChange={(id) => {
                                        const next = Number(id) || 1;
                                        const video = videoRef.current;
                                        if (video) video.playbackRate = next;
                                        setSpeed(next);
                                        setOpenMenu(null);
                                    }}
                                />
                                {versions.length > 1 ? (
                                    <TrackPicker
                                        label={t('mediaPlayerPage.version')}
                                        value={mediaIndex}
                                        options={versions.map((row) => ({ id: String(row.mediaIndex), label: row.label }))}
                                        open={openMenu === 'version'}
                                        onToggle={() => setOpenMenu((current) => current === 'version' ? null : 'version')}
                                        onChange={(id) => {
                                            setOpenMenu(null);
                                            const nextIndex = Number(id) || 0;
                                            writeMediaIndexChoice(session.item.ratingKey, nextIndex);
                                            onPlayItem?.(session.item, {
                                                offsetMs: Math.floor(currentMsRef.current || 0),
                                                mediaIndex: nextIndex,
                                                skipResume: true,
                                            });
                                        }}
                                    />
                                ) : null}
                                <TrackPicker
                                    label={t('mediaPlayerPage.quality')}
                                    value={qualityId}
                                    options={qualities}
                                    open={openMenu === 'quality'}
                                    onToggle={() => setOpenMenu((current) => current === 'quality' ? null : 'quality')}
                                    onChange={(id) => applyStreamChange({ qualityId: id })}
                                />
                                <TrackPicker
                                    label={t('mediaPlayerPage.audio')}
                                    value={audioStreamId}
                                    options={audioTracks}
                                    open={openMenu === 'audio'}
                                    onToggle={() => setOpenMenu((current) => current === 'audio' ? null : 'audio')}
                                    onChange={(id) => applyStreamChange({ audioStreamId: id })}
                                />
                                {subtitles.length ? (
                                    <TrackPicker
                                        label={t('mediaPlayerPage.subtitles')}
                                        value={subtitleStreamId}
                                        options={[
                                            { id: '', label: t('mediaPlayerPage.subtitlesOff') },
                                            ...subtitles,
                                        ]}
                                        open={openMenu === 'subtitles'}
                                        onToggle={() => setOpenMenu((current) => current === 'subtitles' ? null : 'subtitles')}
                                        onChange={(id) => applyStreamChange({ subtitleStreamId: id })}
                                    />
                                ) : null}
                                {(session.item.chapters || []).length ? (
                                    <TrackPicker
                                        label={t('mediaPlayerPage.chapters')}
                                        value=""
                                        options={(session.item.chapters || []).map((row, index) => ({
                                            id: String(row.startMs),
                                            label: row.title || `${t('mediaPlayerPage.chapters')} ${index + 1}`,
                                        }))}
                                        open={openMenu === 'chapters'}
                                        onToggle={() => setOpenMenu((current) => current === 'chapters' ? null : 'chapters')}
                                        onChange={(id) => {
                                            setOpenMenu(null);
                                            seekTo(Number(id) || 0);
                                        }}
                                    />
                                ) : null}
                            </>
                        ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                        <span>{formatClock(currentMs)}{theater ? ` / ${formatClock(durationMs)}` : ''}</span>
                        {pipSupported ? (
                            <button
                                type="button"
                                onClick={() => { void togglePip(); }}
                                className="inline-flex items-center gap-2 rounded-full bg-white/10 px-2.5 py-1.5 text-white hover:bg-white/20"
                                aria-label={pip ? t('mediaPlayerPage.exitPictureInPicture') : t('mediaPlayerPage.pictureInPicture')}
                            >
                                <PictureInPicture2 className="h-4 w-4" />
                                {theater ? (
                                    <span className="hidden sm:inline">{pip ? t('mediaPlayerPage.exitPictureInPicture') : t('mediaPlayerPage.pictureInPicture')}</span>
                                ) : null}
                            </button>
                        ) : null}
                        {theater ? (
                            <button
                                type="button"
                                onClick={() => { void toggleFullscreen(); }}
                                className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-white hover:bg-white/20"
                                aria-label={fullscreen ? t('mediaPlayerPage.exitFullscreen') : t('mediaPlayerPage.fullscreen')}
                            >
                                {fullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
                                <span className="hidden sm:inline">{fullscreen ? t('mediaPlayerPage.exitFullscreen') : t('mediaPlayerPage.fullscreen')}</span>
                            </button>
                        ) : null}
                    </div>
                </div>
            </div>
        </div>
    );

    if (typeof document === 'undefined') return null;
    return createPortal(overlay, document.body);
};
