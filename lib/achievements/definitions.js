import {
    GENRE_CATALOG,
    genreMovieMetric,
    genreShowMetric,
} from './genres.js';

/**
 * Large data-driven badge catalog.
 * Hundreds of badges are generated from metric + tier templates so the UI
 * stays thin while still feeling packed with goals.
 */

const VIEW_MOVIE_TIERS = [
    [1, 'First Frame', 'Watch your first movie.', '🎬'],
    [3, 'Ticket Stub', 'Watch 3 movies.', '🎟️'],
    [5, 'Matinee Regular', 'Watch 5 movies.', '🍿'],
    [10, 'Weekend Projectionist', 'Watch 10 movies.', '📽️'],
    [15, 'Aisle Hopper', 'Watch 15 movies.', '🪜'],
    [25, 'Silver Screen', 'Watch 25 movies.', '🪩'],
    [40, 'Reel Collector', 'Watch 40 movies.', '🎞️'],
    [50, 'Cinema Buff', 'Watch 50 movies.', '🏛️'],
    [75, 'Marquee Name', 'Watch 75 movies.', '⭐'],
    [100, 'Cinema God', 'Watch 100 movies.', '👑'],
    [125, 'Red Carpet', 'Watch 125 movies.', '🟥'],
    [150, 'Blockbuster Brain', 'Watch 150 movies.', '🧠'],
    [200, 'Festival Circuit', 'Watch 200 movies.', '🎪'],
    [250, 'Director\'s Cut', 'Watch 250 movies.', '🎥'],
    [300, 'Criterion Closet', 'Watch 300 movies.', '🗄️'],
    [400, 'Studio Vault', 'Watch 400 movies.', '🔐'],
    [500, 'Hollywood Archive', 'Watch 500 movies.', '🗽'],
    [750, 'Film Historian', 'Watch 750 movies.', '📜'],
    [1000, 'Immortal Projector', 'Watch 1,000 movies.', '♾️'],
];

const VIEW_EPISODE_TIERS = [
    [1, 'Cold Open', 'Watch your first episode.', '📺'],
    [5, 'Previously On', 'Watch 5 episodes.', '⏪'],
    [10, 'Appointment TV', 'Watch 10 episodes.', '📅'],
    [25, 'Couch Anchor', 'Watch 25 episodes.', '🛋️'],
    [50, 'Season Pass', 'Watch 50 episodes.', '🎫'],
    [75, 'Cliffhanger Addict', 'Watch 75 episodes.', '🪢'],
    [100, 'Binge Initiate', 'Watch 100 episodes.', '🧪'],
    [150, 'Queue Destroyer', 'Watch 150 episodes.', '🧨'],
    [200, 'Series Strategist', 'Watch 200 episodes.', '♟️'],
    [300, 'Arc Completionist', 'Watch 300 episodes.', '🧩'],
    [400, 'Pilot Runner', 'Watch 400 episodes.', '🏃'],
    [500, 'Series Overlord', 'Watch 500 episodes.', '🦅'],
    [750, 'Television Titan', 'Watch 750 episodes.', '🗼'],
    [1000, 'Episode Empire', 'Watch 1,000 episodes.', '🏰'],
    [1500, 'Syndication Soul', 'Watch 1,500 episodes.', '👻'],
    [2000, 'Streaming Sovereign', 'Watch 2,000 episodes.', '🗡️'],
    [3000, 'Infinite Credits', 'Watch 3,000 episodes.', '💫'],
    [5000, 'Showrunner Shadow', 'Watch 5,000 episodes.', '🌑'],
];

const VIEW_SHOW_TIERS = [
    [1, 'Series Spark', 'Watch episodes from 1 unique show.', '✨'],
    [3, 'Channel Surfer', 'Sample 3 unique shows.', '📡'],
    [5, 'Pilot Sampler', 'Sample 5 unique shows.', '🧃'],
    [10, 'Casting Call', 'Sample 10 unique shows.', '🔊'],
    [15, 'Anthology Appetite', 'Sample 15 unique shows.', '📚'],
    [25, 'Network Hopper', 'Sample 25 unique shows.', '🌐'],
    [40, 'Catalog Curator', 'Sample 40 unique shows.', '🗂️'],
    [50, 'Drama Diplomat', 'Sample 50 unique shows.', '🎭'],
    [75, 'Genre Omnivore', 'Sample 75 unique shows.', '🦕'],
    [100, 'Show Encyclopedia', 'Sample 100 unique shows.', '📖'],
    [150, 'Prime Time Atlas', 'Sample 150 unique shows.', '🗺️'],
    [200, 'Series Cartographer', 'Sample 200 unique shows.', '🧭'],
];

const VIEW_MUSIC_TIERS = [
    [1, 'Needle Drop', 'Play your first track.', '🎵'],
    [10, 'Shuffle Starter', 'Play 10 tracks.', '🔀'],
    [25, 'Playlist Pilot', 'Play 25 tracks.', '🎧'],
    [50, 'Volume Up', 'Play 50 tracks.', '🔊'],
    [100, 'Encore Engine', 'Play 100 tracks.', '🔁'],
    [200, 'Bassline Regular', 'Play 200 tracks.', '🎸'],
    [350, 'Mixtape Mage', 'Play 350 tracks.', '🪄'],
    [500, 'Album Hopper', 'Play 500 tracks.', '💿'],
    [750, 'Concert Ghost', 'Play 750 tracks.', '🎤'],
    [1000, 'Sound Stage', 'Play 1,000 tracks.', '🏟️'],
    [2000, 'Frequency Legend', 'Play 2,000 tracks.', '📻'],
    [5000, 'Audio Overlord', 'Play 5,000 tracks.', '👑'],
];

const UNIQUE_MUSIC_TIERS = [
    [1, 'First Album', 'Play 1 unique album/artist group.', '🎶'],
    [5, 'Shelf Starter', 'Discover 5 unique albums.', '📀'],
    [10, 'Crate Digger', 'Discover 10 unique albums.', '🗄️'],
    [25, 'Vinyl Mind', 'Discover 25 unique albums.', '🖤'],
    [50, 'Discography Scout', 'Discover 50 unique albums.', '🕵️'],
    [100, 'Catalog Critic', 'Discover 100 unique albums.', '📝'],
];

const PLAY_TIERS = [
    [10, 'Warming Up', 'Log 10 total plays.', '🔥'],
    [25, 'Getting Into It', 'Log 25 total plays.', '🌡️'],
    [50, 'Regular Viewer', 'Log 50 total plays.', '👀'],
    [100, 'Habitual Streamer', 'Log 100 total plays.', '⏱️'],
    [200, 'Playback Pro', 'Log 200 total plays.', '🏅'],
    [350, 'Always Watching', 'Log 350 total plays.', '👁️‍🗨️'],
    [500, 'Half-K Club', 'Log 500 total plays.', '5️⃣'],
    [750, 'Session Storm', 'Log 750 total plays.', '⛈️'],
    [1000, 'Kilostream', 'Log 1,000 total plays.', '🚀'],
    [1500, 'Deep Buffer', 'Log 1,500 total plays.', '🧊'],
    [2000, 'Double Kilostream', 'Log 2,000 total plays.', '2️⃣'],
    [3000, 'Triple Threat', 'Log 3,000 total plays.', '3️⃣'],
    [5000, 'Playback Planet', 'Log 5,000 total plays.', '🪐'],
    [10000, 'Ten-K Titan', 'Log 10,000 total plays.', '🏛️'],
];

const ACTIVE_DAY_TIERS = [
    [1, 'Day One', 'Be active on 1 day.', '🌤️'],
    [3, 'Three Day Pass', 'Be active on 3 days.', '📆'],
    [7, 'Week of Wonder', 'Be active on 7 days.', '7️⃣'],
    [14, 'Fortnight Fan', 'Be active on 14 days.', '🗓️'],
    [30, 'Monthly Member', 'Be active on 30 days.', '📌'],
    [60, 'Two-Month Torch', 'Be active on 60 days.', '🔦'],
    [90, 'Quarter Quorum', 'Be active on 90 days.', '🌓'],
    [120, 'Four-Month Flame', 'Be active on 120 days.', '🔥'],
    [180, 'Half-Year Habit', 'Be active on 180 days.', '⏳'],
    [270, 'Nine Month Nest', 'Be active on 270 days.', '🪺'],
    [365, 'Year of Streams', 'Be active on 365 days.', '🎂'],
    [500, 'Eternal Calendar', 'Be active on 500 days.', '♾️'],
];

const STREAK_TIERS = [
    [2, 'Back-to-Back', 'Hit a 2-day watch streak.', '🔗'],
    [3, 'Threepeat', 'Hit a 3-day watch streak.', '3️⃣'],
    [5, 'Workweek Warrior', 'Hit a 5-day watch streak.', '💼'],
    [7, 'Streak Week', 'Hit a 7-day watch streak.', '📅'],
    [10, 'Tenacious Ten', 'Hit a 10-day watch streak.', '🔟'],
    [14, 'Fortnight Focus', 'Hit a 14-day watch streak.', '🎯'],
    [21, 'Habit Forge', 'Hit a 21-day watch streak.', '⚒️'],
    [30, 'Monthly Streak', 'Hit a 30-day watch streak.', '🏆'],
    [45, 'Unbroken Chain', 'Hit a 45-day watch streak.', '⛓️'],
    [60, 'Iron Routine', 'Hit a 60-day watch streak.', '🦾'],
    [90, 'Quarter Streak', 'Hit a 90-day watch streak.', '🥇'],
    [180, 'Half-Year Hypnosis', 'Hit a 180-day watch streak.', '🌀'],
];

const WEEKEND_TIERS = [
    [5, 'Saturday Spark', 'Log 5 weekend plays.', '🎉'],
    [15, 'Weekend Warmup', 'Log 15 weekend plays.', '☀️'],
    [30, 'Couch Saturday', 'Log 30 weekend plays.', '🛋️'],
    [50, 'Weekend Warrior', 'Log 50 weekend plays.', '⚔️'],
    [100, 'Saturday Overlord', 'Log 100 weekend plays.', '👸'],
    [200, 'Sunday Sovereign', 'Log 200 weekend plays.', '🌞'],
    [400, 'Weekend Immortal', 'Log 400 weekend plays.', '🌙'],
];

const WEEKDAY_TIERS = [
    [10, 'Weekday Warmup', 'Log 10 weekday plays.', '💼'],
    [25, 'Lunch Break Lore', 'Log 25 weekday plays.', '🥪'],
    [50, 'Commuter Catalog', 'Log 50 weekday plays.', '🚇'],
    [100, 'Weekday Streamer', 'Log 100 weekday plays.', '📊'],
    [250, 'Office Hours Odyssey', 'Log 250 weekday plays.', '🏢'],
    [500, 'Corporate Couch', 'Log 500 weekday plays.', '🧑‍💻'],
];

const BINGE_TIERS = [
    [3, 'Mini Binge', 'Play the same show 3 times.', '🍪'],
    [5, 'Snackable Saga', 'Play the same show 5 times.', '🍫'],
    [8, 'One More Episode', 'Play the same show 8 times.', '⚠️'],
    [12, 'Binge Machine', 'Play the same show 12 times.', '🤖'],
    [20, 'Cannot Stop', 'Play the same show 20 times.', '🛑'],
    [30, 'Arc Absorption', 'Play the same show 30 times.', '🧲'],
    [50, 'Show Possession', 'Play the same show 50 times.', '👻'],
    [75, 'Season Spiral', 'Play the same show 75 times.', '🌪️'],
    [100, 'Ultimate Binge', 'Play the same show 100 times.', '👾'],
];

const PEAK_DAY_TIERS = [
    [5, 'Busy Night', 'Play 5 titles in a single day.', '🌃'],
    [8, 'Heavy Day', 'Play 8 titles in a single day.', '🏋️'],
    [12, 'Marathon Day', 'Play 12 titles in a single day.', '🏁'],
    [18, 'Playback Frenzy', 'Play 18 titles in a single day.', '🌪️'],
    [24, 'Day Destroyer', 'Play 24 titles in a single day.', '💥'],
    [36, 'No Sleep Club', 'Play 36 titles in a single day.', '🦉'],
    [48, 'Liquid Screen', 'Play 48 titles in a single day.', '🫠'],
];

const LIBRARY_DIVERSITY_TIERS = [
    [2, 'Two Shelves', 'Watch across 2 libraries.', '📚'],
    [3, 'Tri-Library', 'Watch across 3 libraries.', '🏛️'],
    [4, 'Quad Quest', 'Watch across 4 libraries.', '🎒'],
    [5, 'Library Nomad', 'Watch across 5 libraries.', '🏕️'],
    [6, 'Shelf Explorer', 'Watch across 6 libraries.', '🔭'],
    [8, 'Catalog Cartographer', 'Watch across 8 libraries.', '🗺️'],
];

const HOURS_TIERS = [
    [1, 'One Hour Wonder', 'Accumulate ~1 hour of watch time.', '⏱️'],
    [5, 'Five-Hour Flight', 'Accumulate ~5 hours of watch time.', '✈️'],
    [10, 'Double Feature Decade', 'Accumulate ~10 hours of watch time.', '🔟'],
    [24, 'Day of Content', 'Accumulate ~24 hours of watch time.', '🌍'],
    [48, 'Two-Day Odyssey', 'Accumulate ~48 hours of watch time.', '🧭'],
    [72, 'Three-Day Siege', 'Accumulate ~72 hours of watch time.', '🛡️'],
    [100, 'Century of Hours', 'Accumulate ~100 hours of watch time.', '💯'],
    [168, 'Week Encoded', 'Accumulate ~168 hours of watch time.', '📦'],
    [250, 'Quarter-Thousand Hours', 'Accumulate ~250 hours of watch time.', '🔋'],
    [500, 'Half-K Hours', 'Accumulate ~500 hours of watch time.', '🛢️'],
    [750, 'Deep Hours', 'Accumulate ~750 hours of watch time.', '🌊'],
    [1000, 'Kilohour Club', 'Accumulate ~1,000 hours of watch time.', '🏆'],
];

const LEVEL_TIERS = [
    [2, 'Level Up', 'Reach level 2.', '⬆️'],
    [3, 'Getting Stronger', 'Reach level 3.', '💪'],
    [5, 'Adept Streamer', 'Reach level 5.', '🎓'],
    [8, 'Skilled Viewer', 'Reach level 8.', '🗡️'],
    [10, 'Double Digits', 'Reach level 10.', '🔟'],
    [15, 'Veteran Seat', 'Reach level 15.', '🪑'],
    [20, 'Elite Buffer', 'Reach level 20.', '💎'],
    [30, 'Mythic Marquee', 'Reach level 30.', '🧿'],
    [40, 'Ascendant Audience', 'Reach level 40.', '🕊️'],
    [50, 'Portal Legend', 'Reach level 50.', '🌟'],
];

const BADGE_ICON_ROTATION = ['🎖️', '🏅', '🥇', '🥈', '🥉', '🏵️', '🎗️', '⭐', '🌟', '✨', '🔥', '💎', '👑', '🚀', '🎯'];

const padTier = (tiers, metric, category, idPrefix, extraTiers) => {
    const out = [...tiers];
    for (const [threshold, name, description, icon] of extraTiers) {
        if (out.some((t) => t[0] === threshold)) continue;
        out.push([threshold, name, description, icon]);
    }
    out.sort((a, b) => a[0] - b[0]);
    return out.map(([threshold, name, description, icon], index) => ({
        id: `${idPrefix}_${threshold}`,
        category,
        metric,
        threshold,
        name,
        description,
        icon: icon || BADGE_ICON_ROTATION[index % BADGE_ICON_ROTATION.length],
        revocable: false,
        rarity: threshold >= 1000 ? 'legendary' : threshold >= 250 ? 'epic' : threshold >= 50 ? 'rare' : 'common',
    }));
};

/** Dense numeric ladder so "hundreds of badges" is real, not decorative. */
const denseLadder = (start, end, step) => {
    const values = [];
    for (let n = start; n <= end; n += step) values.push(n);
    return values;
};

const autoNamedTiers = (values, noun, verb, emoji) => values.map((n, i) => ([
    n,
    `${noun} ${n}`,
    `${verb} ${n.toLocaleString()}.`,
    emoji[i % emoji.length],
]));

const EXTRA_MOVIE = autoNamedTiers(
    denseLadder(600, 2000, 100).concat([2500, 3000]),
    'Movie Milestone',
    'Watch',
    ['🎬', '🎥', '📽️', '🎞️'],
);
const EXTRA_EPISODE = autoNamedTiers(
    denseLadder(600, 4000, 200).concat([6000, 8000, 10000]),
    'Episode Milestone',
    'Watch',
    ['📺', '📡', '🛰️'],
);
const EXTRA_PLAYS = autoNamedTiers(
    denseLadder(600, 8000, 200).concat([12000, 15000, 20000]),
    'Play Milestone',
    'Log',
    ['▶️', '⏩', '⏭️'],
);
const EXTRA_ACTIVE = autoNamedTiers(
    [20, 40, 50, 70, 80, 100, 150, 200, 250, 300, 400, 450, 600, 700, 800, 900, 1000],
    'Active Days',
    'Be active on',
    ['📅', '🗓️', '📌'],
);
const EXTRA_HOURS = autoNamedTiers(
    [15, 20, 30, 36, 40, 60, 80, 120, 150, 200, 300, 400, 600, 800, 1200, 1500, 2000],
    'Hour Milestone',
    'Accumulate ~',
    ['⏱️', '⏳', '⌛'],
).map(([n, name, , icon]) => [n, name, `Accumulate ~${n} hours of watch time.`, icon]);

/**
 * Recurring MM-DD season window (inclusive). Cross-year ranges like 12-15 → 01-05 are supported.
 * Badges without activeFrom/activeUntil are always active.
 */
export const isSeasonActive = (def, now = new Date()) => {
    const from = String(def?.activeFrom || '').trim();
    const until = String(def?.activeUntil || '').trim();
    if (!from && !until) return true;
    const parseMd = (value) => {
        const m = /^(\d{1,2})-(\d{1,2})$/.exec(String(value || '').trim());
        if (!m) return null;
        const month = Number(m[1]);
        const day = Number(m[2]);
        if (!Number.isFinite(month) || !Number.isFinite(day) || month < 1 || month > 12 || day < 1 || day > 31) {
            return null;
        }
        return month * 100 + day;
    };
    const start = parseMd(from);
    const end = parseMd(until);
    if (start == null && end == null) return true;
    const stamp = ((now instanceof Date ? now : new Date()).getMonth() + 1) * 100
        + (now instanceof Date ? now : new Date()).getDate();
    if (start != null && end == null) return stamp >= start;
    if (start == null && end != null) return stamp <= end;
    if (start <= end) return stamp >= start && stamp <= end;
    // Crosses year boundary (e.g. Dec 15 → Jan 5).
    return stamp >= start || stamp <= end;
};

/** Prefer admin season windows that list this badge; else use definition windows. */
export const isBadgeSeasonActive = (def, now = new Date(), seasons = []) => {
    const id = String(def?.id || '');
    const matching = (Array.isArray(seasons) ? seasons : []).filter((season) => (
        Array.isArray(season?.badgeIds) && season.badgeIds.map(String).includes(id)
    ));
    if (matching.length) {
        return matching.some((season) => isSeasonActive(season, now));
    }
    return isSeasonActive(def, now);
};

export const listActiveSpotlightSeasons = (seasons = [], now = new Date()) => (
    (Array.isArray(seasons) ? seasons : []).filter((season) => (
        season?.spotlight !== false && isSeasonActive(season, now)
    ))
);

const SEASONAL_BADGES = [
    {
        id: 'seasonal_halloween',
        category: 'seasonal',
        metric: 'genreMovies_horror',
        threshold: 3,
        name: 'Halloween Haunt',
        description: 'Watch 3 horror movies during Halloween season (Oct 1–31).',
        icon: '🎃',
        revocable: false,
        rarity: 'rare',
        activeFrom: '10-01',
        activeUntil: '10-31',
    },
    {
        id: 'seasonal_holiday_binge',
        category: 'seasonal',
        metric: 'episodePlays',
        threshold: 15,
        name: 'Holiday Binge',
        description: 'Watch 15 episodes during the holidays (Dec 15–Jan 5).',
        icon: '🎄',
        revocable: false,
        rarity: 'rare',
        activeFrom: '12-15',
        activeUntil: '01-05',
    },
    {
        id: 'seasonal_summer_blockbuster',
        category: 'seasonal',
        metric: 'uniqueMovies',
        threshold: 5,
        name: 'Summer Blockbuster',
        description: 'Watch 5 unique movies in summer (Jun 1–Aug 31).',
        icon: '☀️',
        revocable: false,
        rarity: 'common',
        activeFrom: '06-01',
        activeUntil: '08-31',
    },
    {
        id: 'seasonal_new_year_streak',
        category: 'seasonal',
        metric: 'activeDays',
        threshold: 7,
        name: 'New Year Momentum',
        description: 'Log 7 active days in early January (Jan 1–14).',
        icon: '🎆',
        revocable: false,
        rarity: 'rare',
        activeFrom: '01-01',
        activeUntil: '01-14',
    },
];

const SPECIAL_BADGES = [
    {
        id: 'special_night_owl',
        category: 'special',
        metric: 'lateNightPlays',
        threshold: 10,
        name: 'Night Owl',
        description: 'Log 10 plays between midnight and 5 AM.',
        icon: '🦉',
        revocable: false,
        rarity: 'rare',
    },
    {
        id: 'special_early_bird',
        category: 'special',
        metric: 'earlyMorningPlays',
        threshold: 10,
        name: 'Early Bird',
        description: 'Log 10 plays between 5 AM and 9 AM.',
        icon: '🐦',
        revocable: false,
        rarity: 'rare',
    },
    {
        id: 'special_balanced',
        category: 'special',
        metric: 'balancedMedia',
        threshold: 1,
        name: 'Jack of All Screens',
        description: 'Have at least 10 movie plays and 10 episode plays.',
        icon: '⚖️',
        revocable: false,
        rarity: 'rare',
    },
    {
        id: 'special_music_and_movies',
        category: 'special',
        metric: 'musicAndMovies',
        threshold: 1,
        name: 'Soundtrack & Silver',
        description: 'Log movie plays and music plays.',
        icon: '🎹',
        revocable: false,
        rarity: 'common',
    },
    {
        id: 'special_equalizer',
        category: 'special',
        metric: 'threeMediaTypes',
        threshold: 1,
        name: 'Triple Threat Viewer',
        description: 'Play movies, episodes, and music.',
        icon: '🎯',
        revocable: false,
        rarity: 'epic',
    },
    {
        id: 'special_dedication',
        category: 'loyalty',
        metric: 'uniqueTitles',
        threshold: 50,
        name: 'Curious Catalog',
        description: 'Reach 50 unique titles.',
        icon: '🔍',
        revocable: false,
        rarity: 'rare',
    },
    {
        id: 'special_completionist_spirit',
        category: 'loyalty',
        metric: 'uniqueTitles',
        threshold: 200,
        name: 'Completionist Spirit',
        description: 'Reach 200 unique titles.',
        icon: '🏁',
        revocable: false,
        rarity: 'epic',
    },
    {
        id: 'special_horizon',
        category: 'loyalty',
        metric: 'uniqueTitles',
        threshold: 500,
        name: 'Endless Horizon',
        description: 'Reach 500 unique titles.',
        icon: '🌅',
        revocable: false,
        rarity: 'legendary',
    },
];

const GENRE_TIERS = [
    [10, null, null, null],
    [25, null, null, null],
    [50, null, null, null],
    [100, null, null, null],
    [200, null, null, null],
];

const buildGenreBadges = () => {
    const badges = [];
    for (const genre of GENRE_CATALOG) {
        for (const [threshold] of GENRE_TIERS) {
            const rarity = threshold >= 200 ? 'legendary' : threshold >= 100 ? 'epic' : threshold >= 50 ? 'rare' : 'common';
            badges.push({
                id: `genre_movies_${genre.id}_${threshold}`,
                category: 'genres',
                metric: genreMovieMetric(genre.id),
                threshold,
                name: threshold === 10 ? genre.movieName : `${genre.label} Cinema ${threshold}`,
                description: `Watch ${threshold} unique ${genre.label} movies.`,
                icon: genre.icon,
                revocable: false,
                rarity,
            });
            badges.push({
                id: `genre_shows_${genre.id}_${threshold}`,
                category: 'genres',
                metric: genreShowMetric(genre.id),
                threshold,
                name: threshold === 10 ? genre.showName : `${genre.label} Series ${threshold}`,
                description: `Watch episodes from ${threshold} unique ${genre.label} shows.`,
                icon: genre.icon,
                revocable: false,
                rarity,
            });
        }
    }
    badges.push({
        id: 'genre_explorer_5',
        category: 'genres',
        metric: 'genreTagsSeen',
        threshold: 5,
        name: 'Genre Curious',
        description: 'Sample titles across 5 different genres.',
        icon: '🌈',
        revocable: false,
        rarity: 'common',
    });
    badges.push({
        id: 'genre_explorer_10',
        category: 'genres',
        metric: 'genreTagsSeen',
        threshold: 10,
        name: 'Genre Omnivore+',
        description: 'Sample titles across 10 different genres.',
        icon: '🌎',
        revocable: false,
        rarity: 'rare',
    });
    badges.push({
        id: 'genre_explorer_15',
        category: 'genres',
        metric: 'genreTagsSeen',
        threshold: 15,
        name: 'Genre Atlas',
        description: 'Sample titles across 15 different genres.',
        icon: '🗺️',
        revocable: false,
        rarity: 'epic',
    });
    return badges;
};

let cachedDefinitions = null;

export const ACHIEVEMENT_CATEGORIES = [
    { id: 'view', label: 'Movies', description: 'Film milestones' },
    { id: 'series', label: 'Series', description: 'TV & binge goals' },
    { id: 'genres', label: 'Genres', description: 'Comedy, horror, sci-fi & more' },
    { id: 'music', label: 'Music', description: 'Listening milestones' },
    { id: 'activity', label: 'Activity', description: 'Play volume & pace' },
    { id: 'marathon', label: 'Marathons', description: 'Streaks and heavy days' },
    { id: 'loyalty', label: 'Loyalty', description: 'Long-term dedication' },
    { id: 'diversity', label: 'Explorer', description: 'Libraries & variety' },
    { id: 'special', label: 'Special', description: 'Oddball achievements' },
    { id: 'seasonal', label: 'Seasonal', description: 'Limited-time seasonal challenges' },
    { id: 'level', label: 'Levels', description: 'XP level milestones' },
];

export const listBadgeDefinitions = () => {
    if (cachedDefinitions) return cachedDefinitions;

    const badges = [
        ...padTier(VIEW_MOVIE_TIERS, 'uniqueMovies', 'view', 'movies', EXTRA_MOVIE),
        ...padTier(VIEW_EPISODE_TIERS, 'episodePlays', 'series', 'episodes', EXTRA_EPISODE),
        ...padTier(VIEW_SHOW_TIERS, 'uniqueShows', 'series', 'shows', []),
        ...padTier(VIEW_MUSIC_TIERS, 'trackPlays', 'music', 'tracks', denseLadder(1500, 4000, 500).map((n) => [n, `Track Milestone ${n}`, `Play ${n} tracks.`, '🎧'])),
        ...padTier(UNIQUE_MUSIC_TIERS, 'uniqueMusic', 'music', 'albums', []),
        ...padTier(PLAY_TIERS, 'totalPlays', 'activity', 'plays', EXTRA_PLAYS),
        ...padTier(ACTIVE_DAY_TIERS, 'activeDays', 'loyalty', 'days', EXTRA_ACTIVE),
        ...padTier(STREAK_TIERS, 'longestStreak', 'marathon', 'streak', []),
        ...padTier(WEEKEND_TIERS, 'weekendPlays', 'activity', 'weekend', []),
        ...padTier(WEEKDAY_TIERS, 'weekdayPlays', 'activity', 'weekday', []),
        ...padTier(BINGE_TIERS, 'bingeMax', 'marathon', 'binge', []),
        ...padTier(PEAK_DAY_TIERS, 'maxDayPlays', 'marathon', 'peakday', []),
        ...padTier(LIBRARY_DIVERSITY_TIERS, 'libraryDiversity', 'diversity', 'libs', []),
        ...padTier(HOURS_TIERS, 'hoursWatched', 'activity', 'hours', EXTRA_HOURS),
        ...padTier(LEVEL_TIERS, 'level', 'level', 'level', denseLadder(60, 100, 10).map((n) => [n, `Level ${n}`, `Reach level ${n}.`, '🌟'])),
        ...SPECIAL_BADGES,
        ...SEASONAL_BADGES,
        ...buildGenreBadges(),
    ];

    // Stable order: category then threshold
    const categoryOrder = Object.fromEntries(ACHIEVEMENT_CATEGORIES.map((c, i) => [c.id, i]));
    badges.sort((a, b) => {
        const ca = categoryOrder[a.category] ?? 99;
        const cb = categoryOrder[b.category] ?? 99;
        if (ca !== cb) return ca - cb;
        return (a.threshold || 0) - (b.threshold || 0);
    });

    cachedDefinitions = badges;
    return cachedDefinitions;
};

export const getBadgeDefinitionMap = () => {
    const map = new Map();
    for (const badge of listBadgeDefinitions()) map.set(badge.id, badge);
    return map;
};

export const countBadgeDefinitions = () => listBadgeDefinitions().length;
