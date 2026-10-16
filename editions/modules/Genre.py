def get_Genre(movie_data):
    genres = movie_data.get('Genre', [])
    if not genres:
        return None
    names = [g.get('tag') for g in genres if g.get('tag')]
    if not names:
        return None
    return names[0]
