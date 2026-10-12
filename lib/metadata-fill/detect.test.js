import test from 'node:test';
import assert from 'node:assert/strict';
import { isPlaceholderTitle, needsMetadataFill } from './detect.js';
import { mergeEpisodeMetadata } from './sources.js';
import { buildPlexEpisodeEditParams } from './plexWrite.js';
import { isMetadataFillAutoImportEnabled, isMetadataFillEnabled } from './job.js';

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

test('mergeEpisodeMetadata prefers TMDB then fills from TVDB', () => {
    const merged = mergeEpisodeMetadata(
        { title: 'TMDB Name', summary: '', originallyAvailableAt: null },
        { title: 'TVDB Name', summary: 'TVDB plot', originallyAvailableAt: '2020-05-01' },
    );
    assert.equal(merged.title, 'TMDB Name');
    assert.equal(merged.summary, 'TVDB plot');
    assert.equal(merged.originallyAvailableAt, '2020-05-01');
    assert.deepEqual(merged.sources, ['tmdb', 'tvdb']);
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

test('feature flags default off and auto-import follows enable', () => {
    assert.equal(isMetadataFillEnabled({}), false);
    assert.equal(isMetadataFillEnabled({ metadataFillEnabled: true }), true);
    assert.equal(isMetadataFillEnabled({ metadataFillEnabled: true, mediaServerType: 'jellyfin' }), false);
    assert.equal(isMetadataFillAutoImportEnabled({ metadataFillEnabled: true }), true);
    assert.equal(isMetadataFillAutoImportEnabled({ metadataFillEnabled: true, metadataFillAutoImport: false }), false);
    assert.equal(isMetadataFillAutoImportEnabled({ metadataFillEnabled: false, metadataFillAutoImport: true }), false);
});
