import React from 'react';

const DAY_LABELS = ['', 'Mon', '', 'Wed', '', 'Fri', ''];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const ActivityHeatmap: React.FC<{ data: Record<string, number> }> = ({ data }) => {
    const days: { dateStr: string; count: number; date: Date }[] = [];
    const today = new Date();
    const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    const start = new Date(end);
    start.setDate(start.getDate() - 364);
    while (start.getDay() !== 0) {
        start.setDate(start.getDate() - 1);
    }

    const current = new Date(start);
    while (current <= end) {
        const dateStr = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}-${String(current.getDate()).padStart(2, '0')}`;
        const count = data ? (data[dateStr] || 0) : 0;
        days.push({ dateStr, count, date: new Date(current) });
        current.setDate(current.getDate() + 1);
    }

    const maxCount = (() => {
        if (!data) return 1;
        const vals = Object.values(data);
        return vals.length ? Math.max(...vals) : 1;
    })();

    const getIntensityClass = (count: number) => {
        if (count === 0) return 'bg-white/5 border border-white/5';
        const ratio = count / maxCount;
        if (ratio < 0.25) return 'bg-plex/30 border border-plex/20';
        if (ratio < 0.5) return 'bg-plex/50 border border-plex/40';
        if (ratio < 0.75) return 'bg-plex/75 border border-plex/60';
        return 'bg-plex border border-plex/80 shadow-[0_0_8px_rgba(229,160,13,0.5)]';
    };

    const weeks: typeof days[] = [];
    for (let i = 0; i < days.length; i += 7) {
        weeks.push(days.slice(i, i + 7));
    }
    const weekCount = weeks.length;
    const gridColumnSize = 'minmax(0, 1fr)';

    return (
        <div className="w-full min-w-0 flex flex-col gap-2 overflow-hidden">
            <div className="w-full min-w-0 overflow-hidden">
                <div className="flex gap-1.5 sm:gap-2 w-full min-w-0 items-stretch">
                    <div className="grid grid-rows-7 gap-[3px] shrink-0 w-6 sm:w-7 text-[9px] sm:text-[10px] text-muted font-semibold pt-5">
                        {DAY_LABELS.map((label, i) => (
                            <div key={i} className="flex items-center justify-end pr-0.5 min-h-0 leading-none">
                                {label}
                            </div>
                        ))}
                    </div>

                    <div className="flex-1 min-w-0 flex flex-col gap-1 overflow-hidden">
                        <div
                            className="grid gap-[3px] h-4 min-w-0"
                            style={{ gridTemplateColumns: `repeat(${weekCount}, ${gridColumnSize})` }}
                        >
                            {weeks.map((week, i) => {
                                const firstDay = week[0];
                                if (!firstDay) return <div key={i} className="relative h-4 min-w-0" />;
                                const prevMonth = weeks[i - 1]?.[0]?.date.getMonth();
                                const isNewMonth = i === 0 || firstDay.date.getMonth() !== prevMonth;
                                return (
                                    <div key={i} className="relative h-4 min-w-0 overflow-visible">
                                        {isNewMonth ? (
                                            <span
                                                className="absolute left-0 top-0 z-10 whitespace-nowrap text-[9px] sm:text-[10px] text-muted font-semibold leading-4 pointer-events-none"
                                            >
                                                {MONTHS[firstDay.date.getMonth()]}
                                            </span>
                                        ) : null}
                                    </div>
                                );
                            })}
                        </div>

                        <div
                            className="grid grid-rows-7 grid-flow-col gap-[3px] w-full min-w-0"
                            style={{ gridAutoColumns: gridColumnSize }}
                        >
                            {days.map((day) => (
                                <div
                                    key={day.dateStr}
                                    className={`aspect-square w-full min-w-0 rounded-[2px] sm:rounded-[3px] transition-colors duration-300 group relative ${getIntensityClass(day.count)}`}
                                >
                                    <div className="pointer-events-none absolute top-full left-1/2 z-[100] mt-1.5 -translate-x-1/2 whitespace-nowrap rounded border border-white/10 bg-black/95 px-2 py-1 text-[10px] font-mono text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                                        <span className="font-bold text-plex">{day.count} plays</span>
                                        {' '}
                                        <span className="text-muted">{day.dateStr}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            <div className="flex items-center justify-end gap-2 text-[10px] text-muted font-medium">
                <span>Less</span>
                <div className="flex gap-[3px]">
                    <div className="h-3 w-3 rounded-[2px] bg-white/5 border border-white/5 sm:h-[14px] sm:w-[14px] sm:rounded-[3px]" />
                    <div className="h-3 w-3 rounded-[2px] bg-plex/30 border border-plex/20 sm:h-[14px] sm:w-[14px] sm:rounded-[3px]" />
                    <div className="h-3 w-3 rounded-[2px] bg-plex/50 border border-plex/40 sm:h-[14px] sm:w-[14px] sm:rounded-[3px]" />
                    <div className="h-3 w-3 rounded-[2px] bg-plex/75 border border-plex/60 sm:h-[14px] sm:w-[14px] sm:rounded-[3px]" />
                    <div className="h-3 w-3 rounded-[2px] bg-plex border border-plex/80 sm:h-[14px] sm:w-[14px] sm:rounded-[3px]" />
                </div>
                <span>More</span>
            </div>
        </div>
    );
};
