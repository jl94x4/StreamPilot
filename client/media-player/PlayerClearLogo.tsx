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
    /** TV details: enlarge sparse/wide marks toward the slot without growing full logos. */
    fillSlot?: boolean;
};

export const PlayerClearLogo: React.FC<Props> = ({ src, alt, className, onError, boostTopMark = false, center = false, trimTop = true, fillSlot = false }) => {
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
    const [fillBoost, setFillBoost] = useState(1);

    useEffect(() => {
        setFillBoost(1);
    }, [src, fillSlot]);

    const onImgLoad = (img: HTMLImageElement) => {
        if (!fillSlot) {
            setFillBoost(1);
            return;
        }
        const nw = img.naturalWidth;
        const nh = img.naturalHeight;
        const boxW = img.clientWidth;
        const boxH = img.clientHeight;
        if (nw < 2 || nh < 2 || boxW < 2 || boxH < 2) {
            setFillBoost(1);
            return;
        }
        const fit = Math.min(boxW / nw, boxH / nh);
        const drawnH = nh * fit * (1 - top * 0.9);
        if (drawnH >= boxH * 0.86) {
            setFillBoost(1);
            return;
        }
        setFillBoost(Math.max(1, Math.min(1.45, boxH / Math.max(8, drawnH))));
    };

    const translate = shift ? `translate(-${(shiftX * 100).toFixed(2)}%, -${(top * 100).toFixed(2)}%)` : '';
    const scale = fillBoost > 1.02 ? `scale(${fillBoost.toFixed(3)})` : '';
    const transform = [translate, scale].filter(Boolean).join(' ') || undefined;

    return (
        <img
            src={visual?.src || src}
            alt={alt}
            className={className}
            ref={(node) => {
                if (node?.complete && node.naturalWidth > 0) onImgLoad(node);
            }}
            onLoad={(event) => onImgLoad(event.currentTarget)}
            onError={() => onError?.()}
            style={{
                opacity: ready ? 1 : 0,
                transform,
                transformOrigin: scale ? 'left bottom' : undefined,
            }}
        />
    );
};
