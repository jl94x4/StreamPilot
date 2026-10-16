import React, { useEffect, useState } from 'react';
import { Calendar, ChevronDown, MapPin, Star } from 'lucide-react';
import { useDiscoverI18n } from './i18n';
import { formatPersonDate, personAgeYears, splitBiography } from './personCredits';

export type PersonProfileHeaderPerson = {
    name?: string | null;
    biography?: string | null;
    birthday?: string | null;
    deathday?: string | null;
    knownForDepartment?: string | null;
    placeOfBirth?: string | null;
    placeOfDeath?: string | null;
    profilePath?: string | null;
};

type Props = {
    person: PersonProfileHeaderPerson;
    fallbackPhotoUrl?: string;
    showBiography?: boolean;
};

const tmdbProfileUrl = (profilePath?: string | null) => {
    const path = String(profilePath || '').trim();
    if (!path) return '';
    if (/^https?:\/\//i.test(path)) return path;
    return `https://image.tmdb.org/t/p/h632${path.startsWith('/') ? path : `/${path}`}`;
};

const chipClass = 'flex items-center gap-1.5 md:gap-2 bg-white/10 px-2.5 py-1 md:px-4 md:py-2 rounded-full border border-white/5';

export const PersonProfileHeader: React.FC<Props> = ({
    person,
    fallbackPhotoUrl = '',
    showBiography = true,
}) => {
    const { t, locale } = useDiscoverI18n();
    const [bioExpanded, setBioExpanded] = useState(false);
    const name = String(person?.name || '').trim() || t('navigation.person');
    const profilePath = person?.profilePath || (person as { profile_path?: string })?.profile_path;
    const knownForDepartment = person?.knownForDepartment || (person as { known_for_department?: string })?.known_for_department;
    const placeOfBirth = person?.placeOfBirth || (person as { place_of_birth?: string })?.place_of_birth;
    const birthday = String(person?.birthday || '').trim();
    const deathday = String(person?.deathday || (person as { death_day?: string })?.deathday || '').trim();
    const profileUrl = tmdbProfileUrl(profilePath) || String(fallbackPhotoUrl || '').trim();
    const age = personAgeYears(birthday, deathday || null);
    const biography = String(person?.biography || '').trim() || t('person.noBiography', { name });
    const { first: bioFirst, rest: bioRest, hasMore: bioHasMore } = splitBiography(biography);
    const bornText = birthday
        ? `${t('person.born', { date: formatPersonDate(birthday, locale) })}${
            age != null
                ? ` (${deathday ? t('person.aged', { count: age }) : t('person.yearsOld', { count: age })})`
                : ''
        }`
        : '';
    const diedText = deathday ? t('person.died', { date: formatPersonDate(deathday, locale) }) : '';

    useEffect(() => {
        setBioExpanded(false);
    }, [person?.name, person?.biography]);

    return (
        <div className="grid grid-cols-[6.75rem_minmax(0,1fr)] sm:grid-cols-[9.5rem_minmax(0,1fr)] md:grid-cols-[minmax(14rem,22rem)_minmax(0,1fr)] gap-x-4 gap-y-4 md:gap-x-8 md:gap-y-6 items-start">
            <div className={showBiography ? 'md:row-span-2' : ''}>
                {profileUrl ? (
                    <img
                        src={profileUrl}
                        alt={name}
                        className="w-full rounded-xl md:rounded-2xl object-cover aspect-[2/3] border border-border"
                    />
                ) : (
                    <div className="w-full rounded-xl md:rounded-2xl bg-white/5 border border-border aspect-[2/3] flex items-center justify-center">
                        <span className="text-muted text-xs md:text-2xl font-bold">{t('person.noPhoto')}</span>
                    </div>
                )}
            </div>

            <div className="min-w-0 flex flex-col gap-3 md:gap-6">
                <h1 className="text-2xl sm:text-4xl md:text-6xl font-black text-text tracking-tight leading-tight">
                    {name}
                </h1>

                <div className="flex flex-wrap gap-2 md:gap-4 text-[10px] md:text-sm font-bold text-muted uppercase tracking-widest">
                    {knownForDepartment ? (
                        <span className={chipClass}>
                            <Star className="w-3.5 h-3.5 md:w-4 md:h-4 text-plex" /> {knownForDepartment}
                        </span>
                    ) : null}
                    {bornText ? (
                        <span className={chipClass}>
                            <Calendar className="w-3.5 h-3.5 md:w-4 md:h-4 text-plex" /> {bornText}
                        </span>
                    ) : null}
                    {diedText ? (
                        <span className={chipClass}>
                            <Calendar className="w-3.5 h-3.5 md:w-4 md:h-4 text-plex" /> {diedText}
                        </span>
                    ) : null}
                    {placeOfBirth ? (
                        <span className={chipClass}>
                            <MapPin className="w-3.5 h-3.5 md:w-4 md:h-4 text-plex" /> {placeOfBirth}
                        </span>
                    ) : null}
                </div>
            </div>

            {showBiography ? (
                <div className="col-span-2 md:col-span-1 flex flex-col gap-3">
                    <h2 className="text-xl md:text-2xl font-bold text-text">{t('person.biography')}</h2>
                    <div className="text-muted text-base md:text-lg leading-relaxed whitespace-pre-line space-y-4">
                        <p>{bioFirst}</p>
                        {bioHasMore && bioExpanded ? <p>{bioRest}</p> : null}
                    </div>
                    {bioHasMore ? (
                        <button
                            type="button"
                            data-tv-item="1"
                            data-tv-action="1"
                            onClick={() => setBioExpanded((expanded) => !expanded)}
                            className="inline-flex items-center gap-1.5 text-sm font-bold text-plex hover:text-plex-hover transition-colors w-fit"
                        >
                            {bioExpanded ? t('common.showLess') : t('common.readMore')}
                            <ChevronDown className={`w-4 h-4 transition-transform ${bioExpanded ? 'rotate-180' : ''}`} />
                        </button>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
};
