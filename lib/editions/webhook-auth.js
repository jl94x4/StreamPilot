import { randomBytes } from 'crypto';
import { safeEqualString } from '../scanner/auth.js';

export const generateEditionsWebhookToken = () => randomBytes(32).toString('base64url');

export const extractEditionsWebhookToken = (req) => {
    const header = String(
        req?.get?.('x-editions-webhook-token')
        || req?.headers?.['x-editions-webhook-token']
        || req?.get?.('x-webhook-token')
        || req?.headers?.['x-webhook-token']
        || '',
    ).trim();
    if (header) return header;
    return String(req?.query?.token || '').trim();
};

export const editionsWebhookTokenMatches = (provided, expected) => {
    const got = String(provided || '');
    const want = String(expected || '');
    if (!want) return false;
    return safeEqualString(got, want);
};
