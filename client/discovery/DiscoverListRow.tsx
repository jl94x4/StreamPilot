import React from 'react';
import { RetryablePoster } from '../shared/RetryablePoster';
import { NoPosterPlaceholder } from '../shared/NoPosterPlaceholder';
import { resolvePortalAssetUrl } from '../shared/basePath';

type Props = {
    item: any;
    compact?: boolean;
    onClick: () => void;
    onHover?: () => void;
};

const typeLabel = (item: any) => {
    const type = item?.mediaType || item?.type;
    if (type === 'tv') return 'TV';
    if (type === 'movie') return 'Movie';
    if (type === 'music') return 'Music';
    if (type === 'person') return 'Person';
    return '';
};

/** One-line (compact) or poster + synopsis (list) row for Discover browse pages. */
export const DiscoverListRow = React.memo(({ item, compact = false, onClick, onHover }: Props) => {
    const poster = item.thumbUrl ? resolvePortalAssetUrl(item.thumbUrl) : '';
    const meta = [typeLabel(item), item.year].filter(Boolean).join(' · ');
    return (
        <button
            type="button"
            onClick={onClick}
            onMouseEnter={onHover}
            onFocus={onHover}
            data-tv-item="1"
            className={`flex w-full items-center gap-3 rounded-xl border border-border bg-card/50 text-left transition-colors hover:border-plex/40 hover:bg-card ${
                compact ? 'p-1.5 pr-3' : 'p-2.5 sm:p-3 items-start'
            }`}
            style={{ color: 'inherit' }}
        >
            <span
                className={`relative shrink-0 overflow-hidden rounded-lg border border-border bg-background/40 ${
                    compact ? 'h-14 w-10' : 'h-28 w-[4.5rem] sm:h-32 sm:w-20'
                }`}
            >
                {poster ? (
                    <RetryablePoster
                        src={poster}
                        alt=""
                        loading="lazy"
                        compactPlaceholder
                        className="absolute inset-0 h-full w-full object-cover"
                    />
                ) : (
                    <NoPosterPlaceholder compact />
                )}
            </span>
            <span className="min-w-0 flex-1">
                <span className={`block font-bold leading-snug text-text ${compact ? 'truncate text-sm' : 'line-clamp-2 text-base'}`}>
                    {item.title}
                </span>
                {meta ? <span className="mt-0.5 block text-xs text-muted">{meta}</span> : null}
                {!compact && item.overview ? (
                    <span className="mt-1.5 line-clamp-3 block text-xs leading-relaxed text-muted/90 sm:text-sm">
                        {item.overview}
                    </span>
                ) : null}
            </span>
            {item.overlay ? (
                <span className={`relative shrink-0 self-stretch ${compact ? 'w-7' : 'w-8'}`}>{item.overlay}</span>
            ) : null}
        </button>
    );
});
