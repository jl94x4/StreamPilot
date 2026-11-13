import { Activity,AlertCircle,BarChart3,ChevronDown,ChevronUp,Copy,Eye,Film,Mail,Music,Pause,PlaySquare,RefreshCw,Search,TrendingUp,Trophy,User as UserIcon,X } from 'lucide-react';
import React,{ useCallback,useEffect,useMemo,useRef,useState } from 'react';
import { Bar,BarChart,CartesianGrid,Cell,Line,LineChart,Pie,PieChart as RechartsPieChart,Tooltip as RechartsTooltip,ResponsiveContainer,XAxis,YAxis } from 'recharts';

import { useDiscoverI18n } from '../discovery/i18n';
import { PlexUserPermissions } from '../settings/PlexSharePermissions';
import { apiFetch } from '../shared/api';
import { logoUrl,portalUrl,resolvePortalAssetUrl } from '../shared/basePath';
import { appConfirm } from '../shared/confirm';
import { addMonths,addYears,formatDate,formatPortalDateTime,getDaysUntilExpiry } from '../shared/format';
import { Loader } from '../shared/toast';
import type { User,UserStatus } from '../shared/types';
import { CustomSelect } from '../shared/ui';
import { copyTextToClipboard } from './common';


export const UserCard: React.FC<{
    user: User;
    onEdit: () => void;
    onDelete: () => void;
    onRevoke: () => void;
    onViewAs?: () => void;
    onViewAnalytics?: () => void;
    onViewProfile?: () => void;
    isConfigured: boolean;
    isSelected: boolean;
    onSelect: (id: string) => void;
    onEmail?: () => void;
    onResendInvite?: () => void;
    onCopied?: (message: string) => void;
    providerLabel?: string;
}> = ({ user, onEdit, onDelete, onRevoke, onViewAs, onViewAnalytics, onViewProfile, isConfigured, isSelected, onSelect, onEmail, onResendInvite, onCopied, providerLabel = 'Plex' }) => {
    const { t } = useDiscoverI18n();
    const isPlexRevoked = user.plexAccessStatus === 'revoked' && !(user.isServerOwner || user.isAdmin);
    const plexAccessStatus = (user.isServerOwner || user.isAdmin)
        ? 'active'
        : (user.plexAccessStatus || 'unknown');

    const { status, statusText, statusHint, daysRemainingText, pillClass, borderClass, glowClass } = useMemo(() => {
        const days = getDaysUntilExpiry(user.expiryDate);
        let status: UserStatus | 'revoked' = 'active';
        let statusText = t('usersAdmin.status.active');
        let statusHint = t('usersAdmin.statusHints.active');
        let daysRemainingText = '';
        let pillClass = 'bg-green-500/10 text-green-400 border border-green-500/20';
        let borderClass = 'border-green-500/30';
        let glowClass = 'hover:border-green-500/50 hover:shadow-[0_0_15px_rgba(34,197,94,0.12)]';

        if (days === null) {
            status = 'active';
            statusText = t('usersAdmin.status.active');
            daysRemainingText = t('usersAdmin.card.neverExpires');
        } else if (days < 0) {
            status = 'expired';
            statusText = t('usersAdmin.status.expired');
            statusHint = t('usersAdmin.statusHints.expired');
            daysRemainingText = t('usersAdmin.card.expiredDaysAgo', { count: Math.abs(days) });
            pillClass = 'bg-red-500/10 text-red-400 border border-red-500/20';
            borderClass = 'border-red-500/30';
            glowClass = 'hover:border-red-500/50 hover:shadow-[0_0_15px_rgba(239,68,68,0.12)]';
        } else if (days <= 30) {
            status = 'expiring';
            statusText = t('usersAdmin.status.expiring');
            statusHint = t('usersAdmin.statusHints.expiring');
            daysRemainingText = days === 0 ? t('usersAdmin.card.expiresToday') : t('usersAdmin.card.expiresInDays', { count: days });
            pillClass = 'bg-orange-500/10 text-orange-400 border border-orange-500/20';
            borderClass = 'border-orange-500/30';
            glowClass = 'hover:border-orange-500/50 hover:shadow-[0_0_15px_rgba(249,115,22,0.12)]';
        } else {
            daysRemainingText = t('usersAdmin.card.expiresInDays', { count: days });
        }

        if (isPlexRevoked) {
            status = 'revoked';
            statusText = t('usersAdmin.status.revoked');
            statusHint = t('usersAdmin.statusHints.revoked');
            pillClass = 'bg-zinc-500/15 text-zinc-300 border border-zinc-500/25';
            borderClass = 'border-zinc-500/40';
            glowClass = 'hover:border-zinc-400/50 hover:shadow-[0_0_15px_rgba(161,161,170,0.12)]';
        }

        return { status, statusText, statusHint, daysRemainingText, pillClass, borderClass, glowClass };
    }, [user.expiryDate, isPlexRevoked, t]);

    const handleCardClick = () => {
        onSelect(user.id);
    }

    return (
        <div className={`relative overflow-hidden rounded-2xl border border-white/10 bg-black/25 p-5 shadow-lg border-l-4 ${borderClass} ${glowClass} hover:-translate-y-0.5 transition-all duration-300 flex flex-col cursor-pointer ${isSelected ? 'border-plex/40 shadow-lg shadow-plex/10 bg-black/35' : ''}`} onClick={handleCardClick}>
            <div className="pointer-events-none absolute -right-8 -top-10 h-24 w-24 rounded-full blur-2xl bg-plex/10" />
            <div className="relative flex justify-between items-start mb-3">
                <div className="flex items-center gap-2.5 min-w-0">
                    <input className="w-4 h-4 flex-shrink-0 appearance-none rounded-full border border-muted checked:bg-plex checked:border-plex transition-colors cursor-pointer relative checked:after:content-[''] checked:after:block checked:after:w-1.5 checked:after:h-1.5 checked:after:bg-background checked:after:rounded-full checked:after:absolute checked:after:top-1/2 checked:after:left-1/2 checked:after:-translate-x-1/2 checked:after:-translate-y-1/2"
                        type="checkbox"
                        checked={isSelected}
                        readOnly
                        style={{ borderRadius: '50%' }}
                    />
                    {user.thumb ? (
                        <img src={resolvePortalAssetUrl(user.thumb)} alt={user.username} className="w-8 h-8 rounded-full object-cover border border-border flex-shrink-0" />
                    ) : (
                        <div className="w-8 h-8 rounded-full bg-border flex items-center justify-center text-text font-bold text-xs uppercase flex-shrink-0">
                            {user.username.substring(0, 2)}
                        </div>
                    )}
                    <div className="flex flex-col min-w-0 pr-1">
                        <div className="flex items-center gap-1 min-w-0">
                            <h3 className="text-sm font-bold truncate leading-tight" title={user.username}>{user.username}</h3>
                            {onCopied && (
                                <button
                                    type="button"
                                    className="text-muted hover:text-plex p-0.5 shrink-0"
                                    title={t('usersAdmin.actions.copyUsername')}
                                    onClick={async (e) => {
                                        e.stopPropagation();
                                        try {
                                            await copyTextToClipboard(user.username);
                                            onCopied(t('usersAdmin.actions.copiedUsername'));
                                        } catch {
                                            onCopied(t('usersAdmin.actions.copyFailed'));
                                        }
                                    }}
                                >
                                    <Copy className="w-3 h-3" />
                                </button>
                            )}
                        </div>
                        {user.email && (
                            <div className="flex items-center gap-1 min-w-0 mt-0.5">
                                <span className="text-[10px] text-muted truncate" title={user.email}>{user.email}</span>
                                {onCopied && (
                                    <button
                                        type="button"
                                        className="text-muted hover:text-plex p-0.5 shrink-0"
                                        title={t('usersAdmin.actions.copyEmail')}
                                        onClick={async (e) => {
                                            e.stopPropagation();
                                            try {
                                                await copyTextToClipboard(user.email || '');
                                                onCopied(t('usersAdmin.actions.copiedEmail'));
                                            } catch {
                                                onCopied(t('usersAdmin.actions.copyFailed'));
                                            }
                                        }}
                                    >
                                        <Copy className="w-3 h-3" />
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                </div>
                <span
                    className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider whitespace-nowrap ${pillClass}`}
                    title={statusHint}
                >{statusText}</span>
            </div>
            <div className="relative flex flex-col gap-2 mt-3 flex-grow">
                <div className="flex justify-between items-center text-xs pb-1.5 border-b border-white/5 last:border-0 last:pb-0">
                    <span className="text-muted text-[10px] uppercase tracking-wider font-bold">{t('usersAdmin.card.joined')}</span>
                    <span className="text-text font-medium">{formatDate(user.joiningDate)}</span>
                </div>
                <div className="flex justify-between items-start text-xs pb-1.5 border-b border-white/5 last:border-0 last:pb-0 gap-2">
                    <span className="text-muted text-[10px] uppercase tracking-wider font-bold flex-shrink-0 pt-0.5">{t('usersAdmin.card.expires')}</span>
                    <span className="text-text font-medium flex flex-col items-end text-right">
                        <span className="whitespace-nowrap font-bold">{formatDate(user.expiryDate)}</span> 
                        <span className="text-[9px] text-muted mt-0.5">{daysRemainingText}</span>
                    </span>
                </div>
                <div className="flex justify-between items-center text-xs pb-1.5 border-b border-white/5 last:border-0 last:pb-0">
                    <span className="text-muted text-[10px] uppercase tracking-wider font-bold">{t('usersAdmin.card.share', { provider: providerLabel })}</span>
                    <span className="info-value plex-status flex items-center gap-1.5" title={t(`usersAdmin.accessHints.${plexAccessStatus}` as any)}>
                        <span className={`inline-block h-1.5 w-1.5 rounded-full ${
                            plexAccessStatus === 'active' ? 'bg-emerald-400' :
                            plexAccessStatus === 'pending' ? 'bg-amber-400' :
                            plexAccessStatus === 'revoked' ? 'bg-zinc-400' : 'bg-muted'
                        }`} />
                        <span className="text-text font-medium text-xs">{t(`usersAdmin.access.${plexAccessStatus}` as any)}</span>
                    </span>
                </div>
                <div className="flex justify-between items-center text-xs pb-1.5 border-b border-white/5 last:border-0 last:pb-0">
                    <span className="text-muted text-[10px] uppercase tracking-wider font-bold">{t('usersAdmin.card.lastLogin')}</span>
                    <span className="text-text font-medium">{user.lastLogin ? formatDate(user.lastLogin) : t('usersAdmin.card.never')}</span>
                </div>
            </div>
            <div className="relative flex flex-wrap gap-2 mt-auto pt-4" onClick={e => e.stopPropagation()}>
                {onViewProfile && (
                    <button
                        className="rounded-lg border border-white/10 bg-black/20 px-3 py-1.5 text-xs font-semibold text-text transition-colors hover:bg-white/5 flex items-center justify-center gap-1.5"
                        onClick={onViewProfile}
                        title={t('usersAdmin.actions.viewProfile')}
                    >
                        <UserIcon className="w-3.5 h-3.5" />
                        {t('usersAdmin.actions.viewProfile')}
                    </button>
                )}
                {onViewAnalytics && (
                    <button
                        className="rounded-lg border border-white/10 bg-black/20 px-3 py-1.5 text-xs font-semibold text-text transition-colors hover:bg-white/5 flex items-center justify-center gap-1.5"
                        onClick={onViewAnalytics}
                        title={t('usersAdmin.actions.openAnalytics')}
                    >
                        <BarChart3 className="w-3.5 h-3.5" />
                        {t('navigation.analytics')}
                    </button>
                )}
                {onViewAs && (
                    <button className="rounded-lg border border-white/10 bg-black/20 px-3 py-1.5 text-xs font-semibold text-text transition-colors hover:bg-white/5 flex items-center justify-center gap-1.5" onClick={onViewAs} title={t('usersAdmin.actions.viewAsTitle')}>
                        <Eye className="w-3.5 h-3.5" />
                        {t('usersAdmin.actions.viewAs')}
                    </button>
                )}
                {onEmail && (
                    <button
                        className="rounded-lg border border-white/10 bg-black/20 px-3 py-1.5 text-xs font-semibold text-text transition-colors hover:bg-white/5 flex items-center justify-center gap-1.5"
                        onClick={onEmail}
                        title={t('usersAdmin.actions.emailUser')}
                    >
                        <Mail className="w-3.5 h-3.5" />
                        {t('usersAdmin.actions.emailUser')}
                    </button>
                )}
                {onResendInvite && (
                    <button
                        className="rounded-lg border border-white/10 bg-black/20 px-3 py-1.5 text-xs font-semibold text-text transition-colors hover:bg-white/5 flex items-center justify-center gap-1.5"
                        onClick={onResendInvite}
                        title={t('usersAdmin.actions.resendInvite')}
                    >
                        <RefreshCw className="w-3.5 h-3.5" />
                        {t('usersAdmin.actions.resendInvite')}
                    </button>
                )}
                <button className="rounded-lg border border-white/10 bg-black/20 px-3 py-1.5 text-xs font-semibold text-text transition-colors hover:bg-white/5 flex items-center justify-center gap-1.5" onClick={onEdit}>{isPlexRevoked ? t('usersAdmin.actions.restoreAccess') : t('usersAdmin.actions.edit')}</button>
                <button className="rounded-lg border border-white/10 bg-black/20 px-3 py-1.5 text-xs font-semibold text-text transition-colors hover:bg-white/5 flex items-center justify-center gap-1.5" onClick={onDelete}>{t('common.delete')}</button>
                {status === 'expired' && !isPlexRevoked && (
                    <button className="rounded-lg border border-white/10 bg-black/20 px-3 py-1.5 text-xs font-semibold text-text transition-colors hover:bg-white/5 flex items-center justify-center gap-1.5" onClick={onRevoke} disabled={!isConfigured}>{t('usersAdmin.actions.revoke')}</button>
                )}
            </div>
        </div>
    );
};

export const UserModal: React.FC<{ isOpen: boolean; onClose: () => void; onSave: (user: User) => void; user: User | null }> = ({ isOpen, onClose, onSave, user }) => {
    const { t } = useDiscoverI18n();
    const [username, setUsername] = useState('');
    const [joiningDate, setJoiningDate] = useState(formatDate(new Date().toISOString()));
    const [expiryDate, setExpiryDate] = useState<string | null>(formatDate(addMonths(new Date(), 1).toISOString()));
    const [exemptFromCleanup, setExemptFromCleanup] = useState(false);
    const [optOutNewsletter, setOptOutNewsletter] = useState(false);
    const [libraries, setLibraries] = useState<Array<{ id: string; title: string; type?: string }>>([]);
    const [selectedLibraries, setSelectedLibraries] = useState<string[]>([]);
    const [librariesLoading, setLibrariesLoading] = useState(false);
    const [libraryShareSource, setLibraryShareSource] = useState<string | null>(null);
    const [overrideMovieQuota, setOverrideMovieQuota] = useState(false);
    const [movieQuotaLimit, setMovieQuotaLimit] = useState(0);
    const [movieQuotaDays, setMovieQuotaDays] = useState(7);
    const [overrideTvQuota, setOverrideTvQuota] = useState(false);
    const [tvQuotaLimit, setTvQuotaLimit] = useState(0);
    const [tvQuotaDays, setTvQuotaDays] = useState(7);
    const [allowRequestMovies, setAllowRequestMovies] = useState<'default' | 'on' | 'off'>('default');
    const [allowRequestTv, setAllowRequestTv] = useState<'default' | 'on' | 'off'>('default');
    const [allowRequest4kMovies, setAllowRequest4kMovies] = useState<'default' | 'on' | 'off'>('default');
    const [allowRequest4kTv, setAllowRequest4kTv] = useState<'default' | 'on' | 'off'>('default');
    const [allowAdvancedRequests, setAllowAdvancedRequests] = useState<'default' | 'on' | 'off'>('default');
    const initialLibraryPayloadRef = useRef<string[] | null>(null);
    const [librariesTouched, setLibrariesTouched] = useState(false);
    const [resetOnboardingMessage, setResetOnboardingMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    const libraryIdsPayloadFromSelection = useCallback((
        selected: string[],
        allLibraryIds: string[],
    ): string[] => {
        const allSelected =
            allLibraryIds.length > 0 &&
            selected.length >= allLibraryIds.length &&
            allLibraryIds.every((id) => selected.includes(id));
        return allSelected || selected.length === 0 ? [] : selected;
    }, []);

    const triFrom = (value: boolean | null | undefined): 'default' | 'on' | 'off' => {
        if (value === true) return 'on';
        if (value === false) return 'off';
        return 'default';
    };
    const triTo = (value: 'default' | 'on' | 'off'): boolean | null => {
        if (value === 'on') return true;
        if (value === 'off') return false;
        return null;
    };

    useEffect(() => {
        if (user) {
            setUsername(user.username);
            setJoiningDate(formatDate(user.joiningDate));
            setExpiryDate(user.expiryDate ? formatDate(user.expiryDate) : null);
            setExemptFromCleanup(!!user.exemptFromCleanup);
            setOptOutNewsletter(!!user.optOutNewsletter);
            setSelectedLibraries(Array.isArray(user.libraryIds) ? user.libraryIds.map(String) : []);
            setLibraryShareSource(null);
            initialLibraryPayloadRef.current = null;
            setLibrariesTouched(false);
            setResetOnboardingMessage(null);
            const ov = user.requestOverrides || {};
            setOverrideMovieQuota(ov.movieQuotaLimit != null);
            setMovieQuotaLimit(Number(ov.movieQuotaLimit) || 0);
            setMovieQuotaDays(Number(ov.movieQuotaDays) || 7);
            setOverrideTvQuota(ov.tvQuotaLimit != null);
            setTvQuotaLimit(Number(ov.tvQuotaLimit) || 0);
            setTvQuotaDays(Number(ov.tvQuotaDays) || 7);
            setAllowRequestMovies(triFrom(ov.allowRequestMovies));
            setAllowRequestTv(triFrom(ov.allowRequestTv));
            setAllowRequest4kMovies(triFrom(ov.allowRequest4kMovies));
            setAllowRequest4kTv(triFrom(ov.allowRequest4kTv));
            setAllowAdvancedRequests(triFrom(ov.allowAdvancedRequests));
        } else {
            setUsername('');
            setJoiningDate(formatDate(new Date().toISOString()));
            setExpiryDate(formatDate(addMonths(new Date(), 1).toISOString()));
            setExemptFromCleanup(false);
            setOptOutNewsletter(false);
            setSelectedLibraries([]);
            setOverrideMovieQuota(false);
            setMovieQuotaLimit(0);
            setMovieQuotaDays(7);
            setOverrideTvQuota(false);
            setTvQuotaLimit(0);
            setTvQuotaDays(7);
            setAllowRequestMovies('default');
            setAllowRequestTv('default');
            setAllowRequest4kMovies('default');
            setAllowRequest4kTv('default');
            setAllowAdvancedRequests('default');
        }
    }, [user, isOpen]);

    useEffect(() => {
        if (!isOpen || !user?.id) return;
        let cancelled = false;
        setLibrariesLoading(true);
        Promise.all([
            apiFetch('/api/plex/libraries').catch(() => []),
            apiFetch(`/api/users/${user.id}/share-libraries`).catch(() => null),
        ])
            .then(([libs, share]) => {
                if (cancelled) return;
                const list = Array.isArray(libs) ? libs : (Array.isArray(libs?.libraries) ? libs.libraries : []);
                const mapped = list.map((l: any) => ({ id: String(l.id), title: l.title || `Library ${l.id}`, type: l.type }));
                const allIds = mapped.map((l) => l.id);
                setLibraries(mapped);
                setLibraryShareSource(share?.source || null);

                let nextSelected: string[] = [];
                if (share?.hasShare === false || share?.source === 'no-share') {
                    nextSelected = [];
                } else if (share?.source === 'plex-all' || (share?.hasShare && share?.selectedIds == null)) {
                    nextSelected = allIds;
                } else if (share && Array.isArray(share.selectedIds)) {
                    const liveIds = share.selectedIds.map(String);
                    const matched = liveIds.filter((id: string) => allIds.includes(id));
                    nextSelected = matched.length ? matched : liveIds;
                } else if (Array.isArray(user.libraryIds) && user.libraryIds.length > 0) {
                    nextSelected = user.libraryIds.map(String);
                }
                setSelectedLibraries(nextSelected);
                initialLibraryPayloadRef.current = libraryIdsPayloadFromSelection(nextSelected, allIds);
                setLibrariesTouched(false);
            })
            .finally(() => {
                if (!cancelled) setLibrariesLoading(false);
            });
        return () => { cancelled = true; };
    }, [isOpen, user?.id, user?.libraryIds, libraryIdsPayloadFromSelection]);

    if (!isOpen) return null;

    const handleSave = () => {
        if (!user) return;
        const requestOverrides: User['requestOverrides'] = {
            movieQuotaLimit: overrideMovieQuota ? movieQuotaLimit : null,
            movieQuotaDays: overrideMovieQuota ? movieQuotaDays : null,
            tvQuotaLimit: overrideTvQuota ? tvQuotaLimit : null,
            tvQuotaDays: overrideTvQuota ? tvQuotaDays : null,
            fourKQuotaLimit: null,
            fourKQuotaDays: null,
            allowRequestMovies: triTo(allowRequestMovies),
            allowRequestTv: triTo(allowRequestTv),
            allowRequest4kMovies: triTo(allowRequest4kMovies),
            allowRequest4kTv: triTo(allowRequest4kTv),
            allowAdvancedRequests: triTo(allowAdvancedRequests),
        };
        const allLibraryIds = libraries.map((l) => l.id);
        const libraryIdsToSave = libraryIdsPayloadFromSelection(selectedLibraries, allLibraryIds);
        const initialPayload = initialLibraryPayloadRef.current;
        const librariesChanged = librariesTouched || (
            initialPayload == null
                ? libraryIdsToSave.length > 0
                : JSON.stringify([...libraryIdsToSave].sort()) !== JSON.stringify([...initialPayload].sort())
        );
        const updatedUser: User = {
            ...user,
            expiryDate,
            exemptFromCleanup,
            optOutNewsletter,
            requestOverrides,
        };
        if (librariesChanged) {
            updatedUser.libraryIds = libraryIdsToSave;
        }
        onSave(updatedUser);
    };

    const handleQuickAction = (action: 'addMonth' | 'addYear' | 'unlimited') => {
        const baseDate = expiryDate ? new Date(expiryDate) : new Date();
        // Adjust for timezone when creating date from YYYY-MM-DD input
        if (expiryDate) baseDate.setMinutes(baseDate.getMinutes() + baseDate.getTimezoneOffset());

        switch (action) {
            case 'addMonth': setExpiryDate(formatDate(addMonths(baseDate, 1).toISOString())); break;
            case 'addYear': setExpiryDate(formatDate(addYears(baseDate, 1).toISOString())); break;
            case 'unlimited': setExpiryDate(null); break;
        }
    };

    const permSelect = (
        label: string,
        value: 'default' | 'on' | 'off',
        onChange: (v: 'default' | 'on' | 'off') => void,
    ) => (
        <div>
            <label className="text-xs font-semibold text-muted mb-1 block">{label}</label>
            <CustomSelect
                value={value}
                onChange={(val) => onChange((val as 'default' | 'on' | 'off') || 'default')}
                options={[
                    { value: 'default', label: t('usersAdmin.modal.useGlobalDefault') },
                    { value: 'on', label: t('usersAdmin.modal.allow') },
                    { value: 'off', label: t('usersAdmin.modal.deny') },
                ]}
            />
        </div>
    );

    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex justify-center items-center z-[1000] p-3 sm:p-6" onClick={onClose}>
            <div className="bg-card p-4 md:p-6 lg:p-8 rounded-2xl w-full max-w-lg md:max-w-3xl max-h-[90vh] overflow-y-auto shadow-2xl border border-border" onClick={(e) => e.stopPropagation()}>
                <h2 className="text-2xl font-bold text-text mb-4">{t('usersAdmin.modal.editUser')}</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <div>
                        <label>{t('usersAdmin.modal.plexUsername')}</label>
                        <input className="w-full appearance-none p-3 rounded-lg border border-border bg-background text-[16px] leading-5 text-text outline-none focus:border-plex focus:ring-1 focus:ring-plex transition-all" type="text" value={username} disabled />
                    </div>
                    <div>
                        <label>{t('usersAdmin.modal.joiningDate')}</label>
                        <input className="w-full appearance-none p-3 rounded-lg border border-border bg-background text-[16px] leading-5 text-text outline-none focus:border-plex focus:ring-1 focus:ring-plex transition-all" type="date" value={joiningDate} disabled />
                    </div>
                </div>
                <div className="mb-4">
                    <label htmlFor="expiryDate">{t('usersAdmin.modal.expiryDate')}</label>
                    <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 items-end">
                        <input className="w-full appearance-none p-3 rounded-lg border border-border bg-background text-[16px] leading-5 text-text outline-none focus:border-plex focus:ring-1 focus:ring-plex transition-all" id="expiryDate" type="date" value={expiryDate ?? ''} onChange={(e) => setExpiryDate(e.target.value)} />
                        <div className="grid grid-cols-3 gap-2 md:w-[240px]">
                            <button type="button" className="w-full h-11 px-3 bg-border text-text rounded-md font-medium hover:bg-opacity-80 transition-colors flex items-center justify-center text-sm whitespace-nowrap" onClick={() => handleQuickAction('addMonth')}>{t('usersAdmin.actions.addMonthShort')}</button>
                            <button type="button" className="w-full h-11 px-3 bg-border text-text rounded-md font-medium hover:bg-opacity-80 transition-colors flex items-center justify-center text-sm whitespace-nowrap" onClick={() => handleQuickAction('addYear')}>{t('usersAdmin.actions.addYearShort')}</button>
                            <button type="button" className="w-full h-11 px-3 bg-border text-text rounded-md font-medium hover:bg-opacity-80 transition-colors flex items-center justify-center text-sm whitespace-nowrap" onClick={() => handleQuickAction('unlimited')}>{t('usersAdmin.modal.unlimited')}</button>
                        </div>
                    </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                    <div className="flex items-center justify-between bg-black/10 p-4 rounded-lg border border-border gap-3">
                        <div className="min-w-0">
                            <label className="font-bold block mb-1">{t('usersAdmin.modal.exemptCleanup')}</label>
                            <span className="text-xs text-muted block">{t('usersAdmin.modal.exemptCleanupHint')}</span>
                        </div>
                        <button
                            type="button"
                            onClick={() => setExemptFromCleanup(!exemptFromCleanup)}
                            className={`relative inline-flex items-center h-6 rounded-full w-11 shrink-0 transition-colors ${exemptFromCleanup ? 'bg-plex' : 'bg-border'}`}
                        >
                            <span className={`inline-block w-4 h-4 transform bg-white rounded-full transition-transform ${exemptFromCleanup ? 'translate-x-6' : 'translate-x-1'}`} />
                        </button>
                    </div>
                    <div className="flex items-center justify-between bg-black/10 p-4 rounded-lg border border-border gap-3">
                        <div className="min-w-0">
                            <label className="font-bold block mb-1">{t('usersAdmin.modal.disableNewsletter')}</label>
                            <span className="text-xs text-muted block">{t('usersAdmin.modal.disableNewsletterHint')}</span>
                        </div>
                        <button
                            type="button"
                            onClick={() => setOptOutNewsletter(!optOutNewsletter)}
                            className={`relative inline-flex items-center h-6 rounded-full w-11 shrink-0 transition-colors ${optOutNewsletter ? 'bg-plex' : 'bg-border'}`}
                        >
                            <span className={`inline-block w-4 h-4 transform bg-white rounded-full transition-transform ${optOutNewsletter ? 'translate-x-6' : 'translate-x-1'}`} />
                        </button>
                    </div>
                </div>
                {user?.id && (
                    <div className="mb-4 flex items-center justify-between bg-black/10 p-4 rounded-lg border border-border gap-3">
                        <div className="min-w-0">
                            <label className="font-bold block mb-1">{t('usersAdmin.modal.resetOnboarding')}</label>
                            <span className="text-xs text-muted block">{t('usersAdmin.modal.resetOnboardingHint')}</span>
                            {resetOnboardingMessage && (
                                <span className={`text-xs block mt-1 ${resetOnboardingMessage.type === 'success' ? 'text-emerald-400' : 'text-red-400'}`}>
                                    {resetOnboardingMessage.text}
                                </span>
                            )}
                        </div>
                        <button
                            type="button"
                            className="shrink-0 px-3 py-2 rounded-lg border border-border text-sm font-medium hover:border-plex transition-colors"
                            onClick={() => {
                                appConfirm(t('usersAdmin.modal.resetOnboardingConfirm', { name: user.username }), async () => {
                                    try {
                                        await apiFetch(`/api/users/${encodeURIComponent(user.id)}/reset-onboarding`, { method: 'POST' });
                                        setResetOnboardingMessage({ type: 'success', text: t('usersAdmin.modal.resetOnboardingSuccess') });
                                    } catch (e: any) {
                                        setResetOnboardingMessage({ type: 'error', text: e.message || t('usersAdmin.modal.resetOnboardingFailed') });
                                    }
                                });
                            }}
                        >
                            {t('usersAdmin.modal.resetOnboarding')}
                        </button>
                    </div>
                )}

                <div className="mb-4 pt-4 border-t border-border">
                    <h3 className="text-lg font-bold text-text mb-1">{t('usersAdmin.modal.libraryAccess')}</h3>
                    <p className="text-xs text-muted mb-3">
                        {t('usersAdmin.modal.libraryAccessHint')}
                    </p>
                    {libraryShareSource === 'no-share' ? (
                        <p className="mb-3 text-xs text-amber-300">
                            {t('usersAdmin.modal.noPlexShare')}
                        </p>
                    ) : libraryShareSource === 'plex-all' ? (
                        <p className="mb-3 text-xs text-muted">{t('usersAdmin.modal.allLibrariesShared')}</p>
                    ) : libraryShareSource === 'plex' ? (
                        <p className="mb-3 text-xs text-muted">{t('usersAdmin.modal.liveSharingLoaded')}</p>
                    ) : null}
                    {librariesLoading ? (
                        <div className="text-sm text-muted py-2">{t('usersAdmin.modal.loadingLibraries')}</div>
                    ) : libraries.length === 0 ? (
                        <div className="text-sm text-muted py-2">{t('usersAdmin.modal.noLibraries')}</div>
                    ) : (
                        <div className="flex flex-wrap gap-2">
                            {libraries.map((lib) => (
                                <label key={lib.id} className="flex items-center gap-2 bg-background border border-border px-3 py-2 rounded-lg cursor-pointer hover:border-plex transition-colors">
                                    <input
                                        type="checkbox"
                                        checked={selectedLibraries.includes(lib.id)}
                                        onChange={(e) => {
                                            setLibrariesTouched(true);
                                            if (e.target.checked) setSelectedLibraries([...selectedLibraries, lib.id]);
                                            else setSelectedLibraries(selectedLibraries.filter((id) => id !== lib.id));
                                        }}
                                        className="accent-plex"
                                    />
                                    <span className="text-sm font-medium">{lib.title}</span>
                                </label>
                            ))}
                        </div>
                    )}
                </div>

                {user?.id ? (
                    <div className="mt-2 pt-4 border-t border-border">
                        <PlexUserPermissions userId={user.id} />
                    </div>
                ) : null}

                <div className="mt-2 pt-4 border-t border-border">
                    <h3 className="text-lg font-bold text-text mb-1">{t('navigation.requests')}</h3>
                    <p className="text-xs text-muted mb-4">{t('usersAdmin.modal.requestDefaultsHint')}</p>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                        <div className="p-3 rounded-lg border border-border bg-black/10 space-y-2">
                            <label className="inline-flex items-center gap-2 text-sm font-semibold">
                                <input type="checkbox" checked={overrideMovieQuota} onChange={(e) => setOverrideMovieQuota(e.target.checked)} />
                                {t('usersAdmin.modal.overrideMovieQuota')}
                            </label>
                            {overrideMovieQuota && (
                                <div className="grid grid-cols-2 gap-2">
                                    <div>
                                        <label className="text-xs text-muted">{t('usersAdmin.modal.limitUnlimited')}</label>
                                        <input type="number" min={0} className="w-full appearance-none p-2 rounded-lg border border-border bg-background text-[16px] leading-5" value={movieQuotaLimit} onChange={(e) => setMovieQuotaLimit(Math.max(0, Number(e.target.value) || 0))} />
                                    </div>
                                    <div>
                                        <label className="text-xs text-muted">{t('usersAdmin.modal.days')}</label>
                                        <input type="number" min={1} className="w-full appearance-none p-2 rounded-lg border border-border bg-background text-[16px] leading-5" value={movieQuotaDays} onChange={(e) => setMovieQuotaDays(Math.max(1, Number(e.target.value) || 7))} />
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="p-3 rounded-lg border border-border bg-black/10 space-y-2">
                            <label className="inline-flex items-center gap-2 text-sm font-semibold">
                                <input type="checkbox" checked={overrideTvQuota} onChange={(e) => setOverrideTvQuota(e.target.checked)} />
                                {t('usersAdmin.modal.overrideSeriesQuota')}
                            </label>
                            {overrideTvQuota && (
                                <div className="grid grid-cols-2 gap-2">
                                    <div>
                                        <label className="text-xs text-muted">{t('usersAdmin.modal.limitUnlimited')}</label>
                                        <input type="number" min={0} className="w-full appearance-none p-2 rounded-lg border border-border bg-background text-[16px] leading-5" value={tvQuotaLimit} onChange={(e) => setTvQuotaLimit(Math.max(0, Number(e.target.value) || 0))} />
                                    </div>
                                    <div>
                                        <label className="text-xs text-muted">{t('usersAdmin.modal.days')}</label>
                                        <input type="number" min={1} className="w-full appearance-none p-2 rounded-lg border border-border bg-background text-[16px] leading-5" value={tvQuotaDays} onChange={(e) => setTvQuotaDays(Math.max(1, Number(e.target.value) || 7))} />
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {permSelect(t('usersAdmin.modal.requestMovies'), allowRequestMovies, setAllowRequestMovies)}
                        {permSelect(t('usersAdmin.modal.requestSeries'), allowRequestTv, setAllowRequestTv)}
                        {permSelect(t('usersAdmin.modal.request4kMovies'), allowRequest4kMovies, setAllowRequest4kMovies)}
                        {permSelect(t('usersAdmin.modal.request4kSeries'), allowRequest4kTv, setAllowRequest4kTv)}
                        {permSelect(t('usersAdmin.modal.allowAdvanced'), allowAdvancedRequests, setAllowAdvancedRequests)}
                    </div>
                </div>

                <div className="flex justify-end gap-4 mt-6 pt-4 border-t border-border">
                    <button type="button" className="px-6 py-3 bg-plex text-background rounded-md font-bold hover:bg-plex-hover transition-colors flex items-center justify-center gap-2" onClick={handleSave}>{t('usersAdmin.actions.save')}</button>
                </div>
            </div>
        </div>
    );
};






export const UserAnalyticsModal: React.FC<{ userId: string, username: string, thumb: string | null, days: string, onClose: () => void, onOpenProfile?: (userId: string) => void }> = ({ userId, username, thumb, days, onClose, onOpenProfile }) => {
    const { t } = useDiscoverI18n();
    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);
    const [activeTab, setActiveTab] = useState<'overview' | 'history' | 'graphs' | 'xp'>('overview');

    const [historyPage, setHistoryPage] = useState(1);
    const [historySearch, setHistorySearch] = useState('');
    const [historyData, setHistoryData] = useState<any[]>([]);
    const [historyTotal, setHistoryTotal] = useState(0);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [historySource, setHistorySource] = useState<'tautulli' | 'plex' | null>(null);
    const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null);
    const [xpAudit, setXpAudit] = useState<any>(null);
    const [xpAuditLoading, setXpAuditLoading] = useState(false);
    const [xpAuditError, setXpAuditError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(false);
        setActiveTab('overview');
        setHistoryPage(1);
        setHistorySearch('');
        setHistoryData([]);
        setHistorySource(null);
        setExpandedHistoryId(null);
        setXpAudit(null);
        setXpAuditError(null);
        apiFetch(`/api/plex/analytics/user/${userId}?days=${days}`)
            .then(res => { if (!cancelled) setData(res); })
            .catch(() => { if (!cancelled) setError(true); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [userId, days]);

    useEffect(() => {
        if (activeTab !== 'xp') return;
        let cancelled = false;
        setXpAuditLoading(true);
        setXpAuditError(null);
        apiFetch(`/api/achievements/admin/user/${encodeURIComponent(userId)}/audit`)
            .then((res) => {
                if (!cancelled) setXpAudit(res);
            })
            .catch((e: any) => {
                if (!cancelled) {
                    setXpAudit(null);
                    setXpAuditError(e?.message || t('userAnalytics.xp.noSnapshot'));
                }
            })
            .finally(() => {
                if (!cancelled) setXpAuditLoading(false);
            });
        return () => { cancelled = true; };
    }, [userId, activeTab, t]);

    useEffect(() => {
        if (activeTab !== 'history') return;
        let cancelled = false;
        setHistoryLoading(true);
        setExpandedHistoryId(null);
        apiFetch(`/api/plex/analytics/user/${userId}/history?page=${historyPage}&limit=15&search=${encodeURIComponent(historySearch)}`)
            .then(res => {
                if (!cancelled && res.data) {
                    setHistoryData(res.data);
                    setHistoryTotal(res.total);
                    setHistorySource(res.source === 'tautulli' ? 'tautulli' : 'plex');
                }
            })
            .catch(() => { })
            .finally(() => { if (!cancelled) setHistoryLoading(false); });
        return () => { cancelled = true; };
    }, [userId, activeTab, historyPage, historySearch]);

    const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
        setHistorySearch(e.target.value);
        setHistoryPage(1);
    };

    const formatHour = (h: number) => {
        if (h === 0) return '12 AM';
        if (h === 12) return '12 PM';
        return h > 12 ? `${h - 12} PM` : `${h} AM`;
    };

    const formatHistoryDuration = (seconds?: number | null) => {
        const total = Math.max(0, Math.round(Number(seconds) || 0));
        if (!total) return null;
        const hrs = Math.floor(total / 3600);
        const mins = Math.floor((total % 3600) / 60);
        if (hrs > 0) return `${hrs}h ${mins}m`;
        if (mins > 0) return `${mins}m`;
        return `${total}s`;
    };

    const formatHistoryTimestamp = (value?: number | string | null) => {
        if (value == null || value === '') return null;
        const raw = Number(value);
        if (!Number.isFinite(raw) || raw <= 0) return null;
        const ms = raw > 9999999999 ? raw : raw * 1000;
        return new Date(ms).toLocaleString();
    };

    const historyWatchedLabel = (status?: number | null) => {
        if (status == null) return null;
        if (status === 1) return t('userAnalytics.history.watched');
        if (status === 0) return t('userAnalytics.history.partial');
        return `Status ${status}`;
    };

    const formatSeasonEpisode = (season?: number | null, episode?: number | null) => {
        const s = season != null && Number.isFinite(Number(season)) ? Number(season) : null;
        const e = episode != null && Number.isFinite(Number(episode)) ? Number(episode) : null;
        if (s == null && e == null) return null;
        if (s != null && e != null) return `S${String(s).padStart(2, '0')}E${String(e).padStart(2, '0')}`;
        if (s != null) return `S${String(s).padStart(2, '0')}`;
        return `E${String(e!).padStart(2, '0')}`;
    };

    const daysOfWeek = [
        t('userAnalytics.charts.weekdays.sunday'),
        t('userAnalytics.charts.weekdays.monday'),
        t('userAnalytics.charts.weekdays.tuesday'),
        t('userAnalytics.charts.weekdays.wednesday'),
        t('userAnalytics.charts.weekdays.thursday'),
        t('userAnalytics.charts.weekdays.friday'),
        t('userAnalytics.charts.weekdays.saturday'),
    ];

    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
            <div className="bg-card/90 border border-border w-full max-w-6xl max-h-[90vh] rounded-2xl shadow-2xl overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div className="p-6 border-b border-border flex items-center justify-between bg-black/20 flex-shrink-0">
                    <div className="flex items-center gap-4">
                        <div className="w-16 h-16 rounded-full p-[2px] bg-gradient-to-r from-plex to-[#e5a00d]">
                            <img src={thumb ? (thumb.startsWith('http') ? thumb : portalUrl(`/api/plex/image?path=${encodeURIComponent(thumb)}&width=128&height=128`)) : logoUrl()} alt={username} className="w-full h-full rounded-full object-cover bg-card" onError={(e) => { (e.target as HTMLImageElement).src = logoUrl(); }} />
                        </div>
                        <div>
                            <h2 className="text-2xl font-bold text-text">{username}</h2>
                            <p className="text-muted text-sm">{loading ? t('userAnalytics.page.loadingStats') : `${t('userAnalytics.page.totalPlays', { count: data?.totalPlays || 0 })} (${days === 'all' ? t('wrapUp.allTime') : t('wrapUp.lastNDays', { days })})`}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        {onOpenProfile ? (
                            <button
                                type="button"
                                onClick={() => onOpenProfile(userId)}
                                className="text-sm font-bold text-plex hover:underline px-3 py-2 rounded-lg border border-white/10 bg-white/5"
                            >
                                {t('usersAdmin.actions.viewProfile')}
                            </button>
                        ) : null}
                        <button onClick={onClose} aria-label={t('common.close')} className="text-muted hover:text-white transition-colors bg-white/5 p-2 rounded-full"><X className="w-6 h-6" /></button>
                    </div>
                </div>

                {/* Tabs */}
                <div className="flex border-b border-border bg-black/40 px-6 gap-6">
                    {(['overview', 'history', 'graphs', 'xp'] as const).map(tab => (
                        <button key={tab} onClick={() => setActiveTab(tab)} className={`py-3 px-2 font-bold text-sm uppercase tracking-wider transition-colors border-b-2 ${activeTab === tab ? 'border-plex text-text' : 'border-transparent text-muted hover:text-white'}`}>
                            {t(`userAnalytics.tabs.${tab}` as 'userAnalytics.tabs.overview' | 'userAnalytics.tabs.history' | 'userAnalytics.tabs.graphs' | 'userAnalytics.tabs.xp')}
                        </button>
                    ))}
                </div>

                {/* Content */}
                <div className="p-6 overflow-y-auto flex-1 min-h-0 flex flex-col gap-8 custom-scrollbar">
                    {activeTab === 'xp' ? (
                        <div className="flex flex-col gap-5 min-h-[320px]">
                            <div>
                                <h3 className="text-lg font-bold text-text uppercase tracking-wider flex items-center gap-2">
                                    <Trophy className="text-plex w-4 h-4" /> {t('userAnalytics.xp.title')}
                                </h3>
                                <p className="text-xs text-muted mt-1">
                                    {t('userAnalytics.xp.description')}
                                </p>
                            </div>
                            {xpAuditLoading ? (
                                <div className="flex justify-center items-center h-40"><Loader isLoading={true} /></div>
                            ) : xpAuditError || !xpAudit ? (
                                <div className="flex flex-col items-center justify-center h-40 text-center gap-2">
                                    <AlertCircle className="w-8 h-8 text-amber-400" />
                                    <p className="text-muted text-sm">{xpAuditError || t('userAnalytics.xp.noData')}</p>
                                </div>
                            ) : (
                                <>
                                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                        {[
                                            { label: 'XP', value: Number(xpAudit.xp || 0).toLocaleString() },
                                            { label: t('common.level'), value: String(xpAudit.level || 1) },
                                            { label: t('common.badges'), value: `${xpAudit.earnedCount || 0}/${xpAudit.totalBadges || 0}` },
                                            { label: t('userAnalytics.xp.source'), value: String(xpAudit.watchHistorySource || 'plex') },
                                        ].map((card) => (
                                            <div key={card.label} className="rounded-xl border border-white/10 bg-black/25 px-3 py-2.5">
                                                <p className="text-[10px] uppercase tracking-widest text-muted font-bold">{card.label}</p>
                                                <p className="text-lg font-black text-text font-mono mt-1 tabular-nums">{card.value}</p>
                                            </div>
                                        ))}
                                    </div>
                                    <div className="text-[11px] text-muted flex flex-wrap gap-x-4 gap-y-1">
                                        {xpAudit.updatedAt && <span>{t('userAnalytics.xp.updated')} {new Date(xpAudit.updatedAt).toLocaleString()}</span>}
                                        {xpAudit.leaderboardOptOut ? <span className="text-amber-300">{t('userAnalytics.xp.hiddenLeaderboard')}</span> : null}
                                        {xpAudit.muteUnlockToasts ? <span>{t('userAnalytics.xp.unlockToastsMuted')}</span> : null}
                                        {Array.isArray(xpAudit.pinnedBadgeIds) && xpAudit.pinnedBadgeIds.length > 0 && (
                                            <span>{t('userAnalytics.xp.pinned')} {xpAudit.pinnedBadgeIds.join(', ')}</span>
                                        )}
                                    </div>
                                    <div>
                                        <h4 className="text-sm font-bold text-text mb-2">{t('userAnalytics.xp.breakdown')}</h4>
                                        <div className="space-y-1.5">
                                            {(Array.isArray(xpAudit.breakdown) ? xpAudit.breakdown : Object.entries(xpAudit.breakdown || {}).map(([key, xp]) => ({ key, xp })))
                                                .map((row: any) => {
                                                    const key = row.key || row.metric || row.id;
                                                    const xp = Number(row.xp ?? row.value ?? row.points ?? 0) || 0;
                                                    if (!key && !xp) return null;
                                                    return (
                                                        <div key={String(key)} className="flex items-center justify-between gap-3 rounded-lg border border-white/5 bg-black/20 px-3 py-2 text-sm">
                                                            <span className="text-text truncate">{String(key)}</span>
                                                            <span className="font-mono text-plex font-bold tabular-nums shrink-0">+{xp.toLocaleString()}</span>
                                                        </div>
                                                    );
                                                })}
                                            {!(Array.isArray(xpAudit.breakdown) ? xpAudit.breakdown.length : Object.keys(xpAudit.breakdown || {}).length) && (
                                                <p className="text-sm text-muted">{t('userAnalytics.xp.noBreakdown')}</p>
                                            )}
                                        </div>
                                    </div>
                                    {Array.isArray(xpAudit.recentBadges) && xpAudit.recentBadges.length > 0 && (
                                        <div>
                                            <h4 className="text-sm font-bold text-text mb-2">{t('userAnalytics.xp.recentBadges')}</h4>
                                            <div className="flex flex-wrap gap-2">
                                                {xpAudit.recentBadges.map((b: any) => (
                                                    <span key={b.id} className="text-[11px] rounded-lg border border-white/10 bg-black/25 px-2.5 py-1 font-mono text-muted">
                                                        {b.id}{b.earnedAt ? ` · ${new Date(b.earnedAt).toLocaleDateString()}` : ''}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                    {xpAudit.stats && (
                                        <details className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                                            <summary className="cursor-pointer text-xs font-semibold text-muted hover:text-text">{t('userAnalytics.xp.rawStats')}</summary>
                                            <pre className="mt-2 text-[10px] text-muted overflow-x-auto whitespace-pre-wrap font-mono">
                                                {JSON.stringify(xpAudit.stats, null, 2)}
                                            </pre>
                                        </details>
                                    )}
                                </>
                            )}
                        </div>
                    ) : loading ? (
                        <div className="flex justify-center items-center h-40"><Loader isLoading={true} /></div>
                    ) : (error || !data) ? (
                        <div className="flex flex-col items-center justify-center h-40 text-center gap-2">
                            <AlertCircle className="w-8 h-8 text-red-500" />
                            <p className="text-muted text-sm">{t('userAnalytics.page.loadError')}</p>
                        </div>
                    ) : activeTab === 'overview' ? (
                        <>
                            {/* Top row */}
                            <div>
                                <h3 className="text-lg font-bold text-text mb-4 uppercase tracking-wider flex items-center gap-2"><PlaySquare className="text-plex w-4 h-4" /> {t('userAnalytics.overview.favoriteLibraries')}</h3>
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
                                    {(data.topLibraries ?? []).length === 0 ? <p className="text-muted text-sm col-span-full">{t('userAnalytics.overview.noLibraryData')}</p> : data.topLibraries.map((lib: any, i: number) => (
                                        <div key={lib.id} className="flex justify-between items-center bg-black/20 p-2 rounded border border-white/5">
                                            <span className="font-bold text-sm text-text"><span className="text-muted mr-2">#{i + 1}</span>{lib.title}</span>
                                            <span className="text-plex text-xs font-mono">{t('userAnalytics.overview.plays', { count: lib.plays })}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {data.topMovies && data.topMovies.length > 0 && (
                                <div>
                                    <h3 className="text-lg font-bold text-text mb-4 uppercase tracking-wider flex items-center gap-2"><Film className="text-plex w-4 h-4" /> {t('userAnalytics.overview.topMovies')}</h3>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
                                        {data.topMovies.slice(0, 15).map((c: any, i: number) => (
                                            <a key={c.key} href={c.plexUrl} target="_blank" rel="noreferrer" className="flex items-center gap-3 bg-black/20 p-2 rounded border border-white/5 hover:bg-white/10 transition-colors">
                                                <div className="w-8 h-12 bg-black/40 rounded overflow-hidden flex-shrink-0 relative">
                                                    {c.thumbUrl && <img src={resolvePortalAssetUrl(c.thumbUrl)} className="w-full h-full object-cover" onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.nextElementSibling?.classList.remove('hidden'); }} />}
                                                    <div className={`absolute inset-0 w-full h-full p-2 opacity-50 flex items-center justify-center ${c.thumbUrl ? 'hidden' : ''}`}>
                                                        <Film className="w-full h-full" />
                                                    </div>
                                                </div>
                                                <div className="flex flex-col flex-grow overflow-hidden">
                                                    <span className="font-bold text-sm text-text truncate">{c.title}</span>
                                                    <span className="text-muted text-[10px] uppercase tracking-wider">{c.type}</span>
                                                </div>
                                                <span className="text-plex text-xs font-mono whitespace-nowrap">{t('userAnalytics.overview.plays', { count: c.plays })}</span>
                                            </a>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {data.topShows && data.topShows.length > 0 && (
                                <div>
                                    <h3 className="text-lg font-bold text-text mb-4 uppercase tracking-wider flex items-center gap-2"><TrendingUp className="text-plex w-4 h-4" /> {t('userAnalytics.overview.topShows')}</h3>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
                                        {data.topShows.slice(0, 15).map((c: any, i: number) => (
                                            <a key={c.key} href={c.plexUrl} target="_blank" rel="noreferrer" className="flex items-center gap-3 bg-black/20 p-2 rounded border border-white/5 hover:bg-white/10 transition-colors">
                                                <div className="w-8 h-12 bg-black/40 rounded overflow-hidden flex-shrink-0 relative">
                                                    {c.thumbUrl && <img src={resolvePortalAssetUrl(c.thumbUrl)} className="w-full h-full object-cover" onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.nextElementSibling?.classList.remove('hidden'); }} />}
                                                    <div className={`absolute inset-0 w-full h-full p-2 opacity-50 flex items-center justify-center ${c.thumbUrl ? 'hidden' : ''}`}>
                                                        <Film className="w-full h-full" />
                                                    </div>
                                                </div>
                                                <div className="flex flex-col flex-grow overflow-hidden">
                                                    <span className="font-bold text-sm text-text truncate">{c.title}</span>
                                                    <span className="text-muted text-[10px] uppercase tracking-wider">{c.type}</span>
                                                </div>
                                                <span className="text-plex text-xs font-mono whitespace-nowrap">{t('userAnalytics.overview.plays', { count: c.plays })}</span>
                                            </a>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </>
                    ) : activeTab === 'history' ? (
                        <div className="flex flex-col gap-4 h-full min-h-[400px]">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                <div>
                                <h3 className="text-lg font-bold text-text uppercase tracking-wider flex items-center gap-2"><Activity className="text-plex w-4 h-4" /> {t('userAnalytics.history.title')}</h3>
                                    {historySource === 'plex' ? (
                                        <p className="mt-1 text-[11px] text-muted">{t('userAnalytics.history.plexHint')}</p>
                                    ) : historySource === 'tautulli' ? (
                                        <p className="mt-1 text-[11px] text-muted">{t('userAnalytics.history.tautulliHint')}</p>
                                    ) : null}
                                </div>
                                <div className="relative w-full sm:w-64">
                                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                                    <input
                                        type="text"
                                        inputMode="search"
                                        enterKeyHint="search"
                                        autoComplete="off"
                                        autoCorrect="off"
                                        autoCapitalize="none"
                                        spellCheck={false}
                                        placeholder={t('userAnalytics.history.searchPlaceholder')}
                                        value={historySearch}
                                        onChange={handleSearch}
                                        className="w-full appearance-none rounded-xl border border-white/10 bg-black/20 py-3 pl-10 pr-3 text-[16px] leading-5 text-text outline-none transition focus:border-plex/40 focus:ring-1 focus:ring-plex/20"
                                        style={{ fontSize: 16 }}
                                    />
                                </div>
                            </div>

                            <div className="flex-1 overflow-y-auto bg-black/20 rounded-xl border border-white/5 p-2 custom-scrollbar">
                                {historyLoading ? (
                                    <div className="flex justify-center items-center h-40"><Loader isLoading={true} /></div>
                                ) : historyData.length === 0 ? (
                                    <div className="flex justify-center items-center h-40 text-muted">{t('userAnalytics.history.empty')}</div>
                                ) : (
                                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                                        {historyData.map((h: any, i: number) => {
                                            const rowId = String(h.id || `${h.title}-${h.viewedAt}-${i}`);
                                            const expanded = expandedHistoryId === rowId;
                                            const durationLabel = formatHistoryDuration(h.duration);
                                            const playDurationLabel = formatHistoryDuration(h.playDuration);
                                            const pausedSeconds = Number(h.pausedCount) || 0;
                                            const pausedLabel = formatHistoryDuration(pausedSeconds);
                                            const seasonEpisode = formatSeasonEpisode(h.seasonNumber, h.episodeNumber);
                                            const playerLabel = [h.player, h.platform].filter(Boolean).join(' · ');
                                            const startedLabel = formatHistoryTimestamp(h.startedAt ?? h.viewedAt);
                                            const stoppedLabel = formatHistoryTimestamp(h.stoppedAt);
                                            const watchedLabel = historyWatchedLabel(h.watchedStatus);
                                            const detailRows: Array<{ label: string; value: string }> = [
                                                startedLabel ? { label: t('userAnalytics.history.started'), value: startedLabel } : null,
                                                stoppedLabel ? { label: t('userAnalytics.history.stopped'), value: stoppedLabel } : null,
                                                playDurationLabel ? { label: t('userAnalytics.history.watchedFor'), value: playDurationLabel } : null,
                                                durationLabel ? { label: t('userAnalytics.history.mediaLength'), value: durationLabel } : null,
                                                h.percentComplete != null ? { label: t('userAnalytics.history.progress'), value: `${h.percentComplete}%` } : null,
                                                historySource === 'tautulli' ? { label: t('userAnalytics.history.pausedFor'), value: pausedLabel || t('userAnalytics.history.none') } : null,
                                                seasonEpisode ? { label: t('userAnalytics.history.episode'), value: seasonEpisode } : null,
                                                watchedLabel ? { label: t('userAnalytics.history.status'), value: watchedLabel } : null,
                                                h.player ? { label: t('userAnalytics.history.player'), value: String(h.player) } : null,
                                                h.platform ? { label: t('userAnalytics.history.platform'), value: String(h.platform) } : null,
                                                h.product ? { label: t('userAnalytics.history.product'), value: String(h.product) } : null,
                                                h.transcodeDecision ? { label: t('userAnalytics.history.stream'), value: String(h.transcodeDecision) } : null,
                                                h.ipAddress ? { label: t('userAnalytics.history.ip'), value: String(h.ipAddress) } : null,
                                                h.location ? { label: t('userAnalytics.history.location'), value: String(h.location) } : null,
                                                h.year ? { label: t('userAnalytics.history.year'), value: String(h.year) } : null,
                                                h.type ? { label: t('userAnalytics.history.type'), value: String(h.type) } : null,
                                            ].filter(Boolean) as Array<{ label: string; value: string }>;
                                            return (
                                            <div
                                                key={rowId}
                                                className={`bg-white/5 border border-white/5 rounded-lg hover:bg-white/10 transition-colors ${expanded ? 'sm:col-span-2 lg:col-span-3 bg-white/[0.07]' : ''}`}
                                            >
                                                <button
                                                    type="button"
                                                    onClick={() => setExpandedHistoryId(expanded ? null : rowId)}
                                                    className="w-full flex items-center gap-3 p-2 text-left"
                                                    aria-expanded={expanded}
                                                >
                                                    <div className={`${h.type === 'track' ? 'w-12 h-12' : 'w-10 h-14'} bg-black/40 rounded overflow-hidden flex-shrink-0`}>
                                                        {h.thumbUrl && <img src={resolvePortalAssetUrl(h.thumbUrl)} className="w-full h-full object-cover" onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.nextElementSibling?.classList.remove('hidden'); }} />}
                                                        <div className={`w-full h-full p-2 opacity-50 flex items-center justify-center ${h.thumbUrl ? 'hidden' : ''}`}>
                                                            {h.type === 'track' ? <Music className="w-full h-full" /> : <Film className="w-full h-full" />}
                                                        </div>
                                                    </div>
                                                    <div className="flex flex-col overflow-hidden w-full min-w-0">
                                                        <span className="font-bold text-sm text-text truncate w-[95%]">{h.title}</span>
                                                        {(h.parentTitle || h.episodeTitle || seasonEpisode) && h.type !== 'movie' && (
                                                            <span className="text-muted text-xs truncate w-[95%]">
                                                                {seasonEpisode ? (
                                                                    <span className="text-plex font-mono mr-1.5">{seasonEpisode}</span>
                                                                ) : null}
                                                                {h.parentTitle || h.episodeTitle || ''}
                                                            </span>
                                                        )}
                                                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1">
                                                            <span className="text-plex font-mono text-[10px]">
                                                                {h.viewedAt ? formatPortalDateTime(h.viewedAt) : t('userAnalytics.history.unknownDate')}
                                                            </span>
                                                            {durationLabel ? (
                                                                <span className="text-muted font-mono text-[10px]">{durationLabel}</span>
                                                            ) : null}
                                                            {h.percentComplete != null && h.percentComplete < 100 && (
                                                                <span className="text-yellow-500 font-mono text-[10px]">{h.percentComplete}%</span>
                                                            )}
                                                            {pausedLabel ? (
                                                                <span className="inline-flex items-center gap-0.5 text-amber-300 font-mono text-[10px]" title={`${t('userAnalytics.history.pausedFor')} ${pausedLabel}`}>
                                                                    <Pause className="w-3 h-3" /> {pausedLabel}
                                                                </span>
                                                            ) : null}
                                                        </div>
                                                        {playerLabel ? (
                                                            <span className="text-muted text-[10px] truncate mt-0.5" title={playerLabel}>{playerLabel}</span>
                                                        ) : null}
                                                    </div>
                                                    <span className="flex-shrink-0 text-muted" aria-hidden>
                                                        {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                                                    </span>
                                                </button>
                                                {expanded ? (
                                                    <div className="px-3 pb-3 pt-0 border-t border-white/5 mx-2 mb-2">
                                                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-2 pt-3">
                                                            {detailRows.map((row) => (
                                                                <div key={row.label} className="min-w-0">
                                                                    <div className="text-[10px] uppercase tracking-wider text-muted">{row.label}</div>
                                                                    <div className="text-xs text-text truncate" title={row.value}>{row.value}</div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                        {historySource === 'tautulli' ? (
                                                            <p className="mt-3 text-[10px] text-muted">
                                                                {t('userAnalytics.history.tautulliPauseHint')}
                                                            </p>
                                                        ) : (
                                                            <p className="mt-3 text-[10px] text-muted">
                                                                {t('userAnalytics.history.plexSessionHint')}
                                                            </p>
                                                        )}
                                                    </div>
                                                ) : null}
                                            </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>

                            {/* Pagination */}
                            {historyTotal > 15 && (
                                <div className="flex justify-between items-center pt-2 border-t border-border mt-2 flex-shrink-0">
                                    <span className="text-sm text-muted">{t('userAnalytics.history.showing', { from: Math.min((historyPage - 1) * 15 + 1, historyTotal), to: Math.min(historyPage * 15, historyTotal), total: historyTotal })}</span>
                                    <div className="flex gap-2">
                                        <button type="button" disabled={historyPage === 1} onClick={() => setHistoryPage(p => p - 1)} className="bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-white/10 px-3 py-1.5 rounded-lg text-sm text-white font-bold transition-colors">{t('userAnalytics.history.prev')}</button>
                                        <button type="button" disabled={historyPage * 15 >= historyTotal} onClick={() => setHistoryPage(p => p + 1)} className="bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-white/10 px-3 py-1.5 rounded-lg text-sm text-white font-bold transition-colors">{t('userAnalytics.history.next')}</button>
                                    </div>
                                </div>
                            )}
                        </div>
                    ) : activeTab === 'graphs' ? (
                        <div className="flex flex-col gap-6 h-full min-h-[400px]">
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                <div className="glass-card-sm p-4 bg-black/20">
                                    <h3 className="text-sm font-bold text-text mb-4 uppercase tracking-wider">{t('userAnalytics.charts.playsByHour')}</h3>
                                    <div className="h-64">
                                        {data.hourDistribution ? (
                                            <ResponsiveContainer width="100%" height="100%">
                                                <LineChart data={data.hourDistribution.map((plays: number, i: number) => ({ hour: formatHour(i), plays }))}>
                                                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" vertical={false} />
                                                    <XAxis dataKey="hour" stroke="rgba(255,255,255,0.3)" fontSize={11} tickMargin={10} minTickGap={20} />
                                                    <YAxis stroke="rgba(255,255,255,0.3)" fontSize={11} allowDecimals={false} />
                                                    <RechartsTooltip
                                                        contentStyle={{ backgroundColor: 'rgba(20,20,20,0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }}
                                                        itemStyle={{ color: '#E5A00D' }}
                                                    />
                                                    <Line type="monotone" dataKey="plays" name={t('userAnalytics.charts.plays')} stroke="#E5A00D" strokeWidth={3} dot={{ fill: '#E5A00D', strokeWidth: 2, r: 4 }} activeDot={{ r: 6 }} />
                                                </LineChart>
                                            </ResponsiveContainer>
                                        ) : <p className="text-muted text-sm">{t('userAnalytics.charts.noData')}</p>}
                                    </div>
                                </div>

                                <div className="glass-card-sm p-4 bg-black/20">
                                    <h3 className="text-sm font-bold text-text mb-4 uppercase tracking-wider">{t('userAnalytics.charts.playsByDay')}</h3>
                                    <div className="h-64">
                                        {data.dayOfWeekCounts ? (
                                            <ResponsiveContainer width="100%" height="100%">
                                                <BarChart data={Object.values(data.dayOfWeekCounts).map((plays: any, i: number) => ({ day: daysOfWeek[i].substring(0, 3), plays }))}>
                                                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" vertical={false} />
                                                    <XAxis dataKey="day" stroke="rgba(255,255,255,0.3)" fontSize={11} tickMargin={10} />
                                                    <YAxis stroke="rgba(255,255,255,0.3)" fontSize={11} allowDecimals={false} />
                                                    <RechartsTooltip
                                                        contentStyle={{ backgroundColor: 'rgba(20,20,20,0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }}
                                                        itemStyle={{ color: '#E5A00D' }}
                                                        cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                                                    />
                                                    <Bar dataKey="plays" name={t('userAnalytics.charts.plays')} fill="#E5A00D" radius={[4, 4, 0, 0]} />
                                                </BarChart>
                                            </ResponsiveContainer>
                                        ) : <p className="text-muted text-sm">{t('userAnalytics.charts.noData')}</p>}
                                    </div>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
                                <div className="glass-card-sm p-4 bg-black/20">
                                    <h3 className="text-sm font-bold text-text mb-4 uppercase tracking-wider">{t('userAnalytics.charts.playsByLibrary')}</h3>
                                    <div className="h-64">
                                        {data.topLibraries && data.topLibraries.length > 0 ? (
                                            <ResponsiveContainer width="100%" height="100%">
                                                <RechartsPieChart>
                                                    <Pie
                                                        data={data.topLibraries}
                                                        dataKey="plays"
                                                        nameKey="title"
                                                        cx="50%"
                                                        cy="50%"
                                                        outerRadius={80}
                                                        innerRadius={40}
                                                        fill="#E5A00D"
                                                        label={({ name, percent }: any) => `${name} ${(percent * 100).toFixed(0)}%`}
                                                        labelLine={false}
                                                    >
                                                        {data.topLibraries.map((entry: any, index: number) => (
                                                            <Cell key={`cell-${index}`} fill={['#E5A00D', '#3B82F6', '#10B981', '#EF4444', '#8B5CF6', '#EC4899'][index % 6]} />
                                                        ))}
                                                    </Pie>
                                                    <RechartsTooltip
                                                        contentStyle={{ backgroundColor: 'rgba(20,20,20,0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }}
                                                        itemStyle={{ color: '#E5A00D' }}
                                                    />
                                                </RechartsPieChart>
                                            </ResponsiveContainer>
                                        ) : <p className="text-muted text-sm">{t('userAnalytics.charts.noData')}</p>}
                                    </div>
                                </div>

                                <div className="glass-card-sm p-4 bg-black/20">
                                    <h3 className="text-sm font-bold text-text mb-4 uppercase tracking-wider">{t('userAnalytics.charts.topShows')}</h3>
                                    <div className="h-64">
                                        {data.topShows && data.topShows.length > 0 ? (
                                            <ResponsiveContainer width="100%" height="100%">
                                                <BarChart data={data.topShows.slice(0, 5)} layout="vertical" margin={{ left: 0, right: 20 }}>
                                                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" horizontal={true} vertical={false} />
                                                    <XAxis type="number" stroke="rgba(255,255,255,0.3)" fontSize={11} allowDecimals={false} />
                                                    <YAxis dataKey="title" type="category" stroke="rgba(255,255,255,0.3)" fontSize={10} width={90} tickFormatter={(val) => val.length > 13 ? val.substring(0, 13) + '...' : val} />
                                                    <RechartsTooltip
                                                        contentStyle={{ backgroundColor: 'rgba(20,20,20,0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }}
                                                        itemStyle={{ color: '#E5A00D' }}
                                                        cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                                                    />
                                                    <Bar dataKey="plays" name={t('userAnalytics.charts.plays')} fill="#3B82F6" radius={[0, 4, 4, 0]} />
                                                </BarChart>
                                            </ResponsiveContainer>
                                        ) : <p className="text-muted text-sm">{t('userAnalytics.charts.noData')}</p>}
                                    </div>
                                </div>
                            </div>
                        </div>
                    ) : null}
                </div>
            </div>
        </div>
    );
};
