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
import Hls from 'hls.js';
import {
    lockBackgroundScroll,
    PORTAL_CSRF_HEADER,
    PORTAL_CSRF_VALUE,
    portalUrl,
    useDiscoverI18n,
} from './host';
import {
    formatClock,
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
    nativeSafeQualityId,
    offsetMsFromSrc,
    playbackModeFromSrc,
    isMusicPlayerItem,
    MUSIC_NOW_PLAYING_EVENT,
    plexImageUrl,
    plexLogoUrl,
    resizePlexArtUrl,
    rememberPlaybackProgress,
    PLAYBACK_SPEEDS,
    audioStreamIdFromSrc,
    subtitleStreamIdFromSrc,
} from './playerUtils';
import { fetchMediaPlayerNeighbors, fetchMediaPlayerSubtitleSearch, reportMediaPlayerTimeline, startMediaPlayerPlayback, stopMediaPlayerTranscode } from './api';
import { usePlayerSettings } from './usePlayerSettings';
import { PlayerSeekBar } from './PlayerSeekBar';
import { PlayerSkipBackIcon, PlayerSkipForwardIcon } from './PlayerSkipIcons';
import {
    clampMiniPlayerWidth,
    DEFAULT_MINI_PLAYER_WIDTH,
    MIN_MINI_PLAYER_WIDTH,
    readLocalPlaybackPrefs,
    writeAvChoiceFromTracks,
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
    updateNativePlayerSrc,
    updateNativePlayerSession,
    type NativePlayerCloseResult,
    type NativePlayerSessionPayload,
    type NativePlayerTrackOption,
} from '../plex-client/nativePlayer';
import { getSessionToken, isPlexDirectMode } from '../plex-client/config';

type Props = {
    session: PlayerPlaySession;
    onClose: () => void;
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

const stopPlaybackSession = (sessionId?: string | null, serverId?: string | null, ratingKey?: string | null) => {
    const id = String(sessionId || '').trim();
    if (!id) return Promise.resolve();
    return Promise.race([
        stopMediaPlayerTranscode(id, { serverId, ratingKey }),
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
    const [controlsVisible, setControlsVisible] = useState(true);
    const currentMsRef = useRef(0);
    const durationMsRef = useRef(session.item.durationMs || 0);
    const volumeRef = useRef(localPrefs.current.volume);
    const mutedRef = useRef(localPrefs.current.muted);
    const speedRef = useRef(localPrefs.current.speed);
    const sendTimelineRef = useRef<(state: 'playing' | 'paused' | 'buffering' | 'stopped', timeMs?: number) => void>(() => {});
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
    const nativeFileHlsFallbackRef = useRef(false);
    const clickTimerRef = useRef<number>(0);
    const lastTapRef = useRef<{ at: number; x: number } | null>(null);
    const hideTimerRef = useRef<number>(0);
    const streamRestartGenRef = useRef(0);
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
            nextItem: next?.ratingKey ? { ratingKey: next.ratingKey, title: next.title } : { ratingKey: '', title: '' },
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

        const absoluteWithAuth = (src: string) => {
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
            audioTracks: (session.audioTracks || []).map((row) => ({ id: row.id, label: row.label })),
            subtitles: [
                ...(session.subtitles || []).map((row) => ({ id: row.id, label: row.label })),
                ...sidecarSubs,
            ],
            versions: (session.versions || []).map((row) => ({
                id: String(row.mediaIndex),
                label: row.label,
                mediaIndex: row.mediaIndex,
            })),
            markers: session.markers || { intro: null, credits: null },
            nextItem: item?.ratingKey ? { ratingKey: item.ratingKey, title: item.title } : null,
            autoplayNext,
            autoSkipIntro,
            autoSkipCredits,
            title: session.item.title,
            subtitle: session.item.showTitle || session.item.seasonTitle || '',
            logoUrl: isMusicPlayerItem(session.item) ? '' : logoAuthUrl,
            posterUrl: isMusicPlayerItem(session.item) && session.item.thumb
                ? absoluteWithAuth(resizePlexArtUrl(plexImageUrl(session.item.thumb, 600, 600, { quality: 70 }), 600, 600)).url
                : '',
            music: isMusicPlayerItem(session.item),
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
        });

        (async () => {
            if (!(await isNativePlayerAvailable())) {
                if (!cancelled) {
                    onPlaybackErrorRef.current?.('Native player unavailable on this device.');
                    onCloseRef.current();
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
            const nativeSrc = buildNativePlaybackSrc(session.item.ratingKey, session, {
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
                const nativeNext = result?.playNext && result.nextRatingKey ? String(result.nextRatingKey) : '';
                const fallbackNext = (
                    result?.ended
                    && autoplayNextRef.current
                    && (queued?.ratingKey || neighbor?.ratingKey)
                ) ? String(queued?.ratingKey || neighbor?.ratingKey) : '';
                const nextKey = nativeNext || fallbackNext;
                // Drop the WebView cover before timeline / play-next work so the
                // overview is visible as soon as ExoPlayer closes.
                if (result?.error) {
                    onPlaybackErrorRef.current?.('Playback failed. Check your connection and try again.');
                }
                nativeLiveRef.current = false;
                nativeMinimizedRef.current = false;
                setNativeMinimized(false);
                publishMusicNowPlayingRef.current(false);
                onCloseRef.current();
                sendStopped('stopped', reportMs);
                if (result?.error || !nextKey) return;
                window.setTimeout(() => {
                    if (queued?.ratingKey === nextKey) {
                        onConsumePlayNextRef.current?.();
                        onPlayItemRef.current?.(queued, { offsetMs: 0, skipResume: true });
                    } else if (neighbor?.ratingKey === nextKey) {
                        onPlayItemRef.current?.(neighbor, { offsetMs: 0, skipResume: true });
                    }
                }, 350);
            };
            try {
                const result = await openNativePlayer({
                    url: auth.url,
                    title: session.item.title,
                    logoUrl: logoAuthUrl,
                    offsetMs: session.offsetMs || 0,
                    headers: auth.headers,
                    speed: speedRef.current || 1,
                    autoplayNext,
                    autoSkipIntro,
                    autoSkipCredits,
                    session: buildNativeSession(nextItemRef.current || upNextItem),
                    onClose: completeNativeSession,
                    onPlayNext: ({ ratingKey }) => {
                        if (cancelled || gen !== nativeOpenGenRef.current) return;
                        const queued = playNextQueueRef.current[0];
                        const neighbor = nextItemRef.current;
                        const next = (queued && queued.ratingKey === ratingKey)
                            ? queued
                            : (neighbor && neighbor.ratingKey === ratingKey)
                                ? neighbor
                                : (queued || neighbor);
                        if (!next) return;
                        if (queued && queued.ratingKey === next.ratingKey) {
                            onConsumePlayNextRef.current?.();
                        }
                        onPlayItemRef.current?.(next, { offsetMs: 0, skipResume: true });
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
                        const state = event.state === 'paused' || event.state === 'buffering'
                            ? event.state
                            : 'playing';
                        nativeTimelineStateRef.current = state;
                        sendTimelineRef.current(state, event.positionMs);
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
                        const offset = Math.max(0, Math.floor(event.positionMs ?? currentMsRef.current ?? 0));
                        const previous = playSessionIdFromSrc(playbackSrcRef.current);
                        if (previous) {
                            await stopPlaybackSession(previous, session.item.serverId, session.item.ratingKey);
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
                        const safeQuality = nativeSafeQualityId(nextQuality);
                        let nextSrc = '';
                        if (isPlexDirectMode()) {
                            const fresh = await startMediaPlayerPlayback(session.item.ratingKey, {
                                offsetMs: offset,
                                qualityId: safeQuality,
                                mediaIndex: nextMediaIndex,
                                audioStreamId: nextAudio,
                                subtitleStreamId: nextSub,
                                serverId: session.item.serverId,
                                delivery: event.reason === 'seek' ? 'hls' : undefined,
                            }).catch(() => null);
                            nextSrc = String(fresh?.src || '');
                        }
                        if (!nextSrc) nextSrc = buildNativePlaybackSrc(session.item.ratingKey, {
                            ...session,
                            playbackMode: safeQuality === 'original' && session.canDirectPlay
                                ? session.playbackMode
                                : 'transcode',
                        }, {
                            sessionId: newPlaySessionId(),
                            offsetMs: offset,
                            qualityId: safeQuality,
                            audioStreamId: nextAudio,
                            subtitleStreamId: nextSub,
                            mediaIndex: nextMediaIndex,
                        });
                        playbackSrcRef.current = nextSrc;
                        setPlaybackSrc(nextSrc);
                        setPlaybackMode(playbackModeFromSrc(nextSrc, nextQuality, session.canCopyOriginal));
                        const nextAuth = absoluteWithAuth(nextSrc);
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
                    onSpeed: ({ speed: nextSpeed }) => {
                        speedRef.current = nextSpeed;
                        setSpeed(nextSpeed);
                    },
                    onError: () => {
                        if (cancelled || gen !== nativeOpenGen || nativeClosedRef.current) return;
                        const current = playbackSrcRef.current;
                        // One Direct Play→HLS retry. A second failure must not open the web player.
                        const canRetry = isFilePlaybackSrc(current) || isPlexPartPlaybackSrc(current);
                        if (nativeFileHlsFallbackRef.current || !canRetry) return;
                        nativeFileHlsFallbackRef.current = true;
                        void (async () => {
                            const offset = Math.max(0, Math.floor(currentMsRef.current || session.offsetMs || 0));
                            let hlsSrc = '';
                            if (isPlexPartPlaybackSrc(current) || isPlexDirectMode()) {
                                const fresh = await startMediaPlayerPlayback(session.item.ratingKey, {
                                    offsetMs: offset,
                                    qualityId: nativeSafeQualityId(qualityIdRef.current || session.qualityId),
                                    audioStreamId: audioStreamIdRef.current || session.audioStreamId,
                                    subtitleStreamId: subtitleStreamIdRef.current ?? session.subtitleStreamId ?? '',
                                    mediaIndex: session.mediaIndex || 0,
                                    serverId: session.item.serverId,
                                    delivery: 'hls',
                                }).catch(() => null);
                                hlsSrc = String(fresh?.src || '');
                            }
                            if (!hlsSrc) {
                                hlsSrc = buildPlaybackSrc(session.item.ratingKey, {
                                    sessionId: newPlaySessionId(),
                                    offsetMs: offset,
                                    qualityId: nativeSafeQualityId(qualityIdRef.current || session.qualityId),
                                    audioStreamId: audioStreamIdRef.current || session.audioStreamId,
                                    subtitleStreamId: subtitleStreamIdRef.current ?? session.subtitleStreamId ?? '',
                                    directFile: false,
                                    copy: session.canCopyOriginal !== false,
                                    mediaIndex: session.mediaIndex || 0,
                                });
                            }
                            playbackSrcRef.current = hlsSrc;
                            setPlaybackSrc(hlsSrc);
                            setPlaybackMode(playbackModeFromSrc(hlsSrc, qualityIdRef.current, session.canCopyOriginal));
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
                    onCloseRef.current();
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
                    music: isMusicPlayerItem(live.item),
                    posterUrl: poster ? nativePlaybackAuth(poster).url : '',
                    durationMs: live.item.durationMs || 0,
                    nextItem: (playNextQueueRef.current[0] || nextItemRef.current)
                        ? {
                            ratingKey: String((playNextQueueRef.current[0] || nextItemRef.current)?.ratingKey || ''),
                            title: (playNextQueueRef.current[0] || nextItemRef.current)?.title,
                        }
                        : null,
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
        const onVisibility = () => {
            if (document.visibilityState === 'hidden') leftForNative = true;
            if (document.visibilityState !== 'visible' || !leftForNative) return;
            setNativeCover(false);
        };
        document.addEventListener('visibilitychange', onVisibility);
        return () => document.removeEventListener('visibilitychange', onVisibility);
    }, [nativeExclusive, session.sessionId]);

    useEffect(() => {
        const close = () => {
            void closeNativePlayer();
            sendTimelineRef.current('stopped');
            onCloseRef.current();
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
        void stopPlaybackSession(previous).finally(() => {
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
                setPreviousItem(data.previous || null);
                setNextItem(data.next || null);
                const next = data.next;
                if (next?.ratingKey && nativeExclusiveRef.current) {
                    void updateNativePlayerSession({
                        nextItem: { ratingKey: next.ratingKey, title: next.title },
                    });
                }
            })
            .catch(() => {
                if (!cancelled) {
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
            if (!fallbackUsedRef.current) {
                fallbackUsedRef.current = true;
                const offset = Math.max(
                    0,
                    Math.floor(((video.currentTime || 0) * 1000) || currentMsRef.current || session.offsetMs || 0),
                );
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
            setError(message || t('mediaPlayerPage.playError'));
        };

        const startHlsJs = () => {
            const hls = new Hls({
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
            hls.on(Hls.Events.MANIFEST_PARSED, onReady);
            hls.on(Hls.Events.ERROR, (_event, data) => {
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
                if (Hls.isSupported()) startHlsJs();
                else fail();
            }, { once: true });
        } else if (Hls.isSupported() && isHlsPlaybackSrc(playbackSrc)) {
            startHlsJs();
        } else {
            video.src = src;
            video.addEventListener('loadedmetadata', onReady, { once: true });
            video.addEventListener('error', () => fail(), { once: true });
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
        const send = (state: 'playing' | 'paused' | 'buffering' | 'stopped', timeOverride?: number) => {
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
            if (state === 'stopped') {
                const queued = playNextQueueRef.current[0];
                const neighbor = nextItemRef.current;
                const next = session.item.type === 'episode'
                    ? (queued?.ratingKey && queued.ratingKey !== session.item.ratingKey ? queued : neighbor)
                    : null;
                rememberPlaybackProgress(session.item, timeMs, nextDuration, next);
                void stopPlaybackSession(sessionId, session.item.serverId, ratingKey);
            }
            void reportMediaPlayerTimeline({
                ratingKey,
                sessionId,
                state,
                timeMs,
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
    }, [session.item.ratingKey, session.sessionId, playbackSrc, audioStreamId, nativeExclusive]);

    useEffect(() => {
        if (!('mediaSession' in navigator)) return undefined;
        const thumb = session.item.thumb ? plexImageUrl(session.item.thumb, 300, 450, { quality: 60 }) : '';
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
            navigator.mediaSession.setActionHandler('seekbackward', () => seekBy(videoRef.current, -10));
            navigator.mediaSession.setActionHandler('seekforward', () => seekBy(videoRef.current, 10));
            navigator.mediaSession.setActionHandler('previoustrack', () => {
                if (previousItemRef.current) playCurrent(previousItemRef.current);
                else seekBy(videoRef.current, -10);
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
        onClose();
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
    const inIntro = !!(markers.intro && !skippedIntro && currentMs >= markers.intro.startMs && currentMs < markers.intro.endMs);
    const inCredits = !!(markers.credits && !skippedCredits && currentMs >= markers.credits.startMs);
    const showUpNext = !!upNextItem && !dismissedUpNext && durationMs > 30000 && (
        !!queuedNext || session.item.type === 'episode' || session.item.type === 'track'
    ) && (
        inCredits || (remaining > 0 && remaining <= 15000)
    );

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
                        onPlayItemRef.current?.(next, { offsetMs: 0, skipResume: true });
                    }
                    return 0;
                }
                return n - 1;
            });
        }, 1000);
        return () => window.clearInterval(timer);
    }, [showUpNext, autoplayNext, upNextItem]);

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            const tag = String((event.target as HTMLElement | null)?.tagName || '').toLowerCase();
            if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
            if (chrome === 'mini' && !overlayRef.current?.contains(event.target as Node)) return;
            if (event.key === 'Escape') {
                if (openMenu) {
                    setOpenMenu(null);
                    return;
                }
                if (fullscreenElement()) return;
                if (chrome === 'mini') return;
                closePlayer();
            }
            if (event.key === ' ') {
                event.preventDefault();
                const video = videoRef.current;
                if (!video) return;
                if (video.paused) void video.play();
                else video.pause();
            }
            if (event.key === 'ArrowLeft') {
                event.preventDefault();
                seekBy(videoRef.current, -10);
            }
            if (event.key === 'ArrowRight') {
                event.preventDefault();
                seekBy(videoRef.current, 10);
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
    }, [chrome, onClose, openMenu]);

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
        const nextSrc = buildPlaybackSrc(session.item.ratingKey, {
            sessionId: newPlaySessionId(),
            offsetMs: offset,
            qualityId: nextQuality,
            audioStreamId: nextAudio,
            subtitleStreamId: nextSub,
            directFile: !!session.canDirectPlay && (nextQuality === 'original' || !nextQuality) && !String(nextSub || '').replace(/\D/g, '') && audioUnchanged,
            copy: nextQuality !== 'original' || session.canCopyOriginal !== false,
            mediaIndex: session.mediaIndex || 0,
        });
        fallbackUsedRef.current = false;
        setError(null);
        swapPlaybackSrc(nextSrc, playbackModeFromSrc(nextSrc, nextQuality, session.canCopyOriginal));
    };

    const togglePlayback = () => {
        const video = videoRef.current;
        if (!video) return;
        if (video.paused) {
            void video.play();
            setPaused(false);
        } else {
            video.pause();
            setPaused(true);
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
        if (!autoSkipIntro || !inIntro || !ready) return;
        skipIntro();
    }, [autoSkipIntro, inIntro, ready]);

    useEffect(() => {
        if (!autoSkipCredits || !inCredits || !ready) return;
        skipCredits();
    }, [autoSkipCredits, inCredits, upNextItem, ready]);

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

    const modeLabel = playbackMode === 'directPlay'
        ? t('mediaPlayerPage.playbackDirectPlay')
        : playbackMode === 'directStream'
            ? t('mediaPlayerPage.playbackDirectStream')
            : t('mediaPlayerPage.playbackTranscode');
    const sourceRes = formatPlayerResolution(session.source?.height, session.source?.videoResolution);
    const sourceCodec = String(session.source?.videoCodec || '').toUpperCase();
    const seekTo = (ms: number) => {
        const video = videoRef.current;
        if (!video || !durationMs) return;
        const next = Math.max(0, Math.min(durationMs, ms));
        video.currentTime = next / 1000;
        setCurrentMs(next);
        sendTimelineRef.current('playing');
        bumpControls();
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
            directFile: !!session.canDirectPlay && !String(subtitleStreamId || '').replace(/\D/g, ''),
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
            if (x < third) seekBy(videoRef.current, -10);
            else if (x > third * 2) seekBy(videoRef.current, 10);
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
                        sendTimelineRef.current('stopped');
                        if (autoplayNext && upNextItem) playUpNext(upNextItem);
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
                            <img src={plexImageUrl(upNextItem.thumb, 426, 240, { quality: 60 })} alt="" className="aspect-video w-full object-cover" />
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
                                    {t('common.close')}
                                </button>
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
                        <button
                            type="button"
                            onClick={togglePlayback}
                            className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-white hover:bg-white/20"
                        >
                            {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                            {theater ? (paused ? t('mediaPlayerPage.play') : t('mediaPlayerPage.pause')) : null}
                        </button>
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
                        {theater ? (
                            <>
                                <button
                                    type="button"
                                    onClick={() => seekBy(videoRef.current, -10)}
                                    className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
                                    aria-label={t('mediaPlayerPage.skipBack')}
                                >
                                    <PlayerSkipBackIcon className="h-6 w-6" />
                                </button>
                                <button
                                    type="button"
                                    onClick={() => seekBy(videoRef.current, 10)}
                                    className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
                                    aria-label={t('mediaPlayerPage.skipForward')}
                                >
                                    <PlayerSkipForwardIcon className="h-6 w-6" />
                                </button>
                                {upNextItem ? (
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
                                            onPlayItem?.(session.item, {
                                                offsetMs: Math.floor(currentMsRef.current || 0),
                                                mediaIndex: Number(id) || 0,
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
