import {
    PLAYER_SETTINGS_DRAFT_EVENT,
    PLAYER_SETTINGS_EVENT,
    readPlayerSettings,
    type PlayerAccentColor,
    type PlayerFocusRingWidth,
    type PlayerPosterCorners,
    type PlayerSettings,
    type PlayerTextSize,
} from './playerSettings';

type Rgb = [number, number, number];

/**
 * Accent palette. `rgb` / `hover` feed the app's --color-plex variables; `tv` / `tvSoft` the
 * TV focus rings and highlights (--tv-accent); `native` is the native player's accent.
 * Gold keeps today's exact colours. Progress bars never use any of these.
 */
export const PLAYER_ACCENT_PALETTE: Record<PlayerAccentColor, { rgb: Rgb; hover: Rgb; tv?: Rgb; tvSoft?: Rgb; native: string }> = {
    gold: { rgb: [229, 160, 13], hover: [240, 168, 16], tv: [245, 158, 11], tvSoft: [251, 191, 36], native: '#F59E0B' },
    orange: { rgb: [249, 115, 22], hover: [251, 146, 60], native: '#F97316' },
    red: { rgb: [239, 68, 68], hover: [248, 113, 113], native: '#EF4444' },
    pink: { rgb: [236, 72, 153], hover: [244, 114, 182], native: '#EC4899' },
    purple: { rgb: [168, 85, 247], hover: [192, 132, 252], native: '#A855F7' },
    blue: { rgb: [59, 130, 246], hover: [96, 165, 250], native: '#3B82F6' },
    teal: { rgb: [20, 184, 166], hover: [45, 212, 191], native: '#14B8A6' },
    green: { rgb: [34, 197, 94], hover: [74, 222, 128], native: '#22C55E' },
    white: { rgb: [245, 245, 245], hover: [255, 255, 255], native: '#F5F5F5' },
};

export const playerAccentCss = (accent: PlayerAccentColor) => {
    const [r, g, b] = (PLAYER_ACCENT_PALETTE[accent] || PLAYER_ACCENT_PALETTE.gold).rgb;
    return `rgb(${r}, ${g}, ${b})`;
};

let appliedAccent = '';
let appliedRingWidth = '';

const RING_WIDTH: Record<PlayerFocusRingWidth, string> = { thin: '1.5px', normal: '2px', thick: '3.5px' };

/** Focus ring thickness: one variable read by every TV focus ring. */
export const applyFocusRingWidth = (width: PlayerFocusRingWidth) => {
    if (typeof document === 'undefined' || width === appliedRingWidth) return;
    appliedRingWidth = width;
    document.documentElement.style.setProperty('--tv-focus-width', RING_WIDTH[width] || '2px');
};

/**
 * Colour the TV focus rings (posters, episodes, settings rows) and nothing else: buttons,
 * tabs, badges, progress bars and the player keep the app's own gold.
 */
export const applyPlayerAccent = (accent: PlayerAccentColor) => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    const phone = root.dataset.phone === '1' && root.dataset.tv !== '1';
    const key = `${accent}:${phone ? 'phone' : 'other'}`;
    if (key === appliedAccent) return;
    appliedAccent = key;
    const entry = PLAYER_ACCENT_PALETTE[accent] || PLAYER_ACCENT_PALETTE.gold;
    root.style.setProperty('--tv-focus-accent', (entry.tv || entry.rgb).join(' '));
    root.style.setProperty('--tv-focus-accent-soft', (entry.tvSoft || entry.hover).join(' '));
    root.dataset.accent = accent;
    // Phone has no focus rings: its tabs, switches and highlights use the app colour itself.
    if (phone) {
        root.style.setProperty('--color-plex', entry.rgb.join(' '));
        root.style.setProperty('--color-plex-hover', entry.hover.join(' '));
    }
};

const POSTER_RADIUS: Record<PlayerPosterCorners, string> = { square: '0px', slight: '3px', rounded: '6px' };
/** The phone's posters were always 12px; "Rounded" keeps that, the others step down from it. */
const PHONE_POSTER_RADIUS: Record<PlayerPosterCorners, string> = { square: '0px', slight: '5px', rounded: '12px' };
const TEXT_SCALE: Record<PlayerTextSize, number> = { small: 0.9, medium: 1, large: 1.15 };
/** index.html sets the TV root to this before any script; text size scales from it. */
const TV_ROOT_FONT_PX = 20;
/** The phone root is the browser default. */
const PHONE_ROOT_FONT_PX = 16;

let appliedLook = '';

/**
 * Poster corners and text size. Both are CSS variables, so the web portal (which never
 * sets them) keeps its defaults. Poster widths divide by the text scale, so bigger text
 * does not also mean bigger posters (that is the poster size setting).
 */
export const applyPlayerLook = (corners: PlayerPosterCorners, textSize: PlayerTextSize) => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    const phone = root.dataset.phone === '1' && root.dataset.tv !== '1';
    const key = `${corners}:${textSize}:${phone ? 'phone' : 'other'}`;
    if (key === appliedLook) return;
    appliedLook = key;
    const scale = TEXT_SCALE[textSize] || 1;
    root.style.setProperty('--tv-poster-radius', POSTER_RADIUS[corners] || '6px');
    root.style.setProperty('--phone-poster-radius', PHONE_POSTER_RADIUS[corners] || '12px');
    root.style.setProperty('--tv-text-scale', String(scale));
    if (root.dataset.tv === '1') root.style.fontSize = `${TV_ROOT_FONT_PX * scale}px`;
    // Phone: text size scales the whole page (everything is in rem), like the TV does.
    else if (phone) root.style.fontSize = scale === 1 ? '' : `${PHONE_ROOT_FONT_PX * scale}px`;
};

const applyAll = (settings: Pick<PlayerSettings, 'accentColor' | 'focusRingWidth' | 'posterCorners' | 'textSize'>) => {
    applyPlayerAccent(settings.accentColor);
    applyFocusRingWidth(settings.focusRingWidth);
    applyPlayerLook(settings.posterCorners, settings.textSize);
};

/**
 * TV / phone app only: follow the saved look from boot. Settings drafts preview live;
 * a save or discard publishes again, so an unsaved pick does not stick.
 */
export const installPlayerAppearance = () => {
    if (typeof window === 'undefined') return;
    const sync = () => applyAll(readPlayerSettings());
    sync();
    // The phone is marked a moment after boot: apply again once it is, so the saved look shows.
    window.addEventListener('DOMContentLoaded', sync);
    window.setTimeout(sync, 800);
    window.addEventListener(PLAYER_SETTINGS_EVENT, sync);
    window.addEventListener('storage', sync);
    window.addEventListener(PLAYER_SETTINGS_DRAFT_EVENT, (event) => {
        const draft = (event as CustomEvent<PlayerSettings>).detail;
        if (draft?.accentColor) applyAll(draft);
    });
};
