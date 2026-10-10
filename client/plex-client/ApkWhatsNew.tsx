import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Sparkles } from 'lucide-react';
import { useDiscoverI18n } from '../media-player/host';
import { readApkWhatsNewSeen, writeApkWhatsNewSeen } from '../media-player/playerMemory';
import { getPlexClientAppVersion } from './config';

const NOTES_BY_VERSION: Record<string, { title: string; items: string[] }[]> = {
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
