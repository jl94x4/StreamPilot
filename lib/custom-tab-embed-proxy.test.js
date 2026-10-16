import assert from 'node:assert/strict';
import { PassThrough, Readable } from 'node:stream';
import {
    applyEmbedProxyFrameHeaders,
    buildCustomTabTargetUrl,
    isBlockedEmbedMetadataHost,
    createEmbedProxyFetch,
    createEmbedProxyHandler,
    drainUpstreamBody,
    filterUpstreamCookieHeader,
    injectEmbedProxyShim,
    isPortalEmbedProxyPath,
    readUpstreamBodyWithLimit,
    rewriteLocationHeader,
    rewriteProxiedBody,
    rewriteRootRelativeUrls,
    serializeEmbedProxyRequestBody,
    rewriteDynamicImports,
    rewriteWebpackPublicPath,
    isLeakedArrEmbedAssetPath,
    parseEmbedProxyFromReferer,
    pipeUpstreamBody,
    resolveEmbedProxyPublicPrefix,
    resolvePathMountedArrEmbedUpstreamUrl,
    resolvePathMountedArrEmbedUpstream,
    resolveUpstreamMountSegment,
    parsePathMountedArrMountSegment,
    buildPathMountedArrTargetUrls,
    isArrEmbedUpstreamFailure,
    EMBED_PROXY_MAX_REWRITE_BYTES,
} from './custom-tab-embed-proxy.js';

assert.equal(
    buildCustomTabTargetUrl('http://192.168.1.6:8888/photos', '', ''),
    'http://192.168.1.6:8888/photos',
);
assert.equal(
    buildCustomTabTargetUrl('https://sonarr.strymx.co.uk/', 'api/v3/system/status', ''),
    'https://sonarr.strymx.co.uk/api/v3/system/status',
);
assert.equal(
    buildCustomTabTargetUrl('http://192.168.1.6:8888/photos/', 'cover.jpg', ''),
    'http://192.168.1.6:8888/photos/cover.jpg',
);
assert.throws(() => buildCustomTabTargetUrl('http://192.168.1.6:8888/photos/', '../latest/meta-data', ''));
assert.equal(isBlockedEmbedMetadataHost('169.254.169.254'), true);
assert.equal(isBlockedEmbedMetadataHost('metadata.google.internal'), true);
assert.equal(isBlockedEmbedMetadataHost('192.168.1.10'), false);

const proxy = 'https://portal.strymx.co.uk/api/custom-tab-embed/abc';
assert.equal(
    rewriteLocationHeader('/login', 'https://sonarr.strymx.co.uk/', proxy),
    'https://portal.strymx.co.uk/api/custom-tab-embed/abc/login',
);
assert.equal(
    rewriteLocationHeader('http://portal.strymx.co.uk/', 'https://portal.strymx.co.uk/radarr', proxy),
    'https://portal.strymx.co.uk/api/custom-tab-embed/abc/',
);
assert.equal(
    rewriteLocationHeader(
        'http://portal.strymx.co.uk/radarr/login?returnUrl=/radarr/',
        'https://portal.strymx.co.uk/radarr',
        proxy,
    ),
    'https://portal.strymx.co.uk/api/custom-tab-embed/abc/login?returnUrl=/radarr/',
);
assert.equal(
    rewriteLocationHeader(
        'http://192.168.1.22:7878/radarr/login',
        'https://portal.strymx.co.uk/radarr',
        proxy,
        'http://192.168.1.22:7878/radarr',
    ),
    'https://portal.strymx.co.uk/api/custom-tab-embed/abc/login',
);

assert.equal(
    resolvePathMountedArrEmbedUpstreamUrl(
        'https://portal.strymx.co.uk/radarr',
        'https://portal.strymx.co.uk',
        [{ type: 'radarr', enabled: true, url: 'http://192.168.1.22:7878' }],
    ),
    'http://192.168.1.22:7878',
);
assert.equal(
    resolvePathMountedArrEmbedUpstreamUrl(
        'https://portal.strymx.co.uk/radarr',
        'https://portal.strymx.co.uk',
        [{ type: 'radarr', enabled: true, url: 'http://192.168.1.22:7878/radarr' }],
    ),
    'http://192.168.1.22:7878/radarr',
);
assert.equal(
    resolvePathMountedArrEmbedUpstreamUrl(
        'https://portal.strymx.co.uk/radarr4k',
        'https://portal.strymx.co.uk',
        [
            { type: 'radarr', enabled: true, is4k: false, url: 'http://192.168.1.22:7878' },
            { type: 'radarr', enabled: true, is4k: true, url: 'http://192.168.1.22:7979' },
        ],
    ),
    'http://192.168.1.22:7979',
);
assert.equal(
    resolvePathMountedArrEmbedUpstreamUrl(
        'https://portal.strymx.co.uk/radarr4k',
        'https://portal.strymx.co.uk',
        [{ type: 'radarr', enabled: true, is4k: true, url: 'http://192.168.1.22:7979/radarr4k' }],
    ),
    'http://192.168.1.22:7979/radarr4k',
);
assert.equal(
    buildCustomTabTargetUrl(
        'http://192.168.1.22:7979',
        'radarr4k/index-8c868bd.js',
        '',
        { stripMountPrefix: 'radarr4k' },
    ),
    'http://192.168.1.22:7979/index-8c868bd.js',
);

const radarrHdTargets = buildPathMountedArrTargetUrls(
    'http://192.168.1.22:7878',
    'radarr',
    'radarr/Content/styles.css',
    '',
);
assert.equal(radarrHdTargets[0], 'http://192.168.1.22:7878/radarr/Content/styles.css');
assert.ok(radarrHdTargets.includes('http://192.168.1.22:7878/Content/styles.css'));

const radarr4kTargets = buildPathMountedArrTargetUrls(
    'http://192.168.1.22:7979',
    'radarr4k',
    'radarr4k/index-8c868bd.js',
    '',
    {
        publicTabUrl: 'https://portal.strymx.co.uk/radarr4k',
        upstreamMountSegment: 'radarr4k',
    },
);
assert.equal(radarr4kTargets[0], 'http://192.168.1.22:7979/radarr4k/index-8c868bd.js');
assert.ok(radarr4kTargets.includes('http://192.168.1.22:7979/index-8c868bd.js'));
assert.ok(radarr4kTargets.includes('https://portal.strymx.co.uk/radarr4k/index-8c868bd.js'));

assert.equal(isArrEmbedUpstreamFailure(404, 'text/html'), true);
assert.equal(isArrEmbedUpstreamFailure(200, 'application/problem+json'), true);
assert.equal(isArrEmbedUpstreamFailure(200, 'text/html'), false);
assert.equal(isArrEmbedUpstreamFailure(302, 'text/html', '/login?returnUrl=%2Fradarr4k'), true);
assert.equal(isArrEmbedUpstreamFailure(401, 'application/problem+json'), true);

assert.equal(resolveUpstreamMountSegment('radarr4k', 'http://192.168.1.22:7979'), 'radarr4k');
assert.equal(resolveUpstreamMountSegment('radarr4k', 'http://192.168.1.22:7979/radarr4k'), 'radarr4k');
assert.equal(resolveUpstreamMountSegment('radarr', 'http://192.168.1.22:7878'), 'radarr');
assert.equal(resolveUpstreamMountSegment('radarr', 'http://192.168.1.22:7878/radarr'), 'radarr');

const radarr4kPathIntegrationTargets = buildPathMountedArrTargetUrls(
    'http://192.168.1.22:7979/radarr4k',
    'radarr4k',
    'radarr4k/Content/styles.css',
    '',
    { upstreamMountSegment: 'radarr4k' },
);
assert.equal(radarr4kPathIntegrationTargets[0], 'http://192.168.1.22:7979/radarr4k/Content/styles.css');
assert.ok(radarr4kPathIntegrationTargets.includes('http://192.168.1.22:7979/Content/styles.css'));

const userRadarr4kCtx = resolvePathMountedArrEmbedUpstream(
    'https://portal.strymx.co.uk/radarr4k',
    'https://portal.strymx.co.uk',
    [
        { type: 'radarr', enabled: true, is4k: false, url: 'http://192.168.1.22:7878' },
        { type: 'radarr', enabled: true, is4k: true, url: 'http://192.168.1.22:7979' },
    ],
);
assert.equal(userRadarr4kCtx?.upstreamUrl, 'http://192.168.1.22:7979');
assert.equal(userRadarr4kCtx?.upstreamMountSegment, 'radarr4k');

assert.equal(
    resolvePathMountedArrEmbedUpstreamUrl(
        'https://portal.strymx.co.uk/radarr4k',
        'https://portal.strymx.co.uk',
        [{ type: 'radarr4k', enabled: true, url: 'http://192.168.1.22:7979' }],
    ),
    'http://192.168.1.22:7979',
);

assert.equal(parsePathMountedArrMountSegment('https://portal.strymx.co.uk/radarr4k'), 'radarr4k');
assert.equal(parsePathMountedArrMountSegment('https://portal.strymx.co.uk/radarr4k/settings'), null);
assert.equal(
    resolvePathMountedArrEmbedUpstreamUrl(
        'https://portal.strymx.co.uk/radarr',
        'https://portal.strymx.co.uk',
        [
            { type: 'radarr', enabled: true, is4k: true, url: 'http://192.168.1.22:7979' },
            { type: 'radarr', enabled: true, is4k: false, url: 'http://192.168.1.22:7878' },
        ],
    ),
    'http://192.168.1.22:7878',
);
assert.equal(
    resolvePathMountedArrEmbedUpstreamUrl(
        'https://portal.strymx.co.uk/radarr',
        'https://portal.strymx.co.uk',
        [{ type: 'radarr', enabled: true, url: 'https://portal.strymx.co.uk/radarr' }],
    ),
    null,
);
assert.equal(
    buildCustomTabTargetUrl(
        'http://192.168.1.22:7878',
        'radarr/Content/styles.css',
        '',
        { stripMountPrefix: 'radarr' },
    ),
    'http://192.168.1.22:7878/Content/styles.css',
);
assert.equal(
    resolvePathMountedArrEmbedUpstreamUrl(
        'https://portal.strymx.co.uk/radarr',
        'https://portal.strymx.co.uk',
        [],
    ),
    null,
);

const html = '<script src="https://sonarr.strymx.co.uk/Content/app.js"></script>';
assert.equal(
    rewriteProxiedBody(html, 'text/html', 'https://sonarr.strymx.co.uk/', proxy),
    `<script src="${proxy}/Content/app.js"></script>`,
);

assert.equal(
    rewriteRootRelativeUrls('<script src="/Content/app.js"></script>', proxy),
    `<script src="${proxy}/Content/app.js"></script>`,
);

const page = rewriteProxiedBody(
    '<!doctype html><html><head></head><body><script src="/Content/app.js"></script></body></html>',
    'text/html',
    'https://tv.strymx.co.uk/',
    proxy,
);
assert.match(page, new RegExp(`src="${proxy}/Content/app.js"`));
assert.match(page, /data-portal-embed-shim="1"/);
assert.match(page, /color-scheme:light dark/);
assert.match(page, /<base href="https:\/\/portal\.strymx\.co\.uk\/api\/custom-tab-embed\/abc\/">/);
assert.match(injectEmbedProxyShim('<html><head></head></html>', proxy), /history\.pushState/);
assert.match(injectEmbedProxyShim('<html><head></head></html>', proxy), /HTMLScriptElement/);

const spa = rewriteProxiedBody(
    '<!doctype html><html><head><base href="/"></head><body><script>window.Sonarr={urlBase:""}</script></body></html>',
    'text/html',
    'https://tv.strymx.co.uk/',
    proxy,
);
assert.doesNotMatch(spa, /<base href="\/">/i);
assert.match(spa, /urlBase:"\/api\/custom-tab-embed\/abc"/);
assert.match(spa, /<base href="https:\/\/portal\.strymx\.co\.uk\/api\/custom-tab-embed\/abc\/">/);

assert.equal(filterUpstreamCookieHeader('session=portal-jwt; arrAuth=sonarr'), 'arrAuth=sonarr');
assert.equal(filterUpstreamCookieHeader('session=portal-jwt'), '');

assert.equal(isPortalEmbedProxyPath('/api/custom-tab-embed/abc/'), true);
assert.equal(isPortalEmbedProxyPath('/api/home-module-embed/xyz/foo'), true);
assert.equal(isPortalEmbedProxyPath('/api/config'), false);
assert.equal(isPortalEmbedProxyPath('/portal'), false);

const framed = { headers: {} };
applyEmbedProxyFrameHeaders({
    setHeader(key, value) {
        framed.headers[String(key).toLowerCase()] = value;
    },
});
assert.equal(framed.headers['x-frame-options'], 'SAMEORIGIN');
assert.match(framed.headers['content-security-policy'], /frame-ancestors 'self'/);

assert.equal(
    resolveEmbedProxyPublicPrefix(
        { get: () => 'portal.strymx.co.uk', protocol: 'http', headers: {} },
        '/api/custom-tab-embed/abc',
        { requestIsHttps: () => true },
    ),
    'https://portal.strymx.co.uk/api/custom-tab-embed/abc',
);
assert.equal(
    resolveEmbedProxyPublicPrefix(
        { get: () => 'portal.strymx.co.uk', protocol: 'http', headers: { 'x-forwarded-proto': 'https' } },
        '/api/custom-tab-embed/abc',
    ),
    'https://portal.strymx.co.uk/api/custom-tab-embed/abc',
);

const mockRes = () => {
    const chunks = [];
    const res = {
        statusCode: 200,
        headers: {},
        body: null,
        headersSent: false,
        setHeader(key, value) {
            this.headers[String(key).toLowerCase()] = value;
        },
        append(key, value) {
            const name = String(key).toLowerCase();
            const current = this.headers[name];
            this.headers[name] = current == null ? value : [].concat(current, value);
        },
        status(code) {
            this.statusCode = code;
            this.headersSent = true;
            return this;
        },
        send(body) {
            this.body = body;
            this.headersSent = true;
            return this;
        },
        write(chunk) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            this.headersSent = true;
            return true;
        },
        end(chunk) {
            if (chunk != null) {
                chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            }
            if (chunks.length) {
                this.body = Buffer.concat(chunks);
            }
            this.headersSent = true;
            if (typeof this._onFinish === 'function') {
                this._onFinish();
            }
            return this;
        },
        once() {
            return this;
        },
        removeListener() {
            return this;
        },
    };
    return res;
};

const handler = createEmbedProxyHandler({
    loadConfig: async () => ({}),
    resolveEmbedTarget: async () => ({ sourceUrl: 'https://tv.strymx.co.uk/' }),
    proxyRouteName: 'custom-tab-embed',
    withBasePath: (route) => route,
    fetchWithTimeout: async () => ({
        status: 200,
        headers: {
            get: (key) => (String(key).toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : null),
            forEach: (cb) => cb('text/html; charset=utf-8', 'content-type'),
            getSetCookie: () => [],
        },
        arrayBuffer: async () => Buffer.from('<!doctype html><html><head></head><body>sonarr-ok</body></html>'),
    }),
});

const req = {
    params: { tabId: 'abc' },
    url: '/',
    method: 'GET',
    protocol: 'https',
    headers: {},
    get: () => 'portal.strymx.co.uk',
};
const res = mockRes();
await handler(req, res);
assert.equal(res.statusCode, 200);
assert.equal(res.headers['x-frame-options'], 'SAMEORIGIN');
assert.match(String(res.body), /sonarr-ok/);
assert.match(String(res.body), /data-portal-embed-shim="1"/);

const binaryHandler = createEmbedProxyHandler({
    loadConfig: async () => ({}),
    resolveEmbedTarget: async () => ({ sourceUrl: 'https://tv.strymx.co.uk/' }),
    proxyRouteName: 'custom-tab-embed',
    withBasePath: (route) => route,
    fetchWithTimeout: async () => ({
        status: 200,
        headers: {
            get: (key) => (String(key).toLowerCase() === 'content-type' ? 'image/png' : null),
            forEach: (cb) => cb('image/png', 'content-type'),
            getSetCookie: () => [],
        },
        arrayBuffer: async () => Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    }),
});
const binaryRes = mockRes();
await binaryHandler({ ...req, params: { tabId: 'abc', 0: 'logo.png' } }, binaryRes);
assert.ok(Buffer.isBuffer(binaryRes.body));
assert.deepEqual([...binaryRes.body], [0x89, 0x50, 0x4e, 0x47]);

const streamChunks = [];
const streamOut = new PassThrough();
streamOut.setHeader = () => streamOut;
streamOut.once = (event, listener) => {
    if (event === 'close') streamOut.on('close', listener);
    return streamOut;
};
streamOut.removeListener = () => streamOut;
streamOut.on('data', (chunk) => streamChunks.push(chunk));
const streamDone = new Promise((resolve) => streamOut.on('end', resolve));
pipeUpstreamBody({ body: Readable.from([Buffer.from('stream-ok')]) }, streamOut);
await streamDone;
assert.equal(Buffer.concat(streamChunks).toString('utf8'), 'stream-ok');

assert.equal(
    serializeEmbedProxyRequestBody({
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: { username: 'admin', password: 'p@ss word', rememberMe: 'on' },
    }),
    'username=admin&password=p%40ss+word&rememberMe=on',
);
assert.equal(
    serializeEmbedProxyRequestBody({
        headers: { 'content-type': 'application/json' },
        body: { username: 'admin', password: 'secret' },
    }),
    '{"username":"admin","password":"secret"}',
);

let capturedLogin = null;
const loginHandler = createEmbedProxyHandler({
    loadConfig: async () => ({}),
    resolveEmbedTarget: async () => ({ sourceUrl: 'https://tv.strymx.co.uk/' }),
    proxyRouteName: 'custom-tab-embed',
    withBasePath: (route) => route,
    fetchWithTimeout: async (url, init) => {
        capturedLogin = { url, init };
        return {
            status: 200,
            headers: {
                get: (key) => (String(key).toLowerCase() === 'content-type' ? 'text/html' : null),
                forEach: (cb) => cb('text/html', 'content-type'),
                getSetCookie: () => [],
            },
            arrayBuffer: async () => Buffer.from('<html>login-ok</html>'),
        };
    },
});
const loginRes = mockRes();
await loginHandler({
    ...req,
    method: 'POST',
    url: '/login',
    params: { tabId: 'abc', 0: 'login' },
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'content-length': '99' },
    body: { username: 'admin', password: 'secret', rememberMe: 'on' },
}, loginRes);
assert.equal(capturedLogin.url, 'https://tv.strymx.co.uk/login');
assert.equal(capturedLogin.init.body, 'username=admin&password=secret&rememberMe=on');
assert.match(String(capturedLogin.init.headers['content-type']), /urlencoded/);
assert.equal(capturedLogin.init.headers['content-length'], undefined);

const redirectRes = mockRes();
const redirectHandler = createEmbedProxyHandler({
    loadConfig: async () => ({}),
    resolveEmbedTarget: async () => ({ sourceUrl: 'https://tv.strymx.co.uk/' }),
    proxyRouteName: 'custom-tab-embed',
    withBasePath: (route) => route,
    fetchWithTimeout: async () => ({
        status: 302,
        headers: {
            get: (key) => {
                const name = String(key).toLowerCase();
                if (name === 'location') return '/';
                if (name === 'set-cookie') return 'arrAuth=token; Path=/; HttpOnly';
                return null;
            },
            forEach: (cb) => {
                cb('/', 'location');
                cb('arrAuth=token; Path=/; HttpOnly', 'set-cookie');
            },
            getSetCookie: () => ['arrAuth=token; Path=/; HttpOnly'],
        },
        arrayBuffer: async () => Buffer.from(''),
    }),
});
await redirectHandler({
    ...req,
    method: 'POST',
    url: '/login',
    params: { tabId: 'abc', 0: 'login' },
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: { username: 'admin', password: 'secret' },
}, redirectRes);
assert.equal(redirectRes.statusCode, 302);
assert.equal(redirectRes.headers.location, 'https://portal.strymx.co.uk/api/custom-tab-embed/abc/');
assert.match(String(redirectRes.headers['set-cookie']), /arrAuth=token/);
assert.match(String(redirectRes.headers['set-cookie']), /Path=\/api\/custom-tab-embed\/abc/);

assert.equal(
    rewriteWebpackPublicPath('__webpack_require__.p="/"', '/api/custom-tab-embed/abc'),
    '__webpack_require__.p="/api/custom-tab-embed/abc/"',
);
assert.equal(
    rewriteProxiedBody('__webpack_require__.p="/"', 'application/javascript', 'https://tv.strymx.co.uk/', proxy),
    '__webpack_require__.p="/api/custom-tab-embed/abc/"',
);
assert.equal(isLeakedArrEmbedAssetPath('/Content/928-e38ae6d.css'), true);
assert.equal(isLeakedArrEmbedAssetPath('/api/v3/localization/language'), true);
assert.equal(isLeakedArrEmbedAssetPath('/api/v1/indexer'), true);
assert.equal(isLeakedArrEmbedAssetPath('/login'), false);
assert.equal(isLeakedArrEmbedAssetPath('/api/config'), false);
assert.equal(isLeakedArrEmbedAssetPath('/_app/immutable/entry/start.js'), true);
assert.equal(isLeakedArrEmbedAssetPath('/api/server/ping'), true);
assert.equal(isLeakedArrEmbedAssetPath('/service-worker.js'), true);

assert.equal(
    rewriteDynamicImports(
        'import("/_app/immutable/entry/start.js"), import("/_app/immutable/entry/app.js")',
        proxy,
    ),
    `import("${proxy}/_app/immutable/entry/start.js"), import("${proxy}/_app/immutable/entry/app.js")`,
);

const immichHtml = rewriteProxiedBody(
    '<html><head></head><body><script>import("/_app/immutable/entry/start.js")</script></body></html>',
    'text/html',
    'http://192.168.1.6:8888/',
    proxy,
);
assert.match(immichHtml, new RegExp(`import\\("${proxy}/_app/immutable/entry/start.js"`));

const brokenJs = 'const re=/https://tv.strymx.co.uk/;try{fetch(re)}catch(e){}';
assert.equal(
    rewriteProxiedBody(brokenJs, 'application/javascript', 'https://tv.strymx.co.uk/', proxy),
    brokenJs,
);
assert.deepEqual(
    parseEmbedProxyFromReferer('https://portal.strymx.co.uk/api/custom-tab-embed/abc/'),
    { routeName: 'custom-tab-embed', entityId: 'abc' },
);
assert.match(injectEmbedProxyShim('<html><head></head></html>', proxy), /MutationObserver/);

await drainUpstreamBody({
    body: {
        destroy() {
            this.destroyed = true;
        },
    },
});

const boundedFetch = createEmbedProxyFetch(async (url, init) => ({ url, init }), { maxSockets: 16 });
const bounded = await boundedFetch('https://example.com/foo', {}, 5000);
assert.ok(bounded.init.agent);
assert.equal(bounded.init.agent.maxSockets, 16);

const tinyBody = await readUpstreamBodyWithLimit({
    body: Readable.from([Buffer.from('abc')]),
}, 10);
assert.equal(tinyBody.toString('utf8'), 'abc');

await assert.rejects(
    () => readUpstreamBodyWithLimit({
        body: Readable.from([Buffer.from('0123456789')]),
    }, 5),
    (error) => error?.code === 'EMBED_PROXY_BODY_TOO_LARGE',
);

assert.equal(EMBED_PROXY_MAX_REWRITE_BYTES, 8 * 1024 * 1024);

console.log('custom tab embed proxy ok');
