/**
 * Serialize Tautulli-heavy background jobs so analytics and achievements
 * do not page get_history at the same time.
 */

let chain = Promise.resolve();

export const withTautulliExclusive = async (fn) => {
    let release = () => {};
    const next = new Promise((resolve) => {
        release = resolve;
    });
    const previous = chain;
    chain = previous.then(() => next, () => next);
    await previous.catch(() => {});
    try {
        return await fn();
    } finally {
        release();
    }
};

export const resetTautulliExclusiveForTests = () => {
    chain = Promise.resolve();
};
