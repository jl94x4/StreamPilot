import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useDiscoverI18n } from './host';

type Props = {
    episodeCount?: number;
    busy?: boolean;
    tvShell?: boolean;
    onConfirm: () => void;
    onClose: () => void;
};

export const PlayerSeasonWatchDialog: React.FC<Props> = ({
    episodeCount = 0,
    busy = false,
    tvShell = false,
    onConfirm,
    onClose,
}) => {
    const { t } = useDiscoverI18n();
    const confirmRef = useRef<HTMLButtonElement | null>(null);

    useEffect(() => {
        const id = window.setTimeout(() => confirmRef.current?.focus(), 30);
        return () => window.clearTimeout(id);
    }, []);

    useEffect(() => {
        const onOverlayClose = () => onClose();
        window.addEventListener('smp-tv-overlay-close', onOverlayClose);
        return () => window.removeEventListener('smp-tv-overlay-close', onOverlayClose);
    }, [onClose]);

    const body = episodeCount > 0
        ? t('mediaPlayerPage.markSeasonWatchedBodyCount', { count: episodeCount })
        : t('mediaPlayerPage.markSeasonWatchedBody');

    const actionBtn = tvShell
        ? 'inline-flex min-h-[3.25rem] min-w-[8rem] items-center justify-center rounded-2xl px-5 py-3.5 text-base font-bold outline-none'
        : 'inline-flex min-h-[2.75rem] items-center justify-center rounded-xl px-5 py-2.5 text-sm font-bold outline-none';

    return createPortal(
        <div
            className="fixed inset-0 z-[3600] flex items-center justify-center p-5 sm:p-8"
            role="dialog"
            aria-modal="true"
            aria-labelledby="player-season-watch-title"
            data-tv-season-watch-dialog="1"
        >
            <button
                type="button"
                className="absolute inset-0 bg-black/65"
                aria-label={t('mediaPlayerPage.cancel')}
                tabIndex={-1}
                onClick={onClose}
            />
            <div className={`player-resume-dialog-enter player-popup-surface relative z-10 w-full rounded-3xl border border-white/10 shadow-[0_28px_90px_rgba(0,0,0,0.55)] ${tvShell ? 'max-w-xl p-8' : 'max-w-md p-6'}`}>
                <h2 id="player-season-watch-title" className={`font-black text-white ${tvShell ? 'text-2xl' : 'text-lg'}`}>
                    {t('mediaPlayerPage.markSeasonWatchedTitle')}
                </h2>
                <p className={`mt-3 text-white/85 ${tvShell ? 'text-lg' : 'text-sm'}`}>{body}</p>
                <div className="mt-6 flex flex-wrap justify-end gap-3">
                    <button
                        type="button"
                        data-tv-item="1"
                        data-tv-action="1"
                        data-tv-season-watch-cancel="1"
                        className={`${actionBtn} border border-white/15 bg-white/10 text-white`}
                        onClick={onClose}
                        disabled={busy}
                    >
                        {t('mediaPlayerPage.cancel')}
                    </button>
                    <button
                        ref={confirmRef}
                        type="button"
                        data-tv-item="1"
                        data-tv-action="1"
                        data-tv-season-watch-confirm="1"
                        className={`${actionBtn} bg-plex text-white disabled:opacity-60`}
                        onClick={onConfirm}
                        disabled={busy}
                    >
                        {t('mediaPlayerPage.markWatched')}
                    </button>
                </div>
            </div>
        </div>,
        document.body,
    );
};
