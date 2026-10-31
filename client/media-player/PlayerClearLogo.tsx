import React, { useEffect, useRef, useState } from 'react';
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
    /** TV home spotlight: grow tall / padded marks (up to 2×) so they read as big as wide ones. */
    growSmall?: boolean;
};

type Visual = { from: string; src: string; left: number; top: number; right?: number; bottom?: number };

/** Logos narrower than this (width ÷ height of the visible mark) are grown in growSmall slots. */
const GROW_FULL_RATIO = 3;
const GROW_MAX = 2;

/**
 * TV details: logos up to this wide (width ÷ height) fill the slot height. Wider wordmarks
 * shrink so they cover about the same area — a 7:1 logo at full height dwarfed the page.
 */
const SLOT_FULL_RATIO = 3;

export const PlayerClearLogo: React.FC<Props> = ({ src, alt, className, onError, boostTopMark = false, center = false, trimTop = true, fillSlot = false, growSmall = false }) => {
    const [visual, setVisual] = useState<Visual | null>(() => {
        if (boostTopMark) {
            const composed = peekComposedLogo(src);
            if (composed) return { from: src, src: composed.url, left: composed.insets.left, top: composed.insets.top };
            if (composed === null) {
                const cached = peekLogoInsets(src);
                return cached ? { from: src, src, left: cached.left, top: cached.top, right: cached.right, bottom: cached.bottom } : null;
            }
            return null;
        }
        const cached = peekLogoInsets(src);
        return cached ? { from: src, src, left: cached.left, top: cached.top, right: cached.right, bottom: cached.bottom } : null;
    });

    useEffect(() => {
        let cancelled = false;
        if (!boostTopMark) {
            const cached = peekLogoInsets(src);
            if (cached) {
                setVisual({ from: src, src, left: cached.left, top: cached.top, right: cached.right, bottom: cached.bottom });
                return undefined;
            }
            setVisual(null);
            measureLogoInsets(src).then((next) => {
                if (!cancelled) setVisual({ from: src, src, left: next.left, top: next.top, right: next.right, bottom: next.bottom });
            });
            return () => { cancelled = true; };
        }

        const applyPlain = () => measureLogoInsets(src).then((next) => {
            if (!cancelled) setVisual({ from: src, src, left: next.left, top: next.top, right: next.right, bottom: next.bottom });
        });

        const composed = peekComposedLogo(src);
        if (composed) {
            setVisual({ from: src, src: composed.url, left: composed.insets.left, top: composed.insets.top });
            return undefined;
        }
        if (composed === null) {
            const cached = peekLogoInsets(src);
            if (cached) setVisual({ from: src, src, left: cached.left, top: cached.top, right: cached.right, bottom: cached.bottom });
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
                setVisual({ from: src, src: next.url, left: next.insets.left, top: next.insets.top });
                return;
            }
            applyPlain();
        });
        return () => { cancelled = true; };
    }, [boostTopMark, src]);

    const ready = visual != null && visual.from === src;
    const left = ready ? visual.left : 0;
    const top = trimTop && ready ? visual.top : 0;
    // Half the left pad recenters artwork that sits in an asymmetric PNG.
    const shiftX = center ? left / 2 : left;
    const shift = shiftX > 0 || top > 0;
    const [fillBoost, setFillBoost] = useState(1);
    /** fillSlot: 0–1 height scale for very wide marks (read by the TV CSS as --logo-scale). */
    const [slotScale, setSlotScale] = useState(1);
    /** Natural pixel size, for growSmall (the visible-mark shape needs it with the insets). */
    const [natural, setNatural] = useState<{ src: string; w: number; h: number } | null>(null);
    /** fillSlot: px to lift the scaled mark so its visible top meets the slot top, never above. */
    const [fillLift, setFillLift] = useState(0);
    const imgRef = useRef<HTMLImageElement | null>(null);

    useEffect(() => {
        setFillBoost(1);
        setFillLift(0);
        setSlotScale(1);
    }, [src, fillSlot]);

    // The top inset (or a smaller slot for a wide mark) can arrive after load: measure again.
    useEffect(() => {
        const node = imgRef.current;
        if (fillSlot && node?.complete && node.naturalWidth > 0) onImgLoad(node);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fillSlot, top, slotScale]);

    const onImgLoad = (img: HTMLImageElement) => {
        if (growSmall && img.naturalWidth > 1 && img.naturalHeight > 1
            && (natural?.src !== img.currentSrc || natural.w !== img.naturalWidth)) {
            setNatural({ src: img.currentSrc, w: img.naturalWidth, h: img.naturalHeight });
        }
        if (!fillSlot) {
            setFillBoost(1);
            return;
        }
        const nw = img.naturalWidth;
        const nh = img.naturalHeight;
        if (nw > 1 && nh > 1) {
            const ratio = nw / nh;
            const next = ratio > SLOT_FULL_RATIO ? Math.sqrt(SLOT_FULL_RATIO / ratio) : 1;
            if (Math.abs(next - slotScale) > 0.01) {
                setSlotScale(next);
                return;
            }
        }
        const boxW = img.clientWidth;
        const boxH = img.clientHeight;
        if (nw < 2 || nh < 2 || boxW < 2 || boxH < 2) {
            setFillBoost(1);
            setFillLift(0);
            return;
        }
        // Scaled from the top-left and lifted by exactly the empty band above the mark, so it
        // fills the slot downward and never rises into a network logo stacked above it.
        const drawn = nh * Math.min(boxW / nw, boxH / nh);
        const visible = drawn * (1 - top);
        const boost = visible >= boxH * 0.86 ? 1 : Math.max(1, Math.min(1.45, boxH / Math.max(8, visible)));
        setFillBoost(boost);
        setFillLift(boost * ((boxH - drawn) / 2 + top * drawn));
    };

    // growSmall: size by the visible mark, not the PNG. A near-square or padded mark at the slot
    // height looked half the size of a wide wordmark; grow it toward the same presence.
    let growScale = 1;
    if (growSmall && ready && natural) {
        const contentW = Math.max(0.2, 1 - (visual.left || 0) - (visual.right || 0));
        const contentH = Math.max(0.2, 1 - (visual.top || 0) - (visual.bottom || 0));
        const ratio = (natural.w * contentW) / (natural.h * contentH);
        const shape = ratio < GROW_FULL_RATIO ? Math.sqrt(GROW_FULL_RATIO / ratio) : 1;
        growScale = Math.max(1, Math.min(GROW_MAX, shape / contentH));
    }

    const translate = fillSlot
        ? (shiftX > 0 || fillLift > 0.5 ? `translate(-${(shiftX * 100).toFixed(2)}%, -${fillLift.toFixed(1)}px)` : '')
        : shift ? `translate(-${(shiftX * 100).toFixed(2)}%, -${(top * 100).toFixed(2)}%)` : '';
    const scale = fillBoost > 1.02 ? `scale(${fillBoost.toFixed(3)})` : '';
    const transform = [translate, scale].filter(Boolean).join(' ') || undefined;

    return (
        <img
            src={ready ? visual.src : src}
            alt={alt}
            className={className}
            ref={(node) => {
                imgRef.current = node;
                if (node?.complete && node.naturalWidth > 0) onImgLoad(node);
            }}
            onLoad={(event) => onImgLoad(event.currentTarget)}
            onError={() => onError?.()}
            style={{
                opacity: ready ? 1 : 0,
                ...(fillSlot && slotScale < 1 ? { ['--logo-scale' as string]: slotScale.toFixed(3) } : null),
                ...(growScale > 1.02 ? { ['--logo-scale' as string]: growScale.toFixed(3) } : null),
                transform,
                transformOrigin: scale ? (fillSlot ? 'left top' : 'left bottom') : undefined,
            }}
        />
    );
};
