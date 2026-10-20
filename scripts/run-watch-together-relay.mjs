#!/usr/bin/env node
/**
 * Minimal Watch Together sync relay (WebSocket + room peek).
 * No media proxy, PMS, Arr, or discovery — clients play their own library copies.
 *
 * Env:
 *   PORT          listen port (default 8787)
 *   JWT_SECRET    optional — portal JWTs; Plex account tokens always work
 *   BASE_PATH     optional path prefix (e.g. /streampilot)
 *   HOST          bind address (default 0.0.0.0)
 *
 * Usage: npm run wt:relay
 */
import http from 'node:http';
import { attachWatchTogether, getWatchTogetherRoomSummary } from '../lib/watch-together/index.js';

const PORT = Number(process.env.PORT) || 8787;
const HOST = String(process.env.HOST || '0.0.0.0').trim() || '0.0.0.0';
const JWT_SECRET = String(process.env.JWT_SECRET || '');
const BASE_PATH = String(process.env.BASE_PATH || '').replace(/\/+$/, '');

const json = (res, status, body) => {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(payload),
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
    });
    res.end(payload);
};

const normalizePath = (raw) => {
    try {
        return new URL(raw || '/', 'http://localhost').pathname.replace(/\/+$/, '') || '/';
    } catch {
        return '/';
    }
};

const server = http.createServer((req, res) => {
    if (req.method === 'OPTIONS') {
        res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Authorization, Content-Type',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
        });
        res.end();
        return;
    }

    const path = normalizePath(req.url);
    const healthPaths = new Set([
        '/',
        '/health',
        `${BASE_PATH}`,
        `${BASE_PATH}/`,
        `${BASE_PATH}/health`,
    ].filter(Boolean));

    if ((path === '/' || healthPaths.has(path)) && (req.method === 'GET' || req.method === 'HEAD')) {
        json(res, 200, { ok: true, service: 'watch-together-relay' });
        return;
    }

    const roomPrefix = `${BASE_PATH}/api/watch-together/room/`;
    if (req.method === 'GET' && path.startsWith(roomPrefix)) {
        const code = decodeURIComponent(path.slice(roomPrefix.length).split('/')[0] || '');
        const summary = getWatchTogetherRoomSummary(code);
        if (!summary) {
            json(res, 404, { error: 'Room not found.' });
            return;
        }
        json(res, 200, summary);
        return;
    }

    json(res, 404, { error: 'Not found. WebSocket: /api/watch-together/ws' });
});

attachWatchTogether(server, {
    jwtSecret: JWT_SECRET,
    basePath: BASE_PATH,
    log: (msg) => console.log(`[wt-relay] ${msg}`),
});

server.listen(PORT, HOST, () => {
    const base = BASE_PATH || '';
    console.log(`[wt-relay] listening on http://${HOST}:${PORT}${base}`);
    console.log(`[wt-relay] ws path: ${base}/api/watch-together/ws`);
    if (!JWT_SECRET) {
        console.log('[wt-relay] JWT_SECRET unset — portal JWTs disabled; Plex tokens still work');
    }
});
