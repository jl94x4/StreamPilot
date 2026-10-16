import requests

def get_Size(movie_data):
    max_size = 0
    for media in movie_data.get('Media', []):
        for part in media.get('Part', []):
            sz = part.get('size', 0)
            if sz > max_size:
                max_size = sz

    if max_size <= 0:
        return None

    gib = max_size / (1024 ** 3)
    mib = max_size / (1024 ** 2)

    if gib >= 1:
        return f"{gib:.1f} GB"
    else:
        return f"{mib:.0f} MB"
