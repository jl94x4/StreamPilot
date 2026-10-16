import React from 'react';

export type ChatMention = {
    userId: string;
    username: string;
};

const MENTION_TOKEN = /(@[a-zA-Z0-9][a-zA-Z0-9._-]{1,31})/g;

export const renderMessageWithMentions = (
    text: string,
    mentions: ChatMention[] = [],
    onMentionClick?: (userId: string) => void,
): React.ReactNode[] => {
    const raw = String(text || '');
    if (!raw) return [''];

    const lookup = new Map(
        mentions.map((mention) => [mention.username.toLowerCase(), mention]),
    );
    const parts = raw.split(MENTION_TOKEN);
    const nodes: React.ReactNode[] = [];

    for (let index = 0; index < parts.length; index += 1) {
        const part = parts[index];
        if (!part) continue;
        if (part.startsWith('@')) {
            const username = part.slice(1);
            const hit = lookup.get(username.toLowerCase());
            if (hit) {
                nodes.push(
                    <button
                        key={`mention-${index}-${hit.userId}`}
                        type="button"
                        className="font-semibold text-plex hover:underline"
                        onClick={() => onMentionClick?.(hit.userId)}
                    >
                        @{hit.username}
                    </button>,
                );
                continue;
            }
        }
        nodes.push(part);
    }

    return nodes.length ? nodes : [raw];
};

export const getActiveMentionQuery = (text: string, cursor: number): { start: number; query: string } | null => {
    const before = String(text || '').slice(0, Math.max(0, cursor));
    const match = /(?:^|[\s([{>])@([a-zA-Z0-9._-]*)$/.exec(before);
    if (!match) return null;
    const query = String(match[1] || '');
    const start = before.length - query.length - 1;
    return { start, query };
};

export const insertMention = (text: string, start: number, username: string): { nextText: string; nextCursor: number } => {
    const before = text.slice(0, start);
    const after = text.slice(start).replace(/^@[a-zA-Z0-9._-]*/, '');
    const mention = `@${username} `;
    const nextText = `${before}${mention}${after}`;
    const nextCursor = before.length + mention.length;
    return { nextText, nextCursor };
};
