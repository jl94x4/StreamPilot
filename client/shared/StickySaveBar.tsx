import React from 'react';

type Props = {
    children: React.ReactNode;
    className?: string;
};

export const StickySaveBar: React.FC<Props> = ({ children, className = '' }) => (
    <div className={`pointer-events-none sticky bottom-20 z-30 -mb-1 mt-8 flex justify-end md:bottom-5 ${className}`.trim()}>
        <div className="pointer-events-auto inline-flex max-w-full flex-wrap items-center justify-end gap-1.5 rounded-2xl border border-white/12 bg-card/80 p-1.5 shadow-[0_18px_50px_-16px_rgba(0,0,0,0.7)] ring-1 ring-inset ring-white/[0.07] backdrop-blur-xl">
            {children}
        </div>
    </div>
);
