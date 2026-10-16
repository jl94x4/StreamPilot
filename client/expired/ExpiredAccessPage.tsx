import React, { useMemo } from 'react';
import { AlertTriangle, CalendarClock, LifeBuoy, LogOut, Mail, MessageCircle, UserRound } from 'lucide-react';
import { useDiscoverI18n } from '../discovery/i18n';
import { formatUkDate } from '../shared/format';

type Props = {
    sessionInfo: any;
    publicConfig?: any;
    onNavigate: (route: string) => void;
    onLogout: () => void;
};

const mediaServerLabel = (type?: string) => {
    const value = String(type || 'plex').toLowerCase();
    if (value === 'jellyfin') return 'Jellyfin';
    if (value === 'emby') return 'Emby';
    return 'Plex';
};

export const ExpiredAccessPage: React.FC<Props> = ({
    sessionInfo,
    publicConfig,
    onNavigate,
    onLogout,
}) => {
    const { t } = useDiscoverI18n();
    const account = sessionInfo?.account || {};
    const expired = sessionInfo?.expiredPortal || {};
    const expiryDate = expired.expiryDate || account.expiryDate || null;
    const formattedExpiry = formatUkDate(expiryDate) || t('expiredAccess.unknownDate');
    const title = String(expired.title || '').trim() || t('expiredAccess.defaultTitle');
    const customMessage = String(expired.message || '').trim();
    const serverLabel = mediaServerLabel(sessionInfo?.mediaServerType || publicConfig?.mediaServerType);
    const contactEmail = String(publicConfig?.contactEmail || '').trim();
    const contactWhatsApp = String(publicConfig?.contactWhatsApp || '').trim();
    const supportEnabled = sessionInfo?.navFeatures?.support !== false;
    const chatEnabled = !!sessionInfo?.navFeatures?.chat;

    const defaultMessage = useMemo(() => t('expiredAccess.defaultMessage', {
        date: formattedExpiry,
        server: serverLabel,
    }), [formattedExpiry, serverLabel, t]);

    return (
        <div className="max-w-3xl mx-auto w-full px-4 py-8 md:py-12 animate-fade-in">
            <div className="glass-card border border-red-500/20 p-6 md:p-8 shadow-2xl">
                <div className="flex items-start gap-4">
                    <div className="shrink-0 w-12 h-12 rounded-2xl bg-red-500/15 border border-red-500/30 flex items-center justify-center">
                        <AlertTriangle className="w-6 h-6 text-red-300" />
                    </div>
                    <div className="min-w-0">
                        <p className="text-xs uppercase tracking-widest font-semibold text-red-300/80 mb-1">
                            {t('expiredAccess.restrictedPortal')}
                        </p>
                        <h1 className="text-2xl md:text-3xl font-black text-text tracking-tight">
                            {title}
                        </h1>
                        <p className="mt-3 text-sm md:text-base text-muted leading-relaxed whitespace-pre-wrap">
                            {customMessage || defaultMessage}
                        </p>
                    </div>
                </div>

                <div className="mt-6 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl border border-border/60 bg-background/40 p-4">
                        <div className="flex items-center gap-2 text-xs uppercase tracking-widest font-semibold text-muted mb-2">
                            <CalendarClock className="w-3.5 h-3.5" />
                            {t('expiredAccess.expiredOn')}
                        </div>
                        <p className="text-lg font-bold text-text">{formattedExpiry}</p>
                    </div>
                    <div className="rounded-xl border border-border/60 bg-background/40 p-4">
                        <div className="flex items-center gap-2 text-xs uppercase tracking-widest font-semibold text-muted mb-2">
                            <UserRound className="w-3.5 h-3.5" />
                            {t('expiredAccess.mediaAccess')}
                        </div>
                        <p className="text-lg font-bold text-red-300 capitalize">
                            {String(expired.plexAccessStatus || account.plexAccessStatus || 'revoked')}
                        </p>
                    </div>
                </div>

                <div className="mt-6 flex flex-col sm:flex-row flex-wrap gap-2">
                    {supportEnabled && (
                        <button
                            type="button"
                            onClick={() => onNavigate('support')}
                            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-plex text-background font-bold hover:bg-plex-hover transition-colors"
                        >
                            <LifeBuoy className="w-4 h-4" />
                            {t('expiredAccess.openSupport')}
                        </button>
                    )}
                    {chatEnabled && (
                        <button
                            type="button"
                            onClick={() => onNavigate('chat')}
                            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-border text-text font-semibold hover:bg-white/5 transition-colors"
                        >
                            <MessageCircle className="w-4 h-4" />
                            {t('navigation.chat')}
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={() => onNavigate('profile')}
                        className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-border text-text font-semibold hover:bg-white/5 transition-colors"
                    >
                        <UserRound className="w-4 h-4" />
                        {t('navigation.profile')}
                    </button>
                    {contactEmail && (
                        <a
                            href={`mailto:${encodeURIComponent(contactEmail)}`}
                            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-border text-text font-semibold hover:bg-white/5 transition-colors"
                        >
                            <Mail className="w-4 h-4" />
                            {t('expiredAccess.emailAdmin')}
                        </a>
                    )}
                    {contactWhatsApp && (
                        <a
                            href={contactWhatsApp.startsWith('http') ? contactWhatsApp : `https://wa.me/${contactWhatsApp.replace(/\D/g, '')}`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-border text-text font-semibold hover:bg-white/5 transition-colors"
                        >
                            <MessageCircle className="w-4 h-4" />
                            WhatsApp
                        </a>
                    )}
                    <button
                        type="button"
                        onClick={onLogout}
                        className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-border text-muted hover:text-text hover:bg-white/5 transition-colors sm:ml-auto"
                    >
                        <LogOut className="w-4 h-4" />
                        {t('navigation.logout')}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ExpiredAccessPage;
