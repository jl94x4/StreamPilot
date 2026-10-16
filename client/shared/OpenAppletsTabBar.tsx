import React, { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { resolvePortalAssetUrl } from './basePath';
import { resolveCustomNavIcon } from './customNavTabs';
import { sortOpenAppletSessionsByNavOrder, type OpenAppletSession } from './openApplets';
import type { CustomNavTab } from './types';
import { useDiscoverI18n } from '../discovery/i18n';

type Props = {
    sessions: OpenAppletSession[];
    activeId: string | null;
    customNavTabs: CustomNavTab[];
    navOrder?: string[];
    onActivate: (session: OpenAppletSession) => void;
    onClose: (id: string) => void;
    onCloseAll?: () => void;
};

const TabItem: React.FC<{
    session: OpenAppletSession;
    tab?: CustomNavTab;
    isActive: boolean;
    onActivate: () => void;
    onClose: () => void;
}> = ({ session, tab, isActive, onActivate, onClose }) => {
    const { t } = useDiscoverI18n();
    const name = tab?.name || session.id;
    const Icon = resolveCustomNavIcon(tab?.icon);
    const [logoFailed, setLogoFailed] = useState(false);
    const logoSrc = tab?.logoUrl && !logoFailed ? resolvePortalAssetUrl(tab.logoUrl) : '';

    return (
        <div
            className={`group relative flex max-w-[11rem] shrink-0 items-center rounded-lg border pr-1 transition-colors ${
                isActive
                    ? 'border-plex/50 bg-plex/10'
                    : 'border-white/10 bg-white/[0.04] hover:border-white/20 hover:bg-white/[0.07]'
            }`}
        >
            <button
                type="button"
                onClick={onActivate}
                onMouseDown={(event) => {
                    if (event.button === 1) {
                        event.preventDefault();
                        onClose();
                    }
                }}
                className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1.5 text-left"
                aria-current={isActive ? 'page' : undefined}
                title={name}
            >
                {logoSrc ? (
                    <img
                        src={logoSrc}
                        alt=""
                        className="h-4 w-4 shrink-0 object-contain"
                        onError={() => setLogoFailed(true)}
                    />
                ) : (
                    <Icon className="h-4 w-4 shrink-0 text-plex" />
                )}
                <span className={`truncate text-xs font-semibold ${isActive ? 'text-plex' : 'text-text/90'}`}>
                    {name}
                </span>
            </button>
            <button
                type="button"
                className="mr-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-muted opacity-70 transition-colors hover:bg-red-500/80 hover:text-white group-hover:opacity-100"
                onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onClose();
                }}
                aria-label={t('navigation.closeApplet', { name })}
                title={t('navigation.closeApplet', { name })}
            >
                <X className="h-3 w-3" />
            </button>
        </div>
    );
};

export const OpenAppletsTabBar: React.FC<Props> = ({
    sessions,
    activeId,
    customNavTabs,
    navOrder = [],
    onActivate,
    onClose,
    onCloseAll,
}) => {
    const { t } = useDiscoverI18n();
    const orderedSessions = useMemo(
        () => sortOpenAppletSessionsByNavOrder(sessions, navOrder),
        [navOrder, sessions],
    );
    const tabById = useMemo(
        () => new Map(customNavTabs.map((tab) => [String(tab.id), tab])),
        [customNavTabs],
    );

    if (orderedSessions.length <= 1) return null;

    return (
        <div
            className="mb-2 shrink-0 overflow-x-auto rounded-xl border border-white/10 bg-black/20 p-1.5 custom-scrollbar"
            role="tablist"
            aria-label={t('navigation.openAppletsTabs')}
        >
            <div className="flex min-w-min items-center gap-1.5">
                {orderedSessions.map((session) => (
                    <TabItem
                        key={session.id}
                        session={session}
                        tab={tabById.get(session.id)}
                        isActive={session.id === activeId}
                        onActivate={() => onActivate(session)}
                        onClose={() => onClose(session.id)}
                    />
                ))}
                {onCloseAll ? (
                    <button
                        type="button"
                        className="ml-auto shrink-0 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs font-semibold text-muted transition-colors hover:border-red-500/40 hover:bg-red-500/15 hover:text-red-200"
                        onClick={onCloseAll}
                        aria-label={t('navigation.closeAllApplets')}
                        title={t('navigation.closeAllApplets')}
                    >
                        {t('navigation.closeAllApplets')}
                    </button>
                ) : null}
            </div>
        </div>
    );
};
