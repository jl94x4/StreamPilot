def get_AudioChannels(movie_data):
    best_channels = 0

    for media in movie_data.get('Media', []):
        for part in media.get('Part', []):
            for stream in part.get('Stream', []):
                if stream.get('streamType') == 2:  # audio
                    ch = stream.get('channels', 0)
                    if ch and ch > best_channels:
                        best_channels = ch

    if best_channels == 0:
        return None

    mapping = {
        1: "1.0",
        2: "2.0",
        3: "2.1",
        4: "4.0",
        5: "5.0",
        6: "5.1",
        7: "6.1",
        8: "7.1",
    }
    return mapping.get(best_channels, f"{best_channels}-ch")