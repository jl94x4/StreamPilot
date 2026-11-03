import React, { useEffect, useState } from 'react';
import { CalendarPlus, Copy, RefreshCw } from 'lucide-react';
import { apiFetch } from '../shared/api';
import { DashboardPanel } from '../shared/dashboard/DashboardChrome';
import { useDiscoverI18n } from '../discovery/i18n';

/**
 * The member's private calendar feed: new episodes of shows they watch and release dates of
 * what they requested, for Apple / Google / Outlook calendars to subscribe to.
 */
export const MemberCalendarPanel: React.FC<{ onToast: (message: string, type?: 'success' | 'error') => void }> = ({ onToast }) => {
    const { t } = useDiscoverI18n();
    const [url, setUrl] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        apiFetch('/api/me/calendar')
            .then((data: any) => setUrl(data?.url ? String(data.url) : null))
            .catch(() => setUrl(null));
    }, []);

    if (!url) return null;
    const webcal = url.replace(/^https?:/i, 'webcal:');

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(url);
            onToast(t('memberCalendar.copied'), 'success');
        } catch {
            onToast(t('memberCalendar.copyFailed'), 'error');
        }
    };

    const reset = async () => {
        if (!window.confirm(t('memberCalendar.resetConfirm'))) return;
        setBusy(true);
        try {
            const data: any = await apiFetch('/api/me/calendar/reset', { method: 'POST' });
            if (data?.url) setUrl(String(data.url));
            onToast(t('memberCalendar.resetDone'), 'success');
        } catch (err: any) {
            onToast(String(err?.message || t('memberCalendar.resetFailed')), 'error');
        } finally {
            setBusy(false);
        }
    };

    return (
        <DashboardPanel title={t('memberCalendar.title')} subtitle={t('memberCalendar.subtitle')}>
            <div className="flex flex-col gap-3">
                <div className="flex flex-col sm:flex-row gap-2">
                    <input
                        readOnly
                        value={url}
                        onFocus={(event) => event.currentTarget.select()}
                        aria-label={t('memberCalendar.title')}
                        className="w-full min-w-0 bg-background border border-border text-text rounded-lg px-3 py-2 text-sm font-mono"
                    />
                    <button
                        type="button"
                        onClick={copy}
                        className="shrink-0 inline-flex items-center justify-center gap-2 rounded-xl border border-border px-4 py-2 text-sm font-bold text-text hover:border-plex"
                    >
                        <Copy className="w-4 h-4" />
                        {t('memberCalendar.copy')}
                    </button>
                    <a
                        href={webcal}
                        className="shrink-0 inline-flex items-center justify-center gap-2 rounded-xl bg-plex px-4 py-2 text-sm font-bold text-background hover:bg-plex-hover"
                    >
                        <CalendarPlus className="w-4 h-4" />
                        {t('memberCalendar.subscribe')}
                    </a>
                </div>
                <p className="text-xs text-muted leading-relaxed">{t('memberCalendar.howTo')}</p>
                <button
                    type="button"
                    onClick={reset}
                    disabled={busy}
                    className="self-start inline-flex items-center gap-1.5 text-xs text-muted hover:text-text disabled:opacity-60"
                >
                    <RefreshCw className="w-3.5 h-3.5" />
                    {t('memberCalendar.reset')}
                </button>
            </div>
        </DashboardPanel>
    );
};
