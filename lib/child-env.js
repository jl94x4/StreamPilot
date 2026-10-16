/**
 * Child processes (Chromium, Python, ffmpeg) must not inherit Node's jemalloc
 * preload — Chromium ships its own allocator and LD_PRELOAD can crash it.
 */
export const envWithoutJemalloc = (extra = {}) => {
    const env = { ...process.env, ...extra };
    if (String(env.LD_PRELOAD || '').includes('jemalloc')) {
        delete env.LD_PRELOAD;
    }
    return env;
};
