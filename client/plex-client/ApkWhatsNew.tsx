import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Sparkles } from 'lucide-react';
import { useDiscoverI18n } from '../media-player/host';
import { readApkWhatsNewSeen, writeApkWhatsNewSeen } from '../media-player/playerMemory';
import { getPlexClientAppVersion } from './config';

type WhatsNewSection = { title: string; items: string[] };
type WhatsNewRelease = { version: string; sections: WhatsNewSection[] };

const parseVersionParts = (version: string): number[] =>
    String(version || '')
        .trim()
        .replace(/^v/i, '')
        .split(/[.+-]/)
        .map((part) => Number.parseInt(part, 10) || 0);

const compareAppVersions = (a: string, b: string) => {
    const left = parseVersionParts(a);
    const right = parseVersionParts(b);
    const len = Math.max(left.length, right.length);
    for (let i = 0; i < len; i += 1) {
        const diff = (left[i] || 0) - (right[i] || 0);
        if (diff) return diff;
    }
    return 0;
};

/** True when `newer` is exactly one patch above `older` (same major.minor). */
const isPriorPatchVersion = (newer: string, older: string) => {
    const left = parseVersionParts(newer);
    const right = parseVersionParts(older);
    if (left.length < 3 || right.length < 3) return false;
    return left[0] === right[0]
        && left[1] === right[1]
        && left[2] === right[2] + 1;
};

/**
 * Up to `limit` newest note milestones at or below the running app version,
 * but only a contiguous patch run (e.g. 1.0.261 → 1.0.260 → 1.0.259).
 * Stops at the first gap so distant archives like 1.0.215 never pad the list.
 */
const recentWhatsNewReleases = (currentVersion: string, limit = 10): WhatsNewRelease[] => {
    if (!currentVersion) return [];
    const versions = Object.keys(NOTES_BY_VERSION)
        .filter((version) => compareAppVersions(version, currentVersion) <= 0)
        .sort((a, b) => compareAppVersions(b, a));
    if (!versions.length) return [];
    const run: WhatsNewRelease[] = [];
    for (let i = 0; i < versions.length && run.length < limit; i += 1) {
        const version = versions[i];
        const sections = NOTES_BY_VERSION[version] || [];
        if (!sections.length) continue;
        if (run.length > 0 && !isPriorPatchVersion(run[run.length - 1].version, version)) break;
        run.push({ version, sections });
    }
    return run;
};

/** Fingerprint of the notes shown for this app version — reappears when they change. */
const currentNotesSeenKey = (currentVersion: string): string => {
    try {
        return `notes:${JSON.stringify(recentWhatsNewReleases(currentVersion, 10))}`;
    } catch {
        return 'notes:';
    }
};

/**
 * Release notes keyed by the versionName that shipped them.
 * Keep a contiguous run of patch keys so Whats New can show the last 10.
 * When you ship new notes, add a new top key and leave the previous ones in place.
 */
const NOTES_BY_VERSION: Record<string, WhatsNewSection[]> = {
    '1.0.347': [
        {
            title: 'Movies & shows',
            items: [
                'With Trailer preview on, Trailer opens the trailer playing behind the page full screen, carrying on from where it was',
            ],
        },
    ],
    '1.0.346': [
        {
            title: 'TV',
            items: [
                'Opening a title from Home keeps the backdrop already on screen — no reload',
                "Home's billboard fade takes each title's colour (Artwork tint), so the title page opens in the same colour",
                'The backdrop stays exactly in place as the title page opens',
            ],
        },
    ],
    '1.0.345': [
        {
            title: 'Playback',
            items: [
                'ASS/SSA subtitles Direct Play again and show on screen instead of playing without subs',
                'When the next episode starts on its own, the finished one leaves Continue Watching straight away',
            ],
        },
        {
            title: 'TV',
            items: [
                'Press and hold on an episode opens its menu again',
            ],
        },
    ],
    '1.0.344': [
        {
            title: 'Movies & shows',
            items: [
                'Title pages open with the artwork and fade already in place instead of fading up from black',
                'No more second reload after a title page opens',
            ],
        },
    ],
    '1.0.343': [
        {
            title: 'TV Home',
            items: [
                'Holding a direction moves at a steady pace, and the top billboard waits until you stop instead of loading every title you pass',
                'The billboard text and artwork change with a quick, simple fade',
                'Faster row changes',
            ],
        },
    ],
    '1.0.342': [
        {
            title: 'TV Home',
            items: [
                'Smoother row changes on slower TV sticks: less is drawn and loaded while a row slides in',
            ],
        },
    ],
    '1.0.341': [
        {
            title: 'Speed',
            items: [
                'Images are cached on your device like the official Plex app: anything you\'ve seen loads instantly, even after restarting',
                'Up / down on TV Home reacts the moment you press, with less work on each move',
            ],
        },
    ],
    '1.0.340': [
        {
            title: 'TV Home',
            items: [
                'Moving up and down rows is quicker and more responsive',
                'Rows now slide in from the direction you moved instead of swapping instantly',
                'Home rows load sooner: posters are fetched for the rows near you first instead of every row at once',
            ],
        },
    ],
    '1.0.339': [
        {
            title: 'Movies & shows',
            items: [
                'Title pages load much more smoothly: posters, episode images and cast photos are fetched ahead of time and fade in instead of popping',
                'The artwork and page colour no longer jump into place after the page opens',
                'Cast rows run all the way to the edge of the screen',
            ],
        },
    ],
    '1.0.338': [
        {
            title: 'Movies & shows',
            items: [
                'Theme tunes play again on movie, show, season and episode pages (turn them off in Settings → Display → Play theme tunes)',
            ],
        },
    ],
    '1.0.337': [
        {
            title: 'Playback',
            items: [
                'New Away quality: a separate quality for when you\'re away from home or on mobile data',
                'New Auto-lower quality when buffering (off by default): steps the quality down by itself instead of asking',
            ],
        },
        {
            title: 'Shows',
            items: [
                'Hide spoilers per show from the long-press menu: unwatched episodes get a blurred image and no summary',
            ],
        },
        {
            title: 'Movies & shows',
            items: [
                'New Trailer preview (off by default): the trailer quietly plays behind the artwork after a few seconds',
            ],
        },
    ],
    '1.0.336': [
        {
            title: 'Home',
            items: [
                'Home is live: new episodes and movies slide into the rows as soon as Plex adds them, without reloading',
                'Continue Watching and watched ticks update when you stop watching on another device',
            ],
        },
        {
            title: 'TV',
            items: [
                'The screensaver hides the side menu',
                'Back, Select or any button closes the screensaver and leaves you exactly where you were',
            ],
        },
    ],
    '1.0.335': [
        {
            title: 'Playback',
            items: [
                'ASS and other in-file text subtitles show on Direct Play again, on the exact track you picked',
                'OpenSubtitles results show the file name, and picking one downloads it and plays it',
                'Subtitles use the same regular-weight font as Plex',
                'Subtitle size now goes down to 50%',
                'The airdate (or a movie\'s year) shows on its own line under the title in the player',
                'Up Next and Skip Intro / Skip Credits match the player settings style',
                'Moving to the next episode updates the details under the title',
            ],
        },
        {
            title: 'TV',
            items: [
                'Settings reorganised into Home, Playback, Audio & Subtitles, Display, Screensaver and Account',
                'New "Sign me in automatically" (Settings → Account) skips the PIN when the app opens',
                'Episode pages show the selected audio (e.g. English EAC3 5.1) and subtitles next to the file info',
                'Season tabs and the clock use a lighter, Plex-style font',
                'The long-press menu scrolls as you move down it',
                'Slightly bigger cast photos',
            ],
        },
        {
            title: 'Dates & rows',
            items: [
                'Dates use the full month, e.g. October 21, 2026',
                'New Date format setting with 9 styles, including 21st October 2026',
                'Episode cards show their airdate, and upcoming dates are orange',
                'New Row marker setting: 10 shapes before row titles, including the classic bar, or none',
            ],
        },
        {
            title: 'Sign-in',
            items: [
                'Phones sign in with one tap on Plex\'s own page, with no code to type',
                'A wrong Plex Home PIN now says so and clears the entry',
                'No more entering your PIN twice on first sign-in',
            ],
        },
        {
            title: 'Phone',
            items: [
                'Home layout fixed: the top bar no longer shows content behind it, and rows don\'t scroll up and down',
                'Rows below Continue Watching load reliably on slower connections, and the hero loads faster',
                'Pull down on Home to refresh',
            ],
        },
        {
            title: 'Speed',
            items: [
                'Seasons open faster',
            ],
        },
    ],
    '1.0.310': [
        {
            title: 'Home',
            items: [
                'Hub requests retry once on a slow server, with a longer timeout — fewer empty rows on startup',
                'Play-button icon before each row title instead of the yellow bar',
                'Play icon pulses while skeleton rows are loading',
            ],
        },
        {
            title: 'Libraries',
            items: [
                'Skeleton poster rows while the library home loads, instead of a spinning circle',
            ],
        },
    ],
    '1.0.298': [
        {
            title: 'Home (TV)',
            items: [
                'A collection labeled Hero or Heroes shows as a 16:9 row',
            ],
        },
    ],
    '1.0.297': [
        {
            title: 'Home (TV)',
            items: [
                'Back from a title highlights the show or movie you just opened',
            ],
        },
    ],
    '1.0.296': [
        {
            title: 'Home (TV)',
            items: [
                'Heros and Heroes rows use the Plex 16:9 cover, not the backdrop',
            ],
        },
    ],
    '1.0.295': [
        {
            title: 'Home (TV)',
            items: [
                'Home and library backdrops move up so the subject sits closer to the top',
            ],
        },
    ],
    '1.0.294': [
        {
            title: 'Home (TV)',
            items: [
                'Home and library backdrops sit higher in the frame',
            ],
        },
    ],
    '1.0.293': [
        {
            title: 'Home (TV)',
            items: [
                'Rows labeled Heros or Heroes use the Plex 16:9 hero poster instead of the backdrop',
            ],
        },
    ],
    '1.0.292': [
        {
            title: 'Home (TV)',
            items: [
                'Recently Added TV rows fill with the other shows in that library after a bulk add',
            ],
        },
    ],
    '1.0.291': [
        {
            title: 'Home (TV)',
            items: [
                'Bulk-adding a show no longer leaves Recently Added as a single poster. The rest of that library stays on the row',
            ],
        },
    ],
    '1.0.290': [
        {
            title: 'Home (TV)',
            items: [
                'Recently Added rows keep the rest of the library when one show was added in a big batch',
            ],
        },
    ],
    '1.0.289': [
        {
            title: 'Home (TV)',
            items: [
                'Title logos, details, and the description sit higher so they clear the row name',
            ],
        },
    ],
    '1.0.288': [
        {
            title: 'Home (TV)',
            items: [
                'The row name sits above its posters again',
                'Moving between rows keeps the focus ring with the row',
                'Recently Added stays as one row per library, with your Plex pins, from the first paint',
                'Settings can switch the corner clock between 24-hour and 12-hour',
            ],
        },
    ],
    '1.0.287': [
        {
            title: 'Home (TV)',
            items: [
                'The row name sits under the title logo and description, with a clear gap',
            ],
        },
    ],
    '1.0.286': [
        {
            title: 'Home (TV)',
            items: [
                'Title logos and description sit higher so they stay clear of the row name',
            ],
        },
    ],
    '1.0.285': [
        {
            title: 'Home (TV)',
            items: [
                'Title details sit above the row name instead of overlapping it',
            ],
        },
    ],
    '1.0.284': [
        {
            title: 'Home (TV)',
            items: [
                'Title logos, details, and the backdrop sit a little higher so they no longer cover the row name',
            ],
        },
    ],
    '1.0.283': [
        {
            title: 'Home (TV)',
            items: [
                'Home posters stay on every row. They are already there when you move, with no blank cards and no pop-in',
            ],
        },
    ],
    '1.0.282': [
        {
            title: 'Home (TV)',
            items: [
                'Home rows always load first. Last visit appears immediately, then Plex fills the pins. The current and next row backgrounds start right away so changing rows does not wait',
            ],
        },
        {
            title: 'Playback (TV)',
            items: [
                'Leaving playback returns to Home or the title page instead of a black screen',
            ],
        },
    ],
    '1.0.281': [
        {
            title: 'Playback (TV)',
            items: [
                'Playback keeps a larger buffer, so brief network hiccups no longer stall the picture for a few seconds',
            ],
        },
    ],
    '1.0.280': [
        {
            title: 'Home (TV)',
            items: [
                'Backgrounds are 1080p so Plex is not overloaded',
                'Posters load at 90% quality',
                'Opening a title stops the row preload so the logo, background, and episodes can load',
            ],
        },
    ],
    '1.0.279': [
        {
            title: 'Home (TV)',
            items: [
                'Posters appear whole, instead of filling in halfway',
                'The background, logo, and description update sooner when you move along a row',
            ],
        },
    ],
    '1.0.278': [
        {
            title: 'Home (TV)',
            items: [
                'Coming back to Home starts each row on its first poster',
                'Apple TV and HBO logos are white, and the DC logo is blue',
            ],
        },
    ],
    '1.0.277': [
        {
            title: 'Home (TV)',
            items: [
                'Backgrounds load the full-quality picture first, instead of a soft preview',
            ],
        },
    ],
    '1.0.276': [
        {
            title: 'Home (TV)',
            items: [
                'Home loads the rows pinned in Plex again, instead of stopping at Continue Watching and Watchlist',
            ],
        },
    ],
    '1.0.275': [
        {
            title: 'Home (TV)',
            items: [
                'Moving back to a row keeps the show you were on in the same place',
                'The Continue Watching screensaver uses the shows on that row',
                'Continue Watching backgrounds use the full-quality picture',
            ],
        },
    ],
    '1.0.274': [
        {
            title: 'Home (TV)',
            items: [
                'Home reliably loads the collections currently pinned in Plex',
                'Episodes from one show added within 24 hours appear as one Recently Added card',
            ],
        },
    ],
    '1.0.273': [
        {
            title: 'Home (TV)',
            items: [
                'Home, library Recommended, and Browse show their first rows sooner',
                'Scrolling a row stays on each show instead of jumping ahead',
            ],
        },
    ],
    '1.0.272': [
        {
            title: 'Home (TV)',
            items: [
                'Home shows every row Plex has pinned, and loads them again each time you come back',
                'Recently Added lists every episode, so a big add to one show fills the row',
            ],
        },
        {
            title: 'Playback',
            items: [
                'Resume stays on the open file. A second Plex session no longer starts on top of it',
            ],
        },
    ],
    '1.0.271': [
        {
            title: 'Home (TV)',
            items: [
                'Recently watched Continue Watching puts the show you just finished at the front of the row',
                'Resuming an episode starts playback, and previous and next show up',
                'The next episode shows that it is loading instead of sitting on a blank screen',
            ],
        },
    ],
    '1.0.270': [
        {
            title: 'Home (TV)',
            items: [
                'Continue Watching uses the same full-quality background as the show page',
            ],
        },
    ],
    '1.0.269': [
        {
            title: 'Home (TV)',
            items: [
                'Continue Watching uses the current background after you change it in Plex',
            ],
        },
    ],
    '1.0.268': [
        {
            title: 'Home (TV)',
            items: [
                'Continue Watching uses the current background after you change it in Plex',
            ],
        },
    ],
    '1.0.267': [
        {
            title: 'Home (TV)',
            items: [
                'The screensaver clock stays still',
                'Settings can shift the clock on each slide for OLED screens',
            ],
        },
    ],
    '1.0.266': [
        {
            title: 'Home (TV)',
            items: [
                'The screensaver uses the background currently set in Plex, including after you change a movie like Wonka',
            ],
        },
    ],
    '1.0.265': [
        {
            title: 'Home (TV)',
            items: [
                'Search episodes sit further apart',
                'Episodes are listed in season order',
                'The side menu stays the height of its items when Search opens',
            ],
        },
    ],
    '1.0.264': [
        {
            title: 'Home (TV)',
            items: [
                'Search episodes wrap into a grid and scroll down',
                'Each episode shows its own picture and its own name',
                'Recent searches stay fully on screen, and popular searches sit underneath',
            ],
        },
    ],
    '1.0.263': [
        {
            title: 'Home (TV)',
            items: [
                'Search puts the name under each show, movie, and episode',
                'Episode results use that episode’s image',
                'Shows, movies, and episodes each sit in their own row',
            ],
        },
    ],
    '1.0.262': [
        {
            title: 'Home (TV)',
            items: [
                'The search box and keyboard are a little smaller, so more of the rows fit',
                'Search rows stay fully on screen, and recent searches keep the finished word',
                'What’s New lists the last 10 versions',
            ],
        },
    ],
    '1.0.261': [
        {
            title: 'Home (TV)',
            items: [
                'Search shows Movies under TV Shows',
                'The first row title and the first poster stay fully on screen',
            ],
        },
    ],
    '1.0.260': [
        {
            title: 'Home (TV)',
            items: [
                'The search bar stays on screen while you type',
                'Down from the keyboard moves through the rows, and back up again',
            ],
        },
    ],
    '1.0.259': [
        {
            title: 'Home (TV)',
            items: [
                'Search opens an on-screen keyboard you can move with the remote',
                'Screensaver slides are shuffled, whichever art source you picked',
                'Screensaver backgrounds are sharper, and the clock shifts a little each slide',
            ],
        },
    ],
    '1.0.258': [
        {
            title: 'Home (TV)',
            items: [
                'A show with no network logo uses its studio logo, then a streaming logo',
                'The screensaver uses the show’s current background after you change it in Plex',
            ],
        },
    ],
    '1.0.257': [
        {
            title: 'Player (TV)',
            items: [
                'Holding seek forward or back keeps stepping through the file',
            ],
        },
    ],
    '1.0.256': [
        {
            title: 'Player (TV)',
            items: [
                'Seeking stays on the current file instead of buffering into a new stream',
            ],
        },
    ],
    '1.0.255': [
        {
            title: 'Player (TV)',
            items: [
                'The episode page no longer flashes through while the player is opening',
            ],
        },
    ],
    '1.0.254': [
        {
            title: 'Player (TV)',
            items: [
                'Starting a title no longer pauses itself or switches off Direct Play',
            ],
        },
    ],
    '1.0.253': [
        {
            title: 'Player (TV)',
            items: [
                'Pause and play work again after you pause',
                'Previous and next episode buttons are back beside play',
            ],
        },
    ],
    '1.0.252': [
        {
            title: 'Player (TV)',
            items: [
                'Resume starts the file playing, then jumps to the saved time, so Direct Play no longer sticks on one frame',
            ],
        },
    ],
    '1.0.251': [
        {
            title: 'Player (TV)',
            items: [
                'Playback is restored to the 1.0.210 player',
            ],
        },
    ],
    '1.0.250': [
        {
            title: 'Player (TV)',
            items: [
                'Start and resume use the 1.0.220 Direct Play path again',
            ],
        },
    ],
    '1.0.249': [
        {
            title: 'Player (TV)',
            items: [
                'Resume Direct Plays the original file again instead of transcoding',
            ],
        },
    ],
    '1.0.248': [
        {
            title: 'Player (TV)',
            items: [
                'Resume starts a stream at the saved time instead of seeking inside the file, which was sticking on that frame',
            ],
        },
    ],
    '1.0.247': [
        {
            title: 'Home (TV)',
            items: [
                'Continue Watching keeps the season poster after you leave an episode',
            ],
        },
    ],
    '1.0.246': [
        {
            title: 'Player (TV)',
            items: [
                'Resume starts from the saved position. Starting in the middle of a file no longer sticks on that frame',
            ],
        },
    ],
    '1.0.245': [
        {
            title: 'Player (TV)',
            items: [
                'If a movie or episode sticks on the first frame, playback switches to a stream this TV can play, and play/pause starts it again',
            ],
        },
    ],
    '1.0.244': [
        {
            title: 'Player (TV)',
            items: [
                'Previous and next episode buttons sit on either side of play/pause',
            ],
        },
    ],
    '1.0.243': [
        {
            title: 'Player (TV)',
            items: [
                'The playback line shows the episode name (S1 · E4 · Episode title), not the show name again',
            ],
        },
    ],
    '1.0.242': [
        {
            title: 'Home (TV)',
            items: [
                'Moving between titles updates the backdrop and description right away, without waiting on a metadata lookup',
                'Pinned rows show up with the rest of Home instead of waiting on the slower recommendation lookups',
            ],
        },
        {
            title: 'Player (TV)',
            items: [
                'Up next / Watch credits appears at the credits marker or about two minutes before the end — whichever is sooner',
                'Hold left/right to keep seeking; it no longer drops repeats while the stream restarts',
                'Pause stays paused when you pause and play several times in a row',
                'Returning from an episode no longer leaves a long black screen before the episode page',
            ],
        },
    ],
    '1.0.241': [
        {
            title: 'Home (TV)',
            items: [
                'What’s New shows the last three app versions in order (e.g. 1.0.241 → 1.0.240 → 1.0.239)',
            ],
        },
    ],
    '1.0.240': [
        {
            title: 'Home (TV)',
            items: [
                'Pressing Home in the side nav while already on Home jumps back to Continue Watching at the top',
                'What’s New panel uses more of the screen — scroll with Up/Down for the full list',
            ],
        },
    ],
    '1.0.239': [
        {
            title: 'Home (TV)',
            items: [
                'Restored 1.0.229-era image loading — posters and cast art use working Plex image URLs again (post-229 blank-art experiments removed)',
                'Home keeps posters warm in memory for ~3 minutes so scrolling back up a row stays snappy; a Plex cover swap changes the URL stamp so new art loads immediately',
                'Continue Watching also warms episode stills and detail backdrops in the background so opening an episode feels ready',
                'Back from a title returns focus to the Continue Watching poster you opened (no more jumping to a different show)',
                '“Because you watched” rows show again at the bottom of Home when the setting is on',
            ],
        },
    ],
    '1.0.238': [
        {
            title: 'Home (TV)',
            items: [
                'Continue Watching pulls the live show poster from Plex (no more stuck Netflix / old art after you swap posters)',
                'Recently Added TV shows SxxExx, episode title and synopsis — OK opens that episode (same as Plex)',
                'Optional season posters on Recently Added (show posters stay the default)',
                'Screensaver: pick the art pool in Settings (Continue Watching, Watchlist, Recommended, Trending, Popular, New releases, Recently added, Most watched, Something new, Completely random)',
                'Screensaver cycles in random order and shows the chosen pool name above the clock',
            ],
        },
        {
            title: 'Player (TV)',
            items: [
                'Up next card is usable with the remote (OK / left-right) instead of opening the OSD',
                'Back on Up next (or when playback has ended) returns straight to the episode overview — no blank wait through credits',
            ],
        },
    ],
    '1.0.215': [
        {
            title: 'Details (TV)',
            items: [
                'Related Shows now includes genre rows from this show’s library (e.g. Drama, Reality)',
                'Optional: skip the seasons page for single-season shows (Settings → Titles, off by default)',
                'Shuffle stays as an icon chip; Shuffle unwatched lives in the ⋯ menu',
                'Show and movie synopses show in full — no mid-sentence cutoff',
            ],
        },
        {
            title: 'Home (phone)',
            items: [
                'Home loads faster — first paint no longer waits on every pinned row and brand lookup',
                'Tighter spacing between rows so less empty space between shelves',
            ],
        },
    ],
    '1.0.190': [
        {
            title: 'Player settings',
            items: [
                'In-player Settings cog matches Plex playback options: subtitle look, burn-in, sync delay, night mode, frame rate, passthrough, and media info',
                'Skip intro/credits: Off, Manual, or Automatic; rewind on resume; audio boost; cinema trailer count 0–5',
                'Subtitle auto-sync when the server has voice analysis; otherwise greyed out with manual delay still available',
            ],
        },
    ],
    '1.0.185': [
        {
            title: 'Player',
            items: [
                'Minimal playback chrome: clearlogo + episode meta, remaining time, and when the title ends',
                'All quality / audio / subtitle / playback options live in a Settings tree behind the cog',
                'Left/Right seek ±10s with on-screen flash; hold to scrub continuously',
                'Satoshi type on the player and on Home / library titles',
            ],
        },
    ],
    '1.0.183': [
        {
            title: 'Home & playback',
            items: [
                'Idle screensaver on Home cycles Continue Watching art with a large clock in the bottom left',
                'Shuffle unwatched for shows and seasons',
                'If playback buffers for a while, you can lower quality in one tap',
            ],
        },
    ],
    '1.0.182': [
        {
            title: 'Playback',
            items: [
                'Sleep timer: after 1–2 more episodes, or stop at credits (plus the existing timed / end-of-episode options)',
                'Play unwatched from here on episode menus — skips later watched episodes and continues into the next season',
                'A/V delay remembered per show; brief Direct Play / Transcode chip when playback starts',
                'More like this at credits when there is no next episode (or after Watch credits)',
            ],
        },
    ],
    '1.0.181': [
        {
            title: 'Playback',
            items: [
                'After an episode ends, Back works again during the next-episode handoff (no multi-minute black screen trap)',
                'Autoplay-next returns to the app immediately instead of lingering on a black player window',
            ],
        },
    ],
    '1.0.180': [
        {
            title: 'Home',
            items: [
                'Disney+ and Universal billboard logos render white on dark stills (easier to read)',
                'Home spot synopsis and cast no longer clip mid-line above the poster row',
            ],
        },
    ],
    '1.0.179': [
        {
            title: 'Home',
            items: [
                'Far more billboard logos: hub rows now always pull TMDB ids (studio text alone used to skip them)',
                'If TMDB has no studio/network mark, fall back to the streaming service logo (Netflix, Disney+, …)',
            ],
        },
    ],
    '1.0.178': [
        {
            title: 'Home',
            items: [
                'Billboards use real studio logos from TMDB (Marvel red plate, Universal globe, …) — not plain text labels',
                'Movies pick the production studio listed on TMDB and map it to bundled logo art',
            ],
        },
    ],
    '1.0.177': [
        {
            title: 'Home',
            items: [
                'Marvel Studios and other dark studio wordmarks invert to white on billboards again',
                'Major studio logos (Disney, Warner, Universal, …) ship in the APK so more movies show a mark without TMDB CDN',
            ],
        },
    ],
    '1.0.175': [
        {
            title: 'Home',
            items: [
                'Network logos (Channel 4, BBC, …) render on Fire TV / Android again — text SVGs were blank in WebView; billboards resolve Plex Network marks immediately',
            ],
        },
    ],
    '1.0.174': [
        {
            title: 'Home',
            items: [
                'TV logos follow Plex Network tags (same as Advanced Filters) — Gogglebox shows Channel 4, not a Netflix Label/watch-provider',
            ],
        },
    ],
    '1.0.173': [
        {
            title: 'Home',
            items: [
                'TV logos follow Plex Network tags (same as Advanced Filters) — Gogglebox shows Channel 4, not a Netflix Label/watch-provider',
            ],
        },
    ],
    '1.0.172': [
        {
            title: 'Home',
            items: [
                'TV logos follow Plex Network tags (same as Advanced Filters) — Gogglebox shows Channel 4, not a Netflix Label/watch-provider',
            ],
        },
    ],
    '1.0.171': [
        {
            title: 'Home',
            items: [
                'Home and library rows pull Plex Network tags (Channel 4, ITVX, …) so billboard logos match the same filters as Plex',
            ],
        },
    ],
    '1.0.170': [
        {
            title: 'Home',
            items: [
                'Continue Watching episodes (e.g. Gogglebox) load the show network again — Channel 4 / BBC were missing before',
            ],
        },
    ],
    '1.0.169': [
        {
            title: 'Home',
            items: [
                'Movies show studio logos; TV shows show network logos — maximum coverage without wrong streamer badges',
            ],
        },
    ],
    '1.0.164': [
        {
            title: 'Home',
            items: [
                'Channel 4 / BBC shows no longer show Netflix when a watch-provider lists them — broadcaster wins',
            ],
        },
    ],
    '1.0.163': [
        {
            title: 'Home',
            items: [
                'Discovery+ mark keeps the coloured D icon with white “discovery+” text',
            ],
        },
    ],
    '1.0.162': [
        {
            title: 'Home',
            items: [
                'Prime Video / Netflix exclusives show the streamer mark (Amazon Studios → Prime); full synopsis no longer clipped by a fixed-height panel',
            ],
        },
    ],
    '1.0.161': [
        {
            title: 'Home',
            items: [
                'Studio / network logos are always white on the billboard; full description text (no mid-sentence cut-off)',
            ],
        },
    ],
    '1.0.157': [
        {
            title: 'Home',
            items: [
                'Discovery+ mark is text-only (no icon) so it reads cleanly as white on dark art',
            ],
        },
    ],
    '1.0.156': [
        {
            title: 'Home',
            items: [
                'TV logos prefer the broadcast network (Channel 4, BBC, …) over “also on Netflix” watch-provider badges',
            ],
        },
    ],
    '1.0.155': [
        {
            title: 'Home',
            items: [
                'More titles show studio/network logos — Channel 4 / ITVX / BBC / Netflix and movies that only had IMDb IDs in Plex',
            ],
        },
    ],
    '1.0.154': [
        {
            title: 'Home',
            items: [
                'Marvel Studios (and similar filled-colour marks) keep brand colours — forced white was turning MARVEL into a blank block',
            ],
        },
    ],
    '1.0.152': [
        {
            title: 'Home',
            items: [
                'Studio / network logos above titles are forced white on dark art (Paramount and other black marks were invisible before)',
            ],
        },
    ],
    '1.0.151': [
        {
            title: 'Home',
            items: [
                'Major UK/US brands in the logo catalog — ITVX, BBC, Channel 4/5, CBeebies, Sky Originals, Netflix, Disney+, Prime, Paramount+, Discovery+, NBC, CBS, Cartoon Network, Pixar, and more',
            ],
        },
    ],
    '1.0.150': [
        {
            title: 'Settings',
            items: [
                'New Titles toggle: Studio / network logos — turn off the streaming, studio, and network marks above titles (on by default)',
            ],
        },
    ],
    '1.0.149': [
        {
            title: 'Home',
            items: [
                'Channel 4 / Netflix and other network logos above Continue Watching titles — UK Channel 4 is in the catalog, and episodes use the parent show’s network (not a broken episode TMDB id)',
            ],
        },
    ],
    '1.0.148': [
        {
            title: 'Home',
            items: [
                'Studio logos show on far more movies — plain white marks (no broken duotone), TMDB ids on home rows, and studio preferred over streaming for films',
            ],
        },
    ],
    '1.0.147': [
        {
            title: 'Home',
            items: [
                'Many more titles show a studio or streaming logo — better name matching, TMDB studio fallback, and retry if an image fails',
            ],
        },
    ],
    '1.0.146': [
        {
            title: 'Home',
            items: [
                'Streaming / studio / network logo now appears above the clearlogo on the Home focus spotlight (not only on title details)',
            ],
        },
    ],
    '1.0.144': [
        {
            title: 'Details',
            items: [
                'Brand logo above the clearlogo is fixed — studio/network tags resolve again, and marks stay visible on dark art',
            ],
        },
    ],
    '1.0.143': [
        {
            title: 'Details',
            items: [
                'One brand logo above the title clearlogo — streaming first, then studio, then network (never more than one)',
            ],
        },
    ],
    '1.0.142': [
        {
            title: 'Browse',
            items: [
                'Long-press menu now lists Mark Watched and Mark Unwatched separately (movies, shows, seasons, episodes)',
                'Add to Watchlist sits near the top of the context menu — episodes and seasons add the parent show',
            ],
        },
    ],
    '1.0.141': [
        {
            title: 'Watch Together',
            items: [
                'Friends join from Settings → Connection → Join Watch Together, then enter your invite code',
                'Everyone must use the same StreamPilot portal URL; each person plays from their own Plex library',
            ],
        },
    ],
    '1.0.140': [
        {
            title: 'Watch Together',
            items: [
                'Settings → Connection lets you add or change your StreamPilot portal URL without signing out',
                'Portal URL is required for Watch Together when you use Plex-direct sign-in',
            ],
        },
    ],
    '1.0.138': [
        {
            title: 'Watch Together',
            items: [
                'Watch the same title with friends — play, pause, and seek stay in sync over your StreamPilot portal',
                'Works with portal sign-in and Plex-direct when the app has a StreamPilot portal URL',
            ],
        },
        {
            title: 'Browse',
            items: [
                'Up from the top Browse row reaches filters or the Recommended/Browse/Collections tabs (no dead end)',
                'Back from a title keeps the poster or View more control you opened from',
            ],
        },
        {
            title: 'Search',
            items: [
                'Back steps results → search field → clears search (no longer opens the side menu while search is open)',
                'Up/Down between search result groups and the search field works again',
            ],
        },
        {
            title: 'Watchlist & Playlists',
            items: [
                'Opening Watchlist or Playlists lands the orange ring on the first poster',
                'Empty and error states are remote-friendly with a focused Back action',
                'Playlist titles open correctly — Select no longer did nothing on playlist items',
            ],
        },
        {
            title: 'Navigation',
            items: [
                'Library names in the side menu load more reliably — failed refreshes no longer wipe the list, and a slow server is retried',
                'Libraries show an orange warning when their Plex server is offline (like the official app)',
            ],
        },
    ],
    '1.0.137': [
        {
            title: 'Libraries',
            items: [
                'Continue Watching is back on Library Recommended — section On Deck is fetched like the portal, not only when /hubs/sections includes it',
            ],
        },
    ],
    '1.0.136': [
        {
            title: 'Home',
            items: [
                'Continue Watching is back — On Deck is no longer dropped when pinned collection rails load',
                'Pinned Plex collections always load on Home (empty shells are filled every refresh, not only on a lucky full pass)',
            ],
        },
    ],
    '1.0.126': [
        {
            title: 'Playback',
            items: [
                'EAC3 / Dolby Digital Plus Direct Plays like official Plex — no more AAC audio convert; AC3/EAC3 never need Bitstream (that is TrueHD/DTS only)',
            ],
        },
    ],
    '1.0.125': [
        {
            title: 'Playback',
            items: [
                'Resume matches official Plex audio again — Direct Play selects the safe track (AC3/AAC), not default TrueHD/DTS; remux only if seek truly stalls',
            ],
        },
    ],
    '1.0.124': [
        {
            title: 'Browse',
            items: [
                'Short Select on Home opens the title again — context menu is long-press only',
            ],
        },
    ],
    '1.0.123': [
        {
            title: 'Playback',
            items: [
                'Prefer Direct Play/Stream again — resume no longer forces HLS; TrueHD/DTS without Bitstream uses an AC3/AAC track instead of audio transcode',
            ],
        },
    ],
    '1.0.122': [
        {
            title: 'Details',
            items: [
                'Episode cards play like Watch/Resume for that episode (resume dialog, no “play from here” queue)',
            ],
        },
    ],
    '1.0.121': [
        {
            title: 'Browse',
            items: [
                'Leaving playback returns to the screen you started from (Home stays Home — no jump into the movie library)',
            ],
        },
    ],
    '1.0.120': [
        {
            title: 'Playback',
            items: [
                'Fix play stuck paused after open — toggle uses play-when-ready, re-prepares after stream swap, debounce OK/click',
            ],
        },
    ],
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
    const releases = useMemo(() => recentWhatsNewReleases(version, 10), [version]);
    const seenKey = useMemo(() => currentNotesSeenKey(version), [version]);

    useEffect(() => {
        if (!version || !releases.length) return;
        // Fingerprint of the note cards — reappears when they change, not on every APK bump.
        if (readApkWhatsNewSeen() === seenKey) return;
        setOpen(true);
    }, [releases.length, seenKey, version]);

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

    if (!open || !releases.length) return null;

    const dismiss = () => {
        writeApkWhatsNewSeen(seenKey);
        setOpen(false);
    };

    const modal = (
        <div
            className="fixed inset-0 z-[4200] flex items-center justify-center bg-black/70 p-5 sm:p-8"
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
            <div
                className="player-popup-surface relative z-10 flex w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-white/10 shadow-[0_28px_90px_rgba(0,0,0,0.55)]"
                style={{ height: 'min(calc(100vh / var(--tv-zoom, 1) - 3rem), 56rem)' }}
            >
                <div className="shrink-0 px-7 pb-3 pt-7">
                    <div className="mb-4 flex items-center gap-2 text-plex">
                        <Sparkles className="h-5 w-5 shrink-0" />
                        <span className="text-xs font-bold uppercase tracking-[0.2em]">
                            {t('mediaPlayerPage.apkWhatsNewTitle')}
                        </span>
                    </div>
                    <h2 id="apk-whats-new-title" className="text-2xl font-black tracking-tight text-white">
                        {version}
                    </h2>
                </div>
                <div
                    data-tv-whats-new-scroll="1"
                    className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain px-7 pb-2 pr-8"
                >
                    {releases.map((release) => (
                        <div key={release.version} className="space-y-4">
                            {releases.length > 1 ? (
                                <p className="text-sm font-bold tracking-tight text-white/70">
                                    {release.version}
                                    {release.version === releases[0]?.version ? (
                                        <span className="ml-2 text-[0.7rem] font-bold uppercase tracking-[0.16em] text-plex">
                                            Latest
                                        </span>
                                    ) : null}
                                </p>
                            ) : null}
                            {release.sections.map((section) => (
                                <div key={`${release.version}:${section.title}`}>
                                    <h3 className="text-xs font-bold uppercase tracking-[0.18em] text-plex">
                                        {section.title}
                                    </h3>
                                    <ul className="mt-2 space-y-2">
                                        {section.items.map((item) => (
                                            <li
                                                key={`${release.version}:${item}`}
                                                className="relative pl-4 text-sm leading-relaxed text-white/85"
                                            >
                                                <span className="absolute left-0 text-plex" aria-hidden>•</span>
                                                {item}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            ))}
                        </div>
                    ))}
                </div>
                <div className="shrink-0 border-t border-white/10 px-7 py-5">
                    <button
                        ref={buttonRef}
                        type="button"
                        data-tv-item="1"
                        data-tv-action="1"
                        data-tv-whats-new-primary="1"
                        onClick={dismiss}
                        className="flex w-full min-h-[3.25rem] items-center justify-center rounded-2xl bg-plex px-5 py-3.5 text-base font-bold text-white outline-none"
                    >
                        {t('mediaPlayerPage.apkWhatsNewContinue')}
                    </button>
                </div>
            </div>
        </div>
    );

    if (typeof document === 'undefined') return modal;
    return createPortal(modal, document.body);
};
