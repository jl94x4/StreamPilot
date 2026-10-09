import React from 'react';
import { logoUrl } from './basePath';

const CIRCLE_FRAME_CLASS = 'rounded-full border-2 border-plex/40 shadow-[0_0_40px_rgba(229,160,13,0.25)] bg-black/25 flex items-center justify-center overflow-hidden';

type LoginBrandMarkProps = {
    src?: string | null;
    size?: 'md' | 'lg';
    className?: string;
    /** When true (default), logo sits inside the circular frame. When false, wide logos use their natural aspect ratio. */
    circleFrame?: boolean;
};

/**
 * Login / invite brand mark. Circle mode scales logos inside a round frame;
 * freeform mode shows the image at natural proportions (up to max width/height).
 */
export const LoginBrandMark: React.FC<LoginBrandMarkProps> = ({
    src,
    size = 'md',
    className = '',
    circleFrame = true,
}) => {
    const circleBoxClass = size === 'lg' ? 'w-32 h-32' : 'w-28 h-28 sm:w-32 sm:h-32';
    const freeBoxClass = size === 'lg'
        ? 'w-full max-w-lg max-h-40'
        : 'w-full max-w-xs sm:max-w-md max-h-28 sm:max-h-36';
    const padClass = size === 'lg' ? 'p-4' : 'p-3 sm:p-4';

    if (!circleFrame) {
        const freeClass = `${freeBoxClass} flex items-center justify-center`;
        if (!src) {
            return (
                <img
                    src={logoUrl()}
                    alt="Server Logo"
                    className={`${freeClass} h-auto w-auto max-w-full object-contain relative z-10 drop-shadow-[0_8px_24px_rgba(0,0,0,0.35)] ${className}`}
                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                />
            );
        }

        return (
            <div className={`relative z-10 ${freeClass} ${className}`}>
                <img
                    src={src}
                    alt="Server Logo"
                    className="max-w-full max-h-full w-auto h-auto object-contain drop-shadow-[0_8px_24px_rgba(0,0,0,0.35)]"
                    onError={(e) => {
                        e.currentTarget.src = logoUrl();
                    }}
                />
            </div>
        );
    }

    if (!src) {
        const freeClass = `${freeBoxClass} flex items-center justify-center`;
        return (
            <img
                src={logoUrl()}
                alt="StreamPilot"
                className={`${freeClass} h-auto w-auto max-w-full object-contain relative z-10 drop-shadow-[0_8px_24px_rgba(0,0,0,0.35)] ${className}`}
                onError={(e) => { e.currentTarget.style.display = 'none'; }}
            />
        );
    }

    return (
        <div className={`relative z-10 ${circleBoxClass} ${CIRCLE_FRAME_CLASS} ${padClass} ${className}`}>
            <img
                src={src}
                alt="Server Logo"
                className="max-w-full max-h-full w-auto h-auto object-contain"
                onError={(e) => {
                    e.currentTarget.src = logoUrl();
                    e.currentTarget.className = 'max-w-full max-h-full w-auto h-auto object-contain';
                }}
            />
        </div>
    );
};
