import { AlertCircle,AlertTriangle,Calendar,CheckCircle,Mail,RefreshCw,Search,Shield,Sparkles,Users } from 'lucide-react';
import React,{ useCallback,useEffect,useMemo,useState } from 'react';

import { useDiscoverI18n } from '../discovery/i18n';
import { ExtensionRequestsAdmin } from '../extension/ExtensionRequestsAdmin';
import { EmailSelectedUsersModal } from '../settings/EmailSelectedUsersModal';
import { apiFetch } from '../shared/api';
import { portalUrl } from '../shared/basePath';
import { appConfirm,askConfirm } from '../shared/confirm';
import {
DashboardHero,
DashboardPageShell,
DashboardPanel,
DashboardStatCard,
dashboardGlowClass,
dashboardSubnavLinkClass,
preferCollapsedOnNarrow,
usePersistedCollapsed
} from '../shared/dashboard/DashboardChrome';
import { getDaysUntilExpiry } from '../shared/format';
import { Loader,ToastContainer,pushToast } from '../shared/toast';
import type { AppSettings,AuditEntry,DeletedUser,PlexConfig,ToastMessage,User } from '../shared/types';
import { CustomSelect } from '../shared/ui';
import { UserCard,UserModal } from './adminUsers';
import { USERS_STATS_COLLAPSED_KEY } from './downloads';


// --- Admin Dashboard Component ---

export const AdminDashboard: React.FC<{ onLogout: () => void, onViewUserPortal: () => void, onViewStatus: () => void, onViewDashboard: () => void, onViewAsUser: (userId: string) => Promise<void>, onViewProfile?: (userId: string) => void }> = ({ onLogout, onViewUserPortal, onViewStatus, onViewDashboard, onViewAsUser, onViewProfile }) => {
    const { t } = useDiscoverI18n();
    const [users, setUsers] = useState<User[]>([]);
    const [isConfigured, setConfigured] = useState(false);
    const [configSettings, setConfigSettings] = useState<AppSettings>({ checkIntervalMinutes: 60 });
    const [isUserModalOpen, setUserModalOpen] = useState(false);
    const [isSettingsModalOpen, setSettingsModalOpen] = useState(false);
    const [editingUser, setEditingUser] = useState<User | null>(null);
    const [isLoading, setLoading] = useState(true);
    const [toasts, setToasts] = useState<ToastMessage[]>([]);
    const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
    const [bulkCustomDate, setBulkCustomDate] = useState('');
    const [bulkLibrariesOpen, setBulkLibrariesOpen] = useState(false);
    const [bulkLibraries, setBulkLibraries] = useState<Array<{ id: string; title: string }>>([]);
    const [bulkSelectedLibraries, setBulkSelectedLibraries] = useState<string[]>([]);
    const [bulkLibrariesLoading, setBulkLibrariesLoading] = useState(false);
    const [emailModalOpen, setEmailModalOpen] = useState(false);
    const [emailUserIds, setEmailUserIds] = useState<string[]>([]);
    const [deletedUsers, setDeletedUsers] = useState<DeletedUser[]>([]);
    const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);

    // Filters and Sorting States
    const [searchQuery, setSearchQuery] = useState(() => {
        if (typeof window === 'undefined') return '';
        try {
            return new URLSearchParams(window.location.search).get('q')?.trim() || '';
        } catch {
            return '';
        }
    });
    const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'trial' | 'expiring' | 'expired' | 'revoked' | 'pending'>('all');
    const [extraFilters, setExtraFilters] = useState<Array<'noEmail' | 'neverLoggedIn' | 'exempt' | 'newsletterOff'>>([]);
    const [sortBy, setSortBy] = useState<'username-asc' | 'username-desc' | 'expiry-asc' | 'expiry-desc' | 'joined-desc' | 'lastLogin-desc' | 'lastLogin-asc'>('username-asc');
    const mediaServerType = String(configSettings.mediaServerType || 'plex').toLowerCase();
    const mediaServerLabel = mediaServerType === 'emby' ? 'Emby' : mediaServerType === 'jellyfin' ? 'Jellyfin' : 'Plex';

    const addToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
        setToasts(t => pushToast(t, message, type));
    }, []);

    useEffect(() => {
        const syncSearchFromUrl = () => {
            try {
                const q = new URLSearchParams(window.location.search).get('q')?.trim() || '';
                if (q) setSearchQuery(q);
            } catch {
                /* ignore */
            }
        };
        syncSearchFromUrl();
        window.addEventListener('popstate', syncSearchFromUrl);
        return () => window.removeEventListener('popstate', syncSearchFromUrl);
    }, []);

    const fetchUsers = useCallback(async () => {
        try {
            const usersData = await apiFetch('/api/users');
            setUsers(usersData);
        } catch (error) {
            addToast(error instanceof Error ? error.message : t('usersAdmin.errors.fetchUsers'), 'error');
        }
    }, [addToast, t]);

    const fetchSecurityData = useCallback(async () => {
        try {
            const [deletedUsersData, auditLogData] = await Promise.all([
                apiFetch('/api/deleted-users'),
                apiFetch('/api/audit-log')
            ]);
            setDeletedUsers(deletedUsersData);
            setAuditEntries(Array.isArray(auditLogData?.entries) ? auditLogData.entries : (Array.isArray(auditLogData) ? auditLogData : []));
        } catch (error) {
            addToast(error instanceof Error ? error.message : t('usersAdmin.errors.fetchSecurity'), 'error');
        }
    }, [addToast, t]);

    useEffect(() => {
        const checkConfigAndFetchData = async () => {
            setLoading(true);
            try {
                const configStatus = await apiFetch('/api/config');
                setConfigured(configStatus.configured);
                setConfigSettings(configStatus.settings); // Always update settings from backend

                if (configStatus.configured) {
                    await fetchUsers();
                    await fetchSecurityData();
                } else {
                    addToast(t('usersAdmin.toasts.configureWelcome'), 'success');
                    setSettingsModalOpen(true);
                }
            } catch (error) {
                addToast(error instanceof Error ? error.message : t('usersAdmin.errors.backendConnection'), 'error');
            } finally {
                setLoading(false);
            }
        };
        checkConfigAndFetchData();
    }, [fetchUsers, fetchSecurityData, addToast]);


    const handleSaveConfig = async (config: PlexConfig) => {
        setLoading(true);
        try {
            await apiFetch('/api/config', {
                method: 'POST',
                body: JSON.stringify(config)
            });
            setConfigured(true);
            setConfigSettings({
                token: config.token,
                serverIdentifier: config.serverIdentifier,
                checkIntervalMinutes: config.checkIntervalMinutes || 60,
                smtpHost: config.smtpHost,
                smtpPort: config.smtpPort,
                smtpUser: config.smtpUser,
                smtpPass: config.smtpPass,
                smtpFrom: config.smtpFrom,
                smtpSecure: config.smtpSecure,
                emailDaysBefore: config.emailDaysBefore,
                newsletterFrequency: config.newsletterFrequency,
                newsletterDay: config.newsletterDay,
                publicDomain: config.publicDomain
            });
            setSettingsModalOpen(false);
            addToast(t('usersAdmin.toasts.settingsSaved'));
            await fetchUsers();
        } catch (error) {
            addToast(error instanceof Error ? error.message : t('usersAdmin.errors.saveConfig'), 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleImportUsers = async () => {
        if (!isConfigured) {
            addToast(t('usersAdmin.errors.configureMediaServer', { mediaServerLabel }), 'error');
            return;
        }
        setLoading(true);
        try {
            const result = await apiFetch('/api/sync', { method: 'POST' });
            addToast(result.message || t('usersAdmin.toasts.syncedUsers', { count: result.count || 0, mediaServerLabel }));
            await fetchUsers(); // Refresh user list
            await fetchSecurityData();
        } catch (error) {
            addToast(error instanceof Error ? error.message : t('usersAdmin.errors.sync'), 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleBackfillJoiningDates = async () => {
        if (!isConfigured) {
            addToast(t('usersAdmin.errors.configureMediaServer', { mediaServerLabel }), 'error');
            return;
        }
        setLoading(true);
        try {
            const result = await apiFetch('/api/users/backfill-joining-dates', {
                method: 'POST',
                body: JSON.stringify({ overwriteIfEarlier: true }),
            });
            const updated = Number(result?.updated) || 0;
            const processed = Number(result?.processed) || 0;
            const missing = Number(result?.missing) || 0;
            if (updated > 0) {
                addToast(t('usersAdmin.toasts.joinDatesUpdated', { updated, processed }));
            } else {
                addToast(
                    missing > 0
                        ? t('usersAdmin.toasts.noJoinDatesUpdated', { missing })
                        : t('usersAdmin.toasts.noJoinDatesNeeded'),
                );
            }
            await fetchUsers();
        } catch (error) {
            addToast(error instanceof Error ? error.message : t('usersAdmin.errors.backfillJoinDates'), 'error');
        } finally {
            setLoading(false);
        }
    };

    const revokePlexAccess = async (user: User) => {
        const ok = await askConfirm(
            t('usersAdmin.dialogs.revokeUser', { username: user.username, provider: mediaServerLabel }),
            {
                title: t('usersAdmin.actions.revoke'),
                confirmLabel: t('usersAdmin.actions.revoke'),
                cancelLabel: t('common.cancel'),
                danger: true,
            },
        );
        if (!ok) return;
        setLoading(true);
        try {
            const updatedUser = await apiFetch(`/api/users/${user.id}/revoke`, { method: 'POST' });
            setUsers(currentUsers => currentUsers.map(u => u.id === user.id ? updatedUser : u));
            addToast(t('usersAdmin.toasts.accessRevoked'));
            await fetchSecurityData();
        } catch (error) {
            addToast(error instanceof Error ? error.message : t('usersAdmin.errors.revokeAccess'), 'error');
        } finally {
            setLoading(false);
        }
    };

    const resendUserInvite = async (user: User) => {
        const ok = await askConfirm(
            t('usersAdmin.dialogs.resendInvite', { username: user.username }),
            {
                title: t('usersAdmin.actions.resendInvite'),
                confirmLabel: t('usersAdmin.actions.resendInvite'),
                cancelLabel: t('common.cancel'),
            },
        );
        if (!ok) return;
        setLoading(true);
        try {
            const updatedUser = await apiFetch(`/api/users/${user.id}/resend-invite`, { method: 'POST' });
            setUsers(currentUsers => currentUsers.map(u => u.id === user.id ? updatedUser : u));
            addToast(t('usersAdmin.toasts.inviteResent', { username: user.username }));
        } catch (error) {
            addToast(error instanceof Error ? error.message : t('usersAdmin.errors.resendInvite'), 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleViewAsUser = async (user: User) => {
        setLoading(true);
        try {
            await onViewAsUser(user.id);
            addToast(t('usersAdmin.toasts.viewingAs', { username: user.username }));
        } catch (error) {
            addToast(error instanceof Error ? error.message : t('usersAdmin.errors.viewAs'), 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleOpenUserModal = (user: User) => {
        setEditingUser(user);
        setUserModalOpen(true);
    };

    const handleCloseModal = () => {
        setUserModalOpen(false);
        setEditingUser(null);
    };

    const handleSaveUser = async (userToSave: User) => {
        setLoading(true);
        try {
            const payload: Record<string, unknown> = {
                expiryDate: userToSave.expiryDate,
                exemptFromCleanup: userToSave.exemptFromCleanup,
                optOutNewsletter: userToSave.optOutNewsletter,
                requestOverrides: userToSave.requestOverrides || {},
            };
            if (userToSave.libraryIds !== undefined) {
                payload.libraryIds = Array.isArray(userToSave.libraryIds) ? userToSave.libraryIds : [];
            }
            const updatedUser = await apiFetch(`/api/users/${userToSave.id}`, {
                method: 'PUT',
                body: JSON.stringify(payload),
            });
            setUsers(users.map(u => u.id === updatedUser.id ? updatedUser : u));
            handleCloseModal();
            if (updatedUser.warning) {
                addToast(updatedUser.warning, 'error');
            } else if (updatedUser.plexShareUpdated === false) {
                addToast(t('usersAdmin.toasts.savedLibraryWarning'), 'error');
            } else {
                addToast(t('usersAdmin.toasts.userUpdated'));
            }
            await fetchSecurityData();
        } catch (error) {
            addToast(error instanceof Error ? error.message : t('usersAdmin.errors.saveUser'), 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleDeleteUser = async (userId: string) => {
        appConfirm(t('usersAdmin.dialogs.deleteUser', { mediaServerLabel }), async () => {
            setLoading(true);
            try {
                await apiFetch(`/api/users/${userId}`, { method: 'DELETE' });
                setUsers(users.filter(u => u.id !== userId));
                addToast(t('usersAdmin.toasts.userRemoved'));
                await fetchSecurityData();
            } catch (error) {
                addToast(error instanceof Error ? error.message : t('usersAdmin.errors.deleteUser'), 'error');
            } finally {
                setLoading(false);
            }
        });
    };

    const handleToggleSelection = (userId: string) => {
        setSelectedUserIds(prev =>
            prev.includes(userId)
                ? prev.filter(id => id !== userId)
                : [...prev, userId]
        );
    };

    const handleBulkUpdate = async (action: 'addMonth' | 'addYear' | 'unlimited' | 'custom', customDate?: string) => {
        if (action === 'custom' && !customDate) {
            addToast(t('usersAdmin.errors.selectCustomDate'), 'error');
            return;
        }
        const message = action === 'addMonth'
            ? t('usersAdmin.dialogs.bulkAddMonth', { count: selectedUserIds.length })
            : action === 'addYear'
                ? t('usersAdmin.dialogs.bulkAddYear', { count: selectedUserIds.length })
                : action === 'unlimited'
                    ? t('usersAdmin.dialogs.bulkUnlimited', { count: selectedUserIds.length })
                    : t('usersAdmin.dialogs.bulkCustom', { count: selectedUserIds.length, date: customDate || '' });
        const ok = await askConfirm(message, {
            title: t('usersAdmin.dialogs.bulkExpiryTitle'),
            confirmLabel: t('usersAdmin.dialogs.bulkExpiryConfirm'),
            cancelLabel: t('common.cancel'),
            danger: action === 'unlimited',
        });
        if (!ok) return;
        setLoading(true);
        try {
            await apiFetch('/api/users/bulk-update', {
                method: 'POST',
                body: JSON.stringify({ userIds: selectedUserIds, action, customDate })
            });
            addToast(t('usersAdmin.toasts.bulkUpdated', { count: selectedUserIds.length }));
            setSelectedUserIds([]);
            setBulkCustomDate('');
            setBulkLibrariesOpen(false);
            await fetchUsers();
            await fetchSecurityData();
        } catch (error) {
            addToast(error instanceof Error ? error.message : t('usersAdmin.errors.bulkUpdate'), 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleBulkFlags = async (patch: { exemptFromCleanup?: boolean; optOutNewsletter?: boolean }) => {
        const count = selectedUserIds.length;
        const message = patch.exemptFromCleanup === true
            ? t('usersAdmin.dialogs.bulkExempt', { count })
            : patch.exemptFromCleanup === false
                ? t('usersAdmin.dialogs.bulkIncludeCleanup', { count })
                : patch.optOutNewsletter === true
                    ? t('usersAdmin.dialogs.bulkNewsletterOff', { count })
                    : t('usersAdmin.dialogs.bulkNewsletterOn', { count });
        const ok = await askConfirm(message, {
            title: t('usersAdmin.dialogs.flagsTitle'),
            confirmLabel: t('usersAdmin.dialogs.bulkExpiryConfirm'),
            cancelLabel: t('common.cancel'),
        });
        if (!ok) return;
        setLoading(true);
        try {
            const result = await apiFetch('/api/users/bulk-flags', {
                method: 'POST',
                body: JSON.stringify({ userIds: selectedUserIds, ...patch }),
            });
            addToast(result.message || t('usersAdmin.toasts.flagsUpdated', { count }));
            setSelectedUserIds([]);
            setBulkLibrariesOpen(false);
            await fetchUsers();
        } catch (error) {
            addToast(error instanceof Error ? error.message : t('usersAdmin.errors.bulkFlags'), 'error');
        } finally {
            setLoading(false);
        }
    };

    const openBulkLibraries = async () => {
        setBulkLibrariesOpen(true);
        if (bulkLibraries.length > 0) {
            if (bulkSelectedLibraries.length === 0) {
                setBulkSelectedLibraries(bulkLibraries.map((l) => l.id));
            }
            return;
        }
        setBulkLibrariesLoading(true);
        try {
            const libs = await apiFetch('/api/plex/libraries');
            const list = Array.isArray(libs) ? libs : [];
            const mapped = list.map((l: any) => ({ id: String(l.id), title: l.title || `Library ${l.id}` }));
            setBulkLibraries(mapped);
            setBulkSelectedLibraries(mapped.map((l) => l.id));
        } catch (error) {
            addToast(error instanceof Error ? error.message : t('usersAdmin.errors.loadLibraries'), 'error');
            setBulkLibrariesOpen(false);
        } finally {
            setBulkLibrariesLoading(false);
        }
    };

    const handleBulkLibraries = () => {
        const count = selectedUserIds.length;
        const allIds = bulkLibraries.map((l) => l.id);
        const allSelected =
            allIds.length > 0 &&
            bulkSelectedLibraries.length >= allIds.length &&
            allIds.every((id) => bulkSelectedLibraries.includes(id));
        const libraryIds = allSelected || bulkSelectedLibraries.length === 0 ? [] : bulkSelectedLibraries;
        const label = libraryIds.length === 0
            ? t('usersAdmin.dialogs.shareAllLibraries', { count })
            : t('usersAdmin.dialogs.shareSelectedLibraries', { libraries: libraryIds.length, count });
        appConfirm(`${label} ${t('usersAdmin.dialogs.livePlexAccess')}`, async () => {
            setLoading(true);
            try {
                const result = await apiFetch('/api/users/bulk-libraries', {
                    method: 'POST',
                    body: JSON.stringify({
                        userIds: selectedUserIds,
                        libraryIds,
                    }),
                });
                const failed = Number(result?.plexFailedCount) || 0;
                if (failed > 0) {
                    addToast(`${result.message || t('usersAdmin.toasts.saved')} ${t('usersAdmin.toasts.plexShareFailures', { count: failed })}`, 'error');
                } else {
                    addToast(result.message || t('usersAdmin.toasts.librariesUpdated', { count }));
                }
                setSelectedUserIds([]);
                setBulkSelectedLibraries([]);
                setBulkLibrariesOpen(false);
                await fetchUsers();
                await fetchSecurityData();
            } catch (error) {
            addToast(error instanceof Error ? error.message : t('usersAdmin.errors.bulkLibraryUpdate'), 'error');
            } finally {
                setLoading(false);
            }
        });
    };

    const handleUnblockDeletedUser = async (deletedUser: DeletedUser) => {
        const label = deletedUser.username || deletedUser.email || 'this user';
        appConfirm(`Allow ${label} to use the portal again? This does not invite them automatically.`, async () => {
            setLoading(true);
            try {
                await apiFetch(`/api/deleted-users/${encodeURIComponent(deletedUser.blockId)}`, { method: 'DELETE' });
                addToast('Deleted user unblocked.');
                await fetchSecurityData();
            } catch (error) {
                addToast(error instanceof Error ? error.message : 'Failed to unblock user.', 'error');
            } finally {
                setLoading(false);
            }
        });
    };

    // Derived State for Filtering and Sorting
    const filteredAndSortedUsers = useMemo(() => {
        return users
            .filter(user => {
                const query = searchQuery.toLowerCase().trim();
                if (query) {
                    const matchesName = user.username.toLowerCase().includes(query);
                    const matchesEmail = user.email?.toLowerCase().includes(query) || false;
                    if (!matchesName && !matchesEmail) return false;
                }

                if (statusFilter === 'all') {
                    // continue to extra filters
                } else {
                    const days = getDaysUntilExpiry(user.expiryDate);
                    const isRevoked = user.plexAccessStatus === 'revoked' && !(user.isServerOwner || user.isAdmin);
                    const isTrial = user.isTrial === true;
                    const isPending = user.plexAccessStatus === 'pending' && !(user.isServerOwner || user.isAdmin);

                    if (statusFilter === 'trial') {
                        if (!isTrial) return false;
                    } else if (statusFilter === 'revoked') {
                        if (!isRevoked) return false;
                    } else if (statusFilter === 'pending') {
                        if (!isPending) return false;
                    } else {
                        if (isRevoked) return false;
                        if (statusFilter === 'active' && !(days === null || days > 30)) return false;
                        if (statusFilter === 'expiring' && !(days !== null && days >= 0 && days <= 30)) return false;
                        if (statusFilter === 'expired' && !(days !== null && days < 0)) return false;
                    }
                }

                if (extraFilters.includes('noEmail') && String(user.email || '').trim()) return false;
                if (extraFilters.includes('neverLoggedIn') && user.lastLogin) return false;
                if (extraFilters.includes('exempt') && !user.exemptFromCleanup) return false;
                if (extraFilters.includes('newsletterOff') && !user.optOutNewsletter) return false;

                return true;
            })
            .sort((a, b) => {
                if (sortBy === 'username-asc') {
                    return a.username.localeCompare(b.username);
                }
                if (sortBy === 'username-desc') {
                    return b.username.localeCompare(a.username);
                }
                if (sortBy === 'joined-desc') {
                    return new Date(b.joiningDate).getTime() - new Date(a.joiningDate).getTime();
                }
                if (sortBy === 'lastLogin-desc' || sortBy === 'lastLogin-asc') {
                    const aMs = a.lastLogin ? new Date(a.lastLogin).getTime() : 0;
                    const bMs = b.lastLogin ? new Date(b.lastLogin).getTime() : 0;
                    return sortBy === 'lastLogin-desc' ? bMs - aMs : aMs - bMs;
                }
                if (sortBy === 'expiry-asc') {
                    if (a.expiryDate === null) return 1;
                    if (b.expiryDate === null) return -1;
                    return new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime();
                }
                if (sortBy === 'expiry-desc') {
                    if (a.expiryDate === null) return 1;
                    if (b.expiryDate === null) return -1;
                    return new Date(b.expiryDate).getTime() - new Date(a.expiryDate).getTime();
                }
                return 0;
            });
    }, [users, searchQuery, statusFilter, extraFilters, sortBy]);

    const filteredUserIds = useMemo(() => filteredAndSortedUsers.map(u => u.id), [filteredAndSortedUsers]);
    const allFilteredSelected = filteredUserIds.length > 0 && filteredUserIds.every(id => selectedUserIds.includes(id));

    const userStats = useMemo(() => {
        let active = 0;
        let expiring = 0;
        let expired = 0;
        let trial = 0;
        let revoked = 0;
        for (const user of users) {
            if (user.plexAccessStatus === 'revoked' && !(user.isServerOwner || user.isAdmin)) {
                revoked += 1;
                continue;
            }
            if (user.isTrial) {
                trial += 1;
                continue;
            }
            const days = getDaysUntilExpiry(user.expiryDate);
            if (days !== null && days < 0) expired += 1;
            else if (days !== null && days <= 30) expiring += 1;
            else active += 1;
        }
        return { total: users.length, active, expiring, expired, trial, revoked };
    }, [users]);

    const [statsCollapsed, setStatsCollapsed] = usePersistedCollapsed(
        USERS_STATS_COLLAPSED_KEY,
        preferCollapsedOnNarrow(),
    );

    return (
        <DashboardPageShell>
            <Loader isLoading={isLoading} />
            <ToastContainer toasts={toasts} setToasts={setToasts} />

            <DashboardHero
                accent="plex"
                eyebrow={t('usersAdmin.page.eyebrow')}
                title={t('navigation.users')}
                description={isConfigured ? (
                    <>
                        {t('usersAdmin.page.summary', { total: userStats.total, active: userStats.active, shown: filteredAndSortedUsers.length })}
                    </>
                ) : (
                    <>{t('usersAdmin.page.configureHint')}</>
                )}
                icon={<Users className="h-3.5 w-3.5" />}
                secondaryBlob
                actions={isConfigured ? (
                    <div className="flex flex-wrap items-center gap-2">
                        <button
                            type="button"
                            className="inline-flex items-center justify-center gap-2 rounded-xl bg-plex px-4 py-2.5 text-sm font-bold text-background transition-colors hover:bg-plex-hover disabled:opacity-50"
                            onClick={handleImportUsers}
                            disabled={isLoading}
                        >
                            <RefreshCw className="h-4 w-4" />
                            {t('usersAdmin.actions.syncUsers', { mediaServerLabel })}
                        </button>
                        <button
                            type="button"
                            className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-black/20 px-4 py-2.5 text-sm font-bold text-text transition-colors hover:bg-white/5 disabled:opacity-50"
                            onClick={handleBackfillJoiningDates}
                            disabled={isLoading}
                            title={t('usersAdmin.actions.backfillTitle')}
                        >
                            <Calendar className="h-4 w-4" />
                            {t('usersAdmin.actions.backfillJoinDates')}
                        </button>
                    </div>
                ) : undefined}
            />

            <main>
                {isConfigured && <ExtensionRequestsAdmin addToast={addToast} onChanged={fetchUsers} />}
                {isConfigured && (
                    <section className="mb-6">
                        <div className={`${statsCollapsed ? '' : 'mb-3'} flex items-center justify-between gap-3`}>
                            <button
                                type="button"
                                className="flex min-w-0 flex-1 items-center gap-2 text-left"
                                onClick={() => setStatsCollapsed(!statsCollapsed)}
                                aria-expanded={!statsCollapsed}
                                aria-label={statsCollapsed ? t('usersAdmin.stats.expand') : t('usersAdmin.stats.collapse')}
                            >
                                <span className="w-3 shrink-0 text-muted" aria-hidden>{statsCollapsed ? '▸' : '▾'}</span>
                                <h2 className="w-full border-b border-white/10 pb-2 text-sm font-bold uppercase tracking-[2px] text-plex">
                                    {t('usersAdmin.stats.title')}
                                </h2>
                            </button>
                            {statsCollapsed ? (
                                <span className="shrink-0 text-xs font-semibold text-muted">
                                    {t('usersAdmin.stats.summary', { total: userStats.total, active: userStats.active })}
                                </span>
                            ) : null}
                        </div>
                        {statsCollapsed ? null : (
                            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6 xl:gap-4">
                                <DashboardStatCard
                                    label={t('usersAdmin.stats.total')}
                                    value={userStats.total}
                                    icon={<Users className="h-4 w-4 text-plex" />}
                                    glow={dashboardGlowClass('plex')}
                                />
                                <DashboardStatCard
                                    label={t('usersAdmin.stats.active')}
                                    value={userStats.active}
                                    icon={<CheckCircle className="h-4 w-4 text-emerald-300" />}
                                    glow={dashboardGlowClass('emerald')}
                                    valueClassName="text-status-active"
                                />
                                <DashboardStatCard
                                    label={t('usersAdmin.stats.expiring')}
                                    value={userStats.expiring}
                                    icon={<AlertTriangle className="h-4 w-4 text-amber-300" />}
                                    glow={dashboardGlowClass('amber')}
                                    valueClassName="text-status-expiring"
                                />
                                <DashboardStatCard
                                    label={t('usersAdmin.stats.expired')}
                                    value={userStats.expired}
                                    icon={<AlertCircle className="h-4 w-4 text-rose-300" />}
                                    glow={dashboardGlowClass('rose')}
                                    valueClassName="text-status-expired"
                                />
                                <DashboardStatCard
                                    label={t('usersAdmin.stats.trial')}
                                    value={userStats.trial}
                                    icon={<Sparkles className="h-4 w-4 text-violet-300" />}
                                    glow={dashboardGlowClass('violet')}
                                />
                                <DashboardStatCard
                                    label={t('usersAdmin.stats.revoked')}
                                    value={userStats.revoked}
                                    icon={<Shield className="h-4 w-4 text-muted" />}
                                    glow={dashboardGlowClass('muted')}
                                />
                            </div>
                        )}
                    </section>
                )}

                {isConfigured && (
                    <DashboardPanel
                        title={t('usersAdmin.filters.title')}
                        subtitle={t('usersAdmin.filters.subtitle')}
                        className="mb-6"
                        controls={(
                            <CustomSelect
                                id="sortSelect"
                                value={sortBy}
                                onChange={(val) => setSortBy(val as any)}
                                className="w-full sm:w-[200px]"
                                options={[
                                    { label: t('usersAdmin.filters.usernameAsc'), value: 'username-asc' },
                                    { label: t('usersAdmin.filters.usernameDesc'), value: 'username-desc' },
                                    { label: t('usersAdmin.filters.expiryAsc'), value: 'expiry-asc' },
                                    { label: t('usersAdmin.filters.expiryDesc'), value: 'expiry-desc' },
                                    { label: t('usersAdmin.filters.joinedDesc'), value: 'joined-desc' },
                                    { label: t('usersAdmin.filters.lastLoginDesc'), value: 'lastLogin-desc' },
                                    { label: t('usersAdmin.filters.lastLoginAsc'), value: 'lastLogin-asc' },
                                ]}
                            />
                        )}
                    >
                        <div className="flex flex-col gap-4">
                            <div className="relative w-full">
                                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                                <input
                                    type="text"
                                    inputMode="search"
                                    enterKeyHint="search"
                                    autoComplete="off"
                                    autoCorrect="off"
                                    autoCapitalize="none"
                                    spellCheck={false}
                                    placeholder={t('usersAdmin.filters.searchPlaceholder')}
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="w-full appearance-none rounded-xl border border-white/10 bg-black/20 py-3 pr-10 pl-10 text-[16px] leading-5 text-text outline-none transition focus:border-plex/40 focus:ring-1 focus:ring-plex/20"
                                    style={{ fontSize: 16 }}
                                />
                                {searchQuery && (
                                    <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-text text-xl" onClick={() => setSearchQuery('')}>×</button>
                                )}
                            </div>

                            <div className="flex flex-wrap gap-1 rounded-xl border border-white/10 bg-black/20 p-1">
                                {(['all', 'active', 'trial', 'expiring', 'expired', 'revoked', 'pending'] as const).map((status) => (
                                    <button
                                        key={status}
                                        type="button"
                                        title={status === 'all' ? t('usersAdmin.filters.subtitle') : t(`usersAdmin.statusHints.${status}` as any)}
                                        className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors border-none outline-none cursor-pointer sm:text-sm ${dashboardSubnavLinkClass(statusFilter === status)}`}
                                        onClick={() => setStatusFilter(status)}
                                    >
                                        {status === 'all' ? t('usersAdmin.filters.all') : t(`usersAdmin.status.${status}` as any)}
                                    </button>
                                ))}
                            </div>
                            <div>
                                <p className="text-[10px] uppercase tracking-wider font-bold text-muted mb-1.5">{t('usersAdmin.filters.extraTitle')}</p>
                                <div className="flex flex-wrap gap-1 rounded-xl border border-white/10 bg-black/20 p-1">
                                    {(['noEmail', 'neverLoggedIn', 'exempt', 'newsletterOff'] as const).map((key) => {
                                        const selected = extraFilters.includes(key);
                                        return (
                                            <button
                                                key={key}
                                                type="button"
                                                title={t(`usersAdmin.filters.extraHints.${key}` as any)}
                                                className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors border-none outline-none cursor-pointer sm:text-sm ${dashboardSubnavLinkClass(selected)}`}
                                                onClick={() => setExtraFilters((prev) => (
                                                    prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]
                                                ))}
                                            >
                                                {t(`usersAdmin.filters.${key}` as any)}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                            {(statusFilter !== 'all' || extraFilters.length > 0) && (
                                <p className="text-xs text-muted leading-relaxed">
                                    {statusFilter !== 'all' ? t(`usersAdmin.statusHints.${statusFilter}` as any) : t('usersAdmin.filters.subtitle')}
                                </p>
                            )}
                        </div>
                    </DashboardPanel>
                )}

                {selectedUserIds.length > 0 && (
                    <DashboardPanel
                        title={t('usersAdmin.bulk.title')}
                        subtitle={t('usersAdmin.bulk.selectedSummary', { count: selectedUserIds.length })}
                        className="mb-6"
                        badge={(
                            <span className="rounded-full border border-plex/30 bg-plex/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-plex">
                                {t('usersAdmin.bulk.selected', { count: selectedUserIds.length })}
                            </span>
                        )}
                    >
                        <div className="space-y-4">
                            <div className="flex flex-wrap items-center gap-4 text-sm font-medium">
                                {allFilteredSelected ? (
                                    <button type="button" className="text-muted underline transition-colors hover:text-text" onClick={() => setSelectedUserIds(prev => prev.filter(id => !filteredUserIds.includes(id)))}>{t('usersAdmin.bulk.unselectFiltered')}</button>
                                ) : (
                                    <button type="button" className="text-muted underline transition-colors hover:text-text" onClick={() => setSelectedUserIds(prev => Array.from(new Set([...prev, ...filteredUserIds])))}>{t('usersAdmin.bulk.selectFiltered', { count: filteredAndSortedUsers.length })}</button>
                                )}
                                {selectedUserIds.length < users.length && (
                                    <button type="button" className="text-muted underline transition-colors hover:text-text" onClick={() => setSelectedUserIds(users.map(user => user.id))}>{t('usersAdmin.bulk.selectAll', { count: users.length })}</button>
                                )}
                                <button type="button" className="text-muted underline transition-colors hover:text-text" onClick={() => { setSelectedUserIds([]); setBulkLibrariesOpen(false); }}>{t('usersAdmin.bulk.unselectAll')}</button>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                                <button type="button" className="rounded-xl border border-white/10 bg-black/20 px-4 py-2 text-sm font-medium text-text transition-colors hover:bg-white/5" onClick={() => handleBulkUpdate('addMonth')}>{t('usersAdmin.bulk.addMonth')}</button>
                                <button type="button" className="rounded-xl border border-white/10 bg-black/20 px-4 py-2 text-sm font-medium text-text transition-colors hover:bg-white/5" onClick={() => handleBulkUpdate('addYear')}>{t('usersAdmin.bulk.addYear')}</button>
                                <button type="button" className="rounded-xl border border-white/10 bg-black/20 px-4 py-2 text-sm font-medium text-text transition-colors hover:bg-white/5" onClick={() => handleBulkUpdate('unlimited')}>{t('usersAdmin.modal.unlimited')}</button>
                                <div className="flex items-center gap-2">
                                    <input
                                        type="date"
                                        value={bulkCustomDate}
                                        onChange={(e) => setBulkCustomDate(e.target.value)}
                                        className="cursor-pointer rounded-xl border border-white/10 bg-black/20 p-2 text-sm text-text outline-none focus:border-plex/40"
                                    />
                                    <button
                                        type="button"
                                        className="rounded-xl bg-plex px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-plex-hover"
                                        onClick={() => {
                                            if (!bulkCustomDate) {
                                                addToast(t('usersAdmin.errors.selectCustomDate'), 'error');
                                                return;
                                            }
                                            handleBulkUpdate('custom', bulkCustomDate);
                                        }}
                                    >
                                        {t('usersAdmin.bulk.setCustomDate')}
                                    </button>
                                </div>
                                <button
                                    type="button"
                                    className={`rounded-xl px-4 py-2 text-sm font-medium transition-colors ${bulkLibrariesOpen ? 'bg-plex text-background' : 'border border-white/10 bg-black/20 text-text hover:bg-white/5'}`}
                                    onClick={() => {
                                        if (bulkLibrariesOpen) setBulkLibrariesOpen(false);
                                        else openBulkLibraries();
                                    }}
                                >
                                    {t('usersAdmin.bulk.libraries')}
                                </button>
                                <button
                                    type="button"
                                    className="rounded-xl border border-white/10 bg-black/20 px-4 py-2 text-sm font-medium text-text transition-colors hover:bg-white/5 inline-flex items-center gap-2"
                                    onClick={() => {
                                        setEmailUserIds(selectedUserIds);
                                        setEmailModalOpen(true);
                                    }}
                                >
                                    <Mail className="w-4 h-4" />
                                    {t('usersAdmin.bulk.emailSelected')}
                                </button>
                                <button type="button" className="rounded-xl border border-white/10 bg-black/20 px-4 py-2 text-sm font-medium text-text transition-colors hover:bg-white/5" onClick={() => handleBulkFlags({ exemptFromCleanup: true })}>{t('usersAdmin.bulk.exemptCleanup')}</button>
                                <button type="button" className="rounded-xl border border-white/10 bg-black/20 px-4 py-2 text-sm font-medium text-text transition-colors hover:bg-white/5" onClick={() => handleBulkFlags({ exemptFromCleanup: false })}>{t('usersAdmin.bulk.includeCleanup')}</button>
                                <button type="button" className="rounded-xl border border-white/10 bg-black/20 px-4 py-2 text-sm font-medium text-text transition-colors hover:bg-white/5" onClick={() => handleBulkFlags({ optOutNewsletter: true })}>{t('usersAdmin.bulk.newsletterOff')}</button>
                                <button type="button" className="rounded-xl border border-white/10 bg-black/20 px-4 py-2 text-sm font-medium text-text transition-colors hover:bg-white/5" onClick={() => handleBulkFlags({ optOutNewsletter: false })}>{t('usersAdmin.bulk.newsletterOn')}</button>
                            </div>
                            {bulkLibrariesOpen && (
                                <div className="border-t border-white/10 pt-4">
                                    <p className="mb-3 text-xs text-muted">
                                        {t('usersAdmin.bulk.libraryHint', { count: selectedUserIds.length })}
                                    </p>
                                    {bulkLibrariesLoading ? (
                                        <div className="py-2 text-sm text-muted">{t('usersAdmin.modal.loadingLibraries')}</div>
                                    ) : bulkLibraries.length === 0 ? (
                                        <div className="py-2 text-sm text-muted">{t('usersAdmin.modal.noLibraries')}</div>
                                    ) : (
                                        <div className="mb-3 flex flex-wrap gap-2">
                                            {bulkLibraries.map((lib) => (
                                                <label key={lib.id} className="flex cursor-pointer items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-3 py-2 transition-colors hover:border-plex/30">
                                                    <input
                                                        type="checkbox"
                                                        checked={bulkSelectedLibraries.includes(lib.id)}
                                                        onChange={(e) => {
                                                            if (e.target.checked) setBulkSelectedLibraries([...bulkSelectedLibraries, lib.id]);
                                                            else setBulkSelectedLibraries(bulkSelectedLibraries.filter((id) => id !== lib.id));
                                                        }}
                                                        className="accent-plex"
                                                    />
                                                    <span className="text-sm font-medium">{lib.title}</span>
                                                </label>
                                            ))}
                                        </div>
                                    )}
                                    <div className="flex flex-wrap items-center gap-2">
                                        <button
                                            type="button"
                                            className="rounded-xl bg-plex px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-plex-hover disabled:opacity-50"
                                            disabled={bulkLibrariesLoading || bulkLibraries.length === 0}
                                            onClick={handleBulkLibraries}
                                        >
                                            {t('usersAdmin.bulk.applyLibraries')}
                                        </button>
                                        <button
                                            type="button"
                                            className="rounded-xl border border-white/10 bg-black/20 px-4 py-2 text-sm font-medium text-text transition-colors hover:bg-white/5"
                                            onClick={() => setBulkSelectedLibraries(bulkLibraries.map((l) => l.id))}
                                        >
                                            {t('usersAdmin.bulk.selectAllPlain')}
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </DashboardPanel>
                )}

                {isConfigured && filteredAndSortedUsers.length === 0 && !isLoading && (
                    <DashboardPanel title={t('usersAdmin.empty.title')} subtitle={t('usersAdmin.empty.subtitle')}>
                        <p className="text-center text-sm text-muted">{t('usersAdmin.empty.body')}</p>
                    </DashboardPanel>
                )}

                {isConfigured && filteredAndSortedUsers.length > 0 && (
                    <DashboardPanel
                        title={t('usersAdmin.page.portalUsers')}
                        subtitle={t('usersAdmin.page.showing', { shown: filteredAndSortedUsers.length, total: users.length })}
                        className="mb-6"
                    >
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                            {filteredAndSortedUsers.map((user) => (
                                <UserCard
                                    key={user.id}
                                    user={user}
                                    onEdit={() => handleOpenUserModal(user)}
                                    onDelete={() => handleDeleteUser(user.id)}
                                    onRevoke={() => revokePlexAccess(user)}
                                    onViewAs={() => handleViewAsUser(user)}
                                    onViewAnalytics={() => {
                                        window.location.assign(portalUrl(`/analytics#user=${encodeURIComponent(user.username)}`));
                                    }}
                                    onViewProfile={onViewProfile ? () => onViewProfile(String(user.id || user.plexAccountId || user.username)) : undefined}
                                    isConfigured={isConfigured}
                                    isSelected={selectedUserIds.includes(user.id)}
                                    onSelect={handleToggleSelection}
                                    onEmail={user.email ? () => {
                                        setEmailUserIds([user.id]);
                                        setEmailModalOpen(true);
                                    } : undefined}
                                    onResendInvite={user.plexAccessStatus === 'pending' && !(user.isServerOwner || user.isAdmin)
                                        ? () => resendUserInvite(user)
                                        : undefined}
                                    onCopied={(message) => addToast(message)}
                                    providerLabel={mediaServerLabel}
                                />
                            ))}
                        </div>
                    </DashboardPanel>
                )}
            </main>
            <UserModal
                isOpen={isUserModalOpen}
                onClose={handleCloseModal}
                onSave={handleSaveUser}
                user={editingUser}
            />
            <EmailSelectedUsersModal
                open={emailModalOpen}
                onClose={() => setEmailModalOpen(false)}
                users={users}
                selectedUserIds={emailUserIds}
            />
        </DashboardPageShell>
    );
};
