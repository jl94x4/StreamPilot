import type { AppConfig } from './types';
import { findConfigConflicts } from './configConflicts';
import { displayToMmDd } from './specialDates';

export type ConfigValidationIssue = {
    id: string;
    severity: 'error' | 'warning';
    message: string;
};

const norm = (s: unknown) => String(s ?? '').trim();

type ValidateConfigOptions = {
    /** When true, Plex URL/token come from Settings → Media Player. */
    plexFromPortal?: boolean;
};

/** Fast client-side checks before hitting the worker validate endpoint. */
export function validateConfigLocal(
    config: AppConfig,
    opts: ValidateConfigOptions = {},
): ConfigValidationIssue[] {
    const issues: ConfigValidationIssue[] = [];
    const plexFromPortal = Boolean(
        opts.plexFromPortal
        || (config as AppConfig & { _plex_from_portal?: boolean })._plex_from_portal,
    );

    if (!plexFromPortal) {
        if (!norm(config.plex_url)) {
            issues.push({ id: 'plex-url', severity: 'error', message: 'Plex URL is required.' });
        } else if (!/^https?:\/\//i.test(norm(config.plex_url))) {
            issues.push({
                id: 'plex-url-scheme',
                severity: 'warning',
                message: 'Plex URL should start with http:// or https://',
            });
        }

        if (!norm(config.plex_token)) {
            issues.push({ id: 'plex-token', severity: 'error', message: 'Plex token is required.' });
        }
    }

    const libs = (config.library_names || []).map(norm).filter(Boolean);
    if (!libs.length) {
        issues.push({ id: 'libs-empty', severity: 'error', message: 'Add at least one Plex library.' });
    }

    const pins = config.number_of_collections_to_pin || {};
    let totalPins = 0;
    for (const lib of libs) {
        const raw = pins[lib];
        const n = typeof raw === 'number' ? raw : parseInt(String(raw ?? ''), 10);
        if (!Number.isFinite(n) || n < 0) {
            issues.push({
                id: `pin-bad:${lib}`,
                severity: 'error',
                message: `Pin limit for "${lib}" must be a number ≥ 0.`,
            });
        } else {
            totalPins += n;
            if (n === 0) {
                issues.push({
                    id: `pin-zero:${lib}`,
                    severity: 'warning',
                    message: `"${lib}" has 0 pin slots — nothing will be pinned there.`,
                });
            }
        }
    }
    if (libs.length && totalPins === 0) {
        issues.push({
            id: 'pin-total-zero',
            severity: 'warning',
            message: 'All libraries have 0 pin slots. The service will not pin anything.',
        });
    }

    const interval = Number(config.pinning_interval);
    if (!Number.isFinite(interval) || interval < 1) {
        issues.push({
            id: 'interval',
            severity: 'error',
            message: 'Check interval must be at least 1 minute.',
        });
    }

    (config.regex_exclusion_patterns || []).forEach((pattern, idx) => {
        const p = norm(pattern);
        if (!p) return;
        try {
            // eslint-disable-next-line no-new
            new RegExp(p);
        } catch {
            issues.push({
                id: `regex:${idx}`,
                severity: 'error',
                message: `Invalid regex exclusion: ${p}`,
            });
        }
    });

    (config.special_collections || []).forEach((spec, idx) => {
        for (const field of ['start_date', 'end_date'] as const) {
            const raw = norm(spec[field]);
            if (!raw) {
                issues.push({
                    id: `special-empty:${idx}:${field}`,
                    severity: 'error',
                    message: `Special event #${idx + 1} is missing ${field === 'start_date' ? 'start' : 'end'} date.`,
                });
                continue;
            }
            // Stored values must always be valid MM-DD
            if (!displayToMmDd(raw, 'MM-DD')) {
                issues.push({
                    id: `special-bad:${idx}:${field}`,
                    severity: 'error',
                    message: `Special event #${idx + 1} has invalid ${field === 'start_date' ? 'start' : 'end'} date "${raw}" (expected MM-DD).`,
                });
            }
        }
    });

    // Soft: surface conflict warnings as save warnings too
    for (const c of findConfigConflicts(config)) {
        if (c.severity === 'warning') {
            issues.push({ id: `conflict:${c.id}`, severity: 'warning', message: c.message });
        }
    }

    return issues;
}

export function partitionValidationIssues(issues: ConfigValidationIssue[]) {
    return {
        errors: issues.filter(i => i.severity === 'error'),
        warnings: issues.filter(i => i.severity === 'warning'),
    };
}
