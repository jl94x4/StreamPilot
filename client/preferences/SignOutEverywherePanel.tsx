import React, { useState } from 'react';
import { LogOut } from 'lucide-react';
import { apiFetch } from '../shared/api';
import { portalUrl } from '../shared/basePath';
import { DashboardPanel } from '../shared/dashboard/DashboardChrome';
import { useDiscoverI18n } from '../discovery/i18n';

/** Ends every session of this account: browsers, the TV app and installed apps. */
export const SignOutEverywherePanel: React.FC<{ onError: (message: string) => void }> = ({ onError }) => {
    const { t } = useDiscoverI18n();
    const [busy, setBusy] = useState(false);

    const signOut = async () => {
        if (!window.confirm(t('preferencesPage.signOutEverywhereConfirm'))) return;
        setBusy(true);
        try {
            await apiFetch('/api/auth/logout-all', { method: 'POST' });
            window.location.href = portalUrl('/');
        } catch (err: any) {
            onError(String(err?.message || t('preferencesPage.signOutEverywhereFailed')));
            setBusy(false);
        }
    };

    return (
        <DashboardPanel title={t('preferencesPage.signOutEverywhereTitle')} subtitle={t('preferencesPage.signOutEverywhereHint')}>
            <button
                type="button"
                onClick={signOut}
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-xl border border-red-500/40 px-4 py-2.5 text-sm font-bold text-red-400 hover:bg-red-500/10 disabled:opacity-60"
            >
                <LogOut className="w-4 h-4" />
                {t('preferencesPage.signOutEverywhere')}
            </button>
        </DashboardPanel>
    );
};
