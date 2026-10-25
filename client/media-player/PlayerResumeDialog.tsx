import React, { useMemo, useState } from 'react';
import { Play, RotateCcw, X } from 'lucide-react';
import { useDiscoverI18n } from './host';
import {
    formatClock,
    formatEpisodeCode,
    formatPlayerDuration,
    plexBackdropUrl,
    plexLogoUrl,
    progressPercent,
} from './playerUtils';
import type { PlayerItem } from './types';

type Props = {
    item: PlayerItem;
    offsetMs: number;
    tvShell?: boolean;
    onResume: () => void;
    onStartOver: () => void;
    onClose: () => void;
};

/**
 * "Resume playback?" — a small billboard: the title's art fading into the card, its logo,
 * where you left off, then Resume / Start over / close in one row (title-page buttons).
 */
export const PlayerResumeDialog: React.FC<Props> = ({
    item,
    offsetMs,
    tvShell = false,
    onResume,
    onStartOver,
    onClose,
}) => {
    const { t } = useDiscoverI18n();
    const [logoFailed, setLogoFailed] = useState(false);
    const [artFailed, setArtFailed] = useState(false);
    const durationMs = Number(item.durationMs || 0);
    const progress = useMemo(() => {
        if (durationMs > 0 && offsetMs > 0) {
            return Math.min(100, Math.max(2, (offsetMs / durationMs) * 100));
        }
        return progressPercent({ ...item, viewOffsetMs: offsetMs });
    }, [durationMs, item, offsetMs]);

    const episode = item.type === 'episode';
    const episodeCode = formatEpisodeCode(item);
    const heading = episode ? (item.showTitle || item.title) : item.title;
    const episodeLine = episode
        ? [episodeCode, item.title && item.title !== heading ? item.title : ''].filter(Boolean).join(' · ')
        : '';
    const artUrl = plexBackdropUrl(item.art || item.heroArt || item.thumb);
    const logoUrl = plexLogoUrl(item.logo);
    const showLogo = Boolean(logoUrl) && !logoFailed;
    const timeLeftMs = durationMs > offsetMs ? durationMs - offsetMs : 0;

    return (
        <div
            className={`smp-resume${tvShell ? ' is-tv' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="player-resume-title"
            data-tv-resume-dialog="1"
        >
            <div className="smp-resume-scrim" aria-hidden />
            <div className="smp-resume-card player-resume-dialog-enter">
                {artUrl && !artFailed ? (
                    <img
                        className="smp-resume-art"
                        src={artUrl}
                        alt=""
                        aria-hidden
                        onError={() => setArtFailed(true)}
                    />
                ) : null}
                <div className="smp-resume-fade" aria-hidden />
                <div className="smp-resume-body">
                    <p className="smp-resume-eyebrow">{t('mediaPlayerPage.resumeTitle')}</p>
                    {showLogo ? (
                        <img
                            className="smp-resume-logo"
                            src={logoUrl || ''}
                            alt={heading || ''}
                            onError={() => setLogoFailed(true)}
                        />
                    ) : null}
                    <h2 id="player-resume-title" className={showLogo ? 'sr-only' : 'smp-resume-title'}>
                        {heading}
                    </h2>
                    {episodeLine ? <p className="smp-resume-episode">{episodeLine}</p> : null}

                    {durationMs > 0 ? (
                        <div className="smp-resume-progress">
                            <div className="smp-resume-bar">
                                <span style={{ width: `${progress}%` }} />
                            </div>
                            <div className="smp-resume-times">
                                <span>{t('mediaPlayerPage.resumeFrom', { time: formatClock(offsetMs) })}</span>
                                {timeLeftMs > 0 ? (
                                    <span>{formatPlayerDuration(timeLeftMs)} {t('mediaPlayerPage.remaining')}</span>
                                ) : null}
                            </div>
                        </div>
                    ) : (
                        <p className="smp-resume-episode">{t('mediaPlayerPage.resumeFrom', { time: formatClock(offsetMs) })}</p>
                    )}

                    {/* One remote row: Left / Right move between the three. */}
                    <div className="smp-resume-actions" data-tv-rail="1" data-tv-row="1">
                        <button
                            type="button"
                            data-tv-item="1"
                            data-tv-action="1"
                            data-tv-resume-primary="1"
                            onClick={onResume}
                            className="smp-resume-btn is-primary"
                        >
                            <Play className="h-5 w-5 shrink-0 fill-current" />
                            {t('mediaPlayerPage.resume')}
                        </button>
                        <button
                            type="button"
                            data-tv-item="1"
                            data-tv-action="1"
                            onClick={onStartOver}
                            className="smp-resume-btn"
                        >
                            <RotateCcw className="h-[18px] w-[18px] shrink-0" />
                            {t('mediaPlayerPage.startOver')}
                        </button>
                        <button
                            type="button"
                            data-tv-item="1"
                            data-tv-action="1"
                            onClick={onClose}
                            className="smp-resume-btn is-icon"
                            aria-label={t('common.close')}
                            title={t('common.close')}
                        >
                            <X className="h-5 w-5 shrink-0" />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
