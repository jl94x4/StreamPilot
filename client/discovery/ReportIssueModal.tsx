import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Loader2, X } from 'lucide-react';
import { apiFetch } from '../shared/api';
import { ModalPortal } from '../shared/ModalPortal';
import { ISSUE_TYPE_OPTIONS } from './issueUtils';
import { useDiscoverI18n } from './i18n';

type Props = {
    open: boolean;
    mediaType: 'movie' | 'tv';
    title: string;
    seerrMediaId?: number | null;
    tmdbId?: number | null;
    onClose: () => void;
    onSuccess: (message: string) => void;
    onError: (message: string) => void;
};

export const ReportIssueModal: React.FC<Props> = ({
    open,
    mediaType,
    title,
    seerrMediaId,
    tmdbId,
    onClose,
    onSuccess,
    onError,
}) => {
    const { t } = useDiscoverI18n();
    const [issueType, setIssueType] = useState<number>(ISSUE_TYPE_OPTIONS[0].value);
    const [message, setMessage] = useState('');
    const [problemSeason, setProblemSeason] = useState('');
    const [problemEpisode, setProblemEpisode] = useState('');
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        if (!open) return undefined;
        setIssueType(ISSUE_TYPE_OPTIONS[0].value);
        setMessage('');
        setProblemSeason('');
        setProblemEpisode('');
        return undefined;
    }, [open, seerrMediaId, tmdbId]);

    useEffect(() => {
        if (!open) return undefined;
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && !submitting) onClose();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, onClose, submitting]);

    const canSubmit = useMemo(() => message.trim().length >= 3 && !submitting, [message, submitting]);

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!canSubmit) return;
        setSubmitting(true);
        try {
            const body: Record<string, unknown> = {
                mediaType,
                issueType,
                message: message.trim(),
            };
            if (Number.isFinite(Number(tmdbId)) && Number(tmdbId) > 0) {
                body.tmdbId = Number(tmdbId);
            }
            if (Number.isFinite(Number(seerrMediaId)) && Number(seerrMediaId) > 0) {
                body.mediaId = Number(seerrMediaId);
            }
            if (mediaType === 'tv' && problemSeason.trim()) {
                body.problemSeason = Number(problemSeason);
            }
            if (mediaType === 'tv' && problemEpisode.trim()) {
                body.problemEpisode = Number(problemEpisode);
            }

            const res = await apiFetch('/api/discovery/issues', {
                method: 'POST',
                body: JSON.stringify(body),
            });
            if (res?.error) throw new Error(res.error);
            onSuccess(res?.ticketId ? t('issues.reportedSuccessTicket') : t('issues.reportedSuccess'));
            onClose();
        } catch (e: any) {
            onError(e?.message || t('issues.reportFailed'));
        } finally {
            setSubmitting(false);
        }
    };

    if (!open) return null;

    return (
        <ModalPortal open={open}>
        <div className="fixed inset-x-0 top-0 z-[340] flex items-end sm:items-center justify-center p-0 sm:p-4 bottom-[calc(4rem+env(safe-area-inset-bottom,0px))] sm:inset-0 sm:bottom-0">
            <button
                type="button"
                aria-label={t('common.close')}
                className="absolute inset-0 bg-black/80 backdrop-blur-sm"
                onClick={() => { if (!submitting) onClose(); }}
            />
            <div className="relative w-full sm:max-w-lg max-h-[min(92dvh,calc(100dvh-5.5rem-env(safe-area-inset-top,0px)-env(safe-area-inset-bottom,0px)))] sm:max-h-[85vh] rounded-t-2xl sm:rounded-2xl border border-white/10 bg-card shadow-2xl overflow-hidden flex flex-col">
                <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-white/10">
                    <div className="flex items-center gap-2 min-w-0">
                        <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
                        <h2 className="text-lg font-black text-white truncate">{t('issues.modalTitle')}</h2>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={submitting}
                        className="p-2 rounded-lg text-white/50 hover:text-white hover:bg-white/5 transition-colors disabled:opacity-50"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-5 flex flex-col gap-4 overflow-y-auto custom-scrollbar flex-1 pb-4">
                    <div>
                        <p className="text-xs uppercase tracking-wider text-white/45 font-bold mb-1">{t('issues.titleLabel')}</p>
                        <p className="text-sm font-semibold text-white">{title}</p>
                    </div>

                    <div>
                        <label htmlFor="issue-type" className="block text-xs uppercase tracking-wider text-white/45 font-bold mb-2">
                            {t('issues.typeLabel')}
                        </label>
                        <select
                            id="issue-type"
                            value={issueType}
                            onChange={(e) => setIssueType(Number(e.target.value))}
                            className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white outline-none focus:border-plex focus:ring-1 focus:ring-plex"
                        >
                            {ISSUE_TYPE_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                    {t(`issues.issueType${option.label}`)}
                                </option>
                            ))}
                        </select>
                    </div>

                    {mediaType === 'tv' && (
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label htmlFor="issue-season" className="block text-xs uppercase tracking-wider text-white/45 font-bold mb-2">
                                    {t('issues.seasonOptional')}
                                </label>
                                <input
                                    id="issue-season"
                                    type="number"
                                    min={0}
                                    value={problemSeason}
                                    onChange={(e) => setProblemSeason(e.target.value)}
                                    className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white outline-none focus:border-plex focus:ring-1 focus:ring-plex"
                                    placeholder={t('issues.seasonPlaceholder')}
                                />
                            </div>
                            <div>
                                <label htmlFor="issue-episode" className="block text-xs uppercase tracking-wider text-white/45 font-bold mb-2">
                                    {t('issues.episodeOptional')}
                                </label>
                                <input
                                    id="issue-episode"
                                    type="number"
                                    min={0}
                                    value={problemEpisode}
                                    onChange={(e) => setProblemEpisode(e.target.value)}
                                    className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white outline-none focus:border-plex focus:ring-1 focus:ring-plex"
                                    placeholder={t('issues.episodePlaceholder')}
                                />
                            </div>
                        </div>
                    )}

                    <div>
                        <label htmlFor="issue-message" className="block text-xs uppercase tracking-wider text-white/45 font-bold mb-2">
                            {t('issues.describeProblem')}
                        </label>
                        <textarea
                            id="issue-message"
                            value={message}
                            onChange={(e) => setMessage(e.target.value)}
                            rows={4}
                            className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white outline-none focus:border-plex focus:ring-1 focus:ring-plex resize-y min-h-[6rem]"
                            placeholder={t('issues.messagePlaceholder')}
                        />
                    </div>

                    <div className="flex gap-3 pt-1">
                        <button
                            type="button"
                            disabled={submitting}
                            onClick={onClose}
                            className="flex-1 py-2.5 rounded-xl border border-white/10 text-white/70 font-bold hover:bg-white/5 transition-colors disabled:opacity-50"
                        >
                            {t('common.cancel')}
                        </button>
                        <button
                            type="submit"
                            disabled={!canSubmit}
                            className="flex-1 py-2.5 rounded-xl bg-plex text-black font-black hover:bg-plex-hover transition-colors disabled:opacity-50 inline-flex items-center justify-center gap-2"
                        >
                            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                            {t('issues.submitIssue')}
                        </button>
                    </div>
                </form>
            </div>
        </div>
        </ModalPortal>
    );
};
