import { Check,X } from 'lucide-react';
import React,{ useCallback,useEffect,useMemo,useState } from 'react';

import { useDiscoverI18n } from '../discovery/i18n';
import { LibraryMaintenancePanel } from '../maintenance/LibraryMaintenancePanel';
import { apiFetch } from '../shared/api';
import { portalUrl } from '../shared/basePath';
import { Loader,ToastContainer,pushToast } from '../shared/toast';
import type { ToastMessage } from '../shared/types';
import { CustomSelect } from '../shared/ui';



export const MaintenanceDashboard: React.FC = () => {
    const { t } = useDiscoverI18n();
    const [toasts, setToasts] = useState<ToastMessage[]>([]);
    const [maintenanceFeatureEnabled, setMaintenanceFeatureEnabled] = useState(false);
    const [overview, setOverview] = useState<any>(null);
    const [runs, setRuns] = useState<any[]>([]);
    const [previewGroups, setPreviewGroups] = useState<any[]>([]);
    const [rules, setRules] = useState<any[]>([]);
    const [overviewInsights, setOverviewInsights] = useState<{
        totalMatches: number;
        uniqueMatches: number;
        estimatedReclaimGB: number;
        libraries: Array<{ libraryTitle: string; count: number; reclaimGB: number }>;
        rules: Array<{ ruleId: string; ruleName: string; totalMatches: number; reclaimGB: number }>;
    }>({
        totalMatches: 0,
        uniqueMatches: 0,
        estimatedReclaimGB: 0,
        libraries: [],
        rules: []
    });
    const [preferences, setPreferences] = useState<any>({
        global: { dryRunByDefault: true, maxActionsPerRun: 25, requireConfirmForDestructive: true },
        exclusions: { ratingKeys: [], titles: [], libraries: [] }
    });
    const [candidateRuleId, setCandidateRuleId] = useState<string>('');
    const [candidateItems, setCandidateItems] = useState<any[]>([]);
    const [candidateSearch, setCandidateSearch] = useState('');
    const [isLoadingCandidates, setIsLoadingCandidates] = useState(false);
    const [libraryJsonInput, setLibraryJsonInput] = useState('');
    const [libraryItems, setLibraryItems] = useState<any[]>([]);
    const [libraryOptions, setLibraryOptions] = useState<Array<{ id: string; title: string; count: number }>>([]);
    const [libraryBrowseId, setLibraryBrowseId] = useState('all');
    const [libraryBrowseSearch, setLibraryBrowseSearch] = useState('');
    const [libraryBrowsePage, setLibraryBrowsePage] = useState(1);
    const [libraryBrowseLimit] = useState(48);
    const [libraryBrowseTotal, setLibraryBrowseTotal] = useState(0);
    const [libraryBrowseLoading, setLibraryBrowseLoading] = useState(false);
    const [selectedExcludeKeys, setSelectedExcludeKeys] = useState<string[]>([]);
    const [exclusionsSummary, setExclusionsSummary] = useState<{ ratingKeys: any[]; titles: any[]; libraries: any[] }>({ ratingKeys: [], titles: [], libraries: [] });
    const [selectedCalendarDate, setSelectedCalendarDate] = useState<string | null>(null);
    const [storageSummary, setStorageSummary] = useState<any>(null);
    const [storageSummaryLoading, setStorageSummaryLoading] = useState(false);
    const [loading, setLoading] = useState(true);
    const [activeSection, setActiveSection] = useState(() => {
        const hash = window.location.hash.replace('#', '');
        if (hash.startsWith('maintenance-')) {
            const section = hash.replace('maintenance-', '');
            if (section === 'overlays') return 'overview';
            return section;
        }
        return 'overview';
    });

    const addToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
        setToasts(t => pushToast(t, message, type));
    }, []);
    const isMaintenanceDisabledError = useCallback((error: any) => {
        const msg = String(error?.message || '');
        return msg.includes('Maintenance Experimental Mode is disabled');
    }, []);

    const sections = [
        { id: 'overview', label: t('maintenance.sections.overview') },
        { id: 'exclusions', label: t('maintenance.sections.exclusions') },
        { id: 'rules', label: t('maintenance.sections.rules') },
        { id: 'collections', label: t('maintenance.sections.collections') },
        { id: 'candidates', label: t('maintenance.sections.candidates') },
        { id: 'calendar', label: t('maintenance.sections.calendar') },
        { id: 'storage', label: t('maintenance.sections.storage') },
        { id: 'library', label: t('maintenance.sections.library') },
        { id: 'settings', label: t('maintenance.sections.settings') },
        { id: 'runs', label: t('maintenance.sections.logs') }
    ];

    useEffect(() => {
        window.location.hash = `maintenance-${activeSection}`;
    }, [activeSection]);

    useEffect(() => {
        if (activeSection !== 'calendar') {
            setSelectedCalendarDate(null);
        }
    }, [activeSection]);

    const loadOverview = useCallback(async (silent = false) => {
        if (!silent) setLoading(true);
        try {
            const configData = await apiFetch('/api/config');
            const isEnabled = !!configData?.settings?.maintenanceExperimentalEnabled;
            setMaintenanceFeatureEnabled(isEnabled);
            if (!isEnabled) {
                return;
            }
            const [indexData, runsData, previewData, rulesData, prefData] = await Promise.all([
                apiFetch('/api/maintenance/index'),
                apiFetch('/api/maintenance/runs'),
                apiFetch('/api/maintenance/preview', {
                    method: 'POST',
                    body: JSON.stringify({ limit: 30, includeArrDiagnostics: true })
                }),
                apiFetch('/api/maintenance/rules'),
                apiFetch('/api/maintenance/preferences')
            ]);
            setOverview(indexData || null);
            setRuns(Array.isArray(runsData) ? runsData : []);
            setPreviewGroups(Array.isArray(previewData?.previews) ? previewData.previews : []);
            setRules(Array.isArray(rulesData) ? rulesData : []);
            setPreferences(prefData || {
                global: { dryRunByDefault: true, maxActionsPerRun: 25, requireConfirmForDestructive: true },
                exclusions: { ratingKeys: [], titles: [], libraries: [] }
            });
            const previewAll = Array.isArray(previewData?.previews) ? previewData.previews : [];
            const uniqueItems = new Map<string, any>();
            const libraryMap: Record<string, { libraryTitle: string; count: number; reclaimGB: number }> = {};
            const ruleInsights = previewAll.map((preview: any) => {
                const sample = Array.isArray(preview?.sample) ? preview.sample : [];
                let ruleReclaim = 0;
                sample.forEach((item: any) => {
                    if (item?.excluded) return;
                    const ratingKey = String(item?.ratingKey || '');
                    if (ratingKey && !uniqueItems.has(ratingKey)) uniqueItems.set(ratingKey, item);
                    const size = Number(item?.sizeGB || 0);
                    ruleReclaim += size;
                    const libraryTitle = item?.libraryTitle || t('maintenance.labels.unknownLibrary');
                    if (!libraryMap[libraryTitle]) libraryMap[libraryTitle] = { libraryTitle, count: 0, reclaimGB: 0 };
                    libraryMap[libraryTitle].count += 1;
                    libraryMap[libraryTitle].reclaimGB += size;
                });
                return {
                    ruleId: String(preview?.ruleId || ''),
                    ruleName: preview?.ruleName || t('maintenance.labels.unnamedRule'),
                    totalMatches: Number(preview?.remainingCount ?? preview?.totalMatches ?? sample.length ?? 0),
                    reclaimGB: ruleReclaim
                };
            });
            const uniqueValues = Array.from(uniqueItems.values());
            const estimatedReclaimGB = uniqueValues.reduce((sum: number, item: any) => sum + Number(item?.sizeGB || 0), 0);
            const totalMatches = ruleInsights.reduce((sum: number, rule: any) => sum + Number(rule.totalMatches || 0), 0);
            setOverviewInsights({
                totalMatches,
                uniqueMatches: uniqueValues.length,
                estimatedReclaimGB,
                libraries: Object.values(libraryMap).sort((a, b) => b.reclaimGB - a.reclaimGB),
                rules: ruleInsights.sort((a: any, b: any) => b.reclaimGB - a.reclaimGB)
            });
        } catch (e: any) {
            if (isMaintenanceDisabledError(e)) {
                setMaintenanceFeatureEnabled(false);
                return;
            }
            addToast(e.message || t('maintenance.errors.loadOverview'), 'error');
        } finally {
            if (!silent) setLoading(false);
        }
    }, [addToast, isMaintenanceDisabledError, t]);

    useEffect(() => {
        loadOverview();
    }, [loadOverview]);

    useEffect(() => {
        if (!rules.length) {
            setCandidateRuleId('');
            setCandidateItems([]);
            return;
        }
        if (!candidateRuleId || !rules.some((rule: any) => rule.id === candidateRuleId)) {
            setCandidateRuleId(rules[0].id);
        }
    }, [rules, candidateRuleId]);

    const fetchCandidatesForRule = useCallback(async (ruleId: string) => {
        if (!maintenanceFeatureEnabled) {
            setCandidateItems([]);
            return;
        }
        if (!ruleId) {
            setCandidateItems([]);
            return;
        }
        setIsLoadingCandidates(true);
        try {
            const payload = await apiFetch('/api/maintenance/preview', {
                method: 'POST',
                body: JSON.stringify({
                    ruleId,
                    includeAll: true,
                    includeArrDiagnostics: true
                })
            });
            const previews = Array.isArray(payload?.previews) ? payload.previews : [];
            const selected = previews.find((preview: any) => preview.ruleId === ruleId);
            setCandidateItems((selected?.sample || []).map((item: any) => ({ ...item, _ruleId: selected?.ruleId, _ruleName: selected?.ruleName })));
        } catch (e: any) {
            if (isMaintenanceDisabledError(e)) {
                setMaintenanceFeatureEnabled(false);
                return;
            }
            addToast(e.message || t('maintenance.errors.loadCandidates'), 'error');
        } finally {
            setIsLoadingCandidates(false);
        }
    }, [addToast, isMaintenanceDisabledError, maintenanceFeatureEnabled, t]);

    useEffect(() => {
        if (maintenanceFeatureEnabled && (activeSection === 'candidates' || activeSection === 'storage' || activeSection === 'calendar')) {
            fetchCandidatesForRule(candidateRuleId);
        }
    }, [activeSection, candidateRuleId, fetchCandidatesForRule, maintenanceFeatureEnabled]);

    const saveAllRules = async (nextRules: any[]) => {
        await apiFetch('/api/maintenance/rules', { method: 'POST', body: JSON.stringify(nextRules) });
        setRules(nextRules);
    };

    const savePreferences = async (nextPrefs: any) => {
        const response = await apiFetch('/api/maintenance/preferences', { method: 'POST', body: JSON.stringify(nextPrefs) });
        setPreferences(response?.preferences || nextPrefs);
    };

    const loadExclusionsSummary = useCallback(async () => {
        if (!maintenanceFeatureEnabled) return;
        try {
            const payload = await apiFetch('/api/maintenance/exclusions/summary');
            setExclusionsSummary({
                ratingKeys: Array.isArray(payload?.ratingKeys) ? payload.ratingKeys : [],
                titles: Array.isArray(payload?.titles) ? payload.titles : [],
                libraries: Array.isArray(payload?.libraries) ? payload.libraries : []
            });
        } catch (e: any) {
            if (isMaintenanceDisabledError(e)) {
                setMaintenanceFeatureEnabled(false);
                return;
            }
            addToast(e.message || t('maintenance.errors.loadExclusions'), 'error');
        }
    }, [addToast, isMaintenanceDisabledError, maintenanceFeatureEnabled, t]);

    const refreshExclusionsSummaryQuietly = useCallback(() => {
        loadExclusionsSummary().catch(() => { });
    }, [loadExclusionsSummary]);

    const updateRatingKeyExclusions = async (nextKeys: string[]) => {
        const next = {
            ...preferences,
            exclusions: { ...(preferences.exclusions || {}), ratingKeys: nextKeys }
        };
        await savePreferences(next);
        refreshExclusionsSummaryQuietly();
    };

    const loadLibraryBrowse = useCallback(async () => {
        if (!maintenanceFeatureEnabled) return;
        setLibraryBrowseLoading(true);
        try {
            const params = new URLSearchParams({
                libraryId: libraryBrowseId,
                search: libraryBrowseSearch,
                page: String(libraryBrowsePage),
                limit: String(libraryBrowseLimit),
                includeExcluded: 'true'
            });
            const payload = await apiFetch(`/api/maintenance/library-items?${params.toString()}`);
            setLibraryItems(Array.isArray(payload?.items) ? payload.items : []);
            setLibraryOptions(Array.isArray(payload?.libraries) ? payload.libraries : []);
            setLibraryBrowseTotal(Number(payload?.total || 0));
        } catch (e: any) {
            if (isMaintenanceDisabledError(e)) {
                setMaintenanceFeatureEnabled(false);
                return;
            }
            addToast(e.message || t('maintenance.errors.loadLibrary'), 'error');
        } finally {
            setLibraryBrowseLoading(false);
        }
    }, [addToast, isMaintenanceDisabledError, libraryBrowseId, libraryBrowseLimit, libraryBrowsePage, libraryBrowseSearch, maintenanceFeatureEnabled, t]);

    const loadStorageSummary = useCallback(async (ruleId?: string) => {
        if (!maintenanceFeatureEnabled) return;
        setStorageSummaryLoading(true);
        try {
            const query = ruleId ? `?ruleId=${encodeURIComponent(ruleId)}` : '';
            const payload = await apiFetch(`/api/maintenance/storage-summary${query}`);
            setStorageSummary(payload || null);
        } catch (e: any) {
            if (isMaintenanceDisabledError(e)) {
                setMaintenanceFeatureEnabled(false);
                return;
            }
            addToast(e.message || t('maintenance.errors.loadStorage'), 'error');
        } finally {
            setStorageSummaryLoading(false);
        }
    }, [addToast, isMaintenanceDisabledError, maintenanceFeatureEnabled, t]);

    useEffect(() => {
        if (maintenanceFeatureEnabled && activeSection === 'exclusions') {
            loadExclusionsSummary();
        }
    }, [activeSection, loadExclusionsSummary, maintenanceFeatureEnabled]);

    useEffect(() => {
        if (maintenanceFeatureEnabled && activeSection === 'exclusions') {
            loadLibraryBrowse();
        }
    }, [activeSection, libraryBrowseId, libraryBrowsePage, libraryBrowseSearch, loadLibraryBrowse, maintenanceFeatureEnabled]);

    useEffect(() => {
        if (maintenanceFeatureEnabled && activeSection === 'storage') {
            loadStorageSummary(candidateRuleId || undefined);
        }
    }, [activeSection, candidateRuleId, maintenanceFeatureEnabled, loadStorageSummary]);

    const filteredCandidates = candidateItems.filter((item: any) => {
        if (!candidateSearch.trim()) return true;
        const q = candidateSearch.trim().toLowerCase();
        return `${item.title || ''} ${item.libraryTitle || ''}`.toLowerCase().includes(q);
    });
    const selectedCandidateRule = useMemo(
        () => rules.find((rule: any) => rule.id === candidateRuleId) || null,
        [rules, candidateRuleId]
    );

    const excludedRatingKeySet = useMemo(
        () => new Set((preferences?.exclusions?.ratingKeys || []).map((v: string) => String(v))),
        [preferences?.exclusions?.ratingKeys]
    );

    const formatReclaimSizeFromGB = (sizeGB: number) => {
        const safeGB = Math.max(0, Number(sizeGB || 0));
        if (safeGB >= 1024) {
            return `${Math.ceil(safeGB / 1024)} TB`;
        }
        if (safeGB >= 1) {
            return `${Math.ceil(safeGB)} GB`;
        }
        return `${Math.ceil(safeGB * 1024)} MB`;
    };

    const getEligibilityTooltip = (item: any) => {
        const daysUntilEligible = Math.max(0, Number(item?.daysUntilEligible || 0));
        const watchDays = Number(item?.daysSinceLastWatch);
        const addedDays = Number(item?.daysSinceAdded);
        const base = daysUntilEligible > 0
            ? t('maintenance.calendar.notEligibleYet', { count: daysUntilEligible })
            : t('maintenance.calendar.eligibilityNowTooltip');
        if (Number.isFinite(watchDays) && watchDays >= 0) {
            return `${base} ${t('maintenance.calendar.lastWatched', { count: watchDays })}`;
        }
        if (Number.isFinite(addedDays) && addedDays >= 0) {
            return `${base} ${t('maintenance.calendar.addedDaysAgo', { count: addedDays })}`;
        }
        return base;
    };

    const ELIGIBLE_NOW_KEY = 'eligible-now';
    const calendarEligibility = useMemo(() => {
        const graceDays = Math.max(0, Number(selectedCandidateRule?.graceDays || 0));
        const createdAtMs = Date.parse(String(selectedCandidateRule?.createdAt || ''));
        const hasRuleCreatedAt = Number.isFinite(createdAtMs);
        const daysSinceRuleCreated = hasRuleCreatedAt
            ? Math.max(0, Math.floor((Date.now() - createdAtMs) / (24 * 60 * 60 * 1000)))
            : graceDays;
        const daysUntilEligible = Math.max(0, graceDays - daysSinceRuleCreated);
        const nowItems: any[] = [];
        const byDay = new Map<string, any[]>();
        filteredCandidates.forEach((item: any) => {
            if (item?.excluded) return;
            if (daysUntilEligible <= 0) {
                nowItems.push({ ...item, daysUntilEligible: 0, eligibleDate: null });
                return;
            }
            const etaDate = new Date(Date.now() + (daysUntilEligible * 24 * 60 * 60 * 1000));
            const dateKey = etaDate.toISOString().split('T')[0];
            const enriched = { ...item, daysUntilEligible, eligibleDate: dateKey };
            if (!byDay.has(dateKey)) byDay.set(dateKey, []);
            byDay.get(dateKey)?.push(enriched);
        });
        const laterByDay = Array.from(byDay.entries())
            .sort((a, b) => (a[0] < b[0] ? -1 : 1))
            .map(([date, items]) => ({
                date,
                items,
                count: items.length,
                reclaimGB: items.reduce((sum: number, item: any) => sum + Number(item.sizeGB || 0), 0),
                preview: items.slice(0, 4),
                minDaysUntil: Math.min(...items.map((item: any) => Number(item.daysUntilEligible || 0)))
            }));
        return {
            graceDays,
            daysSinceRuleCreated,
            daysUntilEligible,
            eligibleNow: nowItems.sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''))),
            eligibleLaterByDay: laterByDay
        };
    }, [filteredCandidates, selectedCandidateRule?.createdAt, selectedCandidateRule?.graceDays]);

    const selectedCalendarGroup = useMemo(() => {
        if (!selectedCalendarDate) return null;
        if (selectedCalendarDate === ELIGIBLE_NOW_KEY) {
            const items = calendarEligibility.eligibleNow;
            return {
                date: ELIGIBLE_NOW_KEY,
                title: t('maintenance.calendar.eligibleNow'),
                items,
                count: items.length,
                reclaimGB: items.reduce((sum: number, item: any) => sum + Number(item.sizeGB || 0), 0)
            };
        }
        const day = calendarEligibility.eligibleLaterByDay.find((group) => group.date === selectedCalendarDate);
        if (!day) return null;
        return {
            ...day,
            title: new Date(`${day.date}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
        };
    }, [calendarEligibility, selectedCalendarDate, t]);

    const renderScaffoldPage = (title: string, description: string, bullets: string[]) => (
        <div className="glass-card-sm p-5">
            <h3 className="text-xl font-bold text-plex mb-2">{title}</h3>
            <p className="text-sm text-muted mb-4">{description}</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {bullets.map((item) => (
                    <div key={item} className="bg-black/20 border border-border rounded-lg px-3 py-2 text-sm text-text">
                        {item}
                    </div>
                ))}
            </div>
        </div>
    );

    return (
        <div className="w-full flex flex-col">
            <Loader isLoading={loading} />
            <ToastContainer toasts={toasts} setToasts={setToasts} />
            <header className="page-header">
                <h1 className="page-title">{t('maintenance.page.title')}</h1>
            </header>
            <div className="w-full flex flex-col p-0 md:p-8 bg-transparent md:glass-card rounded-none md:rounded-2xl border-0 md:border shadow-none">
                <div className="md:hidden mb-3">
                    <label className="text-[10px] text-muted font-bold uppercase tracking-wider mb-1 block">{t('maintenance.labels.modulePage')}</label>
                    <CustomSelect
                        value={activeSection}
                        onChange={(value) => setActiveSection(value)}
                        compact
                        className="w-full"
                        options={sections.map((section) => ({ label: section.label, value: section.id }))}
                    />
                </div>
                <div className="md:grid md:grid-cols-[280px_minmax(0,1fr)] md:gap-6">
                    <aside className="hidden md:block glass-card-sm p-3 h-fit sticky top-20">
                        <p className="text-muted text-xs uppercase tracking-wider font-bold mb-2 px-2">{t('maintenance.labels.modulePages')}</p>
                        <div className="space-y-1">
                            {sections.map((section) => (
                                <button
                                    key={section.id}
                                    type="button"
                                    onClick={() => setActiveSection(section.id)}
                                    className={`w-full text-left px-3 py-2 rounded-lg text-sm font-semibold transition-colors ${activeSection === section.id ? 'bg-plex text-background' : 'text-muted hover:text-text hover:bg-white/5'}`}
                                >
                                    {section.label}
                                </button>
                            ))}
                        </div>
                    </aside>
                    <div className="overflow-y-auto flex-grow mb-4 custom-scrollbar space-y-4 md:pr-2">
                        {!maintenanceFeatureEnabled && (
                            <div className="glass-card-sm border-yellow-500/30 p-5">
                                <h3 className="text-xl font-bold text-plex mb-2">{t('maintenance.page.disabledTitle')}</h3>
                                <p className="text-sm text-muted mb-3">{t('maintenance.page.disabledDescription')}</p>
                                <p className="text-xs text-muted">{t('maintenance.page.disabledHint')}</p>
                                <button
                                    type="button"
                                    onClick={() => { window.location.href = portalUrl('/settings#cleaner'); }}
                                    className="mt-3 px-3 py-1.5 bg-plex text-background rounded-md text-xs font-semibold hover:bg-plex-hover transition-colors"
                                >
                                    {t('notifications.openSettings')}
                                </button>
                            </div>
                        )}
                        {maintenanceFeatureEnabled && (
                            <>
                                {activeSection === 'overview' && (
                                    <div className="space-y-4">
                                        <div className="glass-card-sm p-5">
                                            <h3 className="text-xl font-bold text-plex mb-2">{t('maintenance.page.controlCenter')}</h3>
                                            <p className="text-sm text-muted mb-4">{t('maintenance.page.controlCenterDescription')}</p>
                                            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                                                <div className="bg-background/30 rounded-lg p-3 border border-white/5">
                                                    <p className="text-xs text-muted">{t('maintenance.labels.indexedMedia')}</p>
                                                    <p className="text-2xl font-bold text-text">{overview?.itemCount || 0}</p>
                                                </div>
                                                <div className="bg-background/30 rounded-lg p-3 border border-white/5">
                                                    <p className="text-xs text-muted">{t('maintenance.labels.requestRecords')}</p>
                                                    <p className="text-2xl font-bold text-text">{overview?.requestItemCount || 0}</p>
                                                </div>
                                                <div className="bg-background/30 rounded-lg p-3 border border-white/5">
                                                    <p className="text-xs text-muted">{t('maintenance.overview.rulesWithMatches')}</p>
                                                    <p className="text-2xl font-bold text-text">{previewGroups.filter((p: any) => (p.totalMatches || 0) > 0).length}</p>
                                                </div>
                                                <div className="bg-background/30 rounded-lg p-3 border border-white/5">
                                                    <p className="text-xs text-muted">{t('maintenance.overview.totalRuns')}</p>
                                                    <p className="text-2xl font-bold text-text">{runs.length}</p>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="glass-card-sm p-5 space-y-4">
                                            <h4 className="font-bold text-text">{t('maintenance.overview.reclaimImpact')}</h4>
                                            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                                                <div className="bg-background/30 rounded-lg p-3 border border-white/5">
                                                    <p className="text-xs text-muted">{t('maintenance.overview.totalMatched')}</p>
                                                    <p className="text-2xl font-bold text-text">{overviewInsights.totalMatches}</p>
                                                </div>
                                                <div className="bg-background/30 rounded-lg p-3 border border-white/5">
                                                    <p className="text-xs text-muted">{t('maintenance.overview.uniqueCandidates')}</p>
                                                    <p className="text-2xl font-bold text-text">{overviewInsights.uniqueMatches}</p>
                                                </div>
                                                <div className="bg-background/30 rounded-lg p-3 border border-white/5">
                                                    <p className="text-xs text-muted">{t('maintenance.overview.estimatedReclaim')}</p>
                                                    <p className="text-2xl font-bold text-text">{formatReclaimSizeFromGB(overviewInsights.estimatedReclaimGB)}</p>
                                                </div>
                                                <div className="bg-background/30 rounded-lg p-3 border border-white/5">
                                                    <p className="text-xs text-muted">{t('maintenance.labels.topImpactLibrary')}</p>
                                                    <p className="text-sm font-bold text-text line-clamp-2">{overviewInsights.libraries[0]?.libraryTitle || '—'}</p>
                                                    <p className="text-xs text-muted mt-1">{overviewInsights.libraries[0] ? formatReclaimSizeFromGB(overviewInsights.libraries[0].reclaimGB) : t('maintenance.labels.noData')}</p>
                                                </div>
                                            </div>
                                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                                                <div className="bg-background/30 rounded-lg p-3 border border-white/5">
                                                    <p className="text-xs text-muted font-bold uppercase tracking-wider mb-2">{t('maintenance.overview.topLibraries')}</p>
                                                    <div className="space-y-1.5 max-h-52 overflow-y-auto custom-scrollbar pr-1">
                                                        {overviewInsights.libraries.slice(0, 8).map((lib) => (
                                                            <div key={`overview-lib-${lib.libraryTitle}`} className="flex items-center justify-between text-xs bg-background/30 border border-white/5 rounded px-2 py-1.5">
                                                                <span className="text-text line-clamp-1">{lib.libraryTitle}</span>
                                                                <span className="text-muted ml-2 whitespace-nowrap">{formatReclaimSizeFromGB(lib.reclaimGB)} · {lib.count}</span>
                                                            </div>
                                                        ))}
                                                        {!overviewInsights.libraries.length && <p className="text-xs text-muted">{t('maintenance.candidates.noResults')}</p>}
                                                    </div>
                                                </div>
                                                <div className="bg-background/30 rounded-lg p-3 border border-white/5">
                                                    <p className="text-xs text-muted font-bold uppercase tracking-wider mb-2">{t('maintenance.overview.topRules')}</p>
                                                    <div className="space-y-1.5 max-h-52 overflow-y-auto custom-scrollbar pr-1">
                                                        {overviewInsights.rules.slice(0, 8).map((rule) => (
                                                            <div key={`overview-rule-${rule.ruleId}`} className="flex items-center justify-between text-xs bg-background/30 border border-white/5 rounded px-2 py-1.5">
                                                                <span className="text-text line-clamp-1">{rule.ruleName}</span>
                                                                <span className="text-muted ml-2 whitespace-nowrap">{formatReclaimSizeFromGB(rule.reclaimGB)} · {rule.totalMatches}</span>
                                                            </div>
                                                        ))}
                                                        {!overviewInsights.rules.length && <p className="text-xs text-muted">{t('maintenance.candidates.noRules')}</p>}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}
                                {activeSection === 'rules' && <LibraryMaintenancePanel addToast={addToast} onRulesUpdated={() => loadOverview(true)} />}
                                {activeSection === 'collections' && (
                                    <div className="glass-card-sm p-5 space-y-3">
                                        <h3 className="text-xl font-bold text-plex">{t('maintenance.collections.title')}</h3>
                                        <p className="text-sm text-muted">{t('maintenance.collections.description')}</p>
                                        <div className="space-y-2">
                                            {rules.map((rule: any) => (
                                                <div key={`collection-${rule.id}`} className="bg-background/30 border border-white/5 rounded-lg p-3">
                                                    <div className="flex items-center justify-between gap-3">
                                                        <p className="font-semibold text-text text-sm">{rule.name || t('maintenance.labels.unnamedRule')}</p>
                                                        <label className="text-xs text-muted flex items-center gap-2">
                                                            <input
                                                                type="checkbox"
                                                                checked={rule?.collection?.enabled !== false}
                                                                onChange={async (e) => {
                                                                    const next = rules.map((r: any) => r.id === rule.id ? { ...r, collection: { ...(r.collection || {}), enabled: e.target.checked } } : r);
                                                                    setRules(next);
                                                                    await saveAllRules(next);
                                                            addToast(t('maintenance.collections.settingsUpdated'));
                                                                }}
                                                            />
                                                            {t('maintenance.collections.enabled')}
                                                        </label>
                                                    </div>
                                                    <input
                                                        className="appearance-none text-[16px] leading-5 mt-2 w-full p-2 rounded border border-border bg-card text-text text-[16px]"
                                                        value={rule?.collection?.nameTemplate || 'Leaving Soon - {{ruleName}}'}
                                                        onChange={(e) => {
                                                            const next = rules.map((r: any) => r.id === rule.id ? { ...r, collection: { ...(r.collection || {}), nameTemplate: e.target.value } } : r);
                                                            setRules(next);
                                                        }}
                                                        onBlur={async (e) => {
                                                            const next = rules.map((r: any) => r.id === rule.id
                                                                ? { ...r, collection: { ...(r.collection || {}), nameTemplate: e.target.value } }
                                                                : r);
                                                            setRules(next);
                                                            await saveAllRules(next);
                                                            addToast(t('maintenance.collections.templateSaved'));
                                                        }}
                                                    />
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                                {activeSection === 'candidates' && (
                                    <div className="glass-card-sm p-3 md:p-5 space-y-3">
                                        <div className="flex flex-wrap items-center justify-between gap-3">
                                            <h3 className="text-xl font-bold text-plex">{t('maintenance.candidates.title')}</h3>
                                            <div className="flex items-center gap-2">
                                                <input
                                                    className="appearance-none text-[16px] leading-5 p-2 rounded border border-border bg-card text-text text-[16px]"
                                                    placeholder={t('maintenance.candidates.searchPlaceholder')}
                                                    value={candidateSearch}
                                                    onChange={(e) => setCandidateSearch(e.target.value)}
                                                />
                                            </div>
                                        </div>
                                        <div className="flex flex-wrap gap-2">
                                            {rules.map((rule: any) => (
                                                <button
                                                    key={`candidate-rule-tab-${rule.id}`}
                                                    type="button"
                                                    onClick={() => setCandidateRuleId(rule.id)}
                                                    className={`px-3 py-1.5 text-xs font-semibold rounded-md border transition-colors ${candidateRuleId === rule.id ? 'bg-plex text-background border-plex' : 'bg-background/30 text-text border-white/5 hover:border-plex/40'}`}
                                                >
                                                    {rule.name || t('maintenance.labels.unnamedRule')}
                                                </button>
                                            ))}
                                            {!rules.length && <p className="text-sm text-muted">{t('maintenance.candidates.noRules')}</p>}
                                        </div>
                                        {selectedCandidateRule && (
                                            <p className="text-xs text-muted">
                                                {t('maintenance.candidates.showing', { name: selectedCandidateRule.name || t('maintenance.labels.unnamedRule') })}
                                            </p>
                                        )}
                                        {isLoadingCandidates ? <p className="text-sm text-muted">{t('maintenance.candidates.loading')}</p> : (
                                            <div className="grid grid-cols-3 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-7 gap-2 md:gap-3 max-h-[620px] overflow-y-auto custom-scrollbar pr-1">
                                                {filteredCandidates.map((item: any) => (
                                                    <div key={`candidate-${item._ruleId || candidateRuleId}-${item.ratingKey}`} className={`bg-background/30 border rounded-lg overflow-hidden ${item.excluded ? 'border-red-500/50 opacity-70' : 'border-white/5'}`}>
                                                        <div className="aspect-[2/3] bg-black/40 relative">
                                                            {item.thumb ? (
                                                                <img src={portalUrl(`/api/plex/image?path=${encodeURIComponent(item.thumb)}&width=220&height=330`)} alt={item.title} loading="lazy" className="w-full h-full object-cover" />
                                                            ) : (
                                                                <div className="w-full h-full flex items-center justify-center text-xs text-muted">{t('maintenance.labels.noPoster')}</div>
                                                            )}
                                                            {item.excluded ? (
                                                                <span className="absolute top-2 right-2 text-[10px] px-1.5 py-0.5 rounded bg-red-600/95 text-white font-bold">
                                                                    {t('maintenance.exclusions.excluded')}
                                                                </span>
                                                            ) : null}
                                                        </div>
                                                        <div className="p-2">
                                                            <p className="text-xs text-text line-clamp-2">{item.title}</p>
                                                            <p className="text-[11px] text-muted mt-1">{item.libraryTitle || t('maintenance.labels.unknownLibrary')}</p>
                                                            <div className="flex flex-wrap gap-1 mt-1">
                                                                {item.arrResolvable ? (
                                                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/15 text-green-300">
                                                                        {item.arrInstanceName || item.arrType || 'ARR'}
                                                                    </span>
                                                                ) : item.excluded ? null : (
                                                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-300">{t('maintenance.labels.unmapped')}</span>
                                                                )}
                                                                {item.arrAmbiguous && (
                                                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300">{t('maintenance.labels.ambiguous')}</span>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))}
                                                {!filteredCandidates.length && <p className="text-sm text-muted col-span-full">{t('maintenance.candidates.noResults')}</p>}
                                            </div>
                                        )}
                                    </div>
                                )}
                                {activeSection === 'runs' && (
                                    <div className="glass-card-sm p-5 space-y-3">
                                        <h3 className="text-xl font-bold text-plex">{t('maintenance.runs.title')}</h3>
                                        <div className="space-y-2 max-h-[620px] overflow-y-auto custom-scrollbar pr-1">
                                            {runs.map((run: any) => (
                                                <details key={`run-${run.id}`} className="bg-background/30 border border-white/5 rounded-lg p-3">
                                                    <summary className="cursor-pointer list-none">
                                                        <div className="flex items-center justify-between gap-3">
                                                            <div>
                                                                <p className="text-sm font-semibold text-text">{run.ruleName}</p>
                                                                <p className="text-xs text-muted">{new Date(run.startedAt).toLocaleString()} · {run.dryRun ? t('maintenance.runs.dryRun') : t('maintenance.runs.destructive')}</p>
                                                            </div>
                                                            <span className="text-[11px] px-2 py-1 rounded bg-border text-muted">{run.status}</span>
                                                        </div>
                                                    </summary>
                                                    <div className="mt-3 text-xs text-muted">
                                                        {t('maintenance.runs.summary', { matched: run.totals?.matched || 0, processed: run.totals?.processed || 0, deleted: run.totals?.deleted || 0, skipped: run.totals?.skipped || 0, failed: run.totals?.failed || 0 })}
                                                    </div>
                                                    {Array.isArray(run.preflight?.warnings) && run.preflight.warnings.length > 0 && (
                                                        <div className="mt-2 text-xs text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded px-2 py-1">
                                                            {run.preflight.warnings.join(' ')}
                                                        </div>
                                                    )}
                                                    <div className="mt-2 max-h-52 overflow-y-auto custom-scrollbar pr-1 space-y-1">
                                                        {(run.outcomes || []).slice(0, 120).map((outcome: any, idx: number) => (
                                                            <div key={`outcome-${run.id}-${idx}`} className="text-xs bg-background/30 border border-white/5 rounded px-2 py-1">
                                                                {(outcome.title || outcome.type || 'Item')} · {outcome.status || (outcome.success ? 'success' : 'info')}
                                                                {outcome.arrInstanceName ? ` · ${outcome.arrInstanceName}` : ''}
                                                                {outcome.reason ? ` · ${outcome.reason}` : ''}
                                                                {outcome.arrWarning ? ` · ${outcome.arrWarning}` : ''}
                                                            </div>
                                                        ))}
                                                    </div>
                                                </details>
                                            ))}
                                            {!runs.length && <p className="text-sm text-muted">{t('maintenance.runs.noRuns')}</p>}
                                        </div>
                                    </div>
                                )}
                                {activeSection === 'calendar' && (
                                    <div className="glass-card-sm p-5 space-y-3">
                                        <h3 className="text-xl font-bold text-plex">{t('maintenance.calendar.title')}</h3>
                                        <p className="text-sm text-muted">{t('maintenance.calendar.description')}</p>
                                        <div className="flex flex-wrap gap-2">
                                            {rules.map((rule: any) => (
                                                <button
                                                    key={`calendar-rule-tab-${rule.id}`}
                                                    type="button"
                                                    onClick={() => setCandidateRuleId(rule.id)}
                                                    className={`px-3 py-1.5 text-xs font-semibold rounded-md border transition-colors ${candidateRuleId === rule.id ? 'bg-plex text-background border-plex' : 'bg-background/30 text-text border-white/5 hover:border-plex/40'}`}
                                                >
                                                    {rule.name || t('maintenance.labels.unnamedRule')}
                                                </button>
                                            ))}
                                        </div>
                                        {selectedCandidateRule && (
                                            <p className="text-xs text-muted">
                                                {t('maintenance.calendar.currentRule')} <span className="text-text font-semibold">{selectedCandidateRule.name || t('maintenance.labels.unnamedRule')}</span> · {t('maintenance.calendar.graceDays')}: <span className="text-text font-semibold">{calendarEligibility.graceDays}</span> · {t('maintenance.calendar.ruleAge')}: <span className="text-text font-semibold">{calendarEligibility.daysSinceRuleCreated}</span> {t('maintenance.calendar.titleCount')}
                                            </p>
                                        )}
                                        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                                            <button
                                                type="button"
                                                onClick={() => setSelectedCalendarDate(ELIGIBLE_NOW_KEY)}
                                                className="text-left bg-background/30 border border-white/5 rounded-lg p-3 hover:border-plex/50 transition-colors"
                                                title={t('maintenance.calendar.eligibilityNowTooltip')}
                                            >
                                                <p className="text-xs text-muted">{t('maintenance.calendar.eligibleNow')}</p>
                                                <p className="text-2xl font-bold text-text mt-1">{calendarEligibility.eligibleNow.length}</p>
                                                <p className="text-[11px] text-muted mt-1">{t('maintenance.calendar.reclaimNow', { value: formatReclaimSizeFromGB(calendarEligibility.eligibleNow.reduce((sum: number, item: any) => sum + Number(item.sizeGB || 0), 0)) })}</p>
                                            </button>
                                            <div className="bg-background/30 border border-white/5 rounded-lg p-3" title={t('maintenance.calendar.futureDatesTooltip')}>
                                                <p className="text-xs text-muted">{t('maintenance.calendar.eligibleLaterDays')}</p>
                                                <p className="text-2xl font-bold text-text mt-1">{calendarEligibility.eligibleLaterByDay.length}</p>
                                            </div>
                                            <div className="bg-background/30 border border-white/5 rounded-lg p-3" title={t('maintenance.calendar.waitingTooltip')}>
                                                <p className="text-xs text-muted">{t('maintenance.calendar.laterTitles')}</p>
                                                <p className="text-2xl font-bold text-text mt-1">{calendarEligibility.eligibleLaterByDay.reduce((sum: number, day: any) => sum + Number(day.count || 0), 0)}</p>
                                            </div>
                                            <div className="bg-background/30 border border-white/5 rounded-lg p-3" title={t('maintenance.calendar.delayedReclaimTooltip')}>
                                                <p className="text-xs text-muted">{t('maintenance.calendar.laterReclaim')}</p>
                                                <p className="text-2xl font-bold text-text mt-1">{formatReclaimSizeFromGB(calendarEligibility.eligibleLaterByDay.reduce((sum: number, day: any) => sum + Number(day.reclaimGB || 0), 0))}</p>
                                            </div>
                                        </div>
                                        <div className="space-y-2">
                                            <p className="text-xs uppercase tracking-wider text-muted font-bold" title={t('maintenance.calendar.datesTooltip')}>{t('maintenance.calendar.eligibleLaterByDate')}</p>
                                        </div>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 max-h-[700px] overflow-y-auto custom-scrollbar pr-1">
                                            {calendarEligibility.eligibleLaterByDay.slice(0, 120).map((day) => {
                                                const dateLabel = new Date(`${day.date}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
                                                return (
                                                    <button
                                                        key={`calendar-day-${day.date}`}
                                                        type="button"
                                                        onClick={() => setSelectedCalendarDate(day.date)}
                                                        className="text-left bg-background/30 border border-white/5 rounded-lg p-3 hover:border-plex/50 hover:bg-black/30 transition-colors"
                                                    >
                                                        <div className="flex items-center justify-between gap-2">
                                                            <p className="text-sm font-semibold text-text">{dateLabel}</p>
                                                            <span className="text-[11px] px-2 py-0.5 rounded bg-plex/20 text-plex font-semibold" title={t('maintenance.calendar.dateTitleCount')}>{day.count}</span>
                                                        </div>
                                                        <p className="text-[11px] text-muted mt-1">{day.minDaysUntil} {t('maintenance.calendar.daysUntilEligible')} · {formatReclaimSizeFromGB(day.reclaimGB)} {t('maintenance.labels.reclaim')}</p>
                                                        <div className="mt-2 flex -space-x-2">
                                                            {day.preview.map((item: any, idx: number) => (
                                                                <div key={`calendar-preview-${day.date}-${item.ratingKey}-${idx}`} className="w-8 h-8 rounded-full overflow-hidden border border-white/5 bg-black/50" title={`${item.title || t('maintenance.labels.unknownTitle')} • ${getEligibilityTooltip(item)}`}>
                                                                    {item.thumb ? (
                                                                        <img
                                                                            src={portalUrl(`/api/plex/image?path=${encodeURIComponent(item.thumb)}&width=64&height=64`)}
                                                                            alt={item.title}
                                                                            className="w-full h-full object-cover"
                                                                            loading="lazy"
                                                                        />
                                                                    ) : (
                                                                        <div className="w-full h-full" />
                                                                    )}
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </button>
                                                );
                                            })}
                                            {!calendarEligibility.eligibleLaterByDay.length && <p className="text-sm text-muted col-span-full">{t('maintenance.calendar.noDelayedDates')}</p>}
                                        </div>
                                    </div>
                                )}
                                {activeSection === 'calendar' && selectedCalendarGroup && (
                                    <div className="fixed inset-0 z-[1500] bg-black/70 backdrop-blur-[1px] flex items-center justify-center p-3 md:p-6" onClick={() => setSelectedCalendarDate(null)}>
                                        <div className="w-full max-w-6xl max-h-[86vh] bg-card/80 backdrop-blur-md border border-white/5 rounded-xl shadow-2xl p-4 md:p-5 overflow-y-auto custom-scrollbar" onClick={(e) => e.stopPropagation()}>
                                            <div className="flex items-start justify-between gap-3 mb-3">
                                                <div>
                                                    <h4 className="text-xl font-bold text-plex">
                                                        {selectedCalendarGroup.title || new Date(`${selectedCalendarGroup.date}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                                                    </h4>
                                                    <p className="text-sm text-muted mt-1" title={selectedCalendarGroup.date === ELIGIBLE_NOW_KEY ? t('maintenance.calendar.nowDetail') : t('maintenance.calendar.laterDetail')}>
                                                        {selectedCalendarGroup.count} {t('maintenance.calendar.titleCount')} · {formatReclaimSizeFromGB(selectedCalendarGroup.reclaimGB)} {t('maintenance.labels.reclaim')}
                                                    </p>
                                                </div>
                                                <button
                                                    type="button"
                                                    className="px-3 py-1.5 bg-border text-text rounded-md text-sm font-semibold hover:bg-opacity-80"
                                                    onClick={() => setSelectedCalendarDate(null)}
                                                >
                                                    {t('maintenance.labels.close')}
                                                </button>
                                            </div>
                                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-7 gap-3">
                                                {selectedCalendarGroup.items.map((item: any, idx: number) => (
                                                    <div key={`calendar-modal-item-${selectedCalendarGroup.date}-${item.ratingKey}-${idx}`} className="bg-background/30 border border-white/5 rounded-lg overflow-hidden" title={getEligibilityTooltip(item)}>
                                                        <div className="aspect-[2/3] bg-black/40">
                                                            {item.thumb ? (
                                                                <img
                                                                    src={portalUrl(`/api/plex/image?path=${encodeURIComponent(item.thumb)}&width=240&height=360`)}
                                                                    alt={item.title}
                                                                    loading="lazy"
                                                                    className="w-full h-full object-cover"
                                                                />
                                                            ) : (
                                                                <div className="w-full h-full flex items-center justify-center text-xs text-muted">{t('maintenance.labels.noPoster')}</div>
                                                            )}
                                                        </div>
                                                        <div className="p-2">
                                                            <p className="text-xs text-text line-clamp-2">{item.title}</p>
                                                            <p className="text-[11px] text-muted mt-1">{item.libraryTitle || t('maintenance.labels.unknownLibrary')}</p>
                                                            <p className="text-[11px] text-muted mt-1" title={t('maintenance.calendar.eligibilityDetailTooltip')}>
                                                                {t('maintenance.calendar.lastWatch')} {Number.isFinite(Number(item.daysSinceLastWatch)) ? `${Number(item.daysSinceLastWatch)}${t('maintenance.calendar.ago')}` : t('maintenance.calendar.notAvailable')} · {t('maintenance.calendar.added')} {Number.isFinite(Number(item.daysSinceAdded)) ? `${Number(item.daysSinceAdded)}${t('maintenance.calendar.ago')}` : t('maintenance.calendar.notAvailable')}
                                                            </p>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                )}
                                {activeSection === 'storage' && (
                                    <div className="glass-card-sm p-5 space-y-4">
                                        <h3 className="text-xl font-bold text-plex">{t('maintenance.storage.title')}</h3>
                                        <p className="text-sm text-muted">{t('maintenance.storage.description')}</p>
                                        <div className="flex items-center gap-2">
                                            <button
                                                type="button"
                                                className="px-3 py-1.5 bg-border text-text rounded-md text-xs font-semibold hover:bg-opacity-80"
                                                onClick={() => loadStorageSummary(candidateRuleId || undefined)}
                                            >
                                                {storageSummaryLoading ? t('maintenance.storage.refreshing') : t('maintenance.storage.refreshSummary')}
                                            </button>
                                            {selectedCandidateRule && (
                                                <p className="text-xs text-muted">{t('maintenance.storage.ruleScope')} <span className="text-text font-semibold">{selectedCandidateRule.name || t('maintenance.labels.unnamedRule')}</span></p>
                                            )}
                                        </div>
                                        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                                            <div className="bg-background/30 border border-white/5 rounded-lg p-3">
                                                <p className="text-xs text-muted">{t('maintenance.storage.librarySizeBefore')}</p>
                                                <p className="text-2xl font-bold text-text">{formatReclaimSizeFromGB(Number(storageSummary?.totals?.beforeGB || 0))}</p>
                                            </div>
                                            <div className="bg-background/30 border border-white/5 rounded-lg p-3">
                                                <p className="text-xs text-muted">{t('maintenance.storage.projectedReclaim')}</p>
                                                <p className="text-2xl font-bold text-text">{formatReclaimSizeFromGB(Number(storageSummary?.totals?.reclaimGB || 0))}</p>
                                            </div>
                                            <div className="bg-background/30 border border-white/5 rounded-lg p-3">
                                                <p className="text-xs text-muted">{t('maintenance.storage.projectedSizeAfter')}</p>
                                                <p className="text-2xl font-bold text-text">{formatReclaimSizeFromGB(Number(storageSummary?.totals?.afterGB || 0))}</p>
                                            </div>
                                            <div className="bg-background/30 border border-white/5 rounded-lg p-3">
                                                <p className="text-xs text-muted">{t('maintenance.storage.reclaimPercent')}</p>
                                                <p className="text-2xl font-bold text-text">{Number(storageSummary?.totals?.reclaimPercent || 0).toFixed(1)}%</p>
                                            </div>
                                        </div>
                                        <div className="bg-background/30 border border-white/5 rounded-lg p-3">
                                            <div className="grid grid-cols-[minmax(0,2fr)_1fr_1fr_1fr_1fr] gap-2 px-2 py-1 text-[11px] uppercase tracking-wider text-muted font-bold border-b border-border">
                                                <span>{t('maintenance.labels.library')}</span>
                                                <span className="text-right">{t('maintenance.labels.before')}</span>
                                                <span className="text-right">{t('maintenance.labels.reclaim')}</span>
                                                <span className="text-right">{t('maintenance.labels.after')}</span>
                                                <span className="text-right">{t('maintenance.labels.matched')}</span>
                                            </div>
                                            <div className="max-h-[420px] overflow-y-auto custom-scrollbar pr-1 space-y-1 mt-2">
                                                {(storageSummary?.libraries || []).map((row: any) => (
                                                    <div key={`storage-row-${row.libraryTitle}`} className="grid grid-cols-[minmax(0,2fr)_1fr_1fr_1fr_1fr] gap-2 px-2 py-2 text-sm bg-background/30 border border-white/5 rounded-lg items-center">
                                                        <span className="text-text line-clamp-1">{row.libraryTitle}</span>
                                                        <span className="text-muted text-right">{formatReclaimSizeFromGB(Number(row.totalSizeGB || 0))}</span>
                                                        <span className="text-right text-plex font-semibold">{formatReclaimSizeFromGB(Number(row.reclaimGB || 0))}</span>
                                                        <span className="text-muted text-right">{formatReclaimSizeFromGB(Number(row.afterSizeGB || 0))}</span>
                                                        <span className="text-muted text-right">{row.matchedItems || 0}</span>
                                                    </div>
                                                ))}
                                                {!storageSummaryLoading && !(storageSummary?.libraries || []).length && (
                                                    <p className="text-sm text-muted px-2 py-2">{t('maintenance.storage.noSummary')}</p>
                                                )}
                                                {storageSummaryLoading && <p className="text-sm text-muted px-2 py-2">{t('maintenance.storage.loading')}</p>}
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                            <div className="bg-background/30 border border-white/5 rounded-lg p-3">
                                                <p className="text-xs text-muted">Total Indexed Items</p>
                                                <p className="text-xl font-bold text-text">{Number(storageSummary?.totals?.items || 0)}</p>
                                            </div>
                                            <div className="bg-background/30 border border-white/5 rounded-lg p-3">
                                                <p className="text-xs text-muted">{t('maintenance.storage.matchedItems')}</p>
                                                <p className="text-xl font-bold text-text">{Number(storageSummary?.totals?.matchedItems || 0)}</p>
                                            </div>
                                            <div className="bg-background/30 border border-white/5 rounded-lg p-3">
                                                <p className="text-xs text-muted">Libraries Covered</p>
                                                <p className="text-xl font-bold text-text">{Number(storageSummary?.totals?.libraries || 0)}</p>
                                            </div>
                                        </div>
                                        {storageSummary?.rulesConsidered?.length > 0 && (
                                            <div className="bg-background/30 border border-white/5 rounded-lg p-3">
                                                <p className="text-xs text-muted font-bold uppercase tracking-wider mb-2">{t('maintenance.storage.rulesIncluded')}</p>
                                                <div className="flex flex-wrap gap-1.5">
                                                    {storageSummary.rulesConsidered.map((rule: any) => (
                                                        <span key={`storage-rule-${rule.id}`} className="px-2 py-1 rounded bg-border text-xs text-text">{rule.name || t('maintenance.labels.unnamedRule')}</span>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}
                                {activeSection === 'library' && (
                                    <div className="glass-card-sm p-5 space-y-3">
                                        <h3 className="text-xl font-bold text-plex">{t('maintenance.library.title')}</h3>
                                        <div className="flex flex-wrap gap-2">
                                            <button
                                                type="button"
                                                className="px-3 py-2 bg-border text-text rounded-md text-sm font-semibold"
                                                onClick={() => {
                                                    const blob = new Blob([JSON.stringify(rules, null, 2)], { type: 'application/json' });
                                                    const url = URL.createObjectURL(blob);
                                                    const a = document.createElement('a');
                                                    a.href = url;
                                                    a.download = `maintenance-rules-${Date.now()}.json`;
                                                    a.click();
                                                    URL.revokeObjectURL(url);
                                                    addToast(t('maintenance.library.exportDownloaded'));
                                                }}
                                            >
                                                {t('maintenance.library.export')}
                                            </button>
                                            <button
                                                type="button"
                                                className="px-3 py-2 bg-plex text-background rounded-md text-sm font-semibold"
                                                onClick={async () => {
                                                    try {
                                                        const parsed = JSON.parse(libraryJsonInput || '[]');
                                                        if (!Array.isArray(parsed)) throw new Error(t('maintenance.library.arrayRequired'));
                                                        await saveAllRules(parsed);
                                                        addToast(t('maintenance.library.importSaved'));
                                                    } catch (e: any) {
                                                        addToast(e.message || t('maintenance.library.invalidJson'), 'error');
                                                    }
                                                }}
                                            >
                                                {t('maintenance.library.import')}
                                            </button>
                                        </div>
                                        <textarea
                                            className="appearance-none text-[16px] leading-5 w-full min-h-[240px] p-3 rounded-lg border border-border bg-card text-text text-[16px] font-mono"
                                            placeholder={t('maintenance.library.placeholder')}
                                            value={libraryJsonInput}
                                            onChange={(e) => setLibraryJsonInput(e.target.value)}
                                        />
                                    </div>
                                )}
                                {activeSection === 'exclusions' && (
                                    <div className="glass-card-sm p-4 md:p-5 space-y-3">
                                        <h3 className="text-xl font-bold text-plex">{t('maintenance.exclusions.title')}</h3>
                                        <p className="text-sm text-muted">{t('maintenance.exclusions.description')}</p>
                                        <div className="bg-background/30 border border-white/5 rounded-lg p-3 md:p-4 space-y-2.5">
                                            <div className="min-w-0 md:w-[220px] h-9">
                                                <CustomSelect
                                                    value={libraryBrowseId}
                                                    onChange={(value) => {
                                                        setLibraryBrowseId(value);
                                                        setLibraryBrowsePage(1);
                                                    }}
                                                    options={[
                                                        { label: t('maintenance.exclusions.allLibraries'), value: 'all' },
                                                        ...libraryOptions.map((library) => ({
                                                            label: `${library.title} (${library.count})`,
                                                            value: library.id
                                                        }))
                                                    ]}
                                                />
                                            </div>
                                            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 items-center mt-1">
                                                <input
                                                    className="appearance-none text-[16px] leading-5 h-9 px-2.5 rounded border border-border bg-card text-text text-[16px] min-w-0"
                                                    placeholder={t('maintenance.exclusions.searchPlaceholder')}
                                                    value={libraryBrowseSearch}
                                                    onChange={(e) => {
                                                        setLibraryBrowseSearch(e.target.value);
                                                        setLibraryBrowsePage(1);
                                                    }}
                                                />
                                                <button type="button" className="h-9 px-3 bg-border text-text rounded-md text-xs md:text-sm font-semibold whitespace-nowrap" onClick={loadLibraryBrowse}>{t('maintenance.exclusions.refresh')}</button>
                                            </div>
                                            <div className="grid grid-cols-[minmax(0,1fr)_auto] md:flex md:flex-wrap items-center gap-2">
                                                <button
                                                    type="button"
                                                    className="h-9 px-3 bg-border text-text rounded-md text-xs md:text-sm font-semibold whitespace-nowrap"
                                                    onClick={() => setSelectedExcludeKeys(libraryItems.map((item: any) => String(item.ratingKey || '')).filter(Boolean))}
                                                    disabled={!libraryItems.length}
                                                >
                                                    {t('maintenance.exclusions.selectPage')}
                                                </button>
                                                <button
                                                    type="button"
                                                    className="h-9 px-3 bg-plex text-background rounded-md text-xs md:text-sm font-semibold whitespace-nowrap"
                                                    onClick={async () => {
                                                        if (!selectedExcludeKeys.length) {
                                                            addToast(t('maintenance.exclusions.selectToExclude'), 'error');
                                                            return;
                                                        }
                                                        const merged = Array.from(new Set([...(preferences?.exclusions?.ratingKeys || []).map((v: string) => String(v)), ...selectedExcludeKeys]));
                                                        await updateRatingKeyExclusions(merged);
                                                        setSelectedExcludeKeys([]);
                                                        addToast(t('maintenance.exclusions.excludedSelected', { count: selectedExcludeKeys.length }));
                                                    }}
                                                >
                                                    {t('maintenance.exclusions.excludeSelected', { count: selectedExcludeKeys.length })}
                                                </button>
                                                <button
                                                    type="button"
                                                    className="h-9 w-9 flex items-center justify-center bg-red-500/15 border border-red-500/40 text-red-300 rounded-md hover:bg-red-500/25 transition-colors"
                                                    onClick={() => setSelectedExcludeKeys([])}
                                                    title={t('maintenance.exclusions.clearSelection')}
                                                    aria-label={t('maintenance.exclusions.clearSelection')}
                                                >
                                                    <X className="w-3.5 h-3.5 md:w-4 md:h-4" />
                                                </button>
                                                <button
                                                    type="button"
                                                    className="col-span-2 md:col-auto h-9 px-3 bg-border text-text rounded-md text-xs md:text-sm font-semibold whitespace-nowrap"
                                                    onClick={async () => {
                                                        if (!selectedExcludeKeys.length) {
                                                            addToast(t('maintenance.exclusions.selectToUnexclude'), 'error');
                                                            return;
                                                        }
                                                        const removedCount = selectedExcludeKeys.length;
                                                        const remaining = (preferences?.exclusions?.ratingKeys || []).map((v: string) => String(v)).filter((key: string) => !selectedExcludeKeys.includes(key));
                                                        await updateRatingKeyExclusions(remaining);
                                                        setSelectedExcludeKeys([]);
                                                        addToast(t('maintenance.exclusions.removedSelected', { count: removedCount }));
                                                    }}
                                                >
                                                    {t('maintenance.exclusions.removeSelected')}
                                                </button>
                                                <p className="col-span-2 text-[11px] md:text-xs text-muted w-full md:w-auto md:ml-auto md:text-right">{t('maintenance.exclusions.showing', { shown: libraryItems.length, total: libraryBrowseTotal, page: libraryBrowsePage })}</p>
                                            </div>
                                            {libraryBrowseLoading ? (
                                                <p className="text-sm text-muted">{t('maintenance.exclusions.loading')}</p>
                                            ) : (
                                                <div className="grid grid-cols-3 md:grid-cols-5 lg:grid-cols-8 gap-2 md:gap-3 max-h-[1240px] overflow-y-auto custom-scrollbar pr-1">
                                                    {libraryItems.map((item: any) => {
                                                        const key = String(item.ratingKey || '');
                                                        const selected = selectedExcludeKeys.includes(key);
                                                        const excluded = item.excluded || excludedRatingKeySet.has(key);
                                                        const toggleQuickExclude = async (event: React.MouseEvent) => {
                                                            event.preventDefault();
                                                            event.stopPropagation();
                                                            const currentKeys = (preferences?.exclusions?.ratingKeys || []).map((v: string) => String(v));
                                                            const nextKeys = excluded ? currentKeys.filter((v: string) => v !== key) : Array.from(new Set([...currentKeys, key]));
                                                            await updateRatingKeyExclusions(nextKeys);
                                                            addToast(excluded ? t('maintenance.exclusions.removed', { title: item.title }) : t('maintenance.exclusions.excludedTitle', { title: item.title }));
                                                        };
                                                        return (
                                                            <div
                                                                key={`exclude-item-${key}`}
                                                                className={`relative w-full border rounded-lg overflow-hidden transition-all ${selected ? 'border-plex bg-plex/5 shadow-[0_0_0_1px_rgba(229,160,13,0.35)]' : 'border-white/5'} ${excluded ? 'ring-1 ring-red-500/60' : ''}`}
                                                            >
                                                                <button
                                                                    type="button"
                                                                    className="w-full text-left"
                                                                    aria-pressed={selected}
                                                                    onClick={() => {
                                                                        setSelectedExcludeKeys((prev) => prev.includes(key) ? prev.filter((v) => v !== key) : [...prev, key]);
                                                                    }}
                                                                >
                                                                    <div className="aspect-[2/3] bg-black/40 relative">
                                                                        {item.thumb ? (
                                                                            <img src={portalUrl(`/api/plex/image?path=${encodeURIComponent(item.thumb)}&width=220&height=330`)} alt={item.title} loading="lazy" className="w-full h-full object-cover" />
                                                                        ) : (
                                                                        <div className="w-full h-full flex items-center justify-center text-xs text-muted">{t('maintenance.labels.noPoster')}</div>
                                                                        )}
                                                                        {selected && (
                                                                            <>
                                                                                <div className="absolute inset-0 bg-plex/20 pointer-events-none" />
                                                                                <div className="absolute top-2 left-2 w-6 h-6 rounded-full bg-plex text-background flex items-center justify-center shadow-md pointer-events-none">
                                                                                    <Check className="w-3.5 h-3.5" strokeWidth={3} />
                                                                                </div>
                                                                            </>
                                                                        )}
                                                                        {excluded && (
                                                                            <span className="absolute top-2 right-2 text-[10px] px-1.5 py-0.5 rounded bg-red-600/95 text-white font-bold pointer-events-none">
                                                                                {t('maintenance.exclusions.excluded')}
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                    <p className="px-2 pt-2 text-xs text-text line-clamp-2">{item.title}</p>
                                                                </button>
                                                                <div className="px-2 pb-2 pt-1 flex items-center justify-between gap-2 min-h-[2rem]">
                                                                    <p className="text-[11px] text-muted truncate">{item.libraryTitle}</p>
                                                                    <button
                                                                        type="button"
                                                                        className={`text-[10px] font-semibold shrink-0 whitespace-nowrap transition-colors ${excluded ? 'text-muted hover:text-text' : 'text-plex hover:text-plex-hover'}`}
                                                                        onClick={toggleQuickExclude}
                                                                    >
                                                                        {excluded ? t('maintenance.exclusions.unexclude') : t('maintenance.exclusions.exclude')}
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                    {!libraryItems.length && <p className="text-sm text-muted col-span-full">{t('maintenance.exclusions.noTitles')}</p>}
                                                </div>
                                            )}
                                            <div className="flex items-center justify-between">
                                                <button
                                                    type="button"
                                                    className="px-3 py-1.5 bg-border text-text rounded-md text-sm font-semibold disabled:opacity-50"
                                                    disabled={libraryBrowsePage <= 1}
                                                    onClick={() => setLibraryBrowsePage((p) => Math.max(1, p - 1))}
                                                >
                                                    {t('maintenance.labels.previous')}
                                                </button>
                                                <button
                                                    type="button"
                                                    className="px-3 py-1.5 bg-border text-text rounded-md text-sm font-semibold disabled:opacity-50"
                                                    disabled={(libraryBrowsePage * libraryBrowseLimit) >= libraryBrowseTotal}
                                                    onClick={() => setLibraryBrowsePage((p) => p + 1)}
                                                >
                                                    {t('maintenance.labels.next')}
                                                </button>
                                            </div>
                                        </div>
                                        <div className="bg-background/30 border border-white/5 rounded-lg p-3 space-y-3">
                                            <h4 className="text-sm font-bold text-text">{t('maintenance.exclusions.currentResolved')}</h4>
                                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                                <div className="bg-background/30 border border-white/5 rounded-lg p-3 space-y-2">
                                                    <p className="text-xs font-bold text-muted uppercase tracking-wider">{t('maintenance.exclusions.ratingKeyTitles')}</p>
                                                    <div className="space-y-2 max-h-52 overflow-y-auto custom-scrollbar pr-1">
                                                        {exclusionsSummary.ratingKeys.map((entry: any) => (
                                                            <div key={`resolved-key-${entry.ratingKey}`} className="flex items-center gap-2 bg-background/30 border border-white/5 rounded-md p-2">
                                                                <div className="w-10 h-14 rounded overflow-hidden bg-black/40 flex-shrink-0">
                                                                    {entry.thumb ? (
                                                                        <img src={portalUrl(`/api/plex/image?path=${encodeURIComponent(entry.thumb)}&width=80&height=120`)} alt={entry.title} className="w-full h-full object-cover" />
                                                                    ) : (
                                                                        <div className="w-full h-full flex items-center justify-center text-[9px] text-muted">{t('maintenance.labels.noPoster')}</div>
                                                                    )}
                                                                </div>
                                                                <div className="min-w-0">
                                                                    <p className="text-xs text-text line-clamp-2">{entry.title}</p>
                                                                    <p className="text-[10px] text-muted line-clamp-1">{entry.libraryTitle || entry.ratingKey}</p>
                                                                </div>
                                                            </div>
                                                        ))}
                                                        {!exclusionsSummary.ratingKeys.length && <p className="text-xs text-muted">{t('maintenance.exclusions.noRatingKeys')}</p>}
                                                    </div>
                                                </div>
                                                <div className="bg-background/30 border border-white/5 rounded-lg p-3 space-y-2">
                                                    <p className="text-xs font-bold text-muted uppercase tracking-wider">{t('maintenance.exclusions.titleTerms')}</p>
                                                    <div className="space-y-1.5 max-h-52 overflow-y-auto custom-scrollbar pr-1">
                                                        {exclusionsSummary.titles.map((entry: any) => (
                                                            <div key={`resolved-title-${entry.title}`} className="bg-background/30 border border-white/5 rounded-md px-2 py-1.5">
                                                                <p className="text-xs text-text line-clamp-1">{entry.title}</p>
                                                                <p className="text-[10px] text-muted">{entry.matchCount} indexed match(es)</p>
                                                            </div>
                                                        ))}
                                                        {!exclusionsSummary.titles.length && <p className="text-xs text-muted">{t('maintenance.exclusions.noTitleTerms')}</p>}
                                                    </div>
                                                </div>
                                                <div className="bg-background/30 border border-white/5 rounded-lg p-3 space-y-2">
                                                    <p className="text-xs font-bold text-muted uppercase tracking-wider">{t('maintenance.exclusions.libraries')}</p>
                                                    <div className="space-y-1.5 max-h-52 overflow-y-auto custom-scrollbar pr-1">
                                                        {exclusionsSummary.libraries.map((entry: any) => (
                                                            <div key={`resolved-library-${entry.libraryTitle}`} className="bg-background/30 border border-white/5 rounded-md px-2 py-1.5">
                                                                <p className="text-xs text-text line-clamp-1">{entry.libraryTitle}</p>
                                                                <p className="text-[10px] text-muted">{entry.matchCount} indexed item(s)</p>
                                                            </div>
                                                        ))}
                                                        {!exclusionsSummary.libraries.length && <p className="text-xs text-muted">{t('maintenance.exclusions.noLibraries')}</p>}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                            <div>
                                                <label className="text-xs text-muted font-bold uppercase">{t('maintenance.exclusions.advancedTitle')}</label>
                                                <textarea
                                                    className="appearance-none text-[16px] leading-5 w-full min-h-[180px] p-3 rounded-lg border border-border bg-card text-text text-[16px]"
                                                    value={(preferences?.exclusions?.titles || []).join('\n')}
                                                    onChange={(e) => setPreferences((prev: any) => ({ ...prev, exclusions: { ...(prev.exclusions || {}), titles: e.target.value.split('\n').map(v => v.trim()).filter(Boolean) } }))}
                                                />
                                            </div>
                                            <div>
                                                <label className="text-xs text-muted font-bold uppercase">{t('maintenance.exclusions.advancedLibrary')}</label>
                                                <textarea
                                                    className="appearance-none text-[16px] leading-5 w-full min-h-[180px] p-3 rounded-lg border border-border bg-card text-text text-[16px]"
                                                    value={(preferences?.exclusions?.libraries || []).join('\n')}
                                                    onChange={(e) => setPreferences((prev: any) => ({ ...prev, exclusions: { ...(prev.exclusions || {}), libraries: e.target.value.split('\n').map(v => v.trim()).filter(Boolean) } }))}
                                                />
                                            </div>
                                            <div>
                                                <label className="text-xs text-muted font-bold uppercase">{t('maintenance.exclusions.advancedRating')}</label>
                                                <textarea
                                                    className="appearance-none text-[16px] leading-5 w-full min-h-[180px] p-3 rounded-lg border border-border bg-card text-text text-[16px]"
                                                    value={(preferences?.exclusions?.ratingKeys || []).join('\n')}
                                                    onChange={(e) => setPreferences((prev: any) => ({ ...prev, exclusions: { ...(prev.exclusions || {}), ratingKeys: e.target.value.split('\n').map(v => v.trim()).filter(Boolean) } }))}
                                                />
                                            </div>
                                        </div>
                                        <button type="button" className="px-3 py-2 bg-plex text-background rounded-md text-sm font-semibold" onClick={async () => { await savePreferences(preferences); await loadExclusionsSummary(); addToast(t('maintenance.exclusions.saved')); }}>
                                            {t('maintenance.exclusions.saved')}
                                        </button>
                                    </div>
                                )}
                                {activeSection === 'settings' && (
                                    <div className="glass-card-sm p-5 space-y-4">
                                        <h3 className="text-xl font-bold text-plex">{t('maintenance.settings.title')}</h3>
                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                            <div className="bg-background/30 border border-white/5 rounded-lg p-3">
                                                <label className="text-xs text-muted font-bold uppercase block mb-2">{t('maintenance.settings.defaultDryRun')}</label>
                                                <label className="text-sm text-muted flex items-center gap-2">
                                                    <input type="checkbox" checked={!!preferences?.global?.dryRunByDefault} onChange={(e) => setPreferences((prev: any) => ({ ...prev, global: { ...(prev.global || {}), dryRunByDefault: e.target.checked } }))} />
                                                    {t('maintenance.settings.enableByDefault')}
                                                </label>
                                            </div>
                                            <div className="bg-background/30 border border-white/5 rounded-lg p-3">
                                                <label className="text-xs text-muted font-bold uppercase block mb-2">{t('maintenance.settings.maxActions')}</label>
                                                <input type="number" min={1} className="appearance-none text-[16px] leading-5 w-full p-2 rounded border border-border bg-card text-text text-[16px]" value={preferences?.global?.maxActionsPerRun || 25} onChange={(e) => setPreferences((prev: any) => ({ ...prev, global: { ...(prev.global || {}), maxActionsPerRun: Math.max(1, Number(e.target.value) || 1) } }))} />
                                            </div>
                                            <div className="bg-background/30 border border-white/5 rounded-lg p-3">
                                                <label className="text-xs text-muted font-bold uppercase block mb-2">{t('maintenance.settings.requireConfirm')}</label>
                                                <label className="text-sm text-muted flex items-center gap-2">
                                                    <input type="checkbox" checked={!!preferences?.global?.requireConfirmForDestructive} onChange={(e) => setPreferences((prev: any) => ({ ...prev, global: { ...(prev.global || {}), requireConfirmForDestructive: e.target.checked } }))} />
                                                    {t('maintenance.settings.required')}
                                                </label>
                                            </div>
                                        </div>
                                        <button type="button" className="px-3 py-2 bg-plex text-background rounded-md text-sm font-semibold" onClick={async () => { await savePreferences(preferences); addToast(t('maintenance.settings.saved')); }}>
                                            {t('maintenance.settings.save')}
                                        </button>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};
