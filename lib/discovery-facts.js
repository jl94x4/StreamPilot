/**
 * Build a pool of trivia-style notes from Wikipedia + selective TMDB highlights.
 */

const formatUsd = (amount) => {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) return null;
    if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2).replace(/\.?0+$/, '')} billion`;
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')} million`;
    if (n >= 1_000) return `$${Math.round(n / 1_000).toLocaleString()}K`;
    return `$${n.toLocaleString()}`;
};

const pickRandom = (items) => {
    if (!items?.length) return null;
    return items[Math.floor(Math.random() * items.length)];
};

const shuffle = (items) => {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
};

const BORING_FACT_PATTERNS = [
    /^original language:/i,
    /^language is /i,
    /^genres include/i,
    /^produced in /i,
    /^the runtime is \d+ minutes/i,
    /^typical episode length/i,
    /^tmdb users rate/i,
    /has a rating of/i,
    /vote average/i,
    /^production companies include/i,
    /^series status:/i,
    /^first premiered on \d/i,
    /^final episode aired/i,
    /^first released in \d/i,
    /^originally aired on/i,
    /^created by [^.]{1,80}\.$/i,
    /^features dialogue in/i,
    /^\d{4}$/,
    /^it is (a|an) \d{4}/i,
    /\bis an american (film|television|animated|comedy|drama)/i,
    /\bis a \d{4} american/i,
    /^the film (is|was) (a|an)/i,
    /^the series (is|was) (a|an)/i,
    /^the show (is|was)/i,
    /^this (film|movie|series|show) (is|was) (a|an)/i,
    /^\[\d+\]$/,
    /citation needed/i,
    /^see also/i,
    /^references/i,
    /^external links/i,
    /^main article:/i,
    /^\^/,
    /\.mw-parser-output/i,
    /^paik \d+/i,
];

const SKIPPED_WIKI_SECTIONS = new Set([
    'plot',
    'synopsis',
    'premise',
    'summary',
    'story',
    'storylines',
    'episodes',
    'cast',
    'characters',
    'main cast',
    'recurring cast',
    'guest cast',
    'release',
    'home media',
    'broadcast',
    'ratings',
    'viewership',
    'references',
    'external links',
    'see also',
    'notes',
    'sources',
    'further reading',
    'explanatory notes',
]);

const INTERESTING_WIKI_SECTIONS = [
    'trivia',
    'production',
    'development',
    'pre-production',
    'filming',
    'post-production',
    'casting',
    'writing',
    'music',
    'soundtrack',
    'marketing',
    'legacy',
    'cultural impact',
    'in popular culture',
    'reception',
    'critical response',
    'controversy',
    'accidents and incidents',
    'behind the scenes',
    'influence',
    'awards and nominations',
];

const INTERESTING_SENTENCE_KEYWORDS = [
    'filmed in', 'shot in', 'filming began', 'principal photography',
    'cameo', 'guest appearance', 'uncredited', 'special guest',
    'originally', 'inspired by', 'based on', 'adapted from',
    'improvised', 'accidentally', 'refused', 'first choice', 'auditioned',
    'rejected', 'almost played', 'turned down', 'replaced', 'recast',
    'box office record', 'highest-grossing', 'commercial success',
    'won the academy award', 'won the emmy', 'won the golden globe',
    'easter egg', 'reference to', 'homage', 'stunt', 'grossed over',
    'deleted scene', 'cut from', 'reshoot', 'animators', 'voice actor',
    'pioneer', 'first ever', 'only the second', 'record for', 'controvers',
    'banned', 'censored', 'lawsuit', 'trademark', 'lawsuit',
];

export const normalizeFactText = (text) => String(text || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&(?:#x([0-9a-f]+)|(\w+));/gi, (_, hex, name) => {
        if (hex) return String.fromCharCode(parseInt(hex, 16));
        const entities = { nbsp: ' ', amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' };
        return entities[String(name || '').toLowerCase()] || '';
    })
    .replace(/\[\s*edit\s*\]/gi, ' ')
    .replace(/\[\s*\d+\s*\]/g, ' ')
    .replace(/\[\d+\]/g, ' ')
    .replace(/\[citation needed\]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const isInterestingFact = (text) => {
    const fact = normalizeFactText(text);
    if (fact.length < 35 || fact.length > 320) return false;
    if (BORING_FACT_PATTERNS.some((pattern) => pattern.test(fact))) return false;
    if (/^===.+===$/.test(fact)) return false;
    if (/^[\d,.\s$]+$/.test(fact)) return false;
    return true;
};

const dedupeFacts = (facts) => {
    const seen = new Set();
    const out = [];
    for (const fact of facts) {
        const normalized = normalizeFactText(fact);
        if (!normalized || !isInterestingFact(normalized)) continue;
        const key = normalized.toLowerCase().replace(/[^\w\s]/g, '').slice(0, 120);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(normalized);
    }
    return out;
};

// Re-apply a pattern until the string stops changing, so removals can't
// splice together a new match (e.g. "<scr<script>ipt>").
const replaceUntilStable = (input, pattern, replacement) => {
    let previous;
    let current = input;
    do {
        previous = current;
        current = current.replace(pattern, replacement);
    } while (current !== previous);
    return current;
};

const stripHtml = (html) => {
    let text = String(html || '')
        .replace(/<ref[^>]*\/>/gi, '')
        .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '');
    // End tags may carry whitespace/attributes (e.g. "</script >"), so match up to ">".
    text = replaceUntilStable(text, /<style\b[\s\S]*?<\/style\b[^>]*>/gi, '');
    text = replaceUntilStable(text, /<script\b[\s\S]*?<\/script\b[^>]*>/gi, '');
    return normalizeFactText(text);
};

const extractListItemsFromHtml = (html) => {
    const items = [];
    const liRegex = /<li[^>]*>([\s\S]*?)<\/li>/gi;
    let match = liRegex.exec(html);
    while (match) {
        const text = stripHtml(match[1]);
        if (text) items.push(text);
        match = liRegex.exec(html);
    }
    return items;
};

const sentenceSplit = (text) => {
    if (!text) return [];
    return text
        .replace(/\[\d+\]/g, '')
        .replace(/\[citation needed\]/gi, '')
        .split(/(?<=[.!?])\s+/)
        .map((s) => normalizeFactText(s))
        .filter((s) => s.length >= 45 && s.length <= 280 && !/^\d+\s*$/.test(s));
};

const sectionMatches = (line, candidates) => {
    const normalized = String(line || '').trim().toLowerCase();
    return candidates.some((name) => normalized === name || normalized.startsWith(`${name} `));
};

const fetchJson = async (fetchFn, url, timeout = 8000) => {
    const res = await fetchFn(url, { timeout });
    if (!res.ok) return null;
    return res.json();
};

const normalizeWikiTitleRoot = (value) => String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s*\(\d{4}.*\)$/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export const scoreWikipediaSearchHit = (hit, title, year, mediaType) => {
    const hitTitle = String(hit?.title || '').trim();
    const wanted = String(title || '').trim();
    if (!hitTitle || !wanted) return -100;

    const hitLower = hitTitle.toLowerCase();
    const wantedRoot = normalizeWikiTitleRoot(wanted);
    const hitRoot = normalizeWikiTitleRoot(hitTitle);
    if (!wantedRoot || !hitRoot) return -100;

    let score = 0;
    if (hitRoot === wantedRoot) score += 24;
    else if (hitRoot.startsWith(`${wantedRoot} `) || hitRoot.startsWith(`${wantedRoot}(`)) score += 18;
    else if (hitRoot.includes(wantedRoot) || wantedRoot.includes(hitRoot)) score += 8;
    else return -100;

    const suffix = mediaType === 'movie' ? 'film' : 'tv series';
    if (hitLower.includes(`(${suffix})`) || hitLower.includes(`(${suffix} `)) score += 8;
    if (year && hitLower.includes(`(${year}`)) score += 12;
    if (mediaType === 'movie' && hitLower.includes('(tv series)')) score -= 20;
    if (mediaType === 'tv' && hitLower.includes('(film)')) score -= 20;
    if (mediaType === 'tv' && hitLower.includes('(video game)')) score -= 24;
    return score;
};

const TITLE_STOP_WORDS = new Set([
    'the', 'and', 'for', 'with', 'from', 'that', 'this', 'into', 'your', 'their', 'about',
]);

export const titlesLikelyMatch = (left, right) => {
    const a = normalizeWikiTitleRoot(left);
    const b = normalizeWikiTitleRoot(right);
    if (!a || !b) return true;
    if (a === b) return true;
    if (a.includes(b) || b.includes(a)) return true;
    const aTokens = a.split(' ').filter((token) => token.length >= 3 && !TITLE_STOP_WORDS.has(token));
    const bTokens = b.split(' ').filter((token) => token.length >= 3 && !TITLE_STOP_WORDS.has(token));
    if (!aTokens.length || !bTokens.length) return true;
    const overlap = aTokens.filter((token) => bTokens.includes(token));
    return overlap.length >= Math.min(2, Math.min(aTokens.length, bTokens.length));
};

export const factRelatesToTitle = (fact, title) => {
    const factNorm = normalizeFactText(fact).toLowerCase();
    const titleRoot = normalizeWikiTitleRoot(title);
    if (!titleRoot) return true;
    if (factNorm.includes(titleRoot)) return true;
    const tokens = titleRoot.split(' ')
        .filter((token) => token.length >= 3 && !TITLE_STOP_WORDS.has(token));
    if (!tokens.length) return true;
    const matches = tokens.filter((token) => factNorm.includes(token));
    if (tokens.length === 1) return matches.length >= 1;
    return matches.length >= Math.min(2, tokens.length);
};

export const filterFactsForTitle = (facts, title) => {
    if (!Array.isArray(facts) || !facts.length || !title) return facts || [];
    const filtered = facts.filter((fact) => factRelatesToTitle(fact, title));
    return filtered.length ? filtered : [];
};

const resolveWikipediaPage = async (fetchFn, title, year, mediaType) => {
    const suffix = mediaType === 'movie' ? 'film' : 'TV series';
    const queries = [
        year ? `${title} (${year} ${suffix})` : null,
        `${title} (${suffix})`,
        title,
    ].filter(Boolean);

    let best = null;
    for (const query of queries) {
        try {
            const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&origin=*&srlimit=5`;
            const searchData = await fetchJson(fetchFn, searchUrl, 6000);
            const hits = searchData?.query?.search || [];
            for (const hit of hits) {
                const score = scoreWikipediaSearchHit(hit, title, year, mediaType);
                if (score < 14) continue;
                if (!best || score > best.score) {
                    best = { hit, score };
                }
            }
            if (best && best.score >= 18) break;
        } catch {
            // try next query
        }
    }
    return best?.hit?.title || null;
};

const fetchWikipediaSectionHtml = async (fetchFn, pageTitle, sectionIndex) => {
    const pageKey = encodeURIComponent(pageTitle.replace(/ /g, '_'));
    const url = `https://en.wikipedia.org/w/api.php?action=parse&page=${pageKey}&section=${sectionIndex}&prop=text&format=json&origin=*`;
    const data = await fetchJson(fetchFn, url, 8000);
    return data?.parse?.text?.['*'] || '';
};

const fetchWikipediaSections = async (fetchFn, pageTitle) => {
    const pageKey = encodeURIComponent(pageTitle.replace(/ /g, '_'));
    const url = `https://en.wikipedia.org/w/api.php?action=parse&page=${pageKey}&prop=sections&format=json&origin=*`;
    const data = await fetchJson(fetchFn, url, 6000);
    return Array.isArray(data?.parse?.sections) ? data.parse.sections : [];
};

const factsFromSectionHtml = (html, { preferBullets = true } = {}) => {
    const facts = [];
    if (preferBullets) {
        facts.push(...extractListItemsFromHtml(html));
    }
    const paragraphText = stripHtml(html.replace(/<li[^>]*>[\s\S]*?<\/li>/gi, ' '));
    for (const sentence of sentenceSplit(paragraphText)) {
        const cleaned = sentence
            .replace(/^(?:[A-Za-z][A-Za-z\s-]*\s*)?\[?\s*edit\s*\]?\s*/gi, '')
            .replace(/^[A-Za-z][A-Za-z\s-]{0,40}\[ edit \]\s*/i, '')
            .trim();
        if (cleaned.length >= 35) facts.push(cleaned);
    }
    return facts;
};

const fetchWikipediaSectionFacts = async (fetchFn, pageTitle) => {
    const sections = await fetchWikipediaSections(fetchFn, pageTitle);
    const facts = [];
    let fetchedSections = 0;

    const rankedSections = [...sections].sort((a, b) => {
        const aLine = String(a?.line || '').toLowerCase();
        const bLine = String(b?.line || '').toLowerCase();
        const score = (line) => {
            if (line.includes('trivia')) return 0;
            if (line.includes('popular culture')) return 1;
            if (line.includes('production') || line.includes('filming') || line.includes('casting')) return 2;
            return 3;
        };
        return score(aLine) - score(bLine);
    });

    for (const section of rankedSections) {
        if (facts.length >= 14 || fetchedSections >= 8) break;

        const line = String(section?.line || '').trim();
        const index = Number(section?.index);
        if (!line || !Number.isFinite(index) || index <= 0) continue;

        const lower = line.toLowerCase();
        if (SKIPPED_WIKI_SECTIONS.has(lower)) continue;
        if (!INTERESTING_WIKI_SECTIONS.some((name) => sectionMatches(lower, [name]))) continue;

        fetchedSections += 1;
        try {
            const html = await fetchWikipediaSectionHtml(fetchFn, pageTitle, index);
            if (!html) continue;
            const preferBullets = lower.includes('trivia') || lower.includes('popular culture');
            facts.push(...factsFromSectionHtml(html, { preferBullets }));
        } catch {
            // skip section
        }
    }

    return dedupeFacts(facts);
};

const fetchWikipediaFallbackSentences = async (fetchFn, pageTitle) => {
    const pageKey = encodeURIComponent(pageTitle.replace(/ /g, '_'));
    const textUrl = `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&titles=${pageKey}&format=json&origin=*`;
    const textData = await fetchJson(fetchFn, textUrl, 8000);
    const pages = textData?.query?.pages || {};
    const page = Object.values(pages)[0];
    const extract = page?.extract || '';

    const withoutPlot = extract.replace(/==\s*(Plot|Synopsis|Premise|Episodes|Cast)\s*==[\s\S]*?(?===|$)/gi, '');
    const sentences = sentenceSplit(withoutPlot);
    const interestingSentences = sentences.filter((sentence) => {
        const lower = sentence.toLowerCase();
        return INTERESTING_SENTENCE_KEYWORDS.some((keyword) => lower.includes(keyword))
            && !lower.startsWith('the film is')
            && !lower.startsWith('the series is')
            && !lower.includes('is an american');
    });

    return dedupeFacts(interestingSentences);
};

export const fetchWikipediaFacts = async (fetchFn, title, year, mediaType) => {
    if (!title || typeof fetchFn !== 'function') return [];

    const pageTitle = await resolveWikipediaPage(fetchFn, title, year, mediaType);
    if (!pageTitle) return [];

    const sectionFacts = await fetchWikipediaSectionFacts(fetchFn, pageTitle);
    if (sectionFacts.length >= 3) {
        return shuffle(sectionFacts).slice(0, 16);
    }

    const fallbackFacts = await fetchWikipediaFallbackSentences(fetchFn, pageTitle);
    return shuffle(dedupeFacts([...sectionFacts, ...fallbackFacts])).slice(0, 16);
};

export const buildTmdbFacts = (details, mediaType) => {
    const facts = [];
    if (!details || typeof details !== 'object') return facts;

    const title = mediaType === 'movie' ? details.title : details.name;
    const collectionName = details.collection?.name || details.belongsToCollection?.name;

    if (details.tagline?.trim()) {
        facts.push(`Tagline: "${details.tagline.trim()}"`);
    }

    if (mediaType === 'movie') {
        const budget = Number(details.budget);
        const revenue = Number(details.revenue);
        const budgetLabel = formatUsd(budget);
        const revenueLabel = formatUsd(revenue);

        if (budgetLabel && budget >= 100_000_000) {
            facts.push(`The reported production budget was ${budgetLabel} — among the bigger bets in Hollywood.`);
        }
        if (revenueLabel && revenue >= 300_000_000) {
            facts.push(`It went on to gross about ${revenueLabel} worldwide at the box office.`);
        }
        if (budgetLabel && revenueLabel && revenue >= budget * 2 && budget >= 20_000_000) {
            facts.push(`Against a ${budgetLabel} budget, it pulled in roughly ${revenueLabel} worldwide.`);
        }
    }

    if (collectionName) {
        facts.push(`This title is part of the ${collectionName} franchise.`);
    }

    if (mediaType === 'tv') {
        const seasons = Number(details.numberOfSeasons);
        const episodes = Number(details.numberOfEpisodes);
        if (seasons >= 10) {
            facts.push(`${title} has run for ${seasons} seasons${episodes ? ` and ${episodes} episodes` : ''} — a rare long haul for TV.`);
        } else if (episodes >= 150) {
            facts.push(`${title} has aired ${episodes} episodes across ${seasons || 'multiple'} seasons.`);
        }

        const status = String(details.status || '').toLowerCase();
        if (status.includes('cancel') && seasons >= 3) {
            facts.push(`${title} was cancelled after ${seasons} season${seasons === 1 ? '' : 's'}.`);
        }
        if (status.includes('returning') && seasons >= 5) {
            facts.push(`${title} is still going strong after ${seasons} seasons on the air.`);
        }
    }

    return dedupeFacts(facts);
};

export const buildDiscoveryFacts = async ({ details, mediaType, fetchFn, expectedTitle = '' } = {}) => {
    const title = mediaType === 'movie' ? details?.title : details?.name;
    const year = String(
        details?.release_date
        || details?.releaseDate
        || details?.first_air_date
        || details?.firstAirDate
        || '',
    ).slice(0, 4);

    const expected = String(expectedTitle || '').trim();
    const tmdbTitleMatches = !expected || !title || titlesLikelyMatch(expected, title);
    // Episodes often send the series title with a leaf TMDB id. If /tv/{id} 404s
    // or returns a different show, still look up the series trivia by name.
    const wikiTitle = (tmdbTitleMatches && title) ? title : (expected || title || '');

    let wikiFacts = [];
    if (wikiTitle) {
        try {
            wikiFacts = await fetchWikipediaFacts(fetchFn, wikiTitle, year, mediaType);
        } catch {
            wikiFacts = [];
        }
        wikiFacts = filterFactsForTitle(wikiFacts, expected || wikiTitle);
    }

    const tmdbFacts = buildTmdbFacts(details, mediaType);
    const scopedTmdbFacts = filterFactsForTitle(tmdbFacts, expected || title);
    const combined = dedupeFacts([
        ...wikiFacts,
        ...(wikiFacts.length >= 4 ? [] : (scopedTmdbFacts.length ? scopedTmdbFacts : tmdbFacts)),
    ]);

    const facts = shuffle(combined);

    return {
        facts,
        fact: pickRandom(facts) || null,
        sources: {
            wikipedia: wikiFacts.length,
            tmdb: tmdbFacts.length,
        },
    };
};
