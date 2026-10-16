import React from 'react';
import { useDiscoverI18n } from './host';
import { formatPlayerDuration } from './playerUtils';
import type { PlayerItem } from './types';

type Props = {
    tracks: PlayerItem[];
    activeKey?: string | null;
    onPlayTrack: (item: PlayerItem) => void;
};

export const MediaPlayerMusicTracks: React.FC<Props> = ({ tracks, activeKey, onPlayTrack }) => {
    const { t } = useDiscoverI18n();
    if (!tracks.length) return null;
    return (
        <section className="player-music-tracks mt-6" data-tv-row="1" data-tv-row-id="music-tracks">
            <h3 className="mb-3 text-xs font-black uppercase tracking-[0.2em] text-muted">
                {t('mediaPlayerPage.tracks')}
            </h3>
            <div className="player-music-track-list flex flex-col" data-tv-list="1">
                {tracks.map((row, index) => {
                    const active = String(row.ratingKey) === String(activeKey || '');
                    const number = row.index || index + 1;
                    return (
                        <button
                            key={row.ratingKey || `${row.title}-${index}`}
                            type="button"
                            data-tv-item="1"
                            data-tv-key={row.ratingKey}
                            data-tv-music-track="1"
                            onClick={() => onPlayTrack(row)}
                            className={`player-music-track flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left outline-none ${
                                index > 0 ? 'border-t border-white/12' : ''
                            } ${
                                active ? 'bg-white/10 text-white' : 'text-white/90 hover:bg-white/[0.06]'
                            }`}
                        >
                            <span className="w-8 shrink-0 text-right text-sm font-bold tabular-nums text-white/45">
                                {number}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-[0.98rem] font-semibold">
                                {row.title}
                            </span>
                            <span className="shrink-0 text-sm font-semibold tabular-nums text-white/45">
                                {formatPlayerDuration(row.durationMs) || ''}
                            </span>
                        </button>
                    );
                })}
            </div>
        </section>
    );
};
