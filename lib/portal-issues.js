/**
 * In-memory registry of problems the portal noticed but would otherwise swallow
 * (a notification that failed to send, an integration that stopped answering...).
 * The admin "Needs attention" panel reads it. Entries clear themselves when the
 * same check later succeeds, or after MAX_AGE_MS.
 */

const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 100;

const issues = new Map();

const clip = (value, max) => String(value ?? '').trim().slice(0, max);

/**
 * @param {string} key stable id per problem source, e.g. "digest.send"
 * @param {{ severity?: 'critical'|'warning', title: string, detail?: string, link?: string }} issue
 */
export const reportPortalIssue = (key, issue = {}) => {
    const id = clip(key, 80);
    if (!id) return;
    const previous = issues.get(id);
    issues.set(id, {
        key: id,
        severity: issue.severity === 'critical' ? 'critical' : 'warning',
        title: clip(issue.title, 120) || id,
        detail: clip(issue.detail, 300),
        link: clip(issue.link, 60),
        firstAt: previous?.firstAt || Date.now(),
        at: Date.now(),
        count: (previous?.count || 0) + 1,
    });
    if (issues.size > MAX_ENTRIES) {
        const oldest = [...issues.values()].sort((a, b) => a.at - b.at)[0];
        if (oldest) issues.delete(oldest.key);
    }
};

export const clearPortalIssue = (key) => {
    issues.delete(clip(key, 80));
};

export const listPortalIssues = (now = Date.now()) => {
    const out = [];
    for (const [key, issue] of issues) {
        if (now - issue.at > MAX_AGE_MS) {
            issues.delete(key);
            continue;
        }
        out.push({ ...issue });
    }
    return out.sort((a, b) => {
        if (a.severity !== b.severity) return a.severity === 'critical' ? -1 : 1;
        return b.at - a.at;
    });
};

/** Run an async task, recording a portal issue when it throws and clearing it when it works. */
export const trackPortalIssue = async (key, issue, task) => {
    try {
        const result = await task();
        clearPortalIssue(key);
        return result;
    } catch (error) {
        reportPortalIssue(key, { ...issue, detail: issue?.detail || error?.message || String(error) });
        throw error;
    }
};

export const __resetPortalIssuesForTest = () => issues.clear();
