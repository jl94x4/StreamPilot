from configparser import ConfigParser
from pathlib import Path
import logging
import re
import time
import requests
from urllib.parse import quote

logger = logging.getLogger(__name__)

# Cache for Letterboxd ratings: key -> (value, expires_at)
# Successful lookups are cached for 24 h; failures for 1 h so transient
# network errors don't permanently skip a movie for the session.
_letterboxd_cache: dict = {}
_LETTERBOXD_CACHE_MAX = 500
_CACHE_HIT_TTL  = 86_400   # 24 hours
_CACHE_MISS_TTL =  3_600   # 1 hour


def _lb_cache_get(key: str):
    """Return (hit, value). hit=True even when value is None (cached miss)."""
    entry = _letterboxd_cache.get(key)
    if entry is None:
        return False, None
    value, expires_at = entry
    if time.monotonic() >= expires_at:
        del _letterboxd_cache[key]
        return False, None
    return True, value


def _lb_cache_set(key: str, value) -> None:
    ttl = _CACHE_HIT_TTL if value is not None else _CACHE_MISS_TTL
    if len(_letterboxd_cache) >= _LETTERBOXD_CACHE_MAX:
        now = time.monotonic()
        # Evict expired entries first
        expired = [k for k, (_, exp) in _letterboxd_cache.items() if exp <= now]
        for k in expired:
            del _letterboxd_cache[k]
        # Still at capacity: drop oldest 100 by insertion order
        if len(_letterboxd_cache) >= _LETTERBOXD_CACHE_MAX:
            for k in list(_letterboxd_cache)[:100]:
                del _letterboxd_cache[k]
    _letterboxd_cache[key] = (value, time.monotonic() + ttl)


def get_Rating(movie_data, tmdb_api_key):
    config = ConfigParser()
    config.read(Path(__file__).parent.parent / 'config' / 'config.ini', encoding="utf-8")

    rating_source = config.get('rating', 'source', fallback='imdb').lower()
    rt_type = config.get('rating', 'rotten_tomatoes_type', fallback='critic').lower()

    if rating_source == 'imdb':
        # (really TMDb vote_average, 0-10, like "7.4")
        return _get_tmdb_rating(movie_data, tmdb_api_key)

    if rating_source == 'rotten_tomatoes':
        return _get_rotten_tomatoes_rating(movie_data, rt_type)

    if rating_source == 'letterboxd':
        return _get_letterboxd_rating(movie_data)

    return None

def _get_tmdb_rating(movie_data, tmdb_api_key):
    if not tmdb_api_key:
        logger.error("TMDb API key is missing.")
        return None

    title = movie_data.get('title')
    year = movie_data.get('year')
    if not title or not year:
        return None

    url = (
        "https://api.themoviedb.org/3/search/movie"
        f"?api_key={tmdb_api_key}"
        f"&query={requests.utils.quote(title)}"
        f"&year={year}"
    )

    try:
        resp = requests.get(url, timeout=10)
        resp.raise_for_status()
        data = resp.json()
        results = data.get('results', [])
        if results:
            rating = results[0].get('vote_average')
            if rating is not None:
                return f"{float(rating):.1f}"
    except Exception as e:
        logger.error(f"Error fetching TMDb rating for {title} ({year}): {e}")

    return None

def _format_percent(val):
    if val is None:
        return None
    try:
        num = float(val)

        # if Plex gave us 0-10 style (8.4), scale to 84
        if num <= 10:
            pct = int(round(num * 10))
        else:
            pct = int(round(num))

        return f"{pct}%"
    except Exception:
        return None

def _get_rotten_tomatoes_rating(movie_data, rt_type):
    # audience mode -> prefer audienceRating, fallback to rating
    if rt_type == 'audience':
        aud_raw = movie_data.get('audienceRating')
        formatted = _format_percent(aud_raw)
        if formatted:
            return formatted
        # fallback to critic-style (rating)
        crit_raw = movie_data.get('rating')
        return _format_percent(crit_raw)
    # critic mode (default) -> prefer rating, fallback to audienceRating
    crit_raw = movie_data.get('rating')
    formatted = _format_percent(crit_raw)
    if formatted:
        return formatted

    aud_raw = movie_data.get('audienceRating')
    return _format_percent(aud_raw)


def _title_to_slug(title: str) -> str:
    """Convert a movie title to a Letterboxd-style URL slug."""
    # Lowercase
    slug = title.lower()
    # Remove special characters, keep alphanumeric and spaces
    slug = re.sub(r'[^\w\s-]', '', slug)
    # Replace spaces with hyphens
    slug = re.sub(r'[\s_]+', '-', slug)
    # Remove multiple consecutive hyphens
    slug = re.sub(r'-+', '-', slug)
    # Strip leading/trailing hyphens
    slug = slug.strip('-')
    return slug


def _fetch_letterboxd_rating_from_url(url: str, headers: dict) -> str | None:
    """Fetch and extract rating from a Letterboxd film page."""
    try:
        response = requests.get(url, headers=headers, timeout=10)
        if response.status_code != 200:
            return None

        html = response.text

        # Extract the rating - look for various patterns
        rating_patterns = [
            # JSON-LD pattern (most reliable based on testing)
            re.compile(r'"ratingValue"\s*:\s*([\d.]+)', re.IGNORECASE),
            # Meta tag pattern
            re.compile(r'<meta\s+name="twitter:data2"\s+content="([\d.]+)\s+out\s+of\s+5"', re.IGNORECASE),
            # Average rating display
            re.compile(r'class="average-rating"[^>]*>\s*<a[^>]*>([\d.]+)</a>', re.IGNORECASE),
        ]

        for pattern in rating_patterns:
            match = pattern.search(html)
            if match:
                rating = float(match.group(1))
                # Sanity check - Letterboxd uses 5-star scale
                if 0 < rating <= 5:
                    return f"{rating:.1f}/5"

        return None
    except Exception:
        return None


def _search_letterboxd_slug(title: str, year, headers: dict) -> str | None:
    """
    Search Letterboxd for a film and return the slug of the first result.
    Used as a fallback when the locally-constructed slug doesn't match.
    """
    query = f"{title} {year}" if year else title
    url = f"https://letterboxd.com/search/films/{quote(query, safe='')}/"
    try:
        response = requests.get(url, headers=headers, timeout=10)
        if response.status_code != 200:
            return None
        # Film poster divs carry data-film-slug on search result pages;
        # the first match is the most relevant result.
        match = re.search(r'data-film-slug="([^"]+)"', response.text)
        if match:
            return match.group(1)
    except Exception:
        pass
    return None


def _get_letterboxd_rating(movie_data):
    """
    Fetch Letterboxd rating for a movie.
    Tries the locally-constructed slug first (direct and year-suffixed),
    then falls back to a Letterboxd search to handle title mismatches.
    Returns a string like "4.2/5" or None if not found.
    """
    title = movie_data.get('title')
    year = movie_data.get('year')

    if not title:
        return None

    cache_key = f"{title}:{year}"
    hit, cached_value = _lb_cache_get(cache_key)
    if hit:
        return cached_value

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    }

    try:
        slug = _title_to_slug(title)

        # 1. Direct slug, then year-suffixed (handles remakes/disambiguation)
        urls_to_try = [f"https://letterboxd.com/film/{slug}/"]
        if year:
            urls_to_try.append(f"https://letterboxd.com/film/{slug}-{year}/")

        for url in urls_to_try:
            result = _fetch_letterboxd_rating_from_url(url, headers)
            if result:
                _lb_cache_set(cache_key, result)
                return result

        # 2. Search fallback — catches titles whose slugs don't match locally
        search_slug = _search_letterboxd_slug(title, year, headers)
        if search_slug:
            result = _fetch_letterboxd_rating_from_url(
                f"https://letterboxd.com/film/{search_slug}/", headers
            )
            if result:
                _lb_cache_set(cache_key, result)
                return result

        _lb_cache_set(cache_key, None)
        return None

    except Exception as e:
        logger.error(f"Error fetching Letterboxd rating for {title}: {e}")
        _lb_cache_set(cache_key, None)
        return None