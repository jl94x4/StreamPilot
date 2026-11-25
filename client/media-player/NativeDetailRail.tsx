import React, { useEffect, useRef } from 'react';
import {
    nativeDetailRailFocus,
    nativeDetailRailHide,
    nativeDetailRailRect,
    nativeDetailRailSet,
    nativeDetailRailSuppressed,
    nativeHomeReleaseFocus,
    nativeRailInjectKey,
    onNativeHomeEvent,
} from '../plex-client/nativeHome';
import { answerNativeVertical, mirrorNativeCardFocus, nativeVerticalActive } from '../plex-client/useTvRemote';
import { PLAYER_SCROLL_ID } from './paths';

import { nativeOverlayOpen, watchNativeMenuFlag } from './nativeOverlay';
/**
 * Cast / guest-star / related rails of a TV details page, drawn by NativeDetailRail at the web rail's rect.
 * The web rail stays in the page (invisible, laid out, focusable) so Up / Down navigation, the held menu and the
 * open keep running on it; native owns Left / Right and hands every other key back. Renders nothing.
 */

export type DetailRailItem = {
    key: string;
    img: string;
    title: string;
    sub?: string;
    progress?: number;
    watched?: boolean;
};

type Kind = 'poster' | 'cast';

type Entry = {
    railId: string;
    rowId: string;
    kind: Kind;
    items: DetailRailItem[];
    sent: string;
    rectSig: string;
    /** The web rail is hidden (its page is covered by another, e.g. Search under a title page): native is hidden too. */
    hidden?: boolean;
    /** Just back in view: once it is drawn again, it takes the remote back if the page's focus is on one of its cards. */
    reshown?: boolean;
};

/**
 * The web rail has no size: its page is still mounted but not shown (Search stays mounted under the title page
 * opened from it). Hide the native rail, and forget what was sent so it is redrawn in full once the rail is back.
 * Skipping a zero size left the native rail drawn at its old place, over the page on top.
 */
const hideWhileHidden = (entry: Entry, scroller: HTMLElement) => {
    const r = scroller.getBoundingClientRect();
    if (r.width >= 2 && r.height >= 2) {
        if (entry.hidden) entry.reshown = true;
        entry.hidden = false;
        return false;
    }
    if (!entry.hidden) {
        entry.hidden = true;
        entry.sent = '';
        entry.rectSig = '';
        nativeDetailRailHide(entry.railId);
    }
    return true;
};

const OVERLAY = '[data-tv-item-menu="1"], [data-tv-select-menu="1"], [data-tv-resume-dialog="1"], [data-tv-season-watch-dialog="1"], [data-tv-still-watching-dialog="1"], [data-tv-whats-new="1"], [data-tv-home-switch="1"], [data-tv-library-manager="1"], [data-tv-version-dialog="1"], [data-tv-track-dialog="1"], [data-tv-settings-dialog="1"], [role="dialog"]';
const SEP = '~';

const entries = new Map<string, Entry>();
let teardown: (() => void) | null = null;
let handoffUntil = 0;
let holdOwner = '';

const num = (value: string | null | undefined, fallback: number) => {
    const n = Number.parseFloat(String(value || ''));
    return Number.isFinite(n) ? n : fallback;
};

const zoomOf = () => num(getComputedStyle(document.documentElement).zoom, 1) || 1;

const scrollerOf = (entry: Entry): HTMLElement | null => {
    const id = entry.rowId.replace(/["\\]/g, '\\$&');
    return document.querySelector<HTMLElement>(`[data-tv-row-id="${id}"] [data-tv-rail="1"]`);
};

const cardOf = (entry: Entry, key: string): HTMLElement | null => {
    const scroller = scrollerOf(entry);
    if (!scroller) return null;
    const id = key.replace(/["\\]/g, '\\$&');
    return scroller.querySelector<HTMLElement>(`[data-tv-key="${id}"]`);
};

const parseColor = (value: string, fallback: number[]) => {
    const m = String(value || '').match(/rgba?\(([^)]+)\)/);
    if (!m) return fallback;
    const parts = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) return fallback;
    return [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1];
};

const lineCount = (style: CSSStyleDeclaration, fallback: number) => {
    const clamp = Number.parseInt(style.getPropertyValue('-webkit-line-clamp'), 10);
    return Number.isFinite(clamp) && clamp > 0 ? clamp : fallback;
};

/** The web cards' real sizes (page layout px), read off the first card so the native ones line up with them. */
const measure = (entry: Entry, scroller: HTMLElement) => {
    const zoom = zoomOf();
    const sr = scroller.getBoundingClientRect();
    const sStyle = getComputedStyle(scroller);
    let card: HTMLElement | null;
    let img: HTMLElement | null;
    let title: HTMLElement | null;
    let sub: HTMLElement | null;
    if (entry.kind === 'cast') {
        card = scroller.querySelector<HTMLElement>('[data-tv-cast="1"]');
        img = card?.querySelector<HTMLElement>('[data-tv-cast-avatar="1"]') || null;
        title = card?.querySelector<HTMLElement>('.player-cast-name') || null;
        sub = card?.querySelector<HTMLElement>('.player-cast-role') || null;
    } else {
        img = scroller.querySelector<HTMLElement>('.player-poster-frame');
        const caption = scroller.querySelector<HTMLElement>('.player-poster-caption');
        card = img?.parentElement || null;
        while (card && caption && !card.contains(caption) && card !== scroller) card = card.parentElement;
        if (card === scroller) card = img;
        title = (caption?.children[0] as HTMLElement | undefined) || null;
        sub = (caption?.children[1] as HTMLElement | undefined) || null;
    }
    if (!card || !img) return null;
    const cr = card.getBoundingClientRect();
    const ir = img.getBoundingClientRect();
    if (cr.width < 2 || ir.width < 2) return null;
    // Gap: the second card's left edge less the first one's right edge.
    const all = Array.from(scroller.querySelectorAll<HTMLElement>(entry.kind === 'cast' ? '[data-tv-cast="1"]' : '.player-poster-frame'));
    const first = all[0]?.getBoundingClientRect();
    const second = all[1]?.getBoundingClientRect();
    const gap = first && second ? Math.max(0, second.left - first.right) : num(sStyle.columnGap, 16) * zoom;
    const tStyle = title ? getComputedStyle(title) : null;
    const sStyle2 = sub ? getComputedStyle(sub) : null;
    const tSize = num(tStyle?.fontSize, 16) * zoom;
    const sSize = num(sStyle2?.fontSize, 14) * zoom;
    const tr = title?.getBoundingClientRect();
    const sr2 = sub?.getBoundingClientRect();
    const capTopFrom = ir.bottom;
    const radius = num(getComputedStyle(img).borderTopLeftRadius, 6) * zoom;
    return {
        cardW: cr.width,
        imgW: ir.width,
        imgH: ir.height,
        gap,
        padL: num(sStyle.paddingLeft, 0) * zoom,
        padT: num(sStyle.paddingTop, 0) * zoom,
        padR: num(sStyle.paddingRight, 0) * zoom + 60,
        padB: Math.max(0, sr.height - (cr.top - sr.top) - cr.height),
        radius,
        circle: entry.kind === 'cast',
        center: entry.kind === 'cast',
        capTop: tr ? Math.max(0, tr.top - capTopFrom) : 8,
        titleSize: tSize,
        titleLine: num(tStyle?.lineHeight, tSize * 1.25 / zoom) * zoom,
        titleLines: tStyle ? lineCount(tStyle, 2) : 2,
        titleColor: parseColor(tStyle?.color || '', [255, 255, 255, 1]),
        titleBold: entry.kind === 'cast',
        subSize: sSize,
        subLine: num(sStyle2?.lineHeight, sSize * 1.4 / zoom) * zoom,
        subLines: sStyle2 ? lineCount(sStyle2, 1) : 1,
        subColor: parseColor(sStyle2?.color || '', [255, 255, 255, 0.6]),
        subTop: tr && sr2 ? Math.max(0, sr2.top - tr.bottom) : 2,
        menu: entry.kind === 'poster',
    };
};

const syncPayload = (entry: Entry) => {
    const scroller = scrollerOf(entry);
    if (!scroller) return;
    scroller.setAttribute('data-native-rail', entry.railId);
    if (hideWhileHidden(entry, scroller)) return;
    const layout = measure(entry, scroller);
    if (!layout) return;
    // Only cards the page has mounted: those are the ones the open / menu can reach.
    const present = new Set(Array.from(scroller.querySelectorAll<HTMLElement>('[data-tv-key]')).map((el) => el.getAttribute('data-tv-key') || ''));
    const items = entry.items
        .filter((it) => present.has(it.key))
        .map((it) => ({
            key: `${entry.railId}${SEP}${it.key}`,
            img: it.img,
            title: it.title,
            sub: it.sub || '',
            progress: Math.round((it.progress || 0) * 100) / 100,
            watched: it.watched === true,
        }));
    const json = JSON.stringify({ layout, items });
    if (json === entry.sent) return;
    entry.sent = json;
    nativeDetailRailSet(entry.railId, json);
};

const syncRect = (entry: Entry) => {
    const scroller = scrollerOf(entry);
    if (!scroller) return;
    if (hideWhileHidden(entry, scroller)) return;
    // Back in view (Back from the title page): send the cards again before the place.
    if (entry.reshown) syncPayload(entry);
    const r = scroller.getBoundingClientRect();
    const sig = `${r.left}|${r.top}|${r.width}|${r.height}`;
    if (sig !== entry.rectSig) {
        entry.rectSig = sig;
        nativeDetailRailRect(entry.railId, r.left, r.top, r.width, r.height, window.innerWidth);
    }
    if (entry.reshown) {
        entry.reshown = false;
        // The page put its focus back on this rail's card while the native rail was still hidden: hand it the remote,
        // or the page kept it and no card showed focus.
        const active = document.activeElement as HTMLElement | null;
        const key = active && scroller.contains(active) ? active.getAttribute('data-tv-key') : null;
        if (key && !navOpen() && !document.querySelector(OVERLAY)) giveToNative(entry.railId, key);
    }
};

const entryOfKey = (nativeKey: string) => {
    const at = nativeKey.indexOf(SEP);
    if (at < 0) return null;
    const entry = entries.get(nativeKey.slice(0, at));
    return entry ? { entry, key: nativeKey.slice(at + SEP.length) } : null;
};

const navOpen = () => document.documentElement.getAttribute('data-tv-nav-open') === '1';

/** Native takes the remote on a card the page just focused (retry: the rail may not have its cards yet). */
const giveToNative = (railId: string, key: string, tries = 12) => {
    void nativeDetailRailFocus(`${railId}${SEP}${key}`).then((found) => {
        if (found || tries <= 1) return;
        window.setTimeout(() => {
            const active = document.activeElement as HTMLElement | null;
            if (active?.getAttribute?.('data-tv-key') !== key) return;
            giveToNative(railId, key, tries - 1);
        }, 120);
    });
};

const install = () => {
    const root = document.documentElement;
    root.dataset.nativeRails = '1';
    let frame = 0;
    const tick = () => {
        frame = 0;
        entries.forEach(syncRect);
    };
    const queue = () => {
        if (!frame) frame = window.requestAnimationFrame(tick);
    };
    const queueAll = () => {
        entries.forEach(syncPayload);
        queue();
    };
    const scroller = document.getElementById(PLAYER_SCROLL_ID);
    scroller?.addEventListener('scroll', queue, { passive: true });
    // The details page scrolls the window itself (the scroller element stays put).
    window.addEventListener('scroll', queue, { passive: true });
    // Any inner scroller too (the search results panel scrolls on its own).
    document.addEventListener('scroll', queue, { capture: true, passive: true });
    window.addEventListener('resize', queueAll);
    const settle = [0, 150, 500, 1200, 2500].map((ms) => window.setTimeout(queueAll, ms));
    const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(queueAll) : null;
    const detailsRoot = document.querySelector<HTMLElement>('[data-tv-details="1"], [data-tv-search="1"]');
    if (resize && detailsRoot) resize.observe(detailsRoot);
    const rootAnim = () => queue();
    detailsRoot?.addEventListener('transitionend', rootAnim, true);
    detailsRoot?.addEventListener('animationend', rootAnim, true);
    // The cards mount a few at a time: re-read the rail when its children change.
    const mutate = new MutationObserver(() => {
        entries.forEach(syncPayload);
        queue();
    });
    if (detailsRoot) mutate.observe(detailsRoot, { childList: true, subtree: true });

    // A menu / dialog or the sidebar over the page: the rails (above the WebView) must not draw over it.
    let suppressed = false;
    const syncSuppressed = () => {
        const on = nativeOverlayOpen(OVERLAY);
        if (on === suppressed) return;
        suppressed = on;
        nativeDetailRailSuppressed(on);
    };
    const overlayObserver = new MutationObserver(syncSuppressed);
    overlayObserver.observe(document.body, { childList: true, subtree: true });
    const stopMenuFlag = watchNativeMenuFlag(syncSuppressed);
    let burstUntil = 0;
    const burst = () => {
        queue();
        if (performance.now() < burstUntil) window.requestAnimationFrame(burst);
    };
    const navObserver = new MutationObserver(() => {
        burstUntil = performance.now() + 700;
        burst();
    });
    navObserver.observe(root, { attributes: true, attributeFilter: ['data-tv-nav-open'] });
    syncSuppressed();

    let bounceTimer = 0;
    const offFocus = onNativeHomeEvent('railFocus', (data) => {
        const hit = entryOfKey(String(data.key || ''));
        if (!hit) return;
        mirrorNativeCardFocus(cardOf(hit.entry, hit.key));
    });
    const offOpen = onNativeHomeEvent('railOpen', (data) => {
        const hit = entryOfKey(String(data.key || ''));
        const el = hit ? cardOf(hit.entry, hit.key) : null;
        if (!el) return;
        void nativeHomeReleaseFocus().then(() => el.click());
    });
    const offLong = onNativeHomeEvent('railLongPress', (data) => {
        const hit = entryOfKey(String(data.key || ''));
        const el = hit ? cardOf(hit.entry, hit.key) : null;
        if (!hit || !el) return;
        holdOwner = hit.entry.railId;
        window.dispatchEvent(new CustomEvent('smp-tv-poster-menu', { detail: { ratingKey: hit.key, poster: el, handled: false } }));
    });
    const offActivity = onNativeHomeEvent('railActivity', () => {
        if (!entries.size) return;
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Unidentified', keyCode: 0, cancelable: true }));
    });
    const offHoldEnd = onNativeHomeEvent('railHoldEnd', () => {
        if (document.documentElement.dataset.nativeMenu === '1') return; // the native menu holds the keys
        if (!holdOwner || !entries.has(holdOwner)) return;
        holdOwner = '';
        void nativeHomeReleaseFocus().then(() => {
            window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', keyCode: 13, cancelable: true }));
        });
    });
    // Up / Down / Left at the first card: the page focuses the hidden card, then the key runs through its own navigation.
    const handoff = (data: { rowId?: string; key?: string }) => {
        const hit = entryOfKey(String(data.key || ''));
        const dir = String(data.rowId || '');
        if (!hit || !mirrorNativeCardFocus(cardOf(hit.entry, hit.key))) return;
        handoffUntil = Date.now() + 600;
        void nativeRailInjectKey(dir).then(() => {
            window.clearTimeout(bounceTimer);
            // The key found nowhere to go: the remote belongs on the rail again.
            bounceTimer = window.setTimeout(() => {
                const active = document.activeElement as HTMLElement | null;
                const owner = active?.closest?.<HTMLElement>('[data-native-rail]');
                if (!owner || document.querySelector(OVERLAY) || navOpen()) return;
                const key = active?.getAttribute('data-tv-key') || active?.closest<HTMLElement>('[data-tv-key]')?.getAttribute('data-tv-key') || '';
                const railId = owner.getAttribute('data-native-rail') || '';
                if (key && railId) giveToNative(railId, key);
            }, 400);
        });
    };
    const offHandoff = onNativeHomeEvent('railHandoff', handoff);
    // Up / Down on the title page: step straight to the next native row when that is where the page would go.
    const offVertical = onNativeHomeEvent('railVertical', (data) => {
        const hit = entryOfKey(String(data.key || ''));
        if (!hit) return;
        const dir = String(data.rowId || '');
        const from = cardOf(hit.entry, hit.key);
        if (from && answerNativeVertical(from, dir, () => { void nativeDetailRailFocus(`${hit.entry.railId}${SEP}${hit.key}`); })) {
            handoffUntil = Date.now() + 500;
            return;
        }
        // The WebView settles its own focus for a moment after taking the remote: run the key once it has.
            void nativeHomeReleaseFocus().then(() => window.setTimeout(() => handoff(data), 60));
    });
    // Web focus landed on a hidden card (Down from the buttons, the sidebar closing, the page opening): native takes over.
    const onFocusIn = (event: FocusEvent) => {
        const target = event.target as HTMLElement | null;
        const owner = target?.closest?.<HTMLElement>('[data-native-rail]');
        if (!owner || Date.now() < handoffUntil || nativeVerticalActive()) return;
        if (document.querySelector(OVERLAY) || navOpen()) return;
        const holder = target?.closest<HTMLElement>('[data-tv-key]');
        const key = holder?.getAttribute('data-tv-key') || '';
        const railId = owner.getAttribute('data-native-rail') || '';
        if (key && railId && entries.has(railId)) giveToNative(railId, key);
    };
    document.addEventListener('focusin', onFocusIn, true);

    return () => {
        delete root.dataset.nativeRails;
        document.removeEventListener('focusin', onFocusIn, true);
        window.clearTimeout(bounceTimer);
        if (frame) window.cancelAnimationFrame(frame);
        settle.forEach((id) => window.clearTimeout(id));
        scroller?.removeEventListener('scroll', queue);
        window.removeEventListener('scroll', queue);
        document.removeEventListener('scroll', queue, true);
        window.removeEventListener('resize', queueAll);
        detailsRoot?.removeEventListener('transitionend', rootAnim, true);
        detailsRoot?.removeEventListener('animationend', rootAnim, true);
        resize?.disconnect();
        mutate.disconnect();
        overlayObserver.disconnect();
        stopMenuFlag();
        navObserver.disconnect();
        offFocus();
        offOpen();
        offLong();
        offActivity();
        offHoldEnd();
        offHandoff();
        offVertical();
        if (suppressed) nativeDetailRailSuppressed(false);
    };
};

export const NativeDetailRail: React.FC<{
    railId: string;
    /** The section's data-tv-row-id. */
    rowId: string;
    kind: Kind;
    items: DetailRailItem[];
}> = ({ railId, rowId, kind, items }) => {
    const itemsRef = useRef(items);
    itemsRef.current = items;

    useEffect(() => {
        const entry: Entry = { railId, rowId, kind, items: itemsRef.current, sent: '', rectSig: '' };
        entries.set(railId, entry);
        if (!teardown) teardown = install();
        syncPayload(entry);
        syncRect(entry);
        return () => {
            entries.delete(railId);
            nativeDetailRailHide(railId);
            const scroller = scrollerOf(entry);
            scroller?.removeAttribute('data-native-rail');
            if (!entries.size && teardown) {
                teardown();
                teardown = null;
            }
        };
    }, [railId, rowId, kind]);

    useEffect(() => {
        const entry = entries.get(railId);
        if (!entry) return;
        entry.items = items;
        syncPayload(entry);
    }, [railId, items]);

    return null;
};
