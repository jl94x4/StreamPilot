import React, { useEffect, useState } from 'react';
import { Pause, Play, SkipForward } from 'lucide-react';
import { useDiscoverI18n } from './host';
import { formatClock, MUSIC_NOW_PLAYING_EVENT, plexImageUrl, type MusicNowPlayingDetail } from './playerUtils';
import { setNativePlayerPaused, showNativePlayer, skipNativePlayerNext } from '../plex-client/nativePlayer';

type Props = {
    active?: boolean;
};

export const MediaPlayerNowPlayingChip: React.FC<Props> = ({ active = true }) => {
    const { t } = useDiscoverI18n();
    const [nowPlaying, setNowPlaying] = useState<MusicNowPlayingDetail>(null);
    const [localMs, setLocalMs] = useState(0);

    useEffect(() => {
        const onNowPlaying = (event: Event) => {
            const detail = (event as CustomEvent<MusicNowPlayingDetail>).detail || null;
            setNowPlaying(detail && detail.minimized ? detail : null);
            setLocalMs(detail?.positionMs || 0);
        };
        window.addEventListener(MUSIC_NOW_PLAYING_EVENT, onNowPlaying);
        return () => window.removeEventListener(MUSIC_NOW_PLAYING_EVENT, onNowPlaying);
    }, []);

    useEffect(() => {
        if (!nowPlaying || nowPlaying.paused) return undefined;
        const startedAt = Date.now();
        const base = nowPlaying.positionMs;
        const id = window.setInterval(() => {
            setLocalMs(Math.min(nowPlaying.durationMs || base, base + (Date.now() - startedAt)));
        }, 250);
        return () => window.clearInterval(id);
    }, [nowPlaying?.positionMs, nowPlaying?.paused, nowPlaying?.item.ratingKey, nowPlaying?.durationMs]);

    if (!active || !nowPlaying) return null;

    const item = nowPlaying.item;
    const title = item.title || t('mediaPlayerPage.nowPlaying');
    const artist = String(item.showTitle || item.seasonTitle || '').trim();
    const art = item.thumb ? plexImageUrl(item.thumb, 160, 160, { quality: 70 }) : '';
    const duration = Math.max(0, nowPlaying.durationMs || 0);
    const progress = duration > 0 ? Math.min(100, (localMs / duration) * 100) : 0;
    const paused = nowPlaying.paused;

    return (
        <div
            className="player-home-now-playing"
            data-tv-row="1"
            data-tv-row-id="now-playing"
        >
            <button
                type="button"
                data-tv-item="1"
                data-tv-now-playing="1"
                className="player-home-now-playing-card"
                onClick={() => void showNativePlayer()}
                aria-label={`${t('mediaPlayerPage.nowPlaying')}: ${title}`}
            >
                <span className="player-home-now-playing-art" aria-hidden="true">
                    {art ? <img src={art} alt="" /> : <span className="player-home-now-playing-art-empty" />}
                </span>
                <span className="player-home-now-playing-copy">
                    <span className="player-home-now-playing-kicker">{t('mediaPlayerPage.nowPlaying')}</span>
                    <span className="player-home-now-playing-title">{title}</span>
                    {artist ? <span className="player-home-now-playing-artist">{artist}</span> : null}
                    <span className="player-home-now-playing-times">
                        {formatClock(localMs)}
                        {duration > 0 ? ` · ${formatClock(duration)}` : ''}
                    </span>
                </span>
                <span className="player-home-now-playing-progress" aria-hidden="true">
                    <span style={{ width: `${progress}%` }} />
                </span>
            </button>
            <button
                type="button"
                data-tv-item="1"
                className="player-home-now-playing-btn"
                aria-label={paused ? t('mediaPlayerPage.play') : t('mediaPlayerPage.pause')}
                onClick={() => void setNativePlayerPaused(!paused)}
            >
                {paused
                    ? <Play className="h-5 w-5 fill-current" />
                    : <Pause className="h-5 w-5 fill-current" />}
            </button>
            <button
                type="button"
                data-tv-item="1"
                className="player-home-now-playing-btn"
                aria-label={t('mediaPlayerPage.skipTrack')}
                onClick={() => void skipNativePlayerNext()}
            >
                <SkipForward className="h-5 w-5 fill-current" />
            </button>
        </div>
    );
};
