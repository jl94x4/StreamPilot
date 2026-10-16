import http from 'http';
import https from 'https';
import dns from 'node:dns/promises';
import net from 'node:net';
import { Readable } from 'node:stream';
import { readWildcardPath } from './express-wildcard.js';

const BLOCKED_RESPONSE_HEADERS = new Set([
    'x-frame-options',
    'content-security-policy',
    'content-security-policy-report-only',
    'transfer-encoding',
    'content-encoding',
    'connection',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailers',
    'upgrade',
]);

/** JSON.stringify + escape chars that can break out of inline <script> tags. */
const jsStringLiteral = (value) => {
    const charMap = {
        '<': '\\u003C',
        '>': '\\u003E',
        '/': '\\u002F',
        '\b': '\\b',
        '\f': '\\f',
        '\n': '\\n',
        '\r': '\\r',
        '\t': '\\t',
        '\0': '\\0',
        '\u2028': '\\u2028',
        '\u2029': '\\u2029',
    };
    return JSON.stringify(value).replace(/[<>/\b\f\n\r\t\0\u2028\u2029]/g, (ch) => charMap[ch] || ch);
};

const REQUEST_HEADER_ALLOW = new Set([
    'accept',
    'accept-language',
    'content-type',
    'content-length',
    'if-none-match',
    'if-modified-since',
    'range',
    'cache-control',
    'origin',
    'referer',
]);

const TEXTUAL_CONTENT_TYPES = [
    'text/html',
    'text/css',
    'application/javascript',
    'text/javascript',
    'application/json',
    'application/xml',
    'text/xml',
];

const PORTAL_COOKIE_NAMES = new Set(['session', 'plex_oauth_state']);

/** Skip in-memory HTML/JS/CSS rewrites above this size to avoid OOM on large bundles. */
export const EMBED_PROXY_MAX_REWRITE_BYTES = 8 * 1024 * 1024;

export const EMBED_PROXY_FRAME_CSP = "frame-ancestors 'self'; object-src 'none'";

export const isPortalEmbedProxyPath = (path) => (
    /\/api\/(custom-tab-embed|home-module-embed|spotify-to-plex-embed)(\/|$)/.test(String(path || '').split('?')[0])
);

export const isTextualContentType = (contentType) => {
    const ct = String(contentType || '').toLowerCase();
    return TEXTUAL_CONTENT_TYPES.some((type) => ct.includes(type));
};

export const filterUpstreamCookieHeader = (cookieHeader) => (
    String(cookieHeader || '')
        .split(';')
        .map((part) => part.trim())
        .filter((part) => {
            if (!part) return false;
            const name = part.split('=')[0].trim().toLowerCase();
            return name && !PORTAL_COOKIE_NAMES.has(name);
        })
        .join('; ')
);

const requestContentType = (req) => String(
    req?.headers?.['content-type'] || req?.headers?.['Content-Type'] || '',
).toLowerCase();

const appendFormValue = (params, key, value) => {
    if (value == null) return;
    if (Array.isArray(value)) {
        for (const item of value) appendFormValue(params, key, item);
        return;
    }
    if (typeof value === 'object') return;
    params.append(key, String(value));
};

/** Re-encode bodies Express already parsed so upstream apps still see a real form/JSON POST. */
export const serializeEmbedProxyRequestBody = (req) => {
    const body = req?.body;
    if (body == null) return undefined;
    if (Buffer.isBuffer(body) || typeof body === 'string') return body;
    if (typeof body !== 'object') return String(body);
    if (requestContentType(req).includes('application/x-www-form-urlencoded')) {
        const params = new URLSearchParams();
        for (const [key, value] of Object.entries(body)) {
            appendFormValue(params, key, value);
        }
        return params.toString();
    }
    return JSON.stringify(body);
};

export const applyEmbedProxyFrameHeaders = (res) => {
    if (!res || typeof res.setHeader !== 'function') return;
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Content-Security-Policy', EMBED_PROXY_FRAME_CSP);
};

/** HTTPS origin for rewritten embed URLs when the portal is served over TLS (incl. reverse proxies). */
export const resolveEmbedProxyPublicPrefix = (req, proxyPath, options = {}) => {
    const requestIsHttps = options.requestIsHttps;
    const host = String(req?.get?.('host') || '').trim();
    const path = String(proxyPath || '');
    if (!host) return path;
    const forwarded = String(req?.headers?.['x-forwarded-proto'] || '')
        .split(',')[0]
        .trim()
        .toLowerCase();
    const useHttps = typeof requestIsHttps === 'function'
        ? requestIsHttps(req)
        : !!(req?.secure || forwarded === 'https' || String(req?.protocol) === 'https');
    const protocol = useHttps ? 'https' : String(req?.protocol || 'http');
    return `${protocol}://${host}${path}`;
};

const proxyPathnameFromPrefix = (proxyPublicPrefix) => {
    try {
        const href = String(proxyPublicPrefix || '');
        const url = new URL(href.endsWith('/') ? href : `${href}/`);
        return url.pathname.replace(/\/+$/, '') || '/';
    } catch {
        return String(proxyPublicPrefix || '').replace(/^https?:\/\/[^/]+/i, '').replace(/\/+$/, '') || '/';
    }
};

export const rewriteRootRelativeUrls = (text, proxyPublicPrefix) => {
    const prefix = String(proxyPublicPrefix || '').replace(/\/$/, '');
    if (!prefix || !text) return text;
    return String(text)
        .replace(/(\s(?:href|src|action|poster|data-src)\s*=\s*)(["'])\/(?!\/)/gi, `$1$2${prefix}/`)
        .replace(/(\ssrcset\s*=\s*)(["'])([^"']*)/gi, (_, attr, quote, value) => (
            `${attr}${quote}${value.replace(/(^|[\s,])\/(?!\/)/g, `$1${prefix}/`)}`
        ))
        .replace(/url\(\s*(['"]?)\/(?!\/)/gi, `url($1${prefix}/`);
};

export const rewriteSpaUrlBase = (text, proxyPath) => {
    const path = String(proxyPath || '').replace(/\/+$/, '') || '/';
    return String(text || '')
        .replace(/(urlBase\s*:\s*)(["'])\2/g, `$1$2${path}$2`)
        .replace(/(urlBase\s*:\s*)(["'])\/\2/g, `$1$2${path}$2`)
        .replace(/(urlBase\s*:\s*)(["'])\/[^"']*\2/g, `$1$2${path}$2`);
};

export const rewriteWebpackPublicPath = (text, proxyPath) => {
    const pub = `${String(proxyPath || '').replace(/\/+$/, '')}/`;
    const escaped = pub.replace(/\$/g, '$$$$');
    return String(text || '')
        .replace(/__webpack_require__\.p\s*=\s*(["'])\/?\1/g, `__webpack_require__.p=$1${escaped}$1`)
        .replace(/__webpack_public_path__\s*=\s*(["'])\/?\1/g, `__webpack_public_path__=$1${escaped}$1`);
};

/** SvelteKit (Immich) bootstraps with dynamic import("/_app/...") which ignores <base href>. */
export const rewriteDynamicImports = (text, proxyPublicPrefix) => {
    const prefix = String(proxyPublicPrefix || '').replace(/\/$/, '');
    if (!prefix || !text) return text;
    return String(text)
        .replace(/import\s*\(\s*(["'])\/(?!\/)/g, `import($1${prefix}/`)
        .replace(/import\s*\(\s*`\//g, `import(\`${prefix}/`);
};

export const isLeakedArrEmbedAssetPath = (pathname) => {
    const p = String(pathname || '').split('?')[0];
    if (p === '/Content' || p.startsWith('/Content/')) return true;
    if (p === '/UI' || p.startsWith('/UI/')) return true;
    if (p === '/initialize.js') return true;
    if (/^\/[0-9]+-[a-z0-9]+\.(js|css)$/i.test(p)) return true;
    if (/^\/signalr(\/|$)/i.test(p)) return true;
    // *arr SPAs build API URLs as /api/v3/... on the iframe origin.
    if (p === '/api/v3' || p.startsWith('/api/v3/')) return true;
    if (p === '/api/v1' || p.startsWith('/api/v1/')) return true;
    // SvelteKit / Immich assets and bootstrap paths.
    if (p === '/_app' || p.startsWith('/_app/')) return true;
    if (p === '/service-worker.js') return true;
    if (p === '/favicon.ico' || /^\/favicon-\d+\.png$/i.test(p) || /^\/apple-icon-\d+\.png$/i.test(p)) return true;
    // Immich API namespaces (avoid portal /api/auth/plex, /api/config, etc.).
    if (p === '/api/server' || p.startsWith('/api/server/')) return true;
    if (p === '/api/assets' || p.startsWith('/api/assets/')) return true;
    if (p === '/api/albums' || p.startsWith('/api/albums/')) return true;
    if (p === '/api/timeline' || p.startsWith('/api/timeline/')) return true;
    if (p === '/api/search' || p.startsWith('/api/search/')) return true;
    if (p === '/api/jobs' || p.startsWith('/api/jobs/')) return true;
    if (p === '/api/socket' || p.startsWith('/api/socket/')) return true;
    if (p === '/api/sync' || p.startsWith('/api/sync/')) return true;
    if (p === '/api/oauth' || p.startsWith('/api/oauth/')) return true;
    if (p === '/api/map' || p.startsWith('/api/map/')) return true;
    if (p === '/api/tags' || p.startsWith('/api/tags/')) return true;
    if (p === '/api/people' || p.startsWith('/api/people/')) return true;
    if (p === '/api/shared-links' || p.startsWith('/api/shared-links/')) return true;
    if (p === '/api/download' || p.startsWith('/api/download/')) return true;
    if (p === '/api/server-info' || p.startsWith('/api/server-info/')) return true;
    return false;
};

export const parseEmbedProxyFromReferer = (referer) => {
    const match = String(referer || '').match(/\/api\/(custom-tab-embed|home-module-embed)\/([^/?#]+)/i);
    if (!match) return null;
    try {
        return { routeName: match[1], entityId: decodeURIComponent(match[2]) };
    } catch {
        return { routeName: match[1], entityId: match[2] };
    }
};

export const buildEmbedProxyShim = (proxyPath) => {
    const prefix = jsStringLiteral(String(proxyPath || '').replace(/\/+$/, '') || '/');
    return `<script data-portal-embed-shim="1">(function(){var p=${prefix};function r(u){if(u==null)return u;var s=String(u);if(!s||s===p||s.indexOf(p+'/')===0)return s;if(s.charAt(0)==='/'&&s.charAt(1)!=='/')return p+s;try{var x=new URL(s,location.href);if(x.origin===location.origin&&x.pathname!==p&&x.pathname.indexOf(p+'/')!==0){x.pathname=p+x.pathname;return x.href;}}catch(e){}return s;}function pin(o){if(o&&typeof o==='object')try{o.urlBase=p;}catch(e){}}function fix(el){if(!el||el.nodeType!==1||!el.getAttribute)return;['src','href'].forEach(function(a){var v=el.getAttribute(a);if(!v)return;var n=r(v);if(n!==v)el.setAttribute(a,n);});}['Sonarr','Radarr','Lidarr','Prowlarr','Whisparr','Readarr'].forEach(function(n){var c=window[n];try{Object.defineProperty(window,n,{configurable:true,enumerable:true,get:function(){return c;},set:function(v){c=v;pin(v);}});}catch(e){}pin(c);});try{var f=window.fetch;if(f){window.fetch=function(i,n){if(typeof i==='string')i=r(i);else if(i instanceof Request)i=new Request(r(i.url),i);return f.call(this,i,n);};}var o=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){arguments[1]=r(u);return o.apply(this,arguments);};if(window.WebSocket){var W=window.WebSocket;window.WebSocket=function(u,c){return c===undefined?new W(r(u)):new W(r(u),c);};window.WebSocket.prototype=W.prototype;window.WebSocket.CONNECTING=W.CONNECTING;window.WebSocket.OPEN=W.OPEN;window.WebSocket.CLOSING=W.CLOSING;window.WebSocket.CLOSED=W.CLOSED;}var hp=history.pushState.bind(history);history.pushState=function(s,t,u){if(u!=null)u=r(u);return hp(s,t,u);};var hr=history.replaceState.bind(history);history.replaceState=function(s,t,u){if(u!=null)u=r(u);return hr(s,t,u);}try{var la=location.assign.bind(location);location.assign=function(u){return la(r(u));};var lr=location.replace.bind(location);location.replace=function(u){return lr(r(u));};}catch(e){}var sa=Element.prototype.setAttribute;Element.prototype.setAttribute=function(n,v){if((n==='src'||n==='href')&&typeof v==='string')v=r(v);return sa.call(this,n,v);};function patch(proto,attr){var d=Object.getOwnPropertyDescriptor(proto,attr);if(!d||!d.set)return;Object.defineProperty(proto,attr,{configurable:true,enumerable:d.enumerable,get:d.get,set:function(v){d.set.call(this,r(v));}});}patch(HTMLScriptElement.prototype,'src');patch(HTMLLinkElement.prototype,'href');patch(HTMLImageElement.prototype,'src');if(window.MutationObserver){new MutationObserver(function(ms){ms.forEach(function(m){if(m.type==='attributes')fix(m.target);(m.addedNodes||[]).forEach(function(n){fix(n);if(n.querySelectorAll)n.querySelectorAll('link[href],script[src],img[src]').forEach(fix);});});}).observe(document.documentElement||document,{childList:true,subtree:true,attributes:true,attributeFilter:['src','href']});}}catch(e){}})();</script>`;
};

export const injectEmbedProxyShim = (html, proxyPublicPrefix) => {
    let text = String(html || '');
    if (!text || /data-portal-embed-shim=/i.test(text)) return text;
    if (!/<(!doctype|html|head)\b/i.test(text)) return text;
    const proxyPath = proxyPathnameFromPrefix(proxyPublicPrefix);
    text = text.replace(/<base\b[^>]*>/gi, '');
    text = rewriteSpaUrlBase(text, proxyPath);
    const shim = buildEmbedProxyShim(proxyPath);
    const baseHref = String(proxyPublicPrefix || '').endsWith('/')
        ? proxyPublicPrefix
        : `${proxyPublicPrefix}/`;
    const headBits = `<meta name="color-scheme" content="light dark"><style data-portal-embed-color-scheme="1">:root{color-scheme:light dark;}</style><base href="${baseHref}">${shim}`;
    if (/<head[^>]*>/i.test(text)) return text.replace(/<head[^>]*>/i, (match) => `${match}${headBits}`);
    if (/<html[^>]*>/i.test(text)) return text.replace(/<html[^>]*>/i, (match) => `${match}${headBits}`);
    return `${headBits}${text}`;
};

export const isBlockedEmbedMetadataHost = (hostname = '') => {
    const host = String(hostname || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
    if (!host) return true;
    if (
        host === 'metadata.google.internal'
        || host === 'metadata.goog'
        || host.endsWith('.metadata.google.internal')
        || host === 'kubernetes.default'
        || host === 'kubernetes.default.svc'
    ) return true;
    if (host === '169.254.169.254' || host === 'fd00:ec2::254') return true;
    if (net.isIPv4(host) && host.startsWith('169.254.')) return true;
    return false;
};

export const assertEmbedTargetNotMetadata = async (rawUrl) => {
    const parsed = new URL(String(rawUrl || '').trim());
    if (isBlockedEmbedMetadataHost(parsed.hostname)) {
        const error = new Error('Embed target is not allowed');
        error.status = 403;
        throw error;
    }
    if (net.isIP(parsed.hostname)) return;
    let addresses;
    try {
        addresses = await dns.lookup(parsed.hostname, { all: true, verbatim: true });
    } catch {
        return;
    }
    for (const entry of addresses || []) {
        const address = String(entry?.address || entry || '');
        if (isBlockedEmbedMetadataHost(address) || address.startsWith('169.254.')) {
            const error = new Error('Embed target is not allowed');
            error.status = 403;
            throw error;
        }
    }
};

export const buildCustomTabTargetUrl = (tabUrl, subPath = '', search = '', options = {}) => {
    const base = new URL(String(tabUrl || '').trim());
    let normalizedSub = String(subPath || '').replace(/^\/+/, '');
    const stripPrefix = String(options.stripMountPrefix || '').replace(/^\/+|\/+$/g, '');
    if (stripPrefix && (normalizedSub === stripPrefix || normalizedSub.startsWith(`${stripPrefix}/`))) {
        normalizedSub = normalizedSub.slice(stripPrefix.length).replace(/^\/+/, '');
    }
    if (/(^|[\\/])\.\.([\\/]|$)/.test(normalizedSub) || normalizedSub.includes('\\') || normalizedSub.includes('\0')) {
        throw new Error('Invalid embed path');
    }
    const applySearch = (url) => {
        if (search) url.search = String(search).replace(/^\?/, '');
        return url.href;
    };
    if (!normalizedSub) {
        return applySearch(new URL(tabUrl));
    }
    let dir = base.pathname || '/';
    if (!dir.endsWith('/')) dir = `${dir}/`;
    const target = dir === '/'
        ? new URL(`/${normalizedSub}`, base.origin)
        : new URL(normalizedSub, new URL(dir, base.origin));
    if (target.origin !== base.origin) {
        throw new Error('Invalid embed path');
    }
    if (dir !== '/' && !target.pathname.startsWith(dir) && `${target.pathname}/` !== dir) {
        throw new Error('Invalid embed path');
    }
    return applySearch(target);
};

export const rewriteLocationHeader = (location, tabUrl, proxyPublicPrefix, upstreamUrl = '') => {
    try {
        const publicBase = new URL(tabUrl);
        const resolveBase = upstreamUrl ? new URL(upstreamUrl) : publicBase;
        const resolved = new URL(location, resolveBase);
        const allowedHosts = new Set([
            publicBase.hostname.toLowerCase(),
            resolveBase.hostname.toLowerCase(),
        ]);
        if (!allowedHosts.has(resolved.hostname.toLowerCase())) return location;

        let pathname = resolved.pathname;
        // Map /radarr/login → /login when the public/upstream base is /radarr.
        for (const prefixUrl of [resolveBase, publicBase]) {
            const basePath = String(prefixUrl.pathname || '').replace(/\/+$/, '');
            if (basePath && (pathname === basePath || pathname.startsWith(`${basePath}/`))) {
                pathname = pathname.slice(basePath.length) || '/';
                break;
            }
        }

        const rel = `${pathname}${resolved.search}${resolved.hash}`;
        const proxyBase = proxyPublicPrefix.endsWith('/') ? proxyPublicPrefix : `${proxyPublicPrefix}/`;
        return new URL(rel.replace(/^\//, ''), proxyBase).href;
    } catch {
        return location;
    }
};

const PATH_MOUNTED_ARR_TYPES = new Set([
    'radarr', 'sonarr', 'lidarr', 'readarr', 'whisparr', 'prowlarr', 'bazarr',
]);

const isPrivateIntegrationHost = (hostname = '') => {
    const host = String(hostname || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
    if (!host) return false;
    return host === 'localhost'
        || host.endsWith('.local')
        || /^192\.168\./.test(host)
        || /^10\./.test(host)
        || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
        || host === '127.0.0.1';
};

/** Map portal path mounts (e.g. /radarr, /radarr4k) to internal LAN *arr URLs for proxy upstream fetches. */
export const parsePathMountedArrMountSegment = (tabUrl) => {
    try {
        const parsed = new URL(String(tabUrl || '').trim());
        const pathParts = parsed.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
        if (pathParts.length !== 1) return null;
        const mount = pathParts[0].toLowerCase();
        const baseType = mount.replace(/4k$/i, '');
        if (!PATH_MOUNTED_ARR_TYPES.has(mount) && !PATH_MOUNTED_ARR_TYPES.has(baseType)) return null;
        return pathParts[0];
    } catch {
        return null;
    }
};

const pickPathMountedArrInstance = (candidates, wants4k, arrType) => {
    if (!candidates.length) return null;
    const isEntry4k = (entry) => {
        const type = String(entry?.type || '').toLowerCase().replace(/-4k$/, '4k');
        return type === `${arrType}4k` || !!entry?.is4k;
    };
    const flagged = wants4k
        ? candidates.find((entry) => isEntry4k(entry))
        : candidates.find((entry) => !isEntry4k(entry));
    if (flagged) return flagged;
    if (candidates.length === 1) return candidates[0];
    return null;
};

/** Path segment from integration URL (Radarr Url Base on LAN), e.g. /radarr4k from http://host:7979/radarr4k */
export const extractIntegrationUrlBaseSegment = (integrationUrl) => {
    try {
        const parsed = new URL(String(integrationUrl || '').trim());
        const parts = parsed.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
        if (!parts.length) return '';
        return parts[parts.length - 1];
    } catch {
        return '';
    }
};

/** Map public tunnel mount to upstream Url Base path from integration URL when set. */
export const resolveUpstreamMountSegment = (publicMountSegment, integrationUrl) => {
    const publicMount = String(publicMountSegment || '').replace(/^\/+|\/+$/g, '');
    const fromIntegration = extractIntegrationUrlBaseSegment(integrationUrl);
    if (fromIntegration) return fromIntegration;
    return publicMount;
};

/** Retry the next candidate when upstream is missing or clearly not *arr content. */
export const isArrEmbedUpstreamFailure = (status, contentType = '', location = '') => {
    if (status === 404 || status === 401 || status === 403) return true;
    if (status >= 500) return true;
    if (status >= 300 && status < 400) {
        const loc = String(location || '').toLowerCase();
        if (loc.includes('login')) return true;
    }
    const ct = String(contentType || '').toLowerCase();
    if (ct.includes('application/problem+json')) return true;
    return false;
};

/**
 * Build candidate upstream URLs for path-mounted *arr embeds.
 * Covers root-only LAN ports, Url Base on LAN, and public tunnel paths.
 */
export const buildPathMountedArrTargetUrls = (
    sourceUrl,
    mountSegment,
    subPath = '',
    search = '',
    { publicTabUrl = '', upstreamMountSegment = '' } = {},
) => {
    const publicMount = String(mountSegment || '').replace(/^\/+|\/+$/g, '');
    const upstreamMount = String(upstreamMountSegment || publicMount).replace(/^\/+|\/+$/g, '');
    const urls = [];
    const add = (href) => {
        if (href && !urls.includes(href)) urls.push(href);
    };
    const strippedSubPath = String(subPath || '').replace(/^\/+/, '');
    const stripKnownMounts = (path) => {
        let next = String(path || '').replace(/^\/+/, '');
        for (const segment of [publicMount, upstreamMount]) {
            if (!segment) continue;
            if (next === segment || next.startsWith(`${segment}/`)) {
                next = next.slice(segment.length).replace(/^\/+/, '');
            }
        }
        return next;
    };
    const subHasPublicMount = publicMount && (strippedSubPath === publicMount || strippedSubPath.startsWith(`${publicMount}/`));
    const subWithoutPublicMount = subHasPublicMount
        ? strippedSubPath.slice(publicMount.length).replace(/^\/+/, '')
        : strippedSubPath;
    const assetSubPath = stripKnownMounts(strippedSubPath);

    const pushVariants = (baseUrl) => {
        if (!baseUrl) return;
        if (!publicMount) {
            add(buildCustomTabTargetUrl(baseUrl, subPath, search));
            return;
        }
        try {
            const parsed = new URL(String(baseUrl).trim());
            const basePath = parsed.pathname.replace(/\/+$/, '');
            const baseHasUpstreamMount = upstreamMount
                && (basePath.toLowerCase() === `/${upstreamMount.toLowerCase()}`
                    || basePath.toLowerCase().endsWith(`/${upstreamMount.toLowerCase()}`));
            const mountsDiffer = upstreamMount && upstreamMount.toLowerCase() !== publicMount.toLowerCase();
            const addOriginRootVariants = () => {
                const originRoot = `${parsed.origin}/`;
                add(buildCustomTabTargetUrl(originRoot, subPath, search, { stripMountPrefix: publicMount }));
                if (assetSubPath && assetSubPath !== strippedSubPath) {
                    add(buildCustomTabTargetUrl(originRoot, assetSubPath, search));
                }
            };
            const rootStrip = () => {
                add(buildCustomTabTargetUrl(baseUrl, subPath, search, { stripMountPrefix: publicMount }));
                if (assetSubPath && assetSubPath !== strippedSubPath) {
                    add(buildCustomTabTargetUrl(baseUrl, assetSubPath, search));
                } else if (!subHasPublicMount && subWithoutPublicMount) {
                    add(buildCustomTabTargetUrl(baseUrl, subWithoutPublicMount, search));
                }
            };
            const mountPrefixed = (segment) => {
                if (!segment) return;
                if (baseHasUpstreamMount && segment.toLowerCase() === upstreamMount.toLowerCase()) return;
                const withMount = `${String(baseUrl).replace(/\/+$/, '')}/${segment}`;
                if (assetSubPath) {
                    add(buildCustomTabTargetUrl(withMount, assetSubPath, search));
                }
                add(buildCustomTabTargetUrl(withMount, subPath, search, { stripMountPrefix: publicMount }));
            };
            const mountPrefixedUpstream = () => mountPrefixed(upstreamMount);
            const mountPrefixedPublic = () => {
                if (!mountsDiffer) return;
                mountPrefixed(publicMount);
            };
            // Url Base path first (e.g. /radarr4k), then root fallbacks for dedicated-port instances.
            mountPrefixedUpstream();
            mountPrefixedPublic();
            rootStrip();
            if (baseHasUpstreamMount) addOriginRootVariants();
        } catch {
            add(buildCustomTabTargetUrl(baseUrl, subPath, search, { stripMountPrefix: publicMount }));
        }
    };

    pushVariants(sourceUrl);
    const publicBase = String(publicTabUrl || '').trim();
    if (publicBase && publicBase.replace(/\/+$/, '') !== String(sourceUrl || '').trim().replace(/\/+$/, '')) {
        pushVariants(publicBase);
    }
    return urls;
};

export const resolvePathMountedArrEmbedUpstream = (tabUrl, publicBaseUrl, arrInstances = []) => {
    try {
        const mountSegment = parsePathMountedArrMountSegment(tabUrl);
        if (!mountSegment) return null;
        const mount = mountSegment.toLowerCase();
        const wants4k = /4k$/i.test(mount);
        const baseType = mount.replace(/4k$/i, '');
        const arrType = PATH_MOUNTED_ARR_TYPES.has(mount) ? mount : baseType;
        const parsed = new URL(String(tabUrl || '').trim());
        const publicBase = String(publicBaseUrl || '').trim();
        if (publicBase) {
            const pub = new URL(publicBase);
            if (parsed.hostname.toLowerCase() !== pub.hostname.toLowerCase()) return null;
        }
        const list = Array.isArray(arrInstances) ? arrInstances : [];
        const normalizeType = (value) => String(value || '').toLowerCase().replace(/-4k$/, '4k');
        const isEntry4k = (entry) => {
            const type = normalizeType(entry?.type);
            return type === `${arrType}4k` || !!entry?.is4k;
        };
        const candidates = list.filter((entry) => {
            if (!entry || entry.enabled === false) return false;
            const type = normalizeType(entry.type);
            if (type !== arrType && type !== `${arrType}4k`) return false;
            return wants4k ? isEntry4k(entry) : !isEntry4k(entry);
        });
        const instance = pickPathMountedArrInstance(candidates, wants4k, arrType);
        const internal = String(instance?.url || '').trim().replace(/\/+$/, '');
        if (!internal || !/^https?:\/\//i.test(internal)) return null;
        const internalParsed = new URL(internal);
        if (!isPrivateIntegrationHost(internalParsed.hostname)) return null;
        const upstreamMountSegment = resolveUpstreamMountSegment(mountSegment, internal);
        return { upstreamUrl: internal, mountSegment, upstreamMountSegment };
    } catch {
        return null;
    }
};

/** @deprecated name — returns upstream URL only when a private LAN instance is configured. */
export const resolvePathMountedArrEmbedUpstreamUrl = (tabUrl, publicBaseUrl, arrInstances = []) => (
    resolvePathMountedArrEmbedUpstream(tabUrl, publicBaseUrl, arrInstances)?.upstreamUrl || null
);

export const rewriteSetCookieHeader = (value, proxyPath) => {
    let next = String(value || '');
    if (/;\s*path=/i.test(next)) {
        next = next.replace(/;\s*path=[^;]*/gi, `; Path=${proxyPath}`);
    } else {
        next += `; Path=${proxyPath}`;
    }
    if (/;\s*domain=/i.test(next)) {
        next = next.replace(/;\s*domain=[^;]*/gi, '');
    }
    if (/;\s*samesite=/i.test(next)) {
        next = next.replace(/;\s*samesite=[^;]*/gi, '; SameSite=Lax');
    } else {
        next += '; SameSite=Lax';
    }
    return next;
};

export const rewriteProxiedBody = (body, contentType, tabUrl, proxyPublicPrefix) => {
    const text = String(body || '');
    if (!text) return text;
    const ct = String(contentType || '').toLowerCase();
    if (!isTextualContentType(ct)) return text;
    const base = new URL(tabUrl);
    const origins = [base.origin, `${base.protocol}//${base.host}`];
    const prefix = proxyPublicPrefix.replace(/\/$/, '');
    const isHtml = ct.includes('text/html');
    const isJs = ct.includes('javascript') || ct.includes('ecmascript');
    const isCss = ct.includes('text/css');
    let out = text;
    // Blanket origin swap in minified JS can break syntax (e.g. regexes, comments before try).
    if (isHtml || isCss || ct.includes('json')) {
        for (const origin of origins) {
            out = out.split(origin).join(prefix);
        }
    }
    if (isHtml || isCss) {
        out = rewriteRootRelativeUrls(out, prefix);
    }
    if (isJs || isHtml) {
        out = rewriteWebpackPublicPath(out, proxyPathnameFromPrefix(prefix));
        out = rewriteDynamicImports(out, prefix);
    }
    if (isHtml) {
        out = injectEmbedProxyShim(out, prefix);
    }
    return out;
};

const pickRequestHeaders = (req, targetUrl) => {
    const headers = {};
    for (const [key, value] of Object.entries(req.headers || {})) {
        const lower = key.toLowerCase();
        if (!REQUEST_HEADER_ALLOW.has(lower) || value == null) continue;
        if (lower === 'referer' || lower === 'origin') {
            headers[lower] = targetUrl;
            continue;
        }
        headers[lower] = Array.isArray(value) ? value.join(', ') : String(value);
    }
    const cookie = filterUpstreamCookieHeader(req.headers?.cookie);
    if (cookie) headers.cookie = cookie;
    headers['accept-encoding'] = 'identity';
    return headers;
};

export const copyResponseHeaders = (upstream, res, {
    proxyPath,
    tabUrl,
    proxyPublicPrefix,
    upstreamUrl = '',
    passthroughBinary = false,
}) => {
    upstream.headers.forEach((value, key) => {
        const lower = key.toLowerCase();
        if (BLOCKED_RESPONSE_HEADERS.has(lower)) return;
        if (!passthroughBinary && lower === 'content-length') return;
        if (lower === 'location') {
            res.setHeader('Location', rewriteLocationHeader(value, tabUrl, proxyPublicPrefix, upstreamUrl));
            return;
        }
        if (lower === 'set-cookie') {
            return;
        }
        res.setHeader(key, value);
    });
    const cookies = typeof upstream.headers.getSetCookie === 'function'
        ? upstream.headers.getSetCookie()
        : (upstream.headers.get('set-cookie') ? [upstream.headers.get('set-cookie')] : []);
    for (const cookie of cookies) {
        if (typeof res.append === 'function') {
            res.append('Set-Cookie', rewriteSetCookieHeader(cookie, proxyPath));
        } else {
            res.setHeader('Set-Cookie', rewriteSetCookieHeader(cookie, proxyPath));
        }
    }
};

export const drainUpstreamBody = async (upstream) => {
    try {
        const body = upstream?.body;
        if (!body) return;
        if (typeof body.destroy === 'function') {
            body.destroy();
            return;
        }
        if (typeof body.cancel === 'function') {
            await body.cancel();
        }
    } catch {
        // ignore cleanup failures
    }
};

export const readUpstreamBodyWithLimit = async (upstream, maxBytes = EMBED_PROXY_MAX_REWRITE_BYTES) => {
    const limit = Number(maxBytes) > 0 ? Number(maxBytes) : EMBED_PROXY_MAX_REWRITE_BYTES;
    const body = upstream?.body;
    if (body && typeof body[Symbol.asyncIterator] === 'function') {
        const chunks = [];
        let total = 0;
        for await (const chunk of body) {
            const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            total += buf.length;
            if (total > limit) {
                await drainUpstreamBody(upstream);
                const error = new Error(`Upstream response exceeds ${limit} byte embed proxy limit`);
                error.code = 'EMBED_PROXY_BODY_TOO_LARGE';
                throw error;
            }
            chunks.push(buf);
        }
        return Buffer.concat(chunks);
    }
    if (typeof upstream?.arrayBuffer === 'function') {
        const buf = Buffer.from(await upstream.arrayBuffer());
        if (buf.length > limit) {
            const error = new Error(`Upstream response exceeds ${limit} byte embed proxy limit`);
            error.code = 'EMBED_PROXY_BODY_TOO_LARGE';
            throw error;
        }
        return buf;
    }
    return Buffer.alloc(0);
};

export const pipeUpstreamBody = (upstream, res, { log = () => {}, proxyRouteName = '', entityId = '' } = {}) => {
    const body = upstream?.body;
    if (!body) {
        res.end();
        return;
    }
    const onClientClose = () => {
        drainUpstreamBody(upstream);
    };
    res.once('close', onClientClose);
    body.once('error', (error) => {
        res.removeListener('close', onClientClose);
        log(`[${proxyRouteName}] ${entityId} upstream stream error: ${error.message}`);
        if (!res.headersSent) {
            res.status(502).end('Failed to stream embedded content.');
        } else {
            res.end();
        }
    });
    body.pipe(res);
};

/** Bounded keep-alive pool for embed proxy upstream fetches (avoids unbounded socket growth). */
export const createEmbedProxyFetch = (fetchImpl, options = {}) => {
    const maxSockets = Number(options.maxSockets) > 0 ? Number(options.maxSockets) : 32;
    const maxFreeSockets = Math.min(8, maxSockets);
    const httpAgent = new http.Agent({
        keepAlive: true,
        maxSockets,
        maxFreeSockets,
        timeout: 60000,
    });
    const httpsAgent = new https.Agent({
        keepAlive: true,
        maxSockets,
        maxFreeSockets,
        timeout: 60000,
    });
    return (url, init = {}, timeoutMs) => {
        const isHttps = String(url || '').toLowerCase().startsWith('https:');
        return fetchImpl(url, { ...init, agent: isHttps ? httpsAgent : httpAgent }, timeoutMs);
    };
};

export const createEmbedProxyHandler = ({
    loadConfig,
    resolveEmbedTarget,
    proxyRouteName,
    resolveCurrentAdmin,
    getSessionActor,
    effectiveViewerIsAdmin,
    withBasePath,
    fetchWithTimeout,
    requestIsHttps,
    log = () => {},
}) => async (req, res) => {
    applyEmbedProxyFrameHeaders(res);
    const entityId = String(req.params?.tabId || req.params?.moduleId || '').trim();
    const subPath = readWildcardPath(req);
    if (!entityId) {
        return res.status(400).send('Missing embed id');
    }

    try {
        const config = await loadConfig();
        const target = await resolveEmbedTarget({
            req,
            config,
            entityId,
            resolveCurrentAdmin,
            getSessionActor,
            effectiveViewerIsAdmin,
        });
        if (!target) {
            return res.status(404).send('Embed target not found');
        }
        if (target.forbidden) {
            return res.status(403).send('Forbidden');
        }

        const sourceUrl = target.sourceUrl;
        const stripMountPrefix = target.stripMountPrefix || '';
        const search = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
        const method = String(req.method || 'GET').toUpperCase();
        const candidateUrls = stripMountPrefix
            ? buildPathMountedArrTargetUrls(sourceUrl, stripMountPrefix, subPath, search, {
                publicTabUrl: target.publicTabUrl,
                upstreamMountSegment: target.upstreamMountSegment,
            })
            : [];
        if (!candidateUrls.length) {
            try {
                candidateUrls.push(buildCustomTabTargetUrl(sourceUrl, subPath, search, { stripMountPrefix }));
            } catch (error) {
                const status = Number(error?.status) || (String(error?.message || '').includes('Invalid embed path') ? 400 : 403);
                return res.status(status).send(status === 400 ? 'Invalid embed path' : 'Embed target is not allowed');
            }
        }
        for (const candidate of candidateUrls) {
            try {
                await assertEmbedTargetNotMetadata(candidate);
            } catch (error) {
                const status = Number(error?.status) || (String(error?.message || '').includes('Invalid embed path') ? 400 : 403);
                return res.status(status).send(status === 400 ? 'Invalid embed path' : 'Embed target is not allowed');
            }
        }

        let targetUrl = candidateUrls[0];
        let upstream = null;
        for (const candidate of candidateUrls) {
            const headers = pickRequestHeaders(req, candidate);
            const init = { method, headers, redirect: 'manual' };
            if (method !== 'GET' && method !== 'HEAD') {
                const body = serializeEmbedProxyRequestBody(req);
                if (body != null) {
                    init.body = body;
                    delete headers['content-length'];
                    if (!headers['content-type'] && typeof body === 'string' && !Buffer.isBuffer(body)) {
                        headers['content-type'] = body.startsWith('{') || body.startsWith('[')
                            ? 'application/json'
                            : 'application/x-www-form-urlencoded';
                    }
                }
            }
            const attempt = await fetchWithTimeout(candidate, init, 30000);
            targetUrl = candidate;
            const attemptType = attempt.headers.get('content-type') || '';
            const attemptLocation = attempt.headers.get('location') || '';
            const failed = isArrEmbedUpstreamFailure(attempt.status, attemptType, attemptLocation);
            if (!failed || candidate === candidateUrls[candidateUrls.length - 1]) {
                upstream = attempt;
                break;
            }
            await drainUpstreamBody(attempt);
        }
        if (!upstream) {
            return res.status(502).send('Failed to load embedded content through the portal proxy.');
        }
        const proxyPath = withBasePath(`/api/${proxyRouteName}/${encodeURIComponent(entityId)}`);
        const proxyPublicPrefix = resolveEmbedProxyPublicPrefix(req, proxyPath, { requestIsHttps });
        const contentType = upstream.headers.get('content-type') || '';
        const isTextual = isTextualContentType(contentType);

        copyResponseHeaders(upstream, res, {
            proxyPath,
            tabUrl: target.publicTabUrl || target.sourceUrl,
            upstreamUrl: target.sourceUrl,
            proxyPublicPrefix,
            passthroughBinary: !isTextual,
        });
        applyEmbedProxyFrameHeaders(res);
        res.status(upstream.status);

        // Login is usually 302 + Set-Cookie. Dropping cookies here sends the iframe
        // back to /login with no session, which looks like the form just reloaded.
        if (method === 'HEAD' || (upstream.status >= 300 && upstream.status < 400)) {
            await drainUpstreamBody(upstream);
            return res.end();
        }

        if (!isTextual) {
            if (upstream.body && typeof upstream.body.pipe === 'function') {
                pipeUpstreamBody(upstream, res, { log, proxyRouteName, entityId });
                return;
            }
            if (upstream.body && typeof Readable.fromWeb === 'function' && typeof upstream.body.getReader === 'function') {
                pipeUpstreamBody({ body: Readable.fromWeb(upstream.body) }, res, { log, proxyRouteName, entityId });
                return;
            }
            const raw = await readUpstreamBodyWithLimit(upstream, EMBED_PROXY_MAX_REWRITE_BYTES * 4);
            return res.send(raw);
        }

        const raw = await readUpstreamBodyWithLimit(upstream);
        if (raw.length > EMBED_PROXY_MAX_REWRITE_BYTES) {
            log(`[${proxyRouteName}] ${entityId} textual response ${raw.length} bytes exceeds rewrite cap; sending without rewrite`);
            return res.send(raw);
        }
        const rewritten = rewriteProxiedBody(
            raw.toString('utf8'),
            contentType,
            target.publicTabUrl || target.sourceUrl,
            proxyPublicPrefix,
        );
        return res.send(rewritten);
    } catch (error) {
        if (error?.code === 'EMBED_PROXY_BODY_TOO_LARGE') {
            log(`[${proxyRouteName}] ${entityId} ${req.method} body too large: ${error.message}`);
            applyEmbedProxyFrameHeaders(res);
            return res.status(502).send('Embedded upstream response was too large for the portal proxy.');
        }
        log(`[${proxyRouteName}] ${entityId} ${req.method} failed: ${error.message}`);
        applyEmbedProxyFrameHeaders(res);
        return res.status(502).send('Failed to load embedded content through the portal proxy.');
    }
};

export const createCustomTabEmbedProxyHandler = (deps) => createEmbedProxyHandler({
    ...deps,
    proxyRouteName: 'custom-tab-embed',
    resolveEmbedTarget: async ({ req, config, entityId, resolveCurrentAdmin, getSessionActor, effectiveViewerIsAdmin }) => {
        const tabs = deps.normalizeCustomNavTabs(config.customNavTabs);
        const tab = tabs.find((entry) => String(entry.id) === entityId);
        if (!tab || !tab.enabled || tab.openMode !== 'embed') return null;
        const actor = getSessionActor(req.user);
        const isRealAdmin = await resolveCurrentAdmin(actor, config);
        const isAdmin = effectiveViewerIsAdmin(req.user, isRealAdmin);
        if (tab.adminOnly && !isAdmin) return { forbidden: true };
        const publicBase = deps.resolvePublicBaseUrlFromConfig?.(config) || '';
        const upstreamCtx = resolvePathMountedArrEmbedUpstream(
            tab.url,
            publicBase,
            deps.getArrInstances?.(config, { enabledOnly: true }),
        );
        const mountSegment = upstreamCtx?.mountSegment || parsePathMountedArrMountSegment(tab.url) || '';
        const upstreamMountSegment = upstreamCtx?.upstreamMountSegment
            || resolveUpstreamMountSegment(mountSegment, upstreamCtx?.upstreamUrl || '');
        return {
            sourceUrl: upstreamCtx?.upstreamUrl || tab.url,
            stripMountPrefix: mountSegment,
            upstreamMountSegment,
            publicTabUrl: tab.url,
        };
    },
});

export const createHomeModuleEmbedProxyHandler = (deps) => createEmbedProxyHandler({
    ...deps,
    proxyRouteName: 'home-module-embed',
    resolveEmbedTarget: async ({ req, config, entityId, resolveCurrentAdmin, getSessionActor, effectiveViewerIsAdmin }) => {
        const modules = deps.normalizeHomeCustomModules(config.homeCustomModules);
        const module = modules.find((entry) => String(entry.id) === entityId);
        if (!module || !module.enabled || module.mode !== 'iframe' || !module.url) return null;
        const actor = getSessionActor(req.user);
        const isRealAdmin = await resolveCurrentAdmin(actor, config);
        const isAdmin = effectiveViewerIsAdmin(req.user, isRealAdmin);
        if (module.adminOnly && !isAdmin) return { forbidden: true };
        return { sourceUrl: module.url };
    },
});
