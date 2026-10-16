import React from 'react';
import { CheckCircle2 } from 'lucide-react';
import { normalizeProviderKey, providerLabel, statusTone } from './posterSetsFormat';
import { isTitleCardSet } from './posterSetsRecent';

/** MediUX blue / ThePosterDB orange source pills. */
const providerPillClass = (provider?: string | null) => {
    const key = normalizeProviderKey(provider);
    if (key === 'mediux') return 'border-sky-400/40 bg-sky-500/20 text-sky-200';
    if (key === 'posterdb') return 'border-orange-400/40 bg-orange-500/20 text-orange-200';
    return 'border-white/10 bg-white/5 text-muted';
};

export const MetaPill: React.FC<{
    children: React.ReactNode;
    className?: string;
    title?: string;
    truncate?: boolean;
    compact?: boolean;
}> = ({
    children,
    className = '',
    title,
    truncate = true,
    compact = false,
}) => (
    <span
        title={title}
        className={`inline-flex items-center rounded-full border font-bold tracking-wide ${
            compact
                ? 'px-1.5 py-px text-[8px] sm:text-[9px]'
                : 'px-1.5 py-0.5 text-[9px] sm:px-2.5 sm:py-1 sm:text-[11px]'
        } ${
            truncate ? 'max-w-full shrink truncate' : 'max-w-full shrink-0 whitespace-normal break-all'
        } ${className}`}
    >
        {children}
    </span>
);

export const ProviderPill: React.FC<{ provider?: string | null; compact?: boolean }> = ({ provider, compact }) => {
    const key = normalizeProviderKey(provider);
    if (!key) return null;
    return (
        <MetaPill
            compact={compact}
            className={`uppercase !max-w-none !shrink-0 ${providerPillClass(provider)}`}
            title={providerLabel(provider)}
        >
            {key === 'posterdb' ? 'TPDB' : 'MediUX'}
        </MetaPill>
    );
};

/** Corner overlay for poster thumbs — MediUX blue / TPDB orange. */
export const ProviderCornerBadge: React.FC<{ provider?: string | null; className?: string }> = ({
    provider,
    className = '',
}) => {
    const key = normalizeProviderKey(provider);
    if (!key) return null;
    return (
        <span
            title={providerLabel(provider)}
            className={`pointer-events-none absolute right-1.5 top-1.5 z-10 rounded-full border px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide shadow-md backdrop-blur-sm sm:text-[9px] ${providerPillClass(provider)} ${className}`}
        >
            {key === 'posterdb' ? 'TPDB' : 'MediUX'}
        </span>
    );
};

export const CreatorPill: React.FC<{
    user?: string | null;
    onOpen?: (user: string) => void;
    compact?: boolean;
}> = ({ user, onOpen, compact }) => {
    const handle = String(user || '').trim().replace(/^@+/, '');
    if (!handle) return null;
    const label = `@${handle}`;
    if (!onOpen) {
        return (
            <MetaPill
                compact={compact}
                truncate={false}
                className="border-white/15 bg-white/10 text-text/90 normal-case"
                title={label}
            >
                {label}
            </MetaPill>
        );
    }
    return (
        <button
            type="button"
            title={`View all posters by ${label}`}
            onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onOpen(handle);
            }}
            className={`inline-flex max-w-full shrink-0 items-center whitespace-normal break-all rounded-full border border-white/15 bg-white/10 font-bold tracking-wide text-text/90 normal-case transition hover:border-plex/50 hover:bg-plex/15 hover:text-plex ${
                compact
                    ? 'px-1.5 py-px text-[8px] sm:text-[9px]'
                    : 'px-1.5 py-0.5 text-[9px] sm:px-2.5 sm:py-1 sm:text-[11px]'
            }`}
        >
            {label}
        </button>
    );
};

export const SetKindPill: React.FC<{
    set?: { title?: string | null; setKind?: string | null } | null;
    compact?: boolean;
}> = ({ set, compact }) => {
    const kind = String(set?.setKind || '').trim().toLowerCase();
    if (kind === 'boxset') {
        return (
            <MetaPill compact={compact} className="border-emerald-400/35 bg-emerald-500/15 text-emerald-100" title="Full boxset">
                Boxset
            </MetaPill>
        );
    }
    if (kind === 'collection' || kind === 'collections') {
        return (
            <MetaPill compact={compact} className="border-amber-400/35 bg-amber-500/15 text-amber-100" title="Collection set">
                Collection
            </MetaPill>
        );
    }
    if (isTitleCardSet(set)) {
        return (
            <MetaPill compact={compact} className="border-violet-400/35 bg-violet-500/15 text-violet-100" title="Title card pack">
                Title cards
            </MetaPill>
        );
    }
    return null;
};

export const StatusPill: React.FC<{ value?: string | null; className?: string }> = ({ value, className = '' }) => {
    const label = value || 'unknown';
    const done = ['succeeded', 'completed', 'success', 'ready', 'connected', 'valid'].includes(String(label).toLowerCase());
    return (
        <span className={`inline-flex max-w-full items-center gap-1 truncate rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide sm:px-2.5 sm:py-1 sm:text-[11px] ${statusTone(value)} ${className}`}>
            {done ? <CheckCircle2 className="h-3 w-3 shrink-0" /> : null}
            <span className="truncate">{label}</span>
        </span>
    );
};
