import { useEffect } from 'react';
import { readDocumentZoom } from '../shared/ui';
import { isAndroidTvUi } from './config';
import { PLAYER_APP_BASE, PLAYER_NAVIGATE_EVENT, PLAYER_SCROLL_ID, PLAYER_TV_NAV_EVENT } from '../media-player/paths';
import { PLAYER_SEARCH_INPUT_ID, requestPlayerHomeReset } from '../media-player/playerMemory';
import { requestBrowseFocusAbs } from '../media-player/playerUtils';

const TV_ITEM = '[data-tv-item="1"]';
const TV_RAIL = '[data-tv-rail="1"]';
const TV_NAV_ROOT = '[data-tv-nav-root="1"]';
const TV_NAV_ITEM = '[data-tv-nav="1"]';
const TV_POSTER_BTN = '[data-tv-poster-btn="1"]';
const TV_COVER_BTN = '[data-tv-poster-btn="1"], [data-tv-extra-btn="1"], [data-tv-episode-btn="1"], [data-tv-season-poster-btn="1"]';

const isEditableTarget = (target: EventTarget | null) => {
    const el = target as HTMLElement | null;
    if (!el) return false;
    const tag = String(el.tagName || '').toLowerCase();
    if (tag === 'textarea') return !(el as HTMLTextAreaElement).readOnly && !(el as HTMLTextAreaElement).disabled;
    if (tag === 'select') return !(el as HTMLSelectElement).disabled;
    if (tag === 'input') {
        const input = el as HTMLInputElement;
        if (input.readOnly || input.disabled) return false;
        return true;
    }
    return el.isContentEditable === true;
};

/**
 * True when the element actually has layout. getClientRects() is empty when the
 * element OR ANY ANCESTOR is display:none — critical because the dashboard keeps
 * the home screen mounted (hidden) under other views, and computed style on
 * those descendants still reports their own display value. Focusing an element
 * without layout silently fails, which bricked D-pad nav on details pages.
 */
const hasLayout = (el: HTMLElement) => el.getClientRects().length > 0;

const focusableTvItems = (root: ParentNode = document) => (
    Array.from(root.querySelectorAll<HTMLElement>(TV_ITEM)).filter((el) => {
        if (el.hasAttribute('disabled')) return false;
        if (el.getAttribute('aria-hidden') === 'true') return false;
        if (el.closest(TV_NAV_ROOT)) return false;
        if (!hasLayout(el)) return false;
        return el.tabIndex !== -1;
    })
);

/** Ordered content rails (excludes side nav and hidden screens). */
const visibleContentRails = () => {
    const root: ParentNode = document.getElementById(PLAYER_SCROLL_ID) || document;
    return Array.from(root.querySelectorAll<HTMLElement>(TV_RAIL)).filter((rail) => {
        if (rail.closest(TV_NAV_ROOT)) return false;
        if (!hasLayout(rail)) return false;
        return focusableTvItems(rail).length > 0;
    });
};

const TV_OVERLAY = '[data-tv-item-menu="1"], [data-tv-select-menu="1"], [data-tv-resume-dialog="1"], [data-tv-season-watch-dialog="1"], [data-tv-home-switch="1"], [data-tv-version-dialog="1"], [data-tv-track-dialog="1"], [data-tv-settings-dialog="1"], [data-tv-playback="1"], [data-tv-playback-overlay="1"]';
const TV_AUTH = '[data-tv-auth="1"]';

/** Prefer a real menu; a playback cover still owns the remote even with no buttons. */
const tvOverlayRoot = () => (
    Array.from(document.querySelectorAll<HTMLElement>(TV_OVERLAY)).find((node) => (
        focusableTvItems(node).length > 0
        || node.getAttribute('data-tv-playback-overlay') === '1'
        || node.getAttribute('data-tv-playback') === '1'
    )) || null
);

type SpatialDir = 'left' | 'right' | 'up' | 'down';

const isAuthScreen = () => Boolean(document.querySelector(TV_AUTH));

const inputCaretAtEdge = (input: HTMLInputElement | HTMLTextAreaElement, dir: SpatialDir) => {
    const start = input.selectionStart ?? 0;
    const end = input.selectionEnd ?? 0;
    if (dir === 'left') return start === 0 && end === 0;
    if (dir === 'right') return start === input.value.length && end === input.value.length;
    return true;
};

const activateFocusedTvItem = (event: KeyboardEvent): boolean => {
    const focused = document.activeElement as HTMLElement | null;
    const item = focused?.closest?.<HTMLElement>(TV_ITEM) || null;
    if (!item || item.hasAttribute('disabled')) return false;
    const tag = String(item.tagName || '').toLowerCase();
    const clickable = tag === 'button'
        || tag === 'a'
        || item.getAttribute('role') === 'button'
        || item.getAttribute('data-tv-action') === '1';
    if (!clickable) return false;
    event.preventDefault();
    event.stopPropagation();
    item.click();
    return true;
};

const isOverlayItem = (el: HTMLElement) => !!el.closest(TV_OVERLAY);

/** Keep a focused overlay row visible inside the overlay only — never pan the page. */
const scrollOverlayOnly = (el: HTMLElement) => {
    const scroller = (
        el.closest<HTMLElement>('[data-tv-overlay-scroll="1"]')
        || el.closest<HTMLElement>(TV_OVERLAY)
    );
    if (!scroller) return;
    const box = scroller.getBoundingClientRect();
    const row = el.getBoundingClientRect();
    if (row.top < box.top) scroller.scrollTop -= (box.top - row.top);
    else if (row.bottom > box.bottom) scroller.scrollTop += (row.bottom - box.bottom);
};

const PEEK_PX = 72;

/** Item position inside a rail in layout px (CSS zoom divides visual rects). */
const offsetInScroller = (scroller: HTMLElement, node: HTMLElement) => {
    const zoom = Math.max(0.01, readDocumentZoom());
    const s = scroller.getBoundingClientRect();
    const n = node.getBoundingClientRect();
    return {
        left: scroller.scrollLeft + (n.left - s.left) / zoom,
        top: scroller.scrollTop + (n.top - s.top) / zoom,
        width: n.width / zoom,
        height: n.height / zoom,
    };
};

/** One horizontal pan of a poster rail. Never pair with scrollIntoView on the same item. */
const revealNeighbor = (el: HTMLElement, dir: SpatialDir | undefined) => {
    if (!dir) return;
    if (dir !== 'left' && dir !== 'right') return;
    const rail = el.closest<HTMLElement>('[data-tv-poster-rail="1"]');
    if (!rail || rail.scrollWidth <= rail.clientWidth + 8) return;

    const card = (el.closest('[data-tv-poster-card="1"], [data-tv-poster-btn="1"]') as HTMLElement | null) || el;
    const box = offsetInScroller(rail, card);
    const max = Math.max(0, rail.scrollWidth - rail.clientWidth);
    const peek = PEEK_PX;
    let next = rail.scrollLeft;

    if (dir === 'right') {
        const wantRight = box.left + box.width + peek;
        const visibleRight = rail.scrollLeft + rail.clientWidth;
        if (wantRight > visibleRight + 0.5) {
            next = Math.min(max, wantRight - rail.clientWidth);
        }
    } else {
        const wantLeft = Math.max(0, box.left - peek);
        if (wantLeft < rail.scrollLeft - 0.5) {
            next = wantLeft;
        }
        // Near the start of the rail — settle flush left (no half-step snap-back).
        if (box.left < rail.clientWidth * 0.55) {
            next = 0;
        }
    }

    if (Math.abs(next - rail.scrollLeft) < 0.5) return;

    // Prefer scrollLeft. Under CSS zoom Chromium sometimes ignores it — then one
    // scrollIntoView with temporary peek padding (never a second pass).
    rail.scrollLeft = next;
    if (Math.abs(rail.scrollLeft - next) <= 1) return;

    const prevPadL = rail.style.scrollPaddingLeft;
    const prevPadR = rail.style.scrollPaddingRight;
    rail.style.scrollPaddingLeft = dir === 'left' ? `${peek}px` : '0px';
    rail.style.scrollPaddingRight = dir === 'right' ? `${peek}px` : '0px';
    try {
        card.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'auto' });
    } catch {
        try {
            card.scrollIntoView(false);
        } catch {
            /* ignore */
        }
    }
    rail.style.scrollPaddingLeft = prevPadL;
    rail.style.scrollPaddingRight = prevPadR;
};

/** Play / Open / title actions — not seasons, cast, or poster rails. */
const isHeaderControl = (el: HTMLElement) => {
    if (el.closest('[data-tv-row="1"], [data-tv-poster-rail="1"], [data-tv-season-poster-btn="1"], [data-tv-episode-btn="1"], [data-tv-extra-btn="1"], [data-tv-episode-neighbor="1"]')) {
        return false;
    }
    return Boolean(el.closest('.player-home-hero, [data-tv-action-row="1"], .media-details-hero-row, .media-details-hero-content'));
};

const pageTopFor = (from: HTMLElement) => {
    const details = from.closest<HTMLElement>('[data-tv-details="1"]');
    if (details) {
        return details.querySelector<HTMLElement>('[data-tv-page-top="1"]') || details;
    }
    return from.closest<HTMLElement>('.player-home-hero, [data-tv-page-top="1"]');
};

/** One rail / section. Never the whole page. */
const focusedRow = (el: HTMLElement) => {
    if (isHeaderControl(el)) {
        return pageTopFor(el) || el;
    }
    const named = el.closest<HTMLElement>('.player-rail-enter, [data-tv-row="1"]');
    if (named) return named;
    const rail = el.closest<HTMLElement>('[data-tv-poster-rail="1"]');
    if (rail && rail.scrollWidth > rail.clientWidth + 8) {
        return (rail.closest<HTMLElement>('section') || rail.parentElement || rail) as HTMLElement;
    }
    const page = document.getElementById(PLAYER_SCROLL_ID);
    const section = el.closest<HTMLElement>('section');
    if (section && page && section.offsetHeight < page.clientHeight * 1.1) return section;
    return el;
};

let pinTopRaf = 0;
const pinTopTimers: ReturnType<typeof window.setTimeout>[] = [];

const clearPinTopFollowup = () => {
    if (pinTopRaf) {
        window.cancelAnimationFrame(pinTopRaf);
        pinTopRaf = 0;
    }
    while (pinTopTimers.length) {
        window.clearTimeout(pinTopTimers.pop());
    }
};

const firstDetailsRowItem = (details: ParentNode) => (
    Array.from(details.querySelectorAll<HTMLElement>('[data-tv-music-track="1"]')).find(hasLayout)
    || Array.from(details.querySelectorAll<HTMLElement>('[data-tv-episode-btn="1"]')).find(hasLayout)
    || Array.from(details.querySelectorAll<HTMLElement>(
        '[data-tv-season-poster-btn="1"]'
    )).find(hasLayout)
    || Array.from(details.querySelectorAll<HTMLElement>('[data-tv-episode-neighbor-btn="1"]')).find(hasLayout)
    || Array.from(details.querySelectorAll<HTMLElement>('[data-tv-cast="1"]')).find(hasLayout)
    || null
);

const detailsPlayButton = (details: ParentNode) => {
    const items = focusableTvItems(details);
    return items.find((el) => el.getAttribute('data-tv-play') === '1')
        || items.find((el) => Boolean(el.closest('[data-tv-action-row="1"]')))
        || null;
};

const sameDetailsEntryRow = (current: HTMLElement, firstBelow: HTMLElement) => {
    if (current === firstBelow || current.contains(firstBelow) || firstBelow.contains(current)) return true;
    const currentRow = current.closest<HTMLElement>('[data-tv-row="1"], [data-tv-episode-neighbor="1"]');
    return Boolean(currentRow && currentRow.contains(firstBelow));
};

const applyPinTvDetailsTop = (): boolean => {
    const scroller = document.getElementById(PLAYER_SCROLL_ID);
    const details = scroller?.querySelector<HTMLElement>('[data-tv-details="1"]');
    const marker = details?.querySelector<HTMLElement>('[data-tv-page-top="1"]') || details || null;
    if (!scroller || !marker || !details) return true;

    const focused = document.activeElement as HTMLElement | null;
    const focusedItem = focused?.closest?.<HTMLElement>(TV_ITEM);
    if (focusedItem && details.contains(focusedItem) && !isHeaderControl(focusedItem)) {
        return true;
    }

    const zoom = Math.max(0.01, readDocumentZoom());
    const gap = () => marker.getBoundingClientRect().top - scroller.getBoundingClientRect().top;

    scroller.scrollTop = 0;
    try {
        details.scrollIntoView({ block: 'start', inline: 'nearest', behavior: 'auto' });
    } catch {
        try { marker.scrollIntoView(true); } catch { /* ignore */ }
    }

    let delta = gap();
    if (Math.abs(delta) >= 2) {
        scroller.scrollTop = Math.max(0, scroller.scrollTop + delta / zoom);
        try {
            marker.scrollIntoView({ block: 'start', inline: 'nearest', behavior: 'auto' });
        } catch {
            /* ignore */
        }
    }
    return Math.abs(gap()) < 2;
};

/**
 * CSS zoom ignores scrollTop and makes one scrollIntoView miss.
 * Repeat until the details sentinel sits on the scrollport’s top edge
 * so the poster/title are not shoved under the bezel.
 */
export const pinTvDetailsTop = () => {
    clearPinTopFollowup();
    if (applyPinTvDetailsTop()) return;
    pinTopRaf = window.requestAnimationFrame(() => {
        if (applyPinTvDetailsTop()) return;
        pinTopRaf = window.requestAnimationFrame(() => {
            applyPinTvDetailsTop();
        });
        pinTopTimers.push(window.setTimeout(applyPinTvDetailsTop, 48));
        pinTopTimers.push(window.setTimeout(applyPinTvDetailsTop, 140));
    });
};

/** CSS zoom on TV makes element.scrollTop a no-op. Native scrollIntoView is what actually moves the page. */
const scrollEl = (node: HTMLElement, block: ScrollLogicalPosition, behavior: ScrollBehavior | 'css' = 'auto') => {
    try {
        if (behavior === 'css') {
            // Omit behavior so #media-player-scroll's scroll-behavior: smooth applies (row bounce).
            node.scrollIntoView({ inline: 'nearest', block });
        } else {
            node.scrollIntoView({ inline: 'nearest', block, behavior });
        }
    } catch {
        try {
            node.scrollIntoView(block === 'start');
        } catch {
            /* ignore */
        }
    }
};

/** Vertical row moves must not pan overflow-x rails — that clips the first poster / glow. */
const scrollRowWithoutPanningRails = (
    row: HTMLElement,
    block: ScrollLogicalPosition,
    behavior: ScrollBehavior | 'css' = 'auto',
) => {
    const rails = row.querySelectorAll<HTMLElement>('[data-tv-poster-rail="1"], [data-tv-rail="1"]');
    const prevOverflow: string[] = [];
    const prevScroll: number[] = [];
    rails.forEach((rail) => {
        prevOverflow.push(rail.style.overflowX);
        prevScroll.push(rail.scrollLeft);
        rail.style.overflowX = 'hidden';
    });
    scrollEl(row, block, behavior);
    rails.forEach((rail, i) => {
        rail.style.overflowX = prevOverflow[i] || '';
        // Zoom / scrollIntoView can nudge scrollLeft even while overflow was hidden.
        rail.scrollLeft = prevScroll[i] ?? 0;
    });
};

/** Home: center the focused row so half the previous and next rails peek in view. */
let homePeekRaf = 0;

const clearHomePeekFollowup = () => {
    if (homePeekRaf) {
        window.cancelAnimationFrame(homePeekRaf);
        homePeekRaf = 0;
    }
};

const scrollHomeRowWithPeek = (row: HTMLElement, _dir: 'up' | 'down') => {
    // Rapid Down must not stack smooth scrolls — that is what made home feel broken.
    clearHomePeekFollowup();
    const page = document.getElementById(PLAYER_SCROLL_ID);

    // Balanced insets so block:center leaves half a rail above and below.
    // Do NOT reset rail.scrollLeft — preserve last focused poster in the row.
    if (page) {
        const zoom = Math.max(0.01, readDocumentZoom());
        const edge = Math.round(48 / zoom);
        page.style.scrollPaddingTop = `${edge}px`;
        page.style.scrollPaddingBottom = `${edge}px`;
    }

    const frame = () => {
        scrollRowWithoutPanningRails(row, 'center', 'auto');
    };
    frame();
    // One zoom follow-up only (some TV WebViews miss the first pass).
    homePeekRaf = window.requestAnimationFrame(() => {
        homePeekRaf = 0;
        frame();
    });
};

const focusItem = (el: HTMLElement, block: ScrollLogicalPosition = 'nearest', dir?: SpatialDir) => {
    try {
        el.focus({ preventScroll: true });
    } catch {
        el.focus();
    }
    syncPosterFocusAttr();
    const alphaBar = el.closest<HTMLElement>('[data-tv-alpha="1"]');
    if (alphaBar) {
        const barRect = alphaBar.getBoundingClientRect();
        const rect = el.getBoundingClientRect();
        if (rect.top < barRect.top) alphaBar.scrollTop -= barRect.top - rect.top;
        else if (rect.bottom > barRect.bottom) alphaBar.scrollTop += rect.bottom - barRect.bottom;
        return;
    }
    if (isOverlayItem(el)) {
        const page = document.getElementById(PLAYER_SCROLL_ID);
        const frozen = page?.scrollTop ?? 0;
        scrollOverlayOnly(el);
        if (page) page.scrollTop = frozen;
        return;
    }
    if (el.getAttribute('data-tv-music-track') === '1' || el.closest('[data-tv-list="1"]')) {
        scrollEl(el, 'nearest', 'css');
        return;
    }
    if (isHeaderControl(el)) {
        if (el.closest('[data-tv-details="1"]')) {
            pinTvDetailsTop();
            window.requestAnimationFrame(pinTvDetailsTop);
            return;
        }
        const top = pageTopFor(el);
        if (top) {
            scrollEl(top, 'start');
            return;
        }
    }
    const settingsRoot = el.closest<HTMLElement>('[data-tv-settings="1"]');
    if (settingsRoot) {
        const first = settingsRoot.querySelector<HTMLElement>('[data-tv-item="1"]');
        if (first && (el === first || first.contains(el))) {
            const top = settingsRoot.querySelector<HTMLElement>('[data-tv-page-top="1"]') || settingsRoot;
            scrollEl(top, 'start');
            return;
        }
        if (dir === 'up' || dir === 'down') {
            const block = el.closest('[data-tv-settings-actions="1"]') ? 'end' : 'nearest';
            scrollRowWithoutPanningRails(focusedRow(el), block, 'css');
            return;
        }
    }
    const details = Boolean(el.closest('[data-tv-details="1"]'));
    const personPage = Boolean(el.closest('[data-tv-person="1"]'));
    const posterGrid = el.closest<HTMLElement>('[data-tv-poster-grid="1"], .upgrader-poster-grid');
    const posterCard = el.closest<HTMLElement>('[data-tv-poster-card="1"]')
        || (el.getAttribute('data-tv-poster-btn') === '1' ? el.parentElement : null);
    // Wrapping poster grids (actor, library, hub): keep the whole card — art + title —
    // in the safe area. Centering the last row otherwise clips it on the bezel.
    if (posterGrid && posterCard) {
        const cardBox = posterCard.getBoundingClientRect();
        const port = document.getElementById(PLAYER_SCROLL_ID)?.getBoundingClientRect();
        const clippedBottom = Boolean(port && cardBox.bottom > port.bottom - 12);
        scrollEl(posterCard, clippedBottom ? 'end' : 'nearest', 'css');
        return;
    }
    // Title pages have a tall hero. Centering the seasons/episodes/cast row
    // chops the poster to a sliver. Park the row at the bottom instead.
    if (dir === 'up' || dir === 'down') {
        const row = focusedRow(el);
        if (!details && isPlayerHomePath() && row) {
            scrollHomeRowWithPeek(row, dir);
            return;
        }
        // Person page: hero controls pin the page top; filmography rows scroll
        // the focused row itself (centering a tall decade group would not move).
        if (personPage) {
            if (el.closest('[data-tv-person-hero="1"]')) {
                const top = el.closest<HTMLElement>('[data-tv-page-top="1"]');
                if (top) scrollEl(top, 'start');
                return;
            }
            if (el.closest('[data-tv-poster-rail="1"]') && row) {
                scrollRowWithoutPanningRails(row, 'center', 'auto');
                return;
            }
            scrollEl(el, 'center', 'auto');
            return;
        }
        scrollRowWithoutPanningRails(row, details ? 'end' : 'center', 'css');
        return;
    }
    // Left/right on a poster rail: revealNeighbor alone. scrollEl + revealNeighbor
    // both pan the same overflow-x scroller and produce the visible rebound.
    if ((dir === 'left' || dir === 'right') && el.closest('[data-tv-poster-rail="1"]')) {
        if (details) {
            scrollRowWithoutPanningRails(focusedRow(el), 'end');
        }
        revealNeighbor(el, dir);
        return;
    }
    if (details && el.closest('[data-tv-row="1"]')) {
        scrollEl(focusedRow(el), 'end');
        return;
    }
    scrollEl(el, block);
};

let focusedPosterEl: HTMLElement | null = null;

const syncPosterFocusAttr = () => {
    const active = document.activeElement as HTMLElement | null;
    const next = (active?.closest?.(TV_COVER_BTN) as HTMLElement | null)
        || (active?.matches?.(TV_COVER_BTN) ? active : null);
    if (focusedPosterEl && focusedPosterEl !== next) {
        focusedPosterEl.removeAttribute('data-tv-focused');
    }
    if (next && next !== focusedPosterEl) next.setAttribute('data-tv-focused', '1');
    focusedPosterEl = next;
};

const currentPath = () => String(window.location.pathname || '').replace(/\/+$/, '') || '/';

type TvFocusSnapshot = { key: string; railScroll?: number };

const tvFocusByPath = new Map<string, TvFocusSnapshot>();
/** Last focused poster within a home/library rail — restored when re-entering the row. */
const tvRowFocusById = new Map<string, TvFocusSnapshot>();

const rowFocusIdOf = (row: HTMLElement | null) => {
    if (!row) return '';
    const named = row.getAttribute('data-tv-row-id');
    if (named) return named;
    const title = row.querySelector('h2, .player-row-header-title')?.textContent?.trim();
    if (title) return `title:${title}`;
    const firstKey = row.querySelector('[data-tv-key]')?.getAttribute('data-tv-key');
    return firstKey ? `key:${firstKey}` : '';
};

export const hasRememberedTvFocus = (path = currentPath()) => Boolean(tvFocusByPath.get(path)?.key);

export const rememberTvFocusKey = (key: string, path = currentPath(), railScroll?: number) => {
    const id = String(key || '').trim();
    if (!id || !path) return;
    const prev = tvFocusByPath.get(path);
    tvFocusByPath.set(path, {
        key: id,
        railScroll: railScroll ?? (prev?.key === id ? prev.railScroll : undefined),
    });
};

const rememberRowFocus = (item: HTMLElement | null) => {
    if (!item) return;
    const row = item.closest<HTMLElement>('[data-tv-row="1"]');
    const rowId = rowFocusIdOf(row);
    const key = tvKeyOf(item);
    if (!rowId || !key) return;
    const rail = item.closest<HTMLElement>('[data-tv-poster-rail="1"]');
    tvRowFocusById.set(rowId, { key, railScroll: rail?.scrollLeft });
};

/** Remember the focused poster and horizontal rail scroll before playback or navigation. */
export const captureTvFocusSnapshot = () => {
    const active = document.activeElement as HTMLElement | null;
    const item = active?.closest?.<HTMLElement>(TV_ITEM) || active;
    const key = tvKeyOf(item);
    if (!key) return;
    const rail = item?.closest?.<HTMLElement>('[data-tv-poster-rail="1"]');
    rememberTvFocusKey(key, currentPath(), rail?.scrollLeft);
    rememberRowFocus(item);
};

const tvKeyOf = (el: HTMLElement | null) => {
    if (!el) return '';
    const own = el.getAttribute('data-tv-key');
    if (own) return own;
    return el.closest('[data-tv-key]')?.getAttribute('data-tv-key') || '';
};

const findTvItemByKey = (key: string) => (
    focusableTvItems().find((el) => tvKeyOf(el) === key) || null
);

/** Restore the last focused poster on this page. Retries until the kept-alive home rail has layout. */
export const restoreTvFocus = (): boolean => {
    const snapshot = tvFocusByPath.get(currentPath());
    const key = snapshot?.key;
    if (!key) return false;
    const match = findTvItemByKey(key);
    if (!match) return false;
    const rail = match.closest<HTMLElement>('[data-tv-poster-rail="1"]');
    if (rail && snapshot.railScroll != null) {
        rail.scrollLeft = snapshot.railScroll;
    }
    focusItem(match, 'center');
    requestAnimationFrame(syncPosterFocusAttr);
    return true;
};

export const restoreTvFocusWhenReady = () => {
    if (isPlayerItemPath()) {
        if (hasRememberedTvFocus()) {
            if (restoreTvFocus()) return;
            let attempts = 40;
            const tick = () => {
                if (restoreTvFocus()) return;
                if (attempts-- > 0) {
                    window.setTimeout(tick, 40);
                    return;
                }
                if (!focusTvPlayButton()) focusSeasonEpisodeWhenReady();
            };
            window.setTimeout(tick, 40);
            return;
        }
        focusSeasonEpisodeWhenReady();
        return;
    }
    if (isPlayerSettingsPath()) {
        focusTvSettingsWhenReady();
        return;
    }
    if (isPlayerHomePath() && hasRememberedTvFocus()) {
        if (restoreTvFocus()) return;
        let attempts = 30;
        const tick = () => {
            if (restoreTvFocus()) return;
            if (attempts-- > 0) {
                window.setTimeout(tick, 40);
                return;
            }
            focusTvHeroWhenReady();
        };
        window.setTimeout(tick, 40);
        return;
    }
    if (isPlayerHomePath() && !tvFocusByPath.get(currentPath())?.key) {
        focusTvHeroWhenReady();
        return;
    }
    if (!tvFocusByPath.get(currentPath())?.key) return;
    if (restoreTvFocus()) return;
    let attempts = 12;
    const tick = () => {
        if (restoreTvFocus()) return;
        if (attempts-- > 0) {
            window.setTimeout(tick, 40);
            return;
        }
        focusTvContent();
    };
    window.setTimeout(tick, 40);
};

const isConfirmKey = (event: KeyboardEvent) => (
    event.key === 'Enter'
    || event.key === ' '
    || event.key === 'NumpadEnter'
    || event.key === 'Select'
    || event.keyCode === 23
);

const dirOfKey = (key: string): SpatialDir | null => {
    if (key === 'ArrowLeft') return 'left';
    if (key === 'ArrowRight') return 'right';
    if (key === 'ArrowUp') return 'up';
    if (key === 'ArrowDown') return 'down';
    return null;
};

const spanOverlap = (a1: number, a2: number, b1: number, b2: number) => (
    Math.max(0, Math.min(a2, b2) - Math.max(a1, b1))
);

/** When moving up/down into another poster row, restore that row's last poster. */
const snapVerticalRowEntry = (from: HTMLElement, el: HTMLElement | null): HTMLElement | null => {
    if (!el) return el;
    const fromRow = from.closest<HTMLElement>('[data-tv-row="1"]');
    const toRow = el.closest<HTMLElement>('[data-tv-row="1"]');
    if (!toRow || toRow === fromRow) return el;

    if (el.getAttribute('data-tv-cast') === '1' || toRow.querySelector('[data-tv-cast="1"]')) {
        const rail = toRow.querySelector<HTMLElement>('[data-tv-poster-rail="1"], [data-tv-rail="1"], .overflow-x-auto');
        if (rail) rail.scrollLeft = 0;
        const items = focusableTvItems(toRow).filter(hasLayout);
        return items[0] || el;
    }

    const fromPosterRail = from.closest('[data-tv-poster-rail="1"]');
    const toPosterRail = toRow.querySelector('[data-tv-poster-rail="1"]');
    if (fromPosterRail && toPosterRail) {
        const rowId = rowFocusIdOf(toRow);
        const saved = rowId ? tvRowFocusById.get(rowId) : null;
        if (saved?.key) {
            const match = focusableTvItems(toRow).find((node) => tvKeyOf(node) === saved.key && hasLayout(node));
            if (match) {
                const rail = toRow.querySelector<HTMLElement>('[data-tv-poster-rail="1"]');
                if (rail && saved.railScroll != null) rail.scrollLeft = saved.railScroll;
                return match;
            }
        }
        // Keep geometric target (same column) — do not force first poster.
        return el;
    }
    return el;
};

/**
 * Geometric spatial navigation (LRUD): pick the nearest focusable in the pressed
 * direction. Vertical moves never skip a closer row (e.g. Top Cast) just because
 * a later rail lines up with the focused control.
 */
const spatialRootFor = (from: HTMLElement, root?: ParentNode): ParentNode => {
    if (root) return root;
    const row = from.closest('[data-tv-row="1"]');
    const scroller = document.getElementById(PLAYER_SCROLL_ID);
    // Prefer the focused row for horizontal moves; scroll port for vertical so we
    // still see the next rail without scanning the whole document (hidden home).
    return row || scroller || document;
};

const findSpatialTarget = (from: HTMLElement, dir: SpatialDir, root?: ParentNode): HTMLElement | null => {
    const fromRect = from.getBoundingClientRect();
    if (fromRect.width <= 0 && fromRect.height <= 0) return null;
    const fcx = fromRect.left + fromRect.width / 2;
    const searchRoot = dir === 'left' || dir === 'right'
        ? spatialRootFor(from, root)
        : (root || document.getElementById(PLAYER_SCROLL_ID) || document);

    if (dir === 'left' || dir === 'right') {
        let best: HTMLElement | null = null;
        let bestScore = Infinity;
        for (const el of focusableTvItems(searchRoot)) {
            if (el === from || el.contains(from) || from.contains(el)) continue;
            const r = el.getBoundingClientRect();
            if (r.width <= 0 || r.height <= 0) continue;
            const cx = r.left + r.width / 2;
            const primary = dir === 'left' ? fcx - cx : cx - fcx;
            if (primary <= 2) continue;
            if (spanOverlap(fromRect.top, fromRect.bottom, r.top, r.bottom) <= 0) continue;
            if (primary < bestScore) {
                bestScore = primary;
                best = el;
            }
        }
        return best;
    }

    type VertCand = { el: HTMLElement; r: DOMRect; primary: number };
    const cands: VertCand[] = [];
    for (const el of focusableTvItems(searchRoot)) {
        if (el === from || el.contains(from) || from.contains(el)) continue;
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) continue;
        const overlapY = spanOverlap(fromRect.top, fromRect.bottom, r.top, r.bottom);
        if (overlapY > Math.min(fromRect.height, r.height) * 0.35) continue;
        if (dir === 'down' && r.top < fromRect.top + 8) continue;
        if (dir === 'up' && r.bottom > fromRect.bottom - 8) continue;
        const primary = dir === 'down' ? r.top - fromRect.bottom : fromRect.top - r.bottom;
        if (primary < -12) continue;
        cands.push({ el, r, primary });
    }
    if (!cands.length) return null;

    const nearest = Math.min(...cands.map((c) => Math.max(0, c.primary)));
    const nearestH = cands.find((c) => Math.max(0, c.primary) === nearest)?.r.height || 80;
    const band = cands.filter((c) => Math.max(0, c.primary) <= nearest + Math.max(64, nearestH * 0.7));

    const columnHit = band.some((c) => spanOverlap(fromRect.left, fromRect.right, c.r.left, c.r.right) > 0);
    if (!columnHit) {
        band.sort((a, b) => a.r.left - b.r.left);
        return snapVerticalRowEntry(from, band[0].el);
    }

    let best: HTMLElement | null = null;
    let bestScore = Infinity;
    for (const c of band) {
        const overlap = spanOverlap(fromRect.left, fromRect.right, c.r.left, c.r.right);
        const orth = overlap > 0
            ? 0
            : Math.min(Math.abs(c.r.left - fromRect.right), Math.abs(fromRect.left - c.r.right));
        const score = Math.max(0, c.primary) + orth * 2;
        if (score < bestScore) {
            bestScore = score;
            best = c.el;
        }
    }
    return snapVerticalRowEntry(from, best);
};

/**
 * Up/down only measures the next few rows. Scanning every poster on the page
 * forces layout on each D-pad press, which stalls Fire Stick WebView.
 */
const nearestVerticalRow = (from: HTMLElement, dir: 'up' | 'down'): HTMLElement | null => {
    const scroller = document.getElementById(PLAYER_SCROLL_ID);
    if (!scroller || !scroller.contains(from)) return null;
    const fromRect = from.getBoundingClientRect();
    const rows = scroller.querySelectorAll<HTMLElement>('[data-tv-row="1"]');
    const ranked: { row: HTMLElement; primary: number }[] = [];
    for (const row of rows) {
        if (row.contains(from)) continue;
        const rect = row.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
        const primary = dir === 'down' ? rect.top - fromRect.bottom : fromRect.top - rect.bottom;
        if (primary < -12) continue;
        ranked.push({ row, primary: Math.max(0, primary) });
    }
    if (!ranked.length) return null;
    ranked.sort((a, b) => a.primary - b.primary);
    const limit = Math.min(ranked.length, 3);
    for (let i = 0; i < limit; i += 1) {
        const hit = findSpatialTarget(from, dir, ranked[i].row);
        if (hit) return hit;
    }
    return null;
};

let lastBrowsePoster: HTMLElement | null = null;
let browseColCache = { count: 0, cols: 0 };

const browseAbsIndex = (el: HTMLElement) => {
    const raw = el.closest('[data-browse-index]')?.getAttribute('data-browse-index');
    const index = raw != null ? Number(raw) : NaN;
    return Number.isFinite(index) ? index : null;
};

/** Column count from the first painted row. Cached until the poster count changes. */
const browseColumnCount = (grid: HTMLElement) => {
    const cards = grid.querySelectorAll<HTMLElement>('[data-browse-index]');
    if (cards.length > 0 && cards.length === browseColCache.count && browseColCache.cols > 0) {
        return browseColCache.cols;
    }
    let cols = 1;
    if (cards.length > 1) {
        const top = cards[0].offsetTop;
        for (let i = 1; i < cards.length; i += 1) {
            if (Math.abs(cards[i].offsetTop - top) > 2) break;
            cols += 1;
        }
    }
    browseColCache = { count: cards.length, cols };
    return cols;
};

const browsePosterAt = (grid: HTMLElement, abs: number) => {
    const card = grid.querySelector<HTMLElement>(`[data-browse-index="${abs}"]`);
    const button = card?.querySelector<HTMLElement>(TV_POSTER_BTN) || null;
    return button && hasLayout(button) ? button : null;
};

/** Browse up/down stays inside the poster window. The letter bar is its own column. */
const browseGridStep = (current: HTMLElement, dir: SpatialDir): HTMLElement | null | undefined => {
    const alpha = current.closest<HTMLElement>('[data-tv-alpha="1"]');
    const grid = current.closest<HTMLElement>('[data-tv-browse-grid="1"]')
        || document.querySelector<HTMLElement>('[data-tv-browse-grid="1"]');
    if (current.closest('[data-tv-browse-grid="1"]')) lastBrowsePoster = current;
    if (!alpha && !current.closest('[data-tv-browse-grid="1"]')) return undefined;

    const filterButton = () => {
        const filters = document.querySelector<HTMLElement>('[data-tv-library-filters="1"]');
        return filters ? focusableTvItems(filters)[0] || null : null;
    };
    const nearestLetter = (from: HTMLElement) => {
        const bar = document.querySelector<HTMLElement>('[data-tv-alpha="1"]');
        const letters = bar ? focusableTvItems(bar) : [];
        if (!letters.length) return null;
        const mid = from.getBoundingClientRect().top + from.getBoundingClientRect().height / 2;
        let best = letters[0];
        let bestDist = Infinity;
        for (const el of letters) {
            const rect = el.getBoundingClientRect();
            const dist = Math.abs(rect.top + rect.height / 2 - mid);
            if (dist < bestDist) {
                bestDist = dist;
                best = el;
            }
        }
        return best;
    };

    if (alpha) {
        const items = focusableTvItems(alpha);
        const idx = items.findIndex((el) => el === current || el.contains(current));
        if (dir === 'up') return (idx > 0 ? items[idx - 1] : null) || filterButton();
        if (dir === 'down') return idx >= 0 && idx < items.length - 1 ? items[idx + 1] : current;
        if (dir === 'right') return current;
        if (lastBrowsePoster && lastBrowsePoster.isConnected && hasLayout(lastBrowsePoster)) return lastBrowsePoster;
        const posters = grid ? Array.from(grid.querySelectorAll<HTMLElement>(TV_POSTER_BTN)).filter(hasLayout) : [];
        return posters[0] || null;
    }

    if (!grid) return undefined;
    const absIndex = browseAbsIndex(current);
    const cols = browseColumnCount(grid);
    if (absIndex != null && cols > 0) {
        const col = absIndex % cols;
        if (dir === 'left') {
            if (col === 0) return null;
            return browsePosterAt(grid, absIndex - 1);
        }
        if (dir === 'right') {
            if (col >= cols - 1) return nearestLetter(current);
            return browsePosterAt(grid, absIndex + 1) || nearestLetter(current);
        }
        if (dir === 'up') {
            if (absIndex < cols) return filterButton() || undefined;
            return browsePosterAt(grid, absIndex - cols) || current;
        }
        const below = browsePosterAt(grid, absIndex + cols);
        if (below) return below;
        // Next row is not mounted yet. Fetch it and stay put until it exists.
        requestBrowseFocusAbs(absIndex + cols);
        return current;
    }
    if (dir === 'up' || dir === 'down') {
        const next = findSpatialTarget(current, dir, grid);
        if (next) return next;
        if (dir === 'up') return filterButton() || undefined;
        return current;
    }
    const next = findSpatialTarget(current, dir, grid);
    if (next) return next;
    if (dir === 'right') return nearestLetter(current);
    return null;
};

const isNavOpen = () => document.documentElement?.dataset?.tvNavOpen === '1';

const openSideNav = (from?: HTMLElement | null) => {
    const key = tvKeyOf(from || null);
    if (key) rememberTvFocusKey(key);
    setNavOpen(true);
    window.setTimeout(focusNavItem, 50);
};

const setNavOpen = (open: boolean) => {
    try {
        if (open) document.documentElement.dataset.tvNavOpen = '1';
        else delete document.documentElement.dataset.tvNavOpen;
    } catch {
        /* ignore */
    }
    window.dispatchEvent(new CustomEvent(PLAYER_TV_NAV_EVENT, { detail: { action: open ? 'open' : 'close' } }));
};

const focusNavItem = (attempt = 0) => {
    const root = document.querySelector(TV_NAV_ROOT);
    const items = root
        ? Array.from(root.querySelectorAll<HTMLElement>(TV_NAV_ITEM))
        : [];
    const target = items.find((el) => el.getAttribute('data-tv-nav-active') === '1') || items[0];
    if (!target) {
        if (attempt < 12) window.setTimeout(() => focusNavItem(attempt + 1), 40);
        return;
    }
    target.tabIndex = 0;
    try {
        target.focus({ preventScroll: true });
    } catch {
        target.focus();
    }
    if (document.activeElement !== target && attempt < 12) {
        window.setTimeout(() => focusNavItem(attempt + 1), 40);
    }
};

const TV_HOLD_BTN = '[data-tv-poster-btn="1"], [data-tv-season-poster-btn="1"], [data-tv-episode-btn="1"], [data-tv-extra-btn="1"], [data-tv-home-hero="1"]';

const posterButtonOf = (node: EventTarget | null) => {
    const el = node as HTMLElement | null;
    if (!el?.closest) return null;
    const poster = el.closest<HTMLElement>(TV_HOLD_BTN);
    return poster && hasLayout(poster) ? poster : null;
};

const openPosterMenu = (poster: HTMLElement) => {
    const ratingKey = poster.getAttribute('data-tv-key') || '';
    if (!ratingKey || ratingKey.startsWith('view-more:')) return false;
    const detail = { ratingKey, poster, handled: false };
    window.dispatchEvent(new CustomEvent('smp-tv-poster-menu', { detail }));
    return detail.handled;
};

const POSTER_LONG_PRESS_MS = 450;

/** Land on the remembered poster, or the first one in this library. */
export const focusFirstPoster = (root: ParentNode = document) => {
    if (hasRememberedTvFocus() && restoreTvFocus()) return true;
    const poster = Array.from(root.querySelectorAll<HTMLElement>(TV_POSTER_BTN)).find(hasLayout);
    if (!poster) return false;
    focusItem(poster, 'center');
    requestAnimationFrame(syncPosterFocusAttr);
    return true;
};

/** Leave the side nav without jumping the page — same row you were on. */
const leaveNavToContent = () => {
    setNavOpen(false);
    window.setTimeout(() => {
        if (restoreTvFocus()) return;
        focusTvContent();
    }, 40);
};

/** Focus last remembered poster, else the first content control. */
export const focusTvContent = () => {
    if (isAuthScreen()) {
        const active = document.activeElement as HTMLElement | null;
        if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA') && active.closest(TV_AUTH)) {
            return;
        }
        const items = focusableTvItems();
        const action = items.find((el) => el.getAttribute('data-tv-action') === '1');
        const target = action || items[0];
        if (target) {
            focusItem(target, 'nearest');
            return;
        }
    }
    if (restoreTvFocus()) return;
    if (isPlayerItemPath() && focusFirstSeasonEpisode()) return;
    if (isPlayerItemPath() && focusTvPlayButton()) return;
    if (isPlayerSettingsPath() && focusTvSettings()) return;
    if (isPlayerHomePath() && focusTvHero()) return;
    const library = document.querySelector<HTMLElement>('[data-tv-library="1"]');
    if (library && hasLayout(library)) {
        const poster = Array.from(library.querySelectorAll<HTMLElement>(TV_POSTER_BTN)).find(hasLayout);
        if (poster) {
            focusItem(poster, 'center');
            requestAnimationFrame(syncPosterFocusAttr);
            return;
        }
    }
    const rails = visibleContentRails();
    if (rails.length) {
        const items = focusableTvItems(rails[0]);
        if (items[0]) {
            focusItem(items[0], 'center');
            requestAnimationFrame(syncPosterFocusAttr);
            return;
        }
    }
    const poster = Array.from(document.querySelectorAll<HTMLElement>(TV_POSTER_BTN)).find(hasLayout);
    if (poster) {
        focusItem(poster, 'center');
        requestAnimationFrame(syncPosterFocusAttr);
        return;
    }
    const search = document.getElementById('media-player-search') as HTMLElement | null;
    if (search && hasLayout(search)) {
        search.focus();
        return;
    }
    const fallback = focusableTvItems()[0];
    if (fallback) focusItem(fallback, 'nearest');
};

const isPlayerHomePath = () => {
    const raw = String(window.location.pathname || '').replace(/\/+$/, '') || '/';
    return raw === PLAYER_APP_BASE || raw === '/' || raw === '';
};

const isPlayerItemPath = () => /\/item\/[^/]+/.test(currentPath());

const isPlayerSettingsPath = () => /\/settings$/.test(currentPath());

/** Vertical lists (album tracks) must walk every item before the next hub row. */
const listStep = (current: HTMLElement, dir: SpatialDir): HTMLElement | null => {
    if (dir !== 'up' && dir !== 'down') return null;
    const list = current.closest<HTMLElement>('[data-tv-list="1"]');
    if (!list) return null;
    const items = focusableTvItems(list);
    const idx = items.findIndex((el) => el === current || el.contains(current));
    if (idx < 0) return null;
    return (dir === 'down' ? items[idx + 1] : items[idx - 1]) || null;
};

/** Settings tabs sit in a row. Down enters that section; Down from the last option lands on Save. */
const settingsStep = (current: HTMLElement, dir: SpatialDir): HTMLElement | null => {
    if (dir !== 'up' && dir !== 'down') return null;
    const root = current.closest<HTMLElement>('[data-tv-settings="1"]');
    if (!root) return null;
    const onTab = Boolean(current.closest('[data-tv-settings-tabs="1"]'));
    const panel = root.querySelector<HTMLElement>('[data-tv-settings-panel="1"]');
    const panelItems = panel ? focusableTvItems(panel) : [];
    if (onTab) {
        if (dir !== 'down') return null;
        return panelItems[0] || root.querySelector<HTMLElement>('[data-tv-settings-save="1"]');
    }
    if (dir === 'up' && panelItems[0] && (current === panelItems[0] || panelItems[0].contains(current))) {
        const tabs = root.querySelector<HTMLElement>('[data-tv-settings-tabs="1"]');
        return tabs?.querySelector<HTMLElement>('[aria-current="page"]')
            || tabs?.querySelector<HTMLElement>('[data-tv-item="1"]')
            || null;
    }
    const items = focusableTvItems(root);
    const idx = items.findIndex((el) => el === current || el.contains(current));
    if (idx < 0) return null;
    const onActions = Boolean(current.closest('[data-tv-settings-actions="1"]'));
    if (dir === 'down') {
        if (onActions) return null;
        const next = items[idx + 1];
        if (!next) return null;
        if (next.closest('[data-tv-settings-actions="1"]')) {
            return root.querySelector<HTMLElement>('[data-tv-settings-save="1"]') || next;
        }
        return next;
    }
    if (onActions) {
        const firstAction = items.findIndex((el) => el.closest('[data-tv-settings-actions="1"]'));
        return firstAction > 0 ? items[firstAction - 1] : null;
    }
    return items[idx - 1] || null;
};

const focusTvSettings = (): boolean => {
    const root = document.querySelector<HTMLElement>('[data-tv-settings="1"]');
    const first = root?.querySelector<HTMLElement>('[data-tv-item="1"]');
    if (!root || !first || !hasLayout(first)) return false;
    const top = root.querySelector<HTMLElement>('[data-tv-page-top="1"]') || root;
    scrollEl(top, 'start');
    try {
        first.focus({ preventScroll: true });
    } catch {
        first.focus();
    }
    return true;
};

const focusTvSettingsWhenReady = () => {
    if (focusTvSettings()) return;
    let attempts = 24;
    const tick = () => {
        if (!isPlayerSettingsPath() || focusTvSettings() || attempts-- <= 0) return;
        window.setTimeout(tick, 40);
    };
    window.setTimeout(tick, 40);
};

/**
 * Season and episode hubs open on the episode row. Prefer the current
 * spotlight card; otherwise the first episode. Do not center the row.
 */
const focusFirstSeasonEpisode = (): boolean => {
    const details = document.querySelector<HTMLElement>('[data-tv-details="1"]');
    const kind = details?.getAttribute('data-tv-kind') || '';
    if (!details || (kind !== 'season' && kind !== 'episode')) return false;
    const current = details.querySelector<HTMLElement>('.media-details-episode-card.is-current [data-tv-episode-btn="1"]');
    const episode = (current && hasLayout(current))
        ? current
        : Array.from(details.querySelectorAll<HTMLElement>('[data-tv-episode-btn="1"]')).find(hasLayout);
    if (!episode) return false;
    const rail = episode.closest<HTMLElement>('[data-tv-poster-rail="1"]');
    if (rail && !(current && hasLayout(current))) rail.scrollLeft = 0;
    try {
        episode.focus({ preventScroll: true });
    } catch {
        episode.focus();
    }
    syncPosterFocusAttr();
    window.requestAnimationFrame(syncPosterFocusAttr);
    const row = episode.closest<HTMLElement>('[data-tv-row="1"]');
    const port = document.getElementById(PLAYER_SCROLL_ID)?.getBoundingClientRect();
    const box = episode.getBoundingClientRect();
    const low = Boolean(port && box.top > port.top + port.height * 0.55);
    const offscreen = Boolean(port && (box.bottom > port.bottom - 8 || box.top < port.top + 8 || low));
    if (row && offscreen) scrollRowWithoutPanningRails(row, 'end');
    return true;
};

const itemPathKey = () => {
    const match = currentPath().match(/\/item\/([^/]+)/);
    if (!match) return '';
    try { return decodeURIComponent(match[1]); } catch { return match[1]; }
};

export const focusSeasonEpisodeWhenReady = () => {
    let attempts = 100;
    const tick = () => {
        const details = document.querySelector<HTMLElement>('[data-tv-details="1"]');
        const kind = details?.getAttribute('data-tv-kind') || '';
        const shown = details?.getAttribute('data-tv-rating') || '';
        const wanted = itemPathKey();
        const pageReady = Boolean(details && wanted && shown === wanted);
        if (!pageReady) {
            if (attempts-- > 0) window.setTimeout(tick, 40);
            return;
        }
        if (kind === 'season' || kind === 'episode') {
            if (focusFirstSeasonEpisode()) return;
            if (attempts-- > 0) window.setTimeout(tick, 50);
            return;
        }
        focusTvPlayWhenReady();
    };
    tick();
};

/** Title pages open on Play. */
export const focusTvPlayButton = (): boolean => {
    const play = focusableTvItems().find((el) => el.getAttribute('data-tv-play') === '1');
    if (!play) return false;
    try {
        play.focus({ preventScroll: true });
    } catch {
        play.focus();
    }
    if (play.closest('[data-tv-details="1"]')) {
        pinTvDetailsTop();
        window.requestAnimationFrame(pinTvDetailsTop);
        return true;
    }
    focusItem(play, 'nearest');
    return true;
};

const focusTvPlayWhenReady = () => {
    if (focusTvPlayButton()) return;
    let attempts = 60;
    const tick = () => {
        if (focusTvPlayButton() || attempts-- <= 0) return;
        window.setTimeout(tick, 40);
    };
    window.setTimeout(tick, 40);
};

/** Home lands on the whole hero — Left/Right cycle, Select opens. */
const focusTvHero = (): boolean => {
    if (!isPlayerHomePath()) return false;
    const hero = document.querySelector<HTMLElement>('[data-tv-home-hero="1"]')
        || document.querySelector<HTMLElement>('.player-home-hero [data-tv-item="1"]');
    if (hero && hasLayout(hero)) {
        focusItem(hero, 'start');
        return true;
    }
    const poster = Array.from(document.querySelectorAll<HTMLElement>(TV_POSTER_BTN)).find(hasLayout);
    if (!poster) return false;
    focusItem(poster, 'nearest');
    requestAnimationFrame(syncPosterFocusAttr);
    return true;
};

const focusTvHeroWhenReady = () => {
    if (focusTvHero()) return;
    let attempts = 30;
    const tick = () => {
        if (!isPlayerHomePath() || focusTvHero() || attempts-- <= 0) return;
        window.setTimeout(tick, 40);
    };
    window.setTimeout(tick, 40);
};

/**
 * Handle hardware / remote Back. Returns true when consumed (do not finish Activity).
 * Capacitor WebView pushState does not populate canGoBack(), so native Back must
 * be routed here via MainActivity → window.__SMP_HANDLE_BACK__.
 */
const refocusAfterOverlay = () => {
    window.setTimeout(() => {
        if (document.querySelector('[data-tv-select-menu="1"], [data-tv-item-menu="1"], [data-tv-home-switch="1"], [data-tv-version-dialog="1"], [data-tv-track-dialog="1"], [data-tv-settings-dialog="1"], [data-tv-file-info="1"], [data-tv-resume-dialog="1"], [data-tv-season-watch-dialog="1"]')) return;
        const active = document.activeElement as HTMLElement | null;
        if (active && active !== document.body && active !== document.documentElement) return;
        restoreTvFocus();
    }, 50);
};

const handleTvBack = (): boolean => {
    if (isEditableTarget(document.activeElement)) {
        const field = document.activeElement as HTMLElement;
        if (field.closest('[data-tv-home-switch="1"]')) {
            field.blur();
            window.dispatchEvent(new Event('smp-tv-overlay-close'));
            return true;
        }
        field.blur();
        return true;
    }
    if (document.documentElement?.dataset?.tvSelectOpen === '1'
        || document.documentElement?.dataset?.tvMenuOpen === '1'
        || document.querySelector('[data-tv-select-menu="1"], [data-tv-item-menu="1"], [data-tv-home-switch="1"], [data-tv-version-dialog="1"], [data-tv-track-dialog="1"], [data-tv-settings-dialog="1"]')
    ) {
        window.dispatchEvent(new Event('smp-tv-select-close'));
        window.dispatchEvent(new Event('smp-tv-menu-close'));
        window.dispatchEvent(new Event('smp-tv-overlay-close'));
        refocusAfterOverlay();
        return true;
    }
    const seasonWatchCancel = document.querySelector<HTMLElement>('[data-tv-season-watch-dialog="1"] [data-tv-season-watch-cancel="1"]');
    if (seasonWatchCancel) {
        seasonWatchCancel.click();
        refocusAfterOverlay();
        return true;
    }
    const resumeClose = document.querySelector<HTMLElement>('[data-tv-resume-dialog="1"] [data-tv-item="1"]:last-child');
    if (document.querySelector('[data-tv-resume-dialog="1"]')) {
        // Prefer Close button if present; otherwise click primary cancel path.
        const closeBtn = Array.from(
            document.querySelectorAll<HTMLElement>('[data-tv-resume-dialog="1"] [data-tv-item="1"]')
        ).find((el) => /close|cancel/i.test(el.textContent || '')) || resumeClose;
        closeBtn?.click();
        refocusAfterOverlay();
        return true;
    }
    const authBack = document.querySelector<HTMLElement>(`${TV_AUTH} [data-tv-auth-back="1"]`);
    if (authBack) {
        authBack.click();
        return true;
    }
    if (isNavOpen()) {
        leaveNavToContent();
        return true;
    }
    if (window.__SMP_CLOSE_PLAYBACK__?.()) {
        return true;
    }
    if (!isPlayerHomePath()) {
        const before = window.location.pathname;
        window.history.back();
        window.setTimeout(() => {
            if (window.location.pathname === before) {
                window.history.replaceState({}, '', PLAYER_APP_BASE);
                window.dispatchEvent(new Event(PLAYER_NAVIGATE_EVENT));
            }
            restoreTvFocusWhenReady();
        }, 80);
        return true;
    }
    openSideNav(document.activeElement as HTMLElement | null);
    return true;
};

const clickIfPresent = (selector: string) => {
    const node = document.querySelector<HTMLElement>(selector);
    if (!node) return false;
    node.click();
    return true;
};

/** Phone gesture / system Back. True = stay in the app. False = Android may finish. */
export const handlePhoneBack = (): boolean => {
    if (document.querySelector('.player-mobile-nav-sheet')) {
        clickIfPresent('.player-mobile-nav-sheet > button')
            || clickIfPresent('.player-phone-nav-panel button[aria-label]');
        return true;
    }
    const context = document.querySelector<HTMLElement>('[data-player-mobile-context="1"]');
    if (context) {
        context.click();
        return true;
    }
    if (clickIfPresent('[data-tv-resume-dialog="1"] [data-tv-item="1"]:last-child')) return true;
    if (clickIfPresent('[data-tv-season-watch-dialog="1"] [data-tv-season-watch-cancel="1"]')) return true;
    if (clickIfPresent('[data-tv-version-dialog="1"] [data-tv-action="1"]:last-child')) return true;
    if (clickIfPresent('[data-tv-track-dialog="1"] button:last-of-type')) return true;
    if (clickIfPresent('[data-tv-home-switch="1"] button[aria-label], [data-tv-home-switch="1"] [data-tv-item="1"]:last-child')) return true;
    if (clickIfPresent('[data-tv-file-info="1"] button')) return true;
    if (window.__SMP_CLOSE_PLAYBACK__?.()) return true;
    if (document.getElementById(PLAYER_SEARCH_INPUT_ID)) {
        requestPlayerHomeReset();
        return true;
    }
    if (!isPlayerHomePath()) {
        const before = `${window.location.pathname}${window.location.search}`;
        window.history.back();
        window.setTimeout(() => {
            const now = `${window.location.pathname}${window.location.search}`;
            if (now === before) {
                window.history.replaceState({}, '', PLAYER_APP_BASE);
                window.dispatchEvent(new Event(PLAYER_NAVIGATE_EVENT));
            }
        }, 80);
        return true;
    }
    return false;
};

export const handleAppBack = (): boolean => {
    try {
        if (isAndroidTvUi()) return handleTvBack();
        return handlePhoneBack();
    } catch {
        return false;
    }
};

if (typeof window !== 'undefined') {
    window.__SMP_HANDLE_BACK__ = handleAppBack;
}

declare global {
    interface Window {
        __SMP_HANDLE_BACK__?: () => boolean;
        __SMP_CLOSE_PLAYBACK__?: () => boolean;
    }
}

/**
 * Leanback remote layer — same web UI, D-pad moves focus geometrically (nearest
 * focusable in the pressed direction), Back walks history. Left at the left edge
 * opens the side nav.
 */
export const useTvRemote = (enabled = true) => {
    useEffect(() => {
        if (!enabled || !isAndroidTvUi()) return undefined;

        window.__SMP_HANDLE_BACK__ = handleAppBack;

        let posterSelectTimer: number | null = null;
        let posterReleaseTimer: number | null = null;
        let posterSelectTarget: HTMLElement | null = null;
        let posterSelectMenuOpened = false;
        let confirmHeld = false;
        let suppressMenuConfirm = false;
        let browseHoldTimer: number | null = null;
        let browseHoldDir: SpatialDir | null = null;

        const stopBrowseHold = () => {
            if (browseHoldTimer != null) {
                window.clearTimeout(browseHoldTimer);
                window.clearInterval(browseHoldTimer);
                browseHoldTimer = null;
            }
            browseHoldDir = null;
        };

        // Held Up/Down on browse is driven here. TV WebView key-repeat is slow
        // and often stops once focus() moves to the next poster.
        const armBrowseHold = (dir: SpatialDir) => {
            if (dir !== 'up' && dir !== 'down') return;
            if (browseHoldDir === dir) return;
            if (browseHoldDir) stopBrowseHold();
            browseHoldDir = dir;
            browseHoldTimer = window.setTimeout(() => {
                browseHoldTimer = window.setInterval(() => {
                    if (browseHoldDir !== dir) return;
                    const active = document.activeElement as HTMLElement | null;
                    const focused = active && active !== document.body && active !== document.documentElement
                        ? (active.closest<HTMLElement>(TV_ITEM) || active)
                        : null;
                    if (!focused?.closest('[data-tv-browse-grid="1"]')) {
                        stopBrowseHold();
                        return;
                    }
                    const stepped = browseGridStep(focused, dir);
                    if (stepped && stepped !== focused) focusItem(stepped, 'nearest', dir);
                }, 52);
            }, 140);
        };

        const clearPosterSelectHold = () => {
            if (posterSelectTimer) {
                window.clearTimeout(posterSelectTimer);
                posterSelectTimer = null;
            }
            if (posterReleaseTimer) {
                window.clearTimeout(posterReleaseTimer);
                posterReleaseTimer = null;
            }
            posterSelectTarget = null;
            posterSelectMenuOpened = false;
        };

        const armPosterHold = (poster: HTMLElement) => {
            posterSelectTarget = poster;
            posterSelectMenuOpened = false;
            if (posterSelectTimer) window.clearTimeout(posterSelectTimer);
            posterSelectTimer = window.setTimeout(() => {
                posterSelectTimer = null;
                if (posterSelectTarget !== poster) return;
                if (poster.getAttribute('data-tv-home-hero') === '1') {
                    poster.dispatchEvent(new CustomEvent('smp-tv-hero-play', { bubbles: true }));
                    posterSelectMenuOpened = true;
                    return;
                }
                openPosterMenu(poster);
                // Long-press completed: never treat the release as a short Select open.
                posterSelectMenuOpened = true;
                suppressMenuConfirm = true;
            }, POSTER_LONG_PRESS_MS);
        };

        const isBackKey = (event: KeyboardEvent) => (
            event.key === 'Escape'
            || event.key === 'BrowserBack'
            || event.key === 'GoBack'
            || event.keyCode === 4
        );

        const onKeyDown = (event: KeyboardEvent) => {
            const editable = isEditableTarget(event.target);
            const auth = isAuthScreen();

            if (editable && isBackKey(event)) {
                const el = event.target as HTMLElement;
                event.preventDefault();
                el.blur();
                if (auth) window.setTimeout(focusTvContent, 0);
                return;
            }

            if (isBackKey(event)) {
                event.preventDefault();
                handleTvBack();
                return;
            }

            if (isConfirmKey(event)) {
                confirmHeld = true;
                // The key that opened the menu is still down. Do not run the row it focused.
                if (suppressMenuConfirm) {
                    event.preventDefault();
                    event.stopPropagation();
                    if (posterReleaseTimer) {
                        window.clearTimeout(posterReleaseTimer);
                        posterReleaseTimer = null;
                    }
                    return;
                }
                if (editable) {
                    const form = (event.target as HTMLElement).closest('form');
                    if (form && (auth || (event.target as HTMLElement).closest(TV_OVERLAY))) {
                        event.preventDefault();
                        event.stopPropagation();
                        if (typeof form.requestSubmit === 'function') form.requestSubmit();
                        else form.submit();
                        return;
                    }
                    return;
                }
                if (document.documentElement?.dataset?.tvSelectOpen === '1') return;
                const menuKey = event.key === 'ContextMenu' || event.keyCode === 82;
                if (menuKey && !document.querySelector(TV_OVERLAY)) {
                    const poster = posterButtonOf(event.target) || posterButtonOf(document.activeElement);
                    if (poster) {
                        event.preventDefault();
                        event.stopPropagation();
                        openPosterMenu(poster);
                        return;
                    }
                }
                const posterForHold = posterButtonOf(event.target) || posterButtonOf(document.activeElement);
                if (
                    posterForHold
                    && !document.querySelector(TV_OVERLAY)
                    && document.documentElement?.dataset?.tvSelectOpen !== '1'
                ) {
                    event.preventDefault();
                    event.stopPropagation();
                    if (posterReleaseTimer) {
                        window.clearTimeout(posterReleaseTimer);
                        posterReleaseTimer = null;
                    }
                    // Repeats, and keyup/keydown pairs from a held Select, must not
                    // restart the timer or open the title.
                    if (!posterSelectTarget) armPosterHold(posterForHold);
                    return;
                }
                if (activateFocusedTvItem(event)) return;
            }

            if (editable) {
                const leaveDir = dirOfKey(event.key);
                if (!leaveDir || !(auth || (event.target as HTMLElement).closest(TV_OVERLAY))) return;
                const field = event.target as HTMLInputElement;
                if ((leaveDir === 'left' || leaveDir === 'right') && !inputCaretAtEdge(field, leaveDir)) return;
                // Fall through so D-pad can leave the URL / PIN field.
            }

            const overlayMenu = tvOverlayRoot();
            if (overlayMenu && isConfirmKey(event) && document.documentElement?.dataset?.tvSelectOpen !== '1') {
                activateFocusedTvItem(event);
                return;
            }

            const active = document.activeElement as HTMLElement | null;
            const inNav = Boolean(active?.closest?.(TV_NAV_ROOT));
            if (document.documentElement?.dataset?.tvSelectOpen === '1') {
                // Open CustomSelect owns D-pad / Back until closed.
                return;
            }

            const dir = dirOfKey(event.key);
            if (!dir) return;
            if (browseHoldDir && dir !== browseHoldDir) stopBrowseHold();

            const overlayOpen = Boolean(tvOverlayRoot());
            if (inNav && !overlayOpen) {
                if (dir === 'left') {
                    event.preventDefault();
                    return;
                }
                if (dir === 'right') {
                    event.preventDefault();
                    event.stopPropagation();
                    leaveNavToContent();
                    return;
                }
                const root = document.querySelector(TV_NAV_ROOT);
                if (!root) return;
                const items = Array.from(root.querySelectorAll<HTMLElement>(TV_NAV_ITEM)).filter((el) => el.tabIndex !== -1);
                if (!items.length) return;
                let idx = active ? items.indexOf(active) : -1;
                if (idx < 0 && active) idx = items.findIndex((el) => el.contains(active));
                if (idx < 0) return;
                const nextIdx = dir === 'down' ? idx + 1 : dir === 'up' ? idx - 1 : idx;
                event.preventDefault();
                event.stopPropagation();
                if (nextIdx < 0 || nextIdx >= items.length) return;
                focusItem(items[nextIdx], 'nearest');
                return;
            }

            // Content area: geometric spatial navigation.
            event.preventDefault();
            event.stopPropagation();

            const menuRoot = tvOverlayRoot();
            const current = active && active !== document.body && active !== document.documentElement
                ? (active.closest<HTMLElement>(TV_ITEM) || active)
                : null;
            if (!current || (menuRoot && current && !menuRoot.contains(current))) {
                if (menuRoot) {
                    const first = focusableTvItems(menuRoot)[0];
                    if (first) focusItem(first, 'nearest');
                    return;
                }
                focusTvContent();
                return;
            }

            let target: HTMLElement | null = null;
            if (!menuRoot && current.closest('[data-tv-home-hero="1"]')) {
                if (dir === 'left' || dir === 'right') {
                    const heroIdx = Number(current.getAttribute('data-tv-hero-index') || 0);
                    // First slide + Left = open the side nav (same as left-edge posters).
                    if (dir === 'left' && heroIdx <= 0) {
                        const key = tvKeyOf(current);
                        if (key) rememberTvFocusKey(key);
                        setNavOpen(true);
                        window.setTimeout(focusNavItem, 50);
                        return;
                    }
                    current.dispatchEvent(new CustomEvent('smp-tv-hero-cycle', {
                        bubbles: true,
                        detail: { delta: dir === 'left' ? -1 : 1 },
                    }));
                    return;
                }
                if (dir === 'down') {
                    const firstRail = visibleContentRails().find((rail) => !rail.closest('.player-home-hero'));
                    target = firstRail ? focusableTvItems(firstRail)[0] || null : null;
                }
            }
            if (!menuRoot && !target) target = listStep(current, dir);
            if (!menuRoot && !target && dir === 'up' && current.closest('[data-tv-details="1"]')) {
                const details = current.closest('[data-tv-details="1"]') || document;
                // Only jump to Play when Play is actually above this row.
                // Episode hubs keep Play under the cards, so Up goes to season pills.
                const firstBelow = firstDetailsRowItem(details);
                const play = detailsPlayButton(details);
                if (firstBelow && play && sameDetailsEntryRow(current, firstBelow)) {
                    const playRect = play.getBoundingClientRect();
                    const curRect = current.getBoundingClientRect();
                    if (playRect.bottom <= curRect.top + 8) target = play;
                }
            }
            const inBrowseChrome = Boolean(current.closest('[data-tv-browse-grid="1"], [data-tv-alpha="1"]'));
            if (!target && !menuRoot && (dir === 'left' || dir === 'right') && !inBrowseChrome) {
                const posterRail = current.closest<HTMLElement>('[data-tv-poster-rail="1"]');
                if (posterRail) target = findSpatialTarget(current, dir, posterRail);
            }
            if (!target && !menuRoot) target = settingsStep(current, dir);
            if (!target && !menuRoot && inBrowseChrome) {
                const onBrowseGrid = Boolean(current.closest('[data-tv-browse-grid="1"]'));
                const verticalHold = onBrowseGrid && (dir === 'up' || dir === 'down');
                // Native repeats would double-step on top of the hold timer.
                if (verticalHold && event.repeat) return;
                const stepped = browseGridStep(current, dir);
                if (stepped) {
                    focusItem(stepped, 'nearest', dir);
                    if (verticalHold) armBrowseHold(dir);
                    return;
                }
                if (dir !== 'left') return;
            }
            if (!target && !menuRoot && current.closest('.player-home-stage') && (dir === 'up' || dir === 'down')) {
                window.dispatchEvent(new CustomEvent('smp-tv-home-row', { detail: { dir } }));
                return;
            }
            if (!target && !menuRoot && !inBrowseChrome && (dir === 'up' || dir === 'down')) {
                target = nearestVerticalRow(current, dir);
            }
            if (!target) target = findSpatialTarget(current, dir, menuRoot || undefined);
            if (!target && !menuRoot && dir === 'up' && isPlayerHomePath()) {
                const hero = document.querySelector<HTMLElement>('[data-tv-home-hero="1"]');
                if (hero && hasLayout(hero) && !current.closest('[data-tv-home-hero="1"]')) {
                    focusItem(hero, 'start');
                    return;
                }
            }
            if (!target && !menuRoot && dir === 'up') {
                const top = pageTopFor(current);
                if (top) {
                    scrollEl(top, 'start');
                    return;
                }
            }
            if (target) {
                focusItem(target, 'nearest', dir);
                return;
            }
            // An open context menu owns D-pad until closed — do not jump to nav.
            if (menuRoot) return;
            // Setup screen has no side nav — stay put instead of opening an empty rail.
            if (auth) return;
            // No candidate to the left = focus is at the left edge → open side nav.
            if (dir === 'left') {
                const key = tvKeyOf(current);
                if (key) rememberTvFocusKey(key);
                setNavOpen(true);
                window.setTimeout(focusNavItem, 50);
            }
        };

        const onFocusIn = (event: FocusEvent) => {
            syncPosterFocusAttr();
            const target = event.target as HTMLElement | null;
            if (!target) return;
            if (target.closest(TV_NAV_ROOT) && !isNavOpen()) {
                window.setTimeout(() => {
                    if (!isNavOpen() && document.activeElement?.closest?.(TV_NAV_ROOT)) {
                        restoreTvFocusWhenReady();
                    }
                }, 0);
                return;
            }
            if (confirmHeld && target.closest('[data-tv-item-menu="1"]')) {
                suppressMenuConfirm = true;
            }
            const itemEl = target.closest<HTMLElement>(TV_ITEM) || target;
            const key = tvKeyOf(itemEl);
            if (key && !target.closest(TV_NAV_ROOT)) {
                const rail = itemEl.closest<HTMLElement>('[data-tv-poster-rail="1"]');
                rememberTvFocusKey(key, currentPath(), rail?.scrollLeft);
                rememberRowFocus(itemEl);
            }
        };

        const onNavigate = () => restoreTvFocusWhenReady();

        const onFocusPosters = () => {
            const root = document.querySelector('[data-tv-library="1"]') || document;
            focusFirstPoster(root);
        };

        const onKeyUp = (event: KeyboardEvent) => {
            const released = dirOfKey(event.key);
            if (released && released === browseHoldDir) stopBrowseHold();
            if (!isConfirmKey(event)) return;
            confirmHeld = false;
            const heldPoster = posterSelectTarget;
            const openedMenu = posterSelectMenuOpened;
            if (suppressMenuConfirm || openedMenu) {
                event.preventDefault();
                event.stopPropagation();
                const swallow = (clickEvent: MouseEvent) => {
                    const node = clickEvent.target as HTMLElement | null;
                    if (!node) return;
                    const onMenu = Boolean(node.closest?.('[data-tv-item-menu="1"]'));
                    const onHeldPoster = Boolean(
                        heldPoster
                        && (node === heldPoster || heldPoster.contains(node) || node.closest?.(TV_HOLD_BTN) === heldPoster)
                    );
                    if (!onMenu && !onHeldPoster) return;
                    clickEvent.preventDefault();
                    clickEvent.stopPropagation();
                };
                window.addEventListener('click', swallow, true);
                window.setTimeout(() => {
                    window.removeEventListener('click', swallow, true);
                    suppressMenuConfirm = false;
                }, 350);
            }
            if (!posterSelectTarget) return;
            event.preventDefault();
            event.stopPropagation();
            if (posterReleaseTimer) window.clearTimeout(posterReleaseTimer);
            // Some TV WebViews emit keyup between repeats. Wait briefly so the
            // next keydown can keep the hold alive.
            posterReleaseTimer = window.setTimeout(() => {
                posterReleaseTimer = null;
                const poster = posterSelectTarget;
                const menuOpened = posterSelectMenuOpened;
                clearPosterSelectHold();
                if (!poster || menuOpened) return;
                if (poster === posterButtonOf(document.activeElement) && hasLayout(poster)) poster.click();
            }, 120);
        };

        const onKeyDownCancelHold = (event: KeyboardEvent) => {
            if (!posterSelectTarget || isConfirmKey(event)) return;
            clearPosterSelectHold();
        };

        window.addEventListener('keydown', onKeyDown, true);
        window.addEventListener('keyup', onKeyUp, true);
        window.addEventListener('keydown', onKeyDownCancelHold, true);
        window.addEventListener('smp-tv-focus-posters', onFocusPosters);
        document.addEventListener('focusin', onFocusIn, true);
        window.addEventListener('popstate', onNavigate);
        window.addEventListener(PLAYER_NAVIGATE_EVENT, onNavigate);
        // Do not sync on focusout — WebView activeElement is unreliable mid-blur and
        // was leaving data-tv-focused on the first poster of other rails.
        syncPosterFocusAttr();
        restoreTvFocusWhenReady();
        return () => {
            window.__SMP_HANDLE_BACK__ = handleAppBack;
            clearPosterSelectHold();
            stopBrowseHold();
            window.removeEventListener('keydown', onKeyDown, true);
            window.removeEventListener('keyup', onKeyUp, true);
            window.removeEventListener('keydown', onKeyDownCancelHold, true);
            window.removeEventListener('smp-tv-focus-posters', onFocusPosters);
            document.removeEventListener('focusin', onFocusIn, true);
            window.removeEventListener('popstate', onNavigate);
            window.removeEventListener(PLAYER_NAVIGATE_EVENT, onNavigate);
        };
    }, [enabled]);
};
