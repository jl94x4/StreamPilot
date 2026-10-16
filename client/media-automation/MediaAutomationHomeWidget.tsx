import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Cpu, ListTodo, RefreshCw, TriangleAlert } from 'lucide-react';
import { useDiscoverI18n } from '../discovery/i18n';
import { mediaAutomationApi } from './api';
import type { MediaAutomationStatus } from './types';

type Props = { onOpen?: () => void };

export const MediaAutomationHomeWidget: React.FC<Props> = ({ onOpen }) => {
    const { t } = useDiscoverI18n();
    const [status, setStatus] = useState<MediaAutomationStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const load = useCallback(async () => {
        setLoading(true);
        try {
            setStatus(await mediaAutomationApi.status());
            setError('');
        } catch (err: any) {
            setError(err?.message || t('homeDashboard.widgets.mediaAutomation.unavailable'));
        } finally {
            setLoading(false);
        }
    }, [t]);

    useEffect(() => {
        void load();
        const timer = window.setInterval(() => void load(), 15000);
        return () => window.clearInterval(timer);
    }, [load]);

    const dryRun = !!(status?.dryRun || status?.outputMode === 'dry-run');
    const failed = Number(status?.failedJobs || status?.metrics?.failed24h || 0);
    const paused = status ? (status.workerPaused ?? status.paused) !== false : false;
    const stats = [
        { label: t('homeDashboard.widgets.mediaAutomation.queued'), value: status?.queuedJobs ?? 0, icon: ListTodo, className: 'text-amber-300' },
        { label: t('homeDashboard.widgets.mediaAutomation.active'), value: status?.activeJobs ?? 0, icon: Cpu, className: 'text-sky-300' },
        { label: t('homeDashboard.widgets.mediaAutomation.complete'), value: status?.completedJobs ?? 0, icon: CheckCircle2, className: 'text-emerald-300' },
        { label: t('homeDashboard.widgets.mediaAutomation.failed'), value: failed, icon: TriangleAlert, className: 'text-red-300' },
    ];

    return (
        <div className="glass-card p-4 md:p-5 shadow-xl w-full">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
                <div className="flex items-center gap-3 lg:min-w-[15rem]">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-violet-400/30 bg-violet-500/15">
                        <Cpu className="h-5 w-5 text-violet-300" />
                    </div>
                    <div>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-muted">Media Automation</p>
                        <p className="font-bold text-text">{paused ? t('homeDashboard.widgets.mediaAutomation.pausedQueueOnly') : t('homeDashboard.widgets.mediaAutomation.encoding')}</p>
                    </div>
                </div>
                {error && !status ? (
                    <p className="flex-1 text-xs text-red-300">{error}</p>
                ) : (
                    <div className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-4">
                        {stats.map(({ label, value, icon: Icon, className }) => (
                            <div key={label} className="flex items-center gap-2 rounded-xl border border-border bg-background/40 px-3 py-2.5">
                                <Icon className={`h-4 w-4 ${className}`} />
                                <div><p className="text-lg font-black leading-none text-text">{value}</p><p className="mt-1 text-[9px] font-bold uppercase tracking-wider text-muted">{label}</p></div>
                            </div>
                        ))}
                    </div>
                )}
                <div className="flex flex-wrap items-center justify-between gap-2 lg:justify-end">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase ${paused ? 'border-amber-500/30 text-amber-300' : 'border-emerald-500/30 text-emerald-300'}`}>
                            {paused ? t('homeDashboard.widgets.mediaAutomation.pausedQueueOnly') : t('homeDashboard.widgets.mediaAutomation.encoding')}
                        </span>
                        {dryRun && (
                            <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[10px] font-bold uppercase text-amber-200">
                                {t('homeDashboard.widgets.mediaAutomation.dryRun')}
                            </span>
                        )}
                        {failed > 0 && (
                            <span className="rounded-full border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-[10px] font-bold uppercase text-red-200">
                                {t('homeDashboard.widgets.mediaAutomation.failedCount', { count: failed })}
                            </span>
                        )}
                    </div>
                    <button type="button" onClick={() => void load()} className="rounded-lg p-2 text-muted hover:bg-white/5 hover:text-text" title={t('homeDashboard.admin.refresh')}>
                        <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                    </button>
                    {onOpen && <button type="button" onClick={onOpen} className="text-xs font-bold text-violet-300 hover:underline">{t('homeDashboard.widgets.mediaAutomation.open')}</button>}
                </div>
            </div>
        </div>
    );
};

export default MediaAutomationHomeWidget;
