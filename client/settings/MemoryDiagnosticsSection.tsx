import React, { useMemo } from 'react';
import { Activity, HardDrive, Layers } from 'lucide-react';
import { getSettingsSectionElementId } from './settingsIndex';

type MemoryUsageMB = {
    rss?: number;
    heapTotal?: number;
    heapUsed?: number;
    external?: number;
    arrayBuffers?: number;
    unaccounted?: number;
};

type CacheStat = { size?: number; maxEntries?: number | null; name?: string; inflight?: number };
type DiskCacheStat = { exists?: boolean; size?: number; modifiedAt?: string | null };

type DiagnosticsPayload = {
    app?: {
        memoryRssMB?: number;
        memoryHeapUsedMB?: number;
        uptimeSeconds?: number;
        memoryUsageMB?: MemoryUsageMB;
        os?: { totalMemMB?: number; freeMemMB?: number };
        memoryCaches?: Record<string, CacheStat | Record<string, CacheStat>>;
        allocator?: { jemalloc?: boolean; mallocArenaMax?: string | null };
    };
    caches?: Record<string, DiskCacheStat>;
    checkedAt?: string;
};

const formatUptime = (seconds = 0) => {
    const s = Math.max(0, Math.floor(Number(seconds) || 0));
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ${s % 60}s`;
    const h = Math.floor(m / 60);
    if (h < 48) return `${h}h ${m % 60}m`;
    const d = Math.floor(h / 24);
    return `${d}d ${h % 24}h`;
};

const formatDiskSize = (bytes = 0) => {
    const n = Number(bytes) || 0;
    if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
    if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${n} B`;
};

const memoryStatus = (rssMb = 0) => {
    if (rssMb >= 3000) return { label: 'High', className: 'bg-red-500/20 text-red-300' };
    if (rssMb >= 1500) return { label: 'Elevated', className: 'bg-amber-500/20 text-amber-300' };
    return { label: 'Normal', className: 'bg-green-500/20 text-green-300' };
};

const flattenMemoryCaches = (memoryCaches: DiagnosticsPayload['app']['memoryCaches']) => {
    const rows: { name: string; size: number; max: number | null; detail?: string }[] = [];
    for (const [key, val] of Object.entries(memoryCaches || {})) {
        if (key === 'pageSwr' && val && typeof val === 'object') {
            for (const [swrKey, swrVal] of Object.entries(val as Record<string, CacheStat>)) {
                const s = swrVal || {};
                const inflight = Number(s.inflight) || 0;
                rows.push({
                    name: `SWR · ${s.name || swrKey}`,
                    size: Number(s.size) || 0,
                    max: s.maxEntries ?? null,
                    detail: inflight > 0 ? `${inflight} inflight` : undefined,
                });
            }
            continue;
        }
        if (val && typeof val === 'object' && 'size' in val) {
            const v = val as CacheStat;
            rows.push({
                name: key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()).trim(),
                size: Number(v.size) || 0,
                max: v.maxEntries ?? null,
            });
        }
    }
    return rows.sort((a, b) => b.size - a.size);
};

type MemoryDiagnosticsSectionProps = {
    diagnostics: DiagnosticsPayload | null;
    isLoading: boolean;
    onRefresh: () => void;
};

export const MemoryDiagnosticsSection: React.FC<MemoryDiagnosticsSectionProps> = ({
    diagnostics,
    isLoading,
    onRefresh,
}) => {
    const app = diagnostics?.app;
    const mem = app?.memoryUsageMB || {};
    const rss = mem.rss ?? app?.memoryRssMB ?? 0;
    const status = memoryStatus(rss);

    const barSegments = useMemo(() => {
        const total = Math.max(rss, 1);
        const heapUsed = Math.max(0, Number(mem.heapUsed) || 0);
        const external = Math.max(0, Number(mem.external) || 0);
        const unaccounted = Math.max(0, Number(mem.unaccounted) || 0);
        const rawSum = heapUsed + external + unaccounted;
        const scale = rawSum > total ? total / rawSum : 1;
        return [
            { key: 'heap', label: 'JS heap (in use)', mb: heapUsed, pct: (heapUsed * scale / total) * 100, className: 'bg-plex' },
            { key: 'external', label: 'Buffers / external', mb: external, pct: (external * scale / total) * 100, className: 'bg-sky-500' },
            { key: 'other', label: 'Other (native / fragmentation)', mb: unaccounted, pct: (unaccounted * scale / total) * 100, className: 'bg-amber-500' },
        ].filter((seg) => seg.mb > 0);
    }, [mem, rss]);

    const cacheRows = useMemo(() => flattenMemoryCaches(app?.memoryCaches), [app?.memoryCaches]);

    const diskCaches = useMemo(() => (
        Object.entries(diagnostics?.caches || {})
            .filter(([, entry]) => entry?.exists)
            .map(([name, entry]) => ({
                name: name.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()).trim(),
                size: formatDiskSize(entry?.size),
                modifiedAt: entry?.modifiedAt,
            }))
            .sort((a, b) => a.name.localeCompare(b.name))
    ), [diagnostics?.caches]);

    return (
        <section id={getSettingsSectionElementId('memory')} className="space-y-4 mb-8 scroll-mt-24">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                    <Activity className="w-4 h-4 text-plex" />
                    <h4 className="font-bold text-text">Memory</h4>
                    {diagnostics ? (
                        <span className={`text-xs px-2 py-0.5 rounded font-bold ${status.className}`}>
                            {status.label}
                        </span>
                    ) : null}
                </div>
                <button
                    type="button"
                    className="px-3 py-1.5 bg-border text-text rounded-md font-semibold hover:bg-opacity-80 disabled:opacity-50"
                    onClick={onRefresh}
                    disabled={isLoading}
                >
                    {isLoading ? 'Refreshing…' : 'Refresh'}
                </button>
            </div>

            {!diagnostics ? (
                <p className="text-sm text-muted">No memory data yet. Click Refresh to load diagnostics.</p>
            ) : (
                <div className="space-y-5">
                    <p className="text-xs text-muted leading-relaxed">
                        <strong className="text-text">Total (RSS)</strong> is what Docker and your host see — all RAM held by this process.
                        Compare it to <strong className="text-text">JS heap</strong> below: if Total is much higher than heap, growth is likely buffers, native code, or fragmentation—not just JavaScript objects.
                        {app?.allocator ? (
                            <>
                                {' '}Allocator: <strong className="text-text">{app.allocator.jemalloc ? 'jemalloc' : 'glibc'}</strong>
                                {app.allocator.jemalloc
                                    ? ' — freed RAM can return to the host.'
                                    : ' — rebuild the container image to enable jemalloc so RSS can shrink after spikes.'}
                            </>
                        ) : null}
                    </p>

                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                        <div className="rounded-xl border border-border/60 bg-background/40 p-4">
                            <p className="text-xs text-muted mb-1">Total process memory (RSS)</p>
                            <p className="text-2xl font-black text-text tabular-nums">{rss} MB</p>
                            <p className="text-[11px] text-muted mt-1">Matches <code className="text-text/80">docker stats</code></p>
                        </div>
                        <div className="rounded-xl border border-border/60 bg-background/40 p-4">
                            <p className="text-xs text-muted mb-1">JS heap in use</p>
                            <p className="text-2xl font-black text-text tabular-nums">{mem.heapUsed ?? app?.memoryHeapUsedMB ?? 0} MB</p>
                            <p className="text-[11px] text-muted mt-1">V8 objects & strings</p>
                        </div>
                        <div className="rounded-xl border border-border/60 bg-background/40 p-4">
                            <p className="text-xs text-muted mb-1">Uptime</p>
                            <p className="text-2xl font-black text-text">{formatUptime(app?.uptimeSeconds)}</p>
                            <p className="text-[11px] text-muted mt-1">Since last container start</p>
                        </div>
                        <div className="rounded-xl border border-border/60 bg-background/40 p-4">
                            <p className="text-xs text-muted mb-1">Host free RAM</p>
                            <p className="text-2xl font-black text-text tabular-nums">
                                {app?.os?.freeMemMB ?? '—'} MB
                            </p>
                            <p className="text-[11px] text-muted mt-1">
                                of {app?.os?.totalMemMB ?? '—'} MB total
                            </p>
                        </div>
                    </div>

                    {barSegments.length > 0 ? (
                        <div className="rounded-xl border border-border/60 bg-background/40 p-4 space-y-3">
                            <p className="text-xs font-semibold text-muted uppercase tracking-wider">Where RSS goes (approx.)</p>
                            <div className="flex h-3 rounded-full overflow-hidden bg-white/5 border border-white/10">
                                {barSegments.map((seg) => (
                                    <div
                                        key={seg.key}
                                        className={`${seg.className} h-full min-w-[2px]`}
                                        style={{ width: `${Math.max(seg.pct, seg.mb > 0 ? 2 : 0)}%` }}
                                        title={`${seg.label}: ${seg.mb} MB`}
                                    />
                                ))}
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                                {barSegments.map((seg) => (
                                    <div key={seg.key} className="flex items-center gap-2">
                                        <span className={`w-2.5 h-2.5 rounded-sm shrink-0 ${seg.className}`} />
                                        <span className="text-muted">{seg.label}</span>
                                        <span className="font-mono text-text tabular-nums">{seg.mb} MB</span>
                                    </div>
                                ))}
                            </div>
                            {(mem.arrayBuffers ?? 0) > 0 ? (
                                <p className="text-[11px] text-muted">
                                    Array buffers: <span className="font-mono text-text">{mem.arrayBuffers} MB</span>
                                    {' · '}
                                    Heap allocated: <span className="font-mono text-text">{mem.heapTotal ?? '—'} MB</span>
                                </p>
                            ) : null}
                        </div>
                    ) : null}

                    <div className="rounded-xl border border-border/60 bg-background/40 p-4 space-y-3">
                        <div className="flex items-center gap-2">
                            <Layers className="w-4 h-4 text-plex" />
                            <p className="text-xs font-semibold text-muted uppercase tracking-wider">In-memory caches</p>
                        </div>
                        {cacheRows.length === 0 ? (
                            <p className="text-sm text-muted">No cache stats available.</p>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="text-left text-xs text-muted border-b border-border/40">
                                            <th className="py-2 pr-4 font-semibold">Cache</th>
                                            <th className="py-2 pr-4 font-semibold text-right">Entries</th>
                                            <th className="py-2 font-semibold text-right">Limit</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {cacheRows.map((row) => (
                                            <tr key={row.name} className="border-b border-border/20 last:border-0">
                                                <td className="py-1.5 pr-4 text-text">
                                                    {row.name}
                                                    {row.detail ? (
                                                        <span className="text-muted text-xs ml-1">({row.detail})</span>
                                                    ) : null}
                                                </td>
                                                <td className="py-1.5 pr-4 text-right font-mono tabular-nums">{row.size}</td>
                                                <td className="py-1.5 text-right font-mono tabular-nums text-muted">
                                                    {row.max != null ? row.max : '—'}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                        <p className="text-[11px] text-muted">
                            Entry counts only — not bytes. A cache near its limit may still be healthy; a small count with huge RSS points elsewhere (buffers, startup jobs, embed proxy).
                        </p>
                    </div>

                    {diskCaches.length > 0 ? (
                        <div className="rounded-xl border border-border/60 bg-background/40 p-4 space-y-3">
                            <div className="flex items-center gap-2">
                                <HardDrive className="w-4 h-4 text-plex" />
                                <p className="text-xs font-semibold text-muted uppercase tracking-wider">On-disk cache files</p>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="text-left text-xs text-muted border-b border-border/40">
                                            <th className="py-2 pr-4 font-semibold">File</th>
                                            <th className="py-2 pr-4 font-semibold text-right">Size</th>
                                            <th className="py-2 font-semibold text-right">Updated</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {diskCaches.map((row) => (
                                            <tr key={row.name} className="border-b border-border/20 last:border-0">
                                                <td className="py-1.5 pr-4 text-text">{row.name}</td>
                                                <td className="py-1.5 pr-4 text-right font-mono tabular-nums">{row.size}</td>
                                                <td className="py-1.5 text-right text-xs text-muted">
                                                    {row.modifiedAt ? new Date(row.modifiedAt).toLocaleString() : '—'}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    ) : null}

                    {diagnostics.checkedAt ? (
                        <p className="text-[11px] text-muted">
                            Snapshot taken {new Date(diagnostics.checkedAt).toLocaleString()}
                        </p>
                    ) : null}
                </div>
            )}
        </section>
    );
};
