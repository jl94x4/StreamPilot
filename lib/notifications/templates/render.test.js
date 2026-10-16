import test from 'node:test';
import assert from 'node:assert/strict';
import {
    renderNotifyTemplate,
    buildNotifyVars,
    normalizeNotificationTemplates,
    resolveEventTemplates,
    renderEventTemplates,
} from './render.js';

test('renderNotifyTemplate replaces known tokens and blanks unknown', () => {
    const out = renderNotifyTemplate('Hello {user}, {title}{year} {missing}', {
        user: 'Alex',
        title: 'Dune',
        year: ' (2021)',
    });
    assert.equal(out, 'Hello Alex, Dune (2021) ');
});

test('normalizeNotificationTemplates keeps sparse overrides only', () => {
    const normalized = normalizeNotificationTemplates({
        available: { emailSubject: '  Custom {title}  ', pushTitle: '', weird: 'nope' },
        nope: { emailSubject: 'x' },
    });
    assert.deepEqual(normalized, {
        available: { emailSubject: 'Custom {title}' },
    });
});

test('resolveEventTemplates merges overrides over defaults', () => {
    const resolved = resolveEventTemplates({
        notificationTemplates: {
            approved: { pushTitle: 'Yep: {title}' },
        },
    }, 'approved');
    assert.equal(resolved.pushTitle, 'Yep: {title}');
    assert.ok(resolved.emailSubject.includes('{title}'));
});

test('renderEventTemplates builds season + decline vars', () => {
    const { rendered } = renderEventTemplates({}, 'season', {
        title: 'The Expanse',
        username: 'Jordan',
        mediaType: 'tv',
        seasonNumber: 3,
        serverName: 'Home',
    });
    assert.equal(rendered.pushTitle, 'Season 3 of The Expanse is available');
    assert.equal(rendered.pushBody, 'Season 3 of The Expanse is ready to watch.');

    const declined = renderEventTemplates({}, 'declined', {
        title: 'Movie',
        username: 'A',
        declineReason: 'Duplicate',
    });
    assert.match(declined.rendered.emailBody, /Reason: Duplicate/);
});

test('approved push copy includes the media title', () => {
    const { rendered } = renderEventTemplates({}, 'approved', {
        title: 'Dune',
        username: 'Jordan',
        mediaType: 'movie',
    });
    assert.equal(rendered.pushTitle, 'Approved: Dune');
    assert.equal(rendered.pushBody, 'Your request for Dune has been approved.');
});

test('buildNotifyVars maps media types', () => {
    const vars = buildNotifyVars({ mediaType: 'music', title: 'Album' });
    assert.equal(vars.media_type, 'album/artist');
    assert.equal(vars.request_label, 'New Music Request');
    assert.equal(vars.title, 'Album');
});

test('admin pending templates match overseerr-style request copy', () => {
    const movie = renderEventTemplates({}, 'admin_pending', {
        title: 'Yellow Eyes',
        username: 'SubZero',
        mediaType: 'movie',
        year: 2026,
    });
    assert.equal(
        movie.rendered.pushBody,
        'New Movie Request: Yellow Eyes (2026) [SubZero]',
    );

    const show = renderEventTemplates({}, 'admin_pending', {
        title: 'The Office',
        username: 'Vik',
        mediaType: 'tv',
        year: 2005,
    });
    assert.equal(
        show.rendered.pushBody,
        'New TV Show Request: The Office (2005) [Vik]',
    );

    const numericTv = renderEventTemplates({}, 'admin_pending', {
        title: 'Electric Bloom',
        username: 'breakingkayfabe',
        mediaType: 2,
    });
    assert.equal(
        numericTv.rendered.pushBody,
        'New TV Show Request: Electric Bloom [breakingkayfabe]',
    );
});

test('scanner activity push copy keeps a short title and action in the body', () => {
    const title = 'Big Brother (US) · S28E21 - Episode 21 [HDTV-1080p]';
    const imported = renderEventTemplates({}, 'scanner_import', { title });
    assert.equal(imported.rendered.pushTitle, 'Scanner Notification [Scanner]');
    assert.equal(imported.rendered.pushBody, `Imported: ${title}`);
    assert.equal(imported.rendered.ntfyTitle, 'Scanner Notification [Scanner]');
    assert.equal(imported.rendered.ntfyBody, `Imported: ${title}`);

    const lidarrImport = renderEventTemplates({}, 'scanner_import', {
        title: 'Ne-Yo · Highway 79 [FLAC 24bit]',
        service: 'Lidarr',
        serviceKind: 'lidarr',
    });
    assert.equal(lidarrImport.rendered.pushBody, '🎵 Imported: Ne-Yo · Highway 79 [FLAC 24bit]');
    assert.equal(lidarrImport.rendered.ntfyBody, '🎵 Imported: Ne-Yo · Highway 79 [FLAC 24bit]');

    const upgrade = renderEventTemplates({}, 'scanner_upgrade', { title, service: 'Sonarr', serviceKind: 'sonarr' });
    assert.equal(upgrade.rendered.pushTitle, 'Scanner Notification [Sonarr]');
    assert.equal(upgrade.rendered.pushBody, `📺 Upgraded: ${title}`);

    const deleted = renderEventTemplates({}, 'scanner_deleted', {
        title: 'The Office · S01E01',
        service: 'TV',
        serviceKind: 'sonarr',
    });
    assert.equal(deleted.rendered.pushTitle, 'Scanner Notification [TV]');
    assert.equal(deleted.rendered.pushBody, '📺 Deleted: The Office · S01E01');

    const grabbed = renderEventTemplates({}, 'scanner_grab', {
        title: 'The Office · S03E01 - Gay Witch Hunt [WEBDL-1080p]',
        filename: 'The.Office.S03E01.1080p.WEB.x264-GROUP',
        service: 'Sonarr',
        serviceKind: 'sonarr',
    });
    assert.equal(grabbed.rendered.pushTitle, 'Scanner Notification [Sonarr]');
    assert.equal(grabbed.rendered.pushBody, '📺 Grabbed: The.Office.S03E01.1080p.WEB.x264-GROUP');
    assert.equal(grabbed.rendered.ntfyBody, '📺 Grabbed: The.Office.S03E01.1080p.WEB.x264-GROUP');
    assert.equal(grabbed.vars.filename, 'The.Office.S03E01.1080p.WEB.x264-GROUP');

    const updated = renderEventTemplates({}, 'scanner_update', {
        title: 'Sonarr 4.0.14.2938 → 4.0.15.2941',
    });
    assert.equal(updated.rendered.pushBody, 'Updated: Sonarr 4.0.14.2938 → 4.0.15.2941');

    const interaction = renderEventTemplates({}, 'scanner_interaction', {
        title: 'Dune (2021)',
        filename: 'Dune.2021.2160p.WEB-GROUP',
    });
    assert.equal(interaction.rendered.pushBody, 'Needs attention: Dune.2021.2160p.WEB-GROUP');
    assert.equal(interaction.rendered.ntfyBody, 'Needs attention: Dune.2021.2160p.WEB-GROUP');
});

test('support ticket templates include the member and a ticket click URL', () => {
    const { rendered } = renderEventTemplates({}, 'support_ticket', {
        title: 'Plex buffering',
        username: 'Jay',
        portalUrl: 'https://portal.example/support?ticket=t1',
    });
    assert.equal(rendered.pushTitle, 'New support ticket');
    assert.equal(rendered.pushBody, 'Jay: Plex buffering');
    assert.match(rendered.gotifyBody, /https:\/\/portal\.example\/support\?ticket=t1/);
});
