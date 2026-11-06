/**
 * StreamPilot Watch Together — WebSocket sync relay (play/pause/seek).
 * The room logic lives in ./engine.js (shared with the in-app host); this file is the relay's
 * transport and authentication: portal JWT or Plex account token.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';
import jwt from 'jsonwebtoken';
import fetch from 'node-fetch';
import { readBearerToken } from '../session-token.js';
import {
    attachParticipant,
    configureWatchTogetherEngine,
    detachParticipant,
    getWatchTogetherRoomSummary,
    handleParticipantMessage,
    reapEmptyRooms,
} from './engine.js';

export { getWatchTogetherRoomSummary, resolveWatchTogetherHostStream } from './engine.js';

configureWatchTogetherEngine({ randomBytes, randomUUID });

/**
 * @typedef {{
 *   id: string,
 *   displayName: string,
 *   thumb?: string | null,
 *   auth: 'portal' | 'plex',
 * }} WtUser
 */

const parseCookies = (header) => {
    const out = {};
    String(header || '').split(';').forEach((part) => {
        const idx = part.indexOf('=');
        if (idx < 0) return;
        const key = part.slice(0, idx).trim();
        const value = part.slice(idx + 1).trim();
        if (key) out[key] = decodeURIComponent(value);
    });
    return out;
};

const readUpgradeToken = (req) => {
    try {
        const url = new URL(req.url || '/', 'http://localhost');
        const fromQuery = String(url.searchParams.get('access_token') || '').trim();
        if (fromQuery) return fromQuery;
    } catch {
        /* ignore */
    }
    const bearer = readBearerToken(req);
    if (bearer) return bearer;
    const cookies = parseCookies(req.headers?.cookie);
    return String(cookies.session || '').trim();
};

const fetchPlexAccount = async (token) => {
    const headers = {
        Accept: 'application/json',
        'X-Plex-Token': token,
        'X-Plex-Product': 'StreamPilot',
        'X-Plex-Client-Identifier': 'streampilot-watch-together',
    };
    const tryUrls = [
        'https://plex.tv/api/v2/user',
        'https://plex.tv/users/account.json',
    ];
    for (const url of tryUrls) {
        try {
            const response = await fetch(url, { headers, cache: 'no-store' });
            if (!response.ok) continue;
            const data = await response.json();
            const user = data?.user || data;
            const id = String(user?.id || user?.uuid || '').trim();
            if (!id) continue;
            return {
                id: `plex:${id}`,
                displayName: String(user?.friendlyName || user?.username || user?.title || 'Plex user').trim(),
                thumb: user?.thumb || null,
                auth: /** @type {'plex'} */ ('plex'),
            };
        } catch {
            /* try next */
        }
    }
    return null;
};

/**
 * @param {import('http').IncomingMessage} req
 * @param {{ jwtSecret: string }} opts
 * @returns {Promise<WtUser | null>}
 */
export const resolveWatchTogetherUser = async (req, { jwtSecret, isSessionRevoked }) => {
    const token = readUpgradeToken(req);
    if (!token) return null;

    try {
        const decoded = jwt.verify(token, jwtSecret);
        if (typeof isSessionRevoked === 'function' && isSessionRevoked(token, decoded)) return null;
        const id = String(decoded?.plexId || decoded?.id || '').trim();
        if (id) {
            return {
                id: String(decoded.plexId ? `portal:${decoded.plexId}` : `portal:${decoded.id}`),
                displayName: String(decoded.username || decoded.email || 'Member').trim(),
                thumb: decoded.thumb || null,
                auth: 'portal',
            };
        }
    } catch {
        /* not a portal JWT — try Plex */
    }

    return fetchPlexAccount(token);
};

/**
 * @param {import('http').Server} httpServer
 * @param {{ jwtSecret: string, basePath?: string, log?: (msg: string) => void }} opts
 */
export const attachWatchTogether = (httpServer, opts) => {
    const jwtSecret = String(opts?.jwtSecret || '');
    const basePath = String(opts?.basePath || '').replace(/\/+$/, '');
    const log = typeof opts?.log === 'function' ? opts.log : () => undefined;
    const wsPath = `${basePath}/api/watch-together/ws`;

    const wss = new WebSocketServer({ noServer: true });

    httpServer.on('upgrade', (req, socket, head) => {
        let pathname = '';
        try {
            pathname = new URL(req.url || '/', 'http://localhost').pathname.replace(/\/+$/, '') || '/';
        } catch {
            socket.destroy();
            return;
        }
        if (pathname !== wsPath && pathname !== `${wsPath}/`) {
            return;
        }
        void resolveWatchTogetherUser(req, { jwtSecret, isSessionRevoked: opts?.isSessionRevoked }).then((user) => {
            if (!user) {
                socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
                socket.destroy();
                return;
            }
            wss.handleUpgrade(req, socket, head, (ws) => {
                wss.emit('connection', ws, req, user);
            });
        }).catch(() => {
            socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
            socket.destroy();
        });
    });

    wss.on('connection', (ws, _req, user) => {
        const participant = attachParticipant(ws, user);
        ws.on('message', (data) => handleParticipantMessage(participant, data));
        ws.on('close', () => detachParticipant(participant));
        ws.on('error', () => detachParticipant(participant));
    });

    const reaper = setInterval(reapEmptyRooms, 30000);
    if (typeof reaper.unref === 'function') reaper.unref();

    log(`[watch-together] relay listening on ${wsPath}`);
    return { wss, getWatchTogetherRoomSummary };
};
