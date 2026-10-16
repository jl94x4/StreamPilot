import React, { useEffect, useState } from 'react';
import { apiFetch } from '../shared/api';
import { resolveTmdbImageUrl } from '../discovery/tmdbImageUrl';
import { discoverRowPath } from '../discovery/discoverHomeRails';
import type { DiscoverTranslate } from '../discovery/i18n/types';
import { PosterCardSkeleton } from '../shared/skeletons';
import { HomePosterScrollRow } from './HomePosterScrollRow';

type PosterCardProps = {
    item: {
        title: string;
        thumb?: string;
        thumbUrl?: string;
        plexUrl: string;
        tags?: string[];
        year?: number | string;
        parentTitle?: string;
    };
    variant?: 'discover' | 'home';
    className?: string;
    footer?: React.ReactNode;
    showQualityBadges?: boolean;
    loading?: 'lazy' | 'eager';
    fetchPriority?: 'high' | 'low' | 'auto';
    onPosterClick?: () => void;
};

type Props = {
    t: DiscoverTranslate;
    DiscoverPosterCard: React.ComponentType<PosterCardProps>;
    onNavigate?: (route: string, options?: { path?: string }) => void;
    enabled: boolean;
};

type BecauseYouWatchedResult = {
    id?: number;
    tmdbId?: number;
    mediaType?: string;
    type?: string;
    title?: string;
    name?: string;
    posterPath?: string | null;
    posterUrl?: string | null;
    releaseDate?: string | null;
    firstAirDate?: string | null;
};

const resultYear = (item: BecauseYouWatchedResult) => {
    const raw = String(item.releaseDate || item.firstAirDate || '').slice(0, 4);
    return raw && /^\d{4}$/.test(raw) ? raw : undefined;
};

export const BecauseYouWatchedHomeRail: React.FC<Props> = ({
    t,
    DiscoverPosterCard,
    onNavigate,
    enabled,
}) => {
    const [seedTitle, setSeedTitle] = useState<string>('');
    const [results, setResults] = useState<BecauseYouWatchedResult[] | null>(null);

    useEffect(() => {
        if (!enabled) return;
        let cancelled = false;
        apiFetch('/api/discovery/because-you-watched')
            .then((data) => {
                if (cancelled) return;
                const seed = data?.seed;
                setSeedTitle(String(seed?.title || '').trim());
                setResults(Array.isArray(data?.results) ? data.results : []);
            })
            .catch(() => {
                if (!cancelled) setResults([]);
            });
        return () => { cancelled = true; };
    }, [enabled]);

    if (!enabled) return null;
    if (results === null) {
        return (
            <HomePosterScrollRow title={t('home.becauseYouWatchedFallback')} t={t}>
                {Array.from({ length: 8 }, (_, idx) => (
                    <PosterCardSkeleton
                        key={idx}
                        variant="home"
                        className="snap-start shrink-0 w-32 md:w-40"
                    />
                ))}
            </HomePosterScrollRow>
        );
    }
    if (!results.length) return null;

    const title = seedTitle
        ? t('home.becauseYouWatched', { title: seedTitle })
        : t('home.becauseYouWatchedFallback');
    const openRow = () => onNavigate?.('discovery', { path: discoverRowPath('because-you-watched') });

    return (
        <HomePosterScrollRow
            title={title}
            t={t}
            onViewAll={onNavigate ? openRow : undefined}
            viewAllLabel={t('common.viewAll')}
        >
            {results.slice(0, 24).map((item, idx) => {
                const mediaType = item.mediaType === 'tv' || item.type === 'tv' ? 'tv' : 'movie';
                const mediaId = Number(item.tmdbId || item.id || 0);
                const year = resultYear(item);
                const posterUrl = item.posterUrl || resolveTmdbImageUrl(item.posterPath, 'w342');
                const openDetails = mediaId > 0
                    ? () => onNavigate?.('discovery', { path: `/discovery/${mediaType}/${mediaId}` })
                    : openRow;
                return (
                    <DiscoverPosterCard
                        key={`${mediaType}-${mediaId || idx}`}
                        variant="home"
                        className="snap-start shrink-0 w-32 md:w-40"
                        item={{
                            title: String(item.title || item.name || ''),
                            thumbUrl: posterUrl || undefined,
                            plexUrl: '#',
                            year,
                        }}
                        showQualityBadges={false}
                        loading={idx < 8 ? 'eager' : 'lazy'}
                        fetchPriority={idx < 4 ? 'high' : 'auto'}
                        onPosterClick={openDetails}
                        footer={(
                            <div className="flex flex-col px-1">
                                <p className="text-xs font-bold text-text truncate group-hover:text-plex transition-colors">
                                    {item.title || item.name}
                                </p>
                                {year ? <p className="text-[10px] text-muted font-semibold mt-0.5">{year}</p> : null}
                            </div>
                        )}
                    />
                );
            })}
        </HomePosterScrollRow>
    );
};
