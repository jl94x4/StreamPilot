import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Copy, Download, Eye, EyeOff, FileUp, Loader2, Plus, RefreshCw, Trash2, Upload } from 'lucide-react';
import { SettingsToggleRow } from '../shared/ui';
import { SettingHint } from './SettingHint';
import { apiFetch } from '../shared/api';
import { usePoll } from '../shared/usePoll';
import { useDiscoverI18n } from '../discovery/i18n';
import { scannerActionStyles, sourceAppLabel } from '../scanner/eventMeta';
import { ScannerSourceBadge } from '../scanner/ScannerSourceBadge';

export type RewriteRule = { from: string; to: string };
export type ScannerTrigger = { name: string; priority: number; rewrite: RewriteRule[] };
export type ScannerTarget = {
    enabled: boolean;
    usePortalCredentials: boolean;
    url: string;
    token?: string;
    apiKey?: string;
    rewrite: RewriteRule[];
};

export type ScannerSettings = {
    minimumAge: string;
    verifyPathExists: boolean;
    authUsername: string;
    authPassword: string;
    triggers: {
        sonarr: ScannerTrigger[];
        radarr: ScannerTrigger[];
        lidarr: ScannerTrigger[];
        mediaAutomation: ScannerTrigger[];
    };
    targets: {
        plex: ScannerTarget[];
        jellyfin: ScannerTarget[];
        emby: ScannerTarget[];
    };
};

export const defaultScannerSettings = (): ScannerSettings => ({
    minimumAge: '1m',
    verifyPathExists: false,
    authUsername: '',
    authPassword: '',
    triggers: {
        sonarr: [{ name: 'sonarr', priority: 1, rewrite: [] }],
        radarr: [{ name: 'radarr', priority: 1, rewrite: [] }],
        lidarr: [{ name: 'lidarr', priority: 1, rewrite: [] }],
        mediaAutomation: [{ name: 'media-automation', priority: 20, rewrite: [] }],
    },
    targets: {
        plex: [{ enabled: true, usePortalCredentials: true, url: '', token: '', rewrite: [] }],
        jellyfin: [{ enabled: false, usePortalCredentials: true, url: '', apiKey: '', rewrite: [] }],
        emby: [{ enabled: false, usePortalCredentials: true, url: '', apiKey: '', rewrite: [] }],
    },
});

const FIELD =
    'w-full p-2.5 rounded-lg border border-border bg-background text-text placeholder:text-muted/60 focus:outline-none focus:ring-2 focus:ring-accent/30 disabled:opacity-50';

const SectionCard: React.FC<{ title: string; description?: string; children: React.ReactNode }> = ({
    title,
    description,
    children,
}) => (
    <div className="rounded-xl border border-border/60 bg-white/[0.02] p-4 sm:p-5 space-y-4">
        <div>
            <h4 className="font-bold text-text tracking-tight">{title}</h4>
            {description ? <p className="text-xs text-muted mt-1 leading-relaxed">{description}</p> : null}
        </div>
        {children}
    </div>
);

const RewriteEditor: React.FC<{
    rules: RewriteRule[];
    onChange: (rules: RewriteRule[]) => void;
    disabled?: boolean;
    fromLabel?: string;
    toLabel?: string;
}> = ({
    rules,
    onChange,
    disabled,
    fromLabel,
    toLabel,
}) => {
    const { t } = useDiscoverI18n();
    const sourceLabel = fromLabel || t('scanner.settings.pathRewrites.sourcePath');
    const destinationLabel = toLabel || t('scanner.settings.pathRewrites.destinationPath');

    return (
    <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
            <label className="text-xs font-semibold text-muted uppercase tracking-wider">{t('scanner.settings.pathRewrites.title')}</label>
            <button
                type="button"
                className="btn-secondary inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs disabled:opacity-50"
                disabled={disabled}
                onClick={() => onChange([...(rules || []), { from: '', to: '' }])}
            >
                <Plus className="w-3.5 h-3.5" />
                {t('scanner.settings.pathRewrites.add')}
            </button>
        </div>
        {(rules || []).length === 0 ? (
            <p className="text-xs text-muted py-2">{t('scanner.settings.pathRewrites.empty')}</p>
        ) : (
            <div className="space-y-2">
                {(rules || []).map((rule, i) => (
                    <div key={i} className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-2 items-end">
                        <div>
                            <label className="text-[10px] font-bold uppercase tracking-wider text-muted block mb-1.5">
                                {sourceLabel}
                            </label>
                            <input
                                className={FIELD}
                                placeholder={sourceLabel}
                                value={rule.from}
                                disabled={disabled}
                                onChange={(e) => {
                                    const next = [...rules];
                                    next[i] = { ...next[i], from: e.target.value };
                                    onChange(next);
                                }}
                            />
                        </div>
                        <div>
                            <label className="text-[10px] font-bold uppercase tracking-wider text-muted block mb-1.5">
                                {destinationLabel}
                            </label>
                            <input
                                className={FIELD}
                                placeholder={destinationLabel}
                                value={rule.to}
                                disabled={disabled}
                                onChange={(e) => {
                                    const next = [...rules];
                                    next[i] = { ...next[i], to: e.target.value };
                                    onChange(next);
                                }}
                            />
                        </div>
                        <button
                            type="button"
                            className="inline-flex items-center justify-center h-10 w-10 rounded-lg border border-border/60 text-red-300 hover:bg-red-500/10 disabled:opacity-50"
                            disabled={disabled}
                            title={t('common.remove')}
                            onClick={() => onChange(rules.filter((_, idx) => idx !== i))}
                        >
                            <Trash2 className="w-4 h-4" />
                        </button>
                    </div>
                ))}
            </div>
        )}
    </div>
    );
};

const TRIGGER_META = {
    sonarr: { title: 'Sonarr', path: '/triggers/sonarr' },
    radarr: { title: 'Radarr', path: '/triggers/radarr' },
    lidarr: { title: 'Lidarr', path: '/triggers/lidarr' },
} as const;

const TARGET_META = {
    plex: { title: 'Plex' },
    jellyfin: { title: 'Jellyfin' },
    emby: { title: 'Emby' },
} as const;

type Props = {
    enabled: boolean;
    onEnabledChange: (v: boolean) => void;
    homeWidgetEnabled: boolean;
    onHomeWidgetEnabledChange: (v: boolean) => void;
    webhooksVisible: boolean;
    onWebhooksVisibleChange: (v: boolean) => void;
    manualPathVisible: boolean;
    onManualPathVisibleChange: (v: boolean) => void;
    scanner: ScannerSettings;
    onChange: (next: ScannerSettings) => void;
    sectionId: string;
    addToast?: (msg: string, type?: 'success' | 'error') => void;
};

export const ScannerSettingsPanel: React.FC<Props> = ({
    enabled,
    onEnabledChange,
    homeWidgetEnabled,
    onHomeWidgetEnabledChange,
    webhooksVisible,
    onWebhooksVisibleChange,
    manualPathVisible,
    onManualPathVisibleChange,
    scanner,
    onChange,
    sectionId,
    addToast,
}) => {
    const { t } = useDiscoverI18n();
    const [yamlText, setYamlText] = useState('');
    const [importing, setImporting] = useState(false);
    const [importSummary, setImportSummary] = useState<string | null>(null);
    const [yamlPreview, setYamlPreview] = useState<ScannerSettings | null>(null);
    const [yamlPreviewSummary, setYamlPreviewSummary] = useState<string | null>(null);
    const [showAuthPassword, setShowAuthPassword] = useState(false);
    const [testingTrigger, setTestingTrigger] = useState<string | null>(null);
    const [triggerTestResults, setTriggerTestResults] = useState<Record<string, { ok: boolean; message: string }>>({});
    const fileInputRef = useRef<HTMLInputElement>(null);

    const update = (patch: Partial<ScannerSettings>) => onChange({ ...scanner, ...patch });

    const updateTrigger = (kind: 'sonarr' | 'radarr' | 'lidarr' | 'mediaAutomation', index: number, patch: Partial<ScannerTrigger>) => {
        const list = [...(scanner.triggers[kind] || [])];
        list[index] = { ...list[index], ...patch };
        update({ triggers: { ...scanner.triggers, [kind]: list } });
    };

    const updateTarget = (kind: 'plex' | 'jellyfin' | 'emby', index: number, patch: Partial<ScannerTarget>) => {
        const list = [...(scanner.targets[kind] || [])];
        list[index] = { ...list[index], ...patch };
        update({ targets: { ...scanner.targets, [kind]: list } });
    };

    const testTrigger = async (
        kind: 'sonarr' | 'radarr' | 'lidarr',
        trigger: ScannerTrigger,
        index: number,
    ) => {
        const key = `${kind}-${index}`;
        setTestingTrigger(key);
        setTriggerTestResults((current) => {
            const next = { ...current };
            delete next[key];
            return next;
        });
        try {
            const result = await apiFetch('/api/scanner/test-trigger', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ kind, name: trigger.name || kind }),
            });
            const targets = Array.isArray(result?.targets) ? result.targets : [];
            const failed = targets.filter((target: any) => !target?.ok);
            const parsedPath = result?.trigger?.parsedPaths?.[0] || '';
            const rewrittenPath = result?.trigger?.rewrittenPaths?.[0] || parsedPath;
            const pathSummary = parsedPath && rewrittenPath !== parsedPath
                ? `${parsedPath} → ${rewrittenPath}`
                : rewrittenPath;
            const targetSummary = targets.length
                ? targets.map((target: any) => t('scanner.settings.triggers.targetCheck', {
                    target: String(target.type || t('scanner.settings.triggers.targetFallback')).toUpperCase(),
                    status: target.ok ? t('scanner.settings.triggers.reachable') : t('scanner.settings.triggers.failed'),
                })).join(' · ')
                : t('scanner.settings.triggers.noEnabledTargets');
            const ok = !!result?.ok && failed.length === 0;
            const message = `${ok ? t('scanner.settings.triggers.passed') : t('scanner.settings.triggers.parserPassedTargetFailed')} · ${targetSummary}${pathSummary ? ` · ${pathSummary}` : ''}`;
            setTriggerTestResults((current) => ({ ...current, [key]: { ok, message } }));
            addToast?.(
                ok
                    ? t('scanner.settings.triggers.testPassedToast', { name: TRIGGER_META[kind].title })
                    : t('scanner.settings.triggers.testTargetFailedToast', { name: TRIGGER_META[kind].title }),
                ok ? 'success' : 'error',
            );
        } catch (e: any) {
            const message = e?.message || t('scanner.settings.triggers.testFailed');
            setTriggerTestResults((current) => ({ ...current, [key]: { ok: false, message } }));
            addToast?.(message, 'error');
        } finally {
            setTestingTrigger(null);
        }
    };

    const summarizeImport = (imported: ScannerSettings) => {
        const parts = [
            t('scanner.settings.autoscan.summaryMinimumAge', { value: imported.minimumAge || '1m' }),
            imported.authUsername ? t('scanner.settings.autoscan.summaryAuth', { username: imported.authUsername }) : null,
            t('scanner.settings.autoscan.summaryRewrites', { name: 'Sonarr', count: (imported.triggers?.sonarr?.[0]?.rewrite || []).length }),
            t('scanner.settings.autoscan.summaryRewrites', { name: 'Radarr', count: (imported.triggers?.radarr?.[0]?.rewrite || []).length }),
            t('scanner.settings.autoscan.summaryRewrites', { name: 'Lidarr', count: (imported.triggers?.lidarr?.[0]?.rewrite || []).length }),
            t('scanner.settings.autoscan.summaryRewrites', { name: 'Media Automation', count: (imported.triggers?.mediaAutomation?.[0]?.rewrite || []).length }),
            t('scanner.settings.autoscan.summaryRewrites', { name: 'Plex', count: (imported.targets?.plex?.[0]?.rewrite || []).length }),
        ].filter(Boolean);
        return parts.join(' · ');
    };

    const applyImported = (imported: ScannerSettings) => {
        const next = {
            ...defaultScannerSettings(),
            ...imported,
            triggers: {
                ...defaultScannerSettings().triggers,
                ...(imported.triggers || {}),
            },
            targets: {
                ...defaultScannerSettings().targets,
                ...(imported.targets || {}),
            },
        };
        onChange(next);
        setImportSummary(summarizeImport(next));
        setYamlPreview(null);
        setYamlPreviewSummary(null);
        addToast?.(t('scanner.settings.autoscan.importedToast'), 'success');
    };

    const previewYaml = async (raw?: string) => {
        const yaml = String(raw ?? yamlText ?? '').trim();
        if (!yaml) {
            addToast?.(t('scanner.settings.autoscan.pasteOrUploadFirst'), 'error');
            return;
        }
        setImporting(true);
        try {
            const res = await apiFetch('/api/scanner/import-yaml', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ yaml }),
            });
            if (res?.imported) {
                setYamlPreview(res.imported);
                setYamlPreviewSummary(summarizeImport(res.imported));
                if (raw && raw !== yamlText) setYamlText(raw);
                addToast?.(t('scanner.settings.autoscan.yamlParsedToast'), 'success');
            }
        } catch (e: any) {
            addToast?.(e?.message || t('scanner.settings.autoscan.previewFailed'), 'error');
        } finally {
            setImporting(false);
        }
    };

    const applyYamlPreview = () => {
        if (!yamlPreview) {
            addToast?.(t('scanner.settings.autoscan.previewFirst'), 'error');
            return;
        }
        applyImported(yamlPreview);
    };

    const onPickFile = async (file: File | null) => {
        if (!file) return;
        try {
            const text = await file.text();
            setYamlText(text);
            setYamlPreview(null);
            setYamlPreviewSummary(null);
            await previewYaml(text);
        } catch {
            addToast?.(t('scanner.settings.autoscan.readFileFailed'), 'error');
        }
    };

    return (
        <div className="mb-8 animate-fade-in space-y-6">
            <h3 className="text-xl font-bold text-plex mb-4 border-b border-border pb-2">{t('navigation.scanner')}</h3>
            <section id={sectionId} className="space-y-5 scroll-mt-24">
                <p className="text-sm text-muted -mt-1 leading-relaxed">
                    {t('scanner.settings.general.description')}
                </p>

                <SectionCard
                    title={t('scanner.settings.autoscan.title')}
                    description={t('scanner.settings.autoscan.description')}
                >
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".yml,.yaml,text/yaml,text/plain"
                        className="hidden"
                        onChange={(e) => {
                            const file = e.target.files?.[0] || null;
                            e.target.value = '';
                            void onPickFile(file);
                        }}
                    />
                    <div className="flex flex-wrap gap-2">
                        <button
                            type="button"
                            disabled={importing}
                            onClick={() => fileInputRef.current?.click()}
                            className="btn-primary inline-flex items-center gap-2 px-4 py-2.5 text-sm disabled:opacity-50"
                        >
                            {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                            {t('scanner.settings.autoscan.uploadConfig')}
                        </button>
                        <button
                            type="button"
                            disabled={!yamlText.trim() || importing}
                            onClick={() => void previewYaml()}
                            className="btn-secondary inline-flex items-center gap-2 px-4 py-2.5 text-sm disabled:opacity-50"
                        >
                            <FileUp className="w-4 h-4" />
                            {t('scanner.settings.autoscan.previewPastedYaml')}
                        </button>
                        <button
                            type="button"
                            disabled={!yamlPreview || importing}
                            onClick={() => applyYamlPreview()}
                            className="btn-primary inline-flex items-center gap-2 px-4 py-2.5 text-sm disabled:opacity-50"
                        >
                            {t('scanner.settings.autoscan.applyImport')}
                        </button>
                    </div>
                    <textarea
                        className={`appearance-none text-[16px] leading-5 ${FIELD} min-h-[130px] font-mono text-[16px]`}
                        value={yamlText}
                        onChange={(e) => {
                            setYamlText(e.target.value);
                            setYamlPreview(null);
                            setYamlPreviewSummary(null);
                        }}
                        placeholder={t('scanner.settings.autoscan.placeholder')}
                    />
                    {yamlPreviewSummary ? (
                        <div className="rounded-lg border border-sky-400/20 bg-sky-500/10 px-3 py-2 text-xs text-sky-100">
                            <p className="font-semibold text-sky-200">{t('scanner.settings.autoscan.previewNotApplied')}</p>
                            <p className="mt-1">{yamlPreviewSummary}</p>
                        </div>
                    ) : null}
                    {importSummary ? (
                        <div className="rounded-lg border border-emerald-400/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200 font-semibold">
                            {t('scanner.settings.autoscan.applied')}: {importSummary}
                        </div>
                    ) : null}
                </SectionCard>

                <SectionCard title={t('scanner.settings.general.title')}>
                    <SettingsToggleRow
                        title={t('scanner.settings.general.enableTitle')}
                        hint={<SettingHint>{t('scanner.settings.general.enableHint')}</SettingHint>}
                        checked={enabled}
                        onChange={onEnabledChange}
                        border={false}
                        className="!py-0"
                    />
                    <p className={`text-xs font-semibold ${enabled ? 'text-green-300' : 'text-yellow-300'}`}>
                        {t('scanner.settings.general.currentStatus')}: {enabled ? t('scanner.settings.general.on') : t('scanner.settings.general.off')}
                    </p>
                    <SettingsToggleRow
                        title={t('scanner.settings.general.homeWidgetTitle')}
                        hint={<SettingHint>{t('scanner.settings.general.homeWidgetHint')}</SettingHint>}
                        checked={!!homeWidgetEnabled && enabled}
                        onChange={onHomeWidgetEnabledChange}
                        disabled={!enabled}
                        border={false}
                        className="!py-0"
                    />
                    <SettingsToggleRow
                        title={t('scanner.settings.general.webhooksVisibleTitle')}
                        hint={<SettingHint>{t('scanner.settings.general.webhooksVisibleHint')}</SettingHint>}
                        checked={!!webhooksVisible && enabled}
                        onChange={onWebhooksVisibleChange}
                        disabled={!enabled}
                        border={false}
                        className="!py-0"
                    />
                    <SettingsToggleRow
                        title={t('scanner.settings.general.manualPathVisibleTitle')}
                        hint={<SettingHint>{t('scanner.settings.general.manualPathVisibleHint')}</SettingHint>}
                        checked={!!manualPathVisible && enabled}
                        onChange={onManualPathVisibleChange}
                        disabled={!enabled}
                        border={false}
                        className="!py-0"
                    />
                    <div className="pt-2 max-w-md">
                        <label className="font-semibold text-sm block mb-2 text-text">{t('scanner.settings.general.minimumAge')}</label>
                        <input
                            className={FIELD}
                            value={scanner.minimumAge}
                            disabled={!enabled}
                            onChange={(e) => update({ minimumAge: e.target.value })}
                            placeholder="1m"
                        />
                        <p className="text-[11px] text-muted mt-1.5">{t('scanner.settings.general.minimumAgeHint')}</p>
                    </div>
                </SectionCard>

                <SectionCard
                    title={t('scanner.settings.webhook.title')}
                    description={t('scanner.settings.webhook.description')}
                >
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="font-semibold text-sm block mb-2 text-text">{t('scanner.settings.credentials.username')}</label>
                            <input
                                className={FIELD}
                                value={scanner.authUsername}
                                disabled={!enabled}
                                onChange={(e) => update({ authUsername: e.target.value })}
                                autoComplete="off"
                            />
                        </div>
                        <div>
                            <label className="font-semibold text-sm block mb-2 text-text">{t('scanner.settings.credentials.password')}</label>
                            <div className="relative">
                                <input
                                    key={showAuthPassword ? 'scanner-auth-visible' : 'scanner-auth-hidden'}
                                    type={showAuthPassword ? 'text' : 'password'}
                                    className={`${FIELD} pr-11`}
                                    value={scanner.authPassword}
                                    disabled={!enabled}
                                    onChange={(e) => update({ authPassword: e.target.value })}
                                    autoComplete="off"
                                    spellCheck={false}
                                />
                                <button
                                    type="button"
                                    className="absolute inset-y-0 right-0 z-10 flex items-center px-3 rounded-r-lg text-muted hover:text-text hover:bg-white/5 disabled:opacity-40 bg-transparent border-0 cursor-pointer"
                                    disabled={!enabled}
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => setShowAuthPassword((v) => !v)}
                                    aria-label={showAuthPassword ? t('scanner.settings.credentials.hidePassword') : t('scanner.settings.credentials.showPassword')}
                                    title={showAuthPassword ? t('scanner.settings.credentials.hidePassword') : t('scanner.settings.credentials.showPassword')}
                                >
                                    {showAuthPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                </button>
                            </div>
                        </div>
                    </div>
                </SectionCard>

                {(['sonarr', 'radarr', 'lidarr'] as const).map((kind) => (
                    <SectionCard
                        key={kind}
                        title={t('scanner.settings.triggers.title', { name: TRIGGER_META[kind].title })}
                        description={t('scanner.settings.triggers.webhookPath', { path: TRIGGER_META[kind].path })}
                    >
                        {(scanner.triggers[kind] || []).map((trig, i) => (
                            <div key={i} className="space-y-4">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <label className="font-semibold text-sm block mb-2 text-text">{t('scanner.settings.triggers.name')}</label>
                                        <input
                                            className={FIELD}
                                            value={trig.name}
                                            disabled={!enabled}
                                            onChange={(e) => updateTrigger(kind, i, { name: e.target.value })}
                                        />
                                        <p className="text-[11px] text-muted mt-1.5">{t('scanner.settings.triggers.urlBecomes', { path: `/triggers/${trig.name || kind}` })}</p>
                                    </div>
                                    <div>
                                        <label className="font-semibold text-sm block mb-2 text-text">{t('scanner.settings.triggers.priority')}</label>
                                        <input
                                            type="number"
                                            className={FIELD}
                                            value={trig.priority}
                                            disabled={!enabled}
                                            onChange={(e) => updateTrigger(kind, i, { priority: Number(e.target.value) || 0 })}
                                        />
                                    </div>
                                </div>
                                <RewriteEditor
                                    rules={trig.rewrite || []}
                                    disabled={!enabled}
                                    fromLabel={t('scanner.settings.pathRewrites.sourcePathFor', { name: TRIGGER_META[kind].title })}
                                    toLabel={t('scanner.settings.pathRewrites.scannerPath')}
                                    onChange={(rewrite) => updateTrigger(kind, i, { rewrite })}
                                />
                                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                                    <p className="text-[11px] text-muted">
                                        {t('scanner.settings.triggers.testHint')}
                                    </p>
                                    <button
                                        type="button"
                                        className="btn-secondary inline-flex items-center gap-2 px-3 py-2 text-xs font-semibold disabled:opacity-50"
                                        disabled={!enabled || testingTrigger !== null}
                                        onClick={() => void testTrigger(kind, trig, i)}
                                    >
                                        {testingTrigger === `${kind}-${i}` ? (
                                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                        ) : (
                                            <RefreshCw className="w-3.5 h-3.5" />
                                        )}
                                        {t('scanner.settings.triggers.testAction')}
                                    </button>
                                </div>
                                {triggerTestResults[`${kind}-${i}`] ? (
                                    <div
                                        className={`rounded-lg border px-3 py-2 text-xs font-medium break-all ${
                                            triggerTestResults[`${kind}-${i}`].ok
                                                ? 'border-emerald-400/20 bg-emerald-500/10 text-emerald-200'
                                                : 'border-red-400/20 bg-red-500/10 text-red-200'
                                        }`}
                                    >
                                        {triggerTestResults[`${kind}-${i}`].message}
                                    </div>
                                ) : null}
                            </div>
                        ))}
                    </SectionCard>
                ))}

                <SectionCard
                    title={t('scanner.settings.pathRewrites.mediaAutomationTitle')}
                    description={t('scanner.settings.pathRewrites.mediaAutomationDescription')}
                >
                    {(scanner.triggers.mediaAutomation || []).map((trig, i) => (
                        <div key={i} className="space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="font-semibold text-sm block mb-2 text-text">{t('scanner.settings.pathRewrites.label')}</label>
                                    <input
                                        className={FIELD}
                                        value={trig.name}
                                        disabled={!enabled}
                                        onChange={(e) => updateTrigger('mediaAutomation', i, { name: e.target.value })}
                                    />
                                    <p className="text-[11px] text-muted mt-1.5">
                                        {t('scanner.settings.pathRewrites.mediaAutomationLabelHint')}
                                    </p>
                                </div>
                                <div>
                                    <label className="font-semibold text-sm block mb-2 text-text">{t('scanner.settings.triggers.priority')}</label>
                                    <input
                                        type="number"
                                        className={FIELD}
                                        value={trig.priority}
                                        disabled={!enabled}
                                        onChange={(e) => updateTrigger('mediaAutomation', i, { priority: Number(e.target.value) || 0 })}
                                    />
                                </div>
                            </div>
                            <RewriteEditor
                                rules={trig.rewrite || []}
                                disabled={!enabled}
                                fromLabel={t('scanner.settings.pathRewrites.automationPath')}
                                toLabel={t('scanner.settings.pathRewrites.scannerOrPlexPath')}
                                onChange={(rewrite) => updateTrigger('mediaAutomation', i, { rewrite })}
                            />
                            <p className="text-[11px] text-muted">
                                {t('scanner.settings.pathRewrites.mediaAutomationExamplePrefix')} <code className="text-plex">/media/TV SHOWS</code> → <code className="text-plex">/mnt/user/TV SHOWS</code>.
                                {t('scanner.settings.pathRewrites.mediaAutomationExampleSuffix')}
                            </p>
                        </div>
                    ))}
                </SectionCard>

                {([
                    { kind: 'plex' as const, secret: 'token' as const, portalOnly: true },
                    { kind: 'jellyfin' as const, secret: 'apiKey' as const, portalOnly: false },
                    { kind: 'emby' as const, secret: 'apiKey' as const, portalOnly: false },
                ]).map(({ kind, secret, portalOnly }) => (
                    <SectionCard
                        key={kind}
                        title={t('scanner.settings.targets.title', { name: TARGET_META[kind].title })}
                        description={
                            portalOnly
                                ? t('scanner.settings.targets.plexDescription')
                                : t('scanner.settings.targets.optionalDescription', { name: TARGET_META[kind].title })
                        }
                    >
                        {(scanner.targets[kind] || []).map((tgt, i) => (
                            <div key={i} className="space-y-4">
                                <SettingsToggleRow
                                    title={t('scanner.settings.targets.enable', { name: TARGET_META[kind].title })}
                                    checked={!!tgt.enabled}
                                    onChange={(v) => updateTarget(kind, i, {
                                        enabled: v,
                                        ...(portalOnly ? { usePortalCredentials: true, token: '', url: '' } : {}),
                                    })}
                                    disabled={!enabled}
                                    border={false}
                                    className="!py-0"
                                />
                                {!portalOnly ? (
                                    <>
                                        <SettingsToggleRow
                                            title={t('scanner.settings.targets.usePortalCredentials')}
                                            hint={<SettingHint>{t('scanner.settings.targets.usePortalCredentialsHint')}</SettingHint>}
                                            checked={tgt.usePortalCredentials !== false}
                                            onChange={(v) => updateTarget(kind, i, { usePortalCredentials: v })}
                                            disabled={!enabled || !tgt.enabled}
                                            border={false}
                                            className="!py-0"
                                        />
                                        {!tgt.usePortalCredentials ? (
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                <div>
                                                    <label className="font-semibold text-sm block mb-2 text-text">{t('scanner.settings.targets.url')}</label>
                                                    <input
                                                        className={FIELD}
                                                        placeholder="https://…"
                                                        value={tgt.url}
                                                        disabled={!enabled}
                                                        onChange={(e) => updateTarget(kind, i, { url: e.target.value })}
                                                    />
                                                </div>
                                                <div>
                                                    <label className="font-semibold text-sm block mb-2 text-text">{t('scanner.settings.targets.apiKey')}</label>
                                                    <input
                                                        type="password"
                                                        className={FIELD}
                                                        value={(tgt as any)[secret] || ''}
                                                        disabled={!enabled}
                                                        onChange={(e) => updateTarget(kind, i, { [secret]: e.target.value } as any)}
                                                        autoComplete="new-password"
                                                    />
                                                </div>
                                            </div>
                                        ) : null}
                                    </>
                                ) : null}
                                <RewriteEditor
                                    rules={tgt.rewrite || []}
                                    disabled={!enabled || !tgt.enabled}
                                    fromLabel={t('scanner.settings.pathRewrites.scannerPath')}
                                    toLabel={t('scanner.settings.pathRewrites.targetPath', { name: TARGET_META[kind].title })}
                                    onChange={(rewrite) => updateTarget(kind, i, { rewrite })}
                                />
                            </div>
                        ))}
                    </SectionCard>
                ))}

                <p className="text-[11px] text-muted">
                    {t('scanner.settings.targets.saveHint')}
                </p>

                <ScannerLiveLogs enabled={enabled} addToast={addToast} />
            </section>
        </div>
    );
};

type LogEntry = {
    at?: string;
    ok?: boolean;
    folder?: string;
    source?: string;
    error?: string;
    results?: any[];
    reason?: string;
    action?: string;
    title?: string;
    quality?: string;
    eventType?: string;
    isUpgrade?: boolean;
};

const formatLogTime = (iso?: string) => {
    if (!iso) return '—';
    try {
        return new Date(iso).toLocaleString();
    } catch {
        return iso;
    }
};

const formatLiveLogText = (entries: LogEntry[], meta?: { queueCount?: number; processed?: number }) => {
    const header = [
        'Scanner Live Activity',
        `Exported ${new Date().toISOString()}`,
        `Queue ${meta?.queueCount ?? 0} · Processed ${meta?.processed ?? 0}`,
        `Entries ${entries.length}`,
        '',
    ].join('\n');

    const body = entries.map((entry, i) => {
        const style = scannerActionStyles(entry.action || entry.reason, entry.isUpgrade);
        const lines = [
            `#${i + 1} ${entry.ok ? 'OK' : 'ERROR'} · ${formatLogTime(entry.at)} · ${sourceAppLabel(entry.source) || entry.source || '—'}`,
            entry.reason || entry.action ? `Reason: ${entry.reason || style.label}` : null,
            entry.title ? `Title: ${entry.title}` : null,
            `Path: ${entry.folder || '—'}`,
            entry.quality || entry.eventType
                ? `Meta: ${[entry.quality, entry.eventType].filter(Boolean).join(' · ')}`
                : null,
            entry.error ? `Error: ${entry.error}` : null,
            Array.isArray(entry.results) && entry.results.length
                ? `Targets: ${entry.results.map((r: any) => (
                    `${r.type || 'target'}${r.skipped ? ` skipped (${r.reason || 'no library'})` : ' scanned'}`
                )).join('; ')}`
                : null,
        ].filter(Boolean);
        return lines.join('\n');
    }).join('\n\n');

    return `${header}${body || '(no entries)'}\n`;
};

const PAGE_SIZE = 10;
const LIVE_LOAD_ERROR = '__scanner_live_load_error__';

const ScannerLiveLogs: React.FC<{
    enabled: boolean;
    addToast?: (msg: string, type?: 'success' | 'error') => void;
}> = ({ enabled, addToast }) => {
    const { t } = useDiscoverI18n();
    const [entries, setEntries] = useState<LogEntry[]>([]);
    const [queueCount, setQueueCount] = useState(0);
    const [processed, setProcessed] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [paused, setPaused] = useState(false);
    const [page, setPage] = useState(0);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const stickToTopRef = useRef(true);

    const refresh = useCallback(async () => {
        try {
            const [logRes, queueRes] = await Promise.all([
                apiFetch('/api/scanner/log?limit=60'),
                apiFetch('/api/scanner/queue'),
            ]);
            setEntries(Array.isArray(logRes?.entries) ? logRes.entries : []);
            setProcessed(Number(logRes?.processed) || 0);
            const active = Number(queueRes?.remaining ?? queueRes?.scans?.length) || 0;
            const waiting = Number(queueRes?.held ?? queueRes?.heldScans?.length) || 0;
            setQueueCount(active + waiting);
            setError(null);
            setLastUpdated(new Date());
        } catch (e: any) {
            setError(e?.message || LIVE_LOAD_ERROR);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    usePoll(() => { void refresh(); }, paused ? null : 3000, { immediate: false });

    const totalPages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE) || 1);
    const safePage = Math.min(page, totalPages - 1);
    const pageEntries = entries.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

    useEffect(() => {
        if (page > totalPages - 1) setPage(Math.max(0, totalPages - 1));
    }, [page, totalPages]);

    useEffect(() => {
        if (!stickToTopRef.current || !listRef.current) return;
        listRef.current.scrollTop = 0;
    }, [pageEntries]);

    const copyLogs = async () => {
        const text = formatLiveLogText(entries, { queueCount, processed });
        try {
            await navigator.clipboard.writeText(text);
            addToast?.(t('scanner.settings.live.toasts.copied'), 'success');
        } catch {
            addToast?.(t('scanner.settings.live.errors.copyFailed'), 'error');
        }
    };

    const exportLogs = () => {
        const text = formatLiveLogText(entries, { queueCount, processed });
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `scanner-live-activity-${stamp}.txt`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        addToast?.(t('scanner.settings.live.toasts.exported'), 'success');
    };

    return (
        <SectionCard
            title={t('scanner.settings.live.title')}
            description={t('scanner.settings.live.description')}
        >
            <div className="flex flex-wrap items-center gap-2 justify-between">
                <div className="flex flex-wrap items-center gap-2">
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold border shadow-[0_0_10px_rgba(59,130,246,0.15)] ${paused ? 'bg-yellow-500/10 text-yellow-300 border-yellow-500/20' : 'bg-blue-500/10 text-blue-400 border-blue-500/20 animate-pulse'}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${paused ? 'bg-yellow-300' : 'bg-blue-400'}`} />
                        {paused ? t('scanner.settings.live.status.paused') : t('scanner.settings.live.status.live')}
                    </span>
                    {!enabled ? (
                        <span className="text-xs text-yellow-300 font-semibold">{t('scanner.settings.live.disabledHint')}</span>
                    ) : null}
                    <span className="text-xs text-muted">
                        {t('scanner.settings.live.summary', { queue: queueCount, processed })}
                        {lastUpdated ? ` · ${t('scanner.settings.live.updated', { time: lastUpdated.toLocaleTimeString() })}` : ''}
                    </span>
                </div>
                <div className="flex flex-wrap gap-2">
                    <button
                        type="button"
                        className="btn-secondary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs disabled:opacity-50"
                        onClick={() => void copyLogs()}
                        disabled={!entries.length}
                        title={t('scanner.settings.live.copyTitle')}
                    >
                        <Copy className="w-3.5 h-3.5" />
                        {t('scanner.actions.copy')}
                    </button>
                    <button
                        type="button"
                        className="btn-secondary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs disabled:opacity-50"
                        onClick={exportLogs}
                        disabled={!entries.length}
                        title={t('scanner.settings.live.exportTitle')}
                    >
                        <Download className="w-3.5 h-3.5" />
                        {t('scanner.settings.live.export')}
                    </button>
                    <button
                        type="button"
                        className="btn-secondary px-3 py-1.5 text-xs"
                        onClick={() => setPaused((p) => !p)}
                    >
                        {paused ? t('scanner.settings.live.resume') : t('scanner.settings.live.pause')}
                    </button>
                    <button
                        type="button"
                        className="btn-secondary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs"
                        onClick={() => void refresh()}
                    >
                        <RefreshCw className="w-3.5 h-3.5" />
                        {t('scanner.actions.refresh')}
                    </button>
                </div>
            </div>

            {error ? (
                <div className="rounded-lg border border-red-400/20 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                    {error === LIVE_LOAD_ERROR ? t('scanner.settings.live.errors.load') : error}
                </div>
            ) : null}

            <div
                ref={listRef}
                onScroll={(e) => {
                    stickToTopRef.current = e.currentTarget.scrollTop < 24;
                }}
                className="max-h-80 overflow-y-auto rounded-xl border border-border/60 bg-black/35 font-mono text-xs"
            >
                {loading ? (
                    <div className="flex items-center gap-2 px-4 py-8 text-muted justify-center">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        {t('scanner.settings.live.loading')}
                    </div>
                ) : entries.length === 0 ? (
                    <div className="px-4 py-8 text-center text-muted">
                        {t('scanner.settings.live.empty')}
                    </div>
                ) : (
                    <ul className="divide-y divide-white/5">
                        {pageEntries.map((entry, i) => {
                            const style = scannerActionStyles(entry.action || entry.reason, entry.isUpgrade);
                            const globalIndex = safePage * PAGE_SIZE + i;
                            return (
                            <li key={`${entry.at}-${globalIndex}`} className="px-3 py-2.5 hover:bg-white/[0.03]">
                                <div className="flex flex-wrap items-center gap-2 mb-1">
                                    <span className={`font-bold uppercase tracking-wide ${entry.ok ? 'text-emerald-300' : 'text-red-300'}`}>
                                        {entry.ok ? t('scanner.activity.ok') : t('scanner.activity.error')}
                                    </span>
                                    {(entry.reason || entry.action) ? (
                                        <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full border ${style.className}`}>
                                            {entry.reason || (style.labelKey ? t(style.labelKey) : style.label)}
                                        </span>
                                    ) : null}
                                    <span className="text-muted">{formatLogTime(entry.at)}</span>
                                    <ScannerSourceBadge source={entry.source} className="text-blue-300/90" />
                                </div>
                                {entry.title ? <div className="text-text font-semibold mb-0.5">{entry.title}</div> : null}
                                <div className="text-text/90 break-all leading-relaxed">{entry.folder || '—'}</div>
                                {entry.quality || entry.eventType ? (
                                    <div className="text-muted mt-1">
                                        {[entry.quality, entry.eventType].filter(Boolean).join(' · ')}
                                    </div>
                                ) : null}
                                {entry.error ? <div className="text-red-200/90 mt-1">{entry.error}</div> : null}
                                {Array.isArray(entry.results) && entry.results.length > 0 ? (
                                    <div className="text-muted mt-1">
                                        {entry.results.map((r: any, idx: number) => (
                                            <span key={idx} className="mr-3">
                                                {r.skipped
                                                    ? t('scanner.settings.live.targetSkipped', {
                                                        target: r.type || t('scanner.settings.live.targetFallback'),
                                                        reason: r.reason || t('scanner.settings.live.noLibrary'),
                                                    })
                                                    : t('scanner.settings.live.targetScanned', {
                                                        target: r.type || t('scanner.settings.live.targetFallback'),
                                                    })}
                                            </span>
                                        ))}
                                    </div>
                                ) : null}
                            </li>
                            );
                        })}
                    </ul>
                )}
            </div>

            {entries.length > 0 ? (
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                    <p className="text-xs text-muted">
                        {t('scanner.activity.showing', {
                            from: safePage * PAGE_SIZE + 1,
                            to: Math.min(entries.length, (safePage + 1) * PAGE_SIZE),
                            total: entries.length,
                        })}
                    </p>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            className="btn-secondary inline-flex items-center gap-1 px-2.5 py-1.5 text-xs disabled:opacity-40"
                            disabled={safePage <= 0}
                            onClick={() => setPage((p) => Math.max(0, p - 1))}
                        >
                            <ChevronLeft className="w-3.5 h-3.5" />
                            {t('scanner.pagination.previous')}
                        </button>
                        <span className="text-xs font-semibold text-muted tabular-nums">
                            {safePage + 1} / {totalPages}
                        </span>
                        <button
                            type="button"
                            className="btn-secondary inline-flex items-center gap-1 px-2.5 py-1.5 text-xs disabled:opacity-40"
                            disabled={safePage >= totalPages - 1}
                            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                        >
                            {t('scanner.pagination.next')}
                            <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                    </div>
                </div>
            ) : null}
        </SectionCard>
    );
};
