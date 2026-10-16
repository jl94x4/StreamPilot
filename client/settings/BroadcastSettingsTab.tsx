import React, { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../shared/api';
import { CustomSelect } from '../shared/ui';
import { appAlert, askConfirm } from '../shared/confirm';
import { useDiscoverI18n } from '../discovery/i18n';
import type { User } from '../shared/types';
import { BroadcastRecipientPicker } from './BroadcastRecipientPicker';
import { SettingHint } from './SettingHint';

const BROADCAST_DEFAULT_SUBJECT = 'Big updates to the Plex Server! 🚀';
const BROADCAST_DEFAULT_BODY = `🎬 <b>Hey everyone! Big updates to the Plex Server!</b> 🚀<br><br>If you have any friends or family who want to check out the server, I’m currently offering a <b>3-Day Temporary Access</b> pass with instant access to the entire library! 🍿<br>✅ No bank details needed<br>✅ No purchase required<br>✅ Instant, automated setup<br><br>We also just launched a brand new <b>User Portal</b> (https://yourdomain.com) packed with awesome features for everyone:<br>🕒 <b>Account Status:</b> Easily check exactly how many days you have left until your account expires.<br>🟢 <b>Server Health:</b> View live 24/7 uptime stats for all server services.<br>📊 <b>Live Library Stats:</b> See exact, live counts of our massive library.<br><br>Feel free to share the link (https://yourdomain.com) with anyone who might be interested! 👇`;
const PICKED_DEFAULT_BODY = 'Hi {{USERNAME}},<br><br>';

export type BroadcastComposerMode = 'broadcast' | 'picked';

const idsWithEmail = (users: User[], ids: string[]) => {
    const byId = new Map(users.map((user) => [user.id, user]));
    return ids.filter((id) => !!byId.get(id)?.email);
};

export const BroadcastSettingsTab: React.FC<{
    selectedUserIds: string[];
    users: User[];
    mode?: BroadcastComposerMode;
    onSent?: () => void;
}> = ({ selectedUserIds, users, mode = 'broadcast', onSent }) => {
    const { t } = useDiscoverI18n();
    const isPicked = mode === 'picked';
    const [subject, setSubject] = useState(isPicked ? '' : BROADCAST_DEFAULT_SUBJECT);
    const [body, setBody] = useState(isPicked ? PICKED_DEFAULT_BODY : BROADCAST_DEFAULT_BODY);
    const [recipientFilter, setRecipientFilter] = useState<'all' | 'active' | 'trial' | 'expiring' | 'expired' | 'custom'>(
        isPicked || selectedUserIds.length > 0 ? 'custom' : 'all',
    );
    const [customSelectedUserIds, setCustomSelectedUserIds] = useState<string[]>(() => idsWithEmail(users, selectedUserIds));
    const [isSending, setIsSending] = useState(false);
    const [isPreviewMode, setIsPreviewMode] = useState(false);
    const [isSendingTest, setIsSendingTest] = useState(false);
    const [previewHtml, setPreviewHtml] = useState('');

    useEffect(() => {
        if (!isPicked && selectedUserIds.length === 0) return;
        setCustomSelectedUserIds(idsWithEmail(users, selectedUserIds));
        setRecipientFilter('custom');
    }, [isPicked, selectedUserIds, users]);

    useEffect(() => {
        if (!isPreviewMode || !body.trim()) {
            setPreviewHtml('');
            return;
        }
        let cancelled = false;
        const timer = setTimeout(() => {
            apiFetch('/api/users/broadcast/preview', {
                method: 'POST',
                body: JSON.stringify({ subject, body }),
            }).then((res) => {
                if (!cancelled) setPreviewHtml(res?.html || body);
            }).catch(() => {
                if (!cancelled) setPreviewHtml(body);
            });
        }, 250);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [isPreviewMode, subject, body]);

    const recipientCount = useMemo(() => {
        const now = Date.now();
        return users.filter((user) => {
            if (!user.email) return false;
            if (isPicked || recipientFilter === 'custom') return customSelectedUserIds.includes(user.id);
            if (recipientFilter === 'all') return true;
            if (recipientFilter === 'active') return user.plexAccessStatus === 'active';
            if (recipientFilter === 'trial') return !!user.isTrial;
            if (recipientFilter === 'expiring') {
                if (!user.expiryDate) return false;
                const exp = new Date(user.expiryDate).getTime();
                if (!Number.isFinite(exp) || exp <= now) return false;
                return Math.ceil((exp - now) / (1000 * 60 * 60 * 24)) <= 7;
            }
            if (recipientFilter === 'expired') {
                return !!user.expiryDate && new Date(user.expiryDate).getTime() < now;
            }
            return false;
        }).length;
    }, [users, recipientFilter, customSelectedUserIds, isPicked]);

    const skippedNoEmail = isPicked
        ? selectedUserIds.filter((id) => users.some((user) => user.id === id && !user.email)).length
        : 0;

    const showPicker = isPicked || recipientFilter === 'custom';
    const canSend = !!subject.trim() && !!body.trim() && recipientCount > 0 && !isSending && !isSendingTest;

    const handleSend = async () => {
        if (!canSend) {
            if (recipientCount === 0) void appAlert(t('settings.broadcast.pickSomeone'));
            return;
        }
        const confirmed = await askConfirm(
            t('settings.broadcast.confirmSend', { count: recipientCount }),
            {
                title: t('settings.broadcast.confirmSendTitle'),
                confirmLabel: t('settings.broadcast.confirmSendLabel'),
                cancelLabel: t('common.cancel'),
            },
        );
        if (!confirmed) return;

        setIsSending(true);
        try {
            const usingCustom = isPicked || recipientFilter === 'custom';
            const res = await apiFetch('/api/users/broadcast', {
                method: 'POST',
                body: JSON.stringify({
                    subject,
                    body,
                    recipientFilter: usingCustom ? 'selected' : recipientFilter,
                    selectedUserIds: usingCustom ? customSelectedUserIds : [],
                }),
            });
            void appAlert(res.message);
            onSent?.();
        } catch (e: any) {
            void appAlert(e.message || t('settings.broadcast.failed'));
        } finally {
            setIsSending(false);
        }
    };

    const handleTestSend = async () => {
        setIsSendingTest(true);
        try {
            const res = await apiFetch('/api/users/broadcast/test', {
                method: 'POST',
                body: JSON.stringify({ subject, body }),
            });
            void appAlert(res.message);
        } catch (e: any) {
            void appAlert(e.message || t('settings.broadcast.failedTest'));
        } finally {
            setIsSendingTest(false);
        }
    };

    return (
        <div className="flex flex-col gap-6">
            {!isPicked && (
                <div>
                    <div className="flex items-center mb-2">
                        <label className="font-bold text-text">{t('settings.broadcast.recipients')}</label>
                        <SettingHint>{t('settings.broadcast.recipientsHint')}</SettingHint>
                    </div>
                    <CustomSelect
                        value={recipientFilter}
                        onChange={(val) => setRecipientFilter(val as typeof recipientFilter)}
                        options={[
                            { label: t('settings.broadcast.filterAll'), value: 'all' },
                            { label: t('settings.broadcast.filterActive'), value: 'active' },
                            { label: t('settings.broadcast.filterTrial'), value: 'trial' },
                            { label: t('settings.broadcast.filterExpiring'), value: 'expiring' },
                            { label: t('settings.broadcast.filterExpired'), value: 'expired' },
                            { label: t('settings.broadcast.filterCustom'), value: 'custom' },
                        ]}
                    />
                </div>
            )}

            {showPicker && (
                <div>
                    {isPicked && (
                        <div className="flex items-center mb-2">
                            <label className="font-bold text-text">{t('settings.broadcast.recipients')}</label>
                            <SettingHint>{t('settings.broadcast.recipientsHint')}</SettingHint>
                        </div>
                    )}
                    <BroadcastRecipientPicker
                        users={users}
                        selectedIds={customSelectedUserIds}
                        onChange={setCustomSelectedUserIds}
                    />
                </div>
            )}

            <p className="text-sm text-muted -mt-2">
                {t('settings.broadcast.willSend', { count: recipientCount })}
                {skippedNoEmail > 0 ? ` ${t('settings.broadcast.skippedNoEmail', { count: skippedNoEmail })}` : ''}
            </p>

            <div>
                <label className="block mb-2 font-bold text-text">{t('settings.broadcast.subject')}</label>
                <input
                    className="w-full appearance-none p-3 rounded-lg border border-border bg-background text-[16px] leading-5 text-text outline-none focus:border-plex focus:ring-1 focus:ring-plex transition-all"
                    type="text"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder={t('settings.broadcast.subjectPlaceholder')}
                />
            </div>

            <div>
                <div className="flex justify-between items-center mb-2">
                    <div className="flex items-center">
                        <label className="font-bold text-text m-0">{t('settings.broadcast.body')}</label>
                        <SettingHint>{t('settings.broadcast.usernameHint')}</SettingHint>
                    </div>
                    <button
                        type="button"
                        className="px-3 py-1 bg-border text-text rounded text-xs font-medium hover:bg-opacity-80 transition-colors"
                        onClick={() => setIsPreviewMode(!isPreviewMode)}
                    >
                        {isPreviewMode ? t('settings.broadcast.editHtml') : t('settings.broadcast.preview')}
                    </button>
                </div>
                {isPreviewMode ? (
                    <iframe
                        title={t('settings.broadcast.preview')}
                        sandbox=""
                        srcDoc={previewHtml || body}
                        className="w-full h-[560px] rounded-lg bg-white border border-border"
                    />
                ) : (
                    <textarea
                        value={body}
                        onChange={(e) => setBody(e.target.value)}
                        className="w-full h-[300px] p-3 rounded-lg border border-border bg-background text-text outline-none focus:border-plex focus:ring-1 focus:ring-plex transition-all font-mono text-sm"
                    />
                )}
            </div>

            <div className="flex justify-end gap-3 mt-2">
                <button
                    type="button"
                    className="px-6 py-2.5 bg-border text-text rounded-lg font-bold hover:bg-opacity-80 transition-colors flex items-center justify-center gap-2"
                    onClick={handleTestSend}
                    disabled={isSending || isSendingTest || !subject.trim() || !body.trim()}
                >
                    {isSendingTest ? t('settings.broadcast.sendingTest') : t('settings.broadcast.sendTest')}
                </button>
                <button
                    type="button"
                    className="px-6 py-2.5 bg-plex text-background rounded-lg font-bold hover:bg-plex-hover transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                    onClick={handleSend}
                    disabled={!canSend}
                >
                    {isSending
                        ? t('settings.broadcast.sending')
                        : t('settings.broadcast.sendCount', { count: recipientCount })}
                </button>
            </div>
        </div>
    );
};
