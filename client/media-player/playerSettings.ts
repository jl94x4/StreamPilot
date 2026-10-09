export type PlayerSubtitleMode = 'off' | 'forced' | 'always';

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
    showContinueWatching: boolean;
    /** Portrait posters vs widescreen episode-style cards on Continue Watching rows. */
    continueWatchingLayout: PlayerContinueWatchingLayout;
    showPlaylists: boolean;
    showBecauseYouWatched: boolean;
    defaultQualityId: string;
    audioLanguage: string;
    subtitleMode: PlayerSubtitleMode;
    autoSkipIntro: boolean;
    autoSkipCredits: boolean;
    playThemeTunes: boolean;
    /** Grey plate behind studio / network / streaming logos on overview. */
    serviceLogoPlates: boolean;
    /** Resolution / codec pills on season episode cards. */
    showEpisodeFilePills: boolean;
    /** Corner for watched checkmarks on movie/show/season posters (not episodes). */
    watchedTickPosition: PlayerWatchedTickPosition;
    /** Phone overview: poster on the still instead of the clear logo. */
    phoneOverviewPoster: boolean;
    homeRowOrder: string[];
    libraryNavOrder: string[];
    nightMode: boolean;
    matchFrameRate: boolean;
    /** HDMI bitstream of DD/DTS/TrueHD when the sink supports it. */
    audioPassthrough: boolean;
    cinemaTrailers: boolean;
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

export const PLAYER_HOME_ROW_IDS = ['continueWatching', 'recents', 'playlists'] as const;
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
    const blob = `${hub.identifier || ''} ${hub.title || ''}`.toLowerCase();
    if (/continue\s*watch|ondeck|on[.\s_-]?deck|in[.\s_-]?progress/.test(blob)) return 'continueWatching';
    if (/because\s+you\s+watched/.test(blob) || /^because:/.test(String(hub.identifier || ''))) return 'becauseYouWatched';
    if (hub.playlistRatingKey || /playlist/.test(blob)) return 'playlist';
    if (/(^|[.\s_-])(tv|show)([.\s_-]|$)/.test(blob) || /\b(series|episode)\b/.test(blob)) return 'show';
    if (/(^|[.\s_-])(music|artist|album|track|audio)([.\s_-]|$)/.test(blob)) return 'artist';
    if (/(^|[.\s_-])(movie|film)([.\s_-]|$)/.test(blob)) return 'movie';
    const counts: Record<'movie' | 'show' | 'artist', number> = { movie: 0, show: 0, artist: 0 };
    for (const item of hub.items || []) {
        const kind = normalizeLibraryMediaType(item?.type);
        if (kind) counts[kind] += 1;
    }
    const ranked = (Object.entries(counts) as Array<['movie' | 'show' | 'artist', number]>)
        .sort((a, b) => b[1] - a[1]);
    if (ranked[0]?.[1]) return ranked[0][0];
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
    showContinueWatching: true,
    continueWatchingLayout: 'poster',
    showPlaylists: true,
    showBecauseYouWatched: true,
    defaultQualityId: 'auto',
    audioLanguage: '',
    subtitleMode: 'forced',
    autoSkipIntro: false,
    autoSkipCredits: false,
    playThemeTunes: true,
    serviceLogoPlates: true,
    showEpisodeFilePills: true,
    watchedTickPosition: 'top-right',
    phoneOverviewPoster: false,
    homeRowOrder: [],
    libraryNavOrder: [],
    nightMode: false,
    matchFrameRate: true,
    audioPassthrough: true,
    cinemaTrailers: false,
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
        showContinueWatching: raw?.showContinueWatching !== false,
        continueWatchingLayout: isPlayerContinueWatchingLayout(raw?.continueWatchingLayout)
            ? raw.continueWatchingLayout
            : 'poster',
        showPlaylists: raw?.showPlaylists !== false,
        showBecauseYouWatched: raw?.showBecauseYouWatched !== false,
        defaultQualityId: QUALITY_IDS.has(quality) ? quality : 'auto',
        audioLanguage: /^[a-z]{2}(?:-[a-z]{2})?$/.test(audioLanguage) ? audioLanguage : '',
        subtitleMode: SUBTITLE_MODES.has(subtitleMode) ? subtitleMode : 'forced',
        autoSkipIntro: raw?.autoSkipIntro === true,
        autoSkipCredits: raw?.autoSkipCredits === true,
        playThemeTunes: raw?.playThemeTunes !== false,
        serviceLogoPlates: raw?.serviceLogoPlates !== false,
        showEpisodeFilePills: raw?.showEpisodeFilePills !== false,
        watchedTickPosition: isPlayerWatchedTickPosition(raw?.watchedTickPosition)
            ? raw!.watchedTickPosition as PlayerWatchedTickPosition
            : 'top-right',
        phoneOverviewPoster: raw?.phoneOverviewPoster === true,
        homeRowOrder: collapseHomeRowOrder(raw?.homeRowOrder),
        libraryNavOrder: normalizeLibraryNavOrder(
            Array.isArray(raw?.libraryNavOrder) && raw.libraryNavOrder.length
                ? raw.libraryNavOrder
                : libraryNavOrderFromHomeRows(raw?.homeRowOrder),
        ),
        nightMode: raw?.nightMode === true,
        matchFrameRate: raw?.matchFrameRate !== false,
        audioPassthrough: raw?.audioPassthrough !== false,
        cinemaTrailers: raw?.cinemaTrailers === true,
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
    && a.showContinueWatching === b.showContinueWatching
    && a.continueWatchingLayout === b.continueWatchingLayout
    && a.showPlaylists === b.showPlaylists
    && a.showBecauseYouWatched === b.showBecauseYouWatched
    && a.defaultQualityId === b.defaultQualityId
    && a.audioLanguage === b.audioLanguage
    && a.subtitleMode === b.subtitleMode
    && a.autoSkipIntro === b.autoSkipIntro
    && a.autoSkipCredits === b.autoSkipCredits
    && a.playThemeTunes === b.playThemeTunes
    && a.serviceLogoPlates === b.serviceLogoPlates
    && a.showEpisodeFilePills === b.showEpisodeFilePills
    && a.watchedTickPosition === b.watchedTickPosition
    && a.phoneOverviewPoster === b.phoneOverviewPoster
    && a.homeRowOrder.join('\0') === b.homeRowOrder.join('\0')
    && a.libraryNavOrder.join('\0') === b.libraryNavOrder.join('\0')
    && a.nightMode === b.nightMode
    && a.matchFrameRate === b.matchFrameRate
    && a.audioPassthrough === b.audioPassthrough
    && a.cinemaTrailers === b.cinemaTrailers
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
