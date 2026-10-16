import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePoll } from '../shared/usePoll';
import {
    ArrowUpCircle,
    AlertTriangle,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    Clock3,
    Copy,
    Cpu,
    FileMinus2,
    FolderInput,
    Layers,
    ListTodo,
    Loader2,
    Radar,
    RefreshCw,
    Send,
    Target,
    Wand2,
} from 'lucide-react';
import { apiFetch } from '../shared/api';
import { portalUrl } from '../shared/basePath';
import { CustomSelect } from '../shared/ui';
import { useDiscoverI18n } from '../discovery/i18n';
import {
    formatScannerWhen,
    SCANNER_ACTION_FILTER_LABEL_KEYS,
    SCANNER_ACTION_FILTER_LABELS,
    scannerActionFilterGroup,
    scannerActionStyles,
    sourceAppIconUrl,
    sourceAppKey,
    type ScannerSourceAppKey,
} from './eventMeta';
import { ScannerSourceBadge } from './ScannerSourceBadge';
import {
    DashboardHero,
    DashboardPageShell,
    DashboardPanel,
    DashboardStatCard,
    dashboardGlowClass,
} from '../shared/dashboard/DashboardChrome';

type ScannerStatus = {
    enabled: boolean;
    minimumAge: string;
    remaining: number;
    processed: number;
    targetCount: number;
    configuredSources?: Array<'sonarr' | 'radarr' | 'lidarr' | 'media-automation'>;
    showWebhooks?: boolean;
    showManualPath?: boolean;
    webhookPaths: {
        manual: string;
        sonarr: string[];
        radarr: string[];
        lidarr: string[];
        mediaAutomation?: string[];
    };
};

type LogEntry = {
    at?: string;
    ok?: boolean;
    folder?: string;
    source?: string;
    error?: string;
    results?: any[];
    eventType?: string;
    action?: string;
    reason?: string;
    title?: string;
    quality?: string;
    isUpgrade?: boolean;
};

type QueueItem = {
    folder: string;
    priority?: number;
    time?: string;
    source?: string;
    eventType?: string;
    action?: string;
    reason?: string;
    title?: string;
    quality?: string;
    isUpgrade?: boolean;
    heldAt?: string;
    holdReason?: string;
    attempts?: number;
};

const MANUAL_PATH_COLLAPSED_KEY = 'scanner-manual-path-collapsed';
const ACTIVITY_FETCH_LIMIT = 500;
const ACTIVITY_PAGE_SIZE = 5;
const SOURCE_LABELS: Record<string, string> = {
    sonarr: 'Sonarr',
    radarr: 'Radarr',
    lidarr: 'Lidarr',
    'media-automation': 'Media Automation',
};
const CONFIGURED_SOURCE_KEYS = new Set<ScannerSourceAppKey>(['sonarr', 'radarr', 'lidarr', 'media-automation']);
const isConfiguredSourceKey = (source: string): source is Exclude<ScannerSourceAppKey, '' | 'manual'> => (
    CONFIGURED_SOURCE_KEYS.has(source as ScannerSourceAppKey)
);

const readManualPathCollapsed = () => {
    try {
        return localStorage.getItem(MANUAL_PATH_COLLAPSED_KEY) === '1';
    } catch {
        return false;
    }
};

const ACTIVITY_EVENT_FILTER_ORDER = ['import', 'grab', 'upgrade', 'deleted', 'rename', 'manual', 'manual-interaction', 'app-update', 'refresh', 'other'];

const ActionIcon: React.FC<{ action?: string; className?: string }> = ({ action, className }) => {
    const key = String(action || '').toLowerCase();
    if (key === 'upgrade') return <ArrowUpCircle className={className} />;
    if (key === 'app-update') return <RefreshCw className={className} />;
    if (key === 'manual-interaction') return <AlertTriangle className={className} />;
    if (key.includes('delete')) return <FileMinus2 className={className} />;
    if (key === 'rename') return <Wand2 className={className} />;
    if (key === 'manual') return <FolderInput className={className} />;
    if (key === 'import') return <FolderInput className={className} />;
    if (key === 'refresh') return <Radar className={className} />;
    return <Radar className={className} />;
};

const EventCard: React.FC<{
    accent: 'amber' | 'emerald' | 'rose' | 'sky';
    children: React.ReactNode;
}> = ({ accent, children }) => {
    const accentClass = accent === 'amber'
        ? 'border-l-amber-400/70'
        : accent === 'rose'
            ? 'border-l-rose-400/70'
            : accent === 'sky'
                ? 'border-l-sky-400/70'
                : 'border-l-emerald-400/60';
    return (
        <li className={`rounded-xl border border-white/10 border-l-[3px] bg-black/20 px-3.5 py-3 transition-colors hover:bg-white/[0.03] ${accentClass}`}>
            {children}
        </li>
    );
};

export const ScannerDashboard: React.FC = () => {
    const { t } = useDiscoverI18n();
    const tRef = useRef(t);
    tRef.current = t;
    const [path, setPath] = useState('');
    const [status, setStatus] = useState<ScannerStatus | null>(null);
    const [queue, setQueue] = useState<QueueItem[]>([]);
    const [held, setHeld] = useState<QueueItem[]>([]);
    const [log, setLog] = useState<LogEntry[]>([]);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [manualCollapsed, setManualCollapsed] = useState(readManualPathCollapsed);
    const [activityPage, setActivityPage] = useState(0);
    const [activitySource, setActivitySource] = useState('all');
    const [activityEvent, setActivityEvent] = useState('all');

    const toggleManualPath = () => {
        setManualCollapsed((prev) => {
            const next = !prev;
            try {
                localStorage.setItem(MANUAL_PATH_COLLAPSED_KEY, next ? '1' : '0');
            } catch {
                // ignore
            }
            return next;
        });
    };

    const refresh = useCallback(async () => {
        try {
            const [st, q, lg] = await Promise.all([
                apiFetch('/api/scanner/status'),
                apiFetch('/api/scanner/queue'),
                apiFetch(`/api/scanner/log?limit=${ACTIVITY_FETCH_LIMIT}`),
            ]);
            setStatus(st);
            setQueue(Array.isArray(q?.scans) ? q.scans : []);
            setHeld(Array.isArray(q?.heldScans) ? q.heldScans : []);
            setLog(Array.isArray(lg?.entries) ? lg.entries : []);
            setError(null);
        } catch (e: any) {
            setError(e?.message || tRef.current('scanner.errors.load'));
        }
    }, []);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    usePoll(() => { void refresh(); }, 8000);

    const configuredSources = useMemo(() => {
        const configured = status?.configuredSources || [];
        const observed = log
            .map((entry) => sourceAppKey(entry.source))
            .filter(isConfiguredSourceKey);
        return [...new Set([...configured, ...observed])];
    }, [status?.configuredSources, log]);
    const activitySourceOptions = useMemo(() => [
        { value: 'all', label: t('scanner.filters.allConfiguredApps') },
        ...configuredSources.map((source) => ({
            value: source,
            label: SOURCE_LABELS[source] || source,
            icon: sourceAppIconUrl(source) ? (
                <img
                    src={sourceAppIconUrl(source) || ''}
                    alt=""
                    className="h-4 w-4 shrink-0 object-contain"
                    loading="lazy"
                    referrerPolicy="no-referrer"
                />
            ) : source === 'media-automation' ? (
                <Cpu className="h-4 w-4 shrink-0 text-plex" />
            ) : undefined,
        })),
    ], [configuredSources, t]);
    const activityEventLabel = useCallback((key: string) => {
        const labelKey = SCANNER_ACTION_FILTER_LABEL_KEYS[key];
        if (labelKey) return t(labelKey);
        return SCANNER_ACTION_FILTER_LABELS[key]
            || key.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    }, [t]);
    const activityEventOptions = useMemo(() => {
        const present = new Set(
            log.map((entry) => scannerActionFilterGroup(entry.action || entry.reason, entry.isUpgrade)),
        );
        const ordered = ACTIVITY_EVENT_FILTER_ORDER.filter((key) => present.has(key));
        for (const key of present) {
            if (!ordered.includes(key)) ordered.push(key);
        }
        return [
            { value: 'all', label: activityEventLabel('all') },
            ...ordered.map((key) => ({
                value: key,
                label: activityEventLabel(key),
            })),
        ];
    }, [activityEventLabel, log]);
    const filteredLog = useMemo(() => {
        let rows = log;
        if (activitySource !== 'all') {
            rows = rows.filter((entry) => sourceAppKey(entry.source) === activitySource);
        }
        if (activityEvent !== 'all') {
            rows = rows.filter(
                (entry) => scannerActionFilterGroup(entry.action || entry.reason, entry.isUpgrade) === activityEvent,
            );
        }
        return rows;
    }, [activityEvent, activitySource, log]);
    const activityTotalPages = Math.max(1, Math.ceil(filteredLog.length / ACTIVITY_PAGE_SIZE) || 1);
    const activitySafePage = Math.min(activityPage, activityTotalPages - 1);
    const activityPageEntries = filteredLog.slice(
        activitySafePage * ACTIVITY_PAGE_SIZE,
        activitySafePage * ACTIVITY_PAGE_SIZE + ACTIVITY_PAGE_SIZE,
    );

    useEffect(() => {
        if (
            activitySource !== 'all'
            && !configuredSources.includes(activitySource as Exclude<ScannerSourceAppKey, '' | 'manual'>)
        ) {
            setActivitySource('all');
        }
    }, [activitySource, configuredSources]);

    useEffect(() => {
        if (
            activityEvent !== 'all'
            && !activityEventOptions.some((option) => option.value === activityEvent)
        ) {
            setActivityEvent('all');
        }
    }, [activityEvent, activityEventOptions]);

    useEffect(() => {
        setActivityPage(0);
    }, [activitySource, activityEvent]);

    useEffect(() => {
        if (activityPage > activityTotalPages - 1) {
            setActivityPage(Math.max(0, activityTotalPages - 1));
        }
    }, [activityPage, activityTotalPages]);

    const submitPath = async (e: React.FormEvent) => {
        e.preventDefault();
        const value = path.trim();
        if (!value) return;
        setBusy(true);
        setMessage(null);
        setError(null);
        try {
            const res = await apiFetch('/api/scanner/manual', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: value }),
            });
            setMessage(t('scanner.toasts.queued', { path: res.folder || value }));
            setPath('');
            await refresh();
        } catch (err: any) {
            setError(err?.message || t('scanner.errors.queuePath'));
        } finally {
            setBusy(false);
        }
    };

    const copyText = async (text: string) => {
        try {
            await navigator.clipboard.writeText(text);
            setMessage(t('scanner.toasts.copied'));
        } catch {
            setMessage(text);
        }
    };

    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const webhookUrl = (p: string) => `${origin}${portalUrl(p)}`;
    const webhookRows = [
        ...(status?.webhookPaths?.sonarr || ['/triggers/sonarr']).map((p) => ({ label: 'Sonarr', key: 'sonarr', tone: 'text-sky-300', path: p })),
        ...(status?.webhookPaths?.radarr || ['/triggers/radarr']).map((p) => ({ label: 'Radarr', key: 'radarr', tone: 'text-amber-300', path: p })),
        ...(status?.webhookPaths?.lidarr || ['/triggers/lidarr']).map((p) => ({ label: 'Lidarr', key: 'lidarr', tone: 'text-violet-300', path: p })),
        ...(status?.webhookPaths?.mediaAutomation || []).map((p) => ({ label: 'Media Automation', key: 'media-automation', tone: 'text-plex', path: p })),
        { label: 'Manual', key: 'manual', tone: 'text-emerald-300', path: status?.webhookPaths?.manual || '/triggers/manual' },
    ];

    return (
        <DashboardPageShell>
            <DashboardHero
                accent="sky"
                eyebrow={t('scanner.dashboard.eyebrow')}
                title={t('scanner.dashboard.title')}
                description={t('scanner.dashboard.description')}
                icon={<Radar className="h-3.5 w-3.5" />}
                actions={(
                    <button
                        type="button"
                        onClick={() => void refresh()}
                        className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-black/20 px-4 py-2.5 text-sm font-semibold text-muted transition-colors hover:bg-white/5 hover:text-text"
                    >
                        <RefreshCw className="h-4 w-4" /> {t('scanner.actions.refresh')}
                    </button>
                )}
            />

            {status?.showManualPath !== false ? (
            <div className="glass-card space-y-3 p-4 shadow-xl md:p-5">
                <button
                    type="button"
                    onClick={toggleManualPath}
                    className="group flex w-full items-start justify-between gap-3 text-left"
                    aria-expanded={!manualCollapsed}
                >
                    <div className="min-w-0">
                        <h2 className="text-sm font-bold uppercase tracking-wider text-muted transition-colors group-hover:text-sky-200">
                            {t('scanner.manual.title')}
                        </h2>
                        <p className="mt-0.5 text-xs text-muted/80">
                            {manualCollapsed
                                ? t('scanner.manual.hiddenHint')
                                : t('scanner.manual.visibleHint')}
                        </p>
                    </div>
                    <span className="mt-0.5 inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs font-semibold text-muted transition-colors group-hover:bg-white/5 group-hover:text-text">
                        {manualCollapsed ? t('common.show') : t('common.hide')}
                        <ChevronDown className={`h-4 w-4 transition-transform ${manualCollapsed ? '' : 'rotate-180'}`} />
                    </span>
                </button>
                {!manualCollapsed ? (
                    <form onSubmit={submitPath} className="space-y-3">
                        <div className="flex flex-col gap-2 sm:flex-row">
                            <input
                                type="text"
                                value={path}
                                onChange={(e) => setPath(e.target.value)}
                                placeholder={t('scanner.manual.placeholder')}
                                className="flex-1 rounded-xl border border-white/10 bg-background/70 px-4 py-3 text-text placeholder:text-muted/60 focus:outline-none focus:ring-2 focus:ring-sky-400/30"
                            />
                            <button
                                type="submit"
                                disabled={busy || !path.trim()}
                                className="inline-flex items-center justify-center gap-2 rounded-xl bg-sky-400 px-5 py-3 font-bold text-black transition-colors hover:bg-sky-300 disabled:opacity-50"
                            >
                                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                                {t('scanner.actions.submit')}
                            </button>
                        </div>
                        <div className="rounded-xl border border-sky-400/20 bg-sky-500/10 px-4 py-3 text-sm leading-relaxed text-sky-100/95">
                            {t('scanner.manual.submitHint')}
                            {status?.minimumAge ? <>
                                {t('scanner.manual.waitsBeforeTargets')}
                                <code className="text-sky-200">{status.minimumAge}</code>
                                {t('scanner.manual.beforeTargetsAreCalled')}
                            </> : null}.
                        </div>
                    </form>
                ) : null}
            </div>
            ) : null}

            {(message || error) && (
                <div className={`rounded-xl border px-4 py-3 text-sm ${error ? 'border-red-400/20 bg-red-500/10 text-red-200' : 'border-emerald-400/20 bg-emerald-500/10 text-emerald-100'}`}>
                    {error || message}
                </div>
            )}

            <div className="grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-4">
                <DashboardStatCard
                    label={t('scanner.stats.queued')}
                    value={status?.remaining ?? '—'}
                    hint={t('scanner.stats.queuedHint')}
                    icon={<ListTodo className="h-4 w-4 text-amber-300" />}
                    glow={dashboardGlowClass('amber')}
                />
                <DashboardStatCard
                    label={t('scanner.stats.processed')}
                    value={status?.processed ?? '—'}
                    hint={t('scanner.stats.processedHint')}
                    icon={<Layers className="h-4 w-4 text-emerald-300" />}
                    glow={dashboardGlowClass('emerald')}
                />
                <DashboardStatCard
                    label={t('scanner.stats.targets')}
                    value={status?.targetCount ?? '—'}
                    hint={t('scanner.stats.targetsHint')}
                    icon={<Target className="h-4 w-4 text-violet-300" />}
                    glow={dashboardGlowClass('violet')}
                />
                <DashboardStatCard
                    label={t('scanner.stats.minAge')}
                    value={status?.minimumAge ?? '—'}
                    hint={t('scanner.stats.minAgeHint')}
                    icon={<Clock3 className="h-4 w-4 text-sky-300" />}
                    glow={dashboardGlowClass('sky')}
                />
            </div>

            {status?.showWebhooks !== false ? (
            <section className="glass-card space-y-4 p-4 shadow-xl md:p-5">
                <div>
                    <h2 className="text-lg font-bold tracking-tight text-text">{t('scanner.webhooks.title')}</h2>
                    <p className="mt-1 text-sm leading-relaxed text-muted">
                        {t('scanner.webhooks.instructions')}
                    </p>
                </div>
                <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2">
                    {webhookRows.map((row) => {
                        const full = webhookUrl(row.path);
                        return (
                            <div
                                key={`${row.label}-${row.path}`}
                                className="group flex items-center gap-3 rounded-xl border border-white/10 bg-black/25 px-3.5 py-3 transition-colors hover:bg-black/35"
                            >
                                <ScannerSourceBadge source={row.key} className={`w-[5.5rem] shrink-0 ${row.tone}`} />
                                <code className="flex-1 truncate font-mono text-xs text-text/85">{full}</code>
                                <button
                                    type="button"
                                    onClick={() => void copyText(full)}
                                    className="rounded-lg border border-transparent p-2 text-muted transition-colors hover:border-white/10 hover:bg-white/10 hover:text-text"
                                    title={t('scanner.actions.copy')}
                                >
                                    <Copy className="h-4 w-4" />
                                </button>
                            </div>
                        );
                    })}
                </div>
            </section>
            ) : null}

            <div className="grid grid-cols-1 gap-4 md:gap-5 xl:grid-cols-2">
                <div className="flex flex-col gap-4 md:gap-5">
                {held.length > 0 ? (
                    <DashboardPanel
                        title={t('scanner.held.title')}
                        subtitle={t('scanner.held.subtitle')}
                        badge={(
                            <span className="rounded-full border border-sky-400/25 bg-sky-500/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-sky-200">
                                {t('scanner.held.waiting', { count: held.length })}
                            </span>
                        )}
                    >
                        <ul className="space-y-2">
                            {held.map((item) => {
                                const style = scannerActionStyles(item.action || item.reason, item.isUpgrade);
                                return (
                                    <EventCard key={`held-${item.folder}-${item.time}`} accent="sky">
                                        <div className="mb-2 flex flex-wrap items-center gap-2">
                                            <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-400/30 bg-sky-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-sky-200">
                                                <Clock3 className="h-3 w-3" />
                                                {t('scanner.held.resends')}
                                            </span>
                                            <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${style.className}`}>
                                                <ActionIcon action={item.action} className="h-3 w-3" />
                                                {item.reason || (style.labelKey ? t(style.labelKey) : style.label)}
                                            </span>
                                            <ScannerSourceBadge source={item.source} />
                                        </div>
                                        {item.title ? <p className="mb-1 text-sm font-semibold text-text">{item.title}</p> : null}
                                        <p className="break-all font-mono text-xs leading-relaxed text-text/80" title={item.folder}>
                                            {item.folder}
                                        </p>
                                        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted">
                                            <span>{formatScannerWhen(item.heldAt || item.time)}</span>
                                            {item.quality ? <span>{item.quality}</span> : null}
                                            {item.eventType ? <span className="opacity-70">{item.eventType}</span> : null}
                                        </div>
                                        {item.holdReason ? <p className="mt-2 text-xs text-sky-100/80">{item.holdReason}</p> : null}
                                    </EventCard>
                                );
                            })}
                        </ul>
                    </DashboardPanel>
                ) : null}
                <DashboardPanel
                    title={t('scanner.queue.title')}
                    subtitle={t('scanner.queue.subtitle')}
                    badge={(
                        <span className="rounded-full border border-amber-400/25 bg-amber-500/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-amber-200">
                            {t('scanner.queue.pending', { count: queue.length })}
                        </span>
                    )}
                >
                    {queue.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-white/10 bg-black/20 px-4 py-10 text-center">
                            <p className="text-sm text-muted">
                                {held.length > 0 ? t('scanner.queue.emptyWhileHeld') : t('scanner.queue.empty')}
                            </p>
                        </div>
                    ) : (
                        <ul className="space-y-2">
                            {queue.map((item) => {
                                const style = scannerActionStyles(item.action || item.reason, item.isUpgrade);
                                return (
                                    <EventCard key={`${item.folder}-${item.time}`} accent="amber">
                                        <div className="mb-2 flex flex-wrap items-center gap-2">
                                            <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${style.className}`}>
                                                <ActionIcon action={item.action} className="h-3 w-3" />
                                                {item.reason || (style.labelKey ? t(style.labelKey) : style.label)}
                                            </span>
                                            <ScannerSourceBadge source={item.source} />
                                            <span className="ml-auto text-[10px] tabular-nums text-muted">P{item.priority ?? 0}</span>
                                        </div>
                                        {item.title ? <p className="mb-1 text-sm font-semibold text-text">{item.title}</p> : null}
                                        <p className="break-all font-mono text-xs leading-relaxed text-text/80" title={item.folder}>
                                            {item.folder}
                                        </p>
                                        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted">
                                            <span>{formatScannerWhen(item.time)}</span>
                                            {item.quality ? <span>{item.quality}</span> : null}
                                            {item.eventType ? <span className="opacity-70">{item.eventType}</span> : null}
                                        </div>
                                    </EventCard>
                                );
                            })}
                        </ul>
                    )}
                </DashboardPanel>
                </div>

                <DashboardPanel
                    title={t('scanner.activity.title')}
                    subtitle={t('scanner.activity.subtitle', { total: ACTIVITY_FETCH_LIMIT, perPage: ACTIVITY_PAGE_SIZE })}
                    controls={(
                        <div className="flex w-full min-w-0 flex-nowrap items-center gap-2 sm:w-auto">
                            {configuredSources.length > 0 ? (
                                <CustomSelect
                                    id="scanner-activity-source"
                                    value={activitySource}
                                    onChange={setActivitySource}
                                    options={activitySourceOptions}
                                    compact
                                    className="min-w-0 flex-1 sm:w-44 sm:flex-none"
                                />
                            ) : null}
                            <CustomSelect
                                id="scanner-activity-event"
                                value={activityEvent}
                                onChange={setActivityEvent}
                                options={activityEventOptions}
                                compact
                                className="min-w-0 flex-1 sm:w-40 sm:flex-none"
                            />
                            <span className="shrink-0 whitespace-nowrap rounded-full border border-emerald-400/25 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-emerald-200">
                                {t('scanner.activity.eventCount', { count: filteredLog.length })}
                            </span>
                        </div>
                    )}
                >
                    {filteredLog.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-white/10 bg-black/20 px-4 py-10 text-center">
                            <p className="text-sm text-muted">
                                {log.length === 0
                                    ? t('scanner.activity.noScansProcessed')
                                    : activityEvent !== 'all'
                                        ? activitySource !== 'all'
                                            ? t('scanner.activity.noEventsForSource', {
                                                filter: activityEventLabel(activityEvent),
                                                source: SOURCE_LABELS[activitySource] || activitySource,
                                            })
                                            : t('scanner.activity.noEvents', {
                                                filter: activityEventLabel(activityEvent),
                                            })
                                        : t('scanner.activity.noSourceActivity', {
                                            source: SOURCE_LABELS[activitySource] || activitySource,
                                        })}
                            </p>
                        </div>
                    ) : (
                        <>
                        <ul className="space-y-2">
                            {activityPageEntries.map((entry, i) => {
                                const style = scannerActionStyles(entry.action || entry.reason, entry.isUpgrade);
                                const targets = Array.isArray(entry.results) ? entry.results : [];
                                const globalIndex = activitySafePage * ACTIVITY_PAGE_SIZE + i;
                                return (
                                    <EventCard key={`${entry.at}-${globalIndex}`} accent={entry.ok ? 'emerald' : 'rose'}>
                                        <div className="mb-2 flex flex-wrap items-center gap-2">
                                            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                                                entry.ok
                                                    ? 'border-emerald-400/30 bg-emerald-500/15 text-emerald-300'
                                                    : 'border-red-400/30 bg-red-500/15 text-red-300'
                                            }`}>
                                                {entry.ok ? t('scanner.activity.ok') : t('scanner.activity.error')}
                                            </span>
                                            <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${style.className}`}>
                                                <ActionIcon action={entry.action} className="h-3 w-3" />
                                                {entry.reason || (style.labelKey ? t(style.labelKey) : style.label)}
                                            </span>
                                            <ScannerSourceBadge source={entry.source} />
                                            <span className="ml-auto text-[10px] text-muted">{formatScannerWhen(entry.at)}</span>
                                        </div>
                                        {entry.title ? <p className="mb-1 text-sm font-semibold text-text">{entry.title}</p> : null}
                                        <p className="break-all font-mono text-xs leading-relaxed text-text/85" title={entry.folder}>
                                            {entry.folder}
                                        </p>
                                        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted">
                                            {entry.quality ? <span>{entry.quality}</span> : null}
                                            {entry.eventType ? <span>{entry.eventType}</span> : null}
                                            {targets.length > 0 ? (
                                                <span>
                                                    {targets.map((r: any) => (
                                                        r?.skipped
                                                            ? t('scanner.activity.targetSkipped', { target: r.type })
                                                            : t('scanner.activity.targetRefreshed', { target: r.type })
                                                    )).join(' · ')}
                                                </span>
                                            ) : null}
                                        </div>
                                        {entry.error ? <p className="mt-2 text-xs text-red-200">{entry.error}</p> : null}
                                    </EventCard>
                                );
                            })}
                        </ul>
                        {filteredLog.length > ACTIVITY_PAGE_SIZE ? (
                            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2.5">
                                <p className="text-xs text-muted">
                                    {t('scanner.activity.showing', { from: activitySafePage * ACTIVITY_PAGE_SIZE + 1, to: Math.min(filteredLog.length, (activitySafePage + 1) * ACTIVITY_PAGE_SIZE), total: filteredLog.length })}
                                </p>
                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs font-semibold text-muted transition-colors hover:bg-white/5 hover:text-text disabled:opacity-40"
                                        disabled={activitySafePage <= 0}
                                        onClick={() => setActivityPage((p) => Math.max(0, p - 1))}
                                    >
                                        <ChevronLeft className="h-3.5 w-3.5" />
                                        {t('scanner.pagination.previous')}
                                    </button>
                                    <span className="text-xs font-semibold tabular-nums text-muted">
                                        {activitySafePage + 1} / {activityTotalPages}
                                    </span>
                                    <button
                                        type="button"
                                        className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs font-semibold text-muted transition-colors hover:bg-white/5 hover:text-text disabled:opacity-40"
                                        disabled={activitySafePage >= activityTotalPages - 1}
                                        onClick={() => setActivityPage((p) => Math.min(activityTotalPages - 1, p + 1))}
                                    >
                                        {t('scanner.pagination.next')}
                                        <ChevronRight className="h-3.5 w-3.5" />
                                    </button>
                                </div>
                            </div>
                        ) : null}
                        </>
                    )}
                </DashboardPanel>
            </div>
        </DashboardPageShell>
    );
};

export default ScannerDashboard;
