import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Download, Loader2, Play, Trash2 } from 'lucide-react';
import { discoveryTheme, useDiscoverI18n } from './host';
import { RetryablePoster } from '../shared/RetryablePoster';
import {
    deleteMediaDownload,
    listMediaDownloads,
    mediaDownloadsAvailable,
    onMediaDownloadChange,
    type MediaDownloadItem,
} from '../plex-client/mediaDownloads';
import { portalUrl } from '../shared/basePath';
import type { PlayerItem, PlayerPlayOptions } from './types';

type Props = {
    onBack: () => void;
    onPlay: (item: PlayerItem, opts?: PlayerPlayOptions) => void;
    onToast?: (message: string, type?: 'success' | 'error' | 'info') => void;
};

const toPlayerItem = (row: MediaDownloadItem): PlayerItem => ({
    ratingKey: row.ratingKey,
    title: row.title || 'Download',
    type: (row.type as PlayerItem['type']) || 'movie',
    thumb: row.thumbUrl || null,
    serverId: row.serverId || '',
    plexGuid: row.plexGuid || null,
    canPlay: true,
    durationMs: 0,
    viewOffsetMs: 0,
});

const formatBytes = (value?: number) => {
    const n = Number(value) || 0;
    if (n <= 0) return '';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
    return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

export const MediaPlayerDownloads: React.FC<Props> = ({ onBack, onPlay, onToast }) => {
    const { t } = useDiscoverI18n();
    const [items, setItems] = useState<MediaDownloadItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [available, setAvailable] = useState(true);

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

    const remove = async (row: MediaDownloadItem) => {
        try {
            await deleteMediaDownload({ id: row.id, ratingKey: row.ratingKey });
            setItems((prev) => prev.filter((item) => item.id !== row.id));
            onToast?.(t('mediaPlayerPage.downloadRemoved'), 'success');
        } catch {
            onToast?.(t('mediaPlayerPage.downloadError'), 'error');
        }
    };

    return (
        <div className="flex flex-col gap-5 pb-8" data-tv-screen="1">
            <div className="flex items-center gap-3">
                <button
                    type="button"
                    onClick={onBack}
                    className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-white/15 bg-white/5 text-white"
                    aria-label={t('common.back')}
                >
                    <ArrowLeft className="h-5 w-5" />
                </button>
                <div className="min-w-0">
                    <h1 className={`${discoveryTheme.heading} text-white`}>{t('mediaPlayerPage.navDownloads')}</h1>
                    <p className="mt-1 text-sm text-zinc-400">{t('mediaPlayerPage.downloadsHint')}</p>
                </div>
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
            ) : (
                <ul className="flex flex-col gap-3">
                    {items.map((row) => {
                        const progress = row.totalBytes && row.bytes
                            ? Math.min(100, Math.round((Number(row.bytes) / Number(row.totalBytes)) * 100))
                            : (row.status === 'complete' ? 100 : 0);
                        const thumb = row.thumbUrl || row.thumbPath || '';
                        const sizeLabel = row.status === 'complete'
                            ? formatBytes(row.bytes)
                            : (row.totalBytes
                                ? `${formatBytes(row.bytes)} / ${formatBytes(row.totalBytes)}`
                                : formatBytes(row.bytes));
                        return (
                            <li
                                key={row.id}
                                className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3"
                            >
                                <div className="h-20 w-14 shrink-0 overflow-hidden rounded-lg bg-black/40">
                                    {thumb ? (
                                        <RetryablePoster
                                            src={/^https?:|^file:|^content:/i.test(thumb) ? thumb : portalUrl(thumb)}
                                            alt=""
                                            className="h-full w-full object-cover"
                                        />
                                    ) : (
                                        <div className="flex h-full items-center justify-center text-zinc-600">
                                            <Download className="h-5 w-5" />
                                        </div>
                                    )}
                                </div>
                                <div className="min-w-0 flex-1">
                                    <p className="truncate text-sm font-bold text-white">{row.title}</p>
                                    <p className="mt-0.5 text-xs text-zinc-400">
                                        {row.status === 'complete'
                                            ? t('mediaPlayerPage.downloadReady')
                                            : row.status === 'error'
                                                ? (row.error || t('mediaPlayerPage.downloadError'))
                                                : t('mediaPlayerPage.downloadProgress', { percent: progress })}
                                        {sizeLabel ? ` · ${sizeLabel}` : ''}
                                    </p>
                                    {row.status === 'downloading' || row.status === 'queued' ? (
                                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                                            <div
                                                className="h-full rounded-full bg-plex transition-[width]"
                                                style={{ width: `${Math.max(4, progress)}%` }}
                                            />
                                        </div>
                                    ) : null}
                                </div>
                                <div className="flex shrink-0 flex-col gap-2">
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
                                        onClick={() => void remove(row)}
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </button>
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
};
