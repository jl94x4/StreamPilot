import re

_SEP = r"(?:[.\s_\-\[\]\(\)]+)"

_LABEL_PATTERNS = [
    # The Criterion Collection (U.S.)
    (re.compile(rf"(?<![a-z0-9])criterion(\.collection)?(?![a-z0-9])", re.I), "Criterion"),
    (re.compile(rf"(?<![a-z0-9])janus(?![a-z0-9])", re.I), "Criterion"),
    # “CC” heuristic (Criterion Collection)
    (re.compile(r"(?<![a-z0-9])cc(?![a-z0-9])", re.I), "Criterion"),

    # Arrow Video (U.K. / U.S.)
    (re.compile(rf"(?<![a-z0-9])arrow({ _SEP }?video)?(?![a-z0-9])", re.I), "Arrow Video"),

    # Shout! / Scream Factory (U.S.)
    (re.compile(rf"(?<![a-z0-9])scream{_SEP}?factory(?![a-z0-9])", re.I), "Scream Factory"),
    (re.compile(rf"(?<![a-z0-9])shout!?{_SEP}?factory(?![a-z0-9])", re.I), "Shout Factory"),

    # Dark Star Pictures
    (re.compile(rf"(?<![a-z0-9])dark{_SEP}?star{_SEP}?pictures(?![a-z0-9])", re.I), "Dark Star Pictures"),

    # Kino Lorber (U.S.)
    (re.compile(rf"(?<![a-z0-9])kino({ _SEP }?lorber)?(?![a-z0-9])", re.I), "Kino Lorber"),

    # Vinegar Syndrome (U.S.)
    (re.compile(rf"(?<![a-z0-9])vinegar({ _SEP }?syndrome)?(?![a-z0-9])", re.I), "Vinegar Syndrome"),

    # Severin Films (U.S.)
    (re.compile(rf"(?<![a-z0-9])severin(?![a-z0-9])", re.I), "Severin Films"),

    # Second Sight Films (U.K.)
    (re.compile(rf"(?<![a-z0-9])second{_SEP}?sight(?![a-z0-9])", re.I), "Second Sight Films"),

    # 88 Films (U.K.)
    (re.compile(rf"(?<![a-z0-9])88\s*films?(?![a-z0-9])", re.I), "88 Films"),

    # Radiance Films (U.K.)
    (re.compile(rf"(?<![a-z0-9])radiance(?![a-z0-9])", re.I), "Radiance Films"),

    # Eureka! / Masters of Cinema (U.K.)
    (re.compile(rf"(?<![a-z0-9])eureka(?![a-z0-9])", re.I), "Masters of Cinema"),
    (re.compile(rf"(?<![a-z0-9])(masters{_SEP}?of{_SEP}?cinema|moc)(?![a-z0-9])", re.I), "Masters of Cinema"),

    # Imprint Films (Australia)
    (re.compile(rf"(?<![a-z0-9])imprint(?![a-z0-9])", re.I), "Imprint Films"),
    (re.compile(rf"(?<![a-z0-9])via{_SEP}?vision(?![a-z0-9])", re.I), "Imprint Films"),

    # Indicator / Powerhouse Films (U.K.)
    (re.compile(rf"(?<![a-z0-9])indicator(?![a-z0-9])", re.I), "Indicator Films"),
    (re.compile(rf"(?<![a-z0-9])powerhouse(?![a-z0-9])", re.I), "Indicator Films"),

    # Blue Underground (U.S.)
    (re.compile(rf"(?<![a-z0-9])blue{_SEP}?underground(?![a-z0-9])", re.I), "Blue Underground"),

    # Cult Epics (U.S.)
    (re.compile(rf"(?<![a-z0-9])cult{_SEP}?epics?(?![a-z0-9])", re.I), "Cult Epics"),

    # Arbelos Films
    (re.compile(rf"(?<![a-z0-9])arbelos(?![a-z0-9])", re.I), "Arbelos Films"),
]

# Priority so best-known U.S./U.K. boutiques come first
_PRIORITY = {
    "Criterion":          100,
    "Arrow Video":         95,
    "Shout Factory":       92,
    "Scream Factory":      91,
    "Kino Lorber":         90,
    "Vinegar Syndrome":    88,
    "Severin Films":       86,
    "Second Sight Films":  84,
    "88 Films":            82,
    "Radiance Films":      80,
    "Masters of Cinema":   78,
    "Imprint Films":       76,
    "Indicator Films":     74,
    "Blue Underground":    72,
    "Dark Star Pictures":  70,
    "Cult Epics":          68,
    "Arbelos Films":       66,
}

# Avoid matching “CC” for closed captions or subtitles
_CC_BAN = re.compile(r"(closed\.?captions?|caption|subs?|subtitles?)", re.I)

def get_Release(file_name: str):
    if not file_name:
        return None

    name = str(file_name)
    low = name.lower()

    found = set()

    for pat, label in _LABEL_PATTERNS:
        # Special handling for CC heuristic
        if label == "Criterion" and pat.pattern == r"(?<![a-z0-9])cc(?![a-z0-9])":
            if _CC_BAN.search(low):
                continue
        if pat.search(low):
            found.add(label)

    if not found:
        return None

    # Pick the single highest-priority label
    best = max(found, key=lambda x: _PRIORITY.get(x, 0))
    return best