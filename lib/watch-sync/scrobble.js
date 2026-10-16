/** Decide Trakt scrobble calls from Plex session snapshots. */

const WATCHED_PROGRESS = 80;

const roundProgress = (value) => Math.round(Number(value) * 10) / 10;

const positiveInt = (value) => {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : null;
};

const cleanIds = (ids, { allowTvdb }) => {
    const out = {};
    const imdb = String(ids?.imdb || '').trim().toLowerCase();
    if (/^tt\d{5,}$/.test(imdb)) out.imdb = imdb;
    const tmdb = positiveInt(ids?.tmdb);
    if (tmdb) out.tmdb = tmdb;
    if (allowTvdb) {
        const tvdb = positiveInt(ids?.tvdb);
        if (tvdb) out.tvdb = tvdb;
    }
    return out;
};

const withTitle = (body, title) => {
    const text = String(title || '').trim();
    if (text) body.title = text;
    return body;
};

export const traktScrobbleBody = (session) => {
    const rawProgress = roundProgress(session?.progress);
    if (!Number.isFinite(rawProgress)) return null;
    const progress = Math.min(100, Math.max(1, rawProgress));
    if (session?.type === 'movie') {
        const ids = cleanIds(session.ids, { allowTvdb: false });
        if (!Object.keys(ids).length) return null;
        const movie = withTitle({ ids }, session.title);
        const year = positiveInt(session.year);
        if (year) movie.year = year;
        return { progress, movie };
    }
    if (session?.type !== 'episode') return null;
    const showIds = cleanIds(session.showIds, { allowTvdb: true });
    const ids = showIds.tvdb ? { tvdb: showIds.tvdb } : (showIds.imdb ? { imdb: showIds.imdb } : (showIds.tmdb ? { tmdb: showIds.tmdb } : null));
    const season = Number(session.season);
    const episode = positiveInt(session.episode);
    if (!ids || !Number.isInteger(season) || season < 0 || !episode) return null;
    return {
        progress,
        show: withTitle({ ids }, session.showTitle),
        episode: { season, number: episode },
    };
};

/**
 * @param {Record<string, object>} previous Last poll, keyed by session id
 * @param {Array<object>} current Sessions still playing for the linked Plex account
 */
export const planScrobbles = (previous, current) => {
    const prior = previous && typeof previous === 'object' ? previous : {};
    const actions = [];
    const next = {};
    const seen = new Set();

    for (const session of current || []) {
        const key = String(session?.sessionKey || '');
        if (!key || !traktScrobbleBody(session)) continue;
        seen.add(key);
        const prev = prior[key];
        const progress = roundProgress(session.progress);
        const playing = session.player !== 'paused';
        const baseline = Number.isFinite(prev?.lastSent) ? prev.lastSent : prev?.progress;
        let action = null;
        if (prev?.stopped || prev?.rejected) {
            action = null;
        } else if (!prev) {
            if (progress >= WATCHED_PROGRESS) action = 'stop';
            else action = playing ? 'start' : 'pause';
        } else if (!playing && prev.player !== 'paused') {
            action = 'pause';
        } else if (playing && prev.player === 'paused') {
            action = 'start';
        } else if (playing && progress >= WATCHED_PROGRESS && prev.progress < WATCHED_PROGRESS) {
            action = 'stop';
        } else if (playing && progress < WATCHED_PROGRESS && Math.abs(progress - baseline) >= 10) {
            action = 'start';
        }
        const sentNow = action === 'start' || action === 'stop';
        next[key] = {
            ...session,
            progress,
            player: playing ? 'playing' : 'paused',
            stopped: action === 'stop' || !!prev?.stopped,
            rejected: !!prev?.rejected,
            lastSent: sentNow || !Number.isFinite(prev?.lastSent) ? progress : prev.lastSent,
        };
        if (action) actions.push({ action, session: next[key] });
    }

    for (const [key, prev] of Object.entries(prior)) {
        if (seen.has(key) || prev?.stopped || prev?.rejected) continue;
        const action = prev.progress >= WATCHED_PROGRESS ? 'stop' : 'pause';
        actions.push({ action, session: prev });
    }

    return { actions, next };
};
