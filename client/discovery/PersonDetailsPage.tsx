import React, { useState, useEffect } from 'react';
import { ArrowLeft, Loader2, Film } from 'lucide-react';
import { apiFetch } from '../shared/api';
import { DiscoverPosterCard } from '../screens';
import { filterHiddenAvailableItems, useDiscoveryPreferences } from './useDiscoveryPreferences';
import { enrichDiscoverItemsWithAvailability } from './discoverAvailabilityEnrich';
import { upgraderPosterGridClass, upgraderPosterGridStyle } from '../shared/portalLayout';
import { useDiscoverI18n } from './i18n';
import { useDiscoverGridSize } from './useDiscoverGridSize';
import { PersonProfileHeader } from './PersonProfileHeader';
import {
    PERSON_CREDIT_ENRICH_CHUNK,
    mergeEnrichedPersonCredits,
    personCreditYear,
    splitPersonCredits,
} from './personCredits';

export const PersonDetailsPage: React.FC<{
    personId: number;
    onBack: () => void;
    onSelect: (item: any) => void;
    formatItem: (item: any) => any;
}> = ({ personId, onBack, onSelect, formatItem }) => {
    const { t, locale } = useDiscoverI18n();
    const { preferences } = useDiscoveryPreferences();
    const [gridSize] = useDiscoverGridSize();
    const [person, setPerson] = useState<any>(null);
    const [castCredits, setCastCredits] = useState<any[]>([]);
    const [crewCredits, setCrewCredits] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        const enrichChunked = async (items: any[], apply: (next: any[]) => void) => {
            if (!items.length) return;
            let current = items;
            for (let start = 0; start < items.length; start += PERSON_CREDIT_ENRICH_CHUNK) {
                if (cancelled) return;
                const chunk = items.slice(start, start + PERSON_CREDIT_ENRICH_CHUNK);
                const enriched = await enrichDiscoverItemsWithAvailability(chunk);
                if (cancelled) return;
                current = mergeEnrichedPersonCredits(current, enriched);
                apply(current);
            }
        };

        const fetchPerson = async () => {
            setLoading(true);
            setCastCredits([]);
            setCrewCredits([]);
            try {
                const [personData, creditsData] = await Promise.all([
                    apiFetch(`/api/discovery/proxy/person/${personId}`),
                    apiFetch(`/api/discovery/proxy/person/${personId}/combined_credits`),
                ]);
                if (cancelled) return;
                if (personData) setPerson(personData);

                const { cast, crew } = splitPersonCredits(creditsData || {});
                setCastCredits(cast);
                setCrewCredits(crew);
                setLoading(false);
                await Promise.all([
                    enrichChunked(cast, setCastCredits),
                    enrichChunked(crew, setCrewCredits),
                ]);
            } catch (err) {
                console.error(err);
                if (!cancelled) setLoading(false);
            }
        };
        fetchPerson();
        return () => { cancelled = true; };
    }, [personId, locale]);

    if (loading) {
        return (
            <div className="w-full flex justify-center py-32">
                <Loader2 className="w-12 h-12 text-plex animate-spin" />
            </div>
        );
    }

    if (!person) return null;

    const visibleCast = filterHiddenAvailableItems(castCredits, preferences.hideAvailableMedia);
    const visibleCrew = filterHiddenAvailableItems(crewCredits, preferences.hideAvailableMedia);
    const filmographyCount = visibleCast.length + visibleCrew.length;

    return (
        <div className="w-full flex flex-col gap-8 pb-12 animate-fade-in relative z-10 mt-4">
            <button 
                onClick={onBack}
                className="flex items-center gap-2 text-muted hover:text-text font-medium transition-colors w-fit"
            >
                <ArrowLeft className="w-5 h-5" /> {t('person.back')}
            </button>

            <PersonProfileHeader person={person} />

            {filmographyCount > 0 && (
                <div className="flex flex-col gap-10 mt-12 border-t border-border pt-10">
                    <h2 className="text-2xl font-black text-text flex items-center gap-3">
                        <Film className="w-6 h-6 text-plex" /> {t('person.filmography')}
                        <span className="text-sm font-bold text-muted tracking-normal">
                            {t('person.creditCount', { count: filmographyCount })}
                        </span>
                    </h2>
                    {visibleCast.length > 0 && (
                        <PersonCreditGrid
                            title={visibleCrew.length > 0 ? t('person.acting') : null}
                            items={visibleCast}
                            formatItem={formatItem}
                            onSelect={onSelect}
                            gridSize={gridSize}
                            roleOf={(item) => String(item?.character || '').trim()}
                        />
                    )}
                    {visibleCrew.length > 0 && (
                        <PersonCreditGrid
                            title={visibleCast.length > 0 ? t('person.crew') : null}
                            items={visibleCrew}
                            formatItem={formatItem}
                            onSelect={onSelect}
                            gridSize={gridSize}
                            roleOf={(item) => String(item?.job || item?.department || '').trim()}
                        />
                    )}
                </div>
            )}
        </div>
    );
};

const PersonCreditGrid: React.FC<{
    title?: string | null;
    items: any[];
    formatItem: (item: any) => any;
    onSelect: (item: any) => void;
    roleOf: (item: any) => string;
    gridSize: number;
}> = ({ title, items, formatItem, onSelect, roleOf, gridSize }) => (
    <div className="flex flex-col gap-4">
        {title ? <h3 className="text-lg font-bold text-text">{title}</h3> : null}
        <div className={upgraderPosterGridClass(gridSize)} style={upgraderPosterGridStyle(gridSize)}>
            {items.map((rawItem, idx) => {
                const formatted = formatItem(rawItem);
                const year = personCreditYear(rawItem) || formatted.year;
                const role = roleOf(rawItem);
                return (
                    <DiscoverPosterCard
                        key={`${formatted.mediaType || 'title'}-${formatted.id}-${idx}`}
                        item={formatted}
                        overlay={formatted.overlay}
                        showQualityBadges={false}
                        onPosterClick={() => onSelect(formatted)}
                        footer={(
                            <div className="text-[11px] font-medium leading-tight text-text text-center mt-1 px-0.5">
                                <div className="line-clamp-2">{formatted.title}</div>
                                {(year || role) ? (
                                    <div className="text-muted line-clamp-2 mt-0.5">
                                        {[year, role].filter(Boolean).join(' · ')}
                                    </div>
                                ) : null}
                            </div>
                        )}
                    />
                );
            })}
        </div>
    </div>
);
