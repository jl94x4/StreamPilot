package com.servermanagerportal.mediaplayer;

import android.content.Context;
import android.graphics.Bitmap;
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
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * "Who's on screen" (test): on pause, take the picture on screen, find faces with ML Kit
 * (offline), and match each one to the title's cast by comparing FaceNet embeddings with ones
 * made from the cast photos Plex already has. Everything runs on the TV. It never opens a second
 * video decoder: on TVs that allow one 4K decoder, that took the player's away mid-film.
 */
final class WhoIsOnScreen {
    private static final String TAG = "WhoIsOnScreen";
    private static final String MODEL_ASSET = "models/facenet.tflite";
    /** Cosine similarity a face needs to get a name, and its lead over the runner-up. */
    // 0.55 left correct names at ~51% (eyes closed, looking down) as guesses.
    static final float MATCH_MIN = 0.48f;
    static final float MATCH_MARGIN = 0.04f;

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

    /** Progress text while it works ("learning the cast 5/17"), from the worker thread. */
    interface Progress {
        void onStatus(String message);
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

    private final Context context;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private volatile int generation;

    WhoIsOnScreen(Context context) {
        this.context = context.getApplicationContext();
    }

    void cancel() {
        generation++;
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
                Map<Person, float[]> castVectors = castVectors(cast, loader, run, progress);
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
                ByteBuffer model = readAsset(MODEL_ASSET);
                Interpreter.Options options = new Interpreter.Options();
                options.setNumThreads(4);
                interpreter = new Interpreter(model, options);
                int[] in = interpreter.getInputTensor(0).shape();
                int[] out = interpreter.getOutputTensor(0).shape();
                if (in.length == 4) inputSize = in[1];
                if (out.length == 2) embeddingSize = out[1];
            }
            if (detector == null) {
                detector = FaceDetection.getClient(new FaceDetectorOptions.Builder()
                    .setPerformanceMode(FaceDetectorOptions.PERFORMANCE_MODE_ACCURATE)
                    .setMinFaceSize(0.05f)
                    .build());
            }
            if (photoDetector == null) {
                photoDetector = FaceDetection.getClient(new FaceDetectorOptions.Builder()
                    .setPerformanceMode(FaceDetectorOptions.PERFORMANCE_MODE_FAST)
                    .setMinFaceSize(0.2f)
                    .build());
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
            File dir = new File(context.getFilesDir(), "face-cast");
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

    /** Cast photo embeddings: memory, then disk, then learned from the photo (and saved). */
    private Map<Person, float[]> castVectors(List<Person> cast, ImageLoader loader, int run, Progress progress) throws Exception {
        Map<Person, float[]> out = new HashMap<>();
        int index = 0;
        for (Person person : cast) {
            index++;
            if (run != generation) break;
            if (person.thumb == null || person.thumb.isEmpty()) continue;
            float[] known = castEmbeddings.get(person.thumb);
            if (known == null && !castWithoutFace.contains(person.thumb)) {
                float[] saved = readCastCache(person.thumb);
                if (saved != null && saved.length == 0) castWithoutFace.add(person.thumb);
                else if (saved != null) castEmbeddings.put(person.thumb, saved);
                known = saved != null && saved.length > 0 ? saved : null;
            }
            if (known != null) {
                out.put(person, known);
                continue;
            }
            if (castWithoutFace.contains(person.thumb)) continue;
            if (progress != null) progress.onStatus("Who's on screen (test): learning the cast " + index + "/" + cast.size());
            Bitmap raw = loader.load(person.thumb);
            if (raw == null) {
                // Not saved to disk (it may load next time), but not retried on every pause either.
                castWithoutFace.add(person.thumb);
                continue;
            }
            Bitmap photo = shrinkPhoto(raw);
            List<Face> faces = detectPhoto(photo);
            Face largest = null;
            for (Face face : faces) {
                if (largest == null || area(face.getBoundingBox()) > area(largest.getBoundingBox())) largest = face;
            }
            if (largest == null) {
                castWithoutFace.add(person.thumb);
                writeCastCache(person.thumb, new float[0]);
                continue;
            }
            float[] vector = embed(photo, largest.getBoundingBox());
            castEmbeddings.put(person.thumb, vector);
            writeCastCache(person.thumb, vector);
            out.put(person, vector);
        }
        return out;
    }

    private static void match(Bitmap frame, List<Face> faces, Map<Person, float[]> castVectors, Result result) {
        List<float[]> vectors = new ArrayList<>();
        for (Face face : faces) {
            Rect box = face.getBoundingBox();
            FoundFace found = new FoundFace(new RectF(
                clamp01((float) box.left / frame.getWidth()),
                clamp01((float) box.top / frame.getHeight()),
                clamp01((float) box.right / frame.getWidth()),
                clamp01((float) box.bottom / frame.getHeight())));
            result.faces.add(found);
            vectors.add(embed(frame, box));
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
                for (Map.Entry<Person, float[]> entry : castVectors.entrySet()) {
                    if (taken.contains(entry.getKey())) continue;
                    float score = cosine(vectors.get(i), entry.getValue());
                    if (score > bestScore) {
                        bestScore = score;
                        bestFace = i;
                        bestPerson = entry.getKey();
                    }
                }
            }
            if (bestFace < 0 || bestScore < MATCH_MIN) break;
            float runnerUp = -1f;
            for (Map.Entry<Person, float[]> entry : castVectors.entrySet()) {
                if (entry.getKey() == bestPerson || taken.contains(entry.getKey())) continue;
                runnerUp = Math.max(runnerUp, cosine(vectors.get(bestFace), entry.getValue()));
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
            for (Map.Entry<Person, float[]> entry : castVectors.entrySet()) {
                float score = cosine(vectors.get(i), entry.getValue());
                if (score > found.score) {
                    found.score = score;
                    found.bestGuess = entry.getKey().name;
                }
            }
        }
    }

    /** FaceNet: a margin round the face, 160×160, per-image standardised, L2-normalised out. */
    private static float[] embed(Bitmap source, Rect box) {
        int margin = Math.round(Math.max(box.width(), box.height()) * 0.12f);
        int left = Math.max(0, box.left - margin);
        int top = Math.max(0, box.top - margin);
        int right = Math.min(source.getWidth(), box.right + margin);
        int bottom = Math.min(source.getHeight(), box.bottom + margin);
        Bitmap crop = Bitmap.createBitmap(source, left, top, Math.max(1, right - left), Math.max(1, bottom - top));
        Bitmap scaled = Bitmap.createScaledBitmap(crop, inputSize, inputSize, true);
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
        float[] vector = output[0];
        double norm = 0;
        for (float v : vector) norm += v * v;
        norm = Math.sqrt(norm);
        if (norm > 0) {
            for (int i = 0; i < vector.length; i++) vector[i] = (float) (vector[i] / norm);
        }
        if (crop != source) crop.recycle();
        scaled.recycle();
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
