import { idsFromGuids } from './ids.js';

const mediaList = (payload) => {
    const container = payload?.MediaContainer || payload || {};
    const items = container.Metadata || container.Directory || [];
    return Array.isArray(items) ? items : [];
};

export const createPlexLibrary = ({ fetchImpl = fetch } = {}) => {
    const getJson = async (baseUrl, token, pathAndQuery) => {
        const join = pathAndQuery.includes('?') ? '&' : '?';
        const url = `${baseUrl}${pathAndQuery}${join}X-Plex-Token=${encodeURIComponent(token)}`;
        const response = await fetchImpl(url, {
            headers: {
                Accept: 'application/json',
                'X-Plex-Token': token,
            },
        });
        const text = await response.text();
        if (!response.ok) {
            throw new Error(`Plex ${response.status} ${pathAndQuery}${text ? `: ${text.slice(0, 180)}` : ''}`);
        }
        if (!text) return {};
        try {
            return JSON.parse(text);
        } catch {
            return { raw: text };
        }
    };

    const getAll = async (baseUrl, token, sectionKey, type) => {
        const pageSize = 200;
        const items = [];
        let start = 0;
        let total = Infinity;
        while (start < total && start < 200000) {
            const payload = await getJson(
                baseUrl,
                token,
                `/library/sections/${encodeURIComponent(sectionKey)}/all?includeGuids=1&type=${type}&X-Plex-Container-Start=${start}&X-Plex-Container-Size=${pageSize}`,
            );
            const batch = mediaList(payload);
            const reported = Number(payload?.MediaContainer?.totalSize);
            if (Number.isFinite(reported)) total = reported;
            items.push(...batch);
            if (!batch.length || batch.length < pageSize) break;
            start += batch.length;
        }
        return items;
    };

    const mapMovie = (item) => ({
        ratingKey: String(item.ratingKey),
        title: item.title || '',
        year: item.year || null,
        ids: idsFromGuids(item.Guid || item.guid),
        plexGuid: item.guid || '',
        watched: Number(item.viewCount) > 0,
        watchedAt: item.lastViewedAt || null,
        rating: item.userRating ?? null,
    });

    const mapShow = (item) => ({
        ratingKey: String(item.ratingKey),
        title: item.title || '',
        ids: idsFromGuids(item.Guid || item.guid),
        plexGuid: item.guid || '',
    });

    const mapEpisode = (item, showsByKey) => {
        const show = showsByKey.get(String(item.grandparentRatingKey)) || null;
        const ownIds = idsFromGuids(item.Guid);
        return {
            ratingKey: String(item.ratingKey),
            title: item.title || '',
            showTitle: item.grandparentTitle || show?.title || '',
            season: Number(item.parentIndex),
            episode: Number(item.index),
            showIds: show?.ids || {},
            episodeIds: ownIds,
            plexGuid: item.guid || '',
            watched: Number(item.viewCount) > 0,
            watchedAt: item.lastViewedAt || null,
            rating: item.userRating ?? null,
        };
    };

    return {
        async libraries(baseUrl, token) {
            const payload = await getJson(baseUrl, token, '/library/sections');
            return mediaList(payload)
                .filter((section) => section.type === 'movie' || section.type === 'show')
                .map((section) => ({
                    id: String(section.key),
                    title: section.title || `Library ${section.key}`,
                    type: section.type,
                }));
        },
        async collect(baseUrl, token, libraryIds, onProgress) {
            const libraries = await this.libraries(baseUrl, token);
            const selected = new Set((libraryIds || []).map(String));
            const use = libraries.filter((library) => !selected.size || selected.has(library.id));
            const movies = [];
            const shows = [];
            const episodes = [];
            for (const library of use) {
                if (typeof onProgress === 'function') onProgress(`Reading ${library.title}`);
                if (library.type === 'movie') {
                    const items = await getAll(baseUrl, token, library.id, 1);
                    movies.push(...items.map(mapMovie));
                } else {
                    const showItems = await getAll(baseUrl, token, library.id, 2);
                    const mappedShows = showItems.map(mapShow);
                    shows.push(...mappedShows);
                    const showsByKey = new Map(mappedShows.map((show) => [show.ratingKey, show]));
                    const episodeItems = await getAll(baseUrl, token, library.id, 4);
                    episodes.push(...episodeItems.map((item) => mapEpisode(item, showsByKey)));
                }
            }
            return { libraries: use, movies, shows, episodes };
        },
        async scrobble(baseUrl, token, ratingKey) {
            await getJson(
                baseUrl,
                token,
                `/:/scrobble?identifier=com.plexapp.plugins.library&key=${encodeURIComponent(ratingKey)}`,
            );
        },
        async rate(baseUrl, token, ratingKey, rating) {
            await getJson(
                baseUrl,
                token,
                `/:/rate?identifier=com.plexapp.plugins.library&key=${encodeURIComponent(ratingKey)}&rating=${encodeURIComponent(rating)}`,
            );
        },
        async addToWatchlist(baseUrl, token, plexGuid) {
            if (!plexGuid) throw new Error('Missing Plex guid');
            await getJson(
                baseUrl,
                token,
                `/actions/addToWatchlist?ratingKey=${encodeURIComponent(plexGuid)}`,
            );
        },
        async watchlist(token) {
            const payload = await getJson('https://discover.provider.plex.tv', token, '/library/sections/watchlist/all?includeGuids=1');
            return mediaList(payload).map((item) => ({
                title: item.title || '',
                type: item.type === 'show' ? 'show' : 'movie',
                ids: idsFromGuids(item.Guid || item.guid),
                plexGuid: item.guid || '',
            }));
        },
        async sessions(baseUrl, token) {
            const payload = await getJson(baseUrl, token, '/status/sessions');
            return mediaList(payload);
        },
        async metadata(baseUrl, token, ratingKey) {
            const payload = await getJson(
                baseUrl,
                token,
                `/library/metadata/${encodeURIComponent(ratingKey)}?includeGuids=1`,
            );
            const item = mediaList(payload)[0];
            if (!item) return null;
            return { ids: idsFromGuids(item.Guid || item.guid) };
        },
        async account(token) {
            const response = await fetchImpl('https://plex.tv/api/v2/user', {
                headers: {
                    Accept: 'application/json',
                    'X-Plex-Token': token,
                },
            });
            if (!response.ok) throw new Error(`Plex account lookup failed (${response.status})`);
            const payload = await response.json();
            return {
                id: String(payload.id || ''),
                username: String(payload.username || payload.title || payload.email || ''),
            };
        },
    };
};
