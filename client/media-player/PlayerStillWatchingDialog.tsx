import React from 'react';
import { Play, Square } from 'lucide-react';
import { useDiscoverI18n } from './host';
import { formatEpisodeCode, playerCardImageUrl } from './playerUtils';
import type { PlayerItem } from './types';

type Props = {
    item: PlayerItem;
    tvShell?: boolean;
    onContinue: () => void;
    onStop: () => void;
};

export const PlayerStillWatchingDialog: React.FC<Props> = ({
    item,
    tvShell = false,
    onContinue,
    onStop,
}) => {
    const { t } = useDiscoverI18n();
    const episodeCode = formatEpisodeCode(item);
    const aspect = item.type === 'episode' ? '16/9' as const : '2/3' as const;
    const thumbUrl = playerCardImageUrl(item.thumb, aspect);

    const actionBtn = tvShell
        ? 'flex w-full min-h-[3.25rem] items-center justify-center gap-2.5 rounded-2xl px-5 py-3.5 text-base font-bold outline-none transition-colors'
        : 'inline-flex min-h-[2.75rem] items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold outline-none transition-colors';

    return (
        <div
            className="fixed inset-0 z-[3500] flex items-center justify-center p-5 sm:p-8"
            role="dialog"
            aria-modal="true"
            aria-labelledby="player-still-watching-title"
            data-tv-still-watching-dialog="1"
        >
            <div className="absolute inset-0 bg-black/65" aria-hidden />
            <div
                className={`player-resume-dialog-enter player-popup-surface relative z-10 w-full overflow-hidden rounded-3xl border border-white/10 shadow-[0_28px_90px_rgba(0,0,0,0.55)] ${
                    tvShell ? 'max-w-2xl' : 'max-w-lg'
                }`}
            >
                <div className={`relative flex flex-col gap-6 ${tvShell ? 'p-8' : 'p-6'}`}>
                    <div className={`flex flex-col gap-6 ${thumbUrl ? 'md:flex-row md:items-center' : ''}`}>
                        {thumbUrl ? (
                            <div className={`relative shrink-0 ${tvShell ? 'mx-auto w-52' : 'mx-auto w-36 md:mx-0 md:w-40'}`}>
                                <div className="overflow-hidden rounded-2xl shadow-[0_12px_40px_rgba(0,0,0,0.55)] ring-1 ring-white/15">
                                    <img
                                        src={thumbUrl}
                                        alt=""
                                        className={`block w-full object-cover ${aspect === '16/9' ? 'aspect-video' : 'aspect-[2/3]'}`}
                                    />
                                </div>
                            </div>
                        ) : null}
                        <div className={`min-w-0 flex-1 ${thumbUrl ? 'text-center md:text-left' : 'text-center'}`}>
                            <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-plex">
                                {t('mediaPlayerPage.stillWatchingTitle')}
                            </p>
                            <h2
                                id="player-still-watching-title"
                                className={`mt-2 font-bold tracking-tight text-white ${tvShell ? 'text-2xl sm:text-3xl' : 'text-xl'}`}
                            >
                                {item.title}
                            </h2>
                            {episodeCode ? (
                                <p className={`mt-1 font-medium text-white/45 ${tvShell ? 'text-base' : 'text-sm'}`}>
                                    {episodeCode}
                                </p>
                            ) : null}
                            <p className={`mt-4 text-white/75 ${tvShell ? 'text-lg' : 'text-sm'}`}>
                                {t('mediaPlayerPage.stillWatchingBody', { title: item.showTitle || item.title })}
                            </p>
                        </div>
                    </div>
                    <div
                        className={`flex gap-2.5 ${tvShell ? 'flex-col' : 'flex-wrap justify-center md:justify-start'}`}
                        data-tv-rail="1"
                    >
                        <button
                            type="button"
                            data-tv-item="1"
                            data-tv-action="1"
                            data-tv-still-watching-primary="1"
                            onClick={onContinue}
                            className={`${actionBtn} bg-plex text-zinc-950 shadow-[0_8px_28px_rgba(245,158,11,0.35)] hover:bg-amber-400`}
                        >
                            <Play className="h-5 w-5 shrink-0 fill-current" />
                            {t('mediaPlayerPage.stillWatchingContinue')}
                        </button>
                        <button
                            type="button"
                            data-tv-item="1"
                            data-tv-action="1"
                            onClick={onStop}
                            className={`${actionBtn} border border-white/20 bg-[#484c54] text-white hover:border-white/30 hover:bg-[#52565e]`}
                        >
                            <Square className="h-4 w-4 shrink-0 opacity-80" />
                            {t('mediaPlayerPage.stillWatchingStop')}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
