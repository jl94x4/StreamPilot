def get_Studio(movie_data):
    studios = movie_data.get('Studio', [])
    if not studios and movie_data.get('studio'):
        return movie_data.get('studio')
    if not studios:
        return None
    names = [s.get('tag') for s in studios if s.get('tag')]
    if not names:
        return None
    return names[0]
