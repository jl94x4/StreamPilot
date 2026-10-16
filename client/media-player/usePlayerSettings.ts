import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchMediaPlayerSettings, saveMediaPlayerSettings } from './api';
import {
    DEFAULT_PLAYER_SETTINGS,
    PLAYER_SETTINGS_EVENT,
    normalizePlayerSettings,
    playerSettingsEqual,
    publishPlayerSettingsDraft,
    readPlayerSettings,
    writePlayerSettings,
    type PlayerSettings,
} from './playerSettings';

export const usePlayerSettings = () => {
    const [saved, setSaved] = useState<PlayerSettings>(() => readPlayerSettings());
    const [draft, setDraft] = useState<PlayerSettings>(() => readPlayerSettings());
    const [saving, setSaving] = useState(false);
    const savedRef = useRef(saved);
    const draftRef = useRef(draft);
    savedRef.current = saved;
    draftRef.current = draft;

    useEffect(() => {
        const sync = () => {
            const next = readPlayerSettings();
            setSaved(next);
            setDraft((current) => (playerSettingsEqual(current, savedRef.current) ? next : current));
        };
        window.addEventListener(PLAYER_SETTINGS_EVENT, sync);
        window.addEventListener('storage', sync);
        return () => {
            window.removeEventListener(PLAYER_SETTINGS_EVENT, sync);
            window.removeEventListener('storage', sync);
        };
    }, []);

    useEffect(() => {
        let cancelled = false;
        fetchMediaPlayerSettings()
            .then((data) => {
                if (cancelled || !data) return;
                const remote = normalizePlayerSettings(data);
                if (data.saved === true) {
                    writePlayerSettings(remote);
                    setSaved(remote);
                    setDraft((current) => (playerSettingsEqual(current, savedRef.current) ? remote : current));
                    return;
                }
                const local = readPlayerSettings();
                if (!playerSettingsEqual(local, DEFAULT_PLAYER_SETTINGS)) {
                    void saveMediaPlayerSettings(local).catch(() => undefined);
                }
            })
            .catch(() => undefined);
        return () => { cancelled = true; };
    }, []);

    const updateSettings = useCallback((patch: Partial<PlayerSettings>) => {
        setDraft((current) => {
            const next = normalizePlayerSettings({ ...current, ...patch });
            publishPlayerSettingsDraft(next);
            return next;
        });
    }, []);

    const discardSettings = useCallback(() => {
        const next = savedRef.current;
        setDraft(next);
        publishPlayerSettingsDraft(next);
    }, []);

    const saveSettings = useCallback(async () => {
        const next = normalizePlayerSettings(draftRef.current);
        setSaving(true);
        try {
            await saveMediaPlayerSettings(next);
            writePlayerSettings(next);
            setSaved(next);
            setDraft(next);
        } finally {
            setSaving(false);
        }
    }, []);

    return [
        draft,
        updateSettings,
        {
            dirty: !playerSettingsEqual(draft, saved),
            saving,
            saveSettings,
            discardSettings,
        },
    ] as const;
};
