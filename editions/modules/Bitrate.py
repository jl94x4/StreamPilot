import requests

def get_Bitrate(movie_data):
    max_size = 0
    best_bitrate = None

    for media in movie_data.get('Media', []):
        br = media.get('bitrate')
        for part in media.get('Part', []):
            size = part.get('size', 0)
            if size > max_size:
                max_size = size
                best_bitrate = br

    if best_bitrate is None:
        return None

    try:
        kbps = float(best_bitrate)
    except:
        return None

    if kbps >= 1000:
        mbps = kbps / 1000.0
        return f"{mbps:.1f} Mbps"
    else:
        return f"{int(kbps)} Kbps"
