import React from 'react';

export const DiscoverSectionHeader: React.FC<{
    title: string;
    onViewAll?: () => void;
    viewAllLabel?: string;
    className?: string;
}> = ({ title, onViewAll, viewAllLabel, className = '' }) => (
    <div className={`player-row-header flex items-center gap-3 min-w-0 pr-16 max-md:pr-0 ${className}`.trim()}>
        <svg className="player-row-header-mark shrink-0" viewBox="0 0 24 24" aria-hidden="true">
            <polygon points="4,2 22,12 4,22" />
        </svg>
        {onViewAll ? (
            <button
                type="button"
                onClick={onViewAll}
                className="player-row-header-title min-w-0 truncate text-left text-xl font-bold text-text transition-colors hover:text-plex"
            >
                {title}
            </button>
        ) : (
            <h2 className="player-row-header-title min-w-0 truncate text-xl font-bold text-text">
                {title}
            </h2>
        )}
        {onViewAll && viewAllLabel ? (
            <button
                type="button"
                onClick={onViewAll}
                className="shrink-0 text-xs font-bold text-plex hover:underline"
            >
                {viewAllLabel}
            </button>
        ) : null}
    </div>
);
