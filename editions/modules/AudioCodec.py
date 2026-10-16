def get_AudioCodec(movie_data):
    best = None
    for media in movie_data.get('Media', []):
        for part in media.get('Part', []):
            for stream in part.get('Stream', []):
                if stream.get('streamType') == 2:  # audio
                    cand = {
                        "channels": stream.get('channels', 0) or 0,
                        "bitrate":  stream.get('bitrate', 0) or 0,
                        "codec":    (stream.get('codec') or "") ,
                        "profile":  (stream.get('profile') or ""),
                        "title":    (stream.get('title') or ""),
                        "display":  (stream.get('displayTitle') or ""),
                        "audioProfile": (stream.get('audioProfile') or ""),
                    }
                    if best is None:
                        best = cand
                    else:
                        if (cand["channels"] > best["channels"] or
                           (cand["channels"] == best["channels"] and cand["bitrate"] > best["bitrate"])):
                            best = cand

    if not best:
        return None

    blob = " ".join([
        str(best.get("display") or ""),
        str(best.get("title") or ""),
        str(best.get("codec") or ""),
        str(best.get("profile") or ""),
        str(best.get("audioProfile") or ""),
    ]).upper()

    import re
    blob = re.sub(r'\b(?:MONO|STEREO)\b', '', blob)
    blob = re.sub(r'\b(?:\d{1,2}\.\d|\d{1,2}\s*CH|CHANNELS?)\b', '', blob)
    blob = re.sub(r'\b(?:L\s?R|SURROUND|MULTICHANNEL)\b', '', blob)
    blob = re.sub(r'\s+', ' ', blob).strip()

    has_atmos = any(k in blob for k in ("ATMOS", "JOC", "DOLBY ATMOS"))
    has_dtsx  = any(k in blob for k in ("DTS:X", "DTSX", "DTS X"))
    has_auro  = any(k in blob for k in ("AURO-3D", "AURO 3D", "AURO3D", "AURO"))

    if has_dtsx:
        return "DTS:X"

    if has_auro:
        return "Auro-3D"

    def base_codec_from(text: str) -> str | None:
        if any(k in text for k in ("E-AC-3", "EAC3", "DDP", "DD+", "DOLBY DIGITAL PLUS")):
            return "Dolby Digital Plus"
        if any(k in text for k in ("AC3", "AC-3", "DOLBY DIGITAL")):
            return "Dolby Digital"
        if "TRUEHD" in text or "TRUE-HD" in text or "DOLBY TRUEHD" in text:
            return "Dolby TrueHD"

        if any(k in text for k in ("DTS-HD MA", "DTSHD MA", "DTS-HD.MA", "DTS HD MA")):
            return "DTS-HD MA"
        if any(k in text for k in ("DTS-HD HRA", "DTSHD HRA", "DTS-HR", "DTS HD HRA")):
            return "DTS-HD HRA"
        if "DTS" in text:
            return "DTS"

        if "FLAC" in text:
            return "FLAC"
        if any(k in text for k in ("PCM", "LPCM", "PCM S16LE", "PCM S24LE")):
            return "PCM"
        if "OPUS" in text:
            return "Opus"
        if "ALAC" in text:
            return "ALAC"
        if "VORBIS" in text:
            return "Vorbis"

        if "AAC" in text:
            return "AAC"

        return None

    base = base_codec_from(blob)

    if base is None and has_atmos:
        return "Dolby Atmos"

    if base is None:
        return None

    if has_atmos and base in ("Dolby Digital Plus", "Dolby TrueHD"):
        return f"{base} Atmos"

    return base