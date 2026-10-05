/**
 * Plex client that talks to plex.tv and the user's Plex Media Server directly.
 * Native CapacitorHttp patches fetch so the WebView is not blocked by CORS.
 */
import { mirrorAuthToNativeStorage } from './authPersistence';
import { getPortalBaseUrl, getSessionToken, writeStoredSessionToken } from './config';
import { STORAGE_PLEX_CLIENT_ID, STORAGE_PLEX_HOME_USER, STORAGE_PLEX_OWNER_TOKEN, STORAGE_PLEX_SERVER, STORAGE_PLEX_SERVERS } from './configStorageKeys';
import { DEFAULT_PLAYER_SETTINGS, type PlayerSettings } from '../media-player/playerSettings';
import { PLAYER_SERVERS_EVENT } from '../media-player/playerMemory';

type PlexServer = {
    id: string;
    name: string;
    uri: string;
    accessToken: string;
};

type PlexMeta = Record<string, any>;

const PLEX_TV = 'https://plex.tv';
const SETTINGS_KEY = 'plexClient.directSettings';
const HERO_CONFIG_KEY = 'plexClient.homeHeroConfig';
const TMDB_KEY_STORAGE = 'plexClient.tmdbApiKey';
const HERO_LIMIT = 8;
const TRENDING_HERO_LIMIT = 25;
const HALLOWEEN_HERO_LIMIT = 50;
const TRENDING_SCAN = 40;
const HERO_MODES = new Set([
    'off',
    'trending_week',
    'continue_watching',
    'seasonal_halloween',
    'seasonal_christmas',
    'seasonal_nye',
    'seasonal_easter',
    'seasonal_thanksgiving',
    'recently_added',
    'most_watched',
    'unwatched_picks',
    'new_releases',
    'random_spotlight',
]);
const SEASONAL_HERO_MODES = new Set([
    'seasonal_halloween',
    'seasonal_christmas',
    'seasonal_nye',
    'seasonal_easter',
    'seasonal_thanksgiving',
]);
const SEASONAL_QUERIES: Record<string, string[]> = {
    seasonal_halloween: ['halloween', 'horror', 'scary movie'],
    seasonal_christmas: ['christmas', 'holiday', 'xmas', 'santa'],
    seasonal_nye: ["new year's eve", 'new year', "new year's day", 'new years'],
    seasonal_easter: ['easter', 'easter bunny', 'peter rabbit', 'hop'],
    seasonal_thanksgiving: ['thanksgiving', 'family dinner'],
};

type HeroConfig = {
    mode: string;
    seasonalInWindowOnly: boolean;
    continueWatchingSeasonPoster: boolean;
};

const readHeroConfig = (): HeroConfig => {
    try {
        const parsed = JSON.parse(localStorage.getItem(HERO_CONFIG_KEY) || '');
        const mode = HERO_MODES.has(String(parsed?.mode || '')) ? String(parsed.mode) : 'trending_week';
        return {
            mode,
            seasonalInWindowOnly: parsed?.seasonalInWindowOnly === true,
            continueWatchingSeasonPoster: parsed?.continueWatchingSeasonPoster === true,
        };
    } catch {
        return { mode: 'trending_week', seasonalInWindowOnly: false, continueWatchingSeasonPoster: false };
    }
};

const writeHeroConfig = (body: any): HeroConfig & { saved: boolean } => {
    const current = readHeroConfig();
    const next: HeroConfig = {
        mode: HERO_MODES.has(String(body?.mode || '')) ? String(body.mode) : current.mode,
        seasonalInWindowOnly: body?.seasonalInWindowOnly === true,
        continueWatchingSeasonPoster: body?.continueWatchingSeasonPoster === true,
    };
    try { localStorage.setItem(HERO_CONFIG_KEY, JSON.stringify(next)); } catch { /* ignore */ }
    return { ...next, saved: true };
};

const readTmdbApiKey = () => {
    try {
        const stored = String(localStorage.getItem(TMDB_KEY_STORAGE) || '').trim();
        if (stored && stored !== '********') return stored;
    } catch { /* ignore */ }
    try {
        return String(process.env.PLEX_CLIENT_TMDB_API_KEY || '').trim();
    } catch {
        return '';
    }
};

type TrendingCandidate = {
    tmdbId: number | null;
    mediaType: 'movie' | 'show';
    title: string;
    overview: string;
    year: string | null;
    backdropUrl: string;
    posterUrl: string | null;
};

const DISCOVER_BASE = 'https://discover.provider.plex.tv';
const DISCOVER_TRENDING_PATHS = [
    '/hubs/sections/home/top_watchlisted',
    '/hubs/sections/movies/top_watchlisted',
    '/hubs/sections/tv/top_watchlisted',
];

type HeroMappedItem = {
    ratingKey: string;
    title: string;
    type: string;
    year?: number | null;
    summary?: string;
    thumb?: string | null;
    art?: string | null;
    logo?: string | null;
    backdropArt?: string | null;
    tmdbId?: number | null;
    canPlay?: boolean;
    serverId?: string;
    showTitle?: string;
    grandparentRatingKey?: string;
    heroBackdropUrl?: string | null;
};

const mapTmdbTrendingRow = (row: any): TrendingCandidate | null => {
    const mediaType = row?.media_type === 'tv' || row?.first_air_date || row?.mediaType === 'show'
        ? 'show'
        : (row?.media_type === 'movie' || row?.release_date || row?.title || row?.mediaType === 'movie' ? 'movie' : '');
    const resolved = mediaType === 'show' || mediaType === 'movie'
        ? mediaType
        : (row?.mediaType === 'show' || row?.mediaType === 'movie' ? row.mediaType : '');
    const tmdbId = Number(row?.tmdbId || row?.id);
    const title = String(row?.title || row?.name || '').trim();
    const backdropUrl = String(row?.backdropUrl || '').trim()
        || (row?.backdrop_path ? `https://image.tmdb.org/t/p/w1280${row.backdrop_path}` : '');
    if ((resolved !== 'movie' && resolved !== 'show')
        || !Number.isFinite(tmdbId)
        || tmdbId <= 0
        || !title
        || !backdropUrl) return null;
    return {
        tmdbId,
        mediaType: resolved,
        title,
        overview: String(row?.overview || '').trim(),
        year: String(row?.year || row?.release_date || row?.first_air_date || '').slice(0, 4) || null,
        backdropUrl,
        posterUrl: row?.posterUrl
            || (row?.poster_path ? `https://image.tmdb.org/t/p/w500${row.poster_path}` : null),
    };
};

const discoverImageUrl = (path: unknown) => {
    const raw = String(path || '').trim();
    if (!raw) return '';
    // Only public CDNs — tokenized Discover paths leak the Plex token into <img> URLs.
    if (/^https?:\/\//i.test(raw) && /image\.tmdb\.org|metadata-static\.plex\.tv|image\.plex\.tv/i.test(raw)) {
        return raw;
    }
    return '';
};

const mapDiscoverTrendingMeta = (meta: any): TrendingCandidate | null => {
    const type = String(meta?.type || '').toLowerCase();
    const mediaType = type === 'movie' || type === 'show' ? type : '';
    if (!mediaType) return null;
    const title = String(meta?.title || meta?.grandparentTitle || '').trim();
    if (!title) return null;
    const ids = pickExternalIds(meta as PlexMeta);
    return {
        tmdbId: ids.tmdb && ids.tmdb > 0 ? ids.tmdb : null,
        mediaType,
        title,
        overview: String(meta?.summary || '').trim(),
        year: String(meta?.year || meta?.originallyAvailableAt || '').slice(0, 4) || null,
        backdropUrl: discoverImageUrl(meta?.art || meta?.grandparentArt),
        posterUrl: discoverImageUrl(meta?.thumb || meta?.parentThumb || meta?.grandparentThumb) || null,
    };
};

const collectDiscoverHubMetas = (data: any): any[] => {
    const container = containerOf(data);
    const fromHubs = asList<any>(container.Hub).flatMap((hub) => asList<any>(hub.Metadata));
    const direct = asList<any>(container.Metadata);
    return fromHubs.length ? fromHubs : direct;
};

/** Plex Discover "Most Watchlisted This Week" — uses the signed-in Plex token (no TMDB key). */
const fetchPlexDiscoverTrendingWeek = async (): Promise<TrendingCandidate[]> => {
    const token = accountToken() || readOwnerToken();
    if (!token) return [];
    const seen = new Set<string>();
    const out: TrendingCandidate[] = [];
    for (const path of DISCOVER_TRENDING_PATHS) {
        if (out.length >= TRENDING_SCAN) break;
        const url = `${DISCOVER_BASE}${path}?count=${TRENDING_SCAN}&includeMeta=1&excludeElements=Actor,Collection,Country,Director,Genre,Label,Mood,Producer,Writer`;
        const data = await plexFetch(url, token).catch(() => null);
        if (!data) continue;
        for (const meta of collectDiscoverHubMetas(data)) {
            const mapped = mapDiscoverTrendingMeta(meta);
            if (!mapped) continue;
            const key = mapped.tmdbId
                ? `${mapped.mediaType}:${mapped.tmdbId}`
                : `${mapped.mediaType}:${normalizeHeroTitle(mapped.title)}:${mapped.year || ''}`;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push(mapped);
            if (out.length >= TRENDING_SCAN) break;
        }
    }
    if (out.length) return out;

    // Fallback: home Discover hubs — pick any watchlisted / trending row.
    const home = await plexFetch(
        `${DISCOVER_BASE}/hubs/sections/home?count=24&includeMeta=1&excludeElements=Actor,Collection,Country,Director,Genre,Label,Mood,Producer,Writer`,
        token,
    ).catch(() => null);
    for (const hub of asList<any>(containerOf(home).Hub)) {
        const label = `${hub?.title || ''} ${hub?.hubIdentifier || hub?.identifier || ''}`.toLowerCase();
        if (!/watchlist|trending|popular|top\s*10|most\s*watch/i.test(label)) continue;
        for (const meta of asList<any>(hub.Metadata)) {
            const mapped = mapDiscoverTrendingMeta(meta);
            if (!mapped) continue;
            const key = mapped.tmdbId
                ? `${mapped.mediaType}:${mapped.tmdbId}`
                : `${mapped.mediaType}:${normalizeHeroTitle(mapped.title)}:${mapped.year || ''}`;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push(mapped);
            if (out.length >= TRENDING_SCAN) break;
        }
        if (out.length >= TRENDING_SCAN) break;
    }
    return out;
};

const fetchTmdbTrendingWeekDirect = async (apiKey: string): Promise<TrendingCandidate[]> => {
    const key = String(apiKey || '').trim();
    if (!key || key === '********') return [];
    const res = await fetch(
        `https://api.themoviedb.org/3/trending/all/week?api_key=${encodeURIComponent(key)}&page=1`,
    ).catch(() => null);
    if (!res?.ok) return [];
    const json = await res.json().catch(() => null);
    return [].concat(json?.results || [])
        .map((row: any) => mapTmdbTrendingRow(row))
        .filter(Boolean)
        .slice(0, TRENDING_SCAN) as TrendingCandidate[];
};

const fetchPortalTrendingWeek = async (): Promise<TrendingCandidate[]> => {
    const base = String(getPortalBaseUrl() || '').replace(/\/+$/, '');
    if (!base) return [];
    const res = await fetch(`${base}/api/public/media-player/trending-week`, {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
    }).catch(() => null);
    if (!res?.ok) return [];
    const json = await res.json().catch(() => null);
    return [].concat(json?.items || [])
        .map((row: any) => mapTmdbTrendingRow(row))
        .filter(Boolean)
        .slice(0, TRENDING_SCAN) as TrendingCandidate[];
};

const loadTrendingCandidates = async () => {
    // Prefer Plex Discover (already signed in — no TMDB key). TMDB/portal are optional upgrades.
    const discover = await fetchPlexDiscoverTrendingWeek();
    if (discover.length) return discover;
    const key = readTmdbApiKey();
    if (key) {
        const direct = await fetchTmdbTrendingWeekDirect(key);
        if (direct.length) return direct;
    }
    return fetchPortalTrendingWeek();
};

const normalizeHeroTitle = (value: unknown) => String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const titlesClose = (a: unknown, b: unknown) => {
    const left = normalizeHeroTitle(a);
    const right = normalizeHeroTitle(b);
    if (!left || !right) return false;
    return left === right || left.includes(right) || right.includes(left);
};

const metaMatchesTmdb = (meta: PlexMeta, tmdbId: number) => {
    const needle = String(tmdbId);
    const guids = asList<PlexMeta>(meta.Guid).map((row) => String(row.id || '')).concat(String(meta.guid || ''));
    const blob = guids.join(' ').toLowerCase();
    return blob.includes(`tmdb://${needle}`)
        || blob.includes(`themoviedb://${needle}`)
        || blob.includes(`tmdb:${needle}`);
};

const findPlexByTmdbGuid = async (server: PlexServer, candidate: TrendingCandidate) => {
    if (!candidate.tmdbId) return null;
    const plexType = candidate.mediaType === 'movie' ? 1 : 2;
    for (const guid of [`tmdb://${candidate.tmdbId}`, `themoviedb://${candidate.tmdbId}`]) {
        const data = await heroPms(
            `/library/all?type=${plexType}&guid=${encodeURIComponent(guid)}&includeGuids=1&X-Plex-Container-Size=4`,
            server,
        ).catch(() => null);
        const meta = asList<PlexMeta>(containerOf(data).Metadata)[0];
        if (meta?.ratingKey) return meta;
    }
    return null;
};

const findPlexByTitleForTrending = async (server: PlexServer, candidate: TrendingCandidate) => {
    const data = await heroPms(
        `/hubs/search?query=${encodeURIComponent(candidate.title)}&limit=24&includeGuids=1`,
        server,
    ).catch(() => null);
    const wanted = candidate.mediaType === 'movie' ? 'movie' : 'show';
    const yearNum = candidate.year ? Number(candidate.year) : null;
    let fallback: PlexMeta | null = null;
    for (const hub of asList<PlexMeta>(containerOf(data).Hub)) {
        for (const meta of asList<PlexMeta>(hub.Metadata)) {
            if (String(meta?.type || '') !== wanted || !meta?.ratingKey) continue;
            if (candidate.tmdbId && metaMatchesTmdb(meta, candidate.tmdbId)) return meta;
            if (!titlesClose(meta.title || meta.grandparentTitle, candidate.title)) continue;
            if (yearNum && Number(meta.year) && Math.abs(Number(meta.year) - yearNum) > 1) continue;
            if (!fallback) fallback = meta;
        }
    }
    return fallback;
};

const matchTrendingToLibrary = async (candidates: TrendingCandidate[], limit = TRENDING_HERO_LIMIT) => {
    const servers = enabledServers();
    if (!servers.length || !candidates.length) return [] as HeroMappedItem[];
    const hits: HeroMappedItem[] = [];
    const seen = new Set<string>();
    for (const candidate of candidates) {
        if (hits.length >= limit) break;
        for (const server of servers) {
            const meta = await withMapServer(server, async () => (
                (await findPlexByTmdbGuid(server, candidate))
                || (await findPlexByTitleForTrending(server, candidate))
            )).catch(() => null);
            if (!meta?.ratingKey) continue;
            const item = await withMapServer(server, async () => {
                const full = await heroPms(
                    `/library/metadata/${encodeURIComponent(String(meta.ratingKey))}?includeImages=1&includeGuids=1`,
                    server,
                ).catch(() => null);
                const row = asList<PlexMeta>(containerOf(full).Metadata)[0] || meta;
                const mapped = mapItem(row) as HeroMappedItem;
                rememberItem(mapped.ratingKey, server);
                if (candidate.backdropUrl) mapped.heroBackdropUrl = candidate.backdropUrl;
                if (!mapped.tmdbId && candidate.tmdbId) mapped.tmdbId = candidate.tmdbId;
                if (candidate.overview && !mapped.summary) mapped.summary = candidate.overview;
                return mapped;
            }).catch(() => null);
            if (!item?.ratingKey || seen.has(item.ratingKey)) continue;
            if (!item.art && !item.thumb && !item.heroBackdropUrl && !item.backdropArt) continue;
            seen.add(item.ratingKey);
            hits.push(item);
            break;
        }
    }
    return hits;
};

const HERO_DAY_MS = 86400000;
const heroYmd = (date: Date) => ({
    y: date.getUTCFullYear(),
    m: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    time: Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
});
const easterSundayUtc = (year: number) => {
    const y = Math.floor(year);
    const a = y % 19;
    const b = Math.floor(y / 100);
    const c = y % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(Date.UTC(y, month - 1, day));
};
const seasonalHeroInWindow = (mode: string, now = new Date()) => {
    const { y, m, day, time } = heroYmd(now);
    if (mode === 'seasonal_halloween') return m === 10 && day >= 1 && day <= 31;
    if (mode === 'seasonal_christmas') return time >= Date.UTC(y, 10, 20) && time <= Date.UTC(y, 11, 26);
    if (mode === 'seasonal_nye') return (m === 12 && day >= 26) || (m === 1 && day <= 4);
    if (mode === 'seasonal_thanksgiving') return m === 11 && day >= 15 && day <= 30;
    if (mode === 'seasonal_easter') {
        const easter = easterSundayUtc(y);
        return time >= easter.getTime() - 14 * HERO_DAY_MS && time <= easter.getTime() + 7 * HERO_DAY_MS;
    }
    return false;
};

const asList = <T,>(value: T | T[] | null | undefined): T[] => {
    if (value == null) return [];
    return Array.isArray(value) ? value : [value];
};

const clientId = () => {
    try {
        const existing = String(localStorage.getItem(STORAGE_PLEX_CLIENT_ID) || '').trim();
        if (existing) return existing;
        const next = (globalThis.crypto?.randomUUID?.() || `sp-${Date.now()}-${Math.random().toString(16).slice(2)}`);
        localStorage.setItem(STORAGE_PLEX_CLIENT_ID, next);
        void mirrorAuthToNativeStorage(STORAGE_PLEX_CLIENT_ID, next);
        return next;
    } catch {
        return 'streampilot-android';
    }
};

const plexHeaders = (token?: string): Record<string, string> => {
    const headers: Record<string, string> = {
        Accept: 'application/json',
        'X-Plex-Product': 'StreamPilot',
        'X-Plex-Version': '1.0.0',
        'X-Plex-Client-Identifier': clientId(),
        'X-Plex-Platform': 'Android',
        'X-Plex-Platform-Version': '14',
        'X-Plex-Device': 'Android TV',
        'X-Plex-Device-Name': 'StreamPilot',
        'X-Plex-Provides': 'player,controller',
    };
    if (token) headers['X-Plex-Token'] = token;
    return headers;
};

const readServerList = (): { servers: PlexServer[]; enabledIds: string[] } => {
    try {
        const raw = localStorage.getItem(STORAGE_PLEX_SERVERS);
        if (raw) {
            const parsed = JSON.parse(raw) as { servers?: PlexServer[]; enabledIds?: string[] };
            const servers = (parsed.servers || []).filter((server) => server?.id && server.uri && server.accessToken);
            if (servers.length) return { servers, enabledIds: parsed.enabledIds || [] };
        }
    } catch { /* migrate below */ }
    const legacy = readLegacyServer();
    return { servers: legacy ? [legacy] : [], enabledIds: [] };
};

const readLegacyServer = (): PlexServer | null => {
    try {
        const raw = localStorage.getItem(STORAGE_PLEX_SERVER);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as PlexServer;
        if (!parsed?.uri || !parsed?.accessToken) return null;
        return { id: parsed.id || 'default', name: parsed.name || 'Plex', uri: parsed.uri, accessToken: parsed.accessToken };
    } catch {
        return null;
    }
};

const writeServerList = (servers: PlexServer[], enabledIds: string[]) => {
    try {
        clearPlayerGetCache();
    } catch {
        /* cache may not be ready during early boot */
    }
    try {
        const raw = JSON.stringify({ servers, enabledIds });
        localStorage.setItem(STORAGE_PLEX_SERVERS, raw);
        void mirrorAuthToNativeStorage(STORAGE_PLEX_SERVERS, raw);
        const primary = servers.find((server) => !enabledIds.length || enabledIds.includes(server.id)) || servers[0] || null;
        if (!primary) {
            localStorage.removeItem(STORAGE_PLEX_SERVER);
            void mirrorAuthToNativeStorage(STORAGE_PLEX_SERVER, '');
            return;
        }
        const one = JSON.stringify(primary);
        localStorage.setItem(STORAGE_PLEX_SERVER, one);
        void mirrorAuthToNativeStorage(STORAGE_PLEX_SERVER, one);
    } catch {
        /* ignore */
    }
};

let serversPromise: Promise<PlexServer[]> | null = null;
let beginServerDiscovery = (_token: string): Promise<PlexServer[]> => Promise.resolve(enabledServers());
const ensureServers = () => {
    const token = accountToken() || readOwnerToken();
    const known = enabledServers();
    if (!token) return Promise.resolve(known);
    const discovery = beginServerDiscovery(token).catch(() => known);
    if (known.length) return Promise.resolve(known);
    return discovery;
};

const enabledServers = () => {
    const { servers, enabledIds } = readServerList();
    if (!enabledIds.length) return servers;
    const picked = servers.filter((server) => enabledIds.includes(server.id));
    return picked.length ? picked : servers;
};

const readServer = (): PlexServer | null => enabledServers()[0] || readLegacyServer();

const writeServer = (server: PlexServer | null) => {
    if (!server) writeServerList([], []);
    else writeServerList([server], []);
};

const itemOwners = new Map<string, string>();
let mapServer: PlexServer | null = null;

const rememberItem = (ratingKey: string, server: PlexServer | null) => {
    if (!ratingKey || !server?.id) return;
    itemOwners.set(ratingKey, server.id);
};

const serverById = (id: string) => enabledServers().find((server) => server.id === id)
    || readServerList().servers.find((server) => server.id === id)
    || null;

const resolveServer = (explicit?: string | null, ratingKey?: string) => {
    const wanted = String(explicit || '').trim();
    if (wanted) {
        const match = serverById(wanted);
        if (match) return match;
    }
    const owned = ratingKey ? serverById(itemOwners.get(ratingKey) || '') : null;
    if (owned) return owned;
    return readServer();
};

const plexErrorMessage = (status: number, text: string) => {
    try {
        const parsed = JSON.parse(text);
        const message = parsed?.errors?.[0]?.message || parsed?.error || parsed?.message;
        if (message) return String(message);
    } catch { /* plain text */ }
    return text || `Plex request failed (${status})`;
};

const withPlexQuery = (url: string, token?: string) => {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host !== 'plex.tv' && !host.endsWith('.plex.tv')) return url;
    for (const [key, value] of Object.entries(plexHeaders(token))) {
        if (key.toLowerCase() === 'accept') continue;
        if (!parsed.searchParams.has(key)) parsed.searchParams.set(key, value);
    }
    return parsed.toString();
};

const plexFetch = async (url: string, token: string | undefined, init: RequestInit = {}) => {
    const headers = {
        ...plexHeaders(token),
        ...(init.headers || {}),
    };
    const response = await fetch(withPlexQuery(url, token), {
        ...init,
        headers,
        cache: 'no-store',
    });
    if (!response.ok) {
        const text = await response.text().catch(() => '');
        const error = new Error(plexErrorMessage(response.status, text));
        (error as Error & { status?: number }).status = response.status;
        throw error;
    }
    if (response.status === 204) return null;
    const type = response.headers.get('content-type') || '';
    if (type.includes('json') || type.includes('javascript')) return response.json();
    const text = await response.text();
    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
};

/** Short TTL for idempotent media-player GETs (home/libraries/hero). Mutations clear it. */
const PLAYER_GET_TTL_MS = 45_000;
const playerGetCache = new Map<string, { at: number; data: unknown }>();

const clearPlayerGetCache = () => {
    playerGetCache.clear();
};

const readPlayerGetCache = (key: string) => {
    const row = playerGetCache.get(key);
    if (!row) return undefined;
    if (Date.now() - row.at > PLAYER_GET_TTL_MS) {
        playerGetCache.delete(key);
        return undefined;
    }
    return row.data;
};

const writePlayerGetCache = (key: string, data: unknown) => {
    playerGetCache.set(key, { at: Date.now(), data });
    if (playerGetCache.size > 40) {
        const oldest = playerGetCache.keys().next().value;
        if (oldest) playerGetCache.delete(oldest);
    }
};

if (typeof window !== 'undefined') {
    window.addEventListener(PLAYER_SERVERS_EVENT, () => {
        clearPlayerGetCache();
    });
}

const containerOf = (data: any) => data?.MediaContainer || data || {};

const imageUrl = (path: string | null | undefined, width: number, height: number, options?: { crop?: boolean }) => {
    const server = mapServer || readServer();
    const value = String(path || '').trim();
    if (!value || !server) return null;
    if (/^https?:\/\//i.test(value)) return value;
    const url = new URL('/photo/:/transcode', server.uri.endsWith('/') ? server.uri : `${server.uri}/`);
    url.searchParams.set('width', String(width));
    url.searchParams.set('height', String(height));
    if (options?.crop !== false) url.searchParams.set('minSize', '1');
    url.searchParams.set('upscale', '0');
    url.searchParams.set('quality', '70');
    url.searchParams.set('url', value.startsWith('/') ? value : `/${value}`);
    url.searchParams.set('X-Plex-Token', server.accessToken);
    return url.toString();
};

const clearLogo = (meta: PlexMeta) => {
    const images = asList<PlexMeta>(meta.Image);
    const logo = images.find((image) => image.type === 'clearLogo');
    return logo?.url || meta.clearLogo || null;
};

const mapStreams = (part: PlexMeta) => {
    const streams = asList<PlexMeta>(part?.Stream);
    const video = streams.find((stream) => Number(stream.streamType) === 1) || {};
    const audio = streams.filter((stream) => Number(stream.streamType) === 2);
    const subtitles = streams.filter((stream) => Number(stream.streamType) === 3);
    return { video, audio, subtitles };
};

const taggedBackground = (meta: PlexMeta) => {
    const images = asList<PlexMeta>(meta.Image);
    const row = images.find((image) => /^(background|art)$/i.test(String(image.type || '')));
    return String(row?.url || row?.path || '').trim();
};

/** Show/movie Plex background. Episodes must not use the episode still. */
const heroBackdropPath = (meta: PlexMeta, type: string) => {
    if (type === 'episode' || type === 'season') {
        return String(meta.grandparentArt || meta.parentArt || '').trim()
            || taggedBackground(meta)
            || String(meta.art || '').trim();
    }
    return taggedBackground(meta) || String(meta.art || meta.grandparentArt || '').trim();
};

const scoreNumber = (value: unknown) => {
    const next = Number(value);
    return Number.isFinite(next) ? next : null;
};

const toPercent = (value: unknown) => {
    const next = scoreNumber(value);
    if (next == null) return null;
    if (next <= 10) return Math.round(next * 10);
    return Math.round(next);
};

const pickExternalIds = (meta: PlexMeta) => {
    const ids = { imdb: null as string | null, tmdb: null as number | null, tvdb: null as string | null };
    const blobs = [meta.guid, meta.grandparentGuid, meta.parentGuid, ...asList<PlexMeta>(meta.Guid).map((row) => row?.id)];
    for (const raw of blobs) {
        const id = String(raw || '');
        const imdb = id.match(/imdb:\/\/(tt\d+)/i);
        if (imdb) ids.imdb = imdb[1];
        const tmdb = id.match(/(?:themoviedb|tmdb):\/\/(\d+)/i);
        if (tmdb && !ids.tmdb) ids.tmdb = Number(tmdb[1]);
        const tvdb = id.match(/(?:thetvdb|tvdb):\/\/(\d+)/i);
        if (tvdb) ids.tvdb = tvdb[1];
    }
    return ids;
};

const mapRatings = (meta: PlexMeta) => {
    const ids = pickExternalIds(meta);
    const mediaType = String(meta.type || '') === 'show' ? 'tv' : 'movie';
    const out = {
        imdb: null as { value: number; percent: number | null; url?: string | null; fresh?: boolean } | null,
        rottenTomatoes: null as { value: number; percent: number | null; fresh?: boolean } | null,
        popcorn: null as { value: number; percent: number | null; fresh?: boolean } | null,
        tmdb: null as { value: number; percent: number | null; url?: string | null } | null,
        tvdb: null as { value: number; percent: number | null; url?: string | null } | null,
    };
    const take = (key: keyof typeof out, payload: { value: number | null; percent: number | null; url?: string | null; fresh?: boolean }) => {
        if (out[key] || payload.value == null) return;
        out[key] = payload as typeof out[typeof key];
    };
    for (const row of asList<PlexMeta>(meta.Rating)) {
        const image = String(row?.image || '').toLowerCase();
        const value = scoreNumber(row?.value);
        if (value == null) continue;
        if (image.includes('imdb')) {
            take('imdb', { value, percent: toPercent(value), url: ids.imdb ? `https://www.imdb.com/title/${ids.imdb}/` : null });
        } else if (image.includes('themoviedb') || image.includes('tmdb')) {
            take('tmdb', {
                value,
                percent: toPercent(value),
                url: ids.tmdb ? `https://www.themoviedb.org/${mediaType}/${ids.tmdb}` : null,
            });
        } else if (image.includes('tvdb')) {
            take('tvdb', {
                value,
                percent: toPercent(value),
                url: ids.tvdb ? `https://www.thetvdb.com/?tab=series&id=${ids.tvdb}` : null,
            });
        } else if (image.includes('rottentomatoes')) {
            if (image.includes('upright') || image.includes('spilled') || image.includes('popcorn') || row.type === 'audience') {
                take('popcorn', { value, percent: toPercent(value), fresh: image.includes('upright') || (!image.includes('spilled') && value >= 6) });
            } else {
                take('rottenTomatoes', { value, percent: toPercent(value), fresh: image.includes('ripe') || (!image.includes('rotten') && value >= 6) });
            }
        }
    }
    const ratingImage = String(meta.ratingImage || '').toLowerCase();
    const audienceImage = String(meta.audienceRatingImage || '').toLowerCase();
    if (ratingImage.includes('imdb')) {
        take('imdb', { value: scoreNumber(meta.rating), percent: toPercent(meta.rating), url: ids.imdb ? `https://www.imdb.com/title/${ids.imdb}/` : null });
    }
    if (ratingImage.includes('themoviedb') || ratingImage.includes('tmdb')) {
        take('tmdb', { value: scoreNumber(meta.rating), percent: toPercent(meta.rating), url: ids.tmdb ? `https://www.themoviedb.org/${mediaType}/${ids.tmdb}` : null });
    }
    if (ratingImage.includes('tvdb')) {
        take('tvdb', { value: scoreNumber(meta.rating), percent: toPercent(meta.rating), url: ids.tvdb ? `https://www.thetvdb.com/?tab=series&id=${ids.tvdb}` : null });
    }
    if (audienceImage.includes('rottentomatoes') || audienceImage.includes('upright') || audienceImage.includes('popcorn')) {
        take('popcorn', { value: scoreNumber(meta.audienceRating), percent: toPercent(meta.audienceRating), fresh: !audienceImage.includes('spilled') });
    }
    if (ratingImage.includes('rottentomatoes')) {
        take('rottenTomatoes', { value: scoreNumber(meta.rating), percent: toPercent(meta.rating), fresh: ratingImage.includes('ripe') });
    }
    return { ids, ratings: out };
};

/** Unique watched episodes. Rewatches do not push the count past the episode total. */
const uniqueViewedLeafCount = (meta: PlexMeta) => {
    const leaf = Math.max(0, Number(meta.leafCount) || 0);
    const unviewedRaw = Number(meta.unviewedLeafCount);
    if (Number.isFinite(unviewedRaw)) {
        return Math.max(0, Math.min(leaf, leaf - Math.max(0, unviewedRaw)));
    }
    const viewed = Number(meta.viewedLeafCount) || 0;
    return leaf > 0 ? Math.max(0, Math.min(leaf, viewed)) : Math.max(0, viewed);
};

const mapItem = (meta: PlexMeta) => {
    const type = String(meta.type || meta.librarySectionType || 'movie');
    const music = /^(artist|album|track|audio|music)$/i.test(type)
        || String(meta.librarySectionType || '').toLowerCase() === 'artist';
    const medias = asList<PlexMeta>(meta.Media);
    const firstPart = asList<PlexMeta>(medias[0]?.Part)[0];
    const { video, audio, subtitles } = mapStreams(firstPart || {});
    const viewedLeafCount = uniqueViewedLeafCount(meta);
    const leafTotal = Math.max(0, Number(meta.leafCount) || 0);
    const watched = type === 'show' || type === 'season'
        ? leafTotal > 0 && viewedLeafCount >= leafTotal
        : Number(meta.viewCount) > 0 && !Number(meta.viewOffset);
    const { ids, ratings } = mapRatings(meta);
    return {
        ratingKey: String(meta.ratingKey || ''),
        title: String(meta.title || meta.grandparentTitle || 'Untitled'),
        showTitle: meta.grandparentTitle || null,
        seasonTitle: meta.parentTitle || null,
        type,
        year: meta.year ? Number(meta.year) : null,
        summary: String(meta.summary || ''),
        thumb: imageUrl(meta.thumb || meta.parentThumb || meta.grandparentThumb, 300, music ? 300 : 450),
        ...(music ? { cardAspect: 'square' as const } : {}),
        art: imageUrl(meta.art || meta.grandparentArt, 1920, 1080),
        backdropArt: imageUrl(heroBackdropPath(meta, type), 1920, 1080, { crop: false }),
        logo: imageUrl(clearLogo(meta), 640, 240),
        durationMs: meta.duration ? Number(meta.duration) : null,
        viewOffsetMs: Number(meta.viewOffset) || 0,
        index: meta.index != null ? Number(meta.index) : null,
        parentIndex: meta.parentIndex != null ? Number(meta.parentIndex) : null,
        leafCount: meta.leafCount != null ? Number(meta.leafCount) : null,
        viewedLeafCount,
        childCount: meta.childCount != null ? Number(meta.childCount) : null,
        parentRatingKey: meta.parentRatingKey ? String(meta.parentRatingKey) : null,
        grandparentRatingKey: meta.grandparentRatingKey ? String(meta.grandparentRatingKey) : null,
        contentRating: meta.contentRating || null,
        audienceRating: meta.audienceRating != null ? Number(meta.audienceRating) : null,
        ratings,
        externalIds: ids,
        tmdbId: ids.tmdb,
        originallyAvailableAt: meta.originallyAvailableAt || null,
        genres: asList<PlexMeta>(meta.Genre).map((row) => String(row.tag || '')).filter(Boolean),
        addedAt: meta.addedAt ? Number(meta.addedAt) * 1000 : null,
        lastViewedAt: meta.lastViewedAt ? Number(meta.lastViewedAt) * 1000 : null,
        viewCount: Number(meta.viewCount) || 0,
        watched,
        canPlay: type === 'movie' || type === 'episode' || type === 'show' || type === 'season',
        tagline: meta.tagline || '',
        studio: meta.studio || '',
        librarySectionID: meta.librarySectionID ? String(meta.librarySectionID) : null,
        serverId: mapServer?.id || null,
        directors: asList<PlexMeta>(meta.Director).map((row) => String(row.tag || '')).filter(Boolean),
        writers: asList<PlexMeta>(meta.Writer).map((row) => String(row.tag || '')).filter(Boolean),
        directorPeople: asList<PlexMeta>(meta.Director).map((row) => ({
            id: String(row.id || row.tag || ''),
            name: String(row.tag || ''),
            role: '',
            thumb: imageUrl(row.thumb, 300, 450),
        })),
        writerPeople: asList<PlexMeta>(meta.Writer).map((row) => ({
            id: String(row.id || row.tag || ''),
            name: String(row.tag || ''),
            role: '',
            thumb: imageUrl(row.thumb, 300, 450),
        })),
        cast: asList<PlexMeta>(meta.Role).slice(0, 24).map((row) => ({
            id: String(row.id || row.tag || ''),
            name: String(row.tag || ''),
            role: String(row.role || ''),
            thumb: imageUrl(row.thumb, 300, 450),
        })),
        mediaInfo: medias.map((media, index) => {
            const part = asList<PlexMeta>(media.Part)[0] || {};
            const streams = mapStreams(part);
            return {
                id: String(media.id || index),
                container: media.container || part.container || null,
                bitrate: media.bitrate ? Number(media.bitrate) : null,
                width: media.width ? Number(media.width) : null,
                height: media.height ? Number(media.height) : null,
                videoResolution: media.videoResolution || null,
                videoCodec: media.videoCodec || streams.video.codec || null,
                audioCodec: media.audioCodec || streams.audio[0]?.codec || null,
                audioChannels: media.audioChannels ? Number(media.audioChannels) : null,
                durationMs: media.duration ? Number(media.duration) : null,
                parts: [{
                    id: String(part.id || index),
                    fileName: String(part.file || '').split('/').pop() || '',
                    size: part.size ? Number(part.size) : null,
                    container: part.container || null,
                    durationMs: part.duration ? Number(part.duration) : null,
                    video: {
                        codec: streams.video.codec || null,
                        displayTitle: streams.video.displayTitle || null,
                        width: streams.video.width ? Number(streams.video.width) : null,
                        height: streams.video.height ? Number(streams.video.height) : null,
                    },
                    audio: streams.audio.map((stream) => ({
                        id: String(stream.id || ''),
                        codec: stream.codec || null,
                        displayTitle: stream.displayTitle || stream.language || null,
                        channels: stream.channels ? Number(stream.channels) : null,
                        language: stream.language || stream.languageTag || null,
                        languageTag: stream.languageTag || stream.languageCode || null,
                        selected: stream.selected === 1 || stream.selected === true,
                    })),
                    subtitles: streams.subtitles.map((stream) => ({
                        id: String(stream.id || ''),
                        codec: stream.codec || null,
                        displayTitle: stream.displayTitle || stream.language || null,
                        language: stream.language || stream.languageTag || null,
                        languageTag: stream.languageTag || stream.languageCode || null,
                        forced: stream.forced === 1 || stream.forced === true,
                        selected: stream.selected === 1 || stream.selected === true,
                    })),
                }],
            };
        }),
        versions: medias.map((media, index) => ({
            id: String(media.id || index),
            mediaIndex: index,
            label: media.videoResolution ? `${media.videoResolution}p` : `Version ${index + 1}`,
            resolution: media.videoResolution || null,
            videoCodec: media.videoCodec || null,
            audioCodec: media.audioCodec || null,
            container: media.container || null,
            bitrate: media.bitrate ? Number(media.bitrate) : null,
            width: media.width ? Number(media.width) : null,
            height: media.height ? Number(media.height) : null,
        })),
        markers: mapMarkers(meta),
    };
};

const mapMarkers = (meta: PlexMeta) => {
    const markers = asList<PlexMeta>(meta.Marker).concat(asList<PlexMeta>(meta.marker));
    const pick = (type: string) => {
        const marker = markers.find((row) => String(row.type || '').toLowerCase() === type);
        if (!marker) return null;
        const startMs = Number(marker.startTimeOffset ?? marker.start) || 0;
        const endMs = Number(marker.endTimeOffset ?? marker.end) || 0;
        if (endMs <= startMs) return null;
        return { startMs, endMs };
    };
    return { intro: pick('intro'), credits: pick('credits') };
};

const mapList = (data: any) => {
    const container = containerOf(data);
    const seen = new Set<string>();
    return asList<PlexMeta>(container.Metadata)
        .concat(asList<PlexMeta>(container.Video))
        .concat(asList<PlexMeta>(container.Directory))
        .map((meta) => {
            const item = mapItem(meta);
            if (item.ratingKey) rememberItem(item.ratingKey, mapServer);
            return item;
        })
        .filter((item) => {
            if (!item.ratingKey || seen.has(item.ratingKey)) return false;
            seen.add(item.ratingKey);
            return true;
        });
};

const mapSections = (data: any) => asList<PlexMeta>(containerOf(data).Directory)
    .filter((row) => row.key && row.title)
    .map((row) => ({
        key: String(row.key),
        title: String(row.title),
        type: String(row.type || 'movie'),
        agent: row.agent || '',
    }));

const mapFirstCharacters = (data: any) => {
    const rows = asList<PlexMeta>(containerOf(data).Directory).map((row) => {
        const title = String(row.title || '').trim();
        const key = String(row.key || '').trim();
        const fast = String(row.fastKey || '');
        const fromFast = fast.match(/[?&]firstCharacter=([^&]+)/i);
        const value = fromFast
            ? decodeURIComponent(fromFast[1])
            : (key && !key.startsWith('/') ? key : title);
        const fromCode = /^\d+$/.test(value) && Number(value) >= 32 && Number(value) < 127
            ? String.fromCharCode(Number(value))
            : '';
        const label = title && title.length <= 3
            ? title
            : (fromCode || value.slice(0, 2));
        const jump = label.length === 1
            ? label.toUpperCase()
            : (label === '#' ? '#' : (fromCode || value));
        return { key: jump, title: label.length === 1 ? label.toUpperCase() : (label || jump) };
    }).filter((row) => row.key && row.title && row.key.length <= 8 && !/[&=\s]/.test(row.key));
    const seen = new Set<string>();
    return rows.filter((row) => {
        if (seen.has(row.key)) return false;
        seen.add(row.key);
        return true;
    }).sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }));
};

/** "The Matrix" is filed under M. */
const sortTitleHead = (title?: string | null) => String(title || '').replace(/^(the|a|an)\s+/i, '').trim();

const letterCharOf = (raw: string) => {
    const value = String(raw || '').trim();
    if (!value || value.length > 8 || /[&=\s/]/.test(value)) return '';
    if (/^\d+$/.test(value)) {
        const code = Number(value);
        return code >= 32 && code < 127 ? String.fromCharCode(code) : '';
    }
    return value;
};

const letterRank = (letter: string) => {
    const ch = String(letter || '').trim().toUpperCase();
    if (ch >= 'A' && ch <= 'Z') return ch.charCodeAt(0) - 64;
    return 0;
};

const titleLetterRank = (title?: string | null) => {
    const head = sortTitleHead(title).charAt(0).toUpperCase();
    return head >= 'A' && head <= 'Z' ? head.charCodeAt(0) - 64 : 0;
};

/** Absolute library index where a title-sort letter begins. Keyed by server, section, and letter. */
const letterOriginCache = new Map<string, number>();

/** Plex /all without a type returns seasons or nothing for TV libraries. */
const sectionAllType = (type: string) => {
    if (type === 'show') return '2';
    if (type === 'movie') return '1';
    if (type === 'artist') return '8';
    return '';
};

/**
 * A library /all with no type, or type 3/4, makes PMS walk every season or episode.
 * That has crashed the server. Only movie (1), show (2), and artist (8) lists are allowed.
 */
const guardSectionAll = (pathAndQuery: string): string | null => {
    const cut = pathAndQuery.indexOf('?');
    const path = (cut >= 0 ? pathAndQuery.slice(0, cut) : pathAndQuery).replace(/\/+$/, '');
    if (!/\/library\/sections\/[^/]+\/all$/.test(path)) {
        if (/\/library\/sections\/[^/]+\/allLeaves$/.test(path)) return null;
        return pathAndQuery;
    }
    const params = new URLSearchParams(cut >= 0 ? pathAndQuery.slice(cut + 1) : '');
    const type = params.get('type') || '';
    // 18 is a collection list, not seasons or episodes.
    if (type !== '1' && type !== '2' && type !== '8' && type !== '18') return null;
    const size = Number(params.get('X-Plex-Container-Size') || params.get('count') || 0);
    const maxSize = type === '18' ? 200 : 80;
    if (!Number.isFinite(size) || size <= 0) params.set('X-Plex-Container-Size', '50');
    else if (size > maxSize) params.set('X-Plex-Container-Size', String(maxSize));
    return `${path}?${params.toString()}`;
};

const accountToken = () => getSessionToken();

const pms = async (
    pathAndQuery: string,
    server: PlexServer | null = mapServer || readServer(),
    timeoutMs = 8000,
    extraHeaders?: Record<string, string>,
) => {
    if (!server) throw new Error('No Plex server selected');
    const safePath = guardSectionAll(pathAndQuery);
    if (!safePath) return null;
    const path = safePath.startsWith('/') ? safePath : `/${safePath}`;
    const url = new URL(path, server.uri.endsWith('/') ? server.uri : `${server.uri}/`);
    if (!url.searchParams.get('X-Plex-Token')) url.searchParams.set('X-Plex-Token', server.accessToken);
    const controller = new AbortController();
    let timer = 0;
    try {
        return await Promise.race([
            plexFetch(url.toString(), server.accessToken, {
                signal: controller.signal,
                headers: extraHeaders,
            }),
            new Promise((_, reject) => {
                timer = window.setTimeout(() => {
                    controller.abort();
                    reject(new Error('Plex server took too long to respond'));
                }, timeoutMs);
            }),
        ]);
    } finally {
        if (timer) window.clearTimeout(timer);
    }
};

const probe = (uri: string, token: string) => new Promise<boolean>((resolve) => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
        controller.abort();
        resolve(false);
    }, 1600);
    fetch(`${uri.replace(/\/+$/, '')}/identity`, {
        headers: plexHeaders(token),
        signal: controller.signal,
        cache: 'no-store',
    }).then((response) => {
        window.clearTimeout(timer);
        resolve(response.ok);
    }).catch(() => {
        window.clearTimeout(timer);
        resolve(false);
    });
});


const isRelayConnection = (connection: PlexMeta) => connection.relay === true || connection.relay === 1;
const isLocalConnection = (connection: PlexMeta) => (
    (connection.local === true || connection.local === 1) && !isRelayConnection(connection)
);
const isHttpsConnection = (connection: PlexMeta) => (
    connection.protocol === 'https' || String(connection.uri || '').startsWith('https')
);

const connectionTarget = (connection: PlexMeta, id: string, name: string, accessToken: string): PlexServer | null => {
    const uri = String(connection.uri || '').replace(/\/+$/, '');
    if (!uri) return null;
    return { id, name, uri, accessToken };
};

const firstOf = (connections: PlexMeta[], id: string, name: string, accessToken: string) => new Promise<PlexServer | null>((resolve) => {
    const jobs = connections
        .map((connection) => connectionTarget(connection, id, name, accessToken))
        .filter((server): server is PlexServer => !!server);
    if (!jobs.length) {
        resolve(null);
        return;
    }
    let pending = jobs.length;
    let settled = false;
    for (const server of jobs) {
        void probe(server.uri, accessToken).then((ok) => {
            if (settled) return;
            if (ok) {
                settled = true;
                resolve(server);
                return;
            }
            pending -= 1;
            if (pending <= 0) resolve(null);
        });
    }
});

const firstReachable = async (resource: PlexMeta, token: string): Promise<PlexServer | null> => {
    const id = String(resource.clientIdentifier || resource.machineIdentifier || resource.name || '').trim();
    if (!id) return null;
    const accessToken = String(resource.accessToken || token);
    const name = String(resource.name || 'Plex');
    const connections = asList<PlexMeta>(resource.connections);
    const picked: PlexMeta[] = [];
    const take = (match: (connection: PlexMeta) => boolean) => {
        const hit = connections.find((connection) => match(connection) && !picked.includes(connection));
        if (hit) picked.push(hit);
    };
    take((connection) => isLocalConnection(connection) && isHttpsConnection(connection));
    take((connection) => !isLocalConnection(connection) && !isRelayConnection(connection) && isHttpsConnection(connection));
    const preferred = await firstOf(picked, id, name, accessToken);
    if (preferred) return preferred;
    const extra: PlexMeta[] = [];
    const takeExtra = (match: (connection: PlexMeta) => boolean) => {
        const hit = connections.find((connection) => match(connection) && !picked.includes(connection) && !extra.includes(connection));
        if (hit) extra.push(hit);
    };
    takeExtra((connection) => isLocalConnection(connection));
    takeExtra((connection) => !isRelayConnection(connection));
    return firstOf(extra, id, name, accessToken);
};

const discoverServers = async (token: string) => {
    const controller = new AbortController();
    let timer = 0;
    let data: any;
    try {
        data = await Promise.race([
            plexFetch(`${PLEX_TV}/api/v2/resources?includeHttps=1&includeRelay=1`, token, { signal: controller.signal }),
            new Promise((_, reject) => {
                timer = window.setTimeout(() => {
                    controller.abort();
                    reject(new Error('Plex took too long to list servers'));
                }, 8000);
            }),
        ]);
    } finally {
        if (timer) window.clearTimeout(timer);
    }
    const resources = asList<PlexMeta>(data).filter((resource) => (
        String(resource.provides || '').includes('server')
        && String(resource.product || '') === 'Plex Media Server'
    ));
    const found = (await Promise.all(resources.map((resource) => firstReachable(resource, token)))).filter((server): server is PlexServer => !!server);
    if (!found.length) {
        const relays = await Promise.all(resources.map(async (resource) => {
            const relay = asList<PlexMeta>(resource.connections).find((connection) => isRelayConnection(connection));
            const id = String(resource.clientIdentifier || resource.machineIdentifier || resource.name || '').trim();
            const uri = String(relay?.uri || '').replace(/\/+$/, '');
            if (!id || !uri) return null;
            const accessToken = String(resource.accessToken || token);
            if (!await probe(uri, accessToken)) return null;
            return { id, name: String(resource.name || 'Plex'), uri, accessToken };
        }));
        found.push(...relays.filter((server): server is PlexServer => !!server));
    }
    if (!found.length) throw new Error('Signed in, but no Plex server was reachable from this device.');
    const previous = readServerList();
    const enabledIds = previous.enabledIds.filter((id) => found.some((server) => server.id === id));
    writeServerList(found, enabledIds);
    return found;
};

beginServerDiscovery = (token: string) => {
    if (!serversPromise) {
        serversPromise = discoverServers(token).catch((err) => {
            serversPromise = null;
            throw err;
        });
    }
    return serversPromise;
};

export const selectPlexServer = async (token: string) => {
    const servers = await beginServerDiscovery(token);
    if (!servers.length) throw new Error('Signed in, but no Plex server was reachable from this device.');
    return servers[0];
};

const readSettings = (): PlayerSettings => {
    try {
        const raw = localStorage.getItem(SETTINGS_KEY);
        if (!raw) return { ...DEFAULT_PLAYER_SETTINGS };
        return { ...DEFAULT_PLAYER_SETTINGS, ...JSON.parse(raw) };
    } catch {
        return { ...DEFAULT_PLAYER_SETTINGS };
    }
};

const QUALITIES = [
    { id: 'original', label: 'Original', videoResolution: 'original', maxVideoBitrate: 200000, videoQuality: 100 },
    { id: '1080-20', label: '1080p · 20 Mbps', videoResolution: '1080', maxVideoBitrate: 20000, videoQuality: 80 },
    { id: '1080-8', label: '1080p · 8 Mbps', videoResolution: '1080', maxVideoBitrate: 8000, videoQuality: 60 },
    { id: '720-4', label: '720p · 4 Mbps', videoResolution: '720', maxVideoBitrate: 4000, videoQuality: 60 },
    { id: '480-1.5', label: '480p · 1.5 Mbps', videoResolution: '480', maxVideoBitrate: 1500, videoQuality: 40 },
];

const pickAudioId = (audio: PlexMeta[], requested: string, language: string) => {
    const want = String(requested || '').replace(/\D/g, '');
    if (want && audio.some((stream) => String(stream.id || '') === want)) return want;
    const lang = String(language || '').toLowerCase().trim();
    if (lang) {
        const langBase = lang.split(/[-_]/)[0];
        const match = audio.find((stream) => {
            const blob = String(stream.languageTag || stream.languageCode || stream.language || '').toLowerCase();
            return blob === lang || blob.startsWith(langBase) || blob.includes(langBase);
        });
        if (match?.id) return String(match.id);
    }
    const selected = audio.find((stream) => stream.selected === 1 || stream.selected === true);
    return String(selected?.id || audio[0]?.id || '');
};

const pickSubtitleId = (subtitles: PlexMeta[], requested: string | null, mode: string) => {
    if (requested != null) {
        const raw = String(requested).trim();
        // "0" is Off. A missing match must stay off, or a seek turns forced subs back on.
        if (!raw || raw === '0') return '';
        const want = raw.replace(/\D/g, '');
        if (!want || want === '0') return '';
        if (subtitles.some((stream) => String(stream.id || '') === want)) return want;
        return '';
    }
    if (mode === 'off') return '';
    if (mode === 'forced') {
        const forced = subtitles.find((stream) => stream.forced === 1 || stream.forced === true);
        return forced?.id ? String(forced.id) : '';
    }
    const selected = subtitles.find((stream) => stream.selected === 1 || stream.selected === true);
    return String(selected?.id || subtitles[0]?.id || '');
};

const playSrc = (meta: PlexMeta, mediaIndex: number, qualityId: string, audioStreamId = '', subtitleStreamId = '', offsetMs = 0, forceHls = false) => {
    const server = mapServer || readServer();
    if (!server) throw new Error('No Plex server selected');
    const medias = asList<PlexMeta>(meta.Media);
    const media = medias[mediaIndex] || medias[0];
    const part = asList<PlexMeta>(media?.Part)[0];
    if (!part) throw new Error('This title has no playable file');
    const quality = QUALITIES.find((row) => row.id === qualityId);
    const audioId = String(audioStreamId || '').replace(/\D/g, '');
    const subtitleId = String(subtitleStreamId || '').replace(/\D/g, '');
    const selectedAudio = asList<PlexMeta>(part.Stream).find((stream) => Number(stream.streamType) === 2 && (stream.selected === 1 || stream.selected === true));
    const defaultAudioId = String(selectedAudio?.id || asList<PlexMeta>(part.Stream).find((stream) => Number(stream.streamType) === 2)?.id || '').replace(/\D/g, '');
    const direct = !forceHls && (!quality || quality.id === 'original') && !subtitleId && (!audioId || audioId === defaultAudioId);
    if (direct && part.key) {
        const rawKey = String(part.key);
        const filePath = rawKey.startsWith('http') ? new URL(rawKey).pathname : rawKey;
        const url = new URL(filePath.startsWith('/') ? filePath : `/${filePath}`, `${server.uri}/`);
        url.searchParams.set('X-Plex-Token', server.accessToken);
        url.searchParams.set('X-Plex-Client-Identifier', clientId());
        url.searchParams.set('X-Plex-Product', 'StreamPilot');
        url.searchParams.set('X-Plex-Platform', 'Android');
        url.searchParams.set('X-Plex-Device', 'Android TV');
        return { src: url.toString(), mode: 'directPlay' as const, media, part };
    }
    const url = new URL('/video/:/transcode/universal/start.m3u8', `${server.uri}/`);
    const offsetSec = Math.max(0, Math.floor(Number(offsetMs) / 1000));
    const session = `smp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const params: Record<string, string> = {
        hasMDE: '1',
        path: `/library/metadata/${meta.ratingKey}`,
        mediaIndex: String(medias.indexOf(media) >= 0 ? medias.indexOf(media) : 0),
        partIndex: '0',
        protocol: 'hls',
        fastSeek: '1',
        directPlay: '0',
        directStream: subtitleId || (quality && quality.id !== 'original') ? '0' : '1',
        subtitleSize: subtitleId ? '100' : '0',
        subtitles: subtitleId ? 'burn' : 'none',
        advancedSubtitles: subtitleId ? 'burn' : 'none',
        session,
        ...(offsetSec > 0 ? { offset: String(offsetSec) } : {}),
        ...(audioId ? { audioStreamID: audioId } : {}),
        subtitleStreamID: subtitleId || '0',
        audioBoost: '100',
        videoQuality: String(quality?.videoQuality || 60),
        videoResolution: quality?.videoResolution || '720',
        maxVideoBitrate: String(quality?.maxVideoBitrate || 4000),
        'X-Plex-Platform': 'Android',
        'X-Plex-Client-Identifier': clientId(),
        'X-Plex-Product': 'StreamPilot',
        'X-Plex-Device': 'Android TV',
        'X-Plex-Session-Identifier': session,
        'X-Plex-Token': server.accessToken,
        access_token: server.accessToken,
    };
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
    return { src: url.toString(), mode: 'transcode' as const, media, part };
};

const withMapServer = async <T,>(server: PlexServer | null, run: () => Promise<T>) => {
    const previous = mapServer;
    mapServer = server;
    try {
        return await run();
    } finally {
        mapServer = previous;
    }
};

const metadata = async (ratingKey: string, server: PlexServer | null = resolveServer('', ratingKey)) => {
    const data = await pms(`/library/metadata/${encodeURIComponent(ratingKey)}?includeGuids=1&includeMarkers=1&includeChapters=1&includeOnDeck=1`, server);
    const meta = asList<PlexMeta>(containerOf(data).Metadata)[0];
    if (!meta) throw new Error('Title not found');
    return meta;
};

const childrenOf = async (ratingKey: string, server: PlexServer | null = resolveServer('', ratingKey)) => withMapServer(server, async () => {
    const data = await pms(`/library/metadata/${encodeURIComponent(ratingKey)}/children?X-Plex-Container-Size=200`, server);
    return mapList(data);
});

/** Next unwatched episode for a show/season, else the first episode. */
const resolvePlayableEpisode = async (ratingKey: string, server: PlexServer, seedType?: string) => {
    const type = String(seedType || '').toLowerCase();
    if (type && type !== 'show' && type !== 'season') return null;
    const unwatched = await pms(
        `/library/metadata/${encodeURIComponent(ratingKey)}/allLeaves?unwatched=1&X-Plex-Container-Start=0&X-Plex-Container-Size=1`,
        server,
    ).catch(() => null);
    const next = mapList(unwatched)[0];
    if (next?.type === 'episode') return next;
    const first = await pms(
        `/library/metadata/${encodeURIComponent(ratingKey)}/allLeaves?X-Plex-Container-Start=0&X-Plex-Container-Size=1`,
        server,
    ).catch(() => null);
    const row = mapList(first)[0];
    return row?.type === 'episode' ? row : null;
};

type HomeUser = {
    id: string;
    uuid: string;
    title: string;
    username: string;
    thumb: string | null;
    restricted: boolean;
    admin: boolean;
    protected: boolean;
};

const storedValue = (key: string) => {
    try { return String(localStorage.getItem(key) || '').trim(); } catch { return ''; }
};

const writeStoredValue = (key: string, value: string) => {
    try {
        if (value) localStorage.setItem(key, value);
        else localStorage.removeItem(key);
        void mirrorAuthToNativeStorage(key, value);
    } catch { /* ignore */ }
};

const readOwnerToken = () => storedValue(STORAGE_PLEX_OWNER_TOKEN) || accountToken();
const writeOwnerToken = (token: string) => writeStoredValue(STORAGE_PLEX_OWNER_TOKEN, token);
const readHomeUserId = () => storedValue(STORAGE_PLEX_HOME_USER);
const writeHomeUserId = (id: string) => writeStoredValue(STORAGE_PLEX_HOME_USER, id);

const truthy = (value: unknown) => value === true || value === 1 || /^(1|true|yes)$/i.test(String(value || '').trim());

const normalizeHomeUser = (raw: PlexMeta | null | undefined): HomeUser | null => {
    if (!raw) return null;
    const id = String(raw.id || raw.userID || raw.userId || '').trim();
    if (!id) return null;
    return {
        id,
        uuid: String(raw.uuid || '').trim(),
        title: String(raw.title || raw.friendlyName || raw.username || raw.name || 'Plex User').trim(),
        username: String(raw.username || '').trim(),
        thumb: String(raw.thumb || raw.avatar || '').trim() || null,
        restricted: truthy(raw.restricted),
        admin: truthy(raw.admin),
        protected: truthy(raw.protected),
    };
};

const publicHomeUser = (user: HomeUser) => ({
    id: user.id,
    uuid: user.uuid,
    title: user.title,
    username: user.username,
    thumb: user.thumb,
    restricted: user.restricted,
    admin: user.admin,
    protected: user.protected,
});

const parseHomeUsers = (payload: any): HomeUser[] => {
    const lists = [
        payload,
        payload?.users,
        payload?.User,
        payload?.MediaContainer?.User,
        payload?.MediaContainer?.users,
    ];
    for (const candidate of lists) {
        if (candidate == null) continue;
        const users = asList<PlexMeta>(candidate).map(normalizeHomeUser).filter((user): user is HomeUser => !!user);
        if (users.length) return users;
    }
    return [];
};

const parseHomeUsersXml = (xml: string): HomeUser[] => {
    const users: HomeUser[] = [];
    const re = /<User\b([^>]*)\/?>/gi;
    let match: RegExpExecArray | null;
    while ((match = re.exec(xml))) {
        const attrs: PlexMeta = {};
        const attrRe = /([A-Za-z_:][\w:.-]*)\s*=\s*"([^"]*)"/g;
        let attr: RegExpExecArray | null;
        while ((attr = attrRe.exec(match[1]))) attrs[attr[1]] = attr[2];
        const user = normalizeHomeUser(attrs);
        if (user) users.push(user);
    }
    return users;
};

const fetchHomeUsers = async (token: string): Promise<HomeUser[]> => {
    const load = async (url: string) => {
        const response = await fetch(url, { headers: plexHeaders(token), cache: 'no-store' });
        if (!response.ok) return [];
        const raw = await response.text();
        try {
            const parsed = JSON.parse(raw);
            const users = parseHomeUsers(parsed);
            if (users.length) return users;
        } catch { /* XML */ }
        return parseHomeUsersXml(raw);
    };
    const v2 = await load(`${PLEX_TV}/api/v2/home/users`).catch(() => []);
    if (v2.length) return v2;
    return load(`${PLEX_TV}/api/home/users`).catch(() => []);
};

const sameHomeUser = (user: HomeUser, targetId: string) => {
    const want = String(targetId || '').trim();
    return !!want && (user.id === want || user.uuid === want);
};

const switchHomeProfile = async (userId: string, pin?: string) => {
    const owner = readOwnerToken();
    if (!owner) throw new Error('Sign in with Plex again to switch profiles.');
    const users = await fetchHomeUsers(owner);
    const target = users.find((user) => sameHomeUser(user, userId));
    if (!target) throw new Error('That Plex Home profile is no longer available.');
    if (target.admin && !target.protected) {
        await selectPlexServer(owner);
        writeHomeUserId(target.id);
        writeStoredSessionToken(owner);
        return owner;
    }
    const params = new URLSearchParams();
    const pinValue = String(pin || '').trim();
    if (pinValue) params.set('pin', pinValue);
    const qs = params.toString();
    const response = await fetch(
        `${PLEX_TV}/api/home/users/${encodeURIComponent(target.id)}/switch${qs ? `?${qs}` : ''}`,
        { method: 'POST', headers: plexHeaders(owner), cache: 'no-store' },
    );
    const raw = await response.text().catch(() => '');
    if (response.status === 401 || response.status === 403) {
        throw new Error(target.protected ? 'Enter the PIN for this profile.' : 'Could not switch to that Plex Home profile.');
    }
    if (!response.ok) throw new Error('Could not switch to that Plex Home profile.');
    let authToken = '';
    try {
        const parsed = JSON.parse(raw);
        authToken = String(
            parsed?.authToken
            || parsed?.authenticationToken
            || parsed?.user?.authToken
            || parsed?.user?.authenticationToken
            || parsed?.User?.authToken
            || parsed?.User?.authenticationToken
            || '',
        ).trim();
    } catch { /* XML */ }
    if (!authToken) {
        const match = raw.match(/\b(?:authenticationToken|authToken)="([^"]+)"/i);
        authToken = match ? match[1] : '';
    }
    if (!authToken) throw new Error('Could not switch to that Plex Home profile.');
    await selectPlexServer(authToken);
    writeHomeUserId(target.id);
    writeStoredSessionToken(authToken);
    return authToken;
};

const handleAuth = async (path: string, method: string, body: any) => {
    if (path === '/api/auth/plex/login' && method === 'POST') {
        // strong=true is the long code for the website redirect. plex.tv/link only accepts the short PIN.
        const wantLinkCode = body?.linkCode === true || body?.strong === false;
        const data = await plexFetch(
            wantLinkCode ? `${PLEX_TV}/api/v2/pins` : `${PLEX_TV}/api/v2/pins?strong=true`,
            undefined,
            { method: 'POST' },
        );
        const code = String(data?.code || '').trim().toUpperCase();
        if (wantLinkCode && code.length > 6) {
            throw new Error('Plex returned a code that plex.tv/link will not accept. Try again.');
        }
        return {
            id: data?.id,
            code,
            oauthState: 'direct',
            clientIdentifier: clientId(),
            linkCode: wantLinkCode,
        };
    }
    if (path === '/api/auth/plex/callback' && method === 'POST') {
        const pinId = String(body?.pinId || '');
        let data: any = null;
        try {
            data = await plexFetch(`${PLEX_TV}/api/v2/pins/${encodeURIComponent(pinId)}`, undefined);
        } catch (err: any) {
            // plex.tv returns 404 until the code is entered, and again if a poll races the link.
            if (err?.status === 404 || /not found|expired/i.test(String(err?.message || ''))) return { pending: true };
            throw err;
        }
        const token = String(data?.authToken || '').trim();
        if (!token) return { pending: true };
        writeStoredSessionToken(token);
        writeOwnerToken(token);
        const users = await fetchHomeUsers(token).catch(() => [] as HomeUser[]);
        if (users.length > 1) {
            const admin = users.find((user) => user.admin) || users[0];
            writeHomeUserId(admin.id);
            return {
                needsHomeSelect: true,
                users: users.map(publicHomeUser),
                homeSelectToken: 'direct',
                rememberUserId: admin.id,
            };
        }
        if (users[0]) writeHomeUserId(users[0].id);
        try {
            await selectPlexServer(token);
        } catch (err) {
            writeStoredSessionToken('');
            writeOwnerToken('');
            throw err;
        }
        return { sessionToken: token };
    }
    if (path === '/api/auth/session') {
        const token = accountToken();
        if (!token) return { authenticated: false };
        try {
            const user = await plexFetch(`${PLEX_TV}/api/v2/user`, token);
            if (!readServer()) await selectPlexServer(token);
            return {
                authenticated: true,
                username: user?.username || user?.title || user?.friendlyName || '',
            };
        } catch {
            if (token && readServer()) return { authenticated: true, username: '' };
            return { authenticated: false };
        }
    }
    if (path === '/api/auth/logout') {
        serversPromise = null;
        writeServer(null);
        writeStoredSessionToken('');
        writeOwnerToken('');
        writeHomeUserId('');
        return { ok: true };
    }
    if (path === '/api/auth/plex/home-profiles') {
        const owner = readOwnerToken();
        if (!owner) return { available: false, users: [], currentUserId: null };
        if (!storedValue(STORAGE_PLEX_OWNER_TOKEN)) writeOwnerToken(owner);
        const users = await fetchHomeUsers(owner).catch(() => [] as HomeUser[]);
        return {
            available: users.length > 1,
            users: users.map(publicHomeUser),
            currentUserId: readHomeUserId() || users.find((user) => user.admin)?.id || null,
            rememberUserId: null,
        };
    }
    if ((path === '/api/auth/plex/home-profiles/switch' || path === '/api/auth/plex/home-switch') && method === 'POST') {
        const userId = String(body?.userId || '').trim();
        if (!userId) throw new Error('Select a Plex Home profile.');
        const authToken = await switchHomeProfile(userId, body?.pin);
        return { sessionToken: authToken, ok: true };
    }
    return { ok: true };
};

const splitLibraryKey = (raw: string) => {
    const key = decodeURIComponent(raw);
    const cut = key.indexOf('::');
    if (cut <= 0) return { server: resolveServer(''), section: key, path: key };
    const server = resolveServer(key.slice(0, cut));
    const rest = key.slice(cut + 2);
    return { server, section: rest, path: rest };
};

const continueHub = (hub: { identifier?: string; title?: string }) => (
    /continue|ondeck/i.test(`${hub.identifier || ''} ${hub.title || ''}`)
);

/** Live episode artwork. On Deck keeps the thumb from when the row was built. */
const currentEpisodeThumbPath = (meta: PlexMeta) => {
    const ratingKey = String(meta.ratingKey || '').replace(/\D/g, '');
    const raw = String(meta.thumb || '').trim().split('?')[0];
    if (raw.startsWith('/library/metadata/') && /\/thumb\/\d+/.test(raw)) return raw;
    const stamp = String(meta.updatedAt || '').replace(/\D/g, '');
    if (ratingKey && stamp) return `/library/metadata/${ratingKey}/thumb/${stamp}`;
    if (raw.startsWith('/library/')) return raw;
    return ratingKey ? `/library/metadata/${ratingKey}/thumb` : '';
};

const refreshContinueEpisodeThumbs = async (
    items: Array<ReturnType<typeof mapItem>>,
    server: PlexServer,
) => {
    const ids = [...new Set(items
        .filter((item) => item.type === 'episode')
        .map((item) => String(item.ratingKey || '').replace(/\D/g, ''))
        .filter(Boolean))];
    if (!ids.length) return items;
    const data = await pms(`/library/metadata/${ids.join(',')}?includeGuids=0`, server, 8000).catch(() => null);
    const fresh = new Map<string, { thumb: string; title: string }>();
    for (const meta of asList<PlexMeta>(containerOf(data).Metadata)) {
        const id = String(meta.ratingKey || '').replace(/\D/g, '');
        const thumb = currentEpisodeThumbPath(meta);
        if (!id || !thumb) continue;
        fresh.set(id, { thumb, title: String(meta.title || '').trim() });
    }
    if (!fresh.size) return items;
    return items.map((item) => {
        if (item.type !== 'episode') return item;
        const id = String(item.ratingKey || '').replace(/\D/g, '');
        const row = fresh.get(id);
        if (!row) return item;
        return {
            ...item,
            episodeThumb: row.thumb,
            episodeTitle: row.title || item.episodeTitle || null,
        };
    });
};

const collapseRecentShows = (items: ReturnType<typeof mapItem>[], identifier: string, title: string) => {
    const blob = `${identifier} ${title}`;
    if (!/recent/i.test(blob) || /continue|ondeck|on[.\s_-]?deck/i.test(blob)) return items;
    const seen = new Set<string>();
    const collapsed: ReturnType<typeof mapItem>[] = [];
    items.forEach((item) => {
        if (item.type !== 'episode' && item.type !== 'season') {
            if (!seen.has(item.ratingKey)) {
                seen.add(item.ratingKey);
                collapsed.push(item);
            }
            return;
        }
        const showKey = String(item.type === 'season' ? item.parentRatingKey : item.grandparentRatingKey || '').replace(/\D/g, '');
        const dedupe = showKey || item.ratingKey;
        if (!dedupe || seen.has(dedupe)) return;
        seen.add(dedupe);
        if (!showKey) {
            collapsed.push(item);
            return;
        }
        rememberItem(showKey, mapServer);
        collapsed.push({
            ...item,
            ratingKey: showKey,
            title: String(item.showTitle || item.seasonTitle || item.title),
            showTitle: null,
            seasonTitle: null,
            type: 'show',
            thumb: imageUrl(`/library/metadata/${showKey}/thumb`, 300, 450) || item.thumb,
            index: null,
            parentIndex: null,
            parentRatingKey: null,
            grandparentRatingKey: null,
            viewOffsetMs: 0,
            canPlay: false,
        });
    });
    return collapsed;
};

const hubRows = (hub: PlexMeta) => {
    const metadata = asList<PlexMeta>(hub.Metadata);
    if (metadata.length) return metadata;
    const video = asList<PlexMeta>(hub.Video);
    if (video.length) return video;
    return asList<PlexMeta>(hub.Directory);
};

const hubsFrom = (data: any, server: PlexServer, many: boolean) => {
    const previous = mapServer;
    mapServer = server;
    try {
        return asList<PlexMeta>(containerOf(data).Hub).map((hub) => {
            const rows = hubRows(hub);
            const identifier = String(hub.hubIdentifier || hub.key || hub.title || '');
            const title = String(hub.title || identifier || 'Hub');
            const mapped = collapseRecentShows(mapList({ MediaContainer: { Metadata: rows } }), identifier, title);
            const hubKind = String(hub.type || '').toLowerCase();
            const musicHub = /^(artist|album|track|audio)$/.test(hubKind)
                || /\b(music|artists?|albums?)\b/i.test(`${identifier} ${title}`);
            const seasonPoster = continueHub({ identifier, title }) && readHeroConfig().continueWatchingSeasonPoster;
            const items = mapped.map((item) => {
                const next = musicHub ? { ...item, cardAspect: 'square' as const } : item;
                return seasonPoster && next.type === 'episode' ? { ...next, preferSeasonPoster: true } : next;
            });
            const rawKey = String(hub.key || hub.hubKey || '').trim();
            const listPath = /^https?:\/\//i.test(rawKey)
                ? (() => { try { const url = new URL(rawKey); return `${url.pathname}${url.search}`; } catch { return ''; } })()
                : (rawKey.startsWith('/') ? rawKey : '');
            const pathOnly = listPath.split('?')[0];
            const hubPath = pathOnly.startsWith('/library/') || pathOnly.startsWith('/hubs/') || pathOnly.startsWith('/playlists')
                ? listPath
                : '';
            return {
                title: String(hub.title || identifier || 'Hub'),
                identifier,
                items,
                hubKey: hubPath ? (many ? `${server.id}::${hubPath}` : hubPath) : null,
                serverId: server.id,
            };
        }).filter((hub) => hub.items.length && hub.title);
    } finally {
        mapServer = previous;
    }
};

const mapPool = async <T, R>(rows: T[], limit: number, run: (row: T) => Promise<R>): Promise<R[]> => {
    const out: R[] = [];
    const size = Math.max(1, limit);
    for (let index = 0; index < rows.length; index += size) {
        const part = await Promise.all(rows.slice(index, index + size).map((row) => run(row)));
        out.push(...part);
    }
    return out;
};

const plexListPath = (value: unknown) => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (/^https?:\/\//i.test(raw)) {
        try {
            const url = new URL(raw);
            return `${url.pathname}${url.search}`;
        } catch {
            return '';
        }
    }
    return raw.startsWith('/') ? raw : '';
};

const fillPlexHomeHub = async (hub: PlexMeta, server: PlexServer, many: boolean) => {
    const ready = hubsFrom({ MediaContainer: { Hub: [hub] } }, server, many)[0];
    if (ready?.items?.length) return ready;
    const listPath = plexListPath(hub.key) || plexListPath(hub.hubKey);
    if (!listPath) return null;
    let parsed: URL;
    try {
        parsed = new URL(listPath, 'http://plex.local');
    } catch {
        return null;
    }
    const path = parsed.pathname.replace(/\/+$/, '');
    if (!path.startsWith('/library/') && !path.startsWith('/hubs/') && !path.startsWith('/playlists')) return null;
    const allType = parsed.searchParams.get('type') || '';
    if (/\/all$/.test(path) && allType !== '1' && allType !== '2' && allType !== '8') return null;
    if (!parsed.searchParams.get('X-Plex-Container-Size') && !parsed.searchParams.get('count')) {
        parsed.searchParams.set('X-Plex-Container-Size', '24');
    }
    const query = parsed.searchParams.toString();
    const storedPath = `${path}${query ? `?${query}` : ''}`;
    const data = await pms(storedPath, server, 6000).catch(() => null);
    const identifier = String(hub.hubIdentifier || hub.key || hub.title || '');
    const title = String(hub.title || identifier || 'Hub');
    const items = collapseRecentShows(mapList(data), identifier, title);
    if (!items.length || !title) return null;
    return {
        title,
        identifier,
        items,
        hubKey: many ? `${server.id}::${storedPath}` : storedPath,
        serverId: server.id,
    };
};

const uniquifyHubs = <T extends { identifier?: string }>(rows: T[]) => {
    const seenHub = new Set<string>();
    return rows.map((hub, index) => {
        let identifier = hub.identifier || `hub-${index}`;
        if (seenHub.has(identifier)) identifier = `${identifier}:${index}`;
        seenHub.add(identifier);
        return { ...hub, identifier };
    });
};

/** Inline hub items when Plex sent them. Otherwise fill only the pinned hub keys that came back. */
const pinnedHubs = async (data: any, server: PlexServer, many: boolean) => {
    const ready = hubsFrom(data, server, many);
    if (ready.length) return ready;
    const shells = asList<PlexMeta>(containerOf(data).Hub).slice(0, 12);
    if (!shells.length) return [];
    const filled = await mapPool(shells, 3, (hub) => fillPlexHomeHub(hub, server, many));
    return filled.filter((hub): hub is NonNullable<typeof hub> => !!hub);
};

/** Every pinned library hub, including ones Plex listed without inline items. */
const sectionPinnedHubs = async (data: any, server: PlexServer, many: boolean) => {
    const shells = asList<PlexMeta>(containerOf(data).Hub).slice(0, 16);
    if (!shells.length) return [];
    const filled = await mapPool(shells, 3, (hub) => fillPlexHomeHub(hub, server, many));
    return uniquifyHubs(filled.filter((hub): hub is NonNullable<typeof hub> => !!hub && hub.items.length > 0));
};

const collectionRatingKey = (meta: PlexMeta) => {
    const direct = String(meta.ratingKey || '').replace(/\D/g, '');
    if (direct) return direct;
    const key = String(meta.key || '');
    const fromPath = key.match(/\/collections\/(\d+)/i);
    if (fromPath?.[1]) return fromPath[1];
    if (/^\d+$/.test(key)) return key;
    return String(meta.id || '').replace(/\D/g, '');
};

const mapCollections = (data: any) => {
    const container = containerOf(data);
    const rows = asList<PlexMeta>(container.Metadata).concat(asList<PlexMeta>(container.Directory));
    const seen = new Set<string>();
    const items: ReturnType<typeof mapItem>[] = [];
    rows.forEach((meta) => {
        const ratingKey = collectionRatingKey(meta);
        const kind = String(meta.type || 'collection');
        if (!ratingKey || seen.has(ratingKey) || (kind !== 'collection' && kind !== 'mixed')) return;
        seen.add(ratingKey);
        const item = mapItem({ ...meta, ratingKey, type: 'collection' });
        item.type = 'collection';
        item.canPlay = false;
        if (!item.thumb) {
            item.thumb = imageUrl(meta.composite || `/library/collections/${ratingKey}/thumb`, 300, 450);
        }
        items.push(item);
    });
    items.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
    return items;
};

const loadServerHome = async (server: PlexServer, many: boolean, full = false) => withMapServer(server, async () => {
    const seasonPoster = readHeroConfig().continueWatchingSeasonPoster;
    // One promoted list with items inline. A second heavy hubs call only runs when this one
    // answered and had nothing — a timeout must not stack another scan on top of it.
    const [promotedResult, onDeckData, sectionsRaw] = await Promise.all([
        pms('/hubs/promoted?count=12&includeMeta=1', server, 12000)
            .then((data) => ({ data, answered: true }))
            .catch(() => ({ data: null, answered: false })),
        pms('/library/onDeck?X-Plex-Container-Size=24', server, 8000).catch(() => null),
        pms('/library/sections', server, 8000).catch(() => null),
    ]);
    const resolveHubs = async (data: any) => (
        full
            ? pinnedHubs(data, server, many)
            : hubsFrom(data, server, many)
    );
    let hubs = promotedResult.answered ? await resolveHubs(promotedResult.data) : [];
    if (!hubs.length && promotedResult.answered) {
        const homeData = await pms('/hubs/home?count=12&includeMeta=1', server, 12000).catch(() => null);
        if (homeData) hubs = await resolveHubs(homeData);
    }
    hubs = uniquifyHubs(hubs);
    const onDeckRaw = mapList(onDeckData);
    const onDeck = seasonPoster
        ? onDeckRaw.map((item) => (item.type === 'episode' ? { ...item, preferSeasonPoster: true } : item))
        : onDeckRaw;
    const watchingHubs = hubs.filter((hub) => continueHub(hub));
    const primary = watchingHubs.find((hub) => (
        /continue/i.test(`${hub.identifier} ${hub.title}`)
        && !/ondeck|on\s*deck/i.test(`${hub.identifier} ${hub.title}`)
    )) || watchingHubs[0] || null;
    const showKey = (item: ReturnType<typeof mapItem>) => {
        if (item.type === 'episode') {
            const show = String(item.grandparentRatingKey || '').replace(/\D/g, '');
            if (show) return `show:${show}`;
        }
        if (item.type === 'season') {
            const show = String(item.parentRatingKey || '').replace(/\D/g, '');
            if (show) return `show:${show}`;
        }
        return `item:${item.ratingKey}`;
    };
    const refreshed = watchingHubs.map((hub) => hub.items).filter((items) => items.length);
    if (onDeck.length) refreshed.push(onDeck);
    const seenWatching = new Set<string>();
    const merged = await refreshContinueEpisodeThumbs(refreshed.flat().filter((item) => {
        const key = showKey(item);
        if (!item.ratingKey || seenWatching.has(key)) return false;
        seenWatching.add(key);
        return true;
    }).map((item) => (
        seasonPoster && item.type === 'episode' ? { ...item, preferSeasonPoster: true } : item
    )), server);
    if (primary && merged.length) primary.items = merged;
    if (primary) hubs = hubs.filter((hub) => hub === primary || !continueHub(hub));
    const continueItems = primary ? primary.items : (hubs.some((hub) => hub.items.length) ? [] : onDeck);
    const sections = mapSections(sectionsRaw).map((section) => ({
        ...section,
        key: many ? `${server.id}::${section.key}` : section.key,
        serverId: server.id,
    }));
    return { server, hubs, onDeck: continueItems, sections, recentByLibrary: [], partial: !full };
});

const loadDiscoverPerson = async (name: string) => {
    const token = accountToken();
    const queryName = String(name || '').trim();
    if (!queryName) return null;
    if (!token) return loadWikipediaPerson(queryName);
    const searchUrl = `https://discover.provider.plex.tv/library/search?query=${encodeURIComponent(queryName)}&limit=8&searchTypes=people&includeMetadata=1&X-Plex-Token=${encodeURIComponent(token)}`;
    const data = await plexFetch(searchUrl, token).catch(() => null);
    const container = containerOf(data);
    const metas = asList<PlexMeta>(container.SearchResult)
        .flatMap((group) => asList<PlexMeta>(group.Metadata))
        .concat(asList<PlexMeta>(container.Metadata));
    const want = queryName.toLowerCase();
    const match = metas.find((row) => String(row.title || row.tag || '').trim().toLowerCase() === want)
        || metas.find((row) => String(row.type || '') === 'person')
        || null;
    if (!match) return loadWikipediaPerson(queryName);
    let biography = String(match.summary || match.biography || '').trim();
    const detailKey = String(match.key || '').trim();
    if (!biography && detailKey) {
        const detailUrl = detailKey.startsWith('http')
            ? detailKey
            : `https://discover.provider.plex.tv${detailKey.startsWith('/') ? detailKey : `/${detailKey}`}`;
        const detail = await plexFetch(`${detailUrl}${detailUrl.includes('?') ? '&' : '?'}X-Plex-Token=${encodeURIComponent(token)}`, token).catch(() => null);
        const meta = asList<PlexMeta>(containerOf(detail).Metadata)[0] || containerOf(detail);
        biography = String(meta?.summary || meta?.biography || '').trim();
    }
    if (!biography) return loadWikipediaPerson(queryName);
    // Always enrich DOB / places from Wikidata even when Plex has a summary.
    const wiki = await loadWikipediaPerson(queryName);
    return {
        name: String(match.title || match.tag || queryName),
        biography: wiki?.biography && wiki.biography.length > biography.length ? wiki.biography : biography,
        birthday: match.originallyAvailableAt || wiki?.birthday || null,
        deathday: wiki?.deathday || null,
        knownForDepartment: wiki?.knownForDepartment || null,
        placeOfBirth: match.placeOfBirth || wiki?.placeOfBirth || null,
        placeOfDeath: wiki?.placeOfDeath || null,
        profilePath: null,
    };
};

const shuffleItems = <T,>(rows: T[]) => {
    const copy = rows.slice();
    for (let index = copy.length - 1; index > 0; index -= 1) {
        const swap = Math.floor(Math.random() * (index + 1));
        const current = copy[index];
        copy[index] = copy[swap];
        copy[swap] = current;
    }
    return copy;
};

const heroSlidesFrom = (items: Array<HeroMappedItem | ReturnType<typeof mapItem>>, limit = HERO_LIMIT) => {
    const seen = new Set<string>();
    const slides = [];
    for (const item of items) {
        const showKey = item.type === 'episode' ? String((item as any).grandparentRatingKey || '') : '';
        const id = showKey ? `${item.serverId || ''}:show:${showKey}` : `${item.serverId || ''}:${item.ratingKey}`;
        const backdrop = (item as HeroMappedItem).heroBackdropUrl
            || (item as any).backdropArt
            || (item.type === 'episode' || item.type === 'season' ? '' : item.art);
        if (!item.ratingKey || seen.has(id) || !backdrop) continue;
        seen.add(id);
        slides.push({
            ratingKey: item.ratingKey,
            title: item.type === 'episode' ? ((item as any).showTitle || item.title) : item.title,
            type: item.type,
            year: item.year,
            summary: item.type === 'episode' && (item as any).showTitle && (item as any).showTitle !== item.title
                ? item.title
                : item.summary,
            thumb: item.thumb,
            art: (item as any).backdropArt || item.art || backdrop,
            logo: item.logo,
            backdropUrl: (item as HeroMappedItem).heroBackdropUrl || null,
            tmdbId: item.tmdbId || null,
            canPlay: item.type === 'movie' || item.type === 'episode',
            serverId: item.serverId,
        });
        if (slides.length >= limit) break;
    }
    return slides;
};

const heroPms = (path: string, server: PlexServer) => Promise.race([
    pms(path, server).catch(() => null),
    new Promise<null>((resolve) => { window.setTimeout(() => resolve(null), 7000); }),
]);

const heroSections = async (server: PlexServer) => (
    mapSections(await heroPms('/library/sections', server))
        .filter((section) => section.type === 'movie' || section.type === 'show')
        .slice(0, 6)
);

const heroReady = (item: ReturnType<typeof mapItem>) => (
    !!item.ratingKey && !!item.title && !!(item.art || item.thumb)
    && (item.type === 'movie' || item.type === 'show' || item.type === 'episode')
);

const librarySpotlight = async (_server: PlexServer, _sort: string, _extra = '') => (
    [] as ReturnType<typeof mapItem>[]
);

const sectionFeed = async (server: PlexServer, _feed: 'newest' | 'recentlyAdded') => {
    const sections = await heroSections(server);
    const groups = await Promise.all(sections.map(async (section) => {
        const data = await heroPms(
            `/library/sections/${encodeURIComponent(section.key)}/recentlyAdded?X-Plex-Container-Size=8`,
            server,
        );
        return data ? mapList(data).filter(heroReady) : [];
    }));
    return groups.flat();
};

const horrorGenreId = (row: PlexMeta) => {
    const title = String(row.title || row.tag || '');
    if (!/horror|halloween/i.test(title)) return '';
    const key = String(row.key || '').trim();
    if (/^\d+$/.test(key)) return key;
    const fast = String(row.fastKey || '');
    const fromFast = fast.match(/[?&]genre=(\d+)/);
    if (fromFast) return fromFast[1];
    const fromKey = key.match(/(?:genre\/)?(\d+)$/);
    return fromKey?.[1] || '';
};

const pushHeroMovie = (
    items: ReturnType<typeof mapItem>[],
    seen: Set<string>,
    meta: PlexMeta,
    server: PlexServer,
) => {
    if (String(meta.type || '') !== 'movie') return;
    const item = mapItem(meta);
    if (!item.ratingKey || seen.has(item.ratingKey) || (!item.art && !item.thumb)) return;
    rememberItem(item.ratingKey, server);
    seen.add(item.ratingKey);
    items.push(item);
};

/** Horror-genre movies, plus Halloween-titled movies that are filed under another genre. */
const halloweenHeroMovies = async (server: PlexServer) => {
    const sections = mapSections(await heroPms('/library/sections', server))
        .filter((section) => section.type === 'movie');
    const seen = new Set<string>();
    const items: ReturnType<typeof mapItem>[] = [];
    for (const section of sections) {
        const genreData = await heroPms(`/library/sections/${encodeURIComponent(section.key)}/genre`, server);
        const genreIds = [...new Set(
            asList<PlexMeta>(containerOf(genreData).Directory).map(horrorGenreId).filter(Boolean),
        )];
        for (const genreId of genreIds) {
            const data = await heroPms(
                `/library/sections/${encodeURIComponent(section.key)}/all?type=1&genre=${encodeURIComponent(genreId)}&sort=audienceRating:desc&X-Plex-Container-Start=0&X-Plex-Container-Size=80`,
                server,
            );
            for (const meta of asList<PlexMeta>(containerOf(data).Metadata)) {
                pushHeroMovie(items, seen, meta, server);
            }
        }
    }
    const search = await pms(`/hubs/search?query=${encodeURIComponent('halloween')}&limit=40`, server).catch(() => null);
    for (const hub of asList<PlexMeta>(containerOf(search).Hub)) {
        for (const meta of asList<PlexMeta>(hub.Metadata)) {
            pushHeroMovie(items, seen, meta, server);
        }
    }
    items.sort((a, b) => (Number(b.audienceRating) || 0) - (Number(a.audienceRating) || 0));
    return items;
};

const searchHeroTitles = async (server: PlexServer, queries: string[]) => {
    const seen = new Set<string>();
    const items: ReturnType<typeof mapItem>[] = [];
    for (const query of queries) {
        const data = await pms(`/hubs/search?query=${encodeURIComponent(query)}&limit=20`, server).catch(() => null);
        for (const hub of asList<PlexMeta>(containerOf(data).Hub)) {
            for (const meta of asList<PlexMeta>(hub.Metadata)) {
                const type = String(meta.type || '');
                if (type !== 'movie' && type !== 'show') continue;
                const item = mapItem(meta);
                if (!item.ratingKey || seen.has(item.ratingKey) || (!item.art && !item.thumb)) continue;
                rememberItem(item.ratingKey, server);
                seen.add(item.ratingKey);
                items.push(item);
                if (items.length >= HERO_LIMIT * 2) return items;
            }
        }
    }
    return items;
};

const heroItemsFromServers = async (load: (server: PlexServer) => Promise<ReturnType<typeof mapItem>[]>) => {
    const items: ReturnType<typeof mapItem>[] = [];
    for (const server of enabledServers()) {
        const group = await withMapServer(server, () => load(server).catch(() => [] as ReturnType<typeof mapItem>[]));
        items.push(...group);
    }
    return items;
};

const firstHeroPool = async (
    loaders: Array<(server: PlexServer) => Promise<ReturnType<typeof mapItem>[]>>,
) => {
    for (const load of loaders) {
        const items = await heroItemsFromServers(load);
        if (heroSlidesFrom(items).length) return items;
    }
    return [];
};

const buildHomeHero = async () => {
    await ensureServers();
    const config = readHeroConfig();
    if (config.mode === 'off') {
        return { enabled: false, mode: 'off', effectiveMode: 'off', items: [], reason: 'disabled' };
    }
    const effective = config.seasonalInWindowOnly && SEASONAL_HERO_MODES.has(config.mode) && !seasonalHeroInWindow(config.mode)
        ? 'trending_week'
        : config.mode;
    let items: Array<HeroMappedItem | ReturnType<typeof mapItem>> = [];
    try {
        if (effective === 'continue_watching') {
            items = await heroItemsFromServers((server) => (
                heroPms('/library/onDeck?X-Plex-Container-Size=12', server).then((data) => (data ? mapList(data).filter(heroReady) : []))
            ));
        } else if (effective === 'seasonal_halloween') {
            items = await heroItemsFromServers(halloweenHeroMovies);
            items.sort((a, b) => (Number(b.audienceRating) || 0) - (Number(a.audienceRating) || 0));
        } else if (SEASONAL_HERO_MODES.has(effective)) {
            items = await firstHeroPool([
                (server) => searchHeroTitles(server, SEASONAL_QUERIES[effective] || []),
                (server) => librarySpotlight(server, 'audienceRating:desc'),
            ]);
        } else if (effective === 'recently_added') {
            items = await firstHeroPool([
                (server) => sectionFeed(server, 'recentlyAdded'),
                (server) => librarySpotlight(server, 'addedAt:desc'),
            ]);
        } else if (effective === 'new_releases') {
            items = await firstHeroPool([
                (server) => sectionFeed(server, 'newest'),
                (server) => librarySpotlight(server, 'originallyAvailableAt:desc'),
                (server) => librarySpotlight(server, 'year:desc'),
            ]);
        } else if (effective === 'most_watched') {
            items = await firstHeroPool([
                (server) => librarySpotlight(server, 'viewCount:desc'),
                (server) => librarySpotlight(server, 'lastViewedAt:desc'),
            ]);
        } else if (effective === 'unwatched_picks') {
            items = await firstHeroPool([
                (server) => librarySpotlight(server, 'audienceRating:desc', 'unwatched=1'),
                (server) => librarySpotlight(server, 'addedAt:desc', 'unwatched=1'),
                (server) => librarySpotlight(server, 'audienceRating:desc'),
            ]);
        } else if (effective === 'random_spotlight') {
            items = shuffleItems(await heroItemsFromServers((server) => sectionFeed(server, 'recentlyAdded')));
        } else if (effective === 'trending_week') {
            const candidates = await loadTrendingCandidates();
            items = candidates.length ? await matchTrendingToLibrary(candidates) : [];
            if (!heroSlidesFrom(items).length) {
                items = await firstHeroPool([
                    (server) => librarySpotlight(server, 'audienceRating:desc'),
                    (server) => sectionFeed(server, 'recentlyAdded'),
                ]);
            }
        } else {
            items = await firstHeroPool([
                (server) => librarySpotlight(server, 'audienceRating:desc'),
                (server) => sectionFeed(server, 'recentlyAdded'),
            ]);
        }
        if (!heroSlidesFrom(items).length && effective !== 'continue_watching') {
            items = await firstHeroPool([
                (server) => sectionFeed(server, 'recentlyAdded'),
                (server) => librarySpotlight(server, 'audienceRating:desc'),
                (server) => heroPms('/library/onDeck?X-Plex-Container-Size=12', server)
                    .then((data) => (data ? mapList(data).filter(heroReady) : [])),
            ]);
        }
    } catch {
        items = [];
    }
    const slideLimit = effective === 'seasonal_halloween'
        ? HALLOWEEN_HERO_LIMIT
        : (effective === 'trending_week' ? TRENDING_HERO_LIMIT : HERO_LIMIT);
    const slides = heroSlidesFrom(items, slideLimit);
    return {
        enabled: slides.length > 0,
        mode: config.mode,
        effectiveMode: effective,
        items: slides,
        reason: slides.length ? 'ok' : 'empty',
    };
};

const handlePlayer = async (path: string, method: string, query: URLSearchParams, body: any) => {
    if (path === '/api/media-player/me') {
        const token = accountToken();
        const user = token ? await plexFetch(`${PLEX_TV}/api/v2/user`, token).catch(() => null) : null;
        const server = readServer();
        const homeId = readHomeUserId();
        const homeUser = homeId && readOwnerToken()
            ? (await fetchHomeUsers(readOwnerToken()).catch(() => [] as HomeUser[])).find((row) => sameHomeUser(row, homeId))
            : null;
        return {
            username: homeUser?.title || user?.username || user?.title || server?.name || 'Plex',
            thumb: homeUser?.thumb || user?.thumb || null,
            isAdmin: homeUser ? homeUser.admin : true,
        };
    }
    if (path === '/api/media-player/settings' && method === 'PUT') {
        const next = { ...readSettings(), ...(body || {}) };
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
        return next;
    }
    if (path === '/api/media-player/settings') return readSettings();
    if (path === '/api/media-player/servers') {
        if (method !== 'POST') await ensureServers();
        const stored = readServerList();
        if (method === 'POST') {
            const ids = Array.isArray(body?.enabledIds) ? body.enabledIds.map((id: unknown) => String(id)) : [];
            writeServerList(stored.servers, ids.filter((id: string) => stored.servers.some((server) => server.id === id)));
        }
        const current = readServerList();
        return {
            servers: current.servers.map((server) => ({
                id: server.id,
                name: server.name,
                enabled: !current.enabledIds.length || current.enabledIds.includes(server.id),
            })),
        };
    }
    if (path === '/api/media-player/libraries') {
        await ensureServers();
        const servers = enabledServers();
        const many = servers.length > 1;
        const groups = await Promise.all(servers.map((server) => withMapServer(server, async () => (
            mapSections(await pms('/library/sections', server)).map((section) => ({
                ...section,
                key: many ? `${server.id}::${section.key}` : section.key,
                title: many ? `${section.title}` : section.title,
                serverId: server.id,
                serverName: server.name,
            }))
        ))));
        const libraries = groups.flat();
        const titles = new Map<string, number>();
        libraries.forEach((library) => titles.set(library.title, (titles.get(library.title) || 0) + 1));
        return {
            libraries: libraries.map((library) => (
                many && (titles.get(library.title) || 0) > 1
                    ? { ...library, title: `${library.title} · ${library.serverName}` }
                    : library
            )),
        };
    }
    if (path === '/api/media-player/home') {
        await ensureServers();
        const servers = enabledServers();
        const many = servers.length > 1;
        const full = query.get('full') === '1';
        const loaded = await Promise.all(servers.map((server) => loadServerHome(server, many, full).catch(() => null)));
        const rows = loaded.filter((row): row is NonNullable<typeof row> => !!row);
        const titleCount = new Map<string, number>();
        rows.flatMap((row) => row.hubs).forEach((hub) => titleCount.set(hub.title, (titleCount.get(hub.title) || 0) + 1));
        const hubs = rows.flatMap((row) => row.hubs.map((hub) => ({
            ...hub,
            identifier: many ? `${row.server.id}:${hub.identifier}` : hub.identifier,
            title: many && (titleCount.get(hub.title) || 0) > 1
                ? `${hub.title} · ${row.server.name}`
                : hub.title,
        })));
        const libraries = rows.flatMap((row) => row.sections);
        return {
            libraries,
            continueWatching: rows.flatMap((row) => row.onDeck),
            recentByLibrary: rows.flatMap((row) => row.recentByLibrary),
            playlists: [],
            hubs,
            partial: rows.some((row) => row.partial),
        };
    }
    if (path === '/api/media-player/home-hero-config') {
        if (method === 'PUT' || method === 'POST') return writeHeroConfig(body);
        return readHeroConfig();
    }
    if (path === '/api/media-player/home-hero') return buildHomeHero();
    if (path === '/api/media-player/hub') {
        const { server, path: hubPath } = splitLibraryKey(String(query.get('path') || ''));
        if (!server || !hubPath) return { title: query.get('title') || '', items: [] };
        const data = await withMapServer(server, () => pms(`${hubPath}${hubPath.includes('?') ? '&' : '?'}X-Plex-Container-Size=80`, server));
        return { title: query.get('title') || '', items: mapList(data) };
    }
    const library = path.match(/^\/api\/media-player\/libraries\/([^/]+)$/);
    if (library && method === 'GET') {
        const { server, section } = splitLibraryKey(library[1]);
        const sections = mapSections(await pms('/library/sections', server));
        const sectionRow = sections.find((row) => row.key === section);
        const start = query.get('start') || '0';
        const size = query.get('size') || '50';
        const params = new URLSearchParams({
            'X-Plex-Container-Start': start,
            'X-Plex-Container-Size': size,
        });
        const sort = query.get('sort');
        if (sort) params.set('sort', sort);
        if (query.get('genre')) params.set('genre', query.get('genre') || '');
        if (query.get('unwatched') === '1') params.set('unwatched', '1');
        if (query.get('inProgress') === '1') params.set('inProgress', '1');
        const letter = letterCharOf(String(query.get('letter') || ''));
        const pinnedType = sectionAllType(sectionRow?.type || '');
        if (pinnedType) params.set('type', pinnedType);
        const listPath = `/library/sections/${encodeURIComponent(section)}/all?`;
        let data: any = null;
        let items: ReturnType<typeof mapList> = [];
        if (letter && pinnedType) {
            if (!params.get('sort') || params.get('sort') === 'titleSort') params.set('sort', 'titleSort:asc');
            const pageStart = Math.max(0, Number(start) || 0);
            const pageSize = Math.max(1, Number(size) || 50);
            const wantedRank = letterRank(letter);
            const wantedUpper = letter.toUpperCase();
            const cacheKey = `${server?.id || ''}:${section}:${wantedUpper}:${params.get('genre') || ''}:${params.get('unwatched') || ''}:${params.get('inProgress') || ''}`;
            const firstRank = (rows: ReturnType<typeof mapList>) => titleLetterRank(rows[0]?.title);
            const isWantedLetter = (rows: ReturnType<typeof mapList>) => {
                if (!rows.length) return false;
                if (wantedUpper === '#') return firstRank(rows) === 0;
                return firstRank(rows) === wantedRank;
            };
            const loadAt = async (index: number, count: number) => {
                const next = new URLSearchParams(params);
                next.set('X-Plex-Container-Start', String(Math.max(0, index)));
                next.set('X-Plex-Container-Size', String(Math.max(1, count)));
                next.delete('firstCharacter');
                return withMapServer(server, () => pms(`${listPath}${next}`, server, 8000).catch(() => null));
            };

            // Plex's letter index starts at the first title for that character.
            const indexParams = new URLSearchParams(params);
            indexParams.delete('firstCharacter');
            const indexed = await withMapServer(server, () => pms(
                `/library/sections/${encodeURIComponent(section)}/firstCharacter/${encodeURIComponent(wantedUpper)}?${indexParams}`,
                server,
                8000,
            ).catch(() => null));
            const indexedItems = mapList(indexed);
            if (indexedItems.length && isWantedLetter(indexedItems)) {
                data = indexed;
                items = indexedItems;
            }

            if (!data) {
                let origin = wantedUpper === '#' ? 0 : letterOriginCache.get(cacheKey);
                let searchable = wantedUpper === '#' || origin != null;
                if (origin == null) {
                    const probe = await loadAt(0, 1);
                    const total = Number(containerOf(probe).totalSize || 0);
                    searchable = Number.isFinite(total) && total > 0;
                    let lo = 0;
                    let hi = searchable ? total : 0;
                    let probes = 0;
                    while (lo < hi && probes < 18) {
                        const mid = Math.floor((lo + hi) / 2);
                        probes += 1;
                        const row = mapList(await loadAt(mid, 1))[0];
                        if (!row) {
                            hi = mid;
                            continue;
                        }
                        if (titleLetterRank(row.title) < wantedRank) lo = mid + 1;
                        else hi = mid;
                    }
                    origin = lo;
                    const landed = mapList(await loadAt(origin, 1));
                    if (searchable && landed.length && !isWantedLetter(landed)) {
                        origin = -1;
                    } else if (searchable && origin > 0 && isWantedLetter(landed)) {
                        // Walk back so a letter jump never opens on the last few titles.
                        let back = origin;
                        for (let step = 0; step < 8 && back > 0; step += 1) {
                            const prevIndex = Math.max(0, back - pageSize);
                            const prevPage = mapList(await loadAt(prevIndex, pageSize));
                            let firstWanted = -1;
                            for (let i = 0; i < prevPage.length; i += 1) {
                                const rank = titleLetterRank(prevPage[i]?.title);
                                const match = wantedUpper === '#' ? rank === 0 : rank === wantedRank;
                                if (match) {
                                    if (firstWanted < 0) firstWanted = i;
                                } else if (firstWanted >= 0) {
                                    break;
                                }
                            }
                            if (firstWanted < 0) break;
                            back = prevIndex + firstWanted;
                            if (prevIndex === 0) break;
                        }
                        origin = back;
                    }
                    if (searchable && origin >= 0) letterOriginCache.set(cacheKey, origin);
                }
                if (searchable && origin != null && origin >= 0) {
                    data = await loadAt(origin + pageStart, pageSize);
                    items = mapList(data);
                    if (pageStart === 0 && items.length && !isWantedLetter(items)) {
                        letterOriginCache.delete(cacheKey);
                        data = { MediaContainer: { totalSize: 0 } };
                        items = [];
                    }
                }
            }
            if (!data) {
                data = { MediaContainer: { totalSize: 0 } };
                items = [];
            }
                } else if (letter) {
            data = { MediaContainer: { totalSize: 0 } };
            items = [];
        } else {
            data = await withMapServer(server, () => pms(`${listPath}${params}`, server));
            items = mapList(data);
        }
        const container = containerOf(data);
        return {
            title: sectionRow?.title || 'Library',
            type: sectionRow?.type || 'movie',
            total: Number(container.totalSize || container.size || 0),
            items,
        };
    }
    const libraryHome = path.match(/^\/api\/media-player\/libraries\/([^/]+)\/home$/);
    if (libraryHome) {
        const { server, section } = splitLibraryKey(libraryHome[1]);
        const sections = mapSections(await pms('/library/sections', server));
        const sectionRow = sections.find((row) => row.key === section);
        const many = enabledServers().length > 1;
        const active = server || readServer()!;
        const emptyHubs = [] as Array<{ title: string; identifier: string; items: ReturnType<typeof mapItem>[] }>;
        const requested = await pms(`/hubs/sections/${encodeURIComponent(section)}?count=18`, active, 12000)
            .then((data) => ({ data, answered: true }))
            .catch(() => ({ data: null, answered: false }));
        let hubs = requested.answered
            ? await withMapServer(active, () => sectionPinnedHubs(requested.data, active, many))
            : [];
        if (!hubs.length && requested.answered) {
            hubs = await withMapServer(active, async () => {
                const inline = await pms(`/hubs/sections/${encodeURIComponent(section)}?includeMeta=1&count=12`, active, 12000).catch(() => null);
                return inline ? sectionPinnedHubs(inline, active, many) : [];
            });
        }
        if (hubs.length) {
            const stamped = await withMapServer(active, async () => {
                const next = [];
                for (const hub of hubs) {
                    if (!continueHub(hub)) {
                        next.push(hub);
                        continue;
                    }
                    next.push({
                        ...hub,
                        items: await refreshContinueEpisodeThumbs(hub.items, active),
                    });
                }
                return next;
            });
            return { title: sectionRow?.title || 'Library', type: sectionRow?.type || 'movie', hubs: stamped };
        }
        const pinnedType = sectionAllType(sectionRow?.type || '');
        if (!pinnedType || !requested.answered) {
            return {
                title: sectionRow?.title || 'Library',
                type: sectionRow?.type || 'movie',
                hubs: emptyHubs,
            };
        }
        const recent = await withMapServer(active, () => (
            pms(`/library/sections/${encodeURIComponent(section)}/recentlyAdded?X-Plex-Container-Size=18`, active).then(mapList).catch(() => [])
        ));
        return {
            title: sectionRow?.title || 'Library',
            type: sectionRow?.type || 'movie',
            hubs: [
                { title: 'Recently Added', identifier: 'recentlyAdded', items: recent },
            ].filter((hub) => hub.items.length),
        };
    }
    const libraryFilters = path.match(/^\/api\/media-player\/libraries\/([^/]+)\/filters$/);
    if (libraryFilters) {
        const { server, section } = splitLibraryKey(libraryFilters[1]);
        const [genres, letters] = await Promise.all([
            pms(`/library/sections/${encodeURIComponent(section)}/genre`, server).then((data) => (
                asList<PlexMeta>(containerOf(data).Directory).map((row) => ({
                    key: String(row.key || row.fastKey || ''),
                    title: String(row.title || ''),
                })).filter((row) => row.key && row.title)
            )).catch(() => [] as Array<{ key: string; title: string }>),
            pms(
                `/library/sections/${encodeURIComponent(section)}/firstCharacter`,
                server,
                8000,
            ).then(mapFirstCharacters).catch(() => [] as Array<{ key: string; title: string }>),
        ]);
        return { genres, decades: [], resolutions: [], studios: [], letters };
    }
    const libraryCollections = path.match(/^\/api\/media-player\/libraries\/([^/]+)\/collections$/);
    if (libraryCollections) {
        const { server, section } = splitLibraryKey(libraryCollections[1]);
        const items = await withMapServer(server, async () => {
            const listed = await pms(
                `/library/sections/${encodeURIComponent(section)}/collections?X-Plex-Container-Size=200`,
                server,
                15000,
            ).catch(() => null);
            let rows = mapCollections(listed);
            if (!rows.length) {
                const typed = await pms(
                    `/library/sections/${encodeURIComponent(section)}/all?type=18&sort=titleSort&X-Plex-Container-Size=200`,
                    server,
                    15000,
                ).catch(() => null);
                rows = mapCollections(typed);
            }
            return rows;
        });
        return { title: 'Collections', items };
    }
    const collectionPath = path.match(/^\/api\/media-player\/collection\/([^/]+)$/);
    if (collectionPath && method === 'GET') {
        const key = decodeURIComponent(collectionPath[1]).replace(/\D/g, '');
        const hinted = splitLibraryKey(String(query.get('section') || ''));
        const server = resolveServer(query.get('server') || hinted.server?.id, key) || hinted.server;
        if (!server || !key) return { item: null, children: [], extras: [], related: [], onDeck: null };
        return withMapServer(server, async () => {
            const meta = await pms(`/library/collections/${encodeURIComponent(key)}?includeChildren=1`, server, 12000).catch(() => null)
                || await pms(`/library/metadata/${encodeURIComponent(key)}?includeChildren=1`, server, 12000).catch(() => null);
            const row = asList<PlexMeta>(containerOf(meta).Metadata)[0]
                || asList<PlexMeta>(containerOf(meta).Directory)[0]
                || null;
            const ratingKey = row ? (collectionRatingKey(row) || key) : key;
            const item = row
                ? mapItem({ ...row, ratingKey, type: 'collection' })
                : mapItem({ ratingKey: key, title: 'Collection', type: 'collection' });
            item.type = 'collection';
            item.canPlay = false;
            let children = mapList({
                MediaContainer: {
                    Metadata: asList<PlexMeta>(row?.Children).concat(asList<PlexMeta>(row?.Metadata)),
                },
            }).filter((child) => child.ratingKey !== ratingKey && child.type !== 'collection');
            if (!children.length) {
                children = await pms(
                    `/library/collections/${encodeURIComponent(key)}/children?X-Plex-Container-Size=200`,
                    server,
                    15000,
                ).then(mapList).catch(() => []);
            }
            if (!children.length) {
                children = await pms(
                    `/library/metadata/${encodeURIComponent(key)}/children?X-Plex-Container-Size=200`,
                    server,
                    15000,
                ).then(mapList).catch(() => []);
            }
            return { item, children, extras: [], related: [], onDeck: null };
        });
    }
    const itemMore = path.match(/^\/api\/media-player\/item\/([^/]+)\/more$/);
    if (itemMore && method === 'GET') {
        const key = decodeURIComponent(itemMore[1]);
        const server = resolveServer(query.get('server'), key);
        if (!server) return { extras: [], related: [], onDeck: null };
        return withMapServer(server, async () => {
            const data = await pms(`/hubs/metadata/${encodeURIComponent(key)}/related?count=16&includeMeta=1`, server).catch(() => null);
            const many = enabledServers().length > 1;
            const related = [];
            for (const hub of asList<PlexMeta>(containerOf(data).Hub)) {
                let rows = asList<PlexMeta>(hub.Metadata);
                if (!rows.length) rows = asList<PlexMeta>(hub.Directory);
                const rawKey = String(hub.key || hub.hubKey || '').trim();
                const listPath = /^https?:\/\//i.test(rawKey)
                    ? (() => { try { const url = new URL(rawKey); return `${url.pathname}${url.search}`; } catch { return ''; } })()
                    : (rawKey.startsWith('/') ? rawKey : '');
                const pathOnly = listPath.split('?')[0];
                if (!rows.length && (pathOnly.startsWith('/library/') || pathOnly.startsWith('/hubs/'))) {
                    const extra = await pms(listPath, server).catch(() => null);
                    rows = asList<PlexMeta>(containerOf(extra).Metadata);
                }
                const items = mapList({ MediaContainer: { Metadata: rows } });
                if (!items.length) continue;
                const identifier = String(hub.hubIdentifier || hub.key || hub.title || 'related');
                const safeHub = pathOnly.startsWith('/library/') || pathOnly.startsWith('/hubs/') ? listPath : '';
                related.push({
                    title: String(hub.title || identifier),
                    identifier,
                    items,
                    hubKey: safeHub ? (many ? `${server.id}::${safeHub}` : safeHub) : null,
                    serverId: server.id,
                });
            }
            const extras = await pms(`/library/metadata/${encodeURIComponent(key)}/extras`, server).then(mapList).catch(() => []);
            let onDeck: ReturnType<typeof mapItem> | null = null;
            const core = await metadata(key, server).catch(() => null);
            const kind = core ? String(mapItem(core).type || '').toLowerCase() : '';
            if (kind === 'show' || kind === 'season') {
                onDeck = await resolvePlayableEpisode(key, server, kind);
            }
            return { extras, related, onDeck };
        });
    }
    const itemPath = path.match(/^\/api\/media-player\/item\/([^/]+)$/);
    if (itemPath && method === 'GET') {
        const key = decodeURIComponent(itemPath[1]);
        const server = resolveServer(query.get('server'), key);
        return withMapServer(server, async () => {
            const meta = await metadata(key, server);
            const item = mapItem(meta);
            if (item.ratingKey) rememberItem(item.ratingKey, server);
            const ratingsEmpty = !item.ratings || Object.values(item.ratings).every((row) => !row);
            const showKey = item.type === 'season'
                ? item.parentRatingKey
                : (item.type === 'episode' ? item.grandparentRatingKey : null);
            if ((ratingsEmpty || !item.externalIds?.tmdb) && showKey) {
                const showMeta = await metadata(String(showKey), server).catch(() => null);
                if (showMeta) {
                    const showItem = mapItem(showMeta);
                    if (ratingsEmpty && showItem.ratings) item.ratings = showItem.ratings;
                    if (!item.externalIds?.imdb && !item.externalIds?.tmdb && !item.externalIds?.tvdb) {
                        item.externalIds = showItem.externalIds;
                        item.tmdbId = showItem.tmdbId;
                    } else if (!item.tmdbId && showItem.tmdbId) {
                        item.tmdbId = showItem.tmdbId;
                        item.externalIds = { ...(item.externalIds || { imdb: null, tmdb: null, tvdb: null }), tmdb: showItem.tmdbId };
                    }
                }
            }
            let children: ReturnType<typeof mapItem>[] = [];
            if (item.type === 'show' || item.type === 'season') children = await childrenOf(key, server);
            let extras: ReturnType<typeof mapItem>[] = [];
            if (item.type === 'movie' || item.type === 'show') {
                extras = await pms(`/library/metadata/${encodeURIComponent(key)}/extras`, server).then(mapList).catch(() => []);
            }
            let onDeck: ReturnType<typeof mapItem> | null = null;
            if (item.type === 'show' || item.type === 'season') {
                onDeck = await resolvePlayableEpisode(key, server, item.type);
            }
            return { item, children, extras, related: [], onDeck };
        });
    }
    const play = path.match(/^\/api\/media-player\/play\/([^/]+)$/);
    if (play) {
        const key = decodeURIComponent(play[1]);
        const server = resolveServer(query.get('server'), key);
        return withMapServer(server, async () => {
            let meta = await metadata(key, server);
            const seed = mapItem(meta);
            if (seed.type === 'show' || seed.type === 'season') {
                const episode = await resolvePlayableEpisode(key, server, seed.type);
                if (episode?.ratingKey) {
                    meta = await metadata(String(episode.ratingKey), server);
                }
            }
            const settings = readSettings();
            const mediaIndex = Number(query.get('mediaIndex') || 0);
            const qualityId = String(query.get('qualityId') || settings.defaultQualityId || 'original');
            const medias = asList<PlexMeta>(meta.Media);
            const media = medias[mediaIndex] || medias[0];
            const part = asList<PlexMeta>(media?.Part)[0] || {};
            const streams = mapStreams(part);
            const requestedAudio = query.get('audioStreamId') || query.get('audioStreamID') || '';
            const audioStreamId = pickAudioId(streams.audio, requestedAudio, settings.audioLanguage || '');
            const requestedSub = query.has('subtitleStreamId') || query.has('subtitleStreamID')
                ? String(query.get('subtitleStreamId') ?? query.get('subtitleStreamID') ?? '')
                : null;
            const subtitleStreamId = pickSubtitleId(streams.subtitles, requestedSub, settings.subtitleMode || 'forced');
            const offsetQuery = query.get('offsetMs');
            const offsetMs = offsetQuery != null
                ? Math.max(0, Math.floor(Number(offsetQuery) || 0))
                : Math.max(0, Math.floor(Number(meta.viewOffset) || 0));
            const playKey = String(meta.ratingKey || key);
            const chosen = playSrc(
                meta,
                mediaIndex,
                qualityId === 'auto' ? 'original' : qualityId,
                audioStreamId,
                subtitleStreamId,
                offsetMs,
                query.get('delivery') === 'hls',
            );
            const item = mapItem(meta);
            if (item.ratingKey) rememberItem(item.ratingKey, server);
            return {
                sessionId: `plex-${playKey}`,
                item,
                src: chosen.src,
                offsetMs,
                qualities: QUALITIES,
                qualityId: qualityId === 'auto' ? 'original' : qualityId,
                canDirectPlay: chosen.mode === 'directPlay',
                canCopyOriginal: true,
                audioTracks: streams.audio.map((stream) => ({
                    id: String(stream.id || ''),
                    label: String(stream.displayTitle || stream.language || stream.codec || 'Audio'),
                    language: stream.language || null,
                    languageTag: stream.languageTag || stream.languageCode || null,
                    codec: stream.codec || null,
                    channels: stream.channels ? Number(stream.channels) : null,
                    selected: String(stream.id || '') === audioStreamId,
                })),
                audioStreamId: audioStreamId || null,
                subtitles: streams.subtitles.map((stream) => ({
                    id: String(stream.id || ''),
                    label: String(stream.displayTitle || stream.language || stream.codec || 'Subtitle'),
                    language: stream.language || null,
                    languageTag: stream.languageTag || stream.languageCode || null,
                    codec: stream.codec || null,
                    forced: stream.forced === 1 || stream.forced === true,
                    selected: String(stream.id || '') === subtitleStreamId,
                })),
                subtitleStreamId: subtitleStreamId || null,
                mediaIndex,
                versions: item.versions,
                markers: item.markers,
                playbackMode: chosen.mode,
                client: 'android',
            };
        });
    }
    if (path === '/api/media-player/timeline' && method === 'POST') {
        const state = body?.state === 'paused' ? 'paused' : body?.state === 'stopped' ? 'stopped' : 'playing';
        const key = String(body?.ratingKey || '');
        if (key) {
            const time = String(Math.max(0, Math.floor(Number(body?.timeMs) || 0)));
            const sessionId = String(body?.sessionId || '').trim();
            const safeSession = /^[\w.-]{6,80}$/.test(sessionId) ? sessionId : '';
            const params = new URLSearchParams({
                ratingKey: key,
                key: `/library/metadata/${key}`,
                identifier: 'com.plexapp.plugins.library',
                state,
                time,
                playbackTime: time,
                duration: String(Math.max(0, Math.floor(Number(body?.durationMs) || 0))),
                hasMDE: '1',
            });
            if (safeSession) params.set('X-Plex-Session-Identifier', safeSession);
            await pms(
                `/: /timeline?${params}`.replace('/: /', '/:/'),
                resolveServer(body?.serverId, key),
                8000,
                safeSession ? { 'X-Plex-Session-Identifier': safeSession } : undefined,
            ).catch(() => undefined);
        }
        return { ok: true };
    }
    const scrobble = path.match(/^\/api\/media-player\/(scrobble|unscrobble)\/([^/]+)$/);
    if (scrobble && method === 'POST') {
        const key = decodeURIComponent(scrobble[2]);
        await pms(`/:/${scrobble[1]}?identifier=com.plexapp.plugins.library&key=${encodeURIComponent(key)}`.replace('/:/', '/:/'), resolveServer('', key));
        return { ok: true };
    }
    const progress = path.match(/^\/api\/media-player\/progress\/([^/]+)$/);
    if (progress && method === 'DELETE') {
        const key = decodeURIComponent(progress[1]);
        await pms(`/: /timeline?ratingKey=${encodeURIComponent(key)}&key=${encodeURIComponent(`/library/metadata/${key}`)}&state=stopped&time=0&duration=0`.replace('/: /', '/:/'), resolveServer('', key)).catch(() => undefined);
        return { ok: true };
    }
    const nextEpisode = async (meta: PlexMeta, server: PlexServer | null) => {
        if (meta.type !== 'episode' || !meta.parentRatingKey) return { previous: null, next: null };
        const siblings = await childrenOf(String(meta.parentRatingKey), server);
        const index = siblings.findIndex((row) => row.ratingKey === String(meta.ratingKey));
        let nextItem = index >= 0 ? siblings[index + 1] || null : null;
        const previous = index > 0 ? siblings[index - 1] : null;
        if (!nextItem && meta.grandparentRatingKey) {
            const seasons = await childrenOf(String(meta.grandparentRatingKey), server);
            const seasonIndex = seasons.findIndex((row) => row.ratingKey === String(meta.parentRatingKey));
            const nextSeason = seasonIndex >= 0 ? seasons[seasonIndex + 1] : null;
            if (nextSeason?.ratingKey) {
                const episodes = await childrenOf(nextSeason.ratingKey, server);
                nextItem = episodes[0] || null;
            }
        }
        return { previous, next: nextItem };
    };
    const next = path.match(/^\/api\/media-player\/next\/([^/]+)$/);
    if (next) {
        const key = decodeURIComponent(next[1]);
        const server = resolveServer(query.get('server'), key);
        const meta = await metadata(key, server);
        const neighbors = await nextEpisode(meta, server);
        return { item: neighbors.next };
    }
    const neighbors = path.match(/^\/api\/media-player\/neighbors\/([^/]+)$/);
    if (neighbors) {
        const key = decodeURIComponent(neighbors[1]);
        const server = resolveServer(query.get('server'), key);
        const meta = await metadata(key, server);
        if (meta.type !== 'episode') return { previous: null, next: null };
        return nextEpisode(meta, server);
    }
    const personPath = path.match(/^\/api\/media-player\/person\/([^/]+)$/);
    if (personPath && method === 'GET') {
        await ensureServers();
        const actorId = decodeURIComponent(personPath[1]);
        const name = String(query.get('name') || '').trim();
        const filters = [actorId, name].map((value) => String(value || '').trim()).filter((value, index, all) => (
            value && all.findIndex((row) => row.toLowerCase() === value.toLowerCase()) === index
        ));
        const groups = await Promise.all(enabledServers().map((server) => withMapServer(server, async () => {
            const sections = mapSections(await pms('/library/sections', server)).filter((section) => (
                section.type === 'movie' || section.type === 'show'
            ));
            const found = await Promise.all(sections.map(async (section) => {
                const pinnedType = sectionAllType(section.type);
                if (!pinnedType) return [] as ReturnType<typeof mapItem>[];
                for (const filter of filters) {
                    const data = await pms(
                        `/library/sections/${encodeURIComponent(section.key)}/all?type=${pinnedType}&actor=${encodeURIComponent(filter)}&X-Plex-Container-Start=0&X-Plex-Container-Size=40`,
                        server,
                    ).catch(() => null);
                    const rows = mapList(data);
                    if (rows.length) return rows;
                }
                return [] as ReturnType<typeof mapItem>[];
            }));
            return found.flat().map((item) => {
                if (item.type !== 'episode' && item.type !== 'season') return item;
                const showKey = String(item.type === 'season' ? item.parentRatingKey : item.grandparentRatingKey || '').replace(/\D/g, '');
                if (!showKey) return item;
                rememberItem(showKey, server);
                return {
                    ...item,
                    ratingKey: showKey,
                    title: String(item.showTitle || item.title),
                    showTitle: null,
                    seasonTitle: null,
                    type: 'show',
                    thumb: imageUrl(`/library/metadata/${showKey}/thumb`, 300, 450) || item.thumb,
                    index: null,
                    parentIndex: null,
                    parentRatingKey: null,
                    grandparentRatingKey: null,
                    viewOffsetMs: 0,
                    canPlay: false,
                };
            });
        })));
        const seen = new Set<string>();
        const items = groups.flat().filter((item) => {
            const id = `${item.serverId || ''}:${item.ratingKey}`;
            if (!item.ratingKey || seen.has(id)) return false;
            seen.add(id);
            return true;
        }).slice(0, 100);
        const profile = await loadDiscoverPerson(name || actorId);
        return {
            person: {
                id: actorId,
                name: profile?.name || name || actorId,
                thumb: query.get('thumb') || null,
            },
            items,
            profile,
        };
    }
    if (path === '/api/media-player/search') {
        const q = query.get('q') || '';
        if (!q.trim()) return { results: [] };
        await ensureServers();
        const isPersonHit = (meta: PlexMeta, hub: PlexMeta) => {
            const type = String(meta.type || '').trim().toLowerCase();
            if (['movie', 'show', 'episode', 'season', 'artist', 'album', 'track', 'playlist', 'collection'].includes(type)) {
                return false;
            }
            if (type === 'actor' || type === 'person' || type === 'director' || type === 'writer' || type === 'producer') {
                return true;
            }
            const key = String(meta.key || '').toLowerCase();
            if (/\/library\/people\//i.test(key)) return true;
            const identifier = String(hub.hubIdentifier || hub.type || '').trim().toLowerCase();
            if (/^(actor|person|people|cast|director|writer)(\.|$)/i.test(identifier)) return true;
            const title = String(hub.title || '').trim().toLowerCase();
            return /^(actors?|people|persons?|cast|directors?|writers?)$/i.test(title);
        };
        const mapPersonHit = (meta: PlexMeta, server: { id?: string } | null) => {
            const id = String(meta.ratingKey || meta.id || '').trim();
            const name = String(meta.tag || meta.title || meta.name || '').trim();
            if (!id && !name) return null;
            return {
                ratingKey: id || name,
                title: name || id,
                type: 'person',
                year: null as number | null,
                summary: '',
                thumb: imageUrl(meta.thumb, 300, 450),
                art: null as string | null,
                logo: null as string | null,
                canPlay: false,
                watched: false,
                viewOffsetMs: 0,
                serverId: server?.id || mapServer?.id || null,
                personId: id || name,
                personName: name || id,
            };
        };
        const groups = await Promise.all(enabledServers().map((server) => withMapServer(server, async () => {
            const data = await pms(`/hubs/search?query=${encodeURIComponent(q)}&limit=24`, server).catch(() => null);
            const people: ReturnType<typeof mapPersonHit>[] = [];
            const media: ReturnType<typeof mapItem>[] = [];
            const seenPeople = new Set<string>();
            for (const hub of asList<PlexMeta>(containerOf(data).Hub)) {
                const rows = asList<PlexMeta>(hub.Metadata).concat(asList<PlexMeta>(hub.Directory));
                for (const meta of rows) {
                    if (isPersonHit(meta, hub)) {
                        const person = mapPersonHit(meta, server);
                        if (!person) continue;
                        const dedupe = `${person.personId}|${person.title.toLowerCase()}`;
                        if (seenPeople.has(dedupe)) continue;
                        seenPeople.add(dedupe);
                        people.push(person);
                        continue;
                    }
                    if (!['movie', 'show', 'episode', 'artist', 'album', 'playlist'].includes(String(meta.type || ''))) {
                        continue;
                    }
                    const item = mapItem(meta);
                    if (item.ratingKey) {
                        rememberItem(item.ratingKey, mapServer);
                        media.push(item);
                    }
                }
            }
            return [...people, ...media];
        })));
        return { results: groups.flat().filter(Boolean) };
    }
    if (path === '/api/media-player/playlists') {
        const items = await pms('/playlists?playlistType=video').then(mapList).catch(() => []);
        return { items };
    }
    const playlist = path.match(/^\/api\/media-player\/playlists\/([^/]+)$/);
    if (playlist && method === 'GET') {
        const key = decodeURIComponent(playlist[1]);
        const items = await pms(`/playlists/${encodeURIComponent(key)}/items`).then(mapList).catch(() => []);
        return { item: { ratingKey: key, title: 'Playlist', type: 'playlist' }, children: items, items };
    }
    if (path === '/api/media-player/stop') {
        const sessionId = String(body?.sessionId || '').trim();
        const safeSession = /^[\w.-]{6,80}$/.test(sessionId) ? sessionId : '';
        const server = resolveServer(body?.serverId, String(body?.ratingKey || ''));
        if (safeSession && server) {
            const params = new URLSearchParams({
                session: safeSession,
                'X-Plex-Session-Identifier': safeSession,
            });
            await pms(
                `/video/:/transcode/universal/stop?${params}`,
                server,
                5000,
                { 'X-Plex-Session-Identifier': safeSession },
            ).catch(() => undefined);
        }
        return { ok: true };
    }
    if (method === 'GET') return {};
    return { ok: true };
};

const wikiText = (html: string) => html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const trimBiography = (text: string) => {
    const clean = String(text || '').trim();
    if (clean.length <= 2800) return clean;
    const cut = clean.slice(0, 2800);
    const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
    return (end > 600 ? cut.slice(0, end + 1) : cut).trim();
};

const wikiApiJson = async (url: string) => {
    const res = await fetch(url, {
        headers: {
            Accept: 'application/json',
            'User-Agent': 'SMP-Media-Player/1.0 (person-profile; +https://github.com)',
        },
    }).catch(() => null);
    if (!res?.ok) return null;
    return res.json().catch(() => null);
};

const wikidataTime = (entity: any, prop: string) => {
    const time = entity?.claims?.[prop]?.[0]?.mainsnak?.datavalue?.value?.time;
    const match = String(time || '').match(/\+(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return null;
    return `${match[1]}-${match[2]}-${match[3]}`;
};

const wikidataPlaceIds = (entity: any, prop: string) => {
    const claims = Array.isArray(entity?.claims?.[prop]) ? entity.claims[prop] : [];
    return claims
        .map((row: any) => String(row?.mainsnak?.datavalue?.value?.id || '').trim())
        .filter((id: string) => /^Q\d+$/.test(id));
};

const foldLoose = (value: string) => value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const loadWikidataEntityFacts = async (qid: string) => {
    if (!/^Q\d+$/.test(qid)) return null;
    const entityData = await wikiApiJson(
        `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${encodeURIComponent(qid)}&props=claims|labels&languages=en&format=json&origin=*`,
    );
    const entity = entityData?.entities?.[qid];
    if (!entity) return null;
    const birthday = wikidataTime(entity, 'P569');
    const deathday = wikidataTime(entity, 'P570');
    const birthIds = wikidataPlaceIds(entity, 'P19');
    const deathIds = wikidataPlaceIds(entity, 'P20');
    const placeIds = [...new Set([...birthIds, ...deathIds])].slice(0, 8);
    let placeOfBirth: string | null = null;
    let placeOfDeath: string | null = null;
    if (placeIds.length) {
        const labelsData = await wikiApiJson(
            `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${placeIds.map(encodeURIComponent).join('|')}&props=labels&languages=en&format=json&origin=*`,
        );
        const labelOf = (id: string) => String(labelsData?.entities?.[id]?.labels?.en?.value || '').trim() || null;
        placeOfBirth = birthIds.map(labelOf).find(Boolean) || null;
        placeOfDeath = deathIds.map(labelOf).find(Boolean) || null;
    }
    const label = String(entity?.labels?.en?.value || '').trim() || null;
    return { qid, label, birthday, deathday, placeOfBirth, placeOfDeath };
};

const loadWikidataPersonFacts = async (wikiTitle: string) => {
    const titleKey = encodeURIComponent(String(wikiTitle || '').replace(/ /g, '_'));
    if (!titleKey) return null;
    const pageData = await wikiApiJson(
        `https://en.wikipedia.org/w/api.php?action=query&prop=pageprops|extracts&ppprop=wikibase_item&explaintext=1&exsectionformat=plain&redirects=1&titles=${titleKey}&format=json&origin=*`,
    );
    const pages = pageData?.query?.pages || {};
    const page = Object.values(pages)[0] as {
        missing?: string;
        extract?: string;
        pageprops?: { wikibase_item?: string };
        title?: string;
    } | undefined;
    if (!page || page.missing != null) return null;
    const extract = trimBiography(wikiText(String(page.extract || '')));
    const qid = String(page.pageprops?.wikibase_item || '').trim();
    const entity = qid ? await loadWikidataEntityFacts(qid) : null;
    if (extract.length < 80 && !entity?.birthday) return null;
    return {
        name: String(page.title || wikiTitle).replace(/_/g, ' '),
        biography: extract.length >= 80 ? extract : null,
        birthday: entity?.birthday || null,
        deathday: entity?.deathday || null,
        placeOfBirth: entity?.placeOfBirth || null,
        placeOfDeath: entity?.placeOfDeath || null,
        knownForDepartment: /actor|actress|filmmaker|director|producer/i.test(extract.slice(0, 360))
            ? (/director|filmmaker|producer/i.test(extract.slice(0, 220)) ? 'Directing' : 'Acting')
            : null,
        profilePath: null,
    };
};

/** Direct mode has no TMDB key. Prefer Wikidata for DOB/place, Wikipedia for bio. */
const loadWikipediaPerson = async (name: string) => {
    const queryName = String(name || '').trim();
    if (queryName.length < 2 || /^\d+$/.test(queryName)) return null;
    const want = queryName.toLowerCase();

    // 1) Wikidata search — most reliable for birthday / place of birth / death.
    const wdSearch = await wikiApiJson(
        `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(queryName)}&language=en&uselang=en&type=item&limit=8&format=json&origin=*`,
    );
    const wdHits = Array.isArray(wdSearch?.search) ? wdSearch.search : [];
    for (const hit of wdHits) {
        const qid = String(hit?.id || '').trim();
        const label = String(hit?.label || '').trim();
        const desc = String(hit?.description || '').toLowerCase();
        if (!/^Q\d+$/.test(qid)) continue;
        if (label && foldLoose(label) !== foldLoose(queryName) && !foldLoose(label).includes(foldLoose(queryName))) {
            if (!/actor|actress|filmmaker|director|screenwriter|producer|cinematographer/.test(desc)) continue;
        }
        const entity = await loadWikidataEntityFacts(qid);
        if (!entity?.birthday && !entity?.placeOfBirth) continue;
        // Pull Wikipedia extract via sitelink when possible.
        const sitelinks = await wikiApiJson(
            `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${encodeURIComponent(qid)}&props=sitelinks&sitefilter=enwiki&format=json&origin=*`,
        );
        const wikiTitle = String(sitelinks?.entities?.[qid]?.sitelinks?.enwiki?.title || label || queryName).trim();
        const pageFacts = wikiTitle ? await loadWikidataPersonFacts(wikiTitle) : null;
        return {
            name: queryName,
            biography: pageFacts?.biography || null,
            birthday: entity.birthday || pageFacts?.birthday || null,
            deathday: entity.deathday || pageFacts?.deathday || null,
            placeOfBirth: entity.placeOfBirth || pageFacts?.placeOfBirth || null,
            placeOfDeath: entity.placeOfDeath || pageFacts?.placeOfDeath || null,
            knownForDepartment: pageFacts?.knownForDepartment
                || (/director|filmmaker/.test(desc) ? 'Directing' : (/actor|actress/.test(desc) ? 'Acting' : null)),
            profilePath: null,
        };
    }

    // 2) Wikipedia title search fallback.
    const searchData = await wikiApiJson(
        `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(queryName)}&format=json&origin=*&srlimit=8`,
    );
    const hits = Array.isArray(searchData?.query?.search) ? searchData.query.search : [];
    const ranked = hits
        .map((row: { title?: string; snippet?: string }) => ({
            title: String(row?.title || '').trim(),
            snippet: String(row?.snippet || '').replace(/<[^>]+>/g, ' ').toLowerCase(),
        }))
        .filter((row: { title: string }) => row.title && !/disambiguation/i.test(row.title))
        .sort((a: { title: string; snippet: string }, b: { title: string; snippet: string }) => {
            const score = (row: { title: string; snippet: string }) => {
                const title = row.title.toLowerCase();
                let value = 0;
                if (title === want) value += 8;
                else if (title.startsWith(want)) value += 4;
                else if (title.includes(want)) value += 2;
                if (/actor|actress|filmmaker|director|film|television|born/.test(row.snippet)) value += 3;
                return value;
            };
            return score(b) - score(a);
        });
    for (const row of ranked.slice(0, 4)) {
        const facts = await loadWikidataPersonFacts(row.title);
        if (!facts) continue;
        if (facts.biography || facts.birthday || facts.placeOfBirth) {
            return { ...facts, name: queryName };
        }
    }
    return null;
};

const wikiSentences = (text: string) => text
    .split(/(?<=[.!?])\s+/)
    .map((row) => row.trim())
    .filter((row) => row.length >= 40 && row.length <= 280);

/** Trivia for the native player. Title search against Wikipedia — no portal TMDB key needed. */
const WIKI_UA = 'SMP-Media-Player/1.0 (discovery-facts; +https://github.com)';

const wikiFetchJson = async (url: string) => {
    const res = await fetch(url, {
        headers: {
            Accept: 'application/json',
            'User-Agent': WIKI_UA,
        },
    });
    if (!res.ok) return null;
    return res.json().catch(() => null);
};

const loadDirectFacts = async (query: URLSearchParams) => {
    const mediaType = query.get('mediaType') === 'tv' ? 'tv' : 'movie';
    const title = String(query.get('title') || '').trim();
    const year = String(query.get('year') || '').trim();
    if (!title) return { facts: [], fact: null, sources: { wikipedia: 0, tmdb: 0 } };
    const suffix = mediaType === 'tv' ? 'television series' : 'film';
    const searchAttempts = [
        [title, year, suffix].filter(Boolean).join(' '),
        [title, suffix].filter(Boolean).join(' '),
        title,
    ];
    let pageTitle = '';
    const wanted = title.toLowerCase();
    for (const searchTerm of searchAttempts) {
        const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(searchTerm)}&format=json&origin=*&srlimit=8`;
        const searchData = await wikiFetchJson(searchUrl);
        const hits = Array.isArray(searchData?.query?.search) ? searchData.query.search : [];
        if (!hits.length) continue;
        const hit = hits.find((row: { title?: string }) => {
            const hitTitle = String(row?.title || '').toLowerCase();
            return hitTitle === wanted
                || hitTitle.startsWith(`${wanted} (`)
                || hitTitle.includes(wanted);
        }) || hits[0];
        pageTitle = String(hit?.title || '').trim();
        if (pageTitle) break;
    }
    if (!pageTitle) return { facts: [], fact: null, sources: { wikipedia: 0, tmdb: 0 } };

    const pageKey = encodeURIComponent(pageTitle.replace(/ /g, '_'));
    const textUrl = `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&exlimit=1&redirects=1&titles=${pageKey}&format=json&origin=*`;
    const textData = await wikiFetchJson(textUrl);
    const pages = textData?.query?.pages || {};
    const page = Object.values(pages)[0] as { extract?: string; missing?: boolean } | undefined;
    if (!page || page.missing != null) return { facts: [], fact: null, sources: { wikipedia: 0, tmdb: 0 } };
    const extract = wikiText(String(page.extract || ''));
    const withoutPlot = extract.replace(/==\s*(Plot|Synopsis|Premise|Episodes|Cast|Reception|References|External links|See also)\s*==[\s\S]*?(?===|$)/gi, ' ');
    const sentences = wikiSentences(withoutPlot);
    const interesting = sentences.filter((sentence) => (
        /budget|gross|award|oscar|nominat|direct|star|film|series|season|episode|based on|box office|premier|release|lawsuit|sue|acme|comedy|live-action|animation/i.test(sentence)
    ));
    const facts = (interesting.length >= 2 ? interesting : sentences).slice(0, 12);
    return {
        facts,
        fact: facts[0] || null,
        sources: { wikipedia: facts.length, tmdb: 0 },
    };
};

export const handlePlexDirectRequest = async (url: string, options: RequestInit = {}) => {
    const parsed = new URL(url, 'http://streampilot.local');
    const path = parsed.pathname.replace(/\/+$/, '') || '/';
    const method = String(options.method || 'GET').toUpperCase();
    let body: any = null;
    if (options.body && typeof options.body === 'string') {
        try { body = JSON.parse(options.body); } catch { body = null; }
    }
    if (path.startsWith('/api/auth/')) return handleAuth(path, method, body);
    if (path.startsWith('/api/media-player/')) {
        const cacheable = method === 'GET' && (
            path === '/api/media-player/home'
            || path === '/api/media-player/home-hero'
            || path === '/api/media-player/libraries'
        );
        const cacheKey = cacheable ? `${path}?${parsed.searchParams.toString()}` : '';
        if (cacheKey) {
            const hit = readPlayerGetCache(cacheKey);
            if (hit !== undefined) return hit;
        }
        const result = await handlePlayer(path, method, parsed.searchParams, body);
        if (cacheKey) writePlayerGetCache(cacheKey, result);
        if (method !== 'GET' && (
            path.includes('watched')
            || path.includes('timeline')
            || path.includes('home-hero-config')
            || path.includes('servers')
        )) {
            clearPlayerGetCache();
        }
        return result;
    }
    if (path === '/api/discovery/fact' && method === 'GET') {
        return loadDirectFacts(parsed.searchParams).catch(() => ({ facts: [], fact: null, sources: { wikipedia: 0, tmdb: 0 } }));
    }
    if (path.startsWith('/api/discovery/')) return method === 'GET' ? { results: [] } : { ok: true };
    if (path.startsWith('/api/notifications')) return { notifications: [] };
    return method === 'GET' ? {} : { ok: true };
};
