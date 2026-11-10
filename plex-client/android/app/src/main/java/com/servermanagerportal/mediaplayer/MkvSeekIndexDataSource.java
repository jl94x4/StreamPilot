package com.servermanagerportal.mediaplayer;

import android.net.Uri;
import android.util.Log;

import androidx.annotation.Nullable;
import androidx.media3.common.C;
import androidx.media3.datasource.DataSource;
import androidx.media3.datasource.DataSpec;
import androidx.media3.datasource.TransferListener;

import java.io.IOException;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Makes MKVs whose seek index is only reachable through a second SeekHead seekable.
 *
 * mkvmerge (older versions especially) writes a first SeekHead that lists Info, Tracks and a
 * second SeekHead at the end of the file; the Cues (seek index) are listed only in that second
 * one. Media3's MatroskaExtractor reads just the first SeekHead, finds no Cues entry and reports
 * the file unseekable: resume started at 0 and the player fell back to a server transcode (which,
 * for a TrueHD / DTS remux, means transcoding the audio).
 *
 * This reads the second SeekHead once per file and rewrites, in the bytes handed to the
 * extractor, the first SeekHead's "SeekHead" entry into a "Cues" entry (same sizes, so nothing
 * shifts). The file on the server is not touched.
 */
final class MkvSeekIndexDataSource implements DataSource {
    private static final String TAG = "SmpPlayerActivity";
    private static final int HEAD_BYTES = 16 * 1024;
    private static final int ID_SEGMENT = 0x18538067;
    private static final int ID_SEEK_HEAD = 0x114D9B74;
    private static final int ID_SEEK = 0x4DBB;
    private static final int ID_SEEK_ID = 0x53AB;
    private static final int ID_SEEK_POSITION = 0x53AC;
    private static final int ID_CUES = 0x1C53BB6B;
    private static final int ID_CLUSTER = 0x1F43B675;

    /** Bytes to substitute at a file offset. */
    private static final class Patch {
        final long idOffset;
        final byte[] id;
        final long positionOffset;
        final byte[] position;

        Patch(long idOffset, byte[] id, long positionOffset, byte[] position) {
            this.idOffset = idOffset;
            this.id = id;
            this.positionOffset = positionOffset;
            this.position = position;
        }

        long end() {
            return Math.max(idOffset + id.length, positionOffset + position.length);
        }
    }

    private static final Patch NONE = new Patch(0, new byte[0], 0, new byte[0]);
    /** One probe per file (host + path) for the life of the process. */
    private static final Map<String, Patch> PATCHES = new ConcurrentHashMap<>();

    static final class Factory implements DataSource.Factory {
        private final DataSource.Factory upstream;

        Factory(DataSource.Factory upstream) {
            this.upstream = upstream;
        }

        @Override
        public DataSource createDataSource() {
            return new MkvSeekIndexDataSource(upstream.createDataSource(), upstream);
        }
    }

    private final DataSource upstream;
    private final DataSource.Factory probeFactory;
    private Patch patch = NONE;
    private long position;

    private MkvSeekIndexDataSource(DataSource upstream, DataSource.Factory probeFactory) {
        this.upstream = upstream;
        this.probeFactory = probeFactory;
    }

    @Override
    public void addTransferListener(TransferListener transferListener) {
        upstream.addTransferListener(transferListener);
    }

    @Override
    public long open(DataSpec dataSpec) throws IOException {
        patch = NONE;
        position = dataSpec.position;
        if (looksLikeMkv(dataSpec.uri) && dataSpec.position < HEAD_BYTES) {
            String key = dataSpec.uri.getHost() + "|" + dataSpec.uri.getPath();
            Patch known = PATCHES.get(key);
            if (known == null) {
                known = probe(dataSpec);
                PATCHES.put(key, known);
            }
            patch = known;
        }
        return upstream.open(dataSpec);
    }

    @Override
    public int read(byte[] buffer, int offset, int length) throws IOException {
        int read = upstream.read(buffer, offset, length);
        if (read <= 0) return read;
        if (patch != NONE && position < patch.end()) {
            overlay(buffer, offset, read, patch.idOffset, patch.id);
            overlay(buffer, offset, read, patch.positionOffset, patch.position);
        }
        position += read;
        return read;
    }

    private void overlay(byte[] buffer, int offset, int read, long at, byte[] bytes) {
        for (int i = 0; i < bytes.length; i++) {
            long filePos = at + i;
            if (filePos >= position && filePos < position + read) {
                buffer[offset + (int) (filePos - position)] = bytes[i];
            }
        }
    }

    @Nullable
    @Override
    public Uri getUri() {
        return upstream.getUri();
    }

    @Override
    public Map<String, List<String>> getResponseHeaders() {
        return upstream.getResponseHeaders();
    }

    @Override
    public void close() throws IOException {
        upstream.close();
    }

    private static boolean looksLikeMkv(Uri uri) {
        String path = uri.getPath();
        if (path == null) return false;
        String lower = path.toLowerCase(java.util.Locale.US);
        return lower.endsWith(".mkv") || lower.endsWith(".mka") || lower.endsWith(".mk3d");
    }

    /** NONE when the file needs no help, is not Matroska, or anything about it is unexpected. */
    private Patch probe(DataSpec spec) {
        try {
            byte[] head = readRange(spec, 0, HEAD_BYTES, true);
            if (head.length < 64 || (head[0] & 0xFF) != 0x1A || (head[1] & 0xFF) != 0x45) return NONE;
            int segment = indexOfId(head, ID_SEGMENT, 0, Math.min(head.length, 4096));
            if (segment < 0) return NONE;
            int[] cursor = {segment + 4};
            readVint(head, cursor);
            int segmentStart = cursor[0];
            // Level-1 elements up to the first Cluster: find the first SeekHead.
            while (cursor[0] + 12 < head.length) {
                int id = readId(head, cursor);
                long size = readVint(head, cursor);
                if (id == ID_CLUSTER || size < 0) return NONE;
                if (id != ID_SEEK_HEAD) {
                    cursor[0] += (int) Math.min(size, head.length);
                    continue;
                }
                int end = (int) Math.min(head.length, cursor[0] + size);
                long[] toSeekHead = findEntry(head, cursor[0], end, ID_SEEK_HEAD);
                if (findEntry(head, cursor[0], end, ID_CUES) != null || toSeekHead == null) return NONE;
                long second = segmentStart + toSeekHead[0];
                // Unbounded: the second SeekHead sits near the end, and a range past the end can be refused.
                byte[] tail = readRange(spec, second, 8 * 1024, false);
                int[] tailCursor = {0};
                if (tail.length < 16 || readId(tail, tailCursor) != ID_SEEK_HEAD) return NONE;
                long tailSize = readVint(tail, tailCursor);
                long[] cues = findEntry(tail, tailCursor[0], (int) Math.min(tail.length, tailCursor[0] + tailSize), ID_CUES);
                if (cues == null) return NONE;
                int positionLength = (int) toSeekHead[2];
                if (positionLength < 1 || positionLength > 8
                    || (positionLength < 8 && cues[0] >= (1L << (8 * positionLength)))) return NONE;
                byte[] positionBytes = new byte[positionLength];
                for (int i = 0; i < positionLength; i++) {
                    positionBytes[i] = (byte) (cues[0] >>> (8 * (positionLength - 1 - i)));
                }
                Log.i(TAG, "MKV seek index is behind a second SeekHead; pointing the first at Cues @" + cues[0]);
                return new Patch(
                    toSeekHead[3],
                    new byte[] {0x1C, 0x53, (byte) 0xBB, 0x6B},
                    toSeekHead[1],
                    positionBytes);
            }
        } catch (Throwable error) {
            Log.w(TAG, "MKV seek index probe skipped: " + error);
        }
        return NONE;
    }

    /**
     * A Seek entry for wantedId inside a SeekHead's bytes:
     * {position value, file-relative offset of the position bytes, their length, offset of the id bytes}.
     * Offsets are into data (which starts at file offset 0 for the head read).
     */
    @Nullable
    private static long[] findEntry(byte[] data, int from, int end, int wantedId) {
        int[] cursor = {from};
        while (cursor[0] + 4 < end) {
            int id = readId(data, cursor);
            long size = readVint(data, cursor);
            if (size < 0) return null;
            int entryEnd = (int) Math.min(end, cursor[0] + size);
            if (id == ID_SEEK) {
                int seekId = 0;
                int seekIdOffset = -1;
                int seekIdLength = 0;
                long seekPosition = -1;
                int positionOffset = -1;
                int positionLength = 0;
                int[] inner = {cursor[0]};
                while (inner[0] + 2 < entryEnd) {
                    int childId = readId(data, inner);
                    int childSize = (int) readVint(data, inner);
                    if (childSize < 0 || inner[0] + childSize > entryEnd) break;
                    if (childId == ID_SEEK_ID) {
                        seekIdOffset = inner[0];
                        seekIdLength = childSize;
                        seekId = 0;
                        for (int i = 0; i < childSize && i < 4; i++) seekId = (seekId << 8) | (data[inner[0] + i] & 0xFF);
                    } else if (childId == ID_SEEK_POSITION) {
                        positionOffset = inner[0];
                        positionLength = childSize;
                        seekPosition = 0;
                        for (int i = 0; i < childSize; i++) seekPosition = (seekPosition << 8) | (data[inner[0] + i] & 0xFF);
                    }
                    inner[0] += childSize;
                }
                // Only a 4-byte id can be swapped for the 4-byte Cues id.
                if (seekId == wantedId && seekIdLength == 4 && seekPosition >= 0) {
                    return new long[] {seekPosition, positionOffset, positionLength, seekIdOffset};
                }
            }
            cursor[0] = entryEnd;
        }
        return null;
    }

    private byte[] readRange(DataSpec spec, long position, int length, boolean bounded) throws IOException {
        DataSource source = probeFactory.createDataSource();
        try {
            source.open(spec.buildUpon().setPosition(position).setLength(bounded ? length : C.LENGTH_UNSET).build());
            byte[] out = new byte[length];
            int total = 0;
            while (total < length) {
                int read = source.read(out, total, length - total);
                if (read <= 0) break;
                total += read;
            }
            return total == length ? out : java.util.Arrays.copyOf(out, total);
        } finally {
            try {
                source.close();
            } catch (IOException ignored) {
                /* probe only */
            }
        }
    }

    private static int indexOfId(byte[] data, int id, int from, int to) {
        for (int i = from; i + 4 <= to; i++) {
            if ((data[i] & 0xFF) == ((id >>> 24) & 0xFF) && (data[i + 1] & 0xFF) == ((id >>> 16) & 0xFF)
                && (data[i + 2] & 0xFF) == ((id >>> 8) & 0xFF) && (data[i + 3] & 0xFF) == (id & 0xFF)) {
                return i;
            }
        }
        return -1;
    }

    /** EBML element id (1-4 bytes, marker bits kept), advancing the cursor. */
    private static int readId(byte[] data, int[] cursor) {
        int first = data[cursor[0]] & 0xFF;
        int length = first >= 0x80 ? 1 : first >= 0x40 ? 2 : first >= 0x20 ? 3 : 4;
        int id = 0;
        for (int i = 0; i < length && cursor[0] < data.length; i++) id = (id << 8) | (data[cursor[0]++] & 0xFF);
        return id;
    }

    /** EBML size (1-8 bytes, marker bit removed), advancing the cursor. -1 when malformed. */
    private static long readVint(byte[] data, int[] cursor) {
        if (cursor[0] >= data.length) return -1;
        int first = data[cursor[0]] & 0xFF;
        if (first == 0) return -1;
        int length = Integer.numberOfLeadingZeros(first) - 23;
        long value = first & (0xFF >>> length);
        cursor[0]++;
        for (int i = 1; i < length; i++) {
            if (cursor[0] >= data.length) return -1;
            value = (value << 8) | (data[cursor[0]++] & 0xFF);
        }
        return value;
    }
}
