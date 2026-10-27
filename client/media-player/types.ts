export type PlayerRatingScore = {
    value: number;
    percent: number | null;
    url?: string | null;
    fresh?: boolean;
};

export type PlayerRatings = {
    imdb: PlayerRatingScore | null;
    rottenTomatoes: PlayerRatingScore | null;
    popcorn: PlayerRatingScore | null;
    tmdb: PlayerRatingScore | null;
    tvdb?: PlayerRatingScore | null;
};

export type PlayerMediaStreamInfo = {
    id?: string | null;
    codec?: string | null;
    bitrate?: number | null;
    width?: number | null;
    height?: number | null;
    resolution?: string | null;
    frameRate?: string | null;
    profile?: string | null;
    level?: string | null;
    bitDepth?: number | null;
    chromaLocation?: string | null;
    codedHeight?: number | null;
    displayTitle?: string | null;
    aspectRatio?: string | null;
    /** Transfer characteristics (smpte2084 / arib-std-b67, …). */
    colorTrc?: string | null;
    colorPrimaries?: string | null;
    /** Plex Dolby Vision flag on the video stream. */
    DOVIPresent?: boolean | null;
    DOVIProfile?: number | string | null;
    videoDynamicRange?: string | null;
    videoDynamicRangeType?: string | null;
    channels?: number | null;
    channelLayout?: string | null;
    samplingRate?: number | null;
    language?: string | null;
    languageTag?: string | null;
    selected?: boolean;
    forced?: boolean;
};

export type PlayerMediaPartInfo = {
    id: string;
    fileName: string;
    size: number | null;
    container: string | null;
    durationMs: number | null;
    video: PlayerMediaStreamInfo;
    audio: PlayerMediaStreamInfo[];
    subtitles: PlayerMediaStreamInfo[];
};

export type PlayerMediaInfo = {
    id: string;
    container: string | null;
    bitrate: number | null;
    width: number | null;
    height: number | null;
    videoResolution: string | null;
    scanType?: string | null;
    videoCodec: string | null;
    audioCodec: string | null;
    audioChannels: number | null;
    durationMs: number | null;
    parts: PlayerMediaPartInfo[];
};

export type PlayerPersonCredit = {
    id: string;
    name: string;
    role: string;
    thumb?: string | null;
};

export type PlayerCollectionRef = {
    ratingKey: string;
    title: string;
};

export type PlayerItem = {
    ratingKey: string;
    title: string;
    showTitle?: string | null;
    seasonTitle?: string | null;
    type: string;
    year?: number | null;
    summary?: string;
    thumb?: string | null;
    /** Episode still path before Continue Watching poster swap (server). */
    episodeThumb?: string | null;
    /** Episode name before Continue Watching show-title swap (server). */
    episodeTitle?: string | null;
    /** Unix stamp from Plex show/season thumb path — busts poster caches after art swaps. */
    thumbUpdatedAt?: number | null;
    /** Force rail/card shape (recently added TV uses show posters). */
    cardAspect?: '2/3' | 'square' | '16/9';
    /** Home row uses the title background with a year or season count caption. */
    heroCard?: boolean;
    /** Plex coverArt, the designed 16:9 hero Replex uses. */
    heroArt?: string | null;
    /** Continue Watching poster uses the season art instead of the show art. */
    preferSeasonPoster?: boolean;
    /** Dedupe recently-added TV by show while keeping the episode ratingKey. */
    dedupeKey?: string | null;
    art?: string | null;
    logo?: string | null;
    themeKey?: string | null;
    /** Direct app: playable theme URL straight from PMS (the portal uses /theme/:key). */
    themeUrl?: string | null;
    durationMs?: number | null;
    viewOffsetMs?: number;
    index?: number | null;
    parentIndex?: number | null;
    leafCount?: number | null;
    childCount?: number | null;
    parentRatingKey?: string | null;
    grandparentRatingKey?: string | null;
    contentRating?: string | null;
    audienceRating?: number | null;
    /** Common Sense Media age badge from Plex (movies/shows; inherited on episodes). */
    commonSenseMedia?: {
        age: number | null;
        ageLabel: string | null;
        stars: number | null;
        ageGroup?: string | null;
        oneLiner?: string | null;
    } | null;
    /** Plex user rating 1–10 (UI shows 5 stars). */
    userRating?: number | null;
    originallyAvailableAt?: string | null;
    /** Continue Watching (direct): air date (ms) of the show's newest episode, for Latest released. */
    showLatestAiredAt?: number | null;
    tmdbId?: number | null;
    showTmdbId?: number | null;
    /** Plex Studio / Network / Label tags (search/filters). */
    studioLabels?: string[];
    /** Plex Network tags only — same facet as Advanced Filters (TV billboard logos). */
    networkLabels?: string[];
    genres?: string[];
    countries?: string[];
    collections?: string[];
    collectionItems?: PlayerCollectionRef[];
    addedAt?: number | null;
    lastViewedAt?: number | null;
    viewedLeafCount?: number | null;
    extraType?: string | null;
    extraSubtype?: string | null;
    watchlisted?: boolean;
    discoverRatingKey?: string | null;
    plexGuid?: string | null;
    /** Show guid for episode/season watchlist actions (`plex://show/...`). */
    showPlexGuid?: string | null;
    chapters?: PlayerChapter[];
    frameRate?: number | null;
    plexUrl?: string | null;
    canPlay?: boolean;
    liveChannelId?: string | null;
    liveChannelNumber?: string | null;
    liveChannelTitle?: string | null;
    liveDvrId?: string | null;
    liveStartsAt?: number | null;
    liveEndsAt?: number | null;
    liveSessionId?: string | null;
    /** Guide: first showing (PMS Media premiere). */
    liveIsNew?: boolean;
    /** Guide: the channel's picture height, e.g. "1080". */
    liveResolution?: string | null;
    viewCount?: number;
    watched?: boolean;
    playlistType?: string;
    smart?: boolean;
    tagline?: string;
    studio?: string;
    studioKey?: string;
    librarySectionID?: string | null;
    /** Direct Plex client: which Media Server owns this item. */
    serverId?: string | null;
    /** Search/person credits: Plex actor/person id when type is person. */
    personId?: string | null;
    personName?: string | null;
    directors?: string[];
    writers?: string[];
    directorPeople?: PlayerPersonCredit[];
    writerPeople?: PlayerPersonCredit[];
    producers?: PlayerPersonCredit[];
    cast?: PlayerPersonCredit[];
    guestStars?: PlayerPersonCredit[];
    ratings?: PlayerRatings;
    mediaInfo?: PlayerMediaInfo[];
    versions?: PlayerVersion[];
    markers?: PlayerMarkers;
    externalIds?: { imdb: string | null; tmdb: number | null; tvdb: string | null };
};

export type PlayerMarker = {
    startMs: number;
    endMs: number;
};

export type PlayerMarkers = {
    intro: PlayerMarker | null;
    credits: PlayerMarker | null;
};

export type PlayerChapter = {
    startMs: number;
    endMs?: number;
    title: string;
    index?: number;
};

export type PlayerVersion = {
    id: string;
    mediaIndex: number;
    label: string;
    resolution?: string | null;
    scanType?: string | null;
    videoCodec?: string | null;
    audioCodec?: string | null;
    container?: string | null;
    bitrate?: number | null;
    width?: number | null;
    height?: number | null;
};

export type PlayerPersonPage = {
    person: { id: string; name: string; thumb?: string | null };
    items: PlayerItem[];
    profile?: PlayerPersonProfile | null;
};

export type PlayerPersonProfile = {
    name?: string | null;
    tmdbId?: number | null;
    biography?: string | null;
    birthday?: string | null;
    deathday?: string | null;
    knownForDepartment?: string | null;
    placeOfBirth?: string | null;
    placeOfDeath?: string | null;
    profilePath?: string | null;
};

export type PlayerPersonCreditRow = {
    id: string;
    title: string;
    year?: string | null;
    mediaType?: 'movie' | 'tv' | string | null;
    role?: string | null;
    department?: 'cast' | 'crew' | string | null;
    posterPath?: string | null;
    onServer?: boolean;
    ratingKey?: string | null;
};

export type PlayerPersonBundle = {
    person: { name: string; thumb?: string | null };
    items: PlayerItem[];
    profile: PlayerPersonProfile | null;
    filmography?: PlayerPersonCreditRow[];
};

export type PlayerSection = {
    key: string;
    title: string;
    type: string;
    agent?: string;
    thumb?: string | null;
    /** Owning PMS id — used for offline marks when multiple servers are enabled. */
    serverId?: string | null;
    serverName?: string | null;
};

export type PlayerProfile = {
    username: string;
    thumb?: string | null;
    isAdmin?: boolean;
};

export type PlayerHomeRail = {
    library: PlayerSection;
    items: PlayerItem[];
};

export type PlayerLibraryHub = {
    title: string;
    identifier: string;
    items: PlayerItem[];
    hubKey?: string | null;
    collectionRatingKey?: string | null;
    playlistRatingKey?: string | null;
    /** Plex collection labels (used to merge same-label home rows). */
    labels?: string[];
    /** Pinned collection labeled Heros or Heroes. */
    heroRow?: boolean;
    /** Plex row or collection is sorted randomly. */
    randomOrder?: boolean;
};

export type PlayerHome = {
    libraries: PlayerSection[];
    continueWatching: PlayerItem[];
    recentByLibrary: PlayerHomeRail[];
    playlists?: PlayerItem[];
    hubs?: PlayerLibraryHub[];
    /** Direct mode painted Continue Watching / Recently Added before Plex hubs arrived. */
    partial?: boolean;
    /**
     * Full home pass finished attaching "Because you watched" (even if Plex returned none).
     * Missing this means Home should still run `?full=1` when the setting is on.
     */
    becauseAttached?: boolean;
};

export type PlayerLibraryHome = {
    title: string;
    type: string;
    hubs: PlayerLibraryHub[];
};

export type PlayerLibraryFilterOption = { key: string; title: string };

export type PlayerStudioBrowseCard = {
    key: string;
    title: string;
    logoPath?: string | null;
    art?: string | null;
    thumb?: string | null;
};

export type PlayerLibraryStudios = {
    networks: PlayerStudioBrowseCard[];
    studios: PlayerStudioBrowseCard[];
};

export type PlayerLibraryFilters = {
    genres: PlayerLibraryFilterOption[];
    decades?: PlayerLibraryFilterOption[];
    years?: PlayerLibraryFilterOption[];
    contentRatings?: PlayerLibraryFilterOption[];
    resolutions?: PlayerLibraryFilterOption[];
    studios?: PlayerLibraryFilterOption[];
    networks?: PlayerLibraryFilterOption[];
    countries?: PlayerLibraryFilterOption[];
    collections?: PlayerLibraryFilterOption[];
    audioLanguages?: PlayerLibraryFilterOption[];
    subtitleLanguages?: PlayerLibraryFilterOption[];
    actors?: PlayerLibraryFilterOption[];
    directors?: PlayerLibraryFilterOption[];
    writers?: PlayerLibraryFilterOption[];
    producers?: PlayerLibraryFilterOption[];
    labels?: PlayerLibraryFilterOption[];
    letters?: PlayerLibraryFilterOption[];
};

export type PlayerLibraryPage = {
    title: string;
    type: string;
    total: number;
    /** Absolute library index of items[0] in the title-sorted list. */
    offset?: number;
    items: PlayerItem[];
};

export type PlayerItemPage = {
    item: PlayerItem;
    children: PlayerItem[];
    extras?: PlayerItem[];
    related?: PlayerLibraryHub[];
    onDeck?: PlayerItem | null;
};

export type PlayerStudioPage = {
    studio: { key: string; name: string };
    items: PlayerItem[];
};

export type PlayerQualityOption = {
    id: string;
    label: string;
    videoResolution: string;
    maxVideoBitrate: number;
    videoQuality: number;
};

export type PlayerAudioTrack = {
    id: string;
    label: string;
    language?: string | null;
    languageTag?: string | null;
    codec?: string | null;
    channels?: number | null;
    selected?: boolean;
};

export type PlayerSubtitleTrack = {
    id: string;
    label: string;
    language?: string | null;
    languageTag?: string | null;
    codec?: string | null;
    forced?: boolean;
    selected?: boolean;
    /** Index among subtitles muxed into the file (null for sidecar files). */
    embeddedOrdinal?: number | null;
    /** Direct URL for a sidecar file so Exo can overlay it without a transcode. */
    url?: string | null;
};

export type PlayerPlaybackMode = 'directPlay' | 'directStream' | 'transcode';

export type PlayerPlaybackSource = {
    videoCodec?: string | null;
    audioCodec?: string | null;
    container?: string | null;
    height?: number | null;
    width?: number | null;
    videoResolution?: string | null;
    bitrate?: number | null;
};

export type PlayerPlaySession = {
    sessionId: string;
    item: PlayerItem;
    src: string;
    offsetMs: number;
    qualities?: PlayerQualityOption[];
    qualityId?: string;
    canDirectPlay?: boolean;
    canCopyOriginal?: boolean;
    audioTracks?: PlayerAudioTrack[];
    audioStreamId?: string | null;
    subtitles?: PlayerSubtitleTrack[];
    subtitleStreamId?: string | null;
    mediaIndex?: number;
    versions?: PlayerVersion[];
    markers?: PlayerMarkers;
    previewThumbTemplate?: string | null;
    playbackMode?: PlayerPlaybackMode;
    source?: PlayerPlaybackSource;
    client?: 'web' | 'android' | 'ios';
    /** Phone offline download — local file://, skip network timeline. */
    offlineLocal?: boolean;
    live?: boolean;
    /** Token-redacted live tune / playlist probe for the player error overlay. */
    liveDebug?: string;
};

export type PlayerPlayOptions = {
    offsetMs?: number | null;
    qualityId?: string;
    mediaIndex?: number;
    skipResume?: boolean;
    audioStreamId?: string | null;
    subtitleStreamId?: string | null;
    shuffle?: boolean;
    /** Show/season: shuffle only unwatched (and in-progress) leaves. */
    shuffleUnwatched?: boolean;
    playFromHere?: boolean;
    /** Episode/track: play from here, skip later watched leaves, cross seasons for shows. */
    playUnwatchedFromHere?: boolean;
    queue?: PlayerItem[];
    /** Next episode started by autoplay, not a user Play press. */
    fromAutoplay?: boolean;
    /** Watch Together invite — play host library via portal WT stream gate. */
    watchTogether?: string | null;
    /** Prefer completed in-app offline download (phone). */
    offlineLocal?: boolean;
};
