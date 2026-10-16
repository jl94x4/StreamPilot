import React, { useState } from 'react';
import { RefreshCw, CheckCircle, XCircle } from 'lucide-react';
import { apiFetch } from './api';

export type IntegrationTestType = 'plex' | 'jellyfin' | 'emby' | 'sonarr' | 'radarr' | 'lidarr' | 'bazarr' | 'downloadClient' | 'tautulli' | 'jellystat' | 'jellyglance' | 'requestApp' | 'tmdb';

type Props = {
    type: IntegrationTestType;
    payload?: Record<string, unknown>;
    label?: string;
    successFallback?: string;
    failureFallback?: string;
    disabled?: boolean;
    className?: string;
    onMessage?: (message: string, success: boolean) => void;
};

export const IntegrationTestButton: React.FC<Props> = ({
    type,
    payload = {},
    label = 'Test Connection',
    successFallback = 'Connection successful',
    failureFallback = 'Connection failed',
    disabled = false,
    className = '',
    onMessage,
}) => {
    const [status, setStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
    const [message, setMessage] = useState('');

    const handleTest = async () => {
        setStatus('testing');
        setMessage('');
        try {
            const result = await apiFetch('/api/config/test-integration', {
                method: 'POST',
                body: JSON.stringify({ type, ...payload }),
            });
            const msg = result.message || successFallback;
            setStatus('success');
            setMessage(msg);
            onMessage?.(msg, true);
        } catch (e) {
            const msg = e instanceof Error ? e.message : failureFallback;
            setStatus('error');
            setMessage(msg);
            onMessage?.(msg, false);
        }
    };

    return (
        <div className={`flex flex-col gap-2 ${className}`}>
            <button
                type="button"
                onClick={handleTest}
                disabled={disabled || status === 'testing'}
                className="px-4 py-2 bg-border text-text rounded-md font-medium hover:bg-white/10 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 w-fit"
            >
                {status === 'testing' ? <RefreshCw className="w-4 h-4 animate-spin" /> : null}
                {label}
            </button>
            {message && (
                <p className={`text-sm flex items-start gap-1.5 ${status === 'success' ? 'text-green-400' : 'text-red-400'}`}>
                    {status === 'success' ? <CheckCircle className="w-4 h-4 flex-shrink-0 mt-0.5" /> : <XCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />}
                    <span>{message}</span>
                </p>
            )}
        </div>
    );
};
