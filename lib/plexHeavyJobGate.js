/**
 * Heavy scheduled jobs (overlays, editions, poster sets, watch sync, media automation scans)
 * hold off while Plex is unhealthy or has only just come back. A Plex server that restarts
 * under load otherwise got hit by every overdue job the moment it returned, and fell over
 * again. Uses the status page's own Plex monitor (service id or name "plex"); with no such
 * monitor there is nothing to go on, so jobs run as before.
 */

/** After an outage ends, wait this long before heavy work. */
export const PLEX_SETTLE_MS = 10 * 60 * 1000;

const isPlexService = (service) => String(service?.id || '') === 'plex'
    || String(service?.name || '').toLowerCase() === 'plex';

/**
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export const decidePlexHeavyJob = ({ services = [], healthData = {}, now = Date.now(), settleMs = PLEX_SETTLE_MS } = {}) => {
    const service = (Array.isArray(services) ? services : []).find(isPlexService);
    if (!service) return { ok: true };
    const record = healthData?.[service.id];
    if (!record) return { ok: true };
    const status = String(record.currentStatus || 'unknown');
    if (status === 'offline' || status === 'degraded') {
        return { ok: false, reason: `Plex is ${status}` };
    }
    const incidents = Array.isArray(record.incidents) ? record.incidents : [];
    const last = incidents[incidents.length - 1];
    if (last && last.endedAt == null) {
        return { ok: false, reason: 'Plex is recovering from an outage' };
    }
    const endedAt = Number(last?.endedAt) || 0;
    if (endedAt && now - endedAt < settleMs) {
        const minutes = Math.max(1, Math.ceil((settleMs - (now - endedAt)) / 60_000));
        return { ok: false, reason: `Plex came back recently; waiting about ${minutes} more min for it to settle` };
    }
    return { ok: true };
};
