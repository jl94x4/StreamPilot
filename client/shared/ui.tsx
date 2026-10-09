import React, { useState, useEffect, useRef, useLayoutEffect, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { Check, AlertTriangle } from 'lucide-react';
import { SettingHint } from '../settings/SettingHint';
import type { CustomSelectProps } from './types';

export type DropdownPosition = { top: number; left: number; width: number };

/** html { zoom } is used on Android TV. getBoundingClientRect is visual; position:fixed is layout. */
export const readDocumentZoom = () => {
    if (typeof document === 'undefined') return 1;
    const raw = String(
        document.documentElement.style.zoom
        || (typeof getComputedStyle === 'function' ? getComputedStyle(document.documentElement).zoom : '')
        || '1',
    );
    const n = Number.parseFloat(raw);
    return Number.isFinite(n) && n > 0 ? n : 1;
};

export const rectToFixedPixels = (rect: Pick<DOMRect, 'top' | 'left' | 'width' | 'height' | 'bottom' | 'right'>) => {
    const zoom = readDocumentZoom();
    return {
        top: rect.top / zoom,
        left: rect.left / zoom,
        width: rect.width / zoom,
        height: rect.height / zoom,
        bottom: rect.bottom / zoom,
        right: rect.right / zoom,
        zoom,
    };
};

export const getFixedDropdownPosition = (
    rect: DOMRect,
    { width = 160, height, itemCount = 6, align = 'right' }: { width?: number; height?: number; itemCount?: number; align?: 'left' | 'right' } = {},
): DropdownPosition | null => {
    if (rect.width <= 0 || rect.height <= 0) return null;
    const box = rectToFixedPixels(rect);
    const padding = 8;
    const viewportW = (window.innerWidth || 0) / box.zoom;
    const viewportH = (window.innerHeight || 0) / box.zoom;
    const maxWidth = Math.max(80, viewportW - padding * 2);
    const menuWidth = Math.min(Math.max(width / box.zoom, box.width), maxWidth);
    const estimatedHeight = height != null ? height / box.zoom : (itemCount * 42 + 8);
    const menuHeight = Math.min(estimatedHeight, Math.max(96, viewportH - padding * 2));
    let top = box.bottom + padding;
    let left = align === 'right' ? box.right - menuWidth : box.left;
    left = Math.max(padding, Math.min(left, viewportW - menuWidth - padding));
    if (top + menuHeight > viewportH - padding) {
        const above = box.top - menuHeight - padding;
        top = above >= padding ? above : Math.max(padding, viewportH - menuHeight - padding);
    }
    return { top, left, width: menuWidth };
};

export const CustomSelect: React.FC<CustomSelectProps> = ({ id, value, onChange, options, className, compact = false, dropdownClassName = '', triggerProps }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [dropPos, setDropPos] = useState<DropdownPosition | null>(null);
    const [highlightIndex, setHighlightIndex] = useState(0);
    const triggerRef = useRef<HTMLDivElement>(null);
    const dropRef = useRef<HTMLDivElement>(null);

    const selectableOptions = options.filter((opt) => !opt.isGroup);
    const selectedOption = selectableOptions.find(opt => String(opt.value) === String(value)) || selectableOptions[0];
    const selectedIndex = Math.max(0, selectableOptions.findIndex((opt) => String(opt.value) === String(value)));

    const updatePosition = useCallback((measured?: { width?: number; height?: number }) => {
        if (!triggerRef.current) return;
        const rect = triggerRef.current.getBoundingClientRect();
        const longest = options.reduce((max, opt) => Math.max(max, String(opt.label || '').length), 0);
        const estimatedWidth = Math.max(rect.width, Math.min(longest * 8 + 48, window.innerWidth - 16));
        setDropPos((prev) => {
            const next = getFixedDropdownPosition(rect, {
                width: measured?.width ?? estimatedWidth,
                height: measured?.height,
                itemCount: Math.min(options.length, 8),
                align: 'left',
            });
            if (!next) return prev;
            if (
                prev
                && Math.abs(prev.top - next.top) < 1
                && Math.abs(prev.left - next.left) < 1
                && Math.abs(prev.width - next.width) < 1
            ) {
                return prev;
            }
            return next;
        });
    }, [options]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            const t = triggerRef.current;
            const d = dropRef.current;
            if (t && !t.contains(event.target as Node) && d && !d.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    useLayoutEffect(() => {
        if (!isOpen) {
            setDropPos(null);
            return;
        }
        setHighlightIndex(selectedIndex >= 0 ? selectedIndex : 0);
        updatePosition();
        const refine = () => {
            const menu = dropRef.current?.getBoundingClientRect();
            if (menu && menu.width > 0) updatePosition({ width: menu.width, height: menu.height });
        };
        const frame = window.requestAnimationFrame(refine);
        const onReflow = () => {
            updatePosition();
            window.requestAnimationFrame(refine);
        };
        window.addEventListener('resize', onReflow);
        window.addEventListener('scroll', onReflow, true);
        return () => {
            window.cancelAnimationFrame(frame);
            window.removeEventListener('resize', onReflow);
            window.removeEventListener('scroll', onReflow, true);
        };
    }, [isOpen, selectedIndex, updatePosition]);

    // TV / leanback: while open, consume D-pad so rail nav does not steal focus.
    useEffect(() => {
        if (!isOpen) return undefined;
        try {
            document.documentElement.dataset.tvSelectOpen = '1';
        } catch {
            /* ignore */
        }
        const onKeyDown = (event: KeyboardEvent) => {
            const isBack = event.key === 'Escape'
                || event.key === 'BrowserBack'
                || event.key === 'GoBack'
                || event.keyCode === 4
                || event.key === 'Backspace';
            if (isBack) {
                event.preventDefault();
                event.stopImmediatePropagation();
                setIsOpen(false);
                return;
            }
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                event.stopImmediatePropagation();
                setHighlightIndex((prev) => {
                    if (!selectableOptions.length) return 0;
                    if (event.key === 'ArrowDown') return (prev + 1) % selectableOptions.length;
                    return (prev - 1 + selectableOptions.length) % selectableOptions.length;
                });
                return;
            }
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                event.preventDefault();
                event.stopImmediatePropagation();
                return;
            }
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                event.stopImmediatePropagation();
                const opt = selectableOptions[highlightIndex];
                if (opt) {
                    onChange(String(opt.value));
                    setIsOpen(false);
                }
            }
        };
        const onTvClose = () => setIsOpen(false);
        window.addEventListener('keydown', onKeyDown, true);
        window.addEventListener('smp-tv-select-close', onTvClose);
        window.addEventListener('smp-tv-overlay-close', onTvClose);
        return () => {
            window.removeEventListener('keydown', onKeyDown, true);
            window.removeEventListener('smp-tv-select-close', onTvClose);
            window.removeEventListener('smp-tv-overlay-close', onTvClose);
            try {
                delete document.documentElement.dataset.tvSelectOpen;
            } catch {
                /* ignore */
            }
        };
    }, [highlightIndex, isOpen, onChange, selectableOptions]);

    const openDropdown = () => {
        setIsOpen((v) => !v);
    };

    const dropdown = isOpen && dropPos ? ReactDOM.createPortal(
        <div
            ref={dropRef}
            style={{
                position: 'fixed',
                top: dropPos.top,
                left: dropPos.left,
                minWidth: dropPos.width,
                maxWidth: 'calc(100vw - 16px)',
                zIndex: 99999,
            }}
            data-modal-scroll=""
            data-tv-select-menu="1"
            className={`bg-card border border-border rounded-lg shadow-2xl py-1 max-h-64 overflow-y-auto overscroll-contain custom-scrollbar ${dropdownClassName}`.trim()}
        >
            {options.map((opt, index) => {
                if (opt.isGroup) {
                    return (
                        <div
                            key={`group-${opt.label}-${index}`}
                            className={`px-4 pt-2.5 pb-1 text-[10px] uppercase tracking-wider font-bold text-plex ${index > 0 ? 'mt-1 border-t border-border/70' : ''}`}
                        >
                            {opt.label}
                        </div>
                    );
                }
                const selectableIdx = selectableOptions.findIndex((row) => String(row.value) === String(opt.value));
                const highlighted = selectableIdx === highlightIndex;
                const selected = String(value) === String(opt.value);
                return (
                    <div
                        key={String(opt.value)}
                        className={`px-4 py-2.5 cursor-pointer hover:bg-border/40 transition-colors whitespace-nowrap text-sm flex items-center gap-2 ${
                            highlighted || selected ? 'bg-plex/10 text-plex font-bold' : 'text-text'
                        }`}
                        onMouseDown={e => { e.preventDefault(); onChange(String(opt.value)); setIsOpen(false); }}
                    >
                        {opt.icon ? <span className="inline-flex shrink-0 opacity-90">{opt.icon}</span> : null}
                        <span className="truncate">{opt.label}</span>
                    </div>
                );
            })}
        </div>,
        document.body
    ) : null;

    return (
        <div className={`relative ${className || ''}`} ref={triggerRef} id={id}>
            <button
                type="button"
                {...triggerProps}
                aria-expanded={isOpen}
                className={`flex justify-between items-center w-full cursor-pointer h-full rounded-lg border bg-background text-text transition-all ${compact ? 'px-3 py-2' : 'px-4 py-3'} ${isOpen ? 'border-plex ring-1 ring-plex' : 'border-border hover:border-plex/50'} ${triggerProps?.className || ''}`}
                onClick={(event) => {
                    triggerProps?.onClick?.(event);
                    if (!event.defaultPrevented) openDropdown();
                }}
            >
                <span className={`truncate mr-4 font-medium flex items-center gap-2 min-w-0 ${compact ? 'text-xs' : 'text-sm'}`}>
                    {selectedOption?.icon ? <span className="inline-flex shrink-0 opacity-90">{selectedOption.icon}</span> : null}
                    <span className="truncate">{selectedOption?.label || 'Select...'}</span>
                </span>
                <span className={`text-[10px] transition-transform shrink-0 ${isOpen ? 'rotate-180' : ''}`}>▼</span>
            </button>
            {dropdown}
        </div>
    );
};

export const StyledCheckbox: React.FC<{ checked: boolean; onChange: (checked: boolean) => void; label: string }> = ({ checked, onChange, label }) => (
    <label className="flex items-center gap-2 text-xs text-muted">
        <span className="relative inline-flex h-4 w-4 items-center justify-center">
            <input
                type="checkbox"
                checked={checked}
                onChange={(e) => onChange(e.target.checked)}
                className="peer sr-only"
            />
            <span className="h-4 w-4 rounded border border-border bg-background transition-colors peer-checked:border-plex peer-checked:bg-plex/20" />
            <Check className="pointer-events-none absolute h-3 w-3 text-plex opacity-0 transition-opacity peer-checked:opacity-100" />
        </span>
        {label}
    </label>
);

export const OverlayCheckbox: React.FC<{
    checked: boolean;
    onChange: (checked: boolean) => void;
    size?: 'sm' | 'md';
    title?: string;
    className?: string;
}> = ({ checked, onChange, size = 'md', title, className = '' }) => {
    const box = size === 'sm' ? 'h-3.5 w-3.5' : 'h-5 w-5';
    const icon = size === 'sm' ? 'h-2.5 w-2.5' : 'h-3.5 w-3.5';
    return (
        <label className={`relative inline-flex cursor-pointer ${className}`} title={title}>
            <input
                type="checkbox"
                checked={checked}
                onChange={(e) => onChange(e.target.checked)}
                className="peer sr-only"
            />
            <span className={`${box} rounded-md border-2 border-white/35 bg-black/80 shadow-[0_2px_8px_rgba(0,0,0,0.45)] backdrop-blur-sm transition-all peer-checked:border-plex peer-checked:bg-plex/25 peer-hover:border-white/60`} />
            <Check className={`pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 ${icon} text-plex opacity-0 transition-opacity peer-checked:opacity-100`} />
        </label>
    );
};

export const SettingsSwitch: React.FC<{
    checked: boolean;
    onChange: (checked: boolean) => void;
    className?: string;
    id?: string;
    disabled?: boolean;
}> = ({ checked, onChange, className = '', id, disabled = false }) => (
    <label className={`relative inline-flex items-center ml-4 flex-shrink-0 ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'} ${className}`}>
        <input
            id={id}
            type="checkbox"
            className="sr-only peer"
            checked={checked}
            disabled={disabled}
            onChange={(e) => onChange(e.target.checked)}
        />
        <div className="w-11 h-6 bg-background peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-text after:border-border after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-plex" />
    </label>
);

export const SettingsToggleRow: React.FC<{
    title: string;
    description?: string;
    hint?: React.ReactNode;
    checked: boolean;
    onChange: (checked: boolean) => void;
    className?: string;
    border?: boolean;
    disabled?: boolean;
    children?: React.ReactNode;
}> = ({ title, description, hint, checked, onChange, className = '', border = true, disabled = false, children }) => (
    <div className={`${border ? 'py-4 border-b border-border/40' : 'py-4'} ${disabled ? 'opacity-70' : ''} ${className}`}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="min-w-0">
                <h4 className="font-bold text-text inline-flex items-center gap-1.5 flex-wrap">
                    <span>{title}</span>
                    {hint || (description ? <SettingHint>{description}</SettingHint> : null)}
                </h4>
            </div>
            <SettingsSwitch checked={checked} onChange={onChange} disabled={disabled} />
        </div>
        {children}
    </div>
);

export const ConfirmModal: React.FC<{
    isOpen: boolean;
    message: string;
    onConfirm: () => void;
    onCancel: () => void;
    title?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    hideCancel?: boolean;
    danger?: boolean;
}> = ({
    isOpen,
    message,
    onConfirm,
    onCancel,
    title = 'Are you sure?',
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    hideCancel = false,
    danger = false,
}) => {
    if (!isOpen || typeof document === 'undefined') return null;
    return ReactDOM.createPortal(
        <div
            className="pointer-events-auto fixed inset-0 z-[100000] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm animate-fade-in"
            role="presentation"
            onMouseDown={(event) => event.stopPropagation()}
        >
            <div
                className={`glass-card overflow-hidden min-w-0 animate-slide-up max-w-md w-full p-6 pointer-events-auto ${
                    danger ? 'border border-red-500/40 shadow-[0_0_40px_rgba(239,68,68,0.15)]' : ''
                }`}
                role="dialog"
                aria-modal="true"
                aria-labelledby="portal-confirm-title"
                onMouseDown={(event) => event.stopPropagation()}
            >
                {danger ? (
                    <div className="mb-4 flex items-center gap-3 rounded-lg border border-red-500/50 bg-red-500/15 px-4 py-3">
                        <AlertTriangle className="h-10 w-10 shrink-0 text-red-400" aria-hidden="true" />
                        <div className="min-w-0">
                            <p className="text-lg font-black uppercase tracking-[0.2em] text-red-400">Danger</p>
                            <p className="text-xs font-bold uppercase tracking-wide text-red-300/90">This is not reversible</p>
                        </div>
                    </div>
                ) : null}
                <h3
                    id="portal-confirm-title"
                    className={`text-xl font-black mb-4 tracking-tight break-words [overflow-wrap:anywhere] ${danger ? 'text-red-200' : 'text-text'}`}
                >
                    {title}
                </h3>
                <p className="text-muted mb-8 text-sm leading-relaxed whitespace-pre-line min-w-0 max-w-full break-words [overflow-wrap:anywhere]">{message}</p>
                <div className="flex gap-3 justify-end">
                    {!hideCancel && (
                        <button type="button" className="btn-secondary px-4 py-2.5 text-sm" onClick={onCancel}>{cancelLabel}</button>
                    )}
                    <button
                        type="button"
                        className={
                            danger
                                ? 'rounded-lg border border-red-500/60 bg-red-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-red-500'
                                : 'inline-flex items-center justify-center rounded-xl bg-plex px-4 py-2.5 text-sm font-bold text-background hover:bg-plex-hover'
                        }
                        onClick={onConfirm}
                    >
                        {confirmLabel}
                    </button>
                </div>
            </div>
        </div>,
        document.body,
    );
};

export const ScrollReveal: React.FC<{ children: React.ReactNode; enabled?: boolean; delay?: number; className?: string }> = ({ children, enabled = true, delay = 0, className = '' }) => {
    const [isVisible, setIsVisible] = useState(!enabled);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!enabled) {
            setIsVisible(true);
            return;
        }
        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting) {
                    setIsVisible(true);
                    observer.disconnect();
                }
            },
            { threshold: 0.1, rootMargin: '50px' }
        );
        if (ref.current) observer.observe(ref.current);
        return () => observer.disconnect();
    }, [enabled]);

    return (
        <div ref={ref} className={`${className} transition-all duration-700 ease-out ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-12'}`} style={{ transitionDelay: `${delay}ms` }}>
            {children}
        </div>
    );
};
