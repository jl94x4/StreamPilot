import React from 'react';
import { ChevronRight } from 'lucide-react';
import { RowHeaderMark } from '../shared/RowHeaderMark';

export const DiscoverSectionHeader: React.FC<{
    title: string;
    onViewAll?: () => void;
    viewAllLabel?: string;
    className?: string;
    /** Phone (Plex mobile style): small line under the title, e.g. the server name. */
    subtitle?: string;
    /** Phone: a chevron after the title stands in for the View all link. */
    chevron?: boolean;
}> = ({ title, onViewAll, viewAllLabel, className = '', subtitle, chevron = false }) => {
    const heading = (
        <>
            {onViewAll ? (
                <button
                    type="button"
                    onClick={onViewAll}
                    className={`player-row-header-title min-w-0 truncate text-left text-xl font-bold text-text transition-colors hover:text-plex${
                        chevron ? ' inline-flex items-center gap-1.5' : ''
                    }`}
                >
                    {chevron ? (
                        <>
                            <span className="min-w-0 truncate">{title}</span>
                            <ChevronRight className="player-row-header-chevron h-[1.1em] w-[1.1em] shrink-0 opacity-80" aria-hidden />
                        </>
                    ) : title}
                </button>
            ) : (
                <h2 className="player-row-header-title min-w-0 truncate text-xl font-bold text-text">
                    {title}
                </h2>
            )}
            {onViewAll && viewAllLabel && !chevron ? (
                <button
                    type="button"
                    onClick={onViewAll}
                    className="shrink-0 text-xs font-bold text-plex hover:underline"
                >
                    {viewAllLabel}
                </button>
            ) : null}
        </>
    );
    if (!subtitle) {
        return (
            <div className={`player-row-header flex items-center gap-3 min-w-0 pr-16 max-md:pr-0 ${className}`.trim()}>
                <RowHeaderMark />
                {heading}
            </div>
        );
    }
    // Two lines: the marker stays beside the title and the subtitle lines up under it.
    return (
        <div className={`player-row-header player-row-header--sub grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center pr-16 max-md:pr-0 ${className}`.trim()}>
            {/* Own column; Row marker "None" renders nothing, so the margin goes too. */}
            <span className="col-start-1 row-start-1 mr-3 flex items-center empty:mr-0"><RowHeaderMark /></span>
            <div className="col-start-2 row-start-1 flex min-w-0 items-center gap-3">{heading}</div>
            <p className="player-row-header-subtitle col-start-2 min-w-0 truncate text-sm text-muted">{subtitle}</p>
        </div>
    );
};
