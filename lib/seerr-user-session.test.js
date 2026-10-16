import assert from 'node:assert/strict';
import test from 'node:test';
import { cookieHeaderFromSetCookie, hydrateSeerrNotifyDto, mapSeerrRequestToLifecycleRecord, mergeSeerrLifecycleSource } from './seerr-user-session.js';

test('cookieHeaderFromSetCookie keeps name=value pairs only', () => {
    const headers = {
        getSetCookie: () => [
            'connect.sid=s%3Aabc; Path=/; HttpOnly',
            'other=1; Secure',
        ],
    };
    assert.equal(cookieHeaderFromSetCookie(headers), 'connect.sid=s%3Aabc; other=1');
});

test('cookieHeaderFromSetCookie reads node-fetch headers.raw()', () => {
    const headers = {
        getSetCookie: () => [],
        raw: () => ({
            'set-cookie': ['connect.sid=s%3Axyz; Path=/; HttpOnly'],
        }),
    };
    assert.equal(cookieHeaderFromSetCookie(headers), 'connect.sid=s%3Axyz');
});

test('mapSeerrRequestToLifecycleRecord maps Seerr TV type 2 and firstAirDate', () => {
    const fromEnum = mapSeerrRequestToLifecycleRecord({
        id: 88,
        type: 2,
        media: { tmdbId: 241257, name: 'Electric Bloom' },
    }, []);
    assert.equal(fromEnum.mediaType, 'tv');

    const fromAirDate = mapSeerrRequestToLifecycleRecord({
        id: 89,
        media: { tmdbId: 241257, name: 'Electric Bloom', firstAirDate: '2026-01-09' },
    }, []);
    assert.equal(fromAirDate.mediaType, 'tv');
});

test('mapSeerrRequestToLifecycleRecord maps Seerr requester onto a portal user', () => {
    const record = mapSeerrRequestToLifecycleRecord({
        id: 44,
        type: 'movie',
        title: 'Insidious',
        requestedBy: { id: 9, email: 'jay@example.com', displayName: 'ItsThatJk', plexId: 123 },
        media: { tmdbId: 49018, title: 'Insidious' },
    }, [
        { id: 'portal-1', email: 'jay@example.com', username: 'ItsThatJk', plexId: '123' },
    ]);
    assert.equal(record.userId, 'portal-1');
    assert.equal(record.id, 'seerr:44');
    assert.equal(record.tmdbId, 49018);
    assert.equal(record.meta.requestedByEmail, 'jay@example.com');
    assert.equal(record.posterPath, null);
});

test('mapSeerrRequestToLifecycleRecord copies Seerr poster fields', () => {
    const fromMedia = mapSeerrRequestToLifecycleRecord({
        id: 12,
        type: 'movie',
        media: { tmdbId: 11, title: 'Dune', posterPath: '/dune.jpg' },
    }, []);
    assert.equal(fromMedia.posterPath, '/dune.jpg');

    const fromDto = mapSeerrRequestToLifecycleRecord({
        id: 13,
        type: 'tv',
        title: 'Lost',
        tmdbId: 4607,
        posterPath: '/lost.jpg',
        posterUrl: 'https://image.tmdb.org/t/p/w185/lost.jpg',
    }, []);
    assert.equal(fromDto.posterPath, '/lost.jpg');
    assert.equal(fromDto.posterUrl, 'https://image.tmdb.org/t/p/w185/lost.jpg');
});

test('mapSeerrRequestToLifecycleRecord ignores placeholder titles', () => {
    const record = mapSeerrRequestToLifecycleRecord({
        id: 7,
        type: 'movie',
        title: 'New request',
        media: { tmdbId: 11, title: 'Dune' },
    }, []);
    assert.equal(record.title, 'Dune');
});

test('mergeSeerrLifecycleSource keeps the enriched GET title over the approve payload', () => {
    const merged = mergeSeerrLifecycleSource(
        { id: 44, requestedBy: { email: 'jay@example.com' }, media: { tmdbId: 49018, status: 3 } },
        { id: 44, title: 'Insidious', posterPath: '/ins.jpg', media: { tmdbId: 49018, title: 'Insidious' } },
    );
    assert.equal(merged.title, 'Insidious');
    assert.equal(merged.posterPath, '/ins.jpg');
    assert.equal(merged.requestedBy.email, 'jay@example.com');
    const record = mapSeerrRequestToLifecycleRecord(merged, []);
    assert.equal(record.title, 'Insidious');
});

test('hydrateSeerrNotifyDto fetches a title only when the list DTO is a placeholder', async () => {
    let fetches = 0;
    const withTitle = await hydrateSeerrNotifyDto(
        { id: 1, title: 'Dune' },
        async () => {
            fetches += 1;
            return { id: 1, title: 'Other' };
        },
        {},
    );
    assert.equal(withTitle.title, 'Dune');
    assert.equal(fetches, 0);

    const filled = await hydrateSeerrNotifyDto(
        { id: 2, title: 'Unknown title' },
        async () => {
            fetches += 1;
            return { id: 2, title: 'Arrival' };
        },
        {},
    );
    assert.equal(filled.title, 'Arrival');
    assert.equal(fetches, 1);
});
