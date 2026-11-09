import React from 'react';

/**
 * A button that is not a <button> on Android TV.
 *
 * While a form control (any <button>) has focus, Android's WebView runs an IME check after every
 * key press that walks the page looking for the next / previous text field, forcing style and
 * layout per element on the way. Home has no text field, so every D-pad press scanned the whole
 * page: 100–275 ms per press on the emulator, far more on a Fire Stick. A focused
 * <div role="button"> skips that check. OK / Enter still works: useTvRemote clicks focused
 * role="button" items. Off TV this is an ordinary <button>.
 */
export const isTvButtonShell = () => (
    typeof document !== 'undefined' && (
        document.documentElement?.dataset?.tv === '1'
        || (typeof window !== 'undefined' && window.__PLEX_CLIENT__?.isTv === true)
    )
);

type TvButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
    [key: `data-${string}`]: string | number | boolean | undefined;
};

export const TvButton = React.forwardRef<HTMLElement, TvButtonProps>(function TvButton(
    { type, disabled, tabIndex, children, ...rest },
    ref,
) {
    if (!isTvButtonShell()) {
        return (
            <button
                ref={ref as React.Ref<HTMLButtonElement>}
                type={type ?? 'button'}
                disabled={disabled}
                tabIndex={tabIndex}
                {...rest}
            >
                {children}
            </button>
        );
    }
    const divProps = rest as unknown as React.HTMLAttributes<HTMLDivElement>;
    return (
        <div
            ref={ref as React.Ref<HTMLDivElement>}
            role="button"
            tabIndex={tabIndex ?? 0}
            aria-disabled={disabled || undefined}
            {...divProps}
            onClick={disabled ? undefined : divProps.onClick}
        >
            {children}
        </div>
    );
});
