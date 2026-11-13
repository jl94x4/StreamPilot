import React from 'react';
import { Loader2, RefreshCw, WifiOff } from 'lucide-react';
import { useDiscoverI18n } from './host';

type Props = {
    /** Names of the servers that did not answer; empty when the connection itself is down. */
    names: string[];
    checking: boolean;
    tv: boolean;
    onRetry: () => void;
};

/**
 * Shown while a server is unreachable: which one, that the saved Home is on screen meanwhile, and
 * (touch only) a Retry. TV has no Retry stop: the check already repeats every 30 seconds, and an
 * extra focusable at the top would steal the first-card focus.
 */
export const PlayerOfflineBanner: React.FC<Props> = ({ names, checking, tv, onRetry }) => {
    const { t } = useDiscoverI18n();
    const title = names.length
        ? t('mediaPlayerPage.offlineServers', { servers: names.join(', ') })
        : t('mediaPlayerPage.offlineNoConnection');
    return (
        <div
            role="status"
            aria-live="polite"
            className="pointer-events-none absolute inset-x-0 top-3 z-[44] flex justify-center px-4"
        >
            <div className="pointer-events-auto inline-flex max-w-full items-center gap-3 rounded-full border border-amber-300/25 bg-[#0b1018]/90 py-2 pl-4 pr-2 text-white shadow-[0_10px_30px_rgba(0,0,0,0.45)] backdrop-blur-xl">
                <WifiOff className="h-5 w-5 shrink-0 text-amber-300" aria-hidden />
                <span className="min-w-0 leading-tight">
                    <span className="block truncate text-sm font-bold sm:text-base">{title}</span>
                    <span className="block truncate text-xs text-white/55 sm:text-sm">
                        {t('mediaPlayerPage.offlineSaved')}
                    </span>
                </span>
                {tv ? (
                    <span className="mr-2 inline-flex items-center gap-1.5 text-xs font-semibold text-white/60 sm:text-sm">
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                        {t('mediaPlayerPage.offlineRetrying')}
                    </span>
                ) : (
                    <button
                        type="button"
                        onClick={onRetry}
                        disabled={checking}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white/10 px-3.5 py-1.5 text-sm font-bold text-white transition-colors hover:bg-white/20 disabled:opacity-60"
                    >
                        <RefreshCw className={`h-4 w-4 ${checking ? 'animate-spin' : ''}`} aria-hidden />
                        {t('mediaPlayerPage.offlineRetry')}
                    </button>
                )}
            </div>
        </div>
    );
};
