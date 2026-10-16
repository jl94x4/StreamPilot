import test from 'node:test';
import assert from 'node:assert/strict';
import { isPlaceholderTitle, needsMetadataFill } from './detect.js';
import { mergeEpisodeMetadata, titlesDisagree } from './sources.js';
import { buildPlexEpisodeEditParams, buildPlexEpisodeUnlockParams } from './plexWrite.js';
import { isMetadataFillAutoImportEnabled, isMetadataFillEnabled } from './job.js';
import { enqueueRetryItem, listRetryQueue, removeRetryItem, clearRetryQueue } from './retryQueue.js';
import {
    getMetadataFillOptions,
    applyMetadataFillSettingsPatch,
} from './settings.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('placeholder titles match TBA/TBC/Episode N', () => {
    assert.equal(isPlaceholderTitle('TBA'), true);
    assert.equal(isPlaceholderTitle('tbc'), true);
    assert.equal(isPlaceholderTitle('Episode 12'), true);
    assert.equal(isPlaceholderTitle('Episode12'), true);
    assert.equal(isPlaceholderTitle('Pilot'), false);
    assert.equal(isPlaceholderTitle(''), true);
});

test('needsMetadataFill gates empty summary and missing air date', () => {
    assert.equal(needsMetadataFill({
        title: 'Real Title',
        summary: 'A plot.',
        originallyAvailableAt: '2024-01-01',
    }).needs, false);
    assert.equal(needsMetadataFill({
        title: 'TBA',
        summary: 'A plot.',
        originallyAvailableAt: '2024-01-01',
    }).fields.title, true);
    assert.equal(needsMetadataFill({
        title: 'Real',
        summary: '',
        originallyAvailableAt: '2024-01-01',
    }).fields.summary, true);
    assert.equal(needsMetadataFill({
        title: 'Real',
        summary: 'Plot',
        originallyAvailableAt: '',
    }).fields.originallyAvailableAt, true);
});

test('mergeEpisodeMetadata prefers TMDB then fills from TVDB then TVmaze', () => {
    const merged = mergeEpisodeMetadata(
        { title: 'TMDB Name', summary: '', originallyAvailableAt: null },
        { title: 'TVDB Name', summary: 'TVDB plot', originallyAvailableAt: null },
        { title: 'Maze', summary: 'Maze plot', originallyAvailableAt: '2020-05-01' },
    );
    assert.equal(merged.title, 'TMDB Name');
    assert.equal(merged.summary, 'TVDB plot');
    assert.equal(merged.originallyAvailableAt, '2020-05-01');
    assert.deepEqual(merged.sources, ['tmdb', 'tvdb', 'tvmaze']);
    assert.equal(merged.titleConflict, true);
});

test('mergeEpisodeMetadata can prefer TVDB titles', () => {
    const merged = mergeEpisodeMetadata(
        { title: 'TMDB Name', summary: 'TMDB plot', originallyAvailableAt: null },
        { title: 'TVDB Name', summary: '', originallyAvailableAt: '2020-05-01' },
        null,
        { prefer: 'tvdb' },
    );
    assert.equal(merged.title, 'TVDB Name');
    assert.equal(merged.summary, 'TMDB plot');
    assert.equal(merged.originallyAvailableAt, '2020-05-01');
});

test('titlesDisagree ignores punctuation and case', () => {
    assert.equal(titlesDisagree('The Pilot!', 'the pilot'), false);
    assert.equal(titlesDisagree('Alpha', 'Beta'), true);
    assert.equal(titlesDisagree('Alpha', ''), false);
});

test('getMetadataFillOptions defaults and settings patch', () => {
    const defaults = getMetadataFillOptions({});
    assert.equal(defaults.fields.title, true);
    assert.equal(defaults.sourcePreference, 'auto');
    assert.equal(defaults.requireTitleAgreement, false);
    assert.deepEqual(defaults.libraryKeys, []);

    const config = {};
    applyMetadataFillSettingsPatch(config, {
        fields: { title: true, summary: false, originallyAvailableAt: true },
        sourcePreference: 'tvdb',
        requireTitleAgreement: true,
        libraryKeys: ['12', '12', 'ab3'],
    });
    const next = getMetadataFillOptions(config);
    assert.equal(next.fields.summary, false);
    assert.equal(next.sourcePreference, 'tvdb');
    assert.equal(next.requireTitleAgreement, true);
    assert.deepEqual(next.libraryKeys, ['12', '3']);
});

test('buildPlexEpisodeEditParams locks only requested fields', () => {
    const params = buildPlexEpisodeEditParams({
        ratingKey: '12345',
        title: 'New Title',
        summary: 'New summary',
        originallyAvailableAt: '2021-03-15T00:00:00Z',
        fields: { title: true, summary: false, originallyAvailableAt: true },
    });
    assert.equal(params.get('type'), '4');
    assert.equal(params.get('id'), '12345');
    assert.equal(params.get('title.value'), 'New Title');
    assert.equal(params.get('title.locked'), '1');
    assert.equal(params.get('summary.value'), null);
    assert.equal(params.get('originallyAvailableAt.value'), '2021-03-15');
    assert.equal(params.get('originallyAvailableAt.locked'), '1');
});

test('buildPlexEpisodeUnlockParams clears locks without values', () => {
    const params = buildPlexEpisodeUnlockParams({
        ratingKey: '99',
        fields: { title: true, summary: true, originallyAvailableAt: false },
    });
    assert.equal(params.get('title.locked'), '0');
    assert.equal(params.get('summary.locked'), '0');
    assert.equal(params.get('originallyAvailableAt.locked'), null);
});

test('retry queue enqueues uniquely and removes by id', async () => {
    const prev = process.cwd();
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mf-retry-'));
    process.chdir(tmp);
    try {
        await clearRetryQueue();
        const a = await enqueueRetryItem({
            reason: 'plex-episode-not-found',
            showTitle: 'Show',
            seasonNumber: 1,
            episodeNumber: 2,
            tvdbId: '123',
        });
        const b = await enqueueRetryItem({
            reason: 'plex-episode-not-found',
            showTitle: 'Show',
            seasonNumber: 1,
            episodeNumber: 2,
            tvdbId: '123',
        });
        assert.equal(a.id, b.id);
        let queue = await listRetryQueue();
        assert.equal(queue.items.length, 1);
        await removeRetryItem(a.id);
        queue = await listRetryQueue();
        assert.equal(queue.items.length, 0);
    } finally {
        process.chdir(prev);
        await fs.rm(tmp, { recursive: true, force: true });
    }
});

test('feature flags default off and auto-import follows enable', () => {
    assert.equal(isMetadataFillEnabled({}), false);
    assert.equal(isMetadataFillEnabled({ metadataFillEnabled: true }), true);
    assert.equal(isMetadataFillEnabled({ metadataFillEnabled: true, mediaServerType: 'jellyfin' }), false);
    assert.equal(isMetadataFillAutoImportEnabled({ metadataFillEnabled: true }), true);
    assert.equal(isMetadataFillAutoImportEnabled({ metadataFillEnabled: true, metadataFillAutoImport: false }), false);
    assert.equal(isMetadataFillAutoImportEnabled({ metadataFillEnabled: false, metadataFillAutoImport: true }), false);
});
