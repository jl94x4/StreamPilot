import React, { useEffect, useState } from 'react';
import { composeBoostedStudioLogo, measureLogoInsets, peekComposedLogo, peekLogoInsets } from './logoTrim';

type Props = {
    src: string;
    alt: string;
    className?: string;
    onError?: () => void;
    /** Scale a stacked studio mark above the title without enlarging the title. */
    boostTopMark?: boolean;
    /** Keep the artwork in the middle. Left trim is only for flush-left heroes. */
    center?: boolean;
    /** Vertical inset shift. Off for home identity — overflow clips the stacked mark. */
    trimTop?: boolean;
};

export const PlayerClearLogo: React.FC<Props> = ({ src, alt, className, onError, boostTopMark = false, center = false, trimTop = true }) => {
    const [visual, setVisual] = useState<{ src: string; left: number; top: number } | null>(() => {
        if (boostTopMark) {
            const composed = peekComposedLogo(src);
            if (composed) return { src: composed.url, left: composed.insets.left, top: composed.insets.top };
            if (composed === null) {
                const cached = peekLogoInsets(src);
                return cached ? { src, left: cached.left, top: cached.top } : null;
            }
            return null;
        }
        const cached = peekLogoInsets(src);
        return cached ? { src, left: cached.left, top: cached.top } : null;
    });

    useEffect(() => {
        let cancelled = false;
        if (!boostTopMark) {
            const cached = peekLogoInsets(src);
            if (cached) {
                setVisual({ src, left: cached.left, top: cached.top });
                return undefined;
            }
            setVisual(null);
            measureLogoInsets(src).then((next) => {
                if (!cancelled) setVisual({ src, left: next.left, top: next.top });
            });
            return () => { cancelled = true; };
        }

        const applyPlain = () => measureLogoInsets(src).then((next) => {
            if (!cancelled) setVisual({ src, left: next.left, top: next.top });
        });

        const composed = peekComposedLogo(src);
        if (composed) {
            setVisual({ src: composed.url, left: composed.insets.left, top: composed.insets.top });
            return undefined;
        }
        if (composed === null) {
            const cached = peekLogoInsets(src);
            if (cached) setVisual({ src, left: cached.left, top: cached.top });
            else {
                setVisual(null);
                applyPlain();
            }
            return () => { cancelled = true; };
        }

        setVisual(null);
        composeBoostedStudioLogo(src).then((next) => {
            if (cancelled) return;
            if (next) {
                setVisual({ src: next.url, left: next.insets.left, top: next.insets.top });
                return;
            }
            applyPlain();
        });
        return () => { cancelled = true; };
    }, [boostTopMark, src]);

    const ready = visual != null;
    const left = visual?.left || 0;
    const top = trimTop ? (visual?.top || 0) : 0;
    // Half the left pad recenters artwork that sits in an asymmetric PNG.
    const shiftX = center ? left / 2 : left;
    const shift = shiftX > 0 || top > 0;

    return (
        <img
            src={visual?.src || src}
            alt={alt}
            className={className}
            onError={() => onError?.()}
            style={{
                opacity: ready ? 1 : 0,
                transform: shift ? `translate(-${(shiftX * 100).toFixed(2)}%, -${(top * 100).toFixed(2)}%)` : undefined,
            }}
        />
    );
};
