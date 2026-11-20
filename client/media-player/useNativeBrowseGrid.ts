import { useEffect, useRef, useState } from 'react';
import {
    isNativeHomeSupported,
    nativeBrowseFocus,
    nativeBrowseSet,
    nativeDetailsHandOverToHome,
    nativeHomeExitApp,
    nativeHomeHide,
    nativeHomeReleaseFocus,
    nativeHomeSetBlocked,
    nativeHomeSetShift,
    onNativeHomeEvent,
    setNativeHomeStageClear,
} from '../plex-client/nativeHome';
import { openTvSideNav, rememberTvFocusKey, restoreTvFocusWhenReady, setTvBrowseReturnPoster } from '../plex-client/useTvRemote';
import { buildNativeBrowsePayload, measureBrowseLayout, type BrowseCaptions, type BrowseLayoutMeasure } from './nativeBrowsePayload';
import { measureStudiosLayout, buildStudiosPayload, type StudioSection } from './nativeStudiosPayload';
import { whiteLogoDataUrl } from './PlayerWhiteLogo';
import { PERF_FLAGS_EVENT, readPerfFlags } from './PlayerPerfOverlay';
import { PLAYER_APP_BASE } from './paths';
import { visibleEl } from './nativeScan';
import { TV_FLOOR_RGB } from './tvSurface';
import type { PlayerItem } from './types';

const OWNER = 'browse';
const GRID = '[data-tv-browse-grid="1"]';
const ROOT = '[data-tv-library="1"], [data-tv-watchlist="1"], [data-tv-browse-root="1"]';
export const NATIVE_BROWSE_FOCUS_EVENT = 'smp-browse-native-focus';
const TV_OVERLAY_OPEN = '[data-tv-item-menu="1"], [data-tv-select-menu="1"], [data-tv-resume-dialog="1"], [data-tv-season-watch-dialog="1"], [data-tv-still-watching-dialog="1"], [data-tv-whats-new="1"], [data-tv-home-switch="1"], [data-tv-library-manager="1"], [data-tv-version-dialog="1"], [data-tv-track-dialog="1"], [data-tv-settings-dialog="1"], [data-tv-filter-sheet="1"], [role="dialog"]';

/** The library last drawn: coming back to it (from a title) keeps the poster you were on. */
let lastDrawnKey = '';

type Options = {
    /** Browse tab of a TV library, page showing. */
    active: boolean;
    loading: boolean;
    error: boolean;
    items: PlayerItem[];
    /** Studios tab: tiles in titled sections instead of posters (items is ignored). */
    studios?: StudioSection[];
    onOpenTile?: (key: string) => void;
    captions: BrowseCaptions;
    tickPosition: string;
    /** Changes when a different library starts. */
    resetKey: string;
    onOpenItem: (item: PlayerItem) => void;
};

const headerNodes = () => {
    const root = visibleEl(ROOT);
    if (!root) return [] as HTMLElement[];
    return Array.from(root.children).filter((el) => !el.classList.contains('player-library-body') && !el.matches(GRID) && !el.querySelector(GRID)) as HTMLElement[];
};

const moveHeader = (offset: number) => {
    const value = offset > 0.5 ? `translate3d(0, ${-offset}px, 0)` : '';
    headerNodes().forEach((el) => {
        if (el.style.transform !== value) el.style.transform = value;
    });
};

/**
 * A library's Browse grid drawn by the native view (NativeBrowseGrid), behind the page. The page keeps its
 * header, the A-Z bar and its own (invisible) copy of the grid, so menus, paging and every action are unchanged.
 */
// Tile opened last on the Studios tab, so Back from that studio lands on it again.
let studioReturnKey = '';
/** A letter jump on the A-Z bar: the poster to put the remote on once the native grid has the new titles. */
let jumpFocusKey = '';
export const setNativeBrowseJumpKey = (key: string) => {
    jumpFocusKey = key;
};

// Instances that currently have the native grid up: a page's delayed clean-up must not undo a newer one's set-up.
const drawing = new Set<object>();

export const useNativeBrowseGrid = ({
    active,
    loading,
    error,
    items,
    studios,
    onOpenTile,
    captions,
    tickPosition,
    resetKey,
    onOpenItem,
}: Options): boolean => {
    const [flag, setFlag] = useState(() => readPerfFlags().nativeHome);
    // Bumped when the sidebar opens or closes: the page re-flows its grid (fewer columns), so the native one re-measures.
    const [layoutTick, setLayoutTick] = useState(0);
    useEffect(() => {
        const onFlags = () => setFlag(readPerfFlags().nativeHome);
        window.addEventListener(PERF_FLAGS_EVENT, onFlags);
        return () => window.removeEventListener(PERF_FLAGS_EVENT, onFlags);
    }, []);
    const on = flag && isNativeHomeSupported() && document.documentElement.dataset.tv === '1';
    const tileCount = studios ? studios.reduce((n, section) => n + section.cards.length, 0) : 0;
    const showing = on && active && !loading && !error && (studios ? tileCount > 0 : items.length > 0);
    // Whitened logos (data URLs) for the Studios tiles, filled in as each one is ready. A key with null = no logo.
    const [logoTick, setLogoTick] = useState(0);
    const logosRef = useRef<Map<string, string | null>>(new Map());
    const studiosRef = useRef(studios);
    studiosRef.current = studios;
    const openTileRef = useRef(onOpenTile);
    openTileRef.current = onOpenTile;

    const itemsRef = useRef(items);
    itemsRef.current = items;
    const openRef = useRef(onOpenItem);
    openRef.current = onOpenItem;
    const captionsRef = useRef(captions);
    captionsRef.current = captions;
    const showingRef = useRef(false);
    showingRef.current = showing;
    const shownRef = useRef(false);
    const payloadRef = useRef('');
    const lastKeyRef = useRef('');
    const handoffUntilRef = useRef(0);
    const retryRef = useRef(0);
    const tokenRef = useRef<object>({});

    useEffect(() => {
        window.clearTimeout(retryRef.current);
        const clearDom = () => {
            delete document.documentElement.dataset.nativeBrowse;
            moveHeader(0);
        };
        if (!showing) {
            if (shownRef.current) {
                shownRef.current = false;
                drawing.delete(tokenRef.current);
                payloadRef.current = '';
                if (drawing.size === 0) clearDom();
                void nativeHomeHide(OWNER).then((hidden) => {
                    if (!hidden) return;
                    if (drawing.size === 0) setNativeHomeStageClear(false);
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
        const measured = studios ? measureStudiosLayout() : measureBrowseLayout();
        if (!measured) {
            // Not on screen (a detail page is over this one) or not laid out yet: forget what was drawn and look again shortly,
            // so coming back redraws the grid.
            shownRef.current = false;
            drawing.delete(tokenRef.current);
            payloadRef.current = '';
            retryRef.current = window.setTimeout(() => {
                if (showingRef.current) setLayoutTick((n) => n + 1);
            }, 500);
            return;
        }
        const firstShow = !shownRef.current;
        shownRef.current = true;
        drawing.add(tokenRef.current);
        nativeDetailsHandOverToHome();
        setNativeHomeStageClear(true, ROOT);
        document.documentElement.dataset.nativeBrowse = '1';
        if (window.scrollY || document.documentElement.scrollTop) window.scrollTo(0, 0);
        const fresh = lastDrawnKey !== resetKey;
        lastDrawnKey = resetKey;
        const json = studios
            ? buildStudiosPayload(studios, measured.layout as Record<string, unknown>, logosRef.current)
            : buildNativeBrowsePayload(items, measured.layout as BrowseLayoutMeasure, captionsRef.current, tickPosition);
        if (!firstShow && !fresh && json === payloadRef.current) return;
        payloadRef.current = json;
        const back = studios && firstShow ? studioReturnKey : '';
        if (studios) studioReturnKey = '';
        void nativeBrowseSet(json, measured.vw, fresh, TV_FLOOR_RGB, firstShow).then(() => {
            if (jumpFocusKey) {
                const want = jumpFocusKey;
                if (itemsRef.current.some((row) => String(row.ratingKey || '') === want)) {
                    jumpFocusKey = '';
                    void nativeBrowseFocus(want);
                    return;
                }
            }
            if (back) {
                void nativeBrowseFocus(back); // Back from a studio lands on the tile you opened
                return;
            }
            // Collection / Studio pages have no tabs to hold the focus: the grid takes it when nothing else has.
            if (firstShow && document.querySelector('[data-tv-browse-root="1"]')) {
                const focused = document.activeElement as HTMLElement | null;
                const idle = !focused || focused === document.body || focused === document.documentElement || focused.id === 'root';
                const first = studios ? '' : String((items as Array<{ ratingKey?: string }>)[0]?.ratingKey || '');
                if (idle && first) {
                    const take = () => {
                        const now = document.activeElement as HTMLElement | null;
                        const still = !now || now === document.body || now === document.documentElement || now.id === 'root';
                        if (still && !document.querySelector(TV_OVERLAY_OPEN) && document.documentElement.getAttribute('data-tv-nav-open') !== '1') {
                            void nativeBrowseFocus(first);
                        }
                    };
                    window.setTimeout(take, 350);
                    window.setTimeout(take, 900);
                }
            }
        });
    }, [showing, items, studios, resetKey, tickPosition, layoutTick, logoTick]);

    // Studios: make the white logos once, then redraw (batched, so a few updates at most).
    useEffect(() => {
        if (!showing || !studios) return undefined;
        let cancelled = false;
        let timer = 0;
        const bump = () => {
            if (timer || cancelled) return;
            timer = window.setTimeout(() => {
                timer = 0;
                if (!cancelled) setLogoTick((n) => n + 1);
            }, 350);
        };
        studios.forEach((section) => section.cards.forEach((card) => {
            const key = card.logoPath || '';
            if (!key || logosRef.current.has(key)) return;
            void whiteLogoDataUrl(key).then((url) => {
                if (cancelled) return;
                logosRef.current.set(key, url);
                bump();
            });
        }));
        return () => {
            cancelled = true;
            window.clearTimeout(timer);
        };
    }, [showing, studios]);

    useEffect(() => () => {
        if (!shownRef.current) return;
        shownRef.current = false;
        drawing.delete(tokenRef.current);
        if (drawing.size > 0) return; // another page (the one underneath) draws the grid now: leave it up
        delete document.documentElement.dataset.nativeBrowse;
        moveHeader(0);
        void nativeHomeHide(OWNER).then((hidden) => {
            if (hidden && drawing.size === 0) setNativeHomeStageClear(false);
        });
    }, []);

    useEffect(() => {
        if (!on) return undefined;
        const find = (key: string) => itemsRef.current.find((candidate) => String(candidate.ratingKey || '') === key) || null;
        const posterFor = (key: string) => Array.from(document.querySelectorAll<HTMLElement>(`${GRID} [data-tv-poster-btn="1"]`))
            .find((el) => el.getAttribute('data-tv-key') === key) || null;
        let rememberTimer = 0;
        const offOpen = onNativeHomeEvent('browseOpen', (data) => {
            if (!showingRef.current) return;
            const key = String(data.key || '');
            if (studiosRef.current) {
                studioReturnKey = key;
                openTileRef.current?.(key);
                return;
            }
            const item = find(key);
            if (item) openRef.current(item);
        });
        const offFocus = onNativeHomeEvent('browseFocus', (data) => {
            if (!showingRef.current) return;
            const key = String(data.key || '');
            lastKeyRef.current = key;
            const index = Number(data.rowId);
            if (Number.isFinite(index)) {
                window.dispatchEvent(new CustomEvent(NATIVE_BROWSE_FOCUS_EVENT, { detail: { index } }));
            }
            // Back from a title lands on the same poster: the page's own memory of where you were.
            window.clearTimeout(rememberTimer);
            rememberTimer = window.setTimeout(() => rememberTvFocusKey(key), 250);
        });
        const offLong = onNativeHomeEvent('browseLongPress', (data) => {
            if (!showingRef.current) return;
            const key = String(data.key || '');
            if (!key) return;
            const started = Date.now();
            const tryOpen = () => {
                const poster = posterFor(key);
                if (poster) {
                    window.dispatchEvent(new CustomEvent('smp-tv-poster-menu', { detail: { ratingKey: key, poster, handled: false } }));
                    return;
                }
                if (Date.now() - started < 1500) window.setTimeout(tryOpen, 50);
            };
            tryOpen();
        });
        // Up from the first row / Right from the last column: the page runs the key from that poster.
        const offHandoff = onNativeHomeEvent('browseHandoff', (data) => {
            if (!showingRef.current) return;
            const poster = posterFor(String(data.key || ''));
            const dir = String(data.rowId || '');
            if (!poster || !dir) return;
            handoffUntilRef.current = Date.now() + 900;
            setTvBrowseReturnPoster(poster);
            const focusEl = (el: HTMLElement | null) => {
                if (!el) return false;
                try {
                    el.focus({ preventScroll: true });
                } catch {
                    el.focus();
                }
                return true;
            };
            if (dir === 'up') {
                const first = visibleEl('[data-tv-library-filters="1"] [data-tv-item="1"], [data-tv-library-filters="1"] [data-tv-key]');
                const tab = visibleEl(
                    '[data-tv-library-tabs="1"] [aria-current="page"], [data-tv-library-tabs="1"] [data-tv-item="1"]',
                );
                if (!focusEl(first || tab)) void nativeBrowseFocus(String(data.key || '')); // nothing above (Watchlist): stay put
                return;
            }
            if (studiosRef.current) {
                void nativeBrowseFocus(String(data.key || '')); // no A–Z bar here: stay on the tile
                return;
            }
            // Right from the last column: the A–Z bar, on the letter of this title.
            const letters = Array.from(document.querySelectorAll<HTMLElement>('[data-tv-alpha="1"] [data-tv-item="1"]')).filter((el) => el.getClientRects().length > 0);
            const title = String(find(String(data.key || ''))?.title || '').trim().charAt(0).toUpperCase();
            const want = /[A-Z]/.test(title) ? title : '#';
            const pick = letters.find((el) => (el.textContent || '').trim().toUpperCase() === want) || letters[0] || null;
            if (!focusEl(pick)) void nativeBrowseFocus(String(data.key || ''));
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
        const offScroll = onNativeHomeEvent('browseScroll', (data) => {
            if (!showingRef.current) return;
            const zoom = Number.parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
            // y arrives in the page's layout px; CSS px inside the zoomed page are 1/zoom of that.
            moveHeader(Math.max(0, Number(data.key) || 0) / zoom);
        });
        // The page's own focus calls (a letter jump, back from the header) reach its hidden copy of the poster.
        const onFocusIn = (event: FocusEvent) => {
            const target = event.target as HTMLElement | null;
            const poster = target?.closest?.(`${GRID} [data-tv-poster-btn="1"]`) as HTMLElement | null;
            if (!poster || !showingRef.current) return;
            if (Date.now() < handoffUntilRef.current) return;
            if (document.querySelector(TV_OVERLAY_OPEN)) return;
            const key = String(poster.getAttribute('data-tv-key') || '');
            try {
                poster.blur();
            } catch {
                /* ignore */
            }
            if (key) void nativeBrowseFocus(key);
        };
        document.addEventListener('focusin', onFocusIn, true);
        // A key pressed on the header (tabs, filters) is the user moving again: a quick Down must reach the grid
        // even while the hand-off window from the last Up is still open.
        const onKeyDown = (event: KeyboardEvent) => {
            if (!showingRef.current || handoffUntilRef.current === 0) return;
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
            const focused = document.activeElement as HTMLElement | null;
            if (focused && !focused.closest?.(`${GRID} [data-tv-poster-btn="1"]`) && focused !== document.body) handoffUntilRef.current = 0;
        };
        document.addEventListener('keydown', onKeyDown, true);
        // The page itself must not scroll (the grid's own scroll moves the header with it).
        const onPageScroll = () => {
            if (!showingRef.current) return;
            if (window.scrollY || document.documentElement.scrollTop) window.scrollTo(0, 0);
        };
        window.addEventListener('scroll', onPageScroll, { passive: true });
        let reclaimTimer = 0;
        const reclaimNow = () => {
            if (!shownRef.current || !showingRef.current) return;
            const root = document.documentElement;
            if (root.getAttribute('data-tv-nav-open') === '1') return;
            if (document.querySelector(TV_OVERLAY_OPEN)) return;
            if (Date.now() < handoffUntilRef.current) {
                // Still inside a hand-off: look again once it ends, so a quick Down back off the header can't strand the focus.
                window.clearTimeout(reclaimTimer);
                reclaimTimer = window.setTimeout(reclaimNow, handoffUntilRef.current - Date.now() + 60);
                return;
            }
            const focused = document.activeElement as HTMLElement | null;
            const idle = !focused || focused === document.body || focused === root
                || !!focused.closest?.(`${GRID} [data-tv-poster-btn="1"]`)
                || !!focused.closest?.('[data-tv-nav-root="1"]');
            if (!idle) return;
            void nativeBrowseFocus(lastKeyRef.current);
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
            window.setTimeout(() => setLayoutTick((n) => n + 1), 350);
            window.setTimeout(() => setLayoutTick((n) => n + 1), 900);
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
            document.removeEventListener('keydown', onKeyDown, true);
            document.removeEventListener('focusout', reclaim, true);
            window.removeEventListener('scroll', onPageScroll);
            offOpen();
            offFocus();
            offLong();
            offHandoff();
            offBack();
            offHoldEnd();
            offEdge();
            offScroll();
            navObserver.disconnect();
            blockObserver.disconnect();
            window.clearTimeout(reclaimTimer);
            window.clearTimeout(rememberTimer);
            if (blockedNow) {
                void nativeHomeSetBlocked(false);
                void nativeHomeSetShift(0);
            }
        };
    }, [on]);

    return showing;
};
