/** Never block app boot on native bridges or slow portal checks (Android TV). */
export const withBootTimeout = async <T>(
    promise: Promise<T>,
    ms: number,
): Promise<T | undefined> => {
    let timer = 0;
    try {
        return await Promise.race([
            promise,
            new Promise<undefined>((resolve) => {
                timer = window.setTimeout(() => resolve(undefined), ms);
            }),
        ]);
    } finally {
        if (timer) window.clearTimeout(timer);
    }
};
