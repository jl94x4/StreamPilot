/** Hash routing for Poster Sets — library-first with Discover sub-views. */

import { restorePortalScroll, scheduleScrollRestore, withPreservedPortalScroll, type PortalScrollSnapshot } from './shared/posterSetsScroll';

export const POSTER_SETS_PRIMARY_TABS = ['library', 'collections', 'discover', 'queue', 'watches', 'logs', 'paste', 'settings'] as const;
export type PosterSetsPrimaryTab = (typeof POSTER_SETS_PRIMARY_TABS)[number];

export const DISCOVER_VIEWS = ['search', 'browse', 'tpdb', 'recent'] as const;
export type DiscoverView = (typeof DISCOVER_VIEWS)[number];

/** Internal tabs used by the dashboard render tree (legacy names preserved). */
export const POSTER_SETS_INTERNAL_TABS = [
    'apply',
    'browse',
    'tpdb',
    'library',
    'collections',
    'queue',
    'watches',
    'recent',
    'paste',
    'history',
    'settings',
] as const;
export type PosterSetsInternalTab = (typeof POSTER_SETS_INTERNAL_TABS)[number];

/** @deprecated Use PosterSetsPrimaryTab — kept for gradual migration. */
export const POSTER_SETS_TABS = POSTER_SETS_INTERNAL_TABS;
/** @deprecated Use PosterSetsInternalTab */
export type PosterSetsTabId = PosterSetsInternalTab;

export type PosterSetsUrlState = {
    tab: PosterSetsPrimaryTab;
    discoverView: DiscoverView;
    /** Browse “See all” rail id, e.g. mediux_title_cards */
    rail: string | null;
    /** Discover search deep-link: set URL to preview */
    setUrl: string | null;
    /** Discover search deep-link: open creator catalog (ignored when setUrl is set) */
    creator: string | null;
    /** Restrict MediUX preview/apply to title_card assets only */
    titleCardsOnly: boolean;
    /** Bookmarklet / userscript: queue the set after preview */
    action: 'apply' | null;
};

const isPrimaryTab = (value: string): value is PosterSetsPrimaryTab =>
    (POSTER_SETS_PRIMARY_TABS as readonly string[]).includes(value);

const isDiscoverView = (value: string): value is DiscoverView =>
    (DISCOVER_VIEWS as readonly string[]).includes(value);

const isInternalTab = (value: string): value is PosterSetsInternalTab =>
    (POSTER_SETS_INTERNAL_TABS as readonly string[]).includes(value);

const normalizeCreator = (value: string | null | undefined) => {
    const handle = String(value || '').trim().replace(/^@+/, '');
    if (!handle || !/^[A-Za-z0-9._-]{1,64}$/.test(handle)) return null;
    return handle;
};

const parseImportAction = (params: URLSearchParams): 'apply' | null => (
    String(params.get('action') || '').trim().toLowerCase() === 'apply' ? 'apply' : null
);

const emptyState = (): PosterSetsUrlState => ({
    tab: 'library',
    discoverView: 'search',
    rail: null,
    setUrl: null,
    creator: null,
    titleCardsOnly: false,
    action: null,
});

const legacyTabToState = (legacy: PosterSetsInternalTab): Pick<PosterSetsUrlState, 'tab' | 'discoverView'> => {
    switch (legacy) {
        case 'library':
            return { tab: 'library', discoverView: 'search' };
        case 'collections':
            return { tab: 'collections', discoverView: 'search' };
        case 'queue':
            return { tab: 'queue', discoverView: 'search' };
        case 'watches':
            return { tab: 'watches', discoverView: 'search' };
        case 'history':
            return { tab: 'logs', discoverView: 'search' };
        case 'settings':
            return { tab: 'settings', discoverView: 'search' };
        case 'browse':
            return { tab: 'discover', discoverView: 'browse' };
        case 'tpdb':
            return { tab: 'discover', discoverView: 'tpdb' };
        case 'recent':
            return { tab: 'discover', discoverView: 'recent' };
        case 'paste':
            return { tab: 'paste', discoverView: 'search' };
        case 'apply':
        default:
            return { tab: 'discover', discoverView: 'search' };
    }
};

export function internalTabFromUrl(state: PosterSetsUrlState): PosterSetsInternalTab {
    if (state.tab === 'library') return 'library';
    if (state.tab === 'collections') return 'collections';
    if (state.tab === 'queue') return 'queue';
    if (state.tab === 'watches') return 'watches';
    if (state.tab === 'logs') return 'history';
    if (state.tab === 'settings') return 'settings';
    if (state.tab === 'paste') return 'paste';
    if (state.discoverView === 'browse') return 'browse';
    if (state.discoverView === 'tpdb') return 'tpdb';
    if (state.discoverView === 'recent') return 'recent';
    return 'apply';
}

export function primaryTabFromInternal(tab: PosterSetsInternalTab): PosterSetsPrimaryTab {
    return legacyTabToState(tab).tab;
}

export function urlStateFromInternalTab(
    tab: PosterSetsInternalTab,
    extras: Partial<Pick<PosterSetsUrlState, 'rail' | 'setUrl' | 'creator' | 'titleCardsOnly' | 'action'>> = {},
): PosterSetsUrlState {
    const base = legacyTabToState(tab);
    return {
        ...base,
        rail: extras.rail ?? null,
        setUrl: extras.setUrl ?? null,
        creator: extras.creator ?? null,
        titleCardsOnly: Boolean(extras.titleCardsOnly),
        action: extras.action === 'apply' ? 'apply' : null,
    };
}

/** Accept legacy `{ tab: 'apply' }` shapes from existing dashboard code. */
export type PosterLocationInput = PosterSetsUrlState | {
    tab: PosterSetsInternalTab;
    rail?: string | null;
    setUrl?: string | null;
    creator?: string | null;
    titleCardsOnly?: boolean;
    action?: 'apply' | null;
};

export function normalizePosterLocation(input: PosterLocationInput): PosterSetsUrlState {
    if ('discoverView' in input && isPrimaryTab(input.tab)) {
        return input as PosterSetsUrlState;
    }
    const legacy = input as { tab: PosterSetsInternalTab; rail?: string | null; setUrl?: string | null; creator?: string | null; titleCardsOnly?: boolean; action?: 'apply' | null };
    return urlStateFromInternalTab(legacy.tab, legacy);
}

export function parsePosterSetsUrl(hash = typeof window !== 'undefined' ? window.location.hash : ''): PosterSetsUrlState {
    const raw = String(hash || '').replace(/^#/, '').trim();
    if (!raw) return emptyState();

    const qIndex = raw.indexOf('?');
    const pathPart = (qIndex >= 0 ? raw.slice(0, qIndex) : raw).trim();
    const queryPart = qIndex >= 0 ? raw.slice(qIndex + 1) : '';
    const segments = pathPart.split('/').filter(Boolean).map((part) => {
        try {
            return decodeURIComponent(part);
        } catch {
            return part;
        }
    });

    const first = String(segments[0] || 'library').trim().toLowerCase();
    const params = new URLSearchParams(queryPart);

    // Legacy hash routes (#apply, #browse, …)
    if (isInternalTab(first) && !isPrimaryTab(first)) {
        const legacy = first as PosterSetsInternalTab;
        const mapped = legacyTabToState(legacy);
        const setUrlRaw = legacy === 'apply' ? String(params.get('url') || '').trim() : '';
        const setUrl = setUrlRaw || null;
        const creator = legacy === 'apply' && !setUrl
            ? normalizeCreator(params.get('creator') || params.get('user'))
            : null;
        const assets = String(params.get('assets') || '').trim().toLowerCase();
        const titleCardsOnly = legacy === 'apply' && Boolean(setUrl) && (
            assets === 'title_cards'
            || assets === 'title_card'
            || assets === 'titlecards'
        );
        return {
            ...mapped,
            rail: legacy === 'browse' && segments[1] ? String(segments[1]).trim() || null : null,
            setUrl,
            creator,
            titleCardsOnly,
            action: setUrl ? parseImportAction(params) : null,
        };
    }

    const tabRaw: PosterSetsPrimaryTab = isPrimaryTab(first) ? first : 'library';
    let discoverView: DiscoverView = 'search';
    let rail: string | null = null;

    // Legacy bookmark: #discover/watches → primary Watching tab
    if (tabRaw === 'discover' && String(segments[1] || '').trim().toLowerCase() === 'watches') {
        return {
            tab: 'watches',
            discoverView: 'search',
            rail: null,
            setUrl: null,
            creator: null,
            titleCardsOnly: false,
            action: null,
        };
    }

    // Legacy bookmark: #discover/history → primary Logs tab
    if (tabRaw === 'discover' && String(segments[1] || '').trim().toLowerCase() === 'history') {
        return {
            tab: 'logs',
            discoverView: 'search',
            rail: null,
            setUrl: null,
            creator: null,
            titleCardsOnly: false,
            action: null,
        };
    }

    // Legacy bookmark: #discover/paste → primary Paste / Import tab
    if (tabRaw === 'discover' && String(segments[1] || '').trim().toLowerCase() === 'paste') {
        const setUrlRaw = String(params.get('url') || '').trim();
        const setUrl = setUrlRaw || null;
        const assets = String(params.get('assets') || '').trim().toLowerCase();
        const titleCardsOnly = Boolean(setUrl) && (
            assets === 'title_cards'
            || assets === 'title_card'
            || assets === 'titlecards'
        );
        return {
            tab: 'paste',
            discoverView: 'search',
            rail: null,
            setUrl,
            creator: null,
            titleCardsOnly,
            action: setUrl ? parseImportAction(params) : null,
        };
    }

    const tab = tabRaw;

    if (tab === 'discover') {
        const viewRaw = String(segments[1] || 'search').trim().toLowerCase();
        if (isDiscoverView(viewRaw)) {
            discoverView = viewRaw;
            if (viewRaw === 'browse' && segments[2]) {
                rail = String(segments[2]).trim() || null;
            }
        } else if (viewRaw === 'browse') {
            discoverView = 'browse';
        }
    }

    const acceptsSetUrl = tab === 'paste' || (tab === 'discover' && discoverView === 'search');
    const setUrlRaw = acceptsSetUrl
        ? String(params.get('url') || '').trim()
        : '';
    const setUrl = setUrlRaw || null;
    const creator = tab === 'discover' && discoverView === 'search' && !setUrl
        ? normalizeCreator(params.get('creator') || params.get('user'))
        : null;
    const assets = String(params.get('assets') || '').trim().toLowerCase();
    const titleCardsOnly = acceptsSetUrl
        && Boolean(setUrl)
        && (
            assets === 'title_cards'
            || assets === 'title_card'
            || assets === 'titlecards'
        );

    return { tab, discoverView, rail, setUrl, creator, titleCardsOnly, action: setUrl ? parseImportAction(params) : null };
}

export function buildPosterSetsHash(state: PosterSetsUrlState): string {
    let hash = `#${state.tab}`;
    if (state.tab === 'discover') {
        if (state.discoverView !== 'search') {
            hash += `/${state.discoverView}`;
        }
        if (state.discoverView === 'browse' && state.rail) {
            hash += `/${encodeURIComponent(state.rail)}`;
        }
    }
    if ((state.tab === 'paste' || (state.tab === 'discover' && state.discoverView === 'search')) && state.setUrl) {
        const params = new URLSearchParams();
        params.set('url', state.setUrl);
        if (state.titleCardsOnly) params.set('assets', 'title_cards');
        if (state.action === 'apply') params.set('action', 'apply');
        hash += `?${params.toString()}`;
    } else if (state.tab === 'discover' && state.discoverView === 'search' && state.creator) {
        const params = new URLSearchParams();
        params.set('creator', state.creator);
        hash += `?${params.toString()}`;
    }
    return hash;
}

export function writePosterSetsUrl(
    state: PosterSetsUrlState,
    mode: 'push' | 'replace' = 'push',
    options?: { restoreScroll?: PortalScrollSnapshot | null },
) {
    if (typeof window === 'undefined') return;
    const desired = buildPosterSetsHash(state);
    const current = window.location.hash || '';
    if (current === desired) return;
    const apply = () => {
        if (mode === 'replace' && !current && desired === '#library') {
            const next = `${window.location.pathname}${window.location.search}${desired}`;
            window.history.replaceState({ posterSets: true }, '', next);
            return;
        }

        const next = `${window.location.pathname}${window.location.search}${desired}`;
        if (mode === 'push') {
            window.history.pushState({ posterSets: true }, '', next);
        } else {
            window.history.replaceState({ posterSets: true }, '', next);
        }
    };
    // Changing `#discover?url=` ↔ `#discover` makes Safari/iOS jump to the top.
    if (options?.restoreScroll) {
        apply();
        restorePortalScroll(options.restoreScroll);
        scheduleScrollRestore(() => restorePortalScroll(options.restoreScroll), {
            frames: 3,
            delays: [0, 50, 160, 400],
        });
        return;
    }
    withPreservedPortalScroll(apply);
}

export function posterSetsUrlEquals(a: PosterSetsUrlState, b: PosterSetsUrlState): boolean {
    return a.tab === b.tab
        && a.discoverView === b.discoverView
        && (a.rail || null) === (b.rail || null)
        && (a.setUrl || null) === (b.setUrl || null)
        && (a.creator || null) === (b.creator || null)
        && Boolean(a.titleCardsOnly) === Boolean(b.titleCardsOnly)
        && (a.action || null) === (b.action || null);
}
