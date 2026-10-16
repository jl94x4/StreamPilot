import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from './api';

export type NowPlayingOther = {
    username: string;
    accountId?: string | null;
    thumb?: string | null;
};

export type NowPlayingSession = {
    mediaType: 'movie' | 'tv';
    tmdbId: number | null;
    title: string;
    episodeTitle?: string | null;
    season?: number | null;
    episode?: number | null;
    progress?: number;
    state?: string;
    /** Plex library art path (prefer show backdrop for episodes). */
    artPath?: string | null;
    /** Plex poster/still path fallback. */
    thumbPath?: string | null;
    /** Absolute or portal-relative art URL when already resolved. */
    artUrl?: string | null;
    /** Jellyfin item id to use for series/movie art fallback. */
    artItemId?: string | null;
};

type NowPlayingPayload = {
    available?: boolean;
    enabled?: boolean;
    optedOut?: boolean;
    session?: NowPlayingSession | null;
    others?: NowPlayingOther[];
};

export const useNowPlaying = (enabled = true, pollMs = 10000) => {
    const [session, setSession] = useState<NowPlayingSession | null>(null);
    const [others, setOthers] = useState<NowPlayingOther[]>([]);
    const [ready, setReady] = useState(false);

    const refresh = useCallback(async () => {
        if (!enabled) {
            setSession(null);
            setOthers([]);
            setReady(true);
            return;
        }
        try {
            const data = await apiFetch('/api/streams/now-playing') as NowPlayingPayload;
            if (!data?.enabled || data?.optedOut || !data?.session) {
                setSession(null);
                setOthers([]);
            } else {
                setSession(data.session);
                setOthers(Array.isArray(data.others) ? data.others : []);
            }
        } catch {
            setSession(null);
            setOthers([]);
        } finally {
            setReady(true);
        }
    }, [enabled]);

    useEffect(() => {
        refresh();
        if (!enabled) return undefined;
        const id = window.setInterval(() => {
            if (document.visibilityState === 'visible') refresh();
        }, Math.max(5000, pollMs));
        const onFocus = () => refresh();
        window.addEventListener('focus', onFocus);
        return () => {
            window.clearInterval(id);
            window.removeEventListener('focus', onFocus);
        };
    }, [enabled, pollMs, refresh]);

    return { session, others, ready, refresh };
};

export default useNowPlaying;
