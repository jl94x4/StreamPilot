/**
 * Prefer PMS server-scoped tokens for Media Player Continue Watching / timeline.
 * Account login tokens (plexAuthToken) often 401 on a shared or Home user's server,
 * while plex.tv shared_servers / Home switch tokens are what On Deck expects.
 */
export const preferPmsMemberToken = ({
    sharedServerToken = '',
    homeSwitchToken = '',
    accountToken = '',
    adminOwnerToken = '',
} = {}) => {
    const shared = String(sharedServerToken || '').trim();
    if (shared) return shared;
    const home = String(homeSwitchToken || '').trim();
    if (home) return home;
    const account = String(accountToken || '').trim();
    if (account) return account;
    const owner = String(adminOwnerToken || '').trim();
    return owner || '';
};
