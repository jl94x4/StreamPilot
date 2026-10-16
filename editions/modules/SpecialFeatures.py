import requests
from configparser import ConfigParser
from pathlib import Path

def _classify_extra(ex):
    title = (ex.get('title') or "").lower()
    sub   = (ex.get('subtype') or ex.get('type') or "").lower()

    if "gag reel" in title or "bloopers" in title or "outtakes" in title:
        return "Gag Reel"
    if "deleted scene" in title or "deleted footage" in title:
        return "Deleted Scenes"
    if "behind the scenes" in title or "making of" in title or "on set" in title:
        return "Behind the Scenes"
    if "interview" in title or "q&a" in title or "qa" in title:
        return "Interviews"
    if "commentary" in title or "audio commentary" in title:
        return "Commentary Track"
    if "featurette" in title or "featurettes" in title:
        return "Featurette"
    if "screen test" in title or "camera test" in title:
        return "Screen Test"
    if "promo" in title or "tv spot" in title or "spot" in title:
        return "Promo / TV Spot"
    if "storyboard" in title:
        return "Storyboard"
    if "deleted" in sub:
        return "Deleted Scenes"
    if "behind" in sub:
        return "Behind the Scenes"
    if "interview" in sub:
        return "Interviews"
    if "featurette" in sub:
        return "Featurette"
    if "commentary" in sub:
        return "Commentary Track"
    if "scene" in sub and "alt" in sub:
        return "Alternate Scene"
    if "trailer" in sub or "trailer" in title:
        return "Trailer"
    return "Special Features"

def get_SpecialFeatures(movie_data):
    cfg = ConfigParser()
    cfg.read(Path(__file__).resolve().parent.parent / 'config' / 'config.ini', encoding='utf-8')
    server = cfg.get('server', 'address', fallback="").rstrip("/")
    token  = cfg.get('server', 'token', fallback="")
    movie_id = movie_data.get('ratingKey')

    if not (server and token and movie_id):
        return None

    url = f"{server}/library/metadata/{movie_id}/extras"
    headers = {"X-Plex-Token": token, "Accept": "application/json"}

    try:
        resp = requests.get(url, headers=headers, timeout=8)
        resp.raise_for_status()
        data = resp.json()
    except Exception:
        return None

    extras_list = data.get('MediaContainer', {}).get('Metadata', [])
    if not extras_list:
        return None

    kinds = []
    for ex in extras_list:
        label = _classify_extra(ex)
        if label:
            kinds.append(label)

    seen = []
    for k in kinds:
        if k not in seen:
            seen.append(k)

    # Filter out vague ones
    excluded = {"Trailer", "Special Features"}
    filtered = [k for k in seen if k not in excluded]

    if not filtered:
        return None

    short = filtered[:3]

    return " · ".join(short)