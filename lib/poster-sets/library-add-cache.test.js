import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizePosterSetsConfig, warmMediaAllows } from './config.js';
import { posterSetsWebhookLibraryKey } from './library-add-cache.js';
import {
    extractPosterSetsWebhookToken,
    posterSetsWebhookTokenMatches,
} from './webhook-auth.js';

test('normalizePosterSetsConfig defaults library-add cache on and first-run unset', () => {
    const saved = normalizePosterSetsConfig({});
    assert.equal(saved.tpdbCacheOnLibraryAdd, true);
    assert.equal(saved.tpdbFirstRunBackfillDone, false);
    assert.equal(saved.webhookToken, '');
});

test('normalizePosterSetsConfig persists library-add and first-run flags', () => {
    const saved = normalizePosterSetsConfig({
        tpdbCacheOnLibraryAdd: false,
        tpdbFirstRunBackfillDone: true,
        webhookToken: 'abc123',
    });
    assert.equal(saved.tpdbCacheOnLibraryAdd, false);
    assert.equal(saved.tpdbFirstRunBackfillDone, true);
    assert.equal(saved.webhookToken, 'abc123');
});

test('posterSetsWebhookLibraryKey accepts movies and shows', () => {
    assert.deepEqual(
        posterSetsWebhookLibraryKey({
            event: 'library.new',
            Metadata: { type: 'movie', ratingKey: '10', title: 'Film', year: 2020 },
        }),
        {
            ratingKey: '10',
            mediaType: 'movie',
            title: 'Film',
            year: 2020,
            metadata: { type: 'movie', ratingKey: '10', title: 'Film', year: 2020 },
        },
    );
    assert.equal(
        posterSetsWebhookLibraryKey({
            event: 'library.new',
            Metadata: { type: 'show', ratingKey: '20', title: 'Show' },
        })?.mediaType,
        'show',
    );
});

test('posterSetsWebhookLibraryKey maps episodes to the parent show', () => {
    const hit = posterSetsWebhookLibraryKey({
        event: 'library.new',
        Metadata: {
            type: 'episode',
            ratingKey: '99',
            grandparentRatingKey: '55',
            grandparentTitle: 'Series',
            grandparentYear: 2019,
        },
    });
    assert.equal(hit?.ratingKey, '55');
    assert.equal(hit?.mediaType, 'show');
    assert.equal(hit?.title, 'Series');
    assert.equal(hit?.year, 2019);
});

test('posterSetsWebhookLibraryKey ignores non library.new events', () => {
    assert.equal(
        posterSetsWebhookLibraryKey({
            event: 'media.play',
            Metadata: { type: 'movie', ratingKey: '1' },
        }),
        null,
    );
});

test('poster sets webhook token is extracted from query or header', () => {
    assert.equal(
        extractPosterSetsWebhookToken({ query: { token: 'q' }, headers: {}, get: () => '' }),
        'q',
    );
    assert.equal(
        extractPosterSetsWebhookToken({
            query: {},
            headers: { 'x-poster-sets-webhook-token': 'hdr' },
            get: (name) => (name === 'x-poster-sets-webhook-token' ? 'hdr' : ''),
        }),
        'hdr',
    );
});

test('poster sets webhook compare is length-safe', () => {
    assert.equal(posterSetsWebhookTokenMatches('abc', 'abc'), true);
    assert.equal(posterSetsWebhookTokenMatches('abc', 'abd'), false);
    assert.equal(posterSetsWebhookTokenMatches('abc', ''), false);
});

test('TV-only cache scope skips movie library-add events', () => {
    const tvOnly = normalizePosterSetsConfig({ tpdbCacheWarmMedia: 'show' });
    assert.equal(warmMediaAllows(tvOnly.tpdbCacheWarmMedia, 'movie'), false);
    assert.equal(warmMediaAllows(tvOnly.tpdbCacheWarmMedia, 'show'), true);
});
