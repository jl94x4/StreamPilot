import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
    Activity,
    BarChart3,
    CheckCircle2,
    Clapperboard,
    Clock,
    Cpu,
    Film,
    Layers,
    Radar,
    RefreshCw,
    Server,
    Sparkles,
    TrendingUp,
    Tv,
    X,
} from 'lucide-react';
import { apiFetch } from './api';
import { portalUrl } from './basePath';
import { resolveTmdbImageUrl } from '../discovery/tmdbImageUrl';
import {
    dashboardPanelClass,
    DashboardStatCard,
} from './dashboard/DashboardChrome';
import { lockBackgroundScroll } from './lockBackgroundScroll';
import { formatStoredSummaryPeriodLabel } from '../../lib/notifications/summaryPeriodLabel.js';

export type SummaryDigest = {
    id: string;
    createdAt?: string;
    frequency?: string;
    periodLabel?: string;
    periodStart?: string;
    periodEnd?: string;
    metrics?: {
        uptime?: {
            aggregatePct?: number | null;
            plex?: { label?: string; uptimePct?: number | null } | null;
            sonarr?: { label?: string; uptimePct?: number | null } | null;
            radarr?: { label?: string; uptimePct?: number | null } | null;
            services?: Array<{ id?: string; label?: string; uptimePct?: number | null }>;
        };
        requests?: {
            made?: number;
            approved?: number;
            declined?: number;
            available?: number;
        };
        scannerImports?: number;
        collexionsRotations?: number;
        mediaAutomationJobs?: number;
    };
    highlights?: Array<{
        kind?: string;
        title?: string;
        subtitle?: string;
        at?: string;
        posterPath?: string | null;
        backdropPath?: string | null;
        mediaType?: string | null;
    }>;
};

const formatPct = (value?: number | null) => (
    value == null || !Number.isFinite(value) ? '—' : `${value.toFixed(2)}%`
);

const formatWhen = (iso?: string) => {
    if (!iso) return '';
    try {
        return new Date(iso).toLocaleString();
    } catch {
        return iso;
    }
};

const uptimeTone = (value?: number | null) => {
    if (value == null || !Number.isFinite(value)) return 'muted';
    if (value >= 99.9) return 'emerald';
    if (value >= 95) return 'amber';
    return 'rose';
};

const uptimeTextClass = (tone: string) => {
    if (tone === 'emerald') return 'text-emerald-300';
    if (tone === 'amber') return 'text-amber-300';
    if (tone === 'rose') return 'text-rose-300';
    return 'text-muted';
};

const uptimeBarClass = (tone: string) => {
    if (tone === 'emerald') return 'bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.45)]';
    if (tone === 'amber') return 'bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.4)]';
    if (tone === 'rose') return 'bg-rose-400 shadow-[0_0_10px_rgba(251,113,133,0.4)]';
    return 'bg-white/25';
};

const UptimeRow: React.FC<{ label: string; value?: number | null }> = ({ label, value }) => {
    const tone = uptimeTone(value);
    const pct = value == null || !Number.isFinite(value) ? 0 : Math.min(100, Math.max(0, value));
    return (
        <div className="space-y-2 py-2.5 border-b border-white/[0.06] last:border-b-0">
            <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-semibold text-text/90">{label}</span>
                <span className={`text-sm font-black tabular-nums ${uptimeTextClass(tone)}`}>
                    {formatPct(value)}
                </span>
            </div>
            <div className="h-1.5 rounded-full bg-black/50 border border-white/[0.06] overflow-hidden">
                <div
                    className={`h-full rounded-full transition-all duration-700 ${uptimeBarClass(tone)}`}
                    style={{ width: `${pct}%` }}
                />
            </div>
        </div>
    );
};

const AutomationStat: React.FC<{
    icon: React.ReactNode;
    label: string;
    value: number;
    accent?: string;
}> = ({ icon, label, value, accent = 'from-white/[0.06] to-black/30' }) => (
    <div className={`relative overflow-hidden rounded-xl border border-white/10 bg-gradient-to-br ${accent} px-4 py-3.5`}>
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_100%_0%,rgba(255,255,255,0.08),transparent_65%)]" />
        <div className="relative flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-black/35 text-plex">
                    {icon}
                </div>
                <span className="text-sm font-medium text-muted truncate">{label}</span>
            </div>
            <span className="text-xl font-black tabular-nums tracking-tight text-text">{value}</span>
        </div>
    </div>
);

const formatHighlightSubtitle = (subtitle?: string) => {
    const raw = String(subtitle || '').trim();
    if (!raw) return '';
    const labels: Record<string, string> = {
        approved: 'Approved',
        pending: 'Pending',
        processing: 'Processing',
        declined: 'Declined',
        available: 'Available',
        completed: 'Completed',
        failed: 'Failed',
    };
    return labels[raw.toLowerCase()] || raw.charAt(0).toUpperCase() + raw.slice(1);
};

const HighlightCard: React.FC<{
    title: string;
    subtitle?: string;
    posterPath?: string | null;
    backdropPath?: string | null;
    mediaType?: string | null;
    index: number;
}> = ({ title, subtitle, posterPath, backdropPath, mediaType, index }) => {
    const posterUrl = resolveTmdbImageUrl(posterPath, 'w185');
    const backdropUrl = resolveTmdbImageUrl(backdropPath || posterPath, 'w780');
    const isTv = String(mediaType || '').toLowerCase() === 'tv';
    const FallbackIcon = isTv ? Tv : Film;

    return (
        <div className="group relative overflow-hidden rounded-xl border border-white/10 bg-gradient-to-br from-white/[0.05] to-black/50 min-h-[5.5rem] transition-all hover:border-plex/30 hover:shadow-[0_8px_32px_rgba(0,0,0,0.35)]">
            {backdropUrl ? (
                <>
                    <img
                        src={backdropUrl}
                        alt=""
                        className="absolute inset-0 h-full w-full object-cover opacity-35 scale-105 transition-transform duration-500 group-hover:scale-110"
                        loading="lazy"
                    />
                    <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/92 via-black/78 to-black/55" />
                    <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
                </>
            ) : (
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_0%_0%,rgb(var(--color-plex)_/_0.12),transparent_55%)] opacity-0 transition-opacity group-hover:opacity-100" />
            )}
            <div className="relative flex items-center gap-3 p-3">
                {posterUrl ? (
                    <img
                        src={posterUrl}
                        alt=""
                        className="h-[4.25rem] w-[2.85rem] shrink-0 rounded-lg border border-white/15 object-cover shadow-[0_8px_24px_rgba(0,0,0,0.45)]"
                        loading="lazy"
                    />
                ) : (
                    <div className="flex h-[4.25rem] w-[2.85rem] shrink-0 items-center justify-center rounded-lg border border-plex/25 bg-plex/10 text-plex shadow-[0_8px_24px_rgba(0,0,0,0.25)]">
                        <FallbackIcon className="h-5 w-5" />
                    </div>
                )}
                <div className="min-w-0 flex-1">
                    <div className="flex items-start gap-2">
                        <p className="min-w-0 flex-1 text-sm font-bold text-text leading-snug line-clamp-2">{title}</p>
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-plex/25 bg-plex/10 text-[10px] font-black text-plex">
                            {index + 1}
                        </span>
                    </div>
                    {subtitle ? (
                        <p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-muted/90">
                            {formatHighlightSubtitle(subtitle)}
                        </p>
                    ) : null}
                </div>
            </div>
        </div>
    );
};

type Props = {
    digestId?: string | null;
    onClose: () => void;
};

export const SummaryDigestCard: React.FC<Props> = ({ digestId = 'latest', onClose }) => {
    const [digest, setDigest] = useState<SummaryDigest | null>(null);
    const [history, setHistory] = useState<SummaryDigest[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const load = useCallback(async (targetId = digestId || 'latest') => {
        setLoading(true);
        setError('');
        try {
            const [digestRes, historyRes] = await Promise.all([
                apiFetch(targetId === 'latest' ? '/api/admin/summary-digest/latest' : `/api/admin/summary-digest/${encodeURIComponent(targetId)}`),
                apiFetch('/api/admin/summary-digest/history?limit=7'),
            ]);
            setDigest(digestRes);
            setHistory(Array.isArray(historyRes?.items) ? historyRes.items : []);
        } catch (e: any) {
            setError(e?.message || 'Failed to load summary digest.');
            setDigest(null);
        } finally {
            setLoading(false);
        }
    }, [digestId]);

    useEffect(() => {
        void load();
    }, [load]);

    useEffect(() => lockBackgroundScroll(), []);

    const uptimeRows = useMemo(() => {
        const uptime = digest?.metrics?.uptime;
        const rows: Array<{ label: string; value?: number | null }> = [];
        if (uptime?.plex) rows.push({ label: uptime.plex.label || 'Plex', value: uptime.plex.uptimePct });
        if (uptime?.sonarr) rows.push({ label: uptime.sonarr.label || 'Sonarr', value: uptime.sonarr.uptimePct });
        if (uptime?.radarr) rows.push({ label: uptime.radarr.label || 'Radarr', value: uptime.radarr.uptimePct });
        for (const row of uptime?.services || []) {
            if (rows.some((entry) => entry.label === row.label)) continue;
            rows.push({ label: row.label || 'Service', value: row.uptimePct });
        }
        return rows.slice(0, 8);
    }, [digest]);

    const close = () => {
        try {
            const url = new URL(window.location.href);
            url.searchParams.delete('summary');
            window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
        } catch {
            // ignore
        }
        onClose();
    };

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') close();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    const requests = digest?.metrics?.requests || {};
    const aggregateUptime = digest?.metrics?.uptime?.aggregatePct;
    const aggregateTone = uptimeTone(aggregateUptime);

    const modal = (
        <div className="fixed inset-0 z-[500] flex items-center justify-center p-3 sm:p-6 animate-fade-in">
            <button
                type="button"
                className="absolute inset-0 bg-black/80 backdrop-blur-md"
                aria-label="Close summary"
                onClick={close}
            />
            <div className="relative w-full max-w-5xl max-h-[92vh] overflow-hidden rounded-3xl border border-white/10 bg-card/90 shadow-[0_32px_100px_-16px_rgba(0,0,0,0.75)] backdrop-blur-2xl flex flex-col ring-1 ring-white/[0.06]">
                {/* Hero header */}
                <div className="relative overflow-hidden border-b border-white/10">
                    <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-plex/20 via-background/50 to-amber-500/10" />
                    <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_100%_0%,rgb(var(--color-plex)_/_0.22),transparent_58%)]" />
                    <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_0%_100%,rgb(var(--color-plex)_/_0.08),transparent_55%)]" />
                    <div className="relative px-5 py-5 sm:px-6 sm:py-6">
                        <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                                <div className="mb-3 inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-plex/90">
                                    <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-plex/30 bg-plex/15">
                                        <Sparkles className="w-3.5 h-3.5" />
                                    </span>
                                    Smart summary
                                </div>
                                <h2 className="text-3xl font-black tracking-tight text-text sm:text-4xl">
                                    {digest ? formatStoredSummaryPeriodLabel(digest) : 'Server summary'}
                                </h2>
                                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
                                    {digest?.periodStart && digest?.periodEnd ? (
                                        <span className="inline-flex items-center gap-1.5">
                                            <Clock className="w-3.5 h-3.5 shrink-0 text-plex/70" />
                                            {formatWhen(digest.periodStart)} → {formatWhen(digest.periodEnd)}
                                        </span>
                                    ) : (
                                        <span>Snapshot of server health and activity</span>
                                    )}
                                    {digest?.frequency ? (
                                        <span className="inline-flex items-center rounded-full border border-white/10 bg-black/25 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted">
                                            {digest.frequency}
                                        </span>
                                    ) : null}
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={close}
                                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-black/30 text-muted transition-colors hover:border-white/20 hover:bg-white/10 hover:text-text"
                                aria-label="Close"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto custom-scrollbar">
                    {loading ? (
                        <div className="flex flex-col items-center justify-center gap-3 py-24 text-muted">
                            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-black/30">
                                <RefreshCw className="w-5 h-5 animate-spin text-plex" />
                            </div>
                            <p className="text-sm font-medium">Loading summary…</p>
                        </div>
                    ) : error ? (
                        <div className="p-8 text-center">
                            <p className="rounded-xl border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                                {error}
                            </p>
                        </div>
                    ) : digest ? (
                        <div className="grid grid-cols-1 lg:grid-cols-[1fr_240px] gap-0 lg:gap-0">
                            <div className="space-y-5 p-5 sm:p-6 min-w-0">
                                <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
                                    <DashboardStatCard
                                        label="Requests made"
                                        value={requests.made ?? 0}
                                        hint="New requests in period"
                                        icon={<TrendingUp className="w-4 h-4 text-plex" />}
                                        glow="bg-plex/25"
                                        valueClassName="text-plex"
                                    />
                                    <DashboardStatCard
                                        label="Approved"
                                        value={requests.approved ?? 0}
                                        hint="Approved or processing"
                                        icon={<CheckCircle2 className="w-4 h-4 text-emerald-300" />}
                                        glow="bg-emerald-400/25"
                                        valueClassName="text-emerald-300"
                                    />
                                    <DashboardStatCard
                                        label="Available"
                                        value={requests.available ?? 0}
                                        hint="Ready to watch"
                                        icon={<Clapperboard className="w-4 h-4 text-sky-300" />}
                                        glow="bg-sky-400/20"
                                    />
                                    <DashboardStatCard
                                        label="Aggregate uptime"
                                        value={formatPct(aggregateUptime)}
                                        hint="Monitored services"
                                        icon={<Server className="w-4 h-4 text-emerald-300" />}
                                        glow={aggregateTone === 'emerald' ? 'bg-emerald-400/25' : aggregateTone === 'amber' ? 'bg-amber-400/25' : 'bg-rose-400/20'}
                                        valueClassName={uptimeTextClass(aggregateTone)}
                                    />
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <section className={`${dashboardPanelClass} p-4 md:p-5`}>
                                        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent" />
                                        <div className="flex items-center gap-2.5 mb-4">
                                            <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-plex/25 bg-plex/10">
                                                <Server className="w-4 h-4 text-plex" />
                                            </div>
                                            <div>
                                                <h3 className="text-sm font-bold text-text">Service uptime</h3>
                                                <p className="text-[11px] text-muted">Per-service availability</p>
                                            </div>
                                        </div>
                                        {uptimeRows.length ? (
                                            <div className="space-y-0">
                                                {uptimeRows.map((row) => (
                                                    <UptimeRow key={row.label} label={row.label} value={row.value} />
                                                ))}
                                            </div>
                                        ) : (
                                            <p className="text-sm text-muted">No uptime samples for this period.</p>
                                        )}
                                    </section>

                                    <section className={`${dashboardPanelClass} p-4 md:p-5`}>
                                        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent" />
                                        <div className="flex items-center gap-2.5 mb-4">
                                            <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-plex/25 bg-plex/10">
                                                <Activity className="w-4 h-4 text-plex" />
                                            </div>
                                            <div>
                                                <h3 className="text-sm font-bold text-text">Automation activity</h3>
                                                <p className="text-[11px] text-muted">Background jobs this period</p>
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-1 gap-2.5">
                                            <AutomationStat
                                                icon={<Radar className="w-4 h-4" />}
                                                label="Scanner imports"
                                                value={digest.metrics?.scannerImports ?? 0}
                                                accent="from-sky-500/[0.08] to-black/30"
                                            />
                                            <AutomationStat
                                                icon={<Layers className="w-4 h-4" />}
                                                label="ColleXions rotations"
                                                value={digest.metrics?.collexionsRotations ?? 0}
                                                accent="from-violet-500/[0.08] to-black/30"
                                            />
                                            <AutomationStat
                                                icon={<Cpu className="w-4 h-4" />}
                                                label="Media automation jobs"
                                                value={digest.metrics?.mediaAutomationJobs ?? 0}
                                                accent="from-amber-500/[0.08] to-black/30"
                                            />
                                        </div>
                                    </section>
                                </div>

                                {digest.highlights?.length ? (
                                    <section className={`${dashboardPanelClass} p-4 md:p-5`}>
                                        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent" />
                                        <div className="flex items-center gap-2.5 mb-4">
                                            <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-plex/25 bg-plex/10">
                                                <Clapperboard className="w-4 h-4 text-plex" />
                                            </div>
                                            <div>
                                                <h3 className="text-sm font-bold text-text">Highlights</h3>
                                                <p className="text-[11px] text-muted">Notable activity in this window</p>
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                                            {digest.highlights.map((item, index) => (
                                                <HighlightCard
                                                    key={`${item.title}-${index}`}
                                                    title={item.title || 'Highlight'}
                                                    subtitle={item.subtitle}
                                                    posterPath={item.posterPath}
                                                    backdropPath={item.backdropPath}
                                                    mediaType={item.mediaType}
                                                    index={index}
                                                />
                                            ))}
                                        </div>
                                    </section>
                                ) : null}
                            </div>

                            <aside className="border-t lg:border-t-0 lg:border-l border-white/10 bg-black/20 px-4 py-5 sm:px-5">
                                <div className="flex items-center gap-2 mb-3">
                                    <BarChart3 className="w-3.5 h-3.5 text-plex/70" />
                                    <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted">
                                        Recent summaries
                                    </p>
                                </div>
                                <div className="space-y-2">
                                    {history.map((item) => {
                                        const active = item.id === digest.id;
                                        return (
                                            <button
                                                key={item.id}
                                                type="button"
                                                onClick={() => {
                                                    void load(item.id);
                                                    try {
                                                        const url = new URL(window.location.href);
                                                        url.searchParams.set('summary', item.id);
                                                        window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
                                                    } catch {
                                                        // ignore
                                                    }
                                                }}
                                                className={`group relative w-full overflow-hidden rounded-xl border px-3.5 py-3 text-left transition-all ${
                                                    active
                                                        ? 'border-plex/40 bg-gradient-to-br from-plex/15 to-plex/5 shadow-[0_0_24px_rgba(229,160,13,0.12)]'
                                                        : 'border-white/10 bg-white/[0.02] hover:border-plex/25 hover:bg-white/[0.04]'
                                                }`}
                                            >
                                                {active ? (
                                                    <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_0%_0%,rgb(var(--color-plex)_/_0.15),transparent_60%)]" />
                                                ) : null}
                                                <p className="relative text-sm font-bold text-text">
                                                    {formatStoredSummaryPeriodLabel(item)}
                                                </p>
                                                <p className="relative mt-0.5 text-[11px] text-muted">
                                                    {formatWhen(item.createdAt)}
                                                </p>
                                            </button>
                                        );
                                    })}
                                    {!history.length ? (
                                        <p className="text-xs text-muted px-1">No previous summaries yet.</p>
                                    ) : null}
                                </div>
                            </aside>
                        </div>
                    ) : null}
                </div>
            </div>
        </div>
    );

    return typeof document !== 'undefined' ? createPortal(modal, document.body) : modal;
};

export const openSummaryDigestFromUrl = () => {
    try {
        const id = new URLSearchParams(window.location.search).get('summary');
        if (!id) return null;
        return id;
    } catch {
        return null;
    }
};

export const navigateToSummaryDigest = (digestId: string) => {
    const href = portalUrl(`/portal?summary=${encodeURIComponent(digestId)}`);
    window.history.pushState({}, '', href);
    window.dispatchEvent(new CustomEvent('portal-summary-open', { detail: { digestId } }));
};
