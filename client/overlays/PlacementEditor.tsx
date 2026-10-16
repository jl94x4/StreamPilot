import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Move, RotateCcw, Save } from 'lucide-react';
import { useDiscoverI18n } from '../discovery/i18n';
import { DashboardPanel } from '../shared/dashboard/DashboardChrome';
import { CustomSelect } from '../shared/ui';
import type { OverlayPlacementKind, OverlaysPlacement } from './api';
import { DEFAULT_OVERLAY_PLACEMENT } from './api';

export type PlacementKind =
    | 'show' | 'season' | 'episode' | 'recently'
    | 'media' | 'status' | 'ratings' | 'network'
    | 'edition' | 'audio_codec' | 'video_format'
    | 'streaming'
    | 'content_rating' | 'ribbon'
    | 'aspect' | 'versions' | 'language_count' | 'languages' | 'runtimes' | 'direct_play' | 'episode_info'
    | 'mediastinger'
    | 'custom_collection';

export type CollectionPlacementRule = {
    id: string;
    name: string;
    image: string;
};

type PresetOption = { value: string; label: string };

type Props = {
    /** Bump (new id + timestamp) to pre-select a target from elsewhere on the page, e.g. a Configure "Position on poster" link. */
    focusTarget?: { id: string; n: number } | null;
    placement: OverlaysPlacement;
    seasonPresetId: string;
    episodePresetId: string;
    recentlyPresetId: string;
    collectionPresetId?: string;
    collectionRules?: CollectionPlacementRule[];
    seasonPresetOptions: PresetOption[];
    episodePresetOptions: PresetOption[];
    recentlyPresetOptions: PresetOption[];
    sampleBust: number;
    busy: boolean;
    onChange: (next: OverlaysPlacement) => void;
    onSeasonPresetChange: (id: string) => void;
    onEpisodePresetChange: (id: string) => void;
    onRecentlyPresetChange: (id: string) => void;
    onSave: () => void;
    onResetKind: (kind: PlacementKind) => void;
};

const buttonClass = 'inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm font-semibold text-text transition-colors hover:bg-white/10 disabled:opacity-50';
const primaryButtonClass = 'inline-flex items-center justify-center gap-2 rounded-xl bg-plex px-3 py-2 text-sm font-bold text-background transition-colors hover:bg-plex-hover disabled:opacity-50';
const fieldInputClass = 'mt-1 w-full appearance-none rounded-lg border border-white/10 bg-black/25 px-2.5 py-2 text-[16px] leading-5 text-text outline-none transition focus:border-plex/50 focus:ring-1 focus:ring-plex/20';
const fieldLabelClass = 'text-[10px] font-bold uppercase tracking-[0.14em] text-muted';

const BANNER_KINDS: PlacementKind[] = ['show', 'season', 'episode', 'recently'];

/** Mirrors the Configure tab's Layer taxonomy (Quality & Format / Availability / Ratings & Reviews / Technical & Language / Bonus Content). */
const KOMETA_GROUPS: { id: string; titleKey: string; kinds: PlacementKind[] }[] = [
    { id: 'quality', titleKey: 'overlays.jobs.kometa.groups.media', kinds: ['media', 'edition', 'audio_codec', 'video_format'] },
    { id: 'availability', titleKey: 'overlays.jobs.kometa.groups.showMeta', kinds: ['status', 'network', 'streaming'] },
    { id: 'ratings', titleKey: 'overlays.jobs.kometa.groups.ratings', kinds: ['ratings', 'content_rating', 'ribbon'] },
    { id: 'technical', titleKey: 'overlays.jobs.kometa.groups.misc', kinds: ['aspect', 'versions', 'language_count', 'languages', 'runtimes', 'direct_play', 'episode_info'] },
    { id: 'bonus', titleKey: 'overlays.jobs.kometa.groups.bonus', kinds: ['mediastinger'] },
];
const CORE_KOMETA_KINDS: PlacementKind[] = KOMETA_GROUPS.flatMap((g) => g.kinds);

/** Families rendered via the real per-family Kometa pipeline (kometa_render.render_winner) —
 * their preview PNG is always `placement-<kind>.png`, generated server-side by
 * ensure_placement_preview_badges(). */
const KOMETA_FAMILY_KINDS = new Set<PlacementKind>(CORE_KOMETA_KINDS);

const collectionTargetId = (ruleId: string) => `cc:${ruleId}`;

const placementKindFromTarget = (targetId: string): PlacementKind => {
    if (String(targetId || '').startsWith('cc:')) return 'custom_collection';
    return targetId as PlacementKind;
};

const kindBaseUrl = (kind: PlacementKind, bust: number) => {
    const sampleKind = kind === 'episode' ? 'episode-base' : 'show-base';
    return `/api/overlays/sample/${sampleKind}?t=${encodeURIComponent(String(bust))}`;
};

const kindBannerUrl = (
    kind: PlacementKind,
    seasonPresetId: string,
    episodePresetId: string,
    recentlyPresetId: string,
    collectionImageId: string,
    bust: number,
) => {
    if (kind === 'custom_collection') {
        const id = collectionImageId || 'placement-custom_collection';
        return `/api/overlays/preset-file?id=${encodeURIComponent(id)}&kind=season&t=${encodeURIComponent(String(bust))}`;
    }
    if (KOMETA_FAMILY_KINDS.has(kind)) {
        return `/api/overlays/preset-file?id=${encodeURIComponent(`placement-${kind}`)}&kind=season&t=${encodeURIComponent(String(bust))}`;
    }
    if (kind === 'recently') {
        return `/api/overlays/preset-file?id=${encodeURIComponent(recentlyPresetId || 'recently-added')}&kind=season&t=${encodeURIComponent(String(bust))}`;
    }
    // Show + season posters share the New Season preset; only episode thumbs use New Episode.
    const id = kind === 'episode' ? episodePresetId : seasonPresetId;
    const presetKind = kind === 'episode' ? 'episode' : 'season';
    return `/api/overlays/preset-file?id=${encodeURIComponent(id)}&kind=${presetKind}&t=${encodeURIComponent(String(bust))}`;
};

/** Mirror worker sizing: width fraction, optional maxHeight clamp, bottom clip. */
function bannerBox(
    artW: number,
    artH: number,
    bannerNatW: number,
    bannerNatH: number,
    p: OverlayPlacementKind,
) {
    let w = artW * Math.max(0.05, Math.min(1, p.width));
    let h = bannerNatW > 0 ? bannerNatH * (w / bannerNatW) : w * 0.25;
    if (typeof p.maxHeight === 'number' && Number.isFinite(p.maxHeight)) {
        const maxH = artH * Math.max(0.05, Math.min(1, p.maxHeight));
        if (h > maxH) {
            w *= maxH / h;
            h = maxH;
        }
    }
    const clip = Math.max(0, Math.min(h - 1, h * Math.max(0, Math.min(0.2, p.bottomClip ?? 0.1))));
    const keepH = Math.max(1, h - clip);
    const ax = p.anchorX || 'center';
    const ay = p.anchorY || 'bottom';
    const anchorX = artW * Math.max(0, Math.min(1, p.x));
    const anchorY = artH * Math.max(0, Math.min(1, p.y));
    const left = ax === 'left' ? anchorX : ax === 'right' ? anchorX - w : anchorX - w / 2;
    const top = ay === 'top' ? anchorY : ay === 'center' ? anchorY - keepH / 2 : anchorY - keepH;
    return { left, top, width: w, height: h, keepH, clip };
}

const CompactField: React.FC<{
    label: string;
    value: number;
    min: number;
    max: number;
    step?: number;
    hint?: string;
    onChange: (n: number) => void;
}> = ({ label, value, min, max, step = 1, hint, onChange }) => (
    <label className="block min-w-0">
        <span className={fieldLabelClass}>{label}</span>
        <input
            type="number"
            min={min}
            max={max}
            step={step}
            className={fieldInputClass}
            value={value}
            onChange={(e) => onChange(Number(e.target.value))}
        />
        {hint ? <span className="mt-1 block text-[10px] leading-snug text-muted">{hint}</span> : null}
    </label>
);

export const PlacementEditor: React.FC<Props> = ({
    focusTarget,
    placement,
    seasonPresetId,
    episodePresetId,
    recentlyPresetId,
    collectionPresetId = '',
    collectionRules = [],
    seasonPresetOptions,
    episodePresetOptions,
    recentlyPresetOptions,
    sampleBust,
    busy,
    onChange,
    onSeasonPresetChange,
    onEpisodePresetChange,
    onRecentlyPresetChange,
    onSave,
    onResetKind,
}) => {
    const { t } = useDiscoverI18n();
    const [targetId, setTargetId] = useState<string>('show');

    // A "Position on poster" link elsewhere on the page asked us to pre-select a target.
    useEffect(() => {
        if (focusTarget?.id) {
            setTargetId(focusTarget.id);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [focusTarget]);

    const [baseFailed, setBaseFailed] = useState(false);
    const [bannerNat, setBannerNat] = useState({ w: 800, h: 200 });
    const stageRef = useRef<HTMLDivElement | null>(null);
    const artRef = useRef<HTMLImageElement | null>(null);
    const [artSize, setArtSize] = useState({ w: 400, h: 600 });
    const dragRef = useRef<{
        mode: 'move' | 'resize';
        startX: number;
        startY: number;
        orig: OverlayPlacementKind;
        artW: number;
        artH: number;
        startBoxW?: number;
        bannerNatW?: number;
        bannerNatH?: number;
    } | null>(null);

    const kind = placementKindFromTarget(targetId);
    const activeCollectionRule = useMemo(() => {
        if (!targetId.startsWith('cc:')) return null;
        const id = targetId.slice(3);
        return collectionRules.find((r) => r.id === id) || null;
    }, [targetId, collectionRules]);

    const collectionTargets = useMemo(() => {
        if (collectionRules.length > 0) {
            return collectionRules.map((rule) => ({
                id: collectionTargetId(rule.id),
                label: rule.name || rule.id,
                image: rule.image,
            }));
        }
        return [{
            id: 'custom_collection',
            label: t('overlays.placement.kinds.custom_collection'),
            image: collectionPresetId || '',
        }];
    }, [collectionRules, collectionPresetId, t]);

    // Keep selection valid when rules are renamed/removed.
    useEffect(() => {
        if (!targetId.startsWith('cc:') && targetId !== 'custom_collection') return;
        const stillValid = collectionTargets.some((c) => c.id === targetId);
        if (!stillValid) {
            setTargetId(collectionTargets[0]?.id || 'show');
        }
    }, [collectionTargets, targetId]);

    const current = placement[kind] || DEFAULT_OVERLAY_PLACEMENT[kind] || DEFAULT_OVERLAY_PLACEMENT.show;
    const collectionImageId = activeCollectionRule?.image
        || (targetId === 'custom_collection' ? collectionPresetId : '')
        || collectionPresetId
        || '';

    const measureArt = useCallback(() => {
        const stage = stageRef.current;
        if (!stage) return;
        const rect = stage.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
            setArtSize({ w: rect.width, h: rect.height });
        }
    }, []);

    useEffect(() => {
        setBaseFailed(false);
        const id = window.setTimeout(measureArt, 50);
        return () => window.clearTimeout(id);
    }, [targetId, sampleBust, collectionImageId, measureArt]);

    useEffect(() => {
        const onResize = () => measureArt();
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, [measureArt]);

    const patchKind = useCallback((partial: Partial<OverlayPlacementKind>) => {
        onChange({
            ...placement,
            [kind]: { ...current, ...partial },
        });
    }, [placement, kind, current, onChange]);

    /** When maxHeight is binding, width alone cannot grow the badge — lift maxHeight too. */
    const patchSizeForWidth = useCallback((width: number) => {
        const nextW = Math.max(0.05, Math.min(1, width));
        const patch: Partial<OverlayPlacementKind> = { width: nextW };
        const maxH = current.maxHeight;
        if (
            typeof maxH === 'number'
            && Number.isFinite(maxH)
            && bannerNat.w > 0
            && artSize.w > 0
            && artSize.h > 0
        ) {
            const hAtWidth = (bannerNat.h / bannerNat.w) * (artSize.w * nextW);
            const allowedH = artSize.h * Math.max(0.05, Math.min(1, maxH));
            if (hAtWidth > allowedH + 0.5) {
                patch.maxHeight = Math.max(0.05, Math.min(1, hAtWidth / artSize.h));
            }
        }
        patchKind(patch);
    }, [artSize.h, artSize.w, bannerNat.h, bannerNat.w, current.maxHeight, patchKind]);

    const onPointerDownMove = (e: React.PointerEvent) => {
        e.preventDefault();
        e.stopPropagation();
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        dragRef.current = {
            mode: 'move',
            startX: e.clientX,
            startY: e.clientY,
            orig: { ...current },
            artW: artSize.w,
            artH: artSize.h,
        };
    };

    const onPointerDownResize = (e: React.PointerEvent) => {
        e.preventDefault();
        e.stopPropagation();
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        const startBox = bannerBox(artSize.w, artSize.h, bannerNat.w, bannerNat.h, current);
        dragRef.current = {
            mode: 'resize',
            startX: e.clientX,
            startY: e.clientY,
            orig: { ...current },
            artW: artSize.w,
            artH: artSize.h,
            startBoxW: startBox.width,
            bannerNatW: bannerNat.w,
            bannerNatH: bannerNat.h,
        };
    };

    useEffect(() => {
        const onMove = (e: PointerEvent) => {
            const drag = dragRef.current;
            if (!drag) return;
            const dx = e.clientX - drag.startX;
            const dy = e.clientY - drag.startY;
            if (drag.mode === 'move') {
                const nx = Math.max(0, Math.min(1, drag.orig.x + dx / drag.artW));
                const ny = Math.max(0, Math.min(1, drag.orig.y + dy / drag.artH));
                patchKind({ x: nx, y: ny });
                return;
            }
            // Size from the visible box so maxHeight cannot swallow the drag.
            const startBoxW = Math.max(1, drag.startBoxW || (drag.artW * (drag.orig.width || 0.2)));
            const desiredW = Math.max(8, startBoxW + dx);
            const natW = Math.max(1, drag.bannerNatW || 1);
            const natH = Math.max(1, drag.bannerNatH || 1);
            const desiredH = desiredW * (natH / natW);
            const nextWidth = Math.max(0.05, Math.min(1, desiredW / drag.artW));
            const patch: Partial<OverlayPlacementKind> = { width: nextWidth };
            if (typeof drag.orig.maxHeight === 'number' && Number.isFinite(drag.orig.maxHeight)) {
                patch.maxHeight = Math.max(0.05, Math.min(1, desiredH / drag.artH));
            }
            patchKind(patch);
        };
        const onUp = () => {
            dragRef.current = null;
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onUp);
        return () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            window.removeEventListener('pointercancel', onUp);
        };
    }, [patchKind]);

    const box = bannerBox(artSize.w, artSize.h, bannerNat.w, bannerNat.h, current);
    const stageAspectClass = kind === 'episode' ? 'aspect-video' : 'aspect-[2/3]';
    const showBottomClip = BANNER_KINDS.includes(kind);

    const kindLabel = useCallback((k: PlacementKind) => t(`overlays.placement.kinds.${k}`), [t]);

    const targetLabel = useCallback((id: string) => {
        if (id.startsWith('cc:') || id === 'custom_collection') {
            const hit = collectionTargets.find((c) => c.id === id);
            return hit?.label || kindLabel('custom_collection');
        }
        return kindLabel(id as PlacementKind);
    }, [collectionTargets, kindLabel]);

    const presetControls = useMemo(() => {
        if (kind === 'show' || kind === 'season') {
            return {
                label: t('overlays.placement.presetHint'),
                value: seasonPresetId,
                options: seasonPresetOptions,
                onChange: onSeasonPresetChange,
            };
        }
        if (kind === 'episode') {
            return {
                label: t('overlays.placement.presetHint'),
                value: episodePresetId,
                options: episodePresetOptions,
                onChange: onEpisodePresetChange,
            };
        }
        if (kind === 'recently') {
            return {
                label: t('overlays.placement.presetHint'),
                value: recentlyPresetId,
                options: recentlyPresetOptions,
                onChange: onRecentlyPresetChange,
            };
        }
        return null;
    }, [
        kind,
        t,
        seasonPresetId,
        seasonPresetOptions,
        onSeasonPresetChange,
        episodePresetId,
        episodePresetOptions,
        onEpisodePresetChange,
        recentlyPresetId,
        recentlyPresetOptions,
        onRecentlyPresetChange,
    ]);

    const bannerSrc = kindBannerUrl(
        kind,
        seasonPresetId,
        episodePresetId,
        recentlyPresetId,
        collectionImageId,
        sampleBust,
    );

    const renderTargetButton = (id: string, label: string) => {
        const active = targetId === id;
        return (
            <button
                key={id}
                type="button"
                onClick={() => setTargetId(id)}
                className={`w-full rounded-lg px-2.5 py-2 text-left text-xs font-semibold transition-colors ${
                    active
                        ? 'bg-plex text-background shadow-sm shadow-plex/20'
                        : 'text-text/85 hover:bg-white/5 hover:text-text'
                }`}
            >
                {label}
            </button>
        );
    };

    const mobileOptions = useMemo(() => ([
        ...BANNER_KINDS.map((k) => ({
            value: k,
            label: `${t('overlays.placement.groupBanners')}: ${kindLabel(k)}`,
        })),
        ...KOMETA_GROUPS.flatMap((group) => group.kinds.map((k) => ({
            value: k,
            label: `${t(group.titleKey)}: ${kindLabel(k)}`,
        }))),
        ...collectionTargets.map((c) => ({
            value: c.id,
            label: `${t('overlays.placement.groupCollections')}: ${c.label}`,
        })),
    ]), [t, kindLabel, collectionTargets]);

    return (
        <DashboardPanel
            title={t('overlays.placement.title')}
            subtitle={t('overlays.placement.subtitle')}
            controls={(
                <div className="flex flex-wrap items-center gap-2">
                    <button type="button" className={buttonClass} disabled={busy} onClick={() => onResetKind(kind)}>
                        <RotateCcw className="h-4 w-4" />
                        {t('overlays.placement.resetKind')}
                    </button>
                    <button type="button" className={primaryButtonClass} disabled={busy} onClick={onSave}>
                        <Save className="h-4 w-4" />
                        {t('overlays.placement.save')}
                    </button>
                </div>
            )}
        >
            <div className="grid gap-4 lg:grid-cols-[240px_minmax(200px,280px)_minmax(0,1fr)]">
                <aside className="min-w-0">
                    <div className="lg:hidden">
                        <span className={fieldLabelClass}>{t('overlays.placement.target')}</span>
                        <CustomSelect
                            className="mt-1"
                            value={targetId}
                            onChange={setTargetId}
                            options={mobileOptions}
                        />
                    </div>
                    <div className="hidden rounded-xl border border-white/10 bg-black/20 p-2 lg:block">
                        <p className={`${fieldLabelClass} px-2.5 pb-1.5 pt-1`}>{t('overlays.placement.groupBanners')}</p>
                        <div className="flex flex-col">
                            {BANNER_KINDS.map((k) => renderTargetButton(k, kindLabel(k)))}
                        </div>
                        {KOMETA_GROUPS.map((group) => (
                            <React.Fragment key={group.id}>
                                <div className="my-2 border-t border-white/10" />
                                <p className={`${fieldLabelClass} px-2.5 pb-1.5 pt-1`}>{t(group.titleKey)}</p>
                                <div className="flex flex-col">
                                    {group.kinds.map((k) => renderTargetButton(k, kindLabel(k)))}
                                </div>
                            </React.Fragment>
                        ))}
                        <div className="my-2 border-t border-white/10" />
                        <p className={`${fieldLabelClass} px-2.5 pb-1.5 pt-1`}>{t('overlays.placement.groupCollections')}</p>
                        <div className="flex flex-col">
                            {collectionTargets.map((c) => renderTargetButton(c.id, c.label))}
                        </div>
                        {collectionRules.length === 0 ? (
                            <p className="mt-1 px-2.5 text-[10px] leading-snug text-muted">
                                {t('overlays.placement.collectionRulesHint')}
                            </p>
                        ) : null}
                    </div>
                </aside>

                <div className="min-w-0">
                    <div
                        ref={stageRef}
                        className={`relative w-full overflow-hidden rounded-xl border border-white/10 bg-black/50 shadow-lg ${
                            kind === 'episode' ? 'max-w-md' : 'max-w-[280px]'
                        } ${stageAspectClass}`}
                    >
                        {!baseFailed ? (
                            <img
                                ref={artRef}
                                src={kindBaseUrl(kind, sampleBust)}
                                alt=""
                                className="absolute inset-0 h-full w-full object-cover"
                                onLoad={measureArt}
                                onError={() => setBaseFailed(true)}
                            />
                        ) : (
                            <div className="flex h-full items-center justify-center p-4 text-center text-xs text-muted">
                                {t('overlays.placement.needSample')}
                            </div>
                        )}
                        {!baseFailed && (
                            <div
                                className="absolute z-10 cursor-move"
                                style={{
                                    left: box.left,
                                    top: box.top,
                                    width: box.width,
                                    height: box.keepH,
                                    overflow: 'hidden',
                                }}
                                onPointerDown={onPointerDownMove}
                                title={t('overlays.placement.dragHint')}
                            >
                                <img
                                    src={bannerSrc}
                                    alt=""
                                    className="pointer-events-none block max-w-none"
                                    style={{
                                        width: box.width,
                                        height: box.height,
                                        marginTop: 0,
                                    }}
                                    onLoad={(e) => {
                                        const img = e.currentTarget;
                                        if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                                            setBannerNat({ w: img.naturalWidth, h: img.naturalHeight });
                                        }
                                    }}
                                />
                                <div
                                    className="pointer-events-none absolute inset-0"
                                    style={{ boxShadow: 'inset 0 0 0 2px rgba(229, 160, 13, 0.85)' }}
                                />
                                <div
                                    className="absolute bottom-0 right-0 z-10 h-3.5 w-3.5 cursor-se-resize rounded-sm border border-background/80 bg-plex shadow"
                                    onPointerDown={onPointerDownResize}
                                    title={t('overlays.placement.resize')}
                                />
                                <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/40 p-1 opacity-80">
                                    <Move className="h-3.5 w-3.5 text-white" />
                                </div>
                            </div>
                        )}
                    </div>
                    <p className="mt-2 max-w-[280px] text-[11px] leading-snug text-muted">
                        {t('overlays.placement.outlineHint')}
                    </p>
                </div>

                <div className="min-w-0 space-y-4 rounded-xl border border-white/10 bg-black/20 p-3 sm:p-4">
                    <div>
                        <p className="text-sm font-bold text-text">{targetLabel(targetId)}</p>
                        <p className="mt-0.5 text-[11px] text-muted">
                            {kind === 'custom_collection'
                                ? t('overlays.placement.collectionSharedHint')
                                : t('overlays.placement.hint')}
                        </p>
                    </div>

                    {presetControls && (
                        <div>
                            <span className={fieldLabelClass}>{presetControls.label}</span>
                            <CustomSelect
                                className="mt-1"
                                value={presetControls.value}
                                onChange={presetControls.onChange}
                                options={presetControls.options}
                            />
                            <span className="mt-1 block text-[10px] text-muted">{t('overlays.placement.presetHint')}</span>
                        </div>
                    )}

                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 xl:grid-cols-2">
                        <CompactField
                            label={t('overlays.placement.width')}
                            value={Math.round((current.width || 0.5) * 100)}
                            min={5}
                            max={100}
                            onChange={(n) => patchSizeForWidth((Number.isFinite(n) ? n : 50) / 100)}
                        />
                        <CompactField
                            label={t('overlays.placement.maxHeight')}
                            value={Math.round((current.maxHeight ?? 0.22) * 100)}
                            min={5}
                            max={100}
                            onChange={(n) => patchKind({
                                maxHeight: Math.max(0.05, Math.min(1, (Number.isFinite(n) ? n : 22) / 100)),
                            })}
                        />
                        <CompactField
                            label={t('overlays.placement.x')}
                            value={Math.round((current.x || 0) * 100)}
                            min={0}
                            max={100}
                            onChange={(n) => patchKind({ x: Math.max(0, Math.min(1, (Number.isFinite(n) ? n : 0) / 100)) })}
                        />
                        <CompactField
                            label={t('overlays.placement.y')}
                            value={Math.round((current.y || 0) * 100)}
                            min={0}
                            max={100}
                            onChange={(n) => patchKind({ y: Math.max(0, Math.min(1, (Number.isFinite(n) ? n : 0) / 100)) })}
                        />
                        {showBottomClip && (
                            <CompactField
                                label={t('overlays.placement.bottomClip')}
                                value={Math.round((current.bottomClip ?? 0.1) * 100)}
                                min={0}
                                max={20}
                                onChange={(n) => patchKind({
                                    bottomClip: Math.max(0, Math.min(0.2, (Number.isFinite(n) ? n : 0) / 100)),
                                })}
                            />
                        )}
                    </div>

                    <div className="flex flex-wrap gap-2 border-t border-white/10 pt-3 lg:hidden">
                        <button type="button" className={buttonClass} disabled={busy} onClick={() => onResetKind(kind)}>
                            <RotateCcw className="h-4 w-4" />
                            {t('overlays.placement.resetKind')}
                        </button>
                        <button type="button" className={primaryButtonClass} disabled={busy} onClick={onSave}>
                            <Save className="h-4 w-4" />
                            {t('overlays.placement.save')}
                        </button>
                    </div>
                </div>
            </div>
        </DashboardPanel>
    );
};
