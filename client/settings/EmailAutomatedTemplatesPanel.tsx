import React, { useMemo, useState } from 'react';
import { apiFetch } from '../shared/api';
import { useDiscoverI18n } from '../discovery/i18n';
import { SettingFieldLabel, SettingHint } from './SettingHint';

const EVENT_LABEL_KEYS: Record<string, string> = {
    expiry_warning: 'settings.emailTemplates.events.expiry_warning',
    access_expired: 'settings.emailTemplates.events.access_expired',
    access_adjusted: 'settings.emailTemplates.events.access_adjusted',
    invite: 'settings.emailTemplates.events.invite',
    welcome: 'settings.emailTemplates.events.welcome',
    newsletter: 'settings.emailTemplates.events.newsletter',
    announcement: 'settings.emailTemplates.events.announcement',
};

const FIELD_LABEL_KEYS: Record<string, string> = {
    subject: 'settings.emailTemplates.fields.subject',
    headline: 'settings.emailTemplates.fields.headline',
    intro: 'settings.emailTemplates.fields.intro',
    body: 'settings.emailTemplates.fields.body',
    ctaLabel: 'settings.emailTemplates.fields.ctaLabel',
    renewTitle: 'settings.emailTemplates.fields.renewTitle',
    renewBody: 'settings.emailTemplates.fields.renewBody',
    footer: 'settings.emailTemplates.fields.footer',
    footerSecondary: 'settings.emailTemplates.fields.footerSecondary',
};

const EVENT_VARIABLE_HINTS: Record<string, string> = {
    expiry_warning: '{username} {days} {days_label} {expiry_date} {server_name} {contact_url}',
    access_expired: '{username} {expiry_date} {status} {server_name} {contact_email} {contact_whatsapp}',
    access_adjusted: '{username} {new_expiry_date} {days} {days_label} {time_remaining} {server_name}',
    invite: '{server_name} {invite_url} {duration_days}',
    welcome: '{username} {server_name} {portal_url}',
    newsletter: '{username} {server_name} {portal_url}',
    announcement: '{server_name} {announcement}',
};

type Props = {
    emailTemplates: Record<string, Record<string, string>>;
    setEmailTemplates: (next: Record<string, Record<string, string>>) => void;
    defaults: Record<string, Record<string, string>>;
    events: string[];
    eventFields: Record<string, string[]>;
    addToast?: (message: string, tone?: 'success' | 'error' | 'info') => void;
};

export const EmailAutomatedTemplatesPanel: React.FC<Props> = ({
    emailTemplates,
    setEmailTemplates,
    defaults,
    events,
    eventFields,
    addToast,
}) => {
    const { t } = useDiscoverI18n();
    const eventList = events?.length ? events : Object.keys(EVENT_LABEL_KEYS);
    const [activeEvent, setActiveEvent] = useState(eventList[0] || 'expiry_warning');
    const [previewHtml, setPreviewHtml] = useState<string | null>(null);
    const [previewSubject, setPreviewSubject] = useState('');
    const [previewOpen, setPreviewOpen] = useState(false);
    const [busyAction, setBusyAction] = useState<'preview' | 'test' | null>(null);
    const fields = eventFields?.[activeEvent] || [];
    const eventLabel = (event: string) => (EVENT_LABEL_KEYS[event] ? t(EVENT_LABEL_KEYS[event]) : event);
    const fieldLabel = (field: string) => (FIELD_LABEL_KEYS[field] ? t(FIELD_LABEL_KEYS[field]) : field);

    const effectiveValue = (field: string) => {
        const override = emailTemplates?.[activeEvent]?.[field];
        if (override != null && String(override).trim()) return String(override);
        return String(defaults?.[activeEvent]?.[field] || '');
    };

    const isOverridden = (field: string) => {
        const override = emailTemplates?.[activeEvent]?.[field];
        return override != null && String(override).trim() !== '';
    };

    const setField = (field: string, value: string) => {
        const nextEvent = { ...(emailTemplates?.[activeEvent] || {}) };
        const trimmed = value.trim();
        const defaultValue = String(defaults?.[activeEvent]?.[field] || '');
        if (!trimmed || trimmed === defaultValue) {
            delete nextEvent[field];
        } else {
            nextEvent[field] = value;
        }
        const nextAll = { ...emailTemplates };
        if (Object.keys(nextEvent).length) nextAll[activeEvent] = nextEvent;
        else delete nextAll[activeEvent];
        setEmailTemplates(nextAll);
    };

    const resetEvent = () => {
        const nextAll = { ...emailTemplates };
        delete nextAll[activeEvent];
        setEmailTemplates(nextAll);
    };

    const draftTemplates = useMemo(() => {
        const out: Record<string, string> = {};
        for (const field of fields) {
            const value = effectiveValue(field);
            if (value.trim()) out[field] = value;
        }
        return out;
    }, [fields, emailTemplates, defaults, activeEvent]);

    const variableHint = useMemo(
        () => EVENT_VARIABLE_HINTS[activeEvent] || '{username} {server_name}',
        [activeEvent],
    );

    const runPreview = async () => {
        setBusyAction('preview');
        try {
            const res = await apiFetch('/api/settings/email-templates/preview', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ event: activeEvent, templates: draftTemplates }),
            });
            setPreviewSubject(String(res?.subject || ''));
            setPreviewHtml(String(res?.html || ''));
            setPreviewOpen(true);
        } catch (error: any) {
            addToast?.(error?.message || t('settings.emailTemplates.previewFailed'), 'error');
        } finally {
            setBusyAction(null);
        }
    };

    const runTestSend = async () => {
        setBusyAction('test');
        try {
            const res = await apiFetch('/api/settings/email-templates/test', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ event: activeEvent, templates: draftTemplates }),
            });
            addToast?.(String(res?.message || t('settings.emailTemplates.testSent')), 'success');
        } catch (error: any) {
            addToast?.(error?.message || t('settings.emailTemplates.testFailed'), 'error');
        } finally {
            setBusyAction(null);
        }
    };

    return (
        <div className="space-y-3">
            <SettingHint>
                {t('settings.emailTemplates.hint')}
                {' '}
                {t('settings.emailTemplates.variablesLabel')} <code className="text-[11px]">{variableHint}</code>
            </SettingHint>

            <div className="flex flex-wrap gap-2">
                {eventList.map((event) => (
                    <button
                        key={event}
                        type="button"
                        onClick={() => setActiveEvent(event)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider border transition-colors ${
                            activeEvent === event
                                ? 'bg-plex text-background border-plex'
                                : 'bg-background border-border text-muted hover:text-text'
                        }`}
                    >
                        {eventLabel(event)}
                    </button>
                ))}
            </div>

            <div className="rounded-xl border border-border bg-background/40 p-4 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm font-bold text-text">{eventLabel(activeEvent)}</p>
                    <div className="flex flex-wrap items-center gap-2">
                        <button
                            type="button"
                            onClick={() => void runPreview()}
                            disabled={busyAction !== null}
                            className="px-3 py-1.5 rounded-lg text-xs font-bold border border-border text-muted hover:text-text hover:border-plex/40 disabled:opacity-50"
                        >
                            {busyAction === 'preview' ? t('settings.emailTemplates.previewLoading') : t('settings.emailTemplates.preview')}
                        </button>
                        <button
                            type="button"
                            onClick={() => void runTestSend()}
                            disabled={busyAction !== null}
                            className="px-3 py-1.5 rounded-lg text-xs font-bold border border-plex/40 bg-plex/10 text-plex hover:bg-plex/20 disabled:opacity-50"
                        >
                            {busyAction === 'test' ? t('settings.emailTemplates.testLoading') : t('settings.emailTemplates.testSend')}
                        </button>
                        <button
                            type="button"
                            onClick={resetEvent}
                            className="text-xs font-semibold text-muted hover:text-plex"
                        >
                            {t('settings.emailTemplates.resetEvent')}
                        </button>
                    </div>
                </div>

                {fields.map((field) => (
                    <div key={field}>
                        <SettingFieldLabel htmlFor={`email-tpl-${activeEvent}-${field}`}>
                            {fieldLabel(field)}
                            {isOverridden(field) ? (
                                <span className="ml-2 text-[10px] uppercase tracking-wider text-plex">{t('settings.emailTemplates.customBadge')}</span>
                            ) : null}
                        </SettingFieldLabel>
                        {field === 'subject' || field === 'headline' || field === 'ctaLabel' || field === 'renewTitle' ? (
                            <input
                                id={`email-tpl-${activeEvent}-${field}`}
                                className="w-full appearance-none p-3 rounded-lg border border-border bg-background text-[16px] leading-5 text-text outline-none focus:border-plex focus:ring-1 focus:ring-plex transition-all"
                                value={effectiveValue(field)}
                                onChange={(e) => setField(field, e.target.value)}
                            />
                        ) : (
                            <textarea
                                id={`email-tpl-${activeEvent}-${field}`}
                                className="w-full appearance-none p-3 rounded-lg border border-border bg-background text-[16px] leading-5 text-text outline-none focus:border-plex focus:ring-1 focus:ring-plex transition-all min-h-[88px]"
                                value={effectiveValue(field)}
                                onChange={(e) => setField(field, e.target.value)}
                            />
                        )}
                    </div>
                ))}
            </div>
            <p className="text-xs text-muted">{t('settings.emailTemplates.saveHint')}</p>
            <p className="text-xs text-muted">{t('settings.emailTemplates.previewHint')}</p>

            {previewOpen && previewHtml ? (
                <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4">
                    <div className="flex h-[min(90vh,820px)] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl">
                        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
                            <div className="min-w-0">
                                <p className="text-sm font-bold text-text">{t('settings.emailTemplates.previewTitle')}</p>
                                {previewSubject ? (
                                    <p className="truncate text-xs text-muted">{previewSubject}</p>
                                ) : null}
                            </div>
                            <button
                                type="button"
                                className="rounded-lg border border-border px-3 py-1.5 text-xs font-bold text-muted hover:text-text"
                                onClick={() => setPreviewOpen(false)}
                            >
                                {t('settings.emailTemplates.closePreview')}
                            </button>
                        </div>
                        <iframe
                            title={t('settings.emailTemplates.previewTitle')}
                            className="min-h-0 flex-1 w-full bg-white"
                            sandbox="allow-same-origin"
                            srcDoc={previewHtml}
                        />
                    </div>
                </div>
            ) : null}
        </div>
    );
};

export default EmailAutomatedTemplatesPanel;
