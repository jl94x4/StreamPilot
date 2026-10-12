import test from 'node:test';
import assert from 'node:assert/strict';
import {
    scheduleMetadataFillArrHook,
    _resetMetadataFillArrHookForTests,
} from './arr-hook.js';

test('scheduleMetadataFillArrHook skips empty Sonarr payloads', async () => {
    _resetMetadataFillArrHookForTests();
    const result = await scheduleMetadataFillArrHook({ eventType: 'Download' });
    assert.equal(result.skipped, true);
    assert.equal(result.ok, true);
});

test('scheduleMetadataFillArrHook schedules Sonarr Download episode jobs', async () => {
    _resetMetadataFillArrHookForTests();
    const event = {
        eventType: 'Download',
        series: { title: 'Test Show', tvdbId: 123, tmdbId: 456 },
        episodes: [{ seasonNumber: 1, episodeNumber: 2, title: 'TBA' }],
        episodeFile: { path: '/tv/Test Show/Season 01/Test.S01E02.mkv' },
    };
    const result = await scheduleMetadataFillArrHook(event, {
        loadConfig: async () => ({ metadataFillEnabled: false }),
        resolvePlex: async () => ({ baseUrl: '', token: '' }),
    });
    assert.equal(result.scheduled, true);
    assert.equal(result.count, 1);
    assert.ok(Number(result.debounceMs) > 0);
    _resetMetadataFillArrHookForTests();
});
