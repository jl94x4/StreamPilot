def get_Writer(movie_data):
    writers = movie_data.get('Writer', [])
    if not writers:
        return None
    names = [w.get('tag') for w in writers if w.get('tag')]
    if not names:
        return None
    return names[0]
