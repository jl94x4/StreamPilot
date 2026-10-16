export type StackableNotification = {
    id: string;
    type?: string;
};

export type NotificationStack<T extends StackableNotification = StackableNotification> = {
    key: string;
    type: string;
    items: T[];
};

export const notificationStackKey = (item: StackableNotification) => (
    String(item?.type || 'unknown').trim() || 'unknown'
);

/** Group similar in-app notifications (same type) in list order (newest-first). */
export const stackInAppNotifications = <T extends StackableNotification>(items: T[]): NotificationStack<T>[] => {
    const groups = new Map<string, T[]>();
    const order: string[] = [];
    for (const item of items) {
        if (!item) continue;
        const key = notificationStackKey(item);
        if (!groups.has(key)) {
            groups.set(key, []);
            order.push(key);
        }
        groups.get(key)!.push(item);
    }
    return order.map((key) => ({
        key,
        type: key,
        items: groups.get(key)!,
    }));
};
