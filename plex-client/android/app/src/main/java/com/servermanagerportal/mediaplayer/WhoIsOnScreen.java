package com.servermanagerportal.mediaplayer;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Matrix;
import android.graphics.Paint;
import android.graphics.PointF;
import android.graphics.Rect;
import android.graphics.RectF;
import android.os.SystemClock;
import android.util.Log;

import androidx.annotation.Nullable;

import com.google.android.gms.tasks.Tasks;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.face.Face;
import com.google.mlkit.vision.face.FaceDetection;
import com.google.mlkit.vision.face.FaceDetector;
import com.google.mlkit.vision.face.FaceDetectorOptions;
import com.google.mlkit.vision.face.FaceLandmark;

import org.tensorflow.lite.Interpreter;

import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.security.MessageDigest;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * "Who's on screen": on pause, take the picture on screen, find faces with ML Kit
 * (offline), and match each one to the title's cast by comparing FaceNet embeddings with ones
 * made from the cast photos Plex already has. Everything runs on the TV. It never opens a second
 * video decoder: on TVs that allow one 4K decoder, that took the player's away mid-film.
 */
final class WhoIsOnScreen {
    private static final String TAG = "WhoIsOnScreen";
    private static final String MODEL_ASSET = "models/facenet.tflite";
    /** Cosine similarity a face needs to get a name, and its lead over the runner-up. */
    // Only the title's Plex cast can be named, so someone missing from it (common on WWE and
    // other thin cast lists) took the nearest-looking cast member's name at 0.48 / 0.04.
    // No name beats a wrong one: some real cast in poor shots (eyes closed, looking down)
    // go unnamed again, as they did at 0.55.
    static final float MATCH_MIN = 0.58f;
    static final float MATCH_MARGIN = 0.08f;

    static final class Person {
        final String id;
        final String name;
        final String role;
        final String thumb;

        Person(String id, String name, String role, String thumb) {
            this.id = id;
            this.name = name;
            this.role = role;
            this.thumb = thumb;
        }
    }

    static final class FoundFace {
        /** Box in 0..1 of the frame. */
        final RectF box;
        @Nullable Person person;
        float score;
        @Nullable String bestGuess;
        /** This face's embedding, kept so a "Who is this?" pick can be learned from it. */
        @Nullable float[] vector;
        /** Everyone it was compared with, closest first: the order the picker lists them in. */
        final List<Person> ranked = new ArrayList<>();

        FoundFace(RectF box) {
            this.box = box;
        }
    }

    static final class Result {
        final List<FoundFace> faces = new ArrayList<>();
        int frameWidth;
        int frameHeight;
        long frameMs;
        long detectMs;
        long castMs;
        long matchMs;
        int castWithFaces;
        int castTotal;
        @Nullable String error;
    }

    interface ImageLoader {
        @Nullable Bitmap load(String url);
    }

    interface Callback {
        void onResult(Result result);
    }

    /** First pause in a title: which cast photo it is learning, from the worker thread. */
    interface Progress {
        void onLearning(int index, int total);
    }

    /** Cast photos are headshots: this size is plenty to find and read the face, and fast. */
    private static final int PHOTO_MAX_SIDE = 320;

    /** One model, one detector and one set of cast embeddings for the whole app process. */
    private static Interpreter interpreter;
    private static int inputSize = 160;
    private static int embeddingSize = 128;
    /** Frame: accurate, for small faces in a wide shot. Cast photos: fast, one big face each. */
    private static FaceDetector detector;
    private static FaceDetector photoDetector;
    private static final Map<String, float[]> castEmbeddings = new HashMap<>();
    private static final Set<String> castWithoutFace = new HashSet<>();
    /**
     * Faces you named with "Who is this?", per person (by name, so they carry across titles
     * and servers): screen shots of them are far better references than one promo photo.
     * Only touched on the worker thread.
     */
    private static final Map<String, List<float[]>> learnedFaces = new HashMap<>();
    private static final int LEARNED_MAX = 16;

    private final Context context;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private volatile int generation;

    WhoIsOnScreen(Context context) {
        this.context = context.getApplicationContext();
    }

    void cancel() {
        generation++;
    }

    /** "Who is this?" answered: keep this face as one more reference for that person. */
    void learn(Person person, @Nullable float[] vector) {
        if (vector == null || vector.length == 0) return;
        final float[] copy = vector.clone();
        worker.execute(() -> {
            String key = personKey(person);
            if (key.isEmpty()) return;
            List<float[]> refs = new ArrayList<>(learnedFor(person));
            refs.add(copy);
            while (refs.size() > LEARNED_MAX) refs.remove(0);
            learnedFaces.put(key, refs);
            writeLearned(key, refs);
        });
    }

    private static String personKey(Person person) {
        return person.name == null ? "" : person.name.trim().toLowerCase(Locale.ROOT);
    }

    private List<float[]> learnedFor(Person person) {
        String key = personKey(person);
        if (key.isEmpty()) return new ArrayList<>();
        List<float[]> known = learnedFaces.get(key);
        if (known == null) {
            known = readLearned(key);
            learnedFaces.put(key, known);
        }
        return known;
    }

    @Nullable
    private File learnedFile(String key) {
        try {
            MessageDigest sha = MessageDigest.getInstance("SHA-1");
            StringBuilder hex = new StringBuilder();
            for (byte b : sha.digest(key.getBytes("UTF-8"))) hex.append(String.format("%02x", b));
            File dir = new File(context.getFilesDir(), "face-learned-v2");
            if (!dir.exists() && !dir.mkdirs()) return null;
            return new File(dir, hex + ".vecs");
        } catch (Exception error) {
            return null;
        }
    }

    private List<float[]> readLearned(String key) {
        List<float[]> out = new ArrayList<>();
        File file = learnedFile(key);
        if (file == null || !file.exists()) return out;
        try (DataInputStream in = new DataInputStream(new FileInputStream(file))) {
            int count = in.readInt();
            int size = in.readInt();
            if (count < 0 || count > LEARNED_MAX || size <= 0 || size > 4096) return out;
            for (int n = 0; n < count; n++) {
                float[] vector = new float[size];
                for (int i = 0; i < size; i++) vector[i] = in.readFloat();
                out.add(vector);
            }
        } catch (Exception error) {
            out.clear();
        }
        return out;
    }

    private void writeLearned(String key, List<float[]> refs) {
        File file = learnedFile(key);
        if (file == null || refs.isEmpty()) return;
        try (DataOutputStream out = new DataOutputStream(new FileOutputStream(file))) {
            out.writeInt(refs.size());
            out.writeInt(refs.get(0).length);
            for (float[] vector : refs) {
                for (float v : vector) out.writeFloat(v);
            }
        } catch (Exception ignored) {
            /* the in-memory copy still works this session */
        }
    }

    void shutdown() {
        cancel();
        worker.shutdownNow();
    }

    /** frame: the paused picture copied off the video surface; frameMs: how long that copy took. */
    void run(Bitmap frame, long frameMs, List<Person> cast, ImageLoader loader, Progress progress, Callback callback) {
        final int run = ++generation;
        worker.execute(() -> {
            Result result = new Result();
            try {
                ensureModels();
                if (run != generation) return;
                result.frameMs = frameMs;
                result.frameWidth = frame.getWidth();
                result.frameHeight = frame.getHeight();
                if (run != generation) return;

                long t1 = SystemClock.elapsedRealtime();
                List<Face> faces = detect(frame);
                result.detectMs = SystemClock.elapsedRealtime() - t1;
                if (run != generation) return;
                result.castTotal = cast.size();
                if (faces.isEmpty()) {
                    // Nobody in shot: no need to learn the cast at all.
                    callback.onResult(result);
                    return;
                }

                long t2 = SystemClock.elapsedRealtime();
                Map<Person, List<float[]>> castVectors = castVectors(cast, loader, run, progress);
                result.castMs = SystemClock.elapsedRealtime() - t2;
                result.castTotal = cast.size();
                result.castWithFaces = castVectors.size();
                if (run != generation) return;

                long t3 = SystemClock.elapsedRealtime();
                match(frame, faces, castVectors, result);
                result.matchMs = SystemClock.elapsedRealtime() - t3;
                if (run != generation) return;
                callback.onResult(result);
            } catch (Throwable error) {
                Log.w(TAG, "Face test failed", error);
                if (run != generation) return;
                result.error = "Face test failed: " + error.getClass().getSimpleName();
                callback.onResult(result);
            }
        });
    }

    private void ensureModels() throws Exception {
        synchronized (WhoIsOnScreen.class) {
            if (interpreter == null) {
                ByteBuffer model = mapAsset(MODEL_ASSET);
                Interpreter.Options options = new Interpreter.Options();
                options.setNumThreads(2);
                interpreter = new Interpreter(model, options);
                int[] in = interpreter.getInputTensor(0).shape();
                int[] out = interpreter.getOutputTensor(0).shape();
                if (in.length == 4) inputSize = in[1];
                if (out.length == 2) embeddingSize = out[1];
            }
            if (detector == null) {
                detector = FaceDetection.getClient(new FaceDetectorOptions.Builder()
                    .setPerformanceMode(FaceDetectorOptions.PERFORMANCE_MODE_ACCURATE)
                    .setLandmarkMode(FaceDetectorOptions.LANDMARK_MODE_ALL)
                    .setMinFaceSize(0.05f)
                    .build());
            }
            if (photoDetector == null) {
                photoDetector = FaceDetection.getClient(new FaceDetectorOptions.Builder()
                    .setPerformanceMode(FaceDetectorOptions.PERFORMANCE_MODE_FAST)
                    .setLandmarkMode(FaceDetectorOptions.LANDMARK_MODE_ALL)
                    .setMinFaceSize(0.2f)
                    .build());
            }
        }
    }

    /**
     * The model is stored uncompressed in the APK (noCompress 'tflite'), so it can be mapped in
     * place: no copy on the heap. Reading it whole made three 24 MB copies at once.
     */
    private ByteBuffer mapAsset(String name) throws Exception {
        try (android.content.res.AssetFileDescriptor fd = context.getAssets().openFd(name);
             FileInputStream in = new FileInputStream(fd.getFileDescriptor())) {
            return in.getChannel().map(java.nio.channels.FileChannel.MapMode.READ_ONLY,
                fd.getStartOffset(), fd.getDeclaredLength());
        } catch (Exception compressed) {
            return readAsset(name);
        }
    }

    /** Leaving the player: close the model and detectors (learned faces stay on disk). */
    static void release() {
        synchronized (WhoIsOnScreen.class) {
            if (interpreter != null) {
                interpreter.close();
                interpreter = null;
            }
            if (detector != null) {
                detector.close();
                detector = null;
            }
            if (photoDetector != null) {
                photoDetector.close();
                photoDetector = null;
            }
        }
    }

    private ByteBuffer readAsset(String name) throws Exception {
        try (InputStream in = context.getAssets().open(name);
             ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
            byte[] bytes = out.toByteArray();
            ByteBuffer direct = ByteBuffer.allocateDirect(bytes.length).order(ByteOrder.nativeOrder());
            direct.put(bytes);
            direct.rewind();
            return direct;
        }
    }

    private static List<Face> detect(Bitmap bitmap) throws Exception {
        return Tasks.await(detector.process(InputImage.fromBitmap(bitmap, 0)));
    }

    private static List<Face> detectPhoto(Bitmap bitmap) throws Exception {
        return Tasks.await(photoDetector.process(InputImage.fromBitmap(bitmap, 0)));
    }

    /** Full-size TMDB / Plex headshots can be thousands of pixels: shrink before any work. */
    private static Bitmap shrinkPhoto(Bitmap photo) {
        int longest = Math.max(photo.getWidth(), photo.getHeight());
        Bitmap out = photo;
        if (longest > PHOTO_MAX_SIDE) {
            float scale = PHOTO_MAX_SIDE / (float) longest;
            out = Bitmap.createScaledBitmap(photo,
                Math.max(1, Math.round(photo.getWidth() * scale)),
                Math.max(1, Math.round(photo.getHeight() * scale)), true);
        }
        if (out.getConfig() != Bitmap.Config.ARGB_8888) out = out.copy(Bitmap.Config.ARGB_8888, false);
        return out;
    }

    /** Learned cast faces live on disk, so each person is learned once ever, not per session. */
    private File castCacheFile(String url) {
        try {
            MessageDigest sha = MessageDigest.getInstance("SHA-1");
            StringBuilder hex = new StringBuilder();
            for (byte b : sha.digest(url.getBytes("UTF-8"))) hex.append(String.format("%02x", b));
            // v2: aligned + mirrored embeddings. The older unaligned ones don't compare.
            File dir = new File(context.getFilesDir(), "face-cast-v2");
            if (!dir.exists() && !dir.mkdirs()) return null;
            return new File(dir, hex + ".vec");
        } catch (Exception error) {
            return null;
        }
    }

    /** null: not learned yet. Empty array: the photo has no usable face. */
    @Nullable
    private float[] readCastCache(String url) {
        File file = castCacheFile(url);
        if (file == null || !file.exists()) return null;
        try (DataInputStream in = new DataInputStream(new FileInputStream(file))) {
            int count = in.readInt();
            if (count < 0 || count > 4096) return null;
            float[] vector = new float[count];
            for (int i = 0; i < count; i++) vector[i] = in.readFloat();
            return vector;
        } catch (Exception error) {
            return null;
        }
    }

    private void writeCastCache(String url, float[] vector) {
        File file = castCacheFile(url);
        if (file == null) return;
        try (DataOutputStream out = new DataOutputStream(new FileOutputStream(file))) {
            out.writeInt(vector.length);
            for (float v : vector) out.writeFloat(v);
        } catch (Exception ignored) {
            /* the in-memory copy still works this session */
        }
    }

    /**
     * Each person's references: their cast photo (memory, then disk, then learned and saved)
     * plus any faces you named. Someone whose photo has no usable face still counts if named.
     */
    private Map<Person, List<float[]>> castVectors(List<Person> cast, ImageLoader loader, int run, Progress progress) throws Exception {
        Map<Person, List<float[]>> out = new HashMap<>();
        int index = 0;
        for (Person person : cast) {
            index++;
            if (run != generation) break;
            List<float[]> refs = new ArrayList<>(learnedFor(person));
            float[] photo = photoVector(person, loader, index, cast.size(), progress);
            if (photo != null) refs.add(0, photo);
            if (!refs.isEmpty()) out.put(person, refs);
        }
        return out;
    }

    @Nullable
    private float[] photoVector(Person person, ImageLoader loader, int index, int total, Progress progress) throws Exception {
        if (person.thumb == null || person.thumb.isEmpty()) return null;
        float[] known = castEmbeddings.get(person.thumb);
        if (known == null && !castWithoutFace.contains(person.thumb)) {
            float[] saved = readCastCache(person.thumb);
            if (saved != null && saved.length == 0) castWithoutFace.add(person.thumb);
            else if (saved != null) castEmbeddings.put(person.thumb, saved);
            known = saved != null && saved.length > 0 ? saved : null;
        }
        if (known != null) return known;
        if (castWithoutFace.contains(person.thumb)) return null;
        if (progress != null) progress.onLearning(index, total);
        Bitmap raw = loader.load(person.thumb);
        if (raw == null) {
            // Not saved to disk (it may load next time), but not retried on every pause either.
            castWithoutFace.add(person.thumb);
            return null;
        }
        Bitmap photo = shrinkPhoto(raw);
        try {
            List<Face> faces = detectPhoto(photo);
            Face largest = null;
            for (Face face : faces) {
                if (largest == null || area(face.getBoundingBox()) > area(largest.getBoundingBox())) largest = face;
            }
            if (largest == null) {
                castWithoutFace.add(person.thumb);
                writeCastCache(person.thumb, new float[0]);
                return null;
            }
            float[] vector = embed(photo, largest);
            castEmbeddings.put(person.thumb, vector);
            writeCastCache(person.thumb, vector);
            return vector;
        } finally {
            // A cast of thirty headshots piled up in memory on small TVs until the system killed the app.
            if (photo != raw && !photo.isRecycled()) photo.recycle();
            if (!raw.isRecycled()) raw.recycle();
        }
    }

    /** A face against one person: the closest of their photo and the faces you named. */
    private static float bestScore(float[] face, List<float[]> refs) {
        float best = -1f;
        for (float[] ref : refs) best = Math.max(best, cosine(face, ref));
        return best;
    }

    private static void match(Bitmap frame, List<Face> faces, Map<Person, List<float[]>> castVectors, Result result) {
        List<float[]> vectors = new ArrayList<>();
        for (Face face : faces) {
            Rect box = face.getBoundingBox();
            FoundFace found = new FoundFace(new RectF(
                clamp01((float) box.left / frame.getWidth()),
                clamp01((float) box.top / frame.getHeight()),
                clamp01((float) box.right / frame.getWidth()),
                clamp01((float) box.bottom / frame.getHeight())));
            float[] vector = embed(frame, face);
            found.vector = vector;
            result.faces.add(found);
            vectors.add(vector);
        }
        // Greedy: the strongest face/person pairs first, so one person never names two faces.
        Set<Person> taken = new HashSet<>();
        boolean[] named = new boolean[faces.size()];
        while (true) {
            int bestFace = -1;
            Person bestPerson = null;
            float bestScore = -1f;
            for (int i = 0; i < vectors.size(); i++) {
                if (named[i]) continue;
                for (Map.Entry<Person, List<float[]>> entry : castVectors.entrySet()) {
                    if (taken.contains(entry.getKey())) continue;
                    float score = bestScore(vectors.get(i), entry.getValue());
                    if (score > bestScore) {
                        bestScore = score;
                        bestFace = i;
                        bestPerson = entry.getKey();
                    }
                }
            }
            if (bestFace < 0 || bestScore < MATCH_MIN) break;
            float runnerUp = -1f;
            for (Map.Entry<Person, List<float[]>> entry : castVectors.entrySet()) {
                if (entry.getKey() == bestPerson || taken.contains(entry.getKey())) continue;
                runnerUp = Math.max(runnerUp, bestScore(vectors.get(bestFace), entry.getValue()));
            }
            named[bestFace] = true;
            FoundFace found = result.faces.get(bestFace);
            found.score = bestScore;
            if (bestScore - runnerUp >= MATCH_MARGIN) {
                found.person = bestPerson;
                taken.add(bestPerson);
            } else {
                found.bestGuess = bestPerson.name;
            }
        }
        // Unnamed faces: keep the nearest name and score for the test readout.
        for (int i = 0; i < vectors.size(); i++) {
            FoundFace found = result.faces.get(i);
            if (found.person != null || found.bestGuess != null) continue;
            for (Map.Entry<Person, List<float[]>> entry : castVectors.entrySet()) {
                float score = bestScore(vectors.get(i), entry.getValue());
                if (score > found.score) {
                    found.score = score;
                    found.bestGuess = entry.getKey().name;
                }
            }
        }
        // Everyone, closest first, for "Who is this?" (photo-less cast last, in cast order).
        for (int i = 0; i < vectors.size(); i++) {
            final float[] vector = vectors.get(i);
            List<Person> order = new ArrayList<>(castVectors.keySet());
            Collections.sort(order, (a, b) -> Float.compare(
                bestScore(vector, castVectors.get(b)), bestScore(vector, castVectors.get(a))));
            result.faces.get(i).ranked.addAll(order);
        }
    }

    /**
     * FaceNet input for one face, compared twice: the face straightened so the eyes are level
     * (the model expects aligned faces; a tilted head scored low against a straight headshot),
     * and its mirror image. The two are averaged, which steadies angled shots.
     */
    private static float[] embed(Bitmap source, Face face) {
        Rect box = face.getBoundingBox();
        float tilt = eyeTiltDegrees(face);
        float[] a = embedPixels(alignedCrop(source, box, tilt, false));
        float[] b = embedPixels(alignedCrop(source, box, tilt, true));
        float[] vector = new float[a.length];
        for (int i = 0; i < a.length; i++) vector[i] = a[i] + b[i];
        return normalize(vector);
    }

    /** Angle of the line between the eyes, 0 when ML Kit gave no eye landmarks. */
    private static float eyeTiltDegrees(Face face) {
        FaceLandmark left = face.getLandmark(FaceLandmark.LEFT_EYE);
        FaceLandmark right = face.getLandmark(FaceLandmark.RIGHT_EYE);
        if (left == null || right == null) return 0f;
        PointF a = left.getPosition();
        PointF b = right.getPosition();
        // Left to right on screen, whichever eye ML Kit calls left.
        PointF first = a.x <= b.x ? a : b;
        PointF second = a.x <= b.x ? b : a;
        float degrees = (float) Math.toDegrees(Math.atan2(second.y - first.y, second.x - first.x));
        // Past ~40° the landmarks are usually wrong (profile, occlusion): don't spin the face.
        return Math.abs(degrees) > 40f ? 0f : degrees;
    }

    /**
     * The same framing as before (the box plus a 12% margin, centred on the box) drawn straight
     * into the model's input size, rotated by -tilt round the box centre and optionally mirrored.
     * Outside the picture stays black.
     */
    private static Bitmap alignedCrop(Bitmap source, Rect box, float tilt, boolean mirror) {
        float side = Math.max(box.width(), box.height()) * 1.24f;
        float scale = inputSize / Math.max(1f, side);
        Matrix m = new Matrix();
        m.postTranslate(-box.exactCenterX(), -box.exactCenterY());
        m.postRotate(-tilt);
        m.postScale(mirror ? -scale : scale, scale);
        m.postTranslate(inputSize / 2f, inputSize / 2f);
        Bitmap out = Bitmap.createBitmap(inputSize, inputSize, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(out);
        canvas.drawColor(Color.BLACK);
        canvas.drawBitmap(source, m, new Paint(Paint.FILTER_BITMAP_FLAG));
        return out;
    }

    /** One model run on an inputSize² face: per-image standardised in, L2-normalised out. */
    private static float[] embedPixels(Bitmap scaled) {
        int count = inputSize * inputSize;
        int[] pixels = new int[count];
        scaled.getPixels(pixels, 0, inputSize, 0, 0, inputSize, inputSize);
        double sum = 0;
        double sumSq = 0;
        for (int p : pixels) {
            int r = (p >> 16) & 0xFF;
            int g = (p >> 8) & 0xFF;
            int b = p & 0xFF;
            sum += r + g + b;
            sumSq += (double) r * r + (double) g * g + (double) b * b;
        }
        int n = count * 3;
        double mean = sum / n;
        double std = Math.max(Math.sqrt(Math.max(0, sumSq / n - mean * mean)), 1.0 / Math.sqrt(n));
        ByteBuffer input = ByteBuffer.allocateDirect(n * 4).order(ByteOrder.nativeOrder());
        for (int p : pixels) {
            input.putFloat((float) ((((p >> 16) & 0xFF) - mean) / std));
            input.putFloat((float) ((((p >> 8) & 0xFF) - mean) / std));
            input.putFloat((float) (((p & 0xFF) - mean) / std));
        }
        input.rewind();
        float[][] output = new float[1][embeddingSize];
        synchronized (WhoIsOnScreen.class) {
            interpreter.run(input, output);
        }
        scaled.recycle();
        return normalize(output[0]);
    }

    private static float[] normalize(float[] vector) {
        double norm = 0;
        for (float v : vector) norm += v * v;
        norm = Math.sqrt(norm);
        if (norm > 0) {
            for (int i = 0; i < vector.length; i++) vector[i] = (float) (vector[i] / norm);
        }
        return vector;
    }

    private static float cosine(float[] a, float[] b) {
        float dot = 0f;
        for (int i = 0; i < Math.min(a.length, b.length); i++) dot += a[i] * b[i];
        return dot;
    }

    private static int area(Rect rect) {
        return Math.max(0, rect.width()) * Math.max(0, rect.height());
    }

    private static float clamp01(float value) {
        return Math.max(0f, Math.min(1f, value));
    }
}
