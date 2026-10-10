package com.servermanagerportal.mediaplayer;

import android.app.PictureInPictureParams;
import android.app.UiModeManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;
import android.util.Rational;
import android.view.KeyEvent;
import android.view.LayoutInflater;
import android.view.Surface;
import android.view.SurfaceView;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.ImageButton;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.SeekBar;
import android.widget.TextView;
import android.widget.Toast;
import android.webkit.CookieManager;

import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.Format;
import androidx.media3.common.MediaItem;
import androidx.media3.common.VideoSize;
import androidx.media3.common.audio.AudioProcessor;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.PlaybackParameters;
import androidx.media3.common.Player;
import androidx.media3.common.Tracks;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.DefaultLoadControl;
import androidx.media3.exoplayer.DefaultRenderersFactory;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.audio.AudioSink;
import androidx.media3.exoplayer.audio.DefaultAudioSink;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.extractor.DefaultExtractorsFactory;
import androidx.media3.ui.CaptionStyleCompat;
import androidx.media3.ui.PlayerView;
import androidx.media3.ui.SubtitleView;

import com.getcapacitor.JSObject;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.nio.charset.StandardCharsets;
import java.net.URI;
import java.net.URL;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Collections;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@UnstableApi
public class PlayerActivity extends AppCompatActivity {
    private static final String TAG = "SmpPlayerActivity";
    private static final String USER_AGENT = "StreamPilot-MediaPlayer/1.0 (Android TV; ExoPlayer)";
    private static final String PREFS = "smp_player_prefs";

    public static final String EXTRA_URL = "url";
    public static final String EXTRA_TITLE = "title";
    public static final String EXTRA_LOGO_URL = "logoUrl";
    public static final String EXTRA_OFFSET_MS = "offsetMs";
    public static final String EXTRA_HEADERS_JSON = "headersJson";
    public static final String EXTRA_SESSION_JSON = "sessionJson";
    public static final String EXTRA_SPEED = "speed";
    public static final String EXTRA_AUTOPLAY_NEXT = "autoplayNext";
    public static final String EXTRA_AUTO_SKIP_INTRO = "autoSkipIntro";
    public static final String EXTRA_AUTO_SKIP_CREDITS = "autoSkipCredits";
    public static final String EXTRA_ENDED = "ended";
    public static final String EXTRA_POSITION_MS = "positionMs";
    public static final String EXTRA_ERROR = "error";
    public static final String EXTRA_PLAY_NEXT = "playNext";
    public static final String EXTRA_NEXT_RATING_KEY = "nextRatingKey";

    private ExoPlayer player;
    private DefaultHttpDataSource.Factory httpFactory;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    private View chrome;
    private View topBar;
    private View bufferingView;
    private TextView errorView;
    private SeekBar seekBar;
    private TextView timeView;
    private TextView speedLabel;
    private TextView titleView;
    private ImageView logoView;
    private ImageView artView;
    private TextView upNextLabel;
    private ImageButton playPauseBtn;
    private Button skipIntroBtn;
    private TextView upNextKicker;
    private TextView upNextCountdown;
    private ImageView upNextArt;
    private Button upNextPlayBtn;
    private Button upNextCreditsBtn;
    private boolean watchCreditsChosen;
    private TextView statsView;
    private boolean statsVisible;
    private boolean confirmLongPress;
    private TextView clockView;
    private String lastClockLabel = "";
    private Button skipCreditsBtn;
    private Button qualityBtn;
    private Button audioBtn;
    private Button subsBtn;
    private Button versionBtn;
    private Button speedBtn;
    private Button sleepBtn;
    private Button externalBtn;
    private LinearLayout upNextRow;
    private View skipRow;
    private Button pipBtn;
    private Button chaptersBtn;
    private Button zoomBtn;
    private Button delayBtn;
    private Button repeatBtn;
    private ImageView seekPreview;
    private View menuScrim;
    private TextView menuTitle;
    private ScrollView menuScroll;
    private LinearLayout menuList;

    private boolean playbackEnded;
    private boolean playbackError;
    private int streamFallbackStage;
    /** Bumped when a new stream starts so a pending failure exit does not close a recovered player. */
    private int errorGeneration;
    private boolean finishing;
    private boolean seekingUi;
    private boolean chromeVisible = true;
    private boolean skippedIntro;
    private boolean skippedCredits;
    private boolean skipFocusGiven;
    private boolean userPaused;
    private long pendingSeekMs;
    /** Content time already skipped by a transcode URL offset. Player time starts at 0. */
    private long timelineOriginMs;
    /** Resume offset passed with the current transcode. Cleared once the timeline is checked. */
    private long transcodeAnchorMs;
    private long scrubTargetMs = -1;
    /** Keep the bar on the scrubbed time until playback catches up. */
    private long scrubHoldUntilMs;
    private long pendingTranscodeSeekMs = -1;
    private long lastSeekTargetMs = -1;
    private long lastSeekAtMs;
    /** One HTTP failure after a seek can reload the stream. A second one is shown. */
    private boolean seekRecoveryUsed;
    /** The previous playlist 404s while a replacement stream is opening. Ignore that. */
    private boolean streamSwapInFlight;
    private float playbackSpeed = 1f;
    private boolean autoplayNext = true;
    private boolean autoSkipIntro;
    private boolean autoSkipCredits;
    private long sleepUntilElapsedRealtime;
    private boolean sleepEndOfEpisode;

    private String currentUrl = "";
    private String headersJson = "";
    private String qualityId = "";
    private String audioStreamId = "";
    private String subtitleStreamId = "";
    private int mediaIndex;
    private long durationHintMs;
    private long introStartMs = -1;
    private long introEndMs = -1;
    private long creditsStartMs = -1;
    private long creditsEndMs = -1;
    private String nextRatingKey = "";
    private String nextTitle = "";
    private String nextThumbUrl = "";
    private String loadedUpNextThumb = "";
    private String streamMode = "";
    private int streamWidth;
    private int streamHeight;
    private int streamBitrate;
    private String streamVideoCodec = "";
    private String streamAudioCodec = "";
    private String streamContainer = "";
    private String streamResolution = "";
    private String ratingKey = "";
    private String showKey = "";
    private String titleText = "";
    private String subtitleText = "";
    private String logoUrl = "";
    private String artUrl = "";
    private boolean musicMode;
    private boolean minimized;
    private String pendingLogoUrl = "";
    private String loadedLogoUrl = "";
    private String loadedArtUrl = "";
    private int logoLoadGeneration;
    private final ExecutorService logoExecutor = Executors.newSingleThreadExecutor();

    private final List<OptionItem> qualities = new ArrayList<>();
    private final List<OptionItem> audioTracks = new ArrayList<>();
    private final List<OptionItem> subtitles = new ArrayList<>();
    private final List<OptionItem> versions = new ArrayList<>();
    private final List<OptionItem> chapters = new ArrayList<>();
    private String previewThumbTemplate = "";
    private float videoFrameRate;
    private boolean nightMode;
    private boolean matchFrameRate = true;
    private int subtitleSizePct = 100;
    private String subtitleColor = "#ffffff";
    private String subtitleBackground = "none";
    private String subtitlePosition = "bottom";
    private int previewGeneration;
    private final DelayAudioProcessor delayAudioProcessor = new DelayAudioProcessor();
    private float videoZoom = 1f;
    private boolean videoFill;
    private int audioDelayMs;
    private int repeatMode;
    private String sidecarSubtitleUrl = "";
    private boolean subtitleSearchPending;
    private String timelineOrigin = "";
    private String timelineToken = "";
    private String timelineClientId = "";
    private String timelineProduct = "StreamPilot";
    private String timelineVersion = "1.0.0";
    private String timelinePlatform = "Android";
    private String timelineDevice = "Android TV";
    private String timelineDeviceName = "StreamPilot";
    private String timelineSessionId = "";
    private long lastTimelinePingElapsedMs;
    private String lastTimelineState = "";
    private int timelineKeepAliveTicks;

    private final Runnable hideChromeRunnable = () -> {
        if (isOptionDialogShowing()) return;
        setChromeVisible(false);
    };
    private final Runnable clearSwapRunnable = () -> streamSwapInFlight = false;
    private final Runnable directSeekRunnable = () -> {
        if (player == null || scrubTargetMs < 0) return;
        player.seekTo(Math.max(0, scrubTargetMs - timelineOriginMs));
        emitProgress("playing");
    };
    private final Runnable transcodeSeekRunnable = () -> {
        long target = pendingTranscodeSeekMs;
        pendingTranscodeSeekMs = -1;
        if (target < 0) return;
        markStreamSwap();
        requestStreamChange(qualityId, audioStreamId, subtitleStreamId, mediaIndex, target, "seek");
    };
    private final Runnable tickRunnable = new Runnable() {
        @Override
        public void run() {
            updateProgressUi();
            updateWallClock();
            maybeAutoSkip();
            maybeShowUpNext();
            if (statsVisible) refreshStatsOverlay();
            maybeSleepTimer();
            String state = "paused";
            if (player != null && player.isPlaying()) state = "playing";
            else if (player != null && player.getPlaybackState() == Player.STATE_BUFFERING) state = "buffering";
            emitProgress(state);
            timelineKeepAliveTicks += 1;
            if (timelineKeepAliveTicks % 5 == 0) PlayerBridge.get().keepHostWebViewAlive();
            mainHandler.postDelayed(this, 1000);
        }
    };
    private final Runnable progressEmitRunnable = new Runnable() {
        @Override
        public void run() {
            if (player != null && player.isPlaying()) {
                emitProgress("playing");
            }
            mainHandler.postDelayed(this, minimized ? 1000 : 5000);
        }
    };

    private static final String SUBTITLE_SEARCH_ID = "__search__";

    private static final class OptionItem {
        final String id;
        final String label;
        final String url;

        OptionItem(String id, String label) {
            this(id, label, "");
        }

        OptionItem(String id, String label, String url) {
            this.id = id;
            this.label = label;
            this.url = url == null ? "" : url;
        }
    }

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        PlayerBridge.get().attachActivity(this);
        try {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
            WindowInsetsControllerCompat insets = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
            if (insets != null) {
                insets.hide(WindowInsetsCompat.Type.systemBars());
                insets.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
            setContentView(R.layout.activity_player);
            bindViews();

            Intent intent = getIntent();
            currentUrl = intent.getStringExtra(EXTRA_URL);
            String title = intent.getStringExtra(EXTRA_TITLE);
            titleText = title == null ? "" : title.trim();
            String extraLogo = intent.getStringExtra(EXTRA_LOGO_URL);
            logoUrl = extraLogo == null ? "" : extraLogo.trim();
            pendingSeekMs = Math.max(0, intent.getIntExtra(EXTRA_OFFSET_MS, 0));
            headersJson = intent.getStringExtra(EXTRA_HEADERS_JSON);
            playbackSpeed = intent.getFloatExtra(EXTRA_SPEED, 1f);
            autoplayNext = intent.getBooleanExtra(EXTRA_AUTOPLAY_NEXT, true);
            autoSkipIntro = intent.getBooleanExtra(EXTRA_AUTO_SKIP_INTRO, false);
            autoSkipCredits = intent.getBooleanExtra(EXTRA_AUTO_SKIP_CREDITS, false);
            applySessionJson(intent.getStringExtra(EXTRA_SESSION_JSON));
            String sessionAudio = audioStreamId;
            String sessionSub = subtitleStreamId;
            restoreAvPrefs();
            boolean avChanged = !String.valueOf(sessionAudio).equals(String.valueOf(audioStreamId))
                || !String.valueOf(sessionSub).equals(String.valueOf(subtitleStreamId));
            PlayerBridge.get().keepHostWebViewAlive();

            if (currentUrl == null || currentUrl.trim().isEmpty()) {
                Log.e(TAG, "Missing playback url");
                finishWithResult(false, false);
                return;
            }
            currentUrl = currentUrl.trim();
            absorbTimelineFromUrl(currentUrl);
            applyTitleChrome();

            Map<String, String> headers = headersWithCookies(currentUrl, parseHeaders(headersJson));
            headers.put("Accept-Encoding", "identity");

            httpFactory = new DefaultHttpDataSource.Factory()
                .setUserAgent(USER_AGENT)
                .setAllowCrossProtocolRedirects(true)
                .setConnectTimeoutMs(8_000)
                .setReadTimeoutMs(15_000)
                .setDefaultRequestProperties(headers);

            DefaultLoadControl loadControl = new DefaultLoadControl.Builder()
                .setBufferDurationsMs(1_500, 30_000, 250, 500)
                .setTargetBufferBytes(4 * 1024 * 1024)
                .setPrioritizeTimeOverSizeThresholds(true)
                .build();

            DefaultExtractorsFactory extractorsFactory = new DefaultExtractorsFactory();

            DefaultRenderersFactory renderersFactory = new DefaultRenderersFactory(this) {
                @Override
                protected AudioSink buildAudioSink(
                    Context context,
                    boolean enableFloatOutput,
                    boolean enableAudioTrackPlaybackParams
                ) {
                    return new DefaultAudioSink.Builder(context)
                        .setEnableFloatOutput(enableFloatOutput)
                        .setEnableAudioTrackPlaybackParams(enableAudioTrackPlaybackParams)
                        .setAudioProcessors(new AudioProcessor[] { delayAudioProcessor })
                        .build();
                }
            }
                .setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_OFF)
                .setEnableDecoderFallback(true);

            AudioAttributes audioAttributes = new AudioAttributes.Builder()
                .setUsage(C.USAGE_MEDIA)
                .setContentType(C.AUDIO_CONTENT_TYPE_MOVIE)
                .build();

            player = new ExoPlayer.Builder(this, renderersFactory)
                .setMediaSourceFactory(new DefaultMediaSourceFactory(httpFactory, extractorsFactory))
                .setLoadControl(loadControl)
                .setAudioAttributes(audioAttributes, false)
                .setWakeMode(C.WAKE_MODE_NETWORK)
                .build();
            player.setVideoScalingMode(C.VIDEO_SCALING_MODE_SCALE_TO_FIT);
            applySpeed(playbackSpeed);
            applyNightMode();
            applyRepeatMode();
            applyAudioDelay(false);
            applyVideoZoom();

            PlayerView playerView = findViewById(R.id.player_view);
            playerView.setPlayer(player);
            playerView.setShowBuffering(PlayerView.SHOW_BUFFERING_NEVER);
            playerView.setKeepScreenOn(true);
            playerView.setOnClickListener(v -> toggleChrome());
            applySubtitleLook(playerView);
            applyFrameRate(playerView);

            Log.i(TAG, "Starting ExoPlayer url=" + summarizeUrl(currentUrl));
            queueStartPosition(currentUrl, pendingSeekMs);
            pendingSeekMs = 0;
            player.setPlayWhenReady(true);
            player.prepare();
            wirePlayerListener();
            wireControls();
            updateActionVisibility();
            updateChipLabels();
            bumpChrome();
            if (playPauseBtn != null) playPauseBtn.requestFocus();
            if (avChanged) {
                requestStreamChange(qualityId, audioStreamId, subtitleStreamId, mediaIndex);
            }
            mainHandler.post(tickRunnable);
            mainHandler.postDelayed(progressEmitRunnable, 5000);
            updatePipVisibility();
        } catch (Throwable t) {
            Log.e(TAG, "PlayerActivity failed to start", t);
            playbackError = true;
            toast("Unable to start player");
            finishWithResult(false, false);
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
    }

    private void bindViews() {
        chrome = findViewById(R.id.player_chrome);
        topBar = findViewById(R.id.player_top);
        menuScrim = findViewById(R.id.player_menu_scrim);
        menuTitle = findViewById(R.id.player_menu_title);
        menuScroll = findViewById(R.id.player_menu_scroll);
        menuList = findViewById(R.id.player_menu_list);
        if (menuScrim != null) {
            menuScrim.setOnClickListener(v -> hideOptionSheet());
        }
        bufferingView = findViewById(R.id.player_buffering);
        errorView = findViewById(R.id.player_error);
        titleView = findViewById(R.id.player_title);
        clockView = findViewById(R.id.player_clock);
        if (clockView != null) {
            try {
                Typeface clockFace = Typeface.createFromAsset(getAssets(), "fonts/satoshi_bold.ttf");
                clockView.setTypeface(clockFace);
            } catch (RuntimeException ignored) {
                /* keep the XML face if the asset is missing */
            }
        }
        updateWallClock();
        logoView = findViewById(R.id.player_logo);
        artView = findViewById(R.id.player_art);
        seekBar = findViewById(R.id.player_seek);
        if (seekBar != null) {
            seekBar.setBackground(null);
            seekBar.setSplitTrack(false);
            if (Build.VERSION.SDK_INT >= 26) {
                seekBar.setDefaultFocusHighlightEnabled(false);
            }
        }
        timeView = findViewById(R.id.player_time);
        speedLabel = findViewById(R.id.player_speed_label);
        playPauseBtn = findViewById(R.id.player_play_pause);
        skipRow = findViewById(R.id.player_skip_row);
        skipIntroBtn = findViewById(R.id.player_skip_intro);
        skipCreditsBtn = findViewById(R.id.player_skip_credits);
        qualityBtn = findViewById(R.id.player_quality);
        audioBtn = findViewById(R.id.player_audio);
        subsBtn = findViewById(R.id.player_subs);
        versionBtn = findViewById(R.id.player_version);
        speedBtn = findViewById(R.id.player_speed);
        sleepBtn = findViewById(R.id.player_sleep);
        externalBtn = findViewById(R.id.player_external);
        upNextRow = findViewById(R.id.player_up_next);
        upNextArt = findViewById(R.id.player_up_next_art);
        upNextKicker = findViewById(R.id.player_up_next_kicker);
        upNextLabel = findViewById(R.id.player_up_next_label);
        upNextCountdown = findViewById(R.id.player_up_next_countdown);
        upNextPlayBtn = findViewById(R.id.player_up_next_play);
        upNextCreditsBtn = findViewById(R.id.player_up_next_credits);
        statsView = findViewById(R.id.player_stats);
        zoomBtn = findViewById(R.id.player_zoom);
        delayBtn = findViewById(R.id.player_delay);
        repeatBtn = findViewById(R.id.player_repeat);
        seekPreview = findViewById(R.id.player_seek_preview);

        ImageButton close = findViewById(R.id.player_close);
        close.setOnClickListener(v -> finishWithResult(false, false));
        disableTvFocusBox(
            close,
            seekBar,
            playPauseBtn,
            findViewById(R.id.player_seek_back),
            findViewById(R.id.player_seek_fwd),
            skipIntroBtn,
            skipCreditsBtn,
            qualityBtn,
            audioBtn,
            subsBtn,
            versionBtn,
            speedBtn,
            sleepBtn,
            externalBtn,
            pipBtn,
            chaptersBtn,
            zoomBtn,
            delayBtn,
            repeatBtn,
            findViewById(R.id.player_up_next_play),
            findViewById(R.id.player_up_next_credits)
        );
    }

    private void disableTvFocusBox(View... views) {
        if (Build.VERSION.SDK_INT < 26) return;
        for (View view : views) {
            if (view != null) view.setDefaultFocusHighlightEnabled(false);
        }
    }

    private void wireControls() {
        playPauseBtn.setOnClickListener(v -> togglePlayPause());
        findViewById(R.id.player_seek_back).setOnClickListener(v -> seekBy(-10_000));
        findViewById(R.id.player_seek_fwd).setOnClickListener(v -> seekBy(10_000));
        skipIntroBtn.setOnClickListener(v -> doSkipIntro());
        skipCreditsBtn.setOnClickListener(v -> doSkipCredits());
        findViewById(R.id.player_up_next_play).setOnClickListener(v -> finishForPlayNext());
        qualityBtn.setOnClickListener(v -> showOptionMenu(R.string.player_quality, "quality", qualities, qualityId));
        if (upNextPlayBtn != null) upNextPlayBtn.setOnClickListener(v -> finishForPlayNext());
        if (upNextCreditsBtn != null) upNextCreditsBtn.setOnClickListener(v -> dismissUpNextWatchCredits());
        audioBtn.setOnClickListener(v -> showOptionMenu(R.string.player_audio, "audio", audioTracks, audioStreamId == null ? "" : audioStreamId));
        subsBtn.setOnClickListener(v -> showSubtitleMenu());
        versionBtn.setOnClickListener(v -> showOptionMenu(R.string.player_version, "version", versions, String.valueOf(mediaIndex)));
        speedBtn.setOnClickListener(v -> showSpeedMenu());
        if (zoomBtn != null) zoomBtn.setOnClickListener(v -> showZoomMenu());
        if (delayBtn != null) delayBtn.setOnClickListener(v -> showDelayMenu());
        if (repeatBtn != null) repeatBtn.setOnClickListener(v -> showRepeatMenu());
        sleepBtn.setOnClickListener(v -> showSleepMenu());
        externalBtn.setOnClickListener(v -> openExternalPlayer());
        pipBtn.setOnClickListener(v -> enterPip());
        if (chaptersBtn != null) {
            chaptersBtn.setOnClickListener(v -> showChaptersMenu());
        }

        seekBar.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            @Override
            public void onProgressChanged(SeekBar bar, int progress, boolean fromUser) {
                if (!fromUser || player == null) return;
                long duration = contentDurationMs();
                if (duration <= 0) return;
                long pos = (long) ((progress / 1000.0) * duration);
                timeView.setText(formatClock(pos) + " / " + formatClock(duration));
                showSeekPreview(pos);
            }

            @Override
            public void onStartTrackingTouch(SeekBar bar) {
                seekingUi = true;
                bumpChrome();
            }

            @Override
            public void onStopTrackingTouch(SeekBar bar) {
                hideSeekPreview();
                if (player == null) {
                    seekingUi = false;
                    return;
                }
                long duration = contentDurationMs();
                if (duration <= 0) {
                    seekingUi = false;
                    return;
                }
                long pos = (long) ((bar.getProgress() / 1000.0) * duration);
                seekToContent(pos, true);
                emitProgress("playing");
                bumpChrome();
            }
        });
        // SeekBar consumes Left/Right itself and only moves the thumb. Swallow those
        // keys here so a press on the bar actually changes the playback position.
        seekBar.setOnKeyListener((v, keyCode, event) -> {
            boolean seekKey = keyCode == KeyEvent.KEYCODE_DPAD_LEFT
                || keyCode == KeyEvent.KEYCODE_DPAD_RIGHT
                || keyCode == KeyEvent.KEYCODE_MEDIA_REWIND
                || keyCode == KeyEvent.KEYCODE_MEDIA_FAST_FORWARD;
            if (!seekKey) return false;
            if (event.getAction() != KeyEvent.ACTION_DOWN) return true;
            if (keyCode == KeyEvent.KEYCODE_DPAD_LEFT || keyCode == KeyEvent.KEYCODE_MEDIA_REWIND) {
                seekBy(-10_000);
            } else {
                seekBy(10_000);
            }
            return true;
        });
    }

    private void wirePlayerListener() {
        player.addListener(new Player.Listener() {
            @Override
            public void onPlaybackStateChanged(int playbackState) {
                setBufferingVisible(playbackState == Player.STATE_BUFFERING);
                if (playbackState == Player.STATE_READY) {
                    playbackError = false;
                    hideError();
                    if (pendingSeekMs > 0 && !isTranscodeUrl(currentUrl)) {
                        long seekTo = pendingSeekMs;
                        pendingSeekMs = 0;
                        player.seekTo(seekTo);
                    } else {
                        pendingSeekMs = 0;
                    }
                    reconcileTranscodeOrigin();
                    long landed = timelineOriginMs + Math.max(0, player.getCurrentPosition());
                    if (scrubTargetMs < 0 || Math.abs(landed - scrubTargetMs) < 2500) {
                        seekingUi = false;
                        scrubTargetMs = -1;
                    }
                    if (!userPaused) player.setPlayWhenReady(true);
                    if (player.isPlaying()) {
                        mainHandler.removeCallbacks(hideChromeRunnable);
                        mainHandler.postDelayed(hideChromeRunnable, 2500);
                    }
                    applyVideoZoom();
                }
                if (playbackState == Player.STATE_ENDED) {
                    playbackEnded = true;
                    if (sleepEndOfEpisode) {
                        sleepEndOfEpisode = false;
                        finishWithResult(true, false);
                        return;
                    }
                    if (repeatMode == Player.REPEAT_MODE_ONE
                        || (repeatMode == Player.REPEAT_MODE_ALL
                            && (nextRatingKey == null || nextRatingKey.isEmpty()))) {
                        playbackEnded = false;
                        player.seekTo(0);
                        player.setPlayWhenReady(true);
                        return;
                    }
                    if ((autoplayNext || repeatMode == Player.REPEAT_MODE_ALL)
                        && nextRatingKey != null && !nextRatingKey.isEmpty()) {
                        if (musicMode) requestPlayNextWithoutFinish();
                        else finishForPlayNext();
                    } else {
                        finishWithResult(true, false);
                    }
                }
                updatePlayPauseLabel();
            }

            @Override
            public void onIsPlayingChanged(boolean isPlaying) {
                updatePlayPauseLabel();
                emitProgress(isPlaying ? "playing" : "paused");
            }

            @Override
            public void onTracksChanged(Tracks tracks) {
                boolean hasVideo = false;
                boolean hasAudio = false;
                for (Tracks.Group group : tracks.getGroups()) {
                    if (!group.isSelected()) continue;
                    int type = group.getType();
                    if (type == C.TRACK_TYPE_VIDEO) hasVideo = true;
                    if (type == C.TRACK_TYPE_AUDIO) hasAudio = true;
                }
                if (!hasVideo && hasAudio) {
                    toast("Audio only — this file may need a transcode for this TV");
                }
            }

            @Override
            public void onPlayerError(PlaybackException error) {
                Log.e(TAG, "ExoPlayer error " + error.getErrorCodeName(), error);
                if (trySeekRecovery(error)) return;
                if (tryStreamFallback(error)) return;
                playbackError = true;
                String message = "Playback error: " + error.getErrorCodeName();
                toast(message);
                showError(message);
                JSObject data = new JSObject();
                data.put("message", error.getErrorCodeName());
                PlayerBridge.get().emit("error", data);
                // Leave the dead player. Staying here traps the remote, and falling
                // through to the web player starts the same title again.
                final int gen = errorGeneration;
                mainHandler.postDelayed(() -> {
                    if (finishing || gen != errorGeneration || !playbackError) return;
                    finishWithResult(false, false);
                }, 1200);
            }
        });
    }

    void applySessionJson(@Nullable String sessionJson) {
        if (sessionJson == null || sessionJson.trim().isEmpty()) return;
        try {
            JSONObject root = new JSONObject(sessionJson);
            ratingKey = root.optString("ratingKey", ratingKey);
            showKey = root.optString("showKey", showKey);
            String nextRating = root.optString("ratingKey", ratingKey);
            if (nextRating != null && !nextRating.equals(ratingKey)) watchCreditsChosen = false;
            ratingKey = nextRating;
            audioStreamId = root.optString("audioStreamId", audioStreamId);
            subtitleStreamId = root.optString("subtitleStreamId", subtitleStreamId);
            mediaIndex = root.optInt("mediaIndex", mediaIndex);
            durationHintMs = root.optLong("durationMs", durationHintMs);
            if (root.has("autoplayNext")) autoplayNext = root.optBoolean("autoplayNext", autoplayNext);
            if (root.has("autoSkipIntro")) autoSkipIntro = root.optBoolean("autoSkipIntro", autoSkipIntro);
            if (root.has("autoSkipCredits")) autoSkipCredits = root.optBoolean("autoSkipCredits", autoSkipCredits);
            if (root.has("title")) {
                String nextTitleText = root.optString("title", "").trim();
                if (!nextTitleText.isEmpty()) titleText = nextTitleText;
            }
            if (root.has("subtitle")) {
                subtitleText = root.optString("subtitle", "").trim();
            }
            if (root.has("logoUrl")) {
                logoUrl = root.optString("logoUrl", "").trim();
            }
            if (root.has("posterUrl")) {
                artUrl = root.optString("posterUrl", "").trim();
            }
            if (root.has("music")) {
                musicMode = root.optBoolean("music", musicMode);
            }

            JSONObject markers = root.optJSONObject("markers");
            if (markers != null) {
                JSONObject intro = markers.optJSONObject("intro");
                if (intro != null) {
                    introStartMs = intro.optLong("startMs", -1);
                    introEndMs = intro.optLong("endMs", -1);
                }
                JSONObject credits = markers.optJSONObject("credits");
                if (credits != null) {
                    creditsStartMs = credits.optLong("startMs", -1);
                    if (credits.has("endMs")) creditsEndMs = credits.optLong("endMs", -1);
                }
            }

            JSONObject next = root.optJSONObject("nextItem");
            if (next != null) {
                nextRatingKey = next.optString("ratingKey", "");
                nextTitle = next.optString("title", "");
                nextThumbUrl = next.optString("thumb", "");
            }
            if (root.has("playbackMode")) streamMode = root.optString("playbackMode", streamMode);
            JSONObject source = root.optJSONObject("source");
            if (source != null) {
                streamWidth = source.optInt("width", streamWidth);
                streamHeight = source.optInt("height", streamHeight);
                streamBitrate = source.optInt("bitrate", streamBitrate);
                streamVideoCodec = source.optString("videoCodec", streamVideoCodec);
                streamAudioCodec = source.optString("audioCodec", streamAudioCodec);
                streamContainer = source.optString("container", streamContainer);
                streamResolution = source.optString("videoResolution", streamResolution);
            }
            if (root.has("nightMode")) nightMode = root.optBoolean("nightMode", nightMode);
            if (root.has("matchFrameRate")) matchFrameRate = root.optBoolean("matchFrameRate", matchFrameRate);
            if (root.has("videoZoom")) videoZoom = (float) root.optDouble("videoZoom", videoZoom);
            if (root.has("videoFill")) videoFill = root.optBoolean("videoFill", videoFill);
            if (root.has("audioDelayMs")) audioDelayMs = Math.max(0, Math.min(1000, root.optInt("audioDelayMs", audioDelayMs)));
            if (root.has("repeatMode")) {
                String mode = root.optString("repeatMode", "");
                if ("one".equalsIgnoreCase(mode) || "1".equals(mode)) repeatMode = Player.REPEAT_MODE_ONE;
                else if ("all".equalsIgnoreCase(mode) || "2".equals(mode)) repeatMode = Player.REPEAT_MODE_ALL;
                else if ("off".equalsIgnoreCase(mode) || "0".equals(mode)) repeatMode = Player.REPEAT_MODE_OFF;
            }
            if (root.has("sidecarSubtitleUrl")) sidecarSubtitleUrl = root.optString("sidecarSubtitleUrl", sidecarSubtitleUrl);
            if (root.has("frameRate")) videoFrameRate = (float) root.optDouble("frameRate", videoFrameRate);
            previewThumbTemplate = root.optString("previewThumbTemplate", previewThumbTemplate);
            JSONObject timeline = root.optJSONObject("timeline");
            if (timeline != null) {
                String origin = timeline.optString("origin", "").trim().replaceAll("/+$", "");
                if (!origin.isEmpty()) timelineOrigin = origin;
                String token = timeline.optString("token", "").trim();
                if (!token.isEmpty()) timelineToken = token;
                String clientId = timeline.optString("clientId", "").trim();
                if (!clientId.isEmpty()) timelineClientId = clientId;
                String product = timeline.optString("product", "").trim();
                if (!product.isEmpty()) timelineProduct = product;
                String version = timeline.optString("version", "").trim();
                if (!version.isEmpty()) timelineVersion = version;
                String platform = timeline.optString("platform", "").trim();
                if (!platform.isEmpty()) timelinePlatform = platform;
                String device = timeline.optString("device", "").trim();
                if (!device.isEmpty()) timelineDevice = device;
                String deviceName = timeline.optString("deviceName", "").trim();
                if (!deviceName.isEmpty()) timelineDeviceName = deviceName;
                String sessionId = timeline.optString("sessionId", "").trim();
                if (!sessionId.isEmpty()) timelineSessionId = sessionId;
            }
            JSONObject subtitleStyle = root.optJSONObject("subtitleStyle");
            if (subtitleStyle != null) {
                subtitleSizePct = subtitleStyle.optInt("size", subtitleSizePct);
                subtitleColor = subtitleStyle.optString("color", subtitleColor);
                subtitleBackground = subtitleStyle.optString("background", subtitleBackground);
                subtitlePosition = subtitleStyle.optString("position", subtitlePosition);
            }
            if (root.has("chapters")) {
                chapters.clear();
                JSONArray chapterRows = root.optJSONArray("chapters");
                if (chapterRows != null) {
                    for (int i = 0; i < chapterRows.length(); i++) {
                        JSONObject row = chapterRows.optJSONObject(i);
                        if (row == null) continue;
                        long startMs = row.optLong("startMs", -1);
                        if (startMs < 0) continue;
                        String title = row.optString("title", "Chapter " + (i + 1));
                        chapters.add(new OptionItem(String.valueOf(startMs), title));
                    }
                }
            }

            if (root.has("qualities")) {
                qualities.clear();
                qualities.addAll(parseOptions(root.optJSONArray("qualities")));
            }
            if (root.has("audioTracks")) {
                audioTracks.clear();
                audioTracks.addAll(parseOptions(root.optJSONArray("audioTracks")));
            }
            if (root.has("subtitles")) {
                subtitles.clear();
                subtitles.addAll(parseOptions(root.optJSONArray("subtitles")));
            }
            if (root.has("versions")) {
                versions.clear();
                versions.addAll(parseOptions(root.optJSONArray("versions")));
            }
            runOnUiThread(() -> {
                updateActionVisibility();
                updateChipLabels();
                applyTitleChrome();
                applyUpNextArt();
                if (statsVisible) refreshStatsOverlay();
                applyNightMode();
                applyRepeatMode();
                applyAudioDelay(false);
                applyVideoZoom();
                PlayerView view = findViewById(R.id.player_view);
                if (view != null) {
                    applySubtitleLook(view);
                    applyFrameRate(view);
                }
                if (subtitleSearchPending) {
                    subtitleSearchPending = false;
                    showSubtitleMenu();
                }
            });
        } catch (Exception e) {
            Log.w(TAG, "Failed to parse sessionJson", e);
        }
    }

    private void applyTitleChrome() {
        if (titleView != null) {
            String line = titleText == null ? "" : titleText;
            if (musicMode && subtitleText != null && !subtitleText.trim().isEmpty()) {
                line = line.isEmpty() ? subtitleText.trim() : (line + "\n" + subtitleText.trim());
            }
            titleView.setText(line);
        }
        applyArtChrome();
        if (musicMode) {
            if (logoView != null) {
                logoView.setVisibility(View.GONE);
                logoView.setImageDrawable(null);
            }
            return;
        }
        if (logoView == null) return;
        String url = logoUrl == null ? "" : logoUrl.trim();
        if (url.isEmpty()) {
            logoLoadGeneration += 1;
            pendingLogoUrl = "";
            loadedLogoUrl = "";
            showTitleText();
            return;
        }
        if (url.equals(loadedLogoUrl) && logoView.getVisibility() == View.VISIBLE) {
            logoView.setContentDescription(titleText);
            return;
        }
        if (url.equals(pendingLogoUrl)) return;
        pendingLogoUrl = url;
        showTitleText();
        final int gen = ++logoLoadGeneration;
        final String fetchUrl = url;
        final Map<String, String> imageHeaders = headersForImageUrl(fetchUrl);
        try {
            logoExecutor.execute(() -> {
                Bitmap bitmap = downloadLogoBitmap(fetchUrl, imageHeaders);
                if (bitmap != null) bitmap = trimTransparent(bitmap);
                final Bitmap ready = bitmap;
                mainHandler.post(() -> {
                    if (gen != logoLoadGeneration || isFinishing()) return;
                    if (ready == null || ready.getWidth() < 8 || ready.getHeight() < 8) {
                        pendingLogoUrl = "";
                        loadedLogoUrl = "";
                        showTitleText();
                        return;
                    }
                    logoView.setImageBitmap(ready);
                    logoView.setContentDescription(titleText);
                    logoView.setVisibility(View.VISIBLE);
                    if (titleView != null) titleView.setVisibility(View.GONE);
                    loadedLogoUrl = fetchUrl;
                    pendingLogoUrl = fetchUrl;
                });
            });
        } catch (Exception e) {
            Log.w(TAG, "Clear logo load skipped", e);
            pendingLogoUrl = "";
            showTitleText();
        }
    }

    private void applyArtChrome() {
        if (artView == null) return;
        String url = artUrl == null ? "" : artUrl.trim();
        if (!musicMode || url.isEmpty()) {
            artView.setVisibility(View.GONE);
            artView.setImageDrawable(null);
            loadedArtUrl = "";
            return;
        }
        if (url.equals(loadedArtUrl) && artView.getVisibility() == View.VISIBLE) return;
        final String fetchUrl = url;
        final Map<String, String> imageHeaders = headersForImageUrl(fetchUrl);
        try {
            logoExecutor.execute(() -> {
                Bitmap bitmap = downloadLogoBitmap(fetchUrl, imageHeaders);
                final Bitmap ready = bitmap;
                mainHandler.post(() -> {
                    if (isFinishing()) return;
                    if (ready == null || ready.getWidth() < 8 || ready.getHeight() < 8) {
                        artView.setVisibility(View.GONE);
                        return;
                    }
                    artView.setImageBitmap(ready);
                    artView.setVisibility(View.VISIBLE);
                    loadedArtUrl = fetchUrl;
                });
            });
        } catch (Exception e) {
            Log.w(TAG, "Album art load skipped", e);
        }
    }

    private void applyUpNextArt() {
        if (upNextArt == null) return;
        String url = nextThumbUrl == null ? "" : nextThumbUrl.trim();
        if (url.isEmpty()) {
            upNextArt.setVisibility(View.GONE);
            upNextArt.setImageDrawable(null);
            loadedUpNextThumb = "";
            return;
        }
        if (url.equals(loadedUpNextThumb) && upNextArt.getVisibility() == View.VISIBLE) return;
        final String fetchUrl = url;
        final Map<String, String> imageHeaders = headersForImageUrl(fetchUrl);
        try {
            logoExecutor.execute(() -> {
                Bitmap bitmap = downloadLogoBitmap(fetchUrl, imageHeaders);
                final Bitmap ready = bitmap;
                mainHandler.post(() -> {
                    if (isFinishing() || upNextArt == null) return;
                    if (ready == null || ready.getWidth() < 8 || ready.getHeight() < 8) {
                        upNextArt.setVisibility(View.GONE);
                        return;
                    }
                    upNextArt.setImageBitmap(ready);
                    upNextArt.setVisibility(View.VISIBLE);
                    loadedUpNextThumb = fetchUrl;
                });
            });
        } catch (Exception e) {
            Log.w(TAG, "Up next art load skipped", e);
        }
    }

    private boolean isStatsKey(int keyCode) {
        return keyCode == KeyEvent.KEYCODE_INFO
            || keyCode == KeyEvent.KEYCODE_F1
            || keyCode == KeyEvent.KEYCODE_WINDOW;
    }

    private void toggleStatsOverlay() {
        statsVisible = !statsVisible;
        if (statsView != null) statsView.setVisibility(statsVisible ? View.VISIBLE : View.GONE);
        if (statsVisible) refreshStatsOverlay();
    }

    private void hideStatsOverlay() {
        statsVisible = false;
        if (statsView != null) statsView.setVisibility(View.GONE);
    }

    private String playbackModeLabel() {
        String mode = streamMode == null ? "" : streamMode.trim();
        if (isTranscodeUrl(currentUrl) && !"directPlay".equalsIgnoreCase(mode)) {
            return getString(R.string.player_transcode);
        }
        if ("directPlay".equalsIgnoreCase(mode)) return getString(R.string.player_direct_play);
        if ("directStream".equalsIgnoreCase(mode)) return getString(R.string.player_direct_stream);
        if ("transcode".equalsIgnoreCase(mode) || isTranscodeUrl(currentUrl)) {
            return getString(R.string.player_transcode);
        }
        if (currentUrl != null && (currentUrl.contains("/library/parts/") || currentUrl.contains("/file/"))) {
            return getString(R.string.player_direct_play);
        }
        return getString(R.string.player_direct_stream);
    }

    private String formatBitrateLabel(int bitrate) {
        if (bitrate <= 0) return "";
        double mbps = bitrate >= 100000 ? bitrate / 1_000_000.0 : bitrate / 1000.0;
        return String.format(Locale.US, "%.1f Mbps", mbps);
    }

    private String currentQualityLabel() {
        if (qualityId == null || qualityId.isEmpty()) return "";
        for (OptionItem row : qualities) {
            if (qualityId.equals(row.id)) return row.label;
        }
        return qualityId;
    }

    private String currentAudioLabel() {
        if (audioStreamId == null || audioStreamId.isEmpty()) return "";
        for (OptionItem row : audioTracks) {
            if (audioStreamId.equals(row.id)) return row.label;
        }
        return "";
    }

    private void refreshStatsOverlay() {
        if (statsView == null || !statsVisible) return;
        int width = streamWidth;
        int height = streamHeight;
        int bitrate = streamBitrate;
        String videoCodec = streamVideoCodec == null ? "" : streamVideoCodec.trim();
        String audioCodec = streamAudioCodec == null ? "" : streamAudioCodec.trim();
        if (player != null) {
            VideoSize size = player.getVideoSize();
            if (size != null) {
                if (size.width > 0) width = size.width;
                if (size.height > 0) height = size.height;
            }
            try {
                Tracks tracks = player.getCurrentTracks();
                for (Tracks.Group group : tracks.getGroups()) {
                    if (group.getType() != C.TRACK_TYPE_VIDEO && group.getType() != C.TRACK_TYPE_AUDIO) continue;
                    for (int i = 0; i < group.length; i++) {
                        if (!group.isTrackSelected(i)) continue;
                        Format format = group.getTrackFormat(i);
                        if (group.getType() == C.TRACK_TYPE_VIDEO) {
                            if (format.width > 0) width = format.width;
                            if (format.height > 0) height = format.height;
                            if (format.bitrate > 0) bitrate = format.bitrate;
                            if (format.sampleMimeType != null && videoCodec.isEmpty()) {
                                videoCodec = format.sampleMimeType.replace("video/", "");
                            }
                            if (format.codecs != null && !format.codecs.isEmpty()) videoCodec = format.codecs;
                        } else if (audioCodec.isEmpty()) {
                            if (format.sampleMimeType != null) audioCodec = format.sampleMimeType.replace("audio/", "");
                            if (format.codecs != null && !format.codecs.isEmpty()) audioCodec = format.codecs;
                        }
                    }
                }
            } catch (Throwable ignored) {
                /* tracks not ready */
            }
        }
        StringBuilder lines = new StringBuilder();
        lines.append(playbackModeLabel());
        String dims = "";
        if (width > 0 && height > 0) dims = width + "×" + height;
        else if (streamResolution != null && !streamResolution.trim().isEmpty()) dims = streamResolution.trim();
        if (!dims.isEmpty()) lines.append('\n').append(dims);
        String rate = formatBitrateLabel(bitrate);
        if (!rate.isEmpty()) lines.append('\n').append(rate);
        String codecs = "";
        if (!videoCodec.isEmpty() && !audioCodec.isEmpty()) codecs = videoCodec + " / " + audioCodec;
        else if (!videoCodec.isEmpty()) codecs = videoCodec;
        else if (!audioCodec.isEmpty()) codecs = audioCodec;
        if (!codecs.isEmpty()) lines.append('\n').append(codecs);
        if (streamContainer != null && !streamContainer.trim().isEmpty()) {
            lines.append('\n').append(streamContainer.trim().toUpperCase(Locale.US));
        }
        String quality = currentQualityLabel();
        if (!quality.isEmpty()) lines.append('\n').append(quality);
        String audio = currentAudioLabel();
        if (!audio.isEmpty()) lines.append('\n').append(audio);
        statsView.setText(lines.toString());
        statsView.setTypeface(Typeface.MONOSPACE);
    }

    private void showTitleText() {
        if (logoView != null) {
            logoView.setVisibility(View.GONE);
            logoView.setImageDrawable(null);
        }
        if (titleView != null) titleView.setVisibility(View.VISIBLE);
    }

    private Bitmap downloadLogoBitmap(String url, Map<String, String> headers) {
        HttpURLConnection conn = null;
        try {
            URL parsed = new URL(url);
            conn = (HttpURLConnection) parsed.openConnection();
            conn.setConnectTimeout(8_000);
            conn.setReadTimeout(12_000);
            conn.setInstanceFollowRedirects(true);
            conn.setRequestMethod("GET");
            if (headers != null) {
                for (Map.Entry<String, String> entry : headers.entrySet()) {
                    if (entry.getKey() != null && entry.getValue() != null) {
                        conn.setRequestProperty(entry.getKey(), entry.getValue());
                    }
                }
            }
            if (conn.getRequestProperty("Accept") == null) {
                conn.setRequestProperty("Accept", "image/*,*/*;q=0.8");
            }
            int code = conn.getResponseCode();
            if (code < 200 || code >= 300) return null;
            try (InputStream in = conn.getInputStream();
                 ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                byte[] buf = new byte[8192];
                int n;
                while ((n = in.read(buf)) != -1) {
                    out.write(buf, 0, n);
                    if (out.size() > 4_000_000) return null;
                }
                byte[] data = out.toByteArray();
                if (data.length < 32) return null;
                BitmapFactory.Options opts = new BitmapFactory.Options();
                opts.inPreferredConfig = Bitmap.Config.ARGB_8888;
                return BitmapFactory.decodeByteArray(data, 0, data.length, opts);
            }
        } catch (Exception e) {
            Log.w(TAG, "Clear logo download failed", e);
            return null;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private Map<String, String> headersForImageUrl(String url) {
        Map<String, String> headers = headersWithCookies(url, parseHeaders(headersJson));
        try {
            URI video = new URI(currentUrl);
            URI image = new URI(url);
            String videoHost = video.getHost();
            String imageHost = image.getHost();
            if (videoHost != null && imageHost != null && videoHost.equalsIgnoreCase(imageHost)) {
                return headers;
            }
        } catch (Exception ignored) {
            /* fall through */
        }
        Map<String, String> slim = new HashMap<>();
        slim.put("User-Agent", USER_AGENT);
        slim.put("Accept", "image/*,*/*;q=0.8");
        return slim;
    }

    private static Bitmap trimTransparent(Bitmap src) {
        if (src == null || !src.hasAlpha()) return src;
        int width = src.getWidth();
        int height = src.getHeight();
        if (width <= 2 || height <= 2) return src;
        int[] pixels = new int[width * height];
        src.getPixels(pixels, 0, width, 0, 0, width, height);
        int left = width;
        int top = height;
        int right = -1;
        int bottom = -1;
        for (int y = 0; y < height; y++) {
            int row = y * width;
            for (int x = 0; x < width; x++) {
                int alpha = (pixels[row + x] >>> 24) & 0xFF;
                if (alpha <= 20) continue;
                if (x < left) left = x;
                if (x > right) right = x;
                if (y < top) top = y;
                if (y > bottom) bottom = y;
            }
        }
        if (right < left || bottom < top) return src;
        int pad = 2;
        left = Math.max(0, left - pad);
        top = Math.max(0, top - pad);
        right = Math.min(width - 1, right + pad);
        bottom = Math.min(height - 1, bottom + pad);
        int cropW = right - left + 1;
        int cropH = bottom - top + 1;
        if (cropW >= width - 1 && cropH >= height - 1) return src;
        try {
            return Bitmap.createBitmap(src, left, top, cropW, cropH);
        } catch (Exception ignored) {
            return src;
        }
    }

    private void applyNightMode() {
        if (player == null) return;
        player.setVolume(nightMode ? 0.55f : 1f);
    }

    private void applySubtitleLook(PlayerView playerView) {
        if (playerView == null) return;
        SubtitleView subtitleView = playerView.getSubtitleView();
        if (subtitleView == null) return;
        int fg;
        try {
            fg = Color.parseColor(subtitleColor);
        } catch (Exception ignored) {
            fg = Color.WHITE;
        }
        int windowColor = Color.TRANSPARENT;
        if ("dim".equals(subtitleBackground)) windowColor = Color.argb(110, 0, 0, 0);
        else if ("solid".equals(subtitleBackground)) windowColor = Color.argb(220, 0, 0, 0);
        CaptionStyleCompat style = new CaptionStyleCompat(
            fg,
            Color.TRANSPARENT,
            windowColor,
            CaptionStyleCompat.EDGE_TYPE_DROP_SHADOW,
            Color.BLACK,
            Typeface.DEFAULT_BOLD
        );
        subtitleView.setStyle(style);
        subtitleView.setFractionalTextSize(0.0533f * (Math.max(50, Math.min(200, subtitleSizePct)) / 100f));
        if ("top".equals(subtitlePosition)) {
            subtitleView.setBottomPaddingFraction(0.72f);
        } else if ("middle".equals(subtitlePosition)) {
            subtitleView.setBottomPaddingFraction(0.42f);
        } else {
            subtitleView.setBottomPaddingFraction(0.08f);
        }
    }

    private void applyFrameRate(PlayerView playerView) {
        if (!matchFrameRate || videoFrameRate <= 0 || playerView == null) return;
        if (Build.VERSION.SDK_INT < 30) return;
        View surfaceView = playerView.getVideoSurfaceView();
        if (!(surfaceView instanceof SurfaceView)) return;
        Surface surface = ((SurfaceView) surfaceView).getHolder().getSurface();
        if (surface == null || !surface.isValid()) return;
        try {
            surface.setFrameRate(videoFrameRate, Surface.FRAME_RATE_COMPATIBILITY_FIXED_SOURCE);
        } catch (Throwable ignored) {
            /* older devices */
        }
    }

    private interface OptionPick {
        void onPick(int index);
    }

    private boolean isOptionDialogShowing() {
        return menuScrim != null && menuScrim.getVisibility() == View.VISIBLE;
    }

    private void setChromeSubtreeFocusable(boolean focusable) {
        View[] bars = { chrome, topBar };
        for (View bar : bars) {
            if (!(bar instanceof ViewGroup)) continue;
            ((ViewGroup) bar).setDescendantFocusability(
                focusable ? ViewGroup.FOCUS_AFTER_DESCENDANTS : ViewGroup.FOCUS_BLOCK_DESCENDANTS
            );
        }
    }

    private void hideOptionSheet() {
        if (menuList != null) menuList.removeAllViews();
        if (menuScrim != null) menuScrim.setVisibility(View.GONE);
        setChromeSubtreeFocusable(true);
        if (!finishing && !isFinishing() && !isDestroyed()) bumpChrome();
    }

    private void showOptionSheet(CharSequence title, String[] labels, int checkedIndex, OptionPick onPick) {
        if (menuScrim == null || menuList == null || labels == null || labels.length == 0) {
            toast(getString(R.string.player_no_options));
            return;
        }
        mainHandler.removeCallbacks(hideChromeRunnable);
        setChromeVisible(true);
        setChromeSubtreeFocusable(false);
        menuTitle.setText(title);
        menuList.removeAllViews();
        int focusIndex = Math.max(0, Math.min(checkedIndex, labels.length - 1));
        LayoutInflater inflater = LayoutInflater.from(this);
        Button focusRow = null;
        for (int i = 0; i < labels.length; i++) {
            Button row = (Button) inflater.inflate(R.layout.player_menu_row, menuList, false);
            boolean selected = i == focusIndex;
            String label = labels[i] == null ? "" : labels[i].trim();
            row.setText(selected ? "✓  " + label : label);
            row.setSelected(selected);
            if (Build.VERSION.SDK_INT >= 26) row.setDefaultFocusHighlightEnabled(false);
            final int index = i;
            row.setOnClickListener(v -> {
                hideOptionSheet();
                if (onPick != null) onPick.onPick(index);
            });
            menuList.addView(row);
            if (selected) focusRow = row;
        }
        menuScrim.setVisibility(View.VISIBLE);
        if (menuScroll != null) {
            ViewGroup.LayoutParams scrollLp = menuScroll.getLayoutParams();
            scrollLp.height = ViewGroup.LayoutParams.WRAP_CONTENT;
            menuScroll.setLayoutParams(scrollLp);
        }
        final Button toFocus = focusRow != null ? focusRow : (Button) menuList.getChildAt(0);
        if (toFocus != null) {
            toFocus.post(() -> {
                if (menuScroll != null && menuList != null) {
                    int maxH = Math.round(getResources().getDisplayMetrics().heightPixels * 0.56f);
                    if (menuList.getHeight() > maxH) {
                        ViewGroup.LayoutParams scrollLp = menuScroll.getLayoutParams();
                        scrollLp.height = maxH;
                        menuScroll.setLayoutParams(scrollLp);
                    }
                    menuScroll.scrollTo(0, Math.max(0, toFocus.getTop() - 24));
                }
                toFocus.requestFocus();
            });
        }
    }

    private void showChaptersMenu() {
        if (chapters.isEmpty()) {
            toast(getString(R.string.player_no_options));
            return;
        }
        String[] labels = new String[chapters.size()];
        for (int i = 0; i < chapters.size(); i++) {
            labels[i] = chapters.get(i).label;
        }
        showOptionSheet(getString(R.string.player_chapters), labels, 0, which -> {
            try {
                long startMs = Long.parseLong(chapters.get(which).id);
                seekToContent(startMs, true);
            } catch (Exception ignored) {
                /* ignore */
            }
        });
    }

    private void skipChapter(int direction) {
        if (chapters.isEmpty()) return;
        long pos = contentPositionMs();
        long target = -1;
        if (direction > 0) {
            for (OptionItem chapter : chapters) {
                try {
                    long startMs = Long.parseLong(chapter.id);
                    if (startMs > pos + 1200) {
                        target = startMs;
                        break;
                    }
                } catch (Exception ignored) {
                    /* skip */
                }
            }
        } else {
            for (int i = chapters.size() - 1; i >= 0; i--) {
                try {
                    long startMs = Long.parseLong(chapters.get(i).id);
                    if (startMs < pos - 1200) {
                        target = startMs;
                        break;
                    }
                } catch (Exception ignored) {
                    /* skip */
                }
            }
            if (target < 0) target = 0;
        }
        if (target >= 0) seekToContent(target, true);
        bumpChrome();
    }

    private void showSeekPreview(long positionMs) {
        if (seekPreview == null) return;
        if (previewThumbTemplate == null || previewThumbTemplate.isEmpty()) {
            seekPreview.setVisibility(View.GONE);
            return;
        }
        seekPreview.setVisibility(View.VISIBLE);
        final int gen = ++previewGeneration;
        final String url = previewThumbTemplate.replace("__OFFSET__", String.valueOf(Math.max(0, positionMs)));
        logoExecutor.execute(() -> {
            Bitmap bitmap = null;
            HttpURLConnection conn = null;
            try {
                conn = (HttpURLConnection) new URL(url).openConnection();
                conn.setConnectTimeout(2500);
                conn.setReadTimeout(2500);
                conn.setInstanceFollowRedirects(true);
                InputStream in = conn.getInputStream();
                bitmap = BitmapFactory.decodeStream(in);
                in.close();
            } catch (Exception ignored) {
                /* ignore */
            } finally {
                if (conn != null) conn.disconnect();
            }
            final Bitmap ready = bitmap;
            mainHandler.post(() -> {
                if (gen != previewGeneration || seekPreview == null) {
                    if (ready != null) ready.recycle();
                    return;
                }
                if (ready != null) seekPreview.setImageBitmap(ready);
            });
        });
    }

    private void hideSeekPreview() {
        previewGeneration += 1;
        if (seekPreview != null) seekPreview.setVisibility(View.GONE);
    }

    private void updateActionVisibility() {
        boolean tv = isTelevision();
        setVisible(qualityBtn, !musicMode && qualities.size() > 1);
        setVisible(audioBtn, audioTracks.size() > 1);
        setVisible(subsBtn, !musicMode);
        setVisible(versionBtn, !musicMode && versions.size() > 1);
        setVisible(speedBtn, true);
        setVisible(zoomBtn, !musicMode);
        setVisible(delayBtn, !musicMode);
        setVisible(repeatBtn, true);
        setVisible(sleepBtn, true);
        setVisible(externalBtn, !tv);
        setVisible(chaptersBtn, !chapters.isEmpty());
        updatePipVisibility();
    }

    private void setVisible(@Nullable View view, boolean visible) {
        if (view != null) {
            view.setVisibility(visible ? View.VISIBLE : View.GONE);
        }
    }

    private void updateChipLabels() {
        setChipLabel(qualityBtn, R.string.player_quality, labelFor(qualities, qualityId));
        setChipLabel(audioBtn, R.string.player_audio, labelFor(audioTracks, audioStreamId));
        String subId = subtitleStreamId == null ? "" : subtitleStreamId;
        String subLabel = subId.isEmpty() ? getString(R.string.player_subs_off) : labelFor(subtitles, subId);
        setChipLabel(subsBtn, R.string.player_subs, subLabel);
        setChipLabel(versionBtn, R.string.player_version, labelFor(versions, String.valueOf(mediaIndex)));
        if (speedBtn != null) {
            speedBtn.setText(getString(R.string.player_speed) + " · "
                + String.format(Locale.US, "%.2g×", playbackSpeed));
        }
        if (zoomBtn != null) {
            String zoomLabel = videoFill
                ? getString(R.string.player_zoom_fill)
                : (Math.abs(videoZoom - 1f) < 0.01f
                    ? getString(R.string.player_zoom_fit)
                    : String.format(Locale.US, "%.2g×", videoZoom));
            setChipLabel(zoomBtn, R.string.player_zoom, zoomLabel);
        }
        if (delayBtn != null) {
            setChipLabel(delayBtn, R.string.player_delay, audioDelayMs <= 0
                ? getString(R.string.player_delay_off)
                : audioDelayMs + " ms");
        }
        if (repeatBtn != null) {
            int repeatRes = repeatMode == Player.REPEAT_MODE_ONE ? R.string.player_repeat_one
                : repeatMode == Player.REPEAT_MODE_ALL ? R.string.player_repeat_all
                : R.string.player_repeat_off;
            setChipLabel(repeatBtn, R.string.player_repeat, getString(repeatRes));
        }
    }

    private static String labelFor(List<OptionItem> items, String id) {
        if (id == null) return "";
        for (OptionItem item : items) {
            if (item.id.equals(id)) return item.label;
        }
        return "";
    }

    private void setChipLabel(@Nullable Button button, int titleRes, @Nullable String detail) {
        if (button == null) return;
        String base = getString(titleRes);
        if (detail != null && !detail.isEmpty()) {
            String shortDetail = detail.length() > 28 ? detail.substring(0, 25) + "…" : detail;
            button.setText(base + " · " + shortDetail);
        } else {
            button.setText(base);
        }
    }

    private List<OptionItem> parseOptions(@Nullable JSONArray arr) {
        List<OptionItem> out = new ArrayList<>();
        if (arr == null) return out;
        for (int i = 0; i < arr.length(); i++) {
            JSONObject row = arr.optJSONObject(i);
            if (row == null) continue;
            String id = row.optString("id", "");
            String label = row.optString("label", id);
            if (id.isEmpty() && row.has("mediaIndex")) {
                id = String.valueOf(row.optInt("mediaIndex", i));
            }
            if (!label.isEmpty()) out.add(new OptionItem(id, label, row.optString("url", "")));
        }
        return out;
    }

    void applyUpdateSrc(String url, @Nullable String nextHeadersJson, long offsetMs) {
        if (player == null || url == null || url.trim().isEmpty()) return;
        errorGeneration++;
        currentUrl = url.trim();
        absorbTimelineFromUrl(currentUrl);
        if (nextHeadersJson != null && !nextHeadersJson.isEmpty()) {
            headersJson = nextHeadersJson;
        }
        if (httpFactory != null) {
            httpFactory.setDefaultRequestProperties(headersWithCookies(currentUrl, parseHeaders(headersJson)));
        }
        pendingSeekMs = 0;
        scrubTargetMs = -1;
        seekingUi = false;
        streamSwapInFlight = false;
        mainHandler.removeCallbacks(clearSwapRunnable);
        skippedIntro = false;
        skippedCredits = false;
        skipFocusGiven = false;
        playbackEnded = false;
        playbackError = false;
        hideError();
        queueStartPosition(currentUrl, offsetMs);
        player.prepare();
        player.setPlayWhenReady(!userPaused);
        if (!minimized) bumpChrome();
    }

    void applySeek(long positionMs) {
        seekToContent(positionMs, true);
    }

    void applySpeed(float speed) {
        playbackSpeed = Math.max(0.25f, Math.min(2f, speed));
        if (player != null) {
            player.setPlaybackParameters(new PlaybackParameters(playbackSpeed));
        }
        if (speedLabel != null) {
            speedLabel.setText(String.format(Locale.US, "%.2g×", playbackSpeed));
        }
        updateChipLabels();
    }

    private void showOptionMenu(int titleRes, String kind, List<OptionItem> items, String selectedId) {
        bumpChrome();
        if (items.isEmpty()) {
            toast(getString(R.string.player_no_options));
            return;
        }
        String currentLabel = labelFor(items, selectedId);
        if (currentLabel == null || currentLabel.isEmpty()) {
            if ("subtitle".equals(kind) && (selectedId == null || selectedId.isEmpty())) {
                currentLabel = getString(R.string.player_subs_off);
            }
        }
        String[] labels = new String[items.size()];
        int checked = 0;
        for (int i = 0; i < items.size(); i++) {
            OptionItem item = items.get(i);
            boolean selected = item.id.equals(selectedId == null ? "" : selectedId);
            labels[i] = selected ? ("✓  " + item.label) : ("    " + item.label);
            labels[i] = item.label;
            if (item.id.equals(selectedId == null ? "" : selectedId)) checked = i;
        }
        CharSequence title = currentLabel == null || currentLabel.isEmpty()
            ? getString(titleRes)
            : getString(titleRes) + "  ·  " + currentLabel;
        showOptionSheet(title, labels, checked, which -> {
            OptionItem picked = items.get(which);
            if ("version".equals(kind)) {
                try {
                    mediaIndex = Integer.parseInt(picked.id);
                } catch (Exception ignored) {
                    mediaIndex = which;
                }
                requestStreamChange(qualityId, audioStreamId, subtitleStreamId, mediaIndex);
            } else if ("quality".equals(kind)) {
                qualityId = picked.id;
                saveAvPrefs();
                requestStreamChange(qualityId, audioStreamId, subtitleStreamId, mediaIndex);
            } else if ("audio".equals(kind)) {
                audioStreamId = picked.id;
                saveAvPrefs();
                requestStreamChange(qualityId, audioStreamId, subtitleStreamId, mediaIndex);
            } else if ("subtitle".equals(kind)) {
                if (SUBTITLE_SEARCH_ID.equals(picked.id)) {
                    requestSubtitleSearch();
                    return;
                }
                applySubtitleChoice(picked);
            }
            updateChipLabels();
        });
    }

    private void showSpeedMenu() {
        bumpChrome();
        final float[] speeds = {0.5f, 0.75f, 1f, 1.25f, 1.5f, 1.75f, 2f};
        String[] labels = new String[speeds.length];
        int checked = 2;
        for (int i = 0; i < speeds.length; i++) {
            labels[i] = String.format(Locale.US, "%.2gx", speeds[i]);
            if (Math.abs(speeds[i] - playbackSpeed) < 0.01f) checked = i;
        }
        showOptionSheet(getString(R.string.player_speed), labels, checked, which -> {
            applySpeed(speeds[which]);
            updateChipLabels();
            JSObject data = new JSObject();
            data.put("speed", playbackSpeed);
            PlayerBridge.get().emit("speed", data);
        });
    }

    private void showSubtitleMenu() {
        List<OptionItem> withOff = new ArrayList<>();
        withOff.add(new OptionItem("", getString(R.string.player_subs_off)));
        withOff.add(new OptionItem(SUBTITLE_SEARCH_ID, getString(R.string.player_subs_search)));
        withOff.addAll(subtitles);
        showOptionMenu(R.string.player_subs, "subtitle", withOff, subtitleStreamId == null ? "" : subtitleStreamId);
    }

    private void requestSubtitleSearch() {
        subtitleSearchPending = true;
        JSObject data = new JSObject();
        data.put("ratingKey", ratingKey == null ? "" : ratingKey);
        PlayerBridge.get().emit("subtitleSearch", data);
        toast(getString(R.string.player_subs_search));
    }

    private void applySubtitleChoice(OptionItem picked) {
        String previousSidecar = sidecarSubtitleUrl;
        subtitleStreamId = picked.id;
        boolean sidecar = picked.id != null && picked.id.startsWith("os:") && !picked.url.isEmpty();
        sidecarSubtitleUrl = sidecar ? picked.url : "";
        saveAvPrefs();
        updateChipLabels();
        if (sidecar) {
            reloadCurrentMedia();
            return;
        }
        if (!previousSidecar.isEmpty()) reloadCurrentMedia();
        requestStreamChange(qualityId, audioStreamId, subtitleStreamId, mediaIndex);
    }

    private void showZoomMenu() {
        bumpChrome();
        final float[] zooms = {1f, 1.1f, 1.25f, 1.5f, 2f};
        String[] labels = new String[zooms.length + 1];
        int checked = 0;
        labels[0] = getString(R.string.player_zoom_fit);
        if (!videoFill && Math.abs(videoZoom - 1f) < 0.01f) checked = 0;
        for (int i = 0; i < zooms.length; i++) {
            if (i == 0) continue;
            labels[i] = String.format(Locale.US, "%.2g×", zooms[i]);
            if (!videoFill && Math.abs(videoZoom - zooms[i]) < 0.01f) checked = i;
        }
        labels[zooms.length] = getString(R.string.player_zoom_fill);
        if (videoFill) checked = zooms.length;
        showOptionSheet(getString(R.string.player_zoom), labels, checked, which -> {
            videoFill = which == zooms.length;
            videoZoom = videoFill ? 1f : zooms[Math.min(which, zooms.length - 1)];
            applyVideoZoom();
            savePlayerLookPrefs();
            updateChipLabels();
        });
    }

    private void showDelayMenu() {
        bumpChrome();
        final int[] delays = {0, 25, 50, 75, 100, 150, 200, 250, 400, 500};
        String[] labels = new String[delays.length];
        int checked = 0;
        for (int i = 0; i < delays.length; i++) {
            labels[i] = delays[i] <= 0 ? getString(R.string.player_delay_off) : delays[i] + " ms";
            if (delays[i] == audioDelayMs) checked = i;
        }
        showOptionSheet(getString(R.string.player_delay), labels, checked, which -> {
            audioDelayMs = delays[which];
            applyAudioDelay(true);
            savePlayerLookPrefs();
            updateChipLabels();
        });
    }

    private void showRepeatMenu() {
        bumpChrome();
        final int[] modes = {Player.REPEAT_MODE_OFF, Player.REPEAT_MODE_ONE, Player.REPEAT_MODE_ALL};
        String[] labels = {
            getString(R.string.player_repeat_off),
            getString(R.string.player_repeat_one),
            getString(R.string.player_repeat_all),
        };
        int checked = 0;
        for (int i = 0; i < modes.length; i++) {
            if (modes[i] == repeatMode) checked = i;
        }
        showOptionSheet(getString(R.string.player_repeat), labels, checked, which -> {
            repeatMode = modes[which];
            applyRepeatMode();
            savePlayerLookPrefs();
            updateChipLabels();
        });
    }

    private void applyVideoZoom() {
        PlayerView view = findViewById(R.id.player_view);
        if (player != null) {
            player.setVideoScalingMode(videoFill
                ? C.VIDEO_SCALING_MODE_SCALE_TO_FIT_WITH_CROPPING
                : C.VIDEO_SCALING_MODE_SCALE_TO_FIT);
        }
        if (view == null) return;
        View surface = view.getVideoSurfaceView();
        if (surface == null) return;
        float zoom = videoFill ? 1f : Math.max(1f, Math.min(2f, videoZoom));
        surface.setScaleX(zoom);
        surface.setScaleY(zoom);
        surface.setPivotX(surface.getWidth() / 2f);
        surface.setPivotY(surface.getHeight() / 2f);
    }

    private void applyAudioDelay(boolean flush) {
        delayAudioProcessor.setDelayMs(audioDelayMs);
        if (flush && player != null) {
            long pos = contentPositionMs();
            player.seekTo(Math.max(0, pos - timelineOriginMs));
        }
    }

    private void applyRepeatMode() {
        if (player == null) return;
        player.setRepeatMode(repeatMode == Player.REPEAT_MODE_ONE
            ? Player.REPEAT_MODE_ONE
            : Player.REPEAT_MODE_OFF);
    }

    private void reloadCurrentMedia() {
        if (player == null || currentUrl == null || currentUrl.isEmpty()) return;
        long offset = contentPositionMs();
        queueStartPosition(currentUrl, isTranscodeUrl(currentUrl) ? 0 : offset);
        player.prepare();
        player.setPlayWhenReady(!userPaused);
    }

    private void savePlayerLookPrefs() {
        getSharedPreferences(PREFS, MODE_PRIVATE).edit()
            .putFloat("videoZoom", videoZoom)
            .putBoolean("videoFill", videoFill)
            .putInt("audioDelayMs", audioDelayMs)
            .putInt("repeatMode", repeatMode)
            .apply();
    }

    private void showSleepMenu() {
        bumpChrome();
        String[] labels = {
            getString(R.string.player_sleep_off),
            getString(R.string.player_sleep_15),
            getString(R.string.player_sleep_30),
            getString(R.string.player_sleep_45),
            getString(R.string.player_sleep_end),
        };
        showOptionSheet(getString(R.string.player_sleep), labels, 0, which -> {
            sleepEndOfEpisode = false;
            sleepUntilElapsedRealtime = 0;
            if (which == 1) sleepUntilElapsedRealtime = android.os.SystemClock.elapsedRealtime() + 15 * 60_000L;
            else if (which == 2) sleepUntilElapsedRealtime = android.os.SystemClock.elapsedRealtime() + 30 * 60_000L;
            else if (which == 3) sleepUntilElapsedRealtime = android.os.SystemClock.elapsedRealtime() + 45 * 60_000L;
            else if (which == 4) sleepEndOfEpisode = true;
            toast(labels[which]);
        });
    }

    private void requestStreamChange(String q, String a, String s, int mi) {
        requestStreamChange(q, a, s, mi, contentPositionMs());
    }

    private void requestStreamChange(String q, String a, String s, int mi, long positionMs) {
        requestStreamChange(q, a, s, mi, positionMs, null);
    }

    private void requestStreamChange(String q, String a, String s, int mi, long positionMs, @Nullable String reason) {
        JSObject data = new JSObject();
        data.put("qualityId", q == null ? "" : q);
        data.put("audioStreamId", a == null ? "" : a);
        data.put("subtitleStreamId", s == null ? "" : s);
        data.put("mediaIndex", mi);
        data.put("positionMs", Math.max(0, positionMs));
        if (reason != null && !reason.isEmpty()) data.put("reason", reason);
        PlayerBridge.get().emit("streamChange", data);
        setBufferingVisible(true);
    }

    private void openExternalPlayer() {
        bumpChrome();
        if (currentUrl == null || currentUrl.isEmpty()) return;
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(Uri.parse(currentUrl), "video/*");
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            Intent chooser = Intent.createChooser(intent, getString(R.string.player_external));
            startActivity(chooser);
            emitProgress("paused");
        } catch (Exception e) {
            toast("No external player found");
        }
    }

    private void enterPip() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        if (isTelevision()) return;
        if (!getPackageManager().hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE)) return;
        try {
            PictureInPictureParams params = new PictureInPictureParams.Builder()
                .setAspectRatio(new Rational(16, 9))
                .build();
            enterPictureInPictureMode(params);
            setChromeVisible(false);
        } catch (Exception e) {
            toast("PiP unavailable");
        }
    }

    private void updatePipVisibility() {
        boolean show = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            && !isTelevision()
            && getPackageManager().hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE);
        pipBtn.setVisibility(show ? View.VISIBLE : View.GONE);
    }

    private boolean isTelevision() {
        UiModeManager ui = (UiModeManager) getSystemService(UI_MODE_SERVICE);
        return ui != null && ui.getCurrentModeType() == Configuration.UI_MODE_TYPE_TELEVISION;
    }

    private void togglePlayPause() {
        applyPlayPause(player != null && !player.isPlaying());
    }

    void applyPlayPause(boolean play) {
        if (player == null) return;
        userPaused = !play;
        if (play) player.play();
        else player.pause();
        if (!minimized) bumpChrome();
    }

    private void seekBy(long deltaMs) {
        seekToContent(contentPositionMs() + deltaMs, false);
        bumpChrome();
    }

    private void doSkipIntro() {
        if (introEndMs < 0) return;
        seekToContent(introEndMs, true);
        skippedIntro = true;
        skipIntroBtn.setVisibility(View.GONE);
        if (skipRow != null && (skipCreditsBtn == null || skipCreditsBtn.getVisibility() != View.VISIBLE)) {
            skipRow.setVisibility(View.GONE);
        }
        emitProgress("playing");
    }

    private void doSkipCredits() {
        skippedCredits = true;
        skipCreditsBtn.setVisibility(View.GONE);
        if (skipRow != null && (skipIntroBtn == null || skipIntroBtn.getVisibility() != View.VISIBLE)) {
            skipRow.setVisibility(View.GONE);
        }
        if (autoplayNext && nextRatingKey != null && !nextRatingKey.isEmpty()) {
            finishForPlayNext();
        } else {
            finishWithResult(true, false);
        }
    }

    private boolean inIntroRange() {
        if (skippedIntro || introStartMs < 0 || introEndMs <= introStartMs) return false;
        long pos = contentPositionMs();
        return pos >= introStartMs && pos < introEndMs;
    }

    private boolean inCreditsRange() {
        if (skippedCredits || creditsStartMs < 0) return false;
        return contentPositionMs() >= creditsStartMs;
    }

    private boolean trySkipFromRemote() {
        if (inIntroRange()) {
            doSkipIntro();
            return true;
        }
        if (inCreditsRange()) {
            doSkipCredits();
            return true;
        }
        return false;
    }

    private void maybeAutoSkip() {
        if (player == null) return;
        long pos = contentPositionMs();
        if (autoSkipIntro && !skippedIntro && introStartMs >= 0 && introEndMs > introStartMs
            && pos >= introStartMs && pos < introEndMs) {
            doSkipIntro();
        }
        if (autoSkipCredits && !skippedCredits && creditsStartMs >= 0 && pos >= creditsStartMs) {
            doSkipCredits();
        }
        boolean inIntro = inIntroRange();
        boolean inCredits = inCreditsRange();
        skipIntroBtn.setVisibility(inIntro ? View.VISIBLE : View.GONE);
        skipCreditsBtn.setVisibility(inCredits ? View.VISIBLE : View.GONE);
        if (skipRow != null) {
            skipRow.setVisibility((inIntro || inCredits) ? View.VISIBLE : View.GONE);
        }
        if (inIntro || inCredits) {
            if (!skipFocusGiven) {
                skipFocusGiven = true;
                bumpChrome();
                if (inIntro && skipIntroBtn != null) skipIntroBtn.requestFocus();
                else if (inCredits && skipCreditsBtn != null) skipCreditsBtn.requestFocus();
            }
        } else {
            skipFocusGiven = false;
        }
    }

    private void maybeShowUpNext() {
        if (upNextRow == null) return;
        if (watchCreditsChosen || nextRatingKey == null || nextRatingKey.isEmpty()) {
            upNextRow.setVisibility(View.GONE);
            return;
        }
        long pos = contentPositionMs();
        long duration = contentDurationMs();
        boolean nearEnd = duration > 0 && pos >= Math.max(0, duration - 30_000);
        boolean inCredits = creditsStartMs >= 0 && pos >= creditsStartMs;
        boolean show = nearEnd || inCredits;
        boolean wasHidden = upNextRow.getVisibility() != View.VISIBLE;
        upNextRow.setVisibility(show ? View.VISIBLE : View.GONE);
        if (!show) return;
        if (upNextLabel != null) {
            upNextLabel.setText(nextTitle.isEmpty() ? getString(R.string.player_up_next) : nextTitle);
        }
        applyUpNextArt();
        if (upNextCountdown != null) {
            int seconds = duration > pos ? (int) Math.max(1, Math.ceil((duration - pos) / 1000.0)) : 0;
            if (autoplayNext && seconds > 0) {
                upNextCountdown.setVisibility(View.VISIBLE);
                upNextCountdown.setText(getString(R.string.player_up_next_in, seconds));
            } else {
                upNextCountdown.setVisibility(View.GONE);
            }
        }
        if (wasHidden && upNextPlayBtn != null) upNextPlayBtn.requestFocus();
    }

    private void dismissUpNextWatchCredits() {
        watchCreditsChosen = true;
        autoplayNext = false;
        if (upNextRow != null) upNextRow.setVisibility(View.GONE);
    }

    private void maybeSleepTimer() {
        if (sleepEndOfEpisode) return;
        if (sleepUntilElapsedRealtime <= 0) return;
        if (android.os.SystemClock.elapsedRealtime() >= sleepUntilElapsedRealtime) {
            sleepUntilElapsedRealtime = 0;
            if (player != null) player.pause();
            toast("Sleep timer");
            finishWithResult(false, false);
        }
    }

    private void updateProgressUi() {
        if (player == null) return;
        reconcileTranscodeOrigin();
        if (scrubTargetMs >= 0) {
            long playerPos = Math.max(0, timelineOriginMs + Math.max(0, player.getCurrentPosition()));
            boolean caughtUp = Math.abs(playerPos - scrubTargetMs) < 1500;
            boolean holding = android.os.SystemClock.elapsedRealtime() < scrubHoldUntilMs;
            if (!caughtUp && holding) {
                long duration = contentDurationMs();
                if (duration > 0 && seekBar != null) {
                    seekBar.setProgress((int) Math.min(1000, Math.max(0, (scrubTargetMs * 1000L) / duration)));
                }
                if (timeView != null) {
                    timeView.setText(formatClock(scrubTargetMs) + " / " + formatClock(Math.max(0, duration)));
                }
                return;
            }
            scrubTargetMs = -1;
            seekingUi = false;
        } else if (seekingUi) {
            return;
        }
        long pos = contentPositionMs();
        long duration = contentDurationMs();
        if (duration > 0) {
            int progress = (int) Math.min(1000, Math.max(0, (pos * 1000L) / duration));
            seekBar.setProgress(progress);
        }
        timeView.setText(formatClock(pos) + " / " + formatClock(Math.max(0, duration)));
        updatePlayPauseLabel();
    }

    private void updatePlayPauseLabel() {
        if (playPauseBtn == null || player == null) return;
        boolean playing = player.isPlaying();
        playPauseBtn.setImageResource(playing ? R.drawable.ic_player_pause : R.drawable.ic_player_play);
        playPauseBtn.setContentDescription(getString(playing ? R.string.player_pause : R.string.player_play));
    }

    private void emitProgress(String state) {
        pingPlexTimeline(state);
        if (player == null) return;
        JSObject data = new JSObject();
        data.put("state", state);
        data.put("positionMs", contentPositionMs());
        long duration = contentDurationMs();
        data.put("durationMs", Math.max(0, duration));
        data.put("ratingKey", ratingKey);
        PlayerBridge.get().emit("progress", data);
    }

    private static String queryParam(Uri uri, String key) {
        if (uri == null || key == null) return "";
        try {
            String value = uri.getQueryParameter(key);
            return value == null ? "" : value.trim();
        } catch (Throwable ignored) {
            return "";
        }
    }

    private void absorbTimelineFromUrl(String url) {
        if (url == null || url.isEmpty() || url.contains("/api/media-player/")) return;
        try {
            Uri parsed = Uri.parse(url);
            String token = queryParam(parsed, "X-Plex-Token");
            if (token.isEmpty()) token = queryParam(parsed, "access_token");
            if (!token.isEmpty()) timelineToken = token;
            String clientId = queryParam(parsed, "X-Plex-Client-Identifier");
            if (!clientId.isEmpty()) timelineClientId = clientId;
            String session = queryParam(parsed, "X-Plex-Session-Identifier");
            if (session.isEmpty()) session = queryParam(parsed, "session");
            if (!session.isEmpty()) timelineSessionId = session;
            String product = queryParam(parsed, "X-Plex-Product");
            if (!product.isEmpty()) timelineProduct = product;
            String platform = queryParam(parsed, "X-Plex-Platform");
            if (!platform.isEmpty()) timelinePlatform = platform;
            String device = queryParam(parsed, "X-Plex-Device");
            if (!device.isEmpty()) timelineDevice = device;
            String deviceName = queryParam(parsed, "X-Plex-Device-Name");
            if (!deviceName.isEmpty()) timelineDeviceName = deviceName;
            if ((timelineOrigin == null || timelineOrigin.isEmpty())
                    && parsed.getScheme() != null
                    && parsed.getHost() != null) {
                String origin = parsed.getScheme() + "://" + parsed.getHost();
                if (parsed.getPort() != -1) origin += ":" + parsed.getPort();
                timelineOrigin = origin;
            }
        } catch (Throwable ignored) {
            /* malformed playback url */
        }
    }

    private boolean shouldMarkWatched(long positionMs, boolean ended) {
        if (ended || playbackEnded) return true;
        long durationMs = 0L;
        try {
            durationMs = contentDurationMs();
        } catch (Throwable ignored) {
            durationMs = Math.max(0L, durationHintMs);
        }
        if (creditsStartMs >= 0 && positionMs >= creditsStartMs) return true;
        if (durationMs <= 0) return false;
        if (positionMs >= (long) (durationMs * 0.9d)) return true;
        return positionMs > Math.max(0L, durationMs - 15_000L);
    }

    private void scrobbleWatched() {
        absorbTimelineFromUrl(currentUrl);
        if (ratingKey == null || ratingKey.trim().isEmpty()) return;
        if (timelineOrigin == null || timelineOrigin.isEmpty() || timelineToken == null || timelineToken.isEmpty()) {
            return;
        }
        try {
            Uri.Builder builder = Uri.parse(timelineOrigin + "/:/scrobble").buildUpon();
            builder.appendQueryParameter("identifier", "com.plexapp.plugins.library");
            builder.appendQueryParameter("key", ratingKey);
            builder.appendQueryParameter("X-Plex-Token", timelineToken);
            final String pingUrl = builder.build().toString();
            logoExecutor.execute(() -> httpPingTimeline(pingUrl, null, "GET"));
        } catch (Throwable e) {
            Log.w(TAG, "Plex scrobble skipped", e);
        }
    }

    private void pingPlexTimeline(String rawState) {
        pingPlexTimeline(rawState, -1L);
    }

    private void pingPlexTimeline(String rawState, long positionOverrideMs) {
        String state = "playing";
        if ("paused".equals(rawState) || "stopped".equals(rawState) || "buffering".equals(rawState)) {
            state = rawState;
        }
        long now = SystemClock.elapsedRealtime();
        boolean important = "stopped".equals(state) || "paused".equals(state) || !state.equals(lastTimelineState);
        if (!important && now - lastTimelinePingElapsedMs < 5_000) return;
        lastTimelinePingElapsedMs = now;
        lastTimelineState = state;
        absorbTimelineFromUrl(currentUrl);
        if (ratingKey == null || ratingKey.trim().isEmpty()) return;
        long positionMs = 0L;
        long durationMs = Math.max(0L, durationHintMs);
        if (player != null) {
            try {
                positionMs = Math.max(0L, contentPositionMs());
                durationMs = Math.max(durationMs, contentDurationMs());
            } catch (Throwable ignored) {
                /* player tearing down */
            }
        }
        if (positionOverrideMs >= 0L) positionMs = positionOverrideMs;
        final String pingState = state;
        final long pingPosition = positionMs;
        final long pingDuration = durationMs;
        if (timelineOrigin != null && !timelineOrigin.isEmpty() && timelineToken != null && !timelineToken.isEmpty()) {
            final String pingUrl = buildPmsTimelineUrl(pingState, pingPosition, pingDuration);
            if (pingUrl != null) {
                logoExecutor.execute(() -> httpPingTimeline(pingUrl, null, "GET"));
                return;
            }
        }
        final String portalUrl = buildPortalTimelineUrl();
        if (portalUrl == null) return;
        final String body = buildPortalTimelineBody(pingState, pingPosition, pingDuration);
        if (body == null) return;
        logoExecutor.execute(() -> httpPingTimeline(portalUrl, body, "POST"));
    }

    private String buildPmsTimelineUrl(String state, long positionMs, long durationMs) {
        if (timelineOrigin == null || timelineOrigin.isEmpty() || timelineToken == null || timelineToken.isEmpty()) {
            return null;
        }
        try {
            Uri.Builder builder = Uri.parse(timelineOrigin + "/:/timeline").buildUpon();
            builder.appendQueryParameter("ratingKey", ratingKey);
            builder.appendQueryParameter("key", "/library/metadata/" + ratingKey);
            builder.appendQueryParameter("identifier", "com.plexapp.plugins.library");
            builder.appendQueryParameter("state", state);
            builder.appendQueryParameter("time", String.valueOf(positionMs));
            builder.appendQueryParameter("playbackTime", String.valueOf(positionMs));
            builder.appendQueryParameter("duration", String.valueOf(Math.max(0L, durationMs)));
            builder.appendQueryParameter("type", musicMode ? "music" : "video");
            builder.appendQueryParameter("hasMDE", "1");
            builder.appendQueryParameter("X-Plex-Token", timelineToken);
            builder.appendQueryParameter("X-Plex-Client-Identifier",
                    timelineClientId == null || timelineClientId.isEmpty() ? "streampilot-android" : timelineClientId);
            builder.appendQueryParameter("X-Plex-Product", timelineProduct);
            builder.appendQueryParameter("X-Plex-Version", timelineVersion);
            builder.appendQueryParameter("X-Plex-Platform", timelinePlatform);
            builder.appendQueryParameter("X-Plex-Device", timelineDevice);
            builder.appendQueryParameter("X-Plex-Device-Name", timelineDeviceName);
            builder.appendQueryParameter("X-Plex-Provides", "player,controller");
            if (timelineSessionId != null && !timelineSessionId.isEmpty()) {
                builder.appendQueryParameter("X-Plex-Session-Identifier", timelineSessionId);
            }
            String audioId = audioStreamId == null ? "" : audioStreamId.replaceAll("\\D", "");
            if (!audioId.isEmpty()) builder.appendQueryParameter("audioStreamID", audioId);
            String subId = subtitleStreamId == null ? "" : subtitleStreamId.replaceAll("\\D", "");
            builder.appendQueryParameter("subtitleStreamID", subId.isEmpty() ? "0" : subId);
            return builder.build().toString();
        } catch (Throwable e) {
            Log.w(TAG, "Plex timeline URL skipped", e);
            return null;
        }
    }

    @Nullable
    private String buildPortalTimelineUrl() {
        if (currentUrl == null || !currentUrl.contains("/api/media-player/")) return null;
        try {
            Uri parsed = Uri.parse(currentUrl);
            if (parsed.getScheme() == null || parsed.getHost() == null) return null;
            String origin = parsed.getScheme() + "://" + parsed.getHost();
            if (parsed.getPort() != -1) origin += ":" + parsed.getPort();
            return origin + "/api/media-player/timeline";
        } catch (Throwable ignored) {
            return null;
        }
    }

    @Nullable
    private String buildPortalTimelineBody(String state, long positionMs, long durationMs) {
        try {
            JSONObject body = new JSONObject();
            body.put("ratingKey", ratingKey);
            body.put("state", state);
            body.put("timeMs", positionMs);
            body.put("durationMs", Math.max(0L, durationMs));
            if (timelineSessionId != null && !timelineSessionId.isEmpty()) {
                body.put("sessionId", timelineSessionId);
            }
            if (audioStreamId != null && !audioStreamId.isEmpty()) body.put("audioStreamId", audioStreamId);
            if (subtitleStreamId != null) body.put("subtitleStreamId", subtitleStreamId);
            return body.toString();
        } catch (Throwable ignored) {
            return null;
        }
    }

    private void httpPingTimeline(String url, @Nullable String body, String method) {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(url).openConnection();
            conn.setConnectTimeout(4_000);
            conn.setReadTimeout(4_000);
            conn.setInstanceFollowRedirects(true);
            conn.setRequestMethod(method);
            conn.setRequestProperty("Accept", "application/json, text/plain, */*");
            conn.setRequestProperty("User-Agent", USER_AGENT);
            if (timelineToken != null && !timelineToken.isEmpty()) {
                conn.setRequestProperty("X-Plex-Token", timelineToken);
            }
            if (timelineClientId != null && !timelineClientId.isEmpty()) {
                conn.setRequestProperty("X-Plex-Client-Identifier", timelineClientId);
            }
            if (timelineSessionId != null && !timelineSessionId.isEmpty()) {
                conn.setRequestProperty("X-Plex-Session-Identifier", timelineSessionId);
            }
            conn.setRequestProperty("X-Plex-Product", timelineProduct);
            conn.setRequestProperty("X-Plex-Device-Name", timelineDeviceName);
            conn.setRequestProperty("X-Plex-Provides", "player,controller");
            try {
                String cookie = CookieManager.getInstance().getCookie(url);
                if (cookie != null && !cookie.isEmpty()) conn.setRequestProperty("Cookie", cookie);
            } catch (Throwable ignored) {
                /* cookies optional for direct PMS */
            }
            if (body != null) {
                byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
                conn.setDoOutput(true);
                conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                conn.setRequestProperty("X-Requested-With", "ServerManagerPortal");
                try (OutputStream out = conn.getOutputStream()) {
                    out.write(bytes);
                }
            }
            conn.getResponseCode();
        } catch (Throwable e) {
            Log.w(TAG, "Plex timeline ping failed", e);
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private void toggleChrome() {
        setChromeVisible(!chromeVisible);
        if (chromeVisible) bumpChrome();
    }

    private void setChromeVisible(boolean visible) {
        boolean wasHidden = chrome == null || chrome.getVisibility() != View.VISIBLE;
        chromeVisible = visible;
        int vis = visible ? View.VISIBLE : View.GONE;
        if (chrome != null) chrome.setVisibility(vis);
        if (topBar != null) topBar.setVisibility(vis);
        setClockVisible(visible);
        if (visible && wasHidden && playPauseBtn != null) {
            playPauseBtn.requestFocus();
        } else if (!visible && !isOptionDialogShowing()) {
            View root = findViewById(R.id.player_root);
            if (root != null) root.requestFocus();
        }
    }

    private void setBufferingVisible(boolean visible) {
        if (bufferingView != null) {
            bufferingView.setVisibility(visible ? View.VISIBLE : View.GONE);
        }
    }

    private void showError(String message) {
        if (errorView == null) return;
        errorView.setText(message);
        errorView.setVisibility(View.VISIBLE);
        setBufferingVisible(false);
        setChromeVisible(true);
        View close = findViewById(R.id.player_close);
        if (close != null) close.requestFocus();
    }

    private void hideError() {
        if (errorView != null) errorView.setVisibility(View.GONE);
    }

    private Map<String, String> headersWithCookies(String url, Map<String, String> incoming) {
        Map<String, String> headers = incoming == null ? new HashMap<>() : new HashMap<>(incoming);
        if (!headers.containsKey("User-Agent")) {
            headers.put("User-Agent", USER_AGENT);
        }
        if (!headers.containsKey("Accept-Encoding")) {
            headers.put("Accept-Encoding", "identity");
        }
        try {
            String cookie = CookieManager.getInstance().getCookie(url);
            if (cookie != null && !cookie.isEmpty()) {
                headers.put("Cookie", cookie);
            }
        } catch (Throwable ignored) {
            /* CookieManager not ready */
        }
        return headers;
    }

    private void bumpChrome() {
        setChromeVisible(true);
        mainHandler.removeCallbacks(hideChromeRunnable);
        mainHandler.postDelayed(hideChromeRunnable, 5000);
    }

    private void restoreAvPrefs() {
        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        videoZoom = prefs.getFloat("videoZoom", videoZoom);
        videoFill = prefs.getBoolean("videoFill", videoFill);
        audioDelayMs = prefs.getInt("audioDelayMs", audioDelayMs);
        repeatMode = prefs.getInt("repeatMode", repeatMode);
        if (ratingKey == null || ratingKey.isEmpty()) return;
        String key = prefsKey();
        String savedAudio = prefs.getString(key + ":audio", null);
        String savedSub = prefs.getString(key + ":sub", null);
        String savedAudioLang = prefs.getString(key + ":audioLang", "");
        String savedSubLang = prefs.getString(key + ":subLang", null);
        String matchedAudio = matchTrackIdByLang(audioTracks, savedAudioLang);
        if (matchedAudio != null) audioStreamId = matchedAudio;
        if (savedSubLang != null) {
            if (savedSubLang.isEmpty() || "off".equalsIgnoreCase(savedSubLang)) {
                subtitleStreamId = "";
            } else {
                String matchedSub = matchTrackIdByLang(subtitles, savedSubLang);
                if (matchedSub != null) subtitleStreamId = matchedSub;
            }
        }
    }

    private void saveAvPrefs() {
        if (ratingKey == null || ratingKey.isEmpty()) return;
        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        String key = prefsKey();
        prefs.edit()
            .putString(key + ":audio", audioStreamId == null ? "" : audioStreamId)
            .putString(key + ":sub", subtitleStreamId == null ? "" : subtitleStreamId)
            .putString(key + ":audioLang", trackLangKey(labelFor(audioTracks, audioStreamId)))
            .putString(key + ":subLang", subtitleStreamId == null || subtitleStreamId.isEmpty()
                ? "off"
                : trackLangKey(labelFor(subtitles, subtitleStreamId)))
            .apply();
    }

    private static String trackLangKey(String label) {
        if (label == null) return "";
        String text = label.trim().toLowerCase(Locale.US);
        if (text.isEmpty()) return "";
        int cut = text.length();
        for (int i = 0; i < text.length(); i++) {
            char ch = text.charAt(i);
            if (ch == ' ' || ch == '·' || ch == '(' || ch == '|' || ch == '/') {
                cut = i;
                break;
            }
        }
        return text.substring(0, cut).trim();
    }

    private static String matchTrackIdByLang(List<OptionItem> tracks, String langKey) {
        String want = trackLangKey(langKey);
        if (want.isEmpty() || tracks == null || tracks.isEmpty()) return null;
        for (OptionItem track : tracks) {
            if (want.equals(trackLangKey(track.label))) return track.id;
        }
        return null;
    }

    private String prefsKey() {
        return (showKey != null && !showKey.isEmpty()) ? ("show:" + showKey) : ("item:" + ratingKey);
    }

    private boolean isTranscodeUrl(String url) {
        if (url == null) return false;
        String lower = url.toLowerCase(Locale.US);
        return lower.contains(".m3u8") || lower.contains("/transcode/") || lower.contains("/hls/");
    }

    private long contentPositionMs() {
        if (scrubTargetMs >= 0) return scrubTargetMs;
        long pos = player != null ? Math.max(0, player.getCurrentPosition()) : 0;
        return Math.max(0, timelineOriginMs + pos);
    }

    private long contentDurationMs() {
        if (durationHintMs > 0) return durationHintMs;
        long playerDuration = player != null ? player.getDuration() : 0;
        if (playerDuration > 0) return timelineOriginMs + playerDuration;
        return 0;
    }

    private boolean shouldRestartForSeek() {
        // A transcode playlist is a live window. Seeking inside it 404s.
        if (isTranscodeUrl(currentUrl)) return true;
        if (player == null) return false;
        return player.getPlaybackState() == Player.STATE_READY && !player.isCurrentMediaItemSeekable();
    }

    /**
     * Some Plex playlists already report the resume time as the player position.
     * Adding that same offset again shows 58:14 when the title was stopped at 29:07.
     */
    private void reconcileTranscodeOrigin() {
        if (transcodeAnchorMs < 5000 || player == null || !isTranscodeUrl(currentUrl)) return;
        long playerPos = Math.max(0, player.getCurrentPosition());
        long anchor = transcodeAnchorMs;
        if (playerPos + 3000 < anchor) return;
        transcodeAnchorMs = 0;
        if (playerPos > anchor + anchor / 2) {
            timelineOriginMs = 0;
            lastSeekTargetMs = anchor;
            lastSeekAtMs = android.os.SystemClock.elapsedRealtime();
            seekRecoveryUsed = false;
            player.seekTo(anchor);
            return;
        }
        timelineOriginMs = 0;
    }

    private void markStreamSwap() {
        streamSwapInFlight = true;
        mainHandler.removeCallbacks(clearSwapRunnable);
        mainHandler.postDelayed(clearSwapRunnable, 8000);
    }

    private boolean isSeekIoError(PlaybackException error) {
        int code = error.errorCode;
        return code == PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS
            || code == PlaybackException.ERROR_CODE_IO_UNSPECIFIED
            || code == PlaybackException.ERROR_CODE_IO_INVALID_HTTP_CONTENT_TYPE;
    }

    /**
     * A seek that hits a rejected range or a dead transcode segment reloads
     * once at that timestamp. Errors from the stream being replaced are ignored.
     */
    private boolean trySeekRecovery(PlaybackException error) {
        if (!isSeekIoError(error)) return false;
        if (streamSwapInFlight) return true;
        if (seekRecoveryUsed || lastSeekTargetMs < 0 || player == null) return false;
        if (android.os.SystemClock.elapsedRealtime() - lastSeekAtMs > 8000) return false;
        seekRecoveryUsed = true;
        playbackError = false;
        hideError();
        long target = lastSeekTargetMs;
        scrubTargetMs = target;
        scrubHoldUntilMs = android.os.SystemClock.elapsedRealtime() + 8000;
        markStreamSwap();
        requestStreamChange(qualityId, audioStreamId, subtitleStreamId, mediaIndex, target, "seek");
        return true;
    }

    private void seekToContent(long contentMs, boolean immediate) {
        long duration = contentDurationMs();
        long target = Math.max(0, contentMs);
        if (duration > 0) target = Math.min(target, Math.max(0, duration - 1500));
        scrubTargetMs = target;
        lastSeekTargetMs = target;
        lastSeekAtMs = android.os.SystemClock.elapsedRealtime();
        if (!streamSwapInFlight) seekRecoveryUsed = false;
        seekingUi = true;
        if (duration > 0 && seekBar != null) {
            seekBar.setProgress((int) Math.min(1000, Math.max(0, (target * 1000L) / duration)));
        }
        if (timeView != null) {
            timeView.setText(formatClock(target) + " / " + formatClock(Math.max(0, duration)));
        }
        bumpChrome();
        if (shouldRestartForSeek()) {
            scrubHoldUntilMs = android.os.SystemClock.elapsedRealtime() + 8000;
            pendingTranscodeSeekMs = target;
            mainHandler.removeCallbacks(transcodeSeekRunnable);
            if (immediate) transcodeSeekRunnable.run();
            else mainHandler.postDelayed(transcodeSeekRunnable, 400);
            return;
        }
        scrubHoldUntilMs = android.os.SystemClock.elapsedRealtime() + 1600;
        mainHandler.removeCallbacks(directSeekRunnable);
        if (immediate) directSeekRunnable.run();
        else mainHandler.postDelayed(directSeekRunnable, 200);
    }

    private void queueStartPosition(String url, long offsetMs) {
        if (player == null) return;
        MediaItem item = buildMediaItem(url);
        long start = Math.max(0, offsetMs);
        if (isTranscodeUrl(url)) {
            timelineOriginMs = start;
            transcodeAnchorMs = start;
            player.setMediaItem(item);
            return;
        }
        timelineOriginMs = 0;
        transcodeAnchorMs = 0;
        if (start > 0) player.setMediaItem(item, start);
        else player.setMediaItem(item);
    }

    private MediaItem buildMediaItem(String url) {
        MediaItem.Builder builder = new MediaItem.Builder().setUri(Uri.parse(url));
        String lower = url.toLowerCase(Locale.US);
        if (lower.contains(".m3u8") || lower.contains("/hls/")) {
            builder.setMimeType(MimeTypes.APPLICATION_M3U8);
        }
        if (sidecarSubtitleUrl != null && !sidecarSubtitleUrl.trim().isEmpty()) {
            String mime = sidecarSubtitleUrl.toLowerCase(Locale.US).contains(".vtt")
                ? MimeTypes.TEXT_VTT
                : MimeTypes.APPLICATION_SUBRIP;
            builder.setSubtitleConfigurations(Collections.singletonList(
                new MediaItem.SubtitleConfiguration.Builder(Uri.parse(sidecarSubtitleUrl))
                    .setMimeType(mime)
                    .setSelectionFlags(C.SELECTION_FLAG_DEFAULT)
                    .build()
            ));
        }
        return builder.build();
    }

    /**
     * ExoPlayer reports ERROR_CODE_IO_BAD_HTTP_STATUS when the portal returns JSON
     * (409 Direct Play refused, 502 transcode). Switch file→HLS, then Original→1080p.
     */
    private boolean tryStreamFallback(PlaybackException error) {
        int code = error.errorCode;
        boolean io = code == PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS
            || code == PlaybackException.ERROR_CODE_IO_UNSPECIFIED
            || code == PlaybackException.ERROR_CODE_IO_INVALID_HTTP_CONTENT_TYPE
            || code == PlaybackException.ERROR_CODE_PARSING_CONTAINER_MALFORMED
            || code == PlaybackException.ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED;
        if (!io || currentUrl == null || currentUrl.isEmpty()) return false;
        // Plex's own transcode and file URLs reject the portal quality rewrite.
        if (currentUrl.contains("/video/:/transcode/") || currentUrl.contains("/library/parts/")) return false;
        String next = null;
        if (currentUrl.contains("/file/") && streamFallbackStage < 1) {
            streamFallbackStage = 1;
            next = fileUrlToHls(currentUrl);
        } else if ((currentUrl.contains("/hls/") || currentUrl.contains(".m3u8")) && streamFallbackStage < 2) {
            streamFallbackStage = 2;
            next = withHlsQuality(currentUrl, "1080-12");
        }
        if (next == null || next.equals(currentUrl)) return false;
        Log.w(TAG, "Stream fallback → " + summarizeUrl(next));
        long offset = contentPositionMs();
        applyUpdateSrc(next, headersJson, offset);
        return true;
    }

    static String fileUrlToHls(String url) {
        String next = url.replaceFirst("/file/(\\d+)", "/hls/$1/master.m3u8");
        if (next.equals(url)) return url;
        Uri uri = Uri.parse(next);
        Uri.Builder builder = uri.buildUpon().clearQuery();
        for (String key : uri.getQueryParameterNames()) {
            if ("hevc".equals(key) || "ac3".equals(key) || "client".equals(key)
                || "textSubs".equals(key) || "download".equals(key)) {
                continue;
            }
            String value = uri.getQueryParameter(key);
            if (value != null) builder.appendQueryParameter(key, value);
        }
        if (uri.getQueryParameter("quality") == null) {
            builder.appendQueryParameter("quality", "original");
        }
        return builder.build().toString();
    }

    static String withHlsQuality(String url, String qualityId) {
        Uri uri = Uri.parse(url);
        Uri.Builder builder = uri.buildUpon().clearQuery();
        boolean wroteQuality = false;
        for (String key : uri.getQueryParameterNames()) {
            if ("quality".equals(key)) {
                builder.appendQueryParameter("quality", qualityId);
                wroteQuality = true;
                continue;
            }
            String value = uri.getQueryParameter(key);
            if (value != null) builder.appendQueryParameter(key, value);
        }
        if (!wroteQuality) builder.appendQueryParameter("quality", qualityId);
        String next = builder.build().toString();
        if (qualityId.equals(uri.getQueryParameter("quality"))) return url;
        return next;
    }

    private static String summarizeUrl(String url) {
        try {
            Uri uri = Uri.parse(url);
            return uri.getScheme() + "://" + uri.getHost() + uri.getPath();
        } catch (Throwable ignored) {
            return "(invalid)";
        }
    }

    private Map<String, String> parseHeaders(@Nullable String json) {
        Map<String, String> headers = new HashMap<>();
        if (json == null || json.trim().isEmpty()) return headers;
        try {
            JSONObject obj = new JSONObject(json);
            Iterator<String> keys = obj.keys();
            while (keys.hasNext()) {
                String key = keys.next();
                String value = obj.optString(key, "");
                if (key != null && !key.isEmpty() && value != null && !value.isEmpty()) {
                    headers.put(key, value);
                }
            }
        } catch (Exception ignored) {
            /* keep empty */
        }
        return headers;
    }

    private static String formatClock(long ms) {
        long totalSec = Math.max(0, ms / 1000);
        long h = totalSec / 3600;
        long m = (totalSec % 3600) / 60;
        long s = totalSec % 60;
        if (h > 0) return String.format(Locale.US, "%d:%02d:%02d", h, m, s);
        return String.format(Locale.US, "%d:%02d", m, s);
    }

    private void updateWallClock() {
        if (clockView == null) return;
        Calendar cal = Calendar.getInstance();
        String label = String.format(
            Locale.US,
            "%02d:%02d",
            cal.get(Calendar.HOUR_OF_DAY),
            cal.get(Calendar.MINUTE)
        );
        if (label.equals(lastClockLabel)) return;
        lastClockLabel = label;
        clockView.setText(label);
    }

    private boolean inPictureInPicture() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.N && isInPictureInPictureMode();
    }

    private void setClockVisible(boolean visible) {
        if (clockView == null) return;
        clockView.setVisibility(visible && !inPictureInPicture() ? View.VISIBLE : View.GONE);
    }

    @Override
    public void onPictureInPictureModeChanged(boolean isInPictureInPictureMode) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode);
        setClockVisible(chromeVisible && !isInPictureInPictureMode);
    }

    private void toast(String msg) {
        try {
            Toast.makeText(this, msg, Toast.LENGTH_SHORT).show();
        } catch (Throwable ignored) {
            /* ignore */
        }
    }

    private void finishForPlayNext() {
        finishWithResult(true, true);
    }

    private void requestPlayNextWithoutFinish() {
        if (nextRatingKey == null || nextRatingKey.isEmpty()) return;
        JSObject data = new JSObject();
        data.put("ratingKey", nextRatingKey);
        PlayerBridge.get().emit("playNext", data);
    }

    void skipNextFromPlugin() {
        if (nextRatingKey == null || nextRatingKey.isEmpty()) return;
        if (musicMode) requestPlayNextWithoutFinish();
        else finishForPlayNext();
    }

    boolean isMinimized() {
        return minimized;
    }

    void minimizeToBrowse() {
        if (!musicMode) {
            finishWithResult(false, false);
            return;
        }
        minimized = true;
        PlayerBridge.get().setPlayerForeground(false);
        JSObject data = new JSObject();
        data.put("positionMs", contentPositionMs());
        data.put("durationMs", contentDurationMs());
        data.put("state", player != null && player.isPlaying() ? "playing" : "paused");
        data.put("ratingKey", ratingKey);
        data.put("title", titleText);
        data.put("subtitle", subtitleText);
        PlayerBridge.get().emit("minimized", data);
        try {
            Intent home = new Intent(this, MainActivity.class);
            home.addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            startActivity(home);
        } catch (Throwable ignored) {
            minimized = false;
            finishWithResult(false, false);
        }
    }

    void markRestored() {
        minimized = false;
        PlayerBridge.get().setPlayerForeground(true);
        JSObject data = new JSObject();
        data.put("state", player != null && player.isPlaying() ? "playing" : "paused");
        PlayerBridge.get().emit("restored", data);
    }

    void finishFromPlugin() {
        finishWithResult(false, false);
    }

    private void finishWithResult(boolean ended, boolean playNext) {
        if (finishing) return;
        finishing = true;
        mainHandler.removeCallbacks(tickRunnable);
        mainHandler.removeCallbacks(progressEmitRunnable);
        hideStatsOverlay();
        mainHandler.removeCallbacks(hideChromeRunnable);
        long positionMs = 0L;
        if (player != null) {
            try {
                positionMs = contentPositionMs();
                emitProgress("stopped");
                player.setPlayWhenReady(false);
            } catch (Throwable ignored) {
                /* player already torn down */
            }
        }
        boolean endedOut = ended || playbackEnded;
        boolean errorOut = playbackError && !ended && !playbackEnded;

        JSObject closed = new JSObject();
        closed.put("ended", endedOut);
        closed.put("positionMs", positionMs);
        closed.put("error", errorOut);
        closed.put("playNext", playNext);
        if (playNext && nextRatingKey != null && !nextRatingKey.isEmpty()) {
            closed.put("nextRatingKey", nextRatingKey);
        }
        PlayerBridge.get().setPlayerForeground(false);
        PlayerBridge.get().keepHostWebViewAlive();
        PlayerBridge.get().emit("closed", closed);
        if (shouldMarkWatched(positionMs, endedOut)) {
            scrobbleWatched();
            pingPlexTimeline("stopped", 0L);
        } else {
            pingPlexTimeline("stopped");
        }

        try {
            PlayerView playerView = findViewById(R.id.player_view);
            if (playerView != null) playerView.setPlayer(null);
        } catch (Throwable ignored) {
            /* view already gone */
        }

        Intent data = new Intent();
        data.putExtra(EXTRA_ENDED, endedOut);
        data.putExtra(EXTRA_POSITION_MS, positionMs);
        data.putExtra(EXTRA_ERROR, errorOut);
        data.putExtra(EXTRA_PLAY_NEXT, playNext);
        if (playNext && nextRatingKey != null) {
            data.putExtra(EXTRA_NEXT_RATING_KEY, nextRatingKey);
        }
        setResult(RESULT_OK, data);
        finish();
        try {
            overridePendingTransition(0, 0);
        } catch (Throwable ignored) {
            /* some TV firmwares reject this */
        }
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        int keyCode = event.getKeyCode();
        if (isOptionDialogShowing()) {
            if (keyCode == KeyEvent.KEYCODE_BACK || keyCode == KeyEvent.KEYCODE_ESCAPE) {
                if (event.getAction() == KeyEvent.ACTION_DOWN) hideOptionSheet();
                return true;
            }
            return super.dispatchKeyEvent(event);
        }
        boolean confirm = keyCode == KeyEvent.KEYCODE_DPAD_CENTER
            || keyCode == KeyEvent.KEYCODE_ENTER
            || keyCode == KeyEvent.KEYCODE_NUMPAD_ENTER;
        boolean mediaToggle = keyCode == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE;
        if ((confirm || mediaToggle)
            && event.getAction() == KeyEvent.ACTION_DOWN
            && event.getRepeatCount() == 0) {
            event.startTracking();
        }
        if (event.getAction() == KeyEvent.ACTION_DOWN && isStatsKey(keyCode)) {
            toggleStatsOverlay();
            return true;
        }
        return super.dispatchKeyEvent(event);
    }

    @Override
    public boolean onKeyLongPress(int keyCode, KeyEvent event) {
        boolean confirm = keyCode == KeyEvent.KEYCODE_DPAD_CENTER
            || keyCode == KeyEvent.KEYCODE_ENTER
            || keyCode == KeyEvent.KEYCODE_NUMPAD_ENTER;
        if (confirm || keyCode == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE) {
            confirmLongPress = true;
            toggleStatsOverlay();
            return true;
        }
        return super.onKeyLongPress(keyCode, event);
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (isOptionDialogShowing()) {
            if (keyCode == KeyEvent.KEYCODE_BACK || keyCode == KeyEvent.KEYCODE_ESCAPE) {
                hideOptionSheet();
                return true;
            }
            return super.onKeyDown(keyCode, event);
        }
        if (keyCode == KeyEvent.KEYCODE_BACK || keyCode == KeyEvent.KEYCODE_ESCAPE) {
            if (chromeVisible) {
                setChromeVisible(false);
                return true;
            }
            boolean endedNow = playbackEnded
                || (player != null && player.getPlaybackState() == Player.STATE_ENDED);
            if (endedNow) {
                finishWithResult(true, false);
                return true;
            }
            if (statsVisible) {
                hideStatsOverlay();
                return true;
            }
            if (upNextRow != null && upNextRow.getVisibility() == View.VISIBLE) {
                dismissUpNextWatchCredits();
                return true;
            }
            if (musicMode) {
                minimizeToBrowse();
                return true;
            }
            finishWithResult(false, false);
            return true;
        }

        boolean mediaToggle = keyCode == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE;
        boolean mediaPlay = keyCode == KeyEvent.KEYCODE_MEDIA_PLAY;
        boolean mediaPause = keyCode == KeyEvent.KEYCODE_MEDIA_PAUSE;
        boolean confirm = keyCode == KeyEvent.KEYCODE_DPAD_CENTER
            || keyCode == KeyEvent.KEYCODE_ENTER
            || keyCode == KeyEvent.KEYCODE_NUMPAD_ENTER;

        if ((confirm || mediaToggle) && isPlaybackConfirmTarget()) {
            event.startTracking();
            return true;
        }

        if (keyCode == KeyEvent.KEYCODE_MEDIA_STOP) {
            finishWithResult(false, false);
            return true;
        }
        if (keyCode == KeyEvent.KEYCODE_MEDIA_NEXT || keyCode == KeyEvent.KEYCODE_CHANNEL_UP) {
            if (!chapters.isEmpty()) skipChapter(1);
            else skipNextFromPlugin();
            return true;
        }
        if (keyCode == KeyEvent.KEYCODE_MEDIA_PREVIOUS || keyCode == KeyEvent.KEYCODE_CHANNEL_DOWN) {
            if (!chapters.isEmpty()) skipChapter(-1);
            return true;
        }

        if (!chromeVisible) {
            if (mediaPause) {
                applyPlayPause(false);
                return true;
            }
            if (mediaPlay) {
                applyPlayPause(true);
                return true;
            }
            if (keyCode == KeyEvent.KEYCODE_MEDIA_REWIND || keyCode == KeyEvent.KEYCODE_DPAD_LEFT) {
                seekBy(-10_000);
                return true;
            }
            if (keyCode == KeyEvent.KEYCODE_MEDIA_FAST_FORWARD || keyCode == KeyEvent.KEYCODE_DPAD_RIGHT) {
                seekBy(10_000);
                return true;
            }
            if (keyCode == KeyEvent.KEYCODE_DPAD_UP || keyCode == KeyEvent.KEYCODE_DPAD_DOWN
                || keyCode == KeyEvent.KEYCODE_MENU) {
                bumpChrome();
                if (playPauseBtn != null) playPauseBtn.requestFocus();
                return true;
            }
            return super.onKeyDown(keyCode, event);
        }

        bumpChrome();
        View focus = getCurrentFocus();
        boolean seekFocused = focus == seekBar;
        if (mediaPause) {
            applyPlayPause(false);
            return true;
        }
        if (mediaPlay) {
            applyPlayPause(true);
            return true;
        }
        if (mediaToggle) {
            togglePlayPause();
            return true;
        }
        if (seekFocused && (keyCode == KeyEvent.KEYCODE_DPAD_LEFT || keyCode == KeyEvent.KEYCODE_MEDIA_REWIND)) {
            seekBy(-10_000);
            return true;
        }
        if (seekFocused && (keyCode == KeyEvent.KEYCODE_DPAD_RIGHT || keyCode == KeyEvent.KEYCODE_MEDIA_FAST_FORWARD)) {
            seekBy(10_000);
            return true;
        }
        if (keyCode == KeyEvent.KEYCODE_MEDIA_REWIND) {
            seekBy(-10_000);
            return true;
        }
        if (keyCode == KeyEvent.KEYCODE_MEDIA_FAST_FORWARD) {
            seekBy(10_000);
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    private boolean isPlaybackConfirmTarget() {
        View focus = getCurrentFocus();
        if (focus == playPauseBtn || focus == seekBar) return true;
        if (focus == null) return true;
        int id = focus.getId();
        return id == R.id.player_root || id == R.id.player_view;
    }

    @Override
    public boolean onKeyUp(int keyCode, KeyEvent event) {
        boolean mediaToggle = keyCode == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE;
        boolean confirm = keyCode == KeyEvent.KEYCODE_DPAD_CENTER
            || keyCode == KeyEvent.KEYCODE_ENTER
            || keyCode == KeyEvent.KEYCODE_NUMPAD_ENTER;
        if (confirm || mediaToggle) {
            if (confirmLongPress) {
                confirmLongPress = false;
                return true;
            }
            if (isOptionDialogShowing()) return super.onKeyUp(keyCode, event);
            if (!isPlaybackConfirmTarget()) return super.onKeyUp(keyCode, event);
            if (!chromeVisible && confirm && trySkipFromRemote()) return true;
            togglePlayPause();
            return true;
        }
        return super.onKeyUp(keyCode, event);
    }

    @Override
    protected void onStart() {
        super.onStart();
        PlayerBridge.get().keepHostWebViewAlive();
        if (player != null && !userPaused) player.setPlayWhenReady(true);
        if (finishing) return;
    }

    @Override
    protected void onStop() {
        super.onStop();
        if (player != null && !finishing && !minimized && !isInPictureInPictureMode()) {
            try {
                player.pause();
                emitProgress("paused");
            } catch (Throwable ignored) {
                /* ignore */
            }
        }
    }

    @Override
    protected void onDestroy() {
        PlayerBridge.get().detachActivity(this);
        logoLoadGeneration += 1;
        pendingLogoUrl = "";
        loadedLogoUrl = "";
        try {
            logoExecutor.shutdownNow();
        } catch (Throwable ignored) {
            /* ignore */
        }
        mainHandler.removeCallbacksAndMessages(null);
        PlayerView playerView = findViewById(R.id.player_view);
        if (playerView != null) playerView.setPlayer(null);
        if (menuScrim != null) menuScrim.setVisibility(View.GONE);
        if (menuList != null) menuList.removeAllViews();
        final ExoPlayer exiting = player;
        player = null;
        super.onDestroy();
        if (exiting != null) {
            new Handler(Looper.getMainLooper()).post(() -> {
                try {
                    exiting.release();
                } catch (Throwable ignored) {
                    /* ignore */
                }
            });
        }
    }
}
