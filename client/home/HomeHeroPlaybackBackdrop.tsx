import React, { useEffect, useState } from 'react';
import { portalUrl, resolvePortalAssetUrl } from '../shared/basePath';
import { apiFetch } from '../shared/api';
import type { NowPlayingSession } from '../shared/useNowPlaying';

const plexBackdropUrl = (path: string) => (
    portalUrl(`/api/plex/image?path=${encodeURIComponent(path)}&width=1920&height=1080`)
);

const jellyfinBackdropUrl = (itemId: string) => (
    portalUrl(`/api/jellyfin/image?itemId=${encodeURIComponent(itemId)}&width=1200&height=675`)
);

const tmdbOriginalUrl = (backdropPath: string) => {
    const normalized = backdropPath.startsWith('/') ? backdropPath : `/${backdropPath}`;
    return `https://image.tmdb.org/t/p/original${normalized}`;
};

/** Resolve a full-bleed hero image for the viewer's own now-playing session. */
export const useNowPlayingHeroArt = (session: NowPlayingSession | null): string | null => {
    const [artUrl, setArtUrl] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;

        const resolve = async () => {
            if (!session) {
                setArtUrl(null);
                return;
            }

            if (session.artUrl) {
                if (!cancelled) setArtUrl(resolvePortalAssetUrl(session.artUrl) || session.artUrl);
                return;
            }
            if (session.artPath) {
                if (!cancelled) setArtUrl(plexBackdropUrl(session.artPath));
                return;
            }

            // Soft fallbacks while we try TMDB (preferred for Jellyfin / missing Plex art).
            const soft = session.thumbPath
                ? plexBackdropUrl(session.thumbPath)
                : (session.artItemId ? jellyfinBackdropUrl(session.artItemId) : null);
            if (soft && !cancelled) setArtUrl(soft);

            const tmdbId = Number(session.tmdbId || 0);
            if (!Number.isFinite(tmdbId) || tmdbId <= 0) return;

            try {
                const mediaType = session.mediaType === 'tv' ? 'tv' : 'movie';
                const details = await apiFetch(`/api/discovery/proxy/${mediaType}/${tmdbId}`).catch(() => null);
                const path = String(details?.backdrop_path || details?.backdropPath || '').trim();
                if (path && !cancelled) setArtUrl(tmdbOriginalUrl(path));
            } catch {
                /* keep soft fallback */
            }
        };

        void resolve();
        return () => { cancelled = true; };
    }, [
        session?.artUrl,
        session?.artPath,
        session?.thumbPath,
        session?.artItemId,
        session?.tmdbId,
        session?.mediaType,
        session?.title,
    ]);

    return artUrl;
};

type Props = {
    artUrl: string;
};

/** Full-bleed now-playing art with left/bottom scrims for greeting readability. */
export const HomeHeroPlaybackBackdrop: React.FC<Props> = ({ artUrl }) => {
    const [ready, setReady] = useState(false);
    const safeUrl = String(artUrl || '').replace(/"/g, '%22');

    useEffect(() => {
        setReady(false);
        const img = new Image();
        img.onload = () => setReady(true);
        img.onerror = () => setReady(true);
        img.src = artUrl;
        if (img.complete) setReady(true);
    }, [artUrl]);

    return (
        <>
            <div
                className={`absolute inset-0 bg-cover bg-center transition-opacity duration-700 ease-out ${
                    ready ? 'opacity-100' : 'opacity-0'
                }`}
                style={{ backgroundImage: `url("${safeUrl}")` }}
                aria-hidden
            />
            <div className="home-hero-scrim absolute inset-0 bg-gradient-to-t from-card via-card/60 to-transparent" />
            <div className="absolute inset-0 bg-gradient-to-r from-card via-card/55 via-[38%] to-transparent to-[72%]" />
            <div className="absolute inset-0 bg-black/20" />
        </>
    );
};

export default HomeHeroPlaybackBackdrop;
