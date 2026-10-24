import React, { useCallback, useEffect, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { useDiscoverI18n } from '../discovery/i18n';
import { fetchMediaPlayerLibraries, fetchMediaPlayerServers, saveMediaPlayerServers } from '../media-player/api';
import { HomeLibraryHearts, homeLibraryChoices } from '../media-player/HomeLibraryHearts';
import { homeLibraryKey, type HomeLibraryPicks } from '../media-player/homeLibraries';
import { notifyPlayerServersChanged } from '../media-player/playerMemory';
import { readPlayerSettings, writePlayerSettings } from '../media-player/playerSettings';
import type { PlayerSection } from '../media-player/types';

/** Set by a fresh sign-in; cleared once the picker is done (survives a restart mid-way). */
export const FIRST_RUN_SETUP_KEY = 'plexClient.firstRunSetup';

export const firstRunSetupPending = () => {
    try {
        return localStorage.getItem(FIRST_RUN_SETUP_KEY) === 'pending';
    } catch {
        return false;
    }
};

export const markFirstRunSetup = (pending: boolean) => {
    try {
        if (pending) localStorage.setItem(FIRST_RUN_SETUP_KEY, 'pending');
        else localStorage.removeItem(FIRST_RUN_SETUP_KEY);
    } catch { /* storage unavailable */ }
};

type ServerRow = { id: string; name: string; enabled: boolean };

/**
 * Like the Plex app on first launch: before Home, choose which servers to use and which
 * libraries keep their pinned rows on Home (hearts). Both stay editable in Settings.
 */
export const PlexClientFirstRunSetup: React.FC<{ onDone: () => void }> = ({ onDone }) => {
    const { t } = useDiscoverI18n();
    const [servers, setServers] = useState<ServerRow[]>([]);
    const [libraries, setLibraries] = useState<PlayerSection[]>([]);
    const [picks, setPicks] = useState<HomeLibraryPicks>(() => readPlayerSettings().homeLibraries || {});
    const [loading, setLoading] = useState(true);
    const [savingServers, setSavingServers] = useState(false);

    const loadLibraries = useCallback(async () => {
        const data = await fetchMediaPlayerLibraries().catch(() => null);
        if (data && !data.stale) setLibraries(data.libraries || []);
    }, []);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            const data = await fetchMediaPlayerServers().catch(() => null);
            if (cancelled) return;
            setServers(Array.isArray(data?.servers) ? data.servers : []);
            await loadLibraries();
            if (!cancelled) setLoading(false);
        })();
        return () => { cancelled = true; };
    }, [loadLibraries]);

    // Remote: land on the first row once the lists are in.
    useEffect(() => {
        if (loading) return undefined;
        const id = window.setTimeout(() => {
            const active = document.activeElement as HTMLElement | null;
            if (active?.closest?.('[data-tv-first-run="1"] [data-tv-item="1"]')) return;
            document.querySelector<HTMLElement>('[data-tv-first-run="1"] [data-tv-item="1"]')?.focus();
        }, 60);
        return () => window.clearTimeout(id);
    }, [loading]);

    const toggleServer = async (id: string) => {
        const next = servers.map((server) => (server.id === id ? { ...server, enabled: !server.enabled } : server));
        if (!next.some((server) => server.enabled) || savingServers) return;
        const previous = servers;
        setServers(next);
        setSavingServers(true);
        const saved = await saveMediaPlayerServers(next.filter((server) => server.enabled).map((server) => server.id))
            .catch(() => null);
        if (saved?.servers) {
            setServers(saved.servers);
            notifyPlayerServersChanged();
            await loadLibraries();
        } else {
            setServers(previous);
        }
        setSavingServers(false);
    };

    const finish = () => {
        // Write every listed library, so the choice is complete from now on.
        const complete: HomeLibraryPicks = { ...picks };
        for (const library of homeLibraryChoices(libraries)) {
            const key = homeLibraryKey(library.serverId, library.key);
            if (complete[key] === undefined) complete[key] = true;
        }
        writePlayerSettings({ ...readPlayerSettings(), homeLibraries: complete });
        markFirstRunSetup(false);
        onDone();
    };

    return (
        <div className="min-h-screen overflow-y-auto bg-[#07080c] text-zinc-100" data-tv-auth="1" data-tv-first-run="1">
            <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-10">
                <h1 className="text-2xl font-black text-white">{t('mediaPlayerPage.firstRunTitle')}</h1>
                {loading ? (
                    <div className="flex justify-center py-16 text-muted">
                        <Loader2 className="h-7 w-7 animate-spin" />
                    </div>
                ) : (
                    <>
                        {servers.length > 1 ? (
                            <section className="flex flex-col gap-2">
                                <h2 className="text-xs font-black uppercase tracking-widest text-muted">{t('mediaPlayerPage.plexServers')}</h2>
                                <p className="text-sm text-muted">{t('mediaPlayerPage.firstRunServersHint')}</p>
                                {servers.map((server) => (
                                    <button
                                        key={server.id}
                                        type="button"
                                        data-tv-item="1"
                                        data-tv-row="1"
                                        aria-pressed={server.enabled}
                                        disabled={savingServers}
                                        onClick={() => { void toggleServer(server.id); }}
                                        className={`flex w-full items-center justify-between gap-4 rounded-2xl border px-5 py-4 text-left outline-none transition-colors ${
                                            server.enabled ? 'border-plex/40 bg-plex/10' : 'border-white/10 bg-white/[0.03]'
                                        }`}
                                    >
                                        <span className="text-base font-bold text-text">{server.name}</span>
                                        <span
                                            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border ${
                                                server.enabled ? 'border-plex bg-plex text-black' : 'border-white/30'
                                            }`}
                                        >
                                            {server.enabled ? <Check className="h-4 w-4" strokeWidth={3} /> : null}
                                        </span>
                                    </button>
                                ))}
                            </section>
                        ) : null}
                        <section className="flex flex-col gap-2">
                            <h2 className="text-xs font-black uppercase tracking-widest text-muted">{t('mediaPlayerPage.homeLibraries')}</h2>
                            <p className="text-sm text-muted">{t('mediaPlayerPage.firstRunLibrariesHint')}</p>
                            <HomeLibraryHearts tv libraries={libraries} servers={servers} picks={picks} onChange={setPicks} />
                        </section>
                    </>
                )}
                <button
                    type="button"
                    data-tv-item="1"
                    data-tv-row="1"
                    disabled={loading || savingServers}
                    onClick={finish}
                    className="mt-2 inline-flex h-12 items-center justify-center rounded-2xl bg-plex px-6 text-base font-black text-black outline-none disabled:opacity-50"
                >
                    {t('mediaPlayerPage.firstRunContinue')}
                </button>
            </div>
        </div>
    );
};
