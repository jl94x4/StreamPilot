const SEERR_MEDIA_PENDING = 2;
const SEERR_MEDIA_PROCESSING = 3;
const SEERR_MEDIA_AVAILABLE = 5;

const isAvailable = (status) => Number(status) === SEERR_MEDIA_AVAILABLE;
const isPendingOrProcessing = (status) => {
    const value = Number(status);
    return value === SEERR_MEDIA_PENDING || value === SEERR_MEDIA_PROCESSING;
};

/**
 * Mirror portal movie requestability for Seerr mediaInfo.status / status4k.
 * HD already in the library must not block a 4K request (and vice versa).
 */
export const evaluateSeerrMovieRequestability = ({
    mediaStatus = null,
    mediaStatus4k = null,
    hasHdServer = false,
    has4kServer = false,
    canRequest4k = false,
} = {}) => {
    const hdInLibrary = isAvailable(mediaStatus);
    const fourKInLibrary = isAvailable(mediaStatus4k);
    const hdRequested = isPendingOrProcessing(mediaStatus);
    const fourKRequested = isPendingOrProcessing(mediaStatus4k);
    const hdStillNeeded = !!hasHdServer && !hdInLibrary && !hdRequested;
    const fourKStillNeeded = !!canRequest4k && !!has4kServer && !fourKInLibrary && !fourKRequested;
    const canRequest = hdStillNeeded || fourKStillNeeded;

    let blockReason = null;
    if (!canRequest && (hdInLibrary || fourKInLibrary)) {
        blockReason = 'This movie is already available.';
    } else if (!canRequest && (isPendingOrProcessing(mediaStatus) || isPendingOrProcessing(mediaStatus4k))) {
        const active = isPendingOrProcessing(mediaStatus) ? Number(mediaStatus) : Number(mediaStatus4k);
        blockReason = active === SEERR_MEDIA_PROCESSING
            ? 'This title is already requested.'
            : 'This movie already has a pending request.';
    }

    let availabilityNote = null;
    if (hdInLibrary && fourKStillNeeded) {
        availabilityNote = 'HD is already in your library — you can still request 4K.';
    } else if (fourKInLibrary && hdStillNeeded) {
        availabilityNote = '4K is already in your library — you can still request HD.';
    }

    return {
        canRequest,
        blockReason,
        availabilityNote,
        libraryQualities: { hd: hdInLibrary, '4k': fourKInLibrary },
        requestedQualities: { hd: hdRequested, '4k': fourKRequested },
    };
};
