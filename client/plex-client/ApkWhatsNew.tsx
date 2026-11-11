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
    '1.0.687': [
        {
            title: 'Insights',
            items: [
                'Moving down the history rows now jumps like Home does, keeping a sliver of the rows above and below in view',
            ],
        },
    ],
    '1.0.686': [
        {
            title: 'Insights',
            items: [
                'Down through the Fun facts now steps through each line of boxes instead of jumping past them to the next row',
                'The last rows on the page no longer scroll up to the top of an empty screen; they stop at the bottom with the rows above still showing',
            ],
        },
    ],
    '1.0.685': [
        {
            title: 'Insights',
            items: [
                'Moving up and down the rows now centres the row you are on, so the one above and the one below always peek in and you can see where you are',
                'More stats: age ratings and countries of what you watch, plus new fun facts (average film length, newest film, busiest hour, most watched studio, the show you spent longest on, your average rating and shows still going)',
                'Every new box opens its own detail panel',
            ],
        },
    ],
    '1.0.683': [
        {
            title: 'Screensaver',
            items: [
                'Show backgrounds follow the one picked in Plex everywhere (Home, Continue Watching, screensaver), instead of an older cached picture',
                'The screensaver picks up a show\'s current background each time it starts, instead of the one from when the app opened',
            ],
        },
    ],
    '1.0.682': [
        {
            title: 'People',
            items: [
                'A person with no photo shows their initials on a dark circle instead of a blank white one',
                'A person page no longer borrows the biography, birth and death of an unrelated person with the same name (a TV narrator showing a Danish painter)',
            ],
        },
    ],
    '1.0.681': [
        {
            title: 'Player',
            items: [
                'The player cast strip lists people in the same order as the episode page (guest stars first)',
                'Cast members with no photo show their initials in a circle instead of an empty one',
            ],
        },
    ],
    '1.0.680': [
        {
            title: 'Player',
            items: [
                'Cast names and roles in the player are a little smaller',
            ],
        },
    ],
    '1.0.679': [
        {
            title: 'Player',
            items: [
                'The cast strip in the player now circles just the selected photo with a thin accent line, instead of filling the whole card white',
            ],
        },
    ],
    '1.0.678': [
        {
            title: 'Insights',
            items: [
                'Selected Insights boxes no longer turn their text dark: just the accent outline, with the text staying white',
            ],
        },
    ],
    '1.0.677': [
        {
            title: 'Insights',
            items: [
                'Selected Insights boxes keep their text readable and get a slightly thicker accent outline',
            ],
        },
    ],
    '1.0.676': [
        {
            title: 'Insights',
            items: [
                'Selected Insights boxes keep a thin accent outline only, never a white fill',
                'The corner clock is hidden on the Insights page',
                'The loading placeholder now matches the page: stat tiles, breakdown cards, the viewing-times chart and facts, instead of a poster grid',
            ],
        },
    ],
    '1.0.675': [
        {
            title: 'Insights',
            items: [
                'Boxes on the Insights page show a thin accent outline when selected, and no longer fill in',
            ],
        },
    ],
    '1.0.674': [
        {
            title: 'Look',
            items: [
                'Posters are now slightly rounded by default (change it in Settings → Appearance)',
            ],
        },
        {
            title: 'Player',
            items: [
                'Who is on screen: each cast member is circled in your accent colour with just their name, instead of a big white box',
            ],
        },
    ],
    '1.0.673': [
        {
            title: 'Screensaver',
            items: [
                'A small arrow pulses at the top of the screensaver: press Up on the remote to open the title that is showing',
            ],
        },
    ],
    '1.0.672': [
        {
            title: 'Player',
            items: [
                'Some MKV files (often older TrueHD / DTS remuxes) were treated as unable to seek, so resuming or seeking switched them to a server transcode. They now Direct Play, resume and seek normally',
            ],
        },
    ],
    '1.0.671': [
        {
            title: 'Player',
            items: [
                'Left and Right seek straight away, without bringing the controls up first. The controls appear as you seek, and further presses keep seeking',
                'Quick presses add up: press three times to jump 30 seconds in one go. The on-screen number shows the total',
                'Hold Left or Right and seeking speeds up the longer you hold',
            ],
        },
    ],
    '1.0.670': [
        {
            title: 'Library Browse',
            items: [
                'Press OK on the sort you already have to flip it between ascending and descending. An arrow on the Sort button and in the list shows which way it is sorted, and the list stays open so you can flip it straight away (Back closes it)',
                'When Browse is sorted by something other than title or year, each poster shows that value after the year: bitrate, file size, duration, resolution, rating, date added, last played, release date or play count',
            ],
        },
    ],
    '1.0.669': [
        {
            title: 'Library Browse',
            items: [
                'Sort and filters are simpler with the remote: two buttons, Sort and Filters, open the same side panel. Up and down to move, OK to pick, Back to close. Sort by is also at the top of the Filters panel, so you can change it at any time, filters or not',
                'New filters for films: Bitrate, Video codec, Audio codec, Audio channels, Dolby Vision, HDR10+ and Dolby Atmos. Films can also be sorted by Bitrate or File size',
                'Active filters are listed beside the buttons instead of as extra buttons, and Down from the library tabs now always lands on Sort',
            ],
        },
    ],
    '1.0.668': [
        {
            title: 'Big 4K remuxes',
            items: [
                'Films with only TrueHD or DTS / DTS-HD audio, like most 4K remuxes, now Direct Play. The app decodes that audio itself when your TV or receiver cannot take it, as Kodi does, so nothing is sent to your server to transcode. Before, they failed with a playback error on servers with transcoding turned off',
                'If your TV or receiver supports TrueHD / DTS, turn on Settings → Bitstream audio to send it untouched for Atmos and DTS:X',
                'The player now keeps far more of a big file in memory when the app talks to Plex directly, so short network dips no longer stop playback',
                'Seeking in the rare file written without a seek index now switches to a stream that starts where you asked, instead of jumping back to the beginning',
            ],
        },
    ],
    '1.0.667': [
        {
            title: 'Fixes',
            items: [
                'Opening the side menu on a title page no longer pushes the page twice as far as it should, which left a large empty gap between the menu and the title',
                'The StreamPilot logo on the loading screen no longer shows as a broken image when the app reloads while on a title page, and the app fonts load properly in that case too',
            ],
        },
    ],
    '1.0.666': [
        {
            title: 'Faster remote',
            items: [
                'The quicker remote from the last update now covers title pages too (Watch and the buttons beside it, seasons, episodes, cast and extras), plus Settings, library tabs and filters, Search and the hold-OK menu on a poster',
            ],
        },
    ],
    '1.0.665': [
        {
            title: 'Faster remote',
            items: [
                'Moving along rows, between rows and in and out of the side menu does much less work per press. After every press, Android was searching the whole page for a text box to decide what the on-screen keyboard\'s Next button should do, even with no keyboard open. Posters and side menu entries no longer set that search off, which roughly halves the work behind each press',
            ],
        },
    ],
    '1.0.664': [
        {
            title: 'Playback',
            items: [
                'Very large files such as 4K remuxes buffer far less. The player used to keep only a few seconds of a 100 Mbps file in memory, so any short network dip stopped playback. It now sizes its buffer from the file\'s bitrate and the memory your device has, and waits a moment longer before starting heavy files so playback has something in hand',
                'The stats overlay shows the right bitrate for files above 100 Mbps',
            ],
        },
    ],
    '1.0.662': [
        {
            title: 'Libraries',
            items: [
                'The library hearts under Settings → Home layout now apply the moment you tap them, with no need to press Save. Before, a heart changed on the TV and left with Back was never saved, so the library stayed in the sidebar and on Home',
                'An empty heart drops the library from the sidebar, the library row along the top and its rows on Home straight away; filling it again brings them all back without restarting the app',
            ],
        },
    ],
    '1.0.661': [
        {
            title: 'Phone title pages',
            items: [
                'Show pages list their seasons again ("8 Seasons" with the posters), like the Plex app',
                'A season page has "Season 2" with a down arrow under the logo: tap it to jump to any other season from a sheet with each season poster and episode count',
                'Tapping an episode title now opens a proper episode sheet: each episode with its still, episode number, air date and summary, the one you are on highlighted, and Go to Season and Go to Show side by side at the bottom',
                'The round buttons under Watch are smaller, all the same width and centred with even spacing, with lighter labels. File Info and Add to Playlist live in the More menu',
                'Lighter text throughout, a "Directed by" line under the summary in place of the long credits block, bigger cast photos and wider trailer stills',
            ],
        },
    ],
    '1.0.660': [
        {
            title: 'Phone title pages',
            items: [
                'Movie, show and episode pages on a phone now follow the Plex app layout: the back button floats over the artwork and becomes a bar with the title as you scroll, the year, length, genre and rating sit on one plain line under the logo, and the Watch button has the start-over circle beside it',
                'The round action buttons now have a label under each one and scroll sideways, so none are cut off: Add to Watchlist, Watch Trailer, Mark as Watched, Watch Together, File Info and More',
                'The summary shows three lines with a Read more, and the Video, Audio and Subtitles rows read as a quiet list with the chosen subtitles in your accent colour',
                'A show with several seasons lists the episodes right on its page under a Season picker: tap Season 2 to switch seasons from a bottom sheet. Episode rows have a still, an episode badge, the date and a short summary, with a line between each',
                'On an episode page, tap the episode title to open a sheet of every episode in the season, with Go to Season and Go to Show underneath',
                'Cast, trailers and related rails have bolder headings and smaller cast photos',
            ],
        },
    ],
    '1.0.659': [
        {
            title: 'Libraries',
            items: [
                'The hearts under Settings → Libraries to show now also decide which libraries appear in the sidebar and in the library row along the top of Home: an empty heart hides a library from all of them. This replaces the separate per-library sidebar switches added in the last version',
                'Browsing a library on a phone is tidier: the long block of filter dropdowns is now one Filters button next to the sort, like on the TV. Pick a filter from the list, and the filters you have on show as chips you can tap to remove',
            ],
        },
    ],
    '1.0.658': [
        {
            title: 'Libraries',
            items: [
                'A library now opens on the tab you left it on, so a library you browse stays on Browse instead of going back to Recommended each time, even after the app is closed',
                'A library keeps its sort order (Title, Date Added and so on) between visits, including after the app is closed',
                'Choose which libraries show in the sidebar: Settings has a switch for each library, next to the other sidebar switches. A library you turn off still shows on Home and in Search',
                'The sidebar list of libraries follows the remote smoothly all the way down, however many libraries you have',
            ],
        },
    ],
    '1.0.657': [
        {
            title: 'Insights',
            items: [
                'Insights now shows your series as well as your films reliably: it opens straight away on your newest titles from every library, then reads the rest of your history behind it. If a library is slow, the page says so instead of leaving it out',
                'Fixed series that went missing from Insights on some servers (the server hands back shorter pages than asked for, and the rest of the history was being skipped)',
                'The remote now walks Insights box by box in every direction, no longer jumps to the middle of the page, and every box can be selected; the page opens on its first box',
                'Closing a pop-up on Insights no longer bounces the page back to the top: you stay on the box you opened',
            ],
        },
    ],
    '1.0.656': [
        {
            title: 'Insights',
            items: [
                'Select any box on Insights to see the detail behind it: hours watched break down into films and series with where the time went, genres list every genre with its top titles, decades and studios show the titles behind each bar, when you watch shows every hour and day, and each fun fact opens to its own list',
                'Pick a title in any of those lists to open it',
                'Insights can be turned off in Settings (Home tab, Show Insights in the menu), and nothing is loaded for it while it is off',
            ],
        },
    ],
    '1.0.655': [
        {
            title: 'Insights',
            items: [
                'History is now Insights: your watching in numbers. Hours watched, titles, episodes, shows finished and movies rewatched, your top genres, decades and studios, when you watch, fun facts, and the shows and films you come back to most',
                'Your recently watched list is still there, at the bottom of the page',
                'Hours are estimated from run times and play counts, and times of day count each title once, when you last watched it',
            ],
        },
        {
            title: 'Screensaver',
            items: [
                'The screensaver picture is brighter: the default shading is lighter, and the Light shading option is lighter still',
            ],
        },
    ],
    '1.0.654': [
        {
            title: 'Screensaver',
            items: [
                'Three new screensaver styles: Gallery (each picture framed with its title below), Spotlight (full picture with the title, details and summary), and Poster wall (rows of posters drifting across the screen)',
                'New screensaver settings: what to show with the art, clock position (any corner, centre or off), clock size, shading, instant or fade between pictures, and whether to show the picture source',
            ],
        },
    ],
    '1.0.653': [
        {
            title: 'Watch Together',
            items: [
                'The Watch Together setup screen text can now be translated like the rest of the app',
                'The Join Watch Together hint in Settings no longer says a relay does the work, which is not true for rooms hosted on a device',
            ],
        },
    ],
    '1.0.652': [
        {
            title: 'Watchlist',
            items: [
                'With more than one server, removing a title from the Watchlist can no longer hide a different title from another server that shares its id',
            ],
        },
    ],
    '1.0.651': [
        {
            title: 'Player',
            items: [
                'Picture in picture now works properly: press Home while something is playing and it shrinks to a small window instead of stopping',
                'The window takes the shape of the film or episode and has its own play / pause button. Closing it ends playback and saves your place',
            ],
        },
    ],
    '1.0.650': [
        {
            title: 'Watchlist',
            items: [
                'Removing a title from your Watchlist now takes it out of the Watchlist row on Home, and off the Watchlist page, straight away instead of after the next refresh',
            ],
        },
    ],
    '1.0.649': [
        {
            title: 'Fire TV',
            items: [
                'The Home screen colour follows the artwork again on Fire TV: the fade at the bottom of the billboard matches the title in focus. It changes instantly rather than animating, so Home stays smooth',
            ],
        },
    ],
    '1.0.648': [
        {
            title: 'Menus',
            items: [
                'The clear logo at the top of the title menu is bigger and easier to read',
            ],
        },
    ],
    '1.0.647': [
        {
            title: 'Phone',
            items: [
                'Phone Settings now has the same tabs as the TV app, in the same places: Home, Home layout, Playback, Audio & subtitles, Display and Account. TV-only options are left out, and Save and Discard stay at the bottom of the screen',
                'Poster corners, Text size and Accent colour now actually change things on a phone',
                'Film and episode pages on a phone have a tidy action area: the Resume button with the next-episode button beside it, then one even row of round icons. Start from beginning is now a round icon like on TV',
            ],
        },
    ],
    '1.0.646': [
        {
            title: 'Phone',
            items: [
                'The Home loading screen on phones now matches the real Home: no big banner, small library chips, a wide Continue Watching row and three-across poster rows',
                'Settings → Titles on phones now has Poster corners, Text size and App font, which were only on TV',
            ],
        },
    ],
    '1.0.645': [
        {
            title: 'Watch Together',
            items: [
                'Finding your router to open the port is more reliable on phones: it asks over Wi-Fi specifically, asks the router directly, and tries each local address',
                'If no router answers, the message now says which address it looked from and what it heard, so the problem is easy to pin down',
            ],
        },
    ],
    '1.0.644': [
        {
            title: 'Watch Together',
            items: [
                'People in a Watch Together room now show their profile picture instead of just a letter',
            ],
        },
    ],
    '1.0.643': [
        {
            title: 'Watch Together',
            items: [
                'Fixed Watch Together sitting on "Connecting" forever when you start a room on your own device',
                'Starting a room now shows what it is doing, step by step, on a proper full-screen page with the film behind it. If it takes too long you get a message and a Try again button',
                'Pause and play now stay in sync on the TV player: when one person pauses or resumes, everyone else does too',
            ],
        },
    ],
    '1.0.642': [
        {
            title: 'Setup',
            items: [
                'First-run setup now keeps your choices: servers and libraries you switch off no longer come back on Home',
                'A server that connects slowly can no longer re-enable itself after you turned it off during setup',
            ],
        },
    ],
    '1.0.641': [
        {
            title: 'Screensaver',
            items: [
                'Clear logos on the screensaver are bigger and have a minimum size, so small or square ones like Ali G and the Idaho murders are easy to read',
            ],
        },
    ],
    '1.0.640': [
        {
            title: 'Details pages',
            items: [
                'Cleaner action row: Start from beginning and Trailer are now round icon buttons, and the Resume button is wider with slightly smaller text so "Resume • 33m left" stays on one line',
            ],
        },
    ],
    '1.0.639': [
        {
            title: 'Fire TV',
            items: [
                'Backdrops on Fire TV devices with 2 GB of memory now load at full 1080p, so they are as sharp as on other TVs. Devices with 1 GB keep the smaller size to stay smooth',
            ],
        },
    ],
    '1.0.638': [
        {
            title: 'Fire TV',
            items: [
                'Backdrops on Fire TV sticks are sharper: they load at a higher size and quality than before, while Home keeps its smooth, instant switching',
            ],
        },
    ],
    '1.0.637': [
        {
            title: 'Compatibility',
            items: [
                'The app can be installed again on Ethernet-only boxes and TVs that have no Wi-Fi radio',
            ],
        },
    ],
    '1.0.636': [
        {
            title: 'Details pages',
            items: [
                'The Resume button now has a progress ring at the start, like Plex, showing how far through you are',
            ],
        },
    ],
    '1.0.635': [
        {
            title: 'Details pages',
            items: [
                'The Resume button now shows how long is left, like Plex does: "Resume • 1h 39m left". On a show it follows the episode you are on',
            ],
        },
    ],
    '1.0.634': [
        {
            title: 'Profiles',
            items: [
                'Long profile names on the Who\'s watching screen now show in full, and the profile tiles are a little bigger',
            ],
        },
    ],
    '1.0.633': [
        {
            title: 'Profiles',
            items: [
                'Long profile names on the Who\'s watching screen now show in full instead of being cut off with "...", and the profile tiles are a little bigger',
            ],
        },
    ],
    '1.0.632': [
        {
            title: 'Watch Together',
            items: [
                'Watch Together no longer needs a relay: your device can host the room itself. Start a watch party and share the invite code; friends type it in and connect straight to you',
                'The app opens a port on your router by itself (UPnP) so friends outside your home can join. If your router does not allow that, friends on your Wi-Fi can still join, and the app tells you plainly how far the invite reaches',
                'If you have a relay set up and your device cannot be reached from outside, the relay is used instead so everyone can still join',
            ],
        },
    ],
    '1.0.631': [
        {
            title: 'Playback',
            items: [
                'Autoplay now moves on to the next episode at the end even when the player does not report the end of the stream (the Up Next card used to sit there until you pressed Play now)',
                'Fixed the top-left info sometimes showing the previous episode after the next one starts: a late update for the old episode can no longer overwrite the new one',
                'That same stale update could also report progress against the old episode, leaving it looking half watched until you refreshed the page',
            ],
        },
    ],
    '1.0.630': [
        {
            title: 'Screensaver',
            items: [
                'Continue Watching screensaver: movies now use their real background instead of the designed card picture, which could show as black',
                'A screensaver picture that fails to load is skipped instead of leaving a black screen',
            ],
        },
    ],
    '1.0.629': [
        {
            title: 'Libraries',
            items: [
                'Opening a library for the first time (Recommended tab) shows its rows much sooner: the rows appear first and the cover art, brand logos and extra details fill in right after',
            ],
        },
    ],
    '1.0.628': [
        {
            title: 'Home',
            items: [
                'Fixed the top of the studio or network logo being cut off above the title for shows with a lot of details (long synopsis, cast line, episode line); the details now have room to grow upward',
            ],
        },
    ],
    '1.0.627': [
        {
            title: 'Setup',
            items: [
                'First-time setup: pressing Left from the library list now moves to Continue to Home, so the setup can be finished with the remote',
            ],
        },
    ],
    '1.0.626': [
        {
            title: 'Smoother Home',
            items: [
                'Moving between titles and rows does much less work: studio and network logos are matched once instead of on every move, row positions are no longer measured on every press, and Home pages no longer re-render for nothing',
                'Title-page photos (cast and season pictures) are only loaded for the title you stop on, instead of for every nearby title, which cut about 70 image requests on every row change',
                'Background loading (title details, Home refreshes) now waits until the remote has been still for a moment, so it no longer lands in the middle of a row change',
            ],
        },
    ],
    '1.0.625': [
        {
            title: 'Home',
            items: [
                'Moving down from a 16:9 row to a poster row (or the other way) now slides smoothly into place instead of jumping and snapping',
            ],
        },
    ],
    '1.0.624': [
        {
            title: 'Home',
            items: [
                'Pressing Home in the side menu from far down the page now jumps straight back to the top row instead of flickering through every row on the way',
            ],
        },
    ],
    '1.0.623': [
        {
            title: 'Home',
            items: [
                'Continue Watching is refreshed from the server every time Home opens, so it can no longer get stuck on an old list (seen on Fire TV sticks, where the slower full refresh never finished)',
            ],
        },
    ],
    '1.0.622': [
        {
            title: 'Home',
            items: [
                'Fire TV sticks and low-memory TVs now move between Home rows instantly, with no slide or fades, so the rows can no longer jump or stutter there. Other TVs keep the full Plex-style glide',
                'Fixed the whole Home column (details and rows) getting dragged up the screen so the row below showed far too much: the Home area can no longer be scrolled by focus moves',
                'Home rows line up with the title and details again instead of sitting a long way to the right',
                'Going down a row now matches going up: the row you leave disappears at once instead of flying up the screen',
                'Fixed Home going down a row: the row you left no longer jumps to the top of the screen while it fades, it slides up smoothly with the rest',
                'Fixed the rows jumping up and down (and the row below popping in) as you move left and right between titles: the details above the rows no longer change where the rows sit',
                'On Fire TV sticks the Home background, details and colour now change together instead of one after another',
                'Fire TV sticks load a lighter background image, which stops backdrops drawing in torn or blocky strips when the stick runs short of graphics memory',
            ],
        },
    ],
    '1.0.621': [
        {
            title: 'Home',
            items: [
                'Fixed Home rows bouncing back and forth on Fire TV sticks and other slower TVs when moving up and down: the slide now carries on from exactly where it is, even when several presses arrive quickly',
                'Moving between titles no longer redraws every row of posters, which stalled the slide on slower sticks',
            ],
        },
    ],
    '1.0.620': [
        {
            title: 'Smoother on slower TVs',
            items: [
                'The Home background art cross-fades on the graphics chip instead of redrawing the whole screen on every frame, so moving between titles judders far less',
                'Posters and backgrounds are kept on the TV when you sign in through your portal too, so titles you have seen show instantly, even after a restart',
                'TVs that draw the app below 1080p, or have 2 GB of memory or less, load a lighter background image that looks the same on their screen',
                'Title logos remember their sizing between launches, so they appear straight away instead of popping in',
            ],
        },
    ],
    '1.0.619': [
        {
            title: 'Home',
            items: [
                'Rows now move like the official Plex app: the whole list glides up or down together, the row you leave fades away over the details, and the next row stays full size peeking in at the bottom',
            ],
        },
    ],
    '1.0.618': [
        {
            title: 'Home',
            items: [
                'Rows slide in fully drawn instead of fading in, and the row you leave clears straight away',
            ],
        },
    ],
    '1.0.617': [
        {
            title: 'Home',
            items: [
                'The row slide stays smooth when you press up or down quickly',
            ],
        },
    ],
    '1.0.616': [
        {
            title: 'Home',
            items: [
                'Moving up and down Home now glides: the next row slides smoothly into place while the one you left slides away and fades',
            ],
        },
    ],
    '1.0.615': [
        {
            title: 'Player',
            items: [
                'Skip intro stays on screen for the whole intro instead of disappearing after 10 seconds',
            ],
        },
    ],
    '1.0.614': [
        {
            title: 'View more',
            items: [
                'Moving back up to the top row brings the page title fully back into view',
            ],
        },
    ],
    '1.0.613': [
        {
            title: 'View more',
            items: [
                'View more pages (like Continue Watching) show full-size posters, the same size as on Home',
                'Episodes show their show’s poster there instead of a small still',
            ],
        },
    ],
    '1.0.612': [
        {
            title: 'Watch progress',
            items: [
                'Finished episodes and films now stay watched in Plex, instead of coming back as part-watched',
                'Stopping part-way saves your spot properly, so Resume and Continue Watching pick up where you left off',
                'Continue Watching moves on to the next episode after you finish one, matching Plex',
            ],
        },
    ],
    '1.0.611': [
        {
            title: 'Photos',
            items: [
                'Profile pictures show on Who’s watching again, with Plex’s default avatar when someone has no photo',
                'Cast photos load on title pages again',
            ],
        },
    ],
    '1.0.610': [
        {
            title: 'Google Play',
            items: [
                'StreamPilot is on Google Play for Android TV, Google TV and Shield',
            ],
        },
    ],
    '1.0.609': [
        {
            title: 'Housekeeping',
            items: [
                'Behind-the-scenes preparation for the Google Play release',
            ],
        },
    ],
    '1.0.608': [
        {
            title: 'Housekeeping',
            items: [
                'Small tidy-up to the more-than-one-server library fix from 1.0.602',
            ],
        },
    ],
    '1.0.607': [
        {
            title: 'Home',
            items: [
                'New titles and Continue Watching changes show up by themselves within about a minute and a half, without refreshing Home',
                'A title removed from Continue Watching stays removed until you watch it again, on Home and in libraries',
            ],
        },
    ],
    '1.0.606': [
        {
            title: 'More than one server',
            items: [
                'Home and the Watchlist are quick again: your own server\'s rows no longer wait for a friend\'s slower server, whose rows fill in moments later',
            ],
        },
        {
            title: 'Who\'s on screen',
            items: [
                'Faces it doesn\'t know show as "Who is this?": press OK to pick the person, and they\'re recognised from then on',
                'Hold OK on a name to correct it',
                'Matches against the show\'s whole cast, and lines faces up before comparing, so more people are named correctly',
            ],
        },
        {
            title: 'Settings',
            items: [
                'Turn off sidebar items you don\'t use: Watchlist, History, Live TV, Downloads and Search',
            ],
        },
    ],
    '1.0.605': [
        {
            title: 'Player',
            items: [
                'Audio and subtitles picked on the title page are the ones that play, instead of a language remembered by the player',
                'The controls stay up while you scroll through the cast strip',
                'Who\'s on screen only names someone when it is sure, so people missing from the cast list are no longer given a cast member\'s name',
            ],
        },
    ],
    '1.0.604': [
        {
            title: 'Subtitles',
            items: [
                'A title set to an external subtitle file (such as English SRT External) now plays with it, instead of the first subtitle inside the file',
            ],
        },
    ],
    '1.0.603': [
        {
            title: 'Libraries',
            items: [
                'All of a library\'s pinned rows load again: rows such as Recently Released, Top Rated or a genre were left out',
            ],
        },
    ],
    '1.0.602': [
        {
            title: 'More than one server',
            items: [
                'Fixed libraries opening as "This library is empty" with more than one server: the library address was read without decoding, so the app asked the wrong server for it',
            ],
        },
    ],
    '1.0.601': [
        {
            title: 'More than one server',
            items: [
                'Fixed every library showing empty with a friend\'s server added: servers took turns loading, and a library page stacked several 4-second waits until it gave up',
                'Servers load side by side again; each server\'s results are still pointed at that server, and anything not tied to a server goes to your own',
            ],
        },
    ],
    '1.0.600': [
        {
            title: 'More than one server',
            items: [
                'Fixed missing backdrops, clear logos and screensaver art with a friend\'s server added: your titles\' images were being pointed at the other server',
                'Every server\'s results now always link to that server\'s own address and access',
            ],
        },
    ],
    '1.0.599': [
        {
            title: 'More than one server',
            items: [
                'Your own servers now always come first; a friend\'s server listed first became the default for posters, item lookups and saved library links, and if it was slow or out of reach they all came back empty',
                'On start-up the app waits for one of your own servers instead of the first server to answer, so it no longer starts on a friend\'s server alone',
            ],
        },
    ],
    '1.0.598': [
        {
            title: 'More than one server',
            items: [
                'Fixed nothing loading from any server once you had access to a friend\'s server as well as your own',
                'Each server\'s rows, posters and playback now always go to that server: loading several at once had been mixing up their addresses and access keys',
            ],
        },
    ],
    '1.0.597': [
        {
            title: 'Who\'s on screen & cast strip',
            items: [
                'After opening an actor from the player, Back takes you straight back into the film where you left off (no resume prompt)',
                'Going somewhere else from the actor\'s page instead (another film, say) doesn\'t restart it',
            ],
        },
    ],
    '1.0.596': [
        {
            title: '4K playback fix',
            items: [
                'Fixed 4K (including Dolby Vision) failing with a decoding error while Who\'s on screen was on: the feature switched off the TV\'s tunneled video mode, which some 4K files need to play',
                'Who\'s on screen now leaves 4K films alone (they always play in the TV\'s best mode) and simply doesn\'t run on them; it still works on 1080p and below',
            ],
        },
    ],
    '1.0.595': [
        {
            title: 'Gentler on your server',
            items: [
                'Playback progress is reported to Plex at most every 3 seconds (always with the latest position); skipping through a film sent up to one report a second, which can stall a weak server',
                'Stopping still reports straight away',
            ],
        },
        {
            title: 'Emulator',
            items: [
                'The Android TV emulator runs the app natively again (the face libraries had forced it into ARM translation), which is the likely cause of 4K failing there',
            ],
        },
    ],
    '1.0.594': [
        {
            title: 'Player Back button',
            items: [
                'Back with the controls showing now hides them instead of leaving the film, on newer Android (16) too, where Back skipped the player and went straight to the overview',
                'The same fix makes Back close menus, the cast strip and the face labels one step at a time again',
            ],
        },
    ],
    '1.0.593': [
        {
            title: 'Player memory',
            items: [
                'Fixed the app restarting when you left the player after Who\'s on screen: it used so much memory that Android threw away the main screen',
                'Cast photos (strip and face matching) are now loaded at the size they\'re shown instead of full size, and the face model is read straight from the app rather than copied into memory',
                'The face model is unloaded when you leave the player',
            ],
        },
    ],
    '1.0.592': [
        {
            title: 'Who\'s on screen',
            items: [
                'No longer a test: pause and the actors in the picture are circled and named (Settings → Playback → Who\'s on screen)',
                'Left/Right pick someone (their label stays white, the rest dim) and OK opens their page; your place is saved',
                'OK with no one picked still resumes, and Up/Down still bring back the controls for seeking',
                'Cleaner look: no scores or timings, just a small "Finding who\'s on screen…" while it works and "No one recognised" when there\'s nobody to name',
            ],
        },
    ],
    '1.0.591': [
        {
            title: 'Who\'s on screen (test)',
            items: [
                'Only confident names are shown, all in the same clean style: no more dashed "?" guesses',
                'Names faces a little more readily, so people looking down or with eyes closed still get named',
                'Cast photos that fail to load are no longer re-downloaded on every pause',
            ],
        },
    ],
    '1.0.590': [
        {
            title: 'Who\'s on screen (test)',
            items: [
                'Much faster first pause: cast photos are shrunk before reading and use the quick face finder, and a shot with no faces skips the cast entirely',
                'Each actor\'s face is remembered on the device, so it is learned once ever rather than every time the app starts',
                'Shows progress while it learns ("learning the cast 5/17")',
            ],
        },
    ],
    '1.0.589': [
        {
            title: 'Settings',
            items: [
                'Who\'s on screen (test) is now in Settings → Playback on TV (it had landed in the Audio tab)',
            ],
        },
    ],
    '1.0.588': [
        {
            title: 'Who\'s on screen (test)',
            items: [
                'Shows a message the moment you pause ("paused, starting…") and at every later step, so it\'s clear where it stops',
                'Writes each step to the device log for troubleshooting',
            ],
        },
    ],
    '1.0.587': [
        {
            title: 'Who\'s on screen (test) fix',
            items: [
                'Fixed 4K films failing with a decoding error while the test was on: it decoded the film a second time, and TVs that allow one 4K decoder took the player\'s away',
                'It now copies the paused picture straight off the screen, only after you pause (never while a film is starting), and works with any stream, not just Direct Play',
                'With the test on, the player skips tunneled playback so the picture can be read; it takes effect from the next film you start',
            ],
        },
        {
            title: 'Player controls',
            items: [
                'If the controls ever stop responding (cog and seek bar unreachable), they now recover on the next press instead of staying stuck',
                'Back while the face labels are showing clears them instead of leaving the player',
            ],
        },
    ],
    '1.0.586': [
        {
            title: 'Playback fix',
            items: [
                'Fixed "This title cannot be played" and stuttering playback: starting a film or episode no longer loads the whole details page (seasons, extras and more) in the background for the cast strip',
                'The cast strip now uses the cast the app already has, and fetches any missing names with one small request 30 seconds into playback',
            ],
        },
    ],
    '1.0.585': [
        {
            title: 'Who\'s on screen (test)',
            items: [
                'New test setting under Playback: when you pause, the player looks at the picture and circles the actors it recognises from the cast photos, with their character',
                'Everything runs on the TV with your own Plex data; it needs Direct Play, and the first pause in a title takes a few seconds while it learns the cast',
                'A readout shows how long each step took, and faces it isn\'t sure of get a dashed circle with its best guess, so we can tune it',
            ],
        },
    ],
    '1.0.584': [
        {
            title: 'Player',
            items: [
                'Cast strip: with the controls showing, press Down again from the play/pause row to see who\'s in the film or episode, without pausing',
                'Episodes show that episode\'s guest stars first, then the show\'s main cast',
                'Left/Right move along it, Up, Down or Back close it, and OK opens that person\'s page (your place is saved)',
            ],
        },
    ],
    '1.0.583': [
        {
            title: 'Continue Watching',
            items: [
                'Continue Watching updates live again: after you watch something, or a new episode lands, it reorders to match Plex without touching Settings',
                'It only holds still while you\'re moving along the row, so cards never jump under the cursor',
            ],
        },
    ],
    '1.0.582': [
        {
            title: 'Continue Watching',
            items: [
                'Continue Watching now matches Plex\'s own order by default, so it shows the same titles as the Plex web app and official apps',
                'Every device switches to Match Plex once; pick another order in Settings → Continue Watching order and it sticks',
            ],
        },
    ],
    '1.0.581': [
        {
            title: 'History',
            items: [
                'New History page in the side menu: everything this profile has watched, newest first, grouped into Today, Yesterday, This week, Earlier this month, then by month',
                'TV shows appear once, dated by the last episode you watched',
                'Hide it with Settings → Show history',
            ],
        },
    ],
    '1.0.580': [
        {
            title: 'Memory',
            items: [
                'Live TV artwork loaded straight from a tuner and stacked studio logos now keep only the most recently used images, so long sessions don\'t keep growing',
            ],
        },
    ],
    '1.0.579': [
        {
            title: 'Speed',
            items: [
                'Library Recommended decodes each new background before swapping it in, like Home, so browsing never stalls on a big image',
                'Clear logos decode off the main thread',
                'The music chip updates once a second instead of four times',
            ],
        },
    ],
    '1.0.578': [
        {
            title: 'Errors',
            items: [
                'Collections, studio and network pages, cast pages and Live TV now show Retry and Back buttons when something fails to load, instead of a line of text with nothing to select',
            ],
        },
    ],
    '1.0.577': [
        {
            title: 'Loading',
            items: [
                'Collections, single playlists, "view all" pages and cast pages show skeletons while they load on TV instead of a blank screen',
            ],
        },
        {
            title: 'Focus',
            items: [
                'Buttons, menus, season tabs, choice sheets, the PIN pad and Live TV now highlight with a white fill and black text, like the nav, instead of an orange ring',
                'The picked season tab is a soft grey when not focused, so only the focused tab is white',
            ],
        },
        {
            title: 'Speed',
            items: [
                'Moving along a season\'s episodes only redraws the two cards that change, not the whole season',
                'Live TV: the info updates on every press, but the big background waits until you stop, so flicking through the guide stays smooth',
                'The performance meter (Settings → Display) now times every remote press on any page',
            ],
        },
    ],
    '1.0.576': [
        {
            title: 'Playlists',
            items: [
                'The Playlists page shows skeleton posters while it loads instead of a blank screen',
            ],
        },
    ],
    '1.0.575': [
        {
            title: 'Playlists',
            items: [
                'Playlists show a cover again: Plex\'s mosaic of the playlist\'s titles when it has no poster of its own',
            ],
        },
    ],
    '1.0.574': [
        {
            title: 'Live TV',
            items: [
                'Guide rows are slightly taller so two-line names have room to breathe',
            ],
        },
    ],
    '1.0.573': [
        {
            title: 'Live TV',
            items: [
                'Guide programme names wrap onto two lines so longer names show in full',
            ],
        },
    ],
    '1.0.572': [
        {
            title: 'Live TV',
            items: [
                'The Live TV banner background is framed higher so faces show instead of shirts',
            ],
        },
    ],
    '1.0.571': [
        {
            title: 'Player',
            items: [
                'The episode details now sit right under a smaller title logo instead of leaving a gap',
            ],
        },
    ],
    '1.0.570': [
        {
            title: 'Player',
            items: [
                'Very wide title logos in the player are smaller still (about a third of their old size)',
            ],
        },
    ],
    '1.0.569': [
        {
            title: 'Player',
            items: [
                'Wide title logos in the player are smaller again, about half their old size',
            ],
        },
    ],
    '1.0.568': [
        {
            title: 'Player',
            items: [
                'Very wide title logos in the player (like Gogglebox) are now sized the same way as on title pages instead of spanning half the screen',
            ],
        },
    ],
    '1.0.567': [
        {
            title: 'Home',
            items: [
                'Continue Watching catches up after you stop watching: it checks Plex again a few seconds later, so finished episodes drop off and progress updates even on slower servers',
            ],
        },
    ],
    '1.0.566': [
        {
            title: 'Screensaver',
            items: [
                'The Continue Watching screensaver now shows each show\'s current background instead of old artwork',
            ],
        },
    ],
    '1.0.565': [
        {
            title: 'Watchlist',
            items: [
                'Pressing Left from the first poster of any Watchlist row now opens the side menu instead of jumping to the row above',
            ],
        },
    ],
    '1.0.564': [
        {
            title: 'Home',
            items: [
                'Each library\'s Recently Added row now sits with that library\'s other rows, in your Library order',
            ],
        },
    ],
    '1.0.563': [
        {
            title: 'Home',
            items: [
                'Library order now sorts Home pins when they load (including collection rows), matching Settings → Layout',
            ],
        },
    ],
    '1.0.562': [
        {
            title: 'Home',
            items: [
                'Library order now places collection pins under the correct library (TV vs Movies and per-library)',
            ],
        },
    ],
    '1.0.561': [
        {
            title: 'Home',
            items: [
                'Library order in Settings now correctly regroups pinned Home rows (including collection pins)',
            ],
        },
    ],
    '1.0.560': [
        {
            title: 'Home',
            items: [
                'Collections that share only a “Streaming” Label no longer merge into one Home row',
            ],
        },
    ],
    '1.0.559': [
        {
            title: 'Common Sense Media',
            items: [
                'Movies use the same Plex Common Sense Media lookup as TV shows (including when the age is only on Plex’s metadata provider)',
            ],
        },
    ],
    '1.0.558': [
        {
            title: 'Common Sense Media',
            items: [
                'TV shows now show the Common Sense Media age rating on the title page and Home spotlight',
            ],
        },
    ],
    '1.0.557': [
        {
            title: 'Common Sense Media',
            items: [
                'Age rating uses the official Common Sense Media check and “age 7+” label style',
            ],
        },
    ],
    '1.0.556': [
        {
            title: 'Home',
            items: [
                'Spotlight description now uses the same width as the title-page synopsis (wider, fewer wrap lines)',
            ],
        },
    ],
    '1.0.555': [
        {
            title: 'Home',
            items: [
                'Spotlight synopsis matches the title-page description width so it wraps onto fewer lines',
            ],
        },
    ],
    '1.0.554': [
        {
            title: 'Home',
            items: [
                'Spotlight synopsis uses the same wider measure as title-page descriptions',
            ],
        },
    ],
    '1.0.553': [
        {
            title: 'Home & title pages',
            items: [
                'Spotlight and title-page meta / synopsis text is a little smaller',
            ],
        },
    ],
    '1.0.552': [
        {
            title: 'Home',
            items: [
                'Common Sense Media age rating now shows in the Home spotlight next to the content rating',
            ],
        },
    ],
    '1.0.551': [
        {
            title: 'Title pages',
            items: [
                'Common Sense Media uses the official open-ring check mark again (not the old closed circle)',
                'The year / runtime / rating row is slightly smaller',
            ],
        },
    ],
    '1.0.550': [
        {
            title: 'Home',
            items: [
                'Spotlight synopsis is one line shorter so studio and streaming logos are not cut off at the top',
            ],
        },
    ],
    '1.0.549': [
        {
            title: 'Title pages',
            items: [
                'Movie and show descriptions are a bit wider so more of the synopsis fits on one line',
            ],
        },
    ],
    '1.0.548': [
        {
            title: 'Title pages',
            items: [
                'Common Sense Media check mark shows again next to the age rating',
            ],
        },
    ],
    '1.0.547': [
        {
            title: 'Actor pages',
            items: [
                'Down on a person\'s filmography now moves through each title instead of jumping to the next decade',
                'Full filmography and on-server catalogues are no longer cut short',
            ],
        },
    ],
    '1.0.546': [
        {
            title: 'Title pages',
            items: [
                'Related-title posters match the Home row size again',
            ],
        },
    ],
    '1.0.545': [
        {
            title: 'Title pages',
            items: [
                'Common Sense Media uses its official icon',
            ],
        },
    ],
    '1.0.544': [
        {
            title: 'Title pages',
            items: [
                'Episode rating chips keep their spacing after the left-align fix',
            ],
        },
    ],
    '1.0.543': [
        {
            title: 'Title pages',
            items: [
                'Episode rating / date chips align to the left of the overview',
            ],
        },
    ],
    '1.0.542': [
        {
            title: 'Home',
            items: [
                'When several episodes of a show arrive together, the spotlight shows the show\'s overview instead of an empty description',
            ],
        },
    ],
    '1.0.541': [
        {
            title: 'Title pages',
            items: [
                'The episode / rating / date / runtime row on title pages is now the same larger size as on the home spotlight',
            ],
        },
    ],
    '1.0.540': [
        {
            title: 'Home',
            items: [
                'Long episode names in the spotlight show about nine more letters before they cut off',
            ],
        },
    ],
    '1.0.539': [
        {
            title: 'Home',
            items: [
                'The spotlight\'s episode / date line is now slightly larger than the description',
            ],
        },
    ],
    '1.0.538': [
        {
            title: 'Display',
            items: [
                '21 app fonts now: added Roboto (Google\'s Android font), Cinzel, Merriweather, Dancing Script, Fredoka, Special Elite (typewriter), Permanent Marker and Bangers (comic)',
                'Outfit was removed (it looked too much like the other sans fonts); if you had it, the app is back on the default font',
            ],
        },
    ],
    '1.0.537': [
        {
            title: 'Display',
            items: [
                'Seven more app fonts with very different styles: Playfair Display (elegant serif), Roboto Slab, JetBrains Mono (monospace), Oswald (condensed), Comfortaa (rounded), Orbitron (futuristic) and Caveat (handwritten)',
            ],
        },
    ],
    '1.0.536': [
        {
            title: 'Display',
            items: [
                'The App font picker now shows every font name in its own font, so you can see each style before choosing',
            ],
        },
    ],
    '1.0.535': [
        {
            title: 'Display',
            items: [
                'New App font setting: choose Inter, Outfit, Nunito, Montserrat, Lexend or Lora (or keep the default). Each choice previews in its own font',
            ],
        },
    ],
    '1.0.534': [
        {
            title: 'Display',
            items: [
                'The clock setting has a new choice, "On, no background": just the time in the corner, without the dark pill',
            ],
        },
    ],
    '1.0.533': [
        {
            title: 'Watchlist',
            items: [
                'The Watchlist page shows a skeleton poster grid while it loads instead of a blank screen',
            ],
        },
    ],
    '1.0.532': [
        {
            title: 'Settings',
            items: [
                'New Home layout tab: library order, home row order and which libraries show on Home now live together in their own tab',
            ],
        },
    ],
    '1.0.531': [
        {
            title: 'Home',
            items: [
                'Collections labelled "Network" are no longer merged into one home row',
            ],
        },
    ],
    '1.0.530': [
        {
            title: 'Settings',
            items: [
                'Settings options highlight like the side menu: a white fill with dark text instead of a ring (toggles keep their orange On)',
            ],
        },
    ],
    '1.0.529': [
        {
            title: 'Settings',
            items: [
                'The settings tabs across the top highlight the same way',
            ],
        },
    ],
    '1.0.528': [
        {
            title: 'Home',
            items: [
                'Small spotlight logos are another 15% bigger',
            ],
        },
    ],
    '1.0.527': [
        {
            title: 'Home',
            items: [
                'Small or square title logos in the home spotlight (like Match of the Day) are shown up to twice as big',
            ],
        },
    ],
    '1.0.526': [
        {
            title: 'Title pages',
            items: [
                'Very wide title logos (like Gogglebox) are shown smaller so they no longer dominate the page; normal logos are unchanged',
            ],
        },
    ],
    '1.0.525': [
        {
            title: 'Menus',
            items: [
                'Renamed the episode play options to "Play all from here" and "Play unwatched only" so the difference is clear',
            ],
        },
    ],
    '1.0.524': [
        {
            title: 'Menus',
            items: [
                'Rate now sits directly under the Resume / Play button in the TV menus',
            ],
        },
    ],
    '1.0.523': [
        {
            title: 'Episodes',
            items: [
                'Holding Select on the episode you\'re viewing now opens the exact same menu as its ⋯ button, including Go to show and Go to season',
            ],
        },
    ],
    '1.0.522': [
        {
            title: 'Episodes',
            items: [
                'Holding Select on an episode now opens the same menu as its ⋯ button: audio, subtitles, file info, refresh metadata and the rest in one place',
            ],
        },
    ],
    '1.0.521': [
        {
            title: 'Libraries',
            items: [
                'Studio and network pages show a skeleton poster grid while they load instead of a blank page',
            ],
        },
    ],
    '1.0.520': [
        {
            title: 'Libraries',
            items: [
                'Fixed studio logos that never appeared (20th Century) and Sony\'s logo losing its detail',
                'A slow or stuck logo now falls back to a plain white version instead of an empty tile',
            ],
        },
    ],
    '1.0.519': [
        {
            title: 'Libraries',
            items: [
                'Studio and network pages now include every label the brand files films under: Disney picks up Walt Disney Pictures, Lucasfilm, Touchstone and more; Prime Video picks up Amazon Studios and Amazon MGM',
                'Studio logos load much faster, and appear instantly after the first time',
            ],
        },
    ],
    '1.0.518': [
        {
            title: 'Libraries',
            items: [
                'White studio logos no longer turn into blank white boxes: solid backgrounds are removed and badges like DC keep their lettering',
            ],
        },
    ],
    '1.0.517': [
        {
            title: 'Libraries',
            items: [
                'Opening a library highlights the tab you land on (Recommended), not the last tab you used',
            ],
        },
    ],
    '1.0.516': [
        {
            title: 'Libraries',
            items: [
                'Studios no longer leaves a huge gap between the Networks and Studios rows',
                'Studio and network logos are white again',
                'The library tabs drop the underline; the current tab is the bright one',
            ],
        },
    ],
    '1.0.515': [
        {
            title: 'Libraries',
            items: [
                'Opening a studio or network from Studios now lists its titles (it was always empty on TV)',
                'Studios loads more reliably on slower servers and offers a retry instead of showing only a few tiles',
                'The library tabs highlight like the side menu: a white pill with dark text',
            ],
        },
    ],
    '1.0.514': [
        {
            title: 'Libraries',
            items: [
                'Studio and network logos keep their original colours instead of being turned white',
                'Movie libraries now show a Networks row on Studios too: Netflix, Prime Video, Apple TV+ and the other streamers your films come from',
            ],
        },
    ],
    '1.0.513': [
        {
            title: 'Libraries',
            items: [
                'Browse shows a skeleton poster grid while it loads, sized to match your grid',
            ],
        },
    ],
    '1.0.512': [
        {
            title: 'Performance',
            items: [
                'Moving through Browse is lighter: title details only load for the poster you stop on, not every poster you pass',
                'The Browse grid scrolls without repainting every poster on each step',
            ],
        },
    ],
    '1.0.511': [
        {
            title: 'Libraries',
            items: [
                'Studios now shows only the big studios, networks and streaming services, biggest first, instead of every studio A–Z',
                'Fixed big names like Warner Bros., Universal and Paramount missing from Studios on large libraries',
            ],
        },
    ],
    '1.0.510': [
        {
            title: 'Libraries',
            items: [
                'Recommended shows skeleton rows while it loads instead of a spinner',
                'Studios loads with placeholder tiles shaped like the studio grid',
            ],
        },
    ],
    '1.0.509': [
        {
            title: 'Libraries',
            items: [
                'The focus ring on the library tabs is no longer clipped at the top of the screen',
            ],
        },
    ],
    '1.0.508': [
        {
            title: 'Libraries',
            items: [
                'Fixed the library header still scrolling away on some TVs; pressing Up to the tabs always brings the header back into view',
            ],
        },
    ],
    '1.0.507': [
        {
            title: 'Libraries',
            items: [
                'The library header now stays fixed on every TV: only the area below it scrolls, so Up from the top row always lands on the tabs',
            ],
        },
    ],
    '1.0.506': [
        {
            title: 'Libraries',
            items: [
                'The library header now really stays pinned on TV (Browse, Collections and Studios), so Up from the top row always lands on a visible tab',
            ],
        },
    ],
    '1.0.505': [
        {
            title: 'Libraries',
            items: [
                'The library name, tabs and Browse toolbar stay pinned at the top; only the posters below scroll',
                'Pressing Up on Studios (and other poster grids) moves up one row instead of jumping to the tabs',
            ],
        },
    ],
    '1.0.504': [
        {
            title: 'Libraries',
            items: [
                'Studios tiles are smaller (four across) with no shadow on the logos',
                'Over 100 more studio, network and streaming logos (Lucasfilm, Touchstone, StudioCanal, FX, Syfy, Crunchyroll, Sky One and more)',
                'Scrolling down through Studios no longer gets stuck on the third row',
            ],
        },
    ],
    '1.0.503': [
        {
            title: 'Libraries',
            items: [
                'Studios is now a grid of wide tiles like Plex\'s Categories: each studio or network logo over a colour-washed backdrop from one of its titles',
                'Studios with a recognised logo come first (no more rows of obscure names), and each brand appears once',
            ],
        },
    ],
    '1.0.502': [
        {
            title: 'Libraries',
            items: [
                'Browse has a cleaner, Plex-style top: the library name and tabs on one line, then sort, Filters and the number of titles',
                'Every filter (genre, year, studio, actor and more, plus Unwatched, In progress, HDR and Duplicates) is in one Filters panel; active filters show as chips you can press to remove',
                'The filter row is no longer cut off at the left edge',
            ],
        },
    ],
    '1.0.501': [
        {
            title: 'TV',
            items: [
                'On View more and other poster grids, Left from the first poster in a row opens the side menu instead of jumping to the row above',
            ],
        },
    ],
    '1.0.500': [
        {
            title: 'Customise',
            items: [
                'New View more card setting: Blurred backdrop (new default), Poster mosaic, Stacked posters or Minimal',
                'The View more card now shows how many more titles are in the row',
            ],
        },
    ],
    '1.0.499': [
        {
            title: 'TV',
            items: [
                'View more opens straight away with the row\'s posters, then fills in the rest (no more blank screen)',
                'The full list is fetched once and shared with the View more card, so it is often instant',
            ],
        },
    ],
    '1.0.498': [
        {
            title: 'Live TV',
            items: [
                'The big panel no longer shows the poster behind it first: the backdrop fades in on its own',
            ],
        },
    ],
    '1.0.497': [
        {
            title: 'Live TV',
            items: [
                'Programme backdrops now come from Plex itself (your Plex sign-in), so they show without any extra setup',
            ],
        },
    ],
    '1.0.496': [
        {
            title: 'Live TV',
            items: [
                'The big panel at the top shows the programme\'s wide backdrop behind it, not a stretched poster, when one can be found',
            ],
        },
    ],
    '1.0.495': [
        {
            title: 'Display',
            items: [
                'Closed side menu: blend into the background (default) or keep the dark panel (Settings → Display)',
            ],
        },
    ],
    '1.0.494': [
        {
            title: 'TV',
            items: [
                'The side menu blends into the background while closed, and turns dark only when you open it',
                'With the side menu set to icons only, opening it no longer pushes the page across',
            ],
        },
    ],
    '1.0.493': [
        {
            title: 'TV',
            items: [
                'The side menu is back to the small rounded pill',
                'Poster corners only changes posters and episode cards, not spacing elsewhere',
            ],
        },
    ],
    '1.0.492': [
        {
            title: 'TV',
            items: [
                'Starts up a little faster: title pages now load in the background after Home is ready',
            ],
        },
    ],
    '1.0.491': [
        {
            title: 'Display',
            items: [
                'Choose which ratings show on title pages: IMDb, Rotten Tomatoes critics, Rotten Tomatoes audience, TMDB and TVDB, each on or off (Settings → Display)',
            ],
        },
    ],
    '1.0.490': [
        {
            title: 'Display',
            items: [
                'Focus ring thickness: thin, normal or thick (Settings → Display)',
            ],
        },
    ],
    '1.0.489': [
        {
            title: 'Display',
            items: [
                'Accent colour now only changes the ring around the poster, episode or setting you are on; everything else keeps its usual colours',
                'The clock is hidden on the Settings pages',
            ],
        },
    ],
    '1.0.488': [
        {
            title: 'Make it yours (Settings → Display)',
            items: [
                'Poster corners: square, slightly rounded or rounded',
                'Text size: small, medium or large (posters keep their size)',
                'Side menu: icons and names, or icons only',
                'Show or hide the clock',
            ],
        },
        {
            title: 'Player (Settings → Playback)',
            items: [
                'Choose how far Left and Right skip: 5, 10, 15, 30 or 60 seconds, set separately',
                'Choose how long the controls stay up: 3, 5, 10 or 15 seconds',
            ],
        },
        {
            title: 'Screensaver',
            items: [
                'New styles: Pan and zoom, and Clock only',
                'Choose when it starts (1 to 30 minutes) and how long each picture stays up',
            ],
        },
    ],
    '1.0.487': [
        {
            title: 'Make it yours',
            items: [
                'The accent colour now also changes the focus ring round posters and episodes, menus, tabs and row markers',
                'New White accent colour',
                'Progress bars always stay orange, whatever accent you pick',
            ],
        },
    ],
    '1.0.486': [
        {
            title: 'Make it yours',
            items: [
                'Accent colour: pick gold, orange, red, pink, purple, blue, teal or green for focus, buttons and progress bars, in the app and the player (Settings → Display)',
                'Navigation sounds: Soft, Click, Pop, Chime or Retro when you move, select and go back. Off unless you turn them on',
            ],
        },
        {
            title: 'Player',
            items: [
                'A new Up Next card: the episode still, season and episode, runtime, a short synopsis and a countdown ring',
            ],
        },
    ],
    '1.0.485': [
        {
            title: 'TV',
            items: [
                'The PIN screen has a solid background, instead of the screen behind showing through split in half',
            ],
        },
    ],
    '1.0.484': [
        {
            title: 'Continue Watching',
            items: [
                'The row re-sorts each time you come back to Home or a library, so what you just watched moves to its place',
                '"Match Plex" puts new episodes where Plex does, instead of at the end',
                'Next Up episodes sort correctly under "Recently watched", "Watched longest ago" and Movies / TV first',
            ],
        },
    ],
    '1.0.483': [
        {
            title: 'TV',
            items: [
                'Focus no longer jumps back for a moment after a screen opens while you are already moving with the remote',
            ],
        },
        {
            title: 'App',
            items: [
                'Information messages show in grey instead of red, so they no longer look like errors',
            ],
        },
    ],
    '1.0.482': [
        {
            title: 'Home',
            items: [
                'Continue Watching on a library page now matches Home (Plex\'s own list, just that library\'s titles)',
            ],
        },
        {
            title: 'TV',
            items: [
                'Home tries again by itself if your rows fail to load, spaced out so a busy server is not overloaded',
            ],
        },
        {
            title: 'Live TV',
            items: [
                'Change channel without leaving the player: CH+ / CH− on the remote, or Up / Down while the controls are hidden',
            ],
        },
    ],
    '1.0.481': [
        {
            title: 'TV',
            items: [
                'Recently Added rows (e.g. "Recently Added in Movies") no longer appear twice on Home',
            ],
        },
    ],
    '1.0.480': [
        {
            title: 'TV',
            items: [
                'Test build: work on repeated Recently Added rows on Home',
            ],
        },
    ],
    '1.0.479': [
        {
            title: 'TV',
            items: [
                'Test build: work on repeated Recently Added rows on Home',
            ],
        },
    ],
    '1.0.478': [
        {
            title: 'Home',
            items: [
                'Continue Watching shows the same list and order as the official Plex apps, including Next Up episodes',
            ],
        },
    ],
    '1.0.477': [
        {
            title: 'App',
            items: [
                'Back to the 1.0.474 build while Continue Watching was reworked',
            ],
        },
    ],
    '1.0.476': [
        {
            title: 'Home',
            items: [
                'Test build: Continue Watching from Plex\'s own list',
            ],
        },
    ],
    '1.0.475': [
        {
            title: 'Home',
            items: [
                'Test build: Continue Watching from Plex\'s own list',
            ],
        },
    ],
    '1.0.474': [
        {
            title: 'TV',
            items: [
                'Match frame rate no longer knocks audio out of sync (uses display mode instead of forced HDMI renegotiation)',
            ],
        },
    ],
    '1.0.473': [
        {
            title: 'TV',
            items: [
                'Plex Home PIN pad feels snappier when entering digits',
            ],
        },
    ],
    '1.0.472': [
        {
            title: 'TV',
            items: [
                'Audio stays in sync more reliably (tunneled playback, fewer HDMI refresh switches, resync after long rebuffers)',
            ],
        },
    ],
    '1.0.471': [
        {
            title: 'TV',
            items: [
                'Play bar seek keeps working after a scrub (no more one-shot seek)',
            ],
        },
    ],
    '1.0.470': [
        {
            title: 'TV',
            items: [
                'Play bar seek works more than once (forward and back)',
            ],
        },
    ],
    '1.0.469': [
        {
            title: 'TV',
            items: [
                'Play bar seek works more than once (forward and back)',
            ],
        },
    ],
    '1.0.468': [
        {
            title: 'Phone',
            items: [
                'Scrollbars stay hidden in the app (WebView chrome too)',
                'Home and library row titles are smaller',
            ],
        },
    ],
    '1.0.467': [
        {
            title: 'TV',
            items: [
                '16:9 hero cards are a little larger',
            ],
        },
    ],
    '1.0.466': [
        {
            title: 'Phone',
            items: [
                '16:9 hero cards and the Home hero are a little larger',
                'Scrollbars stay hidden while you still scroll',
            ],
        },
    ],
    '1.0.465': [
        {
            title: 'TV',
            items: [
                'Theme tunes play once instead of looping',
                'Home billboard descriptions stop after four lines so logos stay clear; the title page still shows the full synopsis',
                'On Now Home billboard uses the show or movie backdrop instead of a stretched poster',
                'Next Home row title sits a little farther below the row above',
                'Home left and right is smoother on TV sticks',
            ],
        },
    ],
    '1.0.464': [
        {
            title: 'TV',
            items: [
                'Theme tunes play once instead of looping',
            ],
        },
    ],
    '1.0.463': [
        {
            title: 'TV',
            items: [
                'Home billboard descriptions stop after four lines so logos stay clear; the title page still shows the full synopsis',
            ],
        },
    ],
    '1.0.462': [
        {
            title: 'TV',
            items: [
                'Home billboard descriptions are no longer cut off mid-sentence',
            ],
        },
    ],
    '1.0.461': [
        {
            title: 'TV',
            items: [
                'On Now Home billboard uses the show or movie backdrop instead of a stretched poster',
                'Next Home row title sits a little farther below the row above',
            ],
        },
    ],
    '1.0.460': [
        {
            title: 'TV',
            items: [
                'Home billboard description text is a little larger',
            ],
        },
    ],
    '1.0.459': [
        {
            title: 'TV',
            items: [
                'Home left and right is smoother on TV sticks: fewer disk writes while scrubbing, less work checking backdrop readiness, and no duplicate title metadata fetches',
            ],
        },
    ],
    '1.0.458': [
        {
            title: 'TV',
            items: [
                'Episode screens show loading placeholders while the season list is fetching',
                'Episode and title pages show season, rating, date, and length as plain text, with pills kept on IMDb and TMDB',
                'Home left and right is lighter on TV sticks',
            ],
        },
    ],
    '1.0.457': [
        {
            title: 'TV',
            items: [
                'Home left and right is lighter: fewer images warm ahead of time, and moving across a row no longer rebuilds the whole page',
            ],
        },
    ],
    '1.0.456': [
        {
            title: 'TV',
            items: [
                'Home up and down is back to the previous row layout',
            ],
        },
    ],
    '1.0.455': [
        {
            title: 'TV',
            items: [
                'Episode screens show loading placeholders in the same size as episode stills while the season list is fetching',
                'Episode and title pages show season, rating, date, and length as plain text, with pills kept on IMDb and TMDB',
            ],
        },
    ],
    '1.0.450': [
        {
            title: 'TV',
            items: [
                'Episode and title pages show season, rating, date, and length as plain text, with pills kept on IMDb and TMDB',
            ],
        },
    ],
    '1.0.449': [
        {
            title: 'TV',
            items: [
                'Episode screens show loading placeholders in the same size as episode stills while the season list is fetching',
            ],
        },
    ],
    '1.0.447': [
        {
            title: 'Home',
            items: [
                'Continue Watching updates after you finish or stop watching, without restarting the app',
            ],
        },
    ],
    '1.0.446': [
        {
            title: 'Home',
            items: [
                'Random rows keep their order while you browse, and only reshuffle when you open Home or pull to refresh',
            ],
        },
    ],
    '1.0.445': [
        {
            title: 'Phone',
            items: [
                'Title pages drop the line of text under the logo that the pills already show',
            ],
        },
    ],
    '1.0.444': [
        {
            title: 'Phone',
            items: [
                'Opening a Recently Added row shows its titles instead of "This library is empty"',
                'The title page button says Watch, in the same font as the TV app',
                'Poster names on Home are a little smaller',
                'Match page colour to artwork can be switched on or off in Settings',
            ],
        },
    ],
    '1.0.443': [
        {
            title: 'Phone',
            items: [
                'Home is poster rows only, like Plex mobile: bigger row titles in the TV font, the server name under library rows, and posters that run to the edge of the screen',
                'Posters show the show and episode (S1 • E1) or the rating and resolution for movies',
                'Title pages have round action buttons and smaller pills, without the IMDb / TMDB / TVDB links',
                'Settings switches line up next to their labels, and the 24-hour clock can be set on phones',
                '"Did you know?" trivia loads more reliably',
            ],
        },
    ],
    '1.0.442': [
        {
            title: 'Playback',
            items: [
                'Updated the video player engine (Media3 1.11) for the latest playback fixes and format support',
            ],
        },
    ],
    '1.0.441': [
        {
            title: 'Playback',
            items: [
                'The audio pill in the player bar shows the channel layout too, for example AC3 5.1 or AAC 2.0',
            ],
        },
    ],
    '1.0.440': [
        {
            title: 'Playback',
            items: [
                'Finishing an episode or movie counts as one play on your server, not three',
                'The player bar shows the video and audio codec (for example HEVC and EAC3) after the resolution',
            ],
        },
    ],
    '1.0.439': [
        {
            title: 'Playback',
            items: [
                'Finished episodes no longer show the last part left to watch when your server is slow to keep up',
            ],
        },
    ],
    '1.0.437': [
        {
            title: 'Playback',
            items: [
                'Playback no longer starts paused when the OK press that opened the player is released inside it',
                'A paused player stops sending your server a progress update every second, which could slow or stall busy servers',
            ],
        },
    ],
    '1.0.436': [
        {
            title: 'Playback',
            items: [
                'TV episodes start playing instead of opening paused from leftover Play/OK or show theme audio',
            ],
        },
        {
            title: 'Subtitles',
            items: [
                'Movie and episode pages follow your Subtitles setting: with Always on, a full subtitle track is picked (and played) instead of showing Off',
                'Playback errors now say what actually failed (for example a connection reset), to help track down Direct Play problems',
            ],
        },
    ],
    '1.0.434': [
        {
            title: 'App',
            items: [
                'Updated for current Google Play Android requirements (Android 7 or newer)',
            ],
        },
    ],
    '1.0.433': [
        {
            title: 'People',
            items: [
                'Actor profiles use the matching person for bio, dates, and filmography instead of mixing in someone with a similar name',
            ],
        },
    ],
    '1.0.432': [
        {
            title: 'Home',
            items: [
                'On Now can be moved in Settings → Home row order, with Continue Watching and Recently Added',
            ],
        },
    ],
    '1.0.431': [
        {
            title: 'Home',
            items: [
                'On Now posters on Home show Tunarr artwork instead of Poster Not Found',
            ],
        },
    ],
    '1.0.430': [
        {
            title: 'Home',
            items: [
                'On Now posters on Home load Tunarr artwork over http on the LAN (they used to stay blank on https)',
                'Pressing an On Now card on TV Home starts the channel instead of opening a details page',
            ],
        },
    ],
    '1.0.427': [
        {
            title: 'Continue Watching',
            items: [
                'More Continue Watching orders (Settings → Home): Z to A, Oldest released, Watched longest ago, Recently added, Almost finished, Just started, Least time left, Movies first and TV shows first',
                'Remove from Continue Watching now really removes it on your Plex server, so it no longer comes back when Home reloads',
            ],
        },
    ],
    '1.0.426': [
        {
            title: 'Live TV',
            items: ['The Guide has a small gap between shows in each channel row'],
        },
    ],
    '1.0.425': [
        {
            title: 'Live TV',
            items: [
                'The Live TV billboard shows much more about each programme: age rating, times, length, genres, picture quality, season and episode, a New tag for premieres, the summary and who stars in it',
                'The Guide billboard now shows the summary too, and minutes left sit beside the progress bar',
            ],
        },
    ],
    '1.0.424': [
        {
            title: 'Live TV',
            items: [
                'New Live TV look: a big billboard for whatever you are on (live badge, minutes left, summary, progress, poster)',
                'On Now shows a poster for every channel, then an Up next row; OK on an On Now poster starts the channel',
                'Remote: Down from Guide / On Now goes straight to the first programme; Up and Down in the guide move to what is on at the same time on the next channel',
                'Programme posters show properly (episodes showed the channel logo), and channel names no longer repeat the number',
            ],
        },
    ],
    '1.0.423': [
        {
            title: 'Live TV',
            items: [
                'Live TV channels play again (they stopped with ERROR_CODE_IO_BAD_HTTP_STATUS): the stream now asks your server for the live feed under the same name the tune used',
            ],
        },
    ],
    '1.0.422': [
        {
            title: 'Subtitles',
            items: [
                'PGS subtitles stay on when the stream transcodes (for example 720p): they are burned into the picture, because HLS cannot carry PGS',
            ],
        },
        {
            title: 'Player',
            items: [
                'The black loading screen now says Playback is starting..., not Loading the next episode',
                'Seeking while transcoding works again, forwards and backwards: the picture holds for a moment, then plays from where you seeked to instead of carrying on from before',
            ],
        },
    ],
    '1.0.421': [
        {
            title: 'Player',
            items: [
                'The bottom bar now shows three matching pills in the centre: Direct Play, resolution, and the subtitle format in use (PGS, SRT, and so on)',
                'The subtitle pill hides when subtitles are Off',
            ],
        },
    ],
    '1.0.420': [
        {
            title: 'Subtitles',
            items: [
                'PGS tracks now show in Select Subtitles, labelled like English (PGS), including when Plex only tags them as S_HDMV/PGS',
                'This app tells Plex it can Direct Play PGS and VobSub, so those tracks are no longer hidden from the list',
            ],
        },
    ],
    '1.0.415': [
        {
            title: 'Subtitles',
            items: [
                'PGS, VobSub and DVB subtitles now Direct Play: the TV draws them itself like Plex does, so no more transcoding the whole film for subtitles',
                'The subtitle picked in Plex for a film or episode is used by default, and the movie page shows it instead of Off',
                'Settings → Burn-in → Image still burns picture subtitles in, for TVs that draw them badly',
            ],
        },
    ],
    '1.0.414': [
        {
            title: 'Trailers',
            items: [
                'While a trailer plays behind a movie or show page, an arrow pulses at the top. Press Up from the Watch row to watch it full screen, carrying straight on with no buffering',
                'Full screen: OK pauses, Back or Down goes back to the page',
            ],
        },
    ],
    '1.0.413': [
        {
            title: 'Live TV',
            items: [
                'Live TV channels now play: the stream goes through your server the same way Plex does it',
                'The guide shows each channel’s name and logo from your server, with its programmes',
            ],
        },
    ],
    '1.0.412': [
        {
            title: 'Track picker',
            items: [
                'The Select Subtitles / Select Audio box on TV is much taller, and the focused row no longer ends up half cut off while you scroll',
                'The chosen track has a tick instead of a filled row, so it no longer looks like a second focus ring',
            ],
        },
    ],
    '1.0.411': [
        {
            title: 'Subtitles',
            items: [
                'Picking a PGS or other picture subtitle (like English Forced) now plays that track. Before, only SRT choices were kept',
                'Subtitle lists show the format, e.g. English Forced (PGS) or English (SRT)',
                'Forced subtitles turn on even when the film only has them as PGS',
            ],
        },
    ],
    '1.0.410': [
        {
            title: 'Movie pages',
            items: [
                'Movie pages on TV show the file and track pills (resolution, codecs, audio and subtitles) at the end of the Watch row, the same as episodes',
            ],
        },
    ],
    '1.0.409': [
        {
            title: 'Fixes',
            items: [
                'Search shows matching shows and movies first, then people, then episodes',
                'On episode and season pages the show logo no longer overlaps the network logo above it',
            ],
        },
    ],
    '1.0.408': [
        {
            title: 'Lighter billboard',
            items: [
                'Settings → Display → Lighter billboard: for slower TV sticks, the Home art switches instantly instead of fading, keeps one background colour and loads a smaller image',
                'Home art now finishes decoding before it swaps in, so the swap frame is lighter on every device',
            ],
        },
    ],
    '1.0.407': [
        {
            title: 'Smoother rows',
            items: [
                'Moving up and down rows on Home and library homes does about half the work: only the new row slides in, and the background colour changes in a few steps instead of repainting the whole screen every frame',
                'The performance meter now also notices the Android Remove animations setting',
            ],
        },
    ],
    '1.0.406': [
        {
            title: 'Diagnostics',
            items: [
                'Settings → Display → Performance meter shows how smooth each row change is (slowest frame and dropped frames), with test switches to hide the billboard art or the poster grow',
            ],
        },
    ],
    '1.0.405': [
        {
            title: 'Performance',
            items: [
                'Moving up and down between rows on Home and library pages is much smoother: the rows either side are built while the remote is still, so a press only slides them into place',
                'Long-press menus are only created when you open one, so each row has far less to set up',
                'The billboard waits for a row to finish sliding before changing its picture and colour, so the TV is not doing everything at once',
                'Library pages hold off loading artwork while you are still moving, like Home',
            ],
        },
        {
            title: 'Look',
            items: [
                'Long-press and options menus use the same font as the clock on every page',
            ],
        },
    ],
    '1.0.400': [
        {
            title: 'Live TV',
            items: [
                'Live channels play through your Plex server, instead of trying to reach the tuner directly (which failed with a connection error)',
            ],
        },
    ],
    '1.0.399': [
        {
            title: 'Live TV',
            items: [
                'The Guide now asks your Plex server for the right guide, so programmes and channel names should appear',
                'Watching a channel finds the live stream in Plex’s reply, and tries each of the channel’s ids if the first is refused',
            ],
        },
    ],
    '1.0.398': [
        {
            title: 'Live TV',
            items: [
                'New Live TV in the sidebar when your Plex server has a DVR (Tunarr, HDHomeRun or similar): a Guide with channels, logos and a now line, plus an On Now row',
                'The Guide reads programmes straight from your Plex Media Server’s guide, so it matches what Plex shows',
                'Pick a programme for its details, then Watch to tune the channel',
            ],
        },
    ],
    '1.0.395': [
        {
            title: 'Playback',
            items: [
                'The "Select version" box matches the new Resume box: the title’s artwork and logo, and one row per file showing its resolution, video / HDR / audio formats and bitrate',
            ],
        },
    ],
    '1.0.394': [
        {
            title: 'Playback',
            items: [
                'The "Resume playback?" box is redesigned: the title’s artwork and logo, a progress bar with where you left off and the time left, and Resume, Start over and close in one row',
            ],
        },
    ],
    '1.0.393': [
        {
            title: 'Look',
            items: [
                'The titles and details under Extras use the same font as the rest of the title page',
            ],
        },
    ],
    '1.0.392': [
        {
            title: 'Player',
            items: [
                'Next to the time, the player shows how far ahead it has buffered (for example "42s buffered"); on a long film the band on the seek bar is too short to see',
            ],
        },
    ],
    '1.0.391': [
        {
            title: 'Player',
            items: [
                'The selected play and settings buttons are no longer cut off at the edges when they grow',
            ],
        },
    ],
    '1.0.390': [
        {
            title: 'Player',
            items: [
                'The seek bar shows how far ahead the video has buffered, as a lighter band past the playhead',
            ],
        },
    ],
    '1.0.389': [
        {
            title: 'Look',
            items: [
                'The Trailer button and the cast names and roles on title pages use the same font as Resume and Start from beginning',
            ],
        },
    ],
    '1.0.388': [
        {
            title: 'Player',
            items: [
                'Much easier to see where you are with the remote: the selected button turns solid white and grows a little, and the seek bar thickens with a bigger, glowing handle when it is selected',
            ],
        },
    ],
    '1.0.387': [
        {
            title: 'Profiles',
            items: [
                'Picking a profile gets you to Home much faster: the server that worked last time is checked first, and a slow or offline server no longer holds everything up (it joins when it answers)',
            ],
        },
    ],
    '1.0.386': [
        {
            title: 'Player',
            items: [
                'The badge at the bottom now shows what is really happening: Direct Play, Direct Stream, or what Plex is transcoding (for example "Transcoding video, audio, subs")',
                'It no longer says Direct Play when the player has switched to a transcode',
                'The close button under the clock is gone; Back closes the player',
            ],
        },
    ],
    '1.0.385': [
        {
            title: 'Episodes',
            items: [
                'On an episode or season page, the watched button marks only the episode you are on. Marking a whole season or show is in the season and show menus',
                'The E1, E2… badges on episode cards use the same font as the clock',
            ],
        },
    ],
    '1.0.384': [
        {
            title: 'Player',
            items: [
                'A resolution badge (4K, 1080p, 720p…) sits next to Direct Play, showing what is actually playing; both badges are centred at the bottom',
                'The title and episode line in the top left use the same font as the clock on Home',
            ],
        },
    ],
    '1.0.383': [
        {
            title: 'Look',
            items: [
                'The info line on Home, the info and score pills, the video / audio / subtitle pills and the Cast & Crew heading on episode pages all use the clock font',
            ],
        },
    ],
    '1.0.382': [
        {
            title: 'Look',
            items: [
                'The Watched pill on Home and the episode name under the logo on episode pages use the same font as the clock',
            ],
        },
    ],
    '1.0.381': [
        {
            title: 'Performance',
            items: [
                'The app starts faster again: Settings, library browsing, people pages and the web player now load after Home instead of before it',
                'Working out the billboard colour uses a small copy of the artwork instead of a full-size one, so moving around Home uses less memory',
                'The clock updates once a minute instead of every second',
            ],
        },
    ],
    '1.0.380': [
        {
            title: 'Home',
            items: [
                'The billboard keeps up better when you move between posters: the artwork and the fade colour change faster',
            ],
        },
    ],
    '1.0.379': [
        {
            title: 'Home',
            items: [
                'The billboard fade no longer flashes brighter for a moment when it changes colour between titles: it now eases straight to the new colour',
            ],
        },
    ],
    '1.0.378': [
        {
            title: 'Look',
            items: [
                'Studio, network and streaming service logos no longer have a drop shadow either',
            ],
        },
    ],
    '1.0.377': [
        {
            title: 'Look',
            items: [
                'Title logos no longer have a drop shadow behind them, on Home, title pages and the screensaver',
            ],
        },
    ],
    '1.0.376': [
        {
            title: 'Title pages',
            items: [
                'Episode and season pages show the same info pills as shows and movies (episode, rating, air date, runtime, scores), following the episode you are on',
            ],
        },
    ],
    '1.0.375': [
        {
            title: 'Title pages',
            items: [
                'The info pills (rating, year, runtime, scores) have bigger text, so they are easier to read on a TV',
                'Play, Resume, Start and Start from beginning use the same font as the clock',
            ],
        },
    ],
    '1.0.374': [
        {
            title: 'Home',
            items: [
                'No more hard line under the first row while the billboard changes: the artwork now fades smoothly into the background',
            ],
        },
        {
            title: 'Search',
            items: [
                'Search is redesigned: a compact A–Z keyboard on the left, results on the right as you type',
                'With nothing typed, search shows everything you have searched before, plus the titles you opened from search; pick one to search it again, or clear the history',
                'Right from the keyboard goes straight into the results, and Left or Back returns to the key you were on',
            ],
        },
    ],
    '1.0.373': [
        {
            title: 'Performance',
            items: [
                'Styles that were defined twice are now defined once, so the app has less to load and match on every screen, with no change to how anything looks',
            ],
        },
    ],
    '1.0.372': [
        {
            title: 'Performance',
            items: [
                'Moving between titles on Home is smoother on slower devices: the billboard colour now cross-fades instead of redrawing the whole screen on every frame',
                'The app’s stylesheet is about a third smaller, so screens update with less work',
            ],
        },
    ],
    '1.0.371': [
        {
            title: 'Performance',
            items: [
                'The app starts faster: it now loads about a third as much code before Home, with other languages and the web video player fetched only when needed',
                'Opening a title is lighter on slower devices: the backdrop fade and the season tabs no longer use costly graphics effects, with the same look',
            ],
        },
    ],
    '1.0.370': [
        {
            title: 'Home',
            items: [
                'The row peeking in at the bottom of Home now reaches the bottom of the screen, with everything above it in the same place',
            ],
        },
    ],
    '1.0.369': [
        {
            title: 'Home',
            items: [
                'The rows on Home sit back in their original place, with the next row peeking in at the bottom as before',
            ],
        },
    ],
    '1.0.368': [
        {
            title: 'Home',
            items: [
                'The rows on Home are back in their usual place; only the bottom row now runs on to the edge of the screen',
            ],
        },
    ],
    '1.0.367': [
        {
            title: 'Home',
            items: [
                'The row peeking at the bottom of Home now runs to the bottom edge of the screen instead of stopping short',
            ],
        },
    ],
    '1.0.366': [
        {
            title: 'Home',
            items: [
                'Hide spoilers no longer blurs show posters on Home — only an unwatched episode’s own still image is blurred',
            ],
        },
    ],
    '1.0.365': [
        {
            title: 'TV',
            items: [
                'Who’s watching?: the selected profile just gets the orange ring round its picture, no extra box',
            ],
        },
    ],
    '1.0.364': [
        {
            title: 'TV',
            items: [
                'Make Home yours: switching a server on or off keeps the focus on that server instead of jumping to Continue',
            ],
        },
    ],
    '1.0.363': [
        {
            title: 'Home',
            items: [
                'The billboard fade reaches further across, so the title, details and description stay easy to read on bright artwork',
            ],
        },
    ],
    '1.0.362': [
        {
            title: 'TV',
            items: [
                'Make Home yours: Continue gets a white outline when selected, and the remote can reach Clear all / Heart all',
            ],
        },
    ],
    '1.0.361': [
        {
            title: 'TV',
            items: [
                'A restyled "Who’s watching?" profile picker to match sign-in and the PIN pad: big round avatars, no boxes',
            ],
        },
    ],
    '1.0.360': [
        {
            title: 'Sign in',
            items: [
                'The first-run setup is redesigned: bold library cards with hearts, a live count, Heart all, over the poster wall',
            ],
        },
    ],
    '1.0.359': [
        {
            title: 'TV',
            items: [
                'A simpler Plex Home PIN pad: round number keys, four dots, no border — it signs in on the 4th digit',
            ],
        },
    ],
    '1.0.358': [
        {
            title: 'Sign in',
            items: [
                'A brand-new sign-in screen: a moving poster wall, a bold headline and a clear Sign in with Plex button',
            ],
        },
    ],
    '1.0.357': [
        {
            title: 'Sign in',
            items: [
                'Sign in is Plex only — the StreamPilot portal option is gone',
                'The sign-in button uses the same font as the clock',
            ],
        },
    ],
    '1.0.356': [
        {
            title: 'Home',
            items: [
                'After signing in, choose which servers to use and heart the libraries you want on Home — like the Plex app',
                'Settings → Home → Libraries on Home: an empty heart keeps that library’s pinned collections and Recently Added off Home (Home still follows what is pinned in Plex)',
            ],
        },
    ],
    '1.0.355': [
        {
            title: 'Multiple servers',
            items: [
                'With more than one Plex server, a poster no longer shows or opens a different title from another server that happens to share its ID',
            ],
        },
    ],
    '1.0.354': [
        {
            title: 'TV',
            items: [
                'The audio and subtitle chips on an episode show what will actually play — your choice for the show (e.g. subtitles Off), then your language and subtitle settings',
            ],
        },
    ],
    '1.0.353': [
        {
            title: 'Movies & shows',
            items: [
                'Top Cast and guest stars run all the way to the edge of the screen instead of stopping short',
            ],
        },
    ],
    '1.0.352': [
        {
            title: 'Home',
            items: [
                'Rows with 16:9 hero covers load much faster, stay cached, and the artwork is smooth instead of jagged',
            ],
        },
    ],
    '1.0.351': [
        {
            title: 'Home',
            items: [
                'Continue Watching on Latest released ranks shows by their newest aired episode, so a show that just aired something comes first',
                'The billboard details line stays on one row — a long episode title is shortened instead of pushing the rating down',
            ],
        },
    ],
    '1.0.350': [
        {
            title: 'TV',
            items: [
                'The billboard details line has a separator between episode, title, date and length',
            ],
        },
        {
            title: 'Home',
            items: [
                'Continue Watching sorted by Latest released puts newly arrived titles and episodes in their place instead of at the end',
            ],
        },
    ],
    '1.0.349': [
        {
            title: 'Home',
            items: [
                'Continue Watching no longer brings back something you just finished, or shows it with old progress',
            ],
        },
    ],
    '1.0.348': [
        {
            title: 'TV',
            items: [
                'Opening the app highlights the first Continue Watching card, ready to play',
            ],
        },
    ],
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
