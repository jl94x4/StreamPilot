import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Film, Loader2, Music, Tv, X } from 'lucide-react';
import { apiFetch } from '../shared/api';
import { formatDateTime } from '../shared/format';
import { CustomSelect, StyledCheckbox } from '../shared/ui';
import { RequestMetaChips } from './RequestMetaChips';
import { portalRequestArrSegment, portalRequestTypeLabelKey } from './requestFilterUtils';
import type {
    PortalRequestDetail,
    PortalRequestOverrides,
    PortalRequestUser,
    PortalServiceOptions,
    PortalServiceServer,
} from './types';
import { useDiscoverI18n } from '../discovery/i18n';
import { goToProfile, profileKeyForRequester } from '../profile/helpers';
import { formatRootFolderLabel } from '../../lib/portal-request/rootFolderLabel.js';
import { resolveAnimeAwareRootFolder } from '../../lib/portal-request/animeMedia.js';

type Props = {
    requestId: number;
    initialTitle?: string;
    mode?: 'approve' | 'edit';
    onClose: () => void;
    onComplete: (message: string) => void;
    onError: (message: string) => void;
};

const formatBytes = (bytes: number | null | undefined, freeLabel: string) => {
    const n = Number(bytes);
    if (!Number.isFinite(n) || n <= 0) return '';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    const i = Math.min(sizes.length - 1, Math.max(0, Math.floor(Math.log(n) / Math.log(k))));
    return `${parseFloat((n / Math.pow(k, i)).toFixed(1))} ${sizes[i]} ${freeLabel}`;
};

const seasonStatusLabel = (status: number | null | undefined, selected: boolean, t: ReturnType<typeof useDiscoverI18n>['t']) => {
    if (!selected) return t('requestsAdmin.modal.notSelected');
    if (status === 1) return t('requestsAdmin.filters.pending');
    if (status === 2) return t('requestsAdmin.filters.approved');
    if (status === 3) return t('requestsAdmin.filters.declined');
    return t('requestsAdmin.modal.notRequested');
};

/** Match Request As dropdown value to the real requester (id / plexId / email / name). */
const resolveRequestAsUserId = (
    users: PortalRequestUser[],
    requestedBy?: PortalRequestDetail['requestedBy'] | null,
): string | null => {
    if (!requestedBy) return null;
    const id = requestedBy.id != null ? String(requestedBy.id) : '';
    const email = String(requestedBy.email || '').trim().toLowerCase();
    const name = String(requestedBy.displayName || '').trim().toLowerCase();
    const plexId = String((requestedBy as any)?.plexId || '').trim();
    const username = String((requestedBy as any)?.username || '').trim().toLowerCase();

    const hit = users.find((user) => {
        const uid = String(user.id);
        const uPlex = String((user as any).plexId || '');
        const uEmail = String(user.email || '').trim().toLowerCase();
        const uName = String(user.displayName || '').trim().toLowerCase();
        const uUser = String((user as any).username || '').trim().toLowerCase();
        if (id && (uid === id || uPlex === id)) return true;
        if (plexId && (uid === plexId || uPlex === plexId)) return true;
        if (email && uEmail && uEmail === email) return true;
        if (username && (uUser === username || uName === username)) return true;
        if (name && (uName === name || uUser === name)) return true;
        return false;
    });
    return hit ? String(hit.id) : (id || null);
};

export const RequestApprovalModal: React.FC<Props> = ({
    requestId,
    initialTitle,
    mode = 'approve',
    onClose,
    onComplete,
    onError,
}) => {
    const { t } = useDiscoverI18n();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [detail, setDetail] = useState<PortalRequestDetail | null>(null);
    const [servers, setServers] = useState<PortalServiceServer[]>([]);
    const [serviceOptions, setServiceOptions] = useState<PortalServiceOptions | null>(null);
    const [users, setUsers] = useState<PortalRequestUser[]>([]);
    const [optionsLoading, setOptionsLoading] = useState(false);

    const [serverId, setServerId] = useState<number | null>(null);
    const [profileId, setProfileId] = useState<number | null>(null);
    const [rootFolder, setRootFolder] = useState('');
    const [userId, setUserId] = useState<string | null>(null);
    const [selectedTags, setSelectedTags] = useState<number[]>([]);
    const [selectedSeasons, setSelectedSeasons] = useState<number[]>([]);

    const onErrorRef = useRef(onError);
    const onCompleteRef = useRef(onComplete);
    useEffect(() => { onErrorRef.current = onError; }, [onError]);
    useEffect(() => { onCompleteRef.current = onComplete; }, [onComplete]);

    const loadServiceOptions = useCallback(async (type: 'movie' | 'tv' | 'music', nextServerId: number) => {
        setOptionsLoading(true);
        try {
            const segment = portalRequestArrSegment(type);
            const data = await apiFetch(`/api/requests/services/${segment}/${nextServerId}`);
            setServiceOptions(data);
        } catch (e: any) {
            onErrorRef.current(e?.message || t('requestsAdmin.errors.loadServiceOptions'));
            setServiceOptions(null);
        } finally {
            setOptionsLoading(false);
        }
    }, [t]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            setLoading(true);
            try {
                const [requestData, usersData] = await Promise.all([
                    apiFetch(`/api/requests/${requestId}`),
                    apiFetch('/api/requests/users').catch(() => ({ users: [] })),
                ]);
                if (cancelled) return;

                const nextDetail = requestData as PortalRequestDetail;
                setDetail(nextDetail);
                const usersList: PortalRequestUser[] = Array.isArray(usersData?.users) ? usersData.users : [];
                setUsers(usersList);

                const segment = portalRequestArrSegment(nextDetail.type);
                const serversData = await apiFetch(`/api/requests/services/${segment}`);
                if (cancelled) return;

                const allServers: PortalServiceServer[] = Array.isArray(serversData?.servers) ? serversData.servers : [];
                const filtered = allServers.filter((s) => s.is4k === nextDetail.is4k);
                // Portal *arr instances are not HD/4K-split; fall back so approve still works.
                const serversForRequest = filtered.length ? filtered : allServers;
                setServers(serversForRequest);

                const initialServerId = nextDetail.serverId
                    ?? serversForRequest.find((s) => s.isDefault)?.id
                    ?? serversForRequest[0]?.id
                    ?? null;
                let nextServerId = initialServerId;
                let nextProfileId = nextDetail.profileId ?? null;
                let nextRootFolder = nextDetail.rootFolder || '';
                let nextTags = Array.isArray(nextDetail.tags) ? nextDetail.tags : [];
                const resolvedUserId = resolveRequestAsUserId(usersList, nextDetail.requestedBy);

                if (nextDetail.tmdbId) {
                    try {
                        const defaults = await apiFetch('/api/requests/override-defaults', {
                            method: 'POST',
                            body: JSON.stringify({
                                mediaType: nextDetail.type,
                                tmdbId: nextDetail.tmdbId,
                                userId: resolvedUserId ?? nextDetail.requestedBy?.id,
                                is4k: nextDetail.is4k,
                            }),
                        });
                        if (defaults?.serverId != null && nextDetail.serverId == null) nextServerId = defaults.serverId;
                        if (defaults?.profileId != null && nextDetail.profileId == null) nextProfileId = defaults.profileId;
                        if (defaults?.rootFolder && !nextDetail.rootFolder) nextRootFolder = defaults.rootFolder;
                        if (Array.isArray(defaults?.tags) && (!nextDetail.tags || nextDetail.tags.length === 0)) {
                            nextTags = defaults.tags;
                        }
                    } catch {
                        // Override rules unavailable on older Seerr builds
                    }
                }

                setServerId(nextServerId);
                setProfileId(nextProfileId);
                setRootFolder(nextRootFolder);
                setSelectedTags(nextTags);
                setUserId(resolvedUserId);
                setSelectedSeasons(
                    nextDetail.type === 'tv'
                        ? (nextDetail.seasons || []).map((s) => s.seasonNumber)
                        : []
                );
            } catch (e: any) {
                if (!cancelled) onErrorRef.current(e?.message || t('requestsAdmin.errors.loadRequest'));
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [requestId, t]);

    useEffect(() => {
        if (!detail || serverId == null) return;
        loadServiceOptions(detail.type, serverId);
    }, [serverId, detail?.id, detail?.type, loadServiceOptions]);

    useEffect(() => {
        if (!serviceOptions || !detail) return;
        if (profileId == null && serviceOptions.profiles.length) {
            const defaultProfile = detail.isAnime && serviceOptions.server.activeAnimeProfileId
                ? serviceOptions.server.activeAnimeProfileId
                : serviceOptions.server.activeProfileId;
            setProfileId(defaultProfile ?? serviceOptions.profiles[0]?.id ?? null);
        }
        if (!rootFolder && serviceOptions.rootFolders.length) {
            setRootFolder(resolveAnimeAwareRootFolder({
                isAnime: !!detail.isAnime,
                activeAnimeDirectory: serviceOptions.server.activeAnimeDirectory,
                activeDirectory: serviceOptions.server.activeDirectory,
                rootFolders: serviceOptions.rootFolders,
            }));
        }
    }, [serviceOptions, detail, profileId, rootFolder]);

    const tvSeasonRows = useMemo(() => {
        if (!detail || detail.type !== 'tv') return [];
        const catalog = detail.tvSeasons?.length
            ? detail.tvSeasons
            : (detail.seasons || []).map((s) => ({
                seasonNumber: s.seasonNumber,
                name: s.seasonNumber === 0 ? 'Specials' : `Season ${s.seasonNumber}`,
                episodeCount: 0,
            }));
        return catalog.map((season) => {
            const requestSeason = detail.seasons?.find((s) => s.seasonNumber === season.seasonNumber);
            return {
                ...season,
                requestStatus: requestSeason?.status ?? null,
                selected: selectedSeasons.includes(season.seasonNumber),
            };
        });
    }, [detail, selectedSeasons]);

    const overrides = useMemo((): PortalRequestOverrides => ({
        serverId: serverId ?? undefined,
        profileId: profileId ?? undefined,
        rootFolder: rootFolder || undefined,
        userId: userId ?? undefined,
        tags: selectedTags,
        seasons: detail?.type === 'tv' ? selectedSeasons : undefined,
    }), [serverId, profileId, rootFolder, userId, selectedTags, selectedSeasons, detail?.type]);

    const requestAsOptions = useMemo(() => {
        const opts = users.map((u) => ({
            value: String(u.id),
            label: u.email ? `${u.displayName} (${u.email})` : u.displayName,
        }));
        if (userId && !opts.some((o) => o.value === String(userId))) {
            const name = detail?.requestedBy?.displayName || `User ${userId}`;
            const email = detail?.requestedBy?.email;
            opts.unshift({
                value: String(userId),
                label: email ? `${name} (${email})` : name,
            });
        }
        return opts;
    }, [users, userId, detail?.requestedBy?.displayName, detail?.requestedBy?.email]);

    const toggleSeason = (seasonNumber: number) => {
        setSelectedSeasons((prev) => (
            prev.includes(seasonNumber)
                ? prev.filter((n) => n !== seasonNumber)
                : [...prev, seasonNumber].sort((a, b) => a - b)
        ));
    };

    const toggleTag = (tagId: number) => {
        setSelectedTags((prev) => (
            prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId]
        ));
    };

    const handleSave = async (andApprove: boolean) => {
        if (!detail) return;
        if (detail.type === 'tv' && selectedSeasons.length === 0) {
            onErrorRef.current(t('requestsAdmin.errors.selectSeason'));
            return;
        }
        setSaving(true);
        try {
            if (andApprove) {
                await apiFetch(`/api/requests/${requestId}/approve`, {
                    method: 'POST',
                    body: JSON.stringify({ title: detail.title, overrides }),
                });
                onCompleteRef.current(t('requestsAdmin.toasts.approvedTitle', { title: detail.title }));
            } else {
                await apiFetch(`/api/requests/${requestId}`, {
                    method: 'PUT',
                    body: JSON.stringify({ title: detail.title, overrides }),
                });
                onCompleteRef.current(t('requestsAdmin.toasts.updatedTitle', { title: detail.title }));
            }
            onClose();
        } catch (e: any) {
            onErrorRef.current(e?.message || (andApprove ? t('requestsAdmin.errors.approve') : t('requestsAdmin.errors.update')));
        } finally {
            setSaving(false);
        }
    };

    const title = detail?.title || initialTitle || 'Request';
    const TypeIcon = detail?.type === 'tv' ? Tv : detail?.type === 'music' ? Music : Film;

    return (
        <div
            className="fixed inset-0 z-[1200] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
            onClick={onClose}
        >
            <div
                className="w-full max-w-6xl max-h-[90vh] overflow-y-auto glass-card p-5 md:p-6 shadow-2xl border border-border custom-scrollbar"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-start justify-between gap-4 mb-4">
                    <div className="min-w-0">
                        <p className="text-muted text-xs uppercase tracking-widest font-semibold">
                            {mode === 'approve' ? t('requestsAdmin.modal.reviewApprove') : t('requestsAdmin.modal.editRequest')}
                        </p>
                        <h3 className="text-xl font-bold text-text truncate">{title}</h3>
                        {detail && (
                            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                                <span>{t('requestsAdmin.labels.status')}: <span className="text-text font-medium capitalize">{detail.statusLabel}</span></span>
                                <span>
                                    {t('requestsAdmin.labels.requestedBy')}{' '}
                                    <button
                                        type="button"
                                        className="text-text font-medium hover:text-plex hover:underline"
                                        onClick={() => goToProfile(undefined, profileKeyForRequester(detail.requestedBy))}
                                    >
                                        {detail.requestedBy.displayName}
                                    </button>
                                </span>
                                {detail.createdAt && (
                                    <span>{t('requestsAdmin.labels.created')} {formatDateTime(detail.createdAt)}</span>
                                )}
                                {detail.updatedAt && detail.updatedAt !== detail.createdAt && (
                                    <span>{t('requestsAdmin.labels.updated')} {formatDateTime(detail.updatedAt)}</span>
                                )}
                                {detail.modifiedBy && (
                                    <span>{t('requestsAdmin.labels.lastActionBy')} {detail.modifiedBy.displayName}</span>
                                )}
                                {detail.declineReason && (
                                    <span className="text-red-200">{t('requestsAdmin.labels.reason')}: {detail.declineReason}</span>
                                )}
                            </div>
                        )}
                        {detail?.requestedBy?.displayName && (
                            <p className="text-sm text-muted mt-1">
                                {t('requestsAdmin.labels.requestedBy')}{' '}
                                <button
                                    type="button"
                                    className="text-text font-medium hover:text-plex hover:underline"
                                    onClick={() => goToProfile(undefined, profileKeyForRequester(detail.requestedBy))}
                                >
                                    {detail.requestedBy.displayName}
                                </button>
                                {' · '}{t(portalRequestTypeLabelKey(detail.type))}
                                {detail.is4k ? ' · 4K' : ''}
                                {detail.isAnime ? ' · Anime' : ''}
                            </p>
                        )}
                        {detail && (
                            <RequestMetaChips
                                genres={detail.genres}
                                originalLanguage={detail.originalLanguage}
                                className="mt-2"
                            />
                        )}
                    </div>
                    <button type="button" onClick={onClose} className="p-2 rounded-lg text-muted hover:text-text hover:bg-white/5">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {loading ? (
                    <div className="flex items-center gap-3 py-16 justify-center text-muted">
                        <Loader2 className="w-5 h-5 animate-spin text-plex" />
                        {t('requestsAdmin.modal.loadingDetails')}
                    </div>
                ) : !detail ? (
                    <p className="text-sm text-red-200 py-8 text-center">{t('requestsAdmin.modal.loadFailed')}</p>
                ) : (
                    <>
                        <div className="flex gap-4 mb-5">
                            <div className="w-24 aspect-[2/3] rounded-lg overflow-hidden bg-card border border-border/50 shrink-0">
                                {detail.posterUrl ? (
                                    <img src={detail.posterUrl} alt="" className="w-full h-full object-cover" />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center text-muted">
                                        <TypeIcon className="w-8 h-8 opacity-40" />
                                    </div>
                                )}
                            </div>
                            {detail.overview && (
                                <p className="text-sm text-muted line-clamp-5 leading-relaxed">{detail.overview}</p>
                            )}
                        </div>

                        {detail.type === 'tv' && tvSeasonRows.length > 0 && (
                            <div className="mb-5">
                                <p className="text-sm font-semibold text-text mb-2">{t('requestsAdmin.modal.seasons')}</p>
                                <div className="rounded-xl border border-border/60 overflow-hidden">
                                    <table className="w-full text-sm">
                                        <thead className="bg-background/60 text-muted text-xs uppercase tracking-wider">
                                            <tr>
                                                <th className="px-3 py-2 text-left w-12">{t('requestsAdmin.modal.on')}</th>
                                                <th className="px-3 py-2 text-left">{t('requestsAdmin.modal.season')}</th>
                                                <th className="px-3 py-2 text-right">{t('requestsAdmin.modal.episodes')}</th>
                                                <th className="px-3 py-2 text-right">{t('requestsAdmin.labels.status')}</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {tvSeasonRows.map((row) => (
                                                <tr key={row.seasonNumber} className="border-t border-border/40">
                                                    <td className="px-3 py-2">
                                                        <StyledCheckbox
                                                            checked={row.selected}
                                                            onChange={() => toggleSeason(row.seasonNumber)}
                                                            label=""
                                                        />
                                                    </td>
                                                    <td className="px-3 py-2 text-text font-medium">{row.name}</td>
                                                    <td className="px-3 py-2 text-right text-muted">{row.episodeCount || '—'}</td>
                                                    <td className="px-3 py-2 text-right">
                                                        <span className="text-xs font-semibold text-muted">
                                                            {seasonStatusLabel(row.requestStatus, row.selected, t)}
                                                        </span>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}
                        {detail.type === 'tv' && tvSeasonRows.length === 0 && (
                            <p className="mb-5 text-sm text-amber-200/90">
                                {t('requestsAdmin.modal.noSeasonList')}
                            </p>
                        )}

                        <div className="mb-4">
                            <p className="text-sm font-semibold text-text mb-3">{t('requestsAdmin.modal.advanced')}</p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                {servers.length > 1 && (
                                    <div>
                                        <label className="block text-xs font-semibold text-muted mb-1.5">{t('requestsAdmin.modal.destinationServer')}</label>
                                        <CustomSelect
                                            value={String(serverId ?? '')}
                                            onChange={(val) => {
                                                setServerId(Number(val));
                                                setProfileId(null);
                                                setRootFolder('');
                                                setLanguageProfileId(null);
                                                setSelectedTags([]);
                                            }}
                                            options={servers.map((s) => ({
                                                value: String(s.id),
                                                label: s.isDefault ? `${s.name} (Default)` : s.name,
                                            }))}
                                        />
                                    </div>
                                )}
                                {(serviceOptions?.profiles || []).length !== 1 && (
                                <div>
                                    <label className="block text-xs font-semibold text-muted mb-1.5">{t('requestsAdmin.modal.qualityProfile')}</label>
                                    <CustomSelect
                                        value={String(profileId ?? '')}
                                        onChange={(val) => setProfileId(Number(val))}
                                        options={(serviceOptions?.profiles || []).map((p) => ({
                                            value: String(p.id),
                                            label: p.name,
                                        }))}
                                    />
                                </div>
                                )}
                                {(serviceOptions?.rootFolders || []).length !== 1 && (
                                <div className="sm:col-span-2">
                                    <label className="block text-xs font-semibold text-muted mb-1.5">{t('requestsAdmin.modal.rootFolder')}</label>
                                    <CustomSelect
                                        value={rootFolder}
                                        onChange={setRootFolder}
                                        options={(serviceOptions?.rootFolders || []).map((f) => ({
                                            value: f.path,
                                            label: formatRootFolderLabel(f, {
                                                folders: serviceOptions?.rootFolders || [],
                                                freeText: formatBytes(f.freeSpace, t('requestsAdmin.modal.free')),
                                            }),
                                        }))}
                                    />
                                </div>
                                )}
                                {requestAsOptions.length > 1 && (
                                    <div className="sm:col-span-2">
                                        <label className="block text-xs font-semibold text-muted mb-1.5">{t('requestsAdmin.modal.requestAs')}</label>
                                        <CustomSelect
                                            value={String(userId ?? '')}
                                            onChange={(val) => setUserId(String(val))}
                                            options={requestAsOptions}
                                        />
                                    </div>
                                )}
                            </div>

                            {(serviceOptions?.tags?.length ?? 0) > 0 && (
                                <div className="mt-3">
                                    <label className="block text-xs font-semibold text-muted mb-2">{t('requestsAdmin.modal.tags')}</label>
                                    <div className="flex flex-wrap gap-2">
                                        {serviceOptions!.tags.map((tag) => {
                                            const active = selectedTags.includes(tag.id);
                                            return (
                                                <button
                                                    key={tag.id}
                                                    type="button"
                                                    onClick={() => toggleTag(tag.id)}
                                                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                                                        active
                                                            ? 'bg-plex/15 border-plex/40 text-plex'
                                                            : 'bg-background/50 border-border text-muted hover:text-text'
                                                    }`}
                                                >
                                                    {tag.label}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            {optionsLoading && (
                                <p className="text-xs text-muted mt-2 flex items-center gap-2">
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> {t('requestsAdmin.modal.loadingOptions')}
                                </p>
                            )}
                        </div>

                        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2 border-t border-border/40">
                            <button
                                type="button"
                                onClick={onClose}
                                disabled={saving}
                                className="px-4 py-2.5 rounded-lg border border-border text-muted hover:text-text transition-colors disabled:opacity-50"
                            >
                                {t('common.cancel')}
                            </button>
                            <button
                                type="button"
                                onClick={() => handleSave(false)}
                                disabled={saving}
                                className="px-4 py-2.5 rounded-lg border border-white/10 text-text font-semibold hover:bg-white/5 transition-colors disabled:opacity-50"
                            >
                                {t('requestsAdmin.modal.saveChanges')}
                            </button>
                            <button
                                type="button"
                                onClick={() => handleSave(true)}
                                disabled={saving}
                                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-plex text-background font-bold hover:bg-plex-hover transition-colors disabled:opacity-50"
                            >
                                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                                {t('requestsAdmin.modal.saveApprove')}
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};
