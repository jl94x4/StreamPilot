import React, { useEffect } from 'react';
import {
    nativeChromeHide,
    nativeChromeSet,
    nativeDetailRailFocus,
    nativeHomeReleaseFocus,
    onNativeHomeEvent,
} from '../plex-client/nativeHome';
import { mirrorNativeCardFocus } from '../plex-client/useTvRemote';

/**
 * Android TV side menu + clock: drawn by NativeChromeView. The web copies stay mounted (invisible, laid out,
 * focusable) and stay the source of truth: their layout and icons are measured into the payload, and every press
 * clicks the matching web item. Renders nothing.
 */

const ROOT = '[data-tv-nav-root="1"]';
const ITEM = '[data-tv-nav="1"]';
const PREFIX = 'nav~';
const OVERLAY = '[data-tv-item-menu="1"], [data-tv-select-menu="1"], [data-tv-resume-dialog="1"], [data-tv-season-watch-dialog="1"], [data-tv-still-watching-dialog="1"], [data-tv-whats-new="1"], [data-tv-home-switch="1"], [data-tv-library-manager="1"], [data-tv-version-dialog="1"], [data-tv-track-dialog="1"], [data-tv-settings-dialog="1"], [role="dialog"]';

const num = (value: string | null | undefined, fallback: number) => {
    const n = Number.parseFloat(String(value || ''));
    return Number.isFinite(n) ? n : fallback;
};
const clean = (value: string | null | undefined) => String(value || '').replace(/\s+/g, ' ').trim();

/** "rgb(a)" → signed ARGB int (0 = transparent / unparsable). */
const argb = (value: string): number => {
    const m = String(value || '').match(/rgba?\(([^)]+)\)/);
    if (!m) return 0;
    const parts = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) return 0;
    const a = Math.round((parts.length > 3 ? parts[3] : 1) * 255);
    if (a <= 0) return 0;
    return ((a << 24) | (parts[0] << 16) | (parts[1] << 8) | parts[2]) | 0;
};

const f = (n: number) => Math.round(n * 100) / 100;

/** Visual-to-layout scale of an element (CSS zoom): the rect height over the layout height. */
const visualScale = (el: HTMLElement, r: DOMRect) => {
    const h = el.offsetHeight;
    return h > 0 && r.height > 0 ? r.height / h : 1;
};

/** An svg's shapes as path data (Lucide icons are stroked circles, rects, lines and paths). */
const svgPaths = (svg: SVGElement): string[] => {
    const out: string[] = [];
    svg.querySelectorAll('*').forEach((el) => {
        const tag = el.tagName.toLowerCase();
        const a = (name: string) => num(el.getAttribute(name), 0);
        if (tag === 'path') {
            const d = el.getAttribute('d');
            if (d) out.push(d);
        } else if (tag === 'circle') {
            const cx = a('cx');
            const cy = a('cy');
            const r = a('r');
            out.push(`M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`);
        } else if (tag === 'ellipse') {
            const cx = a('cx');
            const cy = a('cy');
            const rx = a('rx');
            const ry = a('ry');
            out.push(`M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0`);
        } else if (tag === 'rect') {
            const x = a('x');
            const y = a('y');
            const w = a('width');
            const h = a('height');
            const rx = Math.min(a('rx') || a('ry'), w / 2);
            const ry = Math.min(a('ry') || a('rx'), h / 2);
            out.push(`M${x + rx} ${y}h${w - 2 * rx}a${rx} ${ry} 0 0 1 ${rx} ${ry}v${h - 2 * ry}a${rx} ${ry} 0 0 1 ${-rx} ${ry}h${-(w - 2 * rx)}a${rx} ${ry} 0 0 1 ${-rx} ${-ry}v${-(h - 2 * ry)}a${rx} ${ry} 0 0 1 ${rx} ${-ry}z`);
        } else if (tag === 'line') {
            out.push(`M${a('x1')} ${a('y1')}L${a('x2')} ${a('y2')}`);
        } else if (tag === 'polyline' || tag === 'polygon') {
            const pts = (el.getAttribute('points') || '').trim().split(/[\s,]+/).map(Number);
            let d = '';
            for (let i = 0; i + 1 < pts.length; i += 2) d += `${i ? 'L' : 'M'}${pts[i]} ${pts[i + 1]}`;
            if (d) out.push(tag === 'polygon' ? `${d}z` : d);
        }
    });
    return out;
};

export const NativeChromeBridge: React.FC = () => {
    useEffect(() => {
        const html = document.documentElement;
        let frame = 0;
        let lastSet = '';
        let sentOnce = false;
        let handoffUntil = 0;
        let mirroring = '';
        let mirroringAt = 0;
        let bounceTimer = 0;
        let timer = 0;
        let refs = new Map<string, HTMLElement>();
        let keyOf = new Map<HTMLElement, string>();

        const rootEl = () => document.querySelector<HTMLElement>(ROOT);
        const navOpen = () => html.getAttribute('data-tv-nav-open') === '1';
        const blocked = () => !!document.querySelector(OVERLAY);

        const scan = () => {
            const zoom = num(getComputedStyle(html).zoom, 1) || 1;
            const root = rootEl();
            const aside = root?.closest<HTMLElement>('.player-desktop-nav') || null;
            const playerOpen = html.getAttribute('data-native-player-open') === '1';
            const asideHidden = !aside || getComputedStyle(aside).display === 'none';
            const out: Record<string, unknown> = {
                vw: window.innerWidth,
                accent: getComputedStyle(html).getPropertyValue('--color-plex').trim() || '245 158 11',
                hidden: playerOpen,
                dim: blocked() && html.getAttribute('data-native-menu') !== '1',
            };

            if (root && !asideHidden) {
                const rr = root.getBoundingClientRect();
                const nextRefs = new Map<string, HTMLElement>();
                const nextKeyOf = new Map<HTMLElement, string>();
                const items = Array.from(root.querySelectorAll<HTMLElement>(ITEM)).map((el, index) => {
                    const r = el.getBoundingClientRect();
                    const label = el.querySelector<HTMLElement>('.player-nav-label');
                    const title = clean(label?.textContent) || el.getAttribute('title') || el.getAttribute('aria-label') || `item${index}`;
                    const key = `${index}|${title}`;
                    nextRefs.set(key, el);
                    nextKeyOf.set(el, key);
                    const shapes = Array.from(el.querySelectorAll<SVGElement>('svg')).map((svg) => {
                        const sr = svg.getBoundingClientRect();
                        const vb = (svg.getAttribute('viewBox') || '0 0 24 24').split(/\s+/).map(Number);
                        return {
                            d: svgPaths(svg),
                            x: f(sr.left),
                            y: f(sr.top),
                            w: f(sr.width),
                            h: f(sr.height),
                            c: argb(getComputedStyle(svg).color),
                            sw: num(svg.getAttribute('stroke-width'), 2),
                            vb: vb[2] || 24,
                        };
                    });
                    const img = el.querySelector<HTMLImageElement>('img');
                    const fallback = !img ? Array.from(el.querySelectorAll<HTMLElement>('span.rounded-full')).find((s) => !s.querySelector('svg')) : null;
                    const avEl = img || fallback;
                    const ar = avEl?.getBoundingClientRect();
                    const scroller = el.closest<HTMLElement>('[data-tv-nav-libraries-scroll="1"]');
                    const sc = scroller?.getBoundingClientRect();
                    const lr = label?.getBoundingClientRect();
                    const ls = label ? getComputedStyle(label) : null;
                    return {
                        k: key,
                        l: label ? clean(label.textContent) : '',
                        a: el.getAttribute('data-tv-nav-active') === '1',
                        f: el.tabIndex !== -1,
                        x: f(r.left),
                        y: f(r.top),
                        w: f(r.width),
                        h: f(r.height),
                        hl: !!label,
                        lx: lr ? f(lr.left) : 0,
                        lw: lr ? f(lr.width) : 0,
                        ls: ls && lr && label ? f(num(ls.fontSize, 14) * visualScale(label, lr)) : 14,
                        lc: ls ? argb(ls.color) : -1,
                        av: img?.currentSrc || img?.src || '',
                        in: fallback ? clean(fallback.textContent) : '',
                        avx: ar ? f(ar.left) : 0,
                        avy: ar ? f(ar.top) : 0,
                        avw: ar ? f(ar.width) : 0,
                        ct: sc ? f(sc.top) : -1,
                        cb: sc ? f(sc.bottom) : -1,
                        sh: shapes,
                    };
                });
                refs = nextRefs;
                keyOf = nextKeyOf;
                const labels = Array.from(root.querySelectorAll<HTMLElement>('p')).map((p) => {
                    const r = p.getBoundingClientRect();
                    const st = getComputedStyle(p);
                    const size = num(st.fontSize, 10) * visualScale(p, r);
                    return { t: clean(p.textContent), x: f(r.left), y: f(r.top), w: f(r.width), h: f(r.height), s: f(size), c: argb(st.color), sp: f(num(st.letterSpacing, 0) * visualScale(p, r) / size) };
                }).filter((l) => l.t && l.w > 1);
                const rules = Array.from(root.querySelectorAll<HTMLElement>('div')).filter((d) => d.classList.contains('h-px')).map((d) => {
                    const r = d.getBoundingClientRect();
                    return { x: f(r.left), y: f(r.top), w: f(r.width), h: f(r.height), c: argb(getComputedStyle(d).backgroundColor) };
                }).filter((r) => r.w > 1);
                const bg = argb(getComputedStyle(root).backgroundColor);
                // The web panel is blurred glass; native has no blur, so it is made a little more solid.
                const panel = bg ? (((Math.min(255, ((bg >>> 24) & 255) + 30) << 24) | (bg & 0xffffff)) | 0) : 0;
                if (rr.width > 1 && items.length) {
                    out.nav = {
                        expanded: navOpen(),
                        panel,
                        x: f(rr.left),
                        y: f(rr.top),
                        w: f(rr.width),
                        h: f(rr.height),
                        r: num(getComputedStyle(root).borderTopLeftRadius, 28) * zoom,
                        items,
                        labels,
                        rules,
                    };
                }
            }

            const clock = document.querySelector<HTMLElement>('.player-tv-clock');
            if (clock) {
                const st = getComputedStyle(clock);
                const r = clock.getBoundingClientRect();
                if (st.display !== 'none' && r.width > 1) {
                    out.clock = {
                        t: clean(clock.textContent),
                        x: f(r.left),
                        y: f(r.top),
                        w: f(r.width),
                        h: f(r.height),
                        s: f(num(st.fontSize, 17) * visualScale(clock, r)),
                        bg: argb(st.backgroundColor),
                        c: argb(st.color),
                    };
                }
            }
            return out;
        };

        const tick = () => {
            frame = 0;
            const data = scan();
            if (!data.nav && !data.clock) {
                if (sentOnce && lastSet !== 'none') {
                    lastSet = 'none';
                    nativeChromeSet(JSON.stringify({ vw: window.innerWidth, hidden: true }));
                }
                return;
            }
            const payload = JSON.stringify(data);
            if (payload !== lastSet) {
                lastSet = payload;
                nativeChromeSet(payload);
            }
            if (!sentOnce) {
                sentOnce = true;
                html.dataset.nativeChrome = '1';
                const active = document.activeElement as HTMLElement | null;
                const key = active ? keyOf.get(active) : '';
                if (key && !blocked()) giveToNative(key);
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
                    if (!active || keyOf.get(active) !== key) return;
                    giveToNative(key, tries - 1);
                }, 120);
            });
        }

        window.addEventListener('resize', queue);
        const observer = new MutationObserver(queue);
        const root = rootEl();
        if (root) {
            observer.observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'data-tv-nav-active', 'tabindex', 'src', 'style'] });
        }
        // The clock changes on the minute and hides under menus: watch the page for both (cheap: queue is one frame).
        const clockObserver = new MutationObserver(queue);
        clockObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
        const attrObserver = new MutationObserver(queue);
        attrObserver.observe(html, { attributes: true, attributeFilter: ['data-tv-nav-open', 'data-tv-nav-icons', 'data-native-player-open', 'data-native-menu', 'class'] });
        const scrollers = [root, root?.querySelector<HTMLElement>('[data-tv-nav-libraries-scroll="1"]')].filter(Boolean) as HTMLElement[];
        scrollers.forEach((el) => el.addEventListener('scroll', queue, { passive: true }));
        const resize = typeof ResizeObserver === 'function' && root ? new ResizeObserver(queue) : null;
        if (resize && root) resize.observe(root);
        const settle = [0, 150, 500, 1200, 2500].map((ms) => window.setTimeout(queue, ms));
        // The clock can hide / appear through CSS only (a menu opening): a slow check keeps it honest.
        timer = window.setInterval(queue, 1500);

        const mine = (data: { key?: string }) => {
            const key = String(data.key || '');
            return key.startsWith(PREFIX) ? key.slice(PREFIX.length) : '';
        };
        const offFocus = onNativeHomeEvent('railFocus', (data) => {
            const key = mine(data);
            const el = key ? refs.get(key) : null;
            if (!el) return;
            mirroring = key;
            mirroringAt = Date.now();
            mirrorNativeCardFocus(el);
            // A long library list scrolls the web copy; the next scan moves the native one with it.
            try {
                el.scrollIntoView({ block: 'nearest' });
            } catch {
                /* ignore */
            }
            queue();
        });
        const offOpen = onNativeHomeEvent('railOpen', (data) => {
            const key = mine(data);
            const el = key ? refs.get(key) : null;
            if (!el) return;
            void nativeHomeReleaseFocus().then(() => el.click());
        });
        const offActivity = onNativeHomeEvent('railActivity', () => {
            if (!sentOnce) return;
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Unidentified', keyCode: 0, cancelable: true }));
        });
        const offHandoff = onNativeHomeEvent('railHandoff', (data) => {
            const key = mine(data);
            const dir = String(data.rowId || '');
            const el = key ? refs.get(key) : null;
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
                // The key found nowhere to go: the remote belongs on the menu again.
                bounceTimer = window.setTimeout(() => {
                    if (blocked() || !navOpen()) return;
                    const active = document.activeElement as HTMLElement | null;
                    const k2 = active ? keyOf.get(active) : '';
                    if (k2) giveToNative(k2);
                }, 450);
            }, 80);
        });
        // Web focus landed on a menu item (the menu opening, Left from the content): native takes the remote.
        const onFocusIn = (event: FocusEvent) => {
            if (!sentOnce || Date.now() < handoffUntil) return;
            const target = event.target as HTMLElement | null;
            const key = target ? keyOf.get(target) : '';
            if (!key || blocked()) return;
            if (key === mirroring && Date.now() - mirroringAt < 400) return;
            giveToNative(key);
        };
        document.addEventListener('focusin', onFocusIn, true);
        // The menu closed on the page's side (Back, a pick): the remote must not stay on the native menu.
        const closeObserver = new MutationObserver(() => {
            if (!navOpen()) void nativeHomeReleaseFocus();
        });
        closeObserver.observe(html, { attributes: true, attributeFilter: ['data-tv-nav-open'] });

        queue();

        return () => {
            delete html.dataset.nativeChrome;
            document.removeEventListener('focusin', onFocusIn, true);
            window.clearTimeout(bounceTimer);
            window.clearInterval(timer);
            if (frame) window.cancelAnimationFrame(frame);
            settle.forEach((id) => window.clearTimeout(id));
            window.removeEventListener('resize', queue);
            observer.disconnect();
            clockObserver.disconnect();
            attrObserver.disconnect();
            closeObserver.disconnect();
            resize?.disconnect();
            scrollers.forEach((el) => el.removeEventListener('scroll', queue));
            offFocus();
            offOpen();
            offActivity();
            offHandoff();
            nativeChromeHide();
        };
    }, []);

    return null;
};
