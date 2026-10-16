import React from 'react';
import { Mail, X } from 'lucide-react';
import { useDiscoverI18n } from '../discovery/i18n';
import { ModalPortal } from '../shared/ModalPortal';
import type { User } from '../shared/types';
import { BroadcastSettingsTab } from './BroadcastSettingsTab';

type Props = {
    open: boolean;
    onClose: () => void;
    users: User[];
    selectedUserIds: string[];
};

export const EmailSelectedUsersModal: React.FC<Props> = ({ open, onClose, users, selectedUserIds }) => {
    const { t } = useDiscoverI18n();
    const named = selectedUserIds.length === 1
        ? users.find((user) => user.id === selectedUserIds[0])
        : null;

    return (
        <ModalPortal open={open}>
            <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex justify-center items-center z-[1000] p-3 sm:p-6" onClick={onClose}>
                <div
                    className="bg-card p-4 md:p-6 lg:p-8 rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto shadow-2xl border border-border"
                    onClick={(e) => e.stopPropagation()}
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="email-selected-title"
                >
                    <div className="flex items-start justify-between gap-4 mb-5">
                        <div className="min-w-0">
                            <div className="flex items-center gap-2 text-plex mb-1">
                                <Mail className="w-5 h-5 shrink-0" />
                                <span className="text-xs font-bold uppercase tracking-[0.18em]">{t('usersAdmin.email.eyebrow')}</span>
                            </div>
                            <h2 id="email-selected-title" className="text-2xl font-bold text-text">
                                {named
                                    ? t('usersAdmin.email.titleOne', { username: named.username })
                                    : t('usersAdmin.email.title', { count: selectedUserIds.length })}
                            </h2>
                            <p className="text-sm text-muted mt-1">{t('usersAdmin.email.subtitle')}</p>
                        </div>
                        <button
                            type="button"
                            onClick={onClose}
                            className="text-muted hover:text-text transition-colors bg-white/5 rounded-full p-2 shrink-0"
                            aria-label={t('common.close')}
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                    {open && (
                        <BroadcastSettingsTab
                            key={selectedUserIds.join('|')}
                            users={users}
                            selectedUserIds={selectedUserIds}
                            mode="picked"
                            onSent={onClose}
                        />
                    )}
                </div>
            </div>
        </ModalPortal>
    );
};
