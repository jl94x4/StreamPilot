import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Clock, Search } from 'lucide-react';
import { useDiscoverI18n } from '../discovery/i18n';
import type { SettingsIndexEntry } from './settingsIndex';
import {
    getRecentSettingsEntries,
    searchSettingsIndex,
} from './settingsIndex';

const SETTINGS_INDEX_GROUP_KEYS: Record<string, string> = {
    Portal: 'settings.navigation.groups.portal',
    'Media Stack': 'settings.navigation.groups.mediaStack',
    Comms: 'settings.navigation.groups.comms',
    Automation: 'settings.navigation.groups.automation',
};
const SETTINGS_INDEX_TAB_KEYS: Record<string, string> = {
    plex: 'settings.navigation.tabs.plex', layout: 'settings.navigation.tabs.layout', applets: 'settings.navigation.tabs.applets',
    'stream-rules': 'settings.navigation.tabs.streamRules', branding: 'settings.navigation.tabs.branding', contact: 'settings.navigation.tabs.contact',
    achievements: 'settings.navigation.tabs.achievements', analytics: 'settings.navigation.tabs.analytics', mediastack: 'settings.navigation.tabs.mediastack',
    request: 'settings.navigation.tabs.request', status: 'settings.navigation.tabs.status', notifications: 'settings.navigation.tabs.notifications',
    newsletter: 'settings.navigation.tabs.newsletter', broadcast: 'settings.navigation.tabs.broadcast', invites: 'settings.navigation.tabs.invites',
    cleanup: 'settings.navigation.tabs.cleanup', cleaner: 'settings.navigation.tabs.cleaner', tasks: 'settings.navigation.tabs.tasks', upgrader: 'settings.navigation.tabs.upgrader',
    collexions: 'settings.navigation.tabs.collexions', 'spotify-sync': 'settings.navigation.tabs.spotifySync', 'metadata-fill': 'settings.navigation.tabs.metadataFill', scanner: 'settings.navigation.tabs.scanner',
    'media-automation': 'settings.navigation.tabs.mediaAutomation', 'poster-sets': 'settings.navigation.tabs.posterSets', overlays: 'settings.navigation.tabs.overlays',
    editions: 'settings.navigation.tabs.editions', 'watch-sync': 'settings.navigation.tabs.watchSync', system: 'settings.navigation.tabs.system', logs: 'settings.navigation.tabs.logs',
};
export const SettingsSearchPanel: React.FC<{
    onSelect: (entry: SettingsIndexEntry) => void;
    activeEntryId?: string | null;
}> = ({ onSelect, activeEntryId }) => {
    const { t } = useDiscoverI18n();
    const [query, setQuery] = useState('');
    const [recent, setRecent] = useState<SettingsIndexEntry[]>([]);
    const [isFocused, setIsFocused] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        setRecent(getRecentSettingsEntries());
    }, []);

    const results = useMemo(() => searchSettingsIndex(query), [query]);
    const showResults = isFocused && query.trim().length > 0;
    const showRecent = isFocused && query.trim().length === 0 && recent.length > 0;

    useEffect(() => {
        const handleOutsideClick = (event: MouseEvent) => {
            if (!containerRef.current?.contains(event.target as Node)) {
                setIsFocused(false);
            }
        };
        document.addEventListener('mousedown', handleOutsideClick);
        return () => document.removeEventListener('mousedown', handleOutsideClick);
    }, []);

    const handleSelect = (entry: SettingsIndexEntry) => {
        onSelect(entry);
        setRecent(getRecentSettingsEntries());
        setQuery('');
        setIsFocused(false);
    };

    const tabLabel = (tabId: string) => {
        const key = SETTINGS_INDEX_TAB_KEYS[tabId];
        return key ? t(key) : tabId.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    };

    const groupLabel = (group: string) => {
        const key = SETTINGS_INDEX_GROUP_KEYS[group];
        return key ? t(key) : group;
    };

    const entryLabel = (entry: SettingsIndexEntry) => {
        if (entry.labelKey) return t(entry.labelKey);
        if (!entry.sectionId && entry.id === entry.tabId) return tabLabel(entry.tabId);
        return entry.label;
    };

    const renderEntryButton = (entry: SettingsIndexEntry, icon?: React.ReactNode) => (
        <button
            key={entry.id}
            type="button"
            onClick={() => handleSelect(entry)}
            className={`w-full text-left px-2.5 py-2 rounded-md text-sm transition-all ${
                activeEntryId === entry.id
                    ? 'nav-item-active'
                    : 'text-text hover:bg-white/5'
            }`}
        >
            <span className="flex items-start gap-2">
                {icon}
                <span className="min-w-0">
                    <span className="font-medium block truncate">{entryLabel(entry)}</span>
                    <span className="text-[10px] text-muted block truncate">
                        {entry.sectionId ? `${groupLabel(entry.group)} · ${tabLabel(entry.tabId)}` : groupLabel(entry.group)}
                    </span>
                </span>
            </span>
        </button>
    );

    return (
        <div ref={containerRef} className="shrink-0 relative">
            <label className="sr-only">{t('settings.search.label')}</label>
            <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted pointer-events-none" />
                <input
                    type="text"
                    inputMode="search"
                    placeholder={t('settings.search.placeholder')}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onFocus={() => {
                        setIsFocused(true);
                        setRecent(getRecentSettingsEntries());
                    }}
                    className="w-full appearance-none bg-background border border-border rounded-lg pl-8 pr-3 py-1.5 text-[16px] leading-5 text-text focus:outline-none focus:border-plex transition-colors"
                />
            </div>

            {(showResults || showRecent) && (
                <div className="absolute z-30 left-0 right-0 mt-1.5 rounded-lg border border-border bg-card shadow-2xl overflow-hidden">
                    {showRecent && (
                        <div className="p-2">
                            <p className="text-[10px] uppercase tracking-wider font-bold text-muted px-2 py-1 flex items-center gap-1.5">
                                <Clock className="w-3 h-3" /> {t('settings.search.recent')}
                            </p>
                            <div className="space-y-0.5">
                                {recent.map((entry) => renderEntryButton(entry))}
                            </div>
                        </div>
                    )}
                    {showResults && (
                        <div className="p-2">
                            <p className="text-[10px] uppercase tracking-wider font-bold text-muted px-2 py-1">{t('settings.search.results')}</p>
                            {results.length === 0 ? (
                                <p className="text-xs text-muted px-2 py-2">{t('settings.search.empty')}</p>
                            ) : (
                                <div className="space-y-0.5 max-h-64 overflow-y-auto custom-scrollbar">
                                    {results.map((entry) => renderEntryButton(entry))}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
