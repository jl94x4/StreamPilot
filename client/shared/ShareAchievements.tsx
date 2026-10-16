import React, { useCallback, useRef, useState } from 'react';
import { X, Copy, Download, Share2 } from 'lucide-react';
import html2canvas from 'html2canvas';
import { getPublicOrigin } from './basePath';
import { tAchievements, useAchievementsI18n } from '../achievements/i18n';

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

export const buildAchievementsShareText = (me: any, serverName: string, rank?: number | null, translate = tAchievements) => {
    const recent = Array.isArray(me?.recentEarned) ? me.recentEarned.slice(0, 5) : [];
    const origin = typeof window !== 'undefined' ? window.location.origin : getPublicOrigin();
    const lines = [
        `🏆 ${translate('share.textTitle', { serverName })}`,
        me?.username ? `👤 ${me.username}` : '',
        '',
        `⭐ ${translate('share.textLevelXp', { level: me?.level || 1, xp: (Number(me?.xp) || 0).toLocaleString() })}`,
        rank ? `🏅 ${translate('share.textRank', { rank })}` : '',
        `🎖️ ${translate('dossier.badgeCount', { earned: me?.earnedCount || 0, total: me?.totalBadges || 0 })}`,
        recent.length
            ? `✨ ${translate('share.textRecent', { names: recent.map((b: any) => b?.name).filter(Boolean).join(', ') })}`
            : '',
        '',
        translate('share.textSharedFrom', { origin }),
    ].filter(Boolean);
    return lines.join('\n');
};

type Props = {
    me: any;
    serverName: string;
    rank?: number | null;
    onClose: () => void;
    onToast?: (message: string, type: 'success' | 'error') => void;
};

export const ShareAchievementsModal: React.FC<Props> = ({
    me,
    serverName,
    rank = null,
    onClose,
    onToast,
}) => {
    const { tAchievements } = useAchievementsI18n();
    const exportRef = useRef<HTMLDivElement>(null);
    const [busy, setBusy] = useState<'copy' | 'download' | 'share' | null>(null);
    const lp = me?.levelProgress || {};
    const recent = Array.isArray(me?.recentEarned) ? me.recentEarned.slice(0, 6) : [];

    const renderExportBlob = useCallback(async (): Promise<Blob | null> => {
        const node = exportRef.current;
        if (!node) return null;
        const prevWidth = node.style.width;
        const prevMaxWidth = node.style.maxWidth;
        node.style.width = `${EXPORT_WIDTH_PX}px`;
        node.style.maxWidth = 'none';
        try {
            if (document.fonts?.ready) await document.fonts.ready;
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
            await navigator.clipboard.writeText(buildAchievementsShareText(me, serverName, rank, tAchievements));
            onToast?.(tAchievements('share.copied'), 'success');
        } catch {
            onToast?.(tAchievements('share.copyFailed'), 'error');
        } finally {
            setBusy(null);
        }
    };

    const handleDownload = async () => {
        setBusy('download');
        try {
            const blob = await renderExportBlob();
            if (!blob) {
                onToast?.(tAchievements('share.imageFailed'), 'error');
                return;
            }
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `achievements-${String(serverName || 'portal').replace(/\s+/g, '-').toLowerCase()}.png`;
            a.click();
            URL.revokeObjectURL(url);
            onToast?.(tAchievements('share.downloaded'), 'success');
        } catch {
            onToast?.(tAchievements('share.imageFailed'), 'error');
        } finally {
            setBusy(null);
        }
    };

    const handleShare = async () => {
        setBusy('share');
        const text = buildAchievementsShareText(me, serverName, rank, tAchievements);
        try {
            if (!navigator.share) {
                await navigator.clipboard.writeText(text);
                onToast?.(tAchievements('share.copied'), 'success');
                return;
            }
            const blob = await renderExportBlob();
            if (blob) {
                const file = new File([blob], 'achievements.png', { type: 'image/png' });
                if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
                    await navigator.share({ title: tAchievements('share.textTitle', { serverName }), files: [file] });
                    onToast?.(tAchievements('share.shared'), 'success');
                    return;
                }
            }
            await navigator.share({ title: tAchievements('share.textTitle', { serverName }), text });
            onToast?.(tAchievements('share.shared'), 'success');
        } catch (e) {
            if ((e as Error)?.name === 'AbortError') return;
            try {
                await navigator.clipboard.writeText(text);
                onToast?.(tAchievements('share.copied'), 'success');
            } catch {
                onToast?.(tAchievements('share.copyFailed'), 'error');
            }
        } finally {
            setBusy(null);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 md:p-4 bg-black/80 backdrop-blur-sm" onClick={onClose}>
            <div className="glass-card shadow-2xl w-[calc(100vw-1.5rem)] max-w-[720px] p-5 md:p-6 relative max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
                <button type="button" onClick={onClose} aria-label={tAchievements('common.close')} className="absolute top-4 right-4 p-2 rounded-full hover:bg-white/10 text-muted hover:text-text transition-colors z-10">
                    <X className="w-5 h-5" />
                </button>
                <h3 className="text-xl font-bold text-text mb-1 pr-10">{tAchievements('share.title')}</h3>
                <p className="text-muted text-sm mb-4">{tAchievements('share.subtitle')}</p>

                <div className="overflow-y-auto overflow-x-hidden flex-1 min-h-0 custom-scrollbar mb-4">
                    <div
                        ref={exportRef}
                        className="rounded-2xl border border-white/10 bg-[#0d0e10] p-6 space-y-5"
                        style={{ width: '100%' }}
                    >
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <p className="text-[10px] uppercase tracking-[0.28em] text-plex font-bold">{serverName}</p>
                                <h4 className="text-2xl font-black text-white mt-1">{tAchievements('page.level', { level: me?.level || 1 })}</h4>
                                <p className="text-sm text-white/60 font-mono mt-1">
                                    {(Number(me?.xp) || 0).toLocaleString()} XP
                                    {rank ? ` · #${rank}` : ''}
                                </p>
                            </div>
                            <div className="text-right">
                                <p className="text-3xl font-black text-plex font-mono">{me?.earnedCount || 0}</p>
                                <p className="text-[11px] text-white/50 uppercase tracking-widest">{tAchievements('share.badgesLabel')}</p>
                            </div>
                        </div>
                        <div className="h-2.5 rounded-full bg-white/10 overflow-hidden">
                            <div className="h-full rounded-full bg-plex" style={{ width: `${Math.min(100, Number(lp.progressPct) || 0)}%` }} />
                        </div>
                        {recent.length > 0 && (
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                {recent.map((badge: any) => (
                                    <div key={badge.id} className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 flex items-center gap-2 min-w-0">
                                        <span className="text-lg shrink-0">{badge.icon || '🏅'}</span>
                                        <span className="text-xs font-semibold text-white truncate">{badge.name}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                <div className="flex flex-wrap gap-2">
                    <button type="button" disabled={!!busy} onClick={() => { void handleCopyText(); }} className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-border text-sm font-semibold hover:border-plex/40 disabled:opacity-50">
                        <Copy className="w-4 h-4" /> {tAchievements('share.copy')}
                    </button>
                    <button type="button" disabled={!!busy} onClick={() => { void handleDownload(); }} className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-border text-sm font-semibold hover:border-plex/40 disabled:opacity-50">
                        <Download className="w-4 h-4" /> {tAchievements('share.download')}
                    </button>
                    <button type="button" disabled={!!busy} onClick={() => { void handleShare(); }} className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-plex text-white text-sm font-semibold disabled:opacity-50">
                        <Share2 className="w-4 h-4" /> {tAchievements('share.share')}
                    </button>
                </div>
            </div>
        </div>
    );
};
