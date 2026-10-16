import { askConfirm } from '../shared/confirm';
import {
    posterSetsApi,
    PosterSetsTitleWatchConflict,
    type PosterSetsAddWatchPayload,
} from './api';
import { formatSetLabel, providerLabel } from './shared/posterSetsFormat';
import type { PosterSetsWatch } from './types';
import { formatWatchArtSlots, watchArtSlots } from './watchArtSlots';

const describeWatchedSet = (watch: PosterSetsWatch | null | undefined) => {
    const label = formatSetLabel(watch);
    if (label) return label;
    const creator = String(watch?.user || '').trim().replace(/^@/, '');
    const provider = providerLabel(watch?.provider);
    if (creator) return `@${creator} on ${provider}`;
    const url = String(watch?.url || '').trim();
    return url || 'the current set';
};

export const confirmReplaceTitleWatch = async (conflict: PosterSetsTitleWatchConflict) => {
    const title = String(conflict.incoming?.title || conflict.existing[0]?.title || 'this title').trim();
    const current = conflict.existing.map((watch) => describeWatchedSet(watch)).join(', ');
    const next = describeWatchedSet(conflict.incoming);
    const many = conflict.existing.length > 1;
    const slotLabel = formatWatchArtSlots(watchArtSlots(conflict.incoming));
    const slotCopy = slotLabel === 'this title' ? title : `${slotLabel} for ${title}`;
    return askConfirm(
        `You're already watching ${slotCopy} with ${current}. Pinning ${next} will replace ${many ? 'those sets' : 'that set'} for ${slotLabel === 'this title' ? 'this title' : slotLabel}. Other art types stay watched.`,
        { title: 'Replace watched set?', confirmLabel: 'Replace set', danger: true },
    );
};

export type AddWatchWithReplaceResult = {
    ok: boolean;
    cancelled?: boolean;
    replaced?: boolean;
    watch?: PosterSetsWatch;
};

export const addWatchWithTitleReplaceConfirm = async (
    payload: PosterSetsAddWatchPayload,
): Promise<AddWatchWithReplaceResult> => {
    try {
        const response = await posterSetsApi.addWatch(payload);
        return {
            ok: true,
            watch: response.watch,
            replaced: Boolean(response.replaced?.length),
        };
    } catch (error) {
        if (!(error instanceof PosterSetsTitleWatchConflict)) throw error;
        const confirmed = await confirmReplaceTitleWatch(error);
        if (!confirmed) return { ok: false, cancelled: true };
        const response = await posterSetsApi.addWatch({ ...payload, replaceExisting: true });
        return {
            ok: true,
            replaced: true,
            watch: response.watch,
        };
    }
};
