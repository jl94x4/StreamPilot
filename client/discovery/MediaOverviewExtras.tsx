import React, { useMemo, useState } from 'react';
import { ArrowRight, ExternalLink, Play } from 'lucide-react';
import {
    buildExternalLinks,
    buildMediaFactRows,
    getProductionStudios,
    type CombinedRatings,
    sortKeyCrew,
} from './mediaDetailUtils';
import { MediaRatingPills } from './MediaRatingPills';
import { DiscoveryFactWidget } from './DiscoveryFactWidget';
import { DiscoveryLogo } from './DiscoveryLogo';
import { useDiscoverI18n, translateDiscoverStatus } from './i18n';

const SectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <div className="flex items-center gap-3">
        <h3 className="text-xs font-black text-muted uppercase tracking-[0.2em]">{children}</h3>
        <div className="h-px flex-1 bg-gradient-to-r from-border to-transparent" />
    </div>
);

export const MediaOverviewExtras: React.FC<{
    mediaType: 'movie' | 'tv';
    mediaId: number;
    details: any;
    ratings?: CombinedRatings | null;
    onOpenPerson?: (personId: number) => void;
    onOpenCollection?: (collectionId: number) => void;
    onOpenKeyword?: (keyword: { id: number; name: string }) => void;
    onOpenStudio?: (studioId: number) => void;
    onOpenNetwork?: (networkId: number) => void;
}> = ({ mediaType, mediaId, details, ratings, onOpenPerson, onOpenCollection, onOpenKeyword, onOpenStudio, onOpenNetwork }) => {
    const { t } = useDiscoverI18n();
    const [showAllStudios, setShowAllStudios] = useState(false);

    const factRows = useMemo(() => buildMediaFactRows(mediaType, details), [mediaType, details]);
    const crew = useMemo(
        () => sortKeyCrew(details?.credits?.crew || []).slice(0, 6),
        [details?.credits?.crew],
    );
    const keywords = useMemo(() => {
        const raw = details?.keywords;
        if (Array.isArray(raw)) return raw;
        if (Array.isArray(raw?.keywords)) return raw.keywords;
        if (Array.isArray(raw?.results)) return raw.results;
        return [];
    }, [details?.keywords]);
    const externalLinks = useMemo(
        () => buildExternalLinks(mediaType, details, ratings),
        [mediaType, details, ratings],
    );
    const trailerUrl = useMemo(() => {
        const videos = details?.relatedVideos || details?.videos?.results || details?.videos || [];
        const list = Array.isArray(videos) ? videos : [];
        const trailer = list.find((video) => video?.type === 'Trailer' && video?.site === 'YouTube')
            || list.find((video) => video?.site === 'YouTube');
        if (!trailer) return null;
        if (trailer.url) return trailer.url;
        if (trailer.key) return `https://www.youtube.com/watch?v=${trailer.key}`;
        return null;
    }, [details]);

    const tmdbScore = Number(details?.voteAverage) > 0
        ? `${Math.round(Number(details.voteAverage) * 10)}%`
        : null;
    const tmdbUrl = buildExternalLinks(mediaType, details)[0]?.url || null;

    const visibleFactRows = factRows;
    const studios = useMemo(() => getProductionStudios(details), [details]);
    const visibleStudios = showAllStudios ? studios : studios.slice(0, 3);
    const networks = Array.isArray(details?.networks) ? details.networks : [];

    const hasRatings = !!(
        Number.isFinite(Number(ratings?.rt?.criticsScore))
        || Number.isFinite(Number(ratings?.rt?.audienceScore))
        || ratings?.imdb?.criticsScore != null
        || tmdbScore
    );

    if (!hasRatings && !visibleFactRows.length && !studios.length && !networks.length && !crew.length && !keywords.length && !externalLinks.length && !trailerUrl && !details?.collection) {
        return null;
    }

    return (
        <div className="flex flex-col gap-5 max-w-5xl">
            {(hasRatings || trailerUrl) && (
                <div className="flex flex-wrap items-center gap-2">
                    <MediaRatingPills ratings={ratings} tmdbScore={tmdbScore} tmdbUrl={tmdbUrl} />
                    {trailerUrl && (
                        <a
                            href={trailerUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white/5 px-2.5 py-1.5 text-xs font-bold text-text transition-all hover:brightness-110 hover:scale-[1.02] hover:bg-white/10 hover:border-plex/40"
                        >
                            <Play className="w-5 h-5 shrink-0" />
                            {t('media.watchTrailer')}
                        </a>
                    )}
                </div>
            )}

            {(visibleFactRows.length > 0 || studios.length > 0) && (
                <div className="flex flex-col gap-3">
                    <SectionLabel>{t('media.details')}</SectionLabel>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3">
                        {visibleFactRows.map((row) => (
                            <div key={row.key} className="flex flex-col gap-0.5 min-w-0">
                                <span className="text-[10px] font-bold uppercase tracking-wider text-muted">
                                    {t(`facts.${row.key}`)}
                                </span>
                                {row.people?.length ? (
                                    <div className="flex flex-wrap gap-2">
                                        {row.people.map((person) => (
                                            <button
                                                key={person.id}
                                                type="button"
                                                onClick={() => onOpenPerson?.(person.id)}
                                                className="px-2.5 py-1 rounded-lg bg-white/5 border border-border text-sm text-text hover:bg-plex/15 hover:border-plex/40 hover:text-plex transition-colors cursor-pointer"
                                            >
                                                {person.name}
                                            </button>
                                        ))}
                                    </div>
                                ) : (
                                    <span className="text-sm text-text leading-snug">
                                        {row.key === 'status' ? translateDiscoverStatus(t, row.value) : row.value}
                                    </span>
                                )}
                            </div>
                        ))}
                        {studios.length > 0 && (
                            <div className="flex flex-col gap-2 min-w-0 sm:col-span-2">
                                <span className="text-[10px] font-bold uppercase tracking-wider text-muted">
                                    {studios.length === 1 ? t('media.studio') : t('media.studios')}
                                </span>
                                <div className="flex flex-wrap gap-2">
                                    {visibleStudios.map((studio) => (
                                        <button
                                            key={studio.id}
                                            type="button"
                                            onClick={() => onOpenStudio?.(studio.id)}
                                            className="px-2.5 py-1 rounded-lg bg-white/5 border border-border text-sm text-text hover:bg-plex/15 hover:border-plex/40 hover:text-plex transition-colors cursor-pointer"
                                        >
                                            {studio.name}
                                        </button>
                                    ))}
                                </div>
                                {studios.length > 3 && (
                                    <button
                                        type="button"
                                        onClick={() => setShowAllStudios((prev) => !prev)}
                                        className="self-start text-xs font-semibold text-plex hover:text-plex-hover transition-colors"
                                    >
                                        {showAllStudios ? t('common.showLess') : t('media.showMoreStudios', { count: studios.length - 3 })}
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {details?.collection?.id && details?.collection?.name && (
                <button
                    type="button"
                    onClick={() => onOpenCollection?.(Number(details.collection.id))}
                    className="group text-left rounded-xl border border-border bg-white/5 overflow-hidden hover:border-plex/30 transition-colors w-fit max-w-full"
                >
                    <div className="px-4 py-3 flex items-center justify-between gap-3 min-w-[12rem]">
                        <div className="min-w-0">
                            <div className="text-[9px] font-bold uppercase tracking-wider text-muted">{t('media.collection')}</div>
                            <div className="text-sm font-semibold text-text mt-1 truncate">{details.collection.name}</div>
                        </div>
                        <ArrowRight className="w-4 h-4 text-muted group-hover:text-plex transition-colors shrink-0" />
                    </div>
                </button>
            )}

            {networks.length > 0 && (
                <div className="flex flex-col gap-3">
                    <SectionLabel>{t('home.networks')}</SectionLabel>
                    <div className="flex flex-wrap gap-5 items-center">
                        {networks.map((network: any) => (
                            <button
                                key={network.id}
                                type="button"
                                onClick={() => onOpenNetwork?.(network.id)}
                                className="flex items-center rounded-lg border border-transparent px-2 py-1.5 transition-all hover:border-border hover:bg-white/5 cursor-pointer"
                                title={t('category.browseName', { name: network.name })}
                            >
                                {network.logoPath ? (
                                    <DiscoveryLogo
                                        logoPath={network.logoPath}
                                        alt={network.name}
                                        width={154}
                                        className="h-6 max-w-[120px] object-contain opacity-90 hover:opacity-100 transition-opacity"
                                    />
                                ) : (
                                    <span className="text-xs font-semibold text-muted hover:text-text transition-colors">{network.name}</span>
                                )}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            <DiscoveryFactWidget mediaType={mediaType} mediaId={mediaId} />

            {crew.length > 0 && (
                <div className="flex flex-col gap-3">
                    <SectionLabel>{t('media.keyCrew')}</SectionLabel>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
                        {crew.map((person: any) => (
                            <button
                                key={`${person.id}-${person.job}`}
                                type="button"
                                onClick={() => onOpenPerson?.(person.id)}
                                className="flex items-baseline justify-between gap-3 text-left border-0 bg-transparent p-0 group cursor-pointer min-w-0"
                            >
                                <span className="text-[11px] uppercase tracking-wide text-muted shrink-0">{person.job}</span>
                                <span className="text-sm text-text group-hover:text-plex transition-colors truncate">
                                    {person.name}
                                </span>
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {keywords.length > 0 && (
                <div className="flex flex-col gap-3">
                    <SectionLabel>{t('media.keywords')}</SectionLabel>
                    <div className="flex flex-wrap gap-2">
                        {keywords.slice(0, 24).map((keyword: any) => (
                            <button
                                key={keyword.id}
                                type="button"
                                onClick={() => onOpenKeyword?.({
                                    id: Number(keyword.id),
                                    name: String(keyword.name || ''),
                                })}
                                className="px-2.5 py-1 rounded-lg bg-white/5 border border-border text-[11px] font-medium text-muted hover:bg-plex/15 hover:border-plex/40 hover:text-text transition-colors cursor-pointer"
                            >
                                {keyword.name}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {externalLinks.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                    {externalLinks.map((link) => (
                        <a
                            key={link.key}
                            href={link.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border bg-white/5 text-[11px] font-semibold text-muted hover:text-text hover:border-border hover:bg-white/10 transition-colors"
                        >
                            <ExternalLink className="w-3 h-3 opacity-70" />
                            {link.label}
                        </a>
                    ))}
                </div>
            )}
        </div>
    );
};
