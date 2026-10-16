import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    ChevronDown,
    ChevronUp,
    Clapperboard,
    ExternalLink,
    Flame,
    Laugh,
    Link2,
    Loader2,
    MessageSquareQuote,
    Music2,
    Sparkles,
    ThumbsUp,
    Users,
} from 'lucide-react';
import { apiFetch } from '../shared/api';
import { NoPosterPlaceholder } from '../shared/NoPosterPlaceholder';
import type { NowPlayingSession } from '../shared/useNowPlaying';
import {
    buildExternalLinks,
    buildMediaFactRows,
    fetchCombinedRatings,
    getProductionStudios,
    sortKeyCrew,
    type CombinedRatings,
} from '../discovery/mediaDetailUtils';
import { enrichDiscoverItemsWithAvailability } from '../discovery/discoverAvailabilityEnrich';
import { translateDiscoverStatus, useDiscoverI18n } from '../discovery/i18n';
import {
    resolveMediaAvailabilityState,
    shouldHideAvailableItem,
    shouldHideRequestedItem,
} from '../discovery/discoverAvailability';

type CompanionToastType = 'success' | 'error';

type Props = {
    session: NowPlayingSession;
    userKey: string;
    mediaServerType?: string;
    onNavigate?: (path: string) => void;
    onToast?: (message: string, type?: CompanionToastType) => void;
};

type Recommendation = {
    id: number;
    tmdbId?: number;
    mediaType: 'movie' | 'tv';
    title: string;
    year: string;
    posterPath: string | null;
    mediaInfo?: any;
};

type KnownForItem = {
    id: number;
    mediaType: 'movie' | 'tv';
    title: string;
    year: string;
};

type CastInsight = {
    id: number;
    name: string;
    character: string;
    profilePath: string | null;
    popularity: number;
    knownForDepartment: string;
    birthday: string;
    placeOfBirth: string;
    biographySnippet: string;
    knownFor: KnownForItem[];
};

type CrewInsight = {
    id: number;
    name: string;
    job: string;
    department: string;
    profilePath: string | null;
    popularity: number;
    biographySnippet: string;
    knownFor: KnownForItem[];
    otherCredits: string[];
};

type CompanionPayload = {
    details: any | null;
    recommendations: Recommendation[];
    castInsights: CastInsight[];
    crewInsights: CrewInsight[];
    soundtrackPeople: string[];
    seasonDetails: any | null;
};

type PollVotes = Record<string, number>;
type ReactionCounts = Record<string, number>;
type DiscoveryFactPayload = {
    facts?: string[];
    fact?: string | null;
    sources?: {
        wikipedia?: number;
        tmdb?: number;
    };
};

const LOCAL_WATCHLIST_KEY = 'portal.companion.watchlist.v1';
const LOCAL_ROOM_STATE_KEY = 'portal.companion.room.v1';
const LOCAL_COMPANION_EXPANDED_KEY = 'portal.companion.expanded.v1';

const readCompanionExpanded = (userKey: string): boolean => {
    const key = String(userKey || '').trim();
    if (!key) return false;
    const stored = readJsonStorage<Record<string, boolean>>(LOCAL_COMPANION_EXPANDED_KEY, {});
    if (!(key in stored)) return false;
    return stored[key] === true;
};

const writeCompanionExpanded = (userKey: string, expanded: boolean): void => {
    const key = String(userKey || '').trim();
    if (!key) return;
    const stored = readJsonStorage<Record<string, boolean>>(LOCAL_COMPANION_EXPANDED_KEY, {});
    stored[key] = expanded;
    writeJsonStorage(LOCAL_COMPANION_EXPANDED_KEY, stored);
};

const posterUrl = (path?: string | null, size = 'w342') => (
    path ? `https://image.tmdb.org/t/p/${size}${path}` : ''
);

const initialsForName = (name: string): string => {
    const parts = String(name || '')
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2);
    if (!parts.length) return '?';
    return parts.map((part) => part[0]?.toUpperCase() || '').join('');
};

const normalizedMediaType = (raw: unknown): 'movie' | 'tv' | null => {
    const value = String(raw || '').toLowerCase();
    if (value === 'tv' || value === 'show' || value === 'series') return 'tv';
    if (value === 'movie') return 'movie';
    return null;
};

const formatYear = (date: unknown): string => {
    const raw = String(date || '');
    return raw.slice(0, 4);
};

const readJsonStorage = <T,>(key: string, fallback: T): T => {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return fallback;
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed as T : fallback;
    } catch {
        return fallback;
    }
};

const writeJsonStorage = (key: string, value: unknown) => {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch {
        // Ignore persistence failures.
    }
};

const buildKnownFor = (payload: any, currentTmdbId: number): KnownForItem[] => {
    const seen = new Set<string>();
    const pool = [
        ...(Array.isArray(payload?.cast) ? payload.cast : []),
        ...(Array.isArray(payload?.crew) ? payload.crew : []),
    ];
    return pool
        .map((entry) => {
            const mediaType = normalizedMediaType(entry?.media_type || entry?.mediaType);
            const id = Number(entry?.id);
            if (!mediaType || !Number.isFinite(id) || id <= 0 || id === currentTmdbId) return null;
            const title = String(entry?.title || entry?.name || '').trim();
            if (!title) return null;
            const key = `${mediaType}:${id}`;
            if (seen.has(key)) return null;
            seen.add(key);
            return {
                id,
                mediaType,
                title,
                year: formatYear(
                    entry?.release_date
                    || entry?.first_air_date
                    || entry?.releaseDate
                    || entry?.firstAirDate,
                ),
                popularity: Number(entry?.popularity) || 0,
                voteCount: Number(entry?.vote_count ?? entry?.voteCount) || 0,
            };
        })
        .filter(Boolean)
        .sort((a: any, b: any) => (
            (b.voteCount - a.voteCount)
            || (b.popularity - a.popularity)
        ))
        .slice(0, 3)
        .map((entry: any) => ({
            id: entry.id,
            mediaType: entry.mediaType,
            title: entry.title,
            year: entry.year,
        }));
};

const extractSoundtrackPeople = (crew: any[]): string[] => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const entry of crew) {
        const department = String(entry?.department || '').toLowerCase();
        const job = String(entry?.job || '').toLowerCase();
        const name = String(entry?.name || '').trim();
        if (!name) continue;
        const isMusic = department.includes('sound')
            || department.includes('music')
            || job.includes('composer')
            || job.includes('music')
            || job.includes('score')
            || job.includes('soundtrack');
        if (!isMusic) continue;
        if (seen.has(name)) continue;
        seen.add(name);
        out.push(name);
        if (out.length >= 6) break;
    }
    return out;
};

const normalizeRecommendations = (results: any[]): Recommendation[] => (
    (Array.isArray(results) ? results : [])
        .map((item) => {
            const mediaType = normalizedMediaType(item?.media_type || item?.mediaType);
            const id = Number(item?.id);
            if (!mediaType || !Number.isFinite(id) || id <= 0) return null;
            const title = String(item?.title || item?.name || '').trim();
            if (!title) return null;
            return {
                id,
                mediaType,
                tmdbId: id,
                title,
                year: formatYear(item?.release_date || item?.first_air_date || item?.releaseDate || item?.firstAirDate),
                posterPath: item?.poster_path || item?.posterPath || null,
            };
        })
        .filter(Boolean) as Recommendation[]
);

const isRequestableRecommendation = (item: Recommendation): boolean => {
    const kind = resolveMediaAvailabilityState(item).kind;
    if (kind === 'blacklisted') return false;
    return !shouldHideAvailableItem(item) && !shouldHideRequestedItem(item);
};

const CompanionOverviewText: React.FC<{ title: string; text: string }> = ({ title, text }) => {
    const { t } = useDiscoverI18n();
    const [expanded, setExpanded] = useState(false);
    const trimmed = String(text || '').trim();
    if (!trimmed) return null;
    const isLong = trimmed.length > 240;

    return (
        <div className="rounded-xl border border-white/10 bg-black/25 px-3 py-2.5">
            <p className="text-[11px] uppercase tracking-widest text-white/60 font-bold mb-1.5">{title}</p>
            <p className={`text-sm text-white/85 leading-relaxed whitespace-pre-line ${!expanded && isLong ? 'line-clamp-5' : ''}`}>
                {trimmed}
            </p>
            {isLong ? (
                <button
                    type="button"
                    onClick={() => setExpanded((value) => !value)}
                    className="mt-1.5 text-xs font-semibold text-emerald-200 hover:text-emerald-100 transition-colors"
                >
                    {expanded
                        ? t('homeDashboard.nowPlayingCompanion.overview.readLess')
                        : t('homeDashboard.nowPlayingCompanion.overview.readMore')}
                </button>
            ) : null}
        </div>
    );
};

const CompanionArtBackdrop: React.FC<{ imagePath?: string | null; className?: string; size?: string }> = ({
    imagePath,
    className = '',
    size = 'w780',
}) => {
    if (!imagePath) return null;
    return (
        <div className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}>
            <img
                src={posterUrl(imagePath, size)}
                alt=""
                className="absolute inset-0 h-full w-full object-cover opacity-[0.22] blur-2xl scale-110"
            />
            <div className="absolute inset-0 bg-gradient-to-br from-black/70 via-black/55 to-black/80" />
        </div>
    );
};

const CompanionProgressRing: React.FC<{ progress: number; size?: number }> = ({ progress, size = 76 }) => {
    const radius = (size - 8) / 2;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (Math.max(0, Math.min(100, progress)) / 100) * circumference;
    return (
        <svg width={size} height={size} className="absolute -inset-1.5">
            <circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke="rgba(255,255,255,0.12)"
                strokeWidth="3"
            />
            <circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke="rgba(52,211,153,0.95)"
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={offset}
                transform={`rotate(-90 ${size / 2} ${size / 2})`}
            />
        </svg>
    );
};

type CompanionHeroCardProps = {
    title: string;
    year: string;
    mediaType: 'movie' | 'tv';
    tagline: string;
    posterPath: string | null;
    heroArtPath: string | null;
    seasonNumber: number;
    episodeNumber: number;
    episodeTitle: string;
    progress: number;
    metaChips: string[];
    overviewBlocks: Array<{ key: string; title: string; text: string }>;
    unavailableLabel: string;
};

const CompanionHeroCard: React.FC<CompanionHeroCardProps> = ({
    title,
    year,
    mediaType,
    tagline,
    posterPath,
    heroArtPath,
    seasonNumber,
    episodeNumber,
    episodeTitle,
    progress,
    metaChips,
    overviewBlocks,
    unavailableLabel,
}) => {
    const { t } = useDiscoverI18n();
    return (
        <div className="relative overflow-hidden rounded-2xl border border-white/15 bg-black/35 shadow-[0_24px_70px_rgba(0,0,0,0.45)]">
            <div className="relative h-44 sm:h-52 lg:h-56">
                {heroArtPath ? (
                    <img
                        src={posterUrl(heroArtPath, 'w780')}
                        alt=""
                        className="absolute inset-0 h-full w-full object-cover"
                    />
                ) : (
                    <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/20 via-violet-500/10 to-black" />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black via-black/55 to-black/10" />
                <div className="absolute inset-0 bg-gradient-to-r from-black/70 via-transparent to-black/35" />
                <div className="absolute inset-x-0 bottom-0 p-3 sm:p-4 flex items-end gap-3 sm:gap-4">
                    <div className="relative shrink-0">
                        {posterPath ? (
                            <div className="relative">
                                <CompanionProgressRing progress={progress} />
                                <img
                                    src={posterUrl(posterPath, 'w342')}
                                    alt={title}
                                    className="relative z-[1] w-[4.5rem] sm:w-20 rounded-xl border border-white/25 shadow-[0_12px_30px_rgba(0,0,0,0.55)] object-cover aspect-[2/3]"
                                />
                            </div>
                        ) : null}
                    </div>
                    <div className="min-w-0 flex-1">
                        <p className="text-[10px] uppercase tracking-[0.22em] text-emerald-200/90 font-bold">
                            {t('homeDashboard.nowPlayingCompanion.header.playbackProgress', {
                                type: mediaType === 'tv' ? t('mediaType.series') : t('mediaType.movie'),
                                progress,
                            })}
                        </p>
                        <h4 className="text-lg sm:text-xl font-black text-white leading-tight truncate">
                            {title}{year ? ` (${year})` : ''}
                        </h4>
                        {mediaType === 'tv' && seasonNumber > 0 && episodeNumber > 0 ? (
                            <p className="text-xs sm:text-sm text-white/80 mt-1 truncate">
                                S{seasonNumber}E{episodeNumber}
                                {episodeTitle ? ` · ${episodeTitle}` : ''}
                            </p>
                        ) : null}
                        {tagline ? (
                            <p className="text-xs italic text-emerald-100/90 mt-1.5 line-clamp-2">{tagline}</p>
                        ) : null}
                    </div>
                </div>
            </div>
            <div className="relative border-t border-white/10 bg-black/45 backdrop-blur-md p-3 sm:p-4 space-y-3">
                {metaChips.length ? (
                    <div className="flex flex-wrap gap-1.5">
                        {metaChips.map((chip) => (
                            <span
                                key={chip}
                                className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-semibold text-white/85"
                            >
                                {chip}
                            </span>
                        ))}
                    </div>
                ) : null}
                {overviewBlocks.length ? (
                    <div className="space-y-2.5">
                        {overviewBlocks.map((block) => (
                            <CompanionOverviewText key={block.key} title={block.title} text={block.text} />
                        ))}
                    </div>
                ) : (
                    <p className="text-xs text-white/60">{unavailableLabel}</p>
                )}
            </div>
        </div>
    );
};

type EpisodeNavItem = {
    episode?: any;
    label: string;
    active?: boolean;
    disabled?: boolean;
    onClick: () => void;
    fallbackArt?: string | null;
};

const CompanionEpisodeNavButton: React.FC<EpisodeNavItem> = ({
    episode,
    label,
    active = false,
    disabled = false,
    onClick,
    fallbackArt = null,
}) => {
    const stillPath = episode?.still_path || fallbackArt;
    return (
        <button
            type="button"
            disabled={disabled}
            onClick={onClick}
            className={`w-full text-left rounded-xl border overflow-hidden transition-all disabled:opacity-45 ${
                active
                    ? 'border-emerald-400/45 bg-emerald-500/10 shadow-[0_0_24px_rgba(52,211,153,0.18)]'
                    : 'border-white/10 bg-black/30 hover:bg-black/45'
            }`}
        >
            <div className="flex items-stretch gap-0">
                <div className="w-24 sm:w-28 shrink-0 aspect-video bg-white/5">
                    {stillPath ? (
                        <img src={posterUrl(stillPath, 'w300')} alt="" className="h-full w-full object-cover" />
                    ) : (
                        <div className="h-full w-full bg-gradient-to-br from-white/10 to-white/5" />
                    )}
                </div>
                <div className="min-w-0 flex-1 px-2.5 py-2 text-xs text-white/85 flex items-center">
                    <span className="line-clamp-2">{label}</span>
                </div>
            </div>
        </button>
    );
};

export const NowPlayingCompanionPanel: React.FC<Props> = ({
    session,
    userKey,
    mediaServerType = 'plex',
    onNavigate,
    onToast,
}) => {
    const { t } = useDiscoverI18n();
    const tmdbId = Number(session?.tmdbId || 0);
    const mediaType = session?.mediaType === 'tv' ? 'tv' : 'movie';
    const seasonNumber = Number(session?.season || 0);
    const episodeNumber = Number(session?.episode || 0);
    const storageKey = `${userKey}:${mediaType}:${tmdbId}`;
    const basePath = Number.isFinite(tmdbId) && tmdbId > 0 ? `/discovery/${mediaType}/${tmdbId}` : '';

    const [open, setOpen] = useState(() => readCompanionExpanded(userKey));
    const [tab, setTab] = useState<'companion' | 'deep-dive' | 'watch-room'>('companion');
    const [payload, setPayload] = useState<CompanionPayload | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [openingLibrary, setOpeningLibrary] = useState(false);
    const [savedToWatchlist, setSavedToWatchlist] = useState(false);
    const [activeQuote, setActiveQuote] = useState('');
    const [pollChoice, setPollChoice] = useState<string | null>(null);
    const [pollVotes, setPollVotes] = useState<PollVotes>({});
    const [reactions, setReactions] = useState<ReactionCounts>({});
    const [ratings, setRatings] = useState<CombinedRatings | null>(null);
    const [factPayload, setFactPayload] = useState<DiscoveryFactPayload | null>(null);
    const [factLoading, setFactLoading] = useState(false);
    const [factSpotlightIndex, setFactSpotlightIndex] = useState(0);

    const title = String(payload?.details?.title || payload?.details?.name || session?.title || t('homeDashboard.nowPlayingCompanion.fallbacks.nowPlaying')).trim();
    const year = formatYear(payload?.details?.release_date || payload?.details?.first_air_date);
    const sessionTitle = String(session?.title || '').trim();
    const playbackKey = String(session?.ratingKey || session?.sourceRatingKey || `${mediaType}:${tmdbId}:${seasonNumber}:${episodeNumber}`);

    useEffect(() => {
        setOpen(readCompanionExpanded(userKey));
    }, [userKey]);

    useEffect(() => {
        setTab('companion');
    }, [mediaType, tmdbId, seasonNumber, episodeNumber]);

    const toggleOpen = useCallback(() => {
        setOpen((prev) => {
            const next = !prev;
            writeCompanionExpanded(userKey, next);
            return next;
        });
    }, [userKey]);

    useEffect(() => {
        const saved = readJsonStorage<Record<string, any>>(LOCAL_WATCHLIST_KEY, {});
        setSavedToWatchlist(!!saved[storageKey]);
    }, [storageKey]);

    useEffect(() => {
        const room = readJsonStorage<Record<string, any>>(LOCAL_ROOM_STATE_KEY, {});
        const reactionSeed = room?.[storageKey]?.reactions || { like: 0, fire: 0, laugh: 0, wow: 0 };
        const pollSeed = room?.[storageKey]?.pollVotes || {
            pacing: 0,
            acting: 0,
            visuals: 0,
            soundtrack: 0,
        };
        setReactions({
            like: Number(reactionSeed.like) || 0,
            fire: Number(reactionSeed.fire) || 0,
            laugh: Number(reactionSeed.laugh) || 0,
            wow: Number(reactionSeed.wow) || 0,
        });
        setPollVotes({
            pacing: Number(pollSeed.pacing) || 0,
            acting: Number(pollSeed.acting) || 0,
            visuals: Number(pollSeed.visuals) || 0,
            soundtrack: Number(pollSeed.soundtrack) || 0,
        });
        setPollChoice(room?.[storageKey]?.pollChoice || null);
    }, [storageKey]);

    useEffect(() => {
        if (!open || !Number.isFinite(tmdbId) || tmdbId <= 0) {
            setPayload(null);
            setLoading(false);
            setError(null);
            return;
        }

        let cancelled = false;
        setLoading(true);
        setError(null);
        setPayload(null);

        const run = async () => {
            const detailPath = `/api/discovery/proxy/${mediaType}/${tmdbId}`;
            const recPath = `/api/discovery/proxy/${mediaType}/${tmdbId}/recommendations`;
            const seasonPath = mediaType === 'tv' && seasonNumber > 0
                ? `/api/discovery/proxy/tv/${tmdbId}/season/${seasonNumber}`
                : '';

            const [details, recRes, seasonDetails] = await Promise.all([
                apiFetch(detailPath).catch(() => null),
                apiFetch(recPath).catch(() => null),
                seasonPath ? apiFetch(seasonPath).catch(() => null) : Promise.resolve(null),
            ]);

            if (cancelled) return;
            if (!details || details?.error) {
                setPayload(null);
                setError('__companion_details_unavailable__');
                return;
            }

            const topCast = Array.isArray(details?.credits?.cast)
                ? details.credits.cast.filter((actor: any) => String(actor?.name || '').trim()).slice(0, 10)
                : [];
            const castInsights = await Promise.all(topCast.map(async (actor: any) => {
                const personId = Number(actor?.id);
                const profilePath = actor?.profile_path || actor?.profilePath || null;
                if (!Number.isFinite(personId) || personId <= 0) {
                    return {
                        id: Number(actor?.id || 0),
                        name: String(actor?.name || '').trim(),
                        character: String(actor?.character || '').trim(),
                        profilePath,
                        popularity: Number(actor?.popularity) || 0,
                        knownForDepartment: String(actor?.known_for_department || actor?.knownForDepartment || '').trim(),
                        birthday: '',
                        placeOfBirth: '',
                        biographySnippet: '',
                        knownFor: [],
                    } as CastInsight;
                }
                const [credits, personDetails] = await Promise.all([
                    apiFetch(`/api/discovery/proxy/person/${personId}/combined_credits`).catch(() => null),
                    apiFetch(`/api/discovery/proxy/person/${personId}`).catch(() => null),
                ]);
                const biographyRaw = String(personDetails?.biography || '').trim();
                const biographySnippet = biographyRaw
                    ? biographyRaw.replace(/\s+/g, ' ').slice(0, 180)
                    : '';
                return {
                    id: personId,
                    name: String(actor?.name || '').trim(),
                    character: String(actor?.character || '').trim(),
                    profilePath: profilePath || personDetails?.profile_path || personDetails?.profilePath || null,
                    popularity: Number(actor?.popularity ?? personDetails?.popularity) || 0,
                    knownForDepartment: String(
                        actor?.known_for_department
                        || actor?.knownForDepartment
                        || personDetails?.known_for_department
                        || personDetails?.knownForDepartment
                        || '',
                    ).trim(),
                    birthday: String(personDetails?.birthday || '').trim(),
                    placeOfBirth: String(personDetails?.place_of_birth || personDetails?.placeOfBirth || '').trim(),
                    biographySnippet,
                    knownFor: buildKnownFor(credits, tmdbId),
                } as CastInsight;
            }));

            const allCrew = Array.isArray(details?.credits?.crew) ? details.credits.crew : [];
            const crewJobsByPerson = new Map<number, string[]>();
            for (const entry of allCrew) {
                const personId = Number(entry?.id);
                const job = String(entry?.job || '').trim();
                if (!Number.isFinite(personId) || personId <= 0 || !job) continue;
                const jobs = crewJobsByPerson.get(personId) || [];
                if (!jobs.includes(job)) jobs.push(job);
                crewJobsByPerson.set(personId, jobs);
            }
            const featuredCrewEntries: any[] = [];
            const featuredCrewIds = new Set<number>();
            for (const entry of sortKeyCrew(allCrew)) {
                const personId = Number(entry?.id);
                if (!Number.isFinite(personId) || personId <= 0 || featuredCrewIds.has(personId)) continue;
                featuredCrewIds.add(personId);
                featuredCrewEntries.push(entry);
                if (featuredCrewEntries.length >= 8) break;
            }
            const crewInsights = await Promise.all(featuredCrewEntries.map(async (member: any) => {
                const personId = Number(member?.id);
                const primaryJob = String(member?.job || '').trim();
                const profilePath = member?.profile_path || member?.profilePath || null;
                const allJobs = crewJobsByPerson.get(personId) || (primaryJob ? [primaryJob] : []);
                const otherCredits = allJobs.filter((job) => job !== primaryJob);
                if (!Number.isFinite(personId) || personId <= 0) {
                    return {
                        id: 0,
                        name: String(member?.name || '').trim(),
                        job: primaryJob,
                        department: String(member?.department || '').trim(),
                        profilePath,
                        popularity: 0,
                        biographySnippet: '',
                        knownFor: [],
                        otherCredits,
                    } as CrewInsight;
                }
                const [credits, personDetails] = await Promise.all([
                    apiFetch(`/api/discovery/proxy/person/${personId}/combined_credits`).catch(() => null),
                    apiFetch(`/api/discovery/proxy/person/${personId}`).catch(() => null),
                ]);
                const biographyRaw = String(personDetails?.biography || '').trim();
                const biographySnippet = biographyRaw
                    ? biographyRaw.replace(/\s+/g, ' ').slice(0, 180)
                    : '';
                return {
                    id: personId,
                    name: String(member?.name || personDetails?.name || '').trim(),
                    job: primaryJob,
                    department: String(
                        member?.department
                        || personDetails?.known_for_department
                        || personDetails?.knownForDepartment
                        || '',
                    ).trim(),
                    profilePath: profilePath || personDetails?.profile_path || personDetails?.profilePath || null,
                    popularity: Number(member?.popularity ?? personDetails?.popularity) || 0,
                    biographySnippet,
                    knownFor: buildKnownFor(credits, tmdbId),
                    otherCredits,
                } as CrewInsight;
            }));

            if (cancelled) return;
            const rawRecommendations = normalizeRecommendations(recRes?.results || []).slice(0, 20);
            const enrichedRecommendations = await enrichDiscoverItemsWithAvailability(rawRecommendations);
            const requestableRecommendations = enrichedRecommendations
                .filter(isRequestableRecommendation)
                .slice(0, 6);
            if (cancelled) return;
            setPayload({
                details,
                recommendations: requestableRecommendations,
                castInsights,
                crewInsights,
                soundtrackPeople: extractSoundtrackPeople(allCrew),
                seasonDetails,
            });
        };

        run()
            .catch((fetchError: any) => {
                if (cancelled) return;
                setPayload(null);
                setError(String(fetchError?.message || '__companion_load_failed__'));
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [open, mediaType, tmdbId, seasonNumber]);

    useEffect(() => {
        if (!open || !Number.isFinite(tmdbId) || tmdbId <= 0) {
            setRatings(null);
            return;
        }
        let cancelled = false;
        fetchCombinedRatings(mediaType, tmdbId)
            .then((res) => {
                if (cancelled) return;
                setRatings(res || null);
            })
            .catch(() => {
                if (cancelled) return;
                setRatings(null);
            });
        return () => {
            cancelled = true;
        };
    }, [open, mediaType, tmdbId]);

    useEffect(() => {
        if (!open || !Number.isFinite(tmdbId) || tmdbId <= 0) {
            setFactPayload(null);
            setFactLoading(false);
            return;
        }
        let cancelled = false;
        setFactLoading(true);
        setFactPayload(null);
        const factQuery = new URLSearchParams({
            mediaType,
            mediaId: String(tmdbId),
        });
        if (sessionTitle) factQuery.set('title', sessionTitle);
        apiFetch(`/api/discovery/fact?${factQuery.toString()}`)
            .then((res) => {
                if (cancelled) return;
                setFactPayload(res && typeof res === 'object' ? res : null);
            })
            .catch(() => {
                if (cancelled) return;
                setFactPayload(null);
            })
            .finally(() => {
                if (cancelled) return;
                setFactLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [open, mediaType, tmdbId, playbackKey, sessionTitle]);

    const normalizedDetails = useMemo(() => {
        const details = payload?.details;
        if (!details || typeof details !== 'object') return null;
        return {
            ...details,
            releaseDate: details.releaseDate || details.release_date || null,
            firstAirDate: details.firstAirDate || details.first_air_date || null,
            lastAirDate: details.lastAirDate || details.last_air_date || null,
            originalLanguage: details.originalLanguage || details.original_language || null,
            productionCountries: details.productionCountries || details.production_countries || [],
            productionCompanies: details.productionCompanies || details.production_companies || [],
            originalTitle: details.originalTitle || details.original_title || null,
            originalName: details.originalName || details.original_name || null,
            episodeRunTime: details.episodeRunTime || details.episode_run_time || [],
            createdBy: details.createdBy || details.created_by || [],
            externalIds: details.externalIds || details.external_ids || null,
            imdbId: details.imdbId || details.imdb_id || null,
        };
    }, [payload?.details]);

    const productionFacts = useMemo(() => (
        normalizedDetails ? buildMediaFactRows(mediaType, normalizedDetails).slice(0, 8) : []
    ), [mediaType, normalizedDetails]);

    const externalLinks = useMemo(() => (
        normalizedDetails ? buildExternalLinks(mediaType, normalizedDetails, ratings) : []
    ), [mediaType, normalizedDetails, ratings]);

    const episodeContext = useMemo(() => {
        if (mediaType !== 'tv' || !payload?.seasonDetails || !seasonNumber || !episodeNumber) {
            return { current: null, previous: null, next: null };
        }
        const episodes = Array.isArray(payload.seasonDetails?.episodes) ? payload.seasonDetails.episodes : [];
        const index = episodes.findIndex((ep: any) => Number(ep?.episode_number) === episodeNumber);
        const current = index >= 0 ? episodes[index] : null;
        const previous = index > 0 ? episodes[index - 1] : null;
        const next = index >= 0 && index < episodes.length - 1 ? episodes[index + 1] : null;
        return { current, previous, next };
    }, [episodeNumber, mediaType, payload?.seasonDetails, seasonNumber]);

    const timelineFacts = useMemo(() => {
        const details = payload?.details;
        if (!details) return [];
        const facts: Array<{ label: string; value: string }> = [];
        const releaseDate = String(details?.release_date || details?.first_air_date || '').trim();
        const runtime = Number(details?.runtime || 0);
        const avgRuntime = Number(Array.isArray(details?.episode_run_time) ? details.episode_run_time[0] : 0);
        const genres = Array.isArray(details?.genres)
            ? details.genres.map((g: any) => String(g?.name || '').trim()).filter(Boolean).slice(0, 3)
            : [];
        const vote = Number(details?.vote_average || 0);
        const status = String(details?.status || '').trim();

        if (releaseDate) facts.push({ label: t('homeDashboard.nowPlayingCompanion.timeline.release'), value: releaseDate });
        if (runtime > 0) facts.push({ label: t('homeDashboard.nowPlayingCompanion.timeline.runtime'), value: t('common.runtimeMin', { count: runtime }) });
        else if (avgRuntime > 0) facts.push({ label: t('homeDashboard.nowPlayingCompanion.timeline.episodeRuntime'), value: t('common.runtimeMin', { count: avgRuntime }) });
        if (genres.length) facts.push({ label: t('homeDashboard.nowPlayingCompanion.timeline.genres'), value: genres.join(' / ') });
        if (vote > 0) facts.push({ label: t('homeDashboard.nowPlayingCompanion.timeline.tmdbScore'), value: `${vote.toFixed(1)} / 10` });
        if (status) facts.push({ label: t('homeDashboard.nowPlayingCompanion.timeline.status'), value: status });
        if (mediaType === 'tv' && seasonNumber > 0 && episodeNumber > 0) {
            const epName = String(episodeContext.current?.name || session?.episodeTitle || '').trim();
            const epAirDate = String(episodeContext.current?.air_date || '').trim();
            facts.push({
                label: t('homeDashboard.nowPlayingCompanion.timeline.currentEpisode'),
                value: `S${seasonNumber}E${episodeNumber}${epName ? ` - ${epName}` : ''}`,
            });
            if (epAirDate) facts.push({ label: t('homeDashboard.nowPlayingCompanion.timeline.episodeAirDate'), value: epAirDate });
        }
        return facts;
    }, [episodeContext.current?.air_date, episodeContext.current?.name, episodeNumber, mediaType, payload?.details, seasonNumber, session?.episodeTitle, t]);

    const companionMetaChips = useMemo(() => {
        const details = payload?.details;
        if (!details) return [] as string[];
        const chips: string[] = [];
        const genres = Array.isArray(details?.genres)
            ? details.genres.map((genre: any) => String(genre?.name || '').trim()).filter(Boolean).slice(0, 3)
            : [];
        if (genres.length) chips.push(genres.join(' · '));
        const status = String(details?.status || '').trim();
        if (status) chips.push(status);
        const runtime = Number(details?.runtime || 0);
        const avgRuntime = Number(Array.isArray(details?.episode_run_time) ? details.episode_run_time[0] : 0);
        if (mediaType === 'movie' && runtime > 0) chips.push(t('common.runtimeMin', { count: runtime }));
        else if (mediaType === 'tv' && avgRuntime > 0) chips.push(t('common.runtimeMin', { count: avgRuntime }));
        const vote = Number(details?.vote_average || 0);
        if (vote > 0) chips.push(`${vote.toFixed(1)} TMDB`);
        const createdBy = Array.isArray(details?.created_by)
            ? details.created_by.map((person: any) => String(person?.name || '').trim()).filter(Boolean).slice(0, 2)
            : [];
        if (createdBy.length) chips.push(createdBy.join(', '));
        return chips;
    }, [mediaType, payload?.details, t]);

    const companionOverviewBlocks = useMemo(() => {
        const details = payload?.details;
        if (!details) return [] as Array<{ key: string; title: string; text: string }>;
        const blocks: Array<{ key: string; title: string; text: string }> = [];
        const pushBlock = (key: string, blockTitle: string, text: unknown) => {
            const value = String(text || '').trim();
            if (!value) return;
            if (blocks.some((block) => block.text === value)) return;
            blocks.push({ key, title: blockTitle, text: value });
        };

        if (mediaType === 'tv' && seasonNumber > 0 && episodeNumber > 0) {
            const episodeName = String(
                episodeContext.current?.name
                || session?.episodeTitle
                || '',
            ).trim();
            pushBlock(
                'episode',
                episodeName
                    ? t('homeDashboard.nowPlayingCompanion.overview.episodeWithName', {
                        season: seasonNumber,
                        episode: episodeNumber,
                        name: episodeName,
                    })
                    : t('homeDashboard.nowPlayingCompanion.overview.episode', {
                        season: seasonNumber,
                        episode: episodeNumber,
                    }),
                episodeContext.current?.overview,
            );
        }

        if (mediaType === 'tv' && seasonNumber > 0) {
            pushBlock(
                'season',
                t('homeDashboard.nowPlayingCompanion.overview.season', { season: seasonNumber }),
                payload?.seasonDetails?.overview,
            );
        }

        if (mediaType === 'tv') {
            pushBlock(
                'series',
                t('homeDashboard.nowPlayingCompanion.overview.show'),
                details.overview,
            );
        } else {
            pushBlock(
                'movie',
                t('homeDashboard.nowPlayingCompanion.overview.movie'),
                details.overview,
            );
        }

        return blocks;
    }, [
        episodeContext.current?.name,
        episodeContext.current?.overview,
        episodeNumber,
        mediaType,
        payload?.details,
        payload?.seasonDetails?.overview,
        seasonNumber,
        session?.episodeTitle,
        t,
    ]);

    const companionTagline = useMemo(() => {
        const tagline = String(payload?.details?.tagline || '').trim();
        return tagline || '';
    }, [payload?.details?.tagline]);

    const companionPosterPath = payload?.details?.poster_path || payload?.details?.posterPath || null;
    const companionBackdropPath = payload?.details?.backdrop_path || payload?.details?.backdropPath || null;
    const companionSeasonPosterPath = payload?.seasonDetails?.poster_path || payload?.seasonDetails?.posterPath || null;
    const companionEpisodeStillPath = episodeContext.current?.still_path || episodeContext.current?.stillPath || null;
    const companionHeroArtPath = companionEpisodeStillPath || companionBackdropPath || companionSeasonPosterPath || companionPosterPath;
    const companionAmbientArtPath = companionBackdropPath || companionEpisodeStillPath || companionSeasonPosterPath || companionPosterPath;
    const companionEpisodeArtFallback = companionSeasonPosterPath || companionPosterPath;
    const sessionProgress = Math.round(Number(session.progress) || 0);
    const episodeDisplayTitle = String(
        episodeContext.current?.name
        || session?.episodeTitle
        || '',
    ).trim();

    const quoteMoments = useMemo(() => {
        const source = String(
            episodeContext.current?.overview
            || payload?.details?.overview
            || '',
        ).trim();
        if (!source) return [];
        const parts = source
            .split(/(?<=[.!?])\s+/)
            .map((part) => part.trim())
            .filter((part) => part.length >= 24)
            .slice(0, 3);
        if (parts.length) return parts;
        return [source.slice(0, 160)];
    }, [episodeContext.current?.overview, payload?.details?.overview]);

    const triviaFacts = useMemo(() => {
        const details = normalizedDetails;
        if (!details) return [] as string[];
        const facts: string[] = [];
        const voteAverage = Number(details.voteAverage ?? details.vote_average ?? 0);
        const voteCount = Number(details.voteCount ?? details.vote_count ?? 0);
        const popularity = Number(details.popularity || 0);
        const runtime = Number(details.runtime || 0);
        const episodeRunTime = Number(Array.isArray(details.episodeRunTime) ? details.episodeRunTime[0] : 0);
        const seasonCount = Number(details.numberOfSeasons ?? details.number_of_seasons ?? 0);
        const episodeCount = Number(details.numberOfEpisodes ?? details.number_of_episodes ?? 0);
        const originCountries = Array.isArray(details.originCountry || details.origin_country)
            ? (details.originCountry || details.origin_country)
            : [];
        const studios = Array.isArray(details.productionCompanies)
            ? details.productionCompanies.map((studio: any) => String(studio?.name || '').trim()).filter(Boolean)
            : [];
        const topCast = payload?.castInsights?.slice(0, 3) || [];
        const budget = Number(details.budget || 0);
        const revenue = Number(details.revenue || 0);

        if (voteAverage > 0 && voteCount > 0) {
            facts.push(t('homeDashboard.nowPlayingCompanion.facts.communityScore', { score: voteAverage.toFixed(1), votes: voteCount.toLocaleString() }));
        }
        if (popularity > 0) {
            facts.push(t('homeDashboard.nowPlayingCompanion.facts.popularity', { value: popularity.toFixed(1) }));
        }
        if (mediaType === 'movie' && runtime > 0) {
            facts.push(t('homeDashboard.nowPlayingCompanion.facts.movieRuntime', { value: runtime }));
        }
        if (mediaType === 'tv' && episodeRunTime > 0) {
            facts.push(t('homeDashboard.nowPlayingCompanion.facts.episodeRuntime', { value: episodeRunTime }));
        }
        if (mediaType === 'tv' && seasonCount > 0) {
            facts.push(t('homeDashboard.nowPlayingCompanion.facts.seriesSummary', { seasons: seasonCount, episodes: episodeCount > 0 ? episodeCount : t('homeDashboard.nowPlayingCompanion.facts.multipleEpisodes') }));
        }
        if (originCountries.length) {
            facts.push(t('homeDashboard.nowPlayingCompanion.facts.originCountry', { countries: originCountries.join(', ') }));
        }
        if (studios.length) {
            const additionalStudioCount = Math.max(0, studios.length - 2);
            facts.push(t('homeDashboard.nowPlayingCompanion.facts.producedBy', {
                studios: studios.slice(0, 2).join(', '),
                count: additionalStudioCount > 0 ? ` (+${additionalStudioCount})` : '',
            }));
        }
        if (mediaType === 'movie' && budget > 0) {
            facts.push(t('homeDashboard.nowPlayingCompanion.facts.budget', { value: budget.toLocaleString() }));
        }
        if (mediaType === 'movie' && revenue > 0) {
            facts.push(t('homeDashboard.nowPlayingCompanion.facts.revenue', { value: revenue.toLocaleString() }));
        }
        if (mediaType === 'movie' && budget > 0 && revenue > 0) {
            const ratio = revenue / budget;
            if (Number.isFinite(ratio) && ratio > 1) {
                facts.push(t('homeDashboard.nowPlayingCompanion.facts.returnOnBudget', { ratio: ratio.toFixed(1) }));
            }
        }
        if (topCast.length) {
            facts.push(t('homeDashboard.nowPlayingCompanion.facts.topBilled', { names: topCast.map((person) => person.name).join(', ') }));
        }
        if (episodeContext.current?.air_date) {
            facts.push(t('homeDashboard.nowPlayingCompanion.facts.currentEpisodeAired', { date: episodeContext.current.air_date }));
        }

        return facts.slice(0, 8);
    }, [episodeContext.current?.air_date, mediaType, normalizedDetails, payload?.castInsights, t]);

    const crewInsights = payload?.crewInsights || [];

    const companionProductionStudios = useMemo(
        () => (normalizedDetails ? getProductionStudios(normalizedDetails) : []),
        [normalizedDetails],
    );

    const companionNetworks = useMemo(() => {
        const networks = Array.isArray(payload?.details?.networks) ? payload.details.networks : [];
        return networks
            .map((network: any) => String(network?.name || '').trim())
            .filter(Boolean)
            .slice(0, 4);
    }, [payload?.details?.networks]);

    const companionProductionRows = useMemo(() => {
        if (!normalizedDetails) return [] as Array<{ key: string; value: string; people?: Array<{ id: number; name: string }> }>;
        return buildMediaFactRows(mediaType, normalizedDetails)
            .slice(0, 6)
            .map((row) => ({
                key: row.key,
                value: row.key === 'status' ? translateDiscoverStatus(t, row.value) : row.value,
                people: row.people,
            }));
    }, [mediaType, normalizedDetails, t]);

    const companionExtendedCrew = useMemo(() => {
        const crew = Array.isArray(payload?.details?.credits?.crew) ? payload.details.credits.crew : [];
        if (!crew.length) return [] as Array<{ department: string; members: Array<{ id: number; name: string; job: string }> }>;
        const featuredIds = new Set(crewInsights.map((entry) => entry.id).filter((id) => id > 0));
        const byDepartment = new Map<string, Array<{ id: number; name: string; job: string }>>();
        for (const entry of crew) {
            const id = Number(entry?.id);
            const name = String(entry?.name || '').trim();
            const job = String(entry?.job || '').trim();
            const department = String(entry?.department || 'Crew').trim() || 'Crew';
            if (!name || !job || (id > 0 && featuredIds.has(id))) continue;
            const members = byDepartment.get(department) || [];
            const key = `${id}:${job}`;
            if (members.some((member) => `${member.id}:${member.job}` === key)) continue;
            members.push({ id, name, job });
            byDepartment.set(department, members);
        }
        return Array.from(byDepartment.entries())
            .map(([department, members]) => ({ department, members: members.slice(0, 5) }))
            .filter((group) => group.members.length > 0)
            .sort((left, right) => right.members.length - left.members.length)
            .slice(0, 4);
    }, [crewInsights, payload?.details?.credits?.crew]);

    const overloadFacts = useMemo(() => {
        const apiFacts = Array.isArray(factPayload?.facts) ? factPayload.facts : [];
        const titleTokens = sessionTitle.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 4);
        const relatesToSession = (text: string) => {
            if (!titleTokens.length) return true;
            const lower = text.toLowerCase();
            return titleTokens.some((token) => lower.includes(token));
        };
        const scopedApiFacts = titleTokens.length
            ? apiFacts.filter((fact) => relatesToSession(String(fact || '')))
            : apiFacts;
        const combined = [...scopedApiFacts, ...triviaFacts];
        const seen = new Set<string>();
        const out: string[] = [];
        for (const raw of combined) {
            const text = String(raw || '').trim();
            if (!text) continue;
            const key = text.toLowerCase().replace(/\s+/g, ' ').slice(0, 240);
            if (seen.has(key)) continue;
            seen.add(key);
            out.push(text);
            if (out.length >= 14) break;
        }
        return out;
    }, [factPayload?.facts, triviaFacts, sessionTitle]);

    useEffect(() => {
        setFactSpotlightIndex(0);
    }, [playbackKey, mediaType]);

    useEffect(() => {
        if (factSpotlightIndex >= overloadFacts.length) {
            setFactSpotlightIndex(0);
        }
    }, [factSpotlightIndex, overloadFacts.length]);

    useEffect(() => {
        if (!open || tab !== 'companion' || factLoading || overloadFacts.length <= 1) return undefined;
        const timer = window.setInterval(() => {
            setFactSpotlightIndex((prev) => ((prev + 1) % overloadFacts.length));
        }, 3200);
        return () => window.clearInterval(timer);
    }, [factLoading, open, overloadFacts.length, tab]);

    const bumpReaction = useCallback((key: string) => {
        setReactions((prev) => {
            const next = { ...prev, [key]: (Number(prev[key]) || 0) + 1 };
            const room = readJsonStorage<Record<string, any>>(LOCAL_ROOM_STATE_KEY, {});
            room[storageKey] = {
                ...(room[storageKey] || {}),
                reactions: next,
                pollVotes,
                pollChoice,
                updatedAt: new Date().toISOString(),
            };
            writeJsonStorage(LOCAL_ROOM_STATE_KEY, room);
            return next;
        });
    }, [pollChoice, pollVotes, storageKey]);

    const votePoll = useCallback((optionId: string) => {
        setPollVotes((prev) => {
            const next = { ...prev };
            if (pollChoice && pollChoice !== optionId) {
                next[pollChoice] = Math.max(0, (Number(next[pollChoice]) || 0) - 1);
            }
            if (pollChoice !== optionId) {
                next[optionId] = (Number(next[optionId]) || 0) + 1;
            }
            const room = readJsonStorage<Record<string, any>>(LOCAL_ROOM_STATE_KEY, {});
            room[storageKey] = {
                ...(room[storageKey] || {}),
                reactions,
                pollVotes: next,
                pollChoice: optionId,
                updatedAt: new Date().toISOString(),
            };
            writeJsonStorage(LOCAL_ROOM_STATE_KEY, room);
            return next;
        });
        setPollChoice(optionId);
    }, [pollChoice, reactions, storageKey]);

    const totalPollVotes = useMemo(
        () => Object.values(pollVotes).reduce((sum, value) => sum + (Number(value) || 0), 0),
        [pollVotes],
    );

    const goToPath = (path: string) => {
        if (!path || !onNavigate) return;
        onNavigate(path);
    };

    const requestSimilar = (item?: Recommendation | null) => {
        if (!item || !onNavigate) return;
        onNavigate(`/discovery/${item.mediaType}/${item.id}?request=1`);
    };

    const toggleLocalWatchlist = () => {
        if (!Number.isFinite(tmdbId) || tmdbId <= 0) return;
        const current = readJsonStorage<Record<string, any>>(LOCAL_WATCHLIST_KEY, {});
        if (current[storageKey]) {
            delete current[storageKey];
            writeJsonStorage(LOCAL_WATCHLIST_KEY, current);
            setSavedToWatchlist(false);
            onToast?.(t('homeDashboard.nowPlayingCompanion.toasts.watchlistRemoved'), 'success');
            return;
        }
        current[storageKey] = {
            userKey,
            mediaType,
            tmdbId,
            title,
            year,
            posterPath: payload?.details?.poster_path || null,
            savedAt: new Date().toISOString(),
        };
        writeJsonStorage(LOCAL_WATCHLIST_KEY, current);
        setSavedToWatchlist(true);
        onToast?.(t('homeDashboard.nowPlayingCompanion.toasts.watchlistSaved'), 'success');
    };

    const openInLibrary = async () => {
        if (!Number.isFinite(tmdbId) || tmdbId <= 0 || openingLibrary) return;
        setOpeningLibrary(true);
        try {
            const params = new URLSearchParams({
                mediaType,
                tmdbId: String(tmdbId),
                title,
            });
            if (year) params.set('year', year);
            const payloadRes = await apiFetch(`/api/discovery/library-link?${params.toString()}`);
            if (payloadRes?.url) {
                window.open(String(payloadRes.url), '_blank', 'noopener,noreferrer');
            } else {
                throw new Error('__companion_provider_link_unavailable__');
            }
        } catch (openError: any) {
            const message = String(openError?.message || '__companion_provider_open_failed__');
            onToast?.(message === '__companion_provider_link_unavailable__' ? t('homeDashboard.nowPlayingCompanion.errors.providerLinkUnavailable') : message === '__companion_provider_open_failed__' ? t('homeDashboard.nowPlayingCompanion.errors.providerOpenFailed') : message, 'error');
        } finally {
            setOpeningLibrary(false);
        }
    };

    const jumpToQuoteContext = async (quote: string) => {
        setActiveQuote(quote);
        if (!onNavigate || !basePath) return;
        if (mediaType === 'tv' && seasonNumber > 0) {
            const qs = new URLSearchParams({ season: String(seasonNumber) });
            if (episodeNumber > 0) qs.set('episode', String(episodeNumber));
            onNavigate(`${basePath}?${qs.toString()}`);
        } else {
            onNavigate(basePath);
        }
        onToast?.(t('homeDashboard.nowPlayingCompanion.toasts.openedDiscoverContext'), 'success');
        if (navigator?.clipboard?.writeText) {
            try {
                await navigator.clipboard.writeText(quote);
            } catch {
                // Ignore clipboard write failures.
            }
        }
    };

    const copyRoomSummary = async () => {
        const summary = `${title}${year ? ` (${year})` : ''} - ${mediaType.toUpperCase()} - ${t('homeDashboard.nowPlayingCompanion.summary.progress', { progress: Math.round(Number(session.progress) || 0) })}`;
        if (navigator?.clipboard?.writeText) {
            try {
                await navigator.clipboard.writeText(summary);
                onToast?.(t('homeDashboard.nowPlayingCompanion.toasts.summaryCopied'), 'success');
                return;
            } catch {
                // fall through
            }
        }
        onToast?.(t('homeDashboard.nowPlayingCompanion.toasts.clipboardUnavailable'), 'error');
    };

    const providerLabel = String(mediaServerType || '').toLowerCase() === 'jellyfin'
        ? 'Jellyfin'
        : String(mediaServerType || '').toLowerCase() === 'emby'
            ? 'Emby'
            : 'Plex';
    const playbackTelemetry = [
        { label: t('homeDashboard.nowPlayingCompanion.telemetry.state'), value: String(session.state || 'playing').toLowerCase() === 'playing' ? t('homeDashboard.nowPlayingCompanion.telemetry.playing') : String(session.state || '').toLowerCase() === 'paused' ? t('nowPlaying.paused') : String(session.state || 'playing').toUpperCase() },
        { label: t('homeDashboard.nowPlayingCompanion.telemetry.progress'), value: `${Math.round(Number(session.progress) || 0)}%` },
        { label: t('homeDashboard.nowPlayingCompanion.telemetry.mediaType'), value: mediaType === 'tv' ? t('mediaType.tv') : t('mediaType.movie') },
        ...(seasonNumber > 0 && episodeNumber > 0
            ? [{ label: t('homeDashboard.nowPlayingCompanion.telemetry.episode'), value: `S${seasonNumber}E${episodeNumber}` }]
            : []),
    ];
    const firstRecommendation = payload?.recommendations?.[0] || null;
    const leadCast = payload?.castInsights?.[0] || null;
    const nextEpisodeNumber = Number(episodeContext.next?.episode_number || 0);
    const nextBestAction = (() => {
        if (
            mediaType === 'tv'
            && seasonNumber > 0
            && Number.isFinite(nextEpisodeNumber)
            && nextEpisodeNumber > 0
            && basePath
        ) {
            const nextName = String(episodeContext.next?.name || '').trim();
            return {
                tone: 'sky' as const,
                title: t('homeDashboard.nowPlayingCompanion.nextAction.continueTitle'),
                hint: nextName
                    ? t('homeDashboard.nowPlayingCompanion.nextAction.continueHintWithName', { season: seasonNumber, episode: nextEpisodeNumber, name: nextName })
                    : t('homeDashboard.nowPlayingCompanion.nextAction.continueHint', { season: seasonNumber, episode: nextEpisodeNumber }),
                cta: t('homeDashboard.nowPlayingCompanion.actions.openNextEpisode'),
                onClick: () => goToPath(`${basePath}?season=${seasonNumber}&episode=${nextEpisodeNumber}`),
            };
        }
        if (firstRecommendation) {
            return {
                tone: 'violet' as const,
                title: t('homeDashboard.nowPlayingCompanion.nextAction.queueSimilarTitle'),
                hint: t('homeDashboard.nowPlayingCompanion.nextAction.queueSimilarHint', { title: firstRecommendation.title, year: firstRecommendation.year || '' }),
                cta: t('homeDashboard.nowPlayingCompanion.actions.requestSimilar'),
                onClick: () => requestSimilar(firstRecommendation),
            };
        }
        if (leadCast && Number.isFinite(leadCast.id) && leadCast.id > 0) {
            return {
                tone: 'emerald' as const,
                title: t('homeDashboard.nowPlayingCompanion.nextAction.exploreActorTitle'),
                hint: t('homeDashboard.nowPlayingCompanion.nextAction.exploreActorHint', { name: leadCast.name }),
                cta: t('homeDashboard.nowPlayingCompanion.actions.openActorProfile'),
                onClick: () => goToPath(`/discovery/person/${leadCast.id}`),
            };
        }
        if (!savedToWatchlist) {
            return {
                tone: 'emerald' as const,
                title: t('homeDashboard.nowPlayingCompanion.nextAction.saveForLaterTitle'),
                hint: t('homeDashboard.nowPlayingCompanion.nextAction.saveForLaterHint'),
                cta: t('homeDashboard.nowPlayingCompanion.actions.saveToWatchlist'),
                onClick: toggleLocalWatchlist,
            };
        }
        if (basePath) {
            return {
                tone: 'emerald' as const,
                title: t('homeDashboard.nowPlayingCompanion.nextAction.diveDetailsTitle'),
                hint: t('homeDashboard.nowPlayingCompanion.nextAction.diveDetailsHint'),
                cta: t('homeDashboard.nowPlayingCompanion.actions.openDetails'),
                onClick: () => goToPath(basePath),
            };
        }
        return null;
    })();

    return (
        <div className="glass-card mt-4 relative overflow-hidden border border-emerald-500/25 bg-black/25">
            <CompanionArtBackdrop imagePath={open ? companionAmbientArtPath : null} />
            <div className="relative z-[1] p-3 sm:p-4 md:p-5">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <button
                    type="button"
                    onClick={toggleOpen}
                    className="min-w-0 text-left rounded-lg -m-1 p-1 hover:bg-white/5 transition-colors flex items-start gap-3"
                    aria-expanded={open}
                >
                    {companionPosterPath ? (
                        <img
                            src={posterUrl(companionPosterPath, 'w185')}
                            alt=""
                            className="w-11 h-16 rounded-lg border border-white/20 object-cover shadow-lg shrink-0 hidden sm:block"
                        />
                    ) : null}
                    <div className="min-w-0">
                    <h3 className="text-sm sm:text-base font-black uppercase tracking-wider text-emerald-200 flex items-center gap-2">
                        <Sparkles className="w-4 h-4" />
                        {t('homeDashboard.nowPlayingCompanion.header.title')}
                    </h3>
                    <p className="text-xs text-white/70 mt-1">
                        {year ? t('homeDashboard.nowPlayingCompanion.header.subtitleWithYear', { title, year }) : t('homeDashboard.nowPlayingCompanion.header.subtitle', { title })}
                    </p>
                    </div>
                </button>
                <div className="flex items-center justify-end">
                    <button
                        type="button"
                        onClick={toggleOpen}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-white/20 bg-white/5 text-xs font-bold text-white hover:bg-white/10 transition-colors"
                        aria-expanded={open}
                    >
                        {open ? (
                            <>
                                {t('homeDashboard.nowPlayingCompanion.actions.collapse')} <ChevronUp className="w-3.5 h-3.5" />
                            </>
                        ) : (
                            <>
                                {t('homeDashboard.nowPlayingCompanion.actions.expand')} <ChevronDown className="w-3.5 h-3.5" />
                            </>
                        )}
                    </button>
                </div>
            </div>

            {!open ? null : (
                <div className="mt-4 space-y-4">
                    <div className="grid grid-cols-3 sm:flex sm:flex-wrap gap-2">
                        <button
                            type="button"
                            onClick={() => setTab('companion')}
                            className={`px-2 sm:px-3 py-1.5 rounded-lg text-[11px] sm:text-xs font-bold border transition-colors ${
                                tab === 'companion'
                                    ? 'border-emerald-400/50 bg-emerald-500/20 text-emerald-100'
                                    : 'border-white/15 bg-white/5 text-white/80 hover:bg-white/10'
                            }`}
                        >
                            {t('homeDashboard.nowPlayingCompanion.tabs.companion')}
                        </button>
                        <button
                            type="button"
                            onClick={() => setTab('deep-dive')}
                            className={`px-2 sm:px-3 py-1.5 rounded-lg text-[11px] sm:text-xs font-bold border transition-colors ${
                                tab === 'deep-dive'
                                    ? 'border-violet-400/50 bg-violet-500/20 text-violet-100'
                                    : 'border-white/15 bg-white/5 text-white/80 hover:bg-white/10'
                            }`}
                        >
                            {t('homeDashboard.nowPlayingCompanion.tabs.deepDive')}
                        </button>
                        <button
                            type="button"
                            onClick={() => setTab('watch-room')}
                            className={`px-2 sm:px-3 py-1.5 rounded-lg text-[11px] sm:text-xs font-bold border transition-colors ${
                                tab === 'watch-room'
                                    ? 'border-sky-400/50 bg-sky-500/20 text-sky-100'
                                    : 'border-white/15 bg-white/5 text-white/80 hover:bg-white/10'
                            }`}
                        >
                            {t('homeDashboard.nowPlayingCompanion.tabs.watchRoom')}
                        </button>
                    </div>

                    {!Number.isFinite(tmdbId) || tmdbId <= 0 ? (
                        <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-white/70">
                            {t('homeDashboard.nowPlayingCompanion.errors.noTmdbContext')}
                        </div>
                    ) : loading ? (
                        <div className="rounded-xl border border-white/10 bg-white/5 p-4 flex items-center gap-2 text-sm text-white/80">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            {t('homeDashboard.nowPlayingCompanion.loading.context')}
                        </div>
                    ) : error ? (
                        <div className="rounded-xl border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-200">
                            {error === '__companion_details_unavailable__' ? t('homeDashboard.nowPlayingCompanion.errors.detailsUnavailable') : error === '__companion_load_failed__' ? t('homeDashboard.nowPlayingCompanion.errors.loadFailed') : error}
                        </div>
                    ) : null}

                    {tab === 'companion' && payload && (
                        <div className="space-y-4">
                            {nextBestAction ? (
                                <div className={`relative overflow-hidden rounded-xl border p-3 ${
                                    nextBestAction.tone === 'violet'
                                        ? 'border-violet-400/30 bg-violet-500/10'
                                        : nextBestAction.tone === 'sky'
                                            ? 'border-sky-400/30 bg-sky-500/10'
                                            : 'border-emerald-400/30 bg-emerald-500/10'
                                }`}>
                                    {firstRecommendation?.posterPath ? (
                                        <img
                                            src={posterUrl(firstRecommendation.posterPath, 'w185')}
                                            alt=""
                                            className="pointer-events-none absolute -right-3 -bottom-6 w-24 rounded-lg border border-white/15 opacity-35 rotate-6 shadow-2xl"
                                        />
                                    ) : companionPosterPath ? (
                                        <img
                                            src={posterUrl(companionPosterPath, 'w185')}
                                            alt=""
                                            className="pointer-events-none absolute -right-4 -bottom-8 w-24 rounded-lg border border-white/15 opacity-25 rotate-6 shadow-2xl"
                                        />
                                    ) : null}
                                    <p className="text-[11px] uppercase tracking-widest font-bold text-white/70 relative">
                                        {t('homeDashboard.nowPlayingCompanion.sections.nextBestAction')}
                                    </p>
                                    <div className="mt-2 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 relative z-[1]">
                                        <div className="min-w-0 flex-1">
                                            <p className="text-sm font-bold text-white">{nextBestAction.title}</p>
                                            <p className="text-xs text-white/70 mt-0.5">{nextBestAction.hint}</p>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={nextBestAction.onClick}
                                            className={`w-full sm:w-auto px-3 py-2 rounded-lg text-xs font-bold border transition-colors ${
                                                nextBestAction.tone === 'violet'
                                                    ? 'border-violet-400/45 bg-violet-500/25 text-violet-100 hover:bg-violet-500/35'
                                                    : nextBestAction.tone === 'sky'
                                                        ? 'border-sky-400/45 bg-sky-500/25 text-sky-100 hover:bg-sky-500/35'
                                                        : 'border-emerald-400/45 bg-emerald-500/25 text-emerald-100 hover:bg-emerald-500/35'
                                            }`}
                                        >
                                            {nextBestAction.cta}
                                        </button>
                                    </div>
                                </div>
                            ) : null}
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                                <button
                                    type="button"
                                    onClick={toggleLocalWatchlist}
                                    className="w-full px-3 py-2 rounded-lg text-xs font-bold border border-white/20 bg-white/5 text-white hover:bg-white/10 transition-colors"
                                >
                                    {savedToWatchlist ? t('homeDashboard.nowPlayingCompanion.actions.savedToWatchlist') : t('homeDashboard.nowPlayingCompanion.actions.saveToWatchlist')}
                                </button>
                                <button
                                    type="button"
                                    onClick={openInLibrary}
                                    disabled={openingLibrary}
                                    className="w-full px-3 py-2 rounded-lg text-xs font-bold border border-white/20 bg-white/5 text-white hover:bg-white/10 transition-colors disabled:opacity-60"
                                >
                                    {openingLibrary ? t('homeDashboard.nowPlayingCompanion.actions.openingProvider', { provider: providerLabel }) : t('homeDashboard.nowPlayingCompanion.actions.openInProvider', { provider: providerLabel })}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => requestSimilar(firstRecommendation)}
                                    disabled={!firstRecommendation}
                                    className="w-full px-3 py-2 rounded-lg text-xs font-bold border border-violet-400/40 bg-violet-500/20 text-violet-100 hover:bg-violet-500/30 transition-colors disabled:opacity-60"
                                >
                                    {firstRecommendation ? t('homeDashboard.nowPlayingCompanion.actions.requestTitle', { title: firstRecommendation.title }) : t('homeDashboard.nowPlayingCompanion.actions.noSimilarTitles')}
                                </button>
                            </div>

                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                {playbackTelemetry.map((entry) => (
                                    <div key={`telemetry-${entry.label}`} className="rounded-lg border border-white/10 bg-black/30 px-2.5 py-2 min-w-0">
                                        <p className="text-[10px] uppercase tracking-wide text-white/50">{entry.label}</p>
                                        <p className="text-xs font-bold text-white truncate">{entry.value}</p>
                                    </div>
                                ))}
                            </div>

                            <CompanionHeroCard
                                title={title}
                                year={year}
                                mediaType={mediaType}
                                tagline={companionTagline}
                                posterPath={companionPosterPath}
                                heroArtPath={companionHeroArtPath}
                                seasonNumber={seasonNumber}
                                episodeNumber={episodeNumber}
                                episodeTitle={episodeDisplayTitle}
                                progress={sessionProgress}
                                metaChips={companionMetaChips}
                                overviewBlocks={companionOverviewBlocks}
                                unavailableLabel={t('homeDashboard.nowPlayingCompanion.overview.unavailable')}
                            />

                            <div className="grid grid-cols-1 xl:grid-cols-3 gap-3 items-stretch">
                                <div className="xl:col-span-2 rounded-xl border border-white/10 bg-white/5 p-2.5 sm:p-3 relative overflow-hidden">
                                    <CompanionArtBackdrop imagePath={companionBackdropPath || companionEpisodeStillPath} className="opacity-80" />
                                    <div className="relative z-[1]">
                                    <p className="text-[11px] uppercase tracking-widest text-white/60 font-bold mb-2 flex items-center gap-1.5">
                                        <Users className="w-3.5 h-3.5" />
                                        {t('homeDashboard.nowPlayingCompanion.sections.castIntelligence')}
                                    </p>
                                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
                                        {payload.castInsights.map((actor) => (
                                            <div key={`cast-${actor.id}`} className="rounded-lg border border-white/10 bg-black/35 p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                                                <div className="flex items-center gap-2">
                                                    <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full overflow-hidden bg-white/5 shrink-0 border-2 border-emerald-300/25 shadow-[0_0_18px_rgba(52,211,153,0.18)]">
                                                        {actor.profilePath ? (
                                                            <img
                                                                src={posterUrl(actor.profilePath, 'w185')}
                                                                alt={actor.name}
                                                                className="w-full h-full object-cover"
                                                            />
                                                        ) : (
                                                            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-emerald-500/35 to-cyan-500/20 text-emerald-100 text-xs font-black">
                                                                {initialsForName(actor.name)}
                                                            </div>
                                                        )}
                                                    </div>
                                                    <div className="min-w-0">
                                                        <button
                                                            type="button"
                                                            onClick={() => goToPath(`/discovery/person/${actor.id}`)}
                                                            className="text-left text-sm font-bold text-white hover:text-emerald-200 truncate max-w-full"
                                                        >
                                                            {actor.name}
                                                        </button>
                                                        {actor.character ? (
                                                            <p className="text-[11px] text-white/60 truncate">{actor.character}</p>
                                                        ) : null}
                                                        {actor.popularity > 0 ? (
                                                            <p className="text-[10px] text-emerald-200/80">
                                                                {t('homeDashboard.nowPlayingCompanion.cast.popularity', { value: actor.popularity.toFixed(1) })}
                                                            </p>
                                                        ) : null}
                                                        {actor.knownForDepartment ? (
                                                            <p className="text-[10px] text-white/55 truncate">
                                                                {actor.knownForDepartment}
                                                            </p>
                                                        ) : null}
                                                    </div>
                                                </div>
                                                {actor.birthday || actor.placeOfBirth ? (
                                                    <p className="mt-1.5 text-[10px] text-white/50">
                                                        {[actor.birthday, actor.placeOfBirth].filter(Boolean).join(' • ')}
                                                    </p>
                                                ) : null}
                                                {actor.biographySnippet ? (
                                                    <p className="mt-1.5 text-[10px] text-white/60 leading-relaxed">
                                                        {actor.biographySnippet}
                                                        {actor.biographySnippet.length >= 180 ? '…' : ''}
                                                    </p>
                                                ) : null}
                                                {actor.knownFor.length > 0 ? (
                                                    <div className="mt-2 flex flex-wrap gap-1">
                                                        {actor.knownFor.map((item) => (
                                                            <button
                                                                key={`known-${actor.id}-${item.mediaType}-${item.id}`}
                                                                type="button"
                                                                onClick={() => goToPath(`/discovery/${item.mediaType}/${item.id}`)}
                                                                className="px-2 py-1 rounded-md text-[10px] border border-white/15 bg-white/5 text-white/80 hover:bg-white/10 transition-colors truncate max-w-full"
                                                            >
                                                                {item.title}{item.year ? ` (${item.year})` : ''}
                                                            </button>
                                                        ))}
                                                    </div>
                                                ) : (
                                                    <p className="mt-2 text-[10px] text-white/45">{t('homeDashboard.nowPlayingCompanion.empty.noKnownFor')}</p>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                    {payload.castInsights.length === 0 ? (
                                        <p className="text-xs text-white/55 mt-2">{t('homeDashboard.nowPlayingCompanion.empty.noCastData')}</p>
                                    ) : null}
                                    <div className="mt-3 pt-3 border-t border-white/10 space-y-3">
                                        <p className="text-[11px] uppercase tracking-widest text-white/60 font-bold">
                                            {t('homeDashboard.nowPlayingCompanion.sections.crewIntelligence')}
                                        </p>
                                        {crewInsights.length > 0 ? (
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                                {crewInsights.map((entry) => (
                                                    <div
                                                        key={`crew-${entry.id}-${entry.job}`}
                                                        className="rounded-lg border border-white/10 bg-black/35 p-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
                                                    >
                                                        <div className="flex items-start gap-2.5">
                                                            <div className="w-14 h-14 rounded-full overflow-hidden bg-white/5 shrink-0 border-2 border-violet-300/25 shadow-[0_0_18px_rgba(167,139,250,0.18)]">
                                                                {entry.profilePath ? (
                                                                    <img
                                                                        src={posterUrl(entry.profilePath, 'w185')}
                                                                        alt={entry.name}
                                                                        className="w-full h-full object-cover"
                                                                    />
                                                                ) : (
                                                                    <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-violet-500/35 to-cyan-500/20 text-violet-100 text-xs font-black">
                                                                        {initialsForName(entry.name)}
                                                                    </div>
                                                                )}
                                                            </div>
                                                            <div className="min-w-0 flex-1">
                                                                {entry.id > 0 ? (
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => goToPath(`/discovery/person/${entry.id}`)}
                                                                        className="text-left text-sm font-bold text-white hover:text-violet-200 truncate max-w-full"
                                                                    >
                                                                        {entry.name}
                                                                    </button>
                                                                ) : (
                                                                    <p className="text-sm font-bold text-white truncate">{entry.name}</p>
                                                                )}
                                                                <p className="text-[11px] font-semibold text-violet-200/95">{entry.job}</p>
                                                                {entry.department ? (
                                                                    <p className="text-[10px] text-white/50 truncate">{entry.department}</p>
                                                                ) : null}
                                                                {entry.popularity > 0 ? (
                                                                    <p className="text-[10px] text-violet-200/80">
                                                                        {t('homeDashboard.nowPlayingCompanion.crew.popularity', { value: entry.popularity.toFixed(1) })}
                                                                    </p>
                                                                ) : null}
                                                                {entry.otherCredits.length > 0 ? (
                                                                    <p className="text-[10px] text-white/55 mt-1 leading-relaxed">
                                                                        {t('homeDashboard.nowPlayingCompanion.crew.otherRoles', {
                                                                            roles: entry.otherCredits.slice(0, 3).join(', '),
                                                                        })}
                                                                    </p>
                                                                ) : null}
                                                            </div>
                                                        </div>
                                                        {entry.biographySnippet ? (
                                                            <p className="mt-2 text-[10px] text-white/60 leading-relaxed">
                                                                {entry.biographySnippet}
                                                                {entry.biographySnippet.length >= 180 ? '…' : ''}
                                                            </p>
                                                        ) : null}
                                                        {entry.knownFor.length > 0 ? (
                                                            <div className="mt-2 flex flex-wrap gap-1">
                                                                {entry.knownFor.map((item) => (
                                                                    <button
                                                                        key={`crew-known-${entry.id}-${item.mediaType}-${item.id}`}
                                                                        type="button"
                                                                        onClick={() => goToPath(`/discovery/${item.mediaType}/${item.id}`)}
                                                                        className="px-2 py-1 rounded-md text-[10px] border border-white/15 bg-white/5 text-white/80 hover:bg-white/10 transition-colors truncate max-w-full"
                                                                    >
                                                                        {item.title}{item.year ? ` (${item.year})` : ''}
                                                                    </button>
                                                                ))}
                                                            </div>
                                                        ) : null}
                                                    </div>
                                                ))}
                                            </div>
                                        ) : (
                                            <p className="text-xs text-white/55">{t('homeDashboard.nowPlayingCompanion.empty.noCrewHighlights')}</p>
                                        )}

                                        {(companionProductionRows.length > 0 || companionProductionStudios.length > 0 || companionNetworks.length > 0) ? (
                                            <div className="rounded-xl border border-white/10 bg-black/25 p-3 space-y-3">
                                                <p className="text-[11px] uppercase tracking-widest text-white/60 font-bold">
                                                    {t('homeDashboard.nowPlayingCompanion.crew.productionSnapshot')}
                                                </p>
                                                {companionProductionRows.length > 0 ? (
                                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                                        {companionProductionRows.map((row) => (
                                                            <div key={`prod-${row.key}`} className="rounded-md border border-white/10 bg-white/5 px-2.5 py-2 min-w-0">
                                                                <p className="text-[10px] uppercase tracking-wide text-white/50">
                                                                    {t(`facts.${row.key}`)}
                                                                </p>
                                                                {row.people?.length ? (
                                                                    <div className="mt-1 flex flex-wrap gap-1">
                                                                        {row.people.map((person) => (
                                                                            <button
                                                                                key={`prod-person-${row.key}-${person.id}`}
                                                                                type="button"
                                                                                onClick={() => goToPath(`/discovery/person/${person.id}`)}
                                                                                className="text-xs font-semibold text-violet-200 hover:text-violet-100"
                                                                            >
                                                                                {person.name}
                                                                            </button>
                                                                        ))}
                                                                    </div>
                                                                ) : (
                                                                    <p className="text-xs font-semibold text-white/85 mt-0.5 break-words">{row.value}</p>
                                                                )}
                                                            </div>
                                                        ))}
                                                    </div>
                                                ) : null}
                                                {companionProductionStudios.length > 0 ? (
                                                    <div>
                                                        <p className="text-[10px] uppercase tracking-wide text-white/50 mb-1.5">
                                                            {companionProductionStudios.length === 1
                                                                ? t('media.studio')
                                                                : t('media.studios')}
                                                        </p>
                                                        <div className="flex flex-wrap gap-1.5">
                                                            {companionProductionStudios.slice(0, 6).map((studio) => (
                                                                <span
                                                                    key={`studio-${studio.id}`}
                                                                    className="px-2 py-1 rounded-md text-[10px] border border-white/15 bg-white/5 text-white/80"
                                                                >
                                                                    {studio.name}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    </div>
                                                ) : null}
                                                {companionNetworks.length > 0 ? (
                                                    <div>
                                                        <p className="text-[10px] uppercase tracking-wide text-white/50 mb-1.5">
                                                            {t('homeDashboard.nowPlayingCompanion.crew.networks')}
                                                        </p>
                                                        <div className="flex flex-wrap gap-1.5">
                                                            {companionNetworks.map((network) => (
                                                                <span
                                                                    key={`network-${network}`}
                                                                    className="px-2 py-1 rounded-md text-[10px] border border-sky-400/20 bg-sky-500/10 text-sky-100/90"
                                                                >
                                                                    {network}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    </div>
                                                ) : null}
                                            </div>
                                        ) : null}

                                        {companionExtendedCrew.length > 0 ? (
                                            <div className="space-y-2">
                                                <p className="text-[11px] uppercase tracking-widest text-white/60 font-bold">
                                                    {t('homeDashboard.nowPlayingCompanion.crew.moreCrew')}
                                                </p>
                                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                                    {companionExtendedCrew.map((group) => (
                                                        <div key={`crew-dept-${group.department}`} className="rounded-lg border border-white/10 bg-black/25 p-2.5">
                                                            <p className="text-[10px] uppercase tracking-wide text-violet-200/90 font-bold mb-1.5">
                                                                {group.department}
                                                            </p>
                                                            <div className="space-y-1">
                                                                {group.members.map((member) => (
                                                                    <div key={`crew-ext-${group.department}-${member.id}-${member.job}`} className="flex items-baseline justify-between gap-2 text-[11px]">
                                                                        <span className="text-white/55 shrink-0">{member.job}</span>
                                                                        {member.id > 0 ? (
                                                                            <button
                                                                                type="button"
                                                                                onClick={() => goToPath(`/discovery/person/${member.id}`)}
                                                                                className="text-white/85 hover:text-violet-200 truncate text-right"
                                                                            >
                                                                                {member.name}
                                                                            </button>
                                                                        ) : (
                                                                            <span className="text-white/85 truncate text-right">{member.name}</span>
                                                                        )}
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        ) : null}
                                    </div>
                                    </div>
                                </div>

                                <div className="rounded-xl border border-white/10 bg-white/5 p-2.5 sm:p-3 flex flex-col min-h-0 relative overflow-hidden">
                                    <CompanionArtBackdrop imagePath={companionSeasonPosterPath || companionPosterPath} />
                                    <div className="relative z-[1] flex flex-col min-h-0 flex-1">
                                    <p className="text-[11px] uppercase tracking-widest text-white/60 font-bold mb-2 flex items-center gap-1.5 shrink-0">
                                        <Music2 className="w-3.5 h-3.5" />
                                        {t('homeDashboard.nowPlayingCompanion.sections.soundtrackCues')}
                                    </p>
                                    {payload.soundtrackPeople.length > 0 ? (
                                        <div className="space-y-1.5">
                                            {payload.soundtrackPeople.map((name) => (
                                                <div
                                                    key={`music-${name}`}
                                                    className="px-2 py-1.5 rounded-md bg-black/35 border border-white/10 text-xs text-white/85"
                                                >
                                                    {name}
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <p className="text-xs text-white/55">
                                            {t('homeDashboard.nowPlayingCompanion.empty.noSoundtrackCredits')}
                                        </p>
                                    )}

                                    <div className="mt-3 pt-3 border-t border-white/10 space-y-2 shrink-0">
                                        <p className="text-[11px] uppercase tracking-widest text-white/60 font-bold">
                                        {t('homeDashboard.nowPlayingCompanion.sections.ratingsAndLinks')}
                                        </p>
                                        <div className="grid grid-cols-2 gap-1.5 sm:gap-2">
                                            <div className="rounded-md border border-white/10 bg-black/30 px-2 py-1.5">
                                                <p className="text-[10px] uppercase tracking-wide text-white/50">IMDb</p>
                                                <p className="text-xs font-bold text-white">
                                                    {ratings?.imdb?.criticsScore ? `${ratings.imdb.criticsScore.toFixed(1)}/10` : 'N/A'}
                                                </p>
                                            </div>
                                            <div className="rounded-md border border-white/10 bg-black/30 px-2 py-1.5">
                                                <p className="text-[10px] uppercase tracking-wide text-white/50">Rotten Tomatoes</p>
                                                <p className="text-xs font-bold text-white">
                                                    {Number.isFinite(Number(ratings?.rt?.criticsScore))
                                                        ? `${Number(ratings?.rt?.criticsScore)}%`
                                                        : 'N/A'}
                                                </p>
                                            </div>
                                        </div>
                                        {externalLinks.length > 0 ? (
                                            <div className="flex flex-wrap gap-1.5">
                                                {externalLinks.slice(0, 4).map((link) => (
                                                    <a
                                                        key={`link-${link.key}`}
                                                        href={link.url}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] border border-white/15 bg-white/5 text-white/80 hover:bg-white/10"
                                                    >
                                                        {link.label} <ExternalLink className="w-3 h-3" />
                                                    </a>
                                                ))}
                                            </div>
                                        ) : null}
                                    </div>

                                    <div className="mt-3 pt-3 border-t border-white/10 flex-1 min-h-0 flex flex-col relative overflow-hidden rounded-xl">
                                        <CompanionArtBackdrop imagePath={companionEpisodeStillPath || companionBackdropPath} className="opacity-90" />
                                        <div className="relative z-[1] p-2.5 flex-1 min-h-0 flex flex-col">
                                        <div className="relative overflow-hidden rounded-xl border border-fuchsia-400/25 bg-gradient-to-br from-fuchsia-500/10 via-violet-500/10 to-cyan-500/10 p-2.5 flex-1 min-h-0 flex flex-col">
                                            <div className="pointer-events-none absolute -top-10 right-0 w-28 h-28 rounded-full bg-fuchsia-400/20 blur-2xl animate-pulse motion-reduce:animate-none" />
                                            <div className="pointer-events-none absolute -bottom-12 -left-6 w-32 h-32 rounded-full bg-cyan-400/15 blur-2xl animate-pulse motion-reduce:animate-none" />
                                            <div className="relative space-y-2 flex-1 min-h-0 flex flex-col">
                                                <div className="flex items-center justify-between gap-2">
                                                    <p className="text-[11px] uppercase tracking-widest text-fuchsia-100 font-black flex items-center gap-1.5">
                                                        <span className="relative inline-flex h-2 w-2">
                                                            <span className="absolute inline-flex h-full w-full rounded-full bg-fuchsia-300 opacity-75 animate-ping motion-reduce:animate-none" />
                                                            <span className="relative inline-flex rounded-full h-2 w-2 bg-fuchsia-200" />
                                                        </span>
                                        {t('homeDashboard.nowPlayingCompanion.sections.factOverload')}
                                                    </p>
                                                    <span className="px-1.5 py-0.5 rounded border border-fuchsia-300/35 bg-fuchsia-500/15 text-[10px] font-bold text-fuchsia-100">
                                        {t('homeDashboard.nowPlayingCompanion.factOverload.live')}
                                                    </span>
                                                </div>
                                                <div className="flex flex-wrap gap-1.5 text-[10px]">
                                                    <span className="px-1.5 py-0.5 rounded border border-fuchsia-300/25 bg-black/25 text-fuchsia-100/85">
                                                        Wiki {Number(factPayload?.sources?.wikipedia) || 0}
                                                    </span>
                                                    <span className="px-1.5 py-0.5 rounded border border-cyan-300/25 bg-black/25 text-cyan-100/85">
                                                        TMDB {Number(factPayload?.sources?.tmdb) || 0}
                                                    </span>
                                                    <span className="px-1.5 py-0.5 rounded border border-white/20 bg-black/25 text-white/80">
                                        {t('homeDashboard.nowPlayingCompanion.factOverload.total', { total: overloadFacts.length })}
                                                    </span>
                                                </div>
                                                {factLoading ? (
                                                    <div className="rounded-lg border border-fuchsia-300/25 bg-black/30 px-2.5 py-2 text-xs text-fuchsia-100/80 animate-pulse motion-reduce:animate-none">
                                        {t('homeDashboard.nowPlayingCompanion.loading.facts')}
                                                    </div>
                                                ) : overloadFacts.length > 0 ? (
                                                    <>
                                                        <div className="rounded-lg border border-fuchsia-300/35 bg-black/35 px-2.5 py-2 shadow-[0_0_24px_rgba(217,70,239,0.25)]">
                                            <p className="text-[10px] uppercase tracking-widest text-fuchsia-200/90 font-bold">{t('homeDashboard.nowPlayingCompanion.factOverload.spotlight')}</p>
                                                            <p className="mt-1 text-xs text-white leading-relaxed">
                                                                {overloadFacts[factSpotlightIndex] || overloadFacts[0]}
                                                            </p>
                                                        </div>
                                                        <div className="space-y-1.5 flex-1 min-h-[12rem] overflow-y-auto pr-1">
                                                            {overloadFacts.map((fact, idx) => {
                                                                const active = idx === factSpotlightIndex;
                                                                return (
                                                                    <div
                                                                        key={`overload-${idx}`}
                                                                        className={`rounded-md border px-2 py-1.5 text-xs leading-relaxed transition-all duration-500 ${
                                                                            active
                                                                                ? 'border-fuchsia-300/50 bg-fuchsia-500/18 text-white shadow-[0_0_16px_rgba(217,70,239,0.25)]'
                                                                                : 'border-white/10 bg-black/25 text-white/80'
                                                                        }`}
                                                                    >
                                                                        {active ? <span className="mr-1 text-[10px] text-fuchsia-200">★</span> : null}
                                                                        {fact}
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    </>
                                                ) : (
                                                    <p className="text-xs text-white/65">
                                            {t('homeDashboard.nowPlayingCompanion.empty.factsUnavailable')}
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                        </div>
                                    </div>

                                    {mediaType === 'tv' && seasonNumber > 0 ? (
                                        <div className="mt-3 pt-3 border-t border-white/10 space-y-2 shrink-0 relative z-[1]">
                                            <p className="text-[11px] uppercase tracking-widest text-white/60 font-bold flex items-center gap-1.5">
                                                <Clapperboard className="w-3.5 h-3.5" />
                                        {t('homeDashboard.nowPlayingCompanion.sections.episodeContext')}
                                            </p>
                                            <div className="space-y-2">
                                                <CompanionEpisodeNavButton
                                                    episode={episodeContext.previous}
                                                    label={t('homeDashboard.nowPlayingCompanion.episode.previous', { name: episodeContext.previous?.name || t('homeDashboard.nowPlayingCompanion.empty.notAvailable') })}
                                                    disabled={!episodeContext.previous}
                                                    fallbackArt={companionEpisodeArtFallback}
                                                    onClick={() => goToPath(`${basePath}?season=${seasonNumber}&episode=${Number(episodeContext.previous?.episode_number)}`)}
                                                />
                                                <CompanionEpisodeNavButton
                                                    episode={episodeContext.current}
                                                    label={t('homeDashboard.nowPlayingCompanion.episode.current', { name: episodeContext.current?.name || session.episodeTitle || t('nowPlaying.episode', { number: episodeNumber }) })}
                                                    active
                                                    disabled={!episodeContext.current}
                                                    fallbackArt={companionEpisodeArtFallback}
                                                    onClick={() => goToPath(`${basePath}?season=${seasonNumber}&episode=${episodeNumber}`)}
                                                />
                                                <CompanionEpisodeNavButton
                                                    episode={episodeContext.next}
                                                    label={t('homeDashboard.nowPlayingCompanion.episode.next', { name: episodeContext.next?.name || t('homeDashboard.nowPlayingCompanion.empty.notAvailable') })}
                                                    disabled={!episodeContext.next}
                                                    fallbackArt={companionEpisodeArtFallback}
                                                    onClick={() => goToPath(`${basePath}?season=${seasonNumber}&episode=${Number(episodeContext.next?.episode_number)}`)}
                                                />
                                            </div>
                                        </div>
                                    ) : null}
                                    </div>
                                </div>
                            </div>

                            {payload.recommendations.length > 0 ? (
                                <div className="rounded-xl border border-white/10 bg-white/5 p-3 relative overflow-hidden">
                                    <CompanionArtBackdrop imagePath={companionBackdropPath} className="opacity-70" />
                                    <div className="relative z-[1]">
                                    <p className="text-[11px] uppercase tracking-widest text-white/60 font-bold mb-2">
                                        {t('homeDashboard.nowPlayingCompanion.sections.similarPicks')}
                                    </p>
                                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
                                        {payload.recommendations.slice(0, 6).map((item) => (
                                            <div key={`rec-${item.mediaType}-${item.id}`} className="group rounded-lg overflow-hidden border border-white/10 bg-black/30 transition-all hover:-translate-y-0.5 hover:border-violet-400/35 hover:shadow-[0_12px_30px_rgba(139,92,246,0.22)]">
                                                <button
                                                    type="button"
                                                    onClick={() => goToPath(`/discovery/${item.mediaType}/${item.id}`)}
                                                    className="w-full text-left"
                                                >
                                                    <div className="aspect-[2/3] bg-white/5 overflow-hidden">
                                                        {item.posterPath ? (
                                                            <img
                                                                src={posterUrl(item.posterPath)}
                                                                alt={item.title}
                                                                className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                                                            />
                                                        ) : (
                                                            <NoPosterPlaceholder compact />
                                                        )}
                                                    </div>
                                                    <div className="p-2">
                                                        <p className="text-[11px] text-white font-semibold truncate">{item.title}</p>
                                                        <p className="text-[10px] text-white/55">{item.year || t('homeDashboard.nowPlayingCompanion.empty.unknownYear')}</p>
                                                    </div>
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => requestSimilar(item)}
                                                    className="w-full px-2 py-1.5 text-[10px] font-bold border-t border-white/10 text-violet-200 bg-violet-500/15 hover:bg-violet-500/25 transition-colors"
                                                >
                                                    {t('quickActions.request')}
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                    </div>
                                </div>
                            ) : null}
                        </div>
                    )}

                    {tab === 'deep-dive' && payload && (
                        <div className="space-y-3">
                            <div className="relative overflow-hidden rounded-2xl border border-white/10 min-h-[9rem]">
                                {companionHeroArtPath ? (
                                    <img src={posterUrl(companionHeroArtPath, 'w780')} alt="" className="absolute inset-0 h-full w-full object-cover" />
                                ) : null}
                                <div className="absolute inset-0 bg-gradient-to-r from-black/85 via-black/55 to-black/25" />
                                <div className="relative z-[1] p-4 flex items-end gap-3 min-h-[9rem]">
                                    {companionPosterPath ? (
                                        <img src={posterUrl(companionPosterPath, 'w185')} alt="" className="w-14 rounded-lg border border-white/20 shadow-xl object-cover aspect-[2/3]" />
                                    ) : null}
                                    <div className="min-w-0">
                                        <p className="text-[10px] uppercase tracking-[0.2em] text-violet-200/90 font-bold">Deep dive</p>
                                        <p className="text-lg font-black text-white truncate">{title}</p>
                                        <p className="text-xs text-white/70 mt-1">{t('homeDashboard.nowPlayingCompanion.summary.throughSession', { progress: sessionProgress })}</p>
                                    </div>
                                </div>
                            </div>
                            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                                <p className="text-[11px] uppercase tracking-widest text-white/60 font-bold mb-2 flex items-center gap-1.5">
                                    <Sparkles className="w-3.5 h-3.5" />
                                    {t('homeDashboard.nowPlayingCompanion.sections.liveTriviaTimeline')}
                                </p>
                                <div className="space-y-2">
                                    {timelineFacts.map((fact) => (
                                        <div
                                            key={`fact-${fact.label}`}
                                            className="flex items-start gap-2 text-xs text-white/85 border-b border-white/5 pb-1.5 last:border-b-0 last:pb-0"
                                        >
                                            <span className="text-emerald-200 font-bold min-w-28">{fact.label}</span>
                                            <span>{fact.value}</span>
                                        </div>
                                    ))}
                                    {!timelineFacts.length ? (
                                        <p className="text-xs text-white/55">{t('homeDashboard.nowPlayingCompanion.empty.noTimelineFacts')}</p>
                                    ) : null}
                                </div>
                            </div>

                            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                                <p className="text-[11px] uppercase tracking-widest text-white/60 font-bold mb-2 flex items-center gap-1.5">
                                    <Clapperboard className="w-3.5 h-3.5" />
                                    {t('homeDashboard.nowPlayingCompanion.sections.productionFacts')}
                                </p>
                                <div className="space-y-2">
                                    {productionFacts.length > 0 ? productionFacts.map((fact) => (
                                        <div
                                            key={`prod-${fact.key}`}
                                            className="flex items-start gap-2 text-xs text-white/85 border-b border-white/5 pb-1.5 last:border-b-0 last:pb-0"
                                        >
                                            <span className="text-violet-200 font-bold min-w-28">{fact.label}</span>
                                            <span>{fact.value}</span>
                                        </div>
                                    )) : (
                                        <p className="text-xs text-white/55">{t('homeDashboard.nowPlayingCompanion.empty.noProductionFacts')}</p>
                                    )}
                                </div>
                            </div>

                            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                                <p className="text-[11px] uppercase tracking-widest text-white/60 font-bold mb-2 flex items-center gap-1.5">
                                    <Link2 className="w-3.5 h-3.5" />
                                    {t('homeDashboard.nowPlayingCompanion.sections.actorGraph')}
                                </p>
                                <div className="space-y-2">
                                    {payload.castInsights.slice(0, 4).map((actor) => (
                                        <div key={`graph-${actor.id}`} className="text-xs text-white/85">
                                            <button
                                                type="button"
                                                onClick={() => goToPath(`/discovery/person/${actor.id}`)}
                                                className="font-bold text-emerald-200 hover:underline"
                                            >
                                                {actor.name}
                                            </button>
                                            <span className="text-white/50 mx-1">{'->'}</span>
                                            {actor.knownFor.length > 0 ? actor.knownFor.map((work, idx) => (
                                                <React.Fragment key={`graph-work-${actor.id}-${work.id}`}>
                                                    <button
                                                        type="button"
                                                        onClick={() => goToPath(`/discovery/${work.mediaType}/${work.id}`)}
                                                        className="text-white hover:text-emerald-200"
                                                    >
                                                        {work.title}
                                                    </button>
                                                    {idx < actor.knownFor.length - 1 ? <span className="text-white/35 mx-1">/</span> : null}
                                                </React.Fragment>
                                            )) : <span className="text-white/55">{t('homeDashboard.nowPlayingCompanion.empty.noLinkedCredits')}</span>}
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                                <p className="text-[11px] uppercase tracking-widest text-white/60 font-bold mb-2 flex items-center gap-1.5">
                                    <MessageSquareQuote className="w-3.5 h-3.5" />
                                    {t('homeDashboard.nowPlayingCompanion.sections.subtitleQuoteContext')}
                                </p>
                                <div className="flex flex-wrap gap-2">
                                    {quoteMoments.map((quote, index) => (
                                        <button
                                            key={`quote-${index}`}
                                            type="button"
                                            onClick={() => jumpToQuoteContext(quote)}
                                            className={`px-2.5 py-1.5 rounded-md text-xs border transition-colors ${
                                                activeQuote === quote
                                                    ? 'border-emerald-400/40 bg-emerald-500/20 text-emerald-100'
                                                    : 'border-white/15 bg-black/30 text-white/80 hover:bg-black/45'
                                            }`}
                                        >
                                            "{quote}"
                                        </button>
                                    ))}
                                    {!quoteMoments.length ? (
                                        <p className="text-xs text-white/55">{t('homeDashboard.nowPlayingCompanion.empty.noContextualLines')}</p>
                                    ) : null}
                                </div>
                            </div>
                        </div>
                    )}

                    {tab === 'watch-room' && payload && (
                        <div className="space-y-3">
                            <div className="relative overflow-hidden rounded-2xl border border-white/10 min-h-[8.5rem]">
                                {companionBackdropPath || companionEpisodeStillPath ? (
                                    <img src={posterUrl(companionBackdropPath || companionEpisodeStillPath, 'w780')} alt="" className="absolute inset-0 h-full w-full object-cover" />
                                ) : null}
                                <div className="absolute inset-0 bg-gradient-to-t from-black via-black/60 to-black/20" />
                                <div className="relative z-[1] p-4 flex items-end justify-between gap-3 min-h-[8.5rem]">
                                    <div className="min-w-0">
                                        <p className="text-[10px] uppercase tracking-[0.2em] text-sky-200/90 font-bold">Watch room</p>
                                        <p className="text-base font-black text-white truncate">{title}</p>
                                        <p className="text-xs text-white/70 mt-1">{t('homeDashboard.nowPlayingCompanion.poll.summaryHint')}</p>
                                    </div>
                                    {companionPosterPath ? (
                                        <img src={posterUrl(companionPosterPath, 'w185')} alt="" className="w-12 rounded-lg border border-white/20 shadow-xl object-cover aspect-[2/3] shrink-0" />
                                    ) : null}
                                </div>
                            </div>
                            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                                <p className="text-[11px] uppercase tracking-widest text-white/60 font-bold mb-2">
                                    {t('homeDashboard.nowPlayingCompanion.sections.sharedReactions')}
                                </p>
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                    <button
                                        type="button"
                                        onClick={() => bumpReaction('like')}
                                        className="px-2.5 py-2 rounded-lg border border-white/15 bg-black/30 hover:bg-black/45 text-xs text-white/85 flex items-center justify-between"
                                    >
                                        <span className="inline-flex items-center gap-1.5"><ThumbsUp className="w-3.5 h-3.5" /> {t('homeDashboard.nowPlayingCompanion.reactions.like')}</span>
                                        <span className="font-bold">{reactions.like || 0}</span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => bumpReaction('fire')}
                                        className="px-2.5 py-2 rounded-lg border border-white/15 bg-black/30 hover:bg-black/45 text-xs text-white/85 flex items-center justify-between"
                                    >
                                        <span className="inline-flex items-center gap-1.5"><Flame className="w-3.5 h-3.5" /> {t('homeDashboard.nowPlayingCompanion.reactions.fire')}</span>
                                        <span className="font-bold">{reactions.fire || 0}</span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => bumpReaction('laugh')}
                                        className="px-2.5 py-2 rounded-lg border border-white/15 bg-black/30 hover:bg-black/45 text-xs text-white/85 flex items-center justify-between"
                                    >
                                        <span className="inline-flex items-center gap-1.5"><Laugh className="w-3.5 h-3.5" /> {t('homeDashboard.nowPlayingCompanion.reactions.laugh')}</span>
                                        <span className="font-bold">{reactions.laugh || 0}</span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => bumpReaction('wow')}
                                        className="px-2.5 py-2 rounded-lg border border-white/15 bg-black/30 hover:bg-black/45 text-xs text-white/85 flex items-center justify-between"
                                    >
                                        <span className="inline-flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5" /> {t('homeDashboard.nowPlayingCompanion.reactions.wow')}</span>
                                        <span className="font-bold">{reactions.wow || 0}</span>
                                    </button>
                                </div>
                            </div>

                            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                                <p className="text-[11px] uppercase tracking-widest text-white/60 font-bold mb-2">
                                    {t('homeDashboard.nowPlayingCompanion.sections.quickPoll')}
                                </p>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                    {[
                                        { id: 'pacing', label: t('homeDashboard.nowPlayingCompanion.poll.bestPacing') },
                                        { id: 'acting', label: t('homeDashboard.nowPlayingCompanion.poll.strongActing') },
                                        { id: 'visuals', label: t('homeDashboard.nowPlayingCompanion.poll.visualHighlight') },
                                        { id: 'soundtrack', label: t('homeDashboard.nowPlayingCompanion.poll.greatSoundtrack') },
                                    ].map((option) => (
                                        <button
                                            key={option.id}
                                            type="button"
                                            onClick={() => votePoll(option.id)}
                                            className={`px-2.5 py-2 rounded-lg border text-xs text-left transition-colors ${
                                                pollChoice === option.id
                                                    ? 'border-sky-400/45 bg-sky-500/20 text-sky-100'
                                                    : 'border-white/15 bg-black/30 text-white/85 hover:bg-black/45'
                                            }`}
                                        >
                                            <div className="flex items-center justify-between gap-2">
                                                <span>{option.label}</span>
                                                <span className="font-bold">{pollVotes[option.id] || 0}</span>
                                            </div>
                                        </button>
                                    ))}
                                </div>
                                <p className="mt-2 text-[11px] text-white/55">
                                    {t('homeDashboard.nowPlayingCompanion.poll.totalVotes', { total: totalPollVotes })}
                                </p>
                            </div>

                            <div className="rounded-xl border border-white/10 bg-white/5 p-3 flex flex-wrap items-center justify-between gap-2">
                                <p className="text-xs text-white/75">
                                    {t('homeDashboard.nowPlayingCompanion.poll.summaryHint')}
                                </p>
                                <button
                                    type="button"
                                    onClick={copyRoomSummary}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/20 bg-white/5 text-xs font-bold text-white hover:bg-white/10"
                                >
                                    {t('homeDashboard.nowPlayingCompanion.actions.copySummary')} <ExternalLink className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}
            </div>
        </div>
    );
};

export default NowPlayingCompanionPanel;
