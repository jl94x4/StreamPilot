def get_Country(movie_data):

    short_map = {
        # North America
        "United States of America": "United States",

        # Europe
        "Czech Republic": "Czechia",
        "Macedonia, The Former Yugoslav Republic of": "Macedonia",
        "Federal Republic of Germany": "Germany",
        "Republic of Moldova": "Moldova",
        "Russian Federation": "Russia",
        "United Kingdom of Great Britain and Northern Ireland": "United Kingdom",

        # Asia
        "Korea, Republic of": "South Korea",
        "Republic of Korea": "South Korea",
        "Korea, Democratic People's Republic of": "North Korea",
        "Hong Kong SAR China": "Hong Kong",
        "Macau SAR China": "Macau",
        "Taiwan, Province of China": "Taiwan",
        "Viet Nam": "Vietnam",
        "Lao People's Democratic Republic": "Laos",
        "Iran, Islamic Republic of": "Iran",
        "Islamic Republic of Iran": "Iran",
        "Syrian Arab Republic": "Syria",
        "Republic of the Union of Myanmar": "Myanmar",
        "People's Republic of China": "China",

        # Middle East
        "United Arab Emirates": "UAE",
        "Kingdom of Saudi Arabia": "Saudi Arabia",

        # South America
        "Bolivarian Republic of Venezuela": "Venezuela",
        "Venezuela, Bolivarian Republic of": "Venezuela",
    }

    # Countries often listed due to financing
    # If one of these is first, try the next country before settling on it
    FINANCEY_COUNTRIES = {
        "uae", "united arab emirates",
        "qatar",
        "luxembourg",
        "liechtenstein",
        "malta",
        "monaco",
        "saudi arabia",
        "hong kong",
        "singapore",
        "cayman islands",
        "bahamas",
    }

    countries = movie_data.get("Country", []) or []
    raw_tags = [c.get("tag") for c in countries if c.get("tag")]
    if not raw_tags:
        return None

    # Apply normalization while preserving order
    mapped = [short_map.get(tag, tag).strip() for tag in raw_tags if tag and tag.strip()]
    if not mapped:
        return None

    for tag in mapped:
        if tag.lower() not in FINANCEY_COUNTRIES:
            return tag

    return mapped[0]