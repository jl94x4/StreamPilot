import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Card } from '../components/ui/Card';
import { Input, Switch, CustomSelect } from '../components/ui/Inputs';
import { AppConfig, CategoryConfig, SpecialCollection } from '../types';
import { api } from '../api';
import { Save, Plus, Trash2, AlertCircle, ShieldAlert, CheckCircle, Sliders, RefreshCw, Power, Info, HelpCircle, Upload, Download, AlertTriangle, GitCompare, Undo2, X } from 'lucide-react';
import { DEFAULT_CONFIG } from '../constants';
import { buildExportableConfig, parseCollexionsConfigText } from '../configImport';
import { conflictsForTab, findConfigConflicts } from '../configConflicts';
import { partitionValidationIssues, validateConfigLocal, type ConfigValidationIssue } from '../configValidate';
import { diffAppConfig, revertConfigField } from '../configDiff';
import { appConfirm } from '../../shared/confirm';
import {
    displayToMmDd,
    mmDdToDisplay,
    normalizeSpecialDateFormat,
    specialDateFormatLabel,
    type SpecialDateFormat,
} from '../specialDates';

const ConfigPage: React.FC = () => {
    const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);
    const [originalConfig, setOriginalConfig] = useState<AppConfig | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [saveLabel, setSaveLabel] = useState('Save Config');
    const [restarting, setRestarting] = useState(false);
    const [showRestartBanner, setShowRestartBanner] = useState(false);
    const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');
    const [validationIssues, setValidationIssues] = useState<ConfigValidationIssue[]>([]);
    const [showDiffModal, setShowDiffModal] = useState(false);
    const [activeTab, setActiveTab] = useState<'general' | 'libraries' | 'exclusions' | 'specials' | 'categories' | 'integrations'>('general');
    const [importingPortal, setImportingPortal] = useState(false);
    const [importMessage, setImportMessage] = useState('');
    const [portalPlexAvailable, setPortalPlexAvailable] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const plexFromPortal = Boolean(config._plex_from_portal || portalPlexAvailable);

    const isDirty = originalConfig && JSON.stringify(config) !== JSON.stringify(originalConfig);
    const conflicts = useMemo(() => findConfigConflicts(config), [config]);
    const tabConflicts = useMemo(() => conflictsForTab(conflicts, activeTab), [conflicts, activeTab]);
    const warningCount = conflicts.filter(c => c.severity === 'warning').length;
    const validationErrors = validationIssues.filter(i => i.severity === 'error');
    const validationWarnings = validationIssues.filter(i => i.severity === 'warning');
    const configDiffs = useMemo(
        () => (originalConfig ? diffAppConfig(originalConfig, config) : []),
        [originalConfig, config],
    );

    // Handle browser refresh/close
    useEffect(() => {
        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            if (isDirty) {
                e.preventDefault();
                e.returnValue = '';
            }
        };
        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, [isDirty]);

    // Load config & status on mount
    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        setLoading(true);
        try {
            const [c, , defaults] = await Promise.all([
                api.getConfig(),
                api.getStatus(),
                api.getPortalDefaults().catch(() => null),
            ]);
            setConfig(c);
            setOriginalConfig(c);
            setPortalPlexAvailable(Boolean(defaults?.sources?.plex));
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const persistValidatedConfig = async (deduped: ConfigValidationIssue[]) => {
        setSaving(true);
        setSaveLabel('Saving…');
        setSaveStatus('idle');
        try {
            setValidationIssues(deduped.filter(i => i.severity === 'warning'));
            await api.saveConfig(config);

            // Re-check status to see if we need to warn user
            const s = await api.getStatus();
            const lower = s.status.toLowerCase();
            const active = lower.includes('running') || lower.includes('sleeping') || lower.includes('processing');

            if (active) {
                setShowRestartBanner(true);
                setOriginalConfig(config);
            } else {
                setSaveStatus('success');
                setOriginalConfig(config);
                setTimeout(() => setSaveStatus('idle'), 3000);
            }
        } catch (e) {
            console.error(e);
            setSaveStatus('error');
            setValidationIssues([{
                id: 'save-failed',
                severity: 'error',
                message: 'Error saving configuration. Check console.',
            }]);
        } finally {
            setSaving(false);
            setSaveLabel('Save Config');
        }
    };

    const handleSave = async () => {
        setSaving(true);
        setSaveLabel('Validating…');
        setSaveStatus('idle');
        setValidationIssues([]);
        try {
            const local = validateConfigLocal(config, { plexFromPortal });
            const { errors: localErrors } = partitionValidationIssues(local);
            if (localErrors.length) {
                setValidationIssues(local);
                setSaveStatus('error');
                setSaving(false);
                setSaveLabel('Save Config');
                return;
            }

            let remoteErrors: string[] = [];
            let remoteWarnings: string[] = [];
            try {
                const remote = await api.validateConfig(config);
                remoteErrors = remote.errors || [];
                remoteWarnings = remote.warnings || [];
            } catch (e: any) {
                // Worker validate unavailable — fall back to local-only with a soft warning
                remoteWarnings = [e?.message || 'Live Plex validation skipped (worker unreachable).'];
            }

            const merged: ConfigValidationIssue[] = [
                ...local,
                ...remoteErrors.map((message, i) => ({
                    id: `remote-err:${i}:${message}`,
                    severity: 'error' as const,
                    message,
                })),
                ...remoteWarnings.map((message, i) => ({
                    id: `remote-warn:${i}:${message}`,
                    severity: 'warning' as const,
                    message,
                })),
            ];
            // Dedupe by message
            const seen = new Set<string>();
            const deduped = merged.filter(issue => {
                const key = `${issue.severity}:${issue.message}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });

            const { errors, warnings } = partitionValidationIssues(deduped);
            if (errors.length) {
                setValidationIssues(deduped);
                setSaveStatus('error');
                setSaving(false);
                setSaveLabel('Save Config');
                return;
            }

            if (warnings.length) {
                const preview = warnings.slice(0, 5).map(w => `• ${w.message}`).join('\n');
                const extra = warnings.length > 5 ? `\n…and ${warnings.length - 5} more` : '';
                setValidationIssues(deduped);
                setSaving(false);
                setSaveLabel('Save Config');
                appConfirm(
                    `Config has ${warnings.length} warning${warnings.length === 1 ? '' : 's'}:\n\n${preview}${extra}\n\nSave anyway?`,
                    () => { void persistValidatedConfig(deduped); },
                );
                return;
            }

            await persistValidatedConfig(deduped);
        } catch (e) {
            console.error(e);
            setSaveStatus('error');
            setValidationIssues([{
                id: 'save-failed',
                severity: 'error',
                message: 'Error saving configuration. Check console.',
            }]);
            setSaving(false);
            setSaveLabel('Save Config');
        }
    };

    const handleRestartService = async () => {
        setRestarting(true);
        try {
            await api.stopScript();
            // Give it a moment to stop
            await new Promise(resolve => setTimeout(resolve, 2000));
            await api.runNow();

            setShowRestartBanner(false);
            setSaveStatus('success'); // Show success after restart
            setTimeout(() => setSaveStatus('idle'), 5000);
        } catch (e) {
            alert("Failed to restart service automatically. Please use the Dashboard.");
        }
        setRestarting(false);
    };

    const importFromPortal = async (opts?: { overwrite?: boolean }) => {
        const overwrite = !!opts?.overwrite;
        setImportingPortal(true);
        setImportMessage('');
        try {
            const defaults = await api.getPortalDefaults();
            const updates: Partial<AppConfig> = {};
            const imported: string[] = [];
            setPortalPlexAvailable(Boolean(defaults?.sources?.plex));
            // Plex URL/token always resolve from Media Player when available — only import TMDB here.
            if (defaults.tmdb_api_key && (overwrite || !config.tmdb_api_key)) {
                updates.tmdb_api_key = defaults.tmdb_api_key;
                imported.push('TMDB');
            }
            if (imported.length === 0) {
                setImportMessage(defaults.sources?.tmdb
                    ? 'Nothing to import — TMDB already set. Use overwrite if you want to replace it.'
                    : defaults.sources?.plex
                        ? 'Plex already comes from Settings → Media Player. Portal has no TMDB key to import.'
                        : 'Portal has no TMDB key saved yet.');
            } else {
                setConfig((prev) => ({ ...prev, ...updates }));
                setImportMessage(`Imported from portal: ${imported.join(', ')}. Save Config to apply.`);
            }
        } catch (e: any) {
            setImportMessage(e?.message || 'Failed to import portal settings.');
        } finally {
            setImportingPortal(false);
        }
    };

    const applyImportedConfigFile = async (file: File) => {
        setImportMessage('');
        try {
            const text = await file.text();
            const { config: imported, importedKeys, skippedKeys } = parseCollexionsConfigText(text);
            setConfig(imported);
            const skipNote = skippedKeys.length
                ? ` Skipped: ${skippedKeys.slice(0, 6).join(', ')}${skippedKeys.length > 6 ? '…' : ''} (password/unknown fields).`
                : '';
            setImportMessage(
                `Loaded ${importedKeys.length} settings from ${file.name}.${skipNote} Review the tabs, then Save Config to write them to the sidecar.`
            );
            setActiveTab('general');
        } catch (e: any) {
            setImportMessage(e?.message || 'Failed to import config.json.');
        } finally {
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const exportConfigFile = () => {
        const blob = new Blob([JSON.stringify(buildExportableConfig(config), null, 4)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'collexions-config.json';
        a.click();
        URL.revokeObjectURL(url);
    };

    const updateField = (field: keyof AppConfig, value: any) => {
        setConfig(prev => ({ ...prev, [field]: value }));
    };

    // Safe accessors
    const libraries = config.library_names || [];
    const pins = config.number_of_collections_to_pin || {};
    const specials = config.special_collections || [];
    const exclusions = config.exclusion_list || [];
    const regexExclusions = config.regex_exclusion_patterns || [];


    if (loading) return (
        <div className="flex h-96 items-center justify-center text-muted flex-col gap-4">
            <div className="w-8 h-8 border-2 border-border border-t-plex rounded-full animate-spin" />
            <p>Loading Configuration...</p>
        </div>
    );

    return (
        <div className="space-y-8 pb-20 animate-in fade-in duration-500">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h2 className="text-2xl md:text-3xl font-bold text-text tracking-tight">Configuration</h2>
                    <p className="text-muted mt-1 flex items-center gap-2 text-sm md:text-base">
                        <Sliders className="w-4 h-4" />
                        Manage libraries, exclusions and scheduling
                    </p>
                </div>
                <div className="flex flex-col sm:flex-row w-full md:w-auto gap-3 flex-wrap justify-end">
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="application/json,.json"
                        className="hidden"
                        onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) void applyImportedConfigFile(file);
                        }}
                    />
                    <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={saving || restarting}
                        className="flex-1 md:flex-none justify-center flex items-center gap-2 bg-card hover:bg-white/5 text-text px-5 py-2.5 rounded-xl font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed border border-border shadow-sm"
                        title="Import a standalone Collexions config.json"
                    >
                        <Upload className="w-4 h-4" />
                        Import config.json
                    </button>
                    <button
                        type="button"
                        onClick={exportConfigFile}
                        disabled={saving || restarting}
                        className="flex-1 md:flex-none justify-center flex items-center gap-2 bg-card hover:bg-white/5 text-text px-5 py-2.5 rounded-xl font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed border border-border shadow-sm"
                    >
                        <Download className="w-4 h-4" />
                        Export
                    </button>
                    <button
                        type="button"
                        onClick={() => importFromPortal()}
                        disabled={importingPortal || saving || restarting}
                        className="flex-1 md:flex-none justify-center flex items-center gap-2 bg-card hover:bg-white/5 text-text px-5 py-2.5 rounded-xl font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed border border-border shadow-sm"
                    >
                        <RefreshCw className={`w-4 h-4 ${importingPortal ? 'animate-spin' : ''}`} />
                        {importingPortal ? 'Importing…' : 'Import from portal'}
                    </button>
                    <button
                        type="button"
                        onClick={() => setShowDiffModal(true)}
                        disabled={!isDirty || saving || restarting}
                        className="flex-1 md:flex-none justify-center flex items-center gap-2 bg-card hover:bg-white/5 text-text px-5 py-2.5 rounded-xl font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed border border-border shadow-sm"
                        title="Review unsaved changes"
                    >
                        <GitCompare className="w-4 h-4" />
                        Review{isDirty && configDiffs.length ? ` (${configDiffs.length})` : ''}
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={saving || restarting}
                        className="flex-1 md:flex-none justify-center flex items-center gap-2 bg-plex hover:bg-plex-hover text-background px-5 py-2.5 rounded-xl font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-plex/10 w-full md:w-40">
                        <Save className="w-4 h-4" /> {saveLabel}
                    </button>
                </div>
            </div>

            {validationErrors.length > 0 && (
                <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200/90 space-y-2 animate-in fade-in slide-in-from-top-2">
                    <div className="flex items-start gap-3">
                        <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                        <div className="min-w-0 flex-1 space-y-1">
                            <p className="font-bold text-red-200">Fix these before saving</p>
                            <ul className="space-y-1 text-xs list-disc list-inside text-red-100/80">
                                {validationErrors.map(i => (
                                    <li key={i.id}>{i.message}</li>
                                ))}
                            </ul>
                        </div>
                    </div>
                </div>
            )}

            {validationErrors.length === 0 && validationWarnings.length > 0 && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100/90 space-y-2 animate-in fade-in slide-in-from-top-2">
                    <div className="flex items-start gap-3">
                        <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                        <div className="min-w-0 flex-1 space-y-1">
                            <p className="font-bold text-amber-200">Saved with warnings</p>
                            <ul className="space-y-1 text-xs list-disc list-inside text-amber-100/80">
                                {validationWarnings.slice(0, 6).map(i => (
                                    <li key={i.id}>{i.message}</li>
                                ))}
                            </ul>
                        </div>
                    </div>
                </div>
            )}

            {importMessage && (
                <div className="bg-card/60 border border-border text-text px-4 py-3 rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-sm">
                    <span>{importMessage}</span>
                    {importMessage.includes('already set') && (
                        <button
                            type="button"
                            onClick={() => importFromPortal({ overwrite: true })}
                            className="text-plex font-semibold hover:underline whitespace-nowrap"
                        >
                            Overwrite from portal
                        </button>
                    )}
                </div>
            )}

            {/* Alerts / Feedback Banners */}
            {showRestartBanner && (
                <div className="bg-amber-500/10 border border-amber-500/20 text-amber-200 p-4 rounded-xl flex flex-col md:flex-row items-center gap-4 animate-in fade-in slide-in-from-top-2 shadow-lg">
                    <div className="bg-amber-500/20 p-2 rounded-full hidden md:block">
                        <RefreshCw className="w-6 h-6 text-amber-500 animate-[spin_3s_linear_infinite]" />
                    </div>
                    <div className="flex-1 text-center md:text-left">
                        <p className="font-bold text-lg">Restart Required</p>
                        <p className="text-sm opacity-80">The service is currently active with old settings. You must restart it for changes to take effect.</p>
                    </div>
                    <button
                        onClick={handleRestartService}
                        disabled={restarting}
                        className="w-full md:w-auto bg-amber-600 hover:bg-amber-500 text-text px-6 py-2 rounded-lg font-bold shadow-lg transition-colors flex items-center justify-center gap-2 whitespace-nowrap"
                    >
                        {restarting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Power className="w-4 h-4" />}
                        {restarting ? 'Restarting...' : 'Restart Service Now'}
                    </button>
                </div>
            )}

            {saveStatus === 'success' && !showRestartBanner && (
                <div className="bg-green-500/10 border border-green-500/20 text-green-400 px-4 py-3 rounded-xl flex items-center gap-2 animate-in fade-in slide-in-from-top-2">
                    <CheckCircle className="w-5 h-5" /> Changes saved successfully.
                </div>
            )}

            {saveStatus === 'error' && validationErrors.length === 0 && (
                <div className="bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-3 rounded-xl flex items-center gap-2 animate-in fade-in slide-in-from-top-2">
                    <AlertCircle className="w-5 h-5" /> Error saving configuration. Check console.
                </div>
            )}

            {isDirty && !showRestartBanner && (
                <div className="bg-plex/10 border border-plex/30 text-plex px-4 py-3 rounded-xl flex flex-col sm:flex-row items-center justify-between gap-3 animate-in fade-in slide-in-from-top-2">
                    <div className="flex items-center gap-2">
                        <ShieldAlert className="w-5 h-5 flex-shrink-0" />
                        <span className="font-medium text-sm">
                            You have unsaved changes
                            {configDiffs.length > 0 ? ` (${configDiffs.length} field${configDiffs.length === 1 ? '' : 's'})` : ''}.
                        </span>
                    </div>
                    <div className="flex flex-wrap gap-2 justify-end">
                        <button
                            type="button"
                            onClick={() => setShowDiffModal(true)}
                            className="px-4 py-1.5 rounded-lg text-sm font-bold text-plex hover:bg-plex/10 transition-colors border border-plex/40 inline-flex items-center gap-1.5"
                        >
                            <GitCompare className="w-3.5 h-3.5" />
                            Review
                        </button>
                        <button
                            type="button"
                            onClick={() => { setConfig(originalConfig!); setShowDiffModal(false); }}
                            className="px-4 py-1.5 rounded-lg text-sm font-bold text-muted hover:bg-white/5 hover:text-text transition-colors border border-border"
                        >
                            Discard all
                        </button>
                        <button
                            type="button"
                            onClick={handleSave}
                            disabled={saving}
                            className="px-4 py-1.5 rounded-lg text-sm font-bold bg-plex text-background hover:bg-plex-hover transition-colors shadow-lg disabled:opacity-50"
                        >
                            {saving ? saveLabel : 'Save Now'}
                        </button>
                    </div>
                </div>
            )}

            {showDiffModal && originalConfig && (
                <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
                    <div className="w-full max-w-2xl max-h-[85vh] overflow-hidden rounded-2xl border border-border bg-card shadow-2xl flex flex-col">
                        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-border">
                            <div>
                                <h3 className="text-lg font-bold text-text flex items-center gap-2">
                                    <GitCompare className="w-5 h-5 text-plex" />
                                    Review changes
                                </h3>
                                <p className="text-xs text-muted mt-1">
                                    Compare your draft to the last saved config. Undo restores one field.
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setShowDiffModal(false)}
                                className="p-2 rounded-lg text-muted hover:text-text hover:bg-white/5"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
                            {configDiffs.length === 0 ? (
                                <p className="text-sm text-muted text-center py-8">No differences.</p>
                            ) : (
                                configDiffs.map(entry => (
                                    <div
                                        key={String(entry.key)}
                                        className="rounded-xl border border-border bg-background/40 p-3 space-y-2"
                                    >
                                        <div className="flex items-center justify-between gap-2">
                                            <p className="text-sm font-bold text-text">{entry.label}</p>
                                            <button
                                                type="button"
                                                onClick={() => setConfig(prev => revertConfigField(prev, originalConfig, entry.key))}
                                                className="text-[11px] font-bold uppercase tracking-wide text-muted hover:text-plex inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-border hover:border-plex/40"
                                                title="Restore this field to the saved value"
                                            >
                                                <Undo2 className="w-3 h-3" />
                                                Undo
                                            </button>
                                        </div>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                                            <div className="rounded-lg bg-red-500/5 border border-red-500/20 p-2 min-w-0">
                                                <p className="text-[10px] font-bold uppercase tracking-wider text-red-300/80 mb-1">Before</p>
                                                <pre className="whitespace-pre-wrap break-words text-muted font-mono text-[11px] leading-relaxed max-h-40 overflow-y-auto">
                                                    {entry.before}
                                                </pre>
                                            </div>
                                            <div className="rounded-lg bg-emerald-500/5 border border-emerald-500/20 p-2 min-w-0">
                                                <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-300/80 mb-1">After</p>
                                                <pre className="whitespace-pre-wrap break-words text-text font-mono text-[11px] leading-relaxed max-h-40 overflow-y-auto">
                                                    {entry.after}
                                                </pre>
                                            </div>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                        <div className="flex flex-wrap items-center justify-end gap-2 px-5 py-4 border-t border-border">
                            <button
                                type="button"
                                onClick={() => { setConfig(originalConfig); setShowDiffModal(false); }}
                                className="px-4 py-2 rounded-lg text-sm font-bold text-muted border border-border hover:text-text hover:bg-white/5"
                            >
                                Discard all
                            </button>
                            <button
                                type="button"
                                onClick={() => setShowDiffModal(false)}
                                className="px-4 py-2 rounded-lg text-sm font-bold text-text border border-border hover:bg-white/5"
                            >
                                Keep editing
                            </button>
                            <button
                                type="button"
                                disabled={saving || configDiffs.length === 0}
                                onClick={() => {
                                    setShowDiffModal(false);
                                    void handleSave();
                                }}
                                className="px-4 py-2 rounded-lg text-sm font-bold bg-plex text-background hover:bg-plex-hover disabled:opacity-50"
                            >
                                {saving ? saveLabel : 'Save changes'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {conflicts.length > 0 && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100/90 space-y-2 animate-in fade-in slide-in-from-top-2">
                    <div className="flex items-start gap-3">
                        <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                        <div className="min-w-0 flex-1 space-y-1">
                            <p className="font-bold text-amber-200">
                                {warningCount > 0
                                    ? `${warningCount} config conflict${warningCount === 1 ? '' : 's'} may affect pinning`
                                    : `${conflicts.length} config note${conflicts.length === 1 ? '' : 's'}`}
                            </p>
                            <ul className="space-y-1 text-xs text-amber-100/80 list-disc list-inside">
                                {conflicts.slice(0, 6).map(c => (
                                    <li key={c.id}>
                                        <button
                                            type="button"
                                            className="text-left hover:underline hover:text-amber-50"
                                            onClick={() => setActiveTab(c.tabs[0])}
                                        >
                                            {c.message}
                                        </button>
                                    </li>
                                ))}
                            </ul>
                            {conflicts.length > 6 && (
                                <p className="text-[11px] text-amber-200/60">+{conflicts.length - 6} more — open the highlighted tabs for details.</p>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Tabs - Make scrollable on mobile */}
            <div className="border-b border-border flex overflow-x-auto no-scrollbar page-bleed-x page-x md:mx-0 md:px-0 md:w-full">
                {(['general', 'libraries', 'exclusions', 'specials', 'categories', 'integrations'] as const).map(t => {
                    const n = conflictsForTab(conflicts, t).length;
                    return (
                        <button
                            key={t}
                            onClick={() => setActiveTab(t)}
                            className={`px-4 md:px-6 py-4 font-medium capitalize transition-all border-b-2 whitespace-nowrap text-sm md:text-base inline-flex items-center gap-2 ${activeTab === t
                                ? 'text-plex border-plex bg-card/30'
                                : 'text-muted border-transparent hover:text-text hover:bg-white/5'
                                }`}
                        >
                            {t}
                            {n > 0 && (
                                <span className="text-[10px] font-bold uppercase tracking-wide bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded px-1.5 py-0.5">
                                    {n}
                                </span>
                            )}
                        </button>
                    );
                })}
            </div>

            {tabConflicts.length > 0 && (
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-xs text-amber-100/80 space-y-1.5">
                    <p className="font-bold text-amber-200/90 text-sm">On this tab</p>
                    <ul className="space-y-1 list-disc list-inside">
                        {tabConflicts.map(c => (
                            <li key={c.id}>{c.message}</li>
                        ))}
                    </ul>
                </div>
            )}

            <div className="animate-in fade-in duration-300">
                {activeTab === 'general' && (
                    <div className="grid gap-6">
                        <Card title="Plex Connection">
                            {plexFromPortal ? (
                                <div className="rounded-xl border border-border bg-background/40 px-4 py-3 space-y-1">
                                    <p className="text-sm font-semibold text-text">Using Settings → Media Player</p>
                                    <p className="text-xs text-muted">
                                        {(config._portal_plex_url || config.plex_url)
                                            ? <>Direct Plex URL: <span className="font-mono text-text/80">{config._portal_plex_url || config.plex_url}</span></>
                                            : 'Plex URL and token come from Media Player automatically.'}
                                    </p>
                                    <p className="text-[11px] text-muted">
                                        Update them under Settings → Media Player — ColleXions picks them up without a separate copy here.
                                    </p>
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <Input label="Plex URL" value={config.plex_url} onChange={e => updateField('plex_url', e.target.value)} placeholder="http://localhost:32400" tooltip="The local or remote address of your Plex server. Include the port (default 32400)." />
                                    <Input label="Plex Token" type="password" value={config.plex_token} onChange={e => updateField('plex_token', e.target.value)} tooltip="Your X-Plex-Token used for authentication. Can be found in the URL of any XML page on your Plex server." />
                                    <p className="md:col-span-2 text-xs text-amber-200/90">
                                        Tip: set Direct Plex URL and token under Settings → Media Player so ColleXions can use them automatically.
                                    </p>
                                </div>
                            )}
                        </Card>

                        <Card title="Execution Controls">
                            <div className={`border rounded-xl p-4 md:p-6 mb-6 transition-all duration-300 flex flex-col md:flex-row gap-4 items-start ${config.dry_run ? 'bg-plex/10 border-plex/30' : 'bg-background/30 border-border'}`}>
                                <div className={`p-3 rounded-full hidden md:block ${config.dry_run ? 'bg-plex/20 text-plex' : 'bg-card text-muted'}`}>
                                    <ShieldAlert className="w-6 h-6" />
                                </div>
                                <div className="flex-1 w-full">
                                    <Switch
                                        label="Dry Run Mode"
                                        checked={config.dry_run}
                                        onChange={v => updateField('dry_run', v)}
                                        description="When enabled, the script will only LOG what it would do. No changes will be made to your Plex server."
                                        tooltip="Simulate actions without making any changes to Plex. Check logs to see what would have happened."
                                    />
                                    {config.dry_run && (
                                        <p className="text-sm text-plex mt-2 font-medium">
                                            ⚠️ Actions are currently simulated. Turn this OFF to apply changes.
                                        </p>
                                    )}
                                </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6 mb-6">
                                <Input label="Check Interval (min)" type="number" value={config.pinning_interval} onChange={e => updateField('pinning_interval', parseInt(e.target.value) || 0)} tooltip="How often (in minutes) the script checks for new pinning opportunities." />
                                <Input label="Repeat Block (hours)" type="number" value={config.repeat_block_hours} onChange={e => updateField('repeat_block_hours', parseInt(e.target.value))} tooltip="Hours to wait before pinning the same collection again after it has been unpinned." />
                                <Input label="Min Items in Collection" type="number" value={config.min_items_for_pinning} onChange={e => updateField('min_items_for_pinning', parseInt(e.target.value))} tooltip="Minimum number of items required in a collection for it to be considered for pinning." />
                            </div>
                            <div className="space-y-4 pt-4 border-t border-border">
                                <Input label="Collection Label" value={config.collexions_label} onChange={e => updateField('collexions_label', e.target.value)} tooltip="The label added to all collections managed by ColleXions for easy identification." />
                                <Input label="Discord Webhook URL" value={config.discord_webhook_url} onChange={e => updateField('discord_webhook_url', e.target.value)} placeholder="https://discord.com/api/webhooks/..." tooltip="Post notifications to a Discord channel when collections are pinned or unpinned." />
                            </div>
                        </Card>

                        <Card title="Random Category Mode">
                            <div className="space-y-6">
                                <Switch
                                    label="Enable Random Category Mode"
                                    checked={config.use_random_category_mode}
                                    onChange={v => updateField('use_random_category_mode', v)}
                                    description="If enabled, picks one category at random instead of filling all slots sequentially."
                                    tooltip="Instead of rotating through all categories, pick one at random each run to keep your home screen fresh."
                                />
                                <div className={`transition-opacity ${config.use_random_category_mode ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
                                    <div className="mb-2 flex justify-between">
                                        <label className="text-sm font-medium text-text">Skip Percent ({config.random_category_skip_percent}%)</label>
                                    </div>
                                    <input
                                        type="range" min="0" max="100"
                                        value={config.random_category_skip_percent}
                                        onChange={e => updateField('random_category_skip_percent', parseInt(e.target.value))}
                                        className="w-full accent-plex cursor-pointer"
                                    />
                                    <p className="text-xs text-muted mt-1">Chance to skip selecting a category entirely in a cycle.</p>
                                </div>
                            </div>
                        </Card>
                    </div>
                )}

                {activeTab === 'libraries' && (
                    <Card title="Managed Libraries" actions={<button onClick={() => handleAddLibrary(setConfig)} className="text-plex hover:text-plex text-sm font-bold flex items-center gap-1 transition-colors"><Plus className="w-4 h-4" /> Add Lib</button>}>
                        <div className="space-y-4">
                            {libraries.length === 0 && <p className="text-muted italic text-center py-4">No libraries added yet.</p>}
                            {libraries.map(lib => (
                                <div key={lib} className="flex flex-col sm:flex-row sm:items-center justify-between bg-background/30 border border-border p-4 rounded-xl hover:border-border transition-colors gap-3">
                                    <span className="font-medium text-text truncate">{lib}</span>
                                    <div className="flex items-center gap-4 self-end sm:self-auto">
                                        <div className="flex items-center gap-2 bg-card/60 px-3 py-1.5 rounded-lg border border-border">
                                            <span className="text-xs text-muted uppercase font-bold tracking-wider">Pins</span>
                                            <input
                                                type="number"
                                                className="appearance-none text-[16px] leading-5 w-12 bg-transparent border-none p-0 text-center text-text text-[16px] focus:ring-0"
                                                value={pins[lib] || 0}
                                                onChange={(e) => handlePinCountChange(lib, e.target.value, setConfig)}
                                            />
                                        </div>
                                        <button onClick={() => handleRemoveLibrary(lib, setConfig)} className="text-muted hover:text-red-500 p-2 hover:bg-red-500/10 rounded-lg transition-colors"><Trash2 className="w-4 h-4" /></button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </Card>
                )}

                {activeTab === 'exclusions' && (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <Card title="Global Exclusion List">
                            <div className="flex items-center gap-1.5 mb-4">
                                <p className="text-xs text-muted">Exact collection names to never pin.</p>
                                <div className="relative">
                                    <Info className="peer w-3 h-3 text-muted hover:text-plex cursor-help transition-colors" />
                                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 p-2 bg-card border border-border rounded-lg text-[10px] text-text opacity-0 peer-hover:opacity-100 transition-all duration-200 pointer-events-none z-[100] shadow-2xl backdrop-blur-md">
                                        Use this to prevent specific collections from ever being pinned to your home screen, even if they match categories or trending data.
                                        <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-card" />
                                    </div>
                                </div>
                            </div>
                            <ArrayEditor
                                list={exclusions}
                                onChange={l => updateField('exclusion_list', l)}
                                placeholder="Collection Name"
                            />
                        </Card>
                        <Card title="Regex Exclusions">
                            <div className="flex items-center gap-1.5 mb-4">
                                <p className="text-xs text-muted">Python Regex patterns to exclude.</p>
                                <div className="relative">
                                    <Info className="peer w-3 h-3 text-muted hover:text-plex cursor-help transition-colors" />
                                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 p-2 bg-card border border-border rounded-lg text-[10px] text-text opacity-0 peer-hover:opacity-100 transition-all duration-200 pointer-events-none z-[100] shadow-2xl backdrop-blur-md">
                                        Exclude collections based on name patterns (e.g. ^.*-4K$ to exclude any collection ending with -4K).
                                        <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-card" />
                                    </div>
                                </div>
                            </div>
                            <ArrayEditor
                                list={regexExclusions}
                                onChange={l => updateField('regex_exclusion_patterns', l)}
                                placeholder="^.*(4K|Remux).*$"
                            />
                        </Card>
                    </div>
                )}

                {activeTab === 'specials' && (
                    <SpecialEditor
                        specials={specials}
                        dateFormat={normalizeSpecialDateFormat(config.special_date_format)}
                        setConfig={setConfig}
                    />
                )}

                {activeTab === 'categories' && (
                    <Card title="Library Categories">
                        <div className="bg-plex/10 border border-plex/30 p-4 rounded-xl mb-6 flex items-start gap-4">
                            <AlertCircle className="w-5 h-5 text-plex flex-shrink-0 mt-0.5" />
                            <p className="text-sm text-muted leading-relaxed">
                                Categories allow you to group collections and force specific numbers of pins from that group.
                                In "Random Category Mode", the script will randomly pick one of these categories per run.
                            </p>
                        </div>
                        <CategoryEditor config={config} setConfig={setConfig} />
                    </Card>
                )}

                {activeTab === 'integrations' && (
                    <div className="space-y-6">
                        <Card title="External Services">
                            <div className="bg-amber-500/10 border border-amber-500/20 p-4 rounded-xl mb-6 flex items-start gap-4">
                                <AlertCircle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
                                <div className="space-y-1">
                                    <p className="text-sm text-amber-200/90 font-bold">API Keys Required</p>
                                    <p className="text-xs text-amber-200/70 leading-relaxed">
                                        To use Trending & Creation features, you need TMDb, Trakt, and/or MDBList credentials.
                                        You can get a TMDb API key for free from their developer portal, a Trakt Client ID by creating an "API App" on Trakt.tv, or an MDBList API key from MDBList.com.
                                    </p>
                                </div>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                <Input
                                    label="TMDb API Key"
                                    value={config.tmdb_api_key || ''}
                                    onChange={e => updateField('tmdb_api_key', e.target.value)}
                                    placeholder="Your v3 API Key"
                                    type="password"
                                    tooltip="Required for identifying trending movies and shows from The Movie Database."
                                />
                                <Input
                                    label="Trakt Client ID"
                                    value={config.trakt_client_id || ''}
                                    onChange={e => updateField('trakt_client_id', e.target.value)}
                                    placeholder="Client ID / API Key"
                                    type="password"
                                    tooltip="Required for identifying trending lists from Trakt.tv."
                                />
                                <Input
                                    label="MDBList API Key"
                                    value={config.mdblist_api_key || ''}
                                    onChange={e => updateField('mdblist_api_key', e.target.value)}
                                    placeholder="Your API Key"
                                    type="password"
                                    tooltip="Used to enhance metadata and filtering for collection creation."
                                />
                            </div>
                        </Card>

                        <Card title="Smart Pinning Logic">
                            <Switch
                                label="Enable Smart Pinning"
                                checked={config.enable_trending_pinning || false}
                                onChange={v => updateField('enable_trending_pinning', v)}
                                description="Automatically identify and pin collections that match global trending results from Trakt and TMDb."
                                tooltip="Matches your local collections against current global trending data to elevate relevant content automatically."
                            />
                            <p className="text-xs text-muted mt-4 border-t border-border pt-4">
                                Note: This will prioritize your local collections that match trending titles. It will NOT create new collections automatically yet.
                            </p>
                        </Card>
                    </div>
                )}
            </div>
        </div>
    );
};

// --- SUB-EDITORS ---

// Library List Editor
const handleAddLibrary = (setConfig: React.Dispatch<React.SetStateAction<AppConfig>>) => {
    const name = prompt("Enter Library Name (exact match from Plex):");
    if (name) {
        setConfig(prev => {
            const currentLibs = prev.library_names || [];
            if (currentLibs.includes(name)) return prev;
            return {
                ...prev,
                library_names: [...currentLibs, name],
                number_of_collections_to_pin: { ...(prev.number_of_collections_to_pin || {}), [name]: 0 }
            };
        });
    }
};

const handleRemoveLibrary = (name: string, setConfig: React.Dispatch<React.SetStateAction<AppConfig>>) => {
    if (confirm(`Remove library "${name}"?`)) {
        setConfig(prev => {
            const newLibs = (prev.library_names || []).filter(l => l !== name);
            const newPins = { ...(prev.number_of_collections_to_pin || {}) };
            delete newPins[name];
            return { ...prev, library_names: newLibs, number_of_collections_to_pin: newPins };
        });
    }
};

const handlePinCountChange = (lib: string, val: string, setConfig: React.Dispatch<React.SetStateAction<AppConfig>>) => {
    const num = parseInt(val) || 0;
    setConfig(prev => ({
        ...prev,
        number_of_collections_to_pin: { ...(prev.number_of_collections_to_pin || {}), [lib]: num }
    }));
};

// Array String Editor (Exclusions/Regex)
const ArrayEditor = ({ list = [], onChange, placeholder }: { list: string[], onChange: (l: string[]) => void, placeholder: string }) => {
    const [input, setInput] = useState('');
    const safeList = list || [];

    const add = () => { if (input) { onChange([...safeList, input]); setInput(''); } };
    const remove = (idx: number) => { onChange(safeList.filter((_, i) => i !== idx)); };

    return (
        <div className="space-y-3">
            <div className="flex gap-2">
                <input
                    className="appearance-none text-[16px] leading-5 flex-1 bg-background/60 border border-border rounded px-3 py-2 text-[16px] text-text focus:outline-none focus:border-plex/50 min-w-0"
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    placeholder={placeholder}
                    onKeyDown={e => e.key === 'Enter' && add()}
                />
                <button onClick={add} className="bg-card hover:bg-white/10 text-text px-3 rounded border border-border flex-shrink-0"><Plus className="w-4 h-4" /></button>
            </div>
            <div className="flex flex-wrap gap-2">
                {safeList.map((item, idx) => (
                    <span key={idx} className="bg-card/60 border border-border text-text text-xs md:text-sm px-2 py-1 rounded flex items-center gap-2 max-w-full truncate">
                        <span className="truncate">{item}</span>
                        <button onClick={() => remove(idx)} className="text-red-400 hover:text-red-300 flex-shrink-0"><Trash2 className="w-3 h-3" /></button>
                    </span>
                ))}
                {safeList.length === 0 && <span className="text-muted text-sm italic">No items</span>}
            </div>
        </div>
    );
};

// Special date field: displays in selected format, commits canonical MM-DD
const SpecialDateField: React.FC<{
    label: string;
    stored: string;
    format: SpecialDateFormat;
    onCommit: (mmDd: string) => void;
}> = ({ label, stored, format, onCommit }) => {
    const [text, setText] = useState(() => mmDdToDisplay(stored, format));
    const [error, setError] = useState('');

    useEffect(() => {
        setText(mmDdToDisplay(stored, format));
        setError('');
    }, [stored, format]);

    const commit = () => {
        const next = displayToMmDd(text, format);
        if (!next) {
            setError(`Use ${specialDateFormatLabel(format)} (e.g. ${format === 'DD-MM' ? '25-12' : '12-25'})`);
            setText(mmDdToDisplay(stored, format));
            return;
        }
        setError('');
        setText(mmDdToDisplay(next, format));
        if (next !== stored) onCommit(next);
    };

    return (
        <div>
            <Input
                label={label}
                value={text}
                onChange={(e) => {
                    setText(e.target.value);
                    if (error) setError('');
                }}
                onBlur={commit}
                placeholder={format === 'DD-MM' ? 'DD-MM' : 'MM-DD'}
            />
            {error && <p className="text-[11px] text-red-400 mt-1">{error}</p>}
        </div>
    );
};

// Special Collections Editor
const SpecialEditor = ({
    specials = [],
    dateFormat,
    setConfig,
}: {
    specials: SpecialCollection[];
    dateFormat: SpecialDateFormat;
    setConfig: React.Dispatch<React.SetStateAction<AppConfig>>;
}) => {
    const fmtLabel = specialDateFormatLabel(dateFormat);

    const handleAddSpecial = () => {
        const newItem: SpecialCollection = {
            start_date: '12-01',
            end_date: '12-25',
            collection_names: ['Christmas Movies'],
        };
        setConfig(prev => ({ ...prev, special_collections: [...(prev.special_collections || []), newItem] }));
    };

    const updateSpecial = (idx: number, field: keyof SpecialCollection, val: any) => {
        const updated = [...specials];
        updated[idx] = { ...updated[idx], [field]: val };
        setConfig(prev => ({ ...prev, special_collections: updated }));
    };

    const updateSpecialCollNames = (idx: number, namesStr: string) => {
        updateSpecial(idx, 'collection_names', namesStr.split(','));
    };

    return (
        <div className="space-y-4">
            <Card
                title="Special Event Collections"
                actions={
                    <button
                        type="button"
                        onClick={handleAddSpecial}
                        className="text-plex hover:text-plex text-sm font-bold flex items-center gap-1"
                    >
                        <Plus className="w-4 h-4" /> Add Event
                    </button>
                }
            >
                <div className="mb-5 max-w-md">
                    <CustomSelect
                        label="Date format"
                        value={dateFormat}
                        onChange={(v) => setConfig(prev => ({
                            ...prev,
                            special_date_format: normalizeSpecialDateFormat(v),
                        }))}
                        options={[
                            { value: 'DD-MM', label: 'Day–Month (UK) — DD-MM' },
                            { value: 'MM-DD', label: 'Month–Day (US) — MM-DD' },
                        ]}
                        tooltip="How dates appear in this form. Values are always saved as MM-DD for the pinning script."
                    />
                    <p className="text-[11px] text-muted mt-2">
                        Display only — stored config stays MM-DD so ColleXions can pin without format ambiguity.
                    </p>
                </div>

                <div className="space-y-3">
                    {specials.map((spec, idx) => (
                        <div
                            key={idx}
                            className="bg-background/30 border border-border p-3 md:p-4 rounded-xl space-y-3 relative group hover:border-border transition-colors"
                        >
                            <button
                                type="button"
                                onClick={() => {
                                    const updated = specials.filter((_, i) => i !== idx);
                                    setConfig(prev => ({ ...prev, special_collections: updated }));
                                }}
                                className="absolute top-3 right-3 text-muted hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 hover:bg-red-500/10 rounded-lg"
                            >
                                <Trash2 className="w-4 h-4" />
                            </button>

                            <div className="flex flex-col md:flex-row gap-3 md:gap-4 pr-8">
                                <div className="md:w-1/3 space-y-3">
                                    <SpecialDateField
                                        label={`Start Date (${fmtLabel})`}
                                        stored={spec.start_date}
                                        format={dateFormat}
                                        onCommit={(mmDd) => updateSpecial(idx, 'start_date', mmDd)}
                                    />
                                    <SpecialDateField
                                        label={`End Date (${fmtLabel})`}
                                        stored={spec.end_date}
                                        format={dateFormat}
                                        onCommit={(mmDd) => updateSpecial(idx, 'end_date', mmDd)}
                                    />
                                </div>
                                <div className="md:w-2/3">
                                    <label className="block text-sm font-medium text-text mb-1.5">Collection Names (comma separated)</label>
                                    <textarea
                                        className="appearance-none text-[16px] leading-5 w-full bg-background/60 border border-border rounded-lg p-2.5 text-[16px] text-text h-20 focus:outline-none focus:border-plex/50"
                                        value={(spec.collection_names || []).join(',')}
                                        onChange={e => updateSpecialCollNames(idx, e.target.value)}
                                    />
                                </div>
                            </div>
                        </div>
                    ))}
                    {specials.length === 0 && (
                        <div className="text-center text-muted py-6 text-sm">No special events configured.</div>
                    )}
                </div>
            </Card>
        </div>
    );
};

// Categories Editor
const CategoryEditor = ({ config, setConfig }: { config: AppConfig, setConfig: React.Dispatch<React.SetStateAction<AppConfig>> }) => {
    const safeLibs = config.library_names || [];
    const [selectedLib, setSelectedLib] = useState<string>('');

    useEffect(() => {
        if (!selectedLib && safeLibs.length > 0) {
            setSelectedLib(safeLibs[0]);
        }
    }, [safeLibs, selectedLib]);

    const currentLib = selectedLib || safeLibs[0] || '';

    if (!currentLib) return <div className="text-muted italic p-6 text-center border border-border rounded bg-card/40">Please add libraries in the "Libraries" tab first.</div>;

    const safeCats = config.categories || {};
    const categories = safeCats[currentLib] || [];

    const addCategory = () => {
        const newCat: CategoryConfig = { category_name: 'New Category', pin_count: 1, collections: [] };
        const updatedCats = [...categories, newCat];
        setConfig(prev => ({ ...prev, categories: { ...(prev.categories || {}), [currentLib]: updatedCats } }));
    };

    const removeCategory = (idx: number) => {
        const updatedCats = categories.filter((_, i) => i !== idx);
        setConfig(prev => ({ ...prev, categories: { ...(prev.categories || {}), [currentLib]: updatedCats } }));
    };

    const updateCatField = (idx: number, field: keyof CategoryConfig, val: any) => {
        const updatedCats = [...categories];
        updatedCats[idx] = { ...updatedCats[idx], [field]: val };
        setConfig(prev => ({ ...prev, categories: { ...(prev.categories || {}), [currentLib]: updatedCats } }));
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                <div className="flex-1 w-full">
                    <CustomSelect
                        label="Select Library"
                        value={currentLib}
                        onChange={setSelectedLib}
                        options={safeLibs.map(l => ({ label: l, value: l }))}
                        tooltip="Choose which Plex library to manage categories for."
                    />
                </div>
                <button onClick={addCategory} className="w-full sm:w-auto mt-auto flex items-center justify-center gap-2 bg-plex text-background px-4 py-2 rounded-lg hover:bg-plex-hover shadow-lg shadow-plex/10 text-sm font-medium h-[42px]">
                    <Plus className="w-4 h-4" /> Add Category
                </button>
            </div>

            <div className="space-y-4">
                {categories.length === 0 && <div className="p-8 text-center bg-card/40 rounded border border-border border-dashed text-muted">No categories defined for {currentLib}</div>}

                {categories.map((cat, idx) => (
                    <div key={`${currentLib}-cat-${idx}`} className="bg-background/30 border border-border rounded-xl p-4 md:p-6 space-y-4">
                        <div className="flex gap-4 items-start">
                            <div className="flex-1 space-y-4">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
                                    <Input
                                        label="Category Name"
                                        value={cat.category_name}
                                        onChange={e => updateCatField(idx, 'category_name', e.target.value)}
                                        tooltip="A descriptive name for this category (e.g. 'Heroes', 'Scary Movies')."
                                    />
                                    <Input
                                        label="Pin Count"
                                        type="number"
                                        value={cat.pin_count}
                                        onChange={e => updateCatField(idx, 'pin_count', e.target.value ? parseInt(e.target.value) : 0)}
                                        tooltip="The maximum number of collections from this category to have pinned on your home screen at once."
                                    />
                                </div>
                                <div>
                                    <div className="flex items-center gap-1.5 mb-1">
                                        <label className="block text-sm font-medium text-text">Collections (comma separated)</label>
                                        <div className="relative leading-none">
                                            <HelpCircle className="peer w-3.5 h-3.5 text-muted hover:text-plex cursor-help transition-colors" />
                                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 p-2 bg-card/95 border border-border rounded-lg text-[10px] text-text opacity-0 peer-hover:opacity-100 transition-all duration-200 pointer-events-none z-[100] shadow-2xl backdrop-blur-md font-normal leading-normal">
                                                Comma-separated list of collection names that belong to this category. Case sensitive.
                                                <div className="absolute top-full left-1/2 -translate-x-1/2 border-8 border-transparent border-t-card" />
                                            </div>
                                        </div>
                                    </div>
                                    <textarea
                                        className="appearance-none text-[16px] leading-5 w-full bg-background/60 border border-border rounded-lg p-3 text-[16px] text-text focus:outline-none focus:border-plex/50"
                                        rows={2}
                                        value={cat.collections.join(',')}
                                        onChange={e => {
                                            updateCatField(idx, 'collections', e.target.value.split(','));
                                        }}
                                    />
                                </div>
                            </div>
                            <button onClick={() => removeCategory(idx)} className="text-muted hover:text-red-500 mt-2 p-2 hover:bg-red-500/10 rounded-lg transition-colors"><Trash2 className="w-5 h-5" /></button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default ConfigPage;
