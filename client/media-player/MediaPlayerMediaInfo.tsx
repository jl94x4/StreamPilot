import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useDiscoverI18n } from './host';
import { formatBitrateMbps, formatBytes, formatClock, formatPlayerDuration } from './playerUtils';
import type { PlayerItem, PlayerMediaInfo, PlayerMediaPartInfo } from './types';

type Props = {
    item: PlayerItem;
    onClose: () => void;
};

const Cell: React.FC<{ label: string; value?: string | number | null }> = ({ label, value }) => {
    if (value == null || value === '') return null;
    return (
        <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-wider text-muted">{label}</div>
            <div className="break-words text-sm font-semibold text-text">{value}</div>
        </div>
    );
};

const partRows = (part: PlayerMediaPartInfo, media: PlayerMediaInfo, t: (key: string) => string) => {
    const video = part.video || {};
    const audio = part.audio?.[0] || {};
    return [
        { label: t('mediaPlayerPage.duration'), value: part.durationMs ? formatClock(part.durationMs) : (media.durationMs ? formatPlayerDuration(media.durationMs) : '') },
        { label: t('mediaPlayerPage.bitrate'), value: formatBitrateMbps(video.bitrate || media.bitrate) },
        { label: t('mediaPlayerPage.width'), value: video.width || media.width },
        { label: t('mediaPlayerPage.height'), value: video.height || media.height },
        { label: t('mediaPlayerPage.aspectRatio'), value: video.aspectRatio },
        { label: t('mediaPlayerPage.videoResolution'), value: video.resolution || media.videoResolution },
        { label: t('mediaPlayerPage.codec'), value: (video.codec || media.videoCodec || '').toUpperCase() },
        { label: t('mediaPlayerPage.language'), value: audio.language || audio.displayTitle },
        { label: t('mediaPlayerPage.languageTag'), value: audio.language },
        { label: t('mediaPlayerPage.bitDepth'), value: video.bitDepth },
        { label: t('mediaPlayerPage.chromaLocation'), value: video.chromaLocation },
        { label: t('mediaPlayerPage.codedHeight'), value: video.codedHeight },
        { label: t('mediaPlayerPage.container'), value: (part.container || media.container || '').toUpperCase() },
        { label: t('mediaPlayerPage.size'), value: formatBytes(part.size) },
        { label: t('mediaPlayerPage.part'), value: itemTitle(part, media) },
        { label: t('mediaPlayerPage.file'), value: part.fileName },
        { label: t('mediaPlayerPage.frameRate'), value: video.frameRate },
    ].filter((row) => row.value != null && row.value !== '');
};

const itemTitle = (part: PlayerMediaPartInfo, media: PlayerMediaInfo) => {
    const res = part.video?.resolution || media.videoResolution || '';
    const codec = part.video?.codec || media.videoCodec || '';
    const audio = part.audio?.[0];
    return [res, codec, audio?.codec, audio?.language].filter(Boolean).join(' · ');
};

export const MediaPlayerMediaInfo: React.FC<Props> = ({ item, onClose }) => {
    const { t } = useDiscoverI18n();
    const files = (item.mediaInfo || []).flatMap((media) => media.parts.map((part) => ({ media, part })));

    useEffect(() => {
        const previous = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = previous;
        };
    }, []);

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        const onOverlayClose = () => onClose();
        window.addEventListener('keydown', onKey);
        window.addEventListener('smp-tv-overlay-close', onOverlayClose);
        return () => {
            window.removeEventListener('keydown', onKey);
            window.removeEventListener('smp-tv-overlay-close', onOverlayClose);
        };
    }, [onClose]);

    const overlay = (
        <div
            className="fixed inset-0 z-[3500] flex items-stretch justify-center bg-black/85 overscroll-none sm:items-center sm:bg-black/70 sm:p-4"
            style={{
                top: 0,
                right: 0,
                bottom: 0,
                left: 0,
                width: '100%',
                minHeight: '100dvh',
                height: '100dvh',
            }}
            role="dialog"
            aria-modal="true"
            data-tv-select-menu="1"
            aria-label={t('mediaPlayerPage.mediaInfo')}
        >
            <button
                type="button"
                className="absolute inset-0 hidden sm:block"
                aria-label={t('common.close')}
                onClick={onClose}
            />
            <div
                className="player-popup-surface relative z-10 flex h-full w-full max-w-3xl flex-col overflow-hidden border-0 shadow-2xl sm:h-auto sm:max-h-[min(90dvh,90vh)] sm:rounded-2xl sm:border sm:border-border"
                style={{
                    paddingTop: 'env(safe-area-inset-top, 0px)',
                    paddingBottom: 'env(safe-area-inset-bottom, 0px)',
                }}
            >
                <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-5 py-4">
                    <div className="min-w-0">
                        <p className="truncate text-[10px] font-black uppercase tracking-[0.25em] text-plex">{item.title}</p>
                        <h2 className="text-lg font-black text-text">{t('mediaPlayerPage.mediaInfo')}</h2>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="shrink-0 rounded-full bg-white/5 p-2 text-muted hover:bg-white/10 hover:text-text"
                        aria-label={t('common.close')}
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
                    {files.length ? (
                        <div className="mb-5">
                            <h3 className="mb-2 text-[10px] font-black uppercase tracking-[0.2em] text-muted">{t('mediaPlayerPage.files')}</h3>
                            <ul className="flex flex-col gap-2">
                                {files.map(({ part }) => (
                                    <li key={part.id} className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-semibold text-text">
                                        {part.fileName || t('mediaPlayerPage.file')}
                                        {part.size ? <span className="ml-2 text-xs font-bold text-muted">{formatBytes(part.size)}</span> : null}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ) : null}
                    {files.map(({ media, part }) => (
                        <div key={`${media.id}-${part.id}`} className="mb-5 grid grid-cols-1 gap-3 last:mb-0 sm:grid-cols-3">
                            {partRows(part, media, t).map((row) => (
                                <Cell key={row.label} label={row.label} value={row.value} />
                            ))}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
    if (typeof document === 'undefined') return null;
    return createPortal(overlay, document.body);
};
