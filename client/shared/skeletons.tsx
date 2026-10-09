import React from 'react';
import {
    discoverPosterGridClass,
    type PosterGridValue,
    upgraderPosterGridClass,
    upgraderPosterGridStyle,
} from './portalLayout';
import { useSkeletonLayoutCounts } from './useSkeletonLayoutCounts';

const pulse = 'skeleton-base';

export const SkeletonBlock: React.FC<{ className?: string }> = ({ className = '' }) => (
    <div className={`${pulse} rounded ${className}`} aria-hidden="true" />
);

export const PosterCardSkeleton: React.FC<{
    aspect?: '2/3' | 'square';
    variant?: 'home' | 'discover';
    className?: string;
    /** Stagger shimmer entrance across a grid (ms). */
    delayMs?: number;
}> = ({ aspect = '2/3', variant = 'discover', className = '', delayMs = 0 }) => (
    <div
        className={`flex flex-col gap-2 discover-poster-enter ${className}`}
        style={delayMs > 0 ? { animationDelay: `${delayMs}ms` } : undefined}
        aria-hidden="true"
    >
        <SkeletonBlock className={`w-full rounded-xl border border-white/5 ${aspect === 'square' ? 'aspect-square' : 'aspect-[2/3]'}`} />
        <SkeletonBlock className={`h-3 rounded ${variant === 'home' ? 'w-3/4' : 'w-full'}`} />
        {variant === 'home' && <SkeletonBlock className="h-2 w-1/3 rounded" />}
    </div>
);

export const PosterGridSkeleton: React.FC<{
    count?: number;
    aspect?: '2/3' | 'square';
    rows?: number;
    className?: string;
    style?: React.CSSProperties;
}> = ({
    count,
    aspect = '2/3',
    rows = 2,
    className,
    style,
}) => {
    const { grid: defaultCount } = useSkeletonLayoutCounts({ gridRows: rows });
    const itemCount = count ?? defaultCount;

    return (
        <div className={className || discoverPosterGridClass} style={style} aria-hidden="true">
            {Array.from({ length: itemCount }, (_, i) => (
                <PosterCardSkeleton key={i} aspect={aspect} variant="discover" />
            ))}
        </div>
    );
};

export const PosterRowSkeleton: React.FC<{ count?: number; aspect?: '2/3' | 'square'; cardWidth?: string }> = ({
    count,
    aspect = '2/3',
    cardWidth = 'w-full min-w-0',
}) => {
    const { carousel: defaultCount } = useSkeletonLayoutCounts();
    const tv = typeof document !== 'undefined' && document.documentElement.dataset.tv === '1';
    const itemCount = Math.max(count ?? defaultCount, tv ? 12 : 4);

    return (
        <div className="flex w-full gap-4 overflow-hidden py-2" aria-hidden="true">
            {Array.from({ length: itemCount }, (_, i) => (
                <PosterCardSkeleton
                    key={i}
                    aspect={aspect}
                    variant="home"
                    className={cardWidth === 'w-full min-w-0' ? 'w-[170px] shrink-0 sm:w-[196px]' : `${cardWidth} shrink-0`}
                />
            ))}
        </div>
    );
};

/** Phone/web media-player home — matches the loaded 16:9 hero + inset poster rails. TV uses DiscoverHomeRowSkeleton. */
export const PlayerHomeHeroSkeleton: React.FC = () => (
    <div
        className="player-home-hero relative overflow-hidden rounded-[1.35rem] border border-white/[0.08] bg-[#07090d] max-md:rounded-[1.1rem]"
        aria-hidden="true"
    >
        <div className="player-home-hero-stage relative aspect-[21/9] min-h-[280px] max-h-[460px] w-full overflow-hidden sm:min-h-[340px] sm:max-h-[520px] max-md:aspect-[16/9] max-md:min-h-[12.25rem] max-md:max-h-[34vh]">
            <div className={`${pulse} absolute inset-0 rounded-none`} />
            <div className="absolute inset-0 z-10 flex flex-col justify-end gap-2.5 p-4 sm:p-6 max-md:gap-2 max-md:p-3.5">
                <SkeletonBlock className="h-11 w-[min(68%,16rem)] rounded-md max-md:h-10 max-md:w-[min(70%,14rem)]" />
                <div className="flex items-center gap-2.5">
                    <SkeletonBlock className="h-10 w-[5.75rem] rounded-full" />
                    <SkeletonBlock className="h-10 w-[4.75rem] rounded-full" />
                </div>
                <SkeletonBlock className="mt-1 h-1 w-16 rounded-full" />
            </div>
        </div>
    </div>
);

export const PlayerHomeRowSkeleton: React.FC<{ count?: number }> = ({ count = 6 }) => (
    <div className="flex min-w-0 max-w-full flex-col gap-2" aria-hidden="true">
        <div className="player-row-header flex min-w-0 items-center gap-3">
            <span className="player-row-header-mark shrink-0" aria-hidden />
            <SkeletonBlock className="h-[1.05rem] w-36 max-w-[55%] rounded" />
        </div>
        <div className="flex w-full gap-4 overflow-hidden py-2">
            {Array.from({ length: count }, (_, i) => (
                <div
                    key={i}
                    className="player-home-skel-card flex w-[min(40vw,10rem)] shrink-0 flex-col gap-2 md:w-[10.625rem]"
                >
                    <SkeletonBlock className="aspect-[2/3] w-full rounded-xl border border-white/5" />
                    <SkeletonBlock className="h-3 w-3/4 rounded" />
                </div>
            ))}
        </div>
    </div>
);

export const PlayerHomeSkeleton: React.FC = () => (
    <div className="tv-poster-rows flex w-full flex-col gap-6 pb-8" aria-busy="true" aria-label="Loading home">
        <PlayerHomeHeroSkeleton />
        <div className="flex flex-col gap-2" aria-hidden="true">
            <SkeletonBlock className="h-2.5 w-24 rounded" />
            <div className="flex gap-2 overflow-hidden">
                {Array.from({ length: 5 }, (_, i) => (
                    <SkeletonBlock key={i} className="h-9 w-[7.25rem] shrink-0 rounded-full" />
                ))}
            </div>
        </div>
        <PlayerHomeRowSkeleton />
        <PlayerHomeRowSkeleton />
        <PlayerHomeRowSkeleton />
        <PlayerHomeRowSkeleton />
    </div>
);

export const DiscoverHomeRowSkeleton: React.FC<{
    showViewAll?: boolean;
    showSubtitle?: boolean;
    showAction?: boolean;
    count?: number;
    aspect?: '2/3' | 'square';
}> = ({ showViewAll = false, showSubtitle = false, showAction = false, count, aspect = '2/3' }) => (
    <div className="flex flex-col gap-2 relative" aria-hidden="true">
        <div className="flex items-start justify-between gap-3 px-2">
            <div className="flex flex-col gap-1.5 min-w-0">
                <SkeletonBlock className="h-6 w-40 max-w-[70%] rounded" />
                {showSubtitle && <SkeletonBlock className="h-3 w-56 max-w-full rounded" />}
            </div>
            <div className="flex items-center gap-2 shrink-0">
                {showViewAll && <SkeletonBlock className="h-4 w-14 rounded" />}
                {showAction && <SkeletonBlock className="h-8 w-28 rounded-xl" />}
            </div>
        </div>
        <PosterRowSkeleton count={count} aspect={aspect} />
    </div>
);

export const DiscoverHomeSkeleton: React.FC = () => {
    const { carousel } = useSkeletonLayoutCounts();

    return (
    <div className="discover-layout-container flex flex-col gap-4 w-full max-w-full overflow-hidden pb-8" aria-busy="true" aria-label="Loading discover">
        <DiscoverHomeRowSkeleton />
        <DiscoverHomeRowSkeleton showViewAll />
        <DiscoverHomeRowSkeleton showViewAll showSubtitle showAction />
        <DiscoverHomeRowSkeleton showViewAll />
        <DiscoverHomeRowSkeleton showViewAll />
        <DiscoverHomeRowSkeleton />
        <div className="flex flex-col gap-2 relative" aria-hidden="true">
            <SkeletonBlock className="h-6 w-36 rounded ml-2" />
            <div
                className="grid w-full gap-4 py-2 px-2"
                style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}
            >
                {Array.from({ length: carousel }, (_, i) => (
                    <SkeletonBlock key={i} className="w-full h-[88px] sm:h-[100px] rounded-xl" />
                ))}
            </div>
        </div>
        <DiscoverHomeRowSkeleton showViewAll />
        <DiscoverHomeRowSkeleton />
        <DiscoverHomeRowSkeleton showViewAll />
        <div className="flex flex-col gap-2 relative" aria-hidden="true">
            <SkeletonBlock className="h-6 w-28 rounded ml-2" />
            <div
                className="grid w-full gap-4 py-2 px-2"
                style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))' }}
            >
                {Array.from({ length: Math.max(4, carousel - 1) }, (_, i) => (
                    <SkeletonBlock key={i} className="w-full h-[100px] sm:h-[112px] rounded-xl" />
                ))}
            </div>
        </div>
    </div>
    );
};

export const HomeRecentlyAddedSkeleton: React.FC = () => (
    <div className="flex flex-col gap-3 md:gap-4 w-full" aria-busy="true" aria-label="Loading recently added">
        <div className="glass-card p-4 md:p-5 shadow-xl overflow-hidden w-full">
            <h3 className="text-lg md:text-xl font-bold text-text mb-3">Recently Added Movies</h3>
            <PosterRowSkeleton count={6} />
        </div>
        <div className="glass-card p-4 md:p-5 shadow-xl overflow-hidden w-full">
            <h3 className="text-lg md:text-xl font-bold text-text mb-3">Recently Added TV Shows</h3>
            <PosterRowSkeleton count={6} />
        </div>
        <div className="glass-card p-4 md:p-5 shadow-xl overflow-hidden w-full">
            <h3 className="text-lg md:text-xl font-bold text-text mb-3">Recently Added Music</h3>
            <PosterRowSkeleton count={6} aspect="square" />
        </div>
    </div>
);

export const DiscoverSectionSkeleton: React.FC<{
    title: string;
    count?: number;
    aspect?: '2/3' | 'square';
    rows?: number;
    gridSize?: PosterGridValue;
}> = ({
    title,
    count,
    aspect = '2/3',
    rows = 2,
    gridSize = 'large',
}) => {
    const { grid: defaultCount } = useSkeletonLayoutCounts({ gridRows: rows });
    const itemCount = count ?? defaultCount;

    return (
        <div className="flex flex-col" aria-hidden="true">
            <h2 className="text-plex text-sm uppercase tracking-[2px] mb-6 font-bold border-b border-white/10 pb-2">{title}</h2>
            <div className={upgraderPosterGridClass(gridSize)} style={upgraderPosterGridStyle(gridSize)}>
                {Array.from({ length: itemCount }, (_, i) => (
                    <div key={i} className="flex flex-col gap-1 min-w-0">
                        <SkeletonBlock className={`w-full rounded-lg border border-white/5 ${aspect === 'square' ? 'aspect-square' : 'aspect-[2/3]'}`} />
                        <SkeletonBlock className="h-3 w-full rounded" />
                    </div>
                ))}
            </div>
        </div>
    );
};

export const DiscoverPageSkeleton: React.FC<{ recentLimit?: number; gridSize?: PosterGridValue }> = ({
    recentLimit = 20,
    gridSize = 'large',
}) => {
    const sectionCount = Math.max(6, Math.min(40, Number(recentLimit) || 20));

    return (
        <div className="w-full min-w-0 flex flex-col shrink-0" aria-busy="true" aria-label="Loading dashboard">
            <main className="discover-layout-container w-full min-w-0 pb-8 mt-4 md:mt-0">
                <section className="mb-12 w-full">
                    <h2 className="text-plex text-sm uppercase tracking-[2px] mb-6 font-bold border-b border-white/10 pb-2">ACTIVITY</h2>
                    <ActivityGridSkeleton count={3} />
                </section>

                {/* Match loaded Grid / Per section controls so they don't look like stray floating bones */}
                <div className="flex justify-end gap-2 sm:gap-3 items-end mb-8 flex-wrap" aria-hidden="true">
                    <div className="flex flex-col gap-1">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-muted px-0.5">Grid</span>
                        <SkeletonBlock className="h-10 w-36 rounded-lg" />
                    </div>
                    <div className="flex flex-col gap-1">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-muted px-0.5">Per section</span>
                        <SkeletonBlock className="h-10 w-28 rounded-lg" />
                    </div>
                </div>

                <div className="flex flex-col gap-12 w-full">
                    <DiscoverSectionSkeleton title="RECENTLY ADDED MOVIES" count={sectionCount} gridSize={gridSize} />
                    <DiscoverSectionSkeleton title="RECENTLY ADDED TV SHOWS" count={sectionCount} gridSize={gridSize} />
                    <DiscoverSectionSkeleton title="RECENTLY ADDED MUSIC" count={sectionCount} aspect="square" gridSize={gridSize} />
                </div>

                <div className="mt-16 w-full flex flex-col gap-12">
                    <div className="flex flex-col gap-2 items-center text-center mb-4" aria-hidden="true">
                        <SkeletonBlock className="h-10 w-72 max-w-full rounded" />
                        <SkeletonBlock className="h-4 w-96 max-w-full rounded" />
                    </div>
                    <DiscoverSectionSkeleton title="🔥 TRENDING THIS WEEK" count={sectionCount} gridSize={gridSize} />
                    <DiscoverSectionSkeleton title="🍿 MOST WATCHED MOVIES (THIS MONTH)" count={sectionCount} gridSize={gridSize} />
                    <DiscoverSectionSkeleton title="📺 MOST WATCHED SHOWS (THIS MONTH)" count={sectionCount} gridSize={gridSize} />
                </div>
            </main>
        </div>
    );
};

export const LibraryStatsSkeleton: React.FC = () => (
    <div className="space-y-3" aria-hidden="true">
        <div className="space-y-2">
            <SkeletonBlock className="h-3 w-24 rounded" />
            <SkeletonBlock className="h-8 w-32 rounded" />
            <SkeletonBlock className="h-3 w-40 rounded" />
        </div>
        <SkeletonBlock className="h-1.5 w-full rounded-full" />
        {Array.from({ length: 3 }, (_, i) => (
            <SkeletonBlock key={i} className="h-12 w-full rounded-lg" />
        ))}
    </div>
);

export const WrapUpCardsSkeleton: React.FC = () => (
    <div className="glass-card p-4 md:p-5 shadow-xl" aria-busy="true" aria-label="Loading personal wrap-up">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3 md:mb-4">
            <SkeletonBlock className="h-6 w-48 rounded" />
            <SkeletonBlock className="h-9 w-32 rounded-lg" />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2.5 md:gap-3" aria-hidden="true">
            {Array.from({ length: 10 }, (_, i) => (
                <SkeletonBlock key={i} className="rounded-xl min-h-[112px]" />
            ))}
        </div>
    </div>
);

export const ActivityCardSkeleton: React.FC = () => (
    <div className="bg-card rounded-xl border border-border flex flex-col overflow-hidden shadow-lg h-full min-h-[11.5rem] md:min-h-[14.5rem]" aria-hidden="true">
        <div className="flex flex-row flex-1 items-stretch min-h-0">
            <SkeletonBlock className="w-32 md:w-40 flex-shrink-0 self-stretch rounded-none min-h-[11.5rem] md:min-h-[14.5rem]" />
            <div className="p-4 flex flex-col flex-1 gap-3 min-w-0">
                <SkeletonBlock className="h-4 w-3/4 rounded" />
                <SkeletonBlock className="h-3 w-1/2 rounded" />
                <div className="flex gap-2 mt-1">
                    <SkeletonBlock className="h-4 w-12 rounded" />
                    <SkeletonBlock className="h-4 w-12 rounded" />
                </div>
                <div className="flex flex-col gap-2 mt-auto pt-2">
                    <SkeletonBlock className="h-3 w-full rounded" />
                    <SkeletonBlock className="h-3 w-4/5 rounded" />
                    <SkeletonBlock className="h-3 w-3/5 rounded" />
                </div>
            </div>
        </div>
        {/* Match real activity progress track (solid, not a second shimmer bar) */}
        <div className="w-full h-4 bg-white/10 mt-auto overflow-hidden rounded-b-lg">
            <SkeletonBlock className="h-full w-2/5 rounded-none" />
        </div>
    </div>
);

export const ActivityGridSkeleton: React.FC<{ count?: number }> = ({ count = 3 }) => (
    <div className="discover-activity-grid" aria-hidden="true">
        {Array.from({ length: count }, (_, i) => (
            <ActivityCardSkeleton key={i} />
        ))}
    </div>
);

export const TopWatchedGridSkeleton: React.FC = () => (
    <div className="glass-card flex-1 flex flex-col h-full w-full min-h-0 p-4 md:p-5 shadow-xl" aria-busy="true" aria-label="Loading analytics">
        <div className="mb-3 md:mb-4">
            <SkeletonBlock className="h-6 w-40 rounded mb-2" />
            <SkeletonBlock className="h-4 w-56 rounded" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 flex-1 content-start" aria-hidden="true">
            {Array.from({ length: 4 }, (_, i) => (
                <SkeletonBlock key={i} className="min-h-[8.5rem] w-full rounded-2xl" />
            ))}
        </div>
    </div>
);

export const TrendingSectionsSkeleton: React.FC<{ count?: number; sections?: number; rows?: number }> = ({
    count,
    sections = 3,
    rows = 2,
}) => (
    <div className="discover-layout-container mt-16 w-full flex flex-col gap-12" aria-busy="true" aria-label="Loading trending">
        <div className="flex flex-col gap-2 items-center text-center mb-4">
            <SkeletonBlock className="h-10 w-72 max-w-full rounded" />
            <SkeletonBlock className="h-4 w-96 max-w-full rounded" />
        </div>
        {Array.from({ length: sections }, (_, i) => (
            <div key={i} className="flex flex-col" aria-hidden="true">
                <SkeletonBlock className="h-4 w-56 mb-6 rounded" />
                <PosterGridSkeleton count={count} rows={rows} />
            </div>
        ))}
    </div>
);
