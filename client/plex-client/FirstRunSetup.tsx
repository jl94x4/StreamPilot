import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, Check, Film, Heart, Loader2, Music, Server, Tv } from 'lucide-react';
import { useDiscoverI18n } from '../discovery/i18n';
import { fetchMediaPlayerLibraries, fetchMediaPlayerServers, saveMediaPlayerServers } from '../media-player/api';
import { homeLibraryChoices, toggleHomeLibraryPick } from '../media-player/HomeLibraryHearts';
import { homeLibraryKey, homeLibraryShown, type HomeLibraryPicks } from '../media-player/homeLibraries';
import { notifyPlayerServersChanged } from '../media-player/playerMemory';
import { readPlayerSettings, writePlayerSettings } from '../media-player/playerSettings';
import type { PlayerSection } from '../media-player/types';
import { AuthMark, AuthMediaWall } from './AuthScreen';
import { isAndroidTvUi } from './config';

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

const typeIcon = (type: string) => (type === 'movie' ? Film : type === 'show' ? Tv : Music);

/**
 * Like the Plex app on first launch: before Home, choose which servers to use and which
 * libraries keep their pinned rows on Home (hearts). Both stay editable in Settings.
 * Same poster wall as sign-in, so it reads as the next step of the same flow.
 */
export const PlexClientFirstRunSetup: React.FC<{ onDone: () => void }> = ({ onDone }) => {
    const { t } = useDiscoverI18n();
    const isTv = isAndroidTvUi();
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

    // Remote: land on the first library once the lists are in.
    useEffect(() => {
        if (loading) return undefined;
        const id = window.setTimeout(() => {
            const active = document.activeElement as HTMLElement | null;
            if (active?.closest?.('[data-tv-first-run="1"] [data-tv-item="1"]')) return;
            const first = document.querySelector<HTMLElement>('[data-tv-first-run="1"] .smp-setup-card')
                || document.querySelector<HTMLElement>('[data-tv-first-run="1"] [data-tv-item="1"]');
            first?.focus();
        }, 60);
        return () => window.clearTimeout(id);
    }, [loading]);

    const choices = useMemo(() => homeLibraryChoices(libraries), [libraries]);
    const shownCount = choices.filter((library) => homeLibraryShown(picks, library.serverId, library.key)).length;
    const manyServers = servers.filter((server) => server.enabled).length > 1;
    const serverName = (id?: string | null) => servers.find((server) => server.id === id)?.name || '';

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

    const setAll = (shown: boolean) => {
        const next: HomeLibraryPicks = { ...picks };
        for (const library of choices) next[homeLibraryKey(library.serverId, library.key)] = shown;
        setPicks(next);
    };

    const finish = () => {
        // Write every listed library, so the choice is complete from now on.
        const complete: HomeLibraryPicks = { ...picks };
        for (const library of choices) {
            const key = homeLibraryKey(library.serverId, library.key);
            if (complete[key] === undefined) complete[key] = true;
        }
        writePlayerSettings({ ...readPlayerSettings(), homeLibraries: complete });
        markFirstRunSetup(false);
        onDone();
    };

    const typeLabel = (type: string) => (
        type === 'movie'
            ? t('mediaPlayerPage.homeLibraryMovies')
            : type === 'show' ? t('mediaPlayerPage.homeLibraryShows') : t('mediaPlayerPage.homeLibraryMusic')
    );

    return (
        <div className="smp-auth smp-setup relative min-h-screen overflow-x-hidden overflow-y-auto bg-[#06070b] text-zinc-100" data-tv-auth="1" data-tv-first-run="1">
            <AuthMediaWall />
            <div className="smp-setup-shell relative z-10">
                <aside className="smp-setup-intro">
                    <AuthMark tv={isTv} />
                    <span className="smp-auth-eyebrow">
                        <span className="smp-auth-eyebrow-dot" />
                        Almost there
                    </span>
                    <h1 className="smp-auth-headline smp-setup-headline text-white">
                        Make Home
                        <span className="smp-auth-headline-accent">yours.</span>
                    </h1>
                    <p className="smp-setup-lede">
                        Heart the libraries you want on Home. Empty a heart to keep that library’s pinned rows out of sight.
                    </p>
                    {!loading && choices.length ? (
                        <div className="smp-setup-count" aria-live="polite">
                            <Heart className="h-4 w-4" fill="currentColor" strokeWidth={0} />
                            <strong>{shownCount}</strong> of {choices.length} on Home
                        </div>
                    ) : null}
                    {/* One remote row: Left/Right search inside the focused data-tv-row only. */}
                    <div className="smp-setup-actions" data-tv-row="1">
                        <button
                            type="button"
                            data-tv-item="1"
                            disabled={loading}
                            aria-busy={savingServers}
                            onClick={() => { if (!savingServers) finish(); }}
                            className="smp-auth-button smp-auth-primary inline-flex items-center justify-center gap-2.5 rounded-2xl px-7 py-4 text-lg text-zinc-950 disabled:opacity-50"
                        >
                            Continue to Home
                            <ArrowRight className="h-5 w-5" />
                        </button>
                        {!loading && choices.length > 1 ? (
                            <button
                                type="button"
                                data-tv-item="1"
                                    onClick={() => setAll(shownCount < choices.length)}
                                className="smp-setup-ghost"
                            >
                                {shownCount < choices.length ? 'Heart all' : 'Clear all'}
                            </button>
                        ) : null}
                    </div>
                    <p className="smp-auth-note">You can change all of this later in Settings → Home.</p>
                </aside>

                <section className="smp-setup-panel">
                    {loading ? (
                        <div className="flex flex-1 items-center justify-center py-24 text-zinc-500">
                            <Loader2 className="h-8 w-8 animate-spin" />
                        </div>
                    ) : (
                        <>
                            {servers.length > 1 ? (
                                <div className="smp-setup-servers">
                                    <p className="smp-setup-label">{t('mediaPlayerPage.plexServers')}</p>
                                    <div className="flex flex-wrap gap-2.5">
                                        {servers.map((server) => (
                                            <button
                                                key={server.id}
                                                type="button"
                                                data-tv-item="1"
                                                aria-pressed={server.enabled}
                                                // Not disabled while saving: a disabled button drops focus and the
                                                // remote then jumped back to Continue. toggleServer ignores repeats.
                                                aria-busy={savingServers}
                                                onClick={() => { void toggleServer(server.id); }}
                                                className={`smp-setup-server ${server.enabled ? 'is-on' : ''}`}
                                            >
                                                <Server className="h-4 w-4" />
                                                {server.name}
                                                <span className="smp-setup-server-tick">
                                                    {server.enabled ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : null}
                                                </span>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            ) : null}
                            <p className="smp-setup-label">{t('mediaPlayerPage.homeLibraries')}</p>
                            {choices.length ? (
                                <div className="smp-setup-grid" data-tv-rail="1">
                                    {choices.map((library) => {
                                        const shown = homeLibraryShown(picks, library.serverId, library.key);
                                        const type = String(library.type || '');
                                        const Icon = typeIcon(type);
                                        const server = manyServers ? serverName(library.serverId) : '';
                                        return (
                                            <button
                                                key={homeLibraryKey(library.serverId, library.key)}
                                                type="button"
                                                data-tv-item="1"
                                                aria-pressed={shown}
                                                onClick={() => setPicks(toggleHomeLibraryPick(picks, libraries, library))}
                                                className={`smp-setup-card is-${type || 'other'} ${shown ? 'is-on' : ''}`}
                                            >
                                                <span className="smp-setup-card-icon"><Icon className="h-6 w-6" strokeWidth={2} /></span>
                                                <span className="min-w-0 flex-1 text-left">
                                                    <span className="smp-setup-card-title">{library.title}</span>
                                                    <span className="smp-setup-card-sub">
                                                        {typeLabel(type)}{server ? ` · ${server}` : ''}
                                                    </span>
                                                </span>
                                                <span className="smp-setup-card-heart" aria-label={shown ? t('mediaPlayerPage.homeLibraryShown') : t('mediaPlayerPage.homeLibraryHidden')}>
                                                    <Heart className="h-5 w-5" fill={shown ? 'currentColor' : 'none'} strokeWidth={2.2} />
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                            ) : (
                                <p className="text-sm text-zinc-400">{t('mediaPlayerPage.homeLibrariesEmpty')}</p>
                            )}
                        </>
                    )}
                </section>
            </div>
        </div>
    );
};
