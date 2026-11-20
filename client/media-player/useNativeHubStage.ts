import { useEffect, useRef, useState } from 'react';
import {
    isNativeHomeSupported,
    nativeDetailsHandOverToHome,
    nativeHomeExitApp,
    nativeHomeFocusRows,
    nativeHomeHide,
    nativeHomeReleaseFocus,
    nativeHomeSetBlocked,
    nativeHomeSetShift,
    nativeHomeSetSurface,
    nativeHomeShow,
    NATIVE_HOME_FOCUS_EVENT,
    onNativeHomeEvent,
    setNativeHomeStageClear,
} from '../plex-client/nativeHome';
import { openTvSideNav, restoreTvFocusWhenReady } from '../plex-client/useTvRemote';
import { buildNativeHomePayload, type NativeHomeSourceRow } from './nativeHomePayload';
import { PERF_FLAGS_EVENT, readPerfFlags } from './PlayerPerfOverlay';
import { PLAYER_APP_BASE } from './paths';
import { TV_FLOOR_RGB } from './tvSurface';
import type { PlayerItem } from './types';

const OWNER = 'hub';
/** The library last drawn: coming back to it (from a title) keeps the poster you were on; a new one starts fresh. */
let lastDrawnKey = '';
/** Marks the stage that owns the native view (a kept-alive Home stage may sit hidden under it). */
export const HUB_STAGE_ATTR = 'data-hub-stage';
const STAGE_SELECTOR = `[${HUB_STAGE_ATTR}="1"]`;
const TV_OVERLAY_OPEN = '[data-tv-item-menu="1"], [data-tv-select-menu="1"], [data-tv-resume-dialog="1"], [data-tv-season-watch-dialog="1"], [data-tv-still-watching-dialog="1"], [data-tv-whats-new="1"], [data-tv-home-switch="1"], [data-tv-library-manager="1"], [data-tv-version-dialog="1"], [data-tv-track-dialog="1"], [data-tv-settings-dialog="1"], [role="dialog"]';

type HubRow = NativeHomeSourceRow & { onViewAll?: unknown };

type Options = {
    active: boolean;
    loading: boolean;
    rows: HubRow[];
    tickPosition: string;
    viewMoreLabel: string;
    /** Same key as the stage's resetKey: a new library starts with nothing remembered. */
    resetKey: string;
    onOpenItem: (item: PlayerItem) => void;
    onFocusKey: (rowIndex: number, rowId: string, key: string) => void;
};

/**
 * A library's Recommended page draws its backdrop and poster rows with the same native view as Home
 * (NativeHomeView). The page keeps the billboard text, the tabs, the sidebar and every action; the rows
 * it renders stay in the page, invisible, so menus and focus keep working on them.
 */
export const useNativeHubStage = ({
    active,
    loading,
    rows,
    tickPosition,
    viewMoreLabel,
    resetKey,
    onOpenItem,
    onFocusKey,
}: Options): boolean => {
    const [flag, setFlag] = useState(() => readPerfFlags().nativeHome);
    useEffect(() => {
        const onFlags = () => setFlag(readPerfFlags().nativeHome);
        window.addEventListener(PERF_FLAGS_EVENT, onFlags);
        return () => window.removeEventListener(PERF_FLAGS_EVENT, onFlags);
    }, []);
    const on = flag && isNativeHomeSupported() && document.documentElement.dataset.tv === '1';
    const showing = on && active && !loading && rows.length > 0;

    const rowsRef = useRef(rows);
    rowsRef.current = rows;
    const openRef = useRef(onOpenItem);
    openRef.current = onOpenItem;
    const focusRef = useRef(onFocusKey);
    focusRef.current = onFocusKey;
    const showingRef = useRef(false);
    showingRef.current = showing;
    const shownRef = useRef(false);
    const payloadRef = useRef('');
    const keyRef = useRef('');

    useEffect(() => {
        if (!showing) {
            if (shownRef.current) {
                shownRef.current = false;
                payloadRef.current = '';
                void nativeHomeHide(OWNER).then((hidden) => {
                    if (!hidden) return;
                    setNativeHomeStageClear(false);
                    window.setTimeout(() => {
                        const focused = document.activeElement as HTMLElement | null;
                        const idle = !focused || focused === document.body || focused === document.documentElement
                            || focused.id === 'root';
                        const here = String(window.location.pathname || '').replace(/\/+$/, '') || '/';
                        if (idle && here !== PLAYER_APP_BASE && here !== '/') restoreTvFocusWhenReady();
                    }, 60);
                });
            }
            return;
        }
        const firstShow = !shownRef.current;
        shownRef.current = true;
        // Back from a title: the details page's pending let-go must not take the view away again.
        nativeDetailsHandOverToHome();
        setNativeHomeStageClear(true, STAGE_SELECTOR);
        const key = `${resetKey}`;
        const fresh = lastDrawnKey !== key;
        lastDrawnKey = key;
        keyRef.current = key;
        if (fresh) void nativeHomeSetSurface(TV_FLOOR_RGB);
        const json = buildNativeHomePayload(rows, TV_FLOOR_RGB, '245 158 11', viewMoreLabel, tickPosition, fresh);
        if (!fresh && json === payloadRef.current) return;
        payloadRef.current = json;
        void nativeHomeShow(json, firstShow, OWNER);
    }, [showing, rows, resetKey, tickPosition, viewMoreLabel]);

    useEffect(() => () => {
        if (!shownRef.current) return;
        shownRef.current = false;
        void nativeHomeHide(OWNER).then((hidden) => {
            if (hidden) setNativeHomeStageClear(false);
        });
    }, []);

    useEffect(() => {
        if (!on) return undefined;
        const stage = () => document.querySelector<HTMLElement>(STAGE_SELECTOR);
        const find = (rowId?: string, key?: string) => {
            const row = rowsRef.current.find((candidate) => candidate.id === rowId);
            const item = row?.items.find((candidate) => String(candidate.ratingKey || '') === key);
            return row && item ? { row, item } : null;
        };
        const offOpen = onNativeHomeEvent('open', (data) => {
            if (!showingRef.current) return;
            const key = String(data.key || '');
            if (key.startsWith('view-more:')) {
                const row = rowsRef.current.find((candidate) => candidate.id === data.rowId);
                (row?.onViewAll as (() => void) | undefined)?.();
                return;
            }
            const hit = find(data.rowId, key);
            if (hit) openRef.current(hit.item);
        });
        const offFocus = onNativeHomeEvent('focus', (data) => {
            if (!showingRef.current) return;
            const list = rowsRef.current;
            const index = list.findIndex((candidate) => candidate.id === data.rowId);
            const key = String(data.key || '');
            if (index < 0 || key.startsWith('view-more:')) return;
            focusRef.current(index, list[index].id, key);
            window.dispatchEvent(new CustomEvent(NATIVE_HOME_FOCUS_EVENT, { detail: { key, rowId: data.rowId } }));
        });
        const offLong = onNativeHomeEvent('longPress', (data) => {
            if (!showingRef.current) return;
            const key = String(data.key || '');
            if (!key || key.startsWith('view-more:')) return;
            const started = Date.now();
            const tryOpen = () => {
                const poster = Array.from(stage()?.querySelectorAll<HTMLElement>('[data-tv-poster-btn="1"]') || [])
                    .find((el) => el.getAttribute('data-tv-key') === key);
                if (poster) {
                    window.dispatchEvent(new CustomEvent('smp-tv-poster-menu', { detail: { ratingKey: key, poster, handled: false } }));
                    return;
                }
                if (Date.now() - started < 1500) window.setTimeout(tryOpen, 50);
            };
            tryOpen();
        });
        const offBack = onNativeHomeEvent('back', () => {
            if (!showingRef.current) return;
            const handled = typeof window.__SMP_HANDLE_BACK__ === 'function' && window.__SMP_HANDLE_BACK__();
            if (!handled) void nativeHomeExitApp();
        });
        const offHoldEnd = onNativeHomeEvent('holdEnd', () => {
            if (document.documentElement.dataset.nativeMenu === '1') return; // the native menu holds the keys
            if (!showingRef.current) return;
            void nativeHomeReleaseFocus().then(() => {
                window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', keyCode: 13, cancelable: true }));
            });
        });
        const offEdge = onNativeHomeEvent('edgeLeft', () => {
            if (!showingRef.current) return;
            openTvSideNav();
        });
        // Up from the first row: the library's tabs (same as Up on the first web row).
        const offUp = onNativeHomeEvent('edgeUp', () => {
            if (!showingRef.current) return;
            const tab = stage()?.querySelector<HTMLElement>(
                '.player-library-stage-chrome [data-tv-library-tabs="1"] [aria-current="page"],'
                + '.player-library-stage-chrome [data-tv-library-tabs="1"] [data-tv-item="1"]',
            );
            if (!tab) {
                void nativeHomeFocusRows(); // no tabs above: keep the rows selected
                return;
            }
            try {
                tab.focus({ preventScroll: true });
            } catch {
                tab.focus();
            }
        });
        const onFocusIn = (event: FocusEvent) => {
            const target = event.target as HTMLElement | null;
            if (!target?.closest?.(`${STAGE_SELECTOR} .player-home-stage-rail [data-tv-poster-btn="1"]`)) return;
            if (!showingRef.current) return;
            if (document.querySelector(TV_OVERLAY_OPEN)) return;
            try {
                target.blur();
            } catch {
                /* ignore */
            }
            void nativeHomeFocusRows();
        };
        document.addEventListener('focusin', onFocusIn, true);
        let reclaimTimer = 0;
        const reclaimNow = () => {
            if (!shownRef.current || !showingRef.current) return;
            const root = document.documentElement;
            if (root.getAttribute('data-tv-nav-open') === '1') return;
            if (document.querySelector(TV_OVERLAY_OPEN)) return;
            const focused = document.activeElement as HTMLElement | null;
            const idle = !focused || focused === document.body || focused === root
                || !!focused.closest?.(`${STAGE_SELECTOR} .player-home-stage-rail [data-tv-poster-btn="1"]`)
                || !!focused.closest?.('[data-tv-nav-root="1"]');
            if (!idle) return;
            void nativeHomeFocusRows();
        };
        const reclaim = () => {
            window.clearTimeout(reclaimTimer);
            reclaimTimer = window.setTimeout(() => {
                reclaimNow();
                reclaimTimer = window.setTimeout(reclaimNow, 350);
            }, 70);
        };
        document.addEventListener('focusout', reclaim, true);
        let blockedNow = false;
        const syncBlocked = () => {
            if (!showingRef.current) return;
            const open = document.documentElement.dataset.tvNavOpen === '1';
            if (open === blockedNow) return;
            blockedNow = open;
            void nativeHomeSetShift(open && document.documentElement.getAttribute('data-tv-nav-icons') !== '1' ? 235 : 0);
            void nativeHomeSetBlocked(open).then(() => {
                if (open && !document.activeElement?.closest?.('[data-tv-nav-root="1"]')) openTvSideNav();
            });
        };
        const blockObserver = new MutationObserver(syncBlocked);
        blockObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-tv-nav-open'] });
        const navObserver = new MutationObserver(reclaim);
        navObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-tv-nav-open'] });
        return () => {
            document.removeEventListener('focusin', onFocusIn, true);
            document.removeEventListener('focusout', reclaim, true);
            offOpen();
            offFocus();
            offLong();
            offBack();
            offHoldEnd();
            offEdge();
            offUp();
            navObserver.disconnect();
            blockObserver.disconnect();
            window.clearTimeout(reclaimTimer);
            if (blockedNow) {
                void nativeHomeSetBlocked(false);
                void nativeHomeSetShift(0);
            }
        };
    }, [on]);

    return showing;
};
