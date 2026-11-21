/**
 * Bridge to the native TV Home (NativeHomeView / NativeHomePlugin) on Android TV.
 * The web Home still owns the data and every action; the native view only draws the rows
 * and moves focus. Capacitor is loaded dynamically (same as nativePlayer.ts) so the portal
 * bundle does not need @capacitor/core.
 */

export type NativeHomeEvent = 'open' | 'longPress' | 'back' | 'edgeLeft' | 'focus' | 'activity' | 'holdEnd'
    | 'edgeUp' | 'browseOpen' | 'browseLongPress' | 'browseFocus' | 'browseHandoff' | 'browseScroll' | 'railOpen' | 'railLongPress' | 'railFocus' | 'railHandoff' | 'railVertical' | 'railActivity' | 'detailsSurface' | 'railHoldEnd' | 'menuPick' | 'menuBack';
/** rowId carries the key direction ('up' | 'down' | 'left') on railHandoff. */
export type NativeHomeEventData = { rowId?: string; key?: string };

type CapNativeHome = {
    show: (opts: { rows: string; focus?: boolean }) => Promise<{ rows?: number }>;
    hide: () => Promise<void>;
    exitApp: () => Promise<void>;
    releaseFocus: () => Promise<void>;
    focusRows: () => Promise<void>;
    setBlocked: (opts: { blocked: boolean }) => Promise<void>;
    setPlaybackCover: (opts: { on: boolean }) => Promise<void>;
    setBrowse: (opts: { data: string; vw: number; fresh: boolean; rgb: string; focus?: boolean }) => Promise<void>;
    focusBrowse: (opts: { key: string }) => Promise<void>;
    setRing: (opts: { rgb: string; scale: number }) => Promise<void>;
    setFont: (opts: { key: string }) => Promise<{ reset?: boolean } | void>;
    setLook: (opts: { radius: number; marker: string; textScale: number; viewMore: string }) => Promise<void>;
    setSurface: (opts: { rgb: string }) => Promise<void>;
    enterDetails: (opts: { url: string; rgb: string; tint?: boolean; focus?: boolean }) => Promise<void>;
    setDetailsScroll: (opts: { y: number; h?: number; vw?: number; sy?: number }) => Promise<void>;
    setRail: (opts: { rail: string; focus?: string }) => Promise<void>;
    setRailRect: (opts: { x: number; y: number; w: number; h: number; vw: number }) => Promise<void>;
    hideRail: () => Promise<void>;
    setRowsShift: (opts: { px: number }) => Promise<void>;
    setRailSuppressed: (opts: { on: boolean }) => Promise<void>;
    focusRail: (opts: { key: string }) => Promise<void>;
    setDetailRail: (opts: { id: string; data: string; focus?: string }) => Promise<void>;
    setDetailRailRect: (opts: { sy?: number; id: string; x: number; y: number; w: number; h: number; vw: number }) => Promise<void>;
    hideDetailRail: (opts: { id: string }) => Promise<void>;
    setDetailsText: (opts: { data: string }) => Promise<void>;
    setDetailsTextRect: (opts: { sy?: number; x: number; y: number; w: number; h: number; vw: number }) => Promise<void>;
    hideDetailsText: () => Promise<void>;
    setDetailActions: (opts: { data: string }) => Promise<void>;
    setDetailActionsRect: (opts: { sy?: number; x: number; y: number; w: number; h: number; vw: number }) => Promise<void>;
    hideDetailActions: () => Promise<void>;
    setSettings: (opts: { data: string }) => Promise<void>;
    setSettingsRect: (opts: { x: number; y: number; w: number; h: number; vw: number }) => Promise<void>;
    hideSettings: () => Promise<void>;
    setSearch: (opts: { data: string }) => Promise<void>;
    setSearchRect: (opts: { x: number; y: number; w: number; h: number; vw: number }) => Promise<void>;
    hideSearch: () => Promise<void>;
    setChrome: (opts: { data: string }) => Promise<void>;
    hideChrome: () => Promise<void>;
    setLibHeader: (opts: { data: string }) => Promise<void>;
    hideLibHeader: () => Promise<void>;
    setSeasonTabs: (opts: { data: string }) => Promise<void>;
    setSeasonTabsRect: (opts: { sy?: number; x: number; y: number; w: number; h: number; vw: number }) => Promise<void>;
    hideSeasonTabs: () => Promise<void>;
    setDetailRailSuppressed: (opts: { on: boolean }) => Promise<void>;
    focusDetailRail: (opts: { key: string }) => Promise<{ found?: boolean }>;
    injectKey: (opts: { dir: string }) => Promise<void>;
    setMenu: (opts: { data: string }) => Promise<void>;
    setBillboard: (opts: { data: string }) => Promise<void>;
    clearBillboard: () => Promise<void>;
    hideMenu: (opts: { focusWeb: boolean }) => Promise<void>;
    addListener: (
        event: NativeHomeEvent,
        cb: (data: NativeHomeEventData) => void,
    ) => Promise<{ remove: () => Promise<void> }>;
};

// registerPlugin() returns a Proxy; resolving a promise with it makes Capacitor throw
// "X.then() is not implemented", so the plugin travels inside a holder object.
type PluginHolder = { plugin: CapNativeHome | null };
let pluginPromise: Promise<PluginHolder> | null = null;

const loadHolder = (): Promise<PluginHolder> => {
    if (pluginPromise) return pluginPromise;
    pluginPromise = (async () => {
        try {
            const cap = await import('@capacitor/core');
            if (!cap.Capacitor?.isNativePlatform?.()) return { plugin: null };
            return { plugin: cap.registerPlugin<CapNativeHome>('NativeHome') };
        } catch {
            return { plugin: null };
        }
    })();
    return pluginPromise;
};

/** Sync check for showing the setting: the Android TV app only. */
export const isNativeHomeSupported = (): boolean => {
    if (typeof window === 'undefined') return false;
    const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
    if (!cap?.isNativePlatform?.()) return false;
    return document.documentElement?.dataset?.tv === '1'
        || (window as unknown as { __PLEX_CLIENT__?: { isTv?: boolean } }).__PLEX_CLIENT__?.isTv === true;
};

/** Home and a library's Recommended page share the one native view: whoever showed it last owns it. */
let nativeOwner = '';
export const nativeHomeOwner = () => nativeOwner;

export const nativeHomeShow = async (payloadJson: string, focus = true, owner = 'home'): Promise<boolean> => {
    const { plugin } = await loadHolder();
    if (!plugin) return false;
    nativeOwner = owner;
    try {
        if (lastRing) await plugin.setRing(lastRing).catch(() => undefined);
        if (lastFont) await plugin.setFont({ key: lastFont }).catch(() => undefined);
        if (lastLook) await plugin.setLook(lastLook).catch(() => undefined);
        // A title page opened while the calls above were in flight (Back to Home, then straight into another title):
        // showing the rows now would put Home back under that page.
        if (nativeOwner !== owner) return false;
        await plugin.show({ rows: payloadJson, focus });
        // The billboard copy may have been sent before the view existed (or belong to another screen).
        if (owner === 'home' && lastBillboard) await plugin.setBillboard({ data: lastBillboard }).catch(() => undefined);
        else if (owner !== 'home') await plugin.clearBillboard().catch(() => undefined);
        return true;
    } catch {
        return false;
    }
};

/**
 * Fade the native view out. With an owner, only if that owner still has it (another screen may have taken it
 * over in the same moment); resolves false when it was left alone.
 */
export const nativeHomeHide = async (owner = ''): Promise<boolean> => {
    if (owner && nativeOwner && owner !== nativeOwner) return false;
    const { plugin } = await loadHolder();
    if (owner && nativeOwner && owner !== nativeOwner) return false;
    try {
        await plugin?.hide();
    } catch {
        /* plugin gone */
    }
    if (owner && nativeOwner && owner !== nativeOwner) return false;
    return true;
};

export const nativeHomeReleaseFocus = async (): Promise<void> => {
    const { plugin } = await loadHolder();
    try {
        await plugin?.releaseFocus();
    } catch {
        /* plugin gone */
    }
};

/** The Home billboard copy last sent ('' = none), replayed when the native view is (re)shown. */
let lastBillboard = '';

export const nativeBillboardSet = async (json: string): Promise<void> => {
    if (json === lastBillboard) return;
    lastBillboard = json;
    const { plugin } = await loadHolder();
    try {
        await plugin?.setBillboard({ data: json });
    } catch {
        /* plugin gone */
    }
};

export const nativeBillboardClear = async (): Promise<void> => {
    lastBillboard = '';
    const { plugin } = await loadHolder();
    try {
        await plugin?.clearBillboard();
    } catch {
        /* plugin gone */
    }
};

/** Settings: focus ring colour ("r g b", '' = native default) and thickness factor (1 = normal). */
let lastRing: { rgb: string; scale: number } | null = null;

/** Settings: the app font key ('default' = the built-in look) for the native screens. */
let lastFont = '';

/** Settings → Display: poster corner radius, row marker, text scale and View more card for the native screens. */
export type NativeLook = { radius: number; marker: string; textScale: number; viewMore: string };
let lastLook: NativeLook | null = null;

export const nativeHomeSetLook = async (look: NativeLook): Promise<void> => {
    if (lastLook && lastLook.radius === look.radius && lastLook.marker === look.marker
        && lastLook.textScale === look.textScale && lastLook.viewMore === look.viewMore) return;
    lastLook = look;
    const { plugin } = await loadHolder();
    try {
        await plugin?.setLook(look);
    } catch {
        /* plugin gone */
    }
};

export const nativeHomeSetFont = async (key: string): Promise<void> => {
    lastFont = key || 'default';
    const { plugin } = await loadHolder();
    try {
        const res = await plugin?.setFont({ key: lastFont });
        // The native screens were built with the old font and have been taken down: reload so every one is rebuilt
        // (the route is kept). Only after a saved change - drafts never reach here.
        if (res && (res as { reset?: boolean }).reset) window.location.reload();
    } catch {
        /* plugin gone */
    }
};

export const nativeHomeSetRing = async (rgb: string, scale: number): Promise<void> => {
    lastRing = { rgb, scale };
    const { plugin } = await loadHolder();
    try {
        await plugin?.setRing({ rgb, scale });
    } catch {
        /* plugin gone */
    }
};

/** A library's Browse grid: cards + the page's layout numbers ("<json>"), vw = the page's layout width. */
export const nativeBrowseSet = async (data: string, vw: number, fresh: boolean, rgb: string, focus: boolean): Promise<boolean> => {
    const { plugin } = await loadHolder();
    if (!plugin) return false;
    nativeOwner = 'browse';
    try {
        if (lastRing) await plugin.setRing(lastRing).catch(() => undefined);
        if (lastFont) await plugin.setFont({ key: lastFont }).catch(() => undefined);
        if (lastLook) await plugin.setLook(lastLook).catch(() => undefined);
        await plugin.setBrowse({ data, vw, fresh, rgb, focus });
        return true;
    } catch {
        return false;
    }
};

export const nativeBrowseFocus = async (key: string): Promise<void> => {
    const { plugin } = await loadHolder();
    try {
        await plugin?.focusBrowse({ key });
    } catch {
        /* plugin gone */
    }
};

/** The sidebar (or a menu) is open over the rows: the native rows take no keys and hold no focus. */
export const nativeHomeSetBlocked = async (blocked: boolean): Promise<void> => {
    const { plugin } = await loadHolder();
    try {
        await plugin?.setBlocked({ blocked });
    } catch {
        /* plugin gone */
    }
};

/** The native black "starting next episode" cover (the player raises it when it closes for play-next). */
export const nativePlaybackCover = async (on: boolean): Promise<void> => {
    if (!isNativeHomeSupported()) return;
    const { plugin } = await loadHolder();
    try {
        await plugin?.setPlaybackCover({ on });
    } catch {
        /* plugin gone / older shell */
    }
};

export const nativeHomeSetShift = async (px: number): Promise<void> => {
    const { plugin } = await loadHolder();
    try {
        await plugin?.setRowsShift({ px });
    } catch {
        /* plugin gone */
    }
};

export const nativeHomeFocusRows = async (): Promise<void> => {
    const { plugin } = await loadHolder();
    try {
        await plugin?.focusRows();
    } catch {
        /* plugin gone */
    }
};

/** The billboard fade colour (per-artwork tint), "r g b". */
export const nativeHomeSetSurface = async (rgb: string): Promise<void> => {
    const { plugin } = await loadHolder();
    try {
        await plugin?.setSurface({ rgb });
    } catch {
        /* plugin gone */
    }
};

/**
 * Details pages (movie / show): the native view keeps the backdrop picture (the page's own scrims stay on
 * top), so opening a title from Home does not reload it.
 */
let detailsActive = false;
let detailsLeaveTimer = 0;
export const isNativeDetailsActive = () => detailsActive;

/** {@code focus} false: a backdrop swap on a page already entered; the remote stays on whatever native view has it. */
export const nativeDetailsEnter = async (url: string, rgb: string, tint = true, focus = true): Promise<boolean> => {
    window.clearTimeout(detailsLeaveTimer);
    // Claim the native view straight away: a Home show still in flight must see it is no longer Home's.
    nativeOwner = 'details';
    const { plugin } = await loadHolder();
    if (!plugin) return false;
    try {
        nativeOwner = 'details';
        await plugin.enterDetails({ url, rgb, tint, focus });
        detailsActive = true;
        return true;
    } catch {
        return false;
    }
};

export const nativeDetailsScroll = (y: number, h = 0): void => {
    const vw = window.innerWidth;
    const sy = pageScroll();
    void loadHolder().then(({ plugin }) => plugin?.setDetailsScroll({ y, h, vw, sy }).catch(() => undefined));
};

/**
 * Season / episode pages: the episode rail is drawn natively (NativeEpisodeRail) at the web rail's rect.
 * The web rail stays in the page, invisible, so focus, spotlight and every action keep running on it.
 */
export const nativeRailSet = (rail: string, focus = ''): void => {
    void loadHolder().then(({ plugin }) => plugin?.setRail({ rail, focus }).catch(() => undefined));
};

export const nativeRailRect = (x: number, y: number, w: number, h: number, vw: number): void => {
    void loadHolder().then(({ plugin }) => plugin?.setRailRect({ x, y, w, h, vw }).catch(() => undefined));
};

export const nativeRailSuppressed = (on: boolean): void => {
    void loadHolder().then(({ plugin }) => plugin?.setRailSuppressed({ on }).catch(() => undefined));
};

export const nativeRailHide = (): void => {
    void loadHolder().then(({ plugin }) => plugin?.hideRail().catch(() => undefined));
};

export const nativeRailFocus = async (key: string): Promise<void> => {
    const { plugin } = await loadHolder();
    try {
        await plugin?.focusRail({ key });
    } catch {
        /* plugin gone */
    }
};

/** Cast / related rails of a details page, one native rail per id (NativeDetailRail). */
export const nativeDetailRailSet = (id: string, data: string, focus = ''): void => {
    void loadHolder().then(({ plugin }) => plugin?.setDetailRail({ id, data, focus }).catch(() => undefined));
};

/** The page's own scroll (viewport units) at the moment a rect is measured, so native can follow later scrolling. */
const pageScroll = (): number => document.scrollingElement?.scrollTop ?? window.scrollY ?? 0;

export const nativeDetailRailRect = (id: string, x: number, y: number, w: number, h: number, vw: number): void => {
    void loadHolder().then(({ plugin }) => plugin?.setDetailRailRect({ id, x, y, w, h, vw, sy: pageScroll() }).catch(() => undefined));
};

export const nativeDetailRailHide = (id: string): void => {
    void loadHolder().then(({ plugin }) => plugin?.hideDetailRail({ id }).catch(() => undefined));
};

/** Movie / show page text (identity, chips + ratings, synopsis) drawn natively at the web blocks' places. */
export const nativeDetailsTextSet = (data: string): void => {
    void loadHolder().then(({ plugin }) => plugin?.setDetailsText({ data }).catch(() => undefined));
};

export const nativeDetailsTextRect = (x: number, y: number, w: number, h: number, vw: number): void => {
    void loadHolder().then(({ plugin }) => plugin?.setDetailsTextRect({ x, y, w, h, vw, sy: pageScroll() }).catch(() => undefined));
};

export const nativeDetailsTextHide = (): void => {
    void loadHolder().then(({ plugin }) => plugin?.hideDetailsText().catch(() => undefined));
};

/** The action buttons row of a movie / show / episode page, drawn natively at the web row's place. */
export const nativeDetailActionsSet = (data: string): void => {
    void loadHolder().then(({ plugin }) => plugin?.setDetailActions({ data }).catch(() => undefined));
};

export const nativeDetailActionsRect = (x: number, y: number, w: number, h: number, vw: number): void => {
    void loadHolder().then(({ plugin }) => plugin?.setDetailActionsRect({ x, y, w, h, vw, sy: pageScroll() }).catch(() => undefined));
};

export const nativeDetailActionsHide = (): void => {
    void loadHolder().then(({ plugin }) => plugin?.hideDetailActions().catch(() => undefined));
};

/** The Settings screen, drawn natively from a payload scraped off the web page. */
export const nativeSettingsSet = (data: string): void => {
    void loadHolder().then(({ plugin }) => plugin?.setSettings({ data }).catch(() => undefined));
};

export const nativeSettingsRect = (x: number, y: number, w: number, h: number, vw: number): void => {
    void loadHolder().then(({ plugin }) => plugin?.setSettingsRect({ x, y, w, h, vw }).catch(() => undefined));
};

export const nativeSearchSet = (data: string): void => {
    void loadHolder().then(({ plugin }) => plugin?.setSearch({ data }).catch(() => undefined));
};

export const nativeSearchRect = (x: number, y: number, w: number, h: number, vw: number): void => {
    void loadHolder().then(({ plugin }) => plugin?.setSearchRect({ x, y, w, h, vw }).catch(() => undefined));
};

export const nativeChromeSet = (data: string): void => {
    void loadHolder().then(({ plugin }) => plugin?.setChrome({ data }).catch(() => undefined));
};

export const nativeLibHeaderSet = (data: string): void => {
    void loadHolder().then(({ plugin }) => plugin?.setLibHeader({ data }).catch(() => undefined));
};

export const nativeLibHeaderHide = (): void => {
    void loadHolder().then(({ plugin }) => plugin?.hideLibHeader().catch(() => undefined));
};

export const nativeChromeHide = (): void => {
    void loadHolder().then(({ plugin }) => plugin?.hideChrome().catch(() => undefined));
};

export const nativeSearchHide = (): void => {
    void loadHolder().then(({ plugin }) => plugin?.hideSearch().catch(() => undefined));
};

export const nativeSettingsHide = (): void => {
    void loadHolder().then(({ plugin }) => plugin?.hideSettings().catch(() => undefined));
};

/** The season bar of an episode / season page, drawn natively at the web bar's place. */
export const nativeSeasonTabsSet = (data: string): void => {
    void loadHolder().then(({ plugin }) => plugin?.setSeasonTabs({ data }).catch(() => undefined));
};

export const nativeSeasonTabsRect = (x: number, y: number, w: number, h: number, vw: number): void => {
    void loadHolder().then(({ plugin }) => plugin?.setSeasonTabsRect({ x, y, w, h, vw, sy: pageScroll() }).catch(() => undefined));
};

export const nativeSeasonTabsHide = (): void => {
    void loadHolder().then(({ plugin }) => plugin?.hideSeasonTabs().catch(() => undefined));
};

export const nativeDetailRailSuppressed = (on: boolean): void => {
    void loadHolder().then(({ plugin }) => plugin?.setDetailRailSuppressed({ on }).catch(() => undefined));
};

/** Resolves true when a native rail has that card and took the remote. */
export const nativeDetailRailFocus = async (key: string): Promise<boolean> => {
    const { plugin } = await loadHolder();
    try {
        const res = await plugin?.focusDetailRail({ key });
        return res?.found === true;
    } catch {
        return false;
    }
};

export const nativeRailInjectKey = async (dir: string): Promise<void> => {
    const { plugin } = await loadHolder();
    try {
        await plugin?.injectKey({ dir });
    } catch {
        /* plugin gone */
    }
};

/** The details page went away: wait a beat (the next page may be another title or Home), then let go. */
export const nativeDetailsLeave = (afterClear?: () => void): void => {
    window.clearTimeout(detailsLeaveTimer);
    detailsLeaveTimer = window.setTimeout(() => {
        detailsActive = false;
        void nativeHomeHide().then(() => {
            if (!detailsActive) {
                setNativeHomeStageClear(false);
                // The page now showing skipped painting its own colour while the native view had it: paint it.
                afterClear?.();
            }
        });
    }, 160);
};

/** Home is taking the native view back: cancel a pending details leave. */
export const nativeDetailsHandOverToHome = (): void => {
    window.clearTimeout(detailsLeaveTimer);
    detailsActive = false;
};

/** Window event: the web Home picked a new billboard fade colour (detail: "r g b"). */
export const HOME_SURFACE_EVENT = 'smp-home-surface';

export const nativeHomeExitApp = async (): Promise<void> => {
    const { plugin } = await loadHolder();
    try {
        await plugin?.exitApp();
    } catch {
        /* plugin gone */
    }
};

/** The item context menu, drawn natively above the page (the page keeps the actions). */
export const nativeMenuSet = async (data: string): Promise<boolean> => {
    const { plugin } = await loadHolder();
    if (!plugin) return false;
    try {
        await plugin.setMenu({ data });
        return true;
    } catch {
        return false;
    }
};

export const nativeMenuHide = async (focusWeb = true): Promise<void> => {
    const { plugin } = await loadHolder();
    try {
        await plugin?.hideMenu({ focusWeb });
    } catch {
        /* plugin gone */
    }
};

/** Subscribe to native Home events. Returns an unsubscribe function. */
export const onNativeHomeEvent = (
    event: NativeHomeEvent,
    cb: (data: NativeHomeEventData) => void,
): (() => void) => {
    let removed = false;
    let handle: { remove: () => Promise<void> } | null = null;
    void loadHolder().then(async ({ plugin }) => {
        if (!plugin || removed) return;
        handle = await plugin.addListener(event, cb);
        if (removed) void handle.remove();
    });
    return () => {
        removed = true;
        if (handle) void handle.remove();
    };
};

/** Window event: the native Home's focused poster changed (detail: { key, rowId }). */
export const NATIVE_HOME_FOCUS_EVENT = 'smp-native-home-focus';

/**
 * Make the page see-through where the native Home draws (backdrop and rows), and hide the web copies.
 * Attributes, not classes: React owns className and would drop them on a re-render.
 */
export const setNativeHomeStageClear = (on: boolean, anchor = '.player-home-stage'): void => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    document.querySelectorAll<HTMLElement>('[data-nh-clear="1"]').forEach((el) => {
        el.removeAttribute('data-nh-clear');
        el.style.removeProperty('background');
    });
    document.body.style.removeProperty('background');
    root.style.removeProperty('background');
    if (!on) {
        delete root.dataset.nativeHome;
        return;
    }
    root.dataset.nativeHome = '1';
    // Inline: the stylesheet's own important rules sit in a cascade layer and would win over ours.
    root.style.setProperty('background', 'transparent', 'important');
    document.body.style.setProperty('background', 'transparent', 'important');
    let el: HTMLElement | null = document.querySelector<HTMLElement>(anchor);
    while (el) {
        el.setAttribute('data-nh-clear', '1');
        el.style.setProperty('background', 'transparent', 'important');
        el = el.parentElement;
    }
};
