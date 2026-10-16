/**
 * Automated portal email template defaults (Settings → Email Templates).
 * Admins override sparsely via config.emailTemplates.
 */

export const EMAIL_TEMPLATE_EVENTS = [
    'expiry_warning',
    'access_expired',
    'access_adjusted',
    'invite',
    'welcome',
    'newsletter',
    'announcement',
];

export const EMAIL_TEMPLATE_FIELDS = [
    'subject',
    'headline',
    'intro',
    'body',
    'ctaLabel',
    'renewTitle',
    'renewBody',
    'footer',
    'footerSecondary',
];

/** Which fields each event exposes in the editor. */
export const EMAIL_EVENT_FIELDS = {
    expiry_warning: ['subject', 'headline', 'intro', 'body', 'ctaLabel', 'footer', 'footerSecondary'],
    access_expired: ['subject', 'headline', 'intro', 'body', 'renewTitle', 'renewBody', 'footer', 'footerSecondary'],
    access_adjusted: ['subject', 'headline', 'intro', 'body', 'footer'],
    invite: ['subject', 'headline', 'intro', 'body', 'ctaLabel', 'footer', 'footerSecondary'],
    welcome: ['subject', 'headline', 'intro', 'body', 'ctaLabel', 'footer', 'footerSecondary'],
    newsletter: ['subject', 'intro', 'footer', 'footerSecondary'],
    announcement: ['subject', 'headline', 'footer'],
};

export const DEFAULT_EMAIL_TEMPLATES = {
    expiry_warning: {
        subject: '[{server_name}] Your shared access expires in {days_label}',
        headline: 'Access Expiry Notification',
        intro: 'Hello, <strong>{username}</strong>',
        body: 'This is a notification that your shared access to the media server is coming to an end soon. Below are your account details:',
        ctaLabel: 'Request Extension',
        footer: 'Automated alert from the StreamPilot.',
        footerSecondary: 'Please contact the administrator for any access queries.',
    },
    access_expired: {
        subject: '[{server_name}] Your shared access has expired',
        headline: 'Access Expired',
        intro: 'Hello, <strong>{username}</strong>',
        body: 'We\'re writing to let you know that your shared access to the media server has <strong style="color: #e53e3e;">expired</strong> and your account has been removed from the server.',
        renewTitle: 'Want to renew your access?',
        renewBody: 'If you\'d like to continue enjoying all the content, simply get in touch using any of the methods below and we\'ll get you set up again:',
        footer: 'Automated notification from the StreamPilot.',
        footerSecondary: 'We\'d love to have you back — don\'t hesitate to reach out!',
    },
    access_adjusted: {
        subject: '[{server_name}] Your access has been updated',
        headline: 'Access Updated',
        intro: 'Hello, <strong>{username}</strong>',
        body: 'Your access to the media server has been successfully updated. Here are your new account details:',
        footer: 'Automated notification from the StreamPilot.',
    },
    invite: {
        subject: 'You\'ve been invited to {server_name}!',
        headline: 'Welcome to the Server!',
        intro: 'You have been invited to join our private media server.',
        body: 'This invite link is for single use only. It will grant you access for <strong>{duration_days} days</strong>.',
        ctaLabel: 'Claim Your Access',
        footer: 'Automated notification from the StreamPilot.',
        footerSecondary: 'We hope you enjoy the server!',
    },
    welcome: {
        subject: 'Welcome to {server_name}!',
        headline: 'Welcome aboard!',
        intro: 'Hello, <strong>{username}</strong>',
        body: 'Your access to <strong>{server_name}</strong> is ready. Sign in to the portal to manage your account, request content, and see what\'s new.',
        ctaLabel: 'Open portal',
        footer: 'Automated welcome from the StreamPilot.',
        footerSecondary: 'We\'re glad you\'re here — enjoy the library!',
    },
    newsletter: {
        subject: '{server_name} Automated Newsletter',
        intro: '<strong>{username}</strong>, you are receiving this newsletter as you are a member of <strong>{server_name}</strong>.',
        footer: 'This is an automated message from StreamPilot.',
        footerSecondary: 'To opt out of these newsletters, please visit your <a href="{portal_url}" style="color: #eab308; text-decoration: none;">User Portal</a>.',
    },
    announcement: {
        subject: 'Server Announcement - {server_name}',
        headline: 'Server Announcement',
        footer: 'You are receiving this message because you are an active user on {server_name}.',
    },
};

export default {
    EMAIL_TEMPLATE_EVENTS,
    EMAIL_TEMPLATE_FIELDS,
    EMAIL_EVENT_FIELDS,
    DEFAULT_EMAIL_TEMPLATES,
};
