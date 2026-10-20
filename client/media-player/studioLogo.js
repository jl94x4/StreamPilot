/**
 * Match Plex studio/network labels to Discover / TMDB streaming-network logos
 * (Netflix, Disney+, Apple TV+, HBO, …). Catalog lists are passed in so this
 * stays plain JS for node:test.
 */

const STREAMING_ALIASES = {
    // Global streamers
    netflix: 'netflix',
    'netflix original': 'netflix',
    'netflix originals': 'netflix',
    'netflix studios': 'netflix',
    disney: 'disney',
    'disney plus': 'disney',
    disneyplus: 'disney',
    'disney+': 'disney',
    'disney channel': 'disney channel',
    apple: 'apple tv',
    appletv: 'apple tv',
    'apple tv': 'apple tv',
    'apple tv plus': 'apple tv',
    'apple tv+': 'apple tv',
    prime: 'prime video',
    'prime video': 'prime video',
    amazon: 'prime video',
    'amazon prime': 'prime video',
    'amazon prime video': 'prime video',
    'amazon video': 'prime video',
    'amazon studios': 'prime video',
    'amazon studio': 'prime video',
    'amazon mgm': 'prime video',
    'amazon mgm studios': 'prime video',
    'amazon original': 'prime video',
    'amazon originals': 'prime video',
    'mgm amazon': 'prime video',
    'mgm amazon studios': 'prime video',
    'metro goldwyn mayer amazon': 'prime video',
    hulu: 'hulu',
    hbo: 'hbo',
    'hbo max': 'max',
    max: 'max',
    peacock: 'peacock',
    'peacock premium': 'peacock',
    'peacock tv': 'peacock',
    discovery: 'discovery',
    'discovery plus': 'discovery',
    discoveryplus: 'discovery',
    'discovery+': 'discovery',
    showtime: 'showtime',
    starz: 'starz',
    amc: 'amc',
    amcplus: 'amc',
    'amc plus': 'amc',
    // Paramount — network/streamer brand (studio Paramount Pictures uses STUDIO_ALIASES)
    'paramount plus': 'paramount',
    paramountplus: 'paramount',
    'paramount+': 'paramount',
    paramount: 'paramount',
    // US broadcast
    nbc: 'nbc',
    cbs: 'cbs',
    abc: 'abc',
    fox: 'fox',
    'the cw': 'the cw',
    cw: 'the cw',
    // Kids / cable
    'cartoon network': 'cartoon network',
    cartoonnetwork: 'cartoon network',
    cn: 'cartoon network',
    nickelodeon: 'nickelodeon',
    nick: 'nickelodeon',
    'adult swim': 'adult swim',
    // UK BBC family → one BBC mark
    bbc: 'bbc',
    'bbc one': 'bbc',
    bbcone: 'bbc',
    'bbc 1': 'bbc',
    'bbc two': 'bbc',
    bbctwo: 'bbc',
    'bbc 2': 'bbc',
    'bbc three': 'bbc',
    bbcthree: 'bbc',
    'bbc 3': 'bbc',
    'bbc iplayer': 'bbc',
    bbciplayer: 'bbc',
    cbbc: 'bbc',
    cbeebies: 'cbeebies',
    // Channel 4 family
    'channel 4': 'channel 4',
    channel4: 'channel 4',
    c4: 'channel 4',
    'channel 4 television': 'channel 4',
    'channel 4 television corporation': 'channel 4',
    'channel four': 'channel 4',
    'channel four television': 'channel 4',
    'channel four television corporation': 'channel 4',
    'channel 4 hd': 'channel 4',
    'all 4': 'channel 4',
    all4: 'channel 4',
    '4od': 'channel 4',
    film4: 'channel 4',
    'film 4': 'channel 4',
    e4: 'channel 4',
    more4: 'channel 4',
    'more 4': 'channel 4',
    '4seven': 'channel 4',
    '4 seven': 'channel 4',
    // Channel 5 (TMDB name is often just "5")
    'channel 5': 'channel 5',
    channel5: 'channel 5',
    'channel five': 'channel 5',
    '5star': 'channel 5',
    '5 usa': 'channel 5',
    my5: 'channel 5',
    'my 5': 'channel 5',
    // ITV / ITVX
    itv: 'itvx',
    itv1: 'itvx',
    itv2: 'itvx',
    itv3: 'itvx',
    itv4: 'itvx',
    itvx: 'itvx',
    'itv x': 'itvx',
    'itv hub': 'itvx',
    stv: 'itvx',
    utv: 'itvx',
    // Sky family
    sky: 'sky',
    'sky 1': 'sky',
    sky1: 'sky',
    'sky one': 'sky',
    'sky max': 'sky',
    skymax: 'sky',
    'sky atlantic': 'sky atlantic',
    'sky original': 'sky originals',
    'sky originals': 'sky originals',
    'sky original series': 'sky originals',
    'sky comedy': 'sky',
    'sky cinema': 'sky',
    'sky kids': 'sky',
};

const STUDIO_SUFFIX_RE = /\b(pictures|picture|entertainment|studios?|animation|films?|productions?|motion pictures|group|company|corp(?:oration)?|llc|ltd|inc|media|television|tv|originals?|releasing|distribution|international|home entertainment|filmverleih)\b/gi;

const STUDIO_ALIASES = {
    'warner bros': 'warner bros pictures',
    'warner brothers': 'warner bros pictures',
    'warner bros pictures': 'warner bros pictures',
    'warnerbros': 'warner bros pictures',
    '20th century fox': '20th century studios',
    'twentieth century fox': '20th century studios',
    'twentieth century studios': '20th century studios',
    'dreamworks animation': 'dreamworks',
    'dreamworks pictures': 'dreamworks',
    'dream works': 'dreamworks',
    'universal pictures': 'universal',
    'universal studios': 'universal',
    'paramount pictures': 'paramount',
    'paramount players': 'paramount',
    'sony pictures entertainment': 'sony pictures',
    'sony pictures animation': 'sony pictures',
    'columbia pictures': 'columbia pictures',
    'marvel entertainment': 'marvel studios',
    'marvel': 'marvel studios',
    'lucasfilm': 'disney',
    'walt disney pictures': 'disney',
    'walt disney': 'disney',
    'walt disney studios': 'disney',
    'disney pixar': 'pixar',
    'marvel studios': 'marvel studios',
    'marvel entertainment': 'marvel studios',
    'columbia': 'columbia pictures',
    'sony pictures entertainment': 'sony pictures',
    'warner bros television': 'warner bros pictures',
    'new line cinema': 'new line cinema',
    'twentieth century fox': '20th century studios',
    'metro goldwyn mayer': 'mgm',
    'metro goldwyn mayer studios': 'mgm',
    'new line': 'new line cinema',
    'lions gate': 'lionsgate',
    'lionsgate films': 'lionsgate',
    'working title': 'universal',
    'focus features': 'focus features',
    'searchlight': 'searchlight pictures',
    'fox searchlight': 'searchlight pictures',
    'touchstone': 'disney',
    'touchstone pictures': 'disney',
    'hollywood pictures': 'disney',
    'lucasfilm ltd': 'disney',
    'marvel studios': 'marvel studios',
    'warner bros television': 'warner bros pictures',
    'warner bros television distribution': 'warner bros pictures',
    'wb': 'warner bros pictures',
    'united artists': 'united artists',
    'metro goldwyn mayer pictures': 'mgm',
    'mgm studios': 'mgm',
    'colombia pictures': 'columbia pictures',
    'sony': 'sony pictures',
    'village roadshow': 'village roadshow pictures',
    'village roadshow pictures': 'village roadshow pictures',
    'castle rock': 'castle rock entertainment',
    'dimension films': 'dimension films',
    'orion pictures': 'orion pictures',
    'blue sky': 'blue sky studios',
    'illumination entertainment': 'illumination',
    'legendary': 'legendary pictures',
    'skydance': 'paramount',
};

const normalizeCompanyName = (value = '') => String(value || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[.+_\-–—]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Drop legal/brand suffixes so "Universal Pictures" ≈ "Universal". */
const coreCompanyName = (value = '') => normalizeCompanyName(value)
    .replace(STUDIO_SUFFIX_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const compactCompanyName = (value = '') => normalizeCompanyName(value).replace(/\s+/g, '');

const aliasKey = (value = '') => {
    const normalized = normalizeCompanyName(value);
    const compact = compactCompanyName(value);
    const core = coreCompanyName(value);
    return STREAMING_ALIASES[normalized]
        || STREAMING_ALIASES[compact]
        || STREAMING_ALIASES[core]
        || STUDIO_ALIASES[normalized]
        || STUDIO_ALIASES[compact]
        || STUDIO_ALIASES[core]
        || normalized;
};

/** Public alias id for studio/network plate colors and browse dedupe. */
export const companyAliasKey = (value = '') => aliasKey(value);

/**
 * SVOD / streamer-only — used to promote Prime/Netflix exclusives for movies.
 * Linear broadcasters (Channel 4, BBC, ITV, …) must stay false so TV billboards
 * keep them in Network and never lose to a Netflix watch-provider badge.
 */
const SVOD_ALIAS_KEYS = new Set([
    'netflix',
    'prime video',
    'disney', // only when “Disney+” forms match via aliases below
    'apple tv',
    'hulu',
    'max',
    'peacock',
    'discovery',
    'paramount', // only Paramount+
]);

export const isStreamingBrandLabel = (name = '') => {
    const normalized = normalizeCompanyName(name);
    const compact = compactCompanyName(name);
    const core = coreCompanyName(name);
    const key = STREAMING_ALIASES[normalized]
        || STREAMING_ALIASES[compact]
        || STREAMING_ALIASES[core]
        || '';
    if (!key || !SVOD_ALIAS_KEYS.has(key)) {
        return core === 'amazon' || core === 'netflix' || core === 'hulu' || core === 'peacock';
    }
    // Bare theatrical names must not count as streamers.
    if (key === 'paramount' && !/paramount\s*\+|paramount\s*plus|paramountplus/.test(normalized) && !compact.includes('plus')) {
        return false;
    }
    if (key === 'disney' && !normalized.includes('plus') && !compact.includes('plus')) {
        return false;
    }
    if (key === 'discovery' && !normalized.includes('plus') && !compact.includes('plus') && normalized !== 'discovery') {
        // "Discovery Channel" etc. — only discovery+
        return normalized.includes('discovery plus') || compact === 'discoveryplus' || normalized === 'discovery+';
    }
    return true;
};

const catalogAliasKey = (name = '') => {
    const normalized = normalizeCompanyName(name);
    const compact = compactCompanyName(name);
    const core = coreCompanyName(name);
    // Map catalog labels onto the same alias space ("Apple TV+" → "apple tv", "ITVX" → "itvx").
    return STREAMING_ALIASES[normalized]
        || STREAMING_ALIASES[compact]
        || STREAMING_ALIASES[normalized.replace(/ plus$/, '')]
        || STREAMING_ALIASES[normalized.replace(/\+$/, '')]
        || STUDIO_ALIASES[normalized]
        || STUDIO_ALIASES[compact]
        || STUDIO_ALIASES[core]
        || normalized;
};

/** Match a Plex studio/network label to a Discover company logo entry. */
export const matchDiscoverCompanyByName = (name, list = []) => {
    const want = normalizeCompanyName(name);
    if (!want) return null;
    const wantAlias = aliasKey(name);
    const wantCompact = compactCompanyName(name);
    const wantCore = coreCompanyName(name);

    const rows = Array.isArray(list) ? list : [];
    const exact = rows.find((row) => {
        const known = normalizeCompanyName(row?.name);
        const knownCore = coreCompanyName(row?.name);
        return known === want
            || compactCompanyName(row?.name) === wantCompact
            || catalogAliasKey(row?.name) === wantAlias
            || (wantCore && knownCore && wantCore === knownCore && wantCore.length >= 3);
    });
    if (exact) return exact;

    const ranked = [...rows].sort(
        (a, b) => normalizeCompanyName(b?.name).length - normalizeCompanyName(a?.name).length,
    );
    for (const row of ranked) {
        const known = normalizeCompanyName(row?.name);
        const knownCompact = compactCompanyName(row?.name);
        const knownCore = coreCompanyName(row?.name);
        if (known.length < 2) continue;
        if (want.startsWith(`${known} `) || known.startsWith(`${want} `)) return row;
        if (wantCore && knownCore && wantCore.length >= 4 && knownCore.length >= 4) {
            if (wantCore === knownCore
                || wantCore.startsWith(`${knownCore} `)
                || knownCore.startsWith(`${wantCore} `)) {
                return row;
            }
        }
        if (wantCompact && knownCompact && (
            wantCompact === knownCompact
            || (knownCompact.length >= 5 && wantCompact.includes(knownCompact))
            || (wantCompact.length >= 5 && knownCompact.includes(wantCompact))
        )) return row;
        // Avoid tiny aliases ("dc") matching inside unrelated names.
        if (known.length >= 4 && (want.includes(known) || known.includes(want))) return row;
    }
    return null;
};

/**
 * Prefer streaming networks (Netflix, Disney+, Apple TV+, …) over movie studios,
 * even for movies — Netflix originals are networks, not traditional studios.
 */
export const resolvePlayerStudioLogo = (name, _mediaType, { networks = [], studios = [] } = {}) => (
    matchDiscoverCompanyByName(name, networks) || matchDiscoverCompanyByName(name, studios)
);

export const pickLogoPathFromTmdbCompanies = (name, companies = []) => {
    const want = normalizeCompanyName(name);
    if (!want) return '';
    const wantAlias = aliasKey(name);
    const wantCompact = compactCompanyName(name);
    const ranked = (Array.isArray(companies) ? companies : []).filter((row) => row?.logoPath && row?.name);
    const exact = ranked.find((row) => {
        const known = normalizeCompanyName(row.name);
        return known === want
            || compactCompanyName(row.name) === wantCompact
            || catalogAliasKey(row.name) === wantAlias;
    });
    if (exact?.logoPath) return String(exact.logoPath);
    const partial = ranked
        .sort((a, b) => normalizeCompanyName(b.name).length - normalizeCompanyName(a.name).length)
        .find((row) => {
            const known = normalizeCompanyName(row.name);
            const knownCompact = compactCompanyName(row.name);
            if (catalogAliasKey(row.name) === wantAlias) return true;
            if (knownCompact.length >= 5 && (wantCompact.includes(knownCompact) || knownCompact.includes(wantCompact))) {
                return true;
            }
            if (known.length < 4) return false;
            return want.includes(known) || known.includes(want);
        });
    return partial?.logoPath ? String(partial.logoPath) : '';
};

/**
 * Build clickable streaming-network logo rows from Plex + TMDB networks.
 * Prefers Netflix / Disney+ / Apple TV+ style networks over generic studios.
 */
export const buildStreamingNetworkLogos = ({
    plexName = '',
    mediaType = '',
    networks = [],
    studios = [],
    tmdbNetworks = [],
} = {}) => {
    const out = [];
    const seen = new Set();
    const add = (name, logoPath, key) => {
        const label = String(name || '').trim();
        if (!label) return;
        const id = String(key || catalogAliasKey(label) || label).toLowerCase();
        if (seen.has(id)) return;
        seen.add(id);
        out.push({
            name: label,
            logoPath: logoPath ? String(logoPath) : '',
            key: String(key || label),
        });
    };

    for (const row of Array.isArray(tmdbNetworks) ? tmdbNetworks : []) {
        const name = String(row?.name || '').trim();
        if (!name) continue;
        const catalog = resolvePlayerStudioLogo(name, mediaType, { networks, studios });
        add(name, row.logoPath || catalog?.logoPath || '', row.id || catalog?.id || name);
    }

    const plex = String(plexName || '').trim();
    if (plex) {
        const catalog = resolvePlayerStudioLogo(plex, mediaType, { networks, studios });
        add(plex, catalog?.logoPath || '', catalog?.id || plex);
    }

    return out;
};

/** TMDB flatrate providers for a region (Netflix, Disney+, Apple TV+, …). */
export const pickWatchProvidersForRegion = (watchProviders = [], region = 'US') => {
    const want = String(region || 'US').trim().toUpperCase() || 'US';
    const rows = Array.isArray(watchProviders) ? watchProviders : [];
    const hit = rows.find((row) => String(row?.iso_3166_1 || '').toUpperCase() === want)
        || rows.find((row) => String(row?.iso_3166_1 || '').toUpperCase() === 'US')
        || rows[0]
        || null;
    const providers = [].concat(hit?.flatrate || [], hit?.ads || []);
    const out = [];
    const seen = new Set();
    for (const row of providers) {
        const name = String(row?.name || '').trim();
        const logoPath = String(row?.logoPath || '').trim();
        const id = String(row?.id || name).trim();
        if (!name || !logoPath) continue;
        // Collapse Peacock / Peacock Premium / etc. into one brand.
        const key = aliasKey(name) || id.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ name, logoPath, key: id });
    }
    return out;
};

/**
 * Resolve a TMDB company/network row to a drawable logo.
 * Prefer bundled catalog art (proper Marvel plate, etc.); else TMDB logo_path.
 */
const resolveTmdbCompanyLogo = (row = {}, { networks = [], studios = [], preferNetworks = false } = {}) => {
    const name = String(row?.name || '').trim();
    if (!name) return null;
    const tmdbPath = String(row?.logoPath || row?.logo_path || '').trim();
    const id = Number(row?.id || 0);
    const byId = (list) => (Array.isArray(list) ? list : []).find((entry) => Number(entry?.id) === id);
    const catalog = (preferNetworks
        ? (byId(networks) || matchDiscoverCompanyByName(name, networks)
            || byId(studios) || matchDiscoverCompanyByName(name, studios))
        : (byId(studios) || matchDiscoverCompanyByName(name, studios)
            || byId(networks) || matchDiscoverCompanyByName(name, networks)))
        || null;
    const logoPath = String(catalog?.logoPath || tmdbPath || '').trim();
    if (!logoPath) return null;
    return {
        name: String(catalog?.name || name),
        logoPath,
        key: String(catalog?.id || id || name),
    };
};

/**
 * Split into Studio / Network / Streaming for stacked overview rows.
 * Movies: TMDB production companies first (studio on the TMDB page → proper logo).
 * TV: Plex Network tags first (Advanced Filters), then TMDB networks.
 * Never let watch-provider / Label SVOD badges beat a broadcast Network tag.
 */
export const splitOverviewServiceLogos = ({
    plexName = '',
    plexNames = [],
    mediaType = '',
    networks = [],
    studios = [],
    tmdbNetworks = [],
    tmdbCompanies = [],
    streamingProviders = [],
} = {}) => {
    const streaming = [];
    const network = [];
    const studio = [];
    const seen = new Set();
    const isTv = mediaType !== 'movie';

    const claim = (name, logoPath, key) => {
        const label = String(name || '').trim();
        const path = logoPath ? String(logoPath).trim() : '';
        if (!label || !path) return null;
        const id = aliasKey(label) || String(key || label).toLowerCase();
        if (seen.has(id)) return null;
        seen.add(id);
        return {
            name: label,
            logoPath: path,
            key: String(key || label),
        };
    };

    const claimRow = (row) => {
        if (!row) return null;
        return claim(row.name, row.logoPath, row.key);
    };

    const plexLabels = [];
    const pushPlex = (value) => {
        const next = String(value || '').trim();
        if (!next || plexLabels.some((row) => row.toLowerCase() === next.toLowerCase())) return;
        plexLabels.push(next);
    };
    pushPlex(plexName);
    (Array.isArray(plexNames) ? plexNames : []).forEach(pushPlex);

    const pushPlexLabels = () => {
        for (const plex of plexLabels) {
            const asNetwork = matchDiscoverCompanyByName(plex, networks)
                || (isStreamingBrandLabel(plex)
                    ? resolvePlayerStudioLogo(plex, mediaType, { networks, studios })
                    : null);
            const asStudio = matchDiscoverCompanyByName(plex, studios);
            if (asNetwork) {
                const next = claim(asNetwork.name, asNetwork.logoPath, asNetwork.id);
                if (next) {
                    if (isTv) network.push(next);
                    else studio.push(next);
                }
                continue;
            }
            if (asStudio) {
                const next = claim(asStudio.name, asStudio.logoPath, asStudio.id);
                if (next) studio.push(next);
                continue;
            }
            const catalog = resolvePlayerStudioLogo(plex, mediaType, { networks, studios });
            const next = claim(catalog?.name || plex, catalog?.logoPath || '', catalog?.id || plex);
            if (next) {
                if (isTv) network.push(next);
                else studio.push(next);
            }
        }
    };

    const pushTmdbCompanies = ({ allowStreamerToNetwork = false, plexHasBroadcast = false } = {}) => {
        for (const row of Array.isArray(tmdbCompanies) ? tmdbCompanies : []) {
            const name = String(row?.name || '').trim();
            if (!name) continue;
            const asStreamer = isStreamingBrandLabel(name)
                ? (matchDiscoverCompanyByName(name, networks) || resolvePlayerStudioLogo(name, mediaType, { networks, studios }))
                : null;
            if (asStreamer?.logoPath) {
                if (isTv && plexHasBroadcast) continue;
                const next = claim(asStreamer.name, asStreamer.logoPath, asStreamer.id || name);
                if (next) {
                    if (allowStreamerToNetwork && isTv) network.push(next);
                    else studio.push(next);
                }
                continue;
            }
            const resolved = resolveTmdbCompanyLogo(row, { networks, studios, preferNetworks: false });
            const next = claimRow(resolved);
            if (next) studio.push(next);
        }
    };

    const pushTmdbNetworks = (plexHasBroadcast = false) => {
        for (const row of Array.isArray(tmdbNetworks) ? tmdbNetworks : []) {
            const name = String(row?.name || '').trim();
            if (!name) continue;
            if (plexHasBroadcast && isStreamingBrandLabel(name)) continue;
            const resolved = resolveTmdbCompanyLogo(row, { networks, studios, preferNetworks: true });
            const next = claimRow(resolved);
            if (next) network.push(next);
        }
    };

    // Movies: TMDB production companies first (the studios listed on the TMDB page).
    if (!isTv) {
        pushTmdbCompanies();
        pushPlexLabels();
    } else {
        // TV: Plex Network facet first, then TMDB networks / streamer companies.
        pushPlexLabels();
    }

    const plexHasBroadcastNetwork = isTv && network.some((row) => !isStreamingBrandLabel(row?.name));

    // Watch providers → Streaming row only (never TV billboard).
    for (const row of Array.isArray(streamingProviders) ? streamingProviders : []) {
        const catalog = resolvePlayerStudioLogo(row?.name, mediaType, { networks, studios });
        const next = claim(
            catalog?.name || row?.name,
            catalog?.logoPath || row?.logoPath || '',
            catalog?.name || row?.key || row?.name,
        );
        if (next) streaming.push({ ...next, wordmark: Boolean(catalog?.logoPath) });
    }

    if (isTv) {
        pushTmdbNetworks(plexHasBroadcastNetwork);
        pushTmdbCompanies({ allowStreamerToNetwork: true, plexHasBroadcast: plexHasBroadcastNetwork });
    }

    // Prefer recognizable Discover catalog studios over obscure financing companies.
    const studioCatalogIds = new Set(
        (Array.isArray(studios) ? studios : [])
            .map((row) => catalogAliasKey(row?.name))
            .filter(Boolean),
    );
    studio.sort((a, b) => {
        const aHit = studioCatalogIds.has(aliasKey(a?.name)) ? 0 : 1;
        const bHit = studioCatalogIds.has(aliasKey(b?.name)) ? 0 : 1;
        return aHit - bHit;
    });

    // TV: broadcasters before SVOD when both somehow remain.
    if (isTv && network.length > 1) {
        network.sort((a, b) => {
            const aSv = isStreamingBrandLabel(a?.name) ? 1 : 0;
            const bSv = isStreamingBrandLabel(b?.name) ? 1 : 0;
            return aSv - bSv;
        });
    }

    return { studio, network, streaming };
};

/**
 * Sync catalog brand mark from Plex tags — no TMDB wait.
 * Movies → studio catalog; TV → Network tags, then studio/network soft-fill.
 */
export const resolvePlayerBrandLogo = (item = {}, { networks = [], studios = [] } = {}) => {
    const type = String(item?.type || '').toLowerCase();
    const isMovie = type === 'movie';
    const networkLabels = Array.isArray(item?.networkLabels)
        ? item.networkLabels.map((row) => String(row || '').trim()).filter(Boolean)
        : [];
    const studioLabels = Array.isArray(item?.studioLabels)
        ? item.studioLabels.map((row) => String(row || '').trim()).filter(Boolean)
        : [];
    const studio = String(item?.studio || '').trim();

    const toRow = (hit) => {
        const logoPath = String(hit?.logoPath || '').trim();
        const name = String(hit?.name || '').trim();
        if (!logoPath || !name) return null;
        return {
            name,
            logoPath,
            key: String(hit.id || name),
        };
    };

    if (isMovie) {
        for (const name of [studio, ...studioLabels]) {
            if (!name) continue;
            const hit = matchDiscoverCompanyByName(name, studios)
                || matchDiscoverCompanyByName(name, networks);
            const row = toRow(hit);
            if (row) return row;
        }
        return null;
    }

    for (const name of networkLabels) {
        const hit = matchDiscoverCompanyByName(name, networks)
            || (isStreamingBrandLabel(name)
                ? resolvePlayerStudioLogo(name, 'show', { networks, studios })
                : null);
        const row = toRow(hit);
        if (row) return row;
    }

    // Soft: Plex often puts the broadcaster in Studio when Network is sparse on hubs.
    if (studio) {
        const hit = matchDiscoverCompanyByName(studio, networks);
        const row = toRow(hit);
        if (row) return row;
    }

    for (const name of studioLabels) {
        if (isStreamingBrandLabel(name)) continue;
        const hit = matchDiscoverCompanyByName(name, networks);
        const row = toRow(hit);
        if (row) return row;
    }

    // Netflix originals: studio field is the streamer — never Kometa Labels alone.
    if (studio && isStreamingBrandLabel(studio)) {
        const hit = matchDiscoverCompanyByName(studio, networks);
        const row = toRow(hit);
        if (row) return row;
    }

    return null;
};

/**
 * True when an item already has enough metadata for billboard studio/network logos.
 * Episodes/seasons must not treat leaf episode TMDB ids as ready — that skips show
 * enrich and leaves Channel 4 / BBC missing on Continue Watching.
 */
export const itemHasBillboardBrandMeta = (item = {}) => {
    const type = String(item?.type || '').toLowerCase();
    const isTv = type === 'show' || type === 'season' || type === 'episode';
    const hasNetwork = Array.isArray(item?.networkLabels)
        && item.networkLabels.some((row) => String(row || '').trim());
    const hasStudio = Boolean(
        String(item?.studio || '').trim()
        || (Array.isArray(item?.studioLabels) && item.studioLabels.some((row) => String(row || '').trim())),
    );
    // TV billboards need a real Network tag — Labels/TMDB alone still enrich.
    if (isTv) {
        return hasNetwork;
    }
    return hasStudio
        || Number(item?.tmdbId) > 0
        || Number(item?.externalIds?.tmdb) > 0;
};

/**
 * Ranked brand-mark candidates for TV billboards.
 * Movies → studio, then streaming providers.
 * TV → network, then streaming (only when no network — avoids Netflix-on-C4).
 */
export const listPreferredServiceLogos = (groups = {}, mediaType = '') => {
    const { studio = [], network = [], streaming = [] } = groups || {};
    const primary = mediaType === 'movie' ? studio : network;
    const out = [];
    const seen = new Set();
    const push = (row) => {
        const name = String(row?.name || '').trim();
        const logoPath = String(row?.logoPath || '').trim();
        if (!name || !logoPath) return;
        const id = aliasKey(name) || String(row?.key || name).toLowerCase();
        if (seen.has(id)) return;
        seen.add(id);
        out.push(row);
    };
    for (const row of Array.isArray(primary) ? primary : []) push(row);
    // Last resort: TMDB watch-provider logos when studio/network are empty.
    if (!out.length) {
        for (const row of Array.isArray(streaming) ? streaming : []) push(row);
    }
    return out;
};

/**
 * One brand mark for TV billboards.
 * Never stacks more than one logo.
 */
export const pickPreferredServiceLogo = (groups = {}, skipKeys = [], mediaType = '') => {
    const skip = new Set(
        (Array.isArray(skipKeys) ? skipKeys : [])
            .map((value) => String(value || '').trim())
            .filter(Boolean),
    );
    for (const row of listPreferredServiceLogos(groups, mediaType)) {
        const key = String(row?.key || row?.logoPath || row?.name || '').trim();
        if (key && skip.has(key)) continue;
        return row;
    }
    return null;
};

