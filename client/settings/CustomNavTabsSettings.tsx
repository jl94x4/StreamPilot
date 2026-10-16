import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react';
import type { CustomNavDisplay, CustomNavTab } from '../shared/types';
import {
    CUSTOM_NAV_ICON_OPTIONS,
    createDefaultCustomNavTab,
    customNavTabKey,
    customTabLogoPublicPath,
    detectCustomTabEmbedIssue,
    insertNavKeyBefore,
    removeNavKey,
    resolveCustomNavIcon,
    shouldUseCustomTabEmbedProxy,
} from '../shared/customNavTabs';
import {
    APPLET_PRESET_LOGOS,
    appletPresetLogoPath,
    isAppletPresetLogoUrl,
    matchAppletPresetLogo,
} from '../../lib/applet-preset-logos.js';
import { CustomSelect, SettingsToggleRow } from '../shared/ui';
import { SettingHint } from './SettingHint';
import { useDiscoverI18n } from '../discovery/i18n';
import { portalUrl, resolvePortalAssetUrl } from '../shared/basePath';
import { PORTAL_CSRF_HEADER, PORTAL_CSRF_VALUE } from '../shared/api';

type Props = {
    customNavTabs: CustomNavTab[];
    onChange: (next: CustomNavTab[]) => void;
    customNavDisplay: CustomNavDisplay;
    onDisplayChange: (next: CustomNavDisplay) => void;
    arrOpenInPortalEmbed: boolean;
    onArrOpenInPortalEmbedChange: (next: boolean) => void;
    navOrder: string[];
    onNavOrderChange: (next: string[]) => void;
    memberNavOrder: string[];
    onMemberNavOrderChange: (next: string[]) => void;
};

const OPEN_MODE_OPTIONS = [
    { value: 'embed', labelKey: 'settings.navigation.customTabs.openMode.embed' },
    { value: 'sameTab', labelKey: 'settings.navigation.customTabs.openMode.sameTab' },
    { value: 'newTab', labelKey: 'settings.navigation.customTabs.openMode.newTab' },
] as const;

export const CustomNavTabsSettings: React.FC<Props> = ({
    customNavTabs,
    onChange,
    customNavDisplay,
    onDisplayChange,
    arrOpenInPortalEmbed,
    onArrOpenInPortalEmbedChange,
    navOrder,
    onNavOrderChange,
    memberNavOrder,
    onMemberNavOrderChange,
}) => {
    const { t } = useDiscoverI18n();
    const [uploadingId, setUploadingId] = useState<string | null>(null);
    const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
    const [focusTabId, setFocusTabId] = useState<string | null>(null);
    const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});
    const iconOptions = useMemo(
        () => CUSTOM_NAV_ICON_OPTIONS.map((icon) => ({ value: icon, label: icon })),
        [],
    );

    const updateTab = (id: string, patch: Partial<CustomNavTab>) => {
        const next = customNavTabs.map((tab) => (
            tab.id === id ? { ...tab, ...patch } : tab
        ));
        onChange(next);
        const key = customNavTabKey(id);
        const updated = next.find((tab) => tab.id === id);
        if (!updated) return;
        if (updated.adminOnly) {
            onMemberNavOrderChange(removeNavKey(memberNavOrder, key));
        } else if (!memberNavOrder.includes(key)) {
            onMemberNavOrderChange(insertNavKeyBefore(memberNavOrder, 'logout', key));
        }
    };

    const patchTab = (id: string, patch: Partial<CustomNavTab>) => {
        const current = customNavTabs.find((tab) => tab.id === id);
        if (!current) return;
        const merged = { ...current, ...patch };
        const matched = matchAppletPresetLogo(merged.name, merged.url);
        const extra: Partial<CustomNavTab> = {};
        if (matched) {
            if (!merged.logoUrl || isAppletPresetLogoUrl(merged.logoUrl)) {
                extra.logoUrl = appletPresetLogoPath(matched.id);
            }
            if (!merged.icon || merged.icon === 'Globe') {
                extra.icon = matched.icon;
            }
        }
        updateTab(id, { ...patch, ...extra });
    };

    const uploadLogo = async (id: string, file: File) => {
        setUploadingId(id);
        try {
            const response = await fetch(portalUrl(`/api/config/custom-tab-logo/${encodeURIComponent(id)}`), {
                method: 'POST',
                credentials: 'same-origin',
                headers: {
                    'Content-Type': file.type || (file.name.toLowerCase().endsWith('.png') ? 'image/png' : (file.name.toLowerCase().endsWith('.webp') ? 'image/webp' : 'image/jpeg')),
                    [PORTAL_CSRF_HEADER]: PORTAL_CSRF_VALUE,
                },
                body: file,
            });
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: 'Failed to upload logo' }));
                throw new Error(errorData.error || 'Failed to upload logo');
            }
            const result = await response.json().catch(() => ({}));
            updateTab(id, { logoUrl: result.logoUrl || customTabLogoPublicPath(id) });
        } catch {
            // keep the previous logo if upload fails
        } finally {
            setUploadingId(null);
        }
    };

    useEffect(() => {
        if (!focusTabId) return;
        const node = cardRefs.current[focusTabId];
        node?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        setFocusTabId(null);
    }, [focusTabId, customNavTabs]);

    const toggleExpanded = (id: string) => {
        setExpandedIds((current) => {
            const next = new Set(current);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const addTab = () => {
        const tab = createDefaultCustomNavTab();
        onChange([...customNavTabs, tab]);
        const key = customNavTabKey(tab.id);
        onNavOrderChange(insertNavKeyBefore(navOrder, 'settings', key));
        onMemberNavOrderChange(insertNavKeyBefore(memberNavOrder, 'logout', key));
        setExpandedIds((current) => new Set(current).add(tab.id));
        setFocusTabId(tab.id);
    };

    const removeTab = (id: string) => {
        const key = customNavTabKey(id);
        onChange(customNavTabs.filter((tab) => tab.id !== id));
        onNavOrderChange(removeNavKey(navOrder, key));
        onMemberNavOrderChange(removeNavKey(memberNavOrder, key));
    };

    const moveTab = (index: number, direction: -1 | 1) => {
        const target = index + direction;
        if (target < 0 || target >= customNavTabs.length) return;
        const next = [...customNavTabs];
        const [moved] = next.splice(index, 1);
        next.splice(target, 0, moved);
        onChange(next);
        const orderedKeys = next.map((tab) => customNavTabKey(tab.id));
        const stockKeys = navOrder.filter((key) => !key.startsWith('custom:'));
        const settingsIndex = stockKeys.indexOf('settings');
        const merged = settingsIndex >= 0
            ? [...stockKeys.slice(0, settingsIndex), ...orderedKeys, ...stockKeys.slice(settingsIndex)]
            : [...stockKeys, ...orderedKeys];
        onNavOrderChange(merged);
    };

    return (
        <div className="mb-8 animate-fade-in">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-2">
                <div>
                    <h3 className="text-xl font-bold text-plex">{t('settings.navigation.customTabs.title')}</h3>
                    <p className="mt-1 max-w-3xl text-sm text-muted">{t('settings.navigation.customTabs.description')}</p>
                </div>
                <button
                    type="button"
                    className="inline-flex items-center gap-2 rounded-xl bg-plex px-4 py-2 text-sm font-bold text-background hover:bg-plex-hover disabled:opacity-50"
                    onClick={addTab}
                    disabled={customNavTabs.length >= 20}
                >
                    <Plus className="h-4 w-4" />
                    {t('settings.navigation.customTabs.add')}
                </button>
            </div>

            <div className="mb-6 rounded-2xl border border-border/70 bg-background/20 p-4">
                <label className="block max-w-xl text-sm">
                    <span className="mb-1 block font-semibold text-text">{t('settings.navigation.customTabs.displayMode.label')}</span>
                    <CustomSelect
                        value={customNavDisplay}
                        onChange={(value) => onDisplayChange(value === 'applets' ? 'applets' : 'links')}
                        options={[
                            { value: 'links', label: t('settings.navigation.customTabs.displayMode.links') },
                            { value: 'applets', label: t('settings.navigation.customTabs.displayMode.applets') },
                        ]}
                    />
                    <SettingHint>
                        {customNavDisplay === 'applets'
                            ? t('settings.navigation.customTabs.displayMode.appletsHint')
                            : t('settings.navigation.customTabs.displayMode.linksHint')}
                    </SettingHint>
                </label>
                <div className="mt-4 max-w-xl border-t border-border/40 pt-2">
                    <SettingsToggleRow
                        title={t('settings.navigation.customTabs.openArrInEmbed.label')}
                        description={t('settings.navigation.customTabs.openArrInEmbed.hint')}
                        checked={arrOpenInPortalEmbed}
                        onChange={onArrOpenInPortalEmbedChange}
                        border={false}
                    />
                </div>
            </div>

            {!customNavTabs.length ? (
                <div className="rounded-2xl border border-dashed border-border/70 bg-background/20 px-4 py-8 text-center text-sm text-muted">
                    {t('settings.navigation.customTabs.empty')}
                </div>
            ) : (
                <div className="space-y-4">
                    {customNavTabs.map((tab, index) => {
                        const Icon = resolveCustomNavIcon(tab.icon);
                        const expanded = expandedIds.has(tab.id);
                        return (
                            <div
                                key={tab.id}
                                ref={(node) => {
                                    cardRefs.current[tab.id] = node;
                                }}
                                className="scroll-mt-24 rounded-2xl border border-border/70 bg-background/20 p-4"
                            >
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                    <button
                                        type="button"
                                        className="flex min-w-0 flex-1 items-center gap-3 rounded-xl text-left hover:bg-white/[0.03]"
                                        onClick={() => toggleExpanded(tab.id)}
                                        aria-expanded={expanded}
                                    >
                                        <div className="inline-flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl border border-plex/30 bg-plex/10 text-plex">
                                            {tab.logoUrl ? (
                                                <img src={resolvePortalAssetUrl(tab.logoUrl)} alt="" className="h-full w-full object-contain p-1" />
                                            ) : (
                                                <Icon className="h-5 w-5" />
                                            )}
                                        </div>
                                        <div className="min-w-0">
                                            <p className="truncate text-sm font-bold text-text">{tab.name || t('settings.navigation.customTabs.untitled')}</p>
                                            <p className="truncate text-xs text-muted">{tab.url}</p>
                                        </div>
                                        <ChevronDown className={`ml-auto h-4 w-4 shrink-0 text-muted transition-transform ${expanded ? 'rotate-180' : ''}`} />
                                    </button>
                                    <div className="flex items-center gap-1">
                                        <button type="button" className="rounded-lg p-2 text-muted hover:bg-white/5 hover:text-text disabled:opacity-40" disabled={index === 0} onClick={() => moveTab(index, -1)} aria-label={t('settings.navigation.customTabs.moveTabUp')}>
                                            <ChevronUp className="h-4 w-4" />
                                        </button>
                                        <button type="button" className="rounded-lg p-2 text-muted hover:bg-white/5 hover:text-text disabled:opacity-40" disabled={index === customNavTabs.length - 1} onClick={() => moveTab(index, 1)} aria-label={t('settings.navigation.customTabs.moveTabDown')}>
                                            <ChevronDown className="h-4 w-4" />
                                        </button>
                                        <button type="button" className="rounded-lg p-2 text-red-300 hover:bg-red-500/10" onClick={() => removeTab(tab.id)} aria-label={t('settings.navigation.customTabs.deleteTab')}>
                                            <Trash2 className="h-4 w-4" />
                                        </button>
                                    </div>
                                </div>

                                {expanded ? (
                                <>
                                <div className="mt-4 grid gap-4 md:grid-cols-2">
                                    <label className="block text-sm">
                                        <span className="mb-1 block font-semibold text-text">{t('settings.navigation.customTabs.name')}</span>
                                        <input
                                            className="appearance-none text-[16px] leading-5 w-full rounded-xl border border-border bg-background px-3 py-2 text-[16px] text-text outline-none focus:border-plex"
                                            value={tab.name}
                                            onChange={(event) => patchTab(tab.id, { name: event.target.value })}
                                            placeholder="Radarr"
                                        />
                                    </label>
                                    <label className="block text-sm">
                                        <span className="mb-1 block font-semibold text-text">{t('settings.navigation.customTabs.url')}</span>
                                        <input
                                            className="appearance-none text-[16px] leading-5 w-full rounded-xl border border-border bg-background px-3 py-2 text-[16px] text-text outline-none focus:border-plex"
                                            value={tab.url}
                                            onChange={(event) => patchTab(tab.id, { url: event.target.value })}
                                            placeholder="https://radarr.example.com"
                                        />
                                    </label>
                                    <label className="block text-sm md:col-span-2">
                                        <span className="mb-1 block font-semibold text-text">{t('settings.navigation.customTabs.descriptionLabel')}</span>
                                        <input
                                            className="appearance-none text-[16px] leading-5 w-full rounded-xl border border-border bg-background px-3 py-2 text-[16px] text-text outline-none focus:border-plex"
                                            value={tab.description || ''}
                                            onChange={(event) => updateTab(tab.id, { description: event.target.value })}
                                            placeholder={t('settings.navigation.customTabs.descriptionPlaceholder')}
                                        />
                                    </label>
                                    <label className="block text-sm">
                                        <span className="mb-1 block font-semibold text-text">{t('settings.navigation.customTabs.icon')}</span>
                                        <CustomSelect
                                            value={tab.icon}
                                            onChange={(value) => updateTab(tab.id, { icon: value })}
                                            options={iconOptions}
                                        />
                                    </label>
                                    <div className="block text-sm md:col-span-2">
                                        <span className="mb-1 block font-semibold text-text">{t('settings.navigation.customTabs.logo')}</span>
                                        <input
                                            className="appearance-none text-[16px] leading-5 w-full rounded-xl border border-border bg-background px-3 py-2 text-[16px] text-text outline-none focus:border-plex"
                                            value={tab.logoUrl || ''}
                                            onChange={(event) => updateTab(tab.id, { logoUrl: event.target.value })}
                                            placeholder="https://example.com/radarr.png"
                                        />
                                        <div className="mt-2 flex flex-wrap items-center gap-2">
                                            <label className="inline-flex cursor-pointer items-center rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-muted hover:border-plex/40 hover:text-text">
                                                {uploadingId === tab.id
                                                    ? t('settings.navigation.customTabs.logoUploading')
                                                    : t('settings.navigation.customTabs.logoUpload')}
                                                <input
                                                    type="file"
                                                    accept="image/png,image/jpeg,image/webp"
                                                    className="hidden"
                                                    onChange={(event) => {
                                                        const file = event.target.files?.[0];
                                                        event.target.value = '';
                                                        if (file) void uploadLogo(tab.id, file);
                                                    }}
                                                />
                                            </label>
                                            {tab.logoUrl ? (
                                                <button
                                                    type="button"
                                                    className="text-xs font-semibold text-muted hover:text-red-300"
                                                    onClick={() => updateTab(tab.id, { logoUrl: '' })}
                                                >
                                                    {t('settings.navigation.customTabs.logoClear')}
                                                </button>
                                            ) : null}
                                        </div>
                                        <div className="mt-3">
                                            <span className="mb-2 block text-xs font-semibold text-muted">
                                                {t('settings.navigation.customTabs.logoPresets')}
                                            </span>
                                            <div className="flex flex-wrap gap-1.5">
                                                {APPLET_PRESET_LOGOS.map((preset) => {
                                                    const path = appletPresetLogoPath(preset.id);
                                                    const selected = tab.logoUrl === path;
                                                    return (
                                                        <button
                                                            key={preset.id}
                                                            type="button"
                                                            title={preset.name}
                                                            className={`h-9 w-9 overflow-hidden rounded-lg border bg-background/70 p-1 ${selected ? 'border-plex ring-1 ring-plex' : 'border-border hover:border-plex/40'}`}
                                                            onClick={() => updateTab(tab.id, {
                                                                logoUrl: selected ? '' : path,
                                                                icon: selected ? tab.icon : preset.icon,
                                                            })}
                                                        >
                                                            <img
                                                                src={resolvePortalAssetUrl(path)}
                                                                alt=""
                                                                className="h-full w-full object-contain"
                                                            />
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                            <SettingHint>{t('settings.navigation.customTabs.logoPresetsHint')}</SettingHint>
                                        </div>
                                        <SettingHint>{t('settings.navigation.customTabs.logoHint')}</SettingHint>
                                    </div>
                                    <label className="block text-sm">
                                        <span className="mb-1 block font-semibold text-text">{t('settings.navigation.customTabs.openMode.label')}</span>
                                        <CustomSelect
                                            value={tab.openMode}
                                            onChange={(value) => updateTab(tab.id, { openMode: value as CustomNavTab['openMode'] })}
                                            options={OPEN_MODE_OPTIONS.map((option) => ({
                                                value: option.value,
                                                label: t(option.labelKey),
                                            }))}
                                        />
                                        <SettingHint>{t(`settings.navigation.customTabs.openMode.hint.${tab.openMode}`)}</SettingHint>
                                        {tab.openMode === 'embed' && detectCustomTabEmbedIssue(tab.url) === 'blocked-host' ? (
                                            <p className="mt-2 text-xs font-semibold text-yellow-300/90">
                                                {t('settings.navigation.customTabs.embedWarningBlockedHost')}
                                            </p>
                                        ) : null}
                                        {tab.openMode === 'embed' && detectCustomTabEmbedIssue(tab.url) === 'proxy-incompatible' ? (
                                            <p className="mt-2 text-xs font-semibold text-yellow-300/90">
                                                {t('settings.navigation.customTabs.embedWarningProxyIncompatible')}
                                            </p>
                                        ) : null}
                                        {tab.openMode === 'embed' && shouldUseCustomTabEmbedProxy(tab.url) ? (
                                            <p className="mt-2 text-xs font-semibold text-sky-300/90">
                                                {detectCustomTabEmbedIssue(tab.url) === 'mixed-content'
                                                    ? t('settings.navigation.customTabs.embedWarningMixedContent')
                                                    : t('settings.navigation.customTabs.embedWarningCrossOrigin')}
                                            </p>
                                        ) : null}
                                    </label>
                                </div>

                                <div className="mt-4 grid gap-3 md:grid-cols-2">
                                    <SettingsToggleRow
                                        title={t('settings.navigation.customTabs.enabled')}
                                        checked={tab.enabled}
                                        onChange={(checked) => updateTab(tab.id, { enabled: checked })}
                                        border={false}
                                    />
                                    <SettingsToggleRow
                                        title={t('settings.navigation.customTabs.adminOnly')}
                                        hint={<SettingHint>{t('settings.navigation.customTabs.adminOnlyHint')}</SettingHint>}
                                        checked={!!tab.adminOnly}
                                        onChange={(checked) => updateTab(tab.id, { adminOnly: checked })}
                                        border={false}
                                    />
                                    <SettingsToggleRow
                                        title={t('settings.navigation.customTabs.showPaletteLabel')}
                                        hint={<SettingHint>{t('settings.navigation.customTabs.showPaletteLabelHint')}</SettingHint>}
                                        checked={tab.showPaletteLabel !== false}
                                        onChange={(checked) => updateTab(tab.id, { showPaletteLabel: checked })}
                                        border={false}
                                    />
                                </div>
                                </>
                                ) : null}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};
