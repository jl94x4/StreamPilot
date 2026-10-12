import React, { useEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import {
    fetchMediaPlayerCollection,
    fetchMediaPlayerHub,
    fetchMediaPlayerPlaylist,
    fetchMediaPlayerWatchlist,
} from './api';
import { playerCardImageUrl } from './playerUtils';
import type { PlayerItem, PlayerLibraryHub } from './types';

export type ViewMoreShelfSource = {
    path?: string;
    identifier?: string;
    watchlist?: boolean;
    collectionRatingKey?: string;
    playlistRatingKey?: string;
};

/** Resolve a hub/rail into a shelf fetch target for posters beyond the visible row. */
export const viewMoreShelfFromHub = (
    hub: Pick<PlayerLibraryHub, 'hubKey' | 'identifier' | 'collectionRatingKey' | 'playlistRatingKey'>,
): ViewMoreShelfSource | null => {
    const path = String(hub.hubKey || '').trim();
    if (path) return { path, identifier: hub.identifier || undefined };
    const collectionRatingKey = String(hub.collectionRatingKey || '').trim();
    if (collectionRatingKey) return { collectionRatingKey };
    const playlistRatingKey = String(hub.playlistRatingKey || '').trim();
    if (playlistRatingKey) return { playlistRatingKey };
    return null;
};

type Props = {
    label: string;
    title?: string;
    aspect?: '2/3' | 'square' | '16/9';
    /** Titles already on this rail — never reuse their posters on the shelf. */
    excludeRatingKeys?: string[];
    shelfSource?: ViewMoreShelfSource | null;
    onClick: () => void;
};

const shelfSlots = [
    { className: 'player-view-more-shelf-a' },
    { className: 'player-view-more-shelf-b' },
    { className: 'player-view-more-shelf-c' },
] as const;

const pickShelfImages = (
    items: PlayerItem[],
    exclude: Set<string>,
    aspect: '2/3' | 'square' | '16/9',
) => {
    const urls: string[] = [];
    const seenUrl = new Set<string>();
    for (const item of items) {
        const key = String(item.ratingKey || '').trim();
        if (key && exclude.has(key)) continue;
        const url = String(playerCardImageUrl(item.thumb, aspect) || '').trim();
        if (!url || seenUrl.has(url)) continue;
        seenUrl.add(url);
        urls.push(url);
        if (urls.length >= shelfSlots.length) break;
    }
    return urls;
};

const loadShelfItems = (source: ViewMoreShelfSource, title: string) => {
    if (source.watchlist) {
        return fetchMediaPlayerWatchlist().then((data) => data.items || []);
    }
    const path = String(source.path || '').trim();
    if (path) {
        return fetchMediaPlayerHub(path, {
            title,
            identifier: source.identifier || '',
        }).then((data) => data.items || []);
    }
    const collectionRatingKey = String(source.collectionRatingKey || '').trim();
    if (collectionRatingKey) {
        return fetchMediaPlayerCollection(collectionRatingKey).then((data) => data.children || []);
    }
    const playlistRatingKey = String(source.playlistRatingKey || '').trim();
    if (playlistRatingKey) {
        return fetchMediaPlayerPlaylist(playlistRatingKey).then((data) => data.children || []);
    }
    return Promise.resolve([] as PlayerItem[]);
};

export const PlayerViewMoreCard: React.FC<Props> = ({
    label,
    title,
    aspect = '2/3',
    excludeRatingKeys = [],
    shelfSource = null,
    onClick,
}) => {
    const ratio = aspect === '16/9' ? 'aspect-video' : aspect === 'square' ? 'aspect-square' : 'aspect-[2/3]';
    const [shelf, setShelf] = useState<string[]>([]);
    const excludeKey = excludeRatingKeys.join('|');
    const sourceKey = shelfSource
        ? [
            shelfSource.watchlist ? 'watchlist' : '',
            shelfSource.path || '',
            shelfSource.identifier || '',
            shelfSource.collectionRatingKey || '',
            shelfSource.playlistRatingKey || '',
        ].join('|')
        : '';

    useEffect(() => {
        if (!shelfSource || !sourceKey.replace(/\|/g, '')) {
            setShelf([]);
            return undefined;
        }
        let cancelled = false;
        const exclude = new Set(
            excludeKey.split('|').map((key) => String(key || '').trim()).filter(Boolean),
        );
        const source = shelfSource;
        loadShelfItems(source, title || '')
            .then((items) => {
                if (cancelled) return;
                setShelf(pickShelfImages(items, exclude, aspect));
            })
            .catch(() => {
                if (!cancelled) setShelf([]);
            });
        return () => { cancelled = true; };
    }, [aspect, excludeKey, shelfSource, sourceKey, title]);

    return (
        <button
            type="button"
            data-tv-item="1"
            data-tv-poster-btn="1"
            data-tv-key={`view-more:${title || label}`}
            onClick={onClick}
            className="relative w-full overflow-visible bg-transparent p-0 outline-none"
            aria-label={title ? `${label}: ${title}` : label}
        >
            <div
                data-tv-poster="1"
                className={`player-poster-frame player-view-more-card flex ${ratio} w-full flex-col items-center justify-center gap-3 rounded-[12px] text-center`}
            >
                {shelf.length ? (
                    <div className="player-view-more-shelf" aria-hidden>
                        {shelfSlots.map((slot, index) => {
                            const src = shelf[index] || shelf[shelf.length - 1];
                            if (!src) return null;
                            return (
                                <img
                                    key={`${slot.className}-${src}`}
                                    src={src}
                                    alt=""
                                    loading="lazy"
                                    decoding="async"
                                    draggable={false}
                                    className={`player-view-more-shelf-poster ${slot.className}`}
                                />
                            );
                        })}
                    </div>
                ) : null}
                <span className="player-view-more-icon" aria-hidden>
                    <ChevronRight className="h-7 w-7" strokeWidth={2.25} />
                </span>
                <span className="player-view-more-label px-3 text-sm font-bold leading-tight tracking-wide">
                    {label}
                </span>
                {title ? (
                    <span className="player-view-more-sub px-3 text-[11px] font-semibold leading-snug line-clamp-2">
                        {title}
                    </span>
                ) : null}
            </div>
        </button>
    );
};
