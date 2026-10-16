import React, { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, ExternalLink, Play } from 'lucide-react';
import { DiscoveryLogo, useDiscoverI18n } from './host';
import { DiscoveryFactWidget } from '../discovery/DiscoveryFactWidget';
import { apiFetch } from '../shared/api';
import { DISCOVER_NETWORKS, DISCOVER_STUDIOS } from '../discovery/discoverConstants';
import { shouldPreserveColorLogo } from '../discovery/discoveryLogoUtils';
import { plexImageUrl, formatEpisodeCode, formatPlayerDate, formatPlayerDuration, progressPercent } from './playerUtils';
import {
    splitOverviewServiceLogos,
    pickWatchProvidersForRegion,
} from './studioLogo.js';
import type { PlayerItem, PlayerPersonCredit } from './types';
import { useDiscoveryPreferences } from '../discovery/useDiscoveryPreferences';
import { usePlayerSettings } from './usePlayerSettings';

type PersonHandler = (person: { id: string; name: string; thumb?: string | null }) => void;
type StudioHandler = (studio: { key: string; name: string; sectionKey?: string; mediaType?: 'movie' | 'show' }) => void;
type NetworkLogo = { name: string; logoPath: string; key: string; wordmark?: boolean };

const isTvShell = () => {
    try {
        return document.documentElement?.dataset?.tv === '1'
            || window.__PLEX_CLIENT__?.isTv === true;
    } catch {
        return false;
    }
};

const creditPillClass = 'px-2.5 py-1 rounded-lg bg-white/5 border border-border text-sm text-text';
const creditPillInteractiveClass = `${creditPillClass} hover:bg-plex/15 hover:border-plex/40 hover:text-plex transition-colors`;

/** Prev/next episode cards — fixed width, 10% above the previous 26rem spotlight. */
export const OVERVIEW_SPOTLIGHT_WIDTH_CLASS = 'w-[28.6rem] max-w-full shrink-0';
/** Shared card height so prev / fact / next share one rhythm. */
export const OVERVIEW_SPOTLIGHT_CARD_SHELL_CLASS = 'min-h-[5.25rem]';
/** Did You Know may grow wider for long copy instead of getting taller — never past the panel. */
export const OVERVIEW_FACT_WIDTH_CLASS = 'w-full min-w-0 max-w-[min(100%,40rem)] sm:min-w-[min(100%,22rem)]';

const SectionHeading: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <div className="flex items-center gap-3 mb-3">
        <h3 className="text-xs font-black text-muted uppercase tracking-[0.2em]">{children}</h3>
        <div className="h-px flex-1 bg-gradient-to-r from-border to-transparent" />
    </div>
);

const CreditPills: React.FC<{
    people: PlayerPersonCredit[];
    onOpenPerson: PersonHandler;
    interactive?: boolean;
}> = ({ people, onOpenPerson, interactive = true }) => (
    <div className="flex flex-wrap gap-2">
        {people.map((person) => (
            interactive ? (
                <button
                    key={`${person.id}-${person.name}`}
                    type="button"
                    onClick={() => onOpenPerson({ id: person.id || person.name, name: person.name, thumb: person.thumb })}
                    className={creditPillInteractiveClass}
                >
                    {person.name}
                </button>
            ) : (
                <span key={`${person.id}-${person.name}`} className={creditPillClass}>
                    {person.name}
                </span>
            )
        ))}
    </div>
);

const StudioPill: React.FC<{
    name: string;
    logoPath?: string | null;
    size?: 'md' | 'sm' | 'lg' | 'toolbar' | 'hero';
    showPlate?: boolean;
    /** Original PNG. Dark wordmarks still flip to white; color marks stay color. */
    brandColor?: boolean;
    wordmark?: boolean;
    onClick?: () => void;
}> = ({ name, logoPath, size = 'md', showPlate = true, brandColor = false, wordmark = true, onClick }) => {
    const [failed, setFailed] = useState(false);
    const showLogo = Boolean(logoPath) && !failed && !(brandColor && !wordmark);
    if (!showLogo) return null;

    const preserveColor = brandColor || shouldPreserveColorLogo(String(logoPath), name);
    // Fixed plate height so wordmarks and square marks sit on one baseline.
    const plateClass = size === 'hero'
        ? 'inline-flex items-center justify-start'
        : size === 'toolbar'
            ? 'inline-flex h-11 items-center justify-center rounded-xl px-2.5'
            : size === 'lg'
                ? 'inline-flex h-16 items-center justify-center rounded-xl px-4'
                : size === 'sm'
                    ? 'inline-flex h-8 items-center justify-center rounded-lg px-2.5'
                    : 'inline-flex h-9 items-center justify-center rounded-lg px-3';
    const logoClass = brandColor
        ? 'h-5 max-w-[110px] sm:max-w-[130px] w-auto object-contain'
        : size === 'hero'
        ? 'h-12 sm:h-14 lg:h-[4.25rem] max-w-[16rem] sm:max-w-[20rem] w-auto object-contain object-left drop-shadow-[0_10px_24px_rgba(0,0,0,0.45)]'
        : size === 'toolbar'
            ? 'h-5 max-w-[4.5rem] w-auto object-contain opacity-95'
            : size === 'lg'
                ? 'h-10 sm:h-12 max-w-[180px] sm:max-w-[220px] w-auto object-contain opacity-95'
                : size === 'sm'
                    ? 'h-5 max-w-[110px] sm:max-w-[130px] w-auto object-contain opacity-95'
                    : 'h-5 sm:h-6 max-w-[130px] sm:max-w-[150px] w-auto object-contain opacity-95';
    const className = brandColor
        ? `${plateClass} border border-border/60 bg-white/5 transition-colors hover:border-plex/40 hover:bg-white/10`
        : size === 'hero'
        ? `${plateClass} border-0 bg-transparent p-0`
        : size === 'toolbar'
            ? `${plateClass} border border-white/15 bg-white/5 hover:border-plex/40 hover:bg-white/10 transition-colors`
            : !showPlate
                ? `${plateClass} border border-transparent hover:bg-white/5 transition-colors`
                : preserveColor
                    ? `${plateClass} border border-transparent hover:border-border/50 hover:bg-white/5 transition-colors`
                    : `${plateClass} border border-border/60 bg-white/5 hover:bg-white/10 hover:border-plex/40 transition-colors`;
    const body = (
        <DiscoveryLogo
            logoPath={String(logoPath)}
            alt={name}
            width={brandColor ? 780 : 300}
            duotone={!preserveColor}
            tone={brandColor && wordmark ? 'light' : 'auto'}
            onError={() => setFailed(true)}
            className={logoClass}
        />
    );

    if (onClick) {
        return (
            <button
                type="button"
                onClick={onClick}
                title={name}
                aria-label={name}
                className={className}
            >
                {body}
            </button>
        );
    }
    return (
        <span title={name} className={className}>{body}</span>
    );
};

const NetworkLogoRow: React.FC<{
    networks: NetworkLogo[];
    onOpenStudio?: StudioHandler;
    sectionKey?: string;
    mediaType?: 'movie' | 'show';
    /** When true, search movie + show libraries (streaming brands). */
    searchAllTypes?: boolean;
    size?: 'md' | 'sm' | 'lg' | 'toolbar' | 'hero';
    showPlate?: boolean;
    brandColor?: boolean;
}> = ({ networks, onOpenStudio, sectionKey, mediaType, searchAllTypes = false, size = 'md', showPlate = true, brandColor = false }) => {
    const interactive = Boolean(onOpenStudio) && !isTvShell();
    return (
    <div className="flex flex-wrap gap-2 items-stretch">
        {networks.filter((row) => row.logoPath).map((row) => (
            <StudioPill
                key={`${row.key}-${row.name}`}
                name={row.name}
                logoPath={row.logoPath}
                size={size}
                showPlate={showPlate}
                brandColor={brandColor}
                wordmark={row.wordmark !== false}
                onClick={interactive ? () => onOpenStudio!({
                    // Prefer the display name — TMDB catalog ids do not match Plex tag ids.
                    key: row.name || row.key,
                    name: row.name,
                    sectionKey: sectionKey || '',
                    mediaType: searchAllTypes ? undefined : (mediaType || 'show'),
                }) : undefined}
            />
        ))}
    </div>
    );
};

/** Studio, broadcast network, and streaming providers — separate stacked rows. */
const useOverviewServiceLogos = (item: PlayerItem, region: string) => {
    const plexName = String(item.studio || '').trim();
    const watchRegion = String(region || 'US').trim().toUpperCase() || 'US';
    const [tmdbNetworks, setTmdbNetworks] = useState<Array<{ id?: string | number; name?: string; logoPath?: string }>>([]);
    const [streamingProviders, setStreamingProviders] = useState<Array<{ name: string; logoPath: string; key: string }>>([]);

    useEffect(() => {
        setTmdbNetworks([]);
        setStreamingProviders([]);
    }, [item.type, item.tmdbId, item.externalIds?.tmdb, plexName]);

    useEffect(() => {
        const tmdbId = Number(item.externalIds?.tmdb || item.tmdbId || 0);
        if (!Number.isFinite(tmdbId) || tmdbId <= 0) return undefined;
        // Episodes/seasons must resolve against the series id (server prefers show TMDB).
        const mediaType = item.type === 'movie' ? 'movie' : 'tv';
        let cancelled = false;
        apiFetch(`/api/discovery/proxy/${mediaType}/${tmdbId}`)
            .then((details: any) => {
                if (cancelled) return;
                if (mediaType === 'tv') {
                    setTmdbNetworks([].concat(details?.networks || []));
                } else {
                    setTmdbNetworks([]);
                }
                setStreamingProviders(pickWatchProvidersForRegion(details?.watchProviders || [], watchRegion));
            })
            .catch(() => {
                if (!cancelled) {
                    setTmdbNetworks([]);
                    setStreamingProviders([]);
                }
            });
        return () => { cancelled = true; };
    }, [item.externalIds?.tmdb, item.tmdbId, item.type, plexName, watchRegion]);

    return splitOverviewServiceLogos({
        plexName,
        // Treat episodes/seasons as TV so Plex network labels land in Network, not Studio.
        mediaType: item.type === 'movie' ? 'movie' : 'show',
        networks: DISCOVER_NETWORKS,
        studios: DISCOVER_STUDIOS,
        tmdbNetworks,
        streamingProviders,
    });
};

export const OverviewSummary: React.FC<{ text: string }> = ({ text }) => {
    const { t } = useDiscoverI18n();
    const [open, setOpen] = useState(false);
    const long = text.length > 420;
    const tvShell = isTvShell();
    return (
        <div className="media-overview-summary flex flex-col gap-2">
            <p className={`text-sm sm:text-base lg:text-[17px] text-text leading-relaxed ${long && !open ? (tvShell ? 'line-clamp-3' : 'line-clamp-5') : ''}`}>
                {text}
            </p>
            {long && !tvShell ? (
                <button
                    type="button"
                    onClick={() => setOpen((prev) => !prev)}
                    className="self-start text-xs font-bold text-plex hover:text-plex-hover"
                >
                    {open ? t('common.showLess') : t('common.readMore')}
                </button>
            ) : null}
        </div>
    );
};

export const OverviewGenres: React.FC<{ genres: string[] }> = ({ genres }) => {
    if (!genres.length) return null;
    return (
        <div className="flex flex-wrap justify-center gap-2">
            {genres.map((genre) => (
                <span
                    key={genre}
                    className="px-2.5 py-1 rounded-lg bg-white/5 border border-border text-xs font-semibold text-muted"
                >
                    {genre}
                </span>
            ))}
        </div>
    );
};

export const OverviewFactsSpotlight: React.FC<{
    item: PlayerItem;
    onOpenStudio?: StudioHandler;
    factMediaType: 'movie' | 'tv' | null;
    factMediaId: number;
    factTitle?: string;
    previous?: PlayerItem | null;
    next?: PlayerItem | null;
    onOpenItem?: (item: PlayerItem) => void;
    onPlayNeighbor?: (item: PlayerItem) => void;
}> = ({
    item,
    onOpenStudio,
    factMediaType,
    factMediaId,
    factTitle,
    previous,
    next,
    onOpenItem,
    onPlayNeighbor,
}) => {
    const { t } = useDiscoverI18n();
    const { preferences } = useDiscoveryPreferences();
    const { studio, network, streaming } = useOverviewServiceLogos(item, preferences.discoverRegion || 'US');
    const marks = [...studio, ...network, ...streaming].filter((row) => row.logoPath).filter((row, index, rows) => (
        rows.findIndex((other) => other.key === row.key && other.name === row.name) === index
    ));
    const showFact = Boolean(factMediaType) && (Number.isFinite(factMediaId) && factMediaId > 0 || Boolean(String(factTitle || '').trim()));
    const showNeighbors = Boolean((previous || next) && onOpenItem && onPlayNeighbor);
    if (!marks.length && !showFact && !showNeighbors) return null;
    const interactive = Boolean(onOpenStudio) && !isTvShell();
    const leftRows: React.ReactNode[] = [];
    if (showNeighbors && previous) {
        leftRows.push(
            <EpisodeNeighborCard
                item={previous}
                label={t('mediaPlayerPage.previousEpisode')}
                icon={<ChevronLeft className="h-5 w-5" />}
                onOpenItem={onOpenItem!}
                onPlay={onPlayNeighbor!}
            />,
        );
    }
    if (showFact && factMediaType) {
        leftRows.push(
            <DiscoveryFactWidget
                mediaType={factMediaType}
                mediaId={Number.isFinite(factMediaId) && factMediaId > 0 ? factMediaId : 0}
                title={factTitle}
                year={item.year}
                className={`${OVERVIEW_FACT_WIDTH_CLASS} ${OVERVIEW_SPOTLIGHT_CARD_SHELL_CLASS} items-center`}
                compact
            />,
        );
    }
    if (showNeighbors && next) {
        leftRows.push(
            <EpisodeNeighborCard
                item={next}
                label={t('mediaPlayerPage.nextEpisode')}
                icon={<ChevronRight className="h-5 w-5" />}
                onOpenItem={onOpenItem!}
                onPlay={onPlayNeighbor!}
            />,
        );
    }
    const paired = Math.max(leftRows.length, marks.length);
    const hasLogoColumn = marks.length > 0 && leftRows.length > 0;
    return (
        <div
            className={`media-overview-spotlight ${hasLogoColumn
                ? 'grid w-full max-w-full grid-cols-1 gap-3 sm:grid-cols-[minmax(26rem,max-content)_minmax(9.5rem,12rem)] sm:items-start'
                : 'flex w-full max-w-full flex-col items-start gap-3'}`}
            data-tv-rail="1"
            data-tv-row="1"
        >
            {Array.from({ length: paired }, (_, index) => {
                const left = leftRows[index];
                const mark = marks[index];
                if (!left && !mark) return null;
                return (
                    <React.Fragment key={mark ? `${mark.key}-${mark.name}` : `row-${index}`}>
                        {left ? (
                            <div className={`min-w-0 ${hasLogoColumn && !mark ? 'sm:col-span-2' : ''}`}>{left}</div>
                        ) : (
                            <div className="hidden sm:block" />
                        )}
                        {mark ? (
                            <div className={`flex ${OVERVIEW_SPOTLIGHT_CARD_SHELL_CLASS} items-center justify-center rounded-xl border border-border bg-white/5 px-4`}>
                                <StudioPill
                                    name={mark.name}
                                    logoPath={mark.logoPath}
                                    size="lg"
                                    showPlate={false}
                                    onClick={interactive ? () => onOpenStudio!({
                                        key: mark.name || mark.key,
                                        name: mark.name,
                                        sectionKey: item.librarySectionID || '',
                                        mediaType: 'show',
                                    }) : undefined}
                                />
                            </div>
                        ) : null}
                    </React.Fragment>
                );
            })}
            {!leftRows.length && marks.length ? (
                <NetworkLogoRow
                    networks={marks}
                    onOpenStudio={onOpenStudio}
                    sectionKey={item.librarySectionID || ''}
                    mediaType="show"
                    size="hero"
                    showPlate={false}
                />
            ) : null}
        </div>
    );
};

export const OverviewFacts: React.FC<{
    item: PlayerItem;
    onOpenPerson: PersonHandler;
    onOpenItem: (item: PlayerItem) => void;
    onOpenStudio?: StudioHandler;
    /** Optional panel (e.g. Media Info) — sits between facts and Did You Know. */
    middle?: React.ReactNode;
    /** Optional panel (e.g. Did You Know) — sits on the right. */
    aside?: React.ReactNode;
    /** Sits under the Details fields, still in the left column. */
    underDetails?: React.ReactNode;
    /** Media info, rendered directly under the release date with a divider. */
    afterReleased?: React.ReactNode;
}> = ({ item, onOpenPerson, onOpenStudio, middle, aside, underDetails, afterReleased }) => {
    const { t, locale } = useDiscoverI18n();
    const { preferences } = useDiscoveryPreferences();
    const [settings] = usePlayerSettings();
    const tvShell = isTvShell();
    const { studio, network, streaming } = useOverviewServiceLogos(
        item,
        preferences.discoverRegion || 'US',
    );
    const aired = formatPlayerDate(item.originallyAvailableAt, locale);
    const added = formatPlayerDate(item.addedAt, locale);
    const lastPlayed = formatPlayerDate(item.lastViewedAt, locale);
    const watched = Number(item.viewedLeafCount || 0);
    const total = Number(item.leafCount || 0);
    const streamingMarks = tvShell ? streaming : streaming.filter((row) => row.wordmark !== false);
    const serviceSections = [
        studio.length ? { label: t('media.studio'), networks: studio, size: 'sm' as const, searchAllTypes: false } : null,
        network.length && item.type !== 'episode' ? { label: t('mediaPlayerPage.network'), networks: network, size: 'sm' as const, searchAllTypes: false } : null,
        streamingMarks.length ? { label: t('mediaPlayerPage.streaming'), networks: streamingMarks, size: 'sm' as const, searchAllTypes: true, brandColor: !tvShell } : null,
    ].filter(Boolean) as Array<{ label: string; networks: NetworkLogo[]; size: 'sm' | 'md' | 'lg'; searchAllTypes: boolean }>;
    const leadCredit = (people?: PlayerPersonCredit[]) => {
        const first = (people || []).find((person) => String(person?.name || '').trim());
        return first ? [first] : [];
    };
    const crewRows: Array<{
        label: string;
        people?: PlayerPersonCredit[];
    }> = [
        leadCredit(item.directorPeople).length ? { label: t('mediaPlayerPage.directedBy'), people: leadCredit(item.directorPeople) } : null,
        leadCredit(item.writerPeople).length ? { label: t('mediaPlayerPage.writtenBy'), people: leadCredit(item.writerPeople) } : null,
        leadCredit(item.producers).length ? { label: t('mediaPlayerPage.producedBy'), people: leadCredit(item.producers) } : null,
    ].filter(Boolean) as Array<{ label: string; people?: PlayerPersonCredit[] }>;
    const releasedRow = aired
        ? { label: item.type === 'episode' ? t('mediaPlayerPage.aired') : t('mediaPlayerPage.released'), value: aired }
        : null;
    const metaRows: Array<{
        label: string;
        value?: string;
    }> = [
        afterReleased ? null : releasedRow,
        item.countries?.length ? { label: t('mediaPlayerPage.countries'), value: item.countries.join(', ') } : null,
        (item.type === 'show' || item.type === 'season') && total > 0
            ? { label: t('mediaPlayerPage.episodeProgress'), value: t('mediaPlayerPage.episodeProgressValue', { watched, total }) }
            : null,
        item.type === 'show' && item.childCount ? { label: t('mediaPlayerPage.seasons'), value: String(item.childCount) } : null,
        added ? { label: t('mediaPlayerPage.addedToLibrary'), value: added } : null,
        lastPlayed ? { label: t('mediaPlayerPage.lastPlayed'), value: lastPlayed } : null,
        item.viewCount ? { label: t('mediaPlayerPage.plays'), value: String(item.viewCount) } : null,
    ].filter(Boolean) as Array<{
        label: string;
        value?: string;
    }>;

    if (!crewRows.length && !serviceSections.length && !metaRows.length && !aside && !afterReleased && !releasedRow) return null;

    const renderMetaRow = (row: { label: string; value?: string; people?: PlayerPersonCredit[] }) => (
        <div key={row.label} className="flex flex-col gap-1 min-w-0">
            <span className="player-fact-label text-xs font-bold uppercase tracking-wider text-muted">{row.label}</span>
            {row.people?.length ? (
                <CreditPills people={row.people} onOpenPerson={onOpenPerson} interactive={!tvShell} />
            ) : (
                <span className="text-sm text-text leading-snug">{row.value}</span>
            )}
        </div>
    );

    const renderServiceSection = (section: { label: string; networks: NetworkLogo[]; size: 'sm' | 'md' | 'lg'; searchAllTypes: boolean; brandColor?: boolean }) => (
        <div key={section.label} className="flex flex-col gap-1 min-w-0">
            <span className="player-fact-label text-xs font-bold uppercase tracking-wider text-muted">{section.label}</span>
            <NetworkLogoRow
                networks={section.networks}
                onOpenStudio={onOpenStudio}
                sectionKey={item.librarySectionID || ''}
                mediaType={item.type === 'movie' ? 'movie' : 'show'}
                searchAllTypes={section.searchAllTypes}
                size={section.size}
                showPlate={section.brandColor ? false : settings.serviceLogoPlates}
                brandColor={section.brandColor}
            />
        </div>
    );

    const asideServices = serviceSections;
    const logosUnderAside = Boolean(aside) && asideServices.length > 0 && item.type !== 'episode';
    const detailBlocks: React.ReactNode[] = [
        ...crewRows.map((row) => renderMetaRow(row)),
        ...(logosUnderAside ? [] : serviceSections.map((section) => renderServiceSection(section))),
        ...metaRows.map((row) => renderMetaRow(row)),
    ];

    const packColumns = (count: number) => {
        const cols: React.ReactNode[][] = Array.from({ length: count }, () => []);
        detailBlocks.forEach((block, index) => {
            cols[index % count].push(block);
        });
        return cols;
    };

    const useCompactTwoCol = Boolean(aside || middle) || tvShell;
    const asideWidthClass = tvShell
        ? 'md:min-w-0 md:flex-1 md:max-w-[min(40rem,100%)]'
        : 'md:w-auto md:min-w-0 md:max-w-[min(44rem,100%)]';
    // Details | Media Info | spotlight — tops line up with Previous Episode.
    const rowClass = middle && aside && afterReleased
        ? `flex min-w-0 max-w-full flex-col gap-4 md:grid md:items-start md:gap-8 lg:gap-10 ${tvShell ? 'md:grid-cols-[auto_auto_minmax(0,1fr)]' : 'md:grid-cols-[auto_auto_minmax(26rem,max-content)]'}`
        : afterReleased && aside
            ? `flex min-w-0 max-w-full flex-col gap-4 md:grid md:items-start md:gap-8 lg:gap-10 ${tvShell ? 'md:grid-cols-[auto_auto_minmax(0,1fr)]' : 'md:grid-cols-[auto_auto_minmax(26rem,max-content)]'}`
        : middle && aside
            ? `flex min-w-0 max-w-full flex-col gap-4 md:grid md:items-start md:gap-8 lg:gap-10 ${tvShell ? 'md:grid-cols-[auto_minmax(16rem,1fr)_minmax(0,1fr)]' : 'md:grid-cols-[auto_minmax(16rem,1fr)_minmax(26rem,44rem)]'}`
        : aside
            ? 'flex min-w-0 max-w-full flex-col gap-4 md:flex-row md:items-start md:gap-8 lg:gap-10'
            : 'flex min-w-0 max-w-full flex-col gap-4';

    return (
        <div className="media-details-facts flex min-w-0 max-w-full flex-col gap-3">
            <div className={rowClass}>
                {/* Compact fact columns — stay grouped on the left when aside is present. */}
                <div className={`${aside || middle ? 'w-full min-w-0 md:w-auto md:shrink-0 md:self-start' : 'w-full min-w-0'} flex flex-col gap-3`}>
                    <SectionHeading>{t('media.details')}</SectionHeading>
                    <div className="flex flex-col gap-3 sm:hidden">
                        {detailBlocks}
                    </div>
                    <div className={`hidden sm:flex ${aside || middle ? 'gap-x-8' : 'gap-x-10'} ${useCompactTwoCol ? '' : 'xl:hidden'}`}>
                        {packColumns(2).map((column, index) => (
                            <div
                                key={`sm-${index}`}
                                className={`flex min-w-0 flex-col gap-3 ${aside || middle ? 'w-[12.5rem] sm:w-[14rem]' : 'flex-1'}`}
                            >
                                {column}
                            </div>
                        ))}
                    </div>
                    {!useCompactTwoCol ? (
                        <div className="hidden gap-x-10 xl:flex">
                            {packColumns(3).map((column, index) => (
                                <div key={`xl-${index}`} className="flex min-w-0 flex-1 flex-col gap-3">
                                    {column}
                                </div>
                            ))}
                        </div>
                    ) : null}
                    {afterReleased && !aside ? (
                        <div
                            className="media-details-released-block flex w-full min-w-0 flex-col gap-3"
                            style={{ maxWidth: middle ? '30rem' : '48rem' }}
                        >
                            {releasedRow ? renderMetaRow(releasedRow) : null}
                            <div
                                className="media-details-media-info flex w-full min-w-0 flex-col gap-3"
                                style={{ borderTop: '1px solid rgba(255,255,255,0.28)', paddingTop: '0.7rem' }}
                            >
                                <SectionHeading>{t('mediaPlayerPage.mediaInfo')}</SectionHeading>
                                {afterReleased}
                            </div>
                        </div>
                    ) : null}
                    {afterReleased && aside && releasedRow ? (
                        <div className="media-details-released-block flex w-full min-w-0 flex-col gap-3">
                            {renderMetaRow(releasedRow)}
                        </div>
                    ) : null}
                    {underDetails ? (
                        <div className="w-full min-w-0">{underDetails}</div>
                    ) : null}
                </div>
                {afterReleased && aside ? (
                    <div className="media-details-media-info-col flex w-full min-w-0 flex-col gap-3 md:w-auto md:max-w-[22rem] md:shrink-0 md:self-start">
                        <SectionHeading>{t('mediaPlayerPage.mediaInfo')}</SectionHeading>
                        <div className="media-details-media-info w-full min-w-0">
                            {afterReleased}
                        </div>
                    </div>
                ) : null}
                {middle ? (
                    <div className="media-details-facts-middle min-w-0 w-full md:self-start">
                        {middle}
                    </div>
                ) : null}
                {aside ? (
                    <div className={`media-details-facts-aside flex min-w-0 w-full max-w-full flex-col gap-4 md:self-start ${asideWidthClass}`}>
                        {aside}
                        {logosUnderAside ? (
                            <div className="flex flex-col gap-3">
                                {asideServices.map((section) => renderServiceSection({ ...section, size: 'lg' }))}
                            </div>
                        ) : null}
                    </div>
                ) : null}
            </div>
        </div>
    );
};

export const OverviewLinks: React.FC<{ item: PlayerItem }> = ({ item }) => {
    const { t } = useDiscoverI18n();
    // External browser links are useless on leanback — hide IMDb / TMDB / TVDB entirely.
    if (isTvShell()) return null;
    const ids = item.externalIds || { imdb: null, tmdb: item.tmdbId || null, tvdb: null };
    const tmdbType = item.type === 'movie' ? 'movie' : 'tv';
    const season = Number(item.parentIndex);
    const episode = Number(item.index);
    const tmdbHref = ids.tmdb
        ? (item.type === 'episode' && Number.isFinite(season) && season >= 0 && Number.isFinite(episode) && episode > 0
            ? `https://www.themoviedb.org/tv/${ids.tmdb}/season/${season}/episode/${episode}`
            : `https://www.themoviedb.org/${tmdbType}/${ids.tmdb}`)
        : null;
    const links = [
        ids.imdb ? { id: 'imdb', label: 'IMDb', href: `https://www.imdb.com/title/${ids.imdb}/` } : null,
        tmdbHref ? { id: 'tmdb', label: 'TMDB', href: tmdbHref } : null,
        ids.tvdb ? { id: 'tvdb', label: 'TVDB', href: `https://www.thetvdb.com/?tab=series&id=${ids.tvdb}` } : null,
    ].filter(Boolean) as Array<{ id: string; label: string; href: string }>;
    if (!links.length) return null;
    return (
        <div className="media-overview-links flex flex-wrap gap-2">
            {links.map((link) => (
                <a
                    key={link.id}
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white/5 px-2.5 py-1.5 text-xs font-bold text-text hover:bg-white/10 hover:border-plex/40"
                >
                    <ExternalLink className="h-3.5 w-3.5" />
                    {t('mediaPlayerPage.openSite', { name: link.label })}
                </a>
            ))}
        </div>
    );
};

const EpisodeNeighborCard: React.FC<{
    item: PlayerItem;
    label: string;
    icon: React.ReactNode;
    onOpenItem: (item: PlayerItem) => void;
    onPlay: (item: PlayerItem) => void;
}> = ({ item, label, icon, onOpenItem, onPlay }) => {
    const { t } = useDiscoverI18n();
    return (
        <div
            className="player-episode-neighbor relative flex min-h-[5.8rem] min-w-0 shrink-0 items-center gap-3.5 rounded-xl border border-border bg-white/5 px-3.5 py-2.5 w-[28.6rem] max-w-full"
            data-tv-episode-neighbor="1"
        >
            <button
                type="button"
                data-tv-item="1"
                data-tv-action="1"
                data-tv-episode-neighbor-btn="1"
                onClick={() => onOpenItem(item)}
                className="flex h-full min-w-0 flex-1 items-center gap-3 rounded-[0.65rem] text-left outline-none"
                aria-label={`${label} ${[formatEpisodeCode(item), item.title].filter(Boolean).join(' ')}`}
            >
                <div className="player-episode-neighbor-thumb relative h-[3.85rem] w-[6.6rem] shrink-0 overflow-hidden rounded-lg bg-black/40">
                    {item.thumb ? (
                        <img src={plexImageUrl(item.thumb, 426, 240, { quality: 60 })} alt="" className="h-full w-full object-cover" />
                    ) : (
                        <div className="flex h-full items-center justify-center text-muted">{icon}</div>
                    )}
                    {progressPercent(item) > 0 ? (
                        <div className="player-watch-bar absolute inset-x-0 bottom-0 h-0.5 bg-black/60">
                            <div className="h-full bg-plex" style={{ width: `${progressPercent(item)}%` }} />
                        </div>
                    ) : null}
                </div>
                <div className="min-w-0">
                    <p className="text-[11px] font-black uppercase tracking-widest text-muted">{label}</p>
                    <p className="truncate text-[0.96rem] font-bold text-text">
                        {[formatEpisodeCode(item), item.title].filter(Boolean).join(' · ')}
                    </p>
                    {item.durationMs ? (
                        <p className="text-[11px] text-muted">{formatPlayerDuration(item.durationMs)}</p>
                    ) : null}
                </div>
            </button>
            {item.canPlay ? (
                <button
                    type="button"
                    tabIndex={-1}
                    onClick={(event) => {
                        event.stopPropagation();
                        onPlay(item);
                    }}
                    className="shrink-0 rounded-full bg-plex p-2 text-black hover:bg-plex-hover"
                    aria-label={t('mediaPlayerPage.play')}
                >
                    <Play className="h-4 w-4 fill-current" />
                </button>
            ) : null}
        </div>
    );
};

export const EpisodeNeighbors: React.FC<{
    previous: PlayerItem | null;
    next: PlayerItem | null;
    onOpenItem: (item: PlayerItem) => void;
    onPlay: (item: PlayerItem) => void;
}> = ({ previous, next, onOpenItem, onPlay }) => {
    const { t } = useDiscoverI18n();
    if (!previous && !next) return null;
    return (
        <div className={`flex flex-col items-start gap-3 ${OVERVIEW_SPOTLIGHT_WIDTH_CLASS}`} data-tv-rail="1" data-tv-row="1">
            {previous ? (
                <EpisodeNeighborCard
                    item={previous}
                    label={t('mediaPlayerPage.previousEpisode')}
                    icon={<ChevronLeft className="h-5 w-5" />}
                    onOpenItem={onOpenItem}
                    onPlay={onPlay}
                />
            ) : null}
            {next ? (
                <EpisodeNeighborCard
                    item={next}
                    label={t('mediaPlayerPage.nextEpisode')}
                    icon={<ChevronRight className="h-5 w-5" />}
                    onOpenItem={onOpenItem}
                    onPlay={onPlay}
                />
            ) : null}
        </div>
    );
};
