import assert from 'node:assert/strict';
import test from 'node:test';
import {
    cleanMediaTitle,
    parseMediaTitleFromPath,
    sourcePathFromJobActivity,
    resolveJobNotifySourcePath,
    formatBytesLabel,
    buildCompletedJobMessage,
} from './mediaTitleFromPath.js';

test('parseMediaTitleFromPath extracts TV titles from SxxExx scene names', () => {
    const parsed = parseMediaTitleFromPath(
        '/tv/The Office/Season 03/The.Office.S03E01.1080p.BluRay.x264.mkv',
    );
    assert.equal(parsed.mediaType, 'tv');
    assert.equal(parsed.title, 'The Office');
    assert.equal(parsed.seasonNumber, 3);
    assert.equal(parsed.episodeNumber, 1);
});

test('parseMediaTitleFromPath uses the show folder when the file has no title', () => {
    const parsed = parseMediaTitleFromPath('D:\\media\\Ted Lasso\\Season 01\\S01E04.mkv');
    assert.equal(parsed.mediaType, 'tv');
    assert.equal(parsed.title, 'Ted Lasso');
    assert.equal(parsed.seasonNumber, 1);
    assert.equal(parsed.episodeNumber, 4);
});

test('parseMediaTitleFromPath treats season folders without SxxExx as TV', () => {
    const parsed = parseMediaTitleFromPath('/tv/Severance/Season 02/Episode 1.mkv');
    assert.equal(parsed.mediaType, 'tv');
    assert.equal(parsed.title, 'Severance');
    assert.equal(parsed.seasonNumber, 2);
});

test('parseMediaTitleFromPath extracts movie title and year', () => {
    const parsed = parseMediaTitleFromPath(
        '/movies/Dune (2021)/Dune.2021.2160p.WEB-DL.mkv',
    );
    assert.equal(parsed.mediaType, 'movie');
    assert.equal(parsed.title, 'Dune');
    assert.equal(parsed.year, '2021');
});

test('parseMediaTitleFromPath understands 1x01 episode markers', () => {
    const parsed = parseMediaTitleFromPath('Andor.1x03.1080p.mkv');
    assert.equal(parsed.mediaType, 'tv');
    assert.equal(parsed.title, 'Andor');
    assert.equal(parsed.seasonNumber, 1);
    assert.equal(parsed.episodeNumber, 3);
});

test('cleanMediaTitle strips scene tags and group brackets', () => {
    assert.equal(
        cleanMediaTitle('[GROUP] The.Bear.S02E01.1080p.WEBRip.x265-GROUP'),
        'The Bear S02E01 GROUP',
    );
});

test('formatBytesLabel uses compact units', () => {
    assert.equal(formatBytesLabel(0), '');
    assert.equal(formatBytesLabel(800), '800 B');
    assert.equal(formatBytesLabel(800 * 1024 * 1024), '800 MB');
    assert.equal(formatBytesLabel(1.5 * 1024 * 1024 * 1024), '1.50 GB');
});

test('buildCompletedJobMessage appends output size when known', () => {
    assert.equal(
        buildCompletedJobMessage('The L.A. Complex (2012) - S01E04.mkv', 800 * 1024 * 1024),
        'Completed The L.A. Complex (2012) - S01E04.mkv [800 MB]',
    );
    assert.equal(
        buildCompletedJobMessage('Show.S01E01.mkv', 0),
        'Completed Show.S01E01.mkv',
    );
});

test('sourcePathFromJobActivity prefers data then completed message', () => {
    assert.equal(
        sourcePathFromJobActivity({ data: { sourcePath: '/media/Show.S01E01.mkv' } }),
        '/media/Show.S01E01.mkv',
    );
    assert.equal(
        sourcePathFromJobActivity({ message: 'Completed The.Office.S03E01.mkv' }),
        'The.Office.S03E01.mkv',
    );
    assert.equal(
        sourcePathFromJobActivity({
            message: 'Completed The.Office.S03E01.mkv [800 MB]',
        }),
        'The.Office.S03E01.mkv',
    );
    assert.equal(
        sourcePathFromJobActivity({
            message: 'Dry-run planned Movie.2021.mkv (pipeline output mode is Dry run)',
        }),
        'Movie.2021.mkv',
    );
});

test('resolveJobNotifySourcePath falls back to getJob', async () => {
    const path = await resolveJobNotifySourcePath(
        { jobId: 'j1', message: 'ffmpeg failed' },
        async (id) => (id === 'j1' ? { sourcePath: '/tv/Show/S01E01.mkv' } : null),
    );
    assert.equal(path, '/tv/Show/S01E01.mkv');
});
