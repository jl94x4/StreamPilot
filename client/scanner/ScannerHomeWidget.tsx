import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Clock3, FolderInput, ListTodo, Radar, RefreshCw, Target } from 'lucide-react';
import { apiFetch } from '../shared/api';
import { useDiscoverI18n } from '../discovery/i18n';
import { usePoll } from '../shared/usePoll';
import { formatScannerWhen, scannerActionStyles, shortenScannerPath } from './eventMeta';
import { ScannerSourceBadge } from './ScannerSourceBadge';

type ScannerStatus = {
    enabled?: boolean;
    remaining?: number;
    processed?: number;
    targetCount?: number;
    minimumAge?: string;
    held?: number;
    lastActivity?: {
        at?: string;
        ok?: boolean;
        folder?: string;
        source?: string;
        error?: string;
        reason?: string;
        action?: string;
        title?: string;
        isUpgrade?: boolean;
    } | null;
};

type Props = {
    onOpen?: () => void;
};

export const ScannerHomeWidget: React.FC<Props> = ({ onOpen }) => {
    const { t } = useDiscoverI18n();
    const [status, setStatus] = useState<ScannerStatus | null>(null);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);
    const loadGenRef = useRef(0);

    const load = useCallback(async () => {
        const gen = ++loadGenRef.current;
        setLoading(true);
        setError('');
        try {
            const data = await apiFetch('/api/scanner/status');
            if (gen !== loadGenRef.current) return;
            setStatus(data || null);
        } catch (e: any) {
            if (gen !== loadGenRef.current) return;
            setError(e?.message || t('homeDashboard.widgets.scanner.unavailable'));
            setStatus(null);
        } finally {
            if (gen === loadGenRef.current) setLoading(false);
        }
    }, [t]);

    useEffect(() => {
        void load();
    }, [load]);

    usePoll(() => { void load(); }, 15_000);

    const remaining = status?.remaining ?? 0;
    const held = status?.held ?? 0;
    const processed = status?.processed ?? 0;
    const targets = status?.targetCount ?? 0;
    const last = status?.lastActivity;
    const active = !!status?.enabled;
    const lastStyle = scannerActionStyles(last?.action || last?.reason, last?.isUpgrade);

    return (
        <div className="glass-card p-4 md:p-5 shadow-xl w-full overflow-hidden">
            <div className="flex flex-col gap-4">
                <div className="flex flex-col lg:flex-row lg:items-center gap-4 lg:gap-6">
                    <div className="flex items-center justify-between gap-3 lg:min-w-[14rem] shrink-0">
                        <div className="flex items-center gap-3 min-w-0">
                            <div className="w-10 h-10 rounded-xl bg-sky-500/15 border border-sky-400/30 flex items-center justify-center shrink-0">
                                <Radar className="w-5 h-5 text-sky-300" />
                            </div>
                            <div className="min-w-0">
                                <p className="text-muted text-[10px] uppercase tracking-widest font-bold">Scanner</p>
                                <p className="text-text font-bold text-base truncate">{t('homeDashboard.widgets.scanner.subtitle')}</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2 lg:hidden">
                            <button
                                type="button"
                                onClick={() => { void load(); }}
                                className="p-1.5 rounded-lg text-muted hover:text-text hover:bg-white/5 transition-colors"
                                title={t('homeDashboard.admin.refresh')}
                            >
                                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                            </button>
                        </div>
                    </div>

                    {error && !status ? (
                        <p className="text-xs text-red-300/90 flex-1">{error}</p>
                    ) : (
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 flex-1 min-w-0">
                            <div className="rounded-xl bg-amber-500/10 border border-amber-400/25 px-3 py-2.5 flex items-center gap-2.5">
                                <ListTodo className="w-4 h-4 text-amber-300 shrink-0" />
                                <div>
                                    <p className="text-lg font-black text-amber-50 leading-none">{remaining}</p>
                                    <p className="text-[9px] uppercase tracking-wider font-bold text-amber-200/80 mt-1">{t('homeDashboard.widgets.scanner.queued')}</p>
                                </div>
                            </div>
                            <div className="rounded-xl bg-emerald-500/10 border border-emerald-400/25 px-3 py-2.5 flex items-center gap-2.5">
                                <CheckCircle2 className="w-4 h-4 text-emerald-300 shrink-0" />
                                <div>
                                    <p className="text-lg font-black text-emerald-50 leading-none">{processed}</p>
                                    <p className="text-[9px] uppercase tracking-wider font-bold text-emerald-200/80 mt-1">{t('homeDashboard.widgets.scanner.processed')}</p>
                                </div>
                            </div>
                            <div className="rounded-xl bg-violet-500/10 border border-violet-400/25 px-3 py-2.5 flex items-center gap-2.5">
                                <Target className="w-4 h-4 text-violet-300 shrink-0" />
                                <div>
                                    <p className="text-lg font-black text-violet-50 leading-none">{targets}</p>
                                    <p className="text-[9px] uppercase tracking-wider font-bold text-violet-200/80 mt-1">{t('homeDashboard.widgets.scanner.targets')}</p>
                                </div>
                            </div>
                            <div className="rounded-xl bg-sky-500/10 border border-sky-400/25 px-3 py-2.5 flex items-center gap-2.5">
                                <Clock3 className="w-4 h-4 text-sky-300 shrink-0" />
                                <div>
                                    <p className="text-lg font-black text-sky-50 leading-none">{status?.minimumAge ?? '—'}</p>
                                    <p className="text-[9px] uppercase tracking-wider font-bold text-sky-200/80 mt-1">{t('homeDashboard.widgets.scanner.minAge')}</p>
                                </div>
                            </div>
                        </div>
                    )}

                    <div className="hidden lg:flex items-center gap-2 shrink-0">
                        <span className={`inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border ${
                            active
                                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                                : 'bg-white/5 border-white/10 text-muted'
                        }`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-emerald-400 animate-pulse' : 'bg-muted'}`} />
                            {active ? t('homeDashboard.widgets.scanner.armed') : t('homeDashboard.widgets.scanner.idle')}
                        </span>
                        <button
                            type="button"
                            onClick={() => { void load(); }}
                            className="p-2 rounded-lg text-muted hover:text-text hover:bg-white/5 transition-colors"
                            title={t('homeDashboard.admin.refresh')}
                        >
                            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                        </button>
                        {onOpen ? (
                            <button
                                type="button"
                                onClick={onOpen}
                                className="text-xs font-bold text-sky-300 hover:underline px-1"
                            >
                                {t('homeDashboard.widgets.scanner.open')}
                            </button>
                        ) : null}
                    </div>
                </div>

                {held > 0 ? (
                    <p className="text-xs font-medium text-sky-200/90">{t('homeDashboard.widgets.scanner.waitingForPlex', { count: held })}</p>
                ) : null}

                <div className="space-y-2">
                    <div className="flex items-center justify-between gap-3 px-0.5">
                        <p className="text-[10px] uppercase tracking-[0.14em] font-bold text-muted">{t('homeDashboard.widgets.scanner.latestActivity')}</p>
                        {last?.at ? (
                            <p className="text-[11px] text-muted/80 tabular-nums shrink-0">{formatScannerWhen(last.at)}</p>
                        ) : null}
                    </div>
                    {last ? (
                        <div
                            className={`relative overflow-hidden rounded-xl border px-3.5 py-3.5 sm:px-4 sm:py-4 ${
                                last.ok
                                    ? 'border-emerald-400/20 bg-gradient-to-br from-emerald-500/[0.08] via-white/[0.03] to-transparent'
                                    : 'border-red-400/25 bg-gradient-to-br from-red-500/[0.10] via-white/[0.03] to-transparent'
                            }`}
                        >
                            <div
                                className={`absolute inset-y-0 left-0 w-1 ${
                                    last.ok ? 'bg-emerald-400/70' : 'bg-red-400/70'
                                }`}
                                aria-hidden
                            />
                            <div className="pl-2.5 sm:pl-3 flex flex-col gap-2.5 min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                    <span
                                        className={`inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md border ${
                                            last.ok
                                                ? 'bg-emerald-500/15 border-emerald-400/35 text-emerald-200'
                                                : 'bg-red-500/15 border-red-400/35 text-red-200'
                                        }`}
                                    >
                                        {last.ok ? (
                                            <CheckCircle2 className="w-3 h-3 shrink-0" />
                                        ) : (
                                            <span className="w-1.5 h-1.5 rounded-full bg-red-300 shrink-0" />
                                        )}
                                        {last.ok ? t('homeDashboard.widgets.scanner.success') : t('homeDashboard.widgets.scanner.failed')}
                                    </span>
                                    {(last.reason || last.action) ? (
                                        <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md border ${lastStyle.className}`}>
                                            {last.reason || (lastStyle.labelKey ? t(lastStyle.labelKey) : lastStyle.label)}
                                        </span>
                                    ) : null}
                                    <ScannerSourceBadge source={last.source} className="ml-0.5" />
                                </div>

                                <div className="min-w-0">
                                    {last.title ? (
                                        <p className="text-[15px] leading-snug text-text font-semibold tracking-tight truncate" title={last.title}>
                                            {last.title}
                                        </p>
                                    ) : (
                                        <p className="text-sm text-muted">{t('homeDashboard.widgets.scanner.noTitleReported')}</p>
                                    )}
                                    {last.error ? (
                                        <p className="text-xs text-red-200/90 mt-1.5 truncate" title={last.error}>{last.error}</p>
                                    ) : null}
                                </div>

                                {last.folder ? (
                                    <p
                                        className="inline-flex items-center gap-1.5 max-w-full text-xs text-muted/90 font-medium"
                                        title={last.folder}
                                    >
                                        <FolderInput className="w-3.5 h-3.5 shrink-0 text-sky-300/70" />
                                        <span className="truncate">{shortenScannerPath(last.folder, 5)}</span>
                                    </p>
                                ) : null}
                            </div>
                        </div>
                    ) : (
                        <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.02] px-4 py-5 text-center">
                            <p className="text-sm text-muted">{t('homeDashboard.widgets.scanner.waitingForScan')}</p>
                        </div>
                    )}
                </div>

                <div className="flex items-center justify-between gap-2 lg:hidden">
                    <span className={`inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full border ${
                        active
                            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                            : 'bg-white/5 border-white/10 text-muted'
                    }`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-emerald-400 animate-pulse' : 'bg-muted'}`} />
                        {active ? t('homeDashboard.widgets.scanner.armed') : t('homeDashboard.widgets.scanner.idle')}
                        {status?.minimumAge ? ` · ${status.minimumAge}` : ''}
                    </span>
                    {onOpen ? (
                        <button
                            type="button"
                            onClick={onOpen}
                            className="text-xs font-bold text-sky-300 hover:underline"
                        >
                            {t('homeDashboard.widgets.scanner.open')}
                        </button>
                    ) : null}
                </div>
            </div>
        </div>
    );
};

export default ScannerHomeWidget;
