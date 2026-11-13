import { Activity,AlertCircle,AlertTriangle,Calendar,CheckCircle,ChevronLeft,Clock,ExternalLink,LineChart as LucideLineChart,MapPin,Monitor,RefreshCw,TrendingUp,X } from 'lucide-react';
import React,{ useCallback,useEffect,useState } from 'react';
import ReactDOM from 'react-dom';
import { Area,AreaChart,CartesianGrid,Tooltip as RechartsTooltip,ResponsiveContainer,XAxis,YAxis } from 'recharts';

import { useDiscoverI18n } from '../discovery/i18n';
import { apiFetch } from '../shared/api';
import { portalUrl,resolvePortalAssetUrl } from '../shared/basePath';
import { appAlert } from '../shared/confirm';
import {
DashboardHero,
DashboardPageShell,
DashboardPanel,
DashboardStatCard,
DashboardSubnav,
dashboardGlowClass,
dashboardSubnavLinkClass
} from '../shared/dashboard/DashboardChrome';
import { formatDateTime } from '../shared/format';
import { NoPosterPlaceholder } from '../shared/NoPosterPlaceholder';
import { RetryablePoster } from '../shared/RetryablePoster';
import {
STATUS_PERIODS,
barsForPeriod,
fleetUptimeForPeriod,
formatDurationShort,
formatLatencyMs,
historyRowsForPeriod,
incidentsForPeriod,
latencySeriesForPeriod,
periodStats,
statusToneFromPct,
uptimeForPeriod,
type StatusPeriod,
} from '../shared/statusHealth';
import { StatusSpeedTest } from '../shared/StatusSpeedTest';
import { Loader } from '../shared/toast';
import { CustomSelect } from '../shared/ui';
import { usePoll } from '../shared/usePoll';
import { StatusServiceIcon } from './common';


const ServiceCustomSelect = ({ value, onChange, options }: { value: string, onChange: (val: string) => void, options: { id: string, name: string }[] }) => {
    const [isOpen, setIsOpen] = useState(false);
    const selected = options.find(o => o.id === value);

    return (
        <div className="relative flex-1 md:flex-none md:w-64">
            <button
                type="button"
                className="w-full bg-black/20 border border-border hover:border-white/20 rounded-lg px-4 py-2.5 text-text outline-none flex items-center justify-between transition-colors"
                onClick={() => setIsOpen(!isOpen)}
            >
                <span className="truncate">{selected ? selected.name : '-- Choose a service --'}</span>
                <svg className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
            </button>
            {isOpen && (
                <>
                    <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)}></div>
                    <div className="absolute top-full left-0 right-0 mt-2 bg-[#1a1f2e] border border-border rounded-lg shadow-2xl z-50 overflow-hidden max-h-60 overflow-y-auto">
                        {options.map(option => (
                            <button
                                key={option.id}
                                className={`w-full text-left px-4 py-3 text-sm hover:bg-white/10 transition-colors ${value === option.id ? 'bg-plex/10 text-plex font-bold' : 'text-text'}`}
                                onClick={() => {
                                    onChange(option.id);
                                    setIsOpen(false);
                                }}
                            >
                                {option.name}
                            </button>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
};

export const StatusDashboard: React.FC<{ onBack: () => void, isAdmin: boolean, isPublic?: boolean }> = ({ onBack, isAdmin, isPublic }) => {
    const { t } = useDiscoverI18n();
    const [statusData, setStatusData] = useState<any>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [hasError, setHasError] = useState(false);
    const [activeTab, setActiveTab] = useState<'overview' | 'history' | 'analytics'>('overview');
    const [selectedServiceId, setSelectedServiceId] = useState<string | null>(null);
    const [period, setPeriod] = useState<StatusPeriod>('90d');

    const displayStatus = (value: string) => ({
        online: t('statusPage.status.online'),
        degraded: t('statusPage.status.degraded'),
        offline: t('statusPage.status.offline'),
        unknown: t('statusPage.status.unknown'),
    }[value] || t('statusPage.status.unknown'));

    const fetchStatus = useCallback(async () => {
        try {
            const data = await apiFetch('/api/status');
            setStatusData(data);
            setHasError(false);
        } catch (e) {
            console.error(e);
            setHasError(true);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        void fetchStatus();
    }, [fetchStatus]);

    usePoll(() => { void fetchStatus(); }, 15_000);

    useEffect(() => {
        if (statusData && !selectedServiceId) {
            const nextServices = statusData.config?.services || [];
            if (nextServices.length > 0) {
                setSelectedServiceId(nextServices[0].id);
            }
        }
    }, [statusData, selectedServiceId]);

    if (isLoading || !statusData) {
        return (
            <DashboardPageShell>
                <DashboardHero
                    accent="emerald"
                    eyebrow={t('statusPage.page.eyebrow')}
                    title={t('statusPage.page.title')}
                    description={t('statusPage.page.description')}
                    icon={<Activity className="h-3.5 w-3.5" />}
                    actions={isPublic ? (
                        <button
                            type="button"
                            onClick={onBack}
                            className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-black/20 px-4 py-2.5 text-sm font-semibold text-muted transition-colors hover:bg-white/5 hover:text-text"
                        >
                            <ChevronLeft className="h-4 w-4" /> {t('common.back')}
                        </button>
                    ) : undefined}
                />
                {hasError ? (
                    <div className="rounded-2xl border border-white/10 bg-black/25 p-8 text-center">
                        <p className="text-status-expired mb-4">{t('statusPage.errors.loadFailed')}</p>
                        <button type="button" onClick={() => void fetchStatus()} className="rounded-xl bg-plex px-4 py-2 font-bold text-background">
                            {t('common.retry')}
                        </button>
                    </div>
                ) : (
                    <Loader isLoading={true} />
                )}
            </DashboardPageShell>
        );
    }

    const { config, healthData } = statusData;
    const services = config?.services || [];
    const groups = config?.groups || [];
    const serviceIds = services.map((s: any) => s.id);
    const statusCounts = services.reduce((acc: any, service: any) => {
        const status = healthData[service.id]?.currentStatus || 'unknown';
        acc.total += 1;
        acc[status] = (acc[status] || 0) + 1;
        return acc;
    }, { total: 0, online: 0, degraded: 0, offline: 0, unknown: 0 });
    const fleetPct = fleetUptimeForPeriod(healthData, serviceIds, period);
    const periodLabel = STATUS_PERIODS.find((p) => p.id === period)?.label || period;
    const selectedService = services.find((s: any) => s.id === selectedServiceId) || services[0];
    const selectedHealth = selectedService ? healthData[selectedService.id] : null;
    const selectedStats = periodStats(selectedHealth, period);
    const selectedBars = barsForPeriod(selectedHealth, period);
    const selectedLatencySeries = latencySeriesForPeriod(selectedHealth, period);
    const knownGroupIds = new Set((groups || []).map((group: any) => String(group?.id ?? '')));
    const ungroupedServices = (services || []).filter((service: any) => {
        const groupId = service?.groupId;
        if (groupId == null || groupId === '') return true;
        return !knownGroupIds.has(String(groupId));
    });
    const overviewGroups = [
        ...(Array.isArray(groups) ? groups : []),
        ...(ungroupedServices.length
            ? [{ id: '__ungrouped__', name: t('statusPage.labels.ungrouped'), order: 9999 }]
            : []),
    ];

    const barClassForTone = (tone: string) => {
        if (tone === 'online') return 'bg-status-active hover:shadow-[0_0_8px_rgba(35,134,54,0.6)]';
        if (tone === 'offline') return 'bg-status-expired hover:shadow-[0_0_8px_rgba(218,54,51,0.6)]';
        if (tone === 'degraded') return 'bg-status-expiring hover:shadow-[0_0_8px_rgba(210,153,34,0.6)]';
        return 'bg-border';
    };

    const heightForTone = (tone: string) => {
        if (tone === 'online') return 'h-full';
        if (tone === 'degraded') return 'h-2/3';
        if (tone === 'offline') return 'h-1/3';
        return 'h-1/5';
    };

    const statusTabs = [
        { id: 'overview' as const, label: t('statusPage.tabs.overview'), icon: Monitor },
        { id: 'history' as const, label: t('statusPage.tabs.history'), icon: Clock },
        { id: 'analytics' as const, label: t('statusPage.tabs.analytics'), icon: LucideLineChart },
    ];

    return (
        <DashboardPageShell>
            <DashboardHero
                accent="emerald"
                eyebrow={t('statusPage.page.eyebrow')}
                title={t('statusPage.page.title')}
                description={(
                    <>
                        {t('statusPage.summary.online', { online: statusCounts.online, total: statusCounts.total })}
                        {statusCounts.offline > 0 ? (
                            <span className="text-status-expired"> · {t('statusPage.summary.offline', { count: statusCounts.offline })}</span>
                        ) : null}
                        {' · '}{t('statusPage.summary.fleetUptime', { period: periodLabel, value: fleetPct.toFixed(1) })}
                    </>
                )}
                icon={<Activity className="h-3.5 w-3.5" />}
                secondaryBlob
                actions={(
                    <>
                        {isPublic ? (
                            <button
                                type="button"
                                onClick={onBack}
                                className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-black/20 px-4 py-2.5 text-sm font-semibold text-muted transition-colors hover:bg-white/5 hover:text-text"
                            >
                                <ChevronLeft className="h-4 w-4" /> {t('statusPage.actions.back')}
                            </button>
                        ) : null}
                        <div className="flex flex-wrap gap-1 rounded-xl border border-white/10 bg-black/20 p-1">
                            {STATUS_PERIODS.map((p) => (
                                <button
                                    key={p.id}
                                    type="button"
                                    onClick={() => setPeriod(p.id)}
                                    className={`rounded-lg px-3.5 py-2 text-xs font-bold uppercase tracking-wider transition-all border-none outline-none cursor-pointer ${
                                        period === p.id ? 'bg-plex text-background shadow-md shadow-plex/25' : 'bg-transparent text-muted hover:text-text hover:bg-white/5'
                                    }`}
                                >
                                    {p.label}
                                </button>
                            ))}
                        </div>
                        <button
                            type="button"
                            onClick={() => void fetchStatus()}
                            className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-black/20 px-4 py-2.5 text-sm font-semibold text-muted transition-colors hover:bg-white/5 hover:text-text"
                        >
                            <RefreshCw className="h-4 w-4" /> {t('statusPage.actions.refresh')}
                        </button>
                    </>
                )}
            />

            <div className="md:hidden">
                <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-muted">
                    {t('statusPage.labels.section')}
                </label>
                <CustomSelect
                    id="status-section-select"
                    value={activeTab}
                    onChange={(val) => setActiveTab(val as typeof activeTab)}
                    options={statusTabs.map((tab) => {
                        const Icon = tab.icon;
                        return {
                            label: tab.label,
                            value: tab.id,
                            icon: <Icon className="h-4 w-4" />,
                        };
                    })}
                />
            </div>

            <DashboardSubnav className="mb-1">
                {statusTabs.map((tab) => {
                    const Icon = tab.icon;
                    return (
                        <button
                            key={tab.id}
                            type="button"
                            onClick={() => setActiveTab(tab.id)}
                            className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold whitespace-nowrap transition-colors border-none outline-none cursor-pointer ${dashboardSubnavLinkClass(activeTab === tab.id)}`}
                        >
                            <Icon className="h-4 w-4 shrink-0" />
                            <span>{tab.label}</span>
                        </button>
                    );
                })}
            </DashboardSubnav>

            <main className="user-content">
                {activeTab === 'overview' && (
                    <>
                        <div className="mb-6 grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-5">
                            <DashboardStatCard
                                label={t('statusPage.labels.services')}
                                value={statusCounts.total}
                                icon={<Monitor className="h-4 w-4 text-sky-300" />}
                                glow={dashboardGlowClass('sky')}
                            />
                            <DashboardStatCard
                                label={t('statusPage.status.online')}
                                value={statusCounts.online}
                                icon={<CheckCircle className="h-4 w-4 text-emerald-300" />}
                                glow={dashboardGlowClass('emerald')}
                                valueClassName="text-status-active"
                            />
                            <DashboardStatCard
                                label={t('statusPage.status.degraded')}
                                value={statusCounts.degraded}
                                icon={<AlertTriangle className="h-4 w-4 text-amber-300" />}
                                glow={dashboardGlowClass('amber')}
                                valueClassName="text-status-expiring"
                            />
                            <DashboardStatCard
                                label={t('statusPage.status.offline')}
                                value={statusCounts.offline}
                                icon={<AlertCircle className="h-4 w-4 text-rose-300" />}
                                glow={dashboardGlowClass('rose')}
                                valueClassName="text-status-expired"
                            />
                            <DashboardStatCard
                                label={t('statusPage.labels.periodUptime', { period: periodLabel })}
                                value={`${fleetPct.toFixed(1)}%`}
                                icon={<TrendingUp className="h-4 w-4 text-plex" />}
                                glow={dashboardGlowClass('plex')}
                                valueClassName="text-plex"
                            />
                        </div>

                        {!isPublic && <StatusSpeedTest />}

                        {config.announcement && config.announcement.enabled && (
                            <div className="status-announcement">
                                {config.announcement.message}
                            </div>
                        )}

                        {groups.length === 0 && (
                            <DashboardPanel title={t('statusPage.empty.noServicesTitle')} subtitle={t('statusPage.empty.noServicesSubtitle')}>
                                <div className="flex flex-col items-center justify-center p-8 text-center">
                                    <Activity className="mb-4 h-12 w-12 text-muted opacity-50" />
                                    <p className="max-w-md text-muted">
                                        {t('statusPage.empty.blank')}
                                        {isAdmin ? (
                                            <>
                                                {' '}{t('statusPage.empty.adminHint')}
                                            </>
                                        ) : (
                                            <>
                                                {' '}{t('statusPage.empty.memberHint')}
                                            </>
                                        )}
                                    </p>
                                </div>
                            </DashboardPanel>
                        )}

                        {overviewGroups.map((group: any) => {
                            const groupServices = group.id === '__ungrouped__'
                                ? ungroupedServices
                                : services.filter((s: any) => s.groupId === group.id);
                            if (groupServices.length === 0) return null;
                            return (
                                <DashboardPanel
                                    key={group.id}
                                    title={group.name}
                                    subtitle={t('statusPage.labels.groupSummary', { count: groupServices.length, period: periodLabel })}
                                    className="mb-6"
                                >
                                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                                        {groupServices.map((service: any, index: number) => {
                                            const health = healthData[service.id] || { currentStatus: 'unknown', uptimePercentage: 100, dailyHistory: {} };
                                            const uptime = uptimeForPeriod(health, period);
                                            const bars = barsForPeriod(health, period);
                                            const latency = health.lastLatency;
                                            const avgLatency = periodStats(health, period).latency.avg;
                                            const rangeLeft = period === '24h'
                                                ? t('statusPage.relative.hoursAgo', { count: 24 })
                                                : period === '7d'
                                                    ? t('statusPage.relative.daysAgo', { count: 7 })
                                                    : period === '30d'
                                                        ? t('statusPage.relative.daysAgo', { count: 30 })
                                                        : t('statusPage.relative.daysAgo', { count: 90 });
                                            return (
                                                <div key={service.id} className="relative overflow-hidden rounded-2xl border border-white/10 bg-black/20 p-4 md:p-5 flex flex-col gap-4 animate-fade-in transition-all duration-300 hover:-translate-y-0.5 hover:border-emerald-400/25 hover:shadow-lg hover:shadow-emerald-500/5" style={{ animationFillMode: 'both', animationDelay: `${index * 75}ms` }}>
                                                    <div className="flex justify-between items-start mb-2 gap-3">
                                                        <div className="flex items-start gap-3 min-w-0 flex-1">
                                                            <StatusServiceIcon service={service} />
                                                            <div className="min-w-0 flex-1">
                                                                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                                                    <h4 className="font-bold text-text text-lg leading-tight break-words" title={service.name}>{service.name}</h4>
                                                                    {isAdmin && service.visibleToUsers === false ? (
                                                                        <span className="rounded-full border border-white/10 bg-black/30 px-1.5 py-0.5 text-[10px] font-semibold text-muted" title={t('statusPage.labels.adminOnlyHint')}>
                                                                            {t('statusPage.labels.adminOnly')}
                                                                        </span>
                                                                    ) : null}
                                                                </div>
                                                                {service.description && <p className="text-xs text-muted mt-0.5 line-clamp-2">{service.description}</p>}
                                                            </div>
                                                        </div>
                                                        <span className={`shrink-0 px-3 py-1 rounded-full text-[0.65rem] uppercase tracking-wider font-bold border flex items-center gap-1.5 shadow-lg transition-all duration-300 ${health.currentStatus === 'online' ? 'bg-status-active/10 text-status-active border-status-active/30 shadow-[0_0_10px_rgba(35,134,54,0.3)]' : health.currentStatus === 'offline' ? 'bg-status-expired/10 text-[#D32F2F] border-[#D32F2F]/30 shadow-[0_0_10px_rgba(211,47,47,0.3)] animate-pulse' : 'bg-status-expiring/10 text-status-expiring border-status-expiring/30 shadow-[0_0_10px_rgba(210,153,34,0.3)]'}`}>
                                                            {health.currentStatus === 'online' && <span className="w-1.5 h-1.5 rounded-full bg-status-active animate-pulse shadow-[0_0_5px_rgba(35,134,54,0.8)]" />}
                                                            {health.currentStatus === 'offline' && <span className="w-1.5 h-1.5 rounded-full bg-[#D32F2F] animate-ping" />}
                                                            {health.currentStatus === 'degraded' && <span className="w-1.5 h-1.5 rounded-full bg-status-expiring animate-pulse shadow-[0_0_5px_rgba(210,153,34,0.8)]" />}
                                                            {displayStatus(health.currentStatus || 'unknown')}
                                                        </span>
                                                    </div>
                                                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted font-medium">
                                                        <span>{t('statusPage.labels.uptimeValue', { period: periodLabel, value: uptime.pct.toFixed(1) })}</span>
                                                        <span>{t('statusPage.labels.latencyValue', { value: formatLatencyMs(latency) })}
                                                            {avgLatency != null && <span className="text-muted font-normal"> {t('statusPage.labels.average', { value: formatLatencyMs(avgLatency) })}</span>}
                                                        </span>
                                                    </div>
                                                    <div className="flex gap-[2px] h-12 mt-auto items-end pt-4 group/bars relative">
                                                        {bars.map((bar, i) => {
                                                            const tone = statusToneFromPct(bar.pct);
                                                            const title = bar.pct == null
                                                                ? `${bar.label}: ${t('statusPage.empty.noData')}`
                                                                : `${bar.label}: ${bar.pct.toFixed(1)}% ${t('statusPage.analytics.uptime')}${bar.avgLatency != null ? ` · ${formatLatencyMs(bar.avgLatency)} ${t('statusPage.labels.average')}` : ''}`;
                                                            return (
                                                                <div
                                                                    key={bar.key}
                                                                    className={`flex-1 rounded-sm transition-all duration-300 hover:opacity-100 opacity-60 cursor-pointer animate-fade-in ${barClassForTone(tone)} ${heightForTone(tone)}`}
                                                                    style={{ animationFillMode: 'both', animationDelay: `${Math.min(i, 40) * 10}ms` }}
                                                                    title={title}
                                                                />
                                                            );
                                                        })}
                                                    </div>
                                                    <div className="flex justify-between text-[10px] text-muted font-bold tracking-wider mt-1 opacity-50 uppercase">
                                                        <span>{rangeLeft}</span>
                                                        <span className="text-center flex-1 tabular-nums">{uptime.pct.toFixed(1)}%</span>
                                                        <span>Now</span>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </DashboardPanel>
                            );
                        })}
                    </>
                )}

                {activeTab === 'history' && (
                    <div className="flex flex-col gap-6 animate-fade-in">
                        {services.map((service: any) => {
                            const health = healthData[service.id];
                            const rows = historyRowsForPeriod(health, period);
                            const incidents = incidentsForPeriod(health, period);
                            return (
                                <DashboardPanel
                                    key={service.id}
                                    title={service.name}
                                    subtitle={t('statusPage.history.subtitle', { period: periodLabel })}
                                    badge={(
                                        <div className="flex items-center gap-2">
                                            {isAdmin && service.visibleToUsers === false ? (
                                                <span className="rounded-full border border-white/10 bg-black/30 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-muted" title={t('statusPage.labels.adminOnlyHint')}>
                                                    {t('statusPage.labels.adminOnly')}
                                                </span>
                                            ) : null}
                                            <span className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-muted">
                                                {periodLabel}
                                            </span>
                                        </div>
                                    )}
                                >
                                    <div className="overflow-x-auto rounded-xl border border-white/5">
                                        <table className="w-full text-left border-collapse">
                                            <thead className="bg-black/40 border-b border-border text-muted text-xs uppercase tracking-wider">
                                                <tr>
                                                    <th className="px-6 py-4 font-bold whitespace-nowrap">{period === '24h' || period === '7d' ? t('statusPage.history.hourUtc') : t('statusPage.history.date')}</th>
                                                    <th className="px-6 py-4 font-bold whitespace-nowrap">{t('statusPage.history.uptimePercent')}</th>
                                                    <th className="px-6 py-4 font-bold whitespace-nowrap">{t('statusPage.history.checks')}</th>
                                                    {(period === '24h' || period === '7d') && (
                                                        <th className="px-6 py-4 font-bold whitespace-nowrap">{t('statusPage.history.averageLatency')}</th>
                                                    )}
                                                    <th className="px-6 py-4 font-bold text-right whitespace-nowrap">{t('statusPage.history.status')}</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-border/50">
                                                {rows.length === 0 ? (
                                                    <tr>
                                                        <td colSpan={period === '24h' || period === '7d' ? 5 : 4} className="px-6 py-8 text-center text-muted text-sm">
                                                            {t('statusPage.empty.noHistory')}
                                                        </td>
                                                    </tr>
                                                ) : rows.map((row) => {
                                                    const tone = statusToneFromPct(row.pct);
                                                    return (
                                                        <tr key={row.key} className="hover:bg-white/5 transition-colors">
                                                            <td className="px-6 py-4 font-medium whitespace-nowrap text-text">{row.label}</td>
                                                            <td className="px-6 py-4 font-mono whitespace-nowrap text-muted">{row.pct.toFixed(2)}%</td>
                                                            <td className="px-6 py-4 text-muted text-sm whitespace-nowrap">{row.up} / {row.total} checks</td>
                                                            {(period === '24h' || period === '7d') && (
                                                                <td className="px-6 py-4 text-muted text-sm whitespace-nowrap tabular-nums">{formatLatencyMs(row.avgLatency)}</td>
                                                            )}
                                                            <td className="px-6 py-4 text-right whitespace-nowrap">
                                                                <span className={`px-2.5 py-1 rounded-full text-[10px] uppercase font-bold tracking-widest border ${tone === 'online' ? 'bg-status-active/10 text-status-active border-status-active/30' : tone === 'degraded' ? 'bg-status-expiring/10 text-status-expiring border-status-expiring/30' : tone === 'offline' ? 'bg-status-expired/10 text-status-expired border-status-expired/30' : 'bg-white/5 text-muted border-border'}`}>
                                                                    {tone === 'online' ? t('statusPage.status.healthy') : tone === 'degraded' ? t('statusPage.status.degraded') : tone === 'offline' ? t('statusPage.status.outage') : t('statusPage.status.unknown')}
                                                                </span>
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                    <div className="border-t border-border/50 p-4 bg-black/10">
                                        <h4 className="text-xs font-bold uppercase tracking-widest text-muted mb-3">{t('statusPage.incidents.title', { period: periodLabel })}</h4>
                                        {incidents.length === 0 ? (
                                            <p className="text-sm text-muted">{t('statusPage.empty.noIncidents')}</p>
                                        ) : (
                                            <div className="overflow-x-auto">
                                                <table className="w-full text-left border-collapse text-sm">
                                                    <thead className="text-muted text-[10px] uppercase tracking-wider">
                                                        <tr>
                                                            <th className="pb-2 pr-4 font-bold">{t('statusPage.incidents.started')}</th>
                                                            <th className="pb-2 pr-4 font-bold">{t('statusPage.incidents.ended')}</th>
                                                            <th className="pb-2 pr-4 font-bold">{t('statusPage.incidents.duration')}</th>
                                                            <th className="pb-2 font-bold text-right">{t('statusPage.incidents.severity')}</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-border/40">
                                                        {incidents.map((incident) => {
                                                            const duration = incident.endedAt != null
                                                                ? (incident.durationMs ?? Math.max(0, incident.endedAt - incident.startedAt))
                                                                : Math.max(0, Date.now() - incident.startedAt);
                                                            const severityTone = incident.to === 'offline' ? 'offline' : 'degraded';
                                                            const severity = severityTone === 'offline' ? t('statusPage.status.offline') : t('statusPage.status.degraded');
                                                            return (
                                                                <tr key={incident.id}>
                                                                    <td className="py-2.5 pr-4 text-text whitespace-nowrap">{formatDateTime(new Date(incident.startedAt).toISOString())}</td>
                                                                    <td className="py-2.5 pr-4 text-muted whitespace-nowrap">{incident.endedAt != null ? formatDateTime(new Date(incident.endedAt).toISOString()) : t('statusPage.incidents.ongoing')}</td>
                                                                    <td className="py-2.5 pr-4 text-muted tabular-nums">{formatDurationShort(duration)}</td>
                                                                    <td className="py-2.5 text-right">
                                                                        <span className={`px-2 py-0.5 rounded-full text-[10px] uppercase font-bold tracking-widest border ${severityTone === 'offline' ? 'bg-status-expired/10 text-status-expired border-status-expired/30' : 'bg-status-expiring/10 text-status-expiring border-status-expiring/30'}`}>
                                                                            {severity}
                                                                        </span>
                                                                    </td>
                                                                </tr>
                                                            );
                                                        })}
                                                    </tbody>
                                                </table>
                                            </div>
                                        )}
                                    </div>
                                </DashboardPanel>
                            );
                        })}
                    </div>
                )}

                {activeTab === 'analytics' && (
                    <div className="flex flex-col gap-6 animate-fade-in">
                        {services.length > 1 && (
                            <div className="flex flex-wrap gap-2 rounded-xl border border-white/10 bg-black/20 p-1">
                                {services.map((service: any) => (
                                    <button
                                        key={service.id}
                                        type="button"
                                        onClick={() => setSelectedServiceId(service.id)}
                                        className={`rounded-lg px-4 py-2 text-sm font-bold transition-colors border-none outline-none cursor-pointer ${
                                            selectedService?.id === service.id
                                                ? 'bg-plex text-background shadow-md shadow-plex/25'
                                                : 'bg-transparent text-muted hover:bg-white/5 hover:text-text'
                                        }`}
                                    >
                                        {service.name}
                                    </button>
                                ))}
                            </div>
                        )}

                        {selectedService && (
                            <>
                                <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
                                    <DashboardStatCard label={t('statusPage.analytics.uptime')} value={`${selectedStats.pct.toFixed(2)}%`} icon={<TrendingUp className="h-4 w-4 text-emerald-300" />} glow={dashboardGlowClass('emerald')} />
                                    <DashboardStatCard label={t('statusPage.analytics.checks')} value={selectedStats.total.toLocaleString()} icon={<Activity className="h-4 w-4 text-sky-300" />} glow={dashboardGlowClass('sky')} />
                                    <DashboardStatCard label={t('statusPage.analytics.averageLatency')} value={formatLatencyMs(selectedStats.latency.avg)} icon={<Clock className="h-4 w-4 text-plex" />} glow={dashboardGlowClass('plex')} />
                                    <DashboardStatCard label={t('statusPage.analytics.p95Latency')} value={formatLatencyMs(selectedStats.latency.p95)} icon={<Clock className="h-4 w-4 text-violet-300" />} glow={dashboardGlowClass('violet')} />
                                    <DashboardStatCard label={t('statusPage.analytics.incidents')} value={String(selectedStats.incidentCount)} icon={<AlertTriangle className="h-4 w-4 text-amber-300" />} glow={dashboardGlowClass('amber')} />
                                    <DashboardStatCard label={t('statusPage.analytics.longestOutage')} value={formatDurationShort(selectedStats.longestOutageMs)} icon={<AlertCircle className="h-4 w-4 text-rose-300" />} glow={dashboardGlowClass('rose')} />
                                    <DashboardStatCard label={t('statusPage.analytics.healthyStreak')} value={selectedStats.currentStreakHours ? `${selectedStats.currentStreakHours}h` : '—'} icon={<CheckCircle className="h-4 w-4 text-emerald-300" />} glow={dashboardGlowClass('emerald')} />
                                    <DashboardStatCard label={t('statusPage.analytics.worstDay')} value={selectedStats.worstDay ? `${selectedStats.worstDay.pct.toFixed(1)}%` : '—'} icon={<Calendar className="h-4 w-4 text-muted" />} glow={dashboardGlowClass('muted')} />
                                </div>

                                <DashboardPanel
                                    title={t('statusPage.analytics.uptimeTrend', { name: selectedService.name })}
                                    subtitle={t('statusPage.analytics.rollingUptime', { period: periodLabel })}
                                >
                                    <div className="relative h-64 md:h-80 flex items-end gap-1 w-full pl-12 pr-4 md:pr-8">
                                        <div className="absolute inset-0 pl-12 pr-4 md:pr-8 flex flex-col justify-between pointer-events-none pb-8">
                                            {['100%', '75%', '50%', '25%', '0%'].map((label) => (
                                                <div key={label} className={`w-full border-t ${label === '0%' ? 'border-white/20' : 'border-white/5'} h-0 relative`}>
                                                    <span className="absolute -left-12 -top-2.5 text-xs font-mono text-muted/50 w-10 text-right">{label}</span>
                                                </div>
                                            ))}
                                        </div>
                                        <div className="w-full h-full flex items-end gap-[2px] pb-8 z-10">
                                            {selectedBars.map((bar) => {
                                                const pct = bar.pct ?? 0;
                                                const hasData = bar.pct != null && bar.total > 0;
                                                return (
                                                    <div key={bar.key} className="flex-1 flex flex-col justify-end h-full relative group/chart cursor-crosshair">
                                                        <div
                                                            className={`w-full rounded-t-sm transition-all duration-300 opacity-80 group-hover/chart:opacity-100 ${
                                                                !hasData ? 'bg-white/10' : pct >= 99 ? 'bg-status-active' : pct >= 90 ? 'bg-status-expiring' : 'bg-status-expired'
                                                            }`}
                                                            style={{ height: `${Math.max(1, hasData ? pct : 1)}%` }}
                                                        />
                                                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 p-3 bg-card border border-border shadow-2xl text-white text-xs rounded-lg whitespace-nowrap opacity-0 group-hover/chart:opacity-100 pointer-events-none transition-opacity z-50 flex flex-col items-center">
                                                            <strong className="text-plex mb-1 tracking-wider uppercase text-[10px]">{bar.label}</strong>
                                                            <span className="text-lg font-mono font-bold">{hasData ? `${pct.toFixed(2)}%` : t('statusPage.empty.noData')}</span>
                                                            {bar.avgLatency != null && (
                                                                <span className="text-muted mt-0.5">{t('statusPage.labels.average', { value: formatLatencyMs(bar.avgLatency) })}</span>
                                                            )}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                    <div className="flex justify-between px-12 text-[10px] font-bold uppercase tracking-widest text-muted mt-2">
                                        <span>{period === '24h' ? t('statusPage.relative.hoursAgo', { count: 24 }) : t('statusPage.relative.periodAgo', { period: periodLabel })}</span>
                                        <span>{t('statusPage.relative.now')}</span>
                                    </div>
                                </DashboardPanel>

                                <DashboardPanel
                                    title={t('statusPage.analytics.latencyTitle', { name: selectedService.name })}
                                    subtitle={t('statusPage.analytics.averageResponseTime', { period: periodLabel })}
                                >
                                    {selectedLatencySeries.some((p) => p.avg != null) ? (
                                        <div className="h-56 md:h-72 w-full">
                                            <ResponsiveContainer width="100%" height="100%">
                                                <AreaChart data={selectedLatencySeries.filter((p) => p.avg != null)} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                                                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                                                    <XAxis dataKey="label" tick={{ fill: 'rgba(255,255,255,0.35)', fontSize: 10 }} interval="preserveStartEnd" minTickGap={28} />
                                                    <YAxis tick={{ fill: 'rgba(255,255,255,0.35)', fontSize: 10 }} width={48} tickFormatter={(v) => `${v}ms`} />
                                                    <RechartsTooltip
                                                        contentStyle={{ background: 'var(--card, #1a1a1a)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }}
                                                        labelStyle={{ color: '#e5a00d' }}
                                                        formatter={(value: any) => [formatLatencyMs(Number(value)), t('statusPage.analytics.averageLatency')]}
                                                    />
                                                    <Area type="monotone" dataKey="avg" stroke="#e5a00d" fill="rgba(229,160,13,0.2)" strokeWidth={2} />
                                                </AreaChart>
                                            </ResponsiveContainer>
                                        </div>
                                    ) : (
                                        <p className="text-center text-muted text-sm py-12">
                                            {t('statusPage.empty.latencyHistory')}
                                        </p>
                                    )}
                                    {selectedStats.bestDay && selectedStats.worstDay && period !== '24h' && (
                                        <div className="mt-6 flex flex-wrap justify-center gap-6 text-sm text-muted">
                                            <span>{t('statusPage.analytics.best', { value: selectedStats.bestDay.key, pct: selectedStats.bestDay.pct.toFixed(1) })}</span>
                                            <span>{t('statusPage.analytics.worst', { value: selectedStats.worstDay.key, pct: selectedStats.worstDay.pct.toFixed(1) })}</span>
                                        </div>
                                    )}
                                </DashboardPanel>
                            </>
                        )}
                    </div>
                )}
            </main>
        </DashboardPageShell>
    );
};
const StreamSpecCard: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-3 min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-widest text-white/40 mb-1.5">{label}</p>
        {children}
    </div>
);

export const DashboardTitleLink: React.FC<{
    ratingKey?: string | null;
    onOpen?: (ratingKey: string) => void;
    className?: string;
    children: React.ReactNode;
}> = ({ ratingKey, onOpen, className = '', children }) => {
    const key = String(ratingKey || '').trim();
    if (!key || !onOpen) {
        return <span className={className}>{children}</span>;
    }
    return (
        <button
            type="button"
            onClick={(event) => {
                event.stopPropagation();
                onOpen(key);
            }}
            className={`block max-w-full text-left ${className} hover:text-plex`.trim()}
        >
            {children}
        </button>
    );
};

export const StreamDetailsModal: React.FC<{ session: any, onClose: () => void, isAdmin?: boolean, onKilled?: () => void, providerLabel?: string, onOpenProfile?: (accountId: string) => void, onOpenTitle?: (ratingKey: string) => void }> = ({ session, onClose, isAdmin, onKilled, providerLabel = 'Plex', onOpenProfile, onOpenTitle }) => {
    const [killReason, setKillReason] = useState('');
    const [isKilling, setIsKilling] = useState(false);
    const [showKillConfirm, setShowKillConfirm] = useState(false);
    const sessionPosterSrc = session.thumbUrl
        ? resolvePortalAssetUrl(session.thumbUrl)
        : (session.thumb
            ? portalUrl(`/api/plex/image?path=${encodeURIComponent(session.thumb)}&width=400&height=600`)
            : '');
    const sessionFallbackPosterSrc = session.posterFallbackUrl ? resolvePortalAssetUrl(session.posterFallbackUrl) : '';
    const sessionUserThumbSrc = session.userThumb ? resolvePortalAssetUrl(session.userThumb) : 'https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y';
    const geo = isAdmin && session.geo && Number.isFinite(Number(session.geo.latitude)) && Number.isFinite(Number(session.geo.longitude))
        ? session.geo
        : null;
    const geoLat = geo ? Number(geo.latitude) : NaN;
    const geoLon = geo ? Number(geo.longitude) : NaN;
    const mapPad = 0.35;
    const osmEmbedUrl = geo
        ? `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(
            `${geoLon - mapPad},${geoLat - mapPad},${geoLon + mapPad},${geoLat + mapPad}`,
        )}&layer=mapnik&marker=${encodeURIComponent(`${geoLat},${geoLon}`)}`
        : '';
    const googleMapsUrl = geo
        ? `https://www.google.com/maps?q=${encodeURIComponent(`${geoLat},${geoLon}`)}`
        : '';

    // Lock background scroll while the sheet is open (esp. important on mobile).
    useEffect(() => {
        const scrollY = window.scrollY;
        const { body, documentElement } = document;
        const prev = {
            overflow: body.style.overflow,
            position: body.style.position,
            top: body.style.top,
            left: body.style.left,
            right: body.style.right,
            width: body.style.width,
            htmlOverflow: documentElement.style.overflow,
        };
        body.style.overflow = 'hidden';
        body.style.position = 'fixed';
        body.style.top = `-${scrollY}px`;
        body.style.left = '0';
        body.style.right = '0';
        body.style.width = '100%';
        documentElement.style.overflow = 'hidden';
        return () => {
            body.style.overflow = prev.overflow;
            body.style.position = prev.position;
            body.style.top = prev.top;
            body.style.left = prev.left;
            body.style.right = prev.right;
            body.style.width = prev.width;
            documentElement.style.overflow = prev.htmlOverflow;
            window.scrollTo(0, scrollY);
        };
    }, []);

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    const showTitle = session.grandparentTitle || session.title;
    const episodeLine = session.grandparentTitle
        ? [
            session.title,
            session.type === 'episode' && session.season !== undefined
                ? `S${String(session.season).padStart(2, '0')}E${String(session.episode).padStart(2, '0')}`
                : null,
        ].filter(Boolean).join(' · ')
        : (session.type === 'episode' && session.season !== undefined
            ? `S${String(session.season).padStart(2, '0')}E${String(session.episode).padStart(2, '0')}`
            : '');
    const progressPct = Math.min(100, Math.max(0, Number(session.progress) || 0));
    const resolutionLabel = session.resolution
        ? (String(session.resolution).includes('p') || String(session.resolution).includes('k')
            ? String(session.resolution).toUpperCase()
            : `${session.resolution}p`)
        : null;
    const isLocal = session.sessionLocation === 'lan';
    const bandwidthLabel = Number.isFinite(Number(session.bandwidth))
        ? `${(Number(session.bandwidth) / 1000).toFixed(1)} Mbps`
        : null;

    const handleKill = async () => {
        setIsKilling(true);
        try {
            const res = await apiFetch('/api/streams/kill', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId: session.sessionId, reason: killReason })
            });
            if (res.error) {
                void appAlert(String(res.error), { title: 'Could not stop the stream' });
            } else {
                onClose();
                if (onKilled) onKilled();
            }
        } catch (e: any) {
            void appAlert('The server did not respond. Try again in a moment.', { title: 'Could not stop the stream' });
        } finally {
            setIsKilling(false);
        }
    };

    return ReactDOM.createPortal(
        <div
            className="fixed inset-x-0 top-0 z-[300] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/80 backdrop-blur-sm animate-fade-in overscroll-none bottom-[calc(4rem+env(safe-area-inset-bottom,0px))] sm:inset-0 sm:bottom-0"
            onClick={onClose}
        >
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="stream-details-title"
                className="relative w-full sm:max-w-2xl lg:max-w-3xl max-h-full sm:max-h-[85vh] bg-card border border-white/10 rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden overscroll-contain"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-start gap-4 p-5 border-b border-white/10 bg-black/20 shrink-0">
                    <div className="w-[4.5rem] h-[6.75rem] sm:w-24 sm:h-36 rounded-xl overflow-hidden flex-shrink-0 bg-black/40 border border-white/10 shadow-lg">
                        {sessionPosterSrc || sessionFallbackPosterSrc ? (
                            <RetryablePoster
                                src={sessionPosterSrc}
                                fallbackSrc={sessionFallbackPosterSrc}
                                alt=""
                                compactPlaceholder
                                className="w-full h-full object-cover"
                            />
                        ) : (
                            <NoPosterPlaceholder compact />
                        )}
                    </div>

                    <div className="min-w-0 flex-1 pt-0.5">
                        {session.user && (
                            session.accountId && onOpenProfile ? (
                            <button
                                type="button"
                                onClick={() => onOpenProfile(String(session.accountId))}
                                className="inline-flex items-center gap-2 mb-2 rounded-full border border-white/10 bg-white/5 pl-1 pr-2.5 py-1 hover:border-plex/40"
                            >
                                <img
                                    src={sessionUserThumbSrc}
                                    alt=""
                                    className="w-5 h-5 rounded-full object-cover"
                                    onError={(e) => { e.currentTarget.src = 'https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y'; }}
                                />
                                <span className="text-[11px] font-bold text-white/80 truncate max-w-[10rem]">{session.user}</span>
                            </button>
                            ) : (
                            <div className="inline-flex items-center gap-2 mb-2 rounded-full border border-white/10 bg-white/5 pl-1 pr-2.5 py-1">
                                <img
                                    src={sessionUserThumbSrc}
                                    alt=""
                                    className="w-5 h-5 rounded-full object-cover"
                                    onError={(e) => { e.currentTarget.src = 'https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y'; }}
                                />
                                <span className="text-[11px] font-bold text-white/80 truncate max-w-[10rem]">{session.user}</span>
                            </div>
                            )
                        )}
                        <h2 id="stream-details-title" className="text-xl sm:text-2xl font-black text-text leading-tight tracking-tight">
                            <DashboardTitleLink
                                ratingKey={session.grandparentTitle ? session.grandparentRatingKey : session.ratingKey}
                                onOpen={onOpenTitle}
                                className="text-left"
                            >
                                {showTitle}
                            </DashboardTitleLink>
                        </h2>
                        {episodeLine ? (
                            <p className="text-sm text-muted mt-1 leading-snug">
                                <DashboardTitleLink ratingKey={session.ratingKey} onOpen={onOpenTitle} className="text-left">
                                    {episodeLine}
                                </DashboardTitleLink>
                            </p>
                        ) : null}

                        <div className="flex flex-wrap gap-1.5 mt-3">
                            {resolutionLabel && (
                                <span className="text-[10px] font-bold px-2 py-1 rounded-md uppercase tracking-wide bg-white/10 text-white/80 border border-white/10">
                                    {resolutionLabel}
                                </span>
                            )}
                            <span className={`text-[10px] font-bold px-2 py-1 rounded-md uppercase tracking-wide border ${
                                isLocal
                                    ? 'bg-status-active/15 text-status-active border-status-active/25'
                                    : 'bg-plex/15 text-plex border-plex/30'
                            }`}>
                                {isLocal ? 'Local' : 'Remote'}
                            </span>
                            <span className={`text-[10px] font-bold px-2 py-1 rounded-md uppercase tracking-wide border ${
                                session.isTranscoding
                                    ? 'bg-status-expiring/15 text-status-expiring border-status-expiring/25'
                                    : 'bg-status-active/15 text-status-active border-status-active/25'
                            }`}>
                                {session.isTranscoding ? 'Transcode' : 'Direct Play'}
                            </span>
                            {session.state && session.state !== 'playing' && (
                                <span className="text-[10px] font-bold px-2 py-1 rounded-md uppercase tracking-wide bg-white/10 text-white/70 border border-white/10">
                                    {session.state}
                                </span>
                            )}
                        </div>

                        {progressPct > 0 && (
                            <div className="mt-3.5 max-w-md">
                                <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                                    <div className="h-full rounded-full bg-plex transition-all" style={{ width: `${progressPct}%` }} />
                                </div>
                                <p className="text-[10px] text-muted mt-1.5 font-medium">{Math.round(progressPct)}% watched</p>
                            </div>
                        )}
                    </div>

                    <button
                        type="button"
                        onClick={onClose}
                        className="p-2 rounded-full hover:bg-white/10 text-white/45 hover:text-white transition-colors shrink-0"
                        aria-label="Close"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Body */}
                <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain custom-scrollbar p-5 flex flex-col gap-4">
                    <div className="grid grid-cols-2 gap-2.5">
                        {session.playerTitle ? (
                            <StreamSpecCard label="Player">
                                <p className="text-sm font-semibold text-text truncate" title={session.playerTitle}>{session.playerTitle}</p>
                                <p className="text-xs text-muted truncate mt-0.5" title={session.playerProduct}>{session.playerProduct || '—'}</p>
                            </StreamSpecCard>
                        ) : null}
                        <StreamSpecCard label="Network">
                            <p className="text-sm font-semibold text-text font-mono tracking-tight truncate">
                                {isAdmin ? (session.playerAddress || 'Unknown IP') : 'Hidden'}
                            </p>
                            {bandwidthLabel && <p className="text-xs text-muted mt-0.5 truncate">{bandwidthLabel}</p>}
                        </StreamSpecCard>
                        <StreamSpecCard label="Video">
                            <p className="text-sm font-semibold text-text uppercase tracking-wide truncate">
                                {session.videoCodec || 'Unknown'}
                                {session.videoProfile ? ` · ${session.videoProfile}` : ''}
                            </p>
                            {session.transcodeVideoDecision === 'transcode' && (
                                <p className="text-[10px] text-status-expiring font-bold mt-1">Transcoding</p>
                            )}
                        </StreamSpecCard>
                        <StreamSpecCard label="Audio">
                            <p className="text-sm font-semibold text-text uppercase tracking-wide truncate">
                                {session.audioCodec || 'Unknown'}
                                {session.audioChannels ? ` · ${session.audioChannels}ch` : ''}
                            </p>
                            {session.transcodeAudioDecision === 'transcode' && (
                                <p className="text-[10px] text-status-expiring font-bold mt-1">Transcoding</p>
                            )}
                        </StreamSpecCard>
                    </div>

                    {geo && osmEmbedUrl && (
                        <div className="rounded-xl overflow-hidden border border-white/10 bg-white/[0.03]">
                            <div className="flex items-center justify-between gap-3 px-3.5 py-2.5 border-b border-white/10">
                                <div className="min-w-0 flex items-center gap-2">
                                    <MapPin className="w-3.5 h-3.5 text-plex shrink-0" />
                                    <div className="min-w-0">
                                        <p className="text-sm font-semibold text-text truncate">{geo.label}</p>
                                        <p className="text-[10px] text-muted">Approximate location from IP</p>
                                    </div>
                                </div>
                                <a
                                    href={googleMapsUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="shrink-0 inline-flex items-center gap-1.5 text-[11px] font-bold text-plex hover:text-plex-hover transition-colors"
                                >
                                    <ExternalLink className="w-3 h-3" />
                                    Google Maps
                                </a>
                            </div>
                            {/* Crop OSM’s dense attribution strip on small screens */}
                            <div className="relative w-full h-36 sm:h-44 overflow-hidden">
                                <iframe
                                    title={`Approximate location: ${geo.label}`}
                                    src={osmEmbedUrl}
                                    className="absolute inset-0 w-full h-[calc(100%+28px)] border-0"
                                    loading="lazy"
                                    referrerPolicy="no-referrer-when-downgrade"
                                />
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer sits above the mobile bottom nav (overlay stops above it) */}
                <div className="shrink-0 border-t border-white/10 bg-black/30 p-4 sm:p-5">
                    {isAdmin && session.sessionId && showKillConfirm ? (
                        <div className="flex flex-col gap-2 rounded-xl border border-red-500/25 bg-red-500/10 p-3">
                            <input
                                type="text"
                                placeholder="Reason (optional)"
                                value={killReason}
                                onChange={e => setKillReason(e.target.value)}
                                className="w-full bg-black/30 border border-red-500/30 rounded-lg px-3 py-2 text-sm text-white placeholder-white/40 focus:outline-none focus:border-red-500"
                            />
                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    onClick={handleKill}
                                    disabled={isKilling}
                                    className="flex-1 bg-red-500 hover:bg-red-600 text-white font-bold py-2.5 rounded-xl transition-colors text-sm disabled:opacity-50"
                                >
                                    {isKilling ? 'Terminating…' : 'Confirm terminate'}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setShowKillConfirm(false)}
                                    className="px-4 bg-white/10 hover:bg-white/15 text-white font-bold py-2.5 rounded-xl transition-colors text-sm"
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="flex flex-col sm:flex-row gap-2.5">
                            {isAdmin && session.sessionId && (
                                <button
                                    type="button"
                                    onClick={() => setShowKillConfirm(true)}
                                    className="w-full sm:flex-1 bg-red-500/15 hover:bg-red-500/25 text-red-300 border border-red-500/30 font-bold py-3 rounded-xl transition-colors text-sm inline-flex items-center justify-center gap-2"
                                >
                                    <X className="w-4 h-4" /> Terminate Stream
                                </button>
                            )}
                            <a
                                href={session.plexUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="w-full sm:flex-1 bg-plex hover:bg-plex-hover text-background font-bold text-center py-3 rounded-xl transition-colors text-sm inline-flex items-center justify-center gap-2"
                            >
                                Open in {providerLabel}
                            </a>
                        </div>
                    )}
                </div>
            </div>
        </div>,
        document.body,
    );
};

const EMPTY_STREAM_MESSAGES = [
    "Nobody is watching... the server can finally breathe.",
    "0 streams active. The hard drives are enjoying a well-earned nap.",
    "The popcorn is ready. The audience is missing.",
    "All quiet on the streaming front.",
    "The server is awake. The humans are not.",
    "No one is streaming... the GPUs are confused.",
    "No streams detected. Suspicious behaviour.",
    "Everyone left. The server is binge-watching itself.",
    "No one is watching. Somewhere, a movie is feeling ignored.",
    "No active viewers. Time to dust off the virtual popcorn machine.",
    "The only thing streaming right now is disappointment.",
    "The server is ready. The couch is empty.",
    "The media centre is open 24/7. The viewers are not.",
    "The server has 10,000 movies and nobody pressed play.",
    "No active sessions. The bandwidth is feeling useless.",
    "The server is fully loaded and emotionally unavailable.",
    "The Plex goblins are idle.",
    "The server is bored. Please entertain it.",
    "No viewers detected. Initiating dramatic silence.",
    "The hard drives are spinning... for nothing.",
    "Even the thumbnails are getting lonely."
];

export const EmptyStreamsMessage: React.FC = () => {
    const [msg] = useState(() => EMPTY_STREAM_MESSAGES[Math.floor(Math.random() * EMPTY_STREAM_MESSAGES.length)]);
    return <div className="text-center text-muted p-8 border border-dashed border-border rounded-xl mt-4 w-full">{msg}</div>;
};

export type AdminOpsSnapshot = {
    checkedAt: number;
    fleetUptime24h: number | null;
    serviceCount: number;
    unhealthyCount: number;
    offlineCount: number;
    unhealthyNames: string[];
    requestPending: number;
    requestEngineConnected: boolean;
    notificationUnread: number;
    notificationTotal: number;
    failingJobs: number;
    runningJobs: number;
};
