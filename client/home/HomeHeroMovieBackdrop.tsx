import React, { useEffect, useMemo, useState } from 'react';
import { portalUrl, resolvePortalAssetUrl } from '../shared/basePath';

type MovieLike = {
    thumb?: string | null;
    thumbUrl?: string | null;
    artUrl?: string | null;
};

const posterSrc = (movie: MovieLike) => {
    if (movie.thumbUrl) return resolvePortalAssetUrl(movie.thumbUrl);
    if (movie.thumb) return portalUrl(`/api/plex/image?path=${encodeURIComponent(movie.thumb)}&width=200&height=300`);
    return '';
};

const stillSrc = (movies: MovieLike[]) => {
    const movie = movies.find((item) => item?.artUrl || item?.thumbUrl || item?.thumb);
    if (!movie) return '';
    if (movie.artUrl) return resolvePortalAssetUrl(movie.artUrl);
    if (movie.thumbUrl) return resolvePortalAssetUrl(movie.thumbUrl);
    if (movie.thumb) return portalUrl(`/api/plex/image?path=${encodeURIComponent(movie.thumb)}&width=400&height=600`);
    return '';
};

const seededShuffle = <T,>(items: T[], seed: number) => {
    const out = [...items];
    let state = seed || 1;
    for (let i = out.length - 1; i > 0; i -= 1) {
        state = (state * 16807) % 2147483647;
        const j = state % (i + 1);
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
};

type Props = {
    movies: MovieLike[];
};

/** Animated poster wall on desktop; a single still image on phones so home scroll stays cheap. */
export const HomeHeroMovieBackdrop: React.FC<Props> = React.memo(({ movies }) => {
    const [showCollage, setShowCollage] = useState(
        () => typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches,
    );

    useEffect(() => {
        const media = window.matchMedia('(min-width: 768px)');
        const apply = () => setShowCollage(media.matches);
        apply();
        media.addEventListener('change', apply);
        return () => media.removeEventListener('change', apply);
    }, []);

    const still = useMemo(() => stillSrc(movies), [movies]);
    const columns = useMemo(() => {
        if (!showCollage) return [];
        const pool = movies.filter((movie) => movie.thumb || movie.thumbUrl).slice(0, 12);
        return Array.from({ length: 6 }, (_, colIdx) => {
            const shuffled = seededShuffle(pool, colIdx + 1);
            return [...shuffled, ...shuffled];
        });
    }, [movies, showCollage]);

    return (
        <>
            {still ? (
                <div
                    className="absolute inset-0 bg-cover bg-center opacity-35 md:hidden"
                    style={{ backgroundImage: `url("${String(still).replace(/"/g, '%22')}")` }}
                />
            ) : null}
            {showCollage ? (
                <div className="absolute -inset-[50%] hidden md:flex opacity-40 -rotate-12 scale-110 gap-4 overflow-hidden pointer-events-none justify-center">
                    {columns.map((column, colIdx) => (
                        <div
                            key={colIdx}
                            className={`flex flex-col gap-4 ${colIdx % 2 === 0 ? 'animate-[scrollVertical_40s_linear_infinite]' : 'animate-[scrollVertical_50s_linear_infinite_reverse]'}`}
                        >
                            {column.map((movie, i) => {
                                const src = posterSrc(movie);
                                return src ? (
                                    <img
                                        key={`${colIdx}-${i}`}
                                        src={src}
                                        className="w-32 md:w-48 rounded-xl object-cover"
                                        alt=""
                                    />
                                ) : null;
                            })}
                        </div>
                    ))}
                </div>
            ) : null}
            <div className="home-hero-scrim absolute inset-0 bg-gradient-to-t from-card via-card/80 to-transparent" />
            <div className="absolute inset-0 bg-gradient-to-r from-card via-card/40 to-transparent" />
        </>
    );
});
