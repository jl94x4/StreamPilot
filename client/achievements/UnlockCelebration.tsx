import React, { useEffect, useMemo, useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import { ModalPortal } from '../shared/ModalPortal';
import { tAchievements, useAchievementsI18n } from './i18n';

type Props = {
    badges: Array<{ id?: string; name?: string; icon?: string }>;
    onClose: () => void;
};

const CONFETTI_COLORS = ['#e5a00d', '#38bdf8', '#a78bfa', '#34d399', '#f472b6', '#fb923c', '#f87171'];

/** Full-screen unlock moment with lightweight CSS confetti. Respect mute at call site. */
export const UnlockCelebration: React.FC<Props> = ({ badges, onClose }) => {
    const { tAchievements } = useAchievementsI18n();
    const [visible, setVisible] = useState(true);
    const pieces = useMemo(
        () => Array.from({ length: 36 }, (_, i) => ({
            id: i,
            left: `${(i * 17 + 5) % 100}%`,
            delay: `${(i % 12) * 0.08}s`,
            duration: `${2.2 + (i % 5) * 0.25}s`,
            color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
            rotate: `${(i * 37) % 360}deg`,
            size: 6 + (i % 4) * 2,
        })),
        [],
    );

    useEffect(() => {
        const timer = window.setTimeout(() => {
            setVisible(false);
            onClose();
        }, 4200);
        return () => window.clearTimeout(timer);
    }, [onClose]);

    if (!visible || !badges.length) return null;

    const primary = badges[0];
    const extras = badges.length - 1;

    return (
        <ModalPortal open={true}>
            <div className="fixed inset-0 z-[340] flex items-center justify-center p-4 pointer-events-none">
                <div className="absolute inset-0 bg-black/55 backdrop-blur-[2px] pointer-events-auto" onClick={() => { setVisible(false); onClose(); }} />
                <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
                    {pieces.map((p) => (
                        <span
                            key={p.id}
                            className="absolute top-[-12px] rounded-sm opacity-90 animate-[achUnlockFall_linear_forwards]"
                            style={{
                                left: p.left,
                                width: p.size,
                                height: p.size * 1.4,
                                background: p.color,
                                transform: `rotate(${p.rotate})`,
                                animationDelay: p.delay,
                                animationDuration: p.duration,
                            }}
                        />
                    ))}
                </div>
                <div
                    className="relative pointer-events-auto w-full max-w-sm rounded-3xl border border-plex/40 shadow-[0_24px_80px_rgba(0,0,0,0.55)] overflow-hidden text-center animate-[achUnlockPop_0.45s_ease-out]"
                    style={{ backgroundColor: '#12141a' }}
                >
                    <div
                        className="absolute inset-0"
                        style={{ backgroundColor: 'rgb(var(--color-card))' }}
                        aria-hidden
                    />
                    <div className="relative z-[1] p-6">
                    <button
                        type="button"
                        onClick={() => { setVisible(false); onClose(); }}
                        className="absolute top-3 right-3 p-2 rounded-xl text-muted hover:text-text hover:bg-white/5"
                        aria-label={tAchievements('common.close')}
                    >
                        <X className="w-4 h-4" />
                    </button>
                    <p className="text-[10px] uppercase tracking-[0.28em] text-plex font-bold mb-3 flex items-center justify-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5" />
                        {tAchievements('celebrate.eyebrow')}
                    </p>
                    <div className="text-5xl leading-none mb-3">{primary?.icon || '🏅'}</div>
                    <h3 className="text-xl font-black text-text">{primary?.name || tAchievements('celebrate.badge')}</h3>
                    <p className="text-sm text-muted mt-2">
                        {extras > 0
                            ? tAchievements('celebrate.more', { count: extras })
                            : tAchievements('celebrate.subtitle')}
                    </p>
                    </div>
                </div>
                <style>{`
                    @keyframes achUnlockFall {
                        0% { transform: translateY(-10vh) rotate(0deg); opacity: 1; }
                        100% { transform: translateY(110vh) rotate(720deg); opacity: 0.35; }
                    }
                    @keyframes achUnlockPop {
                        0% { transform: scale(0.86); opacity: 0; }
                        100% { transform: scale(1); opacity: 1; }
                    }
                `}</style>
            </div>
        </ModalPortal>
    );
};
