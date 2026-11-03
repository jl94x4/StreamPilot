/**
 * Capture Chrome's beforeinstallprompt as early as possible.
 * Navigation mounts only after login — BIP is one-shot per navigation, so a
 * late listener can miss it and leave installPrompt null forever.
 */

export type BeforeInstallPromptEvent = Event & {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

type Listener = (event: BeforeInstallPromptEvent | null) => void;

let deferred: BeforeInstallPromptEvent | null = null;
let bipSeenThisSession = false;
const listeners = new Set<Listener>();

const notify = () => {
    for (const listener of listeners) {
        try {
            listener(deferred);
        } catch {
            // ignore subscriber errors
        }
    }
};

export const getDeferredInstallPrompt = (): BeforeInstallPromptEvent | null => deferred;

export const wasInstallPromptSeenThisSession = (): boolean => bipSeenThisSession;

export const clearDeferredInstallPrompt = (): void => {
    deferred = null;
    notify();
};

export const subscribeInstallPrompt = (listener: Listener): (() => void) => {
    listeners.add(listener);
    listener(deferred);
    return () => {
        listeners.delete(listener);
    };
};

if (typeof window !== 'undefined') {
    window.addEventListener('beforeinstallprompt', (event) => {
        event.preventDefault();
        bipSeenThisSession = true;
        deferred = event as BeforeInstallPromptEvent;
        notify();
    });
    window.addEventListener('appinstalled', () => {
        deferred = null;
        bipSeenThisSession = true;
        notify();
    });
}
