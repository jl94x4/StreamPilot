import React, { useCallback, useEffect, useRef, useState } from 'react';
import { X, Copy, Download, Share2 } from 'lucide-react';
import html2canvas from 'html2canvas';
import { WrapUpCardGrid, periodLabel, isYearInReviewPeriod, wrapUpPriorPeriodLabel, formatWrapUpDelta } from './WrapUpCards';
import { formatStreamingHour } from './format';
import { getPublicOrigin } from './basePath';
import { createDiscoverTranslate, useDiscoverI18n } from '../discovery/i18n';
import type { DiscoverTranslate } from '../discovery/i18n/types';
import { lockBackgroundScroll } from './lockBackgroundScroll';

const EXPORT_WIDTH_PX = 1080;

const waitForExportImages = (root: HTMLElement) => Promise.all(
    Array.from(root.querySelectorAll('img')).map((img) => {
        if (img.complete && img.naturalWidth > 0) return Promise.resolve();
        return new Promise<void>((resolve) => {
            const done = () => resolve();
            img.addEventListener('load', done, { once: true });
            img.addEventListener('error', done, { once: true });
        });
    }),
);

export const buildWrapUpShareText = (analytics: any, days: number | string, serverName: string, username?: string, t?: DiscoverTranslate) => {
    const translate = t || createDiscoverTranslate('en');
    const period = periodLabel(days, translate);
    const yearInReview = isYearInReviewPeriod(days);
    const compareDelta = formatWrapUpDelta(analytics?.compare?.totalPlays, translate);
    const comparePeriod = wrapUpPriorPeriodLabel(analytics?.compare?.previousPeriodDays || days, translate);
    const leaderboardRank = Number(analytics?.leaderboardRank);
    const hasRank = Number.isFinite(leaderboardRank) && leaderboardRank > 0;
    const rank = hasRank
        ? translate('wrapUp.rankOfUsers', { rank: `#${leaderboardRank}`, total: analytics.totalActiveUsers || '?' })
        : translate('wrapUp.notRankedYet');
    const dayCounts = Object.values(analytics?.dayOfWeekCounts || {})
        .map((value) => Number(value) || 0)
        .filter((value) => Number.isFinite(value));
    const topDayStreams = dayCounts.length > 0 ? Math.max(...dayCounts) : 0;

    const lines = [
        `📊 ${yearInReview ? translate('wrapUp.shareYearTitle', { serverName }) : translate('wrapUp.shareTitle', { serverName })} (${period})`,
        username ? `👤 ${username}` : '',
        '',
        `🏆 ${translate('wrapUp.serverRank')}: ${rank}`,
        `▶️ ${translate('wrapUp.totalStreams')}: ${analytics.totalPlays || 0} (🎬 ${analytics.moviesCount || 0} · 📺 ${analytics.showsCount || 0}${analytics.musicCount ? ` · 🎵 ${analytics.musicCount}` : ''})`,
        ...(compareDelta ? [`📈 ${translate('wrapUp.vsPrior', { delta: compareDelta, period: comparePeriod })}`] : []),
        `📺 ${translate('wrapUp.topBinge')}: ${analytics.topBinge?.title || '—'} (${translate('wrapUp.episodePlays', { count: analytics.topBinge?.plays || 0 })})${analytics?.compare?.swaps?.topBinge?.from?.title ? ` (${translate('wrapUp.wasTitle', { title: analytics.compare.swaps.topBinge.from.title })})` : ''}`,
        `🎬 ${translate('wrapUp.topMovie')}: ${analytics.topMovie?.title || '—'} (${translate('wrapUp.plays', { count: analytics.topMovie?.plays || 0 })})${analytics?.compare?.swaps?.topMovie?.from?.title ? ` (${translate('wrapUp.wasTitle', { title: analytics.compare.swaps.topMovie.from.title })})` : ''}`,
        `🕐 ${translate('wrapUp.timeOfDay')}: ${analytics.timeOfDay || '—'} (${translate('wrapUp.peakTime', { time: formatStreamingHour(analytics.peakHour ?? analytics.avgHour) })})`,
        `📅 ${translate('wrapUp.topDay')}: ${analytics.popularDay || '—'} (${translate('wrapUp.streamsCount', { count: topDayStreams })})`,
        `📚 ${translate('wrapUp.topLibrary')}: ${analytics.favoriteLibrary || '—'} (${translate('wrapUp.plays', { count: analytics.topLibraries?.[0]?.plays || 0 })})`,
        `🎭 ${translate('wrapUp.mediaProfile')}: ${analytics.mediaPreference || '—'}`,
        `🧭 ${translate('wrapUp.watchStyle')}: ${analytics.watchStyle || '—'} (${translate('wrapUp.uniqueTitles', { count: analytics.uniqueTitles || 0 })})`,
        `☕ ${translate('wrapUp.streamingHabit')}: ${analytics.streamingHabit || '—'} (${translate('wrapUp.weekdayWeekendPlays', { weekday: analytics.weekdayPlays || 0, weekend: analytics.weekendPlays || 0 })})`,
        '',
        translate('wrapUp.sharedFrom', { origin: window.location.origin }),
    ].filter(Boolean);
    return lines.join('\n');
};

type ShareWrapUpModalProps = {
    analytics: any;
    days: number | string;
    serverName: string;
    username?: string;
    onClose: () => void;
    onToast?: (message: string, type: 'success' | 'error') => void;
};

export const ShareWrapUpModal: React.FC<ShareWrapUpModalProps> = ({
    analytics,
    days,
    serverName,
    username,
    onClose,
    onToast,
}) => {
    const { t } = useDiscoverI18n();
    const exportRef = useRef<HTMLDivElement>(null);
    const [busy, setBusy] = useState<'copy' | 'download' | 'share' | null>(null);
    useEffect(() => lockBackgroundScroll(), []);
    const period = periodLabel(days, t);
    const yearInReview = isYearInReviewPeriod(days);
    const compareDelta = formatWrapUpDelta(analytics?.compare?.totalPlays, t);
    const comparePeriod = wrapUpPriorPeriodLabel(analytics?.compare?.previousPeriodDays || days, t);

    const leaderboardRank = Number(analytics?.leaderboardRank);
    const hasRank = Number.isFinite(leaderboardRank) && leaderboardRank > 0;
    const rankPct = hasRank && analytics.totalActiveUsers > 0
        ? Math.max(1, Math.round((leaderboardRank / analytics.totalActiveUsers) * 100))
        : null;

    const renderExportBlob = useCallback(async (): Promise<Blob | null> => {
        const node = exportRef.current;
        if (!node) return null;

        const prevWidth = node.style.width;
        const prevMaxWidth = node.style.maxWidth;
        node.style.width = `${EXPORT_WIDTH_PX}px`;
        node.style.maxWidth = 'none';

        try {
            if (document.fonts?.ready) {
                await document.fonts.ready;
            }
            await waitForExportImages(node);
            await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

            const canvas = await html2canvas(node, {
                useCORS: true,
                allowTaint: true,
                backgroundColor: '#0d0e10',
                scale: 2,
                logging: false,
                scrollX: 0,
                scrollY: -window.scrollY,
                width: node.scrollWidth,
                height: node.scrollHeight,
                onclone: (clonedDoc, clonedNode) => {
                    const exportRoot = clonedNode as HTMLElement;
                    exportRoot.style.overflow = 'visible';
                    exportRoot.style.width = `${EXPORT_WIDTH_PX}px`;
                    exportRoot.style.maxWidth = 'none';
                    exportRoot.style.paddingBottom = '1.5rem';

                    exportRoot.querySelectorAll('[data-wrap-up-export-grid]').forEach((node) => {
                        const el = node as HTMLElement;
                        el.style.display = 'grid';
                        el.style.gridTemplateColumns = 'repeat(5, minmax(0, 1fr))';
                        el.style.gap = '12px';
                    });
                    exportRoot.querySelectorAll('[data-wrap-up-card]').forEach((card) => {
                        const el = card as HTMLElement;
                        el.style.isolation = 'isolate';
                        el.style.overflow = 'visible';
                        el.style.minHeight = '128px';
                    });
                    clonedDoc.querySelectorAll('svg').forEach((svg) => {
                        const el = svg as SVGElement;
                        el.style.overflow = 'hidden';
                        el.setAttribute('overflow', 'hidden');
                    });
                    clonedDoc.querySelectorAll('[class*="line-clamp"]').forEach((el) => {
                        const node = el as HTMLElement;
                        node.style.display = 'block';
                        node.style.overflow = 'visible';
                        node.style.webkitLineClamp = 'unset';
                        node.style.lineHeight = '1.35';
                    });
                },
            });
            return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
        } finally {
            node.style.width = prevWidth;
            node.style.maxWidth = prevMaxWidth;
        }
    }, []);

    const handleCopyText = async () => {
        setBusy('copy');
        try {
            await navigator.clipboard.writeText(buildWrapUpShareText(analytics, days, serverName, username, t));
            onToast?.(t('wrapUp.copySuccess'), 'success');
        } catch {
            onToast?.(t('wrapUp.copyFailed'), 'error');
        } finally {
            setBusy(null);
        }
    };

    const handleDownload = async () => {
        setBusy('download');
        try {
            const blob = await renderExportBlob();
            if (!blob) {
                onToast?.(t('wrapUp.imageFailed'), 'error');
                return;
            }
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `wrap-up-${serverName.replace(/\s+/g, '-').toLowerCase()}.png`;
            a.click();
            URL.revokeObjectURL(url);
            onToast?.(t('wrapUp.imageDownloaded'), 'success');
        } catch {
            onToast?.(t('wrapUp.imageFailed'), 'error');
        } finally {
            setBusy(null);
        }
    };

    const handleShare = async () => {
        setBusy('share');
        const text = buildWrapUpShareText(analytics, days, serverName, username, t);

        try {
            if (!navigator.share) {
                await navigator.clipboard.writeText(text);
                onToast?.(t('wrapUp.shareUnsupportedCopied'), 'success');
                return;
            }

            const blob = await renderExportBlob();
            if (blob) {
                const file = new File([blob], 'wrap-up.png', { type: 'image/png' });
                if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
                    await navigator.share({
                        title: t('wrapUp.shareTitle', { serverName }),
                        files: [file],
                    });
                    onToast?.(t('wrapUp.shareSuccess'), 'success');
                    return;
                }
            }

            await navigator.share({
                title: yearInReview
                    ? t('wrapUp.shareYearTitle', { serverName })
                    : t('wrapUp.shareTitle', { serverName }),
                text,
            });
            onToast?.(t('wrapUp.shareSuccess'), 'success');
        } catch (e) {
            const err = e as Error;
            if (err.name === 'AbortError') return;
            try {
                await navigator.clipboard.writeText(text);
                onToast?.(t('wrapUp.shareSheetCopied'), 'success');
            } catch {
                onToast?.(t('wrapUp.shareFailed'), 'error');
            }
        } finally {
            setBusy(null);
        }
    };

    return (
        <div className="fixed inset-0 z-[350] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/80 backdrop-blur-sm" onClick={onClose}>
            <div className="glass-card shadow-2xl w-full sm:w-[calc(100vw-2rem)] max-w-[1080px] rounded-t-3xl sm:rounded-2xl p-4 sm:p-6 relative max-h-[min(96dvh,100svh)] sm:max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
                <button type="button" onClick={onClose} className="absolute top-3 right-3 sm:top-4 sm:right-4 p-2 rounded-full hover:bg-white/10 text-muted hover:text-text transition-colors z-10">
                    <X className="w-5 h-5" />
                </button>

                <h3 className="text-lg sm:text-xl font-bold text-text mb-1 pr-12">{yearInReview ? t('wrapUp.yearInReview') : t('wrapUp.shareModalTitle')}</h3>
                <p className="text-muted text-sm mb-4 pr-4 leading-relaxed">{yearInReview ? t('wrapUp.yearInReviewHint') : t('wrapUp.shareModalSubtitle')}</p>

                <div className="overflow-y-auto overflow-x-hidden flex-1 min-h-0 custom-scrollbar mb-4 space-y-4">
                    <div
                        ref={exportRef}
                        className="w-full rounded-2xl border border-white/10 bg-[#0d0e10] p-4 sm:p-5 pb-6 overflow-visible"
                    >
                        <div className="mb-4 pb-3 border-b border-white/10">
                            <p className="text-[10px] uppercase tracking-[0.2em] font-bold text-plex mb-1">{yearInReview ? t('wrapUp.yearInReview') : t('wrapUp.title')}</p>
                            <h4 className="text-xl sm:text-2xl font-black text-white leading-tight">{serverName}</h4>
                            <p className="text-sm text-muted mt-1.5">
                                {period}
                                {username ? ` · ${username}` : ''}
                            </p>
                            {compareDelta ? (
                                <p className="text-xs font-bold text-plex mt-1.5">{t('wrapUp.vsPrior', { delta: compareDelta, period: comparePeriod })}</p>
                            ) : null}
                        </div>

                        <WrapUpCardGrid analytics={analytics} variant="export" />

                        <p className="text-[10px] text-muted/70 mt-5 leading-normal break-all">{getPublicOrigin()}</p>
                    </div>

                    <div className="rounded-xl border border-border/50 bg-background/40 p-4 text-sm space-y-3">
                        <p className="font-bold text-text">{t('wrapUp.fullStatsSummary')}</p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2.5 text-muted">
                            <p><span className="text-text font-semibold">{t('wrapUp.serverRank')}:</span> {hasRank ? `#${leaderboardRank}` : t('wrapUp.notRankedYet')}{rankPct ? ` (${t('wrapUp.topPct', { pct: rankPct })})` : ''}</p>
                            <p><span className="text-text font-semibold">{t('wrapUp.totalStreams')}:</span> {analytics.totalPlays || 0} {t('wrapUp.total')}{compareDelta ? ` · ${t('wrapUp.vsPrior', { delta: compareDelta, period: comparePeriod })}` : ''}</p>
                            <p><span className="text-text font-semibold">{t('wrapUp.moviesTv')}:</span> {analytics.moviesCount || 0} / {analytics.showsCount || 0}</p>
                            <p><span className="text-text font-semibold">{t('wrapUp.topBinge')}:</span> {analytics.topBinge?.title || '—'}</p>
                            <p><span className="text-text font-semibold">{t('wrapUp.topMovie')}:</span> {analytics.topMovie?.title || '—'}</p>
                            <p><span className="text-text font-semibold">{t('wrapUp.timeOfDay')}:</span> {analytics.timeOfDay || '—'}</p>
                            <p><span className="text-text font-semibold">{t('wrapUp.topDay')}:</span> {analytics.popularDay || '—'}</p>
                            <p><span className="text-text font-semibold">{t('wrapUp.topLibrary')}:</span> {analytics.favoriteLibrary || '—'}</p>
                            <p><span className="text-text font-semibold">{t('wrapUp.mediaProfile')}:</span> {analytics.mediaPreference || '—'}</p>
                            <p><span className="text-text font-semibold">{t('wrapUp.watchStyle')}:</span> {analytics.watchStyle || '—'}</p>
                            <p className="sm:col-span-2"><span className="text-text font-semibold">{t('wrapUp.streamingHabit')}:</span> {analytics.streamingHabit || '—'} · {t('wrapUp.weekdayWeekendPlays', { weekday: analytics.weekdayPlays || 0, weekend: analytics.weekendPlays || 0 })}</p>
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 sm:gap-3 flex-shrink-0 pb-[max(0px,env(safe-area-inset-bottom))]">
                    <button type="button" onClick={handleCopyText} disabled={!!busy}
                        className="flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-white/5 border border-border hover:border-plex/50 font-bold text-sm transition-colors disabled:opacity-50">
                        <Copy className="w-4 h-4" /> {busy === 'copy' ? t('wrapUp.copying') : t('wrapUp.copyText')}
                    </button>
                    <button type="button" onClick={handleDownload} disabled={!!busy}
                        className="flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-white/5 border border-border hover:border-plex/50 font-bold text-sm transition-colors disabled:opacity-50">
                        <Download className="w-4 h-4" /> {busy === 'download' ? t('wrapUp.saving') : t('wrapUp.saveImage')}
                    </button>
                    <button type="button" onClick={handleShare} disabled={!!busy}
                        className="flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-plex text-background font-bold text-sm hover:bg-plex-hover transition-colors disabled:opacity-50">
                        <Share2 className="w-4 h-4" /> {busy === 'share' ? t('wrapUp.sharing') : t('wrapUp.share')}
                    </button>
                </div>
            </div>
        </div>
    );
};
