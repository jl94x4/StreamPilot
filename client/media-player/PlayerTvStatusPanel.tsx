import React, { useEffect } from 'react';
import { useDiscoverI18n } from './host';

type Props = {
    title: string;
    message?: string;
    onRetry?: () => void;
    onBack?: () => void;
    /** Focus the primary action when the panel mounts (TV). */
    autoFocus?: boolean;
};

export const PlayerTvStatusPanel: React.FC<Props> = ({
    title,
    message,
    onRetry,
    onBack,
    autoFocus = true,
}) => {
    const { t } = useDiscoverI18n();

    useEffect(() => {
        if (!autoFocus) return undefined;
        const id = window.setTimeout(() => {
            if (document.documentElement?.dataset?.tvNavOpen === '1') return;
            const el = document.querySelector<HTMLElement>('[data-tv-status-primary="1"]');
            el?.focus({ preventScroll: true });
        }, 40);
        return () => window.clearTimeout(id);
    }, [autoFocus, title]);

    return (
        <div
            data-tv-row="1"
            className="flex min-h-[40vh] flex-col items-center justify-center gap-4 px-6 text-center"
        >
            <div className="max-w-lg space-y-2">
                <p className="text-xl font-bold text-text">{title}</p>
                {message ? <p className="text-sm text-muted">{message}</p> : null}
            </div>
            <div className="flex flex-wrap items-center justify-center gap-3">
                {onRetry ? (
                    <button
                        type="button"
                        data-tv-item="1"
                        data-tv-action="1"
                        data-tv-status-primary="1"
                        onClick={onRetry}
                        className="rounded-xl bg-plex px-5 py-2.5 text-sm font-bold text-zinc-950 outline-none ring-plex/40 focus-visible:ring-2"
                    >
                        {t('common.retry')}
                    </button>
                ) : null}
                {onBack ? (
                    <button
                        type="button"
                        data-tv-item="1"
                        data-tv-action="1"
                        data-tv-status-primary={onRetry ? undefined : '1'}
                        onClick={onBack}
                        className="player-page-back rounded-xl border border-white/15 bg-white/5 px-5 py-2.5 text-sm font-bold text-text outline-none ring-plex/40 focus-visible:ring-2"
                    >
                        {t('mediaPlayerPage.back')}
                    </button>
                ) : null}
            </div>
        </div>
    );
};
