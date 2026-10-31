import {
    PLAYER_SETTINGS_DRAFT_EVENT,
    PLAYER_SETTINGS_EVENT,
    readPlayerSettings,
    type PlayerAccentColor,
    type PlayerSettings,
} from './playerSettings';

type Rgb = [number, number, number];

/**
 * Accent palette. `rgb` / `hover` feed the app's --color-plex variables; `native` is the
 * native player's accent (gold keeps the player's existing amber).
 */
export const PLAYER_ACCENT_PALETTE: Record<PlayerAccentColor, { rgb: Rgb; hover: Rgb; native: string }> = {
    gold: { rgb: [229, 160, 13], hover: [240, 168, 16], native: '#F59E0B' },
    orange: { rgb: [249, 115, 22], hover: [251, 146, 60], native: '#F97316' },
    red: { rgb: [239, 68, 68], hover: [248, 113, 113], native: '#EF4444' },
    pink: { rgb: [236, 72, 153], hover: [244, 114, 182], native: '#EC4899' },
    purple: { rgb: [168, 85, 247], hover: [192, 132, 252], native: '#A855F7' },
    blue: { rgb: [59, 130, 246], hover: [96, 165, 250], native: '#3B82F6' },
    teal: { rgb: [20, 184, 166], hover: [45, 212, 191], native: '#14B8A6' },
    green: { rgb: [34, 197, 94], hover: [74, 222, 128], native: '#22C55E' },
};

export const playerAccentCss = (accent: PlayerAccentColor) => {
    const [r, g, b] = (PLAYER_ACCENT_PALETTE[accent] || PLAYER_ACCENT_PALETTE.gold).rgb;
    return `rgb(${r}, ${g}, ${b})`;
};

let appliedAccent = '';

/** Point the app's accent variables at this colour (one style write, no re-render). */
export const applyPlayerAccent = (accent: PlayerAccentColor) => {
    if (typeof document === 'undefined' || accent === appliedAccent) return;
    appliedAccent = accent;
    const entry = PLAYER_ACCENT_PALETTE[accent] || PLAYER_ACCENT_PALETTE.gold;
    const root = document.documentElement;
    root.style.setProperty('--color-plex', entry.rgb.join(' '));
    root.style.setProperty('--color-plex-hover', entry.hover.join(' '));
    root.dataset.accent = accent;
};

/**
 * TV / phone app only: follow the saved accent from boot. Settings drafts preview live;
 * a save or discard publishes again, so an unsaved pick does not stick.
 */
export const installPlayerAppearance = () => {
    if (typeof window === 'undefined') return;
    const sync = () => applyPlayerAccent(readPlayerSettings().accentColor);
    sync();
    window.addEventListener(PLAYER_SETTINGS_EVENT, sync);
    window.addEventListener('storage', sync);
    window.addEventListener(PLAYER_SETTINGS_DRAFT_EVENT, (event) => {
        const draft = (event as CustomEvent<PlayerSettings>).detail;
        if (draft?.accentColor) applyPlayerAccent(draft.accentColor);
    });
};
