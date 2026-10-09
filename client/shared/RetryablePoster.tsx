import React, { useEffect, useState } from 'react';
import { NoPosterPlaceholder } from './NoPosterPlaceholder';

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

    useEffect(() => {
        setAttempt(0);
        setUseFallback(false);
        setFailed(!src && !fallbackSrc);
        setDisplaySrc(src || fallbackSrc);
    }, [src, fallbackSrc]);

    if (failed || (!src && !fallbackSrc)) {
        return <NoPosterPlaceholder compact={compactPlaceholder} />;
    }

    const currentSrc = withRetryParam(displaySrc, attempt);

    return (
        <img
            key={`${useFallback ? 'fb' : 'src'}-${attempt}-${currentSrc}`}
            src={currentSrc}
            alt={alt}
            loading={loading}
            decoding="async"
            {...(fetchPriority ? { fetchPriority } : {})}
            draggable={false}
            className={className}
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
