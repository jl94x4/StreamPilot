import React, { useEffect, useState } from 'react';
import {
    isNativeHomeSupported,
    nativeDetailRailFocus,
    nativeHomeReleaseFocus,
    nativeLibHeaderHide,
    nativeLibHeaderSet,
    onNativeHomeEvent,
} from '../plex-client/nativeHome';
import { mirrorNativeCardFocus } from '../plex-client/useTvRemote';
import { PERF_FLAGS_EVENT, readPerfFlags } from './PlayerPerfOverlay';
import { svgPaths } from './nativeScan';

/**
 * Android TV library page: the title and the tab pills (Recommended / Browse / Collections / Studios) are drawn by
 * NativeLibHeader. The web copies stay mounted (invisible, laid out, focusable) and stay the source of truth: every
 * press clicks the matching web tab. On the Browse tab the header scrolls with the grid; native does that itself.
 * Renders nothing.
 */

const ROOT = '[data-tv-library="1"]';
const TABS = '[data-tv-library-tabs="1"]';
const FILTERS = '[data-tv-library-filters="1"]';
const BTN = '[data-tv-key]';
const PREFIX = 'lh~';
const OVERLAY = '[data-tv-item-menu="1"], [data-tv-select-menu="1"], [data-tv-resume-dialog="1"], [data-tv-season-watch-dialog="1"], [data-tv-still-watching-dialog="1"], [data-tv-whats-new="1"], [data-tv-home-switch="1"], [data-tv-library-manager="1"], [data-tv-version-dialog="1"], [data-tv-track-dialog="1"], [data-tv-settings-dialog="1"], [data-tv-filter-sheet="1"], [data-native-player-open="1"], [role="dialog"]';

const num = (value: string | null | undefined, fallback: number) => {
    const n = Number.parseFloat(String(value || ''));
    return Number.isFinite(n) ? n : fallback;
};
const f = (n: number) => Math.round(n * 100) / 100;
const clean = (value: string | null | undefined) => String(value || '').replace(/\s+/g, ' ').trim();

const argb = (value: string): number => {
    const m = String(value || '').match(/rgba?\(([^)]+)\)/);
    if (!m) return 0;
    const parts = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) return 0;
    const a = Math.round((parts.length > 3 ? parts[3] : 1) * 255);
    if (a <= 0) return 0;
    return ((a << 24) | (parts[0] << 16) | (parts[1] << 8) | parts[2]) | 0;
};

const visualScale = (el: HTMLElement, r: DOMRect) => {
    const h = el.offsetHeight;
    return h > 0 && r.height > 0 ? r.height / h : 1;
};

/** The vertical translate (visual px) the page applies to the header block that holds `el`. */
const shiftOf = (el: HTMLElement, root: HTMLElement, zoom: number) => {
    let node: HTMLElement | null = el;
    while (node && node.parentElement !== root) node = node.parentElement;
    if (!node) return 0;
    const t = getComputedStyle(node).transform;
    if (!t || t === 'none') return 0;
    const m = t.match(/matrix(?:3d)?\(([^)]+)\)/);
    if (!m) return 0;
    const v = m[1].split(',').map(Number);
    const ty = v.length === 16 ? v[13] : v[5];
    return Number.isFinite(ty) ? ty * zoom : 0;
};

export const NativeLibHeaderBridge: React.FC = () => {
    const [flag, setFlag] = useState(() => readPerfFlags().nativeHome);
    useEffect(() => {
        const onFlags = () => setFlag(readPerfFlags().nativeHome);
        window.addEventListener(PERF_FLAGS_EVENT, onFlags);
        return () => window.removeEventListener(PERF_FLAGS_EVENT, onFlags);
    }, []);
    const on = flag && isNativeHomeSupported() && document.documentElement.dataset.tv === '1';

    useEffect(() => {
        if (!on) return undefined;
        const html = document.documentElement;
        let frame = 0;
        let lastSet = '';
        let sentOnce = false;
        let handoffUntil = 0;
        let mirroring = '';
        let mirroringAt = 0;
        let bounceTimer = 0;
        let reTimer = 0;
        let timer = 0;

        const rootEl = () => document.querySelector<HTMLElement>(ROOT);
        const tabsEl = () => rootEl()?.querySelector<HTMLElement>(TABS) || null;
        const controlsOf = () => Array.from(
            rootEl()?.querySelectorAll<HTMLElement>(`${TABS} ${BTN}, ${FILTERS} ${BTN}`) || [],
        );
        const twinOf = (key: string) => controlsOf().find((el) => el.getAttribute('data-tv-key') === key) || null;
        const navOpen = () => html.getAttribute('data-tv-nav-open') === '1';
        const blocked = () => !!document.querySelector(OVERLAY);
        const isTab = (el: HTMLElement | null) => !!el && (!!el.closest(TABS) || !!el.closest(FILTERS)) && el.matches(BTN);

        const scan = () => {
            const root = rootEl();
            const bar = tabsEl();
            if (!root || !bar) return null;
            const zoom = num(getComputedStyle(html).zoom, 1) || 1;
            const buttons = Array.from(bar.querySelectorAll<HTMLElement>(BTN));
            if (!buttons.length) return null;
            const br = bar.getBoundingClientRect();
            if (br.width < 2) return null;
            const follow = !root.querySelector('.player-library-stage-chrome') && !bar.closest('.player-library-stage-chrome');
            const shift = follow ? shiftOf(bar, root, zoom) : 0;
            let size = 16;
            let weight = 700;
            let sp = 0;
            const tabs = buttons.map((btn, i) => {
                const r = btn.getBoundingClientRect();
                const cs = getComputedStyle(btn);
                if (i === 0) {
                    size = num(cs.fontSize, 16) * visualScale(btn, r);
                    weight = Math.round(num(cs.fontWeight, 700));
                    sp = num(cs.letterSpacing, 0) / Math.max(1, num(cs.fontSize, 16));
                }
                return {
                    k: btn.getAttribute('data-tv-key') || '',
                    t: clean(btn.textContent),
                    a: btn.getAttribute('aria-current') === 'page',
                    x: f(r.left),
                    y: f(r.top - shift),
                    w: f(r.width),
                    h: f(r.height),
                    c: argb(cs.color),
                    bg: argb(cs.backgroundColor),
                };
            });
            const h1 = root.querySelector<HTMLElement>('.player-library-title');
            // The sort / Filters buttons and the title count under the tabs (Browse tab).
            const rowShift = (el: HTMLElement) => (follow ? shiftOf(el, root, zoom) : 0);
            const controls = Array.from(root.querySelectorAll<HTMLElement>(`${FILTERS} ${BTN}`)).map((btn) => {
                const r = btn.getBoundingClientRect();
                const cs = getComputedStyle(btn);
                const vs = visualScale(btn, r);
                const span = Array.from(btn.querySelectorAll<HTMLElement>('span')).find((el) => clean(el.textContent) && !el.querySelector('svg')) || null;
                const sr = span?.getBoundingClientRect();
                const label = Array.from(btn.querySelectorAll<HTMLElement>('span')).map((el) => clean(el.textContent)).filter(Boolean).join(' ');
                const shapes = Array.from(btn.querySelectorAll<SVGElement>('svg')).map((svg) => {
                    const gr = svg.getBoundingClientRect();
                    const vb = (svg.getAttribute('viewBox') || '0 0 24 24').split(/\s+/).map(Number);
                    return {
                        d: svgPaths(svg),
                        x: f(gr.left),
                        y: f(gr.top - rowShift(btn)),
                        w: f(gr.width),
                        h: f(gr.height),
                        c: argb(getComputedStyle(svg).color),
                        sw: num(svg.getAttribute('stroke-width'), 2),
                        vb: vb[2] || 24,
                    };
                });
                return {
                    k: btn.getAttribute('data-tv-key') || '',
                    t: label,
                    a: false,
                    x: f(r.left),
                    y: f(r.top - rowShift(btn)),
                    w: f(r.width),
                    h: f(r.height),
                    c: argb(cs.color),
                    bg: argb(cs.backgroundColor),
                    s: f(num(cs.fontSize, 16) * vs),
                    wt: Math.round(num(cs.fontWeight, 700)),
                    lx: sr ? f(sr.left) : f(r.left),
                    lw: sr ? f(sr.width) : f(r.width),
                    bc: argb(cs.borderTopColor),
                    bw: f(num(cs.borderTopWidth, 0) * vs),
                    sh: shapes,
                };
            });
            const notes = Array.from(root.querySelectorAll<HTMLElement>('.player-library-count')).map((el) => {
                const r = el.getBoundingClientRect();
                const cs = getComputedStyle(el);
                return {
                    t: clean(el.textContent),
                    x: f(r.left),
                    y: f(r.top - rowShift(el)),
                    w: f(r.width),
                    h: f(r.height),
                    s: f(num(cs.fontSize, 16) * visualScale(el, r)),
                    c: argb(cs.color),
                };
            }).filter((n) => n.t && n.w > 1);
            const out: Record<string, unknown> = {
                vw: window.innerWidth,
                notes,
                follow,
                hidden: blocked(),
                size: f(size),
                weight,
                sp: f(sp),
                tabs: [...tabs, ...controls],
            };
            if (h1) {
                const r = h1.getBoundingClientRect();
                const cs = getComputedStyle(h1);
                out.title = clean(h1.textContent);
                out.tx = f(r.left);
                out.ty = f(r.top - (follow ? shiftOf(h1, root, zoom) : 0));
                out.tw = f(r.width);
                out.th = f(r.height);
                out.ts = f(num(cs.fontSize, 28) * visualScale(h1, r));
            }
            return out;
        };

        const tick = () => {
            frame = 0;
            const data = scan();
            if (!data) {
                if (sentOnce && lastSet !== 'none') {
                    lastSet = 'none';
                    nativeLibHeaderSet(JSON.stringify({ vw: window.innerWidth, hidden: true }));
                }
                return;
            }
            const payload = JSON.stringify(data);
            if (payload !== lastSet) {
                lastSet = payload;
                nativeLibHeaderSet(payload);
            }
            if (!sentOnce) {
                sentOnce = true;
                html.dataset.nativeLibhdr = '1';
                const active = document.activeElement as HTMLElement | null;
                if (isTab(active) && !blocked() && !navOpen()) giveToNative(active?.getAttribute('data-tv-key') || '');
            }
        };
        function queue() {
            if (!frame) frame = window.requestAnimationFrame(tick);
        }

        function giveToNative(key: string, tries = 12) {
            if (!key) return;
            void nativeDetailRailFocus(`${PREFIX}${key}`).then((found) => {
                if (found || tries <= 1) return;
                window.setTimeout(() => {
                    const active = document.activeElement as HTMLElement | null;
                    if (!isTab(active) || active?.getAttribute('data-tv-key') !== key) return;
                    giveToNative(key, tries - 1);
                }, 120);
            });
        }
        const regive = () => {
            window.clearTimeout(reTimer);
            reTimer = window.setTimeout(() => {
                const active = document.activeElement as HTMLElement | null;
                if (!isTab(active) || blocked() || navOpen()) return;
                giveToNative(active?.getAttribute('data-tv-key') || '');
            }, 140);
        };

        window.addEventListener('resize', queue);
        const root = rootEl();
        const observer = new MutationObserver(queue);
        if (root) observer.observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'aria-current', 'data-tv-key'] });
        const resize = typeof ResizeObserver === 'function' && root ? new ResizeObserver(queue) : null;
        if (resize && root) resize.observe(root);
        const attrObserver = new MutationObserver(() => {
            queue();
            if (!navOpen()) regive();
        });
        attrObserver.observe(html, { attributes: true, attributeFilter: ['data-tv-nav-open', 'data-native-player-open'] });
        let overlayOpen = false;
        const overlayObserver = new MutationObserver(() => {
            const open = blocked();
            if (open === overlayOpen) return;
            overlayOpen = open;
            queue();
            if (!open) regive();
        });
        overlayObserver.observe(document.body, { childList: true, subtree: true });
        root?.addEventListener('transitionend', queue, true);
        const settle = [0, 150, 500, 1200, 2500].map((ms) => window.setTimeout(queue, ms));
        timer = window.setInterval(queue, 2000);

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
                // Switching tabs re-renders the page; if the tab bar stays, native takes the remote back.
                window.clearTimeout(reTimer);
                reTimer = window.setTimeout(() => {
                    if (blocked() || navOpen()) return;
                    const active = document.activeElement as HTMLElement | null;
                    if (!isTab(active)) return;
                    giveToNative(active?.getAttribute('data-tv-key') || key);
                }, 450);
            });
        });
        const offActivity = onNativeHomeEvent('railActivity', () => {
            if (!sentOnce) return;
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Unidentified', keyCode: 0, cancelable: true }));
        });
        const offHandoff = onNativeHomeEvent('railHandoff', (data) => {
            const key = mine(data);
            const dir = String(data.rowId || '');
            const el = key ? twinOf(key) : null;
            if (!el) return;
            handoffUntil = Date.now() + 900;
            if (!mirrorNativeCardFocus(el)) return;
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
                // The key found nowhere to go: the remote belongs on the tabs again.
                bounceTimer = window.setTimeout(() => {
                    const active = document.activeElement as HTMLElement | null;
                    if (!isTab(active) || blocked() || navOpen()) return;
                    giveToNative(active?.getAttribute('data-tv-key') || '');
                }, 450);
            }, 80);
        });
        // Web focus landed on a hidden tab (a hand-off up from the grid, the page opening): native takes the remote.
        const onFocusIn = (event: FocusEvent) => {
            if (!sentOnce || Date.now() < handoffUntil) return;
            const target = event.target as HTMLElement | null;
            if (!isTab(target)) return;
            if (blocked() || navOpen()) return;
            const key = target?.getAttribute('data-tv-key') || '';
            if (key === mirroring && Date.now() - mirroringAt < 400) return;
            giveToNative(key);
        };
        document.addEventListener('focusin', onFocusIn, true);

        queue();

        return () => {
            delete html.dataset.nativeLibhdr;
            document.removeEventListener('focusin', onFocusIn, true);
            window.clearTimeout(bounceTimer);
            window.clearTimeout(reTimer);
            window.clearInterval(timer);
            if (frame) window.cancelAnimationFrame(frame);
            settle.forEach((id) => window.clearTimeout(id));
            window.removeEventListener('resize', queue);
            root?.removeEventListener('transitionend', queue, true);
            observer.disconnect();
            attrObserver.disconnect();
            overlayObserver.disconnect();
            resize?.disconnect();
            offFocus();
            offOpen();
            offActivity();
            offHandoff();
            nativeLibHeaderHide();
        };
    }, [on]);

    return null;
};
