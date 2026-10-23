/**
 * Plex client that talks to plex.tv and the user's Plex Media Server directly.
 * Native CapacitorHttp patches fetch so the WebView is not blocked by CORS.
 */
import { mirrorAuthToNativeStorage } from './authPersistence';
import { getPortalBaseUrl, getSessionToken, readHomeAutoSignIn, readStoredPortalBaseUrl, writeStoredSessionToken } from './config';
import { STORAGE_PLEX_CLIENT_ID, STORAGE_PLEX_HOME_USER, STORAGE_PLEX_OWNER_TOKEN, STORAGE_PLEX_SERVER, STORAGE_PLEX_SERVERS } from './configStorageKeys';
import { DEFAULT_PLAYER_SETTINGS, type PlayerSettings } from '../media-player/playerSettings';
import { PLAYER_SERVERS_EVENT } from '../media-player/playerMemory';
import { PLAYER_HOME_LIVE_EVENT } from '../media-player/paths';
import {
    canHttpDirectPlay,
    isBitstreamAudioCodec,
    NATIVE_COPY_AUDIO_CODECS,
    subtitleCodecNeedsBurn,
} from '../../lib/media-player/directPlayCaps.js';
import { buildGenreRelatedHubs } from '../../lib/media-player/mapItem.js';
import {
    fillStudioBrowseArt,
    mapStudioBrowseOptions,
    STUDIO_BROWSE_ART_CONCURRENCY,
    STUDIO_BROWSE_FETCH,
} from '../../lib/media-player/studioBrowse.js';

type PlexServer = {
    id: string;
    name: string;
    uri: string;
    accessToken: string;
    /** On the home network (Plex "local", not relay). Missing on servers saved before this. */
    local?: boolean;
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
                // Plex agents often truncate mid-sentence; prefer the longer TMDB overview.
                if (candidate.overview) {
                    const plexSummary = String(mapped.summary || '').trim();
                    const tmdbOverview = String(candidate.overview || '').trim();
                    if (!plexSummary || tmdbOverview.length >= plexSummary.length + 12) {
                        mapped.summary = tmdbOverview;
                    } else if (!/[.!?…]"?'?$/.test(plexSummary) && /[.!?…]"?'?$/.test(tmdbOverview)) {
                        mapped.summary = tmdbOverview;
                    }
                }
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
        const next = globalThis.crypto?.randomUUID?.()
            || (() => {
                const bytes = new Uint8Array(16);
                globalThis.crypto?.getRandomValues?.(bytes);
                return `sp-${Date.now().toString(36)}-${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 12)}`;
            })();
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

/** Relative PMS image path, preserving `/thumb/<stamp>` cache busters. */
const libraryImagePath = (value: unknown) => {
    let raw = String(value || '').trim();
    if (!raw) return '';
    const libraryIdx = raw.indexOf('/library/');
    const hubsIdx = raw.indexOf('/hubs/');
    const idx = libraryIdx >= 0 ? libraryIdx : hubsIdx;
    if (idx > 0) raw = raw.slice(idx);
    if (!raw.startsWith('/library/') && !raw.startsWith('/hubs/')) return '';
    return raw.split('#')[0].split('?')[0];
};

const stampedThumbPath = (
    ratingKey: string | null | undefined,
    rawPath: unknown,
    updatedAt?: string | number | null,
) => {
    const key = String(ratingKey || '').replace(/\D/g, '');
    const existing = libraryImagePath(rawPath);
    if (key && existing.includes(`/library/metadata/${key}/thumb`)) return existing;
    const stamp = String(updatedAt ?? '').replace(/\D/g, '');
    if (key && stamp) return `/library/metadata/${key}/thumb/${stamp}`;
    if (key) return `/library/metadata/${key}/thumb`;
    return existing;
};

/**
 * Selected background, stamped with the owner's updatedAt.
 * Hub rows keep an old `/art/{stamp}` after the background changes in Plex,
 * and a bare `/art` path is cached for days. updatedAt is the current one.
 */
const stampedArtPath = (
    ratingKey: string | null | undefined,
    updatedAt: string | number | null | undefined,
    existingPath: unknown,
) => {
    const key = String(ratingKey || '').replace(/\D/g, '');
    const existing = libraryImagePath(existingPath);
    if (!key) return existing;
    if (existing && !existing.includes(`/library/metadata/${key}/`)) return existing;
    const stamp = String(updatedAt ?? '').replace(/\D/g, '');
    if (stamp) return `/library/metadata/${key}/art/${stamp}`;
    return existing || `/library/metadata/${key}/art`;
};

const imageUrl = (
    path: string | null | undefined,
    width: number,
    height: number,
    options?: { crop?: boolean; quality?: number },
) => {
    const server = mapServer || readServer();
    const value = String(path || '').trim();
    if (!value || !server) return null;
    if (/^https?:\/\//i.test(value)) return value;
    const url = new URL('/photo/:/transcode', server.uri.endsWith('/') ? server.uri : `${server.uri}/`);
    url.searchParams.set('width', String(width));
    url.searchParams.set('height', String(height));
    if (options?.crop !== false) url.searchParams.set('minSize', '1');
    url.searchParams.set('upscale', '0');
    // Match PLAYER_POSTER_QUALITY / PLAYER_BACKDROP_QUALITY (90).
    const quality = options?.quality != null ? options.quality : 90;
    url.searchParams.set('quality', String(quality));
    url.searchParams.set('url', value.startsWith('/') ? value : `/${value}`);
    url.searchParams.set('X-Plex-Token', server.accessToken);
    return url.toString();
};

const clearLogo = (meta: PlexMeta) => {
    const images = asList<PlexMeta>(meta.Image);
    const logo = images.find((image) => image.type === 'clearLogo');
    return logo?.url || meta.clearLogo || null;
};

/** Designed 16:9 Plex hero. Background art is a different file. */
const coverArtUrl = (meta: PlexMeta | null | undefined) => {
    const rows = asList<PlexMeta>(meta?.Image).filter((image) => (
        String(image?.type || '').toLowerCase() === 'coverart' && String(image?.url || '').trim()
    ));
    rows.sort((a, b) => (Number(b.width) || Number(b.height) || 0) - (Number(a.width) || Number(a.height) || 0));
    let url = String(rows[0]?.url || '').trim();
    if (url.startsWith('//')) url = `https:${url}`;
    return url.startsWith('https://') ? url : '';
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
    // meta.art is the background selected in Plex. The Image list can still
    // lead with the previous one, which is what left Wonka on its old art.
    const selected = String(meta.art || '').trim() || taggedBackground(meta) || String(meta.grandparentArt || '').trim();
    return stampedArtPath(meta.ratingKey, meta.updatedAt as string | number | null | undefined, selected);
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

/** Plex CommonSenseMedia → official AgeRating (age badge + stars / 5). */
const mapCommonSenseMedia = (meta: PlexMeta) => {
    const root = asList<PlexMeta>(meta.CommonSenseMedia)[0]
        || (meta.CommonSenseMedia && typeof meta.CommonSenseMedia === 'object'
            ? meta.CommonSenseMedia as PlexMeta
            : null);
    if (!root) return null;
    const ages = asList<PlexMeta>((root as PlexMeta).AgeRating);
    const official = ages.find((row) => String(row?.type || '').toLowerCase() === 'official')
        || ages[0]
        || null;
    if (!official) return null;
    const ageNum = Number(official.age);
    const starsNum = Number(official.rating);
    const age = Number.isFinite(ageNum) && ageNum > 0 ? Math.round(ageNum) : null;
    const stars = Number.isFinite(starsNum) && starsNum > 0 ? starsNum : null;
    if (age == null && stars == null) return null;
    return {
        age,
        ageLabel: age != null ? `${age}+` : null,
        stars,
        ageGroup: String(official.ageGroup || '').trim() || null,
        oneLiner: String((root as PlexMeta).oneLiner || '').trim() || null,
    };
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

/** Resume point in ms. Newer PMS nests this on UserState until includeUserState=1. */
const plexViewOffsetMs = (meta: PlexMeta) => {
    const direct = Number(meta?.viewOffset);
    if (direct) return direct;
    const raw = meta?.UserState || meta?.userState;
    const user = Array.isArray(raw) ? raw[0] : raw;
    const nested = Number(user?.viewOffset || user?.viewOffsetMs);
    return Number.isFinite(nested) ? nested : 0;
};

const normalizeItemType = (meta: PlexMeta) => {
    const raw = String(meta?.type ?? '').trim().toLowerCase();
    if (raw === '1') return 'movie';
    if (raw === '2') return 'show';
    if (raw === '3') return 'season';
    if (raw === '4') return 'episode';
    if (raw === '5' || raw === '12' || raw === 'trailer' || raw === 'clip') return 'clip';
    if (raw === '8' || raw === 'artist') return 'artist';
    if (raw === '9' || raw === 'album') return 'album';
    if (raw === '10' || raw === 'track') return 'track';
    if (meta?.extraType != null || String(meta?.subtype || '').trim()) return 'clip';
    return String(meta?.type || meta?.librarySectionType || 'movie');
};

const extraRatingKey = (meta: PlexMeta) => String(meta.ratingKey || '').trim()
    || String(meta.key || '').match(/\/metadata\/([^/?]+)/)?.[1]
    || '';

const isExtraMeta = (meta: PlexMeta) => {
    const type = String(meta?.type ?? '').trim().toLowerCase();
    return type === 'clip'
        || type === 'trailer'
        || type === '5'
        || type === '12'
        || meta?.extraType != null
        || String(meta?.subtype || '').trim() !== '';
};

const extractExtraMetas = (data: any): PlexMeta[] => {
    const container = containerOf(data);
    const top = asList<PlexMeta>(container.Metadata).concat(asList<PlexMeta>(container.Video));
    const nested = top.flatMap((row) => asList<PlexMeta>(row?.Extras?.Metadata).concat(asList<PlexMeta>(row?.Extras?.Video)));
    if (nested.length) return nested.filter(isExtraMeta);
    const extras = top.filter(isExtraMeta);
    return extras.length ? extras : [];
};

const mapItem = (meta: PlexMeta) => {
    const type = normalizeItemType(meta);
    const music = /^(artist|album|track|audio|music)$/i.test(String(meta.type || meta.librarySectionType || ''))
        || String(meta.librarySectionType || '').toLowerCase() === 'artist';
    const medias = asList<PlexMeta>(meta.Media);
    const firstPart = asList<PlexMeta>(medias[0]?.Part)[0];
    const { video, audio, subtitles } = mapStreams(firstPart || {});
    const viewedLeafCount = uniqueViewedLeafCount(meta);
    const leafTotal = Math.max(0, Number(meta.leafCount) || 0);
    const viewOffsetMs = plexViewOffsetMs(meta);
    const watched = type === 'show' || type === 'season'
        ? leafTotal > 0 && viewedLeafCount >= leafTotal
        : Number(meta.viewCount) > 0 && !viewOffsetMs;
    const { ids, ratings } = mapRatings(meta);
    return {
        ratingKey: extraRatingKey(meta) || String(meta.ratingKey || ''),
        title: String(meta.title || meta.grandparentTitle || 'Untitled'),
        showTitle: type === 'season' || type === 'album'
            ? (meta.parentTitle || meta.grandparentTitle || null)
            : (meta.grandparentTitle || null),
        seasonTitle: meta.parentTitle || null,
        type,
        year: meta.year ? Number(meta.year) : null,
        summary: String(meta.summary || ''),
        thumb: imageUrl(meta.thumb || meta.parentThumb || meta.grandparentThumb, 300, music ? 300 : 450),
        ...(music ? { cardAspect: 'square' as const } : {}),
        art: imageUrl(meta.art || meta.grandparentArt, 1920, 1080),
        heroArt: coverArtUrl(meta) || null,
        backdropArt: imageUrl(heroBackdropPath(meta, type), 1920, 1080, { crop: false }),
        logo: imageUrl(clearLogo(meta), 640, 240),
        // Keep stamped library paths so Continue Watching can remount show/season
        // posters after Plex art changes (imageUrl alone wraps the episode still).
        thumbPath: libraryImagePath(meta.thumb) || null,
        parentThumbPath: libraryImagePath(meta.parentThumb) || null,
        grandparentThumbPath: libraryImagePath(meta.grandparentThumb) || null,
        durationMs: meta.duration ? Number(meta.duration) : null,
        viewOffsetMs,
        index: meta.index != null ? Number(meta.index) : null,
        parentIndex: meta.parentIndex != null ? Number(meta.parentIndex) : null,
        leafCount: meta.leafCount != null ? Number(meta.leafCount) : null,
        viewedLeafCount,
        childCount: meta.childCount != null ? Number(meta.childCount) : null,
        parentRatingKey: meta.parentRatingKey ? String(meta.parentRatingKey) : null,
        grandparentRatingKey: meta.grandparentRatingKey ? String(meta.grandparentRatingKey) : null,
        contentRating: meta.contentRating || null,
        audienceRating: meta.audienceRating != null ? Number(meta.audienceRating) : null,
        commonSenseMedia: mapCommonSenseMedia(meta),
        userRating: Number(meta.userRating) > 0 ? Number(meta.userRating) : null,
        ratings,
        externalIds: ids,
        tmdbId: ids.tmdb,
        originallyAvailableAt: meta.originallyAvailableAt || null,
        genres: asList<PlexMeta>(meta.Genre).map((row) => String(row.tag || '')).filter(Boolean),
        addedAt: meta.addedAt ? Number(meta.addedAt) * 1000 : null,
        lastViewedAt: meta.lastViewedAt ? Number(meta.lastViewedAt) * 1000 : null,
        viewCount: Number(meta.viewCount) || 0,
        watched,
        extraType: meta.extraType != null ? String(meta.extraType) : null,
        plexGuid: String(meta.guid || '').trim() || null,
        showPlexGuid: String(
            meta.grandparentGuid
            || (String(meta.type || '').toLowerCase() === 'show' ? meta.guid : '')
            || (String(meta.type || '').toLowerCase() === 'season' ? meta.parentGuid : '')
            || '',
        ).trim() || null,
        extraSubtype: meta.subtype
            ? String(meta.subtype)
            : ((String(meta.type || '').toLowerCase() === 'trailer' || String(meta.type) === '5') ? 'trailer' : null),
        canPlay: type === 'movie' || type === 'episode' || type === 'show' || type === 'season' || type === 'clip' || type === 'trailer' || type === 'track' || type === 'album' || type === 'artist',
        tagline: meta.tagline || '',
        // TV → Plex Network first (same facet as Advanced Filters). Movies → Studio.
        studio: (() => {
            const isTv = type === 'show' || type === 'season' || type === 'episode';
            const network = String(asList<PlexMeta>(meta.Network)[0]?.tag || '').trim();
            const studio = String(meta.studio || asList<PlexMeta>(meta.Studio)[0]?.tag || '').trim();
            return isTv ? (network || studio) : (studio || network);
        })(),
        networkLabels: (() => {
            const labels: string[] = [];
            const push = (value: unknown) => {
                const next = String(value || '').trim();
                if (!next || labels.some((row) => row.toLowerCase() === next.toLowerCase())) return;
                labels.push(next);
            };
            // Only real Network tags — never meta.studio (can poison hydrate with Netflix).
            asList<PlexMeta>(meta.Network).forEach((row) => push(row?.tag));
            return labels;
        })(),
        studioLabels: (() => {
            const labels: string[] = [];
            const push = (value: unknown) => {
                const next = String(value || '').trim();
                if (!next || labels.some((row) => row.toLowerCase() === next.toLowerCase())) return;
                labels.push(next);
            };
            push(meta.studio);
            asList<PlexMeta>(meta.Studio).forEach((row) => push(row?.tag));
            asList<PlexMeta>(meta.Network).forEach((row) => push(row?.tag));
            // Labels stay for search/filters — not used as TV network logos.
            asList<PlexMeta>(meta.Label).forEach((row) => push(row?.tag));
            return labels;
        })(),
        // Episodes/seasons: series TMDB from grandparent Guid — never the episode leaf id.
        showTmdbId: (() => {
            if (type !== 'episode' && type !== 'season') {
                return ids.tmdb && ids.tmdb > 0 ? ids.tmdb : null;
            }
            const blobs = [
                meta.grandparentGuid,
                type === 'season' ? (meta.parentGuid || meta.guid) : meta.parentGuid,
            ];
            for (const raw of blobs) {
                const match = String(raw || '').match(/(?:tmdb|themoviedb):\/\/(\d+)/i);
                if (match) return Number(match[1]);
            }
            return null;
        })(),
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
                        frameRate: streams.video.frameRate ? Number(streams.video.frameRate) : null,
                        colorTrc: streams.video.colorTrc || null,
                        colorPrimaries: streams.video.colorPrimaries || null,
                        DOVIPresent: streams.video.DOVIPresent === true
                            || streams.video.DOVIPresent === 1
                            || String(streams.video.DOVIPresent || '').toLowerCase() === 'true'
                            || String(streams.video.DOVIPresent || '') === '1'
                            || null,
                        DOVIProfile: streams.video.DOVIProfile != null && streams.video.DOVIProfile !== ''
                            ? streams.video.DOVIProfile
                            : null,
                        videoDynamicRange: streams.video.videoDynamicRange || null,
                        videoDynamicRangeType: streams.video.videoDynamicRangeType || null,
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
        versions: medias.map((media, index) => {
            const part = asList<PlexMeta>(media.Part)[0] || {};
            const video = mapStreams(part).video;
            const scanType = String(video.scanType || '');
            const raw = String(media.videoResolution || '').trim();
            const lower = raw.toLowerCase();
            const letter = lower.match(/^(\d+)\s*([pi])$/)?.[2]
                || (/^i|interlace/i.test(scanType) ? 'i' : 'p');
            const height = Number(media.height) || Number(video.height) || 0;
            const resolution = lower.includes('4k') || lower.includes('2160') || height >= 2160
                ? '4K'
                : /^\d+\s*[pi]$/i.test(lower)
                    ? lower.replace(/\s+/g, '')
                    : /^\d+$/.test(lower)
                        ? `${lower}${letter}`
                        : height >= 1080
                            ? `1080${letter}`
                            : height >= 720
                                ? `720${letter}`
                                : height
                                    ? `${height}${letter}`
                                    : (raw || null);
            return {
            id: String(media.id || index),
            mediaIndex: index,
            label: resolution || `Version ${index + 1}`,
            resolution,
            scanType: scanType || null,
            videoCodec: media.videoCodec || video.codec || null,
            audioCodec: media.audioCodec || null,
            container: media.container || null,
            bitrate: media.bitrate ? Number(media.bitrate) : null,
            width: media.width ? Number(media.width) : null,
            height: media.height ? Number(media.height) : null,
            };
        }),
        markers: mapMarkers(meta),
        chapters: asList<PlexMeta>(meta.Chapter).map((row, index) => ({
            startMs: Number(row.startTimeOffset || 0),
            endMs: Number(row.endTimeOffset || 0) || undefined,
            title: String(row.tag || row.title || `Chapter ${index + 1}`),
            index: row.index != null ? Number(row.index) : index,
        })).filter((row) => Number.isFinite(row.startMs)),
        frameRate: (() => {
            const raw = video.frameRate || medias[0]?.videoFrameRate;
            const n = Number(raw);
            return Number.isFinite(n) && n > 0 ? n : null;
        })(),
    };
};

const mapMarkers = (meta: PlexMeta) => {
    const markers = asList<PlexMeta>(meta.Marker).concat(asList<PlexMeta>(meta.marker));
    const out: { intro: { startMs: number; endMs: number } | null; credits: { startMs: number; endMs: number } | null } = {
        intro: null,
        credits: null,
    };
    for (const row of markers) {
        const startMs = Number(row.startTimeOffset ?? row.start) || 0;
        const endMs = Number(row.endTimeOffset ?? row.end) || 0;
        if (endMs <= startMs) continue;
        const type = String(row.type || row.markerType || '').toLowerCase();
        const marker = { startMs, endMs };
        if ((type === 'intro' || type === 'introend') && !out.intro) out.intro = marker;
        if ((type === 'credits' || type === 'credit' || type === 'creditsend') && !out.credits) out.credits = marker;
    }
    return out;
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

const sectionTitleFallback = (type: string) => {
    const kind = String(type || '').toLowerCase();
    if (kind === 'show') return 'TV Shows';
    if (kind === 'artist') return 'Music';
    if (kind === 'photo') return 'Photos';
    return 'Movies';
};

const mapSections = (data: any) => asList<PlexMeta>(containerOf(data).Directory)
    .filter((row) => row.key)
    .map((row) => {
        const type = String(row.type || 'movie');
        const title = String(row.title || '').trim() || sectionTitleFallback(type);
        return {
            key: String(row.key),
            title,
            type,
            agent: row.agent || '',
        };
    });

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

const FILTER_FACET_CAP = 250;

/** Plex section facet Directory → { key, title } for /all?facet=… filters. */
const mapFilterFacet = (data: any, facet: string) => {
    const param = String(facet || '').trim();
    const rows = asList<PlexMeta>(containerOf(data).Directory).map((row) => {
        const title = String(row.title || row.tag || '').trim();
        const keyRaw = String(row.key || row.id || '').trim();
        const fast = String(row.fastKey || '');
        const fromFast = param && fast
            ? fast.match(new RegExp(`[?&]${param}=([^&]+)`, 'i'))
            : null;
        let key = fromFast
            ? decodeURIComponent(fromFast[1])
            : (keyRaw && !keyRaw.startsWith('/') ? keyRaw : '');
        if (!key && param) {
            const fromKey = keyRaw.match(new RegExp(`(?:${param}\\/)?([^/?&=]+)$`, 'i'));
            key = fromKey?.[1] ? decodeURIComponent(fromKey[1]) : '';
        }
        if (!key) key = String(row.tag || title || '').trim();
        return { key, title: title || key };
    }).filter((row) => row.key && row.title);
    const seen = new Set<string>();
    const unique = rows.filter((row) => {
        if (seen.has(row.key)) return false;
        seen.add(row.key);
        return true;
    });
    if (unique.length <= FILTER_FACET_CAP) return unique;
    return unique
        .slice()
        .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }))
        .slice(0, FILTER_FACET_CAP);
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

/** Reachability check for sidebar offline marks. Keep generous — TV LAN wake / TLS
 *  handshakes often exceed 1–2s; a false offline badge is worse than a slow green. */
const probeOnce = (uri: string, token: string, timeoutMs: number) => new Promise<boolean>((resolve) => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
        controller.abort();
        resolve(false);
    }, timeoutMs);
    const base = uri.replace(/\/+$/, '');
    fetch(`${base}/identity`, {
        headers: plexHeaders(token),
        signal: controller.signal,
        cache: 'no-store',
    }).then((response) => {
        window.clearTimeout(timer);
        resolve(!!response?.ok);
    }).catch(() => {
        window.clearTimeout(timer);
        resolve(false);
    });
});

const probe = async (uri: string, token: string) => {
    if (await probeOnce(uri, token, 4500)) return true;
    // Second try: PMS often answers after wake / first TLS fail.
    return probeOnce(uri, token, 6000);
};


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
    return { id, name, uri, accessToken, local: isLocalConnection(connection) };
};

const PRIVATE_IPV4 = /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/;

/** Home network? Uses the saved Plex flag, else reads the IP out of the address. */
const serverIsLocal = (server: PlexServer | null) => {
    if (!server) return false;
    if (typeof server.local === 'boolean') return server.local;
    try {
        const host = new URL(server.uri).hostname.toLowerCase();
        // 192-168-1-6.<hash>.plex.direct → 192.168.1.6
        const plexDirect = host.match(/^(\d+-\d+-\d+-\d+)\.[a-f0-9]+\.plex\.direct$/);
        const ip = plexDirect ? plexDirect[1].replace(/-/g, '.') : host;
        return ip === 'localhost' || PRIVATE_IPV4.test(ip);
    } catch {
        return false;
    }
};

/** Phone on mobile data counts as away even when the server address looks local. */
const onMobileData = () => {
    try {
        const type = String((navigator as Navigator & { connection?: { type?: string } }).connection?.type || '');
        return type === 'cellular';
    } catch {
        return false;
    }
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
            return { id, name: String(resource.name || 'Plex'), uri, accessToken, local: false };
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

const resetServerDiscovery = () => {
    serversPromise = null;
    try { clearPlayerGetCache(); } catch { /* ignore */ }
};

export const selectPlexServer = async (token: string, { force = false } = {}) => {
    if (force) resetServerDiscovery();
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

const readPlayerSetting = <T,>(key: string, fallback: T): T => {
    try {
        const raw = window.localStorage?.getItem('portal-media-player-settings');
        if (!raw) return fallback;
        const parsed = JSON.parse(raw);
        if (parsed == null || parsed[key] === undefined) return fallback;
        return parsed[key] as T;
    } catch {
        return fallback;
    }
};

const nativeBurnSubtitlesMode = (): 'auto' | 'always' | 'image' => {
    const mode = String(readPlayerSetting('burnSubtitles', 'auto') || 'auto').toLowerCase();
    if (mode === 'always' || mode === 'image') return mode;
    return 'auto';
};

const nativeAudioBoost = () => {
    const n = Number(readPlayerSetting('audioBoost', 100));
    if (n === 200 || n === 300) return n;
    return 100;
};

const nativeAudioPassthroughEnabled = () => {
    try {
        const raw = window.localStorage?.getItem('portal-media-player-settings');
        if (!raw) return false;
        const parsed = JSON.parse(raw);
        // Opt-in only — TrueHD/DTS DP hard-crashes SoCs without real HDMI passthrough.
        return parsed?.audioPassthrough === true;
    } catch {
        return false;
    }
};

const nativeAudioPlayable = (stream?: PlexMeta | null) => {
    // EAC3/AC3/AAC/FLAC always Direct Play like official Plex. Only TrueHD/DTS need Bitstream.
    if (!isBitstreamAudioCodec(stream?.codec)) return true;
    return nativeAudioPassthroughEnabled();
};

const isTextSubtitle = (stream?: PlexMeta | null) => (
    !subtitleCodecNeedsBurn(stream?.codec, nativeBurnSubtitlesMode())
);

const clampPlayOffsetMs = (offsetMs: number, durationMs: number) => {
    const offset = Math.max(0, Number(offsetMs) || 0);
    const duration = Math.max(0, Number(durationMs) || 0);
    if (offset < 5000) return 0;
    if (duration && offset > Math.max(0, duration - 15000)) return 0;
    return Math.floor(offset);
};

const pickAudioId = (audio: PlexMeta[], requested: string, language: string) => {
    const want = String(requested || '').replace(/\D/g, '');
    if (want) {
        const hit = audio.find((stream) => String(stream.id || '') === want);
        // Honor the request only when Exo can Direct Play it (bitstream needs Settings → Bitstream).
        if (hit && nativeAudioPlayable(hit)) return want;
    }
    const lang = String(language || '').toLowerCase().trim();
    const langBase = lang.split(/[-_]/)[0];
    const matchesLang = (stream: PlexMeta) => {
        if (!lang) return true;
        const blob = String(stream.languageTag || stream.languageCode || stream.language || '').toLowerCase();
        return blob === lang || blob.startsWith(langBase) || blob.includes(langBase);
    };
    // Prefer AC3/EAC3/AAC over falling into HLS+AAC transcode when TrueHD/DTS is blocked.
    const playable = audio.filter((stream) => nativeAudioPlayable(stream));
    const pool = playable.length ? playable : audio;
    const langHit = lang ? pool.find((stream) => matchesLang(stream)) : null;
    if (langHit?.id) return String(langHit.id);
    const selected = pool.find((stream) => stream.selected === 1 || stream.selected === true);
    return String(selected?.id || pool[0]?.id || audio[0]?.id || '');
};

const pickSubtitleId = (subtitles: PlexMeta[], requested: string | null, mode: string) => {
    const text = subtitles.filter((stream) => isTextSubtitle(stream));
    if (requested != null) {
        const raw = String(requested).trim();
        // "0" is Off. A missing match must stay off, or a seek turns forced subs back on.
        if (!raw || raw === '0') return '';
        const want = raw.replace(/\D/g, '');
        if (!want || want === '0') return '';
        if (text.some((stream) => String(stream.id || '') === want)) return want;
        return '';
    }
    if (mode === 'off' || !text.length) return '';
    if (mode === 'forced') {
        const forced = text.find((stream) => stream.forced === 1 || stream.forced === true);
        return forced?.id ? String(forced.id) : '';
    }
    const selected = text.find((stream) => stream.selected === 1 || stream.selected === true);
    return String(selected?.id || text[0]?.id || '');
};

const PLAY_SESSION_REUSE = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|smp-[a-z0-9-]{6,40}|plex-\d{1,16})$/i;

const playSrc = (
    meta: PlexMeta,
    mediaIndex: number,
    qualityId: string,
    audioStreamId = '',
    subtitleStreamId = '',
    offsetMs = 0,
    forceHls = false,
    reuseSessionId = '',
) => {
    const server = mapServer || readServer();
    if (!server) throw new Error('No Plex server selected');
    const medias = asList<PlexMeta>(meta.Media);
    const media = medias[mediaIndex] || medias[0] || {};
    const part = asList<PlexMeta>(media?.Part)[0] || null;
    const quality = QUALITIES.find((row) => row.id === qualityId);
    let audioId = String(audioStreamId || '').replace(/\D/g, '');
    const rawSubtitleId = String(subtitleStreamId || '');
    const subtitleId = rawSubtitleId.startsWith('os:') ? '' : rawSubtitleId.replace(/\D/g, '');
    const audioStreams = asList<PlexMeta>(part?.Stream).filter((stream) => Number(stream.streamType) === 2);
    const selectedAudio = audioStreams.find((stream) => stream.selected === 1 || stream.selected === true);
    let chosenAudio = (audioId ? audioStreams.find((stream) => String(stream.id || '') === audioId) : null)
        || selectedAudio
        || audioStreams[0]
        || {};
    const passthrough = nativeAudioPassthroughEnabled();
    const reuse = String(reuseSessionId || '').trim();
    const session = PLAY_SESSION_REUSE.test(reuse)
        ? reuse
        : (() => {
            const bytes = new Uint8Array(6);
            globalThis.crypto?.getRandomValues?.(bytes);
            const suffix = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
            return `smp-${Date.now().toString(36)}-${suffix}`;
        })();
    const hasVideo = asList<PlexMeta>(part?.Stream).some((stream) => Number(stream.streamType) === 1);
    const audioOnly = !hasVideo;
    // Text subs (SRT/ASS/…) can Direct Play — ExoPlayer selects the embedded track.
    // Image subs (PGS/VobSub) still need a burn-in transcode.
    const subStream = subtitleId
        ? asList<PlexMeta>(part?.Stream).find((stream) => (
            Number(stream.streamType) === 3 && String(stream.id || '') === subtitleId
        ))
        : null;
    // Only burn when we know the stream is image-based. Missing metadata must not
    // force burn-in (that stacks under Exo text captions during quality swaps).
    const burnSubtitles = Boolean(subtitleId) && !!subStream
        && subtitleCodecNeedsBurn(subStream.codec, nativeBurnSubtitlesMode());
    const capsForAudio = (id: string) => canHttpDirectPlay(meta, {
        client: 'android',
        mediaIndex,
        audioStreamId: id,
        subtitleStreamId: subtitleId,
        audioPassthrough: passthrough,
    });
    // Bitstream off + TrueHD/DTS → switch to AC3/AAC track so we Direct Play instead of HLS+AAC.
    let capsOk = capsForAudio(audioId) && nativeAudioPlayable(chosenAudio);
    if (!capsOk && !passthrough) {
        const alt = audioStreams.find((stream) => {
            const id = String(stream.id || '').replace(/\D/g, '');
            return id && nativeAudioPlayable(stream) && capsForAudio(id);
        });
        if (alt?.id) {
            audioId = String(alt.id).replace(/\D/g, '');
            chosenAudio = alt;
            capsOk = true;
        }
    }
    const audioOk = nativeAudioPlayable(chosenAudio);
    // Prefer Direct Play/Stream. Scrub on unseekable parts still remuxes via seek→HLS.
    const direct = !forceHls && !burnSubtitles && capsOk && !!part?.key && (
        audioOnly || !quality || quality.id === 'original'
    );
    const metadataPath = String(meta.key || '').startsWith('/')
        ? String(meta.key).split('?')[0]
        : `/library/metadata/${encodeURIComponent(String(meta.ratingKey || ''))}`;
    if (direct && part?.key) {
        const rawKey = String(part.key);
        if (/^https?:\/\//i.test(rawKey)) {
            try {
                const url = new URL(rawKey);
                if (!url.searchParams.get('X-Plex-Token')) url.searchParams.set('X-Plex-Token', server.accessToken);
                url.searchParams.set('X-Plex-Client-Identifier', clientId());
                url.searchParams.set('X-Plex-Product', 'StreamPilot');
                url.searchParams.set('X-Plex-Platform', 'Android');
                url.searchParams.set('X-Plex-Device', 'Android TV');
                url.searchParams.set('X-Plex-Session-Identifier', session);
                url.searchParams.set('session', session);
                return { src: url.toString(), mode: 'directPlay' as const, media, part, sessionId: session };
            } catch { /* fall through to PMS path */ }
        }
        const filePath = rawKey.startsWith('http') ? new URL(rawKey).pathname : rawKey;
        const url = new URL(filePath.startsWith('/') ? filePath : `/${filePath}`, `${server.uri}/`);
        url.searchParams.set('X-Plex-Token', server.accessToken);
        url.searchParams.set('X-Plex-Client-Identifier', clientId());
        url.searchParams.set('X-Plex-Product', 'StreamPilot');
        url.searchParams.set('X-Plex-Platform', 'Android');
        url.searchParams.set('X-Plex-Device', 'Android TV');
        url.searchParams.set('X-Plex-Session-Identifier', session);
        url.searchParams.set('session', session);
        return { src: url.toString(), mode: 'directPlay' as const, media, part, sessionId: session };
    }
    if (audioOnly) {
        const url = new URL('/music/:/transcode/universal/start.m3u8', `${server.uri}/`);
        const offsetSec = Math.max(0, Math.floor(Number(offsetMs) / 1000));
        const params: Record<string, string> = {
            hasMDE: '1',
            path: metadataPath,
            mediaIndex: String(medias.indexOf(media) >= 0 ? medias.indexOf(media) : 0),
            partIndex: '0',
            protocol: 'hls',
            fastSeek: '1',
            directPlay: '0',
            directStream: audioOk ? '1' : '0',
            directStreamAudio: audioOk ? '1' : '0',
            audioCodec: audioOk ? String(chosenAudio.codec || 'mp3') : 'aac',
            session,
            ...(offsetSec > 0 ? { offset: String(offsetSec) } : {}),
            ...(audioId ? { audioStreamID: audioId } : {}),
            'X-Plex-Platform': 'Android',
            'X-Plex-Client-Identifier': clientId(),
            'X-Plex-Product': 'StreamPilot',
            'X-Plex-Device': 'Android TV',
            'X-Plex-Session-Identifier': session,
            'X-Plex-Token': server.accessToken,
            access_token: server.accessToken,
        };
        Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
        return { src: url.toString(), mode: 'transcode' as const, media, part: part || {}, sessionId: session };
    }
    const url = new URL('/video/:/transcode/universal/start.m3u8', `${server.uri}/`);
    const offsetSec = Math.max(0, Math.floor(Number(offsetMs) / 1000));
    const params: Record<string, string> = {
        hasMDE: '1',
        path: metadataPath,
        mediaIndex: String(medias.indexOf(media) >= 0 ? medias.indexOf(media) : 0),
        partIndex: '0',
        protocol: 'hls',
        fastSeek: '1',
        directPlay: '0',
        directStream: burnSubtitles || (quality && quality.id !== 'original') ? '0' : '1',
        directStreamAudio: audioOk ? '1' : '0',
        // Tell PMS we accept EAC3/AC3 on remux — omitting this made some servers convert to AAC.
        audioCodec: audioOk ? NATIVE_COPY_AUDIO_CODECS : 'aac',
        ...(audioOk ? {} : { maxAudioChannels: '2' }),
        subtitleSize: burnSubtitles ? '100' : '0',
        subtitles: burnSubtitles ? 'burn' : 'none',
        advancedSubtitles: burnSubtitles ? 'burn' : 'none',
        session,
        ...(offsetSec > 0 ? { offset: String(offsetSec) } : {}),
        ...(audioId ? { audioStreamID: audioId } : {}),
        subtitleStreamID: burnSubtitles ? subtitleId : '0',
        audioBoost: String(nativeAudioBoost()),
        videoQuality: String(quality?.videoQuality || 100),
        videoResolution: quality?.videoResolution || '3840x2160',
        maxVideoBitrate: String(quality?.maxVideoBitrate || 200000),
        'X-Plex-Platform': 'Android',
        'X-Plex-Client-Identifier': clientId(),
        'X-Plex-Product': 'StreamPilot',
        'X-Plex-Device': 'Android TV',
        'X-Plex-Session-Identifier': session,
        'X-Plex-Token': server.accessToken,
        access_token: server.accessToken,
    };
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
    return { src: url.toString(), mode: 'transcode' as const, media, part: part || {}, sessionId: session };
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
    const data = await pms(`/library/metadata/${encodeURIComponent(ratingKey)}?includeGuids=1&includeImages=1&includeMarkers=1&includeChapters=1&includeOnDeck=1&includeUserState=1`, server);
    const meta = asList<PlexMeta>(containerOf(data).Metadata)[0];
    if (!meta) throw new Error('Title not found');
    return meta;
};

/** Plex invents a synthetic “All episodes” season unless excludeAllLeaves=1 on shows. */
const isAllEpisodesSeason = (row: { type?: string | null; title?: string | null; index?: number | null }) => {
    if (String(row?.type || '') !== 'season') return false;
    if (Number(row?.index) === -1) return true;
    return /^all\s+episodes$/i.test(String(row?.title || '').trim());
};

const childrenOf = async (
    ratingKey: string,
    server: PlexServer | null = resolveServer('', ratingKey),
    opts: { excludeAllLeaves?: boolean } = {},
) => withMapServer(server, async () => {
    const qs = [
        opts.excludeAllLeaves ? 'excludeAllLeaves=1' : '',
        'includeUserState=1',
        'X-Plex-Container-Size=500',
    ].filter(Boolean).join('&');
    const data = await pms(
        `/library/metadata/${encodeURIComponent(ratingKey)}/children?${qs}`,
        server,
    ).catch(() => null);
    let items = mapList(data);
    if (opts.excludeAllLeaves) items = items.filter((row) => !isAllEpisodesSeason(row));
    if (items.length) return items;
    const playlist = await pms(`/playlists/${encodeURIComponent(ratingKey)}/items?includeUserState=1&X-Plex-Container-Size=500`, server).catch(() => null);
    return mapList(playlist);
});

const extraMetaByKey = new Map<string, PlexMeta>();

const mapExtrasList = (rows: PlexMeta[], parentKey = '') => {
    const parent = String(parentKey || '');
    const seen = new Set<string>();
    return rows.map((meta) => {
        const key = extraRatingKey(meta);
        if (key) extraMetaByKey.set(key, meta);
        return mapItem({
            ...meta,
            ratingKey: key,
            type: 'clip',
            extraType: meta.extraType != null
                ? meta.extraType
                : (String(meta.type || '').toLowerCase() === 'trailer' || String(meta.type) === '5' ? 1 : meta.extraType),
            subtype: meta.subtype || (String(meta.type || '').toLowerCase() === 'trailer' ? 'trailer' : meta.subtype),
        });
    }).filter((item) => {
        if (!item.ratingKey || item.ratingKey === parent || seen.has(item.ratingKey)) return false;
        seen.add(item.ratingKey);
        return true;
    });
};

const plexGuidRatingKey = (meta: PlexMeta | null | undefined) => {
    const fromGuid = String(meta?.guid || '').match(/^plex:\/\/(?:movie|show|season|episode)\/([a-f0-9]+)/i);
    if (fromGuid) return fromGuid[1];
    for (const row of asList<PlexMeta>(meta?.Guid)) {
        const hit = String(row.id || row.tag || '').match(/^plex:\/\/(?:movie|show|season|episode)\/([a-f0-9]+)/i);
        if (hit) return hit[1];
    }
    return '';
};

const loadItemExtras = async (ratingKey: string, server: PlexServer, parentMeta?: PlexMeta | null) => {
    const fromPath = await pms(
        `/library/metadata/${encodeURIComponent(ratingKey)}/extras?includeGuids=1`,
        server,
        8000,
    ).catch(() => null);
    let rows = extractExtraMetas(fromPath);
    let seed = parentMeta || null;
    if (!rows.length) {
        const withExtras = await pms(
            `/library/metadata/${encodeURIComponent(ratingKey)}?includeExtras=1&includeGuids=1`,
            server,
            8000,
        ).catch(() => null);
        rows = extractExtraMetas(withExtras);
        seed = seed || asList<PlexMeta>(containerOf(withExtras).Metadata)[0] || null;
    }
    if (!rows.length && seed) {
        rows = extractExtraMetas({ MediaContainer: { Metadata: [seed] } });
    }
    if (!rows.length) {
        const guidKey = plexGuidRatingKey(seed);
        const token = accountToken() || server.accessToken;
        if (guidKey && token) {
            const remote = await plexFetch(
                `https://metadata.provider.plex.tv/library/metadata/${encodeURIComponent(guidKey)}/extras?includeGuids=1`,
                token,
            ).catch(() => null);
            rows = extractExtraMetas(remote);
        }
    }
    return mapExtrasList(rows, ratingKey);
};

/** Next unwatched episode for a show/season, else the first episode. */
const resolvePlayableEpisode = async (ratingKey: string, server: PlexServer, seedType?: string) => {
    const type = String(seedType || '').toLowerCase();
    if (type && type !== 'show' && type !== 'season') return null;
    const unwatched = await pms(
        `/library/metadata/${encodeURIComponent(ratingKey)}/allLeaves?unwatched=1&includeUserState=1&X-Plex-Container-Start=0&X-Plex-Container-Size=1`,
        server,
    ).catch(() => null);
    const next = mapList(unwatched)[0];
    if (next?.type === 'episode') return next;
    const first = await pms(
        `/library/metadata/${encodeURIComponent(ratingKey)}/allLeaves?includeUserState=1&X-Plex-Container-Start=0&X-Plex-Container-Size=1`,
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

const homeUserThumb = (raw: PlexMeta) => {
    const value = String(raw.thumb || raw.avatar || '').trim();
    if (!value) return null;
    if (value.startsWith('//')) return `https:${value}`;
    return value;
};

const normalizeHomeUser = (raw: PlexMeta | null | undefined): HomeUser | null => {
    if (!raw || typeof raw !== 'object') return null;
    // Never treat the Plex Home container ({ id, name: "X's home", users: [...] }) as a profile.
    if (raw.users != null || raw.User != null) return null;
    const id = String(raw.id || raw.userID || raw.userId || raw.uuid || '').trim();
    if (!id) return null;
    const friendly = String(raw.friendlyName || '').trim();
    const title = String(raw.title || '').trim();
    const username = String(raw.username || '').trim();
    return {
        id,
        uuid: String(raw.uuid || '').trim(),
        // Do not fall back to `name` — that is the Home container title ("Jason's home").
        title: friendly || title || username || 'Plex User',
        username,
        thumb: homeUserThumb(raw),
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

/** Expand Plex Home user lists from JSON (array, single user, or { user: [...] }). */
const expandHomeUserCandidate = (candidate: unknown): PlexMeta[] => {
    if (candidate == null) return [];
    if (Array.isArray(candidate)) return candidate as PlexMeta[];
    if (typeof candidate !== 'object') return [];
    const row = candidate as PlexMeta & { user?: unknown; User?: unknown };
    if (Array.isArray(row.user)) return row.user as PlexMeta[];
    if (Array.isArray(row.User)) return row.User as PlexMeta[];
    if (row.user && typeof row.user === 'object') return asList(row.user as PlexMeta);
    if (row.User && typeof row.User === 'object') return asList(row.User as PlexMeta);
    if (row.id != null || row.uuid != null) return [row];
    return [];
};

const parseHomeUsers = (payload: any): HomeUser[] => {
    if (!payload) return [];
    if (Array.isArray(payload)) {
        return payload.map(normalizeHomeUser).filter((user): user is HomeUser => !!user);
    }
    if (typeof payload !== 'object') return [];
    // Prefer nested profile lists. Never map the home root ({ name: "X's home" }) first.
    const lists = [
        payload.users,
        payload.user,
        payload.User,
        payload.MediaContainer?.User,
        payload.MediaContainer?.user,
        payload.MediaContainer?.users,
        payload.mediaContainer?.User,
    ];
    for (const candidate of lists) {
        if (candidate == null) continue;
        const users = expandHomeUserCandidate(candidate)
            .map(normalizeHomeUser)
            .filter((user): user is HomeUser => !!user);
        if (users.length) return users;
    }
    return [];
};

const parseHomeUsersXml = (xml: string): HomeUser[] => {
    const users: HomeUser[] = [];
    // v2 uses lowercase <user>; older home/users uses <User>.
    const re = /<user\b([^>]*)\/?>/gi;
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
    const load = async (url: string, asJson: boolean) => {
        const data = await plexFetch(url, token, asJson ? {} : {
            headers: { Accept: 'application/xml' },
        }).catch(() => null);
        if (data == null) return [];
        if (typeof data === 'string') return parseHomeUsersXml(data);
        const users = parseHomeUsers(data);
        if (users.length) return users;
        return [];
    };
    const v2Json = await load(`${PLEX_TV}/api/v2/home/users`, true).catch(() => []);
    if (v2Json.length) return v2Json;
    const v2Xml = await load(`${PLEX_TV}/api/v2/home/users`, false).catch(() => []);
    if (v2Xml.length) return v2Xml;
    const v1Json = await load(`${PLEX_TV}/api/home/users`, true).catch(() => []);
    if (v1Json.length) return v1Json;
    return load(`${PLEX_TV}/api/home/users`, false).catch(() => []);
};

const sameHomeUser = (user: HomeUser, targetId: string) => {
    const want = String(targetId || '').trim();
    return !!want && (user.id === want || user.uuid === want);
};

const extractSwitchToken = (raw: string) => {
    try {
        const parsed = JSON.parse(raw);
        return String(
            parsed?.authToken
            || parsed?.authenticationToken
            || parsed?.user?.authToken
            || parsed?.user?.authenticationToken
            || parsed?.User?.authToken
            || parsed?.User?.authenticationToken
            || '',
        ).trim();
    } catch { /* XML */ }
    const match = raw.match(/\b(?:authenticationToken|authToken)="([^"]+)"/i);
    return match ? match[1] : '';
};

const switchHomeProfile = async (userId: string, pin?: string) => {
    const owner = readOwnerToken();
    if (!owner) throw new Error('Sign in with Plex again to switch profiles.');
    const users = await fetchHomeUsers(owner);
    const target = users.find((user) => sameHomeUser(user, userId));
    if (!target) throw new Error('That Plex Home profile is no longer available.');
    const applyProfile = async (authToken: string) => {
        try {
            await selectPlexServer(authToken, { force: true });
        } catch {
            // Cold first login: discovery can miss every connection before they warm up.
            // The PIN was right, so retry here instead of making the user enter it again.
            await selectPlexServer(authToken, { force: true });
        }
        writeHomeUserId(target.id);
        writeStoredSessionToken(authToken);
        return authToken;
    };
    if (sameHomeUser(target, readHomeUserId()) && accountToken() && !pin) {
        const current = accountToken();
        if (target.admin && current === owner) return applyProfile(owner);
    }
    if (target.admin && !target.protected) {
        return applyProfile(owner);
    }
    const pinValue = String(pin || '').trim();
    const qs = pinValue ? `?pin=${encodeURIComponent(pinValue)}` : '';
    const urls = [...new Set([
        target.uuid ? `${PLEX_TV}/api/v2/home/users/${encodeURIComponent(target.uuid)}/switch` : '',
        `${PLEX_TV}/api/home/users/${encodeURIComponent(target.id)}/switch`,
        target.uuid && target.uuid !== target.id
            ? `${PLEX_TV}/api/v2/home/users/${encodeURIComponent(target.id)}/switch`
            : '',
    ].filter(Boolean))];
    let pinRejected = false;
    for (const base of urls) {
        const response = await fetch(`${base}${qs}`, {
            method: 'POST',
            headers: plexHeaders(owner),
            cache: 'no-store',
        });
        const raw = await response.text().catch(() => '');
        if (response.status === 401 || response.status === 403) {
            pinRejected = true;
            continue;
        }
        if (!response.ok) continue;
        const authToken = extractSwitchToken(raw);
        if (authToken) return applyProfile(authToken);
    }
    if (pinRejected && pinValue) throw new Error('Incorrect PIN. Try again.');
    throw new Error(pinRejected || target.protected
        ? 'Enter the PIN for this profile.'
        : 'Could not switch to that Plex Home profile.');
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
            return {
                needsHomeSelect: true,
                users: users.map(publicHomeUser),
                homeSelectToken: 'direct',
                rememberUserId: readHomeUserId() || null,
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
            // Auto sign-in: report the profile in use as remembered so the TV launch
            // picker (and its PIN) is skipped. Switching profiles still asks for the PIN.
            rememberUserId: readHomeAutoSignIn()
                ? (readHomeUserId() || users.find((user) => user.admin)?.id || null)
                : null,
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
    /continue\s*watch|ondeck|on[.\s_-]?deck|in[.\s_-]?progress/i.test(`${hub.identifier || ''} ${hub.title || ''}`)
);

const becauseHub = (hub: { identifier?: string; title?: string }) => (
    /^because:/i.test(String(hub.identifier || ''))
    || /because you watched/i.test(String(hub.title || ''))
);

const playlistHomeHub = (hub: { identifier?: string; title?: string }) => (
    /playlist/i.test(`${hub.identifier || ''} ${hub.title || ''}`)
);

const contentHomeHub = (hub: { identifier?: string; title?: string; items?: unknown[] }) => (
    !!hub.items?.length && !continueHub(hub) && !becauseHub(hub) && !playlistHomeHub(hub)
);

/** Per-library Recently Added we invent when Plex sent no pins. Not a pin. */
const syntheticRecentHub = (hub: { identifier?: string }) => (
    /^recentlyadded\./i.test(String(hub.identifier || ''))
);

const realPinnedHub = (hub: { identifier?: string; title?: string; items?: unknown[] }) => (
    contentHomeHub(hub) && !syntheticRecentHub(hub)
);

const currentEpisodeThumbPath = (meta: PlexMeta) => (
    stampedThumbPath(String(meta.ratingKey || ''), meta.thumb, meta.updatedAt as string | number | null | undefined)
);

/**
 * Match portal mapContinueWatchingItem: Continuity cards use the show (or season)
 * poster — never the episode still — and keep Plex's stamped thumb paths so poster
 * swaps show up on a fresh Stream Pilot install.
 */
type MappedPlayerItem = ReturnType<typeof mapItem> & {
    thumbPath?: string | null;
    parentThumbPath?: string | null;
    grandparentThumbPath?: string | null;
    episodeThumb?: string | null;
    episodeTitle?: string | null;
    preferSeasonPoster?: boolean;
};

const asContinueWatchingItem = (
    item: MappedPlayerItem,
    meta?: PlexMeta | null,
    preferSeasonPoster = false,
): MappedPlayerItem => {
    if (item.type !== 'episode') {
        return preferSeasonPoster ? { ...item, preferSeasonPoster: true } : item;
    }
    const episodeKey = String(item.ratingKey || '').replace(/\D/g, '');
    const seasonKey = String(item.parentRatingKey || '').replace(/\D/g, '');
    const showKey = String(item.grandparentRatingKey || '').replace(/\D/g, '');
    const episodeThumbPath = meta
        ? currentEpisodeThumbPath(meta)
        : (libraryImagePath(item.episodeThumb) || libraryImagePath(item.thumbPath) || stampedThumbPath(episodeKey, null));
    // When meta is present it already carries fresh show/season thumbs from refresh.
    // Without meta, prefer unstamped show/season /thumb (always current) over any
    // cached stamped path left on the item from an older hub payload.
    const seasonPath = meta
        ? libraryImagePath(meta.parentThumb)
        : (seasonKey ? `/library/metadata/${seasonKey}/thumb` : '');
    const showPath = meta
        ? libraryImagePath(meta.grandparentThumb)
        : (showKey ? `/library/metadata/${showKey}/thumb` : '');
    const posterKey = preferSeasonPoster && (seasonPath || seasonKey)
        ? seasonKey
        : (showKey || seasonKey);
    const posterPath = preferSeasonPoster
        ? (seasonPath || showPath)
        : (showPath || seasonPath);
    const stampedPoster = posterPath || stampedThumbPath(posterKey, null);
    const showTitle = String(
        (meta?.grandparentTitle as string | undefined)
        || item.showTitle
        || '',
    ).trim();
    const episodeTitle = String(
        (meta?.title as string | undefined)
        || item.episodeTitle
        || item.title
        || '',
    ).trim();
    const thumbStamp = (() => {
        const stamped = String(stampedPoster || '');
        const match = stamped.match(/\/thumb\/(\d+)/);
        return match?.[1] || null;
    })();
    return {
        ...item,
        preferSeasonPoster: preferSeasonPoster || undefined,
        episodeTitle: episodeTitle || item.episodeTitle || null,
        episodeThumb: imageUrl(episodeThumbPath, 426, 240)
            || episodeThumbPath
            || item.episodeThumb
            || null,
        title: showTitle || item.title,
        showTitle: showTitle || item.showTitle || null,
        thumb: imageUrl(stampedPoster, 300, 450) || stampedPoster || item.thumb,
        // Lets the client rebuild poster URLs after poster swaps (hub stamps go stale).
        thumbUpdatedAt: thumbStamp ? Number(thumbStamp) : null,
        cardAspect: '2/3' as const,
        parentThumbPath: seasonPath || item.parentThumbPath || null,
        grandparentThumbPath: showPath || item.grandparentThumbPath || null,
    };
};

const currentBackdropPath = (meta: PlexMeta | null | undefined, key: string) => {
    if (!meta || !key) return '';
    return stampedArtPath(
        key,
        meta.updatedAt as string | number | null | undefined,
        String(meta.art || '').trim() || taggedBackground(meta),
    );
};

const withCurrentBackdrop = <T extends { art?: string | null; backdropArt?: string | null }>(
    item: T,
    path: string,
) => (path ? { ...item, art: path, backdropArt: path } : item);

const refreshContinueEpisodeThumbs = async (
    items: Array<ReturnType<typeof mapItem>>,
    server: PlexServer,
    preferSeasonPoster = false,
) => {
    const ids = [...new Set(items
        .filter((item) => item.type === 'episode')
        .map((item) => String(item.ratingKey || '').replace(/\D/g, ''))
        .filter(Boolean))];
    const ownerIds = new Set<string>();
    for (const item of items) {
        if (item.type === 'movie' || item.type === 'show') {
            const key = String(item.ratingKey || '').replace(/\D/g, '');
            if (key) ownerIds.add(key);
        }
        if (item.type === 'episode' || item.type === 'season') {
            const show = String(
                item.type === 'season' ? item.parentRatingKey : item.grandparentRatingKey || '',
            ).replace(/\D/g, '');
            const season = String(item.parentRatingKey || '').replace(/\D/g, '');
            if (show) ownerIds.add(show);
            if (item.type === 'episode' && season) ownerIds.add(season);
        }
    }
    const fresh = new Map<string, PlexMeta>();
    if (ids.length) {
        const data = await pms(`/library/metadata/${ids.join(',')}?includeGuids=0`, server, 8000).catch(() => null);
        for (const meta of asList<PlexMeta>(containerOf(data).Metadata)) {
            const id = String(meta.ratingKey || '').replace(/\D/g, '');
            if (id) fresh.set(id, meta);
        }
        // Always re-fetch show/season metadata. Hub/episode grandparentThumb stamps are
        // frozen at the old poster; only the show's own Metadata.thumb is current.
        for (const meta of fresh.values()) {
            const show = String(meta.grandparentRatingKey || '').replace(/\D/g, '');
            const season = String(meta.parentRatingKey || '').replace(/\D/g, '');
            if (show) ownerIds.add(show);
            if (season) ownerIds.add(season);
        }
    }
    const parentFresh = new Map<string, PlexMeta>();
    if (ownerIds.size) {
        const parentData = await pms(
            `/library/metadata/${[...ownerIds].join(',')}?includeGuids=0`,
            server,
            8000,
        ).catch(() => null);
        for (const meta of asList<PlexMeta>(containerOf(parentData).Metadata)) {
            const id = String(meta.ratingKey || '').replace(/\D/g, '');
            if (id) parentFresh.set(id, meta);
        }
    }
    if (!ids.length && !parentFresh.size) {
        return items.map((item) => asContinueWatchingItem(item, null, preferSeasonPoster || !!item.preferSeasonPoster));
    }
    return items.map((item) => {
        if (item.type === 'movie' || item.type === 'show') {
            const key = String(item.ratingKey || '').replace(/\D/g, '');
            const next = asContinueWatchingItem(item, null, preferSeasonPoster || !!item.preferSeasonPoster);
            return withCurrentBackdrop(next, currentBackdropPath(key ? parentFresh.get(key) : null, key));
        }
        if (item.type !== 'episode') {
            return asContinueWatchingItem(item, null, preferSeasonPoster || !!item.preferSeasonPoster);
        }
        const id = String(item.ratingKey || '').replace(/\D/g, '');
        const meta = fresh.get(id);
        if (!meta) return asContinueWatchingItem(item, null, preferSeasonPoster || !!item.preferSeasonPoster);
        const showKey = String(meta.grandparentRatingKey || item.grandparentRatingKey || '').replace(/\D/g, '');
        const seasonKey = String(meta.parentRatingKey || item.parentRatingKey || '').replace(/\D/g, '');
        const showMeta = showKey ? parentFresh.get(showKey) : null;
        const seasonMeta = seasonKey ? parentFresh.get(seasonKey) : null;
        // Never reuse stamped grandparentThumb/parentThumb from the episode/hub row —
        // those stamps are immutable and keep serving pre-swap (e.g. Netflix) art forever.
        // Only trust thumb paths from a fresh show/season metadata fetch.
        const enriched: PlexMeta = {
            ...meta,
            grandparentThumb: showMeta
                ? (stampedThumbPath(
                    showKey,
                    showMeta.thumb,
                    showMeta.updatedAt as string | number | null | undefined,
                ) || `/library/metadata/${showKey}/thumb`)
                : (showKey ? `/library/metadata/${showKey}/thumb` : meta.grandparentThumb),
            parentThumb: seasonMeta
                ? (stampedThumbPath(
                    seasonKey,
                    seasonMeta.thumb,
                    seasonMeta.updatedAt as string | number | null | undefined,
                ) || `/library/metadata/${seasonKey}/thumb`)
                : (seasonKey ? `/library/metadata/${seasonKey}/thumb` : meta.parentThumb),
        };
        const next = asContinueWatchingItem(
            item,
            enriched,
            preferSeasonPoster || !!item.preferSeasonPoster,
        );
        return withCurrentBackdrop(next, currentBackdropPath(showMeta, showKey));
    });
};

/**
 * Hub / On Deck rows omit Network + Studio tags even though Plex filters on them.
 * Batch-fetch show/movie metadata so Channel 4 / ITVX / Marvel land on billboards.
 */
const itemHasTmdbGuid = (item: ReturnType<typeof mapItem>) => {
    const isTvChild = item.type === 'episode' || item.type === 'season';
    if (isTvChild) {
        return Number(item.showTmdbId) > 0 || Number(item.externalIds?.tmdb) > 0;
    }
    return Number(item.tmdbId) > 0 || Number(item.externalIds?.tmdb) > 0;
};

const hydrateHubsBrandMeta = async <T extends { items?: Array<ReturnType<typeof mapItem>> }>(
    hubs: T[],
    server: PlexServer,
) => {
    const showKeys = new Set<string>();
    const directKeys = new Set<string>();
    for (const hub of hubs) {
        for (const item of hub.items || []) {
            const isTv = item.type === 'show' || item.type === 'season' || item.type === 'episode';
            const hasNetwork = Array.isArray(item.networkLabels) && item.networkLabels.length > 0;
            // Always refill when TMDB id is missing — studio text alone cannot drive logos.
            if (itemHasTmdbGuid(item) && (!isTv || hasNetwork)) continue;
            if (item.type === 'episode') {
                const key = String(item.grandparentRatingKey || '').replace(/\D/g, '');
                if (key) showKeys.add(key);
            } else if (item.type === 'season') {
                const key = String(item.parentRatingKey || '').replace(/\D/g, '');
                if (key) showKeys.add(key);
            } else if (item.type === 'show' || item.type === 'movie') {
                const key = String(item.ratingKey || '').replace(/\D/g, '');
                if (key) directKeys.add(key);
            }
        }
    }
    const allKeys = [...new Set([...showKeys, ...directKeys])];
    if (!allKeys.length) return hubs;

    type Brand = {
        studio: string;
        studioLabels: string[];
        networkLabels: string[];
        tmdbId: number | null;
        externalIds: ReturnType<typeof mapItem>['externalIds'];
    };
    const byKey = new Map<string, Brand>();
    for (let index = 0; index < allKeys.length; index += 40) {
        const ids = allKeys.slice(index, index + 40).join(',');
        const data = await pms(`/library/metadata/${ids}?includeGuids=1`, server, 8000).catch(() => null);
        for (const meta of asList<PlexMeta>(containerOf(data).Metadata)) {
            const id = String(meta.ratingKey || '').replace(/\D/g, '');
            if (!id) continue;
            const mapped = mapItem(meta);
            if (
                !mapped.studio
                && !(mapped.networkLabels && mapped.networkLabels.length)
                && !(mapped.studioLabels && mapped.studioLabels.length)
                && !mapped.tmdbId
            ) {
                continue;
            }
            byKey.set(id, {
                studio: mapped.studio || '',
                studioLabels: mapped.studioLabels || [],
                networkLabels: mapped.networkLabels || [],
                tmdbId: mapped.tmdbId,
                externalIds: mapped.externalIds,
            });
        }
    }
    if (!byKey.size) return hubs;

    return hubs.map((hub) => ({
        ...hub,
        items: (hub.items || []).map((item) => {
            let brand: Brand | undefined;
            if (item.type === 'episode') {
                brand = byKey.get(String(item.grandparentRatingKey || '').replace(/\D/g, ''));
            } else if (item.type === 'season') {
                brand = byKey.get(String(item.parentRatingKey || '').replace(/\D/g, ''));
            } else {
                brand = byKey.get(String(item.ratingKey || '').replace(/\D/g, ''));
            }
            if (!brand) return item;
            const isTvChild = item.type === 'episode' || item.type === 'season';
            const hasNetwork = Array.isArray(item.networkLabels) && item.networkLabels.length > 0;
            const hasStudioLabels = Array.isArray(item.studioLabels) && item.studioLabels.length > 0;
            return {
                ...item,
                studio: item.studio || brand.studio,
                studioLabels: hasStudioLabels ? item.studioLabels : (brand.studioLabels.length ? brand.studioLabels : item.studioLabels),
                networkLabels: hasNetwork ? item.networkLabels : (brand.networkLabels.length ? brand.networkLabels : item.networkLabels),
                showTmdbId: isTvChild
                    ? (item.showTmdbId || brand.tmdbId || null)
                    : item.showTmdbId,
                tmdbId: item.type === 'show' || item.type === 'movie'
                    ? (item.tmdbId || brand.tmdbId)
                    : item.tmdbId,
                externalIds: {
                    imdb: item.externalIds?.imdb || brand.externalIds?.imdb || null,
                    tmdb: isTvChild
                        ? (item.externalIds?.tmdb || item.showTmdbId || brand.externalIds?.tmdb || brand.tmdbId || null)
                        : (item.externalIds?.tmdb || item.tmdbId || brand.externalIds?.tmdb || brand.tmdbId || null),
                    tvdb: item.externalIds?.tvdb || brand.externalIds?.tvdb || null,
                },
            };
        }),
    }));
};

/**
 * Recently Added (Plex-style): show poster + show title on the card, but keep the
 * episode ratingKey / SxxExx / episode summary so focus + click open that episode.
 */
const asRecentlyAddedItem = (item: ReturnType<typeof mapItem>): ReturnType<typeof mapItem> => {
    if (item.type !== 'episode' && item.type !== 'season') return item;
    const showKey = String(
        item.type === 'season' ? item.parentRatingKey : item.grandparentRatingKey || '',
    ).replace(/\D/g, '');
    const showName = String(
        item.type === 'season'
            ? (item.showTitle || item.seasonTitle || item.title)
            : (item.showTitle || item.title),
    ).trim();
    const episodeTitle = item.type === 'episode'
        ? String((item as { episodeTitle?: string | null }).episodeTitle || item.title || '').trim()
        : '';
    const showThumbPath = showKey
        ? (libraryImagePath((item as { grandparentThumbPath?: string }).grandparentThumbPath)
            || `/library/metadata/${showKey}/thumb`)
        : '';
    if (showKey) rememberItem(showKey, mapServer);
    return {
        ...item,
        episodeTitle: episodeTitle || (item as { episodeTitle?: string | null }).episodeTitle || null,
        title: showName || item.title,
        showTitle: showName || item.showTitle || null,
        thumb: (showThumbPath ? imageUrl(showThumbPath, 300, 450) : null) || item.thumb,
        cardAspect: '2/3' as const,
        dedupeKey: item.ratingKey || showKey,
        // Keep type/ratingKey/parentIndex/index/summary — open + billboard stay on the episode.
    };
};

const collapseRecentShows = (items: ReturnType<typeof mapItem>[], identifier: string, title: string) => {
    const blob = `${identifier} ${title}`;
    if (!/recent/i.test(blob) || /continue|ondeck|on[.\s_-]?deck/i.test(blob)) return items;
    const DAY_MS = 24 * 60 * 60 * 1000;
    const episodeGroups = new Map<string, number[]>();
    const collapsed: ReturnType<typeof mapItem>[] = [];
    items.forEach((item) => {
        if (item.type !== 'episode') {
            collapsed.push(item);
            return;
        }
        const showKey = String(item.grandparentRatingKey || item.showPlexGuid || item.showTitle || '').trim().toLowerCase();
        const addedAt = Number(item.addedAt) || 0;
        const priorAdds = showKey ? (episodeGroups.get(showKey) || []) : [];
        // Plex combines episodes from the same show when they were added as one
        // batch. Keep a later addition as a new card once it is over 24h away.
        if (showKey && priorAdds.some((prior) => (
            addedAt > 0 && prior > 0 && Math.abs(addedAt - prior) < DAY_MS
        ))) return;
        if (showKey) {
            priorAdds.push(addedAt);
            episodeGroups.set(showKey, priorAdds);
        }
        collapsed.push(asRecentlyAddedItem(item));
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
            const idLower = identifier.toLowerCase();
            // Never treat movie/TV collection hubs as music — title words like "Music"
            // (e.g. "Music Movies") used to stamp every child as album/square art.
            const movieOrShowHub = /^(movie|show|tv)\./.test(idLower)
                || /(^|[.\s_-])(movie|show|tv|film)([.\s_-]|collection)/.test(idLower);
            const musicHub = !movieOrShowHub && (
                /^(artist|album|track|audio)$/.test(hubKind)
                || /^(artist|music|album)\./.test(idLower)
            );
            const isContinue = continueHub({ identifier, title });
            const seasonPoster = isContinue && readHeroConfig().continueWatchingSeasonPoster;
            const items = mapped.map((item) => {
                const itemType = String(item?.type || '').toLowerCase();
                const movieOrShowItem = /^(movie|show|season|episode|collection)$/.test(itemType);
                // Only stamp square on confirmed music hubs / non-movie children.
                const next = (musicHub && !movieOrShowItem)
                    ? { ...item, cardAspect: 'square' as const }
                    : item;
                if (!isContinue) return next;
                return asContinueWatchingItem(next, null, !!seasonPoster);
            });
            const listPath = plexListPath(hub.key) || plexListPath(hub.hubKey);
            const pathOnly = listPath.split('?')[0];
            const randomOrder = isRandomOrderSource(hub) || isRandomOrderSource(listPath) || undefined;
            let hubPath = pathOnly.startsWith('/library/') || pathOnly.startsWith('/hubs/') || pathOnly.startsWith('/playlists')
                ? listPath
                : '';
            if (randomOrder && hubPath) hubPath = withPlexSortParam(hubPath, 'random');
            return {
                title: String(hub.title || identifier || 'Hub'),
                identifier,
                items: randomOrder && items.length > 1 ? shuffleItems(items) : items,
                hubKey: hubPath ? (many ? `${server.id}::${hubPath}` : hubPath) : null,
                collectionRatingKey: collectionRatingKeyFromHub(hub) || null,
                randomOrder,
                serverId: server.id,
            };
        }).filter((hub) => hub.items.length && hub.title);
    } finally {
        mapServer = previous;
    }
};

const mapPool = async <T, R>(rows: T[], limit: number, run: (row: T) => Promise<R>): Promise<R[]> => {
    const out = new Array<R>(rows.length);
    let cursor = 0;
    const worker = async () => {
        while (cursor < rows.length) {
            const index = cursor;
            cursor += 1;
            out[index] = await run(rows[index]);
        }
    };
    await Promise.all(Array.from(
        { length: Math.min(rows.length, Math.max(1, limit)) },
        () => worker(),
    ));
    return out;
};

const plexListPath = (value: unknown) => {
    let raw = String(value || '').trim();
    if (!raw) return '';
    if (/^https?:\/\//i.test(raw)) {
        try {
            const url = new URL(raw);
            raw = `${url.pathname}${url.search}`;
        } catch {
            return '';
        }
    }
    // Plex pins usually arrive as server://<id>/com.plexapp.plugins.library/library/...
    const libraryIdx = raw.indexOf('/library/');
    const hubsIdx = raw.indexOf('/hubs/');
    const playlistIdx = raw.toLowerCase().indexOf('/playlists');
    const starts = [libraryIdx, hubsIdx, playlistIdx].filter((index) => index >= 0);
    if (starts.length) raw = raw.slice(Math.min(...starts));
    if (!raw.startsWith('/library/') && !raw.startsWith('/hubs/') && !raw.toLowerCase().startsWith('/playlists')) {
        return '';
    }
    if (raw.includes('..') || raw.includes('\\')) return '';
    return raw;
};

const isRecentListHub = (hub: PlexMeta, path = '') => {
    const blob = `${hub.hubIdentifier || ''} ${hub.key || ''} ${hub.hubKey || ''} ${hub.title || ''} ${path}`;
    return /recent/i.test(blob) && !/continue|ondeck|on[.\s_-]?deck/i.test(blob);
};

// A same-day season dump collapses to one card. Plex's recently-added list is
// episodes, so that dump used to be the entire page and the next shows vanished.
const RECENT_SECTION_MIN = 8;
const RECENT_ROW_TARGET = 24;
const RECENT_PAGE_SIZE = 200;
const RECENT_MAX_ITEMS = 1200;

const bareSectionId = (value: unknown) => String(value || '').replace(/\D/g, '');

const sectionNumericId = (key: unknown) => {
    const tail = String(key || '').split('::').pop() || '';
    return tail.replace(/\D/g, '');
};

const recentSectionIdFromPath = (path: string) => {
    const text = String(path || '');
    return text.match(/\/library\/sections\/(\d+)\/recentlyadded/i)?.[1]
        || text.match(/\/hubs\/sections\/(\d+)/i)?.[1]
        || text.match(/[?&](?:sectionID|sectionId)=(\d+)/i)?.[1]
        || text.match(/recentlyadded\.(\d+)/i)?.[1]
        || '';
};

const sectionIdFromRecentTitle = (
    title: string,
    sections: Array<{ key?: string; title?: string }>,
) => {
    const name = String(title || '').match(/recently added\s*(?:in|·)\s+(.+)/i)?.[1]?.trim();
    if (!name) return '';
    const want = name.toLowerCase();
    const hit = sections.find((section) => String(section.title || '').trim().toLowerCase() === want);
    return hit ? sectionNumericId(hit.key) : '';
};

const recentShowIdentity = (item: ReturnType<typeof mapItem>) => {
    if (item.type === 'episode') {
        return bareSectionId(item.grandparentRatingKey)
            || String(item.showTitle || item.title || '').trim().toLowerCase();
    }
    if (item.type === 'season') {
        return bareSectionId(item.parentRatingKey)
            || String(item.showTitle || item.title || '').trim().toLowerCase();
    }
    if (item.type === 'show') {
        return bareSectionId(item.ratingKey) || String(item.title || '').trim().toLowerCase();
    }
    return '';
};

const withSectionId = (items: ReturnType<typeof mapItem>[], sectionId: string) => {
    const id = bareSectionId(sectionId);
    if (!id) return items;
    return items.map((item) => (
        bareSectionId(item.librarySectionID) ? item : { ...item, librarySectionID: id }
    ));
};

const recentGroupsFull = (items: ReturnType<typeof mapItem>[]) => {
    if (!items.length) return false;
    const groups = new Map<string, number>();
    for (const item of items) {
        const id = bareSectionId(item.librarySectionID);
        if (!id) return items.length >= RECENT_SECTION_MIN;
        groups.set(id, (groups.get(id) || 0) + 1);
    }
    return [...groups.values()].every((count) => count >= RECENT_SECTION_MIN);
};

const topUpRecentShows = async (
    server: PlexServer,
    sectionId: string,
    cards: ReturnType<typeof mapItem>[],
) => {
    if (cards.length >= RECENT_ROW_TARGET) return cards;
    const data = await pms(
        `/library/sections/${encodeURIComponent(sectionId)}/all?type=2&sort=updatedAt:desc&X-Plex-Container-Start=0&X-Plex-Container-Size=40`,
        server,
        12000,
    ).catch(() => null);
    const shows = mapList(data).filter((item) => item.type === 'show' && item.ratingKey);
    if (!shows.length) return cards;
    const seen = new Set(cards.map(recentShowIdentity).filter(Boolean));
    const out = cards.slice();
    for (const show of shows) {
        if (out.length >= RECENT_ROW_TARGET) break;
        const identity = recentShowIdentity(show);
        if (!identity || seen.has(identity)) continue;
        seen.add(identity);
        out.push(show);
    }
    return out;
};

const loadCollapsedRecentlyAdded = async (
    server: PlexServer,
    sectionId: string,
    identifier: string,
    title: string,
) => {
    const id = bareSectionId(sectionId);
    if (!id) return [] as ReturnType<typeof mapItem>[];
    const raw: ReturnType<typeof mapItem>[] = [];
    const seenKeys = new Set<string>();
    let offset = 0;
    let stuck = false;
    let collapsed: ReturnType<typeof mapItem>[] = [];
    let previousCards = 0;
    let flatPages = 0;
    while (raw.length < RECENT_MAX_ITEMS) {
        const size = Math.min(RECENT_PAGE_SIZE, RECENT_MAX_ITEMS - raw.length);
        const data = await pms(
            `/library/sections/${encodeURIComponent(id)}/recentlyAdded?X-Plex-Container-Start=${offset}&X-Plex-Container-Size=${size}`,
            server,
            12000,
        ).catch(() => null);
        const page = mapList(data);
        if (!page.length) break;
        let fresh = 0;
        for (const item of page) {
            const key = String(item.ratingKey || '');
            if (!key || seenKeys.has(key)) continue;
            seenKeys.add(key);
            raw.push(item);
            fresh += 1;
        }
        // Same page again means this list is not moving past the bulk add.
        if (!fresh) {
            stuck = true;
            break;
        }
        collapsed = collapseRecentShows(raw, identifier, title);
        if (collapsed.length >= RECENT_ROW_TARGET) {
            return withSectionId(collapsed.slice(0, RECENT_ROW_TARGET), id);
        }
        if (collapsed.length === previousCards) {
            flatPages += 1;
            if (flatPages >= 2) {
                stuck = true;
                break;
            }
        } else {
            flatPages = 0;
            previousCards = collapsed.length;
        }
        if (page.length < size) break;
        offset += page.length;
    }
    if (!collapsed.length) collapsed = collapseRecentShows(raw, identifier, title);
    const showLibrary = raw.some((item) => (
        item.type === 'episode' || item.type === 'season' || item.type === 'show'
    ));
    // The episode window was one show, or the list would not page. Fill the
    // shelf with the rest of the library instead of leaving a single poster.
    if (showLibrary && collapsed.length < RECENT_SECTION_MIN) {
        collapsed = await topUpRecentShows(server, id, collapsed);
    } else if (stuck && showLibrary && collapsed.length < RECENT_ROW_TARGET) {
        collapsed = await topUpRecentShows(server, id, collapsed);
    }
    return withSectionId(collapsed.slice(0, RECENT_ROW_TARGET), id);
};

const expandRecentSections = async (
    items: ReturnType<typeof mapItem>[],
    server: PlexServer,
    identifier: string,
    title: string,
) => {
    const groups = new Map<string, ReturnType<typeof mapItem>[]>();
    const order: string[] = [];
    const loose: ReturnType<typeof mapItem>[] = [];
    for (const item of items) {
        const id = bareSectionId(item.librarySectionID);
        if (!id) {
            loose.push(item);
            continue;
        }
        if (!groups.has(id)) {
            groups.set(id, []);
            order.push(id);
        }
        groups.get(id)?.push(item);
    }
    if (!order.length) return items;
    const thin = order.filter((id) => (groups.get(id)?.length || 0) < RECENT_SECTION_MIN);
    if (!thin.length) return items;
    const filled = await mapPool(thin, 2, async (id) => ({
        id,
        items: await loadCollapsedRecentlyAdded(server, id, identifier, title),
    }));
    const byId = new Map(filled.map((row) => [row.id, row.items]));
    const out: ReturnType<typeof mapItem>[] = [];
    for (const id of order) {
        const next = byId.get(id);
        const prev = groups.get(id) || [];
        out.push(...(next && next.length > prev.length ? next : prev));
    }
    return out.concat(loose);
};

const mappedHubIsRecent = (hub: { identifier?: string; title?: string; hubKey?: string | null }) => (
    isRecentListHub({
        hubIdentifier: hub.identifier,
        key: hub.hubKey,
        title: hub.title,
    })
);

const enrichThinRecentHubs = async <T extends {
    identifier?: string;
    title?: string;
    hubKey?: string | null;
    items: ReturnType<typeof mapItem>[];
}>(
    hubs: T[],
    server: PlexServer,
    sections: Array<{ key?: string; title?: string }> = [],
): Promise<T[]> => {
    const out = await mapPool(hubs, 2, async (hub) => {
        if (!mappedHubIsRecent(hub) || recentGroupsFull(hub.items || [])) return hub;
        const identifier = String(hub.identifier || hub.title || 'recentlyAdded');
        const title = String(hub.title || identifier);
        let items = await expandRecentSections(hub.items || [], server, identifier, title);
        if (items.length <= (hub.items || []).length) {
            const sectionIds = [...new Set((hub.items || []).map((item) => bareSectionId(item.librarySectionID)).filter(Boolean))];
            const sectionId = recentSectionIdFromPath(`${hub.hubKey || ''} ${hub.identifier || ''}`)
                || (sectionIds.length === 1 ? sectionIds[0] : '')
                || sectionIdFromRecentTitle(title, sections);
            if (sectionId) {
                const paged = await loadCollapsedRecentlyAdded(server, sectionId, identifier, title);
                if (paged.length > items.length) items = paged;
            }
        }
        if (items.length <= (hub.items || []).length) return hub;
        return { ...hub, items };
    });
    return out;
};

const fillPlexHomeHub = async (hub: PlexMeta, server: PlexServer, many: boolean) => {
    const ready = hubsFrom({ MediaContainer: { Hub: [hub] } }, server, many)[0];
    const recentHub = isRecentListHub(hub);
    // Any inline row is enough to paint. Refetching it blocked every other pin.
    if (!recentHub && (ready?.items?.length || 0) >= 1) return ready;
    const recentIdentity = String(hub.hubIdentifier || hub.key || hub.title || '');
    const recentTitle = String(hub.title || recentIdentity || 'Hub');
    if (recentHub && ready?.items?.length) {
        if (recentGroupsFull(ready.items)) return ready;
        const expanded = await expandRecentSections(ready.items, server, recentIdentity, recentTitle);
        if (expanded.length > ready.items.length) return { ...ready, items: expanded };
    }
    const keepReady = () => (ready?.items?.length ? ready : null);
    let listPath = plexListPath(hub.key)
        || plexListPath(hub.hubKey)
        || plexListPath(hub.more)
        || plexListPath(hub.content);
    if (!listPath) {
        const blob = [hub.key, hub.hubKey, hub.hubIdentifier].map((value) => String(value || '')).join(' ');
        const collectionId = blob.match(/\/library\/collections\/(\d+)/i)?.[1]
            || blob.match(/collection[./_-](\d+)/i)?.[1]
            || '';
        if (collectionId) listPath = `/library/collections/${collectionId}/children`;
    }
    if (!listPath) return keepReady();
    let parsed: URL;
    try {
        parsed = new URL(listPath, 'http://plex.local');
    } catch {
        return keepReady();
    }
    const path = parsed.pathname.replace(/\/+$/, '');
    if (!path.startsWith('/library/') && !path.startsWith('/hubs/') && !path.startsWith('/playlists')) return keepReady();
    const rowSize = recentHub || isRecentListHub(hub, path) ? '36' : '24';
    if (isRecentListHub(hub, path) || (!parsed.searchParams.get('X-Plex-Container-Size') && !parsed.searchParams.get('count'))) {
        parsed.searchParams.set('X-Plex-Container-Size', rowSize);
        if (isRecentListHub(hub, path)) parsed.searchParams.set('count', rowSize);
    }
    if (isRandomOrderSource(hub) && !parsed.searchParams.get('sort')) {
        parsed.searchParams.set('sort', 'random');
    }
    const query = parsed.searchParams.toString();
    const storedPath = `${path}${query ? `?${query}` : ''}`;
    const data = await pms(storedPath, server, 12000).catch(() => null);
    const identifier = String(hub.hubIdentifier || hub.key || hub.title || '');
    const title = String(hub.title || identifier || 'Hub');
    let items = collapseRecentShows(mapList(data), identifier, title);
    if (recentHub && !recentGroupsFull(items)) {
        const sectionId = recentSectionIdFromPath(path);
        if (sectionId) {
            const paged = await loadCollapsedRecentlyAdded(server, sectionId, identifier, title);
            if (paged.length > items.length) items = paged;
        } else {
            const expanded = await expandRecentSections(items, server, identifier, title);
            if (expanded.length > items.length) items = expanded;
        }
    }
    if ((ready?.items?.length || 0) > items.length) return ready;
    if (!items.length || !title) return ready?.items?.length ? ready : null;
    const randomOrder = isRandomOrderSource(hub) || isRandomOrderSource(storedPath) || undefined;
    const hubKeyPath = randomOrder ? withPlexSortParam(storedPath, 'random') : storedPath;
    return {
        title,
        identifier,
        items: randomOrder && items.length > 1 ? shuffleItems(items) : items,
        hubKey: many ? `${server.id}::${hubKeyPath}` : hubKeyPath,
        collectionRatingKey: collectionRatingKeyFromHub(hub) || null,
        randomOrder,
        serverId: server.id,
    };
};

const collectionRatingKeyFromHub = (hub: PlexMeta) => {
    const blob = [hub.key, hub.hubKey, hub.hubIdentifier].map((value) => String(value || '')).join(' ');
    if (!/collection/i.test(blob)) return '';
    const match = blob.match(/\/library\/collections\/(\d+)/i)
        || blob.match(/collection[./_-](\d+)/i);
    return match?.[1] || '';
};

const isRandomOrderSource = (value: unknown) => {
    if (value && typeof value === 'object') {
        const ident = String((value as PlexMeta).hubIdentifier || (value as { identifier?: string }).identifier || '');
        if (/(^|[.\-_])random([.\-_]|$)/i.test(ident)) return true;
    }
    let text = typeof value === 'string' ? value : JSON.stringify(value || '');
    for (let pass = 0; pass < 2; pass += 1) {
        try {
            const next = decodeURIComponent(text);
            if (next === text) break;
            text = next;
        } catch {
            break;
        }
    }
    return /\bsort\W{0,6}random\b/i.test(text)
        || /\bcollectionsort\W{0,6}random\b/i.test(text);
};

const withPlexSortParam = (path: string, sort: string) => {
    const raw = String(path || '').trim();
    const want = String(sort || '').trim();
    if (!raw || !want) return raw;
    const split = raw.match(/^([^/]+)::(\/.+)$/);
    const prefix = split ? `${split[1]}::` : '';
    const rest = split ? split[2] : raw;
    const qIndex = rest.indexOf('?');
    const pathname = qIndex >= 0 ? rest.slice(0, qIndex) : rest;
    const params = new URLSearchParams(qIndex >= 0 ? rest.slice(qIndex + 1) : '');
    if (want.toLowerCase() === 'random' || !params.get('sort')) params.set('sort', want);
    return `${prefix}${pathname}?${params.toString()}`;
};

const isHeroRowLabel = (value: unknown) => /^(hero|heros|heroes)$/i.test(String(value || '').trim());
const isReservedHomeMergeLabel = (value: unknown) => {
    const tag = String(value || '').trim();
    if (!tag) return true;
    if (isHeroRowLabel(tag)) return true;
    if (/^(kometa|collexions)$/i.test(tag)) return true;
    return false;
};

const collectionLabelsFromMeta = (meta: PlexMeta | null | undefined) => {
    const out: string[] = [];
    const seen = new Set<string>();
    asList<PlexMeta>(meta?.Label).forEach((row) => {
        const tag = String(typeof row === 'string' ? row : (row?.tag || row?.title || '')).trim();
        if (!tag) return;
        const key = tag.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        out.push(tag);
    });
    return out;
};

const collectionMetaHasHeroLabel = (meta: PlexMeta | null | undefined) => (
    collectionLabelsFromMeta(meta).some((label) => isHeroRowLabel(label))
);

const heroLabelCache = new Map<string, boolean>();
const collectionRandomCache = new Map<string, boolean>();
const collectionLabelsCache = new Map<string, string[]>();
const HERO_LABEL_STORE = 'smp-hero-row-labels-v1';
const COLLECTION_LABELS_STORE = 'smp-collection-labels-v1';
let heroLabelStoreLoaded = false;

const loadHeroLabelStore = () => {
    if (heroLabelStoreLoaded || typeof localStorage === 'undefined') return;
    heroLabelStoreLoaded = true;
    try {
        const parsed = JSON.parse(localStorage.getItem(HERO_LABEL_STORE) || '{}') as Record<string, unknown>;
        Object.entries(parsed).forEach(([key, value]) => {
            if (value === true || value === false) heroLabelCache.set(key, value);
        });
    } catch { /* ignore */ }
    try {
        const parsed = JSON.parse(localStorage.getItem(COLLECTION_LABELS_STORE) || '{}') as Record<string, unknown>;
        Object.entries(parsed).forEach(([key, value]) => {
            if (!Array.isArray(value)) return;
            // Persist empty arrays too — otherwise unlabeled collections refetch every open.
            const labels = value.map((row) => String(row || '').trim()).filter(Boolean);
            collectionLabelsCache.set(key, labels);
        });
    } catch { /* ignore */ }
};

const saveHeroLabelStore = () => {
    if (typeof localStorage === 'undefined') return;
    try {
        const out: Record<string, boolean> = {};
        heroLabelCache.forEach((value, key) => {
            out[key] = value;
        });
        localStorage.setItem(HERO_LABEL_STORE, JSON.stringify(out));
    } catch { /* ignore quota */ }
    try {
        const out: Record<string, string[]> = {};
        collectionLabelsCache.forEach((value, key) => {
            out[key] = value;
        });
        localStorage.setItem(COLLECTION_LABELS_STORE, JSON.stringify(out));
    } catch { /* ignore quota */ }
};

const applyHeroRowFlags = <T extends {
    collectionRatingKey?: string | null;
    randomOrder?: boolean;
    hubKey?: string | null;
    items?: unknown[];
    labels?: string[];
}>(hubs: T[], server: PlexServer) => {
    loadHeroLabelStore();
    return hubs.map((hub) => {
        const id = String(hub.collectionRatingKey || '');
        const cacheKey = id ? `${server.id}:${id}` : '';
        const labels = cacheKey ? collectionLabelsCache.get(cacheKey) : undefined;
        // The boolean was cached before "Hero" counted. Labels already on disk still count.
        const hero = Boolean(cacheKey && (
            heroLabelCache.get(cacheKey)
            || (labels || []).some((label) => isHeroRowLabel(label))
        ));
        const random = Boolean(hub.randomOrder) || Boolean(cacheKey && collectionRandomCache.get(cacheKey));
        if (!hero && !random && !labels?.length) return hub;
        const next = {
            ...hub,
            ...(labels?.length ? { labels } : {}),
            ...(hero ? { heroRow: true } : {}),
            ...(random ? { randomOrder: true } : {}),
        };
        if (random && next.hubKey) next.hubKey = withPlexSortParam(String(next.hubKey), 'random');
        if (random && Array.isArray(next.items) && next.items.length > 1) {
            next.items = shuffleItems(next.items);
        }
        return next;
    });
};

const stampHeroRows = async <T extends { collectionRatingKey?: string | null; randomOrder?: boolean }>(hubs: T[], server: PlexServer) => {
    loadHeroLabelStore();
    const ids = [...new Set(hubs.map((hub) => String(hub.collectionRatingKey || '')).filter(Boolean))];
    if (!ids.length) return applyHeroRowFlags(hubs, server);
    // Only hit PMS for collections missing from cache. Empty label arrays are valid hits
    // (unlabeled collections) so libraries do not refetch them on every open.
    const missing = ids.filter((id) => {
        const cacheKey = `${server.id}:${id}`;
        return !(
            heroLabelCache.has(cacheKey)
            && collectionRandomCache.has(cacheKey)
            && collectionLabelsCache.has(cacheKey)
        );
    });
    if (missing.length) {
        await mapPool(missing, 4, async (id) => {
            const cacheKey = `${server.id}:${id}`;
            const data = await pms(`/library/collections/${encodeURIComponent(id)}`, server, 6000).catch(() => null);
            if (!data) {
                // Negative-cache so a dead collection does not block every library open.
                heroLabelCache.set(cacheKey, false);
                collectionRandomCache.set(cacheKey, false);
                collectionLabelsCache.set(cacheKey, []);
                return;
            }
            const container = containerOf(data);
            const meta = asList<PlexMeta>(container.Metadata)[0]
                || asList<PlexMeta>(container.Directory)[0]
                || null;
            const labels = collectionLabelsFromMeta(meta);
            heroLabelCache.set(cacheKey, collectionMetaHasHeroLabel(meta));
            collectionRandomCache.set(cacheKey, isRandomOrderSource(meta));
            collectionLabelsCache.set(cacheKey, labels);
        });
        saveHeroLabelStore();
    }
    return applyHeroRowFlags(hubs, server);
};

type HeroAssets = { still: string; logo: string };

const HERO_COVER_CACHE_KEY = 'smp-hero-cover-art-v3';
const heroCoverCache = new Map<string, HeroAssets>();
let heroCoverCacheLoaded = false;

const heroAssetsOf = (value: unknown): HeroAssets | null => {
    if (!value || typeof value !== 'object') return null;
    const still = String((value as HeroAssets).still || '').trim();
    if (!still.startsWith('https://')) return null;
    const logo = String((value as HeroAssets).logo || '').trim();
    return { still, logo: logo.startsWith('https://') ? logo : '' };
};

const loadHeroCoverCache = () => {
    if (heroCoverCacheLoaded || typeof localStorage === 'undefined') return;
    heroCoverCacheLoaded = true;
    try {
        const parsed = JSON.parse(localStorage.getItem(HERO_COVER_CACHE_KEY) || '{}') as Record<string, unknown>;
        Object.entries(parsed).forEach(([key, value]) => {
            const assets = heroAssetsOf(value);
            if (key && assets) heroCoverCache.set(key, assets);
        });
    } catch { /* ignore a bad cache */ }
};

const rememberHeroCover = (uuid: string, assets: HeroAssets) => {
    heroCoverCache.set(uuid, assets);
    if (typeof localStorage === 'undefined') return;
    try {
        const parsed = JSON.parse(localStorage.getItem(HERO_COVER_CACHE_KEY) || '{}') as Record<string, HeroAssets>;
        parsed[uuid] = assets;
        const keys = Object.keys(parsed);
        if (keys.length > 400) delete parsed[keys[0]];
        localStorage.setItem(HERO_COVER_CACHE_KEY, JSON.stringify(parsed));
    } catch { /* ignore quota */ }
};

/** movie/{id} is the path Plex actually serves coverArt from. The bare id is the fallback. */
const plexHeroRef = (meta: PlexMeta): { kind: string; id: string } | null => {
    const type = String(meta.type || '').toLowerCase();
    const preferred = (type === 'episode' || type === 'season')
        ? [meta.grandparentGuid, meta.parentGuid, meta.guid]
        : [meta.guid, meta.grandparentGuid, meta.parentGuid];
    const tagged = asList<PlexMeta>(meta.Guid).map((row) => row?.id);
    for (const raw of [...preferred, ...tagged]) {
        const match = String(raw || '').match(/plex:\/\/(movie|show)\/([a-z0-9]+)/i);
        if (match) return { kind: match[1].toLowerCase(), id: match[2] };
    }
    return null;
};

const largestProviderImage = (images: PlexMeta[], type: string) => {
    const want = type.toLowerCase();
    const rows = images.filter((image) => String(image?.type || '').toLowerCase() === want && String(image?.url || '').trim());
    rows.sort((a, b) => (Number(b.width) || Number(b.height) || 0) - (Number(a.width) || Number(a.height) || 0));
    let url = String(rows[0]?.url || '').trim();
    if (url.startsWith('//')) url = `https:${url}`;
    return url.startsWith('https://') ? url : '';
};

/** Replex hero card: the coverArt file itself, not the background or a logo on top. */
const heroAssetsFromProvider = (data: any): HeroAssets | null => {
    const container = containerOf(data);
    const meta = asList<PlexMeta>(container.Metadata)[0] || asList<PlexMeta>(container.Directory)[0];
    const still = largestProviderImage(asList<PlexMeta>(meta?.Image), 'coverArt')
        || largestProviderImage(asList<PlexMeta>(container.Image), 'coverArt')
        || coverArtUrl(meta);
    if (!still.startsWith('https://')) return null;
    return { still, logo: '' };
};

/** One metadata.provider.plex.tv call. A slow answer used to stall the whole lookup. */
const HERO_PROVIDER_TIMEOUT_MS = 4000;
/** Pinned rows wait at most this long for hero cover art; stragglers land in the cache. */
const HERO_COVER_BUDGET_MS = 2500;
/** Titles the provider had no cover for, this session. Each miss was up to 12 calls per Home load. */
const heroCoverMisses = new Set<string>();
const heroCoverInflight = new Map<string, Promise<HeroAssets | null>>();

const providerFetch = (url: string, token: string) => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), HERO_PROVIDER_TIMEOUT_MS);
    return plexFetch(url, token, { signal: controller.signal })
        .finally(() => window.clearTimeout(timer));
};

const lookupHeroCover = async (ref: { kind: string; id: string }, server: PlexServer) => {
    const tokens = [...new Set([readOwnerToken(), accountToken(), server.accessToken]
        .map((value) => String(value || '').trim())
        .filter(Boolean))];
    const paths = [`${ref.kind}/${ref.id}`, ref.id];
    for (const token of tokens) {
        for (const path of paths) {
            const data = await providerFetch(
                `https://metadata.provider.plex.tv/library/metadata/${path}?includeImages=1`,
                token,
            ).catch(() => null);
            let assets = heroAssetsFromProvider(data);
            if (!assets) {
                const images = await providerFetch(
                    `https://metadata.provider.plex.tv/library/metadata/${path}/images`,
                    token,
                ).catch(() => null);
                assets = heroAssetsFromProvider(images);
            }
            if (assets) {
                rememberHeroCover(ref.id, assets);
                return assets;
            }
        }
    }
    heroCoverMisses.add(ref.id);
    return null;
};

const fetchHeroCover = async (ref: { kind: string; id: string }, server: PlexServer) => {
    loadHeroCoverCache();
    const cached = heroCoverCache.get(ref.id);
    if (cached) return cached;
    if (heroCoverMisses.has(ref.id)) return null;
    // A lookup still running from an earlier Home pass is reused, not restarted.
    let pending = heroCoverInflight.get(ref.id);
    if (!pending) {
        pending = lookupHeroCover(ref, server).finally(() => heroCoverInflight.delete(ref.id));
        heroCoverInflight.set(ref.id, pending);
    }
    return pending;
};

/** Replex hero: Plex coverArt on each title. */
const attachHeroCoverArt = async <T extends { heroRow?: boolean; items?: Array<{ ratingKey?: string; heroArt?: string | null }> }>(
    hubs: T[],
    server: PlexServer,
) => {
    const keys = [...new Set(hubs
        .filter((hub) => hub.heroRow)
        .flatMap((hub) => hub.items || [])
        .map((item) => String(item.ratingKey || ''))
        .filter(Boolean))];
    if (!keys.length) return hubs;
    const refByKey = new Map<string, { kind: string; id: string }>();
    for (let index = 0; index < keys.length; index += 40) {
        const ids = keys.slice(index, index + 40).join(',');
        const data = await pms(`/library/metadata/${ids}?includeGuids=1&includeImages=1`, server, 8000).catch(() => null);
        asList<PlexMeta>(containerOf(data).Metadata).forEach((meta) => {
            const ref = plexHeroRef(meta);
            if (!ref) return;
            refByKey.set(String(meta.ratingKey || ''), ref);
            const inline = coverArtUrl(meta);
            if (inline) rememberHeroCover(ref.id, { still: inline, logo: '' });
        });
    }
    const refs = [...new Map([...refByKey.values()].map((ref) => [ref.id, ref])).values()];
    // Home's pinned rows are held until this returns. Give cover art a short budget;
    // lookups still running keep filling heroCoverCache for the next Home paint.
    let budgetTimer = 0;
    await Promise.race([
        mapPool(refs, 6, (ref) => fetchHeroCover(ref, server)).catch(() => undefined),
        new Promise<void>((resolve) => {
            budgetTimer = window.setTimeout(resolve, HERO_COVER_BUDGET_MS);
        }),
    ]);
    window.clearTimeout(budgetTimer);
    return hubs.map((hub) => {
        if (!hub.heroRow) return hub;
        return {
            ...hub,
            items: (hub.items || []).map((item) => {
                const ref = refByKey.get(String(item.ratingKey || ''));
                const assets = ref ? heroCoverCache.get(ref.id) : null;
                const still = assets?.still || String(item.heroArt || '').trim();
                return still ? { ...item, heroArt: still } : item;
            }),
        };
    });
};

type MergeableHub = {
    title?: string;
    identifier?: string;
    heroRow?: boolean;
    randomOrder?: boolean;
    labels?: string[];
    hubKey?: string | null;
    collectionRatingKey?: string | null;
    items?: Array<{ ratingKey?: string; dedupeKey?: string | null }>;
};

const mergeHubItemLists = <T extends MergeableHub>(group: T[], opts: { title?: string; randomOrder?: boolean } = {}) => {
    const seen = new Set<string>();
    const items: NonNullable<T['items']> = [];
    group.forEach((hub) => {
        (hub.items || []).forEach((item) => {
            const id = String(item.dedupeKey || item.ratingKey || '');
            if (!id || seen.has(id)) return;
            seen.add(id);
            items.push(item);
        });
    });
    const first = group[0];
    return {
        ...first,
        ...(opts.title != null ? { title: opts.title } : {}),
        heroRow: group.some((hub) => hub.heroRow) || undefined,
        randomOrder: opts.randomOrder || undefined,
        items: opts.randomOrder ? shuffleItems(items) : items,
    };
};

/** Collections that share a non-Hero Plex Label become one home row titled with that label. */
const mergeSameLabelHubs = <T extends MergeableHub>(rows: T[]) => {
    const labelStats = new Map<string, { count: number; display: string }>();
    rows.forEach((hub) => {
        const seenOnHub = new Set<string>();
        (hub.labels || []).forEach((raw) => {
            const display = String(raw || '').trim();
            if (!display || isReservedHomeMergeLabel(display)) return;
            const key = display.toLowerCase();
            if (seenOnHub.has(key)) return;
            seenOnHub.add(key);
            const cur = labelStats.get(key) || { count: 0, display };
            cur.count += 1;
            labelStats.set(key, cur);
        });
    });
    const shared = new Set(
        [...labelStats.entries()]
            .filter(([, info]) => info.count >= 2)
            .map(([key]) => key),
    );
    if (!shared.size) return rows;

    const assignMergeKey = (hub: T) => {
        const candidates = (hub.labels || [])
            .map((raw) => String(raw || '').trim())
            .filter((label) => label && !isReservedHomeMergeLabel(label))
            .map((label) => label.toLowerCase())
            .filter((key) => shared.has(key));
        if (!candidates.length) return '';
        candidates.sort((a, b) => {
            const byCount = (labelStats.get(b)?.count || 0) - (labelStats.get(a)?.count || 0);
            return byCount !== 0 ? byCount : a.localeCompare(b);
        });
        return candidates[0];
    };

    type OrderEntry = { type: 'hub'; index: number } | { type: 'label'; key: string };
    const order: OrderEntry[] = [];
    const groups = new Map<string, T[]>();
    rows.forEach((hub, index) => {
        const mergeKey = assignMergeKey(hub);
        if (!mergeKey) {
            order.push({ type: 'hub', index });
            return;
        }
        if (!groups.has(mergeKey)) {
            groups.set(mergeKey, []);
            order.push({ type: 'label', key: mergeKey });
        }
        groups.get(mergeKey)?.push(hub);
    });

    return order.map((entry) => {
        if (entry.type === 'hub') return rows[entry.index];
        const group = groups.get(entry.key) || [];
        if (group.length < 2) return group[0];
        const randomOrder = group.some((hub) => hub.randomOrder);
        const display = labelStats.get(entry.key)?.display || group[0]?.title || entry.key;
        const labels = [...new Set(group.flatMap((hub) => hub.labels || []).map((label) => String(label || '').trim()).filter(Boolean))];
        return {
            ...mergeHubItemLists(group, { title: display, randomOrder }),
            labels,
            identifier: `label:${entry.key}`,
            collectionRatingKey: group.find((hub) => hub.collectionRatingKey)?.collectionRatingKey || null,
            hubKey: group.find((hub) => hub.hubKey)?.hubKey || null,
        };
    });
};

const mergeSameTitleHubs = <T extends MergeableHub>(rows: T[]) => {
    const order: string[] = [];
    const groups = new Map<string, T[]>();
    rows.forEach((hub) => {
        const key = String(hub.title || '').trim().toLowerCase();
        if (!key) return;
        if (!groups.has(key)) {
            groups.set(key, []);
            order.push(key);
        }
        groups.get(key)?.push(hub);
    });
    return order.map((key) => {
        const group = groups.get(key) || [];
        const randomOrder = group.some((hub) => hub.randomOrder);
        if (group.length === 1) {
            const hub = group[0];
            if (!randomOrder || !Array.isArray(hub.items) || hub.items.length < 2) return hub;
            return { ...hub, items: shuffleItems(hub.items) };
        }
        return mergeHubItemLists(group, { randomOrder });
    });
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

const hubShellKey = (hub: PlexMeta) => {
    // hubIdentifier is often shared ("custom.collection") across every pin.
    // Key + title keep each pinned row.
    const id = String(hub.hubIdentifier || '').trim().toLowerCase();
    const key = String(hub.key || hub.hubKey || '').trim().toLowerCase();
    const title = String(hub.title || '').trim().toLowerCase();
    return [id, key, title].filter(Boolean).join('|');
};

const uniqueHubShells = (...lists: PlexMeta[][]) => {
    const seen = new Set<string>();
    const out: PlexMeta[] = [];
    for (const list of lists) {
        for (const hub of list) {
            const key = hubShellKey(hub);
            if (!key || seen.has(key)) continue;
            seen.add(key);
            out.push(hub);
        }
    }
    return out;
};

/** Keep every inline hub, then fill empty pinned shells without waiting on /hubs/home extras. */
const pinnedHubs = async (data: any, server: PlexServer, many: boolean, extra: PlexMeta[] = []) => {
    const shells = uniqueHubShells(asList<PlexMeta>(containerOf(data).Hub), extra);
    if (!shells.length) return hubsFrom(data, server, many);
    const ready = new Map<string, NonNullable<Awaited<ReturnType<typeof fillPlexHomeHub>>>>();
    // Map each shell individually so empty shells stay addressable by hubShellKey.
    // hubsFrom() drops empties, so a parallel index into its result used to miss pins.
    for (const shell of shells) {
        const key = hubShellKey(shell);
        if (!key) continue;
        const mapped = hubsFrom({ MediaContainer: { Hub: [shell] } }, server, many)[0];
        if (mapped?.items?.length) ready.set(key, mapped);
    }
    const missing = shells.filter((hub) => !ready.has(hubShellKey(hub)));
    if (missing.length) {
        // Fill every pinned shell — a 24-cap left later collections empty on big libraries.
        const filled = await mapPool(missing, 8, async (shell) => ({
            key: hubShellKey(shell),
            hub: await fillPlexHomeHub(shell, server, many),
        }));
        filled.forEach(({ key, hub }) => {
            if (!key || !hub?.items?.length || ready.has(key)) return;
            ready.set(key, hub);
        });
    }
    return uniquifyHubs(shells
        .map((hub) => ready.get(hubShellKey(hub)))
        .filter((hub): hub is NonNullable<typeof hub> => !!hub && hub.items.length > 0));
};

/** Every pinned library hub, including ones Plex listed without inline items. */
const sectionPinnedHubs = async (data: any, server: PlexServer, many: boolean) => {
    const shells = asList<PlexMeta>(containerOf(data).Hub);
    if (!shells.length) return [];
    const filled = await mapPool(shells, 6, (hub) => fillPlexHomeHub(hub, server, many));
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

const mergeHomeHubs = <T extends { identifier?: string; title?: string; items?: unknown[] }>(
    primary: T[],
    extra: T[],
): T[] => {
    const seen = new Set(primary.map((hub) => String(hub.identifier || hub.title || '').trim().toLowerCase()).filter(Boolean));
    const out = primary.slice();
    extra.forEach((hub) => {
        const key = String(hub.identifier || hub.title || '').trim().toLowerCase();
        if (!key || seen.has(key) || !hub.items?.length) return;
        seen.add(key);
        out.push(hub);
    });
    return out;
};

const loadRecentFallbackHubs = async (server: PlexServer, many: boolean, sectionsRaw: any) => {
    const sections = mapSections(sectionsRaw)
        .filter((section) => section.type === 'movie' || section.type === 'show' || section.type === 'artist')
        .slice(0, 6);
    const filled = await mapPool(sections, 3, async (section) => {
        const identifier = `recentlyAdded.${section.key}`;
        const title = `Recently Added · ${section.title}`;
        const items = await loadCollapsedRecentlyAdded(server, section.key, identifier, title);
        if (!items.length) return null;
        return {
            title,
            identifier,
            items,
            hubKey: many
                ? `${server.id}::/library/sections/${section.key}/recentlyAdded`
                : `/library/sections/${section.key}/recentlyAdded`,
            collectionRatingKey: null as string | null,
            randomOrder: undefined as boolean | undefined,
            serverId: server.id,
        };
    });
    return filled.filter((hub): hub is NonNullable<typeof hub> => !!hub);
};

/** Fast-path pin rows. A full home always re-reads Plex so coming back shows the current pins. */
const homePinCache = new Map<string, { at: number; hubs: Awaited<ReturnType<typeof pinnedHubs>> }>();

/** Library item types Home shows: movie, show, season, episode. */
const LIVE_LIBRARY_TYPES = new Set([1, 2, 3, 4]);
/** Plex timeline states: 5 = finished processing (added / refreshed), 9 = deleted. */
const LIVE_TIMELINE_STATES = new Set([5, 9]);
const LIVE_REFRESH_DEBOUNCE_MS = 4000;
const LIVE_RECONNECT_MS = [2000, 5000, 15000, 30000];
const LIVE_SYNC_MS = 60_000;

/** True when a Plex notification changes what Home shows. */
const liveNotificationMatters = (raw: string) => {
    let container: PlexMeta | null = null;
    try {
        container = JSON.parse(raw)?.NotificationContainer || null;
    } catch {
        return false;
    }
    if (!container) return false;
    if (container.type === 'timeline') {
        return asList<PlexMeta>(container.TimelineEntry).some((entry) => (
            LIVE_LIBRARY_TYPES.has(Number(entry.type)) && LIVE_TIMELINE_STATES.has(Number(entry.state))
        ));
    }
    // Watching elsewhere moves Continue Watching / watched state.
    if (container.type === 'playing') {
        return asList<PlexMeta>(container.PlaySessionStateNotification)
            .some((entry) => String(entry.state || '') === 'stopped');
    }
    return false;
};

let liveStop: (() => void) | null = null;

/**
 * Live Home: one Plex notification WebSocket per enabled server. Library adds,
 * refreshes, deletes and stopped playback clear the Home caches and fire
 * PLAYER_HOME_LIVE_EVENT (debounced, so a scan refreshes once).
 */
export const startPlexLiveUpdates = () => {
    if (liveStop) return liveStop;
    if (typeof window === 'undefined' || typeof WebSocket === 'undefined') return () => undefined;
    let stopped = false;
    let debounce = 0;
    const links = new Map<string, { ws: WebSocket | null; attempt: number; timer: number }>();

    const announce = () => {
        window.clearTimeout(debounce);
        debounce = window.setTimeout(() => {
            if (stopped) return;
            clearPlayerGetCache();
            homePinCache.clear();
            window.dispatchEvent(new Event(PLAYER_HOME_LIVE_EVENT));
        }, LIVE_REFRESH_DEBOUNCE_MS);
    };

    const linkKey = (server: PlexServer) => `${server.id}|${server.uri}|${server.accessToken}`;

    const drop = (key: string) => {
        const link = links.get(key);
        if (!link) return;
        window.clearTimeout(link.timer);
        links.delete(key);
        try {
            if (link.ws) {
                link.ws.onclose = null;
                link.ws.close();
            }
        } catch {
            /* ignore */
        }
    };

    const open = (server: PlexServer, key: string) => {
        if (stopped || document.visibilityState === 'hidden') return;
        const link = links.get(key) || { ws: null, attempt: 0, timer: 0 };
        links.set(key, link);
        let url: URL;
        try {
            url = new URL('/:/websockets/notifications', server.uri.endsWith('/') ? server.uri : `${server.uri}/`);
        } catch {
            return;
        }
        url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
        url.searchParams.set('X-Plex-Token', server.accessToken);
        let ws: WebSocket;
        try {
            ws = new WebSocket(url.toString());
        } catch {
            return;
        }
        link.ws = ws;
        ws.onopen = () => { link.attempt = 0; };
        ws.onmessage = (event) => {
            if (typeof event.data === 'string' && liveNotificationMatters(event.data)) announce();
        };
        ws.onclose = () => {
            if (stopped || links.get(key) !== link) return;
            link.ws = null;
            const wait = LIVE_RECONNECT_MS[Math.min(link.attempt, LIVE_RECONNECT_MS.length - 1)];
            link.attempt += 1;
            link.timer = window.setTimeout(() => open(server, key), wait);
        };
    };

    // Profile switches swap tokens and server picks change the list — follow both.
    const sync = () => {
        if (stopped || document.visibilityState === 'hidden') return;
        void ensureServers().then((servers) => {
            if (stopped) return;
            const want = new Map(servers.filter((server) => server.uri && server.accessToken)
                .map((server) => [linkKey(server), server] as const));
            for (const key of Array.from(links.keys())) {
                if (!want.has(key)) drop(key);
            }
            want.forEach((server, key) => {
                if (!links.has(key)) open(server, key);
            });
        }).catch(() => undefined);
    };

    const onVisibility = () => {
        if (document.visibilityState === 'hidden') {
            for (const key of Array.from(links.keys())) drop(key);
            return;
        }
        // Anything Plex sent while we were away was missed — refresh once, then listen again.
        announce();
        sync();
    };

    sync();
    const syncTimer = window.setInterval(sync, LIVE_SYNC_MS);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener(PLAYER_SERVERS_EVENT, sync);
    liveStop = () => {
        stopped = true;
        window.clearTimeout(debounce);
        window.clearInterval(syncTimer);
        document.removeEventListener('visibilitychange', onVisibility);
        window.removeEventListener(PLAYER_SERVERS_EVENT, sync);
        for (const key of Array.from(links.keys())) drop(key);
        liveStop = null;
    };
    return liveStop;
};
const HOME_PIN_CACHE_MS = 3 * 60_000;

const loadServerHome = async (server: PlexServer, many: boolean, full = false) => withMapServer(server, async () => {
    const seasonPoster = readHeroConfig().continueWatchingSeasonPoster;
    // Shell list (no includeMeta) is the pin directory and stays small enough to answer.
    // includeMeta is best-effort inline art; a timeout there must not hide the pins.
    const shellQuery = 'count=40&includeGuids=1';
    const metaQuery = 'count=24&includeMeta=1&includeGuids=1';
    const answered = (timeoutMs: number) => (path: string) => (
        pms(path, server, timeoutMs)
            .then((data) => ({ data, answered: true as const }))
            .catch(() => ({ data: null, answered: false as const }))
    );
    // Timeouts count time queued behind poster loads on the browser's ~6 sockets per
    // server. On a phone link that queue alone blew 5s, so pinned rows came back empty.
    const phone = typeof document !== 'undefined' && document.documentElement?.dataset?.phone === '1';
    const ask = answered(full ? (phone ? 15000 : 5000) : (phone ? 8000 : 3500));
    // User pins can live in either endpoint. In particular, /hubs/home commonly
    // carries the current Plex Home pin order while /hubs/promoted does not.
    const allHubsPromise = ask(`/hubs?${shellQuery}`);
    // IncludeMeta often carries the pinned rows. A short race was returning
    // Continue Watching before that answer arrived, and the follow-up fill then
    // lost the race to other Plex image work.
    const [shellPromoted, shellHome, metaPromoted, metaHome, onDeckData, sectionsRaw] = await Promise.all([
        ask(`/hubs/promoted?${shellQuery}`),
        ask(`/hubs/home?${shellQuery}`),
        ask(`/hubs/promoted?${metaQuery}`),
        ask(`/hubs/home?${metaQuery}`),
        pms('/library/onDeck?X-Plex-Container-Size=24', server, 8000).catch(() => null),
        pms('/library/sections', server, full ? 8000 : 4000).catch(() => null),
    ]);
    const primaryShells = uniqueHubShells(
        metaPromoted.answered ? asList<PlexMeta>(containerOf(metaPromoted.data).Hub) : [],
        metaHome.answered ? asList<PlexMeta>(containerOf(metaHome.data).Hub) : [],
        shellPromoted.answered ? asList<PlexMeta>(containerOf(shellPromoted.data).Hub) : [],
        shellHome.answered ? asList<PlexMeta>(containerOf(shellHome.data).Hub) : [],
    );
    const isPinShell = (hub: PlexMeta) => {
        const identity = {
            identifier: String(hub.hubIdentifier || hub.key || ''),
            title: String(hub.title || ''),
        };
        return !continueHub(identity) && !becauseHub(identity);
    };
    const primaryHasPins = primaryShells.some(isPinShell);
    // /hubs is broader than the user's Home. Use it only as a compatibility
    // fallback when neither Home endpoint supplied a pin directory.
    const allHubs = primaryHasPins
        ? { data: null, answered: false as const }
        : await allHubsPromise;
    const pinShells = primaryHasPins ? primaryShells : uniqueHubShells(
        primaryShells,
        allHubs.answered ? asList<PlexMeta>(containerOf(allHubs.data).Hub) : [],
    );
    const pinDirectoryAnswered = shellPromoted.answered
        || shellHome.answered
        || metaPromoted.answered
        || metaHome.answered
        || allHubs.answered;
    let hubs: Awaited<ReturnType<typeof pinnedHubs>> = [];
    // Full home always re-reads Plex's pins. Collexions rewrites them often, and a
    // 3-minute cache was still showing the previous rows after the user came back.
    const pinHit = full ? undefined : homePinCache.get(server.id);
    if (pinHit && (Date.now() - pinHit.at) < HOME_PIN_CACHE_MS && pinHit.hubs.some(realPinnedHub)) {
        hubs = pinHit.hubs;
    } else if (!full) {
        hubs = hubsFrom({ MediaContainer: { Hub: pinShells } }, server, many);
    } else if (pinShells.length) {
        hubs = await pinnedHubs({ MediaContainer: { Hub: pinShells } }, server, many);
        if (hubs.some(realPinnedHub)) homePinCache.set(server.id, { at: Date.now(), hubs });
    }
    // Recently Added only when Plex really sent no pinned rows. The fast pass
    // returns what it already has; the full pass fills the gap.
    if (full && pinDirectoryAnswered && !hubs.some(contentHomeHub)) {
        const recent = await loadRecentFallbackHubs(server, many, sectionsRaw);
        hubs = mergeHomeHubs(hubs, recent);
    }
    hubs = uniquifyHubs(hubs);
    hubs = applyHeroRowFlags(hubs, server);
    const onDeck = mapList(onDeckData).map((item) => asContinueWatchingItem(item, null, seasonPoster));
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
    const watchingList = refreshed.flat().filter((item) => {
        const key = showKey(item);
        if (!item.ratingKey || seenWatching.has(key)) return false;
        seenWatching.add(key);
        return true;
    });
    const merged = watchingList;
    // Always keep On Deck. /hubs/promoted often has only collection rails (no continue
    // hub); the old ternary then discarded onDeck whenever any other hub had items,
    // which hid Continue Watching entirely on Android TV / direct home.
    const continueItems = merged.length ? merged : onDeck;
    hubs = hubs.filter((hub) => !continueHub(hub));
    if (continueItems.length) {
        hubs = [
            {
                title: primary?.title || 'Continue Watching',
                identifier: primary?.identifier || 'home.continue',
                items: continueItems,
                hubKey: primary?.hubKey || (many ? `${server.id}::/library/onDeck` : '/library/onDeck'),
                collectionRatingKey: null as string | null,
                randomOrder: undefined as boolean | undefined,
                serverId: server.id,
            },
            ...hubs,
        ];
    }
    const sections = mapSections(sectionsRaw).map((section) => ({
        ...section,
        key: many ? `${server.id}::${section.key}` : section.key,
        serverId: server.id,
    }));
    const hydratedContinue = hubs.find((hub) => continueHub(hub))?.items || continueItems;
    if (full) {
        try {
            hubs = await enrichThinRecentHubs(hubs, server, sections);
        } catch {
            /* A recently-added refill must not throw away the pins already loaded. */
        }
        try {
            hubs = await attachHeroCoverArt(await stampHeroRows(hubs, server), server);
        } catch {
            /* Hero cover art must not throw away the pins already loaded. */
        }
        if (hubs.some(realPinnedHub)) homePinCache.set(server.id, { at: Date.now(), hubs });
        const pinHubs = hubs;
        void attachBecauseYouWatched(pinHubs, continueItems, server)
            .then((next) => hydrateHubsBrandMeta(next, server).catch(() => next))
            .then((next) => {
                homePinCache.set(server.id, { at: Date.now(), hubs: next });
            })
            .catch(() => undefined);
    }
    return {
        server,
        hubs,
        onDeck: hydratedContinue,
        sections,
        recentByLibrary: [],
        partial: !full,
        becauseAttached: true,
    };
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

/** Map screensaver setting → hero-style pool loaders. */
const screensaverHeroMode = (source: string) => {
    const key = String(source || '').trim().toLowerCase();
    if (key === 'continue_watching') return 'continue_watching';
    if (key === 'trending') return 'trending_week';
    if (key === 'popular') return 'popular';
    if (key === 'new_releases') return 'new_releases';
    if (key === 'recently_added') return 'recently_added';
    if (key === 'most_watched') return 'most_watched';
    if (key === 'unwatched' || key === 'recommended') return 'unwatched_picks';
    if (key === 'random') return 'random_spotlight';
    return 'continue_watching';
};

const screensaverArtOwnerKey = (item: {
    type?: string | null;
    ratingKey?: string | null;
    grandparentRatingKey?: string | null;
    parentRatingKey?: string | null;
}) => {
    const type = String(item?.type || '');
    if (type === 'episode') return String(item.grandparentRatingKey || '').replace(/\D/g, '');
    if (type === 'season') return String(item.parentRatingKey || '').replace(/\D/g, '');
    if (type === 'movie' || type === 'show') return String(item.ratingKey || '').replace(/\D/g, '');
    return '';
};

/** Replace hub art with the background currently selected on the movie or show. */
const refreshScreensaverArt = async <T extends {
    type?: string | null;
    ratingKey?: string | null;
    grandparentRatingKey?: string | null;
    parentRatingKey?: string | null;
    serverId?: string | null;
    art?: string | null;
}>(items: T[]) => {
    const groups = new Map<string, { server: PlexServer; keys: Set<string> }>();
    for (const item of items) {
        const key = screensaverArtOwnerKey(item);
        if (!key) continue;
        const server = resolveServer(item.serverId, key);
        if (!server?.id) continue;
        const group = groups.get(server.id) || { server, keys: new Set<string>() };
        group.keys.add(key);
        groups.set(server.id, group);
    }
    const artByOwner = new Map<string, string>();
    for (const { server, keys } of groups.values()) {
        const ids = [...keys];
        for (let index = 0; index < ids.length; index += 40) {
            const chunk = ids.slice(index, index + 40).map((id) => encodeURIComponent(id)).join(',');
            const data = await pms(`/library/metadata/${chunk}?includeImages=1`, server, 8000).catch(() => null);
            for (const meta of asList<PlexMeta>(containerOf(data).Metadata)) {
                const id = String(meta.ratingKey || '').replace(/\D/g, '');
                const path = stampedArtPath(id, meta.updatedAt as string | number | null | undefined, meta.art);
                if (id && path) artByOwner.set(`${server.id}:${id}`, path);
            }
        }
    }
    if (!artByOwner.size) return items;
    return items.map((item) => {
        const key = screensaverArtOwnerKey(item);
        const server = resolveServer(item.serverId, key);
        const art = server?.id && key ? artByOwner.get(`${server.id}:${key}`) : '';
        if (!art || art === item.art) return item;
        return { ...item, art, backdropArt: art };
    });
};

const buildScreensaverPool = async (source: string) => {
    await ensureServers();
    const effective = screensaverHeroMode(source);
    let items: Array<HeroMappedItem | ReturnType<typeof mapItem>> = [];
    try {
        if (effective === 'continue_watching') {
            items = await heroItemsFromServers((server) => (
                heroPms('/library/onDeck?X-Plex-Container-Size=24', server)
                    .then((data) => (data ? mapList(data).filter(heroReady) : []))
            ));
        } else if (effective === 'popular') {
            items = await firstHeroPool([
                (server) => librarySpotlight(server, 'audienceRating:desc'),
                (server) => librarySpotlight(server, 'rating:desc'),
                (server) => sectionFeed(server, 'recentlyAdded'),
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
        }
        // Continue Watching must stay empty rather than borrow Recently Added.
        // An On Deck timeout was being treated as "no slides" and replaced the
        // user's actual row with unrelated shows.
        if (effective !== 'continue_watching' && !heroSlidesFrom(items).length) {
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
    const slides = shuffleItems(heroSlidesFrom(await refreshScreensaverArt(items), 24));
    return { source: String(source || 'continue_watching'), items: slides };
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

const itemGuids = (meta: PlexMeta | null | undefined) => {
    const out: string[] = [];
    const push = (value: unknown) => {
        const guid = String(value || '').trim();
        if (guid && !out.includes(guid)) out.push(guid);
    };
    push(meta?.guid);
    asList<PlexMeta>(meta?.Guid).forEach((row) => push(row.id || row.tag));
    return out;
};

const matchLibraryByGuids = async (guids: string[], title: string, year: string | number | null, type: string, server: PlexServer) => {
    for (const guid of guids.slice(0, 8)) {
        const data = await pms(`/library/all?guid=${encodeURIComponent(guid)}`, server, 5000).catch(() => null);
        const meta = asList<PlexMeta>(containerOf(data).Metadata)[0];
        if (meta) return mapItem(meta);
    }
    const queryTitle = String(title || '').trim();
    if (!queryTitle) return null;
    const data = await pms(`/hubs/search?query=${encodeURIComponent(queryTitle)}&limit=12`, server, 6000).catch(() => null);
    const rows = asList<PlexMeta>(containerOf(data).Hub).flatMap((hub) => asList<PlexMeta>(hub.Metadata));
    const wantType = /episode/i.test(type)
        ? 'episode'
        : (/show|tv|series/i.test(type) ? 'show' : 'movie');
    const wantYear = String(year || '').slice(0, 4);
    const want = queryTitle.toLowerCase();
    const hit = rows.find((row) => {
        const mapped = normalizeItemType(row);
        if (mapped !== wantType) return false;
        const titleHit = String(row.title || '').trim().toLowerCase() === want;
        if (!titleHit) return false;
        if (!wantYear || wantType === 'episode') return true;
        return String(row.year || '').slice(0, 4) === wantYear;
    }) || rows.find((row) => {
        if (normalizeItemType(row) !== wantType) return false;
        return String(row.title || '').trim().toLowerCase() === want;
    });
    return hit ? mapItem(hit) : null;
};

/** Find a local playable library copy for Watch Together (sync-only join). */
const resolveWatchTogetherLocal = async (query: URLSearchParams) => {
    await ensureServers();
    const guids = String(query.get('guids') || '')
        .split(',')
        .map((row) => row.trim())
        .filter(Boolean);
    const tmdbId = Number(query.get('tmdbId') || 0);
    if (Number.isFinite(tmdbId) && tmdbId > 0) {
        if (!guids.includes(`tmdb://${tmdbId}`)) guids.push(`tmdb://${tmdbId}`);
        if (!guids.includes(`themoviedb://${tmdbId}`)) guids.push(`themoviedb://${tmdbId}`);
    }
    const title = String(query.get('title') || '').trim();
    const year = query.get('year');
    const type = String(query.get('type') || query.get('mediaType') || 'movie').trim() || 'movie';
    for (const server of enabledServers()) {
        const local = await withMapServer(server, () => matchLibraryByGuids(guids, title, year, type, server));
        if (local?.ratingKey && (local.canPlay || local.type === 'movie' || local.type === 'episode')) {
            return { item: local };
        }
    }
    return { item: null };
};

const loadWatchlist = async () => {
    const token = accountToken() || readOwnerToken();
    if (!token) return { items: [] as ReturnType<typeof mapItem>[] };
    const url = `${DISCOVER_BASE}/library/sections/watchlist/all?includeGuids=1&X-Plex-Container-Size=100`;
    const data = await plexFetch(url, token).catch(() => null);
    const rows = asList<PlexMeta>(containerOf(data).Metadata);
    const servers = enabledServers();
    const mapped = await mapPool(rows, 3, async (row) => {
        const discoverKey = String(row.ratingKey || '');
        const title = String(row.title || '');
        const type = String(row.type || '');
        const year = row.year != null ? String(row.year) : '';
        let local: ReturnType<typeof mapItem> | null = null;
        for (const server of servers) {
            local = await withMapServer(server, () => matchLibraryByGuids(itemGuids(row), title, year, type, server));
            if (local?.ratingKey) break;
        }
        if (!local?.ratingKey) return null;
        return {
            ...local,
            watchlisted: true,
            discoverRatingKey: discoverKey || null,
        };
    });
    const items: ReturnType<typeof mapItem>[] = [];
    const seen = new Set<string>();
    for (const item of mapped) {
        if (!item?.ratingKey || seen.has(item.ratingKey)) continue;
        seen.add(item.ratingKey);
        items.push(item);
    }
    return { items };
};

const watchlistAction = async (method: 'add' | 'remove', ratingKey: string, guid?: string) => {
    const token = accountToken() || readOwnerToken();
    if (!token) throw new Error('Not signed in to Plex');
    const action = method === 'add' ? 'addToWatchlist' : 'removeFromWatchlist';
    const params = new URLSearchParams();
    if (ratingKey) params.set('ratingKey', ratingKey);
    if (guid) params.set('guid', guid);
    await plexFetch(`${DISCOVER_BASE}/actions/${action}?${params}`, token, { method: 'PUT' });
    return { ok: true };
};

type SubtitleSearchItem = { id: string; label: string; url: string; downloadKey: string; codec: string | null };

const loadSubtitleSearch = async (ratingKey: string, server: PlexServer | null, language = 'en') => {
    if (!server || !ratingKey) return { items: [] as SubtitleSearchItem[] };
    return withMapServer(server, async () => {
        const lang = String(language || 'en').trim() || 'en';
        const data = await pms(
            `/library/metadata/${encodeURIComponent(ratingKey)}/subtitles?language=${encodeURIComponent(lang)}`,
            server,
            12000,
        ).catch(() => null);
        const streams = asList<PlexMeta>(containerOf(data).Stream)
            .concat(asList<PlexMeta>(containerOf(data).Metadata).flatMap((row) => asList<PlexMeta>(row.Stream)));
        const items: SubtitleSearchItem[] = [];
        const seen = new Set<string>();
        for (const stream of streams) {
            const keyPath = String(stream.key || '').trim();
            if (!keyPath) continue;
            const id = String(stream.id || keyPath);
            if (seen.has(id)) continue;
            seen.add(id);
            const langName = String(stream.languageCode || stream.languageTag || stream.language || '').trim();
            // title is the release filename; displayTitle is just "English (SRT)".
            const title = String(stream.title || stream.displayTitle || langName || 'Subtitle').trim();
            items.push({
                id: `os:${id}`,
                label: `${title}${langName && !title.toLowerCase().includes(langName.toLowerCase()) ? ` · ${langName}` : ''} · OpenSubtitles`,
                // Search hits aren't subtitle files — PMS has to download one first (downloadSubtitle).
                url: '',
                downloadKey: keyPath,
                codec: stream.codec ? String(stream.codec) : null,
            });
        }
        return { items };
    });
};

const externalSubtitleStreams = async (ratingKey: string, server: PlexServer) => {
    const data = await pms(`/library/metadata/${encodeURIComponent(ratingKey)}`, server, 12000).catch(() => null);
    const meta = asList<PlexMeta>(containerOf(data).Metadata)[0] || {};
    return asList<PlexMeta>(meta.Media)
        .flatMap((media) => asList<PlexMeta>(media.Part))
        .flatMap((part) => asList<PlexMeta>(part.Stream))
        .filter((stream) => Number(stream.streamType) === 3 && /^\/library\/streams\//.test(String(stream.key || '')));
};

/** Have PMS download an OpenSubtitles hit, then return the new sidecar stream's URL. */
const downloadSubtitle = async (ratingKey: string, server: PlexServer | null, downloadKey: string) => {
    if (!server || !ratingKey || !downloadKey) throw new Error('Subtitle not available.');
    return withMapServer(server, async () => {
        const before = new Set((await externalSubtitleStreams(ratingKey, server)).map((stream) => String(stream.id)));
        const put = new URL(
            `/library/metadata/${encodeURIComponent(ratingKey)}/subtitles`,
            server.uri.endsWith('/') ? server.uri : `${server.uri}/`,
        );
        put.searchParams.set('key', downloadKey);
        put.searchParams.set('X-Plex-Token', server.accessToken);
        await plexFetch(put.toString(), server.accessToken, { method: 'PUT' });
        // PMS attaches the file a moment after the PUT returns.
        for (let attempt = 0; attempt < 8; attempt += 1) {
            const added = (await externalSubtitleStreams(ratingKey, server))
                .filter((stream) => !before.has(String(stream.id)))
                .sort((a, b) => Number(b.id || 0) - Number(a.id || 0))[0];
            if (added) {
                clearPlayerGetCache();
                const url = new URL(String(added.key), server.uri.endsWith('/') ? server.uri : `${server.uri}/`);
                url.searchParams.set('X-Plex-Token', server.accessToken);
                return { url: url.toString(), codec: added.codec ? String(added.codec) : null };
            }
            await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        throw new Error('Plex did not add the subtitle.');
    });
};

const allLeavesOf = async (ratingKey: string, server: PlexServer | null = resolveServer('', ratingKey)) => withMapServer(server, async () => {
    const data = await pms(
        `/library/metadata/${encodeURIComponent(ratingKey)}/allLeaves?includeUserState=1&X-Plex-Container-Size=500`,
        server,
    ).catch(() => null);
    return mapList(data);
});

const collectPlayableQueue = async (key: string, server: PlexServer) => {
    const meta = await metadata(key, server);
    const item = mapItem(meta);
    const playable = (rows: ReturnType<typeof mapItem>[]) => rows.filter((row) => (
        row.type === 'movie' || row.type === 'episode' || row.type === 'clip' || row.type === 'trailer' || row.type === 'track'
    ));
    if (item.type === 'movie' || item.type === 'episode' || item.type === 'clip' || item.type === 'trailer' || item.type === 'track') {
        return playable([item]);
    }
    if (item.type === 'album') return playable(await childrenOf(key, server));
    if (item.type === 'artist') return playable(await allLeavesOf(key, server));
    if (item.type === 'season') return playable(await childrenOf(key, server));
    if (item.type === 'show') {
        const seasons = (await childrenOf(key, server, { excludeAllLeaves: true }))
            .filter((row) => row.type === 'season');
        const episodes: ReturnType<typeof mapItem>[] = [];
        for (const season of seasons) {
            episodes.push(...await childrenOf(season.ratingKey, server));
        }
        return playable(episodes);
    }
    return playable(await childrenOf(key, server));
};

const shuffleQueueFor = async (key: string, server: PlexServer) => {
    const items = await collectPlayableQueue(key, server);
    return { items: shuffleItems(items) };
};

const playFromQueueFor = async (key: string, server: PlexServer) => {
    const meta = await metadata(key, server);
    const item = mapItem(meta);
    if (item.type === 'track') {
        const albumKey = String(item.parentRatingKey || '');
        const all = albumKey ? await collectPlayableQueue(albumKey, server) : [item];
        const idx = all.findIndex((row) => row.ratingKey === key);
        return { items: idx >= 0 ? all.slice(idx) : [item] };
    }
    if (item.type !== 'episode') {
        const rest = await collectPlayableQueue(key, server);
        const idx = rest.findIndex((row) => row.ratingKey === key);
        return { items: idx >= 0 ? rest.slice(idx) : rest };
    }
    // Show-scoped so season finales continue into the next season.
    const showKey = String(item.grandparentRatingKey || item.parentRatingKey || '');
    if (!showKey) return { items: [item] };
    const all = await collectPlayableQueue(showKey, server);
    const idx = all.findIndex((row) => row.ratingKey === key);
    return { items: idx >= 0 ? all.slice(idx) : [item] };
};

const pickRelatedHubForBecause = (hubs: PlexMeta[]) => {
    const scored = hubs.map((hub) => {
        const blob = `${hub.title || ''} ${hub.hubIdentifier || ''} ${hub.key || ''}`;
        const count = asList<PlexMeta>(hub.Metadata).length;
        let score = count;
        if (/similar|related|recommend|because\s+you/i.test(blob)) score += 100;
        if (/cast|crew|director|writer|genre|from\s+the\s+same/i.test(blob)) score -= 40;
        return { hub, score, count };
    }).filter((row) => row.count > 0);
    scored.sort((a, b) => b.score - a.score || b.count - a.count);
    return scored[0]?.hub || null;
};

const attachBecauseYouWatched = async (
    hubs: Array<{ title: string; identifier: string; items: ReturnType<typeof mapItem>[]; hubKey?: string | null; serverId?: string | null }>,
    continueItems: ReturnType<typeof mapItem>[],
    server: PlexServer,
) => {
    // Random Continue Watching titles (not always the first few on the rail).
    const candidates: Array<{ key: string; title: string }> = [];
    for (const item of continueItems) {
        const key = item.type === 'episode' || item.type === 'season'
            ? String(item.grandparentRatingKey || item.parentRatingKey || item.ratingKey || '')
            : String(item.ratingKey || '');
        const title = item.type === 'episode' || item.type === 'season'
            ? String(item.showTitle || item.title || '')
            : String(item.title || '');
        const cleanKey = String(key || '').replace(/^\d+::/, '').replace(/\D/g, '') || String(key || '').trim();
        if (!cleanKey || !title || candidates.some((row) => row.key === cleanKey)) continue;
        candidates.push({ key: cleanKey, title });
    }
    const seeds = shuffleItems(candidates).slice(0, 3);
    if (!seeds.length) return hubs;
    const built = await Promise.all(seeds.map(async (seed) => {
        const data = await pms(
            `/hubs/metadata/${encodeURIComponent(seed.key)}/related?count=16&includeMeta=1&includeGuids=1`,
            server,
            10000,
        ).catch(() => null);
        const relatedHubs = asList<PlexMeta>(containerOf(data).Hub);
        const hub = pickRelatedHubForBecause(relatedHubs);
        if (!hub) return null;
        const items = mapList({ MediaContainer: { Metadata: asList<PlexMeta>(hub.Metadata) } })
            .filter((row) => row.ratingKey !== seed.key)
            .slice(0, 16);
        if (!items.length) return null;
        return {
            title: `Because you watched ${seed.title}`,
            identifier: `because:${seed.key}`,
            items,
            hubKey: String(hub.key || '') || null,
            serverId: server.id,
        };
    }));
    const extra = built.filter((row): row is NonNullable<typeof row> => !!row);
    if (!extra.length) return hubs;
    const seen = new Set(hubs.filter((hub) => becauseHub(hub)).map((hub) => hub.identifier));
    const unique = extra.filter((hub) => {
        if (seen.has(hub.identifier)) return false;
        seen.add(hub.identifier);
        return true;
    });
    return unique.length ? [...hubs, ...unique] : hubs;
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
            username: homeUser?.title
                || user?.friendlyName
                || user?.username
                || user?.title
                || server?.name
                || 'Plex',
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
    if (path === '/api/media-player/watchlist' && method === 'GET') {
        await ensureServers();
        return loadWatchlist();
    }
    if (path === '/api/media-player/watchlist' && (method === 'POST' || method === 'PUT' || method === 'DELETE')) {
        const action = method === 'DELETE' || body?.remove ? 'remove' : 'add';
        let guid = String(body?.guid || query.get('guid') || '');
        const discoverKey = String(body?.discoverRatingKey || '').trim();
        const libraryKey = String(body?.ratingKey || query.get('ratingKey') || '').trim();
        let fromGuid = guid.match(/^plex:\/\/(?:movie|show|season|episode)\/([a-f0-9]+)/i);
        let ratingKey = discoverKey || (fromGuid ? fromGuid[1] : '');
        // Hub cards sometimes omit plex:// guids — resolve from library metadata.
        if (!ratingKey && !fromGuid && libraryKey) {
            await ensureServers();
            const server = resolveServer(query.get('server') || body?.serverId, libraryKey);
            if (server) {
                const meta = await metadata(libraryKey, server).catch(() => null);
                const type = String(meta?.type || '').toLowerCase();
                const preferred = (type === 'episode' || type === 'season')
                    ? String(meta?.grandparentGuid || meta?.parentGuid || meta?.guid || '')
                    : String(meta?.guid || '');
                if (preferred) guid = preferred;
                fromGuid = guid.match(/^plex:\/\/(?:movie|show|season|episode)\/([a-f0-9]+)/i);
                ratingKey = fromGuid ? fromGuid[1] : '';
            }
        }
        if (!ratingKey && !guid) throw new Error('Missing watchlist id');
        return watchlistAction(action, ratingKey, guid);
    }
    const shufflePath = path.match(/^\/api\/media-player\/queue\/shuffle\/([^/]+)$/);
    if (shufflePath) {
        const key = decodeURIComponent(shufflePath[1]);
        await ensureServers();
        const server = resolveServer(query.get('server'), key);
        if (!server) return { items: [] };
        return withMapServer(server, () => shuffleQueueFor(key, server));
    }
    const fromPath = path.match(/^\/api\/media-player\/queue\/from\/([^/]+)$/);
    if (fromPath) {
        const key = decodeURIComponent(fromPath[1]);
        await ensureServers();
        const server = resolveServer(query.get('server'), key);
        if (!server) return { items: [] };
        return withMapServer(server, () => playFromQueueFor(key, server));
    }
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
    if (path === '/api/media-player/servers/status') {
        await ensureServers();
        const servers = enabledServers();
        const statuses = await Promise.all(servers.map(async (server) => ({
            id: server.id,
            name: server.name,
            online: await probe(server.uri, server.accessToken),
        })));
        return { servers: statuses };
    }
    if (path === '/api/media-player/libraries') {
        await ensureServers();
        let servers = enabledServers();
        // Boot can race discovery — wait once more if the list is still empty.
        if (!servers.length) {
            const token = accountToken() || readOwnerToken();
            if (token) {
                await beginServerDiscovery(token).catch(() => []);
                servers = enabledServers();
            }
        }
        const many = servers.length > 1;
        const loadSections = async (server: PlexServer) => {
            const raw = await pms('/library/sections', server, 8000).catch(() => null);
            if (raw) return mapSections(raw);
            // One retry — PMS often answers on the second try after wake / TLS.
            const retry = await pms('/library/sections', server, 10000).catch(() => null);
            return mapSections(retry);
        };
        const groups = await Promise.all(servers.map((server) => (
            withMapServer(server, async () => (
                (await loadSections(server)).map((section) => ({
                    ...section,
                    key: many ? `${server.id}::${section.key}` : section.key,
                    title: section.title,
                    serverId: server.id,
                    serverName: server.name,
                }))
            )).catch(() => [] as Array<{
                key: string;
                title: string;
                type: string;
                agent: string;
                serverId: string;
                serverName: string;
            }>)
        )));
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
        if (!rows.length) {
            return {
                libraries: [],
                continueWatching: [],
                recentByLibrary: [],
                playlists: [],
                hubs: [],
                partial: true,
            };
        }
        const hubs = mergeSameTitleHubs(mergeSameLabelHubs(rows.flatMap((row) => row.hubs.map((hub) => ({
            ...hub,
            identifier: many ? `${row.server.id}:${hub.identifier}` : hub.identifier,
        })))));
        const libraries = rows.flatMap((row) => row.sections);
        return {
            libraries,
            continueWatching: rows.flatMap((row) => row.onDeck),
            recentByLibrary: rows.flatMap((row) => row.recentByLibrary),
            playlists: [],
            hubs,
            partial: rows.some((row) => row.partial),
            becauseAttached: rows.every((row) => row.becauseAttached === true),
        };
    }
    if (path === '/api/media-player/home-hero-config') {
        if (method === 'PUT' || method === 'POST') return writeHeroConfig(body);
        return readHeroConfig();
    }
    if (path === '/api/media-player/home-hero') return buildHomeHero();
    if (path === '/api/media-player/screensaver') {
        return buildScreensaverPool(String(query.get('source') || 'continue_watching'));
    }
    if (path === '/api/media-player/hub') {
        const { server, path: hubPath } = splitLibraryKey(String(query.get('path') || ''));
        if (!server || !hubPath) return { title: query.get('title') || '', items: [] };
        const identifier = String(query.get('identifier') || query.get('id') || '');
        const random = isRandomOrderSource(hubPath) || isRandomOrderSource({ hubIdentifier: identifier, key: hubPath });
        const fetchPath = random ? withPlexSortParam(hubPath, 'random') : hubPath;
        const pageSize = /recentlyadded/i.test(fetchPath) ? 500 : 80;
        const data = await withMapServer(server, () => pms(`${fetchPath}${fetchPath.includes('?') ? '&' : '?'}X-Plex-Container-Size=${pageSize}`, server));
        const items = mapList(data);
        return { title: query.get('title') || '', items: random && items.length > 1 ? shuffleItems(items) : items };
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
            includeGuids: '1',
        });
        const sort = query.get('sort');
        if (sort) params.set('sort', sort);
        for (const facet of [
            'genre',
            'decade',
            'year',
            'contentRating',
            'resolution',
            'studio',
            'network',
            'country',
            'collection',
            'audioLanguage',
            'subtitleLanguage',
            'actor',
            'director',
            'writer',
            'producer',
            'label',
        ] as const) {
            const value = String(query.get(facet) || '').trim();
            if (value) params.set(facet, value);
        }
        if (query.get('inProgress') === '1') params.set('filters', 'inProgress=1');
        else if (query.get('unwatched') === '1') params.set('unwatched', '1');
        if (query.get('hdr') === '1') params.set('hdr', '1');
        if (query.get('duplicate') === '1') params.set('duplicate', '1');
        const letter = letterCharOf(String(query.get('letter') || ''));
        const pinnedType = sectionAllType(sectionRow?.type || '');
        if (pinnedType) params.set('type', pinnedType);
        const listPath = `/library/sections/${encodeURIComponent(section)}/all?`;
        let data: any = null;
        let items: ReturnType<typeof mapList> = [];
        let windowOffset = Math.max(0, Number(start) || 0);
        if (letter && pinnedType) {
            // Jump into the full title-sorted library at this letter (prev letters above,
            // next below). Never use Plex's filtered firstCharacter directory as the page.
            if (!params.get('sort') || params.get('sort') === 'titleSort') params.set('sort', 'titleSort:asc');
            const pageStart = Math.max(0, Number(start) || 0);
            const pageSize = Math.max(1, Number(size) || 50);
            const wantedRank = letterRank(letter);
            const wantedUpper = letter.toUpperCase();
            const filterStamp = [
                'genre',
                'decade',
                'year',
                'contentRating',
                'resolution',
                'studio',
                'network',
                'country',
                'collection',
                'audioLanguage',
                'subtitleLanguage',
                'actor',
                'director',
                'writer',
                'producer',
                'label',
                'unwatched',
                'filters',
                'hdr',
                'duplicate',
            ].map((key) => params.get(key) || '').join('|');
            const cacheKey = `${server?.id || ''}:${section}:${wantedUpper}:${filterStamp}`;
            const isWantedLetter = (rows: ReturnType<typeof mapList>) => {
                if (!rows.length) return false;
                const rank = titleLetterRank(rows[0]?.title);
                return wantedUpper === '#' ? rank === 0 : rank === wantedRank;
            };
            const loadAt = async (index: number, count: number) => {
                const next = new URLSearchParams(params);
                next.set('X-Plex-Container-Start', String(Math.max(0, index)));
                next.set('X-Plex-Container-Size', String(Math.max(1, count)));
                next.delete('firstCharacter');
                return withMapServer(server, () => pms(`${listPath}${next}`, server, 8000).catch(() => null));
            };

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
                if (pageStart === 0 && origin > 0) {
                    const beforeCount = Math.min(origin, pageSize);
                    const beforeData = await loadAt(origin - beforeCount, beforeCount);
                    const atData = await loadAt(origin, pageSize);
                    const beforeItems = mapList(beforeData);
                    const atItems = mapList(atData);
                    items = [...beforeItems, ...atItems];
                    data = atData || beforeData;
                    windowOffset = origin - beforeItems.length;
                    if (atItems.length && !isWantedLetter(atItems)) {
                        letterOriginCache.delete(cacheKey);
                        data = { MediaContainer: { totalSize: 0 } };
                        items = [];
                        windowOffset = 0;
                    }
                } else {
                    data = await loadAt(origin + pageStart, pageSize);
                    items = mapList(data);
                    windowOffset = origin + pageStart;
                    if (pageStart === 0 && items.length && !isWantedLetter(items)) {
                        letterOriginCache.delete(cacheKey);
                        data = { MediaContainer: { totalSize: 0 } };
                        items = [];
                        windowOffset = 0;
                    }
                }
            }
            if (!data) {
                data = { MediaContainer: { totalSize: 0 } };
                items = [];
                windowOffset = 0;
            }
        } else if (letter) {
            data = { MediaContainer: { totalSize: 0 } };
            items = [];
            windowOffset = 0;
        } else {
            data = await withMapServer(server, () => pms(`${listPath}${params}`, server));
            items = mapList(data);
        }
        const container = containerOf(data);
        return {
            title: sectionRow?.title || 'Library',
            type: sectionRow?.type || 'movie',
            total: Number(container.totalSize || container.size || 0),
            offset: windowOffset,
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
        const seasonPoster = readHeroConfig().continueWatchingSeasonPoster;
        // Prefer includeMeta so pinned shells often arrive with items (matches portal).
        // Always fetch section On Deck in parallel — /hubs/sections often omits Continue
        // Watching (or returns an empty shell), which hid the rail on Recommended.
        const requestedP = pms(
            `/hubs/sections/${encodeURIComponent(section)}?includeMeta=1&includeGuids=1&count=18`,
            active,
            8000,
        )
            .then((data) => ({ data, answered: true as const }))
            .catch(() => ({ data: null, answered: false as const }));
        const plainP = pms(
            `/hubs/sections/${encodeURIComponent(section)}?includeGuids=1&count=18`,
            active,
            8000,
        )
            .then((data) => ({ data, answered: true as const }))
            .catch(() => ({ data: null, answered: false as const }));
        const onDeckP = pms(
            `/library/sections/${encodeURIComponent(section)}/onDeck?X-Plex-Container-Size=24`,
            active,
            8000,
        ).catch(() => null);
        // Paint from includeMeta when it lands quickly. Don't sit behind the shell
        // request, and don't wait out a slow includeMeta before filling shells.
        const earlyMeta = await Promise.race([
            requestedP,
            new Promise<{ data: null; answered: false }>((resolve) => {
                setTimeout(() => resolve({ data: null, answered: false }), 900);
            }),
        ]);
        let hubs = earlyMeta.answered
            ? await withMapServer(active, () => sectionPinnedHubs(earlyMeta.data, active, many))
            : [];
        let metaAnswered = earlyMeta.answered;
        if (!hubs.some(contentHomeHub)) {
            const plain = await plainP;
            if (plain.answered) {
                const retry = await withMapServer(active, () => sectionPinnedHubs(plain.data, active, many));
                if (retry.some(contentHomeHub) || retry.length > hubs.length) hubs = retry;
            }
        }
        if (!hubs.some(contentHomeHub) && !metaAnswered) {
            const late = await requestedP;
            metaAnswered = late.answered;
            if (late.answered) {
                const retry = await withMapServer(active, () => sectionPinnedHubs(late.data, active, many));
                if (retry.some(contentHomeHub) || retry.length > hubs.length) hubs = retry;
            }
        }
        const onDeckData = await onDeckP;
        if (metaAnswered && !hubs.some(contentHomeHub)) {
            const pinnedType = sectionAllType(sectionRow?.type || '');
            if (pinnedType) {
                const recent = await withMapServer(active, () => (
                    loadCollapsedRecentlyAdded(active, section, 'recentlyAdded', 'Recently Added')
                ));
                if (recent.length) {
                    hubs = uniquifyHubs([
                        ...hubs,
                        {
                            title: 'Recently Added',
                            identifier: 'recentlyAdded',
                            items: recent,
                        },
                    ]);
                }
            }
        }
        const onDeckItems = mapList(onDeckData).map((item) => asContinueWatchingItem(item, null, seasonPoster));
        const sectionCw = hubs.filter((hub) => continueHub(hub));
        const otherHubs = hubs.filter((hub) => !continueHub(hub));
        // Prefer section On Deck (same as portal assembleLibraryHomeHubs); fall back to
        // whatever continue hub /hubs/sections returned.
        const continueItems = onDeckItems.length
            ? onDeckItems
            : (sectionCw.find((hub) => hub.items?.length)?.items || []);
        hubs = otherHubs;
        if (continueItems.length) {
            const primaryCw = sectionCw[0];
            hubs = [
                {
                    title: primaryCw?.title || 'Continue Watching',
                    identifier: primaryCw?.identifier || 'continueWatching',
                    items: continueItems,
                    hubKey: primaryCw?.hubKey
                        || (many
                            ? `${active.id}::/library/sections/${section}/onDeck`
                            : `/library/sections/${section}/onDeck`),
                    collectionRatingKey: null as string | null,
                    randomOrder: undefined as boolean | undefined,
                    serverId: active.id,
                },
                ...hubs,
            ];
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
                        items: await refreshContinueEpisodeThumbs(hub.items, active, seasonPoster),
                    });
                }
                // Match Home: stamp Heros/Heroes labels, then merge same-label / same-title rows.
                return attachHeroCoverArt(await stampHeroRows(next, active), active);
            });
            return {
                title: sectionRow?.title || 'Library',
                type: sectionRow?.type || 'movie',
                hubs: await hydrateHubsBrandMeta(
                    mergeSameTitleHubs(mergeSameLabelHubs(stamped)),
                    active,
                ),
            };
        }
        if (!metaAnswered) {
            return {
                title: sectionRow?.title || 'Library',
                type: sectionRow?.type || 'movie',
                hubs: emptyHubs,
            };
        }
        const pinnedType = sectionAllType(sectionRow?.type || '');
        if (!pinnedType) {
            return {
                title: sectionRow?.title || 'Library',
                type: sectionRow?.type || 'movie',
                hubs: emptyHubs,
            };
        }
        const recent = await withMapServer(active, () => (
            loadCollapsedRecentlyAdded(active, section, 'recentlyAdded', 'Recently Added')
        ));
        return {
            title: sectionRow?.title || 'Library',
            type: sectionRow?.type || 'movie',
            hubs: await hydrateHubsBrandMeta([
                {
                    title: 'Recently Added',
                    identifier: 'recentlyAdded',
                    items: recent,
                },
            ].filter((hub) => hub.items.length), active),
        };
    }
    const libraryFilters = path.match(/^\/api\/media-player\/libraries\/([^/]+)\/filters$/);
    if (libraryFilters) {
        const { server, section } = splitLibraryKey(libraryFilters[1]);
        const sections = mapSections(await pms('/library/sections', server).catch(() => null));
        const sectionRow = sections.find((row) => row.key === section);
        const pinnedType = sectionAllType(sectionRow?.type || '');
        const typeQs = pinnedType ? `type=${encodeURIComponent(pinnedType)}&` : '';
        const facet = (name: string) => (
            pms(
                `/library/sections/${encodeURIComponent(section)}/${name}?${typeQs}X-Plex-Container-Size=${FILTER_FACET_CAP}`,
                server,
                8000,
            )
                .then((data) => mapFilterFacet(data, name))
                .catch(() => [] as Array<{ key: string; title: string }>)
        );
        const videoLibrary = pinnedType === '1' || pinnedType === '2';
        const [
            genres,
            decades,
            years,
            contentRatings,
            resolutions,
            studios,
            networks,
            countries,
            collections,
            audioLanguages,
            subtitleLanguages,
            actors,
            directors,
            writers,
            producers,
            labels,
            letters,
        ] = await Promise.all([
            facet('genre'),
            facet('decade'),
            facet('year'),
            facet('contentRating'),
            facet('resolution'),
            facet('studio'),
            pinnedType === '2' ? facet('network') : Promise.resolve([] as Array<{ key: string; title: string }>),
            facet('country'),
            facet('collection'),
            facet('audioLanguage'),
            facet('subtitleLanguage'),
            videoLibrary ? facet('actor') : Promise.resolve([] as Array<{ key: string; title: string }>),
            videoLibrary ? facet('director') : Promise.resolve([] as Array<{ key: string; title: string }>),
            videoLibrary ? facet('writer') : Promise.resolve([] as Array<{ key: string; title: string }>),
            videoLibrary ? facet('producer') : Promise.resolve([] as Array<{ key: string; title: string }>),
            videoLibrary ? facet('label') : Promise.resolve([] as Array<{ key: string; title: string }>),
            pms(
                `/library/sections/${encodeURIComponent(section)}/firstCharacter?${typeQs}X-Plex-Container-Size=50`,
                server,
                8000,
            ).then(mapFirstCharacters).catch(() => [] as Array<{ key: string; title: string }>),
        ]);
        return {
            genres,
            decades,
            years,
            contentRatings,
            resolutions,
            studios,
            networks,
            countries,
            collections,
            audioLanguages,
            subtitleLanguages,
            actors,
            directors,
            writers,
            producers,
            labels,
            letters,
        };
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
    const libraryStudios = path.match(/^\/api\/media-player\/libraries\/([^/]+)\/studios$/);
    if (libraryStudios) {
        const { server, section } = splitLibraryKey(libraryStudios[1]);
        return withMapServer(server, async () => {
            const sections = mapSections(await pms('/library/sections', server).catch(() => null));
            const sectionRow = sections.find((row) => row.key === section);
            const sectionType = String(sectionRow?.type || '');
            if (sectionType === 'artist') return { networks: [], studios: [] };
            const pinnedType = sectionAllType(sectionType);
            const typeQs = pinnedType ? `type=${encodeURIComponent(pinnedType)}&` : '';
            const facet = (name: string) => (
                pms(
                    `/library/sections/${encodeURIComponent(section)}/${name}?${typeQs}X-Plex-Container-Size=${FILTER_FACET_CAP}`,
                    server,
                    8000,
                )
                    .then((data) => mapFilterFacet(data, name))
                    .catch(() => [] as Array<{ key: string; title: string }>)
            );
            const [studioFacet, networkFacet] = await Promise.all([
                facet('studio'),
                facet('network'),
            ]);
            const studios = mapStudioBrowseOptions(studioFacet, STUDIO_BROWSE_FETCH);
            const networks = mapStudioBrowseOptions(networkFacet, STUDIO_BROWSE_FETCH);
            const sampleFor = (param: string) => async (card: { key: string }) => {
                const listed = await pms(
                    `/library/sections/${encodeURIComponent(section)}/all?${typeQs}${encodeURIComponent(param)}=${encodeURIComponent(card.key)}&sort=audienceRating:desc&X-Plex-Container-Start=0&X-Plex-Container-Size=1`,
                    server,
                    8000,
                ).catch(() => null);
                const meta = asList<PlexMeta>(containerOf(listed).Metadata)[0];
                if (!meta) return null;
                const item = mapItem(meta);
                return { art: item.art || null, thumb: item.thumb || null };
            };
            await Promise.all([
                fillStudioBrowseArt(networks, sampleFor('network'), STUDIO_BROWSE_ART_CONCURRENCY),
                fillStudioBrowseArt(studios, sampleFor('studio'), STUDIO_BROWSE_ART_CONCURRENCY),
            ]);
            return { networks, studios };
        });
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
            const random = isRandomOrderSource(row);
            const childQs = random ? 'sort=random&X-Plex-Container-Size=200' : 'X-Plex-Container-Size=200';
            let children = mapList({
                MediaContainer: {
                    Metadata: asList<PlexMeta>(row?.Children).concat(asList<PlexMeta>(row?.Metadata)),
                },
            }).filter((child) => child.ratingKey !== ratingKey && child.type !== 'collection');
            if (!children.length) {
                children = await pms(
                    `/library/collections/${encodeURIComponent(key)}/children?${childQs}`,
                    server,
                    15000,
                ).then(mapList).catch(() => []);
            }
            if (!children.length) {
                children = await pms(
                    `/library/metadata/${encodeURIComponent(key)}/children?${childQs}`,
                    server,
                    15000,
                ).then(mapList).catch(() => []);
            }
            if (random && children.length > 1) children = shuffleItems(children);
            return { item, children, extras: [], related: [], onDeck: null };
        });
    }
    const itemSubtitles = path.match(/^\/api\/media-player\/item\/([^/]+)\/subtitles$/);
    if (itemSubtitles && method === 'GET') {
        const key = decodeURIComponent(itemSubtitles[1]);
        const server = resolveServer(query.get('server'), key);
        return loadSubtitleSearch(key, server, query.get('language') || 'en');
    }
    const itemSubtitleDownload = path.match(/^\/api\/media-player\/item\/([^/]+)\/subtitles\/download$/);
    if (itemSubtitleDownload && method === 'POST') {
        const key = decodeURIComponent(itemSubtitleDownload[1]);
        const server = resolveServer(query.get('server') || body?.serverId, key);
        return downloadSubtitle(key, server, String(body?.key || ''));
    }
    const itemVoiceActivity = path.match(/^\/api\/media-player\/item\/([^/]+)\/voice-activity$/);
    if (itemVoiceActivity && method === 'GET') {
        const key = decodeURIComponent(itemVoiceActivity[1]);
        const server = resolveServer(query.get('server'), key);
        if (!server) return { available: false, speechMs: [] as number[] };
        try {
            const meta = await metadata(key, server);
            const blob = JSON.stringify(meta || {});
            const flagged = /hasVoiceActivity["']?\s*[:=]\s*(?:true|1)/i.test(blob)
                || /"VoiceActivity"/i.test(blob)
                || /voiceActivity/i.test(blob);
            const speechMs: number[] = [];
            // Marker / interval shapes some PMS builds expose on metadata.
            const markerBags = [
                asList<PlexMeta>((meta as any)?.Marker),
                asList<PlexMeta>((meta as any)?.VoiceActivity),
                asList<PlexMeta>(containerOf(meta as any).Marker),
            ];
            for (const bag of markerBags) {
                for (const row of bag) {
                    const type = String((row as any).type || (row as any).markerType || '').toLowerCase();
                    if (type && type !== 'voice' && type !== 'voiceactivity' && !type.includes('voice')) continue;
                    const start = Number((row as any).startTimeOffset ?? (row as any).start ?? (row as any).startTimeMs);
                    if (Number.isFinite(start) && start >= 0) speechMs.push(Math.floor(start));
                }
            }
            // Part index: /library/parts/{id}/indexes/voiceActivity (JSON intervals or bitmap).
            const media = asList<PlexMeta>((meta as any).Media)[0];
            const part = asList<PlexMeta>((media as any)?.Part)[0];
            const partId = String((part as any)?.id || '').replace(/\D/g, '');
            if (partId && server) {
                try {
                    const indexData = await pms(
                        `/library/parts/${encodeURIComponent(partId)}/indexes/voiceActivity`,
                        server,
                        6000,
                    );
                    const intervals = [
                        ...asList<PlexMeta>(containerOf(indexData).VoiceActivity),
                        ...asList<PlexMeta>((indexData as any)?.VoiceActivity),
                        ...asList<PlexMeta>(containerOf(indexData).Marker),
                    ];
                    for (const row of intervals) {
                        const start = Number((row as any).startTimeOffset ?? (row as any).start ?? (row as any).startTimeMs);
                        if (Number.isFinite(start) && start >= 0) speechMs.push(Math.floor(start));
                    }
                } catch {
                    /* index may be binary-only or missing */
                }
                if (!speechMs.length) {
                    try {
                        const url = new URL(
                            `/library/parts/${encodeURIComponent(partId)}/indexes/voiceActivity`,
                            server.uri.endsWith('/') ? server.uri : `${server.uri}/`,
                        );
                        url.searchParams.set('X-Plex-Token', server.accessToken);
                        const res = await fetch(url.toString(), {
                            headers: { Accept: '*/*', 'X-Plex-Token': server.accessToken },
                            cache: 'no-store',
                        });
                        if (res.ok) {
                            const buf = new Uint8Array(await res.arrayBuffer());
                            // Skip tiny XML/JSON error bodies.
                            if (buf.length > 64 && buf[0] !== 0x3c && buf[0] !== 0x7b) {
                                let prev = false;
                                for (let i = 0; i < buf.length && speechMs.length < 400; i++) {
                                    const active = buf[i] > 0;
                                    if (active && !prev) speechMs.push(i * 10);
                                    prev = active;
                                }
                            }
                        }
                    } catch {
                        /* ignore binary probe failures */
                    }
                }
            }
            const unique = Array.from(new Set(speechMs)).sort((a, b) => a - b).slice(0, 400);
            return { available: flagged || unique.length > 0, speechMs: unique };
        } catch {
            return { available: false, speechMs: [] as number[] };
        }
    }
    const itemMore = path.match(/^\/api\/media-player\/item\/([^/]+)\/more$/);
    if (itemMore && method === 'GET') {
        const key = decodeURIComponent(itemMore[1]);
        const server = resolveServer(query.get('server'), key);
        if (!server) return { extras: [], related: [], onDeck: null };
        return withMapServer(server, async () => {
            const extrasPromise = loadItemExtras(key, server);
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
            const extras = await extrasPromise.catch(() => [] as ReturnType<typeof mapItem>[]);
            let onDeck: ReturnType<typeof mapItem> | null = null;
            const core = await metadata(key, server).catch(() => null);
            const kind = core ? String(mapItem(core).type || '').toLowerCase() : '';
            if (kind === 'show' || kind === 'season') {
                onDeck = await resolvePlayableEpisode(key, server, kind);
            }
            if (core && (kind === 'show' || kind === 'movie')) {
                const section = String(core.librarySectionID || '').trim();
                const plexType = kind === 'show' ? '2' : '1';
                let genreFacet: Array<{ key: string; title: string }> | null = null;
                const genreHubs = await buildGenreRelatedHubs({
                    meta: core,
                    excludeRatingKey: key,
                    existingHubs: related,
                    many,
                    serverId: server.id,
                    sectionKey: section,
                    resolveGenreId: async (title: string) => {
                        if (!section) return '';
                        if (!genreFacet) {
                            const data = await pms(
                                `/library/sections/${encodeURIComponent(section)}/genre?type=${plexType}`,
                                server,
                                6000,
                            ).catch(() => null);
                            genreFacet = mapFilterFacet(data, 'genre');
                        }
                        const want = String(title || '').trim().toLowerCase();
                        return genreFacet.find((row) => row.title.toLowerCase() === want)?.key || '';
                    },
                    loadGenreItems: async (genreId: string) => {
                        if (!section || !genreId) return [];
                        const data = await pms(
                            `/library/sections/${encodeURIComponent(section)}/all?type=${plexType}`
                            + `&genre=${encodeURIComponent(genreId)}&sort=audienceRating:desc`
                            + '&X-Plex-Container-Start=0&X-Plex-Container-Size=16&includeGuids=1',
                            server,
                            8000,
                        ).catch(() => null);
                        return mapList(data);
                    },
                });
                related.push(...genreHubs);
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
            // Show art, the season's episodes, extras and "next up" don't depend on each other.
            // Run them together — one after another made opening a season wait 4–5 round trips.
            const showMetaPromise = showKey && (item.type === 'season' || item.type === 'episode')
                ? metadata(String(showKey), server).catch(() => null)
                : Promise.resolve(null);
            const childrenPromise = item.type === 'show' || item.type === 'artist'
                // Drop Plex’s synthetic “All episodes” season (leads nowhere in our UI).
                ? childrenOf(key, server, { excludeAllLeaves: true })
                : (item.type === 'season' || item.type === 'album'
                    ? childrenOf(key, server)
                    : (item.type === 'track' && item.parentRatingKey
                        ? childrenOf(String(item.parentRatingKey), server)
                        : Promise.resolve([] as ReturnType<typeof mapItem>[])));
            const extrasPromise = (item.type === 'movie' || item.type === 'show')
                ? loadItemExtras(key, server, meta)
                : Promise.resolve([] as ReturnType<typeof mapItem>[]);
            const onDeckPromise = item.type === 'show' || item.type === 'season'
                ? resolvePlayableEpisode(key, server, item.type)
                : Promise.resolve(null);
            const showMeta = await showMetaPromise;
            if (showMeta) {
                const showItem = mapItem(showMeta);
                if (!item.showTitle) item.showTitle = showItem.title || null;
                if (!item.logo && showItem.logo) item.logo = showItem.logo;
                if (!item.art && showItem.art) item.art = showItem.art;
                // Prefer the show network/studio for episode/season service logos.
                if (showItem.studio) item.studio = showItem.studio;
                if (Array.isArray(showItem.studioLabels) && showItem.studioLabels.length) {
                    item.studioLabels = showItem.studioLabels;
                }
                if (Array.isArray(showItem.networkLabels) && showItem.networkLabels.length) {
                    item.networkLabels = showItem.networkLabels;
                }
                if (!item.commonSenseMedia && showItem.commonSenseMedia) {
                    item.commonSenseMedia = showItem.commonSenseMedia;
                }
                if (ratingsEmpty && showItem.ratings) item.ratings = showItem.ratings;
                // Always prefer the series TMDB id — episode Guid ids break /tv/{id} lookups.
                if (showItem.tmdbId) {
                    item.showTmdbId = showItem.tmdbId;
                    item.tmdbId = showItem.tmdbId;
                    item.externalIds = {
                        imdb: item.externalIds?.imdb || showItem.externalIds?.imdb || null,
                        tmdb: showItem.tmdbId,
                        tvdb: item.externalIds?.tvdb || showItem.externalIds?.tvdb || null,
                    };
                } else if (!item.externalIds?.imdb && !item.externalIds?.tmdb && !item.externalIds?.tvdb) {
                    item.externalIds = showItem.externalIds;
                    item.tmdbId = showItem.tmdbId;
                }
            }
            const [children, extras, onDeck] = await Promise.all([
                childrenPromise,
                extrasPromise.catch(() => [] as ReturnType<typeof mapItem>[]),
                onDeckPromise,
            ]);
            return { item, children, extras, related: [], onDeck };
        });
    }
    const downloadSource = path.match(/^\/api\/media-player\/download-source\/([^/]+)$/);
    if (downloadSource && method === 'GET') {
        const key = decodeURIComponent(downloadSource[1]);
        const server = resolveServer(query.get('server'), key);
        return withMapServer(server, async () => {
            let meta = await metadata(key, server).catch(() => extraMetaByKey.get(key) || null);
            if (!meta) throw new Error('This title cannot be downloaded.');
            const seed = mapItem(meta);
            if (seed.type === 'show' || seed.type === 'season') {
                throw new Error('Download an episode, not the whole series.');
            }
            const mediaIndex = Math.max(0, Math.floor(Number(query.get('mediaIndex') || 0)));
            const medias = asList<PlexMeta>(meta.Media);
            const media = medias[mediaIndex] || medias[0] || {};
            const part = asList<PlexMeta>(media?.Part)[0] || null;
            if (!part?.key) throw new Error('No downloadable media file for this title.');
            const chosen = playSrc(meta, mediaIndex, 'original', '', '', 0, false, '');
            if (chosen.mode !== 'directPlay' || !chosen.src) {
                throw new Error('No downloadable media file for this title.');
            }
            const item = mapItem(meta);
            const rawFile = String(part.file || item.title || `plex-${key}`);
            const baseName = rawFile.split(/[/\\]/).pop() || `plex-${key}`;
            const container = String(part.container || media.container || '').replace(/[^\w]+/g, '') || 'bin';
            const fileName = /\.[a-z0-9]{2,5}$/i.test(baseName) ? baseName : `${baseName}.${container}`;
            const headers: Record<string, string> = {
                Accept: '*/*',
                'Accept-Encoding': 'identity',
                'X-Plex-Token': String(server?.accessToken || ''),
                'X-Plex-Client-Identifier': clientId(),
                'X-Plex-Product': 'StreamPilot',
                'X-Plex-Platform': 'Android',
                'X-Plex-Device': 'Android',
            };
            return {
                url: chosen.src,
                headers,
                fileName,
                bytes: Number(part.size || media.size || 0) || 0,
                ratingKey: String(item.ratingKey || key),
                title: item.title || 'Download',
                type: item.type || 'movie',
                thumb: item.thumb || null,
                serverId: String(server?.id || item.serverId || ''),
                plexGuid: item.plexGuid || null,
            };
        });
    }
    const play = path.match(/^\/api\/media-player\/play\/([^/]+)$/);
    if (play) {
        const key = decodeURIComponent(play[1]);
        const server = resolveServer(query.get('server'), key);
        return withMapServer(server, async () => {
            let meta = await metadata(key, server).catch(() => extraMetaByKey.get(key) || null);
            if (!meta) throw new Error('This title cannot be played.');
            const seed = mapItem(meta);
            if (seed.type === 'show' || seed.type === 'season') {
                const episode = await resolvePlayableEpisode(key, server, seed.type);
                if (episode?.ratingKey) {
                    meta = await metadata(String(episode.ratingKey), server);
                }
            } else if (seed.type === 'album' || seed.type === 'artist') {
                const first = (await allLeavesOf(key, server))[0];
                if (first?.ratingKey) {
                    meta = await metadata(String(first.ratingKey), server);
                }
            }
            const settings = readSettings();
            const mediaIndex = Number(query.get('mediaIndex') || 0);
            // Away (not on the server's network, or on mobile data) uses the Away quality.
            const away = !serverIsLocal(server) || onMobileData();
            const preferredQuality = away && settings.remoteQualityId
                ? settings.remoteQualityId
                : settings.defaultQualityId;
            const qualityId = String(query.get('qualityId') || preferredQuality || 'original');
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
            const offsetMs = clampPlayOffsetMs(
                offsetQuery != null ? Number(offsetQuery) || 0 : plexViewOffsetMs(meta) || 0,
                Number(meta.duration || 0),
            );
            const playKey = String(meta.ratingKey || key);
            const chosen = playSrc(
                meta,
                mediaIndex,
                qualityId === 'auto' ? 'original' : qualityId,
                audioStreamId,
                subtitleStreamId,
                offsetMs,
                query.get('delivery') === 'hls',
                String(query.get('sessionId') || '').trim(),
            );
            const item = mapItem(meta);
            if (item.ratingKey) rememberItem(item.ratingKey, server);
            return {
                sessionId: chosen.sessionId || `smp-${playKey}`,
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
                    // Position among in-file subs (sidecars carry a key) — matches ExoPlayer's text track order.
                    embeddedOrdinal: stream.key ? null : streams.subtitles.filter((row) => !row.key).indexOf(stream),
                })),
                subtitleStreamId: subtitleStreamId || null,
                mediaIndex,
                versions: item.versions,
                markers: item.markers,
                playbackMode: chosen.mode,
                previewThumbTemplate: imageUrl(`/library/metadata/${encodeURIComponent(playKey)}/thumb/__OFFSET__`, 480, 270) || null,
                client: 'android',
            };
        });
    }
    if (path === '/api/media-player/timeline' && method === 'POST') {
        const rawState = String(body?.state || '').trim().toLowerCase();
        const state = rawState === 'paused' || rawState === 'stopped' || rawState === 'buffering'
            ? rawState
            : 'playing';
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
                type: 'video',
                hasMDE: '1',
            });
            if (safeSession) params.set('X-Plex-Session-Identifier', safeSession);
            const audioId = String(body?.audioStreamId || '').replace(/\D/g, '');
            if (audioId) params.set('audioStreamID', audioId);
            params.set('subtitleStreamID', String(body?.subtitleStreamId || '').replace(/\D/g, '') || '0');
            const server = resolveServer(body?.serverId, key);
            if (server) {
                const identity = plexHeaders(server.accessToken);
                for (const [header, value] of Object.entries(identity)) {
                    if (header === 'Accept' || !value) continue;
                    if (!params.has(header)) params.set(header, value);
                }
            }
            await pms(
                `/: /timeline?${params}`.replace('/: /', '/:/'),
                server,
                8000,
                safeSession ? { 'X-Plex-Session-Identifier': safeSession } : undefined,
            ).catch(() => undefined);
        }
        return { ok: true };
    }
    const scrobble = path.match(/^\/api\/media-player\/(scrobble|unscrobble)\/([^/]+)$/);
    if (scrobble && method === 'POST') {
        const key = decodeURIComponent(scrobble[2]);
        await pms(`/:/${scrobble[1]}?identifier=com.plexapp.plugins.library&key=${encodeURIComponent(key)}`, resolveServer('', key));
        return { ok: true };
    }
    const ratePath = path.match(/^\/api\/media-player\/item\/([^/]+)\/rate$/);
    if (ratePath && method === 'POST') {
        const key = decodeURIComponent(ratePath[1]);
        const rating = Math.max(0, Math.min(10, Math.round(Number(body?.rating) || 0)));
        await pms(
            `/: /rate?identifier=com.plexapp.plugins.library&key=${encodeURIComponent(key)}&rating=${rating}`.replace('/: /', '/:/'),
            resolveServer(query.get('server') || body?.serverId, key),
        );
        return { ok: true, rating };
    }
    const progress = path.match(/^\/api\/media-player\/progress\/([^/]+)$/);
    if (progress && method === 'DELETE') {
        const key = decodeURIComponent(progress[1]);
        await pms(`/: /timeline?ratingKey=${encodeURIComponent(key)}&key=${encodeURIComponent(`/library/metadata/${key}`)}&state=stopped&time=0&duration=0`.replace('/: /', '/:/'), resolveServer('', key)).catch(() => undefined);
        return { ok: true };
    }
    const refreshMeta = path.match(/^\/api\/media-player\/item\/([^/]+)\/refresh$/);
    if (refreshMeta && (method === 'POST' || method === 'PUT')) {
        const key = decodeURIComponent(refreshMeta[1]).replace(/^\d+::/, '').replace(/\D/g, '');
        if (!key) throw new Error('Invalid title.');
        const server = resolveServer(query.get('server') || body?.serverId, key);
        if (!server) throw new Error('No Plex server selected');
        const url = new URL(
            `/library/metadata/${encodeURIComponent(key)}/refresh`,
            server.uri.endsWith('/') ? server.uri : `${server.uri}/`,
        );
        url.searchParams.set('X-Plex-Token', server.accessToken);
        await plexFetch(url.toString(), server.accessToken, { method: 'PUT' });
        clearPlayerGetCache();
        return { ok: true };
    }
    const nextEpisode = async (meta: PlexMeta, server: PlexServer | null) => {
        const kind = normalizeItemType(meta);
        if ((kind !== 'episode' && kind !== 'track') || !meta.parentRatingKey) return { previous: null, next: null };
        const siblings = await childrenOf(String(meta.parentRatingKey), server);
        const index = siblings.findIndex((row) => row.ratingKey === String(meta.ratingKey));
        let nextItem = index >= 0 ? siblings[index + 1] || null : null;
        const previous = index > 0 ? siblings[index - 1] : null;
        if (!nextItem && meta.grandparentRatingKey) {
            const seasons = (await childrenOf(String(meta.grandparentRatingKey), server, { excludeAllLeaves: true }))
                .filter((row) => row.type === 'season');
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
        const kind = normalizeItemType(meta);
        if (kind !== 'episode' && kind !== 'track') return { previous: null, next: null };
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
    if (path === '/api/media-player/watch-together/resolve' && method === 'GET') {
        return resolveWatchTogetherLocal(query);
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

const wikiText = (html: string) => {
    let text = String(html || '');
    // End tags allow optional attributes/whitespace: </script\t\n foo>
    for (let i = 0; i < 5; i += 1) {
        const next = text
            .replace(/<script\b[^>]*>[\s\S]*?<\/script\b[^>]*>/gi, ' ')
            .replace(/<style\b[^>]*>[\s\S]*?<\/style\b[^>]*>/gi, ' ')
            .replace(/<\/?[a-zA-Z][^>]*>/g, ' ');
        if (next === text) break;
        text = next;
    }
    return text
        .replace(/[<>]/g, ' ')
        .replace(/&quot;/g, '"')
        .replace(/&#0?39;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, ' ')
        .replace(/&gt;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/\s+/g, ' ')
        .trim();
};

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
            (path === '/api/media-player/home' && parsed.searchParams.get('full') !== '1')
            || path === '/api/media-player/home-hero'
            || path === '/api/media-player/libraries'
        );
        const cacheKey = cacheable ? `${path}?${parsed.searchParams.toString()}` : '';
        if (cacheKey) {
            const hit = readPlayerGetCache(cacheKey);
            if (hit !== undefined) return hit;
        }
        const result = await handlePlayer(path, method, parsed.searchParams, body);
        const skipHomeCache = path === '/api/media-player/home'
            && parsed.searchParams.get('full') === '1'
            && !(Array.isArray((result as { hubs?: Array<{ identifier?: string; title?: string; items?: unknown[] }> })?.hubs)
                && (result as { hubs: Array<{ identifier?: string; title?: string; items?: unknown[] }> }).hubs.some(contentHomeHub));
        if (cacheKey && !skipHomeCache) writePlayerGetCache(cacheKey, result);
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
    // IMDB → TMDB id (libraries that only store imdb:// Guids).
    const discoveryFind = path.match(/^\/api\/discovery\/proxy\/find\/([^/]+)$/);
    if (discoveryFind && method === 'GET') {
        const externalId = decodeURIComponent(discoveryFind[1] || '').trim();
        const empty = { movie_results: [], tv_results: [], person_results: [] };
        if (!externalId) return empty;
        const source = String(parsed.searchParams.get('external_source') || 'imdb_id').trim() || 'imdb_id';
        const portal = String(readStoredPortalBaseUrl() || '').replace(/\/+$/, '');
        const token = String(getSessionToken() || '').trim();
        if (portal) {
            const headers: Record<string, string> = {
                Accept: 'application/json',
                'X-Requested-With': 'ServerManagerPortal',
            };
            if (token) headers.Authorization = `Bearer ${token}`;
            const portalRes = await fetch(
                `${portal}/api/discovery/proxy/find/${encodeURIComponent(externalId)}?external_source=${encodeURIComponent(source)}`,
                { headers, cache: 'no-store' },
            ).catch(() => null);
            if (portalRes?.ok) {
                const payload = await portalRes.json().catch(() => null);
                if (payload && typeof payload === 'object') return payload;
            }
        }
        const key = readTmdbApiKey();
        if (!key) return empty;
        const res = await fetch(
            `https://api.themoviedb.org/3/find/${encodeURIComponent(externalId)}`
            + `?api_key=${encodeURIComponent(key)}&external_source=${encodeURIComponent(source)}`,
        ).catch(() => null);
        if (!res?.ok) return empty;
        const json = await res.json().catch(() => null);
        return json && typeof json === 'object' ? json : empty;
    }
    // Movie/TV details for service logos (streaming / studio / network).
    const discoveryDetail = path.match(/^\/api\/discovery\/proxy\/(movie|tv)\/(\d+)$/);
    if (discoveryDetail && method === 'GET') {
        const mediaType = discoveryDetail[1] as 'movie' | 'tv';
        const tmdbId = discoveryDetail[2];
        const empty = { networks: [], productionCompanies: [], watchProviders: [] };
        // Prefer the user's StreamPilot portal when configured (even in plex-direct auth).
        const portal = String(readStoredPortalBaseUrl() || '').replace(/\/+$/, '');
        const token = String(getSessionToken() || '').trim();
        if (portal) {
            // Public endpoint needs no JWT — works for plex-direct + portal URL setups.
            const publicRes = await fetch(
                `${portal}/api/public/media-player/service-logos?mediaType=${encodeURIComponent(mediaType)}&tmdbId=${encodeURIComponent(tmdbId)}`,
                { headers: { Accept: 'application/json' }, cache: 'no-store' },
            ).catch(() => null);
            if (publicRes?.ok) {
                const payload = await publicRes.json().catch(() => null);
                if (payload && typeof payload === 'object' && payload.reason !== 'missing-tmdb-key') {
                    return payload;
                }
            }
            const headers: Record<string, string> = {
                Accept: 'application/json',
                'X-Requested-With': 'ServerManagerPortal',
            };
            if (token) headers.Authorization = `Bearer ${token}`;
            const portalRes = await fetch(
                `${portal}/api/discovery/proxy/${mediaType}/${encodeURIComponent(tmdbId)}`,
                { headers, cache: 'no-store' },
            ).catch(() => null);
            if (portalRes?.ok) {
                const payload = await portalRes.json().catch(() => null);
                if (payload && typeof payload === 'object') return payload;
            }
        }
        const key = readTmdbApiKey();
        if (!key) return empty;
        const res = await fetch(
            `https://api.themoviedb.org/3/${mediaType}/${encodeURIComponent(tmdbId)}?api_key=${encodeURIComponent(key)}&append_to_response=${encodeURIComponent('watch/providers')}`,
        ).catch(() => null);
        if (!res?.ok) return empty;
        const json = await res.json().catch(() => null);
        const providerResults = json?.['watch/providers']?.results || {};
        const watchProviders = Object.entries(providerResults).map(([iso, provider]: [string, any]) => ({
            iso_3166_1: iso,
            link: provider?.link,
            buy: [].concat(provider?.buy || []).map((row: any) => ({
                id: row?.provider_id,
                name: row?.provider_name,
                logoPath: row?.logo_path,
            })),
            flatrate: [].concat(provider?.flatrate || []).map((row: any) => ({
                id: row?.provider_id,
                name: row?.provider_name,
                logoPath: row?.logo_path,
            })),
            ads: [].concat(provider?.ads || []).map((row: any) => ({
                id: row?.provider_id,
                name: row?.provider_name,
                logoPath: row?.logo_path,
            })),
        }));
        // Keep name-only rows — client fills catalog logos when TMDB omits logo_path (common for UK nets).
        const networks = mediaType === 'tv'
            ? [].concat(json?.networks || []).map((row: any) => ({
                id: row?.id,
                name: row?.name,
                logoPath: row?.logo_path || '',
            })).filter((row: { name?: string }) => row.name)
            : [];
        const productionCompanies = [].concat(json?.production_companies || []).map((row: any) => ({
            id: row?.id,
            name: row?.name,
            logoPath: row?.logo_path || '',
        })).filter((row: { name?: string }) => row.name);
        return { networks, productionCompanies, watchProviders };
    }
    if (path.startsWith('/api/discovery/')) return method === 'GET' ? { results: [] } : { ok: true };
    if (path.startsWith('/api/notifications')) return { notifications: [] };
    return method === 'GET' ? {} : { ok: true };
};
