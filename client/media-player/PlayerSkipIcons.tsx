import React from 'react';

type IconProps = { className?: string };

/** Material-style replay 10 — circular back arrow with 10 in the hole. */
export const PlayerSkipBackIcon: React.FC<IconProps> = ({ className }) => (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
        <path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z" />
        <text
            x="12.15"
            y="16.35"
            textAnchor="middle"
            fill="currentColor"
            fontSize="6.4"
            fontWeight="800"
            fontFamily="system-ui,Segoe UI,sans-serif"
        >
            10
        </text>
    </svg>
);

/** Material-style forward 10 — circular ahead arrow with 10 in the hole. */
export const PlayerSkipForwardIcon: React.FC<IconProps> = ({ className }) => (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
        <path d="M18 13c0 3.31-2.69 6-6 6s-6-2.69-6-6 2.69-6 6-6v4l5-5-5-5v4c-4.42 0-8 3.58-8 8s3.58 8 8 8 8-3.58 8-8h-2z" />
        <text
            x="12.15"
            y="16.35"
            textAnchor="middle"
            fill="currentColor"
            fontSize="6.4"
            fontWeight="800"
            fontFamily="system-ui,Segoe UI,sans-serif"
        >
            10
        </text>
    </svg>
);
