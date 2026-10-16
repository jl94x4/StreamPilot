import { safeEqualString } from '../scanner/auth.js';

export const extractPosterSetsWebhookToken = (req) => {
    const header = String(
        req?.get?.('x-poster-sets-webhook-token')
        || req?.headers?.['x-poster-sets-webhook-token']
        || req?.get?.('x-webhook-token')
        || req?.headers?.['x-webhook-token']
        || '',
    ).trim();
    if (header) return header;
    return String(req?.query?.token || '').trim();
};

export const posterSetsWebhookTokenMatches = (provided, expected) => {
    const got = String(provided || '');
    const want = String(expected || '');
    if (!want) return false;
    return safeEqualString(got, want);
};
