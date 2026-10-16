import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { ToastMessage } from './types';

export const MAX_VISIBLE_TOASTS = 3;
/** Success/error toasts auto-dismiss after this many ms (timer must not reset on parent re-renders). */
export const TOAST_DISMISS_MS = 2500;

export const pushToast = (prev: ToastMessage[], message: string, type: 'success' | 'error'): ToastMessage[] => {
    const next = [...prev, { id: Date.now() + Math.random(), message, type }];
    return next.length > MAX_VISIBLE_TOASTS ? next.slice(-MAX_VISIBLE_TOASTS) : next;
};

export const Toast: React.FC<{ message: string; type: 'success' | 'error'; onDismiss: () => void }> = ({ message, type, onDismiss }) => {
    const [isVisible, setIsVisible] = useState(false);
    const onDismissRef = useRef(onDismiss);
    onDismissRef.current = onDismiss;

    useEffect(() => {
        const animTimer = setTimeout(() => setIsVisible(true), 50);
        // Intentionally empty deps: Media Automation (and others) re-render often while polling;
        // tying the timer to onDismiss would reset it forever and leave toasts stuck on screen.
        const timer = setTimeout(() => onDismissRef.current(), TOAST_DISMISS_MS);
        return () => {
            clearTimeout(animTimer);
            clearTimeout(timer);
        };
    }, []);

    return (
        <div
            className={`px-3 py-2 rounded-lg text-white text-sm font-medium shadow-lg transition-all duration-300 transform ${isVisible ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'
                } ${type === 'success' ? 'bg-green-600' : 'bg-red-600'}`}
        >
            {message}
        </div>
    );
};

/** Portaled to body above modal overlays (z-1200+) so toasts stay readable. */
export const ToastContainer: React.FC<{ toasts: ToastMessage[]; setToasts: React.Dispatch<React.SetStateAction<ToastMessage[]>> }> = ({ toasts, setToasts }) => {
    if (typeof document === 'undefined' || toasts.length === 0) return null;
    return createPortal(
        <div className="pointer-events-none fixed z-[5000] flex flex-col-reverse gap-1.5 w-[min(18rem,calc(100vw-2rem))] bottom-[calc(4.25rem+env(safe-area-inset-bottom,0px))] left-1/2 -translate-x-1/2 md:bottom-auto md:left-auto md:translate-x-0 md:top-4 md:right-4">
            {toasts.map(toast => (
                <div key={toast.id} className="pointer-events-auto">
                    <Toast {...toast} onDismiss={() => setToasts(t => t.filter(item => item.id !== toast.id))} />
                </div>
            ))}
        </div>,
        document.body,
    );
};

export const Loader: React.FC<{ isLoading: boolean; isCinematic?: boolean }> = ({ isLoading, isCinematic }) => {
    if (!isLoading) return null;
    return (
        <div className={`fixed inset-0 ${isCinematic ? 'bg-black/90' : 'bg-black/50 backdrop-blur-sm'} flex justify-center items-center z-[3000]`}>
            {isCinematic ? (
                <div className="flex flex-col items-center">
                    <svg width="100" height="100" viewBox="0 0 100 100" className="animate-pulse">
                        <path 
                            style={{ animation: 'cinematic-draw 2s infinite cubic-bezier(0.4, 0, 0.2, 1)' }}
                            d="M 30 20 L 80 50 L 30 80 Z" 
                            fill="none" 
                            stroke="var(--plex-color, #e5a00d)" 
                            strokeWidth="3" 
                            strokeLinejoin="round" 
                            strokeLinecap="round" 
                        />
                        <path 
                            d="M 30 20 L 80 50 L 30 80 Z" 
                            fill="var(--plex-color, #e5a00d)" 
                            className="animate-pulse opacity-50" 
                        />
                    </svg>
                    <div className="mt-8 tracking-[0.4em] uppercase text-xs text-plex font-bold animate-pulse drop-shadow-[0_0_8px_rgba(229,160,13,0.8)]">Loading</div>
                </div>
            ) : (
                <div className="border-4 border-border border-t-plex rounded-full w-12 h-12 animate-spin shadow-[0_0_15px_rgba(229,160,13,0.5)]"></div>
            )}
        </div>
    );
};

export type { ToastMessage };
