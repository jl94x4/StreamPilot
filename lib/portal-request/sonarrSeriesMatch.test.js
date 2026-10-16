import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildSonarrSeriesIndexes,
    matchSonarrSeriesFromIndexes,
    seriesConflictsRequestedShow,
} from './sonarrSeriesMatch.js';

const originalLibrarians = {
    id: 11,
    title: 'The Librarians',
    tmdbId: 2014,
    year: 2014,
    alternateTitles: [],
};

const nextChapter = {
    id: 22,
    title: 'The Librarians: The Next Chapter',
    tmdbId: 2025,
    year: 2025,
    alternateTitles: [],
};

const instance = { id: 'sonarr-1', name: 'Sonarr' };

test('seriesConflictsRequestedShow rejects a different TMDB id or distant year', () => {
    assert.equal(
        seriesConflictsRequestedShow(originalLibrarians, { tmdbId: nextChapter.tmdbId, year: 2025 }),
        true,
    );
    assert.equal(
        seriesConflictsRequestedShow(originalLibrarians, { tmdbId: originalLibrarians.tmdbId, year: 2014 }),
        false,
    );
});

test('title match does not collapse a sequel onto the original when a year is known', async () => {
    const indexes = buildSonarrSeriesIndexes([originalLibrarians], instance);
    const hit = await matchSonarrSeriesFromIndexes(
        {},
        nextChapter.tmdbId,
        indexes,
        { title: nextChapter.title, year: 2025, fetchImpl: async () => ({ ok: false }) },
    );
    assert.equal(hit, null);
});

test('title+year still matches the same show when TMDB is missing on the Sonarr row', async () => {
    const indexes = buildSonarrSeriesIndexes([{ ...originalLibrarians, tmdbId: 0 }], instance);
    const hit = await matchSonarrSeriesFromIndexes(
        {},
        originalLibrarians.tmdbId,
        indexes,
        { title: originalLibrarians.title, year: 2014, fetchImpl: async () => ({ ok: false }) },
    );
    assert.equal(hit?.series?.id, originalLibrarians.id);
});

test('rejects a Sonarr row that reused the sequel TMDB id on the original year', async () => {
    const indexes = buildSonarrSeriesIndexes(
        [{ ...originalLibrarians, tmdbId: nextChapter.tmdbId }],
        instance,
    );
    const hit = await matchSonarrSeriesFromIndexes(
        {},
        nextChapter.tmdbId,
        indexes,
        { title: nextChapter.title, year: 2025, fetchImpl: async () => ({ ok: false }) },
    );
    assert.equal(hit, null);
});

test('title-only matching is allowed only when TMDB did not supply a year', async () => {
    const indexes = buildSonarrSeriesIndexes([{ ...originalLibrarians, tmdbId: 0 }], instance);
    const withYear = await matchSonarrSeriesFromIndexes(
        {},
        999001,
        indexes,
        { title: originalLibrarians.title, year: 2025, fetchImpl: async () => ({ ok: false }) },
    );
    assert.equal(withYear, null);

    const withoutYear = await matchSonarrSeriesFromIndexes(
        {},
        999001,
        indexes,
        { title: originalLibrarians.title, year: null, fetchImpl: async () => ({ ok: false }) },
    );
    assert.equal(withoutYear?.series?.id, originalLibrarians.id);
});
