import React, { useCallback, useEffect, useState } from 'react';
import { CalendarPlus, Check, ChevronDown, ChevronRight, X } from 'lucide-react';
import { apiFetch } from '../shared/api';
import { useDiscoverI18n } from '../discovery/i18n';

/**
 * Users page: members' requests for more time (approve / decline in one click) and the
 * settings for the feature. Collapsed to one line when there is nothing waiting.
 */

type Settings = { enabled: boolean; monthOptions: number[]; showWithinDays: number };
type Row = {
    id: string;
    userId: string;
    username: string;
    months: number;
    note: string;
    status: 'pending' | 'approved' | 'declined';
    createdAt: string;
    decidedAt: string | null;
    decidedMonths: number | null;
    adminNote: string;
    newExpiryDate: string | null;
    currentExpiryDate: string | null;
    userExists: boolean;
};

const formatDate = (iso: string | null | undefined) => (iso
    ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    : '—');

const PendingRow: React.FC<{
    row: Row;
    options: number[];
    onDecide: (row: Row, approve: boolean, months: number, note: string) => Promise<void>;
}> = ({ row, options, onDecide }) => {
    const { t } = useDiscoverI18n();
    const [months, setMonths] = useState(row.months);
    const [note, setNote] = useState('');
    const [busy, setBusy] = useState(false);
    const choices = options.includes(row.months) ? options : [...options, row.months].sort((a, b) => a - b);
    const decide = async (approve: boolean) => {
        setBusy(true);
        try {
            await onDecide(row, approve, months, note);
        } finally {
            setBusy(false);
        }
    };
    return (
        <li className="rounded-xl border border-border bg-black/10 p-4 flex flex-col gap-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-bold text-text">
                    {t('extensionRequests.admin.asked', { name: row.username, months: t('extensionRequests.monthsOption', { count: row.months }) })}
                </p>
                <span className="text-xs text-muted">
                    {t('extensionRequests.admin.expires', { date: formatDate(row.currentExpiryDate) })} · {formatDate(row.createdAt)}
                </span>
            </div>
            {row.note ? <p className="text-sm text-muted whitespace-pre-wrap border-l-2 border-plex/40 pl-3">{row.note}</p> : null}
            {!row.userExists ? <p className="text-xs text-red-400">{t('extensionRequests.admin.userGone')}</p> : null}
            <div className="flex flex-col sm:flex-row gap-2">
                <select
                    value={months}
                    onChange={(event) => setMonths(Number(event.target.value))}
                    aria-label={t('extensionRequests.admin.grant')}
                    className="sm:w-40 shrink-0 bg-background border border-border text-text rounded-lg px-3 py-2 text-sm"
                >
                    {choices.map((option) => (
                        <option key={option} value={option}>{t('extensionRequests.monthsOption', { count: option })}</option>
                    ))}
                </select>
                <input
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    maxLength={500}
                    placeholder={t('extensionRequests.admin.notePlaceholder')}
                    className="w-full min-w-0 bg-background border border-border text-text rounded-lg px-3 py-2 text-sm"
                />
            </div>
            <div className="flex gap-2">
                <button
                    type="button"
                    disabled={busy || !row.userExists}
                    onClick={() => decide(true)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-plex px-4 py-2 text-sm font-bold text-background hover:bg-plex-hover disabled:opacity-60"
                >
                    <Check className="h-4 w-4" />
                    {t('extensionRequests.admin.approve')}
                </button>
                <button
                    type="button"
                    disabled={busy}
                    onClick={() => decide(false)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-sm font-bold text-text hover:border-red-400/60 hover:text-red-300 disabled:opacity-60"
                >
                    <X className="h-4 w-4" />
                    {t('extensionRequests.admin.decline')}
                </button>
            </div>
        </li>
    );
};

export const ExtensionRequestsAdmin: React.FC<{
    addToast: (message: string, type?: 'success' | 'error') => void;
    onChanged?: () => void;
}> = ({ addToast, onChanged }) => {
    const { t } = useDiscoverI18n();
    const [settings, setSettings] = useState<Settings | null>(null);
    const [pending, setPending] = useState<Row[]>([]);
    const [recent, setRecent] = useState<Row[]>([]);
    const [open, setOpen] = useState(false);
    const [optionsText, setOptionsText] = useState('');
    const [savingSettings, setSavingSettings] = useState(false);

    const load = useCallback(() => {
        apiFetch('/api/extension-requests')
            .then((data: any) => {
                setSettings(data.settings);
                setOptionsText((data.settings?.monthOptions || []).join(', '));
                setPending(Array.isArray(data.pending) ? data.pending : []);
                setRecent(Array.isArray(data.recent) ? data.recent : []);
                if (Array.isArray(data.pending) && data.pending.length) setOpen(true);
            })
            .catch(() => undefined);
    }, []);

    useEffect(() => { load(); }, [load]);

    const decide = async (row: Row, approve: boolean, months: number, note: string) => {
        try {
            await apiFetch(`/api/extension-requests/${encodeURIComponent(row.id)}/${approve ? 'approve' : 'decline'}`, {
                method: 'POST',
                body: JSON.stringify({ months, note }),
            });
            addToast(approve
                ? t('extensionRequests.admin.approvedToast', { name: row.username })
                : t('extensionRequests.admin.declinedToast', { name: row.username }), 'success');
            load();
            if (approve) onChanged?.();
        } catch (err: any) {
            addToast(String(err?.message || t('extensionRequests.admin.decisionFailed')), 'error');
        }
    };

    const saveSettings = async (next: Settings) => {
        setSavingSettings(true);
        try {
            const saved: any = await apiFetch('/api/extension-requests/settings', { method: 'PUT', body: JSON.stringify(next) });
            setSettings(saved);
            setOptionsText((saved?.monthOptions || []).join(', '));
            addToast(t('extensionRequests.admin.settingsSaved'), 'success');
        } catch (err: any) {
            addToast(String(err?.message || t('extensionRequests.admin.settingsFailed')), 'error');
        } finally {
            setSavingSettings(false);
        }
    };

    if (!settings) return null;
    const parsedOptions = optionsText.split(',').map((part) => Number(part.trim())).filter((n) => Number.isFinite(n) && n >= 1);

    return (
        <section className="mb-6 rounded-2xl border border-border bg-black/10">
            <button
                type="button"
                onClick={() => setOpen(!open)}
                aria-expanded={open}
                className="w-full flex items-center gap-3 px-4 py-3 text-left"
            >
                <CalendarPlus className="h-4 w-4 text-plex shrink-0" />
                <span className="flex-1 min-w-0 text-sm font-bold uppercase tracking-[2px] text-plex">{t('extensionRequests.admin.title')}</span>
                {pending.length ? (
                    <span className="rounded-full bg-plex px-2.5 py-0.5 text-xs font-black text-background">{pending.length}</span>
                ) : (
                    <span className="text-xs text-muted">{settings.enabled ? t('extensionRequests.admin.noneWaiting') : t('extensionRequests.admin.off')}</span>
                )}
                {open ? <ChevronDown className="h-4 w-4 text-muted" /> : <ChevronRight className="h-4 w-4 text-muted" />}
            </button>
            {open ? (
                <div className="px-4 pb-4 flex flex-col gap-4">
                    {pending.length ? (
                        <ul className="flex flex-col gap-3">
                            {pending.map((row) => (
                                <PendingRow key={row.id} row={row} options={settings.monthOptions} onDecide={decide} />
                            ))}
                        </ul>
                    ) : null}

                    <div className="rounded-xl border border-border p-4 flex flex-col gap-3">
                        <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                                <p className="font-bold text-text">{t('extensionRequests.admin.enable')}</p>
                                <p className="text-xs text-muted">{t('extensionRequests.admin.enableHint')}</p>
                            </div>
                            <button
                                type="button"
                                role="switch"
                                aria-checked={settings.enabled}
                                aria-label={t('extensionRequests.admin.enable')}
                                disabled={savingSettings}
                                onClick={() => saveSettings({ ...settings, enabled: !settings.enabled })}
                                className={`relative inline-flex items-center h-6 rounded-full w-11 shrink-0 transition-colors ${settings.enabled ? 'bg-plex' : 'bg-border'}`}
                            >
                                <span className={`inline-block w-4 h-4 transform bg-white rounded-full transition-transform ${settings.enabled ? 'translate-x-6' : 'translate-x-1'}`} />
                            </button>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                            <label className="text-xs text-muted flex flex-col gap-1">
                                {t('extensionRequests.admin.lengths')}
                                <input
                                    value={optionsText}
                                    onChange={(event) => setOptionsText(event.target.value)}
                                    placeholder="1, 3, 12"
                                    className="bg-background border border-border text-text rounded-lg px-3 py-2 text-sm"
                                />
                            </label>
                            <label className="text-xs text-muted flex flex-col gap-1">
                                {t('extensionRequests.admin.window')}
                                <input
                                    type="number"
                                    min={1}
                                    max={90}
                                    value={settings.showWithinDays}
                                    onChange={(event) => setSettings({ ...settings, showWithinDays: Number(event.target.value) })}
                                    className="bg-background border border-border text-text rounded-lg px-3 py-2 text-sm"
                                />
                            </label>
                        </div>
                        <div>
                            <button
                                type="button"
                                disabled={savingSettings || !parsedOptions.length}
                                onClick={() => saveSettings({ ...settings, monthOptions: parsedOptions })}
                                className="rounded-lg border border-border px-4 py-2 text-sm font-bold text-text hover:border-plex disabled:opacity-60"
                            >
                                {t('extensionRequests.admin.saveSettings')}
                            </button>
                        </div>
                    </div>

                    {recent.length ? (
                        <div>
                            <p className="text-xs uppercase tracking-widest font-semibold text-muted mb-2">{t('extensionRequests.admin.recent')}</p>
                            <ul className="flex flex-col divide-y divide-border/60 text-sm">
                                {recent.map((row) => (
                                    <li key={row.id} className="py-2 flex flex-wrap items-baseline justify-between gap-2">
                                        <span className="text-text">
                                            {row.username} · {t('extensionRequests.monthsOption', { count: row.decidedMonths || row.months })}
                                        </span>
                                        <span className={row.status === 'approved' ? 'text-green-400' : 'text-red-300'}>
                                            {row.status === 'approved'
                                                ? t('extensionRequests.admin.approvedUntil', { date: formatDate(row.newExpiryDate) })
                                                : t('extensionRequests.admin.declinedOn', { date: formatDate(row.decidedAt) })}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ) : null}
                </div>
            ) : null}
        </section>
    );
};

export default ExtensionRequestsAdmin;
