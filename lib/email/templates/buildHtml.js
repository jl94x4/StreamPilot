/**
 * HTML shells for automated portal emails (editable copy via email templates).
 */

import { renderEmailEventTemplates, escapeHtml, sanitizeEmailServerName } from './render.js';

const displayServerName = (config, serverName) => sanitizeEmailServerName(serverName, {
    serverIdentifier: config?.serverIdentifier,
    fallback: 'Media Server',
});

const EMAIL_BODY_FONT = '16px';

/** Wide StreamPilot wordmark. */
export const emailHeaderLogoHtml = (src = 'cid:logo', alt = 'Logo') => `
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin: 0 auto 14px auto; width: 100%;">
            <tr>
                <td align="center" valign="middle">
                    <img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" width="280" style="display: block; max-width: 280px; width: 100%; height: auto; border: 0; margin: 0 auto;" />
                </td>
            </tr>
        </table>
    `;

const bodyP = (html) => `<p style="margin: 0 0 14px 0; font-size: ${EMAIL_BODY_FONT}; line-height: 1.6; color: #333333;">${html}</p>`;

const detailRow = (label, value, valueColor = '#2d3748') => `
    <tr>
        <td style="padding: 8px 12px 8px 0; color: #718096; font-weight: 500; font-size: ${EMAIL_BODY_FONT}; line-height: 1.4; white-space: nowrap;">${escapeHtml(label)}</td>
        <td style="padding: 8px 0; color: ${valueColor}; font-weight: bold; text-align: right; font-size: ${EMAIL_BODY_FONT}; line-height: 1.4; white-space: nowrap;">${value}</td>
    </tr>
`;

const shell = ({
    hasLogo = false,
    serverName = 'PLEX SERVER',
    accent = '#e5a00d',
    headlineColor = '#282A2D',
    headline = '',
    bodyHtml = '',
    footer = '',
    footerSecondary = '',
}) => `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width: 100%; background-color: #f4f6f9; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%;">
        <tr>
            <td style="padding: 24px 12px; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #333333;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width: 100%; max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.05); border-top: 6px solid ${accent};">
                    <tr>
                        <td style="background-color: #282A2D; padding: 25px; text-align: center;">
                            ${hasLogo ? emailHeaderLogoHtml() : ''}
                            <h1 style="color: #ffffff; margin: 0; font-size: 26px; line-height: 1.25; font-weight: 700; letter-spacing: 2px; text-transform: uppercase;">${escapeHtml(serverName)}</h1>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 30px 40px; font-size: ${EMAIL_BODY_FONT}; line-height: 1.6; color: #333333;">
                            ${String(headline || '').trim() ? `<h2 style="color: ${headlineColor}; font-size: 20px; line-height: 1.3; margin: 0 0 16px 0; font-weight: 600;">${headline}</h2>` : ''}
                            ${bodyHtml}
                        </td>
                    </tr>
                    <tr>
                        <td style="background-color: #f7fafc; padding: 20px 30px; border-top: 1px solid #edf2f7; text-align: center; font-size: 12px; line-height: 1.5; color: #a0aec0;">
                            ${footer ? `<p style="margin: 0 0 5px 0; font-size: 12px;">${footer}</p>` : ''}
                            ${footerSecondary ? `<p style="margin: 0; font-size: 12px;">${footerSecondary}</p>` : ''}
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
`;

const contactBlock = ({ contactEmail, contactWhatsApp, renewTitle, renewBody }) => {
    if (!contactEmail && !contactWhatsApp) return '';
    const email = String(contactEmail || '').trim();
    const whatsapp = String(contactWhatsApp || '').trim();
    const waDigits = whatsapp.replace(/\D/g, '');
    return `
        <p style="font-size: 16px; font-weight: 600; color: #282A2D; margin-bottom: 5px;">${renewTitle || 'Want to renew your access?'}</p>
        <p style="margin: 0 0 14px 0; font-size: ${EMAIL_BODY_FONT}; line-height: 1.6; color: #333333;">${renewBody || ''}</p>
        <div style="background-color: #fcf8f2; border-radius: 8px; padding: 20px; margin: 20px 0;">
            <table style="width: 100%; border-collapse: collapse; font-size: 15px;">
                ${email ? `<tr>
                    <td style="padding: 10px 0; vertical-align: middle;">
                        <span style="font-size: 20px; margin-right: 10px;">📧</span>
                        <strong style="color: #2d3748;">Email:</strong>
                    </td>
                    <td style="padding: 10px 0; text-align: right; vertical-align: middle;">
                        <a href="mailto:${escapeHtml(email)}" style="color: #e5a00d; text-decoration: none; font-weight: 600;">${escapeHtml(email)}</a>
                    </td>
                </tr>` : ''}
                ${whatsapp ? `<tr>
                    <td style="padding: 10px 0; vertical-align: middle; ${email ? 'border-top: 1px solid #edf2f7;' : ''}">
                        <span style="font-size: 20px; margin-right: 10px;">💬</span>
                        <strong style="color: #2d3748;">WhatsApp:</strong>
                    </td>
                    <td style="padding: 10px 0; text-align: right; vertical-align: middle; ${email ? 'border-top: 1px solid #edf2f7;' : ''}">
                        <a href="https://wa.me/${escapeHtml(waDigits)}" style="color: #25d366; text-decoration: none; font-weight: 600;">${escapeHtml(whatsapp)}</a>
                    </td>
                </tr>` : ''}
            </table>
        </div>
        <div style="text-align: center; margin: 30px 0 15px 0;">
            ${whatsapp ? `<a href="https://wa.me/${escapeHtml(waDigits)}" style="background-color: #25d366; color: #ffffff; text-decoration: none; padding: 14px 35px; font-weight: bold; border-radius: 6px; display: inline-block; font-size: 16px; box-shadow: 0 4px 6px rgba(37, 211, 102, 0.2); margin-right: 10px;">WhatsApp Me</a>` : ''}
            ${email ? `<a href="mailto:${escapeHtml(email)}" style="background-color: #e5a00d; color: #ffffff; text-decoration: none; padding: 14px 35px; font-weight: bold; border-radius: 6px; display: inline-block; font-size: 16px; box-shadow: 0 4px 6px rgba(229, 160, 13, 0.2);">Email Me</a>` : ''}
        </div>
    `;
};

export const buildExpiryWarningEmail = ({
    config,
    username,
    expiryDate,
    days,
    hasLogo = false,
    serverName = 'Plex Server',
} = {}) => {
    const safeServerName = displayServerName(config, serverName);
    const contactUrl = config?.contactUrl || `mailto:${config?.smtpFrom || config?.smtpUser || ''}`;
    const { rendered } = renderEmailEventTemplates(config, 'expiry_warning', {
        username,
        days,
        expiryDate,
        serverName: safeServerName,
        contactUrl,
    });
    const accent = '#e5a00d';
    const bodyHtml = `
        ${bodyP(rendered.intro || '')}
        ${bodyP(rendered.body || '')}
        <div style="background-color: #fcf8f2; border-left: 4px solid ${accent}; padding: 20px; margin: 25px 0; border-radius: 6px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width: 100%; border-collapse: collapse; font-size: ${EMAIL_BODY_FONT};">
                ${detailRow('Username:', escapeHtml(username), '#2d3748')}
                ${detailRow('Expiry Date:', escapeHtml(expiryDate), accent)}
                ${detailRow('Time Remaining:', escapeHtml(`${days} day${Number(days) === 1 ? '' : 's'}`), accent)}
            </table>
        </div>
        <div style="text-align: center; margin: 35px 0 15px 0;">
            <a href="${escapeHtml(contactUrl)}" style="background-color: ${accent}; color: #ffffff; text-decoration: none; padding: 14px 35px; font-weight: bold; border-radius: 6px; display: inline-block; font-size: 16px; box-shadow: 0 4px 6px rgba(229, 160, 13, 0.2);">${rendered.ctaLabel || 'Request Extension'}</a>
        </div>
    `;
    return {
        subject: rendered.subject,
        html: shell({
            hasLogo,
            serverName: safeServerName,
            accent,
            headline: rendered.headline,
            bodyHtml,
            footer: rendered.footer,
            footerSecondary: rendered.footerSecondary,
        }),
    };
};

export const buildAccessExpiredEmail = ({
    config,
    username,
    expiryDate,
    hasLogo = false,
    serverName = 'Plex Server',
} = {}) => {
    const safeServerName = displayServerName(config, serverName);
    const { rendered } = renderEmailEventTemplates(config, 'access_expired', {
        username,
        expiryDate,
        serverName: safeServerName,
        status: 'Access Revoked',
        contactEmail: config?.contactEmail || '',
        contactWhatsApp: config?.contactWhatsApp || '',
    });
    const accent = '#e53e3e';
    const bodyHtml = `
        ${bodyP(rendered.intro || '')}
        ${bodyP(rendered.body || '')}
        <div style="background-color: #fff5f5; border-left: 4px solid ${accent}; padding: 20px; margin: 25px 0; border-radius: 6px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width: 100%; border-collapse: collapse; font-size: ${EMAIL_BODY_FONT};">
                ${detailRow('Username:', escapeHtml(username), '#2d3748')}
                ${detailRow('Expiry Date:', escapeHtml(expiryDate), accent)}
                ${detailRow('Status:', 'Access Revoked', accent)}
            </table>
        </div>
        ${contactBlock({
            contactEmail: config?.contactEmail,
            contactWhatsApp: config?.contactWhatsApp,
            renewTitle: rendered.renewTitle,
            renewBody: rendered.renewBody,
        })}
    `;
    return {
        subject: rendered.subject,
        html: shell({
            hasLogo,
            serverName: safeServerName,
            accent,
            headlineColor: accent,
            headline: rendered.headline,
            bodyHtml,
            footer: rendered.footer,
            footerSecondary: rendered.footerSecondary,
        }),
    };
};

export const buildAccessAdjustedEmail = ({
    config,
    username,
    expiryDateLabel,
    days = null,
    hasLogo = false,
    serverName = 'Plex Server',
} = {}) => {
    const safeServerName = displayServerName(config, serverName);
    const timeRemaining = days == null ? '' : `${days} day${Number(days) === 1 ? '' : 's'}`;
    const { rendered } = renderEmailEventTemplates(config, 'access_adjusted', {
        username,
        newExpiryDate: expiryDateLabel,
        days,
        timeRemaining,
        serverName: safeServerName,
    });
    const accent = '#e5a00d';
    const bodyHtml = `
        ${bodyP(rendered.intro || '')}
        ${bodyP(rendered.body || '')}
        <div style="background-color: #fcf8f2; border-left: 4px solid ${accent}; padding: 20px; margin: 25px 0; border-radius: 6px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width: 100%; border-collapse: collapse; font-size: ${EMAIL_BODY_FONT};">
                ${detailRow('Username:', escapeHtml(username), '#2d3748')}
                ${detailRow('New Expiry Date:', escapeHtml(expiryDateLabel || 'Unlimited'), accent)}
                ${days !== null ? detailRow('Time Remaining:', escapeHtml(timeRemaining), accent) : ''}
            </table>
        </div>
        ${bodyP('Thank you for continuing to be a part of our community!')}
    `;
    return {
        subject: rendered.subject,
        html: shell({
            hasLogo,
            serverName: safeServerName,
            accent,
            headline: rendered.headline,
            bodyHtml,
            footer: rendered.footer,
        }),
    };
};

export const buildInviteEmail = ({
    config,
    serverName = 'Our Plex Server',
    inviteUrl = '',
    durationDays = 30,
    noteHtml = '',
    hasLogo = false,
} = {}) => {
    const safeServerName = displayServerName(config, serverName);
    const { rendered } = renderEmailEventTemplates(config, 'invite', {
        serverName: safeServerName,
        inviteUrl,
        durationDays,
    });
    const accent = '#e5a00d';
    const bodyHtml = `
        <p style="text-align: center; font-size: 16px; line-height: 1.6; margin: 0 0 14px 0; color: #333333;">${rendered.intro || ''}</p>
        ${noteHtml ? `<div style="margin: 24px 0 0 0; padding: 16px 18px; background-color: #fcf8f2; border-radius: 8px; font-size: 15px; color: #2d3748;">${noteHtml}</div>` : ''}
        <div style="text-align: center; margin: 35px 0;">
            <a href="${escapeHtml(inviteUrl)}" style="background-color: ${accent}; color: #ffffff; text-decoration: none; padding: 14px 35px; font-weight: bold; border-radius: 6px; display: inline-block; font-size: 16px; box-shadow: 0 4px 6px rgba(229, 160, 13, 0.2);">${rendered.ctaLabel || 'Claim Your Access'}</a>
        </div>
        <div style="background-color: #fcf8f2; border-left: 4px solid ${accent}; padding: 20px; margin: 25px 0 0 0; border-radius: 6px;">
            <p style="margin: 0; font-size: 14px; color: #718096; text-align: center;">${rendered.body || ''}</p>
        </div>
    `;
    return {
        subject: rendered.subject,
        html: shell({
            hasLogo,
            serverName: safeServerName,
            accent,
            headlineColor: accent,
            headline: `<span style="display:block;text-align:center;">${rendered.headline || ''}</span>`,
            bodyHtml,
            footer: rendered.footer,
            footerSecondary: rendered.footerSecondary,
        }),
    };
};

const styleCustomEmailLinks = (html) => String(html || '').replace(
    /<a\b([^>]*)>/gi,
    (full, attrs) => {
        if (/\bstyle\s*=/i.test(attrs)) return full;
        return `<a style="color: #e5a00d; font-weight: 600; text-decoration: none;"${attrs}>`;
    },
);

/** Admin-authored user email, wrapped in the same card as automated portal mail. */
export const buildCustomUserEmail = ({
    config,
    serverName = 'Plex Server',
    bodyHtml = '',
    hasLogo = false,
} = {}) => {
    const safeServerName = displayServerName(config, serverName);
    return {
        html: shell({
            hasLogo,
            serverName: safeServerName,
            accent: '#e5a00d',
            bodyHtml: styleCustomEmailLinks(bodyHtml),
            footer: 'Message from the StreamPilot.',
            footerSecondary: `You are receiving this message because you have an account on ${escapeHtml(safeServerName)}.`,
        }),
    };
};

export const buildAnnouncementEmail = ({
    config,
    serverName = 'Plex',
    announcementText = '',
} = {}) => {
    const safeServerName = displayServerName(config, serverName);
    const { rendered } = renderEmailEventTemplates(config, 'announcement', {
        serverName: safeServerName,
        announcement: announcementText,
    });
    const safeAnnouncement = escapeHtml(String(announcementText || '')).replace(/\n/g, '<br>');
    const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #1a1b26; color: #a9b1d6; padding: 20px; border-radius: 10px;">
            <h2 style="color: #E5A00D; text-align: center; text-transform: uppercase; letter-spacing: 2px;">${rendered.headline || 'Server Announcement'}</h2>
            <div style="background-color: #24283b; padding: 20px; border-radius: 8px; margin-top: 20px; border-left: 4px solid #E5A00D;">
                <p style="white-space: pre-wrap; font-size: 16px; line-height: 1.6; color: #c0caf5; margin: 0;">${safeAnnouncement}</p>
            </div>
            <p style="text-align: center; margin-top: 30px; font-size: 12px; color: #565f89;">
                ${rendered.footer || ''}
            </p>
        </div>
    `;
    return {
        subject: rendered.subject,
        html,
    };
};

export const buildWelcomeEmail = ({
    config,
    username = 'there',
    serverName = 'Plex Server',
    portalUrl = '',
    hasLogo = false,
} = {}) => {
    const safeServerName = displayServerName(config, serverName);
    const { rendered } = renderEmailEventTemplates(config, 'welcome', {
        username,
        serverName: safeServerName,
        portalUrl: portalUrl || '#',
    });
    const accent = '#e5a00d';
    const ctaHref = escapeHtml(portalUrl || '#');
    const bodyHtml = `
        ${bodyP(rendered.intro || '')}
        ${bodyP(rendered.body || '')}
        <div style="text-align: center; margin: 35px 0 15px 0;">
            <a href="${ctaHref}" style="background-color: ${accent}; color: #ffffff; text-decoration: none; padding: 14px 35px; font-weight: bold; border-radius: 6px; display: inline-block; font-size: 16px; box-shadow: 0 4px 6px rgba(229, 160, 13, 0.2);">${rendered.ctaLabel || 'Open portal'}</a>
        </div>
    `;
    return {
        subject: rendered.subject,
        html: shell({
            hasLogo,
            serverName: safeServerName,
            accent,
            headlineColor: accent,
            headline: rendered.headline,
            bodyHtml,
            footer: rendered.footer,
            footerSecondary: rendered.footerSecondary,
        }),
    };
};

export default {
    emailHeaderLogoHtml,
    buildExpiryWarningEmail,
    buildAccessExpiredEmail,
    buildAccessAdjustedEmail,
    buildInviteEmail,
    buildCustomUserEmail,
    buildAnnouncementEmail,
    buildWelcomeEmail,
};
