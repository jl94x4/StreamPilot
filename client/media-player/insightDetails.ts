import type { InsightFavourite, WatchInsights } from './watchInsights';
import type { PlayerItem } from './types';

/**
 * What opens when a box on the Insights page is selected: the same data, one level deeper. Pure
 * functions, so the pieces are easy to test; the panel just draws what these return.
 */

export type DetailRow = { id: string; label: string; value?: string; sub?: string; item?: PlayerItem };
export type DetailSection = {
    title: string;
    rows?: DetailRow[];
    columns?: Array<{ label: string; value: number; hot?: boolean }>;
};
export type InsightDetail = {
    title: string;
    lead: string;
    stats: Array<{ label: string; value: string }>;
    sections: DetailSection[];
};

export type DetailKind =
    | 'hours' | 'titles' | 'episodes' | 'movies' | 'showsFinished' | 'rewatches'
    | 'genres' | 'decades' | 'studios' | 'certificates' | 'countries' | 'when'
    | `fact:${string}`;

type T = (key: string, vars?: Record<string, string | number>) => string;

const HOUR_MS = 3_600_000;
const num = (value: unknown) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
};
const round1 = (value: number) => Math.round(value * 10) / 10;
const isShow = (row: InsightFavourite) => String(row.item.type || '') === 'show';
const isMovie = (row: InsightFavourite) => String(row.item.type || '') === 'movie';
const byHours = (a: InsightFavourite, b: InsightFavourite) => b.hours - a.hours;
const byRecent = (a: InsightFavourite, b: InsightFavourite) => num(b.item.lastViewedAt) - num(a.item.lastViewedAt);

const runtimeText = (ms: number) => {
    const minutes = Math.round(ms / 60_000);
    return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
};

export const buildInsightDetail = (
    kind: DetailKind,
    ins: WatchInsights,
    t: T,
    locale = 'en',
): InsightDetail => {
    const p = (key: string, vars?: Record<string, string | number>) => t(`mediaPlayerPage.${key}`, vars);
    const hoursText = (hours: number) => p('insightsHoursShort', { count: round1(hours) });
    const dateText = (ms: number) => new Date(ms).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
    const episodesText = (count: number) => p('insightsEpisodesShort', { count });
    const playsText = (count: number) => p('insightsPlaysShort', { count });

    const row = (r: InsightFavourite, value: string, sub = ''): DetailRow => ({
        id: `${r.item.serverId || ''}:${r.item.ratingKey}`,
        label: r.item.title || '',
        value,
        sub,
        item: r.item,
    });
    const timeRow = (r: InsightFavourite) => row(r, hoursText(r.hours), isShow(r) ? episodesText(r.episodes) : playsText(r.plays));

    const all = ins.all;
    const movies = all.filter(isMovie);
    const shows = all.filter(isShow);
    const movieHours = movies.reduce((sum, r) => sum + r.hours, 0);
    const showHours = shows.reduce((sum, r) => sum + r.hours, 0);
    const genreOf = (r: InsightFavourite) => (Array.isArray(r.item.genres) ? r.item.genres : []);

    switch (kind) {
    case 'hours': {
        const films = Math.round(ins.hours / 2);
        return {
            title: p('insightsHours'),
            lead: p('insightsDetHoursLead', { days: ins.days, films }),
            stats: [
                { label: p('insightsDetFilms'), value: hoursText(movieHours) },
                { label: p('insightsDetSeries'), value: hoursText(showHours) },
                { label: p('insightsDetAveragePerTitle'), value: ins.titles ? runtimeText((ins.hours * HOUR_MS) / ins.titles) : '-' },
            ],
            sections: [{ title: p('insightsDetWhereTime'), rows: [...all].sort(byHours).slice(0, 12).map(timeRow) }],
        };
    }
    case 'titles':
        return {
            title: p('insightsTitles'),
            lead: p('insightsDetTitlesLead', { movies: ins.movies, shows: ins.shows }),
            stats: [
                { label: p('insightsMovies'), value: String(ins.movies) },
                { label: p('insightsDetSeries'), value: String(ins.shows) },
                { label: p('insightsShowsFinished'), value: String(ins.showsFinished) },
                { label: p('insightsDetInProgress'), value: String(ins.showsInProgress) },
            ],
            sections: [{
                title: p('insightsDetRecentTitles'),
                rows: [...all].sort(byRecent).slice(0, 12).map((r) => row(r, dateText(num(r.item.lastViewedAt)), r.item.year ? String(r.item.year) : '')),
            }],
        };
    case 'episodes': {
        const withEpisodes = shows.filter((r) => r.episodes > 0);
        const average = withEpisodes.length ? Math.round(ins.episodes / withEpisodes.length) : 0;
        return {
            title: p('insightsEpisodes'),
            lead: p('insightsDetEpisodesLead', { shows: withEpisodes.length, average }),
            stats: [
                { label: p('insightsEpisodes'), value: String(ins.episodes) },
                { label: p('insightsDetSeries'), value: String(withEpisodes.length) },
                { label: p('insightsDetPerSeries'), value: String(average) },
            ],
            sections: [{
                title: p('insightsDetMostEpisodes'),
                rows: [...withEpisodes].sort((a, b) => b.episodes - a.episodes).slice(0, 15)
                    .map((r) => row(r, episodesText(r.episodes), num(r.item.leafCount) > 0 ? p('insightsDetOfTotal', { count: num(r.item.leafCount) }) : '')),
            }],
        };
    }
    case 'movies': {
        const timed = movies.filter((r) => num(r.item.durationMs) > 0);
        const average = timed.length ? timed.reduce((sum, r) => sum + num(r.item.durationMs), 0) / timed.length : 0;
        const longest = [...timed].sort((a, b) => num(b.item.durationMs) - num(a.item.durationMs)).slice(0, 6);
        const shortest = [...timed].sort((a, b) => num(a.item.durationMs) - num(b.item.durationMs)).slice(0, 6);
        return {
            title: p('insightsMovies'),
            lead: p('insightsDetMoviesLead', { count: ins.movies, hours: round1(movieHours) }),
            stats: [
                { label: p('insightsMovies'), value: String(ins.movies) },
                { label: p('insightsDetTotalTime'), value: hoursText(movieHours) },
                { label: p('insightsDetAverageRuntime'), value: average ? runtimeText(average) : '-' },
                { label: p('insightsRewatches'), value: String(ins.rewatches) },
            ],
            sections: [
                { title: p('insightsDetLongest'), rows: longest.map((r) => row(r, runtimeText(num(r.item.durationMs)), r.item.year ? String(r.item.year) : '')) },
                { title: p('insightsDetShortest'), rows: shortest.map((r) => row(r, runtimeText(num(r.item.durationMs)), r.item.year ? String(r.item.year) : '')) },
            ],
        };
    }
    case 'showsFinished': {
        const finished = shows.filter((r) => num(r.item.leafCount) > 0 && r.episodes >= num(r.item.leafCount));
        const going = shows.filter((r) => !(num(r.item.leafCount) > 0 && r.episodes >= num(r.item.leafCount)) && r.episodes > 0);
        return {
            title: p('insightsShowsFinished'),
            lead: p('insightsDetFinishedLead', { finished: finished.length, going: going.length }),
            stats: [
                { label: p('insightsShowsFinished'), value: String(finished.length) },
                { label: p('insightsDetInProgress'), value: String(going.length) },
            ],
            sections: [
                { title: p('insightsDetFinishedList'), rows: [...finished].sort(byRecent).slice(0, 15).map((r) => row(r, episodesText(r.episodes))) },
                {
                    title: p('insightsDetStillGoing'),
                    rows: [...going].sort(byRecent).slice(0, 15).map((r) => {
                        const total = num(r.item.leafCount);
                        return row(r, total ? `${r.episodes}/${total}` : episodesText(r.episodes), total ? `${Math.round((r.episodes / total) * 100)}%` : '');
                    }),
                },
            ],
        };
    }
    case 'rewatches': {
        const again = movies.filter((r) => r.plays > 1).sort((a, b) => b.plays - a.plays || byRecent(a, b));
        return {
            title: p('insightsRewatches'),
            lead: p('insightsDetRewatchLead', { count: again.length }),
            stats: [
                { label: p('insightsRewatches'), value: String(again.length) },
                { label: p('insightsDetExtraPlays'), value: String(again.reduce((sum, r) => sum + (r.plays - 1), 0)) },
            ],
            sections: [{ title: p('insightsDetMostRewatched'), rows: again.slice(0, 15).map((r) => row(r, playsText(r.plays), r.item.year ? String(r.item.year) : '')) }],
        };
    }
    case 'genres': {
        const map = new Map<string, { titles: number; hours: number }>();
        for (const r of all) {
            for (const name of genreOf(r)) {
                const g = map.get(name) || { titles: 0, hours: 0 };
                g.titles += 1;
                g.hours += r.hours;
                map.set(name, g);
            }
        }
        const ranked = [...map.entries()].sort((a, b) => b[1].hours - a[1].hours);
        const topNames = ranked.slice(0, 3).map(([name]) => name);
        return {
            title: p('insightsGenres'),
            lead: p('insightsDetGenresLead', { count: ranked.length }),
            stats: [
                { label: p('insightsDetGenreCount'), value: String(ranked.length) },
                { label: p('insightsDetTopGenre'), value: topNames[0] || '-' },
            ],
            sections: [
                {
                    title: p('insightsDetAllGenres'),
                    rows: ranked.slice(0, 20).map(([name, g]) => ({ id: `g:${name}`, label: name, value: hoursText(g.hours), sub: p('insightsTitlesShort', { count: g.titles }) })),
                },
                ...topNames.map((name) => ({
                    title: p('insightsDetMostIn', { name }),
                    rows: all.filter((r) => genreOf(r).includes(name)).sort(byHours).slice(0, 3).map(timeRow),
                })),
            ],
        };
    }
    case 'decades':
        return {
            title: p('insightsDecades'),
            lead: p('insightsDetDecadesLead', { count: ins.decades.length }),
            stats: ins.decades.slice().sort((a, b) => b.titles - a.titles).slice(0, 4).map((d) => ({ label: d.label, value: p('insightsTitlesShort', { count: d.titles }) })),
            sections: [...ins.decades].reverse().slice(0, 8).map((d) => {
                const decade = Number(d.label.slice(0, 4));
                return {
                    title: `${d.label} · ${p('insightsTitlesShort', { count: d.titles })}`,
                    rows: all.filter((r) => num(r.item.year) >= decade && num(r.item.year) < decade + 10).sort(byHours).slice(0, 3).map(timeRow),
                };
            }),
        };
    case 'studios':
        return {
            title: p('insightsStudios'),
            lead: p('insightsDetStudiosLead', { count: ins.studios.length }),
            stats: ins.studios.slice(0, 4).map((s) => ({ label: s.name, value: p('insightsTitlesShort', { count: s.titles }) })),
            sections: ins.studios.slice(0, 6).map((s) => ({
                title: `${s.name} · ${p('insightsTitlesShort', { count: s.titles })}`,
                rows: all.filter((r) => String(r.item.studio || '').trim() === s.name).sort(byHours).slice(0, 3).map(timeRow),
            })),
        };
    case 'certificates':
        return {
            title: p('insightsCertificates'),
            lead: p('insightsDetCertificatesLead', { count: ins.certificates.length }),
            stats: ins.certificates.slice(0, 4).map((c) => ({ label: c.name, value: p('insightsTitlesShort', { count: c.titles }) })),
            sections: ins.certificates.slice(0, 6).map((c) => ({
                title: `${c.name} · ${p('insightsTitlesShort', { count: c.titles })}`,
                rows: all.filter((r) => String(r.item.contentRating || '').trim() === c.name).sort(byHours).slice(0, 3).map(timeRow),
            })),
        };
    case 'countries':
        return {
            title: p('insightsCountries'),
            lead: p('insightsDetCountriesLead', { count: ins.countries.length }),
            stats: ins.countries.slice(0, 4).map((c) => ({ label: c.name, value: p('insightsTitlesShort', { count: c.titles }) })),
            sections: ins.countries.slice(0, 6).map((c) => ({
                title: `${c.name} · ${p('insightsTitlesShort', { count: c.titles })}`,
                rows: all.filter((r) => (Array.isArray(r.item.countries) ? r.item.countries : []).includes(c.name)).sort(byHours).slice(0, 3).map(timeRow),
            })),
        };
    case 'when': {
        const dayName = (day: number) => new Date(2024, 0, 7 + day).toLocaleDateString(locale, { weekday: 'long' });
        const partNames = [p('insightsMorning'), p('insightsAfternoon'), p('insightsEvening'), p('insightsNight')];
        const busiestHour = ins.hourly.reduce((best, value, hour) => (value > ins.hourly[best] ? hour : best), 0);
        const monthsWithTitles = ins.months.filter((m) => m.titles > 0);
        return {
            title: p('insightsWhen'),
            lead: p('insightsWhenNote'),
            stats: [
                { label: p('insightsDetBusiestDay'), value: ins.peakWeekday == null ? '-' : dayName(ins.peakWeekday) },
                { label: p('insightsDetBusiestPart'), value: ins.peakPart == null ? '-' : partNames[ins.peakPart] },
                { label: p('insightsDetBusiestHour'), value: ins.hourly[busiestHour] > 0 ? `${String(busiestHour).padStart(2, '0')}:00` : '-' },
            ],
            sections: [
                {
                    title: p('insightsDetByHour'),
                    columns: ins.hourly.map((value, hour) => ({ label: String(hour), value, hot: hour === busiestHour && value > 0 })),
                },
                {
                    title: p('insightsDetByDay'),
                    rows: ins.weekdays.map((value, day) => ({ id: `d:${day}`, label: dayName(day), value: p('insightsTitlesShort', { count: value }) })),
                },
                {
                    title: p('insightsMonths'),
                    rows: monthsWithTitles.slice().reverse().map((m) => ({ id: `m:${m.key}`, label: m.label, value: p('insightsTitlesShort', { count: m.titles }) })),
                },
            ],
        };
    }
    default:
        break;
    }

    // Fun facts
    const id = String(kind).slice('fact:'.length);
    const fact = ins.facts.find((f) => f.id === id);
    const title = p(`insightsFact_${id}`);
    const lead = fact ? (id === 'days' ? p('insightsFactDays') : fact.value) : '';
    switch (id) {
    case 'days': {
        const minutes = Math.round(ins.hours * 60);
        return {
            title,
            lead: p('insightsDetHoursLead', { days: ins.days, films: Math.round(ins.hours / 2) }),
            stats: [
                { label: p('insightsDetDays'), value: String(ins.days) },
                { label: p('insightsDetHours'), value: String(Math.round(ins.hours)) },
                { label: p('insightsDetMinutes'), value: String(minutes) },
            ],
            sections: [{ title: p('insightsDetWhereTime'), rows: [...all].sort(byHours).slice(0, 5).map(timeRow) }],
        };
    }
    case 'oldest':
        return {
            title,
            lead: fact ? `${fact.value} · ${fact.detail}` : '',
            stats: [],
            sections: [{
                title: p('insightsDetOldestList'),
                rows: movies.filter((r) => num(r.item.year) >= 1900).sort((a, b) => num(a.item.year) - num(b.item.year)).slice(0, 6)
                    .map((r) => row(r, String(r.item.year), playsText(r.plays))),
            }],
        };
    case 'longest':
        return {
            title,
            lead: fact ? `${fact.value} · ${fact.detail}` : '',
            stats: [],
            sections: [{
                title: p('insightsDetLongest'),
                rows: movies.filter((r) => num(r.item.durationMs) > 0).sort((a, b) => num(b.item.durationMs) - num(a.item.durationMs)).slice(0, 6)
                    .map((r) => row(r, runtimeText(num(r.item.durationMs)), r.item.year ? String(r.item.year) : '')),
            }],
        };
    case 'binge':
        return {
            title,
            lead: fact ? `${fact.value} · ${episodesText(Number(fact.detail))}` : '',
            stats: [],
            sections: [{
                title: p('insightsDetMostEpisodes'),
                rows: shows.filter((r) => r.episodes > 0).sort((a, b) => b.episodes - a.episodes).slice(0, 6).map((r) => row(r, episodesText(r.episodes), hoursText(r.hours))),
            }],
        };
    case 'rewatch':
        return {
            title,
            lead: fact ? `${fact.value} · ${playsText(Number(fact.detail))}` : '',
            stats: [],
            sections: [{
                title: p('insightsDetMostRewatched'),
                rows: movies.filter((r) => r.plays > 1).sort((a, b) => b.plays - a.plays).slice(0, 6).map((r) => row(r, playsText(r.plays))),
            }],
        };
    case 'busiestMonth': {
        const key = ins.busiestMonthKey;
        const inMonth = all.filter((r) => {
            const at = new Date(num(r.item.lastViewedAt));
            return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}` === key;
        }).sort(byRecent);
        return {
            title,
            lead: fact ? `${fact.value} · ${p('insightsTitlesShort', { count: Number(fact.detail) })}` : '',
            stats: [],
            sections: [{ title: p('insightsDetThatMonth'), rows: inMonth.slice(0, 15).map((r) => row(r, dateText(num(r.item.lastViewedAt)))) }],
        };
    }
    case 'topGenre': {
        const name = fact?.value || '';
        return {
            title,
            lead: fact ? `${fact.value} · ${p('insightsTitlesShort', { count: Number(fact.detail) })}` : '',
            stats: [],
            sections: [{ title: p('insightsDetMostIn', { name }), rows: all.filter((r) => genreOf(r).includes(name)).sort(byHours).slice(0, 6).map(timeRow) }],
        };
    }
    case 'avgRuntime':
        return {
            title,
            lead: fact ? `${fact.value} · ${p('insightsTitlesShort', { count: Number(fact.detail) })}` : '',
            stats: [],
            sections: [{
                title: p('insightsDetLongest'),
                rows: movies.filter((r) => num(r.item.durationMs) > 0).sort((a, b) => num(b.item.durationMs) - num(a.item.durationMs)).slice(0, 6)
                    .map((r) => row(r, runtimeText(num(r.item.durationMs)), r.item.year ? String(r.item.year) : '')),
            }],
        };
    case 'newest':
        return {
            title,
            lead: fact ? `${fact.value} · ${fact.detail}` : '',
            stats: [],
            sections: [{
                title: p('insightsDetNewestList'),
                rows: movies.filter((r) => num(r.item.year) >= 1900).sort((a, b) => num(b.item.year) - num(a.item.year)).slice(0, 6)
                    .map((r) => row(r, String(r.item.year), playsText(r.plays))),
            }],
        };
    case 'peakHour':
        return {
            title,
            lead: fact ? `${fact.value} · ${p('insightsTitlesShort', { count: Number(fact.detail) })}` : '',
            stats: [],
            sections: [{
                title: p('insightsDetByHour'),
                columns: ins.hourly.map((value, hour) => ({ label: String(hour), value, hot: `${String(hour).padStart(2, '0')}:00` === fact?.value && value > 0 })),
            }],
        };
    case 'topStudio': {
        const name = fact?.value || '';
        return {
            title,
            lead: fact ? `${fact.value} · ${p('insightsTitlesShort', { count: Number(fact.detail) })}` : '',
            stats: [],
            sections: [{ title: p('insightsDetMostIn', { name }), rows: all.filter((r) => String(r.item.studio || '').trim() === name).sort(byHours).slice(0, 6).map(timeRow) }],
        };
    }
    case 'longestShow':
        return {
            title,
            lead: fact ? `${fact.value} · ${hoursText(Number(fact.detail))}` : '',
            stats: [],
            sections: [{ title: p('insightsDetWhereTime'), rows: shows.filter((r) => r.hours > 0).sort(byHours).slice(0, 6).map(timeRow) }],
        };
    case 'avgRating':
        return {
            title,
            lead: fact ? `${fact.value} · ${p('insightsTitlesShort', { count: Number(fact.detail) })}` : '',
            stats: [],
            sections: [{
                title: p('insightsTopRated'),
                rows: all.filter((r) => num(r.item.userRating) > 0).sort((a, b) => num(b.item.userRating) - num(a.item.userRating)).slice(0, 8)
                    .map((r) => row(r, `${num(r.item.userRating).toFixed(1)}/10`)),
            }],
        };
    case 'inProgress':
        return {
            title,
            lead: fact ? `${fact.value} · ${fact.detail}` : '',
            stats: [],
            sections: [{
                title: p('insightsDetStillGoing'),
                rows: shows.filter((r) => !(num(r.item.leafCount) > 0 && r.episodes >= num(r.item.leafCount))).sort(byRecent).slice(0, 10)
                    .map((r) => row(r, episodesText(r.episodes), num(r.item.leafCount) > 0 ? p('insightsDetOfTotal', { count: num(r.item.leafCount) }) : '')),
            }],
        };
    default:
        return { title, lead, stats: [], sections: [] };
    }
};
