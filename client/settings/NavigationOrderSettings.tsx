import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Eye, EyeOff, GripVertical, MoreHorizontal, Shield, Users } from 'lucide-react';
import {
    ALWAYS_VISIBLE_MEMBER_NAV_KEYS,
    ALWAYS_VISIBLE_NAV_KEYS,
    getNavItemLabel,
    MOBILE_NAV_PRIMARY_SLOTS,
    normalizeMemberNavHiddenKeys,
    normalizeNavHiddenKeys,
} from '../shared/nav';
import { customNavTabKey, getCustomNavTabLabel } from '../shared/customNavTabs';
import { isNativeNavIconKey, upsertNavItemIcon, type NavItemIconsMap } from '../shared/navItemIcons';
import type { CustomNavDisplay, CustomNavTab } from '../shared/types';
import { useDiscoverI18n } from '../discovery/i18n';
import { SettingsToggleRow } from '../shared/ui';
import { SettingHint } from './SettingHint';
import { BetaBadge } from '../shared/BetaBadge';
import { AppletNavIconPreview, NavItemIconPanel, NavItemIconTrigger } from './NavItemIconEditor';

type NavFeatureStatus = {
    upgrader?: boolean;
    collexions?: boolean;
    scanner?: boolean;
    mediaAutomation?: boolean;
    posterSets?: boolean;
    overlays?: boolean;
    editions?: boolean;
    watchSync?: boolean;
    achievements?: boolean;
    support?: boolean;
    chat?: boolean;
    maintenance?: boolean;
};

type Props = {
    navOrder: string[];
    onChange: (next: string[]) => void;
    navHiddenKeys: string[];
    onHiddenKeysChange: (next: string[]) => void;
    memberNavOrder: string[];
    onMemberNavOrderChange: (next: string[]) => void;
    memberNavHiddenKeys: string[];
    onMemberNavHiddenKeysChange: (next: string[]) => void;
    downloadsVisibleToMembers: boolean;
    onDownloadsVisibleToMembersChange: (next: boolean) => void;
    /** When false, sidebar still hides these until enabled in their Settings section. */
    featureStatus?: NavFeatureStatus;
    customNavTabs?: CustomNavTab[];
    customNavDisplay?: CustomNavDisplay;
    navItemIcons?: NavItemIconsMap;
    onNavItemIconsChange?: (next: NavItemIconsMap) => void;
};

const FEATURE_OFF_SECTIONS: Record<string, string> = {
    upgrader: 'settings.navigation.tabs.upgrader',
    collexions: 'settings.navigation.tabs.collexions',
    scanner: 'settings.navigation.tabs.scanner',
    'media-automation': 'settings.navigation.tabs.mediaAutomation',
    'poster-sets': 'settings.navigation.tabs.posterSets',
    overlays: 'settings.navigation.tabs.overlays',
    editions: 'settings.navigation.tabs.editions',
    'watch-sync': 'settings.navigation.tabs.watchSync',
    achievements: 'settings.navigation.tabs.achievements',
    support: 'settings.navigation.tabs.system',
    chat: 'settings.navigation.tabs.system',
    maintenance: 'settings.navigation.tabs.cleaner',
};

const NAV_ITEM_TRANSLATION_KEYS: Record<string, string> = {
    home: 'navigation.home', discover: 'navigation.dashboard',     request: 'navigation.discoverRequest',
    'media-player': 'navigation.mediaPlayer',
    analytics: 'navigation.analytics', achievements: 'navigation.achievements', chat: 'navigation.chat', support: 'navigation.support',
    users: 'navigation.users', downloads: 'navigation.downloads', upgrader: 'navigation.upgrader',
    collexions: 'navigation.collexions', scanner: 'navigation.scanner', 'media-automation': 'navigation.mediaAutomation',
    'poster-sets': 'navigation.posterSets', overlays: 'navigation.overlays', editions: 'navigation.editions',
    'watch-sync': 'navigation.watchSync',
    mediastack: 'navigation.calendar', status: 'navigation.status',
    maintenance: 'navigation.cleaner', about: 'navigation.about', preferences: 'navigation.preferences',
    settings: 'navigation.settings', logs: 'navigation.logs', logout: 'navigation.logout',
};

const reorder = (items: string[], from: number, to: number): string[] => {
    if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return items;
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    return next;
};

/** Keys that never appear in the mobile bottom bar / More menu. */
const isMobileNavKey = (key: string) => key !== 'logout' && key !== 'logs';

const vibrate = (pattern: number | number[]) => {
    try {
        if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
            navigator.vibrate(pattern);
        }
    } catch {
        /* ignore unsupported / blocked vibration */
    }
};

type ColumnProps = {
    title: string;
    subtitle: string;
    icon: React.ReactNode;
    accentClass: string;
    navOrder: string[];
    onChange: (next: string[]) => void;
    navHiddenKeys: string[];
    onHiddenKeysChange: (next: string[]) => void;
    alwaysVisibleKeys: Set<string>;
    normalizeHidden: (keys: string[]) => string[];
    downloadsVisibleToMembers: boolean;
    showAdminSuffix: boolean;
    featureStatus?: NavFeatureStatus;
    downloadsMembersNote?: string | null;
    translate: (key: string, vars?: Record<string, unknown>) => string;
    labelForKey: (key: string, options?: { adminSuffix?: boolean; downloadsMembersVisible?: boolean }) => string;
    navItemIcons?: NavItemIconsMap;
    onNavItemIconsChange?: (next: NavItemIconsMap) => void;
    allowIconEdit?: boolean;
    customNavTabs?: CustomNavTab[];
};

const NavOrderColumn: React.FC<ColumnProps> = ({
    title,
    subtitle,
    icon,
    accentClass,
    navOrder,
    onChange,
    navHiddenKeys,
    onHiddenKeysChange,
    alwaysVisibleKeys,
    normalizeHidden,
    downloadsVisibleToMembers,
    showAdminSuffix,
    featureStatus,
    downloadsMembersNote,
    translate,
    labelForKey,
    navItemIcons = {},
    onNavItemIconsChange,
    allowIconEdit = false,
    customNavTabs = [],
}) => {
    const [iconEditorKey, setIconEditorKey] = useState<string | null>(null);
    const [dragIndex, setDragIndex] = useState<number | null>(null);
    const [dropIndex, setDropIndex] = useState<number | null>(null);
    const [dragPoint, setDragPoint] = useState<{ x: number; y: number } | null>(null);
    const dragIndexRef = useRef<number | null>(null);
    const dropIndexRef = useRef<number | null>(null);
    const itemRefs = useRef<Array<HTMLDivElement | null>>([]);

    const hiddenSet = useMemo(() => new Set(normalizeHidden(navHiddenKeys)), [navHiddenKeys, normalizeHidden]);
    const customTabByKey = useMemo(
        () => new Map((customNavTabs || []).map((tab) => [customNavTabKey(tab.id), tab])),
        [customNavTabs],
    );
    const mobileKeys = useMemo(() => navOrder.filter(isMobileNavKey), [navOrder]);
    const moreStartsAtMobileIndex = mobileKeys.length > MOBILE_NAV_PRIMARY_SLOTS
        ? MOBILE_NAV_PRIMARY_SLOTS
        : null;

    const mobileIndexByKey = useMemo(() => {
        const map = new Map<string, number>();
        mobileKeys.forEach((key, index) => map.set(key, index));
        return map;
    }, [mobileKeys]);

    const commitReorder = (from: number, to: number, { haptic = false } = {}) => {
        if (from === to) return;
        onChange(reorder(navOrder, from, to));
        if (haptic) vibrate(18);
    };

    const toggleHidden = (key: string) => {
        if (alwaysVisibleKeys.has(key)) return;
        const next = new Set(hiddenSet);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        onHiddenKeysChange(normalizeHidden([...next]));
        vibrate(10);
    };

    const indexFromClientY = (clientY: number) => {
        let nextIndex = navOrder.length - 1;
        for (let i = 0; i < itemRefs.current.length; i += 1) {
            const node = itemRefs.current[i];
            if (!node) continue;
            const rect = node.getBoundingClientRect();
            if (clientY < rect.top + rect.height / 2) {
                nextIndex = i;
                break;
            }
        }
        return Math.max(0, Math.min(navOrder.length - 1, nextIndex));
    };

    const clearDragState = () => {
        dragIndexRef.current = null;
        dropIndexRef.current = null;
        setDragIndex(null);
        setDropIndex(null);
        setDragPoint(null);
    };

    const handlePointerDown = (event: React.PointerEvent<HTMLButtonElement>, index: number) => {
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        dragIndexRef.current = index;
        dropIndexRef.current = index;
        setDragIndex(index);
        setDropIndex(index);
        setDragPoint({ x: event.clientX, y: event.clientY });
        vibrate(12);
    };

    const handlePointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
        if (dragIndexRef.current === null) return;
        setDragPoint({ x: event.clientX, y: event.clientY });
        const nextDrop = indexFromClientY(event.clientY);
        if (dropIndexRef.current !== nextDrop) {
            dropIndexRef.current = nextDrop;
            setDropIndex(nextDrop);
            vibrate(8);
        }
    };

    const handlePointerUp = (event: React.PointerEvent<HTMLButtonElement>) => {
        if (dragIndexRef.current === null) return;
        try {
            event.currentTarget.releasePointerCapture(event.pointerId);
        } catch {
            /* already released */
        }
        const from = dragIndexRef.current;
        const to = dropIndexRef.current ?? from;
        clearDragState();
        if (from !== to) {
            vibrate([10, 30, 16]);
            commitReorder(from, to);
        } else {
            vibrate(6);
        }
    };

    const handlePointerCancel = () => {
        clearDragState();
        vibrate(6);
    };

    const draggingKey = dragIndex != null ? navOrder[dragIndex] : null;

    return (
        <div className="min-w-0 rounded-2xl border border-border/70 bg-background/20 p-4">
            <div className="mb-4 flex items-start gap-3">
                <div className={`mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${accentClass}`}>
                    {icon}
                </div>
                <div className="min-w-0">
                    <h4 className="text-base font-bold text-text">{title}</h4>
                    <p className="mt-1 text-xs leading-relaxed text-muted">{subtitle}</p>
                    {downloadsMembersNote ? (
                        <p className="mt-2 text-[11px] font-semibold text-yellow-300/90">{downloadsMembersNote}</p>
                    ) : null}
                </div>
            </div>

            <div className={`relative flex flex-col gap-2 select-none ${dragIndex !== null ? 'cursor-grabbing' : ''}`}>
                {navOrder.map((key, index) => {
                    const mobileIndex = mobileIndexByKey.get(key);
                    const inMobileBar = mobileIndex !== undefined
                        && (moreStartsAtMobileIndex === null || mobileIndex < moreStartsAtMobileIndex);
                    const inMoreMenu = mobileIndex !== undefined
                        && moreStartsAtMobileIndex !== null
                        && mobileIndex >= moreStartsAtMobileIndex;
                    const showMoreDivider = moreStartsAtMobileIndex !== null
                        && mobileIndex === moreStartsAtMobileIndex;
                    const isAlwaysVisible = alwaysVisibleKeys.has(key);
                    const isHidden = hiddenSet.has(key);
                    const featureOffHint = (() => {
                        let sectionKey: string | null = null;
                        if (key === 'upgrader' && featureStatus?.upgrader === false) sectionKey = FEATURE_OFF_SECTIONS.upgrader;
                        if (key === 'collexions' && featureStatus?.collexions === false) sectionKey = FEATURE_OFF_SECTIONS.collexions;
                        if (key === 'scanner' && featureStatus?.scanner === false) sectionKey = FEATURE_OFF_SECTIONS.scanner;
                        if (key === 'media-automation' && featureStatus?.mediaAutomation === false) sectionKey = FEATURE_OFF_SECTIONS['media-automation'];
                        if (key === 'poster-sets' && featureStatus?.posterSets === false) sectionKey = FEATURE_OFF_SECTIONS['poster-sets'];
                        if (key === 'overlays' && featureStatus?.overlays === false) sectionKey = FEATURE_OFF_SECTIONS.overlays;
                        if (key === 'editions' && featureStatus?.editions === false) sectionKey = FEATURE_OFF_SECTIONS.editions;
                        if (key === 'watch-sync' && featureStatus?.watchSync === false) sectionKey = FEATURE_OFF_SECTIONS['watch-sync'];
                        if (key === 'achievements' && featureStatus?.achievements === false) sectionKey = FEATURE_OFF_SECTIONS.achievements;
                        if (key === 'support' && featureStatus?.support === false) sectionKey = FEATURE_OFF_SECTIONS.support;
                        if (key === 'chat' && !featureStatus?.chat) sectionKey = FEATURE_OFF_SECTIONS.chat;
                        if (key === 'maintenance' && featureStatus?.maintenance === false) sectionKey = FEATURE_OFF_SECTIONS.maintenance;
                        return sectionKey ? translate('settings.navigation.order.featureOff', { section: translate(sectionKey) }) : null;
                    })();

                    const isDragging = dragIndex === index;
                    const isDropTarget = dropIndex === index && dragIndex !== null && dragIndex !== index;
                    const insertBefore = isDropTarget && dragIndex !== null && dropIndex < dragIndex;
                    const insertAfter = isDropTarget && dragIndex !== null && dropIndex > dragIndex;
                    const customTab = customTabByKey.get(key);

                    return (
                        <React.Fragment key={key}>
                            {showMoreDivider && (
                                <div className="flex items-center gap-3 pt-3 pb-1">
                                    <div className="h-px flex-1 bg-border/70" />
                                    <span className="inline-flex shrink-0 items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-muted">
                                        <MoreHorizontal className="h-3.5 w-3.5" />
                                        {translate('settings.navigation.order.mobileMoreMenu')}
                                    </span>
                                    <div className="h-px flex-1 bg-border/70" />
                                </div>
                            )}

                            <div
                                ref={(node) => { itemRefs.current[index] = node; }}
                                data-nav-order-index={index}
                                className={`relative flex flex-col gap-3 rounded-xl border bg-background/30 px-3 py-3 transition-[transform,box-shadow,opacity,border-color,background-color] duration-150
                                    ${isDragging ? 'scale-[0.985] border-plex/50 bg-plex/5 opacity-40 shadow-inner' : 'border-border/40'}
                                    ${isDropTarget ? 'border-plex bg-plex/10 ring-2 ring-plex/35' : ''}
                                    ${inMoreMenu && !isDropTarget ? 'border-dashed border-border/50 bg-white/[0.02]' : ''}
                                    ${isHidden && !isDropTarget ? 'border-dashed border-border/50 opacity-55' : ''}
                                    ${!isMobileNavKey(key) ? 'opacity-70' : ''}`}
                            >
                                <div className="flex items-center gap-2 sm:gap-3">
                                {insertBefore && (
                                    <div className="pointer-events-none absolute -top-1.5 left-3 right-3 h-1 rounded-full bg-plex shadow-[0_0_12px_rgba(229,160,13,0.55)]" />
                                )}
                                {insertAfter && (
                                    <div className="pointer-events-none absolute -bottom-1.5 left-3 right-3 h-1 rounded-full bg-plex shadow-[0_0_12px_rgba(229,160,13,0.55)]" />
                                )}

                                <button
                                    type="button"
                                    aria-label={translate('settings.navigation.order.dragToReorder', { label: labelForKey(key) })}
                                    onPointerDown={(e) => handlePointerDown(e, index)}
                                    onPointerMove={handlePointerMove}
                                    onPointerUp={handlePointerUp}
                                    onPointerCancel={handlePointerCancel}
                                    className={`-ml-1 shrink-0 touch-none rounded-lg p-1.5 transition-colors cursor-grab active:cursor-grabbing
                                        ${isDragging ? 'bg-plex/15 text-plex' : 'text-muted hover:bg-white/5 hover:text-text active:scale-95 active:bg-white/10'}`}
                                >
                                    <GripVertical className="h-5 w-5" aria-hidden />
                                </button>

                                {isNativeNavIconKey(key) ? (
                                    <NavItemIconTrigger
                                        navKey={key}
                                        mark={navItemIcons[key]}
                                        expanded={iconEditorKey === key}
                                        editable={allowIconEdit}
                                        label={labelForKey(key)}
                                        translate={translate}
                                        onToggle={() => setIconEditorKey((current) => (current === key ? null : key))}
                                    />
                                ) : customTab ? (
                                    <AppletNavIconPreview
                                        tab={customTab}
                                        label={labelForKey(key)}
                                        translate={translate}
                                    />
                                ) : null}

                                <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-1.5 font-medium text-text">
                                        <span>{labelForKey(key, {
                                            adminSuffix: showAdminSuffix,
                                            downloadsMembersVisible: downloadsVisibleToMembers,
                                        })}</span>
                                        {key === 'poster-sets' ? (
                                            <BetaBadge title={translate('posterSetsPage.betaNotice')} className="scale-90" />
                                        ) : key === 'media-player' ? (
                                            <BetaBadge title={translate('mediaPlayerPage.betaNotice')} className="scale-90" />
                                        ) : null}
                                    </div>
                                    {isHidden ? (
                                        <p className="mt-0.5 text-[11px] text-yellow-300/90">{translate('settings.navigation.order.hidden')}</p>
                                    ) : featureOffHint ? (
                                        <p className="mt-0.5 text-[11px] text-yellow-300/90">{featureOffHint}</p>
                                    ) : !isMobileNavKey(key) ? (
                                        <p className="mt-0.5 text-[11px] text-muted">{translate('settings.navigation.order.notInMobileBar')}</p>
                                    ) : null}
                                </div>

                                <div className="flex shrink-0 items-center gap-1">
                                    {inMobileBar && moreStartsAtMobileIndex !== null && !isHidden && (
                                        <span className="hidden rounded-md border border-plex/25 bg-plex/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-plex/90 lg:inline">
                                            {translate('settings.navigation.order.mobileBar')}
                                        </span>
                                    )}
                                    {inMoreMenu && !isHidden && (
                                        <span className="hidden rounded-md border border-border/60 bg-white/5 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-muted lg:inline">
                                            {translate('settings.navigation.order.more')}
                                        </span>
                                    )}
                                    <button
                                        type="button"
                                        aria-label={
                                            isAlwaysVisible
                                                ? translate('settings.navigation.order.cannotHide', { label: labelForKey(key) })
                                                : (isHidden
                                                    ? translate('settings.navigation.order.showItem', { label: labelForKey(key) })
                                                    : translate('settings.navigation.order.hideItem', { label: labelForKey(key) }))
                                        }
                                        title={
                                            isAlwaysVisible
                                                ? translate('settings.navigation.order.alwaysVisible')
                                                : (isHidden
                                                    ? translate('settings.navigation.order.showInNavigation')
                                                    : translate('settings.navigation.order.hideFromNavigation'))
                                        }
                                        disabled={isAlwaysVisible}
                                        onClick={() => toggleHidden(key)}
                                        className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border transition-colors
                                            ${isAlwaysVisible
                                                ? 'cursor-not-allowed border-border/40 bg-white/[0.02] text-muted/40'
                                                : isHidden
                                                    ? 'border-yellow-500/35 bg-yellow-500/10 text-yellow-300 hover:bg-yellow-500/15'
                                                    : 'border-border/60 bg-white/[0.03] text-muted hover:border-plex/40 hover:text-text active:scale-90'}`}
                                    >
                                        {isHidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                    </button>
                                    <button
                                        type="button"
                                        aria-label={translate('settings.navigation.order.moveUp', { label: labelForKey(key) })}
                                        disabled={index === 0}
                                        onClick={() => commitReorder(index, index - 1, { haptic: true })}
                                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border/60 bg-white/[0.03] text-muted transition-transform hover:border-plex/40 hover:text-text active:scale-90 active:bg-plex/15 disabled:pointer-events-none disabled:opacity-30"
                                    >
                                        <ChevronUp className="h-4 w-4" />
                                    </button>
                                    <button
                                        type="button"
                                        aria-label={translate('settings.navigation.order.moveDown', { label: labelForKey(key) })}
                                        disabled={index === navOrder.length - 1}
                                        onClick={() => commitReorder(index, index + 1, { haptic: true })}
                                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border/60 bg-white/[0.03] text-muted transition-transform hover:border-plex/40 hover:text-text active:scale-90 active:bg-plex/15 disabled:pointer-events-none disabled:opacity-30"
                                    >
                                        <ChevronDown className="h-4 w-4" />
                                    </button>
                                </div>
                                </div>
                                {allowIconEdit && iconEditorKey === key && isNativeNavIconKey(key) && onNavItemIconsChange ? (
                                    <NavItemIconPanel
                                        navKey={key}
                                        mark={navItemIcons[key]}
                                        translate={translate}
                                        onChange={(patch) => onNavItemIconsChange(upsertNavItemIcon(navItemIcons, key, patch))}
                                        onReset={() => {
                                            const next = { ...navItemIcons };
                                            delete next[key];
                                            onNavItemIconsChange(next);
                                        }}
                                    />
                                ) : null}
                            </div>
                        </React.Fragment>
                    );
                })}

                {draggingKey && dragPoint && (
                    <div
                        className="pointer-events-none fixed z-[80] w-[min(22rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-plex/50 bg-card/95 px-3 py-3 shadow-2xl shadow-black/40 ring-1 ring-plex/30 backdrop-blur-md"
                        style={{ left: dragPoint.x, top: dragPoint.y }}
                        aria-hidden
                    >
                        <div className="flex items-center gap-3">
                            <GripVertical className="h-5 w-5 shrink-0 text-plex" />
                            <p className="truncate text-sm font-bold text-text">
                                {labelForKey(draggingKey, {
                                    adminSuffix: showAdminSuffix,
                                    downloadsMembersVisible: downloadsVisibleToMembers,
                                })}
                            </p>
                        </div>
                    </div>
                )}
            </div>

            {moreStartsAtMobileIndex === null ? (
                <p className="mt-4 text-xs text-muted">
                    {translate('settings.navigation.order.allFit')}
                </p>
            ) : (
                <p className="mt-4 text-xs text-muted">
                    {translate('settings.navigation.order.itemsInMore')}
                </p>
            )}
        </div>
    );
};

export const NavigationOrderSettings: React.FC<Props> = ({
    navOrder,
    onChange,
    navHiddenKeys,
    onHiddenKeysChange,
    memberNavOrder,
    onMemberNavOrderChange,
    memberNavHiddenKeys,
    onMemberNavHiddenKeysChange,
    downloadsVisibleToMembers,
    onDownloadsVisibleToMembersChange,
    featureStatus,
    customNavTabs = [],
    customNavDisplay = 'links',
    navItemIcons = {},
    onNavItemIconsChange,
}) => {
    const { t } = useDiscoverI18n();
    const normalizeAdminHidden = useCallback(
        (keys: string[]) => normalizeNavHiddenKeys(keys, customNavTabs),
        [customNavTabs],
    );
    const normalizeMemberHidden = useCallback(
        (keys: string[]) => normalizeMemberNavHiddenKeys(keys, customNavTabs),
        [customNavTabs],
    );
    const labelForKey = (key: string, options?: { adminSuffix?: boolean; downloadsMembersVisible?: boolean }) => {
        if (key.startsWith('custom:')) {
            const label = getCustomNavTabLabel(key, customNavTabs);
            const tab = customNavTabs.find((entry) => `custom:${entry.id}` === key);
            if (options?.adminSuffix && tab?.adminOnly) {
                return t('settings.navigation.order.adminOnlyLabel', { label });
            }
            return label;
        }
        const baseKey = NAV_ITEM_TRANSLATION_KEYS[key];
        const base = baseKey ? t(baseKey) : getNavItemLabel(key);
        return getNavItemLabel(key, options) !== getNavItemLabel(key)
            ? t('settings.navigation.order.adminOnlyLabel', { label: base })
            : base;
    };

    return (
    <div className="mb-8 animate-fade-in">
        <h3 className="mb-4 border-b border-border pb-2 text-xl font-bold text-plex">{t('settings.navigation.order.title')}</h3>
        <p className="mb-2 max-w-3xl text-sm text-muted">
            {t('settings.navigation.order.description')}{' '}
            {t('settings.navigation.order.mobileSlots', { count: MOBILE_NAV_PRIMARY_SLOTS })}
        </p>
        <p className="mb-2 max-w-3xl text-xs text-muted">
            {t('settings.navigation.order.audienceHint')}
        </p>
        <p className="mb-4 max-w-3xl text-xs text-muted">
            {t('settings.navigation.order.iconHint')}
        </p>
        {customNavDisplay === 'applets' ? (
            <p className="mb-4 max-w-3xl text-xs text-muted">
                {t('settings.navigation.order.appletsOrderHint')}
            </p>
        ) : null}

        <div className="mb-6 max-w-xl rounded-xl border border-border/70 bg-background/30 p-4">
            <SettingsToggleRow
                title={t('settings.navigation.order.showDownloads')}
                hint={(
                    <SettingHint>
                        {t('settings.navigation.order.downloadsHint')}
                    </SettingHint>
                )}
                checked={downloadsVisibleToMembers}
                onChange={onDownloadsVisibleToMembersChange}
                border={false}
            />
            <p className={`mt-2 text-xs font-semibold ${downloadsVisibleToMembers ? 'text-green-300' : 'text-yellow-300'}`}>
                {downloadsVisibleToMembers
                    ? t('settings.navigation.order.membersCanSeeDownloads')
                    : t('settings.navigation.order.membersDownloadsHidden')}
            </p>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
            <NavOrderColumn
                title={t('settings.navigation.order.admins')}
                subtitle={t('settings.navigation.order.adminsSubtitle')}
                icon={<Shield className="h-4 w-4 text-plex" />}
                accentClass="border-plex/35 bg-plex/10 text-plex"
                navOrder={navOrder}
                onChange={onChange}
                navHiddenKeys={navHiddenKeys}
                onHiddenKeysChange={onHiddenKeysChange}
                alwaysVisibleKeys={ALWAYS_VISIBLE_NAV_KEYS}
                normalizeHidden={normalizeAdminHidden}
                downloadsVisibleToMembers={downloadsVisibleToMembers}
                showAdminSuffix
                featureStatus={featureStatus}
                translate={t}
                labelForKey={labelForKey}
                navItemIcons={navItemIcons}
                onNavItemIconsChange={onNavItemIconsChange}
                allowIconEdit
                customNavTabs={customNavTabs}
            />
            <NavOrderColumn
                title={t('settings.navigation.order.members')}
                subtitle={t('settings.navigation.order.membersSubtitle')}
                icon={<Users className="h-4 w-4 text-sky-300" />}
                accentClass="border-sky-500/35 bg-sky-500/10 text-sky-200"
                navOrder={memberNavOrder}
                onChange={onMemberNavOrderChange}
                navHiddenKeys={memberNavHiddenKeys}
                onHiddenKeysChange={onMemberNavHiddenKeysChange}
                alwaysVisibleKeys={ALWAYS_VISIBLE_MEMBER_NAV_KEYS}
                normalizeHidden={normalizeMemberHidden}
                downloadsVisibleToMembers={downloadsVisibleToMembers}
                showAdminSuffix={false}
                downloadsMembersNote={
                    !downloadsVisibleToMembers
                        ? t('settings.navigation.order.downloadsForcedOff')
                        : null
                }
                translate={t}
                labelForKey={labelForKey}
                navItemIcons={navItemIcons}
                customNavTabs={customNavTabs}
            />
        </div>
    </div>
    );
};
