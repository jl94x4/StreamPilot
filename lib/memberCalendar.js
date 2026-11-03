/**
 * A member's own release calendar, as an .ics feed their phone's calendar subscribes to:
 * upcoming episodes of shows they watch, and release dates of titles they requested.
 * Sonarr / Radarr calendar data in, iCalendar text out. No I/O here.
 */

/** Titles compared loosely: case, punctuation, a trailing "(2019)" and "The " don't matter. */
export const normalizeShowTitle = (title) => String(title || '')
    .toLowerCase()
    .replace(/\(\d{4}\)\s*$/, '')
    .replace(/^the\s+/, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '')
    .trim();

const dateOnly = (value) => {
    const text = String(value || '').trim();
    const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return match ? `${match[1]}${match[2]}${match[3]}` : '';
};

const pad = (n) => String(n).padStart(2, '0');

/**
 * @param {object} input
 * @param {Array} input.sonarrItems  Sonarr /api/v3/calendar with includeSeries
 * @param {Array} input.radarrItems  Radarr /api/v3/calendar
 * @param {Array} input.requests     the member's portal requests ({ mediaType, tmdbId, tvdbId? })
 * @param {string[]} input.watchedShowTitles shows in their recent watch history
 * @returns {Array<{ uid: string, date: string, title: string, description: string }>}
 */
export const buildMemberCalendarEvents = ({
    sonarrItems = [],
    radarrItems = [],
    requests = [],
    watchedShowTitles = [],
} = {}) => {
    const watched = new Set(watchedShowTitles.map(normalizeShowTitle).filter(Boolean));
    const requestedTv = new Set();
    const requestedTvdb = new Set();
    const requestedMovies = new Set();
    for (const row of requests || []) {
        const tmdb = Number(row?.tmdbId) || 0;
        const tvdb = Number(row?.tvdbId) || 0;
        if (String(row?.mediaType) === 'movie') {
            if (tmdb) requestedMovies.add(tmdb);
        } else if (String(row?.mediaType) === 'tv') {
            if (tmdb) requestedTv.add(tmdb);
            if (tvdb) requestedTvdb.add(tvdb);
        }
    }

    const events = [];
    const seen = new Set();
    const push = (event) => {
        if (!event.date || seen.has(event.uid)) return;
        seen.add(event.uid);
        events.push(event);
    };

    for (const episode of Array.isArray(sonarrItems) ? sonarrItems : []) {
        const series = episode?.series || {};
        const requested = (series.tmdbId && requestedTv.has(Number(series.tmdbId)))
            || (series.tvdbId && requestedTvdb.has(Number(series.tvdbId)));
        const watching = watched.has(normalizeShowTitle(series.title));
        if (!requested && !watching) continue;
        const season = Number(episode.seasonNumber) || 0;
        const number = Number(episode.episodeNumber) || 0;
        const code = `S${pad(season)}E${pad(number)}`;
        push({
            uid: `ep-${series.tvdbId || series.id || normalizeShowTitle(series.title)}-${code}`,
            date: dateOnly(episode.airDate || episode.airDateUtc),
            title: `${series.title || 'Episode'} ${code}`,
            description: [episode.title, requested ? 'You requested this show.' : 'A show you watch.'].filter(Boolean).join('\n'),
        });
    }

    for (const movie of Array.isArray(radarrItems) ? radarrItems : []) {
        if (!movie?.tmdbId || !requestedMovies.has(Number(movie.tmdbId))) continue;
        const label = `${movie.title || 'Movie'}${movie.year ? ` (${movie.year})` : ''}`;
        const releases = [
            ['cinema', movie.inCinemas, 'In cinemas'],
            ['digital', movie.digitalRelease, 'Digital release'],
            ['physical', movie.physicalRelease, 'Physical release'],
        ];
        for (const [kind, when, what] of releases) {
            push({
                uid: `movie-${movie.tmdbId}-${kind}`,
                date: dateOnly(when),
                title: `${label}: ${what.toLowerCase()}`,
                description: `${what}. You requested this film.`,
            });
        }
    }

    return events.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
};

/** RFC 5545 text escaping. */
const escapeText = (value) => String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');

/** Lines longer than 75 octets continue on the next line after a space (RFC 5545 folding). */
const fold = (line) => {
    const bytes = Buffer.from(line, 'utf8');
    if (bytes.length <= 75) return line;
    const parts = [];
    let current = '';
    let size = 0;
    for (const char of line) {
        const charSize = Buffer.byteLength(char, 'utf8');
        const limit = parts.length ? 74 : 75;
        if (size + charSize > limit) {
            parts.push(current);
            current = '';
            size = 0;
        }
        current += char;
        size += charSize;
    }
    parts.push(current);
    return parts.join('\r\n ');
};

const nextDay = (yyyymmdd) => {
    const date = new Date(Date.UTC(Number(yyyymmdd.slice(0, 4)), Number(yyyymmdd.slice(4, 6)) - 1, Number(yyyymmdd.slice(6, 8)) + 1));
    return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`;
};

const stamp = (now) => {
    const d = new Date(now);
    return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
};

/** All-day events, CRLF line endings, as calendar apps expect. */
export const renderIcs = (events, { calendarName = 'StreamPilot', domain = 'streampilot', now = Date.now() } = {}) => {
    const lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//StreamPilot//Member calendar//EN',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        `X-WR-CALNAME:${escapeText(calendarName)}`,
        'X-PUBLISHED-TTL:PT3H',
        'REFRESH-INTERVAL;VALUE=DURATION:PT3H',
    ];
    for (const event of events) {
        lines.push(
            'BEGIN:VEVENT',
            `UID:${escapeText(event.uid)}@${domain}`,
            `DTSTAMP:${stamp(now)}`,
            `DTSTART;VALUE=DATE:${event.date}`,
            `DTEND;VALUE=DATE:${nextDay(event.date)}`,
            `SUMMARY:${escapeText(event.title)}`,
            `DESCRIPTION:${escapeText(event.description)}`,
            'TRANSP:TRANSPARENT',
            'END:VEVENT',
        );
    }
    lines.push('END:VCALENDAR');
    return `${lines.map(fold).join('\r\n')}\r\n`;
};
