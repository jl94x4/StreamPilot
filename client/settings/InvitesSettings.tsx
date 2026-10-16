import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Copy } from 'lucide-react';
import { apiFetch } from '../shared/api';
import { getPublicOrigin } from '../shared/basePath';
import { appConfirm } from '../shared/confirm';
import { CustomSelect, SettingsToggleRow } from '../shared/ui';
import { getSettingsSectionElementId } from './settingsIndex';
import { SettingHint } from './SettingHint';
import { useDiscoverI18n } from '../discovery/i18n';
import { OnboardingSettingsSection } from './OnboardingSettingsSection';

type InviteProfile = {
    id: string;
    name: string;
    durationDays: number;
    maxUses: number | 'unlimited';
    libraryIds: string[] | null;
    emailNote?: string;
};

type InviteProfilesDocument = {
    profiles: InviteProfile[];
    defaultProfileId: string | null;
};

const CUSTOM_PROFILE_VALUE = '';

const newLocalProfileId = () => (
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `invite-profile-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
);

export const InvitesSettings: React.FC<{
    addToast: (msg: string, type: 'success' | 'error') => void;
    publicDomain?: string;
    referralEnabled: boolean;
    setReferralEnabled: (value: boolean) => void;
    referralTrialDays: number;
    setReferralTrialDays: (value: number) => void;
    referralRewardDays: number;
    setReferralRewardDays: (value: number) => void;
}> = ({
    addToast,
    publicDomain = '',
    referralEnabled,
    setReferralEnabled,
    referralTrialDays,
    setReferralTrialDays,
    referralRewardDays,
    setReferralRewardDays,
}) => {
    const { t } = useDiscoverI18n();
    const inviteBaseUrl = useMemo(() => {
        const configured = String(publicDomain || '').trim().replace(/\/+$/, '');
        return configured || getPublicOrigin();
    }, [publicDomain]);
    const inviteUrlFor = useCallback((code: string) => `${inviteBaseUrl}/invite/${code}`, [inviteBaseUrl]);
    const [invites, setInvites] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [durationDays, setDurationDays] = useState(30);
    const [maxUses, setMaxUses] = useState<string | number>(1);
    const [emailInvite, setEmailInvite] = useState('');
    const [emailNote, setEmailNote] = useState('');
    const [emailing, setEmailing] = useState(false);
    const [libraries, setLibraries] = useState<any[]>([]);
    const [selectedLibraries, setSelectedLibraries] = useState<string[]>([]);
    const [profilesDoc, setProfilesDoc] = useState<InviteProfilesDocument>({ profiles: [], defaultProfileId: null });
    const [selectedProfileId, setSelectedProfileId] = useState(CUSTOM_PROFILE_VALUE);
    const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
    const [profileNameDraft, setProfileNameDraft] = useState('');
    const [savingProfiles, setSavingProfiles] = useState(false);
    const appliedDefaultRef = useRef(false);
    const [referralRewards, setReferralRewards] = useState<any[]>([]);
    const [referralHistoryLoading, setReferralHistoryLoading] = useState(false);
    const [referralHistoryStatus, setReferralHistoryStatus] = useState<'all' | 'granted' | 'blocked'>('all');
    const [referralHistoryQuery, setReferralHistoryQuery] = useState('');

    const allLibraryIds = useMemo(() => libraries.map((l) => String(l.id)), [libraries]);

    const resolveLibrarySelection = useCallback((libraryIds: string[] | null | undefined) => {
        if (!libraryIds || libraryIds.length === 0) return allLibraryIds;
        const selected = libraryIds.map(String).filter((id) => allLibraryIds.includes(id));
        return selected.length > 0 ? selected : allLibraryIds;
    }, [allLibraryIds]);

    const applyProfile = useCallback((profile: InviteProfile, { toast = false }: { toast?: boolean } = {}) => {
        setSelectedProfileId(profile.id);
        setDurationDays(profile.durationDays);
        setMaxUses(profile.maxUses);
        setSelectedLibraries(resolveLibrarySelection(profile.libraryIds));
        setEmailNote(profile.emailNote || '');
        if (toast) addToast(t('settings.invites.profileApplied', { name: profile.name }), 'success');
    }, [addToast, resolveLibrarySelection, t]);

    const markCustom = useCallback(() => {
        setSelectedProfileId(CUSTOM_PROFILE_VALUE);
    }, []);

    const persistProfiles = useCallback(async (next: InviteProfilesDocument, successKey: string) => {
        setSavingProfiles(true);
        try {
            const saved = await apiFetch('/api/invite-profiles', {
                method: 'PUT',
                body: JSON.stringify(next),
            }) as InviteProfilesDocument;
            setProfilesDoc(saved);
            addToast(t(successKey), 'success');
            return saved;
        } catch (e: any) {
            addToast(e.message || t('settings.invites.profileSaveFailed'), 'error');
            return null;
        } finally {
            setSavingProfiles(false);
        }
    }, [addToast, t]);

    const fetchInvites = useCallback(async () => {
        try {
            const [data, libData, profilesRaw] = await Promise.all([
                apiFetch('/api/invites'),
                apiFetch('/api/plex/libraries').catch(() => []),
                apiFetch('/api/invite-profiles').catch(() => null),
            ]);
            setInvites(data);
            const libs = libData || [];
            setLibraries(libs);
            setSelectedLibraries((prev) => {
                if (prev.length > 0) {
                    const libIds = new Set(libs.map((l: any) => String(l.id)));
                    const kept = prev.filter((id) => libIds.has(id));
                    return kept.length > 0 ? kept : libs.map((l: any) => String(l.id));
                }
                return libs.map((l: any) => String(l.id));
            });

            if (profilesRaw && typeof profilesRaw === 'object') {
                const doc = profilesRaw as InviteProfilesDocument;
                setProfilesDoc({
                    profiles: Array.isArray(doc.profiles) ? doc.profiles : [],
                    defaultProfileId: doc.defaultProfileId || null,
                });
            }
        } catch (e) {
            addToast(t('settings.invites.loadFailed'), 'error');
        } finally {
            setLoading(false);
        }
    }, [addToast, t]);

    useEffect(() => { fetchInvites(); }, [fetchInvites]);

    const fetchReferralHistory = useCallback(async () => {
        setReferralHistoryLoading(true);
        try {
            const params = new URLSearchParams({ limit: '200' });
            if (referralHistoryStatus !== 'all') params.set('status', referralHistoryStatus);
            if (referralHistoryQuery.trim()) params.set('q', referralHistoryQuery.trim());
            const data = await apiFetch(`/api/referral-rewards?${params.toString()}`);
            setReferralRewards(Array.isArray(data?.rewards) ? data.rewards : []);
        } catch (e: any) {
            addToast(e.message || t('settings.invites.referralHistoryLoadFailed'), 'error');
        } finally {
            setReferralHistoryLoading(false);
        }
    }, [addToast, referralHistoryQuery, referralHistoryStatus, t]);

    useEffect(() => {
        fetchReferralHistory();
    }, [fetchReferralHistory]);

    useEffect(() => {
        if (loading || appliedDefaultRef.current || libraries.length === 0) return;
        const defaultId = profilesDoc.defaultProfileId;
        if (!defaultId) {
            appliedDefaultRef.current = true;
            return;
        }
        const profile = profilesDoc.profiles.find((p) => p.id === defaultId);
        if (profile) applyProfile(profile);
        appliedDefaultRef.current = true;
    }, [loading, libraries.length, profilesDoc, applyProfile]);

    const profileSelectOptions = useMemo(() => ([
        { value: CUSTOM_PROFILE_VALUE, label: t('settings.invites.profileCustom') },
        ...profilesDoc.profiles.map((p) => ({
            value: p.id,
            label: p.id === profilesDoc.defaultProfileId
                ? `${p.name} (${t('settings.invites.profileDefaultBadge')})`
                : p.name,
        })),
    ]), [profilesDoc, t]);

    const formatProfileUses = useCallback((uses: number | 'unlimited') => (
        uses === 'unlimited'
            ? t('settings.invites.profileUsesUnlimited')
            : t('settings.invites.profileUsesCount', { count: Number(uses) || 1 })
    ), [t]);

    const formatProfileLibraries = useCallback((libraryIds: string[] | null) => {
        if (!libraryIds || libraryIds.length === 0) return t('settings.invites.profileLibrariesAll');
        return t('settings.invites.profileLibrariesCount', { count: libraryIds.length });
    }, [t]);

    const handleProfileSelect = (value: string) => {
        if (!value) {
            markCustom();
            return;
        }
        const profile = profilesDoc.profiles.find((p) => p.id === value);
        if (profile) applyProfile(profile);
    };

    const handleCreate = async () => {
        try {
            const allIds = libraries.map((l) => String(l.id));
            const allSelected = allIds.length > 0 && allIds.every((id) => selectedLibraries.includes(id));
            const libraryIds = allSelected || selectedLibraries.length === 0 ? [] : selectedLibraries;
            await apiFetch('/api/invites', {
                method: 'POST',
                body: JSON.stringify({ durationDays, maxUses, libraryIds })
            });
            addToast(t('settings.invites.createSuccess'), 'success');
            fetchInvites();
        } catch (e: any) {
            addToast(e.message || t('settings.invites.createFailed'), 'error');
        }
    };

    const handleEmailInvite = async () => {
        if (!emailInvite) return addToast(t('settings.invites.emailRequired'), 'error');
        setEmailing(true);
        try {
            const allIds = libraries.map((l) => String(l.id));
            const allSelected = allIds.length > 0 && allIds.every((id) => selectedLibraries.includes(id));
            const libraryIds = allSelected || selectedLibraries.length === 0 ? [] : selectedLibraries;
            await apiFetch('/api/invites/email', {
                method: 'POST',
                body: JSON.stringify({ email: emailInvite, durationDays, libraryIds, note: emailNote.trim() || undefined })
            });
            addToast(t('settings.invites.emailSent'), 'success');
            setEmailInvite('');
            setEmailNote('');
            fetchInvites();
        } catch (e: any) {
            addToast(e.message || t('settings.invites.emailFailed'), 'error');
        } finally {
            setEmailing(false);
        }
    };

    const handleDelete = async (code: string) => {
        appConfirm(t('settings.invites.deleteConfirm'), async () => {
            try {
                await apiFetch(`/api/invites/${code}`, { method: 'DELETE' });
                addToast(t('settings.invites.deleteSuccess'), 'success');
                fetchInvites();
            } catch (e: any) {
                addToast(e.message || t('settings.invites.deleteFailed'), 'error');
            }
        });
    };

    const handleCopy = (code: string) => {
        navigator.clipboard.writeText(inviteUrlFor(code));
        addToast(t('settings.invites.copySuccess'), 'success');
    };

    const buildProfileFromForm = (id: string, name: string): InviteProfile => {
        const allSelected = allLibraryIds.length > 0 && allLibraryIds.every((lid) => selectedLibraries.includes(lid));
        return {
            id,
            name,
            durationDays: Number(durationDays) || 30,
            maxUses: String(maxUses).trim().toLowerCase() === 'unlimited'
                ? 'unlimited'
                : (parseInt(String(maxUses), 10) || 1),
            libraryIds: allSelected || selectedLibraries.length === 0 ? null : selectedLibraries.map(String),
            emailNote: emailNote.trim() || undefined,
        };
    };

    const handleSaveProfile = async () => {
        const name = profileNameDraft.trim();
        if (!name) return addToast(t('settings.invites.profileNameRequired'), 'error');

        if (editingProfileId) {
            const id = editingProfileId;
            const nextProfiles = profilesDoc.profiles.map((p) => (
                p.id === id ? buildProfileFromForm(p.id, name) : p
            ));
            const saved = await persistProfiles(
                { profiles: nextProfiles, defaultProfileId: profilesDoc.defaultProfileId },
                'settings.invites.profileUpdated',
            );
            if (saved) {
                setEditingProfileId(null);
                setProfileNameDraft('');
                setSelectedProfileId(id);
            }
            return;
        }

        const id = newLocalProfileId();
        const profile = buildProfileFromForm(id, name);
        const saved = await persistProfiles(
            { profiles: [...profilesDoc.profiles, profile], defaultProfileId: profilesDoc.defaultProfileId },
            'settings.invites.profileSaved',
        );
        if (saved) {
            setProfileNameDraft('');
            setSelectedProfileId(id);
        }
    };

    const startEditProfile = (profile: InviteProfile) => {
        applyProfile(profile);
        setEditingProfileId(profile.id);
        setProfileNameDraft(profile.name);
    };

    const cancelEditProfile = () => {
        setEditingProfileId(null);
        setProfileNameDraft('');
    };

    const handleDuplicateProfile = async (profile: InviteProfile) => {
        const copy: InviteProfile = {
            ...profile,
            id: newLocalProfileId(),
            name: `${profile.name} (copy)`,
            libraryIds: profile.libraryIds ? [...profile.libraryIds] : null,
        };
        const saved = await persistProfiles(
            { profiles: [...profilesDoc.profiles, copy], defaultProfileId: profilesDoc.defaultProfileId },
            'settings.invites.profileSaved',
        );
        if (saved) setSelectedProfileId(copy.id);
    };

    const handleDeleteProfile = (profile: InviteProfile) => {
        appConfirm(t('settings.invites.profileDeleteConfirm', { name: profile.name }), async () => {
            const nextProfiles = profilesDoc.profiles.filter((p) => p.id !== profile.id);
            const nextDefault = profilesDoc.defaultProfileId === profile.id ? null : profilesDoc.defaultProfileId;
            const saved = await persistProfiles(
                { profiles: nextProfiles, defaultProfileId: nextDefault },
                'settings.invites.profileDeleted',
            );
            if (!saved) return;
            if (selectedProfileId === profile.id) markCustom();
            if (editingProfileId === profile.id) cancelEditProfile();
        });
    };

    const handleSetDefault = async (profileId: string | null) => {
        await persistProfiles(
            { profiles: profilesDoc.profiles, defaultProfileId: profileId },
            'settings.invites.profileDefaultSet',
        );
    };

    if (loading) return <div className="text-muted">{t('settings.invites.loading')}</div>;

    return (
        <div className="animate-fade-in mb-8 space-y-10">
            <section id={getSettingsSectionElementId('referral')} className="scroll-mt-24">
                <h3 className="text-xl font-bold text-plex mb-4 border-b border-border pb-2">{t('settings.invites.referralTitle')}</h3>
                <p className="text-sm text-muted mb-6">{t('settings.invites.referralDescription')}</p>
                <SettingsToggleRow
                    title={t('settings.invites.enableReferrals')}
                    hint={
                        <SettingHint>
                            {t('settings.invites.enableReferralsHint')}
                        </SettingHint>
                    }
                    checked={referralEnabled}
                    onChange={setReferralEnabled}
                    border={false}
                    className="mb-6"
                />
                <div className={`transition-all ${!referralEnabled ? 'opacity-50 pointer-events-none' : ''}`}>
                    <div className="flex flex-col sm:flex-row gap-4">
                        <div className="flex-1">
                            <label className="block text-sm mb-1 font-medium">{t('settings.invites.referredUserTemporaryAccessDays')}</label>
                            <input type="number" min="0" className="w-full p-3 rounded-lg border border-border bg-background text-text outline-none focus:border-plex transition-all" value={referralTrialDays} onChange={e => setReferralTrialDays(Number(e.target.value))} />
                        </div>
                        <div className="flex-1">
                            <label className="block text-sm mb-1 font-medium">{t('settings.invites.referrerRewardDays')}</label>
                            <input type="number" min="0" className="w-full p-3 rounded-lg border border-border bg-background text-text outline-none focus:border-plex transition-all" value={referralRewardDays} onChange={e => setReferralRewardDays(Number(e.target.value))} />
                        </div>
                    </div>
                </div>
            </section>

            <section id={getSettingsSectionElementId('referral-history')} className="scroll-mt-24">
                <h3 className="text-xl font-bold text-plex mb-4 border-b border-border pb-2">{t('settings.invites.referralHistoryTitle')}</h3>
                <p className="text-sm text-muted mb-6">{t('settings.invites.referralHistoryDescription')}</p>
                <div className="flex flex-col md:flex-row gap-3 mb-4">
                    <input
                        type="search"
                        value={referralHistoryQuery}
                        onChange={(e) => setReferralHistoryQuery(e.target.value)}
                        placeholder={t('settings.invites.referralHistorySearch')}
                        className="flex-1 w-full p-2.5 rounded-lg bg-background border border-border text-text outline-none focus:border-plex"
                    />
                    <div className="w-full md:w-48">
                        <CustomSelect
                            value={referralHistoryStatus}
                            onChange={(value) => setReferralHistoryStatus((value as 'all' | 'granted' | 'blocked') || 'all')}
                            options={[
                                { value: 'all', label: t('settings.invites.referralHistoryFilterAll') },
                                { value: 'granted', label: t('settings.invites.referralHistoryFilterGranted') },
                                { value: 'blocked', label: t('settings.invites.referralHistoryFilterBlocked') },
                            ]}
                        />
                    </div>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse min-w-[720px]">
                        <thead>
                            <tr className="border-b border-border text-muted text-sm uppercase tracking-wider">
                                <th className="p-3">{t('settings.invites.referralHistoryDate')}</th>
                                <th className="p-3">{t('settings.invites.referralHistoryReferrer')}</th>
                                <th className="p-3">{t('settings.invites.referralHistoryReferred')}</th>
                                <th className="p-3">{t('settings.invites.referralHistoryReward')}</th>
                                <th className="p-3">{t('settings.invites.referralHistoryExpiry')}</th>
                                <th className="p-3">{t('settings.invites.referralHistoryStatus')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {referralHistoryLoading ? (
                                <tr><td colSpan={6} className="p-8 text-center text-muted">{t('settings.invites.loading')}</td></tr>
                            ) : referralRewards.length === 0 ? (
                                <tr><td colSpan={6} className="p-8 text-center text-muted">{t('settings.invites.referralHistoryEmpty')}</td></tr>
                            ) : referralRewards.map((entry) => {
                                const reasonKey = entry.blockReason === 'self_referral'
                                    ? 'settings.invites.referralHistoryReasonSelf'
                                    : entry.blockReason === 'duplicate'
                                        ? 'settings.invites.referralHistoryReasonDuplicate'
                                        : entry.blockReason === 'referrer_inactive'
                                            ? 'settings.invites.referralHistoryReasonInactive'
                                            : entry.blockReason === 'referrer_not_found'
                                                ? 'settings.invites.referralHistoryReasonMissing'
                                                : null;
                                const statusLabel = entry.status === 'granted'
                                    ? t('settings.invites.referralHistoryGranted')
                                    : (reasonKey
                                        ? t(reasonKey)
                                        : t('settings.invites.referralHistoryReasonOther', { reason: entry.blockReason || 'unknown' }));
                                const rewardLabel = entry.status === 'granted'
                                    ? (entry.rewardApplied
                                        ? t('settings.invites.referralHistoryDays', { count: entry.rewardDays })
                                        : t('settings.invites.referralHistoryUnlimitedReferrer'))
                                    : t('settings.invites.referralHistoryNoDays');
                                const expiryLabel = entry.previousExpiryDate || entry.newExpiryDate
                                    ? t('settings.invites.referralHistoryExpiryRange', {
                                        from: entry.previousExpiryDate ? new Date(entry.previousExpiryDate).toLocaleDateString() : t('settings.invites.referralHistoryNone'),
                                        to: entry.newExpiryDate ? new Date(entry.newExpiryDate).toLocaleDateString() : t('settings.invites.referralHistoryNone'),
                                    })
                                    : t('settings.invites.referralHistoryNone');
                                return (
                                    <tr key={entry.id} className="border-b border-border/50 hover:bg-white/5 transition-colors">
                                        <td className="p-3 text-sm text-muted">{new Date(entry.createdAt).toLocaleString()}</td>
                                        <td className="p-3 font-medium">{entry.referrer?.username || entry.referrer?.id || t('settings.invites.referralHistoryNone')}</td>
                                        <td className="p-3 font-medium">{entry.referred?.username || entry.referred?.id || t('settings.invites.referralHistoryNone')}</td>
                                        <td className="p-3 text-sm">{rewardLabel}</td>
                                        <td className="p-3 text-sm text-muted">{expiryLabel}</td>
                                        <td className="p-3">
                                            <span className={`text-xs font-bold px-2 py-1 rounded border ${entry.status === 'granted' ? 'text-plex bg-plex/10 border-plex/20' : 'text-red-400 bg-red-500/10 border-red-500/20'}`}>
                                                {entry.status === 'granted' ? t('settings.invites.referralHistoryGranted') : t('settings.invites.referralHistoryBlocked')}
                                            </span>
                                            {entry.status === 'blocked' && (
                                                <div className="text-[11px] text-muted mt-1">{statusLabel}</div>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </section>

            <OnboardingSettingsSection addToast={addToast} />

            <section id={getSettingsSectionElementId('invite-profiles')} className="scroll-mt-24">
                <h3 className="text-xl font-bold text-plex mb-4 border-b border-border pb-2">{t('settings.invites.profilesTitle')}</h3>
                <p className="text-sm text-muted mb-6">{t('settings.invites.profilesDescription')}</p>

                <div className="flex flex-col md:flex-row gap-3 items-end mb-6">
                    <div className="flex-1 w-full">
                        <label className="block text-sm mb-1 font-medium">{t('settings.invites.profileName')}</label>
                        <input
                            type="text"
                            maxLength={80}
                            placeholder={t('settings.invites.profileNamePlaceholder')}
                            className="w-full p-2.5 rounded-lg bg-background border border-border text-text outline-none focus:border-plex"
                            value={profileNameDraft}
                            onChange={(e) => setProfileNameDraft(e.target.value)}
                        />
                    </div>
                    <button
                        type="button"
                        disabled={savingProfiles}
                        className="w-full md:w-auto px-6 py-2.5 bg-plex text-background font-bold rounded-lg hover:bg-plex-hover transition-colors shadow-lg disabled:opacity-50"
                        onClick={handleSaveProfile}
                    >
                        {editingProfileId ? t('settings.invites.profileUpdate') : t('settings.invites.profileSaveAs')}
                    </button>
                    {editingProfileId && (
                        <button
                            type="button"
                            className="w-full md:w-auto px-4 py-2.5 border border-border rounded-lg text-sm font-medium hover:border-plex transition-colors"
                            onClick={cancelEditProfile}
                        >
                            {t('settings.invites.profileCancelEdit')}
                        </button>
                    )}
                </div>

                {profilesDoc.profiles.length === 0 ? (
                    <p className="text-sm text-muted">{t('settings.invites.profileEmpty')}</p>
                ) : (
                    <div className="space-y-3">
                        {profilesDoc.profiles.map((profile) => {
                            const isDefault = profilesDoc.defaultProfileId === profile.id;
                            return (
                                <div
                                    key={profile.id}
                                    className={`flex flex-col sm:flex-row sm:items-center gap-3 justify-between border border-border rounded-lg p-3 ${selectedProfileId === profile.id ? 'border-plex/60 bg-plex/5' : ''}`}
                                >
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <button
                                                type="button"
                                                className="font-semibold text-left hover:text-plex transition-colors"
                                                onClick={() => applyProfile(profile, { toast: true })}
                                            >
                                                {profile.name}
                                            </button>
                                            {isDefault && (
                                                <span className="text-[10px] uppercase tracking-wide text-plex bg-plex/10 border border-plex/20 px-1.5 py-0.5 rounded">
                                                    {t('settings.invites.profileDefaultBadge')}
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-xs text-muted mt-1">
                                            {t('settings.invites.profileSummary', {
                                                days: profile.durationDays,
                                                uses: formatProfileUses(profile.maxUses),
                                                libraries: formatProfileLibraries(profile.libraryIds),
                                            })}
                                        </p>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        <button type="button" className="text-xs font-medium border border-border px-2.5 py-1 rounded hover:border-plex transition-colors" onClick={() => startEditProfile(profile)}>
                                            {t('settings.invites.profileEdit')}
                                        </button>
                                        <button type="button" className="text-xs font-medium border border-border px-2.5 py-1 rounded hover:border-plex transition-colors" onClick={() => handleDuplicateProfile(profile)}>
                                            {t('settings.invites.profileDuplicate')}
                                        </button>
                                        <button
                                            type="button"
                                            className="text-xs font-medium border border-border px-2.5 py-1 rounded hover:border-plex transition-colors"
                                            onClick={() => handleSetDefault(isDefault ? null : profile.id)}
                                        >
                                            {isDefault ? t('settings.invites.profileClearDefault') : t('settings.invites.profileSetDefault')}
                                        </button>
                                        <button type="button" className="text-xs font-medium text-red-500 border border-red-500/30 px-2.5 py-1 rounded hover:bg-red-500/10 transition-colors" onClick={() => handleDeleteProfile(profile)}>
                                            {t('settings.invites.profileDelete')}
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </section>

            <section id={getSettingsSectionElementId('invite-links')} className="scroll-mt-24">
            <h3 className="text-xl font-bold text-plex mb-4 border-b border-border pb-2">{t('settings.invites.inviteLinksTitle')}</h3>
            <p className="text-sm text-muted mb-2">{t('settings.invites.inviteLinksDescription')}</p>
            <p className="text-sm text-muted mb-6">
                {publicDomain
                    ? t('settings.invites.publicBaseUrlConfigured', { url: inviteBaseUrl })
                    : t('settings.invites.publicBaseUrlBrowserOrigin')}
            </p>

            <div className="space-y-6 mb-8">
                <h4 className="font-bold">{t('settings.invites.createNewInviteLink')}</h4>
                {profilesDoc.profiles.length > 0 && (
                    <div className="mb-2 max-w-md">
                        <label className="block text-sm mb-1 font-medium">{t('settings.invites.profileSelector')}</label>
                        <CustomSelect
                            value={selectedProfileId}
                            onChange={handleProfileSelect}
                            options={profileSelectOptions}
                        />
                    </div>
                )}
                <div className="flex flex-col md:flex-row gap-4 items-end mb-6">
                    <div className="flex-1 w-full">
                        <label className="block text-sm mb-1 font-medium">{t('settings.invites.durationDays')}</label>
                        <input type="number" min="1" className="w-full p-2.5 rounded-lg bg-background border border-border text-text outline-none focus:border-plex" value={durationDays} onChange={e => { markCustom(); setDurationDays(Number(e.target.value)); }} />
                    </div>
                    <div className="flex-1 w-full">
                        <label className="block text-sm mb-1 font-medium">{t('settings.invites.maxUses')}</label>
                        <input type="text" className="w-full p-2.5 rounded-lg bg-background border border-border text-text outline-none focus:border-plex" value={maxUses} onChange={e => { markCustom(); setMaxUses(e.target.value); }} />
                    </div>
                    <button className="w-full md:w-auto px-6 py-2.5 bg-plex text-background font-bold rounded-lg hover:bg-plex-hover transition-colors shadow-lg" onClick={handleCreate}>{t('settings.invites.generateLink')}</button>
                </div>

                {libraries.length > 0 && (
                    <div className="mb-6">
                        <label className="block text-sm mb-2 font-medium">{t('settings.invites.librariesToShare')}</label>
                        <div className="flex flex-wrap gap-2">
                            {libraries.map(lib => (
                                <label key={lib.id} className="flex items-center gap-2 bg-background border border-border px-3 py-2 rounded-lg cursor-pointer hover:border-plex transition-colors">
                                    <input
                                        type="checkbox"
                                        checked={selectedLibraries.includes(String(lib.id))}
                                        onChange={(e) => {
                                            markCustom();
                                            const id = String(lib.id);
                                            if (e.target.checked) setSelectedLibraries([...selectedLibraries, id]);
                                            else setSelectedLibraries(selectedLibraries.filter(sid => sid !== id));
                                        }}
                                        className="accent-plex"
                                    />
                                    <span className="text-sm font-medium">{lib.title}</span>
                                </label>
                            ))}
                        </div>
                    </div>
                )}

                <div className="border-t border-border/50 pt-6">
                    <h4 className="font-bold mb-4">{t('settings.invites.directEmailInvite')}</h4>
                    <p className="text-sm text-muted mb-4">{t('settings.invites.directEmailInviteDescription')}</p>
                    <div className="flex flex-col md:flex-row gap-4 items-end">
                        <div className="flex-1 w-full">
                            <label className="block text-sm mb-1 font-medium">{t('settings.invites.emailAddress')}</label>
                            <input type="email" placeholder="user@example.com" className="w-full p-2.5 rounded-lg bg-background border border-border text-text outline-none focus:border-plex" value={emailInvite} onChange={e => setEmailInvite(e.target.value)} />
                        </div>
                        <button disabled={emailing} className="w-full md:w-auto px-6 py-2.5 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 transition-colors shadow-lg disabled:opacity-50" onClick={handleEmailInvite}>
                            {emailing ? t('settings.invites.sending') : t('settings.invites.sendEmailInvite')}
                        </button>
                    </div>
                    <div className="mt-4">
                        <label className="block text-sm mb-1 font-medium">{t('settings.invites.personalNote')}</label>
                        <p className="text-xs text-muted mb-2">{t('settings.invites.personalNoteHint')}</p>
                        <textarea
                            value={emailNote}
                            onChange={(e) => { markCustom(); setEmailNote(e.target.value); }}
                            maxLength={2000}
                            rows={4}
                            placeholder={t('settings.invites.personalNotePlaceholder')}
                            className="w-full p-2.5 rounded-lg bg-background border border-border text-text outline-none focus:border-plex resize-y"
                        />
                    </div>
                </div>
            </div>

            <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse min-w-[600px]">
                    <thead>
                        <tr className="border-b border-border text-muted text-sm uppercase tracking-wider">
                            <th className="p-3">{t('settings.invites.inviteLink')}</th>
                            <th className="p-3">{t('settings.invites.duration')}</th>
                            <th className="p-3">{t('settings.invites.uses')}</th>
                            <th className="p-3">{t('settings.invites.libraries')}</th>
                            <th className="p-3">{t('settings.invites.created')}</th>
                            <th className="p-3 text-right">{t('settings.invites.actions')}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {invites.length === 0 ? (
                            <tr><td colSpan={6} className="p-8 text-center text-muted">{t('settings.invites.empty')}</td></tr>
                        ) : invites.map(inv => (
                            <tr key={inv.code} className="border-b border-border/50 hover:bg-white/5 transition-colors">
                                <td className="p-3">
                                    <div className="flex items-center gap-2">
                                        <span className="font-mono text-sm text-plex select-all">{inviteUrlFor(inv.code)}</span>
                                        <button onClick={() => handleCopy(inv.code)} className="text-muted hover:text-plex transition-colors p-1" title={t('settings.invites.copyLink')}>
                                            <Copy size={16} />
                                        </button>
                                    </div>
                                </td>
                                <td className="p-3 font-medium">{t('settings.invites.durationDaysValue', { count: inv.durationDays })}</td>
                                <td className="p-3">
                                    <div className="font-medium">{inv.maxUses === 'unlimited' ? t('settings.invites.unlimited') : `${inv.currentUses} / ${inv.maxUses}`}</div>
                                    {inv.usedBy && inv.usedBy.length > 0 && (
                                        <div className="mt-1.5 flex flex-wrap gap-1 max-w-[200px]">
                                            {inv.usedBy.map((u: any, idx: number) => (
                                                <span key={idx} className="text-[10px] text-plex bg-plex/10 border border-plex/20 px-1.5 py-0.5 rounded shadow-sm" title={t('settings.invites.claimedBy', { date: new Date(u.date).toLocaleString(), email: u.email })}>
                                                    {u.username}
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                </td>
                                <td className="p-3 text-sm">
                                    {inv.libraryIds && inv.libraryIds.length > 0
                                        ? libraries.filter(l => inv.libraryIds.includes(l.id) || inv.libraryIds.includes(String(l.id))).map(l => l.title).join(', ') || t('settings.invites.selectedCount', { count: inv.libraryIds.length })
                                        : <span className="text-plex opacity-80">{t('settings.invites.allLibraries')}</span>}
                                </td>
                                <td className="p-3 text-muted text-sm">
                                    {new Date(inv.createdAt).toLocaleDateString()}
                                    {inv.sentTo && <div className="text-xs text-blue-400 mt-1">{t('settings.invites.sentTo', { email: inv.sentTo })}</div>}
                                </td>
                                <td className="p-3 text-right">
                                    <button onClick={() => handleDelete(inv.code)} className="text-red-500 hover:text-red-400 font-bold border border-red-500/30 px-3 py-1 rounded hover:bg-red-500/10 transition-colors text-xs">{t('settings.invites.revoke')}</button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            </section>
        </div>
    );
};
