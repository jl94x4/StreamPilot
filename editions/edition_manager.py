import os
import io
import re
import sys
import time
import json
import logging
import requests
import argparse
import threading
from datetime import datetime, UTC
from typing import List, Tuple
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from configparser import ConfigParser
from threading import Lock
_progress_lock = Lock()

# Import all modules at top-level for better performance
from modules.AudioChannels import get_AudioChannels
from modules.AudioCodec import get_AudioCodec
from modules.Bitrate import get_Bitrate
from modules.ContentRating import get_ContentRating
from modules.Country import get_Country
from modules.Cut import get_Cut
from modules.Director import get_Director
from modules.Duration import get_Duration
from modules.DynamicRange import get_DynamicRange
from modules.FrameRate import get_FrameRate
from modules.Genre import get_Genre
from modules.Language import get_Language
from modules.Rating import get_Rating
from modules.Release import get_Release
from modules.Resolution import get_Resolution
from modules.ShortFilm import get_ShortFilm
from modules.Size import get_Size
from modules.Source import get_Source
from modules.SpecialFeatures import get_SpecialFeatures
from modules.Studio import get_Studio
from modules.VideoCodec import get_VideoCodec
from modules.Writer import get_Writer

# Module registry: maps module name to (function, required_args)
# Args can be: 'movie_data', 'file_name', 'excluded_languages', 'skip_multiple_audio_tracks', 'tmdb_api_key'
MODULE_REGISTRY = {
    "AudioChannels": (get_AudioChannels, ["movie_data"]),
    "AudioCodec": (get_AudioCodec, ["movie_data"]),
    "Bitrate": (get_Bitrate, ["movie_data"]),
    "ContentRating": (get_ContentRating, ["movie_data"]),
    "Country": (get_Country, ["movie_data"]),
    "Cut": (get_Cut, ["file_name"]),
    "Director": (get_Director, ["movie_data"]),
    "Duration": (get_Duration, ["movie_data"]),
    "DynamicRange": (get_DynamicRange, ["movie_data"]),
    "FrameRate": (get_FrameRate, ["movie_data"]),
    "Genre": (get_Genre, ["movie_data"]),
    "Language": (get_Language, ["movie_data", "excluded_languages", "skip_multiple_audio_tracks"]),
    "Rating": (get_Rating, ["movie_data", "tmdb_api_key"]),
    "Release": (get_Release, ["file_name"]),
    "Resolution": (get_Resolution, ["movie_data"]),
    "ShortFilm": (get_ShortFilm, ["movie_data"]),
    "Size": (get_Size, ["movie_data"]),
    "Source": (get_Source, ["file_name", "movie_data"]),
    "SpecialFeatures": (get_SpecialFeatures, ["movie_data"]),
    "Studio": (get_Studio, ["movie_data"]),
    "VideoCodec": (get_VideoCodec, ["movie_data"]),
    "Writer": (get_Writer, ["movie_data"]),
}
_progress_total = 1
_progress_done = 0

BACKUP_DIR = Path(os.environ.get('EDITIONS_BACKUP_DIR') or (Path(__file__).parent / 'metadata_backup'))
UNDO_SNAPSHOT_FILE = BACKUP_DIR / '.undo_snapshot.json'


def _config_ini_path() -> Path:
    env = os.environ.get('EDITIONS_CONFIG_INI')
    if env:
        return Path(env)
    return Path(__file__).parent / 'config' / 'config.ini'

def _ensure_utf8_stream(stream):
    try:
        enc = getattr(stream, "encoding", None)
        if (enc or "").lower().replace("_", "-") == "utf-8":
            return stream
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="strict")
            return stream
    except Exception:
        pass
    try:
        return io.TextIOWrapper(stream.buffer, encoding="utf-8", errors="strict", line_buffering=True)
    except Exception:
        try:
            return io.TextIOWrapper(stream.buffer, encoding=enc or "utf-8", errors="replace", line_buffering=True)
        except Exception:
            return stream

sys.stdout = _ensure_utf8_stream(sys.stdout)
sys.stderr = _ensure_utf8_stream(sys.stderr)

if os.name == "nt" and sys.stdout.isatty():
    try:
        import ctypes
        kernel32 = ctypes.windll.kernel32
        kernel32.SetConsoleOutputCP(65001)
        kernel32.SetConsoleCP(65001)
    except Exception:
        pass

def _progress_set_total(n: int):
    global _progress_total, _progress_done
    with _progress_lock:
        _progress_total = max(1, int(n))
        _progress_done = 0
        print("PROGRESS 0"); sys.stdout.flush()

def _progress_step(k: int = 1):
    global _progress_done, _progress_total
    with _progress_lock:
        _progress_done += k
        pct = int((_progress_done * 100) / _progress_total)
    print(f"PROGRESS {min(100, max(0, pct))}")
    sys.stdout.flush()

# Token obfuscation for secure logging
def mask_sensitive_data(text: str) -> str:
    """Mask tokens and sensitive data in log messages."""
    if not isinstance(text, str):
        return str(text)
    # Mask X-Plex-Token in URLs
    text = re.sub(r'X-Plex-Token=[^&\s]+', 'X-Plex-Token=***', text, flags=re.IGNORECASE)
    # Mask token parameter
    text = re.sub(r'token=[^&\s]+', 'token=***', text, flags=re.IGNORECASE)
    # Mask Bearer tokens
    text = re.sub(r'Bearer\s+[A-Za-z0-9\-_]+', 'Bearer ***', text)
    # Mask API keys
    text = re.sub(r'api_key=[^&\s]+', 'api_key=***', text, flags=re.IGNORECASE)
    return text


class SecureFormatter(logging.Formatter):
    """Logging formatter that masks sensitive data like tokens."""

    def format(self, record):
        original = super().format(record)
        return mask_sensitive_data(original)


# Create a logger with secure formatting
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)
handler = logging.StreamHandler(sys.stdout)
formatter = SecureFormatter('[%(asctime)s] %(message)s', datefmt='%Y-%m-%d %H:%M:%S')
handler.setFormatter(formatter)
logger.addHandler(handler)

# Thread-local storage for requests session
thread_local = threading.local()

def get_session():
    """Get thread-local session for connection pooling"""
    if not hasattr(thread_local, "session"):
        thread_local.session = requests.Session()
    return thread_local.session

HTTP_TIMEOUT = 30
HTTP_RETRIES = 3 

def make_request(url, headers, timeout=HTTP_TIMEOUT):
    session = get_session()
    for attempt in range(HTTP_RETRIES):
        try:
            response = session.get(url, headers=headers, timeout=timeout)
            response.raise_for_status()
            return response.json()
        except requests.exceptions.ReadTimeout:
            if attempt < HTTP_RETRIES - 1:
                continue  # try again
            else:
                raise
        except requests.exceptions.ConnectionError:
            if attempt < HTTP_RETRIES - 1:
                continue
            else:
                raise

def find_movies_by_title(server, token, title):
    headers = {'X-Plex-Token': token, 'Accept': 'application/json'}
    libs = make_request(f'{server}/library/sections', headers)['MediaContainer']['Directory']

    results = []
    for lib in libs:
        if lib.get('type') != 'movie':
            continue
        key = lib.get('key')
        lib_title = lib.get('title')
        resp = make_request(f"{server}/library/sections/{key}/all?title={requests.utils.quote(title)}", headers)
        for m in resp.get('MediaContainer', {}).get('Metadata', []) or []:
            results.append({
                'ratingKey': m.get('ratingKey'),
                'title':     m.get('title'),
                'year':      m.get('year'),
                'thumb':     m.get('thumb'),
                'library':   lib_title,
                'raw':       m,
            })
    return results

def get_movie_by_rating_key(server, token, rating_key):
    """Fetch full movie metadata from a ratingKey."""
    headers = {'X-Plex-Token': token, 'Accept': 'application/json'}
    data = make_request(f'{server}/library/metadata/{rating_key}', headers)
    md = (data.get('MediaContainer', {}).get('Metadata') or [])
    return md[0] if md else None


def fetch_metadata_batch(server, token, rating_keys, batch_size=50):
    """
    Fetch detailed metadata for multiple movies in batched API calls.

    Plex API supports fetching multiple items via comma-separated ratingKeys.
    This reduces N individual API calls to N/batch_size calls.

    Args:
        server: Plex server URL
        token: Plex auth token
        rating_keys: List of ratingKey strings/ints
        batch_size: Number of items per API call (default 50, max ~100 recommended)

    Returns:
        Dict mapping ratingKey -> detailed metadata dict
    """
    headers = {'X-Plex-Token': token, 'Accept': 'application/json'}
    result = {}

    # Process in batches
    for i in range(0, len(rating_keys), batch_size):
        batch_keys = rating_keys[i:i + batch_size]
        keys_param = ','.join(str(k) for k in batch_keys)

        try:
            # Plex supports comma-separated ratingKeys in metadata endpoint
            url = f'{server}/library/metadata/{keys_param}'
            data = make_request(url, headers)

            metadata_list = data.get('MediaContainer', {}).get('Metadata', []) or []
            for item in metadata_list:
                rk = str(item.get('ratingKey'))
                result[rk] = item

        except Exception as e:
            logger.warning(f"Batch metadata fetch failed for keys {i}-{i+len(batch_keys)}: {e}")
            # Fallback: fetch individually for this batch
            for rk in batch_keys:
                try:
                    url = f'{server}/library/metadata/{rk}'
                    data = make_request(url, headers)
                    md = data.get('MediaContainer', {}).get('Metadata', [])
                    if md:
                        result[str(rk)] = md[0]
                except Exception as e2:
                    logger.warning(f"Individual fetch failed for {rk}: {e2}")

    return result


# Module name to template variable mapping
MODULE_TO_VAR = {
    "AudioChannels": "audio_channels",
    "AudioCodec": "audio_codec",
    "Bitrate": "bitrate",
    "ContentRating": "content_rating",
    "Country": "country",
    "Cut": "cut",
    "Director": "director",
    "Duration": "duration",
    "DynamicRange": "dynamic_range",
    "FrameRate": "frame_rate",
    "Genre": "genre",
    "Language": "language",
    "Rating": "rating",
    "Release": "release",
    "Resolution": "resolution",
    "ShortFilm": "short_film",
    "Size": "size",
    "Source": "source",
    "SpecialFeatures": "special_features",
    "Studio": "studio",
    "VideoCodec": "video_codec",
    "Writer": "writer",
}


def get_template_settings():
    """Load template settings from config."""
    config_file = _config_ini_path()
    config = ConfigParser(interpolation=None)
    config.read(config_file, encoding="utf-8")

    template_format = config.get('template', 'format', fallback='auto').strip()
    separator = config.get('template', 'separator', fallback=' • ')
    # Handle empty separator or bare bullet (ConfigParser strips trailing whitespace)
    if not separator or separator.strip() == '•':
        separator = ' • '
    max_length = config.getint('template', 'max_length', fallback=0)

    return template_format, separator, max_length


def format_edition_title(module_results: dict, modules: list, template_format: str, separator: str, max_length: int) -> str:
    """
    Format edition title using template or auto mode.

    Args:
        module_results: Dict mapping module names to their output values
        modules: List of enabled modules in order
        template_format: 'auto' or a custom format string like '{cut} - {resolution}'
        separator: Separator for auto mode
        max_length: Maximum title length (0 = unlimited)

    Returns:
        Formatted edition title string
    """
    if template_format.lower() == 'auto':
        # Auto mode: join all non-empty results in module order
        tags = []
        for module in modules:
            value = module_results.get(module)
            if value:
                tags.append(value)
        # Remove duplicates while preserving order
        tags = list(dict.fromkeys(tags))
        edition_title = separator.join(tags)
    else:
        # Custom template mode
        # Build variable dict from module results
        variables = {}
        for module_name, var_name in MODULE_TO_VAR.items():
            variables[var_name] = module_results.get(module_name, '') or ''

        # Replace template variables
        edition_title = template_format
        for var_name, value in variables.items():
            edition_title = edition_title.replace('{' + var_name + '}', value)

        # Clean up multiple separators and trim
        # Remove empty placeholders that result in double separators
        while '  ' in edition_title:
            edition_title = edition_title.replace('  ', ' ')
        # Clean up separators around empty values
        common_seps = [' · ', ' - ', ' | ', ' / ', ', ']
        for sep in common_seps:
            while sep + sep in edition_title:
                edition_title = edition_title.replace(sep + sep, sep)
            edition_title = edition_title.strip(sep.strip())
        edition_title = edition_title.strip()

    # Apply max length if specified
    if max_length > 0 and len(edition_title) > max_length:
        edition_title = edition_title[:max_length - 3].rsplit(separator.strip(), 1)[0] + '...'

    return edition_title

# Initialize settings
def initialize_settings():
    config_file = _config_ini_path()
    config = ConfigParser(interpolation=None)
    config.read(config_file, encoding="utf-8")

    server = config.get('server', 'address')
    token = config.get('server', 'token')

    skip_libraries = set(re.split(r'[；;]', config.get('server', 'skip_libraries', fallback=""))) if config.has_option('server', 'skip_libraries') else set()
    modules = re.split(r'[；;]', config.get('modules', 'order', fallback="")) if config.has_option('modules', 'order') else [
        "AudioChannels", "AudioCodec", "Bitrate", "ContentRating", "Country", "Cut",
        "Director", "Duration", "DynamicRange", "FrameRate", "Genre",
        "Language", "Rating", "Release", "Resolution", "Size",
        "Source", "SpecialFeatures", "Studio", "VideoCodec"
    ]

    excluded_languages = set()
    if config.has_option('language', 'excluded_languages'):
        excluded_languages = {
            lang.strip() for lang in re.split(r'[,;]', config.get('language', 'excluded_languages'))
            if lang.strip()
        }

    skip_multiple_audio_tracks = config.getboolean(
        'language',
        'skip_multiple_audio_tracks',
        fallback=False
    )

    tmdb_api_key = config.get('rating', 'tmdb_api_key', fallback=None)

    max_workers = config.getint('performance', 'max_workers', fallback=10)
    batch_size = config.getint('performance', 'batch_size', fallback=25)
    # Metadata batch size controls how many movies' detailed metadata to fetch per API call
    # Higher values = fewer API calls, but larger responses. 50 is a safe default.
    metadata_batch_size = config.getint('performance', 'metadata_batch_size', fallback=50)

    if not str(server or '').strip() or not str(token or '').strip():
        raise RuntimeError('Plex server address and token are required.')

    return (
        server,
        token,
        skip_libraries,
        modules,
        excluded_languages,
        skip_multiple_audio_tracks,
        tmdb_api_key,
        max_workers,
        batch_size,
        metadata_batch_size
    )

# Batched movie processing
def process_movies_batch(
    movies_batch,
    server,
    token,
    modules,
    excluded_languages,
    skip_multiple_audio_tracks,
    tmdb_api_key,
    lib_title=""
):
    """
    Process a batch of movies with optimized batch metadata fetching.

    Args:
        movies_batch: List of movie dicts to process
        server: Plex server URL
        token: Plex auth token
        modules: List of enabled module names
        excluded_languages: Set of languages to exclude
        skip_multiple_audio_tracks: Whether to skip multi-audio movies
        tmdb_api_key: TMDb API key for ratings
        lib_title: Library title for logging (optional)
    """
    if not movies_batch:
        return

    # Prefetch metadata for entire batch
    rating_keys = [str(m['ratingKey']) for m in movies_batch]
    prefetched_metadata = fetch_metadata_batch(server, token, rating_keys)

    for movie in movies_batch:
        try:
            process_single_movie(
                server,
                token,
                movie,
                modules,
                excluded_languages,
                skip_multiple_audio_tracks,
                tmdb_api_key,
                prefetched_metadata
            )
        except Exception as e:
            logger.error(f"Error processing movie {movie.get('title', 'Unknown')}: {str(e)}")

# Main movie processing function
def process_movies(
    server,
    token,
    skip_libraries,
    modules,
    excluded_languages,
    skip_multiple_audio_tracks,
    tmdb_api_key,
    max_workers,
    batch_size,
    metadata_batch_size=50
):
    """
    Process all movies in the library with optimized batch metadata fetching.

    Args:
        server: Plex server URL
        token: Plex auth token
        skip_libraries: Set of library names to skip
        modules: List of enabled module names
        excluded_languages: Set of languages to exclude
        skip_multiple_audio_tracks: Whether to skip multi-audio movies
        tmdb_api_key: TMDb API key for ratings
        max_workers: Number of concurrent workers
        batch_size: Number of movies per processing batch
        metadata_batch_size: Number of movies per metadata API call (default 50)
    """
    headers = {'X-Plex-Token': token, 'Accept': 'application/json'}
    libraries = make_request(f'{server}/library/sections', headers)['MediaContainer']['Directory']

    all_movies = []
    library_info = {}
    for library in libraries:
        if library.get('type') == 'movie' and library.get('title') not in skip_libraries:
            lib_title = library.get('title')
            resp = make_request(f"{server}/library/sections/{library['key']}/all", headers)
            movies = resp.get('MediaContainer', {}).get('Metadata', []) if resp else []
            all_movies.extend(movies)
            library_info[lib_title] = len(movies)

    logger.info(f"Total movies found: {len(all_movies)}")
    for lib_title, count in library_info.items():
        logger.info(f"Library: {lib_title}, Movies: {count}")

    _progress_set_total(len(all_movies))

    total_batches = (len(all_movies) + batch_size - 1) // batch_size

    from concurrent.futures import ThreadPoolExecutor, as_completed
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        for i in range(0, len(all_movies), batch_size):
            batch = all_movies[i:i+batch_size]
            batch_num = i // batch_size + 1

            # Prefetch detailed metadata for entire batch in batched API calls
            # This reduces N individual API calls to N/metadata_batch_size calls
            rating_keys = [str(m['ratingKey']) for m in batch]
            logger.info(f"Batch {batch_num}/{total_batches}: Prefetching metadata for {len(rating_keys)} movies...")

            prefetched_metadata = fetch_metadata_batch(server, token, rating_keys, metadata_batch_size)
            logger.info(f"Batch {batch_num}/{total_batches}: Prefetched {len(prefetched_metadata)} metadata entries")

            # Process movies with prefetched data (no individual API calls needed)
            futures = [
                executor.submit(
                    process_single_movie,
                    server,
                    token,
                    m,
                    modules,
                    excluded_languages,
                    skip_multiple_audio_tracks,
                    tmdb_api_key,
                    prefetched_metadata  # Pass prefetched data
                )
                for m in batch
            ]
            for _ in as_completed(futures):
                _progress_step()
            logger.info(
                f"Batch {batch_num}/{total_batches}: Processing complete"
            )

# Process a single movie
def process_single_movie(
    server,
    token,
    movie,
    modules,
    excluded_languages,
    skip_multiple_audio_tracks,
    tmdb_api_key,
    prefetched_metadata=None
):
    """
    Process a single movie and update its edition title.

    Args:
        server: Plex server URL
        token: Plex auth token
        movie: Basic movie metadata dict (from library listing)
        modules: List of enabled module names
        excluded_languages: Set of languages to exclude
        skip_multiple_audio_tracks: Whether to skip multi-audio movies
        tmdb_api_key: TMDb API key for ratings
        prefetched_metadata: Optional dict of ratingKey -> detailed metadata
                            (from batch fetch). If provided, skips individual API call.
    """
    movie_id = str(movie['ratingKey'])

    # Try to use prefetched metadata first (batch optimization)
    detailed_movie = None
    if prefetched_metadata and movie_id in prefetched_metadata:
        detailed_movie = prefetched_metadata[movie_id]
    else:
        # Fallback: fetch individually (for single-movie processing or cache miss)
        headers = {'X-Plex-Token': token, 'Accept': 'application/json'}
        try:
            detailed_response = get_session().get(
                f'{server}/library/metadata/{movie_id}',
                headers=headers
            )
            if detailed_response.status_code == 200:
                detailed_data = detailed_response.json()
                if 'MediaContainer' in detailed_data and 'Metadata' in detailed_data['MediaContainer']:
                    detailed_movie = detailed_data['MediaContainer']['Metadata'][0]
        except Exception as e:
            logger.warning(f"Could not fetch detailed metadata for movie {movie.get('title', 'Unknown')}: {str(e)}")

    movie_data = detailed_movie if detailed_movie else movie

    # Prefer the highest-resolution version so filename modules (Cut/Source) match Resolution.
    media_list = movie_data.get('Media', [])
    if not media_list:
        return

    def _res_rank(media):
        raw = str(media.get('videoResolution') or '').strip().upper()
        if raw in ('2160', '2160P'):
            raw = '4K'
        elif raw.isdigit():
            raw = f'{raw}P'
        order = ['SD', '480P', '576P', '720P', '1080P', '1440P', '2K', '4K', '8K']
        if raw in order:
            return (order.index(raw), int(media.get('bitrate') or 0))
        digits = ''.join(ch for ch in raw if ch.isdigit())
        return (int(digits) if digits else -1, int(media.get('bitrate') or 0))

    first_media = max(media_list, key=_res_rank)
    media_parts = first_media.get('Part', [])
    if not media_parts:
        return

    max_size_part = max(media_parts, key=lambda part: part['size'])
    file_path = max_size_part['file']
    file_name = os.path.basename(file_path)

    # Dict to store module results for template formatting
    module_results = {}

    # Build context dict for module arguments
    context = {
        "movie_data": movie_data,
        "file_name": file_name,
        "excluded_languages": excluded_languages,
        "skip_multiple_audio_tracks": skip_multiple_audio_tracks,
        "tmdb_api_key": tmdb_api_key,
    }

    # Run modules using registry pattern
    for module in modules:
        try:
            if module not in MODULE_REGISTRY:
                logger.warning(f"Unknown module: {module}")
                continue

            func, arg_names = MODULE_REGISTRY[module]
            args = [context[arg] for arg in arg_names]
            v = func(*args)

            if v:
                module_results[module] = v

        except Exception as e:
            logger.error(
                f"Error processing module {module} for {movie_data.get('title', 'Unknown')}: {str(e)}"
            )

    update_movie(server, token, movie_data, module_results, modules)

def process_movie_by_rating_key(
    server, token, rating_key, modules, excluded_languages, skip_multiple_audio_tracks, tmdb_api_key
):
    movie = get_movie_by_rating_key(server, token, rating_key)
    if not movie:
        logger.error(f"Movie with ratingKey {rating_key} not found.")
        return False

    # Log and send initial progress signal for GUI
    logger.info(f"Processing ratingKey={rating_key} ...")
    print("PROGRESS 0")
    sys.stdout.flush()

    # Run the standard single-movie processing routine
    process_single_movie(
        server, token, movie, modules, excluded_languages, skip_multiple_audio_tracks, tmdb_api_key
    )

    # Send completion signal for GUI progress bar
    print("PROGRESS 100")
    sys.stdout.flush()

    return True

def update_movie(server, token, movie, module_results, modules):
    """
    Update movie edition title in Plex.

    Args:
        server: Plex server URL
        token: Plex auth token
        movie: Movie metadata dict
        module_results: Dict mapping module names to their output values
        modules: List of enabled modules in order
    """
    movie_id = movie['ratingKey']
    title = movie.get('title', 'Unknown')
    current = str(movie.get('editionTitle') or '').strip()

    edition_title = ''
    if module_results:
        template_format, separator, max_length = get_template_settings()
        edition_title = format_edition_title(
            module_results, modules, template_format, separator, max_length
        ) or ''

    if edition_title == current:
        logger.info(f'{title}: unchanged ({edition_title or "empty"})')
        return True

    session = get_session()
    if not edition_title:
        session.put(
            f'{server}/library/metadata/{movie_id}',
            headers={'X-Plex-Token': token},
            params={
                'type': 1,
                'id': movie_id,
                'editionTitle.value': '',
                'editionTitle.locked': 0,
            },
        )
        logger.info(f'{title}: Cleared edition information')
        return True

    session.put(
        f'{server}/library/metadata/{movie_id}',
        headers={'X-Plex-Token': token},
        params={
            'type': 1,
            'id': movie_id,
            'editionTitle.value': edition_title,
            'editionTitle.locked': 1,
        },
    )
    logger.info(f'{title}: {edition_title}')
    return True

def reset_movies(server, token, skip_libraries, max_workers, batch_size):
    headers = {'X-Plex-Token': token, 'Accept': 'application/json'}
    libraries = make_request(f'{server}/library/sections', headers)['MediaContainer']['Directory']

    to_reset = []
    for lib in libraries:
        if lib.get('type') == 'movie' and lib.get('title') not in skip_libraries:
            resp = make_request(f"{server}/library/sections/{lib['key']}/all", headers)
            movies = resp.get('MediaContainer', {}).get('Metadata', []) if resp else []
            to_reset.extend([m for m in movies if 'editionTitle' in m])

    logger.info(f"Total movies to reset: {len(to_reset)}")
    _progress_set_total(len(to_reset))

    from concurrent.futures import ThreadPoolExecutor, as_completed
    def _reset_one(movie):
        movie_id = movie['ratingKey']
        params = {'type': 1, 'id': movie_id, 'editionTitle.value': '', 'editionTitle.locked': 0}
        s = get_session()
        s.put(f'{server}/library/metadata/{movie_id}', headers={'X-Plex-Token': token}, params=params)
        logger.info(f"Reset: {movie.get('title', 'Unknown')}")

    with ThreadPoolExecutor(max_workers=max_workers) as ex:
        for i in range(0, len(to_reset), batch_size):
            batch = to_reset[i:i+batch_size]
            futures = [ex.submit(_reset_one, m) for m in batch]
            for _ in as_completed(futures):
                _progress_step()
            logger.info(f"Reset batch {i//batch_size + 1}/{(len(to_reset)+batch_size-1)//batch_size}")

# Reset a single movie
def reset_movie(server, token, movie):
    movie_id = movie['ratingKey']
    title = movie.get('title', 'Unknown')
    
    try:
        params = {'type': 1, 'id': movie_id, 'editionTitle.value': '', 'editionTitle.locked': 0}
        session = get_session()
        session.put(f'{server}/library/metadata/{movie_id}', headers={'X-Plex-Token': token}, params=params)
        logger.info(f'Reset {title}')
        return True
    except Exception as e:
        logger.error(f"Error resetting movie {title}: {str(e)}")
        return False

# Backup metadata
def _backup_filename() -> Path:
    ts = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    return BACKUP_DIR / f"metadata_backup_{ts}.json"

def list_backups() -> List[Path]:
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    return sorted(BACKUP_DIR.glob("metadata_backup_*.json"))

def latest_backup() -> Path | None:
    files = list_backups()
    return files[-1] if files else None

def backup_metadata(server, token, backup_file: Path | None = None):
    headers = {'X-Plex-Token': token, 'Accept': 'application/json'}
    libraries = make_request(f'{server}/library/sections', headers)['MediaContainer']['Directory']

    payload = {
        "version": "1.0",
        "created_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "data": {}
    }

    for lib in libraries:
        if lib.get('type') == 'movie':
            response = make_request(f"{server}/library/sections/{lib['key']}/all", headers)
            for movie in response['MediaContainer'].get('Metadata', []) or []:
                payload["data"][movie['ratingKey']] = {
                    'title': movie.get('title', ''),
                    'editionTitle': movie.get('editionTitle', '')
                }

    backup_path = Path(backup_file) if backup_file else _backup_filename()
    backup_path.parent.mkdir(parents=True, exist_ok=True)

    # atomic-ish write
    tmp = backup_path.with_suffix(backup_path.suffix + ".tmp")
    with tmp.open('w', encoding='utf-8') as f:
        json.dump(payload, f, indent=2)
    tmp.replace(backup_path)

    print(f"Backup complete. {len(payload['data'])} movies saved to {backup_path}")
    prune_old_backups(keep=4)
    return backup_path

def prune_old_backups(keep: int = 4) -> None:
    files = sorted(BACKUP_DIR.glob("metadata_backup_*.json"))
    if len(files) <= keep:
        return
    to_delete = files[:-keep]  # oldest first
    for p in to_delete:
        try:
            p.unlink()
        except Exception as e:
            logger.warning(f"Could not delete old backup '{p}': {e}")


# Undo snapshot functions - separate from manual backups
def create_undo_snapshot(server, token) -> Path | None:
    """
    Create an undo snapshot before an operation.
    This is separate from manual user backups - it's a single file
    that gets overwritten each time to support undoing the last action.
    """
    headers = {'X-Plex-Token': token, 'Accept': 'application/json'}
    try:
        libraries = make_request(f'{server}/library/sections', headers)['MediaContainer']['Directory']
    except Exception as e:
        logger.warning(f"Could not create undo snapshot: {e}")
        return None

    payload = {
        "version": "1.0",
        "type": "undo_snapshot",
        "created_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "data": {}
    }

    for lib in libraries:
        if lib.get('type') == 'movie':
            try:
                response = make_request(f"{server}/library/sections/{lib['key']}/all", headers)
                for movie in response['MediaContainer'].get('Metadata', []) or []:
                    payload["data"][movie['ratingKey']] = {
                        'title': movie.get('title', ''),
                        'editionTitle': movie.get('editionTitle', '')
                    }
            except Exception as e:
                logger.warning(f"Error fetching library {lib.get('title', '?')}: {e}")

    UNDO_SNAPSHOT_FILE.parent.mkdir(parents=True, exist_ok=True)

    # Atomic-ish write
    tmp = UNDO_SNAPSHOT_FILE.with_suffix('.tmp')
    try:
        with tmp.open('w', encoding='utf-8') as f:
            json.dump(payload, f, indent=2)
        tmp.replace(UNDO_SNAPSHOT_FILE)
        logger.info(f"Undo snapshot created with {len(payload['data'])} movies.")
        return UNDO_SNAPSHOT_FILE
    except Exception as e:
        logger.warning(f"Could not write undo snapshot: {e}")
        if tmp.exists():
            tmp.unlink()
        return None


def get_undo_snapshot() -> Path | None:
    """Get the undo snapshot file if it exists."""
    if UNDO_SNAPSHOT_FILE.exists():
        return UNDO_SNAPSHOT_FILE
    return None


def restore_undo_snapshot(server, token) -> bool:
    """
    Restore from the undo snapshot.
    Returns True if successful, False otherwise.
    """
    if not UNDO_SNAPSHOT_FILE.exists():
        logger.error("No undo snapshot available.")
        return False

    try:
        with UNDO_SNAPSHOT_FILE.open('r', encoding='utf-8') as f:
            metadata = json.load(f)
    except Exception as e:
        logger.error(f"Could not read undo snapshot: {e}")
        return False

    data = metadata.get("data", {})
    if not data:
        logger.error("Undo snapshot is empty.")
        return False

    items = list(data.items())
    logger.info(f"Restoring from undo snapshot ({len(items)} movies)...")
    _progress_set_total(len(items))

    def _restore_one(pair):
        movie_id, meta = pair
        edition = meta.get('editionTitle', '')
        params = {'type': 1, 'id': movie_id, 'editionTitle.value': edition, 'editionTitle.locked': 1 if edition else 0}
        s = get_session()
        try:
            s.put(f'{server}/library/metadata/{movie_id}', headers={'X-Plex-Token': token}, params=params)
        except Exception as e:
            logger.error(f"Failed restore id={movie_id}: {e}")
        finally:
            _progress_step()

    from concurrent.futures import ThreadPoolExecutor, as_completed
    with ThreadPoolExecutor(max_workers=8) as ex:
        futures = [ex.submit(_restore_one, p) for p in items]
        for _ in as_completed(futures):
            pass

    logger.info("Undo restore complete.")
    return True


def clear_undo_snapshot() -> None:
    """Remove the undo snapshot file."""
    if UNDO_SNAPSHOT_FILE.exists():
        try:
            UNDO_SNAPSHOT_FILE.unlink()
        except Exception as e:
            logger.warning(f"Could not remove undo snapshot: {e}")


# Restore metadata
def restore_metadata(server, token, backup_file: Path | str | None):
    if backup_file is None:
        # Fallback to latest backup if none specified
        bf = latest_backup()
        if not bf:
            logger.error("No backup files found.")
            return
        backup_file = bf
        logger.info(f"Using latest backup: {backup_file}")

    backup_file = Path(backup_file)
    if not backup_file.exists():
        logger.error(f"Backup file not found: {backup_file}")
        return

    with backup_file.open('r', encoding='utf-8') as f:
        metadata = json.load(f)

    data = metadata.get("data", metadata)  # backward compatible if old format
    items = list(data.items())

    logger.info(f"Starting restore from {backup_file} for {len(items)} movies")
    _progress_set_total(len(items))

    def _restore_one(pair):
        movie_id, meta = pair
        edition = meta.get('editionTitle', '')
        params = {'type': 1, 'id': movie_id, 'editionTitle.value': edition, 'editionTitle.locked': 1 if edition else 0}
        s = get_session()
        try:
            s.put(f'{server}/library/metadata/{movie_id}', headers={'X-Plex-Token': token}, params=params)
        except Exception as e:
            logger.error(f"Failed restore id={movie_id}: {e}")
        finally:
            _progress_step()

    from concurrent.futures import ThreadPoolExecutor, as_completed
    with ThreadPoolExecutor(max_workers=8) as ex:
        futures = [ex.submit(_restore_one, p) for p in items]
        for _ in as_completed(futures):
            pass

    logger.info("Restore complete.")

def main():
    (
        server,
        token,
        skip_libraries,
        modules,
        excluded_languages,
        skip_multiple_audio_tracks,
        tmdb_api_key,
        max_workers,
        batch_size,
        metadata_batch_size
    ) = initialize_settings()
    
    parser = argparse.ArgumentParser(description='Manage Plex server movie editions')
    parser.add_argument('--all', action='store_true', help='Add edition info to all movies')
    parser.add_argument('--one', action='store_true',
                    help='Interactively search and process a single movie')
    parser.add_argument('--one-id', dest='one_id', metavar='RATINGKEY',
                        help='Process a single movie by ratingKey (non-interactive; used by GUI)')
    parser.add_argument('--reset', action='store_true', help='Reset edition info for all movies')
    parser.add_argument('--backup', action='store_true', help='Backup movie metadata')
    parser.add_argument('--restore', action='store_true', help='Restore movie metadata from backup')
    parser.add_argument('--list-backups', action='store_true', help='List available backup files')
    parser.add_argument('--restore-file', dest='restore_file', metavar='PATH', help='Restore from a specific backup file')
    parser.add_argument('--undo', action='store_true', help='Undo the last operation (restore from undo snapshot)')

    args = parser.parse_args()

    if args.one_id:
        ok = process_movie_by_rating_key(
            server, token, args.one_id, modules, excluded_languages, skip_multiple_audio_tracks, tmdb_api_key
        )
        logger.info('Done.' if ok else 'Failed.')

    elif args.one:
        # Interactive terminal flow
        title = input("Enter movie title to search: ").strip()
        if not title:
            logger.info("No title entered.")
            return
        matches = find_movies_by_title(server, token, title)
        if not matches:
            logger.info(f"No movies found for '{title}'.")
            return

        print(f"\nFound {len(matches)} match(es):")
        for i, m in enumerate(matches,  start=1):
            print(f"{i}. {m.get('title','?')} ({m.get('year','?')}) — {m.get('library','')}")
        sel = input("\nSelect a number (or Enter for 1): ").strip() or "1"
        try:
            idx = int(sel) - 1
            if idx < 0 or idx >= len(matches):
                raise ValueError
        except ValueError:
            print("Invalid selection.")
            return

        chosen = matches[idx]
        confirm = input(f"Process '{chosen['title']}' ({chosen.get('year','?')}) from {chosen.get('library','')}? [y/N]: ").strip().lower()
        if confirm != 'y':
            print("Cancelled.")
            return

        ok = process_movie_by_rating_key(
            server, token, chosen['ratingKey'], modules, excluded_languages, skip_multiple_audio_tracks, tmdb_api_key
        )
        logger.info('Done.' if ok else 'Failed.')

    elif args.backup:
        backup_metadata(server, token, None)
        logger.info('Metadata backup completed.')

    elif args.restore_file:
        restore_metadata(server, token, args.restore_file)
        logger.info('Metadata restoration completed.')

    elif args.restore:
        # Restore using the latest timestamped backup automatically
        restore_metadata(server, token, None)
        logger.info('Metadata restoration completed.')

    elif args.list_backups:
        files = list_backups()
        if not files:
            print("No backups found in", BACKUP_DIR)
        else:
            print("Available backups:")
            for p in files:
                print(" -", p)
        logger.info('Listed backups.')

    elif args.undo:
        # Restore from the undo snapshot
        ok = restore_undo_snapshot(server, token)
        if ok:
            logger.info('Undo completed successfully.')
        else:
            logger.error('Undo failed - no snapshot available or restore error.')

    elif args.all:
        # Create undo snapshot before processing (separate from manual backups)
        logger.info("Creating undo snapshot before processing...")
        create_undo_snapshot(server, token)

        process_movies(
            server,
            token,
            skip_libraries,
            modules,
            excluded_languages,
            skip_multiple_audio_tracks,
            tmdb_api_key,
            max_workers,
            batch_size,
            metadata_batch_size
        )

    elif args.reset:
        # Create undo snapshot before reset (separate from manual backups)
        logger.info("Creating undo snapshot before reset...")
        create_undo_snapshot(server, token)

        reset_movies(
            server,
            token,
            skip_libraries,
            max_workers,
            batch_size
        )

    else:
        logger.info('No action specified. Please use one of the following arguments:')
        logger.info('  --all: Add edition info to all movies')
        logger.info('  --one: Add edition info to one movie')
        logger.info('  --reset: Reset edition info for all movies')
        logger.info('  --backup: Backup movie metadata')
        logger.info('  --restore: Restore movie metadata from backup')

    logger.info('Script execution completed.')

if __name__ == '__main__':
    main()