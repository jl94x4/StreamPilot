import React, { useState } from 'react';
import { apiFetch } from '../shared/api';
import { useDiscoverI18n } from '../discovery/i18n';
import { formatDate } from '../shared/format';

type Candidate = {
    id: string;
    username: string;
    email: string;
    lastWatched: string | null;
    neverWatched: boolean;
    joinedAt: string | null;
};

type PreviewResponse = {
    thresholdDays: number;
    cutoff?: string;
    candidates: Candidate[];
    skipped?: { exempt: number; notActive: number; noAccountId: number; historyError: number };
    error?: string;
};

export const CleanupInactivePreview: React.FC<{
    days: number;
    addToast: (msg: string, type?: 'success' | 'error') => void;
}> = ({ days, addToast }) => {
    const { t } = useDiscoverI18n();
    const [loading, setLoading] = useState(false);
    const [preview, setPreview] = useState<PreviewResponse | null>(null);

    const runPreview = async () => {
        setLoading(true);
        try {
            const data = await apiFetch(`/api/cleanup/inactive/preview?days=${encodeURIComponent(String(days || 90))}`);
            setPreview(data);
        } catch (e: any) {
            setPreview(null);
            addToast(e.message || t('settings.cleanup.failed'), 'error');
        } finally {
            setLoading(false);
        }
    };

    const skipped = preview?.skipped;
    const skippedParts = skipped
        ? t('settings.cleanup.skipped', {
            exempt: skipped.exempt || 0,
            notActive: skipped.notActive || 0,
            noAccountId: skipped.noAccountId || 0,
        })
        : '';

    return (
        <div className="mt-8 pt-6 border-t border-border/60">
            <h4 className="font-bold text-text mb-1">{t('settings.cleanup.previewTitle')}</h4>
            <p className="text-sm text-muted mb-4">{t('settings.cleanup.previewHint')}</p>
            <button
                type="button"
                className="px-4 py-2.5 bg-border text-text rounded-lg font-bold hover:bg-opacity-80 transition-colors disabled:opacity-50"
                onClick={runPreview}
                disabled={loading || !days}
            >
                {loading ? t('settings.cleanup.previewLoading') : t('settings.cleanup.previewButton')}
            </button>
            {preview && (
                <div className="mt-4">
                    <p className="text-sm font-semibold text-text mb-2">
                        {t('settings.cleanup.previewCount', { count: preview.candidates?.length || 0 })}
                    </p>
                    {skippedParts && <p className="text-xs text-muted mb-3">{skippedParts}</p>}
                    {(preview.candidates || []).length === 0 ? (
                        <p className="text-sm text-muted">{t('settings.cleanup.previewEmpty')}</p>
                    ) : (
                        <div className="max-h-72 overflow-y-auto rounded-xl border border-border/60 divide-y divide-border/40">
                            {preview.candidates.map((user) => (
                                <div key={user.id} className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2.5 text-sm">
                                    <div className="min-w-0">
                                        <div className="font-medium text-text truncate">{user.username}</div>
                                        {user.email ? <div className="text-xs text-muted truncate">{user.email}</div> : null}
                                    </div>
                                    <div className="text-xs text-muted text-right">
                                        <div>
                                            {t('settings.cleanup.lastWatched')}: {user.neverWatched || !user.lastWatched
                                                ? t('settings.cleanup.neverWatched')
                                                : formatDate(user.lastWatched)}
                                        </div>
                                        {user.joinedAt && (
                                            <div>{t('settings.cleanup.joined')}: {formatDate(user.joinedAt)}</div>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
