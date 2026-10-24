import React, { useEffect, useState } from 'react';

type Props = {
    src: string;
    previewSrc?: string;
    className?: string;
    style?: React.CSSProperties;
    fetchPriority?: 'high' | 'low' | 'auto';
    onLoad?: () => void;
    onError?: () => void;
    /**
     * Keep the current image on screen when `src` changes and swap only once the new one has
     * loaded. Title pages: the full details often arrive with a slightly different art URL,
     * and remounting on that showed black and reloaded the backdrop.
     */
    holdPrevious?: boolean;
};

/** Full backdrop. The image shown is the sharp source, not a soft preview. */
export const PlayerBackdropImage: React.FC<Props> = ({
    src,
    previewSrc,
    className = '',
    style,
    fetchPriority,
    onLoad,
    onError,
    holdPrevious = false,
}) => {
    if (holdPrevious) {
        return (
            <HeldBackdropImage
                src={src}
                className={className}
                style={style}
                fetchPriority={fetchPriority}
                onLoad={onLoad}
                onError={onError}
            />
        );
    }
    return (
        <SwapBackdropImage
            src={src}
            previewSrc={previewSrc}
            className={className}
            style={style}
            fetchPriority={fetchPriority}
            onLoad={onLoad}
            onError={onError}
        />
    );
};

const HeldBackdropImage: React.FC<Omit<Props, 'previewSrc' | 'holdPrevious'>> = ({
    src,
    className = '',
    style,
    fetchPriority,
    onLoad,
    onError,
}) => {
    const [shown, setShown] = useState(src);
    const [incoming, setIncoming] = useState('');
    useEffect(() => {
        setIncoming(src === shown ? '' : src);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [src]);
    return (
        <>
            {shown ? (
                <img
                    src={shown}
                    alt=""
                    className={`absolute inset-0 ${className}`}
                    style={style}
                    decoding="async"
                    fetchPriority={fetchPriority}
                    onLoad={() => onLoad?.()}
                    onError={() => { if (!incoming) onError?.(); }}
                />
            ) : null}
            {incoming ? (
                // Loads underneath, invisible; replaces `shown` the moment it is ready.
                <img
                    src={incoming}
                    alt=""
                    className={`absolute inset-0 ${className} opacity-0`}
                    style={style}
                    decoding="async"
                    fetchPriority={fetchPriority}
                    onLoad={() => {
                        setShown(incoming);
                        setIncoming('');
                        onLoad?.();
                    }}
                    onError={() => setIncoming('')}
                />
            ) : null}
        </>
    );
};

const SwapBackdropImage: React.FC<Omit<Props, 'holdPrevious'>> = ({
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
