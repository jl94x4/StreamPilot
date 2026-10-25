const cleanQuery = (value) => String(value || '').trim().replace(/\s+/g, ' ');

/** True when one query is the other still being typed ("spider" / "spiderman"). */
const sameTyping = (a, b) => {
    const left = a.toLowerCase();
    const right = b.toLowerCase();
    if (!left || !right || left === right) return left === right;
    return left.startsWith(right) || right.startsWith(left);
};

/**
 * Newest first. A longer query replaces the shorter one it grew from,
 * so the chip row is not spiderman / spiderma / spiderm / spider.
 */
export const pushRecentSearch = (existing, query, limit = 20) => {
    const next = cleanQuery(query);
    const prior = (Array.isArray(existing) ? existing : [])
        .map(cleanQuery)
        .filter((row) => row.length >= 2);
    const incoming = next.length >= 2
        ? [next, ...prior.filter((row) => row.toLowerCase() !== next.toLowerCase())]
        : prior;
    const kept = [];
    incoming.forEach((row) => {
        if (kept.some((item) => sameTyping(item, row))) return;
        kept.push(row);
    });
    return kept.slice(0, limit);
};

/** True when `query` is already represented by a recent chip, including a shorter typing. */
export const coversSearchQuery = (existing, query) => (
    (Array.isArray(existing) ? existing : []).some((row) => sameTyping(row, query))
);
