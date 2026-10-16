def get_Duration(movie_data):
    dur_ms = movie_data.get('duration')
    if not dur_ms:
        return None
    total_minutes = int(dur_ms // 60000)
    hours = total_minutes // 60
    mins = total_minutes % 60
    if hours > 0:
        return f"{hours}h {mins}m"
    return f"{mins}m"