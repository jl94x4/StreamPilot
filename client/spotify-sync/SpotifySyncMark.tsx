import React from 'react';

/** Original portal mark for Spotify Sync — Plex gold disc + note, not the upstream product logo. */
export const SpotifySyncMark: React.FC<{ className?: string; title?: string }> = ({
    className = 'h-8 w-8',
    title = 'Spotify Sync',
}) => (
    <svg
        viewBox="0 0 32 32"
        className={className}
        role="img"
        aria-label={title}
    >
        <defs>
            <linearGradient id="smpSpotifySyncDisc" x1="6" y1="4" x2="28" y2="30" gradientUnits="userSpaceOnUse">
                <stop stopColor="#f5c451" />
                <stop offset="1" stopColor="#e5a00d" />
            </linearGradient>
        </defs>
        <rect width="32" height="32" rx="9" fill="#121212" />
        <circle cx="16" cy="16" r="11" fill="url(#smpSpotifySyncDisc)" />
        <circle cx="16" cy="16" r="4.2" fill="#121212" />
        <path
            d="M19.2 9.4c.2-.6 1-.8 1.5-.4l.8.6c.4.3.5.9.2 1.3L19.4 15.2c.7.5 1.1 1.3 1.1 2.2 0 1.6-1.3 2.9-2.9 2.9s-2.9-1.3-2.9-2.9 1.3-2.9 2.9-2.9c.3 0 .6 0 .9.1l1.7-2.4Z"
            fill="#121212"
        />
    </svg>
);
