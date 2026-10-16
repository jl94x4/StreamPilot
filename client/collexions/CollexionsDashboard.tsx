import React, { useCallback, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { Layers } from 'lucide-react';
import { getBasePath } from '../shared/basePath';
import { DashboardHero, DashboardPageShell } from '../shared/dashboard/DashboardChrome';
import { api } from './api';
import { CollexionsSubnav } from './CollexionsSubnav';
import Dashboard from './pages/Dashboard';
import Gallery from './pages/Gallery';
import HubsPage from './pages/Hubs';
import Creator from './pages/Creator';
import JobsPage from './pages/Jobs';
import StatsPage from './pages/Stats';
import ConfigPage from './pages/Config';
import LogsPage from './pages/Logs';
import Onboarding from './pages/Onboarding';

const Shell: React.FC = () => (
    <DashboardPageShell>
        <DashboardHero
            accent="plex"
            eyebrow="Collexions"
            title="Automated Plex collections"
            description="Pin fresh titles into Plex collections on a schedule — specials, category rolls, and fairness rules keep libraries feeling curated."
            icon={<Layers className="h-3.5 w-3.5" />}
            secondaryBlob
        />
        <CollexionsSubnav />
        <Outlet />
    </DashboardPageShell>
);

const CollexionsRoutes: React.FC = () => {
    const [needsOnboarding, setNeedsOnboarding] = useState<boolean | null>(null);
    const [bootError, setBootError] = useState('');
    const [bootKey, setBootKey] = useState(0);

    const retryBoot = useCallback(() => {
        setBootError('');
        setNeedsOnboarding(null);
        setBootKey((k) => k + 1);
    }, []);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const status = await api.getAuthStatus();
                if (!cancelled) {
                    setBootError('');
                    setNeedsOnboarding(!!status.needs_onboarding);
                }
            } catch (e: any) {
                if (!cancelled) {
                    setBootError(e?.message || 'Collexions worker is unreachable. Enable it in Settings → Collexions and Save.');
                    setNeedsOnboarding(false);
                }
            }
        })();
        const onDone = () => setNeedsOnboarding(false);
        window.addEventListener('collexions-onboarding-done', onDone);
        return () => {
            cancelled = true;
            window.removeEventListener('collexions-onboarding-done', onDone);
        };
    }, [bootKey]);

    if (needsOnboarding === null) {
        return (
            <div className="flex h-64 items-center justify-center text-muted flex-col gap-3">
                <div className="w-8 h-8 border-2 border-border border-t-plex rounded-full animate-spin" />
                <p className="text-sm">Connecting to Collexions…</p>
            </div>
        );
    }

    if (bootError && needsOnboarding === false) {
        // Still allow shell if onboarding not needed, but show error on dashboard.
        // If we couldn't reach worker at all, show full-page retry instead of empty dashboard spam.
        const looksUnreachable = /timed out|unreachable|Cannot reach|disabled|503|502|504/i.test(bootError);
        if (looksUnreachable) {
            return (
                <div className="flex h-72 items-center justify-center flex-col gap-4 text-center px-4">
                    <div className="w-10 h-10 rounded-full border border-red-500/40 bg-red-500/10 flex items-center justify-center">
                        <span className="text-red-300 text-lg">!</span>
                    </div>
                    <div className="max-w-md space-y-2">
                        <h2 className="text-lg font-bold text-text">Collexions unavailable</h2>
                        <p className="text-sm text-red-300/90">{bootError}</p>
                        <p className="text-xs text-muted">Check Settings → Collexions (enabled, worker running), then retry.</p>
                    </div>
                    <button
                        type="button"
                        onClick={retryBoot}
                        className="px-4 py-2 rounded-lg bg-plex text-background text-sm font-bold hover:bg-plex-hover transition-colors"
                    >
                        Retry connection
                    </button>
                </div>
            );
        }
    }

    return (
        <Routes>
            <Route path="onboarding" element={<Onboarding />} />
            <Route element={<Shell />}>
                <Route
                    index
                    element={
                        needsOnboarding
                            ? <Navigate to="onboarding" replace />
                            : (
                                <>
                                    {bootError && (
                                        <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 text-red-300 px-4 py-3 text-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                            <span>{bootError}</span>
                                            <button
                                                type="button"
                                                onClick={retryBoot}
                                                className="text-plex font-semibold hover:underline whitespace-nowrap"
                                            >
                                                Retry
                                            </button>
                                        </div>
                                    )}
                                    <Dashboard />
                                </>
                            )
                    }
                />
                <Route path="gallery" element={<Gallery />} />
                <Route path="hubs" element={<HubsPage />} />
                <Route path="creator" element={<Creator />} />
                <Route path="jobs" element={<JobsPage />} />
                <Route path="stats" element={<StatsPage />} />
                <Route path="config" element={<ConfigPage />} />
                <Route path="logs" element={<LogsPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
    );
};

export const CollexionsDashboard: React.FC = () => {
    const basename = `${getBasePath()}/collexions`.replace(/\/+/g, '/') || '/collexions';
    return (
        <BrowserRouter basename={basename}>
            <CollexionsRoutes />
        </BrowserRouter>
    );
};
