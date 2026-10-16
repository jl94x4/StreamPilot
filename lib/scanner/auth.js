import { timingSafeEqual } from 'crypto';

export const safeEqualString = (a, b) => {
    const left = Buffer.from(String(a ?? ''), 'utf8');
    const right = Buffer.from(String(b ?? ''), 'utf8');
    if (left.length !== right.length) {
        // Compare against self so length mismatches still take similar work.
        timingSafeEqual(left, left);
        return false;
    }
    return timingSafeEqual(left, right);
};

/**
 * HTTP Basic Auth for /triggers/* webhooks.
 */
export const createBasicAuthMiddleware = ({ getCredentials, realm = 'Scanner' }) => {
    return (req, res, next) => {
        const creds = getCredentials() || {};
        const username = String(creds.username || '');
        const password = String(creds.password || '');

        if (!username || !password) {
            res.status(503).json({ error: `${realm} webhook auth is not configured` });
            return;
        }

        const header = req.headers.authorization || '';
        if (!header.startsWith('Basic ')) {
            res.set('WWW-Authenticate', `Basic realm="${realm}"`);
            res.status(401).send('Authentication required');
            return;
        }

        let decoded = '';
        try {
            decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
        } catch {
            res.status(401).send('Invalid authorization');
            return;
        }

        const sep = decoded.indexOf(':');
        const user = sep >= 0 ? decoded.slice(0, sep) : decoded;
        const pass = sep >= 0 ? decoded.slice(sep + 1) : '';

        if (!safeEqualString(user, username) || !safeEqualString(pass, password)) {
            res.set('WWW-Authenticate', `Basic realm="${realm}"`);
            res.status(401).send('Invalid credentials');
            return;
        }

        next();
    };
};
