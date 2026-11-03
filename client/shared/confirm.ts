export type AskConfirmOptions = {
    title?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    /** Red destructive styling + DANGER banner in the confirm modal. */
    danger?: boolean;
};

type ConfirmHandler = (message: string, onConfirm: () => void) => void;
type AskConfirmHandler = (message: string, options?: AskConfirmOptions) => Promise<boolean>;
type AppAlertHandler = (message: string, options?: Omit<AskConfirmOptions, 'cancelLabel'>) => Promise<void>;

export type AskTextOptions = {
    title?: string;
    placeholder?: string;
    defaultValue?: string;
    confirmLabel?: string;
    cancelLabel?: string;
};
type AskTextHandler = (message: string, options?: AskTextOptions) => Promise<string | null>;

/** Callback-style confirm used across older settings screens. */
export let appConfirm: ConfirmHandler = () => {
    console.warn('appConfirm not initialized');
};

/**
 * Promise-style confirm for async flows.
 * Resolves true on Confirm, false on Cancel / dismiss.
 */
export let askConfirm: AskConfirmHandler = async (message) => {
    console.warn('askConfirm not initialized');
    if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
        return window.confirm(message);
    }
    return false;
};

/** Themed single-button notice (replaces window.alert). */
export let appAlert: AppAlertHandler = async (message) => {
    console.warn('appAlert not initialized');
    if (typeof window !== 'undefined' && typeof window.alert === 'function') {
        window.alert(message);
    }
};

/** Themed text input (replaces window.prompt). Resolves the text, or null on Cancel. */
export let askText: AskTextHandler = async (message, options = {}) => {
    console.warn('askText not initialized');
    if (typeof window !== 'undefined' && typeof window.prompt === 'function') {
        return window.prompt(message, options.defaultValue || '');
    }
    return null;
};

export const bindAskText = (handler: AskTextHandler) => {
    askText = handler;
};

export const bindAppConfirm = (handler: ConfirmHandler) => {
    appConfirm = handler;
};

export const bindAskConfirm = (handler: AskConfirmHandler) => {
    askConfirm = handler;
};

export const bindAppAlert = (handler: AppAlertHandler) => {
    appAlert = handler;
};
