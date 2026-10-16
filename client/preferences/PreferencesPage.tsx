import React, { useEffect, useState } from 'react';
import { MonitorSmartphone, SlidersHorizontal } from 'lucide-react';
import { apiFetch } from '../shared/api';
import { portalUrl } from '../shared/basePath';
import { DashboardHero, DashboardPageShell, DashboardPanel } from '../shared/dashboard/DashboardChrome';
import { pushToast, ToastContainer, type ToastMessage } from '../shared/toast';
import { subscribeWebPush, unsubscribeWebPush, webPushSupported, getIosWebPushBlockReason, isAndroidDevice, isStandalonePwa, syncExistingWebPushSubscription } from '../shared/webPushSubscribe';
import { useDiscoverI18n } from '../discovery/i18n';
import { DiscoverLocaleSelect } from '../discovery/i18n/DiscoverLocaleSelect';
import { StickySaveBar } from '../shared/StickySaveBar';

type Props = {
    sessionInfo: any;
    refreshSession: () => void;
    publicConfig?: any;
};

const PrefToggle: React.FC<{
    title: string;
    hint: string;
    on: boolean;
    onToggle: () => void;
    ariaLabel: string;
    disabled?: boolean;
}> = ({ title, hint, on, onToggle, ariaLabel, disabled }) => (
    <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
            <p className="text-text font-bold text-sm">{title}</p>
            <p className="text-muted text-xs mt-1 leading-relaxed">{hint}</p>
        </div>
        <button
            type="button"
            onClick={onToggle}
            disabled={disabled}
            aria-label={ariaLabel}
            className={`relative inline-flex items-center w-14 h-7 rounded-full transition-all flex-shrink-0 border-2 disabled:opacity-50 ${
                on ? 'bg-plex border-plex' : 'bg-background border-border'
            }`}
        >
            <span className={`inline-block w-5 h-5 bg-white rounded-full shadow-sm transition-transform duration-300 ${on ? 'translate-x-8' : 'translate-x-1'}`} />
        </button>
    </div>
);

export const PreferencesPage: React.FC<Props> = ({ sessionInfo, refreshSession, publicConfig }) => {
    const { t } = useDiscoverI18n();
    const user = sessionInfo?.account;
    const isAdmin = !!sessionInfo?.session?.isAdmin;
    const [toasts, setToasts] = useState<ToastMessage[]>([]);
    const [busy, setBusy] = useState(false);
    const [dirty, setDirty] = useState(false);
    const [isInstalledApp, setIsInstalledApp] = useState(() => (
        typeof window !== 'undefined'
        && (window.matchMedia?.('(display-mode: standalone)').matches
            || window.matchMedia?.('(display-mode: fullscreen)').matches
            || (navigator as any).standalone === true)
    ));

    const [optOutNewsletter, setOptOutNewsletter] = useState(user?.optOutNewsletter || false);
    const [privacyShowName, setPrivacyShowName] = useState(user?.privacyShowName !== false);
    const [privacyShowPlayer, setPrivacyShowPlayer] = useState(user?.privacyShowPlayer !== false);
    const [privacyShowAchievements, setPrivacyShowAchievements] = useState(user?.privacyShowAchievements !== false);
    const [privacyShowProfile, setPrivacyShowProfile] = useState(user?.privacyShowProfile !== false);
    const [privacyShowEmail, setPrivacyShowEmail] = useState(user?.privacyShowEmail === true);
    const [privacyShowLibraries, setPrivacyShowLibraries] = useState(user?.privacyShowLibraries === true);
    const [profileBio, setProfileBio] = useState(String(user?.profileBio || ''));
    const [notifyRequestAvailableEmail, setNotifyRequestAvailableEmail] = useState(user?.notifyRequestAvailableEmail !== false);
    const [notifyRequestAvailableInApp, setNotifyRequestAvailableInApp] = useState(user?.notifyRequestAvailableInApp !== false);
    const [notifyRequestAvailableWebPush, setNotifyRequestAvailableWebPush] = useState(user?.notifyRequestAvailableWebPush !== false);
    const [notifyRequestAvailableDiscord, setNotifyRequestAvailableDiscord] = useState(user?.notifyRequestAvailableDiscord !== false);
    const [notifyRequestApproved, setNotifyRequestApproved] = useState(
        user?.notifyRequestApprovedEmail !== false
        && user?.notifyRequestApprovedInApp !== false
        && user?.notifyRequestApprovedWebPush !== false,
    );
    const [notifyRequestDeclined, setNotifyRequestDeclined] = useState(
        user?.notifyRequestDeclinedEmail !== false
        && user?.notifyRequestDeclinedInApp !== false
        && user?.notifyRequestDeclinedWebPush !== false,
    );
    const [notifySeasonAvailable, setNotifySeasonAvailable] = useState(
        user?.notifySeasonAvailableEmail !== false
        && user?.notifySeasonAvailableInApp !== false
        && user?.notifySeasonAvailableWebPush !== false,
    );
    const [notifyNewEpisode, setNotifyNewEpisode] = useState(
        user?.notifyNewEpisodeEmail === true
        || user?.notifyNewEpisodeInApp === true
        || user?.notifyNewEpisodeWebPush === true,
    );
    const [notifyCollexionsFailed, setNotifyCollexionsFailed] = useState(user?.notifyCollexionsFailed !== false);
    const [notifyScannerFailed, setNotifyScannerFailed] = useState(user?.notifyScannerFailed !== false);
    const [notifyScannerDeleted, setNotifyScannerDeleted] = useState(user?.notifyScannerDeleted !== false);
    const [notifyScannerUpgrade, setNotifyScannerUpgrade] = useState(user?.notifyScannerUpgrade !== false);
    const [notifyScannerImport, setNotifyScannerImport] = useState(user?.notifyScannerImport !== false);
    const [notifyScannerGrab, setNotifyScannerGrab] = useState(user?.notifyScannerGrab !== false);
    const [notifyScannerUpdate, setNotifyScannerUpdate] = useState(user?.notifyScannerUpdate !== false);
    const [notifyScannerInteraction, setNotifyScannerInteraction] = useState(user?.notifyScannerInteraction !== false);
    const [notifyStatusDown, setNotifyStatusDown] = useState(user?.notifyStatusDown !== false);
    const [notifyStatusUp, setNotifyStatusUp] = useState(user?.notifyStatusUp !== false);
    const [notifyMediaJobFailed, setNotifyMediaJobFailed] = useState(user?.notifyMediaJobFailed !== false);
    const [notifyMediaJobCompleted, setNotifyMediaJobCompleted] = useState(user?.notifyMediaJobCompleted === true);
    const [notifyTautulliApiFailed, setNotifyTautulliApiFailed] = useState(user?.notifyTautulliApiFailed !== false);
    const [notifySupportTicket, setNotifySupportTicket] = useState(user?.notifySupportTicket !== false);
    const [notifySupportReply, setNotifySupportReply] = useState(user?.notifySupportReply !== false);
    const [notifySupportMediaIssue, setNotifySupportMediaIssue] = useState(user?.notifySupportMediaIssue !== false);
    const [notifyChatMentionInApp, setNotifyChatMentionInApp] = useState(user?.notifyChatMentionInApp !== false);
    const [notifyWebPush, setNotifyWebPush] = useState(user?.notifyWebPush !== false);
    const [notifySummaryDigest, setNotifySummaryDigest] = useState(user?.notifySummaryDigest !== false);
    const [showDiscoverNowPlaying, setShowDiscoverNowPlaying] = useState(user?.showDiscoverNowPlaying !== false);
    const [showHomeBecauseYouWatched, setShowHomeBecauseYouWatched] = useState(user?.showHomeBecauseYouWatched !== false);
    const [browserPushReady, setBrowserPushReady] = useState(false);
    const browserPushSupportedFlag = webPushSupported();
    const iosPushBlock = typeof window !== 'undefined' ? getIosWebPushBlockReason() : null;
    const androidPushInstallHint = typeof window !== 'undefined'
        && isAndroidDevice()
        && !isStandalonePwa();

    useEffect(() => {
        if (dirty) return;
        setNotifyRequestAvailableEmail(user?.notifyRequestAvailableEmail !== false);
        setNotifyRequestAvailableInApp(user?.notifyRequestAvailableInApp !== false);
        setNotifyRequestAvailableWebPush(user?.notifyRequestAvailableWebPush !== false);
        setNotifyRequestAvailableDiscord(user?.notifyRequestAvailableDiscord !== false);
        setNotifyRequestApproved(
            user?.notifyRequestApprovedEmail !== false
            && user?.notifyRequestApprovedInApp !== false
            && user?.notifyRequestApprovedWebPush !== false,
        );
        setNotifyRequestDeclined(
            user?.notifyRequestDeclinedEmail !== false
            && user?.notifyRequestDeclinedInApp !== false
            && user?.notifyRequestDeclinedWebPush !== false,
        );
        setNotifySeasonAvailable(
            user?.notifySeasonAvailableEmail !== false
            && user?.notifySeasonAvailableInApp !== false
            && user?.notifySeasonAvailableWebPush !== false,
        );
        setNotifyNewEpisode(
            user?.notifyNewEpisodeEmail === true
            || user?.notifyNewEpisodeInApp === true
            || user?.notifyNewEpisodeWebPush === true,
        );
        setNotifyCollexionsFailed(user?.notifyCollexionsFailed !== false);
        setNotifyScannerFailed(user?.notifyScannerFailed !== false);
        setNotifyScannerDeleted(user?.notifyScannerDeleted !== false);
        setNotifyScannerUpgrade(user?.notifyScannerUpgrade !== false);
        setNotifyScannerImport(user?.notifyScannerImport !== false);
        setNotifyScannerGrab(user?.notifyScannerGrab !== false);
        setNotifyScannerUpdate(user?.notifyScannerUpdate !== false);
        setNotifyScannerInteraction(user?.notifyScannerInteraction !== false);
        setNotifyStatusDown(user?.notifyStatusDown !== false);
        setNotifyStatusUp(user?.notifyStatusUp !== false);
        setNotifyMediaJobFailed(user?.notifyMediaJobFailed !== false);
        setNotifyMediaJobCompleted(user?.notifyMediaJobCompleted === true);
        setNotifyTautulliApiFailed(user?.notifyTautulliApiFailed !== false);
        setNotifySupportTicket(user?.notifySupportTicket !== false);
        setNotifySupportReply(user?.notifySupportReply !== false);
        setNotifySupportMediaIssue(user?.notifySupportMediaIssue !== false);
        setNotifyChatMentionInApp(user?.notifyChatMentionInApp !== false);
        setNotifyWebPush(user?.notifyWebPush !== false);
        setNotifySummaryDigest(user?.notifySummaryDigest !== false);
        setShowDiscoverNowPlaying(user?.showDiscoverNowPlaying !== false);
        setShowHomeBecauseYouWatched(user?.showHomeBecauseYouWatched !== false);
        setOptOutNewsletter(!!user?.optOutNewsletter);
        setPrivacyShowName(user?.privacyShowName !== false);
        setPrivacyShowPlayer(user?.privacyShowPlayer !== false);
        setPrivacyShowAchievements(user?.privacyShowAchievements !== false);
        setPrivacyShowProfile(user?.privacyShowProfile !== false);
        setPrivacyShowEmail(user?.privacyShowEmail === true);
        setPrivacyShowLibraries(user?.privacyShowLibraries === true);
        setProfileBio(String(user?.profileBio || ''));
    }, [
        user?.notifyRequestAvailableEmail,
        user?.notifyRequestAvailableInApp,
        user?.notifyRequestAvailableWebPush,
        user?.notifyRequestAvailableDiscord,
        user?.notifyRequestApprovedEmail,
        user?.notifyRequestApprovedInApp,
        user?.notifyRequestApprovedWebPush,
        user?.notifyRequestDeclinedEmail,
        user?.notifyRequestDeclinedInApp,
        user?.notifyRequestDeclinedWebPush,
        user?.notifySeasonAvailableEmail,
        user?.notifySeasonAvailableInApp,
        user?.notifySeasonAvailableWebPush,
        user?.notifyNewEpisodeEmail,
        user?.notifyNewEpisodeInApp,
        user?.notifyNewEpisodeWebPush,
        user?.notifyCollexionsFailed,
        user?.notifyScannerFailed,
        user?.notifyScannerDeleted,
        user?.notifyScannerUpgrade,
        user?.notifyScannerImport,
        user?.notifyScannerGrab,
        user?.notifyScannerUpdate,
        user?.notifyScannerInteraction,
        user?.notifyStatusDown,
        user?.notifyStatusUp,
        user?.notifyMediaJobFailed,
        user?.notifyMediaJobCompleted,
        user?.notifyTautulliApiFailed,
        user?.notifySupportTicket,
        user?.notifySupportReply,
        user?.notifySupportMediaIssue,
        user?.notifyChatMentionInApp,
        user?.notifyWebPush,
        user?.notifySummaryDigest,
        user?.showDiscoverNowPlaying,
        user?.showHomeBecauseYouWatched,
        user?.optOutNewsletter,
        user?.privacyShowName,
        user?.privacyShowPlayer,
        user?.privacyShowAchievements,
        user?.privacyShowProfile,
        user?.privacyShowEmail,
        user?.privacyShowLibraries,
        user?.profileBio,
        dirty,
    ]);

    useEffect(() => {
        const syncInstalledState = () => {
            const installed = window.matchMedia?.('(display-mode: standalone)').matches
                || window.matchMedia?.('(display-mode: fullscreen)').matches
                || (navigator as any).standalone === true;
            setIsInstalledApp(!!installed);
        };
        syncInstalledState();
        window.addEventListener('appinstalled', syncInstalledState);
        const standaloneMq = window.matchMedia?.('(display-mode: standalone)');
        standaloneMq?.addEventListener?.('change', syncInstalledState);
        return () => {
            window.removeEventListener('appinstalled', syncInstalledState);
            standaloneMq?.removeEventListener?.('change', syncInstalledState);
        };
    }, []);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            if (!browserPushSupportedFlag) return;
            try {
                const synced = await syncExistingWebPushSubscription();
                if (cancelled) return;
                if (synced) {
                    setBrowserPushReady(true);
                    return;
                }
                const reg = await navigator.serviceWorker.getRegistration(portalUrl('/'))
                    || (await navigator.serviceWorker.getRegistrations())[0];
                const sub = await reg?.pushManager.getSubscription();
                if (!cancelled) setBrowserPushReady(!!sub);
            } catch {
                if (!cancelled) setBrowserPushReady(false);
            }
        })();
        return () => { cancelled = true; };
    }, [browserPushSupportedFlag]);

    const adminAllowsNames = String(publicConfig?.hideStreamUsers || 'false') === 'false';
    const achievementsEnabled = !!(sessionInfo?.navFeatures?.achievements || publicConfig?.achievementsEnabled);
    const chatEnabled = !!(sessionInfo?.navFeatures?.chat || publicConfig?.chatEnabled);

    const flip = (setter: React.Dispatch<React.SetStateAction<boolean>>) => () => {
        setter((value) => !value);
        setDirty(true);
    };

    const saveAll = async () => {
        if (busy) return;
        setBusy(true);
        try {
            await apiFetch('/api/users/preferences', {
                method: 'POST',
                body: JSON.stringify({
                    optOutNewsletter,
                    privacyShowName,
                    privacyShowPlayer,
                    privacyShowAchievements,
                    privacyShowProfile,
                    privacyShowEmail,
                    privacyShowLibraries,
                    profileBio,
                    notifyRequestAvailableEmail,
                    notifyRequestAvailableInApp,
                    notifyRequestAvailableWebPush,
                    notifyRequestAvailableDiscord,
                    notifyRequestApprovedEmail: notifyRequestApproved,
                    notifyRequestApprovedInApp: notifyRequestApproved,
                    notifyRequestApprovedWebPush: notifyRequestApproved,
                    notifyRequestDeclinedEmail: notifyRequestDeclined,
                    notifyRequestDeclinedInApp: notifyRequestDeclined,
                    notifyRequestDeclinedWebPush: notifyRequestDeclined,
                    notifySeasonAvailableEmail: notifySeasonAvailable,
                    notifySeasonAvailableInApp: notifySeasonAvailable,
                    notifySeasonAvailableWebPush: notifySeasonAvailable,
                    notifyNewEpisodeEmail: notifyNewEpisode,
                    notifyNewEpisodeInApp: notifyNewEpisode,
                    notifyNewEpisodeWebPush: notifyNewEpisode,
                    notifyCollexionsFailed,
                    notifyScannerFailed,
                    notifyScannerDeleted,
                    notifyScannerUpgrade,
                    notifyScannerImport,
                    notifyScannerGrab,
                    notifyScannerUpdate,
                    notifyScannerInteraction,
                    notifyStatusDown,
                    notifyStatusUp,
                    notifyMediaJobFailed,
                    notifyMediaJobCompleted,
                    notifyTautulliApiFailed,
                    notifySupportTicket,
                    notifySupportReply,
                    notifySupportMediaIssue,
                    notifyChatMentionInApp,
                    notifyWebPush,
                    notifySummaryDigest,
                    showDiscoverNowPlaying,
                    showHomeBecauseYouWatched,
                }),
            });
            await Promise.resolve(refreshSession());
            setDirty(false);
            setToasts((prev) => pushToast(prev, t('preferencesPage.saved'), 'success'));
        } catch (e: any) {
            setToasts((prev) => pushToast(prev, e.message || t('preferencesPage.saveFailed'), 'error'));
        } finally {
            setBusy(false);
        }
    };

    const renderSaveButton = () => (
        <button
            type="button"
            disabled={busy}
            onClick={() => { void saveAll(); }}
            className="inline-flex items-center justify-center rounded-xl bg-plex px-4 py-2.5 text-sm font-bold text-background hover:bg-plex-hover disabled:opacity-50"
        >
            {busy ? t('preferencesPage.saving') : t('preferencesPage.save')}
        </button>
    );

    return (
        <DashboardPageShell>
            <ToastContainer toasts={toasts} setToasts={setToasts} />
            <DashboardHero
                accent="plex"
                eyebrow={t('preferencesPage.eyebrow')}
                title={t('preferencesPage.title')}
                description={t('preferencesPage.subtitle')}
                icon={<SlidersHorizontal className="h-3.5 w-3.5" />}
                actions={renderSaveButton()}
            />

            {!user && !sessionInfo?.session?.isAdmin ? (
                <DashboardPanel title={t('preferencesPage.unavailableTitle')} subtitle={t('preferencesPage.unavailableHint')} />
            ) : (
                <div className="space-y-4">
                    <DashboardPanel title={t('common.language')}>
                        <DiscoverLocaleSelect />
                    </DashboardPanel>
                    <DashboardPanel title={t('preferencesPage.homeTitle')} subtitle={t('preferencesPage.homeSubtitle')}>
                        <div className="flex flex-col gap-5">
                            <PrefToggle
                                title={t('preferencesPage.showNowPlaying')}
                                hint={t('preferencesPage.showNowPlayingHint')}
                                on={showDiscoverNowPlaying}
                                onToggle={flip(setShowDiscoverNowPlaying)}
                                ariaLabel={t('preferencesPage.showNowPlaying')}
                                disabled={busy}
                            />
                            <PrefToggle
                                title={t('preferencesPage.showHomeBecauseYouWatched')}
                                hint={t('preferencesPage.showHomeBecauseYouWatchedHint')}
                                on={showHomeBecauseYouWatched}
                                onToggle={flip(setShowHomeBecauseYouWatched)}
                                ariaLabel={t('preferencesPage.showHomeBecauseYouWatched')}
                                disabled={busy}
                            />
                        </div>
                    </DashboardPanel>
                    <DashboardPanel title={t('preferencesPage.installTitle')} subtitle={t('preferencesPage.installSubtitle')}>
                        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                            <div className="flex items-center gap-3 min-w-0 flex-1">
                                <div className="w-10 h-10 rounded-xl bg-plex/15 border border-plex/30 flex items-center justify-center text-plex shrink-0">
                                    <MonitorSmartphone className="w-5 h-5" />
                                </div>
                                <p className="text-sm text-muted leading-relaxed">
                                    {isInstalledApp
                                        ? t('preferencesPage.installInstalled')
                                        : t('preferencesPage.installSubtitle')}
                                </p>
                            </div>
                            {!isInstalledApp && (
                                <button
                                    type="button"
                                    onClick={() => window.dispatchEvent(new CustomEvent('portal-open-install'))}
                                    className="shrink-0 inline-flex items-center justify-center gap-2 rounded-xl bg-plex px-4 py-2.5 text-sm font-bold text-background hover:bg-plex-hover"
                                >
                                    <MonitorSmartphone className="w-4 h-4" />
                                    {t('preferencesPage.installButton')}
                                </button>
                            )}
                        </div>
                    </DashboardPanel>
                    <DashboardPanel title={t('preferencesPage.newsletterTitle')} subtitle={t('preferencesPage.newsletterSubtitle')}>
                        <PrefToggle
                            title={t('homeDashboard.weeklyNewsletter')}
                            hint={t('homeDashboard.weeklyNewsletterHint')}
                            on={!optOutNewsletter}
                            onToggle={flip(setOptOutNewsletter)}
                            ariaLabel={t('homeDashboard.toggleNewsletterAria')}
                            disabled={busy}
                        />
                    </DashboardPanel>

                    <DashboardPanel title={t('preferencesPage.privacyTitle')} subtitle={t('preferencesPage.privacySubtitle')}>
                        <div className="flex flex-col gap-5">
                            {!adminAllowsNames ? (
                                <p className="text-amber-200/90 text-xs leading-relaxed">
                                    {t('preferencesPage.privacyAdminHidden')}
                                </p>
                            ) : null}
                            <PrefToggle
                                title={t('preferencesPage.privacyShowName')}
                                hint={t('preferencesPage.privacyShowNameHint')}
                                on={privacyShowName}
                                onToggle={flip(setPrivacyShowName)}
                                ariaLabel={t('preferencesPage.privacyShowName')}
                                disabled={busy || !adminAllowsNames}
                            />
                            <PrefToggle
                                title={t('preferencesPage.privacyShowPlayer')}
                                hint={t('preferencesPage.privacyShowPlayerHint')}
                                on={privacyShowPlayer}
                                onToggle={flip(setPrivacyShowPlayer)}
                                ariaLabel={t('preferencesPage.privacyShowPlayer')}
                                disabled={busy || !adminAllowsNames}
                            />
                            {achievementsEnabled ? (
                                <PrefToggle
                                    title={t('preferencesPage.privacyShowAchievements')}
                                    hint={t('preferencesPage.privacyShowAchievementsHint')}
                                    on={privacyShowAchievements}
                                    onToggle={flip(setPrivacyShowAchievements)}
                                    ariaLabel={t('preferencesPage.privacyShowAchievements')}
                                    disabled={busy}
                                />
                            ) : null}
                            <PrefToggle
                                title={t('preferencesPage.privacyShowProfile')}
                                hint={t('preferencesPage.privacyShowProfileHint')}
                                on={privacyShowProfile}
                                onToggle={flip(setPrivacyShowProfile)}
                                ariaLabel={t('preferencesPage.privacyShowProfile')}
                                disabled={busy}
                            />
                            <PrefToggle
                                title={t('preferencesPage.privacyShowEmail')}
                                hint={t('preferencesPage.privacyShowEmailHint')}
                                on={privacyShowEmail}
                                onToggle={flip(setPrivacyShowEmail)}
                                ariaLabel={t('preferencesPage.privacyShowEmail')}
                                disabled={busy}
                            />
                            <PrefToggle
                                title={t('preferencesPage.privacyShowLibraries')}
                                hint={t('preferencesPage.privacyShowLibrariesHint')}
                                on={privacyShowLibraries}
                                onToggle={flip(setPrivacyShowLibraries)}
                                ariaLabel={t('preferencesPage.privacyShowLibraries')}
                                disabled={busy}
                            />
                        </div>
                    </DashboardPanel>

                    <DashboardPanel title={t('preferencesPage.bioTitle')} subtitle={t('preferencesPage.bioSubtitle')}>
                        <textarea
                            value={profileBio}
                            maxLength={280}
                            rows={3}
                            onChange={(event) => {
                                setProfileBio(event.target.value);
                                setDirty(true);
                            }}
                            placeholder={t('preferencesPage.bioPlaceholder')}
                            className="w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-sm text-text placeholder:text-muted focus:border-plex/40 focus:outline-none"
                        />
                        <p className="mt-1.5 text-[11px] text-muted text-right">{profileBio.length}/280</p>
                    </DashboardPanel>

                    <DashboardPanel title={t('preferencesPage.notificationsTitle')} subtitle={t('preferencesPage.notificationsSubtitle')}>
                        <div className="flex flex-col gap-5">
                            <PrefToggle
                                title={t('homeDashboard.requestAvailableEmail')}
                                hint={t('homeDashboard.requestAvailableEmailHint')}
                                on={notifyRequestAvailableEmail}
                                onToggle={flip(setNotifyRequestAvailableEmail)}
                                ariaLabel={t('homeDashboard.toggleRequestAvailableEmailAria')}
                                disabled={busy}
                            />
                            <PrefToggle
                                title={t('homeDashboard.requestAvailableInApp')}
                                hint={t('homeDashboard.requestAvailableInAppHint')}
                                on={notifyRequestAvailableInApp}
                                onToggle={flip(setNotifyRequestAvailableInApp)}
                                ariaLabel={t('homeDashboard.toggleRequestAvailableInAppAria')}
                                disabled={busy}
                            />
                            <PrefToggle
                                title={t('homeDashboard.requestAvailablePush')}
                                hint={t('homeDashboard.requestAvailablePushHint')}
                                on={notifyRequestAvailableWebPush}
                                onToggle={flip(setNotifyRequestAvailableWebPush)}
                                ariaLabel={t('homeDashboard.toggleRequestAvailableWebPushAria')}
                                disabled={busy}
                            />
                            <PrefToggle
                                title={t('homeDashboard.requestAvailableDiscord')}
                                hint={t('homeDashboard.requestAvailableDiscordHint')}
                                on={notifyRequestAvailableDiscord}
                                onToggle={flip(setNotifyRequestAvailableDiscord)}
                                ariaLabel={t('homeDashboard.toggleRequestAvailableDiscordAria')}
                                disabled={busy}
                            />
                            <PrefToggle
                                title={t('homeDashboard.requestApprovedAlerts')}
                                hint={t('homeDashboard.requestApprovedAlertsHint')}
                                on={notifyRequestApproved}
                                onToggle={flip(setNotifyRequestApproved)}
                                ariaLabel={t('homeDashboard.toggleRequestApprovedAria')}
                                disabled={busy}
                            />
                            <PrefToggle
                                title={t('homeDashboard.requestDeclinedAlerts')}
                                hint={t('homeDashboard.requestDeclinedAlertsHint')}
                                on={notifyRequestDeclined}
                                onToggle={flip(setNotifyRequestDeclined)}
                                ariaLabel={t('homeDashboard.toggleRequestDeclinedAria')}
                                disabled={busy}
                            />
                            <PrefToggle
                                title={t('homeDashboard.seasonAvailableAlerts')}
                                hint={t('homeDashboard.seasonAvailableAlertsHint')}
                                on={notifySeasonAvailable}
                                onToggle={flip(setNotifySeasonAvailable)}
                                ariaLabel={t('homeDashboard.toggleSeasonAvailableAria')}
                                disabled={busy}
                            />
                            <PrefToggle
                                title={t('homeDashboard.newEpisodeAlerts')}
                                hint={t('homeDashboard.newEpisodeAlertsHint')}
                                on={notifyNewEpisode}
                                onToggle={flip(setNotifyNewEpisode)}
                                ariaLabel={t('homeDashboard.toggleNewEpisodeAria')}
                                disabled={busy}
                            />
                            <PrefToggle
                                title={t('homeDashboard.browserPushAllAlerts')}
                                hint={t('homeDashboard.browserPushAllAlertsHint')}
                                on={notifyWebPush}
                                onToggle={flip(setNotifyWebPush)}
                                ariaLabel={t('homeDashboard.toggleBrowserPushAria')}
                                disabled={busy}
                            />
                            {chatEnabled ? (
                                <PrefToggle
                                    title={t('homeDashboard.chatMentionAlerts')}
                                    hint={t('homeDashboard.chatMentionAlertsHint')}
                                    on={notifyChatMentionInApp}
                                    onToggle={flip(setNotifyChatMentionInApp)}
                                    ariaLabel={t('homeDashboard.toggleChatMentionAria')}
                                    disabled={busy}
                                />
                            ) : null}

                            {browserPushSupportedFlag && (
                                <div className="flex flex-col gap-2 border-t border-white/10 pt-4">
                                    {iosPushBlock === 'ios-not-standalone' ? (
                                        <p className="text-amber-300/90 text-xs leading-relaxed">
                                            {t('homeDashboard.iosPushAddToHomeScreen')}
                                        </p>
                                    ) : iosPushBlock === 'ios-version' ? (
                                        <p className="text-amber-300/90 text-xs leading-relaxed">
                                            {t('homeDashboard.iosPushNeeds164')}
                                        </p>
                                    ) : (
                                        <>
                                            <p className="text-muted text-xs">
                                                {browserPushReady
                                                    ? t('homeDashboard.browserPushSubscribed')
                                                    : t('homeDashboard.browserPushSubscribe')}
                                            </p>
                                            {androidPushInstallHint ? (
                                                <p className="text-amber-300/90 text-xs leading-relaxed">
                                                    {t('homeDashboard.androidPushInstallHint')}
                                                </p>
                                            ) : null}
                                        </>
                                    )}
                                    <div className="flex flex-wrap gap-2">
                                        {!browserPushReady && (
                                            <button
                                                type="button"
                                                disabled={busy || !!iosPushBlock}
                                                onClick={() => {
                                                    setBusy(true);
                                                    void (async () => {
                                                        try {
                                                            await subscribeWebPush();
                                                            setBrowserPushReady(true);
                                                            setToasts((prev) => pushToast(prev, t('preferencesPage.pushEnabled'), 'success'));
                                                        } catch (e: any) {
                                                            const code = e?.code;
                                                            const message = code === 'ios-not-standalone'
                                                                ? t('homeDashboard.iosPushAddToHomeScreen')
                                                                : code === 'ios-version'
                                                                    ? t('homeDashboard.iosPushNeeds164')
                                                                    : (e.message || t('preferencesPage.pushFailed'));
                                                            setToasts((prev) => pushToast(prev, message, 'error'));
                                                        } finally {
                                                            setBusy(false);
                                                        }
                                                    })();
                                                }}
                                                className="px-3 py-2 rounded-lg bg-plex text-background text-xs font-bold hover:bg-plex-hover disabled:opacity-50"
                                            >
                                                {t('homeDashboard.enableOnThisDevice')}
                                            </button>
                                        )}
                                        {browserPushReady && (
                                            <button
                                                type="button"
                                                disabled={busy}
                                                onClick={() => {
                                                    setBusy(true);
                                                    void (async () => {
                                                        try {
                                                            await unsubscribeWebPush();
                                                            setBrowserPushReady(false);
                                                            setToasts((prev) => pushToast(prev, t('preferencesPage.pushDisabled'), 'success'));
                                                        } catch (e: any) {
                                                            setToasts((prev) => pushToast(prev, e.message || t('preferencesPage.pushFailed'), 'error'));
                                                        } finally {
                                                            setBusy(false);
                                                        }
                                                    })();
                                                }}
                                                className="px-3 py-2 rounded-lg border border-white/15 bg-white/5 text-xs font-bold text-text hover:bg-white/10 disabled:opacity-50"
                                            >
                                                {t('homeDashboard.disableOnThisDevice')}
                                            </button>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    </DashboardPanel>
                    {isAdmin && (
                        <DashboardPanel title={t('preferencesPage.adminNotificationsTitle')} subtitle={t('preferencesPage.adminNotificationsSubtitle')}>
                            <div className="flex flex-col gap-5">
                                <PrefToggle
                                    title={t('homeDashboard.collexionsFailedAlerts')}
                                    hint={t('homeDashboard.collexionsFailedAlertsHint')}
                                    on={notifyCollexionsFailed}
                                    onToggle={flip(setNotifyCollexionsFailed)}
                                    ariaLabel={t('homeDashboard.toggleCollexionsFailedAria')}
                                    disabled={busy}
                                />
                                <PrefToggle
                                    title={t('homeDashboard.scannerFailedAlerts')}
                                    hint={t('homeDashboard.scannerFailedAlertsHint')}
                                    on={notifyScannerFailed}
                                    onToggle={flip(setNotifyScannerFailed)}
                                    ariaLabel={t('homeDashboard.toggleScannerFailedAria')}
                                    disabled={busy}
                                />
                                <PrefToggle
                                    title={t('homeDashboard.scannerDeletedAlerts')}
                                    hint={t('homeDashboard.scannerDeletedAlertsHint')}
                                    on={notifyScannerDeleted}
                                    onToggle={flip(setNotifyScannerDeleted)}
                                    ariaLabel={t('homeDashboard.toggleScannerDeletedAria')}
                                    disabled={busy}
                                />
                                <PrefToggle
                                    title={t('homeDashboard.scannerUpgradeAlerts')}
                                    hint={t('homeDashboard.scannerUpgradeAlertsHint')}
                                    on={notifyScannerUpgrade}
                                    onToggle={flip(setNotifyScannerUpgrade)}
                                    ariaLabel={t('homeDashboard.toggleScannerUpgradeAria')}
                                    disabled={busy}
                                />
                                <PrefToggle
                                    title={t('homeDashboard.scannerImportAlerts')}
                                    hint={t('homeDashboard.scannerImportAlertsHint')}
                                    on={notifyScannerImport}
                                    onToggle={flip(setNotifyScannerImport)}
                                    ariaLabel={t('homeDashboard.toggleScannerImportAria')}
                                    disabled={busy}
                                />
                                <PrefToggle
                                    title={t('homeDashboard.scannerGrabAlerts')}
                                    hint={t('homeDashboard.scannerGrabAlertsHint')}
                                    on={notifyScannerGrab}
                                    onToggle={flip(setNotifyScannerGrab)}
                                    ariaLabel={t('homeDashboard.toggleScannerGrabAria')}
                                    disabled={busy}
                                />
                                <PrefToggle
                                    title={t('homeDashboard.scannerUpdateAlerts')}
                                    hint={t('homeDashboard.scannerUpdateAlertsHint')}
                                    on={notifyScannerUpdate}
                                    onToggle={flip(setNotifyScannerUpdate)}
                                    ariaLabel={t('homeDashboard.toggleScannerUpdateAria')}
                                    disabled={busy}
                                />
                                <PrefToggle
                                    title={t('homeDashboard.scannerInteractionAlerts')}
                                    hint={t('homeDashboard.scannerInteractionAlertsHint')}
                                    on={notifyScannerInteraction}
                                    onToggle={flip(setNotifyScannerInteraction)}
                                    ariaLabel={t('homeDashboard.toggleScannerInteractionAria')}
                                    disabled={busy}
                                />
                                <PrefToggle
                                    title={t('homeDashboard.statusDownAlerts')}
                                    hint={t('homeDashboard.statusDownAlertsHint')}
                                    on={notifyStatusDown}
                                    onToggle={flip(setNotifyStatusDown)}
                                    ariaLabel={t('homeDashboard.toggleStatusDownAria')}
                                    disabled={busy}
                                />
                                <PrefToggle
                                    title={t('homeDashboard.statusUpAlerts')}
                                    hint={t('homeDashboard.statusUpAlertsHint')}
                                    on={notifyStatusUp}
                                    onToggle={flip(setNotifyStatusUp)}
                                    ariaLabel={t('homeDashboard.toggleStatusUpAria')}
                                    disabled={busy}
                                />
                                <PrefToggle
                                    title={t('homeDashboard.mediaJobFailedAlerts')}
                                    hint={t('homeDashboard.mediaJobFailedAlertsHint')}
                                    on={notifyMediaJobFailed}
                                    onToggle={flip(setNotifyMediaJobFailed)}
                                    ariaLabel={t('homeDashboard.toggleMediaJobFailedAria')}
                                    disabled={busy}
                                />
                                <PrefToggle
                                    title={t('homeDashboard.mediaJobCompletedAlerts')}
                                    hint={t('homeDashboard.mediaJobCompletedAlertsHint')}
                                    on={notifyMediaJobCompleted}
                                    onToggle={flip(setNotifyMediaJobCompleted)}
                                    ariaLabel={t('homeDashboard.toggleMediaJobCompletedAria')}
                                    disabled={busy}
                                />
                                <PrefToggle
                                    title={t('homeDashboard.tautulliApiFailedAlerts')}
                                    hint={t('homeDashboard.tautulliApiFailedAlertsHint')}
                                    on={notifyTautulliApiFailed}
                                    onToggle={flip(setNotifyTautulliApiFailed)}
                                    ariaLabel={t('homeDashboard.toggleTautulliApiFailedAria')}
                                    disabled={busy}
                                />
                                <PrefToggle
                                    title="Smart summary digests"
                                    hint="Scheduled server snapshot notifications with uptime, requests, and automation activity."
                                    on={notifySummaryDigest}
                                    onToggle={flip(setNotifySummaryDigest)}
                                    ariaLabel="Toggle smart summary digests"
                                    disabled={busy}
                                />
                                <PrefToggle
                                    title={t('homeDashboard.supportTicketAlerts')}
                                    hint={t('homeDashboard.supportTicketAlertsHint')}
                                    on={notifySupportTicket}
                                    onToggle={flip(setNotifySupportTicket)}
                                    ariaLabel={t('homeDashboard.toggleSupportTicketAria')}
                                    disabled={busy}
                                />
                                <PrefToggle
                                    title={t('homeDashboard.supportReplyAlerts')}
                                    hint={t('homeDashboard.supportReplyAlertsHint')}
                                    on={notifySupportReply}
                                    onToggle={flip(setNotifySupportReply)}
                                    ariaLabel={t('homeDashboard.toggleSupportReplyAria')}
                                    disabled={busy}
                                />
                                <PrefToggle
                                    title={t('homeDashboard.supportMediaIssueAlerts')}
                                    hint={t('homeDashboard.supportMediaIssueAlertsHint')}
                                    on={notifySupportMediaIssue}
                                    onToggle={flip(setNotifySupportMediaIssue)}
                                    ariaLabel={t('homeDashboard.toggleSupportMediaIssueAria')}
                                    disabled={busy}
                                />
                            </div>
                        </DashboardPanel>
                    )}
                    <p className="text-sm text-muted">
                        {dirty ? t('preferencesPage.unsaved') : t('preferencesPage.saveHint')}
                    </p>
                    <StickySaveBar>
                        {renderSaveButton()}
                    </StickySaveBar>
                </div>
            )}
        </DashboardPageShell>
    );
};

export default PreferencesPage;
