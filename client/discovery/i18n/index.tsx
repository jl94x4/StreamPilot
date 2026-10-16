import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../../shared/api';
import { en } from './en';
import { fr } from './fr';
import { de } from './de';
import { es } from './es';
import { ptBR } from './pt-BR';
import { it } from './it';
import { ja } from './ja';
import { pl } from './pl';
import { nl } from './nl';
import { ru } from './ru';
import {
    detectDiscoverBrowserLocale,
    isDiscoverLocale,
    normalizeDiscoverLocale,
    readStoredDiscoverUiLocale,
    setDiscoverUiLocale,
    type DiscoverLocale,
    type DiscoverTranslate,
    type DiscoverTranslateVars,
} from './types';

const catalogs: Record<DiscoverLocale, unknown> = { en, fr, de, es, 'pt-BR': ptBR, it, ja, pl, nl, ru };

const getPath = (obj: unknown, path: string): unknown => {
    let current: unknown = obj;
    for (const part of path.split('.')) {
        if (current == null || typeof current !== 'object') return undefined;
        current = (current as Record<string, unknown>)[part];
    }
    return current;
};

const interpolate = (template: string, vars?: DiscoverTranslateVars) => {
    if (!vars) return template;
    return template.replace(/\{(\w+)\}/g, (_, key: string) => (
        vars[key] != null ? String(vars[key]) : `{${key}}`
    ));
};

export const createDiscoverTranslate = (locale: DiscoverLocale): DiscoverTranslate => (
    (key, vars) => {
        const plural = vars && typeof vars.count === 'number' && Math.abs(Number(vars.count)) !== 1;
        const candidates = plural ? [`${key}_plural`, key] : [key];
        for (const candidate of candidates) {
            const fromLocale = getPath(catalogs[locale], candidate);
            if (typeof fromLocale === 'string') return interpolate(fromLocale, vars);
        }
        for (const candidate of candidates) {
            const fromEn = getPath(en, candidate);
            if (typeof fromEn === 'string') return interpolate(fromEn, vars);
        }
        return key;
    }
);

/** Map internal English status tokens to translated UI labels. */
export const translateDiscoverStatus = (t: DiscoverTranslate, label?: string | null): string => {
    const raw = String(label || '').trim();
    if (!raw) return '';
    const map: Record<string, string> = {
        Available: 'status.available',
        'Available in library': 'status.availableInLibrary',
        Partial: 'status.partial',
        'Partially available': 'status.partiallyAvailable',
        Pending: 'status.pending',
        'Pending Approval': 'status.pendingApproval',
        'Request Pending': 'status.requestPending',
        Processing: 'status.processing',
        Requested: 'status.requested',
        Approved: 'status.approved',
        Declined: 'status.declined',
        Failed: 'status.failed',
        Blacklisted: 'status.blacklisted',
        'Not requested': 'status.notRequested',
        'Up to date': 'status.upToDate',
        'Request failed': 'status.requestFailed',
        'Request declined': 'status.requestDeclined',
        Unknown: 'status.unknown',
        Open: 'status.open',
        Resolved: 'status.resolved',
        All: 'status.all',
        'In Lidarr': 'status.inLidarr',
        'Request Movie': 'request.requestMovie',
        'Request Series': 'request.requestSeries',
        'Request Seasons': 'request.requestSeasons',
        'All Seasons Requested': 'request.allSeasonsRequested',
        'Notify me': 'request.notifyMe',
        Watching: 'request.watching',
    };
    const key = map[raw];
    return key ? t(key) : raw;
};

/** Map internal English availability detail text to translated UI copy. */
export const translateDiscoverAvailabilityDetail = (t: DiscoverTranslate, detail?: string | null): string => {
    const raw = String(detail || '').trim();
    if (!raw) return '';

    const exactMap: Record<string, string> = {
        'Something went wrong fulfilling this request. You can retry from My Requests.': 'availability.fulfillmentFailed',
        'Your request is approved. New episodes will download as they air.': 'availability.requestApprovedFutureEpisodes',
    };
    const exactKey = exactMap[raw];
    if (exactKey) return t(exactKey);

    const sentenceParts = raw.split('. ');
    if (sentenceParts.length > 1) {
        return sentenceParts
            .map((part, index) => translateDiscoverAvailabilityDetail(
                t,
                index < sentenceParts.length - 1 && !part.endsWith('.') ? `${part}.` : part,
            ))
            .join(' ');
    }

    const seasonsInLibrary = raw.match(/^Seasons ([\d,\s-]+) in library$/);
    if (seasonsInLibrary) return t('availability.seasonsInLibrary', { seasons: seasonsInLibrary[1].trim() });
    const seasonCountInLibrary = raw.match(/^(\d+) seasons in library$/);
    if (seasonCountInLibrary) return t('availability.seasonCountInLibrary', { count: Number(seasonCountInLibrary[1]) });
    const seasonsUpToDate = raw.match(/^Seasons ([\d,\s-]+) up to date$/);
    if (seasonsUpToDate) return t('availability.seasonsUpToDate', { seasons: seasonsUpToDate[1].trim() });
    const seasonUpToDate = raw.match(/^Season ([\d,\s-]+) up to date$/);
    if (seasonUpToDate) return t('availability.seasonUpToDate', { seasons: seasonUpToDate[1].trim() });
    const seasonCountUpToDate = raw.match(/^(\d+) seasons up to date$/);
    if (seasonCountUpToDate) return t('availability.seasonCountUpToDate', { count: Number(seasonCountUpToDate[1]) });
    const stillRequestable = raw.match(/^(\d+) seasons? still requestable\.$/);
    if (stillRequestable) return t('availability.stillRequestable', { count: Number(stillRequestable[1]) });
    const missingEpisodes = raw.match(/^(\d+) seasons? missing episodes in your library\.$/);
    if (missingEpisodes) return t('availability.missingEpisodes', { count: Number(missingEpisodes[1]) });

    const map: Record<string, string> = {
        'All requested seasons are available.': 'availability.allRequestedSeasonsAvailable',
        'This title cannot be requested.': 'availability.titleCannotRequest',
        'Something went wrong fulfilling this request. You can retry from My Requests.': 'availability.fulfillmentFailed',
        'Your request was declined by an admin.': 'availability.declinedByAdmin',
        'Episodes are still downloading or importing.': 'availability.episodesDownloading',
        'Some episodes are on disk; more are scheduled to air.': 'availability.someEpisodesScheduled',
        'This series is in your library and still airing.': 'availability.seriesStillAiring',
        'Part of this series is already in your library.': 'availability.partSeriesInLibrary',
        'All aired episodes are on disk (verified via Sonarr).': 'availability.allAiredOnDisk',
        'All aired episodes are in your library.': 'availability.allAiredInLibrary',
        'New episodes will be added as they air.': 'availability.newEpisodesAdded',
        'Your request is being downloaded or imported.': 'availability.requestDownloading',
        'Approved — waiting for downloads to finish.': 'availability.approvedWaitingDownloads',
        'Your request is approved. New episodes will download as they air.': 'availability.requestApprovedFutureEpisodes',
        'Your request was sent to the media server and is waiting to download.': 'availability.requestSentMediaServer',
        'Approved and sent to your media server.': 'availability.approvedSentMediaServer',
        'Waiting for an admin to approve your request.': 'availability.waitingAdmin',
        'This movie is already in your media library.': 'availability.movieAlreadyInLibrary',
        'Part of this title may already be in your library.': 'availability.partTitleInLibrary',
        'Albums are downloading or importing.': 'availability.albumsDownloading',
        'This artist is monitored in your music library.': 'availability.artistMonitored',
        'This artist is already in your music library.': 'availability.artistAlreadyInLibrary',
        'Some albums from this artist are already in your library.': 'availability.someAlbumsInLibrary',
        'Your artist request was sent to Lidarr.': 'availability.artistRequestSent',
        'This series is in your media library.': 'availability.seriesInLibrary',
        'Request is awaiting processing.': 'availability.requestAwaitingProcessing',
    };
    const key = map[raw];
    return key ? t(key) : raw;
};

type DiscoverI18nContextValue = {
    locale: DiscoverLocale;
    setLocale: (locale: DiscoverLocale) => void;
    t: DiscoverTranslate;
};

const DiscoverI18nContext = createContext<DiscoverI18nContextValue | null>(null);

export const DiscoverI18nProvider: React.FC<{
    children: React.ReactNode;
    accountLocale?: unknown;
    accountId?: unknown;
}> = ({ children, accountLocale, accountId }) => {
    const accountKey = String(accountId || '');
    const previousAccountKey = useRef(accountKey);
    const explicitLocale = useRef<DiscoverLocale | null>(null);
    const [locale, setLocaleState] = useState<DiscoverLocale>(() => (
        isDiscoverLocale(accountLocale)
            ? accountLocale
            : (readStoredDiscoverUiLocale() || detectDiscoverBrowserLocale())
    ));

    const setLocale = useCallback((next: DiscoverLocale) => {
        const normalized = normalizeDiscoverLocale(next);
        explicitLocale.current = normalized;
        setLocaleState(normalized);
        setDiscoverUiLocale(normalized);
        void apiFetch('/api/users/preferences', {
            method: 'POST',
            body: JSON.stringify({ uiLocale: normalized }),
        }).catch(() => {
            // Local state remains authoritative when account persistence is unavailable.
        });
    }, []);

    React.useEffect(() => {
        if (previousAccountKey.current !== accountKey) {
            previousAccountKey.current = accountKey;
            explicitLocale.current = null;
        }
        if (!isDiscoverLocale(accountLocale)) return;
        if (explicitLocale.current) return;
        setLocaleState(accountLocale);
        setDiscoverUiLocale(accountLocale);
    }, [accountId, accountKey, accountLocale]);

    React.useEffect(() => {
        setDiscoverUiLocale(locale);
    }, [locale]);

    const t = useMemo(() => createDiscoverTranslate(locale), [locale]);

    const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

    return (
        <DiscoverI18nContext.Provider value={value}>
            {children}
        </DiscoverI18nContext.Provider>
    );
};

/** Stable fallback so effects that list `t` as a dep do not cancel/refetch forever without a provider. */
const FALLBACK_DISCOVER_T = createDiscoverTranslate('en');

export const useDiscoverI18n = () => {
    const ctx = useContext(DiscoverI18nContext);
    if (!ctx) {
        return {
            locale: 'en' as DiscoverLocale,
            setLocale: (_locale: DiscoverLocale) => undefined,
            t: FALLBACK_DISCOVER_T,
        };
    }
    return ctx;
};

export { DISCOVER_LOCALES, type DiscoverLocale } from './types';
