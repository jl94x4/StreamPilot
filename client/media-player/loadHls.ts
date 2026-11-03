import type Hls from 'hls.js';

let pending: Promise<typeof Hls> | null = null;

/**
 * hls.js is about 570KB: load it the first time a web HLS stream or trailer needs it, not at
 * start-up (the APK plays through ExoPlayer, so most sessions never fetch it).
 */
export const loadHls = (): Promise<typeof Hls> => {
    if (!pending) {
        pending = import('hls.js').then((mod) => mod.default);
        pending.catch(() => { pending = null; });
    }
    return pending;
};
