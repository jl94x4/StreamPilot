import React from 'react';
import { DiscoverSectionHeader, DiscoveryLogo, RowHeaderMark, SkeletonBlock } from './host';
import { plexImageUrl } from './playerUtils';
import type { PlayerStudioBrowseCard } from './types';

/** Plex Categories-style washes, cycled across the grid. */
const TILE_TINTS = [
    '#1d7f99',
    '#b07d1c',
    '#2b8a3e',
    '#6f6a12',
    '#963a96',
    '#7a3f99',
    '#7c2f6e',
    '#2c4f86',
    '#b4521c',
];

type Props = {
    title: string;
    cards: PlayerStudioBrowseCard[];
    keyPrefix: string;
    onOpen: (card: PlayerStudioBrowseCard) => void;
};

/**
 * TV Library → Studios: a wrapping grid of wide tiles — a title's backdrop washed in colour with
 * the studio or network logo on top (its name when there is no logo).
 */
export const PlayerStudioTiles: React.FC<Props> = ({ title, cards, keyPrefix, onOpen }) => {
    if (!cards.length) return null;
    return (
        <section className="flex min-w-0 max-w-full flex-col gap-4" data-tv-row="1" data-tv-row-id={`lib:${keyPrefix}`}>
            <DiscoverSectionHeader title={title} />
            <div
                className="player-studio-tiles grid grid-cols-4 gap-6"
                data-tv-rail="1"
                data-tv-poster-rail="1"
                data-tv-poster-grid="1"
            >
                {cards.map((card, index) => {
                    const art = card.art || card.thumb;
                    const artUrl = art ? plexImageUrl(art, 640, 360, { quality: 70 }) : '';
                    // The card wrapper is what the remote scrolls into view (not the whole grid).
                    return (
                        <div key={`${keyPrefix}-${card.key}-${card.title}`} data-tv-poster-card="1" className="min-w-0">
                        <button
                            type="button"
                            data-tv-item="1"
                            data-tv-poster-btn="1"
                            data-tv-key={`${keyPrefix}-${card.key}`}
                            aria-label={card.title}
                            onClick={() => onOpen(card)}
                            className="relative w-full overflow-visible bg-transparent p-0 outline-none"
                        >
                            <div
                                data-tv-poster="1"
                                className="player-poster-frame player-studio-tile aspect-video w-full"
                                style={{ ['--tile-tint' as string]: TILE_TINTS[index % TILE_TINTS.length] }}
                            >
                                {artUrl ? (
                                    <img
                                        src={artUrl}
                                        alt=""
                                        loading={index < 9 ? 'eager' : 'lazy'}
                                        decoding="async"
                                        draggable={false}
                                        className="player-studio-tile-art"
                                    />
                                ) : null}
                                <span className="player-studio-tile-wash" aria-hidden />
                                <span className="player-studio-tile-mark">
                                    {card.logoPath ? (
                                        <DiscoveryLogo
                                            logoPath={card.logoPath}
                                            alt={card.title}
                                            width={780}
                                            loading={index < 9 ? 'eager' : 'lazy'}
                                            className="player-studio-tile-logo"
                                        />
                                    ) : (
                                        <span className="player-studio-tile-name">{card.title}</span>
                                    )}
                                </span>
                            </div>
                        </button>
                        </div>
                    );
                })}
            </div>
        </section>
    );
};

/** Studios while loading: a networks row and two studio rows of tile-shaped placeholders. */
export const PlayerStudioTilesSkeleton: React.FC = () => (
    <div className="player-library-studios flex flex-col gap-12 pb-10" aria-busy="true" aria-hidden="true">
        {[4, 8].map((count, section) => (
            <div key={section} className="flex min-w-0 max-w-full flex-col gap-4">
                <div className="player-row-header flex min-w-0 items-center gap-3">
                    <RowHeaderMark />
                    <SkeletonBlock className="h-6 w-52 max-w-[55%] rounded" />
                </div>
                <div className="player-studio-tiles grid grid-cols-4 gap-6">
                    {Array.from({ length: count }, (_, i) => (
                        <SkeletonBlock
                            key={i}
                            className="aspect-video w-full rounded-xl border border-white/5"
                            style={{ animationDelay: `${Math.min(i, 8) * 70}ms` }}
                        />
                    ))}
                </div>
            </div>
        ))}
    </div>
);
