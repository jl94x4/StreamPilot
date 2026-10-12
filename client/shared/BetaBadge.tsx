import React from 'react';
import { Info } from 'lucide-react';
import { useDiscoverI18n } from '../discovery/i18n';

export const BETA_BADGE_CLASS =
    'inline-flex shrink-0 items-center rounded-full border border-amber-400/35 bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-amber-200';

export const ALPHA_BADGE_CLASS =
    'inline-flex shrink-0 items-center rounded-full border border-sky-400/35 bg-sky-500/15 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-sky-200';

export const BetaBadge: React.FC<{ className?: string; title?: string }> = ({ className = '', title }) => (
    <span className={`${BETA_BADGE_CLASS} ${className}`.trim()} title={title}>
        BETA
    </span>
);

export const AlphaBadge: React.FC<{ className?: string; title?: string }> = ({ className = '', title }) => (
    <span className={`${ALPHA_BADGE_CLASS} ${className}`.trim()} title={title}>
        ALPHA
    </span>
);

export const BetaFeatureBanner: React.FC<{
    titleKey: string;
    noticeKey: string;
    className?: string;
}> = ({ titleKey, noticeKey, className = '' }) => {
    const { t } = useDiscoverI18n();
    const notice = t(noticeKey);
    return (
        <div
            className={`flex items-start gap-2 rounded-xl border border-amber-400/25 bg-amber-500/10 px-3 py-2.5 text-xs leading-relaxed text-amber-100/90 ${className}`.trim()}
            title={notice}
        >
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" aria-hidden />
            <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-1.5 font-bold uppercase tracking-wide text-amber-200">
                    <BetaBadge title={notice} />
                    <span>{t(titleKey)}</span>
                </p>
                <p className="mt-1 text-amber-100/85">{notice}</p>
            </div>
        </div>
    );
};

export const SpotifySyncBetaBanner: React.FC<{ className?: string }> = ({ className = '' }) => (
    <BetaFeatureBanner
        titleKey="spotifySyncPage.betaTitle"
        noticeKey="spotifySyncPage.betaNotice"
        className={className}
    />
);

export const PosterSetsBetaBanner: React.FC<{ className?: string }> = ({ className = '' }) => (
    <BetaFeatureBanner
        titleKey="posterSetsPage.betaTitle"
        noticeKey="posterSetsPage.betaNotice"
        className={className}
    />
);

export const AlphaFeatureBanner: React.FC<{
    titleKey: string;
    noticeKey: string;
    className?: string;
}> = ({ titleKey, noticeKey, className = '' }) => {
    const { t } = useDiscoverI18n();
    const notice = t(noticeKey);
    return (
        <div
            className={`flex items-start gap-2 rounded-xl border border-sky-400/25 bg-sky-500/10 px-3 py-2.5 text-xs leading-relaxed text-sky-100/90 ${className}`.trim()}
            title={notice}
        >
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-300" aria-hidden />
            <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-1.5 font-bold uppercase tracking-wide text-sky-200">
                    <AlphaBadge title={notice} />
                    <span>{t(titleKey)}</span>
                </p>
                <p className="mt-1 text-sky-100/85">{notice}</p>
            </div>
        </div>
    );
};

export const MediaPlayerBetaBanner: React.FC<{ className?: string }> = ({ className = '' }) => (
    <BetaFeatureBanner
        titleKey="mediaPlayerPage.betaTitle"
        noticeKey="mediaPlayerPage.betaNotice"
        className={className}
    />
);

/** @deprecated Use MediaPlayerBetaBanner */
export const MediaPlayerAlphaBanner = MediaPlayerBetaBanner;
