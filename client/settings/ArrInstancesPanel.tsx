import React, { useEffect, useState } from 'react';
import { Plus, Trash2, Star, Loader2 } from 'lucide-react';
import type { ArrInstance } from '../shared/types';
import { apiFetch } from '../shared/api';
import { IntegrationTestButton } from '../shared/IntegrationTestButton';
import { SettingsSwitch, CustomSelect } from '../shared/ui';

const SECRET_MASK = '••••••••';
type ArrAppType = ArrInstance['type'];

const ARR_ICON_URLS: Record<ArrAppType, string> = {
    sonarr: 'https://cdn.jsdelivr.net/gh/selfhst/icons/svg/sonarr.svg',
    radarr: 'https://cdn.jsdelivr.net/gh/selfhst/icons/svg/radarr.svg',
    lidarr: 'https://cdn.jsdelivr.net/gh/selfhst/icons/svg/lidarr.svg',
    bazarr: 'https://cdn.jsdelivr.net/gh/selfhst/icons/svg/bazarr.svg',
};

const ARR_APP_LABELS: Record<ArrAppType, string> = {
    sonarr: 'Sonarr',
    radarr: 'Radarr',
    lidarr: 'Lidarr',
    bazarr: 'Bazarr',
};

const ARR_APP_PLACEHOLDERS: Record<ArrAppType, { url: string; externalUrl: string }> = {
    sonarr: { url: 'http://localhost:8989', externalUrl: 'https://sonarr.yourdomain.com' },
    radarr: { url: 'http://localhost:7878', externalUrl: 'https://radarr.yourdomain.com' },
    lidarr: { url: 'http://localhost:8686', externalUrl: 'https://lidarr.yourdomain.com' },
    bazarr: { url: 'http://localhost:6767', externalUrl: 'https://bazarr.yourdomain.com' },
};

const hasCredentials = (
    instance: ArrInstance,
    saved?: ArrInstance,
) => {
    const effectiveUrl = String(instance.url || saved?.url || '').trim();
    const draftKey = String(instance.apiKey || '').trim();
    const savedKey = String(saved?.apiKey || '').trim();
    const hasKey = (draftKey && draftKey !== SECRET_MASK) || !!savedKey;
    return Boolean(effectiveUrl && hasKey);
};

const generateId = () => {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
};

export const createEmptyArrInstance = (type: ArrAppType, isDefault = false): ArrInstance => ({
    id: generateId(),
    type,
    name: ARR_APP_LABELS[type],
    url: '',
    externalUrl: '',
    apiKey: '',
    enabled: true,
    isDefault,
    is4k: false,
    plexLibraryIds: [],
    defaultQualityProfileId: null,
    defaultRootFolder: '',
});

type PlexLibrary = {
    id: string;
    title: string;
    type: string;
};

export type ArrInstancesPanelCopy = {
    addInstance: string;
    noInstances: (appName: string) => string;
    instanceLabel: (index: number) => string;
    defaultLabel: string;
    defaultInstanceTitle: string;
    setAsDefaultTitle: string;
    removeInstanceTitle: string;
    displayName: string;
    ultraHdInstance: string;
    ultraHdRoutingHint: string;
    url: string;
    externalUrl: string;
    externalUrlOptional: string;
    apiKey: string;
    apiKeyPlaceholder: string;
    plexLibraries: string;
    libraryMappingHint: string;
    assignedElsewhere: string;
    defaultQualityProfile: string;
    defaultRootFolder: string;
    routingDefaultsHint: string;
    useArrDefault: string;
    optionsNeedCredentials: string;
    optionsLoadFailed: string;
    testConnection: string;
    connectionSuccessful: string;
    connectionFailed: string;
};

const DEFAULT_COPY: ArrInstancesPanelCopy = {
    addInstance: 'Add Instance',
    noInstances: (appName) => `No ${appName} instances configured.`,
    instanceLabel: (index) => `Instance ${index}`,
    defaultLabel: 'Default',
    defaultInstanceTitle: 'Default instance',
    setAsDefaultTitle: 'Set as default',
    removeInstanceTitle: 'Remove instance',
    displayName: 'Display Name',
    ultraHdInstance: '4K / UHD instance',
    ultraHdRoutingHint: 'Request modal routes Ultra HD requests here (can select HD + UHD together).',
    url: 'URL',
    externalUrl: 'External URL',
    externalUrlOptional: 'Optional, for UI links',
    apiKey: 'API Key',
    apiKeyPlaceholder: 'API key',
    plexLibraries: 'Plex Libraries',
    libraryMappingHint: 'Map libraries to this instance for maintenance routing. Unmapped libraries use the default instance.',
    assignedElsewhere: 'Assigned to another instance',
    defaultQualityProfile: 'Default quality profile',
    defaultRootFolder: 'Default root folder',
    routingDefaultsHint: 'Used when a request does not pick Advanced options. Leave on *arr default to use the first profile or folder from this instance.',
    useArrDefault: 'Use *arr default',
    optionsNeedCredentials: 'Enter a URL and API key to load profiles and folders.',
    optionsLoadFailed: 'Could not load profiles and root folders from this instance.',
    testConnection: 'Test Connection',
    connectionSuccessful: 'Connection successful',
    connectionFailed: 'Connection failed',
};

type Props = {
    type: ArrAppType;
    title: string;
    subtitle: string;
    instances: ArrInstance[];
    savedInstances: ArrInstance[];
    libraries?: PlexLibrary[];
    allInstances?: ArrInstance[];
    onChange: (instances: ArrInstance[]) => void;
    onMessage: (message: string, success: boolean) => void;
    className?: string;
    copy?: Partial<ArrInstancesPanelCopy>;
};

type RoutingOptions = {
    profiles: { id: number; name: string }[];
    rootFolders: { id: number; path: string; freeSpace?: number | null }[];
};

const ArrInstanceRoutingDefaults: React.FC<{
    type: ArrAppType;
    instance: ArrInstance;
    saved?: ArrInstance;
    copy: ArrInstancesPanelCopy;
    onChange: (patch: Partial<ArrInstance>) => void;
}> = ({ type, instance, saved, copy, onChange }) => {
    const [loading, setLoading] = useState(false);
    const [loadError, setLoadError] = useState('');
    const [options, setOptions] = useState<RoutingOptions>({ profiles: [], rootFolders: [] });
    const canLoad = hasCredentials(instance, saved);

    useEffect(() => {
        if (!canLoad) {
            setOptions({ profiles: [], rootFolders: [] });
            setLoadError('');
            setLoading(false);
            return undefined;
        }
        let cancelled = false;
        const timer = window.setTimeout(() => {
            setLoading(true);
            void (async () => {
                try {
                    const data = await apiFetch('/api/arr/options', {
                        method: 'POST',
                        body: JSON.stringify({
                            instanceId: instance.id,
                            type,
                            url: instance.url,
                            apiKey: instance.apiKey,
                        }),
                    });
                    if (cancelled) return;
                    setOptions({
                        profiles: Array.isArray(data?.profiles) ? data.profiles : [],
                        rootFolders: Array.isArray(data?.rootFolders) ? data.rootFolders : [],
                    });
                    setLoadError('');
                } catch (error) {
                    if (cancelled) return;
                    setOptions({ profiles: [], rootFolders: [] });
                    setLoadError(error instanceof Error ? error.message : copy.optionsLoadFailed);
                } finally {
                    if (!cancelled) setLoading(false);
                }
            })();
        }, 400);
        return () => {
            cancelled = true;
            window.clearTimeout(timer);
        };
    }, [canLoad, copy.optionsLoadFailed, instance.apiKey, instance.id, instance.url, type]);

    const profileValue = instance.defaultQualityProfileId != null ? String(instance.defaultQualityProfileId) : '';
    const folderValue = instance.defaultRootFolder || '';
    const profileIds = new Set(options.profiles.map((profile) => String(profile.id)));
    const folderPaths = new Set(options.rootFolders.map((folder) => folder.path));
    const profileSelectOptions = [
        { value: '', label: copy.useArrDefault },
        ...options.profiles.map((profile) => ({ value: String(profile.id), label: profile.name })),
        ...(profileValue && !profileIds.has(profileValue)
            ? [{ value: profileValue, label: `Profile ${profileValue}` }]
            : []),
    ];
    const folderSelectOptions = [
        { value: '', label: copy.useArrDefault },
        ...options.rootFolders.map((folder) => ({ value: folder.path, label: folder.path })),
        ...(folderValue && !folderPaths.has(folderValue)
            ? [{ value: folderValue, label: folderValue }]
            : []),
    ];

    return (
        <div className="space-y-3">
            <p className="text-[11px] text-muted">{copy.routingDefaultsHint}</p>
            <div className={`grid grid-cols-1 sm:grid-cols-2 gap-3 ${!canLoad ? 'opacity-50 pointer-events-none' : ''}`}>
                <div>
                    <label className="text-xs text-muted uppercase tracking-wider font-bold mb-1 flex items-center gap-2">
                        {copy.defaultQualityProfile}
                        {loading ? <Loader2 className="w-3 h-3 animate-spin text-plex" /> : null}
                    </label>
                    <CustomSelect
                        compact
                        value={profileValue}
                        onChange={(next) => {
                            onChange({ defaultQualityProfileId: next ? Number(next) : null });
                        }}
                        options={profileSelectOptions}
                    />
                </div>
                <div>
                    <label className="text-xs text-muted uppercase tracking-wider font-bold mb-1 block">
                        {copy.defaultRootFolder}
                    </label>
                    <CustomSelect
                        compact
                        value={folderValue}
                        onChange={(next) => onChange({ defaultRootFolder: next })}
                        options={folderSelectOptions}
                    />
                </div>
            </div>
            {!canLoad ? (
                <p className="text-[11px] text-muted">{copy.optionsNeedCredentials}</p>
            ) : loadError ? (
                <p className="text-[11px] text-amber-300">{loadError}</p>
            ) : null}
        </div>
    );
};

export const ArrInstancesPanel: React.FC<Props> = ({
    type,
    title,
    subtitle,
    instances,
    savedInstances,
    libraries = [],
    allInstances = [],
    onChange,
    onMessage,
    className = '',
    copy: copyOverrides = {},
}) => {
    const copy = { ...DEFAULT_COPY, ...copyOverrides } as ArrInstancesPanelCopy;
    const libraryType = type === 'radarr' ? 'movie' : 'show';
    const supportsLibraryMapping = type === 'sonarr' || type === 'radarr';
    const availableLibraries = supportsLibraryMapping
        ? libraries.filter((entry) => String(entry.type || '').toLowerCase() === libraryType)
        : [];
    const appName = ARR_APP_LABELS[type];

    const librariesAssignedElsewhere = (instanceId: string) => {
        const assigned = new Set<string>();
        allInstances
            .filter((entry) => entry.id !== instanceId && entry.type === type)
            .forEach((entry) => {
                (entry.plexLibraryIds || []).forEach((libraryId) => assigned.add(String(libraryId)));
            });
        return assigned;
    };

    const toggleLibrary = (instanceId: string, libraryId: string) => {
        const instance = instances.find((entry) => entry.id === instanceId);
        if (!instance) return;
        const current = new Set((instance.plexLibraryIds || []).map((entry) => String(entry)));
        if (current.has(libraryId)) current.delete(libraryId);
        else current.add(libraryId);
        updateInstance(instanceId, { plexLibraryIds: Array.from(current) });
    };
    const updateInstance = (id: string, patch: Partial<ArrInstance>) => {
        onChange(instances.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)));
    };

    const removeInstance = (id: string) => {
        const next = instances.filter((entry) => entry.id !== id);
        if (next.length > 0 && !next.some((entry) => entry.isDefault)) {
            next[0] = { ...next[0], isDefault: true };
        }
        onChange(next);
    };

    const setDefault = (id: string) => {
        onChange(instances.map((entry) => ({ ...entry, isDefault: entry.id === id })));
    };

    const addInstance = () => {
        onChange([
            ...instances,
            createEmptyArrInstance(type, instances.length === 0),
        ]);
    };

    const supportsRoutingDefaults = type === 'sonarr' || type === 'radarr' || type === 'lidarr';

    return (
        <div className={className}>
            <div className="flex items-start justify-between gap-4 mb-4">
                <div className="flex items-start gap-3 min-w-0">
                    <span className="w-11 h-11 rounded-lg bg-background border border-border flex items-center justify-center overflow-hidden shrink-0">
                        <img
                            src={ARR_ICON_URLS[type]}
                            alt=""
                            className="w-8 h-8 object-contain"
                            onError={(e) => { e.currentTarget.style.display = 'none'; }}
                        />
                    </span>
                    <div className="min-w-0">
                        <h3 className="text-lg font-bold text-plex">{title}</h3>
                        <p className="text-sm text-muted mt-1">{subtitle}</p>
                    </div>
                </div>
                <button
                    type="button"
                    onClick={addInstance}
                    className="px-3 py-2 rounded-lg border border-border text-sm font-medium text-text hover:bg-white/5 transition-colors flex items-center gap-2 shrink-0"
                >
                    <Plus className="w-4 h-4" />
                    {copy.addInstance}
                </button>
            </div>

            {instances.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border p-6 text-sm text-muted text-center">
                    {copy.noInstances(appName)}
                </div>
            ) : (
                <div className="space-y-4">
                    {instances.map((instance, index) => {
                        const saved = savedInstances.find((entry) => entry.id === instance.id);
                        const testPayload = {
                            [`${type}Url`]: instance.url,
                            [`${type}ApiKey`]: instance.apiKey,
                            instanceId: instance.id,
                        };

                        return (
                            <div key={instance.id} className="rounded-xl border border-border bg-background/40 p-4 space-y-3">
                                <div className="flex items-center justify-between gap-3">
                                    <div className="flex items-center gap-2 min-w-0">
                                        <img
                                            src={ARR_ICON_URLS[type]}
                                            alt=""
                                            className="w-5 h-5 object-contain shrink-0"
                                            onError={(e) => { e.currentTarget.style.display = 'none'; }}
                                        />
                                        <span className="text-xs uppercase tracking-wider font-bold text-muted">
                                            {copy.instanceLabel(index + 1)}
                                        </span>
                                        {instance.isDefault && (
                                            <span className="text-[10px] uppercase tracking-wider font-bold text-plex bg-plex/10 px-2 py-0.5 rounded-full">
                                                {copy.defaultLabel}
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                        <SettingsSwitch
                                            checked={instance.enabled !== false}
                                            onChange={(enabled) => updateInstance(instance.id, { enabled })}
                                            className="!ml-0"
                                        />
                                        <button
                                            type="button"
                                            title={instance.isDefault ? copy.defaultInstanceTitle : copy.setAsDefaultTitle}
                                            onClick={() => setDefault(instance.id)}
                                            className={`p-2 rounded-lg transition-colors ${instance.isDefault ? 'text-plex bg-plex/10' : 'text-muted hover:text-text hover:bg-white/5'}`}
                                        >
                                            <Star className={`w-4 h-4 ${instance.isDefault ? 'fill-current' : ''}`} />
                                        </button>
                                        <button
                                            type="button"
                                            title={copy.removeInstanceTitle}
                                            onClick={() => removeInstance(instance.id)}
                                            className="p-2 rounded-lg text-muted hover:text-red-400 hover:bg-red-500/10 transition-colors"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                </div>

                                <div>
                                    <label className="text-xs text-muted uppercase tracking-wider font-bold mb-1 block">{copy.displayName}</label>
                                    <input
                                        className="appearance-none text-[16px] leading-5 w-full p-2.5 rounded-lg border border-border bg-background text-text outline-none focus:border-plex focus:ring-1 focus:ring-plex transition-all text-[16px]"
                                        type="text"
                                        value={instance.name}
                                        onChange={(e) => updateInstance(instance.id, { name: e.target.value })}
                                        placeholder={appName}
                                    />
                                </div>

                                {supportsLibraryMapping && (
                                    <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-background/40 px-3 py-2">
                                        <div className="min-w-0">
                                            <p className="text-sm font-semibold text-text">{copy.ultraHdInstance}</p>
                                            <p className="text-[11px] text-muted">
                                                {copy.ultraHdRoutingHint}
                                            </p>
                                        </div>
                                        <SettingsSwitch
                                            checked={!!instance.is4k}
                                            onChange={(is4k) => updateInstance(instance.id, { is4k })}
                                            className="!ml-0"
                                        />
                                    </div>
                                )}

                                <div>
                                    <label className="text-xs text-muted uppercase tracking-wider font-bold mb-1 block">{copy.url}</label>
                                    <input
                                        className="appearance-none text-[16px] leading-5 w-full p-2.5 rounded-lg border border-border bg-background text-text outline-none focus:border-plex focus:ring-1 focus:ring-plex transition-all text-[16px]"
                                        type="text"
                                        value={instance.url}
                                        onChange={(e) => updateInstance(instance.id, { url: e.target.value })}
                                        placeholder={ARR_APP_PLACEHOLDERS[type].url}
                                    />
                                </div>

                                <div>
                                    <label className="text-xs text-muted uppercase tracking-wider font-bold mb-1 flex items-center gap-2">
                                        {copy.externalUrl} <span className="text-[10px] font-normal normal-case text-muted/70">({copy.externalUrlOptional})</span>
                                    </label>
                                    <input
                                        className="appearance-none text-[16px] leading-5 w-full p-2.5 rounded-lg border border-border bg-background text-text outline-none focus:border-plex focus:ring-1 focus:ring-plex transition-all text-[16px]"
                                        type="text"
                                        value={instance.externalUrl || ''}
                                        onChange={(e) => updateInstance(instance.id, { externalUrl: e.target.value })}
                                        placeholder={ARR_APP_PLACEHOLDERS[type].externalUrl}
                                    />
                                </div>

                                <div>
                                    <label className="text-xs text-muted uppercase tracking-wider font-bold mb-1 block">{copy.apiKey}</label>
                                    <input
                                        className="appearance-none text-[16px] leading-5 w-full p-2.5 rounded-lg border border-border bg-background text-text outline-none focus:border-plex focus:ring-1 focus:ring-plex transition-all text-[16px]"
                                        type="password"
                                        value={instance.apiKey}
                                        onChange={(e) => updateInstance(instance.id, { apiKey: e.target.value })}
                                        placeholder={copy.apiKeyPlaceholder}
                                    />
                                </div>

                                {supportsRoutingDefaults ? (
                                    <ArrInstanceRoutingDefaults
                                        type={type}
                                        instance={instance}
                                        saved={saved}
                                        copy={copy}
                                        onChange={(patch) => updateInstance(instance.id, patch)}
                                    />
                                ) : null}

                                {availableLibraries.length > 0 && (
                                    <div>
                                        <label className="text-xs text-muted uppercase tracking-wider font-bold mb-1 block">{copy.plexLibraries}</label>
                                        <p className="text-[11px] text-muted mb-2">
                                            {copy.libraryMappingHint}
                                        </p>
                                        <div className="flex flex-wrap gap-2">
                                            {availableLibraries.map((library) => {
                                                const libraryId = String(library.id);
                                                const selected = (instance.plexLibraryIds || []).includes(libraryId);
                                                const takenElsewhere = librariesAssignedElsewhere(instance.id).has(libraryId);
                                                return (
                                                    <button
                                                        key={`${instance.id}-${libraryId}`}
                                                        type="button"
                                                        disabled={takenElsewhere && !selected}
                                                        title={takenElsewhere && !selected ? copy.assignedElsewhere : library.title}
                                                        onClick={() => toggleLibrary(instance.id, libraryId)}
                                                        className={`px-2.5 py-1 rounded-md text-xs border transition-colors ${
                                                            selected
                                                                ? 'bg-plex/15 border-plex/40 text-plex'
                                                                : takenElsewhere
                                                                    ? 'bg-background/20 border-border text-muted/50 cursor-not-allowed'
                                                                    : 'bg-background/30 border-border text-text hover:border-plex/40'
                                                        }`}
                                                    >
                                                        {library.title}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}

                                <IntegrationTestButton
                                    type={type}
                                    payload={testPayload}
                                    disabled={!hasCredentials(instance, saved)}
                                    label={copy.testConnection}
                                    successFallback={copy.connectionSuccessful}
                                    failureFallback={copy.connectionFailed}
                                    onMessage={onMessage}
                                />
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};
