import { stripBasePath } from '../shared/basePath';

/** Scroll the portal main view back to the top after in-app discovery navigation. */
export const scrollPortalToTop = () => {
    if (typeof window === 'undefined') return;
    window.scrollTo(0, 0);
    const container = document.getElementById('main-scroll-container');
    if (container) container.scrollTop = 0;
};

const DISCOVER_SCROLL_STATE_KEY = 'discover:scrollByPath:v1';
const DISCOVER_LAST_BROWSE_PATH_KEY = 'discover:lastBrowsePath:v1';
const MAX_SCROLL_ENTRIES = 36;

const toDiscoveryPath = (value = '') => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const qIndex = raw.indexOf('?');
    const pathPart = qIndex >= 0 ? raw.slice(0, qIndex) : raw;
    const search = qIndex >= 0 ? raw.slice(qIndex) : '';
    const stripped = stripBasePath(pathPart) || pathPart;
    return stripped.startsWith('/discovery') ? `${stripped}${search}` : '';
};

const isDetailPath = (path = '') => (
    /^\/discovery\/(movie|tv|person)\//.test(path)
    || /^\/discovery\/music\/artist\//.test(path)
);

export const currentDiscoverPathWithSearch = () => {
    if (typeof window === 'undefined') return '/discovery';
    return `${window.location.pathname || '/discovery'}${window.location.search || ''}`;
};

const readScrollMap = (): Record<string, number> => {
    if (typeof sessionStorage === 'undefined') return {};
    try {
        const raw = sessionStorage.getItem(DISCOVER_SCROLL_STATE_KEY);
        const parsed = raw ? JSON.parse(raw) : {};
        if (!parsed || typeof parsed !== 'object') return {};
        return parsed;
    } catch {
        return {};
    }
};

const writeScrollMap = (value: Record<string, number>) => {
    if (typeof sessionStorage === 'undefined') return;
    try {
        const entries = Object.entries(value)
            .filter(([key, top]) => key && Number.isFinite(Number(top)))
            .slice(-MAX_SCROLL_ENTRIES);
        sessionStorage.setItem(DISCOVER_SCROLL_STATE_KEY, JSON.stringify(Object.fromEntries(entries)));
    } catch {
        // ignore quota / private mode
    }
};

const SCROLL_RESTORE_SLACK_PX = 48;
const SCROLL_RESTORE_TIMEOUT_MS = 2500;

/** Desktop Discover scrolls `#main-scroll-container`; mobile uses the document. */
const discoverScrollerIsContainer = () => {
    const container = document.getElementById('main-scroll-container');
    if (!container) return false;
    const overflowY = window.getComputedStyle(container).overflowY;
    return overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay';
};

const readDiscoverScrollTop = () => {
    const container = document.getElementById('main-scroll-container');
    if (container && discoverScrollerIsContainer()) {
        return Math.max(0, Math.round(container.scrollTop || 0));
    }
    return Math.max(0, Math.round(window.scrollY || document.documentElement.scrollTop || 0));
};

const writeDiscoverScrollTop = (top: number) => {
    const container = document.getElementById('main-scroll-container');
    if (container) container.scrollTop = top;
    window.scrollTo(0, top);
};

export const stashDiscoverScrollPosition = (path = currentDiscoverPathWithSearch()) => {
    if (typeof window === 'undefined') return;
    const key = toDiscoveryPath(path);
    if (!key) return;
    const next = readScrollMap();
    next[key] = readDiscoverScrollTop();
    writeScrollMap(next);
};

export const restoreDiscoverScrollPosition = (path = currentDiscoverPathWithSearch()) => {
    if (typeof window === 'undefined') return false;
    const key = toDiscoveryPath(path);
    if (!key) return false;
    const top = Number(readScrollMap()[key]);
    if (!Number.isFinite(top)) return false;
    writeDiscoverScrollTop(top);
    const applied = readDiscoverScrollTop();
    return Math.abs(applied - top) <= SCROLL_RESTORE_SLACK_PX || top <= SCROLL_RESTORE_SLACK_PX;
};

/** Keep applying a saved offset until the poster grid is tall enough (or we time out). */
export const restoreDiscoverScrollPositionWhenReady = (
    path = currentDiscoverPathWithSearch(),
    { fallbackToTop = true }: { fallbackToTop?: boolean } = {},
) => {
    if (typeof window === 'undefined') return () => undefined;
    const key = toDiscoveryPath(path);
    if (!key) return () => undefined;
    const top = Number(readScrollMap()[key]);
    if (!Number.isFinite(top)) {
        if (fallbackToTop) scrollPortalToTop();
        return () => undefined;
    }

    let cancelled = false;
    let raf = 0;
    const started = Date.now();

    const tick = () => {
        if (cancelled) return;
        if (restoreDiscoverScrollPosition(path) || Date.now() - started >= SCROLL_RESTORE_TIMEOUT_MS) {
            return;
        }
        raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);

    return () => {
        cancelled = true;
        window.cancelAnimationFrame(raf);
    };
};

export const stashDiscoverBrowsePath = (path = currentDiscoverPathWithSearch()) => {
    if (typeof sessionStorage === 'undefined') return;
    const key = toDiscoveryPath(path);
    if (!key || isDetailPath(key)) return;
    try {
        sessionStorage.setItem(DISCOVER_LAST_BROWSE_PATH_KEY, key);
    } catch {
        // ignore quota / private mode
    }
};

export const readDiscoverBrowsePath = () => {
    if (typeof sessionStorage === 'undefined') return '';
    try {
        return toDiscoveryPath(sessionStorage.getItem(DISCOVER_LAST_BROWSE_PATH_KEY) || '');
    } catch {
        return '';
    }
};

const DISCOVER_DETAIL_SEED_KEY = 'discover:detailSeed';

/** Stash a lightweight TMDB row so MediaDetailsPage can paint before the proxy returns. */
export const stashDiscoverDetailSeed = (item: any) => {
    if (typeof sessionStorage === 'undefined' || !item) return;
    try {
        const mediaType = item?.type === 'tv' || item?.mediaType === 'tv' ? 'tv' : 'movie';
        const id = Number(item?.id ?? item?.tmdbId);
        if (!Number.isFinite(id) || id <= 0) return;
        const title = item.title || item.name || '';
        sessionStorage.setItem(DISCOVER_DETAIL_SEED_KEY, JSON.stringify({
            id,
            tmdbId: id,
            mediaType,
            title: mediaType === 'movie' ? title : undefined,
            name: mediaType === 'tv' ? title : undefined,
            posterPath: item.posterPath || null,
            backdropPath: item.backdropPath || null,
            overview: item.overview || '',
            releaseDate: item.releaseDate || null,
            firstAirDate: item.firstAirDate || null,
            voteAverage: item.voteAverage,
            mediaInfo: item.mediaInfo || null,
            _seed: true,
        }));
    } catch {
        // ignore quota / private mode
    }
};

/** Read a seed that matches the current detail route; otherwise null. */
export const readDiscoverDetailSeed = (mediaType: string, mediaId: number) => {
    if (typeof sessionStorage === 'undefined') return null;
    try {
        const raw = sessionStorage.getItem(DISCOVER_DETAIL_SEED_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        const type = parsed?.mediaType === 'tv' ? 'tv' : 'movie';
        const id = Number(parsed?.id ?? parsed?.tmdbId);
        if (type !== mediaType || id !== Number(mediaId)) return null;
        return parsed;
    } catch {
        return null;
    }
};

const DISCOVER_PERSON_RETURN_KEY = 'discover:personReturn:v1';

const personIdFromPath = (path = '') => {
    const match = toDiscoveryPath(path).split('?')[0].match(/^\/discovery\/person\/(\d+)/);
    return match ? Number(match[1]) : 0;
};

/** Remember the title (or other Discover page) that opened this actor, so Back returns there. */
export const stashDiscoverPersonReturn = (fromPath: string, toPath: string) => {
    if (typeof sessionStorage === 'undefined') return;
    const personId = personIdFromPath(toPath);
    const from = toDiscoveryPath(fromPath);
    if (!personId || !from || personIdFromPath(from) === personId) return;
    try {
        sessionStorage.setItem(DISCOVER_PERSON_RETURN_KEY, JSON.stringify({ personId, from }));
    } catch {
        // ignore quota / private mode
    }
};

export const consumeDiscoverPersonReturn = (personId: number) => {
    if (typeof sessionStorage === 'undefined') return '';
    try {
        const raw = sessionStorage.getItem(DISCOVER_PERSON_RETURN_KEY);
        if (!raw) return '';
        const parsed = JSON.parse(raw);
        if (Number(parsed?.personId) !== Number(personId)) return '';
        sessionStorage.removeItem(DISCOVER_PERSON_RETURN_KEY);
        return toDiscoveryPath(parsed?.from || '');
    } catch {
        return '';
    }
};
