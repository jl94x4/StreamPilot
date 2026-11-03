import React, { useEffect, useState } from 'react';
import { apiFetch } from '../shared/api';
import { CustomSelect } from '../shared/ui';
import { useDiscoverI18n } from '../discovery/i18n';

/**
 * Plex share permissions beyond libraries: downloads, camera upload, channels and content
 * restrictions per media type. Used on Edit User (that user's live Plex share) and in Settings
 * (what every new invite gets). Saved straight to Plex / the portal with its own Save button.
 */

type Rule = { ratings?: string[]; ratingMode?: 'allow' | 'block'; labels: string[]; labelMode: 'allow' | 'block' };
export type SharePermissions = {
    allowSync: boolean;
    allowCameraUpload: boolean;
    allowChannels: boolean;
    movies: Rule;
    television: Rule;
    music: Rule;
};

const EMPTY: SharePermissions = {
    allowSync: false,
    allowCameraUpload: false,
    allowChannels: false,
    movies: { ratings: [], ratingMode: 'allow', labels: [], labelMode: 'allow' },
    television: { ratings: [], ratingMode: 'allow', labels: [], labelMode: 'allow' },
    music: { labels: [], labelMode: 'allow' },
};

const inputClass = 'w-full bg-background border border-border text-text rounded-lg px-3 py-2 text-sm focus:border-plex focus:ring-1 focus:ring-plex outline-none transition-all';

const splitList = (text: string) => text.split(',').map((row) => row.trim()).filter(Boolean);

const Switch: React.FC<{ on: boolean; onToggle: () => void; label: string; hint: string }> = ({ on, onToggle, label, hint }) => (
    <div className="flex items-center justify-between bg-black/10 p-4 rounded-lg border border-border gap-3">
        <div className="min-w-0">
            <label className="font-bold block mb-1">{label}</label>
            <span className="text-xs text-muted block">{hint}</span>
        </div>
        <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-label={label}
            onClick={onToggle}
            className={`relative inline-flex items-center h-6 rounded-full w-11 shrink-0 transition-colors ${on ? 'bg-plex' : 'bg-border'}`}
        >
            <span className={`inline-block w-4 h-4 transform bg-white rounded-full transition-transform ${on ? 'translate-x-6' : 'translate-x-1'}`} />
        </button>
    </div>
);

/** A comma list that only commits on blur, so typing "PG, 12" isn't fought by re-formatting. */
const ListInput: React.FC<{ value: string[]; onChange: (next: string[]) => void; placeholder: string }> = ({ value, onChange, placeholder }) => {
    const [text, setText] = useState(value.join(', '));
    useEffect(() => { setText(value.join(', ')); }, [value]);
    return (
        <input
            value={text}
            onChange={(event) => setText(event.target.value)}
            onBlur={() => onChange(splitList(text))}
            placeholder={placeholder}
            className={inputClass}
        />
    );
};

const RuleEditor: React.FC<{ title: string; rule: Rule; ratings: boolean; onChange: (rule: Rule) => void }> = ({ title, rule, ratings, onChange }) => {
    const { t } = useDiscoverI18n();
    const modeOptions = [
        { value: 'allow', label: t('plexPermissions.onlyAllow') },
        { value: 'block', label: t('plexPermissions.block') },
    ];
    return (
        <div className="bg-black/10 p-4 rounded-lg border border-border flex flex-col gap-3">
            <p className="font-bold">{title}</p>
            {ratings ? (
                <div className="flex flex-col sm:flex-row gap-2">
                    <CustomSelect
                        value={rule.ratingMode || 'allow'}
                        onChange={(mode) => onChange({ ...rule, ratingMode: mode === 'block' ? 'block' : 'allow' })}
                        options={modeOptions}
                        className="sm:w-48 shrink-0"
                    />
                    <ListInput
                        value={rule.ratings || []}
                        onChange={(next) => onChange({ ...rule, ratings: next })}
                        placeholder={t('plexPermissions.ratingsPlaceholder')}
                    />
                </div>
            ) : null}
            <div className="flex flex-col sm:flex-row gap-2">
                <CustomSelect
                    value={rule.labelMode}
                    onChange={(mode) => onChange({ ...rule, labelMode: mode === 'block' ? 'block' : 'allow' })}
                    options={modeOptions}
                    className="sm:w-48 shrink-0"
                />
                <ListInput
                    value={rule.labels}
                    onChange={(next) => onChange({ ...rule, labels: next })}
                    placeholder={t('plexPermissions.labelsPlaceholder')}
                />
            </div>
        </div>
    );
};

export const PermissionsEditor: React.FC<{ value: SharePermissions; onChange: (next: SharePermissions) => void }> = ({ value, onChange }) => {
    const { t } = useDiscoverI18n();
    return (
        <div className="flex flex-col gap-3">
            <Switch
                on={value.allowSync}
                onToggle={() => onChange({ ...value, allowSync: !value.allowSync })}
                label={t('plexPermissions.downloads')}
                hint={t('plexPermissions.downloadsHint')}
            />
            <Switch
                on={value.allowChannels}
                onToggle={() => onChange({ ...value, allowChannels: !value.allowChannels })}
                label={t('plexPermissions.channels')}
                hint={t('plexPermissions.channelsHint')}
            />
            <Switch
                on={value.allowCameraUpload}
                onToggle={() => onChange({ ...value, allowCameraUpload: !value.allowCameraUpload })}
                label={t('plexPermissions.cameraUpload')}
                hint={t('plexPermissions.cameraUploadHint')}
            />
            <p className="text-xs text-muted">{t('plexPermissions.restrictionsHint')}</p>
            <RuleEditor title={t('plexPermissions.movies')} rule={value.movies} ratings onChange={(movies) => onChange({ ...value, movies })} />
            <RuleEditor title={t('plexPermissions.television')} rule={value.television} ratings onChange={(television) => onChange({ ...value, television })} />
            <RuleEditor title={t('plexPermissions.music')} rule={value.music} ratings={false} onChange={(music) => onChange({ ...value, music })} />
        </div>
    );
};

const SaveRow: React.FC<{ busy: boolean; message: string | null; error: boolean; onSave: () => void; label: string }> = ({ busy, message, error, onSave, label }) => (
    <div className="flex items-center gap-3">
        <button
            type="button"
            onClick={onSave}
            disabled={busy}
            className="px-4 py-2 rounded-lg bg-plex text-black font-bold text-sm disabled:opacity-60"
        >
            {label}
        </button>
        {message ? <span className={`text-sm ${error ? 'text-red-400' : 'text-muted'}`}>{message}</span> : null}
    </div>
);

/** Edit User: this user's live Plex share permissions. */
export const PlexUserPermissions: React.FC<{ userId: string }> = ({ userId }) => {
    const { t } = useDiscoverI18n();
    const [value, setValue] = useState<SharePermissions | null>(null);
    const [unavailable, setUnavailable] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [error, setError] = useState(false);

    useEffect(() => {
        let cancelled = false;
        setValue(null);
        setUnavailable(null);
        setMessage(null);
        apiFetch(`/api/users/${encodeURIComponent(userId)}/plex-permissions`)
            .then((data: any) => {
                if (cancelled) return;
                if (data?.available && data.permissions) setValue(data.permissions);
                else setUnavailable(String(data?.reason || t('plexPermissions.unavailable')));
            })
            .catch((err: any) => {
                if (!cancelled) setUnavailable(String(err?.message || t('plexPermissions.loadFailed')));
            });
        return () => { cancelled = true; };
    }, [userId, t]);

    const save = async () => {
        if (!value) return;
        setBusy(true);
        setMessage(null);
        try {
            await apiFetch(`/api/users/${encodeURIComponent(userId)}/plex-permissions`, {
                method: 'PUT',
                body: JSON.stringify({ permissions: value }),
            });
            setError(false);
            setMessage(t('plexPermissions.saved'));
        } catch (err: any) {
            setError(true);
            setMessage(String(err?.message || t('plexPermissions.saveFailed')));
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="flex flex-col gap-3">
            <div>
                <h4 className="font-bold">{t('plexPermissions.title')}</h4>
                <p className="text-xs text-muted">{t('plexPermissions.userHint')}</p>
            </div>
            {unavailable ? (
                <p className="text-sm text-muted">{unavailable}</p>
            ) : !value ? (
                <p className="text-sm text-muted">{t('plexPermissions.loading')}</p>
            ) : (
                <>
                    <PermissionsEditor value={value} onChange={setValue} />
                    <SaveRow busy={busy} message={message} error={error} onSave={save} label={t('plexPermissions.saveToPlex')} />
                </>
            )}
        </div>
    );
};

/** Settings: what every new Plex invite gets. Off = Plex's own defaults, as before. */
export const PlexShareDefaultsSection: React.FC = () => {
    const { t } = useDiscoverI18n();
    const [enabled, setEnabled] = useState(false);
    const [value, setValue] = useState<SharePermissions>(EMPTY);
    const [loaded, setLoaded] = useState(false);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [error, setError] = useState(false);

    useEffect(() => {
        apiFetch('/api/plex-share-defaults')
            .then((data: any) => {
                if (data?.defaults) {
                    setEnabled(true);
                    setValue(data.defaults);
                }
            })
            .catch(() => undefined)
            .finally(() => setLoaded(true));
    }, []);

    const save = async () => {
        setBusy(true);
        setMessage(null);
        try {
            await apiFetch('/api/plex-share-defaults', {
                method: 'PUT',
                body: JSON.stringify({ defaults: enabled ? value : null }),
            });
            setError(false);
            setMessage(t('plexPermissions.saved'));
        } catch (err: any) {
            setError(true);
            setMessage(String(err?.message || t('plexPermissions.saveFailed')));
        } finally {
            setBusy(false);
        }
    };

    if (!loaded) return null;
    return (
        <div className="flex flex-col gap-3">
            <Switch
                on={enabled}
                onToggle={() => setEnabled(!enabled)}
                label={t('plexPermissions.defaultsTitle')}
                hint={t('plexPermissions.defaultsHint')}
            />
            {enabled ? <PermissionsEditor value={value} onChange={setValue} /> : null}
            <SaveRow busy={busy} message={message} error={error} onSave={save} label={t('plexPermissions.saveDefaults')} />
        </div>
    );
};
