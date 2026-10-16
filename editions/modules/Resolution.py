_ORDER = ["SD", "480P", "576P", "720P", "1080P", "1440P", "2K", "4K", "8K"]


def _normalize_resolution(raw):
    if raw is None:
        return None
    res = str(raw).strip().upper()
    if not res:
        return None
    if res in ("2160", "2160P"):
        return "4K"
    if res in ("4320", "4320P"):
        return "8K"
    if res == "SD":
        return "SD"
    if res.isdigit():
        res = f"{res}P"
    return res


def _rank(res):
    if res in _ORDER:
        return _ORDER.index(res)
    digits = "".join(ch for ch in str(res or "") if ch.isdigit())
    return int(digits) if digits else -1


def get_Resolution(movie_data):
    media_list = movie_data.get("Media", []) or []
    if not media_list:
        return None

    resolutions = set()
    for media in media_list:
        normalized = _normalize_resolution(media.get("videoResolution"))
        if normalized:
            resolutions.add(normalized)

    if not resolutions:
        return None

    return max(resolutions, key=_rank)
