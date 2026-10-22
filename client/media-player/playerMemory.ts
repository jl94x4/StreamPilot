import { useEffect, useState } from 'react';
import { PLAYER_SCROLL_ID } from './paths';
import { pushRecentSearch } from './recentSearch.js';
import type { PlayerHome, PlayerItem, PlayerItemPage, PlayerSection } from './types';

export { pushRecentSearch };

export const PLAYER_SEARCH_INPUT_ID = 'media-player-search';
export const PLAYER_FOCUS_SEARCH_KEY = 'portal-media-player-focus-search';
export const PLAYER_HOME_SCROLL_KEY = 'portal-media-player-home-scroll';
export const PLAYER_LIBRARY_SCROLL_KEY = 'portal-media-player-library-scroll';
export const PLAYER_LAST_LIBRARY_PATH_KEY = 'portal-media-player-last-library-path';
export const PLAYER_VOICE_RESULT_EVENT = 'smp-player-voice-result';
export const PLAYER_SEARCH_CLEAR_EVENT = 'smp-player-search-clear';
export const PLAYER_RECENT_SEARCHES_KEY = 'portal-media-player-recent-searches-v1';
export const PLAYER_LOCAL_PLAYBACK_KEY = 'portal-media-player-local-playback';
export const PLAYER_LIBRARY_STATE_KEY = 'portal-media-player-library-state-v2';
export const PLAYER_MINI_WIDTH_KEY = 'portal-media-player-mini-width';
export const PLAYER_NAV_EXPANDED_KEY = 'portal-media-player-nav-expanded';
export const PLAYER_AV_CHOICES_KEY = 'portal-media-player-av-choices';
export const PLAYER_MEDIA_INDEX_KEY = 'portal-media-player-media-index-v1';
export const PLAYER_TV_FOCUS_KEY = 'portal-media-player-tv-focus-v1';
export const PLAYER_LONG_PRESS_HINT_KEY = 'portal-media-player-long-press-hint-v1';
export const PLAYER_APK_WHATS_NEW_KEY = 'portal-media-player-apk-whats-new-v1';

export type LocalPlaybackPrefs = {
    volume: number;
    muted: boolean;
    speed: number;
};

export type LibraryBrowseState = {
    sort: string;
    genre: string;
    decade: string;
    year: string;
    contentRating: string;
    resolution: string;
    studio: string;
    network: string;
    country: string;
    collection: string;
    audioLanguage: string;
    subtitleLanguage: string;
    actor: string;
    director: string;
    writer: string;
    producer: string;
    label: string;
    unwatched: boolean;
    inProgress: boolean;
    hdr: boolean;
    duplicate: boolean;
};

const DEFAULT_PLAYBACK: LocalPlaybackPrefs = { volume: 1, muted: false, speed: 1 };
export const DEFAULT_MINI_PLAYER_WIDTH = 352;
export const MIN_MINI_PLAYER_WIDTH = 260;
const DEFAULT_LIBRARY: LibraryBrowseState = {
    sort: 'titleSort',
    genre: '',
    decade: '',
    year: '',
    contentRating: '',
    resolution: '',
    studio: '',
    network: '',
    country: '',
    collection: '',
    audioLanguage: '',
    subtitleLanguage: '',
    actor: '',
    director: '',
    writer: '',
    producer: '',
    label: '',
    unwatched: false,
    inProgress: false,
    hdr: false,
    duplicate: false,
};

const readJson = (key: string): unknown => {
    if (typeof window === 'undefined') return null;
    try {
        const raw = window.localStorage.getItem(key) ?? window.sessionStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
};

const writeJson = (storage: Storage, key: string, value: unknown) => {
    try {
        storage.setItem(key, JSON.stringify(value));
    } catch {
        /* quota / private mode */
    }
};

export const readRecentSearches = (): string[] => {
    const raw = readJson(PLAYER_RECENT_SEARCHES_KEY);
    return pushRecentSearch(Array.isArray(raw) ? raw as string[] : [], '');
};

export const rememberRecentSearch = (query: string): string[] => {
    const next = pushRecentSearch(readRecentSearches(), query);
    if (typeof window !== 'undefined') writeJson(window.localStorage, PLAYER_RECENT_SEARCHES_KEY, next);
    return next;
};

export const readLocalPlaybackPrefs = (): LocalPlaybackPrefs => {
    const raw = readJson(PLAYER_LOCAL_PLAYBACK_KEY) as Partial<LocalPlaybackPrefs> | null;
    const volume = Number(raw?.volume);
    const speed = Number(raw?.speed);
    return {
        volume: Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : DEFAULT_PLAYBACK.volume,
        muted: raw?.muted === true,
        speed: Number.isFinite(speed) && speed > 0 ? Math.min(3, Math.max(0.25, speed)) : DEFAULT_PLAYBACK.speed,
    };
};

export type PlayerAvChoice = {
    audioStreamId: string;
    subtitleStreamId: string;
    /** Preferred language tag/name — rematched across episodes of the same show. */
    audioLanguage?: string;
    subtitleLanguage?: string;
    /** Per-show A/V lip-sync delay (ms) remembered across episodes. */
    audioDelayMs?: number;
};

type AvLangTrack = {
    id?: string | null;
    language?: string | null;
    languageTag?: string | null;
    label?: string | null;
    displayTitle?: string | null;
};

const avChoiceKey = (showKey?: string | null, ratingKey?: string | null) => (
    String(showKey || ratingKey || '').replace(/\D/g, '')
);

const normalizeAvLang = (value?: string | null) => (
    String(value || '').trim().toLowerCase().replace(/_/g, '-')
);

/** Match eng/en/English style tags across episodes (stream IDs change per file). */
export const playerAvLanguageMatches = (trackLanguage?: string | null, preferred?: string | null) => {
    const pref = normalizeAvLang(preferred);
    const lang = normalizeAvLang(trackLanguage);
    if (!pref || !lang) return false;
    const prefBase = pref.split('-')[0];
    const langBase = lang.split('-')[0];
    if (lang === pref || langBase === prefBase) return true;
    const aliases: Record<string, string[]> = {
        en: ['en', 'eng', 'english'],
        es: ['es', 'spa', 'spanish', 'español', 'espanol'],
        fr: ['fr', 'fra', 'fre', 'french', 'français', 'francais'],
        de: ['de', 'deu', 'ger', 'german', 'deutsch'],
        ja: ['ja', 'jpn', 'japanese'],
        ko: ['ko', 'kor', 'korean'],
        zh: ['zh', 'chi', 'zho', 'chinese', 'mandarin', 'cantonese'],
        pt: ['pt', 'por', 'portuguese', 'português', 'portugues'],
        it: ['it', 'ita', 'italian', 'italiano'],
        ru: ['ru', 'rus', 'russian'],
    };
    const list = aliases[prefBase] || [prefBase];
    return list.includes(lang) || list.includes(langBase);
};

const trackLangBlob = (track?: AvLangTrack | null) => (
    String(track?.languageTag || track?.language || track?.label || track?.displayTitle || '').trim()
);

const findTrackByLanguage = (tracks: AvLangTrack[], preferred?: string | null) => {
    const want = normalizeAvLang(preferred);
    if (!want || !tracks.length) return null;
    return tracks.find((row) => (
        playerAvLanguageMatches(row.languageTag, want)
        || playerAvLanguageMatches(row.language, want)
        || playerAvLanguageMatches(trackLangBlob(row), want)
    )) || null;
};

export const readAvChoice = (showKey?: string | null, ratingKey?: string | null): PlayerAvChoice | null => {
    const key = avChoiceKey(showKey, ratingKey);
    if (!key) return null;
    const all = readJson(PLAYER_AV_CHOICES_KEY) as Record<string, PlayerAvChoice> | null;
    const row = all?.[key];
    if (!row || typeof row !== 'object') return null;
    const delay = Number(row.audioDelayMs);
    return {
        audioStreamId: String(row.audioStreamId || ''),
        subtitleStreamId: String(row.subtitleStreamId || ''),
        audioLanguage: String(row.audioLanguage || ''),
        subtitleLanguage: String(row.subtitleLanguage || ''),
        audioDelayMs: Number.isFinite(delay) ? Math.max(0, Math.min(1000, Math.round(delay))) : undefined,
    };
};

/** Resolve saved show prefs onto this episode's stream IDs (language first, then legacy IDs). */
export const resolveAvChoiceForTracks = (
    saved: PlayerAvChoice | null | undefined,
    audioTracks: AvLangTrack[] = [],
    subtitleTracks: AvLangTrack[] = [],
): { audioStreamId?: string; subtitleStreamId?: string } => {
    if (!saved) return {};
    const audioByLang = findTrackByLanguage(audioTracks, saved.audioLanguage);
    const audioById = saved.audioStreamId
        ? audioTracks.find((row) => String(row.id || '') === String(saved.audioStreamId))
        : null;
    const subOff = saved.subtitleStreamId === '0' || saved.subtitleLanguage === 'off';
    const subByLang = !subOff ? findTrackByLanguage(subtitleTracks, saved.subtitleLanguage) : null;
    const subById = !subOff && saved.subtitleStreamId
        ? subtitleTracks.find((row) => String(row.id || '') === String(saved.subtitleStreamId))
        : null;
    const out: { audioStreamId?: string; subtitleStreamId?: string } = {};
    const audioId = String(audioByLang?.id || audioById?.id || '');
    if (audioId) out.audioStreamId = audioId;
    if (subOff) out.subtitleStreamId = '0';
    else {
        const subId = String(subByLang?.id || subById?.id || '');
        if (subId) out.subtitleStreamId = subId;
        else if (saved.subtitleLanguage || saved.subtitleStreamId) {
            // Remembered a track that is missing on this file — leave unset so defaults apply.
        }
    }
    return out;
};

export const writeAvChoice = (
    showKey: string | null | undefined,
    ratingKey: string | null | undefined,
    choice: PlayerAvChoice,
) => {
    const key = avChoiceKey(showKey, ratingKey);
    if (!key || typeof window === 'undefined') return;
    const all = (readJson(PLAYER_AV_CHOICES_KEY) as Record<string, PlayerAvChoice> | null) || {};
    const delay = Number(choice.audioDelayMs);
    all[key] = {
        audioStreamId: String(choice.audioStreamId || ''),
        subtitleStreamId: String(choice.subtitleStreamId || ''),
        audioLanguage: String(choice.audioLanguage || ''),
        subtitleLanguage: String(choice.subtitleLanguage || ''),
        ...(Number.isFinite(delay)
            ? { audioDelayMs: Math.max(0, Math.min(1000, Math.round(delay))) }
            : {}),
    };
    writeJson(window.localStorage, PLAYER_AV_CHOICES_KEY, all);
};

/** Persist A/V delay for a show without clobbering saved stream choices. */
export const writeAvDelayChoice = (
    showKey: string | null | undefined,
    ratingKey: string | null | undefined,
    audioDelayMs: number,
) => {
    const existing = readAvChoice(showKey, ratingKey) || {
        audioStreamId: '',
        subtitleStreamId: '',
    };
    writeAvChoice(showKey, ratingKey, {
        ...existing,
        audioDelayMs: Math.max(0, Math.min(1000, Math.round(Number(audioDelayMs) || 0))),
    });
};

/** Persist stream IDs plus language tags so the next episode can rematch. */
export const writeAvChoiceFromTracks = (
    showKey: string | null | undefined,
    ratingKey: string | null | undefined,
    audioStreamId: string,
    subtitleStreamId: string,
    audioTracks: AvLangTrack[] = [],
    subtitleTracks: AvLangTrack[] = [],
) => {
    const audio = audioTracks.find((row) => String(row.id || '') === String(audioStreamId || ''));
    const subId = String(subtitleStreamId || '');
    const subOff = !subId || subId === '0';
    const sub = !subOff
        ? subtitleTracks.find((row) => String(row.id || '') === subId)
        : null;
    writeAvChoice(showKey, ratingKey, {
        audioStreamId: String(audioStreamId || ''),
        subtitleStreamId: subOff ? '0' : subId,
        audioLanguage: trackLangBlob(audio) || '',
        subtitleLanguage: subOff ? 'off' : (trackLangBlob(sub) || ''),
    });
};

const mediaIndexChoiceKey = (ratingKey?: string | null) => String(ratingKey || '').replace(/\D/g, '');

/** Last picked file/version index for a title (multi-version movies/episodes). */
export const readMediaIndexChoice = (ratingKey?: string | null): number | null => {
    const key = mediaIndexChoiceKey(ratingKey);
    if (!key) return null;
    const all = readJson(PLAYER_MEDIA_INDEX_KEY) as Record<string, number> | null;
    const value = Number(all?.[key]);
    return Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
};

export const writeMediaIndexChoice = (ratingKey: string | null | undefined, mediaIndex: number) => {
    const key = mediaIndexChoiceKey(ratingKey);
    if (!key || typeof window === 'undefined') return;
    const index = Math.max(0, Math.floor(Number(mediaIndex) || 0));
    const all = (readJson(PLAYER_MEDIA_INDEX_KEY) as Record<string, number> | null) || {};
    all[key] = index;
    writeJson(window.localStorage, PLAYER_MEDIA_INDEX_KEY, all);
};

export type PersistedTvFocus = {
    byPath: Record<string, { key: string; railScroll?: number }>;
    byRow: Record<string, { key: string; railScroll?: number }>;
};

export const readPersistedTvFocus = (): PersistedTvFocus => {
    const raw = readJson(PLAYER_TV_FOCUS_KEY) as PersistedTvFocus | null;
    return {
        byPath: raw?.byPath && typeof raw.byPath === 'object' ? raw.byPath : {},
        byRow: raw?.byRow && typeof raw.byRow === 'object' ? raw.byRow : {},
    };
};

export const writePersistedTvFocus = (value: PersistedTvFocus) => {
    if (typeof window === 'undefined') return;
    writeJson(window.localStorage, PLAYER_TV_FOCUS_KEY, {
        byPath: value.byPath || {},
        byRow: value.byRow || {},
    });
};

export const readLongPressHintSeen = () => {
    if (typeof window === 'undefined') return true;
    try {
        return window.localStorage.getItem(PLAYER_LONG_PRESS_HINT_KEY) === '1';
    } catch {
        return true;
    }
};

export const writeLongPressHintSeen = () => {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(PLAYER_LONG_PRESS_HINT_KEY, '1');
    } catch {
        /* ignore */
    }
};

export const readApkWhatsNewSeen = (): string => {
    if (typeof window === 'undefined') return '';
    try {
        return String(window.localStorage.getItem(PLAYER_APK_WHATS_NEW_KEY) || '');
    } catch {
        return '';
    }
};

export const writeApkWhatsNewSeen = (version: string) => {
    if (typeof window === 'undefined' || !version) return;
    try {
        window.localStorage.setItem(PLAYER_APK_WHATS_NEW_KEY, version);
    } catch {
        /* ignore */
    }
};

export const writeLocalPlaybackPrefs = (prefs: LocalPlaybackPrefs) => {
    if (typeof window === 'undefined') return;
    writeJson(window.localStorage, PLAYER_LOCAL_PLAYBACK_KEY, {
        volume: Math.min(1, Math.max(0, Number(prefs.volume) || 0)),
        muted: prefs.muted === true,
        speed: Math.min(3, Math.max(0.25, Number(prefs.speed) || 1)),
    });
};

export const clampMiniPlayerWidth = (width: number, viewportWidth = typeof window === 'undefined' ? 1280 : window.innerWidth) => {
    const max = Math.max(
        MIN_MINI_PLAYER_WIDTH,
        Math.min(960, Math.round(viewportWidth - 32), Math.round(viewportWidth * 0.72)),
    );
    const n = Math.round(Number(width) || DEFAULT_MINI_PLAYER_WIDTH);
    return Math.min(max, Math.max(MIN_MINI_PLAYER_WIDTH, n));
};

export const readMiniPlayerWidth = () => {
    const raw = Number(readJson(PLAYER_MINI_WIDTH_KEY));
    return clampMiniPlayerWidth(Number.isFinite(raw) ? raw : DEFAULT_MINI_PLAYER_WIDTH);
};

export const writeMiniPlayerWidth = (width: number) => {
    if (typeof window === 'undefined') return;
    writeJson(window.localStorage, PLAYER_MINI_WIDTH_KEY, clampMiniPlayerWidth(width));
};

export const readPlayerNavExpanded = () => {
    const raw = readJson(PLAYER_NAV_EXPANDED_KEY);
    if (raw === false || raw === 0 || raw === '0' || raw === 'false') return false;
    return true;
};

export const writePlayerNavExpanded = (expanded: boolean) => {
    if (typeof window === 'undefined') return;
    writeJson(window.localStorage, PLAYER_NAV_EXPANDED_KEY, expanded !== false);
};

export const readLibraryBrowseState = (sectionKey: string): LibraryBrowseState => {
    const all = (readJson(PLAYER_LIBRARY_STATE_KEY) || {}) as Record<string, Partial<LibraryBrowseState>>;
    const saved = all[String(sectionKey || '')] || {};
    return {
        sort: String(saved.sort || DEFAULT_LIBRARY.sort),
        genre: String(saved.genre || ''),
        decade: String(saved.decade || ''),
        year: String(saved.year || ''),
        contentRating: String(saved.contentRating || ''),
        resolution: String(saved.resolution || ''),
        studio: String(saved.studio || ''),
        network: String(saved.network || ''),
        country: String(saved.country || ''),
        collection: String(saved.collection || ''),
        audioLanguage: String(saved.audioLanguage || ''),
        subtitleLanguage: String(saved.subtitleLanguage || ''),
        actor: String(saved.actor || ''),
        director: String(saved.director || ''),
        writer: String(saved.writer || ''),
        producer: String(saved.producer || ''),
        label: String(saved.label || ''),
        unwatched: saved.unwatched === true,
        inProgress: saved.inProgress === true,
        hdr: saved.hdr === true,
        duplicate: saved.duplicate === true,
    };
};

export const writeLibraryBrowseState = (sectionKey: string, state: LibraryBrowseState) => {
    if (typeof window === 'undefined' || !sectionKey) return;
    const all = (readJson(PLAYER_LIBRARY_STATE_KEY) || {}) as Record<string, LibraryBrowseState>;
    all[sectionKey] = state;
    writeJson(window.sessionStorage, PLAYER_LIBRARY_STATE_KEY, all);
};

const playerScrollerIsContainer = () => {
    const container = document.getElementById(PLAYER_SCROLL_ID) || document.getElementById('main-scroll-container');
    if (!container) return false;
    const overflowY = window.getComputedStyle(container).overflowY;
    return overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay';
};

export const readPlayerScrollTop = () => {
    if (typeof window === 'undefined') return 0;
    const container = document.getElementById(PLAYER_SCROLL_ID) || document.getElementById('main-scroll-container');
    if (container && playerScrollerIsContainer()) return Math.max(0, Math.round(container.scrollTop || 0));
    return Math.max(0, Math.round(window.scrollY || document.documentElement.scrollTop || 0));
};

export const writePlayerScrollTop = (top: number) => {
    if (typeof window === 'undefined') return;
    const container = document.getElementById(PLAYER_SCROLL_ID) || document.getElementById('main-scroll-container');
    if (container) container.scrollTop = top;
    window.scrollTo(0, top);
};

export const stashPlayerHomeScroll = () => {
    if (typeof window === 'undefined') return;
    try {
        window.sessionStorage.setItem(PLAYER_HOME_SCROLL_KEY, String(readPlayerScrollTop()));
    } catch {
        /* ignore */
    }
};

export const restorePlayerHomeScroll = () => {
    if (typeof window === 'undefined') return;
    const top = Number(window.sessionStorage.getItem(PLAYER_HOME_SCROLL_KEY));
    if (!Number.isFinite(top) || top <= 0) return;
    writePlayerScrollTop(top);
};

export const restorePlayerHomeScrollWhenReady = () => {
    if (typeof window === 'undefined') return () => undefined;
    const top = Number(window.sessionStorage.getItem(PLAYER_HOME_SCROLL_KEY));
    if (!Number.isFinite(top) || top <= 0) return () => undefined;
    let cancelled = false;
    let raf = 0;
    const started = Date.now();
    const tick = () => {
        if (cancelled) return;
        writePlayerScrollTop(top);
        if (Math.abs(readPlayerScrollTop() - top) <= 48 || Date.now() - started > 2500) return;
        raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => {
        cancelled = true;
        window.cancelAnimationFrame(raf);
    };
};

export const rememberLastLibraryPath = (path: string) => {
    const next = String(path || '').trim();
    if (!next || typeof window === 'undefined') return;
    try {
        window.sessionStorage.setItem(PLAYER_LAST_LIBRARY_PATH_KEY, next);
        window.localStorage.setItem(PLAYER_LAST_LIBRARY_PATH_KEY, next);
    } catch {
        /* ignore */
    }
};

export const readLastLibraryPath = () => {
    if (typeof window === 'undefined') return '';
    try {
        return String(
            window.sessionStorage.getItem(PLAYER_LAST_LIBRARY_PATH_KEY)
            || window.localStorage.getItem(PLAYER_LAST_LIBRARY_PATH_KEY)
            || '',
        ).trim();
    } catch {
        return '';
    }
};

export const stashPlayerLibraryScroll = () => {
    if (typeof window === 'undefined') return;
    try {
        window.sessionStorage.setItem(PLAYER_LIBRARY_SCROLL_KEY, String(readPlayerScrollTop()));
    } catch {
        /* ignore */
    }
};

export const restorePlayerLibraryScroll = () => {
    if (typeof window === 'undefined') return;
    const top = Number(window.sessionStorage.getItem(PLAYER_LIBRARY_SCROLL_KEY));
    if (!Number.isFinite(top) || top <= 0) return;
    writePlayerScrollTop(top);
};

export const restorePlayerLibraryScrollWhenReady = () => {
    if (typeof window === 'undefined') return () => undefined;
    const top = Number(window.sessionStorage.getItem(PLAYER_LIBRARY_SCROLL_KEY));
    if (!Number.isFinite(top) || top <= 0) return () => undefined;
    let cancelled = false;
    let raf = 0;
    const started = Date.now();
    const tick = () => {
        if (cancelled) return;
        writePlayerScrollTop(top);
        if (Math.abs(readPlayerScrollTop() - top) <= 48 || Date.now() - started > 2500) return;
        raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => {
        cancelled = true;
        window.cancelAnimationFrame(raf);
    };
};

export const PLAYER_SEARCH_OPEN_EVENT = 'smp-player-search-open';

export const requestPlayerSearchFocus = () => {
    if (typeof window === 'undefined') return;
    try {
        window.sessionStorage.setItem(PLAYER_FOCUS_SEARCH_KEY, '1');
    } catch {
        /* ignore */
    }
    window.dispatchEvent(new Event(PLAYER_SEARCH_OPEN_EVENT));
};

export const consumePlayerSearchFocus = () => {
    if (typeof window === 'undefined') return false;
    try {
        const wanted = window.sessionStorage.getItem(PLAYER_FOCUS_SEARCH_KEY) === '1';
        if (wanted) window.sessionStorage.removeItem(PLAYER_FOCUS_SEARCH_KEY);
        return wanted;
    } catch {
        return false;
    }
};

const PLAYER_SEARCH_QUERY_KEY = 'portal-media-player-search-query';

/**
 * Run a search from outside the page (Assistant "search for X", system search).
 * Home may not be mounted yet, so the query waits in sessionStorage too.
 */
export const requestPlayerSearchQuery = (query: string) => {
    if (typeof window === 'undefined') return;
    const text = String(query || '').trim();
    if (!text) return;
    try {
        window.sessionStorage.setItem(PLAYER_SEARCH_QUERY_KEY, text);
    } catch {
        /* ignore */
    }
    window.dispatchEvent(new CustomEvent(PLAYER_VOICE_RESULT_EVENT, { detail: text }));
};

export const consumePlayerSearchQuery = () => {
    if (typeof window === 'undefined') return '';
    try {
        const text = window.sessionStorage.getItem(PLAYER_SEARCH_QUERY_KEY) || '';
        if (text) window.sessionStorage.removeItem(PLAYER_SEARCH_QUERY_KEY);
        return text;
    } catch {
        return '';
    }
};

export const focusPlayerSearchInput = () => {
    const input = document.getElementById(PLAYER_SEARCH_INPUT_ID) as HTMLInputElement | null;
    if (!input) return false;
    input.focus();
    // Leanback: focusing an editable input opens the IME. Keep TV focus visual-only;
    // MediaPlayerHome arms editing on remote Select / Enter.
    try {
        const isTv = document.documentElement?.dataset?.tv === '1'
            || window.__PLEX_CLIENT__?.isTv === true;
        if (!isTv) input.select();
    } catch {
        input.select();
    }
    return true;
};

/**
 * Clear home search and jump back to the top of Home (Continue Watching).
 * Fired from sidebar Home, Back-to-home, and similar “return home” actions.
 */
export const PLAYER_HOME_RESET_EVENT = 'portal-media-player-home-reset';

export const requestPlayerHomeReset = () => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new Event(PLAYER_HOME_RESET_EVENT));
};

const PLAYER_HOME_CACHE_TTL_MS = 90_000;
/** Still paint from disk after a cold TV launch — refresh in background. */
const PLAYER_HOME_CACHE_MAX_AGE_MS = 24 * 60 * 60_000;
const PLAYER_HOME_CACHE_KEY = 'portal-media-player-home-cache-v10';
let playerHomeCache: { at: number; data: PlayerHome } | null = null;

const readPersistedHomeCache = (): { at: number; data: PlayerHome } | null => {
    if (typeof window === 'undefined') return null;
    try {
        const raw = window.localStorage.getItem(PLAYER_HOME_CACHE_KEY)
            || window.sessionStorage.getItem(PLAYER_HOME_CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed?.data || !Number(parsed?.at)) return null;
        return { at: Number(parsed.at), data: parsed.data as PlayerHome };
    } catch {
        return null;
    }
};

const writePersistedHomeCache = (row: { at: number; data: PlayerHome }) => {
    if (typeof window === 'undefined') return;
    const raw = JSON.stringify(row);
    try {
        window.localStorage.setItem(PLAYER_HOME_CACHE_KEY, raw);
    } catch {
        /* quota / private mode */
    }
    try {
        window.sessionStorage.setItem(PLAYER_HOME_CACHE_KEY, raw);
    } catch {
        /* ignore */
    }
};

export const invalidatePlayerHomeCache = () => {
    playerHomeCache = null;
    clearPersistedHomeCache();
};

export const PLAYER_SERVERS_EVENT = 'plex-client-servers-changed';

export const clearPlayerLibrariesCache = () => {
    playerLibrariesCache = null;
    if (typeof window === 'undefined') return;
    try { window.localStorage.removeItem(PLAYER_LIBRARIES_CACHE_KEY); } catch { /* ignore */ }
    try { window.sessionStorage.removeItem(PLAYER_LIBRARIES_CACHE_KEY); } catch { /* ignore */ }
};

export const clearHeroSlidesCache = () => {
    heroSlidesCache = null;
    if (typeof window === 'undefined') return;
    try { window.localStorage.removeItem(PLAYER_HERO_CACHE_KEY); } catch { /* ignore */ }
    try { window.sessionStorage.removeItem(PLAYER_HERO_CACHE_KEY); } catch { /* ignore */ }
};

/** Drop cached home rows and library lists, then tell the nav and settings to reload. */
export const notifyPlayerServersChanged = () => {
    invalidatePlayerHomeCache();
    clearPlayerLibrariesCache();
    clearHeroSlidesCache();
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent(PLAYER_SERVERS_EVENT));
};

const clearPersistedHomeCache = () => {
    if (typeof window === 'undefined') return;
    try { window.localStorage.removeItem(PLAYER_HOME_CACHE_KEY); } catch { /* ignore */ }
    try { window.sessionStorage.removeItem(PLAYER_HOME_CACHE_KEY); } catch { /* ignore */ }
};

export const playerHomeHasRows = (data: PlayerHome | null | undefined) => !!data && (
    (data.hubs || []).some((hub) => hub.items?.length)
    || (data.continueWatching || []).length > 0
    || (data.recentByLibrary || []).some((row) => row.items?.length)
);

const homeHubKey = (hub: { identifier?: string; hubKey?: string | null; title?: string }) => (
    String(hub.identifier || hub.hubKey || hub.title || '').trim().toLowerCase()
);

const isBecauseHomeHub = (hub: { identifier?: string; title?: string }) => (
    /^because:/i.test(String(hub.identifier || ''))
    || /because you watched/i.test(String(hub.title || ''))
);

/** Per-library Recently Added invented when the pin list failed. Not a Plex pin. */
const isSyntheticRecentHomeHub = (hub: { identifier?: string }) => (
    /^recentlyadded\./i.test(String(hub.identifier || ''))
);

const isContinueHomeHub = (hub: { identifier?: string; title?: string }) => (
    /continue\s*watch|ondeck|on[.\s_-]?deck|in[.\s_-]?progress/i.test(`${hub.identifier || ''} ${hub.title || ''}`)
);

const isPlaylistHomeHub = (hub: { identifier?: string; title?: string; playlistRatingKey?: string | null }) => (
    Boolean(hub.playlistRatingKey) || /playlist/i.test(`${hub.identifier || ''} ${hub.title || ''}`)
);

/** Rows under Continue Watching (Recently Added, collections, etc). */
export const playerHomeHasContentHubs = (data: PlayerHome | null | undefined) => (
    !!(data?.hubs || []).some((hub) => (
        hub.items?.length
        && !isContinueHomeHub(hub)
        && !isBecauseHomeHub(hub)
        && !isPlaylistHomeHub(hub)
    ))
    || !!(data?.recentByLibrary || []).some((row) => row.items?.length)
);

/** Continue Watching-only (or partial) home still needs the full=1 hub pass. */
export const playerHomeNeedsFull = (data: PlayerHome | null | undefined) => (
    !data
    || !!data.partial
    || !playerHomeHasContentHubs(data)
    // Because rows are only filled on full=1 — keep asking until that pass lands.
    || data.becauseAttached !== true
    // A Heros row painted from cache still has the backdrop until coverArt is attached.
    || (data.hubs || []).some((hub) => (
        hub.heroRow && (hub.items || []).some((item) => !String(item.heroArt || '').trim())
    ))
);

const mergePlayerItemsPreserveOrder = <T extends { ratingKey?: string | number | null }>(
    shown: T[] | null | undefined,
    incoming: T[] | null | undefined,
): T[] => {
    const shownItems = Array.isArray(shown) ? shown : [];
    const incomingItems = Array.isArray(incoming) ? incoming : [];
    if (!shownItems.length) return incomingItems.slice();
    const byKey = new Map<string, T>();
    for (const item of incomingItems.concat(shownItems)) {
        const key = String(item?.ratingKey || '').trim();
        if (key && !byKey.has(key)) byKey.set(key, item);
    }
    const seen = new Set<string>();
    const items: T[] = [];
    for (const item of shownItems) {
        const key = String(item?.ratingKey || '').trim();
        const next = (key && byKey.get(key)) || item;
        if (key) {
            if (seen.has(key)) continue;
            seen.add(key);
        }
        items.push(next);
    }
    for (const item of incomingItems) {
        const key = String(item?.ratingKey || '').trim();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        items.push(item);
    }
    return items;
};

/** Keep every full-home hub, and hold onto any extra rows the first paint already had. */
export const mergePlayerHomePayloads = (full: PlayerHome, partial: PlayerHome): PlayerHome => {
    const byKey = new Map<string, NonNullable<PlayerHome['hubs']>[number]>();
    const order: string[] = [];
    const add = (hub: NonNullable<PlayerHome['hubs']>[number], replaceIfRicher: boolean) => {
        const key = homeHubKey(hub);
        if (!key) return;
        const prev = byKey.get(key);
        if (!prev) {
            order.push(key);
            byKey.set(key, hub);
            return;
        }
        const prevN = prev.items?.length || 0;
        const nextN = hub.items?.length || 0;
        if (replaceIfRicher ? nextN >= prevN : nextN > prevN) byKey.set(key, hub);
    };
    const countable = (hubs: NonNullable<PlayerHome['hubs']>) => (
        hubs.filter((hub) => !isBecauseHomeHub(hub) && !isSyntheticRecentHomeHub(hub))
    );
    const fullCore = countable(full.hubs || []);
    const partialCore = countable(partial.hubs || []);
    const hasRealPins = fullCore.concat(partialCore).some((hub) => (
        !!hub.items?.length && !isContinueHomeHub(hub) && !isPlaylistHomeHub(hub)
    ));
    const keepHub = (hub: NonNullable<PlayerHome['hubs']>[number]) => (
        !hasRealPins || !isSyntheticRecentHomeHub(hub)
    );
    const primary = partialCore.length > fullCore.length ? partial : full;
    const extra = primary === full ? partial : full;
    (primary.hubs || []).filter(keepHub).forEach((hub) => add(hub, primary === full));
    (extra.hubs || []).filter(keepHub).forEach((hub) => add(hub, extra === full));
    (full.hubs || []).filter(isBecauseHomeHub).forEach((hub) => add(hub, true));
    const hubs = order.map((key) => byKey.get(key)!);
    const shownCw = (partial.hubs || []).find((hub) => isContinueHomeHub(hub));
    if (shownCw?.items?.length) {
        for (let index = 0; index < hubs.length; index += 1) {
            if (!isContinueHomeHub(hubs[index])) continue;
            hubs[index] = {
                ...hubs[index],
                items: mergePlayerItemsPreserveOrder(shownCw.items, hubs[index].items),
            };
        }
    }
    return {
        ...partial,
        ...full,
        continueWatching: mergePlayerItemsPreserveOrder(partial.continueWatching, full.continueWatching),
        hubs,
        partial: false,
        becauseAttached: full.becauseAttached === true || partial.becauseAttached === true,
    };
};

const homeContinueItems = (data: PlayerHome | null | undefined): PlayerItem[] => {
    if (!data) return [];
    const fromHub = (data.hubs || []).find((hub) => isContinueHomeHub(hub))?.items;
    if (fromHub?.length) return fromHub;
    return Array.isArray(data.continueWatching) ? data.continueWatching : [];
};

/**
 * Soft home responses often paint Recently Added while On Deck timed out.
 * Keep the last good Continue Watching (and missing content hubs) from cache
 * so TV Home does not drop CW or flash a false "saved library" banner.
 */
export const coalescePlayerHomeWithCache = (
    live: PlayerHome | null | undefined,
    cached: PlayerHome | null | undefined,
): PlayerHome | null => {
    if (!playerHomeHasRows(live)) {
        return playerHomeHasRows(cached) ? cached! : (live || cached || null);
    }
    if (!playerHomeHasRows(cached)) return live!;

    let next: PlayerHome = live!;
    const liveCw = homeContinueItems(live);
    const cachedCw = homeContinueItems(cached);
    if (!liveCw.length && cachedCw.length) {
        const hubsWithoutCw = (live!.hubs || []).filter((hub) => !isContinueHomeHub(hub));
        const cachedCwHub = (cached!.hubs || []).find((hub) => isContinueHomeHub(hub));
        next = {
            ...live!,
            continueWatching: (cached!.continueWatching || []).length
                ? cached!.continueWatching
                : cachedCw,
            hubs: [
                cachedCwHub || {
                    title: 'Continue Watching',
                    identifier: 'home.continueWatching',
                    items: cachedCw,
                    hubKey: '/library/onDeck',
                },
                ...hubsWithoutCw,
            ],
        };
    }
    if (!playerHomeHasContentHubs(next) && playerHomeHasContentHubs(cached)) {
        next = { ...mergePlayerHomePayloads(cached!, next), partial: true };
    }
    const hasRealPinHubs = (data: PlayerHome | null | undefined) => (
        (data?.hubs || []).some((hub) => (
            !!hub.items?.length
            && !isContinueHomeHub(hub)
            && !isBecauseHomeHub(hub)
            && !isPlaylistHomeHub(hub)
            && !isSyntheticRecentHomeHub(hub)
        ))
    );
    // A Recently Added fallback must not replace the last home that had real pins.
    if (!hasRealPinHubs(next) && hasRealPinHubs(cached)) {
        next = { ...mergePlayerHomePayloads(cached!, next), partial: next.partial !== false };
    }
    // Soft/partial responses omit Because rows — keep the last attached ones.
    const liveBecause = (next.hubs || []).filter(isBecauseHomeHub);
    const cachedBecause = (cached!.hubs || []).filter(isBecauseHomeHub);
    if (!liveBecause.length && cachedBecause.length) {
        next = {
            ...next,
            hubs: [
                ...(next.hubs || []).filter((hub) => !isBecauseHomeHub(hub)),
                ...cachedBecause,
            ],
            becauseAttached: next.becauseAttached === true || cached!.becauseAttached === true,
        };
    } else if (cached!.becauseAttached === true && next.becauseAttached !== true) {
        next = { ...next, becauseAttached: true };
    }
    return next;
};

export const readPlayerHomeCache = (): PlayerHome | null => {
    if (!playerHomeCache) {
        const persisted = readPersistedHomeCache();
        if (persisted) playerHomeCache = persisted;
    }
    if (!playerHomeCache) return null;
    if (Date.now() - playerHomeCache.at > PLAYER_HOME_CACHE_MAX_AGE_MS) {
        playerHomeCache = null;
        clearPersistedHomeCache();
        return null;
    }
    return playerHomeCache.data;
};

export const writePlayerHomeCache = (data: PlayerHome) => {
    const stored = playerHomeCache || readPersistedHomeCache();
    const storedFresh = !!stored && Date.now() - stored.at <= PLAYER_HOME_CACHE_MAX_AGE_MS;
    if (!playerHomeHasRows(data) && storedFresh && playerHomeHasRows(stored?.data)) {
        if (!playerHomeCache && stored) playerHomeCache = stored;
        return;
    }
    const coalesced = storedFresh
        ? coalescePlayerHomeWithCache(data, stored?.data) || data
        : data;
    playerHomeCache = { at: Date.now(), data: coalesced };
    writePersistedHomeCache(playerHomeCache);
    if (Array.isArray(coalesced?.libraries) && coalesced.libraries.length) {
        writePlayerLibrariesCache(coalesced.libraries);
    }
};

/**
 * Browser online flag for offline UI.
 * Android TV WebViews often report navigator.onLine=false even on a healthy LAN —
 * start optimistic and only flip offline after an explicit offline event (or stay
 * online until a real API failure marks home stale).
 */
export const usePlayerNetworkStatus = () => {
    const [online, setOnline] = useState(true);
    useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        const on = () => setOnline(true);
        const off = () => {
            // Capacitor / Android TV: ignore flaky offline if the page is still loading
            // assets over the network — only trust offline after we were online.
            setOnline(false);
        };
        window.addEventListener('online', on);
        window.addEventListener('offline', off);
        // If the browser already thinks we are online, keep that; never seed from a
        // false-negative offline boot state.
        if (navigator.onLine) setOnline(true);
        return () => {
            window.removeEventListener('online', on);
            window.removeEventListener('offline', off);
        };
    }, []);
    return online;
};

const PLAYER_LIBRARIES_CACHE_KEY = 'portal-media-player-libraries-cache';
const PLAYER_LIBRARIES_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** Fired whenever the libraries cache gets a non-empty write (home or /libraries). */
export const PLAYER_LIBRARIES_EVENT = 'portal-media-player-libraries';
let playerLibrariesCache: { at: number; data: PlayerSection[] } | null = null;

const libraryTitleFallback = (type: string) => {
    const kind = String(type || '').toLowerCase();
    if (kind === 'show') return 'TV Shows';
    if (kind === 'artist') return 'Music';
    if (kind === 'photo') return 'Photos';
    return 'Movies';
};

const sanitizeLibraries = (rows: unknown): PlayerSection[] => (
    (Array.isArray(rows) ? rows : [])
        .filter((row): row is PlayerSection => Boolean(row && String((row as PlayerSection).key || '').trim()))
        .map((row) => {
            const type = String(row.type || '');
            const title = String(row.title || '').trim() || libraryTitleFallback(type);
            const serverId = String((row as PlayerSection).serverId || '').trim();
            const serverName = String((row as PlayerSection).serverName || '').trim();
            return {
                key: String(row.key),
                title,
                type,
                agent: row.agent,
                thumb: row.thumb,
                ...(serverId ? { serverId } : {}),
                ...(serverName ? { serverName } : {}),
            };
        })
);

export const readPlayerLibrariesCache = (): PlayerSection[] => {
    if (!playerLibrariesCache) {
        try {
            const raw = typeof window !== 'undefined'
                ? (window.localStorage.getItem(PLAYER_LIBRARIES_CACHE_KEY)
                    || window.sessionStorage.getItem(PLAYER_LIBRARIES_CACHE_KEY))
                : null;
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed?.data && Number(parsed?.at)) {
                    playerLibrariesCache = { at: Number(parsed.at), data: sanitizeLibraries(parsed.data) };
                }
            }
        } catch {
            playerLibrariesCache = null;
        }
    }
    if (playerLibrariesCache && Date.now() - playerLibrariesCache.at <= PLAYER_LIBRARIES_CACHE_MAX_AGE_MS) {
        if (playerLibrariesCache.data.length) return playerLibrariesCache.data;
    }
    return sanitizeLibraries(readPlayerHomeCache()?.libraries);
};

export const writePlayerLibrariesCache = (libraries: PlayerSection[]) => {
    const data = sanitizeLibraries(libraries);
    if (!data.length) return;
    playerLibrariesCache = { at: Date.now(), data };
    const raw = JSON.stringify(playerLibrariesCache);
    try { window.localStorage.setItem(PLAYER_LIBRARIES_CACHE_KEY, raw); } catch { /* ignore */ }
    try { window.sessionStorage.setItem(PLAYER_LIBRARIES_CACHE_KEY, raw); } catch { /* ignore */ }
    try {
        window.dispatchEvent(new Event(PLAYER_LIBRARIES_EVENT));
    } catch {
        /* ignore */
    }
};

export const isPlayerHomeCacheFresh = (maxAgeMs = PLAYER_HOME_CACHE_TTL_MS) => (
    Boolean(playerHomeCache && Date.now() - playerHomeCache.at <= maxAgeMs)
);

const PLAYER_ITEM_CACHE_TTL_MS = 120_000;
const playerItemCache = new Map<string, { at: number; data: PlayerItemPage }>();
let pendingItemSeed: PlayerItem | null = null;
const itemNavSeeds = new Map<string, PlayerItem>();

/** Soft-open overview with poster metadata before the network round-trip finishes. */
export const seedPlayerItemNav = (item: PlayerItem | null | undefined) => {
    if (!item?.ratingKey) return;
    pendingItemSeed = item;
    itemNavSeeds.set(String(item.ratingKey), item);
    if (itemNavSeeds.size > 40) {
        const first = itemNavSeeds.keys().next().value;
        if (first) itemNavSeeds.delete(first);
    }
};

export const takePlayerItemSeed = (ratingKey: string): PlayerItem | null => {
    const key = String(ratingKey || '');
    const seed = pendingItemSeed;
    pendingItemSeed = null;
    if (seed && String(seed.ratingKey) === key) return seed;
    return itemNavSeeds.get(key) || null;
};

export const readPlayerItemCache = (ratingKey: string): PlayerItemPage | null => {
    const key = String(ratingKey || '');
    if (!key) return null;
    const row = playerItemCache.get(key);
    if (!row) return null;
    if (Date.now() - row.at > PLAYER_ITEM_CACHE_TTL_MS) {
        playerItemCache.delete(key);
        return null;
    }
    return row.data;
};

export const writePlayerItemCache = (ratingKey: string, data: PlayerItemPage) => {
    const key = String(ratingKey || '');
    if (!key || !data?.item) return;
    playerItemCache.set(key, { at: Date.now(), data });
    if (playerItemCache.size <= 48) return;
    const oldest = playerItemCache.keys().next().value;
    if (oldest && oldest !== key) playerItemCache.delete(oldest);
};

export const clearPlayerItemCache = (ratingKey?: string) => {
    const key = String(ratingKey || '').trim();
    if (!key) {
        playerItemCache.clear();
        return;
    }
    playerItemCache.delete(key);
};

/** Fired after Plex metadata refresh is detected (new thumb/title/etc). */
export const PLAYER_METADATA_REFRESHED_EVENT = 'smp-player-metadata-refreshed';

/** Paint a just-stopped offset onto the open title and any season list that contains it. */
export const notePlayerItemProgress = (ratingKey: string, viewOffsetMs: number, durationMs = 0, watched?: boolean) => {
    const key = String(ratingKey || '');
    if (!key) return;
    const offset = Math.max(0, Math.floor(Number(viewOffsetMs) || 0));
    const duration = Math.max(0, Math.floor(Number(durationMs) || 0));
    const finished = offset <= 0;
    const nextWatched = watched != null ? watched : finished;
    const paint = (row: PlayerItem): PlayerItem => {
        if (String(row?.ratingKey || '') !== key) return row;
        return {
            ...row,
            viewOffsetMs: offset,
            durationMs: row.durationMs || duration || null,
            watched: nextWatched,
        };
    };
    for (const [pageKey, row] of playerItemCache) {
        const data = row.data;
        const item = data.item ? paint(data.item) : data.item;
        const children = (data.children || []).map(paint);
        const onDeck = data.onDeck ? paint(data.onDeck) : data.onDeck;
        const prevChildren = data.children || [];
        const changed = item !== data.item
            || onDeck !== data.onDeck
            || children.some((child, index) => child !== prevChildren[index]);
        if (!changed) continue;
        playerItemCache.set(pageKey, {
            at: Date.now(),
            data: { ...data, item, children, onDeck },
        });
    }
};

type LibraryHomePayload = {
    title?: string;
    type?: string;
    hubs?: import('./types').PlayerLibraryHub[];
};

const libraryHomeCache = new Map<string, { at: number; data: LibraryHomePayload }>();
const LIBRARY_HOME_CLIENT_TTL_MS = 90_000;

export const readLibraryHomeCache = (sectionKey: string): LibraryHomePayload | null => {
    const key = String(sectionKey || '');
    if (!key) return null;
    const row = libraryHomeCache.get(key);
    if (!row) return null;
    if (Date.now() - row.at > LIBRARY_HOME_CLIENT_TTL_MS * 5) {
        libraryHomeCache.delete(key);
        return null;
    }
    return row.data;
};

export const writeLibraryHomeCache = (sectionKey: string, data: LibraryHomePayload) => {
    const key = String(sectionKey || '');
    if (!key) return;
    libraryHomeCache.set(key, { at: Date.now(), data });
    if (libraryHomeCache.size <= 24) return;
    const oldest = libraryHomeCache.keys().next().value;
    if (oldest && oldest !== key) libraryHomeCache.delete(oldest);
};

type HeroSlidesPayload = Array<{
    ratingKey: string;
    title: string;
    type: string;
    year?: number | null;
    summary?: string;
    thumb?: string | null;
    art?: string | null;
    logo?: string | null;
    backdropUrl?: string | null;
    posterUrl?: string | null;
    tmdbId?: number | null;
    canPlay?: boolean;
}>;

let heroSlidesCache: { at: number; data: HeroSlidesPayload } | null = null;
const HERO_CLIENT_TTL_MS = 10 * 60_000;
const HERO_CLIENT_MAX_AGE_MS = 45 * 60_000;
const PLAYER_HERO_CACHE_KEY = 'portal-media-player-hero-cache-v5';

const readPersistedHeroCache = (): { at: number; data: HeroSlidesPayload } | null => {
    if (typeof window === 'undefined') return null;
    try {
        const raw = window.localStorage.getItem(PLAYER_HERO_CACHE_KEY)
            || window.sessionStorage.getItem(PLAYER_HERO_CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed?.data) || !Number(parsed?.at)) return null;
        return { at: Number(parsed.at), data: parsed.data as HeroSlidesPayload };
    } catch {
        return null;
    }
};

const writePersistedHeroCache = (row: { at: number; data: HeroSlidesPayload }) => {
    if (typeof window === 'undefined') return;
    const raw = JSON.stringify(row);
    try {
        window.localStorage.setItem(PLAYER_HERO_CACHE_KEY, raw);
    } catch {
        /* quota */
    }
    try {
        window.sessionStorage.setItem(PLAYER_HERO_CACHE_KEY, raw);
    } catch {
        /* ignore */
    }
};

export const isHeroSlidesCacheFresh = (maxAgeMs = HERO_CLIENT_TTL_MS) => {
    if (!heroSlidesCache) {
        const persisted = readPersistedHeroCache();
        if (persisted) heroSlidesCache = persisted;
    }
    return Boolean(heroSlidesCache && Date.now() - heroSlidesCache.at <= maxAgeMs);
};

export const readHeroSlidesCache = (): HeroSlidesPayload | null => {
    if (!heroSlidesCache) {
        const persisted = readPersistedHeroCache();
        if (persisted) heroSlidesCache = persisted;
    }
    if (!heroSlidesCache) return null;
    if (Date.now() - heroSlidesCache.at > HERO_CLIENT_MAX_AGE_MS) {
        heroSlidesCache = null;
        if (typeof window !== 'undefined') {
            try { window.localStorage.removeItem(PLAYER_HERO_CACHE_KEY); } catch { /* ignore */ }
            try { window.sessionStorage.removeItem(PLAYER_HERO_CACHE_KEY); } catch { /* ignore */ }
        }
        return null;
    }
    return heroSlidesCache.data;
};

export const writeHeroSlidesCache = (data: HeroSlidesPayload) => {
    heroSlidesCache = { at: Date.now(), data: Array.isArray(data) ? data : [] };
    writePersistedHeroCache(heroSlidesCache);
};

