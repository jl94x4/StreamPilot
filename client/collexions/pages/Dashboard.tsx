import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { usePoll } from '../../shared/usePoll';
import {
    DashboardPanel,
    DashboardStatCard,
    dashboardGlowClass,
} from '../../shared/dashboard/DashboardChrome';
import {
    Play,
    Square,
    Clock,
    Activity,
    Terminal,
    WifiOff,
    CalendarClock,
    RefreshCw,
    ToggleLeft,
    ToggleRight,
    Power,
    Cpu,
    Hourglass,
    AlertTriangle,
    CheckCircle2,
    Filter,
    Settings
} from 'lucide-react';
import { api, type CollexionsHealth } from '../api';
import { AppConfig, AppStatus, LibraryRunStats, PinFairness } from '../types';

const SKIP_LABELS: Record<string, string> = {
    recent_pin: 'Repeat block',
    explicit_exclusion: 'Exclusion list',
    regex: 'Regex exclusion',
    inactive_special: 'Inactive special',
    low_item_count: 'Below min items',
    item_count_error: 'Item count error',
    no_title: 'Missing title',
};

interface LogLibraryStats {
    name: string;
    found: number;
    eligible: number;
    pinned: number;
    blockedByTimer: number;
    blockedByCategory: boolean;
}

interface RunAnalysis {
    status: 'RUNNING' | 'COMPLETED' | 'FAILED' | 'UNKNOWN';
    startTime: string;
    duration: string;
    intervalConfig: string;
    totalPins: number;
    libraries: LibraryRunStats[] | LogLibraryStats[];
    errors: string[];
    fairness?: PinFairness;
    source: 'status.json' | 'logs';
    pinSlots?: number;
}

const formatSkipBreakdown = (lib: LibraryRunStats): string => {
    const skips = lib.skips || {};
    const parts = Object.entries(skips)
        .filter(([, n]) => Number(n) > 0)
        .map(([key, n]) => `${SKIP_LABELS[key] || key}: ${n}`);
    if (lib.withheld_by_category) {
        parts.push(`Category-held: ${lib.withheld_by_category}`);
    }
    if (lib.category_skipped_by_chance) {
        parts.push('Category roll skipped');
    }
    return parts.join(' · ') || '—';
};

const libraryReason = (lib: LibraryRunStats | LogLibraryStats): React.ReactNode => {
    if ('skips' in lib || 'notes' in lib) {
        const structured = lib as LibraryRunStats;
        if ((structured.pinned || 0) > 0) {
            return (
                <span className="text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" />
                    {structured.pinned}/{structured.pin_limit ?? '?'} slots
                    {(structured.specials_picked || structured.categories_picked || structured.random_picked) ? (
                        <span className="text-muted font-normal normal-case tracking-normal">
                            {' '}(S{structured.specials_picked || 0}/C{structured.categories_picked || 0}/R{structured.random_picked || 0})
                        </span>
                    ) : null}
                </span>
            );
        }
        if (structured.notes?.length) {
            return <span className="text-amber-300/90">{structured.notes[0]}</span>;
        }
        if ((structured.eligible || 0) === 0 && (structured.found || 0) > 0) {
            return <span className="text-muted">All filtered out — {formatSkipBreakdown(structured)}</span>;
        }
        return <span className="text-muted">{formatSkipBreakdown(structured)}</span>;
    }

    const legacy = lib as LogLibraryStats;
    if (legacy.pinned > 0) {
        return <span className="text-emerald-400 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Success</span>;
    }
    if (legacy.found === 0) return <span className="text-muted">Empty Library</span>;
    if (legacy.blockedByTimer > 0 && legacy.eligible === 0) {
        return <span className="text-amber-400 flex items-center gap-1"><Clock className="w-3 h-3" /> {legacy.blockedByTimer} items blocked by timer</span>;
    }
    if (legacy.eligible === 0) return <span className="text-muted">All filtered out (Exclusions)</span>;
    if (legacy.blockedByCategory) {
        return <span className="text-plex flex items-center gap-1"><Filter className="w-3 h-3" /> Category Mode Restricted</span>;
    }
    return <span className="text-muted">Skipped (Random chance)</span>;
};

const isTransientWorkerBlip = (text: string) =>
    /econnreset|econnrefused|econnaborted|socket hang up|network socket disconnected|epipe|worker timed out|did not respond in time/i.test(text);

const Dashboard: React.FC = () => {
    const [status, setStatus] = useState<AppStatus | null>(null);
    const [config, setConfig] = useState<AppConfig | null>(null);
    const [nextRun, setNextRun] = useState<string>('--:--');
    const [logs, setLogs] = useState<string>('');
    const [loading, setLoading] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [health, setHealth] = useState<CollexionsHealth | null>(null);
    const [healthError, setHealthError] = useState('');

    // Default Settings
    const [autoRefresh] = useState(true);
    const [liveLogs, setLiveLogs] = useState(true);

    // Persistence
    useEffect(() => {
        const saved = localStorage.getItem('collexions_dashboard_state');
        if (saved) {
            try {
                const state = JSON.parse(saved);
                if (state.liveLogs !== undefined) setLiveLogs(state.liveLogs);
            } catch (e) { console.error(e); }
        }
    }, []);

    useEffect(() => {
        localStorage.setItem('collexions_dashboard_state', JSON.stringify({ liveLogs }));
    }, [liveLogs]);

    const logContainerRef = useRef<HTMLDivElement>(null);
    const statusFetchGenRef = useRef(0);
    const healthFetchGenRef = useRef(0);
    const logsFetchGenRef = useRef(0);
    const healthFailRef = useRef(0);

    // --- Helpers ---
    const safeParseDate = (dateStr: string): Date | null => {
        if (!dateStr) return null;
        try {
            // Handle ISO-like formats with ' ' instead of 'T'
            let cleanStr = dateStr.replace(' ', 'T');

            let d = new Date(cleanStr);
            if (!isNaN(d.getTime())) return d;

            // Handle microsecond timestamps (strip extra decimals)
            d = new Date(cleanStr.replace(/(\.\d{3})\d+/, '$1'));
            if (!isNaN(d.getTime())) return d;

            d = new Date(cleanStr.split('.')[0]);
            if (!isNaN(d.getTime())) return d;

            // Final fallback: try the original string directly 
            // This handles formats like 'Thu Mar 12 01:02:35 2026' (ctime)
            d = new Date(dateStr);
            if (!isNaN(d.getTime())) return d;

        } catch (e) {
            console.warn("Date parse error", e);
        }
        return null;
    };

    const calculateNextRun = (s: AppStatus) => {
        if (s.process_alive && s.next_run_timestamp && s.next_run_timestamp > 0) {
            const targetDate = new Date(s.next_run_timestamp * 1000);
            const timeStr = targetDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            const diff = targetDate.getTime() - Date.now();
            const mins = Math.ceil(diff / 60000);

            if (diff > 0) {
                setNextRun(`${timeStr} (in ${mins}m)`);
            } else {
                setNextRun("Due Now / Processing");
            }
        } else {
            setNextRun('--:--');
        }
    };

    // Prefer structured status.json from the worker; fall back to log scraping.
    const analyzeLastRun = useMemo((): RunAnalysis | null => {
        const structuredLibs = Array.isArray(status?.libraries) ? status!.libraries! : [];
        if (structuredLibs.length > 0 || status?.last_run_at) {
            const durationSec = Number(status?.last_run_duration_seconds);
            const duration = Number.isFinite(durationSec) && durationSec >= 0
                ? (durationSec >= 60
                    ? `${Math.floor(durationSec / 60)}m ${Math.round(durationSec % 60)}s`
                    : `${durationSec.toFixed(1)}s`)
                : '—';
            const statusLower = String(status?.status || '').toLowerCase();
            let runStatus: RunAnalysis['status'] = 'COMPLETED';
            if (/crash|error|fatal|critical/.test(statusLower)) runStatus = 'FAILED';
            else if (/processing|running|pinning/.test(statusLower) && status?.process_alive) runStatus = 'RUNNING';

            return {
                status: runStatus,
                startTime: status?.last_run_started_at || status?.last_run_at || 'Unknown',
                duration,
                intervalConfig: status?.fairness?.pinning_interval_minutes
                    ? `${status.fairness.pinning_interval_minutes} min`
                    : (config?.pinning_interval ? `${config.pinning_interval} min` : '?'),
                totalPins: Number(status?.last_run_pinned) || structuredLibs.reduce((n, l) => n + (l.pinned || 0), 0),
                libraries: structuredLibs,
                errors: [],
                fairness: status?.fairness,
                source: 'status.json',
                pinSlots: status?.pin_slots,
            };
        }

        if (!logs) return null;

        const lines = logs.split('\n');
        let startIndex = -1;
        for (let i = lines.length - 1; i >= 0; i--) {
            if (lines[i].includes('====== Starting')) {
                startIndex = i;
                break;
            }
        }
        if (startIndex === -1) return null;

        const runLines = lines.slice(startIndex);
        const analysis: RunAnalysis = {
            status: 'RUNNING',
            startTime: 'Unknown',
            duration: '...',
            intervalConfig: '?',
            totalPins: 0,
            libraries: [],
            errors: [],
            source: 'logs',
        };

        const startMatch = runLines[0].match(/(\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2})/);
        if (startMatch) analysis.startTime = startMatch[1];

        let currentLib: LogLibraryStats | null = null;

        runLines.forEach(line => {
            if (line.includes('====== Run Finished') || line.includes('====== Collexions Script Run Finished')) {
                analysis.status = 'COMPLETED';
            }

            if (line.includes('Duration:') || line.includes('Total run duration:')) {
                const durMatch = line.match(/Duration: ([\d:.]+)/) || line.match(/Total run duration: ([\d:.]+)/);
                if (durMatch) analysis.duration = durMatch[1];
            }

            if (line.includes('CRITICAL') || line.includes('Traceback') || (line.includes('ERROR') && !line.includes('404'))) {
                if (!analysis.errors.includes(line)) analysis.errors.push(line);
                analysis.status = 'FAILED';
            }

            if (line.includes('Pinning interval set to')) {
                const match = line.match(/(?:CONFIG: )?Pinning interval set to (\d+) minutes/);
                if (match) analysis.intervalConfig = match[1] + ' min';
            }

            if (line.includes('Sleeping for approximately')) {
                const match = line.match(/maintain (\d+)m frequency/);
                if (match) analysis.intervalConfig = match[1] + ' min';
            }

            const libStart = line.match(/===== Processing Library: '(.+?)'/);
            if (libStart) {
                if (currentLib) analysis.libraries.push(currentLib);
                currentLib = {
                    name: libStart[1],
                    found: 0,
                    eligible: 0,
                    pinned: 0,
                    blockedByTimer: 0,
                    blockedByCategory: false,
                };
            }

            if (currentLib) {
                const foundMatch = line.match(/Found (\d+) collections/);
                if (foundMatch) currentLib.found = parseInt(foundMatch[1], 10);

                if (line.includes('excluded due to') && line.includes('block')) {
                    const listContent = line.match(/\[(.*?)\]/);
                    if (listContent) {
                        currentLib.blockedByTimer = listContent[1].split(',').length;
                    }
                }

                const eligMatch = line.match(/Found (\d+) eligible collections/);
                if (eligMatch) currentLib.eligible = parseInt(eligMatch[1], 10);

                if (line.includes("Pinned '")) {
                    currentLib.pinned++;
                    analysis.totalPins++;
                }

                if (line.includes('EXCLUDING ALL collections')) {
                    currentLib.blockedByCategory = true;
                }
            }
        });

        if (currentLib) analysis.libraries.push(currentLib);
        return analysis;
    }, [status, logs, config?.pinning_interval]);

    useEffect(() => {
        const loadConfig = async () => {
            try {
                const c = await api.getConfig();
                setConfig(c);
            } catch (e) {
                console.error("Failed to load config", e);
            }
        };
        loadConfig();
    }, []);

    const fetchStatusOnly = useCallback(async () => {
        const gen = ++statusFetchGenRef.current;
        try {
            const s = await api.getStatus();
            if (gen !== statusFetchGenRef.current) return;
            setStatus(s);
            calculateNextRun(s);
        } catch (e) { /* ignore */ }
    }, []);

    const fetchHealth = useCallback(async () => {
        const gen = ++healthFetchGenRef.current;
        try {
            const h = await api.getHealth();
            if (gen !== healthFetchGenRef.current) return;
            const blipText = [h.worker?.error, ...(h.issues || [])].filter(Boolean).join(' ');
            const transientDown = !h.worker?.reachable && isTransientWorkerBlip(blipText);
            if (transientDown) {
                healthFailRef.current += 1;
                // Stop can briefly reset the worker socket; don't flash a warning for a 10s blip.
                if (healthFailRef.current < 3) return;
            } else {
                healthFailRef.current = 0;
            }
            setHealth(h);
            setHealthError('');
        } catch (e: any) {
            if (gen !== healthFetchGenRef.current) return;
            const msg = e?.message || 'Health check failed';
            if (isTransientWorkerBlip(msg)) {
                healthFailRef.current += 1;
                if (healthFailRef.current < 3) return;
            }
            setHealthError(msg);
        }
    }, []);

    const fetchLogsOnly = useCallback(async () => {
        const gen = ++logsFetchGenRef.current;
        try {
            const l = await api.getLogs();
            if (gen !== logsFetchGenRef.current) return;
            setLogs(l);
        } catch (e) { /* ignore */ }
    }, []);

    useEffect(() => {
        fetchStatusOnly();
        fetchLogsOnly();
        fetchHealth();
    }, []);

    useEffect(() => {
        if (!autoRefresh) return undefined;
        fetchStatusOnly();
        fetchHealth();
    }, [autoRefresh, fetchStatusOnly, fetchHealth]);

    usePoll(() => {
        fetchStatusOnly();
        fetchHealth();
    }, autoRefresh ? 5000 : null, { immediate: false });

    usePoll(fetchLogsOnly, liveLogs ? 5000 : null, { immediate: false });

    useEffect(() => {
        if (logContainerRef.current && liveLogs) {
            logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
        }
    }, [logs, liveLogs]);

    // --- Actions ---
    const currentStatus = status?.status || 'Connecting...';
    const statusLower = currentStatus.toLowerCase();
    // process_alive is the source of truth. Stale status.json text ("Sleeping",
    // "Run complete") used to keep the dashboard looking Active after Stop,
    // which also hid the Start button.
    const isLoopActive = !!status?.process_alive;
    const isWorking = isLoopActive && (statusLower.includes('processing') || statusLower.includes('pinning'));
    const isOffline = statusLower === 'offline' || status === null;
    const lastUpdateDate = safeParseDate(status?.last_run_at || status?.last_update || '');
    const isDryRun = config?.dry_run === true;

    const handleStartService = async () => {
        if (loading) return;
        if (isLoopActive) return alert("Service is already active.");
        setLoading(true);
        try {
            await api.runNow();
            await Promise.all([fetchStatusOnly(), fetchHealth()]);
        } catch (error: any) {
            alert(error?.message || "Failed to start.");
        }
        setLoading(false);
    };

    const handleStopService = async () => {
        if (loading) return;
        if (!confirm("Stop the Automation Service?")) return;
        setLoading(true);
        try {
            await api.stopScript();
            await fetchStatusOnly();
        } catch (error: any) {
            alert(error?.message || "Failed to stop.");
        }
        setLoading(false);
    };

    const manualRefresh = async () => {
        setIsRefreshing(true);
        await Promise.all([fetchStatusOnly(), fetchLogsOnly(), fetchHealth()]);
        setTimeout(() => setIsRefreshing(false), 500);
    };

    const healthIssues = (health?.issues?.length ? health.issues : (healthError ? [healthError] : []))
        .filter((issue) => !/pinning service is stopped/i.test(issue));
    const showHealthWarn = !!(health && (!health.ok || healthIssues.length > 0)) || !!healthError;

    return (
        <div className="space-y-6 animate-in fade-in duration-500 pb-10">

            {showHealthWarn && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100/90 space-y-2">
                    <div className="flex items-start gap-3">
                        <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                        <div className="min-w-0 flex-1">
                            <p className="font-bold text-amber-200">Health check</p>
                            <ul className="mt-1 space-y-0.5 text-xs list-disc list-inside text-amber-100/80">
                                {healthIssues.slice(0, 5).map((issue) => (
                                    <li key={issue}>{issue}</li>
                                ))}
                            </ul>
                            {health && (
                                <p className="mt-2 text-[11px] text-amber-200/70 uppercase tracking-wider font-bold">
                                    Worker {health.worker?.reachable ? 'reachable' : 'down'}
                                    {' · '}
                                    Script {health.worker?.detail?.script || 'unknown'}
                                    {' · '}
                                    Plex {health.worker?.detail?.plex?.ok ? 'ok' : 'issue'}
                                    {health.autostart ? ' · auto-start on' : ''}
                                </p>
                            )}
                        </div>
                        <button
                            type="button"
                            onClick={() => { void fetchHealth(); }}
                            className="text-amber-200 font-semibold hover:underline text-xs whitespace-nowrap"
                        >
                            Recheck
                        </button>
                    </div>
                </div>
            )}

            {/* Config Warnings */}
            {config && isDryRun && (
                <div className="bg-amber-500/20 border border-amber-500/50 p-4 rounded-xl flex items-center gap-4 animate-pulse">
                    <div className="bg-amber-500 text-black p-2 rounded-lg"><AlertTriangle className="w-6 h-6" /></div>
                    <div className="flex-1">
                        <h3 className="font-bold text-amber-200">SIMULATION MODE ACTIVE</h3>
                        <p className="text-amber-100/80 text-sm">"Dry Run" is enabled. No changes will be made to Plex.</p>
                    </div>
                </div>
            )}

            {/* Controls */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm text-muted">
                    <Activity className="h-4 w-4 text-plex" />
                    Real-time automation overview
                    {isOffline ? (
                        <span className="rounded-full border border-red-500/40 bg-red-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red-300">
                            Offline
                        </span>
                    ) : null}
                </div>
                <div className="flex items-center gap-3">
                    <button
                        onClick={manualRefresh}
                        className={`inline-flex items-center justify-center rounded-xl border border-white/10 bg-black/20 p-2.5 text-muted transition-colors hover:bg-white/5 hover:text-text ${isRefreshing ? 'animate-spin' : ''}`}
                        title="Manual Refresh"
                        type="button"
                    >
                        <RefreshCw className="w-5 h-5" />
                    </button>

                    {isLoopActive ? (
                        <button
                            onClick={handleStopService}
                            disabled={loading || isOffline}
                            type="button"
                            className="flex items-center gap-2 rounded-xl border border-red-500/50 bg-red-500/10 px-5 py-2.5 font-bold text-red-400 transition-all hover:bg-red-500/20 active:scale-95 disabled:opacity-50"
                        >
                            <Square className="w-4 h-4 fill-current" />
                            Stop service
                        </button>
                    ) : (
                        <button
                            onClick={handleStartService}
                            disabled={loading || isOffline}
                            type="button"
                            className="flex items-center gap-2 rounded-xl border border-emerald-400/50 bg-emerald-500 px-5 py-2.5 font-bold text-background shadow-lg shadow-emerald-900/20 transition-all hover:bg-emerald-400 active:scale-95 disabled:opacity-50"
                        >
                            <Play className="w-4 h-4 fill-current" />
                            Start service
                        </button>
                    )}
                </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <DashboardStatCard
                    label="System"
                    value={isOffline ? 'Offline' : isWorking ? 'Processing' : isLoopActive ? 'Active' : 'Stopped'}
                    hint={isOffline ? 'Check connection' : isWorking ? 'Performing sync' : isLoopActive ? 'Idle & monitoring' : 'Requires start'}
                    glow={dashboardGlowClass(isOffline ? 'muted' : isWorking ? 'emerald' : isLoopActive ? 'plex' : 'amber')}
                    valueClassName="!text-xl md:!text-2xl"
                    icon={
                        isOffline ? <WifiOff className="h-4 w-4 text-muted" />
                            : isWorking ? <Cpu className="h-4 w-4 animate-spin text-emerald-400" />
                                : isLoopActive ? <Hourglass className="h-4 w-4 text-plex" />
                                    : <Power className="h-4 w-4 text-amber-400" />
                    }
                />
                <DashboardStatCard
                    label="Activity"
                    value={lastUpdateDate
                        ? lastUpdateDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
                        : '--:--:--'}
                    hint="Last run"
                    glow={dashboardGlowClass('sky')}
                    valueClassName="!text-xl md:!text-2xl font-mono"
                    icon={<Clock className="h-4 w-4 text-sky-300" />}
                />
                <DashboardStatCard
                    label="Scheduling"
                    value={isLoopActive ? (nextRun.includes('(') ? nextRun.split(' (')[0] : nextRun) : 'Inactive'}
                    hint={isLoopActive && nextRun.includes('in ')
                        ? `Next run in ${(nextRun.split('in ')[1] ?? '').replace(')', '')}`
                        : 'Auto-sync paused'}
                    glow={dashboardGlowClass(isLoopActive ? 'plex' : 'muted')}
                    valueClassName="!text-xl md:!text-2xl font-mono"
                    icon={<CalendarClock className={`h-4 w-4 ${isLoopActive ? 'text-plex' : 'text-muted'}`} />}
                />
                <DashboardStatCard
                    label="Frequency"
                    value={`${config?.pinning_interval || 0}m`}
                    hint={analyzeLastRun?.intervalConfig ? `Active: ${analyzeLastRun.intervalConfig}` : 'Standard cycle'}
                    glow={dashboardGlowClass('amber')}
                    valueClassName="!text-xl md:!text-2xl font-mono"
                    icon={<Settings className="h-4 w-4 text-amber-300" />}
                />
            </div>

            {/* --- RUN INSPECTOR --- */}
            {analyzeLastRun && (
                <DashboardPanel
                    title="Run Inspector"
                    subtitle={analyzeLastRun.source === 'status.json' ? 'From status.json' : 'Analyzed from logs'}
                    badge={(
                        <span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${
                            analyzeLastRun.status === 'COMPLETED'
                                ? 'border-emerald-400/25 bg-emerald-500/10 text-emerald-300'
                                : analyzeLastRun.status === 'RUNNING'
                                    ? 'border-plex/30 bg-plex/15 text-plex'
                                    : 'border-red-400/25 bg-red-500/10 text-red-300'
                        }`}>
                            {analyzeLastRun.status}
                        </span>
                    )}
                >
                <div className="animate-in slide-in-from-bottom-4 duration-500 space-y-4">

                    {analyzeLastRun.fairness && (
                        <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2 text-[11px]">
                            <span className="px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 text-muted">
                                Repeat block <span className="text-text font-bold">{analyzeLastRun.fairness.repeat_block_hours ?? '—'}h</span>
                            </span>
                            <span className="px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 text-muted">
                                Min items <span className="text-text font-bold">{analyzeLastRun.fairness.min_items_for_pinning ?? '—'}</span>
                            </span>
                            <span className="col-span-2 sm:col-span-1 px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 text-muted">
                                Category mode{' '}
                                <span className="text-text font-bold">
                                    {analyzeLastRun.fairness.use_random_category_mode
                                        ? `random (${analyzeLastRun.fairness.random_category_skip_percent ?? 0}% skip)`
                                        : 'default'}
                                </span>
                            </span>
                            {typeof analyzeLastRun.pinSlots === 'number' && (
                                <span className="col-span-2 sm:col-span-1 px-2.5 py-1.5 rounded-lg bg-plex/10 border border-plex/30 text-plex font-bold">
                                    Caps {analyzeLastRun.totalPins}/{analyzeLastRun.pinSlots} slots filled
                                </span>
                            )}
                        </div>
                    )}

                    <div className={`overflow-hidden rounded-xl border ${analyzeLastRun.status === 'FAILED' ? 'border-red-900/50 bg-red-950/10' : 'border-white/10 bg-black/20'}`}>
                        <div className="p-3 sm:p-4 border-b border-white/5 flex flex-col sm:flex-row sm:flex-wrap gap-3 sm:gap-4 sm:items-center sm:justify-between bg-background/30">
                            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 min-w-0">
                                <div className={`self-start px-3 py-1 rounded text-xs font-bold uppercase ${analyzeLastRun.status === 'COMPLETED' ? 'bg-emerald-500/20 text-emerald-400' :
                                    analyzeLastRun.status === 'RUNNING' ? 'bg-plex/20 text-plex' :
                                        'bg-red-500/20 text-red-400'
                                    }`}>
                                    {analyzeLastRun.status}
                                </div>
                                <div className="text-sm text-muted flex items-start sm:items-center gap-2 min-w-0">
                                    <Clock className="w-4 h-4 shrink-0 mt-0.5 sm:mt-0" />
                                    <span className="min-w-0">
                                        Started:{' '}
                                        <span className="text-text font-mono break-all">
                                            {safeParseDate(analyzeLastRun.startTime)?.toLocaleString() || analyzeLastRun.startTime}
                                        </span>
                                    </span>
                                </div>
                                <div className="text-sm text-muted">
                                    Duration: <span className="text-text font-mono">{analyzeLastRun.duration}</span>
                                </div>
                            </div>
                            <div className="self-start text-sm font-bold text-text bg-card px-3 py-1 rounded-lg border border-border">
                                Total Pinned: {analyzeLastRun.totalPins}
                                {typeof analyzeLastRun.pinSlots === 'number' ? ` / ${analyzeLastRun.pinSlots}` : ''}
                            </div>
                        </div>

                        {/* Mobile: stacked library cards */}
                        <div className="md:hidden divide-y divide-border">
                            {analyzeLastRun.libraries.length === 0 ? (
                                <div className="px-4 py-8 text-center text-muted italic text-sm">
                                    No libraries processed yet in this run.
                                </div>
                            ) : (
                                analyzeLastRun.libraries.map((lib, idx) => (
                                    <div key={`${lib.name}-${idx}`} className="p-4 space-y-3">
                                        <div className="font-semibold text-text break-words">{lib.name}</div>
                                        <div className="grid grid-cols-3 gap-2 text-center">
                                            <div className="rounded-lg border border-border/70 bg-background/40 px-2 py-2">
                                                <div className="text-[10px] uppercase tracking-wider text-muted font-bold">Found</div>
                                                <div className="text-sm text-text font-mono mt-0.5">{lib.found}</div>
                                            </div>
                                            <div className="rounded-lg border border-border/70 bg-background/40 px-2 py-2">
                                                <div className="text-[10px] uppercase tracking-wider text-muted font-bold">Eligible</div>
                                                <div className={`text-sm font-mono mt-0.5 ${(lib.eligible || 0) > 0 ? 'text-plex' : 'text-muted'}`}>
                                                    {lib.eligible}
                                                </div>
                                            </div>
                                            <div className="rounded-lg border border-border/70 bg-background/40 px-2 py-2">
                                                <div className="text-[10px] uppercase tracking-wider text-muted font-bold">Pinned</div>
                                                <div className={`text-sm font-mono mt-0.5 ${(lib.pinned || 0) > 0 ? 'text-emerald-400 font-bold' : 'text-muted'}`}>
                                                    {(lib.pinned || 0) > 0
                                                        ? `${lib.pinned}${'pin_limit' in lib && lib.pin_limit != null ? `/${lib.pin_limit}` : ''}`
                                                        : '—'}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="rounded-lg border border-border/60 bg-background/30 px-3 py-2.5 text-xs space-y-1.5">
                                            <div className="text-[10px] uppercase tracking-wider text-muted font-bold">Why / decisions</div>
                                            <div className="text-text/90 leading-relaxed">{libraryReason(lib)}</div>
                                            {'skips' in lib && formatSkipBreakdown(lib as LibraryRunStats) !== '—' && (
                                                <div className="text-muted/80 font-mono text-[10px] leading-relaxed break-words">
                                                    {formatSkipBreakdown(lib as LibraryRunStats)}
                                                </div>
                                            )}
                                            {'skip_samples' in lib && (lib as LibraryRunStats).skip_samples && (
                                                <div className="text-muted/70 text-[10px] space-y-1 pt-0.5">
                                                    {Object.entries((lib as LibraryRunStats).skip_samples || {}).map(([reason, titles]) => (
                                                        <div key={reason} className="break-words">
                                                            <span className="text-muted">{SKIP_LABELS[reason] || reason}: </span>
                                                            {(titles || []).slice(0, 3).join(', ')}
                                                            {(titles || []).length > 3 ? '…' : ''}
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>

                        {/* Desktop: table */}
                        <div className="hidden md:block overflow-x-auto">
                            <table className="w-full text-sm text-left">
                                <thead className="text-xs text-muted uppercase bg-background/60 border-b border-border">
                                    <tr>
                                        <th className="px-6 py-3">Library</th>
                                        <th className="px-6 py-3 text-center">Found</th>
                                        <th className="px-6 py-3 text-center">Eligible</th>
                                        <th className="px-6 py-3 text-center">Pinned</th>
                                        <th className="px-6 py-3">Why / fairness</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-border">
                                    {analyzeLastRun.libraries.map((lib, idx) => (
                                        <tr key={`${lib.name}-${idx}`} className="hover:bg-white/5 transition-colors align-top">
                                            <td className="px-6 py-4 font-medium text-text">{lib.name}</td>
                                            <td className="px-6 py-4 text-center text-muted">{lib.found}</td>
                                            <td className="px-6 py-4 text-center">
                                                <span className={`px-2 py-1 rounded ${(lib.eligible || 0) > 0 ? 'bg-plex/10 text-plex' : 'bg-card text-muted'}`}>
                                                    {lib.eligible}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 text-center">
                                                {(lib.pinned || 0) > 0 ? (
                                                    <span className="text-emerald-400 font-bold">
                                                        {lib.pinned}
                                                        {'pin_limit' in lib && lib.pin_limit != null ? `/${lib.pin_limit}` : ''}
                                                    </span>
                                                ) : (
                                                    <span className="text-muted">-</span>
                                                )}
                                            </td>
                                            <td className="px-6 py-4 text-xs space-y-1.5 max-w-md">
                                                <div>{libraryReason(lib)}</div>
                                                {'skips' in lib && formatSkipBreakdown(lib as LibraryRunStats) !== '—' && (
                                                    <div className="text-muted/80 font-mono text-[10px] leading-relaxed">
                                                        {formatSkipBreakdown(lib as LibraryRunStats)}
                                                    </div>
                                                )}
                                                {'skip_samples' in lib && (lib as LibraryRunStats).skip_samples && (
                                                    <div className="text-muted/70 text-[10px] space-y-0.5">
                                                        {Object.entries((lib as LibraryRunStats).skip_samples || {}).map(([reason, titles]) => (
                                                            <div key={reason}>
                                                                <span className="text-muted">{SKIP_LABELS[reason] || reason}: </span>
                                                                {(titles || []).slice(0, 3).join(', ')}
                                                                {(titles || []).length > 3 ? '…' : ''}
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                    {analyzeLastRun.libraries.length === 0 && (
                                        <tr>
                                            <td colSpan={5} className="px-6 py-8 text-center text-muted italic">
                                                No libraries processed yet in this run.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
                </DashboardPanel>
            )}

            <DashboardPanel
                title="Live Logs"
                subtitle="Worker output stream"
                controls={(
                    <button
                        type="button"
                        onClick={() => setLiveLogs(!liveLogs)}
                        className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-bold transition-all ${
                            liveLogs
                                ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300'
                                : 'border-white/10 bg-black/20 text-muted'
                        }`}
                    >
                        {liveLogs ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
                        {liveLogs ? 'Live stream on' : 'Live stream off'}
                    </button>
                )}
            >
                <div ref={logContainerRef} className="h-80 overflow-y-auto rounded-xl border border-white/10 bg-black/80 p-4 font-mono text-xs leading-relaxed text-text shadow-inner scrollbar-thin">
                    {logs ? <pre className="whitespace-pre-wrap break-all">{logs}</pre> : (
                        <div className="flex h-full flex-col items-center justify-center gap-3 text-muted">
                            <Terminal className="h-10 w-10 opacity-30" />
                            <p>Waiting for logs…</p>
                        </div>
                    )}
                </div>
            </DashboardPanel>
        </div>
    );
};

export default Dashboard;