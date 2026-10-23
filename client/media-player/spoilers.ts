import { saveMediaPlayerSettings } from './api';
import { normalizePlayerSettings, readPlayerSettings, writePlayerSettings, type PlayerSettings } from './playerSettings';
import type { PlayerItem } from './types';

/** The show a title belongs to — spoiler hiding is switched on per show. */
export const spoilerShowKey = (item?: Pick<PlayerItem, 'type' | 'ratingKey' | 'parentRatingKey' | 'grandparentRatingKey'> | null) => {
    if (!item) return '';
    if (item.type === 'show') return String(item.ratingKey || '');
    if (item.type === 'season') return String(item.parentRatingKey || '');
    if (item.type === 'episode') return String(item.grandparentRatingKey || '');
    return '';
};

export const isSpoilerShow = (settings: Pick<PlayerSettings, 'spoilerShows'>, showKey: string) => (
    !!showKey && settings.spoilerShows.includes(showKey)
);

/**
 * Hide this episode's still and summary? Only for shows with spoiler hiding on, and only
 * episodes you haven't started — anything watched or in progress shows normally.
 */
export const hideEpisodeSpoilers = (
    settings: Pick<PlayerSettings, 'spoilerShows'>,
    episode?: Pick<PlayerItem, 'type' | 'watched' | 'viewOffsetMs' | 'grandparentRatingKey'> | null,
    showKey = '',
) => {
    if (!episode || episode.type !== 'episode') return false;
    if (episode.watched || Number(episode.viewOffsetMs || 0) > 0) return false;
    return isSpoilerShow(settings, showKey || String(episode.grandparentRatingKey || ''));
};

/** Long-press menu toggle. Saved straight away (not via the Settings page Save button). */
export const toggleSpoilerShow = (showKey: string): boolean => {
    if (!showKey) return false;
    const current = readPlayerSettings();
    const on = !current.spoilerShows.includes(showKey);
    const spoilerShows = on
        ? [...current.spoilerShows, showKey]
        : current.spoilerShows.filter((key) => key !== showKey);
    const next = normalizePlayerSettings({ ...current, spoilerShows });
    writePlayerSettings(next);
    void saveMediaPlayerSettings(next).catch(() => undefined);
    return on;
};
