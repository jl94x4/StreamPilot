import { askReplaceCompare } from './ReplaceCompareDialog';
import {
    posterSetsApi,
    PosterSetsTitleWatchConflict,
    type PosterSetsAddWatchPayload,
} from './api';
import type { PosterSetsWatch } from './types';

export const confirmReplaceTitleWatch = (conflict: PosterSetsTitleWatchConflict) => askReplaceCompare(conflict);

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
