import fs from 'fs/promises';
import path from 'path';
import { CONFIG_DIR } from '../data-paths.js';

const FILE_NAME = 'media-player-popular-searches.json';

const cleanQuery = (value) => String(value || '').trim().replace(/\s+/g, ' ');

const sameTyping = (a, b) => {
    const left = cleanQuery(a).toLowerCase();
    const right = cleanQuery(b).toLowerCase();
    if (!left || !right || left === right) return left === right && left.length > 0;
    return left.startsWith(right) || right.startsWith(left);
};

const normalize = (entries) => (Array.isArray(entries) ? entries : [])
    .map((row) => ({
        query: cleanQuery(row?.query),
        count: Math.max(0, Math.floor(Number(row?.count) || 0)),
        at: Math.max(0, Math.floor(Number(row?.at) || 0)),
    }))
    .filter((row) => row.query.length >= 2 && row.count > 0);

/** Add one committed search. A longer query replaces the shorter one it was typed from. */
export const bumpPopularQueries = (entries, query, now = Date.now()) => {
    const next = cleanQuery(query);
    const rows = normalize(entries);
    if (next.length < 2) return rows;
    const related = rows.filter((row) => sameTyping(row.query, next));
    const rest = rows.filter((row) => !sameTyping(row.query, next));
    const longest = related.reduce((best, row) => (row.query.length > best.length ? row.query : best), next);
    const count = related.reduce((sum, row) => sum + row.count, 0) + 1;
    return [{ query: longest, count, at: now }, ...rest];
};

/**
 * Most-used queries. Skips anything already sitting in Recent, including a
 * shorter version of the same words.
 */
export const listPopularQueries = (entries, { limit = 8, minCount = 2, skip = [] } = {}) => (
    normalize(entries)
        .filter((row) => row.count >= minCount)
        .filter((row) => !skip.some((item) => sameTyping(item, row.query)))
        .sort((a, b) => (b.count - a.count) || (b.at - a.at))
        .slice(0, limit)
        .map((row) => row.query)
);

const filePath = () => path.join(CONFIG_DIR, FILE_NAME);

let chain = Promise.resolve();
const withLock = (fn) => {
    const run = chain.then(fn, fn);
    chain = run.catch(() => {});
    return run;
};

const readEntries = async () => {
    try {
        const raw = await fs.readFile(filePath(), 'utf8');
        const parsed = JSON.parse(raw);
        return normalize(parsed?.queries);
    } catch (error) {
        if (error?.code === 'ENOENT') return [];
        return [];
    }
};

const writeEntries = async (entries) => {
    await fs.mkdir(CONFIG_DIR, { recursive: true });
    const file = filePath();
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, `${JSON.stringify({ queries: normalize(entries) }, null, 2)}\n`, 'utf8');
    await fs.rename(tmp, file);
};

export const listPopularSearches = (opts) => withLock(async () => (
    listPopularQueries(await readEntries(), opts)
));

export const recordPopularSearch = (query) => withLock(async () => {
    const next = bumpPopularQueries(await readEntries(), query);
    await writeEntries(next);
    return listPopularQueries(next);
});
