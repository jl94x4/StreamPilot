/** Cloudflare 520–530 are MediUX / ThePosterDB origin failures, not portal bugs. */

export const posterSetsUpstreamStatusCode = (message: string | null | undefined): number | null => {
    const text = String(message || '');
    const match = text.match(/\bStatus code:\s*(5(?:2[0-7]|30))\b/i)
        || text.match(/\bCloudflare\s+(5(?:2[0-7]|30))\b/i);
    return match ? Number(match[1]) : null;
};

export const isPosterSetsUpstreamOutage = (message: string | null | undefined): boolean => {
    const text = String(message || '');
    if (posterSetsUpstreamStatusCode(text) != null) return true;
    return /temporarily unreachable/i.test(text);
};
