import React, { useEffect, useState } from 'react';

type Props = {
    src: string;
    previewSrc?: string;
    className?: string;
    style?: React.CSSProperties;
    fetchPriority?: 'high' | 'low' | 'auto';
    onLoad?: () => void;
    onError?: () => void;
};

/** Tiny JPEG first, then the sharp 1080p art — same final pixels, much faster first paint. */
export const PlayerBackdropImage: React.FC<Props> = ({
    src,
    previewSrc,
    className = '',
    style,
    fetchPriority,
    onLoad,
    onError,
}) => {
    const preview = previewSrc && previewSrc !== src ? previewSrc : '';
    const [fullReady, setFullReady] = useState(false);

    useEffect(() => {
        setFullReady(false);
    }, [src]);

    return (
        <>
            {preview ? (
                <img
                    src={preview}
                    alt=""
                    className={`absolute inset-0 ${className}`}
                    style={style}
                    decoding="async"
                    onLoad={onLoad}
                />
            ) : null}
            <img
                src={src}
                alt=""
                className={`absolute inset-0 ${className} ${fullReady || !preview ? 'opacity-100' : 'opacity-0'} transition-opacity duration-500 ease-out`}
                style={style}
                decoding="async"
                fetchPriority={fetchPriority}
                onLoad={() => {
                    setFullReady(true);
                    if (!preview) onLoad?.();
                }}
                onError={() => {
                    if (!preview) onError?.();
                }}
            />
        </>
    );
};
