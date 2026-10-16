/**
 * Mirror portal URL + session JWT to Capacitor Preferences so auth survives
 * WebView localStorage quirks and app updates (Android).
 */
import { withBootTimeout } from './bootTimeout';
import { STORAGE_AUTH_MODE, STORAGE_PLEX_CLIENT_ID, STORAGE_PLEX_HOME_USER, STORAGE_PLEX_OWNER_TOKEN, STORAGE_PLEX_SERVER, STORAGE_PLEX_SERVERS, STORAGE_PORTAL, STORAGE_TOKEN } from './configStorageKeys';

const AUTH_KEYS = [STORAGE_TOKEN, STORAGE_PORTAL, STORAGE_AUTH_MODE, STORAGE_PLEX_SERVER, STORAGE_PLEX_SERVERS, STORAGE_PLEX_CLIENT_ID, STORAGE_PLEX_OWNER_TOKEN, STORAGE_PLEX_HOME_USER] as const;

const preferencesApi = async () => {
    const { Capacitor } = await import('@capacitor/core');
    if (!Capacitor.isNativePlatform()) return null;
    const { Preferences } = await import('@capacitor/preferences');
    return Preferences;
};

export const mirrorAuthToNativeStorage = async (key: string, value: string) => {
    try {
        const Preferences = await withBootTimeout(preferencesApi(), 1500);
        if (!Preferences) return;
        const op = value ? Preferences.set({ key, value }) : Preferences.remove({ key });
        await withBootTimeout(op, 1500);
    } catch {
        /* ignore */
    }
};

/** Restore localStorage from native prefs when WebView storage was cleared on update. */
export const hydratePlexClientAuthStorage = async () => {
    if (typeof window === 'undefined') return;
    try {
        const Preferences = await preferencesApi();
        if (!Preferences) return;
        for (const key of AUTH_KEYS) {
            let local = '';
            try {
                local = String(window.localStorage.getItem(key) || '').trim();
            } catch {
                local = '';
            }
            if (local) {
                await Preferences.set({ key, value: local });
                continue;
            }
            const { value } = await Preferences.get({ key });
            const native = String(value || '').trim();
            if (native) {
                try {
                    window.localStorage.setItem(key, native);
                } catch {
                    /* ignore */
                }
            }
        }
    } catch {
        /* ignore */
    }
};
