import { Activity,BarChart3,BookOpen,Calendar,ClipboardList,ExternalLink,GitFork,Info,Shield,Users } from 'lucide-react';
import React from 'react';

import { useDiscoverI18n } from '../discovery/i18n';



const ABOUT_CONTRIBUTORS = [
    {
        id: 'primary',
        name: 'jl94x4',
        href: 'https://github.com/jl94x4',
        avatarUrl: 'https://github.com/jl94x4.png?size=128',
    },
    {
        id: 'integration',
        name: 'Nerdy-Technician',
        href: 'https://github.com/Nerdy-Technician',
        avatarUrl: 'https://github.com/Nerdy-Technician.png?size=128',
    },
];

const ABOUT_LINKS = [
    { id: 'documentation', href: 'https://jl94x4.github.io/StreamPilot/' },
    { id: 'githubRepository', href: 'https://github.com/jl94x4/StreamPilot' },
    { id: 'featureOverview', href: 'https://jl94x4.github.io/StreamPilot/features/overview.html' },
    { id: 'gettingStarted', href: 'https://jl94x4.github.io/StreamPilot/guide/getting-started.html' },
];

export const AboutDashboard: React.FC<{ appVersion?: string; mediaServerType?: string }> = ({ appVersion, mediaServerType = 'plex' }) => {
    const { t } = useDiscoverI18n();
    const providerLabel = String(mediaServerType || 'plex').toLowerCase() === 'jellyfin'
        ? 'Jellyfin'
        : String(mediaServerType || 'plex').toLowerCase() === 'emby'
            ? 'Emby'
            : 'Plex';
    const featurePillClass = 'rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-muted';
    return (
        <div className="w-full space-y-6 animate-fade-in">
            <div className="rounded-xl border border-border/70 bg-card/80 overflow-hidden shadow-2xl">
                <div className="p-6 sm:p-8 border-b border-border/70 bg-gradient-to-br from-white/10 via-transparent to-plex/10">
                    <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6">
                        <div className="min-w-0">
                            <div className="flex items-center gap-3 mb-4">
                                <span className="w-12 h-12 rounded-xl bg-plex/15 border border-plex/30 flex items-center justify-center">
                                    <Info className="w-6 h-6 text-plex" />
                                </span>
                                <div>
                                    <p className="text-xs uppercase tracking-[0.22em] text-muted font-bold">{t('about.eyebrow')}</p>
                                    <h1 className="text-3xl sm:text-4xl font-black text-text tracking-tight">StreamPilot</h1>
                                </div>
                            </div>
                            <p className="text-base sm:text-lg text-muted max-w-3xl leading-relaxed">
                                {t('about.description')}
                            </p>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-3 lg:w-72 flex-shrink-0">
                            <div className="rounded-lg border border-border bg-background/70 p-3">
                                <p className="text-[10px] uppercase tracking-[0.18em] text-muted">{t('about.currentMode')}</p>
                                <p className="mt-1 text-lg font-black text-text">{providerLabel}</p>
                            </div>
                            <div className="rounded-lg border border-border bg-background/70 p-3">
                                <p className="text-[10px] uppercase tracking-[0.18em] text-muted">{t('about.version')}</p>
                                <p className="mt-1 text-sm font-mono font-bold text-plex truncate">{appVersion || t('about.development')}</p>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="p-6 sm:p-8 grid grid-cols-1 xl:grid-cols-[1.35fr_0.65fr] gap-6">
                    <section className="space-y-5">
                        <div>
                            <h2 className="text-xl font-black text-text mb-3">{t('about.centralPlace')}</h2>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {[
                                    { id: 'access', icon: Users },
                                    { id: 'stats', icon: BarChart3 },
                                    { id: 'monitoring', icon: Activity },
                                    { id: 'requests', icon: ClipboardList },
                                    { id: 'mediaStack', icon: Calendar },
                                    { id: 'maintenance', icon: Shield },
                                ].map(({ id, icon: Icon }) => (
                                    <div key={id} className="rounded-lg border border-border bg-background/70 p-4">
                                        <div className="flex items-center gap-3 mb-2">
                                            <span className="w-9 h-9 rounded-lg bg-plex/10 border border-plex/20 flex items-center justify-center">
                                                <Icon className="w-4 h-4 text-plex" />
                                            </span>
                                            <h3 className="font-bold text-text">{t(`about.features.${id}.title`)}</h3>
                                        </div>
                                        <p className="text-sm text-muted leading-relaxed">{t(`about.features.${id}.description`)}</p>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="rounded-lg border border-border bg-background/70 p-4">
                            <h2 className="text-lg font-black text-text mb-3">{t('about.ecosystem.title')}</h2>
                            <div className="flex flex-wrap gap-2">
                                {['Plex', 'Jellyfin', 'Emby', 'Seerr', 'Jellyseerr', 'Ombi', 'Sonarr', 'Radarr', 'Tautulli', 'Jellystat', t('about.ecosystem.downloadClients')].map((item) => (
                                    <span key={item} className={featurePillClass}>{item}</span>
                                ))}
                            </div>
                        </div>
                    </section>

                    <aside className="space-y-5">
                        <section className="rounded-lg border border-border bg-background/70 p-4">
                            <div className="flex items-center gap-2 mb-4">
                                <GitFork className="w-5 h-5 text-plex" />
                                <h2 className="text-lg font-black text-text">{t('about.contributors.title')}</h2>
                            </div>
                            <div className="space-y-3">
                                {ABOUT_CONTRIBUTORS.map((contributor) => (
                                    <a
                                        key={contributor.name}
                                        href={contributor.href}
	                                        target="_blank"
	                                        rel="noopener noreferrer"
	                                        className="block rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 hover:border-plex/40 transition-colors p-3"
	                                    >
	                                        <div className="flex items-start gap-3">
	                                            <img
	                                                src={contributor.avatarUrl}
	                                                alt=""
	                                                className="w-12 h-12 rounded-full object-cover bg-background border border-white/10 flex-shrink-0"
	                                                loading="lazy"
	                                            />
	                                            <div className="min-w-0 flex-1">
	                                                <div className="flex items-center justify-between gap-3">
	                                                    <div className="min-w-0">
	                                                        <p className="font-bold text-text truncate">{contributor.name}</p>
                                                        <p className="text-xs text-plex font-bold">{t(`about.contributors.${contributor.id}.role`)}</p>
	                                                    </div>
	                                                    <ExternalLink className="w-4 h-4 text-muted flex-shrink-0" />
	                                                </div>
                                                <p className="mt-2 text-xs text-muted leading-relaxed">{t(`about.contributors.${contributor.id}.note`)}</p>
	                                            </div>
	                                        </div>
	                                    </a>
                                ))}
                            </div>
                        </section>

                        <section className="rounded-lg border border-border bg-background/70 p-4">
                            <div className="flex items-center gap-2 mb-4">
                                <BookOpen className="w-5 h-5 text-plex" />
                                <h2 className="text-lg font-black text-text">{t('about.links.title')}</h2>
                            </div>
                            <div className="space-y-2">
                                {ABOUT_LINKS.map((link) => (
                                    <a
                                        key={link.href}
                                        href={link.href}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 hover:border-plex/40 transition-colors px-3 py-2 text-sm font-semibold text-text"
                                    >
                                        <span>{t(`about.links.${link.id}`)}</span>
                                        <ExternalLink className="w-4 h-4 text-muted flex-shrink-0" />
                                    </a>
                                ))}
                            </div>
                        </section>
                    </aside>
                </div>
            </div>
        </div>
    );
};
