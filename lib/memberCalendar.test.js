import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMemberCalendarEvents, normalizeShowTitle, renderIcs } from './memberCalendar.js';

const sonarrItems = [
    { airDate: '2026-11-10', seasonNumber: 2, episodeNumber: 3, title: 'The Return', series: { title: 'The Bear', tvdbId: 1, tmdbId: 11 } },
    { airDate: '2026-11-12', seasonNumber: 1, episodeNumber: 1, title: 'Pilot', series: { title: 'Requested Show', tvdbId: 2, tmdbId: 22 } },
    { airDate: '2026-11-14', seasonNumber: 5, episodeNumber: 9, title: 'Nope', series: { title: 'Someone Else', tvdbId: 3, tmdbId: 33 } },
];
const radarrItems = [
    { title: 'Mine', year: 2026, tmdbId: 500, inCinemas: '2026-11-20T00:00:00Z', digitalRelease: '2027-01-05T00:00:00Z' },
    { title: 'Not Mine', year: 2026, tmdbId: 600, inCinemas: '2026-11-21T00:00:00Z' },
];

test('titles match loosely', () => {
    assert.equal(normalizeShowTitle('The Bear'), normalizeShowTitle('bear'));
    assert.equal(normalizeShowTitle('Law & Order (1990)'), normalizeShowTitle('Law and Order'));
});

test('only shows they watch, titles they requested', () => {
    const events = buildMemberCalendarEvents({
        sonarrItems,
        radarrItems,
        requests: [{ mediaType: 'tv', tmdbId: 22 }, { mediaType: 'movie', tmdbId: 500 }],
        watchedShowTitles: ['Bear'],
    });
    assert.deepEqual(events.map((e) => e.title), [
        'The Bear S02E03',
        'Requested Show S01E01',
        'Mine (2026): in cinemas',
        'Mine (2026): digital release',
    ]);
    assert.equal(events[0].date, '20261110');
});

test('requested by TVDB id works too', () => {
    const events = buildMemberCalendarEvents({ sonarrItems, requests: [{ mediaType: 'tv', tvdbId: 3 }] });
    assert.deepEqual(events.map((e) => e.title), ['Someone Else S05E09']);
});

test('nothing relevant: an empty but valid calendar', () => {
    const events = buildMemberCalendarEvents({ sonarrItems, radarrItems });
    assert.equal(events.length, 0);
    const ics = renderIcs(events, { now: 0 });
    assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
    assert.match(ics, /END:VCALENDAR\r\n$/);
});

test('ics output: all-day events, escaping, CRLF and folding', () => {
    const ics = renderIcs([
        { uid: 'x', date: '20261231', title: 'A, B; C', description: 'line one\nline two' },
        { uid: 'y', date: '20261101', title: 'L'.repeat(120), description: '' },
    ], { calendarName: 'My releases', now: Date.UTC(2026, 10, 3, 1, 2, 3) });
    assert.match(ics, /DTSTART;VALUE=DATE:20261231\r\nDTEND;VALUE=DATE:20270101/);
    assert.match(ics, /SUMMARY:A\\, B\\; C/);
    assert.match(ics, /DESCRIPTION:line one\\nline two/);
    assert.match(ics, /DTSTAMP:20261103T010203Z/);
    for (const line of ics.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75, `too long: ${line}`);
    assert.ok(!/[^\r]\n/.test(ics), 'bare LF found');
});
