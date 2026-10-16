import React, { useMemo } from 'react';
import { Play, RotateCcw, X } from 'lucide-react';
import { useDiscoverI18n } from './host';
import {
    formatClock,
    formatEpisodeCode,
    formatPlayerDuration,
    playerCardImageUrl,
    progressPercent,
} from './playerUtils';
import type { PlayerItem } from './types';

type Props = {
    item: PlayerItem;
    offsetMs: number;
    tvShell?: boolean;
    onResume: () => void;
    onStartOver: () => void;
    onClose: () => void;
};

export const PlayerResumeDialog: React.FC<Props> = ({
    item,
    offsetMs,
    tvShell = false,
    onResume,
    onStartOver,
    onClose,
}) => {
    const { t } = useDiscoverI18n();
    const episodeCode = formatEpisodeCode(item);
    const durationMs = Number(item.durationMs || 0);
    const progress = useMemo(() => {
        if (durationMs > 0 && offsetMs > 0) {
            return Math.min(100, Math.max(2, (offsetMs / durationMs) * 100));
        }
        return progressPercent({ ...item, viewOffsetMs: offsetMs });
    }, [durationMs, item, offsetMs]);

    const aspect = item.type === 'episode' ? '16/9' as const : '2/3' as const;
    const thumbUrl = playerCardImageUrl(item.thumb, aspect);
    const timeLeftMs = durationMs > offsetMs ? durationMs - offsetMs : 0;

    const actionBtn = tvShell
        ? 'flex w-full min-h-[3.25rem] items-center justify-center gap-2.5 rounded-2xl px-5 py-3.5 text-base font-bold outline-none transition-colors'
        : 'inline-flex min-h-[2.75rem] items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold outline-none transition-colors';

    return (
        <div
            className="fixed inset-0 z-[3500] flex items-center justify-center p-5 sm:p-8"
            role="dialog"
            aria-modal="true"
            aria-labelledby="player-resume-title"
            data-tv-resume-dialog="1"
        >
            <div
                className="absolute inset-0 bg-black/65"
                aria-hidden
            />
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
                                {progress > 0 ? (
                                    <div className="player-watch-bar absolute inset-x-2 bottom-2 h-1 overflow-hidden rounded-full bg-black/55">
                                        <div
                                            className="h-full rounded-full bg-gradient-to-r from-amber-400/90 to-plex"
                                            style={{ width: `${progress}%` }}
                                        />
                                    </div>
                                ) : null}
                            </div>
                        ) : null}
                        <div className={`min-w-0 flex-1 ${thumbUrl ? 'text-center md:text-left' : 'text-center'}`}>
                            <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-plex">
                                {t('mediaPlayerPage.resumeTitle')}
                            </p>
                            <h2
                                id="player-resume-title"
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
                                {t('mediaPlayerPage.resumeFrom', { time: formatClock(offsetMs) })}
                                {durationMs > 0 && timeLeftMs > 0 ? (
                                    <span className="text-white/40">
                                        {' · '}
                                        {formatPlayerDuration(timeLeftMs)}
                                        {' '}
                                        {t('mediaPlayerPage.remaining')}
                                    </span>
                                ) : null}
                            </p>
                            {durationMs > 0 ? (
                                <div className="mt-5">
                                    <div className="player-watch-bar h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
                                        <div
                                            className="h-full rounded-full bg-gradient-to-r from-amber-400/85 via-plex to-plex"
                                            style={{ width: `${progress}%` }}
                                        />
                                    </div>
                                </div>
                            ) : null}
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
                            data-tv-resume-primary="1"
                            onClick={onResume}
                            className={`${actionBtn} bg-plex text-zinc-950 shadow-[0_8px_28px_rgba(245,158,11,0.35)] hover:bg-amber-400`}
                        >
                            <Play className="h-5 w-5 shrink-0 fill-current" />
                            {t('mediaPlayerPage.resume')}
                        </button>
                        <button
                            type="button"
                            data-tv-item="1"
                            data-tv-action="1"
                            onClick={onStartOver}
                            className={`${actionBtn} border border-white/20 bg-[#484c54] text-white hover:border-white/30 hover:bg-[#52565e]`}
                        >
                            <RotateCcw className="h-4 w-4 shrink-0 opacity-80" />
                            {t('mediaPlayerPage.startOver')}
                        </button>
                        <button
                            type="button"
                            data-tv-item="1"
                            data-tv-action="1"
                            onClick={onClose}
                            className={`${actionBtn} border border-transparent bg-transparent text-white/70 hover:border-white/15 hover:bg-[#484c54] hover:text-white`}
                        >
                            <X className="h-4 w-4 shrink-0 opacity-70" />
                            {t('common.close')}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
