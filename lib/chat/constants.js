export const CHAT_MESSAGE_MAX_LENGTH = 4000;
export const CHAT_ROOM_NAME_MAX_LENGTH = 80;
export const CHAT_MESSAGES_PER_ROOM_CAP = 500;
export const CHAT_MESSAGES_PAGE_SIZE = 80;

export const isChatEnabled = (config) => !!config?.chatEnabled;

export const isChatMentionNotifyEnabled = (config) => (
    isChatEnabled(config) && config?.chatMentionNotifyInApp !== false
);

export const isUserChatMentionNotifyEnabled = (user) => user?.notifyChatMentionInApp !== false;
