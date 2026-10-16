import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Server,
    Shield,
    CheckCircle2,
    ArrowRight,
    ChevronRight,
    ChevronLeft,
    Check,
    AlertCircle,
    Info,
    Library,
    Globe
} from 'lucide-react';
import { api } from '../api';
import { AppConfig } from '../types';
import { DEFAULT_CONFIG } from '../constants';

const inputClass =
    'w-full appearance-none px-4 py-3 rounded-xl border border-border bg-background text-[16px] leading-5 text-text outline-none focus:border-plex focus:ring-1 focus:ring-plex transition-all';

const Onboarding: React.FC = () => {
    const navigate = useNavigate();
    const [currentStep, setCurrentStep] = useState(0);
    const [config, setConfig] = useState<Partial<AppConfig>>({
        plex_url: 'http://',
        plex_token: '',
        library_names: [],
        collexions_label: 'Collexions',
        trakt_client_id: '',
        tmdb_api_key: '',
        mdblist_api_key: ''
    });
    const [availableLibraries, setAvailableLibraries] = useState<string[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [successMessage, setSuccessMessage] = useState('');
    const [importedFromPortal, setImportedFromPortal] = useState<string[]>([]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const defaults = await api.getPortalDefaults();
                if (cancelled) return;
                const imported: string[] = [];
                const updates: Partial<AppConfig> = {};
                const emptyUrl = !config.plex_url || config.plex_url === 'http://';
                if (emptyUrl && defaults.plex_url) {
                    updates.plex_url = defaults.plex_url;
                    imported.push('Plex URL');
                }
                if (!config.plex_token && defaults.plex_token) {
                    updates.plex_token = defaults.plex_token;
                    imported.push('Plex token');
                }
                if (!config.tmdb_api_key && defaults.tmdb_api_key) {
                    updates.tmdb_api_key = defaults.tmdb_api_key;
                    imported.push('TMDB');
                }
                if (Object.keys(updates).length) {
                    setConfig((prev) => ({ ...prev, ...updates }));
                    setImportedFromPortal(imported);
                }
            } catch {
                // Portal defaults are optional; user can still enter values manually.
            }
        })();
        return () => { cancelled = true; };
        // Seed once on mount from portal settings.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const steps = [
        { title: 'Welcome', icon: Shield },
        { title: 'Plex Config', icon: Server },
        { title: 'Libraries', icon: Library },
        { title: 'Integrations', icon: Globe },
        { title: 'Finalize', icon: CheckCircle2 }
    ];

    const getStepType = (index: number) => {
        if (index === 0) return 'welcome';
        if (index === 1) return 'plex';
        if (index === 2) return 'libraries';
        if (index === 3) return 'integrations';
        return 'finalize';
    };

    const updateConfig = (updates: Partial<AppConfig>) => {
        setConfig(prev => ({ ...prev, ...updates }));
    };

    const handleNext = () => {
        setError('');
        if (currentStep < steps.length - 1) {
            setCurrentStep(currentStep + 1);
        }
    };

    const handleBack = () => {
        if (currentStep > 0) {
            setCurrentStep(currentStep - 1);
            setError('');
        }
    };

    const testPlexConnection = async () => {
        setLoading(true);
        setError('');
        try {
            const fullConfig = { ...DEFAULT_CONFIG, ...config } as AppConfig;
            await api.saveConfig(fullConfig);
            const libraries = await api.getPlexLibraries();

            const libs = libraries.map((l: any) => l.name);
            if (libs.length > 0) {
                setAvailableLibraries(libs);
                setSuccessMessage('Plex connected successfully!');
                setTimeout(() => setSuccessMessage(''), 3000);
            } else {
                throw new Error('Connected to Plex, but no libraries found.');
            }
        } catch (err: any) {
            setError(err.message || 'Failed to connect to Plex. Check URL and Token.');
        } finally {
            setLoading(false);
        }
    };

    const toggleLibrary = (lib: string) => {
        const current = config.library_names || [];
        if (current.includes(lib)) {
            updateConfig({ library_names: current.filter(l => l !== lib) });
        } else {
            updateConfig({ library_names: [...current, lib] });
        }
    };

    const handleFinish = async () => {
        setLoading(true);
        setError('');
        try {
            if (!config.plex_url || !config.plex_token) {
                throw new Error('Plex URL and Token are required.');
            }
            if (!config.library_names || config.library_names.length === 0) {
                throw new Error('Please select at least one library.');
            }

            const fullConfig = { ...DEFAULT_CONFIG, ...config } as AppConfig;
            await api.saveConfig(fullConfig);
            window.dispatchEvent(new CustomEvent('collexions-onboarding-done'));
            navigate('/', { replace: true });
        } catch (err: any) {
            setError(err.message || 'Failed to save configuration.');
        } finally {
            setLoading(false);
        }
    };

    const renderStep = () => {
        const type = getStepType(currentStep);
        switch (type) {
            case 'welcome':
                return (
                    <div className="space-y-6 animate-fade-in">
                        <div className="text-center space-y-3">
                            <h2 className="text-2xl md:text-3xl font-bold text-text">Welcome to Collexions</h2>
                            <p className="text-muted max-w-md mx-auto text-sm md:text-base">
                                A few steps to automate Plex collections and surface trending content on your home screen.
                            </p>
                        </div>
                        {importedFromPortal.length > 0 && (
                            <div className="flex items-start gap-3 p-4 rounded-xl border border-green-500/30 bg-green-500/10 text-green-300 text-sm">
                                <CheckCircle2 className="w-5 h-5 flex-shrink-0 mt-0.5" />
                                <p>
                                    Pre-filled from portal settings: <span className="font-semibold text-text">{importedFromPortal.join(', ')}</span>.
                                    Trakt and MDBList still need to be entered if you use them.
                                </p>
                            </div>
                        )}
                        <div className="grid grid-cols-1 gap-3">
                            {[
                                { title: 'Automated Sync', desc: 'Sync Trakt and TMDb lists to Plex effortlessly.' },
                                { title: 'Portal UI', desc: 'Manage everything inside the same admin portal.' },
                                { title: 'Custom Creator', desc: 'Build and pin your own custom collections.' }
                            ].map((feat, i) => (
                                <div key={i} className="flex items-start gap-4 p-4 rounded-xl border border-border bg-background/50">
                                    <div className="p-2 rounded-lg bg-plex/10 text-plex">
                                        <Check className="w-5 h-5" />
                                    </div>
                                    <div>
                                        <h4 className="font-bold text-text">{feat.title}</h4>
                                        <p className="text-sm text-muted">{feat.desc}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                );
            case 'plex': {
                const usingPortalPlex = importedFromPortal.some((label) => label.startsWith('Plex'));
                return (
                    <div className="space-y-5 animate-fade-in">
                        {usingPortalPlex ? (
                            <div className="flex items-start gap-3 p-3 rounded-xl border border-green-500/30 bg-green-500/10 text-green-300 text-xs">
                                <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
                                <p>
                                    Using Plex URL/token from Settings → Media Player
                                    {config.plex_url ? <> (<span className="font-mono text-text/80">{config.plex_url}</span>)</> : null}.
                                    Test the connection, then continue to pick libraries.
                                </p>
                            </div>
                        ) : (
                            <>
                                <div className="space-y-2">
                                    <label className="text-sm font-semibold text-text">Plex Server URL</label>
                                    <input
                                        type="text"
                                        value={config.plex_url}
                                        onChange={(e) => updateConfig({ plex_url: e.target.value })}
                                        className={inputClass}
                                        placeholder="e.g. http://192.168.1.10:32400"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-sm font-semibold text-text">Plex Token</label>
                                    <input
                                        type="password"
                                        value={config.plex_token}
                                        onChange={(e) => updateConfig({ plex_token: e.target.value })}
                                        className={inputClass}
                                        placeholder="Your X-Plex-Token"
                                    />
                                    <p className="text-[11px] text-muted flex items-center gap-1">
                                        <Info className="w-3 h-3" /> Prefer Settings → Media Player so ColleXions stays in sync automatically.
                                    </p>
                                </div>
                            </>
                        )}
                        <button
                            type="button"
                            onClick={testPlexConnection}
                            disabled={loading || !config.plex_url || !config.plex_token}
                            className="w-full py-3 bg-card text-text font-bold rounded-xl border border-border hover:border-plex/50 hover:bg-white/5 transition-all disabled:opacity-50"
                        >
                            {loading ? 'Connecting...' : 'Test Connection'}
                        </button>
                    </div>
                );
            }
            case 'libraries':
                return (
                    <div className="space-y-4 animate-fade-in">
                        <div>
                            <h3 className="text-lg font-bold text-text">Select Managed Libraries</h3>
                            <p className="text-sm text-muted mt-1">Choose which libraries Collexions should manage.</p>
                        </div>

                        <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1 custom-scrollbar">
                            {availableLibraries.length > 0 ? (
                                availableLibraries.map(lib => (
                                    <button
                                        key={lib}
                                        type="button"
                                        onClick={() => toggleLibrary(lib)}
                                        className={`w-full px-4 py-2.5 rounded-xl border flex items-center justify-between transition-all ${config.library_names?.includes(lib)
                                            ? 'bg-plex/10 border-plex text-plex'
                                            : 'bg-background/50 border-border text-muted hover:text-text hover:border-plex/40'
                                            }`}
                                    >
                                        <span className="text-sm font-medium">{lib}</span>
                                        {config.library_names?.includes(lib) ? <CheckCircle2 className="w-4 h-4" /> : <div className="w-4 h-4 rounded-full border border-border" />}
                                    </button>
                                ))
                            ) : (
                                <div className="text-center py-8 text-muted">
                                    <AlertCircle className="w-8 h-8 mx-auto mb-2 opacity-50" />
                                    <p>No libraries found. Did you test connection?</p>
                                    <button type="button" onClick={() => setCurrentStep(steps.findIndex(s => s.icon === Server))} className="text-plex text-xs mt-2 underline">Go back to Plex Config</button>
                                </div>
                            )}
                        </div>
                    </div>
                );
            case 'integrations':
                return (
                    <div className="space-y-5 animate-fade-in">
                        <div>
                            <h3 className="text-lg font-bold text-text">External Integrations</h3>
                            <p className="text-sm text-muted mt-1">Optional, but required for trending lists and the Collection Creator.</p>
                        </div>
                        {importedFromPortal.includes('TMDB') && (
                            <div className="flex items-start gap-3 p-3 rounded-xl border border-green-500/30 bg-green-500/10 text-green-300 text-xs">
                                <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
                                <p>TMDB key was copied from portal Settings. Trakt Client ID and MDBList are not stored in the portal — add those here if needed.</p>
                            </div>
                        )}

                        <div className="grid grid-cols-1 gap-3">
                            <div className="space-y-2 p-4 rounded-xl border border-border bg-background/50">
                                <label className="text-xs font-bold text-plex uppercase tracking-wider">TMDb API Key</label>
                                <input
                                    type="password"
                                    value={config.tmdb_api_key}
                                    onChange={(e) => updateConfig({ tmdb_api_key: e.target.value })}
                                    className={inputClass}
                                    placeholder="The Movie Database Key"
                                />
                            </div>
                            <div className="space-y-2 p-4 rounded-xl border border-border bg-background/50">
                                <label className="text-xs font-bold text-muted uppercase tracking-wider">Trakt Client ID</label>
                                <input
                                    type="password"
                                    value={config.trakt_client_id}
                                    onChange={(e) => updateConfig({ trakt_client_id: e.target.value })}
                                    className={inputClass}
                                    placeholder="Trakt.tv App ID"
                                />
                            </div>
                            <div className="space-y-2 p-4 rounded-xl border border-border bg-background/50">
                                <label className="text-xs font-bold text-muted uppercase tracking-wider">MDBList API Key</label>
                                <input
                                    type="password"
                                    value={config.mdblist_api_key}
                                    onChange={(e) => updateConfig({ mdblist_api_key: e.target.value })}
                                    className={inputClass}
                                    placeholder="MDBList.com Key"
                                />
                            </div>
                        </div>

                        <div className="p-4 bg-plex/10 border border-plex/30 rounded-xl flex items-start gap-3">
                            <AlertCircle className="w-5 h-5 text-plex shrink-0 mt-0.5" />
                            <p className="text-xs text-muted leading-relaxed">
                                <span className="font-bold text-plex">Note:</span> Collection Creator and trending auto-sync stay limited until these keys are set (here or later in Config).
                            </p>
                        </div>
                    </div>
                );
            case 'finalize':
                return (
                    <div className="space-y-5 animate-fade-in">
                        <div className="space-y-2">
                            <label className="text-sm font-semibold text-text">Collexions Label</label>
                            <input
                                type="text"
                                value={config.collexions_label}
                                onChange={(e) => updateConfig({ collexions_label: e.target.value })}
                                className={inputClass}
                                placeholder="Default: Collexions"
                            />
                            <p className="text-xs text-muted">Added to collections managed by the script.</p>
                        </div>

                        <div className="rounded-xl border border-border bg-background/50 p-5 space-y-3">
                            <h4 className="text-text font-bold flex items-center gap-2">
                                <Info className="w-4 h-4 text-plex" />
                                Next steps
                            </h4>
                            <p className="text-sm text-muted leading-relaxed">
                                After you finish, use <span className="text-text font-medium">Config</span> for exclusions, holidays, categories, and to start the worker.
                            </p>
                            <ul className="grid grid-cols-1 gap-2">
                                {[
                                    { text: 'Start the background service once config looks right', highlight: true },
                                    { text: 'Set library exclusions and keyword filters' },
                                    { text: 'Enable special / holiday collections' },
                                    { text: 'Configure categories and custom sorting' }
                                ].map((item, i) => (
                                    <li
                                        key={i}
                                        className={`flex items-center gap-3 text-xs p-2.5 rounded-lg border ${item.highlight
                                            ? 'bg-plex/10 border-plex/40 text-plex font-bold'
                                            : 'bg-card border-border text-muted'
                                            }`}
                                    >
                                        <Check className="w-3.5 h-3.5 shrink-0" />
                                        {item.text}
                                    </li>
                                ))}
                            </ul>
                        </div>

                        <div className="p-4 rounded-xl border border-green-500/30 bg-green-500/10 flex items-start gap-3">
                            <CheckCircle2 className="w-5 h-5 text-green-400 shrink-0 mt-0.5" />
                            <p className="text-sm text-green-300 leading-relaxed font-medium">
                                Ready to enter the Collexions dashboard.
                            </p>
                        </div>
                    </div>
                );
            default:
                return null;
        }
    };

    return (
        <div className="w-full max-w-2xl mx-auto animate-fade-in py-2">
            <div className="mb-6">
                <h1 className="text-2xl md:text-3xl font-bold text-text tracking-tight">Collexions setup</h1>
                <p className="text-sm text-muted mt-1">Configure Plex and integrations for automated collections</p>
            </div>

            <div className="glass-card p-4 md:p-5 shadow-xl mb-4">
                <div className="flex justify-between items-start gap-2 overflow-x-auto no-scrollbar">
                    {steps.map((step, i) => {
                        const Icon = step.icon;
                        const active = i <= currentStep;
                        const isLast = i === steps.length - 1;
                        return (
                            <div key={i} className={`flex flex-col items-center gap-2 relative z-10 min-w-[4.5rem] ${!isLast ? 'flex-1' : ''}`}>
                                <div className={`w-11 h-11 rounded-xl flex items-center justify-center transition-all border ${active
                                    ? 'bg-plex border-plex text-text shadow-lg shadow-plex/20'
                                    : 'bg-background border-border text-muted'
                                    }`}>
                                    <Icon className="w-5 h-5" />
                                </div>
                                <span className={`text-[10px] font-bold uppercase tracking-wider text-center ${active ? 'text-plex' : 'text-muted'}`}>{step.title}</span>
                                {!isLast && (
                                    <div className="absolute top-[1.375rem] left-1/2 w-full h-px -z-10 bg-border hidden sm:block">
                                        <div className={`h-full bg-plex transition-all duration-500 ${i < currentStep ? 'w-full' : 'w-0'}`} />
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>

            <div className="glass-card p-5 md:p-8 shadow-xl">
                {renderStep()}

                {error && (
                    <div className="mt-5 flex items-center gap-3 p-4 rounded-xl border border-red-500/30 bg-red-500/10 text-red-300">
                        <AlertCircle className="w-5 h-5 shrink-0" />
                        <p className="text-sm font-medium">{error}</p>
                    </div>
                )}
                {successMessage && (
                    <div className="mt-5 flex items-center gap-3 p-4 rounded-xl border border-green-500/30 bg-green-500/10 text-green-300">
                        <Check className="w-5 h-5 shrink-0" />
                        <p className="text-sm font-medium">{successMessage}</p>
                    </div>
                )}

                <div className="flex justify-between gap-3 mt-8">
                    <button
                        type="button"
                        onClick={handleBack}
                        disabled={currentStep === 0 || loading}
                        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl border border-border bg-card text-muted font-bold hover:text-text hover:bg-white/5 transition-all disabled:opacity-0"
                    >
                        <ChevronLeft className="w-5 h-5" /> Back
                    </button>

                    {currentStep < steps.length - 1 ? (
                        <button
                            type="button"
                            onClick={handleNext}
                            disabled={loading || (getStepType(currentStep) === 'plex' && availableLibraries.length === 0)}
                            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-plex text-background font-bold hover:bg-plex-hover transition-all disabled:opacity-50 shadow-lg shadow-plex/10"
                        >
                            Next <ChevronRight className="w-5 h-5" />
                        </button>
                    ) : (
                        <button
                            type="button"
                            onClick={handleFinish}
                            disabled={loading}
                            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-plex text-background font-bold hover:bg-plex-hover transition-all disabled:opacity-50 shadow-lg shadow-plex/10"
                        >
                            {loading ? 'Saving...' : 'Enter Dashboard'} <ArrowRight className="w-5 h-5" />
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default Onboarding;
