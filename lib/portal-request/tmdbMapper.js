/**
 * Map raw TMDB (snake_case) payloads to Overseerr/Seerr-shaped camelCase
 * responses that the Discover UI already consumes.
 */

import { detectAnimeMedia } from './animeMedia.js';

const mapCast = (person = {}) => ({
    castId: person.cast_id,
    character: person.character,
    creditId: person.credit_id,
    id: person.id,
    name: person.name,
    order: person.order,
    gender: person.gender,
    profilePath: person.profile_path,
});

const mapCrew = (person = {}) => ({
    creditId: person.credit_id,
    department: person.department,
    id: person.id,
    job: person.job,
    name: person.name,
    gender: person.gender,
    profilePath: person.profile_path,
});

const mapExternalIds = (ids = {}) => ({
    facebookId: ids.facebook_id,
    freebaseId: ids.freebase_id,
    freebaseMid: ids.freebase_mid,
    imdbId: ids.imdb_id,
    instagramId: ids.instagram_id,
    tvdbId: ids.tvdb_id,
    tvrageId: ids.tvrage_id,
    twitterId: ids.twitter_id,
});

const mapVideos = (videoResult) => {
    const results = Array.isArray(videoResult?.results) ? videoResult.results : [];
    return results.map((video) => ({
        site: video.site,
        key: video.key,
        name: video.name,
        size: video.size,
        type: video.type,
        url: video.site === 'YouTube' ? `https://www.youtube.com/watch?v=${video.key}` : undefined,
    }));
};

const mapProductionCompany = (company = {}) => ({
    id: company.id,
    name: company.name,
    originCountry: company.origin_country,
    description: company.description,
    headquarters: company.headquarters,
    homepage: company.homepage,
    logoPath: company.logo_path,
});

const mapWatchProviderDetails = (providers = []) => providers.map((provider) => ({
    displayPriority: provider.display_priority,
    logoPath: provider.logo_path,
    id: provider.provider_id,
    name: provider.provider_name,
}));

const mapWatchProviders = (results = {}) => Object.entries(results).map(([iso, provider]) => ({
    iso_3166_1: iso,
    link: provider?.link,
    buy: mapWatchProviderDetails(provider?.buy || []),
    flatrate: mapWatchProviderDetails(provider?.flatrate || []),
}));

export const mapMovieResult = (movie = {}, mediaType = 'movie') => ({
    id: movie.id,
    mediaType: movie.media_type || mediaType,
    adult: movie.adult,
    genreIds: movie.genre_ids || [],
    originalLanguage: movie.original_language,
    originalTitle: movie.original_title,
    overview: movie.overview || '',
    popularity: movie.popularity,
    releaseDate: movie.release_date || '',
    title: movie.title,
    video: movie.video,
    voteAverage: movie.vote_average,
    voteCount: movie.vote_count,
    backdropPath: movie.backdrop_path,
    posterPath: movie.poster_path,
});

export const mapTvResult = (tv = {}, mediaType = 'tv') => ({
    id: tv.id,
    tmdbId: tv.id,
    mediaType: tv.media_type || mediaType,
    firstAirDate: tv.first_air_date || '',
    genreIds: tv.genre_ids || [],
    name: tv.name,
    originCountry: tv.origin_country || [],
    originalLanguage: tv.original_language,
    originalName: tv.original_name,
    overview: tv.overview || '',
    popularity: tv.popularity,
    voteAverage: tv.vote_average,
    voteCount: tv.vote_count,
    backdropPath: tv.backdrop_path,
    posterPath: tv.poster_path,
});

export const mapPersonResult = (person = {}) => ({
    id: person.id,
    name: person.name,
    popularity: person.popularity,
    adult: person.adult,
    mediaType: person.media_type || 'person',
    profilePath: person.profile_path,
    knownFor: Array.isArray(person.known_for)
        ? person.known_for.map((entry) => (
            entry.media_type === 'tv' ? mapTvResult(entry) : mapMovieResult(entry)
        ))
        : [],
});

export const mapCollectionResult = (collection = {}) => ({
    id: collection.id,
    mediaType: collection.media_type || 'collection',
    adult: collection.adult,
    originalLanguage: collection.original_language,
    originalTitle: collection.original_title,
    title: collection.title,
    overview: collection.overview || '',
    backdropPath: collection.backdrop_path,
    posterPath: collection.poster_path,
});

export const mapSearchResult = (result = {}) => {
    switch (result.media_type) {
        case 'movie':
            return mapMovieResult(result);
        case 'tv':
            return mapTvResult(result);
        case 'collection':
            return mapCollectionResult(result);
        default:
            return mapPersonResult(result);
    }
};

export const mapPaginatedResults = (payload = {}, mapItem) => ({
    page: payload.page || 1,
    totalPages: payload.total_pages || payload.totalPages || 1,
    totalResults: payload.total_results || payload.totalResults || 0,
    results: Array.isArray(payload.results) ? payload.results.map(mapItem) : [],
});

const withAnimeFlag = (mapped, mediaType) => ({
    ...mapped,
    isAnime: detectAnimeMedia(mapped, { mediaType }),
});

export const mapMovieDetails = (movie = {}) => withAnimeFlag({
    id: movie.id,
    adult: movie.adult,
    budget: movie.budget,
    genres: movie.genres || [],
    relatedVideos: mapVideos(movie.videos),
    videos: movie.videos,
    originalLanguage: movie.original_language,
    originalTitle: movie.original_title,
    popularity: movie.popularity,
    productionCompanies: (movie.production_companies || []).map(mapProductionCompany),
    productionCountries: movie.production_countries || [],
    releaseDate: movie.release_date || '',
    releases: movie.release_dates,
    revenue: movie.revenue,
    spokenLanguages: movie.spoken_languages || [],
    status: movie.status,
    title: movie.title,
    video: movie.video,
    voteAverage: movie.vote_average,
    voteCount: movie.vote_count,
    backdropPath: movie.backdrop_path,
    homepage: movie.homepage,
    imdbId: movie.imdb_id,
    overview: movie.overview,
    posterPath: movie.poster_path,
    runtime: movie.runtime,
    tagline: movie.tagline,
    credits: {
        cast: (movie.credits?.cast || []).map(mapCast),
        crew: (movie.credits?.crew || []).map(mapCrew),
    },
    collection: movie.belongs_to_collection
        ? {
            id: movie.belongs_to_collection.id,
            name: movie.belongs_to_collection.name,
            posterPath: movie.belongs_to_collection.poster_path,
            backdropPath: movie.belongs_to_collection.backdrop_path,
        }
        : undefined,
    externalIds: mapExternalIds(movie.external_ids || {}),
    watchProviders: mapWatchProviders(movie['watch/providers']?.results || {}),
    keywords: (movie.keywords?.keywords || []).map((keyword) => ({
        id: keyword.id,
        name: keyword.name,
    })),
}, 'movie');

const mapEpisode = (episode = {}) => ({
    id: episode.id,
    name: episode.name,
    overview: episode.overview,
    airDate: episode.air_date,
    episodeNumber: episode.episode_number,
    seasonNumber: episode.season_number,
    stillPath: episode.still_path,
    voteAverage: episode.vote_average,
    voteCount: episode.vote_count,
    runtime: episode.runtime,
    productionCode: episode.production_code,
});

export const mapTvDetails = (tv = {}) => withAnimeFlag({
    id: tv.id,
    name: tv.name,
    tagline: tv.tagline,
    overview: tv.overview,
    status: tv.status,
    type: tv.type,
    popularity: tv.popularity,
    voteAverage: tv.vote_average,
    voteCount: tv.vote_count,
    firstAirDate: tv.first_air_date || '',
    lastAirDate: tv.last_air_date || '',
    posterPath: tv.poster_path,
    backdropPath: tv.backdrop_path,
    homepage: tv.homepage,
    inProduction: tv.in_production,
    originalLanguage: tv.original_language,
    originalName: tv.original_name,
    originCountry: tv.origin_country || [],
    numberOfEpisodes: tv.number_of_episodes,
    numberOfSeasons: tv.number_of_seasons,
    episodeRunTime: tv.episode_run_time || [],
    genres: tv.genres || [],
    languages: tv.languages || [],
    spokenLanguages: tv.spoken_languages || [],
    productionCompanies: (tv.production_companies || []).map(mapProductionCompany),
    productionCountries: tv.production_countries || [],
    networks: (tv.networks || []).map((network) => ({
        id: network.id,
        name: network.name,
        logoPath: network.logo_path,
        originCountry: network.origin_country,
    })),
    createdBy: (tv.created_by || []).map((person) => ({
        id: person.id,
        name: person.name,
        gender: person.gender,
        profilePath: person.profile_path,
        creditId: person.credit_id,
    })),
    seasons: (tv.seasons || []).map((season) => ({
        id: season.id,
        name: season.name,
        overview: season.overview,
        airDate: season.air_date,
        episodeCount: season.episode_count,
        posterPath: season.poster_path,
        seasonNumber: season.season_number,
        voteAverage: season.vote_average,
    })),
    lastEpisodeToAir: tv.last_episode_to_air ? mapEpisode(tv.last_episode_to_air) : null,
    nextEpisodeToAir: tv.next_episode_to_air ? mapEpisode(tv.next_episode_to_air) : null,
    relatedVideos: mapVideos(tv.videos),
    videos: tv.videos,
    credits: {
        cast: (tv.credits?.cast || []).map(mapCast),
        crew: (tv.credits?.crew || []).map(mapCrew),
    },
    externalIds: mapExternalIds(tv.external_ids || {}),
    watchProviders: mapWatchProviders(tv['watch/providers']?.results || {}),
    keywords: (tv.keywords?.results || tv.keywords?.keywords || []).map((keyword) => ({
        id: keyword.id,
        name: keyword.name,
    })),
}, 'tv');

export const mapPersonDetails = (person = {}) => ({
    id: person.id,
    name: person.name,
    alsoKnownAs: person.also_known_as || [],
    biography: person.biography,
    birthday: person.birthday,
    deathday: person.deathday,
    gender: person.gender,
    homepage: person.homepage,
    imdbId: person.imdb_id,
    knownForDepartment: person.known_for_department,
    placeOfBirth: person.place_of_birth,
    popularity: person.popularity,
    profilePath: person.profile_path,
    adult: person.adult,
    externalIds: mapExternalIds(person.external_ids || {}),
});

export const mapCombinedCredits = (credits = {}) => {
    const cast = (credits.cast || []).map((entry) => {
        if (entry.media_type === 'tv') {
            return { ...mapTvResult(entry), character: entry.character, creditId: entry.credit_id };
        }
        return { ...mapMovieResult(entry), character: entry.character, creditId: entry.credit_id };
    });
    const crew = (credits.crew || []).map((entry) => {
        if (entry.media_type === 'tv') {
            return { ...mapTvResult(entry), job: entry.job, department: entry.department, creditId: entry.credit_id };
        }
        return { ...mapMovieResult(entry), job: entry.job, department: entry.department, creditId: entry.credit_id };
    });
    return { id: credits.id, cast, crew };
};

export const mapSeasonDetails = (season = {}) => ({
    id: season.id,
    name: season.name,
    overview: season.overview,
    airDate: season.air_date,
    posterPath: season.poster_path,
    seasonNumber: season.season_number,
    voteAverage: season.vote_average,
    episodes: (season.episodes || []).map(mapEpisode),
});

export const mapWatchProviderList = (payload = {}) => ({
    results: (payload.results || []).map((provider) => ({
        id: provider.provider_id,
        name: provider.provider_name,
        displayPriority: provider.display_priority,
        logoPath: provider.logo_path,
    })),
});
