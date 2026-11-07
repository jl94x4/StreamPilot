/**
 * Plex's /status/sessions/history/all rows do not carry a user or a player object (live sessions
 * do). They carry `accountID` and `deviceID`; the names live in /accounts and /devices.
 */

const asList = (value) => (Array.isArray(value) ? value : value ? [value] : []);

/** { "<accountId>": { name, thumb } } from a /accounts response. */
export const accountsMapFromResponse = (response) => {
    const map = {};
    for (const account of asList(response?.MediaContainer?.Account)) {
        if (account?.id == null) continue;
        map[String(account.id)] = { name: account.name || '', thumb: account.thumb || null };
    }
    return map;
};

/** { "<deviceId>": { name, platform, product } } from a /devices response. */
export const devicesMapFromResponse = (response) => {
    const map = {};
    for (const device of asList(response?.MediaContainer?.Device)) {
        if (device?.id == null) continue;
        map[String(device.id)] = {
            name: device.name || '',
            platform: device.platform || '',
            product: device.product || '',
        };
    }
    return map;
};

/**
 * Who and what a history row was played by. A user or player object on the row wins; then the
 * portal's own user list; then the server's account / device lists; and only then a placeholder.
 */
export const resolveHistoryRowIdentity = (row, { accounts = {}, devices = {}, portalUsers = [] } = {}) => {
    const accountId = row?.accountID != null && row.accountID !== '' ? String(row.accountID) : '';
    const portalUser = accountId
        ? asList(portalUsers).find((user) => String(user?.id ?? '') === accountId || String(user?.plexAccountId ?? '') === accountId)
        : null;
    const account = accountId ? accounts[accountId] : null;
    const device = row?.deviceID != null && row.deviceID !== '' ? devices[String(row.deviceID)] : null;

    const user = row?.User?.title
        || portalUser?.username
        || account?.name
        || (accountId && accountId !== '0' ? `User ${accountId}` : 'Unknown User');
    return {
        user,
        userThumb: row?.User?.thumb || portalUser?.thumb || account?.thumb || null,
        player: row?.Player?.title || device?.name || null,
        platform: row?.Player?.platform || device?.platform || null,
        product: row?.Player?.product || device?.product || null,
    };
};
