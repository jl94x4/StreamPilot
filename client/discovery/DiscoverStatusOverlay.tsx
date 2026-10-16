import React from 'react';
import {
    AlertCircle,
    Ban,
    CheckCircle,
    Clock,
    Download,
    Layers,
    XCircle,
} from 'lucide-react';
import type { MediaAvailabilityState } from './discoverAvailability';
import { useDiscoverI18n, translateDiscoverAvailabilityDetail, translateDiscoverStatus } from './i18n';

const overlayAnchor = 'absolute top-1 right-1 sm:top-1.5 sm:right-1.5 z-10';
const iconBadgeClass = `${overlayAnchor} rounded-full p-0.5 sm:p-1 shadow-lg backdrop-blur-sm border flex items-center justify-center`;
const labeledBadgeClass = `${overlayAnchor} flex items-center justify-center sm:justify-start gap-0 sm:gap-1 p-0.5 sm:px-1.5 sm:py-0.5 rounded-full text-[7px] leading-none sm:text-[10px] font-black uppercase tracking-tight sm:tracking-wide shadow-lg backdrop-blur-sm border`;
const iconOnlySize = 'w-3 h-3 sm:w-3.5 sm:h-3.5';
const labeledIconSize = 'w-2.5 h-2.5 sm:w-3 sm:h-3';

/** Status chips on Request lists / season rows — compact on mobile posters and sheets. */
export const mediaStatusChipClass = 'text-[8px] sm:text-[10px] font-bold uppercase tracking-tight sm:tracking-wide px-1.5 py-px sm:px-2 sm:py-0.5 rounded-full border leading-none';

const OverlayLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <span className="hidden sm:inline truncate">{children}</span>
);

export const DiscoverStatusOverlay: React.FC<{ state: MediaAvailabilityState }> = ({ state }) => {
    const { t } = useDiscoverI18n();
    if (state.kind === 'none') return null;

    const title = state.detail
        ? translateDiscoverAvailabilityDetail(t, state.detail)
        : (translateDiscoverStatus(t, state.label) || state.label);

    if (state.kind === 'available') {
        return (
            <div className={`${iconBadgeClass} bg-green-500/90 text-white border-green-400/30`} title={title}>
                <CheckCircle className={iconOnlySize} />
            </div>
        );
    }

    if (state.kind === 'partial') {
        return (
            <div className={`${labeledBadgeClass} bg-emerald-500/90 text-white border-emerald-400/30`} title={title}>
                <Layers className={`${labeledIconSize} shrink-0`} />
                <OverlayLabel>{t('status.partial')}</OverlayLabel>
            </div>
        );
    }

    if (state.kind === 'processing') {
        return (
            <div className={`${iconBadgeClass} bg-blue-500/90 text-white border-blue-400/30`} title={title}>
                <Download className={iconOnlySize} />
            </div>
        );
    }

    if (state.kind === 'requested') {
        return (
            <div className={`${labeledBadgeClass} bg-indigo-500/90 text-white border-indigo-400/30`} title={title}>
                <Clock className={`${labeledIconSize} shrink-0`} />
                <OverlayLabel>{t('status.requested')}</OverlayLabel>
            </div>
        );
    }

    if (state.kind === 'pending') {
        return (
            <div className={`${iconBadgeClass} bg-amber-500/90 text-white border-amber-400/30`} title={title}>
                <Clock className={iconOnlySize} />
            </div>
        );
    }

    if (state.kind === 'failed') {
        return (
            <div className={`${labeledBadgeClass} bg-red-500/90 text-white border-red-400/30`} title={title}>
                <AlertCircle className={`${labeledIconSize} shrink-0`} />
                <OverlayLabel>{t('status.failed')}</OverlayLabel>
            </div>
        );
    }

    if (state.kind === 'declined') {
        return (
            <div className={`${iconBadgeClass} bg-red-500/80 text-white border-red-400/30`} title={title}>
                <XCircle className={iconOnlySize} />
            </div>
        );
    }

    if (state.kind === 'blacklisted') {
        return (
            <div className={`${iconBadgeClass} bg-zinc-700/95 text-white border-white/20`} title={title}>
                <Ban className={iconOnlySize} />
            </div>
        );
    }

    return null;
};

export const mediaStatusPanelClass = (kind: MediaAvailabilityState['kind']) => {
    if (kind === 'available') return 'border-green-500/25 bg-green-500/10 text-green-200';
    if (kind === 'partial') return 'border-emerald-500/25 bg-emerald-500/10 text-emerald-100';
    if (kind === 'processing') return 'border-blue-500/25 bg-blue-500/10 text-blue-100';
    if (kind === 'requested') return 'border-indigo-500/25 bg-indigo-500/10 text-indigo-100';
    if (kind === 'pending') return 'border-amber-500/25 bg-amber-500/10 text-amber-100';
    if (kind === 'failed' || kind === 'declined') return 'border-red-500/25 bg-red-500/10 text-red-100';
    if (kind === 'blacklisted') return 'border-white/15 bg-white/5 text-white/60';
    return 'border-white/10 bg-white/[0.03] text-white/70';
};

export const MediaStatusPanel: React.FC<{
    state: MediaAvailabilityState;
    onViewRequests?: () => void;
    onRetry?: () => void;
    libraryAction?: React.ReactNode;
    arrAction?: React.ReactNode;
}> = ({ state, onViewRequests, onRetry, libraryAction, arrAction }) => {
    const { t } = useDiscoverI18n();
    if (state.kind === 'none') return null;

    return (
        <div className={`rounded-xl border px-4 py-3 flex flex-col gap-3 ${mediaStatusPanelClass(state.kind)}`}>
            <div className="min-w-0">
                <p className="text-sm font-bold">{translateDiscoverStatus(t, state.label)}</p>
                {state.detail && (
                    <p className="text-xs opacity-80 mt-0.5 leading-relaxed">{translateDiscoverAvailabilityDetail(t, state.detail)}</p>
                )}
            </div>
            {(onRetry || onViewRequests || libraryAction || arrAction) && (
                <div className="flex flex-col gap-2 w-full">
                    {state.kind === 'failed' && onRetry && (
                        <button
                            type="button"
                            onClick={onRetry}
                            className="w-full px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-xs font-bold transition-colors text-center"
                        >
                            {t('media.retryRequest')}
                        </button>
                    )}
                    {state.hasUserRequest && onViewRequests && (
                        <button
                            type="button"
                            onClick={onViewRequests}
                            className="w-full px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-xs font-bold transition-colors text-center"
                        >
                            {t('media.viewInMyRequests')}
                        </button>
                    )}
                    {libraryAction}
                    {arrAction}
                </div>
            )}
        </div>
    );
};
