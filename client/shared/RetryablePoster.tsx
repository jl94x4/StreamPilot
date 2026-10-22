import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { NoPosterPlaceholder } from './NoPosterPlaceholder';
import { isPosterUrlWarm, warmPosterUrl } from './posterWarmCache';

const MAX_RETRIES = 4;

const withRetryParam = (url: string, attempt: number) => {
    if (!url || attempt <= 0) return url;
    const join = url.includes('?') ? '&' : '?';
    return `${url}${join}retry=${attempt}`;
};

type Props = {
    src: string;
    fallbackSrc?: string;
    alt?: string;
    className?: string;
    loading?: 'lazy' | 'eager';
    fetchPriority?: 'high' | 'low' | 'auto';
    compactPlaceholder?: boolean;
};

export const RetryablePoster: React.FC<Props> = ({
    src,
    fallbackSrc = '',
    alt = '',
    className = 'w-full h-full object-cover',
    loading = 'eager',
    fetchPriority,
    compactPlaceholder = true,
}) => {
    const [attempt, setAttempt] = useState(0);
    const [useFallback, setUseFallback] = useState(false);
    const [failed, setFailed] = useState(!src && !fallbackSrc);
    const [displaySrc, setDisplaySrc] = useState(src || fallbackSrc);
    const [ready, setReady] = useState(() => isPosterUrlWarm(src || fallbackSrc));
    const imgRef = useRef<HTMLImageElement | null>(null);

    useEffect(() => {
        setAttempt(0);
        setUseFallback(false);
        setFailed(!src && !fallbackSrc);
        setDisplaySrc(src || fallbackSrc);
        setReady(isPosterUrlWarm(src || fallbackSrc));
        // Warm the new URL immediately (cover swaps change the stamp ? new key).
        if (src || fallbackSrc) warmPosterUrl(src || fallbackSrc);
    }, [src, fallbackSrc]);

    const currentSrc = withRetryParam(displaySrc, attempt);

    useLayoutEffect(() => {
        const img = imgRef.current;
        if (img?.complete && img.naturalWidth > 0) {
            setReady(true);
            return;
        }
        if (isPosterUrlWarm(displaySrc)) {
            setReady(true);
            return;
        }
        setReady(false);
    }, [currentSrc, displaySrc]);

    if (failed || (!src && !fallbackSrc)) {
        return <NoPosterPlaceholder compact={compactPlaceholder} />;
    }

    const reveal = (img: HTMLImageElement) => {
        const finish = () => setReady(true);
        if (typeof img.decode === 'function') {
            img.decode().then(finish, finish);
            return;
        }
        finish();
    };

    return (
        <img
            ref={imgRef}
            key={`${useFallback ? 'fb' : 'src'}-${attempt}-${currentSrc}`}
            src={currentSrc}
            alt={alt}
            loading={loading}
            decoding="async"
            {...(fetchPriority ? { fetchPriority } : {})}
            draggable={false}
            className={`${className}${ready ? '' : ' player-poster-pending'}`}
            onLoad={(event) => {
                warmPosterUrl(displaySrc);
                reveal(event.currentTarget);
            }}
            onError={() => {
                if (!useFallback && fallbackSrc && fallbackSrc !== src) {
                    setUseFallback(true);
                    setAttempt(0);
                    setDisplaySrc(fallbackSrc);
                    return;
                }
                if (attempt < MAX_RETRIES) {
                    const next = attempt + 1;
                    window.setTimeout(() => setAttempt(next), 280 * next);
                    return;
                }
                setFailed(true);
            }}
        />
    );
};
