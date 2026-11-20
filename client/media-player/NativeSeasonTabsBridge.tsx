import React, { useEffect } from 'react';
import {
    nativeDetailRailFocus,
    nativeDetailRailSuppressed,
    nativeHomeReleaseFocus,
    nativeSeasonTabsHide,
    nativeSeasonTabsRect,
    nativeSeasonTabsSet,
    onNativeHomeEvent,
} from '../plex-client/nativeHome';
import { mirrorNativeCardFocus } from '../plex-client/useTvRemote';

/**
 * Android TV episode / season page: the season bar ("Show  Season 1 ...") is drawn by NativeSeasonTabs at the web
 * bar's rect. The web pills stay in the page (invisible, focusable) so opening a season runs through them; native
 * owns Left / Right and hands Down / Left-at-the-edge back. Renders nothing.
 */

const BAR = '[data-tv-details="1"] .media-details-season-pills';
const BTN = '[data-tv-season-pill="1"][data-tv-key]';
const PREFIX = 'tabs~';
const OVERLAY = '[data-tv-item-menu="1"], [data-tv-select-menu="1"], [data-tv-resume-dialog="1"], [data-tv-season-watch-dialog="1"], [data-tv-still-watching-dialog="1"], [data-tv-whats-new="1"], [data-tv-home-switch="1"], [data-tv-library-manager="1"], [data-tv-version-dialog="1"], [data-tv-track-dialog="1"], [data-tv-settings-dialog="1"], [data-native-player-open="1"], [role="dialog"]';

const num = (value: string | null | undefined, fallback: number) => {
    const n = Number.parseFloat(String(value || ''));
    return Number.isFinite(n) ? n : fallback;
};

export const NativeSeasonTabsBridge: React.FC = () => {
    useEffect(() => {
        const root = document.documentElement;
        let frame = 0;
        let rectFrame = 0;
        let lastSet = '';
        let lastRect = '';
        let sentOnce = false;
        let handoffUntil = 0;
        let mirroring = '';
        let mirroringAt = 0;
        let bounceTimer = 0;
        let reTimer = 0;
        let barObserver: MutationObserver | null = null;
        let observedBar: Element | null = null;

        const barEl = () => document.querySelector<HTMLElement>(BAR);
        const twinOf = (key: string) => barEl()?.querySelector<HTMLElement>(`[data-tv-key="${key.replace(/["\\]/g, '\\$&')}"]`) || null;
        const navOpen = () => root.getAttribute('data-tv-nav-open') === '1';
        const zoomOf = () => num(getComputedStyle(root).zoom, 1) || 1;

        const giveToNative = (key: string, tries = 12) => {
            if (!key) return;
            void nativeDetailRailFocus(`${PREFIX}${key}`).then((found) => {
                if (found || tries <= 1) return;
                window.setTimeout(() => {
                    const active = document.activeElement as HTMLElement | null;
                    if (active?.getAttribute?.('data-tv-key') !== key) return;
                    giveToNative(key, tries - 1);
                }, 120);
            });
        };

        const regive = () => {
            window.clearTimeout(reTimer);
            reTimer = window.setTimeout(() => {
                const active = document.activeElement as HTMLElement | null;
                const bar = barEl();
                if (!active || !bar || !bar.contains(active) || !active.matches(BTN)) return;
                if (document.querySelector(OVERLAY) || navOpen()) return;
                giveToNative(active.getAttribute('data-tv-key') || '');
            }, 140);
        };

        const syncPayload = () => {
            const bar = barEl();
            if (!bar) return;
            if (observedBar !== bar) {
                barObserver?.disconnect();
                observedBar = bar;
                barObserver = new MutationObserver(queue);
                barObserver.observe(bar, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'aria-current'] });
            }
            const br = bar.getBoundingClientRect();
            if (br.width < 2 || br.height < 2) return;
            const zoom = zoomOf();
            const sl = bar.scrollLeft * zoom;
            const buttons = Array.from(bar.querySelectorAll<HTMLElement>(BTN));
            if (!buttons.length) return;
            let size = 10;
            let weight = 500;
            const items = buttons.map((btn, i) => {
                const r = btn.getBoundingClientRect();
                const cs = getComputedStyle(btn);
                if (i === 0) {
                    size = num(cs.fontSize, 21) * zoom;
                    weight = Math.round(num(cs.fontWeight, 500));
                }
                return {
                    key: btn.getAttribute('data-tv-key') || '',
                    t: (btn.textContent || '').trim(),
                    active: btn.getAttribute('aria-current') === 'page',
                    // Unscrolled: native scrolls the bar itself.
                    x: r.left - br.left + sl,
                    y: r.top - br.top,
                    w: r.width,
                    h: r.height,
                };
            });
            const payload = JSON.stringify({ size, weight, bw: num(getComputedStyle(bar).borderTopWidth, 1) * zoom, sl, items });
            if (payload !== lastSet) {
                lastSet = payload;
                nativeSeasonTabsSet(payload);
            }
            if (!sentOnce) {
                sentOnce = true;
                root.dataset.nativeTabs = '1';
                const active = document.activeElement as HTMLElement | null;
                if (active && bar.contains(active) && active.matches(BTN) && !document.querySelector(OVERLAY) && !navOpen()) {
                    giveToNative(active.getAttribute('data-tv-key') || '');
                }
            }
        };

        const syncRect = () => {
            const bar = barEl();
            if (!bar || !sentOnce) return;
            const r = bar.getBoundingClientRect();
            if (r.width < 2 || r.height < 2) return;
            const sig = `${r.left}|${r.top}|${r.width}|${r.height}`;
            if (sig === lastRect) return;
            lastRect = sig;
            nativeSeasonTabsRect(r.left, r.top, r.width, r.height, window.innerWidth);
        };

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

        window.addEventListener('scroll', queueRect, { passive: true });
        window.addEventListener('resize', queue);
        const detailsRoot = document.querySelector<HTMLElement>('[data-tv-details="1"]');
        const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(queue) : null;
        if (resize && detailsRoot) resize.observe(detailsRoot);
        detailsRoot?.addEventListener('transitionend', queue, true);
        detailsRoot?.addEventListener('animationend', queue, true);
        const mount = new MutationObserver(queue);
        if (detailsRoot) mount.observe(detailsRoot, { childList: true, subtree: true });
        const settle = [0, 150, 500, 1200, 2500].map((ms) => window.setTimeout(queue, ms));

        let suppressed = false;
        const syncSuppressed = () => {
            const on = !!document.querySelector(OVERLAY);
            if (on === suppressed) return;
            suppressed = on;
            nativeDetailRailSuppressed(on);
            if (!on) regive();
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
            if (!navOpen()) regive();
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
                // Opening a season swaps the page; if this one stays, native takes the remote back.
                window.clearTimeout(reTimer);
                reTimer = window.setTimeout(() => {
                    if (document.querySelector(OVERLAY) || navOpen()) return;
                    if (!el.isConnected || document.activeElement !== el) return;
                    giveToNative(key);
                }, 400);
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
                bounceTimer = window.setTimeout(() => {
                    const active = document.activeElement as HTMLElement | null;
                    const bar = barEl();
                    if (!active || !bar || !bar.contains(active) || !active.matches(BTN)) return;
                    if (document.querySelector(OVERLAY) || navOpen()) return;
                    giveToNative(active.getAttribute('data-tv-key') || '');
                }, 450);
            }, 80);
        });
        const onFocusIn = (event: FocusEvent) => {
            if (!sentOnce || Date.now() < handoffUntil) return;
            const target = event.target as HTMLElement | null;
            if (!target?.matches?.(BTN)) return;
            const bar = barEl();
            if (!bar || !bar.contains(target)) return;
            if (document.querySelector(OVERLAY) || navOpen()) return;
            const key = target.getAttribute('data-tv-key') || '';
            if (key === mirroring && Date.now() - mirroringAt < 400) return;
            giveToNative(key);
        };
        document.addEventListener('focusin', onFocusIn, true);

        queue();

        return () => {
            delete root.dataset.nativeTabs;
            document.removeEventListener('focusin', onFocusIn, true);
            window.clearTimeout(bounceTimer);
            window.clearTimeout(reTimer);
            if (frame) window.cancelAnimationFrame(frame);
            if (rectFrame) window.cancelAnimationFrame(rectFrame);
            settle.forEach((id) => window.clearTimeout(id));
            window.removeEventListener('scroll', queueRect);
            window.removeEventListener('resize', queue);
            detailsRoot?.removeEventListener('transitionend', queue, true);
            detailsRoot?.removeEventListener('animationend', queue, true);
            resize?.disconnect();
            mount.disconnect();
            barObserver?.disconnect();
            overlayObserver.disconnect();
            navObserver.disconnect();
            playerObserver.disconnect();
            offFocus();
            offOpen();
            offActivity();
            offHandoff();
            nativeSeasonTabsHide();
        };
    }, []);

    return null;
};
