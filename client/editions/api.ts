import { apiFetch } from '../shared/api';

export type EditionsConfig = {
    skipLibraries: string[];
    modules: { order: string[] };
    language: {
        excludedLanguages: string[];
        skipMultipleAudioTracks: boolean;
    };
    rating: {
        source: string;
        rottenTomatoesType: string;
        tmdbApiKey: string;
    };
    performance: {
        maxWorkers: number;
        batchSize: number;
        metadataBatchSize: number;
    };
    template: {
        format: string;
        separator: string;
        maxLength: number;
    };
    tmdbLanguage: {
        hideWhenEnglish: boolean;
    };
    webhookEnabled: boolean;
    webhookToken?: string;
    scheduleHours: number;
    lastFullRunAt?: string | null;
};

export type EditionsStatus = {
    enabled?: boolean;
    workerReady?: boolean;
    mediaServerType?: string;
    running?: boolean;
    action?: string | null;
    startedAt?: string | null;
    finishedAt?: string | null;
    lastError?: string | null;
    lastResult?: any;
    percent?: number | null;
    message?: string;
    logs?: string[];
    activity?: Array<{ at?: string; action?: string; ok?: boolean; message?: string }>;
    modulesCatalog?: string[];
};

export type EditionsMovieMatch = {
    ratingKey?: string | number;
    title?: string;
    year?: number | string;
    library?: string;
    thumb?: string;
};

export const fetchEditionsStatus = () => apiFetch('/api/editions/status') as Promise<EditionsStatus>;

export const fetchEditionsConfig = () => apiFetch('/api/editions/config') as Promise<{
    config: EditionsConfig;
    modulesCatalog: string[];
    workerReady: boolean;
}>;

export const saveEditionsConfig = (config: EditionsConfig, extra: { rotateWebhookToken?: boolean } = {}) => apiFetch('/api/editions/config', {
    method: 'PUT',
    body: JSON.stringify({ config, rotateWebhookToken: !!extra.rotateWebhookToken }),
}) as Promise<{ config: EditionsConfig; modulesCatalog: string[] }>;

export const testEditionsConnection = () => apiFetch('/api/editions/test', { method: 'POST' });

export const searchEditionsMovies = (query: string) => apiFetch(`/api/editions/search?q=${encodeURIComponent(query)}`) as Promise<{
    ok?: boolean;
    matches?: EditionsMovieMatch[];
}>;

export const listEditionsBackups = () => apiFetch('/api/editions/backups') as Promise<{
    ok?: boolean;
    backups?: Array<{ name: string; path: string; mtime?: number; size?: number }>;
}>;

export const startEditionsAction = (action: string, body: Record<string, unknown> = {}) => apiFetch(`/api/editions/${action}`, {
    method: 'POST',
    body: JSON.stringify(body),
}) as Promise<EditionsStatus>;

export const cancelEditionsJob = () => apiFetch('/api/editions/cancel', { method: 'POST' });
