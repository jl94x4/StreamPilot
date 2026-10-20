import React, { useEffect, useState } from 'react';
import { tmdbDuotoneLogo } from './discoverConstants';
import {
    discoveryLogoUrl,
    isKnownDarkLogoPath,
    isPredominantlyDarkLogo,
    shouldInvertByLabel,
    shouldNeverInvertLogo,
    shouldPreserveColorLogo,
} from './discoveryLogoUtils';

type Props = {
    logoPath: string;
    alt: string;
    className?: string;
    width?: 154 | 300 | 780;
    /** Overseerr-style duotone — light marks on dark cards, dark marks in light theme. */
    duotone?: boolean;
    /** Flat white mark. One pass, so a dark Disney wordmark and a green Hulu wordmark match. */
    tone?: 'auto' | 'light';
    /** TV billboards: Android WebView often skips lazy images in absolute layers. */
    loading?: 'lazy' | 'eager';
    onError?: () => void;
};

const isBundledOrAbsoluteLogo = (logoPath: string) => {
    const path = String(logoPath || '').trim();
    return path.startsWith('http://')
        || path.startsWith('https://')
        || path.startsWith('/static/');
};

const readLightTheme = () => {
    if (typeof document === 'undefined') return false;
    return document.documentElement.getAttribute('data-theme') === 'light';
};

/** TMDB network/studio logo — duotone for company cards, or invert when predominantly black. */
export const DiscoveryLogo: React.FC<Props> = ({
    logoPath,
    alt,
    className = '',
    width = 154,
    duotone = false,
    tone = 'auto',
    loading = 'lazy',
    onError,
}) => {
    const [isLightTheme, setIsLightTheme] = useState(readLightTheme);
    const [duotoneFailed, setDuotoneFailed] = useState(false);
    const forceLight = tone === 'light';
    const wantDuotone = duotone && !forceLight
        && !isBundledOrAbsoluteLogo(logoPath)
        && !shouldPreserveColorLogo(logoPath, alt);
    const useDuotone = wantDuotone && !duotoneFailed;
    const src = useDuotone
        ? tmdbDuotoneLogo(logoPath, width === 154 ? 300 : width, isLightTheme ? 'onLight' : 'onDark')
        : discoveryLogoUrl(logoPath, width);

    useEffect(() => {
        setDuotoneFailed(false);
    }, [logoPath, width, duotone, tone]);

    useEffect(() => {
        const apply = () => setIsLightTheme(readLightTheme());
        apply();
        const observer = new MutationObserver(apply);
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
        return () => observer.disconnect();
    }, []);

    const [invert, setInvert] = useState(
        () => !forceLight
            && !useDuotone
            && !shouldNeverInvertLogo(logoPath, alt)
            && (isKnownDarkLogoPath(logoPath)
                || shouldInvertByLabel(alt)
                || String(logoPath || '').startsWith('/static/')),
    );

    useEffect(() => {
        if (forceLight || useDuotone) {
            setInvert(false);
            return undefined;
        }

        if (shouldNeverInvertLogo(logoPath, alt)) {
            setInvert(false);
            return undefined;
        }

        // Bundled SVGs are typically dark marks for light UIs — force invert on dark cards.
        if (String(logoPath || '').startsWith('/static/')) {
            setInvert(!isLightTheme);
            return undefined;
        }

        if (isKnownDarkLogoPath(logoPath) || shouldInvertByLabel(alt)) {
            setInvert(!isLightTheme);
            return undefined;
        }

        let cancelled = false;
        const probe = new Image();
        probe.crossOrigin = 'anonymous';
        probe.onload = () => {
            if (cancelled) return;
            try {
                if (isPredominantlyDarkLogo(probe)) setInvert(!isLightTheme);
            } catch {
                // Canvas blocked — keep path/label fallbacks only.
            }
        };
        probe.src = discoveryLogoUrl(logoPath, width);

        return () => {
            cancelled = true;
            probe.onload = null;
            probe.onerror = null;
        };
    }, [logoPath, alt, width, useDuotone, isLightTheme, forceLight]);

    return (
        <img
            src={src}
            alt={alt}
            loading={loading}
            onError={() => {
                // TMDB duotone CDN filters often 404 — fall back to the plain logo once.
                if (useDuotone) {
                    setDuotoneFailed(true);
                    return;
                }
                onError?.();
            }}
            className={`${className}${forceLight || invert ? ' brightness-0 invert' : ''}`}
        />
    );
};
