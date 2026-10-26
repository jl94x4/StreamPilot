export const PLAYER_APP_BASE = '/media-player';
export const PLAYER_API_ROOT = '/api/media-player';
export const PLAYER_IMAGE_PATH = '/api/plex/image';
export const PLAYER_NAVIGATE_EVENT = 'portal-media-player-navigate';
export const PLAYER_EXIT_EVENT = 'portal-media-player-exit';
export const PLAYER_LOGOUT_EVENT = 'portal-media-player-logout';
export const PLAYER_SCROLL_ID = 'media-player-scroll';
/** Plex pushed a library / watch change (direct app): Home refetches its rows. */
export const PLAYER_HOME_LIVE_EVENT = 'portal-media-player-home-live';
/** Capacitor TV: open/close the left rail (detail: { action: 'open' | 'close' }). */
export const PLAYER_TV_NAV_EVENT = 'portal-media-player-tv-nav';
/** TV Home painted its rows: land the focus ring if nothing has it yet (first open). */
export const PLAYER_TV_HOME_READY_EVENT = 'portal-media-player-tv-home-ready';

export const exitToPortal = () => {
    if (typeof window === 'undefined') return;
    // Capacitor app has no portal chrome to return to.
    if (window.__PLEX_CLIENT__) {
        try {
            window.history.replaceState({}, '', PLAYER_APP_BASE);
            window.dispatchEvent(new Event(PLAYER_NAVIGATE_EVENT));
        } catch {
            /* ignore */
        }
        return;
    }
    window.dispatchEvent(new Event(PLAYER_EXIT_EVENT));
};

/** Sign out of the Capacitor player and return to the portal connect / Plex PIN screen. */
export const logoutMediaPlayer = () => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new Event(PLAYER_LOGOUT_EVENT));
};

/** TV: Up from the Watch row / Back / OK while a details page's background trailer plays. */
export const TRAILER_EXPAND_EVENT = 'smp-trailer-expand';
export const TRAILER_COLLAPSE_EVENT = 'smp-trailer-collapse';
export const TRAILER_TOGGLE_EVENT = 'smp-trailer-toggle';
