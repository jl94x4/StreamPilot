import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ChevronRight, Download, Film, Loader2, Play, RotateCcw, Trash2, Tv } from 'lucide-react';
import { discoveryTheme, useDiscoverI18n } from './host';
import { RetryablePoster } from '../shared/RetryablePoster';
import {
    deleteMediaDownload,
    listMediaDownloads,
    mediaDownloadsAvailable,
    onMediaDownloadChange,
    startMediaDownload,
    type MediaDownloadItem,
} from '../plex-client/mediaDownloads';
import { portalUrl } from '../shared/basePath';
import { resolveMediaPlayerDownloadSource } from './api';
import { formatPlayerDuration } from './playerUtils';
import type { PlayerItem, PlayerPlayOptions } from './types';

type Props = {
    onBack: () => void;
    onPlay: (item: PlayerItem, opts?: PlayerPlayOptions) => void;
    onToast?: (message: string, type?: 'success' | 'error' | 'info') => void;
};

const toPlayerItem = (row: MediaDownloadItem): PlayerItem => ({
    ratingKey: row.ratingKey,
    title: row.meta?.episodeTitle || row.title || 'Download',
    showTitle: row.meta?.showTitle || undefined,
    type: (row.type as PlayerItem['type']) || 'movie',
    thumb: row.thumbUrl || null,
    serverId: row.serverId || '',
    plexGuid: row.plexGuid || null,
    parentIndex: row.meta?.seasonIndex || null,
    index: row.meta?.episodeIndex || null,
    canPlay: true,
    durationMs: row.meta?.durationMs || 0,
    viewOffsetMs: 0,
});

const formatBytes = (value?: number) => {
    const n = Number(value) || 0;
    if (n <= 0) return '';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(0)} MB`;
    return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

const thumbSrc = (row: MediaDownloadItem) => {
    const thumb = row.thumbUrl || row.thumbPath || '';
    if (!thumb) return '';
    return /^https?:|^file:|^content:/i.test(thumb) ? thumb : portalUrl(thumb);
};

const posterUrl = (value?: string) => {
    const url = String(value || '').trim();
    if (!url) return '';
    return /^https?:|^file:|^content:/i.test(url) ? url : portalUrl(url);
};
/** The show poster saved with the download, else the episode still of the first row. */
const coverFor = (rows: MediaDownloadItem[]) => (
    posterUrl(rows.find((row) => row.meta?.showPoster)?.meta?.showPoster) || thumbSrc(rows[0])
);

const isEpisode = (row: MediaDownloadItem) => row.type === 'episode';
const showKeyOf = (row: MediaDownloadItem) => (
    row.meta?.showRatingKey || row.meta?.showTitle || row.title || row.ratingKey
);
const showNameOf = (row: MediaDownloadItem) => row.meta?.showTitle || row.title || 'Show';

type ShowGroup = {
    key: string;
    title: string;
    rows: MediaDownloadItem[];
    seasons: { index: number; title: string; rows: MediaDownloadItem[] }[];
    bytes: number;
    cover: string;
};

const sumBytes = (rows: MediaDownloadItem[]) => rows.reduce((total, row) => total + (Number(row.bytes) || 0), 0);

export const MediaPlayerDownloads: React.FC<Props> = ({ onBack, onPlay, onToast }) => {
    const { t } = useDiscoverI18n();
    const [items, setItems] = useState<MediaDownloadItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [available, setAvailable] = useState(true);
    const [openShow, setOpenShow] = useState<string | null>(null);
    const [openSeason, setOpenSeason] = useState<number | null>(null);
    const [tab, setTab] = useState<'tv' | 'movies'>('tv');

    const refresh = useCallback(async () => {
        const ok = await mediaDownloadsAvailable();
        setAvailable(ok);
        if (!ok) {
            setItems([]);
            setLoading(false);
            return;
        }
        const rows = await listMediaDownloads();
        setItems(rows.filter((row) => row.status !== 'cancelled'));
        setLoading(false);
    }, []);

    useEffect(() => {
        void refresh();
        return onMediaDownloadChange(() => { void refresh(); });
    }, [refresh]);

    const { shows, movies } = useMemo(() => {
        const byShow = new Map<string, MediaDownloadItem[]>();
        const movieRows: MediaDownloadItem[] = [];
        for (const row of items) {
            if (isEpisode(row)) {
                const key = showKeyOf(row);
                byShow.set(key, [...(byShow.get(key) || []), row]);
            } else {
                movieRows.push(row);
            }
        }
        const groups: ShowGroup[] = Array.from(byShow.entries()).map(([key, rows]) => {
            const bySeason = new Map<number, MediaDownloadItem[]>();
            for (const row of rows) {
                const index = Number(row.meta?.seasonIndex) || 0;
                bySeason.set(index, [...(bySeason.get(index) || []), row]);
            }
            const seasons = Array.from(bySeason.entries())
                .sort((a, b) => a[0] - b[0])
                .map(([index, seasonRows]) => ({
                    index,
                    title: seasonRows.find((row) => row.meta?.seasonTitle)?.meta?.seasonTitle
                        || (index > 0 ? `Season ${index}` : 'Episodes'),
                    rows: [...seasonRows].sort((a, b) => (Number(a.meta?.episodeIndex) || 0) - (Number(b.meta?.episodeIndex) || 0)),
                }));
            return {
                key,
                title: showNameOf(rows[0]),
                rows,
                seasons,
                bytes: sumBytes(rows),
                cover: coverFor(rows),
            };
        }).sort((a, b) => a.title.localeCompare(b.title));
        movieRows.sort((a, b) => a.title.localeCompare(b.title));
        return { shows: groups, movies: movieRows };
    }, [items]);

    const group = openShow ? shows.find((entry) => entry.key === openShow) || null : null;
    useEffect(() => {
        if (openShow && !group && !loading) setOpenShow(null);
    }, [openShow, group, loading]);

    const removeRows = async (rows: MediaDownloadItem[]) => {
        try {
            await Promise.all(rows.map((row) => deleteMediaDownload({ id: row.id, ratingKey: row.ratingKey })));
            const gone = new Set(rows.map((row) => row.id));
            setItems((prev) => prev.filter((item) => !gone.has(item.id)));
            onToast?.(t('mediaPlayerPage.downloadRemoved'), 'success');
        } catch {
            onToast?.(t('mediaPlayerPage.downloadError'), 'error');
        }
    };

    const retry = async (row: MediaDownloadItem) => {
        try {
            const meta = row.meta || {};
            const source = await resolveMediaPlayerDownloadSource(row.ratingKey, {
                serverId: row.serverId || null,
                quality: meta.qualityId || 'original',
            });
            await startMediaDownload({
                resumeId: row.id,
                url: source.url,
                headers: source.headers || {},
                ratingKey: row.ratingKey,
                title: row.title,
                type: row.type,
                serverId: row.serverId || '',
                plexGuid: row.plexGuid || '',
                fileName: source.fileName,
                thumbUrl: row.thumbUrl || '',
                bytes: source.bytes || 0,
                meta,
            });
            void refresh();
        } catch (error: any) {
            onToast?.(String(error?.message || t('mediaPlayerPage.downloadError')), 'error');
        }
    };

    const rowProgress = (row: MediaDownloadItem) => (
        row.totalBytes && row.bytes
            ? Math.min(99, Math.round((Number(row.bytes) / Number(row.totalBytes)) * 100))
            : (row.status === 'complete' ? 100 : 0)
    );

    const renderRow = (row: MediaDownloadItem, mode: 'movie' | 'episode') => {
        const progress = rowProgress(row);
        const meta = row.meta || {};
        const thumb = thumbSrc(row);
        const sizeLabel = row.status === 'complete'
            ? formatBytes(row.bytes)
            : (row.totalBytes ? `${formatBytes(row.bytes)} / ${formatBytes(row.totalBytes)}` : formatBytes(row.bytes));
        const runtime = formatPlayerDuration(meta.durationMs);
        const heading = mode === 'episode'
            ? `${meta.episodeIndex ? `${meta.episodeIndex}. ` : ''}${meta.episodeTitle || row.title}`
            : row.title;
        const subtitle = [
            mode === 'movie' && meta.year ? String(meta.year) : '',
            runtime,
            meta.quality || '',
            sizeLabel,
        ].filter(Boolean).join(' · ');
        return (
            <li
                key={row.id}
                className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3"
            >
                <div className={`${mode === 'episode' ? 'h-16 w-28' : 'h-20 w-14'} shrink-0 overflow-hidden rounded-lg bg-black/40`}>
                    {thumb ? (
                        <RetryablePoster src={thumb} alt="" className="h-full w-full object-cover" />
                    ) : (
                        <div className="flex h-full items-center justify-center text-zinc-600">
                            <Download className="h-5 w-5" />
                        </div>
                    )}
                </div>
                <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-white">{heading}</p>
                    <p className="mt-0.5 text-xs text-zinc-400">
                        {row.status === 'complete'
                            ? subtitle
                            : row.status === 'error'
                                ? (row.error || t('mediaPlayerPage.downloadError'))
                                : row.status === 'queued'
                                    ? `Waiting for the previous download${subtitle ? ` · ${subtitle}` : ''}`
                                    : (row.error ? row.error : `${t('mediaPlayerPage.downloadProgress', { percent: progress })}${subtitle ? ` · ${subtitle}` : ''}`)}
                    </p>
                    {mode === 'episode' && meta.summary && row.status === 'complete' ? (
                        <p className="mt-1 line-clamp-2 text-xs text-zinc-500">{meta.summary}</p>
                    ) : null}
                    {row.status === 'downloading' || row.status === 'queued' ? (
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                            <div
                                className="h-full rounded-full bg-progress transition-[width]"
                                style={{ width: `${Math.max(4, progress)}%` }}
                            />
                        </div>
                    ) : null}
                </div>
                <div className="flex shrink-0 flex-col gap-2">
                    {row.status === 'error' ? (
                        <button
                            type="button"
                            className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl bg-plex px-3 text-sm font-bold text-zinc-950"
                            onClick={() => void retry(row)}
                        >
                            <RotateCcw className="h-4 w-4" />
                            Retry
                        </button>
                    ) : null}
                    {row.status === 'complete' ? (
                        <button
                            type="button"
                            className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-plex text-zinc-950"
                            aria-label={t('mediaPlayerPage.homeHeroPlay')}
                            onClick={() => onPlay(toPlayerItem(row), { skipResume: true, offlineLocal: true })}
                        >
                            <Play className="h-4 w-4 fill-current" />
                        </button>
                    ) : null}
                    <button
                        type="button"
                        className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/15 bg-white/5 text-white"
                        aria-label={t('mediaPlayerPage.downloadRemove')}
                        onClick={() => void removeRows([row])}
                    >
                        <Trash2 className="h-4 w-4" />
                    </button>
                </div>
            </li>
        );
    };

    const posterCard = (opts: {
        key: string;
        cover: string;
        title: string;
        subtitle: string;
        fallback: React.ReactNode;
        progress?: number | null;
        failed?: boolean;
        onOpen: () => void;
        onRemove: () => void;
        onRetry?: () => void;
        openLabel: string;
    }) => (
        <li key={opts.key} className="relative min-w-0">
            <button
                type="button"
                onClick={opts.failed && opts.onRetry ? opts.onRetry : opts.onOpen}
                className="block w-full text-left"
                aria-label={opts.openLabel}
            >
                <div className="relative aspect-[2/3] w-full overflow-hidden rounded-xl border border-white/10 bg-black/40">
                    {opts.cover ? (
                        <RetryablePoster src={opts.cover} alt="" className="h-full w-full object-cover" />
                    ) : (
                        <div className="flex h-full items-center justify-center text-zinc-600">{opts.fallback}</div>
                    )}
                    {opts.progress != null ? (
                        <div className="absolute inset-x-0 bottom-0 bg-black/70 px-2 pb-2 pt-4">
                            <div className="h-1.5 overflow-hidden rounded-full bg-white/15">
                                <div className="h-full rounded-full bg-progress transition-[width]" style={{ width: `${Math.max(4, opts.progress)}%` }} />
                            </div>
                        </div>
                    ) : null}
                    {opts.failed ? (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/65 text-center">
                            <RotateCcw className="h-6 w-6 text-white" />
                            <span className="text-xs font-bold text-white">Retry</span>
                        </div>
                    ) : null}
                </div>
                <p className="mt-2 truncate text-sm font-bold text-white">{opts.title}</p>
                <p className="mt-0.5 truncate text-xs text-zinc-400">{opts.subtitle}</p>
            </button>
            <button
                type="button"
                className="absolute right-1.5 top-1.5 inline-flex h-8 w-8 items-center justify-center rounded-lg bg-black/60 text-white"
                aria-label={t('mediaPlayerPage.downloadRemove')}
                onClick={opts.onRemove}
            >
                <Trash2 className="h-4 w-4" />
            </button>
        </li>
    );

    const totalBytes = sumBytes(items);
    const title = group ? group.title : t('mediaPlayerPage.navDownloads');
    const hint = group
        ? [
            `${group.seasons.length} ${group.seasons.length === 1 ? 'season' : 'seasons'}`,
            `${group.rows.length} ${group.rows.length === 1 ? 'episode' : 'episodes'}`,
            formatBytes(group.bytes),
        ].filter(Boolean).join(' · ')
        : (items.length
            ? [
                shows.length ? `${shows.length} ${shows.length === 1 ? 'show' : 'shows'}` : '',
                movies.length ? `${movies.length} ${movies.length === 1 ? 'movie' : 'movies'}` : '',
                formatBytes(totalBytes),
            ].filter(Boolean).join(' · ')
            : t('mediaPlayerPage.downloadsHint'));
    const activeSeason = group ? (group.seasons.find((season) => season.index === openSeason) || group.seasons[0] || null) : null;
    const activeTab: 'tv' | 'movies' = tab === 'tv' && shows.length ? 'tv' : tab === 'movies' && movies.length ? 'movies' : (shows.length ? 'tv' : 'movies');
    const gridClass = 'grid grid-cols-3 gap-3';

    return (
        <div className="flex flex-col gap-5 pb-8 pt-5" data-tv-screen="1">
            <div className="flex items-center gap-3">
                <button
                    type="button"
                    onClick={group ? () => setOpenShow(null) : onBack}
                    className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-white/15 bg-white/5 text-white"
                    aria-label={t('common.back')}
                >
                    <ArrowLeft className="h-5 w-5" />
                </button>
                <div className="min-w-0 flex-1">
                    <h1 className={`${discoveryTheme.heading} truncate text-white`}>{title}</h1>
                    <p className="mt-1 text-sm text-zinc-400">{hint}</p>
                </div>
                {group ? (
                    <button
                        type="button"
                        className="inline-flex h-11 shrink-0 items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-3 text-sm font-semibold text-white"
                        onClick={() => void removeRows(group.rows)}
                    >
                        <Trash2 className="h-4 w-4" />
                        Remove all
                    </button>
                ) : null}
            </div>

            {loading ? (
                <div className="flex items-center gap-2 text-sm text-zinc-400">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t('mediaPlayerPage.loading')}
                </div>
            ) : !available ? (
                <div className={discoveryTheme.emptyState}>
                    <p className={discoveryTheme.emptyTitle}>{t('mediaPlayerPage.downloadsUnavailable')}</p>
                </div>
            ) : !items.length ? (
                <div className={discoveryTheme.emptyState}>
                    <Download className="mx-auto mb-3 h-8 w-8 text-zinc-500" />
                    <p className={discoveryTheme.emptyTitle}>{t('mediaPlayerPage.downloadsEmpty')}</p>
                    <p className={discoveryTheme.emptyBody}>{t('mediaPlayerPage.downloadsEmptyHint')}</p>
                </div>
            ) : group ? (
                <div className="flex flex-col gap-5">
                    {group.seasons.length > 1 ? (
                        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
                            {group.seasons.map((season) => {
                                const active = activeSeason?.index === season.index;
                                return (
                                    <button
                                        key={season.index}
                                        type="button"
                                        onClick={() => setOpenSeason(season.index)}
                                        className={`shrink-0 rounded-full border px-4 py-2 text-sm font-bold ${active
                                            ? 'border-plex bg-plex text-zinc-950'
                                            : 'border-white/15 bg-white/5 text-white'}`}
                                    >
                                        {season.title}
                                    </button>
                                );
                            })}
                        </div>
                    ) : null}
                    {activeSeason ? (
                        <section className="flex flex-col gap-3">
                            <div className="flex items-center justify-between gap-3">
                                <h2 className="text-base font-extrabold text-white">
                                    {activeSeason.title}
                                    <span className="ml-2 text-xs font-medium text-zinc-400">
                                        {activeSeason.rows.length} {activeSeason.rows.length === 1 ? 'episode' : 'episodes'}
                                        {sumBytes(activeSeason.rows) ? ` · ${formatBytes(sumBytes(activeSeason.rows))}` : ''}
                                    </span>
                                </h2>
                                <button
                                    type="button"
                                    className="text-xs font-semibold text-zinc-400 hover:text-white"
                                    onClick={() => void removeRows(activeSeason.rows)}
                                >
                                    Remove season
                                </button>
                            </div>
                            <ul className="flex flex-col gap-3">
                                {activeSeason.rows.map((row) => renderRow(row, 'episode'))}
                            </ul>
                        </section>
                    ) : null}
                </div>
            ) : (
                <div className="flex flex-col gap-5">
                    {shows.length && movies.length ? (
                        <div className="flex gap-2">
                            {([['tv', 'TV Shows', shows.length], ['movies', 'Movies', movies.length]] as const).map(([id, label, count]) => (
                                <button
                                    key={id}
                                    type="button"
                                    onClick={() => setTab(id)}
                                    className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-bold ${activeTab === id
                                        ? 'border-plex bg-plex text-zinc-950'
                                        : 'border-white/15 bg-white/5 text-white'}`}
                                >
                                    {id === 'tv' ? <Tv className="h-4 w-4" /> : <Film className="h-4 w-4" />}
                                    {label}
                                    <span className="text-xs opacity-70">{count}</span>
                                </button>
                            ))}
                        </div>
                    ) : null}
                    {activeTab === 'tv' ? (
                        <ul className={gridClass}>
                            {shows.map((entry) => {
                                const done = entry.rows.filter((row) => row.status === 'complete').length;
                                const active = entry.rows.length - done;
                                return posterCard({
                                    key: entry.key,
                                    cover: entry.cover,
                                    title: entry.title,
                                    subtitle: [
                                        `${done} ${done === 1 ? 'episode' : 'episodes'}`,
                                        active ? `${active} downloading` : '',
                                        formatBytes(entry.bytes),
                                    ].filter(Boolean).join(' · '),
                                    fallback: <Tv className="h-6 w-6" />,
                                    openLabel: entry.title,
                                    onOpen: () => { setOpenShow(entry.key); setOpenSeason(null); },
                                    onRemove: () => void removeRows(entry.rows),
                                });
                            })}
                        </ul>
                    ) : (
                        <ul className={gridClass}>
                            {movies.map((row) => {
                                const running = row.status === 'downloading' || row.status === 'queued';
                                const failed = row.status === 'error';
                                return posterCard({
                                    key: row.id,
                                    cover: thumbSrc(row),
                                    title: row.title,
                                    subtitle: failed
                                        ? (row.error || t('mediaPlayerPage.downloadError'))
                                        : running
                                            ? (row.error || t('mediaPlayerPage.downloadProgress', { percent: rowProgress(row) }))
                                            : [row.meta?.year ? String(row.meta.year) : '', row.meta?.quality || '', formatBytes(row.bytes)].filter(Boolean).join(' · '),
                                    fallback: <Film className="h-6 w-6" />,
                                    progress: running ? rowProgress(row) : null,
                                    failed,
                                    openLabel: row.title,
                                    onOpen: () => {
                                        if (row.status === 'complete') onPlay(toPlayerItem(row), { skipResume: true, offlineLocal: true });
                                    },
                                    onRetry: () => void retry(row),
                                    onRemove: () => void removeRows([row]),
                                });
                            })}
                        </ul>
                    )}
                </div>
            )}
        </div>
    );
};
