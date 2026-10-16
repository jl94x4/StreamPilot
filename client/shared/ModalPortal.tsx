import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { lockBackgroundScroll } from './lockBackgroundScroll';

type Props = {
    open: boolean;
    children: React.ReactNode;
};

/** Render modals on document.body so they sit above the mobile nav (z-50). */
export const ModalPortal: React.FC<Props> = ({ open, children }) => {
    useEffect(() => {
        if (!open) return undefined;
        return lockBackgroundScroll();
    }, [open]);

    if (!open || typeof document === 'undefined') return null;
    return createPortal(children, document.body);
};
