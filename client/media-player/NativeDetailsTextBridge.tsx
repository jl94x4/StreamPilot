import React, { useEffect, useRef, useState } from 'react';
import { discoveryLogoUrl } from '../discovery/discoveryLogoUtils';
import { useServiceBrandPick } from './PlayerServiceBrandMark';
import type { PlayerItem } from './types';
import { nativeDetailRailSuppressed, nativeDetailsTextHide, nativeDetailsTextRect, nativeDetailsTextSet } from '../plex-client/nativeHome';
import { PLAYER_SCROLL_ID } from './paths';

import { nativeOverlayOpen, watchNativeMenuFlag } from './nativeOverlay';
export type NativeDetailsTextContent = {
    identity?: { logo: string; title: string; svc: string; svcData: string; svcColor: boolean } | null;
    meta?: {
        premiere: string;
        tagline: string;
        chips: Array<{ l: string; i: string; a: boolean }>;
        pills: Array<{ k: string; s: string; f?: boolean }>;
    } | null;
    synopsis?: { text: string; ep?: boolean } | null;
    /** Episode / season page: the episode's own title line. */
    heading?: { text: string; ep?: boolean } | null;
};

const ROOT = '[data-tv-details="1"]';
const SELECTORS = {
    identity: `${ROOT} .media-details-billboard-title-stack`,
    meta: `${ROOT} .media-details-billboard-ratings`,
    synopsis: `${ROOT} .media-details-synopsis, ${ROOT} .media-details-billboard-summary`,
    heading: `${ROOT} .media-details-episode-heading`,
} as const;
type BlockId = keyof typeof SELECTORS;

const OVERLAY = '[data-tv-item-menu="1"], [data-tv-select-menu="1"], [data-tv-resume-dialog="1"], [data-tv-season-watch-dialog="1"], [data-tv-still-watching-dialog="1"], [data-tv-whats-new="1"], [data-tv-home-switch="1"], [data-tv-library-manager="1"], [data-tv-version-dialog="1"], [data-tv-track-dialog="1"], [data-tv-settings-dialog="1"], [data-native-player-open="1"], [role="dialog"]';

const FLAG: Record<BlockId, string> = { identity: 'nativeDtId', meta: 'nativeDtMeta', synopsis: 'nativeDtSyn', heading: 'nativeDtHd' };

/**
 * Android TV movie / show page: the logo / title, the chips + rating pills and the synopsis are drawn by
 * NativeDetailsText at the web blocks' places. The web blocks stay in the layout (hidden by data-native-dt-* flags)
 * so spacing and scrolling are untouched. Renders nothing.
 */
export const NativeDetailsTextBridge: React.FC<{ content: NativeDetailsTextContent }> = ({ content }) => {
    const contentRef = useRef(content);
    contentRef.current = content;
    const json = JSON.stringify(content);
    const apiRef = useRef<{ queue: () => void; resend: () => void } | null>(null);

    useEffect(() => {
        let frame = 0;
        let lastRect = '';
        let lastSet = '';
        let burstUntil = 0;
        const root = document.documentElement;
        const active = new Set<BlockId>();

        const measure = () => {
            const rects: Partial<Record<BlockId, DOMRect>> = {};
            (Object.keys(SELECTORS) as BlockId[]).forEach((id) => {
                const data = contentRef.current[id];
                if (!data) return;
                const el = document.querySelector<HTMLElement>(SELECTORS[id]);
                if (!el) return;
                const r = el.getBoundingClientRect();
                if (r.width < 2 || r.height < 2) return;
                rects[id] = r;
            });
            return rects;
        };

        const send = () => {
            frame = 0;
            const rects = measure();
            const ids = Object.keys(rects) as BlockId[];
            if (!ids.length) return;
            let ox = Infinity;
            let oy = Infinity;
            let ex = 0;
            let ey = 0;
            ids.forEach((id) => {
                const r = rects[id]!;
                ox = Math.min(ox, r.left);
                oy = Math.min(oy, r.top);
                ex = Math.max(ex, r.right);
                ey = Math.max(ey, r.bottom);
            });
            const payload: Record<string, unknown> = {
                accent: getComputedStyle(root).getPropertyValue('--color-plex').trim() || '245 158 11',
            };
            const zoom = Number.parseFloat(getComputedStyle(root).zoom || '1') || 1;
            ids.forEach((id) => {
                const r = rects[id]!;
                const data = contentRef.current[id] as { ep?: boolean } | null | undefined;
                const block: Record<string, unknown> = { ...(data as object), dx: r.left - ox, dy: r.top - oy, w: r.width, h: r.height };
                // Episode pages: type like the web block (size, weight, line height, colour), in viewport units.
                if (data?.ep && (id === 'heading' || id === 'synopsis')) {
                    const el = document.querySelector<HTMLElement>(SELECTORS[id]);
                    if (el) {
                        const cs = getComputedStyle(el);
                        const fs = Number.parseFloat(cs.fontSize) || 16;
                        block.fs = fs * zoom;
                        block.fw = Math.round(Number.parseFloat(cs.fontWeight) || 400);
                        block.lh = (Number.parseFloat(cs.lineHeight) || fs * 1.3) * zoom;
                        block.col = cs.color;
                    }
                }
                payload[id] = block;
            });
            const sig = JSON.stringify(payload);
            if (sig !== lastSet) {
                lastSet = sig;
                nativeDetailsTextSet(sig);
            }
            ids.forEach((id) => {
                if (!active.has(id)) {
                    active.add(id);
                    root.dataset[FLAG[id]] = '1';
                }
            });
            (Array.from(active) as BlockId[]).forEach((id) => {
                if (!rects[id]) {
                    active.delete(id);
                    delete root.dataset[FLAG[id]];
                }
            });
            const rectSig = `${ox}|${oy}|${ex - ox}|${ey - oy}`;
            if (rectSig === lastRect) return;
            lastRect = rectSig;
            nativeDetailsTextRect(ox, oy, ex - ox, ey - oy, window.innerWidth);
        };
        const queue = () => {
            if (!frame) frame = window.requestAnimationFrame(send);
        };
        const resend = () => {
            lastSet = '';
            queue();
        };
        apiRef.current = { queue, resend };

        const scroller = document.getElementById(PLAYER_SCROLL_ID);
        scroller?.addEventListener('scroll', queue, { passive: true });
        window.addEventListener('scroll', queue, { passive: true });
        window.addEventListener('resize', queue);
        const page = document.querySelector<HTMLElement>(ROOT);
        const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(queue) : null;
        if (observer && page) observer.observe(page);
        page?.addEventListener('transitionend', queue, true);
        page?.addEventListener('animationend', queue, true);
        const settle = [0, 120, 400, 1000, 2000].map((ms) => window.setTimeout(queue, ms));

        let suppressed = false;
        const syncSuppressed = () => {
            const on = nativeOverlayOpen(OVERLAY);
            if (on === suppressed) return;
            suppressed = on;
            nativeDetailRailSuppressed(on);
        };
        const overlayObserver = new MutationObserver(() => {
            syncSuppressed();
            queue();
        });
        overlayObserver.observe(document.body, { childList: true, subtree: true });
        const stopMenuFlag = watchNativeMenuFlag(syncSuppressed);
        const burst = () => {
            queue();
            if (performance.now() < burstUntil) window.requestAnimationFrame(burst);
        };
        const navObserver = new MutationObserver(() => {
            burstUntil = performance.now() + 700;
            burst();
        });
        navObserver.observe(root, { attributes: true, attributeFilter: ['data-tv-nav-open'] });
        const playerObserver = new MutationObserver(syncSuppressed);
        playerObserver.observe(root, { attributes: true, attributeFilter: ['data-native-player-open'] });
        syncSuppressed();
        queue();

        return () => {
            apiRef.current = null;
            overlayObserver.disconnect();
            stopMenuFlag();
            navObserver.disconnect();
            playerObserver.disconnect();
            observer?.disconnect();
            if (frame) window.cancelAnimationFrame(frame);
            settle.forEach((id) => window.clearTimeout(id));
            scroller?.removeEventListener('scroll', queue);
            window.removeEventListener('scroll', queue);
            window.removeEventListener('resize', queue);
            page?.removeEventListener('transitionend', queue, true);
            page?.removeEventListener('animationend', queue, true);
            (Object.values(FLAG)).forEach((flag) => { delete root.dataset[flag]; });
            nativeDetailsTextHide();
        };
    }, []);

    // New text: measure and send again.
    useEffect(() => {
        apiRef.current?.resend();
    }, [json]);

    return null;
};

/**
 * The page's studio / network / streaming mark for an item, ready for the native side: a TMDB URL, or (bundled SVG /
 * PNG marks the native side cannot load by path) the mark drawn to a small PNG and sent as base64.
 */
export const useNativeBrandMark = (item: PlayerItem | null | undefined) => {
    const pick = useServiceBrandPick(item);
    const path = pick ? String(pick.preferred.logoPath || '') : '';
    const isStatic = path.startsWith('/static/');
    const [bitmap, setBitmap] = useState<{ path: string; data: string }>({ path: '', data: '' });
    useEffect(() => {
        if (!isStatic) return undefined;
        let cancelled = false;
        const img = new Image();
        img.onload = () => {
            if (cancelled) return;
            try {
                const w = 300;
                const ratio = img.naturalWidth > 0 && img.naturalHeight > 0 ? img.naturalHeight / img.naturalWidth : 0.4;
                const canvas = document.createElement('canvas');
                canvas.width = w;
                canvas.height = Math.max(1, Math.round(w * ratio));
                canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height);
                setBitmap({ path, data: canvas.toDataURL('image/png').split(',')[1] || '' });
            } catch {
                /* no mark */
            }
        };
        img.src = discoveryLogoUrl(path, 300);
        return () => { cancelled = true; };
    }, [path, isStatic]);
    return {
        svc: path && !isStatic ? discoveryLogoUrl(path, 300) : '',
        svcData: isStatic && bitmap.path === path ? bitmap.data : '',
        svcColor: Boolean(pick?.preserveColor),
    };
};
