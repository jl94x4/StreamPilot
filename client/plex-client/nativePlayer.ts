/**
 * Bridge to native ExoPlayer (Android / Android TV) via Capacitor plugin.
 * Capacitor is loaded dynamically so the portal Docker/esbuild bundle does not
 * need @capacitor/core (that dep lives only under plex-client/).
 */

export type NativePlayerTrackOption = { id: string; label: string; url?: string };
export type NativePlayerVersionOption = { id: string; label: string; mediaIndex?: number };

export type NativePlayerSessionPayload = {
    ratingKey?: string;
    showKey?: string;
    qualityId?: string;
    audioStreamId?: string;
    subtitleStreamId?: string;
    mediaIndex?: number;
    durationMs?: number;
    qualities?: NativePlayerTrackOption[];
    audioTracks?: NativePlayerTrackOption[];
    subtitles?: NativePlayerTrackOption[];
    versions?: NativePlayerVersionOption[];
    markers?: {
        intro?: { startMs: number; endMs: number } | null;
        credits?: { startMs: number; endMs?: number } | null;
    };
    nextItem?: { ratingKey: string; title?: string } | null;
    autoplayNext?: boolean;
    autoSkipIntro?: boolean;
    autoSkipCredits?: boolean;
    title?: string;
    subtitle?: string;
    logoUrl?: string;
    posterUrl?: string;
    music?: boolean;
    chapters?: Array<{ startMs: number; title?: string }>;
    previewThumbTemplate?: string | null;
    frameRate?: number | null;
    nightMode?: boolean;
    matchFrameRate?: boolean;
    subtitleStyle?: {
        size?: number;
        color?: string;
        background?: string;
        position?: string;
    };
};

export type NativePlayerOpenOptions = {
    url: string;
    title?: string;
    logoUrl?: string;
    offsetMs?: number;
    headers?: Record<string, string>;
    speed?: number;
    autoplayNext?: boolean;
    autoSkipIntro?: boolean;
    autoSkipCredits?: boolean;
    session?: NativePlayerSessionPayload;
    onClose?: (result: NativePlayerCloseResult) => void;
    onProgress?: (event: NativePlayerProgressEvent) => void;
    onStreamChange?: (event: NativePlayerStreamChangeEvent) => void | Promise<void>;
    onPlayNext?: (event: { ratingKey: string }) => void;
    onSpeed?: (event: { speed: number }) => void;
    onError?: (event: { message?: string }) => void;
    onMinimized?: (event: NativePlayerProgressEvent) => void;
    onRestored?: (event: { state?: string }) => void;
    onSubtitleSearch?: (event: { ratingKey?: string }) => void;
};

export type NativePlayerCloseResult = {
    ended: boolean;
    positionMs: number;
    error?: boolean;
    playNext?: boolean;
    nextRatingKey?: string;
};

export type NativePlayerProgressEvent = {
    state: string;
    positionMs: number;
    durationMs: number;
    ratingKey?: string;
};

export type NativePlayerStreamChangeEvent = {
    qualityId?: string;
    audioStreamId?: string;
    subtitleStreamId?: string;
    mediaIndex?: number;
    positionMs?: number;
    reason?: string;
};

export type NativePlayerUpdateSrcOptions = {
    url: string;
    headers?: Record<string, string>;
    offsetMs?: number;
    session?: NativePlayerSessionPayload;
};

type CapNativeMediaPlayerPlugin = {
    isAvailable(): Promise<{ value: boolean }>;
    open(opts: Record<string, unknown>): Promise<NativePlayerCloseResult>;
    updateSrc(opts: Record<string, unknown>): Promise<{ ok: boolean }>;
    updateSession(opts: { sessionJson: string }): Promise<{ ok: boolean }>;
    seek(opts: { positionMs: number }): Promise<{ ok: boolean }>;
    setSpeed(opts: { speed: number }): Promise<{ ok: boolean }>;
    setPaused(opts: { paused: boolean }): Promise<{ ok: boolean }>;
    skipNext(): Promise<{ ok: boolean }>;
    show(): Promise<{ ok: boolean }>;
    close(): Promise<{ ok: boolean }>;
    addListener(event: string, cb: (data: Record<string, unknown>) => void): Promise<{ remove: () => void }> | { remove: () => void };
};

type NativeMediaPlayerBridge = {
    isAvailable: () => boolean | Promise<boolean>;
    open: (opts: NativePlayerOpenOptions) => Promise<NativePlayerCloseResult>;
    updateSrc: (opts: NativePlayerUpdateSrcOptions) => Promise<boolean>;
    updateSession: (session: NativePlayerSessionPayload) => Promise<boolean>;
    seek: (positionMs: number) => Promise<boolean>;
    setSpeed: (speed: number) => Promise<boolean>;
    setPaused: (paused: boolean) => Promise<boolean>;
    skipNext: () => Promise<boolean>;
    show: () => Promise<boolean>;
    close: () => Promise<boolean>;
    addListener: CapNativeMediaPlayerPlugin['addListener'];
};

declare global {
    interface Window {
        NativeMediaPlayer?: NativeMediaPlayerBridge;
    }
}

let installPromise: Promise<void> | null = null;
let capPlugin: CapNativeMediaPlayerPlugin | null = null;

const loadCapacitorCore = async (): Promise<{
    Capacitor: { isNativePlatform: () => boolean };
    registerPlugin: <T>(name: string) => T;
} | null> => {
    try {
        return await import('@capacitor/core');
    } catch {
        return null;
    }
};

/** Install window.NativeMediaPlayer when running inside Capacitor Android. */
export const installNativeMediaPlayerBridge = () => {
    if (typeof window === 'undefined') return;
    if (installPromise) return;
    installPromise = (async () => {
        const cap = await loadCapacitorCore();
        if (!cap?.Capacitor?.isNativePlatform?.() || !cap.registerPlugin) return;
        const CapNativeMediaPlayer = cap.registerPlugin<CapNativeMediaPlayerPlugin>('NativeMediaPlayer');
        capPlugin = CapNativeMediaPlayer;
        window.NativeMediaPlayer = {
            isAvailable: async () => {
                try {
                    const result = await CapNativeMediaPlayer.isAvailable();
                    return !!result?.value;
                } catch {
                    return false;
                }
            },
            open: async (opts) => {
                const result = await CapNativeMediaPlayer.open({
                    url: opts.url,
                    title: opts.title,
                    logoUrl: opts.logoUrl || '',
                    offsetMs: opts.offsetMs || 0,
                    headers: opts.headers,
                    speed: opts.speed ?? 1,
                    autoplayNext: opts.autoplayNext !== false,
                    autoSkipIntro: opts.autoSkipIntro === true,
                    autoSkipCredits: opts.autoSkipCredits === true,
                    sessionJson: opts.session ? JSON.stringify(opts.session) : '',
                });
                return {
                    ended: !!result?.ended,
                    positionMs: Math.max(0, Math.floor(Number(result?.positionMs) || 0)),
                    error: !!result?.error,
                    playNext: !!result?.playNext,
                    nextRatingKey: result?.nextRatingKey ? String(result.nextRatingKey) : undefined,
                };
            },
            updateSrc: async (opts) => {
                try {
                    const result = await CapNativeMediaPlayer.updateSrc({
                        url: opts.url,
                        headers: opts.headers,
                        offsetMs: opts.offsetMs || 0,
                        sessionJson: opts.session ? JSON.stringify(opts.session) : undefined,
                    });
                    return !!result?.ok;
                } catch {
                    return false;
                }
            },
            updateSession: async (session) => {
                try {
                    const result = await CapNativeMediaPlayer.updateSession({
                        sessionJson: JSON.stringify(session || {}),
                    });
                    return !!result?.ok;
                } catch {
                    return false;
                }
            },
            seek: async (positionMs) => {
                try {
                    const result = await CapNativeMediaPlayer.seek({ positionMs: Math.max(0, Math.floor(positionMs)) });
                    return !!result?.ok;
                } catch {
                    return false;
                }
            },
            setSpeed: async (speed) => {
                try {
                    const result = await CapNativeMediaPlayer.setSpeed({ speed });
                    return !!result?.ok;
                } catch {
                    return false;
                }
            },
            setPaused: async (paused) => {
                try {
                    const result = await CapNativeMediaPlayer.setPaused({ paused });
                    return !!result?.ok;
                } catch {
                    return false;
                }
            },
            skipNext: async () => {
                try {
                    const result = await CapNativeMediaPlayer.skipNext();
                    return !!result?.ok;
                } catch {
                    return false;
                }
            },
            show: async () => {
                try {
                    const result = await CapNativeMediaPlayer.show();
                    return !!result?.ok;
                } catch {
                    return false;
                }
            },
            close: async () => {
                try {
                    const result = await CapNativeMediaPlayer.close();
                    return !!result?.ok;
                } catch {
                    return false;
                }
            },
            addListener: (event, cb) => CapNativeMediaPlayer.addListener(event, cb),
        };
    })().catch(() => {
        /* web / missing plugin */
    });
};

export const isNativePlayerAvailable = async (): Promise<boolean> => {
    if (typeof window === 'undefined') return false;
    if (window.__PLEX_CLIENT__?.nativePlayer === false) return false;
    installNativeMediaPlayerBridge();
    if (installPromise) await installPromise;
    const bridge = window.NativeMediaPlayer;
    if (!bridge?.isAvailable || !bridge?.open) return false;
    try {
        return !!(await bridge.isAvailable());
    } catch {
        return false;
    }
};

const attachTransientListeners = async (opts: NativePlayerOpenOptions) => {
    const bridge = window.NativeMediaPlayer;
    if (!bridge?.addListener) return () => undefined;
    const removers: Array<() => void> = [];
    const add = async (event: string, handler: (data: Record<string, unknown>) => void) => {
        try {
            const handle = await bridge.addListener(event, handler);
            removers.push(() => {
                try { handle.remove(); } catch { /* ignore */ }
            });
        } catch {
            /* older capacitor */
        }
    };
    if (opts.onProgress) {
        await add('progress', (data) => {
            opts.onProgress?.({
                state: String(data.state || 'playing'),
                positionMs: Math.max(0, Math.floor(Number(data.positionMs) || 0)),
                durationMs: Math.max(0, Math.floor(Number(data.durationMs) || 0)),
                ratingKey: data.ratingKey ? String(data.ratingKey) : undefined,
            });
        });
    }
    if (opts.onStreamChange) {
        await add('streamChange', (data) => {
            void opts.onStreamChange?.({
                qualityId: data.qualityId != null ? String(data.qualityId) : undefined,
                audioStreamId: data.audioStreamId != null ? String(data.audioStreamId) : undefined,
                subtitleStreamId: data.subtitleStreamId != null ? String(data.subtitleStreamId) : undefined,
                mediaIndex: data.mediaIndex != null ? Number(data.mediaIndex) : undefined,
                positionMs: data.positionMs != null ? Math.max(0, Math.floor(Number(data.positionMs) || 0)) : undefined,
                reason: data.reason != null ? String(data.reason) : undefined,
            });
        });
    }
    if (opts.onPlayNext) {
        await add('playNext', (data) => {
            const key = data.ratingKey ? String(data.ratingKey) : '';
            if (key) opts.onPlayNext?.({ ratingKey: key });
        });
    }
    if (opts.onSpeed) {
        await add('speed', (data) => {
            opts.onSpeed?.({ speed: Number(data.speed) || 1 });
        });
    }
    if (opts.onError) {
        await add('error', (data) => {
            opts.onError?.({ message: data.message ? String(data.message) : undefined });
        });
    }
    if (opts.onMinimized) {
        await add('minimized', (data) => {
            opts.onMinimized?.({
                state: String(data.state || 'playing'),
                positionMs: Math.max(0, Math.floor(Number(data.positionMs) || 0)),
                durationMs: Math.max(0, Math.floor(Number(data.durationMs) || 0)),
                ratingKey: data.ratingKey ? String(data.ratingKey) : undefined,
            });
        });
    }
    if (opts.onRestored) {
        await add('restored', (data) => {
            opts.onRestored?.({ state: data.state ? String(data.state) : undefined });
        });
    }
    if (opts.onSubtitleSearch) {
        await add('subtitleSearch', (data) => {
            opts.onSubtitleSearch?.({ ratingKey: data.ratingKey ? String(data.ratingKey) : undefined });
        });
    }
    return () => {
        for (const remove of removers) remove();
    };
};

/**
 * Open stream in ExoPlayer when the Capacitor plugin is present.
 * Returns null when native playback is unavailable (caller should use WebView <video>).
 */
export const openNativePlayer = async (
    opts: NativePlayerOpenOptions,
): Promise<NativePlayerCloseResult | null> => {
    if (!(await isNativePlayerAvailable())) return null;
    const bridge = window.NativeMediaPlayer!;
    const detach = await attachTransientListeners(opts);
    try {
        const result = await bridge.open(opts);
        opts.onClose?.(result);
        return result;
    } finally {
        detach();
    }
};

export const updateNativePlayerSrc = async (opts: NativePlayerUpdateSrcOptions): Promise<boolean> => {
    if (!(await isNativePlayerAvailable())) return false;
    return window.NativeMediaPlayer!.updateSrc(opts);
};

export const updateNativePlayerSession = async (session: NativePlayerSessionPayload): Promise<boolean> => {
    if (!(await isNativePlayerAvailable())) return false;
    const bridge = window.NativeMediaPlayer;
    if (!bridge?.updateSession) return false;
    return bridge.updateSession(session);
};

export const setNativePlayerPaused = async (paused: boolean): Promise<boolean> => {
    const bridge = window.NativeMediaPlayer;
    if (!bridge?.setPaused) return false;
    try {
        return !!(await bridge.setPaused(paused));
    } catch {
        return false;
    }
};

export const skipNativePlayerNext = async (): Promise<boolean> => {
    const bridge = window.NativeMediaPlayer;
    if (!bridge?.skipNext) return false;
    try {
        return !!(await bridge.skipNext());
    } catch {
        return false;
    }
};

export const showNativePlayer = async (): Promise<boolean> => {
    const bridge = window.NativeMediaPlayer;
    if (!bridge?.show) return false;
    try {
        return !!(await bridge.show());
    } catch {
        return false;
    }
};

export const closeNativePlayer = async (): Promise<boolean> => {
    const bridge = window.NativeMediaPlayer;
    if (!bridge?.close) return false;
    try {
        return !!(await bridge.close());
    } catch {
        return false;
    }
};
