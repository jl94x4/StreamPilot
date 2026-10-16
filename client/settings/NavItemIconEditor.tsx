import React, { useMemo, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import type { NavItemIconMark } from '../shared/navItemIcons';
import {
    DEFAULT_NAV_ITEM_ICONS,
    isNativeNavIconKey,
    navItemIconLogoPublicPath,
    resolveNavItemLucideIcon,
} from '../shared/navItemIcons';
import { CUSTOM_NAV_ICON_OPTIONS, resolveCustomNavIcon } from '../shared/customNavTabs';
import type { CustomNavTab } from '../shared/types';
import {
    APPLET_PRESET_LOGOS,
    appletPresetLogoPath,
} from '../../lib/applet-preset-logos.js';
import { CustomSelect } from '../shared/ui';
import { SettingHint } from './SettingHint';
import { portalUrl, resolvePortalAssetUrl } from '../shared/basePath';
import { PORTAL_CSRF_HEADER, PORTAL_CSRF_VALUE } from '../shared/api';

type SharedProps = {
    navKey: string;
    mark?: NavItemIconMark;
    translate: (key: string, vars?: Record<string, unknown>) => string;
};

type TriggerProps = SharedProps & {
    expanded: boolean;
    onToggle: () => void;
    editable: boolean;
    label: string;
};

export const NavItemIconTrigger: React.FC<TriggerProps> = ({
    navKey,
    mark,
    expanded,
    onToggle,
    editable,
    label,
    translate,
}) => {
    if (!isNativeNavIconKey(navKey)) return null;
    const Icon = resolveNavItemLucideIcon(navKey, mark);
    const logoSrc = mark?.logoUrl ? resolvePortalAssetUrl(mark.logoUrl) : '';
    const hasCustom = !!(mark?.icon || mark?.logoUrl);

    return (
        <button
            type="button"
            onClick={editable ? onToggle : undefined}
            disabled={!editable}
            aria-expanded={editable ? expanded : undefined}
            aria-label={translate('settings.navigation.order.customizeIcon', { label })}
            title={editable
                ? translate('settings.navigation.order.customizeIconHint')
                : translate('settings.navigation.order.iconMembersHint')}
            className={`inline-flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-white/[0.03] p-1 transition-colors
                ${editable
                    ? (expanded || hasCustom
                        ? 'border-plex/40 text-text hover:border-plex/60'
                        : 'border-border/60 text-muted hover:border-plex/40 hover:text-text')
                    : 'cursor-default border-border/40 text-muted'}`}
        >
            {logoSrc ? (
                <img src={logoSrc} alt="" className="h-full w-full object-contain" />
            ) : (
                <Icon className="h-4 w-4" />
            )}
        </button>
    );
};

export const AppletNavIconPreview: React.FC<{
    tab: CustomNavTab;
    label: string;
    translate: (key: string, vars?: Record<string, unknown>) => string;
}> = ({ tab, label, translate }) => {
    const [logoFailed, setLogoFailed] = useState(false);
    const Icon = resolveCustomNavIcon(tab.icon);
    const logoSrc = tab.logoUrl && !logoFailed ? resolvePortalAssetUrl(tab.logoUrl) : '';

    return (
        <span
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border/40 bg-white/[0.03] p-1 text-muted"
            title={translate('settings.navigation.order.appletIconHint')}
            aria-label={translate('settings.navigation.order.appletIcon', { label })}
        >
            {logoSrc ? (
                <img
                    src={logoSrc}
                    alt=""
                    className="h-full w-full object-contain"
                    onError={() => setLogoFailed(true)}
                />
            ) : (
                <Icon className="h-4 w-4" />
            )}
        </span>
    );
};

type PanelProps = SharedProps & {
    onChange: (patch: Partial<NavItemIconMark>) => void;
    onReset: () => void;
};

export const NavItemIconPanel: React.FC<PanelProps> = ({
    navKey,
    mark,
    onChange,
    onReset,
    translate,
}) => {
    const [uploading, setUploading] = useState(false);
    const iconValue = mark?.icon || DEFAULT_NAV_ITEM_ICONS[navKey] || 'Globe';
    const iconOptions = useMemo(
        () => CUSTOM_NAV_ICON_OPTIONS.map((icon) => ({ value: icon, label: icon })),
        [],
    );
    const hasCustom = !!(mark?.icon || mark?.logoUrl);

    const uploadLogo = async (file: File) => {
        setUploading(true);
        try {
            const response = await fetch(portalUrl(`/api/config/nav-item-icon/${encodeURIComponent(navKey)}`), {
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
            onChange({ logoUrl: result.logoUrl || navItemIconLogoPublicPath(navKey) });
        } catch {
            // keep the previous mark if upload fails
        } finally {
            setUploading(false);
        }
    };

    return (
        <div className="space-y-3 rounded-xl border border-border/60 bg-background/40 p-3">
            <label className="block text-sm">
                <span className="mb-1 block text-xs font-semibold text-text">
                    {translate('settings.navigation.customTabs.icon')}
                </span>
                <CustomSelect
                    value={iconValue}
                    onChange={(value) => onChange({ icon: value })}
                    options={iconOptions}
                />
            </label>
            <div className="block text-sm">
                <span className="mb-1 block text-xs font-semibold text-text">
                    {translate('settings.navigation.customTabs.logo')}
                </span>
                <input
                    className="appearance-none text-[16px] leading-5 w-full rounded-xl border border-border bg-background px-3 py-2 text-[16px] text-text outline-none focus:border-plex"
                    value={mark?.logoUrl || ''}
                    onChange={(event) => onChange({ logoUrl: event.target.value })}
                    placeholder="https://example.com/icon.png"
                />
                <div className="mt-2 flex flex-wrap items-center gap-2">
                    <label className="inline-flex cursor-pointer items-center rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-muted hover:border-plex/40 hover:text-text">
                        {uploading
                            ? translate('settings.navigation.customTabs.logoUploading')
                            : translate('settings.navigation.customTabs.logoUpload')}
                        <input
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            className="hidden"
                            onChange={(event) => {
                                const file = event.target.files?.[0];
                                event.currentTarget.value = '';
                                if (file) void uploadLogo(file);
                            }}
                        />
                    </label>
                    {mark?.logoUrl ? (
                        <button
                            type="button"
                            className="text-xs font-semibold text-muted hover:text-red-300"
                            onClick={() => onChange({ logoUrl: '' })}
                        >
                            {translate('settings.navigation.customTabs.logoClear')}
                        </button>
                    ) : null}
                    {hasCustom ? (
                        <button
                            type="button"
                            className="inline-flex items-center gap-1 text-xs font-semibold text-muted hover:text-text"
                            onClick={onReset}
                        >
                            <RotateCcw className="h-3 w-3" />
                            {translate('settings.navigation.order.resetIcon')}
                        </button>
                    ) : null}
                </div>
                <div className="mt-3">
                    <span className="mb-2 block text-xs font-semibold text-muted">
                        {translate('settings.navigation.customTabs.logoPresets')}
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                        {APPLET_PRESET_LOGOS.map((preset) => {
                            const path = appletPresetLogoPath(preset.id);
                            const selected = mark?.logoUrl === path;
                            return (
                                <button
                                    key={preset.id}
                                    type="button"
                                    title={preset.name}
                                    className={`h-9 w-9 overflow-hidden rounded-lg border bg-background/70 p-1 ${selected ? 'border-plex ring-1 ring-plex' : 'border-border hover:border-plex/40'}`}
                                    onClick={() => onChange({
                                        logoUrl: selected ? '' : path,
                                        icon: selected ? mark?.icon : preset.icon,
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
                </div>
                <SettingHint>{translate('settings.navigation.order.iconEditorHint')}</SettingHint>
            </div>
        </div>
    );
};
