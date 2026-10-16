import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    X, Loader2, ChevronDown, ChevronRight, ChevronLeft, Search, ExternalLink,
} from 'lucide-react';
import { apiFetch } from '../shared/api';
import { portalUrl, resolvePortalAssetUrl } from '../shared/basePath';
import { CustomSelect } from '../shared/ui';
import { handleArrPortalEmbedAnchorClick } from '../../lib/arr-portal-embed.js';
import type { UpgraderItem, UpgraderProfileInstance, UpgraderShowDetail } from './types';
import { formatUpgraderCodecLabel } from './codecUtils';

type UpgraderShowDrawerProps = {
    show: UpgraderItem | null;
    codecs: string[];
    resolutions: string[];
    features: string[];
    qualities: string[];
    onClose: () => void;
    addToast?: (message: string, type?: 'success' | 'error') => void;
    automationReady?: boolean;
    onProfileChanged?: () => void;
    position?: 'sidebar' | 'modal';
};

const formatSeasonLabel = (seasonNumber: number) => {
    if (seasonNumber < 0) return 'Specials';
    if (seasonNumber === 0) return 'Season 0';
    return `Season ${seasonNumber}`;
};

const EpisodeQualityBadges: React.FC<{ tags: string[]; isHevc?: boolean; codec?: string; sizeGB?: number }> = ({ tags, isHevc, codec, sizeGB }) => (
    <div className="flex flex-wrap gap-2 items-center">
        {sizeGB ? (
            <span className="text-xs font-bold px-2 py-1 rounded-md bg-blue-500/20 text-blue-200 border border-blue-500/30">
                {sizeGB < 1 ? `${Math.round(sizeGB * 1024)} MB` : `${sizeGB.toFixed(2)} GB`}
            </span>
        ) : null}
        {codec ? (
            <span className="text-xs font-bold px-2 py-1 rounded-md bg-plex/20 text-plex border border-plex/30">
                {formatUpgraderCodecLabel(codec)}
            </span>
        ) : null}
        {(tags || []).slice(0, 4).map((tag) => (
            <span key={tag} className="text-xs font-bold px-2 py-1 rounded-md bg-white/10 text-text border border-white/10 shadow-sm">
                {tag}
            </span>
        ))}
        {isHevc && !(tags || []).includes('HEVC') && (!codec || !codec.toLowerCase().includes('hevc')) && (
            <span className="text-xs font-bold px-2 py-1 rounded-md bg-purple-500/20 text-purple-300 border border-purple-500/30">
                HEVC
            </span>
        )}
    </div>
);

export const UpgraderShowDrawer: React.FC<UpgraderShowDrawerProps> = ({
    show,
    codecs,
    resolutions,
    features,
    qualities,
    onClose,
    addToast,
    automationReady = false,
    onProfileChanged,
    position = 'sidebar',
}) => {
    const [loading, setLoading] = useState(false);
    const [detail, setDetail] = useState<UpgraderShowDetail | null>(null);
    const [expandedSeasons, setExpandedSeasons] = useState<Set<number>>(new Set());
    const [searchingKey, setSearchingKey] = useState<string | null>(null);
    const [highlightFilterOnly, setHighlightFilterOnly] = useState(false);
    const [profileInstance, setProfileInstance] = useState<UpgraderProfileInstance | null>(null);
    const [profilesLoading, setProfilesLoading] = useState(false);
    const [selectedProfileId, setSelectedProfileId] = useState('');
    const [triggerSearchOnApply, setTriggerSearchOnApply] = useState(true);
    const [applyingProfile, setApplyingProfile] = useState(false);

    const codecsArr = highlightFilterOnly ? codecs : [];
    const resolutionsArr = highlightFilterOnly ? resolutions : [];
    const featuresArr = highlightFilterOnly ? features : [];
    const qualitiesArr = highlightFilterOnly ? qualities : [];

    const loadDetail = useCallback(async () => {
        if (!show) return;
        setLoading(true);
        try {
            const data = await apiFetch(
                `/api/upgrader/items/${encodeURIComponent(show.ratingKey)}/detail?codecs=${encodeURIComponent(codecsArr.join(','))}&resolutions=${encodeURIComponent(resolutionsArr.join(','))}&features=${encodeURIComponent(featuresArr.join(','))}&qualities=${encodeURIComponent(qualitiesArr.join(','))}`,
            );
            setDetail(data as UpgraderShowDetail);
            const seasons = Array.isArray(data?.seasons) ? data.seasons : [];
            const latestSeason = seasons.reduce((max: number, s: any) => Math.max(max, s.seasonNumber ?? -1), -1);
            const defaultExpanded = new Set<number>();
            if (codecsArr.length > 0 || resolutionsArr.length > 0 || featuresArr.length > 0 || qualitiesArr.length > 0) {
                seasons
                    .filter((season: any) => (season.matchedCount ?? 0) > 0)
                    .slice(0, 2)
                    .forEach((season: any) => defaultExpanded.add(season.seasonNumber));
            }
            setExpandedSeasons(defaultExpanded);
        } catch (e: unknown) {
            setDetail(null);
            addToast?.((e as Error)?.message || 'Failed to load show detail', 'error');
        } finally {
            setLoading(false);
        }
    }, [addToast, show, codecsArr.join(','), resolutionsArr.join(','), featuresArr.join(','), qualitiesArr.join(',')]);

    useEffect(() => {
        if (!show) {
            setDetail(null);
            setExpandedSeasons(new Set());
            setHighlightFilterOnly(false);
            setProfileInstance(null);
            setSelectedProfileId('');
            return;
        }
        loadDetail();
    }, [loadDetail, show]);

    useEffect(() => {
        const instanceId = detail?.arr?.instanceId;
        if (!instanceId || !automationReady) {
            setProfileInstance(null);
            return;
        }
        let cancelled = false;
        setProfilesLoading(true);
        apiFetch('/api/upgrader/profiles')
            .then((data) => {
                if (cancelled) return;
                const instances = Array.isArray(data?.instances) ? data.instances : [];
                const match = instances.find((entry: UpgraderProfileInstance) => entry.id === instanceId) || null;
                setProfileInstance(match);
            })
            .catch(() => {
                if (!cancelled) setProfileInstance(null);
            })
            .finally(() => {
                if (!cancelled) setProfilesLoading(false);
            });
        return () => { cancelled = true; };
    }, [automationReady, detail?.arr?.instanceId]);

    useEffect(() => {
        const arr = detail?.arr;
        if (!arr) return;
        const preferred = (arr.targetProfileId && arr.targetProfileId !== arr.currentProfileId)
            ? arr.targetProfileId
            : arr.currentProfileId;
        if (preferred) setSelectedProfileId(String(preferred));
    }, [detail?.arr?.currentProfileId, detail?.arr?.targetProfileId, detail?.arr?.instanceId]);

    const triggerSearch = async (scope: 'series' | 'episode', episodeIds?: number[], label?: string) => {
        if (!show) return;
        const key = scope === 'episode' && episodeIds?.length ? `ep-${episodeIds.join(',')}` : 'series';
        setSearchingKey(key);
        try {
            await apiFetch('/api/upgrader/search', {
                method: 'POST',
                body: JSON.stringify({
                    ratingKey: show.ratingKey,
                    scope,
                    episodeIds,
                }),
            });
            addToast?.(label || (scope === 'series' ? 'Series search triggered.' : 'Episode search triggered.'), 'success');
        } catch (e: unknown) {
            addToast?.((e as Error)?.message || 'Search failed', 'error');
        } finally {
            setSearchingKey(null);
        }
    };

    const toggleSeason = (seasonNumber: number) => {
        setExpandedSeasons((prev) => {
            const next = new Set(prev);
            if (next.has(seasonNumber)) next.delete(seasonNumber);
            else next.add(seasonNumber);
            return next;
        });
    };

    const profileOptions = useMemo(
        () => (profileInstance?.profiles || []).map((profile) => ({
            value: String(profile.id),
            label: profile.name,
        })),
        [profileInstance?.profiles],
    );

    const currentProfileId = detail?.arr?.currentProfileId ?? null;
    const selectedProfileNumeric = Number(selectedProfileId || 0);
    const profileUnchanged = currentProfileId != null && selectedProfileNumeric === currentProfileId;
    const canApplyProfile = automationReady
        && detail?.arr?.mapped
        && selectedProfileNumeric > 0
        && !profileUnchanged
        && !applyingProfile;

    const applyProfile = async () => {
        if (!show || !canApplyProfile) return;
        setApplyingProfile(true);
        try {
            const result = await apiFetch('/api/upgrader/upgrade', {
                method: 'POST',
                body: JSON.stringify({
                    ratingKeys: [show.ratingKey],
                    qualityProfileId: selectedProfileNumeric,
                    profileChangeOnly: true,
                    triggerSearch: triggerSearchOnApply,
                }),
            });
            const entry = (result?.results || [])[0];
            if (entry?.skipped) {
                addToast?.(entry.reason || 'Already on this profile.', 'success');
            } else if (entry?.success) {
                const from = entry.currentProfileName || 'current';
                const to = entry.targetProfileName || `profile ${selectedProfileNumeric}`;
                addToast?.(`Quality profile updated: ${from} → ${to}`, 'success');
                await loadDetail();
                onProfileChanged?.();
            } else {
                addToast?.(entry?.reason || 'Profile change failed', 'error');
            }
        } catch (e: unknown) {
            addToast?.((e as Error)?.message || 'Profile change failed', 'error');
        } finally {
            setApplyingProfile(false);
        }
    };

    const displaySeasons = useMemo(() => {
        if (!detail?.seasons) return [];
        const sortedSeasons = [...detail.seasons].sort((a, b) => b.seasonNumber - a.seasonNumber);
        if (highlightFilterOnly) {
            return sortedSeasons.map((season) => ({
                ...season,
                episodes: season.episodes.filter((episode) => episode.matchesPreset !== false),
            })).filter((season) => season.episodes.length > 0);
        }
        return sortedSeasons;
    }, [detail?.seasons, highlightFilterOnly]);

    const episodeSourceLabel = () => 'Sonarr';

    if (!show) return null;

    const arr = detail?.arr;
    const showMeta = detail?.show || show;
    const detailReady = !loading && !!detail;
    const canSearch = !!arr?.seriesId;
    const canChangeProfile = automationReady && !!arr?.instanceId;

    return (
        <div className={`fixed inset-0 z-[60] flex ${position === 'modal' ? 'items-center justify-center p-0 sm:p-6 md:p-12' : 'justify-end'}`}>
            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
            <div className={`relative w-full max-w-5xl bg-card border-border/80 shadow-2xl flex flex-col ${position === 'modal' ? 'h-full sm:h-[90vh] rounded-none sm:rounded-2xl border-none sm:border overflow-hidden mx-auto' : 'h-full border-l'}`}>
                <div className="px-4 sm:px-5 py-4 border-b border-border/60 space-y-4">
                    <button type="button" onClick={onClose} className="inline-flex items-center gap-1.5 px-2 py-1 -ml-2 rounded-lg hover:bg-white/10 text-muted hover:text-text text-sm font-bold transition-colors">
                        <ChevronLeft className="w-4 h-4" />
                        Back to Filter
                    </button>
                    <div className="flex items-start gap-4">
                        <div className="w-16 h-24 rounded-lg overflow-hidden bg-white/5 shrink-0 border border-white/10">
                            {showMeta.thumbUrl ? (
                                <img
                                    src={resolvePortalAssetUrl(showMeta.thumbUrl)}
                                    alt={showMeta.title}
                                    className="w-full h-full object-cover"
                                />
                            ) : null}
                        </div>
                        <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <h3 className="text-lg font-bold text-text">{showMeta.title}</h3>
                                    <p className="text-xs text-muted mt-1">
                                        {showMeta.libraryTitle}
                                        {showMeta.year ? ` · ${showMeta.year}` : ''}
                                        {detail?.stats ? ` · ${detail.stats.total} episodes` : ''}
                                    </p>
                                </div>
                            </div>
                            {detailReady && (
                                <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                                    <span className="px-2 py-1 rounded-full bg-plex/15 border border-plex/30 text-plex font-semibold">
                                        {arr?.instanceName || showMeta.libraryTitle}
                                    </span>
                                    <span className="px-2 py-1 rounded-full bg-green-500/10 border border-green-500/30 text-green-200 font-semibold">
                                        {episodeSourceLabel()} episodes
                                    </span>
                                    {arr?.currentProfileName && (
                                        <span className="px-2 py-1 rounded-full bg-white/5 border border-white/10 text-muted">
                                            Current: {arr.currentProfileName}
                                        </span>
                                    )}
                                </div>
                            )}
                            {loading && (
                                <p className="text-[11px] text-muted mt-2">Loading episodes from Sonarr…</p>
                            )}
                        </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                        {arr?.deepUrl && (
                            <a
                                href={arr.deepUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-bold text-plex no-underline hover:border-plex/40"
                                onClick={(event) => {
                                    handleArrPortalEmbedAnchorClick(event, {
                                        url: arr.deepUrl,
                                        arrType: 'sonarr',
                                        label: 'Open in Sonarr',
                                    });
                                }}
                            >
                                <ExternalLink className="w-3.5 h-3.5" />
                                Open in Sonarr
                            </a>
                        )}
                        {canSearch && (
                            <button
                                type="button"
                                disabled={searchingKey === 'series'}
                                onClick={() => triggerSearch('series', undefined, `Series search started for “${showMeta.title}”.`)}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-bold text-text hover:border-plex/40 disabled:opacity-50"
                            >
                                {searchingKey === 'series' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                                Series search
                            </button>
                        )}
                    </div>

                    {canChangeProfile && (
                        <div className="rounded-xl border border-border/60 bg-background/40 p-3 space-y-3">
                            <div>
                                <p className="text-xs font-bold text-text">Sonarr quality profile</p>
                                <p className="text-[11px] text-muted mt-0.5">Pick any profile for this series — not limited to your HEVC default.</p>
                            </div>
                            <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
                                {profilesLoading ? (
                                    <div className="flex items-center gap-2 text-xs text-muted py-2">
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        Loading profiles…
                                    </div>
                                ) : profileOptions.length ? (
                                    <CustomSelect
                                        value={selectedProfileId}
                                        onChange={setSelectedProfileId}
                                        options={profileOptions}
                                        className="flex-1 min-w-[200px]"
                                    />
                                ) : (
                                    <p className="text-xs text-amber-200 py-2">Could not load Sonarr quality profiles.</p>
                                )}
                                <button
                                    type="button"
                                    disabled={!canApplyProfile}
                                    onClick={applyProfile}
                                    className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-plex text-background text-xs font-bold hover:bg-plex-hover disabled:opacity-50 shrink-0"
                                >
                                    {applyingProfile ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                                    {applyingProfile ? 'Applying…' : 'Apply profile'}
                                </button>
                            </div>
                            <label className="flex items-start gap-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={triggerSearchOnApply}
                                    onChange={(e) => setTriggerSearchOnApply(e.target.checked)}
                                    className="mt-0.5 rounded border-border"
                                />
                                <span className="text-[11px] text-muted">Trigger series search after profile change</span>
                            </label>
                            {arr?.targetProfileName && arr.targetProfileId && arr.targetProfileId !== arr.currentProfileId && (
                                <button
                                    type="button"
                                    className="text-[11px] font-bold text-green-300 hover:underline"
                                    onClick={() => setSelectedProfileId(String(arr.targetProfileId))}
                                >
                                    Quick pick: {arr.targetProfileName} (Settings HEVC default)
                                </button>
                            )}
                        </div>
                    )}

                    {detailReady && detail?.stats && (
                        <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted">
                            <span>
                                {detail.stats.total} episode{detail.stats.total === 1 ? '' : 's'}
                                {detail.stats.matched !== detail.stats.total
                                    ? ` · ${detail.stats.matched} match current filter`
                                    : ''}
                            </span>
                            <label className="inline-flex items-center gap-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={highlightFilterOnly}
                                    onChange={(e) => setHighlightFilterOnly(e.target.checked)}
                                    className="rounded border-border"
                                />
                                Show filter matches only
                            </label>
                        </div>
                    )}
                </div>

                <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-4 custom-scrollbar">
                    {loading ? (
                        <div className="flex items-center justify-center gap-2 py-16 text-muted">
                            <Loader2 className="w-5 h-5 animate-spin" />
                            Loading show detail…
                        </div>
                    ) : !displaySeasons.length ? (
                        <p className="text-sm text-muted text-center py-16">
                            {detailReady
                                ? (highlightFilterOnly ? 'No episodes match the current browse filter.' : 'No episodes found for this show.')
                                : 'Unable to load episode data.'}
                        </p>
                    ) : (
                        <div className="space-y-3">
                            {displaySeasons.map((season) => {
                                const expanded = expandedSeasons.has(season.seasonNumber);
                                return (
                                    <div key={season.seasonNumber} className="sm:rounded-xl sm:border border-y sm:border-x border-border/60 overflow-hidden bg-white/[0.01]">
                                        <button
                                            type="button"
                                            onClick={() => toggleSeason(season.seasonNumber)}
                                            className="w-full flex items-center justify-between gap-3 px-4 py-3 bg-white/[0.03] hover:bg-white/[0.06] text-left"
                                        >
                                            <div className="flex items-center gap-2">
                                                {expanded ? <ChevronDown className="w-4 h-4 text-muted" /> : <ChevronRight className="w-4 h-4 text-muted" />}
                                                <span className="text-sm font-bold text-text">{formatSeasonLabel(season.seasonNumber)}</span>
                                                <span className="text-[11px] text-muted">
                                                    {season.episodes.length} ep{season.episodes.length === 1 ? '' : 's'}
                                                    {highlightFilterOnly && season.matchedCount !== season.episodeCount
                                                        ? ` · ${season.matchedCount} matched`
                                                        : ''}
                                                </span>
                                            </div>
                                        </button>
                                        {expanded && (
                                            <div className="divide-y divide-border/40">
                                                {season.episodes.map((episode) => {
                                                    const epLabel = episode.seasonNumber != null && episode.episodeNumber != null
                                                        ? `S${String(episode.seasonNumber).padStart(2, '0')}E${String(episode.episodeNumber).padStart(2, '0')}`
                                                        : null;
                                                    const searchKey = episode.arrEpisodeId ? `ep-${episode.arrEpisodeId}` : null;
                                                    const isSearching = searchKey != null && searchingKey === searchKey;
                                                    return (
                                                        <div
                                                            key={episode.ratingKey}
                                                            className={`group flex flex-col sm:flex-row items-start gap-4 p-4 sm:p-5 hover:bg-white/[0.02] transition-colors border-b border-border/40 last:border-0 ${highlightFilterOnly ? '' : episode.matchesPreset === false ? 'opacity-55' : ''}`}
                                                        >
                                                            <div className="w-full sm:w-48 aspect-video rounded-xl overflow-hidden bg-white/5 shrink-0 flex items-center justify-center relative shadow-lg group-hover:shadow-plex/10 transition-all duration-300">
                                                                {episode.thumbUrl || episode.thumb ? (
                                                                    <img
                                                                        src={episode.thumbUrl
                                                                            ? resolvePortalAssetUrl(episode.thumbUrl)
                                                                            : portalUrl(`/api/plex/image?path=${encodeURIComponent(episode.thumb)}&width=384&height=216`)}
                                                                        alt={episode.title}
                                                                        className="w-full h-full object-cover bg-black/40"
                                                                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                                                    />
                                                                ) : (
                                                                    <span className="text-xs text-muted/40 font-medium">No image</span>
                                                                )}
                                                                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                                                            </div>
                                                            <div className="min-w-0 flex-1 flex flex-col justify-center">
                                                                <div className="flex flex-wrap items-center gap-3">
                                                                    {epLabel && (
                                                                        <span className="text-xs font-bold px-2 py-1 rounded-md bg-white/10 text-text shadow-sm">
                                                                            {epLabel}
                                                                        </span>
                                                                    )}
                                                                    <h4 className="text-base font-bold text-text truncate group-hover:text-plex transition-colors">{episode.title}</h4>
                                                                    {episode.airDateUtc && (
                                                                        <span className="text-xs text-muted ml-auto shrink-0 font-medium">
                                                                            {new Date(episode.airDateUtc).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                                {episode.overview && (
                                                                    <p className="text-sm text-muted/90 mt-2 leading-relaxed">
                                                                        {episode.overview}
                                                                    </p>
                                                                )}
                                                                <div className="mt-4 flex flex-wrap items-center gap-3">
                                                                    <EpisodeQualityBadges tags={episode.displayTags || []} isHevc={episode.isHevc} codec={episode.videoCodec} sizeGB={episode.sizeGB} />
                                                                    <div className="text-xs text-muted flex flex-wrap gap-x-3 gap-y-1.5 font-medium bg-black/30 px-3 py-1.5 rounded-lg border border-white/10 shadow-inner">
                                                                        {(episode as any).arrReleaseGroup && (
                                                                            <span className="text-plex font-bold">{(episode as any).arrReleaseGroup}</span>
                                                                        )}
                                                                        {((episode as any).arrCustomFormats || []).map((cf: string) => (
                                                                            <span key={cf} className="text-white/70">{cf}</span>
                                                                        ))}
                                                                        {!(episode as any).arrReleaseGroup && !((episode as any).arrCustomFormats || []).length && episode.arrQualityLabel && (
                                                                            <span>{episode.arrQualityLabel}</span>
                                                                        )}
                                                                        {episode.arrHasFile === false && (
                                                                            <span className="text-amber-200">Missing in Sonarr</span>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                            <div className="flex flex-col justify-start shrink-0 sm:pl-2">
                                                                {canSearch && episode.arrEpisodeId && (
                                                                    <button
                                                                        type="button"
                                                                        disabled={isSearching}
                                                                        onClick={() => triggerSearch(
                                                                            'episode',
                                                                            [episode.arrEpisodeId!],
                                                                            `Episode search started for ${epLabel || episode.title}.`,
                                                                        )}
                                                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-plex/10 text-plex text-xs font-bold hover:bg-plex hover:text-black transition-colors disabled:opacity-50 border border-plex/20"
                                                                    >
                                                                        {isSearching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                                                                        Search
                                                                    </button>
                                                                )}
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
