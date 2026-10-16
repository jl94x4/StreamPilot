/**
 * Bundled Applets logos from https://github.com/homarr-labs/dashboard-icons
 * Brand marks remain with their respective owners.
 */

export const APPLET_PRESET_LOGO_DIR = '/static/applets';
export const APPLET_PRESET_LOGO_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const APPLET_PRESET_LOGOS = [
    { id: 'plex', name: 'Plex', icon: 'Film', aliases: ['plex'] },
    { id: 'jellyfin', name: 'Jellyfin', icon: 'Tv', aliases: ['jellyfin'] },
    { id: 'emby', name: 'Emby', icon: 'Tv', aliases: ['emby'] },
    { id: 'overseerr', name: 'Overseerr', icon: 'Star', aliases: ['overseerr', 'overseer'] },
    { id: 'jellyseerr', name: 'Jellyseerr', icon: 'Star', aliases: ['jellyseerr', 'jellyseer'] },
    { id: 'seerr', name: 'Seerr', icon: 'Star', aliases: ['seerr'] },
    { id: 'ombi', name: 'Ombi', icon: 'Star', aliases: ['ombi'] },
    { id: 'requestrr', name: 'Requestrr', icon: 'MessageSquare', aliases: ['requestrr'] },
    { id: 'wizarr', name: 'Wizarr', icon: 'Star', aliases: ['wizarr'] },
    { id: 'petio', name: 'Petio', icon: 'Star', aliases: ['petio'] },
    { id: 'sonarr', name: 'Sonarr', icon: 'Tv', aliases: ['sonarr'] },
    { id: 'sonarr-4k', name: 'Sonarr 4K', icon: 'Tv', aliases: ['sonarr4k', '4ksonarr'] },
    { id: 'radarr', name: 'Radarr', icon: 'Film', aliases: ['radarr'] },
    { id: 'radarr-4k', name: 'Radarr 4K', icon: 'Film', aliases: ['radarr4k', '4kradarr'] },
    { id: 'lidarr', name: 'Lidarr', icon: 'Music', aliases: ['lidarr'] },
    { id: 'readarr', name: 'Readarr', icon: 'BookOpen', aliases: ['readarr'] },
    { id: 'whisparr', name: 'Whisparr', icon: 'Film', aliases: ['whisparr'] },
    { id: 'prowlarr', name: 'Prowlarr', icon: 'Globe', aliases: ['prowlarr'] },
    { id: 'bazarr', name: 'Bazarr', icon: 'Layers', aliases: ['bazarr'] },
    { id: 'recyclarr', name: 'Recyclarr', icon: 'Layers', aliases: ['recyclarr'] },
    { id: 'huntarr', name: 'Huntarr', icon: 'Zap', aliases: ['huntarr'] },
    { id: 'kometa', name: 'Kometa', icon: 'Film', aliases: ['kometa', 'plexmetamanager'] },
    { id: 'maintainerr', name: 'Maintainerr', icon: 'Layers', aliases: ['maintainerr'] },
    { id: 'profilarr', name: 'Profilarr', icon: 'Layers', aliases: ['profilarr'] },
    { id: 'cleanuparr', name: 'Cleanuparr', icon: 'Layers', aliases: ['cleanuparr'] },
    { id: 'byparr', name: 'Byparr', icon: 'Shield', aliases: ['byparr'] },
    { id: 'sabnzbd', name: 'SABnzbd', icon: 'Download', aliases: ['sabnzbd', 'sabnzb'] },
    { id: 'nzbget', name: 'NZBGet', icon: 'Download', aliases: ['nzbget'] },
    { id: 'nzbhydra2', name: 'NZBHydra2', icon: 'Database', aliases: ['nzbhydra2', 'nzbhydra'] },
    { id: 'jackett', name: 'Jackett', icon: 'Globe', aliases: ['jackett'] },
    { id: 'qbittorrent', name: 'qBittorrent', icon: 'Download', aliases: ['qbittorrent', 'qbit', 'bittorrent'] },
    { id: 'rdt-client', name: 'RDT Client', icon: 'Download', aliases: ['rdtclient', 'rdt-client', 'realdebrid'] },
    { id: 'deluge', name: 'Deluge', icon: 'Download', aliases: ['deluge'] },
    { id: 'transmission', name: 'Transmission', icon: 'Download', aliases: ['transmission'] },
    { id: 'rutorrent', name: 'ruTorrent', icon: 'Download', aliases: ['rutorrent', 'rtorrent'] },
    { id: 'flood', name: 'Flood', icon: 'Download', aliases: ['flood'] },
    { id: 'autobrr', name: 'autobrr', icon: 'Download', aliases: ['autobrr'] },
    { id: 'cross-seed', name: 'cross-seed', icon: 'Download', aliases: ['crossseed'] },
    { id: 'tautulli', name: 'Tautulli', icon: 'Activity', aliases: ['tautulli'] },
    { id: 'jellystat', name: 'Jellystat', icon: 'Activity', aliases: ['jellystat'] },
    { id: 'tdarr', name: 'Tdarr', icon: 'Cpu', aliases: ['tdarr'] },
    { id: 'unmanic', name: 'Unmanic', icon: 'Cpu', aliases: ['unmanic'] },
    { id: 'fileflows', name: 'FileFlows', icon: 'Cpu', aliases: ['fileflows'] },
    { id: 'unpackerr', name: 'Unpackerr', icon: 'Box', aliases: ['unpackerr'] },
    { id: 'flaresolverr', name: 'Flaresolverr', icon: 'Shield', aliases: ['flaresolverr', 'flaresolve'] },
    { id: 'notifiarr', name: 'Notifiarr', icon: 'MessageSquare', aliases: ['notifiarr'] },
    { id: 'ersatztv', name: 'ErsatzTV', icon: 'Tv', aliases: ['ersatztv', 'ersatz'] },
    { id: 'threadfin', name: 'Threadfin', icon: 'Radio', aliases: ['threadfin'] },
    { id: 'stash', name: 'Stash', icon: 'Film', aliases: ['stash'] },
    { id: 'navidrome', name: 'Navidrome', icon: 'Music', aliases: ['navidrome'] },
    { id: 'audiobookshelf', name: 'Audiobookshelf', icon: 'Headphones', aliases: ['audiobookshelf'] },
    { id: 'kavita', name: 'Kavita', icon: 'BookOpen', aliases: ['kavita'] },
    { id: 'komga', name: 'Komga', icon: 'BookOpen', aliases: ['komga'] },
    { id: 'calibre-web', name: 'Calibre-Web', icon: 'BookOpen', aliases: ['calibre-web', 'calibreweb', 'calibre'] },
    { id: 'immich', name: 'Immich', icon: 'Camera', aliases: ['immich'] },
    { id: 'portainer', name: 'Portainer', icon: 'Box', aliases: ['portainer'] },
    { id: 'watchtower', name: 'Watchtower', icon: 'Box', aliases: ['watchtower'] },
    { id: 'proxmox', name: 'Proxmox', icon: 'Server', aliases: ['proxmox', 'pve'] },
    { id: 'unraid', name: 'Unraid', icon: 'Server', aliases: ['unraid'] },
    { id: 'truenas', name: 'TrueNAS', icon: 'HardDrive', aliases: ['truenas'] },
    { id: 'nginx-proxy-manager', name: 'Nginx Proxy Manager', icon: 'Globe', aliases: ['nginxproxymanager', 'nginxpm'] },
    { id: 'traefik', name: 'Traefik', icon: 'Globe', aliases: ['traefik'] },
    { id: 'gluetun', name: 'Gluetun', icon: 'Shield', aliases: ['gluetun'] },
    { id: 'adguard-home', name: 'AdGuard Home', icon: 'Shield', aliases: ['adguardhome', 'adguard'] },
    { id: 'pi-hole', name: 'Pi-hole', icon: 'Shield', aliases: ['pihole'] },
    { id: 'authentik', name: 'Authentik', icon: 'Shield', aliases: ['authentik'] },
    { id: 'authelia', name: 'Authelia', icon: 'Shield', aliases: ['authelia'] },
    { id: 'cloudflare', name: 'Cloudflare', icon: 'Cloud', aliases: ['cloudflare'] },
    { id: 'cloudflared', name: 'Cloudflared', icon: 'Cloud', aliases: ['cloudflared'] },
    { id: 'uptime-kuma', name: 'Uptime Kuma', icon: 'Activity', aliases: ['uptimekuma', 'kuma'] },
    { id: 'grafana', name: 'Grafana', icon: 'Activity', aliases: ['grafana'] },
    { id: 'netdata', name: 'Netdata', icon: 'Activity', aliases: ['netdata'] },
    { id: 'scrutiny', name: 'Scrutiny', icon: 'HardDrive', aliases: ['scrutiny'] },
    { id: 'dozzle', name: 'Dozzle', icon: 'Monitor', aliases: ['dozzle'] },
    { id: 'speedtest-tracker', name: 'Speedtest Tracker', icon: 'Zap', aliases: ['speedtesttracker', 'speedtest'] },
    { id: 'homepage', name: 'Homepage', icon: 'LayoutDashboard', aliases: ['homepage'] },
    { id: 'homarr', name: 'Homarr', icon: 'LayoutDashboard', aliases: ['homarr'] },
    { id: 'dashy', name: 'Dashy', icon: 'LayoutDashboard', aliases: ['dashy'] },
    { id: 'organizr', name: 'Organizr', icon: 'LayoutDashboard', aliases: ['organizr'] },
    { id: 'nextcloud', name: 'Nextcloud', icon: 'Cloud', aliases: ['nextcloud'] },
    { id: 'paperless-ngx', name: 'Paperless-ngx', icon: 'BookOpen', aliases: ['paperlessngx', 'paperless'] },
    { id: 'stirling-pdf', name: 'Stirling PDF', icon: 'BookOpen', aliases: ['stirlingpdf', 'stirling'] },
    { id: 'filebrowser', name: 'Filebrowser', icon: 'HardDrive', aliases: ['filebrowser'] },
    { id: 'syncthing', name: 'Syncthing', icon: 'Cloud', aliases: ['syncthing'] },
    { id: 'gitea', name: 'Gitea', icon: 'Database', aliases: ['gitea'] },
    { id: 'bookstack', name: 'BookStack', icon: 'BookOpen', aliases: ['bookstack'] },
    { id: 'mealie', name: 'Mealie', icon: 'Heart', aliases: ['mealie'] },
    { id: 'home-assistant', name: 'Home Assistant', icon: 'Home', aliases: ['homeassistant', 'hass'] },
    { id: 'ntfy', name: 'ntfy', icon: 'MessageSquare', aliases: ['ntfy'] },
    { id: 'gotify', name: 'Gotify', icon: 'MessageSquare', aliases: ['gotify'] },
    { id: 'freshrss', name: 'FreshRSS', icon: 'Radio', aliases: ['freshrss'] },
    { id: 'changedetection', name: 'Changedetection', icon: 'Activity', aliases: ['changedetectionio'] },
    { id: 'it-tools', name: 'IT Tools', icon: 'Cpu', aliases: ['ittools'] },
    { id: 'bitwarden', name: 'Bitwarden', icon: 'Shield', aliases: ['bitwarden'] },
    { id: 'vaultwarden', name: 'Vaultwarden', icon: 'Shield', aliases: ['vaultwarden'] },
];

const normalizeKey = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const presetKeys = (entry) => (
    [entry.id, entry.name, ...(entry.aliases || [])]
        .map(normalizeKey)
        .filter((key) => key.length >= 3)
);

export const appletPresetLogoPath = (id) => {
    const slug = String(id || '').trim().toLowerCase();
    if (!APPLET_PRESET_LOGO_SLUG_RE.test(slug)) return '';
    if (!APPLET_PRESET_LOGOS.some((entry) => entry.id === slug)) return '';
    return `${APPLET_PRESET_LOGO_DIR}/${slug}.png`;
};

export const parseAppletPresetLogoUrl = (url) => {
    const pathOnly = String(url || '').trim().split('?')[0];
    const match = pathOnly.match(/^\/static\/applets\/([a-z0-9]+(?:-[a-z0-9]+)*)\.png$/);
    if (!match) return '';
    return APPLET_PRESET_LOGOS.some((entry) => entry.id === match[1]) ? match[1] : '';
};

export const isAppletPresetLogoUrl = (url) => !!parseAppletPresetLogoUrl(url);

export const matchAppletPresetLogo = (name, url) => {
    const nameKey = normalizeKey(name);
    let host = '';
    try {
        host = new URL(String(url || '').trim()).hostname.toLowerCase();
    } catch {
        host = '';
    }
    const hostLabels = host.split(/[.-]/).filter(Boolean);
    const hostKey = normalizeKey(host);
    const wants4k = /4k|uhd/.test(nameKey)
        || /4k|uhd/.test(hostKey)
        || hostLabels.some((label) => /^(4k|uhd)$/.test(label));

    let best = null;
    let bestScore = 0;
    for (const entry of APPLET_PRESET_LOGOS) {
        const is4kEntry = /4k|uhd/.test(normalizeKey(entry.id));
        if (is4kEntry && !wants4k) continue;
        for (const key of presetKeys(entry)) {
            let score = 0;
            if (nameKey === key) score = 120 + key.length;
            else if (nameKey.startsWith(key) || nameKey.endsWith(key)) score = 70 + key.length;
            else if (host === entry.id || host.startsWith(`${entry.id}.`)) score = 110 + key.length;
            else if (hostLabels.includes(entry.id) || hostLabels.includes(key)) score = 95 + key.length;
            else if (key.length >= 5 && hostKey.includes(key)) score = 50 + key.length;
            if (wants4k && is4kEntry && score > 0) score += 40;
            if (score > bestScore) {
                bestScore = score;
                best = entry;
            }
        }
    }
    return bestScore >= 50 ? best : null;
};
