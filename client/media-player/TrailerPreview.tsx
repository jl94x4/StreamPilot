import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type Hls from 'hls.js';
import { loadHls } from './loadHls';
import { startMediaPlayerPlayback, stopMediaPlayerTranscode } from './api';
import type { PlayerItem } from './types';

/** Wait on the page this long before the trailer starts (Settings → Trailer preview). */
const TRAILER_PREVIEW_DELAY_MS = 4000;
const TRAILER_PREVIEW_VOLUME = 0.6;

const isHlsSrc = (src: string) => /\.m3u8(\?|$)|\/hls\//i.test(src);

export type TrailerPreviewHandle = {
    /** Where the background trailer is now (ms), or null when it isn't playing. */
    positionMs: () => number | null;
};

/**
 * Movie / show details: after a few seconds, fade the trailer in over the backdrop art.
 * Fades back to the art when it ends or fails; stops when the page closes or `paused`.
 */
export const TrailerPreview = forwardRef<TrailerPreviewHandle, {
    trailer: PlayerItem | null;
    enabled: boolean;
    paused: boolean;
    serverId?: string | null;
    onPlayingChange?: (playing: boolean) => void;
}>(({ trailer, enabled, paused, serverId, onPlayingChange }, ref) => {
    const videoRef = useRef<HTMLVideoElement | null>(null);
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
    }), []);

    // New title: start over.
    useEffect(() => {
        stopSession();
        setSrc('');
        setVisible(false);
        setDone(false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [trailerKey]);

    useEffect(() => {
        if (done) stopSession();
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

    if (!enabled || !src || done) return null;
    return (
        <video
            ref={videoRef}
            className={`media-details-trailer-preview${visible ? ' is-visible' : ''}`}
            playsInline
            preload="auto"
            aria-hidden
            onPlaying={() => setVisible(true)}
            onEnded={() => setDone(true)}
            onError={() => setDone(true)}
        />
    );
});
TrailerPreview.displayName = 'TrailerPreview';
