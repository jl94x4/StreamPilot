def get_FrameRate(movie_data):
    media_list = movie_data.get('Media', [])
    if not media_list:
        return None
    fr = media_list[0].get('videoFrameRate') or media_list[0].get('frameRate')
    if not fr:
        return None

    try:
        fr_str = str(fr).lower().replace("p", "")
        val = float(fr_str)
        if abs(val - round(val)) < 0.01:
            return f"{int(round(val))}fps"
        else:
            return f"{val:.2f}fps"
    except:
        return f"{fr}fps"
