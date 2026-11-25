import React from 'react';
import { LogOut, X } from 'lucide-react';
import { useDiscoverI18n } from './host';

/** Window event: Back on Home with the sidebar open asks before leaving the app (TV). */
export const PLAYER_EXIT_PROMPT_EVENT = 'smp-tv-exit-prompt';

type Props = {
    onExit: () => void;
    onCancel: () => void;
};

/**
 * "Exit StreamPilot?" on Android TV / Fire TV. Cancel is first and takes the focus, so an extra Back or OK never
 * quits by accident; Back while it is open means Cancel (useTvRemote).
 */
export const PlayerExitDialog: React.FC<Props> = ({ onExit, onCancel }) => {
    const { t } = useDiscoverI18n();
    const actionBtn = 'flex w-full min-h-[3.25rem] items-center justify-center gap-2.5 rounded-2xl px-5 py-3.5 text-base font-bold outline-none transition-colors';
    return (
        <div
            className="fixed inset-0 z-[3500] flex items-center justify-center p-8"
            role="dialog"
            aria-modal="true"
            aria-labelledby="player-exit-title"
            data-tv-exit-dialog="1"
        >
            <div className="absolute inset-0 bg-black/65" aria-hidden />
            <div className="player-resume-dialog-enter player-popup-surface relative z-10 w-full max-w-md overflow-hidden rounded-3xl border border-white/10 shadow-[0_28px_90px_rgba(0,0,0,0.55)]">
                <div className="relative flex flex-col gap-6 p-8 text-center">
                    <div>
                        <h2 id="player-exit-title" className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
                            {t('mediaPlayerPage.exitTitle')}
                        </h2>
                        <p className="mt-3 text-lg text-white/70">{t('mediaPlayerPage.exitBody')}</p>
                    </div>
                    <div className="flex flex-col gap-2.5" data-tv-rail="1">
                        <button
                            type="button"
                            data-tv-item="1"
                            data-tv-action="1"
                            data-tv-exit-cancel="1"
                            onClick={onCancel}
                            className={`${actionBtn} border border-white/20 bg-[#484c54] text-white hover:border-white/30 hover:bg-[#52565e]`}
                        >
                            <X className="h-5 w-5 shrink-0 opacity-80" />
                            {t('mediaPlayerPage.exitCancel')}
                        </button>
                        <button
                            type="button"
                            data-tv-item="1"
                            data-tv-action="1"
                            data-tv-exit-confirm="1"
                            onClick={onExit}
                            className={`${actionBtn} bg-plex text-zinc-950 shadow-[0_8px_28px_rgba(245,158,11,0.35)] hover:bg-amber-400`}
                        >
                            <LogOut className="h-5 w-5 shrink-0" />
                            {t('mediaPlayerPage.exitConfirm')}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
