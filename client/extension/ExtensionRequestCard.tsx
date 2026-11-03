import React, { useCallback, useEffect, useState } from 'react';
import { CalendarPlus, CheckCircle2, Clock, XCircle } from 'lucide-react';
import { apiFetch } from '../shared/api';
import { useDiscoverI18n } from '../discovery/i18n';

/**
 * "Request more time": shown to members inside the expiry window (and on the expired page).
 * Renders nothing when the admin has the feature off or the member can't ask yet.
 */

type ExtensionRequest = {
    id: string;
    months: number;
    note: string;
    status: 'pending' | 'approved' | 'declined';
    createdAt: string;
    decidedAt: string | null;
    decidedMonths: number | null;
    adminNote: string;
    newExpiryDate: string | null;
};

type ExtensionStatus = {
    enabled: boolean;
    eligible?: boolean;
    reason?: string | null;
    monthOptions?: number[];
    pending?: ExtensionRequest | null;
    latest?: ExtensionRequest | null;
};

const RECENT_DECISION_MS = 7 * 24 * 60 * 60 * 1000;

const formatDate = (iso: string | null | undefined) => (iso
    ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    : '');

export const ExtensionRequestCard: React.FC<{ className?: string }> = ({ className = '' }) => {
    const { t } = useDiscoverI18n();
    const [status, setStatus] = useState<ExtensionStatus | null>(null);
    const [months, setMonths] = useState<number | null>(null);
    const [note, setNote] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(() => {
        apiFetch('/api/me/extension')
            .then((data: any) => {
                setStatus(data as ExtensionStatus);
                const options: number[] = Array.isArray(data?.monthOptions) ? data.monthOptions : [];
                setMonths((current) => (current && options.includes(current) ? current : options[0] ?? null));
            })
            .catch(() => setStatus({ enabled: false }));
    }, []);

    useEffect(() => { load(); }, [load]);

    const monthsLabel = (n: number) => t('extensionRequests.monthsOption', { count: n });

    const submit = async () => {
        if (!months) return;
        setBusy(true);
        setError(null);
        try {
            await apiFetch('/api/me/extension', { method: 'POST', body: JSON.stringify({ months, note }) });
            setNote('');
            load();
        } catch (err: any) {
            setError(String(err?.message || t('extensionRequests.sendFailed')));
        } finally {
            setBusy(false);
        }
    };

    const cancel = async () => {
        setBusy(true);
        try {
            await apiFetch('/api/me/extension', { method: 'DELETE' });
            load();
        } catch (err: any) {
            setError(String(err?.message || t('extensionRequests.cancelFailed')));
        } finally {
            setBusy(false);
        }
    };

    if (!status?.enabled) return null;
    const latest = status.latest;
    const recentDecision = latest?.decidedAt && Date.now() - Date.parse(latest.decidedAt) < RECENT_DECISION_MS ? latest : null;
    if (!status.pending && !status.eligible && !recentDecision) return null;

    const shell = `rounded-xl border p-4 text-left ${className}`;

    if (status.pending) {
        return (
            <div className={`${shell} border-plex/30 bg-plex/5`}>
                <p className="flex items-center gap-2 text-sm font-bold text-text">
                    <Clock className="h-4 w-4 text-plex shrink-0" />
                    {t('extensionRequests.pendingTitle', { months: monthsLabel(status.pending.months) })}
                </p>
                <p className="mt-1 text-xs text-muted">{t('extensionRequests.pendingHint', { date: formatDate(status.pending.createdAt) })}</p>
                <button type="button" onClick={cancel} disabled={busy} className="mt-3 text-xs text-muted underline underline-offset-2 hover:text-text disabled:opacity-60">
                    {t('extensionRequests.cancel')}
                </button>
                {error ? <p className="mt-2 text-xs text-red-400">{error}</p> : null}
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-3">
            {recentDecision ? (
                <div className={`${shell} ${recentDecision.status === 'approved' ? 'border-green-500/30 bg-green-500/5' : 'border-red-500/30 bg-red-500/5'}`}>
                    <p className="flex items-center gap-2 text-sm font-bold text-text">
                        {recentDecision.status === 'approved'
                            ? <CheckCircle2 className="h-4 w-4 text-green-400 shrink-0" />
                            : <XCircle className="h-4 w-4 text-red-400 shrink-0" />}
                        {recentDecision.status === 'approved'
                            ? t('extensionRequests.approvedTitle', { date: formatDate(recentDecision.newExpiryDate) })
                            : t('extensionRequests.declinedTitle')}
                    </p>
                    {recentDecision.adminNote ? <p className="mt-1 text-xs text-muted whitespace-pre-wrap">{recentDecision.adminNote}</p> : null}
                </div>
            ) : null}
            {status.eligible ? (
                <div className={`${shell} border-white/10 bg-black/20`}>
                    <p className="text-sm font-bold text-text">{t('extensionRequests.askTitle')}</p>
                    <p className="mt-1 text-xs text-muted">{t('extensionRequests.askHint')}</p>
                    <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label={t('extensionRequests.askTitle')}>
                        {(status.monthOptions || []).map((option) => (
                            <button
                                key={option}
                                type="button"
                                role="radio"
                                aria-checked={months === option}
                                onClick={() => setMonths(option)}
                                className={`rounded-lg border px-3 py-1.5 text-sm font-semibold transition-colors ${months === option ? 'border-plex bg-plex/15 text-plex' : 'border-border text-text hover:border-plex/50'}`}
                            >
                                {monthsLabel(option)}
                            </button>
                        ))}
                    </div>
                    <textarea
                        value={note}
                        onChange={(event) => setNote(event.target.value)}
                        maxLength={500}
                        rows={2}
                        placeholder={t('extensionRequests.notePlaceholder')}
                        className="mt-3 w-full rounded-lg border border-border bg-background px-3 py-2 text-[16px] sm:text-sm text-text outline-none focus:border-plex"
                    />
                    <button
                        type="button"
                        onClick={submit}
                        disabled={busy || !months}
                        className="mt-3 inline-flex items-center gap-2 rounded-xl bg-plex px-4 py-2.5 text-sm font-bold text-background hover:bg-plex-hover disabled:opacity-60"
                    >
                        <CalendarPlus className="h-4 w-4" />
                        {t('extensionRequests.send')}
                    </button>
                    {error ? <p className="mt-2 text-xs text-red-400">{error}</p> : null}
                </div>
            ) : null}
        </div>
    );
};

export default ExtensionRequestCard;
