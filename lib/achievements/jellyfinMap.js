/** Map Jellyfin/Emby played Items into Plex-like history rows for the stats builder. */
export const mapJellyfinPlayedItemsToHistory = (items = []) => {
    const list = Array.isArray(items) ? items : [];
    return list.map((item) => {
        const typeRaw = String(item?.Type || '').toLowerCase();
        let type = 'movie';
        if (typeRaw === 'episode') type = 'episode';
        else if (typeRaw === 'audio') type = 'track';
        else if (typeRaw === 'movie') type = 'movie';

        const datePlayed = item?.UserData?.LastPlayedDate || item?.DatePlayed || item?.PremiereDate;
        const viewedAt = datePlayed ? Math.floor(new Date(datePlayed).getTime() / 1000) : 0;
        const runTicks = Number(item?.RunTimeTicks) || Number(item?.UserData?.PlaybackPositionTicks) || 0;
        const duration = runTicks > 0 ? runTicks / 10000000 : 0;

        const played = item?.UserData?.Played === true
            || item?.UserData?.Played === 1
            || String(item?.UserData?.PlayedStatus || '').toLowerCase() === 'played';
        const posTicks = Number(item?.UserData?.PlaybackPositionTicks) || 0;
        const percentComplete = runTicks > 0 && posTicks > 0
            ? (posTicks / runTicks) * 100
            : (played ? 100 : null);

        return {
            type,
            viewedAt,
            duration,
            ratingKey: item?.Id || item?.Name,
            key: item?.Id || item?.Name,
            grandparentKey: item?.SeriesId || item?.SeriesName || null,
            grandparentTitle: item?.SeriesName || null,
            parentKey: item?.AlbumId || item?.Album || item?.ParentId || null,
            parentTitle: item?.Album || null,
            title: item?.Name || item?.SeriesName || 'Untitled',
            librarySectionID: item?.ParentId || item?.ChannelId || item?.CollectionType || null,
            percentComplete,
            watchedStatus: played ? 1 : 0,
            Genre: Array.isArray(item?.GenreItems)
                ? item.GenreItems
                : (Array.isArray(item?.Genres) ? item.Genres : undefined),
            genres: Array.isArray(item?.Genres) ? item.Genres : undefined,
        };
    }).filter((row) => row.viewedAt > 0 || row.ratingKey);
};
