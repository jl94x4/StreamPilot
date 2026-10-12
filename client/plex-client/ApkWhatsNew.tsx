import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Sparkles } from 'lucide-react';
import { useDiscoverI18n } from '../media-player/host';
import { readApkWhatsNewSeen, writeApkWhatsNewSeen } from '../media-player/playerMemory';
import { getPlexClientAppVersion } from './config';

const NOTES_BY_VERSION: Record<string, { title: string; items: string[] }[]> = {
    '1.0.119': [
        {
            title: 'Playback',
            items: [
                'Seek on unseekable Direct Play always remuxes to HLS (fixes play dying after scrub / resume)',
                'Bitstream audio (TrueHD/DTS) Direct Play is opt-in — avoids MediaCodec crashes on TVs without passthrough',
            ],
        },
    ],
    '1.0.118': [
        {
            title: 'Playback',
            items: [
                'Fix hard crash when opening play with burn-in / non–Direct Play AV prefs (defer prepare until stream rebuild)',
                'Safer stream swaps: stop ExoPlayer before replacing media; keep DP→HLS fallback stage across native retries',
            ],
        },
    ],
    '1.0.117': [
        {
            title: 'Details',
            items: [
                'Episode row no longer scrolls E1 under the left clip — full card + ring visible',
            ],
        },
    ],
    '1.0.116': [
        {
            title: 'Details',
            items: [
                'Episode zoom no longer overlaps neighbors; E1 flush with Watch and clear of the Watch button',
            ],
        },
    ],
    '1.0.115': [
        {
            title: 'Details',
            items: [
                'First episode card stays level with Watch (left-origin zoom + ring pad; no previous-card peek)',
            ],
        },
    ],
    '1.0.114': [
        {
            title: 'Details',
            items: [
                'Selected episode cards zoom again (center scale + orange ring; gutter peek still fixed)',
            ],
        },
    ],
    '1.0.113': [
        {
            title: 'Details',
            items: [
                'Episode focus ring visible again (inset ring was hidden under the artwork)',
            ],
        },
    ],
    '1.0.112': [
        {
            title: 'Details',
            items: [
                'Episode row no longer inherits the home poster gutter — previous cards stay off-screen when you scroll',
            ],
        },
    ],
    '1.0.111': [
        {
            title: 'Details',
            items: [
                'Episode focus no longer scales (no overlapping neighbors) and previous cards cannot peek',
            ],
        },
    ],
    '1.0.110': [
        {
            title: 'Details',
            items: [
                'Episode row flush fix actually sticks (APK styles no longer leave a previous-card peek)',
            ],
        },
    ],
    '1.0.109': [
        {
            title: 'Details',
            items: [
                'Removed the native New Episode tag on episode cards',
                'Episode row no longer peeks the previous card when you step left or right',
            ],
        },
    ],
    '1.0.108': [
        {
            title: 'Details',
            items: [
                'Episode row no longer peeks the previous card when you step left or right',
            ],
        },
    ],
    '1.0.107': [
        {
            title: 'Playback',
            items: [
                'Direct Play rules match between portal and the app (codec, subs, passthrough)',
                'Quality / seek rebuilds are steadier; failed streams step DP → HLS → 1080p',
                'Image subtitles show a Burning… overlay with Cancel while Plex burns them in',
            ],
        },
        {
            title: 'Phone',
            items: [
                'Larger transport and quality chips on phone; settings and long-press menus are easier to tap',
            ],
        },
    ],
    '1.0.106': [
        {
            title: 'Libraries',
            items: [
                'Library Recommended loads much faster after the first open — collection labels are cached instead of re-fetched every time',
            ],
        },
    ],
    '1.0.105': [
        {
            title: 'Home',
            items: [
                'Kometa and ColleXions labels are ignored for home-row merging (use a themed label like Halloween to merge)',
            ],
        },
    ],
    '1.0.104': [
        {
            title: 'Home',
            items: [
                'Pinned collections that share the same Plex Label merge into one home row titled with that label',
            ],
        },
    ],
    '1.0.103': [
        {
            title: 'Home',
            items: [
                'View More poster shelf fills the whole tile and only uses titles that are not already on that row',
            ],
        },
    ],
    '1.0.102': [
        {
            title: 'Home',
            items: [
                'View More tiles show a faded poster shelf from that row behind the button',
            ],
        },
    ],
    '1.0.101': [
        {
            title: 'Home',
            items: [
                'Every home row ends with a View More tile — Recently Added opens months of titles, other rows open the full collection',
            ],
        },
    ],
    '1.0.100': [
        {
            title: 'Playback',
            items: [
                'Switching Original ↔ 720p after a rewind no longer sticks on the transcode',
                'Quality changes reuse one Now Playing session instead of spawning ghosts',
                'Direct and burned-in subtitles no longer stack while the stream switches',
            ],
        },
    ],
    '1.0.99': [
        {
            title: 'Home',
            items: [
                'Focused-title description is no longer cut off mid-line',
            ],
        },
    ],
    '1.0.98': [
        {
            title: 'TV',
            items: [
                'Opening an episode from Continue Watching focuses it with the orange ring again',
            ],
        },
    ],
    '1.0.97': [
        {
            title: 'TV',
            items: [
                'Episode Left/Right is snappier — especially when holding or tapping quickly',
            ],
        },
    ],
    '1.0.96': [
        {
            title: 'TV',
            items: [
                'Holding Left/Right on episode cards no longer bounces between two episodes',
            ],
        },
    ],
    '1.0.95': [
        {
            title: 'TV',
            items: [
                'Audio / subtitle picker focus ring is no longer clipped at the edges',
            ],
        },
    ],
    '1.0.94': [
        {
            title: 'TV',
            items: [
                'Back works again — one press no longer opens then instantly closes the side menu',
                'Library Back reaches the tab row on Recommended, then Home on the next press',
            ],
        },
    ],
    '1.0.93': [
        {
            title: 'Home',
            items: [
                'Row title fade is smoother — no more bounce before the swap',
            ],
        },
    ],
    '1.0.92': [
        {
            title: 'TV',
            items: [
                'Clock hides while the item options sheet is open',
            ],
        },
    ],
    '1.0.91': [
        {
            title: 'Home',
            items: [
                'Row-to-row title fade no longer gets cancelled when focus lands on the new row',
            ],
        },
    ],
    '1.0.90': [
        {
            title: 'Library',
            items: [
                'Recommended clearlogo and synopsis sit back in their usual spot above the poster row',
            ],
        },
    ],
    '1.0.89': [
        {
            title: 'Playback',
            items: [
                'Seeking while transcoding clears the old session (timeline + transcoder) before starting the next — fewer ghost Now Playing rows',
            ],
        },
    ],
    '1.0.88': [
        {
            title: 'Playback',
            items: [
                'Seeking while transcoding no longer spawns a pile of ghost Now Playing sessions',
            ],
        },
    ],
    '1.0.87': [
        {
            title: 'Episodes',
            items: [
                'Episode hub feels closer to Plex: focused cards scale up, the rail eases between titles, and episode art / title / summary crossfade with focus',
            ],
        },
    ],
    '1.0.86': [
        {
            title: 'Details',
            items: [
                'Start from beginning uses the same pill shape as Resume',
            ],
        },
    ],
    '1.0.85': [
        {
            title: 'Details',
            items: [
                'Down from an episode card goes to Resume instead of jumping back to the first episode',
            ],
        },
    ],
    '1.0.84': [
        {
            title: 'Details',
            items: [
                'Select Audio / Subtitles / Version dialogs no longer show page text bleeding through',
            ],
        },
    ],
    '1.0.83': [
        {
            title: 'Playback',
            items: [
                'Text subtitles (SRT/ASS) Direct Play again instead of burning a transcode — seeking stays smooth',
                'Image subtitles (PGS/VobSub) still burn-in when selected',
            ],
        },
    ],
    '1.0.82': [
        {
            title: 'Home',
            items: [
                'Title block only fades on up/down row changes — left/right focus swaps instantly',
            ],
        },
    ],
    '1.0.81': [
        {
            title: 'Home',
            items: [
                'Smoother title-block fade when changing Home rows (less overlap / stutter)',
            ],
        },
    ],
    '1.0.80': [
        {
            title: 'Home',
            items: [
                'Title block drifts off the top of the screen more slowly when you change Home rows',
            ],
        },
    ],
    '1.0.79': [
        {
            title: 'Home',
            items: [
                'Title block now travels fully off the top of the screen when you move to the next row',
            ],
        },
    ],
    '1.0.78': [
        {
            title: 'Home',
            items: [
                'Title block fades up like Plex when you move to the next Home row',
            ],
        },
    ],
    '1.0.77': [
        {
            title: 'Home',
            items: [
                'Loading skeleton matches the Home stage (backdrop, title block, rails) and shimmers while waiting',
            ],
        },
    ],
    '1.0.76': [
        {
            title: 'Playback',
            items: [
                'Fixed Unable to start player caused by missing PiP / Chapters button wiring',
            ],
        },
    ],
    '1.0.75': [
        {
            title: 'Playback',
            items: [
                'Direct Play failures on TV fall back to Plex HLS instead of showing Playback failed',
            ],
        },
    ],
    '1.0.74': [
        {
            title: 'Libraries',
            items: [
                'Recommended shows a simple spinner while loading instead of poster skeletons',
            ],
        },
    ],
    '1.0.73': [
        {
            title: 'Browse',
            items: [
                'Filter focus rings no longer clip on the dropdown chips',
            ],
        },
    ],
    '1.0.72': [
        {
            title: 'Browse',
            items: [
                'Filters closer to Plex: actor, director, writer, producer, label, network, HDR, and duplicates',
                'Filter dropdowns and toggles match the Recommended / Browse / Collections pill shape',
            ],
        },
    ],
    '1.0.71': [
        {
            title: 'Libraries',
            items: [
                'Recommended shows a poster-row loading hint instead of a blank stage',
            ],
        },
    ],
    '1.0.70': [
        {
            title: 'Navigation',
            items: [
                'Sidebar icons line up in one vertical column across Home, Libraries, Settings, and Switch User',
            ],
        },
    ],
    '1.0.69': [
        {
            title: 'Browse',
            items: [
                'Filters match Plex: decade, year, rating, resolution, studio/network, country, collection, audio & subtitle language',
                'More sort options: title Z–A, critic rating, duration, resolution',
                'Clock is hidden on Browse so it stays out of the way of the A–Z bar',
            ],
        },
    ],
    '1.0.68': [
        {
            title: 'Plex Home',
            items: [
                'Switch User PIN keypad fits fully on TV — 0, Del, and OK are no longer cut off',
            ],
        },
    ],
    '1.0.67': [
        {
            title: 'Branding',
            items: [
                'New StreamPilot speed logo across the app, splash, and launcher icons',
                'Loading screen drops the orange glow and whooshes the logo into center',
            ],
        },
    ],
    '1.0.66': [
        {
            title: 'Plex Home',
            items: [
                'Switch User lists every Home profile with the correct name and avatar (not the Home title)',
            ],
        },
    ],
    '1.0.65': [
        {
            title: 'Browse',
            items: [
                'A–Z jumps into the full title list at that letter, with previous letters above and next letters below',
            ],
        },
    ],
    '1.0.64': [
        {
            title: 'Libraries',
            items: [
                'Back from a library row focuses Recommended/Browse/Collections; Back again returns Home',
            ],
        },
    ],
    '1.0.63': [
        {
            title: 'Libraries',
            items: [
                'Down moves focus to the next Recommended row in one press',
                'Recommended / Browse / Collections pills match the clock shape',
            ],
        },
    ],
    '1.0.62': [
        {
            title: 'Libraries',
            items: [
                'Heros / Heroes collection labels render as widescreen rows on Library Recommended (same as Home)',
            ],
        },
    ],
    '1.0.61': [
        {
            title: 'UI',
            items: [
                'Watched shows as an orange pill on Home/Library stage',
                'Recommended / Browse / Collections tabs match the clock pill shape',
            ],
        },
    ],
    '1.0.60': [
        {
            title: 'Libraries',
            items: [
                'Down between Recommended rows keeps the focus ring on the next row (no blank beat)',
            ],
        },
    ],
    '1.0.59': [
        {
            title: 'Libraries',
            items: [
                'Down from Recommended/Browse/Collections moves focus onto the poster row again',
            ],
        },
    ],
    '1.0.58': [
        {
            title: 'UI',
            items: [
                'Clock pill background is more see-through',
            ],
        },
    ],
    '1.0.57': [
        {
            title: 'Home',
            items: [
                'Hold Select tip goes away for good after you leave Home (no need to find Got it)',
            ],
        },
    ],
    '1.0.56': [
        {
            title: 'Libraries',
            items: [
                'Recommended no longer flashes “empty” while hubs load',
                'Library Recommended uses the same TV stage layout as Home (backdrop, one active row, next-row peek)',
            ],
        },
    ],
    '1.0.55': [
        {
            title: 'Fixes',
            items: [
                'What’s New Continue button takes remote focus so you can dismiss it',
            ],
        },
    ],
    '1.0.54': [
        {
            title: 'Playback',
            items: [
                'Leaving playback (Back or finished) returns to the movie/episode overview instead of a blank black Home pause',
                'Autoplay still chains to the next episode without flashing Home',
            ],
        },
    ],
    '1.0.53': [
        {
            title: 'Browse',
            items: [
                'Focus returns to the same poster after you leave a title or finish playback',
                'Home warms sooner from cache so cold starts feel faster',
                'Empty rows no longer show View All',
            ],
        },
        {
            title: 'Playback',
            items: [
                'Still watching prompt is adjustable in Settings',
                'Back dismisses Up Next so you can watch credits',
                'Audio track picker works from the native player OSD',
                'Remembered file/version choice per title',
            ],
        },
        {
            title: 'Menus',
            items: [
                'Hold Select tip on Home (once)',
                'Mark season watched from an episode menu',
                'Go to show / season pinned higher for episodes',
            ],
        },
    ],
};

export const ApkWhatsNew: React.FC = () => {
    const { t } = useDiscoverI18n();
    const version = useMemo(() => getPlexClientAppVersion() || '', []);
    const [open, setOpen] = useState(false);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const sections = NOTES_BY_VERSION[version] || [];

    useEffect(() => {
        if (!version || !sections.length) return;
        if (readApkWhatsNewSeen() === version) return;
        setOpen(true);
    }, [sections.length, version]);

    useEffect(() => {
        if (!open) return undefined;
        const focusContinue = () => {
            const btn = buttonRef.current
                || document.querySelector<HTMLElement>('[data-tv-whats-new-primary="1"]');
            if (!btn) return false;
            try {
                btn.focus({ preventScroll: true });
            } catch {
                btn.focus();
            }
            return document.activeElement === btn;
        };
        focusContinue();
        let attempts = 24;
        const timer = window.setInterval(() => {
            if (focusContinue() || attempts-- <= 0) window.clearInterval(timer);
        }, 40);
        const onFocusIn = (event: FocusEvent) => {
            const target = event.target as HTMLElement | null;
            if (target?.closest?.('[data-tv-whats-new="1"]')) return;
            focusContinue();
        };
        document.addEventListener('focusin', onFocusIn, true);
        return () => {
            window.clearInterval(timer);
            document.removeEventListener('focusin', onFocusIn, true);
        };
    }, [open]);

    if (!open || !sections.length) return null;

    const dismiss = () => {
        writeApkWhatsNewSeen(version);
        setOpen(false);
    };

    const modal = (
        <div
            className="fixed inset-0 z-[4200] flex items-center justify-center bg-black/70 p-6"
            role="dialog"
            aria-modal="true"
            aria-labelledby="apk-whats-new-title"
            data-tv-whats-new="1"
            data-tv-rail="1"
        >
            <div
                className="absolute inset-0"
                aria-hidden
                onClick={dismiss}
            />
            <div className="player-popup-surface relative z-10 w-full max-w-xl overflow-hidden rounded-3xl border border-white/10 p-7 shadow-[0_28px_90px_rgba(0,0,0,0.55)]">
                <div className="mb-5 flex items-center gap-2 text-plex">
                    <Sparkles className="h-5 w-5 shrink-0" />
                    <span className="text-xs font-bold uppercase tracking-[0.2em]">
                        {t('mediaPlayerPage.apkWhatsNewTitle')}
                    </span>
                </div>
                <h2 id="apk-whats-new-title" className="text-2xl font-black tracking-tight text-white">
                    {version}
                </h2>
                <div className="mt-5 max-h-[50vh] space-y-5 overflow-y-auto pr-1">
                    {sections.map((section) => (
                        <div key={section.title}>
                            <h3 className="text-xs font-bold uppercase tracking-[0.18em] text-plex">
                                {section.title}
                            </h3>
                            <ul className="mt-2 space-y-2">
                                {section.items.map((item) => (
                                    <li key={item} className="relative pl-4 text-sm leading-relaxed text-white/85">
                                        <span className="absolute left-0 text-plex" aria-hidden>•</span>
                                        {item}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </div>
                <button
                    ref={buttonRef}
                    type="button"
                    data-tv-item="1"
                    data-tv-action="1"
                    data-tv-whats-new-primary="1"
                    onClick={dismiss}
                    className="mt-6 flex w-full min-h-[3.25rem] items-center justify-center rounded-2xl bg-plex px-5 py-3.5 text-base font-bold text-white outline-none"
                >
                    {t('mediaPlayerPage.apkWhatsNewContinue')}
                </button>
            </div>
        </div>
    );

    if (typeof document === 'undefined') return modal;
    return createPortal(modal, document.body);
};
