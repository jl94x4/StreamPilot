import React, { useState, useEffect, useMemo } from 'react';
import { usePoll } from './usePoll';
import {
    formatBackgroundPosition,
    prefetchImageFocalPoints,
    resolveImageFocalPoint,
    type FocalPoint,
} from './imageFocalPoint';

const GRID_TEXTURE = 'url("data:image/svg+xml,%3Csvg width=\'60\' height=\'60\' viewBox=\'0 0 60 60\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'none\' fill-rule=\'evenodd\'%3E%3Cg fill=\'%23ffffff\' fill-opacity=\'1\'%3E%3Cpath d=\'M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z\'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")';

const backgroundImageStyle = (url?: string): React.CSSProperties | undefined => {
    const cleanUrl = String(url || '').trim();
    if (!cleanUrl) return undefined;
    return {
        backgroundImage: `url("${cleanUrl.replace(/"/g, '%22')}")`,
    };
};

export const SlideshowBackground: React.FC<{
    backgrounds: string[];
    intervalSeconds?: number;
    opacity?: number;
    onActiveImage?: (url: string) => void;
    /** Face-aware crop for short heroes (default on). */
    smartFocus?: boolean;
}> = ({ backgrounds, intervalSeconds = 30, opacity = 1, onActiveImage, smartFocus = true }) => {
    const [currentIndex, setCurrentIndex] = useState(0);
    const [focalByUrl, setFocalByUrl] = useState<Record<string, FocalPoint>>({});

    const shuffledBackgrounds = useMemo(() => {
        if (!backgrounds || backgrounds.length === 0) return [];
        return [...backgrounds].sort(() => 0.5 - Math.random());
    }, [backgrounds]);

    usePoll(() => {
        setCurrentIndex((prev) => (prev + 1) % shuffledBackgrounds.length);
    }, shuffledBackgrounds.length > 1 ? Math.max(10, intervalSeconds) * 1000 : null, { immediate: false });

    useEffect(() => {
        if (!onActiveImage || shuffledBackgrounds.length === 0) return;
        onActiveImage(shuffledBackgrounds[currentIndex]);
    }, [currentIndex, onActiveImage, shuffledBackgrounds]);

    useEffect(() => {
        if (!smartFocus || shuffledBackgrounds.length === 0) return undefined;
        let cancelled = false;

        const warm = async () => {
            const sample = [
                shuffledBackgrounds[currentIndex],
                shuffledBackgrounds[(currentIndex + 1) % shuffledBackgrounds.length],
                shuffledBackgrounds[(currentIndex + 2) % shuffledBackgrounds.length],
            ].filter(Boolean);
            prefetchImageFocalPoints(sample);

            for (const url of sample) {
                if (cancelled) return;
                const focal = await resolveImageFocalPoint(url);
                if (cancelled) return;
                setFocalByUrl((prev) => (prev[url] ? prev : { ...prev, [url]: focal }));
            }
        };

        void warm();
        return () => { cancelled = true; };
    }, [smartFocus, shuffledBackgrounds, currentIndex]);

    if (shuffledBackgrounds.length === 0) return null;

    return (
        <div className="absolute inset-0 pointer-events-none" style={{ opacity }}>
            {shuffledBackgrounds.map((bg, idx) => {
                const focal = smartFocus ? focalByUrl[bg] : undefined;
                return (
                    <div
                        key={bg}
                        className="absolute inset-0 bg-no-repeat transition-opacity duration-[2000ms] ease-in-out"
                        style={{
                            ...backgroundImageStyle(bg),
                            backgroundSize: 'cover',
                            backgroundPosition: formatBackgroundPosition(focal),
                            opacity: idx === currentIndex ? 1 : 0,
                        }}
                    />
                );
            })}
        </div>
    );
};

/** Full-intensity ambient background for login / setup wizard */
export const AuthPageBackground: React.FC<{ backgroundImageUrl?: string, trendingBackgrounds?: string[], trendingSlideshowInterval?: number }> = ({ backgroundImageUrl, trendingBackgrounds, trendingSlideshowInterval }) => {
    const hasSlideshow = trendingBackgrounds && trendingBackgrounds.length > 0;
    return (
    <div className="pointer-events-none absolute inset-0 bg-background">
        <div className="absolute -top-32 -left-32 w-[520px] h-[520px] rounded-full bg-plex/10 blur-[120px]" />
        <div className="absolute top-1/3 -right-24 w-[480px] h-[480px] rounded-full bg-plex/8 blur-[100px]" />
        <div className="absolute bottom-0 left-1/4 w-[400px] h-[400px] rounded-full bg-plex/5 blur-[90px]" />
        <div
            className="absolute inset-0"
            style={{ backgroundImage: 'radial-gradient(ellipse 80% 50% at 50% -20%, rgb(var(--color-plex) / 0.12), transparent)' }}
        />
        {hasSlideshow ? (
            <SlideshowBackground backgrounds={trendingBackgrounds} intervalSeconds={trendingSlideshowInterval} />
        ) : (
            backgroundImageUrl && (
                <div
                    className="absolute inset-0 bg-center bg-no-repeat opacity-100"
                    style={{
                        ...backgroundImageStyle(backgroundImageUrl),
                        backgroundSize: 'cover',
                    }}
                />
            )
        )}
        <div className="absolute inset-0 opacity-[0.025]" style={{ backgroundImage: GRID_TEXTURE }} />
    </div>
    );
};

/** Subtle ambient background for authenticated app shell */
export const AppAmbientBackground: React.FC<{ backgroundImageUrl?: string; className?: string }> = ({
    backgroundImageUrl,
    className = 'fixed inset-0 z-0',
}) => (
    <div className={`pointer-events-none bg-background ${className}`}>
        <div className="hidden md:block absolute -top-40 -left-20 w-[420px] h-[420px] rounded-full bg-plex/[0.06] blur-[100px]" />
        <div className="hidden md:block absolute top-1/2 -right-32 w-[360px] h-[360px] rounded-full bg-plex/[0.04] blur-[90px]" />
        <div className="hidden md:block absolute bottom-0 left-1/3 w-[320px] h-[320px] rounded-full bg-plex/[0.03] blur-[80px]" />
        <div
            className="hidden md:block absolute inset-0"
            style={{ backgroundImage: 'radial-gradient(ellipse 70% 40% at 50% 0%, rgb(var(--color-plex) / 0.06), transparent)' }}
        />
        {backgroundImageUrl && (
            <div
                className="hidden md:block absolute inset-0 bg-center bg-no-repeat opacity-100"
                style={{
                    ...backgroundImageStyle(backgroundImageUrl),
                    backgroundSize: 'cover',
                }}
            />
        )}
        <div className="hidden md:block absolute inset-0 opacity-[0.018]" style={{ backgroundImage: GRID_TEXTURE }} />
    </div>
);

export const themeClasses = {
    glassCard: 'glass-card',
    glassCardSm: 'glass-card-sm',
    glassCardLg: 'glass-card-lg',
    sectionCard: 'section-card',
    btnPrimary: 'btn-primary',
    btnSecondary: 'btn-secondary',
    btnPrimaryLg: 'btn-primary-lg',
    pageHeader: 'page-header',
    pageTitle: 'page-title',
    navActive: 'nav-item-active',
    inputPremium: 'input-premium',
    labelPremium: 'label-premium',
    badgePlex: 'badge-plex',
} as const;
