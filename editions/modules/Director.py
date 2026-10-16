def get_Director(movie_data):
    directors = movie_data.get('Director', [])
    if not directors:
        return None
    names = [d.get('tag') for d in directors if d.get('tag')]
    if not names:
        return None
    return names[0]