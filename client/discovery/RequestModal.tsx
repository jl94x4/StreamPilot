import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bell, CheckCircle, ChevronDown, ChevronUp, Film, Loader2, Tv, X } from 'lucide-react';
import { apiFetch } from '../shared/api';
import { ModalPortal } from '../shared/ModalPortal';
import { NoPosterPlaceholder } from '../shared/NoPosterPlaceholder';
import { CustomSelect } from '../shared/ui';
import type { PortalServiceOptions } from '../requests/types';
import type { RequestOptionsPayload } from './requestSeasonUtils';
import {
    formatNotifyMeHint,
    formatQuotaHint,
    isMainSeasonNumber,
    seasonStatusBadgeClass,
} from './requestSeasonUtils';
import { resolveTmdbImageUrl } from './tmdbImageUrl';
import { translateDiscoverStatus, useDiscoverI18n } from './i18n';
import { mediaStatusChipClass } from './DiscoverStatusOverlay';
import { formatRootFolderLabel } from '../../lib/portal-request/rootFolderLabel.js';
import { resolveAnimeAwareRootFolder } from '../../lib/portal-request/animeMedia.js';

type Props = {
    open: boolean;
    mediaType: 'movie' | 'tv';
    mediaId: number;
    title?: string;
    /** Immediate header chrome from the parent so the modal paints before options load. */
    posterPath?: string | null;
    overview?: string | null;
    onClose: () => void;
    onSuccess: (message: string, meta?: { notify?: boolean }) => void;
    onError: (message: string) => void;
    onNotifyChange?: (watching: boolean) => void;
};

type QualityKey = 'hd' | '4k';

type QualityFormState = {
    serverId: number | null;
    profileId: number | null;
    rootFolder: string;
    selectedTags: number[];
    serviceOptions: PortalServiceOptions | null;
    loaded: boolean;
    loading: boolean;
};

const emptyQualityForm = (): QualityFormState => ({
    serverId: null,
    profileId: null,
    rootFolder: '',
    selectedTags: [],
    serviceOptions: null,
    loaded: false,
    loading: false,
});

const formatBytes = (bytes?: number | null, freeLabel = 'free') => {
    const n = Number(bytes);
    if (!Number.isFinite(n) || n <= 0) return '';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    const i = Math.min(sizes.length - 1, Math.max(0, Math.floor(Math.log(n) / Math.log(k))));
    return `${parseFloat((n / Math.pow(k, i)).toFixed(1))} ${sizes[i]} ${freeLabel}`;
};

const rootFolderLabel = (
    folder: { path: string; freeSpace?: number | null },
    folders: { path: string }[] = [],
    freeLabel = 'free',
) => formatRootFolderLabel(folder, {
    folders,
    freeText: formatBytes(folder.freeSpace, freeLabel),
});

const formatSeasonName = (
    name: string | undefined,
    seasonNumber: number,
    t: ReturnType<typeof useDiscoverI18n>['t'],
) => {
    const raw = String(name || '').trim();
    if (raw === 'Specials') return t('common.specials');
    const seasonMatch = raw.match(/^Season\s+(\d+)$/i);
    if (seasonMatch) return t('common.seasonN', { number: seasonMatch[1] });
    return raw || t('common.seasonN', { number: seasonNumber });
};

export const RequestModal: React.FC<Props> = ({
    open,
    mediaType,
    mediaId,
    title: fallbackTitle,
    posterPath: fallbackPosterPath,
    overview: fallbackOverview,
    onClose,
    onSuccess,
    onError,
    onNotifyChange,
}) => {
    const { t } = useDiscoverI18n();
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [options, setOptions] = useState<RequestOptionsPayload | null>(null);
    const [selectedQualities, setSelectedQualities] = useState<Set<QualityKey>>(() => new Set(['hd']));
    const [advancedQuality, setAdvancedQuality] = useState<QualityKey>('hd');
    const [selectedSeasons, setSelectedSeasons] = useState<number[]>([]);
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [qualityForms, setQualityForms] = useState<Record<QualityKey, QualityFormState>>({
        hd: emptyQualityForm(),
        '4k': emptyQualityForm(),
    });
    const [tagInput, setTagInput] = useState('');
    const [tagCreating, setTagCreating] = useState(false);
    const [tagSuggestionsOpen, setTagSuggestionsOpen] = useState(false);
    const loadGenRef = useRef(0);
    const advancedSectionRef = useRef<HTMLDivElement>(null);
    const scrollBodyRef = useRef<HTMLDivElement>(null);
    const onErrorRef = useRef(onError);
    const onSuccessRef = useRef(onSuccess);
    const onCloseRef = useRef(onClose);
    onErrorRef.current = onError;
    onSuccessRef.current = onSuccess;
    onCloseRef.current = onClose;

    const updateQualityForm = useCallback((quality: QualityKey, patch: Partial<QualityFormState>) => {
        setQualityForms((prev) => ({
            ...prev,
            [quality]: { ...prev[quality], ...patch },
        }));
    }, []);

    const applyServiceDefaults = useCallback((
        opts: RequestOptionsPayload,
        data: PortalServiceOptions,
        defaults?: Record<string, unknown> | null,
    ): Omit<QualityFormState, 'serviceOptions' | 'loaded' | 'loading'> => {
        const server: PortalServiceOptions['server'] = data.server;
        const profiles = Array.isArray(data.profiles) ? data.profiles : [];
        const folders = Array.isArray(data.rootFolders) ? data.rootFolders : [];
        const isAnime = !!opts.isAnime;

        let nextProfileId = defaults?.profileId != null ? Number(defaults.profileId) : Number.NaN;
        if (!Number.isFinite(nextProfileId)) {
            const activeProfile = isAnime && server.activeAnimeProfileId != null
                ? Number(server.activeAnimeProfileId)
                : (server.activeProfileId != null ? Number(server.activeProfileId) : Number.NaN);
            nextProfileId = Number.isFinite(activeProfile) ? activeProfile : (profiles[0]?.id ?? Number.NaN);
        }

        let nextRootFolder = defaults?.rootFolder ? String(defaults.rootFolder) : '';
        if (!nextRootFolder) {
            nextRootFolder = resolveAnimeAwareRootFolder({
                isAnime,
                activeAnimeDirectory: server.activeAnimeDirectory,
                activeDirectory: server.activeDirectory,
                rootFolders: folders,
            });
        }

        const nextTags = Array.isArray(defaults?.tags)
            ? defaults.tags.map((tag) => Number(tag)).filter((tag) => Number.isFinite(tag))
            : [];

        const nextServerId = defaults?.serverId != null
            ? Number(defaults.serverId)
            : Number(server.id);

        return {
            serverId: Number.isFinite(nextServerId) ? nextServerId : null,
            profileId: Number.isFinite(nextProfileId) ? nextProfileId : null,
            rootFolder: nextRootFolder,
            selectedTags: nextTags,
        };
    }, []);

    const loadServiceOptions = useCallback(async (
        opts: RequestOptionsPayload,
        quality: QualityKey,
        nextServerId: number,
        defaults?: Record<string, unknown> | null,
        { preserveSelections = false }: { preserveSelections?: boolean } = {},
    ) => {
        updateQualityForm(quality, { loading: true });
        try {
            // Prefer the modal prop — portal stubs once omitted mediaType and loaded Radarr folders for TV.
            const resolvedType = (opts.mediaType === 'tv' || opts.mediaType === 'movie')
                ? opts.mediaType
                : mediaType;
            const segment = resolvedType === 'tv' ? 'sonarr' : 'radarr';
            const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
            const timer = controller ? window.setTimeout(() => controller.abort(), 10000) : null;
            try {
                const data = await apiFetch(
                    `/api/discovery/request-services/${segment}/${nextServerId}`,
                    controller ? { signal: controller.signal } : {},
                ) as PortalServiceOptions;
                const applied = applyServiceDefaults({ ...opts, mediaType: resolvedType }, data, defaults);
                setQualityForms((prev) => {
                    const current = prev[quality];
                    return {
                        ...prev,
                        [quality]: {
                            serviceOptions: data,
                            loaded: true,
                            loading: false,
                            serverId: nextServerId,
                            profileId: preserveSelections && current.profileId != null
                                ? current.profileId
                                : applied.profileId,
                            rootFolder: preserveSelections && current.rootFolder
                                ? current.rootFolder
                                : applied.rootFolder,
                            selectedTags: preserveSelections
                                ? current.selectedTags
                                : applied.selectedTags,
                        },
                    };
                });
            } finally {
                if (timer) window.clearTimeout(timer);
            }
        } catch (e: any) {
            onErrorRef.current(e?.message || t('request.loadFailed'));
            updateQualityForm(quality, { serviceOptions: null, loading: false, loaded: false });
        }
    }, [applyServiceDefaults, mediaType, t, updateQualityForm]);

    const qualityFormsRef = useRef(qualityForms);
    qualityFormsRef.current = qualityForms;

    const loadAdvancedForQuality = useCallback(async (
        opts: RequestOptionsPayload,
        quality: QualityKey,
        { force = false }: { force?: boolean } = {},
    ) => {
        if (!opts.canRequestAdvanced) {
            updateQualityForm(quality, emptyQualityForm());
            return;
        }

        const is4k = quality === '4k';
        const servers = (opts.servers || []).filter((server) => !!server.is4k === is4k);
        if (!servers.length) {
            updateQualityForm(quality, { ...emptyQualityForm(), loaded: true });
            return;
        }

        const existing = qualityFormsRef.current[quality];
        if (!force && (existing.loaded || existing.loading)) return;

        updateQualityForm(quality, { loading: true });

        let nextServerId = servers.find((server) => server.isDefault)?.id ?? servers[0]?.id ?? null;
        let defaults: Record<string, unknown> | null = null;

        // Portal engine has no Seerr override rules — skip the Seerr round-trip (can hang minutes).
        if (opts.engine !== 'portal') {
            try {
                defaults = await apiFetch('/api/discovery/request-override-defaults', {
                    method: 'POST',
                    body: JSON.stringify({
                        mediaType: opts.mediaType || mediaType,
                        tmdbId: opts.tmdbId,
                        is4k,
                    }),
                });
                if (defaults?.serverId != null) {
                    const candidate = Number(defaults.serverId);
                    // Only accept override server when it matches this quality's HD/4K pool.
                    if (servers.some((server) => Number(server.id) === candidate)) {
                        nextServerId = candidate;
                    }
                }
            } catch {
                defaults = null;
            }
        }

        if (nextServerId != null) {
            await loadServiceOptions(opts, quality, nextServerId, defaults);
        } else {
            updateQualityForm(quality, { loading: false, loaded: true });
        }
    }, [loadServiceOptions, mediaType, updateQualityForm]);

    const loadOptions = useCallback(async () => {
        const gen = ++loadGenRef.current;
        setLoading(true);
        setQualityForms({ hd: emptyQualityForm(), '4k': emptyQualityForm() });
        setTagInput('');
        try {
            const data = await apiFetch(
                `/api/discovery/request-options?mediaType=${encodeURIComponent(mediaType)}&mediaId=${mediaId}`,
            );
            if (gen !== loadGenRef.current) return;
            if (data?.error) throw new Error(data.error);
            const payload = {
                ...(data as RequestOptionsPayload),
                mediaType: (data?.mediaType === 'tv' || data?.mediaType === 'movie')
                    ? data.mediaType
                    : mediaType,
            } as RequestOptionsPayload;
            setOptions(payload);

            const initial = new Set<QualityKey>();
            const hdInLibrary = !!payload.libraryQualities?.hd;
            const fourKInLibrary = !!payload.libraryQualities?.['4k'];
            const hdOk = payload.hasHdServer !== false
                && !hdInLibrary
                && !(payload.standardQuotaBlocked
                    || (payload.quota?.standard && payload.quota.standard.limit > 0 && payload.quota.standard.remaining === 0));
            const fourKOk = !!payload.canRequest4k
                && !!payload.has4kServer
                && !fourKInLibrary
                && !(payload.fourKQuotaBlocked
                    || (payload.quota?.fourK && payload.quota.fourK.limit > 0 && payload.quota.fourK.remaining === 0));
            if (hdOk) initial.add('hd');
            else if (fourKOk) initial.add('4k');
            else initial.add('hd');
            setSelectedQualities(initial);
            setAdvancedQuality(initial.has('hd') ? 'hd' : '4k');
            // Keep Advanced collapsed — Destination / profile / root stay optional.
            setShowAdvanced(false);

            if (payload.mediaType === 'tv' && Array.isArray(payload.seasons)) {
                // Match Seerr: never auto-select Specials (season 0) — user must opt in.
                setSelectedSeasons(
                    payload.seasons
                        .filter((s) => s.requestable && isMainSeasonNumber(Number(s.seasonNumber)))
                        .map((s) => Number(s.seasonNumber))
                        .filter((n) => Number.isFinite(n)),
                );
            } else {
                setSelectedSeasons([]);
            }

            // Paint seasons / canRequest immediately — *arr options load only when Advanced opens.
            if (gen === loadGenRef.current) setLoading(false);
        } catch (e: any) {
            if (gen !== loadGenRef.current) return;
            onErrorRef.current(e?.message || t('request.loadFailed'));
            setOptions(null);
            if (gen === loadGenRef.current) setLoading(false);
        }
    }, [mediaId, mediaType, t]);

    // Load *arr routing options only when the member opens Advanced.
    useEffect(() => {
        if (!open || !options?.canRequestAdvanced || !showAdvanced) return undefined;
        void loadAdvancedForQuality(options, advancedQuality);
        return undefined;
    }, [open, options, advancedQuality, showAdvanced, loadAdvancedForQuality]);

    // #170: after Advanced expands, scroll just enough that Root Folder isn't
    // clipped under the sticky submit bar. Prefer the section bottom so Destination
    // + Quality + Root are all reachable even when the block is taller than the sheet.
    const advancedForm = qualityForms[advancedQuality];
    useEffect(() => {
        if (!open || !showAdvanced) return undefined;
        if (advancedForm.loading && !advancedForm.loaded) return undefined;
        let cancelled = false;
        const reveal = () => {
            if (cancelled) return;
            const el = advancedSectionRef.current;
            const scroller = scrollBodyRef.current;
            if (!el || !scroller) return;
            const elRect = el.getBoundingClientRect();
            const scrollerRect = scroller.getBoundingClientRect();
            const pad = 12;
            if (elRect.bottom > scrollerRect.bottom - pad) {
                scroller.scrollTo({
                    top: scroller.scrollTop + (elRect.bottom - scrollerRect.bottom) + pad,
                    behavior: 'smooth',
                });
            } else if (elRect.top < scrollerRect.top + pad) {
                scroller.scrollTo({
                    top: Math.max(0, scroller.scrollTop + (elRect.top - scrollerRect.top) - pad),
                    behavior: 'smooth',
                });
            }
        };
        // Two frames: wait until Destination / Quality / Root have laid out.
        let frame2 = 0;
        const frame1 = window.requestAnimationFrame(() => {
            frame2 = window.requestAnimationFrame(reveal);
        });
        return () => {
            cancelled = true;
            window.cancelAnimationFrame(frame1);
            window.cancelAnimationFrame(frame2);
        };
    }, [open, showAdvanced, advancedQuality, advancedForm.loading, advancedForm.loaded]);

    useEffect(() => {
        if (!open) return undefined;
        loadOptions();
        return undefined;
    }, [open, loadOptions]);

    useEffect(() => {
        if (!open) return undefined;
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && !submitting) onCloseRef.current();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, submitting]);

    // Keep advancedQuality pointing at a selected quality
    useEffect(() => {
        if (!selectedQualities.has(advancedQuality)) {
            const next = selectedQualities.has('hd') ? 'hd' : (selectedQualities.has('4k') ? '4k' : 'hd');
            setAdvancedQuality(next);
        }
    }, [selectedQualities, advancedQuality]);

    const requestableSeasons = useMemo(
        () => (options?.seasons || []).filter((s) => s.requestable),
        [options?.seasons],
    );
    const requestableMainSeasons = useMemo(
        () => requestableSeasons.filter((s) => isMainSeasonNumber(Number(s.seasonNumber))),
        [requestableSeasons],
    );

    const hdQuotaBlocked = !!(
        options?.standardQuotaBlocked
        || (options?.quota?.standard && options.quota.standard.limit > 0 && options.quota.standard.remaining === 0)
    );
    const fourKQuotaBlocked = !!(
        options?.fourKQuotaBlocked
        || (options?.quota?.fourK && options.quota.fourK.limit > 0 && options.quota.fourK.remaining === 0)
    );

    const hdAllowed = !!options?.canRequest && !hdQuotaBlocked && options?.hasHdServer !== false
        && !options?.libraryQualities?.hd
        && !options?.requestedQualities?.hd;
    const fourKAllowed = !!options?.canRequest
        && !!options?.canRequest4k
        && !!options?.has4kServer
        && !fourKQuotaBlocked
        && !options?.libraryQualities?.['4k']
        && !options?.requestedQualities?.['4k'];

    const activeForm = qualityForms[advancedQuality];
    const filteredServers = useMemo(() => {
        const list = options?.servers || [];
        const want4k = advancedQuality === '4k';
        const matched = list.filter((server) => !!server.is4k === want4k);
        // When HD/UHD picker is active, keep destination lists quality-scoped.
        if (options?.has4kServer) return matched;
        // Fall back to full list if nothing is tagged for this quality (misconfigured is4k).
        return matched.length ? matched : list;
    }, [options?.servers, options?.has4kServer, advancedQuality]);

    const hdServerName = useMemo(
        () => (options?.servers || []).find((server) => !server.is4k)?.name
            || (mediaType === 'tv' ? 'Sonarr' : 'Radarr'),
        [options?.servers, mediaType],
    );
    const fourKServerName = useMemo(
        () => (options?.servers || []).find((server) => !!server.is4k)?.name
            || `${mediaType === 'tv' ? 'Sonarr' : 'Radarr'} 4K`,
        [options?.servers, mediaType],
    );

    const quotaHints = useMemo(() => {
        if (!options) return [] as string[];
        const label = mediaType === 'tv' ? 'TV' : 'movie';
        const hints: string[] = [];
        if (selectedQualities.has('hd')) {
            const hint = formatQuotaHint(options.quota?.standard, label, t);
            if (hint) hints.push(hint);
        }
        if (selectedQualities.has('4k')) {
            const hint = formatQuotaHint(options.quota?.fourK, `4K ${label}`, t);
            if (hint) hints.push(hint);
        }
        return hints;
    }, [options, selectedQualities, mediaType, t]);

    const canSubmitRequest = !!options?.canRequest
        && selectedQualities.size > 0
        && [...selectedQualities].some((q) => (q === 'hd' ? hdAllowed : fourKAllowed));

    const toggleQuality = (quality: QualityKey) => {
        const allowed = quality === 'hd' ? hdAllowed : fourKAllowed;
        if (!allowed) return;

        setSelectedQualities((prev) => {
            const next = new Set(prev);
            if (next.has(quality)) {
                // Keep at least one quality selected.
                if (next.size === 1) return prev;
                next.delete(quality);
            } else {
                next.add(quality);
            }
            return next;
        });
        setAdvancedQuality(quality);
    };

    const toggleSeason = (seasonNumber: number) => {
        const n = Number(seasonNumber);
        if (!Number.isFinite(n)) return;
        setSelectedSeasons((prev) => (
            prev.includes(n)
                ? prev.filter((x) => x !== n)
                : [...prev, n]
        ));
    };

    const selectAllRequestable = () => {
        setSelectedSeasons(
            requestableMainSeasons
                .map((s) => Number(s.seasonNumber))
                .filter((n) => Number.isFinite(n)),
        );
    };

    const deselectAllSeasons = () => {
        setSelectedSeasons([]);
    };

    const selectMissingOnly = () => {
        const missing = requestableMainSeasons
            .filter((s) => s.statusLabel === 'Not requested')
            .map((s) => Number(s.seasonNumber))
            .filter((n) => Number.isFinite(n));
        setSelectedSeasons(missing);
    };

    const tagCatalog = activeForm.serviceOptions?.tags || [];
    const selectedTagLabels = useMemo(() => {
        const byId = new Map(tagCatalog.map((tag) => [tag.id, tag.label]));
        return activeForm.selectedTags
            .map((id) => ({ id, label: byId.get(id) || `#${id}` }));
    }, [activeForm.selectedTags, tagCatalog]);

    const tagSuggestions = useMemo(() => {
        const q = tagInput.trim().toLowerCase();
        if (!q) return tagCatalog.filter((tag) => !activeForm.selectedTags.includes(tag.id)).slice(0, 8);
        return tagCatalog
            .filter((tag) => (
                !activeForm.selectedTags.includes(tag.id)
                && String(tag.label || '').toLowerCase().includes(q)
            ))
            .slice(0, 8);
    }, [tagInput, tagCatalog, activeForm.selectedTags]);

    const removeTag = (tagId: number) => {
        updateQualityForm(advancedQuality, {
            selectedTags: activeForm.selectedTags.filter((id) => id !== tagId),
        });
    };

    const addTagById = (tagId: number) => {
        if (!Number.isFinite(tagId) || activeForm.selectedTags.includes(tagId)) return;
        updateQualityForm(advancedQuality, {
            selectedTags: [...activeForm.selectedTags, tagId],
        });
        setTagInput('');
        setTagSuggestionsOpen(false);
    };

    const resolveOrCreateTag = async (rawLabel: string) => {
        const label = rawLabel.trim();
        if (!label || !options) return;

        const existing = tagCatalog.find((tag) => (
            String(tag.label || '').toLowerCase() === label.toLowerCase()
        ));
        if (existing) {
            addTagById(existing.id);
            return;
        }

        setTagCreating(true);
        try {
            const serverName = filteredServers.find((s) => s.id === activeForm.serverId)?.name
                || activeForm.serviceOptions?.server?.name
                || '';
            const created = await apiFetch('/api/discovery/request-tags', {
                method: 'POST',
                body: JSON.stringify({
                    mediaType: options.mediaType || mediaType,
                    label,
                    serverName,
                }),
            });
            if (created?.error) throw new Error(created.error);
            const tagId = Number(created?.id);
            const tagLabel = String(created?.label || label);
            if (!Number.isFinite(tagId)) throw new Error('Invalid tag created');

            setQualityForms((prev) => {
                const form = prev[advancedQuality];
                const tags = [...(form.serviceOptions?.tags || [])];
                if (!tags.some((t) => t.id === tagId)) {
                    tags.push({ id: tagId, label: tagLabel });
                }
                return {
                    ...prev,
                    [advancedQuality]: {
                        ...form,
                        selectedTags: form.selectedTags.includes(tagId)
                            ? form.selectedTags
                            : [...form.selectedTags, tagId],
                        serviceOptions: form.serviceOptions
                            ? { ...form.serviceOptions, tags }
                            : form.serviceOptions,
                    },
                };
            });
            setTagInput('');
            setTagSuggestionsOpen(false);
        } catch (e: any) {
            onError(e?.message || 'Tag must already exist in Radarr/Sonarr');
        } finally {
            setTagCreating(false);
        }
    };

    const buildRequestBody = (quality: QualityKey) => {
        if (!options) return null;
        const is4k = quality === '4k';
        const form = qualityForms[quality];
        const allMainRequestableSelected = mediaType === 'tv'
            && requestableMainSeasons.length > 0
            && requestableMainSeasons.every((s) => selectedSeasons.includes(Number(s.seasonNumber)));
        const hasSpecialsSelected = selectedSeasons.some((n) => !isMainSeasonNumber(n));

        const body: Record<string, unknown> = {
            mediaType,
            mediaId,
            is4k: is4k || undefined,
        };
        const posterPath = options.posterPath || fallbackPosterPath || null;
        if (posterPath) body.posterPath = posterPath;
        const requestTitle = String(options.title || fallbackTitle || '').trim();
        if (requestTitle) body.title = requestTitle;
        const requestOverview = String(options.overview || fallbackOverview || '').trim();
        if (requestOverview) body.overview = requestOverview;
        if (options.year != null) body.year = options.year;
        if (mediaType === 'tv') {
            // Prefer explicit season lists when Specials are in play so we never
            // accidentally request season 0 via Seerr's seasons:"all".
            const allSeasonsAreMain = (options.seasons || []).every((s) => isMainSeasonNumber(Number(s.seasonNumber)));
            body.seasons = allMainRequestableSelected
                && !hasSpecialsSelected
                && requestableMainSeasons.length === (options.seasons?.length || 0)
                && allSeasonsAreMain
                ? 'all'
                : [...selectedSeasons].sort((a, b) => a - b);
        }
        // Prefer the matching HD/4K server even when Advanced was never opened.
        const fallbackServer = (options.servers || []).find((server) => !!server.is4k === is4k)
            || (options.servers || []).find((server) => server.isDefault)
            || (options.servers || [])[0]
            || null;
        // Only send profile / root / tags when Advanced was opened and options loaded.
        if (options.canRequestAdvanced && showAdvanced && form.loaded) {
            if (form.serverId != null) body.serverId = form.serverId;
            else if (fallbackServer?.id != null) body.serverId = fallbackServer.id;
            if (form.profileId != null) body.profileId = form.profileId;
            if (form.rootFolder) body.rootFolder = form.rootFolder;
            if (options.canRequestTags !== false && form.selectedTags.length) body.tags = form.selectedTags;
        } else if (fallbackServer?.id != null) {
            body.serverId = fallbackServer.id;
        }
        if (options.isAnime) body.isAnime = true;
        return body;
    };

    const handleSubmit = async () => {
        if (!canSubmitRequest || !options) return;

        const qualities = [...selectedQualities].filter((q) => (q === 'hd' ? hdAllowed : fourKAllowed));
        if (!qualities.length) {
            onError(t('request.selectQuality'));
            return;
        }
        if (mediaType === 'tv' && selectedSeasons.length === 0) {
            onError(t('request.selectSeason'));
            return;
        }
        // Only enforce Advanced fields when the member opened Advanced and options loaded.
        if (options.canRequestAdvanced && showAdvanced) {
            for (const quality of qualities) {
                const form = qualityForms[quality];
                if (form.loaded && !form.rootFolder) {
                    onError(t('request.selectRootFolder', { quality: quality === '4k' ? '4K' : 'HD' }));
                    setAdvancedQuality(quality);
                    setShowAdvanced(true);
                    return;
                }
            }
        }

        setSubmitting(true);
        onCloseRef.current();
        const successes: string[] = [];
        const failures: string[] = [];

        try {
            for (const quality of qualities) {
                const label = quality === '4k' ? '4K' : 'HD';
                try {
                    const body = buildRequestBody(quality);
                    if (!body) throw new Error(t('request.invalidRequest'));
                    const res = await apiFetch('/api/discovery/request', {
                        method: 'POST',
                        body: JSON.stringify(body),
                    });
                    if (res?.error) throw new Error(res.error);
                    successes.push(label);
                } catch (e: any) {
                    failures.push(`${label}: ${e?.message || t('status.failed')}`);
                }
            }

            if (successes.length && !failures.length) {
                onSuccessRef.current(
                    mediaType === 'tv'
                        ? t('request.submittedSeries', { qualities: successes.join(' + ') })
                        : t('request.submittedMovie', { qualities: successes.join(' + ') }),
                );
            } else if (successes.length && failures.length) {
                onSuccessRef.current(t('request.submittedPartial', {
                    successes: successes.join(' + '),
                    failures: failures.join('; '),
                }));
            } else {
                onErrorRef.current(failures.join('; ') || t('request.submitFailed'));
            }
        } finally {
            setSubmitting(false);
        }
    };

    const handleNotifyToggle = async () => {
        if (!options?.canNotify && !options?.isWatching) return;
        try {
            setSubmitting(true);
            const res = await apiFetch('/api/discovery/request/notify', {
                method: 'POST',
                body: JSON.stringify({
                    mediaType,
                    mediaId,
                    subscribe: !options.isWatching,
                }),
            });
            if (res?.error) throw new Error(res.error);
            const watching = !!res?.isWatching;
            setOptions((prev) => (prev ? { ...prev, isWatching: watching, canNotify: true } : prev));
            onNotifyChange?.(watching);
            onSuccessRef.current(watching ? t('request.notifySaved') : t('request.notifyRemoved'), { notify: true });
            if (watching) onCloseRef.current();
        } catch (e: any) {
            onErrorRef.current(e?.message || t('request.notifyFailed'));
        } finally {
            setSubmitting(false);
        }
    };

    if (!open) return null;

    const displayTitle = options?.title || fallbackTitle || t('request.requestMedia');
    const overview = (options?.overview || fallbackOverview || '').trim();
    const posterUrl = resolveTmdbImageUrl(options?.posterPath || fallbackPosterPath, 'w342');
    const notifyOnly = !!(options?.canNotify || options?.isWatching);
    const showTagsField = options?.canRequestTags !== false;
    const advancedProfiles = activeForm.serviceOptions?.profiles || [];
    const advancedFolders = activeForm.serviceOptions?.rootFolders || [];
    const showServerSelect = filteredServers.length > 1;
    const showProfileSelect = advancedProfiles.length !== 1;
    const showFolderSelect = advancedFolders.length !== 1;
    const bothQualitiesSelected = selectedQualities.has('hd') && selectedQualities.has('4k');
    const advancedHasChoices = showTagsField
        || !activeForm.loaded
        || showServerSelect
        || showProfileSelect
        || showFolderSelect;
    const showAdvancedSection = !!options?.canRequestAdvanced && !notifyOnly && advancedHasChoices;
    // Show HD + UHD chips whenever a 4K *arr exists, or 4K requests are allowed
    // (so members still see the dual picker when permissions are on).
    const showQualityPicker = !notifyOnly && (!!options?.has4kServer || !!options?.canRequest4k
        || ((options?.servers || []).length > 1));
    const advancedLoading = showAdvancedSection && showAdvanced && activeForm.loading && !activeForm.loaded;
    const showRoutingFields = !advancedLoading && (showServerSelect || showProfileSelect || showFolderSelect);

    const seasonsSection = !notifyOnly && mediaType === 'tv' && (options?.seasons?.length || 0) > 0 ? (
        <div>
            <div className="flex items-center justify-between gap-3 mb-3">
                <p className="text-xs font-bold uppercase tracking-wider text-white/40">{t('request.seasons')}</p>
                {requestableSeasons.length > 0 && (
                    <div className="flex flex-wrap gap-x-2 gap-y-1 justify-end">
                        <button
                            type="button"
                            onClick={selectAllRequestable}
                            className="text-[11px] font-bold text-plex hover:text-plex-hover transition-colors"
                        >
                            {t('request.selectAll')}
                        </button>
                        <span className="text-white/20">·</span>
                        <button
                            type="button"
                            onClick={deselectAllSeasons}
                            className="text-[11px] font-bold text-plex hover:text-plex-hover transition-colors"
                        >
                            {t('request.deselectAll')}
                        </button>
                        <span className="text-white/20">·</span>
                        <button
                            type="button"
                            onClick={selectMissingOnly}
                            className="text-[11px] font-bold text-plex hover:text-plex-hover transition-colors"
                        >
                            {t('request.missingOnly')}
                        </button>
                    </div>
                )}
            </div>
            {/* #170: cap on mobile too — an uncapped list pushed Advanced off-screen. */}
            <div
                data-modal-scroll=""
                className="flex flex-col gap-2 max-h-[min(40vh,20rem)] overflow-y-auto overscroll-contain custom-scrollbar pr-1"
            >
                {(options?.seasons || []).map((season) => {
                    const seasonNumber = Number(season.seasonNumber);
                    const selected = selectedSeasons.includes(seasonNumber);
                    const disabled = !season.requestable || submitting;
                    return (
                        // Use a button (not label + sr-only checkbox): focusing a clipped
                        // checkbox inside overflow-hidden scrolls the dialog content away
                        // and leaves an empty card.
                        <button
                            key={seasonNumber}
                            type="button"
                            disabled={disabled}
                            aria-pressed={selected}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={(event) => {
                                event.stopPropagation();
                                if (!disabled) toggleSeason(seasonNumber);
                            }}
                            className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors w-full ${
                                disabled
                                    ? 'border-white/5 bg-white/[0.02] opacity-70 cursor-not-allowed'
                                    : selected
                                        ? 'border-plex/35 bg-plex/10 cursor-pointer'
                                        : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06] cursor-pointer'
                            }`}
                        >
                            <span className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border ${
                                selected ? 'border-plex bg-plex/20' : 'border-white/20 bg-black/20'
                            }`} aria-hidden="true">
                                {selected && <CheckCircle className="w-3.5 h-3.5 text-plex" />}
                            </span>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                    <span className="text-sm font-bold text-white truncate">
                                        {formatSeasonName(season.name, seasonNumber, t)}
                                    </span>
                                    <span className={`${mediaStatusChipClass} ${seasonStatusBadgeClass(season.statusLabel, season.requestable)}`}>
                                        {translateDiscoverStatus(t, season.statusLabel)}
                                    </span>
                                </div>
                                {season.episodeCount > 0 && (
                                    <p className="text-xs text-white/45 mt-0.5">
                                        {t('common.episodeCount', { count: season.episodeCount })}
                                    </p>
                                )}
                            </div>
                        </button>
                    );
                })}
            </div>
        </div>
    ) : null;

    return (
        <ModalPortal open={open}>
        {/* Hug the form (no full-screen gap under Advanced). Cap at the overlay
            height so long TV season lists still scroll above the tab bar.
            Size the overlay with top + bottom only — a second h-[calc(100dvh-…)]
            fights iOS insets (height wins, bottom is ignored). */}
        <div className="fixed inset-x-0 top-0 z-[340] flex min-h-0 items-end overflow-hidden sm:items-center justify-center p-0 sm:p-4 bottom-[calc(4rem+env(safe-area-inset-bottom,0px))] sm:inset-0">
            <button
                type="button"
                aria-label={t('request.closeAria')}
                className="absolute inset-0 bg-black/80 backdrop-blur-sm touch-none"
                onClick={() => { if (!submitting) onClose(); }}
            />
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="request-modal-title"
                onMouseDown={(event) => event.stopPropagation()}
                className="relative w-full max-h-full sm:max-w-3xl lg:max-w-4xl sm:max-h-[85vh] min-h-0 bg-card border border-white/10 rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden"
            >
                <div className="flex items-start justify-between gap-4 p-5 border-b border-white/10 bg-black/20 shrink-0">
                    <div className="flex items-start gap-4 min-w-0">
                        <div className="w-20 h-[7.5rem] sm:w-24 sm:h-36 rounded-xl overflow-hidden flex-shrink-0 bg-black/40 border border-white/10 shadow-lg">
                            {posterUrl ? (
                                <img src={posterUrl} alt="" className="w-full h-full object-cover" />
                            ) : (
                                <NoPosterPlaceholder compact />
                            )}
                        </div>
                        <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 mb-1">
                                {mediaType === 'movie' ? (
                                    <Film className="w-4 h-4 text-plex" />
                                ) : (
                                    <Tv className="w-4 h-4 text-plex" />
                                )}
                                <span className="text-[10px] font-bold uppercase tracking-widest text-plex">
                                    {notifyOnly
                                        ? t('request.notifyMe')
                                        : (mediaType === 'movie' ? t('request.requestMovie') : t('request.requestSeries'))}
                                </span>
                            </div>
                            <h2 id="request-modal-title" className="text-xl sm:text-2xl font-black text-white leading-tight">
                                {displayTitle}
                            </h2>
                            {overview ? (
                                <p className="text-sm text-white/55 mt-2 line-clamp-3 leading-relaxed">
                                    {overview}
                                </p>
                            ) : null}
                            {quotaHints.length > 0 && !notifyOnly && (
                                <div className="mt-2 flex flex-col gap-0.5">
                                    {quotaHints.map((hint) => (
                                        <p key={hint} className="text-xs text-white/45">{hint}</p>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={submitting}
                        className="p-2 rounded-full hover:bg-white/10 text-white/50 hover:text-white transition-colors disabled:opacity-50 shrink-0"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div
                    ref={scrollBodyRef}
                    data-modal-scroll=""
                    className="flex-1 min-h-0 overflow-y-auto overscroll-contain touch-pan-y custom-scrollbar [-webkit-overflow-scrolling:touch] p-5 pb-8 space-y-5"
                >
                    {loading ? (
                        <div className="flex flex-col items-center justify-center gap-3 py-10">
                            <Loader2 className="w-7 h-7 text-plex animate-spin" />
                            <p className="text-sm text-white/45">{t('request.loadingOptions')}</p>
                        </div>
                    ) : !options ? (
                        <p className="text-sm text-muted text-center py-8">{t('request.unableToLoad')}</p>
                    ) : (
                        <>
                            {options.blockReason && !options.canRequest && (
                                <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
                                    {options.blockReason}
                                    {options.canNotify ? (
                                        <p className="mt-2 text-[13px] text-amber-100/80">
                                            {formatNotifyMeHint(t, options.requestedByName, options.requestedByCount)}
                                        </p>
                                    ) : null}
                                </div>
                            )}

                            {notifyOnly && (!options.blockReason || options.canRequest) && (
                                <div className="rounded-xl border border-sky-500/25 bg-sky-500/10 px-4 py-3 text-sm text-sky-100">
                                    {formatNotifyMeHint(t, options.requestedByName, options.requestedByCount)}
                                </div>
                            )}

                            {options.availabilityNote && options.canRequest && (
                                <div className="rounded-xl border border-sky-500/25 bg-sky-500/10 px-4 py-3 text-sm text-sky-100">
                                    {options.availabilityNote}
                                </div>
                            )}

                            {hdQuotaBlocked && selectedQualities.has('hd') && !notifyOnly && (
                                <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
                                    {t('request.quotaUsed', { count: options.quota?.standard?.limit || 0, quality: 'HD' })}
                                </div>
                            )}

                            {fourKQuotaBlocked && selectedQualities.has('4k') && !notifyOnly && (
                                <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
                                    {t('request.quotaUsed', { count: options.quota?.fourK?.limit || 0, quality: '4K' })}
                                </div>
                            )}

                            {showQualityPicker && (
                                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                                    <p className="text-xs font-bold uppercase tracking-wider text-white/40 mb-3">
                                        {t('request.quality')}
                                        <span className="ml-2 font-medium normal-case tracking-normal text-white/30">
                                            {t('request.selectHdUhd')}
                                        </span>
                                    </p>
                                    <div className="grid grid-cols-2 gap-2">
                                        {([
                                            {
                                                key: 'hd' as QualityKey,
                                                label: '1080p / HD',
                                                badge: 'HD',
                                                serverName: hdServerName,
                                                allowed: hdAllowed,
                                                blockedHint: options?.libraryQualities?.hd
                                                    ? t('request.alreadyInLibrary')
                                                    : options?.requestedQualities?.hd
                                                        ? t('request.alreadyRequested')
                                                        : hdQuotaBlocked
                                                        ? t('request.hdQuotaUsedUp')
                                                        : t('request.hdUnavailable'),
                                            },
                                            {
                                                key: '4k' as QualityKey,
                                                label: 'Ultra HD',
                                                badge: '4K',
                                                serverName: fourKServerName,
                                                allowed: fourKAllowed,
                                                blockedHint: options?.libraryQualities?.['4k']
                                                    ? t('request.alreadyInLibrary')
                                                    : options?.requestedQualities?.['4k']
                                                        ? t('request.alreadyRequested')
                                                        : fourKQuotaBlocked
                                                        ? t('request.fourKQuotaUsedUp')
                                                        : (!options?.canRequest4k
                                                            ? t('request.fourKDisabled')
                                                            : t('request.noFourKServer')),
                                            },
                                        ]).map((entry) => {
                                            const selected = selectedQualities.has(entry.key);
                                            return (
                                                <button
                                                    key={entry.key}
                                                    type="button"
                                                    onClick={() => toggleQuality(entry.key)}
                                                    disabled={!entry.allowed}
                                                    aria-pressed={selected}
                                                    className={`relative flex flex-col items-start gap-1 py-3 px-3.5 rounded-xl text-left transition-all border ${
                                                        selected
                                                            ? 'bg-plex/15 border-plex/45 text-white shadow-[inset_0_0_0_1px_rgba(229,160,13,0.15)]'
                                                            : 'bg-white/5 border-white/10 text-white/55 hover:text-white hover:bg-white/[0.07]'
                                                    } disabled:opacity-40 disabled:cursor-not-allowed`}
                                                >
                                                    <span className="flex items-center gap-2 w-full">
                                                        <span className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border ${
                                                            selected ? 'border-plex bg-plex/20' : 'border-white/20 bg-black/20'
                                                        }`}>
                                                            {selected && <CheckCircle className="w-3.5 h-3.5 text-plex" />}
                                                        </span>
                                                        <span className={`flex h-6 w-6 items-center justify-center rounded-md text-[10px] font-black tracking-tight ${
                                                            selected
                                                                ? 'bg-plex text-black'
                                                                : 'bg-white/10 text-white/70'
                                                        }`}>
                                                            {entry.badge}
                                                        </span>
                                                        <span className="text-sm font-bold">{entry.label}</span>
                                                    </span>
                                                    <span className="text-[11px] text-white/40 pl-7 truncate max-w-full">
                                                        {entry.allowed ? entry.serverName : entry.blockedHint}
                                                    </span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            {options.canRequest && !notifyOnly && !showAdvancedSection && (
                                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/70">
                                    {mediaType === 'tv'
                                        ? t('request.chooseTv')
                                        : t('request.chooseMovie')}
                                </div>
                            )}

                            {showAdvancedSection && (
                                <div
                                    ref={advancedSectionRef}
                                    className="rounded-xl border border-white/10 bg-white/[0.03] overflow-hidden"
                                >
                                    <button
                                        type="button"
                                        onClick={() => setShowAdvanced((prev) => !prev)}
                                        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-white/[0.03] transition-colors"
                                    >
                                        <span className="min-w-0 flex flex-col gap-0.5">
                                            <span className="text-xs font-bold uppercase tracking-wider text-white/50">{t('request.advanced')}</span>
                                            {!showAdvanced ? (
                                                <span className="text-[11px] font-medium normal-case tracking-normal text-white/35 truncate">
                                                    {activeForm.loaded && activeForm.profileId != null
                                                        ? ((activeForm.serviceOptions?.profiles || [])
                                                            .find((profile) => Number(profile.id) === Number(activeForm.profileId))
                                                            ?.name || t('request.qualityProfile'))
                                                        : t('request.optionalArrDefaults')}
                                                </span>
                                            ) : null}
                                        </span>
                                        {showAdvanced
                                            ? <ChevronUp className="w-4 h-4 text-white/40 shrink-0" />
                                            : <ChevronDown className="w-4 h-4 text-white/40 shrink-0" />}
                                    </button>

                                    {showAdvanced && (
                                        <div className="px-4 pb-4 flex flex-col gap-3 border-t border-white/10">
                                            {advancedLoading ? (
                                                <div className="flex items-center gap-2 py-6 justify-center text-white/50 text-sm">
                                                    <Loader2 className="w-4 h-4 animate-spin text-plex" />
                                                    {t('request.loadingServerOptions')}
                                                </div>
                                            ) : (
                                                <>
                                                    {bothQualitiesSelected && (
                                                        <div className="flex gap-1 pt-3">
                                                            {(['hd', '4k'] as QualityKey[]).map((q) => (
                                                                <button
                                                                    key={q}
                                                                    type="button"
                                                                    onClick={() => setAdvancedQuality(q)}
                                                                    className={`flex-1 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wide border transition-colors ${
                                                                        advancedQuality === q
                                                                            ? 'bg-white/10 border-white/20 text-white'
                                                                            : 'bg-transparent border-transparent text-white/40 hover:text-white/70'
                                                                    }`}
                                                                >
                                                                    {q === '4k' ? t('request.fourKOptions') : t('request.hdOptions')}
                                                                </button>
                                                            ))}
                                                        </div>
                                                    )}

                                                    {showRoutingFields && (
                                                        <div className={`flex flex-col gap-3 ${bothQualitiesSelected ? '' : 'pt-3'}`}>
                                                            {showServerSelect && (
                                                                <div>
                                                                    <label className="block text-xs font-bold uppercase tracking-wider text-white/40 mb-2">
                                                                        {t('request.destinationServer')}
                                                                    </label>
                                                                    <CustomSelect
                                                                        value={String(activeForm.serverId ?? '')}
                                                                        onChange={(val) => {
                                                                            const nextId = Number(val);
                                                                            updateQualityForm(advancedQuality, { serverId: nextId });
                                                                            if (options) {
                                                                                loadServiceOptions(options, advancedQuality, nextId, null, {
                                                                                    preserveSelections: false,
                                                                                });
                                                                            }
                                                                        }}
                                                                        options={filteredServers.map((server) => ({
                                                                            value: String(server.id),
                                                                            label: server.isDefault ? `${server.name} (${t('common.default')})` : server.name,
                                                                        }))}
                                                                    />
                                                                </div>
                                                            )}

                                                            {showProfileSelect && (
                                                            <div>
                                                                <label className="block text-xs font-bold uppercase tracking-wider text-white/40 mb-2">
                                                                    {t('request.qualityProfile')}
                                                                </label>
                                                                {advancedProfiles.length > 0 ? (
                                                                    <CustomSelect
                                                                        value={String(activeForm.profileId ?? '')}
                                                                        onChange={(val) => updateQualityForm(advancedQuality, {
                                                                            profileId: Number(val),
                                                                        })}
                                                                        options={advancedProfiles.map((profile) => ({
                                                                            value: String(profile.id),
                                                                            label: profile.name,
                                                                        }))}
                                                                    />
                                                                ) : (
                                                                    <p className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
                                                                        {t('request.noQualityProfiles')}
                                                                    </p>
                                                                )}
                                                            </div>
                                                            )}

                                                            {showFolderSelect && (
                                                            <div>
                                                                <label className="block text-xs font-bold uppercase tracking-wider text-white/40 mb-2">
                                                                    {t('request.rootFolder')}
                                                                </label>
                                                                {advancedFolders.length > 0 ? (
                                                                    <CustomSelect
                                                                        value={activeForm.rootFolder}
                                                                        onChange={(val) => updateQualityForm(advancedQuality, {
                                                                            rootFolder: val,
                                                                        })}
                                                                        options={advancedFolders.map((folder) => ({
                                                                            value: folder.path,
                                                                            label: rootFolderLabel(folder, advancedFolders, t('storage.free')),
                                                                        }))}
                                                                    />
                                                                ) : (
                                                                    <p className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
                                                                        {t('request.noRootFolders')}
                                                                    </p>
                                                                )}
                                                            </div>
                                                            )}
                                                        </div>
                                                    )}

                                                    {showTagsField && (
                                                    <div className={showRoutingFields || bothQualitiesSelected ? '' : 'pt-3'}>
                                                        <label className="block text-xs font-bold uppercase tracking-wider text-white/40 mb-2">
                                                            {t('request.tags')}
                                                        </label>
                                                        <div className="flex flex-wrap gap-1.5 mb-2 min-h-[1.5rem]">
                                                            {selectedTagLabels.map((tag) => (
                                                                <button
                                                                    key={tag.id}
                                                                    type="button"
                                                                    onClick={() => removeTag(tag.id)}
                                                                    className="inline-flex items-center gap-1 rounded-lg border border-plex/30 bg-plex/10 px-2 py-1 text-xs text-white hover:bg-plex/20 transition-colors"
                                                                >
                                                                    {tag.label}
                                                                    <X className="w-3 h-3 text-white/50" />
                                                                </button>
                                                            ))}
                                                        </div>
                                                        <div className="relative">
                                                            <input
                                                                type="text"
                                                                value={tagInput}
                                                                disabled={tagCreating || submitting}
                                                                onChange={(e) => {
                                                                    setTagInput(e.target.value);
                                                                    setTagSuggestionsOpen(true);
                                                                }}
                                                                onFocus={() => setTagSuggestionsOpen(true)}
                                                                onBlur={() => {
                                                                    window.setTimeout(() => setTagSuggestionsOpen(false), 150);
                                                                }}
                                                                onKeyDown={(e) => {
                                                                    if (e.key === 'Enter' || e.key === ',') {
                                                                        e.preventDefault();
                                                                        const value = tagInput.replace(/,/g, '').trim();
                                                                        if (value) void resolveOrCreateTag(value);
                                                                    } else if (e.key === 'Backspace' && !tagInput && activeForm.selectedTags.length) {
                                                                        removeTag(activeForm.selectedTags[activeForm.selectedTags.length - 1]);
                                                                    }
                                                                }}
                                                                placeholder={t('request.tagPlaceholder')}
                                                                className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-plex/40"
                                                            />
                                                            {tagCreating && (
                                                                <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-plex" />
                                                            )}
                                                            {tagSuggestionsOpen && tagSuggestions.length > 0 && (
                                                                <div className="absolute z-20 left-0 right-0 mt-1 rounded-lg border border-white/10 bg-[#1a1a1a] shadow-xl overflow-hidden">
                                                                    {tagSuggestions.map((tag) => (
                                                                        <button
                                                                            key={tag.id}
                                                                            type="button"
                                                                            onMouseDown={(e) => e.preventDefault()}
                                                                            onClick={() => addTagById(tag.id)}
                                                                            className="w-full text-left px-3 py-2 text-sm text-white/80 hover:bg-white/10 transition-colors"
                                                                        >
                                                                            {tag.label}
                                                                        </button>
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </div>
                                                        <p className="text-[11px] text-white/35 mt-1.5">
                                                            {t('request.tagHint')}
                                                        </p>
                                                    </div>
                                                    )}
                                                </>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Seasons last so Quality / Destination / Advanced match the movie modal above the fold. */}
                            {seasonsSection}
                        </>
                    )}
                </div>

                <div className="p-4 sm:p-5 pt-4 border-t border-white/10 bg-black/20 flex gap-3 pb-4 sm:pb-5 shrink-0">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={submitting}
                        className="flex-1 py-3 rounded-xl border border-white/10 text-white/70 font-bold hover:bg-white/5 transition-colors disabled:opacity-50"
                    >
                        {t('common.cancel')}
                    </button>
                    {!options?.canRequest && !loading && !notifyOnly ? (
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 py-3 rounded-xl bg-plex text-black font-black hover:bg-plex-hover transition-colors"
                        >
                            {t('common.close')}
                        </button>
                    ) : notifyOnly ? (
                            <button
                                type="button"
                                onClick={handleNotifyToggle}
                                disabled={submitting || loading}
                                className="flex-1 py-3 rounded-xl bg-plex text-black font-black hover:bg-plex-hover transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                            >
                                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bell className="w-4 h-4" />}
                                {options?.isWatching ? t('request.stopNotify') : t('request.notifyMe')}
                            </button>
                    ) : (
                        <button
                            type="button"
                            onClick={handleSubmit}
                            disabled={submitting || loading || !canSubmitRequest}
                            className="flex-1 py-3 rounded-xl bg-plex text-black font-black hover:bg-plex-hover transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                            {submitting
                                ? t('request.submitting')
                                : selectedQualities.size > 1
                                    ? t('request.submitHd4k')
                                    : t('request.submit')}
                        </button>
                    )}
                </div>
            </div>
        </div>
        </ModalPortal>
    );
};
