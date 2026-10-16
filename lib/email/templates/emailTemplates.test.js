import assert from 'node:assert/strict';
import test from 'node:test';
import {
    normalizeEmailTemplates,
    renderEmailEventTemplates,
    buildExpiryWarningEmail,
    buildAccessExpiredEmail,
    buildInviteEmail,
    buildCustomUserEmail,
    buildAnnouncementEmail,
    buildWelcomeEmail,
    buildAutomatedEmailPreview,
    DEFAULT_EMAIL_TEMPLATES,
} from './index.js';

test('normalizeEmailTemplates keeps sparse overrides and drops unknown events', () => {
    const normalized = normalizeEmailTemplates({
        expiry_warning: {
            subject: '  Custom subject {days_label}  ',
            body: '',
            unknown: 'nope',
        },
        not_a_real_event: { subject: 'x' },
    });
    assert.deepEqual(normalized, {
        expiry_warning: { subject: 'Custom subject {days_label}' },
    });
});

test('renderEmailEventTemplates substitutes tokens and preserves default HTML', () => {
    const { rendered } = renderEmailEventTemplates(
        {
            emailTemplates: {
                expiry_warning: {
                    subject: '[{server_name}] Expires in {days_label}',
                    intro: 'Hello <strong>{username}</strong>,',
                },
            },
        },
        'expiry_warning',
        {
            username: 'Vik <admin>',
            days: 3,
            expiryDate: 'September 5, 2026',
            serverName: 'BKFTV',
        },
    );
    assert.equal(rendered.subject, '[BKFTV] Expires in 3 days');
    assert.match(rendered.intro, /Vik &lt;admin&gt;/);
    assert.equal(rendered.headline, DEFAULT_EMAIL_TEMPLATES.expiry_warning.headline);
});

test('buildExpiryWarningEmail uses custom CTA and subject', () => {
    const mail = buildExpiryWarningEmail({
        config: {
            emailTemplates: {
                expiry_warning: {
                    subject: 'Hey {username} — {days_label} left',
                    ctaLabel: 'Renew now',
                },
            },
            contactUrl: 'https://example.com/help',
        },
        username: 'Alex',
        expiryDate: 'September 10, 2026',
        days: 1,
        serverName: 'Demo Server',
    });
    assert.equal(mail.subject, 'Hey Alex — 1 day left');
    assert.match(mail.html, /Renew now/);
    assert.match(mail.html, /September 10, 2026/);
    assert.match(mail.html, /https:\/\/example\.com\/help/);
});

test('buildAccessExpiredEmail includes contact block when configured', () => {
    const mail = buildAccessExpiredEmail({
        config: {
            contactEmail: 'owner@example.com',
            contactWhatsApp: '+1 555 0100',
        },
        username: 'Alex',
        expiryDate: 'September 1, 2026',
        serverName: 'Demo',
        hasLogo: true,
    });
    assert.match(mail.subject, /expired/i);
    assert.match(mail.html, /owner@example\.com/);
    assert.match(mail.html, /wa\.me\/15550100/);
    assert.match(mail.html, /cid:logo/);
    assert.match(mail.html, /max-width: 280px/);
    assert.match(mail.html, /-webkit-text-size-adjust: 100%/);
    assert.match(mail.html, /font-size: 16px/);
});

test('buildInviteEmail and announcement use templates', () => {
    const invite = buildInviteEmail({
        config: {
            emailTemplates: {
                invite: { headline: 'Join {server_name}' },
            },
        },
        serverName: 'Cinema Club',
        inviteUrl: 'https://portal.example/invite/abc',
        durationDays: 7,
    });
    assert.match(invite.subject, /Cinema Club/);
    assert.match(invite.html, /Join Cinema Club/);
    assert.match(invite.html, /7 days/);

    const announcement = buildAnnouncementEmail({
        config: {
            emailTemplates: {
                announcement: { subject: 'News from {server_name}' },
            },
        },
        serverName: 'Cinema Club',
        announcementText: 'Library expanded <3',
    });
    assert.equal(announcement.subject, 'News from Cinema Club');
    assert.match(announcement.html, /Library expanded &lt;3/);
});

test('buildCustomUserEmail uses the automated email shell', () => {
    const mail = buildCustomUserEmail({
        config: {},
        serverName: 'Cinema Club',
        bodyHtml: 'Hi <b>Sam</b>,<br><a href="https://portal.example">open the portal</a>',
        hasLogo: true,
    });
    assert.match(mail.html, /#282A2D/);
    assert.match(mail.html, /border-top: 6px solid #e5a00d/);
    assert.match(mail.html, /CINEMA CLUB|Cinema Club/);
    assert.match(mail.html, /Hi <b>Sam<\/b>/);
    assert.match(mail.html, /cid:logo/);
    assert.match(mail.html, /max-width: 280px/);
    assert.match(mail.html, /href="https:\/\/portal\.example"/);
    assert.match(mail.html, /color: #e5a00d/);
    assert.match(mail.html, /Message from the StreamPilot/);
    assert.doesNotMatch(mail.html, /<h2/);

    const hostile = buildCustomUserEmail({
        config: {},
        serverName: '<script>alert(1)</script>',
        bodyHtml: 'Hello',
    });
    assert.doesNotMatch(hostile.html, /<script>/);
    assert.match(hostile.html, /&lt;script&gt;/);
});

test('buildWelcomeEmail uses portal CTA from templates', () => {
    const mail = buildWelcomeEmail({
        config: {
            emailTemplates: {
                welcome: { headline: 'Hi from {server_name}' },
            },
        },
        username: 'Sam',
        serverName: 'Cinema Club',
        portalUrl: 'https://portal.example',
    });
    assert.match(mail.subject, /Cinema Club/);
    assert.match(mail.html, /Hi from Cinema Club/);
    assert.match(mail.html, /https:\/\/portal\.example/);
});

test('buildAutomatedEmailPreview merges draft fields', () => {
    const mail = buildAutomatedEmailPreview(
        { contactUrl: 'https://example.com/help' },
        'expiry_warning',
        { subject: 'Draft subject for {username}' },
    );
    assert.equal(mail.subject, 'Draft subject for Alex');
});

test('access emails include username but omit token-like server ids', () => {
    const token = '6cda09de4d7b3c32535ef2eecfb58049fabd586a';
    const mail = buildAccessExpiredEmail({
        config: { serverIdentifier: token },
        username: 'breakingkayfabe',
        expiryDate: 'September 10, 2026',
        serverName: token,
    });
    assert.doesNotMatch(mail.subject, /6cda09de/i);
    assert.doesNotMatch(mail.html, /6cda09de/i);
    assert.match(mail.subject, /Media Server/);
    assert.match(mail.html, /Hello, <strong>breakingkayfabe<\/strong>/);
    assert.match(mail.html, /Username:/);
    assert.match(mail.html, /breakingkayfabe/);

    const warning = buildExpiryWarningEmail({
        config: { serverIdentifier: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' },
        username: 'alice',
        expiryDate: 'September 12, 2026',
        days: 2,
        serverName: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    });
    assert.doesNotMatch(warning.subject, /aaaaaaaa-bbbb/i);
    assert.match(warning.html, /Hello, <strong>alice<\/strong>/);
    assert.match(warning.html, /Username:/);

    const named = buildAccessExpiredEmail({
        config: {},
        username: 'alice',
        expiryDate: 'September 10, 2026',
        serverName: 'SUBZERO',
    });
    assert.match(named.subject, /SUBZERO/);
    assert.match(named.html, /SUBZERO/i);
});
