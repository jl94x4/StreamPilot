import React, { useEffect } from 'react';
import {
    nativeDetailRailFocus,
    nativeDetailRailSuppressed,
    nativeHomeReleaseFocus,
    nativeSettingsHide,
    nativeSettingsRect,
    nativeSettingsSet,
    onNativeHomeEvent,
} from '../plex-client/nativeHome';
import { mirrorNativeCardFocus } from '../plex-client/useTvRemote';

/**
 * Android TV Settings: the header, tabs, rows and Save / Discard are drawn by NativeSettingsView. The web page stays
 * mounted (invisible) and stays the source of truth: it is scraped into a typed payload, and every action runs by
 * clicking the matching web element. Renders nothing.
 */

const ROOT = '[data-tv-settings="1"]';
const PREFIX = 'settings~';
const OVERLAY = '[data-tv-item-menu="1"], [data-tv-select-menu="1"], [data-tv-resume-dialog="1"], [data-tv-season-watch-dialog="1"], [data-tv-still-watching-dialog="1"], [data-tv-whats-new="1"], [data-tv-home-switch="1"], [data-tv-library-manager="1"], [data-tv-version-dialog="1"], [data-tv-track-dialog="1"], [data-tv-settings-dialog="1"], [data-native-player-open="1"], [role="dialog"]';

type Kind = 'toggle' | 'choice' | 'heart' | 'input' | 'btn' | 'reorder' | 'tab' | 'save';

const clean = (value: string | null | undefined) => String(value || '').replace(/\s+/g, ' ').trim();
const shown = (el: Element) => getComputedStyle(el).display !== 'none';
const isOff = (el: Element) => el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true';

export const NativeSettingsBridge: React.FC = () => {
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
        let kinds = new Map<string, Kind>();
        let keyOf = new Map<HTMLElement, string>();

        const pageEl = () => document.querySelector<HTMLElement>(ROOT);
        const navOpen = () => root.getAttribute('data-tv-nav-open') === '1';
        const blocked = () => !!document.querySelector(OVERLAY) || navOpen();

        const scan = () => {
            const page = pageEl();
            if (!page) return null;
            const nextRefs = new Map<string, HTMLElement>();
            const nextKinds = new Map<string, Kind>();
            const nextKeyOf = new Map<HTMLElement, string>();
            const rows: Array<Record<string, unknown>> = [];
            const seen = new Map<string, number>();
            const selectedTab = page.querySelector<HTMLElement>('[data-tv-settings-tabs="1"] [aria-current="page"]');
            const tabId = (selectedTab?.getAttribute('data-tv-key') || 'tab').replace('settings-tab-', '');
            const mk = (kind: string, title: string) => {
                const base = `${tabId}|${kind}|${title}`;
                const n = (seen.get(base) || 0) + 1;
                seen.set(base, n);
                return n > 1 ? `${base}#${n}` : base;
            };
            const reg = (key: string, el: HTMLElement, kind: Kind) => {
                nextRefs.set(key, el);
                nextKinds.set(key, kind);
                nextKeyOf.set(el, key);
            };
            const titleDesc = (el: HTMLElement) => {
                const box = el.querySelector<HTMLElement>(':scope > span.min-w-0') || el.querySelector<HTMLElement>('span.min-w-0');
                const spans = box ? Array.from(box.children) as HTMLElement[] : [];
                return { t: clean(spans[0]?.textContent), d: clean(spans[1]?.textContent) };
            };

            const emitItem = (el: HTMLElement) => {
                if (el instanceof HTMLInputElement) {
                    const label = clean(el.closest('label')?.querySelector('span')?.textContent);
                    const key = mk('input', label);
                    reg(key, el, 'input');
                    rows.push({ k: 'input', t: label, v: el.value, d: el.placeholder || '', keys: [key], labels: [label], dis: [false] });
                    return;
                }
                if (el.querySelector('.smp-switch')) {
                    const { t, d } = titleDesc(el);
                    const key = mk('toggle', t);
                    reg(key, el, 'toggle');
                    rows.push({ k: 'toggle', t, d, on: el.querySelector('.smp-switch')?.getAttribute('data-on') === '1', keys: [key], labels: [t], dis: [false] });
                    return;
                }
                if (el.querySelector('.smp-settings-chip')) {
                    const { t, d } = titleDesc(el);
                    const key = mk('choice', t);
                    reg(key, el, 'choice');
                    rows.push({ k: 'choice', t, d, v: clean(el.querySelector('.smp-settings-chip')?.textContent), keys: [key], labels: [t], dis: [false] });
                    return;
                }
                if (el.hasAttribute('aria-pressed')) {
                    const { t, d } = titleDesc(el);
                    const key = mk('heart', t);
                    reg(key, el, 'heart');
                    rows.push({ k: 'heart', t, d, on: el.getAttribute('aria-pressed') === 'true', keys: [key], labels: [t], dis: [false] });
                    return;
                }
                const t = clean(el.textContent) || clean(el.getAttribute('aria-label'));
                const key = mk('btn', t);
                reg(key, el, 'btn');
                rows.push({ k: 'btn', t, style: /text-plex/.test(el.className) ? 'accent' : '', keys: [key], labels: [t], dis: [isOff(el)] });
            };

            const walk = (node: Element) => {
                if (!shown(node)) return;
                const el = node as HTMLElement;
                if (el.hasAttribute('data-ns-reorder')) {
                    const label = clean(el.querySelector('p')?.textContent);
                    const n = Number.parseInt(clean(el.querySelector('span')?.textContent), 10) || 0;
                    const up = el.querySelector<HTMLElement>('[data-ns-up]');
                    const down = el.querySelector<HTMLElement>('[data-ns-down]');
                    if (!up || !down) return;
                    const base = mk('reorder', label);
                    reg(`${base}~up`, up, 'reorder');
                    reg(`${base}~down`, down, 'reorder');
                    rows.push({ k: 'reorder', t: label, n, keys: [`${base}~up`, `${base}~down`], labels: ['up', 'down'], dis: [isOff(up), isOff(down)] });
                    return;
                }
                if (el.matches('[data-tv-item="1"]')) {
                    emitItem(el);
                    return;
                }
                const tag = el.tagName;
                if (tag === 'H2' || tag === 'H3') {
                    const t = clean(el.textContent);
                    if (t) rows.push({ k: 'h', t });
                    return;
                }
                if (tag === 'P') {
                    const t = clean(el.textContent);
                    if (t) rows.push({ k: 'p', t, err: el.classList.contains('text-red-400') });
                    return;
                }
                Array.from(el.children).forEach(walk);
            };

            let headerSeen = 0;
            Array.from(page.children).forEach((child) => {
                const el = child as HTMLElement;
                if (!shown(el) || el.hasAttribute('data-tv-page-top')) return;
                if (el.matches('[data-tv-settings-tabs="1"]')) {
                    const tabs = Array.from(el.querySelectorAll<HTMLElement>('[data-tv-item="1"]'));
                    const keys: string[] = [];
                    const labels: string[] = [];
                    let sel = 0;
                    tabs.forEach((tab, i) => {
                        const id = (tab.getAttribute('data-tv-key') || `t${i}`).replace('settings-tab-', '');
                        const key = `tab:${id}`;
                        reg(key, tab, 'tab');
                        keys.push(key);
                        labels.push(clean(tab.textContent));
                        if (tab.getAttribute('aria-current') === 'page') sel = i;
                    });
                    rows.push({ k: 'tabs', keys, labels, sel, dis: keys.map(() => false) });
                    return;
                }
                if (el.matches('[data-tv-settings-panel="1"]')) {
                    Array.from(el.children).forEach(walk);
                    return;
                }
                if (el.matches('[data-tv-settings-actions="1"]')) {
                    const status = el.querySelector<HTMLElement>(':scope > p');
                    if (status && clean(status.textContent)) {
                        rows.push({ k: 'status', t: clean(status.textContent), err: status.classList.contains('text-red-400') });
                    }
                    const save = el.querySelector<HTMLElement>('[data-tv-settings-save="1"]');
                    const all = Array.from(el.querySelectorAll<HTMLElement>('[data-tv-item="1"]'));
                    const discard = all.find((b) => b !== save);
                    if (save && discard) {
                        reg('save', save, 'save');
                        reg('discard', discard, 'save');
                        rows.push({ k: 'save', keys: ['save', 'discard'], labels: [clean(save.textContent), clean(discard.textContent)], dis: [isOff(save), isOff(discard)] });
                    }
                    return;
                }
                if (el.tagName === 'P') {
                    const t = clean(el.textContent);
                    if (t) rows.push({ k: 'ver', t });
                    return;
                }
                // The header block: eyebrow, title, hint.
                if (headerSeen === 0) {
                    headerSeen += 1;
                    const ps = Array.from(el.querySelectorAll('p')).map((p) => clean(p.textContent)).filter(Boolean);
                    const h1 = clean(el.querySelector('h1')?.textContent);
                    if (ps[0]) rows.push({ k: 'eyebrow', t: ps[0] });
                    if (h1) rows.push({ k: 'title', t: h1 });
                    if (ps[1]) rows.push({ k: 'hint', t: ps[1] });
                    return;
                }
                walk(el);
            });

            refs = nextRefs;
            kinds = nextKinds;
            keyOf = nextKeyOf;
            const active = document.activeElement as HTMLElement | null;
            const editing = active instanceof HTMLInputElement ? (nextKeyOf.get(active) || '') : '';
            const accent = getComputedStyle(root).getPropertyValue('--color-plex').trim() || '245 158 11';
            return { accent, editing, rows };
        };

        const syncRect = () => {
            const page = pageEl();
            if (!page || !sentOnce) return;
            const r = page.getBoundingClientRect();
            if (r.width < 2) return;
            const sig = `${r.left}|${r.width}|${window.innerWidth}`;
            if (sig === lastRect) return;
            lastRect = sig;
            nativeSettingsRect(r.left, 0, r.width, window.innerHeight, window.innerWidth);
        };

        const tick = () => {
            frame = 0;
            const data = scan();
            if (!data || !data.rows.length) return;
            const payload = JSON.stringify(data);
            if (payload !== lastSet) {
                lastSet = payload;
                nativeSettingsSet(payload);
            }
            if (!sentOnce) {
                sentOnce = true;
                root.dataset.nativeSettings = '1';
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
        const page = pageEl();
        if (page) {
            observer.observe(page, {
                childList: true,
                subtree: true,
                characterData: true,
                attributes: true,
                attributeFilter: ['class', 'aria-pressed', 'aria-current', 'aria-selected', 'aria-disabled', 'disabled', 'data-on'],
            });
            page.addEventListener('input', queue, true);
            page.addEventListener('change', queue, true);
        }
        const settle = [0, 150, 500, 1200, 2500].map((ms) => window.setTimeout(queue, ms));

        let suppressed = false;
        let overlayOpen = false;
        const syncSuppressed = () => {
            // Menus draw over the screen (it stays visible behind them); only the video player hides it.
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
            // A tab opens its section as soon as the remote is on it.
            if (kinds.get(key) === 'tab' && el.getAttribute('aria-current') !== 'page') el.click();
        });
        const offOpen = onNativeHomeEvent('railOpen', (data) => {
            const key = mine(data);
            const el = key ? refs.get(key) : null;
            if (!el) return;
            const kind = kinds.get(key);
            if (kind === 'input') {
                void nativeHomeReleaseFocus().then(() => {
                    el.focus();
                });
                return;
            }
            if (kind === 'choice' || kind === 'btn') {
                void nativeHomeReleaseFocus().then(() => {
                    el.click();
                    // A button that stays on this page (reset, clear): native takes the remote back.
                    window.clearTimeout(reTimer);
                    reTimer = window.setTimeout(() => {
                        if (blocked() || !el.isConnected || !pageEl()) return;
                        giveToNative(key);
                    }, 380);
                });
                return;
            }
            // Toggles, hearts, reorder arrows, Save / Discard: native keeps the remote.
            el.click();
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
        // The web input lost focus (Done on the keyboard, Back): native takes the remote again.
        const onFocusOut = (event: FocusEvent) => {
            const target = event.target as HTMLElement | null;
            if (!(target instanceof HTMLInputElement)) return;
            queue();
            window.setTimeout(() => {
                if (document.activeElement instanceof HTMLInputElement) return;
                const key = keyOf.get(target);
                if (key && !blocked()) giveToNative(key);
            }, 120);
        };
        const onFocusIn = (event: FocusEvent) => {
            if (!sentOnce || Date.now() < handoffUntil) return;
            const target = event.target as HTMLElement | null;
            // Typing in a web input: native shows the text, the web keeps the keys.
            if (!target || target instanceof HTMLInputElement) return;
            const key = keyOf.get(target);
            if (!key || blocked()) return;
            if (key === mirroring && Date.now() - mirroringAt < 400) return;
            giveToNative(key);
        };
        // Typing in a web input: Enter / Up / Down / Back finish it and hand the remote back to the native row.
        const onInputKey = (event: KeyboardEvent) => {
            const target = event.target as HTMLElement | null;
            if (!(target instanceof HTMLInputElement) || !sentOnce) return;
            if (!['Enter', 'ArrowUp', 'ArrowDown', 'Escape', 'GoBack'].includes(event.key)) return;
            event.preventDefault();
            event.stopPropagation();
            const key = keyOf.get(target);
            target.blur();
            if (key) giveToNative(key);
        };
        document.addEventListener('keydown', onInputKey, true);
        document.addEventListener('focusin', onFocusIn, true);
        document.addEventListener('focusout', onFocusOut, true);

        queue();

        return () => {
            delete root.dataset.nativeSettings;
            document.removeEventListener('focusin', onFocusIn, true);
            document.removeEventListener('keydown', onInputKey, true);
            document.removeEventListener('focusout', onFocusOut, true);
            window.clearTimeout(bounceTimer);
            window.clearTimeout(reTimer);
            if (frame) window.cancelAnimationFrame(frame);
            settle.forEach((id) => window.clearTimeout(id));
            window.removeEventListener('resize', queue);
            page?.removeEventListener('input', queue, true);
            page?.removeEventListener('change', queue, true);
            observer.disconnect();
            overlayObserver.disconnect();
            navObserver.disconnect();
            playerObserver.disconnect();
            offFocus();
            offOpen();
            offActivity();
            offHandoff();
            nativeSettingsHide();
        };
    }, []);

    return null;
};
