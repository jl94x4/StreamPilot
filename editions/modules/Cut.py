import re

def get_Cut(file_name):
    name_low = file_name.lower()

    patterns = [
        (r"director'?s[ ._-]?cut|dirs[ ._-]?cut|dir[ ._-]?cut", "Director's Cut"),
        (r"extended( [._-]?(cut|edition|version))?", "Extended"),
        (r"(final)[ ._-]?cut", "Final Cut"),
        (r"(ultimate)[ ._-](cut|edition)?", "Ultimate Edition"),
        (r"(assembly|recut)[ ._-]?(cut|edition)?", "Assembly Cut"),
        (r"(special|collector'?s)[ ._-]?(edition|cut)?", "Special Edition"),
        (r"(workprint)[ ._-]?(cut|edition)?", "Workprint"),
        (r"(redux)[ ._-]?(cut|edition)?", "Redux"),
        (r"(festival|cannes|sundance)[ ._-]?cut", "Festival Cut"),
        (r"(theatrical|international|us[ ._-]?theatrical|tv[ ._-]?(cut|version)|network[ ._-]?cut)", "Theatrical Cut"),
        (r"(fan[ ._-]?edit|despecialized|fan[ ._-]?restoration)", "Fan Edit"),
        (r"\b(unrated|uncut)\b", "Unrated"),
        (r"imax(?![ ._-]?enhanced)", "IMAX"),
        (r"(\d{1,3})(st|nd|rd|th)?[ ._-]?anniversary", "Anniversary Edition"),
        (r"remaster", "Remastered"),
        (r"restored", "Restored"),
    ]

    for pat, label in patterns:
        if re.search(pat, name_low):
            return label

    return None