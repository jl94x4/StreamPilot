import React, { useEffect, useMemo, useState } from 'react';
import { CustomSelect, SettingsToggleRow } from '../shared/ui';
import { SettingHint } from './SettingHint';
import { apiFetch } from '../shared/api';
import { useDiscoverI18n } from '../discovery/i18n';

export type AchievementsXpWeights = Record<string, number>;

export type AchievementsSeason = {
    id: string;
    name: string;
    activeFrom: string;
    activeUntil: string;
    badgeIds: string[];
    spotlight: boolean;
};

type CatalogBadge = {
    id: string;
    name: string;
    icon?: string;
    category?: string;
};

type Props = {
    achievementsEnabled: boolean;
    setAchievementsEnabled: (v: boolean) => void;
    achievementsLeaderboardEnabled: boolean;
    setAchievementsLeaderboardEnabled: (v: boolean) => void;
    achievementsHomeWidgetEnabled: boolean;
    setAchievementsHomeWidgetEnabled: (v: boolean) => void;
    achievementsShowOnProfile: boolean;
    setAchievementsShowOnProfile: (v: boolean) => void;
    achievementsXpWeights: AchievementsXpWeights;
    setAchievementsXpWeights: (v: AchievementsXpWeights) => void;
    achievementsDisabledBadgeIds: string[];
    setAchievementsDisabledBadgeIds: (v: string[]) => void;
    achievementsMinPercentComplete: number;
    setAchievementsMinPercentComplete: (v: number) => void;
    achievementsSeasons: AchievementsSeason[];
    setAchievementsSeasons: (v: AchievementsSeason[]) => void;
};

const emptySeason = (): AchievementsSeason => ({
    id: `season-${Date.now().toString(36)}`,
    name: '',
    activeFrom: '',
    activeUntil: '',
    badgeIds: [],
    spotlight: true,
});

export const AchievementsSettings: React.FC<Props> = ({
    achievementsEnabled,
    setAchievementsEnabled,
    achievementsLeaderboardEnabled,
    setAchievementsLeaderboardEnabled,
    achievementsHomeWidgetEnabled,
    setAchievementsHomeWidgetEnabled,
    achievementsShowOnProfile,
    setAchievementsShowOnProfile,
    achievementsXpWeights,
    setAchievementsXpWeights,
    achievementsDisabledBadgeIds,
    setAchievementsDisabledBadgeIds,
    achievementsMinPercentComplete,
    setAchievementsMinPercentComplete,
    achievementsSeasons,
    setAchievementsSeasons,
}) => {
    const { t } = useDiscoverI18n();
    const [weightLabels, setWeightLabels] = useState<Record<string, string>>({});
    const [defaultWeights, setDefaultWeights] = useState<AchievementsXpWeights>({});
    const [categories, setCategories] = useState<Array<{ id: string; label: string }>>([]);
    const [catalog, setCatalog] = useState<CatalogBadge[]>([]);
    const [badgeQuery, setBadgeQuery] = useState('');
    const [badgeCategory, setBadgeCategory] = useState('all');
    const [catalogLoading, setCatalogLoading] = useState(false);
    const [backfillStatus, setBackfillStatus] = useState<any>(null);
    const [backfillBusy, setBackfillBusy] = useState(false);
    const [insights, setInsights] = useState<any>(null);
    const [insightsBusy, setInsightsBusy] = useState(false);
    const [seasonDraft, setSeasonDraft] = useState<AchievementsSeason | null>(null);
    const [seasonBadgeQuery, setSeasonBadgeQuery] = useState('');

    useEffect(() => {
        if (!achievementsEnabled) return;
        let cancelled = false;
        setCatalogLoading(true);
        apiFetch('/api/achievements/meta?catalog=1')
            .then((data) => {
                if (cancelled || !data) return;
                if (data.xpWeightLabels && typeof data.xpWeightLabels === 'object') {
                    setWeightLabels(data.xpWeightLabels);
                }
                if (data.defaultXpWeights && typeof data.defaultXpWeights === 'object') {
                    setDefaultWeights(data.defaultXpWeights);
                }
                if (Array.isArray(data.categories)) {
                    setCategories(data.categories.map((c: any) => ({ id: String(c.id), label: String(c.label || c.id) })));
                }
                if (Array.isArray(data.catalog)) {
                    setCatalog(data.catalog.map((b: any) => ({
                        id: String(b.id),
                        name: String(b.name || b.id),
                        icon: b.icon ? String(b.icon) : undefined,
                        category: b.category ? String(b.category) : undefined,
                    })));
                }
            })
            .catch(() => {})
            .finally(() => {
                if (!cancelled) setCatalogLoading(false);
            });

        apiFetch('/api/achievements/admin/backfill')
            .then((data) => { if (!cancelled && data) setBackfillStatus(data); })
            .catch(() => {});

        return () => { cancelled = true; };
    }, [achievementsEnabled]);

    const refreshBackfill = async () => {
        const data = await apiFetch('/api/achievements/admin/backfill').catch(() => null);
        if (data) setBackfillStatus(data);
        return data;
    };

    const runBackfill = async (force: boolean) => {
        setBackfillBusy(true);
        try {
            const data = await apiFetch('/api/achievements/admin/backfill', {
                method: 'POST',
                body: JSON.stringify({ force }),
            });
            if (data?.status) setBackfillStatus({ ...data.status, enabled: true });
            else await refreshBackfill();
        } catch {
            /* ignore */
        } finally {
            setBackfillBusy(false);
        }
    };

    const loadInsights = async () => {
        setInsightsBusy(true);
        try {
            const data = await apiFetch('/api/achievements/admin/insights');
            setInsights(data || null);
        } catch {
            setInsights(null);
        } finally {
            setInsightsBusy(false);
        }
    };

    const effectiveWeights = useMemo(
        () => ({ ...defaultWeights, ...(achievementsXpWeights || {}) }),
        [defaultWeights, achievementsXpWeights],
    );

    const weightKeys = useMemo(() => {
        const keys = Object.keys(defaultWeights);
        if (keys.length) return keys;
        const current = Object.keys(achievementsXpWeights || {});
        return current.length ? current : [
            'uniqueMovies', 'uniqueShows', 'uniqueMusic', 'moviePlays', 'episodePlays',
            'trackPlays', 'totalPlays', 'activeDays', 'dailyWatches', 'currentStreak', 'longestStreak',
            'weekendPlays', 'movieFinishes', 'episodeFinishes', 'trackFinishes', 'bingeSessions',
            'minutesWatched', 'hoursWatched', 'sundayMinutes', 'mediaRequests', 'badgeUnlocks',
        ];
    }, [defaultWeights, achievementsXpWeights]);

    const disabledSet = useMemo(() => new Set(achievementsDisabledBadgeIds.map(String)), [achievementsDisabledBadgeIds]);

    const filteredBadges = useMemo(() => {
        const q = badgeQuery.trim().toLowerCase();
        return catalog.filter((b) => {
            if (badgeCategory !== 'all' && b.category !== badgeCategory) return false;
            if (!q) return true;
            return b.name.toLowerCase().includes(q) || b.id.toLowerCase().includes(q);
        });
    }, [catalog, badgeQuery, badgeCategory]);

    const seasonBadgeMatches = useMemo(() => {
        const q = seasonBadgeQuery.trim().toLowerCase();
        if (!q) return catalog.slice(0, 40);
        return catalog.filter((b) => b.name.toLowerCase().includes(q) || b.id.toLowerCase().includes(q)).slice(0, 40);
    }, [catalog, seasonBadgeQuery]);

    const setWeight = (key: string, raw: string) => {
        const n = Number(raw);
        const value = Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0;
        setAchievementsXpWeights({ ...effectiveWeights, [key]: value });
    };

    const toggleBadgeDisabled = (id: string) => {
        const next = new Set(disabledSet);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setAchievementsDisabledBadgeIds([...next]);
    };

    const saveSeasonDraft = () => {
        if (!seasonDraft) return;
        const name = seasonDraft.name.trim();
        if (!name) return;
        const normalized: AchievementsSeason = {
            ...seasonDraft,
            name,
            id: seasonDraft.id || `season-${Date.now().toString(36)}`,
            badgeIds: [...new Set(seasonDraft.badgeIds.map(String).filter(Boolean))],
        };
        const idx = achievementsSeasons.findIndex((s) => s.id === normalized.id);
        if (idx >= 0) {
            const next = [...achievementsSeasons];
            next[idx] = normalized;
            setAchievementsSeasons(next);
        } else {
            setAchievementsSeasons([...achievementsSeasons, normalized]);
        }
        setSeasonDraft(null);
        setSeasonBadgeQuery('');
    };

    const toggleSeasonBadge = (badgeId: string) => {
        if (!seasonDraft) return;
        const set = new Set(seasonDraft.badgeIds.map(String));
        if (set.has(badgeId)) set.delete(badgeId);
        else set.add(badgeId);
        setSeasonDraft({ ...seasonDraft, badgeIds: [...set] });
    };

    return (
        <section id="settings-section-achievements" className="space-y-1 scroll-mt-24">
            <div className="mb-2">
                <h3 className="text-lg font-bold text-text">{t('settings.achievements.title')}</h3>
                <p className="text-sm text-muted mt-1">
                    {t('settings.achievements.description')}
                </p>
            </div>
            <SettingsToggleRow
                title={t('settings.achievements.enableTitle')}
                description={t('settings.achievements.enableDescription')}
                checked={achievementsEnabled}
                onChange={setAchievementsEnabled}
            />
            <p className="text-xs text-muted pb-3 border-b border-border/60">
                {t('settings.achievements.watchHistoryMovedHint')}
            </p>
            <div className={achievementsEnabled ? '' : 'opacity-50 pointer-events-none'}>
                <SettingsToggleRow
                    title={t('settings.achievements.showLeaderboard')}
                    description={t('settings.achievements.showLeaderboardDescription')}
                    checked={achievementsLeaderboardEnabled}
                    onChange={setAchievementsLeaderboardEnabled}
                />
                <SettingsToggleRow
                    title={t('settings.achievements.homeWidget')}
                    description={t('settings.achievements.homeWidgetDescription')}
                    checked={achievementsHomeWidgetEnabled}
                    onChange={setAchievementsHomeWidgetEnabled}
                />
                <SettingsToggleRow
                    title={t('settings.achievements.showBadgesOnProfile')}
                    description={t('settings.achievements.showBadgesOnProfileDescription')}
                    checked={achievementsShowOnProfile}
                    onChange={setAchievementsShowOnProfile}
                />

                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 py-4 border-b border-border/60">
                    <div className="min-w-0 sm:pr-6">
                        <p className="text-sm font-semibold text-text">{t('settings.achievements.minPercentComplete')}</p>
                        <SettingHint>
                            {t('settings.achievements.minPercentCompleteHint')}
                        </SettingHint>
                    </div>
                    <div className="w-full sm:w-36 shrink-0">
                        <input
                            type="number"
                            min={0}
                            max={100}
                            step={1}
                            className="appearance-none text-[16px] leading-5 w-full p-2.5 rounded-lg border border-border bg-background text-text text-[16px] text-right outline-none focus:border-plex"
                            value={Number(achievementsMinPercentComplete) || 0}
                            onChange={(e) => {
                                const n = Number(e.target.value);
                                setAchievementsMinPercentComplete(
                                    Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : 0,
                                );
                            }}
                        />
                    </div>
                </div>

                <div className="py-4 border-b border-border/60 space-y-3">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="min-w-0">
                            <p className="text-sm font-semibold text-text">{t('settings.achievements.seasonManager')}</p>
                            <SettingHint>
                                {t('settings.achievements.seasonManagerHint')}
                            </SettingHint>
                        </div>
                        <button
                            type="button"
                            className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-border hover:border-plex/40 shrink-0"
                            onClick={() => {
                                setSeasonDraft(emptySeason());
                                setSeasonBadgeQuery('');
                            }}
                        >
                            {t('settings.achievements.addSeason')}
                        </button>
                    </div>
                    {achievementsSeasons.length === 0 && !seasonDraft && (
                        <p className="text-xs text-muted">{t('settings.achievements.noSeasons')}</p>
                    )}
                    <div className="space-y-2">
                        {achievementsSeasons.map((season) => (
                            <div key={season.id} className="rounded-lg border border-border/50 bg-background/40 px-3 py-2.5 flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <p className="text-sm font-semibold text-text truncate">{season.name}</p>
                                    <p className="text-[11px] text-muted font-mono mt-0.5">
                                        {(season.activeFrom || '…')} → {(season.activeUntil || '…')}
                                        {' · '}{t('settings.achievements.seasonBadgeCount', { count: season.badgeIds.length })}
                                        {season.spotlight === false ? ` · ${t('settings.achievements.noSpotlight')}` : ''}
                                    </p>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                    <button
                                        type="button"
                                        className="text-xs font-semibold text-plex hover:underline"
                                        onClick={() => {
                                            setSeasonDraft({ ...season, badgeIds: [...season.badgeIds] });
                                            setSeasonBadgeQuery('');
                                        }}
                                    >
                                        {t('settings.achievements.edit')}
                                    </button>
                                    <button
                                        type="button"
                                        className="text-xs font-semibold text-muted hover:text-red-300"
                                        onClick={() => setAchievementsSeasons(achievementsSeasons.filter((s) => s.id !== season.id))}
                                    >
                                        {t('common.remove')}
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                    {seasonDraft && (
                        <div className="rounded-xl border border-plex/30 bg-plex/5 p-3 space-y-3">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                <label className="space-y-1">
                                    <span className="text-[11px] text-muted font-semibold">{t('settings.achievements.name')}</span>
                                    <input
                                        className="w-full appearance-none p-2 rounded-lg border border-border bg-background text-text text-[16px] leading-5 outline-none focus:border-plex"
                                        value={seasonDraft.name}
                                        onChange={(e) => setSeasonDraft({ ...seasonDraft, name: e.target.value })}
                                        placeholder="Halloween 2026"
                                    />
                                </label>
                                <label className="flex items-center gap-2 pt-5">
                                    <input
                                        type="checkbox"
                                        checked={seasonDraft.spotlight !== false}
                                        onChange={(e) => setSeasonDraft({ ...seasonDraft, spotlight: e.target.checked })}
                                    />
                                    <span className="text-xs text-text">{t('settings.achievements.showSpotlightStrip')}</span>
                                </label>
                                <label className="space-y-1">
                                    <span className="text-[11px] text-muted font-semibold">{t('settings.achievements.activeFrom')}</span>
                                    <input
                                        className="w-full appearance-none p-2 rounded-lg border border-border bg-background text-text text-[16px] leading-5 outline-none focus:border-plex font-mono"
                                        value={seasonDraft.activeFrom}
                                        onChange={(e) => setSeasonDraft({ ...seasonDraft, activeFrom: e.target.value })}
                                        placeholder="10-01"
                                    />
                                </label>
                                <label className="space-y-1">
                                    <span className="text-[11px] text-muted font-semibold">{t('settings.achievements.activeUntil')}</span>
                                    <input
                                        className="w-full appearance-none p-2 rounded-lg border border-border bg-background text-text text-[16px] leading-5 outline-none focus:border-plex font-mono"
                                        value={seasonDraft.activeUntil}
                                        onChange={(e) => setSeasonDraft({ ...seasonDraft, activeUntil: e.target.value })}
                                        placeholder="10-31"
                                    />
                                </label>
                            </div>
                            <div className="space-y-2">
                                <p className="text-[11px] text-muted font-semibold">
                                    {t('settings.achievements.badgesInSeason', { count: seasonDraft.badgeIds.length })}
                                </p>
                                <input
                                    type="text"
                                    inputMode="search"
                                    value={seasonBadgeQuery}
                                    onChange={(e) => setSeasonBadgeQuery(e.target.value)}
                                    placeholder={t('settings.achievements.searchBadgesToInclude')}
                                    className="w-full appearance-none p-2 rounded-lg border border-border bg-background text-text text-[16px] leading-5 outline-none focus:border-plex"
                                />
                                <div className="max-h-40 overflow-y-auto rounded-lg border border-border/60 divide-y divide-border/40">
                                    {seasonBadgeMatches.map((badge) => {
                                        const on = seasonDraft.badgeIds.includes(badge.id);
                                        return (
                                            <label key={badge.id} className="flex items-center gap-2 px-2.5 py-1.5 hover:bg-white/5 cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    checked={on}
                                                    onChange={() => toggleSeasonBadge(badge.id)}
                                                />
                                                <span className="w-5 text-center shrink-0">{badge.icon || '🏅'}</span>
                                                <span className="text-xs text-text truncate">{badge.name}</span>
                                            </label>
                                        );
                                    })}
                                    {!seasonBadgeMatches.length && (
                                        <p className="p-2 text-[11px] text-muted">{t('settings.achievements.noMatchingBadges')}</p>
                                    )}
                                </div>
                            </div>
                            <div className="flex items-center justify-end gap-2">
                                <button
                                    type="button"
                                    className="text-xs font-semibold text-muted hover:text-text"
                                    onClick={() => { setSeasonDraft(null); setSeasonBadgeQuery(''); }}
                                >
                                    {t('common.cancel')}
                                </button>
                                <button
                                    type="button"
                                    className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-plex/40 bg-plex/15 text-plex disabled:opacity-50"
                                    disabled={!seasonDraft.name.trim()}
                                    onClick={saveSeasonDraft}
                                >
                                    {t('settings.achievements.saveSeason')}
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                <div className="py-4 border-b border-border/60 space-y-3">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="min-w-0">
                            <p className="text-sm font-semibold text-text">{t('settings.achievements.backfillTitle')}</p>
                            <SettingHint>
                                {t('settings.achievements.backfillHint')}
                            </SettingHint>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                            <button
                                type="button"
                                className="text-xs font-semibold text-muted hover:text-text"
                                disabled={backfillBusy}
                                onClick={() => { void refreshBackfill(); }}
                            >
                                {t('settings.achievements.refreshStatus')}
                            </button>
                            <button
                                type="button"
                                className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-border hover:border-plex/40 disabled:opacity-50"
                                disabled={backfillBusy || !!backfillStatus?.inFlight}
                                onClick={() => { void runBackfill(true); }}
                            >
                                {backfillBusy || backfillStatus?.inFlight
                                    ? t('settings.achievements.running')
                                    : t('settings.achievements.forceRun')}
                            </button>
                        </div>
                    </div>
                    <div className="rounded-lg border border-border/50 bg-background/40 px-3 py-2 text-xs text-muted space-y-1">
                        <p>
                            {t('settings.achievements.statusLabel')}{' '}
                            <span className="text-text font-semibold">
                                {backfillStatus?.inFlight
                                    ? t('settings.achievements.inProgress')
                                    : (backfillStatus?.lastResult?.ok ? t('settings.achievements.ready') : (backfillStatus?.lastResult?.reason || t('settings.achievements.idle')))}
                            </span>
                        </p>
                        {backfillStatus?.lastCompletedAt && (
                            <p>{t('settings.achievements.lastCompleted', { date: new Date(backfillStatus.lastCompletedAt).toLocaleString() })}</p>
                        )}
                        {backfillStatus?.lastResult?.processed != null && (
                            <p>{t('settings.achievements.lastRunProcessed', { count: Number(backfillStatus.lastResult.processed) || 0 })}</p>
                        )}
                    </div>
                </div>

                <div className="py-4 border-b border-border/60 space-y-3">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="min-w-0">
                            <p className="text-sm font-semibold text-text">{t('settings.achievements.badgeInsights')}</p>
                            <SettingHint>
                                {t('settings.achievements.badgeInsightsHint')}
                            </SettingHint>
                        </div>
                        <button
                            type="button"
                            className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-border hover:border-plex/40 disabled:opacity-50 shrink-0"
                            disabled={insightsBusy}
                            onClick={() => { void loadInsights(); }}
                        >
                            {insightsBusy
                                ? t('settings.achievements.loading')
                                : (insights ? t('settings.achievements.refreshInsights') : t('settings.achievements.loadInsights'))}
                        </button>
                    </div>
                    {insights && (
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 text-xs">
                            {[
                                { title: t('settings.achievements.neverUnlocked'), rows: insights.neverUnlocked || [] },
                                { title: t('settings.achievements.rarest'), rows: insights.rarest || [] },
                                { title: t('settings.achievements.mostCommon'), rows: insights.mostCommon || [] },
                            ].map((col) => (
                                <div key={col.title} className="rounded-lg border border-border/50 bg-background/40 overflow-hidden">
                                    <p className="px-3 py-2 font-semibold text-text border-b border-border/40">{col.title}</p>
                                    <div className="max-h-48 overflow-y-auto divide-y divide-border/30">
                                        {(col.rows as any[]).slice(0, 12).map((row) => (
                                            <div key={row.id} className="px-3 py-1.5 flex items-center gap-2">
                                                <span className="w-5 text-center shrink-0">{row.icon || '🏅'}</span>
                                                <span className="truncate flex-1 text-text">{row.name}</span>
                                                <span className="font-mono text-muted shrink-0">{row.unlocks ?? 0}</span>
                                            </div>
                                        ))}
                                        {!col.rows?.length && (
                                            <p className="px-3 py-2 text-muted">{t('settings.achievements.noData')}</p>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div className="py-4 border-b border-border/60 space-y-3">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="min-w-0">
                            <p className="text-sm font-semibold text-text">{t('settings.achievements.xpWeights')}</p>
                            <SettingHint>
                                {t('settings.achievements.xpWeightsHint')}
                            </SettingHint>
                        </div>
                        {Object.keys(defaultWeights).length > 0 && (
                            <button
                                type="button"
                                className="text-xs font-semibold text-plex hover:underline shrink-0"
                                onClick={() => setAchievementsXpWeights({ ...defaultWeights })}
                            >
                                {t('settings.achievements.resetToDefaults')}
                            </button>
                        )}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        {weightKeys.map((key) => (
                            <label key={key} className="flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-background/40 px-3 py-2">
                                <span className="text-xs text-text min-w-0 leading-snug">
                                    {weightLabels[key] || key}
                                </span>
                                <input
                                    type="number"
                                    min={0}
                                    max={100}
                                    step={1}
                                    className="appearance-none text-[16px] leading-5 w-16 shrink-0 p-1.5 rounded-md border border-border bg-background text-text text-[16px] text-right outline-none focus:border-plex"
                                    value={Number(effectiveWeights[key] ?? 0)}
                                    onChange={(e) => setWeight(key, e.target.value)}
                                />
                            </label>
                        ))}
                    </div>
                </div>

                <div className="py-4 space-y-3">
                    <div>
                        <p className="text-sm font-semibold text-text">{t('settings.achievements.disableBadges')}</p>
                        <SettingHint>
                            {t('settings.achievements.disableBadgesHint')}
                            {disabledSet.size > 0 ? ` ${t('settings.achievements.disabledCount', { count: disabledSet.size })}` : ''}
                        </SettingHint>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-2">
                        <input
                            type="text"
                            inputMode="search"
                            value={badgeQuery}
                            onChange={(e) => setBadgeQuery(e.target.value)}
                            placeholder={t('settings.achievements.searchBadges')}
                            className="flex-1 appearance-none p-2.5 rounded-lg border border-border bg-background text-text text-[16px] leading-5 outline-none focus:border-plex"
                        />
                        <div className="w-full sm:w-44 shrink-0">
                            <CustomSelect
                                value={badgeCategory}
                                onChange={setBadgeCategory}
                                options={[
                                    { label: t('settings.achievements.allCategories'), value: 'all' },
                                    ...categories.map((c) => ({ label: c.label, value: c.id })),
                                ]}
                                compact
                                className="w-full"
                            />
                        </div>
                    </div>
                    <div className="max-h-64 overflow-y-auto rounded-lg border border-border/60 divide-y divide-border/40">
                        {catalogLoading && (
                            <p className="p-3 text-xs text-muted">{t('settings.achievements.loadingBadgeCatalog')}</p>
                        )}
                        {!catalogLoading && filteredBadges.length === 0 && (
                            <p className="p-3 text-xs text-muted">{t('settings.achievements.noBadgesMatch')}</p>
                        )}
                        {filteredBadges.slice(0, 200).map((badge) => {
                            const disabled = disabledSet.has(badge.id);
                            return (
                                <label
                                    key={badge.id}
                                    className="flex items-center gap-3 px-3 py-2 hover:bg-white/5 cursor-pointer"
                                >
                                    <input
                                        type="checkbox"
                                        checked={disabled}
                                        onChange={() => toggleBadgeDisabled(badge.id)}
                                        className="rounded border-border"
                                    />
                                    <span className="text-base w-6 text-center shrink-0">{badge.icon || '🏅'}</span>
                                    <span className="min-w-0 flex-1">
                                        <span className="block text-sm text-text truncate">{badge.name}</span>
                                        <span className="block text-[10px] text-muted truncate">{badge.id}</span>
                                    </span>
                                    {disabled && (
                                        <span className="text-[10px] uppercase tracking-wide text-amber-300/90 shrink-0">{t('settings.achievements.off')}</span>
                                    )}
                                </label>
                            );
                        })}
                        {filteredBadges.length > 200 && (
                            <p className="p-2 text-[11px] text-muted text-center">
                                {t('settings.achievements.showingBadgeLimit', { shown: 200, total: filteredBadges.length })}
                            </p>
                        )}
                    </div>
                    {disabledSet.size > 0 && (
                        <button
                            type="button"
                            className="text-xs font-semibold text-muted hover:text-text"
                            onClick={() => setAchievementsDisabledBadgeIds([])}
                        >
                            {t('settings.achievements.clearDisabledBadges')}
                        </button>
                    )}
                </div>
            </div>
        </section>
    );
};
