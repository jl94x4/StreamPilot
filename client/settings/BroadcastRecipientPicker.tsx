import React, { useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { useDiscoverI18n } from '../discovery/i18n';
import { resolvePortalAssetUrl } from '../shared/basePath';
import type { User } from '../shared/types';

type Props = {
    users: User[];
    selectedIds: string[];
    onChange: (ids: string[]) => void;
};

export const BroadcastRecipientPicker: React.FC<Props> = ({ users, selectedIds, onChange }) => {
    const { t } = useDiscoverI18n();
    const [query, setQuery] = useState('');
    const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

    const sortedUsers = useMemo(
        () => users.slice().sort((a, b) => a.username.localeCompare(b.username, undefined, { sensitivity: 'base' })),
        [users],
    );

    const visibleUsers = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return sortedUsers;
        return sortedUsers.filter((user) => (
            user.username.toLowerCase().includes(q)
            || String(user.email || '').toLowerCase().includes(q)
        ));
    }, [sortedUsers, query]);

    const selectedUsers = useMemo(
        () => sortedUsers.filter((user) => selectedSet.has(user.id)),
        [sortedUsers, selectedSet],
    );

    const visibleWithEmail = visibleUsers.filter((user) => !!user.email);
    const allVisibleSelected = visibleWithEmail.length > 0 && visibleWithEmail.every((user) => selectedSet.has(user.id));

    const toggle = (user: User) => {
        if (!user.email) return;
        if (selectedSet.has(user.id)) onChange(selectedIds.filter((id) => id !== user.id));
        else onChange([...selectedIds, user.id]);
    };

    const selectVisible = () => {
        const next = new Set(selectedIds);
        for (const user of visibleWithEmail) next.add(user.id);
        onChange(Array.from(next));
    };

    return (
        <div className="rounded-xl border border-border/60 bg-black/20 overflow-hidden">
            {selectedUsers.length > 0 && (
                <div className="flex flex-wrap gap-1.5 p-3 border-b border-border/40">
                    {selectedUsers.map((user) => (
                        <button
                            key={user.id}
                            type="button"
                            onClick={() => onChange(selectedIds.filter((id) => id !== user.id))}
                            className="inline-flex items-center gap-1.5 max-w-full rounded-full border border-plex/30 bg-plex/10 px-2 py-1 text-xs font-medium text-text hover:bg-plex/20 transition-colors"
                            title={user.email || t('settings.broadcast.noEmail')}
                        >
                            {user.thumb ? (
                                <img src={resolvePortalAssetUrl(user.thumb)} alt="" className="w-4 h-4 rounded-full object-cover" />
                            ) : (
                                <span className="w-4 h-4 rounded-full bg-border text-[8px] font-bold flex items-center justify-center">
                                    {user.username.slice(0, 1).toUpperCase()}
                                </span>
                            )}
                            <span className="truncate">{user.username}</span>
                            <X className="w-3 h-3 shrink-0 text-muted" />
                        </button>
                    ))}
                </div>
            )}

            <div className="flex flex-wrap items-center gap-2 p-3 border-b border-border/40">
                <div className="relative flex-1 min-w-[180px]">
                    <Search className="w-4 h-4 text-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                        type="search"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder={t('settings.broadcast.searchPlaceholder')}
                        className="w-full appearance-none pl-9 pr-3 py-2 rounded-lg border border-border bg-background text-sm text-text outline-none focus:border-plex focus:ring-1 focus:ring-plex"
                    />
                </div>
                <button
                    type="button"
                    className="text-xs font-semibold text-muted underline hover:text-text disabled:opacity-40 disabled:no-underline"
                    onClick={allVisibleSelected
                        ? () => onChange(selectedIds.filter((id) => !visibleWithEmail.some((user) => user.id === id)))
                        : selectVisible}
                    disabled={visibleWithEmail.length === 0}
                >
                    {allVisibleSelected
                        ? t('settings.broadcast.unselectVisible')
                        : t('settings.broadcast.selectVisible', { count: visibleWithEmail.length })}
                </button>
                {selectedIds.length > 0 && (
                    <button
                        type="button"
                        className="text-xs font-semibold text-muted underline hover:text-text"
                        onClick={() => onChange([])}
                    >
                        {t('settings.broadcast.clear')}
                    </button>
                )}
            </div>

            <div className="max-h-64 overflow-y-auto p-1">
                {visibleUsers.length === 0 ? (
                    <p className="px-3 py-6 text-sm text-muted text-center">{t('settings.broadcast.noneMatch')}</p>
                ) : visibleUsers.map((user) => {
                    const hasEmail = !!user.email;
                    const checked = selectedSet.has(user.id);
                    return (
                        <label
                            key={user.id}
                            className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                                hasEmail ? 'cursor-pointer hover:bg-white/5 text-text' : 'opacity-50 cursor-not-allowed text-muted'
                            } ${checked ? 'bg-plex/10' : ''}`}
                        >
                            <input
                                type="checkbox"
                                className="accent-plex w-4 h-4 shrink-0"
                                checked={checked}
                                disabled={!hasEmail}
                                onChange={() => toggle(user)}
                            />
                            {user.thumb ? (
                                <img src={resolvePortalAssetUrl(user.thumb)} alt="" className="w-8 h-8 rounded-full object-cover border border-border shrink-0" />
                            ) : (
                                <span className="w-8 h-8 rounded-full bg-border border border-border shrink-0 flex items-center justify-center text-[10px] font-bold">
                                    {user.username.slice(0, 2).toUpperCase()}
                                </span>
                            )}
                            <span className="min-w-0 flex-1">
                                <span className="block font-medium truncate">{user.username}</span>
                                <span className="block text-xs text-muted truncate">
                                    {hasEmail ? user.email : t('settings.broadcast.noEmail')}
                                </span>
                            </span>
                        </label>
                    );
                })}
            </div>
        </div>
    );
};
