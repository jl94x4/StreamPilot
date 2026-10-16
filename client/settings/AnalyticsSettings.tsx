import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { CustomSelect, SettingsToggleRow } from '../shared/ui';
import { SettingHint } from './SettingHint';
import { apiFetch } from '../shared/api';
import { useDiscoverI18n } from '../discovery/i18n';
import { getSettingsSectionElementId } from './settingsIndex';

type AnalyticsCacheInfo = {
    source?: string | null;
    sourceLabel?: string | null;
    lastUpdated?: number | null;
    degraded?: boolean;
    rebuildPending?: boolean;
};

type Props = {
    mediaServerType: 'plex' | 'jellyfin' | 'emby';
    watchHistorySource: 'plex' | 'tautulli';
    setWatchHistorySource: (v: 'plex' | 'tautulli') => void;
    tautulliConfigured?: boolean;
    showUsernamesInAnalytics: boolean;
    setShowUsernamesInAnalytics: (v: boolean) => void;
    onOpenTautulliSettings?: () => void;
};

export const AnalyticsSettings: React.FC<Props> = ({
    mediaServerType,
    watchHistorySource,
    setWatchHistorySource,
    tautulliConfigured = false,
    showUsernamesInAnalytics,
    setShowUsernamesInAnalytics,
    onOpenTautulliSettings,
}) => {
    const { t } = useDiscoverI18n();
    const isPlex = mediaServerType === 'plex';
    const [cacheInfo, setCacheInfo] = useState<AnalyticsCacheInfo | null>(null);
    const [rebuilding, setRebuilding] = useState(false);
    const [rebuildMessage, setRebuildMessage] = useState<string | null>(null);

    const loadCacheInfo = useCallback(async () => {
        if (!isPlex) return;
        try {
            const data = await apiFetch('/api/plex/analytics?days=30');
            setCacheInfo({
                source: data?.source || null,
                sourceLabel: data?.sourceLabel || null,
                lastUpdated: data?.lastUpdated || null,
                degraded: !!data?.degraded,
                rebuildPending: !!data?.rebuildPending,
            });
        } catch {
            setCacheInfo(null);
        }
    }, [isPlex]);

    useEffect(() => {
        void loadCacheInfo();
    }, [loadCacheInfo]);

    const handleRebuild = async () => {
        if (rebuilding) return;
        setRebuilding(true);
        setRebuildMessage(null);
        try {
            const result = await apiFetch('/api/plex/analytics/rebuild', { method: 'POST' });
            setRebuildMessage(result?.message || t('analytics.source.rebuildStarted'));
            window.setTimeout(() => { void loadCacheInfo(); }, 2500);
        } catch (err: any) {
            setRebuildMessage(err?.message || t('analytics.source.rebuildFailed'));
        } finally {
            setRebuilding(false);
        }
    };

    const lastUpdatedLabel = (() => {
        const ts = Number(cacheInfo?.lastUpdated);
        if (!Number.isFinite(ts) || ts <= 0) return t('analytics.source.updatedUnknown');
        try {
            return t('analytics.source.updated', { time: new Date(ts).toLocaleString() });
        } catch {
            return t('analytics.source.updatedUnknown');
        }
    })();

    return (
        <section id={getSettingsSectionElementId('analytics')} className="space-y-1 scroll-mt-24">
            <div className="mb-2">
                <h3 className="text-lg font-bold text-text">{t('settings.analytics.title')}</h3>
                <p className="text-sm text-muted mt-1">
                    {t('settings.analytics.description')}
                </p>
            </div>

            {isPlex && (
                <div id={getSettingsSectionElementId('history-source')} className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 py-4 border-b border-border/60 scroll-mt-24">
                    <div className="min-w-0 sm:pr-6">
                        <p className="text-sm font-semibold text-text">{t('settings.analytics.watchHistorySource')}</p>
                        <SettingHint>
                            {t('settings.analytics.watchHistorySourceHint')}
                        </SettingHint>
                    </div>
                    <div className="w-full sm:w-56 shrink-0">
                        <CustomSelect
                            value={watchHistorySource}
                            onChange={(v) => setWatchHistorySource(v === 'tautulli' ? 'tautulli' : 'plex')}
                            options={[
                                { label: t('settings.analytics.plexSessionHistory'), value: 'plex' },
                                { label: 'Tautulli', value: 'tautulli' },
                            ]}
                            compact
                            className="w-full"
                        />
                        {watchHistorySource === 'tautulli' && !tautulliConfigured && (
                            <p className="text-[11px] text-amber-300/90 mt-1.5">
                                {t('settings.analytics.tautulliNotConfigured')}
                            </p>
                        )}
                        {onOpenTautulliSettings && (
                            <button
                                type="button"
                                onClick={onOpenTautulliSettings}
                                className="mt-2 text-[11px] font-semibold text-plex hover:underline"
                            >
                                {t('settings.analytics.openTautulliSettings')}
                            </button>
                        )}
                    </div>
                </div>
            )}

            <div id={getSettingsSectionElementId('usernames')} className="scroll-mt-24">
                <SettingsToggleRow
                    title={t('settings.analytics.showUsernames')}
                    description={t('settings.analytics.showUsernamesDescription')}
                    checked={showUsernamesInAnalytics}
                    onChange={setShowUsernamesInAnalytics}
                />
            </div>

            {isPlex && (
                <div id={getSettingsSectionElementId('cache')} className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 py-4 border-b border-border/60 scroll-mt-24">
                    <div className="min-w-0 sm:pr-6">
                        <p className="text-sm font-semibold text-text">{t('settings.analytics.cacheTitle')}</p>
                        <SettingHint>
                            {t('settings.analytics.cacheHint')}
                        </SettingHint>
                        <p className="text-xs text-muted mt-2">
                            {t('settings.analytics.cacheSource', {
                                source: cacheInfo?.sourceLabel || t('analytics.source.plex'),
                            })}
                            {' · '}
                            {lastUpdatedLabel}
                        </p>
                        {rebuildMessage && (
                            <p className="text-[11px] text-muted mt-1.5">{rebuildMessage}</p>
                        )}
                    </div>
                    <button
                        type="button"
                        onClick={() => void handleRebuild()}
                        disabled={rebuilding}
                        className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs font-bold text-text hover:bg-white/5 disabled:opacity-50 w-full sm:w-auto shrink-0"
                    >
                        <RefreshCw className={`h-3.5 w-3.5 ${rebuilding ? 'animate-spin' : ''}`} />
                        {rebuilding ? t('analytics.source.rebuilding') : t('analytics.source.rebuild')}
                    </button>
                </div>
            )}
        </section>
    );
};
