import type { ButtonHTMLAttributes, ReactNode } from 'react';

export interface User {
    id: string;
    username: string;
    email?: string;
    thumb?: string;
    /** Plex account id used by analytics/history APIs when present. */
    plexAccountId?: string | null;
    joiningDate: string;
    expiryDate: string | null;
    plexAccessStatus: 'active' | 'pending' | 'revoked' | 'unknown';
    exemptFromCleanup?: boolean;
    isTrial?: boolean;
    optOutNewsletter?: boolean;
    /** Show my name on dashboard / analytics / public profile when the admin allows names. */
    privacyShowName?: boolean;
    /** Show my player/device name on live streams when the admin allows names. */
    privacyShowPlayer?: boolean;
    /** Show me on the achievements leaderboard and peer trophy cases. */
    privacyShowAchievements?: boolean;
    /** Let other members open my public profile. Admins can still view it. */
    privacyShowProfile?: boolean;
    /** Let other members see the email on my public profile. Off by default. */
    privacyShowEmail?: boolean;
    /** Let other members see which libraries I can access. Off by default. */
    privacyShowLibraries?: boolean;
    /** Short public bio. Empty hides it. */
    profileBio?: string;
    /** False only for invite/referral users who still need the welcome wizard. */
    onboardingCompleted?: boolean;
    onboardingCompletedAt?: string | null;
    onboardingVersion?: number | null;
    onboardingAckedStepIds?: string[];
    /** Email when a portal request becomes available (default on). */
    notifyRequestAvailableEmail?: boolean;
    /** In-app bell when a portal request becomes available (default on). */
    notifyRequestAvailableInApp?: boolean;
    /** Browser push for request-available (default on). */
    notifyRequestAvailableWebPush?: boolean;
    /** Include this user's requests in Discord webhook posts (default on). */
    notifyRequestAvailableDiscord?: boolean;
    /** Request approved (email / in-app / push; default on). */
    notifyRequestApprovedEmail?: boolean;
    notifyRequestApprovedInApp?: boolean;
    notifyRequestApprovedWebPush?: boolean;
    /** Request declined (default on). */
    notifyRequestDeclinedEmail?: boolean;
    notifyRequestDeclinedInApp?: boolean;
    notifyRequestDeclinedWebPush?: boolean;
    /** Season available for TV requests (default on). */
    notifySeasonAvailableEmail?: boolean;
    notifySeasonAvailableInApp?: boolean;
    notifySeasonAvailableWebPush?: boolean;
    /** New episode for ongoing series (default off). */
    notifyNewEpisodeEmail?: boolean;
    notifyNewEpisodeInApp?: boolean;
    notifyNewEpisodeWebPush?: boolean;
    /** Master browser push preference for all in-app fan-out (default on). */
    notifyWebPush?: boolean;
    notifySummaryDigest?: boolean;
    lastLogin?: string;
    /** Plex library section ids shared with this user. Empty/absent = all libraries. */
    libraryIds?: string[] | null;
    requestOverrides?: {
        movieQuotaLimit?: number | null;
        movieQuotaDays?: number | null;
        tvQuotaLimit?: number | null;
        tvQuotaDays?: number | null;
        fourKQuotaLimit?: number | null;
        fourKQuotaDays?: number | null;
        allowRequestMovies?: boolean | null;
        allowRequestTv?: boolean | null;
        allowRequest4kMovies?: boolean | null;
        allowRequest4kTv?: boolean | null;
        allowAdvancedRequests?: boolean | null;
    };
}

export interface PlexConfig {
    token: string;
    mediaServerType?: 'plex' | 'jellyfin' | 'emby';
    serverIdentifier: string;
    jellyfinUrl?: string;
    jellyfinApiKey?: string;
    checkIntervalMinutes: number;
    smtpHost: string;
    smtpPort: number;
    smtpUser: string;
    smtpPass: string;
    smtpFrom: string;
    smtpSecure: boolean;
    emailDaysBefore: number;
    gotifyEnabled?: boolean;
    gotifyUrl?: string;
    gotifyToken?: string;
    gotifyPriority?: number;
    alertRules?: Record<string, boolean>;
    newsletterFrequency: string;
    newsletterDay: number;
    publicDomain: string;
    requestUrl?: string;
    contactUrl?: string;
}

export interface ArrInstance {
    id: string;
    type: 'sonarr' | 'radarr' | 'lidarr' | 'bazarr';
    name: string;
    url: string;
    externalUrl?: string;
    apiKey: string;
    enabled: boolean;
    isDefault: boolean;
    /** When true, Discover request modal routes UHD/4K requests to this instance. */
    is4k?: boolean;
    plexLibraryIds?: string[];
    /** Quality profile used when a request does not pick Advanced options. */
    defaultQualityProfileId?: number | null;
    /** Root folder used when a request does not pick Advanced options. */
    defaultRootFolder?: string;
}

export interface DownloadClientConfig {
    id: string;
    type: 'qbittorrent' | 'rdtclient' | 'transmission' | 'bittorrent' | 'deluge' | 'sabnzbd' | 'nzbget';
    name: string;
    url: string;
    username?: string;
    password?: string;
    enabled: boolean;
}

export interface AppSettings {
    token?: string;
    mediaServerType?: 'plex' | 'jellyfin' | 'emby';
    serverIdentifier?: string;
    jellyfinUrl?: string;
    jellyfinApiKey?: string;
    checkIntervalMinutes: number;
    smtpHost?: string;
    smtpPort?: number;
    smtpUser?: string;
    smtpPass?: string;
    smtpFrom?: string;
    smtpSecure?: boolean;
    emailDaysBefore?: number;
    gotifyEnabled?: boolean;
    gotifyUrl?: string;
    gotifyToken?: string;
    gotifyPriority?: number;
    alertRules?: Record<string, boolean>;
    newsletterFrequency?: string;
    newsletterDay?: number;
    publicDomain?: string;
    requestUrl?: string;
    contactUrl?: string;
    inactiveCleanupEnabled?: boolean;
    inactiveCleanupDays?: number;
    sonarrUrl?: string;
    sonarrApiKey?: string;
    radarrUrl?: string;
    radarrApiKey?: string;
    arrInstances?: ArrInstance[];
    downloadClients?: DownloadClientConfig[];
    tautulliUrl?: string;
    tautulliApiKey?: string;
    /** Alert admins when Tautulli API calls fail (site kill-switch). Default on. */
    notifyTautulliApiFailed?: boolean;
    jellyfinAnalyticsProvider?: 'jellystat' | 'jellyglance';
    jellystatUrl?: string;
    jellystatApiKey?: string;
    jellyglanceUrl?: string;
    jellyglanceApiKey?: string;
    primaryColor?: string;
    customFaviconUrl?: string;
    /** Uploaded monochrome Android status-bar badge (`/static/badge.*?v=ts`); empty = auto-generate from logo. */
    customBadgeUrl?: string;
    sidebarIdentityPosition?: 'top' | 'bottom';
    backgroundImageUrl?: string;
    navOrder?: string[];
    /** Server-wide nav keys hidden from the sidebar/mobile bar (Settings → Layout → Navigation). */
    navHiddenKeys?: string[];
    /** Members / non-admin nav order (Settings → Layout → Navigation → Users). */
    memberNavOrder?: string[];
    /** Members / non-admin hidden nav keys. */
    memberNavHiddenKeys?: string[];
    /** Optional Lucide / image overrides for native sidebar items. */
    navItemIcons?: Record<string, { icon?: string; logoUrl?: string }>;
    /** Admin-defined external service tabs shown in the sidebar. */
    customNavTabs?: CustomNavTab[];
    /** Desktop launcher vs individual custom-tab links. */
    customNavDisplay?: CustomNavDisplay;
    /** Open Radarr/Sonarr/Lidarr deep links in the Applets iframe. */
    arrOpenInPortalEmbed?: boolean;
    /** Admin-defined custom HTML / iframe modules for the home dashboard. */
    homeCustomModules?: HomeCustomModule[];
}

export type HomeCustomModuleMode = 'html' | 'iframe';

export interface HomeCustomModule {
    id: string;
    title: string;
    description?: string;
    enabled: boolean;
    adminOnly?: boolean;
    mode: HomeCustomModuleMode;
    html?: string;
    css?: string;
    url?: string;
}

export type CustomNavTabOpenMode = 'embed' | 'sameTab' | 'newTab';
export type CustomNavDisplay = 'links' | 'applets';

export interface CustomNavTab {
    id: string;
    name: string;
    description?: string;
    url: string;
    icon: string;
    openMode: CustomNavTabOpenMode;
    adminOnly?: boolean;
    enabled: boolean;
    /** Optional image URL or uploaded `/api/branding/custom-tab/:id` path. */
    logoUrl?: string;
    /** Show the tab name under the Applets palette icon. Default true. */
    showPaletteLabel?: boolean;
}

export interface PlexServer {
    name: string;
    identifier: string;
}

export interface ToastMessage {
    id: number;
    message: string;
    type: 'success' | 'error';
}

export interface DeletedUser {
    blockId: string;
    id?: string;
    plexId?: string;
    username?: string;
    email?: string;
    deletedAt?: string;
    deletedBy?: string;
}

export interface AuditEntry {
    id: string;
    timestamp: string;
    event: string;
    actor?: { username?: string; email?: string; isAdmin?: boolean } | null;
    target?: { username?: string; email?: string } | null;
    details?: Record<string, any>;
}

export type UserStatus = 'active' | 'expiring' | 'expired';

export interface CustomSelectProps {
    id?: string;
    value: string | number;
    onChange: (value: string) => void;
    options: { label: string; value: string | number; icon?: ReactNode; isGroup?: boolean }[];
    className?: string;
    compact?: boolean;
    dropdownClassName?: string;
    /** Extra attrs on the trigger (e.g. data-tv-item for leanback focus). */
    triggerProps?: ButtonHTMLAttributes<HTMLButtonElement> & Record<`data-${string}`, string | undefined>;
}
