/**
 * Invite codes for Watch Together rooms hosted on someone's own device.
 *
 * A relay room has a short six-letter code the relay looks up. A room hosted in the app has no
 * directory to look it up in, so the code carries the way in: the host's addresses, port and the
 * room's secret code, packed into a few bytes and written in the same unambiguous alphabet as the
 * short codes (no 0/O or 1/I), with a check character so a mistyped code is caught on the spot.
 *
 *   header(1) | port(2) | lan ipv4(4)? | public ipv4(4)? | public port(2)? | room code(5) | check(1)
 *
 * About 28-31 characters, shown in groups of five.
 */

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const VERSION = 1;
const FLAG_LAN = 1;
const FLAG_PUBLIC = 2;
const FLAG_PUBLIC_PORT = 4;
/** The in-app host asks its engine for this many characters (40 bits). */
export const DIRECT_ROOM_CODE_LENGTH = 8;

export type DirectInvite = {
    /** The room's secret code (8 characters, same alphabet). */
    code: string;
    /** Port the host's server listens on (on the local network). */
    port: number;
    /** Host address on the local network, dotted IPv4. */
    lan?: string;
    /** Host address on the internet (the router's), dotted IPv4. */
    publicIp?: string;
    /** Port open on the router; defaults to `port`. */
    publicPort?: number;
};

const parseIpv4 = (value: string | undefined): number[] | null => {
    const parts = String(value || '').trim().split('.');
    if (parts.length !== 4) return null;
    const bytes = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : NaN));
    return bytes.every((byte) => byte >= 0 && byte <= 255) ? bytes : null;
};

const checksum = (bytes: number[]) => {
    let sum = 0x5a;
    for (const byte of bytes) sum = ((sum << 1) | (sum >> 7)) & 0xff ^ byte;
    return sum & 0xff;
};

const toBase32 = (bytes: number[]): string => {
    let out = '';
    let buffer = 0;
    let bits = 0;
    for (const byte of bytes) {
        buffer = (buffer << 8) | byte;
        bits += 8;
        while (bits >= 5) {
            out += ALPHABET[(buffer >> (bits - 5)) & 31];
            bits -= 5;
        }
        buffer &= (1 << bits) - 1;
    }
    if (bits > 0) out += ALPHABET[(buffer << (5 - bits)) & 31];
    return out;
};

const fromBase32 = (text: string): number[] | null => {
    const out: number[] = [];
    let buffer = 0;
    let bits = 0;
    for (const char of text) {
        const value = ALPHABET.indexOf(char);
        if (value < 0) return null;
        buffer = (buffer << 5) | value;
        bits += 5;
        if (bits >= 8) {
            out.push((buffer >> (bits - 8)) & 0xff);
            bits -= 8;
            buffer &= (1 << bits) - 1;
        }
    }
    return out;
};

/** Eight room-code characters <-> five bytes. */
const packRoomCode = (code: string): number[] | null => {
    if (code.length !== DIRECT_ROOM_CODE_LENGTH) return null;
    const bytes = fromBase32(code);
    return bytes && bytes.length === 5 ? bytes : null;
};

const unpackRoomCode = (bytes: number[]): string => toBase32(bytes).slice(0, DIRECT_ROOM_CODE_LENGTH);

const group = (text: string) => text.match(/.{1,5}/g)?.join('-') || text;

/** The text to show and share. Null when the invite cannot be encoded. */
export const encodeDirectInvite = (invite: DirectInvite): string | null => {
    const code = String(invite.code || '').toUpperCase();
    const roomBytes = packRoomCode(code);
    const port = Math.floor(Number(invite.port));
    if (!roomBytes || !(port > 0 && port < 65536)) return null;
    const lan = invite.lan ? parseIpv4(invite.lan) : null;
    const pub = invite.publicIp ? parseIpv4(invite.publicIp) : null;
    if (invite.lan && !lan) return null;
    if (invite.publicIp && !pub) return null;
    if (!lan && !pub) return null;
    const publicPort = pub ? Math.floor(Number(invite.publicPort ?? port)) : 0;
    if (pub && !(publicPort > 0 && publicPort < 65536)) return null;
    const differentPublicPort = !!pub && publicPort !== port;
    const flags = (lan ? FLAG_LAN : 0) | (pub ? FLAG_PUBLIC : 0) | (differentPublicPort ? FLAG_PUBLIC_PORT : 0);
    const bytes: number[] = [(VERSION << 4) | flags, (port >> 8) & 0xff, port & 0xff];
    if (lan) bytes.push(...lan);
    if (pub) bytes.push(...pub);
    if (differentPublicPort) bytes.push((publicPort >> 8) & 0xff, publicPort & 0xff);
    bytes.push(...roomBytes);
    bytes.push(checksum(bytes));
    return group(toBase32(bytes));
};

/** Letters, digits only, upper case: what a typed or pasted code is reduced to. */
export const normalizeInviteText = (text: string) => String(text || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/** Decode a typed or pasted invite. Null when it is not a valid hosted-room code. */
export const decodeDirectInvite = (text: string): DirectInvite | null => {
    const normalized = normalizeInviteText(text);
    // Short relay codes are 6-8 characters; a hosted-room code is always longer.
    if (normalized.length < 16) return null;
    const bytes = fromBase32(normalized);
    if (!bytes || bytes.length < 9) return null;
    const header = bytes[0];
    if ((header >> 4) !== VERSION) return null;
    const flags = header & 0x0f;
    const hasLan = !!(flags & FLAG_LAN);
    const hasPublic = !!(flags & FLAG_PUBLIC);
    const hasPublicPort = !!(flags & FLAG_PUBLIC_PORT);
    if (!hasLan && !hasPublic) return null;
    const length = 3 + (hasLan ? 4 : 0) + (hasPublic ? 4 : 0) + (hasPublicPort ? 2 : 0) + 5 + 1;
    // Base32 pads the last symbol with zero bits: only whole bytes count.
    if (bytes.length < length) return null;
    const body = bytes.slice(0, length - 1);
    if (checksum(body) !== bytes[length - 1]) return null;
    let at = 1;
    const port = (body[at] << 8) | body[at + 1];
    at += 2;
    const invite: DirectInvite = { code: '', port };
    if (hasLan) {
        invite.lan = body.slice(at, at + 4).join('.');
        at += 4;
    }
    if (hasPublic) {
        invite.publicIp = body.slice(at, at + 4).join('.');
        at += 4;
        invite.publicPort = port;
        if (hasPublicPort) {
            invite.publicPort = (body[at] << 8) | body[at + 1];
            at += 2;
        }
    }
    invite.code = unpackRoomCode(body.slice(at, at + 5));
    return port > 0 && invite.code.length === DIRECT_ROOM_CODE_LENGTH ? invite : null;
};

/** True for anything that looks like a hosted-room code (valid or not), so the UI can say "check the code". */
export const looksLikeDirectInvite = (text: string) => normalizeInviteText(text).length >= 16;
