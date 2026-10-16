export type PosterSetsConfig = {
    base_url: string;
    token: string;
    bulk_txt: string;
    tv_library: string[];
    movie_library: string[];
    mediux_filters: string[];
    /** Clear Overlays stamps (4K, HDR, banners, Overlay label, tracking) after upload (default true). */
    reset_overlay?: boolean;
    /** Prefer this provider when MediUX and ThePosterDB both return the same set/title. */
    dupePreference?: 'posterdb' | 'mediux';
    watchersEnabled?: boolean;
    watchIntervalHours?: number;
    autoWatchOnApply?: boolean;
    notifyOnWatcherDigest?: boolean;
    /** Debounced watch check when Sonarr On Import fires (Scanner webhook). */
    arrWatchHookEnabled?: boolean;
    /** Creator usernames shown on Browse → Following (MediUX / ThePosterDB). */
    creatorWhitelist?: string[];
    /** Creator usernames whose sets are hidden and never image-cached. */
    creatorBlocklist?: string[];
    /** Where artwork is written after apply: plex, local, plex_local, jellyfin, or emby. */
    applyDestination?: 'plex' | 'local' | 'plex_local' | 'jellyfin' | 'emby';
    /** Optional ThePosterDB login for advanced title search (canonical /posters/ pages). */
    tpdb_username?: string;
    tpdb_password?: string;
    hasTpdbPassword?: boolean;
    hasToken?: boolean;
    configured?: boolean;
    /** True when URL/token resolve from Settings → Media Player. */
    usingPortalPlex?: boolean;
    portalPlexAvailable?: boolean;
    /** Effective Plex URL after Media Player fallback (display only). */
    effective_base_url?: string;
    /** Persist TPDB scrapes for library titles (fast reopen + offline apply). */
    tpdbLocalCacheEnabled?: boolean;
    /** After a library title loads, hydrate all its TPDB set assets/images in the background. */
    tpdbAggressivePrefetch?: boolean;
    /** Experimental: 5 parallel cache-build workers (separate sessions). Disable if rate-limited. */
    tpdbWarmParallelWorkers?: boolean;
    /** Prefetch followed creators' sets before other creators when caching. */
    tpdbPrioritizeFollowedCreators?: boolean;
    /** Only prefetch/cache set pages and images from Creators you follow. */
    tpdbCacheFollowedCreatorsOnly?: boolean;
    /** Attempt TPDB login for advanced id search. Off = public title search only. */
    tpdbUseLogin?: boolean;
    /** Include ThePosterDB in search, Browse, cache, and UI copy (default on). */
    tpdbEnabled?: boolean;
    /**
     * Include ThePosterDB in Discover search, Browse, TPDB New, and library set lookup.
     * Off keeps watches and the import script working (default on).
     */
    tpdbSearchEnabled?: boolean;
    /** Show a copy-title control on library posters (hover on desktop; always on touch). Default on. */
    copyLibraryTitleEnabled?: boolean;
    /** Include MediUX in search, Browse, and UI copy (default on). */
    mediuxEnabled?: boolean;
    /** Soft disk budget for tpdb-image-cache (bytes). */
    tpdbCacheMaxBytes?: number;
    /** Local hour (0–23) when the daily “new sets” refresh first runs. */
    tpdbCacheRefreshHour?: number;
    /** Repeat every N hours after that (0 = once daily). */
    tpdbCacheRefreshIntervalHours?: number;
    /** Library cache build media filter. */
    tpdbCacheWarmMedia?: 'all' | 'movie' | 'show';
    /** Library cache build source filter. */
    tpdbCacheWarmSource?: 'full' | 'recent';
    /** Skip titles that already have a TPDB set list on disk. */
    tpdbCacheSkipCached?: boolean;
    /**
     * When Plex posts library.new, resolve the title on ThePosterDB and cache set lists + images.
     * Requires Enable local TPDB cache. Uses /api/poster-sets/webhook.
     */
    tpdbCacheOnLibraryAdd?: boolean;
    /** One-shot first-run backfill of last 20 movies + 20 shows (server-managed). */
    tpdbFirstRunBackfillDone?: boolean;
    /** Shared-secret for Plex → Poster Sets library.new webhook (?token=). */
    webhookToken?: string;
    /** Server-only: rotate webhookToken on next save. */
    rotateWebhookToken?: boolean;
};

export type PosterSetsWatch = {
    id: string;
    enabled?: boolean;
    provider?: string;
    url: string;
    setId?: string | null;
    title?: string | null;
    user?: string | null;
    tmdbId?: string | null;
    tvdbId?: string | null;
    thumbUrl?: string;
    setKind?: string | null;
    mediuxFilters?: string[];
    knownAssetIds?: string[];
    knownAssetCount?: number;
    appliedAssetIds?: string[];
    lastMatchedAssetIds?: string[];
    assetTrackingVersion?: number;
    lastCheckedAt?: string | null;
    lastAppliedAt?: string | null;
    lastError?: string | null;
    lastNewCount?: number;
    plexHint?: {
        ratingKey?: string | null;
        title?: string | null;
        mediaType?: string | null;
    } | null;
    createdAt?: string | null;
    updatedAt?: string | null;
};

export type PosterSetsWatchStats = {
    total?: number;
    enabled?: number;
    errored?: number;
    max?: number;
};

export type PosterSetsWatcherPassStatus = {
    running?: boolean;
    busy?: boolean;
    stale?: boolean;
    ageMs?: number | null;
    startedAt?: string | null;
    finishedAt?: string | null;
    lastProgressAt?: string | null;
    total?: number;
    checked?: number;
    queued?: number;
    assetsQueued?: number;
    currentTitle?: string | null;
    lastError?: string | null;
    forceAll?: boolean;
};

export type PosterSetsSetMeta = {
    provider?: string | null;
    setId?: string | null;
    url?: string | null;
    title?: string | null;
    user?: string | null;
    tmdbId?: string | null;
    tvdbId?: string | null;
    mediaType?: 'movie' | 'show' | string | null;
    thumbUrl?: string;
    assetCount?: number | null;
    /** Dominant art type when known (title_cards, backgrounds, posters). */
    setKind?: string | null;
    mediuxFilters?: string[] | null;
};

export type PosterSetsJobInput = {
    url?: string;
    urls?: string[];
    text?: string;
    count?: number;
    fromFile?: boolean;
    file?: string;
    lineCount?: number;
    selectedCount?: number;
    selectedIds?: string[] | null;
    selectedAssets?: Array<{
        id?: string;
        kind?: string;
        title?: string;
        year?: number | null;
        season?: string | number | null;
        episode?: string | number | null;
        url?: string;
        thumbUrl?: string;
        source?: string;
        fileType?: string | null;
    }> | null;
    setMeta?: PosterSetsSetMeta | null;
    watchId?: string | null;
    mediuxFilters?: string[];
    source?: 'manual' | 'watch' | 'bulk' | string;
};

export type PosterSetsQueueStats = {
    paused?: boolean;
    queued?: number;
    running?: number;
    succeeded?: number;
    warning?: number;
    failed?: number;
    cancelled?: number;
    pending?: number;
};

export type PosterSetsQueueResponse = {
    ok?: boolean;
    paused: boolean;
    stats: PosterSetsQueueStats;
    jobs: PosterSetsJob[];
};

export type PosterSetsStatus = {
    ok?: boolean;
    workerReady?: boolean;
    configured?: boolean;
    appDir?: string;
    mediaServerType?: string;
    mediaServerLabel?: string;
    config?: PosterSetsConfig;
    queue?: PosterSetsQueueStats;
    watches?: PosterSetsWatchStats;
    recentJobs?: Array<{
        id: string;
        type?: string;
        state?: string;
        createdAt?: string;
        finishedAt?: string | null;
        error?: string | null;
        uploaded?: number | null;
        attempted?: number | null;
        input?: PosterSetsJobInput | null;
        setMeta?: PosterSetsSetMeta | null;
    }>;
};

export type PosterSetsPreviewAsset = {
    id: string;
    kind: 'movie' | 'show' | 'collection';
    title: string;
    year?: number | null;
    season?: string | number | null;
    episode?: string | number | null;
    label: string;
    thumbUrl: string;
    matched: boolean;
    matchDetail?: string;
    source?: string;
    /** MediUX filter id when known (title_card, background, season_cover, show_cover). */
    fileType?: string | null;
};

export type PosterSetsPreview = {
    ok?: boolean;
    url?: string;
    movies?: number;
    shows?: number;
    collections?: number;
    total?: number;
    matched?: number;
    unmatched?: number;
    samples?: {
        movies?: string[];
        shows?: string[];
        collections?: string[];
    };
    assets?: PosterSetsPreviewAsset[];
    setMeta?: PosterSetsSetMeta | null;
    logs?: string[];
    error?: string;
};

export type PosterSetsJob = {
    id: string;
    type?: string;
    state?: string;
    createdAt?: string;
    finishedAt?: string | null;
    logs?: Array<{ at?: string; message?: string } | string>;
    result?: Record<string, unknown> | null;
    error?: string | null;
    input?: PosterSetsJobInput | null;
    uploaded?: number | null;
    attempted?: number | null;
    logCount?: number;
    setMeta?: PosterSetsSetMeta | null;
};

export type PosterSetsSearchTitle = {
    id: string;
    title: string;
    year?: number | null;
    url: string;
    mediaType?: string | null;
    thumbUrl?: string;
    provider?: string;
    /** True when this picker row came from (or matched) the Plex/Jellyfin library. */
    inLibrary?: boolean;
    sources?: Array<{
        provider: string;
        id: string;
        url: string;
        mediaType?: string | null;
        year?: number | null;
        thumbUrl?: string;
    }>;
    alsoOn?: Array<{
        provider: string;
        id: string;
        url: string;
        mediaType?: string | null;
        year?: number | null;
        thumbUrl?: string;
    }>;
};

export type PosterSetsSearchSet = {
    setId: string;
    title: string;
    url: string;
    thumbUrl?: string;
    /** Portrait (2/3) preview when the listing also has landscape title-card art. */
    posterThumbUrl?: string;
    /** Landscape (16/9) preview for title cards / backdrops. */
    landscapeThumbUrl?: string;
    user?: string | null;
    posterCount?: number | null;
    provider?: string;
    /** MediUX card kind when known (boxset, title_cards, collection). */
    setKind?: string | null;
    mediaType?: string | null;
    alsoOn?: Array<{
        provider: string;
        setId: string;
        url: string;
        title?: string;
        user?: string | null;
        thumbUrl?: string;
        setKind?: string | null;
    }>;
};

export type PosterSetsBrowseRail = {
    id: string;
    title: string;
    provider?: string;
    kind?: string;
    sets: PosterSetsSearchSet[];
    buffered?: number;
    cap?: number;
    loading?: boolean;
    hasMore?: boolean;
    error?: string | null;
};

export type PosterSetsBrowseResponse = {
    ok?: boolean;
    rails?: PosterSetsBrowseRail[];
    cap?: number;
    error?: string;
};

export type PosterSetsCollectionGroup = {
    user: string;
    sets: PosterSetsSearchSet[];
};

export type PosterSetsCollectionsResponse = {
    ok?: boolean;
    loading?: boolean;
    error?: string | null;
    sets?: PosterSetsSearchSet[];
    groups?: PosterSetsCollectionGroup[];
    buffered?: number;
    usernames?: string[];
    needsFollowers?: boolean;
    updatedAt?: number;
};

export type PosterSetsSearchResult = {
    ok?: boolean;
    provider?: string;
    phase?: 'titles' | 'sets' | string;
    mode?: string;
    query?: string;
    title?: string | null;
    titleUrl?: string;
    titles?: PosterSetsSearchTitle[];
    sets?: PosterSetsSearchSet[];
    dupesCollapsed?: number;
    dupePreference?: string;
    partialErrors?: string[];
    fromCache?: boolean;
    stale?: boolean;
    loading?: boolean;
    error?: string;
    code?: string;
};

export type PosterSetsAuditEntry = {
    id: string;
    at?: string;
    action?: string;
    source?: 'manual' | 'watch' | 'bulk' | 'watcher' | string;
    url?: string | null;
    title?: string | null;
    user?: string | null;
    watchId?: string | null;
    jobId?: string | null;
    uploaded?: number | null;
    attempted?: number | null;
    selectedCount?: number | null;
    checked?: number | null;
    queued?: number | null;
    assetsQueued?: number | null;
    state?: string | null;
    error?: string | null;
    detail?: string | null;
};

export type PosterSetsTitleStatus = {
    title?: string;
    mediaType?: string | null;
    ratingKey?: string | null;
    titleWatch?: {
        enabled?: boolean;
        watchId?: string | null;
        url?: string | null;
        setTitle?: string | null;
        user?: string | null;
    } | null;
    lastApply?: {
        at?: string | null;
        title?: string | null;
        url?: string | null;
        user?: string | null;
        uploaded?: number | null;
        attempted?: number | null;
        source?: string | null;
        jobId?: string | null;
    } | null;
    watches?: Array<{
        id: string;
        enabled?: boolean;
        title?: string | null;
        url?: string | null;
        user?: string | null;
        provider?: string | null;
        lastAppliedAt?: string | null;
        lastCheckedAt?: string | null;
        lastError?: string | null;
    }>;
    watchingCount?: number;
};

export const MEDIUX_FILTER_OPTIONS = [
    { id: 'show_cover', label: 'Show cover' },
    { id: 'season_cover', label: 'Season cover' },
    { id: 'background', label: 'Background' },
    { id: 'title_card', label: 'Title card' },
] as const;

const MEDIUX_FILTER_IDS = new Set(MEDIUX_FILTER_OPTIONS.map((option) => option.id));

/** Infer watch/apply mediux filter ids from the assets the user actually selected. */
export const mediuxFiltersFromAssets = (assets: Array<Partial<PosterSetsPreviewAsset> | null | undefined>) => {
    const filters = new Set<string>();
    for (const asset of assets) {
        if (!asset) continue;
        const explicit = String(asset.fileType || '').trim().toLowerCase();
        if (explicit === 'backdrop' || explicit === 'background') {
            filters.add('background');
            continue;
        }
        if (MEDIUX_FILTER_IDS.has(explicit as typeof MEDIUX_FILTER_OPTIONS[number]['id'])) {
            filters.add(explicit);
            continue;
        }
        if (asset.season === 'Backdrop') {
            filters.add('background');
            continue;
        }
        if (asset.kind !== 'show') continue;
        const season = asset.season;
        const episode = asset.episode;
        if (season === 'Cover') filters.add('show_cover');
        else if (season === 'Backdrop') filters.add('background');
        else if (episode === 'Cover' || episode == null || episode === '') filters.add('season_cover');
        else filters.add('title_card');
    }
    return MEDIUX_FILTER_OPTIONS.map((option) => option.id).filter((id) => filters.has(id));
};

export const DEFAULT_POSTER_SETS_CONFIG: PosterSetsConfig = {
    base_url: '',
    token: '',
    bulk_txt: 'bulk_import.txt',
    tv_library: ['TV Shows'],
    movie_library: ['Movies'],
    mediux_filters: ['title_card', 'background', 'season_cover', 'show_cover'],
    reset_overlay: true,
    dupePreference: 'posterdb',
    watchersEnabled: true,
    watchIntervalHours: 6,
    autoWatchOnApply: true,
    notifyOnWatcherDigest: true,
    arrWatchHookEnabled: true,
    creatorWhitelist: [],
    creatorBlocklist: [],
    applyDestination: 'plex',
    tpdbLocalCacheEnabled: false,
    tpdbAggressivePrefetch: false,
    tpdbWarmParallelWorkers: false,
    tpdbPrioritizeFollowedCreators: true,
    tpdbCacheFollowedCreatorsOnly: false,
    tpdbUseLogin: true,
    tpdbEnabled: true,
    tpdbSearchEnabled: true,
    copyLibraryTitleEnabled: true,
    mediuxEnabled: true,
    tpdbCacheMaxBytes: 2 * 1024 * 1024 * 1024,
    tpdbCacheRefreshHour: 3,
    tpdbCacheRefreshIntervalHours: 0,
    tpdbCacheWarmMedia: 'all',
    tpdbCacheWarmSource: 'full',
    tpdbCacheSkipCached: true,
    tpdbCacheOnLibraryAdd: true,
    tpdbFirstRunBackfillDone: false,
    webhookToken: '',
};
