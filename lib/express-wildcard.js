import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** Express major from the installed package (4 vs 5+). */
export const expressMajor = Number(
    String(require('express/package.json').version || '4').split('.')[0],
) || 4;

/**
 * Express 5 / path-to-regexp require named wildcards (`*path`).
 * Express 4 still uses bare `*` → `req.params[0]`.
 */
export const EXPRESS_WILDCARD_SEGMENT = expressMajor >= 5 ? '*path' : '*';

/** `/api/foo` + wildcard → `/api/foo/*` or `/api/foo/*path`. */
export const withWildcard = (base) => (
    `${String(base || '').replace(/\/+$/, '')}/${EXPRESS_WILDCARD_SEGMENT}`
);

/**
 * Read a splat param from Express 4 (`params[0]` string) or
 * Express 5 (`params.path` string | string[]).
 */
export const readWildcardPath = (req) => {
    const raw = req?.params?.path ?? req?.params?.[0] ?? '';
    if (Array.isArray(raw)) {
        return raw.map((part) => String(part || '')).filter(Boolean).join('/');
    }
    return String(raw || '').replace(/^\/+/, '');
};
