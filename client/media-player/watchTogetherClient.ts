/**
 * StreamPilot Watch Together — client for the WebSocket sync relay.
 * Sync-only: each client plays their own library copy. Relay is play/pause/seek only.
 * Auth: portal JWT or Plex account token.
 */
import { getBasePath } from '../shared/basePath';
import {
    getSessionToken,
    isPlexClientApp,
    readStoredPortalBaseUrl,
    readStoredWtRelayUrl,
} from '../plex-client/config';
import type { PlayerItem } from './types';

export type WtParticipant = {
    userId: string;
    displayName: string;
    thumb?: string | null;
    clientId: string;
    buffering?: boolean;
};

export type WtRoomState = {
    type?: string;
    roomId: string;
    inviteCode: string;
    hostUserId: string;
    ratingKey: string;
    serverId: string;
    title: string;
    mediaType?: string;
    thumb?: string | null;
    guids?: string[];
    tmdbId?: number | null;
    year?: number | null;
    playing: boolean;
    positionMs: number;
    seekId?: string | null;
    waitingForSeekReady?: boolean;
    participants: WtParticipant[];
    originClientId?: string;
    corrective?: boolean;
    clientId?: string;
    userId?: string;
};

/** Guids / external ids for cross-library match when creating a room. */
export const collectWatchTogetherGuids = (item: PlayerItem | null | undefined): string[] => {
    const out: string[] = [];
    const push = (value: unknown) => {
        const guid = String(value || '').trim();
        if (guid && !out.includes(guid)) out.push(guid);
    };
    if (!item) return out;
    push(item.plexGuid);
    const tmdb = Number(item.externalIds?.tmdb || item.tmdbId || 0);
    if (Number.isFinite(tmdb) && tmdb > 0) {
        push(`tmdb://${tmdb}`);
        push(`themoviedb://${tmdb}`);
    }
    const imdb = String(item.externalIds?.imdb || '').trim();
    if (imdb) push(imdb.startsWith('imdb://') ? imdb : `imdb://${imdb}`);
    const tvdb = String(item.externalIds?.tvdb || '').trim();
    if (tvdb) push(tvdb.startsWith('tvdb://') ? tvdb : `tvdb://${tvdb}`);
    return out.slice(0, 12);
};

export type WtError = {
    type: 'wt_error';
    code?: string;
    message?: string;
};

type WtListener = (state: WtRoomState | null) => void;
type WtErrorListener = (error: WtError) => void;

const STORAGE_PORTAL = 'plexClient.portalBaseUrl';

/** Relay HTTP(S) origin. Prefer dedicated wtRelayUrl; else portal; else same-origin. */
export const getWatchTogetherRelayBaseUrl = (): string => {
    if (typeof window === 'undefined') return '';
    const relay = readStoredWtRelayUrl();
    if (relay) return relay;
    const stored = readStoredPortalBaseUrl();
    if (stored) return stored;
    try {
        const raw = String(localStorage.getItem(STORAGE_PORTAL) || '').trim().replace(/\/+$/, '');
        if (raw) return raw;
    } catch {
        /* ignore */
    }
    const fromWindow = String(window.__PLEX_CLIENT__?.portalBaseUrl || '').trim().replace(/\/+$/, '');
    return fromWindow;
};

/** True when a WT relay is reachable config-wise (same-origin web, wtRelayUrl, or portal). */
export const isWatchTogetherAvailable = (): boolean => {
    if (typeof window === 'undefined') return false;
    if (!isPlexClientApp()) return true;
    return !!getWatchTogetherRelayBaseUrl();
};

const buildWsUrl = (token: string): string => {
    const base = getWatchTogetherRelayBaseUrl();
    const origin = base || (typeof window !== 'undefined' ? window.location.origin : '');
    const pathBase = getBasePath();
    const path = `${pathBase}/api/watch-together/ws`.replace(/\/{2,}/g, '/');
    const url = new URL(path.startsWith('/') ? path : `/${path}`, origin || 'http://localhost');
    if (token) url.searchParams.set('access_token', token);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    return url.toString();
};

export class WatchTogetherClient {
    private socket: WebSocket | null = null;
    private clientId = '';
    private userId = '';
    private room: WtRoomState | null = null;
    private intentionalClose = false;
    private reconnectTimer = 0;
    private reconnectAttempt = 0;
    private listeners = new Set<WtListener>();
    private errorListeners = new Set<WtErrorListener>();
    private pendingCreate: Record<string, unknown> | null = null;
    private pendingJoinCode: string | null = null;

    get state(): WtRoomState | null {
        return this.room;
    }

    get localClientId(): string {
        return this.clientId;
    }

    get localUserId(): string {
        return this.userId;
    }

    onState(listener: WtListener): () => void {
        this.listeners.add(listener);
        if (this.room) listener(this.room);
        return () => { this.listeners.delete(listener); };
    }

    onError(listener: WtErrorListener): () => void {
        this.errorListeners.add(listener);
        return () => { this.errorListeners.delete(listener); };
    }

    private emitState() {
        for (const listener of this.listeners) listener(this.room);
    }

    private emitError(error: WtError) {
        for (const listener of this.errorListeners) listener(error);
    }

    async connect(): Promise<void> {
        if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
            return;
        }
        const token = getSessionToken();
        if (!token && isPlexClientApp()) {
            throw new Error('Sign in required for Watch Together.');
        }
        if (isPlexClientApp() && !getWatchTogetherRelayBaseUrl()) {
            throw new Error('Watch Together needs a relay URL in Settings → Connection.');
        }
        this.intentionalClose = false;
        await new Promise<void>((resolve, reject) => {
            let settled = false;
            const ws = new WebSocket(buildWsUrl(token));
            this.socket = ws;
            const fail = (err: Error) => {
                if (settled) return;
                settled = true;
                reject(err);
            };
            ws.onopen = () => {
                /* wait for wt_hello */
            };
            ws.onmessage = (event) => {
                let message: any;
                try {
                    message = JSON.parse(String(event.data || ''));
                } catch {
                    return;
                }
                if (message?.type === 'wt_hello' && !settled) {
                    settled = true;
                    this.clientId = String(message.clientId || '');
                    this.userId = String(message.userId || '');
                    resolve();
                    if (this.pendingCreate) {
                        const payload = this.pendingCreate;
                        this.pendingCreate = null;
                        this.send(payload);
                    } else if (this.pendingJoinCode) {
                        const code = this.pendingJoinCode;
                        this.pendingJoinCode = null;
                        this.send({ type: 'wt_join', inviteCode: code });
                    }
                    return;
                }
                this.handleMessage(message);
            };
            ws.onerror = () => fail(new Error('Watch Together connection failed.'));
            ws.onclose = () => {
                this.socket = null;
                if (!settled) fail(new Error('Watch Together connection closed.'));
                else if (!this.intentionalClose) this.scheduleReconnect();
            };
        });
    }

    private scheduleReconnect() {
        window.clearTimeout(this.reconnectTimer);
        if (this.reconnectAttempt > 8) return;
        const delay = Math.min(15000, 800 * (2 ** this.reconnectAttempt));
        this.reconnectAttempt += 1;
        this.reconnectTimer = window.setTimeout(() => {
            const invite = this.room?.inviteCode || this.pendingJoinCode;
            void this.connect().then(() => {
                this.reconnectAttempt = 0;
                if (invite) this.send({ type: 'wt_join', inviteCode: invite });
            }).catch(() => {
                this.scheduleReconnect();
            });
        }, delay);
    }

    private handleMessage(message: any) {
        const type = String(message?.type || '');
        if (type === 'wt_error') {
            this.emitError(message as WtError);
            return;
        }
        if (type === 'wt_created' || type === 'wt_state') {
            this.room = {
                ...message,
                participants: Array.isArray(message.participants) ? message.participants : (this.room?.participants || []),
            };
            this.emitState();
            return;
        }
        if (type === 'wt_joined' && this.room) {
            const list = [...(this.room.participants || [])];
            if (!list.some((row) => row.clientId === message.clientId)) {
                list.push({
                    userId: message.userId,
                    displayName: message.displayName,
                    thumb: message.thumb,
                    clientId: message.clientId,
                });
            }
            this.room = { ...this.room, participants: list };
            this.emitState();
            return;
        }
        if (type === 'wt_left' && this.room) {
            this.room = {
                ...this.room,
                participants: (this.room.participants || []).filter((row) => row.clientId !== message.clientId),
                hostUserId: message.hostUserId || this.room.hostUserId,
            };
            this.emitState();
            return;
        }
        if (type === 'wt_ended') {
            this.room = null;
            this.emitState();
            return;
        }
        if (type === 'wt_buffering' || type === 'wt_resumed') {
            if (this.room) this.emitState();
        }
    }

    private send(payload: Record<string, unknown>) {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
        try {
            this.socket.send(JSON.stringify(payload));
        } catch {
            /* ignore */
        }
    }

    async create(opts: {
        ratingKey: string;
        serverId?: string;
        title?: string;
        type?: string;
        thumb?: string | null;
        positionMs?: number;
        guids?: string[];
        tmdbId?: number | null;
        year?: number | null;
    }): Promise<WtRoomState> {
        await this.connect();
        return new Promise((resolve, reject) => {
            const off = this.onState((state) => {
                if (state?.inviteCode && state.ratingKey === opts.ratingKey) {
                    off();
                    offErr();
                    resolve(state);
                }
            });
            const offErr = this.onError((err) => {
                off();
                offErr();
                reject(new Error(err.message || 'Could not create room.'));
            });
            this.send({
                type: 'wt_create',
                ratingKey: opts.ratingKey,
                serverId: opts.serverId || '',
                title: opts.title || 'Watch Together',
                mediaType: opts.type || 'movie',
                thumb: opts.thumb || null,
                positionMs: opts.positionMs || 0,
                guids: Array.isArray(opts.guids) ? opts.guids : [],
                tmdbId: opts.tmdbId != null ? opts.tmdbId : null,
                year: opts.year != null ? opts.year : null,
            });
            window.setTimeout(() => {
                off();
                offErr();
                reject(new Error('Create room timed out.'));
            }, 12000);
        });
    }

    async join(inviteCode: string): Promise<WtRoomState> {
        const code = String(inviteCode || '').trim().toUpperCase();
        if (!code) throw new Error('Enter an invite code.');
        await this.connect();
        return new Promise((resolve, reject) => {
            const off = this.onState((state) => {
                if (state?.inviteCode === code || state?.roomId === code) {
                    off();
                    offErr();
                    resolve(state);
                }
            });
            const offErr = this.onError((err) => {
                off();
                offErr();
                reject(new Error(err.message || 'Could not join room.'));
            });
            this.send({ type: 'wt_join', inviteCode: code });
            window.setTimeout(() => {
                off();
                offErr();
                reject(new Error('Join room timed out.'));
            }, 12000);
        });
    }

    play(positionMs?: number) {
        this.send({ type: 'wt_play', positionMs });
    }

    pause(positionMs?: number) {
        this.send({ type: 'wt_pause', positionMs });
    }

    seek(positionMs: number, playing?: boolean) {
        this.send({ type: 'wt_seek', positionMs, playing });
    }

    seekReady(seekId: string) {
        this.send({ type: 'wt_seek_ready', seekId });
    }

    report(positionMs: number, buffering = false) {
        this.send({ type: 'wt_report', positionMs, buffering });
    }

    leave() {
        this.send({ type: 'wt_leave' });
        this.room = null;
        this.emitState();
    }

    disconnect() {
        this.intentionalClose = true;
        window.clearTimeout(this.reconnectTimer);
        this.leave();
        try { this.socket?.close(); } catch { /* ignore */ }
        this.socket = null;
        this.pendingCreate = null;
        this.pendingJoinCode = null;
    }
}

let sharedClient: WatchTogetherClient | null = null;

export const getWatchTogetherClient = (): WatchTogetherClient => {
    if (!sharedClient) sharedClient = new WatchTogetherClient();
    return sharedClient;
};

export const discardWatchTogetherClient = () => {
    if (!sharedClient) return;
    sharedClient.disconnect();
    sharedClient = null;
};

export const fetchWatchTogetherRoomSummary = async (code: string): Promise<{
    inviteCode: string;
    title: string;
    mediaType?: string;
    thumb?: string | null;
    ratingKey: string;
    serverId: string;
    guids?: string[];
    tmdbId?: number | null;
    year?: number | null;
    participantCount: number;
} | null> => {
    const base = getWatchTogetherRelayBaseUrl();
    const pathBase = getBasePath();
    const path = `${pathBase}/api/watch-together/room/${encodeURIComponent(String(code || '').trim())}`;
    const url = base ? `${base.replace(/\/+$/, '')}${path}` : path;
    const token = getSessionToken();
    try {
        const response = await fetch(url, {
            headers: token ? { Authorization: `Bearer ${token}` } : undefined,
            credentials: base ? 'omit' : 'include',
            cache: 'no-store',
        });
        if (!response.ok) return null;
        return await response.json();
    } catch {
        return null;
    }
};
