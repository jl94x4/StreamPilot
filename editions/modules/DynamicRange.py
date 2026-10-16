# modules/DynamicRange.py

import re

# Delimiter pattern to reduce false positives (., _, -, space, (), [], etc.)
_TOKEN_SEP = r"(?:[.\s_\-\[\]\(\)]+)"

# Dolby Vision: must be standalone "DV" or "DoVi" or "Dolby Vision", NOT "DVD"
_PAT_DV = re.compile(
    rf"(?<![a-z0-9])(?:(?:dv(?!d|dr|drip|dremux|db|bd|br))|dovi|dolby{_TOKEN_SEP}vision)(?![a-z0-9])",
    re.I
)
_PAT_HDR10PLUS = re.compile(rf"(?<![a-z0-9])(?:hdr10\+|hdr10plus)(?![a-z0-9])", re.I)
_PAT_HDR10     = re.compile(rf"(?<![a-z0-9])hdr10(?!\+)(?![a-z0-9])", re.I)
_PAT_HLG       = re.compile(rf"(?<![a-z0-9])hlg(?![a-z0-9])", re.I)
_PAT_HDR       = re.compile(rf"(?<![a-z0-9])hdr(?!10\+?)(?![a-z0-9])", re.I)
_PAT_SDR       = re.compile(rf"(?<![a-z0-9])sdr(?![a-z0-9])", re.I)

def get_DynamicRange(movie_data):
    """
    Returns one of:
      "Dolby Vision", "Dolby Vision · HDR10", "HDR10+", "HDR10", "HLG", "HDR"
    or None when SDR / unknown (so it can be omitted from the edition title).

    Priority:
      1) Stream/Plex metadata
      2) Filename tokens (fallback only when metadata gives no decision)
    """

    def _low(s):
        return (str(s).strip().lower()) if s is not None else ""

    def _is_hdr10_from_color(stream):
        trc  = _low(stream.get("colorTrc"))
        prim = _low(stream.get("colorPrimaries"))
        return (trc in ("smpte2084", "pq", "pq_transfer")) and ("bt2020" in prim)

    def _has_hdr10_base(stream, disp_low):
        if "hdr10+" in disp_low:
            return False
        if "hdr10" in disp_low:
            return True
        vdr  = _low(stream.get("videoDynamicRange"))
        vdrt = _low(stream.get("videoDynamicRangeType"))
        if vdr == "hdr10" or vdrt == "hdr10":
            return True
        return _is_hdr10_from_color(stream)

    def _decide_from_stream(stream):
        if stream.get("streamType") != 1:
            return None
        disp = stream.get("displayTitle") or stream.get("title") or ""
        disp_low = _low(disp)
        vdr  = _low(stream.get("videoDynamicRange"))
        vdrt = _low(stream.get("videoDynamicRangeType"))
        trc  = _low(stream.get("colorTrc"))

        # Dolby Vision
        is_dv = (
            "dolby vision" in disp_low
            or "dovi" in disp_low
            or " dv " in f" {disp_low} "
            or ("doviprofile" in stream)
            or vdr == "dolby vision"
            or vdrt == "dolby vision"
        )
        if is_dv:
            if _has_hdr10_base(stream, disp_low):
                return "Dolby Vision · HDR10"
            return "Dolby Vision"

        # HDR10+
        if "hdr10+" in disp_low or vdrt == "hdr10+" or vdr == "hdr10+":
            return "HDR10+"

        # HDR10 (explicit or inferred)
        if "hdr10" in disp_low or vdr == "hdr10" or vdrt == "hdr10" or _is_hdr10_from_color(stream):
            return "HDR10"

        # HLG
        if "hlg" in disp_low or vdr == "hlg" or vdrt == "hlg" or trc in ("arib-std-b67", "hlg"):
            return "HLG"

        # Generic HDR
        if " hdr" in f" {disp_low}" or vdr == "hdr" or vdrt == "hdr":
            return "HDR"

        return None

    def _merge_best_label(current, candidate):
        priority = {
            "Dolby Vision · HDR10": 6,
            "Dolby Vision":         5,
            "HDR10+":               4,
            "HDR10":                3,
            "HLG":                  2,
            "HDR":                  1,
            None:                   0,
        }
        return candidate if priority.get(candidate, 0) > priority.get(current, 0) else current

    # --- 1) Metadata check ---
    best = None
    for media in movie_data.get("Media", []):
        for part in media.get("Part", []):
            for stream in part.get("Stream", []):
                if stream.get("streamType") == 1:
                    label = _decide_from_stream(stream)
                    best = _merge_best_label(best, label)
    if best:
        return best

    # --- 2) Filename fallback ---
    file_best = None
    for media in movie_data.get("Media", []):
        for part in media.get("Part", []):
            fname = part.get("file") or ""
            if not fname:
                continue

            has_sdr       = bool(_PAT_SDR.search(fname))
            has_dv        = bool(_PAT_DV.search(fname))
            has_hdr10plus = bool(_PAT_HDR10PLUS.search(fname))
            has_hdr10     = bool(_PAT_HDR10.search(fname))
            has_hlg       = bool(_PAT_HLG.search(fname))
            has_hdr       = bool(_PAT_HDR.search(fname))

            cand = None
            if has_dv and has_hdr10:
                cand = "Dolby Vision · HDR10"
            elif has_dv:
                cand = "Dolby Vision"
            elif has_hdr10plus:
                cand = "HDR10+"
            elif has_hdr10:
                cand = "HDR10"
            elif has_hlg:
                cand = "HLG"
            elif has_hdr and not has_sdr:
                cand = "HDR"
            else:
                cand = None

            file_best = _merge_best_label(file_best, cand)

    return file_best
