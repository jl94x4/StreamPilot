export type PlayerSubtitleMode = 'off' | 'forced' | 'always';

/** Skip intro/credits marker behavior (Plex-style). */
export type PlayerSkipMarkerMode = 'off' | 'manual' | 'auto';

export const PLAYER_SKIP_MARKER_MODES: PlayerSkipMarkerMode[] = ['off', 'manual', 'auto'];

export const isPlayerSkipMarkerMode = (value: unknown): value is PlayerSkipMarkerMode => (
    PLAYER_SKIP_MARKER_MODES.includes(String(value || '') as PlayerSkipMarkerMode)
);

/** Burn-in policy when a subtitle track is selected. */
export type PlayerBurnSubtitlesMode = 'auto' | 'always' | 'image';

export const PLAYER_BURN_SUBTITLES_MODES: PlayerBurnSubtitlesMode[] = ['auto', 'always', 'image'];

export const isPlayerBurnSubtitlesMode = (value: unknown): value is PlayerBurnSubtitlesMode => (
    PLAYER_BURN_SUBTITLES_MODES.includes(String(value || '') as PlayerBurnSubtitlesMode)
);

const migrateSkipMode = (modeRaw: unknown, legacyBool: unknown): PlayerSkipMarkerMode => {
    if (isPlayerSkipMarkerMode(modeRaw)) return modeRaw;
    return legacyBool === true ? 'auto' : 'manual';
};

export type PlayerWatchedTickPosition = 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';

export const PLAYER_WATCHED_TICK_POSITIONS: PlayerWatchedTickPosition[] = [
    'top-right',
    'top-left',
    'bottom-right',
    'bottom-left',
];

export const isPlayerWatchedTickPosition = (value: unknown): value is PlayerWatchedTickPosition => (
    PLAYER_WATCHED_TICK_POSITIONS.includes(String(value || '') as PlayerWatchedTickPosition)
);

export type PlayerContinueWatchingLayout = 'poster' | 'title';

export const PLAYER_CONTINUE_WATCHING_LAYOUTS: PlayerContinueWatchingLayout[] = ['poster', 'title'];

export const isPlayerContinueWatchingLayout = (value: unknown): value is PlayerContinueWatchingLayout => (
    PLAYER_CONTINUE_WATCHING_LAYOUTS.includes(String(value || '') as PlayerContinueWatchingLayout)
);

export type PlayerContinueWatchingSort = 'releaseDate' | 'plex' | 'recentlyWatched' | 'title';

export const PLAYER_CONTINUE_WATCHING_SORTS: PlayerContinueWatchingSort[] = [
    'releaseDate',
    'plex',
    'recentlyWatched',
    'title',
];

export const isPlayerContinueWatchingSort = (value: unknown): value is PlayerContinueWatchingSort => (
    PLAYER_CONTINUE_WATCHING_SORTS.includes(String(value || '') as PlayerContinueWatchingSort)
);

/** TV idle screensaver art pool. */
export type PlayerScreensaverSource =
    | 'continue_watching'
    | 'watchlist'
    | 'recommended'
    | 'trending'
    | 'popular'
    | 'new_releases'
    | 'recently_added'
    | 'most_watched'
    | 'unwatched'
    | 'random';

export const PLAYER_SCREENSAVER_SOURCES: PlayerScreensaverSource[] = [
    'continue_watching',
    'watchlist',
    'recommended',
    'trending',
    'popular',
    'new_releases',
    'recently_added',
    'most_watched',
    'unwatched',
    'random',
];

export const isPlayerScreensaverSource = (value: unknown): value is PlayerScreensaverSource => (
    PLAYER_SCREENSAVER_SOURCES.includes(String(value || '') as PlayerScreensaverSource)
);

/** i18n keys under mediaPlayerPage for screensaver source labels (watermark + settings). */
export const PLAYER_SCREENSAVER_SOURCE_LABEL_KEYS: Record<PlayerScreensaverSource, string> = {
    continue_watching: 'mediaPlayerPage.screensaverSourceContinueWatching',
    watchlist: 'mediaPlayerPage.screensaverSourceWatchlist',
    recommended: 'mediaPlayerPage.screensaverSourceRecommended',
    trending: 'mediaPlayerPage.screensaverSourceTrending',
    popular: 'mediaPlayerPage.screensaverSourcePopular',
    new_releases: 'mediaPlayerPage.screensaverSourceNewReleases',
    recently_added: 'mediaPlayerPage.screensaverSourceRecentlyAdded',
    most_watched: 'mediaPlayerPage.screensaverSourceMostWatched',
    unwatched: 'mediaPlayerPage.screensaverSourceUnwatched',
    random: 'mediaPlayerPage.screensaverSourceRandom',
};

const continueWatchingUnixMs = (value: unknown): number => {
    const n = Number(value) || 0;
    if (n <= 0) return 0;
    return n > 1e12 ? n : n * 1000;
};

const continueWatchingReleaseMs = (item: {
    originallyAvailableAt?: string | number | null;
    year?: number | string | null;
    addedAt?: number | null;
    type?: string | null;
} | null | undefined): number => {
    const raw = item?.originallyAvailableAt;
    if (raw != null && raw !== '') {
        if (typeof raw === 'number' && Number.isFinite(raw)) return continueWatchingUnixMs(raw);
        const parsed = Date.parse(String(raw));
        if (Number.isFinite(parsed)) return parsed;
    }
    // Episode `year` is the show premiere year, so it would clump a whole series together.
    if (String(item?.type || '') !== 'episode') {
        const year = Number(item?.year);
        if (year >= 1900 && year <= 2100) return Date.UTC(year, 0, 1);
    }
    return continueWatchingUnixMs(item?.addedAt);
};

const continueWatchingViewedMs = (item: { lastViewedAt?: number | null } | null | undefined): number => (
    continueWatchingUnixMs(item?.lastViewedAt)
);

const continueWatchingTitleKey = (item: { showTitle?: string | null; title?: string | null } | null | undefined): string => (
    String(item?.showTitle || item?.title || '').trim()
);

/** Reorder Continue Watching. `plex` keeps the server/On Deck order. */
export const sortContinueWatchingItems = <T extends {
    originallyAvailableAt?: string | number | null;
    year?: number | string | null;
    addedAt?: number | null;
    lastViewedAt?: number | null;
    showTitle?: string | null;
    title?: string | null;
    type?: string | null;
}>(items: T[] | null | undefined, sort: unknown): T[] => {
    const list = Array.isArray(items) ? items : [];
    const mode = isPlayerContinueWatchingSort(sort) ? sort : 'releaseDate';
    if (mode === 'plex' || list.length < 2) return list.slice();
    const ranked = list.map((item, index) => ({ item, index }));
    ranked.sort((a, b) => {
        if (mode === 'title') {
            const cmp = continueWatchingTitleKey(a.item).localeCompare(
                continueWatchingTitleKey(b.item),
                undefined,
                { sensitivity: 'base' },
            );
            return cmp || a.index - b.index;
        }
        const av = mode === 'recentlyWatched'
            ? continueWatchingViewedMs(a.item)
            : continueWatchingReleaseMs(a.item);
        const bv = mode === 'recentlyWatched'
            ? continueWatchingViewedMs(b.item)
            : continueWatchingReleaseMs(b.item);
        return (bv - av) || a.index - b.index;
    });
    return ranked.map((row) => row.item);
};

const continueWatchingItemKey = (item: { ratingKey?: string | number | null } | null | undefined): string => (
    String(item?.ratingKey || '').trim()
);

/** Keep the first Continue Watching order; only append titles that were not on screen yet. */
export const stabilizeContinueWatchingOrder = <T extends {
    ratingKey?: string | number | null;
    originallyAvailableAt?: string | number | null;
    year?: number | string | null;
    addedAt?: number | null;
    lastViewedAt?: number | null;
    showTitle?: string | null;
    title?: string | null;
    type?: string | null;
}>(items: T[] | null | undefined, sort: unknown, previousKeys?: string[] | null): { items: T[]; keys: string[] } => {
    const sorted = sortContinueWatchingItems(items, sort);
    const mode = isPlayerContinueWatchingSort(sort) ? sort : 'releaseDate';
    const prior = Array.isArray(previousKeys)
        ? previousKeys.map((key) => String(key || '').trim()).filter(Boolean)
        : [];
    // Recently watched must follow last view time. Freezing the first key list
    // appends the next episode (a new rating key) at the end of the row.
    if (!prior.length || mode === 'recentlyWatched') {
        return { items: sorted, keys: sorted.map(continueWatchingItemKey).filter(Boolean) };
    }
    const byKey = new Map<string, T>();
    for (const item of sorted) {
        const key = continueWatchingItemKey(item);
        if (key && !byKey.has(key)) byKey.set(key, item);
    }
    const seen = new Set<string>();
    const kept: T[] = [];
    for (const key of prior) {
        const item = byKey.get(key);
        if (!item || seen.has(key)) continue;
        seen.add(key);
        kept.push(item);
    }
    const extras = sorted.filter((item) => {
        const key = continueWatchingItemKey(item);
        return !!key && !seen.has(key);
    });
    const next = kept.concat(extras);
    return { items: next, keys: next.map(continueWatchingItemKey).filter(Boolean) };
};

export const continueWatchingRailAspect = (
    layout: PlayerContinueWatchingLayout,
): '2/3' | '16/9' => (layout === 'title' ? '16/9' : '2/3');

/** Absolute corner classes for watched ticks on posters (not episode thumbs). */
export const watchedTickPositionClass = (
    position: PlayerWatchedTickPosition | string | null | undefined,
    { aboveProgress = false } = {},
) => {
    const corner = isPlayerWatchedTickPosition(position) ? position : 'top-right';
    const bottom = aboveProgress ? 'bottom-3' : 'bottom-1.5';
    switch (corner) {
        case 'top-left':
            return 'absolute left-1.5 top-1.5';
        case 'bottom-left':
            return `absolute left-1.5 ${bottom}`;
        case 'bottom-right':
            return `absolute right-1.5 ${bottom}`;
        default:
            return 'absolute right-1.5 top-1.5';
    }
};

export type PlayerSettings = {
    mixLibraries: boolean;
    autoplayNext: boolean;
    /**
     * After this many consecutive autoplay episodes, ask "Still watching?".
     * 0 = never ask. Default 3.
     */
    stillWatchingAfter: number;
    showContinueWatching: boolean;
    /** Portrait posters vs widescreen episode-style cards on Continue Watching rows. */
    continueWatchingLayout: PlayerContinueWatchingLayout;
    /** How Continue Watching cards are ordered. */
    continueWatchingSort: PlayerContinueWatchingSort;
    showPlaylists: boolean;
    showBecauseYouWatched: boolean;
    /** Watchlist hub on Home, under Continue Watching. */
    showWatchlist: boolean;
    defaultQualityId: string;
    audioLanguage: string;
    subtitleMode: PlayerSubtitleMode;
    /** @deprecated Prefer skipIntroMode; kept for older saves / server payloads. */
    autoSkipIntro: boolean;
    /** @deprecated Prefer skipCreditsMode. */
    autoSkipCredits: boolean;
    skipIntroMode: PlayerSkipMarkerMode;
    skipCreditsMode: PlayerSkipMarkerMode;
    /** Seconds to rewind when unpausing (0 = off). */
    rewindOnResumeSec: number;
    /** Plex-style audioBoost percent for transcodes (100 / 200 / 300). */
    audioBoost: number;
    burnSubtitles: PlayerBurnSubtitlesMode;
    /** External/text subtitle timing offset in ms (−5000…5000). */
    subtitleDelayMs: number;
    /** Prefer server voice-activity auto-sync when available. */
    subtitleAutoSync: boolean;
    playThemeTunes: boolean;
    /** Billboard + overview studio / network / streaming logos (on by default). */
    showServiceBrandLogos: boolean;
    /** Grey plate behind studio / network / streaming logos on overview. */
    serviceLogoPlates: boolean;
    /** Resolution / codec pills on season episode cards. */
    showEpisodeFilePills: boolean;
    /** Corner for watched checkmarks on movie/show/season posters (not episodes). */
    watchedTickPosition: PlayerWatchedTickPosition;
    /** Phone overview: poster on the still instead of the clear logo. */
    phoneOverviewPoster: boolean;
    /**
     * Shows with only one season open the episode list directly
     * instead of the seasons overview. Off by default.
     */
    skipSingleSeason: boolean;
    homeRowOrder: string[];
    libraryNavOrder: string[];
    /** Hide watched movies/shows from Recently Added rows. */
    hideWatchedFromRecents: boolean;
    /** Recently Added TV: use season posters instead of the series poster. */
    recentlyAddedSeasonPoster: boolean;
    /** TV screensaver: which library pool to cycle as ambient art. */
    screensaverSource: PlayerScreensaverSource;
    /** TV screensaver: nudge the clock each slide so it does not burn into OLED panels. */
    screensaverShiftClock: boolean;
    /** TV: skip focus zoom and screen-enter motion. */
    reduceMotion: boolean;
    /** TV movie / show pages: fade the page into the backdrop's bottom-edge colour. Off = black. */
    detailsArtworkTint: boolean;
    /** TV corner clock. On uses 15:36. Off uses 3:36 PM. */
    clock24Hour: boolean;
    nightMode: boolean;
    matchFrameRate: boolean;
    /** HDMI bitstream of DD/DTS/TrueHD when the sink supports it. */
    audioPassthrough: boolean;
    /** @deprecated Prefer cinemaTrailerCount. */
    cinemaTrailers: boolean;
    /** How many trailers to play before a movie (0–5). */
    cinemaTrailerCount: number;
    subtitleSize: number;
    subtitleColor: string;
    subtitleBackground: string;
    subtitlePosition: 'bottom' | 'middle' | 'top';
};

export const PLAYER_QUALITY_CHOICES = [
    { id: 'original', label: 'Original' },
    { id: '1080-20', label: '1080p · 20 Mbps' },
    { id: '1080-12', label: '1080p · 12 Mbps' },
    { id: '1080-8', label: '1080p · 8 Mbps' },
    { id: '720-4', label: '720p · 4 Mbps' },
    { id: '720-2', label: '720p · 2 Mbps' },
    { id: '480-1.5', label: '480p · 1.5 Mbps' },
    { id: '360-0.7', label: '360p · 0.7 Mbps' },
];

export const PLAYER_AUDIO_LANGUAGES = [
    { id: 'en', label: 'English' },
    { id: 'es', label: 'Spanish' },
    { id: 'fr', label: 'French' },
    { id: 'de', label: 'German' },
    { id: 'it', label: 'Italian' },
    { id: 'pt', label: 'Portuguese' },
    { id: 'ja', label: 'Japanese' },
    { id: 'ko', label: 'Korean' },
    { id: 'zh', label: 'Chinese' },
    { id: 'ru', label: 'Russian' },
    { id: 'nl', label: 'Dutch' },
    { id: 'pl', label: 'Polish' },
    { id: 'sv', label: 'Swedish' },
    { id: 'no', label: 'Norwegian' },
    { id: 'da', label: 'Danish' },
    { id: 'fi', label: 'Finnish' },
    { id: 'ar', label: 'Arabic' },
    { id: 'hi', label: 'Hindi' },
    { id: 'tr', label: 'Turkish' },
];

export const PLAYER_HOME_ROW_IDS = ['continueWatching', 'recents'] as const;
export const MIXED_RECENT_HOME_ROW_IDS = ['recent:movie', 'recent:show', 'recent:artist'] as const;

export const isPlayerHomeRowId = (value: unknown): value is string => {
    const id = String(value || '').trim();
    if (id === 'continueWatching' || id === 'recents' || id === 'playlists' || id === 'libraries') return true;
    return /^recent:[A-Za-z0-9._-]{1,64}$/.test(id);
};

export const isPlayerLibraryKey = (value: unknown): value is string => (
    /^[A-Za-z0-9._-]{1,64}$/.test(String(value || '').trim())
);

export const normalizeLibraryNavOrder = (raw: unknown): string[] => {
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const value of raw) {
        const id = String(value || '').trim();
        if (!isPlayerLibraryKey(id) || seen.has(id)) continue;
        seen.add(id);
        out.push(id);
    }
    return out.slice(0, 40);
};

export const libraryNavOrderFromHomeRows = (homeRowOrder: unknown): string[] => {
    const keys: string[] = [];
    const mixed = new Set<string>(MIXED_RECENT_HOME_ROW_IDS);
    for (const id of normalizeHomeRowOrder(homeRowOrder)) {
        if (!id.startsWith('recent:') || mixed.has(id)) continue;
        keys.push(id.slice('recent:'.length));
    }
    return normalizeLibraryNavOrder(keys);
};

export const collapseHomeRowOrder = (order: unknown): string[] => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of normalizeHomeRowOrder(order)) {
        const id = raw.startsWith('recent:') ? 'recents' : raw === 'libraries' ? '' : raw;
        if (!id || seen.has(id)) continue;
        seen.add(id);
        out.push(id);
    }
    return out;
};

export const applyLibraryNavOrder = <T extends { key?: string | null }>(
    libraries: T[] = [],
    order: string[] = [],
): T[] => {
    const list = Array.isArray(libraries) ? libraries.filter((row) => row && String(row.key || '').trim()) : [];
    const byKey = new Map(list.map((row) => [String(row.key), row]));
    const seen = new Set<string>();
    const out: T[] = [];
    for (const key of normalizeLibraryNavOrder(order)) {
        const row = byKey.get(key);
        if (!row || seen.has(key)) continue;
        seen.add(key);
        out.push(row);
    }
    for (const row of list) {
        const key = String(row.key);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(row);
    }
    return out;
};

export type PlayerHomeHubMediaKind = 'continueWatching' | 'becauseYouWatched' | 'playlist' | 'movie' | 'show' | 'artist' | 'other';

const normalizeLibraryMediaType = (value: unknown): 'movie' | 'show' | 'artist' | null => {
    const type = String(value || '').trim().toLowerCase();
    if (type === 'show' || type === 'tv' || type === 'episode' || type === 'season') return 'show';
    if (type === 'artist' || type === 'album' || type === 'track' || type === 'music' || type === 'audio') return 'artist';
    if (type === 'movie' || type === 'film') return 'movie';
    return null;
};

/** Classify a home hub so library nav order can regroup movie / TV / music rows. */
export const classifyPlayerHomeHub = (hub: {
    identifier?: string | null;
    title?: string | null;
    playlistRatingKey?: string | null;
    items?: Array<{ type?: string | null; librarySectionID?: string | null }> | null;
} = {}): PlayerHomeHubMediaKind => {
    const identifier = String(hub.identifier || '');
    const idLower = identifier.toLowerCase();
    const blob = `${identifier} ${hub.title || ''}`.toLowerCase();
    if (/continue\s*watch|ondeck|on[.\s_-]?deck|in[.\s_-]?progress/.test(blob)) return 'continueWatching';
    if (/because\s+you\s+watched/.test(blob) || /^because:/.test(identifier)) return 'becauseYouWatched';
    if (hub.playlistRatingKey || /playlist/.test(blob)) return 'playlist';
    // Prefer hubIdentifier structure over title words — "Music Movies" collections
    // are movie.collection.* hubs, not albums.
    if (/^(movie|film)\./.test(idLower) || /(^|[.\s_-])(movie|film)([.\s_-]|$)/.test(idLower)) return 'movie';
    if (/^(tv|show)\./.test(idLower) || /(^|[.\s_-])(tv|show)([.\s_-]|$)/.test(idLower) || /\b(series|episode)\b/.test(blob)) {
        return 'show';
    }
    if (/^(artist|music|album)\./.test(idLower) || /(^|[.\s_-])(music|artist|album|track|audio)([.\s_-]|$)/.test(idLower)) {
        return 'artist';
    }
    const counts: Record<'movie' | 'show' | 'artist', number> = { movie: 0, show: 0, artist: 0 };
    for (const item of hub.items || []) {
        const kind = normalizeLibraryMediaType(item?.type);
        if (kind) counts[kind] += 1;
    }
    const ranked = (Object.entries(counts) as Array<['movie' | 'show' | 'artist', number]>)
        .sort((a, b) => b[1] - a[1]);
    if (ranked[0]?.[1]) return ranked[0][0];
    // Title-only heuristics last (after item majority).
    if (/(^|[.\s_-])(music|artist|album|track|audio)([.\s_-]|$)/.test(blob)) return 'artist';
    if (/(^|[.\s_-])(movie|film)([.\s_-]|$)/.test(blob)) return 'movie';
    if (/(^|[.\s_-])(tv|show)([.\s_-]|$)/.test(blob)) return 'show';
    return 'other';
};

const dominantLibrarySectionId = (
    items: Array<{ librarySectionID?: string | null }> = [],
): string | null => {
    const counts = new Map<string, number>();
    for (const item of items) {
        const id = String(item?.librarySectionID || '').trim();
        if (!id) continue;
        counts.set(id, (counts.get(id) || 0) + 1);
    }
    let best: string | null = null;
    let bestCount = 0;
    for (const [id, count] of counts) {
        if (count > bestCount) {
            best = id;
            bestCount = count;
        }
    }
    return best;
};

/**
 * Reorder Plex home hubs to follow library sidebar order.
 * Continue Watching stays first; playlists/unknown stay last; typed rows follow nav.
 */
export const applyLibraryNavOrderToHubs = <T extends {
    identifier?: string | null;
    title?: string | null;
    playlistRatingKey?: string | null;
    items?: Array<{ type?: string | null; librarySectionID?: string | null }> | null;
}>(
    hubs: T[] = [],
    libraries: Array<{ key?: string | null; type?: string | null }> = [],
    order: string[] = [],
): T[] => {
    const list = Array.isArray(hubs) ? hubs.filter(Boolean) : [];
    if (list.length < 2) return list.slice();
    const orderedLibraries = applyLibraryNavOrder(libraries, order);
    if (!orderedLibraries.length) return list.slice();

    const libraryRank = new Map<string, number>();
    const typeRank = new Map<'movie' | 'show' | 'artist', number>();
    orderedLibraries.forEach((library, index) => {
        const key = String(library.key || '').trim();
        if (key) libraryRank.set(key, index);
        const kind = normalizeLibraryMediaType(library.type);
        if (kind && !typeRank.has(kind)) typeRank.set(kind, index);
    });

    const rankFor = (hub: T, index: number): [number, number, number] => {
        const kind = classifyPlayerHomeHub(hub);
        if (kind === 'continueWatching') return [-2, 0, index];
        if (kind === 'playlist') return [1, 0, index];
        if (kind === 'becauseYouWatched') return [2, 0, index];
        if (kind === 'other') return [1, 1, index];

        const sectionId = dominantLibrarySectionId(hub.items || []);
        if (sectionId && libraryRank.has(sectionId)) {
            return [0, libraryRank.get(sectionId) as number, index];
        }
        if (typeRank.has(kind)) {
            return [0, typeRank.get(kind) as number, index];
        }
        return [1, 2, index];
    };

    return list
        .map((hub, index) => ({ hub, index, rank: rankFor(hub, index) }))
        .sort((a, b) => (
            a.rank[0] - b.rank[0]
            || a.rank[1] - b.rank[1]
            || a.rank[2] - b.rank[2]
        ))
        .map((row) => row.hub);
};

export const normalizeHomeRowOrder = (raw: unknown): string[] => {
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const value of raw) {
        const id = String(value || '').trim();
        if (!isPlayerHomeRowId(id) || seen.has(id)) continue;
        seen.add(id);
        out.push(id);
    }
    return out.slice(0, 40);
};

export const applyHomeRowOrder = (ids: string[] = [], order: string[] = []): string[] => {
    const wanted: string[] = [];
    const seenWanted = new Set<string>();
    for (const value of ids) {
        const id = String(value || '').trim();
        if (!id || seenWanted.has(id)) continue;
        seenWanted.add(id);
        wanted.push(id);
    }
    const seen = new Set<string>();
    const out: string[] = [];
    for (const id of collapseHomeRowOrder(order)) {
        if (!seenWanted.has(id) || seen.has(id)) continue;
        seen.add(id);
        out.push(id);
    }
    for (const id of wanted) {
        if (seen.has(id)) continue;
        out.push(id);
    }
    return out;
};

export const defaultHomeRowIds = (): string[] => [...PLAYER_HOME_ROW_IDS];

export const moveHomeRow = (ids: string[], index: number, direction: -1 | 1): string[] => {
    const next = [...ids];
    const target = index + direction;
    if (index < 0 || target < 0 || target >= next.length) return next;
    const current = next[index];
    next[index] = next[target];
    next[target] = current;
    return next;
};

const QUALITY_IDS = new Set(['auto', ...PLAYER_QUALITY_CHOICES.map((row) => row.id)]);
const SUBTITLE_MODES = new Set<PlayerSubtitleMode>(['off', 'forced', 'always']);

export const PLAYER_SETTINGS_KEY = 'portal-media-player-settings';
export const PLAYER_SETTINGS_EVENT = 'portal-media-player-settings';
/** Live draft preview (e.g. library nav order) before Save. */
export const PLAYER_SETTINGS_DRAFT_EVENT = 'portal-media-player-settings-draft';

export const publishPlayerSettingsDraft = (settings: PlayerSettings) => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent(PLAYER_SETTINGS_DRAFT_EVENT, { detail: settings }));
};

export const DEFAULT_PLAYER_SETTINGS: PlayerSettings = {
    mixLibraries: false,
    autoplayNext: true,
    stillWatchingAfter: 3,
    showContinueWatching: true,
    continueWatchingLayout: 'poster',
    continueWatchingSort: 'releaseDate',
    showPlaylists: true,
    showBecauseYouWatched: true,
    showWatchlist: true,
    defaultQualityId: 'auto',
    audioLanguage: '',
    subtitleMode: 'forced',
    autoSkipIntro: false,
    autoSkipCredits: false,
    skipIntroMode: 'manual',
    skipCreditsMode: 'manual',
    rewindOnResumeSec: 0,
    audioBoost: 100,
    burnSubtitles: 'auto',
    subtitleDelayMs: 0,
    subtitleAutoSync: false,
    playThemeTunes: true,
    showServiceBrandLogos: true,
    serviceLogoPlates: true,
    showEpisodeFilePills: true,
    watchedTickPosition: 'bottom-left',
    phoneOverviewPoster: false,
    skipSingleSeason: false,
    homeRowOrder: [],
    libraryNavOrder: [],
    hideWatchedFromRecents: false,
    recentlyAddedSeasonPoster: false,
    screensaverSource: 'continue_watching',
    screensaverShiftClock: false,
    reduceMotion: false,
    detailsArtworkTint: true,
    clock24Hour: true,
    nightMode: false,
    matchFrameRate: true,
    audioPassthrough: false,
    cinemaTrailers: false,
    cinemaTrailerCount: 0,
    subtitleSize: 100,
    subtitleColor: '#ffffff',
    subtitleBackground: 'none',
    subtitlePosition: 'bottom',
};

const normalizeLang = (value: unknown) => String(value || '').trim().toLowerCase().replace(/_/g, '-');

export const normalizePlayerSettings = (raw: Partial<PlayerSettings> | Record<string, unknown> | null | undefined): PlayerSettings => {
    const quality = String(raw?.defaultQualityId || 'auto');
    const audioLanguage = normalizeLang(raw?.audioLanguage);
    const subtitleMode = String(raw?.subtitleMode || DEFAULT_PLAYER_SETTINGS.subtitleMode) as PlayerSubtitleMode;
    return {
        mixLibraries: raw?.mixLibraries === true,
        autoplayNext: raw?.autoplayNext !== false,
        stillWatchingAfter: (() => {
            const n = Number(raw?.stillWatchingAfter);
            if (!Number.isFinite(n)) return DEFAULT_PLAYER_SETTINGS.stillWatchingAfter;
            return Math.min(20, Math.max(0, Math.floor(n)));
        })(),
        showContinueWatching: raw?.showContinueWatching !== false,
        continueWatchingLayout: isPlayerContinueWatchingLayout(raw?.continueWatchingLayout)
            ? raw.continueWatchingLayout
            : 'poster',
        continueWatchingSort: isPlayerContinueWatchingSort(raw?.continueWatchingSort)
            ? raw.continueWatchingSort
            : 'releaseDate',
        showPlaylists: raw?.showPlaylists !== false,
        showBecauseYouWatched: raw?.showBecauseYouWatched !== false,
        showWatchlist: raw?.showWatchlist !== false,
        defaultQualityId: QUALITY_IDS.has(quality) ? quality : 'auto',
        audioLanguage: /^[a-z]{2}(?:-[a-z]{2})?$/.test(audioLanguage) ? audioLanguage : '',
        subtitleMode: SUBTITLE_MODES.has(subtitleMode) ? subtitleMode : 'forced',
        autoSkipIntro: raw?.autoSkipIntro === true || String(raw?.skipIntroMode || '') === 'auto',
        autoSkipCredits: raw?.autoSkipCredits === true || String(raw?.skipCreditsMode || '') === 'auto',
        skipIntroMode: migrateSkipMode(raw?.skipIntroMode, raw?.autoSkipIntro),
        skipCreditsMode: migrateSkipMode(raw?.skipCreditsMode, raw?.autoSkipCredits),
        rewindOnResumeSec: (() => {
            const n = Number(raw?.rewindOnResumeSec);
            if (![0, 5, 10, 15, 20, 30].includes(n)) return 0;
            return n;
        })(),
        audioBoost: (() => {
            const n = Number(raw?.audioBoost);
            if (n === 200 || n === 300) return n;
            return 100;
        })(),
        burnSubtitles: isPlayerBurnSubtitlesMode(raw?.burnSubtitles) ? raw.burnSubtitles : 'auto',
        subtitleDelayMs: (() => {
            const n = Math.round(Number(raw?.subtitleDelayMs) || 0);
            if (!Number.isFinite(n)) return 0;
            const stepped = Math.round(n / 500) * 500;
            return Math.min(5000, Math.max(-5000, stepped));
        })(),
        subtitleAutoSync: raw?.subtitleAutoSync === true,
        playThemeTunes: raw?.playThemeTunes !== false,
        showServiceBrandLogos: raw?.showServiceBrandLogos !== false,
        serviceLogoPlates: raw?.serviceLogoPlates !== false,
        showEpisodeFilePills: raw?.showEpisodeFilePills !== false,
        watchedTickPosition: isPlayerWatchedTickPosition(raw?.watchedTickPosition)
            ? raw!.watchedTickPosition as PlayerWatchedTickPosition
            : 'bottom-left',
        phoneOverviewPoster: raw?.phoneOverviewPoster === true,
        skipSingleSeason: raw?.skipSingleSeason === true,
        homeRowOrder: collapseHomeRowOrder(raw?.homeRowOrder),
        libraryNavOrder: normalizeLibraryNavOrder(
            Array.isArray(raw?.libraryNavOrder) && raw.libraryNavOrder.length
                ? raw.libraryNavOrder
                : libraryNavOrderFromHomeRows(raw?.homeRowOrder),
        ),
        hideWatchedFromRecents: raw?.hideWatchedFromRecents === true,
        recentlyAddedSeasonPoster: raw?.recentlyAddedSeasonPoster === true,
        screensaverSource: isPlayerScreensaverSource(raw?.screensaverSource)
            ? raw.screensaverSource
            : 'continue_watching',
        screensaverShiftClock: raw?.screensaverShiftClock === true,
        reduceMotion: raw?.reduceMotion === true,
        detailsArtworkTint: raw?.detailsArtworkTint !== false,
        clock24Hour: raw?.clock24Hour !== false,
        nightMode: raw?.nightMode === true,
        matchFrameRate: raw?.matchFrameRate !== false,
        audioPassthrough: raw?.audioPassthrough === true,
        cinemaTrailers: (() => {
            const count = Number(raw?.cinemaTrailerCount);
            if (Number.isFinite(count)) return count > 0;
            return raw?.cinemaTrailers === true;
        })(),
        cinemaTrailerCount: (() => {
            const count = Number(raw?.cinemaTrailerCount);
            if (Number.isFinite(count)) return Math.min(5, Math.max(0, Math.floor(count)));
            return raw?.cinemaTrailers === true ? 2 : 0;
        })(),
        subtitleSize: Math.min(200, Math.max(50, Number(raw?.subtitleSize) || 100)),
        subtitleColor: /^#[0-9a-f]{6}$/i.test(String(raw?.subtitleColor || ''))
            ? String(raw?.subtitleColor)
            : '#ffffff',
        subtitleBackground: ['none', 'dim', 'solid'].includes(String(raw?.subtitleBackground || ''))
            ? String(raw?.subtitleBackground) as PlayerSettings['subtitleBackground']
            : 'none',
        subtitlePosition: ['bottom', 'middle', 'top'].includes(String(raw?.subtitlePosition || ''))
            ? String(raw?.subtitlePosition) as PlayerSettings['subtitlePosition']
            : 'bottom',
    };
};

export const playerSettingsEqual = (a: PlayerSettings, b: PlayerSettings) => (
    a.mixLibraries === b.mixLibraries
    && a.autoplayNext === b.autoplayNext
    && a.stillWatchingAfter === b.stillWatchingAfter
    && a.showContinueWatching === b.showContinueWatching
    && a.continueWatchingLayout === b.continueWatchingLayout
    && a.continueWatchingSort === b.continueWatchingSort
    && a.showPlaylists === b.showPlaylists
    && a.showBecauseYouWatched === b.showBecauseYouWatched
    && a.showWatchlist === b.showWatchlist
    && a.defaultQualityId === b.defaultQualityId
    && a.audioLanguage === b.audioLanguage
    && a.subtitleMode === b.subtitleMode
    && a.autoSkipIntro === b.autoSkipIntro
    && a.autoSkipCredits === b.autoSkipCredits
    && a.skipIntroMode === b.skipIntroMode
    && a.skipCreditsMode === b.skipCreditsMode
    && a.rewindOnResumeSec === b.rewindOnResumeSec
    && a.audioBoost === b.audioBoost
    && a.burnSubtitles === b.burnSubtitles
    && a.subtitleDelayMs === b.subtitleDelayMs
    && a.subtitleAutoSync === b.subtitleAutoSync
    && a.playThemeTunes === b.playThemeTunes
    && a.showServiceBrandLogos === b.showServiceBrandLogos
    && a.serviceLogoPlates === b.serviceLogoPlates
    && a.showEpisodeFilePills === b.showEpisodeFilePills
    && a.watchedTickPosition === b.watchedTickPosition
    && a.phoneOverviewPoster === b.phoneOverviewPoster
    && a.skipSingleSeason === b.skipSingleSeason
    && a.homeRowOrder.join('\0') === b.homeRowOrder.join('\0')
    && a.libraryNavOrder.join('\0') === b.libraryNavOrder.join('\0')
    && a.hideWatchedFromRecents === b.hideWatchedFromRecents
    && a.recentlyAddedSeasonPoster === b.recentlyAddedSeasonPoster
    && a.screensaverSource === b.screensaverSource
    && a.screensaverShiftClock === b.screensaverShiftClock
    && a.reduceMotion === b.reduceMotion
    && a.detailsArtworkTint === b.detailsArtworkTint
    && a.clock24Hour === b.clock24Hour
    && a.nightMode === b.nightMode
    && a.matchFrameRate === b.matchFrameRate
    && a.audioPassthrough === b.audioPassthrough
    && a.cinemaTrailers === b.cinemaTrailers
    && a.cinemaTrailerCount === b.cinemaTrailerCount
    && a.subtitleSize === b.subtitleSize
    && a.subtitleColor === b.subtitleColor
    && a.subtitleBackground === b.subtitleBackground
    && a.subtitlePosition === b.subtitlePosition
);

export const readPlayerSettings = (): PlayerSettings => {
    if (typeof window === 'undefined') return { ...DEFAULT_PLAYER_SETTINGS };
    try {
        const raw = window.localStorage.getItem(PLAYER_SETTINGS_KEY);
        if (!raw) return { ...DEFAULT_PLAYER_SETTINGS };
        return normalizePlayerSettings(JSON.parse(raw) || {});
    } catch {
        return { ...DEFAULT_PLAYER_SETTINGS };
    }
};

export const writePlayerSettings = (settings: PlayerSettings) => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(PLAYER_SETTINGS_KEY, JSON.stringify(normalizePlayerSettings(settings)));
    window.dispatchEvent(new Event(PLAYER_SETTINGS_EVENT));
};
