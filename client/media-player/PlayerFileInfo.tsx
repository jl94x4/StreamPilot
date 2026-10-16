import React, { useEffect, useMemo } from 'react';
import { X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useDiscoverI18n } from './host';
import { formatBitrateMbps, formatBytes, formatMediaAudioLine, formatMediaVideoLine, plexImageUrl } from './playerUtils';
import type { PlayerItem, PlayerMediaInfo, PlayerMediaPartInfo, PlayerMediaStreamInfo } from './types';

type Props = {
    item: PlayerItem;
    loading?: boolean;
    mediaIndex?: number;
    audioStreamId?: string;
    onClose: () => void;
};

const formatMbps = (bitrate?: number | null) => formatBitrateMbps(bitrate).replace(/\.0 Mbps$/, ' Mbps');

const formatRelease = (value?: string | null) => {
    const raw = String(value || '').trim();
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
    if (!match) return raw;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    if (Number.isNaN(date.getTime())) return raw;
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

const selectedAudioFirst = (part: PlayerMediaPartInfo, audioStreamId?: string) => {
    const rows = [...(part.audio || [])];
    const wanted = String(audioStreamId || '').replace(/\D/g, '');
    rows.sort((a, b) => {
        const aOn = (wanted && String(a.id || '') === wanted) || (!wanted && a.selected) ? 1 : 0;
        const bOn = (wanted && String(b.id || '') === wanted) || (!wanted && b.selected) ? 1 : 0;
        return bOn - aOn;
    });
    return rows;
};

const isSelectedAudio = (audio: PlayerMediaStreamInfo, audioStreamId: string | undefined, part: PlayerMediaPartInfo) => {
    const wanted = String(audioStreamId || '').replace(/\D/g, '');
    if (wanted) return String(audio.id || '') === wanted;
    if (audio.selected) return true;
    return (part.audio || []).length === 1;
};

export const PlayerFileInfo: React.FC<Props> = ({
    item,
    loading = false,
    mediaIndex = 0,
    audioStreamId = '',
    onClose,
}) => {
    const { t } = useDiscoverI18n();
    const art = item.art ? plexImageUrl(item.art, 1280, 720, { quality: 40 }) : '';
    const files = useMemo(() => {
        const mediaInfo = item.mediaInfo || [];
        const media = mediaInfo[Math.min(Math.max(0, mediaIndex), Math.max(0, mediaInfo.length - 1))] || mediaInfo[0];
        if (!media) return [] as { media: PlayerMediaInfo; part: PlayerMediaPartInfo }[];
        const parts = media.parts?.length ? media.parts : [];
        return parts.map((part) => ({ media, part }));
    }, [item.mediaInfo, mediaIndex]);
    const released = formatRelease(item.originallyAvailableAt);

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        const onOverlayClose = () => onClose();
        window.addEventListener('keydown', onKey);
        window.addEventListener('smp-tv-overlay-close', onOverlayClose);
        const id = window.requestAnimationFrame(() => {
            document.querySelector<HTMLElement>('[data-tv-file-info-close="1"]')?.focus({ preventScroll: true });
        });
        return () => {
            window.cancelAnimationFrame(id);
            window.removeEventListener('keydown', onKey);
            window.removeEventListener('smp-tv-overlay-close', onOverlayClose);
        };
    }, [onClose]);

    const overlay = (
        <div
            className="fixed inset-0 z-[3600] flex items-center justify-center"
            role="dialog"
            aria-modal="true"
            data-tv-select-menu="1"
            data-tv-file-info="1"
            aria-label={t('mediaPlayerPage.fileInfo')}
        >
            <div
                className="pointer-events-none absolute inset-0 bg-black/40 backdrop-blur-3xl"
                data-tv-file-info-frost="1"
                aria-hidden
            />
            {art ? (
                <img
                    src={art}
                    alt=""
                    data-tv-file-info-art="1"
                    className="pointer-events-none absolute inset-0 h-full w-full scale-[1.85] object-cover opacity-55 blur-[180px]"
                />
            ) : (
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,#5b3cc4_0%,transparent_42%),radial-gradient(circle_at_80%_80%,#1d4ed8_0%,#0b1020_55%)]" />
            )}
            <button
                type="button"
                className="absolute inset-0 bg-black/55"
                aria-label={t('common.close')}
                onClick={onClose}
            />
            <button
                type="button"
                data-tv-item="1"
                data-tv-file-info-close="1"
                onClick={onClose}
                className="absolute right-6 top-6 z-20 rounded-full bg-black/50 p-2 text-white hover:bg-black/70"
                aria-label={t('common.close')}
            >
                <X className="h-6 w-6" />
            </button>
            <div
                className="relative z-10 mx-auto flex max-h-[90vh] w-full max-w-5xl flex-col items-center overflow-y-auto px-10 py-12 text-center text-white"
                data-tv-file-info-copy="1"
            >
                <h2 className="text-4xl font-semibold tracking-tight md:text-5xl">{item.title}</h2>
                {item.summary ? (
                    <p
                        className="file-info-summary mt-4 max-w-4xl text-base leading-relaxed text-white/85 md:text-lg line-clamp-3"
                        data-tv-file-info-summary="1"
                    >
                        {item.summary}
                    </p>
                ) : null}
                {released ? (
                    <p className="mt-3 text-base text-white/85 md:text-lg">{t('mediaPlayerPage.released')}: {released}</p>
                ) : null}
                {loading ? (
                    <p className="mt-6 text-lg text-white/70">{t('mediaPlayerPage.loading')}</p>
                ) : null}
                {files.map(({ media, part }) => {
                    const audios = selectedAudioFirst(part, audioStreamId);
                    const size = [formatBytes(part.size), formatMbps(media.bitrate), String(part.container || media.container || '').toUpperCase()]
                        .filter(Boolean)
                        .join(' · ');
                    const video = formatMediaVideoLine(part.video)
                        || formatMediaVideoLine({
                            width: media.width,
                            height: media.height,
                            bitrate: media.bitrate,
                            codec: media.videoCodec,
                        });
                    const audioFallback = media.audioCodec
                        ? formatMediaAudioLine({
                            codec: media.audioCodec,
                            channels: media.audioChannels,
                        })
                        : '';
                    const subtitle = (part.subtitles || []).find((row) => row.selected)
                        || (part.subtitles || [])[0];
                    return (
                        <div
                            key={part.id}
                            className="file-info-meta mt-6 w-full max-w-4xl space-y-2 text-lg text-white/90 md:text-xl"
                            data-tv-file-info-meta="1"
                        >
                            {part.fileName ? (
                                <p><span className="text-white/55">{t('mediaPlayerPage.file')}</span> : {part.fileName}</p>
                            ) : null}
                            {size ? (
                                <p><span className="text-white/55">{t('mediaPlayerPage.size')}</span> : {size}</p>
                            ) : null}
                            {video ? (
                                <p><span className="text-white/55">{t('mediaPlayerPage.video')}</span> : {video}</p>
                            ) : null}
                            {audios.length ? audios.map((audio) => {
                                const line = formatMediaAudioLine(audio) || audio.displayTitle || '';
                                if (!line) return null;
                                const selected = audios.length > 1 && isSelectedAudio(audio, audioStreamId, part);
                                return (
                                    <p key={audio.id || line}>
                                        <span className="text-white/55">{t('mediaPlayerPage.audio')}</span>
                                        {' : '}
                                        {line}
                                        {selected ? (
                                            <span className="ml-2 rounded-full bg-plex px-2.5 py-0.5 text-xs font-black uppercase tracking-wider text-black">
                                                {t('mediaPlayerPage.fileInfoSelected')}
                                            </span>
                                        ) : null}
                                    </p>
                                );
                            }) : audioFallback ? (
                                <p><span className="text-white/55">{t('mediaPlayerPage.audio')}</span> : {audioFallback}</p>
                            ) : null}
                            <p>
                                <span className="text-white/55">{t('mediaPlayerPage.subtitles')}</span>
                                {' : '}
                                {subtitle?.displayTitle || t('mediaPlayerPage.subtitlesOff')}
                            </p>
                        </div>
                    );
                })}
            </div>
        </div>
    );

    if (typeof document === 'undefined') return null;
    return createPortal(overlay, document.body);
};
