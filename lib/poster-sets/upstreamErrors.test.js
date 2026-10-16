import assert from 'node:assert/strict';
import test from 'node:test';
import {
    explainPosterSetsPageError,
    isFailedPosterSetsAuditEntry,
    isFailedPosterSetsJobState,
    isPosterSetsUpstreamOutage,
    posterSetsHostLabel,
    posterSetsUpstreamStatusCode,
} from './upstreamErrors.js';

test('posterSetsUpstreamStatusCode reads Cloudflare 52x/530 from scrape errors', () => {
    assert.equal(posterSetsUpstreamStatusCode('Failed to retrieve the page. Status code: 530'), 530);
    assert.equal(posterSetsUpstreamStatusCode('Cloudflare 522: connection timed out'), 522);
    assert.equal(posterSetsUpstreamStatusCode('Status code: 404'), null);
});

test('explainPosterSetsPageError names MediUX and stays idempotent', () => {
    const first = explainPosterSetsPageError(
        'Failed to retrieve the page. Status code: 530',
        'https://mediux.pro/sets/6427',
    );
    assert.match(first, /MediUX is temporarily unreachable/);
    assert.match(first, /Cloudflare 530/);
    assert.match(first, /Status code: 530/);
    assert.equal(explainPosterSetsPageError(first, 'https://mediux.pro/sets/6427'), first);
});

test('explainPosterSetsPageError names ThePosterDB from the URL', () => {
    const text = explainPosterSetsPageError(
        'Failed to retrieve the page. Status code: 521',
        'https://theposterdb.com/set/1',
    );
    assert.match(text, /ThePosterDB is temporarily unreachable/);
    assert.match(text, /origin web server is down/);
});

test('isPosterSetsUpstreamOutage covers generic and explained copy', () => {
    assert.equal(isPosterSetsUpstreamOutage('Failed to retrieve the page. Status code: 530'), true);
    assert.equal(
        isPosterSetsUpstreamOutage('MediUX is temporarily unreachable (Cloudflare 530: origin DNS failed).'),
        true,
    );
    assert.equal(isPosterSetsUpstreamOutage('Watch not found'), false);
});

test('posterSetsHostLabel falls back when the URL is missing', () => {
    assert.equal(posterSetsHostLabel('', 'Failed MediUX scrape'), 'MediUX');
    assert.equal(posterSetsHostLabel(''), 'The poster site');
});

test('failed job/audit helpers match error rows only', () => {
    assert.equal(isFailedPosterSetsJobState('failed'), true);
    assert.equal(isFailedPosterSetsJobState('succeeded'), false);
    assert.equal(isFailedPosterSetsAuditEntry({ error: 'nope' }), true);
    assert.equal(isFailedPosterSetsAuditEntry({ state: 'idle' }), false);
    assert.equal(isFailedPosterSetsAuditEntry({ state: 'warning', error: 'not on the media server yet' }), false);
});
