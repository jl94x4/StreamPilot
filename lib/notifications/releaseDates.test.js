import test from 'node:test';
import assert from 'node:assert/strict';
import {
    extractRegionReleaseDates,
    isFutureReleaseDate,
    normalizeReleaseDatePreference,
    pickPreferredRelease,
} from './releaseDates.js';

test('normalizeReleaseDatePreference defaults to digital', () => {
    assert.equal(normalizeReleaseDatePreference(''), 'digital');
    assert.equal(normalizeReleaseDatePreference('theatrical'), 'theatrical');
});

test('pickPreferredRelease prefers digital over theatrical', () => {
    const picked = pickPreferredRelease({
        preference: 'digital',
        region: 'US',
        releases: {
            results: [{
                iso_3166_1: 'US',
                release_dates: [
                    { type: 3, release_date: '2027-01-01' },
                    { type: 4, release_date: '2027-02-01' },
                ],
            }],
        },
        releaseDate: '2027-01-01',
    });
    assert.equal(picked?.date, '2027-02-01');
    assert.equal(picked?.type, 'digital');
});

test('isFutureReleaseDate compares UTC days', () => {
    assert.equal(isFutureReleaseDate('2099-01-01'), true);
    assert.equal(isFutureReleaseDate('2000-01-01'), false);
});

test('extractRegionReleaseDates falls back to US', () => {
    const dates = extractRegionReleaseDates({
        results: [{
            iso_3166_1: 'US',
            release_dates: [{ type: 4, release_date: '2028-05-05T00:00:00.000Z' }],
        }],
    }, 'GB');
    assert.equal(dates.digital, '2028-05-05');
});
