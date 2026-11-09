import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, X } from 'lucide-react';
import {
    discoveryTheme,
    PosterGridSkeleton,
    RowHeaderMark,
    upgraderPosterGridClass,
    upgraderPosterGridStyle,
    useDiscoverGridSize,
    useDiscoverI18n,
} from './host';
import { homeRailPosterDensity } from '../shared/portalLayout';
import { isPlexDirectMode } from '../plex-client/config';
import { fetchMediaPlayerInsights, setMediaPlayerWatched } from './api';
import { groupHistory, MediaPlayerHistory } from './MediaPlayerHistory';
import { PlayerPosterCard } from './PlayerPosterCard';
import { PlayerRail } from './PlayerRail';
import { PlayerTvStatusPanel } from './PlayerTvStatusPanel';
import { buildWatchInsights, type InsightFavourite } from './watchInsights';
import { buildInsightDetail, type DetailKind, type InsightDetail } from './insightDetails';
import type { PlayerItem, PlayerPlayOptions } from './types';

type Props = {
    onBack: () => void;
    onOpenItem: (item: PlayerItem) => void;
    onPlay: (item: PlayerItem, opts?: PlayerPlayOptions) => void;
    onPlayNext?: (item: PlayerItem) => void;
    onToast?: (message: string, type?: 'success' | 'error' | 'info') => void;
    isAdmin?: boolean;
    playlistsEnabled?: boolean;
};

const isTvShell = () => {
    try {
        return document.documentElement?.dataset?.tv === '1' || window.__PLEX_CLIENT__?.isTv === true;
    } catch {
        return false;
    }
};

/** Select (OK on the remote, Enter, a tap) on a box. */
const selectable = (onSelect?: () => void) => (onSelect ? {
    role: 'button' as const,
    'data-tv-action': '1',
    onClick: onSelect,
    onKeyDown: (event: React.KeyboardEvent) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onSelect();
        }
    },
} : {});

/** Keeps the focus ring clear of the screen edge when the remote scrolls a band into view. */
const BAND_STYLE: React.CSSProperties = { scrollMarginBlock: 28 };

/** One block of the page. On a TV each is a stop for the remote, so Down walks the page. */
const InsightCard: React.FC<{
    id: string;
    title?: string;
    note?: string;
    children: React.ReactNode;
    className?: string;
    onSelect?: () => void;
    /** A card alone on its line is a row for the remote; cards sharing a line sit in a row together. */
    alone?: boolean;
}> = ({ id, title, note, children, className = '', onSelect, alone = false }) => (
    <section
        {...(alone ? { 'data-tv-row': '1', 'data-tv-row-id': `insights:${id}`, 'data-tv-insights-band': '1' } : {})}
        style={alone ? BAND_STYLE : undefined}
        className="flex min-w-0 flex-col gap-2"
    >
        {title ? (
            <div className="player-row-header flex min-w-0 items-center gap-3">
                <RowHeaderMark />
                <h2 className="player-row-header-title text-lg font-black text-white">{title}</h2>
            </div>
        ) : null}
        <div
            tabIndex={0}
            data-tv-item="1"
            {...selectable(onSelect)}
            className={`insights-card rounded-2xl border border-white/10 bg-white/[0.04] p-5 outline-none ${onSelect ? 'cursor-pointer hover:bg-white/[0.07]' : ''} ${className}`}
        >
            {children}
            {note ? <p className="mt-4 text-xs text-muted">{note}</p> : null}
        </div>
    </section>
);

const StatTile: React.FC<{ value: string; label: string; hint?: string; onSelect?: () => void }> = ({ value, label, hint, onSelect }) => (
    <div
        tabIndex={0}
        data-tv-item="1"
        {...selectable(onSelect)}
        className={`insights-card flex min-w-0 flex-col gap-1 rounded-2xl border border-white/10 bg-white/[0.04] p-5 outline-none ${onSelect ? 'cursor-pointer hover:bg-white/[0.07]' : ''}`}
    >
        <span className="text-4xl font-black leading-none text-white tabular-nums">{value}</span>
        <span className="text-sm font-bold text-muted">{label}</span>
        {hint ? <span className="text-xs text-muted/80">{hint}</span> : null}
    </div>
);

/** Horizontal bars, longest = full width. */
const BarList: React.FC<{ rows: Array<{ label: string; value: number; display: string }> }> = ({ rows }) => {
    const max = Math.max(1, ...rows.map((row) => row.value));
    return (
        <ul className="flex flex-col gap-3">
            {rows.map((row) => (
                <li key={row.label} className="flex min-w-0 flex-col gap-1">
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                        <span className="min-w-0 truncate font-bold text-white">{row.label}</span>
                        <span className="shrink-0 tabular-nums text-muted">{row.display}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-white/10">
                        <div className="h-full rounded-full bg-plex" style={{ width: `${Math.max(3, (row.value / max) * 100)}%` }} />
                    </div>
                </li>
            ))}
        </ul>
    );
};

/** Vertical columns, tallest = full height. */
const Columns: React.FC<{ rows: Array<{ label: string; value: number; hot?: boolean }>; height?: number }> = ({ rows, height = 96 }) => {
    const max = Math.max(1, ...rows.map((row) => row.value));
    return (
        <div className="flex items-end gap-1.5" style={{ height: height + 24 }}>
            {rows.map((row) => (
                <div key={row.label} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1">
                    <div
                        className={`w-full rounded-t-md ${row.hot ? 'bg-plex' : 'bg-white/25'}`}
                        style={{ height: Math.max(row.value > 0 ? 4 : 2, (row.value / max) * height) }}
                    />
                    <span className="max-w-full truncate text-[0.7rem] font-bold text-muted">{row.label}</span>
                </div>
            ))}
        </div>
    );
};

/** The detail behind a box: its numbers, then the titles that make them up. */
const InsightDetailSheet: React.FC<{
    detail: InsightDetail;
    onClose: () => void;
    onOpenItem: (item: PlayerItem) => void;
}> = ({ detail, onClose, onOpenItem }) => {
    const { t } = useDiscoverI18n();
    const bodyRef = useRef<HTMLDivElement | null>(null);
    const closeRef = useRef<HTMLButtonElement | null>(null);
    const returnTo = useRef<HTMLElement | null>(typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null));

    useEffect(() => {
        // The remote treats an open panel as its own world (Back closes it, arrows stay inside).
        try {
            document.documentElement.dataset.tvMenuOpen = '1';
        } catch {
            /* ignore */
        }
        const close = () => onClose();
        window.addEventListener('smp-tv-overlay-close', close);
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKey);
        const focusTimer = window.setTimeout(() => {
            const first = bodyRef.current?.querySelector<HTMLElement>('[data-tv-item="1"]') || closeRef.current;
            first?.focus({ preventScroll: true });
        }, 40);
        return () => {
            window.clearTimeout(focusTimer);
            window.removeEventListener('smp-tv-overlay-close', close);
            window.removeEventListener('keydown', onKey);
            try {
                delete document.documentElement.dataset.tvMenuOpen;
            } catch {
                /* ignore */
            }
            window.requestAnimationFrame(() => returnTo.current?.focus({ preventScroll: true }));
        };
    }, [onClose]);

    const rowClass = 'insights-row flex w-full min-w-0 items-center gap-4 rounded-xl px-4 py-3 text-left outline-none hover:bg-white/[0.06]';
    return createPortal(
        <div
            className="fixed inset-0 z-[3500] flex items-center justify-center bg-black/75 px-4"
            data-tv-settings-dialog="1"
            onClick={(event) => {
                if (event.target === event.currentTarget) onClose();
            }}
        >
            <div
                role="dialog"
                aria-label={detail.title}
                data-tv-item-menu="1"
                className="flex w-full max-w-[64rem] flex-col overflow-hidden rounded-3xl border border-white/10 bg-[#0b1018] shadow-[0_30px_80px_rgba(0,0,0,0.6)]"
                style={{ maxHeight: 'calc(88vh / var(--tv-zoom, 1))' }}
                onClick={(event) => event.stopPropagation()}
            >
                <div className="flex shrink-0 items-start justify-between gap-4 border-b border-white/10 px-7 py-5">
                    <div className="min-w-0">
                        <h2 className="truncate text-2xl font-black text-white">{detail.title}</h2>
                        {detail.lead ? <p className="mt-1 text-sm text-muted">{detail.lead}</p> : null}
                    </div>
                    <button
                        ref={closeRef}
                        type="button"
                        data-tv-item="1"
                        data-tv-action="1"
                        aria-label={t('mediaPlayerPage.insightsDetClose')}
                        onClick={onClose}
                        className="insights-row inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/5 text-white outline-none hover:bg-white/10"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>
                <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-7 py-5 hide-scrollbar" data-tv-overlay-scroll="1">
                    {detail.stats.length ? (
                        <div className="mb-5 flex flex-wrap gap-3">
                            {detail.stats.map((stat) => (
                                <div key={stat.label} className="min-w-[9rem] rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-3">
                                    <p className="truncate text-2xl font-black text-white">{stat.value}</p>
                                    <p className="text-xs font-bold text-muted">{stat.label}</p>
                                </div>
                            ))}
                        </div>
                    ) : null}
                    {detail.sections.map((section, index) => (
                        <section key={`${section.title}-${index}`} className="mb-6 flex flex-col gap-1">
                            <h3 className="mb-1 text-xs font-black uppercase tracking-widest text-muted">{section.title}</h3>
                            {section.columns ? (
                                <div tabIndex={0} data-tv-item="1" className="insights-row rounded-xl px-4 py-3 outline-none">
                                    <Columns rows={section.columns} height={72} />
                                </div>
                            ) : null}
                            {(section.rows || []).map((row) => (
                                row.item ? (
                                    <button
                                        key={row.id}
                                        type="button"
                                        data-tv-item="1"
                                        data-tv-action="1"
                                        onClick={() => {
                                            onClose();
                                            onOpenItem(row.item as PlayerItem);
                                        }}
                                        className={rowClass}
                                    >
                                        <span className="min-w-0 flex-1 truncate font-bold text-white">{row.label}</span>
                                        {row.sub ? <span className="shrink-0 text-sm text-muted">{row.sub}</span> : null}
                                        {row.value ? <span className="w-28 shrink-0 text-right tabular-nums text-white/90">{row.value}</span> : null}
                                    </button>
                                ) : (
                                    <div key={row.id} tabIndex={0} data-tv-item="1" className={rowClass}>
                                        <span className="min-w-0 flex-1 truncate font-bold text-white">{row.label}</span>
                                        {row.sub ? <span className="shrink-0 text-sm text-muted">{row.sub}</span> : null}
                                        {row.value ? <span className="w-28 shrink-0 text-right tabular-nums text-white/90">{row.value}</span> : null}
                                    </div>
                                )
                            ))}
                        </section>
                    ))}
                </div>
            </div>
        </div>,
        document.body,
    );
};

const FavouriteRail: React.FC<{
    id: string;
    title: string;
    rows: InsightFavourite[];
    badge: (row: InsightFavourite) => string;
    props: Props;
    density: number;
}> = ({ id, title, rows, badge, props, density }) => {
    if (!rows.length) return null;
    const labelByKey = new Map(rows.map((row) => [row.item.ratingKey, badge(row)]));
    return (
        <div className="flex min-w-0 flex-col gap-1">
            <PlayerRail
                title={title}
                rowId={`insights:${id}`}
                items={rows.map((row) => row.item)}
                density={density}
                aspect="2/3"
                onOpenItem={props.onOpenItem}
                onPlay={props.onPlay}
                onPlayNext={props.onPlayNext}
                onToast={props.onToast}
                isAdmin={props.isAdmin}
                playlistsEnabled={props.playlistsEnabled}
            />
            <p className="px-1 text-xs text-muted">
                {rows.slice(0, 4).map((row) => `${row.item.title} · ${labelByKey.get(row.item.ratingKey)}`).join('   |   ')}
            </p>
        </div>
    );
};

const InsightsPage: React.FC<Props> = (props) => {
    const { onBack, onOpenItem, onPlay, onPlayNext, onToast, isAdmin = false, playlistsEnabled = true } = props;
    const { t, locale } = useDiscoverI18n();
    const [gridSize] = useDiscoverGridSize();
    const [items, setItems] = useState<PlayerItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [attempt, setAttempt] = useState(0);
    const [detailKind, setDetailKind] = useState<DetailKind | null>(null);
    const [incomplete, setIncomplete] = useState(false);
    /** The newest titles are in; the rest of the history is still being read. */
    const [readingMore, setReadingMore] = useState(false);
    const tvShell = isTvShell();
    const density = homeRailPosterDensity(gridSize);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setReadingMore(false);
        // The page opens on the newest titles of every library, then the rest of the history is read
        // behind it. A slow library cannot keep the whole page blank, or quietly drop out of it.
        const timer = window.setTimeout(() => {
            const showFull = () => {
                fetchMediaPlayerInsights({ force: attempt > 0 })
                    .then((data) => {
                        if (cancelled) return;
                        setItems(data.items || []);
                        setIncomplete(data.incomplete === true);
                        setError(null);
                    })
                    .catch(() => {
                        // The quick pass is on screen: keep it, and say the rest did not load.
                        if (!cancelled) setIncomplete(true);
                    })
                    .finally(() => {
                        if (!cancelled) {
                            setReadingMore(false);
                            setLoading(false);
                        }
                    });
            };
            fetchMediaPlayerInsights({ quick: true })
                .then((data) => {
                    if (cancelled) return;
                    if (data.items.length) {
                        setItems(data.items);
                        setIncomplete(data.incomplete === true);
                        setError(null);
                        setLoading(false);
                        setReadingMore(true);
                    }
                    showFull();
                })
                .catch(() => {
                    if (!cancelled) showFull();
                });
        }, 60);
        return () => {
            cancelled = true;
            window.clearTimeout(timer);
        };
    }, [t, attempt]);

    const insights = useMemo(() => buildWatchInsights(items, { locale }), [items, locale]);
    const recent = useMemo(
        () => [...items].filter((row) => Number(row.lastViewedAt) > 0)
            .sort((a, b) => Number(b.lastViewedAt) - Number(a.lastViewedAt)).slice(0, 240),
        [items],
    );
    const groups = useMemo(() => groupHistory(recent, t, locale), [recent, t, locale]);
    const detail = useMemo(
        () => (detailKind ? buildInsightDetail(detailKind, insights, t, locale) : null),
        [detailKind, insights, t, locale],
    );
    const closeDetail = React.useCallback(() => setDetailKind(null), []);

    const toggleWatched = async (item: PlayerItem) => {
        const next = !item.watched;
        setItems((prev) => prev.map((row) => (row.ratingKey === item.ratingKey ? { ...row, watched: next } : row)));
        try {
            await setMediaPlayerWatched(item.ratingKey, next, item);
        } catch {
            setItems((prev) => prev.map((row) => (row.ratingKey === item.ratingKey ? { ...row, watched: item.watched } : row)));
        }
    };

    const heading = (
        <div>
            {!tvShell ? (
                <button
                    type="button"
                    onClick={onBack}
                    className="player-page-back mb-2 inline-flex items-center gap-2 text-sm font-bold text-muted hover:text-text"
                >
                    <ArrowLeft className="h-4 w-4" />
                    {t('mediaPlayerPage.back')}
                </button>
            ) : null}
            <h1 className={discoveryTheme.heading}>{t('mediaPlayerPage.navInsights')}</h1>
            {!loading && !error && insights.titles ? (
                <p className="mt-1 text-sm text-muted">{t('mediaPlayerPage.insightsBasedOn', { count: insights.titles })} {t('mediaPlayerPage.insightsSelectHint')}</p>
            ) : null}
        </div>
    );

    if (error && !loading) {
        return (
            <div className="flex flex-col gap-5 pb-8">
                {heading}
                {tvShell ? (
                    <PlayerTvStatusPanel title={error} onRetry={() => setAttempt((n) => n + 1)} onBack={onBack} />
                ) : (
                    <div className={discoveryTheme.emptyState}><p className={discoveryTheme.emptyTitle}>{error}</p></div>
                )}
            </div>
        );
    }
    if (loading) {
        return (
            <div className="flex flex-col gap-5 pb-8">
                {heading}
                <PosterGridSkeleton
                    className={upgraderPosterGridClass(gridSize)}
                    style={upgraderPosterGridStyle(gridSize)}
                    {...(tvShell ? { count: 12, variant: 'home' as const } : {})}
                />
            </div>
        );
    }
    if (!insights.titles) {
        return (
            <div className="flex flex-col gap-5 pb-8">
                {heading}
                {tvShell ? (
                    <PlayerTvStatusPanel title={t('mediaPlayerPage.insightsEmpty')} onBack={onBack} />
                ) : (
                    <div className={discoveryTheme.emptyState}><p className={discoveryTheme.emptyTitle}>{t('mediaPlayerPage.insightsEmpty')}</p></div>
                )}
            </div>
        );
    }

    const weekdayLabel = (day: number) => new Date(2024, 0, 7 + day).toLocaleDateString(locale, { weekday: 'short' });
    const partLabels = [
        t('mediaPlayerPage.insightsMorning'),
        t('mediaPlayerPage.insightsAfternoon'),
        t('mediaPlayerPage.insightsEvening'),
        t('mediaPlayerPage.insightsNight'),
    ];
    const colsTiles = tvShell ? 'grid-cols-6' : 'grid-cols-2 md:grid-cols-3 xl:grid-cols-6';
    const colsThree = tvShell ? 'grid-cols-3' : 'grid-cols-1 lg:grid-cols-3';
    const colsFacts = tvShell ? 'grid-cols-4' : 'grid-cols-1 md:grid-cols-2 xl:grid-cols-4';
    const hoursText = insights.hours >= 100 ? String(Math.round(insights.hours)) : String(insights.hours);
    const factTitle = (id: string) => t(`mediaPlayerPage.insightsFact_${id}`);
    const epsLabel = (row: InsightFavourite) => t('mediaPlayerPage.insightsEpisodesShort', { count: row.episodes });
    const playsLabel = (row: InsightFavourite) => t('mediaPlayerPage.insightsPlaysShort', { count: row.plays });
    const ratedLabel = (row: InsightFavourite) => `${(Number(row.item.userRating) || 0).toFixed(1)}/10`;

    return (
        <div data-tv-insights-root="1" className="flex flex-col gap-6 pb-10">
            {heading}
            {readingMore ? (
                <p className="text-sm text-muted">{t('mediaPlayerPage.insightsReadingMore')}</p>
            ) : null}
            {incomplete && !readingMore ? (
                <div data-tv-row="1" data-tv-row-id="insights:notice" data-tv-insights-band="first" style={BAND_STYLE} className="flex flex-wrap items-center gap-4 rounded-2xl border border-amber-400/30 bg-amber-400/10 px-5 py-3">
                    <p className="min-w-0 flex-1 text-sm text-amber-100">{t('mediaPlayerPage.insightsIncomplete')}</p>
                    <button
                        type="button"
                        data-tv-item="1"
                        data-tv-action="1"
                        onClick={() => setAttempt((n) => n + 1)}
                        className="insights-row inline-flex h-10 shrink-0 items-center rounded-xl border border-white/20 bg-white/10 px-4 text-sm font-bold text-white outline-none hover:bg-white/15"
                    >
                        {t('mediaPlayerPage.insightsTryAgain')}
                    </button>
                </div>
            ) : null}

            <div
                data-tv-row="1"
                data-tv-row-id="insights:tiles"
                data-tv-insights-band="first"
                style={BAND_STYLE}
                className={`grid gap-3 ${colsTiles}`}
            >
                <StatTile value={hoursText} label={t('mediaPlayerPage.insightsHours')} hint={t('mediaPlayerPage.insightsEstimate')} onSelect={() => setDetailKind('hours')} />
                <StatTile value={String(insights.titles)} label={t('mediaPlayerPage.insightsTitles')} onSelect={() => setDetailKind('titles')} />
                <StatTile value={String(insights.episodes)} label={t('mediaPlayerPage.insightsEpisodes')} onSelect={() => setDetailKind('episodes')} />
                <StatTile value={String(insights.movies)} label={t('mediaPlayerPage.insightsMovies')} onSelect={() => setDetailKind('movies')} />
                <StatTile value={String(insights.showsFinished)} label={t('mediaPlayerPage.insightsShowsFinished')} hint={t('mediaPlayerPage.insightsShowsStarted', { count: insights.showsInProgress })} onSelect={() => setDetailKind('showsFinished')} />
                <StatTile value={String(insights.rewatches)} label={t('mediaPlayerPage.insightsRewatches')} onSelect={() => setDetailKind('rewatches')} />
            </div>

            <div
                data-tv-row="1"
                data-tv-row-id="insights:breakdowns"
                data-tv-insights-band="1"
                style={BAND_STYLE}
                className={`grid gap-5 ${colsThree}`}
            >
                {insights.genres.length ? (
                    <InsightCard id="genres" title={t('mediaPlayerPage.insightsGenres')} onSelect={() => setDetailKind('genres')}>
                        <BarList rows={insights.genres.map((g) => ({
                            label: g.name,
                            value: g.hours,
                            display: t('mediaPlayerPage.insightsHoursShort', { count: g.hours }),
                        }))}
                        />
                    </InsightCard>
                ) : null}
                {insights.decades.length ? (
                    <InsightCard id="decades" title={t('mediaPlayerPage.insightsDecades')} onSelect={() => setDetailKind('decades')}>
                        <BarList rows={insights.decades.map((d) => ({ label: d.label, value: d.titles, display: String(d.titles) }))} />
                    </InsightCard>
                ) : null}
                {insights.studios.length ? (
                    <InsightCard id="studios" title={t('mediaPlayerPage.insightsStudios')} onSelect={() => setDetailKind('studios')}>
                        <BarList rows={insights.studios.map((s) => ({ label: s.name, value: s.titles, display: String(s.titles) }))} />
                    </InsightCard>
                ) : null}
            </div>

            <InsightCard alone id="when" title={t('mediaPlayerPage.insightsWhen')} note={t('mediaPlayerPage.insightsWhenNote')} onSelect={() => setDetailKind('when')}>
                <div className={`grid gap-8 ${colsThree}`}>
                    <div className="flex flex-col gap-2">
                        <p className="text-xs font-black uppercase tracking-widest text-muted">{t('mediaPlayerPage.insightsWeekdays')}</p>
                        <Columns rows={insights.weekdays.map((value, day) => ({ label: weekdayLabel(day), value, hot: day === insights.peakWeekday }))} />
                    </div>
                    <div className="flex flex-col gap-2">
                        <p className="text-xs font-black uppercase tracking-widest text-muted">{t('mediaPlayerPage.insightsTimeOfDay')}</p>
                        <Columns rows={insights.partsOfDay.map((value, part) => ({ label: partLabels[part], value, hot: part === insights.peakPart }))} />
                    </div>
                    <div className="flex flex-col gap-2">
                        <p className="text-xs font-black uppercase tracking-widest text-muted">{t('mediaPlayerPage.insightsMonths')}</p>
                        <Columns rows={insights.months.map((m) => ({ label: m.label, value: m.titles }))} />
                    </div>
                </div>
            </InsightCard>

            {insights.facts.length ? (
                <section data-tv-row="1" data-tv-row-id="insights:facts" data-tv-insights-band="1" style={BAND_STYLE} className="flex min-w-0 flex-col gap-2">
                    <div className="player-row-header flex min-w-0 items-center gap-3">
                        <RowHeaderMark />
                        <h2 className="player-row-header-title text-lg font-black text-white">{t('mediaPlayerPage.insightsFacts')}</h2>
                    </div>
                    <div className={`grid gap-3 ${colsFacts}`}>
                        {insights.facts.map((fact) => (
                            <div
                                key={fact.id}
                                tabIndex={0}
                                data-tv-item="1"
                                {...selectable(() => setDetailKind(`fact:${fact.id}`))}
                                className="insights-card flex min-w-0 cursor-pointer flex-col gap-1 rounded-2xl border border-white/10 bg-white/[0.04] p-5 outline-none hover:bg-white/[0.07]"
                            >
                                <span className="text-xs font-black uppercase tracking-widest text-muted">{factTitle(fact.id)}</span>
                                <span className="truncate text-2xl font-black text-white">{fact.value}</span>
                                <span className="truncate text-sm text-muted">
                                    {fact.id === 'days'
                                        ? t('mediaPlayerPage.insightsFactDays')
                                        : fact.id === 'busiestMonth' || fact.id === 'topGenre'
                                            ? t('mediaPlayerPage.insightsTitlesShort', { count: Number(fact.detail) })
                                            : fact.id === 'binge'
                                                ? t('mediaPlayerPage.insightsEpisodesShort', { count: Number(fact.detail) })
                                                : fact.id === 'rewatch'
                                                    ? t('mediaPlayerPage.insightsPlaysShort', { count: Number(fact.detail) })
                                                    : fact.detail}
                                </span>
                            </div>
                        ))}
                    </div>
                </section>
            ) : null}

            <FavouriteRail id="top-shows" title={t('mediaPlayerPage.insightsTopShows')} rows={insights.topShows} badge={epsLabel} props={props} density={density} />
            <FavouriteRail id="rewatched" title={t('mediaPlayerPage.insightsMostRewatched')} rows={insights.topRewatched} badge={playsLabel} props={props} density={density} />
            <FavouriteRail id="top-rated" title={t('mediaPlayerPage.insightsTopRated')} rows={insights.topRated} badge={ratedLabel} props={props} density={density} />

            <div className="mt-2 flex flex-col gap-1">
                <h2 className="text-2xl font-black text-white">{t('mediaPlayerPage.insightsRecent')}</h2>
            </div>
            {groups.map((group, groupIndex) => (
                <section key={group.label} className="flex flex-col gap-2">
                    <div className="player-row-header flex min-w-0 items-center gap-3">
                        <RowHeaderMark />
                        <h3 className="player-row-header-title text-lg font-black text-white">{group.label}</h3>
                    </div>
                    <div
                        className={upgraderPosterGridClass(gridSize)}
                        style={upgraderPosterGridStyle(gridSize)}
                        data-tv-row={tvShell ? '1' : undefined}
                        data-tv-rail={tvShell ? '1' : undefined}
                        data-tv-poster-grid={tvShell ? '1' : undefined}
                        data-tv-row-id={tvShell ? `history:${group.label}` : undefined}
                    >
                        {group.items.map((item, index) => (
                            <PlayerPosterCard
                                key={item.ratingKey}
                                item={item}
                                imagePriority={groupIndex === 0 && index < 12}
                                onOpenItem={onOpenItem}
                                onPlay={onPlay}
                                onPlayNext={onPlayNext}
                                onToggleWatched={toggleWatched}
                                onToast={onToast}
                                isAdmin={isAdmin}
                                playlistsEnabled={playlistsEnabled}
                            />
                        ))}
                    </div>
                </section>
            ))}
            {detail ? <InsightDetailSheet detail={detail} onClose={closeDetail} onOpenItem={onOpenItem} /> : null}
        </div>
    );
};

/** The Insights page. Outside the Plex app (no direct server) the plain History page is shown. */
export const MediaPlayerInsights: React.FC<Props> = (props) => (
    isPlexDirectMode() ? <InsightsPage {...props} /> : <MediaPlayerHistory {...props} />
);
