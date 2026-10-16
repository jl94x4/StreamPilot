def get_ContentRating(movie_data):
    cr = movie_data.get('contentRating')
    if not cr:
        return None
    return cr
