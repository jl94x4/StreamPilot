import test from 'node:test';
import assert from 'node:assert/strict';
import { decidePlexHeavyJob, PLEX_SETTLE_MS } from './plexHeavyJobGate.js';

const now = 1_800_000_000_000;
const services = [{ id: 'plex', name: 'Plex' }, { id: 'sonarr', name: 'Sonarr' }];

test('no Plex monitor or no data: jobs run', () => {
    assert.equal(decidePlexHeavyJob({ services: [{ id: 'sonarr' }], healthData: {}, now }).ok, true);
    assert.equal(decidePlexHeavyJob({ services, healthData: {}, now }).ok, true);
});

test('online with no recent outage: jobs run', () => {
    const healthData = { plex: { currentStatus: 'online', incidents: [{ startedAt: now - 3_600_000, endedAt: now - 3_000_000 }] } };
    assert.equal(decidePlexHeavyJob({ services, healthData, now }).ok, true);
});

test('offline or degraded: jobs wait', () => {
    for (const status of ['offline', 'degraded']) {
        const result = decidePlexHeavyJob({ services, healthData: { plex: { currentStatus: status, incidents: [] } }, now });
        assert.equal(result.ok, false);
        assert.match(result.reason, new RegExp(status));
    }
});

test('open incident: jobs wait', () => {
    const healthData = { plex: { currentStatus: 'online', incidents: [{ startedAt: now - 60_000, endedAt: null }] } };
    assert.equal(decidePlexHeavyJob({ services, healthData, now }).ok, false);
});

test('just came back: jobs wait until it has settled', () => {
    const recent = { plex: { currentStatus: 'online', incidents: [{ startedAt: now - 300_000, endedAt: now - 60_000 }] } };
    const waiting = decidePlexHeavyJob({ services, healthData: recent, now });
    assert.equal(waiting.ok, false);
    assert.match(waiting.reason, /9 more min/);
    const settled = { plex: { currentStatus: 'online', incidents: [{ startedAt: now - PLEX_SETTLE_MS * 2, endedAt: now - PLEX_SETTLE_MS - 1 }] } };
    assert.equal(decidePlexHeavyJob({ services, healthData: settled, now }).ok, true);
});

test('matches the monitor by name too', () => {
    const named = [{ id: 'svc-1', name: 'plex' }];
    const result = decidePlexHeavyJob({ services: named, healthData: { 'svc-1': { currentStatus: 'offline' } }, now });
    assert.equal(result.ok, false);
});
