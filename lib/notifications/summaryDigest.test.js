import assert from 'node:assert/strict';
import test from 'node:test';
import {
    collectUptimeMetrics,
    computeServiceUptimePct,
    countMediaAutomationJobsInPeriod,
    countRequestsInPeriod,
    dispatchSummaryDigest,
    formatSummaryTeaser,
    getNextSummaryFireAt,
    getSummaryLocalDateKey,
    normalizeSummaryConfig,
    resolveSummaryPeriod,
    shouldSendSummaryNow,
} from './summaryDigest.js';

test('normalizeSummaryConfig applies defaults', () => {
    const config = normalizeSummaryConfig({
        summaryNotifyEnabled: true,
        summaryNotifyFrequency: 'weekly',
        summaryNotifyDay: 1,
        summaryNotifyTime: '23:30',
    });
    assert.equal(config.enabled, true);
    assert.equal(config.frequency, 'weekly');
    assert.equal(config.time, '23:30');
    assert.equal(config.inApp, true);
});

test('resolveSummaryPeriod labels scale with frequency', () => {
    const daily = resolveSummaryPeriod({ summaryNotifyFrequency: 'daily' });
    assert.equal(daily.periodLabel, 'Today');
    const monthly = resolveSummaryPeriod({ summaryNotifyFrequency: 'monthly' });
    assert.equal(monthly.periodLabel, 'This month');
});

test('computeServiceUptimePct reads daily history', () => {
    const now = Date.parse('2026-08-23T23:00:00.000Z');
    const service = {
        dailyHistory: {
            '2026-08-22': { up: 90, total: 100 },
            '2026-08-23': { up: 95, total: 100 },
        },
    };
    const pct = computeServiceUptimePct(service, 7 * 24 * 60 * 60 * 1000, now);
    assert.ok(pct != null && pct > 90);
});

test('collectUptimeMetrics finds named services', () => {
    const metrics = collectUptimeMetrics({
        healthData: {
            plex: {
                uptimePercentage: 99.87,
                dailyHistory: { '2026-08-23': { up: 9987, total: 10000 } },
            },
            sonarr: {
                uptimePercentage: 99,
                dailyHistory: { '2026-08-23': { up: 9900, total: 10000 } },
            },
        },
        statusConfig: {
            services: [
                { id: 'plex', name: 'Plex' },
                { id: 'sonarr', name: 'Sonarr' },
            ],
        },
        periodMs: 24 * 60 * 60 * 1000,
        now: Date.parse('2026-08-23T23:00:00.000Z'),
    });
    assert.equal(metrics.plex?.label, 'Plex');
    assert.ok((metrics.plex?.uptimePct || 0) > 99);
});

test('shouldSendSummaryNow respects schedule and last sent date', () => {
    const config = {
        summaryNotifyEnabled: true,
        summaryNotifyFrequency: 'daily',
        summaryNotifyTime: '08:00',
        lastSummarySent: '2026-08-23',
    };
    const dueMorning = new Date('2026-08-24T09:00:00');
    assert.equal(shouldSendSummaryNow(config, dueMorning), true);
    const alreadySent = new Date('2026-08-23T23:00:00');
    assert.equal(shouldSendSummaryNow(config, alreadySent), false);
});

test('shouldSendSummaryNow is due at the exact send time and not before', () => {
    const config = {
        summaryNotifyEnabled: true,
        summaryNotifyFrequency: 'daily',
        summaryNotifyTime: '23:00',
    };
    assert.equal(shouldSendSummaryNow(config, new Date(2026, 7, 28, 22, 59, 0)), false);
    assert.equal(shouldSendSummaryNow(config, new Date(2026, 7, 28, 23, 0, 0)), true);
    assert.equal(shouldSendSummaryNow(config, new Date(2026, 7, 28, 23, 30, 0)), true);
    assert.equal(shouldSendSummaryNow(config, new Date(2026, 7, 29, 2, 54, 0)), false);
});

test('shouldSendSummaryNow skips a slot already marked sent', () => {
    const config = {
        summaryNotifyEnabled: true,
        summaryNotifyFrequency: 'daily',
        summaryNotifyTime: '23:00',
        lastSummarySent: '2026-08-28',
        lastSummarySentAt: new Date(2026, 7, 28, 23, 0, 24).toISOString(),
    };
    assert.equal(shouldSendSummaryNow(config, new Date(2026, 7, 28, 23, 51, 0)), false);
});

test('getNextSummaryFireAt returns the next local wall-clock slot', () => {
    const config = {
        summaryNotifyEnabled: true,
        summaryNotifyFrequency: 'daily',
        summaryNotifyTime: '23:00',
    };
    const morning = new Date(2026, 7, 28, 10, 0, 0);
    const next = getNextSummaryFireAt(config, morning);
    assert.equal(next.getFullYear(), 2026);
    assert.equal(next.getMonth(), 7);
    assert.equal(next.getDate(), 28);
    assert.equal(next.getHours(), 23);
    assert.equal(next.getMinutes(), 0);

    const afterSend = getNextSummaryFireAt({
        ...config,
        lastSummarySent: getSummaryLocalDateKey(config, new Date(2026, 7, 28, 23, 0, 24)),
        lastSummarySentAt: new Date(2026, 7, 28, 23, 0, 24).toISOString(),
    }, new Date(2026, 7, 28, 23, 1, 0));
    assert.equal(afterSend.getDate(), 29);
    assert.equal(afterSend.getHours(), 23);
});

test('getNextSummaryFireAt honors portalTimezone', () => {
    const config = {
        summaryNotifyEnabled: true,
        summaryNotifyFrequency: 'daily',
        summaryNotifyTime: '23:00',
        portalTimezone: 'Europe/London',
    };
    const next = getNextSummaryFireAt(config, new Date('2026-08-28T10:00:00.000Z'));
    assert.equal(next.toISOString(), '2026-08-28T22:00:00.000Z');
});

test('formatSummaryTeaser builds compact body', () => {
    const teaser = formatSummaryTeaser({
        metrics: {
            uptime: { plex: { uptimePct: 99.87 } },
            requests: { made: 4, approved: 2 },
            scannerImports: 1,
        },
    });
    assert.match(teaser, /Plex 99\.87%/);
    assert.match(teaser, /approved/);
});

test('dispatchSummaryDigest skips in-app web push fan-out when push is enabled', async () => {
    const inAppCalls = [];
    const pushCalls = [];
    await dispatchSummaryDigest({
        config: {
            summaryNotifyEnabled: true,
            summaryNotifyInApp: true,
            summaryNotifyWebPush: true,
        },
        digest: { id: 'digest-1', periodLabel: 'Today', metrics: {} },
        users: [{ id: 'admin-1', isAdmin: true, notifyWebPush: true }],
        createInApp: async (payload) => {
            inAppCalls.push(payload);
            return payload;
        },
        sendWebPush: async (userId, payload) => {
            pushCalls.push({ userId, payload });
            return { sent: 1 };
        },
    });
    assert.equal(inAppCalls.length, 1);
    assert.equal(inAppCalls[0].meta.skipWebPush, true);
    assert.equal(pushCalls.length, 1);
    assert.equal(pushCalls[0].payload.tag, 'summary-digest-digest-1');
});

test('countRequestsInPeriod includes poster metadata in highlights', async () => {
    const periodStart = '2026-08-23T00:00:00.000Z';
    const periodEnd = '2026-08-23T23:59:59.999Z';
    const { highlights } = await countRequestsInPeriod({
        periodStart,
        periodEnd,
        listPortalRequests: async () => ([{
            title: 'Cosmic Disclosure',
            status: 'approved',
            createdAt: '2026-08-23T12:00:00.000Z',
            posterPath: '/abc.jpg',
            backdropPath: '/backdrop.jpg',
            mediaType: 'tv',
        }]),
    });
    assert.equal(highlights.length, 1);
    assert.equal(highlights[0].posterPath, '/abc.jpg');
    assert.equal(highlights[0].backdropPath, '/backdrop.jpg');
    assert.equal(highlights[0].mediaType, 'tv');
});

test('countMediaAutomationJobsInPeriod counts only job.completed, not library scans', async () => {
    const periodStart = '2026-09-18T23:00:01.000Z';
    const periodEnd = '2026-09-19T23:00:01.000Z';
    const count = await countMediaAutomationJobsInPeriod({
        periodStart,
        periodEnd,
        listMediaAutomationActivity: async () => ([
            { type: 'job.completed', at: '2026-09-19T18:33:06.000Z' },
            { type: 'library.scan.completed', at: '2026-09-19T12:00:00.000Z' },
            { type: 'job.failed', at: '2026-09-19T10:00:00.000Z' },
            { type: 'job.completed', at: '2026-09-17T12:00:00.000Z' },
        ]),
    });
    assert.equal(count, 1);
});
