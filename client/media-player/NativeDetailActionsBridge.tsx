import React, { useEffect } from 'react';
import {
    nativeDetailActionsHide,
    nativeDetailActionsRect,
    nativeDetailActionsSet,
    nativeDetailRailFocus,
    nativeDetailRailSuppressed,
    nativeHomeReleaseFocus,
    onNativeHomeEvent,
} from '../plex-client/nativeHome';
import { answerNativeVertical, mirrorNativeCardFocus, nativeVerticalActive } from '../plex-client/useTvRemote';
import { PLAYER_SCROLL_ID } from './paths';

/**
 * Android TV details page: the action buttons (Play / Resume, restart, trailer, watched, watchlist, more ...) are
 * drawn by NativeDetailActions at the web row's rect. The web buttons stay in the page (invisible, laid out,
 * focusable) so every click, menu and dialog keeps running on them; native owns Left / Right and hands Up / Down /
 * Left-at-the-edge back. Renders nothing.
 */

const ROW = '[data-tv-details="1"] [data-tv-action-row="1"]';
const BTN = '[data-tv-action="1"][data-tv-key]';
const PREFIX = 'actions~';
const OVERLAY = '[data-tv-item-menu="1"], [data-tv-select-menu="1"], [data-tv-resume-dialog="1"], [data-tv-season-watch-dialog="1"], [data-tv-still-watching-dialog="1"], [data-tv-whats-new="1"], [data-tv-home-switch="1"], [data-tv-library-manager="1"], [data-tv-version-dialog="1"], [data-tv-track-dialog="1"], [data-tv-settings-dialog="1"], [data-native-player-open="1"], [role="dialog"]';

const num = (value: string | null | undefined, fallback: number) => {
    const n = Number.parseFloat(String(value || ''));
    return Number.isFinite(n) ? n : fallback;
};

type IconPair = { n: string; f: string };
const icons = new Map<string, IconPair | 'pending'>();

const rgbOf = (value: string) => {
    const m = String(value || '').match(/(\d+(?:\.\d+)?)[ ,]+(\d+(?:\.\d+)?)[ ,]+(\d+(?:\.\d+)?)/);
    return m ? `rgb(${Math.round(Number(m[1]))},${Math.round(Number(m[2]))},${Math.round(Number(m[3]))})` : 'rgb(245,158,11)';
};

const NS = 'http://www.w3.org/2000/svg';

/** One svg drawn to a small PNG (base64) with its "current colour" strokes / fills set to `cur`. */
const rasterSvg = (svg: SVGSVGElement, cur: string, accent: string): Promise<string> => new Promise((resolve) => {
    try {
        const vb = (svg.getAttribute('viewBox') || '0 0 24 24').split(/[ ,]+/).map(Number);
        const vw = vb[2] || 24;
        const vh = vb[3] || 24;
        const plex = /(^|\s)(text-plex|fill-plex)(\s|$)/.test(svg.getAttribute('class') || '');
        const color = plex ? accent : cur;
        const baseColor = getComputedStyle(svg).color;
        const clone = svg.cloneNode(true) as SVGSVGElement;
        const origs = [svg, ...Array.from(svg.querySelectorAll('*'))] as Element[];
        const clones = [clone, ...Array.from(clone.querySelectorAll('*'))] as Element[];
        origs.forEach((orig, i) => {
            const target = clones[i];
            if (!target) return;
            const cs = getComputedStyle(orig);
            const pick = (v: string) => (!v || v === 'none' ? 'none' : (v === baseColor ? color : v));
            if (i > 0) {
                target.setAttribute('fill', pick(cs.fill));
                target.setAttribute('stroke', pick(cs.stroke));
                target.setAttribute('stroke-width', cs.strokeWidth);
                target.setAttribute('stroke-opacity', cs.strokeOpacity);
                target.setAttribute('fill-opacity', cs.fillOpacity);
                if (cs.strokeDasharray && cs.strokeDasharray !== 'none') target.setAttribute('stroke-dasharray', cs.strokeDasharray);
                target.setAttribute('stroke-linecap', cs.strokeLinecap);
                target.setAttribute('stroke-linejoin', cs.strokeLinejoin);
            }
            target.removeAttribute('class');
            target.removeAttribute('style');
        });
        const t = getComputedStyle(svg).transform;
        const m = t && t !== 'none' ? t.match(/matrix\(([^)]+)\)/) : null;
        if (m) {
            const p = m[1].split(',').map((v) => Number(v.trim()));
            const cx = vb[0] + vw / 2;
            const cy = vb[1] + vh / 2;
            const g = document.createElementNS(NS, 'g');
            g.setAttribute('transform', `translate(${cx} ${cy}) matrix(${p[0]} ${p[1]} ${p[2]} ${p[3]} 0 0) translate(${-cx} ${-cy})`);
            while (clone.firstChild) g.appendChild(clone.firstChild);
            clone.appendChild(g);
        }
        const long = 96;
        const cw = vw >= vh ? long : Math.round(long * vw / vh);
        const ch = vh >= vw ? long : Math.round(long * vh / vw);
        clone.setAttribute('xmlns', NS);
        clone.setAttribute('width', String(cw));
        clone.setAttribute('height', String(ch));
        const text = new XMLSerializer().serializeToString(clone);
        const img = new Image();
        img.onload = () => {
            try {
                const canvas = document.createElement('canvas');
                canvas.width = cw;
                canvas.height = ch;
                canvas.getContext('2d')?.drawImage(img, 0, 0, cw, ch);
                resolve(canvas.toDataURL('image/png').split(',')[1] || '');
            } catch {
                resolve('');
            }
        };
        img.onerror = () => resolve('');
        img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`;
    } catch {
        resolve('');
    }
});

const DARK = 'rgb(11,11,13)';
const INK = 'rgb(17,17,17)';
const WHITE = 'rgb(255,255,255)';

export const NativeDetailActionsBridge: React.FC = () => {
    useEffect(() => {
        const root = document.documentElement;
        let frame = 0;
        let lastSet = '';
        let lastRect = '';
        let sentOnce = false;
        let handoffUntil = 0;
        let mirroring = '';
        let mirroringAt = 0;
        let bounceTimer = 0;
        let reTimer = 0;
        let rowObserver: MutationObserver | null = null;
        let observedRow: Element | null = null;

        const rowEl = () => document.querySelector<HTMLElement>(ROW);
        const twinOf = (key: string) => {
            const row = rowEl();
            if (!row) return null;
            return row.querySelector<HTMLElement>(`[data-tv-key="${key.replace(/["\\]/g, '\\$&')}"]`);
        };
        const navOpen = () => root.getAttribute('data-tv-nav-open') === '1';
        const zoomOf = () => num(getComputedStyle(root).zoom, 1) || 1;

        const ensureIcon = (svg: SVGSVGElement, primary: boolean, accent: string): IconPair | null => {
            const key = `${svg.outerHTML}|${primary ? 1 : 0}|${accent}`;
            const hit = icons.get(key);
            if (hit && hit !== 'pending') return hit;
            if (hit === 'pending') return null;
            icons.set(key, 'pending');
            void Promise.all([
                rasterSvg(svg, primary ? INK : WHITE, accent),
                rasterSvg(svg, primary ? INK : DARK, accent),
            ]).then(([n, f]) => {
                icons.set(key, { n, f });
                queue();
            });
            return null;
        };

        const labelOf = (btn: HTMLElement, row: DOMRect, zoom: number) => {
            const walker = document.createTreeWalker(btn, NodeFilter.SHOW_TEXT);
            let node = walker.nextNode();
            while (node) {
                const text = (node.textContent || '').trim();
                const parent = node.parentElement;
                if (text && parent) {
                    const cs = getComputedStyle(parent);
                    if (cs.display !== 'none' && cs.visibility !== 'hidden') {
                        const range = document.createRange();
                        range.selectNodeContents(node);
                        const r = range.getBoundingClientRect();
                        if (r.width > 0) {
                            return {
                                t: text.replace(/\s+/g, ' '),
                                x: r.left - row.left,
                                y: r.top - row.top,
                                w: r.width,
                                h: r.height,
                                size: num(cs.fontSize, 16) * zoom,
                                weight: Math.round(num(cs.fontWeight, 500)),
                            };
                        }
                    }
                }
                node = walker.nextNode();
            }
            return null;
        };

        const syncPayload = () => {
            const row = rowEl();
            if (!row) return;
            if (observedRow !== row) {
                rowObserver?.disconnect();
                observedRow = row;
                rowObserver = new MutationObserver(queue);
                rowObserver.observe(row, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'disabled', 'aria-disabled', 'aria-label', 'data-tv-resume', 'style'] });
            }
            const rr = row.getBoundingClientRect();
            if (rr.width < 2 || rr.height < 2) return;
            const zoom = zoomOf();
            const accent = rgbOf(getComputedStyle(root).getPropertyValue('--color-plex'));
            const items: Array<Record<string, unknown>> = [];
            let pending = false;
            const buttons = Array.from(row.querySelectorAll<HTMLElement>(BTN))
                .map((btn) => ({ btn, r: btn.getBoundingClientRect() }))
                .filter(({ btn, r }) => r.width > 2 && r.height > 2 && getComputedStyle(btn).display !== 'none')
                .sort((a, b) => (Math.abs(a.r.top - b.r.top) > 6 ? a.r.top - b.r.top : a.r.left - b.r.left));
            buttons.forEach(({ btn, r }) => {
                const primary = btn.hasAttribute('data-tv-play');
                const item: Record<string, unknown> = {
                    key: btn.getAttribute('data-tv-key') || '',
                    primary,
                    dis: btn.hasAttribute('disabled') || btn.getAttribute('aria-disabled') === 'true',
                    x: r.left - rr.left,
                    y: r.top - rr.top,
                    w: r.width,
                    h: r.height,
                    bw: num(getComputedStyle(btn).borderTopWidth, 1) * zoom,
                };
                const svg = btn.querySelector<SVGSVGElement>('svg');
                if (svg) {
                    const sr = svg.getBoundingClientRect();
                    const pair = ensureIcon(svg, primary, accent);
                    if (!pair) pending = true;
                    else item.icon = { x: sr.left - rr.left, y: sr.top - rr.top, w: sr.width, h: sr.height, n: pair.n, f: pair.f, s: String(pair.n.length) };
                }
                const label = labelOf(btn, rr, zoom);
                if (label) item.label = label;
                items.push(item);
            });
            if (!items.length) return;
            // Icons are drawn off-screen first: send once they are ready so the row never shows without them.
            if (pending && !sentOnce) return;
            const payload = JSON.stringify({ accent, items });
            if (payload !== lastSet) {
                lastSet = payload;
                nativeDetailActionsSet(payload);
            }
            if (!sentOnce) {
                sentOnce = true;
                root.dataset.nativeAct = '1';
                // The page may already have focused a button before native had the row: native takes the remote now.
                const active = document.activeElement as HTMLElement | null;
                if (active && row.contains(active) && active.matches(BTN) && !document.querySelector(OVERLAY) && !navOpen()) {
                    giveToNative(active.getAttribute('data-tv-key') || '');
                }
            }
        };

        const syncRect = () => {
            const row = rowEl();
            if (!row || !sentOnce) return;
            const r = row.getBoundingClientRect();
            if (r.width < 2 || r.height < 2) return;
            const sig = `${r.left}|${r.top}|${r.width}|${r.height}`;
            if (sig === lastRect) return;
            lastRect = sig;
            nativeDetailActionsRect(r.left, r.top, r.width, r.height, window.innerWidth);
        };

        let rectFrame = 0;
        const tick = () => {
            frame = 0;
            syncPayload();
            syncRect();
        };
        function queue() {
            if (!frame) frame = window.requestAnimationFrame(tick);
        }
        const queueRect = () => {
            if (frame || rectFrame) return;
            rectFrame = window.requestAnimationFrame(() => {
                rectFrame = 0;
                syncRect();
            });
        };

        function giveToNative(key: string, tries = 12) {
            if (!key) return;
            void nativeDetailRailFocus(`${PREFIX}${key}`).then((found) => {
                if (found || tries <= 1) return;
                window.setTimeout(() => {
                    const active = document.activeElement as HTMLElement | null;
                    if (active?.getAttribute?.('data-tv-key') !== key) return;
                    giveToNative(key, tries - 1);
                }, 120);
            });
        }

        const scroller = document.getElementById(PLAYER_SCROLL_ID);
        scroller?.addEventListener('scroll', queueRect, { passive: true });
        window.addEventListener('scroll', queueRect, { passive: true });
        window.addEventListener('resize', queue);
        const detailsRoot = document.querySelector<HTMLElement>('[data-tv-details="1"]');
        const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(queue) : null;
        if (resize && detailsRoot) resize.observe(detailsRoot);
        const anim = () => queue();
        detailsRoot?.addEventListener('transitionend', anim, true);
        detailsRoot?.addEventListener('animationend', anim, true);
        // The row mounts after the details load: re-read when the page's children change (childList only, cheap).
        const mount = new MutationObserver(queue);
        if (detailsRoot) mount.observe(detailsRoot, { childList: true, subtree: true });
        const settle = [0, 150, 500, 1200, 2500].map((ms) => window.setTimeout(queue, ms));

        let suppressed = false;
        const syncSuppressed = () => {
            const on = !!document.querySelector(OVERLAY);
            if (on === suppressed) return;
            suppressed = on;
            nativeDetailRailSuppressed(on);
            if (!on) {
                // A menu / dialog closed: the page puts focus back on a button; native takes the remote again.
                window.clearTimeout(reTimer);
                reTimer = window.setTimeout(() => {
                    const active = document.activeElement as HTMLElement | null;
                    const row = rowEl();
                    if (!active || !row || !row.contains(active) || !active.matches(BTN)) return;
                    if (document.querySelector(OVERLAY) || navOpen()) return;
                    giveToNative(active.getAttribute('data-tv-key') || '');
                }, 140);
            }
        };
        const overlayObserver = new MutationObserver(syncSuppressed);
        overlayObserver.observe(document.body, { childList: true, subtree: true });
        let burstUntil = 0;
        const burst = () => {
            queue();
            if (performance.now() < burstUntil) window.requestAnimationFrame(burst);
        };
        const navObserver = new MutationObserver(() => {
            burstUntil = performance.now() + 700;
            burst();
            if (root.getAttribute('data-tv-nav-open') !== '1') {
                window.clearTimeout(reTimer);
                reTimer = window.setTimeout(() => {
                    const active = document.activeElement as HTMLElement | null;
                    const row = rowEl();
                    if (!active || !row || !row.contains(active) || !active.matches(BTN)) return;
                    if (document.querySelector(OVERLAY) || navOpen()) return;
                    giveToNative(active.getAttribute('data-tv-key') || '');
                }, 140);
            }
        });
        navObserver.observe(root, { attributes: true, attributeFilter: ['data-tv-nav-open'] });
        const playerObserver = new MutationObserver(syncSuppressed);
        playerObserver.observe(root, { attributes: true, attributeFilter: ['data-native-player-open'] });
        syncSuppressed();

        const mine = (data: { key?: string }) => {
            const key = String(data.key || '');
            return key.startsWith(PREFIX) ? key.slice(PREFIX.length) : '';
        };
        const offFocus = onNativeHomeEvent('railFocus', (data) => {
            const key = mine(data);
            const el = key ? twinOf(key) : null;
            if (!el) return;
            mirroring = key;
            mirroringAt = Date.now();
            mirrorNativeCardFocus(el);
        });
        const offOpen = onNativeHomeEvent('railOpen', (data) => {
            const key = mine(data);
            const el = key ? twinOf(key) : null;
            if (!el) return;
            void nativeHomeReleaseFocus().then(() => {
                el.click();
                // Toggles (watched, watchlist) stay on the page: native takes the remote back unless a menu / dialog / the player opened.
                window.clearTimeout(reTimer);
                reTimer = window.setTimeout(() => {
                    if (document.querySelector(OVERLAY) || navOpen()) return;
                    const active = document.activeElement as HTMLElement | null;
                    if (!active || !el.isConnected || active !== el) return;
                    giveToNative(key);
                }, 320);
            });
        });
        const offActivity = onNativeHomeEvent('railActivity', () => {
            if (!sentOnce) return;
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Unidentified', keyCode: 0, cancelable: true }));
        });
        const handoff = (data: { rowId?: string; key?: string }) => {
            const key = mine(data);
            const dir = String(data.rowId || '');
            const el = key ? twinOf(key) : null;
            if (!el) return;
            // Before the focus moves: the page's focusin on this button must not give the remote straight back.
            handoffUntil = Date.now() + 900;
            if (!mirrorNativeCardFocus(el)) return;
            // The key runs through the page's own navigation, sent from here (a key injected from native lands on the
            // app root: the WebView refocuses it while taking the remote back).
            const codes: Record<string, [string, number]> = { up: ['ArrowUp', 38], down: ['ArrowDown', 40], left: ['ArrowLeft', 37], right: ['ArrowRight', 39] };
            const code = codes[dir];
            if (!code) return;
            window.setTimeout(() => {
                if (!el.isConnected) return;
                if (document.activeElement !== el) mirrorNativeCardFocus(el);
                const init = { key: code[0], code: code[0], keyCode: code[1], which: code[1], bubbles: true, cancelable: true };
                (document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', init));
                window.setTimeout(() => (document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keyup', init)), 40);
                window.clearTimeout(bounceTimer);
                // The key found nowhere to go: the remote belongs on the buttons again.
                bounceTimer = window.setTimeout(() => {
                    const active = document.activeElement as HTMLElement | null;
                    const row = rowEl();
                    if (!active || !row || !row.contains(active) || !active.matches(BTN)) return;
                    if (document.querySelector(OVERLAY) || navOpen()) return;
                    giveToNative(active.getAttribute('data-tv-key') || '');
                }, 450);
            }, 80);
        };
        const offHandoff = onNativeHomeEvent('railHandoff', handoff);
        // Up / Down: straight to the native row the page would reach (cast / related), skipping the page round trip.
        const offVertical = onNativeHomeEvent('railVertical', (data) => {
            const key = mine(data);
            if (!key) return;
            const dir = String(data.rowId || '');
            const from = twinOf(key);
            if (from && answerNativeVertical(from, dir, () => { void nativeDetailRailFocus(`${PREFIX}${key}`); })) {
                handoffUntil = Date.now() + 500;
                return;
            }
            // The WebView settles its own focus for a moment after taking the remote: run the key once it has.
            void nativeHomeReleaseFocus().then(() => window.setTimeout(() => handoff(data), 60));
        });
        // Web focus landed on a hidden button (Up from the rail below, a dialog closing, the page opening): native takes over.
        const onFocusIn = (event: FocusEvent) => {
            if (!sentOnce || Date.now() < handoffUntil || nativeVerticalActive()) return;
            const target = event.target as HTMLElement | null;
            if (!target?.matches?.(BTN)) return;
            const row = rowEl();
            if (!row || !row.contains(target)) return;
            if (document.querySelector(OVERLAY) || navOpen()) return;
            const key = target.getAttribute('data-tv-key') || '';
            // Our own mirror of a native move: native already has it.
            if (key === mirroring && Date.now() - mirroringAt < 400) return;
            giveToNative(key);
        };
        document.addEventListener('focusin', onFocusIn, true);

        queue();

        return () => {
            delete root.dataset.nativeAct;
            document.removeEventListener('focusin', onFocusIn, true);
            window.clearTimeout(bounceTimer);
            window.clearTimeout(reTimer);
            if (frame) window.cancelAnimationFrame(frame);
            if (rectFrame) window.cancelAnimationFrame(rectFrame);
            settle.forEach((id) => window.clearTimeout(id));
            scroller?.removeEventListener('scroll', queueRect);
            window.removeEventListener('scroll', queueRect);
            window.removeEventListener('resize', queue);
            detailsRoot?.removeEventListener('transitionend', anim, true);
            detailsRoot?.removeEventListener('animationend', anim, true);
            resize?.disconnect();
            mount.disconnect();
            rowObserver?.disconnect();
            overlayObserver.disconnect();
            navObserver.disconnect();
            playerObserver.disconnect();
            offFocus();
            offOpen();
            offActivity();
            offHandoff();
            offVertical();
            nativeDetailActionsHide();
        };
    }, []);

    return null;
};
