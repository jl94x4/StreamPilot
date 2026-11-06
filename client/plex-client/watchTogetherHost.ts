/**
 * Watch Together hosted on this device.
 *
 * The room logic is the same engine the relay runs (lib/watch-together/engine.js). The Android app
 * provides what a WebView cannot: a listening socket and a port opened on the router (the
 * WatchTogetherHost plugin). Friends connect straight to this device with a hosted-room invite
 * code, so no relay is needed.
 *
 * Guests are not asked for their Plex login: the room's secret code is the key, and they send only
 * a display name. (A relay needs the login to know who you are; here, whoever has the invite is in.)
 */
import {
    attachParticipant,
    detachParticipant,
    handleParticipantMessage,
    reapEmptyRooms,
    watchTogetherRoomExists,
} from '../../lib/watch-together/engine.js';

type HostPlugin = {
    start: (options: { port?: number }) => Promise<{ port: number; lan: string; lanIps: string[] }>;
    stop: () => Promise<void>;
    accept: (options: { connId: string }) => Promise<void>;
    reject: (options: { connId: string; status?: number }) => Promise<void>;
    send: (options: { connId: string; data: string }) => Promise<void>;
    close: (options: { connId: string }) => Promise<void>;
    mapPort: (options: { port: number; lan?: string }) => Promise<{
        ok: boolean;
        externalIp: string;
        externalPort: number;
        publicAddress: boolean;
        reason: string;
    }>;
    unmapPort: () => Promise<void>;
    addListener: (name: string, handler: (event: any) => void) => Promise<{ remove: () => Promise<void> }>;
};

export type HostInfo = {
    port: number;
    /** This device on the local network. */
    lan: string;
    /** The router's public address, when a port could be opened and the address is a real public one. */
    publicIp: string;
    /** Port opened on the router. */
    publicPort: number;
    /** True when people outside the local network can reach this device. */
    publicReachable: boolean;
    /** Why outside access is not available, in plain words. */
    reason: string;
    /** Secret the host's own connection presents (only this device knows it). */
    hostKey: string;
    loopbackUrl: string;
};

export type HostIdentity = { name: string; thumb?: string | null; id?: string };

const PREFERRED_PORT = 47653;
const JOIN_TIMEOUT_MS = 20_000;
const MAP_TIMEOUT_MS = 9_000;
const FAIL_WINDOW_MS = 60_000;
const FAIL_LIMIT = 5;

/** Whether this build can host a room on the device (Android app with the plugin). */
export const isHostInAppSupported = (): boolean => {
    if (typeof window === 'undefined') return false;
    try {
        const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean; isPluginAvailable?: (name: string) => boolean } }).Capacitor;
        return !!cap?.isNativePlatform?.() && cap.isPluginAvailable?.('WatchTogetherHost') === true;
    } catch {
        return false;
    }
};

let plugin: HostPlugin | null = null;
let current: HostInfo | null = null;
let starting: Promise<HostInfo> | null = null;
let removers: Array<() => Promise<void>> = [];
let reaper = 0;
const connections = new Map<string, { participant: any; joinTimer: number }>();
const failures = new Map<string, number[]>();

export const getInAppHost = (): HostInfo | null => current;

const randomToken = (bytes = 16) => {
    const data = new Uint8Array(bytes);
    crypto.getRandomValues(data);
    return Array.from(data, (b) => b.toString(16).padStart(2, '0')).join('');
};

/** Tests supply a stand-in for the native plugin. */
export const __setHostPluginForTests = (fake: HostPlugin | null) => {
    plugin = fake;
};

const loadPlugin = async (): Promise<HostPlugin> => {
    if (plugin) return plugin;
    const { registerPlugin } = await import('@capacitor/core');
    plugin = registerPlugin<HostPlugin>('WatchTogetherHost');
    return plugin;
};

const clean = (value: string | null, max: number) => String(value || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max);

const tooManyFailures = (remote: string) => {
    const now = Date.now();
    const recent = (failures.get(remote) || []).filter((at) => now - at < FAIL_WINDOW_MS);
    failures.set(remote, recent);
    return recent.length >= FAIL_LIMIT;
};

const noteFailure = (remote: string) => {
    const list = failures.get(remote) || [];
    list.push(Date.now());
    failures.set(remote, list);
    if (failures.size > 200) failures.delete(failures.keys().next().value as string);
};

const dropConnection = (connId: string) => {
    const row = connections.get(connId);
    if (!row) return;
    window.clearTimeout(row.joinTimer);
    connections.delete(connId);
    try {
        detachParticipant(row.participant);
    } catch {
        /* already gone */
    }
};

const onConnect = (host: HostPlugin, hostKey: string) => (event: { connId: string; query: string; remote: string; local: boolean }) => {
    const { connId, remote } = event;
    const params = new URLSearchParams(String(event.query || ''));
    const reject = (status: number) => { void host.reject({ connId, status }); };

    let id: string;
    if (event.local) {
        // This device's own connection: it must present the key only this process knows.
        if (params.get('k') !== hostKey) {
            reject(403);
            return;
        }
        id = `host:${clean(params.get('u'), 64) || 'me'}`;
    } else {
        if (tooManyFailures(remote)) {
            reject(429);
            return;
        }
        // Guests prove they were invited by the room's secret code.
        const code = clean(params.get('c'), 16).toUpperCase();
        if (!code || !watchTogetherRoomExists(code)) {
            noteFailure(remote);
            reject(403);
            return;
        }
        // A fresh identity per connection: a guest cannot take over someone else's seat or the host's.
        id = `guest:${clean(params.get('u'), 64) || 'guest'}:${connId.slice(0, 6)}`;
    }
    const user = {
        id,
        displayName: clean(params.get('n'), 40) || (event.local ? 'Host' : 'Guest'),
        thumb: /^https?:\/\//i.test(String(params.get('t') || '')) ? clean(params.get('t'), 300) : null,
        auth: 'plex' as const,
    };
    void host.accept({ connId }).then(() => {
        const socket = {
            readyState: 1,
            send: (data: string) => { void host.send({ connId, data }); },
            close() {
                this.readyState = 3;
                void host.close({ connId });
            },
        };
        const participant = attachParticipant(socket, user);
        // Someone who connects but never joins a room does not hold a seat open.
        const joinTimer = window.setTimeout(() => {
            if (!participant.roomId) void host.close({ connId });
        }, JOIN_TIMEOUT_MS);
        connections.set(connId, { participant, joinTimer });
    });
};

/**
 * Start hosting. Opens the room server, then tries to open a port on the router. Resolves with how
 * friends can reach this device; never rejects because the router said no (that is just
 * publicReachable = false with a reason).
 */
export const startInAppHost = (): Promise<HostInfo> => {
    if (current) return Promise.resolve(current);
    if (starting) return starting;
    starting = (async () => {
        const host = await loadPlugin();
        const hostKey = randomToken();
        const started = await host.start({ port: PREFERRED_PORT });
        removers = [
            await host.addListener('hostConnect', onConnect(host, hostKey)),
            await host.addListener('hostMessage', (event: { connId: string; data: string }) => {
                const row = connections.get(event.connId);
                if (row) handleParticipantMessage(row.participant, event.data);
            }),
            await host.addListener('hostClosed', (event: { connId: string }) => dropConnection(event.connId)),
        ].map((handle) => () => handle.remove());
        reaper = window.setInterval(reapEmptyRooms, 30_000);

        let mapped: Awaited<ReturnType<HostPlugin['mapPort']>> | null = null;
        try {
            mapped = await Promise.race([
                host.mapPort({ port: started.port, lan: started.lan || undefined }),
                new Promise<null>((resolve) => { window.setTimeout(() => resolve(null), MAP_TIMEOUT_MS); }),
            ]);
        } catch {
            mapped = null;
        }
        const reachable = !!mapped?.ok && !!mapped.publicAddress && !!mapped.externalIp;
        const noLan = !started.lan;
        current = {
            port: started.port,
            lan: started.lan || '',
            publicIp: reachable ? String(mapped?.externalIp || '') : '',
            publicPort: reachable ? Number(mapped?.externalPort || started.port) : 0,
            publicReachable: reachable,
            reason: reachable
                ? ''
                : (noLan
                    ? 'This device is not on a local network.'
                    : (mapped?.reason || 'The router did not answer, so people outside your network cannot reach this device.')),
            hostKey,
            loopbackUrl: `ws://127.0.0.1:${started.port}/wt`,
        };
        return current;
    })().finally(() => { starting = null; });
    return starting;
};

export const stopInAppHost = async (): Promise<void> => {
    if (!current && !starting) return;
    try {
        await starting;
    } catch {
        /* nothing to stop */
    }
    window.clearInterval(reaper);
    reaper = 0;
    // Tell everyone the room is over (rather than just dropping them), then let the messages out.
    let told = false;
    for (const row of connections.values()) {
        try {
            row.participant.socket.send(JSON.stringify({ type: 'wt_ended', roomId: row.participant.roomId || '' }));
            told = true;
        } catch {
            /* connection already gone */
        }
    }
    if (told) await new Promise<void>((resolve) => { window.setTimeout(resolve, 150); });
    for (const connId of [...connections.keys()]) dropConnection(connId);
    const handlers = removers;
    removers = [];
    for (const remove of handlers) {
        try {
            await remove();
        } catch {
            /* ignore */
        }
    }
    current = null;
    try {
        const host = await loadPlugin();
        await host.unmapPort().catch(() => undefined);
        await host.stop().catch(() => undefined);
    } catch {
        /* plugin gone */
    }
};
