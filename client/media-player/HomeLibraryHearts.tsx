import React from 'react';
import { Heart } from 'lucide-react';
import { useDiscoverI18n } from '../discovery/i18n';
import { homeLibraryKey, homeLibraryShown, type HomeLibraryPicks } from './homeLibraries';
import type { PlayerSection } from './types';

const HOME_LIBRARY_TYPES = new Set(['movie', 'show', 'artist']);

/** Libraries that can have a Home row (films, TV, music). */
export const homeLibraryChoices = (libraries: PlayerSection[]) => (
    libraries.filter((library) => HOME_LIBRARY_TYPES.has(String(library.type || '')) && homeLibraryKey(library.serverId, library.key))
);

/** Flip one library, writing every listed library so the choice is complete from now on. */
export const toggleHomeLibraryPick = (
    picks: HomeLibraryPicks,
    libraries: PlayerSection[],
    library: PlayerSection,
): HomeLibraryPicks => {
    const next: HomeLibraryPicks = { ...picks };
    for (const row of homeLibraryChoices(libraries)) {
        const key = homeLibraryKey(row.serverId, row.key);
        if (next[key] === undefined) next[key] = true;
    }
    const key = homeLibraryKey(library.serverId, library.key);
    if (key) next[key] = !homeLibraryShown(picks, library.serverId, library.key);
    return next;
};

/**
 * Heart per library: filled shows its row on Home, empty hides it. Grouped by server when
 * there is more than one. D-pad friendly (one focusable row each).
 */
export const HomeLibraryHearts: React.FC<{
    libraries: PlayerSection[];
    servers?: Array<{ id: string; name: string }>;
    picks: HomeLibraryPicks;
    onChange: (next: HomeLibraryPicks) => void;
    tv?: boolean;
}> = ({ libraries, servers = [], picks, onChange, tv = false }) => {
    const { t } = useDiscoverI18n();
    const choices = homeLibraryChoices(libraries);
    if (!choices.length) {
        return <p className="text-sm text-muted">{t('mediaPlayerPage.homeLibrariesEmpty')}</p>;
    }
    const groups = new Map<string, PlayerSection[]>();
    for (const library of choices) {
        const id = String(library.serverId || '');
        groups.set(id, [...(groups.get(id) || []), library]);
    }
    const serverName = (id: string) => (
        servers.find((server) => server.id === id)?.name
        || choices.find((library) => String(library.serverId || '') === id)?.serverName
        || ''
    );
    const typeLabel = (type: string) => (
        type === 'movie'
            ? t('mediaPlayerPage.homeLibraryMovies')
            : type === 'show' ? t('mediaPlayerPage.homeLibraryShows') : t('mediaPlayerPage.homeLibraryMusic')
    );
    return (
        <div className="flex flex-col gap-4">
            {[...groups.entries()].map(([serverId, rows]) => (
                <div key={serverId || 'server'} className="flex flex-col gap-2">
                    {groups.size > 1 ? (
                        <h3 className="text-xs font-black uppercase tracking-widest text-muted">{serverName(serverId)}</h3>
                    ) : null}
                    {rows.map((library) => {
                        const shown = homeLibraryShown(picks, library.serverId, library.key);
                        return (
                            <button
                                key={homeLibraryKey(library.serverId, library.key)}
                                type="button"
                                data-tv-item="1"
                                data-tv-row="1"
                                aria-pressed={shown}
                                onClick={() => onChange(toggleHomeLibraryPick(picks, libraries, library))}
                                className={`flex w-full items-center justify-between gap-4 rounded-2xl border text-left outline-none transition-colors ${
                                    tv ? 'px-5 py-4' : 'px-4 py-3'
                                } ${shown ? 'border-plex/40 bg-plex/10' : 'border-white/10 bg-white/[0.03]'}`}
                            >
                                <span className="min-w-0">
                                    <span className={`block font-bold text-text ${tv ? 'text-base' : 'text-sm'}`}>{library.title}</span>
                                    <span className="mt-0.5 block text-xs text-muted">{typeLabel(String(library.type || ''))}</span>
                                </span>
                                <Heart
                                    className={`shrink-0 ${tv ? 'h-6 w-6' : 'h-5 w-5'} ${shown ? 'text-plex' : 'text-muted'}`}
                                    fill={shown ? 'currentColor' : 'none'}
                                    strokeWidth={2.2}
                                    aria-label={shown ? t('mediaPlayerPage.homeLibraryShown') : t('mediaPlayerPage.homeLibraryHidden')}
                                />
                            </button>
                        );
                    })}
                </div>
            ))}
        </div>
    );
};
