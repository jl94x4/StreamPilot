import React, { useEffect, useRef, useState } from 'react';
import { Music, Volume2, VolumeX } from 'lucide-react';
import { plexThemeUrl } from './playerUtils';

const THEME_VOLUME = 0.4;

type Props = {
    themeKey: string;
    enabled: boolean;
    paused?: boolean;
    playLabel: string;
    muteLabel: string;
    unmuteLabel: string;
};

export const MediaPlayerThemeTune: React.FC<Props> = ({
    themeKey,
    enabled,
    paused = false,
    playLabel,
    muteLabel,
    unmuteLabel,
}) => {
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const [muted, setMuted] = useState(false);
    const [blocked, setBlocked] = useState(false);
    const [failed, setFailed] = useState(false);
    const [hidden, setHidden] = useState(() => typeof document !== 'undefined' && document.hidden);
    const src = enabled ? plexThemeUrl(themeKey) : '';

    useEffect(() => {
        setMuted(false);
        setBlocked(false);
        setFailed(false);
    }, [themeKey]);

    useEffect(() => {
        const sync = () => setHidden(document.hidden);
        document.addEventListener('visibilitychange', sync);
        return () => document.removeEventListener('visibilitychange', sync);
    }, []);

    useEffect(() => {
        const el = audioRef.current;
        if (!el) return;
        el.loop = true;
        el.volume = THEME_VOLUME;
        const shouldPlay = Boolean(src) && enabled && !paused && !muted && !failed && !hidden;
        if (!shouldPlay) {
            el.pause();
            return;
        }
        const attempt = el.play();
        if (attempt && typeof attempt.catch === 'function') {
            attempt.catch(() => setBlocked(true));
        }
        return () => { el.pause(); };
    }, [src, enabled, paused, muted, failed, hidden]);

    if (!src || failed) return null;

    const label = blocked ? playLabel : (muted ? unmuteLabel : muteLabel);

    return (
        <>
            <audio
                ref={audioRef}
                src={src}
                preload="auto"
                loop
                onError={() => setFailed(true)}
                onPlaying={() => setBlocked(false)}
            />
            <button
                type="button"
                onClick={() => {
                    if (blocked) {
                        const el = audioRef.current;
                        if (!el) return;
                        const attempt = el.play();
                        if (attempt && typeof attempt.then === 'function') {
                            attempt.then(() => {
                                setBlocked(false);
                                setMuted(false);
                            }).catch(() => setBlocked(true));
                        }
                        return;
                    }
                    setMuted((value) => !value);
                }}
                className="absolute bottom-2 right-2 z-10 inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-black/70 text-white shadow-lg backdrop-blur-md hover:bg-black/85"
                aria-label={label}
                title={label}
            >
                {blocked ? <Music className="h-4 w-4" /> : muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </button>
        </>
    );
};
