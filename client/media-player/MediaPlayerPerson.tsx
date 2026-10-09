import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Cake, Calendar, ChevronDown, Clapperboard, Film, MapPin, Sparkles, Tv } from 'lucide-react';
import {
    DiscoverGridSizeSelect,
    discoveryTheme,
    PosterGridSkeleton,
    upgraderPosterGridClass,
    upgraderPosterGridStyle,
    useDiscoverGridSize,
    useDiscoverI18n,
} from './host';
import { fetchPlayerPersonBundle, setMediaPlayerWatched } from './api';
import { writePlayerScrollTop } from './playerMemory';
import {
    plexBackdropPreviewUrl,
    plexBackdropUrl,
    plexImageUrl,
    playerCardImageUrl,
    prefetchPlayerImages,
} from './playerUtils';
import { PlayerBackdropImage } from './PlayerBackdropImage';
import { PlayerPosterCard } from './PlayerPosterCard';
import { PlayerRail } from './PlayerRail';
import { formatPersonDate, personAgeYears, splitBiography } from '../discovery/personCredits';
import type { PlayerItem, PlayerPersonCreditRow, PlayerPersonProfile, PlayerPlayOptions } from './types';

type Props = {
    actorId: string;
    name?: string;
    thumb?: string | null;
    onBack: () => void;
    onOpenItem: (item: PlayerItem) => void;
    onPlay: (item: PlayerItem, opts?: PlayerPlayOptions) => void;
};

const BIO_PREVIEW_CHARS = 420;

const tmdbProfileUrl = (profilePath?: string | null) => {
    const path = String(profilePath || '').trim();
    if (!path) return '';
    if (/^https?:\/\//i.test(path)) return path;
    return `https://image.tmdb.org/t/p/h632${path.startsWith('/') ? path : `/${path}`}`;
};

const previewBiography = (bio: string) => {
    const trimmed = String(bio || '').trim();
    if (!trimmed) return { preview: '', rest: '', hasMore: false };
    const split = splitBiography(trimmed);
    if (split.hasMore) return { preview: split.first, rest: split.rest, hasMore: true };
    if (trimmed.length <= BIO_PREVIEW_CHARS) return { preview: trimmed, rest: '', hasMore: false };
    const cut = trimmed.slice(0, BIO_PREVIEW_CHARS);
    const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '), cut.lastIndexOf(' '));
    const preview = (end > 160 ? cut.slice(0, end + (cut[end] === ' ' ? 0 : 1)) : cut).trim();
    return { preview, rest: trimmed.slice(preview.length).trim(), hasMore: true };
};

const yearOf = (raw?: string | number | null) => {
    const match = String(raw ?? '').match(/\d{4}/);
    return match ? Number(match[0]) : null;
};

const daysUntilNextBirthday = (birthday: string) => {
    const m = birthday.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    const month = Number(m[2]) - 1;
    const day = Number(m[3]);
    const now = new Date();
    const todayUtc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    let next = Date.UTC(now.getFullYear(), month, day);
    if (next < todayUtc) next = Date.UTC(now.getFullYear() + 1, month, day);
    return Math.round((next - todayUtc) / 86_400_000);
};

type Glance = { icon: React.ReactNode; label: string; value: string; sub?: string };

export const MediaPlayerPerson: React.FC<Props> = ({ actorId, name, thumb, onBack, onOpenItem, onPlay }) => {
    const { t, locale } = useDiscoverI18n();
    const [gridSize, setGridSize] = useDiscoverGridSize();
    const [title, setTitle] = useState(name || t('navigation.person'));
    const [photo, setPhoto] = useState(thumb || null);
    const [profile, setProfile] = useState<PlayerPersonProfile | null>(null);
    const [items, setItems] = useState<PlayerItem[]>([]);
    const [filmography, setFilmography] = useState<PlayerPersonCreditRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [bioExpanded, setBioExpanded] = useState(false);
    const [backdropFailed, setBackdropFailed] = useState(false);
    const bioBodyRef = useRef<HTMLParagraphElement | null>(null);
    const isTvShell = typeof document !== 'undefined' && (
        document.documentElement?.dataset?.tv === '1'
        || window.__PLEX_CLIENT__?.isTv === true
    );

    useLayoutEffect(() => {
        writePlayerScrollTop(0);
    }, [actorId]);

    useEffect(() => {
        writePlayerScrollTop(0);
        if (!isTvShell || loading) return undefined;
        const id = window.setTimeout(() => {
            writePlayerScrollTop(0);
            const first = document.querySelector<HTMLElement>(
                '[data-tv-person="1"] [data-tv-poster-btn="1"], [data-tv-person="1"] [data-tv-item="1"]',
            );
            first?.focus({ preventScroll: true });
        }, 40);
        return () => window.clearTimeout(id);
    }, [actorId, isTvShell, loading]);

    useEffect(() => {
        if (!bioExpanded) return undefined;
        const id = window.requestAnimationFrame(() => {
            const node = bioBodyRef.current;
            if (!node) return;
            try {
                node.focus({ preventScroll: true });
            } catch {
                node.focus();
            }
            try {
                node.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' });
            } catch {
                /* ignore */
            }
        });
        return () => window.cancelAnimationFrame(id);
    }, [bioExpanded]);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setProfile(null);
        setFilmography([]);
        setBioExpanded(false);
        setBackdropFailed(false);

        fetchPlayerPersonBundle(actorId, name, thumb)
            .then((data) => {
                if (cancelled) return;
                setTitle(data.person.name || t('navigation.person'));
                setPhoto(data.person.thumb || null);
                setItems(data.items || []);
                setProfile(data.profile);
                setFilmography(data.filmography || []);
                setError(null);
            })
            .catch((err) => {
                if (cancelled) return;
                setError(String(err?.message || t('mediaPlayerPage.loadError')));
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => { cancelled = true; };
    }, [actorId, name, t, thumb]);

    useEffect(() => {
        prefetchPlayerImages(items.slice(0, 12).map((item) => playerCardImageUrl(item.thumb)), 12);
    }, [items]);

    const toggleWatched = async (item: PlayerItem) => {
        const next = !item.watched;
        setItems((prev) => prev.map((row) => (
            row.ratingKey === item.ratingKey ? { ...row, watched: next } : row
        )));
        try {
            await setMediaPlayerWatched(item.ratingKey, next, item);
        } catch {
            setItems((prev) => prev.map((row) => (
                row.ratingKey === item.ratingKey ? { ...row, watched: item.watched } : row
            )));
        }
    };

    const birthday = String(profile?.birthday || '').trim();
    const deathday = String(profile?.deathday || '').trim();
    const placeOfBirth = String(profile?.placeOfBirth || '').trim();
    const placeOfDeath = String(profile?.placeOfDeath || '').trim();
    const knownFor = String(profile?.knownForDepartment || '').trim();
    const biography = String(profile?.biography || '').trim();
    const age = personAgeYears(birthday, deathday || null);
    const deceased = Boolean(deathday);
    const statusKnown = Boolean(birthday || deathday);
    const photoUrl = tmdbProfileUrl(profile?.profilePath) || (photo ? plexImageUrl(photo, 600, 600, { quality: 72 }) : '');

    // Ambient art: random title from their on-server catalogue (prefer real backdrops).
    const artSource = useMemo(() => {
        const arts = items.map((row) => row.art).filter((path): path is string => Boolean(path));
        if (arts.length) return arts[Math.floor(Math.random() * arts.length)];
        const thumbs = items.map((row) => row.thumb).filter((path): path is string => Boolean(path));
        if (thumbs.length) return thumbs[Math.floor(Math.random() * thumbs.length)];
        return null;
    }, [items]);
    const backdropUrl = plexBackdropUrl(artSource);
    const backdropPreviewUrl = plexBackdropPreviewUrl(artSource);

    const filmographyRows = useMemo<PlayerPersonCreditRow[]>(() => (
        filmography.length
            ? filmography
            : items.map((row) => ({
                id: row.ratingKey,
                title: row.title,
                year: row.year != null ? String(row.year) : null,
                mediaType: row.type === 'show' ? 'tv' : 'movie',
                role: null,
                department: 'cast',
                onServer: true,
                ratingKey: row.ratingKey,
            } as PlayerPersonCreditRow))
    ), [filmography, items]);

    const glance = useMemo<Glance[]>(() => {
        const rows: Glance[] = [];
        const years = filmographyRows.map((row) => yearOf(row.year)).filter((y): y is number => Boolean(y));
        if (years.length) {
            const from = Math.min(...years);
            const to = Math.max(...years);
            rows.push({
                icon: <Clapperboard className="h-4 w-4" />,
                label: t('person.careerLabel'),
                value: t('person.careerSpan', { from, to }),
                sub: to > from ? t('person.careerYears', { count: to - from }) : undefined,
            });
            const buckets = new Map<number, number>();
            years.forEach((y) => buckets.set(Math.floor(y / 10) * 10, (buckets.get(Math.floor(y / 10) * 10) || 0) + 1));
            const [busiest] = [...buckets.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0] || [];
            if (busiest != null && buckets.size > 1) {
                rows.push({
                    icon: <Calendar className="h-4 w-4" />,
                    label: t('person.busiestDecade'),
                    value: t('person.decadeLabel', { decade: busiest }),
                    sub: t('person.filmographyCount', { count: buckets.get(busiest) || 0 }),
                });
            }
        }
        if (filmographyRows.length) {
            const movies = filmographyRows.filter((row) => row.mediaType !== 'tv').length;
            const shows = filmographyRows.length - movies;
            rows.push({
                icon: <Film className="h-4 w-4" />,
                label: t('person.creditsLabel'),
                value: String(filmographyRows.length),
                sub: t('person.creditsSplit', { movies, shows }),
            });
        }
        if (birthday && !deceased) {
            const days = daysUntilNextBirthday(birthday);
            if (days != null) {
                rows.push({
                    icon: <Cake className="h-4 w-4" />,
                    label: t('person.nextBirthday'),
                    value: days === 0 ? t('person.today') : t('person.inDays', { count: days }),
                    sub: age != null ? t('person.yearsOld', { count: age + (days === 0 ? 0 : 1) }) : undefined,
                });
            }
        }
        return rows.slice(0, 4);
    }, [age, birthday, deceased, filmographyRows, t]);

    const decades = useMemo(() => {
        const groups = new Map<string, PlayerPersonCreditRow[]>();
        filmographyRows.slice(0, 120).forEach((row) => {
            const y = yearOf(row.year);
            const key = y ? `${Math.floor(y / 10) * 10}` : '—';
            groups.set(key, [...(groups.get(key) || []), row]);
        });
        return [...groups.entries()].sort((a, b) => {
            if (a[0] === '—') return 1;
            if (b[0] === '—') return -1;
            return Number(b[0]) - Number(a[0]);
        });
    }, [filmographyRows]);

    const { preview: bioPreview, rest: bioRest, hasMore: bioHasMore } = previewBiography(biography);
    const bioShown = biography
        ? (bioExpanded && bioHasMore ? `${bioPreview}${bioRest ? `\n\n${bioRest}` : ''}` : bioPreview)
        : t('person.noBiography', { name: title });

    const knownForTitles = items.slice(0, 3).map((row) => row.title).filter(Boolean);

    const openCredit = (row: PlayerPersonCreditRow) => {
        if (!row.ratingKey) return;
        const match = items.find((item) => item.ratingKey === row.ratingKey);
        onOpenItem(match || {
            ratingKey: row.ratingKey,
            title: row.title,
            type: row.mediaType === 'tv' ? 'show' : 'movie',
        } as PlayerItem);
    };

    const lifeFacts: Array<{ icon: React.ReactNode; label: string; value: string }> = [];
    if (birthday) {
        lifeFacts.push({
            icon: <Calendar className="h-4 w-4" />,
            label: t('person.bornLabel'),
            value: formatPersonDate(birthday, locale),
        });
    }
    if (placeOfBirth) {
        lifeFacts.push({ icon: <MapPin className="h-4 w-4" />, label: t('person.birthplaceLabel'), value: placeOfBirth });
    }
    if (deathday) {
        lifeFacts.push({
            icon: <Calendar className="h-4 w-4" />,
            label: t('person.diedLabel'),
            value: `${formatPersonDate(deathday, locale)}${age != null ? ` · ${t('person.aged', { count: age })}` : ''}`,
        });
    }
    if (placeOfDeath) {
        lifeFacts.push({ icon: <MapPin className="h-4 w-4" />, label: t('person.deathplaceLabel'), value: placeOfDeath });
    }

    return (
        <div className="player-person-page relative flex w-full max-w-none flex-col" data-tv-person="1" data-tv-page-top="1">
            {/* Ambient cinematic art — full bleed, dissolves into the page. */}
            <div className="player-person-ambient pointer-events-none absolute inset-x-0 top-0 overflow-hidden" aria-hidden>
                {backdropUrl && !backdropFailed ? (
                    <PlayerBackdropImage
                        key={backdropUrl}
                        src={backdropUrl}
                        previewSrc={isTvShell ? backdropPreviewUrl : undefined}
                        className="player-person-ambient-img h-full w-full object-cover"
                        fetchPriority="low"
                        onError={() => setBackdropFailed(true)}
                    />
                ) : null}
                <div className="player-person-ambient-scrim absolute inset-0" />
            </div>

            {!isTvShell ? (
                <button
                    type="button"
                    onClick={onBack}
                    className="player-page-back relative z-10 mb-2 inline-flex items-center gap-2 text-sm font-bold text-muted hover:text-text"
                >
                    <ArrowLeft className="h-4 w-4" />
                    {t('mediaPlayerPage.back')}
                </button>
            ) : null}

            <section
                className="player-person-hero relative z-10 flex w-full flex-col gap-8 lg:flex-row lg:items-center"
                data-tv-person-hero="1"
            >
                {/* Portrait + name */}
                <div className="player-person-portrait-wrap relative mx-auto flex shrink-0 flex-col items-center lg:mx-0">
                    <div className="player-person-portrait-ring relative">
                        <div className="player-person-portrait overflow-hidden rounded-full bg-white/5">
                            {photoUrl ? (
                                <img src={photoUrl} alt={title} className="h-full w-full object-cover" />
                            ) : loading && !isTvShell ? (
                                <div className="h-full w-full animate-pulse bg-white/10" />
                            ) : (
                                <div className="flex h-full w-full items-center justify-center text-sm font-bold text-white/35">
                                    {t('person.noPhoto')}
                                </div>
                            )}
                        </div>
                        {!loading && statusKnown ? (
                            <span className={`player-person-status ${deceased ? 'is-deceased' : 'is-living'}`}>
                                <span className="player-person-status-dot" />
                                {deceased ? t('person.deceased') : t('person.living')}
                            </span>
                        ) : null}
                    </div>
                    {loading && !title && !isTvShell ? (
                        <div className="player-person-name-under mt-5 h-10 w-40 animate-pulse rounded-lg bg-white/10" aria-hidden />
                    ) : (
                        <h1 className="player-person-name player-person-name-under mt-5 text-center font-black tracking-tight text-white">
                            {title}
                        </h1>
                    )}
                </div>

                {/* Facts + bio */}
                <div className="player-person-copy min-w-0 flex-1">
                    {loading ? (
                        <div className="flex flex-col gap-4" aria-hidden>
                            <div className="h-4 w-48 animate-pulse rounded bg-white/10" />
                            <div className="mt-2 grid grid-cols-2 gap-3 lg:grid-cols-4">
                                {Array.from({ length: 4 }, (_, i) => (
                                    <div key={i} className="h-16 animate-pulse rounded-xl bg-white/10" />
                                ))}
                            </div>
                            <div className="mt-2 h-20 w-full animate-pulse rounded bg-white/10" />
                        </div>
                    ) : (
                        <>
                            {knownFor ? (
                                <p className="player-person-eyebrow font-bold uppercase tracking-[0.24em] text-plex">
                                    {knownFor}
                                </p>
                            ) : null}
                            {lifeFacts.length ? (
                                <div className="player-person-life player-person-glance mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
                                    {lifeFacts.map((fact) => (
                                        <div key={fact.label} className="player-person-glance-tile min-w-0">
                                            <span className="player-person-glance-label flex items-center gap-1.5 font-bold uppercase tracking-[0.14em] text-white/45">
                                                <span className="text-plex">{fact.icon}</span>
                                                {fact.label}
                                            </span>
                                            <span className="player-person-glance-value block font-black text-white">
                                                {fact.value}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            ) : null}

                            {glance.length ? (
                                <div className={`player-person-glance grid grid-cols-2 gap-3 lg:grid-cols-4 ${lifeFacts.length ? 'mt-3' : 'mt-5'}`}>
                                    {glance.map((row) => (
                                        <div key={row.label} className="player-person-glance-tile min-w-0">
                                            <span className="player-person-glance-label flex items-center gap-1.5 font-bold uppercase tracking-[0.14em] text-white/45">
                                                <span className="text-plex">{row.icon}</span>
                                                {row.label}
                                            </span>
                                            <span className="player-person-glance-value block font-black text-white">{row.value}</span>
                                            {row.sub ? (
                                                <span className="player-person-glance-sub block text-white/50">{row.sub}</span>
                                            ) : null}
                                        </div>
                                    ))}
                                </div>
                            ) : null}

                            <div className="player-person-bio mt-5 w-full">
                                <p
                                    ref={bioBodyRef}
                                    tabIndex={bioExpanded ? 0 : -1}
                                    data-tv-item={bioExpanded ? '1' : undefined}
                                    data-tv-key={bioExpanded ? 'person-bio-body' : undefined}
                                    className={`player-person-bio-body w-full whitespace-pre-line text-white/75 outline-none ${bioExpanded ? '' : 'is-clamped'}`}
                                >
                                    {bioShown}
                                </p>
                                {bioHasMore ? (
                                    <button
                                        type="button"
                                        data-tv-item="1"
                                        data-tv-action="1"
                                        data-tv-key="person-bio-more"
                                        onClick={() => setBioExpanded((open) => !open)}
                                        className="player-person-bio-more mt-2 inline-flex items-center gap-1.5 rounded-lg font-bold text-plex outline-none"
                                    >
                                        {bioExpanded ? t('common.showLess') : t('person.more')}
                                        <ChevronDown className={`h-4 w-4 transition-transform ${bioExpanded ? 'rotate-180' : ''}`} />
                                    </button>
                                ) : null}
                            </div>

                            {knownForTitles.length ? (
                                <p className="player-person-knownfor mt-4 text-white/55">
                                    <span className="font-bold uppercase tracking-[0.16em] text-white/40">{t('person.knownForOnServer')}</span>
                                    <span className="mx-2 text-white/25">·</span>
                                    <span className="font-semibold text-white/80">{knownForTitles.join(' · ')}</span>
                                </p>
                            ) : null}
                        </>
                    )}
                </div>
            </section>

            {/* On this server */}
            <section className="player-person-server relative z-10 flex w-full flex-col gap-4">
                {isTvShell ? (
                    loading ? null : error ? (
                        <div className={discoveryTheme.emptyState}>
                            <p className={discoveryTheme.emptyTitle}>{error}</p>
                        </div>
                    ) : items.length ? (
                        <PlayerRail
                            title={t('mediaPlayerPage.onThisServer')}
                            rowId={`person-server:${actorId}`}
                            items={items}
                            density={gridSize}
                            onOpenItem={onOpenItem}
                            onPlay={onPlay}
                            onToggleWatched={toggleWatched}
                            viewAllLabel={t('person.creditCount', { count: items.length })}
                        />
                    ) : (
                        <div className={discoveryTheme.emptyState}>
                            <p className={discoveryTheme.emptyTitle}>{t('mediaPlayerPage.emptyPerson', { name: title })}</p>
                        </div>
                    )
                ) : (
                    <>
                        <div className="flex flex-wrap items-end justify-between gap-3">
                            <h2 className="flex items-center gap-3 text-2xl font-black text-white">
                                <Film className="h-6 w-6 text-plex" />
                                {t('mediaPlayerPage.onThisServer')}
                                {!loading && items.length ? (
                                    <span className="text-sm font-bold tracking-normal text-white/45">
                                        {t('person.creditCount', { count: items.length })}
                                    </span>
                                ) : null}
                            </h2>
                            <DiscoverGridSizeSelect value={gridSize} onChange={setGridSize} />
                        </div>
                        {loading ? (
                            <PosterGridSkeleton
                                className={upgraderPosterGridClass(gridSize)}
                                style={upgraderPosterGridStyle(gridSize)}
                            />
                        ) : error ? (
                            <div className={discoveryTheme.emptyState}>
                                <p className={discoveryTheme.emptyTitle}>{error}</p>
                            </div>
                        ) : !items.length ? (
                            <div className={discoveryTheme.emptyState}>
                                <p className={discoveryTheme.emptyTitle}>{t('mediaPlayerPage.emptyPerson', { name: title })}</p>
                            </div>
                        ) : (
                            <div
                                className={upgraderPosterGridClass(gridSize)}
                                style={upgraderPosterGridStyle(gridSize)}
                                data-tv-rail="1"
                                data-tv-poster-grid="1"
                            >
                                {items.map((item, index) => (
                                    <PlayerPosterCard
                                        key={item.ratingKey}
                                        item={item}
                                        onOpenItem={onOpenItem}
                                        onPlay={onPlay}
                                        onToggleWatched={toggleWatched}
                                        imagePriority={index < 8}
                                        loading={index < 12 ? 'eager' : 'lazy'}
                                    />
                                ))}
                            </div>
                        )}
                    </>
                )}
            </section>

            {/* Filmography — grouped by decade */}
            {!loading && filmographyRows.length ? (
                <section className="player-person-filmography relative z-10 flex w-full flex-col gap-5">
                    <h2 className="player-person-section-title flex items-center gap-3 font-black text-white">
                        <Sparkles className="h-5 w-5 text-plex" />
                        {t('person.fullFilmography')}
                        <span className="player-person-section-count font-bold tracking-normal text-white/45">
                            {t('person.filmographyCount', { count: filmographyRows.length })}
                        </span>
                    </h2>
                    <div className="player-person-decades flex w-full flex-col gap-6">
                        {decades.map(([decade, rows]) => (
                            <div
                                key={decade}
                                className="player-person-decade grid w-full grid-cols-[auto_minmax(0,1fr)] gap-x-6"
                                data-tv-row="1"
                                data-tv-row-id={`person-decade:${actorId}:${decade}`}
                            >
                                <div className="player-person-decade-label flex flex-col items-end">
                                    <span className="player-person-decade-year font-black tabular-nums text-white">
                                        {decade === '—' ? '—' : `${decade}s`}
                                    </span>
                                    <span className="player-person-decade-count font-bold uppercase tracking-[0.14em] text-white/35">
                                        {t('person.filmographyCount', { count: rows.length })}
                                    </span>
                                    <span className="player-person-decade-rule mt-2 w-full" />
                                </div>
                                <div className="player-person-credit-grid grid w-full grid-cols-1 gap-2 xl:grid-cols-2">
                                    {rows.map((row, index) => {
                                        const interactive = Boolean(row.ratingKey);
                                        const typeLabel = row.mediaType === 'tv' ? t('person.showType') : t('person.movieType');
                                        const body = (
                                            <>
                                                <span className="player-person-credit-year shrink-0 font-bold tabular-nums text-plex">
                                                    {yearOf(row.year) ?? '—'}
                                                </span>
                                                <span className="player-person-credit-type shrink-0 text-white/35">
                                                    {row.mediaType === 'tv' ? <Tv className="h-4 w-4" /> : <Film className="h-4 w-4" />}
                                                </span>
                                                <span className="min-w-0 flex-1">
                                                    <span className="player-person-credit-title block truncate font-semibold text-white">{row.title}</span>
                                                    <span className="player-person-credit-role block truncate text-white/45">
                                                        {row.role || typeLabel}
                                                    </span>
                                                </span>
                                                {row.onServer ? (
                                                    <span className="player-person-credit-badge shrink-0 rounded-full font-black uppercase tracking-wide">
                                                        {t('person.onServerBadge')}
                                                    </span>
                                                ) : null}
                                            </>
                                        );
                                        const rowClass = `player-person-credit-row flex w-full items-center gap-3 rounded-xl text-left outline-none ${
                                            row.onServer ? 'is-on-server' : ''
                                        }`;
                                        return interactive ? (
                                            <button
                                                key={`${row.id}-${index}`}
                                                type="button"
                                                onClick={() => openCredit(row)}
                                                data-tv-item="1"
                                                data-tv-action="1"
                                                data-tv-key={`credit:${row.id}`}
                                                className={rowClass}
                                            >
                                                {body}
                                            </button>
                                        ) : (
                                            <div key={`${row.id}-${index}`} className={`${rowClass} is-static`}>
                                                {body}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        ))}
                    </div>
                </section>
            ) : null}
        </div>
    );
};
