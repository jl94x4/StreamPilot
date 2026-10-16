import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { apiFetch } from '../shared/api';
import { portalUrl } from '../shared/basePath';
import { ModalPortal } from '../shared/ModalPortal';

export type HistoryStreamRow = {
    id?: string | null;
    user?: string;
    userThumb?: string | null;
    player?: string | null;
    platform?: string | null;
    product?: string | null;
    title?: string | null;
    transcodeDecision?: string | null;
};

type StreamCell = {
    label: string;
    source?: string | null;
    stream?: string | null;
    streamTone?: string | null;
};

type StreamSection = {
    id: string;
    label: string;
    rows: StreamCell[];
};

type StreamPayload = {
    title?: string | null;
    mediaType?: string | null;
    sections?: StreamSection[];
    error?: string;
};

const userThumbSrc = (thumb?: string | null) => {
    if (!thumb) return 'https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y';
    if (thumb.startsWith('http') || thumb.startsWith('/api/')) return thumb;
    return portalUrl(`/api/plex/image?path=${encodeURIComponent(thumb)}&width=64&height=64`);
};

const streamToneClass = (tone?: string | null) => {
    if (tone === 'transcode') return 'text-amber-200';
    if (tone === 'copy') return 'text-sky-200';
    if (tone === 'direct') return 'text-emerald-200';
    return 'text-text';
};

const prettyStream = (value?: string | null) => {
    const raw = String(value || '').replace(/[_-]+/g, ' ').trim();
    if (!raw) return null;
    return raw.replace(/\b\w/g, (char) => char.toUpperCase());
};

export const HistoryStreamInfoModal: React.FC<{
    row: HistoryStreamRow | null;
    onClose: () => void;
}> = ({ row, onClose }) => {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [data, setData] = useState<StreamPayload | null>(null);
    const open = Boolean(row);
    const rowId = String(row?.id || '').trim();

    useEffect(() => {
        if (!open) return undefined;
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, onClose]);

    useEffect(() => {
        if (!open) {
            setLoading(false);
            setError(null);
            setData(null);
            return undefined;
        }
        if (!rowId) {
            setLoading(false);
            setData(null);
            setError('Stream details need Tautulli history for this play.');
            return undefined;
        }

        let cancelled = false;
        setLoading(true);
        setError(null);
        setData(null);
        apiFetch(`/api/plex/analytics/history/${encodeURIComponent(rowId)}/stream`)
            .then((res) => {
                if (cancelled) return;
                if (res?.error) {
                    setError(String(res.error));
                    setData(null);
                    return;
                }
                setData(res);
            })
            .catch((err: any) => {
                if (!cancelled) setError(err?.message || 'Failed to load stream details');
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => { cancelled = true; };
    }, [open, rowId]);

    const title = row?.title || data?.title || 'Stream info';
    const playerLine = [row?.player, row?.platform, row?.product].filter(Boolean).join(' · ');
    const streamBadge = prettyStream(row?.transcodeDecision);
    const sections = Array.isArray(data?.sections) ? data.sections : [];

    return (
        <ModalPortal open={open}>
            <div
                className="fixed inset-x-0 top-0 z-[300] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/80 backdrop-blur-sm animate-fade-in overscroll-none bottom-[calc(4rem+env(safe-area-inset-bottom,0px))] sm:inset-0 sm:bottom-0"
                onClick={onClose}
            >
                <div
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="history-stream-info-title"
                    className="relative w-full sm:max-w-2xl lg:max-w-3xl max-h-full sm:max-h-[85vh] bg-card border border-white/10 rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden overscroll-contain"
                    onClick={(event) => event.stopPropagation()}
                >
                    <div className="flex items-start gap-4 p-5 border-b border-white/10 bg-black/20 shrink-0">
                        <div className="min-w-0 flex-1">
                            {row?.user ? (
                                <div className="inline-flex items-center gap-2 mb-2 rounded-full border border-white/10 bg-white/5 pl-1 pr-2.5 py-1">
                                    <img
                                        src={userThumbSrc(row.userThumb)}
                                        alt=""
                                        className="w-5 h-5 rounded-full object-cover"
                                        onError={(event) => {
                                            event.currentTarget.src = 'https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y';
                                        }}
                                    />
                                    <span className="text-[11px] font-bold text-white/80 truncate max-w-[14rem]">{row.user}</span>
                                </div>
                            ) : null}
                            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted mb-1">Stream info</p>
                            <h2 id="history-stream-info-title" className="text-xl sm:text-2xl font-black text-text leading-tight tracking-tight">
                                {title}
                            </h2>
                            {playerLine ? (
                                <p className="text-sm text-muted mt-1 truncate" title={playerLine}>{playerLine}</p>
                            ) : null}
                            {streamBadge ? (
                                <div className="mt-3">
                                    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                                        streamBadge.toLowerCase().includes('transcode')
                                            ? 'border-amber-400/30 bg-amber-500/15 text-amber-200'
                                            : streamBadge.toLowerCase().includes('direct stream')
                                                ? 'border-sky-400/30 bg-sky-500/15 text-sky-200'
                                                : 'border-emerald-400/30 bg-emerald-500/15 text-emerald-200'
                                    }`}>
                                        {streamBadge}
                                    </span>
                                </div>
                            ) : null}
                        </div>
                        <button
                            type="button"
                            onClick={onClose}
                            className="p-2 rounded-full hover:bg-white/10 text-white/45 hover:text-white transition-colors shrink-0"
                            aria-label="Close"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>

                    <div
                        data-modal-scroll=""
                        className="flex-1 min-h-0 overflow-y-auto overscroll-contain custom-scrollbar p-5"
                    >
                        {loading ? (
                            <p className="py-10 text-center text-sm text-muted">Loading stream details…</p>
                        ) : error ? (
                            <p className="py-10 text-center text-sm text-amber-200">{error}</p>
                        ) : sections.length === 0 ? (
                            <p className="py-10 text-center text-sm text-muted">No stream details were stored for this play.</p>
                        ) : (
                            <div className="overflow-x-auto rounded-xl border border-white/10">
                                <table className="w-full min-w-[32rem] border-collapse text-left">
                                    <thead>
                                        <tr className="border-b border-white/10 bg-black/30 text-[10px] font-bold uppercase tracking-[0.16em] text-muted">
                                            <th className="w-[28%] px-3 py-2.5 font-bold"></th>
                                            <th className="px-3 py-2.5 font-bold">Source details</th>
                                            <th className="px-3 py-2.5 font-bold">Stream details</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {sections.map((section) => (
                                            <React.Fragment key={section.id}>
                                                <tr className="bg-white/[0.03]">
                                                    <td colSpan={3} className="px-3 py-2 text-[10px] font-bold uppercase tracking-[0.18em] text-plex">
                                                        {section.label}
                                                    </td>
                                                </tr>
                                                {section.rows.map((item) => (
                                                    <tr key={`${section.id}-${item.label}`} className="border-t border-white/5 text-sm">
                                                        <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-muted whitespace-nowrap">
                                                            {item.label}
                                                        </th>
                                                        <td className="px-3 py-2 text-text/90 font-medium">{item.source || ''}</td>
                                                        <td className={`px-3 py-2 font-medium ${streamToneClass(item.streamTone)}`}>
                                                            {item.stream || ''}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </React.Fragment>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </ModalPortal>
    );
};
