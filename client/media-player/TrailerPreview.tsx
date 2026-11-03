import React, { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import type Hls from 'hls.js';
import { loadHls } from './loadHls';
import { startMediaPlayerPlayback, stopMediaPlayerTranscode } from './api';
import type { PlayerItem } from './types';

/** Wait on the page this long before the trailer starts (Settings → Trailer preview). */
const TRAILER_PREVIEW_DELAY_MS = 4000;
const TRAILER_PREVIEW_VOLUME = 0.6;

export { TRAILER_COLLAPSE_EVENT, TRAILER_EXPAND_EVENT, TRAILER_TOGGLE_EVENT } from './paths';

const isHlsSrc = (src: string) => /\.m3u8(\?|$)|\/hls\//i.test(src);

export type TrailerPreviewHandle = {
    /** Where the background trailer is now (ms), or null when it isn't playing. */
    positionMs: () => number | null;
    /** Full screen: pause / resume the same video. */
    togglePause: () => void;
};

/**
 * Movie / show details: after a few seconds, fade the trailer in over the backdrop art.
 * Fades back to the art when it ends or fails; stops when the page closes or `paused`.
 *
 * The <video> is made here, outside React, so `expanded` can move that same playing element
 * into a full-screen layer and back: no new stream, no buffering, it just carries on.
 */
export const TrailerPreview = forwardRef<TrailerPreviewHandle, {
    trailer: PlayerItem | null;
    enabled: boolean;
    paused: boolean;
    expanded?: boolean;
    serverId?: string | null;
    onPlayingChange?: (playing: boolean) => void;
}>(({ trailer, enabled, paused, expanded = false, serverId, onPlayingChange }, ref) => {
    const slotRef = useRef<HTMLDivElement | null>(null);
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const fullRef = useRef<HTMLDivElement | null>(null);
    if (!videoRef.current && typeof document !== 'undefined') {
        const video = document.createElement('video');
        video.className = 'media-details-trailer-preview';
        video.playsInline = true;
        video.preload = 'auto';
        video.setAttribute('aria-hidden', 'true');
        videoRef.current = video;
    }
    const [src, setSrc] = useState('');
    const [visible, setVisible] = useState(false);
    const [done, setDone] = useState(false);
    // A transcoded trailer holds a PMS session open — close it whenever the preview ends.
    const sessionRef = useRef<{ id: string; transcode: boolean } | null>(null);
    const stopSession = () => {
        const session = sessionRef.current;
        sessionRef.current = null;
        if (session?.transcode && session.id) {
            void stopMediaPlayerTranscode(session.id, { serverId }).catch(() => undefined);
        }
    };
    const onPlayingRef = useRef(onPlayingChange);
    onPlayingRef.current = onPlayingChange;
    const trailerKey = String(trailer?.ratingKey || '');
    const liveRef = useRef(false);
    liveRef.current = visible && !done;

    useImperativeHandle(ref, () => ({
        positionMs: () => {
            const video = videoRef.current;
            if (!liveRef.current || !video || !Number.isFinite(video.currentTime)) return null;
            return Math.max(0, Math.floor(video.currentTime * 1000));
        },
        togglePause: () => {
            const video = videoRef.current;
            if (!video || !liveRef.current) return;
            if (video.paused) void video.play().catch(() => undefined);
            else video.pause();
            fullRef.current?.classList.toggle('is-paused', video.paused);
        },
    }), []);

    // Playing / ended / failed, as the React <video> props used to do.
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return undefined;
        const onPlaying = () => setVisible(true);
        const onEnd = () => setDone(true);
        video.addEventListener('playing', onPlaying);
        video.addEventListener('ended', onEnd);
        video.addEventListener('error', onEnd);
        return () => {
            video.removeEventListener('playing', onPlaying);
            video.removeEventListener('ended', onEnd);
            video.removeEventListener('error', onEnd);
        };
    }, []);

    const shown = enabled && !!src && !done;
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        video.hidden = !shown;
        video.classList.toggle('is-visible', visible);
    }, [shown, visible]);

    // In the backdrop, or moved (still playing) into the full-screen layer.
    useLayoutEffect(() => {
        const video = videoRef.current;
        const slot = slotRef.current;
        if (!video || !slot) return;
        const wasPlaying = !video.paused;
        if (expanded && shown) {
            if (!fullRef.current) {
                const full = document.createElement('div');
                full.className = 'media-details-trailer-full';
                full.setAttribute('aria-hidden', 'true');
                fullRef.current = full;
            }
            const full = fullRef.current;
            full.classList.remove('is-paused');
            if (!full.isConnected) document.body.appendChild(full);
            if (video.parentNode !== full) full.appendChild(video);
            video.volume = 1;
        } else {
            if (video.parentNode !== slot) slot.appendChild(video);
            fullRef.current?.remove();
            video.volume = TRAILER_PREVIEW_VOLUME;
        }
        // Moving a media element can pause it on some WebViews: carry on if it was playing.
        if (wasPlaying && video.paused) void video.play().catch(() => undefined);
    }, [expanded, shown]);

    useEffect(() => () => {
        const video = videoRef.current;
        if (video) {
            video.pause();
            video.removeAttribute('src');
            try { video.load(); } catch { /* ignore */ }
            video.remove();
        }
        fullRef.current?.remove();
    }, []);

    // New title: start over.
    useEffect(() => {
        stopSession();
        setSrc('');
        setVisible(false);
        setDone(false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [trailerKey]);

    useEffect(() => {
        if (!done) return;
        stopSession();
        // The element outlives the preview now: stop it downloading too.
        const video = videoRef.current;
        if (video) {
            video.pause();
            video.removeAttribute('src');
            try { video.load(); } catch { /* ignore */ }
        }
        // Clearing src also tears down hls.js (the attach effect's cleanup).
        setSrc('');
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [done]);

    useEffect(() => {
        if (!enabled || paused || done || src || !trailerKey) return undefined;
        let cancelled = false;
        const timer = window.setTimeout(() => {
            if (document.visibilityState === 'hidden') return;
            void startMediaPlayerPlayback(trailerKey, { offsetMs: 0, serverId: serverId || null })
                .then((session) => {
                    sessionRef.current = {
                        id: String(session?.sessionId || ''),
                        transcode: session?.playbackMode === 'transcode' || isHlsSrc(String(session?.src || '')),
                    };
                    if (cancelled) {
                        stopSession();
                        return;
                    }
                    if (session?.src) setSrc(session.src);
                    else setDone(true);
                })
                .catch(() => { if (!cancelled) setDone(true); });
        }, TRAILER_PREVIEW_DELAY_MS);
        return () => {
            cancelled = true;
            window.clearTimeout(timer);
        };
    }, [enabled, paused, done, src, trailerKey, serverId]);

    // Attach the stream (plain file, native HLS, or hls.js) and start it.
    useEffect(() => {
        const video = videoRef.current;
        if (!video || !src) return undefined;
        let hls: Hls | null = null;
        let cancelled = false;
        const start = () => {
            video.volume = TRAILER_PREVIEW_VOLUME;
            video.play().catch(() => {
                // Autoplay with sound refused (browser policy): play muted instead.
                video.muted = true;
                video.play().catch(() => setDone(true));
            });
        };
        const playPlain = () => {
            video.src = src;
            start();
        };
        if (isHlsSrc(src) && !video.canPlayType('application/vnd.apple.mpegurl')) {
            void loadHls().then((HlsJs) => {
                if (cancelled) return;
                if (!HlsJs.isSupported()) { playPlain(); return; }
                hls = new HlsJs({ enableWorker: false, xhrSetup: (xhr) => { xhr.withCredentials = true; } });
                hls.loadSource(src);
                hls.attachMedia(video);
                start();
            }).catch(() => { if (!cancelled) playPlain(); });
        } else {
            playPlain();
        }
        return () => {
            cancelled = true;
            try { hls?.destroy(); } catch { /* ignore */ }
            video.removeAttribute('src');
            try { video.load(); } catch { /* ignore */ }
        };
    }, [src]);

    useEffect(() => {
        onPlayingRef.current?.(visible && !done);
    }, [visible, done]);

    // Leaving the page (or Play) ends the preview for good on this title.
    useEffect(() => {
        if (paused && src) setDone(true);
    }, [paused, src]);

    useEffect(() => () => {
        onPlayingRef.current?.(false);
        stopSession();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // The video lives in this slot (display: contents, so it still fills the backdrop).
    return <div ref={slotRef} className="media-details-trailer-slot" data-tv-trailer-expandable={shown && visible ? '1' : undefined} />;
});
TrailerPreview.displayName = 'TrailerPreview';
