import React, { useEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { TvButton } from '../shared/TvButton';
import {
    fetchMediaPlayerCollection,
    fetchMediaPlayerHub,
    fetchMediaPlayerPlaylist,
    fetchMediaPlayerWatchlist,
} from './api';
import { useDiscoverI18n } from './host';
import { playerCardImageUrl, plexImageUrl } from './playerUtils';
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

/** Up to four posters: the mosaic uses all four, the stack three; the CSS picks per style. */
const shelfSlots = ['a', 'b', 'c', 'd'] as const;

/** Server lists are capped (80 / 500); a full page means there may be more. */
const LIST_CAPS = [80, 500];

type Shelf = { posters: string[]; backdrop: string; remaining: number; capped: boolean };
const EMPTY_SHELF: Shelf = { posters: [], backdrop: '', remaining: 0, capped: false };

const pickShelf = (
    items: PlayerItem[],
    exclude: Set<string>,
    aspect: '2/3' | 'square' | '16/9',
): Shelf => {
    const posters: string[] = [];
    const seenUrl = new Set<string>();
    let backdrop = '';
    let remaining = 0;
    for (const item of items) {
        const key = String(item.ratingKey || '').trim();
        if (key && exclude.has(key)) continue;
        remaining += 1;
        if (posters.length >= shelfSlots.length) continue;
        const url = String(playerCardImageUrl(item.thumb, aspect) || '').trim();
        if (!url || seenUrl.has(url)) continue;
        seenUrl.add(url);
        posters.push(url);
        // A tiny copy for the blurred backdrop: blurring it is cheap and it looks the same.
        if (!backdrop) backdrop = String(plexImageUrl(item.thumb, 60, 90, { quality: 60 }) || url);
    }
    return { posters, backdrop, remaining, capped: LIST_CAPS.includes(items.length) };
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
    const { t } = useDiscoverI18n();
    const [shelf, setShelf] = useState<Shelf>(EMPTY_SHELF);
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
            setShelf(EMPTY_SHELF);
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
                setShelf(pickShelf(items, exclude, aspect));
            })
            .catch(() => {
                if (!cancelled) setShelf(EMPTY_SHELF);
            });
        return () => { cancelled = true; };
    }, [aspect, excludeKey, shelfSource, sourceKey, title]);

    return (
        <TvButton
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
                className={`player-poster-frame player-view-more-card ${ratio} w-full rounded-[12px] text-center`}
            >
                {shelf.backdrop ? (
                    <img
                        key={shelf.backdrop}
                        src={shelf.backdrop}
                        alt=""
                        aria-hidden
                        loading="lazy"
                        decoding="async"
                        draggable={false}
                        className="player-view-more-bg"
                    />
                ) : null}
                {shelf.posters.length ? (
                    <div className="player-view-more-shelf" aria-hidden>
                        {shelfSlots.map((slot, index) => {
                            const src = shelf.posters[index] || shelf.posters[index % shelf.posters.length];
                            return (
                                <img
                                    key={`${slot}-${src}`}
                                    src={src}
                                    alt=""
                                    loading="lazy"
                                    decoding="async"
                                    draggable={false}
                                    className={`player-view-more-shelf-poster player-view-more-shelf-${slot}`}
                                />
                            );
                        })}
                    </div>
                ) : null}
                <span className="player-view-more-shade" aria-hidden />
                <span className="player-view-more-body">
                    <span className="player-view-more-icon" aria-hidden>
                        <ChevronRight className="h-7 w-7" strokeWidth={2.25} />
                    </span>
                    <span className="player-view-more-label px-3 text-sm font-bold leading-tight tracking-wide">
                        {label}
                    </span>
                    {shelf.remaining > 0 ? (
                        <span className="player-view-more-sub px-3 text-[11px] font-semibold leading-snug">
                            {t('common.viewMoreCount', { count: `${shelf.remaining}${shelf.capped ? '+' : ''}` })}
                        </span>
                    ) : title ? (
                        <span className="player-view-more-sub px-3 text-[11px] font-semibold leading-snug line-clamp-2">
                            {title}
                        </span>
                    ) : null}
                </span>
            </div>
        </TvButton>
    );
};
