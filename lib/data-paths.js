import path from 'path';
import fs from 'fs/promises';

/** Root directory for all runtime JSON data files. Override with CONFIG_DIR env var. */
export const CONFIG_DIR = process.env.CONFIG_DIR
    ? path.resolve(process.env.CONFIG_DIR)
    : path.join(process.cwd(), 'config');

const dataPath = (filename) => path.join(CONFIG_DIR, filename);

/** Primary application settings (Plex, SMTP, feature flags). */
export const CONFIG_PATH = dataPath('config.json');
export const INVITES_PATH = dataPath('invites.json');
export const INVITE_PROFILES_PATH = dataPath('invite-profiles.json');
export const REFERRAL_REWARDS_PATH = dataPath('referral-rewards.json');
export const ONBOARDING_PATH = dataPath('onboarding.json');
export const USERS_PATH = dataPath('users.json');
export const DELETED_USERS_PATH = dataPath('deleted-users.json');
export const AUDIT_LOG_PATH = dataPath('audit-log.json');
export const EMAIL_LOG_PATH = dataPath('email_log.json');
export const STATUS_CONFIG_PATH = dataPath('status.json');
export const HEALTH_PATH = dataPath('subzero-health.json');
export const TRENDING_CACHE_PATH = dataPath('trending-cache.json');
export const ANALYTICS_CACHE_PATH = dataPath('analytics-cache.json');
export const ANALYTICS_HISTORY_CACHE_PATH = dataPath('analytics-history-cache.json');
export const ACHIEVEMENTS_STATE_PATH = dataPath('achievements-state.json');
export const ACHIEVEMENTS_GENRE_CACHE_PATH = dataPath('achievements-genre-cache.json');
export const NOTIFICATIONS_PATH = dataPath('notifications.json');
export const REQUEST_WATCHERS_PATH = dataPath('request-watchers.json');
export const SEERR_AVAILABLE_NOTIFY_PATH = dataPath('seerr-available-notify.json');
export const SEERR_PENDING_NOTIFY_PATH = dataPath('seerr-pending-notify.json');
export const WEB_PUSH_VAPID_PATH = dataPath('web-push-vapid.json');
export const WEB_PUSH_SUBSCRIPTIONS_PATH = dataPath('web-push-subscriptions.json');
export const SUMMARY_DIGEST_HISTORY_PATH = dataPath('summary-digest-history.json');
export const KILL_RULES_PATH = dataPath('kill-rules.json');
export const MAINTENANCE_RULES_PATH = dataPath('maintenance-rules.json');
export const MAINTENANCE_MEDIA_INDEX_PATH = dataPath('maintenance-media-index.json');
export const MAINTENANCE_RUNS_PATH = dataPath('maintenance-runs.json');
export const MAINTENANCE_REQUEST_INDEX_PATH = dataPath('maintenance-request-index.json');
export const MAINTENANCE_PREFS_PATH = dataPath('maintenance-prefs.json');
export const MAINTENANCE_PENDING_PATH = dataPath('maintenance-pending.json');
export const UPGRADER_AUDIT_PATH = dataPath('upgrader-audit.json');
export const UPGRADER_PREFS_PATH = dataPath('upgrader-prefs.json');
export const UPGRADER_INDEX_PATH = dataPath('upgrader-index.json');
export const PLEX_STATS_CACHE_PATH = dataPath('plex-stats.json');
export const DISCOVERY_AVAILABILITY_CACHE_PATH = dataPath('discovery-availability-cache.json');
/** Last-run / in-progress ledger so restarts skip-if-fresh and resume interrupted jobs. */
export const BOOT_SCHEDULE_PATH = dataPath('boot-schedule.json');

/** Portal-native request JSON store directory (Phase 5+). */
export const REQUESTS_DIR = path.join(CONFIG_DIR, 'requests');

/** Portal-native issue JSON store directory (Phase 8). */
export const ISSUES_DIR = path.join(CONFIG_DIR, 'issues');

/** Built-in support tickets / user-admin messaging. */
export const SUPPORT_TICKETS_DIR = path.join(CONFIG_DIR, 'support-tickets');

/** Community live chat rooms + messages. */
export const CHAT_DIR = path.join(CONFIG_DIR, 'chat');

/** Portal-native blocklist JSON store directory (Phase 9). */
export const BLOCKLIST_DIR = path.join(CONFIG_DIR, 'blocklist');

/** Portal-native watchlist JSON cache directory (Phase 9). */
export const WATCHLIST_DIR = path.join(CONFIG_DIR, 'watchlist');

/** Durable Media Automation state, job records, logs, and work metadata. */
export const MEDIA_AUTOMATION_DIR = process.env.MEDIA_AUTOMATION_CONFIG_DIR
    ? path.resolve(process.env.MEDIA_AUTOMATION_CONFIG_DIR)
    : path.join(CONFIG_DIR, 'media-automation');
export const MEDIA_AUTOMATION_WORK_DIR = process.env.MEDIA_AUTOMATION_WORK_DIR
    ? path.resolve(process.env.MEDIA_AUTOMATION_WORK_DIR)
    : path.join(MEDIA_AUTOMATION_DIR, 'work');
export const MEDIA_AUTOMATION_QUEUE_PATH = path.join(MEDIA_AUTOMATION_DIR, 'queue.json');
export const MEDIA_AUTOMATION_LIBRARIES_PATH = path.join(MEDIA_AUTOMATION_DIR, 'libraries.json');
export const MEDIA_AUTOMATION_PIPELINES_PATH = path.join(MEDIA_AUTOMATION_DIR, 'pipelines.json');
export const MEDIA_AUTOMATION_ACTIVITY_PATH = path.join(MEDIA_AUTOMATION_DIR, 'activity.json');

/** Disk cache for proxied Plex/Jellyfin dashboard (and other) covers. */
export const MEDIA_IMAGE_CACHE_DIR = path.join(CONFIG_DIR, 'media-image-cache');

/** Poster Sets dedicated config (MediUX / ThePosterDB helper). */
export const POSTER_SETS_DIR = process.env.POSTER_SETS_CONFIG_DIR
    ? path.resolve(process.env.POSTER_SETS_CONFIG_DIR)
    : path.join(CONFIG_DIR, 'poster-sets');
export const POSTER_SETS_CONFIG_PATH = path.join(POSTER_SETS_DIR, 'config.json');

/** Overlays (New Season / future Kometa-style banners). */
export const OVERLAYS_DIR = process.env.OVERLAYS_CONFIG_DIR
    ? path.resolve(process.env.OVERLAYS_CONFIG_DIR)
    : path.join(CONFIG_DIR, 'overlays');
export const OVERLAYS_CONFIG_PATH = path.join(OVERLAYS_DIR, 'config.json');

/** Canonical filenames stored under CONFIG_DIR. */
export const DATA_FILES = [
    'config.json',
    'invites.json',
    'invite-profiles.json',
    'referral-rewards.json',
    'onboarding.json',
    'users.json',
    'deleted-users.json',
    'audit-log.json',
    'email_log.json',
    'status.json',
    'subzero-health.json',
    'trending-cache.json',
    'analytics-cache.json',
    'achievements-state.json',
    'notifications.json',
    'seerr-available-notify.json',
    'seerr-pending-notify.json',
    'web-push-vapid.json',
    'web-push-subscriptions.json',
    'kill-rules.json',
    'maintenance-rules.json',
    'maintenance-media-index.json',
    'maintenance-runs.json',
    'maintenance-request-index.json',
    'maintenance-prefs.json',
    'upgrader-audit.json',
    'upgrader-prefs.json',
    'upgrader-index.json',
    'plex-stats.json',
    'discovery-availability-cache.json',
    'boot-schedule.json',
];

/** Older installs may have used alternate root-level filenames. */
export const LEGACY_ALIASES = [
    { legacy: 'deleted_users.json', target: 'deleted-users.json' },
    { legacy: 'status-config.json', target: 'status.json' },
    { legacy: 'subzero-status-config.json', target: 'status.json' },
];

const fileExists = async (filePath) => {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
};

/**
 * On first run after upgrade, move JSON data files from the project root into CONFIG_DIR.
 * Skips files that already exist in CONFIG_DIR. Safe to call on every startup.
 */
export const migrateConfigFiles = async (log = () => {}) => {
    await fs.mkdir(CONFIG_DIR, { recursive: true });

    let migrated = 0;

    const tryMigrate = async (fromPath, toPath, label) => {
        const [destExists, sourceExists] = await Promise.all([
            fileExists(toPath),
            fileExists(fromPath),
        ]);
        if (destExists || !sourceExists) return false;
        await fs.rename(fromPath, toPath);
        log(`Migrated ${label} -> ${path.relative(process.cwd(), toPath)}`);
        return true;
    };

    for (const filename of DATA_FILES) {
        const legacyPath = path.join(process.cwd(), filename);
        const newPath = dataPath(filename);
        if (await tryMigrate(legacyPath, newPath, filename)) migrated++;
    }

    for (const { legacy, target } of LEGACY_ALIASES) {
        const legacyPath = path.join(process.cwd(), legacy);
        const newPath = dataPath(target);
        if (await tryMigrate(legacyPath, newPath, legacy)) migrated++;
    }

    if (migrated > 0) {
        log(`Config migration complete: ${migrated} file(s) now in ${path.relative(process.cwd(), CONFIG_DIR) || 'config'}/`);
    }

    return migrated;
};
