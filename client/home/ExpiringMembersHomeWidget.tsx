import React, { useEffect, useState } from 'react';
import { Calendar, Users } from 'lucide-react';
import { apiFetch } from '../shared/api';
import { formatUkDate } from '../shared/format';
import type { DiscoverTranslate } from '../discovery/i18n/types';
import { daysUntilExpiry, filterExpiringMembersThisWeek } from './expiringMembersThisWeek.js';

type Props = {
    t: DiscoverTranslate;
    onViewAdmin: () => void;
};

const MAX_ROWS = 6;

export const ExpiringMembersHomeWidget: React.FC<Props> = ({ t, onViewAdmin }) => {
    const [members, setMembers] = useState<any[] | null>(null);

    useEffect(() => {
        let cancelled = false;
        apiFetch('/api/users')
            .then((data) => {
                if (cancelled) return;
                const list = Array.isArray(data) ? data : (Array.isArray(data?.users) ? data.users : []);
                setMembers(filterExpiringMembersThisWeek(list));
            })
            .catch(() => {
                if (!cancelled) setMembers([]);
            });
        return () => { cancelled = true; };
    }, []);

    if (members === null) {
        return (
            <div className="glass-card p-4 md:p-5 shadow-xl flex-shrink-0 animate-pulse">
                <div className="h-3 w-36 bg-white/10 rounded mb-3" />
                <div className="h-10 bg-white/5 rounded" />
            </div>
        );
    }
    if (!members.length) return null;

    return (
        <div className="glass-card p-4 md:p-5 shadow-xl flex flex-col flex-shrink-0">
            <div className="flex items-start justify-between gap-3 mb-3">
                <div className="min-w-0">
                    <p className="text-muted text-xs uppercase tracking-widest font-semibold flex items-center gap-2">
                        <Calendar className="w-3.5 h-3.5 text-plex shrink-0" />
                        {t('homeDashboard.expiringMembers.title')}
                    </p>
                    <p className="text-xs text-muted mt-1">
                        {t('homeDashboard.expiringMembers.subtitle', { count: members.length })}
                    </p>
                </div>
                <button
                    type="button"
                    onClick={onViewAdmin}
                    className="shrink-0 text-xs font-bold text-plex hover:underline"
                >
                    {t('homeDashboard.admin.manageUsers')}
                </button>
            </div>
            <ul className="space-y-1.5">
                {members.slice(0, MAX_ROWS).map((user) => {
                    const days = daysUntilExpiry(user.expiryDate);
                    const name = String(user.username || user.email || user.id || t('status.unknown'));
                    return (
                        <li key={String(user.id || name)}>
                            <button
                                type="button"
                                onClick={onViewAdmin}
                                className="w-full flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-background/40 px-3 py-2 text-left hover:border-plex/40 hover:bg-white/5 transition-colors"
                            >
                                <span className="min-w-0 flex items-center gap-2">
                                    <Users className="w-3.5 h-3.5 text-muted shrink-0" />
                                    <span className="text-sm font-semibold text-text truncate">{name}</span>
                                </span>
                                <span className="shrink-0 text-right">
                                    <span className={`block text-xs font-bold ${days === 0 ? 'text-red-400' : days != null && days <= 2 ? 'text-yellow-400' : 'text-muted'}`}>
                                        {t('homeDashboard.expiringMembers.daysLeft', { count: days ?? 0 })}
                                    </span>
                                    {user.expiryDate ? (
                                        <span className="block text-[10px] text-muted/80">{formatUkDate(user.expiryDate)}</span>
                                    ) : null}
                                </span>
                            </button>
                        </li>
                    );
                })}
            </ul>
            {members.length > MAX_ROWS ? (
                <button
                    type="button"
                    onClick={onViewAdmin}
                    className="mt-2 text-xs font-bold text-plex hover:underline text-left"
                >
                    {t('homeDashboard.expiringMembers.more', { count: members.length - MAX_ROWS })}
                </button>
            ) : null}
        </div>
    );
};
