import React, { useEffect } from 'react';
import {
    nativeDetailRailFocus,
    nativeDetailRailSuppressed,
    nativeSearchHide,
    nativeSearchRect,
    nativeSearchSet,
    onNativeHomeEvent,
} from '../plex-client/nativeHome';
import { mirrorNativeCardFocus } from '../plex-client/useTvRemote';

/**
 * Android TV search: the title, the typed text and the on-screen keyboard are drawn by NativeSearchView. The web
 * panel stays mounted (invisible, laid out, focusable) and stays the source of truth: its keys are measured into the
 * payload and every press clicks the matching web key. Renders nothing.
 */

const PANEL = '.player-tv-search';
const PREFIX = 'search~';
const OVERLAY = '[data-tv-item-menu="1"], [data-tv-select-menu="1"], [data-tv-resume-dialog="1"], [data-tv-season-watch-dialog="1"], [data-tv-still-watching-dialog="1"], [data-tv-whats-new="1"], [data-tv-home-switch="1"], [data-tv-library-manager="1"], [data-tv-version-dialog="1"], [data-tv-track-dialog="1"], [data-tv-settings-dialog="1"], [data-native-player-open="1"], [role="dialog"]';

const num = (value: string | null | undefined, fallback: number) => {
    const n = Number.parseFloat(String(value || ''));
    return Number.isFinite(n) ? n : fallback;
};

const clean = (value: string | null | undefined) => String(value || '').replace(/\s+/g, ' ').trim();

/** Offset of `el` inside `panel` in layout px (offset* ignores the focus scale transform). */
const offsetIn = (el: HTMLElement, panel: HTMLElement) => {
    let x = 0;
    let y = 0;
    let node: HTMLElement | null = el;
    while (node && node !== panel) {
        x += node.offsetLeft;
        y += node.offsetTop;
        node = node.offsetParent as HTMLElement | null;
    }
    return { x, y };
};

export const NativeSearchBridge: React.FC = () => {
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
        let refs = new Map<string, HTMLElement>();
        let keyOf = new Map<HTMLElement, string>();

        const panelEl = () => document.querySelector<HTMLElement>(PANEL);
        const navOpen = () => root.getAttribute('data-tv-nav-open') === '1';
        const blocked = () => !!document.querySelector(OVERLAY) || navOpen();

        const scan = () => {
            const panel = panelEl();
            if (!panel) return null;
            const zoom = num(getComputedStyle(root).zoom, 1) || 1;
            const eyebrow = panel.querySelector<HTMLElement>('.player-tv-search-eyebrow');
            const query = panel.querySelector<HTMLElement>('[data-tv-search-query="1"]');
            const queryText = panel.querySelector<HTMLElement>('.player-tv-search-query-text');
            const twins = Array.from(panel.querySelectorAll<HTMLElement>('[data-tv-search-key]'));
            if (!eyebrow || !query || !twins.length) return null;
            const nextRefs = new Map<string, HTMLElement>();
            const nextKeyOf = new Map<HTMLElement, string>();
            const eo = offsetIn(eyebrow, panel);
            const qo = offsetIn(query, panel);
            const qStyle = getComputedStyle(query);
            const eStyle = getComputedStyle(eyebrow);
            const empty = query.getAttribute('data-empty') === '1';
            const rows: number[] = [];
            const keys = twins.map((el) => {
                const key = el.getAttribute('data-tv-search-key') || '';
                const o = offsetIn(el, panel);
                const action = el.classList.contains('is-action');
                const row = num(el.getAttribute('data-search-row'), 0);
                rows.push(row);
                nextRefs.set(key, el);
                nextKeyOf.set(el, key);
                return {
                    k: key,
                    l: el.getAttribute('aria-label') || clean(el.textContent),
                    a: action,
                    r: row,
                    x: o.x * zoom,
                    y: o.y * zoom,
                    w: el.offsetWidth * zoom,
                    h: el.offsetHeight * zoom,
                };
            });
            refs = nextRefs;
            keyOf = nextKeyOf;
            const sample = twins.find((el) => !el.classList.contains('is-action')) || twins[0];
            const action = twins.find((el) => el.classList.contains('is-action'));
            const accent = getComputedStyle(root).getPropertyValue('--color-plex').trim() || '245 158 11';
            return {
                accent,
                eyebrow: clean(eyebrow.textContent),
                eyeX: eo.x * zoom,
                eyeY: eo.y * zoom,
                eyeH: eyebrow.offsetHeight * zoom,
                eyeSize: num(eStyle.fontSize, 13) * zoom,
                query: empty ? '' : clean(queryText?.textContent),
                placeholder: empty ? clean(queryText?.textContent) : '',
                empty,
                qX: qo.x * zoom,
                qY: qo.y * zoom,
                qW: query.offsetWidth * zoom,
                qH: query.offsetHeight * zoom,
                qSize: num(qStyle.fontSize, 33) * zoom,
                keySize: num(getComputedStyle(sample).fontSize, 19) * zoom,
                actionSize: action ? num(getComputedStyle(action).fontSize, 15) * zoom : 15,
                radius: num(getComputedStyle(sample).borderTopLeftRadius, 12) * zoom,
                keys,
            };
        };

        const syncRect = () => {
            const panel = panelEl();
            if (!panel || !sentOnce || panelHidden) return;
            const r = panel.getBoundingClientRect();
            if (r.width < 2) return;
            const h = Math.min(r.height, window.innerHeight - r.top);
            const sig = `${r.left}|${r.top}|${r.width}|${h}|${window.innerWidth}`;
            if (sig === lastRect) return;
            lastRect = sig;
            nativeSearchRect(r.left, r.top, r.width, Math.max(h, 100), window.innerWidth);
        };

        // Search stays mounted (hidden) under a title page opened from it: the native keyboard hides with it and is
        // drawn again in full when the panel is back. Skipping the zero size left it drawn over the title page.
        let panelHidden = false;
        const tick = () => {
            frame = 0;
            const shown = panelEl()?.getBoundingClientRect();
            if (!shown || shown.width < 2 || shown.height < 2) {
                if (!panelHidden && sentOnce) {
                    panelHidden = true;
                    lastSet = '';
                    lastRect = '';
                    nativeSearchHide();
                }
                return;
            }
            const reshown = panelHidden;
            panelHidden = false;
            const data = scan();
            if (!data) return;
            const payload = JSON.stringify(data);
            if (payload !== lastSet) {
                lastSet = payload;
                nativeSearchSet(payload);
            }
            if (reshown) {
                syncRect();
                // Back from a title page: the page's focus is on a hidden key, so the keyboard takes the remote back.
                const active = document.activeElement as HTMLElement | null;
                const key = active ? keyOf.get(active) : '';
                if (key && !blocked()) giveToNative(key);
            }
            if (!sentOnce) {
                sentOnce = true;
                root.dataset.nativeSearch = '1';
                lastRect = '';
                const active = document.activeElement as HTMLElement | null;
                const key = active ? keyOf.get(active) : '';
                if (key && !blocked()) giveToNative(key);
            }
            syncRect();
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

        const regive = (delay: number) => {
            window.clearTimeout(reTimer);
            reTimer = window.setTimeout(() => {
                if (blocked()) return;
                const active = document.activeElement as HTMLElement | null;
                const key = active ? keyOf.get(active) : '';
                if (key) giveToNative(key);
            }, delay);
        };

        window.addEventListener('resize', queue);
        const observer = new MutationObserver(queue);
        const panel = panelEl();
        if (panel) observer.observe(panel, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'data-empty'] });
        const resize = typeof ResizeObserver === 'function' && panel ? new ResizeObserver(queue) : null;
        if (resize && panel) resize.observe(panel);
        const settle = [0, 150, 500, 1200, 2500].map((ms) => window.setTimeout(queue, ms));

        let suppressed = false;
        let overlayOpen = false;
        const syncSuppressed = () => {
            const on = root.getAttribute('data-native-player-open') === '1';
            const open = !!document.querySelector(OVERLAY);
            if (on !== suppressed) {
                suppressed = on;
                nativeDetailRailSuppressed(on);
            }
            if (open !== overlayOpen) {
                overlayOpen = open;
                if (!open) regive(140);
            }
        };
        const overlayObserver = new MutationObserver(syncSuppressed);
        overlayObserver.observe(document.body, { childList: true, subtree: true });
        let burstUntil = 0;
        const burst = () => {
            queue();
            syncRect();
            if (performance.now() < burstUntil) window.requestAnimationFrame(burst);
        };
        const navObserver = new MutationObserver(() => {
            burstUntil = performance.now() + 700;
            burst();
            if (!navOpen()) regive(140);
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
            const el = key ? refs.get(key) : null;
            if (!el) return;
            mirroring = key;
            mirroringAt = Date.now();
            mirrorNativeCardFocus(el);
        });
        // A key press: the web twin types it; native keeps the remote.
        const offOpen = onNativeHomeEvent('railOpen', (data) => {
            const key = mine(data);
            const el = key ? refs.get(key) : null;
            if (el) el.click();
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
                bounceTimer = window.setTimeout(() => {
                    if (blocked()) return;
                    const active = document.activeElement as HTMLElement | null;
                    const k2 = active ? keyOf.get(active) : '';
                    if (k2) giveToNative(k2);
                }, 450);
            }, 80);
        });
        // Web focus landed on a hidden key (search opening, Left from the results): native takes the remote.
        const onFocusIn = (event: FocusEvent) => {
            if (!sentOnce || Date.now() < handoffUntil) return;
            const target = event.target as HTMLElement | null;
            const key = target ? keyOf.get(target) : '';
            if (!key || blocked()) return;
            if (key === mirroring && Date.now() - mirroringAt < 400) return;
            giveToNative(key);
        };
        document.addEventListener('focusin', onFocusIn, true);

        queue();

        return () => {
            delete root.dataset.nativeSearch;
            document.removeEventListener('focusin', onFocusIn, true);
            window.clearTimeout(bounceTimer);
            window.clearTimeout(reTimer);
            if (frame) window.cancelAnimationFrame(frame);
            settle.forEach((id) => window.clearTimeout(id));
            window.removeEventListener('resize', queue);
            observer.disconnect();
            resize?.disconnect();
            overlayObserver.disconnect();
            navObserver.disconnect();
            playerObserver.disconnect();
            offFocus();
            offOpen();
            offActivity();
            offHandoff();
            nativeSearchHide();
        };
    }, []);

    return null;
};
