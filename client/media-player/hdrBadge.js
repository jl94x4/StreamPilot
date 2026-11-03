/** Compact HDR / Dolby Vision badge for overview meta chips. */

const HDR_BADGE_PRIORITY = {
    'DV HDR10': 6,
    DV: 5,
    'HDR10+': 4,
    HDR10: 3,
    HLG: 2,
    HDR: 1,
};

const pickBetterHdrBadge = (current, next) => {
    if (!next) return current;
    if (!current) return next;
    return HDR_BADGE_PRIORITY[next] > HDR_BADGE_PRIORITY[current] ? next : current;
};

const isTruthyDovi = (value) => (
    value === true
    || value === 1
    || String(value || '').toLowerCase() === 'true'
    || String(value || '') === '1'
);

const hdrBadgeFromVideoStream = (video) => {
    if (!video) return null;
    const disp = String(video.displayTitle || '').toLowerCase();
    const vdr = String(video.videoDynamicRange || '').toLowerCase();
    const vdrt = String(video.videoDynamicRangeType || '').toLowerCase();
    const trc = String(video.colorTrc || '').toLowerCase();
    const prim = String(video.colorPrimaries || '').toLowerCase();
    const padded = ` ${disp} `;

    const hdr10FromColor = (trc === 'smpte2084' || trc === 'pq' || trc === 'pq_transfer')
        && prim.includes('bt2020');
    const hasHdr10Base = (
        (disp.includes('hdr10') && !disp.includes('hdr10+') && !disp.includes('hdr10plus'))
        || vdr === 'hdr10'
        || vdrt === 'hdr10'
        || hdr10FromColor
    );
    const isDv = isTruthyDovi(video.DOVIPresent)
        || (video.DOVIProfile != null && String(video.DOVIProfile).trim() !== '')
        || disp.includes('dolby vision')
        || disp.includes('dovi')
        || /(?:^|[^a-z0-9])dv(?:[^a-z0-9]|$)/.test(padded.replace(/dvd|dvdr|dvdrip|dremux/g, ' '))
        || vdr.includes('dolby vision')
        || vdrt.includes('dolby vision');

    if (isDv) return hasHdr10Base ? 'DV HDR10' : 'DV';
    if (disp.includes('hdr10+') || disp.includes('hdr10plus') || vdr === 'hdr10+' || vdrt === 'hdr10+') {
        return 'HDR10+';
    }
    if (disp.includes('hdr10') || vdr === 'hdr10' || vdrt === 'hdr10' || hdr10FromColor) {
        return 'HDR10';
    }
    if (disp.includes('hlg') || vdr === 'hlg' || vdrt === 'hlg' || trc === 'arib-std-b67' || trc === 'hlg') {
        return 'HLG';
    }
    if (/\bhdr\b/.test(disp) || vdr === 'hdr' || vdrt === 'hdr' || trc === 'smpte2084' || trc === 'pq') {
        return 'HDR';
    }
    return null;
};

const hdrBadgeFromFileName = (fileName) => {
    const name = String(fileName || '');
    if (!name) return null;
    const hasSdr = /(?<![a-z0-9])sdr(?![a-z0-9])/i.test(name);
    const hasDv = /(?<![a-z0-9])(?:(?:dv(?!d|dr|drip|dremux|db|bd|br))|dovi|dolby[.\s_\-\[\]\(\)]+vision)(?![a-z0-9])/i.test(name);
    const hasHdr10Plus = /(?<![a-z0-9])(?:hdr10\+|hdr10plus)(?![a-z0-9])/i.test(name);
    const hasHdr10 = /(?<![a-z0-9])hdr10(?!\+)(?![a-z0-9])/i.test(name);
    const hasHlg = /(?<![a-z0-9])hlg(?![a-z0-9])/i.test(name);
    const hasHdr = /(?<![a-z0-9])hdr(?!10\+?)(?![a-z0-9])/i.test(name);
    if (hasDv && hasHdr10) return 'DV HDR10';
    if (hasDv) return 'DV';
    if (hasHdr10Plus) return 'HDR10+';
    if (hasHdr10) return 'HDR10';
    if (hasHlg) return 'HLG';
    if (hasHdr && !hasSdr) return 'HDR';
    return null;
};

/**
 * Best HDR / Dolby Vision badge for a media version.
 * Prefers Plex stream metadata; falls back to the on-disk filename.
 */
export const detectPlayerHdrLabel = (source) => {
    if (!source) return null;
    let best = hdrBadgeFromVideoStream(source.video);
    best = pickBetterHdrBadge(best, hdrBadgeFromFileName(source.fileName));
    const list = Array.isArray(source.mediaInfo) ? source.mediaInfo : [];
    const preferred = list[
        Math.min(Math.max(0, Number(source.mediaIndex) || 0), Math.max(0, list.length - 1))
    ] || list[0];
    for (const media of preferred ? [preferred] : list) {
        for (const part of media?.parts || []) {
            best = pickBetterHdrBadge(best, hdrBadgeFromVideoStream(part?.video));
            best = pickBetterHdrBadge(best, hdrBadgeFromFileName(part?.fileName));
        }
    }
    return best;
};

export const playerHdrBadgeTitle = (label) => {
    if (label === 'DV') return 'Dolby Vision';
    if (label === 'DV HDR10') return 'Dolby Vision · HDR10';
    if (label === 'HDR10+') return 'HDR10+';
    if (label === 'HDR10') return 'HDR10';
    if (label === 'HLG') return 'HLG';
    if (label === 'HDR') return 'HDR';
    return '';
};
