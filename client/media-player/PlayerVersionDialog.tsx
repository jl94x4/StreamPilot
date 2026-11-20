import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useDiscoverI18n } from './host';
import { TvButton } from '../shared/TvButton';
import {
    detectPlayerHdrLabel,
    formatBitrateMbps,
    formatPlayerResolution,
    plexBackdropUrl,
    plexLogoUrl,
} from './playerUtils';
import type { PlayerItem, PlayerVersion } from './types';

type Props = {
    item: PlayerItem;
    tvShell?: boolean;
    /** Index of the version remembered for this title, shown as Current. */
    currentIndex?: number | null;
    onPick: (mediaIndex: number) => void;
    onClose: () => void;
};

/**
 * "Select version" for a title that has more than one file (e.g. 4K and 1080p), shown
 * whenever Play is pressed from anywhere that did not already pick one.
 */
export const PlayerVersionDialog: React.FC<Props> = ({ item, tvShell = false, currentIndex = null, onPick, onClose }) => {
    const { t } = useDiscoverI18n();
    const [logoFailed, setLogoFailed] = useState(false);
    const choices: PlayerVersion[] = item.versions || [];
    const episode = item.type === 'episode';
    const stillPath = episode ? (item.episodeThumb || item.thumb) : '';
    const backdropUrl = plexBackdropUrl(stillPath || item.art || item.heroArt || item.thumb);
    const logoUrl = plexLogoUrl(item.logo);
    const showLogo = Boolean(logoUrl) && !logoFailed;
    const heading = episode ? (item.showTitle || item.title) : item.title;

    useEffect(() => {
        window.addEventListener('smp-tv-overlay-close', onClose);
        const focusId = window.setTimeout(() => {
            document.querySelector<HTMLElement>('[data-tv-version-primary="1"]')?.focus();
        }, 40);
        return () => {
            window.removeEventListener('smp-tv-overlay-close', onClose);
            window.clearTimeout(focusId);
        };
    }, [onClose]);

    const parts = (row: PlayerVersion) => {
        const media = (item.mediaInfo || [])[row.mediaIndex];
        const resolution = row.resolution || formatPlayerResolution(row.height || media?.height, media?.videoResolution) || row.label;
        const hdr = detectPlayerHdrLabel({ mediaInfo: item.mediaInfo, mediaIndex: row.mediaIndex });
        const codec = (value?: string | null) => String(value || '').trim().toUpperCase();
        const detail = [codec(row.videoCodec || media?.videoCodec), hdr, codec(row.audioCodec || media?.audioCodec), codec(row.container || media?.container)]
            .filter(Boolean)
            .join(' · ');
        return { resolution, detail, bitrate: formatBitrateMbps(row.bitrate || media?.bitrate) };
    };
    const label = (row: PlayerVersion) => {
        const p = parts(row);
        return [p.resolution, p.bitrate].filter(Boolean).join(' · ') || row.label;
    };

    if (typeof document === 'undefined') return null;
    return createPortal(
        <div
            className={`smp-resume smp-version-dialog${tvShell ? ' is-tv' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="player-version-title"
            data-tv-version-dialog="1"
        >
            <div className="smp-resume-scrim" aria-hidden onClick={onClose} />
            <div className="smp-resume-card player-resume-dialog-enter">
                {backdropUrl ? <img className="smp-resume-art" src={backdropUrl} alt="" aria-hidden /> : null}
                <div className="smp-resume-fade" aria-hidden />
                <div className="smp-resume-body smp-version-body">
                    <p className="smp-resume-eyebrow">{t('mediaPlayerPage.selectVersion')}</p>
                    {showLogo ? (
                        <img
                            className="smp-resume-logo"
                            src={logoUrl || ''}
                            alt={heading || ''}
                            onError={() => setLogoFailed(true)}
                        />
                    ) : null}
                    <h2 id="player-version-title" className={showLogo ? 'sr-only' : 'smp-resume-title'}>
                        {heading}
                    </h2>
                    <div className="smp-version-list" data-tv-rail="1">
                        {choices.map((row, index) => {
                            const p = parts(row);
                            return (
                                <TvButton
                                    key={row.id || row.mediaIndex}
                                    type="button"
                                    data-tv-item="1"
                                    data-tv-action="1"
                                    data-tv-version-primary={index === 0 ? '1' : undefined}
                                    onClick={() => onPick(row.mediaIndex)}
                                    className="smp-version-row"
                                    aria-label={label(row)}
                                >
                                    <span className="smp-version-res">{p.resolution}</span>
                                    <span className="smp-version-detail">{p.detail || row.label}</span>
                                    {p.bitrate ? <span className="smp-version-rate">{p.bitrate}</span> : null}
                                    {currentIndex === row.mediaIndex ? <span className="smp-version-rate">{t('mediaPlayerPage.currentVersion')}</span> : null}
                                </TvButton>
                            );
                        })}
                    </div>
                    <div className="smp-resume-actions">
                        <TvButton
                            type="button"
                            data-tv-item="1"
                            data-tv-action="1"
                            onClick={onClose}
                            className="smp-resume-btn"
                        >
                            <X className="h-[18px] w-[18px] shrink-0" />
                            {t('common.close')}
                        </TvButton>
                    </div>
                </div>
            </div>
        </div>,
        document.body,
    );
};
