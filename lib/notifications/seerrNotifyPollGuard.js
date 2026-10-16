/**
 * Shared idle-tick guard for Seerr notify jobs.
 * When request counts are unchanged, skip the paginated /request crawl.
 * Count changes still trigger a full list within the same 10s interval.
 * A periodic recrawl bounds rare same-bucket swaps the count API cannot see.
 */

export const SEERR_NOTIFY_FORCE_LIST_AFTER_MS = 5 * 60 * 1000;

export const fingerprintSeerrRequestCounts = (counts = {}) => JSON.stringify({
    pending: Number(counts.pending) || 0,
    approved: Number(counts.approved) || 0,
    processing: Number(counts.processing) || 0,
    available: Number(counts.available) || 0,
    declined: Number(counts.declined) || 0,
    completed: Number(counts.completed) || 0,
    total: Number(counts.total) || 0,
});

const lastFingerprintByJob = new Map();
const lastListedAtByJob = new Map();

export const resetSeerrNotifyPollGuardForTests = () => {
    lastFingerprintByJob.clear();
    lastListedAtByJob.clear();
};

/**
 * @returns {Promise<{ skip: boolean, fingerprint?: string, markListed?: () => void }>}
 */
export const shouldSkipUnchangedSeerrNotifyList = async (
    jobKey,
    getRequestCounts,
    config,
    { now = Date.now() } = {},
) => {
    if (typeof getRequestCounts !== 'function') return { skip: false };
    const counts = await getRequestCounts(config);
    const fingerprint = fingerprintSeerrRequestCounts(counts);
    const previous = lastFingerprintByJob.get(jobKey);
    const lastListedAt = lastListedAtByJob.get(jobKey) || 0;
    const stale = lastListedAt > 0 && (now - lastListedAt) >= SEERR_NOTIFY_FORCE_LIST_AFTER_MS;
    if (previous != null && previous === fingerprint && !stale) {
        return { skip: true, fingerprint };
    }
    return {
        skip: false,
        fingerprint,
        markListed: () => {
            lastFingerprintByJob.set(jobKey, fingerprint);
            lastListedAtByJob.set(jobKey, Date.now());
        },
    };
};

export default shouldSkipUnchangedSeerrNotifyList;
