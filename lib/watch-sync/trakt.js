const TRAKT_API = 'https://api.trakt.tv';
const WRITE_GAP_MS = 1100;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const describePayload = (payload, statusText) => {
    if (!payload || typeof payload !== 'object') return statusText || 'request failed';
    const direct = payload.error_description || payload.error || payload.message || '';
    const extras = [];
    if (Array.isArray(payload.errors)) {
        for (const item of payload.errors) {
            if (!item || typeof item !== 'object') continue;
            const line = [item.field || item.param || '', item.message || item.error || ''].filter(Boolean).join(' ');
            if (line) extras.push(line);
        }
    }
    if (!direct && !extras.length) {
        for (const [key, value] of Object.entries(payload)) {
            if (key === 'raw') extras.push(String(value).replace(/\s+/g, ' ').slice(0, 180));
            else if (typeof value === 'string') extras.push(`${key}: ${value}`);
            else if (Array.isArray(value) && value.every((part) => typeof part === 'string')) extras.push(`${key}: ${value.join(', ')}`);
        }
    }
    return [direct, ...extras].filter(Boolean).join('; ') || statusText || 'request failed';
};

const limitWaitMs = (response, retries, retryDelay) => {
    if (typeof retryDelay === 'function') return retryDelay(response, retries);
    const headerWait = Number(response.headers.get('retry-after'));
    if (Number.isFinite(headerWait) && headerWait > 0) return Math.min(headerWait, 120) * 1000;
    return Math.min(60_000, 5000 * (2 ** retries));
};

export const createTraktClient = ({ fetchImpl = fetch, log, minWriteGapMs = WRITE_GAP_MS, retryDelay } = {}) => {
    let writeQueue = Promise.resolve();
    let lastWriteAt = 0;
    const headersFor = (config, extra = {}) => ({
        'Content-Type': 'application/json',
        'trakt-api-version': '2',
        'trakt-api-key': config.clientId,
        'User-Agent': 'StreamPilot-WatchSync',
        ...(config.accessToken ? { Authorization: `Bearer ${config.accessToken}` } : {}),
        ...extra,
    });

    const perform = async (config, path, { method = 'GET', body, allowStatuses = [], retries = 0 } = {}) => {
        const write = method !== 'GET' && method !== 'HEAD';
        if (write && minWriteGapMs > 0) {
            const wait = lastWriteAt + minWriteGapMs - Date.now();
            if (wait > 0) await sleep(wait);
            lastWriteAt = Date.now();
        }
        const url = path.startsWith('http') ? path : `${TRAKT_API}${path}`;
        let response;
        try {
            response = await fetchImpl(url, {
                method,
                headers: headersFor(config),
                body: body == null ? undefined : JSON.stringify(body),
            });
        } catch (error) {
            throw new Error(`Trakt request failed: ${error.message}`);
        }
        const text = await response.text();
        const limited = response.status === 420 || response.status === 429;
        if (limited && retries < 6 && !allowStatuses.includes(response.status)) {
            const waitMs = limitWaitMs(response, retries, retryDelay);
            if (typeof log === 'function') {
                log(`Trakt is limiting writes (${response.status}). Pausing ${Math.ceil(waitMs / 1000)}s, then retrying.`);
            }
            await sleep(waitMs);
            return perform(config, path, { method, body, allowStatuses, retries: retries + 1 });
        }
        let payload = null;
        if (text) {
            try { payload = JSON.parse(text); } catch { payload = { raw: text }; }
        }
        if (!response.ok && !allowStatuses.includes(response.status)) {
            const detail = describePayload(payload, response.statusText);
            const message = response.status === 420
                ? 'Trakt is limiting this sync (420). Wait a few minutes and run it again. Watches already sent are kept.'
                : `Trakt ${response.status}: ${detail}`;
            const error = new Error(message);
            error.status = response.status;
            error.payload = payload;
            throw error;
        }
        return { status: response.status, payload, headers: response.headers };
    };

    const request = (config, path, options = {}) => {
        const method = options.method || 'GET';
        if (method === 'GET' || method === 'HEAD') return perform(config, path, options);
        const run = writeQueue.then(() => perform(config, path, options));
        writeQueue = run.then(() => {}, () => {});
        return run;
    };

    const refreshIfNeeded = async (config, saveConfig, { force = false } = {}) => {
        if (!config.refreshToken || !config.clientId || !config.clientSecret) return config;
        const expires = Date.parse(config.tokenExpiresAt || '');
        const knownExpiry = Number.isFinite(expires);
        if (!force && knownExpiry && expires - Date.now() > 5 * 60 * 1000) return config;
        if (!force && !knownExpiry) return config;
        try {
            const { payload } = await request(config, '/oauth/token', {
                method: 'POST',
                body: {
                    refresh_token: config.refreshToken,
                    client_id: config.clientId,
                    client_secret: config.clientSecret,
                    redirect_uri: 'urn:ietf:wg:oauth:2.0:oob',
                    grant_type: 'refresh_token',
                },
            });
            const next = {
                ...config,
                accessToken: payload.access_token || config.accessToken,
                refreshToken: payload.refresh_token || config.refreshToken,
                tokenExpiresAt: new Date(Date.now() + (Number(payload.expires_in) || 7776000) * 1000).toISOString(),
            };
            if (typeof saveConfig === 'function') await saveConfig(next);
            return next;
        } catch (error) {
            const stillUsable = config.accessToken && (!knownExpiry || expires > Date.now());
            if (!force && stillUsable && [400, 401, 422].includes(error.status)) {
                if (typeof log === 'function') {
                    log(`Trakt token refresh failed (${error.status}). Using the current login.`);
                }
                return config;
            }
            if ([400, 401, 422].includes(error.status)) {
                const expired = new Error('Trakt login expired. Disconnect and connect Trakt again.');
                expired.status = error.status;
                throw expired;
            }
            throw error;
        }
    };

    const paged = async (config, path) => {
        const items = [];
        let page = 1;
        let pages = 1;
        while (page <= pages && page <= 50) {
            const { payload, headers } = await request(config, `${path}${path.includes('?') ? '&' : '?'}page=${page}&limit=1000`);
            const batch = Array.isArray(payload) ? payload : [];
            items.push(...batch);
            pages = Number(headers.get('x-pagination-page-count')) || 1;
            if (!batch.length) break;
            page += 1;
        }
        return items;
    };

    return {
        request,
        refreshIfNeeded,
        async startDevice(config) {
            if (!config.clientId) throw new Error('Trakt client ID is required.');
            const { payload } = await request(config, '/oauth/device/code', {
                method: 'POST',
                body: { client_id: config.clientId },
            });
            return {
                deviceCode: payload.device_code,
                userCode: payload.user_code,
                verificationUrl: payload.verification_url || 'https://trakt.tv/activate',
                expiresIn: payload.expires_in || 600,
                interval: payload.interval || 5,
            };
        },
        async pollDevice(config, deviceCode) {
            try {
                const { payload, status } = await request(config, '/oauth/device/token', {
                    method: 'POST',
                    body: {
                        code: deviceCode,
                        client_id: config.clientId,
                        client_secret: config.clientSecret,
                    },
                    allowStatuses: [400, 404, 409, 410, 418, 429],
                });
                if (status !== 200) {
                    return { pending: true, error: payload?.error || 'authorization_pending' };
                }
                return {
                    pending: false,
                    accessToken: payload.access_token,
                    refreshToken: payload.refresh_token,
                    expiresIn: payload.expires_in,
                };
            } catch (error) {
                if (error.status === 400 || error.status === 404 || error.status === 409) {
                    return { pending: true, error: error.payload?.error || 'authorization_pending' };
                }
                throw error;
            }
        },
        async settings(config) {
            const { payload } = await request(config, '/users/settings');
            return payload?.user?.username || payload?.user?.ids?.slug || '';
        },
        watchedMovies: (config) => paged(config, '/sync/watched/movies'),
        watchedShows: (config) => paged(config, '/sync/watched/shows'),
        ratingsMovies: (config) => paged(config, '/sync/ratings/movies'),
        ratingsEpisodes: (config) => paged(config, '/sync/ratings/episodes'),
        collectionMovies: (config) => paged(config, '/sync/collection/movies'),
        collectionShows: (config) => paged(config, '/sync/collection/shows'),
        watchlistMovies: (config) => paged(config, '/sync/watchlist/movies'),
        watchlistShows: (config) => paged(config, '/sync/watchlist/shows'),
        async addHistory(config, body) {
            return request(config, '/sync/history', { method: 'POST', body });
        },
        async addRatings(config, body) {
            return request(config, '/sync/ratings', { method: 'POST', body });
        },
        async addCollection(config, body) {
            return request(config, '/sync/collection', { method: 'POST', body });
        },
        async addWatchlist(config, body) {
            return request(config, '/sync/watchlist', { method: 'POST', body });
        },
        async scrobble(config, action, body) {
            const path = action === 'pause'
                ? '/scrobble/pause'
                : action === 'stop'
                    ? '/scrobble/stop'
                    : '/scrobble/start';
            return request(config, path, { method: 'POST', body, allowStatuses: [409] });
        },
        log,
    };
};
