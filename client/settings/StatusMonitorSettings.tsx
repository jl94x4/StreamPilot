import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Copy, ChevronUp, ChevronDown } from 'lucide-react';
import { apiFetch } from '../shared/api';
import { appConfirm } from '../shared/confirm';
import { CustomSelect } from '../shared/ui';
import type { User, AuditEntry, DeletedUser } from '../shared/types';
import { formatDateTime, formatEventName, hexToRgb, getDaysUntilExpiry, addMonths, addYears, formatDate } from '../shared/format';
import { useDiscoverI18n } from '../discovery/i18n';
export const StatusMonitorSettings: React.FC<{ config: any; onChange: (cfg: any) => void; appConfirm: (msg: string, cb: () => void) => void; fetchConfig: () => void; addToast: (msg: string, type?: 'success' | 'error') => void }> = ({ config, onChange, appConfirm, fetchConfig, addToast }) => {
    const { t } = useDiscoverI18n();
    const [localConfig, setLocalConfig] = useState<any>({ groups: [], services: [] });

    useEffect(() => {
        if (config) {
            setLocalConfig({
                groups: config.groups || [],
                services: config.services || [],
                notifyDownAfterMinutes: Math.max(1, Math.min(1440, Math.round(Number(config.notifyDownAfterMinutes) || 5))),
            });
        }
    }, [config]);

    const addGroup = () => {
        const id = `group-${Date.now()}`;
        const newConfig = { ...localConfig, groups: [...localConfig.groups, { id, name: 'New Group', order: localConfig.groups.length }] };
        setLocalConfig(newConfig);
        onChange(newConfig);
    };

    const addService = () => {
        const id = `service-${Date.now()}`;
        const newService = {
            id,
            name: 'New Service',
            url: '',
            category: 'web',
            type: 'http',
            groupId: null,
            isCritical: true,
            visibleToUsers: true,
            description: ''
        };
        const newConfig = { ...localConfig, services: [...localConfig.services, newService] };
        setLocalConfig(newConfig);
        onChange(newConfig);
    };

    const updateGroup = (id: string, field: string, value: any) => {
        const newConfig = {
            ...localConfig,
            groups: localConfig.groups.map((g: any) => g.id === id ? { ...g, [field]: value } : g)
        };
        setLocalConfig(newConfig);
        onChange(newConfig);
    };

    const updateService = (id: string, field: string, value: any) => {
        const newConfig = {
            ...localConfig,
            services: localConfig.services.map((s: any) => s.id === id ? { ...s, [field]: value } : s)
        };
        setLocalConfig(newConfig);
        onChange(newConfig);
    };

    const removeGroup = async (id: string) => {
        const groupName = localConfig.groups.find((g: any) => g.id === id)?.name || t('settings.statusMonitor.thisGroup');
        appConfirm(t('settings.statusMonitor.removeGroupConfirm', { groupName }), () => {
            const newConfig = {
                ...localConfig,
                groups: localConfig.groups.filter((g: any) => g.id !== id),
                services: localConfig.services.map((s: any) => s.groupId === id ? { ...s, groupId: null } : s)
            };
            setLocalConfig(newConfig);
            onChange(newConfig);
        });
    };

    const removeService = async (id: string) => {
        appConfirm(t('settings.statusMonitor.removeServiceConfirm', { id }), () => {
            const newConfig = {
                ...localConfig,
                services: localConfig.services.filter((s: any) => s.id !== id)
            };
            setLocalConfig(newConfig);
            onChange(newConfig);
        });
    };

    const handleResetStats = () => {
        appConfirm(t('settings.statusMonitor.resetConfirm'), async () => {
            try {
                const res = await apiFetch('/api/status/reset', { method: 'POST' });
                if (res.error) throw new Error(res.error);
                addToast(t('settings.statusMonitor.resetSuccess'), 'success');
            } catch (e: any) {
                addToast(e.message || t('settings.statusMonitor.resetFailed'), 'error');
            }
        });
    };

    return (
        <div className="flex flex-col gap-8 w-full">
            <div>
                <h4 className="font-bold text-xl text-text mb-2">{t('settings.statusMonitor.notifyDownAfterMinutes')}</h4>
                <p className="text-muted text-sm mb-3 max-w-2xl">{t('settings.statusMonitor.notifyDownAfterHint')}</p>
                <input
                    type="number"
                    min={1}
                    max={1440}
                    value={localConfig.notifyDownAfterMinutes ?? 5}
                    onChange={(e) => {
                        const notifyDownAfterMinutes = Math.max(1, Math.min(1440, Math.round(Number(e.target.value) || 5)));
                        const newConfig = { ...localConfig, notifyDownAfterMinutes };
                        setLocalConfig(newConfig);
                        onChange(newConfig);
                    }}
                    className="w-28 p-3 rounded-lg bg-background border border-border focus:border-plex outline-none text-sm"
                />
            </div>
            <div>
                <div className="flex justify-between items-center mb-4 border-b border-border pb-3">
                    <h4 className="font-bold text-xl text-text">{t('settings.statusMonitor.serviceGroups')}</h4>
                    <button onClick={addGroup} className="px-4 py-2 bg-white/10 hover:bg-white/20 text-text rounded-md text-sm font-bold transition-colors">{t('settings.statusMonitor.addGroup')}</button>
                </div>
                {localConfig.groups.map((group: any) => (
                    <div key={group.id} className="flex flex-col sm:flex-row sm:items-center gap-3 mb-3">
                        <input
                            type="text"
                            value={group.name}
                            onChange={(e) => updateGroup(group.id, 'name', e.target.value)}
                            className="flex-1 w-full p-3 rounded-lg bg-background border border-border focus:border-plex outline-none text-sm"
                            placeholder={t('settings.statusMonitor.groupNamePlaceholder')}
                        />
                        <button type="button" onClick={() => removeGroup(group.id)} className="px-4 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 rounded-md text-xs font-bold transition-colors flex-shrink-0 sm:w-[5.75rem]">{t('common.remove')}</button>
                    </div>
                ))}
                {localConfig.groups.length === 0 && <p className="text-muted text-sm italic py-2">{t('settings.statusMonitor.noGroups')}</p>}
            </div>

            <div>
                <div className="flex justify-between items-center mb-4 border-b border-border pb-3">
                    <h4 className="font-bold text-xl text-text">{t('settings.statusMonitor.monitoredServices')}</h4>
                    <button onClick={addService} className="px-4 py-2 bg-plex text-background hover:bg-plex-hover rounded-md text-sm font-bold transition-colors shadow-lg">{t('settings.statusMonitor.addService')}</button>
                </div>
                <p className="text-xs text-muted mb-4">
                    {t('settings.statusMonitor.visibilityHintBefore')} <span className="text-text font-semibold">{t('settings.statusMonitor.usersVisibleHidden')}</span> {t('settings.statusMonitor.visibilityHintAfter')}
                </p>
                <div className="flex flex-col gap-6">
                    {localConfig.services.map((service: any) => (
                        <div key={service.id} className="flex flex-col gap-3 pb-6 border-b border-border/40 last:border-b-0 last:pb-0">
                            <div>
                                <label className="block text-sm text-muted mb-1">{t('settings.statusMonitor.serviceName')}</label>
                                <input
                                    type="text"
                                    value={service.name}
                                    onChange={(e) => updateService(service.id, 'name', e.target.value)}
                                    className="w-full p-3 rounded-lg bg-background border border-border focus:border-plex outline-none text-sm font-bold"
                                    placeholder={t('settings.statusMonitor.serviceName')}
                                />
                            </div>
                            <div>
                                <label className="block text-sm text-muted mb-1">{t('settings.statusMonitor.serviceUrl')}</label>
                                <input
                                    type="text"
                                    value={service.url}
                                    onChange={(e) => updateService(service.id, 'url', e.target.value)}
                                    className="w-full p-3 rounded-lg bg-background border border-border focus:border-plex outline-none text-sm font-mono"
                                    placeholder={t('settings.statusMonitor.serviceUrlPlaceholder')}
                                />
                            </div>
                            <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                                <div className="flex items-center gap-2">
                                    <span className="text-muted">{t('settings.statusMonitor.groupLabel')}</span>
                                    <div className="w-48">
                                        <CustomSelect
                                            value={service.groupId || ''}
                                            onChange={(val) => updateService(service.id, 'groupId', val || null)}
                                            options={[
                                                { label: t('settings.statusMonitor.none'), value: '' },
                                                ...localConfig.groups.map((g: any) => ({ label: g.name, value: g.id }))
                                            ]}
                                        />
                                    </div>
                                </div>
                                <div className="flex items-center gap-2 flex-shrink-0 ml-auto flex-wrap justify-end">
                                    <button
                                        type="button"
                                        onClick={() => updateService(service.id, 'visibleToUsers', service.visibleToUsers === false)}
                                        className={`px-3 py-1.5 rounded text-xs font-bold transition-colors flex items-center gap-2 ${service.visibleToUsers !== false ? 'bg-plex/20 text-plex hover:bg-plex/30' : 'bg-white/10 text-muted hover:bg-white/20'}`}
                                        title={service.visibleToUsers !== false ? t('settings.statusMonitor.visibleTooltip') : t('settings.statusMonitor.hiddenTooltip')}
                                    >
                                        {t('settings.statusMonitor.usersLabel')} {service.visibleToUsers !== false ? t('settings.statusMonitor.visible') : t('settings.statusMonitor.hidden')}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => updateService(service.id, 'isCritical', !service.isCritical)}
                                        className={`px-3 py-1.5 rounded text-xs font-bold transition-colors flex items-center gap-2 ${service.isCritical ? 'bg-green-500/20 text-green-400 hover:bg-green-500/30' : 'bg-white/10 text-muted hover:bg-white/20'}`}
                                    >
                                        {t('settings.statusMonitor.criticalLabel')} {service.isCritical ? t('settings.statusMonitor.yes') : t('settings.statusMonitor.no')}
                                    </button>
                                    <button type="button" onClick={() => removeService(service.id)} className="px-4 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 rounded-md text-xs font-bold transition-colors w-[5.75rem]">{t('common.remove')}</button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
                {localConfig.services.length === 0 && <p className="text-muted text-sm italic py-2">{t('settings.statusMonitor.noServices')}</p>}
            </div>

            <div className="border-t border-border/40 pt-6 mt-2">
                <h4 className="font-bold text-xl text-text mb-2">{t('settings.statusMonitor.resetStatistics')}</h4>
                <p className="text-sm text-muted mb-4">{t('settings.statusMonitor.resetDescription')}</p>
                <button
                    type="button"
                    onClick={handleResetStats}
                    className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-md text-sm font-bold transition-colors shadow-lg"
                >
                    {t('settings.statusMonitor.resetUptimeData')}
                </button>
            </div>
        </div>
    );
};
