import {
    PLAYER_SETTINGS_DRAFT_EVENT,
    PLAYER_SETTINGS_EVENT,
    readPlayerSettings,
    type PlayerNavigationSound,
    type PlayerSettings,
} from './playerSettings';

/**
 * Remote navigation sounds, synthesised with Web Audio (no audio files to load).
 * Each sound is one or two short oscillators, so a key press costs well under a frame.
 */

export type NavSoundKind = 'move' | 'select' | 'back';

type Tone = {
    wave: OscillatorType;
    /** Start and end pitch (Hz); a drop gives a "pop". */
    from: number;
    to?: number;
    ms: number;
    gain: number;
    /** Seconds after the first tone (for two-note chimes). */
    delay?: number;
};

const SOUNDS: Record<Exclude<PlayerNavigationSound, 'off'>, Record<NavSoundKind, Tone[]>> = {
    soft: {
        move: [{ wave: 'sine', from: 720, ms: 38, gain: 0.05 }],
        select: [{ wave: 'sine', from: 880, to: 990, ms: 70, gain: 0.07 }],
        back: [{ wave: 'sine', from: 600, to: 480, ms: 70, gain: 0.06 }],
    },
    click: {
        move: [{ wave: 'triangle', from: 2400, ms: 12, gain: 0.07 }],
        select: [{ wave: 'triangle', from: 1800, ms: 22, gain: 0.09 }],
        back: [{ wave: 'triangle', from: 1200, ms: 22, gain: 0.08 }],
    },
    pop: {
        move: [{ wave: 'sine', from: 900, to: 320, ms: 45, gain: 0.08 }],
        select: [{ wave: 'sine', from: 1200, to: 420, ms: 70, gain: 0.1 }],
        back: [{ wave: 'sine', from: 520, to: 220, ms: 70, gain: 0.09 }],
    },
    chime: {
        move: [{ wave: 'sine', from: 1319, ms: 90, gain: 0.035 }],
        select: [
            { wave: 'sine', from: 784, ms: 180, gain: 0.05 },
            { wave: 'sine', from: 1175, ms: 220, gain: 0.045, delay: 0.07 },
        ],
        back: [
            { wave: 'sine', from: 1175, ms: 160, gain: 0.045 },
            { wave: 'sine', from: 784, ms: 200, gain: 0.04, delay: 0.07 },
        ],
    },
    retro: {
        move: [{ wave: 'square', from: 660, ms: 30, gain: 0.025 }],
        select: [
            { wave: 'square', from: 523, ms: 45, gain: 0.03 },
            { wave: 'square', from: 784, ms: 60, gain: 0.03, delay: 0.045 },
        ],
        back: [
            { wave: 'square', from: 784, ms: 45, gain: 0.03 },
            { wave: 'square', from: 392, ms: 60, gain: 0.03, delay: 0.045 },
        ],
    },
};

let style: PlayerNavigationSound = 'off';
let audio: AudioContext | null = null;
let lastMoveAt = 0;

const context = (): AudioContext | null => {
    if (audio) return audio;
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    try {
        audio = new Ctor();
    } catch {
        audio = null;
    }
    return audio;
};

const playTones = (tones: Tone[]) => {
    const ctx = context();
    if (!ctx) return;
    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
    const now = ctx.currentTime;
    for (const tone of tones) {
        const start = now + (tone.delay || 0);
        const end = start + tone.ms / 1000;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = tone.wave;
        osc.frequency.setValueAtTime(tone.from, start);
        if (tone.to) osc.frequency.exponentialRampToValueAtTime(tone.to, end);
        // Short fade in/out so there is no click at the edges.
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(tone.gain, start + 0.004);
        gain.gain.exponentialRampToValueAtTime(0.0001, end);
        osc.connect(gain).connect(ctx.destination);
        osc.start(start);
        osc.stop(end + 0.02);
    }
};

/** Play a sound in the given style (Settings uses this to preview a choice). */
export const previewNavSound = (choice: PlayerNavigationSound, kind: NavSoundKind = 'select') => {
    if (choice === 'off') return;
    try {
        playTones(SOUNDS[choice][kind]);
    } catch {
        /* Audio is a nicety: never let it break navigation. */
    }
};

export const playNavSound = (kind: NavSoundKind) => {
    if (style === 'off') return;
    if (kind === 'move') {
        // Holding a direction repeats fast: one tick per ~45ms at most.
        const now = performance.now();
        if (now - lastMoveAt < 45) return;
        lastMoveAt = now;
    }
    previewNavSound(style, kind);
};

const ARROWS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

/**
 * TV app: tick when an arrow press actually moves focus, click on OK. Back plays from the
 * shared Back handler, since Android can deliver it outside keydown.
 */
export const installNavigationSounds = () => {
    if (typeof window === 'undefined') return;
    const sync = () => { style = readPlayerSettings().navigationSound; };
    sync();
    window.addEventListener(PLAYER_SETTINGS_EVENT, sync);
    window.addEventListener('storage', sync);
    // Hear the new style while still in Settings, before saving.
    window.addEventListener(PLAYER_SETTINGS_DRAFT_EVENT, (event) => {
        const draft = (event as CustomEvent<PlayerSettings>).detail;
        if (draft?.navigationSound) style = draft.navigationSound;
    });
    let arrowAt = 0;
    const tv = () => document.documentElement.dataset.tv === '1';
    window.addEventListener('keydown', (event) => {
        if (style === 'off' || !tv()) return;
        if (ARROWS.has(event.key)) {
            arrowAt = performance.now();
            return;
        }
        if ((event.key === 'Enter' || event.key === ' ') && !event.repeat) {
            const target = event.target as HTMLElement | null;
            if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
            playNavSound('select');
        }
    }, true);
    document.addEventListener('focusin', () => {
        if (style === 'off' || !tv()) return;
        if (performance.now() - arrowAt < 250) playNavSound('move');
    }, true);
};
