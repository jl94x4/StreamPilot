import React, { useMemo, useState } from 'react';
import { useDiscoverI18n } from '../discovery/i18n';
import { SettingFieldLabel, SettingHint } from './SettingHint';

const EVENT_LABEL_KEYS: Record<string, string> = {
    available: 'settings.notifications.templates.events.available',
    approved: 'settings.notifications.templates.events.approved',
    declined: 'settings.notifications.templates.events.declined',
    season: 'settings.notifications.templates.events.season',
    episode: 'settings.notifications.templates.events.episode',
    admin_pending: 'settings.notifications.templates.events.admin_pending',
    not_released: 'settings.notifications.templates.events.not_released',
    collexions_failed: 'settings.notifications.templates.events.collexions_failed',
    spotify_sync_failed: 'Spotify Sync failed',
    scanner_failed: 'settings.notifications.templates.events.scanner_failed',
    scanner_deleted: 'settings.notifications.templates.events.scanner_deleted',
    scanner_upgrade: 'settings.notifications.templates.events.scanner_upgrade',
    scanner_import: 'settings.notifications.templates.events.scanner_import',
    scanner_grab: 'settings.notifications.templates.events.scanner_grab',
    scanner_update: 'settings.notifications.templates.events.scanner_update',
    scanner_interaction: 'settings.notifications.templates.events.scanner_interaction',
    status_down: 'settings.notifications.templates.events.status_down',
    status_up: 'settings.notifications.templates.events.status_up',
    media_job_failed: 'settings.notifications.templates.events.media_job_failed',
    media_job_completed: 'settings.notifications.templates.events.media_job_completed',
    support_ticket: 'settings.notifications.templates.events.support_ticket',
    support_reply: 'settings.notifications.templates.events.support_reply',
    support_media_issue: 'settings.notifications.templates.events.support_media_issue',
};

const FIELD_LABEL_KEYS: Record<string, string> = {
    emailSubject: 'settings.notifications.templates.fields.emailSubject',
    emailHeadline: 'settings.notifications.templates.fields.emailHeadline',
    emailBody: 'settings.notifications.templates.fields.emailBody',
    pushTitle: 'settings.notifications.templates.fields.pushTitle',
    pushBody: 'settings.notifications.templates.fields.pushBody',
    discordContent: 'settings.notifications.templates.fields.discordContent',
    discordEmbedTitle: 'settings.notifications.templates.fields.discordEmbedTitle',
    discordEmbedDescription: 'settings.notifications.templates.fields.discordEmbedDescription',
    gotifyTitle: 'settings.notifications.templates.fields.gotifyTitle',
    gotifyBody: 'settings.notifications.templates.fields.gotifyBody',
    ntfyTitle: 'settings.notifications.templates.fields.ntfyTitle',
    ntfyBody: 'settings.notifications.templates.fields.ntfyBody',
    webhookBody: 'settings.notifications.templates.fields.webhookBody',
};

type Props = {
    notificationTemplates: Record<string, Record<string, string>>;
    setNotificationTemplates: (next: Record<string, Record<string, string>>) => void;
    defaults: Record<string, Record<string, string>>;
    events: string[];
    eventFields: Record<string, string[]>;
    getSettingsSectionElementId: (id: string) => string;
};

export const NotificationTemplatesPanel: React.FC<Props> = ({
    notificationTemplates,
    setNotificationTemplates,
    defaults,
    events,
    eventFields,
    getSettingsSectionElementId,
}) => {
    const { t } = useDiscoverI18n();
    const eventList = events?.length ? events : Object.keys(EVENT_LABEL_KEYS);
    const [activeEvent, setActiveEvent] = useState(eventList[0] || 'available');
    const fields = eventFields?.[activeEvent] || [];
    const eventLabel = (event: string) => EVENT_LABEL_KEYS[event] ? t(EVENT_LABEL_KEYS[event]) : event;
    const fieldLabel = (field: string) => FIELD_LABEL_KEYS[field] ? t(FIELD_LABEL_KEYS[field]) : field;

    const effectiveValue = (field: string) => {
        const override = notificationTemplates?.[activeEvent]?.[field];
        if (override != null && String(override).trim()) return String(override);
        return String(defaults?.[activeEvent]?.[field] || '');
    };

    const isOverridden = (field: string) => {
        const override = notificationTemplates?.[activeEvent]?.[field];
        return override != null && String(override).trim() !== '';
    };

    const setField = (field: string, value: string) => {
        const nextEvent = { ...(notificationTemplates?.[activeEvent] || {}) };
        const trimmed = value.trim();
        const defaultValue = String(defaults?.[activeEvent]?.[field] || '');
        if (!trimmed || trimmed === defaultValue) {
            delete nextEvent[field];
        } else {
            nextEvent[field] = value;
        }
        const nextAll = { ...notificationTemplates };
        if (Object.keys(nextEvent).length) nextAll[activeEvent] = nextEvent;
        else delete nextAll[activeEvent];
        setNotificationTemplates(nextAll);
    };

    const resetEvent = () => {
        const nextAll = { ...notificationTemplates };
        delete nextAll[activeEvent];
        setNotificationTemplates(nextAll);
    };

    const variableHint = useMemo(
        () => '{title} {user} {media_type} {status} {portal_url} {year} {season} {server_name} {decline_reason} {release_date} {release_type} {filename} {service} {service_mark}',
        [],
    );

    return (
        <div id={getSettingsSectionElementId('notifications-templates')} className="scroll-mt-24 space-y-3">
            <h4 className="text-sm font-bold text-text uppercase tracking-wider">{t('settings.notifications.templates.title')}</h4>
            <SettingHint>
                {t('settings.notifications.templates.hint')}
                {' '}
                {t('settings.notifications.templates.variablesLabel')} <code className="text-[11px]">{variableHint}</code>
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
                <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-bold text-text">{eventLabel(activeEvent)}</p>
                    <button
                        type="button"
                        onClick={resetEvent}
                        className="text-xs font-semibold text-muted hover:text-plex"
                    >
                        {t('settings.notifications.templates.resetEvent')}
                    </button>
                </div>

                {fields.map((field) => (
                    <div key={field}>
                        <SettingFieldLabel htmlFor={`notify-tpl-${activeEvent}-${field}`}>
                            {fieldLabel(field)}
                            {isOverridden(field) ? (
                                <span className="ml-2 text-[10px] uppercase tracking-wider text-plex">{t('settings.notifications.templates.customBadge')}</span>
                            ) : null}
                        </SettingFieldLabel>
                        {field.toLowerCase().includes('body') || field.toLowerCase().includes('content') || field.toLowerCase().includes('description') ? (
                            <textarea
                                id={`notify-tpl-${activeEvent}-${field}`}
                                className="w-full appearance-none p-3 rounded-lg border border-border bg-background text-[16px] leading-5 text-text outline-none focus:border-plex focus:ring-1 focus:ring-plex transition-all min-h-[88px]"
                                value={effectiveValue(field)}
                                onChange={(e) => setField(field, e.target.value)}
                            />
                        ) : (
                            <input
                                id={`notify-tpl-${activeEvent}-${field}`}
                                className="w-full appearance-none p-3 rounded-lg border border-border bg-background text-[16px] leading-5 text-text outline-none focus:border-plex focus:ring-1 focus:ring-plex transition-all"
                                value={effectiveValue(field)}
                                onChange={(e) => setField(field, e.target.value)}
                            />
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
};

export default NotificationTemplatesPanel;
