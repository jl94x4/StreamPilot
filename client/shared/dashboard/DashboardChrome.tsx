import React from 'react';

export type DashboardAccent = 'plex' | 'sky' | 'amber' | 'emerald' | 'violet' | 'rose';

const ACCENT: Record<DashboardAccent, {
    eyebrow: string;
    chip: string;
    heroGradient: string;
    blob: string;
}> = {
    plex: {
        eyebrow: 'text-plex/90',
        chip: 'border-plex/30 bg-plex/15',
        heroGradient: 'bg-gradient-to-br from-plex/15 via-background/40 to-amber-500/10',
        blob: 'bg-plex/10',
    },
    sky: {
        eyebrow: 'text-sky-300/90',
        chip: 'border-sky-400/30 bg-sky-500/15',
        heroGradient: 'bg-gradient-to-br from-sky-500/10 via-background/40 to-plex/10',
        blob: 'bg-sky-400/10',
    },
    amber: {
        eyebrow: 'text-amber-300/90',
        chip: 'border-amber-400/30 bg-amber-500/15',
        heroGradient: 'bg-gradient-to-br from-amber-500/10 via-background/40 to-plex/10',
        blob: 'bg-amber-400/10',
    },
    emerald: {
        eyebrow: 'text-emerald-300/90',
        chip: 'border-emerald-400/30 bg-emerald-500/15',
        heroGradient: 'bg-gradient-to-br from-emerald-500/10 via-background/40 to-plex/10',
        blob: 'bg-emerald-400/10',
    },
    violet: {
        eyebrow: 'text-violet-300/90',
        chip: 'border-violet-400/30 bg-violet-500/15',
        heroGradient: 'bg-gradient-to-br from-violet-500/10 via-background/40 to-plex/10',
        blob: 'bg-violet-400/10',
    },
    rose: {
        eyebrow: 'text-rose-300/90',
        chip: 'border-rose-400/30 bg-rose-500/15',
        heroGradient: 'bg-gradient-to-br from-rose-500/10 via-background/40 to-plex/10',
        blob: 'bg-rose-400/10',
    },
};

/** Shared gradient panel surface (matches DashboardPanel body). */
const HERO_CORNER_GLOW: Record<DashboardAccent, string> = {
    plex: 'bg-[radial-gradient(circle_at_100%_0%,rgb(var(--color-plex)_/_0.20),transparent_58%)]',
    sky: 'bg-[radial-gradient(circle_at_100%_0%,rgb(56_189_248_/_0.18),transparent_58%)]',
    amber: 'bg-[radial-gradient(circle_at_100%_0%,rgb(251_191_36_/_0.18),transparent_58%)]',
    emerald: 'bg-[radial-gradient(circle_at_100%_0%,rgb(52_211_153_/_0.18),transparent_58%)]',
    violet: 'bg-[radial-gradient(circle_at_100%_0%,rgb(167_139_250_/_0.18),transparent_58%)]',
    rose: 'bg-[radial-gradient(circle_at_100%_0%,rgb(251_113_133_/_0.18),transparent_58%)]',
};

/** Decorative card chrome. Keep overflow-hidden here for media/cards that clip. */
export const dashboardPanelClass =
    'relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.035] to-black/25 shadow-xl';

/** DashboardPanel host: no overflow-hidden — iOS zooms inputs inside clipped ancestors. */
const dashboardPanelHostClass =
    'relative rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.035] to-black/25 shadow-xl';

export const dashboardGlowClass = (accent: DashboardAccent | string) => {
    const map: Record<string, string> = {
        plex: 'bg-plex/20',
        sky: 'bg-sky-400/20',
        amber: 'bg-amber-400/20',
        emerald: 'bg-emerald-400/20',
        violet: 'bg-violet-400/20',
        rose: 'bg-rose-400/20',
        muted: 'bg-white/10',
    };
    return map[accent] || map.muted;
};

/** Corner glow for stat cards — radial gradients respect rounded corners (no blur clip artifacts). */
const statGlowGradient = (glow: string) => {
    const raw = String(glow || '').toLowerCase();
    const gradients: Record<string, string> = {
        plex: 'bg-[radial-gradient(circle_at_100%_0%,rgb(var(--color-plex)_/_0.28),transparent_72%)]',
        sky: 'bg-[radial-gradient(circle_at_100%_0%,rgb(56_189_248_/_0.26),transparent_72%)]',
        amber: 'bg-[radial-gradient(circle_at_100%_0%,rgb(251_191_36_/_0.26),transparent_72%)]',
        emerald: 'bg-[radial-gradient(circle_at_100%_0%,rgb(52_211_153_/_0.26),transparent_72%)]',
        violet: 'bg-[radial-gradient(circle_at_100%_0%,rgb(167_139_250_/_0.26),transparent_72%)]',
        rose: 'bg-[radial-gradient(circle_at_100%_0%,rgb(251_113_133_/_0.26),transparent_72%)]',
        muted: 'bg-[radial-gradient(circle_at_100%_0%,rgb(255_255_255_/_0.10),transparent_72%)]',
    };
    if (raw.includes('amber')) return gradients.amber;
    if (raw.includes('sky')) return gradients.sky;
    if (raw.includes('emerald')) return gradients.emerald;
    if (raw.includes('violet')) return gradients.violet;
    if (raw.includes('rose') || raw.includes('red')) return gradients.rose;
    if (raw.includes('plex')) return gradients.plex;
    return gradients.muted;
};

export const DashboardPageShell: React.FC<{ children: React.ReactNode; className?: string }> = ({
    children,
    className = '',
}) => (
    <div className={`flex w-full animate-fade-in flex-col gap-6 pb-10 ${className}`.trim()}>
        {children}
    </div>
);

export const DashboardHero: React.FC<{
    accent?: DashboardAccent;
    eyebrow: React.ReactNode;
    title: string;
    description?: React.ReactNode;
    icon?: React.ReactNode;
    actions?: React.ReactNode;
    secondaryBlob?: boolean;
}> = ({
    accent = 'plex',
    eyebrow,
    title,
    description,
    icon,
    actions,
    secondaryBlob = false,
}) => {
    const tone = ACCENT[accent];
    return (
        <div className={`relative overflow-hidden rounded-2xl border border-white/10 ${tone.heroGradient} p-5 md:p-6`}>
            <div className={`pointer-events-none absolute inset-0 rounded-[inherit] ${HERO_CORNER_GLOW[accent]}`} />
            {secondaryBlob ? (
                <div className="pointer-events-none absolute inset-0 rounded-[inherit] bg-[radial-gradient(circle_at_0%_100%,rgb(var(--color-plex)_/_0.10),transparent_55%)]" />
            ) : null}
            <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
                <div className="min-w-0">
                    <div className={`mb-3 inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] ${tone.eyebrow}`}>
                        {icon ? (
                            <span className={`inline-flex h-7 w-7 items-center justify-center rounded-lg border ${tone.chip}`}>
                                {icon}
                            </span>
                        ) : null}
                        {eyebrow}
                    </div>
                    <h1 className="text-3xl font-black tracking-tight text-text md:text-4xl">{title}</h1>
                    {description ? (
                        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted md:text-[15px]">
                            {description}
                        </p>
                    ) : null}
                </div>
                {actions ? (
                    <div className="flex flex-wrap items-center gap-2 self-start lg:self-auto">
                        {actions}
                    </div>
                ) : null}
            </div>
        </div>
    );
};

export const DashboardStatCard: React.FC<{
    label: string;
    value: React.ReactNode;
    hint?: React.ReactNode;
    icon: React.ReactNode;
    glow?: string;
    valueClassName?: string;
}> = ({ label, value, hint, icon, glow = 'bg-white/10', valueClassName = '' }) => (
    <div className="relative isolate overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.045] to-black/45 shadow-lg">
        <div className={`pointer-events-none absolute inset-0 rounded-[inherit] ${statGlowGradient(glow)}`} />
        <div className="relative px-4 py-4">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted">{label}</p>
                    <p className={`mt-1.5 text-2xl font-black tabular-nums tracking-tight text-text md:text-3xl ${valueClassName}`.trim()}>
                        {value}
                    </p>
                    {hint ? <p className="mt-1 text-[11px] text-muted">{hint}</p> : null}
                </div>
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-black/30">
                    {icon}
                </div>
            </div>
        </div>
    </div>
);

export const DashboardPanel: React.FC<{
    title: string;
    subtitle?: string;
    badge?: React.ReactNode;
    controls?: React.ReactNode;
    children: React.ReactNode;
    className?: string;
    /** When true, title row toggles body visibility. */
    collapsible?: boolean;
    /** Controlled collapse state (true = body hidden). */
    collapsed?: boolean;
    /** Uncontrolled initial collapse when `collapsed` is omitted. */
    defaultCollapsed?: boolean;
    onCollapsedChange?: (collapsed: boolean) => void;
    collapseLabel?: string;
    expandLabel?: string;
}> = ({
    title,
    subtitle,
    badge,
    controls,
    children,
    className = '',
    collapsible = false,
    collapsed: collapsedProp,
    defaultCollapsed = false,
    onCollapsedChange,
    collapseLabel = 'Collapse',
    expandLabel = 'Expand',
}) => {
    const [uncontrolledCollapsed, setUncontrolledCollapsed] = React.useState(defaultCollapsed);
    const collapsed = collapsedProp !== undefined ? collapsedProp : uncontrolledCollapsed;
    const setCollapsed = (next: boolean) => {
        if (collapsedProp === undefined) setUncontrolledCollapsed(next);
        onCollapsedChange?.(next);
    };
    const toggle = () => setCollapsed(!collapsed);

    return (
        <section className={`${dashboardPanelHostClass} p-4 md:p-5 ${className}`.trim()}>
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px overflow-hidden rounded-t-2xl bg-gradient-to-r from-transparent via-white/15 to-transparent" />
            <div className={`${collapsible && collapsed ? 'mb-0' : 'mb-4'} flex flex-wrap items-start justify-between gap-3`}>
                <div className="min-w-0 flex-1">
                    {collapsible ? (
                        <button
                            type="button"
                            className="group flex min-w-0 max-w-full items-start gap-2 text-left"
                            onClick={toggle}
                            aria-expanded={!collapsed}
                            aria-label={collapsed ? expandLabel : collapseLabel}
                        >
                            <span className="mt-1 inline-block w-3 shrink-0 text-muted" aria-hidden>
                                {collapsed ? '▸' : '▾'}
                            </span>
                            <span className="min-w-0">
                                <h2 className="text-lg font-bold tracking-tight text-text group-hover:text-plex">{title}</h2>
                                {subtitle && !collapsed ? <p className="mt-0.5 text-xs text-muted">{subtitle}</p> : null}
                            </span>
                        </button>
                    ) : (
                        <>
                            <h2 className="text-lg font-bold tracking-tight text-text">{title}</h2>
                            {subtitle ? <p className="mt-0.5 text-xs text-muted">{subtitle}</p> : null}
                        </>
                    )}
                </div>
                {(controls || badge) ? (
                    <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
                        {controls}
                        {badge}
                    </div>
                ) : null}
            </div>
            {collapsible && collapsed ? null : children}
        </section>
    );
};

export const readPersistedCollapsed = (storageKey: string, defaultCollapsed = false) => {
    try {
        const raw = localStorage.getItem(storageKey);
        if (raw === '1') return true;
        if (raw === '0') return false;
    } catch {
        // ignore
    }
    return defaultCollapsed;
};

export const preferCollapsedOnNarrow = (maxWidthPx = 1023) => {
    try {
        return window.matchMedia(`(max-width: ${maxWidthPx}px)`).matches;
    } catch {
        return false;
    }
};

export const usePersistedCollapsed = (storageKey: string, defaultCollapsed = false) => {
    const [collapsed, setCollapsed] = React.useState(() => readPersistedCollapsed(storageKey, defaultCollapsed));
    const onCollapsedChange = React.useCallback((next: boolean) => {
        setCollapsed(next);
        try {
            localStorage.setItem(storageKey, next ? '1' : '0');
        } catch {
            // ignore
        }
    }, [storageKey]);
    return [collapsed, onCollapsedChange] as const;
};

export const DashboardSubnav: React.FC<{ children: React.ReactNode; className?: string }> = ({
    children,
    className = '',
}) => (
    <nav className={`hidden md:flex gap-1 overflow-x-auto rounded-xl border border-white/10 bg-black/20 p-1 no-scrollbar ${className}`.trim()}>
        {children}
    </nav>
);

export const dashboardSubnavLinkClass = (isActive: boolean) => (
    isActive
        ? 'bg-plex text-background shadow-md shadow-plex/25'
        : 'text-muted hover:bg-white/5 hover:text-text'
);
