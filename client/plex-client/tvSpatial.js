/**
 * D-pad focus decisions for the TV shell, kept free of the DOM so they can be
 * tested. useTvRemote measures the page and resolves what these return.
 *
 * Rects are { left, top, right, bottom, width, height } (a DOMRect works).
 * Directions are 'left' | 'right' | 'up' | 'down'.
 */

/** @typedef {'left' | 'right' | 'up' | 'down'} SpatialDir */
/** @typedef {{ left: number, top: number, right: number, bottom: number, width: number, height: number }} Rect */
/**
 * @typedef {{ type: 'none' } | { type: 'letter' } | { type: 'before' } | { type: 'above' }
 *   | { type: 'poster', index: number, fallback: 'none' | 'letter' | 'stay' | 'load' }} BrowseMove
 */
/**
 * @typedef {{ kind: 'key', row: number, col: number }
 *   | { kind: 'nearestKey', row: number, col: number }
 *   | { kind: 'recent' | 'popular', index: number, clamp: boolean }
 *   | { kind: 'firstResult' } | { kind: 'self' } | { kind: 'none' }} SearchPlanStep
 */
/**
 * @typedef {{ area: 'key', row: number, col: number }
 *   | { area: 'recent' | 'popular', index: number }} SearchFocusFrom
 */

/** @type {(a1: number, a2: number, b1: number, b2: number) => number} */
export const spanOverlap = (a1, a2, b1, b2) => (
    Math.max(0, Math.min(a2, b2) - Math.max(a1, b1))
);

const hasSize = (r) => r.width > 0 && r.height > 0;

/**
 * Geometric spatial navigation (LRUD): index of the nearest rect in the pressed
 * direction, or -1. Vertical moves never skip a closer row (e.g. Top Cast) just
 * because a later rail lines up with the focused control.
 * @param {Rect} fromRect
 * @param {Rect[]} rects
 * @param {SpatialDir} dir
 * @returns {number}
 */
export const pickSpatialIndex = (fromRect, rects, dir) => {
    if (fromRect.width <= 0 && fromRect.height <= 0) return -1;
    const fcx = fromRect.left + fromRect.width / 2;

    if (dir === 'left' || dir === 'right') {
        let best = -1;
        let bestScore = Infinity;
        rects.forEach((r, i) => {
            if (!hasSize(r)) return;
            const cx = r.left + r.width / 2;
            const primary = dir === 'left' ? fcx - cx : cx - fcx;
            if (primary <= 2) return;
            if (spanOverlap(fromRect.top, fromRect.bottom, r.top, r.bottom) <= 0) return;
            if (primary < bestScore) {
                bestScore = primary;
                best = i;
            }
        });
        return best;
    }

    const cands = [];
    rects.forEach((r, i) => {
        if (!hasSize(r)) return;
        const overlapY = spanOverlap(fromRect.top, fromRect.bottom, r.top, r.bottom);
        if (overlapY > Math.min(fromRect.height, r.height) * 0.35) return;
        if (dir === 'down' && r.top < fromRect.top + 8) return;
        if (dir === 'up' && r.bottom > fromRect.bottom - 8) return;
        const primary = dir === 'down' ? r.top - fromRect.bottom : fromRect.top - r.bottom;
        if (primary < -12) return;
        cands.push({ i, r, primary });
    });
    if (!cands.length) return -1;

    const nearest = Math.min(...cands.map((c) => Math.max(0, c.primary)));
    const nearestH = cands.find((c) => Math.max(0, c.primary) === nearest)?.r.height || 80;
    const band = cands.filter((c) => Math.max(0, c.primary) <= nearest + Math.max(64, nearestH * 0.7));

    // Nothing in the next band sits under this column: enter that row at its left end.
    const columnHit = band.some((c) => spanOverlap(fromRect.left, fromRect.right, c.r.left, c.r.right) > 0);
    if (!columnHit) {
        band.sort((a, b) => a.r.left - b.r.left);
        return band[0].i;
    }

    let best = -1;
    let bestScore = Infinity;
    for (const c of band) {
        const overlap = spanOverlap(fromRect.left, fromRect.right, c.r.left, c.r.right);
        const orth = overlap > 0
            ? 0
            : Math.min(Math.abs(c.r.left - fromRect.right), Math.abs(fromRect.left - c.r.right));
        const score = Math.max(0, c.primary) + orth * 2;
        if (score < bestScore) {
            bestScore = score;
            best = c.i;
        }
    }
    return best;
};

/**
 * Up/down only measures the next few rows: indices of the closest rows in the
 * pressed direction, nearest first. Scanning every poster forces layout on each
 * press, which stalls Fire Stick WebView.
 * @param {Rect} fromRect
 * @param {Rect[]} rowRects
 * @param {'up' | 'down'} dir
 * @param {number} [limit]
 * @returns {number[]}
 */
export const rankRowsInDirection = (fromRect, rowRects, dir, limit = 3) => {
    const ranked = [];
    rowRects.forEach((rect, i) => {
        if (!hasSize(rect)) return;
        const primary = dir === 'down' ? rect.top - fromRect.bottom : fromRect.top - rect.bottom;
        if (primary < -12) return;
        ranked.push({ i, primary: Math.max(0, primary) });
    });
    ranked.sort((a, b) => a.primary - b.primary);
    return ranked.slice(0, Math.min(ranked.length, limit)).map((row) => row.i);
};

/**
 * Index of the rect whose vertical middle is closest to `mid` (first wins a tie), or -1.
 * @param {number} mid
 * @param {Rect[]} rects
 * @returns {number}
 */
export const nearestByMiddleY = (mid, rects) => {
    let best = rects.length ? 0 : -1;
    let bestDist = Infinity;
    rects.forEach((rect, i) => {
        const dist = Math.abs(rect.top + rect.height / 2 - mid);
        if (dist < bestDist) {
            bestDist = dist;
            best = i;
        }
    });
    return best;
};

/**
 * Library browse grid: where one press goes from poster `absIndex` in a grid
 * of `cols` columns. `absStart` > 0 means earlier rows are not mounted yet.
 *
 * Returns one of:
 *   { type: 'none' }      stop (left edge)
 *   { type: 'letter' }    the A–Z bar beside the grid
 *   { type: 'before' }    ask for earlier rows and stay
 *   { type: 'above' }     filters, then library tabs
 *   { type: 'poster', index, fallback }  that poster; if it is not mounted,
 *       fallback 'none' | 'letter' | 'stay' | 'load' (fetch that row and stay)
 * @param {number} absIndex
 * @param {number} cols
 * @param {SpatialDir} dir
 * @param {number} [absStart]
 * @returns {BrowseMove}
 */
export const browseGridMove = (absIndex, cols, dir, absStart = 0) => {
    const col = absIndex % cols;
    if (dir === 'left') {
        if (col === 0) return { type: 'none' };
        return { type: 'poster', index: absIndex - 1, fallback: 'none' };
    }
    if (dir === 'right') {
        if (col >= cols - 1) return { type: 'letter' };
        return { type: 'poster', index: absIndex + 1, fallback: 'letter' };
    }
    if (dir === 'up') {
        if (absIndex < cols) {
            if (Number.isFinite(absStart) && absStart > 0) return { type: 'before' };
            // Filters first, then library tabs — never dead-end on the top poster row.
            return { type: 'above' };
        }
        return { type: 'poster', index: absIndex - cols, fallback: 'stay' };
    }
    return { type: 'poster', index: absIndex + cols, fallback: 'load' };
};

/** Bottom row of the on-screen search keyboard. Chips and results sit below it. */
export const SEARCH_PAD_LAST_ROW = 3;

/**
 * TV search screen: targets to try in order for one press. The first that
 * exists wins. Steps:
 *   { kind: 'key', row, col }         that exact key
 *   { kind: 'nearestKey', row, col }  that row, column clamped to its length
 *   { kind: 'recent' | 'popular', index, clamp }  a chip; clamp picks the last
 *       chip when index is past the end, otherwise the index must exist
 *   { kind: 'firstResult' }           first result card
 *   { kind: 'self' }                  stay on the focused control
 *   { kind: 'none' }                  stop
 *
 * `from` is { area: 'key', row, col } or { area: 'recent' | 'popular', index }.
 * @param {SearchFocusFrom} from
 * @param {SpatialDir} dir
 * @returns {SearchPlanStep[]}
 */
export const searchFocusPlan = (from, dir) => {
    if (from.area === 'key') {
        const { row, col } = from;
        if (dir === 'left') return col > 0 ? [{ kind: 'key', row, col: col - 1 }, { kind: 'none' }] : [{ kind: 'none' }];
        if (dir === 'right') return [{ kind: 'key', row, col: col + 1 }, { kind: 'self' }];
        if (dir === 'up') return row > 0 ? [{ kind: 'nearestKey', row: row - 1, col }, { kind: 'self' }] : [{ kind: 'self' }];
        return [
            { kind: 'nearestKey', row: row + 1, col },
            { kind: 'recent', index: col, clamp: true },
            { kind: 'popular', index: col, clamp: true },
            { kind: 'firstResult' },
            { kind: 'self' },
        ];
    }

    const { area, index } = from;
    const at = Math.max(0, index);
    if (dir === 'left') return index > 0 ? [{ kind: area, index: index - 1, clamp: false }, { kind: 'none' }] : [{ kind: 'none' }];
    if (dir === 'right') return index >= 0 ? [{ kind: area, index: index + 1, clamp: false }, { kind: 'self' }] : [{ kind: 'self' }];

    const backToKeys = [
        { kind: 'nearestKey', row: SEARCH_PAD_LAST_ROW, col: at },
        { kind: 'key', row: 0, col: 0 },
        { kind: 'self' },
    ];
    if (area === 'recent') {
        if (dir === 'up') return backToKeys;
        return [{ kind: 'popular', index: at, clamp: true }, { kind: 'firstResult' }, { kind: 'self' }];
    }
    if (dir === 'up') return [{ kind: 'recent', index: at, clamp: true }, ...backToKeys];
    return [{ kind: 'firstResult' }, { kind: 'self' }];
};
