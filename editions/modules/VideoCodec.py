def get_VideoCodec(movie_data):
    media_list = movie_data.get('Media', [])
    if not media_list:
        return None
    codec = media_list[0].get('videoCodec')
    if not codec:
        return None

    c = codec.lower()

    mapping = {
        "hevc": "H.265",
        "h265": "H.265",
        "h.265": "H.265",
        "hvc1": "H.265",

        "h264": "H.264",
        "h.264": "H.264",
        "avc": "H.264",
        "avc1": "H.264",

        "av1": "AV1",
        "vp9": "VP9",
        "vp8": "VP8",

        "mpeg2": "MPEG-2",
        "mpeg-2": "MPEG-2",
        "mpeg4": "MPEG-4",
        "mpeg-4": "MPEG-4",
        "xvid": "XviD",
        "divx": "DivX",
        "vc1": "VC-1",
        "vc-1": "VC-1",

        "prores": "ProRes",
        "dnxhd": "DNxHD",
        "dnxhr": "DNxHR",

        "theora": "Theora",
    }

    return mapping.get(c, codec.upper())