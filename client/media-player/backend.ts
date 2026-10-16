/**
 * Data contract for Media Player.
 * Portal implements this in api.ts. A standalone app implements the same methods against plex.tv / PMS.
 */

import {
    addMediaPlayerPlaylistItem,
    createMediaPlayerPlaylist,
    fetchMediaPlayerCollection,
    fetchMediaPlayerCollections,
    fetchMediaPlayerHome,
    fetchMediaPlayerItem,
    fetchMediaPlayerLibraries,
    fetchMediaPlayerLibrary,
    fetchMediaPlayerLibraryFilters,
    fetchMediaPlayerLibraryHome,
    fetchMediaPlayerNeighbors,
    fetchMediaPlayerNext,
    fetchMediaPlayerPerson,
    fetchMediaPlayerPlaylist,
    fetchMediaPlayerPlaylists,
    fetchMediaPlayerSettings,
    fetchPlayerPersonBundle,
    reportMediaPlayerTimeline,
    saveMediaPlayerSettings,
    searchMediaPlayer,
    setMediaPlayerWatched,
    startMediaPlayerPlayback,
    stopMediaPlayerTranscode,
} from './api';
import type {
    PlayerHome,
    PlayerItem,
    PlayerItemPage,
    PlayerLibraryFilters,
    PlayerLibraryHome,
    PlayerLibraryPage,
    PlayerPersonBundle,
    PlayerPersonPage,
    PlayerPlaySession,
    PlayerSection,
} from './types';

export type PlayerLibraryQuery = {
    sort?: string;
    genre?: string;
    decade?: string;
    resolution?: string;
    studio?: string;
    unwatched?: boolean;
    inProgress?: boolean;
};

export type PlayerPlayRequest = {
    offsetMs?: number | null;
    qualityId?: string;
    mediaIndex?: number;
    audioLanguage?: string;
    subtitleMode?: string;
};

export type PlayerTimelinePayload = {
    ratingKey: string;
    sessionId: string;
    state: 'playing' | 'paused' | 'buffering' | 'stopped';
    timeMs: number;
    durationMs: number;
};

export type PlayerBackend = {
    fetchHome: () => Promise<PlayerHome>;
    fetchLibraries: () => Promise<{ libraries: PlayerSection[] }>;
    fetchLibrary: (sectionKey: string, start?: number, size?: number, opts?: PlayerLibraryQuery) => Promise<PlayerLibraryPage>;
    fetchLibraryHome: (sectionKey: string) => Promise<PlayerLibraryHome>;
    fetchLibraryFilters: (sectionKey: string) => Promise<PlayerLibraryFilters>;
    fetchCollections: (sectionKey: string) => Promise<{ title: string; items: PlayerItem[] }>;
    fetchCollection: (ratingKey: string) => Promise<PlayerItemPage>;
    fetchPlaylists: () => Promise<{ items: PlayerItem[] }>;
    fetchPlaylist: (ratingKey: string) => Promise<PlayerItemPage>;
    createPlaylist: (title: string, ratingKey?: string) => Promise<{ item: PlayerItem }>;
    addPlaylistItem: (playlistKey: string, ratingKey: string) => Promise<unknown>;
    setWatched: (ratingKey: string, watched: boolean) => Promise<unknown>;
    fetchNext: (ratingKey: string) => Promise<{ item: PlayerItem | null }>;
    fetchNeighbors: (ratingKey: string) => Promise<{ previous: PlayerItem | null; next: PlayerItem | null }>;
    fetchItem: (ratingKey: string) => Promise<PlayerItemPage>;
    fetchPerson: (actorId: string, name?: string) => Promise<PlayerPersonPage>;
    fetchPersonBundle: (actorId: string, name?: string, thumb?: string | null) => Promise<PlayerPersonBundle>;
    search: (query: string) => Promise<{ results: PlayerItemPage['item'][] }>;
    fetchSettings: () => Promise<Record<string, unknown>>;
    saveSettings: (settings: Record<string, unknown>) => Promise<Record<string, unknown>>;
    startPlayback: (ratingKey: string, opts?: PlayerPlayRequest) => Promise<PlayerPlaySession>;
    reportTimeline: (payload: PlayerTimelinePayload) => Promise<unknown>;
    stopTranscode: (sessionId?: string | null) => Promise<unknown>;
};

export const portalPlayerBackend: PlayerBackend = {
    fetchHome: fetchMediaPlayerHome,
    fetchLibraries: fetchMediaPlayerLibraries,
    fetchLibrary: fetchMediaPlayerLibrary,
    fetchLibraryHome: fetchMediaPlayerLibraryHome,
    fetchLibraryFilters: fetchMediaPlayerLibraryFilters,
    fetchCollections: fetchMediaPlayerCollections,
    fetchCollection: fetchMediaPlayerCollection,
    fetchPlaylists: fetchMediaPlayerPlaylists,
    fetchPlaylist: fetchMediaPlayerPlaylist,
    createPlaylist: createMediaPlayerPlaylist,
    addPlaylistItem: addMediaPlayerPlaylistItem,
    setWatched: setMediaPlayerWatched,
    fetchNext: fetchMediaPlayerNext,
    fetchNeighbors: fetchMediaPlayerNeighbors,
    fetchItem: fetchMediaPlayerItem,
    fetchPerson: fetchMediaPlayerPerson,
    fetchPersonBundle: fetchPlayerPersonBundle,
    search: searchMediaPlayer,
    fetchSettings: fetchMediaPlayerSettings,
    saveSettings: saveMediaPlayerSettings,
    startPlayback: startMediaPlayerPlayback,
    reportTimeline: reportMediaPlayerTimeline,
    stopTranscode: stopMediaPlayerTranscode,
};
