/**
 * When the TV remote (or any key) was last used. Background work (item prefetch, Home retries)
 * waits for the remote to be still instead of running between presses, where on a TV stick it
 * lands in the middle of the next row change.
 */
let lastInputAt = 0;

if (typeof window !== 'undefined') {
    window.addEventListener('keydown', () => {
        lastInputAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    }, true);
}

export const msSinceRemoteInput = () => (
    (typeof performance !== 'undefined' ? performance.now() : Date.now()) - lastInputAt
);

/** Runs `task` once no key has been pressed for `quietMs`; gives up waiting after `maxWaitMs`. */
export const whenRemoteQuiet = (task: () => void, quietMs = 500, maxWaitMs = 6000): (() => void) => {
    let timer = 0;
    let cancelled = false;
    const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const check = () => {
        if (cancelled) return;
        const waited = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt;
        const quiet = msSinceRemoteInput();
        if (quiet >= quietMs || waited >= maxWaitMs) {
            task();
            return;
        }
        timer = window.setTimeout(check, Math.max(60, quietMs - quiet));
    };
    check();
    return () => {
        cancelled = true;
        window.clearTimeout(timer);
    };
};
