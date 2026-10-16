import {
    chunk,
    decideRating,
    decideWatched,
    episodeKey,
    hasAnyId,
    indexByIds,
    movieKey,
    normalizeRating,
} from './ids.js';
import { loadWatchSyncSnapshot, saveWatchSyncSnapshot } from './config.js';

const toIso = (value) => {
    if (value == null || value === '') return new Date().toISOString();
    if (typeof value === 'number' || /^\d+$/.test(String(value))) {
        const n = Number(value);
        const date = new Date(n > 1e12 ? n : n * 1000);
        return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
};

const traktIds = (ids) => {
    const out = {};
    if (ids?.imdb) out.imdb = ids.imdb;
    if (ids?.tmdb) out.tmdb = Number(ids.tmdb);
    if (ids?.tvdb) out.tvdb = Number(ids.tvdb);
    return out;
};

const preferShowIds = (ids) => {
    if (ids?.tvdb) return { tvdb: Number(ids.tvdb) };
    if (ids?.imdb) return { imdb: ids.imdb };
    if (ids?.tmdb) return { tmdb: Number(ids.tmdb) };
    return {};
};

const pool = async (items, limit, worker) => {
    const queue = [...(items || [])];
    const failed = [];
    const width = Math.min(Math.max(limit, 1), Math.max(queue.length, 1));
    const workers = Array.from({ length: queue.length ? width : 0 }, async () => {
        while (queue.length) {
            const item = queue.shift();
            try {
                await worker(item);
            } catch {
                failed.push(item);
            }
        }
    });
    await Promise.all(workers);
    return failed;
};

const groupHistoryShows = (episodes) => {
    const shows = new Map();
    for (const episode of episodes) {
        const key = movieKey(episode.showIds);
        if (!key) continue;
        if (!shows.has(key)) shows.set(key, { ids: preferShowIds(episode.showIds), seasons: new Map() });
        const show = shows.get(key);
        const season = Number(episode.season);
        if (!show.seasons.has(season)) show.seasons.set(season, []);
        show.seasons.get(season).push({
            number: Number(episode.episode),
            watched_at: toIso(episode.watchedAt),
        });
    }
    return [...shows.values()].map((show) => ({
        ids: show.ids,
        seasons: [...show.seasons.entries()].map(([number, episodesInSeason]) => ({
            number,
            episodes: episodesInSeason,
        })),
    }));
};

const indexWatchedEpisodes = (rows) => {
    const map = new Map();
    for (const row of rows || []) {
        const showIds = row?.show?.ids || {};
        for (const season of row.seasons || []) {
            for (const episode of season.episodes || []) {
                const key = episodeKey(showIds, season.number, episode.number);
                if (key) map.set(key, episode.last_watched_at || row.last_watched_at || null);
            }
        }
    }
    return map;
};

const indexRatedEpisodes = (rows) => {
    const map = new Map();
    for (const row of rows || []) {
        const showIds = row?.show?.ids || {};
        const season = row?.episode?.season;
        const number = row?.episode?.number;
        const key = episodeKey(showIds, season, number);
        if (key) map.set(key, normalizeRating(row.rating));
    }
    return map;
};

const emptySummary = () => ({
    plexMovies: 0,
    plexEpisodes: 0,
    traktWatchedMovies: 0,
    traktWatchedEpisodes: 0,
    watchedToTrakt: 0,
    watchedToPlex: 0,
    ratingsToTrakt: 0,
    ratingsToPlex: 0,
    collectionToTrakt: 0,
    watchlistToTrakt: 0,
    watchlistToPlex: 0,
    skipped: 0,
    failed: 0,
});

export const runWatchSync = async ({
    config,
    saveConfig,
    plex,
    trakt,
    plexConn,
    onProgress,
    shouldCancel,
    systemJob,
    markTaskStart,
    markTaskEnd,
}) => {
    const summary = emptySummary();
    const note = (message) => {
        if (typeof onProgress === 'function') onProgress(message);
    };
    if (systemJob && typeof markTaskStart === 'function') markTaskStart(systemJob);
    try {
        if (!config.clientId || !config.clientSecret) {
            throw new Error('Add a Trakt client ID and client secret on the Watch Sync page.');
        }
        if (!config.accessToken) throw new Error('Connect a Trakt account before syncing.');
        if (!plexConn?.base_url || !plexConn?.token) {
            throw new Error('Configure the Plex server URL and token under Settings → Media Player.');
        }

        let live = config;
        note('Refreshing Trakt login');
        live = await trakt.refreshIfNeeded(live, saveConfig);

        note('Reading Plex libraries');
        const library = await plex.collect(
            plexConn.base_url,
            plexConn.token,
            live.libraryIds,
            note,
        );
        summary.plexMovies = library.movies.length;
        summary.plexEpisodes = library.episodes.length;

        note('Reading Trakt');
        const [
            watchedMovies,
            watchedShows,
            ratingMovies,
            ratingEpisodes,
            collectionMovies,
            collectionShows,
            watchlistMovies,
            watchlistShows,
        ] = await Promise.all([
            live.plexToTrakt.watched || live.traktToPlex.watched ? trakt.watchedMovies(live) : [],
            live.plexToTrakt.watched || live.traktToPlex.watched ? trakt.watchedShows(live) : [],
            live.plexToTrakt.ratings || live.traktToPlex.ratings ? trakt.ratingsMovies(live) : [],
            live.plexToTrakt.ratings || live.traktToPlex.ratings ? trakt.ratingsEpisodes(live) : [],
            live.plexToTrakt.collection ? trakt.collectionMovies(live) : [],
            live.plexToTrakt.collection ? trakt.collectionShows(live) : [],
            live.plexToTrakt.watchlist || live.traktToPlex.watchlist ? trakt.watchlistMovies(live) : [],
            live.plexToTrakt.watchlist || live.traktToPlex.watchlist ? trakt.watchlistShows(live) : [],
        ]);

        const traktMovieWatched = indexByIds(watchedMovies, (row) => row?.movie?.ids || {});
        const traktMovieRatings = indexByIds(ratingMovies, (row) => row?.movie?.ids || {});
        const traktMovieCollection = indexByIds(collectionMovies, (row) => row?.movie?.ids || {});
        const traktShowCollection = indexByIds(collectionShows, (row) => row?.show?.ids || {});
        const traktMovieWatch = indexByIds(watchlistMovies, (row) => row?.movie?.ids || {});
        const traktShowWatch = indexByIds(watchlistShows, (row) => row?.show?.ids || {});
        const watchedEpisodeAt = indexWatchedEpisodes(watchedShows);
        const ratedEpisodes = indexRatedEpisodes(ratingEpisodes);
        summary.traktWatchedMovies = watchedMovies.length;
        summary.traktWatchedEpisodes = watchedEpisodeAt.size;

        const snapshot = await loadWatchSyncSnapshot();
        const cachedEntries = Object.keys(snapshot.movies).length + Object.keys(snapshot.episodes).length + Object.keys(snapshot.shows).length;
        if (cachedEntries) note(`Local cache: ${cachedEntries} titles remembered`);
        const nextMovies = { ...snapshot.movies };
        const nextEpisodes = { ...snapshot.episodes };
        const nextShows = { ...snapshot.shows };
        const nextWatchlist = { ...snapshot.watchlist };

        const historyMovies = [];
        const historyEpisodes = [];
        const plexWatches = [];
        const ratingMoviesOut = [];
        const ratingEpisodesOut = [];
        const plexRates = [];
        const collectionOutMovies = [];
        const collectionOutShows = [];
        const watchlistOutMovies = [];
        const watchlistOutShows = [];
        const plexWatchlist = [];

        const cancel = () => (typeof shouldCancel === 'function' ? shouldCancel() : false);

        for (const movie of library.movies) {
            const key = movieKey(movie.ids);
            if (!key) {
                summary.skipped += 1;
                continue;
            }
            const prev = snapshot.movies[key] || null;
            const traktWatched = traktMovieWatched.find(movie.ids);
            const traktRatingRow = traktMovieRatings.find(movie.ids);
            const plexWatched = !!movie.watched;
            const traktIsWatched = !!traktWatched;
            const watchAction = decideWatched({
                plexWatched,
                traktWatched: traktIsWatched,
                prev,
                plexToTrakt: live.plexToTrakt.watched,
                traktToPlex: live.traktToPlex.watched,
                plexAt: movie.watchedAt,
                traktAt: traktWatched?.last_watched_at,
            });
            if (watchAction === 'toTrakt') historyMovies.push(movie);
            if (watchAction === 'toPlex') plexWatches.push(movie);

            const ratingAction = decideRating({
                plexRating: movie.rating,
                traktRating: traktRatingRow?.rating,
                prev,
                plexToTrakt: live.plexToTrakt.ratings,
                traktToPlex: live.traktToPlex.ratings,
            });
            if (ratingAction === 'toTrakt') ratingMoviesOut.push({ ids: traktIds(movie.ids), rating: normalizeRating(movie.rating) });
            if (ratingAction === 'toPlex') {
                plexRates.push({
                    ratingKey: movie.ratingKey,
                    rating: normalizeRating(traktRatingRow.rating),
                    ids: movie.ids,
                    previousRating: normalizeRating(movie.rating),
                });
            }

            const collected = !!traktMovieCollection.find(movie.ids) || !!prev?.collected;
            if (live.plexToTrakt.collection && !collected) {
                collectionOutMovies.push({ key, ids: traktIds(movie.ids) });
            }
            if (live.traktToPlex.watchlist && traktMovieWatch.find(movie.ids) && movie.plexGuid) {
                plexWatchlist.push(movie);
            }

            nextMovies[key] = {
                plexWatched,
                traktWatched: traktIsWatched || !!prev?.traktWatched,
                plexRating: normalizeRating(movie.rating),
                traktRating: normalizeRating(traktRatingRow?.rating) ?? normalizeRating(prev?.traktRating),
                collected,
            };
        }

        for (const show of library.shows) {
            const key = movieKey(show.ids);
            if (!key) continue;
            const prev = snapshot.shows[key] || null;
            const collected = !!traktShowCollection.find(show.ids) || !!prev?.collected;
            if (live.plexToTrakt.collection && !collected) {
                collectionOutShows.push({ key, ids: traktIds(show.ids) });
            }
            if (live.traktToPlex.watchlist && traktShowWatch.find(show.ids) && show.plexGuid && !nextWatchlist[key]) {
                plexWatchlist.push(show);
            }
            nextShows[key] = { collected };
        }

        for (const episode of library.episodes) {
            const key = episodeKey(episode.showIds, episode.season, episode.episode);
            if (!key) {
                summary.skipped += 1;
                continue;
            }
            const prev = snapshot.episodes[key] || null;
            const traktAt = watchedEpisodeAt.has(key) ? watchedEpisodeAt.get(key) : null;
            const traktWatched = watchedEpisodeAt.has(key);
            const traktRating = ratedEpisodes.has(key) ? ratedEpisodes.get(key) : null;
            const watchAction = decideWatched({
                plexWatched: episode.watched,
                traktWatched,
                prev,
                plexToTrakt: live.plexToTrakt.watched,
                traktToPlex: live.traktToPlex.watched,
                plexAt: episode.watchedAt,
                traktAt,
            });
            if (watchAction === 'toTrakt') historyEpisodes.push(episode);
            if (watchAction === 'toPlex') plexWatches.push(episode);

            const ratingAction = decideRating({
                plexRating: episode.rating,
                traktRating,
                prev,
                plexToTrakt: live.plexToTrakt.ratings,
                traktToPlex: live.traktToPlex.ratings,
            });
            if (ratingAction === 'toTrakt' && hasAnyId(episode.episodeIds)) {
                ratingEpisodesOut.push({
                    key,
                    ids: traktIds(episode.episodeIds),
                    rating: normalizeRating(episode.rating),
                });
            } else if (ratingAction === 'toTrakt') {
                summary.skipped += 1;
            }
            if (ratingAction === 'toPlex') {
                plexRates.push({
                    ratingKey: episode.ratingKey,
                    rating: traktRating,
                    showIds: episode.showIds,
                    season: episode.season,
                    episode: episode.episode,
                    previousRating: normalizeRating(episode.rating),
                });
            }

            nextEpisodes[key] = {
                plexWatched: !!episode.watched,
                traktWatched: traktWatched || !!prev?.traktWatched,
                plexRating: normalizeRating(episode.rating),
                traktRating: traktRating ?? normalizeRating(prev?.traktRating),
            };
        }

        if (cancel()) throw new Error('Sync cancelled');

        const watchTotal = historyMovies.length + historyEpisodes.length;
        let watchesSent = 0;
        const remember = async () => {
            await saveWatchSyncSnapshot({
                movies: nextMovies,
                episodes: nextEpisodes,
                shows: nextShows,
                watchlist: nextWatchlist,
            });
        };
        await remember();
        note(watchTotal
            ? `Sending ${watchTotal} watches to Trakt in small batches`
            : 'No new watches to send to Trakt');
        for (const batch of chunk(historyMovies, 50)) {
            if (cancel()) throw new Error('Sync cancelled');
            await trakt.addHistory(live, {
                movies: batch.map((movie) => ({
                    ids: traktIds(movie.ids),
                    watched_at: toIso(movie.watchedAt),
                })),
            });
            for (const movie of batch) {
                const key = movieKey(movie.ids);
                if (key && nextMovies[key]) nextMovies[key].traktWatched = true;
            }
            summary.watchedToTrakt += batch.length;
            watchesSent += batch.length;
            note(`Watches sent to Trakt: ${watchesSent}/${watchTotal}`);
            await remember();
        }
        for (const batch of chunk(historyEpisodes, 80)) {
            if (cancel()) throw new Error('Sync cancelled');
            await trakt.addHistory(live, { shows: groupHistoryShows(batch) });
            for (const episode of batch) {
                const key = episodeKey(episode.showIds, episode.season, episode.episode);
                if (key && nextEpisodes[key]) nextEpisodes[key].traktWatched = true;
            }
            summary.watchedToTrakt += batch.length;
            watchesSent += batch.length;
            note(`Watches sent to Trakt: ${watchesSent}/${watchTotal}`);
            await remember();
        }

        note(`Marking ${plexWatches.length} items watched in Plex`);
        const failedWatches = await pool(plexWatches, 4, (item) => plex.scrobble(plexConn.base_url, plexConn.token, item.ratingKey));
        const failedWatchSet = new Set(failedWatches);
        for (const item of plexWatches) {
            if (failedWatchSet.has(item)) continue;
            if (item.showIds) {
                const key = episodeKey(item.showIds, item.season, item.episode);
                if (key && nextEpisodes[key]) nextEpisodes[key].plexWatched = true;
            } else {
                const key = movieKey(item.ids);
                if (key && nextMovies[key]) nextMovies[key].plexWatched = true;
            }
        }
        summary.failed += failedWatches.length;
        summary.watchedToPlex += plexWatches.length - failedWatches.length;
        await remember();

        for (const batch of chunk(ratingMoviesOut, 50)) {
            await trakt.addRatings(live, { movies: batch.map(({ ids, rating }) => ({ ids, rating })) });
            for (const item of batch) {
                const key = movieKey(item.ids);
                if (key && nextMovies[key]) nextMovies[key].traktRating = item.rating;
            }
            summary.ratingsToTrakt += batch.length;
            await remember();
        }
        for (const batch of chunk(ratingEpisodesOut, 50)) {
            await trakt.addRatings(live, {
                episodes: batch.map(({ ids, rating }) => ({ ids, rating })),
            });
            for (const item of batch) {
                if (item.key && nextEpisodes[item.key]) nextEpisodes[item.key].traktRating = item.rating;
            }
            summary.ratingsToTrakt += batch.length;
            await remember();
        }
        const failedRates = await pool(plexRates, 4, (item) => plex.rate(plexConn.base_url, plexConn.token, item.ratingKey, item.rating));
        const failedRateSet = new Set(failedRates);
        for (const item of plexRates) {
            if (failedRateSet.has(item)) continue;
            if (item.showIds) {
                const key = episodeKey(item.showIds, item.season, item.episode);
                if (key && nextEpisodes[key]) nextEpisodes[key].plexRating = item.rating;
            } else {
                const key = movieKey(item.ids);
                if (key && nextMovies[key]) nextMovies[key].plexRating = item.rating;
            }
        }
        summary.failed += failedRates.length;
        summary.ratingsToPlex += plexRates.length - failedRates.length;
        await remember();

        if (collectionOutMovies.length || collectionOutShows.length) {
            note(`Adding ${collectionOutMovies.length + collectionOutShows.length} titles to the Trakt collection`);
        }
        for (const batch of chunk(collectionOutMovies, 50)) {
            if (cancel()) throw new Error('Sync cancelled');
            await trakt.addCollection(live, { movies: batch.map(({ ids }) => ({ ids })) });
            for (const item of batch) {
                if (item.key && nextMovies[item.key]) nextMovies[item.key].collected = true;
            }
            summary.collectionToTrakt += batch.length;
            if (summary.collectionToTrakt % 500 === 0) note(`Collection sent to Trakt: ${summary.collectionToTrakt}`);
            await remember();
        }
        for (const batch of chunk(collectionOutShows, 50)) {
            if (cancel()) throw new Error('Sync cancelled');
            await trakt.addCollection(live, { shows: batch.map(({ ids }) => ({ ids })) });
            for (const item of batch) {
                if (item.key) nextShows[item.key] = { ...(nextShows[item.key] || {}), collected: true };
            }
            summary.collectionToTrakt += batch.length;
            await remember();
        }

        if (live.plexToTrakt.watchlist) {
            try {
                note('Reading Plex watchlist');
                const plexItems = await plex.watchlist(plexConn.token);
                for (const item of plexItems) {
                    const key = movieKey(item.ids);
                    if (!key || nextWatchlist[key]) continue;
                    const existing = item.type === 'show' ? traktShowWatch.find(item.ids) : traktMovieWatch.find(item.ids);
                    if (existing) {
                        nextWatchlist[key] = true;
                        continue;
                    }
                    if (item.type === 'show') watchlistOutShows.push({ key, ids: traktIds(item.ids) });
                    else watchlistOutMovies.push({ key, ids: traktIds(item.ids) });
                }
            } catch (error) {
                note(`Plex watchlist skipped: ${error.message}`);
            }
        }
        for (const batch of chunk(watchlistOutMovies, 50)) {
            await trakt.addWatchlist(live, { movies: batch.map(({ ids }) => ({ ids })) });
            for (const item of batch) nextWatchlist[item.key] = true;
            summary.watchlistToTrakt += batch.length;
            await remember();
        }
        for (const batch of chunk(watchlistOutShows, 50)) {
            await trakt.addWatchlist(live, { shows: batch.map(({ ids }) => ({ ids })) });
            for (const item of batch) nextWatchlist[item.key] = true;
            summary.watchlistToTrakt += batch.length;
            await remember();
        }
        if (live.traktToPlex.watchlist) {
            const failedWatchlist = await pool(plexWatchlist, 3, (item) => plex.addToWatchlist(plexConn.base_url, plexConn.token, item.plexGuid));
            summary.failed += failedWatchlist.length;
            summary.watchlistToPlex += plexWatchlist.length - failedWatchlist.length;
        }

        await remember();
        const lastRun = {
            at: new Date().toISOString(),
            ok: summary.failed === 0,
            summary,
        };
        if (typeof saveConfig === 'function') {
            await saveConfig({ ...live, lastRunAt: lastRun.at, lastRun });
        }
        note('Sync finished');
        if (systemJob && typeof markTaskEnd === 'function') markTaskEnd(systemJob, null);
        return { ok: true, summary };
    } catch (error) {
        if (systemJob && typeof markTaskEnd === 'function') markTaskEnd(systemJob, error);
        throw error;
    }
};
