import React from 'react';
import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react';
import type { DashboardLayoutConfig } from '../shared/dashboardLayout';
import type { HomeCustomModule } from '../shared/types';
import {
    createDefaultHomeCustomModule,
    homeModuleEmbedIssue,
    homeModuleUsesProxy,
    insertHomeModuleSection,
    removeHomeModuleSection,
} from '../shared/homeCustomModules';
import { CustomSelect, SettingsToggleRow } from '../shared/ui';
import { SettingHint } from './SettingHint';
import { useDiscoverI18n } from '../discovery/i18n';

type Props = {
    homeCustomModules: HomeCustomModule[];
    onChange: (next: HomeCustomModule[]) => void;
    dashboardLayout: DashboardLayoutConfig;
    onDashboardLayoutChange: (next: DashboardLayoutConfig) => void;
};

const MODE_OPTIONS = [
    { value: 'html', labelKey: 'settings.homeModules.mode.html' },
    { value: 'iframe', labelKey: 'settings.homeModules.mode.iframe' },
] as const;

export const HomeCustomModulesSettings: React.FC<Props> = ({
    homeCustomModules,
    onChange,
    dashboardLayout,
    onDashboardLayoutChange,
}) => {
    const { t } = useDiscoverI18n();

    const updateModule = (id: string, patch: Partial<HomeCustomModule>) => {
        onChange(homeCustomModules.map((module) => (
            module.id === id ? { ...module, ...patch } : module
        )));
    };

    const addModule = () => {
        const module = createDefaultHomeCustomModule();
        onChange([...homeCustomModules, module]);
        onDashboardLayoutChange({
            ...dashboardLayout,
            sections: insertHomeModuleSection(dashboardLayout.sections, module.id),
        });
    };

    const removeModule = (id: string) => {
        onChange(homeCustomModules.filter((module) => module.id !== id));
        onDashboardLayoutChange({
            ...dashboardLayout,
            sections: removeHomeModuleSection(dashboardLayout.sections, id),
            hiddenSections: removeHomeModuleSection(dashboardLayout.hiddenSections, id),
        });
    };

    const moveModule = (index: number, direction: -1 | 1) => {
        const target = index + direction;
        if (target < 0 || target >= homeCustomModules.length) return;
        const nextModules = [...homeCustomModules];
        const [moved] = nextModules.splice(index, 1);
        nextModules.splice(target, 0, moved);
        onChange(nextModules);

        const orderedSectionIds = nextModules.map((module) => `customModule:${module.id}`);
        const stockSections = dashboardLayout.sections.filter((id) => !id.startsWith('customModule:'));
        const recentlyAddedIndex = stockSections.indexOf('recentlyAdded');
        const merged = recentlyAddedIndex >= 0
            ? [
                ...stockSections.slice(0, recentlyAddedIndex),
                ...orderedSectionIds,
                ...stockSections.slice(recentlyAddedIndex),
            ]
            : [...stockSections, ...orderedSectionIds];
        onDashboardLayoutChange({ ...dashboardLayout, sections: merged });
    };

    return (
        <div className="mb-8 animate-fade-in">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-2">
                <div>
                    <h3 className="text-xl font-bold text-plex">{t('settings.homeModules.title')}</h3>
                    <p className="mt-1 max-w-3xl text-sm text-muted">{t('settings.homeModules.description')}</p>
                </div>
                <button
                    type="button"
                    className="inline-flex items-center gap-2 rounded-xl bg-plex px-4 py-2 text-sm font-bold text-background hover:bg-plex-hover disabled:opacity-50"
                    onClick={addModule}
                    disabled={homeCustomModules.length >= 20}
                >
                    <Plus className="h-4 w-4" />
                    {t('settings.homeModules.add')}
                </button>
            </div>

            {!homeCustomModules.length ? (
                <div className="rounded-2xl border border-dashed border-border/70 bg-background/20 px-4 py-8 text-center text-sm text-muted">
                    {t('settings.homeModules.empty')}
                </div>
            ) : (
                <div className="space-y-4">
                    {homeCustomModules.map((module, index) => (
                        <div key={module.id} className="rounded-2xl border border-border/70 bg-background/20 p-4">
                            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                                <div className="min-w-0">
                                    <p className="truncate text-sm font-bold text-text">{module.title || t('settings.homeModules.untitled')}</p>
                                    <p className="truncate text-xs text-muted">
                                        {module.mode === 'iframe' ? (module.url || t('settings.homeModules.noUrl')) : t('settings.homeModules.htmlModule')}
                                    </p>
                                </div>
                                <div className="flex items-center gap-1">
                                    <button type="button" className="rounded-lg p-2 text-muted hover:bg-white/5 hover:text-text disabled:opacity-40" disabled={index === 0} onClick={() => moveModule(index, -1)} aria-label="Move up">
                                        <ChevronUp className="h-4 w-4" />
                                    </button>
                                    <button type="button" className="rounded-lg p-2 text-muted hover:bg-white/5 hover:text-text disabled:opacity-40" disabled={index === homeCustomModules.length - 1} onClick={() => moveModule(index, 1)} aria-label="Move down">
                                        <ChevronDown className="h-4 w-4" />
                                    </button>
                                    <button type="button" className="rounded-lg p-2 text-red-300 hover:bg-red-500/10" onClick={() => removeModule(module.id)} aria-label="Delete module">
                                        <Trash2 className="h-4 w-4" />
                                    </button>
                                </div>
                            </div>

                            <div className="grid gap-4 md:grid-cols-2">
                                <label className="block text-sm">
                                    <span className="mb-1 block font-semibold text-text">{t('settings.homeModules.titleLabel')}</span>
                                    <input
                                        className="appearance-none text-[16px] leading-5 w-full rounded-xl border border-border bg-background px-3 py-2 text-[16px] text-text outline-none focus:border-plex"
                                        value={module.title}
                                        onChange={(event) => updateModule(module.id, { title: event.target.value })}
                                        placeholder={t('settings.homeModules.titlePlaceholder')}
                                    />
                                </label>
                                <label className="block text-sm">
                                    <span className="mb-1 block font-semibold text-text">{t('settings.homeModules.mode.label')}</span>
                                    <CustomSelect
                                        value={module.mode}
                                        onChange={(value) => updateModule(module.id, {
                                            mode: value as HomeCustomModule['mode'],
                                            html: value === 'html' ? (module.html || '<p></p>') : undefined,
                                            css: value === 'html' ? (module.css || '') : undefined,
                                            url: value === 'iframe' ? (module.url || '') : undefined,
                                        })}
                                        options={MODE_OPTIONS.map((option) => ({
                                            value: option.value,
                                            label: t(option.labelKey),
                                        }))}
                                    />
                                </label>
                                <label className="block text-sm md:col-span-2">
                                    <span className="mb-1 block font-semibold text-text">{t('settings.homeModules.descriptionLabel')}</span>
                                    <input
                                        className="appearance-none text-[16px] leading-5 w-full rounded-xl border border-border bg-background px-3 py-2 text-[16px] text-text outline-none focus:border-plex"
                                        value={module.description || ''}
                                        onChange={(event) => updateModule(module.id, { description: event.target.value })}
                                        placeholder={t('settings.homeModules.descriptionPlaceholder')}
                                    />
                                </label>
                                {module.mode === 'iframe' ? (
                                    <label className="block text-sm md:col-span-2">
                                        <span className="mb-1 block font-semibold text-text">{t('settings.homeModules.url')}</span>
                                        <input
                                            className="appearance-none text-[16px] leading-5 w-full rounded-xl border border-border bg-background px-3 py-2 text-[16px] text-text outline-none focus:border-plex"
                                            value={module.url || ''}
                                            onChange={(event) => updateModule(module.id, { url: event.target.value })}
                                            placeholder="https://sonarr.example.com"
                                        />
                                        <SettingHint>{t('settings.homeModules.mode.hint.iframe')}</SettingHint>
                                        {homeModuleEmbedIssue(module) === 'blocked-host' ? (
                                            <p className="mt-2 text-xs font-semibold text-yellow-300/90">
                                                {t('settings.homeModules.embedWarningBlockedHost')}
                                            </p>
                                        ) : null}
                                        {homeModuleUsesProxy(module) ? (
                                            <p className="mt-2 text-xs font-semibold text-sky-300/90">
                                                {homeModuleEmbedIssue(module) === 'mixed-content'
                                                    ? t('settings.homeModules.embedWarningMixedContent')
                                                    : t('settings.homeModules.embedWarningCrossOrigin')}
                                            </p>
                                        ) : null}
                                    </label>
                                ) : (
                                    <>
                                        <label className="block text-sm md:col-span-2">
                                            <span className="mb-1 block font-semibold text-text">{t('settings.homeModules.html')}</span>
                                            <textarea
                                                className="appearance-none text-[16px] leading-5 min-h-[10rem] w-full rounded-xl border border-border bg-background px-3 py-2 font-mono text-[16px] text-text outline-none focus:border-plex"
                                                value={module.html || ''}
                                                onChange={(event) => updateModule(module.id, { html: event.target.value })}
                                                placeholder="<div>Your HTML here</div>"
                                            />
                                            <SettingHint>{t('settings.homeModules.htmlHint')}</SettingHint>
                                        </label>
                                        <label className="block text-sm md:col-span-2">
                                            <span className="mb-1 block font-semibold text-text">{t('settings.homeModules.css')}</span>
                                            <textarea
                                                className="appearance-none text-[16px] leading-5 min-h-[8rem] w-full rounded-xl border border-border bg-background px-3 py-2 font-mono text-[16px] text-text outline-none focus:border-plex"
                                                value={module.css || ''}
                                                onChange={(event) => updateModule(module.id, { css: event.target.value })}
                                                placeholder=".home-custom-module-html { ... }"
                                            />
                                        </label>
                                    </>
                                )}
                                <div className="md:col-span-2 space-y-2">
                                    <SettingsToggleRow
                                        label={t('settings.homeModules.enabled')}
                                        description={t('settings.homeModules.enabledHint')}
                                        checked={module.enabled}
                                        onChange={(checked) => updateModule(module.id, { enabled: checked })}
                                    />
                                    <SettingsToggleRow
                                        label={t('settings.homeModules.adminOnly')}
                                        description={t('settings.homeModules.adminOnlyHint')}
                                        checked={!!module.adminOnly}
                                        onChange={(checked) => updateModule(module.id, { adminOnly: checked })}
                                    />
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
            <p className="mt-3 text-xs text-muted">{t('settings.homeModules.layoutHint')}</p>
        </div>
    );
};
