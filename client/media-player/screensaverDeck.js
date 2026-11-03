/** Fisher-Yates copy. `random` returns a value in [0, 1). */
export const shuffleCopy = (list, random = Math.random) => {
    const out = Array.isArray(list) ? list.slice() : [];
    for (let i = out.length - 1; i > 0; i -= 1) {
        const j = Math.floor(random() * (i + 1));
        const tmp = out[i];
        out[i] = out[j];
        out[j] = tmp;
    }
    return out;
};

/**
 * Shuffled play order for whatever pool the screensaver source returned.
 * When the pool has more than one slide, the first slide is not `avoidKey`
 * (the title that just played), so a new pass does not repeat it immediately.
 */
export const buildPlayDeck = (slides, avoidKey = '', random = Math.random) => {
    const deck = shuffleCopy(slides, random);
    const avoid = String(avoidKey || '');
    if (deck.length > 1 && avoid && deck[0]?.key === avoid) {
        const swap = 1 + Math.floor(random() * (deck.length - 1));
        const tmp = deck[0];
        deck[0] = deck[swap];
        deck[swap] = tmp;
    }
    return deck;
};
