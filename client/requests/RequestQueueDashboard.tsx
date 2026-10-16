import React, { useEffect, useState } from 'react';
import { AlertTriangle, Ban, ClipboardList } from 'lucide-react';
import {
    DashboardHero,
    DashboardPageShell,
    DashboardSubnav,
    dashboardSubnavLinkClass,
} from '../shared/dashboard/DashboardChrome';
import { RequestsAdminPanel } from './RequestsAdminPanel';
import { IssuesAdminPanel } from './IssuesAdminPanel';
import { BlocklistAdminPanel } from './BlocklistAdminPanel';
import { useDiscoverI18n } from '../discovery/i18n';

type QueueTab = 'requests' | 'issues' | 'blocklist';

type Props = {
    onCountsChange?: () => void;
    openIssueCount?: number;
    /** When true, skip page shell/hero (used as a Discover tab). */
    embedded?: boolean;
    navigate?: (path: string) => void;
};

const readReviewIdFromUrl = (): number | null => {
    if (typeof window === 'undefined') return null;
    const raw = new URLSearchParams(window.location.search).get('review');
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

export const RequestQueueDashboard: React.FC<Props> = ({ onCountsChange, openIssueCount = 0, embedded = false, navigate }) => {
    const { t } = useDiscoverI18n();
    const [tab, setTab] = useState<QueueTab>('requests');
    const [reviewRequestId, setReviewRequestId] = useState<number | null>(() => readReviewIdFromUrl());

    useEffect(() => {
        const syncFromUrl = (event?: Event) => {
            const detailId = Number((event as CustomEvent)?.detail?.reviewId);
            if (Number.isFinite(detailId) && detailId > 0) {
                setReviewRequestId(detailId);
                setTab('requests');
                return;
            }
            const fromUrl = readReviewIdFromUrl();
            setReviewRequestId(fromUrl);
            if (fromUrl) setTab('requests');
        };
        window.addEventListener('popstate', syncFromUrl);
        window.addEventListener('portal-requests-navigate', syncFromUrl as EventListener);
        return () => {
            window.removeEventListener('popstate', syncFromUrl);
            window.removeEventListener('portal-requests-navigate', syncFromUrl as EventListener);
        };
    }, []);

    const body = (
        <>
            <DashboardSubnav className="!flex">
                <button
                    type="button"
                    onClick={() => setTab('requests')}
                    className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold whitespace-nowrap transition-colors ${dashboardSubnavLinkClass(tab === 'requests')}`}
                >
                    <ClipboardList className="h-4 w-4" />
                    {t('navigation.requests')}
                </button>
                <button
                    type="button"
                    onClick={() => setTab('issues')}
                    className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold whitespace-nowrap transition-colors ${dashboardSubnavLinkClass(tab === 'issues')}`}
                >
                    <AlertTriangle className="h-4 w-4" />
                    {t('requestsAdmin.page.issues')}
                    {openIssueCount > 0 && (
                        <span className="rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-black text-black">
                            {openIssueCount > 99 ? '99+' : openIssueCount}
                        </span>
                    )}
                </button>
                <button
                    type="button"
                    onClick={() => setTab('blocklist')}
                    className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold whitespace-nowrap transition-colors ${dashboardSubnavLinkClass(tab === 'blocklist')}`}
                >
                    <Ban className="h-4 w-4" />
                    {t('requestsAdmin.page.blocklist')}
                </button>
            </DashboardSubnav>

            {tab === 'requests' ? (
                <RequestsAdminPanel
                    onCountsChange={onCountsChange}
                    embedded
                    initialReviewId={reviewRequestId}
                    navigate={navigate}
                />
            ) : tab === 'issues' ? (
                <IssuesAdminPanel onCountsChange={onCountsChange} />
            ) : (
                <BlocklistAdminPanel />
            )}
        </>
    );

    if (embedded) {
        return <div className="w-full flex flex-col gap-4">{body}</div>;
    }

    return (
        <DashboardPageShell>
            <DashboardHero
                accent="amber"
                eyebrow={t('navigation.requests')}
                title={t('requestsAdmin.page.reviewQueue')}
                description={t('requestsAdmin.page.description')}
                icon={<ClipboardList className="h-3.5 w-3.5" />}
                secondaryBlob
            />
            {body}
        </DashboardPageShell>
    );
};
