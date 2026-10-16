export const DISCOVER_LOCALES = [
    { code: 'en', label: 'English', nativeLabel: 'English' },
    { code: 'fr', label: 'French', nativeLabel: 'Français' },
    { code: 'de', label: 'German', nativeLabel: 'Deutsch' },
    { code: 'es', label: 'Spanish', nativeLabel: 'Español' },
    { code: 'pt-BR', label: 'Portuguese (Brazil)', nativeLabel: 'Português (Brasil)' },
    { code: 'it', label: 'Italian', nativeLabel: 'Italiano' },
    { code: 'ja', label: 'Japanese', nativeLabel: '日本語' },
    { code: 'pl', label: 'Polish', nativeLabel: 'Polski' },
    { code: 'nl', label: 'Dutch', nativeLabel: 'Nederlands' },
    { code: 'ru', label: 'Russian', nativeLabel: 'Русский' },
] as const;

export type DiscoverLocale = (typeof DISCOVER_LOCALES)[number]['code'];

export const DISCOVER_UI_LOCALE_KEY = 'discoverUiLocale';

/** Sent on discovery proxy/search calls so the server can localize TMDB metadata. */
export const DISCOVER_LOCALE_HEADER = 'X-Portal-Discover-Locale';

let activeDiscoverUiLocale: DiscoverLocale | null = null;

export const isDiscoverLocale = (value: unknown): value is DiscoverLocale => (
    DISCOVER_LOCALES.some((locale) => locale.code === value)
);

/** Match an exact or regional browser locale to one of the supported catalogs. */
export const matchDiscoverLocale = (value: unknown): DiscoverLocale | null => {
    const raw = String(value || '').trim().toLowerCase().replace(/_/g, '-');
    if (!raw) return null;
    const exact = DISCOVER_LOCALES.find((locale) => locale.code.toLowerCase() === raw);
    if (exact) return exact.code;
    const base = raw.split('-')[0];
    return DISCOVER_LOCALES.find((locale) => locale.code === base)?.code || null;
};

export const normalizeDiscoverLocale = (value: unknown): DiscoverLocale => (
    matchDiscoverLocale(value) || 'en'
);

/** TMDB / Seerr metadata language codes for our supported UI locales. */
export const discoverLocaleToTmdbLanguage = (locale: unknown): DiscoverLocale => (
    normalizeDiscoverLocale(locale)
);

export const readDiscoverUiLocale = (): DiscoverLocale => {
    try {
        if (activeDiscoverUiLocale) return activeDiscoverUiLocale;
        if (typeof localStorage === 'undefined') return 'en';
        return normalizeDiscoverLocale(localStorage.getItem(DISCOVER_UI_LOCALE_KEY));
    } catch {
        return 'en';
    }
};

export const setDiscoverUiLocale = (locale: DiscoverLocale): void => {
    activeDiscoverUiLocale = locale;
    try {
        localStorage.setItem(DISCOVER_UI_LOCALE_KEY, locale);
    } catch {
        /* ignore */
    }
};

export const readStoredDiscoverUiLocale = (): DiscoverLocale | null => {
    try {
        if (typeof localStorage === 'undefined') return null;
        return matchDiscoverLocale(localStorage.getItem(DISCOVER_UI_LOCALE_KEY));
    } catch {
        return null;
    }
};

export const detectDiscoverBrowserLocale = (): DiscoverLocale => {
    if (typeof navigator === 'undefined') return 'en';
    const candidates = [
        ...(Array.isArray(navigator.languages) ? navigator.languages : []),
        navigator.language,
    ];
    return candidates.map(matchDiscoverLocale).find((locale): locale is DiscoverLocale => !!locale) || 'en';
};

export type DiscoverTranslateVars = Record<string, string | number>;

export type DiscoverTranslate = (
    key: string,
    vars?: DiscoverTranslateVars,
) => string;
