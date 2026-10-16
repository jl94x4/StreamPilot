/**
 * Map Tautulli get_history rows into Plex-like history items for achievements / wrap-up.
 */

export const mapTautulliHistoryRowToPlexItem = (row = {}) => {
    const mediaType = String(row.media_type || row.mediaType || '').toLowerCase();
    let type = 'movie';
    if (mediaType === 'episode') type = 'episode';
    else if (mediaType === 'track' || mediaType === 'music') type = 'track';
    else if (mediaType === 'movie') type = 'movie';
    else if (mediaType === 'show') type = 'episode';

    const viewedAtRaw = Number(row.started || row.date || row.viewedAt || 0) || 0;
    const viewedAt = viewedAtRaw > 9_999_999_999 ? Math.floor(viewedAtRaw / 1000) : viewedAtRaw;
    const ratingKey = row.rating_key != null ? String(row.rating_key) : null;
    const parentKey = row.parent_rating_key != null ? String(row.parent_rating_key) : null;
    const grandparentKey = row.grandparent_rating_key != null ? String(row.grandparent_rating_key) : null;
    const durationSec = Number(row.duration || 0) || 0;
    const playDurationSec = Number(row.play_duration || 0) || 0;
    const percentComplete = Number(row.percent_complete ?? row.percentComplete);
    const watchedStatus = Number(row.watched_status ?? row.watchedStatus);
    const episodeThumb = row.thumb || null;
    const seasonThumb = row.parent_thumb || null;
    const showThumb = row.grandparent_thumb || null;
    // Prefer series/album poster for most-watched cards; episode stills often 404 after rematches.
    const thumb = type === 'episode'
        ? (showThumb || seasonThumb || episodeThumb)
        : type === 'track'
            ? (seasonThumb || showThumb || episodeThumb)
            : (episodeThumb || showThumb || seasonThumb);

    const tautulliUserId = row.user_id != null && row.user_id !== '' ? String(row.user_id) : null;
    const playerName = String(row.player || row.product || '').trim() || null;
    const platformName = String(row.platform || '').trim() || null;
    const deviceId = row.machine_id != null && row.machine_id !== ''
        ? String(row.machine_id)
        : (row.device_id != null && row.device_id !== '' ? String(row.device_id) : null);

    return {
        type,
        viewedAt,
        duration: durationSec > 0 ? durationSec * 1000 : (playDurationSec > 0 ? playDurationSec * 1000 : 0), // stats builder treats large values as ms
        playDuration: playDurationSec > 0 ? playDurationSec * 1000 : 0,
        ratingKey,
        key: ratingKey ? `/library/metadata/${ratingKey}` : null,
        grandparentKey: grandparentKey ? `/library/metadata/${grandparentKey}` : null,
        grandparentRatingKey: grandparentKey,
        grandparentTitle: row.grandparent_title || null,
        grandparentThumb: showThumb,
        parentKey: parentKey ? `/library/metadata/${parentKey}` : null,
        parentTitle: row.parent_title || null,
        parentThumb: seasonThumb,
        title: row.full_title || row.title || row.grandparent_title || 'Untitled',
        thumb,
        art: row.art || row.grandparent_art || row.parent_art || null,
        librarySectionID: row.section_id != null ? row.section_id : (row.library_id != null ? row.library_id : null),
        librarySectionTitle: row.section_title || row.library_name || row.section_name || null,
        percentComplete: Number.isFinite(percentComplete) ? percentComplete : null,
        watchedStatus: Number.isFinite(watchedStatus) ? watchedStatus : null,
        // Tautulli user_id until remapped to a Plex accountID for server analytics.
        accountID: tautulliUserId || undefined,
        // Device / platform fields for Top Devices analytics (Tautulli get_history).
        deviceID: deviceId || undefined,
        client: playerName || undefined,
        platform: platformName || undefined,
        player: playerName || undefined,
        Player: (playerName || platformName)
            ? { product: playerName || platformName, platform: platformName || undefined, title: playerName || undefined }
            : undefined,
        // Best-effort genre tags when Tautulli includes them
        genres: Array.isArray(row.genres) ? row.genres : undefined,
        Genre: (() => {
            const raw = row.genres ?? row.genre ?? row.Genre;
            if (Array.isArray(raw)) {
                return raw.map((g) => {
                    if (typeof g === 'string') return { tag: g.trim() };
                    const tag = String(g?.tag || g?.name || '').trim();
                    return tag ? { tag } : null;
                }).filter(Boolean);
            }
            if (typeof raw === 'string' && raw.trim()) {
                return raw.split(/[,|]/).map((t) => ({ tag: t.trim() })).filter((g) => g.tag);
            }
            return undefined;
        })(),
        videoResolution: String(row.video_resolution || row.video_full_resolution || '').trim() || null,
        tautulliId: row.id != null && row.id !== ''
            ? String(row.id)
            : (row.row_id != null && row.row_id !== '' ? String(row.row_id) : null),
    };
};
