import re

def get_Source(file_name, movie_data):

    def match_source(title: str):
        sources = {
            r'\b(REMUX|BDREMUX|BD-REMUX)\b': 'Remux',
            r'\b(BLURAY|BD|BLU-RAY|BD1080P)\b': 'Blu-ray',
            r'\bBDRIP\b': 'Blu-ray Rip',
            r'\bWEB-DL|WEBDL\b': 'Web-DL',
            r'\bWEBRIP\b': 'WebRip',
            r'\bVODRIP\b': 'VOD Rip',
            r'\bHDRIP\b': 'HD Rip',
            r'\bHR-HDTV|HRHDTV\b': 'HR-HDTV',
            r'\bHDTV\b': 'HDTV',
            r'\bPDTV\b': 'PDTV',
            r'\bDVD\b': 'DVD',
            r'\bDVDRIP\b': 'DVD Rip',
            r'\bDVDSCR\b': 'DVD Screener',
            r'\bR5\b': 'R5',
            r'\bLDRIP\b': 'LD Rip',
            r'\bPPVRIP\b': 'PPV Rip',
            r'\bSDTV\b': 'SDTV',
            r'\bTVRIP\b': 'TV Rip',
            r'\bVHSRIP\b': 'VHS Rip',
            r'\bHDTC|HD-TC\b': 'HDTC',
            r'\bTC\b': 'TC',
            r'\bHDCAM|HD-CAM\b': 'HDCAM',
            r'\bHQCAM|HQ-CAM\b': 'HQCAM',
            r'\bTS\b': 'TS',
            r'\bCAM\b': 'CAM'
        }

        for pattern, source_value in sources.items():
            if re.search(pattern, title, re.IGNORECASE):
                return source_value
        return None

    source = match_source(file_name.upper())
    if source:
        return source

    for media in movie_data.get('Media', []):
        for part in media.get('Part', []):
            for stream in part.get('Stream', []):
                if stream.get('streamType') == 1:  # video
                    title = stream.get('title') or stream.get('displayTitle') or ""
                    if title:
                        found = match_source(title.upper())
                        if found:
                            return found

    return None