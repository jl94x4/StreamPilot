import React from 'react';
import { discoveryTheme } from './discoveryThemeClasses';

export const DiscoverSectionHeader: React.FC<{
    title: string;
    onViewAll?: () => void;
    viewAllLabel?: string;
    className?: string;
}> = ({ title, onViewAll, viewAllLabel, className = '' }) => (
    <div className={`player-row-header flex items-center gap-3 min-w-0 pr-16 max-md:pr-0 ${className}`.trim()}>
        <span className="player-row-header-mark shrink-0" aria-hidden />
        {onViewAll ? (
            <button
                type="button"
                onClick={onViewAll}
                className={`player-row-header-title ${discoveryTheme.sectionTitle} min-w-0 truncate text-left hover:text-plex transition-colors`}
            >
                {title}
            </button>
        ) : (
            <h2 className={`player-row-header-title ${discoveryTheme.sectionTitle} min-w-0 truncate`}>
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
