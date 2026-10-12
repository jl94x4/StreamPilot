export const SETTINGS_TABS = [
    'plex', 'notifications', 'newsletter', 'cleanup', 'cleaner', 'mediastack', 'request', 'branding', 'layout', 'applets',
    'achievements', 'analytics', 'status', 'invites', 'tasks', 'upgrader', 'collexions', 'spotify-sync', 'metadata-fill', 'media-automation', 'poster-sets', 'overlays', 'editions', 'system', 'contact', 'broadcast', 'stream-rules', 'logs',
] as const;

export type SettingsTabId = typeof SETTINGS_TABS[number];

export type SettingsIndexEntry = {
    id: string;
    tabId: SettingsTabId;
    sectionId?: string;
    label: string;
    labelKey?: string;
    group: string;
    keywords: string[];
};

export const SETTINGS_INDEX: SettingsIndexEntry[] = [
    { id: 'branding', tabId: 'branding', label: 'Portal UI', group: 'Portal', keywords: ['theme', 'logo', 'color', 'branding', 'ui', 'public url', 'public base url', 'invite link', 'chat', 'community'] },
    { id: 'branding/public-base-url', tabId: 'branding', sectionId: 'public-base-url', label: 'Public Base URL', labelKey: 'settings.search.entries.publicBaseUrl', group: 'Portal', keywords: ['public', 'url', 'domain', 'invite', 'email', 'newsletter', 'base url', 'https', 'reverse proxy'] },
    { id: 'branding/logo', tabId: 'branding', sectionId: 'logo', label: 'Custom Logo', labelKey: 'settings.search.entries.customLogo', group: 'Portal', keywords: ['logo', 'icon', 'favicon', 'upload'] },
    { id: 'branding/theme', tabId: 'branding', sectionId: 'theme', label: 'Portal Theme', labelKey: 'settings.search.entries.portalTheme', group: 'Portal', keywords: ['theme', 'light', 'plex dark', 'slate', 'jellyfin purple', 'ocean', 'rose', 'royal', 'graphite', 'cyber lime', 'aurora'] },
    { id: 'branding/announcement', tabId: 'branding', sectionId: 'announcement', label: 'Portal Announcement', labelKey: 'settings.search.entries.portalAnnouncement', group: 'Portal', keywords: ['announcement', 'banner', 'notice'] },
    { id: 'branding/poster-badges', tabId: 'branding', sectionId: 'poster-badges', label: 'Poster Quality Badges', labelKey: 'settings.search.entries.posterQualityBadges', group: 'Portal', keywords: ['poster', 'quality', 'badges', 'hdr', '4k', 'codec'] },
    { id: 'branding/dashboard-watching-badge', tabId: 'branding', sectionId: 'dashboard-watching-badge', label: 'Dashboard Watching Badge', labelKey: 'settings.search.entries.dashboardWatchingBadge', group: 'Portal', keywords: ['dashboard', 'watching', 'streams', 'sidebar', 'badge', 'nav', 'poll', 'interval', 'seconds'] },
    { id: 'branding/slideshow', tabId: 'branding', sectionId: 'slideshow', label: 'TMDB Trending Slideshow', labelKey: 'settings.search.entries.tmdbTrendingSlideshow', group: 'Portal', keywords: ['slideshow', 'tmdb', 'trending', 'background', 'splash'] },
    { id: 'branding/community-chat', tabId: 'branding', sectionId: 'community-chat', label: 'Community chat', labelKey: 'settings.search.entries.communityChat', group: 'Portal', keywords: ['chat', 'community', 'channels', 'discord', 'messaging', 'live chat', 'rooms', 'mention', 'mentions', '@'] },
    { id: 'branding/chat-mention-notify', tabId: 'branding', sectionId: 'community-chat', label: 'Chat @mention notifications', labelKey: 'settings.search.entries.chatMentionNotifications', group: 'Portal', keywords: ['chat', 'mention', 'mentions', '@', 'notify', 'notification', 'bell'] },

    { id: 'contact', tabId: 'contact', label: 'Contact Details', group: 'Portal', keywords: ['contact', 'support', 'help'] },
    { id: 'contact/whatsapp', tabId: 'contact', sectionId: 'whatsapp', label: 'WhatsApp Number', labelKey: 'settings.search.entries.whatsAppNumber', group: 'Portal', keywords: ['whatsapp', 'phone', 'number'] },
    { id: 'contact/email', tabId: 'contact', sectionId: 'email', label: 'Contact Email', labelKey: 'settings.search.entries.contactEmail', group: 'Portal', keywords: ['email', 'mail', 'support'] },

    { id: 'layout', tabId: 'layout', label: 'Layout', group: 'Portal', keywords: ['layout', 'navigation', 'menu', 'order', 'sidebar', 'home', 'dashboard', 'widgets', 'sections', 'reorder', 'hide', 'downloads', 'members'] },
    { id: 'applets', tabId: 'applets', label: 'Applets', group: 'Portal', keywords: ['applets', 'launcher', 'custom', 'external', 'tabs', 'links', 'iframe', 'embed', 'services', 'navigation', 'sidebar'] },
    { id: 'layout/navigation', tabId: 'layout', sectionId: 'navigation', label: 'Navigation', labelKey: 'settings.navigation.sections.navigation', group: 'Portal', keywords: ['menu', 'order', 'sidebar', 'nav', 'downloads', 'members', 'icon', 'logo', 'customize'] },
    { id: 'layout/home-modules', tabId: 'layout', sectionId: 'home-modules', label: 'Home Custom Modules', labelKey: 'settings.navigation.sections.homeModules', group: 'Portal', keywords: ['dashboard', 'home', 'modules', 'html', 'iframe', 'custom', 'widget'] },
    { id: 'layout/home-layout', tabId: 'layout', sectionId: 'home-layout', label: 'Home Layout', labelKey: 'settings.navigation.sections.homeLayout', group: 'Portal', keywords: ['dashboard', 'widgets', 'sections', 'home', 'layout', 'reorder', 'hide'] },
    { id: 'achievements', tabId: 'achievements', label: 'Achievements', group: 'Portal', keywords: ['xp', 'badges', 'leaderboard', 'gamification', 'achievements', 'level'] },
    { id: 'analytics', tabId: 'analytics', label: 'Analytics', group: 'Portal', keywords: ['analytics', 'tautulli', 'watch history', 'usernames', 'rebuild', 'cache', 'source'] },
    { id: 'analytics/history-source', tabId: 'analytics', sectionId: 'history-source', label: 'Watch History Source', labelKey: 'settings.search.entries.watchHistorySource', group: 'Portal', keywords: ['tautulli', 'plex', 'watch history', 'source', 'analytics', 'achievements'] },
    { id: 'analytics/usernames', tabId: 'analytics', sectionId: 'usernames', label: 'Show Usernames in Analytics', labelKey: 'settings.search.entries.showUsernamesInAnalytics', group: 'Portal', keywords: ['analytics', 'usernames', 'viewer', 'privacy', 'device'] },
    { id: 'analytics/cache', tabId: 'analytics', sectionId: 'cache', label: 'Analytics Cache', labelKey: 'settings.search.entries.analyticsCache', group: 'Portal', keywords: ['rebuild', 'cache', 'source', 'tautulli'] },

    { id: 'plex', tabId: 'plex', label: 'Media Player', group: 'Media Stack', keywords: ['plex', 'jellyfin', 'media', 'player', 'server'] },
    { id: 'plex/home-hero', tabId: 'plex', sectionId: 'home-hero', label: 'Media Player Home Hero', labelKey: 'settings.search.entries.mediaPlayerHomeHero', group: 'Media Stack', keywords: ['hero', 'slideshow', 'trending', 'tmdb', 'media player', 'home', 'seasonal', 'halloween', 'christmas', 'continue watching', 'hero mode', 'settings'] },
    { id: 'plex/connection', tabId: 'plex', sectionId: 'connection', label: 'Media Server Connection', labelKey: 'settings.search.entries.mediaServerConnection', group: 'Media Stack', keywords: ['token', 'server', 'docker', 'url', 'jellyfin', 'plex'] },
    { id: 'plex/privacy', tabId: 'plex', sectionId: 'privacy', label: 'Stream User Privacy', labelKey: 'settings.search.entries.streamUserPrivacy', group: 'Media Stack', keywords: ['privacy', 'anonymous', 'hide', 'stream', 'users', 'player', 'device', 'achievements', 'leaderboard'] },
    { id: 'plex/libraries', tabId: 'plex', sectionId: 'libraries', label: 'Default Libraries', labelKey: 'settings.search.entries.defaultLibraries', group: 'Media Stack', keywords: ['libraries', 'share', 'temporary', 'access'] },

    { id: 'mediastack', tabId: 'mediastack', label: 'Integrations', group: 'Media Stack', keywords: ['integrations', 'arr', 'sonarr', 'radarr', 'lidarr', 'bazarr', 'downloads', 'qbittorrent', 'rdt-client', 'real-debrid', 'transmission', 'deluge', 'sabnzbd', 'nzbget', 'nzb'] },
    { id: 'mediastack/arr', tabId: 'mediastack', sectionId: 'arr', label: 'Sonarr & Radarr Instances', labelKey: 'settings.search.entries.sonarrRadarrInstances', group: 'Media Stack', keywords: ['sonarr', 'radarr', 'arr', 'instances'] },
    { id: 'mediastack/lidarr', tabId: 'mediastack', sectionId: 'lidarr', label: 'Lidarr Instances', labelKey: 'settings.arrIntegrations.titles.lidarrInstances', group: 'Media Stack', keywords: ['lidarr', 'music', 'artists', 'albums', 'instances'] },
    { id: 'mediastack/bazarr', tabId: 'mediastack', sectionId: 'bazarr', label: 'Bazarr Instances', labelKey: 'settings.arrIntegrations.titles.bazarrInstances', group: 'Media Stack', keywords: ['bazarr', 'subtitles', 'subtitle', 'instances'] },
    { id: 'mediastack/download-clients', tabId: 'mediastack', sectionId: 'download-clients', label: 'Download Clients', labelKey: 'settings.search.entries.downloadClients', group: 'Media Stack', keywords: ['downloads', 'qbittorrent', 'rdt-client', 'real-debrid', 'transmission', 'bittorrent', 'deluge', 'sabnzbd', 'nzbget', 'nzb', 'torrents'] },
    { id: 'mediastack/tautulli', tabId: 'mediastack', sectionId: 'tautulli', label: 'Tautulli Integration', labelKey: 'settings.search.entries.tautulliIntegration', group: 'Media Stack', keywords: ['tautulli', 'analytics', 'plex'] },
    { id: 'mediastack/jellystat', tabId: 'mediastack', sectionId: 'jellystat', label: 'Jellyfin Analytics', labelKey: 'settings.search.entries.jellyfinAnalytics', group: 'Media Stack', keywords: ['jellystat', 'jellyglance', 'jellyfin', 'analytics'] },
    { id: 'mediastack/seerr', tabId: 'mediastack', sectionId: 'seerr', label: 'Request App (Seerr/Ombi)', labelKey: 'settings.search.entries.requestApp', group: 'Media Stack', keywords: ['seerr', 'overseerr', 'jellyseerr', 'ombi', 'request'] },
    { id: 'mediastack/tmdb', tabId: 'mediastack', sectionId: 'tmdb', label: 'TMDB API Key', labelKey: 'settings.search.entries.tmdbApiKey', group: 'Media Stack', keywords: ['tmdb', 'api', 'trending', 'metadata'] },

    { id: 'request', tabId: 'request', label: 'Request Discovery', group: 'Media Stack', keywords: ['request', 'discover', 'discovery', 'region', 'language', 'hide available', 'quota', 'permissions', 'seerr', 'overseerr', 'tmdb'] },
    { id: 'request/discovery-source', tabId: 'request', sectionId: 'discovery-source', label: 'Discover Metadata Source', labelKey: 'settings.search.entries.discoverMetadataSource', group: 'Media Stack', keywords: ['discovery source', 'tmdb', 'seerr', 'metadata', 'proxy'] },
    { id: 'request/request-engine', tabId: 'request', sectionId: 'request-engine', label: 'Request Engine', labelKey: 'settings.search.entries.requestEngine', group: 'Media Stack', keywords: ['request engine', 'portal', 'json', 'seerr', 'my requests'] },
    { id: 'request/request-form', tabId: 'request', sectionId: 'request-form', label: 'Request Form Options', group: 'Media Stack', keywords: ['advanced', 'library', 'root folder', 'quality profile', 'tags', 'destination', 'disable', 'skip', 'request form'] },
    { id: 'request/metadata-providers', tabId: 'request', sectionId: 'metadata-providers', label: 'Metadata Providers', labelKey: 'settings.search.entries.metadataProviders', group: 'Media Stack', keywords: ['tmdb', 'tvdb', 'series', 'anime', 'provider'] },
    { id: 'request/request-permissions', tabId: 'request', sectionId: 'request-permissions', label: 'Request Permissions', labelKey: 'settings.search.entries.requestPermissions', group: 'Media Stack', keywords: ['permissions', '4k', 'watchlist', 'recently added'] },
    { id: 'request/auto-approve', tabId: 'request', sectionId: 'auto-approve', label: 'Auto-Approve', labelKey: 'settings.search.entries.autoApprove', group: 'Media Stack', keywords: ['auto approve', '4k', 'movies', 'series'] },
    { id: 'request/auto-request', tabId: 'request', sectionId: 'auto-request', label: 'Watchlist Auto-Request', labelKey: 'settings.search.entries.watchlistAutoRequest', group: 'Media Stack', keywords: ['auto request', 'watchlist', 'plex'] },
    { id: 'request/portal-quotas', tabId: 'request', sectionId: 'portal-quotas', label: 'Request Quotas', labelKey: 'settings.search.entries.requestQuotas', group: 'Media Stack', keywords: ['quota', 'limit', 'unlimited', '4k'] },
    { id: 'request/region', tabId: 'request', sectionId: 'region', label: 'Discover Region', labelKey: 'settings.search.entries.discoverRegion', group: 'Media Stack', keywords: ['discover region', 'country', 'region', 'availability'] },
    { id: 'request/language', tabId: 'request', sectionId: 'language', label: 'Discover Language', labelKey: 'settings.search.entries.discoverLanguage', group: 'Media Stack', keywords: ['discover language', 'original language', 'filter language'] },
    { id: 'request/hide-available', tabId: 'request', sectionId: 'hide-available', label: 'Hide Available Media', labelKey: 'settings.search.entries.hideAvailableMedia', group: 'Media Stack', keywords: ['hide available', 'library', 'discover filter'] },

    { id: 'status', tabId: 'status', label: 'Status Monitor', group: 'Media Stack', keywords: ['uptime', 'health', 'services', 'monitor'] },

    { id: 'notifications', tabId: 'notifications', label: 'Notifications', group: 'Comms', keywords: ['notifications', 'bell', 'web push', 'discord', 'request available', 'vapid', 'in-app', 'test', 'smtp', 'mail', 'email', 'gotify', 'alerts'] },
    { id: 'notifications/smtp', tabId: 'notifications', sectionId: 'smtp', label: 'SMTP Alerts', labelKey: 'settings.search.entries.smtpAlerts', group: 'Comms', keywords: ['mail', 'smtp', 'email', 'alerts', 'test'] },
    { id: 'notifications/status', tabId: 'notifications', sectionId: 'notifications-status', label: 'Notification Health', labelKey: 'settings.search.entries.notificationHealth', group: 'Comms', keywords: ['health', 'status', 'vapid', 'smtp', 'discord', 'job'] },
    { id: 'notifications/request-available', tabId: 'notifications', sectionId: 'notifications-request-available', label: 'Request Available Alerts', labelKey: 'settings.search.entries.requestAvailableAlerts', group: 'Comms', keywords: ['request available', 'email', 'in-app', 'push', 'discord'] },
    { id: 'notifications/not-released', tabId: 'notifications', sectionId: 'notifications-not-released', label: 'Not Released Yet', labelKey: 'settings.search.entries.notReleasedYet', group: 'Comms', keywords: ['release', 'digital', 'theatrical', 'calendar', 'unreleased'] },
    { id: 'notifications/scanner', tabId: 'notifications', sectionId: 'notifications-scanner', label: 'Scanner Notifications', labelKey: 'settings.search.entries.scannerNotifications', group: 'Comms', keywords: ['scanner', 'deleted', 'upgrade', 'import', 'grab', 'grabbed', 'sonarr', 'radarr', 'lidarr'] },
    { id: 'notifications/templates', tabId: 'notifications', sectionId: 'notifications-templates', label: 'Notification Templates', labelKey: 'settings.search.entries.notificationTemplates', group: 'Comms', keywords: ['template', 'email subject', 'push title', 'discord', 'copy', 'message'] },
    { id: 'notifications/ntfy', tabId: 'notifications', sectionId: 'notifications-ntfy', label: 'ntfy', labelKey: 'settings.notifications.common.ntfy', group: 'Comms', keywords: ['ntfy', 'push', 'topic', 'self hosted'] },
    { id: 'notifications/webhook', tabId: 'notifications', sectionId: 'notifications-webhook', label: 'Generic Webhook', labelKey: 'settings.search.entries.genericWebhook', group: 'Comms', keywords: ['webhook', 'json', 'http', 'integration'] },
    { id: 'notifications/test', tabId: 'notifications', sectionId: 'notifications-test', label: 'Send Test Notification', labelKey: 'settings.search.entries.sendTestNotification', group: 'Comms', keywords: ['test', 'send', 'bell'] },
    { id: 'notifications/recent', tabId: 'notifications', sectionId: 'notifications-recent', label: 'Recent Notifications', labelKey: 'settings.search.entries.recentNotifications', group: 'Comms', keywords: ['history', 'log', 'recent', 'bell'] },
    { id: 'notifications/summary', tabId: 'notifications', sectionId: 'notifications-summary', label: 'Smart Summary Notifications', labelKey: 'settings.search.entries.smartSummaryNotifications', group: 'Comms', keywords: ['summary', 'digest', 'smart', 'scheduled', 'uptime', 'snapshot'] },
    { id: 'notifications/gotify', tabId: 'notifications', sectionId: 'gotify', label: 'Gotify Alerts', labelKey: 'settings.search.entries.gotifyAlerts', group: 'Comms', keywords: ['gotify', 'push', 'alerts', 'notifications', 'rules', 'self hosted'] },
    { id: 'newsletter', tabId: 'newsletter', label: 'Newsletter', group: 'Comms', keywords: ['digest', 'send', 'frequency', 'weekly', 'monthly'] },
    { id: 'broadcast', tabId: 'broadcast', label: 'Email Templates', group: 'Comms', keywords: ['announcement', 'bulk', 'users', 'broadcast', 'custom email', 'select users', 'recipients', 'email templates', 'expiry email', 'invite email'] },
    { id: 'invites', tabId: 'invites', label: 'Invites', group: 'Comms', keywords: ['invite', 'link', 'code'] },
    { id: 'invites/referral', tabId: 'invites', sectionId: 'referral', label: 'Referral System', labelKey: 'settings.invites.referralTitle', group: 'Comms', keywords: ['referral', 'reward', 'trial', 'invite friends'] },
    { id: 'invites/referral-history', tabId: 'invites', sectionId: 'referral-history', label: 'Referral History', labelKey: 'settings.invites.referralHistoryTitle', group: 'Comms', keywords: ['referral history', 'reward history', 'who invited', 'bonus days'] },
    { id: 'invites/onboarding', tabId: 'invites', sectionId: 'onboarding', label: 'User Onboarding', labelKey: 'settings.invites.onboardingTitle', group: 'Comms', keywords: ['onboarding', 'welcome', 'rules', 'wizard', 'new user'] },
    { id: 'invites/profiles', tabId: 'invites', sectionId: 'invite-profiles', label: 'Invitation Profiles', labelKey: 'settings.invites.profilesTitle', group: 'Comms', keywords: ['invite profile', 'preset', 'template', 'duration', 'libraries'] },
    { id: 'invites/links', tabId: 'invites', sectionId: 'invite-links', label: 'Automated Invite Links', labelKey: 'settings.invites.inviteLinksTitle', group: 'Comms', keywords: ['invite link', 'generate', 'email invite'] },

    { id: 'cleanup', tabId: 'cleanup', label: 'Cleanup', group: 'Automation', keywords: ['inactive', 'revoke', 'expiry', 'cleanup', 'preview', 'last watched'] },
    { id: 'cleaner', tabId: 'cleaner', label: 'Library Cleaner', labelKey: 'settings.navigation.tabs.cleaner', group: 'Automation', keywords: ['cleaner', 'maintenance', 'maintainerr', 'maintainer', 'library', 'unwatched', 'experimental', 'sonarr', 'radarr'] },
    { id: 'stream-rules', tabId: 'stream-rules', label: 'Stream Rules', group: 'Automation', keywords: ['kill', 'transcode', 'rule', 'stream'] },
    { id: 'tasks', tabId: 'tasks', label: 'Background Tasks', group: 'Automation', keywords: ['jobs', 'scheduler', 'run now', 'tasks'] },
    { id: 'upgrader', tabId: 'upgrader', label: 'Library Upgrader', group: 'Automation', keywords: ['upgrader', 'hevc', 'h264', 'codec', 'upgrade', 'sonarr', 'radarr'] },
    { id: 'collexions', tabId: 'collexions', label: 'Collexions', group: 'Automation', keywords: ['collexions', 'collections', 'plex', 'trakt', 'sidecar', 'pinning', 'autostart', 'auto start'] },
    { id: 'spotify-sync', tabId: 'spotify-sync', label: 'Spotify Sync', group: 'Automation', keywords: ['spotify', 'sync', 'playlist', 'music', 'lidarr', 'plex', 'sidecar'] },
    { id: 'metadata-fill', tabId: 'metadata-fill', label: 'Metadata Fill', group: 'Automation', keywords: ['metadata', 'tmdb', 'tvdb', 'tba', 'tbc', 'episode', 'scraper', 'sonarr', 'plex', 'summary'] },
    { id: 'scanner', tabId: 'scanner', label: 'Scanner', group: 'Automation', keywords: ['scanner', 'autoscan', 'plex scan', 'webhook', 'sonarr', 'radarr', 'lidarr', 'triggers', 'library refresh'] },
    { id: 'media-automation', tabId: 'media-automation', label: 'Media Automation', group: 'Automation', keywords: ['media', 'automation', 'ffmpeg', 'worker', 'transcode', 'remux', 'pipeline', 'hardware', 'nvenc', 'qsv', 'vaapi', 'quiet hours', 'schedule', 'overnight', 'gotify'] },
    { id: 'poster-sets', tabId: 'poster-sets', label: 'Poster Sets', group: 'Automation', keywords: ['poster', 'sets', 'mediux', 'theposterdb', 'artwork', 'plex posters', 'title cards'] },
    { id: 'overlays', tabId: 'overlays', label: 'Overlays', group: 'Automation', keywords: ['overlays', 'new season', 'banner', 'layer', 'poster overlay', 'season overlay'] },
    { id: 'editions', tabId: 'editions', label: 'Editions', group: 'Automation', keywords: ['editions', 'edition manager', 'plex edition', 'cut', 'remux', 'hdr', 'audio codec', 'webhook'] },
    { id: 'watch-sync', tabId: 'watch-sync', label: 'Watch Sync', group: 'Automation', keywords: ['watch sync', 'trakt', 'watched', 'ratings', 'watchlist', 'collection', 'scrobble', 'history'] },
    { id: 'system', tabId: 'system', label: 'System', group: 'Automation', keywords: ['system', 'diagnostics', 'backup'] },
    { id: 'system/support-tickets', tabId: 'system', sectionId: 'support-tickets', label: 'Support tickets', labelKey: 'settings.search.entries.supportTickets', group: 'Automation', keywords: ['support', 'tickets', 'inbox', 'messaging', 'help', 'contact admin'] },
    { id: 'system/health', tabId: 'system', sectionId: 'health', label: 'Health Dashboard', labelKey: 'settings.search.entries.healthDashboard', group: 'Automation', keywords: ['health', 'score', 'alerts', 'integrations'] },
    { id: 'system/backup', tabId: 'system', sectionId: 'backup', label: 'Backup & Restore', labelKey: 'settings.search.entries.backupRestore', group: 'Automation', keywords: ['backup', 'restore', 'export', 'import'] },
    { id: 'system/memory', tabId: 'system', sectionId: 'memory', label: 'Memory', labelKey: 'settings.search.entries.memory', group: 'Automation', keywords: ['memory', 'ram', 'rss', 'heap', 'cache', 'leak', 'docker'] },
    { id: 'system/diagnostics', tabId: 'system', sectionId: 'diagnostics', label: 'Diagnostics', labelKey: 'settings.search.entries.diagnostics', group: 'Automation', keywords: ['diagnostics', 'version', 'node', 'debug'] },
    { id: 'logs', tabId: 'logs', label: 'Logs & Audit', group: 'Automation', keywords: ['audit', 'emails', 'deleted users', 'history', 'logs'] },
];

export const SETTINGS_TAB_GROUPS = [
    { title: 'Portal', tabs: SETTINGS_INDEX.filter((entry) => entry.group === 'Portal' && !entry.sectionId) },
    { title: 'Media Stack', tabs: SETTINGS_INDEX.filter((entry) => entry.group === 'Media Stack' && !entry.sectionId) },
    { title: 'Comms', tabs: SETTINGS_INDEX.filter((entry) => entry.group === 'Comms' && !entry.sectionId) },
    { title: 'Automation', tabs: SETTINGS_INDEX.filter((entry) => entry.group === 'Automation' && !entry.sectionId) },
].map((group) => ({
    title: group.title,
    tabs: group.tabs.map((entry) => ({
        id: entry.tabId,
        label: entry.label,
        keywords: entry.keywords,
    })),
}));

export type SettingsTabSection = {
    sectionId: string;
    label: string;
    translationKey: string;
};

export const SETTINGS_TAB_SECTIONS: Partial<Record<SettingsTabId, SettingsTabSection[]>> = {};

const RECENT_KEY = 'portal-settings-recent';
const RECENT_LIMIT = 6;

export const parseSettingsHash = (hash: string): { tabId: SettingsTabId | null; sectionId: string | null } => {
    const raw = hash.replace(/^#/, '').trim();
    if (!raw) return { tabId: null, sectionId: null };
    if (raw === 'system/upgrader') return { tabId: 'upgrader', sectionId: null };
    if (raw === 'system/maintenance') return { tabId: 'cleaner', sectionId: null };

    // Legacy tab hashes → merged Layout / Notifications sections.
    const legacyTabRedirects: Record<string, { tabId: SettingsTabId; sectionId: string | null }> = {
        navigation: { tabId: 'layout', sectionId: 'navigation' },
        'home-modules': { tabId: 'layout', sectionId: 'home-modules' },
        'home-layout': { tabId: 'layout', sectionId: 'home-layout' },
        'custom-nav-tabs': { tabId: 'applets', sectionId: null },
        smtp: { tabId: 'notifications', sectionId: 'smtp' },
        gotify: { tabId: 'notifications', sectionId: 'gotify' },
    };
    if (legacyTabRedirects[raw]) {
        return legacyTabRedirects[raw];
    }

    const [tabPart, ...sectionParts] = raw.split('/');
    const normalizedTabPart = tabPart === 'media-player' ? 'plex' : tabPart;
    if (!sectionParts.length && legacyTabRedirects[normalizedTabPart]) {
        return legacyTabRedirects[normalizedTabPart];
    }
    if (normalizedTabPart === 'plex' && sectionParts.join('/') === 'analytics-usernames') {
        return { tabId: 'analytics', sectionId: 'usernames' };
    }
    const tabId = SETTINGS_TABS.includes(normalizedTabPart as SettingsTabId) ? normalizedTabPart as SettingsTabId : null;
    const sectionId = sectionParts.length > 0 ? sectionParts.join('/') : null;
    if (tabId === 'layout' && (sectionId === 'custom-nav-tabs' || sectionId === 'applets')) {
        return { tabId: 'applets', sectionId: null };
    }
    return { tabId, sectionId };
};

export const buildSettingsHash = (tabId: SettingsTabId, sectionId?: string | null) => (
    sectionId ? `#${tabId === 'plex' ? 'media-player' : tabId}/${sectionId}` : `#${tabId === 'plex' ? 'media-player' : tabId}`
);

export const getSettingsSectionElementId = (sectionId: string) => `settings-section-${sectionId}`;

export const searchSettingsIndex = (term: string): SettingsIndexEntry[] => {
    const query = term.trim().toLowerCase();
    if (!query) return [];
    return SETTINGS_INDEX.filter((entry) => {
        const haystack = `${entry.group} ${entry.label} ${entry.keywords.join(' ')}`.toLowerCase();
        return haystack.includes(query);
    }).slice(0, 12);
};

export const getRecentSettingsIds = (): string[] => {
    if (typeof window === 'undefined') return [];
    try {
        const raw = localStorage.getItem(RECENT_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : [];
    } catch {
        return [];
    }
};

export const recordRecentSetting = (entryId: string) => {
    if (typeof window === 'undefined') return;
    const existing = getRecentSettingsIds().filter((id) => id !== entryId);
    const next = [entryId, ...existing].slice(0, RECENT_LIMIT);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
};

const SETTINGS_ENTRY_ALIASES: Record<string, string> = {
    'layout/applets': 'applets',
    'layout/custom-nav-tabs': 'applets',
    'system/maintenance': 'cleaner',
};

export const resolveSettingsEntry = (entryId: string): SettingsIndexEntry | undefined => {
    const resolvedId = SETTINGS_ENTRY_ALIASES[entryId] || entryId;
    return SETTINGS_INDEX.find((entry) => entry.id === resolvedId);
};

export const getRecentSettingsEntries = (): SettingsIndexEntry[] => (
    getRecentSettingsIds()
        .map((id) => resolveSettingsEntry(id))
        .filter((entry): entry is SettingsIndexEntry => !!entry)
);
