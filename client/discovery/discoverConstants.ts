/** Overseerr-aligned discovery constants — TMDB IDs + duotone logo URLs. */

export type DiscoverCompany = {
    id: number;
    name: string;
    /** TMDB logo path e.g. /wwemzKWzjKYJFfCeiB57q3r4Bcm.png */
    logoPath: string;
};

export type DiscoverGenre = {
    id: number;
    name: string;
    gradient: string;
};

/** TMDB duotone logo treatment used by Overseerr CompanyCard.
 *  onDark = light marks for dark cards; onLight = dark marks for light cards. */
export const tmdbDuotoneLogo = (
    logoPath: string,
    width: 780 | 300 = 780,
    surface: 'onDark' | 'onLight' = 'onDark',
) => {
    const path = logoPath.startsWith('/') ? logoPath : `/${logoPath}`;
    const tones = surface === 'onLight' ? '1a2332,5b6b7c' : 'ffffff,bababa';
    return `https://image.tmdb.org/t/p/w${width}_filter(duotone,${tones})${path}`;
};

export const tmdbBackdropUrl = (backdropPath: string) => {
    if (!backdropPath) return '';
    const path = backdropPath.startsWith('/') ? backdropPath : `/${backdropPath}`;
    return `https://image.tmdb.org/t/p/original${path}`;
};

export const DISCOVER_STUDIOS: DiscoverCompany[] = [
    // Bundled assets — Fire TV WebView + offline. Disney+ SVG is authored white
    // (TV WebViews often skip CSS filter on SVG <img>, so blue fills stayed blue).
    { id: 2, name: 'Disney', logoPath: '/static/logos/disney.png' },
    { id: 127928, name: '20th Century Studios', logoPath: '/static/logos/20th-century.png' },
    { id: 34, name: 'Sony Pictures', logoPath: '/static/logos/sony-pictures.png' },
    { id: 174, name: 'Warner Bros. Pictures', logoPath: '/static/logos/warner-bros.png' },
    { id: 33, name: 'Universal', logoPath: '/static/logos/universal.png' },
    { id: 4, name: 'Paramount', logoPath: '/static/logos/paramount.png' },
    { id: 3, name: 'Pixar', logoPath: '/static/logos/pixar.png' },
    { id: 521, name: 'Dreamworks', logoPath: '/static/logos/dreamworks.png' },
    { id: 420, name: 'Marvel Studios', logoPath: '/static/logos/marvel-studios.png' },
    { id: 9993, name: 'DC', logoPath: '/static/logos/dc.png' },
    { id: 41077, name: 'A24', logoPath: '/static/logos/a24.png' },
    // Expanded majors / labels
    { id: 25, name: '20th Century Fox', logoPath: '/static/logos/20th-century.png' },
    { id: 5, name: 'Columbia Pictures', logoPath: '/static/logos/columbia.png' },
    { id: 12, name: 'New Line Cinema', logoPath: '/static/logos/new-line.png' },
    { id: 14, name: 'Miramax', logoPath: '/m6AHu84oZQxvq7n1rsvMNJIAsMu.png' },
    { id: 1632, name: 'Lionsgate', logoPath: '/static/logos/lionsgate.png' },
    { id: 21, name: 'MGM', logoPath: '/static/logos/mgm.png' },
    { id: 43, name: 'Searchlight Pictures', logoPath: '/static/logos/searchlight.png' },
    { id: 58, name: 'TriStar Pictures', logoPath: '/voYCwlBHJQANtjvm5MNIkCF1dDH.png' },
    { id: 105, name: 'Screen Gems', logoPath: '/pyiNvPJYGz4W2SImgULoG2sn4y4.png' },
    { id: 491, name: 'Summit Entertainment', logoPath: '/5LvDUt3KmvRnXQ4NrdWJYHeuA8J.png' },
    { id: 670, name: 'Illumination', logoPath: '/static/logos/illumination.png' },
    { id: 923, name: 'Legendary Pictures', logoPath: '/static/logos/legendary.png' },
    { id: 3172, name: 'Blumhouse', logoPath: '/static/logos/blumhouse.png' },
    { id: 7295, name: 'Amblin Entertainment', logoPath: '/5MYE96QiE5a5oFhXxFb4y8ILSpw.png' },
    { id: 10342, name: 'Studio Ghibli', logoPath: '/uFuxPEZRUcBTEiYIxjHJq62Vr77.png' },
    { id: 89136, name: 'Neon', logoPath: '/5w19JCYpAshGGSIh1fTgwswl4DC.png' },
    { id: 10146, name: 'Focus Features', logoPath: '/static/logos/focus-features.png' },
    { id: 508, name: 'Regency Enterprises', logoPath: '/4sGWXoboEkWPphI6es6rTmqkCBh.png' },
];

export const DISCOVER_NETWORKS: DiscoverCompany[] = [
    // Global streamers — bundled SVGs where available (APK / offline-friendly)
    { id: 213, name: 'Netflix', logoPath: '/static/logos/netflix.svg' },
    { id: 2739, name: 'Disney+', logoPath: '/static/logos/disney-plus.svg' },
    { id: 1024, name: 'Prime Video', logoPath: '/static/logos/prime-video.svg' },
    { id: 2552, name: 'Apple TV+', logoPath: '/static/logos/apple-tv.svg' },
    { id: 453, name: 'Hulu', logoPath: '/pqUTCleNUiTLAVlelGxUgWn1ELh.png' },
    { id: 49, name: 'HBO', logoPath: '/static/logos/hbo.svg' },
    { id: 6783, name: 'Max', logoPath: '/static/logos/hbo.svg' },
    { id: 4353, name: 'Discovery+', logoPath: '/static/logos/discovery-plus.svg' },
    { id: 4330, name: 'Paramount+', logoPath: '/fi83B1oztoS47xxcemFdPMhIzK.png' },
    { id: 3353, name: 'Peacock', logoPath: '/gIAcGTjKKr0KOHL5s4O36roJ8p7.png' },
    // US broadcast
    { id: 2, name: 'ABC', logoPath: '/ndAvF4JLsliGreX87jAc9GdjmJY.png' },
    { id: 19, name: 'FOX', logoPath: '/1DSpHrWyOORkL9N2QHX7Adt31mQ.png' },
    { id: 6, name: 'NBC', logoPath: '/o3OedEP0f9mfZr33jz2BfXOUK5.png' },
    { id: 16, name: 'CBS', logoPath: '/nm8d7P7MJNiBLdgIzUK0gkuEA4r.png' },
    { id: 71, name: 'The CW', logoPath: '/ge9hzeaU7nMtQ4PjkFlc68dGAJ9.png' },
    { id: 174, name: 'AMC', logoPath: '/pmvRmATOCaDykE6JrVoeYxlFHw3.png' },
    { id: 67, name: 'Showtime', logoPath: '/Allse9kbjiP6ExaQrnSpIhkurEi.png' },
    { id: 318, name: 'Starz', logoPath: '/8GJjw3HHsAJYwIWKIPBPfqMxlEa.png' },
    { id: 359, name: 'Cinemax', logoPath: '/6mSHSquNpfLgDdv6VnOOvC5Uz2h.png' },
    // Kids / cable
    { id: 56, name: 'Cartoon Network', logoPath: '/c5OC6oVCg6QP4eqzW6XIq17CQjI.png' },
    { id: 80, name: 'Adult Swim', logoPath: '/9AKyspxVzywuaMuZ1Bvilu8sXly.png' },
    { id: 13, name: 'Nickelodeon', logoPath: '/ikZXxg6GnwpzqiZbRPhJGaZapqB.png' },
    { id: 54, name: 'Disney Channel', logoPath: '/bMe9KX1Wtd7HY0yD14TR5a6fEbM.png' },
    { id: 41, name: 'TNT', logoPath: '/em0rOXVRu3qprWZCx58uDDV2fze.png' },
    { id: 47, name: 'Comedy Central', logoPath: '/i7Z9ot2o3N5Sa3HrF09kniFs2y8.png' },
    { id: 1267, name: 'Freeform', logoPath: '/j3kXC0bEn4vxrIyUApeKBtSUu9w.png' },
    { id: 34, name: 'Lifetime', logoPath: '/xAb1o9HrSvKBo9mnXC8fJKDNu00.png' },
    // UK — PNG wordmarks (WebView blanks SVG <text>; path SVGs like ITV/Sky stay SVG)
    { id: 4000, name: 'BBC', logoPath: '/static/logos/bbc.png' },
    { id: 4, name: 'BBC One', logoPath: '/static/logos/bbc.png' },
    { id: 332, name: 'BBC Two', logoPath: '/static/logos/bbc.png' },
    { id: 3, name: 'BBC Three', logoPath: '/static/logos/bbc.png' },
    { id: 15, name: 'CBBC', logoPath: '/static/logos/bbc.png' },
    { id: 166, name: 'CBeebies', logoPath: '/static/logos/cbeebies.png' },
    { id: 26, name: 'Channel 4', logoPath: '/static/logos/channel-4.png' },
    { id: 136, name: 'E4', logoPath: '/static/logos/channel-4.png' },
    { id: 99, name: 'Channel 5', logoPath: '/static/logos/channel-5.png' },
    { id: 9, name: 'ITV', logoPath: '/static/logos/itv.svg' },
    { id: 270, name: 'ITV1', logoPath: '/static/logos/itv.svg' },
    { id: 5871, name: 'ITVX', logoPath: '/static/logos/itv.svg' },
    { id: 214, name: 'Sky', logoPath: '/static/logos/sky.svg' },
    { id: 9001, name: 'Sky Originals', logoPath: '/static/logos/sky-originals.png' },
    { id: 1063, name: 'Sky Atlantic', logoPath: '/fpVBhNnopOZwGuF0gg99oBHp1ht.png' },
    { id: 5237, name: 'Sky Max', logoPath: '/static/logos/sky.svg' },
];

export const MOVIE_GENRES: DiscoverGenre[] = [
    { id: 28, name: 'Action', gradient: 'from-red-700 to-red-950' },
    { id: 12, name: 'Adventure', gradient: 'from-violet-700 to-violet-950' },
    { id: 16, name: 'Animation', gradient: 'from-sky-600 to-sky-900' },
    { id: 35, name: 'Comedy', gradient: 'from-amber-500 to-amber-800' },
    { id: 80, name: 'Crime', gradient: 'from-blue-800 to-blue-950' },
    { id: 99, name: 'Documentary', gradient: 'from-emerald-600 to-emerald-900' },
    { id: 18, name: 'Drama', gradient: 'from-pink-700 to-pink-950' },
    { id: 10751, name: 'Family', gradient: 'from-yellow-600 to-yellow-800' },
    { id: 14, name: 'Fantasy', gradient: 'from-cyan-600 to-cyan-900' },
    { id: 36, name: 'History', gradient: 'from-orange-700 to-orange-950' },
    { id: 27, name: 'Horror', gradient: 'from-zinc-900 to-black' },
    { id: 10402, name: 'Music', gradient: 'from-sky-700 to-sky-950' },
    { id: 9648, name: 'Mystery', gradient: 'from-purple-700 to-purple-950' },
    { id: 10749, name: 'Romance', gradient: 'from-rose-700 to-rose-950' },
    { id: 878, name: 'Science Fiction', gradient: 'from-cyan-700 to-cyan-950' },
    { id: 53, name: 'Thriller', gradient: 'from-neutral-800 to-black' },
    { id: 10752, name: 'War', gradient: 'from-red-900 to-black' },
    { id: 37, name: 'Western', gradient: 'from-orange-800 to-orange-950' },
];

export const TV_GENRES: DiscoverGenre[] = [
    { id: 10759, name: 'Action & Adventure', gradient: 'from-violet-700 to-violet-950' },
    { id: 16, name: 'Animation', gradient: 'from-sky-600 to-sky-900' },
    { id: 35, name: 'Comedy', gradient: 'from-amber-500 to-amber-800' },
    { id: 80, name: 'Crime', gradient: 'from-blue-800 to-blue-950' },
    { id: 99, name: 'Documentary', gradient: 'from-emerald-600 to-emerald-900' },
    { id: 18, name: 'Drama', gradient: 'from-pink-700 to-pink-950' },
    { id: 10751, name: 'Family', gradient: 'from-yellow-600 to-yellow-800' },
    { id: 10762, name: 'Kids', gradient: 'from-sky-500 to-sky-800' },
    { id: 9648, name: 'Mystery', gradient: 'from-purple-700 to-purple-950' },
    { id: 10763, name: 'News', gradient: 'from-zinc-800 to-black' },
    { id: 10764, name: 'Reality', gradient: 'from-orange-700 to-orange-950' },
    { id: 10765, name: 'Sci-Fi & Fantasy', gradient: 'from-cyan-700 to-cyan-950' },
    { id: 10766, name: 'Soap', gradient: 'from-rose-700 to-rose-950' },
    { id: 10767, name: 'Talk', gradient: 'from-emerald-700 to-emerald-950' },
    { id: 10768, name: 'War & Politics', gradient: 'from-red-900 to-black' },
];

export const findStudio = (id: number) => DISCOVER_STUDIOS.find((s) => s.id === id);
export const findNetwork = (id: number) => DISCOVER_NETWORKS.find((n) => n.id === id);

/** Seerr/Overseerr genre card duotone tones [dark, light]. */
export const GENRE_COLOR_TONES: Record<string, [string, string]> = {
    red: ['991B1B', 'FCA5A5'],
    darkred: ['1F2937', 'F87171'],
    blue: ['032541', '01b4e4'],
    lightblue: ['1F2937', '60A5FA'],
    darkblue: ['1F2937', '2864d2'],
    orange: ['92400E', 'FCD34D'],
    lightgreen: ['065F46', '6EE7B7'],
    green: ['087d29', '21cb51'],
    purple: ['5B21B6', 'C4B5FD'],
    yellow: ['777e0d', 'e4ed55'],
    darkorange: ['552c01', 'd47c1d'],
    black: ['1F2937', 'D1D5DB'],
    pink: ['9D174D', 'F9A8D4'],
    darkpurple: ['480c8b', 'a96bef'],
};

export const GENRE_COLOR_MAP: Record<number, [string, string]> = {
    0: GENRE_COLOR_TONES.black,
    28: GENRE_COLOR_TONES.red,
    12: GENRE_COLOR_TONES.darkpurple,
    16: GENRE_COLOR_TONES.blue,
    35: GENRE_COLOR_TONES.orange,
    80: GENRE_COLOR_TONES.darkblue,
    99: GENRE_COLOR_TONES.lightgreen,
    18: GENRE_COLOR_TONES.pink,
    10751: GENRE_COLOR_TONES.yellow,
    14: GENRE_COLOR_TONES.lightblue,
    36: GENRE_COLOR_TONES.orange,
    27: GENRE_COLOR_TONES.black,
    10402: GENRE_COLOR_TONES.blue,
    9648: GENRE_COLOR_TONES.purple,
    10749: GENRE_COLOR_TONES.pink,
    878: GENRE_COLOR_TONES.lightblue,
    10770: GENRE_COLOR_TONES.red,
    53: GENRE_COLOR_TONES.black,
    10752: GENRE_COLOR_TONES.darkred,
    37: GENRE_COLOR_TONES.orange,
    10759: GENRE_COLOR_TONES.darkpurple,
    10762: GENRE_COLOR_TONES.blue,
    10763: GENRE_COLOR_TONES.black,
    10764: GENRE_COLOR_TONES.darkorange,
    10765: GENRE_COLOR_TONES.lightblue,
    10766: GENRE_COLOR_TONES.pink,
    10767: GENRE_COLOR_TONES.lightgreen,
    10768: GENRE_COLOR_TONES.darkred,
};

/**
 * Portal-owned TMDB backdrop paths for genre cards.
 * Paths are HEAD-verified against image.tmdb.org — broken hashes fall back to solid gradients.
 */
export const GENRE_BACKDROP_PATHS: Record<number, string> = {
    // Movies — only verified-live TMDB hashes
    28: '/b0PlSFdDwbyK0cf5RxwDpaOJQvQ.jpg', // Action — The Batman
    12: '/8rpDcsfLJypbO6vREc0547VKqEv.jpg', // Adventure — Avatar
    16: '/4HodYYKEIsGOdinkGi2Ucz6X9i0.jpg', // Animation — Spider-Verse
    35: '/3Rfvhy1Nl6sSGJwyjb0QiZzZYlB.jpg', // Comedy — Toy Story energy
    80: '/b0PlSFdDwbyK0cf5RxwDpaOJQvQ.jpg', // Crime — The Batman
    99: '/rLb2cwF3Pazuxaj0sRXQ037tGI1.jpg', // Documentary
    18: '/fm6KqXpk3M2HVveHwCrBSSBaO0V.jpg', // Drama — Oppenheimer
    10751: '/3Rfvhy1Nl6sSGJwyjb0QiZzZYlB.jpg', // Family
    14: '/8rpDcsfLJypbO6vREc0547VKqEv.jpg', // Fantasy
    36: '/8Gxv8gSFCU0XGDykEGv7zR1n2ua.jpg', // History
    27: '/b0PlSFdDwbyK0cf5RxwDpaOJQvQ.jpg', // Horror (dark urban)
    10402: '/dIWwZW7dJJtqC6CgWzYkNVKIUm8.jpg', // Music
    9648: '/s3TBrRGB1iav7gFOCNx3H31MoES.jpg', // Mystery — Inception
    10749: '/dIWwZW7dJJtqC6CgWzYkNVKIUm8.jpg', // Romance
    878: '/pbrkL804c8yAv3zBZR4QPEafpAR.jpg', // Science Fiction — Interstellar
    53: '/s3TBrRGB1iav7gFOCNx3H31MoES.jpg', // Thriller
    10752: '/7RyHsO4yDXtBv1zUU3mTpHeQ0d5.jpg', // War — Endgame scale
    37: '/x2RS3uTcsJJ9IfjNPcgDmukoEcQ.jpg', // Western
    // TV-only genres
    10759: '/7RyHsO4yDXtBv1zUU3mTpHeQ0d5.jpg', // Action & Adventure
    10762: '/3Rfvhy1Nl6sSGJwyjb0QiZzZYlB.jpg', // Kids
    10763: '/rLb2cwF3Pazuxaj0sRXQ037tGI1.jpg', // News
    10764: '/56v2KjBlU4XaOv9rVYEQypROD7P.jpg', // Reality
    10765: '/56v2KjBlU4XaOv9rVYEQypROD7P.jpg', // Sci-Fi & Fantasy
    10766: '/tsRy63Mu5cu8etL1X7ZLyf7UP1M.jpg', // Soap
    10767: '/3Rfvhy1Nl6sSGJwyjb0QiZzZYlB.jpg', // Talk
    10768: '/7RyHsO4yDXtBv1zUU3mTpHeQ0d5.jpg', // War & Politics
};

/** Build Seerr-style duotone backdrop URL for a genre slider card. */
export const buildGenreSliderImage = (genreId: number, backdrops?: string[] | null) => {
    const list = (Array.isArray(backdrops) ? backdrops : []).filter(Boolean);
    const rawPath = list.length
        ? list[Math.min(4, list.length - 1)]
        : GENRE_BACKDROP_PATHS[genreId];
    if (!rawPath) return undefined;
    const tones = GENRE_COLOR_MAP[genreId] || GENRE_COLOR_MAP[0];
    const normalized = String(rawPath).startsWith('/') ? String(rawPath) : `/${rawPath}`;
    return `https://image.tmdb.org/t/p/w780_filter(duotone,${tones[0]},${tones[1]})${normalized}`;
};
